import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startAutoCycle, startDaily } from './scheduler';

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
