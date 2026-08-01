import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startAutoCycle, startDaily, derivedContentDue, seedKeywordBlock, eligibleWinners, dailyDue } from './scheduler';

describe('startAutoCycle (유휴 게이트 자율 사이클)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('intervalMs<=0 이면 no-op (스케줄조차 안 함)', () => {
    const launch = vi.fn();
    const stop = startAutoCycle({ intervalMs: 0, isBusy: () => false, pickWork: async () => 'x', launch });
    vi.advanceTimersByTime(60_000);
    expect(launch).not.toHaveBeenCalled();
    stop();
  });

  it('사용자 런 진행 중이면 제안·실행하지 않는다(양보)', async () => {
    const launch = vi.fn();
    const pickWork = vi.fn(async () => 'task');
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => true, pickWork, launch });
    await vi.advanceTimersByTimeAsync(1000);
    expect(pickWork).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    stop();
  });

  it('유휴 + 제안 있으면 그 주제로 launch', async () => {
    const launch = vi.fn();
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => false, pickWork: async () => '신규 자율 작업', launch });
    await vi.advanceTimersByTimeAsync(1000);
    expect(launch).toHaveBeenCalledWith('신규 자율 작업');
    stop();
  });

  it('제안이 null/빈값이면 launch 안 함', async () => {
    const launch = vi.fn();
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => false, pickWork: async () => null, launch });
    await vi.advanceTimersByTimeAsync(1000);
    expect(launch).not.toHaveBeenCalled();
    stop();
  });

  it('이전 tick 미완(느린 pickWork) 중 다음 tick 은 재진입하지 않는다', async () => {
    let resolveProposal: (v: string | null) => void = () => {};
    const pickWork = vi.fn(() => new Promise<string | null>((r) => { resolveProposal = r; }));
    const launch = vi.fn();
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => false, pickWork, launch, log: () => {} });
    await vi.advanceTimersByTimeAsync(1000); // tick1 시작 → pickWork await 에서 멈춤
    await vi.advanceTimersByTimeAsync(1000); // tick2 발화하나 ticking 가드로 차단
    expect(pickWork).toHaveBeenCalledTimes(1); // 재진입 안 함
    resolveProposal('작업');
    await vi.advanceTimersByTimeAsync(0);
    expect(launch).toHaveBeenCalledTimes(1);
    stop();
  });

  it('pickWork 가 throw 해도 죽지 않는다(다음 틱 지속)', async () => {
    const launch = vi.fn();
    const stop = startAutoCycle({
      intervalMs: 1000, isBusy: () => false,
      pickWork: async () => { throw new Error('boom'); }, launch,
      log: () => {},
    });
    await vi.advanceTimersByTimeAsync(2000); // 두 틱
    expect(launch).not.toHaveBeenCalled();
    stop();
  });
});

describe('startDaily (일일 브리핑 스케줄)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('시각 형식이 잘못되면 no-op', () => {
    const run = vi.fn();
    const stop = startDaily({ time: 'bad', run });
    vi.advanceTimersByTime(3 * 86_400_000);
    expect(run).not.toHaveBeenCalled();
    stop();
  });

  it('지정 시각에 1회 발송하고 같은 날 재발송하지 않는다', () => {
    vi.setSystemTime(new Date(2026, 5, 19, 8, 59, 0)); // 08:59 로컬
    const run = vi.fn();
    const stop = startDaily({ time: '09:00', run });
    vi.advanceTimersByTime(60_000); // → 09:00, 발화
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000 * 30); // 09:30 까지 — 당일 1회 가드
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it('지정 시각 전에는 발송하지 않는다', () => {
    vi.setSystemTime(new Date(2026, 5, 19, 7, 0, 0)); // 07:00
    const run = vi.fn();
    const stop = startDaily({ time: '09:00', run });
    vi.advanceTimersByTime(60_000 * 30); // 07:30 — 아직 전
    expect(run).not.toHaveBeenCalled();
    stop();
  });
});

// 오토런 온/오프 토글(사용자 요청 2026-07-16) — 꺼짐 상태면 틱이 아무 일도 하지 않는다.
describe('startAutoCycle — isEnabled 게이트(오토런 토글)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('isEnabled=false 면 pickWork 호출 없음, 켜면 다음 틱부터 재개', async () => {
    const pickWork = vi.fn(async () => 'x');
    const launch = vi.fn();
    let enabled = false;
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => false, isEnabled: () => enabled, pickWork, launch });
    await vi.advanceTimersByTimeAsync(3000);
    expect(pickWork).not.toHaveBeenCalled();
    enabled = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(pickWork).toHaveBeenCalled();
    stop();
  });
});

// 토글 영속 — 재시작에도 유지(data/_shared/autorun.json), 기본값은 온(기존 동작 불변).
describe('autoRunEnabled/setAutoRunEnabled — 영속 라운드트립', () => {
  it('기본 온 → 끄면 파일 영속 → 모듈 재로드에도 꺼짐 유지', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const pathm = await import('node:path');
    const tmp = fs.mkdtempSync(pathm.join(os.tmpdir(), 'autorun-'));
    process.env.GEPA_DATA_DIR = tmp;
    vi.resetModules();
    let mod = await import('./scheduler');
    expect(mod.autoRunEnabled()).toBe(true); // 기본 온
    mod.setAutoRunEnabled(false);
    expect(mod.autoRunEnabled()).toBe(false);
    vi.resetModules();
    mod = await import('./scheduler'); // 재시작 시뮬레이션
    expect(mod.autoRunEnabled()).toBe(false);
    mod.setAutoRunEnabled(true);
    delete process.env.GEPA_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// 파생 콘텐츠 일일 케이던스(사용자 지시 2026-07-16: 쇼츠·카드뉴스 매일 1편) — 24h/N 간격 게이트.
describe('derivedContentDue — 일일 N편 케이던스(순수)', () => {
  const now = new Date('2026-07-16T12:00:00Z').getTime();
  it('perDay<=0 은 off, 기록 없음·손상 ts 는 즉시 due', () => {
    expect(derivedContentDue(0, '2026-07-01T00:00:00Z', now)).toBe(false);
    expect(derivedContentDue(1, undefined, now)).toBe(true);
    expect(derivedContentDue(1, '깨진값', now)).toBe(true);
  });
  it('매일 1편: 24h 경과 전 false, 이후 true', () => {
    expect(derivedContentDue(1, '2026-07-15T13:00:00Z', now)).toBe(false); // 23h
    expect(derivedContentDue(1, '2026-07-15T11:00:00Z', now)).toBe(true);  // 25h
  });
});

// 시드 키워드 무음 유실(2026-08-01 실측) — 프롬프트가 `winners || coldstart` 라서 성과 키워드가
// 한 줄만 있어도 브랜드 시드가 통째로 사라졌다. 새 축을 yaml 시드에 넣어도 주제 선정이 안 바뀌던 원인.
describe('seedKeywordBlock — 성과 키워드가 있어도 시드가 사라지지 않는다', () => {
  const seeds = ['도토리나무 구별', '겨울눈으로 나무 알아보기'];
  it('winners 가 있으면 시드를 나란히 준다(종전엔 여기서 유실됐다)', () => {
    const b = seedKeywordBlock('- 여름꽃종류 (점수 0.80)', seeds);
    for (const k of seeds) expect(b).toContain(k);
  });
  it('winners 가 비면 빈 문자열 — coldstart 가 이미 같은 시드를 담아 중복 주입이 된다', () => {
    expect(seedKeywordBlock('', seeds)).toBe('');
  });
  it('시드가 없으면 빈 문자열 — 미설정 브랜드는 종전 동작 그대로', () => {
    expect(seedKeywordBlock('- 무언가', [])).toBe('');
  });
});

// 시대 컷오프(2026-08-01) — 정체성 재정립 전 성과가 주제 두뇌를 옛 정체성으로 되끌던 문제.
// updatedAt 은 측정창 안에서 매일 갱신돼 컷오프를 무너뜨리므로 firstSeenAt(불변)을 본다.
describe('eligibleWinners — 소재 게이트 + 시대 컷오프', () => {
  const W = [
    { keyword: '여름꽃종류', firstSeenAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z' },
    { keyword: '화분곰팡이', firstSeenAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
    { keyword: '신비복숭아묘목', firstSeenAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
  ];
  it('since 미설정이면 시대 필터 없음 — 정체성을 바꾼 적 없는 브랜드는 종전 동작', () => {
    expect(eligibleWinners(W, undefined).map((w) => w.keyword)).toEqual(['여름꽃종류', '화분곰팡이', '신비복숭아묘목']);
  });
  it('컷오프 이전에 처음 측정된 것은 제외', () => {
    expect(eligibleWinners(W, '2026-07-31').map((w) => w.keyword)).toEqual(['신비복숭아묘목']);
  });
  it('재측정으로 updatedAt 이 컷오프를 넘어도 되살아나지 않는다 — 이게 firstSeenAt 을 둔 이유', () => {
    // 화분곰팡이: updatedAt 08-01(컷오프 이후)이지만 firstSeenAt 07-27 → 계속 제외
    expect(eligibleWinners(W, '2026-07-31').some((w) => w.keyword === '화분곰팡이')).toBe(false);
  });
  it('firstSeenAt 이 없는 구파일 항목은 updatedAt 으로 판정', () => {
    const old = [{ keyword: '모감주나무', updatedAt: '2026-07-20T00:00:00.000Z' }];
    expect(eligibleWinners(old, '2026-07-31')).toHaveLength(0);
    expect(eligibleWinners(old, '2026-07-01')).toHaveLength(1);
  });
  it('시각 정보가 전혀 없으면 옛 것으로 본다(보수적)', () => {
    expect(eligibleWinners([{ keyword: '모감주나무' }], '2026-07-31')).toHaveLength(0);
  });
});

// 일일 작업 유실(2026-08-02 실측) — 종전 조건은 예정 시각이 든 '그 한 시간' 안에 프로세스가 살아
// 있어야만 발동했다(07:30 이면 07:30~07:59). tsx watch 재기동이 그 창을 놓치면 그날 팔로워
// 스냅샷·성과 동기화가 통째로 사라진다(followers 가 07-31 에서 멈춰 08-01 이 비었다).
describe('dailyDue — 예정 시각 이후 부팅해도 그날 몫을 따라잡는다', () => {
  const at = (h: number, m: number) => new Date(2026, 7, 2, h, m);
  it('예정 시각 전에는 발동 안 함', () => {
    expect(dailyDue(at(7, 29), 7, 30, 'D', '')).toBe(false);
    expect(dailyDue(at(3, 0), 7, 30, 'D', '')).toBe(false);
  });
  it('예정 시각 정각에 발동', () => {
    expect(dailyDue(at(7, 30), 7, 30, 'D', '')).toBe(true);
  });
  it('예정 시각이 든 시간대를 지나 부팅해도 발동 — 이게 종전에 유실되던 경우', () => {
    expect(dailyDue(at(9, 0), 7, 30, 'D', '')).toBe(true);
    expect(dailyDue(at(23, 59), 7, 30, 'D', '')).toBe(true);
  });
  it('오늘 이미 발동했으면 재발동 안 함 — 재기동 시 중복 방지(영속 lastFired)', () => {
    expect(dailyDue(at(9, 0), 7, 30, 'D', 'D')).toBe(false);
  });
  it('날짜가 바뀌면 다시 발동', () => {
    expect(dailyDue(at(9, 0), 7, 30, 'D2', 'D')).toBe(true);
  });
});
