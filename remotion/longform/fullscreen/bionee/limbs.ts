// 비온이 손·장화 모양(순수) — 손은 손바닥 원 + 손가락 셋 + 엄지(둥근 막대), 장화는 3D 단면을 돌려 투영한 볼록 껍질. 2026-10-23.
import type { HandShape } from './pose';
import { proj, type P, type View } from './geom';

export type Capsule = { a: P; b: P; w: number };
export type HandGeom = { palm: { c: P; r: number }; fingers: Capsule[]; thumb: Capsule; tips: P[] };

/**
 * 손(손목 = 원점, +x = 손이 향하는 쪽, 엄지는 -y 쪽). R = 손바닥 반지름.
 * 손가락 굽힘 c 가 크면 짧아지고 손바닥 쪽으로 말려 주먹 마디처럼 보인다.
 */
export function handGeom(s: HandShape, R: number): HandGeom {
  const pc: P = [R * 0.8, 0];
  const cs = [s.c0, s.c1, s.c2];
  const fingers: Capsule[] = [];
  const tips: P[] = [];
  for (let i = 0; i < 3; i++) {
    const phi = (i - 1) * 0.36 * (0.35 + s.spread) + 0.1;
    const c = cs[i]!;
    const base: P = [pc[0] + Math.cos(phi) * R * 0.5, pc[1] + Math.sin(phi) * R * 0.5];
    const dirA = phi + c * 1.05;
    const len = R * (1.22 - (i === 2 ? 0.12 : 0) - 0.9 * c);
    const tip: P = [base[0] + Math.cos(dirA) * len, base[1] + Math.sin(dirA) * len];
    fingers.push({ a: base, b: tip, w: R * (0.66 - 0.04 * i) });
    tips.push(tip);
  }
  const ta = (-s.thumbAng * Math.PI) / 180;
  const tb: P = [pc[0] + Math.cos(ta * 0.85) * R * 0.45, pc[1] + Math.sin(ta * 0.85) * R * 0.62];
  const tl = R * 0.98 * (1 - 0.55 * s.thumbCurl);
  const tt: P = [tb[0] + Math.cos(ta + s.thumbCurl * 0.9) * tl, tb[1] + Math.sin(ta + s.thumbCurl * 0.9) * tl];
  return { palm: { c: pc, r: R }, fingers, thumb: { a: tb, b: tt, w: R * 0.6 }, tips };
}

/** 손 좌표 → 화면: 손목 W, 각 ang(라디안), flip(±1, 엄지 쪽). */
export const handXf = (W: P, ang: number, flip: number) => (q: P): P => {
  const x = q[0], y = q[1] * flip;
  return [W[0] + x * Math.cos(ang) - y * Math.sin(ang), W[1] + x * Math.sin(ang) + y * Math.cos(ang)];
};

/** 엄지가 위(또는 몸 안쪽)를 보게 하는 flip. */
export function autoFlip(s: HandShape, ang: number, side: -1 | 1): 1 | -1 {
  const ta = (-s.thumbAng * Math.PI) / 180;
  const score = (fl: number) => {
    const dy = Math.sin(ang) * Math.cos(ta) + Math.cos(ang) * Math.sin(ta) * fl;
    const dx = Math.cos(ang) * Math.cos(ta) - Math.sin(ang) * Math.sin(ta) * fl;
    return -dy + 0.45 * -side * dx;
  };
  return score(1) >= score(-1) ? 1 : -1;
}

// ── 장화 ─────────────────────────────────────────────

/**
 * 장화 단면 [높이 h, 앞뒤 중심 zc, 앞 길이, 뒤 길이, 반폭] — 2026-10-23 다듬기: 깡통처럼 보이던 것을 진짜 고무 장화로.
 * 밑창(앞창 + 굽 — 사이에 오목한 장심 틈) → 둥근 앞코가 낮게 나온 발등 → 좁아지는 발목 → 위로 살짝 벌어지는 목 → 테 띠.
 */
type Sec = [number, number, number, number, number];
const FOOT_SECTIONS: Sec[] = [[4, 0, 45, 22, 24], [9, 0, 45.5, 22, 24.5], [14, 0, 40, 21, 23], [19, 0, 29, 20, 20.5], [23, -2, 18, 18.5, 18.5]];
const SHAFT_SECTIONS: Sec[] = [[22, -4, 15, 17, 17.2], [27, -4, 14, 16.5, 16.4], [34, -4, 16, 18.5, 18.6]];
const BAND_SECTIONS: Sec[] = [[32, -4, 17.6, 20.1, 20.1], [39, -4, 18.1, 20.6, 20.6]];
const SOLE_SECTIONS: Sec[] = [[0, 4, 44, 6, 25], [4.5, 4, 45.5, 6, 26]];
const HEEL_SECTIONS: Sec[] = [[0, -15, 7, 9, 21], [7, -15, 7.5, 9.5, 21.6]];
/** 장화 위 끝(테 띠 윗면) 높이 — 단면 단위. */
export const BOOT_TOP_H = 39;
export const BOOT_SOLE_H = 4.5;

/** 볼록 껍질(Andrew monotone chain). */
export function hull(pts: P[]): P[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P[] = [], up: P[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

export type BootPose = { cx: number; cz: number; lift: number; fwd: number; toeUp: number; squash: number; toeYaw?: number };
export type BootGeom = {
  outline: P[]; foot: P[]; shaft: P[]; band: P[]; sole: P[]; heel: P[]; opening: P[]; upper: P[]; toeCap: P[]; cuff: P[]; bandTop: P[];
  toeVis: number; top: P; depth: number; snow: P[];
};

/**
 * 장화 하나 — 몸 좌표의 발 자리(cx, cz), 들림(lift), 앞뒤 밀림(fwd, 앞코 방향), 앞코 들림(toeUp 라디안, 뒤꿈치 축), 눌림(squash).
 * 앞코 방향 = 몸이 보는 쪽(yaw). 옆모습이면 장화 옆 실루엣(앞코가 툭 나오고 굽이 있는 모양)이 저절로 나온다.
 * 덩이(밑창·굽·발등·목·테 띠)마다 볼록 껍질 — 하나로 감싸면 발목이 잘록해지지 않는다.
 */
export function bootGeom(v0: View, b: BootPose): BootGeom {
  // 만화식 속임 — 장화는 조금 더 위에서 본다(둥근 앞코가 보이게)
  const v: View = { yaw: v0.yaw, alpha: v0.alpha + 0.3 };
  const yw = v.yaw + (b.toeYaw ?? 0);
  const cy = Math.cos(yw), sy = Math.sin(yw);
  const sq = b.squash;
  const c = proj(v0, b.cx, 0, b.cz);
  const ca = Math.cos(b.toeUp), sa = Math.sin(b.toeUp);
  const pt = (x: number, z: number, h: number): P => {
    // 앞코 들림 — 굽 뒤끝(z = -24, h = 0) 축으로 돌림
    const zz0 = z + 24;
    const zz = zz0 * ca - h * sa - 24, hh = zz0 * sa + h * ca;
    const K = 1.14;
    const xs = K * x * (1 + sq * 0.45), zs = K * (zz + b.fwd / K) * (1 + sq * 0.35), hs = K * hh * (1 - sq) + b.lift;
    // 발 자리는 몸과 같은 보기로, 장화 모양(자리에서의 차이)만 더 위에서 본 보기로
    const o = proj(v, xs * cy + zs * sy, hs, -xs * sy + zs * cy);
    return [c[0] + o[0], c[1] + o[1]] as P;
  };
  const ring = (s: Sec, n = 18, t0 = 0, t1 = Math.PI * 2): P[] => {
    const [h, zc, f, bk, w] = s;
    const full = t1 - t0 >= Math.PI * 2;
    return Array.from({ length: n }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / (n - (full ? 0 : 1));
      const z = zc + Math.sin(t) * (Math.sin(t) > 0 ? f : bk);
      return pt(Math.cos(t) * w, z, h);
    });
  };
  const hullOf = (secs: Sec[]) => hull(secs.flatMap((s) => ring(s)));
  const foot = hullOf(FOOT_SECTIONS);
  const shaft = hullOf(SHAFT_SECTIONS);
  const band = hullOf(BAND_SECTIONS);
  const sole = hullOf(SOLE_SECTIONS);
  const heel = hullOf(HEEL_SECTIONS);
  const all = [...FOOT_SECTIONS, ...SHAFT_SECTIONS, ...BAND_SECTIONS, ...SOLE_SECTIONS, ...HEEL_SECTIONS].flatMap((s) => ring(s));
  const opening = ring([BOOT_TOP_H, -4, 15, 17.5, 17.4], 22);
  // 앞코 덮개 선(발등 h 12 의 앞쪽 반원) · 발목 주름 · 테 띠 아랫선
  const toeCap = ring([10, 0, 41, 21, 22], 14, Math.PI * 0.22, Math.PI * 0.78);
  const cuff = ring([BAND_SECTIONS[0]![0], -4, 17.7, 20.2, 20.2], 16, Math.PI * 0.02, Math.PI * 0.98);
  const bandTop = ring([BOOT_TOP_H, -4, 18.1, 20.6, 20.6], 22);
  const fwdZ = Math.cos(yw); // 앞코가 카메라 쪽이면 1
  const top = pt(0, -4, BOOT_TOP_H);
  // 눈(겨울) — 앞코 위·테 띠 위
  const snow = [pt(-7, 30, 15), pt(9, 18, 21), pt(-6, 8, BOOT_TOP_H + 1)];
  return { outline: hull(all), foot, shaft, band, sole, heel, opening, upper: foot, toeCap, cuff, bandTop, toeVis: Math.max(0, Math.min(1, (fwdZ + 0.2) * 1.6)), top, depth: b.cz, snow };
}
