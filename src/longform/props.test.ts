import { describe, expect, it } from 'vitest';
import { toLongFormProps } from './props';
import type { Timeline, TimedSegment } from './timeline';

const seg = (id: string, chapter: TimedSegment['chapter'], over: Partial<TimedSegment> = {}): TimedSegment => ({
  id, chapter, chapterTitle: chapter, narration: 'x', audio: `${id}.mp3`, startFrame: 0, frames: 30, captions: [],
  shot: { segId: id, mediaId: 'm', file: '/f', startSec: 0, seconds: 1 }, clip: `${id}.mp4`, ...over,
});

const card = { kind: 'takeaway' as const, lines: ['a'] };
const tl: Timeline = {
  totalFrames: 300,
  chapterStarts: [
    { id: 'jadu', title: '자두', startFrame: 0, frames: 75 },
    { id: 'gam', title: '감', startFrame: 200, frames: 75 },
  ],
  segments: [
    seg('jadu-01', 'jadu', { card }),
    seg('jadu-02', 'jadu', { clip: undefined, shot: { segId: 'jadu-02', cardOnly: true } }),
    seg('jadu-03', 'jadu'),
    seg('gam-01', 'gam', { clip: undefined, shot: { segId: 'gam-01', cardOnly: true } }),
    seg('gam-02', 'gam'),
  ],
};

describe('toLongFormProps', () => {
  const p = toLongFormProps('제목', tl);

  it('카드는 그 세그먼트에서만 보이고 다음 세그먼트로 이어지지 않는다(오래 머무는 화면 금지)', () => {
    expect(p.segments[0]!.card).toEqual(card);
    expect(p.segments[0]!.cardIsNew).toBe(true);
    expect(p.segments[1]!.card).toBeUndefined();
  });

  it('장이 바뀌면 이전 장 카드를 끌고 가지 않는다', () => {
    expect(p.segments[3]!.card).toBeUndefined();
  });

  it('카드 화면 배경은 같은 장의 직전 클립, 없으면 다음 클립 장면', () => {
    expect(p.segments[1]!.poster).toBe('poster-jadu-01.jpg');
    expect(p.segments[3]!.poster).toBe('poster-gam-02.jpg');
  });

  it('장 제목 카드는 장 순번과 첫 클립 장면을 받는다', () => {
    expect(p.chapters.map((c) => c.index)).toEqual([0, 1]);
    expect(p.chapters[1]!.poster).toBe('poster-gam-02.jpg');
    expect(p.segments[4]!.chapterIndex).toBe(1);
  });
});

describe('모션그래픽 연결', () => {
  const list = { kind: 'list' as const, header: 'h', items: ['도장지 — 원칙은 제거', '교차지 — 약한 쪽 제거', '역행지 — 제거'] };
  const t2: Timeline = {
    totalFrames: 200,
    chapterStarts: [{ id: 'scaffold', title: 's', startFrame: 0, frames: 75 }],
    segments: [
      seg('scaffold-01', 'scaffold', { card: list, narration: '나머지 가지는 여섯 유형입니다.' }),
      seg('scaffold-02', 'scaffold', { narration: '다른 가지를 스치는 교차지는 약한 쪽을 자릅니다.' }),
      seg('scaffold-03', 'scaffold', { narration: '각도입니다.', mg: { kind: 'angle', ok: true } }),
    ],
  };
  const p2 = toLongFormProps('t', t2);

  it('도해 지정은 세그먼트로 그대로 넘어간다', () => {
    expect(p2.segments[2]!.mg).toEqual({ kind: 'angle', ok: true });
  });

  it('목록 카드는 낭독에 나온 항목을 지금 항목으로 고른다', () => {
    expect(p2.segments[0]!.focusItem).toBeUndefined();
    expect(p2.segments[1]!.focusItem).toBeUndefined(); // 카드가 이어지지 않으므로 강조할 목록도 없다
  });
});

describe('이어지는 도해', () => {
  const t3: Timeline = {
    totalFrames: 200,
    chapterStarts: [{ id: 'scaffold', title: 's', startFrame: 0, frames: 75 }],
    segments: [
      seg('scaffold-01', 'scaffold', { mg: { kind: 'thickness' } }),
      seg('scaffold-02', 'scaffold', { mg: { kind: 'thickness' } }),
      seg('scaffold-03', 'scaffold', { mg: { kind: 'angle', ok: true } }),
      seg('scaffold-04', 'scaffold', { mg: { kind: 'angle', ok: false } }),
    ],
  };
  const p3 = toLongFormProps('t', t3);

  it('직전 세그먼트와 같은 도해면 이어 보여준다(다시 그리지 않음)', () => {
    expect(p3.segments.map((s) => s.mgContinue ?? false)).toEqual([false, true, false, false]);
  });
});

describe('카드 첫 등장', () => {
  const card2 = { kind: 'takeaway' as const, lines: ['b'] };
  const t4: Timeline = {
    totalFrames: 100,
    chapterStarts: [{ id: 'intro', title: 'i', startFrame: 0, frames: 75 }],
    segments: [
      seg('intro-01', 'intro', { card: card2, mg: { kind: 'thickness' } }),
      seg('intro-02', 'intro'),
      seg('intro-03', 'intro'),
    ],
  };
  const p4 = toLongFormProps('t', t4);
  it('도해가 있는 세그먼트의 카드는 보이지 않고, 다음 세그먼트로 넘어가지도 않는다', () => {
    expect(p4.segments.map((s) => !!s.card)).toEqual([false, false, false]);
  });
});

describe('편집 기법 연결', () => {
  const t5: Timeline = {
    totalFrames: 400,
    chapterStarts: [
      { id: 'jadu', title: 'j', startFrame: 0, frames: 75 },
      { id: 'gam', title: 'g', startFrame: 200, frames: 75 },
    ],
    segments: [
      seg('jadu-01', 'jadu'),
      seg('jadu-02', 'jadu', { clip: undefined, shot: { segId: 'jadu-02', cardOnly: true } }),
      seg('jadu-03', 'jadu', { clip: undefined, shot: { segId: 'jadu-03', cardOnly: true } }),
      seg('gam-01', 'gam'),
    ],
  };
  const p5 = toLongFormProps('t', t5, { focus: { 'jadu-02': { x: 0.4, y: 0.3 } } });

  it('영상이 없는 세그먼트는 같은 장 클립의 정지 화면을 받고, 초점 좌표가 붙는다', () => {
    expect(p5.segments[1]!.still).toBe('still-jadu-02.jpg');
    expect(p5.segments[1]!.stillFrom).toBe('jadu-01');
    expect(p5.segments[1]!.focus).toEqual({ x: 0.4, y: 0.3 });
    expect(p5.segments[0]!.still).toBeUndefined();
  });

  it('모든 세그먼트에 등장 효과가 붙고, 장마다 자막 움직임이 다르다', () => {
    expect(p5.segments.every((s) => !!s.enter)).toBe(true);
    expect(p5.chapterMotions).toHaveLength(2);
    expect(p5.chapterMotions[0]).not.toBe(p5.chapterMotions[1]);
  });
});

describe('정지 화면 고르기', () => {
  const t6: Timeline = {
    totalFrames: 400,
    chapterStarts: [{ id: 'jadu', title: 'j', startFrame: 0, frames: 75 }],
    segments: [
      seg('jadu-01', 'jadu'),
      seg('jadu-02', 'jadu'),
      seg('jadu-03', 'jadu', { clip: undefined, shot: { segId: 'jadu-03', cardOnly: true } }),
      seg('jadu-04', 'jadu', { clip: undefined, shot: { segId: 'jadu-04', cardOnly: true } }),
      seg('jadu-05', 'jadu', { clip: undefined, shot: { segId: 'jadu-05', cardOnly: true } }),
      seg('jadu-06', 'jadu', { clip: undefined, shot: { segId: 'jadu-06', cardOnly: true }, footageHint: ['매실나무'] }),
    ],
  };
  const p6 = toLongFormProps('t', t6);
  it('연속한 정지 화면은 클립이나 뽑는 시점이 서로 다르다', () => {
    const keys = p6.segments.slice(2, 5).map((s) => `${s.stillFrom}@${s.stillAt}`);
    expect(new Set(keys).size).toBe(3);
    expect(new Set(p6.segments.slice(2, 5).map((s) => s.stillFrom))).toEqual(new Set(['jadu-01', 'jadu-02']));
  });
  it('특정 수종을 지정한 세그먼트는 정지 화면을 쓰지 않는다', () => {
    expect(p6.segments[5]!.still).toBeUndefined();
  });
});

describe('수종 지정 배경', () => {
  const t7: Timeline = {
    totalFrames: 200,
    chapterStarts: [{ id: 'outro', title: 'o', startFrame: 0, frames: 75 }],
    segments: [
      seg('outro-01', 'outro'),
      seg('outro-02', 'outro', { clip: undefined, shot: { segId: 'outro-02', cardOnly: true }, footageHint: ['자두나무'] }),
    ],
  };
  it('수종을 지정한 카드 장면은 다른 수종 장면을 흐린 배경으로도 쓰지 않는다', () => {
    expect(toLongFormProps('t', t7).segments[1]!.poster).toBeUndefined();
  });
});

describe('이어지는 그림의 시각', () => {
  const t8: Timeline = {
    totalFrames: 400,
    chapterStarts: [{ id: 'maesil', title: 'm', startFrame: 0, frames: 75 }],
    segments: [
      seg('maesil-01', 'maesil', { frames: 100, mg: { kind: 'thickness' } }),
      seg('maesil-02', 'maesil', { frames: 80, mg: { kind: 'thickness' } }),
      seg('maesil-03', 'maesil', { frames: 60, mg: { kind: 'thickness' } }),
      seg('maesil-04', 'maesil', { frames: 50 }),
    ],
  };
  const p8 = toLongFormProps('t', t8);
  it('이어지는 세그먼트는 앞 세그먼트들이 끝난 시각부터 이어 간다(다시 재생하지 않음)', () => {
    expect(p8.segments.map((s) => s.mgOffset ?? 0)).toEqual([0, 100, 180, 0]);
  });
  it('카메라는 그림 묶음 전체 길이를 기준으로 당긴다', () => {
    expect(p8.segments.slice(0, 3).map((s) => s.mgChainFrames)).toEqual([240, 240, 240]);
  });
});

describe('문장 그림 장면 키·단어 시각', () => {
  const t9: Timeline = {
    totalFrames: 200,
    chapterStarts: [{ id: 'maesil', title: 'm', startFrame: 0, frames: 75 }],
    segments: [
      seg('maesil-01', 'maesil', { frames: 90, narration: '가나 다라 마바사', scene: 's000' }),
      seg('maesil-02', 'maesil', { frames: 60, narration: '아자' }),
    ],
  };
  const p9 = toLongFormProps('t', t9);
  it('scene 이 있는 세그먼트만 키와 단어 시각(쉼 뺀 낭독 구간에 글자 비례)을 넘긴다', () => {
    expect(p9.segments[0]).toMatchObject({ scene: 's000', sceneWords: [{ w: '가나', start: 0 }, { w: '다라', start: 0.757 }, { w: '마바사', start: 1.514 }] });
    expect(p9.segments[1]!.scene).toBeUndefined();
    expect(p9.segments[1]!.sceneWords).toBeUndefined();
  });
});
