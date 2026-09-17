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
import { findSpeciesLoose } from './species';

export type FactKind = 'cultivation' | 'lore';
export interface SearchHit { title: string; url: string; snippet: string }
export interface SuppliedFact { text: string; kind: FactKind; source: string; url: string; specific: boolean }
export interface FactSupplyResult {
  status: 'ok' | 'skipped' | 'error';
  subject: string;
  species?: string;
  queries: string[];
  resultCount: number;
  facts: SuppliedFact[];
  /** specific && URL 유효 — 임계 판정의 기준. */
  specificCount: number;
  error?: string;
  checkedTs: string;
}
export interface RawFact { text?: unknown; ref?: unknown; kind?: unknown; specific?: unknown }

export const FACT_SUPPLY_HEADER = '## 재배·이야기 사실 조사(자동 수집)';

const compact = (s: string): string => (s ?? '').normalize('NFC').replace(/\s+/g, '');

/** 수집 대상 — 수종 사전 적중 → 키워드(3어절 이하) → 제목 첫 어절. */
export function factSubjectOf(topic: string, keyword?: string): { subject: string; species?: string } {
  const sp = findSpeciesLoose(`${topic} ${keyword ?? ''}`);
  if (sp) return { subject: sp.name, species: sp.name };
  const kw = (keyword ?? '').trim();
  if (kw && kw.split(/\s+/).length <= 3) return { subject: kw };
  const first = topic.trim().split(/[\s,·]+/)[0] ?? '';
  return { subject: first || kw || topic.trim() };
}

/** 결정적 질의 — 수종이면 재배 5 + 이야기 3, 아니면 재배·특성·주의 3. */
export function factQueriesFor(subject: string, species?: string): string[] {
  const s = subject.trim();
  const base = [`${s} 재배`, `${s} 특성 자생지`];
  if (!species) return [...base, `${s} 주의 문제`];
  return [
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
    const text = typeof f?.text === 'string' ? f.text.trim().replace(/^[-•*]\s+/, '') : '';
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
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 브리프 끝에 붙는 블록 — 고유 사실만, extractFactCard 가 URL 붙은 줄을 그대로 집어간다. */
export function factSupplyBlock(r: FactSupplyResult): string {
  const lines = r.facts.filter((f) => f.specific)
    .map((f) => `- [${f.kind === 'lore' ? '이야기' : '재배'}] ${f.text} (근거: ${f.source}, ${f.url})`);
  if (!lines.length) return '';
  return [FACT_SUPPLY_HEADER, ...lines].join('\n');
}
