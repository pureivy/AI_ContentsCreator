// 혼합(H) 롱폼 실촬영 전체 화면(2026-10-23, 옵트인 견본) — 이야기·도입 문장. 주인공 수종 세로 폰 영상을 가로 화면에:
// 바탕 = 같은 구간 흐림본(가로 960×540, ffmpeg 에서 흐림·회전 처리 끝) 꽉 채움 + 어둡게, 가운데 = 선명한 세로 영상(둥근 모서리·그림자, 아주 천천히 당김).
// 영상 파일은 hybrid_footage.ts 가 회전 메타 없이 다시 인코딩한 것만 받는다(뒤집힘·늘어짐 방지). 세로 카드 아래 끝은 y 860(자막 띠 위).
import React from 'react';
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { clamp, type Footage } from '../fullscreen/stage';
import { BlurBackdrop, useProbe } from './HybridStage';

/** 세로 카드 높이·위치 — 장 이름 알약(왼쪽 위)과 자막 띠(y ≥ 886)를 피한다. */
export const FG_BOX = { h: 820, top: 40 } as const;

export const FootageFull: React.FC<{ frames: number; bg?: Footage; fg?: Footage; side?: 'center' | 'right' }> = ({ frames, bg, fg, side = 'center' }) => {
  const f = useCurrentFrame();
  const probe = useProbe();
  if (probe) return <AbsoluteFill style={{ background: '#ff00ff' }} />;
  const h = FG_BOX.h;
  const w = Math.round((h * 9) / 16);
  const cx = side === 'right' ? 1920 * 0.64 : 960;
  const inP = interpolate(f, [0, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const z = interpolate(f, [0, Math.max(1, frames)], [1.0, 1.045], clamp);
  return (
    <AbsoluteFill>
      <BlurBackdrop footage={bg} frames={frames} dim={0.34} />
      {fg ? (
        <div style={{ position: 'absolute', left: cx - w / 2, top: FG_BOX.top, width: w, height: h, borderRadius: 30, overflow: 'hidden',
          boxShadow: '0 30px 70px rgba(10,12,8,.45), 0 0 0 2px rgba(255,255,255,.55)', opacity: inP, transform: `translateY(${(1 - inP) * 24}px)` }}>
          <OffthreadVideo src={staticFile(fg.src)} startFrom={Math.round(fg.startFrom * 30)} muted
            style={{ width: w, height: h, objectFit: 'cover', transform: `scale(${z})`, transformOrigin: '50% 45%' }} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
