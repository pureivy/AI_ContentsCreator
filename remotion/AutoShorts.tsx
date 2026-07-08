import React from 'react';
import { z } from 'zod';
import { AbsoluteFill, Series, Audio, staticFile } from 'remotion';
import { KenBurnsImage } from './KenBurnsImage';
import { KineticCaption } from './KineticCaption';
import { ProgressBar } from './ProgressBar';
import { StatCountUp } from './StatCountUp';
import { ListReveal } from './ListReveal';
import { QuoteCard } from './QuoteCard';

export const autoShortsSchema = z.object({
  scenes: z.array(z.object({
    imageSrc: z.string().nullable(),
    audioSrc: z.string().nullable(),
    screenText: z.string(),
    durationInFrames: z.number(),
    kind: z.enum(['hook', 'stat', 'list', 'quote', 'cta']).optional(),
    stat: z.object({ value: z.number(), unit: z.string().optional(), label: z.string().optional() }).optional(),
    items: z.array(z.string()).optional(),
    quote: z.object({ text: z.string(), source: z.string().optional() }).optional(),
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
    {s.kind === 'stat' && s.stat ? <StatCountUp stat={s.stat} total={s.durationInFrames} /> : null}
    {s.kind === 'list' && s.items?.length ? <ListReveal items={s.items} total={s.durationInFrames} /> : null}
    {s.kind === 'quote' && s.quote ? <QuoteCard quote={s.quote} total={s.durationInFrames} /> : null}
    <KineticCaption text={s.screenText} variant={s.kind === 'hook' || s.kind === 'cta' ? s.kind : undefined} />
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
