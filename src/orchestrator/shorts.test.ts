import { describe, it, expect } from 'vitest';
import { applyShortsRevision, trimPlanToBudget, pruneQuoteSources } from './shorts';

type ShortsPlan = Parameters<typeof applyShortsRevision>[0];

describe('trimPlanToBudget — 결정적 트리밍(생성 실패 금지의 예산 보장, 2026-08-20)', () => {
  const mk = (narrs: string[]): ShortsPlan => ({
    title: '제목', titles: ['제목'], description: '설명', hashtags: ['#a'],
    scenes: narrs.map((n, i) => ({ narration: n, screenText: `t${i}` })),
  });
  it('예산 이내면 무변화(trimmed=false, 전 씬 유지)', () => {
    const p = mk(['훅.', '전제.', '본문.', '마무리.']);
    const r = trimPlanToBudget(p, 999);
    expect(r.trimmed).toBe(false);
    expect(r.keptScenes).toEqual([0, 1, 2, 3]);
  });
  it('1단계: 본문 씬의 마지막 문장부터 깎아 예산을 맞춘다(훅·CTA 문장 보존)', () => {
    const p = mk(['훅 문장입니다.', '전제 문장입니다.', '방법 문장입니다. 이유 문장입니다.', 'CTA 문장입니다.']);
    const before = p.scenes.reduce((s, x) => s + x.narration.length, 0);
    const r = trimPlanToBudget(p, before - 5);
    expect(r.trimmed).toBe(true);
    expect(r.plan.scenes[2]!.narration).toBe('방법 문장입니다.'); // 뒤 문장 제거
    expect(r.plan.scenes[0]!.narration).toBe('훅 문장입니다.');
    expect(r.keptScenes).toEqual([0, 1, 2, 3]); // 씬 수 유지
  });
  it('2단계: 문장으로 모자라면 뒤쪽 본문 씬을 통째 제거 — keptScenes 가 원본 인덱스를 준다', () => {
    const p = mk(['훅번째문장입니다.', '전제번째문장입니다.', '본문하나입니다.', '본문둘입니다.', '본문셋입니다.', 'CTA입니다.']);
    const r = trimPlanToBudget(p, 45); // 전체 ~50자 → 씬 제거 필요
    expect(r.trimmed).toBe(true);
    expect(r.plan.scenes.length).toBeLessThan(6);
    expect(r.keptScenes[0]).toBe(0); // 훅 보존
    expect(r.keptScenes[r.keptScenes.length - 1]).toBe(5); // CTA 보존
    expect(r.plan.scenes.length).toBeGreaterThanOrEqual(4); // 최소 4씬
  });
  it('최소 구성(4씬·전 씬 1문장)에서는 더 깎지 않고 멈춘다(생성 우선 — 무한루프 없음)', () => {
    const p = mk(['훅.', '전제.', '본문.', 'CTA.']);
    const r = trimPlanToBudget(p, 3);
    expect(r.plan.scenes.length).toBe(4);
  });
});

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

const P = (scenes: Array<Record<string, unknown>>) => ({ title: 't', titles: ['t'], scenes, description: '', hashtags: [] }) as never;
describe('pruneQuoteSources — 원문에 없는 출처 라벨 제거(스펙 §6a)', () => {
  it('원문에 문자열이 있으면 유지, 없으면 source 만 삭제, 원문 없으면 전부 삭제', () => {
    const plan = P([
      { narration: 'a', kind: 'quote', quote: { text: 'q1', source: '농사로' } },
      { narration: 'b', kind: 'quote', quote: { text: 'q2', source: '재배 기록' } },
      { narration: 'c' },
    ]);
    const r = pruneQuoteSources(plan, '농사로 자료에 따르면 …');
    expect(r.pruned).toBe(1);
    expect(r.plan.scenes[0]!.quote).toEqual({ text: 'q1', source: '농사로' });
    expect(r.plan.scenes[1]!.quote).toEqual({ text: 'q2' });
    expect(pruneQuoteSources(plan, undefined).pruned).toBe(2);
  });
});
describe('applyShortsRevision — quote 편집', () => {
  it('kind=quote 씬만 text·source 를 바꾼다', () => {
    const plan = P([{ narration: 'a', kind: 'quote', quote: { text: 'old', source: 's' } }, { narration: 'b' }]);
    const r = applyShortsRevision(plan, { scenes: [{ index: 1, quote: { text: 'new', source: '농사로' } }, { index: 2, quote: { text: 'x' } }] });
    expect(r?.plan.scenes[0]!.quote).toEqual({ text: 'new', source: '농사로' });
    expect(r?.plan.scenes[1]!.quote).toBeUndefined();
    expect(r?.changedScenes).toEqual([1]);
  });
});
