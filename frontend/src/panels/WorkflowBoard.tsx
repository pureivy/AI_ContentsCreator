// 🔀 워크플로우 — a live "mission control" board: the macro DISPATCH PROTOCOL phase
// pipeline (위임→작업→토론→보고→통합→완료) + every team member's CURRENT task and the
// time of their last action. Pure projection of the store (phases/agents/activity), so it
// updates live during a run (1s tick for elapsed) and rebuilds correctly on replay/seek.
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { AgentNode } from "../events/types";
import { agentColor, agentGlyph, resolveName } from "./agentVisual";
import { isWorkingNow } from "../events/working";
import Avatar from "./Avatar";

// the CEO dispatch protocol, in order. Team/_ceo phases map onto these macro stages.
const MACRO = [
  { key: "delegate", label: "위임" },
  { key: "work", label: "작업 진행" },
  { key: "debate", label: "팀 토론" },
  { key: "report", label: "보고" },
  { key: "integrate", label: "통합" },
  { key: "done", label: "완료" },
];
function phaseMacro(phase?: string): number {
  switch (phase) {
    case "delegate": return 0;
    case "brief": case "decompose": case "assign": case "work": return 1;
    case "debate": return 2;
    case "report": return 3;
    case "review": case "integrate": return 4;
    default: return -1;
  }
}
const PHASE_LABEL: Record<string, string> = {
  brief: "브리핑", decompose: "업무 분해", assign: "업무 배정", work: "작업 진행",
  debate: "팀 토론", report: "보고", delegate: "위임", review: "검토", integrate: "통합", idle: "대기",
};
const TERMINAL = new Set(["ok", "partial", "cancelled", "budget_exceeded", "error", "interrupted"]);

function clock(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "--:--:--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function ago(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 0) return "방금";
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분 ${sec % 60}초`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
// highest macro stage reached across every team + the CEO; terminal status ⇒ 완료.
function currentMacro(phases: Record<string, string>, status: string): number {
  if (TERMINAL.has(status)) return MACRO.length - 1;
  let max = -1;
  for (const ph of Object.values(phases)) max = Math.max(max, phaseMacro(ph));
  if (max < 0 && (status === "running" || Object.keys(phases).length > 0)) max = 0;
  return max;
}

// A real run-progress meter for the OFFICE view — a filled, segmented bar across the 6
// DISPATCH PROTOCOL macro stages (위임→작업→토론→보고→통합→완료) with a %. This is the
// office's actual 진행률 indicator; it is intentionally distinct from the 자료실 책장
// (a knowledge shelf, not progress). Hidden when idle (no run yet).
export function OfficeProgressBar() {
  const phases = useStore((st) => st.phases);
  const status = useStore((st) => st.status);
  const cur = currentMacro(phases, status);
  if (cur < 0) return null;
  const total = MACRO.length;                       // 6 stages
  const pct = Math.round(((cur + 1) / total) * 100); // stages reached / total
  const terminal = TERMINAL.has(status);
  return (
    <div className="office-progress" title="DISPATCH PROTOCOL 진행 단계 (실제 런 진행률)">
      <span className="op-label">📊 진행률</span>
      <div className="op-track">
        {MACRO.map((m, i) => {
          const state = terminal ? "done" : i < cur ? "done" : i === cur ? "current" : "pending";
          return (
            <div key={m.key} className={`op-seg ${state}`}>
              <span className="op-seg-label">{m.label}</span>
            </div>
          );
        })}
      </div>
      <span className="op-pct">{pct}%</span>
    </div>
  );
}

// The DISPATCH PROTOCOL stepper — also used compactly at the top of the timeline.
export function PhaseStepper({ compact = false }: { compact?: boolean }) {
  const phases = useStore((st) => st.phases);
  const status = useStore((st) => st.status);
  const cur = currentMacro(phases, status);
  if (cur < 0) return null;
  return (
    <div className={`phase-stepper${compact ? " compact" : ""}`}>
      {!compact && <div className="wf-head">DISPATCH PROTOCOL</div>}
      <div className="phase-steps">
        {MACRO.map((st, i) => {
          const state = i < cur ? "done" : i === cur ? "current" : "pending";
          return (
            <div key={st.key} className={`phase-step ${state}`}>
              <span className="phase-dot">{state === "done" ? "✓" : i + 1}</span>
              <span className="phase-label">{st.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function WorkflowBoard({ names }: { names?: Record<string, string> }) {
  const s = useStore();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (s.status !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [s.status]);

  // each agent's most-recent activity timestamp = their "last seen working" time.
  const lastTs = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of s.activity) {
      if (it.actorId && (!m[it.actorId] || it.ts > m[it.actorId])) m[it.actorId] = it.ts;
    }
    return m;
  }, [s.activity]);

  const running = s.status === "running";
  // Uses the shared isWorkingNow rule (events/working.ts) for the working/idle decision
  // so CEO and members don't latch "작업 중" based on raw spawned status. Only the
  // 토론/작업 label distinction (debate phase → 토론 중) is kept locally.
  const statusOf = (a: AgentNode) => {
    if (a.status === "failed") return { icon: "⚠", label: "오류", cls: "con" };
    if (isWorkingNow(a, s)) {
      const teamPhase = a.team ? s.phases[a.team] : s.phases["_ceo"];
      return teamPhase === "debate"
        ? { icon: "💬", label: "토론 중", cls: "info" }
        : { icon: "✍️", label: "작업 중", cls: "info" };
    }
    if (a.status === "spoke" || a.status === "converged") return { icon: "☕", label: "휴식 중", cls: "pro" };
    return { icon: "⏸", label: "대기", cls: "muted" };
  };

  const Row = (a: AgentNode) => {
    const ms = statusOf(a);
    const ts = lastTs[a.agent_id];
    return (
      <div key={a.agent_id} className="wf-member">
        <Avatar id={a.agent_id} glyph={agentGlyph(a.level, a.agent_id, a.persona?.role ?? "")} size={24} head />
        <div className="wf-member-body">
          <div className="wf-member-top">
            <span className="wf-name" style={{ color: agentColor(a.agent_id) }}>{resolveName(a.agent_id, a.persona, names) || a.persona?.role || a.agent_id}</span>
            <span className={`wf-status tone-${ms.cls}`}>{ms.icon} {ms.label}</span>
          </div>
          <div className="wf-time">
            🕘 {ts ? clock(ts) : "—"}
            {running && ts && <em className="wf-ago"> · {ago(now - new Date(ts).getTime())} 전</em>}
          </div>
        </div>
      </div>
    );
  };

  const agents = Object.values(s.agents);
  const ceo = agents.find((a) => a.level === "ceo");
  const hasRun = s.teamOrder.length > 0 || agents.length > 0;
  if (!hasRun) {
    return (
      <p className="activity-empty">
        아직 워크플로우가 없습니다. 토론이 시작되면 진행 단계와 팀원별 업무·시간이 여기에 표시됩니다.
      </p>
    );
  }

  return (
    <div className="wf-board">
      <PhaseStepper />
      <div className="wf-section">
        <div className="wf-head">팀원 현황 · 업무 / 시간</div>
        {ceo && (
          <div className="wf-team">
            <div className="wf-team-head">
              <b>CEO · 사장</b>
              <span className="wf-phase">{PHASE_LABEL[s.phases["_ceo"] ?? "idle"] ?? s.phases["_ceo"] ?? "대기"}</span>
            </div>
            {Row(ceo)}
          </div>
        )}
        {s.teamOrder.map((tid) => {
          const team = s.teams[tid];
          if (!team) return null;
          const lead = agents.find((a) => a.team === tid && a.level === "lead");
          const members = agents.filter((a) => a.team === tid && a.level === "member");
          if (!lead && members.length === 0) return null;
          return (
            <div key={tid} className="wf-team">
              <div className="wf-team-head">
                <b>{team.name}</b>
                <span className="wf-phase">{PHASE_LABEL[s.phases[tid] ?? "idle"] ?? s.phases[tid] ?? "대기"}</span>
              </div>
              {lead && Row(lead)}
              {members.map(Row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
