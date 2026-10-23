// 예시 E1(스타일 A) "화분은 지름 30센티 이상으로 고르고, 바닥에 물 빠짐 구멍이 있는지 먼저 확인합니다."
// 박자: 0~ 화분 앞모습 + 지름 치수선 ①, 실촬영 카드(실제 화분 모습 — 문장 앞 절이 실물 크기를 말한다) → '바닥' 밑면으로 시점 전환·구멍 주홍 테 ② → '확인' ✓
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { AArrow, ABadge, ADim, AGround, ALabel, ALeader, AMark, APot, APotBottom, FootageInset, FullStage, PA, atFromWords, beat, clamp, potGeom, type FullSceneProps } from './_kit';

const L1 = '지름 30cm↑';
const L2 = '물 빠짐 구멍';

const POT = { x: 700, y: 810, w: 480, h: 390 } as const;
const BOT = { x: 700, y: 540, r: 256 } as const;

export default function Scene({ durationInFrames, words, footage }: FullSceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tHole = atFromWords(words, '바닥', fps, 80);
  const tCheck = atFromWords(words, '확인', fps, 150);
  const G = potGeom(POT.w, POT.h);
  const cy = POT.y - POT.h / 2;
  // 뒤집기 — 앞모습이 세로로 납작해지고(시점이 바뀜) 밑면이 펼쳐진다. 기울여 보여 주지 않는다.
  const squash = interpolate(f, [tHole + 2, tHole + 10], [1, 0], clamp);
  const expand = interpolate(f, [tHole + 10, tHole + 20], [0, 1], clamp);
  return (
    <FullStage frames={durationInFrames}
      overlay={<FootageInset footage={footage} x={1480} y={480} h={440} at={10} until={tHole + 2} />}
      labels={<>
        <ABadge x={POT.x - G.wr / 2 - 60} y={POT.y - POT.h - 60} n={1} at={8} until={tHole} />
        <ADim x1={POT.x - G.wr / 2} y1={POT.y - POT.h - 60} x2={POT.x + G.wr / 2} y2={POT.y - POT.h - 60} text={L1} at={14} until={tHole} ext={16} color={PA.accent} size={50} textOffset={-22} />
        <ABadge x={1090} y={420} n={2} at={tHole + 34} />
        <ALeader pts={[[BOT.x + 10, BOT.y - 8], [1000, 500], [1070, 500]]} at={tHole + 40} />
        <ALabel x={1086} y={516} at={tHole + 44} anchor="start" color={PA.accent} size={50}>{L2}</ALabel>
        <AMark x={1140} y={620} ok at={tCheck} size={48} />
      </>}>
      <g opacity={1 - beat(f, tHole + 4, 10)}><AGround x0={380} x1={1020} y={802} p={beat(f, 0, 14)} /></g>
      {squash > 0 ? (
        <g transform={`translate(0 ${cy}) scale(1 ${squash}) translate(0 ${-cy})`}>
          <APot x={POT.x} y={POT.y} w={POT.w} h={POT.h} at={0} empty />
        </g>
      ) : null}
      {expand > 0 ? (
        <g transform={`translate(0 ${BOT.y}) scale(1 ${expand}) translate(0 ${-BOT.y})`}>
          <APotBottom x={BOT.x} y={BOT.y} r={BOT.r} holes={5} holeHi={beat(f, tHole + 24, 30, 'inOut')} p={beat(f, tHole + 8, 14)} />
        </g>
      ) : null}
      <AArrow d={`M ${POT.x + 270} ${cy - 120} C ${POT.x + 360} ${cy - 40} ${POT.x + 360} ${cy + 60} ${POT.x + 270} ${cy + 130}`} head={[POT.x + 270, cy + 130, 135]} at={tHole - 2} until={tHole + 26} color={PA.ink} w={2.4} />
    </FullStage>
  );
}
