import { describe, expect, it } from 'vitest';
import { sampleSpline, taperOutline, pointAt } from './geom';

describe('sampleSpline', () => {
  it('지나는 점의 처음과 끝을 지킨다', () => {
    const pts = sampleSpline([[0, 0], [50, 40], [100, 0]], 20);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([100, 0]);
    expect(pts.length).toBe(21);
  });
});

describe('taperOutline', () => {
  it('진행도 0이면 빈 경로, 1이면 닫힌 경로', () => {
    expect(taperOutline([[0, 0], [0, -100]], 20, 4, 0)).toBe('');
    const d = taperOutline([[0, 0], [0, -100]], 20, 4, 1);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
  });
  it('밑동 폭이 끝 폭보다 넓다', () => {
    const d = taperOutline([[0, 0], [0, -100]], 20, 4, 1, 4);
    const xs = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // 첫 점(밑동 왼쪽)의 x 절댓값 ≈ 10, 끝 근처 ≈ 2
    expect(Math.abs(xs[0]!)).toBeCloseTo(10, 0);
  });
});

describe('pointAt', () => {
  it('곡선 위 비율 위치', () => {
    expect(pointAt([[0, 0], [0, -100]], 0.5)[1]).toBeCloseTo(-50, 0);
  });
});

import { growTree } from './geom';
describe('growTree', () => {
  it('같은 시드면 같은 나무, 가지는 밑동에서 끝으로 가늘어지고 단계마다 늘어난다', () => {
    const a = growTree('t1', [500, 560], 380, { depth: 3 });
    expect(growTree('t1', [500, 560], 380, { depth: 3 })).toEqual(a);
    const byLevel = [0, 1, 2, 3].map((l) => a.branches.filter((b) => b.level === l));
    expect(byLevel[0]).toHaveLength(1);
    expect(byLevel[1]!.length).toBeGreaterThanOrEqual(2);
    expect(byLevel[3]!.length).toBeGreaterThan(byLevel[1]!.length);
    for (const b of a.branches) expect(b.w0).toBeGreaterThan(b.w1);
    expect(a.tips.length).toBe(byLevel[3]!.length);
  });
});

import { shiftPts, lightSide, castShadowPts } from './geom';
describe('사실감 기하', () => {
  it('shiftPts 는 곡선을 법선 방향으로 평행 이동한다(수평선을 위로)', () => {
    const s = shiftPts([[0, 100], [200, 100]], -10);
    for (const [, y] of s) expect(y).toBeCloseTo(90, 0);
  });
  it('lightSide 는 왼쪽 위에서 오는 빛을 받는 쪽 부호를 준다', () => {
    // 수평 가지(왼→오): 빛 받는 쪽은 위(-y) → shiftPts(pts, sign*k)가 위로 가야 한다
    const pts: [number, number][] = [[0, 100], [200, 100]];
    const sgn = lightSide(pts);
    const s = shiftPts(pts, sgn * 10);
    expect(s[0]![1]).toBeLessThan(100);
    // 수직 가지(아래→위): 빛 받는 쪽은 왼쪽(-x)
    const v: [number, number][] = [[100, 300], [100, 0]];
    expect(shiftPts(v, lightSide(v) * 10)[0]![0]).toBeLessThan(100);
  });
  it('castShadowPts 는 땅 위 점을 해 반대쪽(오른쪽)으로 눕힌다', () => {
    const [p] = castShadowPts([[100, 300]], 560);
    expect(p![0]).toBeGreaterThan(100);
    expect(p![1]).toBeGreaterThan(560 - 1);
    expect(castShadowPts([[100, 560]], 560)[0]).toEqual([100, 560]);
  });
  it('growTree 는 줄기에 굴곡(점 4개 이상)과 잔가지 끝의 위로 휨을 준다', () => {
    const t = growTree('t2', [500, 560], 380, { depth: 4 });
    expect(t.branches[0]!.pts.length).toBeGreaterThanOrEqual(4);
    const twigs = t.branches.filter((b) => b.level === 4);
    const upturn = twigs.filter((b) => b.pts[b.pts.length - 1]![1] < b.pts[b.pts.length - 2]![1]).length;
    expect(upturn / twigs.length).toBeGreaterThan(0.6);
  });
  it('잔가지는 거의 곧다 — 갈고리처럼 말리지 않는다(가운데 점이 양끝 직선에서 길이의 7% 안)', () => {
    for (const seed of ['t2', 'la', 'tyb', 'cmo']) {
      const t = growTree(seed, [500, 560], 380, { depth: 4 });
      for (const b of t.branches.filter((x) => x.level >= 3)) {
        const [a0, e] = [b.pts[0]!, b.pts[b.pts.length - 1]!];
        const L = Math.hypot(e[0] - a0[0], e[1] - a0[1]);
        for (const q of b.pts.slice(1, -1)) {
          const dev = Math.abs((e[0] - a0[0]) * (a0[1] - q[1]) - (a0[0] - q[0]) * (e[1] - a0[1])) / L;
          expect(dev / L).toBeLessThan(0.07);
        }
      }
    }
  });
});

import { ribLine } from './geom';
describe('ribLine', () => {
  it('굵기를 따라 좁아지는 껍질 골 — 끝에서는 중심선에 가까워진다', () => {
    const d = ribLine([[0, 100], [200, 100]], 40, 4, 0.8, 1, 8);
    const ys = d.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1);
    expect(Math.abs(ys[0]! - 100)).toBeCloseTo(16, 0);
    expect(Math.abs(ys[ys.length - 1]! - 100)).toBeLessThan(3);
  });
});

describe('가지 붙는 자리', () => {
  it('자식 가지는 부모 곡선 위에서 시작한다(허공에 뜨지 않음)', () => {
    const t = growTree('t3', [500, 560], 380, { depth: 3 });
    const byOrder = t.branches;
    for (const b of byOrder.filter((x) => x.level > 0)) {
      const parents = byOrder.filter((p) => p.level === b.level - 1);
      const near = parents.some((p) => {
        const s = sampleSpline(p.pts, 64);
        return s.some((q) => Math.hypot(q[0] - b.pts[0]![0], q[1] - b.pts[0]![1]) < 2.5);
      });
      expect(near).toBe(true);
    }
  });
  it('줄기 끝 굵기 = 이어 가는 원가지 굵기(뭉툭하게 튀어나온 끝 금지)', () => {
    const t = growTree('t3', [500, 560], 380, { depth: 3 });
    const kids = t.branches.filter((b) => b.parent === 0);
    expect(t.branches[0]!.w1).toBeCloseTo(Math.max(...kids.map((k) => k.w0)), 5);
  });
});

import { rootPaths } from './geom';
describe('디테일 기하', () => {
  it('taperOutline flare — 밑동(지륭) 폭이 부풀고, 몸통은 원래 폭', () => {
    const plain = taperOutline([[0, 100], [200, 100]], 20, 20, 1, 20);
    const flared = taperOutline([[0, 100], [200, 100]], 20, 20, 1, 20, 0.4);
    const y0 = (d: string) => Number(d.match(/-?\d+(\.\d+)?/g)![1]);
    expect(Math.abs(y0(flared) - 100)).toBeCloseTo(14, 0);
    expect(Math.abs(y0(plain) - 100)).toBeCloseTo(10, 0);
  });
  it('taperOutline flareLen — 부푸는 구간 길이를 정한다(지륭은 짧게, 잘린 토막은 전체)', () => {
    // 중간 점(k=0.5) 폭: 기본(0.15)이면 원래 폭, flareLen=1 이면 아직 부풀어 있다(볼록한 S자라 절반 지점에서 부풂의 절반).
    const half = (d: string) => { const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number); return Math.abs(n[2 * 10 + 1]! - 100); };
    expect(half(taperOutline([[0, 100], [200, 100]], 20, 20, 1, 20, 0.4))).toBeCloseTo(10, 0);
    expect(half(taperOutline([[0, 100], [200, 100]], 20, 20, 1, 20, 0.4, 1))).toBeCloseTo(12, 0);
  });
  it('지륭은 볼록하게 부푼다 — 밑동 쪽 1/4 지점에서 부풂의 80% 이상 남는다(오목한 나팔 모양 금지)', () => {
    const half = (d: string, i: number) => { const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number); return Math.abs(n[2 * i + 1]! - 100); };
    const d = taperOutline([[0, 100], [200, 100]], 20, 20, 1, 20, 0.4, 1);
    // i=5 → k=0.25: 반폭 부풂 4 중 80% 이상 → 반폭 > 13.2
    expect(half(d, 5)).toBeGreaterThan(13.2);
  });
  it('rootPaths — 밑동 둘레에서 바깥·아래로 뻗고, 같은 시드면 같다', () => {
    const r = rootPaths('r1', [500, 560], 60);
    expect(rootPaths('r1', [500, 560], 60)).toEqual(r);
    expect(r.length).toBeGreaterThanOrEqual(4);
    for (const root of r) {
      const [s0, e] = [root.pts[0]!, root.pts[root.pts.length - 1]!];
      expect(Math.abs(s0[0] - 500)).toBeLessThan(40);
      expect(Math.abs(e[0] - 500)).toBeGreaterThan(Math.abs(s0[0] - 500));
      expect(e[1]).toBeGreaterThanOrEqual(s0[1]);
      expect(root.w0).toBeGreaterThan(root.w1);
    }
  });
});

describe('실제 나무 비율', () => {
  const t = growTree('ratio', [500, 560], 380, { depth: 4 });
  it('줄기 지름 : 키 ≈ 1:28(어린 과실나무)', () => {
    expect(t.branches[0]!.w0 / 380).toBeGreaterThan(1 / 34);
    expect(t.branches[0]!.w0 / 380).toBeLessThan(1 / 23);
  });
  it('다빈치 규칙 — 자식 가지 굵기 제곱의 합 ≈ 붙는 자리 부모 굵기 제곱', () => {
    expect(t.branches.filter((b) => b.parent === 0).length).toBeGreaterThan(1);
    for (const par of t.branches.filter((b) => b.level < 4)) {
      const kids = t.branches.filter((b) => b.parent === par.order);
      if (!kids.length) continue;
      const sum = kids.reduce((a, k) => a + k.w0 ** 2, 0);
      expect(sum / par.w0 ** 2).toBeGreaterThan(0.45);
      expect(sum / par.w0 ** 2).toBeLessThan(1.15);
      for (const k of kids) expect(k.w0).toBeLessThan(par.w0);
    }
  });
  it('가는 가지일수록 짧다(길이 ∝ 굵기^⅔ 경향)', () => {
    const len = (b: { pts: [number, number][] }) => Math.hypot(b.pts[b.pts.length - 1]![0] - b.pts[0]![0], b.pts[b.pts.length - 1]![1] - b.pts[0]![1]);
    const lv = [1, 2, 3, 4].map((l) => t.branches.filter((b) => b.level === l));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (let i = 1; i < 4; i++) expect(avg(lv[i]!.map(len))).toBeLessThan(avg(lv[i - 1]!.map(len)));
  });
});

describe('나무 키', () => {
  it('나무 전체 키가 지정 높이와 같다(화면 밖으로 넘지 않음)', () => {
    for (const seed of ['a', 'b', 'reach7', 'ldserrate']) {
      const t = growTree(seed, [500, 566], 380, { depth: 4 });
      const top = Math.min(...t.branches.flatMap((b) => b.pts.map((q) => q[1])));
      expect(566 - top).toBeCloseTo(380, -1);
    }
  });
});
