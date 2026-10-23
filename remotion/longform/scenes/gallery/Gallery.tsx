// 키트 2 갤러리 — 새 부품을 묶음별로 한 화면에 늘어놓는다(눈으로 검수용).
import React from 'react';
import { Composition } from 'remotion';
import { SceneStage } from '../SceneStage';
import { Planter, PotSection } from '../../illus/k2/pots';
import { Hand, type HandPose } from '../../illus/k2/hands';
import { GloveHand, Ground } from '../../illus/Kit';
import { Berry, Fruit, RootBall, Seedling, Shrub } from '../../illus/k2/plants';
import { DimensionLine, Fertilizer, Gauge, Mulch, RangeBar, Ruler, Sack, SoilSection, Stake, Trowel, WaterDrops, WaterStream, WateringCan, SafeLabel } from '../../illus/Kit2';
import { Label } from '../../diagramParts';
import ExampleScene from '../example/S00';

const GPots: React.FC = () => (
  <SceneStage frames={120} backdrop="indoor">
    <Planter x={90} y={250} w={120} h={110} material="plastic" />
    <Planter x={250} y={250} w={120} h={110} material="terracotta" saucer />
    <Planter x={410} y={250} w={120} h={110} material="fabric" />
    <Planter x={570} y={250} w={120} h={110} material="plastic" view="threeQuarter" />
    <Planter x={730} y={250} w={120} h={110} material="terracotta" view="threeQuarter" />
    <Planter x={890} y={250} w={120} h={110} material="fabric" view="threeQuarter" />
    <PotSection id="g1" x={300} y={590} w={300} h={240} material="terracotta" layers={[{ material: 'gravel', ratio: 0.15, label: '자갈' }, { material: 'peat', ratio: 0.45, label: '피트모스' }, { material: 'perlite', ratio: 0.2 }, { material: 'bark', ratio: 0.1 }]} level={{ ratio: 0.5, label: '절반' }} />
    <Planter x={640} y={580} w={150} h={130} material="terracotta" view="bottom" holeGlow={0.6} />
    <Planter x={800} y={580} w={150} h={130} material="plastic" view="bottom" />
    <Planter x={940} y={580} w={110} h={100} material="fabric" view="bottom" />
  </SceneStage>
);

const POSES: HandPose[] = ['hold', 'pinch', 'open', 'pour', 'point'];
const GHands: React.FC = () => (
  <SceneStage frames={120} backdrop="plain">
    {POSES.map((p, i) => (
      <g key={p}>
        <Hand x={60 + i * 190} y={150} pose={p} scale={1.25} arm={50} />
        <Hand x={60 + i * 190} y={330} pose={p} glove={false} scale={1.25} arm={50} />
        <Label x={110 + i * 190} y={250} at={-999} size={26}>{p}</Label>
      </g>
    ))}
    <Hand x={330} y={500} angle={180} side="left" pose="hold" scale={1.3} />
    <Hand x={90} y={500} pose="hold" scale={1.3} />
    <circle cx={200} cy={505} r={28} fill="#7d5c40" />
    <Hand x={560} y={520} angle={-60} pose="point" glove={false} scale={1.3} />
    <GloveHand x={800} y={500} angle={0} />
  </SceneStage>
);

const GPlants: React.FC = () => (
  <SceneStage frames={120} backdrop="sky">
    <Ground y={560} seed="gp" />
    <RootBall id="r0" x={110} y={60} w={150} h={125} loosen={0} />
    <RootBall id="r1" x={330} y={60} w={150} h={125} loosen={0.5} />
    <RootBall id="r2" x={560} y={60} w={150} h={125} loosen={1} />
    <Fruit x={760} y={110} r={26} />
    <Fruit x={830} y={110} r={20} color="#f0a03a" />
    <Berry x={900} y={100} n={4} r={10} />
    <Berry x={800} y={200} n={3} r={9} color="#c0392b" seed="rb" />
    <Shrub x={200} y={560} h={260} stems={4} berries={{}} seed="g1" />
    <Shrub x={500} y={560} h={240} stems={3} leaf="serrate" leafSize={28} fruit={{ color: '#f0a03a', r: 13, n: 3 }} seed="g2" />
    <Seedling x={720} y={560} leaves={0} h={60} />
    <Seedling x={800} y={560} leaves={2} h={80} seed="s2" />
    <Seedling x={890} y={560} leaves={4} h={100} seed="s3" />
  </SceneStage>
);

const GMeasure: React.FC = () => (
  <SceneStage frames={120} backdrop="plain">
    <Ruler x={90} y={90} length={420} units={30} />
    <Ruler x={600} y={90} length={330} units={20} labelEvery={5} kind="ruler" />
    <DimensionLine x1={90} y1={190} x2={510} y2={190} text="30cm" />
    <DimensionLine x1={620} y1={170} x2={620} y2={330} text="20cm" textSide={1} />
    <Gauge x={150} y={330} kind="ph" value={5} probe={80} />
    <Gauge x={330} y={330} kind="temp" value={18} probe={60} />
    <Gauge x={500} y={330} kind="moisture" value={7} />
    <RangeBar x={90} y={500} length={460} min={4} max={8} lo={4.5} hi={5.5} kind="ph" unit="pH" />
    <RangeBar x={800} y={170} length={300} min={0} max={30} lo={15} hi={25} step={5} orient="v" kind="temp" unit="°C" />
  </SceneStage>
);

const GProps: React.FC = () => (
  <SceneStage frames={120} backdrop="sky">
    <Ground y={560} seed="gq" />
    <Sack x={110} y={460} label="피트모스" />
    <Sack x={300} y={250} color="white" tilt={-115} pour={{ at: 0, until: 400, toY: 470, color: '#eef0ea' }} />
    <Sack x={250} y={480} color="green" label="퇴비" w={90} h={120} />
    <Trowel x={470} y={520} angle={-20} soil />
    <WateringCan x={600} y={300} tilt={30} scale={0.8} pour={{ at: 0, until: 400, toY: 545 }} />
    <WaterStream from={[760, 330]} to={[820, 545]} at={0} />
    <WaterDrops pts={[[880, 300], [910, 320]]} at={0} />
    <Fertilizer x={450} y={572} w={180} at={0} />
    <Fertilizer x={650} y={572} w={120} at={0} kind="pellet" />
    <Mulch x0={700} x1={980} y={570} kind="bark" />
    <Stake x={940} y={560} h={260} ties={[90, 170]} tieTo={-16} />
    <Stake x={880} y={560} h={200} kind="wood" />
  </SceneStage>
);

const GSoil: React.FC = () => (
  <SceneStage frames={120} backdrop="sky">
    <SoilSection id="gs" groundY={330} hole={{ x: 420, w: 300, depth: 190, at: 0 }} depth={{ label: '30cm' }}>
      <RootBall id="gsr" x={0} y={-150} w={170} h={140} loosen={0.7} />
    </SoilSection>
    <Seedling x={760} y={332} leaves={4} h={90} />
    <SafeLabel x={990} y={20} size={40}>안전 라벨</SafeLabel>
  </SceneStage>
);

export const GalleryCompositions: React.FC = () => (
  <>
    <Composition id="GHands" component={GHands} fps={30} width={1100} height={680} durationInFrames={120} />
    <Composition id="GPlants" component={GPlants} fps={30} width={1100} height={680} durationInFrames={120} />
    <Composition id="GMeasure" component={GMeasure} fps={30} width={1100} height={680} durationInFrames={120} />
    <Composition id="GProps" component={GProps} fps={30} width={1100} height={680} durationInFrames={120} />
    <Composition id="GSoil" component={GSoil} fps={30} width={1100} height={680} durationInFrames={120} />
    <Composition id="Example" component={ExampleScene} defaultProps={{ durationInFrames: 150 }} fps={30} width={1100} height={680} durationInFrames={150} />
    <Composition id="GPots" component={GPots} fps={30} width={1100} height={680} durationInFrames={120} />
  </>
);
