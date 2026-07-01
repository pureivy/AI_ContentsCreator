import { describe, it, expect } from 'vitest';
import { parseManualMetrics } from './performance';
import { performanceSignal } from './reinforce';

describe('parseManualMetrics (수동 성과 입력 정규화)', () => {
  it('구조화 JSON 을 안전 파싱(유입 키워드 포함)', () => {
    const m = parseManualMetrics({ views: 1200, dwellSec: 95, searchInflow: [{ keyword: '홈카페 원두', count: 340, rank: 3 }, { keyword: '원두 보관', count: 120 }] });
    expect(m.views).toBe(1200);
    expect(m.dwellSec).toBe(95);
    expect(m.searchInflow).toHaveLength(2);
    expect(m.searchInflow[0]).toEqual({ keyword: '홈카페 원두', count: 340, rank: 3 });
    expect(m.searchInflow[1]).toEqual({ keyword: '원두 보관', count: 120 }); // rank 없으면 생략
    expect(m.source).toBe('manual');
  });

  it('잘못된/누락 필드는 0·빈배열로 방어(빈 keyword 유입은 버림)', () => {
    const m = parseManualMetrics({ views: 'x', searchInflow: [{ keyword: '', count: 5 }, { count: 9 }, 'junk'] });
    expect(m.views).toBe(0);
    expect(m.dwellSec).toBeUndefined();
    expect(m.searchInflow).toEqual([]);
  });

  it('객체가 아니면 전부 기본값', () => {
    const m = parseManualMetrics(null);
    expect(m.views).toBe(0);
    expect(m.searchInflow).toEqual([]);
  });
});

describe('performanceSignal (성과 → 스칼라, 0~1)', () => {
  it('조회수가 많을수록 단조 증가, [0,1] 경계', () => {
    const s0 = performanceSignal({ measuredAt: '', views: 0, searchInflow: [] });
    const s1 = performanceSignal({ measuredAt: '', views: 100, searchInflow: [] });
    const s2 = performanceSignal({ measuredAt: '', views: 5000, searchInflow: [] });
    expect(s0).toBeGreaterThanOrEqual(0);
    expect(s0).toBeLessThan(s1);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThanOrEqual(1);
  });

  it('유입 키워드 다양성이 신호를 높인다(같은 조회수)', () => {
    const few = performanceSignal({ measuredAt: '', views: 500, searchInflow: [{ keyword: 'a', count: 1 }] });
    const many = performanceSignal({ measuredAt: '', views: 500, searchInflow: Array.from({ length: 10 }, (_, i) => ({ keyword: `k${i}`, count: 1 })) });
    expect(many).toBeGreaterThan(few);
  });
});
