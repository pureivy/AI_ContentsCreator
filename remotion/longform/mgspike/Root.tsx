import React from 'react';
import { Composition } from 'remotion';
import { ErrorBoundary } from '../scenes/SceneStage';
import Scene1 from './Scene1';
import Scene2 from './Scene2';
import Scene3 from './Scene3';
import type { SceneProps } from '../scenes/SceneStage';

// 장면 파일은 기본 내보내기 하나(KIT_API.md 계약). 무대(SceneStage)는 장면이 스스로 깐다.
const wrap = (C: React.FC<SceneProps>): React.FC<SceneProps> => (p) => (
  <ErrorBoundary fallback={<div style={{ background: '#14130f', width: '100%', height: '100%' }} />}>
    <C {...p} />
  </ErrorBoundary>
);
const S1 = wrap(Scene1), S2 = wrap(Scene2), S3 = wrap(Scene3);

export const MgSpikeRoot: React.FC = () => (
  <>
    <Composition id="MgSpike1" component={S1} defaultProps={{ durationInFrames: 180 }} fps={30} width={1100} height={680} durationInFrames={180} />
    <Composition id="MgSpike2" component={S2} defaultProps={{ durationInFrames: 180 }} fps={30} width={1100} height={680} durationInFrames={180} />
    <Composition id="MgSpike3" component={S3} defaultProps={{ durationInFrames: 180 }} fps={30} width={1100} height={680} durationInFrames={180} />
  </>
);
