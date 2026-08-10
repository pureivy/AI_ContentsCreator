import { describe, it, expect } from 'vitest';
// @ts-ignore — remotion/anim.ts (root tsc include 밖, JS 런타임 임포트만)
import * as A from '../../remotion/anim';

describe('kenBurnsScale', () => {
  it('시작 1, 끝 증가(≤1.12)', () => {
    expect(A.kenBurnsScale(0, 100)).toBeCloseTo(1, 3);
    expect(A.kenBurnsScale(100, 100)).toBeGreaterThan(1.05);
    expect(A.kenBurnsScale(100, 100)).toBeLessThanOrEqual(1.12);
  });
  it('씬별 변주 — 홀수 index 는 줌아웃(max→1)', () => {
    expect(A.kenBurnsScale(0, 100, 1.08, 1)).toBeCloseTo(1.08, 3);
    expect(A.kenBurnsScale(100, 100, 1.08, 1)).toBeCloseTo(1, 3);
  });
});
describe('smoothstep — 이징 곡선', () => {
  it('경계 0/1, 중앙 0.5, 선형보다 완만한 시작', () => {
    expect(A.smoothstep(0)).toBe(0);
    expect(A.smoothstep(1)).toBe(1);
    expect(A.smoothstep(0.5)).toBeCloseTo(0.5, 5);
    expect(A.smoothstep(0.1)).toBeLessThan(0.1); // ease-in 구간
  });
});
describe('kenBurnsPan — 방향 4종 순환', () => {
  it('index 별 방향이 다르고, 시작·끝 대칭(±12px)', () => {
    const p0 = A.kenBurnsPan(100, 100, 0), p1 = A.kenBurnsPan(100, 100, 1);
    expect(p0.x).toBeCloseTo(12, 3); expect(p0.y).toBeCloseTo(-12, 3);
    expect(p1.x).toBeCloseTo(-12, 3); expect(p1.y).toBeCloseTo(12, 3);
    expect(A.kenBurnsPan(0, 100, 0).x).toBeCloseTo(-12, 3);
  });
});
describe('sceneEnterFade — 씬 시작 페이드인', () => {
  it('0에서 0, fade 프레임에 1, 이후 유지', () => {
    expect(A.sceneEnterFade(0, 6)).toBe(0);
    expect(A.sceneEnterFade(6, 6)).toBe(1);
    expect(A.sceneEnterFade(999, 6)).toBe(1);
  });
});
describe('captionWordProgress — 단어별 부드러운 등장', () => {
  it('앞 단어가 먼저 완료, rise 동안 0..1 단조 증가', () => {
    expect(A.captionWordProgress(0, 0)).toBe(0);
    expect(A.captionWordProgress(5, 0)).toBe(1);   // rise=5 완료
    expect(A.captionWordProgress(5, 1)).toBeLessThan(1); // 둘째 단어는 아직
    const a = A.captionWordProgress(2, 0), b = A.captionWordProgress(3, 0);
    expect(b).toBeGreaterThanOrEqual(a);
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

describe('kenBurnsMove — 확장 무브(폴백=현행 index parity)', () => {
  it('move 미지정 = 종전 kenBurnsScale/Pan 과 동일(폴백 불변)', () => {
    const m0 = A.kenBurnsMove(50, 100, 0), m1 = A.kenBurnsMove(50, 100, 1);
    expect(m0.scale).toBeCloseTo(A.kenBurnsScale(50, 100, 1.08, 0), 6);
    expect(m1.scale).toBeCloseTo(A.kenBurnsScale(50, 100, 1.08, 1), 6);
    expect(m0.x).toBeCloseTo(A.kenBurnsPan(50, 100, 0).x, 6);
    expect(m0.rotate).toBe(0);
  });
  it('push = 강줌(1→1.15) + 미세 회전(≤1.2°) + 팬 절반', () => {
    expect(A.kenBurnsMove(0, 100, 0, 'push').scale).toBeCloseTo(1, 3);
    expect(A.kenBurnsMove(100, 100, 0, 'push').scale).toBeCloseTo(1.15, 3);
    expect(A.kenBurnsMove(100, 100, 0, 'push').rotate).toBeCloseTo(1.2, 3);
    expect(Math.abs(A.kenBurnsMove(100, 100, 0, 'push').x)).toBeLessThanOrEqual(6.01);
  });
  it('intensity 캡 — subtle 1.04 / strong 1.15, zoom-out 은 역방향', () => {
    expect(A.kenBurnsMove(100, 100, 0, 'zoom-in', 'subtle').scale).toBeCloseTo(1.04, 3);
    expect(A.kenBurnsMove(100, 100, 0, 'zoom-in', 'strong').scale).toBeCloseTo(1.15, 3);
    expect(A.kenBurnsMove(0, 100, 0, 'zoom-out', 'strong').scale).toBeCloseTo(1.15, 3);
    expect(A.kenBurnsMove(100, 100, 0, 'zoom-out', 'strong').scale).toBeCloseTo(1, 3);
  });
  it('none = 완전 정지(스케일 1·팬 0·회전 0)', () => {
    expect(A.kenBurnsMove(70, 100, 3, 'none')).toEqual({ scale: 1, x: 0, y: 0, rotate: 0 });
  });
});
