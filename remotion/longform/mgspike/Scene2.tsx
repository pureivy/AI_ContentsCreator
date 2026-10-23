// S2 "화분은 지름 30센티 이상으로 고르고, 바닥에 물 빠짐 구멍이 있는지 먼저 확인합니다." (180프레임)
// 박자: 0~80 큰 화분·작은 화분 비교, 줄자로 지름 재기 → 80~110 화분을 뒤집어(앞 → 밑면 전환) → 110~180 구멍이 빛나고 지시선·확인.
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { SceneStage, type SceneProps } from '../scenes/SceneStage';
import { ACCENT, Badge, Draw, GROUND_Y, Ground, LEAF, Planter, Ruler, SafeLabel, atFromWords, beat, clamp } from '../illus/Kit2';

const L_DIAM = '지름 30cm↑';
const L_HOLE = '물 빠짐 구멍';

const POT = { x: 420, y: 540, w: 300, h: 230 } as const;

export default function Scene({ durationInFrames, words }: SceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tHole = atFromWords(words, '구멍', fps, 84);
  const smallOut = 1 - beat(f, 62, 18);
  // 뒤집기 — 앞모습이 세로로 납작해졌다가 밑면이 펼쳐진다(가짜 기울기 대신 시점 전환).
  const squash = interpolate(f, [tHole, tHole + 12], [1, 0], clamp);
  const expand = interpolate(f, [tHole + 12, tHole + 24], [0, 1], clamp);
  const cy = POT.y - POT.h / 2;
  const glow = beat(f, tHole + 32, 12);
  const measureO = 1 - beat(f, tHole - 6, 10);
  return (
    <SceneStage frames={durationInFrames} backdrop="sky">
      <Ground y={GROUND_Y - 20} seed="s2" />
      {/* 작은 화분 — 지름이 모자라 ✗ 후 사라진다 */}
      <Planter x={800} y={530} w={140} h={110} material="terracotta" o={smallOut} />
      <g opacity={smallOut}><Badge x={800} y={330} at={48} ok={false} /></g>
      {squash > 0 ? (
        <g transform={`translate(0 ${cy}) scale(1 ${squash}) translate(0 ${-cy})`}>
          <Planter x={POT.x} y={POT.y} w={POT.w} h={POT.h} material="terracotta" at={0} id="s02-front" />
        </g>
      ) : null}
      {expand > 0 ? (
        <g transform={`translate(0 ${POT.y - POT.w * 0.535}) scale(1 ${expand}) translate(0 ${-(POT.y - POT.w * 0.535)})`}>
          <Planter x={POT.x} y={POT.y} w={POT.w} h={POT.h} material="terracotta" view="bottom" drainHoles={5} holeGlow={glow} id="s02-bottom" />
        </g>
      ) : null}
      {/* 지름 재기 — 테두리 위에 줄자를 편다 */}
      <g opacity={measureO}>
        <Ruler x={POT.x - POT.w * 0.535} y={POT.y - POT.h - 44} length={POT.w * 1.07} units={30} at={12} />
        <SafeLabel x={POT.x} y={190} at={34} color={ACCENT} size={40}>{L_DIAM}</SafeLabel>
        <Badge x={650} y={176} at={44} ok />
      </g>
      {/* 구멍 지시선 */}
      {f >= tHole + 34 ? <circle cx={POT.x} cy={POT.y - POT.w * 0.535} r={8} fill={LEAF} /> : null}
      {f >= tHole + 34 ? <Draw d={`M ${POT.x + 8} ${POT.y - POT.w * 0.535 - 6} L 700 300`} at={tHole + 34} color={LEAF} width={4} /> : null}
      <SafeLabel x={790} y={292} at={tHole + 44} color={LEAF} size={38}>{L_HOLE}</SafeLabel>
      <Badge x={790} y={200} at={tHole + 60} ok />
    </SceneStage>
  );
}
