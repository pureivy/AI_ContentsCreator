// 혼합(H) 롱폼 합성(2026-10-23 견본 — 본편 LongForm·LongFormFull 과 따로 돈다, 옵트인). 세그먼트 갈래마다:
//  card    = 에이전트 장면(CardStage + 정보 카드 부품, 흐린 실촬영 바탕)
//  diagram = 에이전트 장면(스타일 B 연필 도해 FullStage — fullscreen/styleB 그대로)
//  footage = FootageFull(주인공 수종 실촬영 전체 화면, 결정적 — 에이전트 없음)
// 공통 = 장 이름 알약(왼쪽 위) + 자막 띠(fullscreen/stage CaptionBand, 스타일 B 색) + 낭독. 갈래가 바뀌는 자리는 12프레임 겹쳐 녹아 넘어간다.
import React, { createContext, useContext } from 'react';
import { AbsoluteFill, Audio, Composition, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { ErrorBoundary } from '../scenes/SceneStage';
import { CaptionBand, FONT_UI, StageModeContext, clamp, type CaptionCue, type Footage, type FullSceneProps, type Theme, type Word } from '../fullscreen/stage';
import { FootageFull } from './FootageFull';
import { BlurBackdrop, CardStage, HY, HybridChapterTag } from './HybridStage';

export type HybridType = 'card' | 'diagram' | 'footage';
export interface HybridSegment {
  id: string; type: HybridType; chapterIndex: number; chapterTitle: string; startFrame: number; frames: number; audio: string;
  captions: CaptionCue[]; scene?: string; sceneWords?: Word[];
  /** 흐림본(가로) — card 바탕·footage 바탕. */ bg?: Footage;
  /** 선명본(세로) — footage 가운데. */ fg?: Footage;
}
export interface HybridChapter { index: number; title: string; startFrame: number; frames: number; bg?: Footage }
export type LongFormHybridProps = { title: string; totalFrames: number; chapterTotal?: number; chapters: HybridChapter[]; segments: HybridSegment[]; keywords?: string[] };

export type HybridSceneRegistry = Record<string, React.ComponentType<FullSceneProps>>;
export const HybridRegistryContext = createContext<HybridSceneRegistry>({});

/** 자막 띠 색 — 스타일 B 와 같은 미색 띠·흑연 글자·포인트 색 강조어. */
export const CAPTION_THEME: Theme = { paperSvg: '', paper: HY.paper, ink: HY.ink, muted: 'rgba(56,56,58,.3)', accent: HY.accent, labelFont: FONT_UI, captionBand: 'rgba(236,233,225,.94)', captionInk: '#2c2c2e' };
/** 갈래 사이 겹침(프레임). */
export const XFADE = 12;

/** 세그먼트 그림 한 칸(장 이름·자막 없이) — 갈래별. 장면이 없거나 던지면 바탕만(card = 흐린 실촬영, diagram = 종이). */
export const HybridVisual: React.FC<{ seg: Pick<HybridSegment, 'type' | 'frames' | 'bg' | 'fg' | 'sceneWords'>; scene?: React.ComponentType<FullSceneProps>; guard?: boolean; label?: string }> = ({ seg, scene: SceneComp, guard = true, label }) => {
  if (seg.type === 'footage') return <FootageFull frames={seg.frames} {...(seg.bg ? { bg: seg.bg } : {})} {...(seg.fg ? { fg: seg.fg } : {})} />;
  const fallback = seg.type === 'card' ? <CardStage frames={seg.frames} {...(seg.bg ? { footage: seg.bg } : {})} /> : <AbsoluteFill style={{ background: HY.paper }} />;
  if (!SceneComp) return fallback;
  const props: FullSceneProps = { durationInFrames: seg.frames, ...(seg.sceneWords ? { words: seg.sceneWords } : {}), ...(seg.type === 'card' && seg.bg ? { footage: seg.bg } : {}) };
  return guard
    ? <ErrorBoundary fallback={fallback} onError={(e) => console.error(`[장면 오류] ${label ?? ''}: ${e.message}`)}><SceneComp {...props} /></ErrorBoundary>
    : <SceneComp {...props} />;
};

/** 장 제목 카드 — 흐린 실촬영 바탕 위 유리 카드(편 제목·장 번호·장 제목). */
const ChapterCardH: React.FC<{ index: number; total: number; title: string; episode: string; frames: number; bg?: Footage }> = ({ index, total, title, episode, frames, bg }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [2, 18], [0, 1], clamp);
  const line = interpolate(f, [10, 34], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ fontFamily: FONT_UI }}>
      <BlurBackdrop footage={bg} frames={frames} dim={0.42} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 1280, padding: '54px 60px 60px', borderRadius: 52, textAlign: 'center', background: HY.glass, border: `2px solid ${HY.glassEdge}`,
          backdropFilter: 'blur(28px) saturate(1.3)', boxShadow: '0 26px 60px rgba(20,24,16,.26), inset 0 1px 0 rgba(255,255,255,.9)',
          opacity: p, transform: `translateY(${(1 - p) * 40}px) scale(${0.96 + 0.04 * p})` }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#fff', opacity: 0.92, textShadow: '0 2px 10px rgba(0,0,0,.3)' }}>{episode}</div>
          <div style={{ fontSize: 120, fontWeight: 900, color: '#fff', lineHeight: 1.05, marginTop: 18, textShadow: '0 4px 18px rgba(0,0,0,.25)' }}>
            {String(index + 1).padStart(2, '0')}<span style={{ fontSize: 56, opacity: 0.75 }}> / {String(total).padStart(2, '0')}</span>
          </div>
          <div style={{ display: 'inline-block', marginTop: 26, padding: '16px 46px 20px', borderRadius: 999, background: HY.accent, color: '#fff', fontSize: 84, fontWeight: 900, letterSpacing: -2, boxShadow: '0 12px 28px rgba(0,0,0,.2)' }}>{title}</div>
          <div style={{ height: 6, width: 520 * line, margin: '30px auto 0', borderRadius: 3, background: 'rgba(255,255,255,.8)' }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 겹쳐 녹아 들기 — 처음 XFADE 프레임 동안 불투명도 0 → 1(첫 칸은 바로). */
const FadeIn: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: on ? interpolate(f, [0, XFADE], [0, 1], clamp) : 1 }}>{children}</AbsoluteFill>;
};

export const LongFormHybrid: React.FC<LongFormHybridProps> = ({ title, chapters, segments, keywords, chapterTotal, totalFrames }) => {
  const registry = useContext(HybridRegistryContext);
  const total = chapterTotal ?? chapters.length;
  const blocks = [
    ...chapters.map((c) => ({ start: c.startFrame, frames: c.frames, node: <ChapterCardH index={c.index} total={total} title={c.title} episode={title} frames={c.frames} {...(c.bg ? { bg: c.bg } : {})} />, key: `c${c.index}` })),
    ...segments.map((s) => ({ start: s.startFrame, frames: s.frames, node: <HybridVisual seg={s} {...(s.scene && registry[s.scene] ? { scene: registry[s.scene] } : {})} label={s.scene ?? s.id} />, key: s.id })),
  ].sort((a, b) => a.start - b.start);
  return (
    <AbsoluteFill style={{ background: HY.paper, wordBreak: 'keep-all' }}>
      {/* 그림 층 — 앞 칸이 XFADE 프레임 더 살고, 다음 칸이 제 시각에 그 위로 녹아 든다(장면 프레임 0 = 낭독 시작 그대로). */}
      {blocks.map((b, i) => {
        const next = blocks[i + 1];
        const from = b.start;
        const until = next ? Math.min(next.start + XFADE, Math.max(next.start, totalFrames)) : Math.max(b.start + b.frames, totalFrames);
        return (
          <Sequence key={b.key} from={from} durationInFrames={Math.max(1, until - from)} name={b.key}>
            <FadeIn on={i > 0}>{b.node}</FadeIn>
          </Sequence>
        );
      })}
      {/* 장 이름·자막 띠·낭독 — 세그먼트 길이 그대로. */}
      {segments.map((s) => (
        <Sequence key={`ui-${s.id}`} from={s.startFrame} durationInFrames={s.frames} name={`ui-${s.id}`}>
          <HybridChapterTag index={s.chapterIndex} total={total} title={s.chapterTitle} />
          <CaptionBand captions={s.captions} theme={CAPTION_THEME} {...(keywords ? { keywords } : {})} />
          <Audio src={staticFile(s.audio)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ── 진입점 공장 ─────────────────────────────────────────────────
export type HybridSceneOneProps = {
  sceneKey: string; type: HybridType; durationInFrames: number; words?: Word[]; footage?: Footage; fg?: Footage;
  chapter?: { index: number; total: number; title: string }; captions?: CaptionCue[]; probe?: boolean;
};

/** 장면 하나(1920×1080, 장 이름·자막 띠까지) — 미리보기·검사. ErrorBoundary 없음(던지면 스틸 실패로 드러난다). probe = 단색 바탕에 그림만. */
export function makeHybridSceneComposition(scenes: HybridSceneRegistry): React.FC {
  const One: React.FC<HybridSceneOneProps> = ({ sceneKey, type, durationInFrames, words, footage, fg, chapter, captions, probe }) => {
    const C = type === 'footage' ? undefined : scenes[sceneKey];
    if (type !== 'footage' && !C) throw new Error(`등록되지 않은 장면: ${sceneKey}`);
    const seg = { type, frames: durationInFrames, ...(footage ? { bg: footage } : {}), ...(fg ? { fg } : {}), ...(words ? { sceneWords: words } : {}) };
    if (probe) return <StageModeContext.Provider value={{ probe: true }}><AbsoluteFill><HybridVisual seg={seg} {...(C ? { scene: C } : {})} guard={false} /></AbsoluteFill></StageModeContext.Provider>;
    return (
      <AbsoluteFill>
        <HybridVisual seg={seg} {...(C ? { scene: C } : {})} guard={false} />
        {chapter ? <HybridChapterTag {...chapter} /> : null}
        {captions ? <CaptionBand captions={captions} theme={CAPTION_THEME} /> : null}
      </AbsoluteFill>
    );
  };
  const def: HybridSceneOneProps = { sceneKey: '', type: 'card', durationInFrames: 150 };
  return () => (
    <Composition id="Scene" component={One} defaultProps={def} fps={30} width={1920} height={1080} durationInFrames={150}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.durationInFrames) })} />
  );
}

const empty: LongFormHybridProps = { title: '', totalFrames: 1, chapters: [], segments: [] };
export function makeLongFormHybridRoot(scenes: HybridSceneRegistry): React.FC {
  const WithScenes: React.FC<LongFormHybridProps> = (p) => (
    <HybridRegistryContext.Provider value={scenes}><LongFormHybrid {...p} /></HybridRegistryContext.Provider>
  );
  const SceneOne = makeHybridSceneComposition(scenes);
  return () => (
    <>
      <Composition id="LongFormHybrid" component={WithScenes} defaultProps={empty} fps={30} width={1920} height={1080} durationInFrames={1}
        calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.totalFrames) })} />
      <SceneOne />
    </>
  );
}
