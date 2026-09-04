import { describe, it, expect } from 'vitest';
import { rankSearchDemand, searchDemandBlock, normalizeTerm, MIN_SEARCH_COUNT } from './ytSearchDemand';

const v = (...terms: Array<[string, number]>) => ({ terms: terms.map(([keyword, count]) => ({ keyword, count })) });
const all = { isCovered: () => false, isRelevant: () => true };

describe('rankSearchDemand — 실측 검색어 순위(순수)', () => {
  it('조회 많은 순으로 준다', () => {
    const r = rankSearchDemand([v(['포도수확시기', 173], ['하스카프베리묘목', 551])], all);
    expect(r.map((x) => x.keyword)).toEqual(['하스카프베리묘목', '포도수확시기']);
  });
  it('여러 편에 걸친 같은 말은 합산한다 — 편별 성적이 아니라 그 말의 총수요를 본다', () => {
    const r = rankSearchDemand([v(['고무나무', 13]), v(['고무나무', 9])], all);
    expect(r[0]).toMatchObject({ keyword: '고무나무', count: 22 });
  });
  it('띄어쓰기만 다른 표기는 하나로 합치고, 많이 걸린 표기를 대표로 남긴다', () => {
    const r = rankSearchDemand([v(['고무나무 삽목', 20]), v(['고무나무삽목', 5])], all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ keyword: '고무나무 삽목', count: 25 });
  });
  it('잡음 하한 미만은 버린다 — 무관한 트렌드어가 1~3회씩 섞여 들어온다(실측)', () => {
    const r = rankSearchDemand([v(['감스트 리중딱', 1], ['박위 학폭', 2], ['고무나무', 20])], all);
    expect(r.map((x) => x.keyword)).toEqual(['고무나무']);
  });
  it('분야 밖 말은 거른다 — 하한을 넘겨도 우리 소재가 아니면 주제로 못 쓴다', () => {
    const r = rankSearchDemand(
      [v(['네팔홍수장면', 30], ['하스카프베리묘목', 20])],
      { ...all, isRelevant: (k) => k.includes('하스카프') },
    );
    expect(r.map((x) => x.keyword)).toEqual(['하스카프베리묘목']);
  });
  it('이미 다룬 말에 표시가 붙는다', () => {
    const r = rankSearchDemand([v(['하스카프베리묘목', 551], ['하스카프베리효능', 6])],
      { ...all, isCovered: (k) => k === '하스카프베리묘목' });
    expect(r.find((x) => x.keyword === '하스카프베리묘목')!.covered).toBe(true);
    expect(r.find((x) => x.keyword === '하스카프베리효능')!.covered).toBe(false);
  });
  it('판정 함수가 던져도 안 터진다 — 사전 고장으로 제안이 멈추면 안 된다', () => {
    const boom = (): never => { throw new Error('사전 고장'); };
    expect(rankSearchDemand([v(['고무나무', 20])], { isCovered: boom, isRelevant: () => true })[0]!.covered).toBe(true);
    expect(rankSearchDemand([v(['고무나무', 20])], { isCovered: () => false, isRelevant: boom })).toEqual([]);
  });
  it('빈 입력·불량 행은 빈 결과', () => {
    expect(rankSearchDemand([], all)).toEqual([]);
    expect(rankSearchDemand([{ terms: [] }], all)).toEqual([]);
    expect(rankSearchDemand([v(['', 50], ['정상', 0])], all)).toEqual([]);
  });
  it('상한을 지킨다', () => {
    const many = v(...Array.from({ length: 40 }, (_, i) => [`말${i}`, 100 - i] as [string, number]));
    expect(rankSearchDemand([many], { ...all, limit: 5 })).toHaveLength(5);
  });
  it('하한 상수는 3 — 실측 잡음이 1~2회로 들어온다', () => {
    expect(MIN_SEARCH_COUNT).toBe(3);
  });
});

describe('normalizeTerm', () => {
  it('띄어쓰기와 대소문자만 무시한다', () => {
    expect(normalizeTerm(' 고무나무 삽목 ')).toBe('고무나무삽목');
    expect(normalizeTerm('Haskap Berry')).toBe('haskapberry');
  });
});

describe('searchDemandBlock — 프롬프트 블록(순수)', () => {
  it('행이 없으면 빈 문자열 — 프롬프트에 빈 블록이 끼지 않는다', () => {
    expect(searchDemandBlock([])).toBe('');
  });
  it('편 없는 말을 우선 고려하라고 못박고 이름을 부른다', () => {
    const b = searchDemandBlock([
      { keyword: '하스카프베리묘목', count: 551, covered: true },
      { keyword: '하스카프베리효능', count: 6, covered: false },
    ]);
    expect(b).toContain('하스카프베리묘목 (551회) — 이미 다룬 말');
    expect(b).toContain('우선 고려하라');
    expect(b).toContain('하스카프베리효능');
  });
  it('전부 다뤘으면 인접한 말로 넓히라고 한다', () => {
    const b = searchDemandBlock([{ keyword: '고무나무', count: 20, covered: true }]);
    expect(b).toContain('인접한 말');
  });
  it('keyword 를 검색어 표기 그대로 잡으라고 못박는다', () => {
    expect(searchDemandBlock([{ keyword: '고무나무', count: 20, covered: false }]))
      .toContain('그 검색어 표기 그대로');
  });
  it('이 목록이 전부가 아니라고 밝힌다 — 생존자 편향을 막는다', () => {
    expect(searchDemandBlock([{ keyword: '고무나무', count: 20, covered: false }]))
      .toContain('여기 없는 새 소재를 막는 뜻이 아니다');
  });
});
