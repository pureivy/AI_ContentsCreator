import { describe, it, expect } from 'vitest';
import { planAssetScenes, styleRefs, planVideoSegments, orderAssetsByAssignment } from './userAssets';

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

describe('planVideoSegments — 영상 하나는 씬 하나', () => {
  it('긴 영상이라도 한 씬만 쓴다 — 여러 씬에 늘어놓으면 한 장면처럼 이어진다(2026-09-04 실측)', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 300 }], [6, 6, 6, 6, 6]);
    expect(p.filter(Boolean)).toHaveLength(1);
  });
  it('영상이 둘이면 씬도 둘', () => {
    const p = planVideoSegments([{ path: 'a.mp4', seconds: 30 }, { path: 'b.mp4', seconds: 30 }], [6, 6, 6, 6]);
    expect(p.filter(Boolean)).toHaveLength(2);
    expect(new Set(p.filter(Boolean).map((x) => x!.path)).size).toBe(2); // 같은 영상을 두 번 안 쓴다
  });
  it('구간은 언제나 영상 앞에서 뗀다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 30 }], [6, 6, 6]);
    expect(p.filter(Boolean)[0]!.startSec).toBe(0);
  });
  it('원본보다 길게 쓰지 않는다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 4 }], [6, 6]);
    const seg = p.filter(Boolean)[0]!;
    expect(seg.seconds).toBeLessThanOrEqual(4);
  });
  it('훅에는 안 넣는다', () => {
    expect(planVideoSegments([{ path: 'v.mp4', seconds: 60 }], [6, 6, 6])[0]).toBeNull();
  });
  it('씬 길이의 절반에 못 미치면 안 쓴다 — 과한 감속은 결함으로 보인다', () => {
    expect(planVideoSegments([{ path: 'v.mp4', seconds: 1 }], [6, 8]).filter(Boolean)).toHaveLength(0);
    expect(planVideoSegments([{ path: 'v.mp4', seconds: 5 }], [6, 8]).filter(Boolean)).toHaveLength(1);
  });
  it('긴 씬부터 채우고, 덮을 수 있는 것 중 가장 짧은 영상을 쓴다', () => {
    const p = planVideoSegments([{ path: 'a.mp4', seconds: 5 }, { path: 'b.mp4', seconds: 12 }], [4, 5, 10]);
    expect(p[2]!.path).toBe('b.mp4'); // 10초 씬은 12초짜리로
  });
  it('영상이 없거나 씬이 없으면 빈 배정', () => {
    expect(planVideoSegments([], [5, 5])).toEqual([null, null]);
    expect(planVideoSegments([{ path: 'v.mp4', seconds: 9 }], [])).toEqual([]);
  });
  it('길이를 모르는 항목은 무시한다', () => {
    expect(planVideoSegments([{ path: 'v.mp4', seconds: 0 }], [5, 5]).filter(Boolean)).toHaveLength(0);
  });
});

describe('planVideoSegments — 내용 기준 배정이 길이보다 우선', () => {
  it('감독이 고른 씬을 먼저 잡는다 — 길이 기준이라면 다른 씬이 뽑혔을 자리', () => {
    // 길이만 보면 가장 긴 씬3(10초)이 먼저 뽑힌다. 감독이 씬1을 고르면 씬1이 먼저다.
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 8 }], [4, 5, 6, 10], new Map([['v.mp4', 1]]));
    expect(p[1]).not.toBeNull();
    expect(p[1]!.startSec).toBe(0); // 지목된 자리가 첫 구간을 가져간다
  });
  it('훅을 지목하면 무시한다 — 첫 프레임이 커버라는 규칙이 이긴다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 30 }], [5, 5, 5], new Map([['v.mp4', 0]]));
    expect(p[0]).toBeNull();
  });
  it('지목한 씬을 덮을 만큼 안 남았으면 그 자리는 포기한다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 2 }], [5, 10, 5], new Map([['v.mp4', 1]]));
    expect(p[1]).toBeNull(); // 2초는 10초 씬의 절반에 못 미친다
  });
  it('지목이 없으면 종전대로 길이 기준', () => {
    const a = planVideoSegments([{ path: 'v.mp4', seconds: 30 }], [5, 5, 6, 5]);
    const b = planVideoSegments([{ path: 'v.mp4', seconds: 30 }], [5, 5, 6, 5], new Map());
    expect(b).toEqual(a);
  });
});

describe('orderAssetsByAssignment — 내용 배정을 planAssetScenes 입력으로', () => {
  it('지목된 사진이 그 씬에 들어간다', () => {
    const { assets, order } = orderAssetsByAssignment(['a.jpg', 'b.jpg'], new Map([['b.jpg', 2]]), 5);
    const plan = planAssetScenes(assets, 5, order);
    expect(plan[2]).toBe('b.jpg');
  });
  it('지목 없는 사진은 남은 씬을 종전 순서(훅부터)로 채운다', () => {
    const { assets, order } = orderAssetsByAssignment(['a.jpg', 'b.jpg'], new Map([['b.jpg', 3]]), 5);
    expect(assets).toEqual(['b.jpg', 'a.jpg']);
    expect(order[0]).toBe(3);
    expect(order.slice(1)).toEqual([0, 1, 2, 4]);
  });
  it('한 씬에 둘을 지목하면 뒤엣것은 무시한다', () => {
    const { order } = orderAssetsByAssignment(['a.jpg', 'b.jpg'], new Map([['a.jpg', 1], ['b.jpg', 1]]), 4);
    expect(order.filter((i) => i === 1)).toHaveLength(1);
  });
  it('범위 밖 지목은 무시한다', () => {
    const { assets, order } = orderAssetsByAssignment(['a.jpg'], new Map([['a.jpg', 99]]), 3);
    expect(assets).toEqual(['a.jpg']);
    expect(order).toEqual([0, 1, 2]);
  });
  it('배정이 없으면 종전과 같다', () => {
    const { assets, order } = orderAssetsByAssignment(['a.jpg', 'b.jpg'], new Map(), 4);
    expect(assets).toEqual(['a.jpg', 'b.jpg']);
    expect(order).toEqual([0, 1, 2, 3]);
  });
});

describe('planVideoSegments — 내용 배정을 길이가 덮어쓰지 않는다(2026-09-04 실측)', () => {
  it('배정받은 영상은 지목된 씬에만 들어간다 — 길이로 더 퍼뜨리지 않는다', () => {
    // 실측 사고: 넓게 찍은 하우스 밭 영상 하나가 3씬을 먹었다. 감독이 고른 자리는 한 곳뿐이었고
    // 나머지 둘은 길이만 보고 채운 자리라, 클로즈업을 설명하는 대목에 밭 전경이 들어갔다.
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 60 }], [5, 6, 7, 6, 5], new Map([['v.mp4', 3]]));
    expect(p.filter(Boolean)).toHaveLength(1);
    expect(p[3]).not.toBeNull();
  });
  it('배정을 못 받은 영상만 길이로 채운다', () => {
    const p = planVideoSegments(
      [{ path: 'a.mp4', seconds: 60 }, { path: 'b.mp4', seconds: 60 }],
      [5, 6, 7, 6, 5], new Map([['a.mp4', 1]]),
    );
    expect(p[1]!.path).toBe('a.mp4');
    const others = p.filter((x, i) => x && i !== 1);
    expect(others.every((x) => x!.path === 'b.mp4')).toBe(true); // a 는 더 안 퍼진다
  });
  it('배정이 아예 없으면 길이 기준으로 한 씬', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 60 }], [5, 6, 7, 6, 5]);
    expect(p.filter(Boolean)).toHaveLength(1);
  });
});

describe('planVideoSegments — 반드시 하나는 쓴다(사용자 확정 2026-09-08)', () => {
  it('감독 배정이 훅(0)이면 그 배정은 버리되 길이 규칙으로 다시 채운다 — 배정 실패가 누락이 되면 안 된다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 13 }], [4.6, 9.9, 6, 6.2, 6.2], new Map([['v.mp4', 0]]));
    expect(p[0]).toBeNull();
    expect(p.filter(Boolean)).toHaveLength(1);
  });
  it('mustUse — 길이 하한에 못 미쳐도 훅을 뺀 가장 짧은 씬에 넣는다', () => {
    const p = planVideoSegments([{ path: 'v.mp4', seconds: 1 }], [6, 8, 5], undefined, { mustUse: true });
    expect(p[2]).toMatchObject({ path: 'v.mp4', seconds: 1 });
    expect(p.filter(Boolean)).toHaveLength(1);
  });
  it('mustUse 여도 영상이 없으면 아무것도 안 넣는다', () => {
    expect(planVideoSegments([], [6, 6], undefined, { mustUse: true }).filter(Boolean)).toHaveLength(0);
  });
});

describe('planVideoSegments hookFirst(2026-09-18)', () => {
  const secs = [3.5, 6, 6, 6, 4];
  it('hookFirst 면 씬0이 먼저 받는다 — 배정된 클립이 있으면 그것, 없으면 가장 긴 클립', () => {
    const v = [{ path: 'a.mp4', seconds: 7 }, { path: 'b.mp4', seconds: 12 }];
    const out = planVideoSegments(v, secs, new Map([['a.mp4', 0]]), { hookFirst: true });
    expect(out[0]?.path).toBe('a.mp4');
    const out2 = planVideoSegments(v, secs, new Map(), { hookFirst: true });
    expect(out2[0]?.path).toBe('b.mp4');
  });
  it('hookFirst 가 없으면 종전 — 씬0은 비운다', () => {
    const v = [{ path: 'a.mp4', seconds: 7 }];
    expect(planVideoSegments(v, secs, new Map([['a.mp4', 0]]))[0]).toBeNull();
  });
  it('훅 길이에 못 미치는 클립은 훅에 안 넣는다', () => {
    const v = [{ path: 'a.mp4', seconds: 1 }];
    expect(planVideoSegments(v, [3.5, 6], new Map(), { hookFirst: true })[0]).toBeNull();
  });
});

describe('planAssetScenes hookFirst', () => {
  it('내용 배정이 씬2·3이어도 씬0을 먼저 준다', () => {
    const out = planAssetScenes(['p1', 'p2', 'p3'], 5, [2, 3, 0, 1, 4], { hookFirst: true });
    expect(out[0]).toBe('p1');
    // 종전(hookFirst 없음) 실측값(2026-09-18, npx tsx -e 로 확인): cap=3 인 채로 seq 를 그대로
    // 따라가면 0 은 세 번째로 채워져 'p3' 를 받는다 — null 이 아니다. hookFirst 는 그 순서를
    // 바꿔 0 을 맨 앞으로 당길 뿐, hookFirst 가 없을 때의 동작은 이 값 그대로 불변이어야 한다.
    expect(planAssetScenes(['p1', 'p2', 'p3'], 5, [2, 3, 0, 1, 4])[0]).toBe('p3');
  });
});
