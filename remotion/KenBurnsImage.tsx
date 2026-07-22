import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { kenBurnsScale, kenBurnsPan } from './anim';

const GRAD = ['#1f2937', '#3b2f2f', '#22303c', '#2f2a3c', '#243027'];
export const KenBurnsImage: React.FC<{ src: string | null; total: number; index: number }> = ({ src, total, index }) => {
  const f = useCurrentFrame();
  // 씬별 변주 — 짝수 씬 줌인/홀수 씬 줌아웃, 팬 방향 4종 순환(smoothstep 이징). 단조로움 제거.
  const scale = kenBurnsScale(f, total, 1.08, index);
  const pan = kenBurnsPan(f, total, index);
  const transform = `scale(${scale}) translate(${pan.x}px, ${pan.y}px)`;
  if (!src) return <AbsoluteFill style={{ background: `linear-gradient(160deg, ${GRAD[index % GRAD.length]}, #000)`, transform }} />;
  return <AbsoluteFill style={{ transform }}><Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></AbsoluteFill>;
};
