// B-S2 "화분은 지름 30센티 이상으로 고르고, 바닥에 물 빠짐 구멍이 있는지 먼저 확인합니다."
// 박자: 0~80 화분 앞모습 + 지름 치수(포인트 색), 실촬영 카드 → 80~180 밑면으로 시점 전환·구멍(포인트 색)·✓
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FootageInset, FullStage, atFromWords, beat, clamp, type Word } from '../shared';
import { potGeom } from '../geom';
import { BArrow, BDefs, BDim, BGround, BLabel, BLeader, BMark, BPot, BPotBottom, THEME_B } from './kit';

const L1 = '지름 30cm↑';
const L2 = '물 빠짐 구멍';

const POT = { x: 700, y: 810, w: 480, h: 390 } as const;
const BOT = { x: 700, y: 540, r: 256 } as const;

export default function Scene({ durationInFrames, words }: { durationInFrames: number; words?: Word[] }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tHole = atFromWords(words, '바닥', fps, 80);
  const tCheck = atFromWords(words, '확인', fps, 150);
  const G = potGeom(POT.w, POT.h);
  const cy = POT.y - POT.h / 2;
  const squash = interpolate(f, [tHole + 2, tHole + 10], [1, 0], clamp);
  const expand = interpolate(f, [tHole + 10, tHole + 20], [0, 1], clamp);
  const dimY = POT.y - POT.h - 60;
  return (
    <FullStage frames={durationInFrames} theme={THEME_B} defs={<BDefs />} svgFilter="url(#b-graphite)" chapter={{ index: 2, total: 6, title: '블루베리 화분 심기' }}
      caption={[{ text: '화분은 지름 30센티 이상으로 고르고,', from: 0 }, { text: '바닥에 물 빠짐 구멍이 있는지 먼저 확인합니다.', from: tHole }]}
      overlay={<FootageInset src="blueberry_pot.mp4" x={1480} y={480} h={420} at={10} until={tHole + 2} startFrom={9} frame="#fbfaf6" />}
      labels={<>
        <BDim x1={POT.x - G.wr / 2} y1={dimY} x2={POT.x + G.wr / 2} y2={dimY} text={L1} at={14} until={tHole} hi size={54} textOffset={-24} />
        <BLeader pts={[[BOT.x + 10, BOT.y - 8], [1000, 500], [1070, 500]]} at={tHole + 40} hi />
        <BLabel x={1086} y={516} at={tHole + 44} anchor="start" hi size={54}>{L2}</BLabel>
        <BMark x={1140} y={620} ok at={tCheck} size={50} />
      </>}>
      <g opacity={1 - beat(f, tHole + 4, 10)}><BGround x0={380} x1={1020} y={812} p={beat(f, 0, 16)} /></g>
      {squash > 0 ? (
        <g transform={`translate(0 ${cy}) scale(1 ${squash}) translate(0 ${-cy})`}>
          <BPot x={POT.x} y={POT.y} w={POT.w} h={POT.h} at={0} empty />
        </g>
      ) : null}
      {expand > 0 ? (
        <g transform={`translate(0 ${BOT.y}) scale(1 ${expand}) translate(0 ${-BOT.y})`}>
          <BPotBottom x={BOT.x} y={BOT.y} r={BOT.r} holeHi={beat(f, tHole + 24, 30, 'inOut')} p={beat(f, tHole + 8, 14)} />
        </g>
      ) : null}
      <BArrow d={`M ${POT.x + 270} ${cy - 120} C ${POT.x + 360} ${cy - 40} ${POT.x + 360} ${cy + 60} ${POT.x + 270} ${cy + 130}`} head={[POT.x + 270, cy + 130, 135]} at={tHole - 2} until={tHole + 26} />
    </FullStage>
  );
}
