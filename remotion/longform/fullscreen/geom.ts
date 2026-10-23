// 전체 화면 장면 공용 모양 계산(순수) — 스타일 스파이크(stylespike/geom.ts)에서 옮김 + 감나무·뿌리·지도·손·짚 모양(2026-10-23). 스타일 키트는 이 모양에 붓만 바꿔 입힌다.
import { random } from 'remotion';

export type P = [number, number];
const r = (seed: string, i: number | string) => random(`${seed}:${i}`);

/** 3차 베지어 위 점. */
function cub(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
}

export type Stem = { pts: P[]; w0: number; w1: number; order: number };
export type LeafG = { x: number; y: number; angle: number; len: number; wid: number; order: number; flip: number; tone: number };
export type BerryG = { x: number; y: number; r: number; order: number };
export type ShrubG = { stems: Stem[]; leaves: LeafG[]; berries: BerryG[] };

/**
 * 블루베리형 관목 — 밑동 (0,0)에서 위로(-y) 줄기 n 개, 곁가지, 어긋난 타원 잎, 가지 끝 아래로 처진 열매 송이.
 * order(0~1) = 자라나는 순서(밑 → 끝). 모양은 seed 로 고정.
 */
export function shrubGeom(seed: string, h: number, stems = 4, berries = true): ShrubG {
  const out: ShrubG = { stems: [], leaves: [], berries: [] };
  const leafLen = h * 0.125;
  for (let i = 0; i < stems; i++) {
    const k = stems === 1 ? 0 : i / (stems - 1) - 0.5;
    const lean = k * 0.62 + (r(seed, `l${i}`) - 0.5) * 0.18;
    const L = h * (0.78 + r(seed, `L${i}`) * 0.22) * (1 - Math.abs(k) * 0.25);
    const p0: P = [k * h * 0.05, 0];
    const p3: P = [p0[0] + Math.sin(lean) * L, -Math.cos(lean) * L];
    const bend = (r(seed, `b${i}`) - 0.5) * h * 0.12;
    const p1: P = [p0[0] + Math.sin(lean) * L * 0.2 + bend * 0.3, -L * 0.33];
    const p2: P = [p0[0] + Math.sin(lean) * L * 0.75 + bend, -Math.cos(lean) * L * 0.7];
    const pts = Array.from({ length: 9 }, (_, j) => cub(p0, p1, p2, p3, j / 8));
    out.stems.push({ pts, w0: h * 0.022, w1: h * 0.006, order: 0 });
    // 잎 — 줄기 0.32~1 구간에 어긋나게
    const nLeaf = 8;
    for (let j = 0; j < nLeaf; j++) {
      const t = 0.3 + (j / (nLeaf - 1)) * 0.68;
      const a = cub(p0, p1, p2, p3, t), b = cub(p0, p1, p2, p3, Math.min(1, t + 0.02));
      const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const side = j % 2 === 0 ? 1 : -1;
      const ang = dir + side * (0.75 + r(seed, `a${i}${j}`) * 0.35);
      const s = 1 - (t - 0.3) * 0.4;
      out.leaves.push({ x: a[0], y: a[1], angle: (ang * 180) / Math.PI, len: leafLen * s * (0.85 + r(seed, `s${i}${j}`) * 0.3), wid: 0.44, order: t, flip: side, tone: r(seed, `t${i}${j}`) });
    }
    // 끝눈 잎 둘
    const tipDir = Math.atan2(p3[1] - p2[1], p3[0] - p2[0]);
    for (const s of [-1, 1]) out.leaves.push({ x: p3[0], y: p3[1], angle: ((tipDir + s * 0.35) * 180) / Math.PI, len: leafLen * 0.62, wid: 0.42, order: 1, flip: s, tone: r(seed, `tt${i}${s}`) });
    // 곁가지 하나 + 열매 송이
    const tb = 0.55 + r(seed, `tb${i}`) * 0.12;
    const a = cub(p0, p1, p2, p3, tb);
    const side = k >= 0 ? 1 : -1;
    const bl = L * 0.26;
    const ta: P = [a[0] + side * bl * 0.8, a[1] - bl * 0.6];
    out.stems.push({ pts: [a, [(a[0] + ta[0]) / 2 + side * 4, (a[1] + ta[1]) / 2 - 6], ta], w0: h * 0.009, w1: h * 0.004, order: tb });
    out.leaves.push({ x: ta[0], y: ta[1], angle: (Math.atan2(ta[1] - a[1], ta[0] - a[0]) * 180) / Math.PI, len: leafLen * 0.8, wid: 0.44, order: tb + 0.1, flip: side, tone: r(seed, `bt${i}`) });
    if (berries && i % 2 === 0) {
      const n = 7;
      const cx = ta[0] + side * 4, cy = ta[1] + leafLen * 0.55;
      for (let q = 0; q < n; q++) {
        const ang = (q / n) * Math.PI * 2 + r(seed, `bq${i}${q}`);
        const rr = q === 0 ? 0 : h * 0.024 * (q > 4 ? 1.7 : 1);
        out.berries.push({ x: cx + Math.cos(ang) * rr * 1.25, y: cy + Math.sin(ang) * rr * 0.9 + q * 1.5, r: h * 0.019 * (0.85 + r(seed, `br${i}${q}`) * 0.3), order: 0.9 });
      }
    }
  }
  return out;
}

/** 잎 윤곽 — 원점이 잎자루, +x 가 잎끝. 타원형(블루베리). */
export function leafPath(L: number, Wr: number): { outline: string; upper: string; lower: string; midrib: string; veins: string[] } {
  const w = L * Wr;
  const outline = `M 0 0 C ${L * 0.18} ${-w * 0.62} ${L * 0.62} ${-w * 0.62} ${L} 0 C ${L * 0.62} ${w * 0.62} ${L * 0.18} ${w * 0.62} 0 0 Z`;
  const upper = `M 0 0 C ${L * 0.18} ${-w * 0.62} ${L * 0.62} ${-w * 0.62} ${L} 0 Z`;
  const lower = `M 0 0 C ${L * 0.18} ${w * 0.62} ${L * 0.62} ${w * 0.62} ${L} 0 Z`;
  const midrib = `M ${L * 0.02} 0 Q ${L * 0.5} ${w * 0.04} ${L * 0.96} 0`;
  const veins: string[] = [];
  for (let k = 1; k <= 5; k++) {
    const x = L * (0.12 + k * 0.135);
    const reach = w * 0.42 * Math.sin(Math.PI * (0.18 + k * 0.13));
    for (const s of [-1, 1]) veins.push(`M ${x} ${s * w * 0.02} Q ${x + L * 0.06} ${s * reach * 0.6} ${x + L * 0.13} ${s * reach}`);
  }
  return { outline, upper, lower, midrib, veins };
}

/** 가늘어지는 줄기 윤곽(폐곡선) — pts 를 따라 w0 → w1. */
export function taper(pts: P[], w0: number, w1: number): string {
  const n = pts.length;
  const L: P[] = [], R: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    L.push([pts[i]![0] + nx * w, pts[i]![1] + ny * w]);
    R.push([pts[i]![0] - nx * w, pts[i]![1] - ny * w]);
  }
  const f = (p: P) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  return `M ${L.map(f).join(' L ')} L ${R.reverse().map(f).join(' L ')} Z`;
}

export const polyline = (pts: P[]) => `M ${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')}`;

/** 화분 앞모습 치수 — 원점 = 바닥 가운데. 위 지름 w, 바닥 0.74w, 테두리 띠, 입구 타원(살짝 내려다봄). */
export function potGeom(w: number, h: number) {
  const wb = w * 0.74, rimH = h * 0.11, wr = w * 1.04, ry = w * 0.075;
  const body = `M ${-w / 2} ${-h + rimH} L ${-wb / 2} 0 L ${wb / 2} 0 L ${w / 2} ${-h + rimH} Z`;
  const rim = `M ${-wr / 2} ${-h} L ${-wr / 2} ${-h + rimH} L ${wr / 2} ${-h + rimH} L ${wr / 2} ${-h} Z`;
  return { wb, rimH, wr, ry, body, rim, top: -h };
}

/** 단면 화분 — (x,y)=바닥 가운데. 벽 두께 t. levelY(ratio)·innerX(y) 로 흙 높이 계산. */
export function sectionGeom(x: number, y: number, w: number, h: number, t = 14) {
  const wb = w * 0.76;
  const innerTop = y - h + 10, innerBottom = y - t;
  const innerX = (yy: number, side: -1 | 1) => {
    const k = (y - yy) / h; // 0 바닥 → 1 위
    return x + side * ((wb / 2 + (w / 2 - wb / 2) * k) - t);
  };
  const outerX = (yy: number, side: -1 | 1) => x + side * (wb / 2 + (w / 2 - wb / 2) * ((y - yy) / h));
  const levelY = (ratio: number) => innerBottom - ratio * (innerBottom - innerTop);
  /** 안쪽 흙 덩어리(바닥 ~ ratio). */
  const fillPath = (ratio: number) => {
    const ty = levelY(ratio);
    return `M ${innerX(innerBottom, -1)} ${innerBottom} L ${innerX(ty, -1)} ${ty} L ${innerX(ty, 1)} ${ty} L ${innerX(innerBottom, 1)} ${innerBottom} Z`;
  };
  const band = (r0: number, r1: number) => {
    const a = levelY(r0), b = levelY(r1);
    return `M ${innerX(a, -1)} ${a} L ${innerX(b, -1)} ${b} L ${innerX(b, 1)} ${b} L ${innerX(a, 1)} ${a} Z`;
  };
  // 벽(단면 — 좌우 두 띠 + 바닥 띠)
  const wallL = `M ${x - w / 2} ${y - h} L ${x - wb / 2} ${y} L ${x - wb / 2 + t} ${y - t} L ${innerX(y - h + 10, -1)} ${y - h + 10} L ${x - w / 2 + t} ${y - h} Z`;
  const wallR = `M ${x + w / 2} ${y - h} L ${x + wb / 2} ${y} L ${x + wb / 2 - t} ${y - t} L ${innerX(y - h + 10, 1)} ${y - h + 10} L ${x + w / 2 - t} ${y - h} Z`;
  const floor = `M ${x - wb / 2} ${y} L ${x + wb / 2} ${y} L ${x + wb / 2 - t} ${y - t} L ${x - wb / 2 + t} ${y - t} Z`;
  return { wb, innerTop, innerBottom, innerX, outerX, levelY, fillPath, band, wallL, wallR, floor };
}

/** 뿌리 덩이 — 원점 = 윗면 가운데(뿌리목). 감긴 뿌리(앞쪽 호) + loosen 때 바깥으로 풀려 나가는 뿌리 경로. */
export function rootBallGeom(seed: string, w: number, h: number) {
  const wb = w * 0.8;
  const body = `M ${-w / 2} 0 L ${-wb / 2} ${h} Q 0 ${h + w * 0.06} ${wb / 2} ${h} L ${w / 2} 0 Q 0 ${w * 0.05} ${-w / 2} 0 Z`;
  const halfW = (yy: number) => w / 2 - ((w - wb) / 2) * (yy / h);
  const circling: string[] = [];
  for (let k = 0; k < 9; k++) {
    const yy = h * (0.1 + k * 0.1) + (r(seed, `cy${k}`) - 0.5) * 14;
    const hw = halfW(Math.min(h, yy));
    const sag = 6 + r(seed, `cs${k}`) * 16;
    const tilt = (r(seed, `ct${k}`) - 0.5) * 26;
    const x0 = -hw + 2 + r(seed, `cx0${k}`) * 30, x1 = hw - 2 - r(seed, `cx1${k}`) * 30;
    circling.push(`M ${x0.toFixed(1)} ${(yy - tilt / 2).toFixed(1)} C ${(x0 * 0.4).toFixed(1)} ${(yy + sag - tilt / 4).toFixed(1)} ${(x1 * 0.5).toFixed(1)} ${(yy + sag + tilt / 4).toFixed(1)} ${x1.toFixed(1)} ${(yy + tilt / 2).toFixed(1)}`);
  }
  // 풀린 뿌리 — 옆면·밑면에서 바깥으로 구불구불. 시작점(x0,y0)을 같이 돌려줘 reach 로 줄일 수 있게.
  const loose: { d: string; x0: number; y0: number }[] = [];
  const nSide = 6;
  for (const s of [-1, 1]) {
    for (let k = 0; k < nSide; k++) {
      const yy = h * (0.12 + k * 0.15) + (r(seed, `ly${s}${k}`) - 0.5) * 16;
      const x0 = s * (halfW(yy) - 2);
      const len = 60 + r(seed, `ll${s}${k}`) * 70;
      const droop = 16 + r(seed, `ld${s}${k}`) * 46;
      const wig = (r(seed, `lw${s}${k}`) - 0.5) * 34;
      loose.push({ x0, y0: yy, d: `M ${x0.toFixed(1)} ${yy.toFixed(1)} C ${(x0 + s * len * 0.35).toFixed(1)} ${(yy + wig).toFixed(1)} ${(x0 + s * len * 0.7).toFixed(1)} ${(yy + droop * 0.4 - wig).toFixed(1)} ${(x0 + s * len).toFixed(1)} ${(yy + droop).toFixed(1)}` });
    }
  }
  for (let k = 0; k < 6; k++) {
    const x0 = (k / 5 - 0.5) * wb * 0.8;
    const len = 40 + r(seed, `lb${k}`) * 50;
    const sway = (r(seed, `lbs${k}`) - 0.5) * 50 + x0 * 0.25;
    loose.push({ x0, y0: h + 4, d: `M ${x0.toFixed(1)} ${h + 4} C ${(x0 + sway * 0.3).toFixed(1)} ${(h + len * 0.4).toFixed(1)} ${(x0 + sway).toFixed(1)} ${(h + len * 0.7).toFixed(1)} ${(x0 + sway * 1.2).toFixed(1)} ${(h + len).toFixed(1)}` });
  }
  return { body, wb, circling, loose, halfW };
}

/** 결정적 연필 흔들림 — 경로 점들을 seed 로 살짝 민다. */
export function jitter(pts: P[], seed: string, amt: number): P[] {
  return pts.map((p, i) => [p[0] + (r(seed, `jx${i}`) - 0.5) * amt, p[1] + (r(seed, `jy${i}`) - 0.5) * amt] as P);
}

/**
 * 손으로 그은 빗금 — 상자(x0,y0,x1,y1)를 angle 방향 평행선으로 덮는 짧은 선분들(약간씩 길이·각도 다름).
 * 모양에 맞추려면 clipPath 로 자른다. 반환: 선분 경로 하나(d).
 */
export function hatchLines(box: { x0: number; y0: number; x1: number; y1: number }, angleDeg: number, spacing: number, seed: string, wobble = 0.06): string {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const R = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2;
  const parts: string[] = [];
  let i = 0;
  for (let s = -R; s <= R; s += spacing) {
    const jit = (r(seed, `h${i}`) - 0.5) * spacing * 0.4;
    const ox = cx + nx * (s + jit), oy = cy + ny * (s + jit);
    const half = R * (0.9 + r(seed, `hl${i}`) * 0.1);
    const tw = (r(seed, `ha${i}`) - 0.5) * wobble;
    const ddx = Math.cos(a + tw), ddy = Math.sin(a + tw);
    parts.push(`M ${(ox - ddx * half).toFixed(1)} ${(oy - ddy * half).toFixed(1)} L ${(ox + ddx * half).toFixed(1)} ${(oy + ddy * half).toFixed(1)}`);
    i++;
  }
  return parts.join(' ');
}

/** 흩뿌린 점(흙 알갱이) — 상자 안 n 개 점, 반환은 [x,y,r][] */
export function stipple(box: { x0: number; y0: number; x1: number; y1: number }, n: number, seed: string, rMin = 1, rMax = 2.4): Array<[number, number, number]> {
  return Array.from({ length: n }, (_, i) => [box.x0 + r(seed, `px${i}`) * (box.x1 - box.x0), box.y0 + r(seed, `py${i}`) * (box.y1 - box.y0), rMin + r(seed, `pr${i}`) * (rMax - rMin)] as [number, number, number]);
}

/** 짧은 섬유 조각(피트모스) — [x,y,angle,len][] */
export function fibers(box: { x0: number; y0: number; x1: number; y1: number }, n: number, seed: string, len = 14): Array<[number, number, number, number]> {
  return Array.from({ length: n }, (_, i) => [box.x0 + r(seed, `fx${i}`) * (box.x1 - box.x0), box.y0 + r(seed, `fy${i}`) * (box.y1 - box.y0), r(seed, `fa${i}`) * 180, len * (0.5 + r(seed, `fl${i}`))] as [number, number, number, number]);
}

// ── 2026-10-23 추가 — 감나무(어린 묘목·어린 나무·성목), 뿌리, 남한 지도, 손, 눈송이 ─────────────────────

export type TreeAge = 'sapling' | 'young' | 'mature';
export type TreeG = {
  /** 줄기·가지(첫 항목이 몸통). order = 자라는 순서(0~1). */
  stems: Stem[];
  leaves: LeafG[];
  fruits: BerryG[];
  /** 몸통 — 밑동 (0,0) 에서 top(음수 y)까지, 굵기 w0 → w1. */
  trunk: { top: number; w0: number; w1: number };
  /** 접붙인 자리 높이(음수 y) — 묘목·어린 나무만. */
  graftY?: number;
  /** 수관(잎 덩어리) 대략 상자 — 라벨 자리 잡기용. */
  crown: { x0: number; y0: number; x1: number; y1: number };
};

const TREE_CFG: Record<TreeAge, { trunkFrac: number; w0: number; scaf: number; depth: number; spread: number; leafLen: number; leafN: number; fruitP: number }> = {
  sapling: { trunkFrac: 0.8, w0: 0.032, scaf: 2, depth: 0, spread: 0.45, leafLen: 0.11, leafN: 4, fruitP: 0 },
  young: { trunkFrac: 0.42, w0: 0.045, scaf: 3, depth: 1, spread: 0.85, leafLen: 0.085, leafN: 5, fruitP: 0.25 },
  mature: { trunkFrac: 0.34, w0: 0.1, scaf: 5, depth: 2, spread: 1.05, leafLen: 0.058, leafN: 5, fruitP: 0.45 },
};

/** 부드러운 곡선 점들 — start 에서 angle(0 = 위, + = 오른쪽, 라디안) 방향으로 len, 옆으로 bend 만큼 휜다. */
function limbPts(start: P, angle: number, len: number, bend: number, n = 7): P[] {
  const end: P = [start[0] + Math.sin(angle) * len, start[1] - Math.cos(angle) * len];
  const nx = Math.cos(angle), ny = Math.sin(angle);
  const ctrl: P = [(start[0] + end[0]) / 2 + nx * bend, (start[1] + end[1]) / 2 + ny * bend];
  return Array.from({ length: n }, (_, j) => {
    const t = j / (n - 1), u = 1 - t;
    return [u * u * start[0] + 2 * u * t * ctrl[0] + t * t * end[0], u * u * start[1] + 2 * u * t * ctrl[1] + t * t * end[1]] as P;
  });
}
const along = (pts: P[], t: number): P => {
  const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), k = f - i;
  return [pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * k, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * k];
};
const dirAt = (pts: P[], t: number): number => {
  const a = along(pts, Math.max(0, t - 0.04)), b = along(pts, Math.min(1, t + 0.04));
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
};

/**
 * 감나무 모양 — 밑동 (0,0), 꼭대기가 정확히 y = -h. age: sapling(접목묘 — 외줄기 + 잔가지 둘), young(1~3년, 원가지 셋),
 * mature(성목 — 굵은 몸통, 원가지 다섯, 퍼진 둥근 수관). 잎은 넓은 타원(감잎), 열매는 가지 끝 아래.
 */
export function treeGeom(seed: string, h: number, age: TreeAge): TreeG {
  const c = TREE_CFG[age];
  const out: TreeG = { stems: [], leaves: [], fruits: [], trunk: { top: 0, w0: 0, w1: 0 }, crown: { x0: 0, y0: 0, x1: 0, y1: 0 } };
  const unit = 1000; // 단위 키로 만든 뒤 h 에 맞춰 늘린다
  const trunkH = unit * c.trunkFrac;
  const w0 = unit * c.w0;
  const trunk = limbPts([0, 0], (r(seed, 'tl') - 0.5) * 0.08, trunkH, (r(seed, 'tb') - 0.5) * unit * 0.03, 9);
  out.stems.push({ pts: trunk, w0, w1: w0 * (age === 'sapling' ? 0.45 : 0.68), order: 0 });
  const leafLen = unit * c.leafLen;
  const addLeaves = (pts: P[], order: number, count: number, key: string) => {
    for (let j = 0; j < count; j++) {
      const t = 0.35 + (j / Math.max(1, count - 1)) * 0.65;
      const p = along(pts, t), dir = dirAt(pts, t);
      const side = j % 2 === 0 ? 1 : -1;
      const ang = dir + side * (0.7 + r(seed, `${key}a${j}`) * 0.5);
      out.leaves.push({ x: p[0], y: p[1], angle: (ang * 180) / Math.PI, len: leafLen * (0.8 + r(seed, `${key}s${j}`) * 0.35), wid: 0.58, order: Math.min(1, order + 0.15 + t * 0.15), flip: side, tone: r(seed, `${key}t${j}`) });
    }
    const tip = pts[pts.length - 1]!, td = dirAt(pts, 1);
    for (const s of [-1, 1]) out.leaves.push({ x: tip[0], y: tip[1], angle: ((td + s * 0.3) * 180) / Math.PI, len: leafLen * 0.75, wid: 0.56, order: Math.min(1, order + 0.3), flip: s, tone: r(seed, `${key}tt${s}`) });
  };
  const grow = (start: P, ang: number, len: number, bw: number, depth: number, order: number, key: string) => {
    const pts = limbPts(start, ang, len, (r(seed, `${key}b`) - 0.5) * len * 0.22 - Math.sign(ang) * len * 0.06);
    out.stems.push({ pts, w0: bw, w1: bw * 0.45, order });
    if (depth > 0) {
      const n = 2 + (r(seed, `${key}n`) > 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const t = 0.45 + k * (0.5 / n) + r(seed, `${key}k${k}`) * 0.08;
        const side = (k % 2 === 0 ? 1 : -1) * (Math.sign(ang) || 1);
        grow(along(pts, t), ang + side * (0.38 + r(seed, `${key}d${k}`) * 0.3) - ang * 0.25, len * (0.55 + r(seed, `${key}l${k}`) * 0.15), bw * 0.55, depth - 1, order + 0.18, `${key}${k}`);
      }
      grow(pts[pts.length - 1]!, ang * 0.8, len * 0.45, bw * 0.45, 0, order + 0.25, `${key}e`);
    } else {
      addLeaves(pts, order, c.leafN, key);
      if (r(seed, `${key}f`) < c.fruitP) {
        const p = along(pts, 0.8);
        out.fruits.push({ x: p[0] + (r(seed, `${key}fx`) - 0.5) * leafLen * 0.4, y: p[1] + leafLen * 0.55, r: leafLen * 0.42, order: Math.min(1, order + 0.35) });
      }
    }
  };
  const top = trunk[trunk.length - 1]!;
  const scafLen = unit * (1 - c.trunkFrac) * (age === 'mature' ? 0.62 : age === 'young' ? 0.7 : 0.32);
  for (let i = 0; i < c.scaf; i++) {
    const k = c.scaf === 1 ? 0 : i / (c.scaf - 1) - 0.5;
    const t = age === 'sapling' ? 0.82 + i * 0.1 : 0.78 + r(seed, `st${i}`) * 0.2;
    const ang = k * 1.9 * c.spread + (r(seed, `sa${i}`) - 0.5) * 0.18;
    const len = scafLen * (1 - Math.abs(k) * 0.35) * (0.9 + r(seed, `sl${i}`) * 0.2);
    grow(along(trunk, Math.min(1, t)), ang, len, w0 * (age === 'sapling' ? 0.3 : 0.58), c.depth, 0.3, `s${i}`);
  }
  if (age === 'sapling') addLeaves(trunk.slice(4), 0.45, 3, 'tk');
  // 높이 맞추기 — 꼭대기(잎 끝 포함 어림)가 -h 가 되게 위치만 늘린다(굵기는 단위 비례).
  const minY = Math.min(...out.stems.flatMap((s) => s.pts.map((q) => q[1])), ...out.leaves.map((l) => l.y - l.len * 0.6));
  const k = h / -minY;
  const sc = (q: P): P => [q[0] * k, q[1] * k];
  out.stems = out.stems.map((s) => ({ ...s, pts: s.pts.map(sc), w0: s.w0 * k, w1: s.w1 * k }));
  out.leaves = out.leaves.map((l) => ({ ...l, x: l.x * k, y: l.y * k, len: l.len * k }));
  out.fruits = out.fruits.map((f) => ({ ...f, x: f.x * k, y: f.y * k, r: f.r * k }));
  out.trunk = { top: top[1] * k, w0: w0 * k, w1: out.stems[0]!.w1 };
  if (age !== 'mature') out.graftY = -Math.min(h * (age === 'sapling' ? 0.1 : 0.07), 60);
  const xs = out.leaves.map((l) => l.x), ys = out.leaves.map((l) => l.y);
  out.crown = xs.length ? { x0: Math.min(...xs), y0: -h, x1: Math.max(...xs), y1: Math.max(...ys) } : { x0: -20, y0: -h, x1: 20, y1: 0 };
  return out;
}

/** 뿌리 — 뿌리목 (0,0)에서 아래로. w = 퍼진 너비, depth = 깊이, n = 굵은 뿌리 수. 굵은 뿌리마다 곁뿌리·잔뿌리. */
export function rootsGeom(seed: string, w: number, depth: number, n = 6, thick = 14): Stem[] {
  const out: Stem[] = [];
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 왼쪽 ~ 0.5 오른쪽
    const ang = Math.PI + k * 2.6 + (r(seed, `ra${i}`) - 0.5) * 0.2; // π = 아래
    const horiz = Math.abs(Math.sin(ang - Math.PI));
    const len = (horiz * w * 0.5 + (1 - horiz) * depth) * (0.85 + r(seed, `rl${i}`) * 0.2);
    const start: P = [k * thick * 0.6, 4];
    const pts = limbPts(start, ang, len, (r(seed, `rb${i}`) - 0.5) * len * 0.25 + len * 0.12 * Math.sign(k));
    for (const q of pts) q[1] = Math.max(q[1], 4 + Math.abs(q[0]) * 0.04); // 땅 위로 솟지 않게
    out.push({ pts, w0: thick * (1 - Math.abs(k) * 0.5), w1: thick * 0.15, order: 0 });
    for (let j = 0; j < 3; j++) {
      const t = 0.3 + j * 0.22 + r(seed, `rt${i}${j}`) * 0.06;
      const s = j % 2 === 0 ? 1 : -1;
      const sp = limbPts(along(pts, t), ang + s * (0.5 + r(seed, `rs${i}${j}`) * 0.4), len * (0.3 + r(seed, `rL${i}${j}`) * 0.15), len * 0.05 * s, 5);
      for (const q of sp) q[1] = Math.max(q[1], 6);
      out.push({ pts: sp, w0: thick * 0.32, w1: thick * 0.06, order: 0.3 + t * 0.5 });
    }
  }
  return out;
}

// 남한 윤곽(경도, 위도) — 도식용 어림. 시계 방향, 서쪽 휴전선 끝에서 시작.
const KOREA: Array<[number, number]> = [
  [126.15, 37.75], [126.6, 37.95], [127.1, 38.3], [127.6, 38.3], [128.1, 38.35], [128.36, 38.62], [128.6, 38.2], [128.9, 37.8],
  [129.2, 37.4], [129.4, 36.9], [129.45, 36.4], [129.57, 36.05], [129.42, 35.5], [129.12, 35.12], [128.6, 34.98], [128.05, 34.85],
  [127.62, 34.68], [127.2, 34.5], [126.6, 34.3], [126.3, 34.6], [126.4, 35.0], [126.5, 35.6], [126.72, 36.0], [126.5, 36.4],
  [126.15, 36.8], [126.6, 37.02], [126.68, 37.42], [126.42, 37.6],
];
export const KOREA_LAT = { top: 38.7, bottom: 33.1 } as const;
/** 위경도 → 지도 좌표(원점 = 지도 상자 왼쪽 위, 높이 h). */
export function koreaXY(h: number, lat: number, lon: number): P {
  const ky = h / (KOREA_LAT.top - KOREA_LAT.bottom), kx = ky * 0.81;
  return [(lon - 126.0) * kx, (KOREA_LAT.top - lat) * ky];
}
/** 남한 지도 모양 — outline(본토)·jeju(제주) 경로, 너비 w, 위도 → y. */
export function koreaGeom(h: number) {
  const pts = KOREA.map(([lon, lat]) => koreaXY(h, lat, lon));
  const smooth = `M ${pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ')} Z`;
  const [jx, jy] = koreaXY(h, 33.38, 126.55);
  const jrx = (koreaXY(h, 33.38, 126.9)[0] - jx), jry = h * 0.022;
  const jeju = `M ${jx - jrx} ${jy} a ${jrx} ${jry} 0 1 0 ${2 * jrx} 0 a ${jrx} ${jry} 0 1 0 ${-2 * jrx} 0 Z`;
  const w = koreaXY(h, 36, 129.7)[0];
  return { outline: smooth, jeju, w, yOfLat: (lat: number) => koreaXY(h, lat, 127)[1] };
}
/** 지역 띠(위도 범위) — 중부 36.0~38.7, 남부 33.1~36.0. */
export const KOREA_REGIONS = { central: [36.0, 38.7], south: [33.1, 36.0] } as const;

/**
 * 손 — 쥐는 점 (0,0), 손은 오른쪽(+x)에서 들어와 세로 줄기를 감싸 쥔다(scale 1 ≈ 손 너비 130). pose: hold(쥠)·point(검지로 가리킴, 끝 = (-96,-34)).
 * 돌려주는 경로: arm(소매), palm(손등), fingers(앞쪽 손가락들 — 줄기 앞), thumb, creases(마디 선).
 */
export function handGeom(pose: 'hold' | 'point') {
  const arm = 'M 70 -16 C 120 0 168 30 206 54 L 176 122 C 140 100 100 80 56 64 Z';
  const palm = 'M 6 -46 C 40 -54 70 -42 80 -12 L 92 36 C 96 58 80 70 58 66 L 8 58 Z';
  const cap = (x0: number, x1: number, y: number, hh = 19) => `M ${x1} ${y - hh / 2} L ${x0 + hh / 2} ${y - hh / 2} A ${hh / 2} ${hh / 2} 0 0 0 ${x0 + hh / 2} ${y + hh / 2} L ${x1} ${y + hh / 2} Z`;
  const fingers = pose === 'hold'
    ? [cap(-30, 46, -30), cap(-33, 48, -10), cap(-31, 50, 10), cap(-26, 50, 30, 17)]
    : [cap(-96, 46, -34, 18), cap(-8, 48, -12), cap(-6, 50, 8), cap(-2, 50, 27, 17)];
  const thumb = pose === 'hold'
    ? 'M 36 -40 C 14 -56 -18 -56 -28 -46 C -34 -38 -26 -32 -14 -35 C 4 -40 22 -36 40 -26 Z'
    : 'M 40 -44 C 22 -58 -2 -56 -10 -46 C -14 -38 -6 -33 4 -36 C 18 -40 28 -36 44 -28 Z';
  const creases = pose === 'hold'
    ? ['M 18 -38 q 4 8 0 16', 'M 18 -18 q 4 8 0 16', 'M 18 2 q 4 8 0 16', 'M 20 22 q 4 7 0 14']
    : ['M -50 -42 q 3 8 0 16', 'M 22 -20 q 4 8 0 16', 'M 22 0 q 4 8 0 16'];
  return { arm, palm, fingers, thumb, creases };
}

/** 눈송이(여섯 갈래) 경로 — 중심 (x,y), 반지름 rr. */
export function snowflakePath(x: number, y: number, rr: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const ex = x + Math.cos(a) * rr, ey = y + Math.sin(a) * rr;
    parts.push(`M ${x} ${y} L ${ex.toFixed(1)} ${ey.toFixed(1)}`);
    for (const s of [-1, 1]) {
      const bx = x + Math.cos(a) * rr * 0.58, by = y + Math.sin(a) * rr * 0.58;
      const ba = a + s * 0.7;
      parts.push(`M ${bx.toFixed(1)} ${by.toFixed(1)} l ${(Math.cos(ba) * rr * 0.32).toFixed(1)} ${(Math.sin(ba) * rr * 0.32).toFixed(1)}`);
    }
  }
  return parts.join(' ');
}

/** 감 열매 윤곽 — 중심 (0,0), 반지름 rr. kind: round(떫은감 둥근 감), flat(단감 — 납작), long(대봉 — 끝이 뾰족한 긴 감). */
export function persimmonPath(rr: number, kind: 'round' | 'flat' | 'long'): string {
  if (kind === 'flat') return `M ${-rr} 0 C ${-rr} ${-rr * 0.75} ${rr} ${-rr * 0.75} ${rr} 0 C ${rr} ${rr * 0.7} ${-rr} ${rr * 0.7} ${-rr} 0 Z`;
  if (kind === 'long') return `M ${-rr * 0.8} ${-rr * 0.3} C ${-rr * 0.8} ${-rr * 0.95} ${rr * 0.8} ${-rr * 0.95} ${rr * 0.8} ${-rr * 0.3} C ${rr * 0.8} ${rr * 0.5} ${rr * 0.2} ${rr * 1.25} 0 ${rr * 1.35} C ${-rr * 0.2} ${rr * 1.25} ${-rr * 0.8} ${rr * 0.5} ${-rr * 0.8} ${-rr * 0.3} Z`;
  return `M ${-rr} 0 C ${-rr} ${-rr * 0.95} ${rr} ${-rr * 0.95} ${rr} 0 C ${rr} ${rr * 0.95} ${-rr} ${rr * 0.95} ${-rr} 0 Z`;
}
/** 감 꽃받침(네 갈래) — 열매 위 (0, -rr*0.62) 자리. */
export function calyxPath(rr: number): string {
  const y = -rr * 0.62, s = rr * 0.42;
  return `M 0 ${y} C ${s * 0.4} ${y - s * 0.5} ${s} ${y - s * 0.3} ${s * 1.1} ${y + s * 0.1} C ${s * 0.6} ${y + s * 0.25} ${s * 0.3} ${y + s * 0.15} 0 ${y}`
    + ` C ${-s * 0.4} ${y - s * 0.5} ${-s} ${y - s * 0.3} ${-s * 1.1} ${y + s * 0.1} C ${-s * 0.6} ${y + s * 0.25} ${-s * 0.3} ${y + s * 0.15} 0 ${y}`
    + ` M 0 ${y} C ${s * 0.25} ${y + s * 0.4} ${s * 0.2} ${y + s * 0.8} ${s * 0.05} ${y + s * 0.9} M 0 ${y} C ${-s * 0.25} ${y + s * 0.4} ${-s * 0.2} ${y + s * 0.8} ${-s * 0.05} ${y + s * 0.9}`
    + ` M 0 ${y} l 0 ${-s * 0.55}`;
}
