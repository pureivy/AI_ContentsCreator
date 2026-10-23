import { describe, expect, it } from 'vitest';
import { planFootage, planMidCuts, EDGE_SEC, type MediaItem, type Shot } from './footage';

const m = (id: string, species: string, seconds: number): MediaItem => ({ id, file: `/m/${id}.mp4`, kind: 'video', seconds, species });

const MEDIA: MediaItem[] = [
  m('jadu1', '자두나무', 12), m('jadu2', '자두나무', 10),
  m('gam1', '감나무', 20), m('gam2', '감나무', 20),
  m('apple', '사과나무', 30), m('pear', '배나무', 30),
  m('pine', '소나무', 60),
];

type V = Extract<Shot, { mediaId: string }>;
const videos = (shots: Shot[]) => shots.filter((s): s is V => 'mediaId' in s);

describe('planFootage', () => {
  it('수종 장에는 그 수종 영상만 쓴다', () => {
    const shots = planFootage([{ id: 'jadu-01', chapter: 'jadu', seconds: 4 }, { id: 'jadu-02', chapter: 'jadu', seconds: 4 }], MEDIA);
    for (const s of videos(shots)) expect(s.mediaId.startsWith('jadu')).toBe(true);
    expect(videos(shots)).toHaveLength(2);
  });

  it('영상이 모자라면 남는 세그먼트는 cardOnly 로 떨어진다', () => {
    const segs = Array.from({ length: 5 }, (_, i) => ({ id: `jadu-0${i + 1}`, chapter: 'jadu' as const, seconds: 8 }));
    const shots = planFootage(segs, MEDIA);
    expect(shots).toHaveLength(5);
    expect(videos(shots)).toHaveLength(2);
    expect(shots.slice(2).every((s) => 'cardOnly' in s)).toBe(true);
  });

  it('같은 파일의 구간은 겹치지 않고 앞뒤 여백을 남긴다', () => {
    const segs = Array.from({ length: 12 }, (_, i) => ({ id: `scaffold-${i}`, chapter: 'scaffold' as const, seconds: 5 }));
    const vs = videos(planFootage(segs, MEDIA));
    for (const a of vs) {
      const item = MEDIA.find((x) => x.id === a.mediaId)!;
      expect(a.startSec).toBeGreaterThanOrEqual(EDGE_SEC);
      expect(a.startSec + a.seconds).toBeLessThanOrEqual(item.seconds - EDGE_SEC + 1e-9);
      for (const b of vs) {
        if (a === b || a.mediaId !== b.mediaId) continue;
        expect(a.startSec + a.seconds <= b.startSec || b.startSec + b.seconds <= a.startSec).toBe(true);
      }
    }
  });

  it('일반 장은 과실나무 목록 밖 수종을 쓰지 않는다', () => {
    const segs = Array.from({ length: 20 }, (_, i) => ({ id: `outro-${i}`, chapter: 'outro' as const, seconds: 5 }));
    expect(videos(planFootage(segs, MEDIA)).some((s) => s.mediaId === 'pine')).toBe(false);
  });

  it('후보가 있으면 연속한 두 세그먼트가 같은 파일을 쓰지 않는다', () => {
    const segs = Array.from({ length: 6 }, (_, i) => ({ id: `intro-${i}`, chapter: 'intro' as const, seconds: 4 }));
    const shots = planFootage(segs, MEDIA);
    for (let i = 1; i < shots.length; i++) {
      const a = shots[i - 1]!, b = shots[i]!;
      if ('mediaId' in a && 'mediaId' in b) expect(a.mediaId).not.toBe(b.mediaId);
    }
  });
});

describe('수종 영상 아끼기·지정', () => {
  it('수종 장이 먼저 자기 수종 영상을 쓰고, 일반 장은 남은 것을 쓴다', () => {
    const media = [m('jadu1', '자두나무', 10), m('apple', '사과나무', 6)];
    const segs = [
      { id: 'scaffold-01', chapter: 'scaffold' as const, seconds: 8 },
      { id: 'jadu-01', chapter: 'jadu' as const, seconds: 8 },
    ];
    const shots = planFootage(segs, media);
    expect(shots.find((s) => s.segId === 'jadu-01')).toMatchObject({ mediaId: 'jadu1' });
    expect('cardOnly' in shots.find((s) => s.segId === 'scaffold-01')!).toBe(true);
    expect(shots.map((s) => s.segId)).toEqual(['scaffold-01', 'jadu-01']);
  });

  it('세그먼트 수종 지정이 있으면 그 수종 영상만 쓰고, 없으면 카드 화면', () => {
    const shots = planFootage([
      { id: 'outro-01', chapter: 'outro' as const, seconds: 4, species: ['배나무'] },
      { id: 'outro-02', chapter: 'outro' as const, seconds: 4, species: ['석류나무'] },
    ], MEDIA);
    expect(shots[0]).toMatchObject({ mediaId: 'pear' });
    expect('cardOnly' in shots[1]!).toBe(true);
  });
});

describe('planMidCuts', () => {
  it('일반 장의 긴 세그먼트에 다른 파일의 남은 구간을 절반 길이로 잡는다', () => {
    const segs = [{ id: 'scaffold-01', chapter: 'scaffold' as const, seconds: 8 }, { id: 'jadu-01', chapter: 'jadu' as const, seconds: 8 }];
    const shots = planFootage(segs, MEDIA);
    const mids = planMidCuts(segs, shots, MEDIA, 7);
    const main = shots[0] as Extract<Shot, { mediaId: string }>;
    expect(mids['scaffold-01']).toBeDefined();
    expect(mids['scaffold-01']!.mediaId).not.toBe(main.mediaId);
    expect(mids['scaffold-01']!.seconds).toBeCloseTo(4);
    expect(mids['jadu-01']).toBeUndefined();
  });

  it('잡은 구간은 기존 구간과 겹치지 않는다', () => {
    const segs = Array.from({ length: 10 }, (_, i) => ({ id: `outro-${i}`, chapter: 'outro' as const, seconds: 8 }));
    const shots = planFootage(segs, MEDIA);
    const mids = planMidCuts(segs, shots, MEDIA, 7);
    const all = [...videos(shots), ...Object.values(mids)];
    for (const a of all) for (const b of all) {
      if (a === b || a.mediaId !== b.mediaId) continue;
      expect(a.startSec + a.seconds <= b.startSec + 1e-9 || b.startSec + b.seconds <= a.startSec + 1e-9).toBe(true);
    }
  });
});

describe('planMidCuts 수종 지정', () => {
  it('수종을 지정한 일반 장 세그먼트에는 중간 컷을 걸지 않는다', () => {
    const segs = [{ id: 'outro-01', chapter: 'outro' as const, seconds: 8, species: ['배나무'] }];
    const shots = planFootage(segs, MEDIA);
    expect(planMidCuts(segs, shots, MEDIA, 7)['outro-01']).toBeUndefined();
  });
});

describe('planFootage — 대본이 정한 장 수종(2026-10-22)', () => {
  it('수종 장은 대본 species 만, 일반 장은 편 수종만(보관소의 다른 수종은 안 씀)', () => {
    const pools = { apple: { species: ['사과나무'], own: true }, intro: { species: ['사과나무', '배나무'], own: false } };
    const shots = planFootage([
      { id: 'intro-01', chapter: 'intro', seconds: 5 }, { id: 'intro-02', chapter: 'intro', seconds: 5 },
      { id: 'apple-01', chapter: 'apple', seconds: 5 },
    ], MEDIA, pools);
    const byId = new Map(videos(shots).map((s) => [s.segId, s.mediaId]));
    expect(byId.get('apple-01')).toBe('apple');
    for (const id of ['intro-01', 'intro-02']) expect(['apple', 'pear']).toContain(byId.get(id));
  });
  it('species=null 이면 보관소 아무 영상', () => {
    const shots = planFootage([{ id: 'x-01', chapter: 'x', seconds: 50 }], MEDIA, { x: { species: null, own: false } });
    expect(videos(shots)[0]?.mediaId).toBe('pine');
  });
});
