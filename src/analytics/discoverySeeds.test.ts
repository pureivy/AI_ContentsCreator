import { describe, it, expect } from 'vitest';
import { pickDiscoverySeeds } from './discoverySeeds';

const CAT = [
  { group: '유실수', species: [{ name: '사과나무' }, { name: '배나무' }, { name: '매실나무' }, { name: '대추나무' }] },
  { group: '조경수', species: [{ name: '배롱나무' }, { name: '느티나무' }, { name: '이팝나무' }] },
];
const BRAND = ['묘목 식재', '나무 물주기', '배롱나무 관리'];

describe('pickDiscoverySeeds — 안 다룬 수종 회전 + 브랜드 시드 소량', () => {
  it('상한 수종은 빠지고, 안 다룬 수종이 먼저, 브랜드 시드 2개를 덧붙인다', () => {
    const cov = new Map([['배롱나무', 3], ['사과나무', 1]]);
    const out = pickDiscoverySeeds({ catalog: CAT, coverage: cov, brandSeeds: BRAND, max: 6, now: new Date('2026-08-27T12:00:00') });
    expect(out).toHaveLength(6);
    expect(out).not.toContain('배롱나무');
    const species = out.filter((s) => CAT.some((g) => g.species.some((x) => x.name === s)));
    expect(species).toHaveLength(4);
    expect(out.filter((s) => BRAND.includes(s))).toHaveLength(2);
    // 안 다룬 5종(배·매실·대추·느티·이팝) 중 4개가 먼저, 최근 다룸(사과 1편)은 그 뒤 순번
    const fresh = ['배나무', '매실나무', '대추나무', '느티나무', '이팝나무'];
    expect(species.filter((s) => fresh.includes(s)).length).toBeGreaterThanOrEqual(3);
  });
  it('날짜가 바뀌면 시드가 회전한다', () => {
    const a = pickDiscoverySeeds({ catalog: CAT, coverage: new Map(), brandSeeds: [], max: 3, now: new Date('2026-08-27T12:00:00') });
    const b = pickDiscoverySeeds({ catalog: CAT, coverage: new Map(), brandSeeds: [], max: 3, now: new Date('2026-08-28T12:00:00') });
    expect(a).not.toEqual(b);
    expect(new Set([...a, ...b]).size).toBeGreaterThan(3);
  });
  it('카탈로그 없으면 브랜드 시드 그대로(종전 동작)', () => {
    expect(pickDiscoverySeeds({ catalog: undefined, coverage: new Map(), brandSeeds: BRAND, max: 8 })).toEqual(BRAND);
  });
});
