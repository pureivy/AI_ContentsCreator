// 롱폼 도해 공통 부품 — 선이 그려지는 Draw, 테두리 글자 Label, 배지, 화살표, 지시선.
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { evolvePath } from '@remotion/paths';
import { ACCENT, INK, LEAF } from './InfoPanel';

export const WOOD = '#b98a5a';
export const GREY = '#9a958c';
export const RED = '#e8735f';
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export function useProgress(delay: number, dur = 18): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [delay, delay + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
}

export const Draw: React.FC<{ d: string; at: number; dur?: number; color?: string; width?: number; dash?: boolean; cap?: 'round' | 'butt' }> = ({ d, at, dur = 18, color = WOOD, width = 14, dash, cap = 'round' }) => {
  const p = useProgress(at, dur);
  if (p <= 0) return null;
  if (dash) return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeDasharray="14 12" strokeLinecap="butt" opacity={p} />;
  const { strokeDasharray, strokeDashoffset } = evolvePath(p, d);
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} />;
};

export const Label: React.FC<{ x: number; y: number; at: number; children: string; color?: string; size?: number; anchor?: 'start' | 'middle' | 'end'; weight?: number }> = ({ x, y, at, children, color = INK, size = 38, anchor = 'middle', weight = 800 }) => {
  const p = useProgress(at, 10);
  // 밝은 장면 배경에서도 읽히게 어두운 테두리(paint-order: stroke 먼저).
  return <text x={x} y={y + (1 - p) * 12} fill={color} fontSize={size} fontWeight={weight} textAnchor={anchor} opacity={p}
    stroke="#14130f" strokeOpacity={0.85} strokeWidth={size * 0.12} strokeLinejoin="round" paintOrder="stroke">{children}</text>;
};

/** 동그라미 배지(✓/✗) — 톡 튀어나온다. */
export const Badge: React.FC<{ x: number; y: number; at: number; ok: boolean }> = ({ x, y, at, ok }) => {
  const p = useProgress(at, 8);
  const s = interpolate(p, [0, 0.7, 1], [0, 1.15, 1]);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle r={34} fill={ok ? LEAF : RED} />
      <path d={ok ? 'M -14 2 L -4 12 L 16 -10' : 'M -12 -12 L 12 12 M 12 -12 L -12 12'} stroke="#14130f" strokeWidth={8} fill="none" strokeLinecap="round" />
    </g>
  );
};

export const Arrow: React.FC<{ d: string; at: number; color?: string; head: [number, number, number] }> = ({ d, at, color = ACCENT, head }) => {
  const p = useProgress(at + 14, 6);
  const [x, y, deg] = head;
  return (
    <g>
      <Draw d={d} at={at} color={color} width={8} />
      <path d="M -18 -12 L 0 0 L -18 12" transform={`translate(${x} ${y}) rotate(${deg})`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" opacity={p} />
    </g>
  );
};

export const Scissors: React.FC<{ x: number; y: number; at: number; color?: string }> = ({ x, y, at, color = RED }) => {
  const p = useProgress(at, 8);
  return <text x={x} y={y} fontSize={46} fill={color} textAnchor="middle" opacity={p}>✂</text>;
};

/** 지시선 설명 — 대상 점에서 글자까지 선이 그려진다. */
export const Callout: React.FC<{ x: number; y: number; tx: number; ty: number; at: number; color?: string; children: string }> = ({ x, y, tx, ty, at, color = INK, children }) => (
  <>
    <circle cx={x} cy={y} r={7} fill={color} opacity={useProgress(at, 6)} />
    <Draw d={`M ${x} ${y} L ${tx + (tx < x ? 10 : -10)} ${ty - 10}`} at={at + 2} color={color} width={3} />
    <Label x={tx} y={ty} at={at + 10} color={color} size={28} anchor={tx < x ? 'end' : 'start'} weight={700}>{children}</Label>
  </>
);

