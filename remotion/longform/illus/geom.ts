// 일러스트 기하(순수) — 지나는 점을 부드러운 곡선으로 잇고, 밑동에서 끝으로 가늘어지는 가지 윤곽을 만든다.
export type P = [number, number];

/** Catmull-Rom 으로 지나는 점들을 n 구간으로 고르게 샘플(처음·끝 점 보존). */
export function sampleSpline(pts: P[], n = 32): P[] {
  if (pts.length < 2) return pts.slice();
  const ext: P[] = [pts[0]!, ...pts, pts[pts.length - 1]!];
  const segs = pts.length - 1;
  const out: P[] = [];
  for (let k = 0; k <= n; k++) {
    const u = (k / n) * segs;
    const i = Math.min(segs - 1, Math.floor(u));
    const t = u - i;
    const [p0, p1, p2, p3] = [ext[i]!, ext[i + 1]!, ext[i + 2]!, ext[i + 3]!];
    const f = (a: number, b: number, c: number, d: number) =>
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
  }
  out[0] = pts[0]!;
  out[out.length - 1] = pts[pts.length - 1]!;
  return out;
}

/** 곡선 위 비율 t(0~1) 지점. */
export function pointAt(pts: P[], t: number): P {
  const s = sampleSpline(pts, 64);
  const i = Math.max(0, Math.min(s.length - 1, Math.round(t * (s.length - 1))));
  return s[i]!;
}

/** 밑동 폭 w0 → 끝 폭 w1 로 가늘어지는 닫힌 윤곽. progress(0~1)만큼만 자란 상태(끝은 둥글게). */
/** flare: 밑동 부풀림(지륭·뿌리목) — 처음 flareLen(기본 15%) 구간에서 폭이 (1+flare)배에서 원래로 줄어든다. */
export function taperOutline(pts: P[], w0: number, w1: number, progress: number, n = 32, flare = 0, flareLen = 0.15): string {
  if (progress <= 0) return '';
  const all = sampleSpline(pts, n);
  const m = Math.max(1, Math.round(progress * n));
  const s = all.slice(0, m + 1);
  const left: P[] = [], right: P[] = [];
  s.forEach((p, i) => {
    const a = s[Math.max(0, i - 1)]!, b = s[Math.min(s.length - 1, i + 1)]!;
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const k = i / n;
    // 부풂은 볼록한 S자(코사인) — 밑동에서 한동안 부푼 채로 가다가 매끄럽게 원래 굵기로(나팔처럼 오목하지 않게).
    const sf = Math.min(1, k / flareLen);
    const w = ((w0 + (w1 - w0) * k) / 2) * (1 + flare * 0.5 * (1 + Math.cos(Math.PI * sf)));
    left.push([p[0] - dy * w, p[1] + dx * w]);
    right.push([p[0] + dy * w, p[1] - dx * w]);
  });
  const f = (p: P) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  const tip = s[s.length - 1]!;
  return `M ${f(left[0]!)} ${left.slice(1).map((p) => `L ${f(p)}`).join(' ')} Q ${f(tip)} ${f(right[right.length - 1]!)} ${right.slice(0, -1).reverse().map((p) => `L ${f(p)}`).join(' ')} Z`;
}

/** 곡선 중심선(껍질 결·하이라이트용) — progress 만큼. */
export function centerLine(pts: P[], progress: number, offset = 0, n = 32): string {
  if (progress <= 0) return '';
  const s = sampleSpline(pts, n).slice(0, Math.max(1, Math.round(progress * n)) + 1);
  return s.map((p, i) => {
    const a = s[Math.max(0, i - 1)]!, b = s[Math.min(s.length - 1, i + 1)]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const x = p[0] - ((b[1] - a[1]) / len) * offset, y = p[1] + ((b[0] - a[0]) / len) * offset;
    return `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

/** 문자열 시드 → 0~1 난수열(결정적, mulberry32). */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TreeBranch { pts: P[]; w0: number; w1: number; level: number; order: number; parent: number }
export interface Tree { branches: TreeBranch[]; tips: P[] }

/**
 * 갈라지는 나무(순수·결정적) — 실제 나무 비율로 계산한다(사장님 지시 2026-10-19 "크기·굵기 비율 계산 잘해").
 *  · 줄기 지름 : 키 ≈ 1 : 28 (높이 2~3m 어린 과실나무의 줄기 지름 5~10cm)
 *  · 다빈치 규칙(파이프 모형) — 갈라지는 자리에서 자식 가지 단면적의 합 ≈ 부모 단면적(굵기² 보존, 손실 8%)
 *  · 원가지(이어 가는 가지)가 단면적의 절반쯤을 이어받아 가장 굵고, 부모 끝에서 같은 굵기로 이어진다
 *  · 가지 길이 ∝ 굵기^⅔ (탄성 상사 — 가는 가지일수록 짧다)
 * 각도는 위(-90°) 기준. tips = 끝가지 끝점(잎·눈 자리).
 */
export function growTree(seed: string, base: P, height: number, opts: { depth?: number; spread?: number; lean?: number; trunkFrac?: number; trunkRatio?: number } = {}): Tree {
  // 두 번 기른다 — 첫 결과의 실제 키를 재서, 나무 전체 키가 height 가 되게 길이만 맞춘다(굵기는 키 기준 그대로).
  const first = growTreeOnce(seed, base, height, opts, 1);
  const top = Math.min(...first.branches.flatMap((b) => b.pts.map((q) => q[1])));
  const actual = Math.max(1, base[1] - top);
  return growTreeOnce(seed, base, height, opts, height / actual);
}

function growTreeOnce(seed: string, base: P, height: number, opts: { depth?: number; spread?: number; lean?: number; trunkFrac?: number; trunkRatio?: number }, lenScale: number): Tree {
  const r = rng(seed);
  // 과실나무는 가운데를 비우고 옆으로 벌려 키운다 — 곁가지 벌어짐을 넉넉히(기본 42°).
  const depth = opts.depth ?? 3, spread = Math.max(opts.spread ?? 42, 38), lean = opts.lean ?? 0;
  const branches: TreeBranch[] = [];
  const tips: P[] = [];
  let order = 0;
  const AREA_KEPT = 0.92;
  const go = (from: P, angleDeg: number, len: number, w0: number, level: number, parent: number) => {
    const a = (angleDeg * Math.PI) / 180;
    // 줄기·굵은 가지는 굽이지고, 잔가지(3단계~)는 거의 곧게 — 겨울 과실나무 잔가지는 마디에서 꺾일 뿐 말리지 않는다.
    const wob = (k: number) => (r() - 0.5) * len * (level === 0 ? 0.12 : level >= 3 ? 0.05 : 0.2) * k;
    const b1 = wob(1), b2 = wob(1);
    const at3 = (t: number, b: number): P => [from[0] + Math.cos(a) * len * t - Math.sin(a) * b, from[1] + Math.sin(a) * len * t + Math.cos(a) * b];
    const lift = level === 0 ? 0 : len * (level >= 3 ? 0.07 : 0.08 + 0.05 * level);
    const end: P = [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len - lift];
    // 위로 휨은 끝 한 마디에 몰지 않고 가지 전체에 포물선으로 나눈다(끝이 갈고리처럼 꺾이지 않게).
    const up = (q: P, t: number): P => [q[0], q[1] - lift * t * t];
    const bpts: P[] = [from, up(at3(0.33, b1), 0.33), up(at3(0.66, b2), 0.66), end];
    const me = order++;
    const idx = branches.length;
    branches.push({ pts: bpts, w0, w1: w0, level, order: me, parent });
    if (level >= depth) {
      branches[idx]!.w1 = Math.min(w0 * 0.85, Math.max(1.2, w0 * 0.42));
      tips.push(end);
      return;
    }
    const kids = level === 0 ? 3 : 2 + (r() > 0.55 ? 1 : 0);
    const lead = Math.floor(kids / 2);
    // 단면적 몫 — 원가지 0.46~0.54, 나머지는 곁가지들이 무작위로 나눈다.
    const leadShare = 0.46 + r() * 0.08;
    const wts = Array.from({ length: kids }, (_, k) => (k === lead ? 0 : 0.6 + r() * 0.8));
    const wsum = wts.reduce((x, y) => x + y, 0) || 1;
    const shares = wts.map((w, k) => (k === lead ? leadShare : ((1 - leadShare) * w) / wsum));
    const kidW = shares.map((sh) => w0 * Math.sqrt(AREA_KEPT * sh));
    branches[idx]!.w1 = kidW[lead]!;
    // 곁가지는 부모 몸통 0.45~0.9 지점, 원가지는 끝에서 이어진다.
    const ts = shares.map((_, k) => (k === lead ? 1 : 0.45 + r() * 0.45));
    for (let k = 0; k < kids; k++) {
      const t = ts[k]!;
      const at: P = pointAt(bpts, t);
      const side = kids === 1 ? 0 : (k / (kids - 1)) * 2 - 1;
      const ang = angleDeg + side * spread * (0.8 + r() * 0.5) + (r() - 0.5) * 12;
      // 굵기가 줄어든 만큼 짧게(길이 ∝ 굵기^⅔) — 원가지는 조금 더 길게 뻗는다.
      const kLen = len * Math.pow(kidW[k]! / w0, 2 / 3) * (k === lead ? 1.0 : 1.12) * (0.92 + r() * 0.16);
      go(at, ang, kLen, kidW[k]!, level + 1, me);
    }
  };
  go(base, -90 + lean, height * (opts.trunkFrac ?? 0.42) * lenScale, height / (opts.trunkRatio ?? 28), 0, -1);
  return { branches, tips };
}

/** 곡선의 각 점을 법선(-dy, dx) 방향으로 off 만큼 평행 이동(순수). */
export function shiftPts(pts: P[], off: number): P[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    return [p[0] - dy * off, p[1] + dx * off] as P;
  });
}

/** 왼쪽 위에서 드는 빛을 받는 쪽의 부호 — shiftPts(pts, lightSide(pts) * k)가 빛 쪽으로 간다. */
export function lightSide(pts: P[]): 1 | -1 {
  const a = pts[0]!, b = pts[pts.length - 1]!;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return -dy * -1 + dx * -1 > 0 ? 1 : -1;
}

/** 땅에 드리운 그림자 좌표 — 해가 왼쪽 위라 그림자는 오른쪽으로 눕고 납작해진다. */
export function castShadowPts(pts: P[], groundY: number): P[] {
  return pts.map(([x, y]) => {
    const h = Math.max(0, groundY - y);
    return [x + h * 0.9, groundY + h * 0.12] as P;
  });
}

/** 가지 폭을 따라 frac(-1~1) 위치를 지나는 선 — 껍질 골·빛 띠용. 끝으로 갈수록 폭이 좁아지는 만큼 안쪽으로 든다. */
export function ribLine(pts: P[], w0: number, w1: number, frac: number, progress: number, n = 32): string {
  if (progress <= 0) return '';
  const s = sampleSpline(pts, n).slice(0, Math.max(1, Math.round(progress * n)) + 1);
  return s.map((p, i) => {
    const a = s[Math.max(0, i - 1)]!, b = s[Math.min(s.length - 1, i + 1)]!;
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const half = (w0 + (w1 - w0) * (i / n)) / 2;
    const off = frac * half;
    return `${i ? 'L' : 'M'} ${(p[0] - dy * off).toFixed(1)} ${(p[1] + dx * off).toFixed(1)}`;
  }).join(' ');
}

export interface Root { pts: P[]; w0: number; w1: number }

/** 땅 위로 드러난 뿌리(순수·결정적) — 밑동 둘레에서 좌우로 퍼져 흙 속으로 파고든다. trunkW = 밑동 폭. */
export function rootPaths(seed: string, base: P, trunkW: number): Root[] {
  const r = rng(`root${seed}`);
  const n = 5 + Math.floor(r() * 2);
  const out: Root[] = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const spread = (0.3 + 0.7 * ((Math.floor(i / 2) + 1) / Math.ceil(n / 2))) * side;
    const sx = base[0] + spread * trunkW * 0.42;
    const len = trunkW * (0.9 + r() * 1.1);
    const ex = sx + side * len * (0.7 + r() * 0.5);
    const ey = base[1] + 6 + r() * 14;
    const mid: P = [(sx + ex) / 2 + (r() - 0.5) * 10, base[1] - 2 + r() * 6];
    out.push({ pts: [[sx, base[1] - trunkW * 0.08], mid, [ex, ey]], w0: trunkW * (0.28 + r() * 0.14), w1: 1.5 + r() * 2 });
  }
  return out;
}
