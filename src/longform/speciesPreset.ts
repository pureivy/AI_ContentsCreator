/**
 * 편 수종 형태 프리셋 + 실물 대조용 사진(2026-10-23 사장님 결정 — 식물은 실물 형태를 따른 종 프리셋으로만 그린다).
 *
 * 경로 선택(편 폴더 안, 키트 밖): 키트의 speciesOf(remotion/longform/fullscreen/species/presets.ts)는 문자열 id 를 키트 안 고정 표에서만
 * 찾는다 — 저장소 species/ 아래에 JSON 을 더 넣어도 문자열로는 닿지 않고, 운영 중에 저장소 소스 폴더를 고쳐 쓰는 것도 피한다.
 * 대신 키트 부품은 species 에 프로필 객체도 받는다. 그래서 편마다:
 *   <편>/species/<id>.json   서다인(research_lead)이 쓴 프리셋(엄격 검사 통과분)
 *   <편>/species/index.json  편 수종마다 프리셋 출처(키트 내장·이 편 전용·일반형)·신뢰도·실물 사진
 *   <편>/scenes/_species.ts  EP_SPECIES = { apple: {…} } — _kit.ts 가 다시 내보낸다 → 장면은 species={EP_SPECIES.apple}
 *   <편>/refs/<수종>/NN.jpg  보관소 실촬영에서 뽑은 3~6장 — 디자이너 묶음·리뷰어에게 '실물 대조용 사진'
 *   <편>/refs/<수종>/commons-<부위>-N.jpg + sources.json  실촬영이 못 보여 주는 부위(수피·꽃·겨울·묘목 …)의 공개 도감 사진(Wikimedia Commons,
 *                            출처·라이선스 기록) + 국가 기관 검색 링크 — speciesCommons.ts. 내부 대조용만(영상·썸네일 금지).
 * 키트 내장 프리셋은 species/*.json 을 읽어서 안다(src 는 remotion/ 을 import 하지 않는다 — 루트 tsc rootDir=src).
 * 검사는 키트 checkSpeciesProfile 보다 엄격하다(열거값까지) — 모르는 값이면 키트가 조용히 다른 모양을 그린다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SCENE_DIR, SPECIES_MODULE, importPath, writeIfChanged } from './sceneFiles';
import { pickHeroSpecies, speciesNorm, type LongformScript } from './script';
import type { MediaItem } from './footage';
import type { LlmJSON } from './writer';
import { fetchCommonsRefs, partsFromText, pickCommons, type CommonsDeps, type CommonsSession, type RefPart } from './speciesCommons';

export const PRESET_DIR = 'species';
export const REFS_DIR = 'refs';
/** 편당 프리셋을 챙길 수종 수 상한(주인공 + 장 수종 + 낭독에 나오는 편 수종). */
export const SPECIES_MAX = 5;
/** 수종당 실물 사진 상한. */
export const REFS_MAX = 6;

const kitSpeciesDir = (repo: string): string => path.join(repo, 'remotion', 'longform', 'fullscreen', 'species');

// ── 엄격 검사(schema.ts 의 타입과 같은 열거값 — 키트 내장 JSON 이 통과하는지 테스트가 지킨다)
const ENUMS = {
  'leaf.shape': ['ovate', 'elliptic', 'lanceolate', 'obovate', 'orbicular', 'cordate', 'palmate', 'pinnate'],
  'leaf.margin': ['entire', 'serrate', 'doubleSerrate', 'undulate', 'lobed'],
  'leaf.venation': ['pinnate', 'palmate'],
  'leaf.arrangement': ['alternate', 'opposite', 'whorled'],
  'leaf.tip': ['acuminate', 'acute', 'obtuse', 'rounded'],
  'leaf.base': ['cuneate', 'rounded', 'cordate', 'truncate'],
  'flower.shape': ['urceolate', 'open', 'tubular'],
  'flower.petalShape': ['round', 'oval', 'notched', 'pointed'],
  'flower.calyx': ['small', 'large', 'none'],
  'flower.stamens': ['many', 'few', 'hidden'],
  'flower.inflorescence': ['solitary', 'corymb', 'raceme', 'panicle'],
  'flower.position': ['axil', 'tip', 'oldWood'],
  'fruit.type': ['persimmon', 'pome', 'pear', 'drupe', 'berry', 'jujube', 'chestnut'],
  'fruit.bearing': ['single', 'cluster'],
  'habit.form': ['upright', 'spreading', 'round', 'weeping', 'shrub'],
  'habit.bark': ['blocky', 'furrowed', 'smooth', 'peeling'],
} as const;
const OPTIONAL = new Set(['flower.petalShape']);
const NUMS: Record<string, [number, number, boolean?]> = {
  'leaf.widthRatio': [0.05, 1.5], 'leaf.petiole': [0, 1.5], 'leaf.veins': [1, 20], 'leaf.lobes': [1, 15, true], 'leaf.droop': [0, 1, true],
  'flower.petals': [0, 12], 'flower.sizeCm': [0.1, 30],
  'fruit.ratio': [0.3, 3], 'fruit.clusterN': [1, 200, true],
  'habit.branchAngle': [5, 90], 'habit.apical': [0, 1], 'habit.crownWH': [0.2, 3], 'habit.stems': [1, 20, true],
  leafOutMonth: [1, 12], leafFallMonth: [1, 12],
};
const RANGES: Record<string, [number, number]> = { 'leaf.sizeCm': [0.3, 60], 'fruit.sizeCm': [0.2, 30], 'habit.heightM': [0.2, 40] };
const MONTHS = ['flower.months', 'fruit.months'];
const BOOLS = ['leaf.glossy', 'flower.double', 'flower.nodding'];

const get = (o: unknown, p: string): unknown => p.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** 프리셋 검사(순수) — 문제 목록(빈 배열 = 통과). 열거값·수치 범위·월까지 본다. */
export function checkPreset(x: unknown): string[] {
  const out: string[] = [];
  if (!x || typeof x !== 'object') return ['객체 아님'];
  for (const k of ['id', 'nameKo', 'latin']) if (typeof get(x, k) !== 'string' || !(get(x, k) as string).trim()) out.push(`${k} 없음`);
  const src = get(x, 'sources');
  if (!Array.isArray(src) || !src.every((s) => typeof s === 'string')) out.push('sources 는 문자열 배열');
  for (const part of ['habit', 'leaf', 'flower', 'fruit']) if (!get(x, part) || typeof get(x, part) !== 'object') out.push(`${part} 없음`);
  for (const [p, allowed] of Object.entries(ENUMS)) {
    const v = get(x, p);
    if (v === undefined && OPTIONAL.has(p)) continue;
    if (!(allowed as readonly string[]).includes(v as string)) out.push(`${p}='${String(v)}' — ${allowed.join('|')} 중 하나`);
  }
  for (const [p, [lo, hi, opt]] of Object.entries(NUMS)) {
    const v = get(x, p);
    if (v === undefined && opt) continue;
    if (!isNum(v) || v < lo || v > hi) out.push(`${p}=${String(v)} — ${lo}~${hi} 숫자`);
  }
  for (const [p, [lo, hi]] of Object.entries(RANGES)) {
    const v = get(x, p);
    const [a0, a1] = Array.isArray(v) ? (v as unknown[]) : [];
    if (!Array.isArray(v) || v.length !== 2 || !isNum(a0) || !isNum(a1) || a0 > a1 || a0 < lo || a1 > hi) out.push(`${p} — [최소, 최대] (${lo}~${hi})`);
  }
  for (const p of MONTHS) {
    const v = get(x, p);
    if (!Array.isArray(v) || !v.length || !v.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) out.push(`${p} — 1~12 월 배열`);
  }
  for (const p of BOOLS) { const v = get(x, p); if (v !== undefined && typeof v !== 'boolean') out.push(`${p} — true/false`); }
  return out;
}

/** 키트 내장 프리셋(species/*.json, 일반형 제외) — 이름(정규화) → id. 읽지 못하거나 검사에 떨어진 파일은 뺀다. */
export function builtinPresets(repo: string): Array<{ id: string; nameKo: string; latin?: string }> {
  const dir = kitSpeciesDir(repo);
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out: Array<{ id: string; nameKo: string; latin?: string }> = [];
  for (const f of files) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { id: string; nameKo: string; latin?: string };
      if (p.id !== 'generic' && !checkPreset(p).length) out.push({ id: p.id, nameKo: p.nameKo, ...(p.latin ? { latin: p.latin } : {}) });
    } catch { /* 깨진 파일 — 뺀다 */ }
  }
  return out;
}

/** 프리셋을 챙길 편 수종(순수) — 주인공 → 장 수종(장 순서) → 낭독에 이름이 나오는 편 수종. 이름 겹침(…나무)은 하나로. */
export function episodeSpeciesNames(script: Pick<LongformScript, 'chapters' | 'species' | 'heroSpecies'>, max = SPECIES_MAX): string[] {
  const hero = script.heroSpecies ?? pickHeroSpecies(undefined, script, {});
  const narr = script.chapters.flatMap((c) => c.segments.map((g) => g.narration)).join(' ').replace(/\s/g, '');
  const cands = [...(hero ? [hero] : []), ...script.chapters.flatMap((c) => c.species ?? []), ...(script.species ?? []).filter((sp) => narr.includes(speciesNorm(sp)))];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sp of cands) { const n = speciesNorm(sp); if (!n || seen.has(n)) continue; seen.add(n); out.push(sp); }
  return out.slice(0, max);
}

/** 프리셋 id(순수) — 영문 소문자·숫자, 영문으로 시작. 키트 내장·이미 쓴 id 와 겹치면 숫자를 붙인다. */
export function presetId(raw: unknown, taken: ReadonlySet<string>): string {
  let base = (typeof raw === 'string' ? raw : '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/^[a-z]/.test(base)) base = `sp${base}`;
  base = base.slice(0, 24) || 'sp';
  let id = base;
  for (let k = 2; taken.has(id) || id === 'generic'; k++) id = `${base}${k}`;
  return id;
}

/** 원문에서 그 수종 이름이 나오는 문장(순수) — 형태 기술 근거로 지시문에 넣는다. */
export function speciesSnippets(sourceText: string, nameKo: string, maxChars = 1500): string {
  const n = speciesNorm(nameKo);
  const sents = sourceText.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter((s) => s && s.replace(/\s/g, '').includes(n));
  let out = '';
  for (const s of [...new Set(sents)]) { if (out.length + s.length > maxChars) break; out += `${s}\n`; }
  return out.trim();
}

export type Confidence = 'high' | 'medium' | 'low';
export interface PresetAnswer { id?: unknown; profile?: unknown; confidence?: Record<string, unknown>; basis?: unknown }

/** 서다인(research_lead) 지시문(순수). schemaText = schema.ts 의 타입 부분, example = 키트 감나무 JSON. */
export function presetPrompt(o: { nameKo: string; snippets: string; schemaText: string; example: string; problems?: string[] }): { system: string; user: string } {
  return {
    system: [
      '너는 나무 형태(형태학) 담당 연구원이다. 롱폼 영상의 연필 선화 키트가 이 수종을 실물과 같은 모양으로 그리도록 종 프리셋(JSON)을 만든다.',
      '근거는 국가생물종지식정보시스템·국립수목원 식물도감 같은 공식 형태 기술(엽형·엽연·엽서·꽃·열매·수형·수피)과 아래 원문이다. 원문에 없으면 도감 지식으로 채우되, 확실하지 않은 부분은 confidence 를 낮게 적는다.',
      '추측으로 그럴듯한 값을 만들지 마라 — 모르면 가장 흔한 형태를 고르고 그 부분 confidence 를 low 로. 요청된 JSON 만 출력한다.',
    ].join('\n'),
    user: [
      `[수종] ${o.nameKo}`,
      o.snippets ? `[원문 중 이 수종 문장]\n${o.snippets}` : '[원문 중 이 수종 문장] 없음 — 도감 지식으로.',
      '',
      '[스키마 — 열거값은 이 중에서만]',
      o.schemaText,
      '',
      '[예시 — 감나무 프리셋(키트 내장)]',
      o.example,
      '',
      '[출력] {"id":"영문 소문자 한 낱말(예: apple)","profile":{…스키마 SpeciesProfile 전부 — nameKo 는 위 수종 이름 그대로…},"confidence":{"habit":"high|medium|low","leaf":"…","flower":"…","fruit":"…"},"basis":["근거 한 줄(출처 이름)", "…"]}',
      'latin 은 정확한 학명(속명 종소명 — 예: 감나무 Diospyros kaki, 블루베리 Vaccinium corymbosum, 음나무 Kalopanax septemlobus). 공개 도감 사진을 이 학명으로 찾으므로 비슷한 다른 종 학명을 쓰면 안 된다.',
      'sizeCm·heightM 은 [최소, 최대]. months 는 1~12 정수 배열. leafOutMonth·leafFallMonth 는 잎 나는 달·지는 달(상록이면 4·12).',
      'leaf.sizeCm 은 잎자루 뺀 잎몸 길이, petiole 은 실제 잎자루/잎몸 비(음나무 ≈ 1). 손바닥 잎은 갈래를 shape palmate·lobes 로, 엽연은 톱니 모양(serrate 등)으로 적는다. 줄기·가지에 가시가 있으면 habit.prickles: true.',
      ...(o.problems?.length ? ['', '[지난 답의 검사 문제 — 고쳐서 다시]', ...o.problems.map((p) => `- ${p}`)] : []),
    ].join('\n'),
  };
}

/** schema.ts 의 타입 부분(검사 함수 앞까지) — 지시문용. 못 읽으면 ''. */
export function schemaText(repo: string): string {
  try {
    const src = fs.readFileSync(path.join(kitSpeciesDir(repo), 'schema.ts'), 'utf8');
    const cut = src.indexOf('const isNum');
    return (cut > 0 ? src.slice(0, cut) : src).trim();
  } catch { return ''; }
}

/** 프리셋 한 수종 — 최대 2번(검사 문제를 알려 주고 다시). 실패면 problems. */
export async function authorPreset(o: {
  nameKo: string; sourceText: string; llm: LlmJSON; model: string; schemaText: string; example: string; taken: ReadonlySet<string>; date: string; signal?: AbortSignal;
}): Promise<{ ok: true; id: string; profile: Record<string, unknown>; confidence: Record<'habit' | 'leaf' | 'flower' | 'fruit', Confidence> } | { ok: false; problems: string[] }> {
  const snippets = speciesSnippets(o.sourceText, o.nameKo);
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (o.signal?.aborted) return { ok: false, problems: ['취소됨'] };
    const p = presetPrompt({ nameKo: o.nameKo, snippets, schemaText: o.schemaText, example: o.example, ...(problems.length ? { problems } : {}) });
    const raw = await o.llm<PresetAnswer>(o.model, p.system, p.user, { maxOutputTokens: 3000, ...(o.signal ? { signal: o.signal } : {}) }).catch(() => null);
    if (!raw || typeof raw !== 'object' || !raw.profile || typeof raw.profile !== 'object') { problems = ['profile 객체 없음']; continue; }
    const id = presetId(raw.id ?? (raw.profile as { id?: unknown }).id, o.taken);
    const conf = (k: string): Confidence => { const v = raw.confidence?.[k]; return v === 'high' || v === 'medium' ? v : 'low'; };
    const confidence = { habit: conf('habit'), leaf: conf('leaf'), flower: conf('flower'), fruit: conf('fruit') };
    const basis = (Array.isArray(raw.basis) ? raw.basis : []).filter((b): b is string => typeof b === 'string' && !!b.trim()).map((b) => b.trim().slice(0, 100)).slice(0, 4);
    const low = Object.entries(confidence).filter(([, v]) => v === 'low').map(([k]) => k);
    const profile = {
      ...(raw.profile as Record<string, unknown>), id, nameKo: o.nameKo,
      sources: [...basis, `서다인(research_lead) 작성 ${o.date}${low.length ? ` — 신뢰 낮음: ${low.join('·')}` : ''}`],
    };
    problems = checkPreset(profile);
    if (!problems.length) return { ok: true, id, profile, confidence };
  }
  return { ok: false, problems };
}

/** scenes/_species.ts 내용(순수) — 이 편 전용 프리셋. satisfies 로 키가 고정돼 장면이 없는 id 를 쓰면 타입 검사에서 걸린다. */
export function speciesModuleSource(sceneDir: string, repo: string, presets: ReadonlyArray<{ id: string; profile: Record<string, unknown> }>): string {
  const schema = importPath(sceneDir, path.join(kitSpeciesDir(repo), 'schema.ts'));
  return [
    '// 생성 파일 — 이 편 전용 종 프리셋(서다인 작성·엄격 검사 통과, species/index.json 참고). 손대지 않는다.',
    `import type { SpeciesProfile } from '${schema}';`,
    '',
    `export const EP_SPECIES = {${presets.length ? '\n' : ''}${presets.map((p) => `  ${p.id}: ${JSON.stringify(p.profile)},\n`).join('')}} satisfies Record<string, SpeciesProfile>;`,
    '',
  ].join('\n');
}

/** 실물 사진 ffmpeg 시점(순수) — 파일 수에 따라 파일당 2~4장, 합쳐 max 장. */
export function refPlan(videos: ReadonlyArray<Pick<MediaItem, 'file' | 'seconds'>>, max = REFS_MAX): Array<{ file: string; sec: number }> {
  const v = videos.slice(0, 3);
  const at = v.length >= 3 ? [0.3, 0.7] : v.length === 2 ? [0.2, 0.5, 0.8] : [0.15, 0.4, 0.65, 0.9];
  return v.flatMap((m) => at.map((r) => ({ file: m.file, sec: Math.max(0.1, m.seconds * r) }))).slice(0, max);
}

/** refs/<수종> 폴더 이름(순수). */
export const refFolder = (nameKo: string): string => nameKo.replace(/[\\/:\s]/g, '');

/** refs/<수종>/NN.jpg — 보관소 그 수종 영상(긴 것부터 3개)에서. 편 폴더 기준 상대 경로(만들어진 것만). */
export async function extractRefs(o: { dir: string; nameKo: string; media: readonly MediaItem[]; ffmpeg: (args: string[]) => Promise<void>; signal?: AbortSignal }): Promise<string[]> {
  const n = speciesNorm(o.nameKo);
  const vids = o.media.filter((m) => m.kind === 'video' && m.species && speciesNorm(m.species) === n && m.seconds > 1).sort((a, b) => b.seconds - a.seconds);
  if (!vids.length) return [];
  const folder = refFolder(o.nameKo);
  const outDir = path.join(o.dir, REFS_DIR, folder);
  fs.mkdirSync(outDir, { recursive: true });
  const out: string[] = [];
  let i = 0;
  for (const p of refPlan(vids)) {
    if (o.signal?.aborted) break;
    const rel = path.join(REFS_DIR, folder, `${String(++i).padStart(2, '0')}.jpg`);
    const file = path.join(o.dir, rel);
    try {
      await o.ffmpeg(['-v', 'error', '-y', '-ss', p.sec.toFixed(2), '-i', p.file, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '3', file]);
      if (fs.existsSync(file)) out.push(rel);
    } catch { /* 그 장만 잃는다 */ }
  }
  return out;
}

export interface SpeciesEntry {
  nameKo: string;
  /** builtin = 키트 내장, episode = 이 편 전용(서다인), generic = 일반형(프리셋 없음 — 보고). */
  source: 'builtin' | 'episode' | 'generic';
  id: string;
  /** 장면 파일에 쓸 그대로 — species="persimmon" · species={EP_SPECIES.apple} · species="generic". */
  use: string;
  confidence?: Record<string, Confidence>;
  why?: string;
  /** 편 폴더 기준 상대 경로 — 우리 실촬영 프레임. */
  refs: string[];
  /** 학명(프리셋) — 공개 도감 검색 키. */
  latin?: string;
  /** 공개 도감 사진(Wikimedia Commons, refs/<수종>/sources.json 에 출처·라이선스) — 실촬영이 못 보여 주는 부위만. 내부 대조용. */
  commons?: Array<{ part: RefPart; file: string; license: string }>;
}
export interface SpeciesIndex { at: string; hero?: string; species: SpeciesEntry[] }

/** species/index.json 읽기 — 없거나 깨졌으면 null. */
export function loadSpeciesIndex(dir: string): SpeciesIndex | null {
  try { return JSON.parse(fs.readFileSync(path.join(dir, PRESET_DIR, 'index.json'), 'utf8')) as SpeciesIndex; } catch { return null; }
}

/**
 * 수종 형태 단계 — 편 수종마다 키트 내장 프리셋이 있으면 그것, 없으면 서다인이 프리셋을 쓰고(검사 통과분만) 실물 사진을 뽑는다.
 * 무엇이 실패해도 던지지 않는다 — 그 수종은 일반형(generic)으로 그리고 index.json 에 사유를 남긴다.
 */
export async function prepareSpecies(o: {
  dir: string; script: Pick<LongformScript, 'chapters' | 'species' | 'heroSpecies'>; media: readonly MediaItem[]; sourceText: string; repo: string;
  llm: LlmJSON; model: string; ffmpeg: (args: string[]) => Promise<void>; signal?: AbortSignal; log?: (m: string) => void; now?: () => Date;
  /** 공개 도감 사진 조회 부품(fetch) — 없으면 Commons 를 부르지 않고 sources.json 에 기관 링크만. */
  commons?: CommonsDeps;
}): Promise<SpeciesIndex> {
  const log = o.log ?? (() => {});
  const now = (o.now ?? (() => new Date()))();
  const hero = o.script.heroSpecies ?? pickHeroSpecies(undefined, o.script, {});
  const builtin = builtinPresets(o.repo);
  const taken = new Set(builtin.map((b) => b.id));
  const schema = schemaText(o.repo);
  let example = '';
  try { example = fs.readFileSync(path.join(kitSpeciesDir(o.repo), 'persimmon.json'), 'utf8'); } catch { /* 예시 없이 */ }
  const presetDir = path.join(o.dir, PRESET_DIR);
  fs.mkdirSync(presetDir, { recursive: true });
  const episode: Array<{ id: string; profile: Record<string, unknown> }> = [];
  const entries: SpeciesEntry[] = [];
  const session: CommonsSession = { calls: 0 };
  for (const nameKo of episodeSpeciesNames(o.script)) {
    if (o.signal?.aborted) break;
    const b = builtin.find((x) => speciesNorm(x.nameKo) === speciesNorm(nameKo));
    let entry: Omit<SpeciesEntry, 'refs'>;
    if (b) entry = { nameKo, source: 'builtin', id: b.id, use: `species="${b.id}"`, ...(b.latin ? { latin: b.latin } : {}) };
    else {
      const r = await authorPreset({ nameKo, sourceText: o.sourceText, llm: o.llm, model: o.model, schemaText: schema, example, taken, date: now.toISOString().slice(0, 10), ...(o.signal ? { signal: o.signal } : {}) });
      if (r.ok) {
        taken.add(r.id);
        episode.push({ id: r.id, profile: r.profile });
        fs.writeFileSync(path.join(presetDir, `${r.id}.json`), JSON.stringify(r.profile, null, 2));
        entry = { nameKo, source: 'episode', id: r.id, use: `species={EP_SPECIES.${r.id}}`, confidence: r.confidence, ...(typeof r.profile.latin === 'string' ? { latin: r.profile.latin } : {}) };
        log(`[수종] ${nameKo} 프리셋 작성(${r.id}) · 신뢰 ${Object.entries(r.confidence).map(([k, v]) => `${k} ${v}`).join(' ')}`);
      } else {
        entry = { nameKo, source: 'generic', id: 'generic', use: 'species="generic"', why: `프리셋 작성 실패: ${r.problems.slice(0, 3).join(' / ')}` };
        log(`[수종] ${nameKo} 일반형 — ${entry.why}`);
      }
    }
    const refs = await extractRefs({ dir: o.dir, nameKo, media: o.media, ffmpeg: o.ffmpeg, ...(o.signal ? { signal: o.signal } : {}) }).catch(() => []);
    // 실촬영이 못 보여 주는 부위 — 공개 도감 사진(출처 기록) + 기관 링크. 실패해도 그 수종은 실촬영만으로 간다.
    const cm = await fetchCommonsRefs({
      dir: o.dir, folder: refFolder(nameKo), nameKo, latin: entry.latin, ownRefs: refs, session, now: () => now,
      ...(o.commons ? { deps: { ...o.commons, log: o.commons.log ?? log } } : {}), ...(o.signal ? { signal: o.signal } : {}),
    }).catch(() => null);
    const commons = (cm?.commons ?? []).map((c) => ({ part: c.part, file: c.file, license: c.license }));
    entries.push({ ...entry, refs, ...(commons.length ? { commons } : {}) });
  }
  const sceneDir = path.join(o.dir, SCENE_DIR);
  writeIfChanged(path.join(sceneDir, SPECIES_MODULE), speciesModuleSource(sceneDir, o.repo, episode));
  const index: SpeciesIndex = { at: now.toISOString(), ...(hero ? { hero } : {}), species: entries };
  fs.writeFileSync(path.join(presetDir, 'index.json'), JSON.stringify(index, null, 2));
  return index;
}

/** 묶음 하나에 줄 공개 도감 사진 상한(실촬영 4장과 별도). */
export const BATCH_COMMONS = 4;

/**
 * 장면 묶음에 줄 수종 표(순수) — 그 묶음 장 수종(없으면 주인공). 실물 사진은 작업 폴더 안 경로로 바꿔 준다(refsIn).
 * hint = 묶음 문장들 — 거기 나오는 부위(껍질·꽃·겨울·묘목 …)의 공개 도감 사진을 먼저 고른다(ext, BATCH_COMMONS 장).
 */
export function batchSpecies(index: SpeciesIndex | null, names: readonly string[], refsIn: (rel: string) => string = (r) => r, hint = ''): Array<{ nameKo: string; use: string; note?: string; refs: string[]; ext?: Array<{ part: RefPart; file: string }> }> {
  if (!index) return [];
  const want = new Set(names.map(speciesNorm));
  return index.species.filter((e) => want.has(speciesNorm(e.nameKo))).map((e) => {
    const low = e.confidence ? Object.entries(e.confidence).filter(([, v]) => v === 'low').map(([k]) => k) : [];
    const note = e.source === 'episode' ? `이 편 전용 프리셋(서다인 작성)${low.length ? ` — 신뢰 낮음: ${low.join('·')}, 실물 사진과 꼭 대조` : ''}`
      : e.source === 'generic' ? '프리셋 없음 — 일반형으로 그리고 장면 맨 위 주석에 \'일반형\'' : undefined;
    const ext = pickCommons(e.commons ?? [], partsFromText(hint), BATCH_COMMONS).map((c) => ({ part: c.part, file: refsIn(c.file) }));
    return { nameKo: e.nameKo, use: e.use, ...(note ? { note } : {}), refs: e.refs.slice(0, 4).map(refsIn), ...(ext.length ? { ext } : {}) };
  });
}
