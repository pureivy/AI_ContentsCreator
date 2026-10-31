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
 * 구독 세션 한도(2026-10-25 대추나무 편 — 새벽 b13~b16 이 "hit your session limit · resets 3am" 로 죽어 7·8장 24장면이 비었다):
 *   한 묶음이 한도에 걸리면 남은 묶음을 띄우지 않고, 풀리는 시각까지 기다렸다가(최대 LIMIT_WAIT_MAX_MS) 빠진 장면만 다시 그린다.
 * 턴 상한(같은 날 대추나무 편 고치기 —8장면 묶음 셋이 모두 91/90턴에서 끊겨 6장면이 빠졌다. 2·4장면 묶음은 50~71턴):
 *   그래도 파일이 없는 장면은 절반 크기 묶음(REDO_BATCH_MAX, 이름 tNN)으로 한 번 더 그린다. 하네스 파일 변조(TAMPERED)로 버린 묶음은 다시 안 그린다
 *   (저장소 소스 변조 TAMPERED_REPO 는 그 세션 탓이 확실할 때만 버리고, 장면은 tNN 으로 다시 그린다).
 * 사후 검사 탈락(같은 고치기 때 s081 — _kit 에 없는 random 을 써 타입 오류): 지금 파일과 오류를 깔아 주고 fNN 묶음으로 한 번 고치게 한다(편당 FIX_MAX 장면).
 *   인프라 탈락(tsc 시간 초과·브라우저가 죽음 — 모든 파일에 같은 사유)은 장면 탓이 아니라 fNN 에 넣지 않고 사후 검사만 한 번 더 한다.
 * 한도 대기는 첫 그림·tNN·fNN 판 모두 같은 도우미(drawRound)로 — 대기 횟수 LIMIT_ROUNDS·대기 합 LIMIT_WAIT_MAX_MS 는 편 전체에서 한 번 센다. 검토 다시 그리기(r01)는 한도 중이면 건너뛴다.
 * 비용(2026-10-25): result 줄이 없는 세션(죽인 946초 세션 등)은 이번 실행 완료 묶음의 초당 비용 중앙값(없으면 SCENE_COST_PER_MIN_USD)으로 어림하고,
 *   새 묶음은 진행 중 묶음마다 예상 비용을 잡아 둔 채 상한을 본다. resume 은 지난 report.json 비용을 priorCostUsd 로 이어 적는다(상한은 이번 실행분).
 * 세션 격리(2026-10-25): 허용 목록 환경(sceneAgentEnv — .env 토큰 없음), 쓰기는 작업 폴더만·읽기는 작업 폴더 + 키트 소스(remotion/longform/**)·
 *   이 편 장면 폴더(이웃 장면·다른 묶음 작업 중 장면)만(sceneAgentArgs, haiku 탐침으로 실측). 묶음 앞뒤로 저장소 키트·하네스 소스 지문(sha256)을 비교해
 *   바뀌었고 그 묶음 agent.jsonl 에 그 파일을 건드린 Write·Edit·Bash 가 있으면 그 묶음을 버린다(없으면 경고만 — 개발 중 저장·git checkout 은 세션 탓이 아니다).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { agentResultOf, runProc, sceneAgentEnv } from './cliProc';
import { loadEpisodeScript, loadMediaVideos, saveEpisodeScript } from '../longform/episode';
import { lintScene } from '../longform/sceneLint';
import { typecheckScenes } from '../longform/sceneCheck';
import { KIT_SHIM, SCENE_DIR, episodeSpeciesModule, kitShimSource, kitShimSourceFull, writeEpisodeEntry, writeEpisodeEntryFull, writeIfChanged } from '../longform/sceneFiles';
import { fullExtra, fullLintOpts, fullPublicFiles, fullSpecs, insetSpecies, planInsets, scenePromptFull, zoneLeak, type FullMode } from '../longform/sceneFull';
import { kitForPresenter } from '../longform/presenter';
import { batchSpecies, loadSpeciesIndex, type SpeciesIndex } from '../longform/speciesPreset';
import type { RefPart } from '../longform/speciesCommons';
import { BATCH_MAX, planBatches, scenePrompt, sceneSpecs, type SceneJob, type SceneSpec } from '../longform/sceneJob';
import { CONTACT_AT, PREVIEW_AT, frameAt, renderSceneStills, tileStills, type StillItem } from '../longform/scenePreview';
import type { Timeline, TimedSegment } from '../longform/timeline';

/** repo·sceneDir = 세션 읽기 허용 범위(키트 소스·이 편 장면) — 없으면 cwd·workDir 에서 미룬다. */
export interface AgentRunInput { batch: string; workDir: string; prompt: string; timeoutMs: number; maxTurns: number; signal?: AbortSignal; repo?: string; sceneDir?: string }
/** log = 세션 stream-json 기록(하네스가 받은 stdout 사본) — 변조 판정은 이것만 본다(작업 폴더의 파일은 세션이 고칠 수 있다). */
export interface AgentRun { exit: number; aborted: boolean; turns?: number; costUsd?: number; durationSec: number; tail?: string; log?: string }

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
  /** 세션 한도 대기(테스트가 바꿔 끼운다). 없으면 실제 시계·setTimeout. */
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 묶음 앞뒤 지문을 비교할 저장소 폴더(변조 감지 — 파일 고르기는 tamperTracked). 없으면 실제 세션(claudeAgent)일 때만 TAMPER_ROOTS, 가짜 세션이면 보지 않는다. */
  tamperRoots?: string[];
}

/** 한도가 풀린 뒤 여유 · 한 번에 기다리는 최대 · 기다렸다 다시 그리는 횟수. */
export const LIMIT_GRACE_MS = 3 * 60_000;
export const LIMIT_WAIT_MAX_MS = 6 * 3_600_000;
export const LIMIT_ROUNDS = 2;
/** 빠진 장면 한 번 더 그리기 묶음 크기 — 첫 묶음(BATCH_MAX)의 절반. */
export const REDO_BATCH_MAX = Math.ceil(BATCH_MAX / 2);
/** 사후 검사 탈락 고치기(fNN) 장면 상한(편당) — 넘는 장면은 장면 없이(인프라 탈락 폭주가 세션 25개로 번지던 것). */
export const FIX_MAX = 12;
/** result 줄이 없는 세션의 비용 어림(완료 묶음이 없을 때) — 대추나무 편 실측 $4.67/618초·$8.15/830초·$6.85/745초 ≈ 분당 $0.45~0.59. */
export const SCENE_COST_PER_MIN_USD = 0.6;
/** 진행 중 묶음 하나에 잡아 두는 예상 비용(완료 묶음이 없을 때) — 8장면 묶음 실측 $5~12. */
export const SCENE_RESERVE_USD = 8;
/**
 * 변조 감지 지문 폴더(저장소 기준) — 장면 번들이 import 하는 키트(remotion/longform)와 하네스 진입점(scripts/longform/scene_check*·scene_preview*).
 * 10-25 리뷰: src/longform·문서·견본까지 mtime 으로 보면 개발 중 저장 한 번·.DS_Store 하나에 동시 묶음이 다 버려졌다.
 */
export const TAMPER_ROOTS = ['remotion/longform', 'scripts/longform', 'scripts/render'];
/** 견본·실험 폴더 — 키트가 import 하지 않는다(주석에만 나온다). */
const TAMPER_SKIP_DIRS = new Set(['node_modules', 'gallery', 'examples', 'example', 'mgspike', 'stylespike']);
/** 지문에 넣을 파일(순수) — root 기준 상대 경로. .ts·.tsx 만(시험·숨김 빼고), scripts/longform 은 하네스 진입점만. */
export function tamperTracked(root: string, rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  const name = parts[parts.length - 1]!;
  if (parts.some((x) => x.startsWith('.')) || parts.slice(0, -1).some((x) => TAMPER_SKIP_DIRS.has(x))) return false;
  if (path.basename(path.resolve(root)) === 'render' && path.basename(path.dirname(path.resolve(root))) === 'scripts') return /^chrome_netbox\.(?:sh|sb)$/.test(name); // 렌더 브라우저 네트워크 상자
  if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return false;
  return path.basename(path.dirname(path.resolve(root))) === 'scripts' ? /^scene_(?:check|preview)/.test(name) : true;
}
const TAMPERED = '하네스 파일 변조 감지 — 이 묶음 장면을 버림';
const TAMPERED_REPO = '저장소 키트·하네스 소스 변조 감지(이 세션이 고침) — 이 묶음 장면을 버림';
/** 다시 그리지 않을 탈락 — 작업 폴더 하네스 변조만. 저장소 소스 변조(TAMPERED_REPO)는 장면을 tNN·wNN 으로 다시 그린다. */
const isTamper = (why: string | undefined): boolean => why === TAMPERED;
// '5-hour limit'(2026-11-01 밤나무 편 — 하이픈이 \w 에 안 걸려 기다리지 않고 19장면을 비웠다)까지 [\w-].
const LIMIT_RX = /hit your (?:[\w-]+ )?limit|usage limit reached/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * 구독 세션 한도 문구 → 풀리는 시각(순수). 한도 문구가 아니면 null.
 * "You've hit your session limit · resets 3am (Asia/Seoul)" — 시각은 서버 로컬(서울)로 보고 다음 그 시각. 시각을 못 읽으면 한 시간 뒤.
 * 주간 한도("resets Oct 29, 3am"·'weekly limit')는 그 날짜로(날짜가 없으면 8일 뒤) — LIMIT_WAIT_MAX_MS 가 기다리지 않게 한다.
 */
export function sessionLimitReset(tail: string | undefined, now: Date): Date | null {
  if (!tail || !LIMIT_RX.test(tail)) return null;
  const ep = /\|(\d{10})\b/.exec(tail); // "Claude AI usage limit reached|1761328800" — 풀리는 시각(epoch 초)
  if (ep) return new Date(Number(ep[1]) * 1000);
  const md = /resets\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i.exec(tail);
  const mon = md ? MONTHS.indexOf(md[1]!.toLowerCase()) : -1;
  if (md && mon >= 0) {
    const h = md[3] ? (Number(md[3]) % 12) + (md[5]!.toLowerCase() === 'pm' ? 12 : 0) : 0;
    const at = new Date(now.getFullYear(), mon, Number(md[2]), h, Number(md[4] ?? 0), 0, 0);
    if (at.getTime() <= now.getTime()) at.setFullYear(at.getFullYear() + 1);
    return at;
  }
  if (/\bweek/i.test(tail)) return new Date(now.getTime() + 8 * 24 * 3_600_000);
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(tail);
  if (!m) return new Date(now.getTime() + 3_600_000);
  const h = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === 'pm' ? 12 : 0);
  const at = new Date(now); at.setHours(h, Number(m[2] ?? 0), 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * 세션 끝 한 줄(순수) — result 글 → stderr 의 마지막 빈 줄 아닌 줄(종전 slice(-200).split.pop() 은 끝 줄바꿈이면 '' 였다).
 * 한도 문구는 result·stderr·agent.jsonl 끝 몇 KB(JSON 아닌 줄·assistant 글) 어디에 있든 그 줄을 먼저 — sessionLimitReset 이 읽는다.
 */
export function agentTail(resultText: string | undefined, stderr: string, jsonl: string): string | undefined {
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const cands = [...lines(resultText ?? ''), ...lines(stderr)];
  const tailKb = jsonl.slice(-8192);
  for (const [i, l] of tailKb.split('\n').entries()) {
    if (i === 0 && tailKb.length < jsonl.length) continue; // 잘린 첫 줄
    try {
      const j = JSON.parse(l) as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
      if (j.type === 'assistant') for (const c of j.message?.content ?? []) if (c.type === 'text' && c.text) cands.push(...lines(c.text));
    } catch { if (l.trim()) cands.push(l.trim()); }
  }
  const limit = cands.filter((x) => LIMIT_RX.test(x)).pop();
  return (limit ?? lines(resultText ?? '').pop() ?? lines(stderr).pop())?.slice(0, 300);
}

/** 인프라 탈락 문구 — tsc 가 못 돎(sceneCheck 가 '인프라:' 를 붙인다)·브라우저가 죽음·스틸이 아예 없음. */
export const INFRA_RX = /^인프라:|Target closed|Protocol error|Session closed|browser has disconnected|Browser (?:was )?closed|Navigation failed because browser|ECONNRESET|socket hang up|ENOMEM|Failed to launch|^스틸 없음$/i;
/**
 * 인프라 탈락 고르기(순수) — msgs = 탈락 장면 → 첫 오류, total = 검사한 장면 수. 장면 탓이 아닌 것:
 * INFRA_RX 문구, 또는 같은 문구가 3장면 이상·검사한 장면 절반 이상(파일 위치·TS 코드·장면 키가 든 문구는 장면 오류라 빼고).
 */
export function infraKeys(msgs: ReadonlyMap<string, string>, total: number): Set<string> {
  const count = new Map<string, number>();
  for (const m of msgs.values()) count.set(m, (count.get(m) ?? 0) + 1);
  const out = new Set<string>();
  for (const [k, m] of msgs) {
    const n = count.get(m) ?? 0;
    if (INFRA_RX.test(m) || (n >= 3 && n * 2 >= total && !/\bTS\d{3,5}\b|s\d{3}\.tsx/.test(m))) out.add(k);
  }
  return out;
}

const sleepAbortable = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((res) => {
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal?.removeEventListener('abort', done); res(); }
  signal?.addEventListener('abort', done, { once: true });
});

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
  /** costUsd = 이번 실행분(상한도 이것으로 본다). priorCostUsd = resume 앞 실행들 합, totalCostUsd = 둘의 합. */
  built: number; total: number; costUsd: number; priorCostUsd?: number; totalCostUsd?: number;
  failed: Array<{ key: string; reason: string }>;
  /** costEstimated = 결과 줄이 없어 어림한 비용. */
  perBatch: Record<string, { keys: string[]; turns?: number; costUsd?: number; costEstimated?: true; durationSec?: number; exit?: number; skipped?: string; tail?: string }>;
  /** 전체 화면 — 자막 띠·장 이름 자리 침범(55% 검사 스틸, 비율). */
  zone?: Record<string, { caption: number; chapter: number }>;
  /** 전체 화면 — 장마다 실촬영 지정 장면. */
  insetKeys?: string[];
  /** 전체 화면 — 끼움 카드가 하나도 없는 장과 사유(그 장·주인공 수종 영상 없음). */
  insetMissing?: Array<{ chapter: string; why: string }>;
  /** 전체 화면 — 다른 장 클립을 빌려 끼움 카드를 준 장면(세그먼트 id → 빌려 온 세그먼트 id). */
  insetBorrowed?: Record<string, string>;
}

/**
 * 장면 세션 CLI 인자(순수) — 2026-10-25 haiku 탐침 실측(scratchpad permprobe):
 *  종전 `--allowedTools Read,Write,Edit,…` 은 맨 이름이라 저장소 .env 읽기·작업 폴더 밖 쓰기·키트 kit.tsx 고치기가 모두 됐다.
 *  지금: --tools 로 도구를 여섯으로(없으면 Grep·Glob 이 아예 없다), 쓰기는 acceptEdits 의 cwd(작업 폴더) 범위만, 읽기는 cwd + 아래 허용 경로만,
 *  .env 는 거부 규칙. Bash 는 ./check.sh·./preview.sh 만(읽기 전용 명령도 cwd 밖은 막힌다).
 */
export function sceneAgentArgs(o: { model: string; maxTurns: number; repo: string; sceneDir: string }): string[] {
  const abs = (p: string) => `/${path.resolve(p)}`; // 권한 규칙의 절대 경로는 //…
  const deny = ['AskUserQuestion', 'WebFetch', 'WebSearch', `Read(${abs(path.join(o.repo, '.env'))})`, 'Read(**/.env*)',
    ...['src', 'scripts', 'remotion', 'node_modules'].map((d) => `Edit(${abs(path.join(o.repo, d))}/**)`)];
  // 장면 폴더는 읽기만 — 세션이 Glob scenes/**/*.tsx 로 이웃·다른 묶음 작업 중 장면을 본다(10-25 리뷰). 쓰기는 acceptEdits 의 cwd 뿐이다.
  const allow = [`Read(${abs(path.join(o.repo, 'remotion', 'longform'))}/**)`, `Read(${abs(path.join(o.sceneDir, '_species.ts'))})`, `Read(${abs(o.sceneDir)}/*.tsx)`,
    `Read(${abs(path.join(o.sceneDir, 'work'))}/*/s*.tsx)`, `Read(${abs(o.sceneDir)}/**)`, 'Bash(./preview.sh:*)', 'Bash(./check.sh:*)'];
  return ['-p', '--model', o.model, '--setting-sources', '', '--no-session-persistence', '--max-turns', String(o.maxTurns),
    '--permission-mode', 'acceptEdits', '--tools', 'Read,Write,Edit,Glob,Grep,Bash', '--disallowedTools', deny.join(','),
    '--allowedTools', allow.join(','), '--output-format', 'stream-json', '--verbose'];
}

/** 실제 Claude Code 세션(구독 로그인 환경) — stream-json 로그를 작업 폴더 밖(work/bNN.agent.jsonl — 세션은 cwd 에만 쓴다)에 남기고 result 줄에서 턴·비용을 읽는다. */
async function claudeAgent(o: AgentRunInput): Promise<AgentRun> {
  const args = sceneAgentArgs({ model: CONFIG.cloudTierModels.heavy, maxTurns: o.maxTurns, repo: o.repo ?? path.resolve('.'), sceneDir: o.sceneDir ?? path.dirname(path.dirname(o.workDir)) });
  const logFile = path.join(path.dirname(o.workDir), `${path.basename(o.workDir)}.agent.jsonl`);
  const chunks: Buffer[] = [];
  const agentLog = fs.createWriteStream(logFile);
  agentLog.on('error', () => { /* 로그만 잃는다 */ });
  const t0 = Date.now();
  const r = await runProc(CONFIG.claudeCliPath, args, { cwd: o.workDir, env: sceneAgentEnv(process.env), timeoutMs: o.timeoutMs, stdin: o.prompt, onStdout: (d) => { chunks.push(Buffer.from(d)); agentLog.write(d); }, ...(o.signal ? { signal: o.signal } : {}) });
  await new Promise<void>((res) => agentLog.end(() => res()));
  const jsonl = Buffer.concat(chunks).toString('utf8'); // 메모리 사본 — 파일은 사람이 볼 기록일 뿐
  const result = agentResultOf(jsonl);
  const tail = agentTail(result?.result, r.stderr, jsonl);
  return {
    exit: r.code, aborted: r.aborted, durationSec: Math.round((Date.now() - t0) / 1000),
    ...(result?.num_turns != null ? { turns: result.num_turns } : {}), ...(result?.total_cost_usd != null ? { costUsd: result.total_cost_usd } : {}),
    ...(tail ? { tail } : {}), log: jsonl,
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

/** sha256 캐시(경로 → 크기·mtime·해시) — 안 바뀐 파일은 다시 읽지 않는다. */
const shaCache = new Map<string, { size: number; mtimeMs: number; sha: string }>();
/**
 * 폴더 지문(부작용: 파일 읽기) — tamperTracked 파일의 내용 sha256(링크는 가리키는 곳). 바뀐 파일 이름을 알리려고 목록 그대로 돌려준다.
 * 10-25 리뷰: mtime 만 보면 git checkout·같은 내용 다시 저장도 변조였다 — 내용으로 본다(크기·mtime 이 같으면 캐시).
 */
export function treeFingerprint(roots: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (root: string, dir: string): void => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !TAMPER_SKIP_DIRS.has(e.name)) walk(root, p); continue; }
      if (!tamperTracked(root, path.relative(root, p))) continue;
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) { out.set(p, `l:${fs.readlinkSync(p)}`); continue; }
        const c = shaCache.get(p);
        if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) { out.set(p, `f:${c.sha}`); continue; }
        const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        shaCache.set(p, { size: st.size, mtimeMs: st.mtimeMs, sha: h });
        out.set(p, `f:${h}`);
      } catch { /* 사라짐 */ }
    }
  };
  for (const r of roots) walk(r, r);
  return out;
}
const fingerprintDiff = (a: Map<string, string>, b: Map<string, string>): string[] => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
const sha = (file: string): string | null => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']);
/**
 * 세션이 바뀐 파일을 건드렸나(순수) — agent.jsonl 의 assistant tool_use 중 쓰는 도구(Write·Edit·MultiEdit·NotebookEdit·Bash) 입력이
 * 바뀐 파일(절대·저장소 상대·작업 폴더 상대 경로, file_path 는 작업 폴더 기준으로 풀어서, Bash 는 파일 이름까지)을 가리키면 그 파일들.
 */
export function agentTouched(jsonl: string, changed: readonly string[], o: { repo: string; workDir: string }): string[] {
  const hit = new Set<string>();
  for (const line of jsonl.split('\n')) {
    if (!line.includes('tool_use')) continue;
    let j: { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> } };
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'assistant') continue;
    for (const c of j.message?.content ?? []) {
      if (c.type !== 'tool_use' || !c.name || !WRITE_TOOLS.has(c.name)) continue;
      const text = JSON.stringify(c.input ?? {});
      const target = typeof c.input?.file_path === 'string' ? c.input.file_path : typeof c.input?.notebook_path === 'string' ? c.input.notebook_path : undefined;
      const resolved = target ? path.resolve(o.workDir, target) : undefined;
      for (const f of changed) {
        const names = [f, path.relative(o.repo, f), path.relative(o.workDir, f), ...(c.name === 'Bash' ? [path.basename(f)] : [])];
        if (resolved === path.resolve(f) || names.some((x) => x && text.includes(JSON.stringify(x).slice(1, -1)))) hit.add(f);
      }
    }
  }
  return [...hit];
}

/** 묶음 하나 — 작업 폴더 준비 → 세션 → 변조 확인 → 장면 파일을 scenes/ 로. 돌려주는 keys = 옮긴 장면. */
async function runBatch(name: string, specs: SceneSpec[], o: { sceneDir: string; kitApi: string; title?: string; deps: SceneDeps; signal?: AbortSignal; mode?: SceneStageMode; clipsDir?: string; note?: string; seed?: ReadonlyArray<{ file: string; content: string }>; species?: SceneJob['species']; tamperRoots?: readonly string[] }): Promise<{ moved: string[]; run?: AgentRun; problem?: string }> {
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

  const fpBefore = o.tamperRoots?.length ? treeFingerprint(o.tamperRoots) : null;
  const run = await deps.runAgent({ batch: name, workDir: work, prompt, timeoutMs: deps.batchTimeoutMs, maxTurns: deps.maxTurns, repo: deps.repo, sceneDir: o.sceneDir, ...(o.signal ? { signal: o.signal } : {}) });
  deps.log(`${name} 세션 끝 — exit ${run.exit}${run.aborted ? '(시간 초과·취소)' : ''} · 턴 ${run.turns ?? '?'} · $${run.costUsd != null ? run.costUsd.toFixed(2) : '?(결과 줄 없음)'} · ${run.durationSec}초`);
  // 저장소 키트·하네스 소스 — 권한(sceneAgentArgs)이 막지만 한 겹 더. 내용이 바뀌었고 이 세션 기록에 그 파일을 쓴 도구 호출이 있을 때만 버린다
  //   (동시 묶음·개발 중 저장·git checkout 으로 바뀐 것은 경고만 — 종전엔 겹친 묶음이 다 버려지고 tNN 에서도 빠져 장면을 영영 잃었다).
  if (fpBefore) {
    const changed = fingerprintDiff(fpBefore, treeFingerprint(o.tamperRoots!));
    if (changed.length) {
      const rel = (xs: readonly string[], n: number) => xs.slice(0, n).map((f) => path.relative(deps.repo, f)).join(', ');
      // 세션 기록은 runAgent 가 돌려준 사본만 — 작업 폴더의 agent.jsonl 은 세션이 지울 수 있어 믿지 않는다(10-25 보안 검토).
      const touched = agentTouched(run.log ?? '', changed, { repo: deps.repo, workDir: work });
      if (touched.length) {
        deps.log(`⚠⚠ ${name} — 세션이 저장소 소스를 고침(${touched.length}개: ${rel(touched, 5)}) — 이 묶음 장면을 버린다. 되돌리지 않았으니 git status 로 확인할 것`);
        deps.activity?.(`[롱폼 그림] ⚠ ${name} 저장소 소스 변조 감지 — ${rel(touched, 3)}`);
        return { moved: [], run, problem: TAMPERED_REPO };
      }
      deps.log(`⚠ ${name} — 세션 중에 저장소 소스가 바뀜(${changed.length}개: ${rel(changed, 5)}) — 이 세션 기록엔 고친 흔적이 없어 장면은 받는다(git status 로 확인할 것)`);
    }
  }
  const same = (f: string, want: string) => { try { return fs.readFileSync(path.join(work, f), 'utf8') === want; } catch { return false; } };
  const speciesTampered = !!speciesModule && (() => { try { return fs.readFileSync(speciesModule, 'utf8') !== speciesText; } catch { return true; } })();
  if (speciesTampered) writeIfChanged(speciesModule!, speciesText!); // 원래대로 — 다른 묶음 장면이 같은 파일을 쓴다
  if (!same('check.sh', checkSh) || !same('preview.sh', previewSh) || !same(KIT_SHIM, kit) || fs.readFileSync(jobPath, 'utf8') !== jobText || speciesTampered) {
    return { moved: [], run, problem: TAMPERED };
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

/** resume = 이미 있는 장면 파일은 두고 빠진 장면만 그린다(그림이 빈 편 고치기 — 검사·스틸·대조표는 전부 다시). */
export async function buildScenes(dir: string, segments: TimedSegment[], signal?: AbortSignal, over: Partial<SceneDeps> = {}, mode?: SceneStageMode, opts: { resume?: boolean } = {}): Promise<ScenesResult> {
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
  // 지난 실행의 장면 파일은 지운다(이번 세션이 다시 쓰지 않은 장면이 검사 없이 남지 않게). resume 은 남긴다 — 아래 사후 검사가 다시 본다.
  const hasFile = (s: SceneSpec) => fs.existsSync(path.join(sceneDir, s.file));
  if (!opts.resume) for (const s of specs) { try { fs.unlinkSync(path.join(sceneDir, s.file)); } catch { /* 없음 */ } }
  const batches = planBatches(opts.resume ? specs.filter((s) => !hasFile(s)) : specs);
  const kitApi = kitForPresenter(fs.readFileSync(full ? (full.kitApiPath ?? path.join(deps.repo, 'remotion', 'longform', 'fullscreen', `KIT_API_${full.style}.md`)) : path.join(deps.repo, 'remotion', 'longform', 'scenes', 'KIT_API.md'), 'utf8'),
    full?.presenter ? fs.readFileSync(path.join(deps.repo, 'remotion', 'longform', 'fullscreen', 'KIT_API_BIONEE.md'), 'utf8') : undefined);
  const borrowed = plan ? Object.fromEntries([...plan.footage].filter(([, f]) => f.borrowed).map(([k, f]) => [k, f.borrowed!])) : {};
  // resume — 지난 실행 비용을 잃지 않게 이어 적는다(이번 실행 비용·상한은 따로).
  let priorCostUsd = 0;
  if (opts.resume) { try { const old = JSON.parse(fs.readFileSync(path.join(sceneDir, 'report.json'), 'utf8')) as Partial<SceneReport>; priorCostUsd = old.totalCostUsd ?? old.costUsd ?? 0; } catch { /* 지난 보고 없음 */ } }
  const report: SceneReport = {
    built: 0, total: specs.length, costUsd: 0, failed: [], perBatch: {},
    ...(priorCostUsd ? { priorCostUsd } : {}),
    ...(full ? { zone: {}, insetKeys: specs.filter((s) => s.full?.insetRequired).map((s) => s.key), insetMissing: plan?.missing ?? [], ...(Object.keys(borrowed).length ? { insetBorrowed: borrowed } : {}) } : {}),
  };
  if (plan?.missing.length) deps.log(`끼움 카드 없는 장: ${plan.missing.map((m) => `${m.chapter}(${m.why})`).join(', ')}`);
  const fail = new Map<string, string>();
  const nameOf = (i: number) => `b${String(i + 1).padStart(2, '0')}`;
  deps.log(`장면 ${specs.length}개 · 묶음 ${batches.length}개 · 동시 ${deps.concurrency} · 상한 $${deps.budgetUsd}${priorCostUsd ? ` · 지난 실행 $${priorCostUsd}` : ''}`);

  const now = deps.now ?? (() => new Date());
  const tamperRoots = deps.tamperRoots ?? (deps.runAgent === claudeAgent ? TAMPER_ROOTS.map((r) => path.join(deps.repo, r)) : []);
  let limitUntil: Date | null = null;
  /** 지금도 한도 중인가(순수 판정) — 풀린 시각(+여유)이 지났으면 아니다(대기 횟수를 다 쓴 뒤에도 늦은 판이 영영 건너뛰지 않게, 10-25 리뷰). */
  const limitActive = (): Date | null => (limitUntil && limitUntil.getTime() + LIMIT_GRACE_MS > now().getTime() ? limitUntil : null);
  let wSeq = 0; // wNN 이름 — 기다리지 않고(이미 풀림) 다시 그린 판도 이름이 겹치지 않게
  // 한도 대기는 편 전체에서 센다(판마다 새로 세면 tNN·fNN 판이 또 몇 시간씩 기다린다).
  let waitRounds = 0;
  let waitedMs = 0;
  const limited = new Set<string>(); // 이번 판에서 한도로 못 그렸거나 띄우지 못한 장면
  // 비용 — 결과 줄이 있는 완료 묶음(비용·초). 결과 줄 없는 세션의 어림과 진행 중 묶음 예상의 바탕.
  const known: Array<{ usd: number; sec: number }> = [];
  const median = (xs: number[]): number | undefined => { if (!xs.length) return undefined; const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2; };
  const costOf = (run: AgentRun | undefined): { usd: number; estimated?: true } => {
    if (!run) return { usd: 0 };
    if (run.costUsd != null) { if (run.costUsd > 0 && run.durationSec > 0) known.push({ usd: run.costUsd, sec: run.durationSec }); return { usd: run.costUsd }; }
    const perSec = median(known.map((k) => k.usd / k.sec)) ?? SCENE_COST_PER_MIN_USD / 60;
    return { usd: Math.round(perSec * run.durationSec * 100) / 100, estimated: true };
  };
  let inflight = 0;
  const reserved = (): number => inflight * (median(known.map((k) => k.usd)) ?? SCENE_RESERVE_USD);
  const limitWhy = (u: Date) => `구독 세션 한도 — ${u.getHours()}시에 풀림`;
  const runOne = async (b: SceneSpec[], name: string, fix?: { note: string; seed: Array<{ file: string; content: string }> }): Promise<void> => {
    inflight++; // await 전에 — 풀이 다음 묶음을 띄울지 볼 때 이 묶음 예상 비용이 잡혀 있게
    try {
      const r = await runBatch(name, b, { sceneDir, kitApi, ...(title ? { title } : {}), deps, ...(signal ? { signal } : {}), ...(full ? { mode: full, clipsDir, species: speciesForBatch(b) } : {}), ...(fix ?? {}), tamperRoots });
      const cost = costOf(r.run);
      report.costUsd += cost.usd;
      report.perBatch[name] = { keys: b.map((s) => s.key), ...(r.run ? { turns: r.run.turns, costUsd: cost.usd, ...(cost.estimated ? { costEstimated: true as const } : {}), durationSec: r.run.durationSec, exit: r.run.exit, tail: r.run.tail } : {}) };
      if (cost.estimated) deps.log(`${name} 결과 줄 없음 — 비용 어림 $${cost.usd.toFixed(2)}(${r.run!.durationSec}초)`);
      const reset = sessionLimitReset(r.run?.tail, now());
      if (reset && (!limitUntil || reset > limitUntil)) limitUntil = reset;
      if (reset) for (const s of b) limited.add(s.key);
      const capped = (r.run?.turns ?? 0) >= deps.maxTurns; // CLI 는 상한 90 에 91 을 보고한다
      for (const s of b) if (!r.moved.includes(s.key)) fail.set(s.key, r.problem ?? (reset ? '구독 세션 한도로 파일 없음' : r.run?.aborted ? '세션 시간 초과·취소로 파일 없음' : capped ? `턴 상한 ${deps.maxTurns} 소진으로 파일 없음` : '에이전트가 파일을 쓰지 않음'));
      deps.activity?.(`[롱폼 그림] ${name} ${b[0]!.key}~${b[b.length - 1]!.key}(${b[0]!.chapterTitle}) — 파일 ${r.moved.length}/${b.length} · 턴 ${r.run?.turns ?? '?'} · $${cost.usd.toFixed(2)}${cost.estimated ? '(어림)' : ''}${r.problem ? ` · ${r.problem}` : ''}`);
    } catch (e) {
      const why = `묶음 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
      report.perBatch[name] = { keys: b.map((s) => s.key), skipped: why };
      for (const s of b) fail.set(s.key, why);
    } finally { inflight--; }
  };
  type FixOf = (b: SceneSpec[]) => { note: string; seed: Array<{ file: string; content: string }> };
  const drawAll = (bs: SceneSpec[][], nameOfB: (i: number) => string, fixOf?: FixOf) => pool(bs, deps.concurrency,
    () => { const lim = limitActive(); return signal?.aborted ? '취소됨' : report.costUsd + reserved() >= deps.budgetUsd ? `비용 상한 $${deps.budgetUsd} 도달${inflight ? `(진행 중 ${inflight}묶음 예상 포함)` : ''}` : lim ? limitWhy(lim) : null; },
    (b, i) => runOne(b, nameOfB(i), fixOf?.(b)),
    (b, i, why) => {
      report.perBatch[nameOfB(i)] = { keys: b.map((s) => s.key), skipped: why };
      for (const s of b) { fail.set(s.key, why); if (limitActive()) limited.add(s.key); }
    });
  /** 한도가 걸려 있으면 풀릴 때까지 기다린다 — 횟수(LIMIT_ROUNDS)·합(LIMIT_WAIT_MAX_MS)을 넘거나 취소면 false(기다리지 않음). */
  const waitLimit = async (n: number): Promise<boolean> => {
    if (!limitUntil) return true;
    const until = limitActive();
    if (!until) { limitUntil = null; return true; } // 이미 풀렸다 — 기다리지 않고(횟수도 안 셈) 바로
    const waitMs = Math.max(0, until.getTime() - now().getTime() + LIMIT_GRACE_MS);
    if (waitRounds >= LIMIT_ROUNDS || waitedMs + waitMs > LIMIT_WAIT_MAX_MS) {
      deps.log(`구독 세션 한도 — ${until.toLocaleString('ko-KR')} 에 풀려 ${waitRounds >= LIMIT_ROUNDS ? `대기 ${LIMIT_ROUNDS}번을 다 썼다` : '너무 멀다'}, ${n}장면은 장면 없이`);
      return false;
    }
    waitRounds++;
    deps.log(`구독 세션 한도 — ${until.getHours()}시 ${String(until.getMinutes()).padStart(2, '0')}분까지 기다렸다가 ${n}장면을 다시 그린다(${waitRounds}/${LIMIT_ROUNDS})`);
    deps.activity?.(`[롱폼 그림] 구독 세션 한도 — ${until.getHours()}시까지 대기 뒤 ${n}장면 다시`);
    await (deps.sleep ?? sleepAbortable)(waitMs, signal);
    if (signal?.aborted) return false;
    waitedMs += waitMs;
    limitUntil = null;
    return true;
  };
  /**
   * 한 판 그리기(첫 그림 bNN·빠진 장면 tNN·검사 탈락 fNN 이 같이 쓴다) — 한도에 걸리면 풀릴 때까지 기다렸다가 그 판에서 한도로 못 그린 장면만
   * 다시(wNN). pending = 아직 안 된 장면(bNN·tNN: 파일 없음, fNN: 깔아 준 그대로). 하네스 변조(TAMPERED)로 버린 묶음은 다시 안 그린다.
   */
  const drawRound = async (bs: SceneSpec[][], nameOfB: (i: number) => string, pending: (s: SceneSpec) => boolean, size: number, fixOf?: FixOf): Promise<void> => {
    if (!(await waitLimit(bs.flat().length))) return;
    limited.clear();
    await drawAll(bs, nameOfB, fixOf);
    // 이 판에서 한도에 걸렸으면(limitUntil — 풀린 시각이 지났어도) 그 장면만 다시. 이미 풀린 한도는 횟수를 안 세므로 판 수로도 막는다.
    for (let guard = 0; limitUntil && !signal?.aborted && guard <= LIMIT_ROUNDS; guard++) {
      const redo = bs.flat().filter((s) => limited.has(s.key) && pending(s) && !isTamper(fail.get(s.key)));
      if (!redo.length || !(await waitLimit(redo.length))) break;
      limited.clear();
      const w = (wSeq = Math.max(wSeq + 1, waitRounds));
      await drawAll(planBatches(redo, size), (i) => `w${w}${String(i + 1).padStart(2, '0')}`, fixOf);
    }
  };
  await drawRound(batches, nameOf, (s) => !hasFile(s), BATCH_MAX);
  // 턴 상한·시간 초과 등으로 파일이 없는 장면 — 절반 크기 묶음으로 한 번 더(묶음 이름 tNN). 상한·취소면 건너뛴다(한도는 drawRound 가 기다린다).
  const leftover = specs.filter((s) => !hasFile(s) && !isTamper(fail.get(s.key)));
  if (leftover.length && !signal?.aborted && report.costUsd < deps.budgetUsd) {
    deps.log(`빠진 ${leftover.length}장면을 ${REDO_BATCH_MAX}개씩 묶어 한 번 더 그린다`);
    deps.activity?.(`[롱폼 그림] 빠진 ${leftover.length}장면 다시(${REDO_BATCH_MAX}개씩)`);
    await drawRound(planBatches(leftover, REDO_BATCH_MAX), (i) => `t${String(i + 1).padStart(2, '0')}`, (s) => !hasFile(s), REDO_BATCH_MAX);
  }

  const finish = (pass: string[], extra: { entryPoint?: string; contact?: string } = {}): ScenesResult => {
    const keyBySeg = new Map(specs.filter((s) => pass.includes(s.key)).map((s) => [s.segId, s.key]));
    writeSceneKeys(dir, keyBySeg);
    report.built = pass.length;
    report.costUsd = Math.round(report.costUsd * 100) / 100;
    report.totalCostUsd = Math.round((priorCostUsd + report.costUsd) * 100) / 100;
    report.failed = specs.filter((s) => !pass.includes(s.key)).map((s) => ({ key: s.key, reason: fail.get(s.key) ?? '알 수 없음' }));
    fs.writeFileSync(path.join(sceneDir, 'report.json'), JSON.stringify(report, null, 2));
    deps.log(`장면 ${pass.length}/${specs.length}개 통과 · 비용 $${report.costUsd}${priorCostUsd ? `(지난 실행 포함 $${report.totalCostUsd})` : ''}${report.failed.length ? ` · 탈락 ${report.failed.length}` : ''}`);
    return { built: pass.length, costUsd: report.costUsd, ...extra };
  };
  if (signal?.aborted) return finish([]);

  // ── 사후 검사(에이전트를 믿지 않는다): 빠른 검사 → 타입 검사(한 번에) → 스틸(던지면 탈락)
  writeIfChanged(path.join(sceneDir, KIT_SHIM), full ? kitShimSourceFull(sceneDir, deps.repo, full.style, episodeSpeciesModule(dir)) : kitShimSource(sceneDir, deps.repo));
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const writeEntry = (keys: readonly string[]) => (full ? writeEpisodeEntryFull(dir, keys, deps.repo, full.style) : writeEpisodeEntry(dir, keys, deps.repo));
  const stillDir = path.join(sceneDir, 'stills');
  const fileOf = (k: string) => path.join(sceneDir, byKey.get(k)!.file);
  /** 통과한 순간의 파일 지문 — 최종 등록표 직전에 다시 대 본다(통과 뒤 바뀐 파일은 뺀다). */
  const passSha = new Map<string, string | null>();
  /**
   * 사후 검사 한 벌 — 첫 그림(전부)과 검토 뒤 다시 그린 장면(일부)이 같이 쓴다. keys 를 검사하고, 등록표에는 keep(이미 통과한 장면) + keys 를 싣는다.
   * 스틸은 outDir 에(`<key>_<pct>.png`, 침범 검사는 outDir/.probe). bundle = 번들 실패(그때 keys 전부 탈락).
   * infra = 장면 탓이 아닌 탈락(tsc 가 못 돎·브라우저가 죽음 — infraKeys) — 사유 '인프라: …'(fNN 에 넣지 않는다).
   */
  const postCheck = async (keys: readonly string[], keep: readonly string[], outDir: string): Promise<{ pass: string[]; bundle?: true; infra: string[] }> => {
    let pass: string[] = [];
    const infra: string[] = [];
    for (const k of keys) {
      const sp = byKey.get(k)!;
      const file = path.join(sceneDir, sp.file);
      if (!fs.existsSync(file)) continue;
      const p = lintScene(fs.readFileSync(file, 'utf8'), sp.key, sp.narration, full ? fullLintOpts(sp) : {});
      if (p.length) fail.set(sp.key, `검사: ${p.slice(0, 3).join(' / ')}`);
      else pass.push(sp.key);
    }
    if (pass.length) {
      const tc = await deps.typecheck(pass.map(fileOf), signal);
      const errOf = (k: string) => tc.get(path.resolve(fileOf(k))) ?? [];
      const bad = infraKeys(new Map(pass.filter((k) => errOf(k).length).map((k) => [k, errOf(k)[0]!])), pass.length);
      pass = pass.filter((k) => {
        const errs = errOf(k);
        if (errs.length) fail.set(k, bad.has(k) ? `인프라: ${errs[0]!.replace(/^인프라:\s*/, '')}` : `타입: ${errs.slice(0, 2).join(' / ')}`);
        if (bad.has(k)) infra.push(k);
        return !errs.length;
      });
    }
    if (!pass.length || signal?.aborted) return { pass: [], infra };
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
      return { pass: [], bundle: true, infra };
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
    const errOf = (k: string) => PREVIEW_AT.map((r) => { const v = stills.get(`${k}@${r}`); return v === undefined ? '스틸 없음' : v; }).filter((x): x is string => x !== null);
    const bad = infraKeys(new Map(pass.filter((k) => errOf(k).length).map((k) => [k, errOf(k)[0]!])), pass.length);
    return {
      pass: pass.filter((k) => {
        const errs = errOf(k);
        if (errs.length) fail.set(k, bad.has(k) ? `인프라: 렌더 ${errs[0]}` : `렌더 오류: ${errs[0]}`);
        else passSha.set(k, sha(fileOf(k)));
        if (bad.has(k)) infra.push(k);
        return !errs.length;
      }),
      infra,
    };
  };

  let first = await postCheck(specs.map((s) => s.key), [], stillDir);
  // 인프라 탈락(번들 실패·tsc 가 못 돎·브라우저가 죽음) — 장면 탓이 아니다. 세션을 띄우지 않고 사후 검사만 한 번 더.
  if (!signal?.aborted && (first.bundle || first.infra.length)) {
    const again = first.bundle ? specs.map((s) => s.key) : first.infra;
    deps.log(`⚠ 사후 검사 인프라 탈락 ${again.length}장면 — ${first.bundle ? fail.get(again.find((k) => fail.has(k)) ?? '') ?? '번들 실패' : fail.get(again[0]!)} — 사후 검사만 한 번 더`);
    const kept = first.bundle ? [] : first.pass;
    const re = await postCheck(again, kept, stillDir);
    first = re.bundle ? re : { pass: specs.map((s) => s.key).filter((k) => kept.includes(k) || re.pass.includes(k)), infra: re.infra };
    if (re.infra.length) deps.log(`⚠ 다시 해도 인프라 탈락 ${re.infra.length}장면 — 장면 없이(고치기 세션에 넣지 않는다)`);
  }
  if (first.bundle) { writeEntry([]); return finish([]); }
  let pass = first.pass;
  if (signal?.aborted) return finish([]);

  // ── 사후 검사 탈락(빠른 검사·타입·렌더) — 지금 파일과 오류를 깔아 주고 REDO_BATCH_MAX 개씩 한 번 고치게 한다(묶음 이름 fNN, 편당 FIX_MAX 장면).
  //    고친 파일만 다시 검사해 통과하면 넣는다. 못 고치면 종전처럼 장면 없이. 인프라 탈락('인프라:')은 넣지 않는다.
  const brokenAll = specs.filter((s) => !pass.includes(s.key) && hasFile(s) && /^(검사|타입|렌더 오류):/.test(fail.get(s.key) ?? ''));
  const broken = brokenAll.slice(0, FIX_MAX);
  if (brokenAll.length > broken.length) deps.log(`검사 탈락 ${brokenAll.length}장면 — 고치기 상한 ${FIX_MAX}, 나머지 ${brokenAll.length - broken.length}장면(${brokenAll.slice(FIX_MAX).map((s) => s.key).join(', ')})은 장면 없이`);
  if (broken.length && report.costUsd < deps.budgetUsd) {
    deps.log(`검사에서 떨어진 ${broken.length}장면(${broken.map((s) => s.key).join(', ')})을 오류를 붙여 한 번 더 고친다`);
    deps.activity?.(`[롱폼 그림] 검사 탈락 ${broken.length}장면 고치기`);
    const seeds = new Map(broken.map((s) => [s.key, fs.readFileSync(path.join(sceneDir, s.file), 'utf8')]));
    const unchanged = (s: SceneSpec) => { try { return fs.readFileSync(path.join(sceneDir, s.file), 'utf8') === seeds.get(s.key); } catch { return false; } };
    await drawRound(planBatches(broken, REDO_BATCH_MAX), (i) => `f${String(i + 1).padStart(2, '0')}`, unchanged, REDO_BATCH_MAX, (b) => ({
      seed: b.map((s) => ({ file: s.file, content: seeds.get(s.key)! })),
      note: [
        '────────── 하네스 사후 검사 탈락 — 이 묶음은 고치기다 ──────────',
        '이 폴더의 sNNN.tsx 는 이미 만든 장면인데, 끝난 뒤 하네스 검사에서 아래 오류로 떨어졌다. 오류를 고쳐 같은 파일에 다시 쓴다(Edit 로 고치거나 새로 Write). 그림의 좋은 점은 살린다. check → preview 절차는 같다 — ./check.sh 가 통과해야 끝난다.',
        ...b.map((s) => `- ${s.key}: ${fail.get(s.key)}`),
      ].join('\n'),
    }));
    if (signal?.aborted) return finish([]);
    const changed = broken.filter((s) => hasFile(s) && !unchanged(s)).map((s) => s.key);
    if (changed.length) {
      const fixDir = path.join(stillDir, 'fix');
      const pc = await postCheck(changed, pass, fixDir);
      for (const k of pc.pass) for (const r of PREVIEW_AT.map((x) => Math.round(x * 100))) {
        try { fs.copyFileSync(path.join(fixDir, `${k}_${r}.png`), path.join(stillDir, `${k}_${r}.png`)); } catch { /* 스틸 없음 */ }
      }
      pass = specs.map((s) => s.key).filter((k) => pass.includes(k) || pc.pass.includes(k));
      deps.log(`검사 탈락 고치기 — ${pc.pass.length}/${broken.length}개 통과`);
    }
    if (signal?.aborted) return finish([]);
  }
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
      deps, specs, byKey, sceneDir, stillDir, kitApi, report, fail, postCheck, costOf, tamperRoots, ...(title ? { title } : {}), ...(signal ? { signal } : {}),
      limitNote: () => { const lim = limitActive(); return lim ? limitWhy(lim) : null; },
      ...(full ? { mode: full, clipsDir, speciesOf: speciesOfSpec, speciesForBatch, ...(refs.length ? { refs } : {}) } : {}),
    });
    reviewOut = rv;
    if (signal?.aborted) return finish([]);
  }

  // 통과 뒤 바뀐 파일은 뺀다(통과본만 등록표에 — 다시 검사하지 않는다).
  const drifted = pass.filter((k) => sha(fileOf(k)) !== passSha.get(k));
  if (drifted.length) {
    deps.log(`⚠ 통과 뒤 파일이 바뀐 장면 ${drifted.length}개(${drifted.join(', ')}) — 등록표에서 뺀다`);
    for (const k of drifted) fail.set(k, '통과 뒤 파일이 바뀜 — 뺌');
    pass = pass.filter((k) => !drifted.includes(k));
    if (!pass.length) { writeEntry([]); return finish([]); }
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
  /** 세션 비용(결과 줄 없으면 어림)·변조 감지 폴더·구독 한도 중이면 그 사유(다시 그리지 않는다). */
  costOf: (run: AgentRun | undefined) => { usd: number; estimated?: true }; tamperRoots: readonly string[]; limitNote: () => string | null;
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
    // 구독 한도 중이면 기다리지 않고 건너뛴다 — 검토 다시 그리기는 다듬기(fail-open)라 몇 시간 붙잡을 값이 없다.
    const held = o.report.costUsd >= deps.budgetUsd ? `비용 상한 $${deps.budgetUsd} 도달` : o.limitNote();
    if (held) {
      rec.skipped = `${held} — 다시 그리지 않음`;
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
    const run = await runBatch('r01', specsR, { sceneDir, kitApi: o.kitApi, ...(o.title ? { title: o.title } : {}), deps, ...(o.signal ? { signal: o.signal } : {}), ...(o.mode ? { mode: o.mode } : {}), ...(o.clipsDir ? { clipsDir: o.clipsDir } : {}), ...(o.speciesForBatch ? { species: o.speciesForBatch(specsR) } : {}), note, seed, tamperRoots: o.tamperRoots });
    const cost = o.costOf(run.run);
    o.report.costUsd += cost.usd;
    o.report.perBatch.r01 = { keys: specsR.map((s) => s.key), ...(run.run ? { turns: run.run.turns, costUsd: cost.usd, ...(cost.estimated ? { costEstimated: true as const } : {}), durationSec: run.run.durationSec, exit: run.run.exit, tail: run.run.tail } : {}) };
    rec.costUsd = run.run ? cost.usd : undefined; rec.durationSec = Math.round((Date.now() - t0) / 1000);
    deps.activity?.(`[롱폼 다시 그리기] 검토 지적 ${redo.length}장면 → 세션 ${run.run?.turns ?? '?'}턴 · $${cost.usd.toFixed(2)}${cost.estimated ? '(어림)' : ''}`);
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
