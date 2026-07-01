import { describe, it, expect } from "vitest";
import {
  LOUNGE_SOFA_ZONE, PANTRY_ZONE, CONF_ZONE, READING_ZONE, BEANBAG_ZONE, WHITEBOARD_SPOT,
  pointInZone, overlapFrac, placeInZone, MAX_OVERLAP,
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

// (구) corridorPath(4-lane 사다리) 테스트는 참고 엔진 이식(officeNav.ts)으로 대체 —
// '가구 위를 지나가지 않는 이동' 보장은 officeNav.test.ts(보행 격자 기반)가 검증한다.
