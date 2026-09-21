import { describe, it, expect } from 'vitest';
import { angleTokens, angleMatches, angleVerdict, angleNote, gardenSuggestions } from './angleCheck';

const sug = ['호두나무 심는 시기', '호두나무 열매 안 열리는 이유', '호두나무 가지치기', '호두나무 묘목 가격', '호두나무 키우기', '호두 나무 꽃'];

describe('angleTokens — 자동완성에서 각도 토큰(순수)', () => {
  it('수종명·불용어를 빼고 첫 등장 순', () => {
    expect(angleTokens('호두나무', sug)).toEqual(['심는', '시기', '열매', '열리는', '가지치기', '묘목', '가격', '키우기']); // '꽃'은 1자라 제외
  });
  it('연관어 없으면 빈 배열', () => {
    expect(angleTokens('호두나무', [])).toEqual([]);
  });
});

describe('angleMatches / angleVerdict — 제목이 실검색 각도 안에 있는가', () => {
  const tokens = angleTokens('호두나무', sug);
  it('심는 시기 제목은 ok, 흙 점검 제목은 unverified(2026-09-21 실사고)', () => {
    expect(angleMatches('호두나무 심는 시기, 가을이 나은 이유', tokens)).toEqual(['심는', '시기']);
    expect(angleVerdict('호두나무', '호두나무 심는 시기, 가을이 나은 이유', sug).status).toBe('ok');
    const v = angleVerdict('호두나무', '호두나무가 못 자라는 이유, 흙부터 점검하세요', sug);
    expect(v.status).toBe('unverified');
    expect(v.matched).toEqual([]);
    expect(v.angles.slice(0, 3)).toEqual(['심는', '시기', '열매']);
  });
  it('활용형 완충 — 심기↔심는(3자 이상만)', () => {
    expect(angleMatches('호두나무 심기 전에 볼 것', ['심는'])).toEqual(['심는']);
    expect(angleMatches('가을 정원 정리', ['시기'])).toEqual([]);
  });
  it("'이유' 같은 범용어만 겹치는 것은 겹침이 아니다", () => {
    expect(angleVerdict('호두나무', '호두나무가 못 자라는 이유', ['호두나무 안 자라는 이유']).status).toBe('ok'); // '자라는' 어간 겹침
    expect(angleVerdict('호두나무', '호두나무 흙 고르는 이유', ['호두나무 열매 이유']).status).toBe('unverified');
  });
  it('연관어가 없으면 unknown(통과)', () => {
    expect(angleVerdict('호두나무', '아무 제목', []).status).toBe('unknown');
  });
});

describe('gardenSuggestions — 상호·가구·기차 잡음 제거(2026-09-21 실측)', () => {
  it('호두나무 자동완성 8개 중 원예는 묘목 하나, 무궁화는 꽃말만', () => {
    expect(gardenSuggestions(['호두나무 묘목', '호두나무캠핑장', '호두나무 식탁', '호두나무집', '호두나무한의원', '호두나무 도마', '호두나무카페', '호두나무떡방'])).toEqual(['호두나무 묘목']);
    expect(gardenSuggestions(['무궁화호', '무궁화반점', '무궁화 꽃말', '무궁화호 예매'])).toEqual(['무궁화 꽃말']);
  });
  it('실측 호두나무(네이버+유튜브) → 각도는 묘목·재배·가지치기·전지·열매, "흙" 제목은 unverified', () => {
    const real = ['호두나무 묘목', '호두나무캠핑장', '호두나무 식탁', '호두나무재배', '호두나무가지치기', '호두나무전지방법', '호두나무교회', '호두나무 열매가 안열려요'];
    const v = angleVerdict('호두나무', '호두나무가 못 자라는 이유, 흙부터 점검하세요', real);
    expect(v.status).toBe('unverified');
    expect(v.angles).toEqual(['묘목', '재배', '가지치기', '전지방법', '열매가', '안열려요']);
    expect(angleVerdict('호두나무', '호두나무 열매가 안 열리는 이유, 전지부터', real).status).toBe('ok');
  });
});

describe('angleNote', () => {
  it('연관어를 한 줄로, 없으면 빈 문자열', () => {
    expect(angleNote('호두나무', ['심는', '시기'])).toBe('호두나무 실검색 연관어: 심는 · 시기 — 이 중 하나로 각도를 잡아라');
    expect(angleNote('호두나무', [])).toBe('');
  });
});
