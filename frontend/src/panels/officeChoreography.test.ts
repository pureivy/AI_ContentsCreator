import { describe, it, expect } from "vitest";
import {
  LOUNGE_SOFA_ZONE, PANTRY_ZONE, CONF_ZONE, READING_ZONE, BEANBAG_ZONE, WHITEBOARD_SPOT,
  pointInZone, overlapFrac, placeInZone, MAX_OVERLAP,
  corridorPath, pointOnAnyLane,
  AVATAR_W, AVATAR_H, Pt, Zone,
} from "./officeChoreography";

// 결정적 난수(LCG) — placeInZone 의 산포가 재현 가능하도록.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const inZone = (p: Pt, z: Zone) => p.x >= z.xMin && p.x <= z.xMax && p.y >= z.yMin && p.y <= z.yMax;

// office_map.png 의 8개 방 좌표(OfficeView ROOMS 와 동일) — ambient 존이 각자 '제 방' 안에 드는지 검증.
// 가구·동선은 그림이 그리므로, 코드 존은 그 방 사각형 안에 있기만 하면 된다(겹침 허용이라 비겹침 검증 X).
type Rect = { xMin: number; xMax: number; yMin: number; yMax: number };
const inside = (p: Pt, r: Rect) => p.x >= r.xMin && p.x <= r.xMax && p.y >= r.yMin && p.y <= r.yMax;
const within = (z: Zone, r: Rect) =>
  inside({ x: z.xMin, y: z.yMin }, r) && inside({ x: z.xMax, y: z.yMax }, r);
const CONF: Rect    = { xMin: 31,   xMax: 60,   yMin: 3,  yMax: 33 }; // 회의실(상중)
const LOUNGE: Rect  = { xMin: 11,   xMax: 42,   yMin: 60, yMax: 98 }; // 휴게실(좌하)
const PANTRY: Rect  = { xMin: 62.5, xMax: 98.5, yMin: 32, yMax: 58 }; // 탕비실(우중)
const READING: Rect = { xMin: 61.5, xMax: 98,   yMin: 60, yMax: 98 }; // 휴식공간(우하)
const BEANBAG: Rect = { xMin: 42,   xMax: 62,   yMin: 60, yMax: 98 }; // 하단 중앙 빈백 라운지

describe("방 안 ambient 배치 영역 — office_map.png 의 제 방 안에 든다", () => {
  it("업무협의·화이트보드는 회의실(상중) 안", () => {
    expect(within(CONF_ZONE, CONF)).toBe(true);
    expect(inside(WHITEBOARD_SPOT, CONF)).toBe(true);
  });
  it("잡담·커피 존은 탕비실(우중) 안", () => {
    expect(within(PANTRY_ZONE, PANTRY)).toBe(true);
  });
  it("휴식 존들은 각자 휴게실/휴식공간/빈백 안", () => {
    expect(within(LOUNGE_SOFA_ZONE, LOUNGE)).toBe(true);
    expect(within(READING_ZONE, READING)).toBe(true);
    expect(within(BEANBAG_ZONE, BEANBAG)).toBe(true);
  });
  it("y·x 밴드가 1점이 아니라 폭을 가져 일직선 방지(2D 산포)", () => {
    for (const z of [LOUNGE_SOFA_ZONE, PANTRY_ZONE, CONF_ZONE, READING_ZONE, BEANBAG_ZONE]) {
      expect(z.yMax).toBeGreaterThan(z.yMin);
      expect(z.xMax).toBeGreaterThan(z.xMin);
    }
  });
});

describe("pointInZone — [0,1] 난수를 영역 안 좌표로", () => {
  it("모서리·중앙 매핑", () => {
    expect(pointInZone(CONF_ZONE, 0, 0)).toEqual({ x: CONF_ZONE.xMin, y: CONF_ZONE.yMin });
    expect(pointInZone(CONF_ZONE, 1, 1)).toEqual({ x: CONF_ZONE.xMax, y: CONF_ZONE.yMax });
  });
  it("어떤 난수든 결과는 영역 안", () => {
    for (const [rx, ry] of [[0, 0], [0.3, 0.7], [1, 1], [0.99, 0.01]] as const) {
      expect(inZone(pointInZone(PANTRY_ZONE, rx, ry), PANTRY_ZONE)).toBe(true);
      expect(inZone(pointInZone(CONF_ZONE, rx, ry), CONF_ZONE)).toBe(true);
    }
  });
});

describe("overlapFrac — 아바타 박스 면적 겹침 비율(한쪽 박스 대비)", () => {
  it("같은 점=완전 겹침(1), 한 칸 이상 떨어지면 0", () => {
    expect(overlapFrac({ x: 50, y: 50 }, { x: 50, y: 50 })).toBeCloseTo(1, 5);
    expect(overlapFrac({ x: 50, y: 50 }, { x: 50 + AVATAR_W, y: 50 })).toBeCloseTo(0, 5);
    expect(overlapFrac({ x: 50, y: 50 }, { x: 50, y: 50 + AVATAR_H })).toBeCloseTo(0, 5);
  });
  it("같은 y, dx=AVATAR_W/2 → 면적 1/2 (세로 완전 겹침 × 가로 1/2)", () => {
    expect(overlapFrac({ x: 50, y: 50 }, { x: 50 + AVATAR_W / 2, y: 50 })).toBeCloseTo(0.5, 5);
  });
  it("1/3 경계: dx=AVATAR_W*2/3, dy=0 → 정확히 1/3", () => {
    expect(overlapFrac({ x: 50, y: 50 }, { x: 50 + (AVATAR_W * 2) / 3, y: 50 })).toBeCloseTo(1 / 3, 5);
  });
});

describe("placeInZone — 영역 안 산포, 쌍별 겹침 < 1/3", () => {
  it("배치된 점은 항상 영역 안(실제 존)", () => {
    const rng = lcg(7);
    const placed: Pt[] = [];
    for (let i = 0; i < 4; i++) {
      const p = placeInZone(PANTRY_ZONE, placed, rng);
      expect(inZone(p, PANTRY_ZONE)).toBe(true);
      placed.push(p);
    }
  });
  it("충분히 넓은 영역에선 4명 쌍별 겹침이 모두 1/3 미만", () => {
    const WIDE: Zone = { xMin: 10, xMax: 40, yMin: 10, yMax: 30 };
    const rng = lcg(42);
    const placed: Pt[] = [];
    for (let i = 0; i < 4; i++) placed.push(placeInZone(WIDE, placed, rng));
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlapFrac(placed[i], placed[j])).toBeLessThan(MAX_OVERLAP);
  });
  it("MAX_OVERLAP 은 1/3", () => {
    expect(MAX_OVERLAP).toBeCloseTo(1 / 3, 10);
  });
});

// 사용자 요청: 이동(산책·활동이동·복귀)은 '절대로 오브제 위를 지나가지 말고 복도로만'.
// corridorPath 가 반환하는 모든 이동 구간이 (1) 축정렬(수직/수평, 대각선 금지)이고 (2) 중간 경유점이
// 전부 복도(lane) 위임을 검증 → 가구 위 대각선 횡단이 구조적으로 불가능함을 보장.
describe("corridorPath — 이동은 복도(lane)로만, 가구 위 대각선 금지", () => {
  // (from=책상/존, to=책상/존) — 도착지(from/to)는 가구 위일 수 있으나 그 '사이 이동'은 복도여야 함.
  const cases: Array<[string, Pt, Pt]> = [
    ["경영지원 포드→휴게실 소파", { x: 44, y: 45 }, { x: 26, y: 78 }],
    ["기획팀 데스크→탕비실",      { x: 80, y: 18 }, { x: 78, y: 42 }],
    ["경영지원 포드→회의실",      { x: 44, y: 45 }, { x: 45, y: 20 }],
    ["휴게실→탕비실(오피스 횡단)", { x: 26, y: 78 }, { x: 78, y: 42 }],
    ["기획팀→휴식공간 서재",      { x: 85, y: 16 }, { x: 80, y: 72 }],
    ["CEO앞 리셉션→회의실",       { x: 12, y: 40 }, { x: 45, y: 20 }],
  ];
  for (const [name, from, to] of cases) {
    it(`${name}: 모든 구간 축정렬 + 중간 경유점은 복도 위`, () => {
      const path = corridorPath(from, to);
      expect(path.length).toBeGreaterThanOrEqual(2);
      // 끝점은 from/to 그대로
      expect(path[0].x).toBeCloseTo(from.x, 5); expect(path[0].y).toBeCloseTo(from.y, 5);
      expect(path[path.length - 1].x).toBeCloseTo(to.x, 5); expect(path[path.length - 1].y).toBeCloseTo(to.y, 5);
      // 모든 연속 구간이 수직 또는 수평(대각선 = 가구 횡단 → 금지)
      for (let i = 1; i < path.length; i++) {
        const dx = Math.abs(path[i].x - path[i - 1].x), dy = Math.abs(path[i].y - path[i - 1].y);
        expect(dx < 0.6 || dy < 0.6).toBe(true);
      }
      // from/to(가구 위 도착지)를 뺀 중간 경유점은 전부 복도(lane) 위
      for (let i = 1; i < path.length - 1; i++) expect(pointOnAnyLane(path[i])).toBe(true);
    });
  }
});
