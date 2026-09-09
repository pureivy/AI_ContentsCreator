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
  /** 화면 기준 초점(0~1) — 좌표 기법(포인터 링·스포트라이트)의 입력. 없으면 그 기법은 안 그린다. */
  readonly focus?: { readonly x: number; readonly y: number };
}> = ({ tech, seed, total, focus }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();

  if (tech === '포인터 링' && focus) {
    // 초점에 원이 조여들며 짚는다(2026-09-09) — "여기를 자른다"를 손가락 없이 말한다.
    // 노란 링 + 검은 외곽선: 밝은 하늘·어두운 흙 어디에 놓여도 보인다. 자리 잡은 뒤엔 숨 쉬듯 살짝 뛰고,
    // 1.4초마다 바깥으로 물결 하나가 퍼진다(계속 보라는 신호).
    const cx = focus.x * width, cy = focus.y * height;
    const d = 150 + random(`${seed}:ring`) * 40; // 150~190px
    const ap = interpolate(f, [6, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    const settle = 2.4 - 1.4 * ap;
    const pulse = ap >= 1 ? 1 + 0.035 * Math.sin((f - 18) / 5) : 1;
    const rf = Math.max(0, f - 18) % 42;
    const rippleOn = f >= 18 && rf < 30;
    const rp = Math.min(1, rf / 30);
    const base: React.CSSProperties = { position: 'absolute', left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: '50%' };
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {rippleOn ? <div style={{ ...base, border: '4px solid rgba(255,214,74,0.9)', opacity: (1 - rp) * 0.7, transform: `scale(${(1 + rp * 0.9).toFixed(3)})` }} /> : null}
        <div style={{
          ...base, border: '7px solid rgba(255,214,74,0.96)', opacity: ap,
          boxShadow: '0 0 0 3px rgba(0,0,0,0.45), inset 0 0 0 3px rgba(0,0,0,0.35), 0 6px 24px rgba(0,0,0,0.35)',
          transform: `scale(${(settle * pulse).toFixed(3)})`,
        }} />
      </AbsoluteFill>
    );
  }

  if (tech === '스포트라이트' && focus) {
    // 초점만 밝고 주변은 어둡게(2026-09-09) — 비네트의 강화판. 밑동·접목 자리처럼 작은 대상을 볼 때.
    // 자막은 이 층 위라 어두워지지 않는다. 반경은 px 로 — circle 의 크기는 % 를 못 쓴다.
    const a = interpolate(f, [0, 16], [0, 0.6 + random(`${seed}:spa`) * 0.12], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    const inner = 220 + random(`${seed}:spr`) * 60; // 맑은 반경 220~280px
    const outer = inner + 200;
    return (
      <AbsoluteFill style={{
        pointerEvents: 'none',
        background: `radial-gradient(circle at ${(focus.x * 100).toFixed(1)}% ${(focus.y * 100).toFixed(1)}%, rgba(0,0,0,0) ${inner.toFixed(0)}px, rgba(0,0,0,${a.toFixed(3)}) ${outer.toFixed(0)}px)`,
      }} />
    );
  }

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

  return null; // '정지 강조'·'컬러 팝'·'소프트 글로우'·'아이리스 리빌'·'핸드헬드 흔들림'·'줌 스루 전환'은 Scene(배경 effects·transform), '인셋 확대창'은 InsetZoom, '키워드 팝'은 KineticCaption 에서 처리한다
};
