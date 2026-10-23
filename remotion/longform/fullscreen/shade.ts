// 연필 명암(순수, 2026-10-23 스타일 B) — 빛은 늘 왼쪽 위 앞. 5요소:
//  ① 하이라이트 = 비움(종이) ② 중간 톤 = 밝은 쪽 성긴 H 해칭 → 그늘 쪽 촘촘한 2B 해칭(간격이 점점 좁아짐)
//  ③ 핵심 그림자 = 중간 톤과 반사광 사이 띠, 6B 크로스해칭(띠 양끝은 성기게) ④ 반사광 = 그늘 쪽 외곽선 안쪽 얇은 띠(2B 성긴 해칭 — 비우지 않음)
//  ⑤ 투영 그림자 = 그리는 쪽(CastShadow). 해칭은 곡면을 따라 휜다(원기둥 = 둘레를 감는 짧은 호, 구 = 하이라이트를 도는 고리).
// 해칭 간격 하한 MIN_GAP(px) — 1080p 에서 모아레·지저분함 방지.
import { random } from 'remotion';
import type { P } from './geom';

export const LIGHT3: [number, number, number] = (() => { const v = [-0.5, -0.7, 0.5]; const l = Math.hypot(v[0]!, v[1]!, v[2]!); return [v[0]! / l, v[1]! / l, v[2]! / l] as [number, number, number]; })();
/** 해칭 간격 하한(px, 화면). */
export const MIN_GAP = 3.4;
/** 명암 문턱 — 빛 세기 l(= n·빛)로 영역을 가른다. */
export const ZONE = { highlight: 0.5, lightMid: 0.22, darkMid: 0.0 } as const;

export type ShadeOut = {
  /** 밝은 중간 톤 — H 성긴 해칭. */
  h: string;
  /** 짙은 중간 톤·반사광 — 2B 해칭. */
  b2: string;
  /** 핵심 그림자 — 6B 크로스해칭(가로지르는 짧은 선). */
  b6: string;
};

const f1 = (n: number) => n.toFixed(1);
const lit = (n: [number, number, number]) => n[0] * LIGHT3[0] + n[1] * LIGHT3[1] + n[2] * LIGHT3[2];

/**
 * 원기둥(가지·줄기·뿌리·손가락·화분 몸통) 명암 — 중심선 pts, 굵기 w(px). gap = 기본 간격(≥ MIN_GAP).
 * 정거장(gap 마다)에서 단면 호를 긋는다: 3번째마다 H(l<0.5), 그다음 2B(l<0.22, 반사광 띠까지), 그다음 2B(l<0, 반사광 띠 제외),
 * 핵심 그림자 띠에는 축 방향 짧은 6B 선(크로스). bend = 호가 휘는 정도(단면 타원 — 위에서 살짝 내려다봄).
 */
export function cylShade(pts: P[], w: number[], seed: string, gap = 4, opts: { bend?: number; core?: boolean; minW?: number } = {}): ShadeOut {
  const sp = Math.max(MIN_GAP, gap);
  const bend = opts.bend ?? 0.22;
  const h: string[] = [], b2: string[] = [], b6: string[] = [];
  const n = pts.length;
  if (n < 2) return { h: '', b2: '', b6: '' };
  let acc = 0, j = 0;
  const U = 28;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (sl < 1e-3) continue;
    const dx = (b[0] - a[0]) / sl, dy = (b[1] - a[1]) / sl;
    const mx = -dy, my = dx;
    let d = sp - acc;
    while (d <= sl) {
      const t = d / sl;
      const cx = a[0] + (b[0] - a[0]) * t, cy = a[1] + (b[1] - a[1]) * t;
      const hw = (w[i - 1]! + (w[i]! - w[i - 1]!) * t) / 2;
      if (hw * 2 >= (opts.minW ?? 5)) {
        const ls: number[] = [];
        for (let k = 0; k <= U; k++) { const u = -0.98 + (k / U) * 1.96; ls.push(lit([mx * u, my * u, Math.sqrt(1 - u * u)])); }
        const lmin = Math.min(...ls);
        const reflect = lmin + 0.2;
        const jit = (random(`${seed}${j}`) - 0.5) * 0.06;
        const run = (test: (l: number) => boolean): Array<[number, number]> => {
          const out: Array<[number, number]> = [];
          let s0 = -1;
          for (let k = 0; k <= U; k++) {
            const ok = test(ls[k]! + jit);
            if (ok && s0 < 0) s0 = k;
            if ((!ok || k === U) && s0 >= 0) { const e = ok ? k : k - 1; if (e > s0) out.push([-0.98 + (s0 / U) * 1.96, -0.98 + (e / U) * 1.96]); s0 = -1; }
          }
          return out;
        };
        const arc = (u0: number, u1: number) => {
          const p0: P = [cx + mx * u0 * hw, cy + my * u0 * hw], p1: P = [cx + mx * u1 * hw, cy + my * u1 * hw];
          const um = (u0 + u1) / 2;
          // 단면 호 — 가운데가 축 반대 방향(아래)으로 살짝 처진다(원기둥 둘레를 감는 느낌)
          const sag = bend * hw * (1 - um * um) * Math.sign(-dy || 1) * 0.9;
          const q: P = [cx + mx * um * hw - dx * sag, cy + my * um * hw - dy * sag];
          return `M ${f1(p0[0])} ${f1(p0[1])} Q ${f1(q[0])} ${f1(q[1])} ${f1(p1[0])} ${f1(p1[1])}`;
        };
        const ph = j % 3;
        if (ph === 0) for (const [u0, u1] of run((l) => l < ZONE.highlight)) h.push(arc(u0, u1));
        if (ph === 1) for (const [u0, u1] of run((l) => l < ZONE.lightMid)) b2.push(arc(u0, u1));
        if (ph === 2) for (const [u0, u1] of run((l) => l < ZONE.darkMid && l > reflect)) b2.push(arc(u0, u1));
        // 핵심 그림자 — 축 방향 짧은 선, 띠 양끝은 듬성(확률로 거름)
        if ((opts.core ?? true) && j % 2 === 0 && hw > 4) {
          const band = run((l) => l < -0.02 && l > reflect);
          for (const [u0, u1] of band) {
            const span = (u1 - u0) * hw;
            const m = Math.max(1, Math.floor(span / sp));
            for (let q = 0; q <= m; q++) {
              const uu = u0 + ((u1 - u0) * (q + 0.5)) / (m + 1);
              const edge = Math.min(q + 0.5, m + 0.5 - q) / ((m + 1) / 2); // 0 끝 ~ 1 가운데
              if (random(`${seed}c${j}${q}`) > 0.25 + edge * 0.85) continue;
              const px = cx + mx * uu * hw, py = cy + my * uu * hw;
              const L = sp * 1.7;
              b6.push(`M ${f1(px - dx * L * 0.5 + mx * 0.6)} ${f1(py - dy * L * 0.5 + my * 0.6)} L ${f1(px + dx * L * 0.5 - mx * 0.6)} ${f1(py + dy * L * 0.5 - my * 0.6)}`);
            }
          }
        }
      }
      j++;
      d += sp;
    }
    acc = (acc + sl) % sp;
  }
  return { h: h.join(' '), b2: b2.join(' '), b6: b6.join(' ') };
}

/**
 * 구(감 열매·둥근 뿌리분) 명암 — 중심 (0,0), 반지름 rx·ry. 하이라이트를 도는 고리 해칭(곡면을 따라), 같은 3층 + 6B 핵심 그림자 지름 방향 짧은 선.
 * 반사광 = 그늘 쪽 테두리 안 얇은 띠(2B 한 층만). 하이라이트 점 hl 도 돌려준다(지우개 광택 자리).
 */
export function sphereShade(rx: number, ry: number, seed: string, gap = 4): ShadeOut & { hl: P } {
  const sp = Math.max(MIN_GAP, gap);
  const hl: P = [-0.36 * rx, -0.42 * ry];
  const h: string[] = [], b2: string[] = [], b6: string[] = [];
  const Rmax = Math.hypot(rx + Math.abs(hl[0]), ry + Math.abs(hl[1]));
  const normal = (x: number, y: number): [number, number, number] | null => {
    const xx = x / rx, yy = y / ry, q = 1 - xx * xx - yy * yy;
    if (q < 0.004) return null;
    const z = Math.sqrt(q), l = Math.hypot(xx, yy, z);
    return [xx / l, yy / l, z / l];
  };
  // 테두리 그늘 쪽 최저 빛
  let lmin = 1;
  for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; const nn = normal(Math.cos(a) * rx * 0.985, Math.sin(a) * ry * 0.985); if (nn) lmin = Math.min(lmin, lit(nn)); }
  const reflect = lmin + 0.22;
  let ring = 0;
  for (let rho = sp * 1.5; rho < Rmax; rho += sp, ring++) {
    const ph = ring % 3;
    const test = ph === 0 ? (l: number) => l < ZONE.highlight : ph === 1 ? (l: number) => l < ZONE.lightMid : (l: number) => l < ZONE.darkMid && l > reflect;
    const K = Math.max(24, Math.round((rho * Math.PI * 2) / 3));
    let cur: P[] = [];
    const flush = () => { if (cur.length >= 3) (ph === 0 ? h : b2).push(`M ${cur.map((q) => `${f1(q[0])} ${f1(q[1])}`).join(' L ')}`); cur = []; };
    const jit = (random(`${seed}r${ring}`) - 0.5) * 0.05;
    for (let k = 0; k <= K; k++) {
      const a = (k / K) * Math.PI * 2;
      const x = hl[0] + Math.cos(a) * rho, y = hl[1] + Math.sin(a) * rho * (ry / rx);
      const nn = normal(x, y);
      if (nn && (x / rx) ** 2 + (y / ry) ** 2 < 0.94 && test(lit(nn) + jit)) cur.push([x, y]); else flush();
    }
    flush();
    // 핵심 그림자 — 고리를 가로지르는 짧은 선(지름 방향)
    if (ring % 2 === 0) {
      for (let k = 0; k < K; k += 2) {
        const a = (k / K) * Math.PI * 2;
        const x = hl[0] + Math.cos(a) * rho, y = hl[1] + Math.sin(a) * rho * (ry / rx);
        const nn = normal(x, y);
        if (!nn) continue;
        const l = lit(nn);
        if (!(l < -0.04 && l > reflect + 0.04)) continue;
        const mid = (-0.04 + reflect) / 2, half = (-0.04 - reflect) / 2;
        const edge = 1 - Math.abs(l - mid) / half;
        if (random(`${seed}k${ring}${k}`) > 0.2 + edge * 0.9) continue;
        const L = sp * 0.9;
        b6.push(`M ${f1(x - Math.cos(a) * L)} ${f1(y - Math.sin(a) * L)} L ${f1(x + Math.cos(a) * L)} ${f1(y + Math.sin(a) * L)}`);
      }
    }
  }
  return { h: h.join(' '), b2: b2.join(' '), b6: b6.join(' '), hl };
}
