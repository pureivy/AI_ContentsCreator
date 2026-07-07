import { describe, it, expect } from 'vitest';
// @ts-ignore — remotion/anim.ts (root tsc include 밖, JS 런타임 임포트만)
import * as A from '../../remotion/anim';

describe('kenBurnsScale', () => {
  it('시작 1, 끝 증가(≤1.12)', () => {
    expect(A.kenBurnsScale(0, 100)).toBeCloseTo(1, 3);
    expect(A.kenBurnsScale(100, 100)).toBeGreaterThan(1.05);
    expect(A.kenBurnsScale(100, 100)).toBeLessThanOrEqual(1.12);
  });
});
describe('captionWordsVisible', () => {
  it('스태거 증가, 상한 count', () => {
    expect(A.captionWordsVisible(0, 3, 6)).toBe(0);
    expect(A.captionWordsVisible(6, 3, 6)).toBe(1);
    expect(A.captionWordsVisible(600, 3, 6)).toBe(3);
  });
});
describe('sceneFadeOpacity', () => {
  it('중앙 1, 경계 0 근처', () => {
    expect(A.sceneFadeOpacity(0, 90, 6)).toBeCloseTo(0, 1);
    expect(A.sceneFadeOpacity(45, 90, 6)).toBeCloseTo(1, 1);
    expect(A.sceneFadeOpacity(90, 90, 6)).toBeLessThan(0.3);
  });
});
