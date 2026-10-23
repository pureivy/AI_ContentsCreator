// 갤러리 — 실촬영 대조용 우리 그림(2026-10-23 B3). 칸 = 가로 440 × 세로 740(y 120~860), x 60·510·960·1410.
// CMP: 가지에 달린 감 · 잎 · 어린 나무 수형 · 어린 나무 껍질.  CMP2: 성목 껍질(거북등) · 접목묘(겨울, 대목 움) · 맨뿌리 접목묘 · 감 세 품종.
import React from 'react';
import type { FullSceneProps } from '../stage';
import { FullStage, GroundLine, LeafDetail, PB, PersimmonFruit, PLine, ShadeLayers, TONE, Tree } from '../styleB/kit';
import { taperSmooth } from '../geomTree';
import { cylShade } from '../shade';
import type { P } from '../geom';
import type { SpeciesProfile } from '../species/schema';

const CX = [60, 510, 960, 1410];
const clips = <>{CX.map((x, i) => <clipPath key={i} id={`b-cmp-${i}`}><rect x={x} y={120} width={440} height={740} /></clipPath>)}</>;

/** 가지 토막 — 점들 + 굵기(밑 → 끝), 연필 명암. */
const Twig: React.FC<{ pts: P[]; w0: number; w1: number; seed: string }> = ({ pts, w0, w1, seed }) => {
  const w = pts.map((_, i) => w0 + (w1 - w0) * (i / (pts.length - 1)));
  const d = taperSmooth(pts, w);
  return (
    <g>
      <path d={d} fill={PB.paper} />
      <ShadeLayers s={cylShade(pts, w, seed, 3.8, { core: w0 > 12 })} />
      <PLine d={d} w={TONE.B2.w * 0.9} seed={seed} />
    </g>
  );
};

/** 칸 0 — 가지에 달린 감: 아래로 휜 열매 가지, 잎겨드랑이마다 감이 꽃받침째 바짝 붙어 매달림(실촬영 media_566818441e 7.6초). */
const FruitOnTwig: React.FC = () => {
  const twig: P[] = [[-10, 150], [110, 190], [220, 250], [300, 330], [350, 430], [370, 560]];
  const at = (i: number, k: number): P => [twig[i]![0] + (twig[i + 1]![0] - twig[i]![0]) * k, twig[i]![1] + (twig[i + 1]![1] - twig[i]![1]) * k];
  return (
    <g transform="translate(60 120)">
      <LeafDetail x={90} y={185} angle={-120} len={170} species="persimmon" seed="c0l1" />
      <LeafDetail x={235} y={262} angle={-30} len={200} species="persimmon" seed="c0l2" />
      <Twig pts={twig} w0={16} w1={7} seed="c0t" />
      <PersimmonFruit onTwig={at(1, 0.6)} r={70} tilt={10} seed="c0f1" detail />
      <PersimmonFruit onTwig={at(3, 0.45)} r={76} tilt={-14} seed="c0f2" detail />
      <LeafDetail x={318} y={360} angle={165} len={190} species="persimmon" seed="c0l3" />
      <LeafDetail x={362} y={500} angle={20} len={150} species="persimmon" seed="c0l4" />
      <PersimmonFruit onTwig={at(4, 0.85)} r={64} tilt={-30} seed="c0f3" detail />
    </g>
  );
};

export const CompareB: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} defs={clips}>
    <g clipPath="url(#b-cmp-0)"><FruitOnTwig /></g>
    {/* 잎 — 넓은 타원·짧게 뾰족한 끝·전연·우상맥 */}
    <g clipPath="url(#b-cmp-1)"><LeafDetail x={730} y={830} angle={-84} len={620} species="persimmon" seed="cmp-l" /></g>
    {/* 수형 — 어린 감나무(가는 외줄기 몸통 + 곧추선 원가지 + 큰 낱잎 + 감) */}
    <g clipPath="url(#b-cmp-2)">
      <GroundLine x0={970} x1={1400} y={830} />
      <Tree x={1180} y={830} h={680} age="young" seed="cmp-habit" season="summer" fruit />
    </g>
    {/* 어린 나무 껍질 — 매끈한 회갈색 + 껍질눈(확대) */}
    <g clipPath="url(#b-cmp-3)">
      <GroundLine x0={1420} x1={1850} y={830} />
      <Tree x={1630} y={830} h={3400} age="young" seed="cmp-yb" season="winter" />
    </g>
  </FullStage>
);

export const CompareB2: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} defs={clips}>
    {/* 성목 껍질 — 거북등(작은 네모 조각) */}
    <g clipPath="url(#b-cmp-0)">
      <GroundLine x0={60} x1={500} y={830} />
      <Tree x={280} y={830} h={2700} age="mature" seed="cmp-old" season="winter" />
    </g>
    {/* 접목묘(1~2년 회초리) 겨울 — 접붙인 자리 혹·곁순·겨울눈·대목 움 */}
    <g clipPath="url(#b-cmp-1)">
      <GroundLine x0={520} x1={940} y={830} />
      <Tree x={730} y={830} h={660} age="sapling" seed="cmp-sap" season="winter" suckers />
    </g>
    {/* 맨뿌리 접목묘 */}
    <g clipPath="url(#b-cmp-2)">
      <Tree x={1180} y={600} h={460} age="sapling" seed="cmp-sap" season="winter" roots="bare" rootW={230} rootDepth={220} />
    </g>
    {/* 감 세 품종 — 단감(납작)·둥근 감·대봉(뾰족) */}
    <g clipPath="url(#b-cmp-3)">
      <Twig pts={[[1420, 200], [1630, 215], [1850, 236]]} w0={12} w1={8} seed="c3t1" />
      <PersimmonFruit onTwig={[1630, 215]} r={92} kind="flat" seed="c3f1" detail />
      <Twig pts={[[1420, 470], [1630, 482], [1850, 500]]} w0={12} w1={8} seed="c3t2" />
      <PersimmonFruit onTwig={[1550, 476]} r={70} kind="round" seed="c3f2" detail />
      <PersimmonFruit onTwig={[1745, 490]} r={66} kind="long" seed="c3f3" detail />
    </g>
  </FullStage>
);

/**
 * (B6) 음나무 대조 — 손바닥 큰 잎(갈래 7)·긴 잎자루·가지 끝에 모여 남·굵고 성긴 가지·가시. 프리셋은 편(2026-10-23-plant) 것을 그대로 옮겨 둔다
 * (키트 species/ 에 넣으면 내장 프리셋이 되므로 갤러리 안에만).
 * CMPK: 어린 나무 여름 · 성목 수관 가장자리 · 잎 한 장 · 어린 나무 겨울.  CMPK2: 접목묘 여름 · 접목묘 겨울 · 성목 가을(장면 크기) · 성목 겨울.
 */
export const KALOPANAX: SpeciesProfile = {
  id: 'kalopanax', nameKo: '음나무', latin: 'Kalopanax septemlobus', sources: ['편 2026-10-23-plant species/kalopanax.json 사본(갤러리용)'],
  habit: { form: 'spreading', branchAngle: 55, apical: 0.6, crownWH: 0.95, heightM: [10, 25], bark: 'furrowed', prickles: true },
  leaf: { shape: 'palmate', margin: 'serrate', venation: 'palmate', arrangement: 'alternate', widthRatio: 1.05, tip: 'acuminate', base: 'cordate', petiole: 1, sizeCm: [10, 30], veins: 7, lobes: 7, glossy: false, droop: 0.3, peak: 0.5 },
  flower: { petals: 5, shape: 'open', petalShape: 'pointed', calyx: 'small', stamens: 'few', inflorescence: 'panicle', position: 'tip', sizeCm: 0.5, months: [7, 8] },
  fruit: { type: 'berry', ratio: 0.85, sizeCm: [0.4, 0.6], bearing: 'cluster', clusterN: 20, months: [9, 10] },
  leafOutMonth: 5, leafFallMonth: 11,
};

export const CompareKalo: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} defs={clips}>
    <g clipPath="url(#b-cmp-0)">
      <GroundLine x0={70} x1={490} y={830} />
      <Tree x={280} y={830} h={640} age="young" seed="kal-young" season="summer" species={KALOPANAX} fruit={false} />
    </g>
    <g clipPath="url(#b-cmp-1)">
      <Tree x={560} y={1700} h={1500} age="mature" seed="kal-edge" season="summer" species={KALOPANAX} fruit={false} shadow={false} />
    </g>
    <g clipPath="url(#b-cmp-2)">
      <LeafDetail x={1180} y={840} angle={-90} len={640} species={KALOPANAX} seed="kal-leaf" />
    </g>
    <g clipPath="url(#b-cmp-3)">
      <GroundLine x0={1420} x1={1840} y={830} />
      <Tree x={1630} y={830} h={640} age="young" seed="kal-young" season="winter" species={KALOPANAX} />
    </g>
  </FullStage>
);

export const CompareKalo2: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} defs={clips}>
    <g clipPath="url(#b-cmp-0)">
      <GroundLine x0={70} x1={490} y={830} />
      <Tree x={280} y={830} h={460} age="sapling" seed="kal-sap" season="summer" species={KALOPANAX} fruit={false} />
    </g>
    <g clipPath="url(#b-cmp-1)">
      <GroundLine x0={520} x1={940} y={830} />
      <Tree x={730} y={830} h={460} age="sapling" seed="kal-sap" season="winter" species={KALOPANAX} />
    </g>
    <g clipPath="url(#b-cmp-2)">
      <GroundLine x0={970} x1={1400} y={830} />
      <Tree x={1180} y={830} h={560} age="mature" seed="kal-old" season="autumn" species={KALOPANAX} fruit={false} />
    </g>
    <g clipPath="url(#b-cmp-3)">
      <GroundLine x0={1420} x1={1840} y={830} />
      <Tree x={1630} y={830} h={560} age="mature" seed="kal-old" season="winter" species={KALOPANAX} />
    </g>
  </FullStage>
);
