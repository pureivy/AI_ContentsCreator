/**
 * 수종 필수 게이트(2026-10-02, BLOG_REQUIRE_SPECIES) — 판정 눈·키워드 보정·면제·빈 틱 방지·킬스위치.
 *
 * 통합 부분은 proposeContentIdeas 를 실제로 돌린다 — LLM(microJSON)·계열 분류·검색광고·자동완성만 가짜로 두고,
 * 데이터 디렉토리는 임시 폴더(GEPA_DATA_DIR)라 실데이터를 읽거나 쓰지 않는다. 수종 사전(data/species.yaml)은 실물이다.
 *
 * 임시 폴더는 **어떤 import 보다 먼저**(vi.hoisted) 잡는다. 부분 mock 의 원본 모듈은 resetModules 뒤에도 처음 로드된
 * 인스턴스로 남아 그때의 CONFIG.dataDir 을 쥐고 있다 — 테스트마다 폴더를 바꾸면 수요 기각 기억이 실데이터 폴더
 * (data/analytics)로 새어 나간다(실제로 한 번 샜다). 그래서 파일 전체가 폴더 하나를 쓰고, 테스트마다 비운다.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { requiredSpeciesOf, speciesRequiredFor, speciesSurfaceIn, bindSpeciesKeyword, inSeasonSpecies, pickDemoted, demandGateDecision, speciesFloorExempt, speciesRequiredBlock, shouldRememberDemandReject, rememberedDemandReject } from './scheduler';
import type { DemandRow } from '../analytics/topicDemand';

const h = await vi.hoisted(async () => {
  const nfs = await import('node:fs'); const nos = await import('node:os'); const npath = await import('node:path');
  const root = nfs.mkdtempSync(npath.join(nos.tmpdir(), 'species-req-'));
  process.env.GEPA_DATA_DIR = root;
  return {
    root,
    rounds: [] as Array<Array<{ title: string; keyword?: string }> | null | { exhausted: true; reason?: string }>, prompts: [] as string[],
    searchAd: false, demandTargets: [] as string[][], volume: {} as Record<string, number>, season: {} as Record<string, number>,
    suggest: {} as Record<string, string[]>,
  };
});
vi.mock('../orchestrator/agent', () => ({
  microJSON: vi.fn(async (_m: unknown, _sys: string, user: string) => {
    h.prompts.push(user);
    const r = h.rounds.shift();
    if (r && !Array.isArray(r)) return r;   // 지시 소진 응답 같은 원형 객체
    return r === null || r === undefined ? null : { ideas: r };
  }),
}));
vi.mock('../agents/company-loader', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getCompany: () => ({ teams: [{ id: 'content', name: '콘텐츠팀', lead: { specialty: '나무·묘목 블로그 콘텐츠 기획과 집필' } }] }),
}));
vi.mock('../analytics/seriesLedger', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ensureSeriesLabels: async () => 0,
  classifyCandidates: async (c: unknown[]) => c.map(() => ({ species: null, activity: null })),
}));
vi.mock('../grounding/naver_searchad', async (orig) => ({ ...(await orig<Record<string, unknown>>()), searchAdEnabled: () => h.searchAd }));
// 수요 조회 — 어떤 키워드를 물었는지 기록하고, h.volume 의 값으로 행을 돌려준다(없으면 행 없음 = 모름).
vi.mock('../analytics/topicDemand', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  assessCandidatesDemand: async (kws: string[]) => {
    h.demandTargets.push([...kws]);
    return new Map(kws.filter((k) => k in h.volume).map((k) => [k, { keyword: k, volume: h.volume[k]!, approx: false, familyMax: h.volume[k]!, seasonIdx: h.season[k] ?? 1 }]));
  },
}));
vi.mock('../grounding/naver_autocomplete', () => ({ naverAutocomplete: async (q: string) => h.suggest[q] ?? [] }));
// 유튜브 자동완성도 가짜(실검색 각도 통합 테스트가 네트워크에 기대지 않게).
vi.mock('../analytics/trendSignal', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ytAutocomplete: async () => [] }));
vi.mock('./notify', () => ({ notify: async () => {} }));

describe('requiredSpeciesOf — 수종 필수 게이트의 눈(실제 수종 사전·카탈로그)', () => {
  it('흔한 이름·별칭·나무를 뗀 표기를 수종으로 본다', () => {
    expect(requiredSpeciesOf('블루베리 묘목 심는 깊이')).toBeTruthy();
    expect(requiredSpeciesOf('감나무 가지치기')).toBeTruthy();
    expect(requiredSpeciesOf('매실나무')).toBeTruthy();
    expect(requiredSpeciesOf('매실 수확')).toBeTruthy();
    expect(requiredSpeciesOf('매실 수확')).toBe(requiredSpeciesOf('매실나무'));
    expect(requiredSpeciesOf('엄나무 순')).toBeTruthy();
    expect(requiredSpeciesOf('엄나무')).toBe(requiredSpeciesOf('음나무'));
    expect(requiredSpeciesOf('자두나무 가지치기 언제')).toBeTruthy();
    expect(requiredSpeciesOf('올리브나무 물부족증상')).toBeTruthy();
  });
  it('일반어(묘목·정원·나무·유실수·조경수)는 수종이 아니다', () => {
    for (const t of ['묘목 고르는 법', '정원 나무 추천', '나무 심기 좋은 시기', '나무 심는 깊이', '유실수 묘목', '과일나무 묘목', '조경수 가격', '가을 물주기 시기', '정원 상태 진단', '그늘 정원 나무', '']) {
      expect(requiredSpeciesOf(t), t).toBeNull();
    }
  });
  it('식물 용어 속 가짜 어간은 가린다 — 도장지(회양목 별칭 도장나무)·포도당(포도)', () => {
    expect(requiredSpeciesOf('처서 전 여름 도장지 정리')).toBeNull();
    expect(requiredSpeciesOf('포도당 축적과 단맛')).toBeNull();
    // 가림은 그 낱말만 — 같은 글에 진짜 수종이 있으면 그대로 잡는다
    expect(requiredSpeciesOf('포도나무 도장지 정리')).toBeTruthy();
  });
});

describe('speciesSurfaceIn / bindSpeciesKeyword — 제목의 수종을 키워드로 옮기는 결정적 구제', () => {
  it('글자 그대로의 표기를 쓴다 — 대표명(설중매나무)이 아니라 매실', () => {
    expect(speciesSurfaceIn('매실, 지금 가지치기하면 안 되는 이유')).toBe('매실');
    expect(bindSpeciesKeyword({ title: '매실 가지치기, 지금 하면 안 되는 이유', keyword: '가지치기 시기' }).cand.keyword).toBe('매실 가지치기 시기');
  });
  it('끝의 조사만 뗀다 — 떼면 수종이 사라지는 포도의 "도"는 남긴다', () => {
    expect(speciesSurfaceIn('블루베리를 심을 때 깊이')).toBe('블루베리');
    expect(speciesSurfaceIn('감나무와 대봉 차이')).toBe('감나무');
    expect(speciesSurfaceIn('포도 수확 후 관리')).toBe('포도');
    expect(speciesSurfaceIn('정원 나무 고르는 법')).toBeNull();
  });
  it('일반 키워드 + 수종 제목 → 홀로 선 "나무" 자리를 수종이 차지(없으면 앞에 붙임)', () => {
    const r = bindSpeciesKeyword({ title: '블루베리, 심는 깊이가 생사를 가른다', keyword: '나무 심는 깊이' });
    expect(r).toEqual({ cand: { title: '블루베리, 심는 깊이가 생사를 가른다', keyword: '블루베리 심는 깊이' }, from: '나무 심는 깊이' });
    expect(bindSpeciesKeyword({ title: '감나무 묘목, 가을에 고르는 기준', keyword: '묘목 고르는 법' }).cand.keyword).toBe('감나무 묘목 고르는 법');
  });
  it('바꿀 게 없으면 그대로 — 키워드에 수종이 있거나, 키워드가 없거나, 제목에도 수종이 없을 때', () => {
    const a = { title: '자두나무 가지치기 언제', keyword: '자두나무 가지치기' };
    expect(bindSpeciesKeyword(a)).toEqual({ cand: a });
    const b = { title: '감나무 대봉 고르는 법' };
    expect(bindSpeciesKeyword(b)).toEqual({ cand: b });
    const c = { title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' };
    expect(bindSpeciesKeyword(c)).toEqual({ cand: c });
  });
});

describe('speciesRequiredFor — 사람이 고른 범위는 면제', () => {
  const sp = (t: string): string | null => (/감나무|블루베리/.test(t) ? '감나무' : null);
  it('킬스위치 off 면 언제나 끔', () => {
    expect(speciesRequiredFor(false, null, sp)).toBe(false);
    expect(speciesRequiredFor(false, { text: '감나무 위주로' }, sp)).toBe(false);
  });
  it('지시 없음 → 건다', () => expect(speciesRequiredFor(true, null, sp)).toBe(true));
  it('수종을 정하지 않은 일반 지시 → 면제', () => expect(speciesRequiredFor(true, { text: '정원 관리 글 위주로' }, sp)).toBe(false));
  it('지시가 수종을 부르거나 보관소(=수종 목록)를 가리키면 건다', () => {
    expect(speciesRequiredFor(true, { text: '감나무 위주로' }, sp)).toBe(true);
    expect(speciesRequiredFor(true, { text: '보관소의 수종 중 인기 검색어로' }, sp)).toBe(true);
  });
});

describe('inSeasonSpecies — 축 씨앗에 붙일 열린 제철 수종', () => {
  it('막힌 수종·시즌 하한 미만은 빼고, 모름은 남기고, 검색량 순(같으면 원래 순서)', () => {
    const vol: Record<string, number> = { 배롱나무: 86000, 감나무: 9000, 블루베리: 9000 };
    const season: Record<string, number> = { 이팝나무: 0.01, 감나무: 0.9 };
    const out = inSeasonSpecies(['이팝나무', '감나무', '마가목', '블루베리', '배롱나무', '감나무'], {
      blocked: (n) => n === '배롱나무', volumeOf: (n) => vol[n], seasonOf: (n) => season[n], minSeason: 0.25,
    });
    expect(out).toEqual(['감나무', '블루베리', '마가목']);
  });
  it('limit', () => {
    expect(inSeasonSpecies(['a', 'b', 'c'], { blocked: () => false, volumeOf: () => undefined, seasonOf: () => undefined, minSeason: 0.25, limit: 2 })).toEqual(['a', 'b']);
  });
});

describe('최후 보류함 서열 — pickDemoted 에 새로 쓰는 rank(-1·0.5)', () => {
  it('-1(다른 게이트 전부 통과) < 0(비수기) < 0.5(유사 폴백 자격) < 1 이상(수요 미달·최근 축·수종·각도 밖), 동률은 먼저 담긴 것', () => {
    const r = (rank: number, t: string) => ({ rank, t });
    expect(pickDemoted([r(1, 'a'), r(0.5, 'b'), r(0, 'c'), r(-1, 'd')])?.t).toBe('d');
    expect(pickDemoted([r(1, 'a'), r(0.5, 'b'), r(0, 'c')])?.t).toBe('c');
    expect(pickDemoted([r(4, 'a'), r(1, 'b'), r(0.5, 'c')])?.t).toBe('c');
    expect(pickDemoted([r(-1, 'first'), r(-1, 'second')])?.t).toBe('first');
  });
});

// ---------------- proposeContentIdeas 통합 ----------------
const BRAND_YAML = [
  'name: testbrand',
  'speciesCatalog:',
  '  - group: 유실수',
  '    species:',
  '      - name: 블루베리',
  '      - name: 감나무',
  'topicThemes:',
  '  - theme: 심기·이식',
  '    seeds:',
  '      - 나무 심는 깊이',
  '    match:',
  '      - 깊이',
  '',
].join('\n');

afterAll(() => { fs.rmSync(h.root, { recursive: true, force: true }); delete process.env.GEPA_DATA_DIR; });

describe('proposeContentIdeas — 수종 필수 게이트(통합)', () => {
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined): void => {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };
  const load = async (opts: { requireSpecies?: boolean; directive?: string; floorExempt?: boolean } = {}) => {
    setEnv('BLOG_REQUIRE_SPECIES', opts.requireSpecies === false ? 'false' : 'true');
    setEnv('DEMAND_FLOOR_SPECIES_EXEMPT', opts.floorExempt === false ? 'false' : 'true');
    vi.resetModules();
    const mod = await import('./scheduler');
    if (opts.directive) mod.setAutorunDirective({ text: opts.directive });
    return mod;
  };
  beforeEach(() => {
    expect(process.env.GEPA_DATA_DIR).toBe(h.root);   // 실데이터 폴더로 새지 않는다는 전제
    for (const f of fs.readdirSync(h.root)) fs.rmSync(path.join(h.root, f), { recursive: true, force: true });
    fs.writeFileSync(path.join(h.root, 'brand.yaml'), BRAND_YAML, 'utf-8');
    setEnv('ANGLE_CHECK', 'false');      // 자동완성 조회 없음
    setEnv('CONTENT_DIVERSITY', 'off');  // 소재 포화 게이트 없음(빈 코퍼스라 무관하지만 명시)
    setEnv('TOPIC_PERF_HINTS', 'false'); // 외부 인기 갱신(검색광고·유튜브 실호출) 없음
    h.rounds = []; h.prompts = []; h.searchAd = false; h.demandTargets = []; h.volume = {}; h.season = {}; h.suggest = {};
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const k of Object.keys(saved)) delete saved[k];
  });

  it('유사 폴백도 실검색 각도를 거친다 — 2026-10-07 마가목 "신농본초경" 사고(각도 밖 유사 후보가 검사 없이 채택)', async () => {
    setEnv('ANGLE_CHECK', 'true');
    fs.mkdirSync(path.join(h.root, 'pieces'), { recursive: true });
    fs.writeFileSync(path.join(h.root, 'pieces', 'index.json'), JSON.stringify([{
      id: 'piece_old', title: '감나무 이름이 옛 책에 남은 이유', keyword: '감나무 이름', stage: 'published', brand: 'testbrand',
      createdTs: '2026-09-01T00:00:00Z', updatedTs: '2026-09-01T00:00:00Z', errors: 0,
    }]), 'utf-8');
    h.suggest = { 감나무: ['감나무 묘목', '감나무 가지치기', '감나무 열매'] };
    const mod = await load();
    h.rounds = [
      [{ title: '감나무 이름이 옛 책에 남은 까닭', keyword: '감나무 이름' }],   // 기존 글과 유사 + 연관어(묘목·가지치기·열매) 밖
      [{ title: '감나무 묘목 고르는 법, 접목 자리부터', keyword: '감나무 묘목' }],
    ];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.title).toBe('감나무 묘목 고르는 법, 접목 자리부터');   // 종전이면 1라운드 유사 폴백으로 '까닭'이 채택됐다
    expect(h.prompts).toHaveLength(2);
    expect(h.prompts[1]).toContain('실검색 각도 밖(감나무)');
    expect(h.prompts[1]).toContain('감나무 실검색 연관어');
  });

  it('1라운드 비수기 후보는 채택하지 않고 2라운드에서 제철 후보를 찾는다(2026-10-07)', async () => {
    h.searchAd = true;
    h.volume = { '무화과 가지 마름': 300, '감나무 묘목': 900 };
    h.season = { '무화과 가지 마름': 0.24 };
    const mod = await load();
    h.rounds = [
      [{ title: '무화과 가지 끝이 마르는 이유', keyword: '무화과 가지 마름' }],
      [{ title: '감나무 묘목 고르는 법', keyword: '감나무 묘목' }],
    ];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.keyword).toBe('감나무 묘목');
    expect(h.prompts[1]).toContain('"무화과 가지 끝이 마르는 이유"=검색 비수기(');
  });

  it('수종 없는 키워드는 제목의 수종으로 보정해 채택 — 1라운드에서 끝난다', async () => {
    const mod = await load();
    h.rounds = [[{ title: '블루베리, 심는 깊이가 생사를 가른다', keyword: '나무 심는 깊이' }]];
    const idea = await mod.proposeContentIdeas();
    expect(idea).toMatchObject({ title: '블루베리, 심는 깊이가 생사를 가른다', keyword: '블루베리 심는 깊이' });
    expect(h.prompts).toHaveLength(1);
  });

  it('보정은 수요 조회 앞 — 검색광고에 묻는 건 보정된 키워드다(루프 안에서 바꾸면 "조회 없음"으로 새어 통과)', async () => {
    const mod = await load();
    h.searchAd = true;
    h.volume = { '블루베리 심는 깊이': 300 };
    h.rounds = [[{ title: '블루베리, 심는 깊이가 생사를 가른다', keyword: '나무 심는 깊이' }]];
    const idea = await mod.proposeContentIdeas();
    expect(h.demandTargets[0]).toEqual(['블루베리 심는 깊이']);
    expect(idea?.keyword).toBe('블루베리 심는 깊이');
  });

  it('하한 면제를 끄면(DEMAND_FLOOR_SPECIES_EXEMPT=false) 보정된 키워드도 하한 그대로(1라운드 기각 → 2라운드 밸브로 후순위 채택)', async () => {
    const mod = await load({ floorExempt: false });
    h.searchAd = true;
    h.volume = { '블루베리 심는 깊이': 10, '감나무 심는 깊이': 10 };
    h.rounds = [
      [{ title: '블루베리, 심는 깊이가 생사를 가른다', keyword: '나무 심는 깊이' }],
      [{ title: '감나무, 심는 깊이가 생사를 가른다', keyword: '나무 심는 깊이' }],
    ];
    const idea = await mod.proposeContentIdeas();
    expect(h.prompts).toHaveLength(2);
    expect(h.prompts[1]).toContain('검색 수요 미달');
    expect(idea?.keyword).toBe('감나무 심는 깊이');
  });

  it('제목에도 수종이 없으면 건너뛰고 같은 라운드의 수종 후보를 채택', async () => {
    const mod = await load();
    h.rounds = [[
      { title: '묘목 고르는 법, 뿌리부터 보세요', keyword: '묘목 고르는 법' },
      { title: '감나무 가지치기, 언제 해야 하나', keyword: '감나무 가지치기' },
    ]];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.keyword).toBe('감나무 가지치기');
  });

  it('1라운드가 전부 수종 없음이면 2라운드로 — 사유가 두뇌에게 간다', async () => {
    const mod = await load();
    h.rounds = [
      [{ title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' }],
      [{ title: '블루베리 가을 물주기, 얼마나 자주', keyword: '블루베리 물주기' }],
    ];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.keyword).toBe('블루베리 물주기');
    expect(h.prompts).toHaveLength(2);
    expect(h.prompts[1]).toContain('수종 없음');
    expect(h.prompts[1]).toContain('버리지 말고 지금 철 수종 하나에 묶어');
  });

  it('빈 틱 방지 — 두 라운드에 수종 후보가 없으면 1라운드의 수종 없는 후보를 채택(게이트 혼자 빈 틱을 만들지 않는다)', async () => {
    const mod = await load();
    h.rounds = [
      [{ title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' }],
      [{ title: '정원 상태 진단, 가을에 볼 것', keyword: '정원 상태 진단' }],
    ];
    const idea = await mod.proposeContentIdeas();
    expect(idea).toMatchObject({ title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' });
  });

  it('빈 틱 방지 — 2라운드 응답이 비어도(모델 실패) 보류한 후보를 채택', async () => {
    const mod = await load();
    h.rounds = [[{ title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' }], null];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.title).toBe('가을 물주기, 얼마나 자주');
  });

  it('프롬프트 — 수종 필수 줄이 들어가고 축 씨앗이 수종으로 묶인다', async () => {
    const mod = await load();
    h.rounds = [[{ title: '감나무 가지치기, 언제 해야 하나', keyword: '감나무 가지치기' }]];
    await mod.proposeContentIdeas();
    expect(h.prompts[0]).toContain('[수종 필수');
    expect(h.prompts[0]).toMatch(/(블루베리|감나무) 심는 깊이/);
    expect(h.prompts[0]).not.toContain('예) 나무 심는 깊이');
  });

  it('하한 면제(기본 on) — 보정된 수종 키워드는 검색량이 하한 미달이어도 1라운드에 채택, 기각 기억도 남기지 않는다', async () => {
    const mod = await load();
    h.searchAd = true;
    h.volume = { '블루베리 심는 깊이': 10 };
    h.rounds = [[{ title: '블루베리, 심는 깊이가 생사를 가른다', keyword: '나무 심는 깊이' }]];
    const log = vi.spyOn(console, 'log');
    const idea = await mod.proposeContentIdeas();
    expect(h.prompts).toHaveLength(1);
    expect(idea?.keyword).toBe('블루베리 심는 깊이');
    expect(log.mock.calls.some(([m]) => String(m).includes('검색량 하한 면제(수종 키워드)'))).toBe(true);
    log.mockRestore();
    const td = await import('../analytics/topicDemand');
    const { activeBrandSlug } = await import('../content/brand');
    expect(td.demandRejectFor(activeBrandSlug(), '블루베리 심는 깊이')).toBeNull();
  });

  it('하한 면제 — 수종 없는 일반 키워드는 하한 그대로 기각(같은 라운드의 수종 롱테일이 채택)', async () => {
    const mod = await load({ requireSpecies: false });   // 수종 필수 게이트를 꺼서 하한만 본다
    h.searchAd = true;
    h.volume = { '가을 물주기 시기': 10, '감나무 깍지벌레 방제 시기': 10 };
    h.rounds = [[
      { title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' },
      { title: '감나무 깍지벌레, 언제 잡아야 하나', keyword: '감나무 깍지벌레 방제 시기' },
    ]];
    const idea = await mod.proposeContentIdeas();
    expect(h.prompts).toHaveLength(1);
    expect(idea?.keyword).toBe('감나무 깍지벌레 방제 시기');
    const td = await import('../analytics/topicDemand');
    const { activeBrandSlug } = await import('../content/brand');
    expect(td.demandRejectFor(activeBrandSlug(), '가을 물주기 시기')).not.toBeNull();   // 일반 키워드 기각은 종전대로 기억
  });

  it('하한 면제 — 시즌 지수 판정은 그대로(비수기 수종 키워드는 후순위, 제철 후보가 이긴다)', async () => {
    const mod = await load();
    h.searchAd = true;
    h.volume = { '감나무 꽃 피는 시기': 10, '블루베리 물주기': 10 };
    h.season = { '감나무 꽃 피는 시기': 0.05 };
    h.rounds = [[
      { title: '감나무 꽃, 언제 피나', keyword: '감나무 꽃 피는 시기' },
      { title: '블루베리 가을 물주기, 얼마나 자주', keyword: '블루베리 물주기' },
    ]];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.keyword).toBe('블루베리 물주기');
  });

  it('하한 면제 — 면제 전에 쌓인 기각 기억이 있어도 다시 조회해 판정한다(기억으로 30일 막지 않는다)', async () => {
    const mod = await load();
    h.searchAd = true;
    const td = await import('../analytics/topicDemand');
    const { activeBrandSlug } = await import('../content/brand');
    td.rememberDemandReject(activeBrandSlug(), '감나무 깍지벌레', '"감나무 깍지벌레" 10미만/월(계열 최대 0)');
    expect(td.demandRejectFor(activeBrandSlug(), '감나무 깍지벌레')).not.toBeNull();   // 기억이 실제로 읽힌다는 전제
    h.volume = { '감나무 깍지벌레': 10 };
    h.rounds = [[{ title: '감나무 깍지벌레, 언제 잡아야 하나', keyword: '감나무 깍지벌레' }]];
    const idea = await mod.proposeContentIdeas();
    expect(h.demandTargets[0]).toEqual(['감나무 깍지벌레']);
    expect(idea?.keyword).toBe('감나무 깍지벌레');
    expect(h.prompts[0]).not.toContain('"감나무 깍지벌레" (');   // 제안 금지 블록에서도 빠진다
    // 대조군 — 면제를 끄면 같은 기억이 금지 블록에 실리고, 조회 없이 기억으로 기각된다.
    const mod2 = await load({ floorExempt: false });
    h.prompts = []; h.demandTargets = [];
    h.rounds = [[{ title: '감나무 깍지벌레, 언제 잡아야 하나', keyword: '감나무 깍지벌레' }], null];
    const td2 = await import('../analytics/topicDemand');
    td2.rememberDemandReject(activeBrandSlug(), '감나무 깍지벌레', '"감나무 깍지벌레" 10미만/월(계열 최대 0)');
    await mod2.proposeContentIdeas();
    expect(h.prompts[0]).toContain('"감나무 깍지벌레" (');
    expect(h.demandTargets.flat()).not.toContain('감나무 깍지벌레');
  });

  it('프롬프트 — 하한 면제면 수종 + 증상·시기 질문 롱테일을 keyword 로 권하고, 끄면 종전 문구(수종명 단독으로 물러서기)', async () => {
    let mod = await load();
    h.rounds = [[{ title: '감나무 가지치기, 언제 해야 하나', keyword: '감나무 가지치기' }]];
    await mod.proposeContentIdeas();
    expect(h.prompts[0]).toContain('수종 + 증상·시기 질문 롱테일로 세워라');
    expect(h.prompts[0]).not.toContain('수종명(또는 수종명+행위 2어절)');
    h.prompts = [];
    mod = await load({ floorExempt: false });
    h.rounds = [[{ title: '감나무 가지치기, 언제 해야 하나', keyword: '감나무 가지치기' }]];
    await mod.proposeContentIdeas();
    expect(h.prompts[0]).toContain('수종명(또는 수종명+행위 2어절)');
    expect(h.prompts[0]).not.toContain('롱테일로 세워라');
  });

  it('지시 소진 응답이 와도 1라운드에 미룬 수종 없는 후보가 있으면 채택한다(빈 틱 방지, 소진 보류 기록 없음)', async () => {
    const mod = await load({ directive: '감나무 관리 글 위주로' });
    h.rounds = [
      [{ title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' }],
      { exhausted: true, reason: '더 낼 주제 없음' },
    ];
    const idea = await mod.proposeContentIdeas();
    expect(idea).toMatchObject({ title: '가을 물주기, 얼마나 자주', directive: true });
    expect(mod.directiveExhaustedWithin(60_000)).toBe(false);
  });

  it('지시 소진 — 미룬 후보가 없으면 종전대로 쉰다(null + 소진 보류 기록)', async () => {
    const mod = await load({ directive: '감나무 관리 글 위주로' });
    h.rounds = [{ exhausted: true, reason: '더 낼 주제 없음' }];
    expect(await mod.proposeContentIdeas()).toBeNull();
    expect(mod.directiveExhaustedWithin(60_000)).toBe(true);
  });

  it('노트 — 후순위 사유와 수종 없음이 한 후보에 한 줄로 합쳐진다(노트 4자리 중 2자리를 먹지 않는다)', async () => {
    const mod = await load();
    h.searchAd = true;
    h.volume = { '가을 물주기 시기': 300 };
    h.season = { '가을 물주기 시기': 0.05 };   // 1라운드 비수기 후순위 + 수종 없음
    h.rounds = [
      [{ title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' }],
      [{ title: '블루베리 가을 물주기, 얼마나 자주', keyword: '블루베리 물주기' }],
    ];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.keyword).toBe('블루베리 물주기');
    const note = h.prompts[1]!;
    expect(note.split('"가을 물주기, 얼마나 자주"=').length - 1).toBe(1);
    // 2026-10-07 — 1라운드 비수기는 후순위가 아니라 기각(제철 후보를 2라운드에서 찾게). 수종 없음은 같은 줄에.
    expect(note).toContain('"가을 물주기, 얼마나 자주"=검색 비수기(');
    expect(note).toContain('지금 철에 사람들이 찾는 주제로) · 수종 없음(키워드 "가을 물주기 시기"');
  });

  it('킬스위치(BLOG_REQUIRE_SPECIES=false) — 종전 동작: 보정·기각 없이 첫 후보 채택, 프롬프트도 종전', async () => {
    const mod = await load({ requireSpecies: false });
    h.rounds = [[
      { title: '묘목 고르는 법, 뿌리부터 보세요', keyword: '묘목 고르는 법' },
      { title: '감나무 가지치기, 언제 해야 하나', keyword: '감나무 가지치기' },
    ]];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.keyword).toBe('묘목 고르는 법');
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).not.toContain('[수종 필수');
    expect(h.prompts[0]).toContain('예) 나무 심는 깊이');
  });

  it('면제 — 수종을 정하지 않은 사장님 지시면 수종 없는 후보도 그대로 채택', async () => {
    const mod = await load({ directive: '정원 관리 기본기 글 위주로' });
    h.rounds = [[{ title: '정원 상태 진단, 가을에 볼 것', keyword: '정원 상태 진단' }]];
    const idea = await mod.proposeContentIdeas();
    expect(idea).toMatchObject({ keyword: '정원 상태 진단', directive: true });
    expect(h.prompts[0]).not.toContain('[수종 필수');
  });

  it('수종을 부르는 지시는 면제가 아니다', async () => {
    const mod = await load({ directive: '감나무 관리 글 위주로' });
    h.rounds = [[
      { title: '가을 물주기, 얼마나 자주', keyword: '가을 물주기 시기' },
      { title: '감나무 가을 물주기, 얼마나 자주', keyword: '감나무 물주기' },
    ]];
    const idea = await mod.proposeContentIdeas();
    expect(idea?.keyword).toBe('감나무 물주기');
  });
});

// 검색량 하한 면제(2026-10-02 사장님 결정 "수종 키워드는 하한 면제") — 판정 순수부.
describe('demandGateDecision — 수종 키워드 하한 면제(순수)', () => {
  const cfg = { minVolume: 30, minSeason: 0.25 };
  const row = (keyword: string, volume: number, seasonIdx?: number): DemandRow =>
    ({ keyword, volume, approx: volume === 0, familyMax: volume, ...(seasonIdx === undefined ? {} : { seasonIdx }) });
  const rows = (...r: DemandRow[]) => new Map(r.map((x) => [x.keyword, x]));
  const on = (k: string) => speciesFloorExempt(k, true);

  it('수종 없는 일반 키워드는 하한 그대로 기각', () => {
    expect(demandGateDecision(rows(row('가을 물주기 시기', 10, 0.9)), '가을 물주기 시기', cfg, { floorExempt: on }).verdict).toBe('reject');
  });
  it('수종 키워드는 하한 미달이어도 통과 — exempted 표시, 줄 끝에 면제 표기, 기각 기억 대상 아님', () => {
    const d = demandGateDecision(rows(row('감나무 깍지벌레', 0, 0.8)), '감나무 깍지벌레', cfg, { floorExempt: on });
    expect(d).toMatchObject({ verdict: 'pass', exempted: true });
    expect(d.line).toContain('10미만/월');
    expect(d.line).toContain('수종 키워드 하한 면제');
    expect(shouldRememberDemandReject(d, null, '감나무 깍지벌레')).toBe(false);
  });
  it('시즌 지수는 그대로 본다 — 비수기 수종 키워드는 demote(밸브가 만든 relaxed 아님)', () => {
    const d = demandGateDecision(rows(row('감나무 꽃 피는 시기', 10, 0.05)), '감나무 꽃 피는 시기', cfg, { floorExempt: on, relax: true });
    expect(d.verdict).toBe('demote');
    expect(d.relaxed).toBeUndefined();
    expect(d.exempted).toBe(true);
  });
  it('하한을 넘는 수종 키워드는 종전 판정 그대로(exempted 없음)', () => {
    expect(demandGateDecision(rows(row('감나무 가지치기', 900, 0.9)), '감나무 가지치기', cfg, { floorExempt: on })).toEqual({ verdict: 'pass', line: expect.any(String) });
  });
  it('조회 행이 없으면 종전과 같은 unknown(면제가 판정을 만들지 않는다)', () => {
    expect(demandGateDecision(new Map(), '감나무 깍지벌레', cfg, { floorExempt: on })).toEqual({ verdict: 'unknown', line: '' });
  });
  it('면제 키워드는 기억된 기각을 쓰지 않는다 — 행이 있으면 그 행으로, 없으면 unknown', () => {
    const remembered = { line: '"감나무 깍지벌레" 10미만/월(계열 최대 0)' };
    expect(demandGateDecision(rows(row('감나무 깍지벌레', 0, 0.8)), '감나무 깍지벌레', cfg, { floorExempt: on, remembered }).verdict).toBe('pass');
    expect(demandGateDecision(new Map(), '감나무 깍지벌레', cfg, { floorExempt: on, remembered }).verdict).toBe('unknown');
  });
  it('면제를 끄면(predicate false) 종전 판정 — 기각·밸브·기억 모두 그대로', () => {
    const off = () => false;
    const r = rows(row('감나무 깍지벌레', 10, 0.8));
    expect(demandGateDecision(r, '감나무 깍지벌레', cfg, { floorExempt: off })).toEqual({ verdict: 'reject', line: expect.any(String) });
    expect(demandGateDecision(r, '감나무 깍지벌레', cfg, { floorExempt: off, relax: true })).toMatchObject({ verdict: 'demote', relaxed: true });
    expect(demandGateDecision(new Map(), '감나무 깍지벌레', cfg, { floorExempt: off, remembered: { line: 'L' } })).toEqual({ verdict: 'reject', line: 'L' });
  });
});

describe('speciesFloorExempt / speciesRequiredBlock — 면제 대상·프롬프트 줄', () => {
  it('수종을 부르는 키워드만, 스위치가 켜져 있을 때만', () => {
    expect(speciesFloorExempt('감나무 깍지벌레', true)).toBe(true);
    expect(speciesFloorExempt('매실 수확 시기', true)).toBe(true);
    expect(speciesFloorExempt('가을 물주기 시기', true)).toBe(false);
    expect(speciesFloorExempt('여름 도장지 정리', true)).toBe(false);   // 가짜 어간(회양목 '도장')은 수종이 아니다
    expect(speciesFloorExempt('감나무 깍지벌레', false)).toBe(false);
    expect(speciesFloorExempt(undefined, true)).toBe(false);
  });
  it('면제 on 줄은 수종 + 증상·시기 질문 롱테일을 권하고 하한을 안 건다고 말한다 — 예시는 자리표시(○○)만', () => {
    const b = speciesRequiredBlock(true);
    expect(b).toContain('수종 + 증상·시기 질문 롱테일로 세워라');
    expect(b).toContain('검색량 하한을 걸지 않는다');
    expect(b).not.toContain('수종명(또는 수종명+행위 2어절)');
    expect(b).not.toMatch(/감나무|블루베리|배롱나무/);
  });
  it('면제 off 줄은 종전 문구 그대로', () => {
    expect(speciesRequiredBlock(false)).toContain('없으면 keyword 는 수종명(또는 수종명+행위 2어절)으로 두고 질문은 제목이 진다 — 표에 없는 긴 질문형 keyword 는 검색량 하한에 걸린다.');
    expect(speciesRequiredBlock(false).split('\n').slice(0, 4)).toEqual(speciesRequiredBlock(true).split('\n').slice(0, 4));
  });
});

describe('rememberedDemandReject — 하한 면제 키워드는 기각 기억을 건너뛰고 실제 조회로(2026-10-02 2차 리뷰)', () => {
  it('면제면 기억을 보지 않는다(null), 아니면 기억 그대로 — 후보 루프·예고·클러스터가 같은 규칙', () => {
    const entry = { keyword: 'x', line: '월 30회', ts: '2026-10-01T00:00:00Z' };
    const lookup = vi.fn(() => entry);
    expect(rememberedDemandReject('b', '감나무 깍지벌레', () => true, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    expect(rememberedDemandReject('b', '가을 물주기 시기', () => false, lookup)).toBe(entry);
    expect(lookup).toHaveBeenCalledWith('b', '가을 물주기 시기');
  });
});
