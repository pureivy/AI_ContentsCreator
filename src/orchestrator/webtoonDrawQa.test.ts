import { describe, it, expect } from 'vitest';
import { findProp, fixProp, fixScenes, pinTreeSize, sceneMusts, STAKE_PROP, summarizeDrawQa, mergeTreeObs, treeRefVerdict, TREE_PROP, treeAgeCriterion, withFix } from './webtoonDrawQa';
import { parseTreeAge } from '../content/treeAgeSize';

// 2026-11-10 감나무 샘플 — 묘목 참조가 손목 굵기로 그려졌고, 검수는 '어린 나무' 대략 기준이었다.
const kaki = { name: '감나무', latin: 'Diospyros kaki', type: '낙엽 교목' };
const sl = {
  scenes: [
    { id: 's01', image: 'late autumn backyard, the sapling', props: ['persimmon_sapling'] },
    { id: 's07', image: 'late autumn backyard, the stake beside the sapling', props: ['support_stake', 'persimmon_sapling'] },
    { id: 's06', image: 'cutaway of frozen topsoil' },
  ],
  props: {
    persimmon_sapling: { name: 'persimmon sapling', prompt: 'a one-year-old grafted Daebong persimmon sapling, a single whip' },
    support_stake: { name: 'support stake', prompt: 'a thin round green coated steel stake' },
  },
};

describe('webtoonDrawQa', () => {
  it('영어 나이 말을 읽는다', () => {
    expect(parseTreeAge('a one-year-old grafted sapling')).toEqual({ lo: 1, hi: 1 });
    expect(parseTreeAge('two-year-old tree')).toEqual({ lo: 2, hi: 2 });
  });
  it('나무·지주 소품을 가른다', () => {
    expect(findProp(sl, TREE_PROP)?.key).toBe('persimmon_sapling');
    expect(findProp(sl, STAKE_PROP, TREE_PROP)?.key).toBe('support_stake');
  });
  it('나무 참조에 기준표 줄을 한 번만 붙이고, 검수 기준은 1년생 줄', () => {
    const a = pinTreeSize(sl, kaki);
    expect(a.changed).toBe(true);
    expect(a.shotlist.props!.persimmon_sapling!.prompt).toContain('[Tree size for its age');
    expect(a.shotlist.props!.persimmon_sapling!.prompt).not.toMatch(/[가-힣]/); // SHORT_marker lint — 그림 필드 한글 금지
    expect(pinTreeSize(a.shotlist, kaki).changed).toBe(false);
    expect(treeAgeCriterion(sl, kaki)).toContain('1년생');
    expect(treeAgeCriterion(sl, kaki)).toContain('1~1.5cm');
  });
  it('고칠 점은 바꿔 붙이고 쌓지 않는다', () => {
    const t = withFix(withFix('scene', 'too thick'), 'too many branches');
    expect(t).toBe('scene Must fix: too many branches');
    const f = fixScenes(sl, { s01: 'the trunk must be finger-thin' });
    expect(f.scenes[0]!.image).toContain('Must fix: the trunk must be finger-thin');
    // 번역 못 한 한글 사유는 일반 영어 문구로(SHORT_marker lint — 그림 필드 한글 금지)
    expect(fixScenes(sl, { s01: '줄기가 손목 굵기' }).scenes[0]!.image).not.toMatch(/[가-힣]/);
    expect(f.scenes[1]!.image).not.toContain('Must fix');
    const p = fixProp(sl, 'persimmon_sapling', '굵다');
    expect(p.props!.persimmon_sapling!.seed).toBe(12);
  });
  it('바깥 장면은 한국 배경, 지주 장면은 둥근 지주를 본다', () => {
    const m = sceneMusts(sl, 'support_stake');
    expect(m[0]!.not.join()).toContain('한국이 아닌 배경');
    expect(m[0]!.not.join()).not.toContain('각목');
    expect(m[1]!.not.join()).toContain('각목');
    expect(m[2]!.not.join()).not.toContain('한국이 아닌 배경');
  });
});

// 2026-11-11 사장님 "텔레그램으로 다 쏘면 작업이 되겠어?" — 18줄 대신 종류별 장 수 한 줄.
describe('summarizeDrawQa', () => {
  it('같은 장면의 여러 사유는 종류마다 한 장으로 센다', () => {
    const s = summarizeDrawQa([
      '씬1: 나이: 기준과 달리 판근', '씬3: 나이: 밑동이 굵음', '씬3: 손: 엄지가 보이지 않음', '씬4: 배경 집이 일본식 2층 주택',
      '씬8: 잎이 좁고 길쭉해 감잎과 다름', 's02 나무 일관성: 줄기가 손목 굵기', 's03 나무 일관성: 너무 가늘다',
    ]);
    expect(s).toBe('나무 크기·나이 3장 · 손 1장 · 배경 1장 · 잎·수종 모양 1장');
  });
  it('손목 굵기는 손 문제가 아니다', () => {
    expect(summarizeDrawQa(['씬2: 나이: 줄기가 손목 굵기'])).toBe('나무 크기·나이 1장');
  });
});

// 2026-11-11 감나무 보정 — 옛 참조(문어발 뿌리)는 3번 중 2번만 strong, 고친 참조는 늘 slight. 잎·배경 오탐은 한 번씩.
describe('나무 참조 관찰값 판정', () => {
  const desc = 'a 10-year-old persimmon tree, a single gray-brown trunk about 15 cm thick';
  it('밑동은 두 번 다 strong 일 때만 탈락(한 번은 곧은 묘목에도 나왔다)', () => {
    const one = mergeTreeObs([{ flare: 'slight', stems: 1 }, { flare: 'strong', stems: 1 }]);
    expect(treeRefVerdict(one, desc)).toBeNull();
    const two = mergeTreeObs([{ flare: 'strong', stems: 1 }, { flare: 'strong', stems: 1 }]);
    expect(treeRefVerdict(two, desc)).toContain('퍼진 뿌리');
  });
  it('slight 는 통과, 잎·배경 지적은 두 번 다일 때만', () => {
    const m = mergeTreeObs([{ flare: 'slight', stems: 1, background: 'scene', trees: 1, leafType: 'wrong' }, { flare: 'slight', stems: 1, background: 'white', trees: 1, leafType: 'ok' }]);
    expect(treeRefVerdict(m, desc)).toBeNull();
    const w = mergeTreeObs([{ flare: 'none', leafType: 'wrong', note: '겹잎' }, { flare: 'none', leafType: 'wrong' }]);
    expect(treeRefVerdict(w, desc)).toContain('잎 모양');
  });
  it('외줄기 나무에 줄기 둘은 탈락, 관목은 괜찮다', () => {
    expect(treeRefVerdict({ flare: 'none', stems: 2 }, desc)).toContain('줄기 2개');
    expect(treeRefVerdict({ flare: 'none', stems: 3 }, 'a 3-year-old multi-stem shrub')).toBeNull();
  });
});
