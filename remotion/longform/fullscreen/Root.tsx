// 전체 화면 롱폼 진입점 공장(2026-10-23) — 편마다 생성한 진입점(remotion-entry-full)이 장면 등록표를 넣어 부른다.
// 'LongFormFull' = 본 합성, 'Scene' = 장면 하나(1920×1080, 장 이름·자막 띠까지 — 미리보기·대조표·자막 띠 침범 검사).
// 'Scene' 은 ErrorBoundary 로 감싸지 않는다 — 던진 장면이 renderStill 실패로 드러나야 한다(registry.tsx 와 같은 규약).
import React from 'react';
import { AbsoluteFill, Composition } from 'remotion';
import { FullFrame, FullSceneRegistryContext, LongFormFull, type FullSceneRegistry } from './LongFormFull';
import { StageModeContext, type Footage } from './stage';
import type { Word } from '../illus/sceneUtil';
import type { LongFormFullProps } from '../../../src/longform/fullProps';

const empty: LongFormFullProps = { title: '', style: 'A', totalFrames: 1, chapters: [], segments: [] };

export type FullSceneOneProps = {
  sceneKey: string; durationInFrames: number; style: 'A' | 'B'; words?: Word[]; footage?: Footage;
  chapter?: { index: number; total: number; title: string }; captions?: Array<{ text: string; startFrame: number; endFrame: number }>;
  /** 검사 모드 — 단색 바탕에 장면 그림만(자막 띠·장 이름 자리 침범 재기). */
  probe?: boolean;
};

export function makeSceneFullComposition(scenes: FullSceneRegistry): React.FC {
  const One: React.FC<FullSceneOneProps> = ({ sceneKey, durationInFrames, style, words, footage, chapter, captions, probe }) => {
    const C = scenes[sceneKey];
    if (!C) throw new Error(`등록되지 않은 장면: ${sceneKey}`);
    const sceneProps = { durationInFrames, ...(words ? { words } : {}), ...(footage ? { footage } : {}) };
    if (probe) return <StageModeContext.Provider value={{ probe: true }}><AbsoluteFill><C {...sceneProps} /></AbsoluteFill></StageModeContext.Provider>;
    return <FullFrame style={style} scene={C} guard={false} sceneProps={sceneProps} chapter={chapter ?? { index: 0, total: 1, title: '' }} {...(captions ? { captions } : {})} />;
  };
  const def: FullSceneOneProps = { sceneKey: '', durationInFrames: 150, style: 'A' };
  return () => (
    <Composition id="Scene" component={One} defaultProps={def} fps={30} width={1920} height={1080} durationInFrames={150}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.durationInFrames) })} />
  );
}

export function makeLongFormFullRoot(scenes: FullSceneRegistry): React.FC {
  const WithScenes: React.FC<LongFormFullProps> = (p) => (
    <FullSceneRegistryContext.Provider value={scenes}><LongFormFull {...p} /></FullSceneRegistryContext.Provider>
  );
  const SceneOne = makeSceneFullComposition(scenes);
  return () => (
    <>
      <Composition id="LongFormFull" component={WithScenes} defaultProps={empty} fps={30} width={1920} height={1080} durationInFrames={1}
        calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.totalFrames) })} />
      <SceneOne />
    </>
  );
}
