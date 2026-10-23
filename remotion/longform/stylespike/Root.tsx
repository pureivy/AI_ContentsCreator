import React from 'react';
import { Composition } from 'remotion';
import { ErrorBoundary } from '../scenes/SceneStage';
import A1 from './styleA/S1';
import A2 from './styleA/S2';
import A3 from './styleA/S3';
import B1 from './styleB/S1';
import B2 from './styleB/S2';
import B3 from './styleB/S3';

type SP = { durationInFrames: number };
const wrap = (C: React.FC<SP>): React.FC<SP> => (p) => (
  <ErrorBoundary fallback={<div style={{ background: '#400', width: '100%', height: '100%' }} />} onError={(e) => console.error('[scene error]', e.message)}>
    <C {...p} />
  </ErrorBoundary>
);
const SCENES: Record<string, React.FC<SP>> = { A1, A2, A3, B1, B2, B3 };

export const StyleSpikeRoot: React.FC = () => (
  <>
    {Object.entries(SCENES).map(([id, C]) => (
      <Composition key={id} id={id} component={wrap(C)} defaultProps={{ durationInFrames: 180 }} fps={30} width={1920} height={1080} durationInFrames={180} />
    ))}
  </>
);
