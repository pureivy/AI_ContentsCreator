// 전체 화면 장면 공용 부품(2026-10-23) — 붓(Brush)만 바꿔 두 스타일이 같은 모양·같은 API 로 쓴다.
// 스타일 A(세밀화): 펜 선 + 차분한 물감 칠 + 빗금. 스타일 B(연필 선화): 흑연 선 + 종이 가림 + 빗금, 색은 포인트 색 하나.
// 포인트 색(주홍·주황빨강)은 hi(0~1)로만 — '지금 낭독이 말하는 것'에만 켜고, 그 박자가 끝나면 끈다.
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { clamp } from './stage';
import { calyxPath, handGeom, koreaGeom, koreaXY, KOREA_REGIONS, leafPath, persimmonPath, rootsGeom, snowflakePath, stipple, taper, treeGeom, type P, type TreeAge } from './geom';

export type Tone = 'leaf' | 'leafAutumn' | 'bark' | 'soil' | 'frozen' | 'root' | 'straw' | 'fruit' | 'water' | 'land' | 'sun' | 'skin' | 'sleeve' | 'paper' | 'glass' | 'store' | 'calendar';

/** 붓 — 스타일 키트가 채운다. */
export type Brush = {
  ink: string; soft: string; paper: string; accent: string; font: string; fontWeight: number;
  /** 선(펜·연필). p = 그어진 몫, hi = 포인트 색 몫. */
  Line: React.FC<{ d: string; w?: number; p?: number; o?: number; hi?: number; dash?: string; seed?: string }>;
  /** 면 칠. A 는 tone 색 물감, B 는 종이색 가림(뒤 선을 지움). hi 만큼 포인트 색이 덮인다. */
  Fill: React.FC<{ d: string; tone: Tone; o?: number; hi?: number }>;
  /** 빗금 그늘(무늬) — side 쪽만. */
  Shade: React.FC<{ d: string; side?: 'r' | 'b' | 'br' | 'all'; o?: number; dense?: boolean }>;
};

const DONE = -999;
const circ = (x: number, y: number, rr: number) => `M ${x - rr} ${y} a ${rr} ${rr} 0 1 0 ${2 * rr} 0 a ${rr} ${rr} 0 1 0 ${-2 * rr} 0 Z`;
const useAt = (at: number, dur = 18) => {
  const f = useCurrentFrame();
  return interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
};

export function makeParts(B: Brush) {
  const { Line, Fill, Shade } = B;

  const Leaf: React.FC<{ x: number; y: number; angle: number; len: number; wid?: number; flip?: number; tone?: number; p?: number; autumn?: boolean; hi?: number }> = ({ x, y, angle, len, wid = 0.58, flip = 1, tone = 0.5, p = 1, autumn = false, hi = 0 }) => {
    if (p <= 0) return null;
    const L = leafPath(len, wid);
    const shade = flip > 0 ? L.lower : L.upper;
    const det = interpolate(p, [0.45, 1], [0, 1], clamp);
    return (
      <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${0.4 + 0.6 * p})`}>
        <Fill d={L.outline} tone={autumn ? 'leafAutumn' : 'leaf'} o={Math.min(1, p * 1.8) * (0.86 + tone * 0.14)} hi={hi} />
        <Shade d={shade} side="all" o={0.55 * det} dense />
        <Line d={L.outline} w={1.15} p={Math.min(1, p * 1.6)} seed={`lf${Math.round(x)}`} />
        <Line d={L.midrib} w={0.9} p={det} o={0.85} />
      </g>
    );
  };

  /** 감 열매 — 중심 (x,y), 반지름 r. kind round(둥근 떫은감)·flat(단감)·long(대봉). */
  const Persimmon: React.FC<{ x: number; y: number; r?: number; kind?: 'round' | 'flat' | 'long'; p?: number; at?: number; hi?: number; o?: number }> = ({ x, y, r = 40, kind = 'round', p, at = DONE, hi = 0, o = 1 }) => {
    const pa = useAt(at, 14);
    const pp = p ?? pa;
    if (pp <= 0 || o <= 0) return null;
    const body = persimmonPath(r, kind);
    return (
      <g transform={`translate(${x} ${y}) scale(${0.5 + 0.5 * pp})`} opacity={o * Math.min(1, pp * 2)}>
        <Fill d={body} tone="fruit" hi={hi} />
        <Shade d={body} side="br" o={0.5} />
        <path d={`M ${-r * 0.45} ${-r * 0.2} q ${r * 0.15} ${-r * 0.25} ${r * 0.4} ${-r * 0.3}`} stroke={B.paper} strokeWidth={r * 0.1} strokeLinecap="round" fill="none" opacity={0.55} />
        <Line d={body} w={1.6} />
        <Fill d={calyxPath(r)} tone="leaf" />
        <Line d={calyxPath(r)} w={1.2} />
      </g>
    );
  };

  /**
   * 감나무 — 밑동 (x,y)(= 땅 높이), 키 h. age: sapling(접목묘 외줄기)·young(1~3년)·mature(성목). leaves: full·autumn·bare.
   * at 부터 grow 프레임 동안 밑에서 끝으로 자란다(기본 DONE = 처음부터 다 자란 모습).
   * roots: 'small'·'wide' 면 땅 아래(y 아래)로 뿌리를 그린다(rootP 0~1 로 뻗어 나감). store(0~1) = 몸통·뿌리에 모아 둔 양분 알갱이.
   * hi: 부위별 포인트 색 {trunk, crown, fruit, graft, roots, store}.
   */
  const Tree: React.FC<{
    x: number; y: number; h: number; age?: TreeAge; seed: string; leaves?: 'full' | 'autumn' | 'bare'; fruit?: boolean; at?: number; grow?: number; o?: number;
    roots?: 'none' | 'small' | 'wide'; rootW?: number; rootDepth?: number; rootP?: number; store?: number;
    hi?: { trunk?: number; crown?: number; fruit?: number; graft?: number; roots?: number; store?: number };
  }> = ({ x, y, h, age = 'mature', seed, leaves = 'full', fruit = true, at = DONE, grow = 40, o = 1, roots = 'none', rootW, rootDepth, rootP = 1, store = 0, hi = {} }) => {
    const f = useCurrentFrame();
    const g = treeGeom(seed, h, age);
    const t = interpolate(f, [at, at + grow], [0, 1.25], clamp);
    if (t <= 0 || o <= 0) return null;
    const pFor = (order: number) => interpolate(t, [order * 0.9, order * 0.9 + 0.3], [0, 1], clamp);
    const trunkD = taper(g.stems[0]!.pts, g.stems[0]!.w0, g.stems[0]!.w1);
    const rw = rootW ?? (roots === 'wide' ? h * 0.95 : h * 0.32);
    const rd = rootDepth ?? (roots === 'wide' ? h * 0.32 : h * 0.18);
    const rootStems = roots === 'none' ? [] : rootsGeom(`${seed}r`, rw, rd, roots === 'wide' ? 7 : 4, Math.max(5, g.trunk.w0 * 0.55));
    const rid = `fs-rootclip-${seed}`;
    const rReach = Math.hypot(rw / 2, rd) * 1.15;
    const storeBox = { x0: -g.trunk.w0 / 2, y0: g.trunk.top, x1: g.trunk.w0 / 2, y1: 0 };
    return (
      <g transform={`translate(${x} ${y})`} opacity={o}>
        {rootStems.length ? (
          <g>
            <defs><clipPath id={rid}><circle cx={0} cy={0} r={Math.max(0.1, rReach * rootP)} /></clipPath></defs>
            <g clipPath={`url(#${rid})`}>
              {rootStems.map((s, i) => {
                const d = taper(s.pts, s.w0, s.w1);
                return <g key={i}><Fill d={d} tone="root" hi={hi.roots ?? 0} /><Line d={d} w={1} o={0.9} hi={hi.roots ?? 0} /></g>;
              })}
              {store > 0 ? rootStems.filter((s) => s.order === 0).flatMap((s, i) => s.pts.slice(1, -2).map((q, k) => <circle key={`${i}-${k}`} cx={q[0]} cy={q[1]} r={Math.max(2, s.w0 * 0.18)} fill={(hi.store ?? 0) > 0.5 ? B.accent : B.ink} opacity={store * 0.85} />)) : null}
            </g>
          </g>
        ) : null}
        {/* 가지는 세 겹으로 — 테두리 선(굵게) 전부 → 칠 전부 → 빗금. 이음매 선이 가지 안에 보이지 않게(한 덩어리 실루엣). */}
        {g.stems.map((s, i) => {
          const p = pFor(s.order * 0.6);
          return p <= 0 ? null : <Line key={`o${i}`} d={i === 0 ? trunkD : taper(s.pts, s.w0, s.w1)} w={i === 0 ? 3.4 : 2.4} p={p} seed={`${seed}s${i}`} hi={i === 0 ? hi.trunk ?? 0 : 0} />;
        })}
        {g.stems.map((s, i) => {
          const p = pFor(s.order * 0.6);
          return p <= 0 ? null : <Fill key={`f${i}`} d={i === 0 ? trunkD : taper(s.pts, s.w0, s.w1)} tone="bark" o={interpolate(p, [0.4, 1], [0, 1], clamp)} hi={i === 0 ? hi.trunk ?? 0 : 0} />;
        })}
        {g.stems.map((s, i) => {
          const p = pFor(s.order * 0.6);
          return p <= 0 ? null : <Shade key={`h${i}`} d={i === 0 ? trunkD : taper(s.pts, s.w0, s.w1)} side="r" o={0.7 * p} dense={s.w0 < 14} />;
        })}
        {/* 몸통 껍질 — 세로로 잘게 갈라진 결(성목) */}
        {age === 'mature' && pFor(0) > 0.9 ? Array.from({ length: 7 }, (_, k) => {
          const tw = g.trunk.w0;
          const bx = (k / 6 - 0.5) * tw * 0.7;
          const y0 = -((k * 37) % 13) * 4 - 6, len = -g.trunk.top * (0.45 + ((k * 29) % 10) / 25);
          return <path key={k} d={`M ${bx} ${y0} q ${tw * 0.05} ${-len * 0.3} ${-tw * 0.03} ${-len * 0.6} t ${tw * 0.04} ${-len * 0.4}`} stroke={B.ink} strokeWidth={1.1} fill="none" opacity={0.5} />;
        }) : null}
        {store > 0 ? (
          <g>
            <defs><clipPath id={`fs-store-${seed}`}><path d={trunkD} /></clipPath></defs>
            <g clipPath={`url(#fs-store-${seed})`}>
              {stipple(storeBox, Math.round(g.trunk.w0 * -g.trunk.top * 0.012 * store), `${seed}st`, 2, 4.5).map(([sx, sy, sr], k) => (
                <circle key={k} cx={sx} cy={sy} r={sr} fill={(hi.store ?? 0) > 0.5 ? B.accent : B.ink} opacity={0.8} />
              ))}
            </g>
          </g>
        ) : null}
        {leaves !== 'bare' ? g.leaves.map((l, i) => <Leaf key={i} {...l} p={pFor(l.order)} autumn={leaves === 'autumn'} hi={hi.crown ?? 0} />) : null}
        {fruit && leaves !== 'bare' ? g.fruits.map((b, i) => <Persimmon key={i} x={b.x} y={b.y} r={b.r} p={pFor(b.order)} hi={hi.fruit ?? 0} />) : null}
        {g.graftY != null ? (
          <g opacity={pFor(0)}>
            <path d={`M ${-g.trunk.w0 * 0.75} ${g.graftY + 5} Q 0 ${g.graftY - 7} ${g.trunk.w0 * 0.75} ${g.graftY - 3}`} stroke={(hi.graft ?? 0) > 0.5 ? B.accent : B.ink} strokeWidth={(hi.graft ?? 0) > 0.5 ? 3.4 : 1.8} fill="none" strokeLinecap="round" />
            {(hi.graft ?? 0) > 0 ? <circle cx={0} cy={g.graftY} r={g.trunk.w0 * 1.6 + 10} fill="none" stroke={B.accent} strokeWidth={2.6} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - (hi.graft ?? 0)} /> : null}
          </g>
        ) : null}
      </g>
    );
  };

  /** 땅 선 — 지면. */
  const GroundLine: React.FC<{ x0: number; x1: number; y: number; p?: number }> = ({ x0, x1, y, p = 1 }) => (
    <Line d={`M ${x0} ${y} C ${x0 + (x1 - x0) * 0.3} ${y - 2} ${x0 + (x1 - x0) * 0.7} ${y + 3} ${x1} ${y}`} w={1.8} p={p} seed="gl" />
  );

  /**
   * 땅 단면 — 지면 y 에서 아래로 depth. frost(0~1) = 위쪽 언 층 두께(최대 depth 의 45%), frostHi = 언 층 포인트 색.
   * 풀 포기(grass)는 지면 위. children 은 단면 위에(뿌리·물방울 등).
   */
  const GroundSection: React.FC<{ x0: number; x1: number; y: number; depth?: number; frost?: number; frostHi?: number; grass?: boolean; seed?: string; at?: number; o?: number; children?: React.ReactNode }> = ({ x0, x1, y, depth = 220, frost = 0, frostHi = 0, grass = true, seed = 'gs', at = DONE, o = 1, children }) => {
    const p = useAt(at, 18);
    if (p <= 0 || o <= 0) return null;
    const bottom = y + depth;
    const n = Math.max(8, Math.round((x1 - x0) / 60));
    const edge = Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, bottom + Math.sin(i * 2.1) * 9] as P);
    const body = `M ${x0} ${y} L ${x1} ${y} L ${edge.slice().reverse().map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ')} Z`;
    const fy = y + depth * 0.45 * frost;
    const frozen = `M ${x0} ${y} L ${x1} ${y} L ${x1} ${fy} L ${x0} ${fy} Z`;
    return (
      <g opacity={o * p}>
        <Fill d={body} tone="soil" />
        {stipple({ x0, y0: y + 4, x1, y1: bottom }, Math.round((x1 - x0) * depth * 0.0016), `${seed}st`, 1, 2.6).map(([sx, sy, sr], k) => <circle key={k} cx={sx} cy={sy} r={sr} fill={B.ink} opacity={0.45} />)}
        {frost > 0 ? (
          <g>
            <Fill d={frozen} tone="frozen" hi={frostHi} />
            {Array.from({ length: Math.round((x1 - x0) / 120) }, (_, i) => <path key={i} d={snowflakePath(x0 + 60 + i * 120, (y + fy) / 2 + (i % 2 ? 6 : -6), Math.min(18, (fy - y) * 0.32))} stroke={frostHi > 0.5 ? B.accent : B.ink} strokeWidth={1.4} fill="none" opacity={0.75} />)}
            <Line d={`M ${x0} ${fy} L ${x1} ${fy}`} w={1.4} dash="10 7" hi={frostHi} />
          </g>
        ) : null}
        <Shade d={body} side="b" o={0.35} />
        <Line d={`M ${edge.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ')}`} w={1.2} o={0.6} />
        {children}
        <Line d={`M ${x0} ${y} L ${x1} ${y}`} w={2} seed={`${seed}top`} />
        {grass ? Array.from({ length: Math.round((x1 - x0) / 46) }, (_, i) => {
          const gx = x0 + 20 + i * 46 + ((i * 17) % 11);
          return <Line key={i} d={`M ${gx - 8} ${y} q 2 -14 -4 -22 M ${gx} ${y} q 1 -18 4 -26 M ${gx + 7} ${y} q 3 -10 9 -16`} w={1.2} o={0.75} />;
        }) : null}
      </g>
    );
  };

  /** 짚 두르기 — 몸통 x 를 중심으로 y0(위)~y1(아래), 너비 w. p(0~1) = 아래부터 감긴 몫. 새끼줄 두 곳. */
  const StrawWrap: React.FC<{ x: number; y0: number; y1: number; w: number; p?: number; hi?: number; o?: number; seed?: string }> = ({ x, y0, y1, w, p = 1, hi = 0, o = 1, seed = 'sw' }) => {
    if (p <= 0 || o <= 0) return null;
    const top = y1 - (y1 - y0) * p;
    const body = `M ${x - w / 2} ${y1} C ${x - w / 2 - 6} ${(y1 + top) / 2} ${x - w / 2 - 4} ${top + 10} ${x - w / 2 + 6} ${top} L ${x + w / 2 - 6} ${top} C ${x + w / 2 + 4} ${top + 10} ${x + w / 2 + 6} ${(y1 + top) / 2} ${x + w / 2} ${y1} Z`;
    const strands = Array.from({ length: Math.round(w / 6) }, (_, i) => {
      const sx = x - w / 2 + 3 + i * 6;
      const jag = ((i * 37) % 9) - 4;
      return `M ${sx} ${y1 - 2} L ${sx + jag * 0.4} ${top - 4 - ((i * 13) % 14)}`;
    }).join(' ');
    const ties = [0.25, 0.7].map((k) => y1 - (y1 - y0) * k).filter((ty) => ty > top + 6);
    return (
      <g opacity={o}>
        <Fill d={body} tone="straw" hi={hi} />
        <path d={strands} stroke={B.ink} strokeWidth={0.9} opacity={0.55} fill="none" />
        <Shade d={body} side="r" o={0.55} />
        <Line d={body} w={1.6} seed={`${seed}b`} hi={hi} />
        {ties.map((ty, i) => <g key={i}><Fill d={`M ${x - w / 2 - 4} ${ty - 6} L ${x + w / 2 + 4} ${ty - 6} L ${x + w / 2 + 4} ${ty + 6} L ${x - w / 2 - 4} ${ty + 6} Z`} tone="bark" /><Line d={`M ${x - w / 2 - 4} ${ty - 6} L ${x + w / 2 + 4} ${ty - 6} M ${x - w / 2 - 4} ${ty + 6} L ${x + w / 2 + 4} ${ty + 6}`} w={1.3} />
          {[0, 1, 2, 3].map((k) => <path key={k} d={`M ${x - w / 2 + k * (w / 4) + 4} ${ty - 6} l 8 12`} stroke={B.ink} strokeWidth={1} />)}</g>)}
      </g>
    );
  };

  /**
   * 남한 지도(도식) — 원점 = 지도 상자 왼쪽 위, 높이 h(너비 ≈ 0.54h). region 'central'(중부)·'south'(남부) 띠를 regionP(0~1)만큼 칠한다(포인트 색 = 말하는 지역).
   * dots: [{lat, lon, hi?}] 지점 표시. 지점 화면 좌표는 mapPoint(x, y, h, lat, lon).
   */
  const KoreaMap: React.FC<{ x: number; y: number; h?: number; region?: 'central' | 'south'; regionP?: number; dots?: Array<{ lat: number; lon: number; hi?: boolean }>; at?: number; o?: number; seed?: string }> = ({ x, y, h = 560, region, regionP = 1, dots = [], at = DONE, o = 1, seed = 'map' }) => {
    const p = useAt(at, 22);
    if (p <= 0 || o <= 0) return null;
    const G = koreaGeom(h);
    const cid = `fs-mapclip-${seed}`;
    const band = region ? KOREA_REGIONS[region] : null;
    const by0 = band ? G.yOfLat(band[1]) : 0, by1 = band ? G.yOfLat(band[0]) : 0;
    return (
      <g transform={`translate(${x} ${y})`} opacity={o}>
        <defs><clipPath id={cid}><path d={`${G.outline} ${G.jeju}`} /></clipPath></defs>
        <Fill d={G.outline} tone="land" o={interpolate(p, [0.3, 1], [0, 1], clamp)} />
        <Fill d={G.jeju} tone="land" o={interpolate(p, [0.3, 1], [0, 1], clamp)} />
        {band && regionP > 0 ? (
          <g clipPath={`url(#${cid})`}>
            <Fill d={`M -20 ${by0} L ${G.w + 40} ${by0} L ${G.w + 40} ${by0 + (by1 - by0) * regionP} L -20 ${by0 + (by1 - by0) * regionP} Z`} tone="paper" hi={1} />
          </g>
        ) : null}
        <Shade d={G.outline} side="br" o={0.35 * p} />
        <Line d={G.outline} w={2} p={p} seed={`${seed}o`} />
        <Line d={G.jeju} w={1.6} p={p} />
        {band && regionP > 0.9 ? <Line d={`M ${-30} ${by1} L ${G.w + 30} ${by1}`} w={1.6} dash="9 7" hi={1} /> : null}
        {dots.map((d, i) => { const [dx, dy] = koreaXY(h, d.lat, d.lon); return <g key={i} opacity={p}><circle cx={dx} cy={dy} r={9} fill={d.hi ? B.accent : B.ink} /><circle cx={dx} cy={dy} r={15} fill="none" stroke={d.hi ? B.accent : B.ink} strokeWidth={1.4} /></g>; })}
      </g>
    );
  };

  /** 손 — 쥐는 점 (x,y). pose hold(세로 줄기를 감싸 쥠)·point(검지 끝 = 쥐는 점에서 왼쪽 96·위 34, 회전 전). angle 로 돌리고 flip 이면 좌우 반전(왼쪽에서 들어옴). */
  const Hand: React.FC<{ x: number; y: number; pose?: 'hold' | 'point'; angle?: number; scale?: number; flip?: boolean; at?: number; o?: number; hi?: number }> = ({ x, y, pose = 'hold', angle = 0, scale = 1, flip = false, at = DONE, o = 1, hi = 0 }) => {
    const p = useAt(at, 16);
    if (p <= 0 || o <= 0) return null;
    const G = handGeom(pose);
    const slide = (1 - p) * 60;
    return (
      <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${flip ? -scale : scale} ${scale}) translate(${slide} ${slide * 0.5})`} opacity={o * p}>
        <Fill d={G.arm} tone="sleeve" /><Shade d={G.arm} side="b" o={0.55} /><Line d={G.arm} w={1.8} />
        <Fill d={G.palm} tone="skin" hi={hi} /><Shade d={G.palm} side="r" o={0.4} /><Line d={G.palm} w={1.8} hi={hi} />
        {G.fingers.map((d, i) => <g key={i}><Fill d={d} tone="skin" hi={hi} /><Line d={d} w={1.6} hi={hi} /></g>)}
        <Fill d={G.thumb} tone="skin" hi={hi} /><Line d={G.thumb} w={1.6} hi={hi} />
        {G.creases.map((d, i) => <path key={i} d={d} stroke={B.ink} strokeWidth={1} fill="none" opacity={0.5} />)}
      </g>
    );
  };

  /** 눈송이 하나 — 중심 (x,y), 반지름 r. */
  const Snowflake: React.FC<{ x: number; y: number; r?: number; at?: number; p?: number; hi?: number; o?: number }> = ({ x, y, r = 34, at = DONE, p, hi = 0, o = 1 }) => {
    const pa = useAt(at, 14);
    const pp = p ?? pa;
    if (pp <= 0 || o <= 0) return null;
    return <g opacity={o} transform={`rotate(${(1 - pp) * -40} ${x} ${y})`}><Line d={snowflakePath(x, y, r * (0.6 + 0.4 * pp))} w={Math.max(1.6, r * 0.09)} p={pp} hi={hi} /></g>;
  };

  /** 내리는 눈 — 상자(x0~x1, y0~y1) 안에서 at~until 동안. 결정적. */
  const Snowfall: React.FC<{ x0: number; x1: number; y0: number; y1: number; at?: number; until?: number; n?: number; size?: number }> = ({ x0, x1, y0, y1, at = 0, until, n = 36, size = 9 }) => {
    const f = useCurrentFrame();
    const fade = interpolate(f, [at, at + 12], [0, 1], clamp) * (until == null ? 1 : 1 - interpolate(f, [until, until + 12], [0, 1], clamp));
    if (fade <= 0) return null;
    const span = y1 - y0;
    return (
      <g opacity={fade}>
        {Array.from({ length: n }, (_, i) => {
          const sx = x0 + (((i * 7919) % 1000) / 1000) * (x1 - x0);
          const speed = 1.4 + ((i * 31) % 10) / 10;
          const yy = y0 + ((((i * 4729) % 1000) / 1000) * span + (f - at) * speed) % span;
          const sw = Math.sin((f + i * 11) / 14) * 12;
          const rr = size * (0.6 + ((i * 13) % 7) / 10);
          return i % 3 === 0 ? <path key={i} d={snowflakePath(sx + sw, yy, rr)} stroke={B.ink} strokeWidth={1.1} fill="none" opacity={0.7} /> : <circle key={i} cx={sx + sw} cy={yy} r={rr * 0.35} fill={B.paper} stroke={B.ink} strokeWidth={1} opacity={0.8} />;
        })}
      </g>
    );
  };

  /** 해 — 중심 (x,y), 반지름 r. 빛살이 그어진다. */
  const Sun: React.FC<{ x: number; y: number; r?: number; at?: number; hi?: number; o?: number }> = ({ x, y, r = 46, at = DONE, hi = 0, o = 1 }) => {
    const p = useAt(at, 18);
    if (p <= 0 || o <= 0) return null;
    const rays = Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `M ${x + Math.cos(a) * r * 1.3} ${y + Math.sin(a) * r * 1.3} L ${x + Math.cos(a) * r * (i % 2 ? 1.6 : 1.8)} ${y + Math.sin(a) * r * (i % 2 ? 1.6 : 1.8)}`; }).join(' ');
    return (
      <g opacity={o}>
        <Fill d={circ(x, y, r * p)} tone="sun" hi={hi} />
        <Line d={circ(x, y, r)} w={1.8} p={p} hi={hi} />
        <Line d={rays} w={2} p={interpolate(p, [0.4, 1], [0, 1], clamp)} hi={hi} />
      </g>
    );
  };

  /** 물방울 — 끝 (x,y) 이 위, 반지름 r. */
  const Drop: React.FC<{ x: number; y: number; r?: number; at?: number; hi?: number; o?: number }> = ({ x, y, r = 22, at = DONE, hi = 0, o = 1 }) => {
    const p = useAt(at, 12);
    if (p <= 0 || o <= 0) return null;
    const d = `M ${x} ${y} C ${x + r * 0.3} ${y + r * 0.8} ${x + r} ${y + r * 1.3} ${x + r} ${y + r * 1.9} A ${r} ${r} 0 1 1 ${x - r} ${y + r * 1.9} C ${x - r} ${y + r * 1.3} ${x - r * 0.3} ${y + r * 0.8} ${x} ${y} Z`;
    return <g opacity={o * p} transform={`translate(0 ${(1 - p) * -20})`}><Fill d={d} tone="water" hi={hi} /><Line d={d} w={1.6} hi={hi} /></g>;
  };

  /** 달력 띠 — 왼쪽 위 (x,y)에서 months 칸(cell 크기)을 가로로. hiMonth 칸을 hi 만큼 포인트 색. 글자는 'N월'. */
  const MonthStrip: React.FC<{ x: number; y: number; months: number[]; hiMonth?: number; hi?: number; cell?: number; at?: number; o?: number }> = ({ x, y, months, hiMonth, hi = 0, cell = 120, at = DONE, o = 1 }) => {
    const f = useCurrentFrame();
    if (o <= 0) return null;
    return (
      <g opacity={o}>
        {months.map((m, i) => {
          const p = interpolate(f, [at + i * 5, at + i * 5 + 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          if (p <= 0) return null;
          const cx = x + i * (cell + 14), h = cell * 1.1;
          const box = `M ${cx} ${y + 18} L ${cx + cell} ${y + 18} L ${cx + cell} ${y + h} L ${cx} ${y + h} Z`;
          const isHi = m === hiMonth;
          return (
            <g key={m} opacity={p} transform={`translate(0 ${(1 - p) * 16})`}>
              <Fill d={box} tone="calendar" hi={isHi ? hi : 0} />
              <Line d={box} w={1.8} hi={isHi ? hi : 0} />
              <Line d={`M ${cx} ${y + 18 + cell * 0.24} L ${cx + cell} ${y + 18 + cell * 0.24}`} w={1.3} />
              {[0.28, 0.72].map((k) => <Line key={k} d={`M ${cx + cell * k} ${y + 6} L ${cx + cell * k} ${y + 30}`} w={3} />)}
              <text x={cx + cell / 2} y={y + 18 + cell * 0.78} textAnchor="middle" fontFamily={B.font} fontWeight={B.fontWeight} fontSize={cell * 0.38} fill={isHi && hi > 0.5 ? B.accent : B.ink}>{`${m}월`}</text>
            </g>
          );
        })}
      </g>
    );
  };

  /** 양분 항아리 — 바닥 가운데 (x,y), 너비 w·높이 h. value(0~1) = 채운 몫(알갱이). hi = 채움 포인트 색. 밑천·저장량 비교용. */
  const Reserve: React.FC<{ x: number; y: number; w?: number; h?: number; value: number; at?: number; hi?: number; o?: number; seed?: string }> = ({ x, y, w = 170, h = 210, value, at = DONE, hi = 0, o = 1, seed = 'rv' }) => {
    const p = useAt(at, 16);
    if (p <= 0 || o <= 0) return null;
    const nw = w * 0.56, sh = h * 0.16;
    const body = `M ${x - nw / 2} ${y - h + sh} C ${x - w / 2 - 6} ${y - h + sh + 20} ${x - w / 2 - 4} ${y - 30} ${x - w / 2 + 10} ${y - 6} Q ${x} ${y + 8} ${x + w / 2 - 10} ${y - 6} C ${x + w / 2 + 4} ${y - 30} ${x + w / 2 + 6} ${y - h + sh + 20} ${x + nw / 2} ${y - h + sh} Z`;
    const lid = `M ${x - nw / 2 - 8} ${y - h} L ${x + nw / 2 + 8} ${y - h} L ${x + nw / 2 + 8} ${y - h + sh} L ${x - nw / 2 - 8} ${y - h + sh} Z`;
    const top = y - 8 - (h - sh - 14) * Math.max(0, Math.min(1, value));
    const cid = `fs-resclip-${seed}`;
    return (
      <g opacity={o * p}>
        <defs><clipPath id={cid}><path d={body} /></clipPath></defs>
        <Fill d={body} tone="glass" />
        {value > 0 ? (
          <g clipPath={`url(#${cid})`}>
            <Fill d={`M ${x - w} ${top} L ${x + w} ${top} L ${x + w} ${y + 10} L ${x - w} ${y + 10} Z`} tone="store" hi={hi} />
            {stipple({ x0: x - w / 2, y0: top, x1: x + w / 2, y1: y }, Math.round(w * (y - top) * 0.012), `${seed}s`, 2, 4).map(([sx, sy, sr], k) => <circle key={k} cx={sx} cy={sy} r={sr} fill={hi > 0.5 ? B.accent : B.ink} opacity={0.7} />)}
            <Line d={`M ${x - w / 2} ${top} Q ${x} ${top - 6} ${x + w / 2} ${top}`} w={1.4} />
          </g>
        ) : null}
        <Shade d={body} side="r" o={0.5} />
        <Line d={body} w={2} seed={`${seed}b`} />
        <Fill d={lid} tone="bark" /><Line d={lid} w={1.8} />
      </g>
    );
  };

  return { Leaf, Persimmon, Tree, GroundLine, GroundSection, StrawWrap, KoreaMap, Hand, Snowflake, Snowfall, Sun, Drop, MonthStrip, Reserve };
}

/** 지도 지점의 화면 좌표 — KoreaMap 과 같은 (x,y,h)를 준다. */
export function mapPoint(x: number, y: number, h: number, lat: number, lon: number): { x: number; y: number } {
  const [px, py] = koreaXY(h, lat, lon);
  return { x: x + px, y: y + py };
}
/** 감나무 치수(배치·라벨 자리용) — Tree 와 같은 (seed, h, age). trunkTop(몸통 끝 y, 밑동 기준 음수)·trunkW·crown 상자·graftY. */
export function treeBox(seed: string, h: number, age: TreeAge = 'mature') {
  const g = treeGeom(seed, h, age);
  return { trunkTop: g.trunk.top, trunkW: g.trunk.w0, crown: g.crown, graftY: g.graftY };
}
