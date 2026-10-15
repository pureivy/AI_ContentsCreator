import { describe, it, expect } from 'vitest';
import { cardFrameOrder } from './cardFrames';

describe('cardFrameOrder — 카드 추가 실촬영 컷의 순간 순서(2026-10-15)', () => {
  it('파일을 번갈고, 한 파일 안에서는 이웃 순간을 연달아 보지 않는다', () => {
    const o = cardFrameOrder([{ mediaId: 'a', file: 'a.mp4', seconds: 21 }, { mediaId: 'b', file: 'b.mp4', seconds: 6 }]);
    expect(o[0]!.mediaId).toBe('a');
    expect(o[1]!.mediaId).toBe('b');
    const aTimes = o.filter((x) => x.mediaId === 'a').map((x) => x.atSec);
    expect(Math.abs(aTimes[1]! - aTimes[0]!)).toBeGreaterThan(2.5); // 첫 두 순간이 이웃(2.5초)이 아니다
    expect(new Set(aTimes).size).toBe(aTimes.length);                 // 같은 순간을 두 번 보지 않는다
  });
  it('파일이 없으면 빈 목록', () => {
    expect(cardFrameOrder([])).toEqual([]);
  });
});
