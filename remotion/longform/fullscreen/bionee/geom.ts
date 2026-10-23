// 비온이(코드로 그린 화분 마스코트) 모양 계산 — 순수(React 없음). 2026-10-23.
// 좌표 = 캐릭터 로컬: 원점 = 두 발 사이 땅, x 오른쪽, y 아래(SVG). 키 ≈ 520(잎 끝까지). 화면에 올릴 때 scale 로 줄인다.
// 화분은 회전체(둥근 화분)라 가짜 3D 가 쉽다: 몸통·테두리는 높이마다 원(링)을 투영한 타원의 겉선(포락선),
// 얼굴·팔·발·잎은 몸 표면의 방위각(az)에 붙어 있어 turn(좌우 돌기)에 따라 표면을 따라 옮겨 가고 뒤로 가면 가려진다.
import { random } from 'remotion';

export type P = [number, number];
const D2R = Math.PI / 180;

/** 카메라가 내려다보는 각(라디안) — 테두리 위 타원 비율 ≈ sin(0.14) ≈ 0.14(개념 그림과 같게). */
export const ALPHA0 = 0.14;

/** 몸통 옆모습(반지름 r, 높이 h) — 아래 둥근 모서리 → 위로 넓어진다. 개념 그림 640 캔버스에서 잰 비율. */
const BODY_PROFILE: Array<[number, number]> = [[86, 30], [111, 35], [127, 47], [138, 70], [146, 102], [151, 140], [155, 180], [158, 222]];
export const BODY_H0 = 30;
export const BODY_H1 = 222;
/** 테두리(말린 전) — 아래 h 206 ~ 위 h 284, 바깥 반지름(아래 말린 볼록 → 위). */
export const RIM = { h0: 216, h1: 284, rIn: 154, soilH: 272 } as const;
const RIM_PROFILE: Array<[number, number]> = [[165, 216], [171, 221], [173, 232], [173, 256], [175, 272], [176, 284]];

/** 얼굴 자리(몸 표면 높이) — 눈·볼·입. */
export const FACE = { eyeH: 150, eyeAz: 22, cheekH: 122, cheekAz: 37, mouthH: 124, browH: 178 } as const;
/** 어깨 높이·방위. 팔 길이(위팔·아래팔). 손 반지름. */
export const ARM = { h: 152, l1: 29, l2: 29, w: 24, handR: 20 } as const;
/** 발 — 방위 ±40°, 몸 중심에서 반지름 98, 크기. */
export const FOOT = { az: 40, r: 98, rx: 31, ry: 22, h: 20 } as const;
/** 식물 — 줄기 밑(흙), 혹, 갈림, 잎 크기. */
/** 2026-10-23 다듬기: 잎 228×66(가늘고 길쭉) → 196×70(개념 그림처럼 통통한 넓은 타원). */
export const PLANT = { baseH: 272, bumpH: 330, forkH: 372, leafL: 196, leafW: 70 } as const;

function interpProfile(prof: Array<[number, number]>, h: number): number {
  if (h <= prof[0]![1]) return prof[0]![0];
  for (let i = 1; i < prof.length; i++) {
    const [r1, h1] = prof[i]!; const [r0, h0] = prof[i - 1]!;
    if (h <= h1) {
      // 부드럽게(smoothstep 보간 + 이웃 기울기 섞음)
      const t = (h - h0) / (h1 - h0);
      const s = t * t * (3 - 2 * t);
      return r0 + (r1 - r0) * (0.5 * t + 0.5 * s);
    }
  }
  return prof[prof.length - 1]![0];
}
export const bodyR = (h: number) => interpProfile(BODY_PROFILE, h);
export const rimR = (h: number) => interpProfile(RIM_PROFILE, h);

/** 보기 — yaw(라디안, +면 얼굴이 화면 오른쪽으로), alpha(내려다보는 각 + 앞으로 숙임). */
export type View = { yaw: number; alpha: number };
export const makeView = (turn: number, pitch: number): View => ({ yaw: turn * Math.PI / 2, alpha: ALPHA0 + pitch });

/** 몸 좌표(X 오른쪽, H 위, Z 카메라 쪽) → 화면 로컬(x, y 아래). */
export function proj(v: View, X: number, H: number, Z: number): P {
  return [X, -H * Math.cos(v.alpha) + Z * Math.sin(v.alpha)];
}
/** 몸 표면 위 점(몸 기준 방위각 azDeg, 높이 h, 반지름 r) → 화면 점 + 앞쪽 정도(cos, 1 = 정면, <0 = 뒤). */
export function surf(v: View, azDeg: number, h: number, r: number): { p: P; z: number; az: number } {
  const az = azDeg * D2R + v.yaw;
  return { p: proj(v, r * Math.sin(az), h, r * Math.cos(az)), z: Math.cos(az), az };
}

/** 링 여럿의 투영 타원 겉선(닫힌 다각형) — 위 경계(왼→오) + 아래 경계(오→왼). */
function ringsOutline(v: View, rings: Array<[number, number]>, n = 64): { pts: P[]; upper: P[]; lower: P[] } {
  const R = Math.max(...rings.map((q) => q[0]));
  const sa = Math.sin(v.alpha), ca = Math.cos(v.alpha);
  const upper: P[] = [], lower: P[] = [];
  for (let i = 0; i <= n; i++) {
    const x = -R * Math.cos((Math.PI * i) / n);
    let lo = -Infinity, up = Infinity;
    for (const [r, h] of rings) {
      if (Math.abs(x) > r) continue;
      const cy = -h * ca, ry = r * Math.abs(sa);
      const k = Math.sqrt(Math.max(0, 1 - (x * x) / (r * r)));
      lo = Math.max(lo, cy + ry * k);
      up = Math.min(up, cy - ry * k);
    }
    if (lo === -Infinity) { const r0 = rings.reduce((a, b) => (b[0] > a[0] ? b : a)); lo = up = -r0[1] * ca; }
    upper.push([x, up]); lower.push([x, lo]);
  }
  return { pts: [...upper, ...lower.slice().reverse()], upper, lower };
}

/** 몸통 겉선. */
export function bodyOutline(v: View) {
  const rings: Array<[number, number]> = [];
  for (let h = BODY_H0; h <= BODY_H1 + 0.1; h += 5) rings.push([bodyR(h), h]);
  return ringsOutline(v, rings);
}
/** 테두리 겉선(옆 띠). */
export function rimOutline(v: View) {
  const rings: Array<[number, number]> = [];
  for (let h = RIM.h0; h <= RIM.h1 + 0.1; h += 3) rings.push([rimR(h), h]);
  return ringsOutline(v, rings);
}
/** 높이 h 링의 투영 타원(중심·반지름). */
export function ringEllipse(v: View, h: number, r: number): { cx: number; cy: number; rx: number; ry: number } {
  return { cx: 0, cy: -h * Math.cos(v.alpha), rx: r, ry: r * Math.abs(Math.sin(v.alpha)) };
}
/** 타원 호(점 목록) — t0~t1(라디안, 0 = 오른쪽, π/2 = 앞(아래)). */
export function ellipseArc(e: { cx: number; cy: number; rx: number; ry: number }, t0: number, t1: number, n = 28): P[] {
  return Array.from({ length: n + 1 }, (_, i) => { const t = t0 + ((t1 - t0) * i) / n; return [e.cx + e.rx * Math.cos(t), e.cy + e.ry * Math.sin(t)] as P; });
}

// ── 선(연필) ───────────────────────────────────────────

/** 결정적 잡음(시드 문자열 + 정수) → -0.5..0.5 */
export const rn = (seed: string, i: number | string) => random(`${seed}:${i}`) - 0.5;

/** 점 목록을 저주파로 흔든다(손 떨림) — 이웃끼리 이어지게 매끄러운 잡음. */
export function wobble(pts: P[], seed: string, amt: number, period = 7): P[] {
  if (amt <= 0) return pts;
  return pts.map((p, i) => {
    const k = i / period, k0 = Math.floor(k), t = k - k0, s = t * t * (3 - 2 * t);
    const nx = rn(seed, `x${k0}`) * (1 - s) + rn(seed, `x${k0 + 1}`) * s;
    const ny = rn(seed, `y${k0}`) * (1 - s) + rn(seed, `y${k0 + 1}`) * s;
    return [p[0] + nx * amt, p[1] + ny * amt] as P;
  });
}

/** 빛(왼쪽 위)의 반대 방향 — 이쪽을 향한 선이 굵다. */
const AWAY: P = [0.6, 0.8];

/**
 * 굵기가 변하는 선(채운 리본). pts 를 따라, 바깥 법선이 빛 반대(오른쪽 아래)를 향할수록 굵게(연필을 눌러 그은 그늘 쪽 선).
 * closed 면 닫힌 고리(evenodd 로 채움), 열린 선은 끝을 가늘게.
 */
export function ribbon(pts: P[], w: number, opts: { closed?: boolean; vary?: number; taperEnds?: number; seed?: string } = {}): string {
  const { closed = false, vary = 0.75, taperEnds = 0.25, seed = 'rb' } = opts;
  const n = pts.length;
  if (n < 2) return '';
  // 방향(시계/반시계)으로 바깥 법선 부호 결정
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i]!, b = pts[(i + 1) % n]!; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = closed ? (area > 0 ? -1 : 1) : 1;
  const L: P[] = [], R: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - 1 + n) % n]! : pts[Math.max(0, i - 1)]!;
    const b = closed ? pts[(i + 1) % n]! : pts[Math.min(n - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (dy / len) * sgn, ny = (-dx / len) * sgn;
    const d = closed ? nx * AWAY[0] + ny * AWAY[1] : Math.abs(nx * AWAY[0] + ny * AWAY[1]);
    let ww = w * (1 - vary * 0.45 + vary * 0.55 * Math.max(0, d) + rn(seed, i) * 0.18);
    if (!closed && taperEnds > 0) {
      const t = i / (n - 1);
      const e = Math.min(t, 1 - t) / taperEnds;
      ww *= 0.35 + 0.65 * Math.min(1, e);
    }
    const hw = ww / 2;
    L.push([pts[i]![0] + nx * hw, pts[i]![1] + ny * hw]);
    R.push([pts[i]![0] - nx * hw, pts[i]![1] - ny * hw]);
  }
  const f = (p: P) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  if (closed) return `M ${L.map(f).join(' L ')} Z M ${R.map(f).join(' L ')} Z`;
  return `M ${L.map(f).join(' L ')} L ${R.reverse().map(f).join(' L ')} Z`;
}

export const poly = (pts: P[], close = true) => `M ${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')}${close ? ' Z' : ''}`;

/** 점 목록 부분(앞쪽 t0~t1 비율) 고르기. */
export const slice = (pts: P[], t0: number, t1: number): P[] => pts.slice(Math.floor(t0 * (pts.length - 1)), Math.ceil(t1 * (pts.length - 1)) + 1);

/** 손 빗금 선분들(상자를 angle 방향 평행선으로) — 길이·간격 살짝 흔들림. */
export function hatch(box: { x0: number; y0: number; x1: number; y1: number }, angleDeg: number, spacing: number, seed: string): string {
  const a = angleDeg * D2R;
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const R = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2;
  const out: string[] = [];
  let i = 0;
  for (let s = -R; s <= R; s += spacing, i++) {
    const j = rn(seed, `j${i}`) * spacing * 0.5;
    const ox = cx + nx * (s + j), oy = cy + ny * (s + j);
    const h0 = R * (0.75 + rn(seed, `a${i}`) * 0.3), h1 = R * (0.75 + rn(seed, `b${i}`) * 0.3);
    const tw = rn(seed, `t${i}`) * 0.08;
    const ex = Math.cos(a + tw), ey = Math.sin(a + tw);
    out.push(`M ${(ox - ex * h0).toFixed(1)} ${(oy - ey * h0).toFixed(1)} L ${(ox + ex * h1).toFixed(1)} ${(oy + ey * h1).toFixed(1)}`);
  }
  return out.join(' ');
}

// ── 팔(IK) ───────────────────────────────────────────

/** 두 마디 IK — 어깨 S 에서 손목 목표 T 로. 닿지 않으면 1.3배까지 늘이고 그 너머는 멈춤. bend = +1/-1(팔꿈치 쪽), side = 팔 쪽(-1 왼, +1 오). */
export function ik(S: P, T: P, l1: number, l2: number, side: -1 | 1, bend = 0): { E: P; W: P } {
  let dx = T[0] - S[0], dy = T[1] - S[1];
  let d = Math.hypot(dx, dy) || 0.001;
  const maxD = (l1 + l2) * 1.3;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  const k = d > l1 + l2 ? d / (l1 + l2) : 1; // 늘이기(만화)
  const a1 = l1 * k, a2 = l2 * k;
  const cosA = Math.min(1, Math.max(-1, (a1 * a1 + d * d - a2 * a2) / (2 * a1 * d)));
  const A = Math.acos(cosA);
  const base = Math.atan2(dy, dx);
  const cand = [base + A, base - A].map((t) => [S[0] + Math.cos(t) * a1, S[1] + Math.sin(t) * a1] as P);
  let E: P;
  if (bend !== 0) E = bend > 0 ? cand[0]! : cand[1]!;
  else {
    // 팔꿈치는 바깥·아래로(만화 팔의 자연스러운 굽음)
    const score = (q: P) => side * (q[0] - S[0]) + 0.6 * (q[1] - S[1]);
    E = score(cand[0]!) >= score(cand[1]!) ? cand[0]! : cand[1]!;
  }
  return { E, W: [S[0] + dx, S[1] + dy] };
}

/** 2차 베지어(어깨→팔꿈치를 지나→손목) 위 점들. */
export function armCurve(S: P, E: P, W: P, n = 14): P[] {
  const C: P = [2 * E[0] - (S[0] + W[0]) / 2, 2 * E[1] - (S[1] + W[1]) / 2];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * S[0] + 2 * u * t * C[0] + t * t * W[0], u * u * S[1] + 2 * u * t * C[1] + t * t * W[1]] as P;
  });
}

// ── 잎 ───────────────────────────────────────────────

/**
 * 둥근 귀 잎(개념 그림: 넓은 달걀꼴, 끝이 살짝 뾰족) — 잎 로컬(밑 = 원점, +x 끝 방향). 위 가장자리·아래 가장자리 점.
 * bend = 끝으로 갈수록 휘는 정도(라디안, +면 아래로 처짐), curl = 가장자리 말림(가을), serr = 톱니(봄).
 */
export function leafShape(L: number, W: number, bend = 0, curl = 0, serr = 0, n = 26): { outline: P[]; axis: P[]; upper: P[]; lower: P[] } {
  const axis: P[] = [];
  const ang: number[] = [];
  let x = 0, y = 0, a = 0;
  for (let i = 0; i <= n; i++) {
    axis.push([x, y]); ang.push(a);
    const t = i / n;
    a = bend * t * t * 1.6;
    x += Math.cos(a) * (L / n); y += Math.sin(a) * (L / n);
  }
  const hw = (t: number) => {
    // 통통한 떡잎(2026-10-23 다듬기) — 밑은 잎자루로 빠르게 모이고, 58% 에서 가장 넓고, 끝은 둥근 반타원(뾰족하지 않게)
    const M = 0.58;
    const b = t <= M ? Math.pow(Math.sin((Math.PI / 2) * (t / M)), 0.62) : Math.sqrt(Math.max(0, 1 - Math.pow((t - M) / (1 - M), 2.2)));
    return W * b * (t < 0.07 ? 0.3 + 0.7 * (t / 0.07) : 1);
  };
  const upper: P[] = [], lower: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [ax, ay] = axis[i]!; const aa = ang[i]!;
    const nx = -Math.sin(aa), ny = Math.cos(aa);
    let wu = hw(t), wl = hw(t) * 0.94;
    if (serr > 0 && t > 0.15 && t < 0.95) { const z = (i % 2 === 0 ? 1 : -1) * serr * 4; wu += z; wl += z; }
    if (curl > 0) { wu *= 1 - curl * 0.35 * Math.pow(t, 2); wl *= 1 - curl * 0.12 * t; }
    upper.push([ax - nx * wu, ay - ny * wu]);
    lower.push([ax + nx * wl, ay + ny * wl]);
  }
  return { outline: [...upper, ...lower.slice(0, -1).reverse()], axis, upper, lower };
}

/** 각도(도) 섞기 — 짧은 쪽으로. */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
