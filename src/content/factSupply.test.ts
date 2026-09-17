import { describe, it, expect } from 'vitest';
import { factSubjectOf, factQueriesFor, isSpecificFact, attachRefs, factSupplyBlock, FACT_SUPPLY_HEADER, collectSearchResults, supplyFacts, shouldHoldForFacts } from './factSupply';
import type { SearchHit, FactSupplyResult, FactSupplyDeps } from './factSupply';

describe('shouldHoldForFacts — 사실 부족 보류 대상(최종 리뷰 C1)', () => {
  it('자율 런 + 자율 생성 조각 → 보류 대상', () => {
    expect(shouldHoldForFacts({ auto: true }, { auto: true })).toBe(true);
  });
  it('사용자가 등록한 아이디어(auto 없음)를 자율 틱이 재개해도 사용자 주제 — 보류 안 함', () => {
    expect(shouldHoldForFacts({ auto: true }, {})).toBe(false);
  });
  it('수동 틱 버튼 조각(userTriggered) — 보류 안 함', () => {
    expect(shouldHoldForFacts({ auto: true }, { auto: true, userTriggered: true })).toBe(false);
  });
  it('자율 런이 아니면 — 보류 안 함', () => {
    expect(shouldHoldForFacts({}, { auto: true })).toBe(false);
    expect(shouldHoldForFacts({ auto: false }, { auto: true })).toBe(false);
  });
  it('리비전·리서치 런 — 보류 안 함', () => {
    expect(shouldHoldForFacts({ auto: true, revise: { baseBody: 'b', feedback: 'f' } }, { auto: true })).toBe(false);
    expect(shouldHoldForFacts({ auto: true, mission: 'research' }, { auto: true })).toBe(false);
  });
  it('조각 없는 자율 런(컴포저 주제 없음) — 자율 선정 그대로 보류 대상', () => {
    expect(shouldHoldForFacts({ auto: true }, undefined)).toBe(true);
  });
});

describe('factSubjectOf — 사실 수집 대상', () => {
  it('수종이 잡히면 수종명이 대상', () => {
    expect(factSubjectOf('음나무가 잘 자라는 지역, 중부·남부 다르게 심는 법', '음나무')).toEqual({ subject: '음나무', species: '음나무' });
    expect(factSubjectOf('엄나무 묘목, 뿌리목부터 확인하세요')).toEqual({ subject: '음나무', species: '음나무' }); // 별칭
  });
  it('수종이 없으면 keyword(3어절 이하) → 없으면 제목 첫 어절', () => {
    expect(factSubjectOf('나무 상처 치료제, 바르면 안 되는 5가지 자리', '나무 상처 치료제')).toEqual({ subject: '나무 상처 치료제' });
    expect(factSubjectOf('상토 배양토 차이, 구덩이로 포대 수 계산', '상토 배양토 차이 구덩이 포대')).toEqual({ subject: '상토' });
    expect(factSubjectOf('상토 배양토 차이')).toEqual({ subject: '상토' });
  });
});

describe('factQueriesFor — 결정적 질의', () => {
  it('수종이면 재배 5 + 이야기 3 = 8개', () => {
    const q = factQueriesFor('음나무', '음나무');
    expect(q).toHaveLength(8);
    expect(q).toContain('음나무 재배');
    expect(q).toContain('음나무 전설 설화 유래');
    expect(q).toContain('음나무 꽃말 상징');
  });
  it('수종이 없으면 재배·특성·주의 3개만', () => {
    expect(factQueriesFor('상토')).toEqual(['상토 재배', '상토 특성 자생지', '상토 주의 문제']);
  });
});

describe('isSpecificFact — 수종 고유 판정', () => {
  it('수종이 있으면 텍스트나 출처 제목에 수종명·별칭이 있어야 고유', () => {
    expect(isSpecificFact('음나무는 두릅나무과 낙엽교목이다', '두산백과', '음나무', true)).toBe(true);
    expect(isSpecificFact('어린 순을 개두릅이라 하여 먹는다', '엄나무 - 두산백과', '음나무', true, ['엄나무'])).toBe(true);
    expect(isSpecificFact('물 빠짐이 좋은 흙을 좋아한다', '나무 심기 요령', '음나무', true)).toBe(false); // LLM 이 true 라 해도 수종명 없음
  });
  it('수종이 없는 주제는 LLM 태그를 따른다', () => {
    expect(isSpecificFact('상토는 펄라이트·피트모스가 섞인 인공 배양토다', '상토 - 두산백과', undefined, true)).toBe(true);
    expect(isSpecificFact('흙은 배수가 중요하다', '원예 기초', undefined, false)).toBe(false);
  });
});

describe('attachRefs — ref 검증·URL 부착', () => {
  const hits: SearchHit[] = [
    { title: '음나무 - 두산백과', url: 'https://terms.naver.com/1', snippet: '...' },
    { title: '엄나무 재배법', url: 'https://example.com/a', snippet: '...' },
  ];
  it('유효한 ref 만 남기고 URL·출처명을 붙인다, 범위 밖·없음은 버린다', () => {
    const raw = { facts: [
      { text: '음나무는 전국 산지에 자생한다', ref: 1, kind: 'cultivation', specific: true },
      { text: '음나무 새순은 개두릅이라 부른다', ref: 2, kind: 'lore', specific: true },
      { text: '지어낸 사실', ref: 9, kind: 'lore', specific: true },
      { text: 'ref 없음', kind: 'lore', specific: true },
    ] };
    const out = attachRefs(raw, hits, '음나무');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ text: '음나무는 전국 산지에 자생한다', kind: 'cultivation', source: '음나무 - 두산백과', url: 'https://terms.naver.com/1', specific: true });
    expect(out[1]!.url).toBe('https://example.com/a');
  });
  it('kind 가 이상하면 cultivation, specific 은 isSpecificFact 로 재판정, 같은 문장은 1번만', () => {
    const raw = { facts: [
      { text: '물 빠짐이 좋아야 한다', ref: 2, kind: 'weird', specific: true },
      { text: '물 빠짐이 좋아야 한다', ref: 2, kind: 'lore', specific: true },
    ] };
    const out = attachRefs(raw, hits, '음나무');
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('cultivation');
    expect(out[0]!.specific).toBe(false);
  });
  it('형식이 아니면 빈 배열', () => {
    expect(attachRefs(null, hits)).toEqual([]);
    expect(attachRefs({ facts: 'x' }, hits)).toEqual([]);
  });
});

describe('factSupplyBlock — 브리프에 붙는 블록', () => {
  it('[재배]/[이야기] 접두와 (근거: 출처, URL) 꼴, 고유 사실만', () => {
    const r: FactSupplyResult = {
      status: 'ok', subject: '음나무', species: '음나무', queries: [], resultCount: 3, specificCount: 2, checkedTs: 't',
      facts: [
        { text: '음나무는 전국 산지에 자생한다', kind: 'cultivation', source: '두산백과', url: 'https://t/1', specific: true },
        { text: '음나무 가시로 잡귀를 막는다는 풍습이 있다', kind: 'lore', source: '한국민속대백과', url: 'https://t/2', specific: true },
        { text: '물 빠짐이 좋아야 한다', kind: 'cultivation', source: 'x', url: 'https://t/3', specific: false },
      ],
    };
    const b = factSupplyBlock(r);
    expect(b.startsWith(FACT_SUPPLY_HEADER)).toBe(true);
    expect(b).toContain('- [재배] 음나무는 전국 산지에 자생한다 (근거: 두산백과, https://t/1)');
    expect(b).toContain('- [이야기] 음나무 가시로 잡귀를 막는다는 풍습이 있다 (근거: 한국민속대백과, https://t/2)');
    expect(b).not.toContain('물 빠짐');
  });
  it('고유 사실이 0이면 빈 문자열', () => {
    expect(factSupplyBlock({ status: 'ok', subject: 'x', queries: [], resultCount: 0, facts: [], specificCount: 0, checkedTs: 't' })).toBe('');
  });
});

describe('collectSearchResults / supplyFacts — 수집·추출(의존성 주입)', () => {
  const deps = (overrides: Partial<FactSupplyDeps> = {}): FactSupplyDeps => ({
    encyc: async (q) => (q.includes('재배') ? [{ title: '음나무 - 두산백과', link: 'https://terms/1', description: '전국 산지 자생' }] : []),
    web: async (q) => (q.includes('전설') ? [{ title: '음나무 민속', url: 'https://web/1', snippet: '가시로 잡귀를 막는다' }, { title: '음나무 - 두산백과', url: 'https://terms/1', snippet: '중복' }] : []),
    llm: async () => ({ facts: [
      { text: '음나무는 전국 산지에 자생한다', ref: 1, kind: 'cultivation', specific: true },
      { text: '음나무 가시로 잡귀를 막는다는 풍습이 있다', ref: 2, kind: 'lore', specific: true },
    ] }),
    ...overrides,
  });
  it('질의마다 백과+웹을 모으고 URL 로 중복 제거, 번호는 1부터', async () => {
    const hits = await collectSearchResults(['음나무 재배', '음나무 전설 설화 유래'], deps());
    expect(hits.map((h) => h.url)).toEqual(['https://terms/1', 'https://web/1']);
  });
  it('supplyFacts — ok 상태와 고유 사실 수', async () => {
    const r = await supplyFacts({ topic: '음나무가 잘 자라는 자리', model: 'm' }, deps());
    expect(r.status).toBe('ok');
    expect(r.species).toBe('음나무');
    expect(r.queries).toHaveLength(8);
    expect(r.resultCount).toBe(2);
    expect(r.specificCount).toBe(2);
    expect(r.facts[1]!.url).toBe('https://web/1');
  });
  it('검색 결과가 0이면 error(커넥터 장애로 본다, fail-open)·LLM 호출 안 함', async () => {
    let called = 0;
    const r = await supplyFacts({ topic: '음나무 자리', model: 'm' }, deps({ encyc: async () => [], web: async () => [], llm: async () => { called++; return null; } }));
    expect(r.status).toBe('error');
    expect(r.error).toBe('no results');
    expect(r.specificCount).toBe(0);
    expect(called).toBe(0);
  });
  it('cap 에 닿으면 남은 질의는 부르지 않는다', async () => {
    const asked: string[] = [];
    const many = (q: string) => Array.from({ length: 5 }, (_, i) => ({ title: `${q} ${i}`, url: `https://x/${q}/${i}`, snippet: 's' }));
    const hits = await collectSearchResults(['q1', 'q2', 'q3'], deps({
      encyc: async () => [],
      web: async (q) => { asked.push(q); return many(q); },
    }), undefined, 5);
    expect(hits).toHaveLength(5);
    expect(asked).toEqual(['q1']);
  });
  it('LLM 이 null 을 주면 error (보류 사유가 아니다)', async () => {
    const r = await supplyFacts({ topic: '음나무 자리', model: 'm' }, deps({ llm: async () => null }));
    expect(r.status).toBe('error');
    expect(r.facts).toEqual([]);
  });
  it('커넥터 하나가 던져도 다른 쪽이 결과를 주면 ok — 예외는 밖으로 안 나간다', async () => {
    const r = await supplyFacts({ topic: '음나무 자리', model: 'm' }, deps({ encyc: async () => { throw new Error('boom'); } }));
    expect(r.status).toBe('ok');
    expect(r.resultCount).toBe(2);   // 백과가 죽어 web 의 전설 질의 결과 2건만(terms/1 도 웹 쪽에서 들어온다)
  });
  it('양쪽 커넥터가 모든 질의에 []를 주면 error — 커넥터 전멸을 사실 부족으로 오인하지 않는다', async () => {
    const r = await supplyFacts({ topic: '음나무 자리', model: 'm' }, deps({ encyc: async () => [], web: async () => [] }));
    expect(r.status).toBe('error');
    expect(r.error).toBe('no results');
  });
});
