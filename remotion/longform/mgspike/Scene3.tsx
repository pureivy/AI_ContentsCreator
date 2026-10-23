// S3 "심을 때는 뿌리 덩이를 살짝 풀어 주고, 원래 심겨 있던 깊이보다 깊게 묻지 않습니다." (180프레임)
// 박자: 0~85 장갑 낀 두 손이 감긴 뿌리를 푼다 → 85~120 화분 단면에 앉힌다·원래 깊이 선 → 120~180 흙을 채운다(넘치면 ✗, 선까지 ✓).
import React from 'react';
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { SceneStage, type SceneProps } from '../scenes/SceneStage';
import { ACCENT, Badge, GROUND_Y, Ground, Hand, PotSection, RootBall, SafeLabel, Shrub, atFromWords, beat, beatInOut, clamp, potSection } from '../illus/Kit2';

const L_LOOSE = '뿌리 살짝 풀기';
const L_DEPTH = '원래 깊이';

const SEC = { x: 500, y: 566, w: 440, h: 280 } as const;
const BALL = { w: 190, h: 160 } as const;
// 바닥 흙(0.2) 위에 덩이를 앉히면 뿌리목 = 안쪽 높이 0.835. 선까지 채우는 흙 0.635, 넘치게 덮는 흙 0.15.
const LAYERS = [{ material: 'soil' as const, ratio: 0.2 }, { material: 'soil' as const, ratio: 0.635 }, { material: 'compost' as const, ratio: 0.15 }];
const TOTAL = 0.985;

export default function Scene({ durationInFrames, words }: SceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tDepth = atFromWords(words, '깊이', fps, 86);
  const G = potSection(SEC.x, SEC.y, SEC.w, SEC.h, 'plastic');
  const crownIn = G.levelY(0.2) - BALL.h - 6; // 덩이 밑면이 바닥 흙에 닿을 때 뿌리목 y
  const loosen = interpolate(f, [28, 78], [0, 1], clamp);
  const hands = beatInOut(f, 8, 76);
  const pull = interpolate(f, [24, 50, 76], [0, 1, 0.6], clamp) * 22 + Math.sin(f / 3) * 3 * (f > 24 && f < 76 ? 1 : 0);
  const sink = interpolate(f, [tDepth + 6, tDepth + 30], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const crownY = 250 + (crownIn - 250) * sink;
  // 채우기: 바닥 흙만 → 뿌리목까지 → 넘치게(✗) → 다시 뿌리목(✓)
  const fill = interpolate(f, [120, 140, 150, 160, 168], [0.2, 0.835, 1, 1, 0.835].map((v) => v / TOTAL), clamp);
  const secO = beat(f, tDepth, 14);
  const ballX = SEC.x;
  return (
    <SceneStage frames={durationInFrames} backdrop="sky">
      <Ground y={GROUND_Y + 6} seed="s3" />
      <PotSection id="s03-pot" x={SEC.x} y={SEC.y} w={SEC.w} h={SEC.h} layers={LAYERS} fill={fill} o={secO}
        level={f >= tDepth + 26 ? { ratio: 0.835, label: L_DEPTH, at: tDepth + 28 } : undefined} />
      {/* 뿌리 덩이 + 포기 — 화분 안으로 내려앉는다(단면 위에 그린다) */}
      <RootBall id="s03-ball" x={ballX} y={crownY} w={BALL.w} h={BALL.h} loosen={loosen} at={0} shadow={sink <= 0} />
      <Shrub x={ballX} y={crownY} h={190} stems={3} at={4} seed="s03p" />
      {/* 장갑 낀 두 손 — 덩이 옆을 잡고 살살 벌린다 */}
      <Hand x={ballX - BALL.w / 2 - 92 - pull} y={crownY + 64} pose="hold" scale={1.5} o={hands} />
      <Hand x={ballX + BALL.w / 2 + 92 + pull} y={crownY + 64} angle={180} side="left" pose="hold" scale={1.5} o={hands} />
      <g opacity={1 - beat(f, 100, 12)}><SafeLabel x={210} y={110} at={20} color={ACCENT} size={38}>{L_LOOSE}</SafeLabel></g>
      <g opacity={1 - beat(f, 158, 6)}><Badge x={210} y={200} at={144} ok={false} /></g>
      <Badge x={210} y={200} at={166} ok />
    </SceneStage>
  );
}
