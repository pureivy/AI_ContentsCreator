import { describe, it, expect } from 'vitest';
import { sceneDurationSec, sceneFrames, fmtSrtTime, buildSrt } from './shortsCommon';

describe('sceneDurationSec — 오디오가 길이 지배 + 하한 클램프', () => {
  it('오디오 + 꼬리여백(0.6), 하한 2.8', () => {
    expect(sceneDurationSec(5)).toBeCloseTo(5.6, 5);
    expect(sceneDurationSec(1)).toBeCloseTo(2.8, 5);
    expect(sceneDurationSec(0)).toBeCloseTo(2.8, 5);
    expect(sceneDurationSec(-1)).toBeCloseTo(2.8, 5);
  });
});
describe('sceneFrames — 30fps 반올림', () => {
  it('초 × 30 반올림', () => {
    expect(sceneFrames(2.8)).toBe(84);
    expect(sceneFrames(5.6)).toBe(168);
    expect(sceneFrames(3.017)).toBe(91);
  });
});
describe('fmtSrtTime — SRT 타임코드', () => {
  it('HH:MM:SS,mmm', () => {
    expect(fmtSrtTime(0)).toBe('00:00:00,000');
    expect(fmtSrtTime(3.5)).toBe('00:00:03,500');
    expect(fmtSrtTime(3661.25)).toBe('01:01:01,250');
  });
});
describe('buildSrt — 누적 타이밍', () => {
  it('씬 순서대로 누적 시작/끝', () => {
    expect(buildSrt([
      { narration: '첫 씬', durationSec: 3 },
      { narration: '둘째 씬', durationSec: 2 },
    ])).toBe('1\n00:00:00,000 --> 00:00:03,000\n첫 씬\n\n2\n00:00:03,000 --> 00:00:05,000\n둘째 씬\n');
  });
});
