// 전체 화면 롱폼 합성(2026-10-23 견본 — 본편 LongForm 과 따로 돈다). 세그먼트마다: 장면(화면 전체) + 장 이름(왼쪽 위) + 자막 띠(아래 18%) + 낭독.
// 장 시작마다 같은 스타일의 장 제목 카드. 장면이 없거나 던지면 종이 바탕 + (있으면) 실촬영 카드로 대신한다.
import React, { createContext, useContext, useMemo } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { ErrorBoundary } from '../scenes/SceneStage';
import { BaseStage, CaptionBand, ChapterTag, FootageInset, FONT_UI, H, StageModeContext, W, clamp, svgUri, type FullSceneProps, type Theme } from './stage';
import { ADefs, ALeaf, THEME_A } from './styleA/kit';
import { BDefs, BLeaf, THEME_B } from './styleB/kit';
import { BioneeActor } from './bionee/BioneeActor';
import type { LongFormFullProps } from '../../../src/longform/fullProps';
import { bioneeTimeline } from '../../../src/longform/bioneeCues';

export type FullSceneRegistry = Record<string, React.ComponentType<FullSceneProps>>;
export const FullSceneRegistryContext = createContext<FullSceneRegistry>({});

export const STYLES = {
  A: { theme: THEME_A, defs: <ADefs />, filter: undefined as string | undefined, Leaf: ALeaf },
  B: { theme: THEME_B, defs: <BDefs />, filter: 'url(#b-graphite)' as string | undefined, Leaf: BLeaf },
} as const;

/** 장 제목 카드 — 종이 위에 장 번호(포인트 색)·장 제목(라벨 글꼴)·가는 줄, 잎 두 장이 그려진다. */
const ChapterCard: React.FC<{ style: 'A' | 'B'; index: number; total: number; title: string; episode: string; frames: number }> = ({ style, index, total, title, episode, frames }) => {
  const f = useCurrentFrame();
  const S = STYLES[style];
  const th: Theme = S.theme;
  const o = interpolate(f, [0, 10, frames - 10, frames], [0, 1, 1, 0], clamp);
  const line = interpolate(f, [8, 30], [0, 1], clamp);
  const leafP = interpolate(f, [4, 30], [0, 1], clamp);
  const Leaf = S.Leaf;
  return (
    <AbsoluteFill style={{ background: th.paper }}>
      <Img src={svgUri(th.paperSvg)} style={{ position: 'absolute', inset: 0, width: W, height: H }} />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, width: W, height: H }}>
        <defs>{S.defs}</defs>
        <g opacity={o} {...(S.filter ? { filter: S.filter } : {})}>
          <Leaf x={960} y={330} angle={-128} len={78} p={leafP} tone={0.6} />
          <Leaf x={960} y={330} angle={-52} len={70} p={leafP} tone={0.3} flip={-1} />
          <path d={`M ${960 - 330 * line} 775 L ${960 + 330 * line} 775`} stroke={th.ink} strokeWidth={2} opacity={0.7} />
        </g>
      </svg>
      <AbsoluteFill style={{ opacity: o, alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: th.labelFont }}>
        <div style={{ fontSize: 30, color: th.ink, opacity: 0.6, marginTop: 40, fontWeight: 700 }}>{episode}</div>
        <div style={{ fontFamily: FONT_UI, fontSize: 112, fontWeight: 800, color: th.accent, lineHeight: 1.05, marginTop: 22 }}>
          {String(index + 1).padStart(2, '0')}<span style={{ fontSize: 52, color: th.muted }}> / {String(total).padStart(2, '0')}</span>
        </div>
        <div style={{ fontSize: 92, fontWeight: 700, color: th.ink, marginTop: 26, lineHeight: 1.2 }}>{title}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 장면이 없을 때(검사 탈락·오류) — 빈 종이 + 실촬영 카드(있으면). */
const Fallback: React.FC<FullSceneProps & { style: 'A' | 'B' }> = ({ durationInFrames, footage, style }) => (
  <BaseStage frames={durationInFrames} theme={STYLES[style].theme} overlay={footage ? <FootageInset footage={footage} x={960} y={460} h={620} at={0} /> : null} />
);

/** 세그먼트 한 칸 — 장면(또는 대신) + 장 이름 + 자막 띠. LongFormFull 과 미리보기('Scene')가 같이 쓴다. */
export const FullFrame: React.FC<{
  style: 'A' | 'B'; scene?: React.ComponentType<FullSceneProps>; sceneProps: FullSceneProps; chapter: { index: number; total: number; title: string };
  captions?: Array<{ text: string; startFrame: number; endFrame: number }>; keywords?: readonly string[]; guard?: boolean; label?: string;
  /** 진행자 자리 비우기 — 장면 그림 층을 이 비율로 오른쪽 위로 줄인다(없으면 종전 그대로). */
  sceneScale?: number;
}> = ({ style, scene: SceneComp, sceneProps, chapter, captions, keywords, guard = true, label, sceneScale }) => {
  const th = STYLES[style].theme;
  const fallback = <Fallback {...sceneProps} style={style} />;
  const scene = SceneComp ? (guard ? (
    <ErrorBoundary fallback={fallback} onError={(e) => console.error(`[장면 오류] ${label ?? ''}: ${e.message}`)}>
      <SceneComp {...sceneProps} />
    </ErrorBoundary>
  ) : <SceneComp {...sceneProps} />) : fallback;
  return (
    <AbsoluteFill>
      {sceneScale != null ? <StageModeContext.Provider value={{ probe: false, sceneScale }}>{scene}</StageModeContext.Provider> : scene}
      <ChapterTag {...chapter} theme={th} />
      {captions ? <CaptionBand captions={captions} theme={th} {...(keywords ? { keywords } : {})} /> : null}
    </AbsoluteFill>
  );
};

export const LongFormFull: React.FC<LongFormFullProps> = ({ title, style, chapters, segments, keywords, chapterTotal, presenter, totalFrames }) => {
  const registry = useContext(FullSceneRegistryContext);
  const total = chapterTotal ?? chapters.length;
  const th = STYLES[style].theme;
  // 진행자 비온이(2026-10-23 코드 리그) — 세그먼트 신호·입 열림을 편 전체 시간표 하나로(장면 좌표 → 화면 좌표, 장 제목 카드 몸짓 포함)
  const host = useMemo(() => (presenter ? bioneeTimeline(segments, chapters, totalFrames, { sceneScale: presenter.sceneScale, ...(presenter.hostScale ? { scale: presenter.hostScale } : {}) }) : null), [presenter, segments, chapters, totalFrames]);
  return (
    <AbsoluteFill style={{ background: th.paper, wordBreak: 'keep-all' }}>
      {chapters.map((c) => (
        <Sequence key={`c${c.index}`} from={c.startFrame} durationInFrames={c.frames}>
          <ChapterCard style={style} index={c.index} total={total} title={c.title} episode={title} frames={c.frames} />
        </Sequence>
      ))}
      {segments.map((s) => (
        <Sequence key={s.id} from={s.startFrame} durationInFrames={s.frames}>
          <FullFrame style={style} {...(s.scene && registry[s.scene] ? { scene: registry[s.scene] } : {})} label={s.scene ?? s.id}
            sceneProps={{ durationInFrames: s.frames, ...(s.sceneWords ? { words: s.sceneWords } : {}), ...(s.footage ? { footage: s.footage } : {}) }}
            chapter={{ index: s.chapterIndex, total, title: s.chapterTitle }} captions={s.captions} {...(keywords ? { keywords } : {})}
            {...(presenter && presenter.sceneScale !== 1 ? { sceneScale: presenter.sceneScale } : {})} />
          <Audio src={staticFile(s.audio)} />
        </Sequence>
      ))}
      {presenter && host ? <BioneeActor cues={host.cues} home={host.home} scale={host.scale} mouth={host.mouth} season={presenter.season} idp="host" /> : null}
    </AbsoluteFill>
  );
};
