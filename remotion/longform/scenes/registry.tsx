// 문장 그림 장면 등록표(2026-10-22) — 편마다 만든 진입점(data/longform/<편>/remotion-entry)이 장면 컴포넌트 표를 이 컨텍스트로 넣는다.
// 시범 진입점(remotion/longform/index.ts)은 표를 넣지 않는다 → 기본값 {} → LongForm 은 scene 키를 무시하고 mg·카드를 그린다.
// 웹팩은 동적 경로를 못 따라가므로 표는 생성된 registry.ts 의 정적 import 로만 채운다.
import React, { createContext } from 'react';
import { Composition } from 'remotion';
import type { SceneProps } from './SceneStage';
import type { Word } from '../illus/sceneUtil';

export type SceneRegistry = Record<string, React.ComponentType<SceneProps>>;
export const SceneRegistryContext = createContext<SceneRegistry>({});

/** 장면 한 개 컴포지션 props — 미리보기·대조표 스틸용(1100×680, 도해 칸과 같은 크기). */
export type SceneOneProps = { sceneKey: string; durationInFrames: number; words?: Word[] };

/**
 * 장면 하나만 띄우는 컴포지션 'Scene'. ErrorBoundary 로 감싸지 않는다 — 미리보기·검사에서 던진 오류가 renderStill 실패로
 * 드러나야 에이전트가 고치고 파이프라인이 그 장면을 뺀다(본편 LongForm 은 감싼다).
 */
export function makeSceneComposition(scenes: SceneRegistry): React.FC {
  const One: React.FC<SceneOneProps> = ({ sceneKey, durationInFrames, words }) => {
    const C = scenes[sceneKey];
    if (!C) throw new Error(`등록되지 않은 장면: ${sceneKey}`);
    return <C durationInFrames={durationInFrames} {...(words ? { words } : {})} />;
  };
  const empty: SceneOneProps = { sceneKey: '', durationInFrames: 150 };
  return () => (
    <Composition id="Scene" component={One} defaultProps={empty} fps={30} width={1100} height={680} durationInFrames={150}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.durationInFrames) })} />
  );
}
