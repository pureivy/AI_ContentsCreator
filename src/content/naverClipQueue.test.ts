import { describe, it, expect } from 'vitest';
import { planClipQueue, CLIP_QUEUE_MAX_WAIT_MS } from './naverClipQueue';

describe('planClipQueue — 프로필이 바쁠 때 누른 클립 업로드 대기열(순수)', () => {
  const now = 1_000_000_000;
  const q = [
    { id: 'b', queuedAt: now - 60_000, force: false },
    { id: 'a', queuedAt: now - 120_000, force: true },
  ];
  it('바쁘면 아무것도 꺼내지 않는다', () => {
    const r = planClipQueue(q, now, true);
    expect(r.start).toBeUndefined();
    expect(r.rest.map((e) => e.id)).toEqual(['a', 'b']);
  });
  it('프로필이 비면 먼저 누른 하나만 꺼낸다', () => {
    const r = planClipQueue(q, now, false);
    expect(r.start?.id).toBe('a');
    expect(r.start?.force).toBe(true);
    expect(r.rest.map((e) => e.id)).toEqual(['b']);
  });
  it('상한을 넘겨 기다린 건 버린다 — 바빠도, 비어도', () => {
    const old = [{ id: 'x', queuedAt: now - CLIP_QUEUE_MAX_WAIT_MS - 1, force: false }, ...q];
    expect(planClipQueue(old, now, true).expired.map((e) => e.id)).toEqual(['x']);
    const r = planClipQueue(old, now, false);
    expect(r.expired.map((e) => e.id)).toEqual(['x']);
    expect(r.start?.id).toBe('a');
  });
  it('빈 대기열은 할 일 없음', () => {
    expect(planClipQueue([], now, false)).toEqual({ expired: [], rest: [] });
  });
});
