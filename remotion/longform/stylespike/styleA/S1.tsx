// A-S1 "블루베리는 산성 흙을 좋아해서, 피트모스를 절반 넘게 섞어 pH 4.5에서 5.5로 맞춥니다."
// 박자: 0~48 블루베리 화분·산성 흙 ① → 48~118 피트모스 붓기·절반선 ② → 118~180 pH 눈금 ③
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FullStage, atFromWords, beat, clamp, type Word } from '../shared';
import { sectionGeom } from '../geom';
import { AArrow, ABadge, ADefs, ADim, AFall, AGround, ALabel, ALeader, APhScale, APot, APotSection, ASack, AShrub, PA, THEME_A } from './kit';

const L1 = '산성 흙';
const L2 = '피트모스 절반↑';
const L3 = 'pH 4.5~5.5';

const SEC = { x: 980, y: 820, w: 360, h: 330 } as const;
const LAYERS = [{ kind: 'peat' as const, ratio: 0.56 }, { kind: 'soil' as const, ratio: 0.38 }];

export default function Scene({ durationInFrames, words }: { durationInFrames: number; words?: Word[] }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tPeat = atFromWords(words, '피트모스', fps, 48);
  const tPh = atFromWords(words, 'pH', fps, 118);
  const G = sectionGeom(SEC.x, SEC.y, SEC.w, SEC.h);
  const pourA = tPeat + 16, pourB = tPeat + 48;
  const fill = interpolate(f, [pourA, pourB, pourB + 10, pourB + 22], [0, 0.56 / 0.94, 0.56 / 0.94, 1], clamp);
  const mixP = beat(f, pourB + 22, 14, 'inOut');
  const sackIn = beat(f, tPeat, 14), sackOut = beat(f, pourB + 2, 12);
  const tilt = interpolate(beat(f, tPeat + 4, 14, 'inOut'), [0, 1], [-15, -118]);
  const surf = G.levelY(0.94 * fill);
  const secDim = 1 - 0.1 * beat(f, tPh + 4, 14);
  return (
    <FullStage frames={durationInFrames} theme={THEME_A} defs={<ADefs />} svgFilter="url(#a-tremble)" chapter={{ index: 2, total: 6, title: '블루베리 화분 심기' }}
      caption={[{ text: '블루베리는 산성 흙을 좋아해서,', from: 0 }, { text: '피트모스를 절반 넘게 섞어', from: tPeat }, { text: 'pH 4.5에서 5.5로 맞춥니다.', from: tPh }]}
      labels={<>
        <ABadge x={180} y={570} n={1} at={10} until={tPeat + 4} />
        <ALeader pts={[[370, 598], [300, 640], [262, 640]]} at={20} until={tPeat + 2} color={PA.accent} />
        <ALabel x={250} y={656} at={22} until={tPeat + 2} anchor="end" color={PA.accent}>{L1}</ALabel>
        <ABadge x={760} y={420} n={2} at={tPeat + 2} until={tPh} />
        <ADim x1={1200} y1={G.innerBottom} x2={1200} y2={G.levelY(0.56)} at={pourB - 6} until={tPh} ext={14} color={PA.accent} />
        <ALeader pts={[[G.innerX(G.levelY(0.56), 1) - 6, G.levelY(0.56)], [1200, G.levelY(0.56)]]} at={pourB - 6} until={tPh} color={PA.accent} />
        <ALabel x={1228} y={(G.innerBottom + G.levelY(0.56)) / 2 + 16} at={pourB} until={tPh} anchor="start" color={PA.accent}>{L2}</ALabel>
        <ABadge x={1360} y={300} n={3} at={tPh + 2} />
        <ALabel x={1475} y={398} at={tPh + 24} color={PA.accent} size={50}>{L3}</ALabel>
      </>}>
      <AGround x0={240} x1={1240} y={822} p={beat(f, 0, 16)} />
      {/* ① 주인공 — 블루베리 화분(끝까지 남는다). 산성 흙에 주홍 테. */}
      <APot x={460} y={820} w={290} h={240} at={0} soilHi={beat(f, 18, 14) * (1 - beat(f, tPeat + 4, 10))} />
      <AShrub x={460} y={594} h={490} seed="a1bb" at={2} grow={40} stems={5} />

      {/* ② 섞는 화분 단면 — 피트모스가 절반선을 넘고, 흙이 얹힌 뒤 한 결로 */}
      <g opacity={secDim}>
        <APotSection x={SEC.x} y={SEC.y} w={SEC.w} h={SEC.h} layers={LAYERS} fill={fill} mix={mixP} at={tPeat - 2} seed="a1sec" />
      </g>
      <AFall from={[1000, 384]} toY={surf} at={pourA} until={pourB} />
      <ASack x={1092} y={340} tilt={tilt} o={sackIn * (1 - sackOut)} />

      {/* ③ pH — 섞은 흙에서 눈금 막대로, 4.5~5.5 칸 */}
      <AArrow d={`M ${SEC.x + 150} 520 C 1230 470 1290 430 1330 420`} head={[1330, 420, -20]} at={tPh} color={PA.ink} w={2.2} />
      <APhScale x={1370} y={430} len={420} min={4} max={8} lo={4.5} hi={5.5} at={tPh + 4} />
    </FullStage>
  );
}
