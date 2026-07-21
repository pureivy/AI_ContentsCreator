import { describe, it, expect } from 'vitest';
import { splitTwoLines, derivePoints } from './shortsThumbnail';

describe('splitTwoLines', () => {
  it('단어(공백) 경계에서만 분할 — 어떤 단어도 중간에서 쪼개지 않음', () => {
    for (const t of ['하스카프베리 재배 두 품종', '물 더 주면 나무 죽어요', '폭염 나무 물주기 급수법']) {
      const r = splitTwoLines(t);
      // 두 줄을 다시 합치면 원본 단어 배열과 정확히 일치(= 어떤 단어도 두 줄에 걸쳐 쪼개지지 않음)
      expect([r.line1, r.line2].filter(Boolean).join(' ').split(/\s+/)).toEqual(t.split(/\s+/));
    }
  });
  it('첫 단어가 길어도 통째로 유지(하스카프베리 → 하스카/프베리 금지)', () => {
    const r = splitTwoLines('하스카프베리 재배 두 품종이 필수');
    expect(r.line1.split(/\s+/)[0]).toBe('하스카프베리');
  });
  it('단어 하나면 쪼개지 않고 한 줄(line2 빈값)', () => {
    expect(splitTwoLines('하스카프베리')).toEqual({ line1: '하스카프베리', line2: '' });
  });
});

describe('derivePoints', () => {
  it('설명을 짧은 구 2~3개로 — 좌하단 포인트 폴백', () => {
    const p = derivePoints('장마철엔 물빼기가 먼저. 뿌리 상하는 진짜 이유. 침수목 살리는 순서.');
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p.every((x) => x.length >= 4 && x.length <= 22)).toBe(true);
  });
  it('빈 설명·초장문은 제외 → 빈 배열 가능', () => {
    expect(derivePoints('')).toEqual([]);
    expect(derivePoints('가나')).toEqual([]); // 4자 미만 제외
  });
});
