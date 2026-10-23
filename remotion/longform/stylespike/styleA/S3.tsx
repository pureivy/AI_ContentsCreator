// A-S3 "심을 때는 뿌리 덩이를 살짝 풀어 주고, 원래 심겨 있던 깊이보다 깊게 묻지 않습니다."
// 박자: 0~86 감긴 뿌리 덩이 → 바깥으로 살짝 풀림(주홍 화살표) ① → 86~180 단면 화분에 앉히고 원래 깊이 선 ② → 흙이 선을 넘으면 ✗, 선까지 ✓
import React from 'react';
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FullStage, atFromWords, beat, clamp, type Word } from '../shared';
import { sectionGeom } from '../geom';
import { AArrow, ABadge, ADefs, ALabel, AMark, APotSection, ARootBall, AShrub, Ink, PA, THEME_A } from './kit';

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
  const ballBottom = G.levelY(base);
  const crownEnd = ballBottom - BALL.h;
  const crownRatio = (G.innerBottom - crownEnd) / (G.innerBottom - G.innerTop);
  const loosen = interpolate(f, [26, 76], [0, 1], clamp);
  const move = interpolate(f, [tDepth, tDepth + 18], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const bx = START.x + (SEC.x - START.x) * move;
  const by = START.y + (crownEnd - START.y) * move - Math.sin(move * Math.PI) * 200;
  // 흙: 바닥(0.1) → 원래 깊이(crown) → 넘침(✗) → 다시 원래 깊이(✓)
  const over = Math.min(0.99, crownRatio + 0.12);
  const fillR = interpolate(f, [tDepth + 22, tDepth + 40, tDepth + 50, tDepth + 60, tDepth + 72], [base, crownRatio, over, over, crownRatio], clamp);
  const secO = beat(f, tDepth - 18, 14);
  const overO = interpolate(fillR, [crownRatio + 0.005, crownRatio + 0.03], [0, 1], clamp);
  const lineY = G.levelY(crownRatio);
  return (
    <FullStage frames={durationInFrames} theme={THEME_A} defs={<ADefs />} chapter={{ index: 2, total: 6, title: '블루베리 화분 심기' }} pan={-240 * move}
      caption={[{ text: '심을 때는 뿌리 덩이를 살짝 풀어 주고,', from: 0 }, { text: '원래 심겨 있던 깊이보다 깊게 묻지 않습니다.', from: tDepth }]}
      labels={<>
        <ABadge x={130} y={230} n={1} at={10} until={tDepth} />
        <ALabel x={176} y={247} at={22} until={tDepth} anchor="start" color={PA.accent} size={50}>{L1}</ALabel>
        <ABadge x={SEC.x + SEC.w / 2 + 90} y={lineY - 70} n={2} at={tDepth + 22} />
        <ALabel x={SEC.x + SEC.w / 2 + 76} y={lineY + 16} at={tDepth + 24} anchor="start" color={PA.accent} size={46}>{L2}</ALabel>
        <AMark x={SEC.x - SEC.w / 2 - 90} y={lineY - 40} ok={false} at={tDepth + 52} until={tDepth + 64} size={46} />
        <AMark x={SEC.x - SEC.w / 2 - 90} y={lineY - 40} ok at={tDepth + 72} size={46} />
      </>}>
      {/* ② 단면 화분 — 바닥 흙 + 덩이 둘레를 채우는 흙(덩이 뒤에 그린다) */}
      <APotSection x={SEC.x} y={SEC.y} w={SEC.w} h={SEC.h} layers={[{ kind: 'soil', ratio: Math.min(fillR, crownRatio) }]} fill={1} o={secO} seed="a3sec">
        {move > 0 ? <ARootBall x={bx} y={by} w={BALL.w} h={BALL.h} loosen={loosen} seed="a3rb" reach={1 - 0.38 * move} hi={beat(f, 30, 12) * (1 - beat(f, tDepth, 12))} /> : null}
        {/* 넘치게 덮은 흙 — 뿌리목 위로 올라온 몫(주홍 빗금 테) */}
        {overO > 0 ? (
          <g opacity={overO}>
            <path d={G.band(crownRatio, fillR)} fill={PA.soil} opacity={0.92} />
            <path d={G.band(crownRatio, fillR)} fill="url(#a-dots)" />
            <path d={G.band(crownRatio, fillR)} fill="none" stroke={PA.accent} strokeWidth={3} strokeDasharray="10 7" />
          </g>
        ) : null}
      </APotSection>
      {move <= 0 ? <ARootBall x={bx} y={by} w={BALL.w} h={BALL.h} loosen={loosen} seed="a3rb" hi={beat(f, 30, 12)} /> : null}
      <AShrub x={bx} y={by + 4} h={320} seed="a3sh" stems={4} berries={false} />
      {/* ① 풀기 — 양옆으로 벌리는 주홍 화살표 */}
      {[-1, 1].map((s) => (
        <AArrow key={s} d={`M ${START.x + s * 170} ${START.y + 130} Q ${START.x + s * 250} ${START.y + 110} ${START.x + s * 300} ${START.y + 150}`} head={[START.x + s * 300, START.y + 150, s > 0 ? 45 : 135]} at={30} until={tDepth - 6} />
      ))}
      {/* ② 원래 깊이 — 뿌리목 높이 점선 */}
      {f >= tDepth + 20 ? <Ink d={`M ${G.innerX(lineY, -1) - 40} ${lineY} L ${G.innerX(lineY, 1) + 60} ${lineY}`} w={3} color={PA.accent} dash="14 9" o={beat(f, tDepth + 20, 10)} /> : null}
    </FullStage>
  );
}
