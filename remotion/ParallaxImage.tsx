import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { parallaxOffset, smoothstep } from './anim';

/**
 * 2.5D 패럴랙스 배경 — 힐링 배경(bgSrc, 피사체 제거) 위에 깊이맵 전경 누끼(fgSrc RGBA)를 얹고
 * **돌리줌**(전경이 배경보다 빠르게 커짐: 배경 +2% vs 전경 +10%) + 미세 시차 팬으로 입체감을 만든다.
 * 이중상 방지 2중: ① 배경에 피사체 사본이 없고(힐링) ② 시작 오프셋 0(정렬)·팬 진폭 소폭(±14px).
 * 배경만 블러 2px — 피사계심도 + 힐링 경계 은폐. (평행이동 大진폭 방식은 사본 노출 실측으로 폐기)
 */
export const ParallaxImage: React.FC<{ bgSrc: string; fgSrc: string; total: number; index: number }> = ({ bgSrc, fgSrc, total, index }) => {
  const f = useCurrentFrame();
  const p = smoothstep(total > 0 ? Math.min(1, f / (total * 0.85)) : 0);
  const bg = parallaxOffset(f, total, 'bg', index);
  const fg = parallaxOffset(f, total, 'fg', index);
  const fit: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${1.10 + 0.02 * p}) translate(${bg.x}px, ${bg.y}px)`, filter: 'blur(2px)' }}>
        <Img src={staticFile(bgSrc)} style={fit} />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${1.10 + 0.10 * p}) translate(${fg.x}px, ${fg.y}px)` }}>
        <Img src={staticFile(fgSrc)} style={fit} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
