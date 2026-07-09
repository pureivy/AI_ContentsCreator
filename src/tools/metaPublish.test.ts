import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildIgCaption, extractId, pickPhotoUrl, parsePermalink, graphError, publishCardNewsToMeta } from './metaPublish';
import { getMetaAccount } from '../secrets/store';
import fs from 'node:fs';

// ESM 모듈 함수는 spyOn 불가 — vi.mock 부분 목킹(파서 등 순수부는 원본 유지).
vi.mock('../secrets/store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../secrets/store')>();
  return { ...mod, getMetaAccount: vi.fn(() => ({ pageId: '', igUserId: '', pageAccessToken: '' })) };
});

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
        : u.includes('/IG/media') ? { id: `ct${calls.filter((c) => c.includes('/IG/media')).length}` }
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
    expect(calls.some((c) => c.includes('/IG/media'))).toBe(false); // IG 경로 미호출
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
        : u.includes('/IG/media') ? { id: 'ct1' }
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
