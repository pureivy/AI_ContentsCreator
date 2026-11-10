/**
 * SHORT_marker 호출(2026-11-05, 웹툰 숏폼 1단계) — 명령줄 + 마지막 줄 JSON 계약(SHORT_marker pipeline/result.py).
 * 프로세스 그룹 종료·종료 시 정리는 cliProc.runProc 그대로(서버 재시작 때 ComfyUI 를 두드리는 고아 프로세스가 남지 않게).
 *
 * 종료 코드: 0 성공 · 1 기타 · 2 ComfyUI 연결 불가 · 3 규칙 검사 실패 남음 · 4 시간 초과 · 5 다른 작업이 Mac Studio 잠금 중
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { cliSearchPath } from '../llm/claudeCli';
import { runProc, sceneAgentEnv } from '../orchestrator/cliProc';

export interface SmResult {
  ok: boolean; code: number; stage?: string; id?: string; error?: string;
  shotlist?: string; errors?: number; scenes?: number; i2v?: number;
  mp4?: string | null; duration_sec?: number; wall_sec?: number;
  images?: Record<string, string>;
}

export const SM_EXIT_TEXT: Record<number, string> = {
  1: '오류', 2: 'ComfyUI(Mac Studio) 연결 불가', 3: '장면 목록 규칙 검사 실패', 4: '시간 초과', 5: '다른 웹툰 작업이 Mac Studio 를 쓰는 중',
};

/** 마지막 JSON 결과 줄(순수) — 출력 끝쪽에서 code 를 가진 첫 JSON 줄. 없으면 null. */
export function parseSmResult(stdout: string): SmResult | null {
  const lines = stdout.trim().split('\n');
  for (let k = lines.length - 1; k >= Math.max(0, lines.length - 20); k--) {
    const t = lines[k]!.trim();
    if (!t.startsWith('{')) continue;
    try { const j = JSON.parse(t) as SmResult; if (typeof j.code === 'number') return j; } catch { /* 잡음 */ }
  }
  return null;
}

/** 진행 로그로 보일 줄인가(순수) — Remotion 진행 줄·경고 잡음은 뺀다. */
export function isProgressLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('{')) return false;
  if (/^(Encoded|Rendered|Bundl|Getting composition|Composition|Codec|Output|Concurrency|\[Tab \d)/.test(t)) return false;
  return /^\[\d\d:\d\d:\d\d\]|^round \d|^wrote |^ERROR/.test(t);
}

export function shortMarkerReady(dir = CONFIG.shortMarkerDir): string | null {
  if (!fs.existsSync(path.join(dir, 'pipeline', 'produce.py'))) return `SHORT_marker 를 찾을 수 없습니다(${dir}) — SHORT_MARKER_DIR 확인`;
  return null;
}

export function projectDir(project: string, dir = CONFIG.shortMarkerDir): string { return path.join(dir, 'projects', project); }

async function runSm(mod: string, args: string[], o: { signal?: AbortSignal; onLine?: (l: string) => void }): Promise<SmResult> {
  const dir = CONFIG.shortMarkerDir;
  const bad = shortMarkerReady(dir);
  if (bad) return { ok: false, code: 1, error: bad };
  let buf = ''; let all = '';
  const r = await runProc('python3', ['-m', `pipeline.${mod}`, ...args, '--json'], {
    cwd: dir, timeoutMs: CONFIG.webtoonTimeoutMin * 60_000,
    // 허용 목록 환경(롱폼 장면 세션과 같은 규약) — .env 의 텔레그램·네이버·유튜브 토큰을 SHORT_marker 와 그 claude -p 에 넘기지 않는다.
    // claude 구독 로그인은 HOME·USER(키체인)로 찾는다. 런처 축소 PATH 는 보강한다.
    env: { ...sceneAgentEnv(process.env), PATH: cliSearchPath(), PYTHONUNBUFFERED: '1', ...(process.env.COMFY_HOST ? { COMFY_HOST: process.env.COMFY_HOST } : {}) },
    ...(o.signal ? { signal: o.signal } : {}),
    onStdout: (d) => {
      const s = d.toString(); all = (all + s).slice(-200_000); buf += s;
      const parts = buf.split('\n'); buf = (parts.pop() ?? '').slice(-4000); // 줄바꿈 없는 진행 줄(\r)이 끝없이 쌓이지 않게
      for (const l of parts) if (o.onLine && isProgressLine(l)) o.onLine(l.trim().slice(0, 200));
    },
  });
  const res = parseSmResult(all);
  if (r.aborted) return { ok: false, code: o.signal?.aborted ? 1 : 4, error: o.signal?.aborted ? '취소됨' : `시간 초과(${CONFIG.webtoonTimeoutMin}분)` };
  if (res) return res;
  return { ok: false, code: r.code || 1, error: `결과 줄 없음(exit ${r.code}) ${r.stderr.slice(-300)}` };
}

/** 장면 목록 쓰기 — 원문 블로그를 파일로 넘긴다(SHORT_marker 가 원문 사실만 쓰게).
 *  장면 영상은 기본으로 모든 장면(사장님 2026-11-05) — maxI2v 를 줄 때만 상한을 건다. */
export function writeShotlist(a: { topic: string; project: string; sourceFile: string; scenes?: number; maxI2v?: number; force?: boolean; signal?: AbortSignal; onLine?: (l: string) => void }): Promise<SmResult> {
  // 12장면(2026-11-10 사장님 — 참고 쇼츠처럼 속도감: 장면당 약 2.5초, 낭독 짧게). 종전 9.
  const args = [a.topic, '--id', a.project, '--source', a.sourceFile, '--scenes', String(a.scenes ?? 12)];
  if (a.maxI2v !== undefined) args.push('--max-i2v', String(a.maxI2v));
  if (a.force) args.push('--force');
  return runSm('write_shotlist', args, { ...(a.signal ? { signal: a.signal } : {}), ...(a.onLine ? { onLine: a.onLine } : {}) });
}

/** 그림만(검토용) 또는 전체(TTS·BGM·핵심 장면 영상·렌더). 캐시 덕분에 다시 부르면 바뀐 것만 만든다. */
export function produce(a: { project: string; imagesOnly?: boolean; refsOnly?: boolean; signal?: AbortSignal; onLine?: (l: string) => void }): Promise<SmResult> {
  const args = [path.join('projects', a.project, 'shotlist.json')];
  if (a.imagesOnly) args.push('--images-only');
  if (a.refsOnly) args.push('--refs-only'); // 참조 그림만(2026-11-10 — 장면보다 먼저 검수)
  return runSm('produce', args, { ...(a.signal ? { signal: a.signal } : {}), ...(a.onLine ? { onLine: a.onLine } : {}) });
}
