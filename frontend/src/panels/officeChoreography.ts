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
export const REST_SPOTS: Pt[] = [{ x: 24, y: 70 }, { x: 30, y: 80 }];    // 휴게실(BL) 소파 앞
// ── 이동 경로 ────────────────────────────────────────────────────────────────
// (구) 4-lane 사다리 corridorPath 는 참고 엔진 이식(officeNav.ts: 80노드 복도 그래프 +
// 바닥 보행 격자 + LOS string-pull)으로 대체됐다 — 모든 이동은 OfficeView 의 rAF 보행
// 엔진이 officeNav.routePath 로 계산한다. 여기엔 '목적지' 기하만 남긴다.

// 통화/대기 — 빈 바닥(보행 격자 위) 지점. 통화자는 복도를 걸어 이 점에 도착해 선다.
// (24,45)=좌 복도 중턱, (41,33)·(59,33)=상단 조용한 복도(참고 엔진 PHONE 스팟).
export const CORRIDOR_SPOTS: Pt[] = [{ x: 24, y: 45 }, { x: 41, y: 33 }, { x: 59, y: 33 }];

// 회의실(top-left) 팀간(cross-team) 회의 — CEO 통합 시 원장+팀장들이 회의 테이블을 빙 둘러앉아
// '모여서 회의'하는 모습. 테이블 중심(16.5,16) 둘레 타원: CEO=상석(12시), 팀장=하단 호(좌→우)로
// 균등 배치해 모두 테이블을 향한다. 팀장 수에 맞춰 동적으로 자리 생성(고정 3좌석 한계 제거).
const CONF_MEET = { cx: 45.5, cy: 18, rx: 11, ry: 8 };  // 회의실(상단 중앙) 원형 테이블
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

// 방 안 ambient 배치 영역(절대 office-%) — 한 방에 여러 명이 모일 때 '겹쳐도 되지만 일직선으로
// 줄세우지 않게' 영역 안에 2D 무작위 배치한다(사용자 요청). 고정 슬롯(같은 y)은 가로 일직선이 돼
// 보기 싫다는 피드백 → x·y 둘 다 산포. 아바타는 framer-motion 이 translate(-50%,-50%) 를 덮어써
// (x,y)가 스택 '상단'에 앵커(실측) → y≈6~11 이면 스택(~12.6% 높이)이 방(y2–27) 안에 든다.
// 휴게실 x69–98, 회의실 x2–31.
// 영역을 가로로 넓혀(휴게실 x69–98 안) 여러 명이 모여도 1/3 미만으로만 겹치게 산포 여유를 둔다.
export interface Zone { xMin: number; xMax: number; yMin: number; yMax: number }
// office_map.png 의 실제 가구 영역에 맞춘 ambient 배치 존(절대 office-%). 각 존은 해당 '방' 안에
// 들고, 아바타 스택은 (x,y)를 상단~중앙에 앵커해 몸이 그 아래(가구 위)에 놓이므로 yMin/yMax 는
// 방 시각 중심보다 살짝 위로 잡는다. 좌표는 스크린샷 루프에서 그림과 대조해 미세 보정.
// 휴게실(BL, 하단 좌측) 소파 클러스터(소파·안락의자 y68~88) — 휴식 전용. 아바타 시각상 발은 박스
// 하단이 아니라 ~90% 지점(≈앵커+3.6)이므로 앵커존을 y73~84 로 잡아 발이 라운지 소파/바닥(y76~88)에
// 확실히 닿게(= 하단 휴게소 '안'에서 휴식). 직전(y67~82)은 너무 높아 라운지 위쪽 경계에 떠 보였음.
export const LOUNGE_SOFA_ZONE: Zone = { xMin: 16, xMax: 36, yMin: 73, yMax: 84 };
export const PANTRY_ZONE: Zone     = { xMin: 67, xMax: 92, yMin: 36, yMax: 46 }; // 탕비실(MR) 바·테이블: 잡담·커피
export const CONF_ZONE: Zone       = { xMin: 37, xMax: 54, yMin: 15, yMax: 24 }; // 회의실(TC) 원형 테이블 둘레(경계 안쪽): 업무협의
export const READING_ZONE: Zone    = { xMin: 68, xMax: 92, yMin: 66, yMax: 76 }; // 휴식공간(BR) 서재: 자료 찾기
export const BEANBAG_ZONE: Zone    = { xMin: 44, xMax: 60, yMin: 76, yMax: 88 }; // 하단 중앙 빈백(예비)
// 회의실 화이트보드/스크린 앞 — 회의실 경계 안쪽(스크린 바로 앞).
export const WHITEBOARD_SPOT: Pt = { x: 42, y: 12 };

// 영역 안의 한 점 — rx·ry 는 [0,1] 난수(틱이 주입). 비겹침을 강제하지 않는다(겹침 허용 + 2D 산포).
export function pointInZone(z: Zone, rx: number, ry: number): Pt {
  return { x: z.xMin + (z.xMax - z.xMin) * rx, y: z.yMin + (z.yMax - z.yMin) * ry };
}

// 두 아바타 박스가 겹치는 면적 비율(한쪽 박스 면적 대비, 0~1). 가로·세로 겹침 길이를 각 박스
// 변으로 나눠 곱한다 → 같은 점=1, AVATAR_W/H 이상 벌어지면 0. '겹침 정도'의 충실한 척도.
export function overlapFrac(a: Pt, b: Pt): number {
  const ox = Math.max(0, AVATAR_W - Math.abs(a.x - b.x));
  const oy = Math.max(0, AVATAR_H - Math.abs(a.y - b.y));
  return (ox / AVATAR_W) * (oy / AVATAR_H);
}

// 사용자 요청: 같은 방에 모여 겹치더라도 '면적의 1/3 이상' 겹치지 않게.
export const MAX_OVERLAP = 1 / 3;

// 영역 안에서 이미 놓인 점들과 1/3 미만으로만 겹치는 한 점을 고른다. rng=[0,1) 난수(틱/테스트가
// 주입 → 결정성). tries 번 거절 표집해 조건을 만족하는 점을 찾고, 못 찾으면(영역이 너무 좁은
// 경우) '가장 덜 겹치는' 후보를 반환해 배치는 항상 성공시킨다. existing 엔 그 방의 기존 아바타뿐
// 아니라 전체 wander 점을 넣어도 무방하다(멀리 있는 점은 overlapFrac=0 이라 제약이 안 됨).
export function placeInZone(z: Zone, existing: Pt[], rng: () => number, tries = 24): Pt {
  let best: Pt = pointInZone(z, rng(), rng());
  let bestWorst = Infinity;
  for (let i = 0; i < tries; i++) {
    const p = i === 0 ? best : pointInZone(z, rng(), rng());
    let worst = 0;
    for (const q of existing) {
      const f = overlapFrac(p, q);
      if (f > worst) worst = f;
      if (worst >= MAX_OVERLAP) break;
    }
    if (worst < MAX_OVERLAP) return p;
    if (worst < bestWorst) { bestWorst = worst; best = p; }
  }
  return best;
}

// 자료 찾기 — office_map.png 의 서재(휴식공간 BR, 우하단 책장 벽) 앞에서 책을 찾는 모습.
// 책장이 이제 팀존이 아니라 고정 방(BR)에 있으므로 READING_ZONE 안에 배치한다(OfficeView 가
// placeInZone(READING_ZONE) 로 호출). 별도 헬퍼 불필요 — 존 하나로 휴식·자료를 함께 흡수.
