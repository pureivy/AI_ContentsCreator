import { describe, expect, it } from 'vitest';
import { cboxText, isIgScopeError, parseBlogPostList, parseCboxList, parseClipCards, parseIgComments, parseJsonp, parseYoutubeThreads } from './commentPlatforms';

describe('네이버 댓글 상자', () => {
  // 2026-10-25 실측 응답 축약 — 대추나무 글: 고객 댓글 + 주인(manager) 답글.
  const raw = `/**/cb({"success":true,"result":{"commentList":[
    {"commentNo":"908652594811895922","parentCommentNo":"908631733635645587","replyLevel":2,"contents":"안녕하세요","userName":"biondi_tree","manager":true,"regTimeGmt":"2026-10-25T13:04:35+0000"},
    {"commentNo":"908631733635645587","parentCommentNo":"908631733635645587","replyLevel":1,"replyAllCount":1,"contents":"얼마나 파야<br>보이나요? &lt;3","userName":"마춤휀스","manager":false,"regTimeGmt":"2026-10-25T07:40:45+0000"},
    {"commentNo":"2","parentCommentNo":"2","replyLevel":1,"replyAllCount":0,"contents":"새 질문","userName":"손님","manager":false,"regTimeGmt":"2026-10-25T09:00:00+0000"},
    {"commentNo":"3","parentCommentNo":"3","replyLevel":1,"replyAllCount":2,"contents":"답글이 목록에 안 실린 댓글","userName":"손님2","regTimeGmt":"2026-10-25T09:00:00+0000"},
    {"commentNo":"4","parentCommentNo":"4","replyLevel":1,"contents":"비밀","secret":true,"regTimeGmt":"2026-10-25T09:00:00+0000"}
  ]}});`;
  it('JSONP 를 풀고 최상위 댓글만, 주인 답글이 있으면 answered', () => {
    const j = parseJsonp<Parameters<typeof parseCboxList>[0]>(raw)!;
    const got = parseCboxList(j, { platform: 'blog', targetId: 'biondi_tree/224452392468' });
    expect(got.map((c) => [c.externalId, c.answered])).toEqual([['908631733635645587', true], ['2', false], ['3', true]]);
    expect(got[0]!.text).toBe('얼마나 파야\n보이나요? <3');
    expect(got[0]!.commentTs).toBe('2026-10-25T07:40:45.000Z');
  });
  it('주인 댓글은 own', () => {
    const got = parseCboxList({ result: { commentList: [{ commentNo: '9', replyLevel: 1, manager: true, contents: 'x' }] } }, { platform: 'clip', targetId: 'm' });
    expect(got[0]!.own).toBe(true);
  });
  it('태그·엔티티 정리', () => { expect(cboxText('a<b>b</b>&amp;c')).toBe('ab&c'); });
});

describe('블로그 글 목록·클립 카드', () => {
  it('댓글 수 빈 값은 0, 제목은 URL 디코딩', () => {
    expect(parseBlogPostList({ postList: [{ logNo: '1', title: '%EB%8C%80%EC%B6%94+%EB%82%98%EB%AC%B4', commentCount: '' }, { logNo: '2', commentCount: '3' }] }))
      .toEqual([{ logNo: '1', title: '대추 나무', comments: 0 }, { logNo: '2', title: '', comments: 3 }]);
  });
  it('클립 카드의 댓글 수', () => {
    expect(parseClipCards({ body: { cards: [{ content: { mediaId: 'M', description: '명자나무\n설명', interaction: { comment: { count: 1 } } } }, { content: {} }] } }))
      .toEqual([{ mediaId: 'M', description: '명자나무\n설명', comments: 1, publishedTime: '' }]);
  });
});

describe('유튜브·인스타', () => {
  it('유튜브: 우리 채널 답글이 있으면 answered, 우리 댓글은 own', () => {
    const me = 'UCme';
    const got = parseYoutubeThreads({ items: [
      { id: 't1', snippet: { videoId: 'v1', topLevelComment: { id: 'c1', snippet: { authorDisplayName: '@a', authorChannelId: { value: 'UCa' }, textOriginal: '좋아요', publishedAt: '2026-10-17T11:54:25Z' } } }, replies: { comments: [{ snippet: { authorChannelId: { value: me } } }] } },
      { id: 't2', snippet: { videoId: 'v1', topLevelComment: { id: 'c2', snippet: { authorChannelId: { value: me }, textOriginal: '감사합니다' } } } },
      { id: 't3', snippet: { videoId: 'v2', topLevelComment: { id: 'c3', snippet: { authorChannelId: { value: 'UCb' }, textOriginal: '궁녀꽃' } } } },
    ] }, me);
    expect(got.map((c) => [c.externalId, c.own, c.answered])).toEqual([['c1', false, true], ['c2', true, false], ['c3', false, false]]);
    expect(got[2]!.targetUrl).toBe('https://www.youtube.com/shorts/v2');
  });
  it('인스타: 계정 이름(대소문자 무시)으로 우리 답글을 가린다', () => {
    const got = parseIgComments({ data: [{ id: 'k1', text: '어디서 사요?', username: 'guest', replies: { data: [{ username: 'BiondiTree' }] } }, { id: 'k2', text: 'hi', username: 'guest2' }] }, { id: 'm1' }, 'bionditree');
    expect(got.map((c) => [c.externalId, c.answered])).toEqual([['k1', true], ['k2', false]]);
  });
  it('인스타 권한 오류 판정', () => {
    expect(isIgScopeError({ error: { code: 10, message: 'Application does not have permission' } })).toBe(true);
    expect(isIgScopeError({ error: { code: 4, message: 'Application request limit reached' } })).toBe(false);
  });
});
