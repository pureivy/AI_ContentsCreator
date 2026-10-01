// publishWhenReady — 업로드 뒤 공개 전환·썸네일 확인·복구 흐름(2026-10-01). 네트워크는 전부 가짜 fetch 로 대신한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../secrets/store', () => ({
  getSecret: () => 'x',
  getYoutubeAccount: () => ({ refreshToken: 'r' }),
}));

import { publishWhenReady } from './youtubeUpload';

type Call = { url: string; method: string; body?: Record<string, unknown> };

/** 가짜 유튜브 — putStatus: 공개 여부 변경 응답 코드, thumbs: 썸네일 탐침마다 돌려줄 이미지 크기(끝나면 마지막 값 반복). */
function fakeYoutube(o: { putStatus?: number[]; thumbs: number[]; tokenFailAfter?: number }) {
  const calls: Call[] = [];
  let put = 0, probe = 0, token = 0, wasPublic = false;
  const res = (status: number, json: unknown = {}, bytes = 0): Response =>
    ({ ok: status >= 200 && status < 300, status, json: async () => json, arrayBuffer: async () => new ArrayBuffer(bytes) }) as unknown as Response;
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      token++;
      if (o.tokenFailAfter !== undefined && token > o.tokenFailAfter) throw new Error('network down');
      return res(200, { access_token: 'a' });
    }
    if (url.includes('/youtube/v3/videos?part=status,processingDetails')) {
      return res(200, { items: [{ status: { uploadStatus: 'processed', privacyStatus: 'private', license: 'youtube', embeddable: true, publicStatsViewable: true },
        processingDetails: { processingStatus: 'succeeded', thumbnailsAvailability: 'available' } }] });
    }
    if (url.includes('/youtube/v3/videos?part=status') && method === 'PUT') {
      const code = o.putStatus?.[put++] ?? 200;
      if (code === 403) return res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } });
      const st = (body?.status ?? {}) as Record<string, unknown>;
      // 실제 API: 한 번 공개된 영상엔 예약 공개를 걸 수 없다(2026-10-02 실측 — 복구가 이걸로 통째로 거절됐다).
      if (st.publishAt && wasPublic) return res(400, { error: { errors: [{ reason: 'invalidPublishAt' }] } });
      if (code < 300 && st.privacyStatus === 'public') wasPublic = true;
      return res(code, {});
    }
    if (url.includes('/thumbnails/set')) return res(200, {});
    if (url.startsWith('https://www.youtube.com/oembed')) return res(200, {});
    if (url.startsWith('https://i.ytimg.com/')) {
      const b = o.thumbs[Math.min(probe, o.thumbs.length - 1)]!; // 탐침 1회 = 세로(oardefault) 한 장
      probe++;
      return res(200, {}, b);
    }
    return res(404);
  });
  return { fn, calls, puts: () => calls.filter((c) => c.method === 'PUT').map((c) => c.body!.status as Record<string, unknown>) };
}

const FAST = { pollMs: 1, processTries: 3, thumbTries: 2, scheduleGraceMs: 0 };

describe('publishWhenReady — 공개 전환·썸네일 확인(가짜 유튜브)', () => {
  const orig = globalThis.fetch;
  let yt: ReturnType<typeof fakeYoutube>;
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => { globalThis.fetch = orig; });

  it('정상: 처리 확인 → 공개 전환(예약 공개 지움) → 썸네일 확인', async () => {
    yt = fakeYoutube({ thumbs: [250_000] });
    globalThis.fetch = yt.fn as unknown as typeof fetch;
    const o = await publishWhenReady({ slug: 'b', videoId: 'v1', publishAt: new Date(Date.now() + 1_800_000).toISOString(), ...FAST });
    expect(o).toMatchObject({ state: 'public', thumb: 'ok', recovered: false });
    const [p] = yt.puts();
    expect(p).toMatchObject({ privacyStatus: 'public', containsSyntheticMedia: true, selfDeclaredMadeForKids: false, license: 'youtube' });
    expect('publishAt' in p!).toBe(false);
  });

  it('권한 없음(youtube.force-ssl 미연결): 실패로 끝내지 않고 예약 공개에 맡긴 뒤 썸네일을 본다', async () => {
    yt = fakeYoutube({ putStatus: [403], thumbs: [250_000] });
    globalThis.fetch = yt.fn as unknown as typeof fetch;
    const o = await publishWhenReady({ slug: 'b', videoId: 'v1', publishAt: new Date(Date.now() - 1000).toISOString(), ...FAST });
    expect(o).toMatchObject({ state: 'scheduled', thumb: 'ok' });
    expect(yt.puts()).toHaveLength(1); // 복구 시도 없음(권한이 없다)
  });

  it('썸네일 자리표시 → 비공개 → 썸네일 지정 → 공개, 복구 확인(한 번 공개된 영상이라 예약 공개는 못 건다)', async () => {
    yt = fakeYoutube({ thumbs: [1097, 1097, 250_000] });
    globalThis.fetch = yt.fn as unknown as typeof fetch;
    const o = await publishWhenReady({ slug: 'b', videoId: 'v1', thumbnailPath: undefined, ...FAST });
    expect(o).toMatchObject({ state: 'public', thumb: 'ok', recovered: true });
    const puts = yt.puts();
    expect(puts.map((p) => p.privacyStatus)).toEqual(['public', 'private', 'public']);
    // 복구의 비공개 되돌림에 예약 공개를 실으면 invalidPublishAt 으로 거절돼 복구가 통째로 안 된다(10-02 실사고).
    expect('publishAt' in puts[1]!).toBe(false);
    expect('publishAt' in puts[2]!).toBe(false);
  });

  it('공개 전환 뒤 오류면 "예약 공개된다"고 하지 않는다(예약이 이미 지워졌다)', async () => {
    // 토큰: 1회(처음)만 성공 — 복구 단계의 재발급에서 실패시킨다.
    yt = fakeYoutube({ thumbs: [1097], tokenFailAfter: 1 });
    globalThis.fetch = yt.fn as unknown as typeof fetch;
    const o = await publishWhenReady({ slug: 'b', videoId: 'v1', publishAt: new Date(Date.now() + 1_800_000).toISOString(), ...FAST });
    expect(o.state).toBe('failed');
    expect(o.note).toContain('공개 전환은 이미 됐다');
    expect(o.note).not.toContain('업로드 때 건 예약 공개');
  });
});
