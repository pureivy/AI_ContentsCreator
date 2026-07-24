import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildIgCaption, extractId, parsePermalink, realPermalink, graphError, metaLimitHint, matchOrphanReels, publishCardNewsToMeta, publishShortsToMeta } from './metaPublish';
import { uploadToFalStorage } from './falStorage';
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
  it('parsePermalink: {permalink} 추출', () => {
    expect(parsePermalink({ permalink: 'https://www.instagram.com/p/x/' })).toBe('https://www.instagram.com/p/x/');
    expect(parsePermalink({})).toBeNull();
  });
  it('realPermalink: 실제 게시물 링크만 인정, 홈 URL·빈값은 undefined(재시도 보강용)', () => {
    expect(realPermalink('https://www.instagram.com/reel/AbC/')).toBe('https://www.instagram.com/reel/AbC/');
    expect(realPermalink('https://www.instagram.com/p/x/')).toBe('https://www.instagram.com/p/x/');
    expect(realPermalink('https://www.instagram.com/')).toBeUndefined();   // 홈 URL 잔재 → 미보유
    expect(realPermalink('https://instagram.com')).toBeUndefined();
    expect(realPermalink(null)).toBeUndefined();
    expect(realPermalink(undefined)).toBeUndefined();
  });
  it('graphError: 그래프 에러 메시지 추출(토큰 미노출), 없으면 HTTP 코드', () => {
    expect(graphError({ error: { message: 'Invalid parameter', code: 100 } }, 400)).toBe('Invalid parameter(code 100)');
    expect(graphError({}, 500)).toBe('HTTP 500');
  });
  it('metaLimitHint: code 4(앱 레이트리밋)와 24h 발행 한도를 구분', () => {
    // code 4 = 앱 API 레이트리밋 → 재시도 안내, 발행 수 한도 아님 명시
    const rate = metaLimitHint('IG 발행 실패: Application request limit reached(code 4)');
    expect(rate).toContain('레이트리밋');
    expect(rate).toContain('재시도');
    expect(rate).not.toContain('24시간 발행 한도');
    // 그 외 limit(발행 quota 초과 등) → 발행 한도 안내
    const quota = metaLimitHint('IG 발행 실패: The user has reached the limit of posts(code 9)');
    expect(quota).toContain('24시간 발행 한도');
    expect(quota).toContain('/me/content_publishing_limit');
    // limit 무관 에러 → 힌트 없음
    expect(metaLimitHint('IG 컨테이너 응답 이형')).toBe('');
  });
});

describe('matchOrphanReels', () => {
  it('제목=캡션 접두 매칭, igReelId 있는 쇼츠 제외·매칭 릴스 없으면 스킵', () => {
    const shorts = [
      { id: 's1', title: '여름꽃 여섯 가지', igReelId: undefined },
      { id: 's2', title: '베란다 채소 다섯 가지', igReelId: 'R99' }, // 이미 추적됨 → 제외
      { id: 's3', title: '없는 제목', igReelId: undefined },        // 매칭 릴스 없음
    ];
    const reels = [
      { id: 'R1', permalink: 'https://www.instagram.com/reel/a/', timestamp: '2026-07-20T07:40:44+0000', caption: '여름꽃 여섯 가지 지금 심어도\n\n본문' },
      { id: 'R2', permalink: 'https://www.instagram.com/reel/b/', timestamp: '2026-07-20T07:40:41+0000', caption: '베란다 채소 다섯 가지 …' },
    ];
    expect(matchOrphanReels(shorts, reels)).toEqual([
      { shortsId: 's1', reelId: 'R1', permalink: 'https://www.instagram.com/reel/a/', timestamp: '2026-07-20T07:40:44+0000' },
    ]);
  });
  it('한 릴스가 여러 쇼츠에 중복 매칭되지 않음(선점)', () => {
    const shorts = [{ id: 's1', title: '같은 제목', igReelId: undefined }, { id: 's2', title: '같은 제목', igReelId: undefined }];
    const reels = [{ id: 'R1', permalink: 'p', timestamp: 't', caption: '같은 제목 뒤' }];
    const m = matchOrphanReels(shorts, reels);
    expect(m.length).toBe(1);
    expect(m[0]!.shortsId).toBe('s1');
  });
  it('빈 제목 쇼츠는 매칭 안 함(무분별 매칭 방지)', () => {
    expect(matchOrphanReels([{ id: 's1', title: '  ', igReelId: undefined }], [{ id: 'R1', permalink: 'p', timestamp: 't', caption: '아무거나' }])).toEqual([]);
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
  it('happy path: 슬라이드 2장 fal 업로드→IG 캐러셀→발행→permalink(IG 전용, FB 없음)', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: '', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    // fal 은 슬라이드 파일명별 고유 공개 URL 반환 — image_url 로 흘렀는지·순서 보존을 값으로 검증.
    vi.mocked(uploadToFalStorage).mockImplementation(async (p) => `https://v3.fal.media/${p.split('/').pop()}`);
    const bodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url); const body = String((init as RequestInit | undefined)?.body ?? ''); bodies.push(body);
      const json =
        u.includes('/me/media_publish') ? { id: 'IGMEDIA' }
        : u.includes('fields=permalink') ? { permalink: 'https://www.instagram.com/p/x/' }
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') && body.includes('media_type=CAROUSEL') ? { id: 'CAR1' }
        : u.includes('/me/media') ? { id: `ct${bodies.filter((b) => b.includes('is_carousel_item')).length}` }
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishCardNewsToMeta({ slug: '', slidePaths: ['/a/slide_01.png', '/a/slide_02.png'], caption: '본문', hashtags: ['#t'] });
    expect(r).toMatchObject({ ok: true, igMediaId: 'IGMEDIA', igPermalink: 'https://www.instagram.com/p/x/' });
    expect(r.fbPostId).toBeUndefined();                                     // FB 경로 제거됨
    // fal 업로드: 슬라이드 수·순서·contentType 검증(로컬 경로/스킵 회귀를 잡음)
    expect(vi.mocked(uploadToFalStorage).mock.calls.map((c) => [c[0], c[1]])).toEqual([['/a/slide_01.png', 'image/png'], ['/a/slide_02.png', 'image/png']]);
    // fal 공개 URL 이 자식 image_url 로, 슬라이드 순서대로 전달됐는지(로컬 경로 회귀 시 실패)
    const children = bodies.filter((b) => b.includes('is_carousel_item=true'));
    expect(children.length).toBe(2);
    expect(children.every((b) => b.includes('fal.media') && b.includes('image_url'))).toBe(true);
    expect(children[0]).toContain('slide_01.png');
    expect(children[1]).toContain('slide_02.png');
  });
  it('단일 슬라이드 → 캐러셀 아닌 일반 이미지 포스트(fal URL)로 발행', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: '', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const bodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url); const body = String((init as RequestInit | undefined)?.body ?? ''); bodies.push(body);
      const json =
        u.includes('/me/media_publish') ? { id: 'IGONE' }
        : u.includes('fields=permalink') ? { permalink: 'https://www.instagram.com/p/one/' }
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') ? { id: 'IMG1' }
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishCardNewsToMeta({ slug: '', slidePaths: ['/a/slide_01.png'], caption: 'c', hashtags: [] });
    expect(r).toMatchObject({ ok: true, igMediaId: 'IGONE' });
    expect(vi.mocked(uploadToFalStorage)).toHaveBeenCalledWith('/a/slide_01.png', 'image/png', expect.anything());
    expect(bodies.some((b) => b.includes('is_carousel_item') || b.includes('media_type=CAROUSEL'))).toBe(false); // 캐러셀 아님
    expect(bodies.some((b) => b.includes('image_url') && b.includes('caption') && b.includes('fal.media'))).toBe(true); // 단일 이미지+캡션+fal URL
  });
  it('단일 이미지 발행 이형(id 없음) → ok:false(fail-closed, 단일 경로도 위장 금지)', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: '', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      const json =
        u.includes('/me/media_publish') ? {}                       // ← 이형: id 없음
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') ? { id: 'IMG1' }
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishCardNewsToMeta({ slug: '', slidePaths: ['/a/slide_01.png'], caption: 'c', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('이형');
  });
  it('부분 성공 멱등: existing.igMediaId 있으면 IG 스킵·fal 미업로드(재발행·중복 없음)', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: '', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => { calls.push(String(url)); return new Response('{}', { status: 200 }); });
    const r = await publishCardNewsToMeta({
      slug: '', slidePaths: ['/a/slide_01.png'], caption: 'c', hashtags: [],
      existing: { igMediaId: 'MDONE', igPermalink: 'https://www.instagram.com/p/done/' },
    });
    expect(r.ok).toBe(true);
    expect(r.igMediaId).toBe('MDONE');                              // 기존 미디어 id 이월
    expect(vi.mocked(uploadToFalStorage)).not.toHaveBeenCalled();   // 재업로드 없음
    expect(calls.some((c) => c.includes('/me/media'))).toBe(false); // IG 경로 미호출(중복 방지)
  });
  it('media_publish 이형 응답(id 없음) → ok:false(성공 위장 금지)', async () => {
    vi.mocked(getMetaAccount).mockReturnValue({ pageId: '', igUserId: 'IG', pageAccessToken: 'T' });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url); const body = String((init as RequestInit | undefined)?.body ?? '');
      const json =
        u.includes('/me/media_publish') ? {}                       // ← 이형: id 없음
        : u.includes('fields=status_code') ? { status_code: 'FINISHED' }
        : u.includes('/me/media') && body.includes('media_type=CAROUSEL') ? { id: 'CAR1' }
        : u.includes('/me/media') ? { id: 'ct1' }
        : {};
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const r = await publishCardNewsToMeta({ slug: '', slidePaths: ['/a/slide_01.png', '/a/slide_02.png'], caption: 'c', hashtags: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('이형');
    expect(r.error).toContain('IG 발행');        // IG 발행 단계 가드가 발동했음을 특정
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
  it('부분 성공 멱등: existing.igReelId 있으면 IG 경로 무호출·fal 미업로드, FB 만 발행', async () => {
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
      existing: { igReelId: 'RDONE', igPermalink: 'https://www.instagram.com/reel/done/', fbReelId: undefined },
    });
    expect(r.ok).toBe(true);
    expect(r.igReelId).toBe('RDONE');                              // 기존 릴스 id 이월
    expect(r.fbReelId).toBe('FBV2');
    expect(vi.mocked(uploadToFalStorage)).not.toHaveBeenCalled();  // 재업로드 없음
    expect(calls.some((c) => c.includes('/me/media'))).toBe(false); // IG 경로 미호출(중복 방지)
  });
});
