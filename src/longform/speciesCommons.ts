/**
 * 공개 도감 사진(2026-10-23 사장님 결정 — "실촬영이 없어 실물과 대조하지 못할 경우 공신력 있는 기관의 이미지를 활용").
 *
 * 우리 실촬영 프레임(refs/<수종>/NN.jpg)이 보여 주지 못하는 부위만 Wikimedia Commons(자유 이용 허락 사진)에서 학명으로 찾아
 * refs/<수종>/commons-<부위>-N.jpg 로 받고, 출처(제목·작가·라이선스·설명 페이지)를 refs/<수종>/sources.json 에 남긴다.
 * 국가생물종지식정보시스템·국립생물자원관은 저작권 때문에 받지 않는다 — 사람이 확인할 검색 링크만 적는다.
 *
 * ★ 내부 대조용만 — 디자이너·리뷰어가 형태를 비교할 때만 본다. 영상·썸네일·렌더 스테이징(public)에 절대 들어가지 않는다
 *   (render.ts·scenePreview.ts 가 isInternalRef 로 막고, 장면 파일은 sceneLint 가 이미지 태그·staticFile 을 막는다).
 *
 * 걸러 내기(엄격): 파일 제목이나 분류에 정확한 학명(예: 'Diospyros kaki' — 'Diospyros virginiana' 는 아님)이 있어야 하고,
 * JPEG 사진만(책 스캔·도판·표본·지도 제외), 부위 낱말이 제목·분류·설명에 있어야 한다. 부위당 2장까지, 썸네일 폭 800.
 * 실패는 전부 조용히 넘어간다(fail-open) — 429(요청 과다)를 한 번 받으면 이 편은 Commons 를 더 부르지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const COMMONS_UA = 'AICC-longform-research/1.0 (internal botanical reference lookup; not redistributed)';
export const COMMONS_PER_PART = 2;
export const COMMONS_THUMB_W = 800;
export const SOURCES_FILE = 'sources.json';
/** 요청 사이 간격(ms) — Commons 는 빠른 연속 요청에 429 를 준다. */
export const COMMONS_GAP_MS = 400;
const TIMEOUT_MS = 20_000;

export type RefPart = 'leaf' | 'flower' | 'fruit' | 'bark' | 'habit' | 'winter' | 'seedling';
export const PARTS_ALL: readonly RefPart[] = ['bark', 'flower', 'winter', 'seedling', 'leaf', 'fruit', 'habit'];
export const PART_KO: Record<RefPart, string> = { leaf: '잎', flower: '꽃', fruit: '열매', bark: '수피(성목 껍질)', habit: '수형', winter: '겨울 모습', seedling: '묘목·어린나무' };

/** 부위 낱말(영어 + Commons 에 흔한 다른 말). 검색어·통과 검사 둘 다. */
const PART_WORDS: Record<RefPart, string[]> = {
  bark: ['bark', 'trunk', 'rinde', 'stamm', 'écorce', 'corteza', 'tronco', 'corteccia'],
  flower: ['flower', 'flowers', 'blossom', 'bloom', 'flores', 'blüte', 'fleur'],
  fruit: ['fruit', 'fruits', 'berry', 'berries', 'frucht', 'fruto'],
  leaf: ['leaf', 'leaves', 'foliage', 'blatt', 'blätter', 'feuille', 'hoja'],
  habit: ['tree', 'trees', 'habit', 'habitus', 'shrub', 'baum', 'arbre', 'árbol'],
  winter: ['winter', 'leafless', 'dormant', 'invierno', 'hiver', 'hivern', 'inverno'],
  seedling: ['seedling', 'seedlings', 'sapling', 'saplings', 'sämling', 'plántula'],
};
/** Commons 분류 이름 관례(있으면 정확도가 높다) — 학명 뒤에 붙는다. */
const PART_CATS: Record<RefPart, string[]> = {
  bark: ['(bark)', '- bark', 'bark', '(trunks)', 'trunks'],
  flower: ['(flowers)', 'flowers'],
  fruit: ['(fruit)', '(fruits)', 'fruit', 'fruits'],
  leaf: ['(leaves)', 'leaves'],
  habit: ['(habitus)', 'trees', '(habit)', 'shrubs'],
  winter: ['in winter', '(winter)'],
  seedling: ['(seedlings)', 'seedlings'],
};
/** 사진이 아닌 것(책 스캔·도판·표본·지도·현미경). */
const NOT_PHOTO = /\b(illustration|illustrations|drawing|plate|tafel|herbarium|specimen|scan|scans|book|books|page|bhl|biodiversity heritage library|catalog|catalogue|map|distribution|microscop\w*|diagram|painting|engraving|lithograph|stamp|logo|icon|svg)\b|köhler|flora von|\(ia /i;

export interface CommonsImage {
  part: RefPart;
  /** 편 폴더 기준 상대 경로(refs/<수종>/commons-<부위>-N.jpg). */
  file: string;
  title: string;
  author: string;
  license: string;
  licenseUrl?: string;
  descriptionUrl: string;
}
export interface InstitutionLink { name: string; url: string; note: string }
export interface SpeciesSources {
  at: string;
  nameKo: string;
  latin?: string;
  /** 우리 실촬영 프레임(편 폴더 기준)과 그것이 대신하는 부위. */
  own: { files: string[]; parts: RefPart[] };
  /** 실촬영으로 볼 수 없는 부위(Commons 로 찾은 것). */
  missing: RefPart[];
  commons: CommonsImage[];
  institutions: InstitutionLink[];
  skipped?: string;
  note: string;
}

export const INTERNAL_NOTE = '내부 대조용 — 디자이너·리뷰어 형태 비교에만. 영상·썸네일·게시물에 쓰지 않는다(렌더 스테이징 금지). 공개 도감 사진은 각 라이선스 조건(저작자 표시 등)을 따른다.';

/** 이 경로가 내부 대조용 사진(refs/** 또는 commons-*)인가(순수) — 렌더 스테이징 가드가 쓴다. */
export function isInternalRef(p: string): boolean {
  const segs = p.split(/[\\/]+/);
  return segs.includes('refs') || /^commons-/.test(segs[segs.length - 1] ?? '');
}

/** 실촬영으로 볼 수 없는 부위(순수) — 실촬영 프레임이 있으면 잎·열매·수형은 그것으로, 수피(성목)·꽃·겨울 모습·묘목은 늘 비어 있다. */
export function missingParts(ownRefCount: number): RefPart[] {
  return ownRefCount > 0 ? ['bark', 'flower', 'winter', 'seedling'] : [...PARTS_ALL];
}

/** 학명 정리(순수) — 'Diospyros kaki Thunb.' → 'Diospyros kaki'. 속명 + 종소명이 아니면 null. */
export function cleanLatin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^([A-Z][a-z]+)\s+(×\s*)?([a-z][a-z-]+)/);
  return m ? `${m[1]} ${m[2] ? '× ' : ''}${m[3]}` : null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 정확한 학명 일치(순수) — 공백·밑줄 둘 다, 대소문자 무시, 뒤에 다른 종소명이 이어지지 않게. */
export function hasExactLatin(text: string, latin: string): boolean {
  const [g, ...rest] = latin.split(/\s+/);
  const re = new RegExp(`(^|[^A-Za-z])${esc(g!)}[ _]+${rest.map(esc).join('[ _]+')}(?![a-z])`, 'i');
  return re.test(text);
}

export const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

interface ApiPage { title?: string; index?: number; imageinfo?: Array<{ mime?: string; thumburl?: string; descriptionurl?: string; width?: number; extmetadata?: Record<string, { value?: unknown }> }> }
export interface Candidate { title: string; thumbUrl: string; descriptionUrl: string; author: string; license: string; licenseUrl?: string }

/** API 응답 → 통과한 후보(순수, 검색 순서). 엄격 검사: 정확한 학명 · JPEG · 사진 · 부위 낱말 · 라이선스 있음. */
export function filterCandidates(raw: unknown, latin: string, part: RefPart, viaCategory = false): Candidate[] {
  const pages = Object.values(((raw as { query?: { pages?: Record<string, ApiPage> } } | null)?.query?.pages) ?? {}) as ApiPage[];
  const out: Candidate[] = [];
  for (const p of pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const ii = p.imageinfo?.[0];
    const title = typeof p.title === 'string' ? p.title : '';
    if (!ii || !title || ii.mime !== 'image/jpeg' || typeof ii.thumburl !== 'string' || typeof ii.descriptionurl !== 'string') continue;
    const meta = (k: string) => { const v = ii.extmetadata?.[k]?.value; return typeof v === 'string' ? v : ''; };
    const cats = meta('Categories');
    const hay = `${title}|${cats.replace(/\|/g, ' | ')}`;
    if (!hasExactLatin(hay, latin)) continue;
    if (NOT_PHOTO.test(`${title} ${cats}`)) continue;
    const words = PART_WORDS[part];
    const text = `${title} ${cats} ${stripHtml(meta('ImageDescription'))}`.toLowerCase();
    if (!viaCategory && !words.some((w) => new RegExp(`(^|[^a-zà-ü])${esc(w)}([^a-zà-ü]|$)`, 'i').test(text))) continue;
    const license = stripHtml(meta('LicenseShortName'));
    if (!license) continue;
    const licenseUrl = stripHtml(meta('LicenseUrl'));
    out.push({ title, thumbUrl: ii.thumburl, descriptionUrl: ii.descriptionurl, author: stripHtml(meta('Artist')).slice(0, 200) || '(작가 표기 없음)', license, ...(licenseUrl ? { licenseUrl } : {}) });
  }
  return out;
}

const PROPS = { prop: 'imageinfo', iiprop: 'url|extmetadata|mime|size', iiurlwidth: String(COMMONS_THUMB_W), iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|Categories|ImageDescription' };
/** 분류 검색 → 본문 검색 순서의 API 주소(순수). */
export function commonsQueries(latin: string, part: RefPart): Array<{ url: string; viaCategory: boolean }> {
  const cats = PART_CATS[part].map((c) => `${latin} ${c}`.replace(/\s+/g, '_')).join('|');
  const mk = (q: string) => `${COMMONS_API}?${new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '20', gsrsearch: q, ...PROPS }).toString()}`;
  // 본문 검색은 낱말 하나씩(Cirrus 의 OR 는 드문 낱말이 끼면 결과가 0 이 된다 — 2026-10-23 실측). 2장이 차면 거기서 멈춘다.
  return [
    { url: mk(`incategory:"${cats}" filemime:image/jpeg`), viaCategory: true },
    ...PART_WORDS[part].slice(0, 2).map((w) => ({ url: mk(`"${latin}" ${w} filemime:image/jpeg`), viaCategory: false })),
  ];
}

/** 국가 기관 검색 링크(순수) — 내려받지 않는다(저작권), 사람이 형태 기술을 확인하는 용도. */
export function institutionLinks(nameKo: string, latin?: string): InstitutionLink[] {
  return [
    { name: '국가생물종지식정보시스템(국립수목원) 식물도감', url: `https://www.nature.go.kr/kbi/plant/pilbk/selectPlantPilbkGnrlList.do?searchWrd=${encodeURIComponent(nameKo)}`, note: '검색 결과에서 수종을 열어 형태 기술·사진 확인(내려받기 금지)' },
    { name: '국립생물자원관 한반도의 생물다양성', url: 'https://species.nibr.go.kr/', note: `검색창에 '${latin ?? nameKo}' 입력 — 자료 내려받기 금지(링크만)` },
  ];
}

export interface CommonsDeps {
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
}
/** 한 편 동안 공유하는 상태 — 429 를 받으면 그 뒤 수종은 부르지 않는다. */
export interface CommonsSession { blocked?: string; calls: number }

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 한 수종 — 빠진 부위마다 Commons 에서 2장까지 받아 refs/<folder>/commons-<부위>-N.jpg + sources.json.
 * 이미 sources.json 에 같은 학명으로 받은 사진이 있고 파일이 남아 있으면 다시 부르지 않는다. 던지지 않는다.
 */
export async function fetchCommonsRefs(o: {
  dir: string; folder: string; nameKo: string; latin?: string | null; ownRefs: readonly string[];
  deps?: CommonsDeps; session?: CommonsSession; signal?: AbortSignal; now?: () => Date;
}): Promise<SpeciesSources> {
  const outDir = path.join(o.dir, 'refs', o.folder);
  const latin = cleanLatin(o.latin) ?? undefined;
  const missing = missingParts(o.ownRefs.length);
  const src: SpeciesSources = {
    at: (o.now ?? (() => new Date()))().toISOString(), nameKo: o.nameKo, ...(latin ? { latin } : {}),
    own: { files: [...o.ownRefs], parts: o.ownRefs.length ? ['leaf', 'fruit', 'habit'] : [] },
    missing, commons: [], institutions: institutionLinks(o.nameKo, latin), note: INTERNAL_NOTE,
  };
  const save = () => { try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, SOURCES_FILE), JSON.stringify(src, null, 2)); } catch { /* 기록만 잃는다 */ } };
  const log = o.deps?.log ?? (() => {});
  if (!latin) { src.skipped = '학명 없음(프리셋 없음) — 공개 도감 사진 생략, 기관 링크만'; save(); return src; }
  // 지난번 받은 것 — 같은 학명이고 파일이 남아 있으면 그대로(Commons 를 다시 부르지 않는다).
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(outDir, SOURCES_FILE), 'utf8')) as SpeciesSources;
    // 지난번이 429·취소로 중간에 끊겼으면(skipped) 다시 받는다.
    const keep = prev.latin === latin && !prev.skipped ? prev.commons.filter((c) => missing.includes(c.part) && fs.existsSync(path.join(o.dir, c.file))) : [];
    if (keep.length) { src.commons = keep; save(); return src; }
  } catch { /* 처음 */ }
  if (!o.deps?.fetch) { src.skipped = 'Commons 조회 부품 없음'; save(); return src; }
  const session = o.session ?? { calls: 0 };
  const { fetch: f } = o.deps;
  const sleep = o.deps.sleep ?? sleepReal;
  const call = async (url: string): Promise<Response | null> => {
    if (session.blocked || o.signal?.aborted) return null;
    if (session.calls++ > 0) await sleep(COMMONS_GAP_MS);
    try {
      // AbortSignal.any 는 Node 20.3+ — 없으면 시간 제한만(취소는 다음 호출 전에 본다).
      const t = AbortSignal.timeout(TIMEOUT_MS);
      const signal = o.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([t, o.signal]) : t;
      const r = await f(url, { headers: { 'User-Agent': COMMONS_UA, 'Api-User-Agent': COMMONS_UA }, signal });
      if (r.status === 429) { session.blocked = 'Commons 429(요청 과다) — 이 편은 더 부르지 않음'; log(`[수종 도감] ${session.blocked}`); return null; }
      return r.ok ? r : null;
    } catch { return null; }
  };
  for (const part of missing) {
    if (session.blocked || o.signal?.aborted) break;
    const picked: Candidate[] = [];
    for (const q of commonsQueries(latin, part)) {
      if (picked.length >= COMMONS_PER_PART) break;
      const r = await call(q.url);
      if (!r) continue;
      let json: unknown;
      try { json = await r.json(); } catch { continue; }
      for (const c of filterCandidates(json, latin, part, q.viaCategory)) {
        if (picked.length >= COMMONS_PER_PART) break;
        if (!picked.some((p) => p.title === c.title) && !src.commons.some((p) => p.title === c.title)) picked.push(c);
      }
    }
    let n = 0;
    for (const c of picked) {
      const r = await call(c.thumbUrl);
      if (!r) continue;
      try {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) continue; // JPEG 아님(오류 페이지 등)
        const rel = path.join('refs', o.folder, `commons-${part}-${++n}.jpg`);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(o.dir, rel), buf);
        src.commons.push({ part, file: rel, title: c.title, author: c.author, license: c.license, ...(c.licenseUrl ? { licenseUrl: c.licenseUrl } : {}), descriptionUrl: c.descriptionUrl });
      } catch { /* 그 장만 잃는다 */ }
    }
  }
  if (session.blocked) src.skipped = session.blocked;
  save();
  log(`[수종 도감] ${o.nameKo}(${latin}) — 빠진 부위 ${missing.map((p) => PART_KO[p]).join('·')} → 공개 도감 사진 ${src.commons.length}장`);
  return src;
}

/** 문장에서 부위 단서(순수) — 묶음 장면·검토 묶음이 무엇을 그리는지에 맞는 도감 사진을 앞에 둔다. */
export function partsFromText(text: string): RefPart[] {
  const t = text.replace(/\s/g, '');
  const out: RefPart[] = [];
  const add = (p: RefPart, re: RegExp) => { if (re.test(t) && !out.includes(p)) out.push(p); };
  add('bark', /껍질|수피|줄기|몸통|밑동|거북등/);
  add('flower', /꽃|개화|암꽃|수꽃/);
  add('winter', /겨울|휴면|잎이?진|낙엽후|가지치기|전정|월동|짚/);
  add('seedling', /묘목|어린나무|실생|새싹|접목|대목/);
  add('fruit', /열매|과실|수확|익[는은]|홍시|곶감|단감|떫은감/);
  add('leaf', /잎|단풍|낙엽/);
  add('habit', /수형|나무모양|키가|높이|다자란|성목/);
  return out;
}

/** 도감 사진 고르기(순수) — 단서 부위 먼저(부위당 1장씩 돌아가며), 그다음 나머지 부위. max 장. */
export function pickCommons<T extends { part: RefPart }>(items: readonly T[], hint: readonly RefPart[], max: number): T[] {
  if (max <= 0 || !items.length) return [];
  const order = [...hint, ...PARTS_ALL.filter((p) => !hint.includes(p))];
  const byPart = order.map((p) => items.filter((x) => x.part === p)).filter((a) => a.length);
  const out: T[] = [];
  // 단서 부위는 2장까지 먼저, 그 밖은 한 장씩 돌아가며.
  for (const p of hint) for (const x of items.filter((y) => y.part === p)) if (out.length < max && !out.includes(x)) out.push(x);
  for (let round = 0; out.length < max && round < COMMONS_PER_PART; round++) {
    for (const arr of byPart) { const x = arr[round]; if (x && out.length < max && !out.includes(x)) out.push(x); }
  }
  return out;
}
