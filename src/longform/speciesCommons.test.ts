import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanLatin, commonsQueries, fetchCommonsRefs, filterCandidates, hasExactLatin, institutionLinks, isInternalRef, missingParts, partsFromText, pickCommons,
  COMMONS_UA, type RefPart,
} from './speciesCommons';
import { prepareSpecies, batchSpecies } from './speciesPreset';
import { renderEpisodeFull, stagePublic, type RenderDeps } from './render';
import type { LlmJSON } from './writer';

const REPO = path.resolve('.');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);

/** Commons API 한 쪽(imageinfo + extmetadata) — 실제 응답 꼴. */
const page = (index: number, title: string, o: { mime?: string; cats?: string; license?: string; artist?: string; desc?: string } = {}) => ({
  index, title,
  imageinfo: [{
    mime: o.mime ?? 'image/jpeg', thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}/800px.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    extmetadata: {
      Categories: { value: o.cats ?? '' }, LicenseShortName: { value: o.license ?? 'CC BY-SA 2.5' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/2.5' },
      Artist: { value: o.artist ?? '<a href="//commons.wikimedia.org/wiki/User:Kenpei">Kenpei</a>' }, ImageDescription: { value: o.desc ?? '' },
    },
  }],
});
const api = (...pages: ReturnType<typeof page>[]) => ({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(-1 - i), p])) } });

const BARK_RESULT = api(
  page(1, 'File:Diospyros kaki bark.jpg', { cats: 'Diospyros kaki|Taken with Canon EOS 350D|Self-published work' }),
  page(2, 'File:Diospyros virginiana 8zz.jpg', { cats: 'Diospyros virginiana (bark)', license: 'CC BY-SA 4.0' }),
  page(3, 'File:The tree book - A popular guide (1920) (14783077055).jpg', { cats: 'Diospyros kaki|Photos uploaded from Flickr|Files from the Biodiversity Heritage Library' }),
  page(4, 'File:Plant immigrants (IA cat30850057 117).pdf', { mime: 'application/pdf', cats: 'Diospyros kaki bark' }),
  page(5, 'File:Diospyros kakiensis trunk.jpg', { cats: 'Diospyros kakiensis' }),
  page(6, 'File:Persimmon trunk old.jpg', { cats: 'Diospyros_kaki trees|Bark' }),
);

describe('공개 도감 사진 — 걸러 내기', () => {
  it('정확한 학명만 — 같은 속 다른 종(virginiana)·접두 일치(kakiensis)는 버린다, 밑줄 표기는 받는다', () => {
    expect(hasExactLatin('File:Diospyros kaki bark.jpg', 'Diospyros kaki')).toBe(true);
    expect(hasExactLatin('Diospyros_kaki trees', 'Diospyros kaki')).toBe(true);
    expect(hasExactLatin('Diospyros virginiana (bark)', 'Diospyros kaki')).toBe(false);
    expect(hasExactLatin('Diospyros kakiensis', 'Diospyros kaki')).toBe(false);
  });
  it('filterCandidates — 학명·JPEG·사진(책 스캔 아님)·부위 낱말·라이선스, 작가 HTML 은 벗긴다', () => {
    const c = filterCandidates(BARK_RESULT, 'Diospyros kaki', 'bark');
    expect(c.map((x) => x.title)).toEqual(['File:Diospyros kaki bark.jpg', 'File:Persimmon trunk old.jpg']);
    expect(c[0]).toMatchObject({ author: 'Kenpei', license: 'CC BY-SA 2.5', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.5', descriptionUrl: 'https://commons.wikimedia.org/wiki/File%3ADiospyros_kaki_bark.jpg' });
    // 부위 낱말이 없으면(꽃을 찾는데 껍질 사진) 버린다 — 분류 검색으로 온 것은 분류가 부위를 보증하므로 받는다.
    expect(filterCandidates(BARK_RESULT, 'Diospyros kaki', 'flower')).toEqual([]);
    expect(filterCandidates(api(page(1, 'File:Diospyros kaki kz3.jpg', { cats: 'Diospyros kaki (flowers)' })), 'Diospyros kaki', 'flower', true)).toHaveLength(1);
    // 라이선스 표기 없는 것은 받지 않는다.
    expect(filterCandidates(api(page(1, 'File:Diospyros kaki bark2.jpg', { cats: 'Diospyros kaki', license: '' })), 'Diospyros kaki', 'bark')).toEqual([]);
    expect(filterCandidates(null, 'Diospyros kaki', 'bark')).toEqual([]);
  });
  it('학명 정리·빠진 부위·검색 주소·기관 링크', () => {
    expect(cleanLatin('Diospyros kaki Thunb.')).toBe('Diospyros kaki');
    expect(cleanLatin('Kalopanax septemlobus (Thunb.) Koidz.')).toBe('Kalopanax septemlobus');
    expect(cleanLatin('-')).toBeNull();
    expect(missingParts(4)).toEqual(['bark', 'flower', 'winter', 'seedling']);
    expect(missingParts(0)).toEqual(['bark', 'flower', 'winter', 'seedling', 'leaf', 'fruit', 'habit']);
    const q = commonsQueries('Vaccinium corymbosum', 'flower');
    expect(decodeURIComponent(q[0]!.url)).toContain('incategory:"Vaccinium_corymbosum_(flowers)|Vaccinium_corymbosum_flowers"');
    expect(q).toHaveLength(3);
    expect(decodeURIComponent(q[1]!.url.replace(/\+/g, ' '))).toContain('"Vaccinium corymbosum" flower filemime:image/jpeg');
    expect(decodeURIComponent(q[2]!.url.replace(/\+/g, ' '))).toContain('"Vaccinium corymbosum" flowers filemime:image/jpeg');
    expect(q[0]!.url).toContain('iiurlwidth=800');
    const links = institutionLinks('음나무', 'Kalopanax septemlobus');
    expect(links[0]!.url).toContain('nature.go.kr');
    expect(links[0]!.url).toContain(encodeURIComponent('음나무'));
    expect(links[1]!.url).toContain('nibr.go.kr');
  });
  it('부위 단서·고르기 — 문장의 부위 먼저', () => {
    expect(partsFromText('성목 줄기 껍질이 거북등처럼 갈라집니다')).toEqual(expect.arrayContaining(['bark']));
    expect(partsFromText('겨울 가지치기')).toEqual(['winter']);
    const items: Array<{ part: RefPart; f: string }> = [{ part: 'flower', f: 'f1' }, { part: 'bark', f: 'b1' }, { part: 'bark', f: 'b2' }, { part: 'winter', f: 'w1' }];
    expect(pickCommons(items, ['bark'], 3).map((x) => x.f)).toEqual(['b1', 'b2', 'f1']);
    expect(pickCommons(items, [], 2).map((x) => x.f)).toEqual(['b1', 'f1']);
  });
});

describe('공개 도감 사진 — 받기(가짜 fetch)', () => {
  const okJson = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
  it('부위마다 2장까지 받고 sources.json 에 제목·작가·라이선스·설명 주소·기관 링크를 남긴다(User-Agent 지정)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-commons-'));
    const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('https://upload.wikimedia.org/')) return new Response(JPEG, { status: 200 });
      return okJson(decodeURIComponent(u).includes('incategory') ? { batchcomplete: '' } : BARK_RESULT);
    });
    const src = await fetchCommonsRefs({ dir, folder: '감나무', nameKo: '감나무', latin: 'Diospyros kaki', ownRefs: ['refs/감나무/01.jpg'], deps: { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} }, now: () => new Date('2026-10-23T00:00:00Z') });
    const bark = src.commons.filter((c) => c.part === 'bark');
    expect(bark.map((c) => c.file)).toEqual(['refs/감나무/commons-bark-1.jpg', 'refs/감나무/commons-bark-2.jpg']);
    expect(bark[0]).toMatchObject({ title: 'File:Diospyros kaki bark.jpg', author: 'Kenpei', license: 'CC BY-SA 2.5' });
    expect(fs.existsSync(path.join(dir, 'refs/감나무/commons-bark-1.jpg'))).toBe(true);
    expect(src.commons.every((c) => c.title.includes('kaki') || c.title.includes('Persimmon'))).toBe(true);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'refs/감나무/sources.json'), 'utf8'));
    expect(saved.latin).toBe('Diospyros kaki');
    expect(saved.missing).toEqual(['bark', 'flower', 'winter', 'seedling']);
    expect(saved.commons[0].license).toBe('CC BY-SA 2.5');
    expect(saved.institutions.map((x: { url: string }) => x.url).join(' ')).toMatch(/nature\.go\.kr.*nibr\.go\.kr/);
    expect(saved.note).toContain('내부 대조용');
    const init = fetch.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(COMMONS_UA);
    // 다시 돌면 받은 것을 그대로 — Commons 를 다시 부르지 않는다
    fetch.mockClear();
    const again = await fetchCommonsRefs({ dir, folder: '감나무', nameKo: '감나무', latin: 'Diospyros kaki', ownRefs: ['refs/감나무/01.jpg'], deps: { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} } });
    expect(again.commons.length).toBe(src.commons.length);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('실패해도 던지지 않는다 — 예외·깨진 JSON·429(그 뒤 호출 중단)·학명 없음', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-commons-fail-'));
    const boom = vi.fn(async () => { throw new Error('network down'); });
    const a = await fetchCommonsRefs({ dir, folder: 'a', nameKo: '가', latin: 'Diospyros kaki', ownRefs: [], deps: { fetch: boom as unknown as typeof fetch, sleep: async () => {} } });
    expect(a.commons).toEqual([]);
    const bad = vi.fn(async () => new Response('<html>oops</html>', { status: 200 }));
    expect((await fetchCommonsRefs({ dir, folder: 'b', nameKo: '나', latin: 'Diospyros kaki', ownRefs: [], deps: { fetch: bad as unknown as typeof fetch, sleep: async () => {} } })).commons).toEqual([]);
    const limited = vi.fn(async () => new Response('', { status: 429 }));
    const session = { calls: 0 };
    const c = await fetchCommonsRefs({ dir, folder: 'c', nameKo: '다', latin: 'Diospyros kaki', ownRefs: [], deps: { fetch: limited as unknown as typeof fetch, sleep: async () => {} }, session });
    expect(c.skipped).toContain('429');
    expect(limited).toHaveBeenCalledTimes(1);
    await fetchCommonsRefs({ dir, folder: 'd', nameKo: '라', latin: 'Vaccinium corymbosum', ownRefs: [], deps: { fetch: limited as unknown as typeof fetch, sleep: async () => {} }, session });
    expect(limited).toHaveBeenCalledTimes(1); // 같은 편 다음 수종은 부르지 않는다
    const none = await fetchCommonsRefs({ dir, folder: 'e', nameKo: '대추나무', latin: undefined, ownRefs: [], deps: { fetch: boom as unknown as typeof fetch } });
    expect(none.skipped).toContain('학명 없음');
    expect(none.institutions).toHaveLength(2);
  });
  it('prepareSpecies — 내장 프리셋 학명으로 받아 index.json commons 에, 묶음 표는 문장 부위(껍질) 사진을 ext 로', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-species-commons-'));
    const script = { heroSpecies: '감나무', species: ['감나무'], chapters: [{ id: 'a', title: 't', species: ['감나무'], segments: [{ id: 'a-01', narration: '감나무 껍질.' }] }] };
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://upload.wikimedia.org/')) return new Response(JPEG, { status: 200 });
      const d = decodeURIComponent(u);
      if (d.includes('incategory') && d.includes('(flowers)')) return okJson(api(page(1, 'File:Diospyros kaki kz3.jpg', { cats: 'Diospyros kaki (flowers)', license: 'CC BY-SA 4.0' })));
      return okJson(d.includes('bark') && !d.includes('incategory') ? BARK_RESULT : { batchcomplete: '' });
    });
    const ix = await prepareSpecies({
      dir, script, media: [], sourceText: '', repo: REPO, llm: (async () => null) as unknown as LlmJSON, model: 'm', ffmpeg: async () => {},
      commons: { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} }, now: () => new Date('2026-10-23T00:00:00Z'),
    });
    const e = ix.species[0]!;
    expect(e.latin).toBe('Diospyros kaki');
    expect(e.refs).toEqual([]);
    expect(e.commons?.map((c) => `${c.part}:${c.license}`)).toEqual(['bark:CC BY-SA 2.5', 'bark:CC BY-SA 2.5', 'flower:CC BY-SA 4.0']);
    const b = batchSpecies(ix, ['감나무'], (r) => r, '오래된 감나무 줄기 껍질이 갈라집니다');
    expect(b[0]!.ext?.[0]).toEqual({ part: 'bark', file: 'refs/감나무/commons-bark-1.jpg' });
    expect(batchSpecies(ix, ['감나무'], (r) => r, '꽃이 핍니다')[0]!.ext?.[0]?.part).toBe('flower');
  });
});

describe('가드 — 내부 대조용 사진은 렌더 스테이징에 들어가지 않는다', () => {
  it('isInternalRef — refs/** · commons-* 만', () => {
    expect(isInternalRef('/data/longform/ep/refs/감나무/01.jpg')).toBe(true);
    expect(isInternalRef('refs/감나무/commons-bark-1.jpg')).toBe(true);
    expect(isInternalRef('/x/commons-bark-1.jpg')).toBe(true);
    expect(isInternalRef('/data/longform/ep/clips/s001.mp4')).toBe(false);
    expect(isInternalRef('/data/longform/ep/audio/a.mp3')).toBe(false);
  });
  it('stagePublic 은 refs 를 거절, 보통 파일은 링크', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-guard-'));
    fs.mkdirSync(path.join(dir, 'refs', '감나무'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'refs', '감나무', 'commons-bark-1.jpg'), JPEG);
    fs.writeFileSync(path.join(dir, 'a.mp3'), 'a');
    fs.mkdirSync(path.join(dir, 'pub'));
    expect(stagePublic(path.join(dir, 'refs', '감나무', 'commons-bark-1.jpg'), path.join(dir, 'pub', 'x.jpg'))).toBe(false);
    expect(stagePublic(path.join(dir, 'a.mp3'), path.join(dir, 'pub', 'a.mp3'))).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'pub'))).toEqual(['a.mp3']);
  });
  it('renderEpisodeFull 스테이징 — 끼움 카드 배정이 refs 를 가리켜도 public 에 복사하지 않는다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-guard-render-'));
    for (const d of ['audio', 'clips', 'scenes', 'refs/감나무']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, 'audio', 's1.mp3'), 'a');
    fs.writeFileSync(path.join(dir, 'clips', 'clipA.mp4'), 'v');
    fs.writeFileSync(path.join(dir, 'refs/감나무/01.jpg'), JPEG);
    fs.writeFileSync(path.join(dir, 'refs/감나무/commons-bark-1.jpg'), JPEG);
    const seg = (id: string) => ({ id, chapter: 'intro', chapterTitle: '시작', narration: '감나무 껍질.', audio: 's1.mp3', startFrame: 0, frames: 90, captions: [], shot: { segId: id, cardOnly: true } });
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ segments: [seg('s1'), { ...seg('s2'), startFrame: 90 }], chapterStarts: [], totalFrames: 180 }));
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ title: '시험', chapters: [{ id: 'intro', title: '시작', species: ['감나무'], segments: [{ id: 's1', narration: '감나무 껍질.' }, { id: 's2', narration: '감나무 껍질.' }] }] }));
    fs.writeFileSync(path.join(dir, 'scenes', 'insets.json'), JSON.stringify({
      s1: { src: 'clipA.mp4', startFrom: 0, durationInFrames: 30 },
      s2: { src: '../refs/감나무/commons-bark-1.jpg', startFrom: 0, durationInFrames: 30 },
    }));
    let staged: string[] = [];
    const deps = {
      bundle: async ({ publicDir }: { publicDir: string }) => { staged = fs.readdirSync(publicDir, { recursive: true }).map(String); throw new Error('stop'); },
      renderMedia: async () => {}, renderStill: async () => {}, ffmpeg: async () => {}, probe: async () => 1,
    } as unknown as RenderDeps;
    await expect(renderEpisodeFull(dir, { deps, style: 'B', entryPoint: 'unused', repo: REPO })).rejects.toThrow('stop');
    expect(staged.sort()).toEqual(['clipA.mp4', 's1.mp3']);
    expect(staged.some((f) => f.includes('refs') || f.includes('commons-') || f.endsWith('.jpg'))).toBe(false);
  });
});
