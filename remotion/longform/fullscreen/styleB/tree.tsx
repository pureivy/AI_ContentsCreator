// 스타일 B 식물(2026-10-23 손질) — 종 프리셋(species/presets)으로 그리는 도감 부품: 나무(수형·나이·계절), 잎(엽형·엽연·맥), 꽃, 열매.
// 연필 기법: 3단 톤(H 구조선 → 2B 윤곽 → 해칭 → 6B 강조 순서로 그려진다), 곡면을 따라 휘는 해칭(원기둥 = 둘레 호, 구 = 하이라이트를 도는 고리),
// 5요소 명암(하이라이트 비움·중간 톤 H→2B·핵심 그림자 6B 크로스·반사광 띠·투영 그림자), 지우개 하이라이트(감 광택·껍질 능선·잎맥).
// 계절: winter = 잎·열매 없음(겨울눈만), spring = 가지 끝 새잎, summer = 잎 가득, autumn = 잎 일부 + 열매(프리셋 열매 달에 맞춤).
import React, { useMemo } from 'react';
import { Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { clamp } from '../stage';
import { stipple, type P } from '../geom';
import { barkBlocky, barkPlates, barkSmooth, crownTone, persimmonFruit, rootGeom2, shadeSide, sideLine, speciesFromProfile, taperSmooth, treeGeom2, type RootKind, type Season, type Species, type TreeAge, type Tree2G } from '../geomTree';
import { flowerGeom, fruitGeom, leafGeom } from '../geomBotany';
import { smoothOpen } from '../geomHand';
import { cylShade, sphereShade } from '../shade';
import { speciesOf } from '../species/presets';
import type { SpeciesProfile } from '../species/schema';
import { Accent, DONE, PB, PLine, ShadeLayers, TONE } from './pencil';
import { CastShadow } from './ground';

const f1 = (n: number) => n.toFixed(1);
const xf = (q: P, x: number, y: number, ang: number, s: number): P => {
  const c = Math.cos(ang), sn = Math.sin(ang);
  return [x + (q[0] * c - q[1] * sn) * s, y + (q[0] * sn + q[1] * c) * s];
};

// 종마다 단위 잎(길이 100) — 나무에 달 잎(엽연 무늬 생략, 실루엣 + 가운데 맥). 겹잎·손바닥 잎은 윤곽 그대로 변환.
// dark = 그늘 반쪽 빗금(곁맥 결 따라, 맥에서 가장자리로), light = 밝은 반쪽 가장자리만 성긴 빗금(맥 쪽 띠는 비움 = 윤기).
// (B4) up/dn = 위(−y)·아래(+y) 반쪽 가장자리 점(밑 → 끝), veins = 곁맥 쌍(가운데 맥 → 앞으로 휘어 가장자리 가까이, 세 점 곡선).
type UnitLeaf = { pts: P[]; outline: string; hatch: Array<[P, P]>; dark: Array<[P, P]>; light: Array<[P, P]>; pet: number; up: P[]; dn: P[]; veins: Array<[P, P, P]>; hw: (t: number) => number;
  /** (B6) 손바닥 잎 — 윤곽 고리·갈래 맥·그늘 빗금(단위 길이 100). */ ring?: P[]; veinLines?: Array<[P, P]>; shade?: Array<[P, P]> };
const unitCache = new Map<string, UnitLeaf>();
function unitLeaf(pf: SpeciesProfile): UnitLeaf {
  const key = `${pf.id}|${pf.leaf.shape}|${pf.leaf.widthRatio}|${pf.leaf.tip}|${pf.leaf.base}|${pf.leaf.peak ?? ''}|${pf.leaf.veins}|${pf.leaf.petiole}|${pf.leaf.lobes ?? ''}|${pf.leaf.margin}`;
  const hit = unitCache.get(key);
  if (hit) return hit;
  const L = leafGeom(pf.leaf, 100, false);
  const hatch: Array<[P, P]> = [];
  for (let k = 0; k < 5; k++) { const t = 0.2 + k * 0.15; const x = L.pet + t * (100 - L.pet); hatch.push([[x - 2, 3], [x + 7, L.hw(t) * 0.9]]); }
  const BL = 100 - L.pet;
  const dark: Array<[P, P]> = [], light: Array<[P, P]> = [];
  for (let k = 0; k < 9; k++) { const t = 0.1 + k * 0.095; const x = L.pet + t * BL; const t2 = Math.min(0.97, t + 0.07); dark.push([[x, L.hw(t) * 0.1 + 0.6], [L.pet + t2 * BL, L.hw(t2) * 0.86]]); }
  for (let k = 0; k < 5; k++) { const t = 0.2 + k * 0.14; const x = L.pet + t * BL; const t2 = Math.min(0.97, t + 0.06); light.push([[x, -L.hw(t) * 0.6], [L.pet + t2 * BL, -L.hw(t2) * 0.88]]); }
  const up: P[] = [], dn: P[] = [];
  const simple = L.pts.length > 0;
  if (simple) {
    const K = 26;
    for (let i = 0; i <= K; i++) { const u = i / K; const t = u - Math.sin(2 * Math.PI * u) * 0.07; up.push([L.pet + t * BL, -L.hw(t)]); dn.push([L.pet + t * BL, L.hw(t)]); }
  }
  // 곁맥 — 감잎처럼 5~7쌍, 가운데 맥에서 비스듬히 나와 앞으로 휘며 가장자리 가까이에서 끝난다
  const veins: Array<[P, P, P]> = [];
  const nv = Math.max(3, Math.min(7, pf.leaf.veins));
  if (simple && pf.leaf.venation === 'pinnate') {
    for (let k = 0; k < nv; k++) {
      const t0 = 0.1 + (k * 0.74) / nv, t1 = Math.min(0.95, t0 + 0.2 - k * 0.012);
      for (const sg of [-1, 1]) veins.push([[L.pet + t0 * BL, sg * 0.8], [L.pet + (t0 + 0.07) * BL, sg * L.hw(t0 + 0.07) * 0.58], [L.pet + t1 * BL, sg * L.hw(t1) * 0.84]]);
    }
  }
  const u: UnitLeaf = { pts: L.pts, outline: L.outline, hatch, dark, light, pet: L.pet, up, dn, veins, hw: L.hw, ...(L.ring ? { ring: L.ring, veinLines: L.veinLines ?? [], shade: L.shade ?? [] } : {}) };
  unitCache.set(key, u);
  return u;
}

/** 빛(왼쪽 위)으로 향하는 단위 벡터. */
const TO_LIGHT: P = [-0.6, -0.8];

export type LeafPaths = {
  outline: string; hatch: string; midrib: string; dark: string; light: string; tf?: string;
  /** (B4) 곁맥(큰 잎), 뒤집힌 반쪽(잎 뒷면 — 비스듬히 돌아간 잎), 뒷면 맥·빗금. 없으면 ''. */
  veins: string; under: string; underVeins: string;
};

/**
 * 잎 한 장의 화면 경로 — 잎자루 (x,y), 각 ang(라디안, 0 = 오른쪽), 길이 len, fs = 단축(잎몸 폭 배율 — 비스듬히 보이는 잎).
 * outline = 잎몸 + 잎자루, midrib = 가운데 맥, dark/light = 그늘·밝은 반쪽 빗금(그늘 쪽 반은 빛 방향으로 자동 선택), hatch = 옛 빗금.
 * turn(B4) — 주면 fs < 0.78 인 잎을 '고르게 납작' 대신 '가운데 맥을 축으로 돌아간 잎'으로: 앞 반쪽은 거의 제 폭, 먼 반쪽은 좁게 접혀
 * 뒷면(맥이 도드라진 옅은 면)이 보인다. 고르게 납작하면 피침형처럼 보여서다. 아주 작은 잎(< 14px)은 접지 않고 fs ≥ 0.8.
 */
function leafD(pf: SpeciesProfile, x: number, y: number, ang: number, len: number, fs = 1, turn?: number): LeafPaths {
  const U = unitLeaf(pf);
  const s = len / 100;
  if (U.ring) return palmateD(U, x, y, ang, s, len, fs);
  if (!U.pts.length) return { outline: U.outline, hatch: '', midrib: '', dark: '', light: '', veins: '', under: '', underVeins: '', tf: `translate(${f1(x)} ${f1(y)}) rotate(${f1((ang * 180) / Math.PI)}) scale(${(s).toFixed(3)} ${(s * fs).toFixed(3)})` };
  const tiny = len < 14;
  const turned = turn !== undefined && !tiny && fs < 0.78;
  const fsE = tiny ? Math.max(0.8, fs) : turned ? 1 : fs;
  // +y 반쪽이 빛을 보면 뒤집어서 늘 +y = 그늘 쪽
  const ny: P = [-Math.sin(ang), Math.cos(ang)];
  const sy = (ny[0] * TO_LIGHT[0] + ny[1] * TO_LIGHT[1] > 0 ? -1 : 1);
  // 돌아간 잎 — 앞(빛 쪽, −y) 반쪽 폭 kUp, 먼(그늘 쪽, +y) 반쪽은 뒷면으로 좁게 kDn
  const kUp = turned ? 0.86 + 0.12 * (turn! % 1) : fsE;
  const kDn = turned ? 0.22 + 0.3 * Math.max(0, (fs - 0.4) / 0.38) : fsE;
  const T = (q: P): P => xf([q[0], q[1] * sy * (q[1] < 0 ? kUp : kDn)], x, y, ang, s);
  const upS = U.up.map(T), dnS = U.dn.map(T);
  const ring = [...upS, ...dnS.slice(1, -1).reverse()];
  const pb = T([U.pet, 0]), mid1 = T([55, turned ? 2.5 : 1.5]), mid2 = T([96, 0]);
  const outline = `${smoothOpen([...ring, ring[0]!])} Z M ${f1(x)} ${f1(y)} L ${f1(pb[0])} ${f1(pb[1])}`;
  const midrib = `M ${f1(pb[0])} ${f1(pb[1])} Q ${f1(mid1[0])} ${f1(mid1[1])} ${f1(mid2[0])} ${f1(mid2[1])}`;
  const seg = (arr: Array<[P, P]>) => arr.map(([a, b]) => { const A = T(a), Bq = T(b); return `M ${f1(A[0])} ${f1(A[1])} L ${f1(Bq[0])} ${f1(Bq[1])}`; }).join(' ');
  const qd = (v: [P, P, P]) => { const A = T(v[0]), Bq = T(v[1]), C = T(v[2]); return `M ${f1(A[0])} ${f1(A[1])} Q ${f1(Bq[0])} ${f1(Bq[1])} ${f1(C[0])} ${f1(C[1])}`; };
  const veins = len >= 30 ? U.veins.filter((v) => v[0][1] < 0).map(qd).join(' ') : ''; // 밝은 반쪽만(그늘 반쪽은 결 빗금이 맥 노릇)
  let under = '', underVeins = '';
  if (turned) {
    // 뒷면 반쪽 — 가운데 맥 ~ 먼 가장자리(닫힌 경로). 뒷면은 맥이 도드라진다(굵은 곁맥) + 옅은 결 빗금.
    const mids = U.dn.map((q) => T([q[0], 0]));
    under = `${smoothOpen([...mids, ...dnS.slice().reverse()])} Z`;
    const uv = U.veins.filter((v) => v[0][1] > 0).map(qd);
    const ux: string[] = [];
    for (let k = 1; k < 8; k++) { const t = k / 8; const xx = U.pet + t * (100 - U.pet); const A = T([xx, 0.6]), Bq = T([xx + 4, U.hw(t) * 0.9]); ux.push(`M ${f1(A[0])} ${f1(A[1])} L ${f1(Bq[0])} ${f1(Bq[1])}`); }
    underVeins = len >= 22 ? uv.join(' ') : '';
    return { outline, hatch: ux.join(' '), midrib, dark: '', light: len >= 30 ? seg(U.light) : '', veins, under, underVeins };
  }
  return { outline, hatch: seg(U.hatch), midrib, dark: seg(U.dark), light: seg(U.light), veins, under, underVeins };
}

/**
 * (B6) 손바닥 잎 한 장 — 화면 좌표로 옮겨(선 굵기 일정) 윤곽 + 살짝 휜 긴 잎자루 + 갈래 맥 + 그늘 쪽 갈래 빗금.
 * 비스듬한 잎도 폭을 0.72 아래로 줄이지 않는다(납작한 손바닥 잎은 덩어리로 보인다). 그늘 쪽은 빛 방향으로 자동 선택.
 */
function palmateD(U: UnitLeaf, x: number, y: number, ang: number, s: number, len: number, fs: number): LeafPaths {
  const fsE = Math.max(0.72, Math.min(1, fs));
  const ny: P = [-Math.sin(ang), Math.cos(ang)];
  const sy = (ny[0] * TO_LIGHT[0] + ny[1] * TO_LIGHT[1] > 0 ? -1 : 1);
  const T = (q: P): P => xf([q[0], q[1] * sy * fsE], x, y, ang, s);
  const ring = U.ring!.map(T);
  const J = T([U.pet, 0]);
  // 잎자루 — 긴 잎자루는 가운데가 살짝 위(빛 쪽)로 휜다
  const c = T([U.pet * 0.5, -U.pet * 0.07]);
  const outline = `${smoothOpen([...ring, ring[0]!])} Z M ${f1(x)} ${f1(y)} Q ${f1(c[0])} ${f1(c[1])} ${f1(J[0])} ${f1(J[1])}`;
  const seg = (arr: Array<[P, P]>) => arr.map(([a, b]) => { const A = T(a), Bq = T(b); return `M ${f1(A[0])} ${f1(A[1])} L ${f1(Bq[0])} ${f1(Bq[1])}`; }).join(' ');
  const veins = len >= 30 ? seg(U.veinLines ?? []) : '';
  // 작은 잎(잎몸 < 30px 남짓)은 갈래마다 한두 줄만
  const sh = U.shade ?? [];
  const dark = seg(len >= 60 ? sh : sh.filter((_, i) => i % 4 === 1));
  return { outline, hatch: seg(sh.filter((_, i) => i % 4 === 1)), midrib: '', dark, light: '', veins, under: '', underVeins: '' };
}

/** 그리는 순서(연필 맛) — 진행 p(0~1)를 단계별로: H 구조선 0~0.35, 2B 윤곽 0.2~0.7, 해칭 0.55~0.85, 6B 강조 0.8~1. */
export const STROKE_ORDER = { H: [0, 0.35], B2: [0.2, 0.7], hatch: [0.55, 0.85], B6: [0.8, 1] } as const;
const phase = (p: number, k: keyof typeof STROKE_ORDER) => interpolate(p, [STROKE_ORDER[k][0], STROKE_ORDER[k][1]], [0, 1], clamp);

/**
 * 감 — 중심 (x,y), 반지름 r. kind: flat(단감 — 납작한 둥근 네모 + 얕은 네 골)·round·long(대봉 — 아래가 뾰족한 도토리꼴).
 * 넉 장 꽃받침(넓고 두꺼움, 가장자리 들림, 그늘 빗금·두께선) + 짧고 굵은 꼭지. 명암 5요소(하이라이트를 도는 고리 해칭), 광택은 지우개(종이색) 점·호.
 * 가지에 달 때는 onTwig=[가지 위 점] — 꼭지 끝이 그 점에 바짝 붙는다(긴 꼭지 없음). 옛 hang 은 짧고 굵은 나무 꼭지로 잇는다.
 * hi = 포인트 색(말할 때만).
 */
export const PersimmonFruit: React.FC<{ x?: number; y?: number; r: number; kind?: 'flat' | 'round' | 'long'; p?: number; at?: number; hi?: number; o?: number; tilt?: number; hang?: P; onTwig?: P; detail?: boolean; seed?: string }> = ({ x: x0 = 0, y: y0 = 0, r, kind = 'flat', p, at = DONE, hi = 0, o = 1, tilt = 0, hang, onTwig, detail, seed = 'pf' }) => {
  const f = useCurrentFrame();
  // onTwig = 가지 위 붙는 점(잎겨드랑이) — 주면 꼭지 끝이 그 점에 닿게 몸 자리를 정한다(x·y 무시)
  const top0 = onTwig ? persimmonFruit(r, kind).top : 0, a0 = (tilt * Math.PI) / 180;
  const x = onTwig ? onTwig[0] + Math.sin(a0) * top0 : x0, y = onTwig ? onTwig[1] - Math.cos(a0) * top0 : y0;
  const pa = interpolate(f, [at, at + 20], [0, 1], clamp);
  const pp = p ?? pa;
  const big = detail ?? r > 26;
  const tiny = r < 11;
  const G = useMemo(() => persimmonFruit(r, kind), [r, kind]);
  const yOff = kind === 'long' ? G.ry * 0.08 : 0; // 대봉 — 그늘 고리 중심을 몸 가운데로
  const S = useMemo(() => sphereShade(r * 0.97, G.ry * (kind === 'long' ? 0.9 : 0.95), `${seed}s`, big ? Math.max(3.6, r * 0.055) : 3.4), [r, G.ry, seed, big, kind]);
  if (pp <= 0 || o <= 0) return null;
  const pc = phase(pp, 'B2'), ph = phase(pp, 'hatch'), p6 = phase(pp, 'B6');
  const cid = `b-pf-${seed}-${Math.round(r)}-${kind}`.replace(/[^\w-]/g, '');
  // 매단 점(hang)이 꼭지 끝에서 멀면(옛 장면) — 짧고 굵은 나무 꼭지로 잇는다(가는 실 같은 긴 꼭지 금지)
  const a = (tilt * Math.PI) / 180;
  const topX = x - Math.sin(a) * G.top, topY = y + Math.cos(a) * G.top;
  const far = hang ? Math.hypot(hang[0] - topX, hang[1] - topY) > r * 0.12 : false;
  const sw = Math.max(1.6, r * 0.13);
  return (
    <g opacity={o * Math.min(1, pp * 3)}>
      {hang && far ? (
        <g opacity={pc}>
          <path d={`M ${f1(hang[0])} ${f1(hang[1])} L ${f1(topX)} ${f1(topY + r * 0.05)}`} fill="none" stroke={PB.lead} strokeWidth={sw + 2.4} strokeLinecap="round" />
          <path d={`M ${f1(hang[0])} ${f1(hang[1])} L ${f1(topX)} ${f1(topY + r * 0.05)}`} fill="none" stroke={PB.lead2} strokeWidth={sw} strokeLinecap="round" />
        </g>
      ) : null}
      <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
        <defs><clipPath id={cid}><path d={G.body} /></clipPath></defs>
        {big ? <PLine d={G.body} w={TONE.H.w} tone="light" p={phase(pp, 'H')} double={false} /> : null}
        <path d={G.body} fill={PB.paper} opacity={pc} />
        {hi > 0 ? <Accent d={G.body} o={hi * pc} /> : null}
        <g clipPath={`url(#${cid})`}>
          <g transform={`translate(0 ${f1(yOff)})`}>
            {!tiny ? <ShadeLayers s={S} o={ph} o6={p6} /> : <path d={S.b2} stroke={PB.lead2} strokeWidth={0.8} fill="none" opacity={ph} />}
          </g>
          {/* 골 — 얕게(지우개로 한 번 문지른 2B) */}
          {!tiny ? G.grooves.map((d, i) => <g key={i} opacity={ph}><path d={d} fill="none" stroke={PB.paper} strokeWidth={big ? 3 : 1.6} transform="translate(-1.4 0)" opacity={0.85} /><path d={d} fill="none" stroke={PB.lead2} strokeWidth={big ? 1.1 : 0.8} opacity={i === 2 ? 0.35 : 0.6} /></g>) : null}
          {/* 지우개 — 광택(왼쪽 위 하이라이트 둘레 비움) + 반사광 호(오른쪽 아래 외곽 안) */}
          <ellipse cx={S.hl[0]} cy={S.hl[1] + yOff} rx={r * 0.16} ry={G.ry * 0.1} fill={PB.paper} transform={`rotate(-30 ${S.hl[0]} ${S.hl[1] + yOff})`} opacity={ph} />
          {!tiny ? <path d={`M ${f1(S.hl[0] - r * 0.06)} ${f1(S.hl[1] + yOff + G.ry * 0.2)} q ${f1(r * 0.02)} ${f1(-G.ry * 0.12)} ${f1(r * 0.14)} ${f1(-G.ry * 0.22)}`} fill="none" stroke={PB.paper} strokeWidth={Math.max(1.6, r * 0.03)} strokeLinecap="round" opacity={0.9 * ph} /> : null}
          {big ? <path d={`M ${f1(r * 0.2)} ${f1(G.ry * 0.7)} q ${f1(r * 0.34)} ${f1(-G.ry * 0.1)} ${f1(r * 0.52)} ${f1(-G.ry * 0.46)}`} fill="none" stroke={PB.paper} strokeWidth={Math.max(2, r * 0.035)} strokeLinecap="round" opacity={0.9 * p6} /> : null}
        </g>
        <PLine d={G.body} w={big ? TONE.B2.w : tiny ? 1.2 : 1.6} seed={`${seed}b`} p={pc} double={big} />
        {/* 꼭지(꽃받침 뒤) → 꽃받침 넉 장(먼 것부터): 종이 + 윤곽 + 그늘 빗금 + 두께선 + 맥(지우개) */}
        <path d={G.stalk} fill={PB.lead2} stroke={PB.lead} strokeWidth={big ? 1.3 : 0.9} opacity={pc} />
        {G.sepals.map((d, i) => (
          <g key={`s${i}`} opacity={pc}>
            <path d={d} fill={tiny ? PB.lead2 : PB.paper} fillOpacity={tiny ? 0.55 : 1} stroke={PB.lead} strokeWidth={big ? 1.7 : tiny ? 0.8 : 1.1} strokeLinejoin="round" />
            {!tiny ? <path d={G.sepalShade.slice(i * 7, i * 7 + 7).join(' ')} fill="none" stroke={i < 2 ? PB.lead : PB.lead2} strokeWidth={big ? 1.1 : 0.8} strokeLinecap="round" opacity={ph * (i < 2 ? 0.9 : 0.75)} /> : null}
            {!tiny ? <path d={G.rims[i]!} fill="none" stroke={PB.lead2} strokeWidth={big ? 1.1 : 0.7} opacity={0.85 * ph} /> : null}
            {big ? <path d={G.sepalVeins[i]!} fill="none" stroke={PB.paper} strokeWidth={1.6} opacity={ph} /> : null}
          </g>
        ))}
        {/* 꼭지 끝(꽃받침 가운데 위로 짧게 보이는 굵은 꼭지) */}
        <path d={`M ${f1(-r * 0.04)} ${f1(G.cy - r * 0.01)} C ${f1(-r * 0.045)} ${f1(G.top + r * 0.05)} ${f1(-r * 0.03)} ${f1(G.top)} ${f1(0)} ${f1(G.top)} C ${f1(r * 0.03)} ${f1(G.top)} ${f1(r * 0.045)} ${f1(G.top + r * 0.05)} ${f1(r * 0.04)} ${f1(G.cy - r * 0.01)} Z`} fill={PB.lead2} stroke={PB.lead} strokeWidth={big ? 1.1 : 0.7} opacity={pc} />
      </g>
    </g>
  );
};

/** 열매(감 말고 — 사과·배·핵과·장과·대추·밤) — 프리셋 fruit 형태. 중심 (x,y), 반지름 r. */
export const Fruit: React.FC<{ x: number; y: number; r: number; species?: string | SpeciesProfile; p?: number; at?: number; hi?: number; o?: number; hang?: P; seed?: string; kind?: 'flat' | 'round' | 'long'; tilt?: number }> = ({ x, y, r, species, p, at = DONE, hi = 0, o = 1, hang, seed = 'fr', kind, tilt }) => {
  const f = useCurrentFrame();
  const pf = speciesOf(species);
  const pa = interpolate(f, [at, at + 18], [0, 1], clamp);
  const pp = p ?? pa;
  const G = useMemo(() => fruitGeom(pf.fruit, r), [pf, r]);
  const S = useMemo(() => sphereShade(r * 0.96, G.ry * 0.96, `${seed}s`, Math.max(3.4, r * 0.08)), [r, G.ry, seed]);
  if (pf.fruit.type === 'persimmon') return <PersimmonFruit x={x} y={y} r={r} p={pp} hi={hi} o={o} {...(hang ? { hang } : {})} {...(kind ? { kind } : {})} {...(tilt !== undefined ? { tilt } : {})} seed={seed} />;
  if (pp <= 0 || o <= 0) return null;
  const pc = phase(pp, 'B2'), ph = phase(pp, 'hatch');
  const small = r < 10;
  return (
    <g opacity={o * Math.min(1, pp * 3)}>
      {hang ? <path d={`M ${f1(hang[0])} ${f1(hang[1])} L ${f1(x + G.top[0])} ${f1(y + G.top[1])}`} stroke={PB.lead} strokeWidth={1} fill="none" /> : null}
      <g transform={`translate(${x} ${y})`}>
        <path d={G.body} fill={PB.paper} opacity={pc} />
        {hi > 0 ? <Accent d={G.body} o={hi * pc} /> : null}
        {small ? <path d={S.b2} stroke={PB.lead2} strokeWidth={0.8} fill="none" opacity={ph} /> : <ShadeLayers s={S} o={ph} />}
        <ellipse cx={S.hl[0]} cy={S.hl[1]} rx={r * 0.14} ry={G.ry * 0.09} fill={PB.paper} opacity={ph} />
        <PLine d={G.body} w={small ? 1.2 : TONE.B2.w * 0.85} p={pc} double={!small} seed={`${seed}o`} />
        {G.details.map((d, i) => <path key={i} d={d.d} fill={d.fill ? (d.dark ? TONE.B6.color : PB.paper) : 'none'} stroke={d.dark ? TONE.B6.color : PB.lead} strokeWidth={small ? 0.8 : 1.3} opacity={pc} />)}
      </g>
    </g>
  );
};

/** 꽃 — 프리셋 flower. (x,y) = 꽃자루 붙는 점(항아리꽃·숙인 꽃) 또는 꽃 가운데(펼친 꽃). size = 지름 px. angle = 돌림(도). */
export const Flower: React.FC<{ x: number; y: number; size: number; species?: string | SpeciesProfile; angle?: number; p?: number; at?: number; hi?: number; o?: number }> = ({ x, y, size, species, angle = 0, p, at = DONE, hi = 0, o = 1 }) => {
  const f = useCurrentFrame();
  const pf = speciesOf(species);
  const pa = interpolate(f, [at, at + 16], [0, 1], clamp);
  const pp = p ?? pa;
  const G = useMemo(() => flowerGeom(pf.flower, size), [pf, size]);
  if (pp <= 0 || o <= 0) return null;
  const small = size < 24;
  const sw = small ? 0.9 : 1.6;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) translate(${-G.attach[0]} ${-G.attach[1]}) scale(${0.4 + 0.6 * pp})`} opacity={o * Math.min(1, pp * 2)}>
      {G.pieces.map((pc, i) => {
        if (pc.kind === 'stamen') return <path key={i} d={pc.d} stroke={PB.lead} strokeWidth={small ? 0.6 : 0.9} fill={PB.lead} fillOpacity={0.9} />;
        if (pc.kind === 'vein') return small ? null : <path key={i} d={pc.d} stroke={TONE.H.color} strokeWidth={0.9} fill="none" />;
        if (pc.kind === 'pedicel') return <path key={i} d={pc.d} stroke={PB.lead} strokeWidth={small ? 1 : 1.6} fill="none" strokeLinecap="round" />;
        const dark = pc.kind === 'calyx' || pc.kind === 'center';
        return (
          <g key={i}>
            <path d={pc.d} fill={hi > 0 && (pc.kind === 'petal' || pc.kind === 'corolla') ? PB.accentWash : PB.paper} stroke={PB.lead} strokeWidth={sw} strokeLinejoin="round" />
            {dark && !small ? <path d={pc.d} fill="url(#b-h50f)" opacity={0.7} /> : null}
          </g>
        );
      })}
    </g>
  );
};

/**
 * 잎 확대 — 프리셋 leaf(엽형·엽연·맥). 잎자루 (x,y), angle(도), len(px). 그늘 반쪽은 결 따라 해칭, 맥은 지우개(종이색) + 가는 선,
 * 광택 잎은 윤기 띠를 비운다.
 */
export const LeafDetail: React.FC<{ x: number; y: number; angle?: number; len: number; species?: string | SpeciesProfile; at?: number; p?: number; hi?: number; o?: number; seed?: string }> = ({ x, y, angle = -30, len, species, at = DONE, p, hi = 0, o = 1, seed = 'ld' }) => {
  const f = useCurrentFrame();
  const pf = speciesOf(species);
  const pa = interpolate(f, [at, at + 22], [0, 1], clamp);
  const pp = p ?? pa;
  const L = useMemo(() => leafGeom(pf.leaf, len, true), [pf, len]);
  if (pp <= 0 || o <= 0) return null;
  const pc = phase(pp, 'B2'), ph = phase(pp, 'hatch'), p6 = phase(pp, 'B6');
  const simple = pf.leaf.shape !== 'pinnate' && pf.leaf.shape !== 'palmate';
  // 그늘 반쪽(아래) — 곡면(잎이 가운데 맥에서 살짝 접힘)을 따라 휜 해칭: 2B 촘촘 / 위 반쪽은 가장자리 쪽만 H 성기게
  const hatch2: string[] = [], hatchH: string[] = [];
  if (simple) {
    const BL = len - L.pet;
    const sp = Math.max(3.6, len * 0.012);
    const n = Math.floor((BL * 0.95) / sp);
    for (let k = 1; k < n; k++) {
      const t = k / n, x0 = L.pet + t * BL, hw = L.hw(t);
      if (hw < 3) continue;
      hatch2.push(`M ${f1(x0)} ${f1(hw * 0.08)} Q ${f1(x0 + sp * 0.8)} ${f1(hw * 0.5)} ${f1(x0 + sp * 0.4)} ${f1(hw * 0.86)}`);
      if (k % 3 === 0 && t > 0.15 && t < 0.85) hatchH.push(`M ${f1(x0)} ${f1(-hw * 0.62)} Q ${f1(x0 + sp)} ${f1(-hw * 0.78)} ${f1(x0 + sp * 0.6)} ${f1(-hw * 0.88)}`);
    }
  }
  if (L.shade?.length) for (const [a, b] of L.shade) hatch2.push(`M ${f1(a[0])} ${f1(a[1])} L ${f1(b[0])} ${f1(b[1])}`); // (B6) 손바닥 잎 — 갈래마다 그늘 쪽 빗금
  const shine = pf.leaf.glossy && simple ? `M ${f1(L.pet + len * 0.16)} ${f1(-L.W * 0.2)} Q ${f1(len * 0.5)} ${f1(-L.W * 0.32)} ${f1(len * 0.8)} ${f1(-L.W * 0.12)}` : '';
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} opacity={o}>
      <PLine d={L.outline} w={TONE.H.w} tone="light" p={phase(pp, 'H')} double={false} />
      <path d={L.outline} fill={PB.paper} opacity={pc} />
      {hi > 0 ? <Accent d={L.outline} o={hi * pc} /> : null}
      <g opacity={ph}>
        <path d={hatch2.join(' ')} stroke={PB.lead2} strokeWidth={TONE.B2.hatch} fill="none" strokeLinecap="round" />
        <path d={hatchH.join(' ')} stroke={TONE.H.color} strokeWidth={TONE.H.hatch} fill="none" strokeLinecap="round" />
        {/* 잎맥 — 지우개(종이색 굵게) 위에 가는 2B 선: 도드라진 맥 */}
        {L.veins.map((d, i) => <path key={`e${i}`} d={d} fill="none" stroke={PB.paper} strokeWidth={3.2} strokeLinecap="round" />)}
        {L.veins.map((d, i) => <path key={`v${i}`} d={d} fill="none" stroke={PB.lead2} strokeWidth={1.1} strokeLinecap="round" transform="translate(0.8 0.8)" />)}
        {shine ? <path d={shine} fill="none" stroke={PB.paper} strokeWidth={5} strokeLinecap="round" opacity={0.95} /> : null}
      </g>
      <path d={L.midrib} fill="none" stroke={PB.paper} strokeWidth={4} opacity={ph} />
      <PLine d={L.midrib} w={2.2} p={pc} seed={`${seed}m`} />
      <PLine d={L.outline} w={TONE.B2.w} p={pc} seed={`${seed}o`} />
      {simple && p6 > 0 ? <path d={smoothOpen(Array.from({ length: 12 }, (_, i) => { const t = 0.1 + i * 0.075; return [L.pet + t * (len - L.pet), L.hw(t)] as P; }))} fill="none" stroke={TONE.B6.color} strokeWidth={TONE.B6.w * 0.8} strokeLinecap="round" opacity={p6} /> : null}
    </g>
  );
};

/** 감잎 확대(옛 이름) — LeafDetail species="persimmon". */
export const PersimmonLeaf: React.FC<{ x: number; y: number; angle?: number; len: number; at?: number; p?: number; hi?: number; o?: number; autumn?: boolean; seed?: string }> = ({ autumn: _a, ...rest }) => <LeafDetail {...rest} species="persimmon" />;

/** 떨어지는 잎 — 상자(x0~x1, y0 위 → y1 땅) 안에서 at~until 동안, 팔랑이며 내려온다(종 프리셋 잎 모양). */
export const FallingLeaves: React.FC<{ x0: number; x1: number; y0: number; y1: number; at: number; until?: number; n?: number; size?: number; seed?: string; species?: string | SpeciesProfile }> = ({ x0, x1, y0, y1, at, until, n = 14, size = 22, seed = 'fl', species }) => {
  const f = useCurrentFrame();
  const pf = speciesOf(species);
  const end = until ?? at + 60;
  if (f < at) return null;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const born = at + (i / n) * (end - at);
        const age = f - born;
        const life = 34 + random(`${seed}l${i}`) * 26;
        if (age < 0) return null;
        const k = Math.min(1, age / life);
        const sx = x0 + random(`${seed}x${i}`) * (x1 - x0);
        const yy = y0 + (y1 - y0) * k;
        const sway = Math.sin(age / 7 + i) * 16 * (1 - k * 0.5);
        const ang = Math.sin(age / 9 + i * 2) * 1.1 + i;
        const len = size * (0.75 + random(`${seed}s${i}`) * 0.5);
        const lying = k >= 1;
        const d = leafD(pf, sx + sway, yy, lying ? (random(`${seed}a${i}`) - 0.5) * 0.6 : ang, len);
        return <path key={i} d={d.outline} {...(d.tf ? { transform: d.tf } : {})} fill={PB.paper} stroke={PB.lead} strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={lying ? Math.max(0, 1 - (age - life) / 24) : 1} />;
      })}
    </g>
  );
};

const LEGACY_SEASON: Record<'full' | 'autumn' | 'bare', Season> = { full: 'summer', autumn: 'autumn', bare: 'winter' };

/**
 * 나무 — 밑동 (x,y)(= 땅 높이), 키 h. species = 종 프리셋(기본 감나무 — 'persimmon'·'blueberry'…, 없으면 일반형).
 * age: sapling(1~2년 접목묘)·young(3~5년)·mature(성목). season: winter(잎 없음 — 겨울눈만)·spring·summer·autumn. leaves(옛: full·autumn·bare)도 받는다.
 * fruit: 열매(기본 = 계절이 프리셋 열매 철일 때). bloom: 꽃(프리셋 꽃 자리·꽃차례).
 * roots: none·small·wide·bare(맨뿌리)·ball(뿌리분). rootP(0~1) 뻗음. store(0~1) 양분 알갱이. shadow: 투영 그림자(땅에 선 나무 기본 켬).
 * at 부터 grow 프레임 동안 H 구조선 → 2B 윤곽 → 해칭 → 6B 강조 순으로 밑에서 끝으로 그려진다. hi: {trunk, crown, fruit, graft, roots, store}.
 */
export const Tree: React.FC<{
  x: number; y: number; h: number; age?: TreeAge; seed: string; species?: string | SpeciesProfile; season?: Season; leaves?: 'full' | 'autumn' | 'bare'; fruit?: boolean; bloom?: boolean; at?: number; grow?: number; o?: number;
  roots?: 'none' | RootKind; rootW?: number; rootDepth?: number; rootP?: number; store?: number;
  hi?: { trunk?: number; crown?: number; fruit?: number; graft?: number; roots?: number; store?: number };
  shadow?: boolean;
  /** 감 품종 모양 — flat(단감, 기본)·round·long(대봉). */
  cultivar?: 'flat' | 'round' | 'long';
  /** 접목묘 대목 움(접붙인 자리 아래 가는 순) 그리기. */
  suckers?: boolean;
}> = ({ x, y, h, age = 'mature', seed, species, season, leaves, fruit, bloom = false, at = DONE, grow = 40, o = 1, roots = 'none', rootW, rootDepth, rootP = 1, store = 0, hi = {}, shadow, cultivar = 'flat', suckers = false }) => {
  const f = useCurrentFrame();
  const pf = speciesOf(species);
  const sp = useMemo(() => speciesFromProfile(pf), [pf]);
  const g = useMemo(() => treeGeom2(seed, h, age, sp), [seed, h, age, sp]);
  const ssn: Season = season ?? (leaves ? LEGACY_SEASON[leaves] : 'summer');
  const fruitSeason: Season[] = pf.fruit.months.some((m) => m >= 9) ? ['autumn'] : ['summer'];
  const showFruit = fruit ?? fruitSeason.includes(ssn);
  const R = useMemo(() => {
    if (roots === 'none') return null;
    const tw = g.trunk.w0;
    const rw = rootW ?? (roots === 'wide' ? h * 0.95 : roots === 'ball' ? Math.max(tw * 6, h * 0.22) : h * 0.32);
    const rd = rootDepth ?? (roots === 'wide' ? h * 0.3 : roots === 'ball' ? rw * 0.8 : h * 0.2);
    const geo = rootGeom2(`${seed}r`, rw, rd, roots, Math.max(4, tw * (roots === 'wide' ? 0.5 : 0.7)));
    const shades = geo.thick.map((s, i) => (s.w[0]! > 6 ? cylShade(s.pts, s.w, `${seed}rs${i}`, 4, { core: s.w[0]! > 10 }) : null));
    return { geo, rw, rd, shades };
  }, [roots, rootW, rootDepth, h, seed, g]);
  const t = interpolate(f, [at, at + grow], [0, 1.25], clamp);
  const parts = useMemo(() => prepare(g, sp, seed, age, ssn), [g, sp, seed, age, ssn]);
  if (t <= 0 || o <= 0) return null;
  const pFor = (order: number) => interpolate(t, [order * 0.9, order * 0.9 + 0.3], [0, 1], clamp);
  const trunkP = pFor(0);
  const tp = Math.min(1, t / 1.15); // 전체 진행(단계용)
  const pHatch = phase(tp, 'hatch'), p6 = phase(tp, 'B6');
  const rid = `b-tree-rc-${seed}`;
  const reach = R ? Math.hypot(R.rw / 2, R.rd) * 1.15 : 0;
  const hiRoots = hi.roots ?? 0, hiStore = hi.store ?? 0;
  const trunkD = parts.thick[0]?.d ?? '';
  const onGround = roots !== 'bare' && roots !== 'ball';
  const showShadow = shadow ?? onGround;
  const stemP = (order: number) => pFor(order * 0.6);
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      {/* 투영 그림자 — 빛 반대쪽(오른쪽 아래) */}
      {showShadow ? <CastShadow x={0} y={0} w={g.trunk.w0 * 1.3} len={sp.form === 'shrub' ? h * 0.7 : age === 'sapling' ? h * 0.3 : h * 0.62} o={trunkP} /> : null}
      {/* 뿌리 */}
      {R ? (
        <g>
          <defs><clipPath id={rid}><circle cx={0} cy={0} r={Math.max(0.1, reach * rootP)} /></clipPath></defs>
          <g clipPath={`url(#${rid})`} opacity={trunkP > 0 ? 1 : 0}>
            {R.geo.ball ? (
              <g>
                <path d={R.geo.ball.body} fill={PB.paper} />
                {hiRoots > 0 ? <Accent d={R.geo.ball.body} o={hiRoots} /> : null}
                {stipple({ x0: -R.rw / 2, y0: 0, x1: R.rw / 2, y1: R.rd }, Math.round(R.rw * R.rd * 0.006), `${seed}bs`, 0.8, 2).filter(([sx, sy]) => (sx / (R.rw / 2)) ** 2 + ((sy - R.rd / 2) / (R.rd / 2)) ** 2 < 0.9).map(([sx, sy, sr], k) => <circle key={k} cx={sx} cy={sy} r={sr * (1.3 - sy / R.rd * 0.6)} fill={PB.lead2} opacity={0.75} />)}
                <g transform={`translate(0 ${R.rd * 0.5})`}><ShadeLayers s={sphereShade(R.rw * 0.5, R.rd * 0.5, `${seed}bh`, 5)} o={pHatch} o6={p6} /></g>
                <PLine d={R.geo.ball.body} w={TONE.B2.w * 0.9} seed={`${seed}bb`} />
              </g>
            ) : null}
            <path d={R.geo.fine.join(' ')} fill="none" stroke={hiRoots > 0.5 ? PB.accent : PB.lead2} strokeWidth={1} strokeLinecap="round" opacity={0.9} />
            {R.geo.thick.map((s, i) => <path key={`ro${i}`} d={taperSmooth(s.pts, s.w)} fill="none" stroke={hiRoots > 0.5 ? PB.accent : PB.lead} strokeWidth={3.4} strokeLinejoin="round" />)}
            {R.geo.thick.map((s, i) => <path key={`rf${i}`} d={taperSmooth(s.pts, s.w)} fill={hiRoots > 0 ? PB.accentWash : PB.paper} opacity={hiRoots > 0 ? 0.6 + 0.4 * (1 - hiRoots) : 1} />)}
            {R.shades.map((sh, i) => (sh ? <ShadeLayers key={`rh${i}`} s={sh} o={pHatch * 0.9} o6={p6} /> : null))}
            {store > 0 ? R.geo.thick.filter((s) => s.level === 0).flatMap((s, i) => s.pts.slice(1, -2).map((q, k) => <circle key={`st${i}-${k}`} cx={q[0]} cy={q[1]} r={Math.max(2, s.w[k]! * 0.18)} fill={hiStore > 0.5 ? PB.accent : PB.lead} opacity={store * 0.85} />)) : null}
          </g>
        </g>
      ) : null}
      {/* 뒤쪽 잎 — H 톤(먼 것) */}
      <LeafLayer leaves={parts.back} pFor={pFor} hi={hi.crown ?? 0} back young={ssn === 'spring'} />
      {/* 굵은 가지 — H 구조선 → 2B 윤곽(먼저 전부) → 종이 → 해칭(H·2B) → 6B(핵심 그림자·그늘 쪽 강조선·껍질 골) */}
      {parts.thick.map((s, i) => { const p = stemP(s.order); const ph = phase(p, 'H'); return ph <= 0 ? null : <path key={`tc${i}`} d={s.center} fill="none" stroke={TONE.H.color} strokeWidth={TONE.H.w} strokeLinecap="round" {...(ph < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - ph } : {})} />; })}
      {parts.thick.map((s, i) => { const pk = phase(stemP(s.order), 'B2'); return pk <= 0 ? null : <path key={`to${i}`} d={s.d} fill="none" stroke={(i === 0 && (hi.trunk ?? 0) > 0.5) ? PB.accent : PB.lead} strokeWidth={s.ow} strokeLinejoin="round" {...(pk < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - pk } : {})} />; })}
      {parts.thick.map((s, i) => { const pk = phase(stemP(s.order), 'B2'); return pk <= 0 ? null : <path key={`tf${i}`} d={s.d} fill={PB.paper} opacity={interpolate(pk, [0.5, 1], [0, 1], clamp)} />; })}
      {(hi.trunk ?? 0) > 0 && trunkD ? <Accent d={trunkD} o={hi.trunk} /> : null}
      <ShadeLayers s={parts.shade} o={pHatch} o6={p6} />
      {parts.bark ? <g>
        <path d={parts.bark.furrows} fill="none" stroke={PB.lead} strokeWidth={1.4} strokeLinecap="round" opacity={0.8 * pHatch} />
        <path d={parts.bark.cracks} fill="none" stroke={PB.lead2} strokeWidth={1.1} strokeLinecap="round" opacity={0.85 * pHatch} />
        <path d={parts.bark.dark} fill="none" stroke={TONE.B6.color} strokeWidth={2} strokeLinecap="round" opacity={0.9 * p6} />
        {/* 지우개 — 껍질 조각 능선(그늘 위 종이색 선) */}
        <path d={parts.bark.dark} fill="none" stroke={PB.paper} strokeWidth={1.3} strokeLinecap="round" transform="translate(-2.6 0)" opacity={0.9 * p6} />
      </g> : null}
      {parts.plates ? (
        <g>
          <defs><clipPath id={`b-tree-bk-${seed}`}><path d={parts.plates.clip} /></clipPath></defs>
          <g clipPath={`url(#b-tree-bk-${seed})`}>
            {/* 골 — 짙은 회갈색 바탕(겹친 빗금), 그 위에 조각 */}
            <path d={parts.plates.clip} fill={TONE.B6.color} opacity={0.22 * pHatch} />
            <path d={parts.plates.clip} fill="url(#b-h50f)" opacity={pHatch} />
            <path d={parts.plates.clip} fill="url(#b-h-40)" opacity={0.85 * pHatch} />
            {/* 골 가운데 — 세로 골 6B(굵게), 가로 금 2B(b2 에 섞여 있다) */}
            <path d={parts.plates.b6} fill="none" stroke={TONE.B6.color} strokeWidth={TONE.B6.hatch * 1.6} strokeLinecap="round" opacity={0.85 * p6} />
            {/* 조각 — 종이 칠(윤곽은 가는 2B, 테두리선이 아니라 골의 어둠이 모양을 만든다) */}
            <path d={parts.plates.plates} fill={PB.paper} stroke={PB.lead2} strokeWidth={0.7} strokeLinejoin="round" opacity={interpolate(pHatch, [0, 0.4], [0, 1], clamp)} />
            {/* 들뜬 조각 밑 그늘 */}
            <path d={parts.plates.lift} fill={TONE.B6.color} opacity={0.75 * p6} />
            <path d={parts.plates.h} fill="none" stroke={TONE.H.color} strokeWidth={TONE.H.hatch} strokeLinecap="round" opacity={0.9 * pHatch} />
            <path d={parts.plates.b2} fill="none" stroke={PB.lead2} strokeWidth={TONE.B2.hatch} strokeLinecap="round" opacity={0.7 * pHatch} />
            {/* 위·왼쪽 변 — 지우개(종이색) 능선: 조각이 도드라져 보이게 */}
            <path d={parts.plates.litEdge} fill="none" stroke={PB.paper} strokeWidth={1.6} strokeLinecap="round" opacity={0.85 * pHatch} />
            <path d={parts.plates.darkEdge} fill="none" stroke={TONE.B6.color} strokeWidth={1.3} strokeLinecap="round" opacity={0.85 * p6} />
          </g>
        </g>
      ) : null}
      {parts.grain ? <path d={parts.grain} stroke={PB.lead2} strokeWidth={0.85} strokeLinecap="round" opacity={0.6 * pHatch} /> : null}
      {parts.lenticels ? <path d={parts.lenticels} stroke={PB.lead2} strokeWidth={1.2} strokeLinecap="round" opacity={0.8 * pHatch} /> : null}
      <path d={parts.accent6} fill="none" stroke={TONE.B6.color} strokeWidth={TONE.B6.w * 0.55} strokeLinecap="round" opacity={0.85 * p6} />
      {store > 0 && trunkD ? (
        <g>
          <defs><clipPath id={`b-tree-st-${seed}`}><path d={trunkD} /></clipPath></defs>
          <g clipPath={`url(#b-tree-st-${seed})`}>
            {stipple({ x0: -g.trunk.w0, y0: g.trunk.top, x1: g.trunk.w0, y1: 0 }, Math.round(g.trunk.w0 * -g.trunk.top * 0.01 * store), `${seed}st`, 2, 4.5).map(([sx, sy, sr], k) => (
              <circle key={k} cx={sx} cy={sy} r={sr} fill={hiStore > 0.5 ? PB.accent : PB.lead} opacity={0.8} />
            ))}
          </g>
        </g>
      ) : null}
      {/* (B6) 가시 */}
      {parts.prickles ? <path d={parts.prickles} fill={PB.lead2} stroke={PB.lead} strokeWidth={0.9} strokeLinejoin="round" opacity={pFor(0.4)} /> : null}
      {/* 대목 움(접목묘) */}
      {suckers && g.suckers ? g.suckers.map((sk, i) => <path key={`sk${i}`} d={taperSmooth(sk.pts, sk.w)} fill={PB.paper} stroke={PB.lead} strokeWidth={1.3} opacity={pFor(0.3)} />) : null}
      {/* 잔가지 — 굵기대로 그은 2B 선(자라는 차례 묶음) */}
      {parts.thin.map((b, i) => { const p = phase(stemP(b.order), 'B2'); return p <= 0 ? null : <path key={`tn${i}`} d={b.d} fill="none" stroke={PB.lead} strokeWidth={b.w} strokeLinecap="round" opacity={0.95} {...(p < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - p } : {})} />; })}
      {/* 수관 속 톤(성목 잎철) — 속 가지는 종이로 흐리게 덮고, 짧은 빗금: 밝은 쪽 H, 그늘 쪽 2B */}
      {parts.veil ? <path d={parts.veil} fill={PB.paper} opacity={0.5 * pFor(0.75)} /> : null}
      {parts.toneL ? <path d={parts.toneL} fill="none" stroke={TONE.H.color} strokeWidth={1.1} strokeLinecap="round" opacity={pFor(0.75)} /> : null}
      {parts.toneD ? <path d={parts.toneD} fill="none" stroke={PB.lead2} strokeWidth={1.1} strokeLinecap="round" opacity={0.9 * pFor(0.8)} /> : null}
      {parts.toneX ? <path d={parts.toneX} fill="none" stroke={TONE.B6.color} strokeWidth={1.1} strokeLinecap="round" opacity={0.75 * pFor(0.85)} /> : null}
      {/* 겨울눈 — 마디마다 어긋나게, 끝눈은 조금 크게. 눈 밑 잎자국(반달) */}
      {parts.scars ? <path d={parts.scars} fill="none" stroke={PB.lead2} strokeWidth={1} strokeLinecap="round" opacity={0.85 * pFor(0.85)} /> : null}
      {parts.buds ? <path d={parts.buds} fill={PB.lead2} stroke={PB.lead} strokeWidth={0.8} strokeLinejoin="round" opacity={0.95 * pFor(0.85)} /> : null}
      {/* 꽃 */}
      {bloom ? g.flowers.map((fl, i) => <Flower key={`fw${i}`} x={fl.x} y={fl.y} size={Math.max(8, h * (age === 'mature' ? 0.022 : 0.045))} species={pf} angle={0} p={pFor(fl.order)} />) : null}
      {/* 열매 */}
      {showFruit ? g.fruits.map((fr, i) => {
        if (sp.fruit !== 'persimmon') return <Fruit key={`fr${i}`} x={fr.x} y={fr.y} r={fr.r} species={pf} hang={[fr.hangX, fr.hangY]} p={pFor(fr.order)} hi={hi.fruit ?? 0} seed={`${seed}f${i}`} />;
        // 감 — 꼭지 끝(꽃받침 위)이 잎겨드랑이에 닿게 몸 중심을 맞춘다(긴 꼭지 없음)
        const top = persimmonFruit(fr.r, cultivar).top, a = (fr.tilt * Math.PI) / 180;
        return <PersimmonFruit key={`fr${i}`} x={fr.hangX + Math.sin(a) * top} y={fr.hangY - Math.cos(a) * top} r={fr.r} kind={cultivar} tilt={fr.tilt} p={pFor(fr.order)} hi={hi.fruit ?? 0} seed={`${seed}f${i}`} />;
      }) : null}
      {/* 앞쪽 잎 */}
      <LeafLayer leaves={parts.front} pFor={pFor} hi={hi.crown ?? 0} young={ssn === 'spring'} />
      {/* 접붙인 자리 — 부푼 혹(몸통 굵기에 들어 있음) + 비스듬한 접면 흉(6B) + 아물며 생긴 굳은살 능선(2B) */}
      {g.graft ? (() => {
        const G2 = g.graft, gw = G2.w, hg = (hi.graft ?? 0);
        const sl = (G2.kink ?? 0.1) > 0 ? -1 : 1; // 접면 기울기 — 접수가 비켜 선 쪽으로
        return (
          <g opacity={pFor(0)}>
            <path d={`M ${f1(-gw * 0.48)} ${f1(G2.y + sl * gw * 0.32)} Q ${f1(G2.dx * 0.4)} ${f1(G2.y + gw * 0.06)} ${f1(gw * 0.5)} ${f1(G2.y - sl * gw * 0.32)}`} stroke={hg > 0.5 ? PB.accent : age === 'young' ? PB.lead2 : TONE.B6.color} strokeWidth={hg > 0.5 ? 3.2 : age === 'young' ? 1.3 : Math.max(1.6, Math.min(2.6, gw * 0.12))} fill="none" strokeLinecap="round" opacity={age === 'young' && hg <= 0.5 ? 0.6 : 1} />
            {age === 'young' ? null : <path d={`M ${f1(-gw * 0.38)} ${f1(G2.y + sl * gw * 0.25 + gw * 0.28)} q ${f1(gw * 0.3)} ${f1(-gw * 0.12 * sl)} ${f1(gw * 0.6)} ${f1(-gw * 0.4 * sl)}`} stroke={PB.lead2} strokeWidth={1.1} fill="none" />}
            {age === 'young' ? null : <path d={`M ${f1(-gw * 0.3)} ${f1(G2.y + sl * gw * 0.2 - gw * 0.3)} q ${f1(gw * 0.25)} ${f1(-gw * 0.1 * sl)} ${f1(gw * 0.5)} ${f1(-gw * 0.32 * sl)}`} stroke={TONE.H.color} strokeWidth={1} fill="none" />}
            {hg > 0 ? <circle cx={G2.dx * 0.5} cy={G2.y} r={gw * 1.5 + 14} fill="none" stroke={PB.accent} strokeWidth={2.8} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - hg} /> : null}
          </g>
        );
      })() : null}
    </g>
  );
};

type Prepared = {
  thick: Array<{ d: string; center: string; order: number; ow: number }>;
  thin: Array<{ d: string; order: number; w: number }>;
  shade: { h: string; b2: string; b6: string };
  accent6: string;
  bark: { furrows: string; cracks: string; dark: string } | null;
  /** 성목 거북등 조각(굵은 몸통·원가지). clip = 조각을 그릴 줄기 윤곽(골 톤 바탕). */
  plates: { plates: string; litEdge: string; darkEdge: string; h: string; b2: string; b6: string; lift: string; clip: string } | null;
  lenticels: string;
  /** 어린 껍질 옅은 세로 결. */
  grain: string;
  buds: string;
  /** 겨울눈 밑 잎자국(반달). */
  scars: string;
  /** (B6) 가시(프리셋 habit.prickles) — 줄기·가지 윤곽에서 바깥·위로 뾰족한 세모. */
  prickles: string;
  back: LeafR[]; front: LeafR[];
  /** 수관 속 톤 빗금(성목 잎철) — 밝은(H)·짙은(2B), veil = 속 가지를 흐리게 덮는 종이. */
  toneL: string; toneD: string; toneX: string; veil: string;
};
type LeafR = { outline: string; hatch: string; midrib: string; dark: string; light: string; tf?: string; veins: string; under: string; underVeins: string; order: number; x: number; y: number; len: number; shade: number; back: boolean };

/** 그릴 준비(계절·나이에 따라) — 무거운 계산은 한 번. */
function prepare(g: Tree2G, sp: Species, seed: string, age: TreeAge, season: Season): Prepared {
  const pf = sp.profile;
  const TH = 3.4; // 이보다 굵으면 윤곽 가지
  const thick: Prepared['thick'] = [];
  const thinB = new Map<string, { d: string[]; order: number; w: number }>();
  const sh = { h: [] as string[], b2: [] as string[], b6: [] as string[] };
  const acc6: string[] = [];
  // 성목 거북등 조각 — 몸통이 충분히 굵을 때(가운데 ≥ 26px). 가늘면 옛 골·금(작게 보일 때 단순화).
  const midW = g.trunk.w[Math.floor(g.trunk.w.length * 0.4)] ?? g.trunk.w0;
  const usePlates = age === 'mature' && sp.bark === 'blocky' && midW >= 26;
  const plateOn = (s: Tree2G['stems'][number], i: number) => usePlates && (i === 0 || (s.level === 1 && (s.w[0] ?? 0) >= 24));
  g.stems.forEach((s, i) => {
    const maxW = Math.max(...s.w);
    if (maxW >= TH) {
      thick.push({ d: taperSmooth(s.pts, s.w), center: smoothOpen(s.pts), order: s.order, ow: i === 0 ? TONE.B2.w * 2.1 : maxW > 12 ? TONE.B2.w * 1.75 : TONE.B2.w * 1.3 });
      if (maxW > 7 && !(plateOn(s, i) && i === 0)) {
        const c = cylShade(s.pts, s.w, `${seed}h${i}`, maxW > 30 ? 4.2 : 3.6, { core: maxW > 12 });
        sh.h.push(c.h); sh.b2.push(c.b2); sh.b6.push(c.b6);
      }
      // 6B — 그늘 쪽 외곽 강조(가장 앞 큰 줄기·원가지만)
      if (maxW > 14) acc6.push(sideLine(s.pts, s.w, shadeSide(s.pts), 1));
    } else {
      // 가는 가지 — 두 토막(굵기 다르게)
      const n = s.pts.length;
      const mid = Math.max(1, Math.floor(n / 2));
      for (const [a, b] of [[0, mid], [mid, n - 1]] as const) {
        if (b <= a) continue;
        const w = Math.max(0.9, (s.w[a]! + s.w[b]!) / 2);
        const key = `${Math.round(s.order * 10)}-${w.toFixed(1)}`;
        const e = thinB.get(key) ?? { d: [], order: s.order, w };
        e.d.push(smoothOpen(s.pts.slice(a, b + 1)));
        thinB.set(key, e);
      }
    }
  });
  const trunk = g.stems[0]!;
  let bark: Prepared['bark'] = null;
  let lenticels = '';
  let grain = '';
  let plates: Prepared['plates'] = null;
  if (usePlates) {
    // 거북등 — 몸통 전체 + 굵은 원가지 아래쪽 절반
    const acc = { plates: [] as string[], litEdge: [] as string[], darkEdge: [] as string[], h: [] as string[], b2: [] as string[], b6: [] as string[], lift: [] as string[], clip: [] as string[] };
    // (B5) 조각 크기는 몸통 기준 하나 — 원가지도 같은 크기 조각(실물: 가는 원가지일수록 둘레에 조각이 더 많다).
    const cellPx = Math.max(7, (midW * Math.PI) / 2 / 14);
    g.stems.forEach((s, i) => {
      if (!plateOn(s, i)) return;
      const n = i === 0 ? s.pts.length : Math.max(3, Math.floor(s.pts.length * 0.5));
      const b = barkPlates(s.pts.slice(0, n), s.w.slice(0, n), `${seed}bp${i}`, { y0Frac: i === 0 ? 0.015 : 0.06, cellPx });
      acc.plates.push(b.plates); acc.litEdge.push(b.litEdge); acc.darkEdge.push(b.darkEdge); acc.h.push(b.h); acc.b2.push(b.b2); acc.b6.push(b.b6); acc.lift.push(b.lift);
      acc.clip.push(taperSmooth(s.pts.slice(0, n), s.w.slice(0, n)));
    });
    plates = { plates: acc.plates.join(' '), litEdge: acc.litEdge.join(' '), darkEdge: acc.darkEdge.join(' '), h: acc.h.join(' '), b2: acc.b2.join(' '), b6: acc.b6.join(' '), lift: acc.lift.join(' '), clip: acc.clip.join(' ') };
  } else if (age === 'mature' && sp.bark === 'blocky') {
    bark = barkBlocky(g.trunk.pts, g.trunk.w, `${seed}bk`, 0.05, 1);
    g.stems.forEach((s, i) => {
      if (i === 0 || s.level !== 1 || (s.w[0] ?? 0) < 20) return;
      const n = Math.max(3, Math.floor(s.pts.length * 0.45));
      const b = barkBlocky(s.pts.slice(0, n), s.w.slice(0, n), `${seed}bk${i}`, 0.08, 1);
      bark!.furrows += ` ${b.furrows}`; bark!.cracks += ` ${b.cracks}`; bark!.dark += ` ${b.dark}`;
    });
  } else if (sp.form !== 'shrub') {
    // 어린 나무·묘목 — 매끈한 회갈색 껍질: 껍질눈(가로 짧은 틈) + 옅은 세로 결 — 실촬영 어린 감나무와 같게
    const sm = barkSmooth(trunk.pts, trunk.w, `${seed}sm`, age === 'young' ? 1.8 : 0.9);
    lenticels = sm.lenticels; grain = sm.grain;
    if (age === 'young') g.stems.forEach((s, i) => { if (i > 0 && s.level === 1 && (s.w[0] ?? 0) > 9) { const b = barkSmooth(s.pts, s.w, `${seed}sm${i}`, 0.8); lenticels += ` ${b.lenticels}`; } });
  }
  // (B6) 가시 — 굵은 줄기·가지 윤곽 양쪽에 어긋나게(바깥·끝 쪽으로 기운 넓은 밑 세모). 어린 나무·묘목은 몸통도, 성목은 가지만.
  const pr: string[] = [];
  if (sp.prickles) {
    g.stems.forEach((s, si) => {
      const maxW = Math.max(...s.w);
      if (maxW < TH || (age === 'mature' && s.level === 0)) return;
      let acc = 0, k = 0;
      const young = age !== 'mature';
      const gap = young ? Math.max(7, maxW * 0.55) : Math.max(9, maxW * 0.9); // 어린 줄기는 가시가 촘촘
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1]!, b = s.pts[i]!;
        const dl = Math.hypot(b[0] - a[0], b[1] - a[1]);
        acc += dl;
        if (acc < gap * (0.75 + random(`${seed}pg${si}:${k}`) * 0.5)) continue;
        acc = 0; k++;
        if (si === 0 && i < s.pts.length * 0.06) continue; // 뿌리목 위부터
        const tx = (b[0] - a[0]) / dl, ty = (b[1] - a[1]) / dl;
        const side = k % 2 === 0 ? 1 : -1;
        const nx = -ty * side, ny = tx * side;
        const w = s.w[i]! / 2;
        const sz = Math.max(3, Math.min(young ? 12 : 10, s.w[i]! * (young ? 0.5 : 0.4))) * (0.8 + random(`${seed}ps${si}:${k}`) * 0.4);
        const bx = b[0] + nx * w * 0.92, by = b[1] + ny * w * 0.92;
        const px = bx + (nx * 0.85 + tx * 0.5) * sz * 1.25, py = by + (ny * 0.85 + ty * 0.5) * sz * 1.25;
        pr.push(`M ${f1(bx - tx * sz * 0.55)} ${f1(by - ty * sz * 0.55)} Q ${f1(bx + nx * sz * 0.35 - tx * sz * 0.2)} ${f1(by + ny * sz * 0.35 - ty * sz * 0.2)} ${f1(px)} ${f1(py)} Q ${f1(bx + nx * sz * 0.25 + tx * sz * 0.3)} ${f1(by + ny * sz * 0.25 + ty * sz * 0.3)} ${f1(bx + tx * sz * 0.45)} ${f1(by + ty * sz * 0.45)} Z`);
      }
    });
  }
  // 겨울눈 — 겨울만(봄엔 새잎이 대신). 감 겨울눈 = 작은 세모(비늘 두 장), 가지에 바짝 붙어 비스듬히. 밑에 반달 잎자국.
  let buds = '';
  let scars = '';
  if (season === 'winter') {
    const sel = g.buds.filter((b) => b.tip || random(`${seed}bd${Math.round(b.x)}${Math.round(b.y)}`) < (age === 'sapling' ? 0.95 : 0.5));
    // (B6) 큰 잎 수종은 겨울눈·잎자국도 크다(끝눈은 굵은 원뿔)
    const big = age === 'sapling' ? 9 * (1 + 0.35 * (sp.bigLeaf ?? 0)) : (age === 'young' ? 4.5 : 5) * (1 + 1.1 * (sp.bigLeaf ?? 0));
    buds = sel.map((b) => {
      const s = Math.min(big, b.size * (b.tip ? 1.25 : 1));
      const a = b.angle;
      const dx = Math.sin(a), dy = -Math.cos(a), nx = -dy, ny = dx;
      return `M ${f1(b.x - nx * s * 0.42)} ${f1(b.y - ny * s * 0.42)} Q ${f1(b.x + dx * s * 0.8 - nx * s * 0.34)} ${f1(b.y + dy * s * 0.8 - ny * s * 0.34)} ${f1(b.x + dx * s * 1.45)} ${f1(b.y + dy * s * 1.45)} Q ${f1(b.x + dx * s * 0.8 + nx * s * 0.34)} ${f1(b.y + dy * s * 0.8 + ny * s * 0.34)} ${f1(b.x + nx * s * 0.42)} ${f1(b.y + ny * s * 0.42)} Z`
        + ` M ${f1(b.x + dx * s * 0.3)} ${f1(b.y + dy * s * 0.3)} L ${f1(b.x + dx * s * 1.1)} ${f1(b.y + dy * s * 1.1)}`;
    }).join(' ');
    if (age !== 'mature') {
      scars = sel.filter((b) => !b.tip).map((b) => {
        const s = Math.min(big, b.size);
        const a = b.angle, dx = Math.sin(a), dy = -Math.cos(a), nx = -dy, ny = dx;
        const c: P = [b.x - dx * s * 0.35, b.y - dy * s * 0.35];
        return `M ${f1(c[0] - nx * s * 0.45)} ${f1(c[1] - ny * s * 0.45)} Q ${f1(c[0] - dx * s * 0.35)} ${f1(c[1] - dy * s * 0.35)} ${f1(c[0] + nx * s * 0.45)} ${f1(c[1] + ny * s * 0.45)}`;
      }).join(' ');
    }
  }
  // 잎 — 계절에 맞게. 봄 = 끝 쪽 새잎(작고 접힌 듯 — 모양은 보이게), 여름 = 다, 가을 = 일부.
  const leaves = g.leaves.filter((l) => (season === 'summer' ? true : season === 'autumn' ? l.keepAutumn : season === 'spring' ? l.spring : false));
  // 성목 잎철 — 속은 빗금 톤, 가장자리·앞 몇 장만 낱장
  // (B6) 큰 잎 수종(잎이 가지 끝에 모여 남)은 잎이 적고 커서 낱장으로 다 그린다(속 빗금 톤 없음 — 굵은 가지가 비쳐 보이는 성긴 수관)
  const massy = age === 'mature' && sp.form !== 'shrub' && (season === 'summer' || season === 'autumn') && (sp.bigLeaf ?? 0) <= 0.5;
  // (B6) 큰 잎 수종 — 수관이 성겨 굵은 가지가 비쳐 보이게 속 빗금을 줄인다
  const tone = massy ? crownTone(leaves, `${seed}ct`, (season === 'autumn' ? 0.55 : 1) * (1 - 0.45 * (sp.bigLeaf ?? 0))) : null;
  const conv = (l: Tree2G['leaves'][number]): LeafR => {
    const len = season === 'spring' ? l.len * 0.6 : l.len;
    const ang = l.angle - Math.PI / 2; // θ(위=0) → 화면 각(오른쪽=0)
    // 봄 새잎은 반쯤 접힌 채(고르게 좁게), 그 밖엔 비스듬한 잎을 '돌아간 잎'(뒷면이 보임)으로
    const spring = season === 'spring';
    const d = leafD(pf, l.x, l.y, ang, len, (l.fs ?? 1) * (spring ? 0.7 : 1), spring ? undefined : random(`${seed}tn${Math.round(l.x)}:${Math.round(l.y)}`));
    return { outline: d.outline, hatch: d.hatch, midrib: d.midrib, dark: d.dark, light: d.light, ...(d.tf ? { tf: d.tf } : {}), veins: d.veins, under: d.under, underVeins: d.underVeins, order: l.order, x: l.x, y: l.y, len, shade: l.shade, back: l.z < -0.1 };
  };
  const all = leaves.filter((_, i) => !tone || tone.keep[i]).map(conv);
  return {
    thick, thin: [...thinB.values()].map((b) => ({ d: b.d.join(' '), order: b.order, w: b.w })),
    shade: { h: sh.h.join(' '), b2: sh.b2.join(' '), b6: sh.b6.join(' ') }, accent6: acc6.join(' '), bark, plates, lenticels, grain, buds, scars, prickles: pr.join(' '),
    back: all.filter((l) => l.back), front: all.filter((l) => !l.back), toneL: tone?.light ?? '', toneD: tone?.dark ?? '', toneX: tone?.core ?? '', veil: tone?.veil ?? '',
  };
}

/**
 * 잎 층 — 낱장마다(앞뒤 순서대로) 종이 칠 + 윤곽 + 가운데 맥 + 그늘 반쪽 빗금(곁맥 결) + 밝은 반쪽 가장자리 빗금(맥 쪽은 비움 = 윤기).
 * 뒤쪽 잎·봄 새잎은 H 톤. 작은 잎(< 14px)은 외곽선 + 성긴 빗금만.
 */
const LeafLayer: React.FC<{ leaves: LeafR[]; pFor: (o: number) => number; hi: number; back?: boolean; young?: boolean }> = ({ leaves, pFor, hi, back = false, young = false }) => {
  if (!leaves.length) return null;
  const soft = back || young;
  return (
    <g>
      {leaves.map((l, i) => {
        const p = pFor(l.order);
        if (p <= 0) return null;
        const s = 0.4 + 0.6 * p;
        const grow = p < 1 ? `translate(${l.x} ${l.y}) scale(${s}) translate(${-l.x} ${-l.y})` : '';
        const tf = `${grow} ${l.tf ?? ''}`.trim();
        const big = l.len >= 30, mid = l.len >= 24, ribOn = l.len >= 14; // 작은 잎(< 24px)은 성긴 빗금만 — 성목 수관이 비늘처럼 새카매지지 않게
        const ht = phase(p, 'hatch');
        return (
          <g key={i} opacity={Math.min(1, p * 2)} {...(tf ? { transform: tf } : {})}>
            <path d={l.outline} fill={hi > 0 ? PB.accentWash : PB.paper} stroke={soft ? TONE.H.color : PB.lead} strokeWidth={back ? 1.0 : young ? 1.1 : big ? 1.5 : ribOn ? 1.25 : 0.95} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {/* 곁맥(큰 잎) — 가운데 맥에서 앞으로 휘는 5~7쌍, 가는 H */}
            {big && l.veins && ht > 0 ? <path d={l.veins} fill="none" stroke={TONE.H.color} strokeWidth={0.75} strokeLinecap="round" opacity={ht * (soft ? 0.6 : 0.85)} /> : null}
            {ht > 0 && !young && !l.under ? (mid
              ? <path d={l.dark} fill="none" stroke={soft || l.shade < 0.4 ? TONE.H.color : PB.lead2} strokeWidth={big ? 1 : 0.85} strokeLinecap="round" opacity={ht * (soft ? 0.8 : 0.9)} />
              : l.shade > 0.45 ? <path d={l.hatch} fill="none" stroke={soft ? TONE.H.color : PB.lead2} strokeWidth={0.8} opacity={ht * 0.75} /> : null) : null}
            {ht > 0 && big && !soft && l.shade > 0.3 && l.light ? <path d={l.light} fill="none" stroke={TONE.H.color} strokeWidth={0.85} strokeLinecap="round" opacity={ht * 0.9} /> : null}
            {/* 돌아간 잎 — 먼 반쪽은 뒷면: 옅은 결 빗금 + 도드라진 곁맥(종이색 띠 위 2B 가는 선), 접힌 가운데 맥은 진한 모서리 */}
            {l.under ? (
              <g>
                <path d={l.under} fill={hi > 0 ? PB.accentWash : PB.paper} stroke={soft ? TONE.H.color : PB.lead} strokeWidth={back ? 0.9 : 1.1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                {ht > 0 ? <path d={l.hatch} fill="none" stroke={TONE.H.color} strokeWidth={0.8} strokeLinecap="round" opacity={ht * (soft ? 0.6 : 0.85)} /> : null}
                {ht > 0 && l.underVeins ? <path d={l.underVeins} fill="none" stroke={soft ? TONE.H.color : PB.lead2} strokeWidth={0.8} strokeLinecap="round" opacity={ht * 0.8} /> : null}
              </g>
            ) : null}
            {ribOn && l.midrib ? <path d={l.midrib} fill="none" stroke={soft ? TONE.H.color : l.under ? PB.lead : PB.lead2} strokeWidth={big ? (l.under ? 1.4 : 1.1) : 0.8} strokeLinecap="round" /> : null}
          </g>
        );
      })}
    </g>
  );
};

/** 나무 치수(배치·라벨 자리용) — Tree 와 같은 (seed, h, age, species). trunkTop·trunkW(뿌리목 위 굵기)·crown 상자·graftY. */
export function treeBox(seed: string, h: number, age: TreeAge = 'mature', species?: string | SpeciesProfile) {
  const g = treeGeom2(seed, h, age, speciesFromProfile(speciesOf(species)));
  return { trunkTop: g.trunk.top, trunkW: g.trunk.w0, crown: g.crown, graftY: g.graft?.y };
}
