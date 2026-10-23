// 비온이 배우(2026-10-23) — 신호 목록 + 입 열림 배열을 받아 현재 프레임 자세를 계산해 투명 SVG 층(1920×1080)에 그린다.
// 본편에 넣을 때: LongFormFull 맨 위 층에 <BioneeActor cues={...} home={...} mouth={...} /> 하나(전역 프레임 기준).
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { Bionee } from './Bionee';
import { poseAt, type ActorSpec } from './timeline';
import type { Season } from './pose';

export type BioneeActorProps = Omit<ActorSpec, 'seed'> & {
  season?: Season;
  idp?: string;
  /** 이 배우 시간표 0 = 합성의 몇 프레임(기본 0) */
  from?: number;
  width?: number;
  height?: number;
  texture?: boolean;
};

export const BioneeActor: React.FC<BioneeActorProps> = ({ season = 'summer', idp = 'bn', from = 0, width = 1920, height = 1080, texture = true, ...spec }) => {
  const f = useCurrentFrame() - from;
  const pose = poseAt(Math.max(0, f), { ...spec, seed: idp });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0, width, height, overflow: 'hidden', pointerEvents: 'none' }}>
      <Bionee pose={pose} season={season} idp={idp} frame={f} texture={texture} />
    </svg>
  );
};
