// 갤러리 — 스타일 B 손 자세(맨손·장갑·왼손). 키트 손볼 때 눈으로 확인. 칸마다 잘라 그린다.
import React from 'react';
import type { FullSceneProps } from '../stage';
import { BRootBall, FullStage, GroundSection, Hand, PB, Tree, handScaleFor } from '../styleB/kit';
import type { HandPoseName } from '../geomHand';

const Stem: React.FC<{ x: number; y: number; r?: number }> = ({ x, y, r = 14 }) => (
  <path d={`M ${x - r} ${y - 190} L ${x - r - 2} ${y + 190} L ${x + r + 2} ${y + 190} L ${x + r} ${y - 190} Z`} fill={PB.paper} stroke={PB.lead} strokeWidth={2.6} />
);

type Cell = { pose: HandPoseName; glove?: boolean; side?: 'left' | 'right'; dx?: number; dy?: number; angle?: number };
const Sheet = (cells: Cell[], scale: number, sleeve = 60): React.FC<FullSceneProps> => ({ durationInFrames }) => (
  <FullStage frames={durationInFrames} defs={<>{cells.map((_, i) => <clipPath key={i} id={`b-gal-c${i}`}><rect x={60 + (i % 4) * 450} y={110 + Math.floor(i / 4) * 390} width={440} height={380} /></clipPath>)}</>}>
    {cells.map((c, i) => {
      const cx = 60 + (i % 4) * 450, cy = 110 + Math.floor(i / 4) * 390;
      const x = cx + 220 + (c.dx ?? 0), y = cy + 190 + (c.dy ?? 0);
      const held = c.pose === 'hold' || c.pose === 'shears';
      return (
        <g key={i} clipPath={`url(#b-gal-c${i})`}>
          <rect x={cx} y={cy} width={440} height={380} fill="none" stroke={PB.soft} strokeWidth={1} />
          {held ? <Hand x={x} y={y} pose={c.pose} glove={c.glove} side={c.side} angle={c.angle ?? 0} scale={scale} layer="back" uid={`gb${i}`} sleeve={sleeve} /> : null}
          {c.pose === 'hold' ? <Stem x={x} y={y} r={13 * scale * 0.9} /> : null}
          <Hand x={x} y={y} pose={c.pose} glove={c.glove} side={c.side} angle={c.angle ?? 0} scale={scale} layer={held ? 'front' : 'all'} uid={`gf${i}`} sleeve={sleeve} />
          <circle cx={x} cy={y} r={4} fill={PB.accent} />
        </g>
      );
    })}
  </FullStage>
);

export const HandsB1 = Sheet([
  { pose: 'hold', dx: -60 }, { pose: 'shears', dx: -30, dy: 40 }, { pose: 'pinch', dx: -90, dy: 60 }, { pose: 'open', dx: 70, dy: 110 },
  { pose: 'pour', dx: -40 }, { pose: 'point', dx: -160 }, { pose: 'press', dx: 90, dy: 80 }, { pose: 'hold', glove: true, dx: -60 },
], 1.5);
export const HandsB2 = Sheet([
  { pose: 'hold', glove: true, dx: -60 }, { pose: 'shears', glove: true, dx: -30, dy: 40 }, { pose: 'pinch', glove: true, dx: -90, dy: 60 }, { pose: 'open', glove: true, dx: 70, dy: 110 },
  { pose: 'open', side: 'left', dx: -70, dy: 110 }, { pose: 'point', side: 'left', dx: 160 }, { pose: 'press', glove: true, dx: 90, dy: 80 }, { pose: 'hold', side: 'left', dx: 60 },
], 1.5);

/** 장면 크기(scale 0.7 ≈ handScaleFor(420px, 1.2m, 2)) — 1080p 에서 읽히는지. 소매 길게(끝은 흐려짐). */
export const HandsB3 = Sheet([
  { pose: 'hold', dx: -30 }, { pose: 'pinch', dx: -40, dy: 30 }, { pose: 'press', dx: 60, dy: 70 }, { pose: 'point', dx: -90 },
  { pose: 'hold', glove: true, dx: -30 }, { pose: 'pinch', glove: true, dx: -40, dy: 30 }, { pose: 'press', glove: true, dx: 60, dy: 70 }, { pose: 'pinch', side: 'left', dx: 40, dy: 30 },
], 0.7, 160);


/**
 * (B4) 장면 크기 쓰임새 — 묘목(h 420, 1.2m) 기준 handScaleFor(…, 1.8):
 * 왼쪽 = 두 손으로 뿌리분 풀기(open 오른손 + side="left"), 가운데 = 장갑 두 손, 오른쪽 = 심은 묘목 옆 흙 누르기(press 맨손·장갑).
 */
export const HandsB4: React.FC<FullSceneProps> = ({ durationInFrames }) => {
  const k = handScaleFor(420, 1.2, 1.8);
  return (
    <FullStage frames={durationInFrames}>
      {/* 뿌리분 풀기 — 맨손 */}
      <BRootBall x={330} y={470} w={210} h={190} loosen={0.6} seed="hb4-rb1" />
      <Hand x={250} y={560} pose="open" scale={k} uid="hb4o1" sleeve={180} />
      <Hand x={410} y={560} pose="open" side="left" scale={k} uid="hb4o2" sleeve={180} />
      {/* 장갑 */}
      <BRootBall x={800} y={470} w={210} h={190} loosen={0.6} seed="hb4-rb2" />
      <Hand x={720} y={560} pose="open" glove scale={k} uid="hb4o3" sleeve={180} />
      <Hand x={880} y={560} pose="open" side="left" glove scale={k} uid="hb4o4" sleeve={180} />
      {/* 흙 누르기 */}
      <GroundSection x0={1020} x1={1850} y={720} depth={140} seed="hb4-g">
        <Tree x={1250} y={720} h={420} age="sapling" seed="hb4-sap" season="spring" roots="small" />
        <Tree x={1640} y={720} h={420} age="sapling" seed="hb4-sap2" season="spring" roots="small" />
      </GroundSection>
      <Hand x={1375} y={720} pose="press" scale={k} uid="hb4p1" sleeve={200} />
      <Hand x={1765} y={720} pose="press" glove scale={k} uid="hb4p2" sleeve={200} />
    </FullStage>
  );
};
