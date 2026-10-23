import { describe, expect, it, vi } from 'vitest';
import { COHERE_ANCHORS, coherenceLlm, coherencePrompt, evaluateTopics, fmtViews, plantMonths, rankPieces, SALES_MULT, SALES_SEASON_MULT, SEASON_MULT, seasonMonthsOf, seasonPhase, selectCoherentTopic, selectTopic, SHORT_TARGET_MINUTES, shortViewsOf, titleSimilarity, TOPIC_COOLDOWN_DAYS, v2Score, V2_MIN_DAYS, type TopicDeps } from './topic';

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

describe('v2 점수(2026-10-23) — 블로그 하루 조회 × 제철 앞당김 × 판매', () => {
  const SUBJ = [{ term: '월동', months: [11, 12, 1, 2] }, { term: '봄 식재', months: [2, 3, 4] }, { term: '가을 식재', months: [9, 10, 11] }];
  const base = { title: '감나무 거름 주기', topic: 'care', species: '감나무', blogViews: 70 };
  const ctx = { seasonalSubjects: [] as typeof SUBJ, now: NOW };

  it(`하루 조회 — 경과일 하한 ${V2_MIN_DAYS}일(갓 발행 글이 튀지 않게), 잰 때가 있으면 그때까지`, () => {
    expect(v2Score({ ...base, publishedTs: ago(2) }, ctx).perDay).toBe(10); // 70 / 7
    expect(v2Score({ ...base, publishedTs: ago(70) }, ctx).perDay).toBeCloseTo(1);
    expect(v2Score({ ...base, publishedTs: ago(70), measuredAt: ago(35) }, ctx).perDay).toBeCloseTo(2);
    expect(v2Score(base, ctx).ageDays).toBe(30); // 발행일 모름 → 30일로 본다
  });

  it('작업 철 — 제목(시기 소재·N월·계절) 먼저, 없으면 작업 달력, 모르면 null', () => {
    expect(seasonMonthsOf('감나무 가지치기, 잎이 진 뒤에', 'prune', SUBJ)).toEqual({ months: [12, 1, 2], what: '전정' });
    expect(seasonMonthsOf('배롱나무 겨울전정', 'prune', SUBJ)).toEqual({ months: [12, 1, 2], what: '겨울 전정' });
    expect(seasonMonthsOf('블루베리 전정, 9월엔 새 줄기만', 'prune', SUBJ)).toEqual({ months: [9], what: '9월 전정' });
    expect(seasonMonthsOf('무화과 월동 준비', 'care', SUBJ)!.what).toBe('월동');
    expect(seasonMonthsOf('사과나무 묘목 심는 깊이', 'plant', SUBJ)).toEqual({ months: [2, 3, 4, 9, 10, 11], what: '심기' });
    expect(seasonMonthsOf('감나무 품종, 겨울 전에 꼭 볼 것', 'plant', SUBJ)!.what).toBe('심기'); // '겨울 전에' = 지금
    expect(seasonMonthsOf('참나무 구별법', 'lore', SUBJ)).toBeNull();
    expect(plantMonths(SUBJ)).toEqual([2, 3, 4, 9, 10, 11]);
  });

  it('철 단계 — 이번 달 in, 다음 철 첫날까지 14~42일 lead, 14일 미만 soon, 그 너머 none', () => {
    expect(seasonPhase([12, 1, 2], NOW)).toEqual({ phase: 'lead', days: 36 });
    expect(seasonPhase([11], NOW).phase).toBe('soon');
    expect(seasonPhase([10, 11], NOW).phase).toBe('in');
    expect(seasonPhase([3, 4], NOW).phase).toBe('none');
  });

  it('제철 가점 — 겨울 전정은 5주 뒤 lead, 지금 철은 살짝, 달을 모르면 수종 검색 시즌이 높을 때만 살짝, 아니면 중립', () => {
    const lead = v2Score({ ...base, title: '감나무 가지치기', topic: 'prune', publishedTs: ago(70) }, ctx);
    expect(lead.season).toEqual({ phase: 'lead', mult: SEASON_MULT.lead, label: '5주 뒤 전정 철' });
    expect(lead.score).toBeCloseTo(SEASON_MULT.lead);
    expect(v2Score({ ...base, title: '감나무 10월 거름', publishedTs: ago(70) }, ctx).season.mult).toBe(SEASON_MULT.in);
    expect(v2Score({ ...base, topic: 'lore', title: '감나무 이야기' }, { ...ctx, seasonOf: () => 0.9 }).season).toMatchObject({ phase: 'in', label: '감나무 검색 철' });
    expect(v2Score({ ...base, topic: 'lore', title: '감나무 이야기' }, { ...ctx, seasonOf: () => 0.3 }).season.mult).toBe(1);
  });

  it('판매 수종 가점 — 품종표 수종만, 심기(구매) 철이 지금·곧이면 더 크게, 표 밖은 중립', () => {
    const sales = new Set(['감나무']);
    expect(v2Score(base, { ...ctx, sales, seasonalSubjects: SUBJ }).sales).toEqual({ mult: SALES_SEASON_MULT, label: '판매 수종·심기 철' });
    expect(v2Score(base, { ...ctx, sales, seasonalSubjects: [{ term: '봄 식재', months: [3, 4] }] }).sales).toEqual({ mult: SALES_MULT, label: '판매 수종' });
    expect(v2Score({ ...base, species: '모과나무' }, { ...ctx, sales, seasonalSubjects: SUBJ }).sales.mult).toBe(1);
  });

  // 블로그 누적은 큰데 오래된 글(p1) vs 누적은 작아도 최근에 하루 조회가 큰 글(p2) — 숏폼은 p1 이 훨씬 크다.
  const v2deps = (over: Partial<TopicDeps> = {}) => deps({
    mode: 'v2',
    pieces: () => [
      piece('p1', '사과나무 묘목 심는 깊이', { publishedTs: ago(100) }),
      piece('p2', '배나무 묘목 심을 자리', { publishedTs: ago(10) }),
      piece('p3', '자두나무 묘목 고르는 법', { publishedTs: ago(10) }),
      piece('p4', '매실나무 묘목 옮겨심기', { publishedTs: ago(10) }),
    ],
    blogViews: (id) => ({ p1: 500, p2: 200, p3: 100, p4: 100 } as Record<string, number>)[id] ?? 0,
    shorts: () => [{ id: 's1', sourcePieceId: 'p1', brand: 'b' }, { id: 's4', sourcePieceId: 'p4', brand: 'b' }],
    shortViews: (id) => ({ s1: 50_000, s4: 900 } as Record<string, number>)[id] ?? 0,
    ...over,
  });

  it('순위 — 하루 조회가 이긴다(숏폼 5만은 무시), 숏폼은 같은 점수일 때만 순서를 정한다', () => {
    expect(rankPieces(deps()).map((p) => p.id)[0]).toBe('p2'); // views 모드(종전)는 그대로
    const r = rankPieces(v2deps());
    expect(r.map((p) => p.id)).toEqual(['p2', 'p4', 'p3', 'p1']); // p3·p4 같은 점수 → 숏폼 많은 p4 먼저
    expect(r[0]!.v2!.perDay).toBe(20);
  });

  it('깊이 — v2 는 기둥 포함 3편이면 10분 편, 이유에 점수 근거', () => {
    const t = selectTopic(v2deps({ sales: new Set(['배나무']), seasonalSubjects: SUBJ }))!;
    expect(t.anchor.id).toBe('p2');
    expect(t.targetMinutes).toBe(10);
    expect(t.pieces.length).toBeGreaterThanOrEqual(3);
    expect(t.reason).toContain("v2 점수 1위 '배나무 묘목 심을 자리'(블로그 하루 20회 · 지금 심기 철 · 판매 수종·심기 철)");
  });

  it('깊이 부족 — 3편이 안 되면 views 는 null, v2 는 1~2편 짧은 편(목표 6분)으로', () => {
    const two = { pieces: () => [piece('a', '사과나무 묘목 심는 깊이', { publishedTs: ago(30) }), piece('b', '배나무 묘목 심을 자리', { publishedTs: ago(30) })] };
    expect(selectTopic(deps(two))).toBeNull();
    const t = selectTopic(v2deps(two))!;
    expect(t.targetMinutes).toBe(SHORT_TARGET_MINUTES);
    expect(t.pieces.map((p) => p.id)).toEqual(['a', 'b']);
    expect(t.reason).toContain(`짧은 편(목표 ${SHORT_TARGET_MINUTES}분)`);
    // 기존 보호(같은 키·쓴 글)는 짧은 편에도 — 둘 다 막히면 null.
    const used = { records: () => [{ dir: 'd', createdTs: ago(60), topicKey: 'plant:사과나무', sourcePieceIds: ['b'], title: 'x', stage: 'ready' as const }] };
    expect(selectTopic(v2deps({ ...two, ...used }))).toBeNull();
  });

  it('LLM 묶음(v2) — 관련 2편이면 10분 편, 지시문도 2편부터; 1편뿐이면 그 1편과 짧은 편', async () => {
    const two = vi.fn(async (o: { candidates: Array<{ id: string }>; minRelated?: number }) => ({ theme: '묘목 심기', pieceIds: o.candidates.slice(0, 2).map((c) => c.id), why: 'w' }));
    const full = (await selectCoherentTopic(v2deps(), two))!;
    expect(two.mock.calls[0]![0].minRelated).toBe(2);
    expect(full.pieces).toHaveLength(3);
    expect(full.targetMinutes).toBe(10);
    const one = vi.fn(async (o: { candidates: Array<{ id: string }> }) => ({ theme: '묘목', pieceIds: [o.candidates[0]!.id], why: '' }));
    const short = (await selectCoherentTopic(v2deps(), one))!;
    expect(short.targetMinutes).toBe(SHORT_TARGET_MINUTES);
    expect(short.anchor.id).toBe('p2');
    expect(short.pieces).toHaveLength(2);
    expect(short.reason).toContain('짧은 편');
    expect(coherencePrompt(short.anchor, short.pieces, 2).user).toContain('후보에서 2~5편 골라라');
    expect(coherencePrompt(short.anchor, short.pieces).user).toContain('후보에서 3~5편 골라라'); // views 지시문은 종전 그대로
  });
});
