// 스타일 B 땅(2026-10-23 손질) — 투영 그림자(접촉 6B + 문지름 그라데이션), 땅 단면(문지름 바탕 + 깊이 따라 성겨지는 점묘 흙알갱이).
import React from 'react';
import { Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { clamp } from '../stage';
import { snowflakePath, type P } from '../geom';
import { DONE, PB, PLine, TONE } from './pencil';

const f1 = (n: number) => n.toFixed(1);

/**
 * 투영 그림자 — 땅에 선 대상(나무·화분·사람)에 필수. 빛 반대쪽(오른쪽 아래)으로.
 * (x,y) = 땅에 닿는 가운데, w = 닿는 폭, len = 그림자 길이. 닿는 곳이 가장 어둡고 날카롭게(6B 짧은 선), 멀수록 흐리고 밝게(문지름 + 그라데이션).
 */
export const CastShadow: React.FC<{ x: number; y: number; w: number; len: number; o?: number; dy?: number }> = ({ x, y, w, len, o = 1, dy = 0 }) => {
  if (o <= 0) return null;
  const ry = Math.max(5, Math.min(len * 0.07, 22));
  return (
    <g opacity={o}>
      <ellipse cx={x + len * 0.42} cy={y + ry * 0.55 + dy} rx={len * 0.55} ry={ry} fill="url(#b-cast-g)" filter="url(#b-smudge)" />
      <ellipse cx={x + w * 0.2} cy={y + 2 + dy} rx={w * 0.75} ry={Math.max(2.5, ry * 0.3)} fill={PB.smudge} opacity={0.5} filter="url(#b-smudge)" />
      <path d={`M ${f1(x - w * 0.5)} ${f1(y + 1)} Q ${f1(x + w * 0.1)} ${f1(y + 4.5)} ${f1(x + w * 0.65)} ${f1(y + 1)}`} stroke={TONE.B6.color} strokeWidth={2.4} fill="none" strokeLinecap="round" />
    </g>
  );
};

/**
 * 땅 단면 — 지면 y 에서 아래로 depth. 바탕은 문지름 톤(위가 짙고 아래로 옅게), 흙알갱이 점묘는 위(앞)가 촘촘·굵고 깊을수록 성기게.
 * frost(0~1) = 위쪽 언 층(최대 depth 의 45%), frostHi = 언 층 포인트 색. 풀 포기(grass)는 지면 위. children = 단면 안(뿌리 등).
 */
export const GroundSection: React.FC<{ x0: number; x1: number; y: number; depth?: number; frost?: number; frostHi?: number; grass?: boolean; seed?: string; at?: number; o?: number; children?: React.ReactNode }> = ({ x0, x1, y, depth = 220, frost = 0, frostHi = 0, grass = true, seed = 'gs', at = DONE, o = 1, children }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  if (p <= 0 || o <= 0) return null;
  const bottom = y + depth;
  const n = Math.max(8, Math.round((x1 - x0) / 60));
  const edge = Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, bottom + Math.sin(i * 2.1) * 9] as P);
  const body = `M ${x0} ${y} L ${x1} ${y} L ${edge.slice().reverse().map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ')} Z`;
  const fy = y + depth * 0.45 * frost;
  // 점묘 — 깊이 따라 성기게(위 촘촘)
  const N = Math.round((x1 - x0) * depth * 0.0016);
  const dots: string[] = [];
  for (let k = 0; k < N; k++) {
    const u = random(`${seed}u${k}`);
    const dd = Math.pow(random(`${seed}d${k}`), 1.8); // 위쪽에 몰림
    const sx = x0 + u * (x1 - x0), sy = y + 5 + dd * (depth - 10);
    const r = (1 - dd) * 1.7 + 0.7 + random(`${seed}r${k}`) * 0.8;
    dots.push(`M ${f1(sx - r)} ${f1(sy)} a ${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0 a ${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0 Z`);
  }
  return (
    <g opacity={o * p}>
      <path d={body} fill={PB.paper} />
      <path d={body} fill="url(#b-soil-g)" filter="url(#b-smudge)" />
      <path d={dots.join(' ')} fill={PB.lead2} opacity={0.55} />
      {frost > 0 ? (
        <g>
          <path d={`M ${x0} ${y} L ${x1} ${y} L ${x1} ${fy} L ${x0} ${fy} Z`} fill={frostHi > 0 ? PB.accentWash : PB.paper} opacity={frostHi > 0 ? 0.35 + 0.4 * frostHi : 0.55} />
          {Array.from({ length: Math.round((x1 - x0) / 120) }, (_, i) => <path key={i} d={snowflakePath(x0 + 60 + i * 120, (y + fy) / 2 + (i % 2 ? 6 : -6), Math.min(18, (fy - y) * 0.32))} stroke={frostHi > 0.5 ? PB.accent : PB.lead} strokeWidth={1.4} fill="none" opacity={0.8} />)}
          <PLine d={`M ${x0} ${fy} L ${x1} ${fy}`} w={1.4} dash="10 7" color={frostHi > 0.5 ? PB.accent : PB.lead} />
        </g>
      ) : null}
      <PLine d={`M ${edge.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ')}`} w={1.1} tone="light" double={false} />
      {children}
      <PLine d={`M ${x0} ${y} L ${x1} ${y}`} w={TONE.B2.w * 0.85} seed={`${seed}top`} />
      {grass ? Array.from({ length: Math.round((x1 - x0) / 46) }, (_, i) => {
        const gx = x0 + 20 + i * 46 + ((i * 17) % 11);
        return <PLine key={i} d={`M ${gx - 8} ${y} q 2 -14 -4 -22 M ${gx} ${y} q 1 -18 4 -26 M ${gx + 7} ${y} q 3 -10 9 -16`} w={1.2} o={0.8} double={false} />;
      }) : null}
    </g>
  );
};
