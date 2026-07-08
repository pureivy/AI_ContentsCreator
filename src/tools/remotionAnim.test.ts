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
describe('countUpValue — ease-out 카운트업, settle 전 도달', () => {
  it('시작 0, 끝 value, 단조 증가', () => {
    expect(A.countUpValue(0, 90, 42)).toBe(0);
    expect(A.countUpValue(90, 90, 42)).toBe(42);
    expect(A.countUpValue(78, 90, 42)).toBe(42); // total - settle(12) 에서 이미 도달
    const mid1 = A.countUpValue(20, 90, 42), mid2 = A.countUpValue(40, 90, 42);
    expect(mid1).toBeGreaterThanOrEqual(0);
    expect(mid2).toBeGreaterThanOrEqual(mid1);
  });
  it('소수 value 는 소수 1자리 유지', () => {
    expect(A.countUpValue(90, 90, 3.5)).toBeCloseTo(3.5, 5);
    expect(Number.isInteger(A.countUpValue(45, 90, 42))).toBe(true);
  });
});
describe('staggerProgress — 슬롯 분배·순서·경계', () => {
  it('enter 전 0, 충분히 지나면 1, 앞 항목이 먼저', () => {
    expect(A.staggerProgress(0, 90, 0, 3)).toBe(0);
    expect(A.staggerProgress(90, 90, 2, 3)).toBe(1);
    expect(A.staggerProgress(30, 90, 0, 3)).toBeGreaterThanOrEqual(A.staggerProgress(30, 90, 1, 3));
    expect(A.staggerProgress(30, 90, 1, 3)).toBeGreaterThanOrEqual(A.staggerProgress(30, 90, 2, 3));
  });
  it('count 0 은 1(무동작), 진행도는 0..1 클램프', () => {
    expect(A.staggerProgress(50, 90, 0, 0)).toBe(1);
    expect(A.staggerProgress(9999, 90, 0, 3)).toBe(1);
  });
});
