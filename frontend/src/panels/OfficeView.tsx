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
import { clusterBelow, meetingCircle, CORRIDOR_SPOTS, STROLL, AVATAR_W, AVATAR_H, Pt,
  LOUNGE_SOFA_SLOTS, PANTRY_SLOTS, CONF_SLOTS, WHITEBOARD_SPOT, shelfSpot } from "./officeChoreography";

// Fixed 4:3 design canvas. Everything inside is laid out against this constant
// size (positions in %, furniture in px), then the whole floor is uniformly
// scaled with transform:scale() to fit the panel — so resizing the window
// shrinks/grows every element together and the office always stays 4:3.
const BASE_W = 1664; // 가로 30% 확대(1280→1664) — 4:3 → ~1.73:1. (.office-floor width / AVATAR_W 와 동기)

// 하단 팀존 기하 — 비서실은 상단(CEO실 옆 별도 방)으로 빠지므로 제외하고, 경영지원팀(support)이
// 늘어난 가로폭을 흡수해 크게(weight). layout()과 JSX 렌더가 같은 값을 쓰도록 공유 헬퍼로 1회 계산.
const SECRETARIAT = "secretariat";
const ZONE_WEIGHT: Record<string, number> = { support: 1.45 };
const ZONE_PAD = 2;
function teamZones(teamOrder: string[]): { ids: string[]; geom: Record<string, { x: number; w: number }> } {
  const ids = teamOrder.filter((t) => t !== SECRETARIAT);
  const total = ids.reduce((s, t) => s + (ZONE_WEIGHT[t] ?? 1), 0) || 1;
  const avail = 100 - ZONE_PAD * 2;
  const geom: Record<string, { x: number; w: number }> = {};
  let x = ZONE_PAD;
  for (const t of ids) { const w = (avail * (ZONE_WEIGHT[t] ?? 1)) / total; geom[t] = { x, w }; x += w; }
  return { ids, geom };
}
// 상단 룸 사각형(office-%) — 회의실 | 비서실 | CEO실 | 휴게실. 집기·문·아바타 위치를 전부 여기서
// 파생한다(매직넘버 금지 → 룸을 옮겨도 집기가 따라옴: advisor 권고의 근본 수정).
const ROOM_TOP = 2, ROOM_H = 25;
const ROOMS = {
  conf:        { x: 2,  w: 29 },
  secretariat: { x: 33, w: 14 }, // 우측 끝 47 = CEO실 좌측과 인접(마주보는 벽 제거 → 개방 연결)
  ceo:         { x: 47, w: 20 },
  lounge:      { x: 69, w: 29 },
} as const;
const roomCx = (r: { x: number; w: number }): number => r.x + r.w / 2;
const roomBottom = ROOM_TOP + ROOM_H; // 27 — 상단 방 하단 벽(=복도 쪽, 문 위치)
const roomStyle = (r: { x: number; w: number }) =>
  ({ left: `${r.x}%`, top: `${ROOM_TOP}%`, width: `${r.w}%`, height: `${ROOM_H}%` });
const SECRETARY_DESK = { x: roomCx(ROOMS.secretariat), y: 13 }; // 비서실 중심(39)
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
    // 경영지원팀(멤버 8명): 6시 4 · 9시 2 · 3시 2 (사용자 요청).
    //  · 멤버 index 순: budget·ops·legal·m(전진영)·m2(하예림)·m5(김홍수)·m3(이윤아)·m4(권이담=7).
    //  · 마지막 좌석을 B(0.80)로 둬 권이담(index 7)이 6시 4번째 자리로 간다(3시→2).
    //  · 3시(R)는 9시(L)와 동일 fy(0.20·0.50)로 좌우 대칭. 3시 아래(fy0.50)와 6시 끝(B0.80)은
    //    세로 13%(≈125px) 떨어져 큰 아바타(104px)도 안 겹친다.
    case 8: return [B(0.20), B(0.40), B(0.60), L(0.20), L(0.50), R(0.20), R(0.50), B(0.80)];
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
const CEO_DESK = { x: roomCx(ROOMS.ceo), y: 13 }; // CEO실 중심(57)
function ceoVisitorSeat(i: number, n: number): { x: number; y: number } {
  const span = Math.min(Math.max(n, 1), 4) * 8;        // total horizontal spread
  const x = n > 1 ? 57 - span / 2 + (span * i) / (n - 1) : 57; // CEO실 중심 57
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
  soloAgentId: string | null,
): Placed[] {
  const live = agentOrder.map((id) => agents[id]).filter((a): a is AgentNode => !!a);
  // 직원 지명(단독) 런 — 이 직원만 자기 자리에서 작업 중(레벨 무관). phase/engaged 이벤트가 없으므로
  // 각 레벨 분기에서 명시적으로 '작업 중' 자세를 준다(synthesis_chunk 는 status 를 spawned 로 두지만
  // effStatus 가 running+non-placeholder 를 thinking 으로 승급하므로 raw status 게이트는 피한다).
  const isSolo = (a: AgentNode): boolean => running && !!soloAgentId && a.agent_id === soloAgentId;
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

  // CEO integration is a CEO-SOLO beat: the CEO synthesizes the teams' already-submitted
  // deliverables alone. The leads have finished reporting (team phase → idle) and are NOT
  // gathered into a meeting — they read 휴식/대기 at their desks, matching the timeline.
  // (사용자 피드백: 통합 중 '팀간 회의' 연출이 타임라인(팀장 대기)과 어긋나 가짜로 보였다 → 제거.)

  // CEO stays at its OWN desk; leads come TO the CEO (briefing / reporting). The CEO
  // only "works" while actually delegating (분해 중) or integrating (통합 중) — the rest
  // of the run it WAITS for the teams, so it must read 대기 중 (no bubble), NOT 작업 중.
  // (The CEO's real status stays "spawned" the whole run since _delegate/_ceo_integrate
  //  don't emit agent_thinking, so we drive its state from the phase + integrate flag,
  //  deliberately ignoring the spawned→thinking promotion that effStatus applies.)
  if (ceo) {
    const ceoPhase = running ? phases["_ceo"] : undefined;
    const ceoSolo = isSolo(ceo);                  // 단축경로(CEO 단독 즉답) — 자리에서 작업, 회의 아님
    const ceoWorking = ceoSolo || ceoPhase === "delegate" || ceoPhase === "review" || ceoIntegrating;
    const bubble = ceoSolo ? "✍️ 작업 중"
      : ceoPhase === "delegate" ? "🧩 지침 수립 중"
      : ceoIntegrating ? "🧩 통합 중"            // 자기 자리에서 단독으로 팀 산출물 통합(팀장은 보고 끝나 대기)
      : ceoPhase === "review" ? "🔎 검토·확정 중"  // 자리에서 부서 산출물 검토·최종 확정
      : "";  // 그 외 = 대기 중 → 말풍선 없음
    placed.push({
      agent: ceo, glyph: glyphFor("ceo", ceo.agent_id, ceo.persona?.role),
      ring: ceoWorking ? RING.thinking : RING.spawned,
      deskX: CEO_DESK.x, deskY: CEO_DESK.y,
      x: CEO_DESK.x,   // 통합도 자기 자리에서 단독 수행 — 회의 테이블로 이동하지 않는다
      y: CEO_DESK.y,
      bubble,
      thinking: ceoWorking,
      isCritic: false, badge: synthesisReady ? "📄" : "", roomLabel: "", face: "up",
    });
  }

  // Team zones along the lower area — 비서실은 상단 별도 방으로 빠지므로 제외, 경영지원팀이 늘어난
  // 가로폭을 흡수해 크게(weight). 공유 헬퍼 teamZones 로 layout()·JSX 가 동일 기하를 쓴다.
  const zoneTop = 33, zoneH = 50, pad = ZONE_PAD;
  const { geom: zoneGeom } = teamZones(teamOrder);

  // Leads: at their team-zone desk by default. Choreography by phase:
  //  decompose → own desk (분해) · assign → own desk (배정) · debate → team table head
  //  (회의 주재) · report → own desk (검토) · integrate(ceoIntegrating) → 회의실 팀간 회의.
  leads.forEach((lead, j) => {
    const tid = lead.team ?? "";
    // 비서: 하단 팀존이 아니라 상단 비서실에 고정 — CEO 처럼 자리를 지킨다. 팀원이 없어 비서(팀장)가
    // 직접 작업하므로, 비서실 phase 가 'work' 인 동안(스트리밍 전 그라운딩 포함) 줄곧 '작업 중'으로 애니메이션.
    if (tid === SECRETARIAT) {
      const secPh = running ? phases[SECRETARIAT] : undefined;
      const atWork = isSolo(lead) || lead.status === "thinking" || secPh === "work";
      const done = lead.status === "spoke" && secPh !== "work";
      placed.push({
        agent: lead, glyph: glyphFor("lead", lead.agent_id, lead.persona?.role),
        ring: atWork ? RING.thinking : (RING[lead.status] ?? RING.spawned),
        deskX: SECRETARY_DESK.x, deskY: SECRETARY_DESK.y,
        x: SECRETARY_DESK.x, y: SECRETARY_DESK.y,
        bubble: atWork ? "✍️ 작업 중" : done ? "☕ 작업 완료" : "",
        thinking: atWork,  // 작업 phase 동안 잔걸음 애니메이션(스트리밍 전 그라운딩 포함)
        isCritic: false, badge: anyDeliverable ? "📄" : "", roomLabel: "", face: "up",
      });
      return;
    }
    const z = zoneGeom[tid];
    const zx = z?.x ?? pad;
    const zw = z?.w ?? 48;
    const deskX = zx + zw / 2;
    const deskY = zoneTop + 6;
    const cx = zx + zw / 2;
    const cy = zoneTop + zoneH * 0.55;
    const ph = running ? phases[tid] : undefined;
    const teamN = members.filter((m) => (m.team ?? "") === tid).length;
    let seat: { x: number; y: number };
    let bubble: string;
    if (ph === "assign") {
      seat = { x: deskX, y: deskY };               // 자기 자리에서 팀원에게 과제 배정
      bubble = "📌 과제 배정 중";
    } else if (ph === "work") {
      seat = { x: deskX, y: deskY };               // 팀원이 작업하는 동안 팀장은 자리에서 조용히 대기
      bubble = "";                                 // 말풍선 없음(진행 점검 X) — 팀장은 work 구간에 일하지 않는다
    } else if (ph === "debate") {
      seat = meetingCircle(teamN, cx, cy, zw, zoneH).head; // 회의 상석(원형 위 — 팀원과 안 겹침)
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
    // 단독 런의 지명 팀장 — 자기 자리에서 '작업 중'(phase/스트리밍 신호 없이도).
    if (isSolo(lead)) { seat = { x: deskX, y: deskY }; bubble = "✍️ 작업 중"; }
    // working(링 색·펄스) 게이트는 events/working.ts isWorkingNow의 팀장 분기와 1:1.
    // 팀장 분해는 microCall이라 status가 'spawned'에 머무니 effStatus 승격이 아니라
    // raw lead.status==='thinking'(실제 스트리밍, 즉 report 종합 등)만 working으로 본다.
    // → 팀원 'work' 구간(LEAD_WORK_PHASES에서 'work' 제외)에는 팀장이 idle 링으로 대기.
    const working = isSolo(lead) || lead.status === "thinking" || LEAD_WORK_PHASES.has(ph ?? "");
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
    if (tid === SECRETARIAT) continue; // 비서실은 하단 팀존 없음(상단 배치)
    const list = byTeam[tid];
    const z = zoneGeom[tid];
    const zx = z?.x ?? pad;
    const zw = z?.w ?? 48;
    const cx = zx + zw / 2;
    const cy = zoneTop + zoneH * 0.55;
    const ph = running ? phases[tid] : undefined;
    const leadDeskX = cx, leadDeskY = zoneTop + 6;
    const n = list.length;
    const seats = seatsFor(n);
    // Only SPAWNED members (the ones the lead summoned this run) gather/debate; size
    // the cluster/ring to that count so the few who were called are spaced right.
    // Non-selected (placeholder) members stay idle → office life (handled by freeIds).
    const engagedCount = list.filter((m) => isEngaged(m)).length;
    const circle = meetingCircle(engagedCount, cx, cy, zw, zoneH);
    const gather = clusterBelow(engagedCount, leadDeskX, leadDeskY, zx, zx + zw);
    const fallbackMeeting = list.filter((m) => effStatus(m) === "thinking").length >= 2;
    let ei = 0;  // stable index among engaged members → circle/gather slot
    list.forEach((m, i) => {
      // 인원수에 맞춘 좌석(하단 일렬 / 9시·3시 기둥 + 하단 중앙)
      const seat = seats[i] ?? { fx: 0.5, fy: 0.78, face: "down" as Face };
      const deskX = zx + zw * seat.fx;
      const deskY = zoneTop + zoneH * seat.fy;
      const engaged = isEngaged(m);          // in this team's CURRENT delegation wave
      // A non-engaged member (idle, or STALE from a resumed run's earlier wave that died
      // mid-"thinking") reads as a plain idle avatar — never a leftover thinking ring/bubble.
      // 단독 런의 지명 팀원은 engaged 이벤트가 없어도 작업 중 — effStatus 승급으로 thinking 링.
      const st = (isSolo(m) || engaged) ? effStatus(m) : "spawned";
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
      } else if (engaged && ph === "decompose") {  // 팀장 분해 중 → 자기 자리에서 대기
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
      // 단독 런의 지명 팀원 — 위 분기(engaged/phase 기반)에 안 걸리므로 자기 자리 '작업 중'으로 덮는다.
      if (isSolo(m)) { pos = desk; bubble = "✍️ 작업 중"; thinking = true; }
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
  // 이동 감지 — 목표 위치(p.x/p.y)가 바뀌면 활주(glide)하는 동안 '걷기/뛰기' 걸음걸이를 켠다.
  const [walking, setWalking] = useState(false);
  const prev = useRef({ x: p.x, y: p.y });
  useEffect(() => {
    const dist = Math.hypot(p.x - prev.current.x, p.y - prev.current.y);
    prev.current = { x: p.x, y: p.y };
    if (dist > 1.2) { // 의미있는 이동만(미세 흔들림 제외)
      setWalking(true);
      const t = setTimeout(() => setWalking(false), Math.min(1500, 380 + dist * 48));
      return () => clearTimeout(t);
    }
  }, [p.x, p.y]);
  // 걸음걸이: '이동 중'에만 상하 bound + 좌우 흔들(뛰는 발걸음). 제자리(작업/대기)는 정지 —
  // 작업 중은 💭·작업aura·링·말풍선으로 표시하고 몸을 계속 흔들지 않는다. (effStatus 가 spawned 를
  //  thinking 으로 승급해 '아무 일도 안 하는' 유휴 아바타까지 제자리 흔들리던 문제 제거 — 사용자 요청.)
  const gait = walking
    ? { y: [0, -7, 0, -7, 0], rotate: [-5, 5, -5, 5, 0] }
    : { y: 0, rotate: 0 };
  const gaitT = walking
    ? { repeat: Infinity, duration: 0.34, ease: "easeInOut" as const }
    : { duration: 0.2 };
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
        animate={gait}
        transition={gaitT}
        style={{ position: "relative" }}
      >
        <div className={`office-avatar${p.thinking ? " working" : ""}${walking ? " walking" : ""}`}>
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
  const soloAgentId = useStore((s) => s.soloAgentId);
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
    // 모바일/태블릿(≤900px)에선 .office-root padding 이 8px(모바일 CSS)이라 pad 가 작다.
    const MOBILE_MQ = "(max-width: 900px)";
    const LEGIBLE = 0.42; // 폭맞춤 scale 이 이보다 작으면(아바타 < ~44px) 글자가 안 읽힌다.
    const compute = () => {
      const mobile = window.matchMedia(MOBILE_MQ).matches;
      const pad = mobile ? 16 : 36; // .office-root padding ×2 (모바일 8px·2, 데스크톱 18px·2)
      const availW = el.clientWidth - pad;
      const availH = el.clientHeight - pad;
      const fitW = availW / BASE_W, fitH = availH / BASE_H;
      // 모바일에서 폭맞춤이 너무 작아 글자가 안 읽히면(폰: fitW≈0.22) '높이맞춤'으로 키워 가독 확보 →
      // 가로가 뷰포트보다 넓어지면 좌우 패닝(.office-root overflow-x:auto + 음수마진 footprint 보정).
      // 폭맞춤이 충분하면(태블릿: fitW≈0.46) 그대로 전체 오피스 표시(패닝 불필요). 데스크톱은 기존 min().
      const s = mobile && fitW < LEGIBLE && fitH > fitW ? fitH : Math.min(fitW, fitH);
      setScale(s > 0 && Number.isFinite(s) ? s : 1);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    // 회전·뷰포트 경계 변화 시 ResizeObserver 가 안정적으로 재발화하지 않을 수 있어 matchMedia 로 보강.
    const mq = window.matchMedia(MOBILE_MQ);
    mq.addEventListener("change", compute);
    return () => { ro.disconnect(); mq.removeEventListener("change", compute); };
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

  // CEO is "integrating" once it streams the synthesis (block_id "ceo-synth") — drives the
  // CEO's own "🧩 통합 중" pose (layout) and the freeIds guard below, so it lives in its own
  // memo rather than inside placed(). (통합은 CEO 단독 작업 — 팀장은 모이지 않는다.)
  const ceoIntegrating = useMemo(() => {
    // Integration is an ACTIVE-run state. blocks["ceo-synth"] latches (the synthesis text
    // never clears once written), so without this running guard the CEO would stay frozen
    // in the "🧩 통합 중" pose forever AFTER the run finishes. A done run is idle.
    if (status !== "running") return false;
    // 직원 지명(단독) 런은 응답을 ceo-synth 블록으로 흘리지만 통합이 아니다 — 솔로면 팀간회의 억제.
    if (soloAgentId) return false;
    const ceo = agentOrder.map((id) => agents[id]).find((a) => a?.level === "ceo");
    // 'integrate' phase 도 통합으로 인정 — 합성 시작 직후 목차 microJSON 구간(ceo-synth 블록 생성 전)에
    // 타임라인은 '통합 중'인데 CEO 말풍선이 비어 보이는 '깜빡임'을 막는다(팀장은 더 이상 모으지 않음).
    return !!ceo && (ceo.status === "thinking" || !!blocks["ceo-synth"] || phases["_ceo"] === "integrate");
  }, [agents, agentOrder, blocks, status, phases, soloAgentId]);

  const placed = useMemo(() => {
    const running = status === "running";
    // team_deliverable folds to a move:"deliverable" message with no agent_id.
    const anyDeliverable = messages.some((m) => m.move === "deliverable");
    const synthesisReady = !!synthesis.trim();
    return layout(agents, agentOrder, teamOrder, anyDeliverable,
                  ceoIntegrating, synthesisReady, running, phases, engaged, soloAgentId);
  }, [agents, agentOrder, teamOrder, blocks, messages, status, synthesis, phases, engaged, ceoIntegrating, soloAgentId]);

  // Who is NOT engaged in the live choreography right now → free to live their office
  // life (휴식·잡담·다른 부서 방문). The CEO never wanders (it waits at its desk).
  // Engaged = the active team(s)' lead + members; AND during CEO integration the leads
  // stay put at their desks (보고 직후 대기), so they must not wander off either. Teams
  // run sequentially, so every other employee is free to socialize while one works.
  const freeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of agentOrder) {
      const a = agents[id];
      if (!a || a.level === "ceo") continue;              // CEO stays at its desk
      if (soloAgentId && a.agent_id === soloAgentId) continue; // 단독 런의 지명 직원은 자기 자리에서 작업(산책 X)
      if (a.team === SECRETARIAT) continue;               // 비서는 비서실 자리를 지킴(산책/잡담 X)
      if (ceoIntegrating && a.level === "lead") continue;  // 통합 중 팀장은 자기 자리에서 대기(산책 X)
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
  }, [agents, agentOrder, teamOrder, phases, engaged, ceoIntegrating, soloAgentId]);

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
  type WSpot = { x: number; y: number; bubble: string; act?: "chat" | "phone" | "rest" | "stroll" | "huddle" | "coffee" | "shelf" | "board"; partner?: string; dir?: 1 | -1 };
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
        // 실제(가중) 팀존 기하 — 균등분할이 아니라 teamZones 의 가중 폭·비서실 제외를 그대로 써야
        // 경계 잡담 두 사람이 레이아웃과 동일한 '진짜' 팀 경계에 마주 선다(layout 과 1:1).
        const { geom: wgeom } = teamZones(teamOrder);
        const corridor: Pt[] = [...CORRIDOR_SPOTS];  // 복도 산책/통화(비겹침 유지)

        // keep only still-free avatars; drop a chatter whose partner is gone (no lone 잡담)
        const next: Record<string, WSpot> = {};
        for (const k of Object.keys(prev)) if (freeIds.has(k)) next[k] = prev[k];
        for (const k of Object.keys(next)) {
          const w = next[k];
          if ((w.act === "chat" || w.act === "huddle") && (!w.partner || !next[w.partner])) delete next[k];
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
          const openCorridor = corridor.filter((s) => !used.has(key(s)));
          const free = (slots: Pt[]) => slots.filter((s) => !used.has(key(s)));
          const openSofa = free(LOUNGE_SOFA_SLOTS), openPantry = free(PANTRY_SLOTS), openConf = free(CONF_SLOTS);
          const r = Math.random();
          if (r < 0.20 && atDesk.length >= 2 && openPantry.length >= 2) {  // 잡담 — 탕비존 빈 2석(비겹침)
            const a = pick(atDesk);
            const b = pick(atDesk.filter((k) => k !== a));
            next[a] = { x: openPantry[0].x, y: openPantry[0].y, bubble: "💬 잡담", act: "chat", partner: b };
            next[b] = { x: openPantry[1].x, y: openPantry[1].y, bubble: "💬 잡담", act: "chat", partner: a };
          } else if (r < 0.35 && atDesk.length >= 2 && openConf.length >= 2) { // 업무협의 — 회의실 빈 슬롯(비겹침, 최대 3)
            const n = Math.min(atDesk.length, openConf.length);
            const pool = [...atDesk];
            const people: string[] = [];
            for (let i = 0; i < n && pool.length; i++) {
              people.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
            }
            people.forEach((p, i) => {
              next[p] = { x: openConf[i].x, y: openConf[i].y, bubble: "🤝 업무협의", act: "huddle",
                partner: people.find((q) => q !== p) };
            });
          } else if (r < 0.50 && atDesk.length && openSofa.length) {  // 휴식 — 소파존 빈 슬롯(비겹침)
            const who = pick(atDesk); const s = openSofa[0];
            next[who] = { x: s.x, y: s.y, bubble: "☕ 휴식", act: "rest" };
          } else if (r < 0.65 && atDesk.length) {                  // 산책 — 복도 왕복
            const who = pick(atDesk);
            const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
            const lane = STROLL.lanes[
              Object.values(next).filter((w) => w.act === "stroll").length % STROLL.lanes.length];
            next[who] = { x: dir > 0 ? STROLL.xMin : STROLL.xMax, y: STROLL.y + lane,
              bubble: "🚶 산책", act: "stroll", dir };
          } else if (r < 0.75 && atDesk.length && openCorridor.length) { // 통화 — 복도(비겹침)
            const who = pick(atDesk); const s = pick(openCorridor);
            next[who] = { x: s.x, y: s.y, bubble: "📞 통화 중", act: "phone" };
          } else if (r < 0.85 && atDesk.length && openPantry.length) {   // 커피·간식 — 탕비존 빈 슬롯(비겹침)
            const who = pick(atDesk); const s = openPantry[0];
            next[who] = { x: s.x, y: s.y, bubble: "🍵 커피·간식", act: "coffee" };
          } else if (r < 0.95 && atDesk.length) {                  // 자료 찾기 — 팀존 책장(팀 idle, 비겹침)
            const cand = atDesk.filter((k) => {
              const t = deskPos[k]?.team; return !!t && !active.has(t) && !!wgeom[t];
            });
            if (cand.length) {
              const who = pick(cand);
              const s = shelfSpot(wgeom[deskPos[who]!.team!]);
              if (!used.has(key(s))) next[who] = { x: s.x, y: s.y, bubble: "📚 자료 찾기", act: "shelf" };
            }
          } else if (atDesk.length && !used.has(key(WHITEBOARD_SPOT))) {  // 화이트보드 — 회의실 보드 앞(비겹침)
            const who = pick(atDesk);
            next[who] = { x: WHITEBOARD_SPOT.x, y: WHITEBOARD_SPOT.y, bubble: "✍️ 화이트보드", act: "board" };
          }
        } else if (out.length && Math.random() < 0.3) { // end one (groups leave together)
          const k = pick(out); const w = next[k]; delete next[k];
          if ((w.act === "chat" || w.act === "huddle") && w.partner) delete next[w.partner];
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
      huddle: { kind: "chat", label: "업무협의" },
      coffee: { kind: "rest", label: "커피·간식" },
      shelf: { kind: "stroll", label: "자료 찾기" },
      board: { kind: "chat", label: "화이트보드" },
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

  const { ids: zoneIds, geom: zoneGeom } = teamZones(teamOrder); // 비서실 제외 + 경영지원 가중(layout 과 동일)

  return (
    <div className="office-root" ref={rootRef}>
      {/* --office-scale: 모바일 @media 가 말풍선·이름표를 역보정(scale 의 역수)해 ≥10px 가독 확보.
          데스크톱은 이 변수를 읽는 규칙이 없어 inert(>900px 무변경). */}
      <div className="office-floor"
        style={{ transform: `scale(${scale})`, ["--office-scale" as string]: scale }}>
        {/* 회의실 (conference room) — top-left. 업무협의(허들)·화이트보드 메모 */}
        <div className="office-room meeting-room" style={roomStyle(ROOMS.conf)}>
          <span className="office-room-label">🗣️ 회의실 · 업무협의</span>
          <div className="room-rug oval blue" style={{ left: "50%", top: "58%", width: "82%", height: "66%" }} />
          <div className="whiteboard" style={{ left: "14%", top: "20%" }} />
          <div className="conf-table">
            <span className="conf-chairs" />
          </div>
        </div>

        {/* 비서실 — CEO실 좌측(상단 별도 방). 비서가 상주(하단 팀존 아님) */}
        {/* 비서실 — CEO실과 마주보는 우측 벽 제거(개방 연결, 사용자 요청) */}
        <div className="office-room secretariat-room wall-open-right" style={roomStyle(ROOMS.secretariat)}>
          <span className="office-room-label">🧑‍💼 비서실</span>
        </div>

        {/* CEO room — 비서실과 마주보는 좌측 벽 제거(개방 연결) */}
        <div className="office-room ceo-room wall-open-left" style={roomStyle(ROOMS.ceo)}>
          <span className="office-room-label">🏢 CEO실</span>
          <div className="room-rug oval" style={{ left: "50%", top: "60%", width: "62%", height: "50%" }} />
          <div className="wall-frame chart" style={{ left: "33%", top: "13%" }}><span className="pic" /></div>
          <div className="wall-frame pic1" style={{ left: "44%", top: "13%" }}><span className="pic" /></div>
        </div>

        {/* 휴게실·탕비실 — top-right. 좌=소파존(휴식), 우=탕비존(커피·간식·잡담) */}
        <div className="office-room lounge" style={roomStyle(ROOMS.lounge)}>
          <span className="office-room-label">🛋️ 휴게실 · 탕비실</span>
          {/* 소파존(좌측 절반) — 소파 2개 + 러그 */}
          <div className="office-sofa" style={{ left: "14%", top: "30%" }} />
          <div className="office-sofa" style={{ left: "38%", top: "30%" }} />
          <div className="room-rug oval green" style={{ left: "26%", top: "70%", width: "42%", height: "26%" }} />
          {/* 탕비존(우측 절반) — 커피·간식 카운터 */}
          <div className="pantry-counter" style={{ left: "74%", top: "20%" }} />
          <span className="lounge-item" style={{ left: "74%", top: "20%" }}>☕</span>
          <span className="lounge-item" style={{ left: "88%", top: "20%" }}>🍪</span>
          {/* 화분(하단 코너) */}
          <div className="office-plant" style={{ left: "16%", top: "90%" }} />
        </div>

        {/* team zones (비서실 제외 · 경영지원 가중 폭) */}
        {zoneIds.map((tid, i) => (
          <div
            key={tid}
            className="office-room team-zone"
            style={{ left: `${zoneGeom[tid].x}%`, top: "32%", width: `${zoneGeom[tid].w - 1}%`, height: "52%" }}
          >
            <span className="office-room-label">
              {i === 0 ? "📊" : "💼"} {teams[tid]?.name ?? tid}
            </span>
          </div>
        ))}

        {/* 회의 테이블 러그 (테이블 아래) */}
        {zoneIds.map((tid) => (
          <div key={`mr-${tid}`} className="room-rug oval green"
               style={{ left: `${zoneGeom[tid].x + zoneGeom[tid].w / 2}%`, top: "60.5%", width: "16%", height: "13%" }} />
        ))}

        {/* meeting tables (one per team — members gather here during debate) */}
        {zoneIds.map((tid) => (
          <div
            key={`mt-${tid}`}
            className="office-meeting"
            style={{ left: `${zoneGeom[tid].x + zoneGeom[tid].w / 2}%`, top: "60.5%" }}
          >
            <span className="meeting-chairs" />
            <span className="meeting-label">회의 테이블</span>
          </div>
        ))}

        {/* 회의실/회의 테이블 둘레 의자 (위에서 본, 등받이가 바깥) */}
        {[
          { k: "conf", cx: 16.5, cy: 16, w: 208, h: 120, n: 6 },
          ...zoneIds.map((tid) => ({ k: `mt-${tid}`, cx: zoneGeom[tid].x + zoneGeom[tid].w / 2, cy: 60.5, w: 98, h: 70, n: 6 })),
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
          // 비서(secretariat lead)는 팀장급이 아니라 직원 책상 크기로 — is-lead 제외(사용자 요청).
          const role = p.agent.level === "ceo" ? "is-ceo"
            : (p.agent.level === "lead" && p.agent.team !== SECRETARIAT) ? "is-lead" : "";
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

        {/* ── 출입문: 각 방 하단 벽(복도 쪽)에 문(위 스윙) · 각 팀존 상단 벽에 문(아래 스윙) — 기하 파생 ── */}
        {([ROOMS.conf, ROOMS.secretariat, ROOMS.ceo, ROOMS.lounge]).map((r, i) => (
          <div key={`rdoor-${i}`} className="office-door up" style={{ left: `${roomCx(r)}%`, top: `${roomBottom}%` }}>
            <span className="door-arc" /><span className="door-leaf" />
          </div>
        ))}
        {zoneIds.map((tid) => (
          <div key={`zdoor-${tid}`} className="office-door down"
               style={{ left: `${zoneGeom[tid].x + zoneGeom[tid].w / 2}%`, top: "32%" }}>
            <span className="door-arc" /><span className="door-leaf" />
          </div>
        ))}

        {/* ── 회의실: 책장(상단 벽, 폭을 방에 맞춤 26%) · 화이트보드(좌측 벽) · 화분(양 코너) ── */}
        <div className="bookshelf wall" style={{ left: `${roomCx(ROOMS.conf)}%`, top: "4.6%", width: "26%" }} />
        <div className="office-board" style={{ left: `${ROOMS.conf.x + 1.8}%`, top: "13.5%", transform: "translate(-50%,-50%) rotate(90deg)" }}><span className="board-scribble" /></div>
        <div className="office-plant" style={{ left: `${ROOMS.conf.x + 3.2}%`, top: "23.5%" }} />
        <div className="office-plant" style={{ left: `${ROOMS.conf.x + ROOMS.conf.w - 2.8}%`, top: "23.5%" }} />

        {/* ── 비서실(좁은 공간): 화분(하단-좌 코너)만 — 우측은 CEO실과 개방 연결, 책상이 중앙 ── */}
        <div className="office-plant" style={{ left: `${ROOMS.secretariat.x + 2.6}%`, top: "23.5%" }} />

        {/* ── CEO실: 책장(상단 벽, 임원 책상 뒤; 폭을 방에 맞춤 17%) · 화분(코너) ── */}
        <div className="bookshelf wall" style={{ left: `${roomCx(ROOMS.ceo)}%`, top: "4.6%", width: "17%" }} />
        <div className="office-plant tall" style={{ left: `${ROOMS.ceo.x + ROOMS.ceo.w - 2.8}%`, top: "21%" }} />

        {/* ── 휴게실: 주방 카운터(상단 벽) · 싱크(좌측 벽) · 책장(우측 벽 세로) · 정수기 · 화분 ── */}
        <div className="kitchen-counter" style={{ left: `${roomCx(ROOMS.lounge)}%`, top: "5.4%" }} />
        <div className="office-sink" style={{ left: `${ROOMS.lounge.x + 2.6}%`, top: "13.5%" }} />
        <div className="bookshelf wall-v" style={{ left: `${ROOMS.lounge.x + ROOMS.lounge.w - 1.7}%`, top: "14.5%", width: "11%" }} />
        <div className="office-cooler" style={{ left: `${ROOMS.lounge.x + 2.2}%`, top: "22.5%" }}><span className="cooler-bottle" /><span className="cooler-tap" /></div>

        {/* ── 팀존 기자재: 각 존 상단 코너(복합기·서류함) — zoneGeom 파생(존 따라감, 책상·아바타 회피) ── */}
        {zoneIds.map((tid) => {
          const g = zoneGeom[tid];
          return (
            <div key={`eq-${tid}`}>
              <div className="office-printer" style={{ left: `${g.x + 4}%`, top: "37.5%" }}><span className="printer-tray" /><span className="printer-label">복합기</span></div>
              <div className="office-cabinet" style={{ left: `${g.x + g.w - 3}%`, top: "37%" }}><span /><span /><span /></div>
            </div>
          );
        })}

        {/* company logo — 로비 리셉션 사인(복도는 얇아 화분 대신 로고만으로 깔끔하게) */}
        <img className="office-logo" src="/gepa_logo.png" alt="GEPA 경상북도경제진흥원" style={{ left: "50%", top: "29.3%" }} />

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
