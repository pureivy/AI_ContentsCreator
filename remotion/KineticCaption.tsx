import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { captionWordsVisible } from './anim';

export const KineticCaption: React.FC<{ text: string; variant?: 'hook' | 'cta' }> = ({ text, variant }) => {
  const f = useCurrentFrame();
  const words = text.split(/\s+/).filter(Boolean);
  const vis = captionWordsVisible(f, words.length);
  if (!words.length) return null; // 빈 자막 — 배경 박스(특히 cta 배지)도 그리지 않음
  const isHook = variant === 'hook';
  const isCta = variant === 'cta';
  const box: React.CSSProperties = isCta
    ? { background: '#e53935', borderRadius: 999, padding: '24px 56px', display: 'flex', flexWrap: 'wrap', gap: '0 14px', justifyContent: 'center' }
    : { padding: '32px 64px', display: 'flex', flexWrap: 'wrap', gap: '0 14px', justifyContent: 'center' }; // 자막 배경 없음(사용자 지정) — 가독성은 textShadow 담당
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '20%' }}>
      <div style={box}>
        {words.map((w, i) => (
          <span key={i} style={{ fontSize: isHook ? 78 : 64, fontWeight: 800, color: isHook ? '#ffd54a' : '#fff', lineHeight: 1.25, textShadow: '0 3px 18px rgba(0,0,0,.75)', opacity: i < vis ? 1 : 0, transform: i < vis ? 'none' : 'translateY(16px)' }}>{w}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
