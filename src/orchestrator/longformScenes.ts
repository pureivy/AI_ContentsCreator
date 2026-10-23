/**
 * 롱폼 문장 그림 장면 단계(2026-10-22 사장님 결정 — 모든 문장에 모션그래픽). produce() 의 buildScenes 자리.
 *
 * 흐름:
 *  1) 세그먼트 → 장면 명세(sceneJob.sceneSpecs) → 장 경계 안에서 최대 8개씩 묶음(planBatches).
 *  2) 묶음마다 Claude Code 세션 하나(동시 LONGFORM_SCENE_CONCURRENCY=3, 모델 cloudTierModels.heavy). cwd = scenes/work/bNN.
 *     에이전트는 sNNN.tsx 를 쓰고 ./check.sh(빠른 검사+타입 검사) → ./preview.sh(스틸 세 장을 붙인 PNG)를 Read 해 고친다.
 *     보안(숏폼 직접 제작과 같은 규약): 하네스가 읽는 job 은 작업 폴더 밖(bNN.job.json, 읽기 전용), 작업 폴더의 job.json·check.sh·
 *     preview.sh·_kit.ts 는 읽기 전용 사본이고 끝난 뒤 변조를 확인한다(변조면 그 묶음 장면을 버린다).
 *  3) 에이전트를 믿지 않는다 — 장면 파일을 scenes/ 로 옮긴 뒤 다시 검사(빠른 검사 → tsc 한 번에) → 등록표·진입점 →
 *     'Scene' 컴포지션으로 20·55·90% 스틸(던지면 탈락) → 최종 등록표. 탈락·누락 장면은 장면 없이(실촬영+자막) — report.json 에 사유.
 *  4) 55% 스틸 바둑판(scenes/contact.jpg — 사장님 검토용, 텔레그램 둘째 사진) · timeline.json·script.json 에 scene 키.
 * 비용: CLI 가 보고한 total_cost_usd 합. 상한(LONGFORM_SCENE_BUDGET_USD)을 넘으면 새 묶음을 띄우지 않는다(남은 장면은 폴백).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { agentEnv, agentResultOf, runProc } from './cliProc';
import { loadEpisodeScript, loadMediaVideos, saveEpisodeScript } from '../longform/episode';
import { lintScene } from '../longform/sceneLint';
import { typecheckScenes } from '../longform/sceneCheck';
import { KIT_SHIM, SCENE_DIR, episodeSpeciesModule, kitShimSource, kitShimSourceFull, writeEpisodeEntry, writeEpisodeEntryFull, writeIfChanged } from '../longform/sceneFiles';
import { fullExtra, fullLintOpts, fullPublicFiles, fullSpecs, insetSpecies, planInsets, scenePromptFull, zoneLeak, type FullMode } from '../longform/sceneFull';
import { kitForPresenter } from '../longform/presenter';
import { batchSpecies, loadSpeciesIndex, type SpeciesIndex } from '../longform/speciesPreset';
import type { RefPart } from '../longform/speciesCommons';
import { planBatches, scenePrompt, sceneSpecs, type SceneJob, type SceneSpec } from '../longform/sceneJob';
import { CONTACT_AT, PREVIEW_AT, frameAt, renderSceneStills, tileStills, type StillItem } from '../longform/scenePreview';
import type { Timeline, TimedSegment } from '../longform/timeline';

export interface AgentRunInput { batch: string; workDir: string; prompt: string; timeoutMs: number; maxTurns: number; signal?: AbortSignal }
export interface AgentRun { exit: number; aborted: boolean; turns?: number; costUsd?: number; durationSec: number; tail?: string }

export interface SceneDeps {
  repo: string;
  runAgent: (o: AgentRunInput) => Promise<AgentRun>;
  typecheck: (files: string[], signal?: AbortSignal) => Promise<Map<string, string[]>>;
  renderStills: typeof renderSceneStills;
  tile: typeof tileStills;
  /** 보관소 영상 id → 수종(왼쪽 화면 설명용). */
  mediaSpecies: (id: string) => string | undefined;
  concurrency: number;
  budgetUsd: number;
  maxTurns: number;
  batchTimeoutMs: number;
  log: (m: string) => void;
  /** 롱폼 디자이너(차민혁)의 기억·스킬 블록(2026-10-23) — 묶음 지시문 끝에 붙는다. 없으면 붙이지 않는다(테스트·스크립트). */
  designerBrief?: () => string;
  /** 디자이너 activity.log 한 줄(묶음마다). 없으면 남기지 않는다. */
  activity?: (line: string) => void;
  /** 완성 장면 검토(정하람, LONGFORM_REVIEW) — 다시 그릴 장면을 고르면 한 묶음(r01)으로 다시 그린다. 없으면 검토 없음. */
  review?: SceneReviewFn;
}

/** 검토에 넘기는 장면 하나 — 문장·장·55% 스틸(있으면)·화면 라벨(장면 파일의 const L… 상수, 글로 된 설명 폴백)·그 장면 수종(실물 대조용). */
export interface ReviewItem { key: string; narration: string; chapterTitle: string; still?: string; labels: string[]; species?: string[] }
export interface ReviewVerdict { redo: Array<{ key: string; reason: string }>; mode: 'vision' | 'text'; checked: number; note?: string }
/** refs = 수종 실물 대조용 사진(절대 경로, 전체 화면 수종 형태 단계가 뽑은 것) — 비전 검토가 장면 스틸과 같이 본다. */
/** 실물 대조용 사진 하나 — part 가 있으면 공개 도감 사진(Wikimedia Commons, 출처 기록됨), 없으면 우리 실촬영 프레임. */
export interface ReviewRef { nameKo: string; file: string; part?: RefPart }
export type SceneReviewFn = (o: { items: ReviewItem[]; title?: string; signal?: AbortSignal; refs?: ReviewRef[] }) => Promise<ReviewVerdict | null>;
/** 다시 그릴 장면 상한(한 묶음). */
export const REVIEW_MAX = 10;
/** scenes/review.json */
export interface ReviewRecord {
  at: string; checked: number; mode?: 'vision' | 'text'; note?: string; skipped?: string;
  redo: Array<{ key: string; reason: string; result: 'redone' | 'kept' ; why?: string }>;
  costUsd?: number; durationSec?: number;
}

export interface ScenesResult { built: number; costUsd: number; entryPoint?: string; contact?: string; review?: { redo: number; redone: number; skipped?: string } }
/** 전체 화면 장면 옵션(2026-10-23 견본, 옵트인) — 없으면 종전 장면 단계 그대로. chapterTotal = 장 번호 분모(편 일부면 원래 장 수). */
export type SceneStageMode = FullMode & { chapterTotal?: number };
export interface SceneReport {
  built: number; total: number; costUsd: number;
  failed: Array<{ key: string; reason: string }>;
  perBatch: Record<string, { keys: string[]; turns?: number; costUsd?: number; durationSec?: number; exit?: number; skipped?: string; tail?: string }>;
  /** 전체 화면 — 자막 띠·장 이름 자리 침범(55% 검사 스틸, 비율). */
  zone?: Record<string, { caption: number; chapter: number }>;
  /** 전체 화면 — 장마다 실촬영 지정 장면. */
  insetKeys?: string[];
  /** 전체 화면 — 끼움 카드가 하나도 없는 장과 사유(그 장·주인공 수종 영상 없음). */
  insetMissing?: Array<{ chapter: string; why: string }>;
  /** 전체 화면 — 다른 장 클립을 빌려 끼움 카드를 준 장면(세그먼트 id → 빌려 온 세그먼트 id). */
  insetBorrowed?: Record<string, string>;
}

/** 실제 Claude Code 세션(구독 로그인 환경) — stream-json 로그를 agent.jsonl 에 남기고 result 줄에서 턴·비용을 읽는다. */
async function claudeAgent(o: AgentRunInput): Promise<AgentRun> {
  const args = ['-p', '--model', CONFIG.cloudTierModels.heavy, '--setting-sources', '', '--no-session-persistence', '--max-turns', String(o.maxTurns),
    '--permission-mode', 'acceptEdits', '--disallowedTools', 'AskUserQuestion',
    '--allowedTools', 'Read,Write,Edit,Glob,Bash(./preview.sh:*),Bash(./check.sh:*)', '--output-format', 'stream-json', '--verbose'];
  const logFile = path.join(o.workDir, 'agent.jsonl');
  const agentLog = fs.createWriteStream(logFile);
  agentLog.on('error', () => { /* 로그만 잃는다 */ });
  const t0 = Date.now();
  const r = await runProc(CONFIG.claudeCliPath, args, { cwd: o.workDir, env: agentEnv(process.env), timeoutMs: o.timeoutMs, stdin: o.prompt, onStdout: (d) => agentLog.write(d), ...(o.signal ? { signal: o.signal } : {}) });
  await new Promise<void>((res) => agentLog.end(() => res()));
  const result = agentResultOf(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
  return {
    exit: r.code, aborted: r.aborted, durationSec: Math.round((Date.now() - t0) / 1000),
    ...(result?.num_turns != null ? { turns: result.num_turns } : {}), ...(result?.total_cost_usd != null ? { costUsd: result.total_cost_usd } : {}),
    tail: (result?.result ?? r.stderr.slice(-200)).split('\n').pop()?.slice(0, 300),
  };
}

export function defaultSceneDeps(): SceneDeps {
  const repo = path.resolve('.');
  let species: Map<string, string> | null = null;
  return {
    repo,
    runAgent: claudeAgent,
    typecheck: (files, signal) => typecheckScenes(files, repo, signal ? { signal } : {}),
    renderStills: renderSceneStills,
    tile: tileStills,
    mediaSpecies: (id) => {
      species ??= new Map(loadMediaVideos(CONFIG.dataDir).filter((m) => m.species).map((m) => [m.id, m.species!]));
      return species.get(id);
    },
    concurrency: CONFIG.longformSceneConcurrency,
    budgetUsd: CONFIG.longformSceneBudgetUsd,
    maxTurns: CONFIG.longformSceneMaxTurns,
    batchTimeoutMs: CONFIG.longformSceneTimeoutMin * 60_000,
    log: (m) => console.log('[롱폼 장면]', m),
  };
}

const sq = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;
/** 읽기 전용 쓰기 — 같은 폴더로 다시 돌 때 덮어쓰기가 막히므로 지우고 새로 쓴다. */
const writeRO = (p: string, data: string, mode = 0o444): void => {
  try { fs.unlinkSync(p); } catch { /* 없음 */ }
  fs.writeFileSync(p, data, { encoding: 'utf8', mode });
};

/** 하네스 셸(순수) — 작업 폴더 밖 job 을 쥐고 인자 하나(장면 키)만 넘긴다. 저장소에서 돈다(CONFIG·.env 가 cwd 기준이라). */
export function harnessScript(repo: string, script: string, jobPath: string): string {
  const tsx = path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return `#!/bin/bash\ncd ${sq(repo)} || exit 1\nexec ${sq(process.execPath)} ${sq(tsx)} ${sq(path.join(repo, 'scripts', 'longform', script))} ${sq(jobPath)} "$1"\n`;
}

/** 묶음 하나 — 작업 폴더 준비 → 세션 → 변조 확인 → 장면 파일을 scenes/ 로. 돌려주는 keys = 옮긴 장면. */
async function runBatch(name: string, specs: SceneSpec[], o: { sceneDir: string; kitApi: string; title?: string; deps: SceneDeps; signal?: AbortSignal; mode?: SceneStageMode; clipsDir?: string; note?: string; seed?: ReadonlyArray<{ file: string; content: string }>; species?: SceneJob['species'] }): Promise<{ moved: string[]; run?: AgentRun; problem?: string }> {
  const { deps } = o;
  const workRoot = path.join(o.sceneDir, 'work');
  const work = path.join(workRoot, name);
  const epDir = path.dirname(o.sceneDir);
  fs.rmSync(work, { recursive: true, force: true }); // 지난 실행의 장면이 남아 새 세션 결과로 섞이지 않게
  fs.mkdirSync(work, { recursive: true });
  const full = o.mode?.stage === 'full' ? o.mode : undefined;
  // 실물 대조용 사진 — 세션이 작업 폴더 밖을 읽지 않아도 되게 같은 상대 경로(refs/<수종>/NN.jpg)로 복사해 둔다.
  //   공개 도감 사진(ext)도 같은 식으로 — 작업 폴더 안에서만 읽힌다(미리보기 번들 public 은 .preview/public 이라 닿지 않는다).
  const copyIn = (rel: string) => { try { fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true }); fs.copyFileSync(path.join(epDir, rel), path.join(work, rel)); return true; } catch { return false; } };
  const species = (o.species ?? []).map((sp) => {
    const ext = (sp.ext ?? []).filter((x) => copyIn(x.file));
    const { ext: _drop, ...rest } = sp;
    return { ...rest, refs: sp.refs.filter(copyIn), ...(ext.length ? { ext } : {}) };
  });
  const job: SceneJob = { batch: Number(name.slice(1)), repo: deps.repo, workDir: work, fps: 30, scenes: specs, ...(full ? { stage: 'full' as const, style: full.style, ...(o.clipsDir ? { clipsDir: o.clipsDir } : {}), ...(species.length ? { species } : {}) } : {}) };
  const jobPath = path.join(workRoot, `${name}.job.json`);
  const jobText = JSON.stringify(job, null, 1);
  writeRO(jobPath, jobText);
  writeRO(path.join(work, 'job.json'), jobText);
  const speciesModule = full ? episodeSpeciesModule(epDir) : undefined;
  const speciesText = speciesModule ? fs.readFileSync(speciesModule, 'utf8') : undefined;
  const kit = full ? kitShimSourceFull(work, deps.repo, full.style, speciesModule) : kitShimSource(work, deps.repo);
  writeRO(path.join(work, KIT_SHIM), kit);
  const checkSh = harnessScript(deps.repo, full ? 'scene_check_full.ts' : 'scene_check.ts', jobPath);
  const previewSh = harnessScript(deps.repo, full ? 'scene_preview_full.ts' : 'scene_preview.ts', jobPath);
  writeRO(path.join(work, 'check.sh'), checkSh, 0o555);
  writeRO(path.join(work, 'preview.sh'), previewSh, 0o555);
  // 검토 뒤 다시 그리기 — 지금 장면 파일을 작업 폴더에 깔아 두면 에이전트가 지적만 고친다(처음부터 다시 그리지 않아도 된다).
  for (const f of o.seed ?? []) fs.writeFileSync(path.join(work, path.basename(f.file)), f.content);
  const base = full ? scenePromptFull(job, o.kitApi, o.title ? { episodeTitle: o.title } : {}) : scenePrompt(job, o.kitApi, o.title ? { episodeTitle: o.title } : {});
  // 디자이너 기억(사장님 검토 교훈)·검토 지적은 키트 문서 뒤 맨 끝에 — 지시문 함수(순수)는 그대로 두고 여기서만 덧붙인다.
  const brief = deps.designerBrief?.() ?? '';
  const prompt = [base, brief, o.note ?? ''].filter(Boolean).join('\n\n');
  fs.writeFileSync(path.join(work, 'agent-prompt.txt'), prompt);

  const run = await deps.runAgent({ batch: name, workDir: work, prompt, timeoutMs: deps.batchTimeoutMs, maxTurns: deps.maxTurns, ...(o.signal ? { signal: o.signal } : {}) });
  deps.log(`${name} 세션 끝 — exit ${run.exit}${run.aborted ? '(시간 초과·취소)' : ''} · 턴 ${run.turns ?? '?'} · $${(run.costUsd ?? 0).toFixed(2)} · ${run.durationSec}초`);
  const same = (f: string, want: string) => { try { return fs.readFileSync(path.join(work, f), 'utf8') === want; } catch { return false; } };
  const speciesTampered = !!speciesModule && (() => { try { return fs.readFileSync(speciesModule, 'utf8') !== speciesText; } catch { return true; } })();
  if (speciesTampered) writeIfChanged(speciesModule!, speciesText!); // 원래대로 — 다른 묶음 장면이 같은 파일을 쓴다
  if (!same('check.sh', checkSh) || !same('preview.sh', previewSh) || !same(KIT_SHIM, kit) || fs.readFileSync(jobPath, 'utf8') !== jobText || speciesTampered) {
    return { moved: [], run, problem: '하네스 파일 변조 감지 — 이 묶음 장면을 버림' };
  }
  const moved: string[] = [];
  for (const s of specs) {
    const src = path.join(work, s.file);
    if (!fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink()) continue;
    fs.copyFileSync(src, path.join(o.sceneDir, s.file));
    moved.push(s.key);
  }
  return { moved, run };
}

/** 장면 키를 timeline.json·script.json 세그먼트에 쓴다(없는 것은 지운다 — 다시 돌릴 때 낡은 키가 남지 않게). */
export function writeSceneKeys(dir: string, keyBySeg: ReadonlyMap<string, string>): void {
  const tlFile = path.join(dir, 'timeline.json');
  const tl = JSON.parse(fs.readFileSync(tlFile, 'utf8')) as Timeline;
  for (const s of tl.segments) { const k = keyBySeg.get(s.id); if (k) s.scene = k; else delete s.scene; }
  fs.writeFileSync(`${tlFile}.tmp`, JSON.stringify(tl, null, 2));
  fs.renameSync(`${tlFile}.tmp`, tlFile);
  if (!fs.existsSync(path.join(dir, 'script.json'))) return;
  const script = loadEpisodeScript(dir);
  for (const c of script.chapters) for (const g of c.segments) { const k = keyBySeg.get(g.id); if (k) g.scene = k; else delete g.scene; }
  saveEpisodeScript(dir, script);
}

/** 작은 풀 — 동시 n 개, 시작 전에 canStart 로 상한·취소를 본다. */
async function pool<T>(items: T[], n: number, canStart: () => string | null, run: (t: T, i: number) => Promise<void>, skip: (t: T, i: number, why: string) => void): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      const why = canStart();
      if (why) { skip(items[i]!, i, why); continue; }
      await run(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

export async function buildScenes(dir: string, segments: TimedSegment[], signal?: AbortSignal, over: Partial<SceneDeps> = {}, mode?: SceneStageMode): Promise<ScenesResult> {
  const full = mode?.stage === 'full' ? mode : undefined;
  const deps: SceneDeps = { ...defaultSceneDeps(), ...over };
  const sceneDir = path.join(dir, SCENE_DIR);
  fs.mkdirSync(sceneDir, { recursive: true });
  let title: string | undefined;
  const chSpecies: Record<string, string[]> = {};
  // 전체 화면 끼움 카드 수종(장 id → 수종) — 수종 없는 장은 편 주인공 수종(2026-10-23 사장님 결정). 대본이 없으면 장 수종 그대로.
  let insetCh: Record<string, string[]> = chSpecies;
  let chapterCount = new Set(segments.map((s) => s.chapter)).size;
  try {
    const script = loadEpisodeScript(dir);
    title = script.title;
    for (const c of script.chapters) chSpecies[c.id] = c.species ?? [];
    chapterCount = script.chapters.length;
    insetCh = insetSpecies(script);
  } catch { /* 대본 없음 — 수종 정보 없이 */ }
  const baseSpecs = sceneSpecs(segments, chSpecies, deps.mediaSpecies);
  const plan = full ? planInsets(segments, insetCh, deps.mediaSpecies) : undefined;
  const specs = full ? fullSpecs(baseSpecs, segments, insetCh, deps.mediaSpecies, full.chapterTotal ?? chapterCount, plan) : baseSpecs;
  const clipsDir = path.join(dir, 'clips');
  // 수종 형태 단계 결과(있으면) — 묶음마다 그 장 수종(없으면 주인공)의 프리셋 쓰는 법·실물 대조용 사진.
  const speciesIndex: SpeciesIndex | null = full ? loadSpeciesIndex(dir) : null;
  const chapterOfSeg = new Map(segments.map((s) => [s.id, s.chapter]));
  const speciesOfSpec = (sp: SceneSpec): string[] => insetCh[chapterOfSeg.get(sp.segId) ?? ''] ?? [];
  const speciesForBatch = (b: readonly SceneSpec[]) => (speciesIndex ? batchSpecies(speciesIndex, [...new Set(b.flatMap(speciesOfSpec))], undefined, b.map((s) => s.narration).join(' ')) : []);
  if (plan) {
    // 렌더(renderEpisodeFull)가 같은 배정을 쓰게 남긴다 — 빌려 온 클립까지.
    fs.writeFileSync(path.join(sceneDir, 'insets.json'), JSON.stringify(Object.fromEntries([...plan.footage].map(([k, f]) => [k, { src: f.src, startFrom: f.startFrom, durationInFrames: f.durationInFrames, species: f.species, ...(f.borrowed ? { borrowed: f.borrowed } : {}) }])), null, 2));
  }
  // 지난 실행의 장면 파일은 지운다(이번 세션이 다시 쓰지 않은 장면이 검사 없이 남지 않게).
  for (const s of specs) { try { fs.unlinkSync(path.join(sceneDir, s.file)); } catch { /* 없음 */ } }
  const batches = planBatches(specs);
  const kitApi = kitForPresenter(fs.readFileSync(full ? (full.kitApiPath ?? path.join(deps.repo, 'remotion', 'longform', 'fullscreen', `KIT_API_${full.style}.md`)) : path.join(deps.repo, 'remotion', 'longform', 'scenes', 'KIT_API.md'), 'utf8'),
    full?.presenter ? fs.readFileSync(path.join(deps.repo, 'remotion', 'longform', 'fullscreen', 'KIT_API_BIONEE.md'), 'utf8') : undefined);
  const borrowed = plan ? Object.fromEntries([...plan.footage].filter(([, f]) => f.borrowed).map(([k, f]) => [k, f.borrowed!])) : {};
  const report: SceneReport = {
    built: 0, total: specs.length, costUsd: 0, failed: [], perBatch: {},
    ...(full ? { zone: {}, insetKeys: specs.filter((s) => s.full?.insetRequired).map((s) => s.key), insetMissing: plan?.missing ?? [], ...(Object.keys(borrowed).length ? { insetBorrowed: borrowed } : {}) } : {}),
  };
  if (plan?.missing.length) deps.log(`끼움 카드 없는 장: ${plan.missing.map((m) => `${m.chapter}(${m.why})`).join(', ')}`);
  const fail = new Map<string, string>();
  const nameOf = (i: number) => `b${String(i + 1).padStart(2, '0')}`;
  deps.log(`장면 ${specs.length}개 · 묶음 ${batches.length}개 · 동시 ${deps.concurrency} · 상한 $${deps.budgetUsd}`);

  await pool(batches, deps.concurrency,
    () => (signal?.aborted ? '취소됨' : report.costUsd >= deps.budgetUsd ? `비용 상한 $${deps.budgetUsd} 도달` : null),
    async (b, i) => {
      const name = nameOf(i);
      try {
        const r = await runBatch(name, b, { sceneDir, kitApi, ...(title ? { title } : {}), deps, ...(signal ? { signal } : {}), ...(full ? { mode: full, clipsDir, species: speciesForBatch(b) } : {}) });
        report.costUsd += r.run?.costUsd ?? 0;
        report.perBatch[name] = { keys: b.map((s) => s.key), ...(r.run ? { turns: r.run.turns, costUsd: r.run.costUsd, durationSec: r.run.durationSec, exit: r.run.exit, tail: r.run.tail } : {}) };
        for (const s of b) if (!r.moved.includes(s.key)) fail.set(s.key, r.problem ?? (r.run?.aborted ? '세션 시간 초과·취소로 파일 없음' : '에이전트가 파일을 쓰지 않음'));
        deps.activity?.(`[롱폼 그림] ${name} ${b[0]!.key}~${b[b.length - 1]!.key}(${b[0]!.chapterTitle}) — 파일 ${r.moved.length}/${b.length} · 턴 ${r.run?.turns ?? '?'} · $${(r.run?.costUsd ?? 0).toFixed(2)}${r.problem ? ` · ${r.problem}` : ''}`);
      } catch (e) {
        const why = `묶음 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
        report.perBatch[name] = { keys: b.map((s) => s.key), skipped: why };
        for (const s of b) fail.set(s.key, why);
      }
    },
    (b, i, why) => {
      report.perBatch[nameOf(i)] = { keys: b.map((s) => s.key), skipped: why };
      for (const s of b) fail.set(s.key, why);
    });

  const finish = (pass: string[], extra: { entryPoint?: string; contact?: string } = {}): ScenesResult => {
    const keyBySeg = new Map(specs.filter((s) => pass.includes(s.key)).map((s) => [s.segId, s.key]));
    writeSceneKeys(dir, keyBySeg);
    report.built = pass.length;
    report.costUsd = Math.round(report.costUsd * 100) / 100;
    report.failed = specs.filter((s) => !pass.includes(s.key)).map((s) => ({ key: s.key, reason: fail.get(s.key) ?? '알 수 없음' }));
    fs.writeFileSync(path.join(sceneDir, 'report.json'), JSON.stringify(report, null, 2));
    deps.log(`장면 ${pass.length}/${specs.length}개 통과 · 비용 $${report.costUsd}${report.failed.length ? ` · 탈락 ${report.failed.length}` : ''}`);
    return { built: pass.length, costUsd: report.costUsd, ...extra };
  };
  if (signal?.aborted) return finish([]);

  // ── 사후 검사(에이전트를 믿지 않는다): 빠른 검사 → 타입 검사(한 번에) → 스틸(던지면 탈락)
  writeIfChanged(path.join(sceneDir, KIT_SHIM), full ? kitShimSourceFull(sceneDir, deps.repo, full.style, episodeSpeciesModule(dir)) : kitShimSource(sceneDir, deps.repo));
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const writeEntry = (keys: readonly string[]) => (full ? writeEpisodeEntryFull(dir, keys, deps.repo, full.style) : writeEpisodeEntry(dir, keys, deps.repo));
  const stillDir = path.join(sceneDir, 'stills');
  /**
   * 사후 검사 한 벌 — 첫 그림(전부)과 검토 뒤 다시 그린 장면(일부)이 같이 쓴다. keys 를 검사하고, 등록표에는 keep(이미 통과한 장면) + keys 를 싣는다.
   * 스틸은 outDir 에(`<key>_<pct>.png`, 침범 검사는 outDir/.probe). bundle = 번들 실패(그때 keys 전부 탈락).
   */
  const postCheck = async (keys: readonly string[], keep: readonly string[], outDir: string): Promise<{ pass: string[]; bundle?: true }> => {
    let pass: string[] = [];
    for (const k of keys) {
      const sp = byKey.get(k)!;
      const file = path.join(sceneDir, sp.file);
      if (!fs.existsSync(file)) continue;
      const p = lintScene(fs.readFileSync(file, 'utf8'), sp.key, sp.narration, full ? fullLintOpts(sp) : {});
      if (p.length) fail.set(sp.key, `검사: ${p.slice(0, 3).join(' / ')}`);
      else pass.push(sp.key);
    }
    if (pass.length) {
      const tc = await deps.typecheck(pass.map((k) => path.join(sceneDir, byKey.get(k)!.file)), signal);
      pass = pass.filter((k) => {
        const errs = tc.get(path.resolve(path.join(sceneDir, byKey.get(k)!.file))) ?? [];
        if (errs.length) fail.set(k, `타입: ${errs.slice(0, 2).join(' / ')}`);
        return !errs.length;
      });
    }
    if (!pass.length || signal?.aborted) return { pass: [] };
    const entryPoint = writeEntry([...keep, ...pass]);
    const items: StillItem[] = pass.flatMap((k) => {
      const s = byKey.get(k)!;
      const base = PREVIEW_AT.map((r) => ({ id: `${k}@${r}`, sceneKey: k, durationInFrames: s.frames, words: s.words, frame: frameAt(s.frames, r), output: path.join(outDir, `${k}_${Math.round(r * 100)}.png`), ...(full ? { extra: fullExtra(s, full.style) } : {}) }));
      // 전체 화면 — 55% 검사 스틸(단색 바탕에 그림만)로 자막 띠·장 이름 자리 침범을 잰다.
      return full ? [...base, { id: `${k}@probe`, sceneKey: k, durationInFrames: s.frames, words: s.words, frame: frameAt(s.frames, CONTACT_AT), output: path.join(outDir, '.probe', `${k}.png`), extra: fullExtra(s, full.style, true) }] : base;
    });
    let stills: Map<string, string | null>;
    try { stills = await deps.renderStills({ entryPoint, outDir: path.join(sceneDir, '.render'), items, ...(signal ? { signal } : {}), ...(full ? { publicFiles: fullPublicFiles(specs, clipsDir) } : {}) }); }
    catch (e) {
      const why = `번들 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
      for (const k of pass) fail.set(k, why);
      return { pass: [], bundle: true };
    }
    if (full) {
      // 침범이 크면(자막 띠 2% 넘게) 탈락 — 무대가 잘라 내 화면엔 안 보이지만 그림이 잘린다. 작은 침범은 기록만.
      for (const k of pass) {
        if (stills.get(`${k}@probe`) !== null) continue;
        try {
          const leak = await zoneLeak(path.join(outDir, '.probe', `${k}.png`));
          report.zone![k] = { caption: Math.round(leak.caption * 1000) / 1000, chapter: Math.round(leak.chapter * 1000) / 1000 };
          if (leak.caption > 0.02 || leak.chapter > 0.02) stills.set(`${k}@${PREVIEW_AT[1]}`, `자막 띠·장 이름 자리 침범 ${(leak.caption * 100).toFixed(1)}%·${(leak.chapter * 100).toFixed(1)}%`);
        } catch { /* 측정 실패는 넘어간다 */ }
      }
    }
    return {
      pass: pass.filter((k) => {
        const errs = PREVIEW_AT.map((r) => { const v = stills.get(`${k}@${r}`); return v === undefined ? '스틸 없음' : v; }).filter((x): x is string => x !== null);
        if (errs.length) fail.set(k, `렌더 오류: ${errs[0]}`);
        return !errs.length;
      }),
    };
  };

  const first = await postCheck(specs.map((s) => s.key), [], stillDir);
  if (first.bundle) { writeEntry([]); return finish([]); }
  let pass = first.pass;
  if (signal?.aborted) return finish([]);
  if (!pass.length) { writeEntry([]); return finish([]); }

  // ── 완성 장면 검토(정하람) → 다시 그리기 한 묶음(차민혁). 무엇이 실패해도 첫 그림 그대로 간다(fail-open).
  let reviewOut: ScenesResult['review'];
  if (deps.review && !signal?.aborted) {
    // 실물 대조용 — 우리 실촬영(앞 4장) + 공개 도감 사진(부위 표시, 묶음마다 문장에 맞는 부위를 chunkRefs 가 고른다).
    const refs: ReviewRef[] = (speciesIndex?.species ?? []).flatMap((e) => [
      ...e.refs.slice(0, 4).map((rel) => ({ nameKo: e.nameKo, file: path.join(dir, rel) })),
      ...(e.commons ?? []).map((c) => ({ nameKo: e.nameKo, file: path.join(dir, c.file), part: c.part })),
    ]);
    const rv = await reviewAndRedo(pass, {
      deps, specs, byKey, sceneDir, stillDir, kitApi, report, fail, postCheck, ...(title ? { title } : {}), ...(signal ? { signal } : {}),
      ...(full ? { mode: full, clipsDir, speciesOf: speciesOfSpec, speciesForBatch, ...(refs.length ? { refs } : {}) } : {}),
    });
    reviewOut = rv;
    if (signal?.aborted) return finish([]);
  }

  const finalEntry = writeEntry(pass);
  let contact: string | undefined;
  try {
    contact = path.join(sceneDir, 'contact.jpg');
    await deps.tile(pass.map((k) => path.join(stillDir, `${k}_${Math.round(CONTACT_AT * 100)}.png`)), contact, full ? { cols: 4, width: 640, quality: 3 } : { cols: 6, width: 360, quality: 4 });
  } catch (e) { contact = undefined; deps.log(`대조표 실패: ${e instanceof Error ? e.message : String(e)}`); }
  return finish(pass, { entryPoint: finalEntry, ...(contact ? { contact } : {}), ...(reviewOut ? { review: reviewOut } : {}) });
}

/** 장면 파일의 화면 라벨(맨 위 const L… = '…' 상수, 순수) — 비전 없이 검토할 때 글로 된 장면 설명. */
export function sceneLabels(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*const\s+L\w*\s*=\s*(['"`])(.*?)\1/gm)) if (m[2]) out.push(m[2]);
  return out.slice(0, 6);
}

/**
 * 검토 → 다시 그리기(한 묶음 r01). 다시 그린 장면은 사후 검사를 다시 거쳐 통과한 것만 바꾸고, 떨어지면 원래 파일·스틸로 되돌린다.
 * 기록은 scenes/review.json. 비용 상한을 이미 넘었으면 검토만 하고 다시 그리지 않는다.
 */
async function reviewAndRedo(pass: string[], o: {
  deps: SceneDeps; specs: SceneSpec[]; byKey: Map<string, SceneSpec>; sceneDir: string; stillDir: string; kitApi: string; title?: string;
  report: SceneReport; fail: Map<string, string>; signal?: AbortSignal; mode?: SceneStageMode; clipsDir?: string;
  postCheck: (keys: readonly string[], keep: readonly string[], outDir: string) => Promise<{ pass: string[]; bundle?: true }>;
  /** 전체 화면 — 장면 수종(실물 대조)·묶음 수종 표·실물 사진. */
  speciesOf?: (sp: SceneSpec) => string[]; speciesForBatch?: (b: readonly SceneSpec[]) => SceneJob['species']; refs?: ReviewRef[];
}): Promise<NonNullable<ScenesResult['review']>> {
  const { deps, byKey, sceneDir, stillDir } = o;
  const rec: ReviewRecord = { at: new Date().toISOString(), checked: pass.length, redo: [] };
  const pct = Math.round(CONTACT_AT * 100);
  const save = () => { try { fs.writeFileSync(path.join(sceneDir, 'review.json'), JSON.stringify(rec, null, 2)); } catch { /* 기록만 잃는다 */ } };
  const backup = path.join(sceneDir, 'review', 'orig');
  const restored: string[] = [];
  const restore = (k: string, why: string) => {
    const sp = byKey.get(k)!;
    try { fs.copyFileSync(path.join(backup, sp.file), path.join(sceneDir, sp.file)); } catch { /* 백업 없음 — 아래 검사가 이미 원본 */ }
    restored.push(k);
    const r = rec.redo.find((x) => x.key === k);
    if (r) { r.result = 'kept'; r.why = why; }
  };
  try {
    const items: ReviewItem[] = pass.map((k) => {
      const sp = byKey.get(k)!;
      const still = path.join(stillDir, `${k}_${pct}.png`);
      let labels: string[] = [];
      try { labels = sceneLabels(fs.readFileSync(path.join(sceneDir, sp.file), 'utf8')); } catch { /* 없음 */ }
      const species = o.speciesOf?.(sp) ?? [];
      return { key: k, narration: sp.narration, chapterTitle: sp.chapterTitle, labels, ...(fs.existsSync(still) ? { still } : {}), ...(species.length ? { species } : {}) };
    });
    const t0 = Date.now();
    const v = await deps.review!({ items, ...(o.title ? { title: o.title } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(o.refs?.length ? { refs: o.refs } : {}) });
    if (!v) { rec.skipped = '검토 응답 없음'; save(); return { redo: 0, redone: 0, skipped: rec.skipped }; }
    rec.mode = v.mode; rec.checked = v.checked; if (v.note) rec.note = v.note;
    const seen = new Set<string>();
    const redo = v.redo.filter((r) => { if (!pass.includes(r.key) || seen.has(r.key)) return false; seen.add(r.key); return true; }).slice(0, REVIEW_MAX);
    rec.redo = redo.map((r) => ({ key: r.key, reason: r.reason.slice(0, 200), result: 'kept' as const }));
    deps.log(`검토 — ${v.checked}장면 확인(${v.mode}) · 다시 그릴 장면 ${redo.length}개${redo.length ? `: ${redo.map((r) => r.key).join(', ')}` : ''}`);
    if (!redo.length) { save(); return { redo: 0, redone: 0 }; }
    if (o.report.costUsd >= deps.budgetUsd) {
      rec.skipped = `비용 상한 $${deps.budgetUsd} 도달 — 다시 그리지 않음`;
      for (const r of rec.redo) r.why = rec.skipped;
      save(); return { redo: redo.length, redone: 0, skipped: rec.skipped };
    }
    // 원본 백업 → 다시 그리기 한 묶음
    fs.mkdirSync(backup, { recursive: true });
    const specsR = redo.map((r) => byKey.get(r.key)!);
    const seed = specsR.map((sp) => { const content = fs.readFileSync(path.join(sceneDir, sp.file), 'utf8'); fs.writeFileSync(path.join(backup, sp.file), content); return { file: sp.file, content }; });
    const note = [
      '────────── 리뷰어(정하람) 검토 — 이 묶음은 다시 그리기다 ──────────',
      '이 폴더의 sNNN.tsx 는 이미 만든 장면이다. 아래 지적을 고쳐 같은 파일에 다시 쓴다(Edit 로 고치거나 새로 Write). 지적이 없는 부분의 좋은 점은 살린다. 고친 뒤 check → preview 절차는 같다.',
      ...redo.map((r) => `- ${r.key}: ${r.reason}`),
    ].join('\n');
    const run = await runBatch('r01', specsR, { sceneDir, kitApi: o.kitApi, ...(o.title ? { title: o.title } : {}), deps, ...(o.signal ? { signal: o.signal } : {}), ...(o.mode ? { mode: o.mode } : {}), ...(o.clipsDir ? { clipsDir: o.clipsDir } : {}), ...(o.speciesForBatch ? { species: o.speciesForBatch(specsR) } : {}), note, seed });
    o.report.costUsd += run.run?.costUsd ?? 0;
    o.report.perBatch.r01 = { keys: specsR.map((s) => s.key), ...(run.run ? { turns: run.run.turns, costUsd: run.run.costUsd, durationSec: run.run.durationSec, exit: run.run.exit, tail: run.run.tail } : {}) };
    rec.costUsd = run.run?.costUsd; rec.durationSec = Math.round((Date.now() - t0) / 1000);
    deps.activity?.(`[롱폼 다시 그리기] 검토 지적 ${redo.length}장면 → 세션 ${run.run?.turns ?? '?'}턴 · $${(run.run?.costUsd ?? 0).toFixed(2)}`);
    // 바뀐 장면만 사후 검사 — 안 바뀐 것은 원래대로(검사 통과본).
    const changed = run.moved.filter((k) => seed.find((x) => x.file === byKey.get(k)!.file)?.content !== fs.readFileSync(path.join(sceneDir, byKey.get(k)!.file), 'utf8'));
    for (const r of rec.redo) {
      if (!run.moved.includes(r.key)) restore(r.key, run.problem ?? '다시 그린 파일 없음');
      else if (!changed.includes(r.key)) { r.result = 'kept'; r.why = '바꾸지 않음'; }
    }
    if (o.signal?.aborted || !changed.length) {
      for (const k of changed) restore(k, '취소됨');
      save(); return { redo: redo.length, redone: 0, ...(rec.skipped ? { skipped: rec.skipped } : {}) };
    }
    const redoDir = path.join(stillDir, 'redo');
    const keep = pass.filter((k) => !changed.includes(k));
    const pc = await o.postCheck(changed, keep, redoDir);
    for (const k of changed) {
      if (pc.pass.includes(k)) {
        for (const r of PREVIEW_AT.map((x) => Math.round(x * 100))) {
          try { fs.copyFileSync(path.join(redoDir, `${k}_${r}.png`), path.join(stillDir, `${k}_${r}.png`)); } catch { /* 스틸 없음 */ }
        }
        const r = rec.redo.find((x) => x.key === k); if (r) { r.result = 'redone'; delete r.why; }
      } else {
        restore(k, `다시 그린 장면이 검사에서 떨어짐 — ${o.fail.get(k) ?? '알 수 없음'}`);
        o.fail.delete(k); // 원본은 이미 통과했다 — 첫 그림 탈락 사유와 섞지 않는다
      }
    }
    const redone = rec.redo.filter((r) => r.result === 'redone').length;
    deps.log(`다시 그리기 — ${redone}/${redo.length}개 바꿈${restored.length ? ` · 원래대로 ${restored.length}` : ''}`);
    save();
    return { redo: redo.length, redone };
  } catch (e) {
    rec.skipped = `검토 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
    for (const r of rec.redo) if (r.result !== 'redone' && !restored.includes(r.key)) restore(r.key, rec.skipped);
    deps.log(rec.skipped);
    save();
    return { redo: rec.redo.length, redone: rec.redo.filter((r) => r.result === 'redone').length, skipped: rec.skipped };
  }
}
