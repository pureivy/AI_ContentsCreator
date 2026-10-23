// 갤러리 — 스타일 B 명암 시험(구·원기둥·감 — 5요소)과 도감 부품(엽형·엽연, 꽃, 열매, 관목). 키트 손볼 때 눈으로 확인.
import React from 'react';
import type { FullSceneProps } from '../stage';
import { BLabel, BLeader, CastShadow, Flower, Fruit, FullStage, GroundLine, LeafDetail, PB, PLine, PersimmonFruit, ShadeLayers, TONE, Tree } from '../styleB/kit';
import { cylShade, sphereShade } from '../shade';
import { PERSIMMON_PROFILE, BLUEBERRY_PROFILE, GENERIC_BROADLEAF } from '../species/presets';
import type { LeafSpec, SpeciesProfile } from '../species/schema';

/** 구·원기둥·감 — 하이라이트(비움)·중간 톤(H→2B)·핵심 그림자(6B 크로스)·반사광(외곽 안 띠)·투영 그림자. */
export const ShadingTest: React.FC<FullSceneProps> = ({ durationInFrames }) => {
  const sph = sphereShade(150, 150, 'gsph', 4.4);
  const cyl = cylShade([[0, 0], [0, -330]], [220, 220], 'gcyl', 4.2, { bend: 0.18 });
  const circle = 'M -150 0 a 150 150 0 1 0 300 0 a 150 150 0 1 0 -300 0 Z';
  const cylBody = 'M -110 0 L -110 -330 L 110 -330 L 110 0 Z';
  return (
    <FullStage frames={durationInFrames} labels={<>
      <BLabel x={340} y={850} at={0} size={34}>구</BLabel><BLabel x={960} y={850} at={0} size={34}>원기둥</BLabel><BLabel x={1550} y={850} at={0} size={34}>감 열매</BLabel>
      <BLabel x={150} y={210} at={0} size={26} anchor="start">하이라이트</BLabel><BLeader pts={[[285, 405], [230, 225]]} at={0} />
      <BLabel x={520} y={250} at={0} size={26} anchor="start">중간 톤</BLabel><BLeader pts={[[380, 420], [520, 260]]} at={0} />
      <BLabel x={560} y={600} at={0} size={26} anchor="start">핵심 그림자</BLabel><BLeader pts={[[430, 560], [555, 590]]} at={0} />
      <BLabel x={560} y={680} at={0} size={26} anchor="start">반사광</BLabel><BLeader pts={[[462, 590], [555, 670]]} at={0} />
      <BLabel x={560} y={760} at={0} size={26} anchor="start">투영 그림자</BLabel><BLeader pts={[[520, 760], [555, 752]]} at={0} />
    </>}>
      <GroundLine x0={80} x1={1840} y={780} />
      <CastShadow x={340} y={780} w={90} len={360} />
      <g transform="translate(340 480)">
        <path d={circle} fill={PB.paper} />
        <ShadeLayers s={sph} />
        <PLine d={circle} w={TONE.B2.w} seed="gsc" />
      </g>
      <CastShadow x={960} y={780} w={220} len={380} />
      <g transform="translate(960 780)">
        <path d={cylBody} fill={PB.paper} />
        <ShadeLayers s={cyl} />
        <PLine d={cylBody} w={TONE.B2.w} seed="gcy" />
        <path d="M -110 -330 A 110 22 0 0 0 110 -330 A 110 22 0 0 0 -110 -330 Z" fill={PB.paper} stroke={PB.lead} strokeWidth={2.4} />
        <path d="M 110 -330 L 110 0" stroke={TONE.B6.color} strokeWidth={TONE.B6.w * 0.6} />
      </g>
      <CastShadow x={1550} y={780} w={130} len={340} />
      <PersimmonFruit x={1550} y={600} r={170} detail seed="gpf" />
    </FullStage>
  );
};

const SHAPES: LeafSpec['shape'][] = ['ovate', 'elliptic', 'lanceolate', 'obovate', 'orbicular', 'cordate', 'palmate', 'pinnate'];
const MARGINS: LeafSpec['margin'][] = ['entire', 'serrate', 'doubleSerrate', 'undulate', 'lobed'];
const mk = (leaf: Partial<LeafSpec>): SpeciesProfile => ({ ...GENERIC_BROADLEAF, id: `g-${leaf.shape}-${leaf.margin}`, leaf: { ...GENERIC_BROADLEAF.leaf, ...leaf } });

export const BotanySheet: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames}>
    {/* 엽형 8 (전연·우상맥, 손바닥은 장상맥) */}
    {SHAPES.map((s, i) => <LeafDetail key={s} x={70 + i * 225} y={190} angle={-25} len={190} species={mk({ shape: s, margin: s === 'palmate' ? 'serrate' : 'entire', venation: s === 'palmate' ? 'palmate' : 'pinnate', widthRatio: s === 'lanceolate' ? 0.25 : s === 'orbicular' ? 0.9 : s === 'cordate' ? 0.75 : 0.5, base: s === 'cordate' ? 'cordate' : 'rounded', veins: s === 'palmate' ? 5 : 6, lobes: s === 'pinnate' ? 4 : 5 })} seed={`gl${i}`} />)}
    {/* 엽연 5 */}
    {MARGINS.map((m, i) => <LeafDetail key={m} x={70 + i * 250} y={390} angle={-15} len={210} species={mk({ shape: 'elliptic', margin: m })} seed={`gm${i}`} />)}
    {/* 꽃 — 감(항아리·큰 꽃받침), 블루베리(종), 일반(홑 5장), 겹꽃 */}
    <Flower x={1360} y={300} size={90} species={PERSIMMON_PROFILE} />
    <Flower x={1500} y={300} size={70} species={BLUEBERRY_PROFILE} />
    <Flower x={1650} y={360} size={110} species={GENERIC_BROADLEAF} />
    <Flower x={1790} y={360} size={110} species={{ ...GENERIC_BROADLEAF, id: 'g-dbl', flower: { ...GENERIC_BROADLEAF.flower, double: true, petalShape: 'notched' } }} />
    {/* 열매 */}
    <PersimmonFruit x={140} y={680} r={70} detail seed="gb1" />
    {(['pome', 'pear', 'drupe', 'jujube', 'chestnut'] as const).map((t, i) => (
      <Fruit key={t} x={330 + i * 175} y={690} r={58} species={{ ...GENERIC_BROADLEAF, id: `g-f-${t}`, fruit: { ...GENERIC_BROADLEAF.fruit, type: t, ratio: t === 'jujube' ? 1.35 : t === 'pome' ? 0.92 : 1 } }} seed={`gfr${i}`} />
    ))}
    {[0, 1, 2, 3, 4, 5, 6].map((k) => <Fruit key={k} x={1250 + (k % 3) * 34 + (k > 2 ? 17 : 0) - (k > 5 ? 30 : 0)} y={660 + Math.floor(k / 3) * 30} r={18} species="blueberry" seed={`gbb${k}`} />)}
    {/* 블루베리 관목(여름 열매) */}
    <GroundLine x0={1420} x1={1840} y={820} />
    <Tree x={1630} y={820} h={360} species="blueberry" age="young" seed="g-bb" season="summer" />
  </FullStage>
);
