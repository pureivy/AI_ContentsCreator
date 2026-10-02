import { describe, it, expect } from 'vitest';
import { clipCookieHeader, clipSamplesFromItems, clipFollowersOf } from './clipPerf';

// 네이버 클립 성과(2026-10-02) — 클립 크리에이터 목록 API 의 playCount·likeCount 를 naver:clip 표본으로.
describe('clipSamplesFromItems', () => {
  const at = '2026-10-02T06:00:00.000Z';
  it('공개된 클립만 번호별 표본으로 — 초안·번호 없는 항목은 뺀다', () => {
    const m = clipSamplesFromItems([
      { draft: false, mediaContentNo: 7619909, playCount: 17, likeCount: 0 },
      { draft: true, mediaContentNo: null, draftNo: 899630, playCount: null },
      { draft: false, mediaContentNo: null, playCount: 3 },
      null,
    ], at);
    expect([...m.keys()]).toEqual(['7619909']);
    expect(m.get('7619909')).toEqual({ measuredAt: at, views: 17, likes: 0, searchInflow: [], source: 'naver:clip' });
  });
  it('재생수가 없거나 이상하면 0', () => {
    expect(clipSamplesFromItems([{ draft: false, mediaContentNo: 1, playCount: null, likeCount: -2 }], at).get('1')).toMatchObject({ views: 0, likes: 0 });
  });
});

describe('clipCookieHeader', () => {
  it('네이버 도메인 쿠키만 이어 붙인다', () => {
    expect(clipCookieHeader([
      { name: 'NID_AUT', value: 'a', domain: '.naver.com' },
      { name: 'YSC', value: 'y', domain: '.youtube.com' },
      { name: 'NID_SES', value: 's', domain: '.naver.com' },
    ])).toBe('NID_AUT=a; NID_SES=s');
  });
});

describe('clipFollowersOf — 클립 팔로워', () => {
  it('프로필(배열·객체 모두)에서 팔로워 수를 꺼낸다', () => {
    expect(clipFollowersOf([{ profileSummary: { numberOfFollowers: 3, numberOfFollowings: 0 } }])).toBe(3);
    expect(clipFollowersOf({ profileSummary: { numberOfFollowers: 0 } })).toBe(0);
  });
  it('없으면 null — 0 으로 꾸미지 않는다', () => {
    expect(clipFollowersOf({})).toBeNull();
    expect(clipFollowersOf(null)).toBeNull();
  });
});
