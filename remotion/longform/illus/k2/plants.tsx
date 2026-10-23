// 식물 — RootBall(감긴 뿌리가 풀린다), Shrub(줄기 여럿 + 잎 + 열매), Seedling(떡잎·본잎), Fruit·Berry.
import React from 'react';
import { random, useCurrentFrame } from 'remotion';
import { evolvePath } from '@remotion/paths';
import { Branch, Leaf, leavesOnTwig, type Canopy, type LeafShape } from '../Kit';
import { pointAt, taperOutline, type P } from '../geom';
import { CastShadow, DONE, popScale, safeId, useAppear } from './common';

/** 둥근 열매 하나(Diagrams3 의 Fruit 를 옮김) — 빨강 기본은 kit-fruit 그라디언트, 다른 색은 단색 + 입체 덧칠. */
export const Fruit: React.FC<{ x: number; y: number; r?: number; at?: number; color?: string; fadeAt?: number }> = ({ x, y, r = 14, at = DONE, color = '#e05a3a', fadeAt }) => {
  const p = useAppear(at, 8) * (fadeAt == null ? 1 : 1 - useAppear(fadeAt, 10));
  if (p <= 0) return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${p})`}>
      <ellipse cx={r * 0.25} cy={r * 0.9} rx={r * 0.8} ry={r * 0.22} fill="#000" opacity={0.18} />
      <circle r={r} fill={color === '#e05a3a' ? 'url(#kit-fruit)' : color} />
      {color === '#e05a3a' ? null : <circle r={r} fill="url(#k2-ball)" />}
      <ellipse cx={-r * 0.35} cy={-r * 0.38} rx={r * 0.28} ry={r * 0.18} fill="#fff" opacity={0.55} />
      <path d={`M 0 ${-r} q 2 -6 6 -8`} stroke="#5a3920" strokeWidth={2} fill="none" />
    </g>
  );
};

/** 열매 송이 — 작은 둥근 알 n 개(블루베리 남색 기본: 흰 가루·꽃받침 왕관). color 를 주면 그 색. */
export const Berry: React.FC<{ x: number; y: number; n?: number; r?: number; color?: string; at?: number; seed?: string; bloom?: boolean }> = ({ x, y, n = 4, r = 8, color, at = DONE, seed = 'b', bloom }) => {
  const p = useAppear(at, 10);
  if (p <= 0) return null;
  const blue = color == null;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const bx = x + (i - (n - 1) / 2) * r * 1.45 + (random(`${seed}x${i}`) - 0.5) * r * 0.6;
        const by = y + (i % 2) * r * 1.05 + random(`${seed}y${i}`) * r * 0.5;
        const rr = r * (0.85 + random(`${seed}r${i}`) * 0.3) * popScale(p) * p;
        return (
          <g key={i}>
            <path d={`M ${x} ${y - r * 1.4} Q ${(x + bx) / 2} ${y - r} ${bx} ${by - rr}`} stroke="#6b5a2a" strokeWidth={1.2} fill="none" opacity={0.8} />
            <circle cx={bx + rr * 0.25} cy={by + rr * 0.35} r={rr} fill="#000" opacity={0.25} filter="url(#kit-blur1)" />
            <circle cx={bx} cy={by} r={rr} fill={blue ? 'url(#k2-berry)' : color} />
            {blue ? null : <circle cx={bx} cy={by} r={rr} fill="url(#k2-ball)" />}
            {(bloom ?? blue) ? <circle cx={bx} cy={by} r={rr} fill="#c9d3ea" opacity={0.22} /> : null}
            {blue ? <path d={`M ${bx - rr * 0.32} ${by + rr * 0.5} l ${rr * 0.16} ${-rr * 0.2} l ${rr * 0.16} ${rr * 0.2} l ${rr * 0.16} ${-rr * 0.2} l ${rr * 0.16} ${rr * 0.2}`} stroke="#1d2340" strokeWidth={1.1} fill="none" /> : null}
            <ellipse cx={bx - rr * 0.35} cy={by - rr * 0.35} rx={rr * 0.28} ry={rr * 0.18} fill="#fff" opacity={0.5} />
          </g>
        );
      })}
    </g>
  );
};

/**
 * 뿌리 덩이 — 포트 모양 흙덩이에 흰 뿌리가 빙빙 감겨 있다. loosen(0~1)만큼 감긴 뿌리가 풀려 바깥으로 뻗는다.
 * 원점 = 덩이 윗면 가운데(뿌리목). id 는 장면 안에서 겹치지 않게.
 */
export const RootBall: React.FC<{ x: number; y: number; w?: number; h?: number; loosen?: number; at?: number; id: string; o?: number; shadow?: boolean }> = ({ x, y, w = 190, h = 160, loosen = 0, at = DONE, id, o = 1, shadow = false }) => {
  const p = useAppear(at, 12);
  if (p <= 0 || o <= 0) return null;
  const wTop = w, wBot = w * 0.79;
  const cid = safeId(`k2rb-${id}`);
  const ry = w * 0.07;
  const body = `M ${-wTop / 2} 0 A ${wTop / 2} ${ry} 0 0 0 ${wTop / 2} 0 L ${wBot / 2 - 4} ${h - 8} Q ${wBot / 2} ${h + 4} ${wBot / 2 - 18} ${h + 6} L ${-wBot / 2 + 18} ${h + 6} Q ${-wBot / 2} ${h + 4} ${-wBot / 2 + 4} ${h - 8} Z`;
  const sideX = (t: number, s: -1 | 1) => s * (wTop / 2 + ((wBot - wTop) / 2) * t);
  // 감긴 뿌리 — 앞쪽 반 타원(위에서 조금 내려다본 원통) 여러 겹
  const rings = 12;
  // 풀린 뿌리 가닥 — 옆면·밑면에서 시작해 구불구불 뻗는다.
  const strands = Array.from({ length: 16 }, (_, i) => {
    const s: -1 | 1 = i % 2 ? 1 : -1;
    const bottom = i >= 12;
    const t = bottom ? 1 : 0.18 + (Math.floor(i / 2) / 5) * 0.75;
    const sx = bottom ? (i - 13.5) * wBot * 0.16 : sideX(t, s) - s * 2;
    const sy = bottom ? h + 4 : h * t;
    const L = (bottom ? 46 : 54) + random(`${id}L${i}`) * 34;
    const dx = bottom ? (random(`${id}d${i}`) - 0.5) * 30 : s * L;
    const dy = bottom ? L : 8 + random(`${id}y${i}`) * 26;
    const wig = (random(`${id}w${i}`) - 0.5) * 22;
    return { d: `M ${sx} ${sy} C ${sx + dx * 0.35} ${sy + dy * 0.1 + wig}, ${sx + dx * 0.65} ${sy + dy * 0.5 - wig}, ${sx + dx} ${sy + dy}`, k: (i % 7) / 7, w: 2.2 + random(`${id}t${i}`) * 1.6 };
  });
  return (
    <g transform={`translate(${x} ${y})`} opacity={p * o}>
      <defs><clipPath id={cid}><path d={body} /></clipPath></defs>
      {shadow ? <CastShadow cx={0} cy={h + 6} rx={wBot * 0.6} ry={10} /> : null}
      {/* 풀린 뿌리(덩이 뒤로 가는 것 먼저) */}
      {strands.map((st, i) => {
        const q = Math.max(0, Math.min(1, (loosen - st.k * 0.4) / 0.6));
        if (q <= 0) return null;
        const { strokeDasharray, strokeDashoffset } = evolvePath(q, st.d);
        return (
          <g key={i}>
            <path d={st.d} stroke="#6b5434" strokeWidth={st.w + 1.6} fill="none" strokeLinecap="round" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} opacity={0.55} />
            <path d={st.d} stroke="#ead9b4" strokeWidth={st.w} fill="none" strokeLinecap="round" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} />
          </g>
        );
      })}
      <path d={body} fill="url(#kit-soil)" filter="url(#kit-soil-tex)" />
      <g clipPath={`url(#${cid})`}>
        {/* 원통 명암 — 왼쪽 빛, 오른쪽 그늘 */}
        <rect x={-wTop / 2} y={-ry} width={wTop * 0.3} height={h + 20} fill="#fff" opacity={0.08} filter="url(#kit-blur4)" />
        <rect x={wTop * 0.12} y={-ry} width={wTop * 0.45} height={h + 20} fill="#000" opacity={0.3} filter="url(#kit-blur4)" />
        {/* 감긴 뿌리 — 포트 벽을 따라 돈 자국. 풀릴수록 옅어지고 끊긴다. */}
        {Array.from({ length: rings }, (_, i) => {
          const t = (i + 0.6) / rings;
          const yy = h * t;
          const half = -sideX(t, -1);
          const fade = Math.max(0, 1 - loosen * (0.55 + (i % 3) * 0.2));
          const gap = loosen * 0.6;
          // 손으로 그린 듯 고르지 않은 고리 — 굵기·높이·물결이 제각각, 일부는 비스듬히 감긴다.
          const tilt = (random(`${id}tl${i}`) - 0.5) * h * 0.08;
          const wid = 1.8 + random(`${id}wd${i}`) * 1.6;
          const pts = Array.from({ length: 17 }, (_, j) => {
            const u = -1 + (2 * j) / 16;
            const px = u * half;
            const py = yy + ry * 1.4 * Math.sqrt(Math.max(0, 1 - u * u)) + u * tilt + Math.sin(j * 1.7 + i) * 1.6;
            return `${j ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`;
          }).join(' ');
          const dash = `${(1 - gap) * (0.55 + random(`${id}dl${i}`) * 0.45)} ${gap + 0.04 + random(`${id}dg${i}`) * 0.15}`;
          const off = -random(`${id}g${i}`) * 0.6;
          return (
            <g key={i} opacity={fade}>
              <path d={pts} stroke="#3e2d1c" strokeWidth={wid + 1.6} fill="none" pathLength={1} strokeDasharray={dash} strokeDashoffset={off} opacity={0.55} strokeLinecap="round" />
              <path d={pts} stroke="#e6d3ab" strokeWidth={wid} fill="none" pathLength={1} strokeDasharray={dash} strokeDashoffset={off} strokeLinecap="round" />
            </g>
          );
        })}
        {/* 가는 잔뿌리 */}
        {Array.from({ length: 26 }, (_, i) => {
          const bx = (random(`${id}hx${i}`) - 0.5) * wBot, by = 10 + random(`${id}hy${i}`) * (h - 10);
          return <path key={`h${i}`} d={`M ${bx} ${by} q ${4 + random(`${id}hq${i}`) * 6} ${-3} ${8 + random(`${id}hl${i}`) * 8} ${random(`${id}hd${i}`) * 6 - 3}`} stroke="#d9c49a" strokeWidth={0.9} fill="none" opacity={0.6 * (1 - loosen * 0.5)} />;
        })}
      </g>
      {/* 윗면 흙 타원 */}
      <ellipse cx={0} cy={0} rx={wTop / 2} ry={ry} fill="#6a4c34" filter="url(#kit-soil-tex)" />
      <ellipse cx={-wTop * 0.1} cy={-ry * 0.2} rx={wTop * 0.3} ry={ry * 0.5} fill="#8a6a4c" opacity={0.5} filter="url(#kit-blur1)" />
      <path d={body} fill="none" stroke="#2a1d12" strokeWidth={1.6} opacity={0.55} />
    </g>
  );
};

/**
 * 관목(블루베리형) — 밑에서 갈라져 오르는 줄기 stems 대, 잎, 선택 열매. 원점 = 밑동(흙 표면).
 * berries: 남색 송이(color 로 바꿈) / fruit: 둥근 큰 열매. grow(0~1) 대신 at 부터 자라난다.
 */
export const Shrub: React.FC<{ x: number; y: number; h?: number; stems?: number; spread?: number; leaf?: LeafShape; leafSize?: number; leavesPerStem?: number;
  berries?: { color?: string; n?: number; r?: number }; fruit?: { color?: string; r?: number; n?: number }; at?: number; seed?: string; fallAt?: number }> = ({ x, y, h = 220, stems = 3, spread = 1, leaf = 'small', leafSize = 22, leavesPerStem = 8, berries, fruit, at = DONE, seed = 'sh', fallAt }) => {
  const f = useCurrentFrame();
  const sway = Math.sin(f / 36 + random(seed) * 6) * 0.8;
  const canes: P[][] = Array.from({ length: stems }, (_, i) => {
    const u = stems === 1 ? 0 : (i / (stems - 1)) * 2 - 1;
    const hh = h * (0.82 + random(`${seed}h${i}`) * 0.22) * (1 - Math.abs(u) * 0.12);
    const lean = u * h * 0.38 * spread + (random(`${seed}l${i}`) - 0.5) * 16;
    const bx = x + u * 10;
    return [[bx, y], [bx + lean * 0.3, y - hh * 0.45], [bx + lean * 0.75, y - hh * 0.8], [bx + lean, y - hh]];
  });
  // 곁가지 — 줄기 위쪽에서 짧게
  const twigs: P[][] = canes.flatMap((c, i) => [0.55, 0.75].map((t, j) => {
    const [sx, sy] = pointAt(c, t);
    const s = (i + j) % 2 ? 1 : -1;
    const L = h * (0.16 + random(`${seed}tw${i}${j}`) * 0.08);
    return [[sx, sy], [sx + s * L * 0.5, sy - L * 0.45], [sx + s * L * 0.85, sy - L * 0.8]] as P[];
  }));
  const top = Math.min(...canes.map((c) => c[c.length - 1]![1]));
  const canopy: Canopy = { cx: x, cy: (top + y) / 2 - h * 0.1, r: h * 0.6 };
  const a0 = at === DONE ? DONE : at;
  return (
    <g transform={`rotate(${sway} ${x} ${y})`}>
      {canes.flatMap((c, i) => leavesOnTwig(c, Math.round(leavesPerStem * 0.4), `${seed}bk${i}`, a0 + 10, leafSize * 1.05, fallAt, leaf, true, canopy))}
      {canes.map((c, i) => <Branch key={i} pts={c} w0={Math.max(4, h * 0.04) - i * 0.4} w1={2.2} at={a0 + i * 3} dur={18} detail={false} />)}
      {twigs.map((c, i) => <Branch key={`t${i}`} pts={c} w0={3} w1={1.4} at={a0 + 12 + i} dur={10} detail={false} />)}
      {canes.flatMap((c, i) => leavesOnTwig(c, leavesPerStem, `${seed}c${i}`, a0 + 14 + i * 2, leafSize, fallAt, leaf, false, canopy))}
      {twigs.flatMap((c, i) => leavesOnTwig(c, 3, `${seed}t${i}`, a0 + 18 + i, leafSize * 0.9, fallAt, leaf, false, canopy))}
      {canes.map((c, i) => { const [tx, ty] = c[c.length - 1]!; return <Leaf key={`tip${i}`} x={tx} y={ty} angle={-90 + (random(`${seed}ta${i}`) - 0.5) * 50} size={leafSize * 0.9} at={a0 + 22} seed={`${seed}tp${i}`} shape={leaf} {...(fallAt != null ? { fallAt } : {})} />; })}
      {berries ? canes.map((c, i) => { const [bx, by] = pointAt(c, 0.6 + (i % 2) * 0.12); return <Berry key={`b${i}`} x={bx + (i % 2 ? -12 : 12)} y={by + 6} n={berries.n ?? 3 + (i % 2)} r={berries.r ?? 7.5} at={a0 + 26 + i * 3} seed={`${seed}b${i}`} {...(berries.color ? { color: berries.color } : {})} />; }) : null}
      {fruit ? twigs.slice(0, fruit.n ?? twigs.length).map((c, i) => { const [fx, fy] = pointAt(c, 0.7); return <Fruit key={`f${i}`} x={fx} y={fy + (fruit.r ?? 12)} r={fruit.r ?? 12} at={a0 + 26 + i * 2} {...(fruit.color ? { color: fruit.color } : {})} />; }) : null}
    </g>
  );
};

/** 새싹 — 가는 줄기, 떡잎 두 장, leaves 만큼 본잎(0·2·4). 원점 = 흙 표면. at 부터 돋아난다. */
export const Seedling: React.FC<{ x: number; y: number; h?: number; leaves?: 0 | 2 | 4; at?: number; scale?: number; seed?: string }> = ({ x, y, h = 70, leaves = 2, at = DONE, scale = 1, seed = 'sd' }) => {
  const f = useCurrentFrame();
  const p = useAppear(at, 18);
  const cot = useAppear(at + 10, 10);
  const tl = useAppear(at + 18, 12);
  if (p <= 0) return null;
  const sway = Math.sin(f / 22 + random(seed) * 6) * 2;
  const hh = h * p;
  const stem: P[] = [[0, 0], [2, -hh * 0.45], [-1, -hh * 0.8], [sway, -hh]];
  const cotLeaf = (s: 1 | -1) => (
    <g transform={`translate(${sway} ${-hh}) rotate(${s * 62 - 90}) scale(${cot})`}>
      <path d={`M 0 0 C 6 -9, 26 -11, 34 0 C 26 11, 6 9, 0 0 Z`} fill="url(#kit-leafr-c)" stroke="#2f5a22" strokeWidth={1} />
      <path d="M 2 0 Q 16 -1 30 0" stroke="#e6f4d2" strokeWidth={0.9} opacity={0.5} fill="none" />
      <ellipse cx={14} cy={-3} rx={8} ry={2} fill="#fff" opacity={0.25} />
    </g>
  );
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={4} cy={2} rx={12} ry={3} fill="#000" opacity={0.25} filter="url(#kit-blur1)" />
      <path d={taperOutline(stem, 5, 3, 1, 16)} fill="url(#kit-new)" stroke="#355e24" strokeWidth={0.8} />
      {cot > 0 ? <>{cotLeaf(-1)}{cotLeaf(1)}</> : null}
      {leaves >= 2 && tl > 0 ? [-1, 1].map((s) => <Leaf key={s} x={sway} y={-hh - 4} angle={-90 + s * 28} size={26 * tl} shape="serrate" tone={s > 0 ? 0 : 2} seed={`${seed}${s}`} />) : null}
      {leaves >= 4 && tl > 0 ? [-1, 1].map((s) => <Leaf key={`u${s}`} x={sway} y={-hh - 8} angle={-90 + s * 12} size={16 * tl} shape="serrate" tone={1} seed={`${seed}u${s}`} />) : null}
    </g>
  );
};
