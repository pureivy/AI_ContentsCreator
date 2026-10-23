// S00 "심을 구덩이는 뿌리 덩이보다 넓게, 깊이는 30센티 정도로 팝니다." — KIT_API.md 틀 그대로 쓴 예시(검사용).
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { SceneStage, type SceneProps } from '../SceneStage';
import { ACCENT, Hand, RootBall, SafeLabel, SoilSection, Trowel, atFromWords, beat, beatInOut, handGrip } from '../../illus/Kit2';

const L1 = '뿌리 덩이보다 넓게';
const L2 = '30cm';

export default function Scene({ durationInFrames, words }: SceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tDig = atFromWords(words, '구덩이', fps, 6);
  const tDepth = atFromWords(words, '깊이', fps, 70);
  const tool = beatInOut(f, tDig, tDig + 50);
  const ballIn = beat(f, tDepth + 20, 20, 'inOut');
  return (
    <SceneStage frames={durationInFrames} backdrop="sky">
      <SoilSection id="s00-soil" groundY={300} hole={{ x: 470, w: 320, depth: 200, at: tDig + 8, dur: 36 }} depth={{ label: L2, at: tDepth }}>
        <RootBall id="s00-ball" x={0} y={-150 - (1 - ballIn) * 260} w={180} h={145} o={ballIn} />
      </SoilSection>
      {(() => {
        // 손이 모종삽 손잡이를 쥐고 위아래로 판다 — 쥔 점(handGrip)에 손잡이(origin='handle')를 둔다.
        const hy = 200 + Math.sin(f / 4) * 12;
        // 주먹(pour) 손잡이는 손가락과 직각 — 손 160°(왼쪽 위를 향함, side left 로 엄지 위) → 날은 160-90=70°(오른쪽 아래, 구덩이 쪽).
        const [gx, gy] = handGrip(560, hy, 160, 'pour', 1.2, 'left');
        return (
          <g>
            <Trowel x={gx} y={gy} angle={70} origin="handle" o={tool} />
            <Hand x={560} y={hy} angle={160} side="left" pose="pour" scale={1.2} o={tool} arm={90} />
          </g>
        );
      })()}
      <SafeLabel x={470} y={120} at={tDig + 30} color={ACCENT} size={38}>{L1}</SafeLabel>
    </SceneStage>
  );
}
