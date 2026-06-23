import { describe, it, expect } from "vitest";
import {
  LOUNGE_SOFA_SLOTS, PANTRY_SLOTS, CONF_SLOTS, WHITEBOARD_SPOT,
  shelfSpot, AVATAR_W, AVATAR_H, Pt,
} from "./officeChoreography";

// 사용자 요청: 휴게실/탕비실·회의실 액션은 '방 안'에 두되 서로 '겹치지 않게'(일렬이어도 무방).
// → 검증: 슬롯이 해당 방 안에 들고, 동시 점유 가능한 슬롯끼리 비겹침.

const overlaps = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < AVATAR_W && Math.abs(a.y - b.y) < AVATAR_H;
function assertNoOverlap(pts: Pt[]) {
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      expect(overlaps(pts[i], pts[j])).toBe(false);
}
type Rect = { xMin: number; xMax: number; yMin: number; yMax: number };
const inside = (p: Pt, r: Rect) => p.x >= r.xMin && p.x <= r.xMax && p.y >= r.yMin && p.y <= r.yMax;
const LOUNGE: Rect = { xMin: 69, xMax: 98, yMin: 2, yMax: 27 };
const CONF: Rect = { xMin: 2, xMax: 31, yMin: 2, yMax: 27 };

describe("방 안 비겹침 슬롯", () => {
  it("휴게실 슬롯(소파+탕비)은 휴게실 안 & 상호 비겹침", () => {
    const all = [...LOUNGE_SOFA_SLOTS, ...PANTRY_SLOTS];
    all.forEach((p) => expect(inside(p, LOUNGE)).toBe(true));
    assertNoOverlap(all);
  });
  it("회의실 슬롯 + 화이트보드는 회의실 안 & 상호 비겹침", () => {
    const all = [...CONF_SLOTS, WHITEBOARD_SPOT];
    all.forEach((p) => expect(inside(p, CONF)).toBe(true));
    assertNoOverlap(all);
  });
  it("슬롯 용량: 소파 2 · 탕비 2 · 회의실 3", () => {
    expect(LOUNGE_SOFA_SLOTS).toHaveLength(2);
    expect(PANTRY_SLOTS).toHaveLength(2);
    expect(CONF_SLOTS).toHaveLength(3);
  });
});

describe("자료 찾기 — 팀존 책장 앞", () => {
  it("shelfSpot 은 팀존 중앙·상단(y=35)", () => {
    expect(shelfSpot({ x: 2, w: 48 })).toEqual({ x: 26, y: 35 });
  });
});
