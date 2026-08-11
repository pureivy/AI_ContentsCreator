import { describe, it, expect } from 'vitest';
import { narrationStyleIssues, cardStyleIssues } from './styleLint';

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
