/**
 * 사실 공급(2026-09-17) — 집필 전에 수종(또는 소재)에 고유한 사실을 코드가 모아 브리프 끝에 붙인다.
 *
 * 왜: 리서치팀은 키워드팀이라(검색량·SERP) 사실 카드에 식물 사실이 평균 3건, 9편은 0건이었다(9/1~9/17
 * 37편 실측). 작가 지침이 "브리프에 없는 사실은 일반론으로만"이라 2,000자를 어느 나무에나 맞는
 * 일반론으로 채웠고, 그게 "수종만 바뀐 같은 글"의 뿌리다.
 *
 * 원칙: 코드가 검색하고 LLM 은 추출만 한다. 질의는 결정적, 출처 URL 은 검색 결과에 실제로 있던 것만
 * (ref 번호로 대조) — 날조 URL 이 결정적으로 막힌다. "어느 나무에나 맞는 말"은 고유 사실이 아니다.
 */
import { CONFIG } from '../config';
import { findSpeciesLoose } from './species';
import { currentPlaceNames, obsoletePlacesIn } from './placeNames';
import { speciesInText, type SpeciesGroup } from './speciesRotation';
import { getBrand } from './brand';
import { naverEncyc } from '../grounding/naver_encyc';
import { webSearch } from '../tools/web_search';
import { microJSON } from '../orchestrator/agent';

export type FactKind = 'cultivation' | 'lore';
export interface SearchHit { title: string; url: string; snippet: string }
export interface SuppliedFact {
  text: string; kind: FactKind; source: string; url: string; specific: boolean;
  /** 이 글 주제(angle)에서 이 수종만 다른 점(2026-11-03) — 고유 사실 중 주제에 직접 걸린 것. */
  topical?: boolean;
}
export interface FactSupplyResult {
  status: 'ok' | 'skipped' | 'error';
  subject: string;
  species?: string;
  queries: string[];
  /** 주제 각도(2026-11-03) — 키워드·제목에서 수종 이름을 뗀 말("활착", "전정시기"). 수종 주제 질의 2개가 이걸로 붙는다. */
  angle?: string;
  resultCount: number;
  facts: SuppliedFact[];
  /** specific && URL 유효 — 임계 판정의 기준. */
  specificCount: number;
  error?: string;
  checkedTs: string;
}
export interface RawFact { text?: unknown; ref?: unknown; kind?: unknown; specific?: unknown; topical?: unknown }

export const FACT_SUPPLY_HEADER = '## 재배·이야기 사실 조사(자동 수집)';

const compact = (s: string): string => (s ?? '').normalize('NFC').replace(/\s+/g, '');

/** 사실 부족 보류 대상인가(순수). 자율 런이고, 리비전·리서치가 아니며, 조각이 자율 생성(auto)이고 사용자 촉발이 아닐 때만.
 *  사용자가 등록한 아이디어(auto 없음)를 자율 틱이 재개하는 경우도 사용자 주제다 — 보류하지 않는다(최종 리뷰 C1). */
export function shouldHoldForFacts(
  opts: { auto?: boolean; revise?: unknown; mission?: string },
  piece: { auto?: boolean; userTriggered?: boolean } | undefined,
): boolean {
  if (!opts.auto || opts.revise || opts.mission === 'research') return false;
  if (!piece) return true;                 // 조각 없는 자율 런(컴포저 주제 없음) — 자율 선정 그대로
  return piece.auto === true && !piece.userTriggered;
}

/** 수집 대상 — 수종 사전 적중 → 브랜드 카탈로그 적중 → 키워드(3어절 이하) → 제목 첫 어절.
 *  카탈로그 폴백(최종 리뷰 C3): 사전(species.yaml)은 이미지 앵커용 68종이라 회화나무·은행나무·느티나무 같은
 *  카탈로그 29종이 빠져 이야기 질의를 못 받았다. 스케줄러의 speciesKeyOf 와 같은 순서·같은 눈이다. */
export function factSubjectOf(
  topic: string, keyword?: string, catalog?: SpeciesGroup[],
): { subject: string; species?: string; aliases: string[] } {
  const text = `${topic} ${keyword ?? ''}`;
  const sp = findSpeciesLoose(text);
  if (sp) return { subject: sp.name, species: sp.name, aliases: [...(sp.aliases ?? [])] };
  const cat = speciesInText(text, catalog);
  if (cat) {
    const entry = catalog?.flatMap((g) => g.species ?? []).find((s) => s.name === cat);
    return { subject: cat, species: cat, aliases: [...(entry?.aliases ?? [])] };
  }
  const kw = (keyword ?? '').trim();
  if (kw && kw.split(/\s+/).length <= 3) return { subject: kw, aliases: [] };
  const first = topic.trim().split(/[\s,·]+/)[0] ?? '';
  return { subject: first || kw || topic.trim(), aliases: [] };
}

/**
 * 주제 각도(순수, 2026-11-03) — 키워드(없으면 제목 첫 마디)에서 수종 이름·별칭을 떼고 앞 세 어절.
 * 왜: 질의가 수종마다 고정이라 활착 글이든 전정 글이든 같은 도감 사실(키·원산지·껍질 색)만 받았다. 블로그 16편 검토에서
 * 수종 특성에서 나온 조언은 28%였고, 공급 사실에 있던 "대추나무는 새싹이 아주 늦게 튼다"도 활착 글에 쓰이지 않았다.
 */
export function factAngleOf(topic: string, keyword: string | undefined, names: readonly string[]): string {
  // 긴 이름부터 뗀다 — 짧은 별칭을 먼저 떼면 "목백일홍"이 "목"으로, "태추단감"이 "태추"로 남는다(코드 리뷰 2026-11-03).
  const ordered = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const strip = (t: string): string => ordered
    .reduce((acc, n) => acc.split(n).join(' '), t.normalize('NFC'))
    .replace(/[,.?!·:;()"'“”‘’~\-—–/|]/g, ' ').replace(/\s+/g, ' ').trim();
  // 수종 이름을 떼면 남는 조사("음나무가 잘 자라는" → "가 잘 자라는")를 앞에서 뗀다.
  const pick = (t: string): string => t.replace(/^(?:에서|으로|[가이은는을를의도와과에로])(?:\s|$)/, '').split(' ').filter(Boolean).slice(0, 3).join(' ');
  return pick(strip(keyword ?? '')) || pick(strip(topic.split(/[,?]/)[0] ?? ''));
}

/** 결정적 질의 — 수종이면 [주제 2 +] 재배 5 + 이야기 3, 아니면 재배·특성·주의 3. 주제 질의를 앞에 둔다(결과 상한에 잘리지 않게). */
export function factQueriesFor(subject: string, species?: string, angle?: string): string[] {
  const s = subject.trim();
  const base = [`${s} 재배`, `${s} 특성 자생지`];
  if (!species) return [...base, `${s} 주의 문제`];
  const a = (angle ?? '').trim();
  return [
    ...(a ? [`${s} ${a}`, `${s} ${a} 방법 주의`] : []),
    ...base,
    `${s} 심는 시기 토양`, `${s} 전정 시기`, `${s} 병해충`,
    `${s} 전설 설화 유래`, `${s} 꽃말 상징`, `${s} 쓰임 역사`,
  ];
}

/** 고유 판정 — 수종이 있으면 텍스트·출처 제목에 수종명(별칭 포함)이 있어야 한다. LLM 태그는 보조. */
export function isSpecificFact(
  text: string, sourceTitle: string, species: string | undefined, llmSpecific: boolean, aliases: readonly string[] = [],
): boolean {
  if (!species) return llmSpecific;
  const hay = compact(`${text} ${sourceTitle}`);
  return [species, ...aliases].some((n) => n && hay.includes(compact(n)));
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

/** LLM 응답 {facts:[{text, ref, kind, specific}]} 를 검색 결과와 대조 — ref 가 결과 번호(1-based)여야 산다. */
export function attachRefs(
  raw: unknown, hits: SearchHit[], species?: string, aliases: readonly string[] = [], max = 20,
): SuppliedFact[] {
  const list = (raw as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(list)) return [];
  const out: SuppliedFact[] = [];
  const seen = new Set<string>();
  for (const f of list as RawFact[]) {
    // 옛 행정구역 이름을 현행으로 옮긴다(2026-09-29) — 출처가 1995년 이전 자료면 '금릉·온양'이 그대로
    // 본문까지 간다(사장님 지적). 사실이 확정되는 이 자리 한 곳이면 브리프·사실 카드·본문이 모두 따라온다.
    const rawText = typeof f?.text === 'string' ? f.text.trim().replace(/^[-•*]\s+/, '') : '';
    const text = currentPlaceNames(rawText);
    if (text !== rawText) {
      const moved = obsoletePlacesIn(rawText).map((x) => `${x.from}→${x.to}`).join(' · ');
      // eslint-disable-next-line no-console
      console.log('[사실공급]', `옛 행정구역 이름 교정 — ${moved}`);
    }
    const ref = typeof f?.ref === 'number' ? f.ref : Number(f?.ref);
    if (!text || !Number.isInteger(ref) || ref < 1 || ref > hits.length) continue;
    const key = compact(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = hits[ref - 1]!;
    const kind: FactKind = f?.kind === 'lore' ? 'lore' : 'cultivation';
    out.push({
      text, kind, url: hit.url, source: hit.title.trim() || hostOf(hit.url),
      specific: isSpecificFact(text, hit.title, species, f?.specific === true, aliases),
      ...(f?.topical === true ? { topical: true } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 브리프 끝에 붙는 블록 — 고유 사실만, extractFactCard 가 URL 붙은 줄을 그대로 집어간다.
 * 주제 고유 사실([이 주제])을 맨 앞에. skip: 같은 수종 최근 글에 이미 쓴 사실(2026-11-03) — 주제 고유 사실은 빼지 않는다.
 */
export function factSupplyBlock(r: FactSupplyResult, skip?: ReadonlySet<string>): string {
  const tag = (f: SuppliedFact): string => (f.topical ? '이 주제' : f.kind === 'lore' ? '이야기' : '재배');
  const lines = r.facts.filter((f) => f.specific && (f.topical || !skip?.has(f.text)))
    .sort((a, b) => Number(!!b.topical) - Number(!!a.topical))
    .map((f) => `- [${tag(f)}] ${f.text} (근거: ${f.source}, ${f.url})`);
  if (!lines.length) return '';
  return [FACT_SUPPLY_HEADER, ...lines].join('\n');
}

export interface FactSupplyDeps {
  encyc: (q: string, display: number, signal?: AbortSignal) => Promise<Array<{ title: string; link: string; description: string }>>;
  web: (q: string, limit: number, signal?: AbortSignal) => Promise<Array<{ title: string; url: string; snippet: string }>>;
  llm: (model: string, system: string, user: string, opts: { maxOutputTokens?: number; signal?: AbortSignal }) => Promise<unknown>;
}
const DEFAULT_DEPS: FactSupplyDeps = {
  encyc: (q, display, signal) => naverEncyc(q, display, signal),
  web: (q, limit, signal) => webSearch(q, limit, signal),
  llm: (model, system, user, opts) => microJSON(model, system, user, opts),
};

/** 질의마다 백과 5 + 웹 5, URL 로 중복 제거, cap 까지. 개별 커넥터 실패는 그 질의만 비운다. */
export async function collectSearchResults(queries: string[], deps: FactSupplyDeps, signal?: AbortSignal, cap = 40): Promise<SearchHit[]> {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit): void => {
    const u = h.url.trim();
    if (!u || seen.has(u) || out.length >= cap) return;
    seen.add(u);
    out.push({ title: h.title.trim(), url: u, snippet: h.snippet.trim() });
  };
  for (const q of queries) {
    if (signal?.aborted) break;
    const [enc, web] = await Promise.all([
      deps.encyc(q, 5, signal).catch(() => []),
      deps.web(q, 5, signal).catch(() => []),
    ]);
    for (const e of enc) push({ title: e.title, url: e.link, snippet: e.description });
    for (const w of web) push({ title: w.title, url: w.url, snippet: w.snippet });
    if (out.length >= cap) break;   // cap 에 닿으면 남은 질의는 부르지 않는다(질의당 웹 타임아웃 8초가 헛돌던 것)
  }
  return out;
}

const SYS = '너는 원예 콘텐츠의 사실 수집 보조자다. 검색 결과에 적힌 내용만 옮기고, 요청된 JSON 스키마만 출력한다.';

export async function supplyFacts(
  a: { topic: string; keyword?: string; model: string; signal?: AbortSignal }, deps: FactSupplyDeps = DEFAULT_DEPS,
): Promise<FactSupplyResult> {
  const checkedTs = new Date().toISOString();
  const { subject, species, aliases } = factSubjectOf(a.topic, a.keyword, getBrand()?.speciesCatalog);
  const angle = species && CONFIG.speciesAdvice ? factAngleOf(a.topic, a.keyword, [subject, species, ...aliases]) : '';
  const queries = factQueriesFor(subject, species, angle);
  const base = { subject, ...(species ? { species } : {}), ...(angle ? { angle } : {}), queries, checkedTs };
  try {
    // 주제 질의 2개가 늘어 상한도 8건 늘린다(질의마다 백과 5·웹 5 중 중복 제거 뒤).
    const hits = await collectSearchResults(queries, deps, a.signal, angle ? 48 : 40);
    // 결과 0건은 '사실 사막'이 아니라 커넥터 장애다(최종 리뷰 C2) — 백과·웹 양쪽이 8개 질의에 URL 하나도 못 주는
    // 수종은 없다. 커넥터 실패는 []로 삼켜지므로 여기서 구분이 안 되고, fail-open(error → 보류 없이 종전 집필)을 택한다.
    if (!hits.length) return { ...base, status: 'error', resultCount: 0, facts: [], specificCount: 0, error: 'no results' };
    const numbered = hits.map((h, i) => `${i + 1}. [${h.title}] ${h.snippet} (${h.url})`).join('\n');
    const user = [
      `대상: "${subject}"${species ? '(수종)' : '(소재)'}. 아래 검색 결과에서 **${subject}에만 해당하는** 사실을 뽑아라.`,
      '- 결과에 적힌 내용만 쓴다. 결과에 없는 것을 아는 대로 보태지 마라.',
      '- kind: "cultivation"(자생지·내한성·토양·볕·수형·생장·개화 결실·전정 시기·병해충·번식·주의) 또는 "lore"(전설·설화·이름 유래·꽃말·상징·역사·문화·쓰임새·문학·명소).',
      '- specific: 그 대상에만 해당하면 true, 어느 나무에나 통하는 일반론("물 빠짐이 좋아야 한다")이면 false.',
      '- ref: 그 사실이 적힌 결과 번호(1부터). 한 사실에 하나.',
      ...(angle ? [
        `- 이 글의 주제는 "${angle}"다. 이 주제에서 ${subject}가 다른 나무와 다른 점(시기·방법·판단 기준·주의가 달라지는 이유가 되는 성질)을 먼저 찾아 topical: true 로 표시하라. 키·원산지·분류·학명·껍질 색 같은 도감 소개는 topical 이 아니다.`,
      ] : []),
      '- 각 사실은 한 문장, 최대 20개.',
      `[검색 결과]\n${numbered}`,
      `JSON 형식: {"facts":[{"text":"...","ref":1,"kind":"cultivation","specific":true${angle ? ',"topical":false' : ''}}]}`,
    ].join('\n\n');
    const json = await deps.llm(a.model, SYS, user, { maxOutputTokens: 2400, signal: a.signal });
    if (!json) return { ...base, status: 'error', resultCount: hits.length, facts: [], specificCount: 0, error: 'llm null' };
    const facts = attachRefs(json, hits, species, aliases);
    return { ...base, status: 'ok', resultCount: hits.length, facts, specificCount: facts.filter((f) => f.specific).length };
  } catch (e) {
    return { ...base, status: 'error', resultCount: 0, facts: [], specificCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
