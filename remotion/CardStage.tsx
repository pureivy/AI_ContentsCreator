/**
 * 카드 무대·머리줄(카드 모션 v2, 2026-10-05) — 대비·목록·결론 카드가 공유하는 자리와 결론 한 줄.
 *
 * 자리: 위는 제목 캘리의 실제 아래 끝(서버가 캘리 그림 비율로 잰 topPx), 아래는 라벨(screenText)의 위 끝(bottomPx).
 * 카드는 그 띠의 가운데에 놓이고, 추정 높이가 띠보다 크면 통째로 줄인다 — 캘리·자막을 덮지 않는 것이 크기보다 먼저다.
 * 종전 카드는 화면 가운데(paddingBottom 고정)에 앉아 4항목 목록이 라벨 바로 위까지 내려왔다.
 *
 * 머리줄: 서버(cardHeaderFor)가 대본 문장에서 고른 한 줄을 그대로 쓴다. 렌더러는 글자를 만들지 않는다.
 * 어두운 바탕·흰 글자·노란 밑줄 — 파일럿의 밝은 유리판+올리브는 초록 잎 배경 위에서 덜 읽혔다(사장님 판정).
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { settleIn, drawIn, smoothstep } from './anim';
import { fitCaption } from './KineticCaption';

/** 서버가 캘리 높이를 못 줬을 때의 위 끝 — 최근 40편 캘리 실측 최대 아래 끝(≈555px) + 여백. */
export const CARD_TOP_DEFAULT = 570;
/** 카드 폭(화면 비) — 종전 78~82% 보다 넓혀 큰 글자가 한 줄에 들어가게. 좌우 각 65px 여백이 남는다. */
export const CARD_WIDTH = 0.88;
/** 머리줄 글자 상한·하한(px). */
const HEADER_MAX_PX = 46, HEADER_MIN_PX = 32;
/** 머리줄이 차지하는 높이 추정(px, 아래 간격 포함) — CardStage 맞춤 계산용. */
export const headerHeight = (fontPx = HEADER_MAX_PX): number => fontPx * 1.25 + 26 + 11 + 18; // 글줄 + 안쪽 여백 + 밑줄 + 아래 간격

export const CardStage: React.FC<{
  topPx?: number;
  /** 라벨 위 끝(px, 화면 위에서부터) — 카드가 넘으면 안 되는 선. */
  bottomPx: number;
  /** 카드 내용 추정 높이(px) — 띠보다 크면 그 비율로 줄인다. */
  estHeight: number;
  /** 예비 동작 배율(1 = 그대로) — 정답이 뜨기 직전 카드 전체가 살짝 움츠린다. */
  pulse?: number;
  children: React.ReactNode;
}> = ({ topPx, bottomPx, estHeight, pulse = 1, children }) => {
  const { width, height } = useVideoConfig();
  const top = Math.max(0, topPx ?? CARD_TOP_DEFAULT);
  const bottom = Math.min(height, Math.max(top + 200, bottomPx));
  const fit = Math.min(1, (bottom - top) / Math.max(1, estHeight));
  return (
    <AbsoluteFill>
      <div style={{
        position: 'absolute', top, height: bottom - top, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: Math.round(width * CARD_WIDTH), display: 'flex', flexDirection: 'column', alignItems: 'stretch',
          transform: `scale(${(fit * pulse).toFixed(4)})`, transformOrigin: 'center center',
        }}>
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 머리줄 글자 크기 — 한 줄 맞춤(상한 46, 하한 32). */
export const headerFontPx = (text: string, cardWidthPx: number): number =>
  Math.max(HEADER_MIN_PX, Math.min(HEADER_MAX_PX, fitCaption(text, HEADER_MAX_PX, cardWidthPx - 80, 1)));

/** 결론 한 줄 — at 프레임에 넘겼다 정착, 노란 밑줄이 6프레임 늦게 그어진다(안쪽 요소 시차). */
export const CardHeader: React.FC<{ text: string; at: number }> = ({ text, at }) => {
  const f = useCurrentFrame();
  const { width } = useVideoConfig();
  const size = headerFontPx(text, Math.round(width * CARD_WIDTH));
  const p = settleIn(f, at, 14);
  const o = smoothstep((f - at) / 6);
  const u = drawIn(f, at + 6, 10);
  return (
    <div style={{
      alignSelf: 'center', marginBottom: 18, maxWidth: '100%',
      background: 'rgba(0,0,0,.74)', borderRadius: 18, padding: '12px 30px 14px',
      opacity: o, transform: `translateY(${((1 - p) * 16).toFixed(2)}px) scale(${(0.96 + 0.04 * p).toFixed(4)})`,
    }}>
      <div style={{ fontSize: size, fontWeight: 800, color: '#fff', lineHeight: 1.25, whiteSpace: 'nowrap', textShadow: '0 2px 10px rgba(0,0,0,.6)' }}>{text}</div>
      <div style={{ height: 5, marginTop: 6, borderRadius: 3, background: '#ffd54a', transform: `scaleX(${u.toFixed(4)})`, transformOrigin: 'left center' }} />
    </div>
  );
};
