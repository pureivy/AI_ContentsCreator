// 갤러리 — 스타일 B 나무: 나이 × 계절, 감잎·감 확대, 뿌리(맨뿌리·뿌리분·땅속), 손과 함께. 키트 손볼 때 눈으로 확인.
import React from 'react';
import type { FullSceneProps } from '../stage';
import { BLabel, FallingLeaves, FullStage, GroundLine, GroundSection, Hand, PersimmonFruit, PersimmonLeaf, StrawWrap, Tree, treeBox } from '../styleB/kit';
import type { Season } from '../geomTree';

const SEASONS: Season[] = ['winter', 'spring', 'summer', 'autumn'];
const NAME: Record<Season, string> = { winter: '겨울', spring: '봄', summer: '여름', autumn: '가을' };

export const TreesMature: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} labels={<>{SEASONS.map((s, i) => <BLabel key={s} x={250 + i * 470} y={850} at={0} size={34}>{`성목 ${NAME[s]}`}</BLabel>)}</>}>
    {SEASONS.map((s, i) => (
      <g key={s}>
        <GroundLine x0={70 + i * 470} x1={430 + i * 470} y={800} />
        <Tree x={250 + i * 470} y={800} h={560} age="mature" seed="gal-big" season={s} />
      </g>
    ))}
  </FullStage>
);

export const TreesYoung: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} labels={<>{SEASONS.map((s, i) => <React.Fragment key={s}><BLabel x={250 + i * 470} y={470} at={0} size={30}>{`접목묘 ${NAME[s]}`}</BLabel><BLabel x={250 + i * 470} y={858} at={0} size={30}>{`어린 나무 ${NAME[s]}`}</BLabel></React.Fragment>)}</>}>
    {SEASONS.map((s, i) => (
      <g key={s}>
        <GroundLine x0={100 + i * 470} x1={400 + i * 470} y={430} />
        <Tree x={250 + i * 470} y={430} h={300} age="sapling" seed="gal-sap" season={s} />
        <GroundLine x0={90 + i * 470} x1={410 + i * 470} y={820} />
        <Tree x={250 + i * 470} y={820} h={330} age="young" seed="gal-young" season={s} />
      </g>
    ))}
  </FullStage>
);

export const TreesDetail: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames}>
    <PersimmonLeaf x={110} y={330} angle={-18} len={400} seed="gl1" />
    <PersimmonFruit x={300} y={680} r={130} detail seed="gf1" />
    <PersimmonFruit x={560} y={720} r={80} seed="gf2" hi={1} />
    {/* 맨뿌리 접목묘를 손에 든 모습 */}
    <Hand x={830} y={430} pose="hold" scale={0.75} layer="back" uid="gdh" sleeve={200} />
    <Tree x={830} y={560} h={430} age="sapling" seed="gal-sap" season="winter" roots="bare" rootW={170} rootDepth={190} shadow={false} />
    <Hand x={830} y={430} pose="hold" scale={0.75} layer="front" uid="gdh" sleeve={200} />
    {/* 뿌리분 묘목 */}
    <GroundLine x0={1000} x1={1250} y={640} />
    <Tree x={1120} y={640} h={420} age="sapling" seed="gal-sap2" season="spring" roots="ball" rootW={150} rootDepth={130} />
    {/* 땅속 — 성목 넓은 뿌리 */}
    <GroundSection x0={1300} x1={1840} y={560} depth={270} seed="gal-gs">
      <Tree x={1570} y={560} h={420} age="mature" seed="gal-big2" season="autumn" roots="wide" rootW={520} rootDepth={220} />
    </GroundSection>
    <FallingLeaves x0={1380} x1={1760} y0={300} y1={556} at={0} until={240} n={10} size={14} />
  </FullStage>
);

/**
 * (B4) 껍질·짚 감싸기 — 성목 거북등 확대(왼쪽), 성목 밑동 짚 감싸기(가운데), 묘목 짚 감싸기(장면 크기, 오른쪽 둘: 다 감음·감는 중).
 */
export const BarkStraw: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} defs={<clipPath id="b-bs-0"><rect x={60} y={120} width={440} height={740} /></clipPath>}>
    <g clipPath="url(#b-bs-0)">
      <GroundLine x0={60} x1={500} y={830} />
      <Tree x={280} y={830} h={2700} age="mature" seed="cmp-old" season="winter" />
    </g>
    <GroundLine x0={540} x1={1000} y={830} />
    <Tree x={770} y={830} h={640} age="mature" seed="bs-big" season="winter" />
    <StrawWrap x={770} y0={830 - 230} y1={830 - 30} w={treeBox('bs-big', 640, 'mature').trunkW * 1.15 + 26} seed="bs-sw1" />
    <GroundLine x0={1060} x1={1860} y={830} />
    <Tree x={1260} y={830} h={460} age="sapling" seed="intro-sap" season="winter" />
    <StrawWrap x={1260} y0={830 - 270} y1={830 - 6} w={treeBox('intro-sap', 460, 'sapling').trunkW + 26} seed="bs-sw2" />
    <Tree x={1640} y={830} h={460} age="sapling" seed="bs-sap2" season="winter" />
    <StrawWrap x={1640} y0={830 - 270} y1={830 - 6} w={treeBox('bs-sap2', 460, 'sapling').trunkW + 26} seed="bs-sw3" p={0.6} />
  </FullStage>
);

/**
 * (B5) 성목 껍질 확대 — 실물 대조(Wikimedia Commons 'Diospyros kaki bark.jpg' 등, 내부 참고)용. 큰 확대 둘(밑동·가슴 높이) + 장면 크기 하나.
 */
export const BarkClose: React.FC<FullSceneProps> = ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} defs={<>
    <clipPath id="b-bk-0"><rect x={60} y={120} width={560} height={740} /></clipPath>
    <clipPath id="b-bk-1"><rect x={660} y={120} width={560} height={740} /></clipPath>
  </>}>
    <g clipPath="url(#b-bk-0)">
      <GroundLine x0={60} x1={620} y={830} />
      <Tree x={340} y={830} h={2700} age="mature" seed="cmp-old" season="winter" />
    </g>
    <g clipPath="url(#b-bk-1)">
      <Tree x={940} y={1500} h={3400} age="mature" seed="bk-mid" season="winter" />
    </g>
    <GroundLine x0={1280} x1={1860} y={830} />
    <Tree x={1570} y={830} h={640} age="mature" seed="bs-big" season="winter" />
  </FullStage>
);
