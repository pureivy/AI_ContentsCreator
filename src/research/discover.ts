/**
 * 콜드스타트 키워드/니치 발굴 파이프라인 — 성과 데이터가 아직 없을 때 기획을 견인한다.
 *
 * 흐름: 시드 → 자동완성/검색광고 연관어 확장 → 실검색량·경쟁도 → 블로그 SERP 경쟁 → 기회점수 랭킹.
 *   기회점수 = 검색량↑ · 경쟁도↓ · SERP 문서수↓ (노출 여지 큰 키워드 우선).
 * 커넥터의 export 헬퍼(searchAdVolumes/naverSerp/naverAutocomplete)를 직접 호출한다(그라운딩 주입과 별개 경로).
 */
import { searchAdVolumes, searchAdEnabled } from '../grounding/naver_searchad';
import { naverSerp, naverSearchEnabled } from '../grounding/naver_search';
import { naverAutocomplete } from '../grounding/naver_autocomplete';

export interface KeywordOpportunity {
  keyword: string;
  volume: number;      // 월간 검색수(PC+모바일)
  competition: string; // 검색광고 경쟁도(낮음/중간/높음)
  serpCount: number;   // 블로그 SERP 문서수(경쟁 지표)
  score: number;       // 기회점수(높을수록 노출 여지↑)
}

function compFactor(comp: string): number {
  return comp === '높음' ? 0.5 : comp === '중간' ? 0.75 : 1.0;
}
function serpFactor(total: number): number {
  return total > 500_000 ? 0.5 : total > 100_000 ? 0.75 : total > 20_000 ? 0.9 : 1.0;
}

export interface DiscoverOptions {
  /** SERP 경쟁도까지 조사할 상위 후보 수(각 1 API 콜) — 쿼터 보호. */
  serpChecks?: number;
  signal?: AbortSignal;
}

/**
 * 시드 키워드들로부터 기회 키워드를 발굴해 점수순 반환.
 * SearchAd 없으면 자동완성+SERP 휴리스틱으로 degrade(절대량 없이 경쟁도만).
 */
export async function discoverKeywords(seeds: string[], opts: DiscoverOptions = {}): Promise<KeywordOpportunity[]> {
  const { serpChecks = 8, signal } = opts;
  const cleanSeeds = seeds.map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (!cleanSeeds.length) return [];

  // 1) 시드 확장 — 자동완성 연관어(키리스) 합류.
  const expanded = new Set<string>(cleanSeeds);
  for (const s of cleanSeeds) {
    if (signal?.aborted) break;
    for (const a of await naverAutocomplete(s, signal)) expanded.add(a);
  }

  // 2) 검색량·경쟁도 — SearchAd 가 시드/연관어의 실검색량 + 추가 연관어를 반환.
  let candidates: Array<{ keyword: string; volume: number; comp: string }> = [];
  if (searchAdEnabled()) {
    const vols = await searchAdVolumes([...expanded].slice(0, 5), signal);
    candidates = vols.map((v) => ({ keyword: v.keyword, volume: v.total, comp: v.comp }));
  } else {
    // SearchAd 미설정 → 절대량 없이 확장어만(경쟁도는 SERP 로만).
    candidates = [...expanded].map((k) => ({ keyword: k, volume: 0, comp: '-' }));
  }
  // 검색량 내림차순 상위 후보만 SERP 조사(쿼터 보호).
  candidates = candidates.sort((a, b) => b.volume - a.volume).slice(0, Math.max(serpChecks, 8));

  // 3) 블로그 SERP 경쟁도 + 기회점수.
  const out: KeywordOpportunity[] = [];
  const withSerp = naverSearchEnabled();
  for (let i = 0; i < candidates.length; i++) {
    if (signal?.aborted) break;
    const c = candidates[i]!;
    let serpCount = 0;
    if (withSerp && i < serpChecks) {
      try { serpCount = (await naverSerp(c.keyword, signal)).total; } catch { serpCount = 0; }
    }
    // 검색량 없으면(SearchAd 미설정) 점수는 경쟁도(SERP 역수) 위주.
    const base = c.volume > 0 ? c.volume : 100;
    const score = Math.round(base * compFactor(c.comp) * serpFactor(serpCount));
    out.push({ keyword: c.keyword, volume: c.volume, competition: c.comp, serpCount, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 발굴 결과를 리서치 브리프/위키 적재용 마크다운으로. */
export function formatOpportunities(ops: KeywordOpportunity[], title = '키워드 기회 발굴'): string {
  if (!ops.length) return `## ${title}\n(발굴 결과 없음)`;
  const rows = ops.slice(0, 15).map((o) =>
    `| ${o.keyword} | ${o.volume ? o.volume.toLocaleString() : '-'} | ${o.competition} | ${o.serpCount ? o.serpCount.toLocaleString() : '-'} | ${o.score.toLocaleString()} |`,
  ).join('\n');
  return `## ${title}\n\n| 키워드 | 월검색량 | 경쟁도 | 블로그문서수 | 기회점수 |\n|---|---|---|---|---|\n${rows}\n\n_기회점수 = 검색량 × 경쟁도역수 × SERP문서수역수. 높을수록 노출 여지가 큰 키워드._`;
}
