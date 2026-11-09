import { describe, it, expect } from 'vitest';
import { seasonOutliers, SEASON_WORDS } from './shortsSceneQa';

const none = [false, false, false, false];

describe('seasonOutliers — 계절 섞임', () => {
  it('다수와 다른 장을 고른다', () => {
    expect(seasonOutliers(['초록', '초록', '단풍', '초록'], none, 7)).toEqual({ base: '초록', outliers: [2] });
  });
  it('동수면 이 달에 맞는 쪽이 기준 — 11월 FLUX.3 시험 숏폼(단풍 2 · 초록 2)', () => {
    expect(seasonOutliers(['단풍', '초록', '초록', '단풍'], none, 11)).toEqual({ base: '단풍', outliers: [1, 2] });
    expect(seasonOutliers(['단풍', '초록', '초록', '단풍'], none, 7)).toEqual({ base: '초록', outliers: [0, 3] });
  });
  it('모두 같거나·판단불가·일부러 다른 계절인 장은 건드리지 않는다', () => {
    expect(seasonOutliers(['초록', '초록', '초록'], none, 11).outliers).toEqual([]);
    expect(seasonOutliers(['초록', '판단불가', null, '초록'], none, 11).outliers).toEqual([]);
    expect(seasonOutliers(['초록', '초록', '새순'], [false, false, true], 11).outliers).toEqual([]);
    expect(seasonOutliers(['초록', '단풍'], [false, true], 11).outliers).toEqual([]); // 비교 대상 1장
  });
  it('계절 말 — 내레이션이 다른 계절을 직접 말하는지', () => {
    for (const t of ['봄에 새순이 나면', '가을엔 단풍', '3월에 심어요', '잎이 지면 다시 묶어요', '꽃이 피는 자리']) expect(SEASON_WORDS.test(t)).toBe(true);
    for (const t of ['줄기 수만큼 줄을 거세요', '끈은 느슨하게 묶으세요']) expect(SEASON_WORDS.test(t)).toBe(false);
  });
});
