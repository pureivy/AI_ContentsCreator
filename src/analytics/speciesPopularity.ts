/**
 * 수종 인기 점수(2026-10-07 사장님 요청 "네이버·유튜브·인스타에 인기 있는 수종과 주제로") — 우리 채널 실측 중심.
 *
 * 왜 검색량만으로는 안 되나. 10-07 17시 오토런이 마가목을 골랐다. 네이버 '마가목' 34,180/월(보관소 5위)이라 수요 게이트는
 * 통과했지만, 연관어는 열매·효능·가격(약재 수요)이고 우리 채널 성과는 하위권이었다(유튜브 741·인스타 659, 채널 중앙값
 * 1,100~1,500대). 반대로 자두나무는 검색 2,090인데 인스타 10,718. 사장님 선택: "우리 채널 성과 중심, 검색량은 보조".
 *
 * 점수 = 채널별 '수종 중앙값 ÷ 채널 중앙값' 배수의 로그를 가중 평균해 다시 배수로(1 = 우리 평균).
 *  · 가중치: 인스타 0.5 · 블로그 0.3 · 유튜브 0.2. 유튜브가 가벼운 이유 — 첫 배분(~1,000)이 천장이라 수종 간 차이가 거의
 *    없다(yt-batch-ceiling 진단, 수종별 중앙값 대부분 1,000~1,400). 인스타는 329~10,718로 실제 반응 차이가 보인다.
 *  · 고정 나이로 잰다: 게시 7일 지난 편만, 게시 14일째까지의 마지막 측정값(누적이라 오래된 편이 유리해지지 않게).
 *  · 표본이 적으면 사전값으로 당긴다(수축, POPULARITY_PRIOR_N): 사전값은 네이버 검색량 순위(0.85~1.15배 — 보조 신호), 모르면 1.
 *    한 편짜리 대박(자두 릴스 10,718)이 혼자 1위를 차지하지 않게, 글이 없는 수종은 검색량이 메우게.
 *
 * 쓰임(scheduler): **프롬프트 참고 표시만** — 정렬·후순위·기각에는 쓰지 않는다(2026-10-07 사장님 확정).
 * 이유(같은 날 실측, 게시 7~14일 조회): 조회 차이를 수종이 설명하는 몫은 표본 보정 뒤 인스타 0.02·블로그 0.06·유튜브 0.16
 * 뿐이고, 같은 수종 안 편차가 더 크다(블루베리 216~9,284 · 배롱나무 797~5,316). 갈리는 건 수종보다 주제다 —
 * 주제 쪽 신호는 실검색 각도 검사(angleCheck)와 히트 제목 블록(shortsPerf.hitTitleBlock)이 맡는다.
 */
import { readMetrics } from './performance';
import { shortsStore } from '../content/shorts';
import { pieceStore } from '../content/pieces';

export type PopularityChannel = 'ig' | 'yt' | 'blog';
export interface PopularityRow { species: string; channel: PopularityChannel; views: number }
export interface SpeciesPopularity {
  /** 우리 평균 대비 배수(1 = 평균). */
  score: number;
  tier: 'high' | 'mid' | 'low';
  /** 채널별 표본 수. */
  n: Record<PopularityChannel, number>;
}

export const POPULARITY_WEIGHTS: Record<PopularityChannel, number> = { ig: 0.5, blog: 0.3, yt: 0.2 };
/** 수축 강도 — 표본 n 편이 사전값 k 편과 맞선다. */
export const POPULARITY_PRIOR_N = 1;
/** 이 배수 이상이면 인기, 이하면 저조(저조는 자기 표본이 POPULARITY_LOW_MIN_N 편 이상일 때만 — 사전값만으로 깎지 않는다). */
export const POPULARITY_HIGH = 1.25;
export const POPULARITY_LOW = 0.85;
export const POPULARITY_LOW_MIN_N = 2;
/** 고정 나이 창(일). */
export const POPULARITY_MIN_AGE_DAYS = 7;
export const POPULARITY_WINDOW_DAYS = 14;

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** 네이버 검색량 순위 → 사전 배수 0.85~1.15(순수, 보조 신호라 폭을 좁게). 검색량을 모르는 수종은 1. */
export function naverPrior(species: readonly string[], volume: (sp: string) => number | undefined): Map<string, number> {
  const known = species.map((sp) => ({ sp, v: volume(sp) })).filter((x): x is { sp: string; v: number } => Number.isFinite(x.v) && (x.v as number) > 0);
  const sorted = [...known].sort((a, b) => a.v - b.v);
  const out = new Map<string, number>();
  for (const sp of species) out.set(sp, 1);
  sorted.forEach((x, i) => out.set(x.sp, 0.85 + 0.3 * (sorted.length > 1 ? i / (sorted.length - 1) : 0.5)));
  return out;
}

/** 수종 인기 점수(순수). species 는 점수를 매길 수종 목록(표본 없는 수종도 사전값으로 점수가 난다). */
export function scoreSpeciesPopularity(
  rows: readonly PopularityRow[], species: readonly string[], prior: ReadonlyMap<string, number>,
): Map<string, SpeciesPopularity> {
  const chMedian = new Map<PopularityChannel, number>();
  for (const ch of Object.keys(POPULARITY_WEIGHTS) as PopularityChannel[]) {
    chMedian.set(ch, median(rows.filter((r) => r.channel === ch).map((r) => r.views)));
  }
  const out = new Map<string, SpeciesPopularity>();
  for (const sp of new Set(species)) {
    const p = prior.get(sp) ?? 1;
    const lp = Math.log(p);
    let logScore = 0;
    const n = { ig: 0, yt: 0, blog: 0 } as Record<PopularityChannel, number>;
    for (const ch of Object.keys(POPULARITY_WEIGHTS) as PopularityChannel[]) {
      const xs = rows.filter((r) => r.species === sp && r.channel === ch).map((r) => r.views);
      n[ch] = xs.length;
      const m = chMedian.get(ch) ?? 0;
      // 채널 기준이 없으면(표본 0) 사전값만 — 0 으로 나누지 않는다.
      const lObs = xs.length && m > 0 ? Math.log(Math.max(median(xs), 1) / m) : lp;
      const l = (xs.length * lObs + POPULARITY_PRIOR_N * lp) / (xs.length + POPULARITY_PRIOR_N);
      logScore += POPULARITY_WEIGHTS[ch] * l;
    }
    const score = Math.round(Math.exp(logScore) * 100) / 100;
    const own = n.ig + n.yt + n.blog;
    const tier = score >= POPULARITY_HIGH ? 'high' : score <= POPULARITY_LOW && own >= POPULARITY_LOW_MIN_N ? 'low' : 'mid';
    out.set(sp, { score, tier, n });
  }
  return out;
}

/** 표본 하나의 고정 나이 조회수(순수) — 게시 MIN_AGE 전이면 null, 창 안 마지막 측정값(창 안 측정이 없으면 null). */
export function viewsAtAge(
  samples: ReadonlyArray<{ measuredAt?: string; views?: number; source?: string }>, source: string, pubTs: string | undefined, now: number,
): number | null {
  const pub = Date.parse(String(pubTs ?? ''));
  if (!Number.isFinite(pub) || now - pub < POPULARITY_MIN_AGE_DAYS * 86_400_000) return null;
  const end = pub + POPULARITY_WINDOW_DAYS * 86_400_000;
  let best: { at: number; v: number } | null = null;
  for (const m of samples) {
    if (m?.source !== source) continue;
    const at = Date.parse(String(m.measuredAt ?? ''));
    const v = Number(m.views);
    if (!Number.isFinite(at) || !Number.isFinite(v) || at > end) continue;
    if (!best || at > best.at) best = { at, v };
  }
  return best ? best.v : null;
}

/** 브랜드 콘텐츠의 수종별 고정 나이 조회수 행 — 숏폼(인스타 meta:ig · 유튜브 youtube:api), 블로그(scrape:naver_advisor). */
export function collectPopularityRows(
  speciesOf: (text: string) => string | null | undefined, slug: string, now = Date.now(),
): PopularityRow[] {
  const rows: PopularityRow[] = [];
  const push = (sp: string | null | undefined, channel: PopularityChannel, v: number | null): void => {
    if (sp && v !== null) rows.push({ species: sp, channel, views: v });
  };
  try {
    for (const s of shortsStore().list()) {
      if ((s.brand ?? '') !== slug) continue;
      let samples: ReturnType<typeof readMetrics>;
      try { samples = readMetrics(s.id); } catch { continue; }
      const piece = s.sourcePieceId ? (() => { try { return pieceStore().get(s.sourcePieceId!); } catch { return undefined; } })() : undefined;
      const sp = speciesOf(`${piece?.title ?? s.title ?? s.topic ?? ''} ${piece?.keyword ?? s.keyword ?? ''}`);
      if (s.igReelId) push(sp, 'ig', viewsAtAge(samples, 'meta:ig', s.metaPublishedTs ?? s.youtubeTs, now));
      if (s.youtubeId) push(sp, 'yt', viewsAtAge(samples, 'youtube:api', s.youtubeTs, now));
    }
  } catch { /* 숏폼 목록 실패 — 블로그만 */ }
  try {
    for (const p of pieceStore().list()) {
      if ((p.brand ?? '') !== slug || !p.publishedTs) continue;
      let samples: ReturnType<typeof readMetrics>;
      try { samples = readMetrics(p.id); } catch { continue; }
      push(speciesOf(`${p.title} ${p.keyword ?? ''}`), 'blog', viewsAtAge(samples, 'scrape:naver_advisor', p.publishedTs, now));
    }
  } catch { /* 글 목록 실패 — 숏폼만 */ }
  return rows;
}

/** 프롬프트 블록(순수) — 인기·저조 수종. 보관소 목록(lib)이 있으면 그 안에서만 보여 준다. 표본·점수가 없으면 빈 문자열.
 *  exclude: 지금 코드가 막는 수종(최근 수종 창·월 상한)은 '반응 좋은' 쪽에서 뺀다 — 권해 놓고 기각하지 않게. */
export function speciesPopularityBlock(
  pop: ReadonlyMap<string, SpeciesPopularity>, lib: readonly string[] = [], exclude: (sp: string) => boolean = () => false,
): string {
  const pool = [...pop.entries()].filter(([sp, v]) => (!lib.length || lib.includes(sp)) && !(v.tier === 'high' && exclude(sp)));
  const high = pool.filter(([, v]) => v.tier === 'high').sort((a, b) => b[1].score - a[1].score).slice(0, 12);
  const low = pool.filter(([, v]) => v.tier === 'low').sort((a, b) => a[1].score - b[1].score).slice(0, 10);
  if (!high.length && !low.length) return '';
  const fmt = (xs: Array<[string, SpeciesPopularity]>): string => xs.map(([sp, v]) => `${sp}(${v.score}배)`).join(', ');
  return '[수종 반응 참고 — 우리 채널 실측(인스타 중심·블로그·유튜브), 1배 = 우리 평균. 참고일 뿐 규칙이 아니다]\n' +
    (high.length ? `· 반응 좋은 수종: ${fmt(high)}\n` : '') +
    (low.length ? `· 반응 약한 수종: ${fmt(low)}\n` : '') +
    '· 같은 수종 안에서도 주제에 따라 조회가 수십 배 갈린다 — 수종보다 주제(히트 제목 꼴·실검색 연관어)를 먼저 잡아라.\n';
}
