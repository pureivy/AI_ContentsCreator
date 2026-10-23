// 식물 도감 모양(순수, 2026-10-23 스타일 B) — 종 프리셋(species/schema)의 잎·꽃·열매 매개변수 → 윤곽 경로.
// 잎: 엽형(난형·타원·피침·도란·원형·심장형·손바닥 갈래·깃꼴 겹잎) × 엽연(전연·톱니·겹톱니·물결·결각) × 맥(우상·장상) × 끝·밑 모양.
// 꽃: 항아리(감·블루베리)·펼친 접시(장미과)·통꽃, 꽃잎 수·겹꽃·꽃받침·수술. 열매: 감·사과·배·핵과·장과·대추·밤.
import type { P } from './geom';
import type { FlowerSpec, FruitSpec, LeafSpec } from './species/schema';
import { smoothOpen } from './geomHand';

const f1 = (n: number) => n.toFixed(1);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * 엽형마다 가장 넓은 자리(peak: 0 밑 ~ 1 끝)와 통통함(full: 작을수록 어깨가 넓다 — 끝·밑 쪽 줄어드는 지수에 곱함).
 * (2026-10-23 B4) 옛 sin 거듭제곱 윤곽은 양끝이 같이 뾰족한 렌즈꼴이 돼 감잎이 피침처럼 보였다 — 밑 쪽·끝 쪽을 따로 만든다.
 */
const SHAPE: Record<Exclude<LeafSpec['shape'], 'palmate' | 'pinnate'>, { peak: number; full: number }> = {
  ovate: { peak: 0.38, full: 1 }, elliptic: { peak: 0.5, full: 1 }, lanceolate: { peak: 0.36, full: 1.2 },
  obovate: { peak: 0.62, full: 1 }, orbicular: { peak: 0.5, full: 0.8 }, cordate: { peak: 0.32, full: 0.9 },
};
/** 끝 쪽(가장 넓은 자리 → 끝) f(r) = (1 − rⁿ)ᵇ·(1 − rᵏ)^q — q > 0 이면 끝 가까이에서만 오목하게 빠지는 짧은 꼬리(점첨두). */
const TIP: Record<LeafSpec['tip'], { n: number; b: number; k: number; q: number }> = {
  acuminate: { n: 2, b: 0.55, k: 7, q: 1 }, acute: { n: 1.6, b: 0.85, k: 1, q: 0 }, obtuse: { n: 2, b: 0.62, k: 1, q: 0 }, rounded: { n: 2, b: 0.5, k: 1, q: 0 },
};
/** 밑 쪽(가장 넓은 자리 → 잎자루) g(r) = (1 − rⁿ)ᵇ — 둥긂(넓게 둥근 밑)·쐐기(곧게 좁아짐)·평평. */
const BASE: Record<LeafSpec['base'], { n: number; b: number }> = {
  rounded: { n: 2.2, b: 0.8 }, cuneate: { n: 1.5, b: 0.9 }, truncate: { n: 3, b: 0.35 }, cordate: { n: 2.4, b: 0.45 },
};

export type LeafG = {
  /** 잎자루 포함 윤곽(닫힌 경로들). */ outline: string;
  /** 윤곽 점(단일 잎몸일 때 — 나무 잎 변환용). */ pts: P[];
  midrib: string; veins: string[];
  /** 반폭 함수(t: 0 밑 ~ 1 끝) — 단일 잎몸. */ hw: (t: number) => number;
  pet: number; W: number; L: number;
  /** (B6) 손바닥 잎 — 잎몸 윤곽 점(닫힌 고리)·갈래 맥(잎몸 밑 → 갈래 끝)·그늘 빗금(+y 쪽). 나무 잎을 화면 좌표로 옮겨 그릴 때 쓴다. */
  ring?: P[]; veinLines?: Array<[P, P]>; shade?: Array<[P, P]>;
};

/** 단일 잎몸 반폭 — 엽형(가장 넓은 자리 peak)·끝(짧게 빠지는 꼬리)·밑(둥긂·쐐기·심장·평평). 어디서나 매끈(꺾임 없음). */
function halfWidth(spec: LeafSpec, W: number) {
  const sh = SHAPE[spec.shape as keyof typeof SHAPE] ?? SHAPE.elliptic;
  const pk = Math.max(0.25, Math.min(0.75, spec.peak ?? sh.peak));
  const tp = TIP[spec.tip] ?? TIP.acute;
  const bs = BASE[spec.base] ?? BASE.rounded;
  return (t: number) => {
    const tt = clamp01(t);
    let v: number;
    if (tt >= pk) {
      const r = (tt - pk) / (1 - pk);
      v = Math.pow(Math.max(0, 1 - Math.pow(r, tp.n)), tp.b * sh.full) * (tp.q > 0 ? Math.pow(Math.max(0, 1 - Math.pow(r, tp.k)), tp.q) : 1);
    } else {
      const r = (pk - tt) / pk;
      v = Math.pow(Math.max(0, 1 - Math.pow(r, bs.n)), bs.b * sh.full);
      if (spec.base === 'cordate' && tt < 0.12) v = Math.max(v, 0.62 * Math.sqrt(tt / 0.12)); // 심장 밑 — 두 귀
    }
    return v * (W / 2);
  };
}

/** 엽연 — 반폭에 톱니·물결·결각을 얹는다. */
function marginMod(spec: LeafSpec, L: number) {
  const teeth = spec.margin === 'serrate' ? Math.max(14, Math.round(L / 6)) : spec.margin === 'doubleSerrate' ? Math.max(10, Math.round(L / 9)) : 0;
  return (t: number, v: number) => {
    if (t < 0.06 || t > 0.97) return v;
    if (spec.margin === 'serrate') { const s = (t * teeth) % 1; return v * (1 - 0.06 * (1 - s)); }
    if (spec.margin === 'doubleSerrate') { const s = (t * teeth) % 1, s2 = (t * teeth * 3) % 1; return v * (1 - 0.08 * (1 - s) - 0.03 * (1 - s2)); }
    if (spec.margin === 'undulate') return v * (1 + 0.05 * Math.sin(t * Math.PI * 9));
    if (spec.margin === 'lobed') return v * (0.72 + 0.28 * Math.abs(Math.sin(t * Math.PI * 3.5)));
    return v;
  };
}

/** 잎 — 잎자루 (0,0), +x 가 잎끝. L = 잎몸+잎자루 길이. detail=false 면 엽연 무늬를 생략(작은 잎). */
export function leafGeom(spec: LeafSpec, L: number, detail = true): LeafG {
  const pet = L * spec.petiole / (1 + spec.petiole);
  const BL = L - pet;
  const W = BL * spec.widthRatio;
  if (spec.shape === 'pinnate') return pinnateLeaf(spec, L, pet, detail);
  if (spec.shape === 'palmate') return palmateLeaf(spec, L, pet, detail);
  const hw0 = halfWidth(spec, W);
  const mm = marginMod(spec, BL);
  const hw = (t: number) => (detail ? mm(t, hw0(t)) : hw0(t));
  const K = detail && spec.margin !== 'entire' ? 90 : detail ? 40 : 26;
  const up: P[] = [], dn: P[] = [];
  // 끝·밑 쪽을 촘촘히(작은 잎에서 곡선이 끝을 찌르거나 밑을 꼬집지 않게)
  for (let i = 0; i <= K; i++) { const u = i / K; const t = u - Math.sin(2 * Math.PI * u) * 0.07; up.push([pet + t * BL, -hw(t)]); dn.push([pet + t * BL, hw(t)]); }
  // 잎몸은 잎자루 끝(pet,0)에서 시작·끝(좌우 대칭), 잎자루는 따로 선
  const pts: P[] = [[pet, 0], ...up.slice(1), ...dn.slice(1, -1).reverse()];
  const blade = detail && spec.margin !== 'entire'
    ? `M ${f1(pet)} 0 L ${pts.slice(1).map((q) => `${f1(q[0])} ${f1(q[1])}`).join(' L ')} Z`
    : `${smoothOpen(up)} ${smoothOpen(dn.slice().reverse()).replace(/^M [^C]+/, '')} Z`;
  const outline = `${blade} M 0 0 L ${f1(pet)} 0`;
  const midrib = `M 0 0 Q ${f1(pet + BL * 0.5)} ${f1(W * 0.02)} ${f1(L * 0.98)} 0`;
  const veins: string[] = [];
  const xOf = (t: number) => pet + t * BL;
  if (spec.venation === 'pinnate') {
    const n = spec.veins;
    for (let k = 0; k < n; k++) {
      const t0 = 0.08 + (k * 0.78) / n;
      const t1 = Math.min(0.94, t0 + 0.22 - k * 0.01);
      for (const s of [-1, 1]) veins.push(`M ${f1(xOf(t0))} ${f1(s * W * 0.012)} Q ${f1(xOf(t0 + 0.05))} ${f1(s * hw0(t0 + 0.05) * 0.62)} ${f1(xOf(t1))} ${f1(s * hw0(t1) * 0.84)}`);
    }
  } else {
    for (let k = 0; k < spec.veins; k++) {
      const a = ((k / Math.max(1, spec.veins - 1)) - 0.5) * 1.6;
      const t = 0.75 - Math.abs(a) * 0.25;
      veins.push(`M ${f1(pet)} 0 Q ${f1(xOf(t * 0.5))} ${f1(Math.sin(a) * hw0(t * 0.5) * 0.7)} ${f1(xOf(t))} ${f1(Math.sin(a) * hw0(t) * 0.9)}`);
    }
  }
  return { outline, pts, midrib, veins, hw: hw0, pet, W, L };
}

/**
 * 손바닥 갈래 잎(단풍·음나무류) — 장상맥. (2026-10-23 B6 다시 그림)
 * 옛 모양은 갈래 n 개가 잎자루 둘레 한 바퀴에 같은 길이·둥근 끝으로 퍼져 '꽃'(벚꽃 송이)처럼 읽혔다.
 * 실물: 갈래는 부채꼴로 펼쳐지고(밑 갈래는 잎자루 옆으로 비스듬히 뒤로), 가운데 갈래가 가장 길고 밑 갈래로 갈수록 짧다(≈0.55),
 * 갈래 끝은 뾰족(점첨두면 짧은 꼬리), 갈래 사이 틈은 잎몸의 1/3~1/2 깊이, 밑은 잎자루 자리에서 오목(심장 밑).
 * 맥은 잎자루 끝(잎몸 밑)에서 갈래마다 하나씩. 엽연이 전연이 아니면 잔톱니. 폭/길이는 widthRatio 로 맞춘다.
 * ring·veinLines·shade = 나무 잎 변환용 점(단위 그대로) — 그리는 쪽이 화면 좌표로 옮겨 선 굵기가 늘 같게 그린다.
 */
function palmateLeaf(spec: LeafSpec, L: number, pet: number, detail: boolean): LeafG {
  const n = Math.max(3, Math.min(11, Math.round(spec.lobes ?? 5)));
  const BL = L - pet;
  // 갈래 방향 — 가운데 0, 밑 갈래 ±A(5갈래 ≈ 120°, 7갈래 ≈ 135°)
  const A = Math.min(2.35, 0.5 * (n - 1) + 0.1);
  const step = (2 * A) / (n - 1), hw = step / 2;
  const phis = Array.from({ length: n }, (_, k) => -A + k * step);
  const lens = phis.map((ph) => 0.6 + 0.4 * Math.cos(ph * 0.72)); // 가운데 1 → 밑 갈래 ≈ 0.6
  const SIN = 0.6; // 틈 깊이 — 이웃 갈래 짧은 쪽의 60% 자리(갈래가 잎몸의 1/3~1/2 깊이로 갈라짐)
  const sinus = phis.slice(0, -1).map((_, k) => SIN * Math.min(lens[k]!, lens[k + 1]!));
  const sBase = 0.13; // 잎자루 자리 오목(심장 밑)
  const acum = spec.tip === 'acuminate' ? 0.1 : spec.tip === 'acute' ? 0.05 : 0;
  const rounded = spec.tip === 'rounded' || spec.tip === 'obtuse';
  const toothed = detail && spec.margin !== 'entire';
  const rAt = (ph: number): number => {
    // 가장 가까운 갈래
    let k = Math.round((ph + A) / step);
    k = Math.max(0, Math.min(n - 1, k));
    const x = (ph - phis[k]!) / hw; // -1 ~ 1 (갈래 바깥쪽 밑 갈래는 넘을 수 있음)
    const Lk = lens[k]!;
    const sL = k > 0 ? sinus[k - 1]! : sBase, sR = k < n - 1 ? sinus[k]! : sBase;
    const s = x < 0 ? sL : sR;
    const ax = Math.min(1, Math.abs(x));
    if (Math.abs(x) >= 1) return sBase; // 밑 갈래 바깥 — 잎자루 쪽 오목
    // 갈래 몸: 볼록한 옆선 + 뾰족한 끝(둥근 끝 수종은 끝을 둥글게)
    const prof = rounded ? Math.pow(Math.cos((ax * Math.PI) / 2), 0.55) : Math.pow(1 - ax, 0.5); // 넓은 달걀꼴 갈래 + 좁은 V 틈
    let r = s + (Lk - s) * prof;
    r += Lk * acum * Math.max(0, 1 - ax / 0.12); // 점첨두 — 끝 짧은 꼬리
    return r;
  };
  // 단위 반지름 1 로 그린 뒤 길이(잎몸) = BL, 폭/길이 = widthRatio 로 맞춘다
  const K = detail ? 420 : 150;
  const raw: P[] = [];
  const gap = 0.05;
  let arc = 0, prev: P | null = null;
  for (let i = 0; i <= K; i++) {
    const ph = -Math.PI + gap + (i / K) * (2 * Math.PI - 2 * gap);
    let r = rAt(ph);
    const q0: P = [Math.cos(ph) * r, Math.sin(ph) * r];
    if (prev) arc += Math.hypot(q0[0] - prev[0], q0[1] - prev[1]);
    prev = q0;
    if (toothed && r > sBase * 1.4) {
      // 잔톱니 — 바깥 가장자리에서 둘레 길이로 고르게(톱니 끝이 갈래 끝 쪽을 향함)
      const u = (arc / 0.055) % 1;
      r *= 1 - 0.035 * u;
    }
    raw.push([Math.cos(ph) * r, Math.sin(ph) * r]);
  }
  const xs = raw.map((q) => q[0]), ys = raw.map((q) => q[1]);
  const len0 = Math.max(...xs) - Math.min(...xs), wid0 = Math.max(...ys) - Math.min(...ys);
  const sc = BL / len0;
  // 손바닥 잎은 폭 ≈ 길이(0.8~1.4) — 프리셋 widthRatio 가 홑잎 기준(0.5 등)으로 잘못 와도 납작해지지 않게
  const wr = Math.max(0.8, Math.min(1.4, spec.widthRatio > 0 ? spec.widthRatio : 1));
  const sy = (wr * len0) / wid0; // 폭 맞춤(세로 배율)
  const J: P = [pet, 0]; // 잎몸 밑(잎자루 끝) — 맥이 모이는 자리
  const tr = (q: P): P => [J[0] + q[0] * sc, q[1] * sc * sy];
  const ring = raw.map(tr);
  const veinLines: Array<[P, P]> = phis.map((ph, k) => [J, tr([Math.cos(ph) * lens[k]! * 0.9, Math.sin(ph) * lens[k]! * 0.9])]);
  // 그늘 반쪽 빗금 — 갈래마다 +y 쪽(그리는 쪽이 빛 반대쪽으로 뒤집는다), 맥 가까이에서 가장자리로
  const shade: Array<[P, P]> = [];
  phis.forEach((ph, k) => {
    const Lk = lens[k]!;
    for (let j = 0; j < 4; j++) {
      const t = 0.32 + j * 0.15;
      const a0 = ph + hw * 0.1, a1 = ph + hw * (0.62 - j * 0.08);
      shade.push([tr([Math.cos(a0) * Lk * t, Math.sin(a0) * Lk * t]), tr([Math.cos(a1) * Lk * (t + 0.06), Math.sin(a1) * Lk * (t + 0.06)])]);
    }
  });
  const outline = `${smoothOpen([...ring, ring[0]!])} Z M 0 0 L ${f1(J[0])} 0`;
  const veins = veinLines.map(([a, b]) => `M ${f1(a[0])} ${f1(a[1])} L ${f1(b[0])} ${f1(b[1])}`);
  const W = wid0 * sc * sy;
  return { outline, pts: [], midrib: `M 0 0 L ${f1(J[0])} 0`, veins, hw: (t) => (W / 2) * Math.sin(Math.PI * t), pet, W, L, ring, veinLines, shade };
}

/** 깃꼴 겹잎 — 잎축 + 작은잎 쌍 + 끝 작은잎. */
function pinnateLeaf(spec: LeafSpec, L: number, pet: number, detail: boolean): LeafG {
  const pairs = spec.lobes ?? 4;
  const sub: LeafSpec = { ...spec, shape: 'elliptic', petiole: 0.04 };
  const ll = (L - pet) / (pairs * 0.55 + 1.1);
  const parts: string[] = [];
  const veins: string[] = [];
  for (let k = 0; k < pairs; k++) {
    const x = pet + (k + 0.5) * ((L - pet - ll) / pairs);
    for (const s of [-1, 1]) {
      const g = leafGeom(sub, ll, detail);
      const a = s * (Math.PI / 2 - 0.5);
      const tr = (q: P): P => [x + q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
      parts.push(`M ${g.pts.map((q) => tr(q)).map((q) => `${f1(q[0])} ${f1(q[1])}`).join(' L ')} Z`);
      const e = tr([ll * 0.95, 0]);
      veins.push(`M ${f1(x)} 0 L ${f1(e[0])} ${f1(e[1])}`);
    }
  }
  const g = leafGeom(sub, ll * 1.1, detail);
  parts.push(`M ${g.pts.map((q) => `${f1(q[0] + L - ll * 1.1)} ${f1(q[1])}`).join(' L ')} Z`);
  return { outline: parts.join(' '), pts: [], midrib: `M 0 0 L ${f1(L - ll * 1.1)} 0`, veins, hw: () => ll * 0.3, pet, W: ll * 1.6, L };
}

// ── 꽃

export type FlowerG = {
  /** 먼 것부터 그릴 조각들. kind: petal·corolla·calyx·center·stamen·pedicel */
  pieces: Array<{ d: string; kind: 'petal' | 'corolla' | 'lobe' | 'calyx' | 'center' | 'stamen' | 'pedicel' | 'vein'; fill: boolean }>;
  /** 꽃 아래(꼭지) 붙는 점 — 원점 기준. */ attach: P;
};

/**
 * 꽃 하나 — 원점 = 꽃 가운데(펼친 꽃) 또는 꽃자루 붙는 점(항아리꽃, 아래로 숙임). size = 지름(px).
 * urceolate: 항아리 몸 + 끝 갈래(뒤로 젖힘) + 꽃받침(감 = 크고 넉 장). open: 꽃잎 n(겹꽃이면 두 겹) + 수술 다발 + 꽃받침 끝.
 */
export function flowerGeom(spec: FlowerSpec, size: number): FlowerG {
  const pieces: FlowerG['pieces'] = [];
  const n = spec.petals;
  if (spec.shape === 'urceolate' || spec.shape === 'tubular') {
    const w = size * (spec.shape === 'tubular' ? 0.5 : 0.78), h = size * (spec.shape === 'tubular' ? 1.2 : 0.95);
    // 아래로 숙인 항아리 — 위(0,0)가 꽃자루, 아래가 입
    const mouth = w * 0.38;
    const body = `M ${f1(-w * 0.28)} ${f1(h * 0.08)} C ${f1(-w * 0.62)} ${f1(h * 0.25)} ${f1(-w * 0.6)} ${f1(h * 0.78)} ${f1(-mouth)} ${f1(h * 0.9)} L ${f1(mouth)} ${f1(h * 0.9)} C ${f1(w * 0.6)} ${f1(h * 0.78)} ${f1(w * 0.62)} ${f1(h * 0.25)} ${f1(w * 0.28)} ${f1(h * 0.08)} Z`;
    pieces.push({ d: `M 0 ${f1(-h * 0.35)} L 0 ${f1(h * 0.05)}`, kind: 'pedicel', fill: false });
    pieces.push({ d: body, kind: 'corolla', fill: true });
    // 입 갈래(뒤로 젖힘)
    const lobes = Math.min(n, 5);
    for (let k = 0; k < lobes; k++) {
      const u = lobes === 1 ? 0 : k / (lobes - 1) - 0.5;
      const x0 = u * mouth * 2;
      pieces.push({ d: `M ${f1(x0 - mouth * 0.32)} ${f1(h * 0.9)} Q ${f1(x0 + u * w * 0.3)} ${f1(h * 1.08)} ${f1(x0 + u * w * 0.45 + mouth * 0.05)} ${f1(h * 1.0)} Q ${f1(x0 + mouth * 0.2)} ${f1(h * 0.95)} ${f1(x0 + mouth * 0.32)} ${f1(h * 0.9)} Z`, kind: 'lobe', fill: true });
    }
    for (const u of [-0.5, 0, 0.5]) pieces.push({ d: `M ${f1(u * w * 0.35)} ${f1(h * 0.15)} Q ${f1(u * w * 0.55)} ${f1(h * 0.5)} ${f1(u * mouth * 1.4)} ${f1(h * 0.86)}`, kind: 'vein', fill: false });
    // 꽃받침
    if (spec.calyx !== 'none') {
      const cs = spec.calyx === 'large' ? size * 0.62 : size * 0.26;
      const cn = spec.calyx === 'large' ? 4 : n;
      for (let k = 0; k < cn; k++) {
        const u = cn === 1 ? 0 : k / (cn - 1) - 0.5;
        const a = u * 2.4;
        const tip: P = [Math.sin(a) * cs, h * 0.08 + Math.cos(a) * cs * 0.55 - cs * 0.15];
        const bw = cs * (spec.calyx === 'large' ? 0.42 : 0.25);
        pieces.push({ d: `M ${f1(-bw * 0.6)} ${f1(h * 0.02)} Q ${f1(tip[0] * 0.5 - bw * Math.cos(a))} ${f1(tip[1] * 0.5 + bw * Math.sin(a) * 0.3)} ${f1(tip[0])} ${f1(tip[1])} Q ${f1(tip[0] * 0.5 + bw * Math.cos(a))} ${f1(tip[1] * 0.5 - bw * Math.sin(a) * 0.3)} ${f1(bw * 0.6)} ${f1(h * 0.02)} Z`, kind: 'calyx', fill: true });
      }
    }
    return { pieces, attach: [0, -h * 0.35] };
  }
  // 펼친 꽃(앞에서 본 접시) — 꽃잎 n 장(겹꽃이면 안쪽 한 겹 더, 조금 돌려서)
  const R = size / 2;
  const petal = (a: number, r0: number, r1: number, wid: number) => {
    const shape = spec.petalShape ?? 'round';
    const tipW = shape === 'pointed' ? 0.15 : shape === 'notched' ? 0.9 : 1;
    const ca = Math.cos(a), sa = Math.sin(a);
    const tr = (x: number, y: number): P => [x * ca - y * sa, x * sa + y * ca];
    const pts: P[] = [tr(r0, 0), tr(r0 + (r1 - r0) * 0.3, -wid * 0.75), tr(r0 + (r1 - r0) * 0.85, -wid * tipW), shape === 'notched' ? tr(r1 * 0.93, 0) : tr(r1, 0), tr(r0 + (r1 - r0) * 0.85, wid * tipW), tr(r0 + (r1 - r0) * 0.3, wid * 0.75)];
    return `${smoothOpen([...pts, pts[0]!])} Z`;
  };
  if (spec.calyx !== 'none') for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * Math.PI * 2; const ca = Math.cos(a), sa = Math.sin(a); pieces.push({ d: `M ${f1(ca * R * 0.3 - sa * R * 0.08)} ${f1(sa * R * 0.3 + ca * R * 0.08)} L ${f1(ca * R * 0.62)} ${f1(sa * R * 0.62)} L ${f1(ca * R * 0.3 + sa * R * 0.08)} ${f1(sa * R * 0.3 - ca * R * 0.08)} Z`, kind: 'calyx', fill: true }); }
  for (let k = 0; k < n; k++) pieces.push({ d: petal((k / n) * Math.PI * 2 - Math.PI / 2, R * 0.12, R, R * (n <= 5 ? 0.48 : 0.32)), kind: 'petal', fill: true });
  if (spec.double) for (let k = 0; k < n; k++) pieces.push({ d: petal(((k + 0.5) / n) * Math.PI * 2 - Math.PI / 2, R * 0.08, R * 0.68, R * 0.34), kind: 'petal', fill: true });
  pieces.push({ d: `M ${f1(-R * 0.16)} 0 a ${f1(R * 0.16)} ${f1(R * 0.16)} 0 1 0 ${f1(R * 0.32)} 0 a ${f1(R * 0.16)} ${f1(R * 0.16)} 0 1 0 ${f1(-R * 0.32)} 0 Z`, kind: 'center', fill: true });
  if (spec.stamens !== 'hidden') {
    const m = spec.stamens === 'many' ? 22 : 8;
    const st: string[] = [];
    for (let k = 0; k < m; k++) { const a = (k / m) * Math.PI * 2 + (k % 2) * 0.13; const rr = R * (0.32 + (k % 3) * 0.06); st.push(`M ${f1(Math.cos(a) * R * 0.1)} ${f1(Math.sin(a) * R * 0.1)} L ${f1(Math.cos(a) * rr)} ${f1(Math.sin(a) * rr)} m -1.2 0 a 1.2 1.2 0 1 0 2.4 0 a 1.2 1.2 0 1 0 -2.4 0`); }
    pieces.push({ d: st.join(' '), kind: 'stamen', fill: false });
  }
  return { pieces, attach: [0, 0] };
}

// ── 열매(감 말고)

export type FruitG = { body: string; rx: number; ry: number; details: Array<{ d: string; fill: boolean; dark?: boolean }>; top: P };

/** 열매 — 중심 (0,0), 반지름 r(가로 반). 형태별 몸 + 자국(꽃받침 자국·골·왕관·가시). 감은 persimmonFruit 를 쓴다. */
export function fruitGeom(spec: FruitSpec, r: number): FruitG {
  const ry = r * spec.ratio;
  const ell = (rx: number, rY: number, cx = 0, cy = 0) => `M ${f1(cx - rx)} ${f1(cy)} a ${f1(rx)} ${f1(rY)} 0 1 0 ${f1(2 * rx)} 0 a ${f1(rx)} ${f1(rY)} 0 1 0 ${f1(-2 * rx)} 0 Z`;
  const details: FruitG['details'] = [];
  let body = ell(r, ry);
  let top: P = [0, -ry];
  switch (spec.type) {
    case 'pome': {
      // 사과 — 위 오목한 꼭지 자리 + 꼭지, 아래 꽃받침 자국
      const pts: P[] = [];
      for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; const dent = Math.sin(a) < 0 ? 1 - 0.12 * Math.pow(Math.max(0, -Math.sin(a)), 6) : 1; pts.push([Math.cos(a) * r * (1 + 0.04 * Math.sin(a)), Math.sin(a) * ry * dent]); }
      body = `${smoothOpen([...pts, pts[0]!])} Z`;
      details.push({ d: `M ${f1(-r * 0.22)} ${f1(-ry * 0.86)} Q 0 ${f1(-ry * 0.72)} ${f1(r * 0.22)} ${f1(-ry * 0.86)}`, fill: false });
      details.push({ d: `M 0 ${f1(-ry * 0.8)} q ${f1(r * 0.04)} ${f1(-r * 0.25)} ${f1(r * 0.14)} ${f1(-r * 0.36)}`, fill: false, dark: true });
      details.push({ d: `M ${f1(-r * 0.1)} ${f1(ry * 0.9)} l ${f1(r * 0.05)} ${f1(-r * 0.05)} l ${f1(r * 0.05)} ${f1(r * 0.04)} l ${f1(r * 0.05)} ${f1(-r * 0.04)} l ${f1(r * 0.05)} ${f1(r * 0.05)}`, fill: false });
      top = [r * 0.14, -ry * 0.8 - r * 0.36];
      break;
    }
    case 'pear': {
      const pts: P[] = [];
      for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; const s = Math.sin(a); const neck = s < 0 ? 1 - 0.42 * Math.pow(-s, 1.6) : 1; pts.push([Math.cos(a) * r * neck, s * ry * (s < 0 ? 1.35 : 1)]); }
      body = `${smoothOpen([...pts, pts[0]!])} Z`;
      details.push({ d: `M 0 ${f1(-ry * 1.3)} q ${f1(r * 0.05)} ${f1(-r * 0.25)} ${f1(r * 0.16)} ${f1(-r * 0.32)}`, fill: false, dark: true });
      top = [r * 0.16, -ry * 1.3 - r * 0.32];
      break;
    }
    case 'drupe':
      // 핵과(매실·자두) — 한쪽 골(봉합선) + 꼭지 자리
      details.push({ d: `M ${f1(-r * 0.12)} ${f1(-ry * 0.95)} C ${f1(-r * 0.4)} ${f1(-ry * 0.3)} ${f1(-r * 0.38)} ${f1(ry * 0.4)} ${f1(-r * 0.08)} ${f1(ry * 0.97)}`, fill: false });
      details.push({ d: `M 0 ${f1(-ry * 0.95)} l ${f1(r * 0.03)} ${f1(-r * 0.18)}`, fill: false, dark: true });
      break;
    case 'berry': {
      // 장과(블루베리) — 아래 왕관 꽃받침(다섯 갈래 별)
      const cr = r * 0.32, cy = ry * 0.62;
      const star: P[] = [];
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2; const rr = k % 2 ? cr * 0.45 : cr; star.push([Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.45]); }
      details.push({ d: `M ${star.map((q) => `${f1(q[0])} ${f1(q[1])}`).join(' L ')} Z`, fill: true });
      details.push({ d: ell(cr * 0.35, cr * 0.16, 0, cy), fill: true, dark: true });
      break;
    }
    case 'jujube':
      details.push({ d: `M 0 ${f1(-ry)} l ${f1(r * 0.04)} ${f1(-r * 0.2)}`, fill: false, dark: true });
      break;
    case 'chestnut': {
      // 밤송이 — 가시 사방 + 벌어진 틈 사이 밤 알
      const sp: string[] = [];
      for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; const j = 1 + ((k * 37) % 7) / 20; sp.push(`M ${f1(Math.cos(a) * r * 0.85)} ${f1(Math.sin(a) * ry * 0.85)} L ${f1(Math.cos(a + 0.05) * r * 1.28 * j)} ${f1(Math.sin(a + 0.05) * ry * 1.28 * j)}`); }
      details.push({ d: sp.join(' '), fill: false });
      details.push({ d: `M ${f1(-r * 0.45)} ${f1(-ry * 0.1)} Q 0 ${f1(-ry * 0.55)} ${f1(r * 0.45)} ${f1(-ry * 0.1)} Q 0 ${f1(ry * 0.25)} ${f1(-r * 0.45)} ${f1(-ry * 0.1)} Z`, fill: true, dark: true });
      break;
    }
    default: break;
  }
  return { body, rx: r, ry, details, top };
}
