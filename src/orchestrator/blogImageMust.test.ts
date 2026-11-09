import { describe, it, expect } from 'vitest';
import { parseBlogSlotMusts } from './blogImageMust';

describe('parseBlogSlotMusts', () => {
  it('칸 번호대로 놓고 없는 칸은 비운다', () => {
    const r = parseBlogSlotMusts({ slots: [
      { slot: 2, must_show: ['8자 결속'], must_not: [] },
      { slot: 1, must_show: ['손으로 줄기 흔들기'], must_not: ['세운 지주'] },
      { slot: 9, must_show: ['범위 밖'] },
    ] }, 3);
    expect(r[0]).toEqual({ show: ['손으로 줄기 흔들기'], not: ['세운 지주'] });
    expect(r[1]).toEqual({ show: ['8자 결속'], not: [] });
    expect(r[2]).toBeUndefined();
  });
  it('모양이 틀리면 전부 비운다', () => {
    expect(parseBlogSlotMusts(null, 2)).toEqual([undefined, undefined]);
    expect(parseBlogSlotMusts({ slots: 'x' }, 1)).toEqual([undefined]);
  });
});
