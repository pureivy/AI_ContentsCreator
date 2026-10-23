// 땅 단면 — 땅 위 풀, 겉흙·속흙 층, 풀뿌리, 돌, 심을 구덩이(파이며 깊어진다)와 깊이 표시. 심는 깊이를 말하는 문장용.
import React from 'react';
import { Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { INK } from '../../InfoPanel';
import { DONE, clamp, safeId } from './common';
import { DimensionLine } from './measure';
import { LAYER_COLORS, type LayerMaterial } from './pots';

export type SoilLayer = { material: 'topsoil' | 'subsoil' | LayerMaterial; ratio: number };
const BASE: Record<string, string> = { topsoil: 'url(#k2-top)', subsoil: 'url(#k2-sub)' };

/** 구덩이 치수 — 장면이 뿌리 덩이를 놓을 자리. */
export function soilHole(groundY: number, hole: { x: number; w: number; depth: number }) {
  return { top: groundY, bottom: groundY + hole.depth, x: hole.x, wTop: hole.w, wBot: hole.w * 0.78 };
}

/**
 * 땅 단면. 원점 없음 — x0~x1, 땅 높이 groundY 부터 bottom 까지. layers 비율은 땅 높이~bottom 기준(합 1).
 * hole: 구덩이(x 가운데, 폭 w, 깊이 depth px) — at 부터 dur 동안 파인다. backfill(0~1)은 구덩이를 다시 채운 정도(바닥부터).
 * depth: 구덩이 깊이 치수선 + 라벨(예: '30cm'). children 은 구덩이 바닥 가운데를 원점으로 그린다(뿌리 덩이).
 */
export const SoilSection: React.FC<{ x0?: number; x1?: number; groundY?: number; bottom?: number; layers?: SoilLayer[]; grass?: boolean; roots?: boolean; id: string;
  hole?: { x: number; w: number; depth: number; at?: number; dur?: number }; backfill?: number; depth?: { label?: string; at?: number }; children?: React.ReactNode }> = ({ x0 = 0, x1 = 1000, groundY = 300, bottom = 620, layers = [{ material: 'topsoil', ratio: 0.35 }, { material: 'subsoil', ratio: 0.65 }], grass = true, roots = true, id, hole, backfill = 0, depth, children }) => {
  const f = useCurrentFrame();
  const dig = hole ? interpolate(f, [hole.at ?? DONE, (hole.at ?? DONE) + (hole.dur ?? 24)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) }) : 0;
  const H = bottom - groundY;
  const cid = safeId(`k2ss-${id}`);
  let acc = 0;
  const bands = layers.map((l) => { const y0 = groundY + H * acc; acc += l.ratio; return { l, y0, y1: groundY + H * acc }; });
  const surf = (x: number) => groundY + Math.sin(x / 47 + 1) * 2 + Math.sin(x / 13) * 1;
  const surfPath = (() => { let d = ''; for (let x = x0; x <= x1; x += 10) d += `${x === x0 ? 'M' : 'L'} ${x} ${surf(x).toFixed(1)} `; return d; })();
  const hd = hole ? hole.depth * dig : 0;
  const hw = hole ? hole.w * (0.6 + 0.4 * dig) : 0;
  const holePath = hole && dig > 0 ? `M ${hole.x - hw / 2} ${groundY - 1} L ${hole.x + hw / 2} ${groundY - 1} L ${hole.x + hw * 0.39} ${groundY + hd - 10} Q ${hole.x + hw * 0.36} ${groundY + hd} ${hole.x + hw * 0.28} ${groundY + hd} L ${hole.x - hw * 0.28} ${groundY + hd} Q ${hole.x - hw * 0.36} ${groundY + hd} ${hole.x - hw * 0.39} ${groundY + hd - 10} Z` : '';
  const bf = Math.max(0, Math.min(1, backfill));
  return (
    <g>
      <defs><clipPath id={cid}><path d={`${surfPath} L ${x1} ${bottom} L ${x0} ${bottom} Z`} /></clipPath></defs>
      <g clipPath={`url(#${cid})`}>
        {bands.map(({ l, y0, y1 }, i) => {
          const lc = BASE[l.material] ?? LAYER_COLORS[l.material as LayerMaterial].base;
          const wav = (() => { let d = ''; for (let x = x0; x <= x1; x += 20) d += `${x === x0 ? 'M' : 'L'} ${x} ${(y0 + (i ? Math.sin(x / 37 + i * 3) * 6 : -4)).toFixed(1)} `; return d; })();
          return <path key={i} d={`${wav} L ${x1} ${y1 + 8} L ${x0} ${y1 + 8} Z`} fill={lc} filter="url(#kit-soil-tex)" />;
        })}
        {/* 단면 질감 — 돌·알갱이 */}
        {Array.from({ length: 40 }, (_, i) => {
          const sx = x0 + random(`${id}sx${i}`) * (x1 - x0), sy = groundY + 30 + random(`${id}sy${i}`) * (H - 30);
          const r = 3 + random(`${id}sr${i}`) * 6;
          return <g key={i}><ellipse cx={sx + 1} cy={sy + 1.5} rx={r} ry={r * 0.65} fill="#1c130b" opacity={0.4} /><ellipse cx={sx} cy={sy} rx={r} ry={r * 0.65} fill="#9a8a78" /><ellipse cx={sx - r * 0.3} cy={sy - r * 0.2} rx={r * 0.4} ry={r * 0.2} fill="#e0d4c4" opacity={0.6} /></g>;
        })}
        {/* 풀뿌리 — 겉흙 속 가는 선 */}
        {roots ? Array.from({ length: 34 }, (_, i) => {
          const rx = x0 + 10 + random(`${id}rx${i}`) * (x1 - x0 - 20);
          const len = 20 + random(`${id}rl${i}`) * H * 0.22;
          const bend = (random(`${id}rb${i}`) - 0.5) * 24;
          return <path key={`r${i}`} d={`M ${rx} ${groundY} q ${bend} ${len * 0.5} ${bend * 0.4} ${len} M ${rx + bend * 0.3} ${groundY + len * 0.45} q ${bend * 0.6} 6 ${bend} 14`} stroke="#d8c39a" strokeWidth={1.1} fill="none" opacity={0.55} />;
        }) : null}
        {/* 구덩이 — 판 자리는 어둡고(뒷벽), 다시 채운 흙은 조금 밝은 속흙 */}
        {holePath ? (
          <g>
            <path d={holePath} fill="url(#k2-hole)" />
            <path d={holePath} fill="#000" opacity={0.25} filter="url(#kit-soil-tex)" />
            <path d={`M ${hole!.x + hw / 2} ${groundY} L ${hole!.x + hw * 0.39} ${groundY + hd - 10}`} stroke="#000" strokeOpacity={0.4} strokeWidth={10} filter="url(#kit-blur4)" />
            {bf > 0 ? (
              <g clipPath={`url(#${cid}h)`}>
                <rect x={hole!.x - hw} y={groundY + hd * (1 - bf) - 2} width={hw * 2} height={hd * bf + 4} fill="#6a4c34" filter="url(#kit-soil-tex)" />
              </g>
            ) : null}
            <defs><clipPath id={`${cid}h`}><path d={holePath} /></clipPath></defs>
          </g>
        ) : null}
      </g>
      {/* 단면 윗선 + 풀 */}
      <path d={surfPath} stroke="#2a1d12" strokeWidth={2} fill="none" opacity={0.5} />
      {grass ? Array.from({ length: Math.round((x1 - x0) / 9) }, (_, i) => {
        const gx = x0 + 4 + random(`${id}g${i}`) * (x1 - x0 - 8);
        if (hole && dig > 0 && Math.abs(gx - hole.x) < hw / 2 + 4) return null;
        const h = 8 + random(`${id}gh${i}`) * 20;
        const lean = (random(`${id}gl${i}`) - 0.5) * 12;
        const col = ['#5f8f45', '#7aa957', '#4e7d39', '#8fbb64', '#6b9a4b'][i % 5];
        return <path key={`g${i}`} d={`M ${gx} ${surf(gx) + 2} q ${lean * 0.4} ${-h * 0.6} ${lean} ${-h}`} stroke={col} strokeWidth={1.6 + (i % 3) * 0.5} fill="none" strokeLinecap="round" />;
      }) : null}
      {/* 파낸 흙 더미 — 구덩이 오른쪽 */}
      {hole && dig > 0 ? (
        <g opacity={1 - bf}>
          <path d={`M ${hole.x + hw / 2 + 6} ${groundY + 1} Q ${hole.x + hw / 2 + 60} ${groundY - 46 * dig} ${hole.x + hw / 2 + 130} ${groundY + 1} Z`} fill="#6a4c34" filter="url(#kit-soil-tex)" />
          <path d={`M ${hole.x + hw / 2 + 26} ${groundY - 8 * dig} Q ${hole.x + hw / 2 + 56} ${groundY - 30 * dig} ${hole.x + hw / 2 + 86} ${groundY - 12 * dig}`} stroke="#8a6a4c" strokeWidth={4} fill="none" opacity={0.6} />
          <ellipse cx={hole.x + hw / 2 + 80} cy={groundY + 3} rx={64} ry={5} fill="#000" opacity={0.25} filter="url(#kit-blur1)" />
        </g>
      ) : null}
      {hole && dig > 0 && children ? <g transform={`translate(${hole.x} ${groundY + hd})`}>{children}</g> : null}
      {hole && depth && dig >= 1 ? <DimensionLine x1={hole.x - hw / 2 - 28} y1={groundY} x2={hole.x - hw / 2 - 28} y2={groundY + hole.depth} text={depth.label} at={depth.at ?? DONE} color={INK} textSide={1} /> : null}
    </g>
  );
};
