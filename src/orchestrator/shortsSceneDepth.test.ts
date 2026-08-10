import { describe, it, expect } from 'vitest';
import { parseDepthManifest } from './shortsSceneDepth';

describe('parseDepthManifest — 매니페스트 → 씬별 fg·bg 레이어 쌍(순수)', () => {
  it('ok 씬만 fg/bg 쌍, 탈락 사유는 issues(no-image 는 무소음)', () => {
    const r = parseDepthManifest({ scenes: [
      { index: 0, ok: true },
      { index: 1, ok: false, reason: 'coverage' },
      { index: 2, ok: false, reason: 'no-image' },
      { index: 3, ok: true },
    ] }, 4);
    expect(r.layers).toEqual([
      { fg: 'fg_01.png', bg: 'bg_01.png' }, null, null, { fg: 'fg_04.png', bg: 'bg_04.png' },
    ]);
    expect(r.issues).toEqual(['씬2 coverage']);
  });
  it('이형 방어 — 범위 밖 인덱스·비배열·null 은 무해', () => {
    expect(parseDepthManifest({ scenes: [{ index: 9, ok: true }, { index: -1, ok: true }] }, 3).layers).toEqual([null, null, null]);
    expect(parseDepthManifest(null, 2).layers).toEqual([null, null]);
    expect(parseDepthManifest({}, 0).layers).toEqual([]);
  });
});
