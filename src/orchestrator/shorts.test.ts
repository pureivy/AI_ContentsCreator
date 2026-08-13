import { describe, it, expect } from 'vitest';
import { applyShortsRevision } from './shorts';

type ShortsPlan = Parameters<typeof applyShortsRevision>[0];

describe('applyShortsRevision — 수정 요청 개정안 적용(순수)', () => {
  const base: ShortsPlan = {
    title: '원제목', titles: ['원제목', '후보2'], description: '설명', hashtags: ['#a'],
    scenes: [
      { narration: 'n1', screenText: 't1' },
      { narration: 'n2', screenText: 't2' },
    ],
  };
  it('내레이션 교체 → changedScenes, 배경 재생성 아님', () => {
    const r = applyShortsRevision(base, { scenes: [{ index: 1, narration: '새 내레이션' }] });
    expect(r).not.toBeNull();
    expect(r!.changedScenes).toEqual([1]);
    expect(r!.regenScenes).toEqual([]);
    expect(r!.plan.scenes[0]!.narration).toBe('새 내레이션');
    expect(r!.plan.scenes[0]!.screenText).toBe('t1'); // 미지정 보존
  });
  it('regen_image 씬은 regenScenes + image_note 보관', () => {
    const r = applyShortsRevision(base, { scenes: [{ index: 2, regen_image: true, image_note: '화분을 테라코타로' }] });
    expect(r!.regenScenes).toEqual([2]);
    expect(r!.changedScenes).toEqual([2]);
    expect(r!.imageNotes.get(2)).toBe('화분을 테라코타로');
  });
  it('제목 변경은 titleChanged, 유효 변경 없으면 null', () => {
    expect(applyShortsRevision(base, { title: '새 제목' })!.titleChanged).toBe(true);
    expect(applyShortsRevision(base, { title: '원제목' })).toBeNull();
    expect(applyShortsRevision(base, { scenes: [{ index: 5, narration: 'x' }] })).toBeNull();
    expect(applyShortsRevision(base, null)).toBeNull();
  });
});
