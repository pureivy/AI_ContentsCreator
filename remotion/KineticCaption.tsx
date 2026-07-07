import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { captionWordsVisible } from './anim';

export const KineticCaption: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const words = text.split(/\s+/).filter(Boolean);
  const vis = captionWordsVisible(f, words.length);
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '20%' }}>
      <div style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.45))', padding: '32px 64px', display: 'flex', flexWrap: 'wrap', gap: '0 14px', justifyContent: 'center' }}>
        {words.map((w, i) => (
          <span key={i} style={{ fontSize: 64, fontWeight: 800, color: '#fff', lineHeight: 1.25, textShadow: '0 3px 18px rgba(0,0,0,.75)', opacity: i < vis ? 1 : 0, transform: i < vis ? 'none' : 'translateY(16px)' }}>{w}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
