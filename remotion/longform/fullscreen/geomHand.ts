// 손 모양 계산(순수, 2026-10-23 스타일 B 손질) — 3D 뼈대(손바닥 판 + 손가락 넷 × 마디 셋 + 엄지) → 정사영 → 2D 윤곽·빗금·손톱·주름.
// 단위 = mm 어림(손 길이 ≈ 190, 손등 너비 ≈ 80). 손 좌표: x = 손가락 쪽, y = 엄지 쪽, z = 손등 쪽. 화면: X 오른쪽, Y 아래, Z 보는 사람 쪽.
// 오른손만 만든다 — 왼손은 그린 뒤 좌우 반전.
import type { P } from './geom';

export type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const D2R = Math.PI / 180;
const f1 = (n: number) => n.toFixed(1);

/** 빛 — 왼쪽 위 앞. */
const LIGHT: V3 = nrm([-0.5, -0.72, 0.55]);
const VIEW: V3 = [0, 0, 1];

// ── 손 치수(오른손, 손 좌표)
type FingerDef = { mcp: V3; lens: [number, number, number]; radii: [number, number, number, number] };
const FINGERS: FingerDef[] = [
  // (B4) 실제 손 비례 — 가운뎃손가락이 가장 길고 새끼는 짧고 뿌리도 낮다. 굵기는 끝으로 갈수록 가늘게(끝 ≈ 뿌리의 0.65), 손가락 사이 틈.
  { mcp: [99, 28, -1], lens: [41, 24, 19], radii: [9.4, 8.4, 7.3, 6.2] }, // 검지
  { mcp: [103, 9, 2], lens: [46, 28, 20], radii: [9.7, 8.7, 7.5, 6.4] }, // 중지
  { mcp: [99, -10, 0], lens: [43, 26, 19], radii: [9.2, 8.2, 7.1, 6.1] }, // 약지
  { mcp: [88, -27, -4], lens: [33, 19, 17], radii: [8.0, 7.1, 6.2, 5.4] }, // 소지
];
/** 손바닥 가로 아치(오므림) — 자세 arch 1 이면 검지·소지 뿌리가 손바닥 쪽으로(mm). */
const ARCH_Z = [-4, 1, -3, -9];
const THUMB = { cmc: [24, 27, -11] as V3, lens: [40, 31, 26] as [number, number, number], radii: [14.5, 11.0, 9.6, 8.0] as [number, number, number, number] };

export type FingerPose = { mcp: number; pip: number; dip: number; splay?: number };
/** 방향(손 좌표) — yaw = 손바닥 면에서 엄지 쪽(+y)으로, pitch = 손바닥 쪽(-z)으로(도). */
export type Dir = [number, number];
/** 엄지 — 손허리뼈 방향 meta, 그다음 두 마디는 aim(목표 점으로 두 마디 IK) 또는 prox·dist 방향. */
export type ThumbPose = { meta: Dir; prox?: Dir; dist?: Dir; aim?: 'index' | 'indexMid' | V3; aimOff?: V3 };
export type HandPoseDef = {
  /** 손가락 방향(화면 3D, 대략). */
  fwd: V3;
  /** 엄지 쪽이 향하는 화면 방향(대략) — 손등 방향은 여기서 나온다. */
  thumbSide: V3;
  /** 손목 꺾임(손바닥 쪽 +, 도). */
  wrist?: number;
  fingers: [FingerPose, FingerPose, FingerPose, FingerPose];
  thumb: ThumbPose;
  /** 펼친 모습(curl = 0). */
  open: { fingers: [FingerPose, FingerPose, FingerPose, FingerPose]; thumb: ThumbPose };
  /** 부품 (x,y)가 오는 점 — 손 좌표 점, 또는 검지 끝·집는 점·가운데손가락 끝. */
  anchor: V3 | 'indexTip' | 'pinch' | 'middleTip';
  /** 쥔 물건 앞에 그릴 부위(나머지는 뒤). 'all' = 손 전체가 앞. */
  front: 'all' | Array<'fingers' | 'thumb' | 'palm'>;
  /** 쥔 물건 축 반지름(mm). */
  gripR?: number;
  /** (B4) 손바닥 가로 아치 0 평평 ~ 1.5 오므림(기본 0.6). */
  arch?: number;
};

export type HandPoseName = 'hold' | 'pinch' | 'open' | 'pour' | 'point' | 'press' | 'shears';

const F = (mcp: number, pip: number, dip: number, splay = 0): FingerPose => ({ mcp, pip, dip, splay });

/**
 * 자세 — 오른손 기준(오른쪽에서 들어온다 — open 만 마주 선 사람의 오른손이라 왼쪽 위에서). 숫자는 갤러리에서 눈으로 맞춘 값.
 * hold: 세로 줄기를 망치 쥐듯 — 엄지 위, 손바닥이 보는 쪽(손톱이 보임). 손가락·엄지는 줄기 앞, 손바닥은 뒤.
 */
export const HAND_POSES: Record<HandPoseName, HandPoseDef> = {
  hold: {
    fwd: [-0.93, 0.2, -0.3], thumbSide: [-0.15, -1, -0.1], wrist: 6,
    fingers: [F(62, 100, 52, 5), F(66, 104, 52, 1), F(70, 104, 50, -3), F(76, 100, 46, -8)],
    thumb: { meta: [24, 46], aim: 'indexMid', aimOff: [-22, -6, -14] },
    open: { fingers: [F(10, 18, 8, 9), F(10, 16, 6, 2), F(12, 18, 8, -5), F(14, 20, 10, -12)], thumb: { meta: [55, 20], prox: [45, 12], dist: [40, 8] } },
    anchor: [118, 4, -26], front: ['fingers', 'thumb'], gripR: 15,
  },
  shears: {
    fwd: [-0.9, 0.36, -0.25], thumbSide: [-0.3, -1, -0.1], wrist: 4,
    fingers: [F(58, 96, 50, 5), F(62, 100, 50, 1), F(66, 100, 48, -3), F(72, 96, 44, -8)],
    thumb: { meta: [26, 44], aim: 'indexMid', aimOff: [-6, 2, -16] },
    open: { fingers: [F(30, 50, 25, 5), F(32, 52, 25, 1), F(34, 52, 24, -3), F(36, 50, 22, -8)], thumb: { meta: [50, 24], prox: [40, 16], dist: [34, 10] } },
    anchor: [116, 4, -28], front: ['fingers', 'thumb'], gripR: 17,
  },
  pinch: {
    // (B4) 덜 뻣뻣하게 — 검지는 둥글게 굽어 손끝 살로 집고, 나머지 셋은 차례로 더 말려 손바닥 쪽으로 겹친다(부채꼴).
    fwd: [-0.9, 0.3, -0.3], thumbSide: [0, -0.55, 0.85], wrist: 10, arch: 0.8,
    fingers: [F(50, 66, 30, 4), F(62, 80, 44, -1), F(70, 88, 46, -6), F(78, 94, 48, -12)],
    thumb: { meta: [18, 42], aim: 'index' },
    open: { fingers: [F(14, 14, 6, 8), F(26, 36, 18, 1), F(32, 42, 22, -5), F(38, 48, 26, -12)], thumb: { meta: [52, 26], prox: [46, 16], dist: [42, 10] } },
    anchor: 'pinch', front: 'all',
  },
  open: {
    // (B4) 뿌리분 풀기 — 마주 선 사람의 두 손: 오른손은 뿌리분 왼쪽(팔이 왼쪽 위에서), 손등이 보이고 손가락은 벌린 채 갈고리처럼 굽어
    // 뿌리분 옆에 파고든다, 엄지는 위에서 안쪽으로. 반대쪽은 side='left'(거울).
    fwd: [0.47, 0.88, -0.1], thumbSide: [0.84, -0.41, 0.35], wrist: -10, arch: 1.1,
    fingers: [F(16, 44, 26, 14), F(14, 46, 28, 3), F(18, 46, 28, -9), F(24, 46, 26, -20)],
    thumb: { meta: [50, 30], prox: [34, 30], dist: [22, 26] },
    open: { fingers: [F(6, 8, 4, 12), F(4, 6, 4, 2), F(6, 8, 4, -7), F(8, 10, 6, -16)], thumb: { meta: [60, 18], prox: [52, 10], dist: [48, 6] } },
    anchor: 'middleTip', front: 'all',
  },
  pour: {
    fwd: [-0.94, 0.24, 0.24], thumbSide: [0, -0.3, -0.95], wrist: -8,
    fingers: [F(20, 30, 14, 3), F(18, 30, 14, 0), F(20, 32, 16, -3), F(26, 36, 18, -6)],
    thumb: { meta: [30, 22], prox: [16, 14], dist: [8, 10] },
    open: { fingers: [F(4, 6, 2, 3), F(4, 6, 2, 0), F(4, 6, 2, -3), F(6, 8, 4, -6)], thumb: { meta: [40, 14], prox: [34, 8], dist: [30, 4] } },
    anchor: [64, -2, -24], front: 'all',
  },
  point: {
    fwd: [-1, 0.1, 0], thumbSide: [0, -0.9, 0.4], wrist: 4,
    fingers: [F(0, 4, 2, 2), F(86, 100, 56, 0), F(90, 102, 56, -4), F(92, 98, 52, -9)],
    thumb: { meta: [24, 48], aim: 'indexMid', aimOff: [10, -26, -24] },
    open: { fingers: [F(10, 16, 8, 6), F(40, 50, 26, 1), F(44, 52, 28, -5), F(48, 54, 28, -12)], thumb: { meta: [48, 26], prox: [40, 16], dist: [36, 10] } },
    anchor: 'indexTip', front: 'all',
  },
  press: {
    // (B4) 흙 누르기 — 옆(엄지 쪽)에서 본 손: 얇은 손바닥을 흙에 납작 대고 손등은 완만한 둥근 등, 팔은 오른쪽 위에서 내려온다.
    // 네 손가락은 살짝 벌어져 끝이 엇갈리고(앞 검지 → 뒤 새끼) 끝까지 가볍게 굽어 흙을 누른다, 엄지는 앞쪽에 벌려 눕는다. (x,y) = 손바닥 밑.
    fwd: [-0.82, 0.55, -0.15], thumbSide: [-0.05, 0.2, 0.98], wrist: -40, arch: 0.35,
    fingers: [F(10, 20, 10, 9), F(8, 18, 10, 2), F(10, 20, 10, -6), F(14, 22, 12, -14)],
    thumb: { meta: [52, 26], prox: [36, 18], dist: [26, 14] },
    open: { fingers: [F(2, 6, 4, 10), F(2, 6, 4, 2), F(2, 6, 4, -6), F(4, 8, 6, -14)], thumb: { meta: [56, 18], prox: [48, 10], dist: [44, 6] } },
    anchor: [56, 0, -19], front: 'all',
  },
};

// ── 2D 출력
export type HandShape = {
  /** 이 부위를 이루는 닫힌 윤곽들(합쳐서 한 덩어리 실루엣 — 먼저 선, 그 위에 종이 칠). */
  shapes: string[];
  /** 앞뒤로 겹쳐 그릴 덩어리(먼 것부터) — 덩어리마다 윤곽 → 종이 → 빗금. 깊게 접힌 마디는 따로 덩어리가 된다. */
  groups: Array<{ shapes: string[]; hatch: string; hatch2: string; core: string }>;
  /** 세부 선 — 주름·힘줄·손톱 뿌리 등. */
  details: Array<{ d: string; tone: 'dark' | 'mid' | 'light'; w: number; dash?: string }>;
  /** 손톱(종이 칠 + 선). */
  nails: string[];
  depth: number;
  part: 'sleeve' | 'arm' | 'palm' | 'finger' | 'thumb';
  box: { x0: number; y0: number; x1: number; y1: number };
  /** 먼 끝을 흐리게 지우는 축(a = 흐려지기 시작, b = 다 지워짐) — 소매·맨팔 끝. */
  fade?: { a: P; b: P };
};
export type HandG = { parts: HandShape[]; front: Set<number>; tip: P; gripR: number; size: number };

type Basis = { X: V3; Y: V3; Z: V3; O: V3 };
const toScreen = (B: Basis, p: V3): V3 => add(B.O, add(add(mul(B.X, p[0]), mul(B.Y, p[1])), mul(B.Z, p[2])));
const dirToScreen = (B: Basis, d: V3): V3 => add(add(mul(B.X, d[0]), mul(B.Y, d[1])), mul(B.Z, d[2]));

/** 원 둘을 잇는 원뿔-구(캡슐) 2D 윤곽. */
export function capsule2(c1: P, r1: number, c2: P, r2: number): string {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  const circle = (c: P, r: number) => `M ${f1(c[0] - r)} ${f1(c[1])} a ${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0 a ${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0 Z`;
  if (d + Math.min(r1, r2) <= Math.max(r1, r2) + 0.01) return r1 >= r2 ? circle(c1, r1) : circle(c2, r2);
  const phi = Math.atan2(dy, dx);
  const a = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const pt = (c: P, r: number, ang: number): P => [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
  const a1 = pt(c1, r1, phi + a), a2 = pt(c2, r2, phi + a), b2 = pt(c2, r2, phi - a), b1 = pt(c1, r1, phi - a);
  const large2 = 2 * a > Math.PI ? 1 : 0, large1 = 2 * Math.PI - 2 * a > Math.PI ? 1 : 0;
  return `M ${f1(a1[0])} ${f1(a1[1])} L ${f1(a2[0])} ${f1(a2[1])} A ${f1(r2)} ${f1(r2)} 0 ${large2} 0 ${f1(b2[0])} ${f1(b2[1])} L ${f1(b1[0])} ${f1(b1[1])} A ${f1(r1)} ${f1(r1)} 0 ${large1} 0 ${f1(a1[0])} ${f1(a1[1])} Z`;
}

/** 볼록 껍질(2D). */
export function hull2(pts: P[]): P[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P[] = [], up: P[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

/** 닫힌 매끈한 곡선(캣멀-롬 → 3차 베지어). */
export function smoothClosed(pts: P[], tension = 1): string {
  const n = pts.length;
  if (n < 3) return '';
  let d = `M ${f1(pts[0]![0])} ${f1(pts[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!;
    const c1: P = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: P = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += ` C ${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return `${d} Z`;
}
/** 열린 매끈한 곡선. */
export function smoothOpen(pts: P[]): string {
  const n = pts.length;
  if (n < 2) return '';
  let d = `M ${f1(pts[0]![0])} ${f1(pts[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(n - 1, i + 2)]!;
    d += ` C ${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}

/** 둥근 껍질 — 점마다 반지름 rr 원을 두른 볼록 껍질을 매끈하게. */
function roundHull(pts: P[], rr: number): string {
  const ring: P[] = [];
  for (const q of pts) for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; ring.push([q[0] + Math.cos(a) * rr, q[1] + Math.sin(a) * rr]); }
  const h = hull2(ring);
  // 너무 촘촘한 점은 솎는다(매끈하게)
  const out: P[] = [];
  for (const q of h) { const last = out[out.length - 1]; if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > rr * 0.7) out.push(q); }
  return smoothClosed(out, 0.9);
}

type Seg = { a: V3; b: V3; ra: number; rb: number };

/**
 * 원기둥 마디 하나의 결 따라 빗금(화면 3D Seg) — 5요소: 하이라이트 비움, 중간 톤 H(성김) → 2B(촘촘, 그늘 쪽으로 간격 좁아짐),
 * 핵심 그림자 6B 크로스(축 방향 짧은 선, 외곽선에서 떨어진 띠), 반사광(그늘 쪽 외곽 안쪽 얇은 띠 — 2B 한 층만 남김).
 */
function segHatch(s: Seg, spacing: number, out: { h: string[]; h2: string[]; h3: string[] }, th: { h: number; h2: number; core?: boolean } = { h: 0.5, h2: 0.22 }) {
  const ax = sub(s.b, s.a);
  const L = len3(ax);
  if (L < 0.5) return;
  const u = mul(ax, 1 / L);
  let n1 = cross(u, VIEW);
  if (len3(n1) < 0.15) n1 = cross(u, [0, 1, 0]);
  n1 = nrm(n1);
  const n2 = nrm(cross(u, n1));
  const proj = Math.hypot(ax[0], ax[1]);
  const steps = Math.max(1, Math.floor(proj / spacing));
  const K = 28;
  for (let i = 0; i <= steps; i++) {
    const t = (i + 0.5) / (steps + 1);
    const c = lerp3(s.a, s.b, t), r = s.ra + (s.rb - s.ra) * t;
    const ring: Array<{ q: P; l: number; vis: boolean }> = [];
    for (let k = 0; k <= K; k++) {
      const v = (k / K) * Math.PI * 2;
      const nn = add(mul(n1, Math.cos(v)), mul(n2, Math.sin(v)));
      ring.push({ q: [c[0] + nn[0] * r * 0.97, c[1] + nn[1] * r * 0.97], l: dot(nn, LIGHT), vis: nn[2] > 0.06 });
    }
    const lmin = Math.min(...ring.filter((x) => x.vis).map((x) => x.l), 1);
    const reflect = lmin + 0.2;
    const runs = (test: (l: number) => boolean, dst: string[]) => {
      let run: P[] = [];
      for (const x of ring) { if (x.vis && test(x.l)) run.push(x.q); else { if (run.length >= 2) dst.push(smoothOpen(run)); run = []; } }
      if (run.length >= 2) dst.push(smoothOpen(run));
    };
    const ph = i % 3;
    if (ph === 0) runs((l) => l < th.h, out.h);
    if (ph === 1) runs((l) => l < th.h2, out.h2);
    if (ph === 2) runs((l) => l < Math.min(0, th.h2) && l > reflect, out.h2);
    if (i % 2 === 0 && th.core !== false) {
      for (const x of ring) {
        if (!(x.vis && x.l < -0.04 && x.l > reflect + 0.03)) continue;
        const e: V3 = mul(u, spacing * 0.8);
        out.h3.push(`M ${f1(x.q[0] - e[0])} ${f1(x.q[1] - e[1])} L ${f1(x.q[0] + e[0])} ${f1(x.q[1] + e[1])}`);
      }
    }
  }
}

/** 원기둥 겉면 위 점들(손 좌표 축 a→b, 각 v) → 화면. */
function surf(B: Basis, a: V3, b: V3, r: number, t: number, v: number, refUp: V3): V3 {
  const u = nrm(sub(b, a));
  const n1 = nrm(sub(refUp, mul(u, dot(refUp, u))));
  const n2 = cross(u, n1);
  const c = lerp3(a, b, t);
  return toScreen(B, add(c, mul(add(mul(n1, Math.cos(v)), mul(n2, Math.sin(v))), r)));
}

/** 마디 사슬 — base 에서 t0 방향, b(굽는 쪽)로 누적 굽힘. 반환: 관절 점들(손 좌표) + 마디마다 손등 쪽 법선. */
function chain(base: V3, t0: V3, bend: V3, lens: number[], flex: number[], tipR: number) {
  const pts: V3[] = [base];
  const dors: V3[] = [];
  let a = 0, cur = base;
  for (let i = 0; i < lens.length; i++) {
    a += flex[i]! * D2R;
    const dir = nrm(add(mul(t0, Math.cos(a)), mul(bend, Math.sin(a))));
    dors.push(nrm(add(mul(bend, -Math.cos(a)), mul(t0, Math.sin(a)))));
    const L = i === lens.length - 1 ? lens[i]! - tipR * 0.9 : lens[i]!;
    cur = add(cur, mul(dir, L));
    pts.push(cur);
  }
  return { pts, dors };
}

const lerpPose = (a: FingerPose, b: FingerPose, t: number): FingerPose => ({ mcp: a.mcp + (b.mcp - a.mcp) * t, pip: a.pip + (b.pip - a.pip) * t, dip: a.dip + (b.dip - a.dip) * t, splay: (a.splay ?? 0) + ((b.splay ?? 0) - (a.splay ?? 0)) * t });

const dirOf = (d: Dir): V3 => { const y = d[0] * D2R, p = d[1] * D2R; return [Math.cos(y) * Math.cos(p), Math.sin(y) * Math.cos(p), -Math.sin(p)]; };
const reject = (v: V3, u: V3): V3 => sub(v, mul(u, dot(v, u)));

/**
 * 손 모양 — pose 자세, curl(0 펼침 ~ 1 자세대로), glove(장갑: 굵게·손톱 없음·솔기). 원점 = 자세의 anchor. 반환 parts 는 먼 것부터.
 * sleeve = 소매 길이(mm, 0 이면 맨팔).
 */
export function handGeom2(pose: HandPoseName, opts: { curl?: number; glove?: boolean; sleeve?: number; scale?: number } = {}): HandG {
  const def = HAND_POSES[pose];
  const curl = Math.max(0, Math.min(1, opts.curl ?? 1));
  const glove = !!opts.glove;
  const sleeveLen = opts.sleeve ?? 150;
  const gx = glove ? 2.6 : 0; // 장갑 두께
  // 화면 크기에 맞춘 빗금 간격(화면 3.4px 아래로 촘촘해지지 않게) — 작게 그릴 땐 2B·6B 층을 뺀다
  const sc = Math.max(0.15, opts.scale ?? 1);
  const hsp = (mm: number) => Math.max(mm, 3.6 / sc);
  const lod = sc >= 0.6;
  const X = nrm(def.fwd);
  const Y = nrm(reject(def.thumbSide, X));
  const Z = cross(Y, X);
  const B0: Basis = { X, Y, Z, O: [0, 0, 0] };
  // 손목 꺾임 — 손바닥 판·손가락만 손목(원점 x=0)에서 돈다(+ = 손바닥 쪽).
  const wa = -(def.wrist ?? 0) * D2R;
  const wristRot = (p: V3): V3 => [p[0] * Math.cos(wa) - p[2] * Math.sin(wa), p[1], p[0] * Math.sin(wa) + p[2] * Math.cos(wa)];
  const wristDir = (d: V3): V3 => wristRot(d);
  const arch = def.arch ?? 0.6;
  const MCP: V3[] = FINGERS.map((fd, i) => [fd.mcp[0], fd.mcp[1] * (1 - arch * 0.04), fd.mcp[2] + ARCH_Z[i]! * arch]);
  const fpOf = (t: number) => def.fingers.map((q, i) => lerpPose(def.open.fingers[i]!, q, t));
  const chainsOf = (fps: FingerPose[]) => FINGERS.map((fd, i) => {
    const q = fps[i]!, s = (q.splay ?? 0) * D2R;
    return chain(MCP[i]!, [Math.cos(s), Math.sin(s), 0], [0, 0, -1], fd.lens, [q.mcp, q.pip, q.dip], fd.radii[3] + gx);
  });
  const fp = fpOf(curl);
  const fch = chainsOf(fp);
  // 엄지 방향 셋(손허리뼈·첫마디·끝마디) — aim 이면 두 마디 IK.
  const tipR = THUMB.radii[3] + gx;
  const thumbDirs = (tp: ThumbPose, ch: ReturnType<typeof chainsOf>): [V3, V3, V3] => {
    const m = dirOf(tp.meta);
    if (!tp.aim) return [m, dirOf(tp.prox ?? tp.meta), dirOf(tp.dist ?? tp.prox ?? tp.meta)];
    const mcpP = add(THUMB.cmc, mul(m, THUMB.lens[0]));
    const ix = ch[0]!;
    let T: V3;
    if (tp.aim === 'index') T = sub(ix.pts[3]!, mul(ix.dors[2]!, (FINGERS[0]!.radii[3] + tipR) * 0.92));
    else if (tp.aim === 'indexMid') T = lerp3(ix.pts[1]!, ix.pts[2]!, 0.5);
    else T = tp.aim;
    if (tp.aimOff) T = add(T, tp.aimOff);
    const u = sub(T, mcpP);
    const L1 = THUMB.lens[1], L2 = THUMB.lens[2] - tipR * 0.9;
    const D = Math.max(Math.abs(L1 - L2) + 1, Math.min(L1 + L2 - 0.5, len3(u)));
    const un = nrm(u);
    const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
    const w = nrm(reject(sub(mcpP, [60, -10, -30]), un));
    const prox = nrm(add(mul(un, Math.cos(al)), mul(w, Math.sin(al))));
    const ip = add(mcpP, mul(prox, L1));
    const tip = add(mcpP, mul(un, D));
    return [m, prox, nrm(sub(tip, ip))];
  };
  const tdC = thumbDirs(def.thumb, chainsOf(def.fingers));
  const tdO = thumbDirs(def.open.thumb, chainsOf(def.open.fingers));
  const td = tdC.map((d, i) => nrm(lerp3(tdO[i]!, d, curl))) as [V3, V3, V3];
  const thPts: V3[] = [THUMB.cmc];
  for (let i = 0; i < 3; i++) thPts.push(add(thPts[i]!, mul(td[i]!, i === 2 ? THUMB.lens[2] - tipR * 0.9 : THUMB.lens[i]!)));
  const thDors: V3[] = td.map((d, i) => {
    const c = i < 2 ? reject(sub(td[i + 1]!, d), d) : reject(sub(d, td[1]!), d);
    const fb = nrm(reject([0.1, -0.45, -0.88], d));
    const pad = len3(c) > 0.12 ? nrm(add(mul(nrm(c), 2), fb)) : fb;
    return mul(pad, -1);
  });
  // 기준점(anchor) — 손목 꺾은 뒤 좌표
  const tipOf = (k: number): V3 => { const c = fch[k]!; const e = c.pts[3]!, pe = c.pts[2]!; return wristRot(add(e, mul(nrm(sub(e, pe)), FINGERS[k]!.radii[3] + gx))); };
  let anc: V3;
  if (def.anchor === 'indexTip') anc = tipOf(0);
  else if (def.anchor === 'middleTip') anc = tipOf(1);
  else if (def.anchor === 'pinch') anc = wristRot(sub(fch[0]!.pts[3]!, mul(fch[0]!.dors[2]!, FINGERS[0]!.radii[3] + gx)));
  else anc = def.anchor;
  const g = toScreen(B0, anc);
  const B: Basis = { X, Y, Z, O: [-g[0], -g[1], -g[2]] };
  const parts: HandShape[] = [];
  const S = (p: V3): V3 => toScreen(B, p);
  const s2 = (p: V3): P => { const q = S(p); return [q[0], q[1]]; };
  const boxOf = (pts: P[]) => ({ x0: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), x1: Math.max(...pts.map((q) => q[0])), y1: Math.max(...pts.map((q) => q[1])) });
  const facing = (n: V3) => dirToScreen(B, n)[2];

  // 관 모양(타원 단면) — x0→x1 사이 몇 단면의 점.
  const tube = (x0: number, x1: number, ry0: number, rz0: number, ry1: number, rz1: number) => {
    const pts: P[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, x = x0 + (x1 - x0) * t, ry = ry0 + (ry1 - ry0) * t, rz = rz0 + (rz1 - rz0) * t;
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; pts.push(s2([x, Math.cos(a) * ry, Math.sin(a) * rz])); }
    }
    return pts;
  };
  /** 관 둘레에서 보는 쪽 호 — x 에서, 각 범위 안 보이는 점만. */
  const visibleArc = (x: number, ry: number, rz: number, tilt = 0): P[] => {
    const out: P[] = [];
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const n: V3 = [0, Math.cos(a), Math.sin(a)];
      if (facing(n) > 0.02) out.push(s2([x + Math.sin(a) * tilt, Math.cos(a) * ry, Math.sin(a) * rz]));
      else if (out.length) break;
    }
    return out;
  };

  // ── 아래팔·손목(2026-10-23 B3) — 손목은 손바닥보다 좁고(너비 ≈ 55mm) 팔꿈치 쪽으로 차츰 굵어진다(≈ 70mm). 깡통 같은 원기둥 금지:
  // 단면마다 윤곽 바깥 점(화면에서 팔 축에 수직인 양쪽)을 이어 실루엣을 만들고, 소매·장갑 목은 천 주름으로 울퉁불퉁하게.
  const axA = s2([0, 0, 0]), axB = s2([-100, 0, 0]);
  const axL = Math.hypot(axB[0] - axA[0], axB[1] - axA[1]) || 1;
  const ad: P = [(axB[0] - axA[0]) / axL, (axB[1] - axA[1]) / axL];
  const an: P = [-ad[1], ad[0]];
  /** 단면(x, 반지름 ry·rz, 바깥으로 부푼 정도 bulge) → 화면에서 양쪽 끝 점. */
  const sideOf = (x: number, ry: number, rz: number, bulgeUp = 0, bulgeDn = 0): [P, P] => {
    let up: P = [0, 0], dn: P = [0, 0], mx = -1e9, mn = 1e9;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const q = s2([x, Math.cos(a) * ry, Math.sin(a) * rz]);
      const d = q[0] * an[0] + q[1] * an[1];
      if (d > mx) { mx = d; up = q; }
      if (d < mn) { mn = d; dn = q; }
    }
    return [[up[0] + an[0] * bulgeUp, up[1] + an[1] * bulgeUp], [dn[0] - an[0] * bulgeDn, dn[1] - an[1] * bulgeDn]];
  };
  /** 단면 목록으로 닫힌 실루엣(윗선 → 끝 → 아랫선). openEnd = 먼 끝을 닫지 않는 대신 둥글게 이어 그린다(흐려 지우는 쪽). */
  const outlineOf = (secs: Array<{ x: number; ry: number; rz: number; bu?: number; bd?: number }>) => {
    const ups: P[] = [], dns: P[] = [];
    for (const c of secs) { const [u, d] = sideOf(c.x, c.ry, c.rz, c.bu ?? 0, c.bd ?? 0); ups.push(u); dns.push(d); }
    // 팔이 보는 쪽으로 누워 짧게 보이면(단축) 옆선이 엉킨다 — 단면 점들의 둥근 껍질로
    if (axL < 72) {
      const ring: P[] = [];
      for (const c of secs) for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; ring.push(s2([c.x, Math.cos(a) * c.ry, Math.sin(a) * c.rz])); }
      return { d: roundHull(ring, 1.5), ups, dns };
    }
    return { d: `${smoothOpen([...ups.slice().reverse(), ...dns])} Z`, ups, dns };
  };
  const wristX = glove ? -6 : -2;
  const sleeveOn = sleeveLen > 0;
  const armEnd = sleeveOn ? (glove ? -74 : -54) : -170;
  {
    const det: HandShape['details'] = [];
    let shape: string;
    if (glove) {
      // 장갑 목(짜임 고무단) — 손목에서 살짝 벌어지며 끝 입술이 물결. 세로 골(짜임)·가로 주름 둘.
      const secs = [{ x: 8, ry: 33, rz: 23 }, { x: wristX, ry: 30, rz: 20 }, { x: -20, ry: 32, rz: 22, bu: 1.5 }, { x: -42, ry: 35, rz: 25 }, { x: -62, ry: 38, rz: 28, bu: 1.2, bd: 1.5 }, { x: armEnd, ry: 39, rz: 29 }];
      const o = outlineOf(secs);
      shape = o.d;
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        if (facing([0, Math.cos(a), Math.sin(a)]) < 0.2) continue;
        det.push({ d: smoothOpen([s2([-24, Math.cos(a) * 32.5, Math.sin(a) * 22.5]), s2([-50, Math.cos(a) * 36.5, Math.sin(a) * 26.5]), s2([armEnd + 4, Math.cos(a) * 38.5, Math.sin(a) * 28.5])]), tone: 'light', w: 0.9 });
      }
      const seam = visibleArc(-22, 32.5, 22.5);
      if (seam.length > 2) det.push({ d: smoothOpen(seam), tone: 'mid', w: 1.1, dash: '3 2.5' });
      const lip = visibleArc(armEnd, 39, 29);
      if (lip.length > 2) det.push({ d: smoothOpen(lip.map((q, i) => [q[0] + Math.sin(i * 1.7) * 0.9, q[1] + Math.cos(i * 1.3) * 0.9] as P)), tone: 'dark', w: 1.3 });
      // 손목 접힘 주름
      const cr = visibleArc(wristX + 3, 30.5, 20.5);
      if (cr.length > 4) det.push({ d: smoothOpen(cr.slice(Math.floor(cr.length * 0.2), Math.ceil(cr.length * 0.75))), tone: 'mid', w: 1 });
    } else {
      // 맨팔 — 손목(좁음) → 아래팔(굵어짐). 자뼈 머리(새끼 쪽 손목 혹)·손목 금.
      const secs = [{ x: 12, ry: 32, rz: 17 }, { x: wristX, ry: 28, rz: 17.5 }, { x: -18, ry: 28.5, rz: 19, bd: 1.6 }, { x: -45, ry: 31, rz: 22 }, { x: -85, ry: 34, rz: 25 }, { x: -130, ry: 35.5, rz: 27 }, { x: -170, ry: 35, rz: 27 }].filter((c) => c.x >= armEnd - 1);
      if (secs[secs.length - 1]!.x > armEnd) secs.push({ x: armEnd, ry: 32 + Math.min(4, -armEnd / 40), rz: 22 + Math.min(5, -armEnd / 34) });
      const o = outlineOf(secs);
      shape = o.d;
      if (facing([0, -0.7, 0.7]) > 0.15) det.push({ d: smoothOpen([s2([-8, -25, 10]), s2([-14, -27.5, 12]), s2([-21, -26, 11])]), tone: 'light', w: 1 });
      // 손목 금(손바닥 쪽이 보일 때)
      const cr = visibleArc(wristX - 1, 26.5, 16.5);
      if (cr.length > 4 && facing([0, 0, -1]) > 0.1) det.push({ d: smoothOpen(cr.slice(Math.floor(cr.length * 0.3), Math.ceil(cr.length * 0.7))), tone: 'light', w: 0.9 });
      // 아래팔 근육 결(한 줄, 엄지 쪽)
      det.push({ d: smoothOpen([s2([-14, 22, 12]), s2([-50, 24, 17]), s2([Math.max(armEnd + 10, -100), 26, 20])]), tone: 'light', w: 0.9 });
    }
    const h: { h: string[]; h2: string[]; h3: string[] } = { h: [], h2: [], h3: [] };
    segHatch({ a: S([0, 0, 0]), b: S([armEnd, 0, 0]), ra: glove ? 31 : 24, rb: glove ? 38 : 30 }, hsp(5), h);
    const fadeArm = !sleeveOn ? { a: s2([armEnd * 0.55, 0, 0]), b: s2([armEnd, 0, 0]) } : undefined;
    parts.push({ shapes: [shape], groups: [{ shapes: [shape], hatch: h.h.join(' '), hatch2: lod ? h.h2.join(' ') : '', core: lod ? h.h3.join(' ') : '' }], details: det, nails: [], depth: 0, part: 'arm', box: boxOf([axA, axB]), ...(fadeArm ? { fade: fadeArm } : {}) });
  }
  // ── 소매(천) — 손목 위에 헐겁게 얹힌 소맷부리: 입술은 물결, 소맷부리 단(박음질 선), 끌림 주름(Z자), 먼 끝은 흐리게 사라진다(깡통 끝 금지).
  if (sleeveOn) {
    const x0 = armEnd + 18;
    const L = Math.max(60, sleeveLen);
    const secs: Array<{ x: number; ry: number; rz: number; bu?: number; bd?: number }> = [];
    const N = 7;
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = x0 - L * t;
      // 소맷부리는 팔보다 조금 크고, 위로 갈수록 헐렁 — 주름 자리에서 바깥선이 살짝 부푼다/들어간다
      const ry = 39 + 6 * Math.sqrt(t), rz = 32 + 5 * Math.sqrt(t);
      secs.push({ x, ry, rz, bu: Math.sin(i * 2.1 + 0.6) * 2.2, bd: Math.sin(i * 1.7 + 2.0) * 2.4 + (i === 1 ? 2 : 0) });
    }
    const o = outlineOf(secs);
    const det: HandShape['details'] = [];
    // 입술(보이는 쪽) — 천이라 물결, 안쪽 그늘(먼 쪽 안 테두리)
    const lip = visibleArc(x0, 39, 32);
    if (lip.length > 2) det.push({ d: smoothOpen(lip.map((q, i) => [q[0] + Math.sin(i * 1.9) * 1.4, q[1] + Math.cos(i * 1.4) * 1.4] as P)), tone: 'dark', w: 1.5 });
    const hem = visibleArc(x0 - 14, 40.5, 33.5);
    if (hem.length > 2) det.push({ d: smoothOpen(hem), tone: 'mid', w: 1, dash: '4 3' });
    // 끌림 주름 — 소맷부리에서 팔꿈치 쪽으로 비스듬히(위·아래 가장자리에서 안쪽으로 짧게)
    const fold = (x: number, a: number, len: number, tilt: number) => {
      const p0 = s2([x, Math.cos(a) * 42, Math.sin(a) * 35]), p1 = s2([x - len * 0.5, Math.cos(a + tilt * 0.5) * 41, Math.sin(a + tilt * 0.5) * 34]), p2 = s2([x - len, Math.cos(a + tilt) * 40, Math.sin(a + tilt) * 33]);
      return smoothOpen([p0, p1, p2]);
    };
    const frontA = Math.atan2(1, 0); // z+ 쪽(보는 쪽)
    for (const [x, da, len, tilt] of [[x0 - 26, -0.9, 34, 0.7], [x0 - 40, 0.8, 30, -0.6], [x0 - 62, -0.5, 36, 0.9], [x0 - 70, 1.1, 26, -0.5]] as const) {
      const a = frontA + da;
      if (facing([0, Math.cos(a), Math.sin(a)]) < 0.05) continue;
      det.push({ d: fold(x, a, len, tilt), tone: 'mid', w: 1.1 });
    }
    const h: { h: string[]; h2: string[]; h3: string[] } = { h: [], h2: [], h3: [] };
    segHatch({ a: S([x0, 0, 0]), b: S([x0 - L, 0, 0]), ra: 40, rb: 44 }, hsp(6), h);
    parts.push({ shapes: [o.d], groups: [{ shapes: [o.d], hatch: h.h.join(' '), hatch2: lod ? h.h2.join(' ') : '', core: '' }], details: det, nails: [], depth: 0, part: 'sleeve', box: boxOf([...o.ups, ...o.dns]), fade: { a: s2([x0 - L * 0.55, 0, 0]), b: s2([x0 - L, 0, 0]) } });
  }

  // ── 손바닥(B4) — 상자 껍질 대신 크기가 다른 공들의 껍질: 손가락 뿌리 관절 혹(손등)·뿌리 살(바닥), 새끼 두덩, 두툼한 엄지 두덩, 좁은 손목.
  //   손바닥은 얇다(손등 z≈+7, 바닥 z≈−9). 가로 아치(arch)로 검지·소지 뿌리가 손바닥 쪽으로 내려가 오목해진다.
  const thW = thPts.map(wristRot);
  {
    const discs: Array<{ p: V3; r: number }> = [];
    FINGERS.forEach((fd, i) => {
      const m = MCP[i]!;
      discs.push({ p: [m[0] - 3, m[1], m[2] + 2.5], r: fd.radii[0] + 1.2 + gx }); // 뿌리 관절 혹
      discs.push({ p: [m[0] - 10, m[1], m[2] - 6], r: fd.radii[0] * 0.95 + gx }); // 뿌리 살(바닥)
    });
    discs.push({ p: [62, -31, -3], r: 11 + gx }, { p: [36, -30, -4], r: 12.5 + gx }, { p: [14, -24, -2], r: 11 + gx }); // 새끼 쪽 두덩
    discs.push({ p: [58, 6, 6], r: 9 + gx }, { p: [40, -8, 5], r: 10 + gx }, { p: [20, 4, 4], r: 10 + gx }); // 손등 판
    discs.push({ p: [50, 4, -8], r: 10 + gx }, { p: [30, 0, -9], r: 11 + gx }); // 바닥 판
    discs.push({ p: [26, 19, -13], r: 15.5 + gx }, { p: [42, 25, -10], r: 12.5 + gx }); // 엄지 두덩(두툼)
    discs.push({ p: [2, 20, 0], r: 11 + gx }, { p: [2, -20, 0], r: 11 + gx }, { p: [2, 0, 6], r: 11 + gx }, { p: [2, 0, -6], r: 11 + gx }); // 손목
    const ring: P[] = [];
    for (const dsk of discs) { const q = s2(wristRot(dsk.p)); for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; ring.push([q[0] + Math.cos(a) * dsk.r, q[1] + Math.sin(a) * dsk.r]); } }
    const hh = hull2(ring);
    const pts2: P[] = [];
    for (const q of hh) { const last = pts2[pts2.length - 1]; if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 5) pts2.push(q); }
    const palmD = smoothClosed(pts2, 0.85);
    // 엄지 손허리뼈(두덩) — 캡슐 둘(두툼하게)
    const meta = capsule2(s2(thW[0]!), THUMB.radii[0] + gx, s2(thW[1]!), THUMB.radii[1] + gx);
    const metaPad = capsule2(s2(wristRot([20, 16, -12])), 14 + gx, s2(lerp3(thW[0]!, thW[1]!, 0.6)), THUMB.radii[1] + 1 + gx);
    const det: HandShape['details'] = [];
    const dorsalFacing = facing(wristDir([0, 0, 1]));
    if (dorsalFacing > 0.2 && !glove) {
      // 손등 — 힘줄 넷(손목 가운데에서 부채꼴로 각 뿌리 관절까지, 손등 높이를 따라 살짝 휨) + 뿌리 관절 혹 둘레
      FINGERS.forEach((fd, i) => {
        const m = MCP[i]!;
        const tn: 'light' | 'mid' = i === 1 || i === 0 ? 'mid' : 'light';
        det.push({ d: smoothOpen([s2(wristRot([16, m[1] * 0.28, 9.5])), s2(wristRot([46, m[1] * 0.62, 10.5])), s2(wristRot([m[0] - 13, m[1] * 0.96, m[2] + 9.6]))]), tone: tn, w: 0.85 });
        if (i < 3) {
          const arc: P[] = [];
          for (let k = 0; k <= 6; k++) { const v = -1.0 + (k / 6) * 2.0; arc.push(s2(wristRot([m[0] - 3 + Math.cos(v) * 2, m[1] + Math.sin(v) * (fd.radii[0] + 1), m[2] + 2.5 + Math.cos(v) * (fd.radii[0] + 1)]))); }
          if (facing(wristDir([0.3, 0, 1])) > 0.1) det.push({ d: smoothOpen(arc.slice(1, 6)), tone: 'light', w: 0.9 });
        }
      });
    }
    if (dorsalFacing > 0.2 && glove) {
      // 손등 천 주름 — 손목 쪽 가로 주름 둘 + 뿌리 관절 줄 접힘(진하게) + 박음질
      det.push({ d: smoothOpen([s2(wristRot([14, -26, 13 + gx])), s2(wristRot([18, -6, 14 + gx])), s2(wristRot([13, 16, 13 + gx]))]), tone: 'mid', w: 1.1 });
      det.push({ d: smoothOpen([s2(wristRot([24, -20, 13.5 + gx])), s2(wristRot([27, 0, 14 + gx])), s2(wristRot([22, 14, 13.5 + gx]))]), tone: 'light', w: 0.9 });
      FINGERS.forEach((fd, i) => {
        const m = MCP[i]!;
        for (const [dx, sp, tn, w] of [[-2, 0.9, 'dark', 1.3], [3, 0.6, 'mid', 1.1]] as const) {
          const arc: P[] = [];
          for (let k = 0; k <= 6; k++) { const v = -sp + (k / 6) * sp * 2 + (i % 2 ? 0.1 : -0.1); arc.push(s2(wristRot([m[0] + dx + Math.cos(v) * 1.5, m[1] + Math.sin(v) * (fd.radii[0] + gx + 1.5), m[2] + 2.5 + Math.cos(v) * (fd.radii[0] + gx + 1.5)]))); }
          det.push({ d: smoothOpen(arc), tone: tn, w });
        }
      });
      det.push({ d: smoothOpen([s2(wristRot([46, -14, 13 + gx])), s2(wristRot([66, -6, 12.5 + gx]))]), tone: 'light', w: 0.9 });
      const seam: P[] = [];
      for (let k = 0; k <= 8; k++) { const yy = -34 + k * 8.5; seam.push(s2(wristRot([70 + Math.cos(k / 8 * Math.PI) * 4, yy, 12 + gx]))); }
      det.push({ d: smoothOpen(seam), tone: 'mid', w: 1.1, dash: '4 3' });
    }
    if (dorsalFacing < -0.2) {
      // 손바닥 금 — 생명선(엄지 두덩 둘레)·감정선·두뇌선
      det.push({ d: smoothOpen([s2(wristRot([86, 30, -12])), s2(wristRot([62, 16, -13])), s2(wristRot([38, 8, -14])), s2(wristRot([12, 10, -12]))]), tone: 'mid', w: 1.1 });
      det.push({ d: smoothOpen([s2(wristRot([84, -34, -12])), s2(wristRot([80, -12, -13])), s2(wristRot([84, 10, -13])), s2(wristRot([90, 22, -12]))]), tone: 'mid', w: 1.1 });
      det.push({ d: smoothOpen([s2(wristRot([70, -30, -12])), s2(wristRot([68, -6, -13])), s2(wristRot([74, 18, -13]))]), tone: 'light', w: 1 });
    }
    const allPts = pts2.concat([s2(thW[0]!), s2(thW[1]!)]);
    const h: { h: string[]; h2: string[]; h3: string[] } = { h: [], h2: [], h3: [] };
    segHatch({ a: S(wristRot([10, 0, 0])), b: S(wristRot([92, 0, 0])), ra: 26 + gx, rb: 32 + gx }, hsp(5), h, { h: glove ? 0.15 : -0.02, h2: glove ? -0.12 : -0.28 });
    parts.push({ shapes: [palmD, meta, metaPad], groups: [{ shapes: [palmD, meta, metaPad], hatch: h.h.join(' '), hatch2: lod ? h.h2.join(' ') : '', core: lod ? h.h3.join(' ') : '' }], details: det, nails: [], depth: S(wristRot([50, 0, 0]))[2], part: 'palm', box: boxOf(allPts) });
  }

  // ── 손가락 넷 + 엄지
  const fingerPart = (pts: V3[], dors: V3[], radii: number[], kind: 'finger' | 'thumb', flexes: number[]) => {
    const r = radii.map((x) => x + gx);
    if (glove) r[3] = Math.max(r[3]!, r[2]! * 0.95);
    // (B4) 나무 인형 같은 원통 마디 대신 — 가운데 선을 마디에서 둥글게 굽히고(베지어), 굵기는 끝으로 차츰 가늘게,
    // 손등 쪽 마디는 살짝 각진 혹(관절), 바닥 쪽은 마디 사이 살(지문 볼록) + 손끝 살(손톱보다 앞으로 나온 둥근 끝).
    const nSeg = pts.length - 1;
    const SUB = 4;
    const center = (i: number, t: number): V3 => {
      const a = pts[i]!, b = pts[i + 1]!;
      if (t < 0.25 && i > 0) { const P0 = lerp3(pts[i - 1]!, a, 0.75), P2 = lerp3(a, b, 0.25), u = 0.5 + (t / 0.25) * 0.5; return add(add(mul(P0, (1 - u) ** 2), mul(a, 2 * u * (1 - u))), mul(P2, u * u)); }
      if (t > 0.75 && i < nSeg - 1) { const c = pts[i + 2]!, P0 = lerp3(a, b, 0.75), P2 = lerp3(b, c, 0.25), u = ((t - 0.75) / 0.25) * 0.5; return add(add(mul(P0, (1 - u) ** 2), mul(b, 2 * u * (1 - u))), mul(P2, u * u)); }
      return lerp3(a, b, t);
    };
    const dorAt = (i: number) => dors[Math.min(dors.length - 1, i)]!;
    const nodes: Array<{ p: V3; r: number; seg: number }> = [];
    for (let i = 0; i < nSeg; i++) {
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB;
        const rr = r[i]! + (r[i + 1]! - r[i]!) * t;
        const waist = glove ? 1 - 0.03 * Math.sin(Math.PI * t) : 1 - 0.07 * Math.sin(Math.PI * t);
        nodes.push({ p: center(i, t), r: rr * waist, seg: i });
      }
    }
    const tipC = pts[nSeg]!;
    nodes.push({ p: tipC, r: r[nSeg]! * (glove ? 1 : 0.97), seg: nSeg - 1 });
    // 덧살 — 손등 쪽 관절 혹, 바닥 쪽 마디 살, 손끝 살
    const extra: Array<{ p: V3; r: number; seg: number }> = [];
    for (let j = 1; j < nSeg; j++) extra.push({ p: add(pts[j]!, mul(nrm(add(dorAt(j - 1), dorAt(j))), r[j]! * (glove ? 0.1 : 0.16))), r: r[j]! * 0.9, seg: j });
    for (let i = 0; i < nSeg; i++) extra.push({ p: add(lerp3(pts[i]!, pts[i + 1]!, 0.55), mul(dorAt(i), -(r[i]! + r[i + 1]!) * 0.5 * (glove ? 0.06 : 0.13))), r: (r[i]! + r[i + 1]!) * 0.5 * 0.9, seg: i });
    {
      const ax = nrm(sub(pts[nSeg]!, pts[nSeg - 1]!));
      extra.push({ p: add(add(tipC, mul(dorAt(nSeg - 1), -r[nSeg]! * 0.12)), mul(ax, r[nSeg]! * 0.05)), r: r[nSeg]! * 0.84, seg: nSeg - 1 });
    }
    // 마디마다 덩어리. 굽힘이 크면(>48°) 새 덩어리 — 깊이 순으로 겹쳐 그려 접힌 마디가 보이게.
    const shapes: string[] = [];
    const groups: Array<{ shapes: string[]; hatch: string; hatch2: string; core: string; depth: number }> = [];
    let cur: { shapes: string[]; h: string[]; h2: string[]; h3: string[]; z: number[] } | null = null;
    let curSeg = -1;
    const flush = () => { if (cur) groups.push({ shapes: cur.shapes, hatch: cur.h.join(' '), hatch2: lod ? cur.h2.join(' ') : '', core: lod ? cur.h3.join(' ') : '', depth: cur.z.reduce((a, b) => a + b, 0) / cur.z.length }); };
    const segOf = new Map<number, number>(); // seg → group index (덧살을 같은 덩어리에)
    for (let i = 0; i < nodes.length - 1; i++) {
      const sg = nodes[i]!.seg;
      if (sg !== curSeg && (cur === null || (flexes[sg] ?? 0) > 48)) { flush(); cur = { shapes: [], h: [], h2: [], h3: [], z: [] }; }
      curSeg = sg;
      segOf.set(sg, groups.length);
      const a = S(nodes[i]!.p), b = S(nodes[i + 1]!.p);
      const sh = capsule2([a[0], a[1]], nodes[i]!.r, [b[0], b[1]], nodes[i + 1]!.r);
      shapes.push(sh);
      const hh: { h: string[]; h2: string[]; h3: string[] } = { h: [], h2: [], h3: [] };
      // 손가락 빗금 — 그늘 쪽만(밝은 쪽 고리 금지: 둘레를 다 감으면 선반으로 깎은 나무 인형이 된다)
      if (i % 2 === 0) segHatch({ a, b: S(nodes[Math.min(nodes.length - 1, i + 2)]!.p), ra: nodes[i]!.r, rb: nodes[Math.min(nodes.length - 1, i + 2)]!.r }, hsp(glove ? 4.2 : 4.4), hh, { h: glove ? 0.2 : 0.08, h2: glove ? -0.1 : -0.22, core: glove });
      cur!.shapes.push(sh); cur!.h.push(...hh.h); cur!.h2.push(...hh.h2); cur!.h3.push(...hh.h3); cur!.z.push((a[2] + b[2]) / 2);
    }
    flush();
    // 덧살 원 — 그 마디 덩어리에 넣는다(실루엣만 넓힘)
    for (const e of extra) {
      const q = S(e.p);
      const c = `M ${f1(q[0] - e.r)} ${f1(q[1])} a ${f1(e.r)} ${f1(e.r)} 0 1 0 ${f1(2 * e.r)} 0 a ${f1(e.r)} ${f1(e.r)} 0 1 0 ${f1(-2 * e.r)} 0 Z`;
      const gi = Math.min(groups.length - 1, segOf.get(e.seg) ?? groups.length - 1);
      groups[gi]!.shapes.push(c);
      shapes.push(c);
    }
    groups.sort((a, b) => a.depth - b.depth);
    const det: HandShape['details'] = [];
    const nails: string[] = [];
    // 마디 주름 / 손톱
    const n = pts.length;
    for (let j = 1; j < n - 1; j++) {
      const ds = dirToScreen(B, (dors[j - 1]!));
      const ds2 = dirToScreen(B, (dors[j]!));
      const dn = nrm(add(ds, ds2));
      const a = pts[j - 1]!, b = pts[j]!, c = pts[j + 1]!;
      if (dn[2] > 0.15 && glove) {
        // 장갑 — 마디 위 천 주름(불규칙한 호 서넛, 마디 둘레를 반쯤 감음)
        // (B4) 더 진하게 — 가운데 접힘은 6B 쪽(dark, 굵게), 둘레 주름 다섯, 앞뒤로 엇갈려 천이 접힌 느낌
        for (const [off, span, tn, w] of [[-5.5, 0.5, 'light', 1], [-3, 0.8, 'mid', 1.2], [-0.6, 1.0, 'dark', 1.35], [1.8, 0.85, 'mid', 1.2], [4.6, 0.55, 'light', 1]] as const) {
          const t = off / len3(sub(c, b));
          const p0 = lerp3(b, c, Math.max(-0.3, Math.min(0.4, t)));
          const arc: P[] = [];
          for (let k = 0; k <= 6; k++) { const v = -span + (k / 6) * span * 2 + (j % 2 ? 0.12 : -0.1) + Math.sin(off * 1.7) * 0.08; arc.push(s2(add(p0, mul(nrm(add(mul(dors[j]!, Math.cos(v)), mul(nrm(cross(nrm(sub(c, b)), dors[j]!)), Math.sin(v)))), r[j]! * 1.0 + 0.4)))); }
          det.push({ d: smoothOpen(arc), tone: tn, w });
        }
      } else if (dn[2] > 0.15 && !glove) {
        // 손등 쪽 마디 주름 — 짧은 호 두세 개(관절 위 겹친 살)
        for (const [off, span] of [[-2.2, 0.42], [0.4, 0.55], [2.8, 0.36]] as const) {
          const t = off / len3(sub(c, b));
          const p0 = lerp3(b, c, Math.max(-0.2, Math.min(0.3, t)));
          const arc: P[] = [];
          for (let k = 0; k <= 6; k++) { const v = -span + (k / 6) * span * 2; arc.push(s2((add(p0, mul(nrm(add(mul(dors[j]!, Math.cos(v)), mul(nrm(cross(nrm(sub(c, b)), dors[j]!)), Math.sin(v)))), r[j]! * 0.98))))); }
          det.push({ d: smoothOpen(arc), tone: j === 1 ? 'mid' : 'light', w: 1 });
        }
      } else if (dn[2] < -0.15) {
        // 바닥 쪽 마디 금 — 한 줄
        const arc: P[] = [];
        for (let k = 0; k <= 6; k++) { const v = -0.8 + (k / 6) * 1.6; arc.push(s2((add(b, mul(nrm(add(mul(dors[j]!, -Math.cos(v)), mul(nrm(cross(nrm(sub(c, b)), dors[j]!)), Math.sin(v)))), r[j]! * 0.98))))); }
        det.push({ d: smoothOpen(arc), tone: 'mid', w: 1.1 });
      }
    }
    // 손톱 — 끝 마디 손등 쪽
    const dTip = dors[dors.length - 1]!;
    const dTipS = dirToScreen(B, (dTip));
    const a = pts[n - 2]!, b = pts[n - 1]!;
    const segLen = len3(sub(b, a)) + r[n - 1]! * 0.9;
    const ax = nrm(sub(b, a));
    const side = nrm(cross(ax, dTip));
    if (!glove && dTipS[2] > 0.22) { // 비스듬히 옆에서 보이는 손톱은 네모로 뭉개져 그리지 않는다
      const rr = r[n - 1]! * 1.02;
      const at = (u: number, v: number): P => s2((add(add(a, mul(ax, u * segLen)), mul(add(mul(dTip, Math.cos(v)), mul(side, Math.sin(v))), rr + 0.4))));
      const out: P[] = [];
      // (B4) 손톱은 작게(끝 마디 반쯤) — 손끝 살이 손톱 앞·옆으로 둥글게 남는다
      for (let k = 0; k <= 6; k++) out.push(at(0.52, -0.56 + (k / 6) * 1.12));
      for (let k = 0; k <= 4; k++) out.push(at(0.52 + (k / 4) * 0.33, 0.6));
      for (let k = 0; k <= 6; k++) out.push(at(0.87 + Math.sin((k / 6) * Math.PI) * 0.035, 0.6 - (k / 6) * 1.2));
      for (let k = 0; k <= 4; k++) out.push(at(0.85 - (k / 4) * 0.33, -0.6));
      nails.push(smoothOpen(out) + ' Z');
      const cut: P[] = [];
      for (let k = 0; k <= 6; k++) cut.push(at(0.47, -0.66 + (k / 6) * 1.32));
      det.push({ d: smoothOpen(cut), tone: 'light', w: 0.9 });
    }
    if (glove) {
      // 손가락 옆 솔기(보이는 쪽)
      for (const sgn of [1, -1]) {
        const sd = dirToScreen(B, (nrm(cross(nrm(sub(pts[1]!, pts[0]!)), dors[0]!))));
        if (sd[2] * sgn < 0.1) continue;
        const line: P[] = [];
        for (let j = 0; j < n - 1; j++) {
          const p0 = pts[j]!, p1 = pts[j + 1]!;
          const sideJ = nrm(cross(nrm(sub(p1, p0)), dors[j]!));
          for (const t of [0.15, 0.85]) line.push(s2((add(lerp3(p0, p1, t), mul(sideJ, sgn * (r[j]! + 0.3))))));
        }
        det.push({ d: smoothOpen(line), tone: 'mid', w: 1, dash: '3.5 3' });
      }
      // 끝 마디 덧댐(장갑 손끝 천)
      const capArc: P[] = [];
      for (let k = 0; k <= 6; k++) { const v = -1.3 + (k / 6) * 2.6; capArc.push(s2((add(lerp3(a, b, 0.25), mul(add(mul(dTip, Math.cos(v)), mul(side, Math.sin(v))), r[n - 2]! + 0.3))))); }
      if (dTipS[2] > -0.2) det.push({ d: smoothOpen(capArc), tone: 'mid', w: 1.1 });
    }
    const all2 = nodes.map((q) => s2(q.p));
    const depth = nodes.reduce((s, q) => s + S(q.p)[2], 0) / nodes.length;
    parts.push({ shapes, groups, details: det, nails, depth, part: kind, box: { x0: Math.min(...all2.map((q) => q[0])) - 12, y0: Math.min(...all2.map((q) => q[1])) - 12, x1: Math.max(...all2.map((q) => q[0])) + 12, y1: Math.max(...all2.map((q) => q[1])) + 12 } });
  };
  fch.forEach((c, i) => fingerPart(c.pts.map(wristRot), c.dors.map(wristDir), FINGERS[i]!.radii, 'finger', [0, fp[i]!.pip, fp[i]!.dip]));
  // 엄지(손허리뼈는 손바닥 판에 — 첫 마디부터)
  const ipFlex = Math.acos(Math.max(-1, Math.min(1, dot(td[1], td[2])))) / D2R;
  fingerPart(thW.slice(1), thDors.slice(1).map(wristDir), THUMB.radii.slice(1), 'thumb', [0, ipFlex]);
  const tip = s2(tipOf(0));

  // 먼 것부터. 소매는 늘 맨 뒤, 아래팔은 그다음.
  const order = parts.map((p, i) => ({ p, i, k: p.part === 'arm' ? -1e6 : p.part === 'sleeve' ? -1e5 : p.depth }));
  order.sort((a, b) => a.k - b.k);
  const sorted = order.map((o) => o.p);
  const front = new Set<number>();
  sorted.forEach((p, i) => {
    if (def.front === 'all') front.add(i);
    else if ((p.part === 'finger' && def.front.includes('fingers')) || (p.part === 'thumb' && def.front.includes('thumb')) || (p.part === 'palm' && def.front.includes('palm'))) front.add(i);
  });
  return { parts: sorted, front, tip, gripR: def.gripR ?? 0, size: 190 };
}
