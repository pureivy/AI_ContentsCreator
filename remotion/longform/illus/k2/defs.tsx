// 키트 2 공통 그라디언트·필터 — SceneStage 가 KitDefs 다음에 한 번 둔다. id 는 모두 k2- 로 시작.
// 빛은 키트와 같이 왼쪽 위(필터 azimuth 225°). 필터는 여기 몇 개만 — 부품 안에 <filter> 를 새로 만들지 않는다(렌더 비용).
import React from 'react';

/** 가로 원통 명암(왼쪽 밝음 → 오른쪽 어두움) 그라디언트 한 벌. */
const Cyl: React.FC<{ id: string; c: [string, string, string, string] }> = ({ id, c }) => (
  <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stopColor={c[1]} /><stop offset="0.22" stopColor={c[0]} /><stop offset="0.55" stopColor={c[2]} /><stop offset="1" stopColor={c[3]} />
  </linearGradient>
);

export const Kit2Defs: React.FC = () => (
  <defs>
    {/* 화분 몸통 — 재질별 원통 명암 [빛 받는 면, 가장자리, 중간, 그늘] */}
    <Cyl id="k2-plastic" c={['#6c727b', '#4a4f57', '#373b41', '#1c1e22']} />
    <Cyl id="k2-plastic-rim" c={['#7a8089', '#555a62', '#41454c', '#24272b']} />
    <Cyl id="k2-terra" c={['#eba778', '#d58457', '#c06740', '#7e3b20']} />
    <Cyl id="k2-terra-rim" c={['#f2b388', '#dc8d60', '#c86e46', '#86402a']} />
    <Cyl id="k2-fabric" c={['#6b6e69', '#555853', '#43453f', '#272825']} />
    <Cyl id="k2-kraft" c={['#ecd5a0', '#d9bd85', '#c6a46b', '#8e7140']} />
    <Cyl id="k2-sack-white" c={['#f7f4ec', '#e5e0d4', '#d2ccbd', '#9d9686']} />
    <Cyl id="k2-sack-green" c={['#6fa35a', '#5a8c48', '#467238', '#2a4a22']} />
    <Cyl id="k2-can" c={['#9fc58f', '#7fae6c', '#5f8f4f', '#35562c']} />
    <Cyl id="k2-stake" c={['#e8d29a', '#d4b877', '#bb9b58', '#7f6534']} />
    <Cyl id="k2-tape" c={['#ffe27a', '#f5cf4c', '#e3b72e', '#a07e14']} />
    <Cyl id="k2-cuff" c={['#6b9ec2', '#4f83a8', '#3f7194', '#24465f']} />
    {/* 세로 그늘(바닥 쪽 어둡게) · 밑면 원뿔 벽 명암 */}
    <linearGradient id="k2-vshade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#000" stopOpacity="0" /><stop offset="0.6" stopColor="#000" stopOpacity="0.06" /><stop offset="1" stopColor="#000" stopOpacity="0.32" />
    </linearGradient>
    <linearGradient id="k2-cone" x1="0.1" y1="0.1" x2="0.9" y2="0.9">
      <stop offset="0" stopColor="#fff" stopOpacity="0.22" /><stop offset="0.45" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.5" />
    </linearGradient>
    {/* 손 — 장갑(가죽)·맨손 */}
    <linearGradient id="k2-glove" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stopColor="#d49a5e" /><stop offset="0.5" stopColor="#b07a45" /><stop offset="1" stopColor="#7c4f27" />
    </linearGradient>
    <linearGradient id="k2-skin" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stopColor="#f7d2b4" /><stop offset="0.5" stopColor="#eab792" /><stop offset="1" stopColor="#bf8562" />
    </linearGradient>
    {/* 바닥(아래에서 본) — 평평한 원판은 왼쪽 위가 밝다 */}
    <radialGradient id="k2-base-terra" cx="0.38" cy="0.36" r="0.75">
      <stop offset="0" stopColor="#e79c6c" /><stop offset="1" stopColor="#a4532f" />
    </radialGradient>
    <radialGradient id="k2-base-plastic" cx="0.38" cy="0.36" r="0.75">
      <stop offset="0" stopColor="#5f646c" /><stop offset="1" stopColor="#2a2d32" />
    </radialGradient>
    <radialGradient id="k2-base-fabric" cx="0.38" cy="0.36" r="0.75">
      <stop offset="0" stopColor="#62655f" /><stop offset="1" stopColor="#30322e" />
    </radialGradient>
    {/* 화분 속(안쪽 벽) — 위가 어둡고 흙 쪽이 더 어둡다 */}
    <linearGradient id="k2-inwall" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#15110d" /><stop offset="0.6" stopColor="#2a221b" /><stop offset="1" stopColor="#3b3026" />
    </linearGradient>
    {/* 열매 */}
    <radialGradient id="k2-berry" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stopColor="#8a9ad6" /><stop offset="0.5" stopColor="#3f4f94" /><stop offset="1" stopColor="#1b2350" />
    </radialGradient>
    <radialGradient id="k2-ball" cx="0.35" cy="0.3" r="0.75">
      <stop offset="0" stopColor="#fff" stopOpacity="0.55" /><stop offset="0.45" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.45" />
    </radialGradient>
    {/* 물 */}
    <linearGradient id="k2-water" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#d9f0ff" /><stop offset="0.4" stopColor="#8fc4e8" /><stop offset="1" stopColor="#3b78a8" />
    </linearGradient>
    <radialGradient id="k2-drop" cx="0.38" cy="0.6" r="0.7">
      <stop offset="0" stopColor="#e8f6ff" /><stop offset="0.55" stopColor="#8fc4e8" /><stop offset="1" stopColor="#3b78a8" />
    </radialGradient>
    {/* 쇠(모종삽·물뿌리개 꼭지) — 세로 반사 */}
    <linearGradient id="k2-steel" x1="0" y1="0" x2="1" y2="0.3">
      <stop offset="0" stopColor="#f6f8fa" /><stop offset="0.35" stopColor="#c9d1d7" /><stop offset="0.7" stopColor="#8e99a2" /><stop offset="1" stopColor="#5f6a73" />
    </linearGradient>
    <linearGradient id="k2-wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#d8a66c" /><stop offset="0.5" stopColor="#b07a45" /><stop offset="1" stopColor="#6e4523" />
    </linearGradient>
    {/* 흙 단면 층 */}
    <linearGradient id="k2-top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#5e4330" /><stop offset="1" stopColor="#3e2b1d" />
    </linearGradient>
    <linearGradient id="k2-sub" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#8a6542" /><stop offset="1" stopColor="#6f4f33" />
    </linearGradient>
    <linearGradient id="k2-hole" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#1e140c" /><stop offset="1" stopColor="#3a281a" />
    </linearGradient>
    {/* 실내 배경 */}
    <linearGradient id="k2-wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#f3e7d0" /><stop offset="0.6" stopColor="#e2d2b4" /><stop offset="1" stopColor="#c9b592" />
    </linearGradient>
    <linearGradient id="k2-table" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#c99a66" /><stop offset="0.12" stopColor="#b5834f" /><stop offset="1" stopColor="#7d5430" />
    </linearGradient>
    <linearGradient id="k2-plain" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stopColor="#f6efe0" /><stop offset="1" stopColor="#dccfb6" />
    </linearGradient>
    <radialGradient id="k2-window" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor="#fff8e0" stopOpacity="0.85" /><stop offset="1" stopColor="#fff8e0" stopOpacity="0" />
    </radialGradient>
    {/* 계기판 색 띠 */}
    <linearGradient id="k2-ph" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#d9473a" /><stop offset="0.3" stopColor="#f2a43a" /><stop offset="0.5" stopColor="#7cb35a" /><stop offset="0.75" stopColor="#3f8f8c" /><stop offset="1" stopColor="#4a5fb8" />
    </linearGradient>
    <linearGradient id="k2-temp" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#4a78b8" /><stop offset="0.45" stopColor="#7cb35a" /><stop offset="0.7" stopColor="#f2c03a" /><stop offset="1" stopColor="#d9473a" />
    </linearGradient>
    <linearGradient id="k2-moist" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#b5834f" /><stop offset="0.45" stopColor="#7cb35a" /><stop offset="1" stopColor="#3b78a8" />
    </linearGradient>
    {/* 질감 — 테라코타 흙결, 부직포 펠트, 크라프트 종이 주름. 형태 색에 빛을 곱한다. */}
    <filter id="k2-clay" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="9" result="n" />
      <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale="0.45" diffuseConstant="1.12" result="l"><feDistantLight azimuth="225" elevation="58" /></feDiffuseLighting>
      <feComposite in="l" in2="SourceGraphic" operator="arithmetic" k1="1.04" k2="0" k3="0" k4="0" result="lit" />
      <feComposite in="lit" in2="SourceGraphic" operator="in" />
    </filter>
    <filter id="k2-felt" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="1.6 1.3" numOctaves="2" seed="13" result="n" />
      <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale="1.0" diffuseConstant="1.15" result="l"><feDistantLight azimuth="225" elevation="52" /></feDiffuseLighting>
      <feComposite in="l" in2="SourceGraphic" operator="arithmetic" k1="1.05" k2="0" k3="0" k4="0" result="lit" />
      <feComposite in="lit" in2="SourceGraphic" operator="in" />
    </filter>
    <filter id="k2-paper" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.018 0.06" numOctaves="3" seed="4" result="n" />
      <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale="3" diffuseConstant="1.1" result="l"><feDistantLight azimuth="225" elevation="55" /></feDiffuseLighting>
      <feComposite in="l" in2="SourceGraphic" operator="arithmetic" k1="1.06" k2="0" k3="0" k4="0" result="lit" />
      <feComposite in="lit" in2="SourceGraphic" operator="in" />
    </filter>
    <filter id="k2-woodgrain" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.004 0.12" numOctaves="3" seed="27" result="n" />
      <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale="2" diffuseConstant="1.1" result="l"><feDistantLight azimuth="225" elevation="55" /></feDiffuseLighting>
      <feComposite in="l" in2="SourceGraphic" operator="arithmetic" k1="1.04" k2="0" k3="0" k4="0" result="lit" />
      <feComposite in="lit" in2="SourceGraphic" operator="in" />
    </filter>
  </defs>
);
