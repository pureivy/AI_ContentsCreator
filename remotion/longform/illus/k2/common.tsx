// 키트 2 공통 — 나타남(톡), 그림자, 색 섞기. 빛은 왼쪽 위 → 그림자는 오른쪽 아래.
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
/** 이미 다 그려진 상태로 시작(at 에 넣는다). */
export const DONE = -999;

/** 나타남 진행값 0~1(ease-out). */
export function useAppear(at = 0, dur = 12): number {
  const f = useCurrentFrame();
  return interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
}

/** 톡 튀어나오는 크기(0 → 1.06 → 1). */
export const popScale = (p: number) => interpolate(p, [0, 0.7, 1], [0.85, 1.04, 1], clamp);

/** 바닥 그림자 — 빛이 왼쪽 위라 오른쪽으로 번진다. */
export const CastShadow: React.FC<{ cx: number; cy: number; rx: number; ry: number; o?: number }> = ({ cx, cy, rx, ry, o = 0.32 }) => (
  <g>
    <ellipse cx={cx + rx * 0.22} cy={cy + ry * 0.2} rx={rx * 1.05} ry={ry} fill="#0b0805" opacity={o} filter="url(#kit-soft)" />
    <ellipse cx={cx + rx * 0.04} cy={cy} rx={rx * 0.86} ry={Math.max(2, ry * 0.45)} fill="#0b0805" opacity={o * 0.9} filter="url(#kit-blur1)" />
  </g>
);

/** #rrggbb 두 색 섞기. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** 시드 문자열 정리 — clipPath id 에 쓸 수 있게. */
export const safeId = (s: string) => s.replace(/[^0-9a-zA-Z_-]/g, '_');
