// 나무 모양 계산(순수, 2026-10-23 스타일 B 손질) — 재귀 생장(끝눈 우세·가늘어짐·자연 각도·바깥으로 갈수록 잔가지), 수종 변수(감나무 먼저),
// 나이(접목묘·어린 나무·성목) × 계절(잎·눈·열매)은 그리는 쪽이 고른다. 모양은 seed 로 고정(장면이 바뀌어도 같은 나무).
// 좌표: 밑동 (0,0), 위 = -y. 각도 θ: 0 = 위, + = 오른쪽.
import { random } from 'remotion';
import type { P } from './geom';
import { smoothOpen } from './geomHand';
import type { SpeciesProfile } from './species/schema';
import { PERSIMMON_PROFILE } from './species/presets';

const R = (seed: string, k: string | number) => random(`${seed}:${k}`);
/** 대략 정규분포(-1~1 근처). */
const N = (seed: string, k: string) => (R(seed, `${k}a`) + R(seed, `${k}b`) + R(seed, `${k}c`) - 1.5) / 0.75;
const dir = (th: number): P => [Math.sin(th), -Math.cos(th)];
const f1 = (n: number) => n.toFixed(1);

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export type TreeAge = 'sapling' | 'young' | 'mature';

/** 수종 변수 — 감나무가 기본. */
export type Species = {
  /** 맨 몸통(첫 원가지까지) 높이 / 키. */
  trunkFrac: Record<TreeAge, number>;
  /** 몸통 밑 굵기 / 키. */
  trunkW: Record<TreeAge, number>;
  /** 원가지 수(성목·어린 나무). */
  scaffolds: Record<TreeAge, number>;
  /** 곁가지 벌어짐(도, 평균) · 흔들림. */
  angle: number; angleJit: number;
  /** 수관 너비 / 수관 높이. */
  crownWH: number;
  /** 가지 끝이 바깥·아래로 처지는 정도(성목). */
  droop: number;
  /** 굽음(마디마다 각 흔들림, 라디안). */
  gnarl: number;
  /** 잔가지 지그재그. */
  zigzag: number;
  bark: 'blocky' | 'furrowed' | 'smooth';
  /** 잎 길이 / 키(성목 기준 — 그림에서 읽히게 실제보다 크게). 어린 나무는 따로 키운다. */
  leafLen: number;
  /** 잎 폭 / 길이. */
  leafWid: number;
  fruit: 'persimmon' | null;
  /** 수형 — 프리셋 habit.form */
  form: 'upright' | 'spreading' | 'round' | 'weeping' | 'shrub';
  /** 정아 우세(0~1) */
  apical: number;
  /** 관목 줄기 수 */
  stems: number;
  /** 엽서 */
  arrangement: 'alternate' | 'opposite' | 'whorled';
  /** 잎 처짐 */
  leafDroop: number;
  /** 열매 반지름 / 잎 길이(그림용 — 실제 비에 읽히게 키움) */
  fruitR: number;
  /** 송이 열매 수(1 = 하나씩) */
  fruitCluster: number;
  /** 꽃 — 자리·꽃차례 */
  flowerPos: 'axil' | 'tip' | 'oldWood';
  flowerInfl: 'solitary' | 'corymb' | 'raceme' | 'panicle';
  /** 원본 프리셋 */
  profile: SpeciesProfile;
  /**
   * (B6) 큰 잎 정도(0~1) — 잎몸 평균 12cm 이하 0, 22cm 이상 1(감·블루베리·일반형 = 0 → 종전과 같음).
   * Corner 법칙(잎이 클수록 가지는 굵고 성기다): 가지 수를 줄이고 잔가지를 굵게, 잎은 가지 끝에 모여 나고(> 0.5), 겨울눈·잎자국이 크다.
   */
  bigLeaf: number;
  /** (B6) 줄기·가지 가시(프리셋 habit.prickles). */
  prickles: boolean;
};

/** 종 프리셋 → 나무 모양 변수. 잎 길이는 실제 비(잎 cm / 키 m)에 나이별 과장 배수를 곱한다(성목 ×3.2, 어린 나무 ×1.4, 묘목 ×1). */
export function speciesFromProfile(pf: SpeciesProfile): Species {
  const leafCm = (pf.leaf.sizeCm[0] + pf.leaf.sizeCm[1]) / 2;
  const fruitCm = (pf.fruit.sizeCm[0] + pf.fruit.sizeCm[1]) / 2;
  const hM = (pf.habit.heightM[0] + pf.habit.heightM[1]) / 2;
  const shrub = pf.habit.form === 'shrub';
  // (B6) sizeCm 은 잎몸 길이 — 잎자루가 긴 수종(잎자루/잎몸 ≥ 0.4, 음나무 등)은 잎자루 몫만큼 늘려 잎몸이 제 크기로 보이게.
  // 잎자루 짧은 수종(감 0.1·블루베리 0.05·일반형 0.15)은 종전과 같다.
  const petK = pf.leaf.petiole >= 0.4 ? (1 + pf.leaf.petiole) / 1.1 : 1;
  const leafLen = ((leafCm / 100) / hM) * (shrub ? 1.6 : 3.2) * petK;
  const bigLeaf = shrub ? 0 : Math.max(0, Math.min(1, (leafCm - 12) / 10));
  const crownWH = pf.habit.form === 'upright' ? Math.min(pf.habit.crownWH, 0.7) : pf.habit.form === 'spreading' ? Math.max(pf.habit.crownWH, 1.4) : pf.habit.crownWH;
  return {
    trunkFrac: { sapling: 1, young: shrub ? 0.05 : 0.36, mature: shrub ? 0.04 : 0.27 },
    // (B6) 큰 잎 수종은 어린 줄기도 굵다(굵고 성긴 가지)
    trunkW: { sapling: 0.032 * (1 + 0.3 * bigLeaf), young: shrub ? 0.02 : 0.036 * (1 + 0.3 * bigLeaf), mature: shrub ? 0.024 : 0.085 },
    scaffolds: { sapling: 0, young: 3, mature: 5 },
    angle: pf.habit.branchAngle, angleJit: 12, crownWH, droop: pf.habit.form === 'weeping' ? 1.6 : 0.28, gnarl: 0.1, zigzag: 0.14,
    bark: pf.habit.bark === 'peeling' ? 'furrowed' : pf.habit.bark, leafLen, leafWid: pf.leaf.widthRatio,
    fruit: pf.fruit.type === 'persimmon' ? 'persimmon' : null,
    form: pf.habit.form, apical: pf.habit.apical, stems: pf.habit.stems ?? 1, arrangement: pf.leaf.arrangement, leafDroop: pf.leaf.droop ?? 0.3,
    // 감 지름 ≈ 잎 길이의 0.6배(실촬영 대조) — 반지름 = 잎 길이 × 0.3 남짓
    fruitR: Math.max(0.2, ((fruitCm / leafCm) * 0.5) * 1.15), fruitCluster: pf.fruit.bearing === 'cluster' ? (pf.fruit.clusterN ?? 6) : 1,
    flowerPos: pf.flower.position, flowerInfl: pf.flower.inflorescence, profile: pf,
    bigLeaf, prickles: pf.habit.prickles === true,
  };
}

export const PERSIMMON: Species = speciesFromProfile(PERSIMMON_PROFILE);

export type TStem = { pts: P[]; w: number[]; order: number; level: number; z: number };
/** 잎 — fs = 단축(잎몸 폭 배율 0.3~1: 비스듬히 보이는 잎), spring = 봄 새잎 자리(가지 끝 쪽 마디). */
export type TLeaf = { x: number; y: number; angle: number; len: number; z: number; order: number; keepAutumn: boolean; spring: boolean; shade: number; fs?: number };
export type TFruit = { x: number; y: number; r: number; order: number; tilt: number; hangX: number; hangY: number };
export type TFlower = { x: number; y: number; angle: number; order: number };
export type TBud = { x: number; y: number; angle: number; size: number; order: number; tip: boolean };
export type Tree2G = {
  stems: TStem[]; leaves: TLeaf[]; fruits: TFruit[]; buds: TBud[]; flowers: TFlower[];
  trunk: { top: number; w0: number; w1: number; pts: P[]; w: number[] };
  /** 접붙인 자리(묘목·어린 나무) — 높이(음수 y), 몸통 굵기, 접수가 비켜 선 거리, 꺾인 각(라디안). */
  graft?: { y: number; w: number; dx: number; kink?: number };
  /** 대목 움(접목묘 — 접붙인 자리 아래에서 나온 가는 순). 그리는 쪽이 suckers 일 때만. */
  suckers?: TStem[];
  crown: { x0: number; y0: number; x1: number; y1: number };
};

const UNIT = 1000;

/**
 * 감나무(기본 수종) 모양 — h = 키(px). 나이마다 다른 짜임:
 * sapling = 1~2년 접목묘(외줄기 + 위쪽 잔가지 둘셋, 접붙인 자리 혹, 마디마다 눈),
 * young = 3~5년(몸통 + 원가지 셋 + 중심 가지, 2단 곁가지), mature = 성목(굵은 몸통·뿌리목 퍼짐·원가지 다섯·4단 곁가지, 넓은 둥근 수관).
 */
export function treeGeom2(seed: string, h: number, age: TreeAge, sp: Species = PERSIMMON): Tree2G {
  const out: Tree2G = { stems: [], leaves: [], fruits: [], buds: [], flowers: [], trunk: { top: 0, w0: 0, w1: 0, pts: [], w: [] }, crown: { x0: 0, y0: 0, x1: 0, y1: 0 } };
  const H = UNIT;
  const tH = H * sp.trunkFrac[age];
  const w0 = H * sp.trunkW[age];
  // 어린 나무는 원가지 + 곁가지 한 단(잎이 커서 성글게 — 실촬영 3~5년생처럼 낱잎이 보인다), 관목은 두 단
  // (B6) 큰 잎 수종 성목은 한 단 덜 갈라진다(굵은 가지가 성기게)
  const maxLevel = age === 'mature' ? ((sp.bigLeaf ?? 0) > 0.5 ? 2 : 3) : age === 'young' ? 2 : 1;
  const segLen = H * (age === 'mature' ? 0.024 : 0.03);
  // 잎 길이 — 어린 나무·묘목은 실촬영 비율(잎 ≈ 키의 1/9~1/10)로 크게
  // (B6) 큰 잎 수종 — 성목도 잎 갈래가 읽히게 더 키우고(×1.3 → 최대 ×2.8), 어린 나무 잎몸 ≈ 키의 1/8, 묘목 ≈ 1/8~1/10.
  const bl = sp.bigLeaf ?? 0;
  const crowd = bl > 0.5; // 잎이 가지 끝에 모여 난다(긴 잎자루로 사방에 펼침)
  const leafLen = H * (sp.form === 'shrub' ? sp.leafLen * 1.8 : age === 'mature' ? sp.leafLen * (1.3 + 1.5 * bl) : age === 'young' ? sp.leafLen * 4.0 * (1 + 0.05 * bl) : sp.leafLen * 3.0 * (1 + 0.3 * bl));
  // 수관 타원(성목·어린 나무)
  const ry = (H - tH) * (sp.form === 'shrub' ? 0.5 : 0.54);
  const cy = -H + ry;
  const rx = ry * (age === 'mature' ? sp.crownWH : sp.crownWH * 0.8);
  const inEnv = (p: P, slack: number) => (p[0] / rx) ** 2 + ((p[1] - cy) / ry) ** 2 <= 1 + slack;
  /** 수관 끝까지 거리 — 밖에서 시작하면 안으로 들어간 뒤부터 잰다. */
  const envDist = (p: P, th: number) => {
    let d = 0, seen = inEnv(p, 0);
    const st = H * 0.01;
    while (d < H * 1.5) {
      const q: P = [p[0] + dir(th)[0] * d, p[1] + dir(th)[1] * d];
      const inside = inEnv(q, 0);
      if (inside) seen = true; else if (seen) break;
      if (!seen && d > H * 0.25) return H * 0.08;
      d += st;
    }
    return d;
  };

  /** 가지 하나 — 점들(마디 흔들림·처짐), 굵기 배열. */
  const limb = (start: P, th0: number, len: number, wStart: number, wEnd: number, key: string, level: number, opts: { up?: number; droop?: number; zig?: number; env?: boolean } = {}) => {
    const n = Math.max(3, Math.round(len / segLen));
    const sl = len / n;
    const pts: P[] = [start];
    const ths: number[] = [];
    let th = th0;
    let wasIn = false;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      th += N(seed, `${key}g${i}`) * sp.gnarl * (level >= 2 ? 1.2 : 1) * Math.min(1.4, 2.4 / Math.sqrt(n));
      // 처짐(바깥 끝이 바깥·아래로) · 곧추섬(위로)
      if (opts.droop) th += opts.droop * Math.sin(th) * 0.08 * t;
      if (opts.up) th -= opts.up * th * 0.12;
      if (opts.zig) th += (i % 2 ? 1 : -1) * opts.zig;
      const prev = pts[i - 1]!;
      const q: P = [prev[0] + dir(th)[0] * sl, prev[1] + dir(th)[1] * sl];
      if (opts.env) { if (inEnv(q, 0)) wasIn = true; else if (wasIn && i > 2 && !inEnv(q, 0.06 + R(seed, `${key}e`) * 0.12)) break; }
      pts.push(q);
      ths.push(th);
    }
    const m = pts.length - 1;
    const w = pts.map((_, i) => wStart + (wEnd - wStart) * (i / Math.max(1, m)));
    return { pts, w, ths, len: sl * m };
  };
  const along = (pts: P[], t: number): { p: P; i: number } => {
    const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), k = f - i;
    return { p: [pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * k, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * k], i };
  };
  const thAt = (pts: P[], i: number) => { const a = pts[Math.max(0, i)]!, b = pts[Math.min(pts.length - 1, i + 1)]!; return Math.atan2(b[0] - a[0], -(b[1] - a[1])); };

  /**
   * 잎·눈·열매를 잔가지에 단다(2026-10-23 B3) — 잎은 마디마다 어긋나게 한 장씩(잎자루 짧게), 각도·단축(비스듬히 보임)·크기를 달리한다.
   * 끝엔 한 장만(로제트 금지). 봄 새잎 = 끝 쪽 두 마디 + 끝. 감은 마디(잎겨드랑이) 바로 밑에 짧은 꼭지로 바짝 붙는다.
   */
  const dress = (pts: P[], key: string, order: number, z: number, leafScale = 1, nodes = 4) => {
    const L = pts.length;
    if (crowd) { dressCrowded(pts, key, order, z, leafScale, nodes); return; }
    const per = sp.arrangement === 'opposite' ? 2 : sp.arrangement === 'whorled' ? 3 : 1;
    const s0 = R(seed, `${key}s0`) < 0.5 ? 1 : -1;
    const dr = sp.leafDroop * 0.8;
    for (let j = 0; j < nodes; j++) {
      const t = 0.16 + (j / Math.max(1, nodes - 1)) * 0.74 + (R(seed, `${key}nt${j}`) - 0.5) * 0.06;
      const { p, i } = along(pts, Math.min(0.97, t));
      const th = thAt(pts, i);
      for (let q = 0; q < per; q++) {
        const side = per === 1 ? (j % 2 === 0 ? s0 : -s0) : per === 2 ? (q === 0 ? 1 : -1) : [1, -1, 0.15][q]!;
        const ang = th + side * (0.5 + R(seed, `${key}la${j}${q}`) * 0.85) + (per === 2 && j % 2 ? 0.2 : 0);
        // 잎은 아래로 처진다(잎자루가 휘어) — 종 프리셋 droop, 잎마다 다르게
        const d = dr * (0.5 + R(seed, `${key}ld${j}${q}`) * 0.8);
        const droopA = ang + (Math.sin(ang) > 0 ? d : -d) * (1 - Math.abs(Math.cos(ang)));
        // 마디 아래쪽 잎은 작고 가운데·위가 크다(감 새 가지)
        const sz = (0.68 + R(seed, `${key}ls${j}${q}`) * 0.4) * (0.78 + 0.32 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.15)));
        const fs = R(seed, `${key}lf${j}${q}`) < 0.25 ? 0.45 + R(seed, `${key}lg${j}${q}`) * 0.25 : 0.84 + R(seed, `${key}lg${j}${q}`) * 0.16;
        out.leaves.push({ x: p[0], y: p[1], angle: droopA, len: leafLen * leafScale * sz, z: z + N(seed, `${key}lz${j}${q}`) * 0.5, order: Math.min(1, order + 0.1 + t * 0.12), keepAutumn: R(seed, `${key}ka${j}${q}`) < 0.55, spring: j >= nodes - 2, shade: 0, fs });
        if (sp.flowerPos === 'axil' && R(seed, `${key}fl${j}${q}`) < 0.35) out.flowers.push({ x: p[0], y: p[1], angle: th + side * 0.4, order: Math.min(1, order + 0.2) });
      }
      out.buds.push({ x: p[0], y: p[1], angle: th + (j % 2 ? -0.55 : 0.55) * s0, size: Math.max(2.2, leafLen * 0.11), order, tip: false });
    }
    const tip = pts[L - 1]!, tth = thAt(pts, L - 2);
    out.leaves.push({ x: tip[0], y: tip[1], angle: tth + (R(seed, `${key}tt`) - 0.5) * 0.7, len: leafLen * leafScale * (0.72 + R(seed, `${key}tl`) * 0.2), z: z + 0.3, order: Math.min(1, order + 0.25), keepAutumn: R(seed, `${key}tk`) < 0.55, spring: true, shade: 0, fs: 0.6 + R(seed, `${key}tf`) * 0.4 });
    out.buds.push({ x: tip[0], y: tip[1], angle: tth, size: Math.max(2.6, leafLen * 0.14), order: order + 0.1, tip: true });
    if (sp.flowerPos !== 'axil' && R(seed, `${key}ft`) < 0.6) out.flowers.push({ x: tip[0], y: tip[1], angle: tth, order: Math.min(1, order + 0.25) });
    const fruitP = sp.fruitCluster > 1 ? 0.55 : age === 'mature' ? 0.32 : age === 'young' ? 0.3 : 0;
    if (R(seed, `${key}fr`) < fruitP) {
      if (sp.fruitCluster > 1) {
        // 송이(블루베리) — 가지 끝 쪽 짧은 꽃대에 알이 모여 달린다
        const { p } = along(pts, 0.7 + R(seed, `${key}fp`) * 0.25);
        const r = leafLen * 0.2 * (0.85 + R(seed, `${key}fs`) * 0.3);
        const nC = sp.fruitCluster;
        for (let c = 0; c < nC; c++) {
          const a = (c / Math.max(1, nC)) * Math.PI * 2 + R(seed, `${key}fa${c}`);
          const rr = c === 0 ? 0 : r * (c > 4 ? 2.1 : 1.25);
          out.fruits.push({ x: p[0] + Math.cos(a) * rr, y: p[1] + r * 1.2 + Math.sin(a) * rr * 0.8 + c * r * 0.12, r: r * (0.88 + R(seed, `${key}fq${c}`) * 0.24), order: Math.min(1, order + 0.3), tilt: 0, hangX: p[0], hangY: p[1] });
        }
      } else {
        // 감 — 잎겨드랑이 바로 밑, 꽃받침이 가지에 닿게(꼭지는 꽃받침에 가려 거의 안 보임). 한 가지에 하나, 가끔 둘.
        const r0 = leafLen * sp.fruitR * (age === 'mature' ? 1.3 : 1);
        const twigLen = pts.slice(1).reduce((a2, q, i2) => a2 + Math.hypot(q[0] - pts[i2]![0], q[1] - pts[i2]![1]), 0);
        const nF = R(seed, `${key}f2`) < 0.3 && twigLen > r0 * 4.4 ? 2 : 1;
        for (let c = 0; c < nF; c++) {
          const { p, i } = along(pts, nF === 2 ? 0.25 + c * 0.5 : 0.3 + R(seed, `${key}fp${c}`) * 0.35);
          const r = r0 * (0.88 + R(seed, `${key}fs${c}`) * 0.24);
          const th = thAt(pts, i);
          // 곧추선 가지 — 감은 가지 옆에 매달린다(꽃받침이 가지 옆면에 닿게, 옆으로 기움). 누운 가지 — 바로 밑에 매달린다.
          const upright = Math.abs(Math.sin(th)) < 0.6;
          const sd = (c % 2 === 0 ? 1 : -1) * (R(seed, `${key}fd`) < 0.5 ? 1 : -1);
          const tilt = upright ? sd * (18 + R(seed, `${key}ft${c}`) * 14) : Math.max(-20, Math.min(20, (R(seed, `${key}ft${c}`) - 0.5) * 24));
          const hx = p[0] + (upright ? sd * r * 0.55 : 0), hy = p[1] + (upright ? r * 0.1 : 0);
          const ta = (tilt * Math.PI) / 180;
          out.fruits.push({ x: hx - Math.sin(ta) * r * 0.68, y: hy + Math.cos(ta) * r * 0.68, r, order: Math.min(1, order + 0.3), tilt, hangX: hx, hangY: hy });
        }
      }
    }
  };

  /**
   * (B6) 큰 잎 수종(음나무류) — 잎은 가지 끝에 모여 난다: 끝에서 긴 잎자루 3~4장이 부채꼴로 퍼지고(바깥 것일수록 처짐),
   * 가지 중간 마디는 눈(겨울)·잎자국만, 긴 가지면 중간에 한 장. 가지 끝 겨울눈은 크다.
   */
  const dressCrowded = (pts: P[], key: string, order: number, z: number, leafScale: number, nodes: number) => {
    const L = pts.length;
    const s0 = R(seed, `${key}s0`) < 0.5 ? 1 : -1;
    const dr = sp.leafDroop * 0.8;
    const twigLen = pts.slice(1).reduce((a2, q, i2) => a2 + Math.hypot(q[0] - pts[i2]![0], q[1] - pts[i2]![1]), 0);
    // 줄기(묘목 외줄기 — nodes ≥ 6)는 위쪽 마디에도 어긋나게 몇 장(실촬영 1~2년생: 위 절반에 큰 잎이 띄엄띄엄 + 끝에 모임)
    const stemLike = nodes >= 6;
    const nn = stemLike ? 4 : Math.max(1, Math.min(nodes, 3));
    const midN = stemLike ? 3 : 1;
    for (let j = 0; j < nn; j++) {
      const t = 0.3 + (j / Math.max(1, nn)) * 0.55 + (R(seed, `${key}nt${j}`) - 0.5) * 0.06;
      const { p, i } = along(pts, Math.min(0.92, t));
      const th = thAt(pts, i);
      const side = j % 2 === 0 ? s0 : -s0;
      out.buds.push({ x: p[0], y: p[1], angle: th + side * 0.55, size: Math.max(2.2, leafLen * 0.09), order, tip: false });
      // 긴 가지 — 가운데 마디에 한 장(옆으로 퍼져 처짐)
      if (j >= nn - midN && twigLen > leafLen * 1.1 && (stemLike || R(seed, `${key}ml`) < 0.7)) {
        const a = th + side * (0.9 + R(seed, `${key}ma${j}`) * 0.5);
        const d = dr * (0.6 + R(seed, `${key}md${j}`) * 0.6);
        out.leaves.push({ x: p[0], y: p[1], angle: a + (Math.sin(a) > 0 ? d : -d) * (1 - Math.abs(Math.cos(a))), len: leafLen * leafScale * (0.78 + R(seed, `${key}mls${j}`) * 0.2), z: z + N(seed, `${key}mz${j}`) * 0.5, order: Math.min(1, order + 0.15), keepAutumn: R(seed, `${key}mka${j}`) < 0.55, spring: false, shade: 0, fs: 0.8 + R(seed, `${key}mf${j}`) * 0.2 });
      }
    }
    const tip = pts[L - 1]!, tth = thAt(pts, L - 2);
    const nc = 3 + (R(seed, `${key}nc`) < 0.45 ? 1 : 0);
    const spread = 1.05 + R(seed, `${key}sp`) * 0.35;
    for (let c = 0; c < nc; c++) {
      const u = nc === 1 ? 0 : (c / (nc - 1)) * 2 - 1;
      const a = tth + u * spread + (R(seed, `${key}ca${c}`) - 0.5) * 0.3;
      const d = dr * (0.4 + Math.abs(u) * 0.9) * (0.7 + R(seed, `${key}cd${c}`) * 0.5);
      const droopA = a + (Math.sin(a) > 0 ? d : -d) * (1 - Math.abs(Math.cos(a)) * 0.6);
      out.leaves.push({ x: tip[0], y: tip[1], angle: droopA, len: leafLen * leafScale * (0.82 + R(seed, `${key}cl${c}`) * 0.26) * (1 - 0.12 * Math.abs(u)), z: z + N(seed, `${key}cz${c}`) * 0.5 + (Math.abs(u) < 0.4 ? 0.25 : 0), order: Math.min(1, order + 0.2 + c * 0.02), keepAutumn: R(seed, `${key}ck${c}`) < 0.6, spring: true, shade: 0, fs: 0.78 + R(seed, `${key}cf${c}`) * 0.22 });
    }
    out.buds.push({ x: tip[0], y: tip[1], angle: tth, size: Math.max(2.6, leafLen * 0.16), order: order + 0.1, tip: true });
    if (sp.flowerPos !== 'axil' && R(seed, `${key}ft`) < 0.6) out.flowers.push({ x: tip[0], y: tip[1], angle: tth, order: Math.min(1, order + 0.25) });
    if (sp.fruitCluster > 1 && R(seed, `${key}fr`) < 0.55) {
      const r = leafLen * 0.2 * (1 - 0.7 * bl);
      for (let c = 0; c < sp.fruitCluster; c++) {
        const a = (c / sp.fruitCluster) * Math.PI * 2 + R(seed, `${key}fa${c}`);
        const rr = c === 0 ? 0 : r * (c > 4 ? 2.1 : 1.25);
        out.fruits.push({ x: tip[0] + Math.cos(a) * rr, y: tip[1] - r * 1.6 + Math.sin(a) * rr * 0.8, r: r * (0.88 + R(seed, `${key}fq${c}`) * 0.24), order: Math.min(1, order + 0.3), tilt: 0, hangX: tip[0], hangY: tip[1] });
      }
    }
  };

  const grow = (start: P, th0: number, len: number, wS: number, level: number, order: number, key: string, z: number) => {
    const isTwig = level >= maxLevel;
    const g = limb(start, th0, len, wS, wS * (isTwig ? 0.45 + 0.2 * bl : level === 1 ? 0.28 + 0.12 * bl : 0.35 + 0.12 * bl), key, level, { droop: sp.form === 'weeping' ? sp.droop * (0.4 + level / maxLevel) : age === 'mature' ? sp.droop * Math.max(0, (level - 1) / maxLevel) : 0, up: age === 'young' ? 0.25 : level === 1 ? 0.12 : 0, zig: isTwig ? sp.zigzag : 0, env: level >= 1 });
    out.stems.push({ pts: g.pts, w: g.w, order, level, z });
    if (g.pts.length < 2) return;
    // 관목 줄기 — 줄기 위쪽에도 잎이 어긋나게 줄지어 난다(블루베리: 작은 타원 잎 낱장)
    if (sp.form === 'shrub' && level === 1) dress(g.pts.slice(Math.floor(g.pts.length * 0.3)), `${key}m`, Math.min(1, order + 0.1), z, 0.9, 9);
    if (isTwig) {
      // 1년생 잔가지(짧은 새 가지) 두셋 + 잎·눈·열매
      const sparse = age !== 'mature';
      const nShoot = crowd ? (!sparse && R(seed, `${key}ns`) > 0.6 ? 1 : 0) : sparse ? (R(seed, `${key}ns`) > 0.55 ? 1 : 0) : 1 + (R(seed, `${key}ns`) > 0.4 ? 1 : 0);
      for (let k = 0; k < nShoot; k++) {
        const t = 0.55 + (k / nShoot) * 0.45;
        const { p, i } = along(g.pts, Math.min(0.98, t));
        const th = thAt(g.pts, i) + (k % 2 ? 1 : -1) * (0.5 + R(seed, `${key}sa${k}`) * 0.4);
        const sl = H * (0.028 + R(seed, `${key}sl${k}`) * 0.025);
        const s = limb(p, th, sl, Math.max(1.4, g.w[i]! * 0.55), 1.1, `${key}s${k}`, level + 1, { zig: sp.zigzag * 1.2 });
        out.stems.push({ pts: s.pts, w: s.w, order: Math.min(1, order + 0.12), level: level + 1, z });
        dress(s.pts, `${key}s${k}`, Math.min(1, order + 0.14), z, 1, 3);
      }
      dress(g.pts.slice(Math.floor(g.pts.length * (sparse ? 0.12 : 0.3))), key, order, z, 1, sparse ? 5 : 3);
      return;
    }
    const nKids0 = level === 0 ? 0 : (age === 'mature' ? [0, 5, 4, 3] : [0, 3, 3, 2])[level] ?? 2;
    // (B6) 큰 잎 수종 — 가지가 성기다(Corner 법칙)
    const nKids = bl > 0 ? Math.max(level === 0 ? 0 : 1, Math.round(nKids0 * (1 - 0.45 * bl))) : nKids0;
    for (let k = 0; k < nKids; k++) {
      const t = 0.22 + (k / Math.max(1, nKids - 1)) * 0.7 + (R(seed, `${key}kt${k}`) - 0.5) * 0.08;
      const { p, i } = along(g.pts, Math.min(0.95, Math.max(0.1, t)));
      const th = thAt(g.pts, i);
      const side = (k % 2 === 0 ? 1 : -1) * (R(seed, `${key}ks${k}`) < 0.15 ? -1 : 1);
      let cth = th + side * ((sp.angle + N(seed, `${key}ka${k}`) * sp.angleJit) * Math.PI / 180);
      // 바깥(수관 밖 방향)으로 살짝 끌림 — 빛 쪽
      const out0 = Math.atan2(p[0], -(p[1] - cy) * 0.8);
      cth = cth * 0.8 + out0 * 0.2;
      let shorten = 1;
      if (Math.abs(cth) > 1.75) { cth = Math.sign(cth) * (1.75 - (Math.abs(cth) - 1.75) * 0.3); shorten = 0.55; }
      const room = envDist(p, cth);
      const L = shorten * Math.min(room * (0.75 + R(seed, `${key}kr${k}`) * 0.25), g.len * (0.62 - 0.28 * t) * (0.85 + R(seed, `${key}kl${k}`) * 0.3));
      if (L < H * 0.025) { dress([p, [p[0] + dir(cth)[0] * H * 0.03, p[1] + dir(cth)[1] * H * 0.03]], `${key}d${k}`, order + 0.2, z, 0.9, 2); continue; }
      const wi = g.w[i]! * (0.58 + 0.1 * bl + R(seed, `${key}kw${k}`) * 0.1);
      grow(p, cth, L, wi, level + 1, Math.min(1, order + 0.17), `${key}${k}`, z + N(seed, `${key}kz${k}`) * 0.4);
    }
    // 끝 — 가지 끝도 잔가지로 마무리
    if (level >= 1 && level < maxLevel) {
      const tip = g.pts[g.pts.length - 1]!;
      const th = g.ths[g.ths.length - 1] ?? th0;
      grow(tip, th + N(seed, `${key}et`) * 0.2, Math.max(H * 0.035, g.len * 0.3), g.w[g.w.length - 1]! * 0.9, maxLevel, Math.min(1, order + 0.2), `${key}e`, z);
    }
  };

  if (sp.form === 'shrub') {
    // 관목(다간) — 땅에서 줄기 여럿이 비스듬히 올라와 끝이 바깥으로 휜다
    const n = Math.max(2, sp.stems);
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1) - 0.5;
      const th = u * 0.9 + N(seed, `sh${k}`) * 0.08;
      const L = H * (0.82 + R(seed, `shl${k}`) * 0.18) * (1 - Math.abs(u) * 0.35);
      grow([u * w0 * 3, 0], th, L, w0 * (0.9 + R(seed, `shw${k}`) * 0.2), 1, 0.05 + k * 0.04, `sh${k}`, N(seed, `shz${k}`) * 0.6);
    }
    out.trunk = { top: -H * 0.1, w0, w1: w0, pts: [[0, 0], [0, -H * 0.1]], w: [w0, w0] };
  } else if (age === 'sapling') {
    // 접목묘(1~2년 회초리) — 대목(짧고 굵음) + 접붙인 자리 혹(접수가 살짝 비켜 꺾여 선다) + 접수 외줄기(가늘어짐),
    // 짧은 곁순 3~6(위로 갈수록 짧게), 마디마다 어긋난 겨울눈. 대목 움(suckers)은 그리는 쪽이 고른다.
    const graftH = H * 0.1;
    const lean = (R(seed, 'lean') - 0.5) * 0.03;
    const gs = R(seed, 'gdx') > 0.5 ? 1 : -1;
    const stock = limb([0, 0], lean * 0.5, graftH, w0 * 1.12, w0 * 1.02, 'stk', 0, {});
    const dx = w0 * 0.3 * gs;
    const top = stock.pts[stock.pts.length - 1]!;
    const kink = 0.11 * -gs; // 접수가 접면에서 비스듬히 시작했다가 곧추선다
    const scion = limb([top[0] + dx, top[1]], lean + kink, H - graftH, w0 * 0.96, w0 * 0.3, 'scn', 0, { up: 0.9 });
    const pts = [...stock.pts, ...scion.pts.slice(1)];
    const w = [...stock.w, ...scion.w.slice(1)];
    // 접붙인 자리 혹 — 접면 위아래로 1.4배 부풀었다 가라앉는다
    const gi = stock.pts.length - 1;
    for (let i = 0; i < w.length; i++) { const d = (i - gi) / 1.6; w[i] = w[i]! * (1 + 0.42 * Math.exp(-d * d)); }
    out.stems.push({ pts, w, order: 0, level: 0, z: 0 });
    out.trunk = { top: -H, w0: w0 * 1.12, w1: w0 * 0.3, pts, w };
    out.graft = { y: top[1], w: w0 * 1.45, dx, kink };
    // 곁순 — 3~6, 아래 것이 조금 길고 위로 갈수록 짧게(회초리 묘목 깃가지)
    const nLat = crowd ? 1 + Math.floor(R(seed, 'nl') * 2) : 3 + Math.floor(R(seed, 'nl') * 4);
    for (let k = 0; k < nLat; k++) {
      const t = 0.38 + (k / Math.max(1, nLat - 1)) * 0.5 + (R(seed, `lt${k}`) - 0.5) * 0.05;
      const { p, i } = along(pts, Math.min(0.93, t));
      const side = (k % 2 === 0 ? 1 : -1) * gs;
      const th = thAt(pts, i) + side * (0.55 + R(seed, `la${k}`) * 0.35);
      // (B4) 장면 크기(h 300~450px)에서도 곁순이 읽히게 — 실제 깃가지 묘목 곁순 ≈ 키의 12~25%
      const ln = H * (0.14 + R(seed, `ll${k}`) * 0.1) * (1.35 - t * 0.8);
      const g = limb(p, th, ln, Math.max(2.2, w[i]! * 0.42), 1.3, `lat${k}`, 1, { up: 0.5, zig: sp.zigzag });
      out.stems.push({ pts: g.pts, w: g.w, order: 0.4 + t * 0.3, level: 1, z: side * 0.3 });
      dress(g.pts, `lat${k}`, 0.55 + t * 0.3, side * 0.3, 0.85, 2);
    }
    // 대목 움 — 접붙인 자리 아래에서 한두 가닥
    out.suckers = [];
    const nSk = 1 + (R(seed, 'nsk') > 0.5 ? 1 : 0);
    for (let k = 0; k < nSk; k++) {
      const sd = k % 2 === 0 ? -gs : gs;
      const { p } = along(stock.pts, 0.25 + k * 0.35);
      const g = limb([p[0] + sd * w0 * 0.4, p[1]], sd * (0.45 + R(seed, `ska${k}`) * 0.3), H * (0.06 + R(seed, `skl${k}`) * 0.05), w0 * 0.3, 1.0, `sk${k}`, 1, { up: 0.6 });
      out.suckers.push({ pts: g.pts, w: g.w, order: 0.3, level: 1, z: 0 });
    }
    // 줄기 위 눈·잎(위쪽 2/3)
    dress(pts.slice(Math.floor(pts.length * (crowd ? 0.45 : 0.3))), 'stem', 0.3, 0.1, 1.05, 7);
  } else {
    // 몸통 — 뿌리목 퍼짐 + 살짝 굽음
    const trunk = limb([0, 0], (R(seed, 'tl') - 0.5) * 0.08, tH, w0, w0 * 0.72, 'tr', 0, { up: 0.5 });
    // 뿌리목 퍼짐(아래 6%)
    trunk.w.forEach((ww, i) => { const t = i / (trunk.w.length - 1); trunk.w[i] = ww * (1 + (age === 'mature' ? 0.75 : 0.35) * Math.exp(-t / 0.07)); });
    const top = trunk.pts[trunk.pts.length - 1]!;
    out.stems.push({ pts: trunk.pts, w: trunk.w, order: 0, level: 0, z: 0 });
    out.trunk = { top: top[1], w0: trunk.w[Math.round(trunk.w.length * 0.4)] ?? w0, w1: w0 * 0.72, pts: trunk.pts, w: trunk.w };
    if (age === 'young') out.graft = { y: -H * 0.05, w: w0 * 1.25, dx: 0 };
    // 중심 가지 — 원가지처럼(곧은 장대가 되지 않게 살짝 기울고 굽는다)
    const lth = (R(seed, 'll') - 0.5) * 0.36;
    grow(top, lth * (1 - sp.apical * 0.6), envDist(top, lth) * (0.7 + 0.25 * sp.apical), w0 * (0.36 + 0.2 * sp.apical), 1, 0.12, 'ld', 0);
    // 원가지
    const nS = sp.scaffolds[age];
    for (let k = 0; k < nS; k++) {
      // 고르게 — 왼쪽·오른쪽 번갈아, 바깥 것일수록 눕는다
      const side = k % 2 === 0 ? -1 : 1;
      const rank = Math.floor(k / 2) / Math.max(1, Math.ceil(nS / 2) - 1);
      const th = side * (0.5 + rank * 0.62 + N(seed, `sa${k}`) * 0.08);
      const t = 0.84 + R(seed, `st${k}`) * 0.16;
      const { p } = along(trunk.pts, Math.min(1, t));
      const L = envDist(p, th) * (0.8 + R(seed, `sl${k}`) * 0.18);
      grow(p, th, L, w0 * (0.38 + R(seed, `sw${k}`) * 0.08), 1, 0.15 + k * 0.03, `s${k}`, N(seed, `sz${k}`) * 0.7);
    }
  }

  // 키 맞추기 — 꼭대기(잎 포함)가 -h.
  const ys = [...out.stems.flatMap((s) => s.pts.map((q) => q[1])), ...out.leaves.map((l) => l.y - l.len * 0.7)];
  const k = h / -Math.min(...ys);
  const sc = (q: P): P => [q[0] * k, q[1] * k];
  out.stems = out.stems.map((s) => ({ ...s, pts: s.pts.map(sc), w: s.w.map((x) => x * k) }));
  out.leaves = out.leaves.map((l) => ({ ...l, x: l.x * k, y: l.y * k, len: l.len * k }));
  out.fruits = out.fruits.map((f) => ({ ...f, x: f.x * k, y: f.y * k, r: f.r * k, hangX: f.hangX * k, hangY: f.hangY * k }));
  out.buds = out.buds.map((b) => ({ ...b, x: b.x * k, y: b.y * k, size: b.size * k }));
  out.flowers = out.flowers.map((fl) => ({ ...fl, x: fl.x * k, y: fl.y * k }));
  out.trunk = { top: out.trunk.top * k, w0: out.trunk.w0 * k, w1: out.trunk.w1 * k, pts: out.trunk.pts.map(sc), w: out.trunk.w.map((x) => x * k) };
  if (out.graft) {
    out.graft = { ...out.graft, y: out.graft.y * k, w: out.graft.w * k, dx: out.graft.dx * k };
    // 접면 흉 너비 = 그 높이의 실제 몸통 굵기
    const gy = out.graft.y;
    let bi = 0;
    out.trunk.pts.forEach((q, i) => { if (Math.abs(q[1] - gy) < Math.abs(out.trunk.pts[bi]![1] - gy)) bi = i; });
    out.graft.w = out.trunk.w[bi] ?? out.graft.w;
  }
  if (out.suckers) out.suckers = out.suckers.map((s) => ({ ...s, pts: s.pts.map(sc), w: s.w.map((x) => x * k) }));
  // 잎 그늘(수관 오른쪽 아래·뒤쪽일수록 짙게)
  if (out.leaves.length) {
    const xs = out.leaves.map((l) => l.x), yl = out.leaves.map((l) => l.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...yl), y1 = Math.max(...yl);
    out.leaves.forEach((l) => { l.shade = Math.max(0, Math.min(1, 0.55 * ((l.x - x0) / Math.max(1, x1 - x0)) + 0.45 * ((l.y - y0) / Math.max(1, y1 - y0)) - 0.25 * l.z)); });
    out.crown = { x0, y0: -h, x1, y1 };
  } else out.crown = { x0: -20, y0: -h, x1: 20, y1: 0 };
  out.leaves.sort((a, b) => a.z - b.z);
  return out;
}

/**
 * 수관 속 톤(2026-10-23 B3, 성목 잎철) — 덩어리 잎뭉치 대신: 가장자리(실루엣) 잎과 앞쪽 몇 장만 낱장으로 남기고,
 * 수관 속은 짧은 빗금 톤으로 채운다(밝은 왼쪽 위 = H 성기게 → 그늘 오른쪽 아래 = 2B 촘촘). veil = 속 가지를 흐리게 덮는 종이(잎 둘레 원들).
 * keep[i] = 낱장으로 그릴 잎.
 */
export function crownTone(leaves: TLeaf[], seed: string, density = 1): { keep: boolean[]; light: string; dark: string; core: string; veil: string } {
  const n = leaves.length;
  if (!n) return { keep: [], light: '', dark: '', core: '', veil: '' };
  const cx = leaves.reduce((s, l) => s + l.x, 0) / n, cy = leaves.reduce((s, l) => s + l.y, 0) / n;
  const B = 40;
  const binAt = (x: number, y: number) => Math.floor(((Math.atan2(y - cy, x - cx) + Math.PI) / (Math.PI * 2)) * B) % B;
  const maxR = new Array<number>(B).fill(0);
  leaves.forEach((l) => { const b = binAt(l.x, l.y); maxR[b] = Math.max(maxR[b]!, Math.hypot(l.x - cx, l.y - cy) + l.len * 0.5); });
  const m2 = maxR.map((v, b) => Math.max(v, ((maxR[(b + B - 1) % B]! + maxR[(b + 1) % B]!) / 2) * 0.95));
  const keep = leaves.map((l, i) => Math.hypot(l.x - cx, l.y - cy) + l.len * 0.3 >= 0.74 * m2[binAt(l.x, l.y)]! || (l.z > 0.3 && R(seed, `ck${i}`) < 0.14));
  const lens = leaves.map((l) => l.len).sort((a, b) => a - b);
  const Lm = lens[Math.floor(n / 2)]!;
  // 잎 자리 격자(가까운 잎 찾기)
  const cell = Lm * 1.3;
  const hash = new Map<string, TLeaf[]>();
  leaves.forEach((l) => { const k = `${Math.floor(l.x / cell)},${Math.floor(l.y / cell)}`; const a = hash.get(k) ?? []; a.push(l); hash.set(k, a); });
  const near = (x: number, y: number, rr: number) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const l of hash.get(`${gx + i},${gy + j}`) ?? []) if (Math.hypot(l.x - x, l.y - y) < rr) return true;
    return false;
  };
  const xs = leaves.map((l) => l.x), ys = leaves.map((l) => l.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const gs = Math.max(6, Lm * 0.5);
  const light: string[] = [], dark: string[] = [], core: string[] = [];
  const dx0 = 0.6, dy0 = -0.8; // 빗금 결 — 왼쪽 아래 → 오른쪽 위
  let k = 0;
  for (let y = y0; y <= y1; y += gs) {
    for (let x = x0; x <= x1; x += gs, k++) {
      const px = x + (R(seed, `gx${k}`) - 0.5) * gs * 0.8, py = y + (R(seed, `gy${k}`) - 0.5) * gs * 0.8;
      if (Math.hypot(px - cx, py - cy) > 0.93 * m2[binAt(px, py)]! || !near(px, py, Lm * 1.15)) continue;
      const sh = Math.max(0, Math.min(1, 0.55 * ((px - x0) / Math.max(1, x1 - x0)) + 0.45 * ((py - y0) / Math.max(1, y1 - y0))));
      if (R(seed, `gp${k}`) > (0.18 + 0.82 * sh) * density) continue;
      // 빗금 한 묶음(2~3줄 나란히, 간격 3.6px) — 묶음마다 결이 조금씩 달라 잎 뭉치 결처럼
      const L = gs * (0.8 + R(seed, `gl${k}`) * 0.5);
      const ja = (R(seed, `ga${k}`) - 0.5) * 0.8;
      const dx = dx0 * Math.cos(ja) - dy0 * Math.sin(ja), dy = dx0 * Math.sin(ja) + dy0 * Math.cos(ja);
      const nS = sh > 0.5 ? 3 : 2;
      const parts: string[] = [];
      for (let q = 0; q < nS; q++) {
        const ox = -dy * 3.6 * (q - (nS - 1) / 2), oy = dx * 3.6 * (q - (nS - 1) / 2);
        const Lq = L * (1 - Math.abs(q - (nS - 1) / 2) * 0.25);
        const bend = (R(seed, `gb${k}`) - 0.5) * Lq * 0.3;
        parts.push(`M ${f1(px + ox - dx * Lq / 2)} ${f1(py + oy - dy * Lq / 2)} q ${f1(dx * Lq / 2 - dy * bend)} ${f1(dy * Lq / 2 + dx * bend)} ${f1(dx * Lq)} ${f1(dy * Lq)}`);
      }
      const d = parts.join(' ');
      (sh > 0.5 ? dark : light).push(d);
      // 핵심 그림자(수관 오른쪽 아래) — 반대 결로 한 겹 더(6B 크로스)
      if (sh > 0.74 && R(seed, `gc${k}`) < 0.6 * density) core.push(`M ${f1(px + dy * L * 0.4)} ${f1(py - dx * L * 0.4)} l ${f1(-dy * L * 0.8)} ${f1(dx * L * 0.8)}`);
    }
  }
  const veil = leaves.map((l) => { const r = Lm * 0.95; return `M ${f1(l.x - r)} ${f1(l.y)} a ${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0 a ${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0 Z`; }).join(' ');
  return { keep, light: light.join(' '), dark: dark.join(' '), core: core.join(' '), veil };
}

/** 가늘어지는 가지 윤곽(매끈한 닫힌 곡선) — 굵기 배열 w. */
export function taperSmooth(pts: P[], w: number[]): string {
  const n = pts.length;
  if (n < 2) return '';
  const L: P[] = [], Rr: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const hw = w[i]! / 2;
    L.push([pts[i]![0] + nx * hw, pts[i]![1] + ny * hw]);
    Rr.push([pts[i]![0] - nx * hw, pts[i]![1] - ny * hw]);
  }
  const e = pts[n - 1]!, hw = w[n - 1]! / 2;
  const a = pts[n - 2]!;
  const dl = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
  const cap: P = [e[0] + ((e[0] - a[0]) / dl) * hw * 0.6, e[1] + ((e[1] - a[1]) / dl) * hw * 0.6];
  return `${smoothOpen([...L, cap, ...Rr.reverse()])} Z`;
}

/** 한쪽 옆선(열린 곡선) — side +1 = 왼쪽(진행 방향 기준), -1 = 오른쪽. */
export function sideLine(pts: P[], w: number[], side: 1 | -1, inset = 1): string {
  const n = pts.length;
  const S: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    S.push([pts[i]![0] + (-dy / len) * (w[i]! / 2) * side * inset, pts[i]![1] + (dx / len) * (w[i]! / 2) * side * inset]);
  }
  return smoothOpen(S);
}

/** 빛(왼쪽 위)에서 먼 쪽 — 가지 방향마다 그늘 쪽 부호(+1/-1). */
export function shadeSide(pts: P[]): 1 | -1 {
  const a = pts[0]!, b = pts[pts.length - 1]!;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // side +1 법선
  return nx * 0.6 + ny * 0.8 > 0 ? 1 : -1;
}

/**
 * 결 따라 빗금(가지 그늘 쪽) — 단면 호처럼 짧게 휜 선. 굵기 w 의 rFrom~1 구간. 짙은 데(dense)는 사이사이 하나 더.
 */
export function branchHatch(pts: P[], w: number[], spacing: number, seed: string, dense = false): string {
  const side = shadeSide(pts);
  const out: string[] = [];
  const n = pts.length;
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / (sl || 1), dy = (b[1] - a[1]) / (sl || 1);
    const nx = -dy * side, ny = dx * side;
    let d = spacing - acc;
    while (d <= sl) {
      const t = d / sl;
      const cx = a[0] + (b[0] - a[0]) * t, cy = a[1] + (b[1] - a[1]) * t;
      const hw = (w[i - 1]! + (w[i]! - w[i - 1]!) * t) / 2;
      const j = R(seed, `${i}${Math.round(d)}`);
      const r0 = 0.12 + j * 0.25, r1 = 0.96;
      const bend = hw * 0.25;
      out.push(`M ${f1(cx + nx * hw * r0)} ${f1(cy + ny * hw * r0)} Q ${f1(cx + nx * hw * (r0 + r1) / 2 - dx * bend)} ${f1(cy + ny * hw * (r0 + r1) / 2 - dy * bend)} ${f1(cx + nx * hw * r1)} ${f1(cy + ny * hw * r1)}`);
      d += spacing * (dense ? 0.55 : 1);
    }
    acc = (acc + sl) % spacing;
  }
  return out.join(' ');
}

/**
 * 감나무 껍질 — 굵은 몸통에 거북등처럼 갈라진 네모 조각(세로 골 + 가로 금). 원기둥이라 가장자리일수록 좁게. 그늘 쪽 진하게.
 * 반환: 골(진), 금(중) 경로.
 */
export function barkBlocky(pts: P[], w: number[], seed: string, y0Frac = 0.04, y1Frac = 1): { furrows: string; cracks: string; dark: string } {
  const n = pts.length;
  const lanes = 7;
  const furrows: string[] = [], cracks: string[] = [], dark: string[] = [];
  const side = shadeSide(pts);
  const at = (t: number, u: number): P => {
    const f = t * (n - 1), i = Math.min(n - 2, Math.floor(f)), k = f - i;
    const a = pts[i]!, b = pts[i + 1]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const hw = (w[i]! + (w[i + 1]! - w[i]!) * k) / 2;
    const cx = a[0] + dx * k, cy = a[1] + dy * k;
    const off = Math.sin(u * Math.PI / 2) * hw * 0.94; // 원기둥 압축
    return [cx + (-dy / len) * off, cy + (dx / len) * off];
  };
  const totalLen = pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]), 0);
  for (let l = 0; l < lanes; l++) {
    const u = -0.86 + (l / (lanes - 1)) * 1.72 + (R(seed, `u${l}`) - 0.5) * 0.12;
    const shaded = u * side > 0.15;
    // 세로 골 — 블록 길이마다 끊김
    let t = y0Frac + R(seed, `t0${l}`) * 0.03;
    let b = 0;
    while (t < y1Frac - 0.02) {
      const blk = (0.05 + R(seed, `b${l}-${b}`) * 0.07) * Math.max(1, 900 / Math.max(200, totalLen)) * 0.6;
      const t2 = Math.min(y1Frac, t + blk);
      const wob = (R(seed, `w${l}-${b}`) - 0.5) * 0.08;
      const seg = [at(t, u), at((t + t2) / 2, u + wob), at(t2, u)];
      (shaded ? dark : furrows).push(smoothOpen(seg));
      // 가로 금 — 다음 골까지
      if (l < lanes - 1 && R(seed, `c${l}-${b}`) < 0.65) {
        const u2 = -0.86 + ((l + 1) / (lanes - 1)) * 1.72;
        const tc = t2 + (R(seed, `ct${l}-${b}`) - 0.5) * 0.01;
        cracks.push(smoothOpen([at(tc, u), at(tc + 0.004, (u + u2) / 2), at(tc, u2)]));
      }
      t = t2 + 0.008 + R(seed, `g${l}-${b}`) * 0.012;
      b++;
    }
  }
  return { furrows: furrows.join(' '), cracks: cracks.join(' '), dark: dark.join(' ') };
}

/**
 * 감나무 성목 껍질(2026-10-23 B5 — 실물 대조: Wikimedia Commons 'Diospyros kaki bark.jpg'·'Diospyros kaki001.JPG'·Starr 061225-2922, 내부 참고).
 * 실물: 회갈색 몸통이 작고 불규칙한 비늘 조각으로 갈라진다 — 격자가 아니다. 세로 골이 굽이치며 이어지고 가로 금은 짧고 어긋나며,
 * 조각 크기·비율이 제각각(세로로 조금 긴 것이 많다), 들뜬 가장자리 밑엔 작은 그늘, 도드라진 조각 면은 밝은 회색·골은 짙다.
 * 방법: 펼친 원기둥 면(X = 둘레 방향 px, Y = 축 방향 px)에 굽이치는 세로 줄을 따라 흔든 씨앗 → 세로로 늘인 보로노이 칸(반평면 자르기)
 * → 칸을 안쪽으로 줄여 골(세로 골은 넓게, 가로 금은 좁게) → 가장자리를 조금 깨뜨려 화면으로(가장자리일수록 좁게 — 원기둥 압축).
 * 연필: 골 = 바탕 겹빗금 + 골 가운데 6B(세로 골)·2B(가로 금), 조각 면 = 종이 + H 결 빗금(빛이 약할수록 촘촘), 그늘 쪽 조각 = 2B 엇빗금,
 * 위·왼쪽 변 = 지우개 능선(litEdge), 아래·오른쪽 변 = 6B(darkEdge), 들뜬 조각 = 아래 작은 그늘(lift, 6B 칠).
 * opts.cellPx = 조각 폭(px) — 몸통과 원가지가 같은 크기 조각을 쓰게(없으면 굵기로: 보이는 반 둘레에 12칸 남짓).
 * 반환 키는 종전과 같다(plates·litEdge·darkEdge·h·b2·b6) + lift.
 */
export function barkPlates(pts: P[], w: number[], seed: string, opts: { y0Frac?: number; y1Frac?: number; lanes?: number; cellPx?: number } = {}): { plates: string; litEdge: string; darkEdge: string; h: string; b2: string; b6: string; lift: string } {
  const n = pts.length;
  const out = { plates: [] as string[], litEdge: [] as string[], darkEdge: [] as string[], h: [] as string[], b2: [] as string[], b6: [] as string[], lift: [] as string[] };
  const done = () => ({ plates: out.plates.join(' '), litEdge: out.litEdge.join(' '), darkEdge: out.darkEdge.join(' '), h: out.h.join(' '), b2: out.b2.join(' '), b6: out.b6.join(' '), lift: out.lift.join(' ') });
  if (n < 2) return done();
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = cum[n - 1]!;
  if (total < 4) return done();
  const frame = (t: number) => {
    const d = Math.max(0, Math.min(1, t)) * total;
    let i = 0;
    while (i < n - 2 && cum[i + 1]! < d) i++;
    const k = (d - cum[i]!) / Math.max(1e-6, cum[i + 1]! - cum[i]!);
    const a = pts[i]!, b = pts[i + 1]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return { c: [a[0] + dx * k, a[1] + dy * k] as P, m: [-dy / len, dx / len] as P, hw: (w[i]! + (w[i + 1]! - w[i]!) * k) / 2 };
  };
  const Lv = [-0.5, -0.7, 0.5], Ll = Math.hypot(Lv[0]!, Lv[1]!, Lv[2]!);
  const litAt = (m: P, phi: number) => (m[0] * Math.sin(phi) * Lv[0]! + m[1] * Math.sin(phi) * Lv[1]! + Math.cos(phi) * Lv[2]!) / Ll;
  // 펼친 면: 보이는 반 둘레 폭 = π·Hm (Hm = 가운데 반굵기). X ∈ [-XE, XE] → u = X / XE, Y = 축 거리(px).
  const Hm = (w[Math.floor((n - 1) * 0.4)] ?? w[0]!) / 2;
  const XE = (Math.PI / 2) * Hm;
  const toScreen = (X: number, Y: number): P => {
    const F = frame(Y / total);
    const u = Math.max(-1, Math.min(1, X / XE));
    const off = Math.sin((u * Math.PI) / 2) * F.hw * 0.97;
    return [F.c[0] + F.m[0] * off, F.c[1] + F.m[1] * off];
  };
  const y0 = (opts.y0Frac ?? 0.02) * total, y1 = (opts.y1Frac ?? 1) * total;
  // 조각 크기 — 폭 cw, 높이 ch(세로로 조금 긴 조각). lanes 를 주면 그 칸 수(종전 호환).
  let cw = opts.lanes ? (2 * XE) / opts.lanes : Math.max(7, opts.cellPx ?? (2 * XE) / 14);
  const aspect = 1.35;
  // 씨앗 수 상한 — 아주 큰 확대에서도 무겁지 않게.
  while (((2 * XE) / cw + 2) * ((y1 - y0) / (cw * aspect) + 2) > 1400) cw *= 1.15;
  const ch = cw * aspect;
  const smooth = (k: string, x: number) => { const i = Math.floor(x), fr = x - i, e = fr * fr * (3 - 2 * fr); return R(seed, `${k}${i}`) * (1 - e) + R(seed, `${k}${i + 1}`) * e - 0.5; };
  // 씨앗 — 세로 줄(굽이침) 위에 들쭉날쭉한 간격으로, 줄마다 시작 높이가 달라 가로 금이 맞지 않는다. 가끔 빠져 큰 조각이 된다.
  const C = Math.ceil((2 * XE) / cw);
  const seeds: P[] = [];
  for (let c = -1; c <= C; c++) {
    const xc = -XE + (c + 0.5) * ((2 * XE) / C);
    let y = y0 - R(seed, `sy${c}`) * ch;
    let k = 0;
    while (y < y1 + ch && k < 400) {
      const x = xc + smooth(`mx${c}`, y / (ch * 3.2)) * cw * 0.8 + (R(seed, `jx${c}-${k}`) - 0.5) * cw * 0.3;
      if (R(seed, `dr${c}-${k}`) > 0.14) seeds.push([x, y + (R(seed, `jy${c}-${k}`) - 0.5) * ch * 0.3]);
      y += ch * (0.42 + Math.pow(R(seed, `st${c}-${k}`), 1.6) * 1.5);
      k++;
    }
  }
  // 보로노이(세로로 늘인 거리 — Y 를 a 로 나눈 공간에서 이등분선) — 반평면 자르기.
  const A = 1.5;
  const clip = (poly: P[], keep: (p: P) => number): P[] => {
    const res: P[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
      const fp = keep(p), fq = keep(q);
      if (fp <= 0) res.push(p);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); res.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return res;
  };
  const sorted = seeds.map((p, i) => ({ p, i })).sort((a, b) => a.p[1] - b.p[1]);
  const ys = sorted.map((s) => s.p[1]);
  const lo = (v: number) => { let a = 0, b = ys.length; while (a < b) { const m = (a + b) >> 1; if (ys[m]! < v) a = m + 1; else b = m; } return a; };
  const pt = (p: P) => `${f1(p[0])} ${f1(p[1])}`;
  const line = (ps: P[]) => `M ${ps.map(pt).join(' L ')}`;
  const edgeScreen = (a: P, b: P, k = 3): P[] => Array.from({ length: k + 1 }, (_, i) => toScreen(a[0] + (b[0] - a[0]) * (i / k), a[1] + (b[1] - a[1]) * (i / k)));
  const onBound = (a: P, b: P) => (Math.abs(a[0]) > XE - 0.01 && Math.abs(b[0]) > XE - 0.01) || (Math.abs(a[1] - y0) < 0.01 && Math.abs(b[1] - y0) < 0.01) || (Math.abs(a[1] - y1) < 0.01 && Math.abs(b[1] - y1) < 0.01);
  for (const { p: s } of sorted) {
    let poly: P[] = [[Math.max(-XE, s[0] - 2.5 * cw), Math.max(y0, s[1] - 2.5 * ch)], [Math.min(XE, s[0] + 2.5 * cw), Math.max(y0, s[1] - 2.5 * ch)], [Math.min(XE, s[0] + 2.5 * cw), Math.min(y1, s[1] + 2.5 * ch)], [Math.max(-XE, s[0] - 2.5 * cw), Math.min(y1, s[1] + 2.5 * ch)]];
    if (poly[0]![0] >= poly[1]![0] || poly[0]![1] >= poly[3]![1]) continue;
    for (let j = lo(s[1] - 2.6 * ch); j < sorted.length && ys[j]! <= s[1] + 2.6 * ch && poly.length >= 3; j++) {
      const q = sorted[j]!.p;
      if (q === s || Math.abs(q[0] - s[0]) > 2.6 * cw) continue;
      const dx = q[0] - s[0], dy = (q[1] - s[1]) / A, mx = (q[0] + s[0]) / 2, my = (q[1] + s[1]) / 2 / A;
      poly = clip(poly, (p) => (p[0] - mx) * dx + (p[1] / A - my) * dy);
    }
    if (poly.length < 3) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, cx = 0, cy = 0;
    for (const p of poly) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); cx += p[0]; cy += p[1]; }
    cx /= poly.length; cy /= poly.length;
    const W = maxX - minX, H = maxY - minY;
    if (W < 2.5 || H < 2.5) continue;
    const key = `${Math.round(s[0] * 10)}_${Math.round(s[1] * 10)}`;
    // 골 가운데 선 — 칸 테두리(공유 변은 한 번만: 오른쪽·위쪽 변을 이 칸이 맡는다). 세로 골 6B, 가로 금 2B.
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      if (onBound(a, b) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1.2) continue;
      const steep = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) * 0.8;
      const mine = steep ? (a[0] + b[0]) / 2 > cx : (a[1] + b[1]) / 2 > cy;
      if (!mine) continue;
      (steep ? out.b6 : out.b2).push(line(edgeScreen(a, b, steep ? 3 : 2)));
    }
    // 조각 = 칸을 줄인 것(세로 골은 넓게, 가로 금은 좁게) — 조각마다 줄이는 정도가 달라 골 폭이 들쭉날쭉.
    const gx = Math.min(W * 0.36, cw * (0.1 + Math.pow(R(seed, `gx${key}`), 0.8) * 0.2));
    const gy = Math.min(H * 0.25, ch * (0.03 + R(seed, `gy${key}`) * 0.07));
    const sx = 1 - (2 * gx) / W, sy = 1 - (2 * gy) / H;
    const ox = (R(seed, `ox${key}`) - 0.5) * gx * 0.6, oy = (R(seed, `oy${key}`) - 0.5) * gy * 0.6;
    const inner: P[] = poly.map((p) => [cx + ox + (p[0] - cx) * sx, cy + oy + (p[1] - cy) * sy]);
    // 깨진 가장자리 — 변 가운데를 조금 안팎으로(가끔 크게 떨어져 나간 귀퉁이).
    const rough: P[] = [];
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i]!, b = inner[(i + 1) % inner.length]!;
      rough.push(a);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 4) continue;
      const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
      const big = R(seed, `ck${key}-${i}`) < 0.12;
      const j = (R(seed, `rj${key}-${i}`) - (big ? 0.15 : 0.5)) * L * (big ? 0.28 : 0.12);
      const f = 0.3 + R(seed, `rf${key}-${i}`) * 0.4;
      rough.push([a[0] + (b[0] - a[0]) * f + nx * j, a[1] + (b[1] - a[1]) * f + ny * j]);
    }
    const scr = rough.map((p) => toScreen(p[0], p[1]));
    out.plates.push(`${line(scr)} Z`);
    // 빛 — 원기둥 면 법선(가운데 높이·둘레 자리).
    const F = frame(cy / total);
    const phi = (Math.max(-1, Math.min(1, cx / XE)) * Math.PI) / 2;
    const l = litAt(F.m, phi);
    // 변 — 화면에서 바깥 법선이 위·왼쪽(빛)이면 지우개 능선, 아래·오른쪽이면 6B.
    let area = 0;
    for (let i = 0; i < scr.length; i++) { const a = scr[i]!, b = scr[(i + 1) % scr.length]!; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1;
    let lit: P[] = [], dark: P[] = [];
    const flush = () => { if (lit.length > 1) out.litEdge.push(line(lit)); if (dark.length > 1) out.darkEdge.push(line(dark)); };
    for (let i = 0; i < scr.length; i++) {
      const a = scr[i]!, b = scr[(i + 1) % scr.length]!;
      const nx = (b[1] - a[1]) * sgn, ny = -(b[0] - a[0]) * sgn; // 바깥 법선(화면)
      const toLight = -0.6 * nx - 0.8 * ny;
      if (toLight > 0) { if (dark.length > 1) out.darkEdge.push(line(dark)); dark = []; if (!lit.length) lit.push(a); lit.push(b); }
      else { if (lit.length > 1) out.litEdge.push(line(lit)); lit = []; if (!dark.length) dark.push(a); dark.push(b); }
    }
    flush();
    // 들뜬 조각(약 20%) — 아래 변 밑에 작은 그늘 칠(조각이 떠 있다), 그늘 쪽일수록 자주.
    if (R(seed, `lf${key}`) < 0.16 + Math.max(0, -l) * 0.2 && H > 6) {
      const bot = inner.filter((p) => p[1] < cy).sort((a, b) => a[0] - b[0]); // 아래(밑동 쪽) 변 = Y 가 작은 쪽
      if (bot.length >= 2) {
        const a = bot[0]!, b = bot[bot.length - 1]!;
        const d = Math.max(1.4, gy * 1.6) + R(seed, `ld${key}`) * cw * 0.08;
        const shard: P[] = [[a[0] + (b[0] - a[0]) * 0.1, a[1]], [b[0] - (b[0] - a[0]) * 0.15, b[1]], [b[0] - (b[0] - a[0]) * 0.3, b[1] - d], [a[0] + (b[0] - a[0]) * 0.25, a[1] - d * 0.8]];
        out.lift.push(`${line(shard.map((p) => toScreen(p[0], p[1])))} Z`);
      }
    }
    // 조각 면 — H 결 빗금(세로, 조금 기움): 빛이 약할수록 촘촘. 위쪽 끝 띠는 비운다(지우개 능선).
    const spH = l > 0.45 ? cw * 0.3 : l > 0.15 ? cw * 0.2 : cw * 0.15;
    const xs0 = minX + gx, xs1 = maxX - gx;
    const slant = (R(seed, `sl${key}`) - 0.5) * 0.25;
    for (let x = xs0 + spH * (0.3 + R(seed, `hx${key}`) * 0.5); x < xs1; x += spH * (0.85 + R(seed, `hs${key}${Math.round(x)}`) * 0.3)) {
      // 세로선이 줄인 칸(볼록)과 만나는 구간
      let ya = Infinity, yb = -Infinity;
      for (let i = 0; i < inner.length; i++) {
        const a = inner[i]!, b = inner[(i + 1) % inner.length]!;
        if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
        const yy = a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
        ya = Math.min(ya, yy); yb = Math.max(yb, yy);
      }
      if (!(yb - ya > 3)) continue;
      const yA = ya + (yb - ya) * (0.06 + R(seed, `ha${key}${Math.round(x)}`) * 0.12), yB = yb - (yb - ya) * (0.14 + R(seed, `hb${key}${Math.round(x)}`) * 0.12);
      if (yB <= yA) continue;
      out.h.push(line([toScreen(x - slant * (yB - yA) * 0.5, yA), toScreen(x + slant * (yB - yA) * 0.5, yB)]));
    }
    // 그늘 쪽 조각 — 2B 엇빗금(원기둥 둥근 면), 아주 어두운 쪽은 더 촘촘.
    if (l < 0.35) {
      const sp = l < -0.15 ? cw * 0.16 : l < 0.1 ? cw * 0.22 : cw * 0.32;
      for (let d = -W - H; d < W + H; d += sp) {
        // 선 X - (Y-cy)·0.9 = cx + d 와 칸의 교차
        const pts2: P[] = [];
        for (let i = 0; i < inner.length; i++) {
          const a = inner[i]!, b = inner[(i + 1) % inner.length]!;
          const fa = a[0] - (a[1] - cy) * 0.9 - cx - d, fb = b[0] - (b[1] - cy) * 0.9 - cx - d;
          if (fa * fb > 0 || fa === fb) continue;
          const t = fa / (fa - fb);
          pts2.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        if (pts2.length < 2) continue;
        const [p, q] = pts2;
        if (Math.hypot(q![0] - p![0], q![1] - p![1]) < 3) continue;
        out.b2.push(line([toScreen(p![0] + (q![0] - p![0]) * 0.1, p![1] + (q![1] - p![1]) * 0.1), toScreen(p![0] + (q![0] - p![0]) * 0.9, p![1] + (q![1] - p![1]) * 0.9)]));
      }
    }
  }
  return done();
}

/** 어린 감나무 껍질 — 매끈한 회갈색: 껍질눈(가로로 짧은 틈) + 세로로 아주 옅은 결(H). 가장자리일수록 좁게. */
export function barkSmooth(pts: P[], w: number[], seed: string, dense = 1): { lenticels: string; grain: string } {
  const n = pts.length;
  const len: string[] = [], grain: string[] = [];
  let k = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], sl = Math.hypot(dx, dy) || 1;
    const mx = -dy / sl, my = dx / sl, ax = dx / sl, ay = dy / sl;
    const hw = (w[i - 1]! + w[i]!) / 4;
    if (hw < 2.5) continue;
    const cnt = Math.max(1, Math.round(((sl * hw) / 180) * dense));
    for (let q = 0; q < cnt; q++, k++) {
      const tt = R(seed, `lt${k}`), u = (R(seed, `lu${k}`) - 0.5) * 1.7;
      const off = Math.sin((u * Math.PI) / 2) * hw * 0.92;
      const cx = a[0] + dx * tt + mx * off, cy = a[1] + dy * tt + my * off;
      const lw = Math.min(hw * 0.14, 1.6 + hw * 0.035) * Math.cos((u * Math.PI) / 2);
      // 껍질눈은 드물게(작은 가로 틈), 세로 결은 촘촘히(회갈색 톤 — 오른쪽 그늘 쪽일수록 많이)
      if (lw >= 1.1 && R(seed, `ll${k}`) < 0.22) len.push(`M ${f1(cx - mx * lw)} ${f1(cy - my * lw)} L ${f1(cx + mx * lw)} ${f1(cy + my * lw)}`);
      if (R(seed, `lg${k}`) < 0.55 + 0.4 * Math.max(0, u)) { const gl = Math.min(sl * 0.9, hw * (0.25 + R(seed, `gl${k}`) * 0.6)); grain.push(`M ${f1(cx - ax * gl / 2)} ${f1(cy - ay * gl / 2)} l ${f1(ax * gl)} ${f1(ay * gl)}`); }
    }
  }
  return { lenticels: len.join(' '), grain: grain.join(' ') };
}

// ── 뿌리

export type RootKind = 'wide' | 'small' | 'bare' | 'ball';
export type RootG = { thick: TStem[]; fine: string[]; ball?: { body: string; w: number; h: number } };

/**
 * 뿌리 — 뿌리목 (0,0)에서 아래로. w = 퍼진 너비, depth = 깊이, kind: wide(성목 — 옆으로 넓게), small(묘목 땅속), bare(맨뿌리 묘목 — 아래로 늘어진 잔뿌리 많이),
 * ball(뿌리분 — 흙덩이 + 삐져나온 잔뿌리). thick = 굵은 뿌리(윤곽), fine = 잔뿌리(가는 선들).
 */
export function rootGeom2(seed: string, w: number, depth: number, kind: RootKind, thick0: number): RootG {
  const out: RootG = { thick: [], fine: [] };
  const n = kind === 'wide' ? 7 : kind === 'small' ? 4 : kind === 'bare' ? 5 : 0;
  const fineOf = (p: P, th: number, len: number, key: string, count: number) => {
    for (let k = 0; k < count; k++) {
      const a = th + (R(seed, `${key}fa${k}`) - 0.5) * 1.6;
      const L = len * (0.4 + R(seed, `${key}fl${k}`) * 0.7);
      const pts: P[] = [p];
      let ang = a;
      for (let s = 1; s <= 5; s++) {
        ang += (R(seed, `${key}fw${k}${s}`) - 0.5) * 0.7;
        if (kind === 'bare') ang = ang * 0.85 + Math.PI * 0.15; // 아래로 늘어짐
        const q = pts[s - 1]!;
        pts.push([q[0] + Math.sin(ang) * L / 5, Math.max(4, q[1] - Math.cos(ang) * L / 5)]);
      }
      out.fine.push(smoothOpen(pts));
    }
  };
  if (kind === 'ball') {
    const bw = w, bh = depth;
    const body = `M ${f1(-bw * 0.4)} 2 C ${f1(-bw * 0.56)} ${f1(bh * 0.1)} ${f1(-bw * 0.56)} ${f1(bh * 0.72)} ${f1(-bw * 0.3)} ${f1(bh * 0.94)} C ${f1(-bw * 0.12)} ${f1(bh * 1.06)} ${f1(bw * 0.12)} ${f1(bh * 1.06)} ${f1(bw * 0.3)} ${f1(bh * 0.94)} C ${f1(bw * 0.56)} ${f1(bh * 0.72)} ${f1(bw * 0.56)} ${f1(bh * 0.1)} ${f1(bw * 0.4)} 2 Q 0 ${f1(-bh * 0.07)} ${f1(-bw * 0.4)} 2 Z`;
    out.ball = { body, w: bw, h: bh };
    for (let k = 0; k < 16; k++) {
      const t = k / 15;
      const a = -Math.PI * 0.55 + t * Math.PI * 1.1;
      const p: P = [Math.sin(a) * bw * 0.47, bh * 0.5 + Math.cos(a) * bh * 0.49];
      fineOf(p, Math.PI + a * 0.9, bw * 0.16, `bl${k}`, 2);
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    const kk = n <= 1 ? 0 : i / (n - 1) - 0.5;
    let th = Math.PI + kk * (kind === 'wide' ? 2.7 : kind === 'bare' ? 1.4 : 2.0) + (R(seed, `ra${i}`) - 0.5) * 0.25;
    const horiz = Math.abs(Math.sin(th));
    const L = (horiz * w * 0.5 + (1 - horiz) * depth) * (0.75 + R(seed, `rl${i}`) * 0.3);
    const segs = 9;
    const pts: P[] = [[kk * thick0 * 0.7, 2]];
    for (let s = 1; s <= segs; s++) {
      th += (R(seed, `rw${i}${s}`) - 0.5) * 0.35 + (kind === 'wide' ? 0 : (Math.PI - th) * 0.06);
      const q = pts[s - 1]!;
      pts.push([q[0] + Math.sin(th) * L / segs, Math.max(4 + Math.abs(q[0]) * 0.03, q[1] - Math.cos(th) * L / segs)]);
    }
    const t0 = thick0 * (1 - Math.abs(kk) * 0.45);
    const ww = pts.map((_, s) => t0 * (1 - (s / segs) * 0.85));
    out.thick.push({ pts, w: ww, order: 0, level: 0, z: 0 });
    // 곁뿌리
    for (let j = 0; j < 3; j++) {
      const s0 = 2 + j * 2 + (R(seed, `rj${i}${j}`) > 0.5 ? 1 : 0);
      const p = pts[Math.min(segs - 1, s0)]!;
      const sd = j % 2 === 0 ? 1 : -1;
      let a = th + sd * (0.6 + R(seed, `rs${i}${j}`) * 0.5);
      const sl = L * (0.28 + R(seed, `rL${i}${j}`) * 0.18);
      const sp2: P[] = [p];
      for (let s = 1; s <= 5; s++) { a += (R(seed, `rv${i}${j}${s}`) - 0.5) * 0.4; const q = sp2[s - 1]!; sp2.push([q[0] + Math.sin(a) * sl / 5, Math.max(6, q[1] - Math.cos(a) * sl / 5)]); }
      out.thick.push({ pts: sp2, w: sp2.map((_, s) => ww[s0]! * 0.42 * (1 - s / 6)), order: 0.3 + j * 0.15, level: 1, z: 0 });
      fineOf(sp2[sp2.length - 1]!, a, L * 0.16, `rf${i}${j}`, kind === 'bare' ? 5 : 3);
    }
    fineOf(pts[pts.length - 1]!, th, L * 0.2, `re${i}`, kind === 'bare' ? 7 : 4);
    if (kind === 'bare') for (let s = 2; s < segs; s += 2) fineOf(pts[s]!, th + (s % 4 ? 0.8 : -0.8), L * 0.18, `rm${i}${s}`, 2);
  }
  return out;
}

/** 감잎 윤곽 — 잎자루 (0,0), +x 가 잎끝. 넓은 타원(어긋 넓은 타원·짧게 뾰족한 끝), 잎자루 짧게. */
export function persimmonLeaf(L: number, wid = 0.58) {
  const W = L * wid;
  const pet = L * 0.08;
  const hw = (t: number) => {
    let v = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t)) ** 0.92), 0.82) * (W / 2);
    if (t > 0.82) v *= Math.pow((1 - t) / 0.18, 0.45);
    return v;
  };
  const up: P[] = [], dn: P[] = [];
  const K = 14;
  for (let i = 0; i <= K; i++) { const t = i / K; up.push([pet + t * (L - pet), -hw(t)]); dn.push([pet + t * (L - pet), hw(t)]); }
  const outline = `${smoothOpen([[0, 0], ...up.slice(1)])} ${smoothOpen(dn.slice().reverse()).replace(/^M [^C]+/, '')} Z`;
  const half = (s: 1 | -1) => `${smoothOpen([[pet, 0], ...(s < 0 ? up : dn).slice(1)])} Z`;
  const midrib = `M 0 0 Q ${f1(L * 0.5)} ${f1(W * 0.03)} ${f1(L * 0.97)} 0`;
  const veins: string[] = [];
  const xOf = (t: number) => pet + t * (L - pet);
  for (let k = 0; k < 7; k++) {
    const t0 = 0.08 + k * 0.105;
    const t1 = Math.min(0.93, t0 + 0.2 - k * 0.008);
    for (const s of [-1, 1]) {
      const e = hw(t1) * 0.84;
      veins.push(`M ${f1(xOf(t0))} ${f1(s * W * 0.012)} Q ${f1(xOf(t0 + 0.05))} ${f1(s * hw(t0 + 0.05) * 0.62)} ${f1(xOf(t1))} ${f1(s * e)}`);
    }
  }
  return { outline, upper: half(-1), lower: half(1), midrib, veins, W, pet, hw };
}

/**
 * 감 앞모습(살짝 위에서 본) — 중심 (0,0), 반지름 r(가로 반). kind: flat = 단감(납작한 둥근 네모 + 얕은 네 골), round = 둥근 감,
 * long = 대봉(어깨 넓고 아래로 뾰족한 도토리·하트꼴). 꽃받침 넉 장 = 넓고 두꺼운 꽃받침 조각(가장자리 들림·끝 살짝 말림),
 * 두께선(rims)·그늘 빗금(sepalShade), 꼭지(stalk) = 짧고 굵은 꼭지(꽃받침에 거의 가림 — 가지에 바짝 붙는다).
 */
export function persimmonFruit(r: number, kind: 'flat' | 'round' | 'long' = 'flat') {
  const ry = r * (kind === 'flat' ? 0.76 : kind === 'round' ? 0.92 : 1.18);
  const pts: P[] = [];
  const K = 48;
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    const c = Math.cos(a), sn = Math.sin(a);
    const e = kind === 'flat' ? 2 / 2.7 : kind === 'long' ? 2 / 2.3 : 2 / 2.1; // 초타원(단감 = 둥근 네모)
    let x = Math.sign(c) * Math.pow(Math.abs(c), e) * r;
    let y = Math.sign(sn) * Math.pow(Math.abs(sn), e) * ry * (sn < 0 ? (kind === 'long' ? 0.78 : 0.86) : 1);
    if (kind === 'long' && sn > 0) { x *= 1 - 0.62 * Math.pow(sn, 1.8); y *= 1 + 0.1 * Math.pow(sn, 6); } // 대봉 — 아래로 뾰족
    if (sn < 0) y += ry * 0.07 * Math.exp(-((x / (r * 0.32)) ** 2)); // 꼭지 자리 오목
    if (kind === 'flat' && sn > 0) y -= ry * 0.04 * Math.exp(-((x / (r * 0.3)) ** 2)); // 밑 살짝 납작
    pts.push([x, y]);
  }
  const body = `${smoothOpen([...pts, pts[0]!, pts[1]!]).replace(/ C [^C]+$/, '')} Z`;
  // 골 — 단감 네 골(앞에서 둘 + 가운데 희미하게), 둥근 감·대봉은 희미한 하나
  const grooves = kind === 'flat'
    ? [-0.42, 0.42, 0].map((u) => `M ${f1(u * r * 0.32)} ${f1(-ry * 0.62)} Q ${f1(u * r * 1.12)} ${f1(ry * 0.12)} ${f1(u * r * 0.5)} ${f1(ry * 0.9)}`)
    : [`M ${f1(r * 0.06)} ${f1(-ry * 0.55)} Q ${f1(r * 0.16)} ${f1(ry * 0.2)} ${f1(r * 0.04)} ${f1(ry * (kind === 'long' ? 1.05 : 0.88))}`];
  const cy = -ry * 0.68;
  // 꽃받침 넉 장 — 수평면의 넓은 네 조각을 위에서 25° 내려다본 투영. 앞 조각은 어깨를 덮어 아래로, 뒤 조각은 짧게 위로.
  const sepals: string[] = [], sepalVeins: string[] = [], rims: string[] = [], sepalShade: string[] = [];
  const order = [0, 1, 2, 3].map((k) => Math.PI / 4 + k * (Math.PI / 2) + 0.22).sort((a1, a2) => Math.sin(a1) - Math.sin(a2));
  const len = r * (kind === 'long' ? 0.56 : 0.62);
  for (const a of order) {
    const ca = Math.cos(a), sa = Math.sin(a);
    // u = 바깥, v = 옆, t = 0~1. 어깨 따라 처짐(앞 조각) + 끝 들림(말림)
    const proj = (u: number, v: number, t: number): P => {
      const px = ca * u - sa * v, pz = sa * u + ca * v;
      const drape = (Math.max(0, pz) / len) * r * 0.3 * t * t; // 앞쪽은 어깨를 타고 내려감
      return [px, cy + pz * 0.46 + drape - t * t * r * 0.09 * (1 - Math.max(0, pz) / len) - (Math.abs(v) / len) * r * 0.05];
    };
    const L: P[] = [], Rr: P[] = [], Li: P[] = [], Ri: P[] = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // 넓은 밑(0.3에서 가장 넓음) → 끝으로 좁아지는 넓은 세모꼴, 가장자리 살짝 물결
      const prof = t < 0.3 ? Math.pow(Math.sin((t / 0.3) * Math.PI / 2), 0.55) : 1 - Math.pow((t - 0.3) / 0.7, 2.2) * 0.8;
      const hw = len * 0.48 * prof * (1 + 0.06 * Math.sin(t * 11));
      L.push(proj(len * t, hw, t));
      Rr.push(proj(len * t, -hw * (1 + 0.06 * Math.cos(t * 8)), t));
      const rim = Math.min(hw * 0.35, r * 0.035);
      Li.push(proj(len * t * 0.97, (hw - rim), t));
      Ri.push(proj(len * t * 0.97, -(hw - rim), t));
    }
    sepals.push(`${smoothOpen([[0, cy], ...L.slice(1), proj(len * 1.03, 0, 1), ...Rr.slice(1).reverse(), [0, cy]])} Z`);
    sepalVeins.push(smoothOpen([[0, cy], proj(len * 0.5, len * 0.02, 0.5), proj(len * 0.9, 0, 0.9)]));
    // 두께선 — 끝 쪽 절반(들린 가장자리 안쪽 평행선)
    rims.push(smoothOpen([...Li.slice(5), proj(len * 0.96, 0, 0.98), ...Ri.slice(5).reverse()]));
    // 그늘 쪽 반(빛 = 왼쪽 위에서 먼 쪽) — 결 따라 빗금
    const sideL = L.reduce((s2, q) => s2 + q[0] + q[1], 0) > Rr.reduce((s2, q) => s2 + q[0] + q[1], 0);
    const half = sideL ? 1 : -1;
    for (let i = 2; i <= 8; i++) {
      const t = i / 10;
      const hw = len * 0.48 * (t < 0.3 ? Math.pow(Math.sin((t / 0.3) * Math.PI / 2), 0.55) : 1 - Math.pow((t - 0.3) / 0.7, 2.2) * 0.8);
      const p0 = proj(len * t, half * hw * 0.15, t), p1 = proj(len * (t + 0.06), half * hw * 0.85, t + 0.06);
      sepalShade.push(`M ${f1(p0[0])} ${f1(p0[1])} L ${f1(p1[0])} ${f1(p1[1])}`);
    }
  }
  // 꼭지 — 짧고 굵게(꽃받침 가운데에서 위로 r×0.12)
  const sw = r * 0.075, sh = r * 0.13;
  const stalk = `M ${f1(-sw)} ${f1(cy + r * 0.02)} C ${f1(-sw * 1.05)} ${f1(cy - sh * 0.5)} ${f1(-sw * 0.8)} ${f1(cy - sh)} ${f1(-sw * 0.55)} ${f1(cy - sh * 1.05)} L ${f1(sw * 0.6)} ${f1(cy - sh * 1.1)} C ${f1(sw * 0.85)} ${f1(cy - sh)} ${f1(sw * 1.05)} ${f1(cy - sh * 0.5)} ${f1(sw)} ${f1(cy + r * 0.02)} Z`;
  return { body, grooves, sepals, sepalVeins, rims, sepalShade, stalk, ry, cy, top: cy - sh };
}
