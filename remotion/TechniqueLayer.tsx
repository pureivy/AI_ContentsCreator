import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, random, interpolate, Easing } from 'remotion';
import type { EditTechnique } from './editTechniques';

/**
 * 선택 기법의 화면 층(2026-09-04) — 배경 위·자막 아래에 얹힌다.
 *
 * 자막보다 아래라는 게 중요하다. 레터박스 바가 자막을 덮으면 읽기가 죽는다. 그래서 바 두께는
 * 자막 세이프존(하단 30% 안팎)을 침범하지 않는 선에서 정한다.
 *
 * 듀오톤은 여기가 아니라 <Img effects> 쪽에서 처리한다 — 배경 화소를 직접 바꿔야 하기 때문.
 */
export const TechniqueLayer: React.FC<{
  readonly tech: EditTechnique;
  readonly seed: string;
  readonly total: number;
}> = ({ tech, seed, total }) => {
  const f = useCurrentFrame();
  const { height } = useVideoConfig();

  if (tech === '레터박스') {
    // 시네마 바 — 위아래에서 밀려 들어온다. 자막(하단 ~30%)을 안 건드리게 두께를 묶는다.
    const p = interpolate(f, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    const barPct = 6 + random(`${seed}:lb`) * 3; // 6~9%
    const bar = `${barPct * p}%`;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: bar, background: '#000' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: bar, background: '#000' }} />
      </AbsoluteFill>
    );
  }

  if (tech === '테두리 프레임') {
    // 인화지 테두리 — 흰 여백이 안쪽으로 들어온다. 사진 한 장을 붙여 놓은 느낌.
    const p = interpolate(f, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    // 30~46px(화면 폭의 2.8~4.3%) — 10~18px 로 했더니 실렌더에서 안 보였다.
    const w = (30 + random(`${seed}:fr`) * 16) * p;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', border: `${w}px solid rgba(250,248,242,0.92)` }} />
    );
  }

  if (tech === '비네트 호흡') {
    // 가장자리 어둠이 천천히 숨 쉰다 — 정지 이미지에 '살아 있는' 기운을 준다.
    const cycle = Math.sin((f / Math.max(1, total)) * Math.PI * 2) * 0.5 + 0.5;
    const a = 0.10 + cycle * 0.16;
    return (
      <AbsoluteFill style={{
        pointerEvents: 'none',
        background: `radial-gradient(ellipse at 50% 45%, transparent 42%, rgba(0,0,0,${a.toFixed(3)}) 100%)`,
      }} />
    );
  }

  if (tech === '초점 띠') {
    // 틸트시프트 — 위아래를 살짝 흐리고 가운데 띠만 선명. 재배장 전경처럼 배경이 복잡한 장면에서 시선을 모은다.
    // 자막은 이 층 위라 선명하다. 실촬영 씬에는 안 건다(techniqueScene 이 피한다) — 잎 디테일이 곧 정보다.
    const p = interpolate(f, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    const px = (4 + random(`${seed}:tsb`) * 3) * p; // 4~7px
    const band = 24 + random(`${seed}:tsh`) * 6;    // 위아래 각 24~30%
    const soft = 10;
    const common: React.CSSProperties = { position: 'absolute', left: 0, right: 0, backdropFilter: `blur(${px.toFixed(1)}px)`, WebkitBackdropFilter: `blur(${px.toFixed(1)}px)` };
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div style={{ ...common, top: 0, height: `${band}%`, maskImage: `linear-gradient(to bottom, black ${100 - soft * 2}%, transparent 100%)`, WebkitMaskImage: `linear-gradient(to bottom, black ${100 - soft * 2}%, transparent 100%)` }} />
        <div style={{ ...common, bottom: 0, height: `${band}%`, maskImage: `linear-gradient(to top, black ${100 - soft * 2}%, transparent 100%)`, WebkitMaskImage: `linear-gradient(to top, black ${100 - soft * 2}%, transparent 100%)` }} />
      </AbsoluteFill>
    );
  }

  return null; // '정지 강조'·'컬러 팝'·'소프트 글로우'·'아이리스 리빌'·'핸드헬드 흔들림'은 화면 층이 아니라 Scene(배경 effects·transform)에서 처리한다
};
