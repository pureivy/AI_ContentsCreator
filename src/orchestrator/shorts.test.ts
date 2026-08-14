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
  it('titleArt 캘리 문구 변경 — 실변경만 인정, 미지정 필드는 현행 유지', () => {
    const cur = { line1: '묘목 식재 준비', line2: '손끝으로 답 찾기', points: ['활착 가르는 손끝 감각'] };
    const r = applyShortsRevision(base, { titleArt: { line2: '흙덩이가 알려주는 답' } }, cur);
    expect(r!.titleArtCopy).toEqual({ line1: '묘목 식재 준비', line2: '흙덩이가 알려주는 답', points: ['활착 가르는 손끝 감각'] });
    expect(r!.titleChanged).toBe(false); // plan.title 은 무변경
  });
  it('titleArt — 동일 문구·현 카피 부재는 무변경(null)', () => {
    const cur = { line1: '묘목 식재 준비', line2: '손끝으로 답 찾기', points: ['p'] };
    expect(applyShortsRevision(base, { titleArt: { line2: '손끝으로 답 찾기' } }, cur)).toBeNull();
    expect(applyShortsRevision(base, { titleArt: { line2: '새 훅' } })).toBeNull(); // 현 카피 없음 → 무시
    expect(applyShortsRevision(base, { titleArt: { line2: '새 훅' } }, null)).toBeNull();
  });
});
