// 손 — 옆(엄지 쪽)에서 본 오른손. 원점 = 손목, 손가락은 +x(angle 방향)로 향한다.
// 손가락은 마디 세 개(엄지 두 개)를 이은 가늘어지는 몸통 — 자세별 굽힘 각도 표로 만든다. 장갑(가죽) 또는 맨손.
import React from 'react';
import { taperOutline, type P } from '../geom';
import { DONE, useAppear } from './common';

export type HandPose = 'hold' | 'pinch' | 'open' | 'pour' | 'point';

/** 자세별 [밑마디, 가운데마디, 끝마디] 굽힘(도, +가 손바닥 쪽). 손가락 순서 = 검지·중지·약지·새끼, 엄지 = [밑, 끝]. */
const POSES: Record<HandPose, { f: Array<[number, number, number]>; thumb: [number, number]; grip: P }> = {
  open: { f: [[-6, 4, 4], [2, 4, 4], [8, 5, 5], [14, 6, 6]], thumb: [-26, -4], grip: [70, -4] },
  hold: { f: [[32, 42, 30], [38, 44, 32], [44, 46, 34], [50, 46, 34]], thumb: [-8, 26], grip: [64, 8] },
  pour: { f: [[58, 70, 50], [64, 72, 52], [70, 74, 52], [74, 74, 52]], thumb: [12, 40], grip: [56, 14] },
  pinch: { f: [[26, 38, 24], [62, 76, 58], [72, 80, 60], [78, 80, 60]], thumb: [-20, 38], grip: [72, -2] },
  point: { f: [[-2, 2, 2], [74, 86, 66], [80, 88, 66], [84, 88, 64]], thumb: [18, 46], grip: [104, -6] },
};
/** 손가락 마디 길이(검지·중지·약지·새끼). */
const SEG: Array<[number, number, number]> = [[24, 15, 12], [27, 17, 13], [25, 16, 12], [20, 12, 10]];
const KNUCKLE_Y = [-11, -4, 3, 9];

/** 자세의 쥐는 점(손 좌표, scale 1) — 들고 있는 물건을 여기에 둔다. */
export const HAND_GRIP = Object.fromEntries(Object.entries(POSES).map(([k, v]) => [k, v.grip])) as Record<HandPose, P>;

/** 손이 쥔 점의 화면 좌표 — 들고 있는 물건(모종삽 손잡이 등)을 여기에 둔다. Hand 와 같은 props 를 넘긴다. */
export function handGrip(x: number, y: number, angle = 0, pose: HandPose = 'hold', scale = 1, side: 'left' | 'right' = 'right'): P {
  const [gx, gy0] = POSES[pose].grip;
  const gy = side === 'left' ? -gy0 : gy0;
  const r = (angle * Math.PI) / 180;
  return [x + (gx * Math.cos(r) - gy * Math.sin(r)) * scale, y + (gx * Math.sin(r) + gy * Math.cos(r)) * scale];
}

function chain(base: P, a0: number, lens: number[], bends: number[]): P[] {
  const pts: P[] = [base];
  let a = a0;
  lens.forEach((l, i) => {
    a += (bends[i]! * Math.PI) / 180;
    const [px, py] = pts[pts.length - 1]!;
    pts.push([px + Math.cos(a) * l, py + Math.sin(a) * l]);
  });
  return pts;
}

/** 손(정교판). glove=false 면 맨손(손톱·소매). side='left' 는 손 축을 기준으로 뒤집는다(오른쪽에서 왼쪽을 향하는 손은 angle 180 + side 'left' 로 엄지가 위에 오게). */
export const Hand: React.FC<{ x: number; y: number; angle?: number; pose?: HandPose; glove?: boolean; side?: 'left' | 'right'; scale?: number; at?: number; o?: number; arm?: number }> = ({ x, y, angle = 0, pose = 'open', glove = true, side = 'right', scale = 1, at = DONE, o = 1, arm = 70 }) => {
  const p = useAppear(at, 10);
  if (p <= 0 || o <= 0) return null;
  const P0 = POSES[pose];
  const k = glove ? 1.14 : 1;
  const fill = glove ? 'url(#k2-glove)' : 'url(#k2-skin)';
  const dark = glove ? '#6b4220' : '#a8704f';
  const back = glove ? '#8e5d33' : '#c98f6b';
  const fingers = SEG.map((lens, i) => {
    const [b0, b1, b2] = P0.f[i]!;
    const base: P = [48 - i * 1.5, KNUCKLE_Y[i]!];
    const pts = chain(base, 0, lens, [b0, b1, b2]);
    const w0 = (i === 3 ? 10.5 : 12.5) * k;
    return { pts, w0, w1: w0 * 0.78, i };
  });
  const thumb = chain([12, -8], -0.5, [22, 17], P0.thumb);
  const palm = `M -2 -14 C 12 -19, 30 -18, 42 -16 Q 52 -15 54 -8 C 57 0, 55 8, 48 14 C 34 19, 12 18, -2 13 Z`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale} ${scale * (side === 'left' ? -1 : 1)})`} opacity={p * o}>
      <g filter="url(#kit-shadow)">
        {/* 팔(소매) — 손목에서 뒤로 */}
        {arm > 0 ? <path d={taperOutline([[-arm, 2], [-arm * 0.45, 1], [2, 0]], 34, 28, 1, 10)} fill="url(#k2-cuff)" /> : null}
        {arm > 0 ? <path d={`M ${-arm * 0.7} -12 q 8 6 0 14`} stroke="#24465f" strokeWidth={2} fill="none" opacity={0.6} /> : null}
        {glove ? <path d={taperOutline([[-14, 0], [6, 0]], 36, 33, 1, 6)} fill="#7a4f27" /> : <path d={taperOutline([[-6, 0], [8, 0]], 25, 25, 1, 6)} fill="url(#k2-skin)" />}
        {glove ? [-10, -5, 0].map((rx) => <path key={rx} d={`M ${rx} -16 L ${rx} 16`} stroke="#5a3519" strokeWidth={1.4} opacity={0.6} />) : null}
        {/* 뒤 손가락(새끼→중지) — 한 톤 어둡게 */}
        {fingers.slice(1).reverse().map(({ pts, w0, w1, i }) => (
          <g key={i}>
            <path d={taperOutline(pts, w0, w1, 1, 16)} fill={back} stroke={dark} strokeWidth={1.1} />
            <path d={taperOutline(pts, w0, w1, 1, 16)} fill="#000" opacity={0.08 * i} />
          </g>
        ))}
        {/* 손등·손바닥 */}
        <path d={palm} fill={fill} stroke={dark} strokeWidth={1.2} transform={glove ? 'scale(1 1.12)' : undefined} />
        <path d="M 6 -10 C 18 -14, 34 -14, 44 -10" stroke="#fff" strokeOpacity={glove ? 0.22 : 0.35} strokeWidth={3} fill="none" strokeLinecap="round" />
        {/* 검지 — 맨 앞 */}
        {(() => { const { pts, w0, w1 } = fingers[0]!; const tip = pts[pts.length - 1]!; const prev = pts[pts.length - 2]!; const ta = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
          return (
            <g>
              <path d={taperOutline(pts, w0, w1, 1, 16)} fill={fill} stroke={dark} strokeWidth={1.2} />
              {pts.slice(1, 3).map(([jx, jy], j) => <path key={j} d={`M ${jx - 2} ${jy - w0 * 0.42} q 2 ${w0 * 0.42} 0 ${w0 * 0.84}`} stroke={dark} strokeWidth={1} fill="none" opacity={0.55} transform={`rotate(${(Math.atan2(pts[j + 2]![1] - jy, pts[j + 2]![0] - jx) * 180) / Math.PI} ${jx} ${jy})`} />)}
              {!glove ? <ellipse cx={tip[0] - Math.cos(ta) * 5} cy={tip[1] - Math.sin(ta) * 5 - 3} rx={5} ry={2.6} fill="#f6d7c4" stroke="#c98f6b" strokeWidth={0.8} transform={`rotate(${(ta * 180) / Math.PI} ${tip[0] - Math.cos(ta) * 5} ${tip[1] - Math.sin(ta) * 5 - 3})`} /> : null}
            </g>
          ); })()}
        {/* 엄지 — 위쪽 가장자리 */}
        <path d={taperOutline(thumb, 19 * k, 12 * k, 1, 12)} fill={fill} stroke={dark} strokeWidth={1.2} />
        {/* 엄지 두덩 — 엄지 밑동을 손등에 둥글게 잇는다 */}
        <ellipse cx={thumb[0]![0] + 3} cy={thumb[0]![1] + 2} rx={13 * k} ry={9 * k} fill={fill} transform={`rotate(${(Math.atan2(thumb[1]![1] - thumb[0]![1], thumb[1]![0] - thumb[0]![0]) * 180) / Math.PI} ${thumb[0]![0] + 3} ${thumb[0]![1] + 2})`} />
        <path d={`M ${thumb[1]![0] - 3} ${thumb[1]![1] - 5} q 3 4 1 9`} stroke={dark} strokeWidth={1} fill="none" opacity={0.5} />
        {!glove ? (() => { const t = thumb[2]!, q = thumb[1]!; const ta = Math.atan2(t[1] - q[1], t[0] - q[0]); const nx = t[0] - Math.cos(ta) * 5, ny = t[1] - Math.sin(ta) * 5;
          return <ellipse cx={nx} cy={ny - 3} rx={5} ry={2.8} fill="#f6d7c4" stroke="#c98f6b" strokeWidth={0.8} transform={`rotate(${(ta * 180) / Math.PI} ${nx} ${ny - 3})`} />; })() : null}
        {glove ? <path d="M 4 4 q 18 4 36 0" stroke="#6b4220" strokeWidth={1.2} strokeDasharray="3 3" fill="none" opacity={0.6} /> : null}
      </g>
    </g>
  );
};
