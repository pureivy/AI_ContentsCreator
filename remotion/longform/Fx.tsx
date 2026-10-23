// 롱폼 편집 기법 층 — 숏폼 편집 기법 14종(remotion/editTechniques.ts·TechniqueLayer·AutoShorts Scene)을
// 왼쪽 세로 패널(PANEL_W×PANEL_H) 기준으로 옮겼다. 좌표 기법은 패널 픽셀로 계산한다.
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, random, staticFile, useCurrentFrame } from 'remotion';
import { TechniqueLayer } from '../TechniqueLayer';
import type { EditTechnique } from '../editTechniques';

export const PANEL_W = 567;
export const PANEL_H = 1008;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 패널 위에 얹는 층 — 레터박스·테두리·비네트·초점 띠는 숏폼 TechniqueLayer 그대로(패널을 꽉 채우는 AbsoluteFill 이라 맞는다). */
export const PanelTechLayer: React.FC<{ tech: string; seed: string; total: number; focus?: { x: number; y: number }; still?: string }> = ({ tech, seed, total, focus, still }) => {
  const f = useCurrentFrame();
  if (['레터박스', '테두리 프레임', '비네트 호흡', '초점 띠'].includes(tech)) {
    return <TechniqueLayer tech={tech as EditTechnique} seed={seed} total={total} />;
  }
  if (tech === '포인터 링' && focus) {
    const cx = focus.x * PANEL_W, cy = focus.y * PANEL_H;
    const d = 120 + random(`${seed}:ring`) * 30;
    const ap = interpolate(f, [6, 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    const pulse = ap >= 1 ? 1 + 0.035 * Math.sin((f - 18) / 5) : 1;
    const rf = Math.max(0, f - 18) % 42, rp = Math.min(1, rf / 30);
    const base: React.CSSProperties = { position: 'absolute', left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: '50%' };
    return (
      <AbsoluteFill>
        {f >= 18 && rf < 30 ? <div style={{ ...base, border: '4px solid rgba(255,214,74,0.9)', opacity: (1 - rp) * 0.7, transform: `scale(${1 + rp * 0.9})` }} /> : null}
        <div style={{ ...base, border: '7px solid rgba(255,214,74,0.96)', opacity: ap, boxShadow: '0 0 0 3px rgba(0,0,0,0.45)', transform: `scale(${(2.4 - 1.4 * ap) * pulse})` }} />
      </AbsoluteFill>
    );
  }
  if (tech === '스포트라이트' && focus) {
    const a = interpolate(f, [0, 16], [0, 0.62], { ...clamp, easing: Easing.out(Easing.cubic) });
    return <AbsoluteFill style={{ background: `radial-gradient(circle at ${focus.x * 100}% ${focus.y * 100}%, rgba(0,0,0,0) 150px, rgba(0,0,0,${a}) 330px)` }} />;
  }
  if (tech === '인셋 확대창' && focus && still) {
    // 초점 부위를 2.2배로 띄운 원형 창 — 초점 반대쪽(위·아래) 절반에 앉힌다.
    const D = 300, Z = 2.2;
    const p = interpolate(f, [4, 16], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
    const top = focus.y < 0.5 ? PANEL_H - D - 60 : 60;
    const left = (PANEL_W - D) / 2;
    const bx = -(focus.x * PANEL_W * Z - D / 2), by = -(focus.y * PANEL_H * Z - D / 2);
    return (
      <AbsoluteFill>
        <div style={{ position: 'absolute', left, top, width: D, height: D, borderRadius: '50%', overflow: 'hidden', border: '8px solid #faf8f2', boxShadow: '0 10px 30px rgba(0,0,0,.5)', transform: `scale(${p})` }}>
          <Img src={staticFile(still)} style={{ position: 'absolute', left: bx, top: by, width: PANEL_W * Z, height: PANEL_H * Z, objectFit: 'cover' }} />
        </div>
      </AbsoluteFill>
    );
  }
  return null;
};

/** 패널 미디어를 감싸는 움직임 — 등장 효과·아이리스·핸드헬드·줌 스루·정지 강조(숏폼 Scene 과 같은 값). */
export function usePanelWrapStyle(o: { tech?: string; enter: string; seed: string; frames: number; exitZoom: boolean }): React.CSSProperties {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, 6], [0, 1], clamp);
  const st: React.CSSProperties = { opacity: p };
  const tf: string[] = [];
  if (o.enter === 'slide-up') tf.push(`translateY(${(1 - p) * 24}px)`);
  else if (o.enter === 'scale') tf.push(`scale(${0.96 + 0.04 * p})`);
  else if (o.enter === 'wipe') { st.opacity = 1; st.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`; }
  if (o.tech === '아이리스 리빌') {
    const r = interpolate(f, [0, 18], [8, 150], { ...clamp, easing: Easing.out(Easing.cubic) });
    st.opacity = 1; st.clipPath = `circle(${r}% at 50% 45%)`;
  }
  if (o.tech === '핸드헬드 흔들림') {
    const amp = 3 + random(`${o.seed}:hha`) * 3;
    const x = amp * Math.sin(f / 11 + 1.3) + amp * 0.5 * Math.sin(f / 5.3 + 0.4);
    const y = amp * 0.8 * Math.sin(f / 9 + 2.1) + amp * 0.4 * Math.sin(f / 4.1 + 1.3);
    tf.push(`translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(1.025)`);
  }
  if (o.tech === '줌 스루 전환') {
    const q = interpolate(f, [0, 10], [1, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
    st.opacity = 1; tf.push(`scale(${1 + 0.3 * q})`);
    if (q > 0.01) st.filter = `blur(${6 * q}px)`;
  }
  if (o.exitZoom) {
    const q = interpolate(f, [o.frames - 8, o.frames], [0, 1], clamp);
    if (q > 0) { tf.push(`scale(${1 + 0.3 * q})`); st.filter = `blur(${6 * q}px)`; }
  }
  if (tf.length) st.transform = tf.join(' ');
  return st;
}

/** 정지 강조 — 들어올 때 흰 번쩍임 한 번(배경 움직임은 호출 쪽에서 멈춘다). */
export const FreezeFlash: React.FC = () => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 3, 10], [0, 0.55, 0], clamp);
  return <AbsoluteFill style={{ background: '#fff', opacity: a }} />;
};
