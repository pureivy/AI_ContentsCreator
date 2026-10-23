// B-S1 "블루베리는 산성 흙을 좋아해서, 피트모스를 절반 넘게 섞어 pH 4.5에서 5.5로 맞춥니다."
// 박자: 0~48 블루베리 화분, 흙에 포인트 색 → 48~118 피트모스(포인트 색) 붓기·절반 치수 → 118~180 pH 자, 4.5~5.5 칸에 포인트 색
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FullStage, atFromWords, beat, clamp, type Word } from '../shared';
import { sectionGeom } from '../geom';
import { BArrow, BDefs, BDim, BFall, BGround, BLabel, BLeader, BPhScale, BPot, BPotSection, BSack, BShrub, THEME_B } from './kit';

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
  const half = G.levelY(0.56);
  return (
    <FullStage frames={durationInFrames} theme={THEME_B} defs={<BDefs />} svgFilter="url(#b-graphite)" chapter={{ index: 2, total: 6, title: '블루베리 화분 심기' }}
      caption={[{ text: '블루베리는 산성 흙을 좋아해서,', from: 0 }, { text: '피트모스를 절반 넘게 섞어', from: tPeat }, { text: 'pH 4.5에서 5.5로 맞춥니다.', from: tPh }]}
      labels={<>
        <BLeader pts={[[372, 600], [300, 644], [262, 644]]} at={20} until={tPeat + 2} hi />
        <BLabel x={250} y={660} at={22} until={tPeat + 2} anchor="end" hi>{L1}</BLabel>
        <BDim x1={1200} y1={G.innerBottom} x2={1200} y2={half} at={pourB - 6} until={tPh} hi />
        <BLeader pts={[[G.innerX(half, 1) - 6, half], [1200, half]]} at={pourB - 6} until={tPh} hi />
        <BLabel x={1228} y={(G.innerBottom + half) / 2 + 16} at={pourB} until={tPh} anchor="start" hi>{L2}</BLabel>
        <BLabel x={1485} y={396} at={tPh + 24} hi size={54} underline={220}>{L3}</BLabel>
      </>}>
      <BGround x0={240} x1={1240} y={822} p={beat(f, 0, 20)} />
      <BPot x={460} y={820} w={290} h={240} at={0} soilHi={beat(f, 18, 12) * (1 - beat(f, tPeat + 2, 12))} />
      <BShrub x={460} y={594} h={490} seed="b1bb" at={2} grow={44} stems={5} />

      <g opacity={1 - 0.1 * beat(f, tPh + 4, 14)}>
        <BPotSection x={SEC.x} y={SEC.y} w={SEC.w} h={SEC.h} layers={LAYERS} fill={fill} mix={mixP} at={tPeat - 2} seed="b1sec" hiKind="peat" hi={1 - beat(f, tPh - 4, 12)} />
      </g>
      <BFall from={[1000, 384]} toY={G.levelY(0.94 * fill)} at={pourA} until={pourB} />
      <BSack x={1092} y={340} tilt={tilt} o={sackIn * (1 - sackOut)} />

      <BArrow d={`M ${SEC.x + 150} 520 C 1230 470 1290 430 1340 424`} head={[1340, 424, -10]} at={tPh} />
      <BPhScale x={1380} y={430} len={420} min={4} max={8} lo={4.5} hi={5.5} at={tPh + 4} />
    </FullStage>
  );
}
