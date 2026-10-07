import { describe, it, expect } from 'vitest';
import { isCultivationQuery, namesSpecies, speciesNamePos, cultivationDemand, ytRotation, extSuggestionsFor, cultivationTotal, cultivationMeasured, extTopicsBlock, type ExtTopicsSnap } from './externalTopics';

const none = (): undefined => undefined;

describe('isCultivationQuery — 재배 수요만(먹거리·효능 제외)', () => {
  it('2026-10-07 실측 모양', () => {
    expect(isCultivationQuery('마가목묘목')).toBe(true);
    expect(isCultivationQuery('대추나무전지시기')).toBe(true);
    expect(isCultivationQuery('마가목효능')).toBe(false);
    expect(isCultivationQuery('마가목열매효능')).toBe(false);
    expect(isCultivationQuery('냉동블루베리')).toBe(false);
    expect(isCultivationQuery('태추단감가격')).toBe(false);
    expect(isCultivationQuery('블루베리묘목가격')).toBe(true);   // 묘목 가격은 재배 수요
  });
});

describe('namesSpecies·speciesNamePos — 그 수종 이름이 든 연관어만', () => {
  it('수종과 무관한 연관어(때죽나무·조경수·개업화분)는 못 들어온다', () => {
    for (const k of ['때죽나무', '조경수', '개업화분', '아스파라거스키우기']) expect(namesSpecies(k, '마가목')).toBe(false);
  });
  it('어간·품종(단감)·별칭', () => {
    expect(namesSpecies('자두묘목', '자두나무')).toBe(true);
    expect(namesSpecies('태추단감묘목', '감나무')).toBe(true);
    expect(namesSpecies('감자키우기', '감나무')).toBe(false);
    expect(namesSpecies('백일홍묘목', '배롱나무', ['백일홍'])).toBe(true);
  });
  it('겹치면 뒤에 오는 이름이 더 뒤에서 끝난다(사과대추 → 대추)', () => {
    expect(speciesNamePos('사과대추묘목', '대추나무')).toBeGreaterThan(speciesNamePos('사과대추묘목', '사과나무'));
  });
});

describe('cultivationDemand — 수종별 재배 수요', () => {
  const rows = [
    { keyword: '마가목', total: 34_180 }, { keyword: '마가목효능', total: 29_750 }, { keyword: '때죽나무', total: 5_900 },
    { keyword: '조경수', total: 5_860 }, { keyword: '마가목묘목', total: 560 },
  ];
  it('마가목 — 이름 검색량은 크지만 재배 수요는 묘목 560 뿐', () => {
    expect(cultivationDemand('마가목', rows, none)).toEqual({ total: 560, top: [{ kw: '마가목묘목', vol: 560 }] });
  });
  it('다른 수종이 중심인 합성어는 그 수종 것이 아니다', () => {
    const r = [{ keyword: '사과대추묘목', total: 3_010 }, { keyword: '사과나무묘목', total: 2_200 }];
    const others = [{ name: '사과나무' }, { name: '대추나무' }];
    expect(cultivationDemand('사과나무', r, none, 6, [], others).top.map((x) => x.kw)).toEqual(['사과나무묘목']);
    expect(cultivationDemand('대추나무', r, none, 6, [], others).top.map((x) => x.kw)).toEqual(['사과대추묘목']);
  });
});

describe('ytRotation — 안 잰 수종 먼저, 그다음 오래된 순', () => {
  it('', () => {
    const snap: ExtTopicsSnap = { date: '2026-10-07', species: { a: { yt: { date: '2026-10-06', videos: [] } }, b: { yt: { date: '2026-10-01', videos: [] } } } };
    expect(ytRotation(['a', 'b', 'c'], snap, 2)).toEqual(['c', 'b']);
  });
});

describe('스냅샷 읽기 — 연관어·재배 합계·블록', () => {
  const now = Date.parse('2026-10-08T09:00:00');
  const snap: ExtTopicsSnap = { date: '2026-10-07', species: {
    블루베리: { naver: { date: '2026-10-07', total: 9_040, top: [{ kw: '블루베리묘목', vol: 4_360 }] }, yt: { date: '2026-10-07', videos: [{ title: '블루베리 전정 이렇게', views: 52_000 }] } },
    감나무: { naver: { date: '2026-10-07', total: 6_820, top: [{ kw: '태추단감묘목', vol: 2_570 }] } },
    낡은: { naver: { date: '2026-09-01', total: 99_999, top: [{ kw: '낡은묘목', vol: 99_999 }] } },
  } };
  it('각도 연관어는 네이버 재배 연관어만(영상 제목은 안 넣는다), 낡으면 빈 배열', () => {
    expect(extSuggestionsFor(snap, '블루베리', now)).toEqual(['블루베리묘목']);
    expect(extSuggestionsFor(snap, '낡은', now)).toEqual([]);
    expect(cultivationTotal(snap, '감나무', now)).toBe(6_820);
    expect(cultivationTotal(snap, '낡은', now)).toBeUndefined();
    const zero: ExtTopicsSnap = { date: '2026-10-07', species: { 설중매나무: { naver: { date: '2026-10-07', total: 0, top: [] } } } };
    expect(cultivationMeasured(zero, '설중매나무', now)).toBe(0);      // 0 으로 쟀다
    expect(cultivationTotal(zero, '설중매나무', now)).toBeUndefined(); // 사전값으로는 '모름'
    expect(cultivationMeasured(zero, '없는수종', now)).toBeUndefined();
  });
  it('블록 — 재배 수요 순, 막힌 수종·낡은 데이터 제외', () => {
    const b = extTopicsBlock(snap, [], (sp) => sp === '감나무', now);
    expect(b).toContain('블루베리(재배 검색 월 9,040): 블루베리묘목 4,360');
    expect(b).toContain('"블루베리 전정 이렇게"(5.2만회)');
    expect(b).not.toContain('감나무');
    expect(b).not.toContain('낡은');
    expect(extTopicsBlock(null)).toBe('');
  });
});
