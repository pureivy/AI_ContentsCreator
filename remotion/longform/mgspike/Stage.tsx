// MG 스파이크 — 도해 무대(Diagrams.tsx 의 Diagram 감싸개와 같은 구성). 에이전트는 장면 몸통만 쓰고, 무대는 공통.
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { FONT_FAMILY } from '../../loadFonts';
import { Backdrop, Camera, KitDefs, MacroCtx } from '../illus/Kit';

export const Stage: React.FC<{ frames?: number; macro?: boolean; children: React.ReactNode }> = ({ frames = 180, macro = false, children }) => (
  <AbsoluteFill style={{ background: '#14130f', fontFamily: FONT_FAMILY, wordBreak: 'keep-all' }}>
    <MacroCtx.Provider value={macro}>
      <svg viewBox="0 0 1000 620" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <KitDefs />
        <Backdrop />
        <g clipPath="url(#kit-frame)">
          <Camera frames={frames}>{children}</Camera>
        </g>
      </svg>
    </MacroCtx.Provider>
  </AbsoluteFill>
);
