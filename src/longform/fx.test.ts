import { describe, expect, it } from 'vitest';
import { assignFx, ENTERS } from './fx';

const segs = (pattern: string) => pattern.split('').map((c, i) => ({ id: `s${i}`, kind: c === 's' ? 'still' as const : 'video' as const }));

describe('assignFx', () => {
  // 실데이터와 비슷한 모양: 영상 80여 개 사이에 정지 화면 묶음
  const real = segs('v'.repeat(40) + 'svsvssvs' + 'v'.repeat(20) + 'sssvsvs' + 'v'.repeat(20));
  const fx = assignFx(real, 'pilot');

  it('화면을 덮는 효과(테두리·레터박스·비네트·포인터 등)는 쓰지 않고 장면 전환·자막 기법만 쓴다', () => {
    const allowed = new Set(['아이리스 리빌', '줌 스루 전환', '키워드 팝']);
    const used = Object.values(fx).map((f) => f.tech).filter(Boolean);
    expect(used.length).toBeGreaterThan(0);
    for (const t of used) expect(allowed.has(t!)).toBe(true);
    for (const t of allowed) expect(used).toContain(t);
  });

  it('정지 화면에는 기법을 걸지 않는다', () => {
    for (const s of real) if (s.kind === 'still') expect(fx[s.id]!.tech).toBeUndefined();
  });

  it('기법이 걸린 세그먼트끼리 붙지 않고, 첫 세그먼트는 비운다', () => {
    expect(fx['s0']!.tech).toBeUndefined();
    for (let i = 1; i < real.length; i++) expect(!!fx[real[i]!.id]!.tech && !!fx[real[i - 1]!.id]!.tech).toBe(false);
  });

  it('등장 효과는 네 가지를 모두 쓰고, 같은 시드면 같은 배정', () => {
    expect(new Set(Object.values(fx).map((f) => f.enter))).toEqual(new Set(ENTERS));
    expect(assignFx(real, 'pilot')).toEqual(fx);
  });
});
