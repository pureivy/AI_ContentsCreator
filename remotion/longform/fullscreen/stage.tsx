// 전체 화면 장면 공용(2026-10-23, 스타일 스파이크 shared.tsx 를 제품화) — 1920×1080 무대(BaseStage), 실촬영 끼움 카드(FootageInset),
// 자막 띠(CaptionBand)·장 이름(ChapterTag), 글꼴, 박자 도우미. 그림 좌표 = 화면 픽셀(viewBox 1920×1080).
// 아래 18%(y ≥ CAPTION_TOP)는 자막 띠 — 장면은 그리지 않는다(무대가 잘라 내고, 검사(probe)가 잰다). 왼쪽 위는 장 이름 자리.
import React, { createContext, useContext } from 'react';
import { AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { FONT_FAMILY } from '../../loadFonts';
import batangUrl from './fonts/GowunBatang-Bold.sub.woff2';
import dodumUrl from './fonts/GowunDodum-Regular.sub.woff2';
import type { Word } from '../illus/sceneUtil';

export { beat, beatInOut, mix, atFromWords } from '../illus/sceneUtil';
export type { Word } from '../illus/sceneUtil';
export { random } from 'remotion';

export const W = 1920;
export const H = 1080;
/** 자막 띠 시작(화면 높이의 82%). 이 아래는 자막 띠만. */
export const CAPTION_TOP = 886;
/** 그림·라벨 안전 상자 — 장 이름(왼쪽 위)과 자막 띠를 피한다. */
export const SAFE = { x0: 90, y0: 120, x1: 1830, y1: 860 } as const;
/** 장 이름 자리(왼쪽 위) — 장면이 그리면 안 되는 상자. */
export const CHAPTER_ZONE = { x0: 0, y0: 0, x1: 760, y1: 110 } as const;
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// ── 글꼴: 고운바탕 Bold(스타일 A 라벨), 고운돋움(스타일 B 라벨). 웹팩 자산(부분 글꼴 woff2 — 한글 음절 전부 + 기호).
export const FONT_BATANG = '"Gowun Batang", "AppleMyungjo", serif';
export const FONT_DODUM = '"Gowun Dodum", Pretendard, sans-serif';
export const FONT_UI = FONT_FAMILY;
const fontHandle = delayRender('전체 화면 장면 글꼴(고운바탕·고운돋움)');
Promise.all([
  new FontFace('Gowun Batang', `url(${batangUrl}) format('woff2')`, { weight: '700' }).load().then((f) => { document.fonts.add(f); }),
  new FontFace('Gowun Dodum', `url(${dodumUrl}) format('woff2')`).load().then((f) => { document.fonts.add(f); }),
])
  .catch((e: unknown) => { console.warn('[폰트] 전체 화면 장면 글꼴 실패', e); })
  .then(() => { continueRender(fontHandle); });

export type Theme = {
  /** 바탕 종이 — 정적 SVG 문자열(필터 포함). <Img> 로 한 번 래스터화. */
  paperSvg: string;
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  labelFont: string;
  captionBand: string;
  captionInk: string;
};
export const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** 이 세그먼트의 실촬영(세로 폰 영상, 번들 public 에 놓인 파일 이름). 없으면 장면은 끼움 카드를 쓰지 못한다. */
export type Footage = { src: string; startFrom: number; durationInFrames: number };
/** 장면 컴포넌트 props. */
export type FullSceneProps = { durationInFrames: number; words?: Word[]; footage?: Footage };

/** 검사 모드 — probe 면 종이·자르기 없이 단색(PROBE_BG) 바탕에 그림만(자막 띠·장 이름 자리 침범을 잰다). */
export const PROBE_BG = '#ff00ff';
/** sceneScale(진행자 비온이가 켜졌을 때, 1 미만) — 종이는 그대로 두고 그림·끼움 카드 층만 (W, CAPTION_TOP) 기준으로 줄여 왼쪽 아래를 비운다. */
export const StageModeContext = createContext<{ probe: boolean; sceneScale?: number }>({ probe: false });

/**
 * 전체 화면 무대(스타일 키트가 테마를 넣어 FullStage 로 내보낸다). children = SVG 몸통(viewBox 1920×1080), labels = 글자·기호 층(필터 밖),
 * overlay = HTML 층(FootageInset). 카메라는 그림 층만 아주 천천히 당긴다(1 → 1.015, 자막 띠 위 가운데 기준). pan(px) = 가로로 옮겨 보기.
 */
export const BaseStage: React.FC<{
  frames: number; theme: Theme; defs?: React.ReactNode; svgFilter?: string; overlay?: React.ReactNode; labels?: React.ReactNode; pan?: number; children?: React.ReactNode;
}> = ({ frames, theme, defs, svgFilter, overlay, labels, pan = 0, children }) => {
  const f = useCurrentFrame();
  const { probe, sceneScale } = useContext(StageModeContext);
  const z = interpolate(f, [0, Math.max(1, frames)], [1, 1.015]);
  const cam = `translate(${W / 2} ${CAPTION_TOP / 2}) scale(${z}) translate(${-W / 2 + pan} ${-CAPTION_TOP / 2})`;
  // 그림·글자·끼움 카드 층(sceneScale 이면 이 층만 줄인다).
  const layers = (probe: boolean): React.ReactNode => (<>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, width: W, height: H, overflow: 'visible' }}>
        <defs>
          {defs}
          <clipPath id="fs-stage-clip"><rect x={0} y={0} width={W} height={CAPTION_TOP} /></clipPath>
        </defs>
        <g {...(probe ? {} : { clipPath: 'url(#fs-stage-clip)' })}>
          <g transform={cam}>
            <g {...(svgFilter && !probe ? { filter: svgFilter } : {})}>{children}</g>
            <g>{labels}</g>
          </g>
        </g>
      </svg>
      {overlay ? <AbsoluteFill style={probe ? {} : { clipPath: `inset(0 0 ${H - CAPTION_TOP}px 0)` }}>{overlay}</AbsoluteFill> : null}
    </>);
  return (
    <AbsoluteFill style={{ background: probe ? PROBE_BG : theme.paper, fontFamily: theme.labelFont, wordBreak: 'keep-all' }}>
      {probe ? null : <Img src={svgUri(theme.paperSvg)} style={{ position: 'absolute', inset: 0, width: W, height: H }} />}
      {!probe && sceneScale != null && sceneScale !== 1 ? (
        <AbsoluteFill style={{ transform: `scale(${sceneScale})`, transformOrigin: `${W}px ${CAPTION_TOP}px` }}>{layers(false)}</AbsoluteFill>
      ) : layers(probe)}
    </AbsoluteFill>
  );
};

/**
 * 실촬영 끼움 카드 — 세로 9:16 폰 영상을 사진 카드처럼. 문장이 '실제 모습·상태·크기·색·질감'을 말할 때만.
 * x,y = 카드 중심(화면 픽셀). h = 카드 높이(기본 440). at 에 떠오르고 until 에 가라앉는다. footage 가 없으면 아무것도 그리지 않는다.
 * 영상은 카드가 나타나는 순간부터 재생(footage.startFrom 초 지점부터).
 */
export const FootageInset: React.FC<{ footage?: Footage; x: number; y: number; at: number; until?: number; h?: number; frame?: string; tilt?: number }> = ({ footage, x, y, at, until, h = 440, frame = '#fbf8f1', tilt = -1.6 }) => {
  const f = useCurrentFrame();
  const { probe } = useContext(StageModeContext);
  if (!footage) return null;
  const inP = interpolate(f, [at, at + 20], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const outP = until == null ? 0 : interpolate(f, [until, until + 14], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  if (inP <= 0 || outP >= 1) return null;
  const w = Math.round((h * 9) / 16);
  const pad = 9;
  const o = inP * (1 - outP);
  const ty = (1 - inP) * 46 + outP * 30;
  const rot = tilt * (1 - inP) * 1.8 + tilt * 0.35;
  const sc = 0.94 + 0.06 * inP;
  return (
    <div style={{ position: 'absolute', left: x - w / 2 - pad, top: y - h / 2 - pad, width: w + pad * 2, height: h + pad * 2, opacity: o,
      transform: `translateY(${ty}px) rotate(${rot}deg) scale(${sc})`, transformOrigin: '50% 80%',
      background: frame, borderRadius: 26, padding: pad, boxSizing: 'border-box',
      boxShadow: '0 22px 44px rgba(52,40,26,.28), 0 4px 10px rgba(52,40,26,.18)' }}>
      <div style={{ width: w, height: h, borderRadius: 19, overflow: 'hidden', background: '#2a2a2a' }}>
        {probe ? null : (
          <Sequence from={at} layout="none">
            <OffthreadVideo src={staticFile(footage.src)} startFrom={Math.round(footage.startFrom * 30)} muted style={{ width: w, height: h, objectFit: 'cover' }} />
          </Sequence>
        )}
      </div>
    </div>
  );
};

/** 장 이름(왼쪽 위) — LongFormFull·미리보기가 그린다(장면은 그리지 않는다). */
export const ChapterTag: React.FC<{ index: number; total: number; title: string; theme: Theme }> = ({ index, total, title, theme }) => (
  <div style={{ position: 'absolute', left: 64, top: 44, display: 'flex', alignItems: 'baseline', gap: 16, fontFamily: theme.labelFont }}>
    <span style={{ fontSize: 30, fontWeight: 700, color: theme.accent, fontFamily: FONT_UI }}>{String(index + 1).padStart(2, '0')}<span style={{ color: theme.muted }}> / {String(total).padStart(2, '0')}</span></span>
    <span style={{ fontSize: 31, fontWeight: 700, color: theme.ink, opacity: 0.78 }}>{title}</span>
  </div>
);

export type CaptionCue = { text: string; startFrame: number; endFrame: number };

/**
 * 자막 띠 — 타임라인 구절 자막(세그먼트 기준 프레임, 줄바꿈 '\n' 포함)을 지금 프레임에 맞춰 바꾼다(InfoPanel Caption 과 같은 고르기·맞춤 산식).
 * 구절이 바뀔 때 살짝 떠오르며 들어온다. 강조어(keywords)는 테마 포인트 색.
 */
export const CaptionBand: React.FC<{ captions: CaptionCue[]; theme: Theme; keywords?: readonly string[] }> = ({ captions, theme, keywords }) => {
  const f = useCurrentFrame();
  const c = captions.find((x) => f >= x.startFrame && f < x.endFrame) ?? captions[captions.length - 1];
  const lineLen = (l: string) => l.replace(/\s/g, '').length + l.split(' ').length * 0.35;
  const longest = captions.reduce((m, x) => Math.max(m, ...x.text.split('\n').map(lineLen)), 0);
  const twoLines = captions.some((x) => x.text.includes('\n'));
  const size = Math.max(40, Math.min(twoLines ? 54 : 58, Math.floor(1760 / Math.max(1, longest * 1.02))));
  const t = c ? f - c.startFrame : 0;
  const o = interpolate(t, [0, 5], [0, 1], clamp);
  const dy = interpolate(t, [0, 7], [10, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const hot = (keywords ?? []).filter((k) => k.length >= 2);
  const renderLine = (line: string, li: number) => {
    if (!hot.length) return <div key={li} style={{ whiteSpace: 'nowrap' }}>{line}</div>;
    const rx = new RegExp(`(${hot.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    return <div key={li} style={{ whiteSpace: 'nowrap' }}>{line.split(rx).map((p, i) => (i % 2 ? <span key={i} style={{ color: theme.accent }}>{p}</span> : <span key={i}>{p}</span>))}</div>;
  };
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: CAPTION_TOP, bottom: 0, background: theme.captionBand, borderTop: `1.5px solid ${theme.muted}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {c ? (
        <div style={{ fontFamily: FONT_UI, fontWeight: 800, fontSize: size, lineHeight: 1.22, textAlign: 'center', color: theme.captionInk, letterSpacing: -0.5, opacity: o, transform: `translateY(${dy}px)` }}>
          {c.text.split('\n').map(renderLine)}
        </div>
      ) : null}
    </div>
  );
};
