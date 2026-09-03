import { describe, it, expect } from 'vitest';
// @ts-ignore — remotion/ 는 root tsc include 밖
import { EDIT_TECHNIQUES, TECHNIQUES_PER_VIDEO, pickTechniques, techniqueScene } from '../../remotion/editTechniques';

describe('편집 기법 뽑기 — 편마다 쓰는 기술이 다르다', () => {
  it('편마다 2가지, 중복 없이', () => {
    for (let n = 0; n < 60; n++) {
      const t = pickTechniques(`short_${n}`);
      expect(t).toHaveLength(TECHNIQUES_PER_VIDEO);
      expect(new Set(t).size).toBe(TECHNIQUES_PER_VIDEO);
    }
  });
  it('같은 편은 같은 기법 — 재렌더해도 화면이 안 바뀐다', () => {
    for (const id of ['short_a', 'short_b']) expect(pickTechniques(id)).toEqual(pickTechniques(id));
  });
  it('조합이 실제로 갈린다 — 종전엔 8편이 2조합뿐이었다', () => {
    const combos = new Set(Array.from({ length: 60 }, (_, n) => [...pickTechniques(`short_${n}`)].sort().join(',')));
    expect(combos.size).toBeGreaterThanOrEqual(6);
  });
  it('다섯 기법이 모두 등장한다 — 죽은 항목이 없다', () => {
    const seen = new Set(Array.from({ length: 300 }, (_, n) => pickTechniques(`s${n}`)).flat());
    expect(seen.size).toBe(EDIT_TECHNIQUES.length);
  });
  it('풀보다 많이 달라고 해도 중복을 안 만든다', () => {
    const t = pickTechniques('x', 99);
    expect(t).toHaveLength(EDIT_TECHNIQUES.length);
    expect(new Set(t).size).toBe(EDIT_TECHNIQUES.length);
  });
});

describe('기법이 걸리는 씬', () => {
  it('훅(0)과 마지막 씬에는 절대 안 걸린다 — 훅 첫 프레임이 곧 커버다', () => {
    for (let n = 0; n < 200; n++) {
      for (const t of EDIT_TECHNIQUES) {
        for (const cnt of [3, 4, 5, 6]) {
          const at = techniqueScene(`short_${n}`, t, cnt);
          expect(at).toBeGreaterThanOrEqual(1);
          expect(at).toBeLessThanOrEqual(cnt - 2);
        }
      }
    }
  });
  it('본문이 없는 짧은 세트는 -1(안 검)', () => {
    expect(techniqueScene('x', '레터박스', 2)).toBe(-1);
    expect(techniqueScene('x', '레터박스', 1)).toBe(-1);
  });
  it('결정적이다', () => {
    expect(techniqueScene('x', '흑백 인서트', 5)).toBe(techniqueScene('x', '흑백 인서트', 5));
  });
});
