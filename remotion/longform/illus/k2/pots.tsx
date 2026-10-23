// 화분 — Planter(재질 3 × 시점 3: 앞·4분의3·밑면), PotSection(앞을 잘라 낸 단면 + 층 채우기).
// 원점 = 화분 바닥 가운데(땅에 닿는 점). 밑면 시점은 화분을 뒤집어 바닥을 정면으로 본 그림이다(가짜 기울기 금지).
import React from 'react';
import { interpolate, random, useCurrentFrame } from 'remotion';
import { evolvePath } from '@remotion/paths';
import { ACCENT, INK } from '../../InfoPanel';
import { CastShadow, DONE, clamp, mixHex, popScale, safeId, useAppear } from './common';
import { SafeLabel } from './labels';

export type PotMaterial = 'plastic' | 'terracotta' | 'fabric';
export type PotView = 'front' | 'threeQuarter' | 'bottom';

/** 화분 치수 — 바닥 폭·테두리·입구 타원. */
export function planterGeom(w: number, h: number, material: PotMaterial, view: PotView) {
  const wb = material === 'fabric' ? w * 0.94 : w * 0.74;
  const ry = view === 'threeQuarter' ? w * 0.17 : w * 0.07;
  const ryb = (ry * wb) / w;
  const rimH = material === 'terracotta' ? h * 0.14 : material === 'plastic' ? h * 0.07 : 0;
  const wr = material === 'terracotta' ? w * 1.07 : material === 'plastic' ? w * 1.035 : w;
  return { wb, ry, ryb, rimH, wr, ryr: (ry * wr) / w };
}

const BODY: Record<PotMaterial, { body: string; rim: string; rimTop: string; base: string; filter?: string; edge: string }> = {
  plastic: { body: 'url(#k2-plastic)', rim: 'url(#k2-plastic-rim)', rimTop: '#5d636b', base: 'url(#k2-base-plastic)', edge: '#15171a' },
  terracotta: { body: 'url(#k2-terra)', rim: 'url(#k2-terra-rim)', rimTop: '#e9a073', base: 'url(#k2-base-terra)', filter: 'url(#k2-clay)', edge: '#6e3219' },
  fabric: { body: 'url(#k2-fabric)', rim: 'url(#k2-fabric)', rimTop: '#5a5c57', base: 'url(#k2-base-fabric)', filter: 'url(#k2-felt)', edge: '#1d1e1b' },
};

/**
 * 화분(정교판). view: front(눈높이 조금 위) · threeQuarter(위에서 내려다봐 흙이 보임) · bottom(뒤집어 본 밑면 — 물 빠짐 구멍).
 * 밑면은 (x, y - w/2) 가 원 중심. holeGlow(0~1)로 구멍을 빛나게 강조한다.
 */
export const Planter: React.FC<{
  x: number; y: number; w?: number; h?: number; material?: PotMaterial; view?: PotView; saucer?: boolean; drainHoles?: number;
  soil?: boolean; at?: number; o?: number; holeGlow?: number; id?: string;
}> = ({ x, y, w = 220, h = 190, material = 'plastic', view = 'front', saucer = false, drainHoles, soil = true, at = DONE, o = 1, holeGlow = 0, id }) => {
  const p = useAppear(at, 12);
  if (p <= 0 || o <= 0) return null;
  const g = planterGeom(w, h, material, view);
  const M = BODY[material];
  const holes = drainHoles ?? (material === 'fabric' ? 0 : material === 'terracotta' ? 1 : 5);
  const cid = safeId(id ?? `pl${Math.round(x)}_${Math.round(y)}_${Math.round(w)}_${view}`);
  if (view === 'bottom') return <PlanterBottom x={x} y={y} w={w} g={g} M={M} material={material} holes={holes} p={p} o={o} glow={holeGlow} />;
  const { wb, ry, ryb, rimH, wr, ryr } = g;
  const body = `M ${-w / 2} ${-h} L ${-wb / 2} ${-ryb} A ${wb / 2} ${ryb} 0 0 0 ${wb / 2} ${-ryb} L ${w / 2} ${-h} A ${w / 2} ${ry} 0 0 1 ${-w / 2} ${-h} Z`;
  const rimBand = `M ${-wr / 2} ${-h - 2} L ${-wr / 2} ${-h + rimH} A ${wr / 2} ${ryr} 0 0 0 ${wr / 2} ${-h + rimH} L ${wr / 2} ${-h - 2} A ${wr / 2} ${ryr} 0 0 1 ${-wr / 2} ${-h - 2} Z`;
  const lip = material === 'terracotta' ? w * 0.045 : material === 'plastic' ? w * 0.022 : w * 0.02;
  const topY = -h - 2;
  const irx = wr / 2 - lip, iry = (ryr * irx) / (wr / 2);
  // 흙 표면 — 입구보다 조금 아래, 입구 타원 안으로 잘라 낸다.
  const soilDrop = view === 'threeQuarter' ? iry * 0.55 : iry * 0.35;
  // 테두리 아래 겹 그늘, 원통 하이라이트(빛 쪽 22%).
  const hl = (k: number, wd: number) => `M ${-w / 2 + w * k} ${-h + rimH} L ${-w / 2 + w * (k + wd)} ${-h + rimH} L ${-wb / 2 + wb * (k + wd)} ${-ryb * 0.4} L ${-wb / 2 + wb * k} ${-ryb * 0.4} Z`;
  const sc = popScale(p);
  return (
    <g transform={`translate(${x} ${y}) scale(${sc})`} opacity={p * o}>
      <defs><clipPath id={cid}><ellipse cx={0} cy={topY} rx={irx} ry={iry} /></clipPath></defs>
      {saucer ? (
        <g>
          <CastShadow cx={0} cy={-2} rx={wb * 0.7} ry={Math.max(7, ryb * 1.2)} />
          <ellipse cx={0} cy={-12} rx={wb * 0.68} ry={ryb * 1.35 + 4} fill="#3b2a1d" />
          <ellipse cx={0} cy={-11} rx={wb * 0.6} ry={ryb * 1.15 + 3} fill={material === 'terracotta' ? '#8f4a2a' : '#2a2d31'} />
        </g>
      ) : <CastShadow cx={0} cy={-ryb * 0.2} rx={wb * 0.6} ry={Math.max(6, ryb * 1.1)} />}
      <g transform={saucer ? 'translate(0 -8)' : undefined}>
        <path d={body} fill={M.body} {...(M.filter ? { filter: M.filter } : {})} />
        {/* 바닥 쪽 어둡게·원통 그늘 */}
        <path d={body} fill="url(#k2-vshade)" />
        <path d={hl(0.14, 0.12)} fill="#fff" opacity={material === 'plastic' ? 0.16 : 0.1} filter="url(#kit-blur4)" />
        {material === 'plastic' ? <path d={hl(0.2, 0.025)} fill="#fff" opacity={0.28} filter="url(#kit-blur1)" /> : null}
        {material === 'plastic' ? [0.16, 0.3].map((k) => (
          <path key={k} d={`M ${-wb / 2 - (w - wb) * k * 0.5} ${-h * k - ryb} A ${wb / 2 + (w - wb) * k * 0.5} ${ryb * 1.05} 0 0 0 ${wb / 2 + (w - wb) * k * 0.5} ${-h * k - ryb}`} stroke="#0e0f11" strokeWidth={2} fill="none" opacity={0.45} />
        )) : null}
        {material === 'fabric' ? (
          <g>
            {/* 손잡이 고리·세로 솔기·윗단 바이어스 */}
            {[-1, 1].map((s) => <path key={s} d={`M ${s * (w / 2 - 2)} ${-h + 14} q ${s * 26} 6 ${s * 22} 40 q ${-s * 4} 8 ${-s * 20} 6`} stroke="#2e302c" strokeWidth={9} fill="none" strokeLinecap="round" />)}
            {[-1, 1].map((s) => <path key={`h${s}`} d={`M ${s * (w / 2 - 2)} ${-h + 14} q ${s * 26} 6 ${s * 22} 40`} stroke="#6b6e69" strokeWidth={2} fill="none" opacity={0.5} />)}
            {[-0.22, 0.22].map((k) => <path key={k} d={`M ${w * k} ${-h + 4} L ${wb * k} ${-ryb * 0.3}`} stroke="#2a2b28" strokeWidth={2} strokeDasharray="5 4" opacity={0.7} />)}
            <path d={`M ${-w / 2} ${-h + 12} A ${w / 2} ${ry} 0 0 0 ${w / 2} ${-h + 12}`} stroke="#2a2b28" strokeWidth={2} strokeDasharray="5 4" fill="none" opacity={0.7} />
          </g>
        ) : null}
        <path d={body} fill="none" stroke={M.edge} strokeWidth={1.4} opacity={0.6} />
        {/* 테두리 띠 + 아래 그늘 */}
        {rimH > 0 ? (
          <g>
            <path d={`M ${-w / 2} ${-h + rimH} A ${w / 2} ${ry} 0 0 0 ${w / 2} ${-h + rimH} L ${w / 2} ${-h + rimH + 10} A ${w / 2} ${ry} 0 0 1 ${-w / 2} ${-h + rimH + 10} Z`} fill="#000" opacity={0.28} filter="url(#kit-blur4)" />
            <path d={rimBand} fill={M.rim} {...(M.filter ? { filter: M.filter } : {})} />
            <path d={rimBand} fill="url(#k2-vshade)" opacity={0.5} />
            <path d={`M ${-wr / 2 + wr * 0.1} ${-h + rimH * 0.35} L ${-wr / 2 + wr * 0.24} ${-h + rimH * 0.45}`} stroke="#fff" strokeWidth={rimH * 0.25} opacity={0.12} strokeLinecap="round" filter="url(#kit-blur1)" />
            <path d={rimBand} fill="none" stroke={M.edge} strokeWidth={1.2} opacity={0.55} />
          </g>
        ) : null}
        {/* 입구 — 테두리 윗면, 안쪽 벽, 흙 */}
        <ellipse cx={0} cy={topY} rx={wr / 2} ry={ryr} fill={M.rimTop} {...(M.filter ? { filter: M.filter } : {})} />
        <ellipse cx={0} cy={topY} rx={irx} ry={iry} fill="url(#k2-inwall)" />
        <g clipPath={`url(#${cid})`}>
          {soil ? (
            <g>
              <ellipse cx={0} cy={topY + soilDrop} rx={irx * 0.99} ry={iry} fill="url(#kit-soil)" filter="url(#kit-soil-tex)" />
              {/* 안쪽 벽이 흙에 드리운 그늘(빛 반대편 = 왼쪽 안벽 아래가 아니라, 오른쪽 위 테두리가 가린다) */}
              <ellipse cx={-irx * 0.15} cy={topY - iry * 0.25} rx={irx} ry={iry * 0.9} fill="#000" opacity={0.35} filter="url(#kit-blur4)" />
            </g>
          ) : null}
        </g>
        <ellipse cx={0} cy={topY} rx={(wr / 2 + irx) / 2} ry={(ryr + iry) / 2} fill="none" stroke="#fff" strokeOpacity={0.12} strokeWidth={lip * 0.5} strokeDasharray={`${irx * 1.2} ${irx * 5}`} strokeDashoffset={irx * 3.6} />
        <ellipse cx={0} cy={topY} rx={wr / 2} ry={ryr} fill="none" stroke={M.edge} strokeWidth={1.2} opacity={0.5} />
      </g>
      {saucer ? <path d={`M ${-wb * 0.68} -12 A ${wb * 0.68} ${ryb * 1.35 + 4} 0 0 0 ${wb * 0.68} -12 L ${wb * 0.64} 0 A ${wb * 0.64} ${ryb * 1.2 + 4} 0 0 1 ${-wb * 0.64} 0 Z`} fill={M.rim} {...(M.filter ? { filter: M.filter } : {})} /> : null}
    </g>
  );
};

/** 밑면 — 뒤집은 화분을 바로 아래에서 본 모습: 넓은 테두리(가장 멀다) 안에 비스듬한 몸통 벽(고리), 가장 가까운 바닥 원판과 구멍. */
const PlanterBottom: React.FC<{ x: number; y: number; w: number; g: ReturnType<typeof planterGeom>; M: (typeof BODY)[PotMaterial]; material: PotMaterial; holes: number; p: number; o: number; glow: number }> = ({ x, y, w, g, M, material, holes, p, o, glow }) => {
  const R = g.wr / 2, rw = w / 2, rb = g.wb / 2;
  const cy = -R;
  const sc = popScale(p);
  const holePts: Array<[number, number, number]> = [];
  if (holes > 0) {
    const ring = material === 'terracotta' && holes === 1 ? 0 : holes - 1;
    holePts.push([0, 0, rb * (material === 'terracotta' ? 0.14 : 0.11)]);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + 0.35;
      holePts.push([Math.cos(a) * rb * 0.6, Math.sin(a) * rb * 0.6, rb * 0.075]);
    }
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${sc})`} opacity={p * o}>
      <circle cx={10} cy={cy + 14} r={R} fill="#0b0805" opacity={0.3} filter="url(#kit-soft)" />
      <g transform={`translate(0 ${cy})`}>
        {/* 테두리 아랫면(가장 바깥 고리) */}
        <circle r={R} fill={M.rim} {...(M.filter ? { filter: M.filter } : {})} />
        <circle r={R} fill="url(#k2-ball)" opacity={0.5} />
        {/* 몸통 벽 — 바닥 쪽으로 좁아지는 원뿔면: 빛 쪽(왼쪽 위)이 밝고 오른쪽 아래가 어둡다 */}
        <circle r={rw * 0.97} fill={M.body} {...(M.filter ? { filter: M.filter } : {})} />
        <circle r={rw * 0.97} fill="url(#k2-cone)" />
        {material === 'plastic' ? [0.86, 0.92].map((k) => <circle key={k} r={rw * k} fill="none" stroke="#0e0f11" strokeWidth={1.6} opacity={0.4} />) : null}
        {/* 바닥 원판 + 모서리 빛·그늘 */}
        <circle r={rb} fill={M.base} {...(M.filter ? { filter: M.filter } : {})} />
        <path d={`M ${-rb * 0.94} ${rb * 0.34} A ${rb} ${rb} 0 0 1 ${rb * 0.34} ${-rb * 0.94}`} stroke="#fff" strokeOpacity={0.35} strokeWidth={3} fill="none" strokeLinecap="round" />
        <path d={`M ${rb * 0.94} ${-rb * 0.34} A ${rb} ${rb} 0 0 1 ${-rb * 0.34} ${rb * 0.94}`} stroke="#000" strokeOpacity={0.45} strokeWidth={4} fill="none" strokeLinecap="round" />
        {material === 'plastic' ? [0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          return <rect key={i} x={-rb * 0.08} y={-rb * 0.05} width={rb * 0.16} height={rb * 0.1} rx={3} fill="#4b5058" stroke="#1a1c1f" strokeWidth={1} transform={`translate(${Math.cos(a) * rb * 0.86} ${Math.sin(a) * rb * 0.86}) rotate(${(a * 180) / Math.PI + 90})`} />;
        }) : null}
        {material === 'fabric' ? <circle r={rb * 0.93} fill="none" stroke="#24251f" strokeWidth={2} strokeDasharray="6 5" opacity={0.8} /> : null}
        {holePts.map(([hx, hy, hr], i) => (
          <g key={i} transform={`translate(${hx} ${hy})`}>
            {glow > 0 ? <circle r={hr * 2.2} fill="#ffd54a" opacity={glow * 0.55} filter="url(#kit-blur4)" /> : null}
            <circle r={hr * 1.12} fill="#000" opacity={0.25} />
            <circle r={hr} fill="#0d0805" />
            {/* 구멍 안 벽 — 빛이 왼쪽 위에서 들어 오른쪽 아래 안벽이 밝다 */}
            <path d={`M ${hr * 0.98} ${-hr * 0.2} A ${hr} ${hr} 0 0 1 ${-hr * 0.2} ${hr * 0.98} A ${hr * 0.7} ${hr * 0.7} 0 0 0 ${hr * 0.98} ${-hr * 0.2} Z`} fill={material === 'terracotta' ? '#b5603a' : '#4a4f57'} opacity={0.9} />
            <path d={`M ${-hr} ${hr * 0.1} A ${hr} ${hr} 0 0 1 ${hr * 0.1} ${-hr}`} stroke="#fff" strokeOpacity={0.3} strokeWidth={1.6} fill="none" transform={`scale(1.12)`} />
          </g>
        ))}
      </g>
    </g>
  );
};

export type LayerMaterial = 'peat' | 'soil' | 'compost' | 'perlite' | 'sand' | 'bark' | 'gravel';
export type PotLayer = { label?: string; material: LayerMaterial; ratio: number };

/** 재료 바탕색·알갱이 색. */
export const LAYER_COLORS: Record<LayerMaterial, { base: string; bits: string[]; tex: boolean }> = {
  peat: { base: '#7e4f33', bits: ['#c48a5c', '#5a3420', '#a46a44'], tex: true },
  soil: { base: '#5a4130', bits: ['#7d5c40', '#3a2a1d', '#8a6a4c'], tex: true },
  compost: { base: '#3e2c1e', bits: ['#6b4a2c', '#24180f', '#8a6a3a'], tex: true },
  perlite: { base: '#c9c5bb', bits: ['#ffffff', '#e9e6df', '#9d988c'], tex: false },
  sand: { base: '#d6b88a', bits: ['#ecd6aa', '#b8976a', '#c9a878'], tex: true },
  bark: { base: '#5a3520', bits: ['#8a5634', '#3e2213', '#a8703f'], tex: false },
  gravel: { base: '#4e4a44', bits: ['#9a958b', '#6e6a62', '#b5afa3', '#857f74'], tex: false },
};

/** 한 층의 알갱이·결 — 재료마다 생김새가 다르다(결정적 배치). */
const LayerBits: React.FC<{ m: LayerMaterial; x0: number; x1: number; y0: number; y1: number; seed: string }> = ({ m, x0, x1, y0, y1, seed }) => {
  const C = LAYER_COLORS[m];
  const area = Math.max(0, (x1 - x0) * (y1 - y0));
  const dens = m === 'perlite' ? 1 / 260 : m === 'gravel' ? 1 / 150 : m === 'bark' ? 1 / 230 : m === 'sand' ? 1 / 90 : 1 / 240;
  const n = Math.min(m === 'sand' ? 260 : 150, Math.round(area * dens));
  if (n <= 0) return null;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const bx = x0 + random(`${seed}x${i}`) * (x1 - x0), by = y0 + random(`${seed}y${i}`) * (y1 - y0);
        const col = C.bits[i % C.bits.length]!;
        const a = random(`${seed}a${i}`) * 180;
        if (m === 'peat' || m === 'compost') {
          const l = 5 + random(`${seed}l${i}`) * 9;
          return <path key={i} d={`M ${bx} ${by} q ${l * 0.5} ${-l * 0.3} ${l} ${l * 0.1}`} stroke={col} strokeWidth={m === 'peat' ? 1.5 : 2.4} strokeLinecap="round" fill="none" opacity={0.75} transform={`rotate(${a} ${bx} ${by})`} />;
        }
        if (m === 'perlite') {
          const r = 2.5 + random(`${seed}r${i}`) * 3.5;
          return <g key={i}><circle cx={bx + 1} cy={by + 1.4} r={r} fill="#5f5a50" opacity={0.35} /><circle cx={bx} cy={by} r={r} fill={col} /><circle cx={bx - r * 0.3} cy={by - r * 0.35} r={r * 0.35} fill="#fff" opacity={0.8} /></g>;
        }
        if (m === 'gravel') {
          const r = 4 + random(`${seed}r${i}`) * 5;
          return <g key={i} transform={`rotate(${a} ${bx} ${by})`}><ellipse cx={bx + 1.5} cy={by + 2} rx={r} ry={r * 0.7} fill="#1f1d1a" opacity={0.45} /><ellipse cx={bx} cy={by} rx={r} ry={r * 0.7} fill={col} /><ellipse cx={bx - r * 0.3} cy={by - r * 0.25} rx={r * 0.45} ry={r * 0.25} fill="#fff" opacity={0.35} /></g>;
        }
        if (m === 'bark') {
          const s = 8 + random(`${seed}r${i}`) * 10;
          return <g key={i} transform={`translate(${bx} ${by}) rotate(${a})`}><path d={`M ${-s} ${-s * 0.3} L ${s * 0.6} ${-s * 0.45} L ${s} ${s * 0.15} L ${-s * 0.4} ${s * 0.4} Z`} fill={col} stroke="#24130a" strokeWidth={1} /><path d={`M ${-s * 0.7} ${-s * 0.15} L ${s * 0.5} ${-s * 0.25}`} stroke="#c88a55" strokeWidth={1} opacity={0.5} /></g>;
        }
        if (m === 'sand') return <circle key={i} cx={bx} cy={by} r={0.9 + random(`${seed}r${i}`) * 1.2} fill={col} opacity={0.8} />;
        // soil
        const r = 1.5 + random(`${seed}r${i}`) * 3;
        return <ellipse key={i} cx={bx} cy={by} rx={r} ry={r * 0.7} fill={col} opacity={0.7} />;
      })}
    </g>
  );
};

/** 물결진 층 윗선 — 결정적. */
function wavyTop(x0: number, x1: number, y: number, amp: number, seed: string): string {
  const n = 14;
  const ph = random(`${seed}ph`) * 6;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const xx = x0 + ((x1 - x0) * i) / n;
    const yy = y + Math.sin(i * 1.3 + ph) * amp + Math.sin(i * 0.55 + ph * 2) * amp * 0.6;
    d += `${i ? 'L' : 'M'} ${xx.toFixed(1)} ${yy.toFixed(1)} `;
  }
  return d;
}

/** 단면 치수 — 장면이 흙 높이·안쪽 벽 위치를 알아야 할 때(붓는 목표점, 뿌리 덩이 자리). 원점 = 바닥 가운데. */
export function potSection(x: number, y: number, w = 380, h = 280, material: PotMaterial = 'plastic') {
  const wb = material === 'fabric' ? w * 0.94 : w * 0.76;
  const t = material === 'terracotta' ? w * 0.05 : material === 'fabric' ? w * 0.025 : w * 0.03;
  const lipH = material === 'terracotta' ? h * 0.13 : material === 'plastic' ? h * 0.06 : 0;
  const innerTop = y - h + lipH * 0.3, innerBottom = y - t;
  const outerX = (yy: number, side: -1 | 1) => x + side * (w / 2 + ((wb - w) / 2) * ((yy - (y - h)) / h));
  const innerX = (yy: number, side: -1 | 1) => outerX(yy, side) - side * t;
  /** 안쪽 높이 비율(바닥 0 → 입구 1)의 y. */
  const levelY = (r: number) => innerBottom - (innerBottom - innerTop) * r;
  return { x, y, w, h, wb, t, lipH, innerTop, innerBottom, outerX, innerX, levelY };
}

/**
 * 화분 단면 — 앞벽을 잘라 낸 모습. layers 를 바닥부터 ratio(안쪽 높이 비율)만큼 쌓는다.
 * fill(0~1) 을 주면 그 진행값, 아니면 at 부터 dur 동안 채워진다. mix(0~1)는 층이 한 결로 섞이는 정도.
 * level = 점선 기준선(안쪽 높이 비율) + 선택 라벨. children 은 (0, slotY) 원점으로 옮겨 층 위에 그린다(뿌리 덩이·포기).
 */
export const PotSection: React.FC<{
  x: number; y: number; w?: number; h?: number; material?: PotMaterial; layers: PotLayer[]; fill?: number; at?: number; dur?: number; mix?: number;
  level?: { ratio: number; label?: string; at?: number }; slotY?: number; id: string; o?: number; showLayerLabels?: boolean; children?: React.ReactNode; behind?: React.ReactNode;
}> = ({ x, y, w = 380, h = 280, material = 'plastic', layers, fill, at = DONE, dur = 40, mix = 0, level, slotY, id, o = 1, showLayerLabels = true, children, behind }) => {
  const f = useCurrentFrame();
  const show = useAppear(at === DONE ? DONE : at - 10, 10);
  const prog = fill ?? interpolate(f, [at, at + dur], [0, 1], clamp);
  const lvlP = useAppear(level?.at ?? DONE, 16); // 훅은 모두 이른 return 위에(프레임마다 훅 수가 같아야 한다)
  if (show <= 0 || o <= 0) return null;
  const G = potSection(x, y, w, h, material);
  const M = BODY[material];
  const cid = safeId(`k2ps-${id}`);
  const H = G.innerBottom - G.innerTop;
  const total = layers.reduce((a, l) => a + l.ratio, 0);
  const filled = prog * total; // 채워진 비율(안쪽 높이 기준)
  const xl = G.innerX(G.innerTop, -1) - 4, xr = G.innerX(G.innerTop, 1) + 4;
  let acc = 0;
  const bands = layers.map((l, i) => {
    const r0 = acc, r1 = acc + l.ratio;
    acc = r1;
    const top = Math.min(r1, filled);
    return { l, i, r0, r1, top, y0: G.levelY(r0), y1: G.levelY(top) };
  });
  const mixedColor = layers.reduce((c, l, i) => (i === 0 ? LAYER_COLORS[l.material].base : mixHex(c, LAYER_COLORS[l.material].base, l.ratio / layers.slice(0, i + 1).reduce((a, q) => a + q.ratio, 0))), '#000000');
  const inner = `M ${G.innerX(G.innerTop, -1)} ${G.innerTop} L ${G.innerX(G.innerTop, 1)} ${G.innerTop} L ${G.innerX(G.innerBottom, 1)} ${G.innerBottom} L ${G.innerX(G.innerBottom, -1)} ${G.innerBottom} Z`;
  const outer = `M ${G.outerX(y - h, -1)} ${y - h} L ${G.outerX(y - h, 1)} ${y - h} L ${G.outerX(y, 1)} ${y} L ${G.outerX(y, -1)} ${y} Z`;
  const wallCut = material === 'terracotta' ? '#c9764c' : material === 'fabric' ? '#4b4d48' : '#34383e';
  const hole = material === 'fabric' ? 0 : w * 0.07;
  const lvl = level ? G.levelY(level.ratio) : 0;
  const topNow = G.levelY(filled);
  return (
    <g opacity={show * o}>
      <defs><clipPath id={cid}><path d={inner} /></clipPath></defs>
      <CastShadow cx={x} cy={y} rx={G.wb * 0.6} ry={12} />
      {/* 바깥 실루엣(뒤쪽 몸통) + 뒷벽 안쪽 */}
      <path d={outer} fill={M.body} {...(M.filter ? { filter: M.filter } : {})} />
      <path d={inner} fill="url(#k2-inwall)" />
      {/* 뒷벽 위 테두리 안쪽 곡선 — 뒤쪽 입구 가장자리 */}
      <path d={`M ${G.innerX(G.innerTop, -1)} ${G.innerTop} Q ${x} ${G.innerTop - h * 0.07} ${G.innerX(G.innerTop, 1)} ${G.innerTop}`} stroke="#000" strokeOpacity={0.5} strokeWidth={3} fill="none" />
      <g clipPath={`url(#${cid})`}>
        {behind}
        {bands.map(({ l, i, y0, y1, top, r0 }) => {
          if (top <= r0) return null;
          const C = LAYER_COLORS[l.material];
          const d = `${wavyTop(xl, xr, y1, top < l.ratio + r0 - 1e-6 ? 1.5 : 2.4, `${id}${i}`)} L ${xr} ${y0 + 3} L ${xl} ${y0 + 3} Z`;
          return (
            <g key={i}>
              <path d={d} fill={C.base} {...(C.tex ? { filter: 'url(#kit-soil-tex)' } : {})} />
              <LayerBits m={l.material} x0={xl} x1={xr} y0={y1 + 2} y1={y0} seed={`${id}L${i}`} />
            </g>
          );
        })}
        {mix > 0 && filled > 0 ? (
          <g opacity={mix}>
            <path d={`${wavyTop(xl, xr, topNow, 2.2, `${id}mx`)} L ${xr} ${G.innerBottom + 2} L ${xl} ${G.innerBottom + 2} Z`} fill={mixedColor} filter="url(#kit-soil-tex)" />
            {layers.map((l, i) => <LayerBits key={i} m={l.material === 'gravel' || l.material === 'bark' ? 'compost' : l.material} x0={xl} x1={xr} y0={topNow + 3} y1={G.innerBottom} seed={`${id}M${i}`} />)}
          </g>
        ) : null}
        {/* 벽 쪽 그늘 — 안쪽 내용물이 벽에 붙은 자리, 빛 반대편(오른쪽)이 더 어둡다 */}
        <path d={`M ${xl} ${G.innerTop} L ${xl + 26} ${G.innerTop} L ${G.innerX(G.innerBottom, -1) + 22} ${G.innerBottom} L ${xl} ${G.innerBottom} Z`} fill="#000" opacity={0.18} filter="url(#kit-blur4)" />
        <path d={`M ${xr} ${G.innerTop} L ${xr - 40} ${G.innerTop} L ${G.innerX(G.innerBottom, 1) - 34} ${G.innerBottom} L ${xr} ${G.innerBottom} Z`} fill="#000" opacity={0.3} filter="url(#kit-blur4)" />
      </g>
      {/* 자리(뿌리 덩이·포기) — 안쪽 자르기 밖에 그려 위로 솟은 줄기·잎이 잘리지 않는다 */}
      {children ? <g transform={`translate(${x} ${slotY ?? G.levelY(total)})`}>{children}</g> : null}
      {/* 잘린 벽 단면(두께) + 바닥 + 물 빠짐 구멍 */}
      {([-1, 1] as const).map((s) => (
        <path key={s} d={`M ${G.outerX(y - h, s)} ${y - h} L ${G.innerX(y - h, s)} ${y - h} L ${G.innerX(y, s)} ${y - G.t} L ${G.outerX(y, s)} ${y} Z`} fill={wallCut} {...(M.filter ? { filter: M.filter } : {})} stroke={M.edge} strokeWidth={1} />
      ))}
      <path d={`M ${G.outerX(y, -1)} ${y} L ${G.innerX(y, -1)} ${y - G.t} L ${x - hole / 2} ${y - G.t} L ${x - hole / 2} ${y} Z`} fill={wallCut} stroke={M.edge} strokeWidth={1} />
      <path d={`M ${G.outerX(y, 1)} ${y} L ${G.innerX(y, 1)} ${y - G.t} L ${x + hole / 2} ${y - G.t} L ${x + hole / 2} ${y} Z`} fill={wallCut} stroke={M.edge} strokeWidth={1} />
      {/* 테두리 단면 — 바깥으로 말린 입술 */}
      {G.lipH > 0 ? ([-1, 1] as const).map((s) => {
        const ox = G.outerX(y - h, s), ix = G.innerX(y - h, s);
        const out = s * w * (material === 'terracotta' ? 0.035 : 0.018);
        const x0 = Math.min(ix, ox + out), x1 = Math.max(ix, ox + out);
        return <rect key={`l${s}`} x={x0} y={y - h - 3} width={x1 - x0} height={G.lipH + 3} rx={Math.min(6, G.lipH * 0.35)} fill={wallCut} {...(M.filter ? { filter: M.filter } : {})} stroke={M.edge} strokeWidth={1} />;
      }) : null}
      {/* 빛 받는 왼쪽 벽 바깥 모서리 */}
      <path d={`M ${G.outerX(y - h, -1) + 1} ${y - h + G.lipH} L ${G.outerX(y, -1) + 1} ${y - 2}`} stroke="#fff" strokeOpacity={0.25} strokeWidth={2} />
      {/* 기준선 */}
      {level && lvlP > 0 ? (() => {
        const xa = G.innerX(lvl, -1) + 2, xb = G.innerX(lvl, 1) - 2;
        const len = xb - xa;
        return (
          <g>
            <path d={`M ${xa} ${lvl} L ${xa + len * lvlP} ${lvl}`} stroke={ACCENT} strokeWidth={4} strokeDasharray="14 10" />
            {level.label ? <SafeLabel x={G.outerX(lvl, 1) + 22} y={lvl + 11} at={level.at ?? DONE} anchor="start" size={30} color={INK}>{level.label}</SafeLabel> : null}
          </g>
        );
      })() : null}
      {showLayerLabels ? bands.map(({ l, i, r0, r1, top }) => {
        if (!l.label || top <= r0 + (r1 - r0) * 0.5) return null;
        const ym = G.levelY((r0 + r1) / 2);
        const ex = G.outerX(ym, -1);
        return (
          <g key={`lb${i}`}>
            <path d={`M ${ex - 6} ${ym} L ${ex - 30} ${ym}`} stroke={INK} strokeWidth={2.5} />
            <SafeLabel x={ex - 38} y={ym + 10} at={DONE} anchor="end" size={28} color={INK}>{l.label}</SafeLabel>
          </g>
        );
      }) : null}
    </g>
  );
};

/** 선이 그려지는 경로(단순) — 부품 안 지시선용. */
export const DrawLine: React.FC<{ d: string; p: number; color?: string; width?: number }> = ({ d, p, color = INK, width = 3 }) => {
  if (p <= 0) return null;
  const { strokeDasharray, strokeDashoffset } = evolvePath(Math.min(1, p), d);
  return <path d={d} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} />;
};
