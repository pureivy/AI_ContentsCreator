/**
 * 외부 프로세스·중첩 Claude Code 실행 공용(2026-10-22 shortsDirectMotion 에서 떼어 냄 — 롱폼 장면 단계도 같이 쓴다).
 * B 와 같은 규약: 비동기·프로세스 그룹 종료·EPIPE 가드. 종료 시 살아 있는 자식 그룹을 정리한다.
 */
import { spawn } from 'node:child_process';

export interface ProcResult { code: number; stdout: string; stderr: string; aborted: boolean }
const liveGroups = new Set<number>();
let exitHooked = false;
/** 종료 시 자식 그룹 정리 — 첫 실행 때만 건다(테스트가 이 모듈을 import 해도 신호 처리기가 붙지 않게). */
function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  const killAll = (): void => { for (const pid of liveGroups) { try { process.kill(-pid, 'SIGKILL'); } catch { /* 이미 종료 */ } } liveGroups.clear(); };
  process.once('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => { killAll(); process.kill(process.pid, sig); });
}

/** signal 이 오면(취소) 시간 초과와 같이 그룹을 죽이고 aborted=true 로 끝난다. */
export function runProc(cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; stdin?: string; onStdout?: (d: Buffer) => void; signal?: AbortSignal }): Promise<ProcResult> {
  hookExit();
  return new Promise((resolve) => {
    let stdout = ''; let stderr = ''; let done = false; let aborted = false;
    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const pid = child.pid;
    if (pid) liveGroups.add(pid);
    const kill = () => { try { if (pid) process.kill(-pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* 이미 종료 */ } } };
    const timer = setTimeout(() => { aborted = true; kill(); }, o.timeoutMs);
    const onAbort = () => { aborted = true; kill(); };
    if (o.signal?.aborted) onAbort();
    else o.signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (code: number) => {
      if (done) return; done = true; clearTimeout(timer); if (exitTimer) clearTimeout(exitTimer);
      o.signal?.removeEventListener('abort', onAbort);
      if (pid) liveGroups.delete(pid);
      resolve({ code, stdout, stderr: stderr.slice(-2000), aborted });
    };
    child.on('error', (e) => { stderr += e.message; finish(-1); });
    child.stdin.on('error', () => { /* EPIPE 무해 */ });
    child.stdout.on('data', (d: Buffer) => { if (o.onStdout) o.onStdout(d); else stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
    child.on('exit', (c) => { exitTimer = setTimeout(() => { kill(); finish(c ?? 1); }, 5_000); });
    child.on('close', (c) => finish(c ?? 1));
    child.stdin.end(o.stdin ?? '');
  });
}

export function lastJson<T>(s: string): T | null {
  try { return JSON.parse(s.trim().split('\n').pop() || 'null') as T; } catch { return null; }
}

/** 중첩 Claude Code 실행 환경 — 구독 로그인 강제(API 키 제거) + 바깥 세션 표식 제거(B 규약 + 이 세션 실측). */
export function agentEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT') continue;
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN' || k === 'ANTHROPIC_PROFILE') continue;
    env[k] = v;
  }
  return env;
}

/** stream-json 로그(agent.jsonl)의 마지막 result 줄 — 턴·시간·비용. */
export type AgentResultLine = { type?: string; result?: string; num_turns?: number; duration_ms?: number; total_cost_usd?: number };
export function agentResultOf(jsonl: string): AgentResultLine | null {
  const lines = jsonl.trim().split('\n');
  for (let k = lines.length - 1; k >= 0; k--) { try { const j = JSON.parse(lines[k]!) as AgentResultLine; if (j.type === 'result') return j; } catch { /* 잡음 */ } }
  return null;
}
