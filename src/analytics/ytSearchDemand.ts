/**
 * 우리 채널이 실제로 받는 유튜브 검색어 → 주제 제안 신호(2026-09-04 사용자 확정).
 *
 * 왜 이걸 쓰는가. 09-02 이후 쇼츠 피드 노출이 끊겼는데 검색 유입만 살아남았다(7월 하루 30회 →
 * 8월 말 340회로 오히려 자랐다). 그리고 평탄선 1,050 을 넘긴 두 편은 둘 다 검색으로 넘겼다:
 *   1,865 회 = 피드 686 + 검색 1,085   "하스카프베리 묘목, 지금 심으면 늦는 이유"
 *   2,051 회 = 피드 1,038 + 검색 461   "포도나무 수확 시기, 색보다 아래쪽 알로 가늠하세요"
 * 즉 이 채널에서 재현 가능한 성장 축은 검색이고, 제목이 실제 검색어일 때만 걸린다.
 *
 * 외부 수요 데이터(네이버 검색광고)를 대체하지 않는다. 저건 '아직 안 만든 주제'의 수요를 보고,
 * 이건 '이미 우리가 먹고 있는 말'을 본다 — 후자는 생존자 편향이라 그것만 보면 새 소재를 못 찾는다.
 * 두 축을 같이 쓴다.
 */
import type { SearchInflow } from './performance';

/** 주제 제안에 넘길 검색어 한 줄. */
export interface SearchDemandRow {
  readonly keyword: string;
  /** 이 검색어로 들어온 조회수(편별 최대값의 합). */
  readonly count: number;
  /** 이 말을 정면으로 다룬 편이 이미 있는가 — 없는 쪽이 우선 후보다. */
  readonly covered: boolean;
}

/**
 * 잡음 하한(2026-09-04 실측). 수집된 검색어에는 우리와 무관한 트렌드어가 1~3회씩 섞인다
 * ("감스트 리중딱", "박위 학폭", "네팔홍수장면"). 이걸 주제 제안에 넣으면 두뇌가 엉뚱한
 * 소재를 만들어 낸다. 조회 3회 미만은 버린다 — 진짜 수요라면 그보다는 붙는다.
 */
export const MIN_SEARCH_COUNT = 3;

/** 검색어 정규화 — 띄어쓰기·대소문자만 무시한다("고무나무 삽목" 과 "고무나무삽목" 은 같은 말이다). */
export function normalizeTerm(s: string): string {
  return String(s ?? '').replace(/\s+/g, '').toLowerCase();
}

/**
 * 편별 검색어를 모아 순위를 매긴다(순수).
 *
 * 같은 말이 여러 편에 붙으면 합산한다 — 한 검색어의 총수요를 보려는 것이지 편별 성적이 아니다.
 * 띄어쓰기만 다른 표기는 하나로 합치고, 표기는 조회가 가장 많았던 쪽을 대표로 남긴다.
 *
 * isRelevant 는 호출부가 준다(수종 사전·브랜드 업종어). 도메인 지식을 이 순수 함수에 넣지 않는
 * 이유는, 그 판정이 브랜드마다 다르고 데이터에서 오기 때문이다.
 */
export function rankSearchDemand(
  perVideo: ReadonlyArray<{ terms: readonly SearchInflow[] }>,
  opts: {
    /** 이 말을 정면으로 다룬 편이 이미 있는가. */
    isCovered: (keyword: string) => boolean;
    /** 우리 분야의 말인가 — 무관한 트렌드어를 거른다. */
    isRelevant: (keyword: string) => boolean;
    minCount?: number;
    limit?: number;
  },
): SearchDemandRow[] {
  const min = opts.minCount ?? MIN_SEARCH_COUNT;
  const agg = new Map<string, { label: string; best: number; total: number }>();
  for (const v of perVideo) {
    for (const t of v.terms ?? []) {
      const label = String(t?.keyword ?? '').trim();
      const count = Number(t?.count);
      if (!label || !Number.isFinite(count) || count <= 0) continue;
      const key = normalizeTerm(label);
      if (!key) continue;
      const cur = agg.get(key) ?? { label, best: 0, total: 0 };
      cur.total += count;
      if (count > cur.best) { cur.best = count; cur.label = label; } // 대표 표기 = 가장 많이 걸린 표기
      agg.set(key, cur);
    }
  }
  return [...agg.values()]
    .filter((r) => r.total >= min)
    .filter((r) => { try { return opts.isRelevant(r.label); } catch { return false; } })
    .map((r) => ({
      keyword: r.label,
      count: r.total,
      covered: (() => { try { return opts.isCovered(r.label); } catch { return true; } })(), // 판정 실패는 '있음'으로 — 중복 제안보다 낫다
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.limit ?? 20);
}

/**
 * 주제 제안 프롬프트에 넣을 블록(순수).
 *
 * 편이 없는 말을 위로 올린다 — 수요가 이미 확인됐는데 우리가 안 만든 자리다. 다만 "이것만
 * 만들어라"로는 쓰지 않는다: 이 목록은 우리가 이미 잡은 말만 보여 주는 생존자 편향이라,
 * 여기에만 매달리면 새 소재를 영영 못 찾는다.
 */
export function searchDemandBlock(rows: readonly SearchDemandRow[]): string {
  if (!rows.length) return '';
  const open = rows.filter((r) => !r.covered);
  const line = (r: SearchDemandRow): string => `- ${r.keyword} (${r.count}회)${r.covered ? ' — 이미 다룬 말' : ''}`;
  return [
    '[우리 채널이 실제로 받는 유튜브 검색어 — 추정이 아니라 실측값이다]',
    ...rows.map(line),
    '',
    open.length
      ? `· "이미 다룬 말" 표시가 없는 검색어를 우선 고려하라 — 수요는 확인됐는데 우리가 아직 안 만든 자리다(${open.map((r) => r.keyword).slice(0, 5).join(', ')}).`
      : '· 위 검색어는 모두 이미 다뤘다 — 인접한 말(같은 소재의 다른 궁금증)로 넓혀라.',
    '· 이 목록에서 고를 때는 keyword 를 그 검색어 표기 그대로 잡아라. 사람들이 그렇게 친다.',
    '· 다만 이 목록은 우리가 이미 걸린 말만 보여 준다. 여기 없는 새 소재를 막는 뜻이 아니다.',
  ].join('\n');
}
