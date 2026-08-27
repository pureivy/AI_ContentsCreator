import { describe, it, expect } from 'vitest';
import { themeInText, themeCoverage, overThemeCap, themeRotationBlock, THEME_MONTHLY_CAP } from './topicThemes';

const TH = [
  { theme: '심기·이식', seeds: ['나무 심기 좋은 시기', '나무 옮겨심기'], match: ['심기', '심는', '이식', '간격'] },
  { theme: '번식·접목·삽목', seeds: ['나무 접붙이기', '눈접 붙이는 방법'], match: ['접목', '접붙이', '삽목', '휘묻이'] },
  { theme: '병충해·문제 진단', seeds: ['나무 벌레 약'], match: ['병충해', '벌레', '깍지벌레', '안 열리'] },
];
const NOW = new Date('2026-08-27T18:00:00+09:00');
const d = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('themeInText', () => {
  it('제목의 토큰으로 축을 잡는다(가장 앞 토큰 우선)', () => {
    expect(themeInText('감나무 접붙이기, 봄에 하는 이유', TH)).toBe('번식·접목·삽목');
    expect(themeInText('사과나무 심는 간격과 깍지벌레', TH)).toBe('심기·이식');
    expect(themeInText('블루베리 물주기', TH)).toBeNull();
  });
});

describe('themeCoverage / overThemeCap / block', () => {
  const items = [
    { title: '감나무 심는 시기', ts: d(2) }, { title: '매실 묘목 심기', ts: d(6) }, { title: '나무 이식 후 물', ts: d(12) }, { title: '포도 심는 간격', ts: d(20) },
    { title: '깍지벌레 약', ts: d(4) }, { title: '옛날 접목 글', ts: d(45) },
  ];
  it('30일 창 편수', () => {
    const cov = themeCoverage(items, TH, NOW);
    expect(cov.get('심기·이식')).toBe(4);
    expect(cov.get('병충해·문제 진단')).toBe(1);
    expect(cov.has('번식·접목·삽목')).toBe(false);
  });
  it(`상한(${THEME_MONTHLY_CAP}) 도달 축은 기각`, () => {
    const cov = themeCoverage(items, TH, NOW);
    expect(overThemeCap('대추나무 심는 시기', cov, TH)).toEqual({ theme: '심기·이식', count: 4 });
    expect(overThemeCap('대추나무 접붙이기', cov, TH)).toBeNull();
  });
  it('블록은 금지·피함·우선(검색어 예시)을 나열', () => {
    const b = themeRotationBlock(TH, themeCoverage(items, TH, NOW));
    expect(b).toContain('제안 금지(코드가 기각한다): 심기·이식(4편)');
    expect(b).toContain('피함: 병충해·문제 진단(1편)');
    expect(b).toContain('· 번식·접목·삽목: 예) 나무 접붙이기, 눈접 붙이는 방법');
    expect(themeRotationBlock(undefined, new Map())).toBe('');
  });
});
