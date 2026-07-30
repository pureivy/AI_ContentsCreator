import React from 'react';
import { z } from 'zod';
import { AbsoluteFill, Series, Audio, staticFile, OffthreadVideo, useCurrentFrame } from 'remotion';
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
    clipFrames: z.number().optional(), // 실제 클립 길이(30fps 기준 프레임) — 감속 재생 배율 산정용. 없으면 CLIP_FRAMES 폴백.
    kind: z.enum(['hook', 'stat', 'list', 'quote', 'cta']).optional(),
    stat: z.object({ value: z.number(), unit: z.string().optional(), label: z.string().optional() }).optional(),
    items: z.array(z.string()).max(4).optional(),
    quote: z.object({ text: z.string(), source: z.string().optional() }).optional(),
  })),
  totalFrames: z.number(),
  /** 자막 옵션 — 위치(하단 여백 %)·키워드 강조색. 미지정=종전(하단 20%, 강조 없음). */
  caption: z.object({ bottomPct: z.number().optional(), keyword: z.string().optional() }).optional(),
});
export type AutoShortsProps = z.infer<typeof autoShortsSchema>;
export const defaultProps: AutoShortsProps = {
  scenes: [{ imageSrc: null, audioSrc: null, screenText: '샘플 자막 한 줄', durationInFrames: 90 }],
  totalFrames: 90,
};

const CLIP_FRAMES = 180; // 6초 클립 × 30fps 컴포지션 — clipFrames 미지정 시 감속 배율 산정 폴백

const Scene: React.FC<{ s: AutoShortsProps['scenes'][number]; index: number; caption?: AutoShortsProps['caption'] }> = ({ s, index, caption }) => {
  const f = useCurrentFrame();
  // 씬 시작 6프레임 페이드인(첫 씬 제외 — 훅은 즉시) — 하드컷 완화. 씬 길이 불변이라 TTS 싱크 무손상.
  const fade = index > 0 ? sceneEnterFade(f, 6) : 1;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {s.videoSrc ? (
        // 루프 금지 — 씬이 클립(≈6초)보다 길면 재생 속도를 낮춰 클립 한 번이 씬 전체를 덮는다.
        // 종전 <Loop>는 씬 중간에 클립이 처음으로 되감겨 '튕김'이 보였고(실측: 씬 6.6~8.0s vs 클립 6.04s
        // 로 거의 매 씬 발생), 감속 재생은 튕김 제거에 더해 I2V 잔결함(형태 흔들림)도 시각적으로 완화한다.
        <OffthreadVideo
          src={staticFile(s.videoSrc)}
          muted
          playbackRate={Math.min(1, (s.clipFrames ?? CLIP_FRAMES) / Math.max(1, s.durationInFrames))}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <KenBurnsImage src={s.imageSrc} total={s.durationInFrames} index={index} />
      )}
      {s.kind === 'stat' && s.stat ? <StatCountUp stat={s.stat} total={s.durationInFrames} /> : null}
      {s.kind === 'list' && s.items?.length ? <ListReveal items={s.items} total={s.durationInFrames} /> : null}
      {s.kind === 'quote' && s.quote ? <QuoteCard quote={s.quote} total={s.durationInFrames} /> : null}
      <KineticCaption text={s.screenText} variant={s.kind === 'hook' || s.kind === 'cta' ? s.kind : undefined} bottomPct={caption?.bottomPct} keyword={caption?.keyword} />
      {s.audioSrc ? <Audio src={staticFile(s.audioSrc)} /> : null}
    </AbsoluteFill>
  );
};

export const AutoShorts: React.FC<AutoShortsProps> = ({ scenes, caption }) => (
  <AbsoluteFill style={{ background: '#000', fontFamily: '"Noto Sans KR", sans-serif' }}>
    <Series>
      {scenes.map((s, i) => (
        <Series.Sequence key={i} durationInFrames={Math.max(1, s.durationInFrames)}>
          <Scene s={s} index={i} caption={caption} />
        </Series.Sequence>
      ))}
    </Series>
    <ProgressBar />
  </AbsoluteFill>
);
