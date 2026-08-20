import { describe, it, expect } from 'vitest';
import { narrationStyleIssues, cardStyleIssues, hookKeywordLeadIssues } from './styleLint';

describe('hookKeywordLeadIssues — 훅 첫 2초 키워드 낭독(2026-08-20 조회수 감사)', () => {
  it('훅 앞 12자 안에 키워드 전체가 있으면 검출한다(공백 무시)', () => {
    expect(hookKeywordLeadIssues(['배롱나무 개화시기, 가지 끝을 보세요.'], '배롱나무 개화시기')).toHaveLength(1);
    expect(hookKeywordLeadIssues(['신비복숭아묘목 고를 때 접목부부터 봐요.'], '신비복숭아묘목')).toHaveLength(1);
  });
  it('키워드가 훅 뒤쪽·씬2 이후로 밀려 있으면 통과한다', () => {
    expect(hookKeywordLeadIssues(['까맣게 익어도 아직 이릅니다. 배롱나무 얘기예요.'], '배롱나무')).toEqual([]);
    expect(hookKeywordLeadIssues(['잠깐, 그 가지 자르지 마세요.', '배롱나무 개화시기 얘기입니다.'], '배롱나무 개화시기')).toEqual([]);
  });
  it('부분 문자열·지시 준수 대본은 오탐하지 않는다(리뷰 실측: 곶감나무⊃감나무, 짧은 제동 선행)', () => {
    expect(hookKeywordLeadIssues(['곶감나무 아래는 늦어요.'], '감나무')).toEqual([]);
    expect(hookKeywordLeadIssues(['잠깐, 배롱나무 그 가지 자르지 마세요.'], '배롱나무')).toEqual([]);
    expect(hookKeywordLeadIssues(['이 묘목, 잘못 골랐어요.'], '묘목')).toEqual([]);
  });
  it('공백 제거 15자 이상 긴 키워드도 첫 문장 시작이면 검출한다', () => {
    expect(hookKeywordLeadIssues(['배롱나무 개화시기 앞당기는 방법부터 볼게요.'], '배롱나무 개화시기 앞당기는 방법')).toHaveLength(1);
  });
  it('키워드 없음·2자 미만·빈 훅은 오탐 없이 통과한다', () => {
    expect(hookKeywordLeadIssues(['아무 훅 문장입니다.'], undefined)).toEqual([]);
    expect(hookKeywordLeadIssues(['아무 훅 문장입니다.'], '솔')).toEqual([]);
    expect(hookKeywordLeadIssues([], '배롱나무')).toEqual([]);
  });
});

describe('narrationStyleIssues', () => {
  it('한 씬 두 문장이 모두 -ㅂ니다 종결이면 검출한다', () => {
    const issues = narrationStyleIssues(['가지를 치웁니다. 눈으로 확인되는 것부터 거릅니다.']);
    expect(issues.some((i) => i.includes('-ㅂ니다'))).toBe(true);
  });

  it('어미가 섞인 씬·질문 종결은 통과한다', () => {
    expect(narrationStyleIssues(['가지를 치우세요. 눈에 보이는 것부터 거르면 돼요.'])).toEqual([]);
    expect(narrationStyleIssues(['어디부터 볼까요? 뿌리부터 봅니다.'])).toEqual([]);
  });

  it('훅 질문-반전 공식(보셨나요?+정작)을 검출한다 — 실측 15편 중 7편 지문', () => {
    const issues = narrationStyleIssues(['이름표부터 보셨나요? 정작 봐야 할 건 따로 있어요.']);
    expect(issues.some((i) => i.includes('공식'))).toBe(true);
  });

  it("'새 가지'(발음 혼동)와 '기 때문입니다' 2회를 검출한다", () => {
    const issues = narrationStyleIssues([
      '그래야 새 가지가 자라요.',
      '뿌리가 잘리기 때문입니다.',
      '물을 계속 옮기기 때문입니다.',
    ]);
    expect(issues.some((i) => i.includes('새로 난 가지'))).toBe(true);
    expect(issues.some((i) => i.includes('기 때문입니다'))).toBe(true);
  });

  it("'가 아니라' 재정의 문형 2회를 검출한다", () => {
    const issues = narrationStyleIssues([
      '날짜가 아니라 뿌리 상태로 정해져요.',
      '색이 아니라 송이 안 상태로 봐요.',
    ]);
    expect(issues.some((i) => i.includes('재정의'))).toBe(true);
  });
});

describe('cardStyleIssues', () => {
  it('3장 연속 -ㅂ니다 종결을 검출한다 — 실측 40장 중 36장 지문', () => {
    const issues = cardStyleIssues([
      { headline: 'h1', body: '이 두 선이 정합니다' },
      { headline: 'h2', body: '첫 줄\n둘 다 확인해야 안전합니다' },
      { headline: 'h3', body: '자리가 절반은 정해집니다' },
    ]);
    expect(issues.some((i) => i.includes('3장 연속'))).toBe(true);
  });

  it('중간에 다른 종결이 끼면 통과한다', () => {
    expect(cardStyleIssues([
      { headline: 'h1', body: '이 두 선이 정합니다' },
      { headline: 'h2', body: '판정은 맨 아래 알로' },
      { headline: 'h3', body: '자리가 절반은 정해집니다' },
    ])).toEqual([]);
  });
});
