// 자동 장면 무대 — 장면 파일은 이 무대 안에 몸통만 그린다. 1100×680 컴포지션, 도해 좌표 viewBox 1000×620.
// 배경(sky·macro·indoor·plain), 천천히 당기는 카메라(+선택 확대), 한글 폰트, KitDefs + Kit2Defs 를 한 번에 깐다.
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { FONT_FAMILY } from '../../loadFonts';
import { Camera, KitDefs, MacroBackdrop, MacroCtx, Backdrop } from '../illus/Kit';
import { Kit2Defs } from '../illus/k2/defs';
import { TABLE_Y, type Word } from '../illus/sceneUtil';

/** 장면 파일 기본 내보내기의 props — durationInFrames 는 이 문장 길이, words 는 낭독 단어 시각(장면 시작부터 초). */
export type SceneProps = { durationInFrames: number; words?: Word[] };

export type BackdropKind = 'sky' | 'macro' | 'indoor' | 'plain';
export type CameraFocus = { x: number; y: number; at: number; scale?: number };

/** 실내 — 따뜻한 벽, 왼쪽 위 창빛, 나무 작업대(윗면 y=TABLE_Y). */
const IndoorBackdrop: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <g clipPath="url(#kit-frame)">
      <rect x={0} y={0} width={1000} height={620} fill="url(#k2-wall)" />
      {/* 창빛 — 왼쪽 위에서 벽에 비스듬히 떨어지는 밝은 사각, 아주 천천히 흔들리는 잎 그림자 */}
      <g opacity={0.9}>
        <path d="M 70 40 L 330 40 L 380 330 L 120 330 Z" fill="url(#k2-window)" />
        {[0, 1, 2].map((i) => <ellipse key={i} cx={170 + i * 70 + Math.sin(f / 40 + i) * 6} cy={150 + i * 40} rx={36} ry={14} fill="#a89573" opacity={0.18} transform={`rotate(${-30 + i * 20} ${170 + i * 70} ${150 + i * 40})`} filter="url(#kit-blur4)" />)}
      </g>
      <rect x={0} y={TABLE_Y - 40} width={1000} height={40} fill="#000" opacity={0.06} filter="url(#kit-blur4)" />
      {/* 작업대 — 윗면(밝은 띠)과 앞면 */}
      <rect x={0} y={TABLE_Y} width={1000} height={620 - TABLE_Y} fill="url(#k2-table)" filter="url(#k2-woodgrain)" />
      <rect x={0} y={TABLE_Y} width={1000} height={3} fill="#e3b985" opacity={0.8} />
      <rect x={0} y={TABLE_Y + 46} width={1000} height={620} fill="#000" opacity={0.16} />
      <rect x={0} y={0} width={1000} height={620} fill="url(#kit-vignette)" opacity={0.7} />
    </g>
  );
};

/** 무지 — 종이빛 바탕에 가장자리만 살짝 어둡게. 단면·도식 위주 장면. */
const PlainBackdrop: React.FC = () => (
  <g clipPath="url(#kit-frame)">
    <rect x={0} y={0} width={1000} height={620} fill="url(#k2-plain)" />
    <ellipse cx={240} cy={120} rx={420} ry={260} fill="#fffaf0" opacity={0.45} filter="url(#kit-bokeh)" />
    <rect x={0} y={0} width={1000} height={620} fill="url(#kit-vignette)" opacity={0.6} />
  </g>
);

export const SceneStage: React.FC<{ frames: number; backdrop?: BackdropKind; focus?: CameraFocus; children: React.ReactNode }> = ({ frames, backdrop = 'sky', focus, children }) => {
  const macro = backdrop === 'macro';
  return (
    <AbsoluteFill style={{ background: '#14130f', fontFamily: FONT_FAMILY, wordBreak: 'keep-all' }}>
      <MacroCtx.Provider value={macro}>
        <svg viewBox="0 0 1000 620" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          <KitDefs />
          <Kit2Defs />
          {backdrop === 'sky' ? <Backdrop /> : backdrop === 'macro' ? <MacroBackdrop /> : backdrop === 'indoor' ? <IndoorBackdrop /> : <PlainBackdrop />}
          <g clipPath="url(#kit-frame)">
            <Camera frames={frames} {...(focus ? { focus } : {})}>{children}</Camera>
          </g>
        </svg>
      </MacroCtx.Provider>
    </AbsoluteFill>
  );
};

/** 장면 하나가 던진 오류를 잡아 fallback 을 그린다(던진 오류만 — NaN 좌표 같은 조용한 실패는 못 잡는다). */
export class ErrorBoundary extends React.Component<{ fallback: React.ReactNode; onError?: (e: Error) => void; children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(e: Error): void {
    this.props.onError?.(e);
  }
  override render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
