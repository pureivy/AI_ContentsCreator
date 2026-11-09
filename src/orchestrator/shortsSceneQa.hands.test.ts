import { describe, it, expect } from 'vitest';
import { handBoxes } from './shortsSceneQa';

const near = (xs: number[][], ys: number[][]) => { expect(xs).toHaveLength(ys.length); xs.forEach((x, i) => x.forEach((v, j) => expect(v).toBeCloseTo(ys[i]![j]!, 3))); };

describe('handBoxes — 손 상자 정리', () => {
  it('그 장의 상자만, 사방 35%(최소 0.1) 넓힌다', () => {
    near(handBoxes([{ scene: 1, box: [0.2, 0.3, 0.6, 0.7] }, { scene: 2, box: [0, 0, 1, 1] }], 1), [[0.06, 0.16, 0.74, 0.84]]);
  });
  it('가장자리에 붙은 상자는 안쪽으로 밀어 최소 폭 0.4 를 지킨다(손끝 빠짐 대비)', () => {
    // 실측: 손이 y 0.55~ 인데 모델은 [0,0.72,0.42,1] 을 줬다 — 넓힌 뒤 0.6 이전부터 덮어야 한다
    const [b] = handBoxes([{ scene: 1, box: [0, 0.72, 0.42, 1] }], 1);
    expect(b![0]).toBe(0); expect(b![3]).toBe(1); expect(b![1]).toBeLessThan(0.6); expect(b![2] - b![0]).toBeGreaterThanOrEqual(0.4);
  });
  it('뒤집힌 좌표는 바로잡는다', () => {
    near(handBoxes([{ scene: 1, box: [0.6, 0.7, 0.2, 0.3] }], 1), [[0.06, 0.16, 0.74, 0.84]]);
  });
  it('점 같은 상자·잘못된 값은 버리고, 장마다 2개까지', () => {
    expect(handBoxes([{ scene: 1, box: [0.1, 0.1, 0.12, 0.5] }, { scene: 1, box: ['a', 0, 1, 1] }, { scene: 1, box: [0, 0] }], 1)).toEqual([]);
    expect(handBoxes([1, 2, 3].map(() => ({ scene: 1, box: [0.1, 0.1, 0.5, 0.5] })), 1)).toHaveLength(2);
    expect(handBoxes(undefined, 1)).toEqual([]);
  });
});
