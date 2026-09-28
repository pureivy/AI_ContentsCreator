import { describe, it, expect } from 'vitest';
import { currentPlaceNames, obsoletePlacesIn } from './placeNames';

describe('currentPlaceNames — 1995 통합으로 사라진 시·군 이름을 현행으로', () => {
  it('구분자에 둘러싸인 옛 이름을 바꾼다 — 사장님 지적(2026-09-29)의 실제 문장', () => {
    expect(currentPlaceNames('경북 봉화·예천·상주·금릉, 경남 함양'))
      .toBe('경북 봉화·예천·상주·김천, 경남 함양');
    expect(currentPlaceNames('충남 천안·공주·온양'))
      .toBe('충남 천안·공주·아산');
  });

  it('조사가 붙어도 바꾼다 — 초안에 실제로 나간 꼴', () => {
    expect(currentPlaceNames('충남은 천안·공주·온양에 이어집니다.'))
      .toBe('충남은 천안·공주·아산에 이어집니다.');
    expect(currentPlaceNames('금릉이 주산지다')).toBe('김천이 주산지다');
  });

  it('시·군이 붙은 꼴도 현행 시로', () => {
    expect(currentPlaceNames('경북 금릉군')).toBe('경북 김천시');
    expect(currentPlaceNames('충남 온양시')).toBe('충남 아산시');
    expect(currentPlaceNames('충남 대천시 일대')).toBe('충남 보령시 일대');
  });

  it('현행 지명은 건드리지 않는다 — 파주 금릉역·온양온천은 지금도 쓰는 이름이다', () => {
    expect(currentPlaceNames('경의중앙선 금릉역에서 도보 10분')).toBe('경의중앙선 금릉역에서 도보 10분');
    expect(currentPlaceNames('온양온천 근처')).toBe('온양온천 근처');
    expect(currentPlaceNames('금릉동 주민센터')).toBe('금릉동 주민센터');
  });

  it("충돌이 큰 낱말은 '시' 가 붙은 꼴만 바꾼다 — '이리 와'·'충무공' 을 망치면 안 된다", () => {
    expect(currentPlaceNames('이리 와서 보세요')).toBe('이리 와서 보세요');
    expect(currentPlaceNames('충무공 이순신')).toBe('충무공 이순신');
    expect(currentPlaceNames('전북 이리시')).toBe('전북 익산시');
    expect(currentPlaceNames('경남 충무시')).toBe('경남 통영시');
  });

  it('바꿀 것이 없으면 원문 그대로(참조 동일)', () => {
    const s = '충북 영동·보은, 경남 함양';
    expect(currentPlaceNames(s)).toBe(s);
    expect(currentPlaceNames('')).toBe('');
  });
});

describe('obsoletePlacesIn — 무엇을 바꿨는지 로그로 남긴다', () => {
  it('바뀐 쌍을 돌려준다', () => {
    expect(obsoletePlacesIn('경북 상주·금릉, 충남 온양')).toEqual([
      { from: '금릉', to: '김천' },
      { from: '온양', to: '아산' },
    ]);
  });
  it('현행 지명만 있으면 빈 목록 — 금릉역은 바꾼 게 아니다', () => {
    expect(obsoletePlacesIn('금릉역 앞')).toEqual([]);
  });
});
