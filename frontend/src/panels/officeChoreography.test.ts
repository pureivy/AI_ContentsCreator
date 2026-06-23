import { describe, it, expect } from "vitest";
import {
  LOUNGE_SOFA_SPOTS, PANTRY_CHAT_PAIR, PANTRY_COFFEE_SPOTS,
  WHITEBOARD_SPOT, huddleSeats, shelfSpot, AVATAR_W, AVATAR_H, Pt,
} from "./officeChoreography";

const overlaps = (a: Pt, b: Pt) =>
  Math.abs(a.x - b.x) < AVATAR_W && Math.abs(a.y - b.y) < AVATAR_H;
function assertNoOverlap(pts: Pt[]) {
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      expect(overlaps(pts[i], pts[j])).toBe(false);
}

describe("휴게실 ambient spots — 동시 점유 가능 spot 끼리 비겹침", () => {
  it("소파존(휴식)+탕비존(잡담 페어·커피) 전체 상호 비겹침", () => {
    assertNoOverlap([...LOUNGE_SOFA_SPOTS, ...PANTRY_CHAT_PAIR, ...PANTRY_COFFEE_SPOTS]);
  });
});

describe("회의실 — 업무협의 좌석 + 화이트보드", () => {
  it("huddleSeats(n) 은 n개 좌석", () => {
    expect(huddleSeats(2)).toHaveLength(2);
    expect(huddleSeats(3)).toHaveLength(3);
  });
  it("huddleSeats(2)·(3) 내부 비겹침", () => {
    assertNoOverlap(huddleSeats(2));
    assertNoOverlap(huddleSeats(3));
  });
  it("화이트보드는 허들 좌석과 비겹침", () => {
    assertNoOverlap([WHITEBOARD_SPOT, ...huddleSeats(3)]);
  });
});

describe("자료 찾기 — 팀존 책장 앞", () => {
  it("shelfSpot 은 팀존 중앙·상단(y=35)", () => {
    expect(shelfSpot({ x: 2, w: 48 })).toEqual({ x: 26, y: 35 });
  });
});
