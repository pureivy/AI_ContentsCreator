import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchRecentUpload, recoverRecentUpload, resumableUpload, uploadShortsToYoutube, clearUploadsPlaylistCache } from './youtubeUpload';

// 업로드 응답 유실 회수(2026-10-26) — 실제 구글은 치지 않는다. 시크릿은 가짜 값으로 목킹.
vi.mock('../secrets/store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../secrets/store')>();
  return {
    ...mod,
    getSecret: vi.fn((k: string) => (k.startsWith('YOUTUBE_OAUTH_') ? 'x' : undefined)),
    getYoutubeAccount: vi.fn(() => ({ refreshToken: 'RT' })),
  };
});

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
const item = (videoId: string, title: string, publishedAt: string) => ({ snippet: { title, publishedAt, resourceId: { videoId } } });

describe('matchRecentUpload(순수) — 제목 정확 일치 + 시간 창 필수', () => {
  const now = Date.parse('2026-10-26T06:05:00Z');
  const since = Date.parse('2026-10-26T06:00:00Z');
  it('제목이 같고 창 안이면 그 id', () => {
    expect(matchRecentUpload([item('V1', '감나무 전정 시기', '2026-10-26T06:03:00Z')], '감나무 전정 시기', since, now)).toBe('V1');
  });
  it('창 밖(옛 같은 제목)·제목 다름·접두만 같음·필드 결측은 null', () => {
    expect(matchRecentUpload([item('OLD', '감나무 전정 시기', '2026-10-25T06:03:00Z')], '감나무 전정 시기', since, now)).toBeNull();
    expect(matchRecentUpload([item('V2', '감나무 전정', '2026-10-26T06:03:00Z')], '감나무 전정 시기', since, now)).toBeNull();
    expect(matchRecentUpload([item('V3', '감나무 전정 시기 2편', '2026-10-26T06:03:00Z')], '감나무 전정 시기', since, now)).toBeNull();
    expect(matchRecentUpload([{ snippet: { title: '감나무 전정 시기' } }], '감나무 전정 시기', since, now)).toBeNull();
    expect(matchRecentUpload([item('V4', '', '2026-10-26T06:03:00Z')], '', since, now)).toBeNull();
  });
  it('창 안에 같은 제목이 둘이면 어느 것인지 모르니 null(엉뚱한 영상 기록 금지)', () => {
    expect(matchRecentUpload([
      item('A', '감나무 전정 시기', '2026-10-26T06:01:00Z'), item('B', '감나무 전정 시기', '2026-10-26T06:02:00Z'),
    ], '감나무 전정 시기', since, now)).toBeNull();
  });
});

describe('recoverRecentUpload — channels.list → playlistItems.list', () => {
  it('업로드 재생목록을 찾아 방금 올린 영상을 회수하고, 재생목록 id 는 캐시한다', async () => {
    const urls: string[] = [];
    const signals: Array<AbortSignal | undefined> = [];
    const f = async (u: string, init?: RequestInit): Promise<Response> => {
      urls.push(u); signals.push(init?.signal ?? undefined);
      if (u.includes('/channels?')) return json(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] });
      return json(200, { items: [item('VNEW', '제목 하나', new Date().toISOString())] });
    };
    const since = Date.now() - 60_000;
    expect(await recoverRecentUpload('slug-cache', 'tok', '제목 하나', since, { fetchImpl: f })).toBe('VNEW');
    expect(urls[0]).toContain('part=contentDetails');
    expect(urls[1]).toContain('playlistId=UU1');
    expect(signals.every((s) => s && !s.aborted)).toBe(true); // 호출마다 새 시간 제한
    urls.length = 0;
    expect(await recoverRecentUpload('slug-cache', 'tok', '제목 하나', since, { fetchImpl: f })).toBe('VNEW');
    expect(urls.some((u) => u.includes('/channels?'))).toBe(false); // 캐시 — channels.list 재호출 없음
  });
  it('첫 조회에 없으면 한 번 더 본다(목록 반영 지연), 끝내 없으면 null', async () => {
    let n = 0;
    const f = async (u: string): Promise<Response> => {
      if (u.includes('/channels?')) return json(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU2' } } }] });
      n++;
      return json(200, { items: n >= 2 ? [item('LATE', '늦게 뜬 영상', new Date().toISOString())] : [] });
    };
    expect(await recoverRecentUpload('slug-late', 'tok', '늦게 뜬 영상', Date.now() - 60_000, { fetchImpl: f, retryDelayMs: 0 })).toBe('LATE');
    expect(n).toBe(2);
    const none = async (u: string): Promise<Response> => u.includes('/channels?')
      ? json(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU3' } } }] }) : json(200, { items: [] });
    expect(await recoverRecentUpload('slug-none', 'tok', '없음', Date.now() - 60_000, { fetchImpl: none, retryDelayMs: 0 })).toBeNull();
  });
  it('재생목록 캐시는 6시간 뒤·채널 재연결(clearUploadsPlaylistCache) 뒤엔 다시 조회한다(2026-10-26)', async () => {
    let channelsCalls = 0;
    const f = async (u: string): Promise<Response> => {
      if (u.includes('/channels?')) { channelsCalls++; return json(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: `UU-${channelsCalls}` } } }] }); }
      return json(200, { items: [item('VT', '캐시 제목', new Date().toISOString())] });
    };
    let t = 1_000_000;
    const o = { fetchImpl: f, retryDelayMs: 0, now: () => t };
    await recoverRecentUpload('slug-ttl', 'tok', '캐시 제목', Date.now() - 60_000, o);
    await recoverRecentUpload('slug-ttl', 'tok', '캐시 제목', Date.now() - 60_000, o);
    expect(channelsCalls).toBe(1);
    t += 6 * 3600_000 + 1;
    await recoverRecentUpload('slug-ttl', 'tok', '캐시 제목', Date.now() - 60_000, o);
    expect(channelsCalls).toBe(2);
    clearUploadsPlaylistCache('slug-ttl');
    await recoverRecentUpload('slug-ttl', 'tok', '캐시 제목', Date.now() - 60_000, o);
    expect(channelsCalls).toBe(3);
  });
  it('조회 오류는 null(원래 실패 유지)', async () => {
    const f = async (): Promise<Response> => json(403, { error: { errors: [{ reason: 'forbidden' }] } });
    expect(await recoverRecentUpload('slug-err', 'tok', '제목', 0, { fetchImpl: f, retryDelayMs: 0 })).toBeNull();
  });
});

describe('uploadShortsToYoutube — 업로드 요청 뒤 응답 유실이면 회수', () => {
  function stubFile(): void {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mp4'));
  }
  it('업로드 POST 가 시간 초과(AbortError)로 끊겨도 채널에 올라가 있으면 그 id 로 성공', async () => {
    stubFile();
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url); urls.push(u);
      if (u.includes('oauth2.googleapis.com')) return json(200, { access_token: 'AT' });
      if (u.includes('/upload/youtube/v3/videos')) { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; }
      if (u.includes('/channels?')) return json(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUS' } } }] });
      if (u.includes('/playlistItems?')) return json(200, { items: [item('VREC', '모과나무 삽목', new Date().toISOString())] });
      return json(200, {});
    });
    const r = await uploadShortsToYoutube({ slug: 'yt-abort', videoPath: '/a/final.mp4', title: '모과나무 삽목', description: 'd', hashtags: [] });
    expect(r).toMatchObject({ ok: true, videoId: 'VREC', url: 'https://youtube.com/shorts/VREC' });
    expect(urls.filter((u) => u.includes('/upload/youtube/v3/videos'))).toHaveLength(1); // 재업로드 없음
  });
  it('200 인데 본문이 깨져 id 가 없으면 회수 — 회수도 못 하면 확인 안내와 함께 실패', async () => {
    stubFile();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com')) return json(200, { access_token: 'AT' });
      if (u.includes('/upload/youtube/v3/videos')) return new Response('<html>깨짐', { status: 200 });
      if (u.includes('/channels?')) return json(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUB' } } }] });
      if (u.includes('/playlistItems?')) return json(200, { items: [item('OTHER', '다른 제목', new Date().toISOString())] });
      return json(200, {});
    });
    const r = await uploadShortsToYoutube({ slug: 'yt-badbody', videoPath: '/a/final.mp4', title: '모과나무 삽목', description: 'd', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('이형');
    expect(r.error).toContain('확인');
  }, 15_000);
  it('쿼터 초과(4xx)는 올라가지 않은 것 — 회수 조회를 하지 않는다', async () => {
    stubFile();
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url); urls.push(u);
      if (u.includes('oauth2.googleapis.com')) return json(200, { access_token: 'AT' });
      if (u.includes('/upload/youtube/v3/videos')) return json(403, { error: { errors: [{ reason: 'quotaExceeded' }] } });
      return json(200, {});
    });
    const r = await uploadShortsToYoutube({ slug: 'yt-quota', videoPath: '/a/final.mp4', title: '모과나무 삽목', description: 'd', hashtags: [] });
    expect(r).toMatchObject({ ok: false, error: '유튜브 일일 쿼터 초과 — 내일 재시도' });
    expect(urls.some((u) => u.includes('/channels?') || u.includes('/playlistItems?'))).toBe(false);
  });
  it('토큰 갱신 단계 실패(업로드 전)는 회수하지 않는다', async () => {
    stubFile();
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url); urls.push(u);
      if (u.includes('oauth2.googleapis.com')) return json(400, { error: 'invalid_grant' });
      return json(200, {});
    });
    const r = await uploadShortsToYoutube({ slug: 'yt-token', videoPath: '/a/final.mp4', title: '모과나무 삽목', description: 'd', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('토큰 만료');
    expect(urls).toHaveLength(1);
  });
});

describe('resumableUpload — 완료 응답 본문을 못 읽으면 재조회 → 업로드 목록 회수', () => {
  function tmpVideo(bytes: number): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-recover-'));
    const p = path.join(dir, 'final.mp4');
    fs.writeFileSync(p, Buffer.alloc(bytes, 1));
    return p;
  }
  const seq = (responses: Response[]) => async (): Promise<Response> => {
    const n = responses.shift();
    if (!n) throw new Error('예상 밖 요청');
    return n;
  };
  it('201 본문이 깨지면 위치 조회를 한 번 더 해 id 를 받는다', async () => {
    const r = await resumableUpload({
      access: 'tok', videoPath: tmpVideo(1000), meta: { snippet: { title: 't' } }, retryDelaysMs: [0],
      fetchImpl: seq([
        new Response(null, { status: 200, headers: { Location: 'https://upload.example/s' } }),
        new Response('깨진 본문', { status: 201 }),
        json(200, { id: 'VQ' }),
      ]),
    });
    expect(r).toEqual({ ok: true, videoId: 'VQ' });
  });
  it('재조회도 id 가 없으면 recover 로 회수, recover 도 못 하면 확인 안내와 함께 실패', async () => {
    const mk = (): Response[] => [
      new Response(null, { status: 200, headers: { Location: 'https://upload.example/s' } }),
      new Response('깨진 본문', { status: 201 }),
      new Response('또 깨짐', { status: 201 }),
    ];
    const ok = await resumableUpload({
      access: 'tok', videoPath: tmpVideo(1000), meta: { snippet: { title: 't' } }, retryDelaysMs: [0],
      fetchImpl: seq(mk()), recover: async () => 'VREC',
    });
    expect(ok).toEqual({ ok: true, videoId: 'VREC' });
    const bad = await resumableUpload({
      access: 'tok', videoPath: tmpVideo(1000), meta: { snippet: { title: 't' } }, retryDelaysMs: [0],
      fetchImpl: seq(mk()), recover: async () => null,
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('채널을 확인');
  });
});
