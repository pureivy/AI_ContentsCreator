/**
 * 인스타 목표일 후보 순위(2026-10-30 사장님 확정 "채널별 신호 혼합") — 우리 인스타 실적으로 후보를 줄 세운다.
 *
 * 왜 인스타 목표일만인가. 채널마다 조회를 만드는 레버가 다르다.
 *  · 블로그: 네이버 검색으로 들어온다 → 지금 철 검색량이 가장 정확한 예측(종전 정렬 그대로).
 *  · 유튜브: 피드가 편마다 ~1,000 을 주고 멈춘다(주제별 924~1,142) → 주제 순위에 쓸 신호가 없다.
 *  · 인스타: 주제에 4배 반응한다(배롱나무 2,757 vs 기타 619) → 우리 실적이 곧 신호.
 * 그래서 인스타 목표일에만 정렬 2차 키를 검색량에서 이 점수로 바꾼다. 1차 키(계열 soft 뒤로)와 모든 게이트는 그대로다.
 *
 * 점수 = 축 배수 × 수종 배수.
 *  · 축 배수: 그 축 중앙값 ÷ 전체 중앙값(표본 AXIS_MIN_N 편 미만 축은 1).
 *  · 수종 배수: 수축을 세게 건 로그 배수의 절반 — 10-07 실측에서 수종이 인스타 조회 차이를 설명하는 몫은 0.02뿐이고,
 *    같은 수종 안 편차(블루베리 216~9,284)가 더 컸다. 축이 주, 수종은 보조.
 *  · 조회는 고정 나이(게시 7~14일, speciesPopularity.viewsAtAge)로 잰다 — 최신 누적값이면 오래된 편이 유리하다.
 *  · 모르면 1(동점) — 0 으로 깎으면 표본 없는 수종이 영영 뒤로 밀린다(하스카프베리가 처음엔 목록 밖이었다).
 * 공유 수는 쓰지 않는다 — 편당 0~7 이고 중앙값이 0 이라 순위를 못 가른다.
 */
import { classifyAxis } from './igAxis';
import { viewsAtAge } from './speciesPopularity';
import { readMetrics } from './performance';
import { shortsStore } from '../content/shorts';
import { pieceStore } from '../content/pieces';

export interface IgTopicRow { text: string; species?: string; views: number }
export interface IgTopicScore { score: number; axis: string; axisMult: number; speciesMult: number; speciesN: number }

/** 축 배수를 믿는 최소 표본 — igAxis.axisPerformance 의 minCount 와 같다. */
export const IG_AXIS_MIN_N = 5;
/** 수종 수축 강도 — 표본 n 편이 '평균(1배)' k 편과 맞선다. 6 이면 6편 쌓여야 실측이 절반을 차지한다. */
export const IG_SPECIES_PRIOR_N = 6;
/** 수종 몫(로그 공간 가중) — 축이 주라서 절반. */
export const IG_SPECIES_WEIGHT = 0.5;

function median(a: readonly number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 실적 행 → 후보 채점기(순수). 표본이 없으면 모든 후보가 1(동점)이다. */
export function igTopicScorer(rows: readonly IgTopicRow[]): (text: string, species?: string) => IgTopicScore {
  const ok = rows.filter((r) => Number.isFinite(r.views) && r.views >= 0);
  const all = median(ok.map((r) => r.views));
  const byAxis = new Map<string, number[]>();
  const bySp = new Map<string, number[]>();
  for (const r of ok) {
    const a = classifyAxis(r.text);
    byAxis.set(a, [...(byAxis.get(a) ?? []), r.views]);
    if (r.species) bySp.set(r.species, [...(bySp.get(r.species) ?? []), r.views]);
  }
  const axisMult = new Map<string, number>();
  for (const [a, vs] of byAxis) if (vs.length >= IG_AXIS_MIN_N && all > 0) axisMult.set(a, median(vs) / all);
  return (text, species) => {
    const axis = classifyAxis(text);
    const am = axisMult.get(axis) ?? 1;
    const xs = species ? bySp.get(species) ?? [] : [];
    const lObs = xs.length && all > 0 ? Math.log(Math.max(median(xs), 1) / all) : 0;
    const sm = Math.exp(IG_SPECIES_WEIGHT * (xs.length / (xs.length + IG_SPECIES_PRIOR_N)) * lObs);
    const r2 = (x: number): number => Math.round(x * 100) / 100;
    return { score: r2(am * sm), axis, axisMult: r2(am), speciesMult: r2(sm), speciesN: xs.length };
  };
}

/** 브랜드 릴스의 고정 나이 인스타 조회 행. 텍스트는 원본 글 제목·키워드 우선(후보도 글 제목·키워드로 채점하므로). */
export function collectIgTopicRows(
  slug: string, speciesOf: (text: string) => string | undefined, now = Date.now(),
): IgTopicRow[] {
  const rows: IgTopicRow[] = [];
  try {
    for (const s of shortsStore().list()) {
      if ((s.brand ?? '') !== slug || !s.igReelId) continue;
      try {
        const v = viewsAtAge(readMetrics(s.id), 'meta:ig', s.metaPublishedTs ?? s.youtubeTs, now);
        if (v === null) continue;
        const piece = s.sourcePieceId ? (() => { try { return pieceStore().get(s.sourcePieceId!); } catch { return undefined; } })() : undefined;
        const text = piece ? `${piece.title} ${piece.keyword ?? ''}` : `${s.title ?? ''} ${s.topic ?? ''} ${s.keyword ?? ''}`;
        rows.push({ text, species: speciesOf(text), views: v });
      } catch { /* 이 편만 건너뛴다 */ }
    }
  } catch { /* 목록 실패 — 빈 행(전부 동점) */ }
  return rows;
}
