// 스타일 B 연필 기본 도구(2026-10-23 손질 — kit.tsx 에서 떼어 냄). 흑연 세 톤(진·중·연), 두 번 그은 선, 끊긴 덧선, 종이 가림, 빗금.
// 손·나무 부품(hand.tsx·tree.tsx)과 키트(kit.tsx)가 함께 쓴다.
import React from 'react';
import { Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { clamp } from '../stage';
import { hatchLines } from '../geom';

/**
 * 색 — 연필 3단 톤(이 셋만 쓴다. 9단계 같은 잔 톤 금지):
 *  H(soft)  = 구조선·먼 대상·뒷선·밝은 중간 톤 해칭
 *  2B(lead) = 윤곽 · lead2 = 2B 해칭(짙은 중간 톤·반사광)
 *  6B(dark) = 가장 앞 강조선·핵심 그림자 크로스해칭·접촉 그림자
 * + 포인트 색 하나(accent).
 */
export const PB = {
  paper: '#f5f2ea', lead: '#262524', lead2: '#4a4845', soft: '#8f8b84', dark: '#101011', accent: '#e0523a', accentWash: '#ef8f73', smudge: '#5d5952',
} as const;

/** 연필 3단(색·선 굵기 px) — 상수로 고정. hatch = 그 톤의 해칭 굵기. */
export const TONE = {
  H: { color: PB.soft, w: 1.0, hatch: 0.9 },
  B2: { color: PB.lead, w: 2.6, hatch: 1.0 },
  B6: { color: PB.dark, w: 3.4, hatch: 1.2 },
} as const;

/** 선 굵기 단계(px, 화면 기준) — 윤곽·안쪽·빗금. */
export const LW = { contour: TONE.B2.w, inner: 1.5, hatch: TONE.B2.hatch } as const;

export const DONE = -999;

export function useP(at: number, dur = 16): number {
  const f = useCurrentFrame();
  return interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
}

export type ToneName = 'dark' | 'mid' | 'light';
export const toneColor = (t: ToneName | undefined, fallback: string = PB.lead): string => (t === 'mid' ? PB.lead2 : t === 'light' ? PB.soft : t === 'dark' ? PB.lead : fallback);

/** 명암 해칭 세 층(H·2B·6B)을 그린다 — shade.ts 의 cylShade·sphereShade 결과. */
export const ShadeLayers: React.FC<{ s: { h: string; b2: string; b6: string }; o?: number; o6?: number; k?: number }> = ({ s, o = 1, o6, k = 1 }) => (o <= 0 ? null : (
  <g>
    {s.h ? <path d={s.h} fill="none" stroke={TONE.H.color} strokeWidth={TONE.H.hatch / k} strokeLinecap="round" opacity={0.95 * o} /> : null}
    {s.b2 ? <path d={s.b2} fill="none" stroke={PB.lead2} strokeWidth={TONE.B2.hatch / k} strokeLinecap="round" opacity={0.85 * o} /> : null}
    {s.b6 && (o6 ?? o) > 0 ? <path d={s.b6} fill="none" stroke={TONE.B6.color} strokeWidth={TONE.B6.hatch / k} strokeLinecap="round" opacity={0.8 * (o6 ?? o)} /> : null}
  </g>
));

/**
 * 연필 선 — 진한 한 줄 + 살짝 어긋난 끊긴 덧선(연필을 두 번 댄 듯). p 만큼 그어진다(덧선은 다 그은 뒤 스며 나온다).
 * tone 으로 세 톤을 고른다(color 가 있으면 그 색). broken=false 면 덧선도 끊지 않는다.
 */
export const PLine: React.FC<{ d: string; w?: number; p?: number; color?: string; tone?: ToneName; o?: number; seed?: string; dash?: string; double?: boolean; broken?: boolean; nonScaling?: boolean }> = ({ d, w = 2.6, p = 1, color, tone, o = 1, seed = 'pl', dash, double = true, broken = true, nonScaling = false }) => {
  if (p <= 0 || o <= 0) return null;
  const c = color ?? toneColor(tone);
  const dx = (random(`${seed}dx`) - 0.5) * 2.2, dy = (random(`${seed}dy`) - 0.5) * 2.2;
  const prog = dash ? { strokeDasharray: dash } : p < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - p } : {};
  const ve = nonScaling ? { vectorEffect: 'non-scaling-stroke' as const } : {};
  const ghostO = interpolate(p, [0.85, 1], [0, 0.5], clamp);
  const gap = 0.012 + random(`${seed}g`) * 0.01;
  const ghostDash = broken && !dash ? { pathLength: 1, strokeDasharray: `${0.29 - gap} ${gap} ${0.21} ${gap * 0.7} ${0.33} ${gap}`, strokeDashoffset: random(`${seed}o`) } : dash ? { strokeDasharray: dash } : {};
  return (
    <g opacity={o}>
      <path d={d} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={0.94} {...prog} {...ve} />
      {double && ghostO > 0 ? <path d={d} fill="none" stroke={c} strokeWidth={w * 0.55} strokeLinecap="round" opacity={ghostO} transform={`translate(${dx} ${dy})`} {...ghostDash} {...ve} /> : null}
    </g>
  );
};

/** 손 빗금 — 모양 d 안을 jitter 된 평행선으로(clip), 그늘 쪽만(mask). cross 면 반대 각도 한 겹 더(짙은 그늘). */
export const PHatch: React.FC<{ id: string; d: string; box: { x0: number; y0: number; x1: number; y1: number }; angle?: number; spacing?: number; side?: 'r' | 'br' | 'b' | 'all'; o?: number; p?: number; color?: string; w?: number; cross?: boolean }> = ({ id, d, box, angle = 50, spacing = 9, side = 'r', o = 0.75, p = 1, color = PB.lead2, w = 1.3, cross = false }) => {
  if (o <= 0 || p <= 0) return null;
  const lines = hatchLines(box, angle, spacing, id);
  const lines2 = cross ? hatchLines(box, angle - 95, spacing * 1.25, `${id}x`) : '';
  const m = side === 'all' ? {} : { mask: `url(#b-m-${side})` };
  return (
    <g>
      <defs><clipPath id={`bh-${id}`}><path d={d} /></clipPath></defs>
      <g clipPath={`url(#bh-${id})`} opacity={o}>
        <path d={lines} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" {...m} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} />
        {cross ? <path d={lines2} fill="none" stroke={color} strokeWidth={w * 0.85} strokeLinecap="round" mask="url(#b-m-br2)" opacity={0.8} /> : null}
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
export const Occlude: React.FC<{ d: string; o?: number }> = ({ d, o = 1 }) => <path d={d} fill={PB.paper} opacity={o} />;
