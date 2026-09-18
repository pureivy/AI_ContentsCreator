import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { kenBurnsMove } from './anim';
import type { EffectsProp } from 'remotion';
import type { KenMove, KenIntensity } from './anim';

const GRAD = ['#1f2937', '#3b2f2f', '#22303c', '#2f2a3c', '#243027'];
// 중간 컷 뒤 절반의 확대 배율 — 컷 앞과 다른 크롭으로 보이려면 이만큼은 달라야 한다(1.1 은 같은 화면이 살짝 흔들린 것처럼 보인다).
// 팬 클램프(axisCap)는 배율 전 값으로 계산되므로 배율을 곱한 뒤엔 여유가 더 커진다 — 검은 띠 노출 불가 조건은 그대로 성립.
const CUT_SCALE = 1.25;
export const KenBurnsImage: React.FC<{ src: string | null; total: number; index: number; move?: KenMove; intensity?: KenIntensity; driftSeed?: string; effects?: EffectsProp;
  /** 중간 컷(2026-09-18) — 이 프레임부터 다른 궤도(index+7)·다른 드리프트 시드·CUT_SCALE 로 새로 시작한다(하드컷, 전환 없음). */
  cutAtFrame?: number }> = ({ src, total, index, move, intensity, driftSeed, effects, cutAtFrame }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const half = { w: width / 2, h: height / 2 };
  // 씬별 변주 — move 미지정이면 종전 그대로(짝수 줌인/홀수 줌아웃, 팬 4종 순환), 지정 시 push(훅 강줌+미세 회전) 등 확장 무브.
  // 컷 뒤에는 로컬 프레임을 0 부터 다시 세고 궤도 인덱스·시드를 바꿔 '다른 곳에서 찍은 컷'처럼 보이게 한다.
  const cut = cutAtFrame !== undefined && f >= cutAtFrame;
  const raw = cut
    ? kenBurnsMove(f - cutAtFrame!, total - cutAtFrame!, index + 7, move, intensity, half, driftSeed ? `${driftSeed}:cut` : undefined)
    : kenBurnsMove(f, total, index, move, intensity, half, driftSeed);
  const m = cut ? { ...raw, scale: raw.scale * CUT_SCALE } : raw;
  const transform = `scale(${m.scale}) translate(${m.x}px, ${m.y}px)${m.rotate ? ` rotate(${m.rotate}deg)` : ''}`;
  if (!src) return <AbsoluteFill style={{ background: `linear-gradient(160deg, ${GRAD[index % GRAD.length]}, #000)`, transform }} />;
  return <AbsoluteFill style={{ transform }}><Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} {...(effects ? { effects } : {})} /></AbsoluteFill>;
};
