/**
 * 롱폼 타임라인(순수) — 장 제목 카드 + 세그먼트(낭독 + 쉼)를 프레임으로 잇는다.
 * 구절 자막은 롱폼 전용 구절(phrases.ts — 문장·쉼표·연결 어미에서 끊음)을 글자 수 비례로 배분한다.
 */
import { longCaptions } from './phrases';
import type { Shot } from './footage';
import type { Card, ChapterId, LongformScript, Mg } from './script';
import type { Accent } from './types';

export const FPS = 30;
/** 세그먼트 낭독 뒤 쉼. */
export const GAP_SEC = 0.35;
/** 장 시작 제목 카드 길이. */
export const CHAPTER_CARD_SEC = 2.5;

export interface TimedSegment {
  id: string; chapter: ChapterId; chapterTitle: string; narration: string; card?: Card; mg?: Mg; scene?: string; accent?: Accent; footageHint?: string[]; teaser?: string; topTitle?: string; clip2?: string; cutAtFrame?: number;
  audio: string; startFrame: number; frames: number;
  captions: Array<{ text: string; startFrame: number; endFrame: number }>;
  shot: Shot; clip?: string;
}

export interface Timeline {
  segments: TimedSegment[];
  chapterStarts: Array<{ id: ChapterId; title: string; startFrame: number; frames: number }>;
  totalFrames: number;
}

export function buildTimeline(script: LongformScript, durations: Record<string, number>, shots: Shot[], mids: Record<string, Shot> = {}): Timeline {
  const shotOf = new Map(shots.map((s) => [s.segId, s]));
  const segments: TimedSegment[] = [];
  const chapterStarts: Timeline['chapterStarts'] = [];
  let at = 0;
  for (const ch of script.chapters) {
    const cardFrames = Math.round(CHAPTER_CARD_SEC * FPS);
    chapterStarts.push({ id: ch.id, title: ch.title, startFrame: at, frames: cardFrames });
    at += cardFrames;
    for (const g of ch.segments) {
      const audioSec = durations[g.id];
      if (!(audioSec! > 0)) throw new Error(`오디오 길이 없음: ${g.id}`);
      const shot = shotOf.get(g.id);
      if (!shot) throw new Error(`영상 배정 없음: ${g.id}`);
      const frames = Math.round((audioSec! + GAP_SEC) * FPS);
      segments.push({
        id: g.id, chapter: ch.id, chapterTitle: ch.title, narration: g.narration, card: g.card, ...(g.mg ? { mg: g.mg } : {}), ...(g.scene ? { scene: g.scene } : {}),
        ...(g.accent ? { accent: g.accent } : {}), ...(g.footage ? { footageHint: g.footage } : {}), ...(g.teaser ? { teaser: g.teaser } : {}), ...(g.topTitle ? { topTitle: g.topTitle } : {}),
        audio: `${g.id}.mp3`, startFrame: at, frames,
        captions: longCaptions(g.narration, frames, Math.round(GAP_SEC * FPS)),
        shot, clip: 'mediaId' in shot ? `${g.id}.mp4` : undefined,
        ...('mediaId' in shot && mids[g.id] ? { clip2: `${g.id}~2.mp4`, cutAtFrame: Math.round(frames / 2) } : {}),
      });
      at += frames;
    }
  }
  return { segments, chapterStarts, totalFrames: at };
}
