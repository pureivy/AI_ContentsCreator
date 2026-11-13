/**
 * 웹툰 이야기 자료(2026-11-12 사장님 "주제 수종이 정해지면 해당 수종의 기원, 꽃말, 전설 등 재미있고 시선을 끌 수 있는 내용으로
 * 스토리를 만들어"). 블로그 본문엔 전설·꽃말이 거의 없어, 작가(SHORT_marker write_shotlist --mode lore)와 원문 대조가
 * 같은 근거를 보도록 출처 붙은 자료를 한 번 모아 작업 폴더에 둔다(이어서 만들기도 같은 파일 — 다시 검색하지 않는다).
 *
 *  ① 검색 — 사실 공급(factSupply)과 같은 백과·웹 커넥터, 이야기 질의만.
 *  ② 본문 — 검색 요약문만으로는 전설 줄거리가 끊긴다. 이야기 낱말이 걸린 상위 몇 쪽은 본문을 가져와 수종 이름 둘레만 남긴다.
 *  ③ 추출 — LLM 이 자료에 적힌 것만 번호(ref)를 달아 옮긴다. 번호가 틀린 항목은 버린다(지어낸 전설 차단).
 *  빈약하면(전설 줄거리 0 · 이야기 사실 4건 미만) thin — 호출부가 "왜" 구조로 넘긴다.
 */
import { collectSearchResults, type FactSupplyDeps, type SearchHit } from './factSupply';
import { naverEncyc } from '../grounding/naver_encyc';
import { webSearch } from '../tools/web_search';
import { microJSON } from '../orchestrator/agent';
import { fetchPublicFollow } from '../grounding/custom';

export interface LoreFact { text: string; kind: string; ref: number; source: string; url: string }
export interface LoreLegend { title: string; beats: string[]; ref: number; source: string; url: string }
export interface LoreDossier {
  species: string; queries: string[]; checkedTs: string;
  status: 'ok' | 'thin' | 'error'; error?: string;
  facts: LoreFact[]; legends: LoreLegend[];
}

export const LORE_KINDS = ['legend', 'flower_language', 'name_origin', 'origin', 'history', 'symbol', 'literature'] as const;
const KIND_KO: Record<string, string> = {
  legend: '전설·설화', flower_language: '꽃말', name_origin: '이름 유래', origin: '기원·원산지', history: '역사·쓰임', symbol: '상징', literature: '문학·예술',
};

/** 이야기 질의(순수) — 수종 이름(+대표 별칭 하나). */
export function loreQueries(name: string, alias?: string): string[] {
  const n = name.trim();
  return [
    `${n} 전설`, `${n} 설화 옛이야기`, `${n} 꽃말`, `${n} 이름 유래`, `${n} 신화`,
    `${n} 상징 의미`, `${n} 원산지 기원 역사`, ...(alias && alias !== n ? [`${alias} 전설 유래`] : []),
  ];
}

const LORE_WORD = /전설|설화|민담|신화|옛이야기|꽃말|유래|이름의?\s?뜻|상징|사연/;

/** 본문을 가져올 쪽 고르기(순수) — 수종 이름과 이야기 낱말이 같이 걸린 결과 순서대로 max 개. */
export function pickPages(hits: readonly SearchHit[], names: readonly string[], max = 5): number[] {
  const has = (h: SearchHit): boolean => names.some((n) => n && `${h.title} ${h.snippet}`.includes(n));
  return hits.map((h, i) => ({ h, i })).filter(({ h }) => has(h) && LORE_WORD.test(`${h.title} ${h.snippet}`)).slice(0, max).map(({ i }) => i);
}

/** HTML → 평문(순수, 거칠게). */
export function htmlText(s: string): string {
  return s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** 수종 이름 둘레만(순수) — 이름이 나온 줄과 앞뒤 2줄, 최대 max 자. 이름이 안 나오면 ''. */
export function aroundName(text: string, names: readonly string[], max = 3500): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const keep = new Set<number>();
  lines.forEach((l, i) => { if (names.some((n) => n && l.includes(n))) for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < lines.length) keep.add(k); });
  let out = '';
  for (const i of [...keep].sort((a, b) => a - b)) {
    const l = lines[i]!;
    if (l.length < 8) continue;
    if (out.length + l.length > max) break;
    out += `${l}\n`;
  }
  return out.trim();
}

async function pageText(url: string, names: readonly string[], signal?: AbortSignal): Promise<string> {
  try {
    const r = await fetchPublicFollow(url, signal);
    if (!r.ok || !/html|text/.test(r.headers.get('content-type') ?? '')) return '';
    const html = (await r.text()).slice(0, 600_000);
    return aroundName(htmlText(html), names);
  } catch { return ''; }
}

type RawLore = { facts?: Array<{ text?: unknown; kind?: unknown; ref?: unknown }>; legends?: Array<{ title?: unknown; beats?: unknown; ref?: unknown }> };

/** LLM 결과를 자료 번호와 대조(순수) — 번호가 자료 범위 밖이면 버린다. */
export function attachLoreRefs(raw: RawLore | null, docs: ReadonlyArray<{ title: string; url: string }>): { facts: LoreFact[]; legends: LoreLegend[] } {
  const okRef = (r: unknown): number | null => { const n = Number(r); return Number.isInteger(n) && n >= 1 && n <= docs.length ? n : null; };
  const facts: LoreFact[] = []; const legends: LoreLegend[] = [];
  const seen = new Set<string>();
  for (const f of raw?.facts ?? []) {
    const text = typeof f?.text === 'string' ? f.text.trim() : '';
    const ref = okRef(f?.ref);
    if (!text || ref === null || seen.has(text)) continue;
    seen.add(text);
    const kind = typeof f?.kind === 'string' && (LORE_KINDS as readonly string[]).includes(f.kind) ? f.kind : 'history';
    facts.push({ text, kind, ref, source: docs[ref - 1]!.title, url: docs[ref - 1]!.url });
  }
  for (const l of raw?.legends ?? []) {
    const ref = okRef(l?.ref);
    const beats = Array.isArray(l?.beats) ? (l.beats as unknown[]).filter((b): b is string => typeof b === 'string' && !!b.trim()).map((b) => b.trim()) : [];
    if (ref === null || beats.length < 3) continue;
    legends.push({ title: typeof l?.title === 'string' ? l.title.trim() : '전설', beats, ref, source: docs[ref - 1]!.title, url: docs[ref - 1]!.url });
  }
  return { facts: facts.slice(0, 30), legends: legends.slice(0, 3) };
}

/** 빈약 판정(순수) — 전설 줄거리 하나도 없고 이야기 사실 4건 미만이면 이야기로 못 만든다. */
export function isThin(d: Pick<LoreDossier, 'facts' | 'legends'>): boolean {
  return !d.legends.length && d.facts.length < 4;
}

/** 작가·원문 대조에 넘길 자료 글(순수). */
export function loreMarkdown(d: LoreDossier): string {
  const out = [`# ${d.species} 이야기 자료(출처 있는 것만)`];
  for (const l of d.legends) {
    out.push('', `## 전설: ${l.title} (출처: ${l.source}, ${l.url})`, ...l.beats.map((b, i) => `${i + 1}. ${b}`));
  }
  const by = new Map<string, LoreFact[]>();
  for (const f of d.facts) by.set(f.kind, [...(by.get(f.kind) ?? []), f]);
  for (const k of LORE_KINDS) {
    const fs = by.get(k); if (!fs?.length) continue;
    out.push('', `## ${KIND_KO[k]}`, ...fs.map((f) => `- ${f.text} (출처: ${f.source}, ${f.url})`));
  }
  return out.join('\n');
}

const SYS = '너는 나무 이야기(전설·꽃말·이름 유래·역사) 자료 정리 보조자다. 주어진 자료에 적힌 내용만 옮기고, 요청된 JSON 만 출력한다.';

const DEFAULT_DEPS: FactSupplyDeps & { page: (url: string, names: readonly string[], signal?: AbortSignal) => Promise<string> } = {
  encyc: (q, display, signal) => naverEncyc(q, display, signal),
  web: (q, limit, signal) => webSearch(q, limit, signal),
  llm: (model, system, user, opts) => microJSON(model, system, user, opts),
  page: pageText,
};

export async function collectLore(
  a: { name: string; aliases?: readonly string[]; model: string; signal?: AbortSignal },
  deps: typeof DEFAULT_DEPS = DEFAULT_DEPS,
): Promise<LoreDossier> {
  const names = [a.name, ...(a.aliases ?? [])].filter(Boolean);
  const queries = loreQueries(a.name, a.aliases?.[0]);
  const base = { species: a.name, queries, checkedTs: new Date().toISOString(), facts: [], legends: [] };
  try {
    const hits = await collectSearchResults(queries, deps, a.signal, 40);
    if (!hits.length) return { ...base, status: 'error', error: '검색 결과 0건(커넥터 확인)' };
    const pages = pickPages(hits, names);
    const bodies = await Promise.all(pages.map((i) => deps.page(hits[i]!.url, names, a.signal)));
    const docs = hits.map((h, i) => {
      const k = pages.indexOf(i);
      const body = k >= 0 ? bodies[k] ?? '' : '';
      return { title: h.title, url: h.url, text: body ? `${h.snippet}\n[본문 발췌]\n${body}` : h.snippet };
    });
    const numbered = docs.map((d, i) => `### ${i + 1}. [${d.title}] (${d.url})\n${d.text}`).join('\n\n');
    const user = [
      `대상 수종: "${a.name}"${a.aliases?.length ? `(다른 이름: ${a.aliases.join(', ')})` : ''}. 아래 자료에서 이 수종의 이야기를 뽑아라.`,
      '- 자료에 적힌 내용만 쓴다. 아는 대로 보태거나 다른 나무·다른 꽃의 이야기를 섞지 마라. 같은 이름의 다른 식물(예: 풀꽃) 이야기면 버린다.',
      '- legends: 자료에 줄거리가 적힌 전설·설화·신화·옛이야기. beats 는 줄거리를 일어난 순서대로 3~12개 짧은 문장으로(인물·장소·시대는 자료에 적힌 대로, 이름이 없으면 "한 소녀"처럼 역할로). 절정·반전·결말(누가 무슨 말을 외쳤는지, 그래서 나무·이름이 어떻게 됐는지)까지 빠짐없이 — 이야기의 재미는 끝에 있다. 줄거리가 끊겨 있으면 넣지 마라. ref 는 줄거리가 적힌 자료 번호 하나.',
      '- 같은 전설이 자료마다 다르면(누가 심었는지·장소·숫자 등) 섞지 말고 판본마다 따로 legends 에 넣어라(최대 3개, 줄거리가 가장 온전한 것 먼저). 다른 점은 facts 에 kind "legend" 로 한 문장씩 적어라(예: "다른 판본에선 율곡이 직접 심었다고 한다").',
      `- facts: 꽃말·이름 유래·기원(원산지)·역사·쓰임·상징·문학 속 이야기 한 문장씩, 최대 25개. kind 는 ${LORE_KINDS.join(' | ')} 중 하나. ref 는 그 내용이 적힌 자료 번호.`,
      '- 재배법(심는 시기·전정·병해충)은 넣지 않는다.',
      `[자료]\n${numbered}`,
      'JSON 형식: {"legends":[{"title":"짧은 제목","beats":["...","..."],"ref":1}],"facts":[{"text":"...","kind":"flower_language","ref":2}]}',
    ].join('\n\n');
    const raw = await deps.llm(a.model, SYS, user, { maxOutputTokens: 4000, ...(a.signal ? { signal: a.signal } : {}) }) as RawLore | null;
    if (!raw) return { ...base, status: 'error', error: '자료 정리 실패(LLM 응답 없음)' };
    const got = attachLoreRefs(raw, docs);
    return { ...base, ...got, status: isThin(got) ? 'thin' : 'ok' };
  } catch (e) {
    return { ...base, status: 'error', error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}
