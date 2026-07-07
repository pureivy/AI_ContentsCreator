import { describe, it, expect } from 'vitest';
import { parseBadScenes, buildRetryPrompt } from './shortsSceneQa';

describe('parseBadScenes — 유효(1..count)·중복제거·정렬', () => {
  it('중복·범위밖·비정상값 방어, floor', () => {
    expect(parseBadScenes([{ scene: 2 }, { scene: 2 }, { scene: 1 }], 3)).toEqual([1, 2]);
    expect(parseBadScenes([{ scene: 0 }, { scene: 4 }, { scene: 'x' }, { scene: 3 }], 3)).toEqual([3]);
    expect(parseBadScenes([{ scene: 2.9 }], 3)).toEqual([2]);
    expect(parseBadScenes([], 3)).toEqual([]);
  });
});
describe('buildRetryPrompt — 원본 + 강화 접미(순수)', () => {
  it('원본 포함 + 글자·워터마크 금지 문구', () => {
    const p = buildRetryPrompt('a wilting plant by a window');
    expect(p).toContain('a wilting plant by a window');
    expect(p).toContain('글자');
    expect(p).toContain('워터마크');
  });
});
