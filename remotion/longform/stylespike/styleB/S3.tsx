// B-S3 "심을 때는 뿌리 덩이를 살짝 풀어 주고, 원래 심겨 있던 깊이보다 깊게 묻지 않습니다."
// 박자: 0~86 감긴 뿌리가 풀린다(풀린 뿌리 = 포인트 색) → 86~180 단면 화분에 앉히고 원래 깊이 선(포인트 색) → 넘치면 ✗, 선까지 ✓
import React from 'react';
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FullStage, atFromWords, beat, clamp, type Word } from '../shared';
import { sectionGeom } from '../geom';
import { BArrow, BDefs, BLabel, BMark, BPotSection, BRootBall, BShrub, PB, PLine, THEME_B } from './kit';

const L1 = '뿌리 살짝 풀기';
const L2 = '원래 깊이';

const SEC = { x: 1240, y: 846, w: 520, h: 400 } as const;
const BALL = { w: 320, h: 270 } as const;
const START = { x: 760, y: 420 } as const;

export default function Scene({ durationInFrames, words }: { durationInFrames: number; words?: Word[] }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tDepth = atFromWords(words, '원래', fps, 78);
  const G = sectionGeom(SEC.x, SEC.y, SEC.w, SEC.h);
  const base = 0.1;
  const crownEnd = G.levelY(base) - BALL.h;
  const crownRatio = (G.innerBottom - crownEnd) / (G.innerBottom - G.innerTop);
  const loosen = interpolate(f, [26, 76], [0, 1], clamp);
  const move = interpolate(f, [tDepth, tDepth + 18], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const bx = START.x + (SEC.x - START.x) * move;
  const by = START.y + (crownEnd - START.y) * move - Math.sin(move * Math.PI) * 200;
  const over = Math.min(0.99, crownRatio + 0.12);
  const fillR = interpolate(f, [tDepth + 22, tDepth + 40, tDepth + 50, tDepth + 60, tDepth + 72], [base, crownRatio, over, over, crownRatio], clamp);
  const overO = interpolate(fillR, [crownRatio + 0.005, crownRatio + 0.03], [0, 1], clamp);
  const lineY = G.levelY(crownRatio);
  const rootHi = beat(f, 30, 10) * (1 - beat(f, tDepth + 20, 12));
  const ball = <BRootBall x={bx} y={by} w={BALL.w} h={BALL.h} loosen={loosen} seed="b3rb" reach={1 - 0.38 * move} hi={rootHi} />;
  return (
    <FullStage frames={durationInFrames} theme={THEME_B} defs={<BDefs />} svgFilter="url(#b-graphite)" chapter={{ index: 2, total: 6, title: '블루베리 화분 심기' }} pan={-240 * move}
      caption={[{ text: '심을 때는 뿌리 덩이를 살짝 풀어 주고,', from: 0 }, { text: '원래 심겨 있던 깊이보다 깊게 묻지 않습니다.', from: tDepth }]}
      labels={<>
        <BLabel x={130} y={247} at={22} until={tDepth} anchor="start" hi size={54} underline={330}>{L1}</BLabel>
        <BLabel x={SEC.x + SEC.w / 2 + 76} y={lineY + 16} at={tDepth + 24} anchor="start" hi size={50}>{L2}</BLabel>
        <BMark x={SEC.x - SEC.w / 2 - 90} y={lineY - 40} ok={false} at={tDepth + 52} until={tDepth + 64} size={46} />
        <BMark x={SEC.x - SEC.w / 2 - 90} y={lineY - 40} ok at={tDepth + 72} size={46} />
      </>}>
      <BPotSection x={SEC.x} y={SEC.y} w={SEC.w} h={SEC.h} layers={[{ kind: 'soil', ratio: Math.min(fillR, crownRatio) }]} fill={1} o={beat(f, tDepth - 18, 14)} seed="b3sec">
        {move > 0 ? ball : null}
        {overO > 0 ? (
          <g opacity={overO}>
            <path d={G.band(crownRatio, fillR)} fill={PB.paper} />
            <path d={G.band(crownRatio, fillR)} fill="url(#b-h50)" />
            <PLine d={G.band(crownRatio, fillR)} w={2} double={false} />
          </g>
        ) : null}
      </BPotSection>
      {move <= 0 ? ball : null}
      <BShrub x={bx} y={by + 4} h={320} seed="b3sh" stems={4} berries={false} />
      {[-1, 1].map((s) => (
        <BArrow key={s} d={`M ${START.x + s * 175} ${START.y + 130} Q ${START.x + s * 250} ${START.y + 110} ${START.x + s * 300} ${START.y + 150}`} head={[START.x + s * 300, START.y + 150, s > 0 ? 45 : 135]} at={30} until={tDepth - 6} />
      ))}
      {f >= tDepth + 20 ? <PLine d={`M ${G.innerX(lineY, -1) - 40} ${lineY} L ${G.innerX(lineY, 1) + 60} ${lineY}`} w={3.2} color={PB.accent} dash="14 9" o={beat(f, tDepth + 20, 10)} /> : null}
    </FullStage>
  );
}
