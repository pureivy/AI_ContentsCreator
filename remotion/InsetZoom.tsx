import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, random, interpolate, Easing } from 'remotion';

/**
 * 인셋 확대창(2026-09-09) — 화면 귀퉁이 둥근 창에 초점 부위를 2배쯤 확대해 띄운다.
 *
 * 묘목 굵기·잎 갈래·접목 자리처럼 화면에선 작은 것을 설명할 때, 배경 전체를 확대하면 맥락이 사라진다.
 * 창으로 띄우면 전체와 부분이 같이 보인다. 창은 초점의 반대편에, 자막(하단 ~30%)은 피해서 둔다.
 * 초점 점 → 창 가장자리로 이어지는 선이 '이 창이 저기를 보여 준다'를 말한다.
 *
 * 배경은 이 씬에서 고정된다(AutoShorts 가 move 'none'·드리프트 없음으로 그린다) — 좌표가 맞으려면 그래야 한다.
 * 창 안의 그림은 배경과 같은 cover 배치를 z 배 한 것이라, focus 가 배경에서 가리키는 곳이 창 중앙에 온다.
 *
 * 세로 자리는 제목(상단 5~31%)·자막(bottomPct 로 정해지는 띠)·플랫폼 UI(하단 ~25%)를 피해서 잡는다.
 * 실렌더 기본(bottomPct 50 → 폭 기준 540px)은 자막이 59~72% 띠에 있어 제목 아래 34~55% 에 창이 들어간다.
 */
export const InsetZoom: React.FC<{
  readonly src: string;
  /** 화면 기준 초점(0~1) — 서버가 이미지 cover 배치를 반영해 변환한 값. */
  readonly focus: { readonly x: number; readonly y: number };
  readonly total: number;
  readonly seed: string;
  /** 자막 하단 여백(%) — KineticCaption 과 같은 값. 창이 자막을 덮지 않게 자리를 고른다. */
  readonly captionBottomPct?: number;
}> = ({ src, focus, total, seed, captionBottomPct = 20 }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const BORDER = 8;
  const D = Math.round(width * 0.37);                // 창 지름 ≈ 400px
  const margin = 48;
  const left = focus.x < 0.5 ? width - D - margin : margin; // 초점 반대편
  // 자막의 paddingBottom 은 CSS % 라 '폭' 기준이다(bottomPct 50 = 540px) — 높이 기준으로 계산하면 자막 위에 창이 얹힌다(실측).
  const capBottom = height - width * (captionBottomPct / 100);
  const capTop = capBottom - 240;                    // 자막 2줄 + 패딩
  const titleBottom = height * 0.32;
  const gapAbove = capTop - titleBottom;
  let top: number;
  if (gapAbove >= D + 40) top = titleBottom + (gapAbove - D) / 2;                 // 제목과 자막 사이
  else if (capBottom + 40 + D <= height * 0.78) top = capBottom + 40;              // 자막 아래(플랫폼 UI 위)
  else {
    // 마지막 수단 — 제목과 자막 사이가 D+40 에 못 미친다. 구절 자막(2026-09-18)이 라벨을 9% 올린 뒤로는 기본값
    // (bottomPct 50 → 라벨 59)에서 늘 여기로 온다: gapAbove 428 vs D 400. 종전 max(titleBottom, capTop−D−40) 은
    // 창을 제목선에 딱 붙였다(여유 0). 제목선 아래 24px 를 먼저 확보하고 남는 만큼을 자막 쪽에 준다 — capTop 은
    // '두 줄 라벨' 가정(240px)이라 한 줄 라벨이면 실제 글자는 88px 더 아래에 있어, 자막 쪽 여유가 0 이어도 글자와
    // 닿지 않는다. 자리가 D 보다 작으면(라벨 62 이상) 제목 쪽으로 넘치되 자막은 절대 안 덮는다.
    // 라벨 58/59 → 제목 24·자막 15/4, 60 → 18·0, 62 → −4·0.
    top = Math.min(titleBottom + 24, capTop - D);
  }
  top = Math.round(top);
  const ap = interpolate(f, [6, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.4)) });
  const z0 = 1.9 + random(`${seed}:iz`) * 0.3;        // 1.9~2.2배
  const z = z0 + 0.3 * (f / Math.max(1, total));      // 씬 동안 천천히 더 밀어들어간다
  const R = (D - BORDER * 2) / 2;                      // 창 안쪽 반지름
  const innerW = width * z, innerH = height * z;
  const ix = R - focus.x * innerW, iy = R - focus.y * innerH;
  // 연결선 — 초점 점에서 창 가장자리까지(창 중심 방향). 등장하며 자라난다.
  const fx = focus.x * width, fy = focus.y * height;
  const cx = left + D / 2, cy = top + D / 2;
  const dx = cx - fx, dy = cy - fy;
  const len = Math.hypot(dx, dy) || 1;
  const ex = cx - (dx / len) * (D / 2), ey = cy - (dy / len) * (D / 2);
  const grow = interpolate(f, [12, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const x2 = fx + (ex - fx) * grow, y2 = fy + (ey - fy) * grow;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: Math.min(1, ap) }}>
      <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
        <line x1={fx} y1={fy} x2={x2} y2={y2} stroke="rgba(0,0,0,0.55)" strokeWidth={10} strokeLinecap="round" />
        <line x1={fx} y1={fy} x2={x2} y2={y2} stroke="rgba(255,255,255,0.95)" strokeWidth={5} strokeLinecap="round" />
        <circle cx={fx} cy={fy} r={13} fill="#ffd54a" stroke="rgba(0,0,0,0.6)" strokeWidth={4} />
      </svg>
      <div style={{
        position: 'absolute', left, top, width: D, height: D, boxSizing: 'border-box', borderRadius: '50%', overflow: 'hidden',
        border: `${BORDER}px solid rgba(255,255,255,0.95)`, boxShadow: '0 14px 40px rgba(0,0,0,0.45)', background: '#000',
        transform: `scale(${(0.6 + 0.4 * ap).toFixed(3)})`,
      }}>
        <div style={{ position: 'absolute', left: ix, top: iy, width: innerW, height: innerH }}>
          <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
