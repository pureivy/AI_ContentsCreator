import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  contentTokens, familyVolume, seasonIndex, demandScore, demandVerdict, formatDemandLine,
  buildDemandBlock, assessCandidatesDemand, type DemandRow, type DemandSnap,
} from './topicDemand';

// 커넥터는 전량 가짜 — 실제 네이버 호출 없이 묶음 호출 횟수·매핑만 검증한다.
const H = vi.hoisted(() => ({
  adOn: true, dlOn: true,
  calls: [] as string[][], dlCalls: [] as Array<{ kws: string[]; months: number }>,
  vols: [] as Array<{ keyword: string; pc: number; mobile: number; total: number; comp: string; pcApprox: boolean; mobileApprox: boolean }>,
  trends: [] as Array<{ keyword: string; points: Array<{ period: string; ratio: number }>; direction: '상승' | '하락' | '보합' }>,
  volsErr: null as Error | null, trendErr: null as Error | null,
}));
vi.mock('../grounding/naver_searchad', () => ({
  searchAdEnabled: () => H.adOn,
  searchAdVolumes: async (hints: string[]) => {
    H.calls.push(hints);
    if (H.volsErr) throw H.volsErr;
    return H.vols;
  },
}));
vi.mock('../grounding/naver_datalab', () => ({
  datalabEnabled: () => H.dlOn,
  datalabTrend: async (kws: string[], months: number) => {
    H.dlCalls.push({ kws, months });
    if (H.trendErr) throw H.trendErr;
    return H.trends;
  },
}));

const vol = (keyword: string, total: number, approx = false) => ({
  keyword, pc: 0, mobile: total, total, comp: '중간', pcApprox: approx, mobileApprox: approx,
});
const row = (p: Partial<DemandRow> & { keyword: string }): DemandRow =>
  ({ volume: 0, approx: false, familyMax: 0, ...p });

describe('contentTokens — 후보 키워드의 내용 토큰(순수)', () => {
  it('불용어(주는·시기)를 빼고 내용어만 남긴다', () => {
    expect(contentTokens('가을 거름 주는 시기')).toEqual(['가을', '거름']);
  });
  it('"~나무" 복합어는 유지한다', () => {
    expect(contentTokens('사과나무 비료')).toEqual(['사과나무', '비료']);
  });
  it('단독 "나무"는 불용어라 뺀다(계열 대조를 무의미하게 넓히므로)', () => {
    expect(contentTokens('나무 거름 주는 시기')).toEqual(['거름']);
  });
});

describe('familyVolume — 내용 토큰을 전부 포함하는 연관어 최대치(순수)', () => {
  const rows = [
    { keyword: '밑거름', total: 1220 },
    { keyword: '가을거름주기', total: 90 },
    { keyword: '블루베리전용비료', total: 360 },
    { keyword: '블루베리', total: 5400 },
  ];
  it("'가을·거름' 은 '밑거름'(가을 없음)을 계열로 치지 않는다", () => {
    expect(familyVolume([{ keyword: '밑거름', total: 1220 }], '가을 거름 주는 시기')).toEqual({ max: 0 });
  });
  it('토큰을 전부 포함하는 연관어 중 최대치를 top 과 함께 준다', () => {
    expect(familyVolume(rows, '가을 거름 주는 시기')).toEqual({ max: 90, top: '가을거름주기' });
    expect(familyVolume(rows, '블루베리 비료')).toEqual({ max: 360, top: '블루베리전용비료' });
  });
  it('내용 토큰이 하나도 없으면 0 — 공허참으로 전역 최대가 새어들면 안 된다', () => {
    expect(familyVolume(rows, '나무 주는 시기')).toEqual({ max: 0 });
  });
});

describe('seasonIndex — 13개월 데이터랩의 시즌 지수(순수)', () => {
  // 2025-08 ~ 2026-08(13점). 정점 2026-03=100, 현재(마지막)=2026-08 13.3, 다음달 근사=2025-09 20.
  const pts13 = [
    { period: '2025-08-01', ratio: 12 }, { period: '2025-09-01', ratio: 20 }, { period: '2025-10-01', ratio: 30 },
    { period: '2025-11-01', ratio: 18 }, { period: '2025-12-01', ratio: 9 }, { period: '2026-01-01', ratio: 11 },
    { period: '2026-02-01', ratio: 44 }, { period: '2026-03-01', ratio: 100 }, { period: '2026-04-01', ratio: 71 },
    { period: '2026-05-01', ratio: 40 }, { period: '2026-06-01', ratio: 22 }, { period: '2026-07-01', ratio: 15 },
    { period: '2026-08-01', ratio: 13.3 },
  ];
  it('max(현재, 작년 다음달)/정점 — 다음달 수요가 살아나면 지수도 그만큼 올라간다', () => {
    expect(seasonIndex(pts13, new Date('2026-08-26T12:00:00'))).toBeCloseTo(0.2, 5);
  });
  it('13점 미만이면 다음달을 모르니 현재/정점만 본다', () => {
    const pts6 = pts13.slice(-6); // 2026-03(정점 100) ~ 2026-08(13.3)
    expect(seasonIndex(pts6, new Date('2026-08-26T12:00:00'))).toBeCloseTo(13.3 / 100, 5);
  });
  it('데이터랩이 당월을 아직 안 주면(마지막 점이 지난달) 인덱스 대신 period 로 다음달을 찾는다', () => {
    // 2025-07 ~ 2026-07(13점) — 인덱스(len-12=1)는 2025-08(12)을 가리키지만 실제 다음달 근사는 2025-09(20).
    const lagged = [{ period: '2025-07-01', ratio: 8 }, ...pts13.slice(0, 12)];
    expect(seasonIndex(lagged, new Date('2026-08-26T12:00:00'))).toBeCloseTo(20 / 100, 5);
  });
  it('데이터 없음·정점 0 이면 undefined(판정 불가 → 게이트 생략)', () => {
    expect(seasonIndex([], new Date())).toBeUndefined();
    expect(seasonIndex([{ period: '2026-08-01', ratio: 0 }], new Date())).toBeUndefined();
  });
});

describe('demandScore — 정렬용 점수(순수)', () => {
  it('검색량이 크면 점수도 크다(계열 최대도 같은 자격)', () => {
    const a = demandScore(row({ keyword: 'a', volume: 30 }));
    const b = demandScore(row({ keyword: 'b', volume: 3000 }));
    const c = demandScore(row({ keyword: 'c', volume: 0, familyMax: 3000 }));
    expect(b).toBeGreaterThan(a);
    expect(c).toBeCloseTo(b, 10);
  });
  it('비수기(시즌 낮음)는 같은 검색량이라도 점수가 깎인다', () => {
    const hi = demandScore(row({ keyword: 'a', volume: 1000, seasonIdx: 1 }));
    const lo = demandScore(row({ keyword: 'a', volume: 1000, seasonIdx: 0.1 }));
    expect(lo).toBeLessThan(hi);
    expect(demandScore(row({ keyword: 'a', volume: 1000 }))).toBeCloseTo(hi, 10); // 시즌 미상 = 감점 없음
  });
});

describe('demandVerdict — 판정(순수)', () => {
  const cfg = { minVolume: 30, minSeason: 0.25 };
  it('하한 미달은 기각(계열 최대도 미달일 때만)', () => {
    expect(demandVerdict(row({ keyword: '가을 거름', volume: 0, familyMax: 0 }), cfg)).toBe('reject');
    expect(demandVerdict(row({ keyword: '가을 거름', volume: 0, familyMax: 90 }), cfg)).toBe('pass');
  });
  it('수요는 있으나 비수기면 후순위(기각 아님)', () => {
    expect(demandVerdict(row({ keyword: '비료', volume: 900, seasonIdx: 0.13 }), cfg)).toBe('demote');
  });
  it('수요·시즌 모두 충족이면 통과', () => {
    expect(demandVerdict(row({ keyword: '비료', volume: 900, seasonIdx: 0.8 }), cfg)).toBe('pass');
  });
  it('행이 없으면(조회 실패·미조회) unknown — fail-open 으로 통과시킨다', () => {
    expect(demandVerdict(undefined, cfg)).toBe('unknown');
  });
});

describe('formatDemandLine — 로그·프롬프트 공용 한 줄(순수)', () => {
  it('설계 예시와 바이트가 같다', () => {
    expect(formatDemandLine(row({
      keyword: '사과나무 비료', volume: 30, familyMax: 30, familyTop: '사과나무비료', seasonIdx: 0.13, direction: '하락',
    }))).toBe('"사과나무 비료" 30/월(계열 최대 30) · 시즌 0.13↓');
  });
  it('계열 최대가 후보 자신과 다르면 그 표기를 함께 보여준다', () => {
    expect(formatDemandLine(row({ keyword: '블루베리 비료', volume: 0, familyMax: 360, familyTop: '블루베리전용비료' })))
      .toBe('"블루베리 비료" 0/월(계열 최대 360 "블루베리전용비료")');
  });
  it('"10 미만" 표기는 가짜 정밀도 대신 그대로 남긴다', () => {
    expect(formatDemandLine(row({ keyword: '가을 거름', volume: 0, approx: true }))).toContain('10미만/월');
  });
});

describe('buildDemandBlock — 두뇌 주입 블록(순수)', () => {
  const snap: DemandSnap = {
    date: '2026-08-26',
    rows: [
      row({ keyword: '가을 거름', volume: 0, familyMax: 0 }),
      row({ keyword: '사과나무 비료', volume: 30, familyMax: 30, familyTop: '사과나무비료', seasonIdx: 0.13, direction: '하락' }),
      row({ keyword: '블루베리 묘목', volume: 2400, familyMax: 5400, familyTop: '블루베리묘목가격', seasonIdx: 0.7, direction: '상승' }),
    ],
  };
  const NOW = new Date('2026-08-26T12:00:00').getTime();
  it('점수 내림차순으로 나열하고 지시문을 붙인다', () => {
    const b = buildDemandBlock(snap, NOW);
    expect(b).toContain('[검색 수요 실측 — 2026-08-26]');
    expect(b.indexOf('블루베리 묘목')).toBeLessThan(b.indexOf('사과나무 비료'));
    expect(b.indexOf('사과나무 비료')).toBeLessThan(b.indexOf('가을 거름'));
    expect(b).toContain('검색량 10 미만·시즌 지수 0.25 미만 키워드로 주제를 세우지 마라. 수요가 있는 키워드는 그대로 keyword 로 쓰고, 계열 최대 연관어가 더 크면 그 표기를 우선하라.');
  });
  it('상위 12줄까지만 담는다', () => {
    const many: DemandSnap = { date: '2026-08-26', rows: Array.from({ length: 20 }, (_, i) => row({ keyword: `k${i}`, volume: i * 100 })) };
    expect(buildDemandBlock(many, NOW).split('\n').filter((l) => l.startsWith('- ')).length).toBe(12);
  });
  it('스냅샷 없음·빈 행·3일 초과는 무주입', () => {
    expect(buildDemandBlock(null, NOW)).toBe('');
    expect(buildDemandBlock({ date: '2026-08-26', rows: [] }, NOW)).toBe('');
    expect(buildDemandBlock({ ...snap, date: '2026-08-22' }, NOW)).toBe('');
    expect(buildDemandBlock({ ...snap, date: '2026-08-24' }, NOW)).not.toBe('');
  });
});

describe('assessCandidatesDemand — 커넥터 묶음 호출', () => {
  beforeEach(() => {
    H.adOn = true; H.dlOn = true; H.calls = []; H.dlCalls = []; H.volsErr = null; H.trendErr = null;
    H.vols = [vol('블루베리', 5400), vol('블루베리전용비료', 360), vol('사과나무비료', 30), vol('가을거름', 0, true), vol('밑거름', 1220)];
    H.trends = [{ keyword: '사과나무 비료', points: [{ period: '2026-03-01', ratio: 100 }, { period: '2026-08-01', ratio: 13 }], direction: '하락' }];
  });
  it('정확 일치 검색량·계열 최대·시즌을 후보별로 묶는다(검색광고 ≤2콜 + 데이터랩 1콜)', async () => {
    const m = await assessCandidatesDemand(['사과나무 비료', '블루베리 비료', '가을 거름']);
    expect(H.calls.length).toBe(1);
    expect(H.dlCalls).toEqual([{ kws: ['사과나무 비료', '블루베리 비료', '가을 거름'], months: 13 }]);
    expect(m.get('사과나무 비료')).toEqual({
      keyword: '사과나무 비료', volume: 30, approx: false, familyMax: 30, familyTop: '사과나무비료', seasonIdx: 0.13, direction: '하락',
    });
    expect(m.get('블루베리 비료')).toMatchObject({ volume: 0, familyMax: 360, familyTop: '블루베리전용비료' });
    expect(m.get('가을 거름')).toMatchObject({ volume: 0, approx: true, familyMax: 0 }); // '밑거름'은 계열 아님
  });
  it('중복은 합치고 11번째부터는 조회하지 않는다(미조회 후보는 unknown 으로 통과)', async () => {
    const kws = Array.from({ length: 12 }, (_, i) => `키워드${i}`);
    const m = await assessCandidatesDemand([...kws, '키워드0']);
    expect(H.calls.length).toBe(2);
    expect(H.calls.flat()).toEqual(kws.slice(0, 10));
    expect(m.size).toBe(10);
    expect(m.has('키워드10')).toBe(false);
    expect(demandVerdict(m.get('키워드10'), { minVolume: 30, minSeason: 0.25 })).toBe('unknown');
  });
  it('커넥터 비활성·빈 응답·예외는 빈 Map(게이트 생략)', async () => {
    H.adOn = false;
    expect((await assessCandidatesDemand(['사과나무 비료'])).size).toBe(0);
    expect(H.calls.length).toBe(0);
    H.adOn = true; H.vols = [];
    expect((await assessCandidatesDemand(['사과나무 비료'])).size).toBe(0);
    H.vols = [vol('사과나무비료', 30)]; H.volsErr = new Error('HTTP 429');
    expect((await assessCandidatesDemand(['사과나무 비료'])).size).toBe(0);
  });
  it('데이터랩만 실패하면 검색량 행은 살린다(시즌 미상 = 후순위 판정 불가)', async () => {
    H.trendErr = new Error('datalab down');
    const m = await assessCandidatesDemand(['사과나무 비료']);
    expect(m.get('사과나무 비료')).toMatchObject({ volume: 30, familyMax: 30 });
    expect(m.get('사과나무 비료')!.seasonIdx).toBeUndefined();
  });
});

describe('스냅샷 IO — 브랜드별 파일·하루 1회·실패 시 보존', () => {
  let tmp: string;
  const snapDir = (): string => path.join(tmp, 'analytics');
  const snapFile = (): string => path.join(snapDir(), fs.readdirSync(snapDir()).find((f) => f.startsWith('demand') && f.endsWith('.json'))!);
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demand-'));
    fs.writeFileSync(path.join(tmp, 'brand.yaml'), 'name: 테스트나무\nseedKeywords:\n  - 사과나무 비료\n  - 블루베리 비료\n', 'utf-8');
    H.adOn = true; H.dlOn = true; H.calls = []; H.dlCalls = []; H.volsErr = null; H.trendErr = null;
    H.vols = [vol('사과나무비료', 30), vol('블루베리전용비료', 360)];
    H.trends = [];
    vi.doMock('../config', () => ({ CONFIG: { dataDir: tmp } }));
    vi.resetModules();
  });
  afterEach(() => { vi.doUnmock('../config'); vi.resetModules(); });

  it('시드(브랜드 + 성과 winners)로 스냅샷을 쓰고 같은 날 재호출은 no-op', async () => {
    fs.mkdirSync(snapDir(), { recursive: true });
    fs.writeFileSync(path.join(snapDir(), 'strategy-테스트나무.json'),
      JSON.stringify({ winners: [{ keyword: '블루베리 묘목' }, { keyword: '사과나무 비료' }] }), 'utf-8');
    const { refreshDemandSnapshot, demandSignalBlock } = await import('./topicDemand');
    await refreshDemandSnapshot();
    const snap = JSON.parse(fs.readFileSync(snapFile(), 'utf-8')) as DemandSnap;
    expect(snap.rows.map((r) => r.keyword)).toEqual(['사과나무 비료', '블루베리 비료', '블루베리 묘목']); // winners 중복은 합쳐짐
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const before = H.calls.length;
    await refreshDemandSnapshot();
    expect(H.calls.length).toBe(before);
    expect(demandSignalBlock()).toContain('[검색 수요 실측');
  });
  it('전 묶음 실패면 기존 스냅샷을 덮어쓰지 않는다', async () => {
    fs.mkdirSync(snapDir(), { recursive: true });
    const keep = { date: '2026-01-01', rows: [row({ keyword: '지난 스냅샷', volume: 900 })] };
    fs.writeFileSync(path.join(snapDir(), 'demand-테스트나무.json'), JSON.stringify(keep), 'utf-8');
    H.volsErr = new Error('HTTP 429');
    const { refreshDemandSnapshot } = await import('./topicDemand');
    await refreshDemandSnapshot();
    expect(JSON.parse(fs.readFileSync(snapFile(), 'utf-8'))).toEqual(keep);
  });
  it('winners 는 소재 범위·시대 컷오프로 거르고, 사용자가 적은 브랜드 시드는 그대로 둔다', async () => {
    fs.writeFileSync(path.join(tmp, 'brand.yaml'),
      'name: 테스트나무\nperfEraSince: 2026-07-31\nbanned:\n  - 다육·채소 등 무관 주제\nseedKeywords:\n  - 다육이 화분\n  - 사과나무 비료\n', 'utf-8');
    fs.mkdirSync(snapDir(), { recursive: true });
    fs.writeFileSync(path.join(snapDir(), 'strategy-테스트나무.json'), JSON.stringify({
      winners: [
        { keyword: '다육 선인장', firstSeenAt: '2026-08-18T00:00:00.000Z' },   // 소재 범위 밖 → 제외
        { keyword: '배롱나무 전정', firstSeenAt: '2026-07-01T00:00:00.000Z' }, // 정체성 재정립 이전 → 제외
        { keyword: '블루베리 묘목', firstSeenAt: '2026-08-18T00:00:00.000Z' }, // 통과
        { keyword: '감나무 접목', score: 1 },                                   // 시각 불명 → 보수적 제외
      ],
    }), 'utf-8');
    const { demandSeeds } = await import('./topicDemand');
    // '다육이 화분'은 브랜드 banned 토큰('다육')에 걸리지만 사용자가 직접 적은 시드라 살아남는다.
    expect(demandSeeds()).toEqual(['다육이 화분', '사과나무 비료', '블루베리 묘목']);
  });
  it('스냅샷이 3일 넘게 낡으면 블록은 빈 문자열(무주입)', async () => {
    fs.mkdirSync(snapDir(), { recursive: true });
    fs.writeFileSync(path.join(snapDir(), 'demand-테스트나무.json'),
      JSON.stringify({ date: '2020-01-01', rows: [row({ keyword: '옛날 키워드', volume: 900 })] }), 'utf-8');
    const { demandSignalBlock } = await import('./topicDemand');
    expect(demandSignalBlock()).toBe('');
  });
});
