import { describe, it, expect } from 'vitest';
import { planAssetScenes, styleRefs, planVideoSegments } from './userAssets';

describe('planAssetScenes — 실사진 씬 배정', () => {
  it('훅부터 앞에서 채운다 — 첫 프레임이 곧 커버다', () => {
    expect(planAssetScenes(['a.jpg', 'b.jpg'], 5)).toEqual(['a.jpg', 'b.jpg', null, null, null]);
  });
  it('전 씬을 덮지 않는다 — 상한은 씬의 절반(올림)', () => {
    const p = planAssetScenes(['a', 'b', 'c', 'd', 'e', 'f'], 5);
    expect(p.filter(Boolean)).toHaveLength(3);
    expect(p.filter((x) => x === null)).toHaveLength(2);
  });
  it('사진이 없으면 전부 생성으로 남긴다', () => {
    expect(planAssetScenes([], 4)).toEqual([null, null, null, null]);
  });
  it('씬이 없으면 빈 배열', () => {
    expect(planAssetScenes(['a'], 0)).toEqual([]);
  });
  it('지정 순서를 따른다 — 비전이 고른 씬에 놓을 수 있게', () => {
    expect(planAssetScenes(['a', 'b'], 5, [3, 1])).toEqual([null, 'b', null, 'a', null]);
  });
  it('범위 밖·중복 순서는 무시한다', () => {
    const p = planAssetScenes(['a', 'b'], 3, [9, -1, 1, 1, 0]);
    expect(p).toEqual(['b', 'a', null]);
  });
  it('사진 한 장은 한 씬에만 — 중복 배정 없음', () => {
    const p = planAssetScenes(['a', 'b', 'c'], 6);
    expect(new Set(p.filter(Boolean)).size).toBe(p.filter(Boolean).length);
  });
});

describe('styleRefs — 나머지는 스타일 레퍼런스로', () => {
  it('배정 안 된 사진을 넘긴다', () => {
    const assets = ['a', 'b', 'c', 'd'];
    const plan = planAssetScenes(assets, 4); // 2장 배정
    expect(styleRefs(assets, plan)).toEqual(['c', 'd']);
  });
  it('남는 게 없으면 배정분을 참조로 재사용한다 — 톤 기준은 있어야 한다', () => {
    const assets = ['a'];
    expect(styleRefs(assets, planAssetScenes(assets, 2))).toEqual(['a']);
  });
  it('참조 상한 4장', () => {
    const assets = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(styleRefs(assets, planAssetScenes(assets, 2)).length).toBeLessThanOrEqual(4);
  });
  it('사진이 없으면 빈 배열', () => {
    expect(styleRefs([], [])).toEqual([]);
  });
});

describe('planVideoSegments — 한 영상을 구간으로 쪼개 여러 씬에', () => {
  it('23초 한 개가 여러 씬을 덮는다 — 종전엔 한 씬만 덮고 17초가 버려졌다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 23 }], [6, 6, 6, 6, 6]);
    const used = p.filter(Boolean);
    expect(used.length).toBeGreaterThan(1);
    expect(used.every((x) => x!.path === 'v.mp4')).toBe(true);
  });
  it('구간이 겹치지 않고 씬 순서대로 앞에서 뒤로 간다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 30 }], [6, 6, 6, 6, 6]);
    const used = p.map((x, i) => (x ? { i, ...x } : null)).filter(Boolean) as Array<{ i: number; startSec: number; seconds: number }>;
    for (let k = 1; k < used.length; k++) {
      expect(used[k]!.i).toBeGreaterThan(used[k - 1]!.i);              // 씬 순서
      expect(used[k]!.startSec).toBeGreaterThanOrEqual(used[k - 1]!.startSec + used[k - 1]!.seconds); // 겹침 없음
    }
  });
  it('원본 길이를 넘겨 쓰지 않는다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 10 }], [6, 6, 6, 6]);
    const total = p.filter(Boolean).reduce((sum, x) => sum + x!.seconds, 0);
    expect(total).toBeLessThanOrEqual(10);
    for (const x of p.filter(Boolean)) expect(x!.startSec + x!.seconds).toBeLessThanOrEqual(10);
  });
  it('훅에는 안 넣는다', () => {
    expect(planVideoSegments([{ path: 'v.mp4', seconds: 60 }], [6, 6, 6])[0]).toBeNull();
  });
  it('전 씬을 실촬영으로 덮지 않는다 — 상한은 씬의 절반(올림)', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 300 }], [6, 6, 6, 6, 6]);
    expect(p.filter(Boolean).length).toBeLessThanOrEqual(3);
  });
  it('남은 구간이 하한에 못 미치면 거기서 멈춘다 — 과한 감속은 결함으로 보인다', () => {
    // 7초 영상, 6초 씬들: 첫 씬에 6초를 주면 1초 남고 1 < 6*0.5 이라 더 못 쓴다.
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 7 }], [6, 6, 6, 6]);
    expect(p.filter(Boolean)).toHaveLength(1);
  });
  it('여러 영상이면 각자 자기 구간을 센다', () => {
    const p = planVideoSegments([{ path: 'a.mp4', seconds: 12 }, { path: 'b.mp4', seconds: 12 }], [5, 6, 6, 6]);
    const byPath = new Map<string, number>();
    for (const x of p.filter(Boolean)) byPath.set(x!.path, (byPath.get(x!.path) ?? 0) + 1);
    for (const [, n] of byPath) expect(n).toBeGreaterThan(0);
    for (const x of p.filter(Boolean)) expect(x!.startSec + x!.seconds).toBeLessThanOrEqual(12);
  });
  it('영상이 없거나 씬이 없으면 빈 배정', () => {
    expect(planVideoSegments([], [5, 5])).toEqual([null, null]);
    expect(planVideoSegments([{ path: 'v.mp4', seconds: 9 }], [])).toEqual([]);
  });
  it('길이를 모르는 항목은 무시한다', () => {
    expect(planVideoSegments([{ path: 'v.mp4', seconds: 0 }], [5, 5]).filter(Boolean)).toHaveLength(0);
  });
});
