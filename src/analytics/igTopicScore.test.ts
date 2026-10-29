import { describe, it, expect } from 'vitest';
import { igTopicScorer, IG_AXIS_MIN_N } from './igTopicScore';

// 인스타 목표일 후보 순위(2026-10-30) — 축 배수 × (세게 수축한) 수종 배수. 모르면 1(동점).

const rows = (text: string, views: number, n: number, species?: string) =>
  Array.from({ length: n }, () => ({ text, views, ...(species ? { species } : {}) }));

describe('igTopicScorer', () => {
  it('표본이 없으면 모든 후보가 1 — 동점(검색량 정렬처럼 0 으로 깎지 않는다)', () => {
    const sc = igTopicScorer([]);
    expect(sc('배롱나무 전정', '배롱나무').score).toBe(1);
  });
  it('축 배수 = 축 중앙값 ÷ 전체 중앙값, 표본 미달 축은 1', () => {
    const sc = igTopicScorer([...rows('감나무 전정', 2000, 5), ...rows('감나무 심기', 1000, 5), ...rows('감나무 화분', 500, IG_AXIS_MIN_N - 1)]);
    // 전체 중앙 1000
    expect(sc('사과나무 가지치기').axisMult).toBe(2);
    expect(sc('사과나무 심기').axisMult).toBe(1);
    expect(sc('사과나무 화분').axisMult).toBe(1);   // 4편 — 믿지 않는다
  });
  it('수종은 수축·절반 가중 — 축보다 약하다', () => {
    const sc = igTopicScorer([...rows('배롱나무 이야기', 4000, 6, '배롱나무'), ...rows('소나무 이야기', 1000, 30, '소나무')]);
    const r = sc('배롱나무 이야기', '배롱나무');
    expect(r.speciesN).toBe(6);
    // 전체 중앙 1000, 배롱 4배 → 로그의 절반(수축 6/(6+6)) × 절반(가중) = √√4 ≈ 1.41
    expect(r.speciesMult).toBeCloseTo(1.41, 2);
    expect(sc('모르는나무 이야기', '모르는나무').speciesMult).toBe(1);
  });
});
