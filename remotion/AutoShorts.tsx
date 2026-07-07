import React from 'react';
import { z } from 'zod';
import { AbsoluteFill } from 'remotion';

export const autoShortsSchema = z.object({
  scenes: z.array(
    z.object({
      imageSrc: z.string().nullable(),
      audioSrc: z.string().nullable(),
      screenText: z.string(),
      durationInFrames: z.number(),
    }),
  ),
  totalFrames: z.number(),
});
export type AutoShortsProps = z.infer<typeof autoShortsSchema>;

export const defaultProps: AutoShortsProps = {
  scenes: [{ imageSrc: null, audioSrc: null, screenText: '샘플 자막', durationInFrames: 90 }],
  totalFrames: 90,
};

export const AutoShorts: React.FC<AutoShortsProps> = ({ scenes }) => (
  <AbsoluteFill
    style={{ background: '#111', color: '#fff', justifyContent: 'center', alignItems: 'center', fontSize: 64 }}
  >
    {scenes[0]?.screenText}
  </AbsoluteFill>
);
