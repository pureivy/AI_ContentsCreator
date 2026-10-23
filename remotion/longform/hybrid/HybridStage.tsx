// 혼합(H) 롱폼 견본 무대(2026-10-23, 옵트인 — 본편 기본값 아님). 문장마다 세 갈래 화면을 섞는다:
//  card(숏폼 모션그래픽 정보 카드 — 흐린 실촬영 바탕 + 유리 카드) · diagram(스타일 B 연필 도해, fullscreen/styleB 그대로) · footage(실촬영 전체 화면).
// 이 파일: 공용 색(HY — 연필 도해의 미색·흑연 + 포인트 색 하나, 숏폼 카드와 같은 계열), 카드 무대(CardStage), 장 이름 알약(HybridChapterTag).
// 아래 18%(y ≥ 886)는 자막 띠(fullscreen/stage CaptionBand 를 그대로 쓴다), 왼쪽 위는 장 이름 — 카드 무대는 y 120~860 안에만 그린다.
import React, { useContext } from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { CAPTION_TOP, FONT_UI, H, PROBE_BG, StageModeContext, W, clamp, type Footage } from '../fullscreen/stage';

/**
 * 공용 색 — 스타일 B 종이(#f5f2ea)·흑연(#262524)·포인트(#e0523a, 감 주황빨강)와 같은 값.
 * 숏폼 정보 카드(info-card-ref "유리 + 알약")의 강조색 자리에 이 포인트 색을 넣는다 — 도해와 카드가 한 색으로 이어진다.
 */
export const HY = {
  paper: '#f5f2ea', ink: '#262524', ink2: '#4a4845', muted: '#8f8b84', accent: '#e0523a', accentDeep: '#c4432c', accentWash: '#f6c9bb',
  glass: 'rgba(255,255,255,.30)', glassEdge: 'rgba(255,255,255,.78)', pill: 'rgba(255,255,255,.82)', pillDim: 'rgba(255,255,255,.55)',
} as const;
export const FONT_CARD = FONT_UI;
/** 카드 무대 안전 상자(화면 픽셀) — 카드·글자는 이 안에만. */
export const CARD_SAFE = { x0: 90, y0: 120, x1: 1830, y1: 860 } as const;
export const useProbe = (): boolean => useContext(StageModeContext).probe;

/** 흐린 실촬영 바탕(가로 흐림본 — hybrid_footage.ts 가 만든 H-<seg>-bg.mp4). 살짝 당겨(1.08) 흐림 가장자리를 숨기고 어둡게 덮는다. */
export const BlurBackdrop: React.FC<{ footage?: Footage; frames: number; dim?: number }> = ({ footage, frames, dim = 0.3 }) => {
  const f = useCurrentFrame();
  const z = interpolate(f, [0, Math.max(1, frames)], [1.08, 1.13], clamp);
  return (
    <AbsoluteFill style={{ background: '#3b4032', overflow: 'hidden' }}>
      {footage ? (
        <Sequence layout="none">
          <OffthreadVideo src={staticFile(footage.src)} startFrom={Math.round(footage.startFrom * 30)} muted
            style={{ position: 'absolute', inset: 0, width: W, height: H, objectFit: 'cover', transform: `scale(${z})` }} />
        </Sequence>
      ) : null}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(24,22,18,${dim * 0.9}) 0%, rgba(24,22,18,${dim * 0.55}) 45%, rgba(24,22,18,${dim * 1.25}) 100%)` }} />
    </AbsoluteFill>
  );
};

/**
 * 카드 무대 — 흐린 실촬영 바탕(footage = 이 문장의 흐림본) 위에 카드들. children 은 HTML(카드 부품)이고 안전 상자(x 90~1830, y 120~860)
 * 안 가운데 정렬된다(세로 쌓기, gap 28). layout="row" 면 가로로 놓는다. 검사 모드(probe)면 단색 바탕에 카드만.
 */
export const CardStage: React.FC<{ frames: number; footage?: Footage; layout?: 'column' | 'row'; gap?: number; dim?: number; children?: React.ReactNode }> = ({ frames, footage, layout = 'column', gap = 28, dim, children }) => {
  const probe = useProbe();
  return (
    <AbsoluteFill style={{ background: probe ? PROBE_BG : '#3b4032', fontFamily: FONT_CARD, wordBreak: 'keep-all' }}>
      {probe ? null : <BlurBackdrop footage={footage} frames={frames} {...(dim != null ? { dim } : {})} />}
      <div style={{ position: 'absolute', left: CARD_SAFE.x0, top: CARD_SAFE.y0, width: CARD_SAFE.x1 - CARD_SAFE.x0, height: CARD_SAFE.y1 - CARD_SAFE.y0,
        display: 'flex', flexDirection: layout, alignItems: 'center', justifyContent: 'center', gap }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** 장 이름 알약(왼쪽 위) — 종이·실촬영 어느 바탕에서도 읽히게 미색 알약 위에. 혼합 합성·미리보기가 그린다(장면은 그리지 않는다). */
export const HybridChapterTag: React.FC<{ index: number; total: number; title: string }> = ({ index, total, title }) => (
  <div style={{ position: 'absolute', left: 52, top: 36, display: 'flex', alignItems: 'baseline', gap: 14, padding: '10px 26px 12px', borderRadius: 999,
    background: 'rgba(245,242,234,.9)', boxShadow: '0 6px 18px rgba(30,26,20,.16)', fontFamily: FONT_UI }}>
    <span style={{ fontSize: 28, fontWeight: 800, color: HY.accent }}>{String(index + 1).padStart(2, '0')}<span style={{ color: HY.muted }}> / {String(total).padStart(2, '0')}</span></span>
    <span style={{ fontSize: 29, fontWeight: 800, color: HY.ink, opacity: 0.86 }}>{title}</span>
  </div>
);

export { CAPTION_TOP };
