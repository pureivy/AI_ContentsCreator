/**
 * 씬 도해(2026-09-03) — 배경 위에 우리가 직접 그리는 표시. 화살표·동그라미·엑스·체크·치수선·순서.
 *
 * 왜 넣는가: 실촬영 소재가 없는 상태에서 'AI 이미지 슬라이드쇼'라는 형태를 벗어나는 가장 확실한 축이
 * '우리만의 가공 흔적'이다. 나무 니치에서는 설명력도 실사보다 낫다 — 어디를 자르는지는 사진보다
 * 화살표가 정확하다. 배경 이미지가 무엇이든 이 표시는 우리가 만든 것이다.
 *
 * 위치는 9분할 격자로만 받는다(좌표를 LLM 에 맡기면 화면 밖·자막 위로 나간다). 하단 행은 서버 검증에서
 * 중간 행으로 올려 보내므로 여기서는 그대로 그린다.
 *
 * 등장은 씬 시작 후 8프레임에 걸쳐 그려지고(그리는 손맛), 그 뒤 아주 미세하게 맥동한다 — 정지 이미지
 * 위에 고정된 도형은 다시 '정지'로 보이기 때문이다.
 */
import React from 'react';
import { useCurrentFrame, interpolate, AbsoluteFill } from 'remotion';

export type OverlayKind = 'arrow' | 'circle' | 'cross' | 'check' | 'measure' | 'step';
export type OverlayAt = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

const ACCENT = '#FFD400';      // 배경(흙·잎·하늘) 위에서 가장 잘 뜨는 색 — 자막 흰색과도 안 겹친다
const ACCENT_BAD = '#FF5A4E';  // cross 전용(아님·금지)
const ACCENT_OK = '#4ADE80';   // check 전용(맞음)
const STROKE = 12;

/** 9분할 격자 → 화면 비율 좌표(0~1). 캔버스 1080×1920 기준으로 컴포넌트가 스케일한다. */
export function gridPos(at: OverlayAt): { x: number; y: number } {
  const col = at[1] === 'l' ? 0.24 : at[1] === 'r' ? 0.76 : 0.5;
  const row = at[0] === 't' ? 0.26 : at[0] === 'b' ? 0.72 : 0.48;
  return { x: col, y: row };
}

export const SceneOverlay: React.FC<{
  overlay: { kind: OverlayKind; at: OverlayAt; label?: string };
  total: number;
}> = ({ overlay, total }) => {
  const f = useCurrentFrame();
  const draw = interpolate(f, [4, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // 미세 맥동 — 정지 도형이 다시 '정지 화면'으로 읽히지 않게. 진폭은 2% 이내.
  const pulse = 1 + 0.02 * Math.sin((f / total) * Math.PI * 6);
  const { x, y } = gridPos(overlay.at);
  const cx = x * 1080, cy = y * 1920;
  const color = overlay.kind === 'cross' ? ACCENT_BAD : overlay.kind === 'check' ? ACCENT_OK : ACCENT;
  const R = 120;

  return (
    <AbsoluteFill>
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
        <g opacity={draw} transform={`translate(${cx} ${cy}) scale(${pulse}) translate(${-cx} ${-cy})`}>
          {overlay.kind === 'circle' && (
            <circle cx={cx} cy={cy} r={R} fill="none" stroke={color} strokeWidth={STROKE}
              strokeDasharray={2 * Math.PI * R} strokeDashoffset={(1 - draw) * 2 * Math.PI * R} strokeLinecap="round" />
          )}
          {overlay.kind === 'arrow' && (
            <g stroke={color} strokeWidth={STROKE} strokeLinecap="round" fill="none">
              <line x1={cx - 190} y1={cy - 150} x2={cx - 40 * draw - 30} y2={cy - 32 * draw - 24} />
              <polyline points={`${cx - 96},${cy - 24} ${cx - 24},${cy - 24} ${cx - 24},${cy - 96}`}
                transform={`rotate(-45 ${cx - 24} ${cy - 24})`} opacity={draw} />
            </g>
          )}
          {overlay.kind === 'cross' && (
            <g stroke={color} strokeWidth={STROKE + 2} strokeLinecap="round">
              <line x1={cx - 78} y1={cy - 78} x2={cx - 78 + 156 * draw} y2={cy - 78 + 156 * draw} />
              <line x1={cx + 78} y1={cy - 78} x2={cx + 78 - 156 * draw} y2={cy - 78 + 156 * draw} />
            </g>
          )}
          {overlay.kind === 'check' && (
            <polyline points={`${cx - 84},${cy} ${cx - 20},${cy + 62} ${cx + 88},${cy - 68}`}
              fill="none" stroke={color} strokeWidth={STROKE + 2} strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray={300} strokeDashoffset={(1 - draw) * 300} />
          )}
          {overlay.kind === 'measure' && (
            <g stroke={color} strokeWidth={STROKE - 2} strokeLinecap="round">
              <line x1={cx - 160} y1={cy} x2={cx - 160 + 320 * draw} y2={cy} />
              <line x1={cx - 160} y1={cy - 34} x2={cx - 160} y2={cy + 34} />
              <line x1={cx + 160} y1={cy - 34} x2={cx + 160} y2={cy + 34} opacity={draw} />
            </g>
          )}
          {overlay.kind === 'step' && (
            <g>
              <circle cx={cx} cy={cy} r={72} fill={color} opacity={0.92 * draw} />
              <text x={cx} y={cy + 26} textAnchor="middle" fontSize={78} fontWeight={800} fill="#1a1a1a">
                {(overlay.label ?? '1').slice(0, 2)}
              </text>
            </g>
          )}
          {overlay.label && overlay.kind !== 'step' && (
            <g opacity={draw}>
              <rect x={cx - 132} y={cy + R + 8} width={264} height={72} rx={14} fill="rgba(0,0,0,0.62)" />
              <text x={cx} y={cy + R + 58} textAnchor="middle" fontSize={44} fontWeight={700} fill="#fff">
                {overlay.label}
              </text>
            </g>
          )}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
