import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { statInflowPeriods, periodsArg, parseRefererDump, columnarRows } from './naverReferer';
import { topInflow, type MetricSample } from './performance';
import { performanceSignal } from './reinforce';

// 실측 덤프(2026-10-02, 글 224427392358 — 감나무 묘목 글): naver_stats.py --referer-out 출력 그대로.
const REAL = JSON.parse(fs.readFileSync(new URL('./fixtures/naver_stat_referer.224427392358.json', import.meta.url), 'utf-8')) as unknown;

describe('statInflowPeriods — 발행일~지금을 겹치지 않게 덮는다(KST)', () => {
  it('지난 달 발행 → 지난 달 MONTH + 이번 달 날짜(오늘 포함)', () => {
    const ps = statInflowPeriods('2026-09-30T10:40:42.489Z', new Date('2026-10-02T08:00:00Z'));
    expect(periodsArg(ps)).toBe('MONTH:2026-09-01,DATE:2026-10-01,DATE:2026-10-02');
  });

  it('이번 달: 월요일 시작·이틀 전까지 끝난 주만 WEEK, 나머지는 DATE', () => {
    // 10-01(목) 발행, 오늘 10-14(수): 10-05 주(~10-11)는 끝남, 10-12 주는 진행 중
    const ps = statInflowPeriods('2026-10-01T03:00:00Z', new Date('2026-10-14T03:00:00Z'));
    expect(periodsArg(ps)).toBe(
      'DATE:2026-10-01,DATE:2026-10-02,DATE:2026-10-03,DATE:2026-10-04,WEEK:2026-10-05,DATE:2026-10-12,DATE:2026-10-13,DATE:2026-10-14');
  });

  it('주가 어제 끝났으면(월요일 새벽) 아직 WEEK 로 묻지 않는다 — 주간 롤업 전', () => {
    const ps = statInflowPeriods('2026-10-05T03:00:00Z', new Date('2026-10-12T03:00:00Z')); // 오늘=월
    expect(ps.every((p) => p.dim === 'DATE')).toBe(true);
    expect(ps).toHaveLength(8);
  });

  it('오래된 글은 최근 maxMonths 개월만(앞은 빠진다)', () => {
    const ps = statInflowPeriods('2025-12-15T00:00:00Z', new Date('2026-10-02T03:00:00Z'), 6);
    expect(ps.filter((p) => p.dim === 'MONTH').map((p) => p.start))
      .toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('KST 경계 — UTC 09-30 16:00 은 KST 10-01 발행', () => {
    expect(periodsArg(statInflowPeriods('2026-09-30T16:00:00Z', new Date('2026-10-01T05:00:00Z')))).toBe('DATE:2026-10-01');
  });

  it('발행일 없음·파싱 불가·미래 → 빈 목록(수집 생략)', () => {
    expect(statInflowPeriods(undefined)).toEqual([]);
    expect(statInflowPeriods('garbage')).toEqual([]);
    expect(statInflowPeriods('2026-12-01T00:00:00Z', new Date('2026-10-02T00:00:00Z'))).toEqual([]);
  });
});

describe('parseRefererDump — 글별 검색어 누적', () => {
  it('실측 덤프: 도메인별 상세를 기간 넘어 합산, 검색 엔진만 searchCv', () => {
    const s = parseRefererDump(REAL);
    expect(s.ok).toBe(true);
    expect(s.periodsOk).toBe(3);
    expect(s.periodsFailed).toBe(0);
    expect(s.totalCv).toBe(17);
    expect(s.searchCv).toBe(13);
    expect(s.missingQueryCv).toBe(0); // 상세 합 == 검색 도메인 유입 합 — 잘린 것 없음
    expect(s.distinctQueries).toBe(10);
    // '감나무 묘목'은 10-01 통합검색_모바일 1 + 통합검색_PC 1 + 9월 2 → 4(도메인·기간 합산)
    expect(s.inflow[0]).toEqual({ keyword: '감나무 묘목', count: 4 });
    expect(s.inflow.reduce((n, k) => n + k.count, 0)).toBe(13);
    expect(s.since).toBe('2026-09-01');
  });

  it('limit 으로 자르고, 네이버가 주지 않는 검색 순위(rank)는 만들지 않는다', () => {
    const s = parseRefererDump(REAL, 3);
    expect(s.inflow).toHaveLength(3);
    expect(s.inflow.every((k) => k.rank === undefined)).toBe(true);
    expect(s.distinctQueries).toBe(10);
  });

  it('expanded(롤업 전이라 DATE 로 쪼갠) 기간은 합산하지 않고, 실패 기간은 센다 — 실패가 하나라도 있으면 ok=false(누적 과소 계상)', () => {
    const total = { rows: { referrerDomain: ['네이버 통합검색_모바일'], referrerSearchEngine: ['1'], cv: [2] } };
    const detail = { rows: { searchQuery: ['배롱나무 겨울전정'], cv: [2] } };
    const s = parseRefererDump({ periods: [
      { dim: 'MONTH', start: '2026-09-01', status: 500, expanded: true },
      { dim: 'DATE', start: '2026-09-01', status: 200, total, details: [{ domain: '네이버 통합검색_모바일', status: 200, data: detail }] },
      { dim: 'DATE', start: '2026-09-02', status: 0, total: null, details: [] },
    ] });
    expect(s.ok).toBe(false); // 일부 기간만 합친 값은 누적 검색 유입으로 쓰지 않는다(2차 리뷰)
    expect(s.periodsOk).toBe(1);
    expect(s.periodsFailed).toBe(1);
    expect(s.inflow).toEqual([{ keyword: '배롱나무 겨울전정', count: 2 }]);
  });

  it('검색 엔진 아닌 도메인(referrerSearchEngine "0")은 searchCv 에서 빠지고, 상세 실패분은 missing 으로 드러난다', () => {
    const total = { rows: { referrerDomain: ['네이버 블로그_모바일', 'Google', '네이버 통합검색_PC'], referrerSearchEngine: ['0', '0', '1'], cv: [5, 1, 3] } };
    const s = parseRefererDump({ periods: [
      { dim: 'DATE', start: '2026-10-01', status: 200, total, details: [{ domain: '네이버 통합검색_PC', status: 500, data: null }] },
    ] });
    expect(s.totalCv).toBe(9);
    expect(s.searchCv).toBe(3);
    expect(s.missingQueryCv).toBe(3);
    expect(s.inflow).toEqual([]);
    expect(s.ok).toBe(true); // 기간은 성공 — 검색어만 비었다
  });

  it("'기타' 묶음은 검색어가 아니다 — 빼고 missing 으로", () => {
    const total = { rows: { referrerDomain: ['네이버 통합검색_모바일'], referrerSearchEngine: ['1'], cv: [10] } };
    const detail = { rows: { searchQuery: ['감나무 묘목', '기타'], cv: [4, 6] } };
    const s = parseRefererDump({ periods: [{ dim: 'WEEK', start: '2026-09-21', status: 200, total, details: [{ domain: '네이버 통합검색_모바일', status: 200, data: detail }] }] });
    expect(s.inflow.map((k) => k.keyword)).toEqual(['감나무 묘목']);
    expect(s.missingQueryCv).toBe(6);
  });

  it('열 길이가 어긋나면 짧은 쪽까지만(꼬리 버림), 숫자 아닌 cv 는 0', () => {
    expect(columnarRows({ rows: { searchQuery: ['a', 'b', 'c'], cv: [1, 'x'] } }, ['searchQuery', 'cv']))
      .toEqual([{ searchQuery: 'a', cv: 1 }, { searchQuery: 'b', cv: 'x' }]);
    const s = parseRefererDump({ periods: [{ dim: 'DATE', start: '2026-10-01', status: 200,
      total: { rows: { referrerDomain: ['d'], referrerSearchEngine: ['1'], cv: [3] } },
      details: [{ domain: 'd', status: 200, data: { rows: { searchQuery: ['a', 'b', 'c'], cv: [1, 'x'] } } }] }] });
    expect(s.inflow).toEqual([{ keyword: 'a', count: 1 }]);
  });

  it('깨진 입력은 ok=false(호출부가 종전 값 유지)', () => {
    for (const bad of [null, undefined, 'x', 42, {}, { periods: 'x' }, { periods: [null, 1, 'a'] }, { periods: [{ status: 500 }] }]) {
      const s = parseRefererDump(bad);
      expect(s.ok).toBe(false);
      expect(s.inflow).toEqual([]);
    }
    expect(columnarRows(null, ['cv'])).toEqual([]);
    expect(columnarRows({ rows: { cv: 'x' } }, ['cv'])).toEqual([]);
  });

  it('상한에 걸려 중단된 덤프(aborted)는 성공 기간이 있어도 ok=false — 일부 기간 합은 과소 계상(리뷰 2026-10-02)', () => {
    expect(parseRefererDump(REAL).ok).toBe(true);
    const cut = { ...(REAL as object), aborted: '연속 실패 3회' };
    const s = parseRefererDump(cut);
    expect(s.ok).toBe(false);
    expect(s.inflow).toEqual([]);
    expect(s.searchCv).toBe(0);
  });
});

describe('하위호환 — 옛 표본(searchCv 없음·빈 유입)과 새 표본이 섞여도', () => {
  const old: MetricSample = { measuredAt: '2026-09-20T00:00:00Z', views: 100, searchInflow: [], source: 'scrape:naver_advisor' };
  const fresh: MetricSample = {
    measuredAt: '2026-10-02T00:00:00Z', views: 120, searchCv: 13, source: 'scrape:naver_advisor',
    searchInflow: parseRefererDump(REAL).inflow,
  };
  it('topInflow 는 누적값 최대 병합 그대로 — 새 표본의 검색어가 보인다', () => {
    expect(topInflow([old, fresh], 2)).toEqual([{ keyword: '감나무 묘목', count: 4 }, { keyword: '1년생감나무묘목', count: 1 }]);
    expect(topInflow([old])).toEqual([]);
  });
  it('performanceSignal 은 옛 표본에서 종전 값(유입 0)', () => {
    expect(performanceSignal(old)).toBeCloseTo(0.7 * Math.log10(101) / 3, 6);
    expect(performanceSignal(fresh)).toBeGreaterThan(performanceSignal({ ...fresh, searchInflow: [] }));
  });
});
