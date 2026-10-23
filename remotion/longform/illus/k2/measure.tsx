// 재기 — Ruler(줄자·자), DimensionLine(치수선), Gauge(pH·온도·수분 계기), RangeBar(눈금 막대 + 알맞은 범위).
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { INK, LEAF } from '../../InfoPanel';
import { DONE, clamp, mixHex, useAppear } from './common';

const TXT = { fontWeight: 800, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const };

/**
 * 줄자(tape)·자(ruler) — 원점 = 0 눈금, angle 방향으로 length(px)만큼. units 칸(예: 30 → 0~30cm), labelEvery 마다 숫자.
 * 줄자는 at 부터 dur 동안 풀려 나온다(extend 로 직접 지정 가능). 마지막 숫자 옆에 unit.
 */
export const Ruler: React.FC<{ x: number; y: number; length: number; units?: number; unit?: string; labelEvery?: number; angle?: number; kind?: 'tape' | 'ruler'; at?: number; dur?: number; extend?: number; o?: number }> = ({ x, y, length, units = 30, unit = 'cm', labelEvery = 10, angle = 0, kind = 'tape', at = DONE, dur = 24, extend, o = 1 }) => {
  const f = useCurrentFrame();
  const show = useAppear(at, 8);
  const e = extend ?? (kind === 'tape' ? interpolate(f, [at + 4, at + 4 + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }) : 1);
  if (show <= 0 || o <= 0) return null;
  const L = length * e;
  const pu = length / units;
  const minor = pu >= 7 ? 1 : pu * 5 >= 7 ? 5 : 10;
  const H = kind === 'tape' ? 30 : 42;
  const nTicks = Math.floor(L / (pu * minor) + 1e-6);
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} opacity={show * o} filter="url(#kit-shadow)">
      {kind === 'tape' ? (
        <>
          <rect x={-4} y={-H / 2} width={L + 8} height={H} rx={3} fill="url(#k2-tape)" stroke="#9a7a12" strokeWidth={1.4} />
          <rect x={-4} y={-H / 2 + 2} width={L + 8} height={5} fill="#fff" opacity={0.35} />
        </>
      ) : (
        <>
          <rect x={-14} y={-H / 2} width={length + 28} height={H} rx={5} fill="url(#k2-stake)" stroke="#7f6534" strokeWidth={1.4} filter="url(#k2-woodgrain)" />
          <rect x={-14} y={-H / 2 + 3} width={length + 28} height={6} fill="#fff" opacity={0.3} />
        </>
      )}
      {Array.from({ length: nTicks + 1 }, (_, i) => {
        const v = i * minor;
        const big = v % labelEvery === 0, mid = v % 5 === 0;
        return <path key={i} d={`M ${v * pu} ${-H / 2} l 0 ${big ? H * 0.55 : mid ? H * 0.38 : H * 0.22}`} stroke="#2a1f0c" strokeWidth={big ? 2.4 : 1.2} />;
      })}
      {Array.from({ length: Math.floor(units / labelEvery) + 1 }, (_, i) => i * labelEvery).filter((v) => v > 0 && v * pu <= L + 0.5).map((v) => (
        <text key={v} x={v * pu + (v === units ? -4 : 0)} y={H / 2 - 4} fontSize={H * 0.42} textAnchor={v === units ? 'end' : 'middle'} fill="#2a1f0c" {...TXT}>{v}</text>
      ))}
      {e > 0.98 && unit ? <text x={kind === 'tape' ? length + 18 : length + 20} y={H * 0.18} fontSize={Math.max(22, H * 0.6)} textAnchor="start" fill={INK} stroke="#14130f" strokeWidth={4} {...TXT}>{unit}</text> : null}
      {kind === 'tape' ? (
        <>
          {/* 고리 끝 */}
          <rect x={L + 2} y={-H / 2 - 4} width={6} height={H + 8} rx={2} fill="url(#k2-steel)" stroke="#5f6a73" strokeWidth={1} />
          {/* 몸통(케이스) — 0 눈금 왼쪽 */}
          <rect x={-64} y={-34} width={60} height={68} rx={16} fill="#2f3338" />
          <rect x={-60} y={-30} width={52} height={60} rx={13} fill="#c0392b" />
          <circle cx={-34} cy={0} r={13} fill="#8e271c" />
          <ellipse cx={-44} cy={-16} rx={12} ry={6} fill="#fff" opacity={0.3} />
        </>
      ) : null}
    </g>
  );
};

/** 치수선 — 두 점 사이 양쪽 화살표, 끝 표시, 가운데 값 글자(가로로 읽힘). at 부터 가운데서 양쪽으로 뻗는다. */
export const DimensionLine: React.FC<{ x1: number; y1: number; x2: number; y2: number; text?: string; at?: number; color?: string; size?: number; textSide?: 1 | -1 }> = ({ x1, y1, x2, y2, text, at = DONE, color = INK, size = 30, textSide = -1 }) => {
  const p = useAppear(at, 14);
  const tp = useAppear(at + 8, 10);
  if (p <= 0) return null;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const ax = mx + (x1 - mx) * p, ay = my + (y1 - my) * p, bx = mx + (x2 - mx) * p, by = my + (y2 - my) * p;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const head = (hx: number, hy: number, a: number) => { const d = `M ${hx + Math.cos(a + 0.42) * 22} ${hy + Math.sin(a + 0.42) * 22} L ${hx} ${hy} L ${hx + Math.cos(a - 0.42) * 22} ${hy + Math.sin(a - 0.42) * 22}`; return <g><path d={d} stroke="#14130f" strokeOpacity={0.6} strokeWidth={9} fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d={d} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>; };
  const vertical = Math.abs(Math.sin(ang)) > 0.7;
  const tx = mx + (vertical ? 18 * -textSide : nx * 26 * textSide), ty = my + (vertical ? size * 0.35 : ny * 26 * textSide + (textSide < 0 ? 0 : size * 0.7));
  return (
    <g>
      <g stroke="#14130f" strokeOpacity={0.6} strokeWidth={8} strokeLinecap="round"><path d={`M ${ax} ${ay} L ${bx} ${by}`} /></g>
      <path d={`M ${ax} ${ay} L ${bx} ${by}`} stroke={color} strokeWidth={4} strokeLinecap="round" />
      {[[x1, y1], [x2, y2]].map(([ex, ey], i) => <path key={i} d={`M ${ex! + nx * 14} ${ey! + ny * 14} L ${ex! - nx * 14} ${ey! - ny * 14}`} stroke={color} strokeWidth={3} opacity={p} />)}
      {p > 0.9 ? <>{head(ax, ay, ang)}{head(bx, by, ang + Math.PI)}</> : null}
      {text ? <text x={tx} y={ty} fontSize={size} textAnchor={vertical ? (textSide < 0 ? 'start' : 'end') : 'middle'} fill={color} opacity={tp} stroke="#14130f" strokeOpacity={0.85} strokeWidth={size * 0.12} {...TXT}>{text}</text> : null}
    </g>
  );
};

export type GaugeKind = 'ph' | 'temp' | 'moisture';
const GAUGE: Record<GaugeKind, { min: number; max: number; nums: number[]; cols: string[]; unit: string }> = {
  ph: { min: 3, max: 9, nums: [4, 5, 6, 7, 8], cols: ['#d9473a', '#f2a43a', '#e9d34a', '#7cb35a', '#3f8f8c', '#4a5fb8'], unit: 'pH' },
  temp: { min: -10, max: 40, nums: [0, 20, 40], cols: ['#4a78b8', '#6fa8d8', '#7cb35a', '#f2c03a', '#e9773a', '#d9473a'], unit: '°C' },
  moisture: { min: 1, max: 10, nums: [1, 5, 10], cols: ['#b5834f', '#c9a36a', '#9cbf6a', '#5fa37a', '#4a8fc0', '#3b6fa8'], unit: '' },
};

/**
 * 둥근 계기 — kind 별 눈금·색 띠, 바늘이 from(기본 최솟값)에서 value 로 흔들리며 선다(at 부터 dur).
 * probe(px) > 0 이면 아래로 탐침(pH·수분: 쇠막대 두 개, 온도: 막대 하나)을 그린다 — 흙에 꽂는 그림.
 */
export const Gauge: React.FC<{ x: number; y: number; kind?: GaugeKind; value: number; from?: number; at?: number; dur?: number; r?: number; probe?: number; o?: number }> = ({ x, y, kind = 'ph', value, from, at = DONE, dur = 30, r = 56, probe = 0, o = 1 }) => {
  const f = useCurrentFrame();
  const show = useAppear(at, 10);
  if (show <= 0 || o <= 0) return null;
  const G = GAUGE[kind];
  const A = 120; // 바늘이 쓰는 반각(도)
  const angOf = (v: number) => -A + ((Math.max(G.min, Math.min(G.max, v)) - G.min) / (G.max - G.min)) * 2 * A;
  const t = interpolate(f, [at + 6, at + 6 + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const wob = Math.sin((f - at) / 2.3) * 9 * (1 - t) * (t > 0 ? 1 : 0);
  const needle = angOf(from ?? G.min) + (angOf(value) - angOf(from ?? G.min)) * t + wob;
  const pol = (deg: number, rr: number) => [x + Math.sin((deg * Math.PI) / 180) * rr, y - Math.cos((deg * Math.PI) / 180) * rr] as const;
  const seg = 18;
  const rb = r * 0.74;
  return (
    <g opacity={show * o}>
      {/* 탐침 — 곧은 선에는 그라디언트가 안 먹으므로(폭 0 상자) 면으로 그린다: 빛 쪽 밝은 줄 + 그늘 줄 */}
      {probe > 0 ? (kind === 'temp' ? [0] : [-1, 1]).map((s) => {
        const px = x + s * r * 0.22, w = kind === 'temp' ? 8 : 6, y0 = y + r * 0.8, y1 = y0 + probe;
        return (
          <g key={s}>
            <path d={`M ${px - w / 2} ${y0} L ${px + w / 2} ${y0} L ${px + w / 2} ${y1 - w} L ${px} ${y1} L ${px - w / 2} ${y1 - w} Z`} fill="#9aa5ad" stroke="#4f5961" strokeWidth={1} />
            <path d={`M ${px - w * 0.2} ${y0 + 2} L ${px - w * 0.2} ${y1 - w}`} stroke="#f4f7f9" strokeWidth={w * 0.3} opacity={0.8} />
          </g>
        );
      }) : null}
      <g filter="url(#kit-shadow)">
        <circle cx={x} cy={y} r={r} fill="#2a2d31" />
        <circle cx={x} cy={y} r={r} fill="url(#k2-ball)" opacity={0.6} />
        <circle cx={x} cy={y} r={r * 0.86} fill="#f6f1e2" />
        <circle cx={x} cy={y} r={r * 0.86} fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={r * 0.06} />
        {Array.from({ length: seg }, (_, i) => {
          const a0 = -A + (2 * A * i) / seg, a1 = -A + (2 * A * (i + 1)) / seg + 0.6;
          const u = (i + 0.5) / seg * (G.cols.length - 1);
          const c = mixHex(G.cols[Math.floor(u)]!, G.cols[Math.min(G.cols.length - 1, Math.floor(u) + 1)]!, u - Math.floor(u));
          const [sx, sy] = pol(a0, rb), [ex, ey] = pol(a1, rb);
          return <path key={i} d={`M ${sx} ${sy} A ${rb} ${rb} 0 0 1 ${ex} ${ey}`} stroke={c} strokeWidth={r * 0.13} fill="none" />;
        })}
        {G.nums.map((v) => {
          const [tx, ty] = pol(angOf(v), r * 0.5);
          const [k0x, k0y] = pol(angOf(v), r * 0.62), [k1x, k1y] = pol(angOf(v), r * 0.68);
          return <g key={v}><path d={`M ${k0x} ${k0y} L ${k1x} ${k1y}`} stroke="#2a2a2a" strokeWidth={2} /><text x={tx} y={ty + r * 0.08} fontSize={r * 0.2} textAnchor="middle" fill="#2a2a2a" {...TXT}>{v}</text></g>;
        })}
        {G.unit ? <text x={x} y={y + r * 0.52} fontSize={r * 0.2} textAnchor="middle" fill="#555" {...TXT}>{G.unit}</text> : null}
        <g transform={`rotate(${needle} ${x} ${y})`}>
          <path d={`M ${x - r * 0.04} ${y + r * 0.12} L ${x} ${y - r * 0.78} L ${x + r * 0.04} ${y + r * 0.12} Z`} fill="#1a1a1a" />
        </g>
        <circle cx={x} cy={y} r={r * 0.1} fill="#c0392b" stroke="#6b1f16" strokeWidth={1.5} />
        <ellipse cx={x - r * 0.3} cy={y - r * 0.45} rx={r * 0.35} ry={r * 0.14} fill="#fff" opacity={0.4} transform={`rotate(-25 ${x - r * 0.3} ${y - r * 0.45})`} />
      </g>
    </g>
  );
};

/**
 * 눈금 막대 — min~max 를 step 마다 숫자로, lo~hi 범위를 초록 테두리로 빛나게(가운데서 넓어진다).
 * orient 'v' 면 아래가 min. kind 로 색 띠(ph·temp·moisture) 또는 plain.
 */
export const RangeBar: React.FC<{ x: number; y: number; length?: number; min: number; max: number; lo: number; hi: number; step?: number; orient?: 'h' | 'v'; kind?: GaugeKind | 'plain'; unit?: string; at?: number; dur?: number; thickness?: number; o?: number }> = ({ x, y, length = 420, min, max, lo, hi, step = 1, orient = 'h', kind = 'plain', unit, at = DONE, dur = 18, thickness = 26, o = 1 }) => {
  const show = useAppear(at, 12);
  const band = useAppear(at + 14, dur);
  if (show <= 0 || o <= 0) return null;
  const pos = (v: number) => ((v - min) / (max - min)) * length;
  const grad = kind === 'ph' ? 'url(#k2-ph)' : kind === 'temp' ? 'url(#k2-temp)' : kind === 'moisture' ? 'url(#k2-moist)' : '#d8cfbd';
  const t = thickness;
  const c = (pos(lo) + pos(hi)) / 2, half = ((pos(hi) - pos(lo)) / 2) * band;
  const nums: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) nums.push(Math.round(v * 100) / 100);
  // 로컬 좌표: 막대는 +x 로 길다. 세로면 -90° 돌려 아래가 min.
  const tr = orient === 'h' ? `translate(${x} ${y})` : `translate(${x} ${y + length}) rotate(-90)`;
  return (
    <g opacity={show * o}>
      <g transform={tr} filter="url(#kit-shadow)">
        <rect x={-8} y={-t / 2 - 6} width={length + 16} height={t + 12} rx={(t + 12) / 2} fill="#2f3338" />
        <rect x={0} y={-t / 2} width={length} height={t} rx={t / 2} fill={grad} />
        <rect x={0} y={-t / 2 + 2} width={length} height={t * 0.25} rx={t * 0.12} fill="#fff" opacity={0.3} />
        {nums.map((v) => <path key={v} d={`M ${pos(v)} ${t / 2 + 6} l 0 10`} stroke={INK} strokeWidth={3} />)}
        {band > 0 ? (
          <g>
            <rect x={c - half - 6} y={-t / 2 - 12} width={half * 2 + 12} height={t + 24} rx={12} fill={LEAF} opacity={0.22} />
            <rect x={c - half - 6} y={-t / 2 - 12} width={half * 2 + 12} height={t + 24} rx={12} fill="none" stroke={LEAF} strokeWidth={6} />
          </g>
        ) : null}
      </g>
      {nums.map((v) => {
        const tx = orient === 'h' ? x + pos(v) : x + t / 2 + 22;
        const ty = orient === 'h' ? y + t / 2 + 46 : y + length - pos(v) + 10;
        return <text key={v} x={tx} y={ty} fontSize={26} textAnchor={orient === 'h' ? 'middle' : 'start'} fill={INK} stroke="#14130f" strokeWidth={4} {...TXT}>{v}</text>;
      })}
      {unit ? <text x={orient === 'h' ? x + length + 22 : x} y={orient === 'h' ? y + 10 : y - 30} fontSize={24} textAnchor={orient === 'h' ? 'start' : 'middle'} fill={INK} stroke="#14130f" strokeWidth={4} {...TXT}>{unit}</text> : null}
    </g>
  );
};
