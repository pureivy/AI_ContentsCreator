import { describe, it, expect } from "vitest";
import {
  LOUNGE_SOFA_ZONE, PANTRY_ZONE, CONF_ZONE, WHITEBOARD_SPOT,
  pointInZone, shelfSpot, overlapFrac, placeInZone, MAX_OVERLAP,
  AVATAR_W, AVATAR_H, Pt, Zone,
} from "./officeChoreography";

// 결정적 난수(LCG) — placeInZone 의 산포가 재현 가능하도록.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const inZone = (p: Pt, z: Zone) => p.x >= z.xMin && p.x <= z.xMax && p.y >= z.yMin && p.y <= z.yMax;

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

describe("자료 찾기 — 팀존 서류함(캐비넷) 앞", () => {
  it("shelfSpot 은 팀존 우상단 서류함 코너(중앙 책상이 아님)", () => {
    // 서류함은 office-cabinet 과 동일 x(g.x + g.w - 3, 상단 벽). 자료찾기는 그 바로 앞.
    const g = { x: 2, w: 48 };
    const cabinetX = g.x + g.w - 3;
    const s = shelfSpot(g);
    expect(Math.abs(s.x - cabinetX)).toBeLessThanOrEqual(2.5); // 서류함 코앞(±2.5%)
    expect(s.x).toBeLessThan(cabinetX);                        // 벽 쪽이 아니라 방 안쪽(앞)에서
    expect(s.x).toBeGreaterThan(g.x + g.w / 2);                // 중앙(책상)보다 오른쪽 — 책상에서 자료찾기 X
    expect(s.y).toBeLessThan(39);                              // 팀장 책상(y=39)보다 위(상단 벽 캐비넷)
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
  it("배치된 점은 항상 영역 안", () => {
    const rng = lcg(7);
    const placed: Pt[] = [];
    for (let i = 0; i < 4; i++) {
      const p = placeInZone(CONF_ZONE, placed, rng);
      expect(inZone(p, CONF_ZONE)).toBe(true);
      placed.push(p);
    }
  });
  it("충분히 넓은 영역(회의실)에선 4명 쌍별 겹침이 모두 1/3 미만", () => {
    const rng = lcg(42);
    const placed: Pt[] = [];
    for (let i = 0; i < 4; i++) placed.push(placeInZone(CONF_ZONE, placed, rng));
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlapFrac(placed[i], placed[j])).toBeLessThan(MAX_OVERLAP);
  });
  it("MAX_OVERLAP 은 1/3", () => {
    expect(MAX_OVERLAP).toBeCloseTo(1 / 3, 10);
  });
});
