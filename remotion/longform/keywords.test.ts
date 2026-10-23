import { describe, expect, it } from 'vitest';
import { splitKeywords } from './keywords';

describe('splitKeywords', () => {
  it('숫자·단위와 핵심 용어를 강조 조각으로 나눈다', () => {
    expect(splitKeywords('45도 이상 벌어진 주지를 고릅니다')).toEqual([
      { text: '45도', hot: true }, { text: ' 이상 벌어진 ', hot: false }, { text: '주지', hot: true }, { text: '를 고릅니다', hot: false },
    ]);
  });
  it('범위·mm 도 한 덩어리', () => {
    expect(splitKeywords('3~4개, 5mm 남짓').filter((p) => p.hot).map((p) => p.text)).toEqual(['3~4개', '5mm']);
  });
  it('강조할 게 없으면 한 조각', () => {
    expect(splitKeywords('그냥 문장')).toEqual([{ text: '그냥 문장', hot: false }]);
  });
});

describe('splitKeywords — 대본 강조어(2026-10-22)', () => {
  it('대본이 준 용어로 강조하고, 시범 용어는 쓰지 않는다', () => {
    const hot = splitKeywords('주지 대신 산성 흙을 씁니다', ['산성 흙']).filter((p) => p.hot).map((p) => p.text);
    expect(hot).toEqual(['산성 흙']);
  });
  it('빈 목록이면 시범 용어로 물러선다', () => {
    expect(splitKeywords('주지', []).filter((p) => p.hot).map((p) => p.text)).toEqual(['주지']);
  });
});
