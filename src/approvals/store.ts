/**
 * 승인 라이프사이클 — 위험 행동을 휴먼 게이트로 막는다(GEPA 거버넌스 패리티).
 *
 * pending → (사용자 결정 | 타임아웃) → history. 블로킹 런은 request() 의 promise 를 await 한다.
 * 타임아웃은 fail-open(자동 승인) — 백그라운드 런이 무한 대기하지 않게. 기록엔 '사람 승인 아님'을 분명히 남긴다.
 * 런 취소(abort)는 cancel() 로 'cancelled' 정산 — 종전엔 정산이 안 돼 나중에 타이머가 '타임아웃 자동승인'으로 적었다(2026-10-26).
 * 영속화: approvalsDir/{pending,history}/<id>.json (단일 사용자 로컬).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { genId } from '../util/ids';
import { readJsonFile } from '../util/jsonStore';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Approval {
  id: string;
  agent_id?: string;
  action_type: string; // publish | delete | deploy | send | ...
  summary: string;
  autonomy: number;
  created_ts: string;
  status: ApprovalStatus;
  decided_by?: string; // user | timeout | system
  note?: string;
  decided_ts?: string;
}

export interface Decision {
  approved: boolean;
  by: string;
  note: string;
}

type Waiter = (d: Decision) => void;

/** 타임아웃 기록 문구 — 사람이 승인한 것처럼 읽히지 않게(2026-10-26). 정책(fail-open)은 그대로. */
export const TIMEOUT_NOTE = '사람 응답 없음 — 타임아웃 자동승인(fail-open, 사람 승인 아님)';
/** 타임아웃을 거부로 받는 행동(blog_publish)의 기록 문구 — 종전엔 기록은 '자동승인'인데 실제론 거부돼 서로 달랐다. */
export const TIMEOUT_REJECT_NOTE = '사람 응답 없음 — 타임아웃 거부(fail-closed)';

function nowIso(): string {
  return new Date().toISOString();
}

export class ApprovalStore {
  private pending = new Map<string, Approval>();
  private waiters = new Map<string, Waiter>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingDir: string;
  private readonly historyDir: string;

  constructor(dir: string = CONFIG.approvalsDir) {
    this.pendingDir = path.join(dir, 'pending');
    this.historyDir = path.join(dir, 'history');
    fs.mkdirSync(this.pendingDir, { recursive: true });
    fs.mkdirSync(this.historyDir, { recursive: true });
    this.load();
  }

  private load(): void {
    let files: string[] = [];
    try { files = fs.readdirSync(this.pendingDir); } catch { return; /* 신규 */ }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      // 파일 하나가 깨져도 나머지는 읽는다(2026-10-26) — 종전엔 한 파일 파싱 실패가 루프 전체를 끊었다.
      // 깨진 파일은 .corrupt-<시각> 으로 옮겨(.json 이 아니라 다시 안 읽힘) 증거로 남긴다.
      const r = readJsonFile<Approval>(path.join(this.pendingDir, f), `승인 대기(${f})`, (v) => !!v && typeof v === 'object' && typeof (v as Approval).id === 'string');
      if (r.value) this.pending.set(r.value.id, r.value);
    }
  }

  private writePending(a: Approval): void {
    // tmp+rename — 쓰는 도중 죽어도 반쪽 JSON 이 .json 으로 남아 load() 가 깨진 파일로 보지 않게(2026-10-26)
    const f = path.join(this.pendingDir, `${a.id}.json`);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(a, null, 2), 'utf-8');
    fs.renameSync(tmp, f);
  }

  private settle(id: string, d: Decision, status?: ApprovalStatus): boolean {
    const a = this.pending.get(id);
    if (!a) return false;
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    a.status = status ?? (d.approved ? 'approved' : 'rejected');
    a.decided_by = d.by;
    a.note = d.note;
    a.decided_ts = nowIso();
    try {
      fs.writeFileSync(path.join(this.historyDir, `${a.id}.json`), JSON.stringify(a, null, 2), 'utf-8');
      fs.rmSync(path.join(this.pendingDir, `${a.id}.json`), { force: true });
    } catch { /* 영속 실패 무해 */ }
    this.pending.delete(id);
    const w = this.waiters.get(id);
    this.waiters.delete(id);
    if (w) w(d);
    return true;
  }

  /** 승인 요청 생성 + 결정 대기 promise. 타임아웃 시 fail-open 자동승인. */
  request(
    req: { agent_id?: string; action_type: string; summary: string; autonomy?: number },
    timeoutMs: number = CONFIG.approvalTimeoutS * 1000,
    /** false 면 타임아웃을 거부로 정산(호출부가 fail-closed 로 쓰는 행동 — 기록과 실제 결과를 맞춘다). 기본 true(fail-open). */
    timeoutApproves = true,
  ): { approval: Approval; decided: Promise<Decision> } {
    const approval: Approval = {
      id: genId('apr'),
      agent_id: req.agent_id,
      action_type: req.action_type,
      summary: req.summary,
      autonomy: req.autonomy ?? CONFIG.defaultAutonomy,
      created_ts: nowIso(),
      status: 'pending',
    };
    this.pending.set(approval.id, approval);
    this.writePending(approval);

    const decided = new Promise<Decision>((resolve) => {
      this.waiters.set(approval.id, resolve);
      const t = setTimeout(
        () => this.settle(approval.id, timeoutApproves
          ? { approved: true, by: 'timeout', note: TIMEOUT_NOTE }
          : { approved: false, by: 'timeout', note: TIMEOUT_REJECT_NOTE }),
        timeoutMs,
      );
      if (typeof t.unref === 'function') t.unref();
      this.timers.set(approval.id, t);
    });
    return { approval, decided };
  }

  /** 런 취소로 더는 기다리지 않는 승인 — 'cancelled' 로 정산(거부와 같은 효과, 기록만 정직하게). 이미 결정됐으면 false. */
  cancel(id: string, note = '런 취소됨'): boolean {
    return this.settle(id, { approved: false, by: 'abort', note }, 'cancelled');
  }

  /** API/사용자 결정. */
  decide(id: string, approved: boolean, note = '', by = 'user'): boolean {
    return this.settle(id, { approved, by, note });
  }

  list(): Approval[] {
    return [...this.pending.values()].sort((a, b) => a.created_ts.localeCompare(b.created_ts));
  }
}

let _store: ApprovalStore | null = null;
export function approvalStore(): ApprovalStore {
  if (!_store) _store = new ApprovalStore();
  return _store;
}
