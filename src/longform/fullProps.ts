/**
 * 전체 화면 롱폼(LongFormFull, 2026-10-23 견본 — 아직 본편 기본값 아님) props(순수).
 * 장면이 화면 전체를 쓰고, 실촬영은 장면이 고른 박자에 끼움 카드로만 나온다. 아래 18% 자막 띠, 왼쪽 위 장 이름.
 * remotion/longform/fullscreen 이 이 타입을 쓴다(루트 tsc rootDir=src 라 정의는 이쪽 — types.ts 와 같은 이유).
 */
import { approxWords, type Word } from './sceneRules';
import { FPS, GAP_SEC, type Timeline, type TimedSegment } from './timeline';
import type { PresenterSeason } from './presenter';
import type { BioneeCue } from './bioneeCues';

export type FullStyle = 'A' | 'B';
export type FullFootage = { src: string; startFrom: number; durationInFrames: number };

export interface FullSegment {
  id: string; chapterIndex: number; chapterTitle: string; startFrame: number; frames: number; audio: string;
  captions: Array<{ text: string; startFrame: number; endFrame: number }>;
  scene?: string; sceneWords?: Word[];
  /** 장면이 끼움 카드로 띄울 수 있는 실촬영(그 장 수종과 같은 영상만). */
  footage?: FullFootage;
  /** 진행자 비온이(props.presenter 가 있을 때만) — 이 세그먼트의 비온이 신호(장면 좌표·세그먼트 초, 2026-10-23 코드 리그)·프레임당 입 열림(0~9). */
  bionee?: BioneeCue[];
  mouth?: number[];
}
export interface FullChapter { index: number; title: string; startFrame: number; frames: number }

export type LongFormFullProps = {
  title: string;
  style: FullStyle;
  totalFrames: number;
  /** 장 번호 표시의 분모 — 견본(편 일부)이면 원래 편의 장 수. 없으면 chapters.length. */
  chapterTotal?: number;
  chapters: FullChapter[];
  segments: FullSegment[];
  keywords?: string[];
  /** 진행자 비온이(LONGFORM_PRESENTER, 기본 꺼짐) — 없으면 그리지 않는다(종전과 같은 화면). sceneScale = 장면을 오른쪽 위로 줄여 왼쪽 아래 자리를 비우는 비율(1 = 줄이지 않음). */
  presenter?: { season: PresenterSeason; sceneScale: number; /** 비온이 크기(리그 배율, 없으면 BIONEE_SCALE) */ hostScale?: number };
};

/** 세그먼트 → 끼움 카드용 실촬영(순수) — 클립이 있고 그 영상 수종이 그 장 수종에 들 때만(다른 수종 화면을 감나무 문장 옆에 두지 않는다). */
export function footageOf(s: TimedSegment, chapterSpecies: readonly string[], mediaSpecies: (id: string) => string | undefined): FullFootage | undefined {
  if (!s.clip || !('mediaId' in s.shot)) return undefined;
  const sp = mediaSpecies(s.shot.mediaId);
  if (!sp || !chapterSpecies.includes(sp)) return undefined;
  return { src: s.clip, startFrom: 0, durationInFrames: s.frames };
}

/** 타임라인 → LongFormFull props(순수). footage: 세그먼트 id → 실촬영(footageOf 결과). */
export function toFullProps(title: string, tl: Timeline, o: {
  style: FullStyle; footage?: ReadonlyMap<string, FullFootage>; chapterTotal?: number; keywords?: string[];
  /** 진행자 — 세그먼트 id → 신호·입 열림. 없으면 props 는 종전과 똑같다. */
  presenter?: { season: PresenterSeason; sceneScale: number; hostScale?: number; cues: ReadonlyMap<string, BioneeCue[]>; mouth: ReadonlyMap<string, number[]> };
}): LongFormFullProps {
  const chapterIndex = new Map(tl.chapterStarts.map((c, i) => [c.id, i]));
  return {
    title, style: o.style, totalFrames: tl.totalFrames,
    ...(o.chapterTotal ? { chapterTotal: o.chapterTotal } : {}),
    ...(o.keywords?.length ? { keywords: o.keywords } : {}),
    ...(o.presenter ? { presenter: { season: o.presenter.season, sceneScale: o.presenter.sceneScale, ...(o.presenter.hostScale ? { hostScale: o.presenter.hostScale } : {}) } } : {}),
    chapters: tl.chapterStarts.map((c, i) => ({ index: i, title: c.title, startFrame: c.startFrame, frames: c.frames })),
    segments: tl.segments.map((s) => {
      const ft = o.footage?.get(s.id);
      const bionee = o.presenter?.cues.get(s.id);
      const mouth = o.presenter?.mouth.get(s.id);
      return {
        id: s.id, chapterIndex: chapterIndex.get(s.chapter) ?? 0, chapterTitle: s.chapterTitle, startFrame: s.startFrame, frames: s.frames, audio: s.audio, captions: s.captions,
        ...(s.scene ? { scene: s.scene, sceneWords: approxWords(s.narration, s.frames / FPS - GAP_SEC) } : {}),
        ...(ft ? { footage: ft } : {}),
        ...(bionee ? { bionee } : {}),
        ...(mouth ? { mouth } : {}),
      };
    }),
  };
}
