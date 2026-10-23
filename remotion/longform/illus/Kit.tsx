// 롱폼 일러스트 부품(정교판) — 빛은 왼쪽 위에서 든다. 모든 형태에 명암 그라디언트·바닥 그림자.
// 가지: 가늘어지는 윤곽 + 껍질 결 질감(feTurbulence) + 빛 받는 면. 나무: 줄기→굵은 가지→잔가지→끝가지(growTree).
// 잎: 네 가지 초록 톤, 반쪽 명암, 테두리, 잎맥, 송이. 사람: 얼굴·밀짚모자 결·셔츠 깃·앞치마·장갑·장화.
// 좌표는 도해 viewBox(1000×620) 기준. 움직임은 모두 프레임으로 정해진다(결정적).
import React from 'react';
import { Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { castShadowPts, growTree, rootPaths, lightSide, pointAt, ribLine, shiftPts, taperOutline, type P } from './geom';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const useGrow = (at: number, dur = 20) => {
  const f = useCurrentFrame();
  return interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
};

export const C = {
  barkDark: '#4e3019', bark: '#86583a', barkLight: '#c6956a',
  leafDark: '#2f6a2a', leaf: '#5f9e45', leafLight: '#a8d688',
  greyBark: '#8f8a80', soil: '#4f3a28', soilLight: '#7d5c40',
  skin: '#eab792', skinShade: '#c98f6b', shirt: '#3f7194', shirtShade: '#2c5675', pants: '#4b5262', pantsShade: '#363c49',
  apron: '#c9b27f', apronShade: '#a48e5e', glove: '#b07a45', boot: '#2f2a25',
  straw: '#e8cb85', strawDark: '#b8964f', steel: '#d6dde2', steelDark: '#7f8b95', grip: '#c0392b', gripDark: '#8e271c',
};

const LEAF_FILLS = ['url(#kit-leaf-a)', 'url(#kit-leaf-b)', 'url(#kit-leaf-c)', 'url(#kit-leaf-d)'];

/** 공통 그라디언트·필터 — 도해 svg 안에 한 번 둔다. */
export const KitDefs: React.FC = () => (
  <defs>
    <linearGradient id="kit-bark" x1="0" y1="0" x2="1" y2="0.15">
      <stop offset="0" stopColor={C.barkLight} /><stop offset="0.35" stopColor={C.bark} />
      <stop offset="0.8" stopColor={C.barkDark} /><stop offset="1" stopColor="#3a2312" />
    </linearGradient>
    <linearGradient id="kit-grey" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#b1aca2" /><stop offset="0.45" stopColor={C.greyBark} /><stop offset="1" stopColor="#5d5953" />
    </linearGradient>
    <linearGradient id="kit-new" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#b8e08a" /><stop offset="0.5" stopColor="#7fb85a" /><stop offset="1" stopColor="#4d8a34" />
    </linearGradient>
    {[['a', '#b5df8f', '#3f7d33'], ['b', '#9fcf73', '#2f6a2a'], ['c', '#c6e39a', '#5a9142'], ['d', '#8cc067', '#2a5d25']].map(([k, a, b]) => (
      <linearGradient key={k} id={`kit-leaf-${k}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={a} /><stop offset="0.5" stopColor={a} /><stop offset="0.5" stopColor={b} /><stop offset="1" stopColor={b} />
      </linearGradient>
    ))}
    <linearGradient id="kit-soil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={C.soilLight} /><stop offset="1" stopColor={C.soil} />
    </linearGradient>
    <linearGradient id="kit-steel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#f6f8fa" /><stop offset="0.5" stopColor={C.steel} /><stop offset="1" stopColor={C.steelDark} />
    </linearGradient>
    <linearGradient id="kit-grip" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#e05a48" /><stop offset="1" stopColor={C.gripDark} />
    </linearGradient>
    <linearGradient id="kit-shirt" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#5a8db0" /><stop offset="0.55" stopColor={C.shirt} /><stop offset="1" stopColor={C.shirtShade} />
    </linearGradient>
    <linearGradient id="kit-pants" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#5d6577" /><stop offset="1" stopColor={C.pantsShade} />
    </linearGradient>
    <linearGradient id="kit-apron" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#dcc796" /><stop offset="1" stopColor={C.apronShade} />
    </linearGradient>
    <radialGradient id="kit-skin" cx="0.35" cy="0.35" r="0.75">
      <stop offset="0" stopColor="#f6cfb0" /><stop offset="1" stopColor={C.skinShade} />
    </radialGradient>
    <radialGradient id="kit-straw" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stopColor="#f6e0a6" /><stop offset="1" stopColor={C.strawDark} />
    </radialGradient>
    <radialGradient id="kit-sky" cx="0.2" cy="0.1" r="1">
      <stop offset="0" stopColor="#fff3c9" stopOpacity="0.22" /><stop offset="0.6" stopColor="#9cc4d8" stopOpacity="0.06" /><stop offset="1" stopColor="#000" stopOpacity="0" />
    </radialGradient>
    <linearGradient id="kit-sky-lin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#a9d6ec" /><stop offset="0.55" stopColor="#d8ecf2" /><stop offset="1" stopColor="#f4e6c4" />
    </linearGradient>
    <radialGradient id="kit-sun">
      <stop offset="0" stopColor="#fff4c2" stopOpacity="0.95" /><stop offset="0.35" stopColor="#ffe9a0" stopOpacity="0.45" /><stop offset="1" stopColor="#ffe9a0" stopOpacity="0" />
    </radialGradient>
    <linearGradient id="kit-pot" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#5b6068" /><stop offset="0.4" stopColor="#3f444b" /><stop offset="1" stopColor="#24272b" />
    </linearGradient>
    <radialGradient id="kit-coin" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stopColor="#f4f6f8" /><stop offset="1" stopColor="#a9b0b6" />
    </radialGradient>
    <radialGradient id="kit-wood" cx="0.45" cy="0.42" r="0.7">
      <stop offset="0" stopColor="#f2d6a4" /><stop offset="1" stopColor="#cf9d62" />
    </radialGradient>
    <linearGradient id="kit-macro" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#9fbf86" /><stop offset="0.5" stopColor="#6f9356" /><stop offset="1" stopColor="#3f5a33" />
    </linearGradient>
    <radialGradient id="kit-vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.6" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.35" />
    </radialGradient>
    <filter id="kit-bokeh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22" /></filter>
    <clipPath id="kit-frame"><rect x={0} y={0} width={1000} height={620} rx={28} /></clipPath>
    <radialGradient id="kit-glow">
      <stop offset="0" stopColor="#ffd54a" stopOpacity="0.9" /><stop offset="1" stopColor="#ffd54a" stopOpacity="0" />
    </radialGradient>
    {/* 세밀화(2026-10-19): 껍질 요철 — 잡음 높이맵에 왼쪽 위 빛을 비춰(diffuse lighting) 형태 색에 곱한다. */}
    <filter id="kit-bark-relief" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.08 0.22" numOctaves="4" seed="11" result="n" />
      <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale="1.7" diffuseConstant="1.12" result="light">
        <feDistantLight azimuth="225" elevation="48" />
      </feDiffuseLighting>
      <feComposite in="light" in2="SourceGraphic" operator="arithmetic" k1="1.05" k2="0" k3="0" k4="0" result="lit" />
      <feComposite in="lit" in2="SourceGraphic" operator="in" />
    </filter>
    <filter id="kit-soil-tex" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="5" result="n" />
      <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale="1.6" result="light"><feDistantLight azimuth="225" elevation="55" /></feDiffuseLighting>
      <feComposite in="light" in2="SourceGraphic" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="lit" />
      <feComposite in="lit" in2="SourceGraphic" operator="in" />
    </filter>
    <filter id="kit-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" /></filter>
    <filter id="kit-blur1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1" /></filter>
    {/* 나뭇결 — 줄기가 선 방향으로 길쭉한 잡음에 빛을 비춰 결을 낸다(세로 줄기 / 가로 가지 따로). */}
    {[['v', '0.6 0.035'], ['h', '0.035 0.6']].map(([k, f]) => (
      <filter key={k} id={`kit-grain-${k}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency={f} numOctaves="3" seed="21" result="n" />
        <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale="1.3" diffuseConstant="1.18" result="light"><feDistantLight azimuth="225" elevation="50" /></feDiffuseLighting>
        <feComposite in="light" in2="SourceGraphic" operator="arithmetic" k1="1.02" k2="0" k3="0" k4="0" result="lit" />
        <feComposite in="lit" in2="SourceGraphic" operator="in" />
      </filter>
    ))}
    <filter id="kit-rough" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="3" result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <filter id="kit-haze" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.2" /></filter>
    {[['a', '#c7e6a4', '#4d8a3a', '#2b5e24'], ['b', '#b4d98d', '#3f7d33', '#244f20'], ['c', '#d3ebb0', '#5e9a46', '#36692b'], ['d', '#a6cf7f', '#376f2c', '#1f4a1b']].map(([k, a, b, c]) => (
      <radialGradient key={`r${k}`} id={`kit-leafr-${k}`} cx="0.42" cy="0.45" r="0.62">
        <stop offset="0" stopColor={a} /><stop offset="0.55" stopColor={b} /><stop offset="1" stopColor={c} />
      </radialGradient>
    ))}
    <radialGradient id="kit-leafr-back" cx="0.45" cy="0.45" r="0.65">
      <stop offset="0" stopColor="#9fbf93" /><stop offset="1" stopColor="#4f7556" />
    </radialGradient>
    <radialGradient id="kit-bud" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stopColor="#c98f5c" /><stop offset="0.5" stopColor="#8e5f37" /><stop offset="1" stopColor="#4a2f18" />
    </radialGradient>
    <radialGradient id="kit-fruit" cx="0.35" cy="0.32" r="0.75">
      <stop offset="0" stopColor="#ffb39a" /><stop offset="0.45" stopColor="#d9473a" /><stop offset="1" stopColor="#7a1f17" />
    </radialGradient>
    {/* 껍질 결 — 세로로 길쭉한 잡음을 형태 안에만 어둡게 얹는다. */}
    <filter id="kit-bark-tex" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9 0.06" numOctaves="2" seed="7" result="n" />
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.05" result="streak" />
      <feComposite in="streak" in2="SourceGraphic" operator="in" result="tex" />
      <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="tex" /></feMerge>
    </filter>
    {/* 확대 줄기 껍질 — 결 방향으로 길쭉한 요철에 빛을 비추고, 그물처럼 갈라진 틈을 어둡게 판다(세로 v / 가로 h). */}
    {[['v', '0.07 0.011', '0.03 0.005'], ['h', '0.011 0.07', '0.005 0.03']].map(([k, fn, ft]) => (
      <filter key={`m${k}`} id={`kit-barkM-${k}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency={fn} numOctaves="4" seed="31" result="n" />
        <feTurbulence type="turbulence" baseFrequency={ft} numOctaves="2" seed="17" result="t" />
        <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -7 0 0 0 1.15" result="crack" />
        <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale="4.5" diffuseConstant="1.18" result="lt"><feDistantLight azimuth="205" elevation="42" /></feDiffuseLighting>
        <feComposite in="lt" in2="SourceGraphic" operator="arithmetic" k1="1.18" k2="0" k3="0" k4="0" result="lit" />
        <feFlood floodColor="#120c08" floodOpacity="0.8" result="ink" />
        <feComposite in="ink" in2="crack" operator="in" result="cracks" />
        <feMerge result="m"><feMergeNode in="lit" /><feMergeNode in="cracks" /></feMerge>
        <feComposite in="m" in2="SourceGraphic" operator="in" />
      </filter>
    ))}
    <filter id="kit-blur4" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" /></filter>
    <filter id="kit-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="3" dy="5" stdDeviation="4" floodColor="#000" floodOpacity="0.35" />
    </filter>
  </defs>
);

/** 확대 장면 표시 — 참이면 땅·하늘 대신 초점이 나간 숲(보케) 배경을 쓴다. 나무의 일부를 가까이 본 것으로 읽히게. */
export const MacroCtx = React.createContext(false);

/** 확대 배경 — 초점이 나간 잎과 빛망울(보케), 가장자리 어둡게. */
export const MacroBackdrop: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <g clipPath="url(#kit-frame)">
      <rect x={0} y={0} width={1000} height={620} fill="url(#kit-macro)" />
      <g filter="url(#kit-bokeh)">
        {Array.from({ length: 22 }, (_, i) => {
          const cx = random(`mb${i}`) * 1000, cy = random(`mby${i}`) * 620;
          const r = 30 + random(`mbr${i}`) * 70;
          const col = ['#4f7a3a', '#6d9a4c', '#3c5f2e', '#8db66a', '#5b7f45'][i % 5];
          return <circle key={i} cx={cx + Math.sin(f / 90 + i) * 6} cy={cy} r={r} fill={col} opacity={0.55} />;
        })}
      </g>
      {Array.from({ length: 10 }, (_, i) => {
        const cx = random(`bk${i}`) * 1000, cy = random(`bky${i}`) * 620, r = 10 + random(`bkr${i}`) * 22;
        return <circle key={`b${i}`} cx={cx} cy={cy} r={r} fill="#fff6d0" opacity={0.18 + 0.08 * Math.sin(f / 20 + i)} filter="url(#kit-blur1)" />;
      })}
      <rect x={0} y={0} width={1000} height={620} fill="url(#kit-vignette)" />
    </g>
  );
};

/** 도해 배경 — 밝은 장면: 하늘, 해와 빛무리, 흘러가는 구름, 먼 산 능선, 들판. 확대 장면이면 보케 배경. */
export const Backdrop: React.FC = () => {
  const macro = React.useContext(MacroCtx);
  if (macro) return <MacroBackdrop />;
  return <SceneBackdrop />;
};

const SceneBackdrop: React.FC = () => {
  const f = useCurrentFrame();
  const cloud = (cx: number, cy: number, k: number, speed: number) => {
    const x = ((cx + f * speed) % 1200) - 100;
    return (
      <g transform={`translate(${x} ${cy}) scale(${k})`} opacity={0.9} filter="url(#kit-haze)">
        <ellipse cx={0} cy={0} rx={60} ry={20} fill="#fff" /><ellipse cx={-30} cy={-12} rx={34} ry={22} fill="#fff" />
        <ellipse cx={22} cy={-18} rx={40} ry={26} fill="#fff" /><ellipse cx={0} cy={6} rx={70} ry={12} fill="#e6eef3" />
      </g>
    );
  };
  return (
    <g clipPath="url(#kit-frame)">
      <rect x={0} y={0} width={1000} height={620} fill="url(#kit-sky-lin)" />
      <circle cx={130} cy={96} r={120} fill="url(#kit-sun)" />
      <circle cx={130} cy={96} r={34} fill="#fff6d8" />
      {cloud(260, 90, 0.9, 0.25)}{cloud(760, 60, 0.7, 0.18)}{cloud(1080, 130, 0.6, 0.3)}
      <path d="M 0 430 Q 160 330 340 400 T 700 380 T 1000 400 L 1000 620 L 0 620 Z" fill="#9fc29a" opacity={0.75} />
      {/* 먼 나무 줄 — 흐릿하고 푸르게(대기 원근) */}
      <g filter="url(#kit-haze)" opacity={0.55}>
        {Array.from({ length: 26 }, (_, i) => {
          const tx = i * 40 + (i % 3) * 7, ty = 420 - Math.sin(i * 0.7) * 18 - (i % 2) * 6;
          return <g key={i}><rect x={tx - 2} y={ty} width={4} height={24} fill="#5d7a63" /><ellipse cx={tx} cy={ty - 6} rx={16 + (i % 4) * 3} ry={18 + (i % 3) * 4} fill="#6f9474" /></g>;
        })}
      </g>
      <path d="M 0 480 Q 220 420 460 470 T 1000 450 L 1000 620 L 0 620 Z" fill="#86b47c" />
      <path d="M 0 530 Q 300 500 600 528 T 1000 520 L 1000 620 L 0 620 Z" fill="#76a86b" />
    </g>
  );
};

/** 가위가 닫힐 때 튀는 나뭇조각. */
export const Chips: React.FC<{ x: number; y: number; at: number; n?: number }> = ({ x, y, at, n = 9 }) => {
  const f = useCurrentFrame();
  const t = f - at;
  if (t < 0 || t > 30) return null;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const ang = (random(`chip${at}${i}`) * 2 - 1) * Math.PI;
        const v = 4 + random(`chipv${at}${i}`) * 5;
        const px = x + Math.cos(ang) * v * t, py = y + Math.sin(ang) * v * t + 0.35 * t * t;
        return <rect key={i} x={px} y={py} width={6} height={3} rx={1} fill={i % 2 ? C.barkLight : '#e8d2a8'} opacity={1 - t / 30} transform={`rotate(${t * 20 + i * 40} ${px} ${py})`} />;
      })}
    </g>
  );
};

/** 카메라 — 도해 전체가 천천히 당겨지고, focus 가 있으면 at 부터 그 점으로 확대해 들어간다. */
export const Camera: React.FC<{ frames: number; focus?: { x: number; y: number; at: number; scale?: number }; children: React.ReactNode }> = ({ frames, focus, children }) => {
  const f = useCurrentFrame();
  const push = interpolate(f, [0, Math.max(1, frames)], [1, 1.04], clamp);
  const z = focus ? interpolate(f, [focus.at, focus.at + 22], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) }) : 0;
  const k = push * (1 + ((focus?.scale ?? 1.6) - 1) * z);
  const cx = focus ? 500 + (focus.x - 500) * z : 500, cy = focus ? 310 + (focus.y - 310) * z : 310;
  return <g transform={`translate(500 310) scale(${k}) translate(${-cx} ${-cy})`}>{children}</g>;
};

/** 확대 줄기 바탕색 — 필터 빛이 곱해져 어두워지므로 한 톤 밝게 둔다. */
const MACRO_BARK = '#7d6d5f';

/** 껍질 팔레트 — 그늘면·중간면·빛 받는 면·골. */
const BARK: Record<string, { dark: string; mid: string; light: string; furrow: string | null }> = {
  // 과실나무 껍질은 주황기 없는 회갈색(사과·감·매실 실물 기준).
  'url(#kit-bark)': { dark: '#2a211b', mid: '#5c4c40', light: '#a39383', furrow: '#17110c' },
  'url(#kit-grey)': { dark: '#46423c', mid: '#837d73', light: '#c4beb3', furrow: '#2f2c28' },
  'url(#kit-new)': { dark: '#355e24', mid: '#679843', light: '#b0d985', furrow: null },
};

/** 가늘어지는 가지(세밀화) — 원통 명암(그늘면 → 중간면 → 빛 받는 면을 빛 쪽으로 밀어 겹침),
 *  가지 방향을 따라 흐르는 껍질 골, 거친 윤곽, 갈라지는 자리 그늘. 자라나며 나타난다. */
export const Branch: React.FC<{ pts: P[]; w0: number; w1: number; at?: number; dur?: number; fill?: string; stroke?: string; opacity?: number; texture?: boolean;
  /** 밑동 부풀림(지륭) — 부모에 붙은 가지에만 준다(기본 0). */ flare?: number; /** 부푸는 구간(길이 비율, 기본 0.15). */ flareLen?: number; /** 지륭 위 껍질 주름 능선. */ ridge?: boolean; /** 껍질눈·옹이 같은 잔디테일. */ detail?: boolean }> = ({ pts, w0, w1, at = 0, dur = 20, fill = 'url(#kit-bark)', stroke, opacity = 1, flare: flareIn, ridge = false, detail = true, flareLen = 0.15 }) => {
  const p = useGrow(at, dur);
  if (p <= 0) return null;
  const pal = BARK[fill];
  if (!pal) {
    return <g opacity={opacity}><path d={taperOutline(pts, w0, w1, p)} fill={fill} {...(stroke ? { stroke, strokeWidth: 3 } : {})} /></g>;
  }
  const sgn = lightSide(pts);
  const flare = flareIn ?? 0;
  // 확대 줄기는 지륭 곡선이 매끄럽게 표본을 촘촘히.
  const T = (pp: P[], a: number, b: number) => taperOutline(pp, a, b, p, w0 >= 30 ? 96 : 32, flare, flareLen);
  // 가지 방향(밑동) — 지륭 위 껍질 주름 능선의 방향을 잡는다.
  const d0x = pts[1]![0] - pts[0]![0], d0y = pts[1]![1] - pts[0]![1];
  const d0l = Math.hypot(d0x, d0y) || 1;
  const ux = d0x / d0l, uy = d0y / d0l;
  const seed = `${pts[0]![0].toFixed(0)}:${pts[0]![1].toFixed(0)}:${w0.toFixed(1)}`;
  const nFur = pal.furrow && w0 >= 9 ? Math.max(2, Math.min(7, Math.round(w0 / 9))) : 0;
  const dxy = [pts[pts.length - 1]![0] - pts[0]![0], pts[pts.length - 1]![1] - pts[0]![1]];
  const vertical = Math.abs(dxy[1]!) > Math.abs(dxy[0]!);
  // 확대 장면의 굵은 줄기·가지 — 판자처럼 보이지 않게 원통 명암 띠를 겹치고, 껍질 요철·틈은 필터가 맡는다.
  if (pal.furrow && w0 >= 30) {
    const cid = `bm${seed.replace(/[^0-9a-z]/gi, '_')}`;
    const outline = T(pts, w0, w1);
    const bands = 14;
    return (
      <g opacity={opacity}>
        <defs><clipPath id={cid}><path d={outline} /></clipPath></defs>
        <path d={outline} fill={MACRO_BARK} filter={vertical ? 'url(#kit-barkM-v)' : 'url(#kit-barkM-h)'} />
        <g clipPath={`url(#${cid})`}>
          {/* 원통 명암 — 빛 쪽(-sgn) 30% 지점이 가장 밝고 반대쪽 가장자리로 갈수록 어둡다 */}
          <g filter="url(#kit-blur4)">
            {Array.from({ length: bands }, (_, i) => {
              const frac = -1 + (2 * (i + 0.5)) / bands;
              const lit = Math.cos(((frac * -sgn - 0.35) / 1.35) * Math.PI * 0.5);
              const dark = Math.max(0, 1 - lit) * 0.62;
              return <path key={i} d={ribLine(pts, w0, w1, frac, p)} stroke="#0c0805" strokeWidth={(w0 / bands) * 1.25} fill="none" opacity={dark} />;
            })}
            <path d={ribLine(pts, w0, w1, -sgn * 0.42, p)} stroke={pal.light} strokeWidth={w0 * 0.12} fill="none" opacity={0.22} />
          </g>
          {/* 가장자리 반사광 — 그늘 쪽 테두리에 아주 엷게 */}
          <path d={ribLine(pts, w0, w1, sgn * 0.9, p)} stroke="#8a8f86" strokeWidth={w0 * 0.03} fill="none" opacity={0.25} filter="url(#kit-blur1)" />
          {/* 옹이·옛 가지치기 자국 — 굳은살이 둥글게 감싸 부푼 자리(진한 동심원 대신 부드러운 고리) */}
          {detail && w0 >= 36 && p > 0.6 ? [0.35, 0.68].slice(0, 1 + Math.floor(random(`${seed}kn`) * 2)).map((t, i) => {
            const [kx, ky] = pointAt(pts, t);
            const off = (random(`${seed}ko${i}`) - 0.5) * w0 * 0.3;
            const rx = w0 * (vertical ? 0.11 : 0.16), ry = w0 * (vertical ? 0.16 : 0.11);
            return (
              <g key={`kn${i}`} transform={`translate(${(kx + off).toFixed(1)} ${ky.toFixed(1)})`}>
                <ellipse rx={rx * 1.9} ry={ry * 1.7} fill="#0c0805" opacity={0.3} filter="url(#kit-blur4)" />
                <ellipse rx={rx * 1.45} ry={ry * 1.35} fill={MACRO_BARK} filter={vertical ? 'url(#kit-barkM-v)' : 'url(#kit-barkM-h)'} />
                <ellipse cx={-rx * 0.35} cy={-ry * 0.35} rx={rx * 1.1} ry={ry * 1.0} fill={pal.light} opacity={0.25} filter="url(#kit-blur1)" />
                <ellipse rx={rx * 0.62} ry={ry * 0.6} fill="#1a120c" />
                <ellipse cx={rx * 0.1} cy={ry * 0.1} rx={rx * 0.45} ry={ry * 0.42} fill="#4a3a2c" opacity={0.7} filter="url(#kit-blur1)" />
              </g>
            );
          }) : null}
        </g>
      </g>
    );
  }
  return (
    <g opacity={opacity}>
      <path d={T(pts, w0, w1)} fill={pal.dark} {...(w0 >= 14 ? { filter: 'url(#kit-rough)' } : {})} />
      <path d={T(shiftPts(pts, sgn * w0 * 0.07), w0 * 0.8, w1 * 0.8)} fill={pal.mid} {...(pal.furrow && w0 >= 12 ? { filter: vertical ? 'url(#kit-grain-v)' : 'url(#kit-grain-h)' } : {})} />
      <path d={T(shiftPts(pts, sgn * w0 * 0.24), w0 * 0.34, w1 * 0.34)} fill={pal.light} opacity={0.75} {...(w0 >= 8 ? { filter: 'url(#kit-blur1)' } : {})} />
      {Array.from({ length: nFur }, (_, i) => {
        const frac = -0.82 + (1.64 * (i + 0.5)) / nFur + (random(`${seed}f${i}`) - 0.5) * 0.12;
        // 길고 불규칙한 골 — 바느질 점선처럼 보이지 않게 긴 선에 드문 끊김.
        const dash = `${40 + random(`${seed}d${i}`) * 90} ${3 + random(`${seed}g${i}`) * 8} ${20 + random(`${seed}e${i}`) * 50} ${2 + random(`${seed}h${i}`) * 6}`;
        const lit = frac * -sgn > 0 ? 0.2 : 0.42;
        return <path key={i} d={ribLine(pts, w0, w1, frac, p * (0.75 + random(`${seed}l${i}`) * 0.25))} stroke={pal.furrow!} strokeWidth={Math.max(0.7, w0 * 0.028)} strokeDasharray={dash} strokeDashoffset={random(`${seed}o${i}`) * 60} strokeLinecap="round" fill="none" opacity={lit} />;
      })}
      {nFur ? <path d={ribLine(pts, w0, w1, -sgn * 0.45, p * 0.9)} stroke={pal.light} strokeWidth={Math.max(0.6, w0 * 0.025)} strokeDasharray="14 9 5 7" fill="none" opacity={0.35} /> : null}
      {w0 >= 8 ? <circle cx={pts[0]![0]} cy={pts[0]![1]} r={w0 * 0.5} fill="#140b04" opacity={0.2} filter="url(#kit-blur1)" /> : null}
      {/* 지륭 위 가지 껍질 주름 능선 — 갈라지는 자리 바로 위(부모 쪽)에 활 모양으로 접힌 껍질 */}
      {pal.furrow && ridge && w0 >= 5 && p > 0.15 ? (() => {
        const [bx, by] = pts[0]!; const nx = -uy, ny = ux; const h = w0 * 0.75;
        const back = w0 * 0.35;
        return (
          <g opacity={Math.min(1, p * 2)}>
            <path d={`M ${bx + nx * h - ux * back * 0.3} ${by + ny * h - uy * back * 0.3} Q ${bx - ux * back * 1.6} ${by - uy * back * 1.6} ${bx - nx * h - ux * back * 0.3} ${by - ny * h - uy * back * 0.3}`} stroke={pal.furrow} strokeWidth={Math.max(0.8, w0 * 0.07)} fill="none" strokeLinecap="round" opacity={0.55} />
            <path d={`M ${bx + nx * h * 0.7 - ux * back * 0.6} ${by + ny * h * 0.7 - uy * back * 0.6} Q ${bx - ux * back * 2.1} ${by - uy * back * 2.1} ${bx - nx * h * 0.7 - ux * back * 0.6} ${by - ny * h * 0.7 - uy * back * 0.6}`} stroke={pal.light} strokeWidth={Math.max(0.6, w0 * 0.04)} fill="none" strokeLinecap="round" opacity={0.4} />
          </g>
        );
      })() : null}
      {/* 껍질눈 — 어린 가지 겉의 가로로 난 작은 숨구멍 */}
      {detail && pal.furrow && w0 >= 5 && w0 <= 34 ? Array.from({ length: Math.max(2, Math.round(w0 * 0.6)) }, (_, i) => {
        const t = 0.15 + random(`${seed}lt${i}`) * 0.75;
        if (t > p) return null;
        const [lx, ly] = pointAt(pts, t);
        const [ax, ay] = pointAt(pts, Math.min(1, t + 0.02));
        const ang = Math.atan2(ay - ly, ax - lx);
        const off = (random(`${seed}lo${i}`) - 0.5) * w0 * 0.55 * (1 - t * 0.5);
        const cx2 = lx - Math.sin(ang) * off, cy2 = ly + Math.cos(ang) * off;
        const L = Math.max(1.5, w0 * 0.16);
        return <path key={`lt${i}`} d={`M ${cx2 - Math.sin(ang) * L / 2} ${cy2 + Math.cos(ang) * L / 2} L ${cx2 + Math.sin(ang) * L / 2} ${cy2 - Math.cos(ang) * L / 2}`} stroke="#e3cba6" strokeWidth={Math.max(0.8, w0 * 0.05)} strokeLinecap="round" opacity={0.55} />;
      }) : null}
      {/* 옹이·옛 가지치기 자국 — 굵은 줄기에만 */}
      {detail && pal.furrow && w0 >= 36 && p > 0.6 ? [0.35, 0.68].slice(0, 1 + Math.floor(random(`${seed}kn`) * 2)).map((t, i) => {
        const [kx, ky] = pointAt(pts, t);
        const off = (random(`${seed}ko${i}`) - 0.5) * w0 * 0.35;
        const rx = w0 * 0.13, ry = w0 * 0.09;
        return (
          <g key={`kn${i}`} transform={`translate(${kx + off} ${ky})`}>
            <ellipse rx={rx * 1.6} ry={ry * 1.7} fill="none" stroke={pal.furrow!} strokeWidth={1.2} opacity={0.45} />
            <ellipse rx={rx} ry={ry} fill="#2a180a" />
            <ellipse rx={rx * 0.6} ry={ry * 0.55} fill="#7a5533" />
            <ellipse rx={rx * 0.25} ry={ry * 0.22} fill="#3a2210" />
          </g>
        );
      }) : null}
      {stroke ? <path d={T(pts, w0, w1)} fill="none" stroke={stroke} strokeWidth={3} /> : null}
    </g>
  );
};

export type LeafShape = 'oval' | 'broad' | 'serrate' | 'small';

/** 잎 외곽선 — oval(일반), broad(감: 넓고 둥근), serrate(매실·자두·사과: 톱니), small(블루베리: 작은 타원). */
function leafBody(s: number, shape: LeafShape): string {
  if (shape === 'serrate') {
    const top: string[] = [], bot: string[] = [];
    const N = 22;
    for (let i = 1; i < N; i++) {
      const t = i / N;
      const half = Math.sin(Math.PI * Math.pow(t, 0.8)) * s * 0.31;
      const tooth = i % 2 ? 1.04 : 0.97;
      top.push(`L ${(s * (0.1 + 0.9 * t)).toFixed(1)} ${(-half * tooth).toFixed(1)}`);
      bot.unshift(`L ${(s * (0.1 + 0.9 * t)).toFixed(1)} ${(half * tooth).toFixed(1)}`);
    }
    return `M ${s * 0.1} 0 ${top.join(' ')} L ${s} 0 ${bot.join(' ')} Z`;
  }
  const w = shape === 'broad' ? 0.46 : shape === 'small' ? 0.26 : 0.34;
  const k = shape === 'small' ? 0.72 : 1;
  const L = s * k;
  return `M ${s * 0.1} 0 C ${L * 0.28} ${-s * w}, ${L * 0.8} ${-s * w * 0.9}, ${L} 0 C ${L * 0.8} ${s * w * 0.9}, ${L * 0.28} ${s * w}, ${s * 0.1} 0 Z`;
}

/** 잎 — 반쪽 명암·테두리·잎맥·잎자루. 톡 펼쳐지며 나타나고, 바람에 살랑이며, fallAt 이 있으면 흔들리며 떨어진다. */
export const Leaf: React.FC<{ x: number; y: number; angle: number; size?: number; at?: number; fallAt?: number; seed?: string; tone?: number; shape?: LeafShape; back?: boolean; shade?: number; sun?: number }> = ({ x, y, angle, size = 34, at = 0, fallAt, seed = '', tone, shape = 'oval', back, shade = 0, sun = 0 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 10], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.8)) });
  if (p <= 0) return null;
  let dx = 0, dy = 0, rot = Math.sin(f / 14 + random(`${seed}w`) * 6) * 4, o = 1;
  if (fallAt != null && f > fallAt) {
    const t = f - fallAt;
    dy = t * t * 0.08 + t * 1.2;
    dx = Math.sin(t / 6 + random(seed) * 6) * 26;
    rot = t * (4 + random(`${seed}r`) * 4);
    o = interpolate(t, [0, 50], [1, 0], clamp);
  }
  const s = size;
  const tk = ['a', 'b', 'c', 'd'][(tone ?? Math.floor(random(`${seed}tone`) * 4)) % 4]!;
  const fill = back ? 'url(#kit-leafr-back)' : `url(#kit-leafr-${tk})`;
  void LEAF_FILLS;
  return (
    // 잎마다 보는 각도가 달라 폭이 줄어 보인다(원근) — 납작한 스티커처럼 보이지 않게.
    <g transform={`translate(${x + dx} ${y + dy}) rotate(${angle + rot}) scale(${p} ${p * (0.55 + 0.45 * random(`${seed}sq`))})`} opacity={o * (back ? 0.9 : 1)}>
      <path d={`M 0 0 Q ${s * 0.05} ${-s * 0.02} ${s * 0.12} 0`} stroke={C.leafDark} strokeWidth={2.2} fill="none" />
      <path d={leafBody(s, shape)} fill={fill} stroke="#1c3f18" strokeWidth={1.2} strokeOpacity={0.55} />
      {/* 수관 안쪽 그늘·해 쪽 투과광 */}
      {shade > 0.02 ? <path d={leafBody(s, shape)} fill="#081505" opacity={shade} /> : null}
      {sun > 0.02 ? <path d={leafBody(s, shape)} fill="#fff1a8" opacity={sun * 0.32} /> : null}
      <path d={`M ${s * 0.12} 0 Q ${s * 0.55} ${-s * 0.03} ${s * (shape === 'small' ? 0.68 : 0.95)} 0`} stroke="#d9efc4" strokeWidth={1.1} strokeOpacity={0.3} fill="none" />
      {shape === 'small' ? null : [0.24, 0.38, 0.52, 0.66, 0.8].map((k, i) => (
        <g key={i} stroke="#1c3f18" strokeWidth={0.6} strokeOpacity={0.22} fill="none">
          <path d={`M ${s * k} 0 C ${s * (k + 0.05)} ${-s * 0.06}, ${s * (k + 0.1)} ${-s * 0.13}, ${s * (k + 0.17)} ${-s * 0.2}`} />
          <path d={`M ${s * k} 0 C ${s * (k + 0.05)} ${s * 0.06}, ${s * (k + 0.1)} ${s * 0.13}, ${s * (k + 0.17)} ${s * 0.2}`} />
        </g>
      ))}
      {back ? null : <ellipse cx={s * 0.42} cy={-s * 0.1} rx={s * 0.22} ry={s * 0.05} fill="#ffffff" opacity={0.18} transform={`rotate(-8 ${s * 0.42} ${-s * 0.1})`} />}
      {shape === 'broad' ? <ellipse cx={s * 0.45} cy={-s * 0.14} rx={s * 0.2} ry={s * 0.05} fill="#fff" opacity={0.35} /> : null}
    </g>
  );
};

/** 곡선 가지를 따라 잎을 단다(결정적 배치). */
export function leavesAlong(pts: P[], n: number, seed: string, at: number, size = 30, fallAt?: number, shape: LeafShape = 'oval', back = false): React.ReactElement[] {
  return Array.from({ length: n }, (_, i) => {
    const t = 0.35 + (0.62 * (i + 0.5)) / n;
    const [x, y] = pointAt(pts, t);
    const side = i % 2 ? 1 : -1;
    const ang = -90 + side * (35 + random(`${seed}a${i}`) * 30) + (random(`${seed}b${i}`) - 0.5) * 30;
    return <Leaf key={`${seed}${i}`} x={x} y={y} angle={ang} size={size * (0.8 + random(`${seed}s${i}`) * 0.4)} at={at + i * 2} seed={`${seed}${i}`} shape={shape} back={back} {...(back ? { tone: 1 + (i % 2) * 2 } : {})} {...(fallAt != null ? { fallAt: fallAt + i * 3 } : {})} />;
  });
}

/** 잔가지를 따라 어긋나게 붙는 잎 — 가지 방향을 따르되 무게로 살짝 처지고, 크기가 제각각(세밀화). */
export type Canopy = { cx: number; cy: number; r: number };
/** 수관 안 위치로 그늘·햇빛 정도 — 가운데·아래일수록 어둡고, 해(왼쪽 위) 쪽 가장자리는 밝다. */
export function canopyLight(x: number, y: number, c?: Canopy): { shade: number; sun: number } {
  if (!c) return { shade: 0, sun: 0 };
  const d = Math.hypot(x - c.cx, y - c.cy) / c.r;
  const shade = Math.max(0, Math.min(0.55, 0.5 - d * 0.45 + ((y - c.cy) / c.r) * 0.25));
  const sun = Math.max(0, Math.min(1, ((c.cx - x) + (c.cy - y)) / (c.r * 1.4))) * Math.min(1, d);
  return { shade, sun };
}

export function leavesOnTwig(pts: P[], n: number, seed: string, at: number, size = 26, fallAt?: number, shape: LeafShape = 'oval', back = false, canopy?: Canopy): React.ReactElement[] {
  return Array.from({ length: n }, (_, i) => {
    const t = 0.25 + (0.75 * (i + 0.5)) / n;
    const [x, y] = pointAt(pts, t);
    const [x2, y2] = pointAt(pts, Math.min(1, t + 0.05));
    const tan = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
    const side = i % 2 ? 1 : -1;
    const ang = tan + side * (40 + random(`${seed}a${i}`) * 35);
    // 화면 아래(+90°) 쪽으로 15° 처짐
    const droop = ((((90 - ang) % 360) + 540) % 360) - 180 > 0 ? 15 : -15;
    const lt = canopyLight(x, y, canopy);
    return <Leaf key={`${seed}t${i}`} x={x} y={y} angle={ang + droop} size={size * (0.65 + random(`${seed}s${i}`) * 0.6)} at={at + i} seed={`${seed}t${i}`} shape={shape} back={back} shade={back ? lt.shade * 0.6 : lt.shade} sun={back ? 0 : lt.sun}
      {...(back ? { tone: 1 + (i % 2) * 2 } : {})} {...(fallAt != null ? { fallAt: fallAt + i * 3 + Math.floor(random(`${seed}f${i}`) * 8) } : {})} />;
  });
}

/** 잎 송이 — 끝가지 끝에 3~5장이 부채꼴로. */
export function leafCluster(x: number, y: number, seed: string, at: number, size = 26, fallAt?: number, shape: LeafShape = 'oval', n0 = 3, canopy?: Canopy): React.ReactElement[] {
  const lt = canopyLight(x, y, canopy);
  const n = n0 + Math.floor(random(`${seed}n`) * 3);
  return Array.from({ length: n }, (_, i) => {
    const ang = -150 + (120 * i) / Math.max(1, n - 1) + (random(`${seed}a${i}`) - 0.5) * 24;
    return <Leaf key={`${seed}c${i}`} x={x} y={y} angle={ang} size={size * (0.75 + random(`${seed}s${i}`) * 0.5)} at={at + i} seed={`${seed}c${i}`} shape={shape} tone={i % 2 ? 0 : 2} shade={lt.shade} sun={lt.sun} {...(fallAt != null ? { fallAt: fallAt + i * 4 + Math.floor(random(`${seed}f${i}`) * 10) } : {})} />;
  });
}

/** 눈 — leaf: 가늘고 뾰족한 잎눈(비늘 두 장), flower: 둥글고 통통한 꽃눈(비늘 겹·윤기). */
export const Bud: React.FC<{ x: number; y: number; angle?: number; kind: 'leaf' | 'flower'; size?: number; at?: number; plump?: number }> = ({ x, y, angle = 0, kind, size = 20, at = 0, plump = 1 }) => {
  const p = useGrow(at, 10);
  if (p <= 0) return null;
  const s = size;
  const fine = s >= 14;
  const cid = `bud${Math.round(x)}_${Math.round(y)}_${Math.round(s)}`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${p})`} filter={fine ? 'url(#kit-shadow)' : undefined}>
      {fine ? <path d={`M ${-s * 0.45} ${s * 0.12} Q 0 ${s * 0.32} ${s * 0.45} ${s * 0.12}`} stroke="#3b2a1a" strokeWidth={1.4} fill="#6a4a2e" opacity={0.8} /> : null}
      {kind === 'leaf' ? (
        <>
          <path d={`M ${-s * 0.3} 0 Q ${-s * 0.26} ${-s * 0.9} 0 ${-s * 1.55} Q ${s * 0.26} ${-s * 0.9} ${s * 0.3} 0 Z`} fill="url(#kit-bud)" />
          <path d={`M ${-s * 0.3} 0 Q ${-s * 0.18} ${-s * 0.8} 0 ${-s * 1.3} L ${s * 0.04} ${-s * 0.2} Z`} fill="#5a3b20" opacity={0.75} />
          {fine ? <path d={`M ${-s * 0.12} ${-s * 0.3} Q ${-s * 0.1} ${-s * 0.9} ${-s * 0.02} ${-s * 1.2}`} stroke="#f0d2a8" strokeOpacity={0.6} strokeWidth={1.1} fill="none" /> : null}
        </>
      ) : (
        <>
          {/* 꽃눈 — 달걀꼴 몸통 안에 비늘 가장자리를 기와처럼 엇갈려 그리고(몸통 모양으로 잘라 냄), 윤기와 솜털 */}
          <defs><clipPath id={cid}><ellipse cx={0} cy={-s * 0.78} rx={s * 0.58 * plump} ry={s * 0.88} /></clipPath></defs>
          <ellipse cx={0} cy={-s * 0.78} rx={s * 0.58 * plump} ry={s * 0.88} fill="url(#kit-bud)" />
          <g clipPath={`url(#${cid})`}>
            {[0, 1, 2, 3, 4, 5].flatMap((row) => {
              const yy = -s * (0.05 + row * 0.3);
              const w = s * 0.42 * plump;
              return [-2, -1, 0, 1, 2].map((k) => {
                const xx = k * w + (row % 2 ? w / 2 : 0);
                return <path key={`${row}${k}`} d={`M ${xx - w / 2} ${yy} Q ${xx} ${yy - s * 0.42} ${xx + w / 2} ${yy}`} stroke="#3a2410" strokeWidth={fine ? 1.1 : 0.7} fill="none" opacity={0.75} />;
              });
            })}
            <ellipse cx={s * 0.3 * plump} cy={-s * 0.7} rx={s * 0.45} ry={s * 0.95} fill="#1c0f05" opacity={0.28} />
          </g>
          {fine ? Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            const ex = Math.cos(a) * s * 0.58 * plump, ey = -s * 0.78 + Math.sin(a) * s * 0.88;
            return <path key={`h${i}`} d={`M ${ex} ${ey} l ${Math.cos(a) * 2.5} ${Math.sin(a) * 2.5}`} stroke="#e2cfae" strokeWidth={0.7} opacity={0.55} />;
          }) : null}
          <ellipse cx={-s * 0.22} cy={-s * 1.02} rx={s * 0.1} ry={s * 0.26} fill="#fff" opacity={0.3} />
        </>
      )}
    </g>
  );
};

/** 땅 — 흙 둔덕(위가 밝다) + 길이·색이 다른 풀잎 + 작은 돌. */
export const Ground: React.FC<{ y: number; x0?: number; x1?: number; seed?: string }> = (props) => {
  const macro = React.useContext(MacroCtx);
  return macro ? null : <GroundInner {...props} />;
};

const GroundInner: React.FC<{ y: number; x0?: number; x1?: number; seed?: string }> = ({ y, x0 = 40, x1 = 960, seed = 'g' }) => (
  <g>
    <path d={`M ${x0} ${y + 10} Q ${(x0 + x1) / 2} ${y - 14} ${x1} ${y + 10} L ${x1} ${y + 46} Q ${(x0 + x1) / 2} ${y + 56} ${x0} ${y + 46} Z`} fill="url(#kit-soil)" filter="url(#kit-soil-tex)" />
    {Array.from({ length: 10 }, (_, i) => {
      const gx = x0 + 30 + random(`${seed}st${i}`) * (x1 - x0 - 60);
      const gy = y + 22 + random(`${seed}sy${i}`) * 14, r = 4 + random(`${seed}sr${i}`) * 5;
      return (
        <g key={`s${i}`}>
          <ellipse cx={gx + 1.5} cy={gy + 2} rx={r} ry={r * 0.6} fill="#2a1d12" opacity={0.35} />
          <ellipse cx={gx} cy={gy} rx={r} ry={r * 0.6} fill="#a49280" /><ellipse cx={gx - r * 0.3} cy={gy - r * 0.2} rx={r * 0.35} ry={r * 0.2} fill="#d8cbbb" opacity={0.6} />
        </g>
      );
    })}
    {Array.from({ length: 70 }, (_, i) => {
      const gx = x0 + 10 + random(`${seed}${i}`) * (x1 - x0 - 20);
      const h = 8 + random(`${seed}h${i}`) * 22;
      const lean = (random(`${seed}l${i}`) - 0.5) * 12;
      const col = ['#5f8f45', '#7aa957', '#4e7d39', '#8fbb64', '#6b9a4b'][i % 5];
      return <path key={i} d={`M ${gx} ${y + 6} q ${lean * 0.4} ${-h * 0.6} ${lean} ${-h}`} stroke={col} strokeWidth={1.6 + (i % 3) * 0.5} fill="none" strokeLinecap="round" />;
    })}
  </g>
);

/** 전정가위(바이패스형) — 굽은 날, 홈 있는 손잡이, 스프링. closeAt 프레임에 날이 닫힌다. */
export const Shears: React.FC<{ x: number; y: number; angle?: number; scale?: number; at?: number; closeAt?: number; hideAt?: number }> = ({ x, y, angle = 0, scale = 1, at = 0, closeAt, hideAt }) => {
  const f = useCurrentFrame();
  const p = useGrow(at, 10) * (hideAt == null ? 1 : interpolate(f, [hideAt, hideAt + 8], [1, 0], clamp));
  if (p <= 0) return null;
  const open = closeAt == null ? 16 : interpolate(f, [closeAt - 6, closeAt], [16, 1], clamp);
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale * p})`} filter="url(#kit-shadow)">
      <g transform={`rotate(${-open})`}>
        <path d="M -4 -2 C 26 -14, 58 -16, 80 -6 C 66 -2, 40 2, -2 6 Z" fill="url(#kit-steel)" stroke={C.steelDark} strokeWidth={1.4} />
        <path d="M 6 -3 C 30 -10, 56 -11, 74 -6" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.2} fill="none" />
        <path d="M -2 2 C -30 8, -60 12, -84 22 C -90 26, -86 34, -78 32 C -54 24, -28 16, 0 10 Z" fill="url(#kit-grip)" />
        {[-34, -50, -66].map((gx) => <path key={gx} d={`M ${gx} ${14 + (gx + 34) * -0.18} l 3 6`} stroke={C.gripDark} strokeWidth={2} />)}
      </g>
      <g transform={`rotate(${open})`}>
        <path d="M -2 2 C 22 10, 50 10, 66 4 C 52 -2, 30 -4, -2 -4 Z" fill="url(#kit-steel)" stroke={C.steelDark} strokeWidth={1.4} />
        <path d="M -2 -2 C -30 -8, -60 -12, -84 -22 C -90 -26, -86 -34, -78 -32 C -54 -24, -28 -16, 0 -10 Z" fill="url(#kit-grip)" />
      </g>
      <path d="M -26 -8 q -6 8 0 16 q 6 -8 -4 -16" stroke="#b9c2c9" strokeWidth={2} fill="none" />
      <circle r={6.5} fill="#6b737a" stroke="#e6ebee" strokeWidth={2} />
    </g>
  );
};

/** 장갑 낀 손 — 손바닥 + 손가락 넷(가위를 쥔 듯 굽힘) + 엄지. angle 방향을 향한다. */
export const GloveHand: React.FC<{ x: number; y: number; angle: number; grip?: boolean }> = ({ x, y, angle, grip = true }) => (
  <g transform={`translate(${x} ${y}) rotate(${angle})`}>
    <ellipse cx={8} cy={0} rx={13} ry={11} fill={C.glove} />
    {[-7, -2.5, 2, 6.5].map((fy, i) => (
      <rect key={i} x={14} y={fy - 2.6} width={grip ? 10 : 15} height={5.2} rx={2.6} fill={i % 2 ? '#a06c3c' : C.glove} />
    ))}
    <rect x={4} y={-14} width={12} height={6} rx={3} fill="#a06c3c" transform="rotate(-25 4 -14)" />
    <rect x={-6} y={-9} width={8} height={18} rx={3} fill="#8e5d33" />
  </g>
);

/** 정원사 — 얼굴(눈썹·코·턱 그림자, 모자 그늘), 엮은 결 밀짚모자, 깃·주름 셔츠, 앞치마, 장갑 낀 손가락, 장화.
 *  손을 뻗으면 몸이 그쪽으로 기울고 고개가 손을 따라 올라간다. 가만히 있을 때도 숨 쉬듯 움직인다. */
export const Gardener: React.FC<{ x: number; groundY: number; scale?: number; reachAt?: number; armTo?: number; shears?: boolean }> = ({ x, groundY, scale = 1, reachAt = 0, armTo = -62, shears = true }) => {
  const f = useCurrentFrame();
  const r = interpolate(f, [reachAt, reachAt + 22], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const breath = 1 + 0.01 * Math.sin(f / 18);
  const lean = 5 * r;
  const tilt = -14 * r;
  const shoulder: P = [26, -236];
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const a1 = rad(interpolate(r, [0, 1], [100, armTo]));
  const a2 = rad(interpolate(r, [0, 1], [82, armTo - 8]));
  const elbow: P = [shoulder[0] + Math.cos(a1) * 64, shoulder[1] + Math.sin(a1) * 64];
  const wrist: P = [elbow[0] + Math.cos(a2) * 54, elbow[1] + Math.sin(a2) * 54];
  const limb = (a: P, b: P, w0: number, w1: number, fill: string) => <path d={taperOutline([a, b], w0, w1, 1, 8)} fill={fill} />;
  const blink = f % 90 > 86 ? 0.2 : 1;
  return (
    <g transform={`translate(${x} ${groundY}) scale(${scale})`}>
      <ellipse cx={8} cy={4} rx={78} ry={11} fill="#000" opacity={0.28} />
      <g filter="url(#kit-shadow)">
        {/* 다리·장화 */}
        {limb([-15, -132], [-20, -14], 36, 28, 'url(#kit-pants)')}
        {limb([15, -132], [22, -14], 36, 28, 'url(#kit-pants)')}
        <path d="M -14 -80 q -7 5 -4 12 M -20 -110 q 4 8 -2 14" stroke={C.pantsShade} strokeWidth={2.6} fill="none" />
        <path d="M 18 -78 q 7 5 4 12 M 22 -108 q -4 8 2 14" stroke={C.pantsShade} strokeWidth={2.6} fill="none" />
        <path d="M -38 -30 L -6 -30 L -6 -2 L -44 -2 Q -48 -2 -46 -10 Z" fill={C.boot} />
        <path d="M 8 -30 L 36 -30 Q 52 -14 50 -2 L 8 -2 Z" fill={C.boot} />
        <path d="M -38 -26 L -8 -26 M 10 -26 L 36 -26" stroke="#4a433b" strokeWidth={2} />
        <path d="M -30 -24 l 6 4 l 6 -4 l 6 4 M 16 -24 l 6 4 l 6 -4 l 6 4" stroke="#8a7a68" strokeWidth={1.2} fill="none" />
        <path d="M -17 -128 L -21 -32 M 17 -128 L 21 -32" stroke="#3a404c" strokeWidth={1.2} opacity={0.7} />
        <rect x={-46} y={-4} width={40} height={5} rx={2} fill="#151210" />
        <rect x={8} y={-4} width={44} height={5} rx={2} fill="#151210" />
        {/* 윗몸 — 허리를 축으로 기울고 숨 쉰다 */}
        <g transform={`rotate(${lean} 0 -130) translate(0 -130) scale(1 ${breath}) translate(0 130)`}>
          <path d="M -38 -244 Q -44 -186 -34 -126 L 34 -126 Q 44 -186 38 -244 Q 0 -262 -38 -244 Z" fill="url(#kit-shirt)" />
          <path d="M -30 -150 q 12 6 24 0 M 6 -150 q 12 6 22 -2" stroke={C.shirtShade} strokeWidth={2} fill="none" opacity={0.7} />
          <path d="M -12 -252 L 0 -232 L 12 -252 L 6 -256 L 0 -244 L -6 -256 Z" fill="#e9eef2" />
          {[-226, -206].map((by) => <circle key={by} cx={0} cy={by} r={2.6} fill="#e9eef2" stroke="#2c5675" strokeWidth={0.8} />)}
          <path d="M -26 -218 L -22 -130 M 26 -218 L 24 -130" stroke="#8a744a" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
          <path d="M -28 -222 L -24 -128 L 28 -128 L 30 -222 Q 0 -230 -28 -222 Z" fill="url(#kit-apron)" />
          <path d="M -28 -222 L -18 -256 M 30 -222 L 18 -256" stroke={C.apronShade} strokeWidth={5} />
          <rect x={-16} y={-180} width={32} height={22} rx={3} fill="none" stroke={C.apronShade} strokeWidth={2.5} />
          <path d="M -6 -180 L -2 -196 L 3 -180" stroke={C.grip} strokeWidth={3} fill="none" />
          <rect x={-36} y={-136} width={72} height={10} rx={4} fill="#3a2a1c" />
          <rect x={-6} y={-136} width={12} height={10} rx={2} fill="#c9a24a" />
          {/* 왼팔(내린 팔) */}
          {limb([-28, -236], [-44, -176], 24, 20, 'url(#kit-shirt)')}
          <path d="M -40 -186 q 6 4 10 0" stroke={C.shirtShade} strokeWidth={2} fill="none" />
          {limb([-44, -178], [-40, -124], 17, 14, 'url(#kit-skin)')}
          <GloveHand x={-40} y={-120} angle={90} grip={false} />
          {/* 오른팔(뻗는 팔) */}
          {limb(shoulder, elbow, 24, 20, 'url(#kit-shirt)')}
          <circle cx={elbow[0]} cy={elbow[1]} r={10} fill={C.shirtShade} />
          {limb(elbow, wrist, 17, 14, 'url(#kit-skin)')}
          <rect x={elbow[0] - 9} y={elbow[1] - 4} width={18} height={8} rx={3} fill="#5a8db0" transform={`rotate(${(a2 * 180) / Math.PI + 90} ${elbow[0]} ${elbow[1]})`} />
          {shears ? <Shears x={wrist[0] + Math.cos(a2) * 22} y={wrist[1] + Math.sin(a2) * 22} angle={(a2 * 180) / Math.PI} scale={0.5} /> : null}
          <GloveHand x={wrist[0]} y={wrist[1]} angle={(a2 * 180) / Math.PI} />
          {/* 머리 — 목을 축으로 손을 따라 고개를 든다 */}
          <rect x={-10} y={-268} width={20} height={18} rx={4} fill={C.skinShade} />
          <path d="M -10 -256 Q 0 -250 10 -256 L 10 -252 Q 0 -246 -10 -252 Z" fill="#8a5a3e" opacity={0.35} />
          <g transform={`rotate(${tilt} 0 -262)`}>
            <circle cx={0} cy={-292} r={30} fill="url(#kit-skin)" />
            <ellipse cx={4} cy={-266} rx={16} ry={5} fill={C.skinShade} opacity={0.6} />
            <ellipse cx={-27} cy={-290} rx={6} ry={9} fill={C.skinShade} />
            <path d="M -27 -294 q 3 4 0 8" stroke="#a8704f" strokeWidth={1.4} fill="none" />
            <path d="M -30 -298 Q -26 -326 4 -322 Q 26 -318 30 -300 L 28 -292 Q 6 -306 -24 -286 Z" fill="#3b2a1d" />
            {[-20, -12, -4, 4, 12, 20].map((hx) => <path key={hx} d={`M ${hx} -318 q 3 8 ${hx > 0 ? 6 : -2} 16`} stroke="#5a4130" strokeWidth={1} fill="none" opacity={0.7} />)}
            <path d="M 6 -300 q 7 -5 14 -1" stroke="#3b2a1d" strokeWidth={2.8} fill="none" strokeLinecap="round" />
            <ellipse cx={13} cy={-291} rx={5.2} ry={4.2 * blink} fill="#fbf7f2" />
            <ellipse cx={14} cy={-291} rx={3.2} ry={3.4 * blink} fill="#4a3322" />
            <ellipse cx={14.4} cy={-291} rx={1.6} ry={1.8 * blink} fill="#1a110a" />
            <circle cx={15.2} cy={-292.4} r={0.9} fill="#fff" opacity={blink} />
            <path d="M 8 -294 q 5 -2 10 0" stroke="#7a4f36" strokeWidth={0.9} fill="none" opacity={0.6} />
            <path d="M 22 -290 q 6 7 0 11" stroke={C.skinShade} strokeWidth={2.6} fill="none" strokeLinecap="round" />
            <path d="M 9 -274 Q 15 -270 21 -275" stroke="#9c5a3c" strokeWidth={2.4} fill="none" strokeLinecap="round" />
            <ellipse cx={20} cy={-281} rx={5} ry={3} fill="#e98c7a" opacity={0.35} />
            {/* 모자 그늘 */}
            <path d="M -30 -306 Q 0 -296 30 -306 L 30 -298 Q 0 -288 -30 -298 Z" fill="#000" opacity={0.18} />
            <ellipse cx={0} cy={-310} rx={64} ry={12} fill="url(#kit-straw)" stroke={C.strawDark} strokeWidth={2} />
            <path d="M -32 -312 Q -30 -346 0 -348 Q 30 -346 32 -312 Z" fill="url(#kit-straw)" stroke={C.strawDark} strokeWidth={2} />
            {[-24, -12, 0, 12, 24].map((hx) => <path key={hx} d={`M ${hx} -344 Q ${hx * 1.1} -330 ${hx * 1.2} -314`} stroke={C.strawDark} strokeOpacity={0.55} strokeWidth={1.2} fill="none" />)}
            {[-336, -326].map((hy) => <path key={hy} d={`M -28 ${hy + 12} Q 0 ${hy + 4} 28 ${hy + 12}`} stroke={C.strawDark} strokeOpacity={0.45} strokeWidth={1.1} fill="none" />)}
            {[-56, -44, -32, 32, 44, 56].map((hx) => <path key={hx} d={`M ${hx} -318 L ${hx * 1.06} -302`} stroke={C.strawDark} strokeOpacity={0.5} strokeWidth={1.1} />)}
            <path d="M -32 -316 Q 0 -308 32 -316 L 32 -324 Q 0 -316 -32 -324 Z" fill="#7a4b2e" />
          </g>
        </g>
      </g>
    </g>
  );
};

/** 갈라지는 나무(정교판) — 단계별로 자라나고, 뒤쪽 잎(어둡게)·끝가지 잎 송이(밝게)로 수관을 채운다.
 *  바람에 살랑인다(밑동 기준 미세 회전). fallAt 이면 잎이 떨어져 겨울나무가 된다. */
export const ProcTree: React.FC<{ seed: string; x: number; groundY: number; height: number; at?: number; depth?: number; spread?: number; lean?: number;
  foliage?: 'leaves' | 'buds' | 'none'; leafSize?: number; fallAt?: number; leaf?: LeafShape; dense?: boolean }> = ({ seed, x, groundY, height, at = 0, depth: depthIn = 3, spread = 32, lean = 0, foliage = 'leaves', leafSize = 24, fallAt, leaf = 'oval', dense = true }) => {
  const f = useCurrentFrame();
  let depth = depthIn;
  // 잎 달린 나무는 한 단계 더 갈라 수관을 채운다(세밀화).
  // 잎 달린 나무는 수관을, 잎 진 나무는 잔가지 밀도를 위해 한 단계 더 가른다(진짜 나무다움은 잔가지에서 나온다).
  const d = dense ? Math.max(depth, 4) : depth;
  const tree = growTree(seed, [x, groundY], height, { depth: d, spread, lean });
  depth = d;
  const lastLevelAt = at + depth * 8 + 14;
  const sway = Math.sin(f / 40 + random(seed) * 6) * 0.9;
  const inner = tree.branches.filter((b) => b.level >= depth - 1);
  const cx = tree.tips.reduce((a, t) => a + t[0], 0) / Math.max(1, tree.tips.length);
  const cy = tree.tips.reduce((a, t) => a + t[1], 0) / Math.max(1, tree.tips.length);
  const cr = Math.max(40, ...tree.tips.map((t) => Math.hypot(t[0] - cx, t[1] - cy))) * 0.95;
  const canopy: Canopy = { cx, cy: cy + cr * 0.15, r: cr };
  const grown = useGrow(at, 30);
  const leafy = foliage === 'leaves' && (fallAt == null || f < fallAt + 20);
  return (
    <g>
      {/* 땅에 드리운 그림자 — 해가 왼쪽 위라 오른쪽으로 눕는다. 굵은 가지는 선으로, 수관은 흐린 타원으로. */}
      <g opacity={0.3 * grown} filter="url(#kit-soft)">
        {tree.branches.filter((b) => b.level <= 3).map((b) => {
          const sp = castShadowPts(b.pts, groundY);
          return <path key={`s${b.order}`} d={`M ${sp.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L ')}`} stroke="#0d0905" strokeWidth={Math.max(1.5, b.w0 * 0.55)} strokeLinecap="round" fill="none" />;
        })}
        {leafy ? (() => { const [sx, sy] = castShadowPts([[cx, cy]], groundY)[0]!; return <ellipse cx={sx} cy={sy} rx={cr * 1.1} ry={Math.max(10, cr * 0.16)} fill="#0d0905" />; })() : null}
      </g>
      <ellipse cx={x + 6} cy={groundY + 4} rx={height * 0.12} ry={7} fill="#000" opacity={0.35} filter="url(#kit-blur1)" />
      {/* 드러난 뿌리 — 밑동이 퍼지며 갈라져 흙 속으로 든다 */}
      {rootPaths(seed, [x, groundY], tree.branches[0]!.w0).map((rt, i) => <Branch key={`rt${i}`} pts={rt.pts} w0={rt.w0} w1={rt.w1} at={at} dur={12} flare={0} detail={false} />)}
      <ellipse cx={x} cy={groundY + 9} rx={tree.branches[0]!.w0 * 2.2} ry={7} fill="url(#kit-soil)" opacity={0.85} />
      <g transform={`rotate(${sway} ${x} ${groundY})`}>
        {foliage === 'leaves' && dense ? inner.flatMap((b, i) => leavesOnTwig(b.pts, 4, `${seed}B${i}`, lastLevelAt - 4 + (i % 5), leafSize * 1.1, fallAt != null ? fallAt + (i % 7) * 3 : undefined, leaf, true, canopy)) : null}
        {tree.branches.map((b) => <Branch key={b.order} pts={b.pts} w0={b.w0} w1={b.w1} at={at + b.level * 8} dur={14} flare={b.level > 0 ? 0.32 : 0.18} ridge={b.level > 0 && b.w0 >= 4} />)}
        {/* 잎 진 나무 — 끝가지들에 짧은 잔가지(단과지)가 어긋나게 돋아 실루엣이 촘촘하다(실제 겨울 과실나무). */}
        {foliage !== 'leaves' ? tree.branches.filter((b) => b.level >= depth - 1).flatMap((b, i) => [0.4, 0.75].map((t0, j) => {
          const q = `${seed}sp${i}_${j}`;
          const t = t0 + (random(`${q}t`) - 0.5) * 0.15;
          const [sx, sy] = pointAt(b.pts, t);
          const [nx, ny] = pointAt(b.pts, Math.min(1, t + 0.05));
          const tan = Math.atan2(ny - sy, nx - sx);
          const a = tan + (j % 2 ? 1 : -1) * (0.75 + random(`${q}a`) * 0.35);
          const L = height * 0.035 * (0.6 + random(`${q}l`) * 0.7);
          const e: P = [sx + Math.cos(a) * L, sy + Math.sin(a) * L - L * 0.15];
          return <Branch key={q} pts={[[sx, sy], [(sx + e[0]) / 2, (sy + e[1]) / 2 - L * 0.04], e]} w0={Math.min(b.w0 * 0.55, 2.4)} w1={0.7} at={at + (b.level + 1) * 8} dur={10} detail={false} />;
        })) : null}
        {foliage === 'leaves' ? tree.branches.filter((b) => b.level === depth).flatMap((b, i) => leavesOnTwig(b.pts, 4, `${seed}F${i}`, lastLevelAt + (i % 6), leafSize, fallAt != null ? fallAt + (i % 8) * 2 : undefined, leaf, false, canopy)) : null}
        {foliage === 'leaves' ? tree.tips.flatMap(([tx, ty], i) => leafCluster(tx, ty, `${seed}L${i}`, lastLevelAt + (i % 6), leafSize * 0.85, fallAt != null ? fallAt + (i % 8) * 2 : undefined, leaf, 2, canopy)) : null}
        {foliage === 'none' ? tree.tips.filter((_, i) => i % 2 === 0).map(([tx, ty], i) => (
          <Bud key={`w${i}`} x={tx} y={ty} angle={(random(`${seed}wa${i}`) - 0.5) * 40} kind={i % 3 === 0 ? 'flower' : 'leaf'} size={(i % 3 === 0 ? 5.5 : 4.5) * Math.min(1.3, height / 360)} at={lastLevelAt + (i % 6)} />
        )) : null}
        {foliage === 'buds' ? tree.tips.map(([tx, ty], i) => (
          <g key={i}>
            <Bud x={tx} y={ty} angle={(random(`${seed}ba${i}`) - 0.5) * 50} kind="leaf" size={9} at={lastLevelAt + (i % 5)} />
            <Leaf x={tx} y={ty - 8} angle={-90 + (random(`${seed}bl${i}`) - 0.5) * 70} size={11} at={lastLevelAt + 6 + (i % 5)} seed={`${seed}b${i}`} tone={2} shape={leaf} />
          </g>
        )) : null}
      </g>
    </g>
  );
};

/** 계절 미니 나무 — leafy(잎 무성)·bare(잎 진)·budding(눈 트는). 타임라인 위 아이콘용. */
export const MiniTree: React.FC<{ x: number; y: number; mode: 'leafy' | 'bare' | 'budding'; at?: number; scale?: number; fallAt?: number }> = ({ x, y, mode, at = 0, scale = 1, fallAt }) => (
  <ProcTree seed={`mini${Math.round(x)}`} x={x} groundY={y} height={170 * scale} at={at} depth={3} spread={30} leaf="serrate"
    foliage={mode === 'leafy' ? 'leaves' : mode === 'budding' ? 'buds' : 'none'} leafSize={16 * scale} {...(fallAt != null ? { fallAt } : {})} />
);

/** 톱 — 이빨 있는 날 + 나무 손잡이. stroke(0~1)만큼 앞뒤로 켠다. */
export const Saw: React.FC<{ x: number; y: number; angle?: number; scale?: number; at?: number; strokes?: number; dur?: number; hideAt?: number }> = ({ x, y, angle = 0, scale = 1, at = 0, strokes = 3, dur = 30, hideAt }) => {
  const f = useCurrentFrame();
  const p = useGrow(at, 8) * (hideAt == null ? 1 : interpolate(f, [hideAt, hideAt + 8], [1, 0], clamp));
  if (p <= 0) return null;
  const t = interpolate(f, [at, at + dur], [0, 1], clamp);
  const push = Math.sin(t * Math.PI * 2 * strokes) * 22 * (t < 1 ? 1 : 0);
  const teeth = Array.from({ length: 14 }, (_, i) => `L ${-90 + i * 12 + 6} 14 L ${-90 + (i + 1) * 12} 8`).join(' ');
  return (
    <g transform={`translate(${x + push * Math.cos((angle * Math.PI) / 180)} ${y + push * Math.sin((angle * Math.PI) / 180)}) rotate(${angle}) scale(${scale * p})`} filter="url(#kit-shadow)">
      <path d={`M -90 -10 L 78 -16 L 78 8 ${teeth.replace(/^L/, 'L')} L -90 8 Z`} fill="url(#kit-steel)" stroke={C.steelDark} strokeWidth={1.4} />
      <path d="M -80 -6 L 70 -11" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.5} />
      <path d="M 74 -22 Q 120 -26 126 0 Q 122 24 76 16 Z" fill="#8a5a37" stroke="#5a3920" strokeWidth={2} />
      <ellipse cx={104} cy={-2} rx={12} ry={8} fill="#5a3920" />
    </g>
  );
};

/** 화분 — 테두리·몸통 명암·흙. */
export const Pot: React.FC<{ x: number; y: number; w?: number; h?: number }> = ({ x, y, w = 260, h = 170 }) => (
  <g filter="url(#kit-shadow)">
    <path d={`M ${x - w / 2} ${y} L ${x + w / 2} ${y} L ${x + w * 0.38} ${y + h} L ${x - w * 0.38} ${y + h} Z`} fill="url(#kit-pot)" />
    <rect x={x - w / 2 - 10} y={y - 14} width={w + 20} height={26} rx={8} fill="#3a3d42" />
    <ellipse cx={x} cy={y - 2} rx={w / 2 - 4} ry={10} fill={C.soil} />
  </g>
);

/** 500원 동전 — 크기 비교용. */
export const Coin: React.FC<{ x: number; y: number; r?: number; at?: number }> = ({ x, y, r = 40, at = 0 }) => {
  const p = useGrow(at, 10);
  if (p <= 0) return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${p})`} filter="url(#kit-shadow)">
      <circle r={r} fill="url(#kit-coin)" stroke="#8d949b" strokeWidth={3} />
      <circle r={r * 0.82} fill="none" stroke="#a9b0b6" strokeWidth={1.5} strokeDasharray="2 3" />
      <text y={r * 0.2} textAnchor="middle" fontSize={r * 0.62} fontWeight={800} fill="#6c737a">500</text>
    </g>
  );
};

/** 가지 단면 — 껍질 테, 나이테, 심. r 이 자라면 나이테가 늘어난다. */
export const WoodSection: React.FC<{ x: number; y: number; r: number }> = ({ x, y, r }) => {
  const rings = Math.max(1, Math.round(r / 14));
  return (
    <g transform={`translate(${x} ${y})`} filter="url(#kit-shadow)">
      <circle r={r} fill="#5a3920" filter="url(#kit-bark-tex)" />
      <circle r={r * 0.9} fill="url(#kit-wood)" />
      {Array.from({ length: rings }, (_, i) => <circle key={i} r={(r * 0.9 * (i + 1)) / (rings + 1)} fill="none" stroke="#a0703f" strokeOpacity={0.55} strokeWidth={1.4} />)}
      <circle r={Math.max(1.5, r * 0.05)} fill="#7a4f2a" />
    </g>
  );
};

/**
 * 가지가 줄기에 붙는 자리(확대) — 줄기 표면에서 매끄럽게 부푼 지륭, 그 위 줄기 껍질의 주름 능선(가지 껍질 주름).
 * state: whole(붙어 있음) · cut(지륭 바로 바깥에서 자른 뒤: 지륭은 남고 작은 단면) · flush(줄기에 붙여 자른 뒤: 지륭까지 잘려 큰 상처).
 * 오른쪽으로 뻗는 가지를 그린다. edgeX = 줄기 오른쪽 겉면, y = 가지 중심 높이, bw = 가지 굵기.
 */
export const CollarJoint: React.FC<{ edgeX: number; y: number; bw: number; len: number; state?: 'whole' | 'cut' | 'flush'; at?: number; heal?: number }> = ({ edgeX, y, bw, len, state = 'whole', at = 0, heal = 0 }) => {
  const p = useGrow(at, 14);
  if (p <= 0) return null;
  const cr = bw * 0.62; // 지륭 반지름(세로) — 가지보다 25% 굵게 부푼다
  const cw = bw * 0.4; // 지륭 너비(가로) — 1~2cm 남짓의 볼록한 어깨
  const cutX = state === 'flush' ? edgeX - 2 : edgeX + cw;
  const pts: P[] = [[edgeX - bw * 0.3, y], [edgeX + len * 0.4, y - bw * 0.15], [edgeX + len, y - bw * 0.5]];
  // 지륭 어깨 — 줄기 겉면에서 가지 쪽으로 부드럽게 부푼 혹. 줄기 쪽은 가지보다 25% 높고, cutX 에서 가지 굵기로 줄어든다.
  // 지륭 = 가지 밑동이 부푼 것 — 가지(또는 잘린 토막) 윤곽 자체를 밑동에서 부풀려, 명암·결이 가지와 하나로 이어진다.
  // 줄기 겉면(edgeX)에서 약 1.5배, edgeX + 1.8·cw 에서 원래 굵기. 줄기 안쪽으로 들어간 부분은 잘라 낸다.
  const bulge = bw * 0.3 + cw * 1.8;
  const stubPts: P[] = [[edgeX - bw * 0.3, y], [cutX, y - bw * 0.15 * ((cutX - edgeX) / (len * 0.4))]];
  const sid = `cj${Math.round(edgeX)}_${Math.round(y)}`;
  const faceRx = state === 'flush' ? bw * 0.16 : bw * 0.13, faceRy = state === 'flush' ? cr * 1.15 : bw * 0.5;
  return (
    <g opacity={p}>
      <defs><clipPath id={sid}><rect x={edgeX - 3} y={y - bw * 3} width={len + bw * 2} height={bw * 6} /></clipPath></defs>
      {/* 줄기와 가지가 맞닿는 골 — 흐린 그늘로 이음매 선을 감춘다 */}
      {state !== 'flush' ? <ellipse cx={edgeX - 2} cy={y} rx={bw * 0.09} ry={cr * 1.25} fill="#0c0805" opacity={0.45} filter="url(#kit-blur4)" /> : null}
      {/* 가지가 줄기에 드리운 그늘(붙는 자리 아래) */}
      {state !== 'flush' ? <ellipse cx={edgeX - bw * 0.05} cy={y + cr * 1.1} rx={bw * 0.42} ry={bw * 0.26} fill="#0c0805" opacity={0.42} filter="url(#kit-blur4)" /> : null}
      <g clipPath={`url(#${sid})`}>
        {state === 'whole' ? <Branch pts={pts} w0={bw} w1={bw * 0.55} at={DONE_K} flare={1.0} flareLen={bulge / len} /> : null}
        {state === 'cut' ? <Branch pts={stubPts} w0={bw} w1={bw * 0.97} at={DONE_K} flare={1.0} flareLen={bulge / (cutX - edgeX + bw * 0.3)} detail={false} /> : null}
        {/* 지륭을 두른 껍질 주름 — 가지를 감싼 고리 모양, 흐리게 */}
        {state !== 'flush' ? [0.3, 0.65, 1.0].map((k, i) => (
          <path key={i} d={`M ${edgeX + cw * k} ${y - bw * (0.5 + (1.3 - k) * 0.2)} Q ${edgeX + cw * k + bw * 0.09} ${y} ${edgeX + cw * k} ${y + bw * (0.5 + (1.3 - k) * 0.2)}`} stroke="#140d07" strokeWidth={Math.max(1.4, bw * 0.03)} fill="none" opacity={0.35} filter="url(#kit-blur1)" />
        )) : null}
      </g>
      {/* 가지 껍질 주름 — 갈라지는 자리 위 줄기 껍질이 밀려 솟은 능선 */}
      <path d={`M ${edgeX - bw * 0.85} ${y - cr * 1.75} Q ${edgeX - bw * 0.35} ${y - cr * 1.35} ${edgeX - 3} ${y - cr * 1.22}`} stroke="#24150a" strokeWidth={Math.max(1.4, bw * 0.045)} fill="none" strokeLinecap="round" opacity={0.45} filter="url(#kit-blur1)" />
      <path d={`M ${edgeX - bw * 0.8} ${y - cr * 1.75 - 5} Q ${edgeX - bw * 0.33} ${y - cr * 1.35 - 5} ${edgeX - 4} ${y - cr * 1.22 - 5}`} stroke="#b9a58f" strokeWidth={Math.max(1, bw * 0.03)} fill="none" strokeLinecap="round" opacity={0.35} filter="url(#kit-blur1)" />
      {/* 잘린 단면 — 지륭 바깥이면 작고 둥근 상처, 줄기에 붙이면 크고 길쭉한 상처. 나무 속 색·나이테·껍질 테. */}
      {state !== 'whole' ? (
        <g transform={`translate(${state === 'flush' ? cutX : cutX + 2} ${y})`}>
          <ellipse rx={faceRx * 1.15} ry={faceRy * 1.06} fill="#2a1d14" />
          <ellipse rx={faceRx} ry={faceRy} fill="url(#kit-wood)" />
          {[0.78, 0.56, 0.34].map((k) => <ellipse key={k} rx={faceRx * k} ry={faceRy * k} fill="none" stroke="#b07f4c" strokeWidth={1} opacity={0.6} />)}
          <ellipse cx={faceRx * 0.2} cy={faceRy * 0.25} rx={faceRx * 0.8} ry={faceRy * 0.7} fill="#5a3a1c" opacity={0.18} filter="url(#kit-blur1)" />
          {/* 아무는 굳은살 — 단면 둘레에서 안쪽으로 차오르는 부푼 테 */}
          {heal > 0 ? (
            <g>
              <ellipse rx={faceRx * 1.02} ry={faceRy * 0.99} fill="none" stroke="#6f5d4c" strokeWidth={bw * 0.16 * heal} />
              <ellipse cx={-faceRx * 0.1} cy={-faceRy * 0.04} rx={faceRx * 1.02} ry={faceRy * 0.99} fill="none" stroke="#b8a48c" strokeWidth={bw * 0.035 * heal} opacity={0.6} />
            </g>
          ) : null}
        </g>
      ) : null}
    </g>
  );
};
const DONE_K = -999;
