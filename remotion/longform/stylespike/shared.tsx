// 스타일 스파이크 공용 — 1920×1080 전체 화면 무대(FullStage), 실촬영 끼움 카드(FootageInset), 박자 도우미, 글꼴.
// 그림 좌표 = 화면 픽셀(viewBox 1920×1080). 아래 18%(y ≥ CAPTION_TOP)는 자막 자리 — 그림·라벨을 두지 않는다.
import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, Sequence, continueRender, delayRender, getInputProps, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { FONT_FAMILY } from '../../loadFonts';

export { beat, beatInOut, mix, atFromWords } from '../illus/sceneUtil';
export type { Word } from '../illus/sceneUtil';

export const W = 1920;
export const H = 1080;
/** 자막 칸 시작(화면 높이의 82%). 이 아래에는 자막 띠만. */
export const CAPTION_TOP = 886;
/** 그림·라벨 안전 상자 — 장 이름(왼쪽 위)과 자막 칸을 피한다. */
export const SAFE = { x0: 90, y0: 120, x1: 1830, y1: 860 } as const;
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// ── 글꼴: 고운바탕 Bold(세밀화 도해 라벨), 고운돋움(연필 선화 라벨). 스파이크 publicDir 에서 싣는다.
export const FONT_BATANG = '"Gowun Batang", "AppleMyungjo", serif';
export const FONT_DODUM = '"Gowun Dodum", Pretendard, sans-serif';
export const FONT_UI = FONT_FAMILY;
const fontHandle = delayRender('스타일 스파이크 글꼴');
Promise.all([
  new FontFace('Gowun Batang', `url(${staticFile('fonts/GowunBatang-Bold.ttf')}) format('truetype')`, { weight: '700' }).load().then((f) => { document.fonts.add(f); }),
  new FontFace('Gowun Dodum', `url(${staticFile('fonts/GowunDodum-Regular.ttf')}) format('truetype')`).load().then((f) => { document.fonts.add(f); }),
])
  .catch((e: unknown) => { console.warn('[폰트] 스파이크 글꼴 실패', e); })
  .then(() => { continueRender(fontHandle); });

/** 측정용 — inputProps.noFilter 면 그림 층 필터를 끈다(필터 비용 재기). */
const NO_FILTER = Boolean((getInputProps() as { noFilter?: boolean }).noFilter);

export type Theme = {
  /** 바탕 종이 — 정적 SVG 문자열(필터 포함). <Img> 로 한 번 래스터화돼 프레임마다 다시 계산하지 않는다. */
  paperSvg: string;
  ink: string;
  muted: string;
  accent: string;
  labelFont: string;
  captionBand: string;
  captionInk: string;
};

export const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export type CaptionPart = { text: string; from: number };

/** 자막 띠 — 실제로는 LongForm 이 그린다. 스파이크에선 최종 모습을 보이려고 문장 구절을 박자에 맞춰 바꾼다. */
const CaptionBar: React.FC<{ parts: CaptionPart[]; theme: Theme }> = ({ parts, theme }) => {
  const f = useCurrentFrame();
  let cur = parts[0]!;
  for (const p of parts) if (f >= p.from) cur = p;
  const t = f - cur.from;
  const o = interpolate(t, [0, 5], [0.0, 1], clamp);
  const dy = interpolate(t, [0, 7], [10, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: CAPTION_TOP, bottom: 0, background: theme.captionBand, borderTop: `1.5px solid ${theme.muted}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: FONT_UI, fontWeight: 800, fontSize: 58, color: theme.captionInk, letterSpacing: -0.5, opacity: o, transform: `translateY(${dy}px)`, whiteSpace: 'nowrap' }}>{cur.text}</div>
    </div>
  );
};

const ChapterTag: React.FC<{ index: number; total: number; title: string; theme: Theme }> = ({ index, total, title, theme }) => (
  <div style={{ position: 'absolute', left: 64, top: 44, display: 'flex', alignItems: 'baseline', gap: 16, fontFamily: theme.labelFont }}>
    <span style={{ fontSize: 30, fontWeight: 700, color: theme.accent, fontFamily: FONT_UI }}>{String(index).padStart(2, '0')}<span style={{ color: theme.muted }}> / {String(total).padStart(2, '0')}</span></span>
    <span style={{ fontSize: 31, color: theme.ink, opacity: 0.78 }}>{title}</span>
  </div>
);

/**
 * 전체 화면 무대. children = SVG 몸통(viewBox 1920×1080). overlay = HTML 층(실촬영 카드 등).
 * 카메라는 그림 층만 아주 천천히 당긴다(1 → 1.015, 자막 칸 위 가운데 기준). pan(px) = 가로로 옮겨 보기(장면 후반 주인공을 가운데로).
 * labels = 글자·번호·표시 층(필터 밖).
 */
export const FullStage: React.FC<{
  frames: number; theme: Theme; defs?: React.ReactNode; chapter: { index: number; total: number; title: string };
  caption: CaptionPart[]; overlay?: React.ReactNode; svgFilter?: string; labels?: React.ReactNode; pan?: number; children: React.ReactNode;
}> = ({ frames, theme, defs, chapter, caption, overlay, svgFilter, labels, pan = 0, children }) => {
  const f = useCurrentFrame();
  const z = interpolate(f, [0, frames], [1, 1.015]);
  return (
    <AbsoluteFill style={{ background: '#efe9dc', fontFamily: theme.labelFont, wordBreak: 'keep-all' }}>
      <Img src={svgUri(theme.paperSvg)} style={{ position: 'absolute', inset: 0, width: W, height: H }} />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, width: W, height: H, overflow: 'visible' }}>
        <defs>{defs}</defs>
        <g transform={`translate(${W / 2} ${CAPTION_TOP / 2}) scale(${z}) translate(${-W / 2 + pan} ${-CAPTION_TOP / 2})`}>
          <g {...(svgFilter && !NO_FILTER ? { filter: svgFilter } : {})}>{children}</g>
          {/* 글자·기호 층 — 필터(떨림·흑연 결) 밖이라 늘 또렷하다 */}
          <g>{labels}</g>
        </g>
      </svg>
      {overlay}
      <ChapterTag {...chapter} theme={theme} />
      <CaptionBar parts={caption} theme={theme} />
    </AbsoluteFill>
  );
};

/**
 * 실촬영 끼움 카드 — 세로 9:16 폰 영상. 문장이 '실제 모습'을 말할 때만 쓴다.
 * x,y = 카드 중심. h = 카드 높이(기본 400 = 화면 37%). at 에 부드럽게 떠오르고 until 에 가라앉는다.
 * 영상은 카드가 나타나는 순간부터 재생(startFrom 초 지점부터).
 */
export const FootageInset: React.FC<{
  src: string; x: number; y: number; at: number; until?: number; h?: number; startFrom?: number; frame?: string; tilt?: number;
}> = ({ src, x, y, at, until, h = 400, startFrom = 0, frame = '#fbf8f1', tilt = -1.6 }) => {
  const f = useCurrentFrame();
  const inP = interpolate(f, [at, at + 20], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const outP = until == null ? 0 : interpolate(f, [until, until + 14], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  if (inP <= 0 || outP >= 1) return null;
  const w = Math.round((h * 9) / 16);
  const pad = 8;
  const o = inP * (1 - outP);
  const ty = (1 - inP) * 46 + outP * 30;
  const rot = tilt * (1 - inP) * 1.8 + tilt * 0.35;
  const sc = 0.94 + 0.06 * inP;
  return (
    <div style={{ position: 'absolute', left: x - w / 2 - pad, top: y - h / 2 - pad, width: w + pad * 2, height: h + pad * 2, opacity: o,
      transform: `translateY(${ty}px) rotate(${rot}deg) scale(${sc})`, transformOrigin: '50% 80%',
      background: frame, borderRadius: 26, padding: pad, boxSizing: 'border-box',
      boxShadow: '0 22px 44px rgba(52,40,26,.28), 0 4px 10px rgba(52,40,26,.18)' }}>
      <div style={{ width: w, height: h, borderRadius: 19, overflow: 'hidden', background: '#222' }}>
        <Sequence from={at} layout="none">
          <OffthreadVideo src={staticFile(src)} startFrom={Math.round(startFrom * 30)} muted style={{ width: w, height: h, objectFit: 'cover' }} />
        </Sequence>
      </div>
    </div>
  );
};

/** 결정적 의사난수 0~1(seed 문자열 + 번호). remotion random 을 감싼다. */
export { random } from 'remotion';
