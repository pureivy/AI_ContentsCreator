/**
 * 장면 파일 검사(부작용 있음) — 빠른 검사(sceneLint) + 타입 검사(tsc, remotion tsconfig 와 같은 옵션).
 * 에이전트의 ./check.sh(파일 하나)와 파이프라인 사후 검사(여러 파일 한 번에 — 파일당 수 초라 95개를 따로 돌리면 몇 분)가 같이 쓴다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runProc } from '../orchestrator/cliProc';
import { lintScene } from './sceneLint';
import type { SceneJob } from './sceneJob';

/** remotion/tsconfig.json 과 같은 옵션 — 파일 인자를 주면 -p 를 못 쓰므로 풀어 적는다. 글꼴 import 선언(.d.ts)도 함께 넘긴다. */
export function tscArgs(files: readonly string[], repo: string): string[] {
  return [
    '--noEmit', '--pretty', 'false', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
    '--jsx', 'react-jsx', '--strict', '--skipLibCheck', '--esModuleInterop', '--types', 'node',
    path.join(repo, 'remotion', 'assets.d.ts'), path.join(repo, 'remotion', 'longform', 'assets.d.ts'),
    ...files,
  ];
}

/** tsc 출력(순수) → 파일별 오류. 후보 파일 밖(키트 등)에서 난 오류는 '' 키에 모은다. */
export function parseTscOutput(out: string, files: readonly string[], cwd: string): Map<string, string[]> {
  const res = new Map<string, string[]>(files.map((f) => [path.resolve(f), []]));
  res.set('', []);
  for (const line of out.split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line.trim());
    if (!m) continue;
    const abs = path.resolve(cwd, m[1]!);
    const msg = `${path.basename(abs)}:${m[2]} ${m[4]} ${m[5]}`;
    (res.get(abs) ?? res.get(''))!.push(msg);
  }
  return res;
}

/** 타입 검사 — 파일별 오류(빈 배열 = 통과). tsc 가 아예 못 돌면 모든 파일에 그 사유. */
export async function typecheckScenes(files: readonly string[], repo: string, o: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Map<string, string[]>> {
  if (!files.length) return new Map();
  const tsc = path.join(repo, 'node_modules', '.bin', 'tsc');
  const r = await runProc(tsc, tscArgs(files, repo), { cwd: repo, timeoutMs: o.timeoutMs ?? 5 * 60_000, ...(o.signal ? { signal: o.signal } : {}) });
  const res = parseTscOutput(r.stdout, files, repo);
  const counted = [...res.values()].reduce((n, v) => n + v.length, 0);
  if (r.aborted || (r.code !== 0 && counted === 0)) {
    const why = r.aborted ? 'tsc 시간 초과·취소' : `tsc 실패: ${(r.stderr || r.stdout).slice(-200)}`;
    for (const f of files) res.set(path.resolve(f), [why]);
  }
  return res;
}

/** 파일 하나 검사(빠른 검사 → 타입 검사). 빠른 검사가 실패해도 타입 검사는 돌린다(한 번에 다 보여 준다). */
export async function checkSceneFile(file: string, key: string, sentence: string, repo: string, o: { signal?: AbortSignal } = {}): Promise<string[]> {
  if (!fs.existsSync(file)) return [`파일 없음: ${path.basename(file)}`];
  const lint = lintScene(fs.readFileSync(file, 'utf8'), key, sentence);
  const tc = await typecheckScenes([file], repo, o);
  return [...lint, ...(tc.get(path.resolve(file)) ?? [])];
}

/** 에이전트 검사 한 장면(./check.sh) — 키는 job 에 있는 것만(경로를 인자로 받지 않는다). */
export async function checkScene(job: SceneJob, key: string): Promise<{ ok: boolean; key: string; problems: string[] }> {
  const sc = job.scenes.find((s) => s.key === key);
  if (!sc) return { ok: false, key, problems: [`이 묶음에 없는 장면 키: ${key} (${job.scenes.map((s) => s.key).join(', ')})`] };
  const problems = await checkSceneFile(path.join(job.workDir, sc.file), key, sc.narration, job.repo);
  return { ok: !problems.length, key, problems };
}
