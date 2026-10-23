// S1 "블루베리는 산성 흙을 좋아해서, 피트모스를 절반 넘게 섞어 pH 4.5에서 5.5로 맞춥니다." (180프레임)
// 박자: 0~50 블루베리 화분·산성 흙 → 50~125 피트모스 붓기·절반선·섞기 → 125~180 pH 측정·눈금 띠.
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { SceneStage, type SceneProps } from '../scenes/SceneStage';
import { ACCENT, GROUND_Y, Gauge, Ground, LEAF, Planter, PotSection, RangeBar, SafeLabel, Sack, Shrub, atFromWords, beat, clamp, potSection } from '../illus/Kit2';

const L_ACID = '산성 흙';
const L_PEAT = '피트모스 절반↑';
const L_PH = 'pH 4.5~5.5';

const SEC = { x: 540, y: 560, w: 320, h: 250 } as const;
const LAYERS = [{ material: 'peat' as const, ratio: 0.55 }, { material: 'soil' as const, ratio: 0.3 }];

export default function Scene({ durationInFrames, words }: SceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 말에 맞춘 박자 — 단어 시각이 없으면 기본 프레임.
  const tPeat = atFromWords(words, '피트모스', fps, 46);
  const tPh = atFromWords(words, 'pH', fps, 124);
  const G = potSection(SEC.x, SEC.y, SEC.w, SEC.h, 'plastic');
  const pourA = tPeat + 16, pourB = tPeat + 58;
  const fill = interpolate(f, [pourA, pourB, pourB + 16], [0, 0.55 / 0.85, 1], clamp);
  const mix = beat(f, pourB + 16, 18, 'inOut');
  const bagIn = beat(f, tPeat, 14);
  const bagOut = beat(f, pourB + 4, 14);
  const tilt = interpolate(beat(f, tPeat + 6, 12, 'inOut'), [0, 1], [-20, -120]);
  const surf = G.levelY(0.85 * fill);
  const dip = interpolate(beat(f, tPh + 4, 16), [0, 1], [-70, 0]);
  return (
    <SceneStage frames={durationInFrames} backdrop="sky">
      <Ground y={GROUND_Y} seed="s1" />
      {/* 블루베리 화분 — 산성 흙 */}
      <Planter x={190} y={470} w={170} h={140} material="plastic" at={0} />
      <Shrub x={190} y={334} h={200} stems={3} berries={{}} at={4} seed="s01bb" />
      <SafeLabel x={190} y={530} at={22} color={ACCENT} size={34}>{L_ACID}</SafeLabel>
      {/* 섞는 화분 단면 — 피트모스가 절반선을 넘고, 흙이 얹힌 뒤 한 결로 섞인다 */}
      <PotSection id="s01-mix" x={SEC.x} y={SEC.y} w={SEC.w} h={SEC.h} layers={LAYERS} fill={fill} mix={mix} at={tPeat - 2}
        level={{ ratio: 0.5, label: L_PEAT, at: pourA + 10 }} />
      <Sack x={650 + bagOut * 140} y={180 - bagOut * 60} tilt={tilt} o={bagIn * (1 - bagOut)} pour={{ at: pourA, until: pourB, toY: surf, kind: 'fiber', color: '#8c5a3c' }} />
      {/* pH 측정 — 탐침이 흙에 꽂히고 바늘이 5 에 선다 */}
      <g transform={`translate(0 ${dip})`}>
        <Gauge x={620} y={150} kind="ph" value={5} from={7} at={tPh + 4} r={50} probe={150} />
      </g>
      <RangeBar x={890} y={130} length={250} min={4} max={8} lo={4.5} hi={5.5} orient="v" kind="ph" at={tPh} thickness={22} />
      <SafeLabel x={720} y={78} at={tPh + 26} color={LEAF} size={38}>{L_PH}</SafeLabel>
    </SceneStage>
  );
}
