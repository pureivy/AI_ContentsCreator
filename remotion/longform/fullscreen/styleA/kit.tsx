// 전체 화면 장면 스타일 A 키트(2026-10-23, stylespike/styleA 에서 옮김 + 공용 부품·무대).
// 스타일 A "세밀화 + 원예 도해" — 펜 선(먹색) + 차분한 물감 칠 + 빗금 그늘 + 크림 종이. 도해 기호(번호 배지·화살표·치수선)는 주홍.
// 모든 부품: at(나타나는 프레임) · o(불투명도). 선이 먼저 그어지고(펜) 칠이 뒤따라 번진다(물감).
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { BaseStage, FONT_BATANG, clamp, type Theme } from '../stage';
import { makeParts, type Brush, type Tone } from '../parts';
import { fibers, hatchLines, leafPath, potGeom, rootBallGeom, sectionGeom, shrubGeom, stipple, taper, type P } from '../geom';

export const PA = {
  paper: '#f3ebd9', ink: '#2f2a23', inkSoft: '#6b6153', accent: '#b4482c',
  leaf: '#80915e', leaf2: '#93a06b', leafDeep: '#4f6139', stem: '#7d6549', berry: '#4f5e8e', bloom: '#b4bdd4',
  soil: '#8c6c4e', soilDark: '#5d4532', peat: '#5c4131', plastic: '#646767', plasticLight: '#8b8d8a', clay: '#c07e5a', kraft: '#cdaa78', root: '#f1e6cc',
} as const;

const PAPER = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs>
<filter id="m" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.0032" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 0.52  0 0 0 0 0.42  0 0 0 0 0.28  0.16 0 0 0 -0.05"/></filter>
<filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.18  0.22 0 0 0 -0.06"/></filter>
<filter id="f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.32" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.26  0.1 0 0 0 -0.03"/></filter>
<radialGradient id="v" cx="50%" cy="45%" r="75%"><stop offset="0.6" stop-color="#8a6a40" stop-opacity="0"/><stop offset="1" stop-color="#7a5a32" stop-opacity="0.2"/></radialGradient>
</defs>
<rect width="1920" height="1080" fill="${PA.paper}"/>
<rect width="1920" height="1080" filter="url(#m)"/>
<rect width="1920" height="1080" filter="url(#f)"/>
<rect width="1920" height="1080" filter="url(#g)"/>
<rect width="1920" height="1080" fill="url(#v)"/>
</svg>`;

export const THEME_A: Theme = {
  paperSvg: PAPER, paper: PA.paper, ink: PA.ink, muted: 'rgba(47,42,35,.35)', accent: PA.accent, labelFont: FONT_BATANG,
  captionBand: 'rgba(233,222,199,.94)', captionInk: PA.ink,
};

/** 정의 — 빗금 무늬(먹), 그늘 쪽 가림판(오른쪽·아래), 열매 둥근 칠. 장면은 <ADefs/> 를 무대 defs 에 넣는다. */
export const ADefs: React.FC = () => (
  <>
    {([['a-h45', 45, 6, 1.05], ['a-h45f', 45, 4.2, 0.75], ['a-h135', -45, 6, 1.0], ['a-h0', 0, 7, 0.9], ['a-hcut', 45, 9, 1.4]] as const).map(([id, ang, sp, sw]) => (
      <pattern key={id} id={id} width={sp} height={sp} patternUnits="userSpaceOnUse" patternTransform={`rotate(${ang})`}>
        <line x1={0} y1={0} x2={0} y2={sp} stroke={PA.ink} strokeWidth={sw} />
      </pattern>
    ))}
    <pattern id="a-dots" width={9} height={9} patternUnits="userSpaceOnUse">
      <circle cx={2} cy={3} r={0.9} fill={PA.ink} /><circle cx={6.5} cy={7.5} r={0.7} fill={PA.ink} />
    </pattern>
    {([['a-m-r', 0.4, 1, 0, 0], ['a-m-b', 0, 0, 0.45, 1], ['a-m-br', 0.35, 1, 0.35, 1]] as const).map(([id, x1, x2, y1, y2]) => (
      <mask key={id} id={id} maskContentUnits="objectBoundingBox">
        <linearGradient id={`${id}-g`} x1={id === 'a-m-b' ? 0 : x1} x2={id === 'a-m-b' ? 0 : x2} y1={y1} y2={id === 'a-m-r' ? 0 : y2}>
          <stop offset={0} stopColor="#fff" stopOpacity={0} /><stop offset={1} stopColor="#fff" stopOpacity={1} />
        </linearGradient>
        <rect x={0} y={0} width={1} height={1} fill={`url(#${id}-g)`} />
      </mask>
    ))}
    <filter id="a-tremble" filterUnits="userSpaceOnUse" x={0} y={0} width={1920} height={1080}>
      <feTurbulence type="fractalNoise" baseFrequency={0.022} numOctaves={1} seed={3} />
      <feDisplacementMap in="SourceGraphic" scale={2.6} xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <radialGradient id="a-berry" cx="0.36" cy="0.32" r="0.75">
      <stop offset={0} stopColor="#8d99bd" /><stop offset={0.55} stopColor={PA.berry} /><stop offset={1} stopColor="#2f3a5e" />
    </radialGradient>
  </>
);

// ── 진행 도우미
export function useP(at: number, dur = 16, ease: 'out' | 'inOut' = 'out'): number {
  const f = useCurrentFrame();
  return interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: ease === 'out' ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic) });
}
const DONE = -999;

/** 펜 선 — p(0~1)만큼 그어진다. */
export const Ink: React.FC<{ d: string; w?: number; p?: number; color?: string; o?: number; dash?: string; cap?: 'round' | 'butt' }> = ({ d, w = 2, p = 1, color = PA.ink, o = 1, dash, cap = 'round' }) =>
  p <= 0 ? null : (
    <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap={cap} strokeLinejoin="round" opacity={o}
      {...(dash ? { strokeDasharray: dash } : p < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - p } : {})} />
  );

/** 물감 칠 — 면을 채우고 가장자리에 안료가 고인 듯 살짝 진한 테. */
export const Wash: React.FC<{ d: string; color: string; o?: number; edge?: boolean }> = ({ d, color, o = 1, edge = true }) =>
  o <= 0 ? null : (
    <g opacity={o}>
      <path d={d} fill={color} opacity={0.9} />
      {edge ? <path d={d} fill="none" stroke={color} strokeWidth={3} opacity={0.55} style={{ mixBlendMode: 'multiply' }} /> : null}
    </g>
  );

/** 빗금 그늘 — 모양 d 를 무늬로 채우되 가림판(mask)으로 그늘 쪽만. */
export const Hatch: React.FC<{ d: string; pattern?: string; side?: 'r' | 'b' | 'br' | 'all'; o?: number }> = ({ d, pattern = 'a-h45', side = 'r', o = 0.55 }) =>
  o <= 0 ? null : <path d={d} fill={`url(#${pattern})`} opacity={o} {...(side === 'all' ? {} : { mask: `url(#a-m-${side})` })} />;

// ── 식물 ───────────────────────────────────────────────

/** 잎 하나(세밀화) — 칠 + 아랫면 빗금 + 테두리 + 주맥 + 곁맥. */
export const ALeaf: React.FC<{ x: number; y: number; angle: number; len: number; wid?: number; flip?: number; tone?: number; p?: number; w?: number }> = ({ x, y, angle, len, wid = 0.44, flip = 1, tone = 0.5, p = 1, w = 1.1 }) => {
  if (p <= 0) return null;
  const L = leafPath(len, wid);
  // 색 — 세 가지 녹색 + 가끔 뒷면(푸른 회녹). 칠은 펜 선이 그어진 뒤 번진다.
  const under = tone > 0.86;
  const col = under ? '#a3ae93' : tone > 0.55 ? PA.leaf : tone > 0.25 ? PA.leaf2 : '#6f8650';
  const shade = flip > 0 ? L.lower : L.upper;
  const lit = flip > 0 ? L.upper : L.lower;
  const wash = interpolate(p, [0.45, 1], [0, 1], clamp);
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${0.35 + 0.65 * p})`}>
      <path d={L.outline} fill={col} opacity={wash * 0.92} />
      <path d={lit} fill="#f4efd8" opacity={wash * 0.16} />
      <path d={shade} fill={PA.leafDeep} opacity={wash * (under ? 0.2 : 0.42)} />
      <path d={shade} fill="url(#a-h45f)" opacity={wash * 0.7} />
      <Ink d={L.outline} w={w} p={Math.min(1, p * 1.6)} />
      {/* 그늘 쪽 윤곽만 한 번 더 — 펜 굵기 변화 */}
      <Ink d={shade} w={w * 1.5} p={Math.min(1, p * 1.6)} o={0.8} />
      <Ink d={L.midrib} w={w * 0.9} p={interpolate(p, [0.3, 0.8], [0, 1], clamp)} color={under ? '#e8e2cc' : PA.ink} />
      {wash > 0 ? L.veins.map((v, i) => <path key={i} d={v} fill="none" stroke={under ? '#eee8d2' : PA.ink} strokeWidth={0.75} opacity={0.8 * wash} strokeLinecap="round" />) : null}
    </g>
  );
};

/** 블루베리 열매 — 둥근 칠 + 흰 가루 + 오른쪽 아래 점묘 그늘 + 꽃받침 왕관. */
export const ABerry: React.FC<{ x: number; y: number; r: number; p?: number }> = ({ x, y, r, p = 1 }) => {
  if (p <= 0) return null;
  const crown = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2;
    return `M ${x + r * 0.3} ${y - r * 0.45} l ${Math.cos(a) * r * 0.26} ${Math.sin(a) * r * 0.26}`;
  }).join(' ');
  const cd = `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  return (
    <g transform={`translate(${x} ${y}) scale(${p}) translate(${-x} ${-y})`}>
      <circle cx={x} cy={y} r={r} fill="url(#a-berry)" />
      <circle cx={x - r * 0.15} cy={y - r * 0.15} r={r * 0.85} fill={PA.bloom} opacity={0.3} />
      <path d={cd} fill="url(#a-dots)" mask="url(#a-m-br)" opacity={0.9} />
      <circle cx={x} cy={y} r={r} fill="none" stroke={PA.ink} strokeWidth={1.3} />
      <circle cx={x + r * 0.3} cy={y - r * 0.45} r={r * 0.2} fill={PA.ink} opacity={0.75} />
      <path d={crown} stroke={PA.ink} strokeWidth={1} fill="none" />
    </g>
  );
};

/** 블루베리 관목(세밀화) — 밑동 (x,y). at 부터 grow 프레임 동안 밑에서 끝으로 자란다. */
export const AShrub: React.FC<{ x: number; y: number; h: number; seed: string; at?: number; grow?: number; berries?: boolean; o?: number; stems?: number }> = ({ x, y, h, seed, at = DONE, grow = 30, berries = true, o = 1, stems = 4 }) => {
  const f = useCurrentFrame();
  const g = shrubGeom(seed, h, stems, berries);
  const t = interpolate(f, [at, at + grow], [0, 1.25], clamp);
  if (t <= 0 || o <= 0) return null;
  const pFor = (order: number) => interpolate(t, [order * 0.9, order * 0.9 + 0.3], [0, 1], clamp);
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      {g.stems.map((s, i) => {
        const p = pFor(s.order * 0.6);
        const d = taper(s.pts, s.w0, s.w1);
        const young = s.order > 0;
        const n = s.pts.length;
        return (
          <g key={i} opacity={p > 0 ? 1 : 0}>
            <path d={d} fill={young ? '#9b5b45' : PA.stem} opacity={interpolate(p, [0.5, 1], [0, 0.92], clamp)} />
            {young ? null : <path d={taper(s.pts.slice(Math.floor(n * 0.6)), s.w0 * 0.5, s.w1)} fill="#9b5b45" opacity={interpolate(p, [0.5, 1], [0, 0.7], clamp)} />}
            <Hatch d={d} pattern="a-h45f" side="r" o={0.7 * p} />
            <Ink d={d} w={1.1} p={p} />
            {/* 껍질 — 짧은 가로 눈금(피목) */}
            {p > 0.8 && !young ? s.pts.slice(1, Math.floor(n * 0.6)).map((q, k) => <path key={k} d={`M ${q[0] - s.w0 * 0.25} ${q[1] + 3} l ${s.w0 * 0.4} -1.5`} stroke={PA.ink} strokeWidth={0.9} opacity={0.6} />) : null}
          </g>
        );
      })}
      {g.leaves.map((l, i) => <ALeaf key={i} {...l} p={pFor(l.order)} />)}
      {g.berries.map((b, i) => <ABerry key={i} x={b.x} y={b.y} r={b.r} p={pFor(b.order)} />)}
    </g>
  );
};

// ── 화분 ───────────────────────────────────────────────

/** 땅 선 — 펜으로 그은 가는 선 + 아래 짧은 빗금 몇 줄(도판의 바닥 표시). */
export const AGround: React.FC<{ x0: number; x1: number; y: number; p?: number }> = ({ x0, x1, y, p = 1 }) => (
  <g>
    <Ink d={`M ${x0} ${y} C ${x0 + (x1 - x0) * 0.3} ${y - 2} ${x0 + (x1 - x0) * 0.7} ${y + 2} ${x1} ${y}`} w={1.6} p={p} />
    {p > 0.5 ? Array.from({ length: Math.floor((x1 - x0) / 22) }, (_, i) => {
      const xx = x0 + 12 + i * 22;
      return <path key={i} d={`M ${xx} ${y + 6} l -9 9`} stroke={PA.ink} strokeWidth={1} opacity={0.45 * (p - 0.5) * 2} />;
    }) : null}
  </g>
);

/** 화분 앞모습 — 원점 바닥 가운데. material plastic(먹빛 회색)·terracotta. 입구 흙 점묘, 오른쪽 빗금 그늘, 바닥 빗금 그림자. */
export const APot: React.FC<{ x: number; y: number; w: number; h: number; material?: 'plastic' | 'terracotta'; at?: number; o?: number; soilHi?: number; empty?: boolean }> = ({ x, y, w, h, material = 'plastic', at = DONE, o = 1, soilHi = 0, empty = false }) => {
  const p = useP(at, 18);
  if (p <= 0 || o <= 0) return null;
  const G = potGeom(w, h);
  const col = material === 'plastic' ? PA.plastic : PA.clay;
  const wash = interpolate(p, [0.4, 1], [0, 1], clamp);
  const top = G.top;
  const soilY = top + G.ry * 0.6;
  const rings = material === 'plastic' ? [0.32, 0.62] : [];
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      {/* 그림자 — 펜 빗금 타원 */}
      <ellipse cx={w * 0.12} cy={2} rx={G.wb * 0.62} ry={10} fill="url(#a-h135)" opacity={0.4 * wash} />
      <Wash d={G.body} color={col} o={wash} />
      <Hatch d={G.body} pattern={material === 'plastic' ? 'a-h45' : 'a-h45f'} side="r" o={0.7 * wash} />
      {material === 'plastic' ? <Hatch d={G.body} pattern="a-h135" side="r" o={0.35 * wash} /> : null}
      <path d={`M ${-w * 0.3} ${-h + G.rimH + 8} L ${-G.wb * 0.3} -8`} stroke="#fff" strokeWidth={6} opacity={0.18 * wash} />
      {rings.map((k) => <Ink key={k} d={`M ${-(G.wb / 2 + (w - G.wb) / 2 * k)} ${-h * k} Q 0 ${-h * k + G.ry * 0.7} ${G.wb / 2 + (w - G.wb) / 2 * k} ${-h * k}`} w={1} p={p} o={0.7} />)}
      <Ink d={G.body} w={1.8} p={p} />
      {/* 테두리 띠 + 입구 */}
      <Wash d={G.rim} color={material === 'plastic' ? PA.plasticLight : PA.clay} o={wash} />
      <Hatch d={G.rim} pattern="a-h45f" side="r" o={0.6 * wash} />
      <Ink d={G.rim} w={1.8} p={p} />
      <ellipse cx={0} cy={top} rx={G.wr / 2 - 2} ry={G.ry} fill={PA.soilDark} opacity={wash} stroke={PA.ink} strokeWidth={1.6} />
      {empty ? <path d={`M ${-G.wr / 2 + 6} ${top} A ${G.wr / 2 - 6} ${G.ry - 4} 0 0 0 ${G.wr / 2 - 6} ${top}`} fill="url(#a-h45)" opacity={0.5 * wash} /> : null}
      {empty ? null : <ellipse cx={0} cy={soilY} rx={G.wr / 2 - 12} ry={G.ry * 0.62} fill={PA.soil} opacity={wash} />}
      {empty ? null : <ellipse cx={0} cy={soilY} rx={G.wr / 2 - 12} ry={G.ry * 0.62} fill="url(#a-dots)" opacity={wash} />}
      {soilHi > 0 ? <ellipse cx={0} cy={soilY} rx={G.wr / 2 - 4} ry={G.ry * 0.62 + 6} fill="none" stroke={PA.accent} strokeWidth={3.5} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - soilHi} /> : null}
    </g>
  );
};

/** 화분 밑면(뒤집어 본 바닥) — 중심 (x,y). 바깥 테두리·바닥판·물 빠짐 구멍. holeHi(0~1) 로 구멍에 주홍 테가 그어진다. */
export const APotBottom: React.FC<{ x: number; y: number; r: number; holes?: number; holeHi?: number; p?: number; o?: number }> = ({ x, y, r, holes = 5, holeHi = 0, p = 1, o = 1 }) => {
  if (p <= 0 || o <= 0) return null;
  const rb = r * 0.74;
  const hr = r * 0.075;
  const pts: P[] = [[0, 0], ...Array.from({ length: holes - 1 }, (_, i) => { const a = (i / (holes - 1)) * Math.PI * 2 + Math.PI / 4; return [Math.cos(a) * rb * 0.6, Math.sin(a) * rb * 0.6] as P; })];
  const wash = interpolate(p, [0.4, 1], [0, 1], clamp);
  const circ = (rr: number) => `M ${-rr} 0 a ${rr} ${rr} 0 1 0 ${2 * rr} 0 a ${rr} ${rr} 0 1 0 ${-2 * rr} 0 Z`;
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      <Wash d={circ(r)} color={PA.plastic} o={wash} />
      <Hatch d={circ(r)} pattern="a-h45" side="br" o={0.75 * wash} />
      <Ink d={circ(r)} w={1.8} p={p} />
      <Wash d={circ(rb)} color={PA.plasticLight} o={wash} />
      <Hatch d={circ(rb)} pattern="a-h45f" side="br" o={0.5 * wash} />
      <Ink d={circ(rb)} w={1.5} p={p} />
      {[0.86, 0.93].map((k) => <Ink key={k} d={circ(r * k)} w={0.9} p={p} o={0.6} />)}
      {pts.map(([hx, hy], i) => (
        <g key={i} opacity={wash}>
          <circle cx={hx} cy={hy} r={hr} fill="#1e1b17" />
          <path d={`M ${hx - hr} ${hy} a ${hr} ${hr} 0 0 1 ${2 * hr} 0`} fill="none" stroke={PA.plasticLight} strokeWidth={1.2} />
          {holeHi > 0 ? <circle cx={hx} cy={hy} r={hr + 9} fill="none" stroke={PA.accent} strokeWidth={3.2} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - interpolate(holeHi, [i * 0.12, i * 0.12 + 0.5], [0, 1], clamp)} /> : null}
        </g>
      ))}
    </g>
  );
};

export type SoilKind = 'peat' | 'soil' | 'mix';
const SOIL_COL: Record<SoilKind, string> = { peat: PA.peat, soil: PA.soil, mix: '#6a4d37' };

/**
 * 단면 화분 — (x,y) 바닥 가운데. 잘린 벽은 도면 관례대로 굵은 빗금. layers 는 바닥부터(ratio = 안쪽 높이 비율).
 * fill(0~1) = 전체 층 중 채워진 몫. mix(0~1) = 층 경계가 사라지고 한 결로.
 */
export const APotSection: React.FC<{
  x: number; y: number; w: number; h: number; layers: { kind: SoilKind; ratio: number }[]; fill?: number; mix?: number; at?: number; o?: number; seed?: string; children?: React.ReactNode;
}> = ({ x, y, w, h, layers, fill = 1, mix = 0, at = DONE, o = 1, seed = 'sec', children }) => {
  const p = useP(at, 18);
  if (p <= 0 || o <= 0) return null;
  const G = sectionGeom(x, y, w, h);
  const total = layers.reduce((s, l) => s + l.ratio, 0);
  const filled = total * fill;
  let acc = 0;
  const wash = interpolate(p, [0.4, 1], [0, 1], clamp);
  const box = { x0: x - w / 2, y0: y - h, x1: x + w / 2, y1: y };
  const cid = `a-secclip-${seed}`;
  return (
    <g opacity={o}>
      <defs><clipPath id={cid}><path d={G.fillPath(Math.max(0.0001, filled))} /></clipPath></defs>
      {/* 안쪽 빈 공간 — 아주 옅은 그늘 */}
      <path d={G.fillPath(1)} fill={PA.inkSoft} opacity={0.06 * wash} />
      <g clipPath={`url(#${cid})`} opacity={wash}>
        {layers.map((l, i) => {
          const r0 = acc, r1 = acc + l.ratio;
          acc = r1;
          const kind: SoilKind = mix > 0.5 ? 'mix' : l.kind;
          const yTop = G.levelY(r1), yBot = G.levelY(r0);
          const lb = { x0: box.x0, y0: yTop - 4, x1: box.x1, y1: yBot + 4 };
          return (
            <g key={i}>
              <path d={G.band(r0, r1 + 0.002)} fill={SOIL_COL[kind]} opacity={0.88} />
              {kind !== 'soil' ? fibers(lb, Math.round((lb.y1 - lb.y0) * w * 0.004), `${seed}f${i}`, 16).map(([fx, fy, fa, fl], k) => (
                <path key={k} d={`M ${fx} ${fy} l ${Math.cos(fa) * fl} ${Math.sin(fa) * fl * 0.5}`} stroke={kind === 'peat' ? '#2c1d13' : '#3a2a1c'} strokeWidth={1.1} opacity={0.7} />
              )) : null}
              {kind !== 'peat' ? stipple(lb, Math.round((lb.y1 - lb.y0) * w * 0.006), `${seed}s${i}`, 0.8, 2.2).map(([sx, sy, sr], k) => (
                <circle key={k} cx={sx} cy={sy} r={sr} fill={k % 5 === 0 ? '#efe3c8' : '#2f2219'} opacity={0.75} />
              )) : null}
              {mix < 0.5 && i < layers.length - 1 ? <Ink d={`M ${G.innerX(yTop, -1)} ${yTop} L ${G.innerX(yTop, 1)} ${yTop}`} w={1} o={0.5 * (1 - mix * 2)} /> : null}
            </g>
          );
        })}
        <path d={G.fillPath(1)} fill="url(#a-h45f)" mask="url(#a-m-r)" opacity={0.35} />
      </g>
      {filled > 0.01 ? <Ink d={`M ${G.innerX(G.levelY(filled), -1)} ${G.levelY(filled)} Q ${x} ${G.levelY(filled) - 5} ${G.innerX(G.levelY(filled), 1)} ${G.levelY(filled)}`} w={1.4} o={wash} /> : null}
      {children}
      {/* 잘린 벽 — 회색 칠 + 굵은 단면 빗금 + 테두리 */}
      {[G.wallL, G.wallR, G.floor].map((d, i) => (
        <g key={i}>
          <Wash d={d} color={PA.plasticLight} o={wash} edge={false} />
          <path d={d} fill="url(#a-hcut)" opacity={0.85 * wash} />
          <Ink d={d} w={1.8} p={p} />
        </g>
      ))}
    </g>
  );
};

/** 뿌리 덩이 — 원점 윗면 가운데. 흙 칠·점묘 + 감긴 흰 뿌리(먹 테두리 두 겹) + loosen 만큼 바깥으로 풀린 뿌리. hi(0~1) = 풀린 뿌리에 주홍. */
export const ARootBall: React.FC<{ x: number; y: number; w: number; h: number; loosen?: number; seed?: string; p?: number; o?: number; hi?: number; reach?: number }> = ({ x, y, w, h, loosen = 0, seed = 'rb', p = 1, o = 1, hi = 0, reach = 1 }) => {
  if (p <= 0 || o <= 0) return null;
  const G = rootBallGeom(seed, w, h);
  const wash = interpolate(p, [0.4, 1], [0, 1], clamp);
  const cid = `a-rb-${seed}`;
  const rootCol = hi > 0 ? interpolateColor(PA.root, '#f0b49a', hi) : PA.root;
  const Root: React.FC<{ d: string; pp: number; k: number }> = ({ d, pp, k }) => pp <= 0 ? null : (
    <g>
      <path d={d} fill="none" stroke={PA.ink} strokeWidth={4.4 - (k % 3) * 0.6} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - pp} />
      <path d={d} fill="none" stroke={rootCol} strokeWidth={2.2 - (k % 3) * 0.4} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - pp} />
    </g>
  );
  const box = { x0: -w / 2, y0: 0, x1: w / 2, y1: h + 12 };
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      <defs><clipPath id={cid}><path d={G.body} /></clipPath></defs>
      {G.loose.map((l, i) => (
        <g key={`l${i}`} transform={`translate(${l.x0} ${l.y0}) scale(${reach}) translate(${-l.x0} ${-l.y0})`}>
          <Root d={l.d} pp={interpolate(loosen, [i * 0.02, i * 0.02 + 0.55], [0, 1], clamp)} k={i} />
        </g>
      ))}
      <Wash d={G.body} color={PA.soil} o={wash} />
      <g clipPath={`url(#${cid})`} opacity={wash}>
        {stipple(box, Math.round(w * h * 0.004), `${seed}st`, 0.8, 2.2).map(([sx, sy, sr], k) => <circle key={k} cx={sx} cy={sy} r={sr} fill={k % 6 === 0 ? '#efe3c8' : '#2f2219'} opacity={0.7} />)}
        {G.circling.map((d, i) => <g key={i} opacity={1 - loosen * 0.5}><Root d={d} pp={1} k={i + 1} /></g>)}
        <path d={G.body} fill="url(#a-h45)" mask="url(#a-m-r)" opacity={0.55} />
      </g>
      <Ink d={G.body} w={1.8} p={p} />
    </g>
  );
};

function interpolateColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** 크라프트 포대 — 원점 가운데. tilt(도)로 기울여 붓는다. 입구 = (0, -h/2) 회전. */
export const ASack: React.FC<{ x: number; y: number; w?: number; h?: number; tilt?: number; o?: number; p?: number }> = ({ x, y, w = 150, h = 200, tilt = 0, o = 1, p = 1 }) => {
  if (o <= 0 || p <= 0) return null;
  const body = `M ${-w / 2} ${-h / 2 + 16} L ${-w / 2 + 4} ${h / 2} Q 0 ${h / 2 + 8} ${w / 2 - 4} ${h / 2} L ${w / 2} ${-h / 2 + 16} Z`;
  const flap = `M ${-w / 2} ${-h / 2 + 16} L ${-w / 2 + 10} ${-h / 2} L ${w / 2 - 10} ${-h / 2} L ${w / 2} ${-h / 2 + 16} Z`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`} opacity={o}>
      <Wash d={body} color={PA.kraft} />
      <Hatch d={body} pattern="a-h45" side="r" o={0.55} />
      <Ink d={body} w={1.8} p={p} />
      <Wash d={flap} color="#bf9a66" />
      <Ink d={flap} w={1.6} p={p} />
      {/* 앞면 도장 — 잎 두 장 원형 문양 */}
      <circle cx={0} cy={6} r={w * 0.22} fill="none" stroke={PA.ink} strokeWidth={1.2} opacity={0.8} />
      <ALeaf x={-4} y={22} angle={-60} len={w * 0.3} p={1} w={1} />
      <ALeaf x={-4} y={22} angle={-115} len={w * 0.24} p={1} w={1} tone={0.9} />
      {[-1, 1].map((s) => <Ink key={s} d={`M ${s * w * 0.32} ${-h / 2 + 30} l 0 ${h * 0.7}`} w={0.8} o={0.4} />)}
    </g>
  );
};

/** 쏟아지는 섬유·알갱이 — from 에서 toY 로, at~until 사이. 결정적. */
export const AFall: React.FC<{ from: [number, number]; toY: number; at: number; until: number; color?: string; n?: number; spread?: number }> = ({ from, toY, at, until, color = PA.peat, n = 34, spread = 22 }) => {
  const f = useCurrentFrame();
  if (f < at || f > until + 20) return null;
  const fall = toY - from[1];
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const born = at + (i / n) * (until - at);
        const age = f - born;
        if (age < 0 || age > 18) return null;
        const k = age / 18;
        const jx = (((i * 37) % 17) / 17 - 0.5) * spread * (0.4 + k);
        const yy = from[1] + fall * k * k;
        const ang = (i * 53) % 180;
        return <path key={i} d={`M ${from[0] + jx} ${yy} l ${Math.cos(ang) * 7} ${Math.sin(ang) * 4}`} stroke={i % 3 ? color : PA.ink} strokeWidth={2.2} strokeLinecap="round" opacity={0.9} />;
      })}
    </g>
  );
};

// ── 도해 기호 ───────────────────────────────────────────

/** 라벨 — 고운바탕. at 에 떠오르고 until 에 사라진다. */
export const ALabel: React.FC<{ x: number; y: number; at: number; until?: number; size?: number; color?: string; anchor?: 'start' | 'middle' | 'end'; children: string }> = ({ x, y, at, until, size = 46, color = PA.ink, anchor = 'middle', children }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [at, at + 10], [0, 1], clamp) * (until == null ? 1 : 1 - interpolate(f, [until, until + 10], [0, 1], clamp));
  if (a <= 0) return null;
  return <text x={x} y={y + (1 - a) * 8} fontFamily={FONT_BATANG} fontWeight={700} fontSize={size} fill={color} textAnchor={anchor} opacity={a} style={{ paintOrder: 'stroke', stroke: PA.paper, strokeWidth: 8, strokeLinejoin: 'round' }}>{children}</text>;
};

/** 번호 배지 ①②③ — 주홍 동그라미가 그어지고 숫자가 찍힌다. */
export const ABadge: React.FC<{ x: number; y: number; n: number; at: number; until?: number; r?: number }> = ({ x, y, n, at, until, r = 27 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const out = until == null ? 0 : interpolate(f, [until, until + 10], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  return (
    <g opacity={1 - out}>
      <circle cx={x} cy={y} r={r} fill={PA.paper} stroke={PA.accent} strokeWidth={2.6} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} transform={`rotate(-90 ${x} ${y})`} />
      <text x={x} y={y + r * 0.4} textAnchor="middle" fontFamily={FONT_BATANG} fontWeight={700} fontSize={r * 1.15} fill={PA.accent} opacity={interpolate(p, [0.5, 1], [0, 1], clamp)}>{n}</text>
    </g>
  );
};

/** 화살표 — 곡선이 그어지고 끝에 가는 촉(판화풍). head 는 [x, y, 방향°]. */
export const AArrow: React.FC<{ d: string; head: [number, number, number]; at: number; until?: number; color?: string; w?: number; dur?: number }> = ({ d, head, at, until, color = PA.accent, w = 3, dur = 14 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const out = until == null ? 0 : interpolate(f, [until, until + 10], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  const [hx, hy, deg] = head;
  return (
    <g opacity={1 - out}>
      <Ink d={d} w={w} p={p} color={color} />
      {p > 0.92 ? <path d="M 0 0 L -20 -8 Q -15 0 -20 8 Z" fill={color} transform={`translate(${hx} ${hy}) rotate(${deg})`} /> : null}
    </g>
  );
};

/** 치수선 — 양끝 보조선 + 가는 화살촉 + 가운데 글자(고운바탕). */
export const ADim: React.FC<{ x1: number; y1: number; x2: number; y2: number; text?: string; at: number; until?: number; ext?: number; size?: number; color?: string; textOffset?: number }> = ({ x1, y1, x2, y2, text, at, until, ext = 18, size = 44, color = PA.ink, textOffset = -16 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 16], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const out = until == null ? 0 : interpolate(f, [until, until + 10], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const deg = (ang * 180) / Math.PI;
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const half = p / 2;
  const ax = mx + (x1 - mx) * half * 2, ay = my + (y1 - my) * half * 2, bx = mx + (x2 - mx) * half * 2, by = my + (y2 - my) * half * 2;
  return (
    <g opacity={1 - out}>
      {[[x1, y1], [x2, y2]].map(([ex, ey], i) => <Ink key={i} d={`M ${ex! + nx * ext} ${ey! + ny * ext} L ${ex! - nx * ext} ${ey! - ny * ext}`} w={1.3} color={color} o={p} />)}
      <Ink d={`M ${ax} ${ay} L ${bx} ${by}`} w={1.8} color={color} />
      {p > 0.95 ? (
        <>
          <path d="M 0 0 L 16 -5 L 16 5 Z" fill={color} transform={`translate(${x1} ${y1}) rotate(${deg})`} />
          <path d="M 0 0 L -16 -5 L -16 5 Z" fill={color} transform={`translate(${x2} ${y2}) rotate(${deg})`} />
        </>
      ) : null}
      {text ? <text x={mx + nx * textOffset} y={my + ny * textOffset} textAnchor="middle" fontFamily={FONT_BATANG} fontWeight={700} fontSize={size} fill={color} opacity={interpolate(p, [0.6, 1], [0, 1], clamp)}
        transform={Math.abs(deg) > 45 && Math.abs(deg) < 135 ? `rotate(${deg > 0 ? deg - 90 : deg + 90} ${mx + nx * textOffset} ${my + ny * textOffset})` : undefined}
        style={{ paintOrder: 'stroke', stroke: PA.paper, strokeWidth: 8 }}>{text}</text> : null}
    </g>
  );
};

/** ✓ / ✗ 표 — 동그라미 없이 펜으로 굵게 긋는다(도판 여백 표시). */
export const AMark: React.FC<{ x: number; y: number; ok: boolean; at: number; until?: number; size?: number }> = ({ x, y, ok, at, until, size = 40 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 10], [0, 1], clamp);
  const out = until == null ? 0 : interpolate(f, [until, until + 8], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  const s = size;
  const d = ok ? `M ${x - s * 0.5} ${y} L ${x - s * 0.12} ${y + s * 0.4} L ${x + s * 0.6} ${y - s * 0.5}` : `M ${x - s * 0.42} ${y - s * 0.42} L ${x + s * 0.42} ${y + s * 0.42} M ${x + s * 0.42} ${y - s * 0.42} L ${x - s * 0.42} ${y + s * 0.42}`;
  return <g opacity={1 - out}><Ink d={d} w={7} p={p} color={ok ? '#4f6b3a' : PA.accent} /></g>;
};

/** 지시선 — 점 + 가는 꺾은선(label 쪽). */
export const ALeader: React.FC<{ pts: P[]; at: number; until?: number; color?: string }> = ({ pts, at, until, color = PA.ink }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 12], [0, 1], clamp);
  const out = until == null ? 0 : interpolate(f, [until, until + 10], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  const d = `M ${pts.map((q) => q.join(' ')).join(' L ')}`;
  return (
    <g opacity={1 - out}>
      <circle cx={pts[0]![0]} cy={pts[0]![1]} r={5} fill={color} />
      <Ink d={d} w={1.5} p={p} color={color} />
    </g>
  );
};

/** pH 눈금 막대(도판 축척 막대 모양) — 왼쪽 끝 (x,y), 길이 len, min~max 칸을 흑백 번갈아, lo~hi 를 주홍 칠·빗금으로. */
export const APhScale: React.FC<{ x: number; y: number; len: number; min: number; max: number; lo: number; hi: number; at: number; o?: number }> = ({ x, y, len, min, max, lo, hi, at, o = 1 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const band = interpolate(f, [at + 14, at + 30], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  if (p <= 0 || o <= 0) return null;
  const X = (v: number) => x + ((v - min) / (max - min)) * len;
  const th = 22;
  const cells = Array.from({ length: (max - min) * 2 }, (_, i) => min + i * 0.5);
  const bx0 = X(lo), bx1 = X(lo) + (X(hi) - X(lo)) * band;
  return (
    <g opacity={o}>
      {cells.map((v, i) => i / cells.length <= p ? <rect key={i} x={X(v)} y={y} width={X(v + 0.5) - X(v)} height={th} fill={i % 2 ? PA.paper : PA.ink} opacity={i % 2 ? 1 : 0.82} /> : null)}
      <rect x={x} y={y} width={len * p} height={th} fill="none" stroke={PA.ink} strokeWidth={1.6} />
      {band > 0 ? (
        <g>
          <rect x={bx0} y={y - 10} width={bx1 - bx0} height={th + 20} fill={PA.accent} opacity={0.32} />
          <rect x={bx0} y={y - 10} width={bx1 - bx0} height={th + 20} fill="url(#a-h45f)" opacity={0.5} />
          <rect x={bx0} y={y - 10} width={bx1 - bx0} height={th + 20} fill="none" stroke={PA.accent} strokeWidth={2.4} />
        </g>
      ) : null}
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((v) => (
        <g key={v} opacity={interpolate(p, [(v - min) / (max - min) * 0.8, (v - min) / (max - min) * 0.8 + 0.2], [0, 1], clamp)}>
          <line x1={X(v)} y1={y + th} x2={X(v)} y2={y + th + 12} stroke={PA.ink} strokeWidth={1.5} />
          <text x={X(v)} y={y + th + 50} textAnchor="middle" fontFamily={FONT_BATANG} fontWeight={700} fontSize={36} fill={PA.ink}>{v}</text>
        </g>
      ))}
    </g>
  );
};

export { hatchLines };

// ── 2026-10-23 전체 화면 제품화 — 붓·공용 부품·무대 ─────────────────────────────

/** 물감 색(차분하게). 포인트 색(PA.accent 주홍)은 여기 없다 — hi 로만 덮인다. */
export const TONE_A: Record<Tone, string> = {
  leaf: PA.leaf, leafAutumn: '#c49048', bark: PA.stem, soil: PA.soil, frozen: '#c4ccc9', root: PA.root, straw: '#d7b874', fruit: '#d68b4f',
  water: '#a7bcc2', land: '#e4d7b9', sun: '#e3bd62', skin: '#e6caa9', sleeve: '#8d917c', paper: PA.paper, glass: '#ece3cd', store: '#b89060', calendar: '#f6efde',
};

/** 스타일 A 붓 — 펜 선(먹), 물감 칠, 무늬 빗금. 포인트 색은 hi 로만. */
export const BRUSH_A: Brush = {
  ink: PA.ink, soft: PA.inkSoft, paper: PA.paper, accent: PA.accent, font: FONT_BATANG, fontWeight: 700,
  Line: ({ d, w = 2, p = 1, o = 1, hi = 0, dash }) => <Ink d={d} w={w} p={p} o={o} color={hi > 0 ? interpolateColor(PA.ink, PA.accent, Math.min(1, hi)) : PA.ink} {...(dash ? { dash } : {})} />,
  Fill: ({ d, tone, o = 1, hi = 0 }) => (o <= 0 ? null : (
    <g>
      <Wash d={d} color={TONE_A[tone]} o={o} edge={tone !== 'paper'} />
      {hi > 0 ? <path d={d} fill={PA.accent} opacity={hi * 0.5 * o} /> : null}
    </g>
  )),
  Shade: ({ d, side = 'r', o = 0.55, dense = false }) => <Hatch d={d} pattern={dense ? 'a-h45f' : 'a-h45'} side={side} o={o} />,
};

export const { Leaf, Persimmon, Tree, GroundLine, GroundSection, StrawWrap, KoreaMap, Hand, Snowflake, Snowfall, Sun, Drop, MonthStrip, Reserve } = makeParts(BRUSH_A);
export { mapPoint, treeBox } from '../parts';

/**
 * 스타일 A 무대 — 크림 종이 BaseStage + 정의(ADefs). children = 그림(SVG), labels = 글자·기호(ALabel·ABadge·ADim·AMark·ALeader·AArrow 등),
 * overlay = HTML(FootageInset). 장 이름·자막 띠는 무대 밖(합성)이 그린다.
 */
export const FullStage: React.FC<{ frames: number; labels?: React.ReactNode; overlay?: React.ReactNode; pan?: number; defs?: React.ReactNode; children?: React.ReactNode }> = ({ frames, labels, overlay, pan, defs, children }) => (
  <BaseStage frames={frames} theme={THEME_A} defs={<><ADefs />{defs}</>} labels={labels} overlay={overlay} pan={pan ?? 0}>{children}</BaseStage>
);
