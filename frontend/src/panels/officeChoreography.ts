// Pure geometry for the 2D office (OfficeView). NO React imports, so the overlap
// invariants are unit-testable in isolation (scripts/verify_office_overlap.mjs).
//
// All coordinates are percentages of the fixed BASE 1280×960 office canvas. An
// avatar (.office-avatar) renders at 104×104px → the box constants below. Two
// avatars "overlap" when their centers are closer than AVATAR_W horizontally AND
// AVATAR_H vertically; every helper here keeps avatars outside that box.

export interface Pt { x: number; y: number }

export const AVATAR_W = (104 / 1664) * 100; // ≈ 6.25 (% of canvas width; 캔버스 가로 30% 확대 1280→1664)
export const AVATAR_H = (104 / 960) * 100;  // ≈ 10.83 (% of canvas height)
const HGAP = AVATAR_W + 1.4;                // ≈ 9.5  — min horizontal center spacing
const VGAP = AVATAR_H + 1.3;                // ≈ 12.1 — min vertical center spacing

// Members gather in centered rows BELOW an anchor (the lead's desk) — to receive
// the lead's assignment ("assign") or to report back ("report"). Rows wrap at 4 so
// even the 8-person 경영지원팀 never overlaps; the block is clamped inside the team
// zone and the first row sits a full avatar-height below the anchor (clears the lead).
export function clusterBelow(n: number, anchorX: number, anchorY: number,
                             zoneLeft: number, zoneRight: number): Pt[] {
  if (n <= 0) return [];
  const perRow = Math.min(n, 4);
  const margin = AVATAR_W / 2 + 1;
  const firstY = anchorY + 11;            // > AVATAR_H below the lead → no overlap
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const cnt = Math.min(perRow, n - row * perRow);
    const width = (cnt - 1) * HGAP;
    const startX = Math.max(zoneLeft + margin,
      Math.min(anchorX - width / 2, zoneRight - margin - width));
    out.push({ x: startX + col * HGAP, y: firstY + row * VGAP });
  }
  return out;
}

// Debate: members sit around the team table on an arc that leaves a 60° gap at the
// TOP, where the lead presides from a head seat just above the arc — so the lead
// never lands on top of a member (a full circle would put member 0 at 12 o'clock,
// exactly under the lead). Returns the member points + the lead's head point.
export function meetingCircle(n: number, cx: number, cy: number,
                              _zoneW = 0, _zoneH = 0): { members: Pt[]; head: Pt } {
  // Tight ring that HUGS the small meeting table (overlapping the table is fine) so
  // the summoned members visibly gather there. Absolute % (the table is a fixed
  // size), not zone-scaled. The 60° top gap leaves the head seat for the lead.
  const rX = 9.5 + Math.min(n, 8) * 0.8;   // n=3 → 11.9, n=8 → 15.9
  const rY = 6.5 + Math.min(n, 8) * 0.5;   // flatter — the table is wider than tall
  const members: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const deg = n === 1 ? 90 : -60 + (300 * i) / (n - 1); // -60°→240°, top (-90°) stays clear
    const a = (deg * Math.PI) / 180;
    members.push({ x: cx + rX * Math.cos(a), y: cy + rY * Math.sin(a) });
  }
  return { members, head: { x: cx, y: cy - rY - 10 } };
}

// Ambient "office life" anchors (absolute office-%). Placed on SIT-ABLE furniture
// (회의 테이블 · 소파 · 커피 테이블) or open 복도 — never on a wall unit (책장/화이트보드/
// 화분/복합기). Mutually ≥ one avatar apart (chat partners ~9% — close enough to read
// as a conversation, still non-overlapping), so any subset is collision-free.
//   잡담(chat)=PAIR(각 팀존 안) · 휴식(rest)=휴게실 소파/커피 · 산책/통화=복도.
// 잡담은 OfficeView에서 IDLE 팀존마다 페어로 생성된다 → 전략기획팀/경영지원팀 '안'에서
// 일어난다. 회의실(top-left)은 casual 잡담에 쓰지 않고 '팀간 회의' 전용으로 비워 둔다.
export const CHAT_PAIRS: [Pt, Pt][] = []; // no static room chat — 잡담 lives inside the team zones
export const REST_SPOTS: Pt[] = [{ x: 80, y: 10 }, { x: 85, y: 21 }];    // 휴게실 안: 소파 + 커피테이블(싱크/책장 피함)
// 통화/대기 복도 — CEO실 정면(중앙 상단)을 피해 좌·우 끝 복도(상단 방들과 팀존 사이 y≈29)
export const CORRIDOR_SPOTS: Pt[] = [{ x: 14, y: 29 }, { x: 86, y: 29 }];
// 산책 경로 — 가로로 좌끝↔우끝 왕복(걷는 모습). 산책 아바타는 말풍선(🚶 산책)이 인플로우라
// 발(office-avatar 박스 하단)이 top% 보다 +10.8%(실측: top25%→발35.8%, top28%→발38.8%) 아래
// 놓인다 → y=19 면 발이 ≈29.8%, 즉 상단 방(하단 27%)·팀존(상단 32%) 사이 복도 띠 한가운데.
// lane 분산은 둘째 산책도 띠 안에 남도록 [0,2](y21 → 발 31.8%).
export const STROLL = { y: 19, xMin: 9, xMax: 91, step: 16, lanes: [0, 2] };

// 회의실(top-left) 팀간(cross-team) 회의 — CEO 통합 시 원장+팀장들이 회의 테이블을 빙 둘러앉아
// '모여서 회의'하는 모습. 테이블 중심(16.5,16) 둘레 타원: CEO=상석(12시), 팀장=하단 호(좌→우)로
// 균등 배치해 모두 테이블을 향한다. 팀장 수에 맞춰 동적으로 자리 생성(고정 3좌석 한계 제거).
const CONF_MEET = { cx: 16.5, cy: 16, rx: 9.5, ry: 7.5 };
export function confMeetingSeats(nLeads: number): { ceo: Pt; leads: Pt[] } {
  const { cx, cy, rx, ry } = CONF_MEET;
  const ceo: Pt = { x: cx, y: cy - ry };          // 상석(12시, 테이블 위쪽)
  const leads: Pt[] = [];
  for (let i = 0; i < nLeads; i++) {
    const deg = nLeads === 1 ? 90 : 150 - (120 * i) / (nLeads - 1); // 좌하(150°)→하(90°)→우하(30°)
    const a = (deg * Math.PI) / 180;
    leads.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return { ceo, leads };
}

// 방 안 비겹침 슬롯(절대 office-%) — 한 방에 여러 명이 모여도 서로 겹치지 않게 고정 간격으로 배치한다
// (사용자 요청: 일렬이어도 좋으니 겹치지 마라). 아바타는 framer-motion 이 style 의 translate(-50%,-50%)
// 를 덮어써 (x,y)가 '중심'이 아니라 스택 '상단'에 앵커된다(실측) → y≈9 면 스택(~12.6% 높이)이
// 방(y2–27) 안에 든다. 가로 간격 ≥ AVATAR_W(≈6.25) 라 슬롯끼리 비겹침. 방 용량을 넘는 인원은 그 방에
// 안 들어가고 다른 행동을 한다(틱 분기). 휴게실 x69–98, 회의실 x2–31.
export const LOUNGE_SOFA_SLOTS: Pt[] = [{ x: 73, y: 9 }, { x: 80, y: 9 }];           // 소파존(휴식) 2석
export const PANTRY_SLOTS: Pt[]     = [{ x: 87, y: 9 }, { x: 94, y: 9 }];            // 탕비존(잡담·커피) 2석
export const CONF_SLOTS: Pt[]       = [{ x: 13, y: 9 }, { x: 20, y: 9 }, { x: 27, y: 9 }]; // 회의실(업무협의) 3석
// 회의실 화이트보드 앞 — 메모 1인(회의실 좌측, CONF_SLOTS 와 비겹침).
export const WHITEBOARD_SPOT: Pt = { x: 6, y: 9 };

// 자료 찾기 — 팀존(상단 책장 벽) 앞 1석. 팀존 사각형에서 파생(매직넘버 금지).
export function shelfSpot(zone: { x: number; w: number }): Pt {
  return { x: zone.x + zone.w / 2, y: 35 };
}
