import { describe, it, expect } from 'vitest';
import { planAssetScenes, styleRefs, planVideoScenes } from './userAssets';

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

describe('planVideoScenes — 영상 씬 배정', () => {
  it('훅에는 안 넣는다 — 영상 첫 프레임은 커버로 약하다', () => {
    const p = planVideoScenes([{ path: 'v.mp4', seconds: 30 }], [6, 6, 6]);
    expect(p[0]).toBeNull();
    expect(p.filter(Boolean)).toHaveLength(1);
  });
  it('씬보다 많이 짧은 영상은 안 쓴다 — 과한 감속은 결함으로 보인다', () => {
    expect(planVideoScenes([{ path: 'short.mp4', seconds: 1 }], [6, 8]).filter(Boolean)).toHaveLength(0);
    expect(planVideoScenes([{ path: 'ok.mp4', seconds: 5 }], [6, 8]).filter(Boolean)).toHaveLength(1);
  });
  it('긴 씬부터 채우고, 덮을 수 있는 것 중 가장 짧은 영상을 쓴다', () => {
    const p = planVideoScenes(
      [{ path: 'a.mp4', seconds: 5 }, { path: 'b.mp4', seconds: 12 }],
      [4, 5, 10],
    );
    expect(p[2]).toBe('b.mp4'); // 10초 씬은 12초짜리로
    expect(p[1]).toBe('a.mp4'); // 5초 씬은 5초짜리로
    expect(p[0]).toBeNull();
  });
  it('한 영상은 한 씬에만', () => {
    const p = planVideoScenes([{ path: 'v.mp4', seconds: 30 }], [5, 5, 5, 5]);
    expect(p.filter(Boolean)).toHaveLength(1);
  });
  it('영상이 없거나 씬이 없으면 빈 배정', () => {
    expect(planVideoScenes([], [5, 5])).toEqual([null, null]);
    expect(planVideoScenes([{ path: 'v.mp4', seconds: 9 }], [])).toEqual([]);
  });
  it('길이를 모르는 항목은 무시한다', () => {
    expect(planVideoScenes([{ path: 'v.mp4', seconds: 0 }], [5, 5]).filter(Boolean)).toHaveLength(0);
  });
});

describe('planVideoScenes — 감속 최소화', () => {
  it('씬을 통째로 덮는 영상이 있으면 그것을 쓴다(감속 0)', () => {
    const p = planVideoScenes([{ path: 'exact.mp4', seconds: 9 }, { path: 'half.mp4', seconds: 5 }], [4, 9]);
    expect(p[1]).toBe('exact.mp4');
  });
  it('못 덮으면 하한을 넘는 것 중 가장 긴 것 — 감속 폭이 가장 작다', () => {
    const p = planVideoScenes([{ path: 'a.mp4', seconds: 5 }, { path: 'b.mp4', seconds: 7 }], [4, 10]);
    expect(p[1]).toBe('b.mp4'); // 7/10 = 0.7배, a 였다면 0.5배
  });
});
