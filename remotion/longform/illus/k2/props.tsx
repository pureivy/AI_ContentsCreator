// 소품 — Sack(포대, 기울여 붓기), PourStream(쏟아지는 알갱이·섬유·물), WaterDrops, WaterStream, Trowel, WateringCan,
// Fertilizer(뿌린 비료 알갱이), Mulch(덮개층), Stake(지주 + 끈).
import React from 'react';
import { Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { type P } from '../geom';
import { CastShadow, DONE, clamp, popScale, useAppear } from './common';

const SACK_FILL: Record<'kraft' | 'white' | 'green', { body: string; edge: string; fold: string; label: string; ink: string }> = {
  kraft: { body: 'url(#k2-kraft)', edge: '#8a6d3f', fold: '#b99863', label: '#3d6b33', ink: '#f4ead2' },
  white: { body: 'url(#k2-sack-white)', edge: '#8f887a', fold: '#d8d2c3', label: '#c0392b', ink: '#fff' },
  green: { body: 'url(#k2-sack-green)', edge: '#22401c', fold: '#5a8c48', label: '#f2e6c4', ink: '#2a4a22' },
};

/** 포대 입구의 화면 좌표 — 원점(x,y)=포대 가운데, tilt(도)만큼 돌았을 때. */
export function sackMouth(x: number, y: number, h: number, tilt: number): P {
  const r = (tilt * Math.PI) / 180, d = h / 2 + 10;
  return [x + d * Math.sin(r), y - d * Math.cos(r)];
}

/**
 * 쏟아지는 줄기 — from(입구)에서 toY(표면)까지 알갱이가 떨어진다. at~until 동안 흐르고 그 뒤 끊긴다.
 * kind: granule(흙·피트 알갱이) · fiber(섬유) · water(물 줄기 방울).
 */
export const PourStream: React.FC<{ from: P; toY: number; at: number; until: number; color?: string; kind?: 'granule' | 'fiber' | 'water'; n?: number; spread?: number }> = ({ from, toY, at, until, color = '#9a6644', kind = 'granule', n = 28, spread = 18 }) => {
  const f = useCurrentFrame();
  if (f < at || f > until + 16) return null;
  const fall = Math.max(20, toY - from[1]);
  const period = Math.max(8, Math.sqrt(fall) * 1.6);
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const born = at + random(`ps${i}`) * period;
        if (f < born) return null;
        const t = (((f - at) / period + random(`ps${i}`)) % 1);
        if (f > until && t < (f - until) / period) return null;
        const yy = from[1] + fall * t * t;
        const xx = from[0] + (random(`psx${i}`) - 0.5) * spread * (0.3 + t) + Math.sin(i + f / 5) * 1.5;
        if (kind === 'water') return <ellipse key={i} cx={xx} cy={yy} rx={2.6} ry={5 + t * 4} fill="url(#k2-drop)" opacity={0.9} />;
        if (kind === 'fiber') return <path key={i} d={`M ${xx} ${yy} l ${4 + random(`psl${i}`) * 5} ${2}`} stroke={i % 3 ? color : '#c48a5c'} strokeWidth={1.8} strokeLinecap="round" transform={`rotate(${i * 47 + f * 6} ${xx} ${yy})`} />;
        return <ellipse key={i} cx={xx} cy={yy} rx={2.8 + random(`psr${i}`) * 2} ry={2.2} fill={i % 3 ? color : '#c48a5c'} transform={`rotate(${i * 37} ${xx} ${yy})`} />;
      })}
      {/* 떨어진 자리 — 작은 먼지 둔덕 */}
      {f > at + period * 0.8 ? <ellipse cx={from[0]} cy={toY} rx={spread * 1.4} ry={4} fill={kind === 'water' ? '#9fd0f0' : color} opacity={kind === 'water' ? 0.5 : 0.7} /> : null}
    </g>
  );
};

/**
 * 포대 — 크라프트·흰·초록 자루, 접힌 입구, 가운데 라벨(label 글자, 8자 이하). 원점 = 포대 가운데.
 * tilt(도)로 기울이고, pour 를 주면 입구에서 toY 까지 내용물이 쏟아진다.
 */
export const Sack: React.FC<{ x: number; y: number; w?: number; h?: number; label?: string; color?: 'kraft' | 'white' | 'green'; tilt?: number; at?: number; o?: number;
  pour?: { at: number; until: number; toY: number; color?: string; kind?: 'granule' | 'fiber' } }> = ({ x, y, w = 110, h = 150, label, color = 'kraft', tilt = 0, at = DONE, o = 1, pour }) => {
  const p = useAppear(at, 12);
  if (p <= 0 || o <= 0) return null;
  const S = SACK_FILL[color];
  const hw = w / 2, hh = h / 2;
  const mouth = sackMouth(x, y, h, tilt);
  const zig = Array.from({ length: 8 }, (_, i) => `L ${-hw + ((i + 0.5) * w) / 8} ${-hh - (i % 2 ? 4 : 14)}`).join(' ');
  return (
    <g opacity={p * o}>
      <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${popScale(p)})`} filter="url(#kit-shadow)">
        <path d={`M ${-hw} ${-hh} Q ${-hw - 6} 0 ${-hw + 2} ${hh} Q 0 ${hh + 12} ${hw - 2} ${hh} Q ${hw + 6} 0 ${hw} ${-hh} Z`} fill={S.body} stroke={S.edge} strokeWidth={2} {...(color === 'kraft' ? { filter: 'url(#k2-paper)' } : {})} />
        <path d={`M ${-hw} ${-hh} ${zig} L ${hw} ${-hh} Z`} fill={S.fold} stroke={S.edge} strokeWidth={1.6} />
        <path d={`M ${-hw + 6} ${-hh + 10} L ${hw - 6} ${-hh + 10}`} stroke={S.edge} strokeWidth={1.4} strokeDasharray="4 3" opacity={0.7} />
        {/* 주름 · 빛 */}
        <path d={`M ${-hw * 0.6} ${-hh + 20} q -6 ${hh * 0.6} 2 ${hh * 1.5}`} stroke="#000" strokeOpacity={0.12} strokeWidth={3} fill="none" />
        <path d={`M ${hw * 0.5} ${-hh + 24} q 8 ${hh * 0.5} 0 ${hh * 1.4}`} stroke="#000" strokeOpacity={0.18} strokeWidth={4} fill="none" />
        <path d={`M ${-hw + 8} ${-hh + 22} Q ${-hw + 4} 0 ${-hw + 10} ${hh - 10}`} stroke="#fff" strokeOpacity={0.3} strokeWidth={7} fill="none" strokeLinecap="round" />
        <rect x={-hw * 0.66} y={-hh * 0.3} width={w * 0.66} height={h * 0.38} rx={8} fill={S.label} opacity={0.92} />
        <path d={`M ${-hw * 0.2} ${hh * 0.02} Q ${-hw * 0.28} ${-hh * 0.2} 0 ${-hh * 0.24} Q ${hw * 0.28} ${-hh * 0.2} ${hw * 0.2} ${hh * 0.02} Q 0 ${hh * 0.06} ${-hw * 0.2} ${hh * 0.02} Z`} fill="#a8d688" opacity={label ? 0 : 1} />
        {label ? <text x={0} y={hh * 0.0 + 4} fontSize={Math.min(26, (w * 0.6) / Math.max(2, [...label].length) * 1.25)} textAnchor="middle" fill={S.ink} fontWeight={800}>{label}</text> : null}
      </g>
      {pour ? <PourStream from={mouth} toY={pour.toY} at={pour.at} until={pour.until} color={pour.color ?? '#9a6644'} kind={pour.kind ?? 'granule'} /> : null}
    </g>
  );
};

/** 물방울 — pts 의 각 점에서 주기적으로 맺혀 떨어진다(at~until). */
export const WaterDrops: React.FC<{ pts: P[]; at: number; until?: number; fall?: number; period?: number; size?: number }> = ({ pts, at, until, fall = 120, period = 22, size = 1 }) => {
  const f = useCurrentFrame();
  if (f < at || (until != null && f > until + period)) return null;
  return (
    <g>
      {pts.flatMap(([x, y], k) => [0, 1, 2].map((j) => {
        const t = ((f - at) / period + j / 3 + random(`wd${k}`) * 0.3) % 1;
        if (until != null && f > until && t < (f - until) / period) return null;
        const yy = y + t * t * fall;
        const s = size * (0.8 + t * 0.4);
        return (
          <g key={`${k}${j}`} opacity={1 - t * 0.7} transform={`translate(${x} ${yy}) scale(${s})`}>
            <path d="M 0 -16 Q 10 0 0 8 Q -10 0 0 -16 Z" fill="url(#k2-drop)" stroke="#2f6a98" strokeWidth={1} />
            <ellipse cx={-3} cy={-1} rx={2} ry={4} fill="#fff" opacity={0.7} />
          </g>
        );
      }))}
    </g>
  );
};

/** 물줄기 — from 에서 to 로 휘어 떨어지는 줄기, 끝에 튀는 물. at~until 동안. */
export const WaterStream: React.FC<{ from: P; to: P; at: number; until?: number; width?: number }> = ({ from, to, at, until, width = 7 }) => {
  const f = useCurrentFrame();
  const on = interpolate(f, [at, at + 8], [0, 1], clamp) * (until == null ? 1 : interpolate(f, [until, until + 8], [1, 0], clamp));
  if (on <= 0) return null;
  const [x0, y0] = from, [x1, y1] = to;
  const cx = x0 + (x1 - x0) * 0.75, cy = y0 - 6;
  const reach = interpolate(f, [at, at + 10], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const ex = x0 + (x1 - x0) * reach, ey = y0 + (y1 - y0) * reach * reach;
  const d = `M ${x0} ${y0} Q ${x0 + (cx - x0) * reach} ${y0 + (cy - y0) * reach} ${ex} ${ey}`;
  return (
    <g opacity={on}>
      <path d={d} stroke="#3b78a8" strokeWidth={width + 3} fill="none" strokeLinecap="round" opacity={0.5} />
      <path d={d} stroke="url(#k2-water)" strokeWidth={width} fill="none" strokeLinecap="round" />
      <path d={d} stroke="#fff" strokeWidth={1.4} fill="none" opacity={0.6} strokeDasharray="10 14" strokeDashoffset={-f * 6} />
      {reach >= 1 ? Array.from({ length: 7 }, (_, i) => {
        const t = ((f - at) / 10 + i / 7) % 1;
        const a = -Math.PI / 2 + (i - 3) * 0.38;
        return <circle key={i} cx={x1 + Math.cos(a) * 26 * t} cy={y1 + Math.sin(a) * 22 * t + 30 * t * t} r={2.6 * (1 - t) + 0.6} fill="#8fc4e8" opacity={1 - t} />;
      }) : null}
    </g>
  );
};

/** 모종삽 — 쇠 날(오목하게 빛), 나무 손잡이. 원점 = 날 끝(origin='handle' 이면 손잡이 가운데 — 손에 쥘 때), angle 은 날이 향하는 쪽. soil 이면 날에 흙. */
export const Trowel: React.FC<{ x: number; y: number; angle?: number; scale?: number; at?: number; o?: number; soil?: boolean; origin?: 'tip' | 'handle' }> = ({ x, y, angle = 0, scale = 1, at = DONE, o = 1, soil = false, origin = 'tip' }) => {
  const p = useAppear(at, 10);
  if (p <= 0 || o <= 0) return null;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale * popScale(p)})${origin === 'handle' ? ' translate(156 0)' : ''}`} opacity={p * o} filter="url(#kit-shadow)">
      {/* 날 — 원점이 끝, -x 쪽으로 손잡이 */}
      <path d="M 0 0 C -20 -26, -70 -30, -96 -16 L -96 16 C -70 30, -20 26, 0 0 Z" fill="url(#k2-steel)" stroke="#5f6a73" strokeWidth={1.4} />
      <path d="M -8 0 C -26 -14, -64 -18, -90 -8" stroke="#fff" strokeOpacity={0.75} strokeWidth={2.4} fill="none" />
      <path d="M -10 2 C -30 12, -66 14, -90 8" stroke="#3e464d" strokeOpacity={0.4} strokeWidth={2} fill="none" />
      {soil ? <path d="M -30 -6 C -44 -16, -76 -16, -88 -6 C -78 4, -46 6, -30 -6 Z" fill="url(#kit-soil)" filter="url(#kit-soil-tex)" /> : null}
      <rect x={-118} y={-6} width={26} height={12} rx={3} fill="#7f8b95" />
      <path d={`M -116 -11 L -196 -13 Q -208 0 -196 13 L -116 11 Z`} fill="url(#k2-wood)" filter="url(#k2-woodgrain)" stroke="#5a3920" strokeWidth={1.4} />
      <path d="M -122 -6 L -194 -8" stroke="#fff" strokeOpacity={0.3} strokeWidth={3} />
      <circle cx={-188} cy={0} r={3} fill="#3a2410" />
    </g>
  );
};

/**
 * 물뿌리개 — 몸통·손잡이·긴 꼭지·물뿌리개 머리. 원점 = 몸통 바닥 가운데. tilt(도, +는 앞으로 기울임).
 * pour 를 주면 머리에서 toY 까지 물방울이 흩어져 떨어진다.
 */
export const WateringCan: React.FC<{ x: number; y: number; scale?: number; tilt?: number; at?: number; o?: number; pour?: { at: number; until: number; toY: number } }> = ({ x, y, scale = 1, tilt = 0, at = DONE, o = 1, pour }) => {
  const f = useCurrentFrame();
  const p = useAppear(at, 12);
  if (p <= 0 || o <= 0) return null;
  // 꼭지 머리의 화면 좌표(회전 포함) — 로컬 (150, -150)
  const r = (tilt * Math.PI) / 180, s = scale;
  const hx = x + (150 * Math.cos(r) - -150 * Math.sin(r)) * s, hy = y + (150 * Math.sin(r) + -150 * Math.cos(r)) * s;
  const pouring = pour && f >= pour.at && f <= pour.until + 20;
  return (
    <g opacity={p * o}>
      {tilt === 0 ? <CastShadow cx={x} cy={y} rx={70 * s} ry={9 * s} /> : null}
      <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s * popScale(p)})`} filter="url(#kit-shadow)">
        {/* 꼭지 */}
        <path d="M 50 -60 L 140 -142 L 150 -132 L 62 -40 Z" fill="url(#k2-can)" stroke="#2c4a24" strokeWidth={1.4} />
        <ellipse cx={150} cy={-150} rx={16} ry={9} fill="#5f8f4f" stroke="#2c4a24" strokeWidth={1.4} transform="rotate(45 150 -150)" />
        <ellipse cx={153} cy={-153} rx={12} ry={6} fill="#c9d1d7" transform="rotate(45 153 -153)" />
        {[[-4, 0], [0, -3], [4, 0], [0, 3]].map(([dx, dy], i) => <circle key={i} cx={153 + dx!} cy={-153 + dy!} r={1} fill="#4a4f57" />)}
        {/* 몸통 */}
        <path d="M -70 -110 L 70 -110 L 66 0 L -66 0 Z" fill="url(#k2-can)" stroke="#2c4a24" strokeWidth={1.6} />
        <ellipse cx={0} cy={-110} rx={70} ry={12} fill="#7fae6c" stroke="#2c4a24" strokeWidth={1.4} />
        <ellipse cx={-10} cy={-112} rx={36} ry={6} fill="#2a3a24" />
        {[-80, -40].map((yy) => <path key={yy} d={`M -68 ${yy} Q 0 ${yy + 8} 68 ${yy}`} stroke="#2c4a24" strokeWidth={2} fill="none" opacity={0.5} />)}
        <path d="M -52 -100 L -50 -8" stroke="#fff" strokeOpacity={0.3} strokeWidth={10} strokeLinecap="round" />
        {/* 손잡이 */}
        <path d="M -60 -112 Q -40 -170 30 -150 Q 60 -140 56 -112" stroke="#4f7e40" strokeWidth={12} fill="none" strokeLinecap="round" />
        <path d="M -60 -112 Q -40 -170 30 -150" stroke="#a8d08f" strokeWidth={3} fill="none" opacity={0.6} />
        <path d="M -70 -90 Q -104 -70 -68 -20" stroke="#4f7e40" strokeWidth={11} fill="none" strokeLinecap="round" />
      </g>
      {pouring ? (
        <g>
          {Array.from({ length: 22 }, (_, i) => {
            const t = ((f - pour!.at) / 16 + random(`wc${i}`)) % 1;
            if (f > pour!.until && t < (f - pour!.until) / 16) return null;
            const spread = (random(`wcs${i}`) - 0.5) * 0.9;
            const dist = (pour!.toY - hy);
            const xx = hx + 14 * s + spread * dist * 0.35 * t + t * 20;
            const yy = hy + 8 + dist * t * t;
            return <ellipse key={i} cx={xx} cy={yy} rx={2} ry={5} fill="url(#k2-drop)" opacity={0.85} />;
          })}
        </g>
      ) : null}
    </g>
  );
};

/** 뿌린 비료 — 위에서 떨어져 표면(y)에 흩어져 놓인다. x 를 가운데로 w 폭. kind: granule(흰 알갱이)·pellet(갈색 덩이). */
export const Fertilizer: React.FC<{ x: number; y: number; w?: number; n?: number; at?: number; kind?: 'granule' | 'pellet'; color?: string; drop?: number }> = ({ x, y, w = 160, n = 30, at = DONE, kind = 'granule', color, drop = 120 }) => {
  const f = useCurrentFrame();
  const col = color ?? (kind === 'granule' ? '#eef0ea' : '#8a6a3c');
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const t0 = at + random(`fz${i}`) * 14;
        const t = interpolate(f, [t0, t0 + 12], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
        if (t <= 0) return null;
        const gx = x + (random(`fzx${i}`) - 0.5) * w;
        const gy = y - 2 - random(`fzy${i}`) * 5 - (1 - t) * drop;
        const r = kind === 'granule' ? 3 + random(`fzr${i}`) * 1.6 : 4 + random(`fzr${i}`) * 2;
        return (
          <g key={i}>
            <ellipse cx={gx + 1} cy={gy + 1.6} rx={r} ry={r * 0.7} fill="#000" opacity={0.3 * t} />
            {kind === 'granule' ? <circle cx={gx} cy={gy} r={r} fill={col} stroke="#9aa39a" strokeWidth={0.6} /> : <ellipse cx={gx} cy={gy} rx={r * 1.3} ry={r * 0.8} fill={col} stroke="#4a3518" strokeWidth={0.6} />}
            <circle cx={gx - r * 0.3} cy={gy - r * 0.3} r={r * 0.35} fill="#fff" opacity={0.8} />
          </g>
        );
      })}
    </g>
  );
};

/** 덮개층(멀칭) — 표면 y 위에 x0→x1 로 깔리며 두께 thick. kind: bark(나무껍질 조각)·straw(짚)·wood(잘게 부순 나무). */
export const Mulch: React.FC<{ x0: number; x1: number; y: number; thick?: number; kind?: 'bark' | 'straw' | 'wood'; at?: number; dur?: number; seed?: string }> = ({ x0, x1, y, thick = 18, kind = 'bark', at = DONE, dur = 24, seed = 'mu' }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  if (p <= 0) return null;
  const xe = x0 + (x1 - x0) * p;
  const n = Math.round(((x1 - x0) / 9) * (thick / 18));
  const cols = kind === 'straw' ? ['#e8cb85', '#d4b067', '#f2dca0', '#b8964f'] : kind === 'wood' ? ['#c99a66', '#a8784a', '#e0b984', '#8a5a34'] : ['#7a4a2a', '#5a3520', '#9a6a40', '#4a2a16'];
  return (
    <g>
      <path d={`M ${x0} ${y + 2} Q ${(x0 + xe) / 2} ${y - thick * 0.9} ${xe} ${y + 2} Z`} fill={cols[1]} opacity={0.9} />
      <ellipse cx={(x0 + xe) / 2 + 10} cy={y + 3} rx={(xe - x0) / 2} ry={4} fill="#000" opacity={0.25} filter="url(#kit-blur1)" />
      {Array.from({ length: n }, (_, i) => {
        const u = random(`${seed}x${i}`);
        const cx = x0 + u * (x1 - x0);
        if (cx > xe) return null;
        const hgt = thick * 0.9 * 4 * ((cx - x0) / Math.max(1, xe - x0)) * (1 - (cx - x0) / Math.max(1, xe - x0));
        const cy = y - random(`${seed}y${i}`) * Math.max(2, hgt * 0.8);
        const a = (random(`${seed}a${i}`) - 0.5) * 70;
        const c = cols[i % cols.length]!;
        if (kind === 'straw') return <path key={i} d={`M ${cx - 9} ${cy} l 18 ${(random(`${seed}s${i}`) - 0.5) * 6}`} stroke={c} strokeWidth={2.2} strokeLinecap="round" transform={`rotate(${a * 0.4} ${cx} ${cy})`} />;
        const s = kind === 'wood' ? 4 + random(`${seed}r${i}`) * 3 : 6 + random(`${seed}r${i}`) * 5;
        return (
          <g key={i} transform={`translate(${cx} ${cy}) rotate(${a})`}>
            <path d={`M ${-s} ${-s * 0.35} L ${s * 0.7} ${-s * 0.45} L ${s} ${s * 0.2} L ${-s * 0.5} ${s * 0.4} Z`} fill={c} stroke="#24130a" strokeWidth={0.8} />
            <path d={`M ${-s * 0.7} ${-s * 0.2} L ${s * 0.5} ${-s * 0.3}`} stroke="#fff" strokeOpacity={0.25} strokeWidth={1} />
          </g>
        );
      })}
    </g>
  );
};

/** 지주 — 땅(y)에 박힌 대나무(마디)·나무 막대 h, ties 높이(땅에서 px)마다 8자 끈. 끈은 x+tieTo 쪽 줄기를 감는다. */
export const Stake: React.FC<{ x: number; y: number; h?: number; kind?: 'bamboo' | 'wood'; ties?: number[]; tieTo?: number; at?: number; tieAt?: number; o?: number }> = ({ x, y, h = 240, kind = 'bamboo', ties = [], tieTo = 14, at = DONE, tieAt, o = 1 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const tp = tieAt == null ? 1 : interpolate(f, [tieAt, tieAt + 10], [0, 1], clamp);
  if (p <= 0 || o <= 0) return null;
  const top = y - h;
  const sink = (1 - p) * 40;
  const wTop = kind === 'bamboo' ? 9 : 11;
  return (
    <g opacity={Math.min(1, p * 1.5) * o}>
      <g transform={`translate(0 ${-sink})`}>
        <ellipse cx={x + 16} cy={y + sink + 2} rx={12} ry={3} fill="#000" opacity={0.3} filter="url(#kit-blur1)" />
        <path d={`M ${x - wTop / 2} ${top} L ${x + wTop / 2} ${top} L ${x + wTop / 2 + 1} ${y + sink} L ${x - wTop / 2 - 1} ${y + sink} Z`} fill={kind === 'bamboo' ? 'url(#k2-stake)' : 'url(#k2-wood)'} stroke="#6e5428" strokeWidth={1.2} />
        <path d={`M ${x - wTop / 2 + 2} ${top + 4} L ${x - wTop / 2 + 2} ${y + sink - 4}`} stroke="#fff" strokeOpacity={0.35} strokeWidth={2} />
        {kind === 'bamboo' ? Array.from({ length: Math.floor(h / 60) }, (_, i) => <path key={i} d={`M ${x - wTop / 2 - 1} ${top + 40 + i * 60} q ${wTop / 2 + 1} 4 ${wTop + 2} 0`} stroke="#8a6d3f" strokeWidth={2.2} fill="none" />) : null}
        {/* 땅에 박힌 자리 아래는 흙이 가린다 */}
        <rect x={x - 10} y={y} width={20} height={sink + 4} fill="url(#kit-soil)" />
      </g>
      {ties.map((ty, i) => {
        const yy = y - ty;
        if (tp <= 0) return null;
        return (
          <g key={i} opacity={tp}>
            <path d={`M ${x} ${yy} C ${x + tieTo * 0.5} ${yy - 9}, ${x + tieTo * 0.5} ${yy + 9}, ${x + tieTo} ${yy} C ${x + tieTo * 1.5} ${yy - 9}, ${x + tieTo * 1.5} ${yy + 9}, ${x + tieTo} ${yy} C ${x + tieTo * 0.5} ${yy - 9}, ${x - 8} ${yy + 9}, ${x} ${yy}`} stroke="#3f8a3a" strokeWidth={3.4} fill="none" strokeLinecap="round" />
            <path d={`M ${x - 2} ${yy + 2} l -4 9 M ${x + 1} ${yy + 2} l 2 9`} stroke="#3f8a3a" strokeWidth={2.4} strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
};
