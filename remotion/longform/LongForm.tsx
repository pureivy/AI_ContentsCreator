// 롱폼 시범 컴포지션(1920×1080) — 왼쪽 세로 패널(실촬영 또는 정지 화면), 오른쪽 장 이름·카드/도해·구절 자막(가운데 정렬).
// 영상 위에는 아무 효과도 덮지 않는다(사장님 지시 2026-10-19). 남긴 것: 장면 전환(페이드·밀어올림·닦아내기·확대·
// 아이리스·줌 스루), 중간 컷, 장 전환 빛샘(장 제목 위), 자막 움직임, 영상 전체 색보정, 켄 번스, 그림 애니메이션.
import React, { useContext } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, random, staticFile, useCurrentFrame } from 'remotion';
import { Video } from '@remotion/media';
import { FONT_FAMILY } from '../loadFonts';
import { filmLookEffects, pickFilmLook } from '../filmLook';
import { CutFlash } from '../CutFlash';
import { Diagram } from './Diagrams';
import { ACCENT, Caption, INK, InfoCard, MUTED } from './InfoPanel';
import { PANEL_H, PANEL_W, usePanelWrapStyle } from './Fx';
import { TITLE_FONT } from './titleFont';
import { ErrorBoundary } from './scenes/SceneStage';
import { SceneRegistryContext } from './scenes/registry';
import type { LfChapter, LfSegment, LongFormProps } from './types';

const BG = '#14130f';
const PANEL = { x: 72, y: 36, w: PANEL_W, h: PANEL_H };
const INFO_X = PANEL.x + PANEL.w + 60;
const INFO_W = 1920 - INFO_X - 60;

type Effects = ReturnType<typeof filmLookEffects>;

const ChapterLabel: React.FC<{ index: number; total: number; title: string }> = ({ index, total, title }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, justifyContent: 'center' }}>
    <div style={{ fontSize: 30, fontWeight: 800, color: ACCENT }}>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</div>
    <div style={{ fontSize: 30, fontWeight: 700, color: MUTED }}>{title}</div>
  </div>
);

const BlurPoster: React.FC<{ src?: string; frames: number }> = ({ src, frames }) => {
  const frame = useCurrentFrame();
  if (!src) return <AbsoluteFill style={{ background: BG }} />;
  const scale = interpolate(frame, [0, frames], [1.12, 1.2]);
  return (
    <AbsoluteFill>
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px) brightness(.42)', transform: `scale(${scale})` }} />
    </AbsoluteFill>
  );
};

/** 패널 안 미디어 — 실촬영(중간 컷 포함) 또는 정지 화면. 필름 룩 + 기법 효과(컬러 팝·소프트 글로우)를 입힌다. */
const PanelMedia: React.FC<{ s: LfSegment; look: Effects }> = ({ s, look }) => {
  const frame = useCurrentFrame();
  // 영상 위 효과(컬러 팝·글로우 등)는 쓰지 않는다(사장님 지시 2026-10-19) — 영상 전체 색보정(필름 룩)만.
  const effects = look;
  // 켄 번스 — 세그먼트마다 위·아래 번갈아. 정지 강조·좌표 기법은 배경을 멈춘다(숏폼 frozen/pinned 와 같은 규칙).
  const zoom = interpolate(frame, [0, s.frames], [1, 1.08]);
  const origin = random(s.id) > 0.5 ? '50% 30%' : '50% 70%';
  const fill: React.CSSProperties = { width: '100%', height: '100%' };
  let media: React.ReactNode = null;
  if (s.clip && s.clip2 && s.cutAtFrame) {
    media = (
      <>
        <Sequence durationInFrames={s.cutAtFrame} layout="none"><Video src={staticFile(s.clip)} muted objectFit="cover" style={fill} effects={effects} /></Sequence>
        <Sequence from={s.cutAtFrame} layout="none"><Video src={staticFile(s.clip2)} muted objectFit="cover" style={fill} effects={effects} /></Sequence>
      </>
    );
  } else if (s.clip) {
    media = <Video src={staticFile(s.clip)} muted objectFit="cover" style={fill} effects={effects} />;
  } else if (s.still) {
    media = <Img src={staticFile(s.still)} style={{ ...fill, objectFit: 'cover' }} effects={effects} />;
  }
  return <div style={{ ...fill, transform: `scale(${zoom})`, transformOrigin: origin }}>{media}</div>;
};

const TopTitle: React.FC<{ text: string; x: number; w: number }> = ({ text, x, w }) => {
  const frame = useCurrentFrame();
  const line = interpolate(frame, [6, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const o = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: x, width: w, top: 150, textAlign: 'center', fontFamily: TITLE_FONT, fontSize: 92, color: INK, opacity: o, textShadow: '0 4px 24px rgba(0,0,0,.6)' }}>
      {text}
      <div style={{ height: 8, width: 520, margin: '18px auto 0', borderRadius: 4, background: ACCENT, transformOrigin: 'left', transform: `scaleX(${line})` }} />
    </div>
  );
};

const Scene: React.FC<{ s: LfSegment; chapters: number; motion: string; look: Effects; exitZoom: boolean; keywords?: string[] }> = ({ s, chapters, motion, look, exitZoom, keywords }) => {
  const wrap = usePanelWrapStyle({ tech: s.tech, enter: s.enter, seed: s.id, frames: s.frames, exitZoom });
  const hasPanel = !!(s.clip || s.still);
  // 문장 그림 장면(2026-10-22) — 등록표에 있는 키만. 없으면(시범 진입점·검사 탈락) 종전대로 mg·카드.
  const registry = useContext(SceneRegistryContext);
  const SceneComp = s.scene ? registry[s.scene] : undefined;
  const visual = SceneComp ? 'scene' : s.mg ? 'mg' : s.card ? 'card' : null;
  const infoX = hasPanel ? INFO_X : 120;
  const infoW = hasPanel ? INFO_W : 1680;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <BlurPoster src={s.poster} frames={s.frames} />
      {hasPanel ? (
        <div style={{ position: 'absolute', left: PANEL.x, top: PANEL.y, width: PANEL.w, height: PANEL.h, borderRadius: 28, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
          <div style={{ position: 'absolute', inset: 0, ...wrap }}>
            <PanelMedia s={s} look={look} />
          </div>
        </div>
      ) : null}
      {s.topTitle ? <TopTitle text={s.topTitle} x={infoX} w={infoW} /> : null}
      <div style={{ position: 'absolute', left: infoX, width: infoW, top: 72 }}>
        <ChapterLabel index={s.chapterIndex} total={chapters} title={s.chapterTitle} />
      </div>
      {visual ? (
        <div style={{ position: 'absolute', left: infoX, top: 150, width: infoW, height: 680, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {visual === 'scene' && SceneComp ? (
            // 도해와 같은 칸(높이 680, 가운데). 폭은 장면 viewBox(1000×620) 비율 그대로 — 무대 바탕색 띠가 옆에 생기지 않게.
            // position:relative — 장면의 AbsoluteFill 이 이 칸을 채운다. 장면이 던지면 칸만 비운다(실촬영·자막은 그대로), 렌더 로그에 키.
            <div style={{ position: 'relative', width: Math.min(infoW, Math.round(680 * 1000 / 620)), height: 680 }}>
              <ErrorBoundary fallback={null} onError={(e) => console.error(`[장면 오류] ${s.scene}: ${e.message}`)}>
                <SceneComp durationInFrames={s.frames} {...(s.sceneWords ? { words: s.sceneWords } : {})} />
              </ErrorBoundary>
            </div>
          ) : visual === 'mg' ? (
            <div style={{ width: Math.min(infoW, 1100), height: 680 }}>
              <Sequence from={-(s.mgOffset ?? 0)} layout="none"><Diagram mg={s.mg!} frames={s.mgChainFrames ?? s.frames} /></Sequence>
            </div>
          ) : <InfoCard card={s.card!} animate={s.cardIsNew} focus={s.focusItem} />}
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: infoX, width: infoW, ...(visual ? { bottom: 70 } : { top: s.topTitle ? 260 : 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }) }}>
        <Caption captions={s.captions} size={visual ? 54 : 76} motion={motion} pop={s.tech === '키워드 팝'} width={infoW - 40} keywords={keywords} />
      </div>
    </AbsoluteFill>
  );
};

/** 낙엽 — 장 제목 카드 위로 천천히 떨어진다('잎이 진 뒤'라는 이 편의 주제). */
const Leaves: React.FC<{ seed: string; frames: number }> = ({ seed, frames }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 14 }, (_, i) => {
        const x = random(`${seed}x${i}`) * 1920;
        const speed = 3 + random(`${seed}v${i}`) * 4;
        const y = -80 + (frame + random(`${seed}y${i}`) * frames) * speed % 1200;
        const sway = Math.sin((frame + i * 13) / 12) * 40;
        const rot = (frame * (2 + i % 3) + i * 40) % 360;
        const hue = ['#c8873a', '#d9a441', '#a85d32', '#e0b45a'][i % 4];
        return <div key={i} style={{ position: 'absolute', left: x + sway, top: y, width: 34, height: 20, borderRadius: '100% 0 100% 0', background: hue, opacity: 0.85, transform: `rotate(${rot}deg)` }} />;
      })}
    </AbsoluteFill>
  );
};

const ChapterCard: React.FC<{ c: LfChapter; total: number; title: string }> = ({ c, total, title }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 10, c.frames - 8, c.frames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const wipe = interpolate(frame, [0, 14], [100, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG }}>
      <BlurPoster src={c.poster} frames={c.frames} />
      <Leaves seed={`ch${c.index}`} frames={c.frames} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', opacity: o, clipPath: `inset(0 ${wipe}% 0 0)` }}>
        <div style={{ fontSize: 34, fontWeight: 700, color: MUTED, marginBottom: 24 }}>{title}</div>
        <div style={{ fontSize: 150, fontWeight: 800, color: ACCENT, lineHeight: 1 }}>{String(c.index + 1).padStart(2, '0')}<span style={{ fontSize: 60, color: MUTED }}> / {String(total).padStart(2, '0')}</span></div>
        <div style={{ fontSize: 84, fontWeight: 800, color: INK, marginTop: 30, lineHeight: 1.2 }}>{c.title}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const ChapterProgress: React.FC<{ chapters: LfChapter[]; totalFrames: number }> = ({ chapters, totalFrames }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 8, display: 'flex', gap: 4 }}>
      {chapters.map((c, i) => {
        const end = chapters[i + 1]?.startFrame ?? totalFrames;
        const p = Math.min(1, Math.max(0, (frame - c.startFrame) / (end - c.startFrame)));
        return (
          <div key={i} style={{ flex: end - c.startFrame, background: 'rgba(246,241,231,.15)' }}>
            <div style={{ width: `${p * 100}%`, height: '100%', background: ACCENT }} />
          </div>
        );
      })}
    </div>
  );
};

export const LongForm: React.FC<LongFormProps> = ({ title, lookSeed, chapterMotions, totalFrames, chapters, segments, keywords }) => {
  // 필름 룩 — 영상 전체에 하나(숏폼은 편마다 하나). 실촬영 여러 파일의 색을 한 결로 묶는다.
  const look = filmLookEffects(pickFilmLook(lookSeed));
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT_FAMILY, wordBreak: 'keep-all' }}>
      {chapters.map((c) => (
        <Sequence key={`c${c.index}`} from={c.startFrame} durationInFrames={c.frames}>
          <ChapterCard c={c} total={chapters.length} title={title} />
        </Sequence>
      ))}
      {segments.map((s, i) => (
        <Sequence key={s.id} from={s.startFrame} durationInFrames={s.frames}>
          <Scene s={s} chapters={chapters.length} motion={chapterMotions[s.chapterIndex] ?? '튀어오름'} look={look} keywords={keywords}
            exitZoom={segments[i + 1]?.tech === '줌 스루 전환' && segments[i + 1]?.startFrame === s.startFrame + s.frames} />
          <Audio src={staticFile(s.audio)} />
        </Sequence>
      ))}
      {/* 컷 플래시 — 장이 바뀌는 자리마다 빛샘이 스친다(숏폼 컷 오버레이와 같은 장치). */}
      {chapters.slice(1).map((c) => (
        <Sequence key={`f${c.index}`} from={c.startFrame} durationInFrames={12}>
          <CutFlash cutIndex={c.index} seed={lookSeed} hueShift={30} strength={0.3} />
        </Sequence>
      ))}
      <ChapterProgress chapters={chapters} totalFrames={totalFrames} />
    </AbsoluteFill>
  );
};
