// 예시 E3(스타일 A) "중부지역에서는 11월이 되기 전에 감나무 묘목을 심고, 짚으로 줄기를 둘러 손으로 확인합니다."
// 박자: 0~ 지도·중부 띠 ① → '11월' 달력 칸 주홍 ② → '묘목' 묘목이 선다 → '짚' 아래부터 감긴다(주홍) → '손' 손이 줄기를 쥔다
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { ABadge, ALabel, FullStage, GroundLine, Hand, KoreaMap, MonthStrip, PA, StrawWrap, Tree, atFromWords, beat, beatInOut, treeBox, type FullSceneProps } from './_kit';

const L1 = '중부지역';
const L2 = '짚';

const MAP = { x: 170, y: 180, h: 600 } as const;
const SAP = { x: 1380, y: 800, h: 520 } as const;

export default function Scene({ durationInFrames, words }: FullSceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMonth = atFromWords(words, '11월이', fps, 40);
  const tTree = atFromWords(words, '묘목을', fps, 80);
  const tStraw = atFromWords(words, '짚으로', fps, 120);
  const tHand = atFromWords(words, '손으로', fps, 170);
  const box = treeBox('e3sap', SAP.h, 'sapling');
  const mapO = 1 - 0.55 * beat(f, tTree, 14);
  return (
    <FullStage frames={durationInFrames}
      labels={<>
        <ABadge x={MAP.x + 20} y={MAP.y - 20} n={1} at={6} until={tMonth} />
        <ALabel x={MAP.x + 380} y={MAP.y + 250} at={12} until={tTree} anchor="start" color={PA.accent}>{L1}</ALabel>
        <ABadge x={640} y={210} n={2} at={tMonth} until={tTree} />
        <ALabel x={SAP.x - 120} y={SAP.y - 70} at={tStraw + 8} anchor="end" color={PA.accent}>{L2}</ALabel>
      </>}>
      <KoreaMap x={MAP.x} y={MAP.y} h={MAP.h} region="central" regionP={beat(f, 10, 20)} o={mapO} at={0} seed="e3map" />
      <MonthStrip x={700} y={200} months={[9, 10, 11, 12]} hiMonth={11} hi={beatInOut(f, tMonth, tTree + 10)} cell={110} at={tMonth - 10} o={1 - 0.6 * beat(f, tTree + 10, 14)} />
      <GroundLine x0={1080} x1={1700} y={SAP.y} p={beat(f, tTree - 6, 14)} />
      <Tree x={SAP.x} y={SAP.y} h={SAP.h} age="sapling" seed="e3sap" leaves="bare" at={tTree} grow={24} />
      <StrawWrap x={SAP.x} y0={SAP.y - 150} y1={SAP.y - 4} w={box.trunkW + 26} p={beat(f, tStraw, 30, 'inOut')} hi={beatInOut(f, tStraw, tHand)} />
      <Hand x={SAP.x} y={SAP.y - 230} pose="hold" at={tHand} scale={1.1} />
    </FullStage>
  );
}
