// 시범 도해 회귀 확인용 — Diagrams.tsx 의 Diagram 을 그대로 세 종류 띄운다(키트 추가 전후 픽셀 비교).
import React from 'react';
import { AbsoluteFill, Composition } from 'remotion';
import { FONT_FAMILY } from '../../../loadFonts';
import { Diagram } from '../../Diagrams';
import type { Mg } from '../../types';

const CASES: Array<[string, Mg]> = [
  ['PilotTimeline', { kind: 'timeline', start: '11월', end: '3월' }],
  ['PilotCollar', { kind: 'collar' }],
  ['PilotNewPlant', { kind: 'newPlant', step: 1 }],
];

const Wrap: React.FC<{ mg: Mg }> = ({ mg }) => (
  <AbsoluteFill style={{ background: '#14130f', fontFamily: FONT_FAMILY, wordBreak: 'keep-all' }}>
    <Diagram mg={mg} frames={150} />
  </AbsoluteFill>
);

export const PilotCompositions: React.FC = () => (
  <>
    {CASES.map(([id, mg]) => (
      <Composition key={id} id={id} component={Wrap} defaultProps={{ mg }} fps={30} width={1100} height={680} durationInFrames={150} />
    ))}
  </>
);
