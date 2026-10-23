import { describe, expect, it, vi } from 'vitest';
import { COHERE_ANCHORS, coherenceLlm, evaluateTopics, fmtViews, rankPieces, selectCoherentTopic, selectTopic, shortViewsOf, titleSimilarity, TOPIC_COOLDOWN_DAYS, type TopicDeps } from './topic';

const NOW = new Date('2026-10-26T00:00:00+09:00');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const CATALOG = [{ group: '과실', species: [{ name: '감나무' }, { name: '사과나무' }, { name: '배나무' }, { name: '자두나무' }, { name: '매실나무' }, { name: '블루베리' }] }];

type P = ReturnType<TopicDeps['pieces']>[number];
const piece = (id: string, title: string, extra: Partial<P> = {}): P => ({ id, title, runId: `run_${id}`, brand: 'b', publishedUrl: `https://n/${id}`, ...extra });

function deps(over: Partial<TopicDeps> = {}): TopicDeps {
  const pieces: P[] = [
    piece('p1', '감나무 가지치기, 잎이 진 뒤에'),
    piece('p2', '사과나무 묘목 심는 깊이'),
    piece('p3', '배나무 묘목 심을 자리'),
    piece('p4', '자두나무 묘목 고르는 법'),
    piece('p5', '매실나무 묘목 옮겨심기'),
    piece('p6', '블루베리 묘목 심기 전 흙'),
    piece('p7', '감나무 묘목 심는 시기'),
    piece('px', '다른 브랜드 감나무 묘목', { brand: 'other' }),
    piece('pu', '미발행 감나무 묘목', { publishedUrl: undefined }),
  ];
  const views: Record<string, number> = { p1: 900, p2: 500, p3: 400, p4: 300, p5: 200, p6: 100, p7: 50, px: 99999, pu: 99999 };
  return {
    pieces: () => pieces,
    shorts: () => [{ id: 's1', sourcePieceId: 'p2', brand: 'b' }, { id: 's2', sourcePieceId: 'p2', brand: 'b' }, { id: 's3', sourcePieceId: 'p3', brand: 'other' }],
    blogViews: (id) => views[id] ?? 0,
    shortViews: (id) => ({ s1: 1000, s2: 500, s3: 7777 } as Record<string, number>)[id] ?? 0,
    records: () => [],
    hasBody: () => true,
    brand: 'b', catalog: CATALOG, seasonalSubjects: [], seasonOf: () => undefined, minSeason: 0.25, now: NOW,
    ...over,
  };
}

describe('rankPieces — 블로그 + 파생 숏폼 조회 합산', () => {
  it('이 브랜드 발행 글만, 같은 브랜드 숏폼만 더한다', () => {
    const r = rankPieces(deps());
    expect(r.map((p) => p.id)).toEqual(['p2', 'p1', 'p3', 'p4', 'p5', 'p6', 'p7']);
    expect(r[0]).toMatchObject({ blogViews: 500, shortsViews: 1500, views: 2000, topic: 'plant', species: '사과나무' });
    expect(r.find((p) => p.id === 'p3')!.shortsViews).toBe(0);
  });
  it('shortViewsOf — 유튜브는 api 표본 우선(애널리틱스와 겹쳐 세지 않음) + 인스타·페북·클립', () => {
    const s: Record<string, number> = { 'youtube:api': 100, 'youtube:': 999, 'meta:ig': 20, 'meta:fb': 3, 'naver:clip': 4 };
    expect(shortViewsOf('x', (_id, p) => (p in s ? { views: s[p] } : null))).toBe(127);
    expect(shortViewsOf('x', (_id, p) => (p === 'youtube:' ? { views: 50 } : null))).toBe(50);
  });
});

describe('selectTopic', () => {
  it('조회 1위 글을 중심으로 같은 주제 글 3~5편을 엮고, 이유에 숫자를 쓴다', () => {
    const t = selectTopic(deps())!;
    expect(t.topicKey).toBe('plant:사과나무');
    expect(t.anchor.id).toBe('p2');
    expect(t.pieces.map((p) => p.id)).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p7']); // 가지치기 글 p1 은 다른 주제
    expect(t.reason).toContain("조회 합산 1위 '사과나무 묘목 심는 깊이'(블로그 500+숏폼 1,500)");
    expect(t.reason).toContain('글 6편');
    expect(t.reason).toContain('지난 롱폼과 겹치지 않음');
  });
  it('이미 롱폼 원문으로 쓴 글·같은 topicKey 는 기둥이 못 된다', () => {
    const t = selectTopic(deps({ records: () => [{ dir: 'd', createdTs: ago(60), topicKey: 'plant:사과나무', sourcePieceIds: ['p3'], title: 'x', stage: 'ready' }] }))!;
    expect(t.anchor.id).toBe('p4'); // p2 = 같은 키, p3 = 쓴 글, p1 = 관련 글 부족(가지치기 1편)
    expect(t.pieces.map((p) => p.id)).not.toContain('p3');
    expect(t.reason).toContain('건너뜀');
  });
  it(`같은 작업 주제를 ${TOPIC_COOLDOWN_DAYS}일 안에 만들었으면 건너뛴다 — 시범 레코드(키 없음)는 제목으로 분류`, () => {
    const all = evaluateTopics(deps({ records: () => [{ dir: 'x', createdTs: ago(3), title: '감나무 묘목 심기 총정리', stage: 'ready' }] }));
    expect(all.find((c) => c.piece.id === 'p2')!.why).toContain('최근');
    expect(all.every((c) => !c.ok || c.piece.topic !== 'plant')).toBe(true);
  });
  it('실패한 편(error)은 주제를 쓰지 않은 것', () => {
    const t = selectTopic(deps({ records: () => [{ dir: 'x', createdTs: ago(1), topicKey: 'plant:사과나무', sourcePieceIds: ['p2'], title: 'x', stage: 'error' }] }))!;
    expect(t.anchor.id).toBe('p2');
  });
  it('제철 아님(수종 시즌 지수 낮음)·본문 없음은 빠진다, 모르면 통과', () => {
    const t = selectTopic(deps({ seasonOf: (sp) => (sp === '사과나무' ? 0.1 : undefined), hasBody: (runId) => runId !== 'run_p3' }))!;
    expect(t.anchor.id).toBe('p4');
    expect(t.pieces.map((p) => p.id)).not.toContain('p3');
    const why = evaluateTopics(deps({ seasonOf: (sp) => (sp === '사과나무' ? 0.1 : undefined) })).find((c) => c.piece.id === 'p2')!.why;
    expect(why).toContain('제철 아님');
  });
  it('시기 소재가 제철 밖이면 빠진다(brand seasonalSubjects)', () => {
    const all = evaluateTopics(deps({ seasonalSubjects: [{ term: '옮겨심기', months: [3, 4] }] }));
    expect(all.find((c) => c.piece.id === 'p5')!.why).toContain("'옮겨심기'");
  });
  it('관련 글이 3편 미만이면 그 기둥은 못 쓰고, 아무것도 없으면 null', () => {
    const few = deps({ pieces: () => [piece('a', '사과나무 묘목 심기'), piece('b', '배나무 묘목 심기')] });
    expect(selectTopic(few)).toBeNull();
  });
  it('수동 지정(pieceIds) — 첫 글이 중심', () => {
    const t = selectTopic(deps(), ['p1', 'p2'])!;
    expect(t.anchor.id).toBe('p1');
    expect(t.topicKey).toBe('prune:감나무');
    expect(t.reason).toContain('사람이 고른 글 2편');
  });
});

describe('보조', () => {
  it('fmtViews', () => {
    expect(fmtViews(12345)).toBe('1.2만');
    expect(fmtViews(980)).toBe('980');
  });
  it('titleSimilarity — 거의 같은 제목은 높다', () => {
    expect(titleSimilarity('감나무 묘목 심는 시기', '감나무 묘목 심는 시기는')).toBeGreaterThan(0.8);
    expect(titleSimilarity('감나무 묘목', '블루베리 흙')).toBeLessThan(0.2);
  });
});

describe('selectCoherentTopic — LLM 묶음 일관성(가짜 LLM)', () => {
  const pieces: P[] = [
    piece('a1', '감나무 묘목 심기 전 확인할 것'),
    piece('a2', '하스카프베리 묘목 라벨 확인'),
    piece('a3', '무화과 묘목 겨울 기온과 심을 자리'),
    piece('a4', '감나무 묘목 품종과 접목 부위'),
    piece('a5', '사과나무 묘목 도착 후 심기 전 보관'),
    piece('a6', '배나무 묘목 심는 깊이'),
    piece('a7', '감나무 깍지벌레 잎이 진 뒤'), // 같은 수종 다른 작업 — 풀에 들어간다
  ];
  const views: Record<string, number> = { a1: 900, a2: 800, a3: 700, a4: 600, a5: 500, a6: 400, a7: 300 };
  const d = () => deps({ pieces: () => pieces, blogViews: (id) => views[id] ?? 0, shorts: () => [] });

  it('기둥 + LLM 이 고른 3~5편(풀 안의 id 만), 이유에 묶음 주제', async () => {
    const llm = vi.fn(async (o: { anchor: { id: string }; candidates: Array<{ id: string }> }) => ({ theme: '감나무 묘목, 심기 전 사흘', pieceIds: ['a4', 'a5', 'a6', 'zz', 'a4'], why: '도착부터 심기까지 한 흐름' }));
    const t = (await selectCoherentTopic(d(), llm))!;
    expect(llm).toHaveBeenCalledTimes(1);
    const cands = llm.mock.calls[0]![0].candidates.map((c) => c.id);
    expect(cands).toContain('a7');
    expect(cands).not.toContain('a1');
    expect(t.anchor.id).toBe('a1');
    expect(t.pieces.map((p) => p.id)).toEqual(['a1', 'a4', 'a5', 'a6']);
    expect(t.theme).toBe('감나무 묘목, 심기 전 사흘');
    expect(t.reason).toContain("묶음 주제 '감나무 묘목, 심기 전 사흘': 도착부터 심기까지 한 흐름");
  });

  it('한 질문으로 3편 미만이면 다음 기둥, 최대 3개 기둥까지만 묻고 없으면 null', async () => {
    const llm = vi.fn(async () => ({ theme: '따로 노는 묶음', pieceIds: ['a2'], why: '' }));
    expect(await selectCoherentTopic(d(), llm)).toBeNull();
    expect(llm).toHaveBeenCalledTimes(COHERE_ANCHORS);
    const second = vi.fn(async (o: { anchor: { id: string } }) => (o.anchor.id === 'a1' ? null : { theme: '묘목 고르기', pieceIds: ['a4', 'a5', 'a6'], why: 'w' }));
    const t = (await selectCoherentTopic(d(), second))!;
    expect(t.anchor.id).toBe('a2');
    expect(t.reason).toContain("한 이야기로 안 묶여 넘긴 기둥: '감나무 묘목 심기 전 확인할 것'(0편)");
  });

  it('coherenceLlm — 표준 모델 한 번, 응답 정리', async () => {
    const raw = vi.fn(async () => ({ theme: ' 감나무 묘목 ', pieceIds: ['a4', 3, 'a5'], why: 'w' }));
    const pick = await coherenceLlm(raw as never, 'std-model')({ anchor: rankPieces(d())[0]!, candidates: rankPieces(d()).slice(1, 4) });
    expect(pick).toEqual({ theme: '감나무 묘목', pieceIds: ['a4', 'a5'], why: 'w' });
    expect((raw.mock.calls[0] as unknown[])[0]).toBe('std-model');
    expect(String((raw.mock.calls[0] as unknown[])[2])).toContain('a2 | 하스카프베리 묘목 라벨 확인');
  });
});
