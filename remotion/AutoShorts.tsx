import React from 'react';
import { z } from 'zod';
import { AbsoluteFill, Series, Audio, staticFile } from 'remotion';
import { KenBurnsImage } from './KenBurnsImage';
import { KineticCaption } from './KineticCaption';
import { ProgressBar } from './ProgressBar';

export const autoShortsSchema = z.object({
  scenes: z.array(z.object({
    imageSrc: z.string().nullable(),
    audioSrc: z.string().nullable(),
    screenText: z.string(),
    durationInFrames: z.number(),
  })),
  totalFrames: z.number(),
});
export type AutoShortsProps = z.infer<typeof autoShortsSchema>;
export const defaultProps: AutoShortsProps = {
  scenes: [{ imageSrc: null, audioSrc: null, screenText: '샘플 자막 한 줄', durationInFrames: 90 }],
  totalFrames: 90,
};

const Scene: React.FC<{ s: AutoShortsProps['scenes'][number]; index: number }> = ({ s, index }) => (
  <AbsoluteFill>
    <KenBurnsImage src={s.imageSrc} total={s.durationInFrames} index={index} />
    <KineticCaption text={s.screenText} />
    {s.audioSrc ? <Audio src={staticFile(s.audioSrc)} /> : null}
  </AbsoluteFill>
);

export const AutoShorts: React.FC<AutoShortsProps> = ({ scenes }) => (
  <AbsoluteFill style={{ background: '#000', fontFamily: '"Noto Sans KR", sans-serif' }}>
    <Series>
      {scenes.map((s, i) => (
        <Series.Sequence key={i} durationInFrames={Math.max(1, s.durationInFrames)}>
          <Scene s={s} index={i} />
        </Series.Sequence>
      ))}
    </Series>
    <ProgressBar />
  </AbsoluteFill>
);
