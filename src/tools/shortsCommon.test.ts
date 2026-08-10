import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { sceneDurationSec, sceneFrames, fmtSrtTime, buildSrt, normalizeSceneKind, resolveClipSrc } from './shortsCommon';

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
describe('normalizeSceneKind — 검증 추출, 실패 시 {} 강등', () => {
  it('hook/cta 는 페이로드 없이 통과, 대소문자·공백 정규화', () => {
    expect(normalizeSceneKind({ kind: 'hook' })).toEqual({ kind: 'hook' });
    expect(normalizeSceneKind({ kind: ' CTA ' })).toEqual({ kind: 'cta' });
  });
  it('미지 kind·kind 없음 은 {}', () => {
    expect(normalizeSceneKind({ kind: 'banner' })).toEqual({});
    expect(normalizeSceneKind({})).toEqual({});
    expect(normalizeSceneKind(null)).toEqual({});
  });
  it('stat — 콤마 문자열 파싱, 비수치 강등, unit 6자·label 15자 캡', () => {
    expect(normalizeSceneKind({ kind: 'stat', stat: { value: '1,200', unit: '%', label: '월 절감액' } }))
      .toEqual({ kind: 'stat', stat: { value: 1200, unit: '%', label: '월 절감액' } });
    expect(normalizeSceneKind({ kind: 'stat', stat: { value: '많이' } })).toEqual({});
    expect(normalizeSceneKind({ kind: 'stat' })).toEqual({});
    const long = normalizeSceneKind({ kind: 'stat', stat: { value: 3, unit: '1234567890', label: '가나다라마바사아자차카타파하호호' } });
    expect(long).toEqual({ kind: 'stat', stat: { value: 3, unit: '123456', label: '가나다라마바사아자차카타파하호' } });
  });
  it('list — 트림·빈 항목 제거·18자 캡·4개 절삭, 2개 미만 강등', () => {
    expect(normalizeSceneKind({ kind: 'list', items: [' 물주기 ', '', '분갈이', '햇빛', '통풍', '영양제'] }))
      .toEqual({ kind: 'list', items: ['물주기', '분갈이', '햇빛', '통풍'] });
    expect(normalizeSceneKind({ kind: 'list', items: ['하나'] })).toEqual({});
    expect(normalizeSceneKind({ kind: 'list' })).toEqual({});
  });
  it('quote — text 필수(40자 캡), source 15자 캡', () => {
    expect(normalizeSceneKind({ kind: 'quote', quote: { text: ' 시작이 반이다 ', source: '속담' } }))
      .toEqual({ kind: 'quote', quote: { text: '시작이 반이다', source: '속담' } });
    expect(normalizeSceneKind({ kind: 'quote', quote: { text: '  ' } })).toEqual({});
    expect(normalizeSceneKind({ kind: 'quote' })).toEqual({});
  });
  it('list 항목 18자 캡, 경계(2개) 통과', () => {
    expect(normalizeSceneKind({ kind: 'list', items: ['다'.repeat(20), '물주기'] }))
      .toEqual({ kind: 'list', items: ['다'.repeat(18), '물주기'] });
    expect(normalizeSceneKind({ kind: 'list', items: ['하나', '둘'] })).toEqual({ kind: 'list', items: ['하나', '둘'] });
  });
  it('quote text 40자·source 15자 캡', () => {
    expect(normalizeSceneKind({ kind: 'quote', quote: { text: '가'.repeat(45), source: '나'.repeat(20) } }))
      .toEqual({ kind: 'quote', quote: { text: '가'.repeat(40), source: '나'.repeat(15) } });
  });
  it('비문자열 페이로드 방어 — 오브젝트는 강등, 숫자는 문자열화 허용', () => {
    expect(normalizeSceneKind({ kind: 'list', items: [{ a: 1 }, { b: 2 }, '물주기'] })).toEqual({});
    expect(normalizeSceneKind({ kind: 'quote', quote: { text: { nested: true } } })).toEqual({});
    expect(normalizeSceneKind({ kind: 'stat', stat: { value: 42, unit: 7, label: 3 } }))
      .toEqual({ kind: 'stat', stat: { value: 42, unit: '7', label: '3' } });
  });
});
describe('resolveClipSrc — 클립 존재 판정(픽스처)', () => {
  it('존재 파일 → clip_NN.mp4, 부재/null/undefined → null', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `clip-src-${process.pid}-`));
    const f = path.join(tmp, 'c.mp4');
    fs.writeFileSync(f, 'x');
    expect(resolveClipSrc(f, '01')).toBe('clip_01.mp4');
    expect(resolveClipSrc(path.join(tmp, 'none.mp4'), '02')).toBeNull();
    expect(resolveClipSrc(null, '03')).toBeNull();
    expect(resolveClipSrc(undefined, '04')).toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
describe('normalizeSceneKind — stat 자릿수 상한', () => {
  it('1e12 이상은 강등(CountUp 패널 넘침 방지)', () => {
    expect(normalizeSceneKind({ kind: 'stat', stat: { value: 1e12 } })).toEqual({});
    expect(normalizeSceneKind({ kind: 'stat', stat: { value: -1e12 } })).toEqual({});
    expect(normalizeSceneKind({ kind: 'stat', stat: { value: 999_999_999_999 } }))
      .toEqual({ kind: 'stat', stat: { value: 999_999_999_999 } });
  });
});

// TTS 숫자 한글화 지시("숫자는 한글로")가 '10월'을 '십월'로 만들던 실측(2026-08-08 어휘 감사, 쇼츠 낭독 유출).
// 월 이름은 고유어 불규칙(시월·유월)이라 결정적으로 교정한다 — 낭독·자막 공용.
describe('fixMonthNames — 월 이름 고유어 교정', () => {
  it('십월→시월, 육월→유월', async () => {
    const { fixMonthNames } = await import('./shortsCommon');
    expect(fixMonthNames('십월에 심고 육월에 확인합니다')).toBe('시월에 심고 유월에 확인합니다');
  });
  it('그 외 월 이름·본문은 불변', async () => {
    const { fixMonthNames } = await import('./shortsCommon');
    expect(fixMonthNames('칠월과 팔월, 구월까지')).toBe('칠월과 팔월, 구월까지');
  });
});

describe('defaultSceneFx — 결정적 kind 연출(순수)', () => {
  it('클립 씬은 undefined(클립이 곧 모션 — 종전 동작 유지)', async () => {
    const { defaultSceneFx } = await import('./shortsCommon');
    expect(defaultSceneFx('hook', 0, true)).toBeUndefined();
    expect(defaultSceneFx(undefined, 2, true)).toBeUndefined();
  });
  it('훅(kind 또는 첫 씬)=push 강줌·스포트라이트·엔터 없음, cta=줌아웃', async () => {
    const { defaultSceneFx } = await import('./shortsCommon');
    expect(defaultSceneFx('hook', 3, false)).toEqual({ enter: 'none', move: 'push', intensity: 'strong', accent: 'spotlight' });
    expect(defaultSceneFx(undefined, 0, false)).toEqual({ enter: 'none', move: 'push', intensity: 'strong', accent: 'spotlight' });
    expect(defaultSceneFx('cta', 5, false)).toEqual({ enter: 'fade', move: 'zoom-out', intensity: 'normal' });
  });
  it('계절 파티클 — 봄 꽃잎/가을 낙엽/겨울 눈, 여름 없음; 본문 index1+cta 만(캡 2)', async () => {
    const { defaultSceneFx, seasonalParticles } = await import('./shortsCommon');
    expect(seasonalParticles(4)).toBe('particles-petals');
    expect(seasonalParticles(10)).toBe('particles-leaves');
    expect(seasonalParticles(1)).toBe('particles-snow');
    expect(seasonalParticles(7)).toBeUndefined();
    expect(defaultSceneFx(undefined, 1, false, 10)?.accent).toBe('particles-leaves'); // 본문 index 1
    expect(defaultSceneFx(undefined, 2, false, 10)?.accent).toBeUndefined();          // 다른 본문은 제외
    expect(defaultSceneFx('cta', 5, false, 10)?.accent).toBe('particles-leaves');
    expect(defaultSceneFx('stat', 2, false, 10)?.accent).toBeUndefined();             // 오버레이 씬 제외
    expect(defaultSceneFx(undefined, 1, false, 7)?.accent).toBeUndefined();           // 여름
  });
  it('오버레이 씬(stat/list/quote)=배경 subtle 캡 + kind별 엔터', async () => {
    const { defaultSceneFx } = await import('./shortsCommon');
    expect(defaultSceneFx('stat', 2, false)).toEqual({ enter: 'fade', intensity: 'subtle' });
    expect(defaultSceneFx('list', 2, false)).toEqual({ enter: 'wipe', intensity: 'subtle' });
    expect(defaultSceneFx('quote', 2, false)).toEqual({ enter: 'scale', intensity: 'subtle' });
  });
  it('본문 씬=strong 줌 + 엔터 변주(짝수 slide-up/홀수 fade)', async () => {
    const { defaultSceneFx } = await import('./shortsCommon');
    expect(defaultSceneFx(undefined, 2, false)).toEqual({ enter: 'slide-up', intensity: 'strong' });
    expect(defaultSceneFx(undefined, 3, false)).toEqual({ enter: 'fade', intensity: 'strong' });
  });
});

describe('normalizeSceneKind — chart 검증', () => {
  it('정상 chart: series 2~5·label 8자 캡·highlight 범위 검증', () => {
    const r = normalizeSceneKind({ kind: 'chart', chart: { series: [{ label: '봄철심기12345', value: 90 }, { label: '가을', value: '70' }], unit: '%', highlight: 0 } });
    expect(r.kind).toBe('chart');
    expect(r.chart?.series).toEqual([{ label: '봄철심기1234', value: 90 }, { label: '가을', value: 70 }]);
    expect(r.chart?.unit).toBe('%');
    expect(r.chart?.highlight).toBe(0);
  });
  it('불량 강등: series 1개·음수·전부 0·highlight 범위 밖', () => {
    expect(normalizeSceneKind({ kind: 'chart', chart: { series: [{ label: '봄', value: 90 }] } })).toEqual({});
    expect(normalizeSceneKind({ kind: 'chart', chart: { series: [{ label: '봄', value: -1 }, { label: '가을', value: 70 }] } }).chart?.series).toEqual([{ label: '가을', value: 70 }].length === 1 ? undefined : []);
    expect(normalizeSceneKind({ kind: 'chart', chart: { series: [{ label: '봄', value: 0 }, { label: '가을', value: 0 }] } })).toEqual({});
    const hi = normalizeSceneKind({ kind: 'chart', chart: { series: [{ label: '봄', value: 9 }, { label: '가을', value: 7 }], highlight: 9 } });
    expect(hi.chart?.highlight).toBeUndefined();
  });
  it('라벨 없는 항목 제외, 6개 이상은 5개 캡', () => {
    const r = normalizeSceneKind({ kind: 'chart', chart: { series: [1, 2, 3, 4, 5, 6].map((v) => ({ label: `항목${v}`, value: v })) } });
    expect(r.chart?.series.length).toBe(5);
    const r2 = normalizeSceneKind({ kind: 'chart', chart: { series: [{ label: '', value: 1 }, { label: 'ㄱ', value: 2 }, { label: 'ㄴ', value: 3 }] } });
    expect(r2.chart?.series.length).toBe(2);
  });
  it('defaultSceneFx chart = slide-up + subtle', async () => {
    const { defaultSceneFx } = await import('./shortsCommon');
    expect(defaultSceneFx('chart', 2, false)).toEqual({ enter: 'slide-up', intensity: 'subtle' });
  });
});
