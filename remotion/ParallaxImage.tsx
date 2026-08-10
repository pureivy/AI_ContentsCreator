import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { parallaxOffset, smoothstep } from './anim';

/**
 * 2.5D 패럴랙스 배경 — 원본(배경층) 위에 깊이맵 전경 누끼(fg RGBA)를 얹고 서로 반대 방향으로
 * 움직여 입체감을 만든다. 두 층 동일한 저속 줌(1.10→1.16)으로 생동감 추가, 배경만 미세 블러
 * (이중상 은폐 + 피사계심도). 시작은 완전 정렬(오프셋 0)이라 첫 프레임 이중상 없음.
 */
export const ParallaxImage: React.FC<{ src: string; fgSrc: string; total: number; index: number }> = ({ src, fgSrc, total, index }) => {
  const f = useCurrentFrame();
  const bg = parallaxOffset(f, total, 'bg', index);
  const fg = parallaxOffset(f, total, 'fg', index);
  const zoom = 1.10 + 0.06 * smoothstep(total > 0 ? Math.min(1, f / (total * 0.85)) : 0);
  const fit: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${zoom}) translate(${bg.x}px, ${bg.y}px)`, filter: 'blur(2px)' }}>
        <Img src={staticFile(src)} style={fit} />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${zoom}) translate(${fg.x}px, ${fg.y}px)` }}>
        <Img src={staticFile(fgSrc)} style={fit} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
