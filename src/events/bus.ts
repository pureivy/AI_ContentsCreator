/**
 * 이벤트 버스 — 런 단위. seq 단조증가, 리플레이 버퍼(Last-Event-ID 재개), 라이브 구독(SSE).
 * 토큰 델타(agent_thinking/synthesis_chunk)는 coalesce 윈도우로 합쳐 프론트 부하를 줄인다.
 */
import { CONFIG } from '../config';
import { EventType, SCHEMA_VERSION } from './types';
import type { EventEnvelope, EventTypeName } from './types';

type Listener = (ev: EventEnvelope) => void;

interface EmitMeta {
  agentId?: string;
  parentId?: string;
}

/** ISO 타임스탬프 — 단조성 보장은 seq 가 담당하므로 ts 는 표시용. */
function nowIso(): string {
  return new Date().toISOString();
}

export class EventBus {
  private seq = 0;
  private readonly buffer: EventEnvelope[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly maxBuffer: number;

  // 델타 coalescing 상태: block_id → 누적 텍스트 + flush 타이머
  private readonly pending = new Map<string, { type: EventTypeName; text: string; meta: EmitMeta; timer: NodeJS.Timeout }>();

  constructor(
    readonly runId: string,
    maxBuffer = 10_000,
  ) {
    this.maxBuffer = maxBuffer;
  }

  /** 일반 이벤트 emit. seq/ts/v 를 버스가 찍는다. */
  emit(type: EventTypeName, payload: Record<string, unknown> = {}, meta: EmitMeta = {}): EventEnvelope {
    const ev: EventEnvelope = {
      v: SCHEMA_VERSION,
      type,
      run_id: this.runId,
      seq: ++this.seq,
      ts: nowIso(),
      ...(meta.agentId ? { agent_id: meta.agentId } : {}),
      ...(meta.parentId ? { parent_id: meta.parentId } : {}),
      payload,
    };
    this.buffer.push(ev);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        /* 구독자 예외가 emit 을 막지 않게 */
      }
    }
    return ev;
  }

  /**
   * 토큰 델타 emit — coalesce 윈도우(CONFIG.tokenCoalesceMs) 동안 같은 block_id 의 델타를 모아
   * 한 이벤트로 flush. 윈도우 0이면 즉시 emit.
   */
  emitDelta(type: 'agent_thinking' | 'synthesis_chunk', blockId: string, delta: string, meta: EmitMeta = {}): void {
    if (CONFIG.tokenCoalesceMs <= 0) {
      this.emit(EventType[type], { block_id: blockId, delta }, meta);
      return;
    }
    const cur = this.pending.get(blockId);
    if (cur) {
      cur.text += delta;
      return;
    }
    const timer = setTimeout(() => this.flushDelta(blockId), CONFIG.tokenCoalesceMs);
    // Node 타이머가 프로세스 종료를 막지 않게
    if (typeof timer.unref === 'function') timer.unref();
    this.pending.set(blockId, { type: EventType[type], text: delta, meta, timer });
  }

  private flushDelta(blockId: string): void {
    const cur = this.pending.get(blockId);
    if (!cur) return;
    this.pending.delete(blockId);
    clearTimeout(cur.timer);
    if (cur.text) this.emit(cur.type, { block_id: blockId, delta: cur.text }, cur.meta);
  }

  /** 남은 델타를 즉시 비운다(메시지 완료/런 종료 시 호출). */
  flushAll(): void {
    for (const id of [...this.pending.keys()]) this.flushDelta(id);
  }

  /** fromSeq 이후의 버퍼를 반환(재개용). */
  replay(fromSeq = 0): EventEnvelope[] {
    return this.buffer.filter((e) => e.seq > fromSeq);
  }

  /** 라이브 구독. unsubscribe 함수를 반환. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  get currentSeq(): number {
    return this.seq;
  }
}

/** 런별 EventBus 레지스트리 — 서버가 SSE 핸들러에서 조회. */
const _buses = new Map<string, EventBus>();

export function createBus(runId: string): EventBus {
  const bus = new EventBus(runId);
  _buses.set(runId, bus);
  return bus;
}

export function getBus(runId: string): EventBus | undefined {
  return _buses.get(runId);
}

/** 멱등 — 이미 없거나 두 번 불려도 안전. 대기 중인 지연 폐기 타이머도 함께 취소한다. */
export function disposeBus(runId: string): void {
  const t = _disposeTimers.get(runId);
  if (t) { clearTimeout(t); _disposeTimers.delete(runId); }
  _buses.get(runId)?.flushAll();
  _buses.delete(runId);
}

const _disposeTimers = new Map<string, NodeJS.Timeout>();

/**
 * 런 종료 뒤 구독자(SSE)가 없으면 delayMs 후 버스를 폐기한다(2026-10-26).
 * SSE 를 안 보는 런(자동 런·텔레그램)의 버스가 이벤트 최대 1만 개를 프로세스 종료까지 쥐고 있었다.
 * 지연 시점에 구독자가 붙어 있으면 건드리지 않는다(SSE 끊김 타이머가 따로 폐기). 같은 runId 를 다시 걸면 이전 예약은 교체.
 */
export function scheduleDisposeIfUnwatched(runId: string, delayMs: number): void {
  const prev = _disposeTimers.get(runId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    _disposeTimers.delete(runId);
    const bus = _buses.get(runId);
    if (bus && bus.listenerCount === 0) disposeBus(runId);
  }, Math.max(0, delayMs));
  if (typeof timer.unref === 'function') timer.unref();
  _disposeTimers.set(runId, timer);
}
