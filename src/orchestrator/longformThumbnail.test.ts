import { describe, it, expect } from 'vitest';
import { pickRefSegment, refFrameArgs, descriptionSummary } from './longformThumbnail';

describe('pickRefSegment — 30% 지점의 실촬영 컷(순수)', () => {
  const segs = [
    { id: 'intro-01', startFrame: 75, frames: 165, clip: 'intro-01.mp4' },
    { id: 'card', startFrame: 1296, frames: 75 }, // 장 제목 카드 — 클립 없음
    { id: 'scaffold-24', startFrame: 5463, frames: 256, clip: 'scaffold-24.mp4' },
    { id: 'maesil-01', startFrame: 7100, frames: 200, clip: 'maesil-01.mp4' },
  ];
  it('세그먼트 가운데가 목표(전체×0.3)에 가장 가까운 클립', () => {
    expect(pickRefSegment(segs, 18820)?.id).toBe('scaffold-24'); // 목표 5646
  });
  it('클립 없는 세그먼트는 건너뛰고, 하나도 없으면 null', () => {
    expect(pickRefSegment([{ id: 'card', startFrame: 5600, frames: 75 }], 18820)).toBeNull();
    expect(pickRefSegment([], 100)).toBeNull();
  });
});

describe('refFrameArgs(순수)', () => {
  it('가운데 3:2 자르기 → 1536x1024, 위치는 소수 둘째 자리', () => {
    expect(refFrameArgs('/d/clips/a.mp4', 1, '/d/thumb-ref.jpg')).toEqual([
      '-nostdin', '-y', '-ss', '1.00', '-i', '/d/clips/a.mp4', '-frames:v', '1',
      '-vf', "crop='min(iw,ih*3/2)':'min(ih,iw*2/3)',scale=1536:1024", '-q:v', '2', '/d/thumb-ref.jpg',
    ]);
  });
});

describe('descriptionSummary — 카피용 요약(순수)', () => {
  it('챕터·해시태그 앞 첫 문단만', () => {
    const d = '매실·자두·감·블루베리, 잎이 다 진 뒤에 시작합니다.\n\n챕터\n0:00 시작\n0:43 원가지\n\n#과일나무가지치기 #겨울전정';
    expect(descriptionSummary(d)).toBe('매실·자두·감·블루베리, 잎이 다 진 뒤에 시작합니다.');
  });
  it('챕터가 없어도 첫 문단, 빈 값은 빈 문자열', () => {
    expect(descriptionSummary('요약 #태그\n\n둘째 문단')).toBe('요약');
    expect(descriptionSummary('')).toBe('');
  });
});
