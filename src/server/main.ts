/**
 * HTTP + SSE 서버 (Hono) — 단일 런타임. React 프론트(무접두 계약) + 자체 경량 UI(/lite).
 *
 * 런/이벤트/취소는 무접두(/runs…)와 /api/* 둘 다 등록(프론트는 무접두, 자체 UI는 /api).
 * 프론트 계약: /runs, /runs/:id/{events,log,cancel}, /llm, /company, /wiki/*, /approvals, 스텁들.
 */
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { CONFIG } from '../config';
import { ollama } from '../llm/ollama';
import { getSystemSpecs, autoAssignModels } from '../llm/models';
import { getLlmSetting, setLlmSetting, tierOverrides, resolveAssignment, isClaudeBackend } from '../llm/setting';
import { getRunSettings, setRunSettings } from '../runsettings';
import { EventType } from '../events/types';
import { createBus, getBus, disposeBus } from '../events/bus';
import type { EventBus } from '../events/bus';
import { runId } from '../util/ids';
import { startRun } from '../orchestrator/index';
import { getCompany, reloadCompany, editRole, deleteRole, addTeam, renameTeam, deleteTeam, addMember } from '../agents/company-loader';
import { rolesById } from '../agents/company';
import type { RoleDef } from '../agents/company';
import type { RolePatch, MemberBody } from '../agents/company-loader';
import { agentDetail, writeGoal, writeCapabilities, addSkill, deleteSkill, appendActivity, ensureScaffold, effectiveAutonomy, appendInjected, injectedLength, clearInjected, INJECTED_CAP } from '../agents/workspace';
import { listKeys, setKey, addCustom, deleteKey, hiddenKeys, restoreKey, getSecret } from '../secrets/store';
import { connectors } from '../grounding'; // 그라운딩 커넥터 등록(law·dart·custom) + mcpServers 노출
import { listCustomConfigs, saveCustomConfig, deleteCustomConfig, runCustomConnector, autoConfigConnector, type CustomConnectorCfg } from '../grounding/custom';
import { webSearch } from '../tools/web_search';
import { llmWiki, slugify } from '../wiki/llmwiki';
import { approvalStore } from '../approvals/store';
import { isAbort } from '../util/abort';
import { runRevise } from '../orchestrator/revise';
import type { FinalPosition } from '../orchestrator/finalize';
import { startAutoCycle, proposeContentIdeas, startDaily } from '../autonomy/scheduler';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cardNewsStore } from '../content/cardnews';
import type { CardNews } from '../content/cardnews';
import { runCardNewsJob, isCardNewsRunning } from '../orchestrator/cardnews';
import { shortsStore } from '../content/shorts';
import type { Shorts } from '../content/shorts';
import { runShortsJob, isShortsRunning } from '../orchestrator/shorts';
import { pieceStore, selectResumablePiece } from '../content/pieces';
import type { Piece } from '../content/pieces';
import { ingestMetrics } from '../analytics/reinforce';
import { parseManualMetrics, readMetrics, latestMetrics } from '../analytics/performance';
import { readStrategy } from '../analytics/strategy';
import { getCollector, setCollector } from '../analytics/collector';
import { notify, notifyConfigured } from '../autonomy/notify';
import { buildBriefing } from '../autonomy/briefing';
import { extractText, isSupportedExt } from '../tools/extract';
import { publishDraftToNaver, naverPublishCreds, collectNaverMetrics } from '../tools/blog_skills';
import { coerceBlogDraft } from '../output/smarteditor';
import type { MetricSample } from '../analytics/performance';
import { classifyAndAssign, getStatuses, reassign, setIngestStatus } from '../tools/classify';
import { transcribe, sttAvailable } from '../voice/stt';
import { synthesize, listKoreanVoices, ttsAvailable } from '../voice/tts';
import { getVoiceSettings, setVoiceSettings } from '../voice/setting';
import { jarvisChat } from '../jarvis/chat';

// 시간 기준 = 대한민국 표준시(KST). 스크립트(package.json)가 TZ 를 주지만, 직접 실행 대비 방어적으로
// 고정한다(이미 설정돼 있으면 존중). 로컬시간 기반 코드(nowDate·스케줄러)가 호스트 OS 와 무관하게 KST.
process.env.TZ ??= 'Asia/Seoul';

interface RunHandle {
  status: 'running' | 'done' | 'error' | 'cancelled';
  abort: AbortController;
  topic: string;
  created_ts: string;
  deliverable?: string;
  positions?: FinalPosition[];
  subproblems?: Array<{ id: string; text: string }>;
  version?: number;
  /** 자율 사이클이 띄운 런 — 사용자 런 도착 시 양보(abort) 대상. */
  auto?: boolean;
}

const RUNS = new Map<string, RunHandle>();
const RUNS_CAP = 200;
// 마지막 자율 사이클 런(있으면) — /autonomy/status 표출용.
let lastAutoRun: { ts: string; topic: string } | null = null;
/** RUNS 무한 누적 방지 — 캡 초과 시 오래된 '종료' 런부터 제거(running 보존, 이벤트는 events.jsonl 영속). */
function evictRuns(): void {
  if (RUNS.size <= RUNS_CAP) return;
  const finished = [...RUNS.entries()]
    .filter(([, h]) => h.status !== 'running')
    .sort((a, b) => a[1].created_ts.localeCompare(b[1].created_ts));
  for (const [id] of finished) {
    if (RUNS.size <= RUNS_CAP) break;
    RUNS.delete(id);
  }
}
const app = new Hono();

// 런 종료 시 이벤트 스트림을 디스크로 영속화 — 버스 폐기(30s)·재시작 후에도 replay 가능.
function persistEvents(id: string, busRef?: EventBus): void {
  // 클로저로 받은 버스 참조 우선 — eventsHandler 가 SSE 끊김 30초 뒤 disposeBus 로 맵에서
  // 제거해도(런 완료가 그 뒤면 getBus 가 null), 살아있는 객체로 항상 영속한다.
  const bus = busRef ?? getBus(id);
  if (!bus) return;
  try {
    const dir = path.join(CONFIG.sessionsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const lines = bus.replay(0).map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(path.join(dir, 'events.jsonl'), lines, 'utf-8');
  } catch { /* 영속 실패 무해 */ }
}
function loadPersistedEvents(id: string): unknown[] {
  try {
    const text = fs.readFileSync(path.join(CONFIG.sessionsDir, id, 'events.jsonl'), 'utf-8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

// 런 메타 사이드카(run.json) — 목록·재열기·HWPX 가 재시작/메모리 evict 후에도 디스크에서
// 완전 복원되도록 topic·status·deliverable 까지 영속. events.jsonl(이벤트 replay)과 별개.
interface PersistedMeta { run_id: string; topic: string; status: string; created_ts: string; deliverable: string; auto?: boolean; }
function persistRunMeta(id: string, h: RunHandle): void {
  try {
    const dir = path.join(CONFIG.sessionsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const meta: PersistedMeta = { run_id: id, topic: h.topic, status: h.status, created_ts: h.created_ts, deliverable: h.deliverable ?? '', auto: !!h.auto };
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta), 'utf-8');
  } catch { /* 영속 실패 무해 */ }
}
function loadRunMeta(id: string): PersistedMeta | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, id, 'run.json'), 'utf-8')) as Partial<PersistedMeta>;
    if (!m || typeof m.topic !== 'string') return null;
    return { run_id: id, topic: m.topic, status: m.status ?? 'done', created_ts: m.created_ts ?? '', deliverable: m.deliverable ?? '', auto: !!m.auto };
  } catch { return null; }
}
// 레거시 세션(run.json·events.jsonl 부재, _report.md 만 존재) — 과거 런을 잃지 않게 산출물 파일로 복원.
function legacyMetaFromFiles(id: string): PersistedMeta | null {
  try {
    const dir = path.join(CONFIG.sessionsDir, id);
    const reportPath = path.join(dir, '_report.md');
    if (!fs.existsSync(reportPath)) return null;
    const report = fs.readFileSync(reportPath, 'utf-8');
    // _report.md 형식: "# 최종 종합 — {topic}\n\n{deliverable}\n"
    const nl = report.indexOf('\n');
    const head = (nl >= 0 ? report.slice(0, nl) : report).trim();
    const topic = head.replace(/^#\s*최종\s*종합\s*[—\-]\s*/, '').trim() || id;
    const deliverable = nl >= 0 ? report.slice(nl + 1).replace(/^\s+/, '') : '';
    let created = '';
    try { created = fs.statSync(dir).mtime.toISOString(); } catch { /* */ }
    return { run_id: id, topic, status: 'done', created_ts: created, deliverable };
  } catch { return null; }
}

// ============================================================
// 런 라이프사이클 (무접두 + /api 양쪽 등록)
// ============================================================
interface LaunchOpts {
  agent?: string; path?: string; budgetUsd?: number; auto?: boolean; pieceId?: string;
  /** 리비전 런(검토 탭 '수정 요청') — 기존 초안+피드백으로 개정. 실패해도 ready 초안은 보존(에러 카운트 X). */
  revise?: { baseBody: string; feedback: string };
  /** 핵심 타겟 키워드(piece.keyword) — 포장 primaryKeyword 고정(SEO 게이트·리비전 과녁 고정). */
  keyword?: string;
}

// draft.json(6c)에서 piece 표시 메타 재로드 — 초안 asset 은 finalize 가 이미 디스크에 씀(메모리 의존 없음).
function readDraftMeta(runId: string): { title?: string; seoScore?: number; keyword?: string } | null {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, runId, 'draft.json'), 'utf-8')) as {
      titleCandidates?: string[]; primaryKeyword?: string; seo?: { score?: number };
    };
    return { title: d.titleCandidates?.[0], keyword: d.primaryKeyword, seoScore: d.seo?.score };
  } catch { return null; }
}

// 런 완료 → piece 를 'ready'(검토 대기)로 승격. draft.json 우선, 없으면(포장 실패) 본문(deliverable)으로 폴백.
// 초안·본문 모두 비면 산출 실패로 간주해 에러 카운트(다음 틱 재개 대상). '완전 자율'의 라이프사이클 전진 지점.
function advancePieceReady(pieceId: string, runId: string, deliverable: string): void {
  const draft = readDraftMeta(runId);
  if (!draft && !deliverable.trim()) { pieceStore().recordError(pieceId); return; }
  pieceStore().update(pieceId, {
    runId, stage: 'ready',
    ...(draft?.title ? { title: draft.title } : {}),
    ...(typeof draft?.seoScore === 'number' ? { seoScore: draft.seoScore } : {}),
    ...(draft?.keyword ? { keyword: draft.keyword } : {}),
  });
  // ready 도달 → 자동 네이버 임시저장 게이트(SEO 기준 통과 시 발행 담당이 저장, 미달 시 자동 리비전 1회).
  try { maybeAutoNaverDraft(pieceId); } catch { /* 무해 — 수동(검토 탭 버튼) 경로는 그대로 살아있다 */ }
}

/** 진행 중 자율(auto) 런을 모두 양보(abort) — 사용자 런(일반/revise) 도착 시 호출. */
function yieldRunningAutos(): void {
  for (const [, h] of RUNS) {
    if (h.auto && h.status === 'running') h.abort.abort();
  }
}

/** 런 1건을 띄우고 run_id 반환. startHandler(사용자)와 자율 사이클이 공유. */
function launchRun(topic: string, opts: LaunchOpts = {}): string {
  // 유휴 게이트 원자성 — 자율런은 진행 중 사용자 런이 하나라도 있으면 아예 띄우지 않는다(JS 단일스레드라
  // 스케줄러의 proposeTask await 동안 들어온 사용자 런이 이 동기 체크에 보여 레이스가 닫힌다).
  if (opts.auto) {
    if ([...RUNS.values()].some((h) => !h.auto && h.status === 'running')) return '';
  } else {
    yieldRunningAutos(); // 사용자 런 도착 → 진행 중 자율런 양보(단일 KV 슬롯·체감속도 우선)
  }
  const id = runId();
  const bus = createBus(id);
  const abort = new AbortController();
  const handle: RunHandle = { status: 'running', abort, topic, created_ts: new Date().toISOString(), auto: !!opts.auto };
  RUNS.set(id, handle);
  if (opts.auto) lastAutoRun = { ts: handle.created_ts, topic };
  evictRuns();

  startRun(bus, {
    topic, signal: abort.signal,
    agentId: opts.agent, path: opts.path, budgetUsd: opts.budgetUsd, revise: opts.revise, keyword: opts.keyword,
  })
    .then((outcome) => {
      handle.status = 'done';
      handle.deliverable = outcome.deliverable;
      handle.positions = outcome.positions;
      handle.subproblems = outcome.subproblems;
      // piece 라이프사이클 전진 — 초안 완성 → 'ready'(검토 대기, 지속형 레코드). 발행은 사람이 수동(POST /pieces/:id/published).
      if (opts.pieceId) { try { advancePieceReady(opts.pieceId, id, outcome.deliverable ?? ''); } catch { /* 무해 — piece 는 draft 로 남아 재개 */ } }
      // 자율 사이클 런 완료 → 알림(채널 설정 시에만 실제 발송).
      if (opts.auto && CONFIG.notifyAutoCycle && notifyConfigured()) {
        void notify({ title: `🤖 자율 사이클 완료 · ${topic}`, body: (outcome.deliverable || '(산출물 없음)').slice(0, 1200) });
      }
    })
    .catch((e: unknown) => {
      if (abort.signal.aborted || isAbort(e)) {
        // 사용자 취소(양보)를 '오류'로 오인하지 않게. piece 는 비종료 스테이지로 남아 다음 틱에 재개(에러 카운트 안 함).
        handle.status = 'cancelled';
        bus.emit(EventType.run_done, { status: 'cancelled' });
      } else {
        handle.status = 'error';
        // 실런 실패 → piece 에러 카운트(캡 초과 시 종료, 그 전엔 재개 대상). 취소와 구분해 폭주 방지.
        // 리비전 런 실패는 예외 — ready 초안이 멀쩡히 남아 있으므로 강등/카운트하지 않는다.
        if (opts.pieceId && !opts.revise) { try { pieceStore().recordError(opts.pieceId); } catch { /* 무해 */ } }
        bus.emit(EventType.error, { message: e instanceof Error ? e.message : String(e) });
        bus.emit(EventType.run_done, { status: 'error' });
      }
    })
    .finally(() => { persistEvents(id, bus); persistRunMeta(id, handle); });

  return id;
}

async function startHandler(c: Context): Promise<Response> {
  const body = await c.req
    .json<{ topic?: string; agent?: string; path?: string; budget_usd?: number }>()
    .catch(() => ({}) as { topic?: string; agent?: string; path?: string; budget_usd?: number });
  const topic = (body.topic ?? '').trim();
  if (!topic) return c.json({ error: 'topic 이 필요합니다' }, 400);

  const id = launchRun(topic, { agent: body.agent, path: body.path, budgetUsd: body.budget_usd });
  return c.json({ run_id: id });
}

function cancelHandler(c: Context): Response {
  const h = RUNS.get(c.req.param('id') ?? '');
  if (!h) return c.json({ error: 'unknown run' }, 404);
  h.abort.abort();
  h.status = 'cancelled';
  return c.json({ ok: true });
}

function runGetHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  const h = RUNS.get(id);
  if (h) return c.json({ run_id: id, status: h.status, topic: h.topic, deliverable: h.deliverable ?? null, created_ts: h.created_ts });
  // 메모리에 없으면(재시작/evict 후) 디스크에서 복원 — 기록 런 재열기 시 산출물까지 표출.
  const meta = loadRunMeta(id) ?? legacyMetaFromFiles(id);
  if (meta) return c.json({ run_id: id, status: meta.status, topic: meta.topic, deliverable: meta.deliverable || null, created_ts: meta.created_ts });
  return c.json({ error: 'unknown run' }, 404);
}

// SSE 끊김 후 bus 정리 타이머(런별). 재연결 시 취소하고, 실행 중이면 정리하지 않는다(아래 eventsHandler).
const _busDisposeTimers = new Map<string, NodeJS.Timeout>();

function eventsHandler(c: Context): Response | Promise<Response> {
  const id = c.req.param('id') ?? '';
  const bus = getBus(id);
  if (!bus) return c.text('unknown run', 404);
  // 재연결 — 직전 끊김으로 예약된 bus 정리 타이머를 취소(라이브 재개가 'unknown run' 으로 끊기지 않게).
  const pendingDispose = _busDisposeTimers.get(id);
  if (pendingDispose) { clearTimeout(pendingDispose); _busDisposeTimers.delete(id); }
  const lastId = Number(c.req.header('Last-Event-ID') ?? '0') || 0;

  return streamSSE(c, async (stream) => {
    const queue = bus.replay(lastId);
    let wake: (() => void) | null = null;
    let closed = false;
    const unsub = bus.subscribe((ev) => { queue.push(ev); wake?.(); });
    stream.onAbort(() => { closed = true; unsub(); wake?.(); });
    try {
      while (!closed) {
        while (queue.length) {
          const ev = queue.shift()!;
          await stream.writeSSE({ id: String(ev.seq), event: ev.type, data: JSON.stringify(ev) });
          if (ev.type === EventType.run_done) { closed = true; break; }
        }
        if (closed) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
          const t = setTimeout(resolve, CONFIG.ssePingSeconds * 1000);
          if (typeof t.unref === 'function') t.unref();
        });
        wake = null;
        if (!queue.length && !closed) await stream.writeSSE({ event: 'ping', data: '' });
      }
    } finally {
      unsub();
      // bus 정리는 (a) 실행이 끝났고 (b) 30초간 재연결이 없을 때만. 실행 중이면 보존하고 재예약 →
      // 끊김 후 재연결 시 라이브 재개 가능(이전엔 30초 뒤 무조건 dispose → 실행 중에도 'unknown run').
      // 런 종료 후엔 마지막 시청자 이탈 30초 뒤 정리(미정리 누수 방지). 재연결 시 위에서 타이머 취소.
      const scheduleDispose = () => {
        const t = setTimeout(() => {
          _busDisposeTimers.delete(id);
          if (RUNS.get(id)?.status === 'running') { scheduleDispose(); return; } // 아직 실행 중 → 보존, 다시 미룸
          disposeBus(id);
        }, 30_000);
        if (typeof t.unref === 'function') t.unref();
        _busDisposeTimers.set(id, t);
      };
      scheduleDispose();
    }
  });
}

// 영속 세션(data/sessions/*)에서 런 메타 복원 — 서버 재시작/메모리 evict 후에도 기록 보존.
// 우선순위: run.json(완전 메타) → events.jsonl(이벤트 파싱) → 레거시 _report.md(과거 런).
function listPersistedRuns(): PersistedMeta[] {
  const dir = CONFIG.sessionsDir;
  if (!fs.existsSync(dir)) return [];
  const out: PersistedMeta[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue; // data/sessions 에 끼어든 파일 무시(읽기 에러 silent swallow 방지)
    const id = ent.name;
    const meta = loadRunMeta(id);
    if (meta) { out.push(meta); continue; }
    const evs = loadPersistedEvents(id) as Array<{ type?: string; ts?: string; payload?: Record<string, unknown> }>;
    if (evs.length) {
      let topic = '', status = 'done', created = '';
      for (const e of evs) {
        if (e.type === 'run_started' && typeof e.payload?.topic === 'string') topic = e.payload.topic;
        if (e.type === 'run_done' && typeof e.payload?.status === 'string') status = e.payload.status;
        if (!created && e.ts) created = e.ts;
      }
      // topic 누락 시에도 드롭하지 않고 폴백 — run_started 가 바뀌어도 런이 조용히 사라지지 않게.
      const legacy = topic ? null : legacyMetaFromFiles(id);
      out.push({ run_id: id, topic: topic || legacy?.topic || '(제목 없음)', status, created_ts: created || legacy?.created_ts || '', deliverable: legacy?.deliverable ?? '' });
      continue;
    }
    const legacy = legacyMetaFromFiles(id);
    if (legacy) out.push(legacy);
  }
  return out;
}
function listRunsHandler(c: Context): Response {
  // 자율 사이클이 띄운 런(auto)은 사용자 기록 탭을 오염시키지 않게 제외(직접 /runs/:id 접근은 가능).
  const mem = [...RUNS.entries()]
    .filter(([, h]) => !h.auto)
    .map(([id, h]) => ({ run_id: id, topic: h.topic, status: h.status, total_cost: 0, created_ts: h.created_ts, active: h.status === 'running' }));
  const memIds = new Set(RUNS.keys());
  // 영속 세션 — 메모리에 없는 과거 런만 합쳐 재시작 후에도 기록 탭에 표출(자율런은 제외).
  const persisted = listPersistedRuns()
    .filter((r) => !memIds.has(r.run_id) && !r.auto)
    .map((r) => ({ run_id: r.run_id, topic: r.topic, status: r.status, total_cost: 0, created_ts: r.created_ts, active: false }));
  const runs = [...mem, ...persisted].sort((a, b) => (b.created_ts || '').localeCompare(a.created_ts || ''));
  return c.json({ runs });
}

// 레거시 런(events.jsonl 부재) — 산출물 메타로 최소 이벤트를 합성해 replay 가 리포트를 표출하게.
// reducer 가 agent_message(block_id 'ceo-synth')의 text 로 synthesis 패널을 채운다(reducer.ts:349).
function synthEventsFromMeta(m: PersistedMeta): unknown[] {
  const ts = m.created_ts || new Date().toISOString();
  return [
    { v: 1, type: 'run_started', run_id: m.run_id, seq: 1, ts, payload: { topic: m.topic } },
    { v: 1, type: 'agent_message', run_id: m.run_id, seq: 2, ts, agent_id: 'ceo', payload: { block_id: 'ceo-synth', stage: 'synthesis', text: m.deliverable } },
    { v: 1, type: 'run_done', run_id: m.run_id, seq: 3, ts, payload: { status: m.status } },
  ];
}
function runLogHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  const bus = getBus(id);
  if (bus) return c.json({ events: bus.replay(0) }); // 버스 생존 시 메모리 버퍼
  const evs = loadPersistedEvents(id);
  if (evs.length) return c.json({ events: evs }); // 영속 이벤트 replay
  // events.jsonl 부재(레거시/메타만) → 산출물로 최소 이벤트 합성(빈 화면 대신 리포트 표출).
  const meta = loadRunMeta(id) ?? legacyMetaFromFiles(id);
  return c.json({ events: meta && meta.deliverable.trim() ? synthEventsFromMeta(meta) : [] });
}

app.post('/runs', startHandler);
app.post('/api/runs', startHandler);
app.get('/runs', listRunsHandler);
app.get('/runs/eta', (c) => c.json({ sample: 0, stages: {}, total_sec: null, cost_usd: null })); // /runs/:id 보다 먼저
app.get('/runs/:id/events', eventsHandler);
app.get('/api/runs/:id/events', eventsHandler);
app.get('/runs/:id/log', runLogHandler);
app.post('/runs/:id/cancel', cancelHandler);
app.post('/api/runs/:id/cancel', cancelHandler);
app.get('/runs/:id', runGetHandler);
app.get('/api/runs/:id', runGetHandler);
// 미구현 런 동작(프론트가 실패를 우아하게 처리) — 명시적 스텁
app.delete('/runs/:id', (c) => {
  const id = c.req.param('id') ?? '';
  // 이 런의 세션(draft.json)을 참조하는 초안 카드가 있으면 거절 — 런 삭제가 검토 대기 초안을
  // 소리 없이 증발시키는 사고 방지(실사고: 검토 탭 '초안 없음' 미스터리의 원인). 카드 먼저 삭제.
  const ref = pieceStore().list().find((p) => p.runId === id);
  if (ref) return c.json({ error: `초안 "${ref.title.slice(0, 30)}" 카드가 이 런을 참조합니다 — 캘린더/검토 탭에서 카드를 먼저 삭제하세요.` }, 409);
  RUNS.get(id)?.abort.abort();
  RUNS.delete(id);
  // 영속 세션(data/sessions/{id})도 삭제 — 안 지우면 /runs 가 영속에서 다시 복원해 '삭제 안 됨'으로 보인다.
  if (id && !/[/\\]|\.\./.test(id)) { try { fs.rmSync(path.join(CONFIG.sessionsDir, id), { recursive: true, force: true }); } catch { /* 무해 */ } }
  return c.json({ ok: true });
});
app.post('/runs/:id/message', (c) => c.json({ ok: true }));

// ============================================================
// 콘텐츠 piece — 완전 자율 캘린더 저장소(크로스-런). 프론트는 REST 폴링으로 읽는다(UIState/fold 금지 — 스크럽 시 수치 변형 방지).
// ============================================================
/** 파생 콘텐츠 요약(카드뉴스·숏폼) — 캘린더 배지·검토 미리보기·성과 컬럼용. 최신 1건씩. */
interface DerivedSummary {
  cardnews?: { id: string; stage: string; slides?: number; running: boolean };
  shorts?: { id: string; stage: string; durationSec?: number; running: boolean };
}
function derivedSummary(pieceId: string): DerivedSummary {
  const out: DerivedSummary = {};
  const cn = cardNewsStore().list().find((x) => x.sourcePieceId === pieceId); // list() 최신순 → 첫 매치 = 최신
  if (cn) out.cardnews = { id: cn.id, stage: cn.stage, slides: cn.slides, running: isCardNewsRunning(cn.id) };
  const sh = shortsStore().list().find((x) => x.sourcePieceId === pieceId);
  if (sh) out.shorts = { id: sh.id, stage: sh.stage, durationSec: sh.durationSec, running: isShortsRunning(sh.id) };
  return out;
}

function piecesListHandler(c: Context): Response {
  return c.json({ pieces: pieceStore().list().map((p) => ({ ...p, derived: derivedSummary(p.id) })) });
}
async function pieceCreateHandler(c: Context): Promise<Response> {
  const body = await c.req.json<{ title?: string; keyword?: string; subNiche?: string }>().catch(() => ({}) as { title?: string; keyword?: string; subNiche?: string });
  const title = (body.title ?? '').trim();
  if (!title) return c.json({ error: 'title 이 필요합니다' }, 400);
  return c.json({ piece: pieceStore().create({ title, keyword: body.keyword, subNiche: body.subNiche }) });
}
function pieceGetHandler(c: Context): Response {
  const p = pieceStore().get(c.req.param('id') ?? '');
  return p ? c.json({ piece: p }) : c.json({ error: 'unknown piece' }, 404);
}
// piece 삭제(캘린더·검토·성과 탭 카드 제거) — 실행 중 런/네이버 잡/성과 수집이 있으면 거절.
// 산출물 파일(data/sessions, 성과 샘플)은 지우지 않는다 — 카드(인덱스)만 제거하는 비파괴 삭제.
function pieceDeleteHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  const piece = pieceStore().get(id);
  if (!piece) return c.json({ error: 'unknown piece' }, 404);
  if ([...RUNS.values()].some((h) => h.status === 'running' && h.topic === piece.title)) {
    return c.json({ error: '이 카드의 런이 실행 중입니다 — 취소 후 삭제하세요.' }, 409);
  }
  if (NAVER_DRAFT_JOBS.get(id)?.status === 'running') {
    return c.json({ error: '네이버 임시저장이 진행 중입니다 — 완료 후 삭제하세요.' }, 409);
  }
  if (COLLECT_JOBS.get(id)?.status === 'running') {
    return c.json({ error: '성과 수집이 진행 중입니다 — 완료 후 삭제하세요.' }, 409);
  }
  NAVER_DRAFT_JOBS.delete(id); // 지난 잡 기록 정리(메모리)
  COLLECT_JOBS.delete(id);
  pieceStore().remove(id);
  return c.json({ ok: true });
}
// 발행(수동) — 사람이 네이버에 게시 후 URL 등록 → 'published'. 성과 측정(6d)의 앵커.
async function piecePublishedHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  if (!pieceStore().get(id)) return c.json({ error: 'unknown piece' }, 404);
  const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
  const url = (body.url ?? '').trim();
  if (!url) return c.json({ error: 'url 이 필요합니다' }, 400);
  return c.json({ piece: pieceStore().setPublished(id, url) });
}
// 성과 측정치 수집(v1 주 경로 = 수동 입력) — 사람이 네이버 통계에서 붙여넣기 → 강화 루프 트리거(멱등).
async function pieceMetricsPostHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  if (!pieceStore().get(id)) return c.json({ error: 'unknown piece' }, 404);
  const body = await c.req.json<unknown>().catch(() => ({}));
  const sample = parseManualMetrics(body);
  const r = await ingestMetrics(id, sample);
  return c.json({ ok: r.recorded, reinforced: r.reinforced, sample, piece: pieceStore().get(id) });
}
function pieceMetricsGetHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  if (!pieceStore().get(id)) return c.json({ error: 'unknown piece' }, 404);
  return c.json({ metrics: readMetrics(id) });
}
// 초안 재로드 — DraftReview 가 본문/렌더/메타를 디스크(data/sessions/<runId>/)에서 읽는다(메모리 의존 없음).
function pieceDraftHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  const p = pieceStore().get(id);
  if (!p) return c.json({ error: 'unknown piece' }, 404);
  if (!p.runId) return c.json({ error: 'no draft yet' }, 404);
  try {
    const dir = path.join(CONFIG.sessionsDir, p.runId);
    const draft = JSON.parse(fs.readFileSync(path.join(dir, 'draft.json'), 'utf-8')) as unknown;
    const read = (n: string): string => { try { return fs.readFileSync(path.join(dir, n), 'utf-8'); } catch { return ''; } };
    // 미리보기 iframe(srcDoc)에서 draft.html 의 상대 이미지(images/blog-image-0N.png)가 로드되게 <base> 주입.
    let html = read('draft.html');
    if (html) {
      const base = `<base href="/pieces/${id}/">`;
      html = html.includes('<head>') ? html.replace('<head>', `<head>\n${base}`) : `${base}\n${html}`;
    }
    return c.json({ piece: p, draft, md: read('draft.md'), html });
  } catch { return c.json({ error: 'draft not found' }, 404); }
}
// 세션 생성 이미지 서빙 — draft.html 의 상대경로가 위 <base> 로 이 라우트에 해석된다. 이름 화이트리스트(경로 이탈 차단).
function pieceImageHandler(c: Context): Response {
  const p = pieceStore().get(c.req.param('id') ?? '');
  const name = c.req.param('name') ?? '';
  if (!p?.runId) return c.json({ error: 'unknown piece' }, 404);
  if (!/^blog-image-\d{2}\.(?:png|jpg|jpeg|webp)$/.test(name)) return c.json({ error: 'bad name' }, 400);
  try {
    const buf = fs.readFileSync(path.join(CONFIG.sessionsDir, p.runId, 'images', name));
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return c.body(new Uint8Array(buf), 200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  } catch { return c.json({ error: 'image not found' }, 404); }
}
app.get('/pieces', piecesListHandler);
app.get('/api/pieces', piecesListHandler);
app.get('/calendar', piecesListHandler); // 캘린더 데이터 = piece 목록(별칭)
app.get('/api/calendar', piecesListHandler);
app.post('/pieces', pieceCreateHandler);
app.post('/api/pieces', pieceCreateHandler);
app.get('/pieces/:id/draft', pieceDraftHandler); // :id 보다 먼저(구체 경로 우선)
app.get('/api/pieces/:id/draft', pieceDraftHandler);
app.get('/pieces/:id/images/:name', pieceImageHandler); // 미리보기 <base href="/pieces/:id/"> 상대경로 대상
app.get('/api/pieces/:id/images/:name', pieceImageHandler);
app.get('/pieces/:id', pieceGetHandler);
app.get('/api/pieces/:id', pieceGetHandler);
app.delete('/pieces/:id', pieceDeleteHandler);
app.delete('/api/pieces/:id', pieceDeleteHandler);

// ============================================================
// 카드뉴스 — 카드뉴스팀(standby) 전용 파이프라인. 블로그 org 런과 무관, 발행 없음(다운로드 전용).
// 잡은 백그라운드로 돌고 프론트는 목록/상세 GET 폴링(네이버 임시저장 잡과 동일 패턴).
// ============================================================
const execFileP = promisify(execFile);

/** 담당자 실명(기획·디자인) — 로스터에서 해석해 카드 레코드에 표기(UI용). */
function cardActorNames(): { planner?: string; designer?: string } {
  try {
    const roles = rolesById(getCompany());
    return { planner: roles.get('cardnews_planner')?.name, designer: roles.get('cardnews_designer')?.name };
  } catch { return {}; }
}

// 카드뉴스 잡을 '런'으로 등록 — 오피스 뷰·활동 피드·타임라인이 런 이벤트로 구동되므로, 버스를
// 흘리면 송하영·민준호가 실제로 일하는 모습(스폰·작업 애니메이션·스트림·지표)이 그대로 보인다.
// 런 취소 버튼 → abort 로 잡 중단까지 연결. 완료 시 이벤트 영속(리플레이 가능).
function launchCardNewsRun(cardId: string, topic: string, opts: { sourceBody?: string; slideCount?: number } = {}): string {
  const id = runId();
  const bus = createBus(id);
  const abort = new AbortController();
  const handle: RunHandle = {
    status: 'running', abort, topic: `카드뉴스: ${topic}`.slice(0, 80), created_ts: new Date().toISOString(), auto: false,
  };
  RUNS.set(id, handle);
  evictRuns();
  bus.emit(EventType.run_started, { topic: handle.topic });
  runCardNewsJob(cardId, { ...opts, bus, signal: abort.signal })
    .then(() => {
      const card = cardNewsStore().get(cardId);
      if (abort.signal.aborted) { handle.status = 'cancelled'; bus.emit(EventType.run_done, { status: 'cancelled' }); return; }
      if (card?.stage === 'ready') {
        handle.status = 'done';
        handle.deliverable = [`카드뉴스 ${card.slides ?? 0}장 완성 — ${card.topic}`, card.caption ?? ''].filter(Boolean).join('\n\n');
        bus.emit(EventType.run_done, { status: 'done' });
      } else {
        handle.status = 'error';
        bus.emit(EventType.error, { message: card?.error ?? '카드뉴스 생성 실패' });
        bus.emit(EventType.run_done, { status: 'error' });
      }
    })
    .catch((e: unknown) => {
      handle.status = abort.signal.aborted ? 'cancelled' : 'error';
      if (!abort.signal.aborted) bus.emit(EventType.error, { message: e instanceof Error ? e.message : String(e) });
      bus.emit(EventType.run_done, { status: handle.status });
    })
    .finally(() => { persistEvents(id, bus); persistRunMeta(id, handle); });
  return id;
}

async function cardNewsCreateHandler(c: Context): Promise<Response> {
  const b = await c.req.json<{ topic?: string; keyword?: string; slides?: number }>()
    .catch(() => ({}) as { topic?: string; keyword?: string; slides?: number });
  const topic = (b.topic ?? '').trim();
  if (!topic) return c.json({ error: 'topic 이 필요합니다' }, 400);
  const card = cardNewsStore().create({ topic, keyword: b.keyword, ...cardActorNames() });
  const run = launchCardNewsRun(card.id, topic, { slideCount: b.slides });
  return c.json({ card, run_id: run });
}

// 블로그 초안 → 카드뉴스 파생(공용) — 초안 본문을 기획자에게 넘겨 슬라이드로 재구성(복붙 아님).
// 검토 탭 수동 버튼과 '네이버 임시저장 성공' 자동 훅이 공유한다.
function deriveCardNewsFromPiece(pieceId: string, slides?: number): { card: CardNews } | { error: string } {
  const piece = pieceStore().get(pieceId);
  if (!piece) return { error: 'unknown piece' };
  if (!piece.runId) return { error: '초안이 아직 없습니다.' };
  let body = '';
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, piece.runId, 'draft.json'), 'utf-8')) as { bodyMarkdown?: string };
    body = (d.bodyMarkdown ?? '').trim();
  } catch { /* 아래에서 거절 */ }
  if (!body) return { error: '초안 본문(draft.json)을 읽을 수 없습니다.' };
  const card = cardNewsStore().create({
    topic: piece.title, keyword: piece.keyword, sourcePieceId: piece.id, ...cardActorNames(),
  });
  launchCardNewsRun(card.id, piece.title, { sourceBody: body, slideCount: slides });
  return { card };
}
async function cardNewsFromPieceHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  if (!pieceStore().get(id)) return c.json({ error: 'unknown piece' }, 404);
  const b = await c.req.json<{ slides?: number }>().catch(() => ({}) as { slides?: number });
  const r = deriveCardNewsFromPiece(id, b.slides);
  if ('error' in r) return c.json({ error: r.error }, r.error === 'unknown piece' ? 404 : 409);
  return c.json({ card: r.card });
}

function cardNewsListHandler(c: Context): Response {
  return c.json({ cards: cardNewsStore().list().map((x) => ({ ...x, running: isCardNewsRunning(x.id) })) });
}
function cardNewsGetHandler(c: Context): Response {
  const x = cardNewsStore().get(c.req.param('id') ?? '');
  return x ? c.json({ card: { ...x, running: isCardNewsRunning(x.id) } }) : c.json({ error: 'unknown card' }, 404);
}
// 슬라이드 PNG 서빙 — 이름 화이트리스트(경로 이탈 차단).
function cardNewsSlideHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  const name = c.req.param('name') ?? '';
  if (!cardNewsStore().get(id)) return c.json({ error: 'unknown card' }, 404);
  if (!/^slide_\d{2}\.png$/.test(name)) return c.json({ error: 'bad name' }, 400);
  try {
    const buf = fs.readFileSync(path.join(cardNewsStore().dirFor(id), name));
    return c.body(new Uint8Array(buf), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
  } catch { return c.json({ error: 'slide not found' }, 404); }
}
// 전체 zip 다운로드 — 슬라이드 PNG + 캡션. 시스템 zip(-j 평탄화) 사용, 매 요청 재생성(간단·항상 최신).
async function cardNewsZipHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const card = cardNewsStore().get(id);
  if (!card) return c.json({ error: 'unknown card' }, 404);
  if (card.stage !== 'ready') return c.json({ error: '아직 완성되지 않았습니다.' }, 409);
  const dir = cardNewsStore().dirFor(id);
  const files = fs.readdirSync(dir).filter((f) => /^slide_\d{2}\.png$/.test(f) || f === 'caption.txt').sort();
  if (!files.length) return c.json({ error: '산출물이 없습니다.' }, 404);
  const zipPath = path.join(dir, 'cardnews.zip');
  try { fs.rmSync(zipPath, { force: true }); } catch { /* 무해 */ }
  try {
    await execFileP('/usr/bin/zip', ['-j', '-q', zipPath, ...files.map((f) => path.join(dir, f))]);
    const buf = fs.readFileSync(zipPath);
    return c.body(new Uint8Array(buf), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="cardnews-${id}.zip"`,
    });
  } catch (e) {
    return c.json({ error: `zip 생성 실패: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
}
function cardNewsDeleteHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  if (!cardNewsStore().get(id)) return c.json({ error: 'unknown card' }, 404);
  if (isCardNewsRunning(id)) return c.json({ error: '생성이 진행 중입니다 — 완료 후 삭제하세요.' }, 409);
  cardNewsStore().remove(id); // 산출물 파일은 남김(비파괴 — pieces 삭제와 동일 원칙)
  return c.json({ ok: true });
}

app.post('/cardnews', cardNewsCreateHandler);
app.post('/api/cardnews', cardNewsCreateHandler);
app.post('/pieces/:id/cardnews', cardNewsFromPieceHandler);
app.post('/api/pieces/:id/cardnews', cardNewsFromPieceHandler);
app.get('/cardnews', cardNewsListHandler);
app.get('/api/cardnews', cardNewsListHandler);
app.get('/cardnews/:id/slides/:name', cardNewsSlideHandler); // :id 보다 먼저(구체 경로 우선)
app.get('/api/cardnews/:id/slides/:name', cardNewsSlideHandler);
app.get('/cardnews/:id/zip', cardNewsZipHandler);
app.get('/api/cardnews/:id/zip', cardNewsZipHandler);
app.get('/cardnews/:id', cardNewsGetHandler);
app.get('/api/cardnews/:id', cardNewsGetHandler);
app.delete('/cardnews/:id', cardNewsDeleteHandler);
app.delete('/api/cardnews/:id', cardNewsDeleteHandler);

// ============================================================
// 숏폼 — 숏폼팀(standby) 전용 파이프라인. 카드뉴스와 동일 구조(런 등록 = 오피스 뷰 연동,
// GET 폴링, 발행 없음 — 다운로드 전용). 산출물: 세로 MP4 + srt + 캡션.
// ============================================================

/** 담당자 실명(작가·디렉터) — 로스터에서 해석해 레코드에 표기(UI용). */
function shortsActorNames(): { writer?: string; director?: string } {
  try {
    const roles = rolesById(getCompany());
    return { writer: roles.get('shorts_writer')?.name, director: roles.get('shorts_director')?.name };
  } catch { return {}; }
}

// 숏폼 잡을 '런'으로 등록 — 유하린·서준영의 스폰·작업·지표가 오피스 뷰에 흐르고,
// 런 취소 → abort 로 잡 중단, 완료 시 이벤트 영속(리플레이). launchCardNewsRun 과 동일 패턴.
function launchShortsRun(shortsId: string, topic: string, opts: { sourceBody?: string; sceneCount?: number } = {}): string {
  const id = runId();
  const bus = createBus(id);
  const abort = new AbortController();
  const handle: RunHandle = {
    status: 'running', abort, topic: `숏폼: ${topic}`.slice(0, 80), created_ts: new Date().toISOString(), auto: false,
  };
  RUNS.set(id, handle);
  evictRuns();
  bus.emit(EventType.run_started, { topic: handle.topic });
  runShortsJob(shortsId, { ...opts, bus, signal: abort.signal })
    .then(() => {
      const s = shortsStore().get(shortsId);
      if (abort.signal.aborted) { handle.status = 'cancelled'; bus.emit(EventType.run_done, { status: 'cancelled' }); return; }
      if (s?.stage === 'ready') {
        handle.status = 'done';
        handle.deliverable = [
          `숏폼 ${s.durationSec ?? 0}초 · 씬 ${s.scenes ?? 0}개 완성 — ${s.title ?? s.topic}`,
          s.description ?? '', (s.hashtags ?? []).join(' '),
        ].filter(Boolean).join('\n\n');
        bus.emit(EventType.run_done, { status: 'done' });
      } else {
        handle.status = 'error';
        bus.emit(EventType.error, { message: s?.error ?? '숏폼 생성 실패' });
        bus.emit(EventType.run_done, { status: 'error' });
      }
    })
    .catch((e: unknown) => {
      handle.status = abort.signal.aborted ? 'cancelled' : 'error';
      if (!abort.signal.aborted) bus.emit(EventType.error, { message: e instanceof Error ? e.message : String(e) });
      bus.emit(EventType.run_done, { status: handle.status });
    })
    .finally(() => { persistEvents(id, bus); persistRunMeta(id, handle); });
  return id;
}

async function shortsCreateHandler(c: Context): Promise<Response> {
  const b = await c.req.json<{ topic?: string; keyword?: string; scenes?: number }>()
    .catch(() => ({}) as { topic?: string; keyword?: string; scenes?: number });
  const topic = (b.topic ?? '').trim();
  if (!topic) return c.json({ error: 'topic 이 필요합니다' }, 400);
  const short = shortsStore().create({ topic, keyword: b.keyword, ...shortsActorNames() });
  const run = launchShortsRun(short.id, topic, { sceneCount: b.scenes });
  return c.json({ short, run_id: run });
}

// 블로그 초안 → 숏폼 파생(공용) — 검토 탭 버튼·네이버 저장 성공 자동 훅이 공유.
function deriveShortsFromPiece(pieceId: string, scenes?: number): { short: Shorts } | { error: string } {
  const piece = pieceStore().get(pieceId);
  if (!piece) return { error: 'unknown piece' };
  if (!piece.runId) return { error: '초안이 아직 없습니다.' };
  let body = '';
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, piece.runId, 'draft.json'), 'utf-8')) as { bodyMarkdown?: string };
    body = (d.bodyMarkdown ?? '').trim();
  } catch { /* 아래에서 거절 */ }
  if (!body) return { error: '초안 본문(draft.json)을 읽을 수 없습니다.' };
  const short = shortsStore().create({
    topic: piece.title, keyword: piece.keyword, sourcePieceId: piece.id, ...shortsActorNames(),
  });
  launchShortsRun(short.id, piece.title, { sourceBody: body, sceneCount: scenes });
  return { short };
}
async function shortsFromPieceHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  if (!pieceStore().get(id)) return c.json({ error: 'unknown piece' }, 404);
  const b = await c.req.json<{ scenes?: number }>().catch(() => ({}) as { scenes?: number });
  const r = deriveShortsFromPiece(id, b.scenes);
  if ('error' in r) return c.json({ error: r.error }, r.error === 'unknown piece' ? 404 : 409);
  return c.json({ short: r.short });
}

function shortsListHandler(c: Context): Response {
  return c.json({ shorts: shortsStore().list().map((x) => ({ ...x, running: isShortsRunning(x.id) })) });
}
function shortsGetHandler(c: Context): Response {
  const x = shortsStore().get(c.req.param('id') ?? '');
  return x ? c.json({ short: { ...x, running: isShortsRunning(x.id) } }) : c.json({ error: 'unknown short' }, 404);
}
// MP4 서빙 — Range 지원(Safari 는 Range 없이는 <video> 재생 거부, Chrome 도 시킹에 필요).
function shortsVideoHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  if (!shortsStore().get(id)) return c.json({ error: 'unknown short' }, 404);
  const fp = path.join(shortsStore().dirFor(id), 'final.mp4');
  let size = 0;
  try { size = fs.statSync(fp).size; } catch { return c.json({ error: 'video not found' }, 404); }
  const range = c.req.header('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2]!, 10));
    const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (!Number.isFinite(start) || start >= size || start > end) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }
    const fd = fs.openSync(fp, 'r');
    try {
      const buf = Buffer.alloc(end - start + 1);
      fs.readSync(fd, buf, 0, buf.length, start);
      return c.body(new Uint8Array(buf), 206, {
        'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(buf.length),
      });
    } finally { fs.closeSync(fd); }
  }
  const buf = fs.readFileSync(fp);
  return c.body(new Uint8Array(buf), 200, {
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(size),
  });
}
// 전체 zip — MP4 + 자막(srt) + 캡션. 매 요청 재생성(항상 최신).
async function shortsZipHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const s = shortsStore().get(id);
  if (!s) return c.json({ error: 'unknown short' }, 404);
  if (s.stage !== 'ready') return c.json({ error: '아직 완성되지 않았습니다.' }, 409);
  const dir = shortsStore().dirFor(id);
  const files = ['final.mp4', 'subtitles.srt', 'caption.txt'].filter((f) => fs.existsSync(path.join(dir, f)));
  if (!files.length) return c.json({ error: '산출물이 없습니다.' }, 404);
  const zipPath = path.join(dir, 'shorts.zip');
  try { fs.rmSync(zipPath, { force: true }); } catch { /* 무해 */ }
  try {
    await execFileP('/usr/bin/zip', ['-j', '-q', zipPath, ...files.map((f) => path.join(dir, f))]);
    const buf = fs.readFileSync(zipPath);
    return c.body(new Uint8Array(buf), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="shorts-${id}.zip"`,
    });
  } catch (e) {
    return c.json({ error: `zip 생성 실패: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
}
function shortsDeleteHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  if (!shortsStore().get(id)) return c.json({ error: 'unknown short' }, 404);
  if (isShortsRunning(id)) return c.json({ error: '생성이 진행 중입니다 — 완료 후 삭제하세요.' }, 409);
  shortsStore().remove(id); // 산출물 파일은 남김(비파괴)
  return c.json({ ok: true });
}

app.post('/shorts', shortsCreateHandler);
app.post('/api/shorts', shortsCreateHandler);
app.post('/pieces/:id/shorts', shortsFromPieceHandler);
app.post('/api/pieces/:id/shorts', shortsFromPieceHandler);
app.get('/shorts', shortsListHandler);
app.get('/api/shorts', shortsListHandler);
app.get('/shorts/:id/video', shortsVideoHandler); // :id 보다 먼저(구체 경로 우선)
app.get('/api/shorts/:id/video', shortsVideoHandler);
app.get('/shorts/:id/zip', shortsZipHandler);
app.get('/api/shorts/:id/zip', shortsZipHandler);
app.get('/shorts/:id', shortsGetHandler);
app.get('/api/shorts/:id', shortsGetHandler);
app.delete('/shorts/:id', shortsDeleteHandler);
app.delete('/api/shorts/:id', shortsDeleteHandler);
app.post('/pieces/:id/published', piecePublishedHandler);
app.post('/api/pieces/:id/published', piecePublishedHandler);
app.post('/pieces/:id/metrics', pieceMetricsPostHandler);
app.post('/api/pieces/:id/metrics', pieceMetricsPostHandler);
app.get('/pieces/:id/metrics', pieceMetricsGetHandler);
app.get('/api/pieces/:id/metrics', pieceMetricsGetHandler);
// piece 온디맨드 실행 — 자율 케이던스를 기다리지 않고 지금 초안 런을 띄운다(사용자 트리거 = user run).
// 완료 시 pieceId 로 advancePieceReady 가 'ready' 로 전진(자율 launch 와 동일 경로). 이미 초안이 있거나 실행 중이면 거절.
function pieceRunHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  const piece = pieceStore().get(id);
  if (!piece) return c.json({ error: 'unknown piece' }, 404);
  if (piece.runId && RUNS.get(piece.runId)?.status === 'running') return c.json({ error: '이미 실행 중입니다', run_id: piece.runId }, 409);
  if (['ready', 'published', 'measured', 'reflected'].includes(piece.stage)) return c.json({ error: '이미 초안이 있습니다(검토·발행 단계)' }, 409);
  const runId = launchRun(piece.title, { pieceId: piece.id, keyword: piece.keyword }); // user run(양보 대상 아님)
  if (!runId) return c.json({ error: '실행 시작 실패' }, 500);
  pieceStore().update(id, { runId, stage: 'draft' });
  return c.json({ ok: true, run_id: runId });
}
app.post('/pieces/:id/run', pieceRunHandler);
app.post('/api/pieces/:id/run', pieceRunHandler);
// 수정 요청(검토 탭) — ready 초안에 사용자 피드백을 걸어 리비전 런(기존 초안 개정)을 띄운다.
// stage 는 'ready' 유지(수정 실패 시 기존 초안 보존) — 완료되면 advancePieceReady 가 runId 를 새 런으로 교체.
async function pieceReviseHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const piece = pieceStore().get(id);
  if (!piece) return c.json({ error: 'unknown piece' }, 404);
  const b = await c.req.json<{ feedback?: string }>().catch(() => ({} as { feedback?: string }));
  const feedback = (b.feedback ?? '').trim();
  if (!feedback) return c.json({ error: '수정 요청 내용이 비었습니다.' }, 400);
  if (piece.stage !== 'ready') return c.json({ error: '검토 대기(ready) 초안만 수정 요청할 수 있습니다.' }, 409);
  if ([...RUNS.values()].some((h) => h.status === 'running' && h.topic === piece.title)) {
    return c.json({ error: '이 초안의 런이 이미 실행 중입니다.' }, 409);
  }
  // 네이버 임시저장이 도는 중이면 개정 금지 — 저장 결과가 옛 내용과 뒤엉키는 것 방지(상호 가드).
  if (NAVER_DRAFT_JOBS.get(id)?.status === 'running') {
    return c.json({ error: '네이버 임시저장이 진행 중입니다 — 완료 후 수정 요청하세요.' }, 409);
  }
  let baseBody = '';
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, piece.runId ?? '', 'draft.json'), 'utf-8')) as { bodyMarkdown?: string };
    baseBody = (d.bodyMarkdown ?? '').trim();
  } catch { /* 아래에서 거절 */ }
  if (!baseBody) return c.json({ error: '기존 초안 본문을 찾을 수 없습니다.' }, 404);
  const runId = launchRun(piece.title, { pieceId: piece.id, keyword: piece.keyword, revise: { baseBody, feedback: feedback.slice(0, 4000) } });
  if (!runId) return c.json({ error: '실행 시작 실패' }, 500);
  return c.json({ ok: true, run_id: runId });
}
app.post('/pieces/:id/revise', pieceReviseHandler);
app.post('/api/pieces/:id/revise', pieceReviseHandler);

// 네이버 임시저장(검토 탭) — 완성 초안을 실제 네이버 SmartEditor 에 임시저장한다(발행 아님).
// Playwright 브라우저(기본 headful — 최초 로그인/캡차를 사람이 처리)가 최대 15분 걸릴 수 있어
// 백그라운드 잡으로 돌리고, 프론트는 GET 으로 폴링한다. 사용자 클릭이 곧 승인(신뢰 경로).
interface NaverDraftJob {
  status: 'running' | 'saved' | 'failed';
  startedTs: string; endedTs?: string;
  url?: string; adminUrl?: string; error?: string; dryRun: boolean;
  /** 자동 게이트가 기동한 잡의 담당자 표기(발행 담당) — 수동(검토 탭 버튼) 잡은 비움. */
  actor?: string;
}
const NAVER_DRAFT_JOBS = new Map<string, NaverDraftJob>();

// 네이버 Chrome 영속 프로필(~/.naver-blog-profiles/cli)은 1개뿐 — 동시에 두 브라우저(임시저장·성과수집·
// 일일동기화)를 열면 두 번째 launch_persistent_context 가 프로필 락으로 실패한다. 셋을 단일 뮤텍스로
// 직렬화한다. dry-run 은 브라우저를 열지 않으므로 점유 대상이 아니다.
let naverProfileBusy: string | null = null;

// 임시저장 잡 기동(공용) — 검토 탭 버튼(pieceNaverDraftHandler)과 자동 게이트(maybeAutoNaverDraft)가
// 같은 가드·프로필 뮤텍스를 공유한다. 잡 등록(set)까지 동기 — await 금지(TOCTOU 차단: 이중 기동 방지).
type NaverDraftStart = { ok: true } | { error: string; status: 400 | 404 | 409 };
function startNaverDraftJob(id: string, opts: { dryRun?: boolean; actor?: string } = {}): NaverDraftStart {
  const dryRun = opts.dryRun === true;
  const piece = pieceStore().get(id);
  if (!piece) return { error: 'unknown piece', status: 404 };
  if (!piece.runId) return { error: '초안이 아직 없습니다.', status: 409 };
  if (NAVER_DRAFT_JOBS.get(id)?.status === 'running') return { error: '이미 네이버 임시저장이 진행 중입니다.', status: 409 };
  // 실런은 브라우저를 여니 프로필 뮤텍스 필요 — 수집·타 임시저장·일일동기화와 상호 배제.
  if (!dryRun && naverProfileBusy) {
    return { error: `네이버 브라우저 작업이 진행 중입니다(${naverProfileBusy}) — 완료 후 다시 시도하세요.`, status: 409 };
  }
  // 이 초안의 런(수정 요청 리비전 포함)이 실행 중이면 내용이 바뀌는 중 — 저장하지 않는다.
  if ([...RUNS.values()].some((h) => h.status === 'running' && h.topic === piece.title)) {
    return { error: '이 초안의 런이 실행 중입니다 — 완료 후 저장하세요.', status: 409 };
  }
  if (!dryRun && !naverPublishCreds().blogId) {
    return { error: 'NAVER_BLOG_ID 미설정 — API 키 탭에서 "네이버 블로그 — 블로그 ID"를 설정하세요.', status: 400 };
  }
  const runIdAtStart = piece.runId;
  const sessionDir = path.join(CONFIG.sessionsDir, runIdAtStart);
  let draft: ReturnType<typeof coerceBlogDraft> = null;
  try { draft = coerceBlogDraft(JSON.parse(fs.readFileSync(path.join(sessionDir, 'draft.json'), 'utf-8'))); } catch { /* 아래에서 거절 */ }
  if (!draft) return { error: '초안(draft.json)을 읽을 수 없습니다.', status: 404 };

  const job: NaverDraftJob = { status: 'running', startedTs: new Date().toISOString(), dryRun, actor: opts.actor };
  NAVER_DRAFT_JOBS.set(id, job);
  if (!dryRun) naverProfileBusy = `임시저장:${piece.title.slice(0, 20)}`; // ── 동기 구간 끝(뮤텍스 획득)
  void publishDraftToNaver(sessionDir, draft, { dryRun }).then((r) => {
    job.endedTs = new Date().toISOString();
    if (r.ok) {
      job.status = 'saved'; job.url = r.draftUrl; job.adminUrl = r.adminUrl;
      if (r.issues.length) job.error = r.issues.join(' · '); // PARTIAL — 저장은 됐지만 일부 문제(이미지 누락 등)
      // 잡 도는 사이 리비전으로 runId 가 바뀌었다면 이 결과는 옛 내용 — 현재 초안의 기록으로 남기지 않는다.
      if (!dryRun && pieceStore().get(id)?.runId === runIdAtStart) {
        pieceStore().update(id, { naverDraftUrl: r.draftUrl ?? r.adminUrl, naverDraftTs: job.endedTs });
        // 저장 성공 = 본문 확정 → 카드뉴스·숏폼 자동 파생(사용자 확정 워크플로우: 주제 하나 →
        // 블로그+카드뉴스+숏폼 세트). piece당 각 1회, AUTO_CARDNEWS / AUTO_SHORTS 로 켜고 끔.
        if (CONFIG.autoCardNews && !cardNewsStore().list().some((x) => x.sourcePieceId === id)) {
          const dc = deriveCardNewsFromPiece(id);
          console.log('error' in dc
            ? `[카드뉴스] 자동 파생 실패 — ${piece.title.slice(0, 25)}: ${dc.error}`
            : `[카드뉴스] 자동 파생 시작 — ${piece.title.slice(0, 30)} (${dc.card.id})`);
        }
        if (CONFIG.autoShorts && !shortsStore().list().some((x) => x.sourcePieceId === id)) {
          const ds = deriveShortsFromPiece(id);
          console.log('error' in ds
            ? `[숏폼] 자동 파생 실패 — ${piece.title.slice(0, 25)}: ${ds.error}`
            : `[숏폼] 자동 파생 시작 — ${piece.title.slice(0, 30)} (${ds.short.id})`);
        }
      }
    } else {
      job.status = 'failed';
      job.error = [...r.issues, r.output.slice(-400)].filter(Boolean).join(' · ') || '알 수 없는 실패';
    }
  }).catch((e: unknown) => {
    job.status = 'failed'; job.endedTs = new Date().toISOString();
    job.error = e instanceof Error ? e.message : String(e);
  }).finally(() => {
    if (!dryRun) naverProfileBusy = null; // 뮤텍스 해제
    // 자동(발행 담당) 잡 종료 알림 — 채널 설정 시에만. 수동 잡은 사용자가 화면에서 폴링하므로 제외.
    if (opts.actor && !dryRun && notifyConfigured()) {
      void notify({
        title: `📗 ${opts.actor} — 네이버 임시저장 ${job.status === 'saved' ? '완료' : '실패'} · ${piece.title.slice(0, 40)}`,
        body: job.url ?? job.adminUrl ?? job.error ?? '',
      });
    }
  });
  return { ok: true };
}

async function pieceNaverDraftHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  if (!pieceStore().get(id)) return c.json({ error: 'unknown piece' }, 404);
  const b = await c.req.json<{ dry_run?: boolean }>().catch(() => ({} as { dry_run?: boolean }));
  const dryRun = b.dry_run === true;
  const r = startNaverDraftJob(id, { dryRun }); // 가드~잡 등록은 내부에서 동기 처리
  if ('error' in r) return c.json({ error: r.error }, r.status);
  return c.json({ ok: true, started: true, dry_run: dryRun });
}
function pieceNaverDraftStatusHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  const piece = pieceStore().get(id);
  if (!piece) return c.json({ error: 'unknown piece' }, 404);
  const job = NAVER_DRAFT_JOBS.get(id);
  // 잡 없음 = 진행 중 아님 — 'idle'. 과거 저장 이력(url)은 참고용으로만 싣는다(재시작으로 잡이
  // 유실된 폴링이 옛 'saved' 를 '방금 완료'로 오인하지 않도록 status 는 idle 고정).
  if (!job) return c.json({ status: 'idle', url: piece.naverDraftUrl, saved_ts: piece.naverDraftTs });
  return c.json({
    status: job.status, url: job.url ?? piece.naverDraftUrl, admin_url: job.adminUrl,
    error: job.error, dry_run: job.dryRun, started_ts: job.startedTs, ended_ts: job.endedTs,
    actor: job.actor,
  });
}

// ── ready 이후 자동 네이버 임시저장 게이트 — SEO 기준 통과 시 발행 담당 명의로 저장, 미달이면
//    자동 리비전 1회 후 재평가(리비전 완료 → advancePieceReady → 여기 재진입). 그래도 미달이거나
//    점수 미측정이면 수동 검토로 남긴다. 실제 '발행'은 여전히 사람 수동(설계 유지).
function publisherName(): string {
  // 발행 담당 실명 — 회사 로스터에서 직함 '발행'으로 해석(별도 people.yaml 키 불필요 — 중복 방지).
  // 로스터 name 은 실명(people.yaml)→직함 순 폴백이라 실명 미지정이어도 자연스러운 라벨이 나온다.
  try {
    const c = getCompany();
    const r = [c.ceo, ...(c.teams ?? []).flatMap((t) => [t.lead, ...t.members])].find((x) => /발행|publish/i.test(x.title));
    if (r?.name?.trim()) return r.name.trim();
  } catch { /* 기본값 */ }
  return '발행 담당';
}

/** draft.json 의 SEO 체크리스트 미달 항목 → 리비전 피드백 문자열(없으면 null). */
function seoReviseFeedback(runId: string, keyword?: string): string | null {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, runId, 'draft.json'), 'utf-8')) as {
      seo?: { checklist?: Array<{ label: string; ok: boolean; note?: string }> };
    };
    const fails = (d.seo?.checklist ?? []).filter((c) => !c.ok);
    if (!fails.length) return null;
    return [
      'SEO 점검에서 아래 항목이 미달했다. 본문의 구조·어조·분량은 유지하면서 미달 항목만 보완하라.',
      ...fails.map((c) => `- ${c.label}${c.note ? ` (현재: ${c.note})` : ''}`),
      ...(keyword ? [`핵심 키워드 "${keyword}" 를 첫 문단에 1회, 본문 전체에 2~4회 정확히 이 표기로 자연스럽게 포함하라.`] : []),
    ].join('\n');
  } catch { return null; }
}

function maybeAutoNaverDraft(pieceId: string): void {
  if (!CONFIG.autoNaverDraft) return;
  const piece = pieceStore().get(pieceId);
  if (!piece?.runId || piece.stage !== 'ready') return;
  if (piece.naverDraftUrl) return; // 이미 네이버에 초안 있음 — 재저장은 사람이 판단(중복 초안 방지)
  const seo = piece.seoScore;
  if (typeof seo === 'number' && seo >= CONFIG.naverDraftSeoMin) {
    const r = startNaverDraftJob(pieceId, { actor: publisherName() });
    console.log('error' in r
      ? `[발행담당] ${piece.title.slice(0, 30)} — 임시저장 기동 실패: ${r.error}`
      : `[발행담당] ${piece.title.slice(0, 30)} — SEO ${seo}점(기준 ${CONFIG.naverDraftSeoMin}) 통과 → 네이버 임시저장 시작`);
    return;
  }
  if (typeof seo !== 'number' || (piece.autoRevisions ?? 0) >= 1) {
    console.log(`[발행담당] ${piece.title.slice(0, 30)} — SEO ${seo ?? '미측정'}점 < ${CONFIG.naverDraftSeoMin} · 자동 리비전 소진 → 수동 검토 대기`);
    return;
  }
  // 다른 런/잡이 도는 중이면 이번 틱은 건너뛴다(다음 ready 전이 때 재평가).
  if ([...RUNS.values()].some((h) => h.status === 'running' && h.topic === piece.title)) return;
  if (NAVER_DRAFT_JOBS.get(pieceId)?.status === 'running') return;
  let baseBody = '';
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, piece.runId, 'draft.json'), 'utf-8')) as { bodyMarkdown?: string };
    baseBody = (d.bodyMarkdown ?? '').trim();
  } catch { /* 아래에서 중단 */ }
  const feedback = seoReviseFeedback(piece.runId, piece.keyword);
  if (!baseBody || !feedback) return; // 본문·체크리스트 없이는 리비전 품질을 보장할 수 없다 — 수동으로
  pieceStore().update(pieceId, { autoRevisions: (piece.autoRevisions ?? 0) + 1 });
  const rid = launchRun(piece.title, { pieceId, keyword: piece.keyword, revise: { baseBody, feedback: feedback.slice(0, 4000) } });
  console.log(rid
    ? `[발행담당] ${piece.title.slice(0, 30)} — SEO ${seo}점 미달 → 자동 리비전 런 ${rid}`
    : `[발행담당] ${piece.title.slice(0, 30)} — 리비전 런 기동 실패(다른 런 진행 중일 수 있음)`);
}
app.post('/pieces/:id/naver-draft', pieceNaverDraftHandler);
app.post('/api/pieces/:id/naver-draft', pieceNaverDraftHandler);
app.get('/pieces/:id/naver-draft', pieceNaverDraftStatusHandler);
app.get('/api/pieces/:id/naver-draft', pieceNaverDraftStatusHandler);

// 성과 자동 수집(검토 탭) — 발행된 글 URL 의 조회수·검색 유입 키워드를 네이버에서 수집→강화(멱등).
// 스크레이프가 수십 초~분 걸릴 수 있어 백그라운드 잡+폴링. 수집 실패는 fail-open(수동 입력으로 대체).
interface CollectJob {
  status: 'running' | 'done' | 'failed';
  startedTs: string; endedTs?: string;
  views?: number; dwellSec?: number; inflowCount?: number;
  reinforced?: boolean; note?: string; error?: string; dryRun: boolean;
}
const COLLECT_JOBS = new Map<string, CollectJob>();

/** piece → 성과 수집치(MetricSample) 또는 null(수집 실패·데이터 없음 = fail-open). */
async function measurePiece(piece: Piece, dryRun: boolean, signal?: AbortSignal): Promise<{ sample: MetricSample | null; note?: string }> {
  if (!piece.publishedUrl) return { sample: null, note: '발행 URL 없음' };
  const runDir = path.join(CONFIG.sessionsDir, piece.runId ?? piece.id, 'metrics');
  const m = await collectNaverMetrics(piece.publishedUrl, runDir, { dryRun }, signal);
  if (!m) return { sample: null, note: '수집 결과 파싱 실패' };
  if (!m.views && m.searchInflow.length === 0) return { sample: null, note: m.note };
  const sample: MetricSample = {
    measuredAt: new Date().toISOString(),
    views: m.views,
    ...(m.dwellSec ? { dwellSec: m.dwellSec } : {}),
    searchInflow: m.searchInflow,
    source: m.source,
  };
  return { sample, note: m.note };
}

async function pieceCollectHandler(c: Context): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<{ dry_run?: boolean }>().catch(() => ({} as { dry_run?: boolean }));
  const dryRun = body.dry_run === true;
  // ── 여기부터 잡 등록까지 동기 — await 금지(동시 수집 이중 기동 방지, naver-draft 와 동일 방어).
  const piece = pieceStore().get(id);
  if (!piece) return c.json({ error: 'unknown piece' }, 404);
  if (!piece.publishedUrl) return c.json({ error: '발행 URL 이 없습니다 — 네이버에 발행 후 글 URL을 먼저 등록하세요.' }, 409);
  if (COLLECT_JOBS.get(id)?.status === 'running') return c.json({ error: '이미 성과 수집이 진행 중입니다.' }, 409);
  // 수집도 브라우저를 여니 프로필 뮤텍스 필요(dry-run 제외 — 브라우저 안 엶).
  if (!dryRun && naverProfileBusy) {
    return c.json({ error: `네이버 브라우저 작업이 진행 중입니다(${naverProfileBusy}) — 완료 후 다시 시도하세요.` }, 409);
  }
  const job: CollectJob = { status: 'running', startedTs: new Date().toISOString(), dryRun };
  COLLECT_JOBS.set(id, job);
  if (!dryRun) naverProfileBusy = `성과수집:${piece.title.slice(0, 20)}`; // ── 동기 구간 끝(뮤텍스 획득)
  void measurePiece(piece, dryRun).then(async ({ sample, note }) => {
    job.endedTs = new Date().toISOString();
    job.note = note;
    if (!sample) {
      job.status = 'failed';
      job.error = note || '자동 추출된 성과가 없습니다 — 수동 입력으로 대체하세요.';
      return;
    }
    // dry-run 은 실제 상태를 변이하지 않는다 — 샘플만 노출(강화·이력·전이 없음, naver-draft 와 동일 관례).
    if (dryRun) {
      job.status = 'done'; job.reinforced = false;
      job.views = sample.views; job.dwellSec = sample.dwellSec; job.inflowCount = sample.searchInflow.length;
      return;
    }
    const r = await ingestMetrics(id, sample);
    job.status = 'done';
    job.views = sample.views; job.dwellSec = sample.dwellSec;
    job.inflowCount = sample.searchInflow.length; job.reinforced = r.reinforced;
  }).catch((e: unknown) => {
    job.status = 'failed'; job.endedTs = new Date().toISOString();
    job.error = e instanceof Error ? e.message : String(e);
  }).finally(() => { if (!dryRun) naverProfileBusy = null; }); // 뮤텍스 해제
  return c.json({ ok: true, started: true, dry_run: dryRun });
}
function pieceCollectStatusHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  if (!pieceStore().get(id)) return c.json({ error: 'unknown piece' }, 404);
  const job = COLLECT_JOBS.get(id);
  if (!job) return c.json({ status: 'idle' });
  return c.json({
    status: job.status, views: job.views, dwell_sec: job.dwellSec, inflow_count: job.inflowCount,
    reinforced: job.reinforced, note: job.note, error: job.error, dry_run: job.dryRun,
    started_ts: job.startedTs, ended_ts: job.endedTs,
  });
}
app.post('/pieces/:id/collect-metrics', pieceCollectHandler);
app.post('/api/pieces/:id/collect-metrics', pieceCollectHandler);
app.get('/pieces/:id/collect-metrics', pieceCollectStatusHandler);
app.get('/api/pieces/:id/collect-metrics', pieceCollectStatusHandler);

// 성과 집계 — 발행/측정된 piece 들의 최신 성과치 + 전략(강화 EWMA) 요약을 한 번에 반환(성과 대시보드용).
function performanceHandler(c: Context): Response {
  const rows = pieceStore().list()
    .filter((p) => !!p.publishedUrl || ['published', 'measured', 'reflected'].includes(p.stage))
    .map((p) => {
      const m = latestMetrics(p.id);
      return {
        id: p.id, title: p.title, stage: p.stage, keyword: p.keyword, subNiche: p.subNiche,
        publishedUrl: p.publishedUrl, seoScore: p.seoScore,
        views: m ? m.views : null, dwellSec: m?.dwellSec ?? null,
        inflow: m?.searchInflow ?? [], measuredAt: m?.measuredAt ?? null,
        source: m?.source, samples: readMetrics(p.id).length,
        derived: derivedSummary(p.id), // 콘텐츠 세트 완성 여부(카드뉴스·숏폼)
      };
    })
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  const s = readStrategy();
  const measured = rows.filter((r) => r.views != null);
  return c.json({
    strategy: { winners: s.winners.slice(0, 20), subNiches: s.subNiches, measuredPieces: s.measuredPieces },
    pieces: rows,
    summary: {
      count: rows.length,
      measured: measured.length,
      totalViews: measured.reduce((sum, r) => sum + (r.views ?? 0), 0),
    },
  });
}
app.get('/performance', performanceHandler);
app.get('/api/performance', performanceHandler);

// 실제 네이버 수집기 등록 — 일일 성과 동기화(syncPerformance)가 publishedUrl 있는 piece 를 자동 수집.
// measure 는 fail-open(미로그인·데이터 없음 → null) — 루프를 깨지 않는다. 수동 POST /metrics 는 계속 유효.
setCollector({
  name: 'naver_advisor',
  async measure(p) { return (await measurePiece(p, false)).sample; },
});

// ============================================================
// LLM 상태 — 프론트 계약(/llm) + 자체 UI(/api/llm)
// ============================================================
async function llmStatusPayload(): Promise<Record<string, unknown>> {
  const persisted = getLlmSetting(); // 영속된 사용자 선택(없으면 CONFIG 기본)
  const claude = isClaudeBackend();
  const models = claude ? [] : await ollama.listModels();
  const loaded = claude ? [] : await ollama.loaded();
  const assignment = claude ? resolveAssignment() : (models.length ? autoAssignModels(models, undefined, tierOverrides()) : null);
  return {
    setting: {
      backend: persisted.backend || CONFIG.backend,
      // 영속된 선택 우선 → 새로고침해도 사용자가 고른 모델이 유지.
      local_model: persisted.localModel || (claude ? '' : (assignment?.standard || CONFIG.localModel || (models[0]?.name ?? ''))),
    },
    backends: [
      { id: 'claude', label: 'Claude 클라우드', available: claude },
      { id: 'local', label: '로컬 (Ollama)', available: models.length > 0 },
    ],
    // 클라우드 tier→모델 맵(claude 백엔드) — UI 표시용.
    cloud_tiers: claude && assignment ? { micro: assignment.micro, standard: assignment.standard, heavy: assignment.heavy } : undefined,
    local_models: models.map((m) => m.name),
    local_loaded: loaded.map((l) => ({ name: l.name, expires_at: l.expiresAt, size_vram: Math.round(l.sizeVramGB * 1e9), context_length: l.contextLength })),
    local_base_url: CONFIG.ollamaBaseUrl,
  };
}
app.get('/llm', async (c) => c.json(await llmStatusPayload()));
// 설정 저장 — data/llm.json 에 영속하고, 이후 모든 런의 모델 배정(prepareRun→tierOverrides)에 반영.
app.post('/llm', async (c) => {
  const body = await c.req.json<{ backend?: string; local_model?: string }>().catch(() => ({}) as { backend?: string; local_model?: string });
  setLlmSetting({ backend: body.backend, localModel: body.local_model });
  return c.json(await llmStatusPayload());
});
app.get('/api/llm', async (c) => {
  const claude = isClaudeBackend();
  const version = claude ? 'claude' : await ollama.version();
  const models = claude ? [] : await ollama.listModels();
  const loaded = claude ? [] : await ollama.loaded();
  const assignment = claude ? resolveAssignment() : (models.length ? autoAssignModels(models, undefined, tierOverrides()) : null);
  return c.json({ backend: getLlmSetting().backend || CONFIG.backend, ollama_url: CONFIG.ollamaBaseUrl, version, available: claude || !!version, specs: claude ? 'Claude 클라우드' : getSystemSpecs().summary, models, loaded, assignment });
});
// 런타임 품질 설정(토론·추론) — UI 토글로 바꾸면 다음 런부터 즉시 반영(서버 재시작 불필요).
app.get('/runsettings', (c) => c.json(getRunSettings()));
app.post('/runsettings', async (c) => {
  const body = await c.req.json<{ orgDebateRounds?: number; agentThinking?: boolean }>().catch(() => ({}) as { orgDebateRounds?: number; agentThinking?: boolean });
  return c.json(setRunSettings({ orgDebateRounds: body.orgDebateRounds, agentThinking: body.agentThinking }));
});
app.get('/api/runsettings', (c) => c.json(getRunSettings()));
app.post('/api/runsettings', async (c) => {
  const body = await c.req.json<{ orgDebateRounds?: number; agentThinking?: boolean }>().catch(() => ({}) as { orgDebateRounds?: number; agentThinking?: boolean });
  return c.json(setRunSettings({ orgDebateRounds: body.orgDebateRounds, agentThinking: body.agentThinking }));
});

app.get('/api/health', (c) => c.json({ ok: true, backend: CONFIG.backend }));
app.get('/healthz', (c) => c.json({ ok: true }));

// 자율 사이클 상태 — 프론트 대시보드의 '🤖 자율' 칩용. enabled 면 주기, active 면 자율 런 진행 중.
app.get('/autonomy/status', (c) => {
  // 진행 중인 자율런 — 프론트가 유휴 시 자동 관전(watchLive)할 수 있게 run_id 를 노출한다.
  const activeAuto = [...RUNS.entries()].find(([, h]) => h.auto && h.status === 'running');
  return c.json({
    enabled: CONFIG.autoCycleMinutes > 0,
    interval_minutes: CONFIG.autoCycleMinutes,
    shell: CONFIG.agentShell,
    active: !!activeAuto,
    auto_run_id: activeAuto ? activeAuto[0] : null,
    last_auto_ts: lastAutoRun?.ts ?? null,
    last_auto_topic: lastAutoRun?.topic ?? null,
  });
});

// 일일 브리핑 — 미리보기(GET) + 수동 발송(POST). 설정 시각엔 자동 발송(startDaily).
app.get('/briefing', (c) => c.json({ ...buildBriefing(), configured: notifyConfigured(), time: CONFIG.dailyBriefingTime }));
app.post('/briefing/send', async (c) => {
  const sent = await notify(buildBriefing());
  return c.json({ sent, configured: notifyConfigured() });
});

// ============================================================
// 회사 — 프론트 계약(/company, teams 구조) + 자체 UI(/api/company)
// ============================================================
function roleInfo(r: RoleDef, level: string, team: string | null) {
  return {
    id: r.id, title: r.title, name: r.name,
    level: r.level ?? level, team: r.team ?? team,
    tools: r.tools, skills: [], model: r.tier, stance: r.stance,
    // 직원 탭 리스트 카드의 자율도 — 상세 패널(agentDetail)과 동일하게 '실효 자율도'를 쓴다.
    // (자율도 편집은 PATCH /agents/:id → writeCapabilities 로 워크스페이스 캡에 저장되므로,
    //  raw company.yaml 값을 보여주면 편집이 카드에 반영되지 않는다 — 비서 '자동' 설정이
    //  '초안(승인)'으로 보이던 버그.)
    is_critic: r.isCritic, autonomy: effectiveAutonomy(r),
  };
}
app.get('/company', (c) => {
  const co = getCompany();
  return c.json({
    name: co.name,
    ceo: roleInfo(co.ceo, 'exec', null),
    teams: (co.teams ?? []).map((t) => ({
      id: t.id, name: t.name,
      lead: roleInfo(t.lead, 'lead', t.id),
      members: t.members.map((m) => roleInfo(m, 'member', t.id)),
    })),
  });
});
app.get('/api/company', (c) => c.json(getCompany()));

// --- 직원 워크스페이스 + 회사 편집 (EmployeesView) ---
app.get('/agents/:id', (c) => {
  const role = rolesById(getCompany()).get(c.req.param('id') ?? '');
  if (!role) return c.json({ error: 'unknown agent' }, 404);
  return c.json(agentDetail(role));
});
app.patch('/agents/:id', async (c) => {
  const id = c.req.param('id') ?? '';
  if (!rolesById(getCompany()).has(id)) return c.json({ error: 'unknown agent' }, 404);
  const b = await c.req.json<{ goal?: string; tools?: string[]; autonomy?: number }>().catch(() => ({}) as { goal?: string; tools?: string[]; autonomy?: number });
  if (b.goal !== undefined) writeGoal(id, b.goal);
  if (b.tools !== undefined || b.autonomy !== undefined) writeCapabilities(id, { tools: b.tools, autonomy: b.autonomy });
  appendActivity(id, '프로필 편집(목표/툴/자율도)');
  return c.json({ ok: true });
});
app.post('/agents/:id/skills', async (c) => {
  const id = c.req.param('id') ?? '';
  if (!rolesById(getCompany()).has(id)) return c.json({ error: 'unknown agent' }, 404);
  const b = await c.req.json<{ name?: string; content?: string }>().catch(() => ({}) as { name?: string; content?: string });
  return addSkill(id, b.name ?? '', b.content ?? '') ? c.json({ ok: true }) : c.json({ error: 'skill 추가 실패' }, 400);
});
app.delete('/agents/:id/skills/:skill', (c) =>
  deleteSkill(c.req.param('id') ?? '', c.req.param('skill') ?? '') ? c.json({ ok: true }) : c.json({ error: 'skill 삭제 실패' }, 400));

// 지식 주입 — 업로드 파일(들)을 추출해 선택한 에이전트(들)의 injected.md 에 '우선 신뢰 지식'으로 누적.
// (/sources 와 동일한 추출·가드 재사용. agent_ids 는 반복 필드 또는 콤마 문자열 모두 허용, roster+safeId 검증.)
async function injectKnowledgeHandler(c: Context): Promise<Response> {
  const body = await c.req.parseBody({ all: true });
  const rawFiles = body['files'];
  const files = (Array.isArray(rawFiles) ? rawFiles : [rawFiles]).filter((x): x is File => x instanceof File);
  const rawIds = body['agent_ids'];
  const idParts = (Array.isArray(rawIds) ? rawIds : [rawIds])
    .flatMap((v) => String(v ?? '').split(',')).map((s) => s.trim()).filter(Boolean);
  const roster = rolesById(getCompany());
  const agentIds = [...new Set(idParts)].filter((id) => roster.has(id)); // 실재 멤버만(경로 traversal·유령 id 차단)
  if (!agentIds.length) return c.json({ error: '대상 에이전트를 하나 이상 선택하세요' }, 400);
  if (!files.length) return c.json({ error: '파일이 필요합니다' }, 400);

  const docs: Array<{ name: string; text: string }> = [];
  const fileResults: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const name = f.name || 'upload';
    if (!isSupportedExt(name)) { fileResults.push({ file: name, status: 'unsupported', note: 'PDF/DOCX/HWPX/XLSX/PPTX/텍스트만 지원' }); continue; }
    if (f.size > 25_000_000) { fileResults.push({ file: name, status: 'too-large' }); continue; }
    try {
      const text = (await extractText(name, Buffer.from(await f.arrayBuffer()))).trim();
      if (!text) { fileResults.push({ file: name, status: 'failed', note: '추출된 텍스트 없음' }); continue; }
      docs.push({ name, text });
      fileResults.push({ file: name, status: 'ok', chars: text.length });
    } catch (e) { fileResults.push({ file: name, status: 'error', note: e instanceof Error ? e.message : String(e) }); }
  }
  if (!docs.length) return c.json({ error: '주입할 텍스트를 추출하지 못했습니다', files: fileResults }, 400);

  const agents: Array<Record<string, unknown>> = [];
  for (const id of agentIds) {
    ensureScaffold(id);
    for (const d of docs) appendInjected(id, d.text, d.name);
    const total = injectedLength(id);
    appendActivity(id, `📥 지식 주입: ${docs.map((d) => d.name).join(', ')}`);
    agents.push({ agent: id, name: roster.get(id)?.name ?? id, totalChars: total, overCap: total > INJECTED_CAP });
  }
  const over = agents.some((a) => a.overCap);
  return c.json({
    ok: true, files: fileResults, agents,
    warning: over ? `일부 에이전트의 주입 총량이 반영 한도(${INJECTED_CAP}자)를 넘어, 최신 주입 우선으로 잘려 일부는 프롬프트에 안 들어갑니다. '비우기'로 정리하거나 대용량은 자료실(위키 업로드)을 쓰세요.` : null,
  });
}
app.post('/agents/knowledge', injectKnowledgeHandler);
app.post('/api/agents/knowledge', injectKnowledgeHandler);
function clearKnowledgeHandler(c: Context): Response {
  const id = c.req.param('id') ?? '';
  if (!rolesById(getCompany()).has(id)) return c.json({ error: 'unknown agent' }, 404);
  clearInjected(id);
  appendActivity(id, '🧹 주입 지식 비움');
  return c.json({ ok: true });
}
app.delete('/agents/:id/knowledge', clearKnowledgeHandler);
app.delete('/api/agents/:id/knowledge', clearKnowledgeHandler);

// 회사(역할/팀) 편집 — 성공 시 reloadCompany 로 /company 즉시 반영.
function companyEdit(c: Context, r: { ok: boolean; error?: string; [k: string]: unknown }): Response {
  if (r.ok) reloadCompany();
  return c.json(r, r.ok ? 200 : 400);
}
app.patch('/company/roles/:id', async (c) => {
  const b = await c.req.json<RolePatch>().catch(() => ({}) as RolePatch);
  return companyEdit(c, editRole(c.req.param('id') ?? '', b));
});
app.delete('/company/roles/:id', (c) => companyEdit(c, deleteRole(c.req.param('id') ?? '')));
app.post('/company/teams', async (c) => {
  const b = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  return companyEdit(c, addTeam(b.name ?? '새 팀'));
});
app.patch('/company/teams/:id', async (c) => {
  const b = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  return companyEdit(c, renameTeam(c.req.param('id') ?? '', b.name ?? ''));
});
app.delete('/company/teams/:id', (c) => companyEdit(c, deleteTeam(c.req.param('id') ?? '')));
app.post('/company/teams/:id/members', async (c) => {
  const b = await c.req.json<MemberBody>().catch(() => ({ title: '' }) as MemberBody);
  return companyEdit(c, addMember(c.req.param('id') ?? '', b));
});

// ============================================================
// 위키 지식그래프 (프론트 계약)
// ============================================================
app.get('/wiki/graph', (c) => c.json(llmWiki().graph()));
app.get('/wiki/stats', (c) => { const s = llmWiki().stats(); return c.json({ pages: s.pages, sources: s.sources, lessons: s.lessons }); });
// 외부 지식 주입(Connect AI /api/brain-inject 벤치마킹) — {title, markdown} 를 위키 source 로 저장+ingest.
/** 상수시간 토큰 비교 — 타이밍 공격 방지. 길이 불일치도 안전 처리(timingSafeEqual 은 동일 길이만 허용). */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// 인증 필수: 시크릿 INJECT_TOKEN(또는 env)과 **Bearer 헤더만** 일치해야 함(Connect 의 무인증 취약점 보완).
// 쿼리 토큰(?token=)은 URL·로그·referrer 로 유출되므로 폐기. 비교는 상수시간(safeEqual).
app.post('/wiki/inject', async (c) => {
  const expected = getSecret('INJECT_TOKEN') || process.env.INJECT_TOKEN || '';
  const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || !safeEqual(token, expected)) return c.json({ error: '인증 실패 — 시크릿 INJECT_TOKEN 을 설정하고 Bearer 토큰을 일치시키세요' }, 401);
  const body = await c.req.json<{ title?: string; markdown?: string; content?: string }>().catch(() => ({}) as { title?: string; markdown?: string; content?: string });
  const title = (body.title ?? '').trim();
  const content = (body.markdown ?? body.content ?? '').trim();
  if (!title || !content) return c.json({ error: 'title 과 markdown(또는 content) 이 필요합니다' }, 400);
  const w = llmWiki();
  const rawRef = w.saveRaw(title, content);
  const page = w.upsertPage({ title, type: 'source', body: content, sources: [rawRef] });
  w.appendLog('inject', title);
  const imodel = await ingestModel();
  setIngestStatus(page.slug, { state: 'pending', entities: [] });
  void w.ingest({ title, content, model: imodel, sources: [rawRef], skipSummary: true })
    .then((r) => setIngestStatus(page.slug, { state: 'done', entities: r.pages }))
    .catch(() => setIngestStatus(page.slug, { state: 'failed', entities: [] }));
  return c.json({ ok: true, slug: page.slug });
});
// Karpathy lint 워크플로우 — 고아·끊긴링크(지식 갭) 점검
app.get('/wiki/lint', (c) => c.json(llmWiki().lint()));
// 자가수선 — lint 가 찾은 지식 갭을 LLM 으로 보충(?n=개수, 기본 6)
// 정수 쿼리 파싱 — 0/음수/비숫자를 일관 처리(`|| 6` falsy 버그 회피).
function parseN(c: Context, def = 6): number {
  const raw = Number(c.req.query('n'));
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : def;
}
app.post('/wiki/maintain', async (c) => {
  const claude = isClaudeBackend();
  const models = claude ? [] : await ollama.listModels();
  if (!claude && !models.length) return c.json({ error: 'no local models' }, 503);
  const micro = claude ? resolveAssignment().micro : autoAssignModels(models).micro;
  const r = await llmWiki().maintain(micro, { maxFill: parseN(c), signal: c.req.raw.signal });
  return c.json(r);
});
// 모순 감사 — 토픽 겹치는 페이지 쌍을 LLM 비교(?n=쌍수, ?resolve=1 이면 해소 노트 기록)
app.post('/wiki/audit', async (c) => {
  const claude = isClaudeBackend();
  const models = claude ? [] : await ollama.listModels();
  if (!claude && !models.length) return c.json({ error: 'no local models' }, 503);
  const micro = claude ? resolveAssignment().micro : autoAssignModels(models).micro;
  const r = await llmWiki().findContradictions(micro, { maxChecks: parseN(c), resolve: c.req.query('resolve') === '1', signal: c.req.raw.signal });
  return c.json(r);
});
// 기존 자료(source 페이지) 일괄 ingest — 엔티티·[[링크]] 추출로 두뇌 그래프 연결 보강(백그라운드 + 진행률).
const reingestState = { total: 0, done: 0, running: false, model: '' };
const reingestDoneFile = (): string => path.join(CONFIG.dataDir, 'reingest_done.json');
function loadReingestDone(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(reingestDoneFile(), 'utf-8')) as string[]); } catch { return new Set(); }
}
app.post('/wiki/reingest', async (c) => {
  if (reingestState.running) return c.json({ ok: false, error: '이미 진행 중', total: reingestState.total, done: reingestState.done });
  const models = await ollama.listModels();
  if (!models.length) return c.json({ error: 'no local models' }, 503);
  // ?model= 으로 ingest 모델 지정(예: gemma4:12b). 미지정/미설치면 micro(소형) 자동.
  const installed = new Set(models.map((m) => m.name));
  const reqModel = (c.req.query('model') ?? '').trim();
  const model = reqModel && installed.has(reqModel) ? reqModel : autoAssignModels(models).micro;
  const w = llmWiki();
  // 진행 영속 — 재기동 후엔 남은 것만(reset=1 이면 처음부터). 매 페이지 완료 시 done 기록.
  const done = c.req.query('reset') === '1' ? new Set<string>() : loadReingestDone();
  const remaining = w.list('source').filter((p) => !done.has(p.slug));
  reingestState.total = done.size + remaining.length; reingestState.done = done.size; reingestState.running = true; reingestState.model = model;
  void (async () => {
    for (const p of remaining) {
      try { await w.ingest({ title: p.title, content: p.body, model, skipSummary: true }); done.add(p.slug); } catch { /* 무해 */ }
      reingestState.done++;
      try { fs.writeFileSync(reingestDoneFile(), JSON.stringify([...done])); } catch { /* */ }
    }
    reingestState.running = false;
  })();
  return c.json({ ok: true, total: reingestState.total, remaining: remaining.length, model });
});
app.get('/wiki/reingest_status', (c) => c.json(reingestState));
// 멈춘 자동 직원귀속(classify) 일괄 재분류 — source 페이지 body 로 다시 돌린다(reingest 패턴 복제).
// 업로드 중 중단(서버 재시작 등)으로 pending 에 정체된 자료를 위키 원문으로 재귀속한다.
const reclassifyState = { total: 0, done: 0, running: false, model: '' };
app.post('/sources/reclassify', async (c) => {
  if (reclassifyState.running) return c.json({ ok: false, error: '이미 진행 중', total: reclassifyState.total, done: reclassifyState.done });
  const models = await ollama.listModels();
  if (!models.length) return c.json({ error: 'no local models' }, 503);
  // ?model= 으로 분류 모델 지정. 미지정/미설치면 standard(분류는 standard 슬롯 — /sources 와 일관).
  const installed = new Set(models.map((m) => m.name));
  const reqModel = (c.req.query('model') ?? '').trim();
  const model = reqModel && installed.has(reqModel) ? reqModel : autoAssignModels(models).standard;
  const w = llmWiki();
  // 대상: source 페이지 중 아직 귀속 안 된 것(classify_status 가 done+assigned 아님). reset=1 이면 전부 재분류.
  const reset = c.req.query('reset') === '1';
  const sources = w.list('source');
  const statuses = getStatuses(sources.map((p) => p.slug));
  const targets = reset ? sources : sources.filter((p) => {
    const st = statuses[p.slug];
    return !st || st.state !== 'done' || (st.assigned?.length ?? 0) === 0;
  });
  reclassifyState.total = sources.length;
  reclassifyState.done = sources.length - targets.length;
  reclassifyState.running = true;
  reclassifyState.model = model;
  // 백그라운드 순회 — classifyAndAssign 이 자체적으로 status(pending→done) 갱신·실패안전 처리.
  void (async () => {
    for (const p of targets) {
      try { await classifyAndAssign(p.slug, p.title, p.body, model); } catch { /* 무해 — 한 건 실패가 전체를 막지 않음 */ }
      reclassifyState.done++;
    }
    reclassifyState.running = false;
  })();
  return c.json({ ok: true, total: reclassifyState.total, remaining: targets.length, model });
});
app.get('/sources/reclassify_status', (c) => c.json(reclassifyState));

// 업로드 원문(data/raw, 이미 추출된 UTF-8 텍스트)을 직접 재처리한다.
// 위키 재구축으로 source 페이지가 소실되고 classify_status 키가 어긋난 상황에서,
// 검증된 원문을 단일 진실원본으로 삼아 ①source 페이지 복원 ②직원귀속 ③두뇌 ingest 를 재수행.
// 2패스: Pass1(귀속·빠름) → Pass2(ingest·느림). 내용해시로 _2 재업로드 중복 제거. done 은 skip → 재개 안전.
const reprocessState = {
  phase: 'idle' as 'idle' | 'scan' | 'classify' | 'ingest' | 'done',
  total: 0, classified: 0, ingested: 0, skippedDup: 0, errors: 0,
  running: false, model: '', imodel: '', doIngest: true,
};
app.post('/sources/reprocess_raw', async (c) => {
  if (reprocessState.running) return c.json({ ok: false, error: '이미 진행 중', ...reprocessState });
  const models = await ollama.listModels();
  if (!models.length) return c.json({ error: 'no local models' }, 503);
  const installed = new Set(models.map((m) => m.name));
  const reqModel = (c.req.query('model') ?? '').trim();
  const model = reqModel && installed.has(reqModel) ? reqModel : autoAssignModels(models).standard;
  const imodel = autoAssignModels(models).micro || model;
  const reset = c.req.query('reset') === '1';
  const doIngest = c.req.query('ingest') !== '0';
  const limit = Math.max(0, Number(c.req.query('limit') ?? '0') | 0);
  const w = llmWiki();

  // 1) data/raw 전 파일 수집 + 내용해시 중복 제거(_2 재업로드 등). 텍스트는 처리 시 재독(메모리 절약).
  reprocessState.phase = 'scan';
  const seen = new Set<string>();
  const docs: Array<{ abs: string; title: string; slug: string; ref: string }> = [];
  let days: string[] = [];
  try { days = fs.readdirSync(w.rawDir).filter((d) => { try { return fs.statSync(path.join(w.rawDir, d)).isDirectory(); } catch { return false; } }).sort(); } catch { days = []; }
  let dupCount = 0;
  for (const day of days) {
    const dir = path.join(w.rawDir, day);
    let files: string[] = [];
    try { files = fs.readdirSync(dir).sort(); } catch { continue; }
    for (const file of files) {
      const abs = path.join(dir, file);
      let text = '';
      try { if (!fs.statSync(abs).isFile()) continue; text = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
      if (!text.trim()) continue;
      const h = createHash('sha1').update(text).digest('hex');
      if (seen.has(h)) { dupCount++; continue; }
      seen.add(h);
      // 표시·slug 용 제목 정돈: 확장자 제거 + 언더스코어→공백 + 양끝 따옴표 제거.
      const title = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^['"]+|['"]+$/g, '').trim() || file;
      docs.push({ abs, title, slug: slugify(title), ref: `raw/${day}/${file}` });
    }
  }
  const work = limit > 0 ? docs.slice(0, limit) : docs;
  reprocessState.total = work.length;
  reprocessState.classified = 0; reprocessState.ingested = 0; reprocessState.skippedDup = dupCount; reprocessState.errors = 0;
  reprocessState.running = true; reprocessState.model = model; reprocessState.imodel = imodel; reprocessState.doIngest = doIngest;

  void (async () => {
    const existing = new Set(w.list('source').map((p) => p.slug)); // 기존 source 페이지 — body 재append(비대화) 방지
    // ── Pass 1: source 페이지 복원 + 직원귀속(빠름) ──
    reprocessState.phase = 'classify';
    for (const d of work) {
      try {
        let text = ''; try { text = fs.readFileSync(d.abs, 'utf-8'); } catch { /* */ }
        if (text.trim()) {
          if (!existing.has(d.slug)) { w.upsertPage({ title: d.title, type: 'source', body: text, sources: [d.ref] }); existing.add(d.slug); }
          const st = getStatuses([d.slug])[d.slug];
          if (reset || !st || st.state !== 'done' || (st.assigned?.length ?? 0) === 0) {
            await classifyAndAssign(d.slug, d.title, text, model);
          }
        }
      } catch { reprocessState.errors++; }
      reprocessState.classified++;
    }
    // ── Pass 2: 두뇌 ingest(엔티티/개념 추출 — 느림, 직렬) ──
    if (doIngest) {
      reprocessState.phase = 'ingest';
      for (const d of work) {
        try {
          let text = ''; try { text = fs.readFileSync(d.abs, 'utf-8'); } catch { /* */ }
          if (text.trim()) {
            const st = getStatuses([d.slug])[d.slug];
            if (reset || st?.ingest?.state !== 'done') {
              setIngestStatus(d.slug, { state: 'pending', entities: [] });
              try {
                const r = await w.ingest({ title: d.title, content: text, model: imodel, sources: [d.ref], skipSummary: true });
                setIngestStatus(d.slug, { state: 'done', entities: r.pages });
              } catch { setIngestStatus(d.slug, { state: 'failed', entities: [] }); reprocessState.errors++; }
            }
          }
        } catch { reprocessState.errors++; }
        reprocessState.ingested++;
      }
    }
    w.rebuildIndex();
    reprocessState.phase = 'done';
    reprocessState.running = false;
  })();

  return c.json({ ok: true, total: work.length, uniqueDocs: docs.length, skippedDup: dupCount, doIngest, model, imodel });
});
app.get('/sources/reprocess_status', (c) => c.json(reprocessState));
app.get('/wiki/pages', (c) => {
  const cat = c.req.query('category') ?? '';
  const w = llmWiki();
  const all = w.list();
  const pages = (cat ? all.filter((p) => p.type === cat) : all).map((p) => ({
    id: p.slug, title: p.title, category: p.type, status: 'active', stance: 'neutral',
    contributors: p.contributors, tags: p.aliases, source_count: p.sources.length,
    updated_ts: p.updated, summary: p.summary,
  }));
  const counts: Record<string, number> = {};
  for (const p of all) counts[p.type] = (counts[p.type] ?? 0) + 1;
  return c.json({ pages, counts, total_pages: all.length });
});
app.get('/wiki/page/:id', (c) => {
  const w = llmWiki();
  const p = w.getPage(c.req.param('id') ?? '');
  if (!p) return c.json({ error: 'not found' }, 404);
  const related = p.links.map((slug) => ({ relation: 'relates', direction: 'out' as const, other_id: slug, other_title: w.getPage(slug)?.title ?? slug }));
  return c.json({
    id: p.slug, slug: p.slug, title: p.title, category: p.type, status: 'active',
    stance: 'neutral', confidence: 'medium', tags: p.aliases, aliases: p.aliases,
    contributors: p.contributors, sources: p.sources, body: p.body,
    created_ts: p.updated, updated_ts: p.updated, related,
  });
});

// ============================================================
// 승인 (프론트 계약)
// ============================================================
app.get('/approvals', (c) => c.json({ pending: approvalStore().list() }));
app.post('/approvals/:id/decide', async (c) => {
  const body = await c.req.json<{ approved?: boolean; note?: string }>().catch(() => ({}) as { approved?: boolean; note?: string });
  const ok = approvalStore().decide(c.req.param('id'), !!body.approved, body.note ?? '');
  return ok ? c.json({ ok: true }) : c.json({ error: 'unknown approval' }, 404);
});

// ============================================================
// 미구현 패널 스텁 — 프론트가 빈 상태로 우아하게 렌더
app.get('/templates', (c) => c.json({ templates: [] }));
// MCP 서버 목록 — 현재 in-process 도구(위키·웹검색)를 MCP 서버 형태로 표면화. used_by 는 해당
// 툴을 보유한 직원(실명/직책)을 company 로스터에서 스캔. 외부(법제처 등) 서버는 미구현이라 표시 안 함.
async function mcpServers() {
  const co = getCompany();
  const roles = [co.ceo, ...co.specialists];
  const usersOf = (tools: string[]) =>
    [...new Set(roles.filter((r) => r.tools.some((t) => tools.includes(t))).map((r) => r.name || r.title))];
  const servers: Array<Record<string, unknown>> = [
    { id: 'wiki', name: '위키 (LLM Wiki)', icon: '📚', kind: 'in-process', desc: 'Karpathy 식 엔티티/개념 페이지 적재·조회', tools: ['wiki_query', 'wiki_ingest'], enabled: true, toggleable: false, used_by: usersOf(['wiki_query', 'wiki_ingest']) },
    { id: 'web', name: '웹 검색', icon: '🌐', kind: 'in-process', desc: '외부 웹 검색 그라운딩(DuckDuckGo)', tools: ['web_search'], enabled: CONFIG.webSearch, toggleable: false, used_by: usersOf(['web_search']) },
  ];
  // 외부 데이터 소스 커넥터(법령·DART 등) — 등록된 커넥터를 순회. 키 설정 시 enabled, scope 에 따라
  //  used_by(전 직원 또는 해당 도구 보유 역할). 새 소스는 커넥터만 추가하면 여기 자동 표시.
  for (const conn of connectors()) {
    const enabled = conn.enabled();
    const used = conn.scope === 'global' ? roles.map((r) => r.name || r.title) : usersOf(conn.scope);
    let tools: string[] = [];
    try { tools = enabled && conn.tools ? await conn.tools() : []; } catch { /* */ }
    servers.push({
      id: conn.id, name: conn.keyDef.label, icon: conn.keyDef.icon, kind: 'external',
      desc: `${conn.keyDef.desc}${enabled ? '' : ' — (키 미설정: API키 화면에서 ' + conn.keyDef.key + ' 입력 시 활성)'}`,
      tools, enabled, toggleable: false, used_by: used, needs_restart: false,
    });
  }
  return servers;
}
app.get('/mcp', async (c) => c.json({ servers: await mcpServers() }));

// ---- 외부 API 커넥터(선언형/AI 자동설정) ----
app.get('/connectors', (c) => c.json({ connectors: listCustomConfigs() }));
app.post('/connectors', async (c) => {
  const cfg = await c.req.json<CustomConnectorCfg>().catch(() => null);
  if (!cfg) return c.json({ ok: false, error: '잘못된 설정' }, 400);
  return c.json(saveCustomConfig(cfg));
});
app.delete('/connectors/:id', (c) => c.json(deleteCustomConfig(c.req.param('id') ?? '')));
// 테스트 — 설정 + 검색어로 실제 호출해 추출 결과 미리보기(저장 전 검증). 키는 시크릿에서 읽음.
app.post('/connectors/test', async (c) => {
  const b = await c.req.json<{ cfg?: CustomConnectorCfg; query?: string }>().catch(() => ({}) as { cfg?: CustomConnectorCfg; query?: string });
  if (!b.cfg) return c.json({ ok: false, error: 'cfg 필요' }, 400);
  const keySet = !!getSecret(b.cfg.keyName);
  if (!keySet) return c.json({ ok: false, error: `${b.cfg.keyName} 키가 설정되지 않았습니다(API키 화면에서 입력).` });
  const preview = await runCustomConnector(b.cfg, b.query?.trim() || '테스트', c.req.raw.signal);
  return c.json({ ok: true, preview, empty: !preview.trim(), note: preview.trim() ? '' : '응답이 비었습니다 — 엔드포인트/파라미터/추출규칙을 점검하세요.' });
});
// 문서 URL 검색 — API 이름으로 웹검색해 개발가이드 후보 URL 목록 반환(공식 도메인 우선 정렬).
app.post('/connectors/searchdocs', async (c) => {
  const b = await c.req.json<{ apiName?: string }>().catch(() => ({}) as { apiName?: string });
  const name = (b.apiName ?? '').trim();
  if (!name) return c.json({ ok: false, error: 'apiName 필요' }, 400);
  const results = await webSearch(`${name} OpenAPI 개발가이드 요청 파라미터 명세`, 8, c.req.raw.signal);
  // 공식·문서성 도메인 가산점(정확한 명세일 확률↑).
  const OFFICIAL = /(data\.go\.kr|kosis\.kr|opendart\.fss\.or\.kr|bizinfo\.go\.kr|go\.kr|or\.kr)/i;
  const DOCY = /(guide|api|openapi|dev|doc|명세|가이드|spec)/i;
  const scored = results.map((r) => ({
    title: r.title, url: r.url, snippet: r.snippet,
    score: (OFFICIAL.test(r.url) ? 2 : 0) + (DOCY.test(r.url + r.title) ? 1 : 0),
  })).sort((a, b) => b.score - a.score);
  return c.json({ ok: true, results: scored });
});
// AI 자동설정 — API 이름(+문서 URL)으로 로컬 LLM 이 선언형 설정 제안(저장 안 함, 미리보기용).
app.post('/connectors/autoconfig', async (c) => {
  const b = await c.req.json<{ keyName?: string; apiName?: string; docsUrl?: string }>().catch(() => ({}) as { keyName?: string; apiName?: string; docsUrl?: string });
  if (!b.keyName || !b.apiName) return c.json({ ok: false, error: 'keyName·apiName 필요' }, 400);
  const cfg = await autoConfigConnector({ keyName: b.keyName, apiName: b.apiName, docsUrl: b.docsUrl, signal: c.req.raw.signal });
  if (!cfg) return c.json({ ok: false, error: 'AI 설정 생성 실패 — API 문서 URL을 넣거나 수동 설정을 시도하세요.' });
  return c.json({ ok: true, cfg });
});
// 토글 — 위키·웹검색은 항상 활성, 법제처는 API 키 패널의 LAW_API_KEY 로 켜고 끔(명시 반환, 404 방지).
app.post('/mcp/:id', async (c) => c.json({ ok: false, error: '위키·웹검색은 항상 활성입니다. 법제처는 API 키 패널에서 LAW_API_KEY(법제처 OC)로 켜고 끕니다.', servers: await mcpServers() }));

// --- 외부 자료 업로드 → 멀티포맷 추출 → 위키 적재 + LLM 자동 직원귀속 분류 ---
async function classifyModel(): Promise<string> {
  if (isClaudeBackend()) return resolveAssignment().standard;
  const models = await ollama.listModels();
  return models.length ? autoAssignModels(models).standard : '';
}
// ingest(엔티티 추출)는 micro 모델 — classify(standard)와 단일 슬롯 경합 시 빠르게 처리(finalize 와 일관).
async function ingestModel(): Promise<string> {
  if (isClaudeBackend()) return resolveAssignment().micro;
  const models = await ollama.listModels();
  return models.length ? autoAssignModels(models).micro : '';
}
app.post('/sources', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body['files'];
  const files = (Array.isArray(raw) ? raw : [raw]).filter((x): x is File => x instanceof File);
  const w = llmWiki();
  const model = await classifyModel();
  const imodel = await ingestModel();
  const results: Array<Record<string, unknown>> = [];
  let ok = 0;
  let dup = 0;
  // 내용해시 중복제거: 동일 텍스트(예: macOS 사본 'foo 2.pdf' 와 'foo.pdf' 동시 업로드, 혹은 재업로드)는
  // 위키·raw 에 두 번 들어가지 않는다. 비교 기준은 살아있는 source 가 참조하는 '원문(raw)' 해시 —
  // 페이지 본문이 갱신 누적·청크 분할로 변형돼도 원문 기준이라 재업로드를 놓치지 않는다(삭제된 자료의
  // 고아 raw 는 제외 → 삭제 후 재업로드 가능). 이번 요청 내 해시는 아래 루프에서 함께 추적.
  const seen = w.referencedRawHashes();
  for (const f of files) {
    const name = f.name || 'upload';
    if (!isSupportedExt(name)) { results.push({ file: name, status: 'unsupported', note: 'PDF/DOCX/HWPX/XLSX/PPTX/텍스트만 지원' }); continue; }
    if (f.size > 25_000_000) { results.push({ file: name, status: 'too-large' }); continue; }
    try {
      const buf = Buffer.from(await f.arrayBuffer());
      // 원본 바이너리 보존(프로비넌스) — 추출이 부실해도 나중에 더 나은 추출기로 재처리 가능하게.
      // (이전엔 추출 텍스트만 저장 → 원본 소실로 재추출 불가. 추출 전에 먼저 보존.)
      w.saveOriginal(name, buf);
      const text = await extractText(name, buf);
      if (!text.trim()) { results.push({ file: name, status: 'failed', note: '추출된 텍스트 없음' }); continue; }
      const h = createHash('sha1').update(text.trim()).digest('hex');
      if (seen.has(h)) { dup++; results.push({ file: name, status: 'duplicate', note: '동일 내용 자료가 이미 있어 건너뜀' }); continue; }
      seen.add(h);
      const rawRef = w.saveRaw(name, text);
      // 검색 친화 제목 — 폴더 경로(예: '2026년도/회계파트/...')를 제목으로 쓰면 slug 가 붙어 검색 토큰에 안 걸렸다.
      // basename 만 제목으로 쓰고(확장자 제거·언더스코어→공백·선행기호 제거), 폴더·괄호(작성자)는 검색 별칭으로 둔다.
      const pathParts = name.replace(/\\/g, '/').split('/').filter(Boolean);
      const baseName = (pathParts[pathParts.length - 1] ?? name).replace(/\.[^.]+$/, '');
      const title = baseName.replace(/_/g, ' ').replace(/^[\s★·*]+/, '').replace(/\s+/g, ' ').trim() || baseName;
      const titleAliases = [...new Set([
        ...pathParts.slice(0, -1),
        ...((baseName.match(/\(([^)]+)\)/g) || []).map((s) => s.replace(/[()]/g, '').trim())),
      ].filter(Boolean))];
      const page = w.addSourceDoc({ title, body: text, sources: [rawRef], aliases: titleAliases });
      w.appendLog('source', name);
      // 자동 직원귀속 분류는 백그라운드(업로드 응답 즉시) — 정산 패널이 ref 로 폴링.
      if (model) {
        void classifyAndAssign(page.slug, page.title, text, model);
        // 자료에서 엔티티/개념 추출 + [[링크]] 생성(두뇌 그래프 연결) — 백그라운드. 정산 패널에 결과 표출.
        setIngestStatus(page.slug, { state: 'pending', entities: [] });
        void w.ingest({ title, content: text, model: imodel || model, sources: [rawRef], skipSummary: true })
          .then((r) => setIngestStatus(page.slug, { state: 'done', entities: r.pages }))
          .catch(() => setIngestStatus(page.slug, { state: 'failed', entities: [] }));
      }
      results.push({ file: name, title: page.title, status: 'ok', ref: page.slug, page_id: page.slug, assigned: [] });
      ok++;
    } catch (e) {
      results.push({ file: name, status: 'failed', note: e instanceof Error ? e.message : String(e) });
    }
  }
  if (ok > 0) w.rebuildIndex();
  return c.json({ ok, skipped: dup, total: files.length, results });
});
app.get('/sources', (c) => {
  const sources = llmWiki().list('source').map((p) => ({
    id: p.slug, title: p.title, origin: 'upload', by: (p.contributors[0] ?? ''), file: (p.sources[0] ?? p.title),
  }));
  return c.json({ sources });
});
app.post('/sources/classify_status', async (c) => {
  const body = await c.req.json<{ refs?: string[] }>().catch(() => ({}) as { refs?: string[] });
  return c.json({ statuses: getStatuses(body.refs ?? []) });
});
app.post('/sources/reassign', async (c) => {
  const body = await c.req.json<{ ref?: string; to?: string }>().catch(() => ({}) as { ref?: string; to?: string });
  const r = reassign(body.ref ?? '', body.to ?? '');
  return r.ok ? c.json({ assigned_label: r.assigned_label }) : c.json({ error: r.error }, 400);
});
app.post('/sources/classify_retry', async (c) => {
  const body = await c.req.json<{ refs?: string[] }>().catch(() => ({}) as { refs?: string[] });
  const model = await classifyModel();
  let retrying = 0;
  if (model) for (const ref of body.refs ?? []) {
    const page = llmWiki().getPage(ref);
    if (page) { void classifyAndAssign(ref, page.title, page.body, model); retrying++; }
  }
  return c.json({ retrying });
});
app.get('/api-keys', (c) => c.json({ keys: listKeys(), hidden: hiddenKeys() }));
app.post('/api-keys', async (c) => {
  const b = await c.req.json<{ key?: string; value?: string }>().catch(() => ({} as { key?: string; value?: string }));
  return c.json(setKey(b.key ?? '', b.value ?? ''));
});
app.post('/api-keys/add', async (c) => {
  const b = await c.req.json<{ key?: string; label?: string; icon?: string; value?: string }>().catch(() => ({} as { key?: string; label?: string; icon?: string; value?: string }));
  return c.json(addCustom(b.key ?? '', b.label ?? '', b.icon ?? '', b.value ?? ''));
});
// 카드 삭제 — 사용자 키는 완전 제거, 기본 키는 값 제거+숨김(restore 로 복원).
app.delete('/api-keys/:key', (c) => c.json(deleteKey(c.req.param('key') ?? '')));
app.post('/api-keys/:key/restore', (c) => c.json(restoreKey(c.req.param('key') ?? '')));
app.get('/favicon.ico', (c) => c.body(null, 204));
// 수정 요청(v+1) — 부모 런의 전문가 입장 + 피드백으로 CEO 재종합.
async function reviseHandler(c: Context): Promise<Response> {
  const parentId = c.req.param('id') ?? '';
  const parent = RUNS.get(parentId);
  if (!parent) {
    // 메모리에 없으면(재시작/evict) 디스크에 런이 실재하는지 구분 — positions 는 메모리에만 있어 복원 불가하므로,
    // '모르는 런'(404)과 '재시작으로 입장 데이터 소실'(409)을 구분해 안내한다(이전엔 둘 다 혼란스런 404였다).
    const meta = loadRunMeta(parentId) ?? legacyMetaFromFiles(parentId);
    return meta
      ? c.json({ error: '서버 재시작으로 입장 데이터가 소실되었습니다. 원본 런을 다시 실행한 뒤 수정해 주세요.' }, 409)
      : c.json({ error: 'unknown run' }, 404);
  }
  if (!parent.positions?.length) return c.json({ error: '원본 입장 데이터가 없습니다(런 완료 후 다시 시도).' }, 409);
  const body = await c.req.json<{ feedback?: string }>().catch(() => ({}) as { feedback?: string });
  const feedback = (body.feedback ?? '').trim();
  if (!feedback) return c.json({ error: 'feedback 이 필요합니다' }, 400);

  yieldRunningAutos(); // revise 도 사용자 개시 런 — 진행 중 자율런을 양보시켜 launchRun 과 동일 정책 유지.
  const id = runId();
  const version = (parent.version ?? 1) + 1;
  const bus = createBus(id);
  const abort = new AbortController();
  const handle: RunHandle = { status: 'running', abort, topic: parent.topic, created_ts: new Date().toISOString(), version };
  RUNS.set(id, handle);
  evictRuns();

  runRevise(bus, { topic: parent.topic, positions: parent.positions, priorDeliverable: parent.deliverable ?? '', feedback, signal: abort.signal })
    .then((o) => { handle.status = 'done'; handle.deliverable = o.deliverable; handle.positions = o.positions; handle.subproblems = o.subproblems; })
    .catch((e: unknown) => {
      if (abort.signal.aborted || isAbort(e)) { handle.status = 'cancelled'; bus.emit(EventType.run_done, { status: 'cancelled' }); }
      else { handle.status = 'error'; bus.emit(EventType.error, { message: e instanceof Error ? e.message : String(e) }); bus.emit(EventType.run_done, { status: 'error' }); }
    })
    .finally(() => { persistEvents(id, bus); persistRunMeta(id, handle); });

  return c.json({ run_id: id, version });
}

app.post('/runs/:id/revise', reviseHandler);
// (HWPX 내보내기 제거 — 콘텐츠 스튜디오는 최종 산출물을 한글 문서로 변환하지 않는다.)
// 중단 런 재구동(resume) — 오케스트레이터에 체크포인트/경계-재시작 인프라가 없어(RunOptions
// 에 resumeFrom 없음; runOffice/runOrg 는 항상 처음부터) 안전한 재구동이 불가하다. 무계획 재실행은
// LLM 을 처음부터 다시 돌려 이벤트 seq 가 충돌하므로 막는다. 프론트는 이 501 을 받아 친절히 안내하고
// '기록 다시 보기'(loadPast)로 우회한다. (참고: 서버는 'interrupted' 상태를 만들지 않으므로 — running|
// done|error|cancelled — '이어가기' 버튼은 실제로 거의 렌더되지 않는다.)
app.post('/runs/:id/resume', (c) =>
  c.json({ error: '중단된 런의 자동 재구동은 아직 지원되지 않습니다. "다시 보기"로 기록을 열어 진행 과정·산출물을 확인하세요.' }, 501));

// --- 음성 입출력 (Voice I/O) ---
const sttHandler = async (c: Context): Promise<Response> => {
  if (!sttAvailable()) return c.json({ error: 'STT 미설치(mlx_whisper/ffmpeg 필요)' }, 503);
  const body = await c.req.parseBody({ all: true });
  const files = ([] as unknown[]).concat(body['files'] ?? []).filter((f): f is File => f instanceof File);
  const f = files[0];
  if (!f) return c.json({ error: '오디오 파일 없음' }, 400);
  if (f.size > 25_000_000) return c.json({ error: '오디오가 너무 큼(25MB 초과)' }, 400);
  try {
    const text = await transcribe(Buffer.from(await f.arrayBuffer()), { signal: c.req.raw.signal });
    return c.json({ text });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
};

const ttsHandler = async (c: Context): Promise<Response> => {
  if (!ttsAvailable()) return c.json({ error: 'TTS 미설치(say/ffmpeg 필요)' }, 503);
  const body = await c.req.json<{ text?: string; voice?: string }>().catch(() => ({} as { text?: string; voice?: string }));
  const text = (body.text ?? '').trim();
  if (!text) return c.json({ error: '텍스트 없음' }, 400);
  try {
    const mp3 = await synthesize(text, { voice: body.voice, signal: c.req.raw.signal });
    return new Response(new Uint8Array(mp3), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
};

const voicesHandler = async (c: Context): Promise<Response> => {
  const available = ttsAvailable();
  const voices = available ? await listKoreanVoices() : [];
  return c.json({ available: ttsAvailable(), ttsAvailable: ttsAvailable(), sttAvailable: sttAvailable(), voices, defaultVoice: getVoiceSettings().ttsVoice, conversational: getVoiceSettings().conversational });
};

const voiceSettingsHandler = async (c: Context): Promise<Response> => {
  const body = await c.req.json<{ conversational?: boolean }>().catch(() => ({} as { conversational?: boolean }));
  const patch: Partial<{ conversational: boolean }> = {};
  if (typeof body.conversational === 'boolean') patch.conversational = body.conversational;
  const next = setVoiceSettings(patch);
  return c.json({ conversational: next.conversational });
};

app.post('/voice/stt', sttHandler);
app.post('/api/voice/stt', sttHandler);
app.post('/voice/tts', ttsHandler);
app.post('/api/voice/tts', ttsHandler);
app.get('/voice/voices', voicesHandler);
app.get('/api/voice/voices', voicesHandler);
app.post('/voice/settings', voiceSettingsHandler);
app.post('/api/voice/settings', voiceSettingsHandler);

// --- 자비스 대화 ---
const jarvisHandler = async (c: Context): Promise<Response> => {
  // 가용성 — Claude 백엔드는 항상 가용(호출 시 인증 오류는 그때 표면화). 로컬만 설치 모델 확인.
  if (!isClaudeBackend()) {
    const models = await ollama.listModels().catch(() => []);
    if (!models.length) return c.json({ error: 'LLM 미가용(로컬 모델 없음)' }, 503);
  }
  const body = await c.req.json<{ messages?: { role: string; content: string }[] }>().catch(() => ({} as { messages?: { role: string; content: string }[] }));
  const messages = (body.messages ?? []).filter((m) => m && typeof m.content === 'string');
  if (!messages.length) return c.json({ error: '메시지 없음' }, 400);
  try {
    const out = await jarvisChat(messages as { role: 'user' | 'assistant'; content: string }[], { signal: c.req.raw.signal });
    return c.json(out);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
};
app.post('/jarvis/chat', jarvisHandler);
app.post('/api/jarvis/chat', jarvisHandler);

// ============================================================
// 정적 — React 프론트(/) + 경량 자체 UI(/lite)
// ============================================================
const DIST = path.resolve(process.cwd(), 'frontend/dist');
const PUBLIC = path.resolve(process.cwd(), 'public');

async function serveDistIndex(c: Context): Promise<Response> {
  try {
    return c.html(await readFile(path.join(DIST, 'index.html'), 'utf-8'));
  } catch {
    return c.html('<h1>React 프론트 미빌드</h1><p><code>cd frontend && pnpm install && pnpm build</code> 후 새로고침. 경량 UI: <a href="/lite">/lite</a></p>');
  }
}
app.get('/lite', async (c) => {
  try { return c.html(await readFile(path.join(PUBLIC, 'index.html'), 'utf-8')); }
  catch { return c.text('lite UI 없음', 500); }
});
app.use('/assets/*', serveStatic({ root: 'frontend/dist' }));
app.get('/', serveDistIndex);
app.use('/*', serveStatic({ root: 'frontend/dist' })); // favicon 등 기타 정적, 없으면 next→notFound
// 매칭 실패는 텍스트 대신 JSON 404(프론트 fetch 의 JSON 파싱 우아 처리).
app.notFound((c) => c.json({ error: 'not found' }, 404));

// 직원 워크스페이스 스캐폴드 — 14명 전원 data/agents/<id>/ 폴더를 보장(아직 미참여 직원도 포함).
for (const id of rolesById(getCompany()).keys()) ensureScaffold(id);

// 유휴 게이트 자율 사이클(옵트인: AUTO_CYCLE_MINUTES>0). 사용자 런이 없을 때만 콘텐츠 piece 1건을 전진시키고,
// 사용자 런 도착 시 양보(launchRun 이 abort). 기본 off 라 기본 동작엔 영향 없음.
const isRunLive = (runId?: string): boolean => !!runId && RUNS.get(runId)?.status === 'running';

// 이번 틱에 처리할 작업 — **재개 우선**: 사용자 양보·재시작으로 런이 죽어 stranded 된 비종료 piece 를 먼저
// 회수하고(신규 생성보다 우선), 없을 때만 새 아이디어를 제안·생성한다. 이게 '완전 자율'의 내구성 핵심 —
// 없으면 사용자가 앱을 쓸 때마다(유휴 게이트가 상시 양보) piece 가 idea 에서 고아가 되고 매 틱 새 piece 만 쌓인다.
// 신규 아이디어 생성 케이던스/백로그 게이트(재개는 무관) — 사용자 결정(주 2~3개) 준수 + ready 홍수 방지.
// 없으면 autoCycleMinutes 를 낮게 잡을 때 하루 수십 편이 생성돼 미발행 초안이 범람한다.
function canGenerateNew(pieces: Piece[]): boolean {
  if (pieces.filter((p) => p.stage === 'ready').length >= CONFIG.contentReadyCap) return false; // 미발행 초안 캡
  const minIntervalMs = (7 * 24 * 60 * 60 * 1000) / CONFIG.contentCadencePerWeek;               // 주 N편 → 최소 간격
  const lastCreated = pieces.reduce((mx, p) => (p.createdTs > mx ? p.createdTs : mx), '');
  return !lastCreated || (Date.now() - new Date(lastCreated).getTime()) >= minIntervalMs;
}

async function pickAutoWork(signal?: AbortSignal): Promise<Piece | null> {
  const pieces = pieceStore().list();
  const resume = selectResumablePiece(pieces, isRunLive);
  if (resume) return resume;                 // 재개는 케이던스와 무관 — 죽은 piece 회수 우선.
  if (!canGenerateNew(pieces)) return null;  // 케이던스/백로그 초과 → 신규 생성 보류.
  const idea = await proposeContentIdeas(signal);
  if (!idea) return null;
  return pieceStore().create({ title: idea.title, keyword: idea.keyword, subNiche: idea.subNiche });
}

const stopAutoCycle = startAutoCycle<Piece>({
  intervalMs: CONFIG.autoCycleMinutes * 60_000,
  isBusy: () => [...RUNS.values()].some((h) => h.status === 'running'), // 자율런 포함 — 동시 1런만(단일 KV 슬롯 불변식).
  pickWork: (signal) => pickAutoWork(signal),
  launch: (piece) => {
    const id = launchRun(piece.title, { auto: true, pieceId: piece.id, keyword: piece.keyword });
    if (id) pieceStore().update(piece.id, { runId: id, stage: 'draft' }); // 시작 성공 → draft(진행중). ''(억제)면 유지, 다음 틱 재개.
  },
  describe: (piece) => piece.title,
  log: (m) => console.log('[auto-cycle]', m),
});
if (CONFIG.autoCycleMinutes > 0) {
  // eslint-disable-next-line no-console
  console.log(`[ai-contents-studio] 자율 사이클 활성 — ${CONFIG.autoCycleMinutes}분 주기(유휴 게이트)`);
}
void stopAutoCycle; // 프로세스 생존 동안 유지(unref 타이머라 종료는 막지 않음)

// 일일 브리핑(옵트인: DAILY_BRIEFING_TIME="HH:MM"). 지정 시각에 다이제스트를 알림 채널로 발송. 빈값=off.
const stopDaily = startDaily({
  time: CONFIG.dailyBriefingTime,
  run: () => { void notify(buildBriefing()); },
  log: (m) => console.log('[briefing]', m),
});
if (CONFIG.dailyBriefingTime) {
  // eslint-disable-next-line no-console
  console.log(`[ai-contents-studio] 일일 브리핑 활성 — ${CONFIG.dailyBriefingTime}${notifyConfigured() ? '' : ' (알림 채널 미설정 — /api-keys 에서 웹훅/텔레그램 설정 필요)'}`);
}
void stopDaily;

// 일일 성과 동기화(옵트인: PERFORMANCE_SYNC_TIME="HH:MM"). 발행 후 측정창 도달한 piece 를 등록 수집기로
// 측정→강화(멱등). 기본 수집기(manual)는 measure 가 null 이라 no-op — 사람이 POST /pieces/:id/metrics 로
// 수동 입력한다. 실제 브라우저 스크레이퍼를 setCollector 로 등록하면 자동화(스크레이퍼 마일스톤, 사용자 로그인 필요).
async function syncPerformance(): Promise<void> {
  // 사용자 트리거 브라우저 작업(임시저장·수집)이 프로필을 쓰는 중이면 이번 주기는 건너뛴다(프로필 락 충돌 방지).
  if (naverProfileBusy) { console.log('[perf-sync]', `프로필 사용 중(${naverProfileBusy}) — 이번 주기 건너뜀`); return; }
  naverProfileBusy = '일일동기화';
  try {
  const collector = getCollector();
  const windowMs = CONFIG.performanceWindowDays * 24 * 60 * 60 * 1000;
  for (const p of pieceStore().list()) {
    if (p.stage !== 'published') continue;                                  // 측정 대상 = 발행됐고 아직 측정 안 된 것
    if (Date.now() - new Date(p.updatedTs).getTime() < windowMs) continue;  // 측정창 미도달(updatedTs≈발행시각) — 대기
    try {
      const sample = await collector.measure(p);
      if (sample) await ingestMetrics(p.id, sample);                        // 측정치 있으면 강화(measured→reflected)
    } catch (e) { console.log('[perf-sync]', `${p.id} 측정 실패(무해): ${e instanceof Error ? e.message : String(e)}`); }
  }
  } finally { naverProfileBusy = null; }
}
const stopPerfSync = startDaily({
  time: CONFIG.performanceSyncTime,
  run: () => { void syncPerformance(); },
  log: (m) => console.log('[perf-sync]', m),
});
if (CONFIG.performanceSyncTime) {
  // eslint-disable-next-line no-console
  console.log(`[ai-contents-studio] 성과 동기화 활성 — ${CONFIG.performanceSyncTime} · 수집기 "${getCollector().name}"(측정창 ${CONFIG.performanceWindowDays}일)`);
}
void stopPerfSync;

const port = CONFIG.port;
if (!process.env.VITEST) serve({ fetch: app.fetch, hostname: CONFIG.host, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[ai-contents-studio] http://${CONFIG.host}:${info.port}  (backend=${CONFIG.backend}, ollama=${CONFIG.ollamaBaseUrl})  · React=/ · lite=/lite`);
});

export { app };
