import { ApprovalItem, EventEnvelope } from "./events/types";

export interface RunInfo {
  run_id: string;
  topic: string;
  status: string;
  total_cost: number;
  created_ts: string;
  active: boolean;
  /** 수정 런 계보(⑤): 부모 런 id + 버전(v2부터 서버가 채움). */
  parent_run_id?: string | null;
  version?: number;
}

// --- 반복 업무 템플릿(②) -------------------------------------------------------
export interface TemplateInfo {
  id: string; name: string; topic: string;
  path?: string | null; agent?: string | null;
  schedule?: string | null; enabled: boolean;
}
export async function fetchTemplates(): Promise<TemplateInfo[]> {
  try {
    const r = await fetch("/templates");
    return r.ok ? (await r.json()).templates ?? [] : [];
  } catch { return []; }
}
export async function saveTemplate(t: Partial<TemplateInfo>): Promise<TemplateInfo> {
  const r = await fetch("/templates", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `저장 실패 (${r.status})`);
  return r.json();
}
export async function deleteTemplate(id: string): Promise<void> {
  await fetch(`/templates/${id}`, { method: "DELETE" });
}
export async function runTemplate(id: string): Promise<{ run_id: string }> {
  const r = await fetch(`/templates/${id}/run`, { method: "POST" });
  if (!r.ok) throw new Error(`템플릿 실행 실패 (${r.status})`);
  return r.json();
}

/** 산출물 수정 루프(⑤): 끝난 런에 피드백 → CEO 통합만 재실행하는 v{n} 런 시작. */
export async function reviseRun(runId: string, feedback: string):
  Promise<{ run_id: string; version: number }> {
  const r = await fetch(`/runs/${runId}/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback }),
  });
  if (!r.ok) {
    const text = await r.text();
    let msg = `수정 런 시작 실패 (${r.status})`;
    try { msg = JSON.parse(text).error ?? msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.json();
}

export async function fetchRuns(): Promise<RunInfo[]> {
  try {
    const r = await fetch("/runs");
    if (!r.ok) return [];
    return (await r.json()).runs ?? [];
  } catch {
    return [];
  }
}

export async function fetchRunLog(runId: string): Promise<EventEnvelope[]> {
  const r = await fetch(`/runs/${runId}/log`);
  if (!r.ok) throw new Error(`failed to load run log: ${r.status}`);
  return (await r.json()).events ?? [];
}

// ── External materials (외부 자료): upload docs into the LLM wiki so agents can use them ──
export interface SourceInfo { id: string; title: string; origin: string; by: string; file: string; }

export async function fetchSources(): Promise<SourceInfo[]> {
  try {
    const r = await fetch("/sources");
    if (!r.ok) return [];
    return (await r.json()).sources ?? [];
  } catch {
    return [];
  }
}

// Total stored wiki page count (+ raw source count) for the dashboard 위키 metric.
export interface AutonomyStatus {
  enabled: boolean; interval_minutes: number; shell: boolean; active: boolean;
  /** 진행 중인 자율런 id(있으면) — 유휴 시 오피스뷰 자동 관전용. */
  auto_run_id?: string | null;
  last_auto_ts: string | null; last_auto_topic: string | null;
}
export async function fetchAutonomyStatus(): Promise<AutonomyStatus | null> {
  try {
    const r = await fetch("/autonomy/status");
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function fetchWikiStats(): Promise<{ pages: number; sources: number; lessons: number }> {
  try {
    const r = await fetch("/wiki/stats");
    if (!r.ok) return { pages: 0, sources: 0, lessons: 0 };
    const d = await r.json();
    return { pages: d.pages ?? 0, sources: d.sources ?? 0, lessons: d.lessons ?? 0 };
  } catch {
    return { pages: 0, sources: 0, lessons: 0 };
  }
}

// 런타임 품질 설정(토론·추론) — 서버 재시작 없이 토글, 다음 런부터 반영.
export interface RunSettings { orgDebateRounds: number; agentThinking: boolean }
const DEFAULT_RUN_SETTINGS: RunSettings = { orgDebateRounds: 0, agentThinking: false };
export async function fetchRunSettings(): Promise<RunSettings> {
  try {
    const r = await fetch("/runsettings");
    return r.ok ? await r.json() : DEFAULT_RUN_SETTINGS;
  } catch {
    return DEFAULT_RUN_SETTINGS;
  }
}
export async function updateRunSettings(patch: Partial<RunSettings>): Promise<RunSettings> {
  try {
    const r = await fetch("/runsettings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return r.ok ? await r.json() : fetchRunSettings();
  } catch {
    return fetchRunSettings();
  }
}

// ── API 키 통합 관리 (.env) ──
export interface ApiKeyInfo {
  key: string; label: string; icon: string; desc: string;
  placeholder: string; needs_restart: boolean; set: boolean; masked: string; builtin: boolean;
}
export async function fetchApiKeys(): Promise<ApiKeyInfo[]> {
  try {
    const r = await fetch("/api-keys");
    if (!r.ok) return [];
    return (await r.json()).keys ?? [];
  } catch {
    return [];
  }
}
export async function saveApiKey(
  key: string, value: string,
): Promise<{ ok: boolean; error?: string; needs_restart?: boolean }> {
  try {
    const r = await fetch("/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({} as { error?: string })); return { ok: false, error: e.error }; }
    return await r.json();
  } catch {
    return { ok: false, error: "network" };
  }
}
export async function addApiKey(
  key: string, label: string, desc: string, value: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api-keys/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, label, desc, value }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({} as { error?: string })); return { ok: false, error: e.error }; }
    return await r.json();
  } catch {
    return { ok: false, error: "network" };
  }
}
export async function deleteApiKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`/api-keys/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!r.ok) { const e = await r.json().catch(() => ({} as { error?: string })); return { ok: false, error: e.error }; }
    return await r.json();
  } catch {
    return { ok: false, error: "network" };
  }
}

// status: ok | duplicate | unsupported | failed | too-large (백엔드) / network | filtered (프론트)
// ref = raw/ 원자료 참조(저장 증거), page_id = wiki/ reference 페이지 id(적재 증거).
export interface UploadFileResult {
  file: string; title?: string; status: string; note?: string;
  assigned?: string[]; ref?: string | null; page_id?: string | null;
}
export interface UploadResult { ok: number; total: number; results: UploadFileResult[]; }

// 분류(직원 귀속)는 업로드 응답 후 백그라운드 진행 — 정산 패널이 ref들로 폴링한다.
// null = 엔드포인트 없음/오류(예: 서버가 구버전·재시작 전) → 패널은 "확인 불가"로 표시.
export interface IngestStatus { state: "pending" | "done" | "failed"; entities: string[]; }
export interface ClassifyStatus { state: "pending" | "done" | "failed" | "unknown"; assigned: string[]; ingest?: IngestStatus; }
export async function fetchClassifyStatus(refs: string[]): Promise<Record<string, ClassifyStatus> | null> {
  try {
    const r = await fetch("/sources/classify_status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
    });
    if (!r.ok) return null;
    return (await r.json()).statuses ?? null;
  } catch {
    return null;
  }
}

// --- 단계별 ETA(과거 런 중앙값) ------------------------------------------------
export interface EtaStats {
  sample: number;
  stages: Record<string, number>;   // 단계명 → 중앙값(초)
  total_sec: number | null;
  cost_usd: number | null;
}
export async function fetchEta(): Promise<EtaStats | null> {
  try {
    const r = await fetch("/runs/eta");
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** 자료 오귀속 교정: ref 를 지정 직원에게 재귀속(기존 귀속 전부 제거). */
export async function reassignSource(ref: string, to: string):
  Promise<{ assigned_label: string } | null> {
  try {
    const r = await fetch("/sources/reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, to }),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** 실패한 분류(직원 귀속)의 수동 재시도. 성공 시 재시도에 들어간 건수, 실패 시 null. */
export async function retryClassify(refs: string[]): Promise<number | null> {
  try {
    const r = await fetch("/sources/classify_retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
    });
    if (!r.ok) return null;
    return (await r.json()).retrying ?? 0;
  } catch {
    return null;
  }
}

// --- LLM 백엔드 선택 ---------------------------------------------------------
export type LlmBackendId = "claude" | "local";
export interface LlmSetting { backend: LlmBackendId; local_model: string; }
export interface LlmBackend { id: LlmBackendId; label: string; available: boolean; }
export interface LlmStatus {
  setting: LlmSetting;
  backends: LlmBackend[];
  local_models: string[];
  /** 메모리 상주 중인 Ollama 모델(/api/ps) — keep_alive 튜닝 확인용. 구 서버엔 없음. */
  local_loaded?: { name: string; expires_at?: string; size_vram?: number; context_length?: number }[];
  local_base_url: string;
}
export async function fetchLlmStatus(): Promise<LlmStatus | null> {
  try {
    const r = await fetch("/llm");
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
export async function saveLlmSetting(
  backend: string, local_model: string,
): Promise<{ ok: boolean; error?: string; status?: LlmStatus }> {
  try {
    const r = await fetch("/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend, local_model }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({} as { error?: string })); return { ok: false, error: e.error }; }
    return { ok: true, status: await r.json() };
  } catch {
    return { ok: false, error: "network" };
  }
}

// --- MCP 서버 관리 -----------------------------------------------------------
export interface McpServer {
  id: string; name: string; icon: string; kind: string; desc: string;
  tools: string[]; enabled: boolean; toggleable: boolean; used_by: string[];
  transport?: string; needs_restart?: boolean;
}
export async function fetchMcp(): Promise<McpServer[]> {
  try {
    const r = await fetch("/mcp");
    if (!r.ok) return [];
    return (await r.json()).servers ?? [];
  } catch {
    return [];
  }
}
export async function toggleMcp(
  id: string, enabled: boolean,
): Promise<{ ok: boolean; error?: string; servers?: McpServer[] }> {
  try {
    const r = await fetch(`/mcp/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({} as { error?: string })); return { ok: false, error: e.error }; }
    return await r.json();
  } catch {
    return { ok: false, error: "network" };
  }
}

// ── 외부 API 커넥터(선언형/AI 자동설정) ──
export interface ConnectorCfg {
  id: string; keyName: string; label: string; icon: string; desc: string;
  endpoint: string; method?: string; blockLabel: string; scope: string | string[];
  extract: { type: string; itemsPath?: string; fields?: string[]; regex?: string; max?: number; limit?: number };
}
export async function listConnectors(): Promise<ConnectorCfg[]> {
  try { const r = await fetch("/connectors"); return (await r.json()).connectors ?? []; } catch { return []; }
}
export interface DocResult { title: string; url: string; snippet: string }
export async function searchDocs(apiName: string): Promise<{ ok: boolean; results?: DocResult[]; error?: string }> {
  try {
    const r = await fetch("/connectors/searchdocs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiName }) });
    return await r.json();
  } catch { return { ok: false, error: "network" }; }
}
export async function autoconfigConnector(keyName: string, apiName: string, docsUrl: string): Promise<{ ok: boolean; cfg?: ConnectorCfg; error?: string }> {
  try {
    const r = await fetch("/connectors/autoconfig", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keyName, apiName, docsUrl }) });
    return await r.json();
  } catch { return { ok: false, error: "network" }; }
}
export async function testConnector(cfg: ConnectorCfg, query: string): Promise<{ ok: boolean; preview?: string; empty?: boolean; note?: string; error?: string }> {
  try {
    const r = await fetch("/connectors/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cfg, query }) });
    return await r.json();
  } catch { return { ok: false, error: "network" }; }
}
export async function saveConnector(cfg: ConnectorCfg): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) });
    return await r.json();
  } catch { return { ok: false, error: "network" }; }
}
export async function deleteConnector(id: string): Promise<{ ok: boolean }> {
  try { const r = await fetch(`/connectors/${encodeURIComponent(id)}`, { method: "DELETE" }); return await r.json(); } catch { return { ok: false }; }
}

// --- "제2의 두뇌" wiki graph -------------------------------------------------
export type WikiNodeType = "page" | "tag" | "source" | "agent";
export interface WikiGraphNode {
  id: string;
  type: WikiNodeType;
  label: string;
  // page-only
  slug?: string;
  category?: string;
  stance?: string;
  status?: string;
  confidence?: string;
  tags?: string[];
  contributors?: string[];
  source_count?: number;
  degree?: number;
  contested?: boolean;
  stale?: boolean;
  summary?: string;
  updated_ts?: string;
  // tag-only
  count?: number;
  // source-only
  origin?: string;
  by?: string;
}
export type WikiLinkKind =
  | "relates" | "rebuts" | "cites" | "supersedes" | "supports" | "refines"
  | "tag" | "source" | "author";
export interface WikiGraphLink { source: string; target: string; kind: WikiLinkKind; }
export interface WikiGraph {
  nodes: WikiGraphNode[];
  links: WikiGraphLink[];
  stats: { pages: number; tags: number; sources: number; agents: number; links: number };
}
export interface WikiPageDetail {
  id: string; slug: string; title: string; category: string; status: string;
  stance: string; confidence: string; tags: string[]; aliases: string[];
  contributors: string[]; sources: string[]; body: string;
  created_ts: string; updated_ts: string;
  related: { relation: string; direction: "in" | "out"; other_id: string; other_title: string }[];
}

export async function fetchWikiGraph(): Promise<WikiGraph> {
  const r = await fetch("/wiki/graph");
  if (!r.ok) throw new Error(`위키 그래프 로드 실패: ${r.status}`);
  return await r.json();
}

export async function fetchWikiPage(id: string): Promise<WikiPageDetail | null> {
  try {
    const r = await fetch(`/wiki/page/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export interface WikiPageRow {
  id: string; title: string; category: string; status: string; stance: string;
  contributors: string[]; tags: string[]; source_count: number; updated_ts: string; summary: string;
}
export interface WikiPagesResult {
  pages: WikiPageRow[]; counts: Record<string, number>; total_pages: number;
}

export async function fetchWikiPages(category = "", limit = 300): Promise<WikiPagesResult> {
  try {
    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    qs.set("limit", String(limit));
    const r = await fetch(`/wiki/pages?${qs.toString()}`);
    if (!r.ok) return { pages: [], counts: {}, total_pages: 0 };
    return await r.json();
  } catch {
    return { pages: [], counts: {}, total_pages: 0 };
  }
}

export async function uploadSources(
  files: FileList | File[],
  timeoutMs = 120_000,
): Promise<UploadResult> {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append("files", f);
  // A heavy batch can keep the server busy for a while; abort (→ retry by caller) only
  // after a generous timeout so a genuinely stuck request can't hang the whole upload.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("/sources", { method: "POST", body: fd, signal: ctrl.signal });
    if (!r.ok) throw new Error(`업로드 실패: ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// send a direct instruction to a running run (the timeline chat)
export async function sendMessage(runId: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(`/runs/${runId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// delete a run from history (cancels it first if still active)
export async function deleteRun(runId: string): Promise<boolean> {
  try {
    const r = await fetch(`/runs/${runId}`, { method: "DELETE" });
    return r.ok;
  } catch {
    return false;
  }
}

// --- employee directory (independent of any run) ---
export interface RoleInfo {
  id: string;
  title: string;       // 직무(안정적 정체성)
  name?: string;       // 현 담당자 실명(교체 가능)
  level: string;
  team: string | null;
  tools: string[];
  skills: string[];
  model: string;
  stance: string;
  is_critic: boolean;
  autonomy: number;
}
export interface CompanyInfo {
  name: string;
  ceo: RoleInfo;
  teams: { id: string; name: string; lead: RoleInfo; members: RoleInfo[] }[];
}
export interface AgentProfile extends RoleInfo {
  system_prompt: string;
  skills_loaded: string[];
  autonomy_effective: number;
  goal: string;
  memory: string;
  verified: string;
  injected: string;
  tools_md: string;
  activity_tail: string[];
  usage_pages: { page_id: string; title: string }[];
}

// --- 직원 편집: 팀/역할 구조 CRUD ---
async function jsonReq(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string; [k: string]: any }> {
  try {
    const r = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, ...data };
  } catch {
    return { ok: false, error: "network" };
  }
}
export const addTeam = (name: string) => jsonReq("/company/teams", "POST", { name });
export const renameTeam = (tid: string, name: string) => jsonReq(`/company/teams/${tid}`, "PATCH", { name });
export const deleteTeam = (tid: string) => jsonReq(`/company/teams/${tid}`, "DELETE");
export const addMember = (tid: string, body: { title: string; system_prompt?: string; model?: string; stance?: string; is_critic?: boolean; tools?: string[] }) =>
  jsonReq(`/company/teams/${tid}/members`, "POST", body);
export const patchRole = (rid: string, body: { title?: string; system_prompt?: string; model?: string; stance?: string; is_critic?: boolean; tools?: string[] }) =>
  jsonReq(`/company/roles/${rid}`, "PATCH", body);
export const deleteRole = (rid: string) => jsonReq(`/company/roles/${rid}`, "DELETE");
export async function fetchCompany(): Promise<CompanyInfo | null> {
  try {
    const r = await fetch("/company");
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
export async function fetchAgent(id: string): Promise<AgentProfile | null> {
  try {
    const r = await fetch(`/agents/${id}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// edit an employee's goal/tools/autonomy
export async function patchAgent(
  id: string,
  body: { goal?: string; tools?: string[]; autonomy?: number },
): Promise<boolean> {
  try {
    const r = await fetch(`/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}
export async function addSkill(id: string, name: string, content: string): Promise<boolean> {
  try {
    const r = await fetch(`/agents/${id}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
export async function deleteSkill(id: string, skill: string): Promise<boolean> {
  try {
    const r = await fetch(`/agents/${id}/skills/${encodeURIComponent(skill)}`, { method: "DELETE" });
    return r.ok;
  } catch {
    return false;
  }
}

// employee workspace graft: globally-pending approvals (incl. run-end tool-grant
// recommendations). Hydrates the banner on mount/refresh — not only from live SSE,
// so a recommendation queued at a past run's end is still actionable later.
// Backend item uses `id`; map it to the frontend `approval_id` shape.
export async function fetchApprovals(): Promise<ApprovalItem[]> {
  try {
    const r = await fetch("/approvals");
    if (!r.ok) return [];
    const data = await r.json();
    const pending = Array.isArray(data?.pending) ? data.pending : [];
    return pending.map(
      (p: Record<string, unknown>): ApprovalItem => ({
        approval_id: String(p.id ?? p.approval_id ?? ""),
        agent_id: (p.agent_id as string | null) ?? null,
        action_type: String(p.action_type ?? "action"),
        summary: String(p.summary ?? ""),
        autonomy: typeof p.autonomy === "number" ? p.autonomy : undefined,
        status: "pending",
      }),
    );
  } catch {
    return [];
  }
}

// employee workspace graft: decide a pending approval (wakes a blocked run)
export async function decideApproval(
  approvalId: string,
  approved: boolean,
  note = "",
): Promise<boolean> {
  try {
    const r = await fetch(`/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved, note }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// --- 음성 입출력 ---
export async function getVoices(): Promise<{ available: boolean; sttAvailable: boolean; ttsAvailable: boolean; voices: string[]; defaultVoice: string; conversational: boolean }> {
  try {
    const r = await fetch("/voice/voices");
    if (!r.ok) return { available: false, sttAvailable: false, ttsAvailable: false, voices: [], defaultVoice: "Yuna", conversational: false };
    return await r.json();
  } catch { return { available: false, sttAvailable: false, ttsAvailable: false, voices: [], defaultVoice: "Yuna", conversational: false }; }
}

// --- 자비스 채팅 ---
export async function postJarvisChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<{ reply: string; delegate?: { task: string; agent?: string } }> {
  const r = await fetch('/jarvis/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `자비스 응답 실패 (${r.status})`);
  return await r.json();
}

export async function setVoiceConversational(on: boolean): Promise<boolean> {
  try {
    const r = await fetch('/voice/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversational: on }),
    });
    return r.ok ? (await r.json()).conversational ?? on : on;
  } catch { return on; }
}

/** 녹음 Blob 업로드 → 전사 텍스트. 실패 시 빈 문자열. */
export async function sttUpload(blob: Blob, timeoutMs = 60_000): Promise<string> {
  const fd = new FormData();
  fd.append("files", blob, "speech.webm");        // 필드명 'files' = 서버 parseBody 기대값
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("/voice/stt", { method: "POST", body: fd, signal: ctrl.signal });
    if (!r.ok) return "";
    return ((await r.json()).text ?? "").trim();
  } catch { return ""; }
  finally { clearTimeout(timer); }
}

/** 텍스트 → 오디오 Blob(mp3). 실패 시 null. */
export async function ttsFetch(text: string, voice?: string): Promise<Blob | null> {
  try {
    const r = await fetch("/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
    if (!r.ok) return null;
    return await r.blob();
  } catch { return null; }
}

// 저장 파일명 정리 — 60자 절단 문장형 이름은 macOS 저장 패널이 저장 버튼을
// 비활성화하는 사례가 있어(짧은 이름은 전부 정상 저장됨) 40자 내 단어 경계로 줄인다.
function safeDownloadName(raw: string, fallback = "최종결과물"): string {
  const base = raw.replace(/\.hwpx$/i, "").replace(/[\s_]+/g, " ").trim();
  let cut = base.slice(0, 40);
  if (base.length > 40) {
    const sp = cut.lastIndexOf(" ");
    if (sp > 20) cut = cut.slice(0, sp); // 단어 중간에서 끊기지 않게
  }
  cut = cut.replace(/[\s.,·]+$/g, "");
  return (cut || fallback) + ".hwpx";
}

// 최종 결과물 한글(HWPX) 다운로드. window.open(팝업) 내비게이션 다운로드는 Chrome의
// "다운로드 전 저장 위치 묻기" 설정과 만나면 팝업 탭이 닫히며 저장 대화상자까지
// 같이 취소되는(USER_CANCELED, 0바이트) 사례가 실측됨 — 메인 탭에서 fetch→blob→
// 앵커 클릭으로 받는다. 실패(400/500) 시 서버 JSON의 error 메시지를 throw.
export async function downloadRunHwpx(runId: string): Promise<void> {
  const r = await fetch(`/runs/${encodeURIComponent(runId)}/export/hwpx`);
  if (!r.ok) {
    // body는 한 번만 읽을 수 있으므로 text로 받고 JSON 파싱을 시도한다.
    let msg = `다운로드 실패 (HTTP ${r.status})`;
    try {
      const t = (await r.text()).trim();
      try {
        const j = JSON.parse(t);
        msg = j?.error || msg;
      } catch {
        // JSON 아님(프록시 502/HTML 에러 등) — 본문 일부라도 보여준다.
        if (t) msg += ` — ${t.slice(0, 200)}`;
      }
    } catch { /* 본문도 못 읽음 — 기본 메시지 유지 */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  const cd = r.headers.get("content-disposition") ?? "";
  const star = /filename\*=utf-8''([^;]+)/i.exec(cd);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  const filename = safeDownloadName(star ? decodeURIComponent(star[1]) : plain?.[1] ?? "");
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // 다운로드가 blob을 이미 캡처한 뒤라 지연 revoke로 충분(Safari 호환 위해 즉시 X).
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}


// ============================================================
// 콘텐츠 piece — 완전 자율 캘린더/초안검토(크로스-런, REST 폴링. store/fold 금지 — 스크럽 시 수치 변형 방지).
// ============================================================
export type PieceStage =
  | "idea" | "research" | "draft" | "ready" | "published" | "measured" | "reflected" | "error";
export interface PieceInfo {
  id: string;
  runId?: string;
  title: string;
  keyword?: string;
  subNiche?: string;
  stage: PieceStage;
  publishedUrl?: string;
  seoScore?: number;
  errors?: number;
  createdTs: string;
  updatedTs: string;
}
export interface SeoCheck { label: string; ok: boolean; note?: string }
export interface BlogDraft {
  topic: string;
  primaryKeyword: string;
  titleCandidates: string[];
  metaDescription: string;
  tags: string[];
  imageSlots: Array<{ alt: string; prompt: string }>;
  internalLinks: string[];
  bodyMarkdown: string;
  seo: { score: number; checklist: SeoCheck[] };
}
export interface PieceDraftResp { piece: PieceInfo; draft: BlogDraft; md: string; html: string }
export interface MetricSample {
  measuredAt: string; views: number; dwellSec?: number;
  searchInflow: Array<{ keyword: string; count: number; rank?: number }>; source?: string;
}

export async function fetchPieces(): Promise<PieceInfo[]> {
  try { const r = await fetch("/pieces"); if (!r.ok) return []; return (await r.json()).pieces ?? []; }
  catch { return []; }
}
export async function createPiece(body: { title: string; keyword?: string; subNiche?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/pieces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({} as { error?: string })); return { ok: false, error: e.error }; }
    return { ok: true };
  } catch { return { ok: false, error: "network" }; }
}
export async function fetchPieceDraft(id: string): Promise<PieceDraftResp | null> {
  try { const r = await fetch(`/pieces/${id}/draft`); return r.ok ? await r.json() : null; }
  catch { return null; }
}
export async function publishPiece(id: string, url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`/pieces/${id}/published`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    if (!r.ok) { const e = await r.json().catch(() => ({} as { error?: string })); return { ok: false, error: e.error }; }
    return { ok: true };
  } catch { return { ok: false, error: "network" }; }
}
export async function postPieceMetrics(id: string, body: unknown): Promise<{ ok: boolean; reinforced?: boolean }> {
  try {
    const r = await fetch(`/pieces/${id}/metrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return { ok: false };
    const j = await r.json().catch(() => ({}));
    return { ok: true, reinforced: !!j.reinforced };
  } catch { return { ok: false }; }
}
export async function fetchPieceMetrics(id: string): Promise<MetricSample[]> {
  try { const r = await fetch(`/pieces/${id}/metrics`); if (!r.ok) return []; return (await r.json()).metrics ?? []; }
  catch { return []; }
}

// --- 지식 주입: 파일(들)을 선택한 에이전트(들)에 '우선 신뢰 지식'으로 주입 ---
export interface InjectResult {
  ok: boolean;
  files?: { file: string; status: string; chars?: number; note?: string }[];
  agents?: { agent: string; name: string; totalChars: number; overCap: boolean }[];
  warning?: string | null;
  error?: string;
}
export async function injectKnowledge(agentIds: string[], files: File[] | FileList): Promise<InjectResult> {
  try {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    fd.append("agent_ids", agentIds.join(","));
    const r = await fetch("/agents/knowledge", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({} as Record<string, unknown>));
    return r.ok ? { ok: true, ...j } : { ok: false, error: (j as { error?: string }).error || `HTTP ${r.status}`, files: (j as InjectResult).files };
  } catch { return { ok: false, error: "network" }; }
}
export async function clearInjectedKnowledge(id: string): Promise<boolean> {
  try { const r = await fetch(`/agents/${id}/knowledge`, { method: "DELETE" }); return r.ok; }
  catch { return false; }
}

// piece 온디맨드 실행 — 자율 케이던스를 안 기다리고 지금 초안 런을 띄운다.
export async function runPiece(id: string): Promise<{ ok: boolean; run_id?: string; error?: string }> {
  try {
    const r = await fetch(`/pieces/${id}/run`, { method: "POST" });
    const j = await r.json().catch(() => ({} as { run_id?: string; error?: string }));
    return r.ok ? { ok: true, run_id: j.run_id } : { ok: false, error: j.error || `HTTP ${r.status}` };
  } catch { return { ok: false, error: "network" }; }
}
