// 예시 E2(스타일 A) "다 자란 감나무는 뿌리가 넓고 몸통에 양분이 많지만, 어린 묘목은 뿌리도 양분도 적어 첫 겨울 언 땅에 약합니다."
// 박자: 0~ 성목(주인공) + 땅 단면 → '뿌리' 넓은 뿌리 주홍 → '양분' 몸통 알갱이 주홍 → '어린' 묘목 자람·작은 뿌리 주홍 → '언' 언 층이 내려온다(주홍) → '약합니다' ✗
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { ALabel, AMark, FullStage, GroundSection, PA, Snowfall, Tree, atFromWords, beat, beatInOut, type FullSceneProps } from './_kit';

const L1 = '다 자란 감나무';
const L2 = '어린 묘목';
const L3 = '언 땅';

const GROUND = 600;
const BIG = { x: 600, h: 400 } as const;
const SMALL = { x: 1360, h: 230 } as const;

export default function Scene({ durationInFrames, words }: FullSceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tRoot = atFromWords(words, '뿌리가', fps, 30);
  const tStore = atFromWords(words, '양분이', fps, 70);
  const tYoung = atFromWords(words, '어린', fps, 110);
  const tFrost = atFromWords(words, '언', fps, 170);
  const tWeak = atFromWords(words, '약합니다', fps, 200);
  const frost = beat(f, tFrost, 24, 'inOut');
  return (
    <FullStage frames={durationInFrames}
      labels={<>
        <ALabel x={BIG.x} y={170} at={4} until={tYoung}>{L1}</ALabel>
        <ALabel x={SMALL.x} y={330} at={tYoung + 6} color={PA.accent}>{L2}</ALabel>
        <ALabel x={1700} y={GROUND + 70} at={tFrost + 10} anchor="end" color={PA.accent}>{L3}</ALabel>
        <AMark x={SMALL.x + 170} y={420} ok={false} at={tWeak} size={50} />
      </>}>
      <GroundSection x0={150} x1={1770} y={GROUND} depth={250} frost={frost} frostHi={beatInOut(f, tFrost, tWeak + 20)} seed="e2g">
        <Tree x={BIG.x} y={GROUND} h={BIG.h} age="mature" seed="e2big" leaves="bare" roots="wide" rootW={760} rootDepth={220}
          store={beat(f, tStore, 16)} hi={{ roots: beatInOut(f, tRoot, tStore), store: beatInOut(f, tStore, tYoung) }} />
        <Tree x={SMALL.x} y={GROUND} h={SMALL.h} age="sapling" seed="e2small" leaves="bare" roots="small" rootW={170} rootDepth={90}
          at={tYoung} grow={26} rootP={beat(f, tYoung + 10, 20)} store={0.25} hi={{ roots: beatInOut(f, tYoung + 20, tFrost) }} />
      </GroundSection>
      <Snowfall x0={150} x1={1770} y0={140} y1={GROUND - 10} at={tFrost - 10} n={42} />
    </FullStage>
  );
}
