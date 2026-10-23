// 전체 화면 키트 갤러리(2026-10-23) — 스타일별 예시 장면을 실제 합성 모양(장 이름·자막 띠)으로. 키트 손볼 때 눈으로 확인하는 용도.
import React from 'react';
import { Composition } from 'remotion';
import { FullFrame } from '../LongFormFull';
import { approxWords } from '../../../../src/longform/sceneRules';
import type { FullSceneProps } from '../stage';
import A1 from '../styleA/examples/E1';
import A2 from '../styleA/examples/E2';
import A3 from '../styleA/examples/E3';
import B1 from '../styleB/examples/E1';
import B2 from '../styleB/examples/E2';
import B3 from '../styleB/examples/E3';
import * as KA from '../styleA/kit';
import * as KB from '../styleB/kit';
import { HandsB1, HandsB2, HandsB3, HandsB4 } from './handsB';
import { BarkClose, BarkStraw, TreesDetail, TreesMature, TreesYoung } from './treesB';
import { BotanySheet, ShadingTest } from './botanyB';
import { CompareB, CompareB2, CompareKalo, CompareKalo2 } from './compareB';

/** 부품 시험판 — 감나무 세 나이(잎·열매), 감 세 종류, 해·물방울·항아리. */
const parts = (K: typeof KA | typeof KB): React.FC<FullSceneProps> => ({ durationInFrames }) => (
  <K.FullStage frames={durationInFrames}>
    <K.GroundLine x0={120} x1={1800} y={760} />
    <K.Tree x={330} y={760} h={260} age="sapling" seed="t1" leaves="full" />
    <K.Tree x={760} y={760} h={420} age="young" seed="t2" leaves="autumn" />
    <K.Tree x={1300} y={760} h={600} age="mature" seed="t3" leaves="full" hi={{ fruit: 1 }} />
    <K.Persimmon x={1640} y={300} r={44} kind="flat" />
    <K.Persimmon x={1740} y={300} r={44} kind="long" hi={1} />
    <K.Sun x={1690} y={480} r={40} />
    <K.Drop x={1620} y={560} />
    <K.Reserve x={1740} y={740} w={110} h={150} value={0.4} hi={1} />
  </K.FullStage>
);

const S1 = '화분은 지름 30센티 이상으로 고르고, 바닥에 물 빠짐 구멍이 있는지 먼저 확인합니다.';
const S2 = '다 자란 감나무는 뿌리가 넓고 몸통에 양분이 많지만, 어린 묘목은 뿌리도 양분도 적어 첫 겨울 언 땅에 약합니다.';
const S3 = '중부지역에서는 11월이 되기 전에 감나무 묘목을 심고, 짚으로 줄기를 둘러 손으로 확인합니다.';
const ITEMS: Array<[string, React.ComponentType<FullSceneProps>, 'A' | 'B', string]> = [['PA', parts(KA), 'A', S2], ['PB', parts(KB), 'B', S2], ['A1', A1, 'A', S1], ['A2', A2, 'A', S2], ['A3', A3, 'A', S3], ['B1', B1, 'B', S1], ['B2', B2, 'B', S2], ['B3', B3, 'B', S3]];
const FR = 240;
const SHEETS: Array<[string, React.ComponentType<FullSceneProps>]> = [['HB1', HandsB1], ['HB2', HandsB2], ['HB3', HandsB3], ['HB4', HandsB4], ['TM', TreesMature], ['TY', TreesYoung], ['TD', TreesDetail], ['SH', ShadingTest], ['BO', BotanySheet], ['CMP', CompareB], ['CMP2', CompareB2], ['CMPK', CompareKalo], ['CMPK2', CompareKalo2], ['BS', BarkStraw], ['BK', BarkClose]];

export const GalleryRoot: React.FC = () => (
  <>
    {ITEMS.map(([id, C, style, text]) => {
      const Comp: React.FC<{ footage?: FullSceneProps['footage'] }> = ({ footage }) => (
        <FullFrame style={style} scene={C} guard={false} sceneProps={{ durationInFrames: FR, words: approxWords(text, FR / 30 - 0.35), ...(footage ? { footage } : {}) }}
          chapter={{ index: 1, total: 8, title: '묘목이 불리한 까닭' }} captions={[{ text, startFrame: 0, endFrame: FR }]} />
      );
      return <Composition key={id} id={id} component={Comp} defaultProps={{}} fps={30} width={1920} height={1080} durationInFrames={FR} />;
    })}
    {SHEETS.map(([id, C]) => {
      const Comp: React.FC = () => <FullFrame style="B" scene={C} guard={false} sceneProps={{ durationInFrames: FR }} chapter={{ index: 0, total: 1, title: '' }} captions={[]} />;
      return <Composition key={id} id={id} component={Comp} defaultProps={{}} fps={30} width={1920} height={1080} durationInFrames={FR} />;
    })}
  </>
);
