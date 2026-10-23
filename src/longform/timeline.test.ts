import { describe, expect, it } from 'vitest';
import { buildTimeline, CHAPTER_CARD_SEC, GAP_SEC } from './timeline';
import { CHAPTER_ORDER, type LongformScript } from './script';
import type { Shot } from './footage';

const script: LongformScript = {
  title: 't',
  chapters: CHAPTER_ORDER.map((id) => ({
    id, title: `${id} 제목`,
    segments: [
      { id: `${id}-01`, narration: '첫 문장입니다. 둘째 구절은 조금 더 깁니다.' },
      { id: `${id}-02`, narration: '짧은 문장, 그리고 이어지는 말.' },
    ],
  })),
};
const durations = Object.fromEntries(script.chapters.flatMap((c) => c.segments.map((g, i) => [g.id, 2 + i * 1.5])));
const shots: Shot[] = script.chapters.flatMap((c) => c.segments.map((g) => ({ segId: g.id, cardOnly: true as const })));

describe('buildTimeline', () => {
  const tl = buildTimeline(script, durations, shots);

  it('장마다 장 제목 구간이 앞에 오고, 세그먼트 길이는 오디오 + 쉼', () => {
    expect(tl.chapterStarts).toHaveLength(CHAPTER_ORDER.length);
    const first = tl.chapterStarts[0]!;
    expect(first.startFrame).toBe(0);
    expect(first.frames).toBe(Math.round(CHAPTER_CARD_SEC * 30));
    const s1 = tl.segments[0]!;
    expect(s1.startFrame).toBe(first.frames);
    expect(s1.frames).toBe(Math.round((2 + GAP_SEC) * 30));
    expect(tl.segments[1]!.frames).toBe(Math.round((3.5 + GAP_SEC) * 30));
  });

  it('totalFrames 는 장 제목과 세그먼트 합', () => {
    const sum = tl.chapterStarts.reduce((n, c) => n + c.frames, 0) + tl.segments.reduce((n, s) => n + s.frames, 0);
    expect(tl.totalFrames).toBe(sum);
    const last = tl.segments[tl.segments.length - 1]!;
    expect(last.startFrame + last.frames).toBe(tl.totalFrames);
  });

  it('캡션은 세그먼트 안에 있고 서로 겹치지 않는다', () => {
    for (const s of tl.segments) {
      expect(s.captions.length).toBeGreaterThan(0);
      let prevEnd = 0;
      for (const c of s.captions) {
        expect(c.startFrame).toBeGreaterThanOrEqual(prevEnd);
        expect(c.endFrame).toBeLessThanOrEqual(s.frames);
        prevEnd = c.endFrame;
      }
    }
  });

  it('세그먼트마다 배정된 shot 과 오디오 파일명이 붙는다', () => {
    expect(tl.segments[0]!.shot).toEqual(shots[0]);
    expect(tl.segments[0]!.audio).toBe('intro-01.mp3');
  });
});

describe('중간 컷', () => {
  it('중간 컷이 잡힌 세그먼트는 두 번째 클립과 절반 지점 프레임을 받는다', () => {
    const shots2: Shot[] = script.chapters.flatMap((c) => c.segments.map((g) => ({ segId: g.id, mediaId: 'm', file: '/f', startSec: 0, seconds: 1 })));
    const tl2 = buildTimeline(script, durations, shots2, { 'intro-02': { segId: 'intro-02', mediaId: 'n', file: '/g', startSec: 0, seconds: 1 } });
    const s = tl2.segments[1]!;
    expect(s.clip2).toBe('intro-02~2.mp4');
    expect(s.cutAtFrame).toBe(Math.round(s.frames / 2));
    expect(tl2.segments[0]!.clip2).toBeUndefined();
  });
});
