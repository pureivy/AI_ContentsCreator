import { describe, it, expect } from 'vitest';
import { seriesStems, seriesCooldownHit } from './seriesCooldown';

const NOW = new Date('2026-08-24T12:00:00Z').getTime();
const d = (iso: string): string => iso;

describe('seriesStems — 계열 어간 추출(순수)', () => {
  it("'XX나무' 어간을 뽑고 공백을 무시한다(포도나무→포도, 블루베리 나무→블루베리)", () => {
    expect(seriesStems('포도나무 가지치기, 제한 가지')).toEqual(['포도']);
    expect(seriesStems('블루베리 나무 키우기 베란다')).toEqual(['블루베리']);
  });
  it('총칭 어간(과실·유실·조경 등)과 단독 나무는 계열이 아니다', () => {
    expect(seriesStems('과실나무 전정, 어린 나무 주지')).toEqual([]);
    expect(seriesStems('나무 물주기')).toEqual([]);
  });
});

describe('seriesCooldownHit — 7일 내 같은 계열 2편+ 기각(2026-08-24 포도 실사고)', () => {
  const recent = [
    { text: '포도나무재배법, 처서 전 순 정리', createdTs: d('2026-08-21T00:00:00Z') },
    { text: '포도나무 가지 정리, 9월에 해도 되는 것', createdTs: d('2026-08-23T00:00:00Z') },
    { text: '무화과나무 월동, 팔월에 정하기', createdTs: d('2026-08-22T00:00:00Z') },
  ];
  it("포도 2편 이후 '포도나무 가지치기' 후보는 기각된다(나무 접미 없는 '포도 수확'도 걸린다)", () => {
    expect(seriesCooldownHit('포도나무 가지치기 순서', recent, { now: NOW })).toBe('포도');
    expect(seriesCooldownHit('포도 수확 후 저장법', recent, { now: NOW })).toBe('포도');
  });
  it('다른 계열(무화과 1편)·무관 주제는 통과한다', () => {
    expect(seriesCooldownHit('무화과나무 삽목 시기', recent, { now: NOW })).toBeNull();
    expect(seriesCooldownHit('배롱나무 개화 관리', recent, { now: NOW })).toBeNull();
  });
  it('창(7일)을 벗어난 편은 세지 않는다 — 시간이 지나면 자연 해제', () => {
    const old = recent.map((r) => ({ ...r, createdTs: d('2026-08-10T00:00:00Z') }));
    expect(seriesCooldownHit('포도나무 가지치기', old, { now: NOW })).toBeNull();
  });
});
