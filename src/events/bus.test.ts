import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBus, getBus, disposeBus, scheduleDisposeIfUnwatched } from './bus';

afterEach(() => { vi.useRealTimers(); });

describe('scheduleDisposeIfUnwatched (2026-10-26)', () => {
  it('구독자가 없으면 지연 뒤 폐기', () => {
    vi.useFakeTimers();
    createBus('r1');
    scheduleDisposeIfUnwatched('r1', 1000);
    expect(getBus('r1')).toBeDefined();
    vi.advanceTimersByTime(1000);
    expect(getBus('r1')).toBeUndefined();
  });
  it('구독자가 붙어 있으면 건드리지 않는다', () => {
    vi.useFakeTimers();
    const b = createBus('r2');
    const unsub = b.subscribe(() => {});
    scheduleDisposeIfUnwatched('r2', 1000);
    vi.advanceTimersByTime(1000);
    expect(getBus('r2')).toBeDefined();
    unsub(); disposeBus('r2');
  });
  it('disposeBus 는 멱등이고 예약 타이머를 취소한다', () => {
    vi.useFakeTimers();
    createBus('r3');
    scheduleDisposeIfUnwatched('r3', 1000);
    disposeBus('r3'); disposeBus('r3');
    const again = createBus('r3'); // 같은 id 재생성 — 취소된 타이머가 새 버스를 지우면 안 된다
    vi.advanceTimersByTime(2000);
    expect(getBus('r3')).toBe(again);
    disposeBus('r3');
  });
});
