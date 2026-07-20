import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildIgCaption, extractId, pickPhotoUrl, parsePermalink, graphError, publishCardNewsToMeta, publishShortsToMeta } from './metaPublish';
import { getMetaAccount } from '../secrets/store';
import fs from 'node:fs';

// ESM 모듈 함수는 spyOn 불가 — vi.mock 부분 목킹(파서 등 순수부는 원본 유지).
vi.mock('../secrets/store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../secrets/store')>();
  return { ...mod, getMetaAccount: vi.fn(() => ({ pageId: '', igUserId: '', pageAccessToken: '' })) };
});

// fal 스토리지 업로드는 네트워크·FAL_KEY 의존 → 고정 공개 URL 로 목킹(발행 로직만 검증).
vi.mock('./falStorage', () => ({ uploadToFalStorage: vi.fn(async () => 'https://v3.fal.media/files/test.mp4') }));

afterEach(() => vi.restoreAllMocks());

describe('metaPublish 순수 헬퍼', () => {
  it('buildIgCaption: 캡션+해시태그 결합, 2200자 캡', () => {
    expect(buildIgCaption('본문', ['#a', '#b'])).toBe('본문\n\n#a #b');
    expect(buildIgCaption('', ['#a'])).toBe('#a');
    expect(buildIgCaption('x'.repeat(3000), []).length).toBe(2200);
  });
  it('extractId: {id} 추출, 이형은 null', () => {
    expect(extractId({ id: '123' })).toBe('123');
    expect(extractId({})).toBeNull();
    expect(extractId(null)).toBeNull();
    expect(extractId({ id: 42 })).toBeNull();
  });
  it('pickPhotoUrl: images[0].source(최대 해상도), 이형은 null', () => {
    expect(pickPhotoUrl({ images: [{ source: 'https://cdn/a.png' }, { source: 'https://cdn/small.png' }] })).toBe('https://cdn/a.png');
    expect(pickPhotoUrl({ images: [] })).toBeNull();
    expect(pickPhotoUrl({})).toBeNull();
  });
  it('parsePermalink: {permalink} 추출', () => {
    expect(parsePermalink({ permalink: 'https://www.instagram.com/p/x/' })).toBe('https://www.instagram.com/p/x/');
    expect(parsePermalink({})).toBeNull();
  });
  it('graphError: 그래프 에러 메시지 추출(토큰 미노출), 없으면 HTTP 코드', () => {
    expect(graphError({ error: { message: 'Invalid parameter', code: 100 } }, 400)).toBe('Invalid parameter(code 100)');
    expect(graphError({}, 500)).toBe('HTTP 500');
  });
});

describe('publishCardNewsToMeta', () => {
  it('브랜드 미연결 → 명확한 에러(네트워크 호출 없음)', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: '', igUserId: '', pageAccessToken: '' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await publishCardNewsToMeta({ slug: 'x', slidePaths: ['/tmp/none.png'], caption: 'c', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('메타 미연결');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('11장 이상 → 캐러셀 한도 에러', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'p', igUserId: 'ig', pageAccessToken: 't' });
    const r = await publishCardNewsToMeta({ slug: '', slidePaths: Array.from({ length: 11 }, (_, i) => `/tmp/s${i}.png`), caption: 'c', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('10장');
  });
  it('happy path: 사진 2장 업로드→IG 캐러셀→FB 피드, 두 채널 id 반환', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('png'));
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url); calls.push(u);
      const json =
        u.includes('/PG/photos') ? { id: `ph${calls.filter((c) => c.includes('/PG/photos')).length}` }
        : u.includes('fields=images') ? { images: [{ source: 'https://cdn/x.png' }] }
        : u.includes('/media_publish') ? { id: 'IGMEDIA' }
        : u.includes('fields=permalink') ? { permalink: 'https://www.instagram.com/p/x/' }
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') ? { id: `ct${calls.filter((c) => c.includes('/me/media')).length}` }
        : u.includes('/PG/feed') ? { id: 'PG_POST1' }
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishCardNewsToMeta({ slug: '', slidePaths: ['/a/slide_01.png', '/a/slide_02.png'], caption: '본문', hashtags: ['#t'] });
    expect(r).toMatchObject({ ok: true, igMediaId: 'IGMEDIA', igPermalink: 'https://www.instagram.com/p/x/', fbPostId: 'PG_POST1' });
    expect(calls.filter((c) => c.includes('/PG/photos')).length).toBe(2);
  });
  it('부분 성공 멱등: existing.igPermalink 있으면 IG 스킵하고 FB 만 발행', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('png'));
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url); calls.push(u);
      const json = u.includes('/PG/photos') ? { id: 'ph1' } : u.includes('/PG/feed') ? { id: 'PG_POST2' } : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishCardNewsToMeta({
      slug: '', slidePaths: ['/a/slide_01.png'], caption: 'c', hashtags: [],
      existing: { igPermalink: 'https://www.instagram.com/p/done/' },
    });
    expect(r.ok).toBe(true);
    expect(r.fbPostId).toBe('PG_POST2');
    expect(calls.some((c) => c.includes('/me/media'))).toBe(false); // IG 경로 미호출
  });
  it('media_publish 이형 응답(id 없음) → ok:false(성공 위장 금지)', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('png'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      const json =
        u.includes('/PG/photos') ? { id: 'ph1' }
        : u.includes('fields=images') ? { images: [{ source: 'https://cdn/x.png' }] }
        : u.includes('/media_publish') ? {}                       // ← 이형: id 없음
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') ? { id: 'ct1' }
        : u.includes('/PG/feed') ? { id: 'PG_POST' }
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishCardNewsToMeta({ slug: '', slidePaths: ['/a/slide_01.png'], caption: 'c', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('이형');
    expect(r.error).toContain('IG 발행');        // IG 단계 가드가 발동했음을 특정
    expect(r.fbPostId).toBeUndefined();          // 가드가 FB 단계 진행을 막았음을 검증
  });
});

describe('publishShortsToMeta', () => {
  it('브랜드 미연결 → 명확한 에러(네트워크 호출 없음)', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: '', igUserId: '', pageAccessToken: '' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await publishShortsToMeta({ slug: 'x', videoPath: '/tmp/none.mp4', caption: 'c', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('메타 미연결');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('영상 파일 없음 → 에러', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const r = await publishShortsToMeta({ slug: '', videoPath: '/a/final.mp4', caption: 'c', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('영상 파일');
  });
  it('happy path: IG 컨테이너(fal video_url)→폴링→발행→permalink + FB start→upload→finish', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mp4'));
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url); calls.push(u);
      const body = String((init as RequestInit | undefined)?.body ?? '');
      const json =
        u.includes('rupload.facebook.com') || u.includes('UPLOAD_URL') ? { success: true }
        : u.includes('/media_publish') ? { id: 'REEL1' }
        : u.includes('fields=permalink') ? { permalink: 'https://www.instagram.com/reel/x/' }
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') ? { id: 'CT1' }
        : u.includes('/PG/video_reels') && body.includes('upload_phase=start') ? { video_id: 'FBV1', upload_url: 'https://rupload.facebook.com/UPLOAD_URL' }
        : u.includes('/PG/video_reels') ? { success: true }   // finish
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishShortsToMeta({ slug: '', videoPath: '/a/final.mp4', caption: '제목\n\n설명', hashtags: ['#t'] });
    expect(r).toMatchObject({ ok: true, igReelId: 'REEL1', igPermalink: 'https://www.instagram.com/reel/x/', fbReelId: 'FBV1' });
    expect(calls.filter((c) => c.includes('rupload.facebook.com')).length).toBe(1); // FB 바이너리만(IG 는 fal video_url)
    expect(calls.some((c) => c.includes('/me/media') && !c.includes('media_publish'))).toBe(true); // IG 컨테이너는 me/media
  });
  it('IG 발행 이형(id 없음) → ok:false + FB 미진행(변별력: FB 성공 mock 준비)', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mp4'));
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url); calls.push(u);
      const body = String((init as RequestInit | undefined)?.body ?? '');
      const json =
        u.includes('/me/media_publish') ? {}                            // ← 이형: id 없음 → throw
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') ? { id: 'CT1' }                       // 컨테이너 생성 성공
        : u.includes('/PG/video_reels') && body.includes('upload_phase=start') ? { video_id: 'FBV1', upload_url: 'https://rupload.facebook.com/UPLOAD_URL' }
        : u.includes('/PG/video_reels') ? { success: true }
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishShortsToMeta({ slug: '', videoPath: '/a/final.mp4', caption: 'c', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('릴스 발행');
    expect(r.fbReelId).toBeUndefined();                                  // IG 실패가 FB 진행을 막음
    expect(calls.some((c) => c.includes('/PG/video_reels'))).toBe(false);
  });
  it('FB start 이형(video_id 없음) → FB best-effort 스킵, IG 릴스 성공은 ok:true 로 유지', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mp4'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      const body = String((init as RequestInit | undefined)?.body ?? '');
      const json =
        u.includes('rupload.facebook.com') ? { success: true }
        : u.includes('/media_publish') ? { id: 'REEL9' }
        : u.includes('fields=permalink') ? { permalink: 'https://www.instagram.com/reel/y/' }
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') ? { id: 'CT9' }
        : u.includes('/PG/video_reels') && body.includes('upload_phase=start') ? {}   // ← 이형: video_id 없음
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishShortsToMeta({ slug: '', videoPath: '/a/final.mp4', caption: 'c', hashtags: [] });
    expect(r.ok).toBe(true);            // FB best-effort — 실패해도 IG 성공으로 ok:true
    expect(r.igReelId).toBe('REEL9');   // IG 릴스 성공
    expect(r.fbReelId).toBeUndefined(); // FB 는 스킵됨
  });
  it('FB finish 이형(success 없음) → FB best-effort 스킵, IG 릴스 성공 유지', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mp4'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      const body = String((init as RequestInit | undefined)?.body ?? '');
      const json =
        u.includes('rupload.facebook.com') || u.includes('UPLOAD_URL') ? { success: true }
        : u.includes('/media_publish') ? { id: 'REEL7' }
        : u.includes('fields=permalink') ? { permalink: 'https://www.instagram.com/reel/z/' }
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') ? { id: 'CT7' }
        : u.includes('/PG/video_reels') && body.includes('upload_phase=start') ? { video_id: 'FBV7', upload_url: 'https://rupload.facebook.com/UPLOAD_URL' }
        : u.includes('/PG/video_reels') && body.includes('upload_phase=finish') ? {}   // ← 이형
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishShortsToMeta({ slug: '', videoPath: '/a/final.mp4', caption: 'c', hashtags: [] });
    expect(r.ok).toBe(true);                 // FB best-effort — IG 성공으로 ok:true
    expect(r.igReelId).toBe('REEL7');        // IG 릴스 성공
    expect(r.fbReelId).toBeUndefined();      // FB 는 스킵됨
  });
  it('부분 성공 멱등: existing.igPermalink 있으면 IG 경로 무호출, FB 만 발행', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: 'PG', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('mp4'));
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url); calls.push(u);
      const body = String((init as RequestInit | undefined)?.body ?? '');
      const json =
        u.includes('/PG/video_reels') && body.includes('upload_phase=start') ? { video_id: 'FBV2', upload_url: 'https://rupload.facebook.com/UPLOAD_URL' }
        : u.includes('UPLOAD_URL') ? { success: true }
        : u.includes('/PG/video_reels') ? { success: true }
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishShortsToMeta({
      slug: '', videoPath: '/a/final.mp4', caption: 'c', hashtags: [],
      existing: { igPermalink: 'https://www.instagram.com/reel/done/' },
    });
    expect(r.ok).toBe(true);
    expect(r.fbReelId).toBe('FBV2');
    expect(calls.some((c) => c.includes('/me/media'))).toBe(false);
  });
});
