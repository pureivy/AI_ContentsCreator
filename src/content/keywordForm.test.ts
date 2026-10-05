import { describe, it, expect } from 'vitest';
import { naturalKeyword, hasKeyword, countKeyword, keywordWritingGuide } from './keywordForm';

// 2026-10-05 대추나무 초안 — 검색어 꼴 "대추나무 심는시기"를 문장 주어로 세운 원인(정확 표기 강제) 대응.
describe('naturalKeyword — 검색어 꼴 → 글에 쓸 꼴', () => {
  it('관형형 "는" 뒤에 붙은 명사를 띄운다', () => {
    expect(naturalKeyword('대추나무 심는시기')).toBe('대추나무 심는 시기');
    expect(naturalKeyword('블루베리 키우는법')).toBe('블루베리 키우는 법');
    expect(naturalKeyword('묘목 고르는법')).toBe('묘목 고르는 법');
    expect(naturalKeyword('사과나무 키우는방법')).toBe('사과나무 키우는 방법');
  });
  it('ㄴ·ㄹ 받침 관형형은 때·시기 앞에서만 띄운다(계산법·연결법 오탐 방지)', () => {
    expect(naturalKeyword('감나무 이식할때')).toBe('감나무 이식할 때');
    expect(naturalKeyword('묘목 심을시기')).toBe('묘목 심을 시기');
    expect(naturalKeyword('비료 계산법')).toBe('비료 계산법');
    expect(naturalKeyword('호스 연결법')).toBe('호스 연결법');
  });
  it('그 밖에는 그대로, 멱등', () => {
    expect(naturalKeyword('라일락 꽃말')).toBe('라일락 꽃말');
    expect(naturalKeyword('배롱나무 가지치기')).toBe('배롱나무 가지치기');
    expect(naturalKeyword('대추나무 전정시기')).toBe('대추나무 전정시기');
    expect(naturalKeyword('대추나무 심는 시기')).toBe('대추나무 심는 시기');
    expect(naturalKeyword(naturalKeyword('대추나무 심는시기'))).toBe('대추나무 심는 시기');
    expect(naturalKeyword('  대추나무   심는시기 ')).toBe('대추나무 심는 시기');
  });
});

describe('hasKeyword / countKeyword — 띄어쓰기·조사 무시', () => {
  const kw = '대추나무 심는시기';
  it('바른 띄어쓰기·뒤 조사·토큰 사이 조사·굵게 마커를 인정한다', () => {
    expect(hasKeyword('대추나무 심는 시기는 땅으로 확인해요.', kw)).toBe(true);
    expect(hasKeyword('대추나무 심는시기, 가을 vs 봄', kw)).toBe(true);
    expect(hasKeyword('대추나무를 심는 시기는 10월 하순이에요.', kw)).toBe(true);
    expect(hasKeyword('**대추나무** 심는 시기', kw)).toBe(true);
  });
  it('다른 말은 인정하지 않는다', () => {
    expect(hasKeyword('대추나무는 10월에 심어요.', kw)).toBe(false);
    expect(hasKeyword('대추나무 전정 시기', kw)).toBe(false);
    expect(hasKeyword('아무 글', '')).toBe(false);
  });
  it('출현 횟수를 같은 판정으로 센다', () => {
    expect(countKeyword('대추나무 심는 시기는 가을. 대추나무 심는시기 정리. 대추나무를 심는 시기', kw)).toBe(3);
    expect(countKeyword('없음', kw)).toBe(0);
  });
  it('정규식 특수문자가 든 키워드도 안전하다', () => {
    expect(hasKeyword('C++ 입문 (기초)', 'C++ 입문 (기초)')).toBe(true);
  });
});

describe('keywordWritingGuide — 작가·포장 프롬프트 블록', () => {
  it('검색어 꼴과 글 꼴을 함께 보여 주고, 주어·"의" 명사구를 금한다', () => {
    const g = keywordWritingGuide('대추나무 심는시기');
    expect(g).toContain('검색어는 "대추나무 심는시기"이지만 글에는 바른 띄어쓰기로 "대추나무 심는 시기"');
    expect(g).toContain('문장 주어로 세우거나');
    expect(g).toContain('(X)');
    expect(g).not.toContain('대추나무 심는시기의'); // 예시는 ○○ 자리표시로만(실수종 예시 구절 복제 사고 방지)
  });
  // 리뷰(2026-10-05) — "어순을 바꿔도 된다"(예 "○○는 언제 심나요")를 제목·첫 문단에서 따르면 SEO 판정(hasKeyword)이 떨어진다.
  it('제목·첫 문단은 낱말 순서를 지키고 조사만 — 어순 변형은 그 밖에서만. 예시에 구체 날짜가 없다', () => {
    const g = keywordWritingGuide('대추나무 심는시기');
    expect(g).toContain('제목·첫 문단에는 키워드 낱말 순서를 그대로 지키고 조사만 붙여라');
    expect(g).toContain('그 밖의 본문에서는 어순을 바꿔');
    expect(g).not.toMatch(/\d+월/);
    // 가이드가 허용하는 제목·첫 문단 꼴은 실제로 SEO 판정을 통과하고, 어순 변형은 통과하지 못한다(그래서 본문에서만 허용).
    expect(hasKeyword('대추나무를 심는 시기는', '대추나무 심는시기')).toBe(true);
    expect(hasKeyword('대추나무는 언제 심나요', '대추나무 심는시기')).toBe(false);
  });
  it('띄어쓰기가 이미 바르면 한 꼴만, 키워드가 없으면 빈 문자열', () => {
    expect(keywordWritingGuide('라일락 꽃말')).toContain('핵심 키워드: "라일락 꽃말".');
    expect(keywordWritingGuide('')).toBe('');
    expect(keywordWritingGuide(undefined)).toBe('');
  });
});
