import React from 'react';
import { z } from 'zod';
import { AbsoluteFill, Series, Audio, staticFile, Loop, OffthreadVideo, useCurrentFrame } from 'remotion';
import { sceneEnterFade } from './anim';
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
    videoSrc: z.string().nullable().optional(),
    kind: z.enum(['hook', 'stat', 'list', 'quote', 'cta']).optional(),
    stat: z.object({ value: z.number(), unit: z.string().optional(), label: z.string().optional() }).optional(),
    items: z.array(z.string()).max(4).optional(),
    quote: z.object({ text: z.string(), source: z.string().optional() }).optional(),
  })),
  totalFrames: z.number(),
});
export type AutoShortsProps = z.infer<typeof autoShortsSchema>;
export const defaultProps: AutoShortsProps = {
  scenes: [{ imageSrc: null, audioSrc: null, screenText: '샘플 자막 한 줄', durationInFrames: 90 }],
  totalFrames: 90,
};

const CLIP_FRAMES = 180; // 6초 클립 × 30fps 컴포지션 — 씬이 클립보다 길면 루프

const Scene: React.FC<{ s: AutoShortsProps['scenes'][number]; index: number }> = ({ s, index }) => {
  const f = useCurrentFrame();
  // 씬 시작 6프레임 페이드인(첫 씬 제외 — 훅은 즉시) — 하드컷 완화. 씬 길이 불변이라 TTS 싱크 무손상.
  const fade = index > 0 ? sceneEnterFade(f, 6) : 1;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {s.videoSrc ? (
        <Loop durationInFrames={CLIP_FRAMES}>
          <OffthreadVideo src={staticFile(s.videoSrc)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Loop>
      ) : (
        <KenBurnsImage src={s.imageSrc} total={s.durationInFrames} index={index} />
      )}
      {s.kind === 'stat' && s.stat ? <StatCountUp stat={s.stat} total={s.durationInFrames} /> : null}
      {s.kind === 'list' && s.items?.length ? <ListReveal items={s.items} total={s.durationInFrames} /> : null}
      {s.kind === 'quote' && s.quote ? <QuoteCard quote={s.quote} total={s.durationInFrames} /> : null}
      <KineticCaption text={s.screenText} variant={s.kind === 'hook' || s.kind === 'cta' ? s.kind : undefined} />
      {s.audioSrc ? <Audio src={staticFile(s.audioSrc)} /> : null}
    </AbsoluteFill>
  );
};

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
