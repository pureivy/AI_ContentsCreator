import { describe, it, expect } from 'vitest';
import { storySubjectOf, findStoryRepeat } from './storyRepeat';

// 같은 수종 같은 이야기(2026-10-30) — 실측 반복(배나무 가지치기 6주 4편·감나무 깍지벌레 3편)을 막고, 소재가 다르면 통과.

const NOW = Date.parse('2026-10-30T00:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('storySubjectOf', () => {
  it('구체적인 소재가 먼저 잡힌다', () => {
    expect(storySubjectOf('감나무 깍지벌레, 잎이 진 뒤부터 없앨 수 있나요?')).toBe('병해충');
    expect(storySubjectOf('어린 배나무 가지치기, 가을은 정리만')).toBe('전정');
    expect(storySubjectOf('하스카프베리 열매 안 달리는 이유, 두 품종이 답이다')).toBe('결실');
    expect(storySubjectOf('측백나무 생울타리, 몇 그루 필요한지')).toBe('심기·자리');
  });
  it('이야기 글·소재 없는 제목은 판정하지 않는다', () => {
    expect(storySubjectOf('회화나무가 선비의 나무가 된 이유')).toBeUndefined();
    expect(storySubjectOf('')).toBeUndefined();
  });
  it("'얼마'는 월동이 아니다", () => { expect(storySubjectOf('배롱나무 묘목 값은 얼마')).not.toBe('월동'); });
  it('리뷰 반영 — 넓은 말이 다른 이야기를 묶지 않는다(2026-10-30)', () => {
    expect(storySubjectOf('배롱나무 심을 자리 고르는 법')).toBe('심기·자리');
    expect(storySubjectOf('블루베리 한 그루 심는 법')).toBe('심기·자리');
    expect(storySubjectOf('블루베리 영양 성분')).toBeUndefined();
    expect(storySubjectOf('모과나무 밑동 굵기')).toBeUndefined();
    expect(storySubjectOf('감나무밑동덮기, 뿌리가 얼기 전에')).toBe('월동');
    expect(storySubjectOf('사과나무 열매가 안 열리는 이유')).toBe('결실');
    expect(storySubjectOf('사과나무 묘목 고르는 법')).toBe('품종·구별');
  });
});

describe('findStoryRepeat', () => {
  const priors = [
    { title: '배나무 가지치기, 큰 가지부터 순서를 정하세요', species: '배나무', ts: day(17) },
    { title: '배나무 노목 전정, 잎이 진 뒤로 미루는 까닭', species: '배나무', ts: day(30) },
    { title: '감나무 깍지벌레, 어린나무 가지에서 잡는 법', species: '감나무', ts: day(70) },
  ];
  it('같은 수종·같은 소재를 창 안에 다시 쓰면 가장 최근 글을 돌려준다', () => {
    const r = findStoryRepeat({ title: '어린 배나무 가지치기, 봄에는 모양 잡기', species: '배나무' }, priors, NOW);
    expect(r?.subject).toBe('전정');
    expect(r?.daysAgo).toBe(17);
  });
  it('같은 수종이어도 소재가 다르면 통과 — 잘 된 수종의 재등장', () => {
    expect(findStoryRepeat({ title: '배나무 묘목 심기, 자리부터', species: '배나무' }, priors, NOW)).toBeNull();
  });
  it('창(60일) 밖이면 통과, 수종 모르면 판정 없음', () => {
    expect(findStoryRepeat({ title: '감나무 깍지벌레 겨울 방제', species: '감나무' }, priors, NOW)).toBeNull();
    expect(findStoryRepeat({ title: '나무 가지치기 기본' }, priors, NOW)).toBeNull();
  });
});
