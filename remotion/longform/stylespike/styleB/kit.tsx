// 스타일 B "연필 선화 + 포인트 색" — 미색 종이, 흑연 선(두 번 그은 듯 살짝 어긋남), 성긴 빗금 그늘, 색은 주황빨강 하나뿐.
// 포인트 색은 '지금 낭독이 말하는 것'에만 칠한다(hi prop). 나머지는 전부 흑연.
// 그림 층 전체에 b-graphite 필터(가는 떨림 + 흑연 결)를 한 번 건다 — FullStage svgFilter="url(#b-graphite)".
import React from 'react';
import { Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { FONT_DODUM, clamp, type Theme } from '../shared';
import { fibers, hatchLines, leafPath, potGeom, rootBallGeom, sectionGeom, shrubGeom, stipple, taper, type P } from '../geom';

export const PB = {
  paper: '#f5f2ea', lead: '#2e2e30', lead2: '#5a5957', soft: '#a9a6a0', accent: '#e0523a', accentWash: '#ef8f73',
} as const;

const PAPER = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs>
<filter id="t" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="21"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.35  0 0 0 0 0.33  0.2 0 0 0 -0.07"/></filter>
<filter id="s" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves="3" seed="5"/><feColorMatrix values="0 0 0 0 0.4  0 0 0 0 0.4  0 0 0 0 0.38  0.09 0 0 0 -0.025"/></filter>
<radialGradient id="v" cx="50%" cy="45%" r="78%"><stop offset="0.65" stop-color="#555" stop-opacity="0"/><stop offset="1" stop-color="#444" stop-opacity="0.1"/></radialGradient>
</defs>
<rect width="1920" height="1080" fill="${PB.paper}"/>
<rect width="1920" height="1080" filter="url(#s)"/>
<rect width="1920" height="1080" filter="url(#t)"/>
<rect width="1920" height="1080" fill="url(#v)"/>
</svg>`;

export const THEME_B: Theme = {
  paperSvg: PAPER, ink: PB.lead, muted: 'rgba(56,56,58,.3)', accent: PB.accent, labelFont: FONT_DODUM,
  captionBand: 'rgba(236,233,225,.94)', captionInk: '#2c2c2e',
};

/** 정의 — 흑연 필터(떨림 + 결), 빗금 무늬, 그늘 가림판. */
export const BDefs: React.FC = () => (
  <>
    <filter id="b-graphite" filterUnits="userSpaceOnUse" x={0} y={0} width={1920} height={1080}>
      <feTurbulence type="fractalNoise" baseFrequency={0.03} numOctaves={2} seed={8} result="warp" />
      <feDisplacementMap in="SourceGraphic" in2="warp" scale={3.2} xChannelSelector="R" yChannelSelector="G" result="wob" />
      <feTurbulence type="fractalNoise" baseFrequency={0.95} numOctaves={1} seed={13} result="grain" />
      <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.62" result="grainA" />
      <feComposite in="wob" in2="grainA" operator="in" />
    </filter>
    {([['b-h50', 50, 8, 1.1], ['b-h50f', 50, 5.5, 0.9], ['b-h-40', -40, 8, 1.0], ['b-hcut', 45, 10, 1.3]] as const).map(([id, ang, sp, sw]) => (
      <pattern key={id} id={id} width={sp} height={sp} patternUnits="userSpaceOnUse" patternTransform={`rotate(${ang})`}>
        <line x1={0} y1={0} x2={0} y2={sp} stroke={PB.lead2} strokeWidth={sw} />
      </pattern>
    ))}
    {([['b-m-r', 0.42, 1, 0, 0], ['b-m-br', 0.38, 1, 0.38, 1]] as const).map(([id, x1, x2, y1, y2]) => (
      <mask key={id} id={id} maskContentUnits="objectBoundingBox">
        <linearGradient id={`${id}-g`} x1={x1} x2={x2} y1={y1} y2={y2}>
          <stop offset={0} stopColor="#fff" stopOpacity={0} /><stop offset={1} stopColor="#fff" stopOpacity={1} />
        </linearGradient>
        <rect x={0} y={0} width={1} height={1} fill={`url(#${id}-g)`} />
      </mask>
    ))}
  </>
);

const DONE = -999;
export function useP(at: number, dur = 16): number {
  const f = useCurrentFrame();
  return interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
}

/** 연필 선 — 두 번 그은 듯: 진한 한 줄 + 살짝 어긋난 옅은 한 줄. p 만큼 그어진다. */
export const PLine: React.FC<{ d: string; w?: number; p?: number; color?: string; o?: number; seed?: string; dash?: string; double?: boolean }> = ({ d, w = 2.6, p = 1, color = PB.lead, o = 1, seed = 'pl', dash, double = true }) => {
  if (p <= 0 || o <= 0) return null;
  const dx = (random(`${seed}dx`) - 0.5) * 2.4, dy = (random(`${seed}dy`) - 0.5) * 2.4;
  const prog = dash ? { strokeDasharray: dash } : p < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - p } : {};
  return (
    <g opacity={o}>
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={0.92} {...prog} />
      {double ? <path d={d} fill="none" stroke={color} strokeWidth={w * 0.5} strokeLinecap="round" opacity={0.45} transform={`translate(${dx} ${dy})`} {...prog} /> : null}
    </g>
  );
};

/** 손 빗금 — 모양 d 안을 jitter 된 평행선으로(clip), 그늘 쪽만(mask). 성기게. */
export const PHatch: React.FC<{ id: string; d: string; box: { x0: number; y0: number; x1: number; y1: number }; angle?: number; spacing?: number; side?: 'r' | 'br' | 'all'; o?: number; p?: number; color?: string; w?: number }> = ({ id, d, box, angle = 50, spacing = 9, side = 'r', o = 0.75, p = 1, color = PB.lead2, w = 1.3 }) => {
  if (o <= 0 || p <= 0) return null;
  const lines = hatchLines(box, angle, spacing, id);
  return (
    <g>
      <defs><clipPath id={`bh-${id}`}><path d={d} /></clipPath></defs>
      <g clipPath={`url(#bh-${id})`} opacity={o}>
        <path d={lines} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" {...(side === 'all' ? {} : { mask: `url(#b-m-${side})` })} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} />
      </g>
    </g>
  );
};

/** 포인트 색 칠 — 수채 느낌으로 살짝 비치게 + 가장자리 진하게. */
export const Accent: React.FC<{ d: string; o?: number }> = ({ d, o = 1 }) => (o <= 0 ? null : (
  <g opacity={o}>
    <path d={d} fill={PB.accentWash} opacity={0.75} />
    <path d={d} fill="none" stroke={PB.accent} strokeWidth={3} opacity={0.6} />
  </g>
));

/** 종이색으로 가리기(뒤에 있는 선을 지움). */
const Occlude: React.FC<{ d: string; o?: number }> = ({ d, o = 1 }) => <path d={d} fill={PB.paper} opacity={o} />;

// ── 식물

export const BLeaf: React.FC<{ x: number; y: number; angle: number; len: number; wid?: number; flip?: number; tone?: number; p?: number; seed?: string }> = ({ x, y, angle, len, wid = 0.44, flip = 1, p = 1, seed = 'lf' }) => {
  if (p <= 0) return null;
  const L = leafPath(len, wid);
  const shade = flip > 0 ? L.lower : L.upper;
  const det = interpolate(p, [0.5, 1], [0, 1], clamp);
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <Occlude d={L.outline} o={Math.min(1, p * 2)} />
      <path d={shade} fill="url(#b-h50f)" opacity={0.7 * det} />
      <PLine d={L.outline} w={1.9} p={Math.min(1, p * 1.5)} seed={seed} />
      <PLine d={L.midrib} w={1.1} p={det} double={false} />
      {det > 0 ? L.veins.filter((_, i) => i % 2 === 0 || i > 5).map((v, i) => <path key={i} d={v} fill="none" stroke={PB.lead2} strokeWidth={0.8} opacity={0.6 * det} />) : null}
    </g>
  );
};

export const BBerry: React.FC<{ x: number; y: number; r: number; p?: number; hi?: number }> = ({ x, y, r, p = 1, hi = 0 }) => {
  if (p <= 0) return null;
  const cd = `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  const crown = Array.from({ length: 5 }, (_, i) => { const a = (i / 5) * Math.PI * 2; return `M ${x + r * 0.25} ${y - r * 0.4} l ${Math.cos(a) * r * 0.24} ${Math.sin(a) * r * 0.24}`; }).join(' ');
  return (
    <g transform={`translate(${x} ${y}) scale(${p}) translate(${-x} ${-y})`}>
      <Occlude d={cd} />
      {hi > 0 ? <Accent d={cd} o={hi} /> : null}
      <path d={cd} fill="url(#b-h-40)" mask="url(#b-m-br)" opacity={0.7} />
      <PLine d={cd} w={1.5} seed={`bb${x}`} double={false} />
      <path d={crown} stroke={PB.lead} strokeWidth={1} fill="none" />
    </g>
  );
};

export const BShrub: React.FC<{ x: number; y: number; h: number; seed: string; at?: number; grow?: number; berries?: boolean; o?: number; stems?: number }> = ({ x, y, h, seed, at = DONE, grow = 30, berries = true, o = 1, stems = 4 }) => {
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
        return (
          <g key={i}>
            <Occlude d={d} o={p > 0 ? 1 : 0} />
            <path d={d} fill="url(#b-h50f)" mask="url(#b-m-r)" opacity={0.6 * p} />
            <PLine d={d} w={1.4} p={p} seed={`${seed}s${i}`} />
          </g>
        );
      })}
      {g.leaves.map((l, i) => <BLeaf key={i} {...l} p={pFor(l.order)} seed={`${seed}l${i}`} />)}
      {g.berries.map((b, i) => <BBerry key={i} x={b.x} y={b.y} r={b.r} p={pFor(b.order)} />)}
    </g>
  );
};

// ── 화분

export const BGround: React.FC<{ x0: number; x1: number; y: number; p?: number }> = ({ x0, x1, y, p = 1 }) => (
  <PLine d={`M ${x0} ${y} C ${x0 + (x1 - x0) * 0.3} ${y - 2} ${x0 + (x1 - x0) * 0.7} ${y + 3} ${x1} ${y}`} w={1.6} p={p} seed="gr" o={0.7} />
);

export const BPot: React.FC<{ x: number; y: number; w: number; h: number; at?: number; o?: number; soilHi?: number; empty?: boolean; seed?: string }> = ({ x, y, w, h, at = DONE, o = 1, soilHi = 0, empty = false, seed = 'pot' }) => {
  const p = useP(at, 18);
  if (p <= 0 || o <= 0) return null;
  const G = potGeom(w, h);
  const top = G.top;
  const soilY = top + G.ry * 0.6;
  const soilD = `M ${-G.wr / 2 + 12} ${soilY} a ${G.wr / 2 - 12} ${G.ry * 0.62} 0 1 0 ${G.wr - 24} 0 a ${G.wr / 2 - 12} ${G.ry * 0.62} 0 1 0 ${-(G.wr - 24)} 0 Z`;
  const det = interpolate(p, [0.5, 1], [0, 1], clamp);
  const box = { x0: -G.wr / 2, y0: top, x1: G.wr / 2, y1: 0 };
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      <ellipse cx={w * 0.14} cy={2} rx={G.wb * 0.6} ry={9} fill={PB.lead2} opacity={0.14 * det} />
      <Occlude d={G.body} />
      <PHatch id={`${seed}b`} d={G.body} box={box} side="r" p={det} o={0.65} />
      {[0.32, 0.62].map((k) => <PLine key={k} d={`M ${-(G.wb / 2 + (w - G.wb) / 2 * k)} ${-h * k} Q 0 ${-h * k + G.ry * 0.7} ${G.wb / 2 + (w - G.wb) / 2 * k} ${-h * k}`} w={1} p={det} double={false} o={0.6} />)}
      <PLine d={G.body} w={2.2} p={p} seed={`${seed}o`} />
      <Occlude d={G.rim} />
      <PHatch id={`${seed}r`} d={G.rim} box={box} side="r" p={det} o={0.5} spacing={6} />
      <PLine d={G.rim} w={2} p={p} seed={`${seed}r`} />
      <path d={`M ${-G.wr / 2 + 2} ${top} a ${G.wr / 2 - 2} ${G.ry} 0 1 0 ${G.wr - 4} 0 a ${G.wr / 2 - 2} ${G.ry} 0 1 0 ${-(G.wr - 4)} 0 Z`} fill={PB.paper} stroke={PB.lead} strokeWidth={1.8} opacity={det} />
      {empty ? <path d={`M ${-G.wr / 2 + 6} ${top} A ${G.wr / 2 - 6} ${G.ry - 4} 0 0 0 ${G.wr / 2 - 6} ${top}`} fill="url(#b-h50)" opacity={0.7 * det} /> : (
        <g opacity={det}>
          {soilHi > 0 ? <Accent d={soilD} o={soilHi} /> : null}
          {stipple({ x0: -G.wr / 2 + 20, y0: soilY - G.ry * 0.5, x1: G.wr / 2 - 20, y1: soilY + G.ry * 0.5 }, 70, `${seed}st`, 0.8, 1.8).map(([sx, sy, sr], k) => <circle key={k} cx={sx} cy={sy} r={sr} fill={PB.lead} opacity={0.6} />)}
          <PLine d={soilD} w={1.2} double={false} o={0.7} />
        </g>
      )}
    </g>
  );
};

export const BPotBottom: React.FC<{ x: number; y: number; r: number; holes?: number; holeHi?: number; p?: number; o?: number }> = ({ x, y, r, holes = 5, holeHi = 0, p = 1, o = 1 }) => {
  if (p <= 0 || o <= 0) return null;
  const rb = r * 0.74, hr = r * 0.075;
  const pts: P[] = [[0, 0], ...Array.from({ length: holes - 1 }, (_, i) => { const a = (i / (holes - 1)) * Math.PI * 2 + Math.PI / 4; return [Math.cos(a) * rb * 0.6, Math.sin(a) * rb * 0.6] as P; })];
  const circ = (rr: number) => `M ${-rr} 0 a ${rr} ${rr} 0 1 0 ${2 * rr} 0 a ${rr} ${rr} 0 1 0 ${-2 * rr} 0 Z`;
  const det = interpolate(p, [0.5, 1], [0, 1], clamp);
  const box = { x0: -r, y0: -r, x1: r, y1: r };
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      <Occlude d={circ(r)} />
      <PHatch id="bpb1" d={circ(r)} box={box} side="br" p={det} o={0.6} />
      <PLine d={circ(r)} w={2.2} p={p} seed="bpb1" />
      <Occlude d={circ(rb)} o={det} />
      <PHatch id="bpb2" d={circ(rb)} box={box} side="br" p={det} o={0.4} spacing={11} angle={-40} />
      <PLine d={circ(rb)} w={1.8} p={p} seed="bpb2" />
      <PLine d={circ(r * 0.9)} w={1} p={p} double={false} o={0.5} />
      {pts.map(([hx, hy], i) => {
        const hp = interpolate(holeHi, [i * 0.12, i * 0.12 + 0.4], [0, 1], clamp);
        return (
          <g key={i} opacity={det}>
            {hp > 0 ? <circle cx={hx} cy={hy} r={(hr + 12) * hp} fill={PB.accentWash} opacity={0.8} /> : null}
            {hp > 0 ? <circle cx={hx} cy={hy} r={hr + 12} fill="none" stroke={PB.accent} strokeWidth={2.6} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - hp} /> : null}
            <circle cx={hx} cy={hy} r={hr} fill={PB.lead} opacity={0.85} />
          </g>
        );
      })}
    </g>
  );
};

export type SoilKind = 'peat' | 'soil';

/** 단면 화분 — 벽 단면 빗금, 흙은 점묘, 피트모스는 짧은 섬유. hiKind 층은 포인트 색 칠. */
export const BPotSection: React.FC<{
  x: number; y: number; w: number; h: number; layers: { kind: SoilKind; ratio: number }[]; fill?: number; mix?: number; at?: number; o?: number; seed?: string; hiKind?: SoilKind; hi?: number; children?: React.ReactNode;
}> = ({ x, y, w, h, layers, fill = 1, mix = 0, at = DONE, o = 1, seed = 'bsec', hiKind, hi = 0, children }) => {
  const p = useP(at, 18);
  if (p <= 0 || o <= 0) return null;
  const G = sectionGeom(x, y, w, h);
  const total = layers.reduce((s, l) => s + l.ratio, 0);
  const filled = total * fill;
  let acc = 0;
  const det = interpolate(p, [0.4, 1], [0, 1], clamp);
  const box = { x0: x - w / 2, y0: y - h, x1: x + w / 2, y1: y };
  const cid = `b-secclip-${seed}`;
  return (
    <g opacity={o}>
      <defs><clipPath id={cid}><path d={G.fillPath(Math.max(0.0001, filled))} /></clipPath></defs>
      <g clipPath={`url(#${cid})`} opacity={det}>
        {layers.map((l, i) => {
          const r0 = acc, r1 = acc + l.ratio;
          acc = r1;
          const yTop = G.levelY(r1), yBot = G.levelY(r0);
          const lb = { x0: box.x0, y0: yTop - 4, x1: box.x1, y1: yBot + 4 };
          const peat = l.kind === 'peat' && mix < 0.5;
          return (
            <g key={i}>
              {hiKind === l.kind && hi > 0 ? <Accent d={G.band(r0, r1)} o={hi * (1 - mix)} /> : null}
              {peat || mix >= 0.5 ? fibers(lb, Math.round((lb.y1 - lb.y0) * w * 0.0028), `${seed}f${i}`, 15).map(([fx, fy, fa, fl], k) => (
                <path key={k} d={`M ${fx} ${fy} q ${Math.cos(fa) * fl * 0.5} ${-4} ${Math.cos(fa) * fl} ${Math.sin(fa) * fl * 0.4}`} stroke={PB.lead} strokeWidth={1.1} fill="none" opacity={0.65} />
              )) : null}
              {!peat ? stipple(lb, Math.round((lb.y1 - lb.y0) * w * 0.005), `${seed}s${i}`, 0.8, 2).map(([sx, sy, sr], k) => <circle key={k} cx={sx} cy={sy} r={sr} fill={PB.lead} opacity={0.6} />) : null}
              {mix < 0.5 && i < layers.length - 1 ? <PLine d={`M ${G.innerX(yTop, -1)} ${yTop} L ${G.innerX(yTop, 1)} ${yTop}`} w={1} double={false} o={0.5} /> : null}
            </g>
          );
        })}
      </g>
      {filled > 0.01 ? <PLine d={`M ${G.innerX(G.levelY(filled), -1)} ${G.levelY(filled)} Q ${x} ${G.levelY(filled) - 5} ${G.innerX(G.levelY(filled), 1)} ${G.levelY(filled)}`} w={1.4} double={false} o={det} /> : null}
      {children}
      {[G.wallL, G.wallR, G.floor].map((d, i) => (
        <g key={i}>
          <Occlude d={d} />
          <path d={d} fill="url(#b-hcut)" opacity={0.9 * det} />
          <PLine d={d} w={1.8} p={p} seed={`${seed}w${i}`} />
        </g>
      ))}
    </g>
  );
};

/** 뿌리 덩이 — 윤곽 + 점묘 + 감긴 뿌리(흑연). 풀린 뿌리는 hi 만큼 포인트 색. reach 로 풀린 뿌리 길이를 줄인다(화분 안). */
export const BRootBall: React.FC<{ x: number; y: number; w: number; h: number; loosen?: number; seed?: string; p?: number; o?: number; hi?: number; reach?: number }> = ({ x, y, w, h, loosen = 0, seed = 'brb', p = 1, o = 1, hi = 0, reach = 1 }) => {
  if (p <= 0 || o <= 0) return null;
  const G = rootBallGeom(seed, w, h);
  const cid = `b-rb-${seed}`;
  const box = { x0: -w / 2, y0: 0, x1: w / 2, y1: h + 12 };
  const rootCol = hi > 0.5 ? PB.accent : PB.lead;
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      <defs><clipPath id={cid}><path d={G.body} /></clipPath></defs>
      {G.loose.map((l, i) => (
        <g key={i} transform={`translate(${l.x0} ${l.y0}) scale(${reach}) translate(${-l.x0} ${-l.y0})`}>
          <PLine d={l.d} w={2.8 - (i % 3) * 0.4} p={interpolate(loosen, [i * 0.02, i * 0.02 + 0.55], [0, 1], clamp)} color={rootCol} seed={`${seed}l${i}`} />
        </g>
      ))}
      <Occlude d={G.body} />
      <g clipPath={`url(#${cid})`}>
        {stipple(box, Math.round(w * h * 0.0035), `${seed}st`, 0.8, 2).map(([sx, sy, sr], k) => <circle key={k} cx={sx} cy={sy} r={sr} fill={PB.lead} opacity={0.55} />)}
        {G.circling.map((d, i) => <PLine key={i} d={d} w={1.6} o={1 - loosen * 0.5} color={i % 3 === 0 && hi > 0.5 ? PB.accent : PB.lead} seed={`${seed}c${i}`} />)}
        <PHatch id={`${seed}h`} d={G.body} box={box} side="r" o={0.55} />
      </g>
      <PLine d={G.body} w={2.2} p={p} seed={`${seed}o`} />
    </g>
  );
};

export const BSack: React.FC<{ x: number; y: number; w?: number; h?: number; tilt?: number; o?: number }> = ({ x, y, w = 150, h = 200, tilt = 0, o = 1 }) => {
  if (o <= 0) return null;
  const body = `M ${-w / 2} ${-h / 2 + 16} L ${-w / 2 + 4} ${h / 2} Q 0 ${h / 2 + 8} ${w / 2 - 4} ${h / 2} L ${w / 2} ${-h / 2 + 16} Z`;
  const flap = `M ${-w / 2} ${-h / 2 + 16} L ${-w / 2 + 10} ${-h / 2} L ${w / 2 - 10} ${-h / 2} L ${w / 2} ${-h / 2 + 16} Z`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`} opacity={o}>
      <Occlude d={body} />
      <PHatch id="bsack" d={body} box={{ x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2 }} side="r" o={0.55} />
      <PLine d={body} w={2} seed="bsk" />
      <Occlude d={flap} />
      <PLine d={flap} w={1.8} seed="bskf" />
      <BLeaf x={-6} y={24} angle={-62} len={w * 0.3} seed="bskl1" />
      <BLeaf x={-6} y={24} angle={-118} len={w * 0.24} seed="bskl2" />
    </g>
  );
};

export const BFall: React.FC<{ from: [number, number]; toY: number; at: number; until: number; n?: number; spread?: number; color?: string }> = ({ from, toY, at, until, n = 34, spread = 22, color = PB.lead }) => {
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
        const ang = (i * 53) % 180;
        return <path key={i} d={`M ${from[0] + jx} ${from[1] + fall * k * k} l ${Math.cos(ang) * 7} ${Math.sin(ang) * 4}`} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.8} />;
      })}
    </g>
  );
};

// ── 표시

export const BLabel: React.FC<{ x: number; y: number; at: number; until?: number; size?: number; hi?: boolean; anchor?: 'start' | 'middle' | 'end'; underline?: number; children: string }> = ({ x, y, at, until, size = 48, hi = false, anchor = 'middle', underline, children }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [at, at + 10], [0, 1], clamp) * (until == null ? 1 : 1 - interpolate(f, [until, until + 10], [0, 1], clamp));
  if (a <= 0) return null;
  const ux = anchor === 'start' ? x : anchor === 'end' ? x - (underline ?? 0) : x - (underline ?? 0) / 2;
  return (
    <g opacity={a}>
      <text x={x} y={y + (1 - a) * 8} fontFamily={FONT_DODUM} fontSize={size} fill={hi ? PB.accent : PB.lead} textAnchor={anchor} style={{ paintOrder: 'stroke', stroke: PB.paper, strokeWidth: 9, strokeLinejoin: 'round' }}>{children}</text>
      {underline ? <path d={`M ${ux} ${y + 14} q ${underline / 2} 5 ${underline} -2`} stroke={hi ? PB.accent : PB.lead} strokeWidth={2.6} fill="none" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - interpolate(f, [at + 6, at + 18], [0, 1], clamp)} /> : null}
    </g>
  );
};

export const BArrow: React.FC<{ d: string; head: [number, number, number]; at: number; until?: number; hi?: boolean; w?: number; dur?: number }> = ({ d, head, at, until, hi = false, w = 2.4, dur = 14 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const out = until == null ? 0 : interpolate(f, [until, until + 10], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  const [hx, hy, deg] = head;
  const c = hi ? PB.accent : PB.lead;
  return (
    <g opacity={1 - out}>
      <PLine d={d} w={w} p={p} color={c} seed={`ar${hx}`} />
      {p > 0.9 ? <path d="M -18 -9 L 0 0 L -18 9" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" transform={`translate(${hx} ${hy}) rotate(${deg})`} /> : null}
    </g>
  );
};

export const BDim: React.FC<{ x1: number; y1: number; x2: number; y2: number; text?: string; at: number; until?: number; hi?: boolean; size?: number; textOffset?: number }> = ({ x1, y1, x2, y2, text, at, until, hi = false, size = 48, textOffset = -18 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 16], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const out = until == null ? 0 : interpolate(f, [until, until + 10], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  const c = hi ? PB.accent : PB.lead;
  const ang = Math.atan2(y2 - y1, x2 - x1), deg = (ang * 180) / Math.PI;
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return (
    <g opacity={1 - out}>
      {[[x1, y1], [x2, y2]].map(([ex, ey], i) => <PLine key={i} d={`M ${ex! + nx * 16} ${ey! + ny * 16} L ${ex! - nx * 16} ${ey! - ny * 16}`} w={1.6} color={c} o={p} double={false} />)}
      <PLine d={`M ${mx + (x1 - mx) * p} ${my + (y1 - my) * p} L ${mx + (x2 - mx) * p} ${my + (y2 - my) * p}`} w={2} color={c} seed="dim" />
      {p > 0.95 ? <>
        <path d="M 16 -7 L 0 0 L 16 7" fill="none" stroke={c} strokeWidth={2} transform={`translate(${x1} ${y1}) rotate(${deg})`} />
        <path d="M -16 -7 L 0 0 L -16 7" fill="none" stroke={c} strokeWidth={2} transform={`translate(${x2} ${y2}) rotate(${deg})`} />
      </> : null}
      {text ? <text x={mx + nx * textOffset} y={my + ny * textOffset} textAnchor="middle" fontFamily={FONT_DODUM} fontSize={size} fill={c} opacity={interpolate(p, [0.6, 1], [0, 1], clamp)} style={{ paintOrder: 'stroke', stroke: PB.paper, strokeWidth: 9 }}>{text}</text> : null}
    </g>
  );
};

export const BMark: React.FC<{ x: number; y: number; ok: boolean; at: number; until?: number; size?: number }> = ({ x, y, ok, at, until, size = 44 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 10], [0, 1], clamp);
  const out = until == null ? 0 : interpolate(f, [until, until + 8], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  const s = size;
  const d = ok ? `M ${x - s * 0.5} ${y} L ${x - s * 0.12} ${y + s * 0.4} L ${x + s * 0.6} ${y - s * 0.5}` : `M ${x - s * 0.42} ${y - s * 0.42} L ${x + s * 0.42} ${y + s * 0.42} M ${x + s * 0.42} ${y - s * 0.42} L ${x - s * 0.42} ${y + s * 0.42}`;
  return <g opacity={1 - out}><PLine d={d} w={6} p={p} color={ok ? PB.accent : PB.lead} seed={`mk${x}`} /></g>;
};

export const BLeader: React.FC<{ pts: P[]; at: number; until?: number; hi?: boolean }> = ({ pts, at, until, hi = false }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 12], [0, 1], clamp);
  const out = until == null ? 0 : interpolate(f, [until, until + 10], [0, 1], clamp);
  if (p <= 0 || out >= 1) return null;
  const c = hi ? PB.accent : PB.lead;
  return (
    <g opacity={1 - out}>
      <circle cx={pts[0]![0]} cy={pts[0]![1]} r={4.5} fill={c} />
      <PLine d={`M ${pts.map((q) => q.join(' ')).join(' L ')}`} w={1.6} p={p} color={c} double={false} />
    </g>
  );
};

/** pH 눈금 — 연필로 그은 자. 4.5~5.5 칸만 포인트 색. */
export const BPhScale: React.FC<{ x: number; y: number; len: number; min: number; max: number; lo: number; hi: number; at: number; o?: number }> = ({ x, y, len, min, max, lo, hi, at, o = 1 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const band = interpolate(f, [at + 14, at + 30], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  if (p <= 0 || o <= 0) return null;
  const X = (v: number) => x + ((v - min) / (max - min)) * len;
  const th = 30;
  const bar = `M ${x} ${y} L ${x + len} ${y} L ${x + len} ${y + th} L ${x} ${y + th} Z`;
  const bx0 = X(lo), bx1 = X(lo) + (X(hi) - X(lo)) * band;
  return (
    <g opacity={o}>
      <Occlude d={bar} />
      {band > 0 ? <Accent d={`M ${bx0} ${y - 6} L ${bx1} ${y - 6} L ${bx1} ${y + th + 6} L ${bx0} ${y + th + 6} Z`} /> : null}
      <PLine d={bar} w={2} p={p} seed="ph" />
      {Array.from({ length: (max - min) * 2 + 1 }, (_, i) => min + i * 0.5).map((v, i) => (
        <PLine key={i} d={`M ${X(v)} ${y + th} L ${X(v)} ${y + th - (i % 2 ? 9 : 16)}`} w={1.4} double={false} o={p >= (v - min) / (max - min) ? 1 : 0} />
      ))}
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((v) => (
        <text key={v} x={X(v)} y={y + th + 46} textAnchor="middle" fontFamily={FONT_DODUM} fontSize={36} fill={PB.lead} opacity={interpolate(p, [(v - min) / (max - min) * 0.8, (v - min) / (max - min) * 0.8 + 0.2], [0, 1], clamp)}>{v}</text>
      ))}
    </g>
  );
};
