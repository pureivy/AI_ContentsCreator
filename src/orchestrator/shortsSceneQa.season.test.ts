import { describe, it, expect } from 'vitest';
import { seasonOutliers, SEASON_WORDS, seasonPromptLine, otherSeasonMentioned } from './shortsSceneQa';

const none = [false, false, false, false];

describe('seasonOutliers — 계절 섞임', () => {
  it('다수와 다른 장을 고른다', () => {
    expect(seasonOutliers(['초록', '초록', '단풍', '초록'], none, 7)).toMatchObject({ base: '초록', outliers: [2] });
  });
  it('동수면 이 달에 맞는 쪽이 기준 — 11월 FLUX.3 시험 숏폼(단풍 2 · 초록 2)', () => {
    expect(seasonOutliers(['단풍', '초록', '초록', '단풍'], none, 10)).toMatchObject({ base: '단풍', outliers: [1, 2], offMonth: [] });
    // 11월엔 초록이 맞지 않는다(2026-11-10 감나무 시험 — 11월 연두 새잎 사진이 통과했다)
    expect(seasonOutliers(['단풍', '초록', '초록', '단풍'], none, 11)).toMatchObject({ base: '단풍', outliers: [1, 2], offMonth: [1, 2] });
    expect(seasonOutliers(['단풍', '초록', '초록', '단풍'], none, 7)).toMatchObject({ base: '초록', outliers: [0, 3], offMonth: [0, 3] });
  });
  it('모두 같거나·판단불가·일부러 다른 계절인 장은 건드리지 않는다', () => {
    expect(seasonOutliers(['초록', '초록', '초록'], none, 10).outliers).toEqual([]);
    expect(seasonOutliers(['초록', '판단불가', null, '초록'], none, 10).outliers).toEqual([]);
    expect(seasonOutliers(['초록', '초록', '새순'], [false, false, true], 10).outliers).toEqual([]);
    expect(seasonOutliers(['초록', '단풍'], [false, true], 10).outliers).toEqual([]); // 비교 대상 1장
  });
  it('계절 말 — 내레이션이 다른 계절을 직접 말하는지', () => {
    for (const t of ['봄에 새순이 나면', '가을엔 단풍', '3월에 심어요', '잎이 지면 다시 묶어요', '꽃이 피는 자리']) expect(SEASON_WORDS.test(t)).toBe(true);
    for (const t of ['줄기 수만큼 줄을 거세요', '끈은 느슨하게 묶으세요']) expect(SEASON_WORDS.test(t)).toBe(false);
  });
  it('모두 같아도 이 달에 안 맞으면 고른다(2026-11-10) — 1월에 전부 초록', () => {
    expect(seasonOutliers(['초록', '초록', '초록'], [false, false, false], 1)).toEqual({ base: '맨가지', outliers: [0, 1, 2], offMonth: [0, 1, 2] });
    expect(seasonOutliers(['초록'], [false], 1).outliers).toEqual([0]); // 한 장이어도
    expect(seasonOutliers(['초록', '초록'], [false, false], 1, true).outliers).toEqual([]); // 상록수
  });
  it('계절 그림 지시 — 장면이 계절을 말하면 뺀다', () => {
    expect(seasonPromptLine(11, '지주 두 개를 세운 감나무')).toContain('late autumn');
    expect(seasonPromptLine(11, 'summer persimmon sapling')).toBe('');
    expect(seasonPromptLine(11, '봄에 새순이 돋은 가지')).toBe('');
    // 지금 계절을 말하면 지시를 남긴다(2026-11-10 사장님 "지금 계절과 다른 계절을 말할 때만 빼기") — '감나무 겨울 지지대'
    expect(seasonPromptLine(11, '감나무 겨울 지지대, 지주 두 개')).toContain('late autumn');
    expect(seasonPromptLine(11, 'leafless persimmon sapling')).toContain('late autumn');
    expect(seasonPromptLine(1, '소나무', true)).toContain('evergreen');
  });
  it('다른 계절만 뺀다 — otherSeasonMentioned', () => {
    expect(otherSeasonMentioned('감나무 겨울 지지대', 11)).toBe(false);
    expect(otherSeasonMentioned('가을에 낙엽이 지면', 11)).toBe(false);
    expect(otherSeasonMentioned('12월에 묶어요', 11)).toBe(false);
    expect(otherSeasonMentioned('봄에 흔들어 안 움직이면 풀어요', 11)).toBe(true);
    expect(otherSeasonMentioned('여름 장마 전에', 11)).toBe(true);
    expect(otherSeasonMentioned('3월에 심어요', 11)).toBe(true);
    expect(otherSeasonMentioned('11월 지지대', 10)).toBe(false); // '11월' 안의 '1월'(겨울)로 읽지 않는다
    expect(otherSeasonMentioned('끈은 느슨하게', 11)).toBe(false);
  });
});
