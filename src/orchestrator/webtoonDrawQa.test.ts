import { describe, it, expect } from 'vitest';
import { findProp, fixProp, fixScenes, pinTreeSize, sceneMusts, STAKE_PROP, TREE_PROP, treeAgeCriterion, withFix } from './webtoonDrawQa';
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
    expect(pinTreeSize(a.shotlist, kaki).changed).toBe(false);
    expect(treeAgeCriterion(sl, kaki)).toContain('1년생');
    expect(treeAgeCriterion(sl, kaki)).toContain('1~1.5cm');
  });
  it('고칠 점은 바꿔 붙이고 쌓지 않는다', () => {
    const t = withFix(withFix('scene', '줄기가 너무 굵다'), '가지가 많다');
    expect(t).toBe('scene Must fix: 가지가 많다');
    const f = fixScenes(sl, { s01: '줄기가 손목 굵기' });
    expect(f.scenes[0]!.image).toContain('Must fix: 줄기가 손목 굵기');
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
