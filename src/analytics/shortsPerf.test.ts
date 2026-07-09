import { describe, it, expect } from 'vitest';
import { shortsSignal, parseStatsResponse, shortsPerfDue } from './shortsPerf';

describe('shortsSignal — 로그 스케일 + 좋아요율(순수)', () => {
  it('0뷰=0, 1만뷰≈0.8(뷰만), 좋아요율 1% 이상이면 +0.2 만점', () => {
    expect(shortsSignal(0, 0)).toBe(0);
    expect(shortsSignal(10_000, 0)).toBeGreaterThan(0.75);
    expect(shortsSignal(10_000, 0)).toBeLessThanOrEqual(0.8);
    expect(shortsSignal(10_000, 100)).toBeCloseTo(shortsSignal(10_000, 0) + 0.2, 5);
    expect(shortsSignal(100, 0)).toBeLessThan(shortsSignal(1_000, 0)); // 단조 증가
  });
});
describe('parseStatsResponse — 이형·결측 방어(순수)', () => {
  it('정상 항목 매핑, id 없음/비수치/음수 방어', () => {
    const m = parseStatsResponse({ items: [
      { id: 'v1', statistics: { viewCount: '123', likeCount: '4', commentCount: '5' } },
      { statistics: { viewCount: '9' } },
      { id: 'v2', statistics: { viewCount: 'x', likeCount: '-3' } },
    ] });
    expect(m.get('v1')).toEqual({ views: 123, likes: 4, comments: 5 });
    expect(m.has('')).toBe(false);
    expect(m.get('v2')).toEqual({ views: 0, likes: 0, comments: 0 });
    expect(parseStatsResponse(null).size).toBe(0);
    expect(parseStatsResponse({}).size).toBe(0);
  });
});
describe('shortsPerfDue — 창 내 매일·경과 후 미강화 1회(순수)', () => {
  const DAY = 86_400_000;
  const base = { youtubeId: 'v', youtubeTs: new Date(1_000_000_000_000).toISOString() };
  const now = 1_000_000_000_000;
  it('창 내 true(reflected 무관), 경과+미강화 true, 경과+강화 false', () => {
    expect(shortsPerfDue(base, now + 3 * DAY, 7)).toBe(true);
    expect(shortsPerfDue({ ...base, perfReflected: true }, now + 3 * DAY, 7)).toBe(true);
    expect(shortsPerfDue(base, now + 10 * DAY, 7)).toBe(true);
    expect(shortsPerfDue({ ...base, perfReflected: true }, now + 10 * DAY, 7)).toBe(false);
  });
  it('필드 결측·이상 Ts 는 false', () => {
    expect(shortsPerfDue({ youtubeTs: base.youtubeTs }, now, 7)).toBe(false);
    expect(shortsPerfDue({ youtubeId: 'v' }, now, 7)).toBe(false);
    expect(shortsPerfDue({ youtubeId: 'v', youtubeTs: '이상한값' }, now, 7)).toBe(false);
  });
});
