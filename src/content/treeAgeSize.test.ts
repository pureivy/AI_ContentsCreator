import { describe, it, expect } from 'vitest';
import { parseTreeAge, treeGroup, ageRows, ageSizePrompt, ageSizeCheck, ageSizeTable } from './treeAgeSize';

const kaki = { name: '감나무', latin: 'Diospyros kaki', type: '활엽 교목' };
const magnolia = { name: '백목련', latin: 'Magnolia denudata', type: '낙엽 활엽 교목' };

describe('parseTreeAge', () => {
  it('숫자 나이', () => {
    expect(parseTreeAge('2~3년생 감나무')).toEqual({ lo: 2, hi: 3 });
    expect(parseTreeAge('심은 지 일 년 된 나무')).toEqual({ lo: 1, hi: 1 });
    expect(parseTreeAge('20년 전에 심은 목련')).toEqual({ lo: 20, hi: 20 });
    expect(parseTreeAge('20년 지킨 나무')).toEqual({ lo: 20, hi: 20 });
    expect(parseTreeAge('a 2-3 year old sapling')).toEqual({ lo: 2, hi: 3 });
  });
  it('말로만 된 단계', () => {
    expect(parseTreeAge('어린 감나무 줄기')).toEqual({ lo: 1, hi: 3 });
    expect(parseTreeAge('성목 수형')).toEqual({ lo: 10, hi: 40 });
    expect(parseTreeAge('지주와 끈')).toBeNull();
  });
});

describe('treeGroup', () => {
  it('무리', () => {
    expect(treeGroup(kaki)).toBe('fruit');
    expect(treeGroup(magnolia)).toBe('landscape');
    expect(treeGroup({ name: '블루베리', latin: 'Vaccinium corymbosum', type: '낙엽 관목' })).toBe('shrub');
    expect(treeGroup({ name: '으름', latin: 'Akebia quinata', type: '활엽 덩굴' })).toBe('vine');
  });
});

describe('기준 줄', () => {
  it('묘목은 1년생·2~3년생 두 줄', () => {
    expect(ageRows('fruit', { lo: 1, hi: 3 }).map((r) => r.label)).toEqual(['1년생 접목묘', '2~3년생']);
  });
  it('20년 목련은 허벅지 굵기·몸통보다 가늘게', () => {
    expect(ageSizeCheck('20년 전에 심은 목련', magnolia)).toContain('18~28cm');
    expect(ageSizePrompt('20 year old magnolia', magnolia)).toContain('narrower than a person');
  });
  it('2~3년생 감나무 그림 지시', () => {
    const p = ageSizePrompt('2-3 year old leafless persimmon sapling', kaki);
    expect(p).toContain('2-4 cm');
    expect(p).not.toContain('1-1.5 cm');
  });
  it('나이 말이 없으면 빈 줄, 사전 size 는 우선 표시', () => {
    expect(ageSizePrompt('wooden stake and twine', kaki)).toBe('');
    expect(ageSizeTable({ ...kaki, size: '성목 5m' })).toContain('이 수종 자료(우선): 성목 5m');
  });
});

describe('비례 기준', () => {
  it('그림 지시는 주변 물건 비례와 비교 물건 규칙을 싣는다', () => {
    const p = ageSizePrompt('2~3년생 감나무', { name: '감나무', latin: 'Diospyros kaki', type: '활엽 교목' });
    expect(p).toContain("adult's thumb or a broom handle");
    expect(p).toContain('garden fence');
    expect(p).toContain('Do not add props just for scale');
    expect(p).toContain('Do not add stakes or ties unless');
  });
});
