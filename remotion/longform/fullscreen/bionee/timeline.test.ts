import { describe, expect, it } from 'vitest';
import { ACTIONS, poseAt, poseOf, type ActorSpec, type Cue } from './timeline';
import { bootGeom } from './limbs';
import { makeView } from './geom';
import type { Pose } from './pose';

const CUES: Cue[] = [
  { at: 0, dur: 2, action: 'walkIn', params: { from: 'left', x: 640 } },
  { at: 2.2, dur: 1.5, action: 'wave' },
  { at: 3.8, dur: 0.5, action: 'turn', params: { to: 0.3 } },
  { at: 4, dur: 2, action: 'point', params: { target: { x: 1400, y: 400 } } },
  { at: 6.2, dur: 1, action: 'surprised' },
  { at: 7.3, dur: 1.5, action: 'think' },
  { at: 9, dur: 1.5, action: 'holdSign', params: { text: '잎이 진 뒤' } },
  { at: 10.6, dur: 0.8, action: 'hop' },
  { at: 11.5, dur: 1, action: 'bow' },
  { at: 12.6, dur: 1.5, action: 'walkOut', params: { from: 'left' } },
];
const SPEC: ActorSpec = { cues: CUES, home: { x: 640, y: 846 }, scale: 0.78, mouth: Array.from({ length: 60 }, (_, i) => (i % 6) + 2), mouthStart: 120, seed: 't' };

const nums = (p: Pose): number[] => Object.values(p).flatMap((v) => (typeof v === 'number' ? [v] : typeof v === 'object' && v ? Object.values(v).flatMap((w) => (typeof w === 'number' ? [w] : typeof w === 'object' && w ? Object.values(w).filter((z): z is number => typeof z === 'number') : [])) : []));

describe('비온이 시간표', () => {
  it('같은 프레임은 같은 자세(결정적)', () => {
    for (const f of [0, 37, 133, 260, 401]) expect(poseAt(f, SPEC)).toEqual(poseAt(f, SPEC));
  });

  it('모든 값이 유한하고, 프레임 사이에 튀지 않는다(섞기)', () => {
    let prev = poseAt(0, SPEC);
    for (let f = 1; f < 15 * 30; f++) {
      const p = poseAt(f, SPEC);
      for (const v of nums(p)) expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(p.x - prev.x)).toBeLessThan(40);
      expect(Math.abs(p.turn - prev.turn)).toBeLessThan(0.2);
      expect(Math.hypot(p.armR.x - prev.armR.x, p.armR.y - prev.armR.y)).toBeLessThan(60);
      prev = p;
    }
  });

  it('걷기 — 들어와 멈춘 자리, 나간 뒤 화면 밖', () => {
    expect(poseAt(0, SPEC).x).toBeLessThan(0);
    expect(Math.abs(poseAt(75, SPEC).x - 640)).toBeLessThan(1);
    expect(poseAt(75, SPEC).walkAmt).toBe(0);
    expect(poseAt(30, SPEC).walkAmt).toBeGreaterThan(0.9);
    expect(poseAt(14.5 * 30, SPEC).x).toBeLessThan(0);
  });

  it('돌기는 남는다', () => {
    expect(poseAt(4.6 * 30, SPEC).turn).toBeGreaterThan(0.1);
  });

  it('말하기 — 입 열림이 소리 크기를 따른다', () => {
    const quiet = poseAt(119, SPEC).mOpen;
    const loud = Math.max(...[125, 126, 127, 128, 129, 130].map((f) => poseAt(f, SPEC).mOpen));
    expect(loud).toBeGreaterThan(quiet + 0.2);
  });

  it('팻말 신호 — 소품·글자', () => {
    const p = poseAt(9.8 * 30, SPEC);
    expect(p.prop).toBe('sign');
    expect(p.propText).toBe('잎이 진 뒤');
    expect(p.propAmt).toBeGreaterThan(0.9);
  });

  it('모든 동작이 자세를 만든다', () => {
    for (const a of ACTIONS) for (const v of nums(poseOf(a, {}, 0.5))) expect(Number.isFinite(v)).toBe(true);
  });

  it('장화 — 옆모습에서 앞코 쪽으로 길다', () => {
    const w = (turn: number) => { const b = bootGeom(makeView(turn, 0), { cx: 0, cz: 0, lift: 0, fwd: 0, toeUp: 0, squash: 0 }); const xs = b.outline.map((p) => p[0]); return Math.max(...xs) - Math.min(...xs); };
    expect(w(1)).toBeGreaterThan(w(0) * 1.15);
  });
});

describe('낱말 목록 — src/longform/bioneeCues 와 같다(2026-10-23)', async () => {
  const { BIONEE_EXPRS } = await import('../../../../src/longform/bioneeCues');
  const { EXPR } = await import('./pose');
  it('표정 이름', () => { expect(Object.keys(EXPR).sort()).toEqual([...BIONEE_EXPRS].sort()); });
  it('동작마다 자세가 나온다(꾸벅은 흙이 덜 보이게 얕게)', () => {
    for (const a of ACTIONS) expect(() => poseOf(a, a === 'holdSign' ? { text: '잎' } : {}, 0.6)).not.toThrow();
    expect(poseOf('bow', {}, 0.6).pitch).toBeLessThanOrEqual(0.2);
  });
  it('장화 — 밑창·굽·테 띠가 따로 있고 발목이 발등보다 좁다', () => {
    const b = bootGeom(makeView(0, 0), { cx: 0, cz: 0, lift: 0, fwd: 0, toeUp: 0, squash: 0 });
    const w = (q: [number, number][]) => Math.max(...q.map((p) => p[0])) - Math.min(...q.map((p) => p[0]));
    expect(b.sole.length).toBeGreaterThan(2);
    expect(b.heel.length).toBeGreaterThan(2);
    expect(w(b.shaft)).toBeLessThan(w(b.foot));
    expect(w(b.band)).toBeGreaterThan(w(b.shaft) * 0.95);
  });
});
