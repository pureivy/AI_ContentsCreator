import { describe, it, expect } from 'vitest';
import { scoreSpeciesPopularity, naverPrior, viewsAtAge, speciesPopularityBlock, POPULARITY_HIGH, type PopularityRow } from './speciesPopularity';

const rows = (sp: string, ch: PopularityRow['channel'], ...vs: number[]): PopularityRow[] => vs.map((views) => ({ species: sp, channel: ch, views }));

describe('scoreSpeciesPopularity — 우리 채널 실측 중심, 검색량은 보조(2026-10-07)', () => {
  // 채널 기준: 인스타 중앙 1,000 근처가 되도록 '보통' 수종을 깔아 둔다.
  const base = [...rows('보통', 'ig', 900, 1000, 1100, 1000, 950), ...rows('보통', 'blog', 20, 20, 20), ...rows('보통', 'yt', 1000, 1000)];
  it('검색량이 커도 우리 반응이 약하면 평균 아래 — 마가목 모양', () => {
    const data = [...base, ...rows('마가목', 'ig', 600, 700), ...rows('마가목', 'yt', 700, 780), ...rows('마가목', 'blog', 18)];
    const prior = naverPrior(['보통', '마가목'], (sp) => (sp === '마가목' ? 34_180 : 2_000));
    const pop = scoreSpeciesPopularity(data, ['보통', '마가목'], prior);
    expect(pop.get('마가목')!.score).toBeLessThan(1);
  });
  it('검색량이 작아도 인스타 반응이 크면 인기 — 자두나무 모양', () => {
    const data = [...base, ...rows('자두나무', 'ig', 8_800, 6_000), ...rows('자두나무', 'blog', 40, 60)];
    const pop = scoreSpeciesPopularity(data, ['보통', '자두나무'], naverPrior(['보통', '자두나무'], (sp) => (sp === '자두나무' ? 2_090 : 30_000)));
    expect(pop.get('자두나무')!.score).toBeGreaterThanOrEqual(POPULARITY_HIGH);
    expect(pop.get('자두나무')!.tier).toBe('high');
  });
  it('표본 없는 수종은 사전값만 — 저조로 깎지 않는다', () => {
    const pop = scoreSpeciesPopularity(base, ['보통', '신참'], naverPrior(['보통', '신참'], () => undefined));
    expect(pop.get('신참')).toMatchObject({ score: 1, tier: 'mid', n: { ig: 0, yt: 0, blog: 0 } });
  });
  it('한 편짜리 대박은 수축으로 누그러진다', () => {
    const one = scoreSpeciesPopularity([...base, ...rows('한방', 'ig', 10_000)], ['한방'], new Map()).get('한방')!.score;
    const two = scoreSpeciesPopularity([...base, ...rows('한방', 'ig', 10_000, 10_000)], ['한방'], new Map()).get('한방')!.score;
    expect(one).toBeLessThan(two);
  });
});

describe('naverPrior — 검색량 순위 → 0.85~1.15', () => {
  it('가장 큰 쪽 1.15, 가장 작은 쪽 0.85, 모르면 1', () => {
    const p = naverPrior(['a', 'b', 'c'], (sp) => ({ a: 100, b: 10_000 } as Record<string, number>)[sp]);
    expect(p.get('a')).toBeCloseTo(0.85); expect(p.get('b')).toBeCloseTo(1.15); expect(p.get('c')).toBe(1);
  });
});

describe('viewsAtAge — 고정 나이(게시 7~14일)', () => {
  const pub = '2026-09-01T00:00:00Z';
  const at = (d: number, v: number, source = 'meta:ig') => ({ measuredAt: new Date(Date.parse(pub) + d * 86_400_000).toISOString(), views: v, source });
  const now = Date.parse('2026-10-01T00:00:00Z');
  it('창 안 마지막 측정값 — 창 뒤 누적은 안 본다', () => {
    expect(viewsAtAge([at(3, 100), at(13, 500), at(20, 900)], 'meta:ig', pub, now)).toBe(500);
  });
  it('게시 7일 전이면 null, 다른 출처는 무시', () => {
    expect(viewsAtAge([at(3, 100)], 'meta:ig', pub, Date.parse(pub) + 5 * 86_400_000)).toBeNull();
    expect(viewsAtAge([at(3, 100, 'youtube:api')], 'meta:ig', pub, now)).toBeNull();
  });
});

describe('speciesPopularityBlock — 참고 표시', () => {
  it('보관소 목록 안에서만, 규칙이 아니라 참고라고 적는다', () => {
    const pop = new Map([
      ['자두나무', { score: 1.9, tier: 'high' as const, n: { ig: 2, yt: 2, blog: 2 } }],
      ['포포나무', { score: 2.5, tier: 'high' as const, n: { ig: 2, yt: 2, blog: 2 } }],
      ['무궁화', { score: 0.5, tier: 'low' as const, n: { ig: 2, yt: 2, blog: 2 } }],
    ]);
    const b = speciesPopularityBlock(pop, ['자두나무', '무궁화']);
    expect(b).toContain('참고일 뿐 규칙이 아니다');
    expect(b).toContain('자두나무(1.9배)');
    expect(b).toContain('무궁화(0.5배)');
    expect(b).not.toContain('포포나무');
    expect(speciesPopularityBlock(new Map())).toBe('');
  });
  it('지금 막힌 수종(최근 수종 창 등)은 반응 좋은 쪽에서 뺀다 — 권해 놓고 기각하지 않게', () => {
    const pop = new Map([
      ['감나무', { score: 1.4, tier: 'high' as const, n: { ig: 7, yt: 7, blog: 7 } }],
      ['자두나무', { score: 1.9, tier: 'high' as const, n: { ig: 2, yt: 2, blog: 2 } }],
    ]);
    const b = speciesPopularityBlock(pop, [], (sp) => sp === '감나무');
    expect(b).toContain('자두나무');
    expect(b).not.toContain('감나무');
  });
});
