// OfficeView — a top-down 2D virtual office that renders the SAME event-folded
// uiState as AgentGraph, just as a stylized office instead of a node graph.
// No backend/reducer change: it's another renderer over `fold(events)`.
//
// Mapping (see docs/design-refs/office-view.md):
//   role(CEO/lead/member) -> a character at a desk in the CEO room / team zone
//   agent_spawned   -> character pops in
//   agent_thinking  -> 💭 + pulse ring, live streamed text in the speech bubble
//   debate_message  -> speech bubble with the latest line
//   debate round    -> a team's members gather at their meeting spot, then return
//   CEO integrating -> team leads walk up toward the CEO room
//   wiki_page_written -> book spines fill the 자료실 shelf
//   lesson_learned  -> trophies on the 교훈 shelf
//   status          -> avatar ring color (thinking/spoke/failed)
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "../store";
import { AgentNode } from "../events/types";
// Phases in which a member / a lead is actually "working" — SHARED with DashboardBar's
// WORKING counter (events/working.ts) so choreography and counter can't diverge.
import { LEAD_WORK_PHASES, MEMBER_WORK_PHASES } from "../events/working";
import { fetchCompany, CompanyInfo, RoleInfo } from "../api";
import Avatar from "./Avatar";
import { personLabel } from "./agentVisual";
import { clusterBelow, meetingCircle, REST_SPOTS, CORRIDOR_SPOTS, STROLL, MEETING_SEATS, AVATAR_W, AVATAR_H, Pt } from "./officeChoreography";

// Fixed 4:3 design canvas. Everything inside is laid out against this constant
// size (positions in %, furniture in px), then the whole floor is uniformly
// scaled with transform:scale() to fit the panel — so resizing the window
// shrinks/grows every element together and the office always stays 4:3.
const BASE_W = 1280;
const BASE_H = 960;

// Desk seats within a team zone (fx: 0..1 across, fy: 0..1 down), chosen by team size
// so the big avatars never overlap each other and never cross the zone walls.
//  ≤3명: 하단 일렬.  4~7명: 9시(왼쪽)·3시(오른쪽) 기둥 + 하단(6시) 2.  8명(경영지원팀): 6시 3·9시 2·3시 3.
// 3시(오른쪽) 기둥을 최대 3자리까지 우선 확보(사용자 요청 "3시에 책상 3개"), 채움 순서는
// 하단 → 9시 → 3시 라서 6번째(index 5) 멤버가 3시 맨 위에 앉는다.
// face = 책상이 등지는 벽 방향(아바타는 그 반대편에 앉아 벽을 바라봄).
type Face = "up" | "down" | "left" | "right";
type Seat = { fx: number; fy: number; face: Face };
function seatsFor(n: number): Seat[] {
  // 사이드 좌석: 아바타는 벽쪽, 책상은 안쪽(센터)으로 — 책상을 180° 돌려 의자가 아바타를 향하게 한다.
  //  R = 오른쪽 벽 좌석 → 아바타 오른쪽, 책상 왼쪽(face "left" = rotate-90).
  //  L = 왼쪽 벽 좌석   → 아바타 왼쪽,   책상 오른쪽(face "right" = rotate+90).
  const R = (fy: number): Seat => ({ fx: 0.80, fy, face: "left" });   // 3시(오른쪽 벽)
  // 9시 fx는 0.20이 아니라 0.008 — framer-motion이 Character의 translate(-50%,-50%)를
  // 덮어써 모든 아바타가 ~31px 오른쪽으로 밀림. 왼쪽 열은 그만큼 벽에서 멀어지므로
  // fx를 줄여 보정 → 벽-아바타 거리를 3시(오른쪽 열, ~18px)와 동일하게 맞춘다.
  const L = (fy: number): Seat => ({ fx: 0.008, fy, face: "right" }); // 9시(왼쪽 벽)
  const B = (fx: number): Seat => ({ fx, fy: 0.76, face: "down" });  // 하단 중앙
  switch (n) {
    case 0: return [];
    case 1: return [{ fx: 0.50, fy: 0.75, face: "down" }];
    case 2: return [{ fx: 0.34, fy: 0.75, face: "down" }, { fx: 0.66, fy: 0.75, face: "down" }];
    case 3: return [{ fx: 0.26, fy: 0.75, face: "down" }, { fx: 0.50, fy: 0.75, face: "down" }, { fx: 0.74, fy: 0.75, face: "down" }];
    case 4: return [B(0.34), B(0.66), R(0.30), R(0.66)];
    case 5: return [B(0.34), B(0.66), L(0.46), R(0.30), R(0.66)];
    case 6: return [B(0.36), B(0.64), L(0.30), L(0.70), R(0.30), R(0.70)];
    case 7: return [B(0.40), B(0.60), L(0.24), L(0.50), L(0.76), R(0.30), R(0.70)];
    // 경영지원팀(멤버 8명): 6시 3 · 9시 2 · 3시 3.
    //  · 6시(B) 폭은 기획팀(case 3)과 동일: 0.26/0.50/0.74.
    //  · 9시(L: 전진영·하예림) 간격 == 3시(R: 김홍수·이윤아·권이담) 간격 = 0.24.
    //  · 9시(L)=아바타 왼쪽/책상 오른쪽, 3시(R)=아바타 오른쪽/책상 왼쪽 (둘 다 아바타가 벽쪽).
    //  · 6시를 넓히면 끝 책상(0.74)이 3시 벽(0.80)에 근접하므로, R/L 기둥은 0.24 간격을
    //    유지한 채 위로 올려(R 0.10~0.58) 큰 아바타(104px)끼리 겹치지 않게 한다.
    case 8: return [B(0.26), B(0.50), B(0.74), L(0.22), L(0.46), R(0.10), R(0.34), R(0.58)];
    default: return [B(0.40), B(0.60), L(0.20), L(0.45), L(0.70), R(0.20), R(0.45), R(0.70)];
  }
}

// book-spine colors for the wall bookshelves
const SHELF = ["#e06c75", "#e5c07b", "#98c379", "#61afef", "#c678dd", "#56b6c2", "#d19a66"];

// 회의실(conference room) table center in office-% (matches the .conf-table CSS).
const CONF = { cx: 16.5, cy: 16.5, rx: 10, ry: 7 };
function confSeat(i: number, n: number): { x: number; y: number } {
  const ang = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
  return { x: CONF.cx + Math.cos(ang) * CONF.rx, y: CONF.cy + Math.sin(ang) * CONF.ry };
}

// CEO desk is at (50,13). A lead "reports to the CEO" / "is briefed" by standing in
// front of (just below) the CEO desk; multiple leads fan out in a short row.
const CEO_DESK = { x: 50, y: 13 };
function ceoVisitorSeat(i: number, n: number): { x: number; y: number } {
  const span = Math.min(Math.max(n, 1), 4) * 8;        // total horizontal spread
  const x = n > 1 ? 50 - span / 2 + (span * i) / (n - 1) : 50;
  return { x, y: 20 };
}

const RING: Record<string, string> = {
  spawned: "#3a4252",
  thinking: "#58a6ff",
  spoke: "#3fb950",
  converged: "#3fb950",
  failed: "#f85149",
};


// Pick a character glyph from the role id / title keywords.
function glyphFor(level?: string, id = "", title = ""): string {
  if (level === "ceo") return "👔";
  const k = (id + " " + title).toLowerCase();
  if (/(research|조사|시장|환경)/.test(k)) return "🔎";
  if (/(strategy|전략|기획)/.test(k)) return "🧭";
  if (/(risk|검증|비평|critic)/.test(k)) return "🛡️";
  if (/(legal|법무|규정|compliance)/.test(k)) return "⚖️";
  if (/(budget|예산|재무|finance)/.test(k)) return "💰";
  if (/(ops|일정|리소스|운영|schedule)/.test(k)) return "🗓️";
  if (level === "lead") return "🧑‍💼";
  return "🧑‍💻";
}

// A short, readable status the office shows over each character (instead of long
// streamed text — the full content lives in the left "진행 중" timeline).
function statusText(a: AgentNode, running: boolean,
                    opts: { meeting?: boolean; integrating?: boolean } = {}): string {
  if (a.status === "failed") return "⚠ 오류";
  // Promote spawned→thinking only for REAL participants. A roster placeholder (an
  // employee not engaged in this run) must stay 대기 중 — otherwise idle members of
  // a not-yet-started / never-delegated team falsely show "💬 토론 중".
  const st = running && a.status === "spawned" && !a.placeholder ? "thinking" : a.status;
  if (st === "thinking") {
    if (opts.integrating) return "🧩 통합 중";
    if (opts.meeting) return "💬 토론 중";
    return "✍️ 작업 중";
  }
  if (st === "spoke" || st === "converged") return "☕ 휴식 중";
  return ""; // 대기 중 → no status bubble (keeps the idle office uncluttered)
}

interface Placed {
  agent: AgentNode;
  glyph: string;
  ring: string;
  deskX: number;   // % in container
  deskY: number;
  x: number;       // current target (desk or meeting)
  y: number;
  bubble: string;  // text to show in the speech bubble ("" = none)
  thinking: boolean;
  isCritic: boolean;
  badge: string;   // e.g. 📄 when a deliverable/synthesis is ready
  roomLabel: string;
  face: Face;      // which wall the desk backs onto (desk rotation)
}

// Layout the whole company into container-% coordinates.
function layout(
  agents: Record<string, AgentNode>,
  agentOrder: string[],
  teamOrder: string[],
  anyDeliverable: boolean,
  ceoIntegrating: boolean,
  synthesisReady: boolean,
  running: boolean,
  phases: Record<string, string>,
  engagedByTeam: Record<string, string[]>,
): Placed[] {
  const live = agentOrder.map((id) => agents[id]).filter((a): a is AgentNode => !!a);
  const ceo = live.find((a) => a.level === "ceo");
  const leads = live.filter((a) => a.level === "lead");
  const members = live.filter((a) => a.level === "member");
  const placed: Placed[] = [];

  // A member is "engaged" only if in their team's CURRENT delegation wave (reset on each
  // decompose) — NOT merely "ever spawned this run". On a resumed run the latter re-engages
  // every member from earlier (larger) waves and makes the whole office look busy.
  const isEngaged = (m: AgentNode) =>
    (engagedByTeam[m.team ?? ""] ?? []).includes(m.agent_id);

  const effStatus = (a: AgentNode) =>
    running && a.status === "spawned" && !a.placeholder ? "thinking" : a.status;

  // CEO integration: the team leads walk up to the CEO's desk to report (members
  // stay at their own desks). `phases[tid]` drives the per-team choreography below.
  const interTeam = ceoIntegrating;

  // CEO stays at its OWN desk; leads come TO the CEO (briefing / reporting). The CEO
  // only "works" while actually delegating (분해 중) or integrating (통합 중) — the rest
  // of the run it WAITS for the teams, so it must read 대기 중 (no bubble), NOT 작업 중.
  // (The CEO's real status stays "spawned" the whole run since _delegate/_ceo_integrate
  //  don't emit agent_thinking, so we drive its state from the phase + integrate flag,
  //  deliberately ignoring the spawned→thinking promotion that effStatus applies.)
  if (ceo) {
    const ceoPhase = running ? phases["_ceo"] : undefined;
    const ceoWorking = ceoPhase === "delegate" || ceoPhase === "review" || ceoIntegrating;
    const bubble = ceoPhase === "delegate" ? "🧩 지침 수립 중"
      : ceoIntegrating ? "🤝 팀간 회의"          // 회의실에서 팀장들과 통합 회의
      : ceoPhase === "review" ? "🔎 검토·확정 중"  // 자리에서 부서 산출물 검토·최종 확정
      : "";  // 그 외 = 대기 중 → 말풍선 없음
    placed.push({
      agent: ceo, glyph: glyphFor("ceo", ceo.agent_id, ceo.persona?.role),
      ring: ceoWorking ? RING.thinking : RING.spawned,
      deskX: 50, deskY: 13,
      x: ceoIntegrating ? MEETING_SEATS[0].x : CEO_DESK.x,
      y: ceoIntegrating ? MEETING_SEATS[0].y : CEO_DESK.y,
      bubble,
      thinking: ceoWorking,
      isCritic: false, badge: synthesisReady ? "📄" : "", roomLabel: "", face: "up",
    });
  }

  // Team zones along the lower area; each team gets an equal column.
  const N = Math.max(teamOrder.length, 1);
  const zoneTop = 33, zoneH = 50, pad = 2;
  const zoneW = (100 - pad * 2) / N;

  const teamZoneX: Record<string, number> = {};
  teamOrder.forEach((tid, i) => { teamZoneX[tid] = pad + i * zoneW; });

  // Leads: at their team-zone desk by default. Choreography by phase:
  //  brief → CEO desk (지시 받음) · decompose → own desk (분해) · debate → team table
  //  head · report → own desk (검토) · integrate(ceoIntegrating) → CEO desk (보고).
  leads.forEach((lead, j) => {
    const tid = lead.team ?? "";
    const zx = teamZoneX[tid] ?? pad;
    const deskX = zx + zoneW / 2;
    const deskY = zoneTop + 6;
    const cx = zx + zoneW / 2;
    const cy = zoneTop + zoneH * 0.55;
    const ph = running ? phases[tid] : undefined;
    const teamN = members.filter((m) => (m.team ?? "") === tid).length;
    let seat: { x: number; y: number };
    let bubble: string;
    if (interTeam) {
      seat = MEETING_SEATS[j + 1] ?? ceoVisitorSeat(j, leads.length); // 회의실 팀간 회의
      bubble = "🤝 팀간 회의";
    } else if (ph === "brief") {
      seat = { x: 41, y: 18 };                     // CEO실에서 지시 받는 중
      bubble = "📋 지시 받는 중";
    } else if (ph === "report_ceo") {
      seat = { x: 41, y: 20 };                     // CEO실에서 사장에게 산출물 보고
      bubble = "📋 사장 보고";
    } else if (ph === "assign") {
      seat = { x: deskX, y: deskY };               // 자기 자리에서 팀원에게 과제 배정
      bubble = "📌 과제 배정 중";
    } else if (ph === "work") {
      seat = { x: deskX, y: deskY };               // 팀원이 작업하는 동안 팀장은 자리에서 조용히 대기
      bubble = "";                                 // 말풍선 없음(진행 점검 X) — 팀장은 work 구간에 일하지 않는다
    } else if (ph === "debate") {
      seat = meetingCircle(teamN, cx, cy, zoneW, zoneH).head; // 회의 상석(원형 위 — 팀원과 안 겹침)
      bubble = "💬 회의 주재";
    } else if (ph === "decompose") {
      seat = { x: deskX, y: deskY };
      bubble = "🧩 분해 중";
    } else if (ph === "report") {
      seat = { x: deskX, y: deskY };               // 팀원 보고를 받으며 검토·취합
      bubble = "🔍 검토 중";
    } else {
      seat = { x: deskX, y: deskY };
      bubble = statusText(lead, running);
    }
    // working(링 색·펄스) 게이트는 events/working.ts isWorkingNow의 팀장 분기와 1:1.
    // 팀장 분해는 microCall이라 status가 'spawned'에 머무니 effStatus 승격이 아니라
    // raw lead.status==='thinking'(실제 스트리밍, 즉 report 종합 등)만 working으로 본다.
    // → 팀원 'work' 구간(LEAD_WORK_PHASES에서 'work' 제외)에는 팀장이 idle 링으로 대기.
    const working = interTeam || lead.status === "thinking" || LEAD_WORK_PHASES.has(ph ?? "");
    // 대기 링 색은 effStatus 승격값이 아니라 raw lead.status로 — micro로 spawned에
    // 머문 팀장이 work 구간에 파란(thinking) 링으로 잘못 빛나지 않고 idle 색으로 앉아있게.
    const restRing = RING[lead.status] ?? RING.spawned;
    placed.push({
      agent: lead, glyph: glyphFor("lead", lead.agent_id, lead.persona?.role),
      ring: working ? RING.thinking : restRing,
      deskX, deskY,
      x: seat.x,
      y: seat.y,
      bubble,
      thinking: working,
      isCritic: !!lead.persona?.is_critic,
      badge: anyDeliverable ? "📄" : "", roomLabel: "", face: "up",
    });
  });

  // Members: a row near the bottom of their team zone; gather at a meeting circle
  // (zone center) ONLY when 2+ members are working at the same time (a real
  // discussion). A lone worker stays at their own desk and reads "✍️ 작업 중" —
  // otherwise a single working member always tripped "💬 토론 중" (the meeting flag
  // counted the member itself, so the 작업 중 branch was unreachable).
  const byTeam: Record<string, AgentNode[]> = {};
  for (const m of members) (byTeam[m.team ?? ""] ??= []).push(m);

  for (const tid of Object.keys(byTeam)) {
    const list = byTeam[tid];
    const zx = teamZoneX[tid] ?? pad;
    const cx = zx + zoneW / 2;
    const cy = zoneTop + zoneH * 0.55;
    const ph = running ? phases[tid] : undefined;
    const leadDeskX = cx, leadDeskY = zoneTop + 6;
    const n = list.length;
    const seats = seatsFor(n);
    // Only SPAWNED members (the ones the lead summoned this run) gather/debate; size
    // the cluster/ring to that count so the few who were called are spaced right.
    // Non-selected (placeholder) members stay idle → office life (handled by freeIds).
    const engagedCount = list.filter((m) => isEngaged(m)).length;
    const circle = meetingCircle(engagedCount, cx, cy, zoneW, zoneH);
    const gather = clusterBelow(engagedCount, leadDeskX, leadDeskY, zx, zx + zoneW);
    const fallbackMeeting = list.filter((m) => effStatus(m) === "thinking").length >= 2;
    let ei = 0;  // stable index among engaged members → circle/gather slot
    list.forEach((m, i) => {
      // 인원수에 맞춘 좌석(하단 일렬 / 9시·3시 기둥 + 하단 중앙)
      const seat = seats[i] ?? { fx: 0.5, fy: 0.78, face: "down" as Face };
      const deskX = zx + zoneW * seat.fx;
      const deskY = zoneTop + zoneH * seat.fy;
      const engaged = isEngaged(m);          // in this team's CURRENT delegation wave
      // A non-engaged member (idle, or STALE from a resumed run's earlier wave that died
      // mid-"thinking") reads as a plain idle avatar — never a leftover thinking ring/bubble.
      const st = engaged ? effStatus(m) : "spawned";
      const slot = engaged ? ei++ : -1;
      const desk = { x: deskX, y: deskY };

      let pos: { x: number; y: number };
      let bubble: string;
      let thinking: boolean;
      if (engaged && ph === "assign") {              // 팀장에게 와서 과제 지시 받음
        pos = gather[slot] ?? desk; bubble = "📋 지시 받는 중"; thinking = true;
      } else if (engaged && ph === "report") {       // 팀장에게 와서 보고
        pos = gather[slot] ?? desk; bubble = "📋 보고 중"; thinking = true;
      } else if (engaged && ph === "debate") {       // 회의 테이블 둘레
        pos = circle.members[slot] ?? desk; bubble = "💬 토론 중"; thinking = true;
      } else if (engaged && ph === "work") {         // 자기 자리에서 작업 — isWorkingNow와 동일 기준(직렬 1명만 작업중)
        pos = desk;
        if (st === "spoke" || st === "converged") { bubble = "☕ 작업 완료"; thinking = false; }
        else if (st === "thinking") { bubble = "✍️ 작업 중"; thinking = true; }   // 실제 스트리밍 중
        else { bubble = "⏳ 대기"; thinking = false; }                            // 아직 차례 안 옴(직렬 대기/placeholder)
      } else if (engaged && (ph === "brief" || ph === "decompose")) {  // 팀장 지시/분해 중 → 대기
        pos = desk; bubble = ""; thinking = false;
      } else if (engaged && ph) {                    // idle 등 → 자기 자리
        pos = desk; bubble = statusText(m, running); thinking = st === "thinking";
      } else if (!engaged) {                         // 미선발(placeholder) → 자기 자리(free면 ambient가 덮음)
        pos = desk; bubble = ""; thinking = false;
      } else {                                       // 토론모드 / 런 전 fallback
        pos = fallbackMeeting ? (circle.members[slot] ?? desk) : desk;
        bubble = statusText(m, running, { meeting: fallbackMeeting });
        thinking = st === "thinking";
      }
      placed.push({
        agent: m, glyph: glyphFor("member", m.agent_id, m.persona?.role),
        ring: RING[st] ?? RING.spawned,
        deskX, deskY,
        x: pos.x, y: pos.y,
        bubble, thinking,
        isCritic: !!m.persona?.is_critic, badge: "", roomLabel: "", face: seat.face,
      });
    });
  }

  return placed;
}

function Character({ p }: { p: Placed }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1, left: `${p.x}%`, top: `${p.y}%` }}
      transition={{ left: { type: "spring", stiffness: 120, damping: 18 },
                    top: { type: "spring", stiffness: 120, damping: 18 },
                    opacity: { duration: 0.4 }, scale: { duration: 0.4 } }}
      style={{ position: "absolute", transform: "translate(-50%, -50%)",
               display: "flex", flexDirection: "column", alignItems: "center", zIndex: 5 }}
    >
      <AnimatePresence>
        {p.bubble && (
          <motion.div
            key="bubble"
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`office-bubble status-chip${p.thinking ? " active" : " resting"}`}
          >
            {p.bubble}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        animate={p.thinking ? { y: [0, -3, 0] } : { y: 0 }}
        transition={p.thinking ? { repeat: Infinity, duration: 0.4 } : { duration: 0.2 }}
        style={{ position: "relative" }}
      >
        <div className={`office-avatar${p.thinking ? " working" : ""}`}>
          <Avatar id={p.agent.agent_id} glyph={p.glyph} size={40} className="office-portrait" />
          {p.thinking && <span className="office-think">💭</span>}
          {p.badge && <span className="office-badge">{p.badge}</span>}
        </div>
      </motion.div>

      <div className="office-name">
        {/* 아바타는 '사람' → '실명 직책'(장은영 팀장). CEO는 'CEO'로 표시 */}
        {personLabel(p.agent.persona?.name, p.agent.persona?.role) || p.agent.agent_id}
      </div>
    </motion.div>
  );
}

export default function OfficeView() {
  const storeAgents = useStore((s) => s.agents);
  const storeOrder = useStore((s) => s.agentOrder);
  const storeTeamOrder = useStore((s) => s.teamOrder);
  const storeTeams = useStore((s) => s.teams);
  const blocks = useStore((s) => s.blocks);
  const messages = useStore((s) => s.messages);
  const wikiOrder = useStore((s) => s.wikiOrder);
  const wikiPages = useStore((s) => s.wikiPages);
  const lessons = useStore((s) => s.lessons);
  const status = useStore((s) => s.status);
  const synthesis = useStore((s) => s.synthesis);
  const phases = useStore((s) => s.phases);
  const engaged = useStore((s) => s.engaged);
  const pushActivity = useStore((s) => s.pushActivity);

  // The office is furnished AND staffed by DEFAULT from the company roster
  // (/company); live run events then overlay status onto the same employees. So
  // every employee + both team zones are present before any run (idle = 대기 중).
  const [roster, setRoster] = useState<CompanyInfo | null>(null);
  useEffect(() => {
    fetchCompany().then(setRoster);
  }, []);

  // Scale the fixed 16:9 canvas to fit the panel — uniform shrink/grow of EVERY
  // element (rooms, desks, avatars, fonts) so the layout never distorts on resize.
  const rootRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const compute = () => {
      const pad = 36; // .office-root padding (18px × 2)
      const availW = el.clientWidth - pad;
      const availH = el.clientHeight - pad;
      const s = Math.min(availW / BASE_W, availH / BASE_H);
      setScale(s > 0 && Number.isFinite(s) ? s : 1);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { agents, agentOrder, teamOrder, teams } = useMemo(() => {
    const ag: Record<string, AgentNode> = {};
    const order: string[] = [];
    const tOrder: string[] = [];
    const tmap: Record<string, { id: string; name: string }> = {};
    const add = (r: RoleInfo) => {
      order.push(r.id);
      ag[r.id] = storeAgents[r.id] ?? {
        agent_id: r.id,
        persona: { role: r.title, name: r.name, scope: r.title, stance: r.stance, is_critic: r.is_critic },
        model: r.model, status: "spawned", placeholder: true,
        level: r.level as AgentNode["level"], team: r.team,
      };
    };
    if (roster) {
      add(roster.ceo);
      for (const t of roster.teams) {
        tOrder.push(t.id);
        tmap[t.id] = { id: t.id, name: t.name };
        add(t.lead);
        for (const m of t.members) add(m);
      }
    } else {
      for (const id of storeOrder) if (storeAgents[id]) { ag[id] = storeAgents[id]; order.push(id); }
      for (const id of storeTeamOrder) { tOrder.push(id); tmap[id] = storeTeams[id] ?? { id, name: id }; }
    }
    for (const id of storeOrder) if (!ag[id] && storeAgents[id]) { ag[id] = storeAgents[id]; order.push(id); }
    return { agents: ag, agentOrder: order, teamOrder: tOrder, teams: tmap };
  }, [roster, storeAgents, storeOrder, storeTeamOrder, storeTeams]);

  // CEO is "integrating" once it streams the synthesis (block_id "ceo-synth") — drives
  // both the leads-walk-to-CEO beat (layout) and the freeIds guard below, so it lives
  // in its own memo rather than inside placed().
  const ceoIntegrating = useMemo(() => {
    // Integration is an ACTIVE-run state. blocks["ceo-synth"] latches (the synthesis text
    // never clears once written), so without this running guard the CEO + leads would stay
    // frozen in the "🤝 팀간 회의" pose forever AFTER the run finishes. A done run is idle.
    if (status !== "running") return false;
    const ceo = agentOrder.map((id) => agents[id]).find((a) => a?.level === "ceo");
    return !!ceo && (ceo.status === "thinking" || !!blocks["ceo-synth"]);
  }, [agents, agentOrder, blocks, status]);

  const placed = useMemo(() => {
    const running = status === "running";
    // team_deliverable folds to a move:"deliverable" message with no agent_id.
    const anyDeliverable = messages.some((m) => m.move === "deliverable");
    const synthesisReady = !!synthesis.trim();
    return layout(agents, agentOrder, teamOrder, anyDeliverable,
                  ceoIntegrating, synthesisReady, running, phases, engaged);
  }, [agents, agentOrder, teamOrder, blocks, messages, status, synthesis, phases, engaged, ceoIntegrating]);

  // Who is NOT engaged in the live choreography right now → free to live their office
  // life (휴식·잡담·다른 부서 방문). The CEO never wanders (it waits at its desk).
  // Engaged = the active team(s)' lead + members; AND during integration every lead is
  // walking to the CEO (ceoVisitorSeat), so leads must not be free then either. Teams
  // run sequentially, so every other employee is free to socialize while one works.
  const freeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of agentOrder) {
      const a = agents[id];
      if (!a || a.level === "ceo") continue;              // CEO stays at its desk
      if (ceoIntegrating && a.level === "lead") continue;  // 통합 중 팀장은 CEO실로
      const p = a.team && status === "running" ? phases[a.team] : undefined;  // 이 팀의 현재 단계
      if (p && p !== "idle") {
        // 팀이 활성(phase 존재 && idle 아님)인 동안 그 팀의 팀장은 항상 자기 자리 유지 —
        // LEAD_WORK_PHASES에서 'work'를 뺐으므로(팀원 작업 구간엔 팀장이 working이 아님)
        // 여기서 명시적으로 free에서 제외해야 work 구간 팀장이 ambient(산책/잡담)로 안 떠돈다.
        // (working이 아니어도 '대기' 자세로 자리를 지킨다 — 말풍선·펄스는 layout이 끈다.)
        if (a.level === "lead" && !a.placeholder) continue;
        const memberEngaged = a.team ? (engaged[a.team] ?? []).includes(a.agent_id) : false;
        if (a.level === "member" && memberEngaged && MEMBER_WORK_PHASES.has(p)) continue;
      }
      ids.add(id);
    }
    return ids;
  }, [agents, agentOrder, teamOrder, phases, engaged, ceoIntegrating]);

  // Each avatar's home-desk position (+team) — lets ambient "deskside chat" send a
  // visitor to a colleague's actual seat. Recomputed from the same placed layout.
  const deskPos = useMemo(() => {
    const m: Record<string, { x: number; y: number; team: string | null }> = {};
    for (const p of placed) m[p.agent.agent_id] = { x: p.deskX, y: p.deskY, team: p.agent.team ?? null };
    return m;
  }, [placed]);

  // Ambient office life: employees NOT engaged in the live run drift off to a
  // believable office life — chat in the 회의실, rest in the 휴게실, or visit another
  // (idle) team's zone. Engaged employees (the active team) and the CEO never wander.
  // Gentle: ~one avatar moves per tick; spots are mutually non-overlapping so no two
  // socializing avatars ever collide. Runs livelier (idle depts mingle) than pre-run.
  type WSpot = { x: number; y: number; bubble: string; act?: "chat" | "phone" | "rest" | "stroll"; partner?: string; dir?: 1 | -1 };
  const [wander, setWander] = useState<Record<string, WSpot>>({});
  // Latest values for the ambient interval — read via a ref so the interval is created
  // ONCE (deps []) and never torn down by frequent phase/agent updates (which would
  // reset the 3s timer and, at CHOREO_PAUSE_S=0, starve it entirely).
  const liveRef = useRef({ freeIds, phases, teamOrder, status, deskPos });
  liveRef.current = { freeIds, phases, teamOrder, status, deskPos };
  useEffect(() => {
    const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const tick = setInterval(() => {
      const { freeIds, phases, teamOrder, status, deskPos } = liveRef.current;
      const running = status === "running";
      setWander((prev) => {
        // 잡담은 (A) 동료의 '자리'로 찾아가거나 (B) 팀 경계에서 양 팀이 한 명씩 만난다.
        const active = new Set(teamOrder.filter((t) => phases[t] && phases[t] !== "idle"));
        const nTeams = Math.max(teamOrder.length, 1);
        const zw = (100 - 4) / nTeams;               // 팀존 폭(경계 x 계산용)
        const restSpots: Pt[] = [...REST_SPOTS];     // 휴게실 휴식
        const corridor: Pt[] = [...CORRIDOR_SPOTS];  // 중앙 로비(로고) 산책/통화

        // keep only still-free avatars; drop a chatter whose partner is gone (no lone 잡담)
        const next: Record<string, WSpot> = {};
        for (const k of Object.keys(prev)) if (freeIds.has(k)) next[k] = prev[k];
        for (const k of Object.keys(next)) {
          const w = next[k];
          if (w.act === "chat" && (!w.partner || !next[w.partner])) delete next[k];
        }
        const occupied = () => new Set(Object.values(next).map(key));

        // strollers walk the 가로 복도 — 매 틱 dir 방향으로 한 걸음(step) 이동, 좌끝↔우끝
        // 에 닿으면 방향을 반대로(왕복). framer-motion 이 x 변화를 spring 으로 보간 → 걷는 모습.
        for (const k of Object.keys(next)) {
          const w = next[k];
          if (w.act === "stroll") {
            let dir = w.dir ?? 1;
            let x = w.x + dir * STROLL.step;
            if (x >= STROLL.xMax) { x = STROLL.xMax; dir = -1; }
            else if (x <= STROLL.xMin) { x = STROLL.xMin; dir = 1; }
            next[k] = { ...w, x, dir };
          }
        }

        const freeList = [...freeIds];
        const out = Object.keys(next);
        const target = Math.min(12, Math.max(running ? 3 : 1, Math.round(freeList.length * (running ? 0.55 : 0.35))));

        if (out.length < target) {                  // start one more activity
          const atDesk = freeList.filter((k) => !next[k]);
          const used = occupied();
          const r = Math.random();
          if (r < 0.45 && atDesk.length >= 2) {     // 잡담 — 상대가 있는 대화
            let done = false;
            // (A) deskside: 한 명이 다른(한가한) 직원의 '자리'로 찾아가 잡담. 활성 작업존
            //     자리는 피하고(working 멤버와 안 겹치게), 옆자리가 비었을 때만.
            if (Math.random() < 0.5) {
              const hosts = atDesk.filter((k) => deskPos[k] && !(deskPos[k].team && active.has(deskPos[k].team)));
              if (hosts.length >= 2) {
                const host = pick(hosts);
                const hd = deskPos[host];
                const visitor = pick(atDesk.filter((k) => k !== host));
                const side = hd.x > 50 ? -9.6 : 9.6;       // 존 안쪽으로 옆에 선다
                const vs = { x: hd.x + side, y: hd.y };
                const others: Pt[] = [
                  ...Object.values(next),
                  ...atDesk.filter((k) => k !== host && k !== visitor && deskPos[k]).map((k) => deskPos[k]),
                ];
                const clear = vs.x > 4 && vs.x < 96 &&
                  others.every((o) => Math.abs(o.x - vs.x) >= AVATAR_W || Math.abs(o.y - vs.y) >= AVATAR_H);
                if (clear) {
                  next[host] = { x: hd.x, y: hd.y, bubble: "💬 잡담", act: "chat", partner: visitor };
                  next[visitor] = { x: vs.x, y: vs.y, bubble: "💬 잡담", act: "chat", partner: host };
                  done = true;
                }
              }
            }
            // (B) 팀간 경계 잡담: 인접 두 팀에서 한 명씩 뽑아 경계선 양쪽(각자 본인 팀 쪽)에
            //     마주 세운다 — 둘 다 남의 사무실에 있지 않고, 한 명은 본인 팀에서.
            if (!done && teamOrder.length >= 2) {
              const boundary = 2 + zw;                 // 첫 두 팀(전략기획팀|경영지원팀)의 경계 x
              const leftT = teamOrder[0], rightT = teamOrder[1];
              const left = atDesk.find((k) => deskPos[k] && deskPos[k].team === leftT);
              const right = atDesk.find((k) => k !== left && deskPos[k] && deskPos[k].team === rightT);
              if (left && right) {
                const lp = { x: boundary - 5, y: 50 };  // 왼쪽 팀원은 본인(왼쪽) 팀 쪽
                const rp = { x: boundary + 5, y: 50 };  // 오른쪽 팀원은 본인(오른쪽) 팀 쪽
                const others: Pt[] = [
                  ...Object.values(next),
                  ...atDesk.filter((k) => k !== left && k !== right && deskPos[k]).map((k) => deskPos[k]),
                ];
                const ok2 = [lp, rp].every((p) =>
                  others.every((o) => Math.abs(o.x - p.x) >= AVATAR_W || Math.abs(o.y - p.y) >= AVATAR_H));
                if (ok2) {
                  next[left] = { x: lp.x, y: lp.y, bubble: "💬 잡담", act: "chat", partner: right };
                  next[right] = { x: rp.x, y: rp.y, bubble: "💬 잡담", act: "chat", partner: left };
                }
              }
            }
          } else if (atDesk.length) {
            const who = pick(atDesk);
            const openCorridor = corridor.filter((s) => !used.has(key(s)));
            const openRest = restSpots.filter((s) => !used.has(key(s)));
            if (r < 0.55) {                            // 산책 — 가로 복도를 좌↔우 왕복
              const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;   // 좌→우 / 우→좌 시작
              const lane = STROLL.lanes[
                Object.values(next).filter((w) => w.act === "stroll").length % STROLL.lanes.length];
              next[who] = { x: dir > 0 ? STROLL.xMin : STROLL.xMax, y: STROLL.y + lane,
                bubble: "🚶 산책", act: "stroll", dir };
            } else if (r < 0.75 && openRest.length) {  // 휴식 — 휴게실 소파/커피
              const s = pick(openRest); next[who] = { x: s.x, y: s.y, bubble: "☕ 휴식", act: "rest" };
            } else {                                    // 전화통화 — 자기자리/휴게실/복도 (다른 팀 사무실 X)
              const spots: Pt[] = [...openRest, ...openCorridor];
              const d = deskPos[who];
              if (d && !(d.team && active.has(d.team))) spots.push({ x: d.x, y: d.y }); // 자기자리(비활성 존만)
              if (spots.length) {
                const s = pick(spots);
                next[who] = { x: s.x, y: s.y, bubble: "📞 통화 중", act: "phone" };
              }
            }
          }
        } else if (out.length && Math.random() < 0.3) { // end one (pairs leave together)
          const k = pick(out); const w = next[k]; delete next[k];
          if (w.act === "chat" && w.partner) delete next[w.partner];
        }
        return next;
      });
    }, 3000);
    return () => clearInterval(tick);
  }, []);

  // Narrate ambient office-life into the 활동 피드 — but ONLY on the idle→activity
  // transition (the interval re-randomizes every 3s; logging each tick would flood the
  // feed with hundreds of 잡담 rows). We diff the new `wander` against the previous via
  // a ref. Live-only: ambient is random wall-clock animation, never replayed, so we
  // push to store.liveActivity and skip it entirely in replay mode.
  const prevWanderRef = useRef<Record<string, WSpot>>({});
  useEffect(() => {
    if (useStore.getState().mode !== "live") { prevWanderRef.current = wander; return; }
    const AMB: Record<string, { kind: "chat" | "rest" | "stroll" | "phone"; label: string }> = {
      chat: { kind: "chat", label: "잡담" },
      rest: { kind: "rest", label: "휴식" },
      stroll: { kind: "stroll", label: "산책" },
      phone: { kind: "phone", label: "통화" },
    };
    const prev = prevWanderRef.current;
    for (const k of Object.keys(wander)) {
      const w = wander[k];
      if (!w.act) continue;
      // "Started" = a new activity OR (for 잡담) a re-pair to a different partner in the
      // same tick — without the partner check, a canonical-id chatter that swaps partners
      // mid-tick stays act:"chat" so neither side logs (drop-both). Cosmetic but cheap.
      const started =
        !prev[k] || prev[k].act !== w.act ||
        (w.act === "chat" && prev[k].partner !== w.partner);
      if (!started) continue;
      // A 잡담 adds both partners in the same tick — log it once (canonical = smaller id).
      if (w.act === "chat" && w.partner && k > w.partner) continue;
      const meta = AMB[w.act];
      if (!meta) continue;
      const ts = new Date().toISOString();
      pushActivity({
        id: `amb-${ts}-${k}`,
        ts,
        kind: meta.kind,
        label: meta.label,
        actorId: k,
        targetId: w.act === "chat" ? w.partner : undefined,
      });
    }
    prevWanderRef.current = wander;
  }, [wander, pushActivity]);

  const N = Math.max(teamOrder.length, 1);
  const pad = 2;
  const zoneW = (100 - pad * 2) / N;

  return (
    <div className="office-root" ref={rootRef}>
      <div className="office-floor" style={{ transform: `scale(${scale})` }}>
        {/* 회의실 (conference room) — top-left */}
        <div className="office-room meeting-room" style={{ left: "2%", top: "2%", width: "29%", height: "25%" }}>
          <span className="office-room-label">🗣️ 회의실</span>
          <div className="room-rug oval blue" style={{ left: "50%", top: "58%", width: "82%", height: "66%" }} />
          <div className="conf-table">
            <span className="conf-chairs" />
          </div>
        </div>

        {/* CEO room — top-center */}
        <div className="office-room ceo-room" style={{ left: "35.5%", top: "2%", width: "29%", height: "25%" }}>
          <span className="office-room-label">🏢 CEO실</span>
          <div className="room-rug oval" style={{ left: "50%", top: "60%", width: "62%", height: "50%" }} />
          <div className="wall-frame chart" style={{ left: "33%", top: "13%" }}><span className="pic" /></div>
          <div className="wall-frame pic1" style={{ left: "44%", top: "13%" }}><span className="pic" /></div>
        </div>

        {/* 휴게실·탕비실 — top-right. 소파=12시 벽, 책장=3시 벽, 싱크대=9시 벽(아래 floor 배치) */}
        <div className="office-room lounge" style={{ left: "69%", top: "2%", width: "29%", height: "25%" }}>
          <span className="office-room-label">🛋️ 휴게실 · 탕비실</span>
          {/* 소파 2개 — 12시(상단) 벽에 나란히 */}
          <div className="office-sofa" style={{ left: "33%", top: "27%" }} />
          <div className="office-sofa" style={{ left: "69%", top: "27%" }} />
          {/* 커피 테이블 + 러그(소파 앞 가운데) */}
          <div className="room-rug oval green" style={{ left: "47%", top: "66%", width: "46%", height: "30%" }} />
          <span className="lounge-item" style={{ left: "47%", top: "66%" }}>☕</span>
          {/* 화분(하단 코너) */}
          <div className="office-plant" style={{ left: "16%", top: "88%" }} />
        </div>

        {/* team zones */}
        {teamOrder.map((tid, i) => (
          <div
            key={tid}
            className="office-room team-zone"
            style={{ left: `${pad + i * zoneW}%`, top: "32%", width: `${zoneW - 1}%`, height: "52%" }}
          >
            <span className="office-room-label">
              {i === 0 ? "🗂️" : i === 1 ? "💼" : "📦"} {teams[tid]?.name ?? tid}
            </span>
          </div>
        ))}

        {/* 회의 테이블 러그 (테이블 아래) */}
        {teamOrder.map((tid, i) => (
          <div key={`mr-${tid}`} className="room-rug oval green"
               style={{ left: `${pad + i * zoneW + zoneW / 2}%`, top: "60.5%", width: "16%", height: "13%" }} />
        ))}

        {/* meeting tables (one per team — members gather here during debate) */}
        {teamOrder.map((tid, i) => (
          <div
            key={`mt-${tid}`}
            className="office-meeting"
            style={{ left: `${pad + i * zoneW + zoneW / 2}%`, top: "60.5%" }}
          >
            <span className="meeting-chairs" />
            <span className="meeting-label">회의 테이블</span>
          </div>
        ))}

        {/* 회의실/회의 테이블 둘레 의자 (위에서 본, 등받이가 바깥) */}
        {[
          { k: "conf", cx: 16.5, cy: 16, w: 208, h: 120, n: 6 },
          ...teamOrder.map((tid, i) => ({ k: `mt-${tid}`, cx: pad + i * zoneW + zoneW / 2, cy: 60.5, w: 98, h: 70, n: 6 })),
        ].flatMap((t) =>
          Array.from({ length: t.n }, (_, i) => {
            const a = (2 * Math.PI * i) / t.n;
            const left = t.cx + ((t.w / 2 + 16) * Math.cos(a)) / 12.8;
            const top = t.cy + ((t.h / 2 + 14) * Math.sin(a)) / 9.6;
            const deg = (a * 180) / Math.PI + 90;
            return (
              <div key={`${t.k}-ch${i}`} className="table-chair"
                style={{ left: `${left}%`, top: `${top}%`, transform: `translate(-50%,-50%) rotate(${deg}deg)` }} />
            );
          })
        )}

        {/* desks (stay put while characters move to a meeting). Side desks (3시/9시)
            rotate to face the wall; offsets keep desk + avatar inside the team zone. */}
        {placed.map((p) => {
          // 회전 책상은 translate 특성상 양쪽 모두 ~31px 왼쪽으로 밀려 렌더됨.
          //  · 3시(face left, dx 0): 자연히 책상이 아바타 왼쪽(−31px) → 아바타 오른쪽.
          //  · 9시(face right, dx +8.2): +63px 보정 → 책상이 아바타 +31px 오른쪽 → 아바타 왼쪽.
          // 두 net이 ±31로 거울 대칭(좌우 균형). 6시 등은 0.
          const dx = p.face === "right" ? 8.2 : 0;
          // 9시·3시(swap 후 face right/left) 모두 책상 상단을 아바타 상단보다 3px 위로(=-3px) 정렬.
          const dy = (p.face === "right" || p.face === "left") ? 3.18 : 4.5;
          const role = p.agent.level === "ceo" ? "is-ceo" : p.agent.level === "lead" ? "is-lead" : "";
          return (
            <div
              key={`desk-${p.agent.agent_id}`}
              className={`office-desk face-${p.face} ${role}`}
              style={{ left: `${p.deskX + dx}%`, top: `${p.deskY + dy}%` }}
            >
              <span className="desk-monitor" />
              <span className="desk-chair" />
            </div>
          );
        })}

        {/* ── 출입문: 경계선을 벽으로 보고 복도 쪽 벽에 문을 낸다 (방=위로, 팀존=아래로 스윙) ── */}
        <div className="office-door up"   style={{ left: "16.5%", top: "27%" }}><span className="door-arc" /><span className="door-leaf" /></div>
        <div className="office-door up"   style={{ left: "42%",   top: "27%" }}><span className="door-arc" /><span className="door-leaf" /></div>
        <div className="office-door up"   style={{ left: "83.5%", top: "27%" }}><span className="door-arc" /><span className="door-leaf" /></div>
        <div className="office-door down" style={{ left: "25%",   top: "32%" }}><span className="door-arc" /><span className="door-leaf" /></div>
        <div className="office-door down" style={{ left: "73%",   top: "32%" }}><span className="door-arc" /><span className="door-leaf" /></div>

        {/* ── 회의실: 책장(12시 벽 가득) · 화이트보드(9시 벽) · 화분(코너) ── */}
        <div className="bookshelf wall" style={{ left: "16.5%", top: "4.6%" }} />
        <div className="office-board" style={{ left: "3.8%", top: "13.5%", transform: "translate(-50%,-50%) rotate(90deg)" }}><span className="board-scribble" /></div>
        <div className="office-plant" style={{ left: "6%", top: "23%" }} />

        {/* ── CEO실: 책장(12시 벽 가득, 임원 책상 뒤) · 화분(코너) ── */}
        <div className="bookshelf wall" style={{ left: "50%", top: "4.6%" }} />
        <div className="office-plant tall" style={{ left: "62%", top: "21%" }} />

        {/* ── 휴게실: 책장(3시 벽 세로 가득) · 싱크대(9시 벽) ── */}
        <div className="bookshelf wall-v" style={{ left: "96.3%", top: "14.5%" }} />
        <div className="office-sink" style={{ left: "71.4%", top: "13.5%" }} />

        {/* ── 팀 기자재: 각 팀존 '안쪽' 벽면 코너에 배치(책상·아바타와 안 겹치게) ── */}
        {/* 기획팀(좌존) 안: 복합기·서류함은 상단 벽 코너, 정수기는 좌측 벽 */}
        <div className="office-printer" style={{ left: "6%", top: "37%" }}>
          <span className="printer-tray" /><span className="printer-label">복합기</span>
        </div>
        <div className="office-cabinet" style={{ left: "45.5%", top: "37%" }}><span /><span /><span /></div>
        <div className="office-cooler" style={{ left: "5%", top: "56%" }}><span className="cooler-bottle" /><span className="cooler-tap" /></div>
        {/* 경영지원팀(우존) 안: 복합기(상단-좌 코너)·서류함(상단-우 코너)·소화기(좌측 벽) */}
        <div className="office-printer" style={{ left: "53%", top: "36%" }}>
          <span className="printer-tray" /><span className="printer-label">복합기</span>
        </div>
        <div className="office-cabinet" style={{ left: "81%", top: "36%" }}><span /><span /><span /></div>
        {/* 화분 — 방 코너에 더 배치 (빈 곳만) */}
        <div className="office-plant" style={{ left: "29.5%", top: "21%" }} />
        <div className="office-plant tall" style={{ left: "38.5%", top: "20.5%" }} />
        <div className="office-plant" style={{ left: "95.5%", top: "30%" }} />

        {/* company logo — reception sign in the central lobby */}
        <img className="office-logo" src="/gepa_logo.png" alt="GEPA 경상북도경제진흥원"
             style={{ left: "50%", top: "29.3%" }} />

        {/* characters (resting ones wander to 회의실/휴게실/복도) */}
        {placed.map((p) => {
          // honor a wander spot only if the avatar is STILL free this render — re-engaged
          // ones (team handoff / CEO integration) snap to their choreography seat at once.
          const w = freeIds.has(p.agent.agent_id) ? wander[p.agent.agent_id] : undefined;
          return <Character key={p.agent.agent_id}
            p={w ? { ...p, x: w.x, y: w.y, bubble: w.bubble, thinking: false } : p} />;
        })}
        {placed.length === 0 && (
          <div className="office-hint">주제를 입력하면 직원들이 사무실로 출근합니다 🏢</div>
        )}

        {/* 자료실 (wiki) shelf + 교훈 trophies */}
        <div className="office-archive">
          <div className="archive-head">
            <span>📚 자료실 · LLM 위키 ({wikiOrder.length})</span>
            <span className="archive-trophies">
              🏆 교훈 {lessons.length}
              {lessons.length > 0 && (
                <span className="trophy-row">{lessons.slice(-6).map((_, i) => <span key={i}>🏆</span>)}</span>
              )}
            </span>
          </div>
          {/* 색 범례 — 책등 막대는 '진행률'이 아니라 지식 1건(상태=색)임을 분명히 한다. */}
          <div className="archive-legend" title="막대 하나가 위키 지식 페이지 1건입니다 (색 = 상태)">
            <span><i className="lg-dot" style={{ background: "#58a6ff" }} />주장</span>
            <span><i className="lg-dot" style={{ background: "#3fb950" }} />합의</span>
            <span><i className="lg-dot" style={{ background: "#f85149" }} />대립</span>
            <span><i className="lg-dot" style={{ background: "#6e7681" }} />대체</span>
            <span><i className="lg-dot" style={{ background: "#d29922" }} />교훈</span>
            <span className="lg-note">· 막대 1개 = 지식 1건</span>
          </div>
          <div className="archive-shelf">
            <AnimatePresence>
              {wikiOrder.slice(-40).map((pid) => {
                const w = wikiPages[pid];
                if (!w) return null;
                const color =
                  w.status === "contested" ? "#f85149" :
                  w.status === "converged" ? "#3fb950" :
                  w.status === "superseded" ? "#6e7681" :
                  w.category === "lesson" ? "#d29922" : "#58a6ff";
                return (
                  <motion.div
                    key={pid}
                    initial={{ opacity: 0, scaleY: 0.2 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    className="book-spine"
                    style={{ background: color }}
                    title={`${w.title} · ${w.category}/${w.status}`}
                  />
                );
              })}
              {wikiOrder.length === 0 && <span className="muted" style={{ fontSize: 12 }}>아직 자료 없음</span>}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
