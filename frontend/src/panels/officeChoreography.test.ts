import { describe, it, expect } from "vitest";
import {
  LOUNGE_SOFA_ZONE, PANTRY_ZONE, CONF_ZONE, WHITEBOARD_SPOT,
  pointInZone, shelfSpot, Pt,
} from "./officeChoreography";

// 사용자 요청: 휴게실/탕비실·회의실 액션은 '겹쳐도 되지만 일직선으로 줄세우지 않게' 영역 안 2D 산포.
// → 검증: 영역이 해당 방 안에 들고, pointInZone 결과가 항상 그 영역(=방) 안. (겹침 허용이라 비겹침은 검증 X)

type Rect = { xMin: number; xMax: number; yMin: number; yMax: number };
const inside = (p: Pt, r: Rect) => p.x >= r.xMin && p.x <= r.xMax && p.y >= r.yMin && p.y <= r.yMax;
const LOUNGE: Rect = { xMin: 69, xMax: 98, yMin: 2, yMax: 27 };
const CONF: Rect = { xMin: 2, xMax: 31, yMin: 2, yMax: 27 };

describe("방 안 ambient 배치 영역", () => {
  it("소파존·탕비존은 휴게실(x69–98, y2–27) 안", () => {
    for (const z of [LOUNGE_SOFA_ZONE, PANTRY_ZONE]) {
      expect(inside({ x: z.xMin, y: z.yMin }, LOUNGE)).toBe(true);
      expect(inside({ x: z.xMax, y: z.yMax }, LOUNGE)).toBe(true);
    }
  });
  it("회의실 영역·화이트보드는 회의실(x2–31, y2–27) 안", () => {
    expect(inside({ x: CONF_ZONE.xMin, y: CONF_ZONE.yMin }, CONF)).toBe(true);
    expect(inside({ x: CONF_ZONE.xMax, y: CONF_ZONE.yMax }, CONF)).toBe(true);
    expect(inside(WHITEBOARD_SPOT, CONF)).toBe(true);
  });
  it("소파존(좌)·탕비존(우)은 좌우로 분리", () => {
    expect(LOUNGE_SOFA_ZONE.xMax).toBeLessThan(PANTRY_ZONE.xMin);
  });
  it("y 밴드가 1점이 아니라 폭을 가져 일직선 방지(2D 산포)", () => {
    for (const z of [LOUNGE_SOFA_ZONE, PANTRY_ZONE, CONF_ZONE]) {
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
  it("어떤 난수든 결과는 영역(=방) 안", () => {
    for (const [rx, ry] of [[0, 0], [0.3, 0.7], [1, 1], [0.99, 0.01]] as const) {
      expect(inside(pointInZone(PANTRY_ZONE, rx, ry), PANTRY_ZONE)).toBe(true);
      expect(inside(pointInZone(CONF_ZONE, rx, ry), CONF)).toBe(true);
    }
  });
});

describe("자료 찾기 — 팀존 책장 앞", () => {
  it("shelfSpot 은 팀존 중앙·상단(y=35)", () => {
    expect(shelfSpot({ x: 2, w: 48 })).toEqual({ x: 26, y: 35 });
  });
});
