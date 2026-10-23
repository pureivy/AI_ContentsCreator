import React from 'react';
import { Composition } from 'remotion';
import { LongForm } from './LongForm';
import { SceneRegistryContext, makeSceneComposition, type SceneRegistry } from './scenes/registry';
import type { LongFormProps } from './types';

const empty: LongFormProps = { title: '', lookSeed: 'x', chapterMotions: [], totalFrames: 1, chapters: [], segments: [] };

export const LongFormRoot: React.FC = () => (
  <Composition
    id="LongForm"
    component={LongForm}
    defaultProps={empty}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={1}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.totalFrames) })}
  />
);

/**
 * 편마다 만든 진입점용(2026-10-22) — 장면 등록표를 컨텍스트로 넣은 LongForm + 장면 하나 컴포지션('Scene', 대조표·검사 스틸).
 * 컨텍스트는 Composition 바깥이 아니라 컴포넌트를 감싸서 넣는다(렌더 트리가 Root 와 따로 돈다).
 */
export function makeLongFormRoot(scenes: SceneRegistry): React.FC {
  const WithScenes: React.FC<LongFormProps> = (p) => (
    <SceneRegistryContext.Provider value={scenes}><LongForm {...p} /></SceneRegistryContext.Provider>
  );
  const SceneOne = makeSceneComposition(scenes);
  return () => (
    <>
      <Composition
        id="LongForm"
        component={WithScenes}
        defaultProps={empty}
        fps={30}
        width={1920}
        height={1080}
        durationInFrames={1}
        calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.totalFrames) })}
      />
      <SceneOne />
    </>
  );
}
