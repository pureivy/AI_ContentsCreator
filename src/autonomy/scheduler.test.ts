import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startAutoCycle, startDaily } from './scheduler';

describe('startAutoCycle (유휴 게이트 자율 사이클)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('intervalMs<=0 이면 no-op (스케줄조차 안 함)', () => {
    const launch = vi.fn();
    const stop = startAutoCycle({ intervalMs: 0, isBusy: () => false, proposeTask: async () => 'x', launch });
    vi.advanceTimersByTime(60_000);
    expect(launch).not.toHaveBeenCalled();
    stop();
  });

  it('사용자 런 진행 중이면 제안·실행하지 않는다(양보)', async () => {
    const launch = vi.fn();
    const proposeTask = vi.fn(async () => 'task');
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => true, proposeTask, launch });
    await vi.advanceTimersByTimeAsync(1000);
    expect(proposeTask).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    stop();
  });

  it('유휴 + 제안 있으면 그 주제로 launch', async () => {
    const launch = vi.fn();
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => false, proposeTask: async () => '신규 자율 작업', launch });
    await vi.advanceTimersByTimeAsync(1000);
    expect(launch).toHaveBeenCalledWith('신규 자율 작업');
    stop();
  });

  it('제안이 null/빈값이면 launch 안 함', async () => {
    const launch = vi.fn();
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => false, proposeTask: async () => null, launch });
    await vi.advanceTimersByTimeAsync(1000);
    expect(launch).not.toHaveBeenCalled();
    stop();
  });

  it('이전 tick 미완(느린 proposeTask) 중 다음 tick 은 재진입하지 않는다', async () => {
    let resolveProposal: (v: string | null) => void = () => {};
    const proposeTask = vi.fn(() => new Promise<string | null>((r) => { resolveProposal = r; }));
    const launch = vi.fn();
    const stop = startAutoCycle({ intervalMs: 1000, isBusy: () => false, proposeTask, launch, log: () => {} });
    await vi.advanceTimersByTimeAsync(1000); // tick1 시작 → proposeTask await 에서 멈춤
    await vi.advanceTimersByTimeAsync(1000); // tick2 발화하나 ticking 가드로 차단
    expect(proposeTask).toHaveBeenCalledTimes(1); // 재진입 안 함
    resolveProposal('작업');
    await vi.advanceTimersByTimeAsync(0);
    expect(launch).toHaveBeenCalledTimes(1);
    stop();
  });

  it('proposeTask 가 throw 해도 죽지 않는다(다음 틱 지속)', async () => {
    const launch = vi.fn();
    const stop = startAutoCycle({
      intervalMs: 1000, isBusy: () => false,
      proposeTask: async () => { throw new Error('boom'); }, launch,
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
