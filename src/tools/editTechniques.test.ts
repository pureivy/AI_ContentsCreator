import { describe, it, expect } from 'vitest';
// @ts-ignore — remotion/ 는 root tsc include 밖
import { EDIT_TECHNIQUES, TECHNIQUES_PER_VIDEO, TECHNIQUES_UNSAFE_ON_REAL, TECHNIQUES_NEED_FOCUS, TECHNIQUES_ONLY_ON_REAL, pickTechniques, techniqueScene, assignTechniques } from '../../remotion/editTechniques';

/** 좌표 기법도 걸리게 본문 전 씬에 초점을 준다(테스트 편의). */
const allBody = (cnt: number): Set<number> => new Set(Array.from({ length: Math.max(0, cnt - 2) }, (_, i) => i + 1));

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
  it('풀의 기법이 모두 등장한다 — 죽은 항목이 없다', () => {
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
          const at = techniqueScene(`short_${n}`, t, cnt, TECHNIQUES_ONLY_ON_REAL.includes(t) ? allBody(cnt) : new Set(), allBody(cnt));
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
    expect(techniqueScene('x', '정지 강조', 5)).toBe(techniqueScene('x', '정지 강조', 5));
  });
});

describe('techniqueScene — 실촬영 씬은 파괴적 기법을 피한다', () => {
  it('정지·핸드헬드·초점 띠는 실촬영 씬에 안 걸린다 — 사장님 영상이 흑백으로 나간 적이 있다(흑백은 풀에서 뺐다)', () => {
    const real = new Set([2]);
    for (const t of TECHNIQUES_UNSAFE_ON_REAL) {
      for (let n = 0; n < 200; n++) {
        expect(techniqueScene(`seed_${n}`, t, 6, real)).not.toBe(2);
      }
    }
  });
  it('얹기만 하는 기법은 실촬영 씬에도 걸린다 — 무해하다', () => {
    const safe = EDIT_TECHNIQUES.filter((t) => !TECHNIQUES_UNSAFE_ON_REAL.includes(t) && !TECHNIQUES_NEED_FOCUS.includes(t) && !TECHNIQUES_ONLY_ON_REAL.includes(t));
    const hits = new Set<number>();
    for (const t of safe) for (let n = 0; n < 200; n++) hits.add(techniqueScene(`seed_${n}`, t, 6, new Set([2])));
    expect(hits.has(2)).toBe(true);
  });
  it('피할 자리가 없으면 아예 안 건다 — 억지로 거느니 안 거는 편이 낫다', () => {
    // 5씬(훅0·CTA4)이면 본문은 1·2·3뿐. 셋 다 실촬영이면 걸 자리가 없다.
    expect(techniqueScene('x', '정지 강조', 5, new Set([1, 2, 3]))).toBe(-1);
  });
  it('실촬영 표시가 없으면 종전과 같은 자리를 고른다 — 기존 편의 재렌더가 안 바뀐다', () => {
    for (const t of EDIT_TECHNIQUES.filter((x) => !TECHNIQUES_ONLY_ON_REAL.includes(x))) {
      for (let n = 0; n < 50; n++) {
        const at = techniqueScene(`s${n}`, t, 6, new Set(), allBody(6));
        expect(at).toBeGreaterThanOrEqual(1);
        expect(at).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('풀 개편(2026-09-08) — 흑백 인서트 제거, 다섯 기법 추가', () => {
  it('흑백 인서트가 풀에 없다', () => {
    expect((EDIT_TECHNIQUES as readonly string[]).includes('흑백 인서트')).toBe(false);
  });
  it('추가된 다섯 기법이 풀에 있다', () => {
    for (const t of ['컬러 팝', '아이리스 리빌', '소프트 글로우', '핸드헬드 흔들림', '초점 띠']) expect(EDIT_TECHNIQUES).toContain(t);
    expect(EDIT_TECHNIQUES).toHaveLength(14);
  });
  it('핸드헬드·초점 띠는 실촬영 씬을 피한다, 컬러 팝·글로우·아이리스는 실촬영에도 무해', () => {
    expect(TECHNIQUES_UNSAFE_ON_REAL).toContain('핸드헬드 흔들림');
    expect(TECHNIQUES_UNSAFE_ON_REAL).toContain('초점 띠');
    for (const t of ['컬러 팝', '소프트 글로우', '아이리스 리빌']) expect(TECHNIQUES_UNSAFE_ON_REAL).not.toContain(t);
  });
});

describe('2차 확장(2026-09-09) — 시선 유도 4종 + 줌 스루 전환', () => {
  it('다섯 기법이 풀에 있다', () => {
    for (const t of ['포인터 링', '스포트라이트', '인셋 확대창', '키워드 팝', '줌 스루 전환']) expect(EDIT_TECHNIQUES).toContain(t);
  });
  it('좌표 기법은 초점이 있는 씬에만 걸린다 — 없으면 -1(가운데를 짚는 척하지 않는다)', () => {
    for (const t of TECHNIQUES_NEED_FOCUS) {
      for (let n = 0; n < 100; n++) {
        expect(techniqueScene(`f${n}`, t, 5)).toBe(-1);
        expect(techniqueScene(`f${n}`, t, 5, new Set(), new Set([2]))).toBe(2);
      }
    }
  });
  it('인셋 확대창은 실촬영 씬을 피한다(정지 이미지가 필요) — 포인터 링·스포트라이트는 영상이어도 초점만 있으면 된다', () => {
    expect(TECHNIQUES_UNSAFE_ON_REAL).toContain('인셋 확대창');
    expect(techniqueScene('x', '인셋 확대창', 5, new Set([2]), new Set([2]))).toBe(-1);
    expect(techniqueScene('x', '포인터 링', 5, new Set([2]), new Set([2]))).toBe(2);
  });
  it('assignTechniques — 못 거는 기법은 다음 후보로 넘어가 편마다 2개가 실제로 걸린다', () => {
    for (let n = 0; n < 100; n++) {
      const m = assignTechniques(`a${n}`, 5); // 초점 없음 → 좌표 기법 셋은 전부 못 건다
      expect(m.size).toBe(TECHNIQUES_PER_VIDEO);
      for (const [at, t] of m) { expect(at).toBeGreaterThanOrEqual(1); expect(at).toBeLessThanOrEqual(3); expect(TECHNIQUES_NEED_FOCUS).not.toContain(t); }
    }
  });
  it('assignTechniques — 초점이 있으면 좌표 기법도 등장하고, 한 씬에 하나만', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 200; n++) {
      const m = assignTechniques(`b${n}`, 5, new Set(), new Set([1, 2, 3]));
      expect(m.size).toBe(2);
      expect(new Set(m.keys()).size).toBe(2);
      for (const t of m.values()) seen.add(t);
    }
    for (const t of TECHNIQUES_NEED_FOCUS) expect(seen.has(t)).toBe(true);
  });
  it('assignTechniques — 결정적이고, 시드가 없으면 비어 있다', () => {
    expect([...assignTechniques('c', 5, new Set(), new Set([2]))]).toEqual([...assignTechniques('c', 5, new Set(), new Set([2]))]);
    expect(assignTechniques('', 5).size).toBe(0);
  });
});

describe('테두리 프레임은 보관소 영상 씬에만(사장님 확정 2026-09-09)', () => {
  it('실촬영 씬이 없으면 -1, 있으면 그 씬', () => {
    expect(TECHNIQUES_ONLY_ON_REAL).toContain('테두리 프레임');
    for (let n = 0; n < 100; n++) {
      expect(techniqueScene(`r${n}`, '테두리 프레임', 5)).toBe(-1);
      expect(techniqueScene(`r${n}`, '테두리 프레임', 5, new Set([2]))).toBe(2);
    }
  });
  it('assignTechniques — 실촬영이 없는 편에는 테두리 프레임이 안 나오고, 있는 편에는 그 씬에만 나온다', () => {
    for (let n = 0; n < 200; n++) {
      for (const t of assignTechniques(`q${n}`, 5).values()) expect(t).not.toBe('테두리 프레임');
      for (const [at, t] of assignTechniques(`q${n}`, 5, new Set([3]))) if (t === '테두리 프레임') expect(at).toBe(3);
    }
  });
});
