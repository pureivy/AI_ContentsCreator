import { describe, it, expect } from 'vitest';
import { speciesInText, speciesCoverage, overSpeciesCap, speciesRotationBlock, SPECIES_MONTHLY_CAP, speciesCapFor, speciesRecency, usedRecently, speciesRecentBlock } from './speciesRotation';

const CAT = [
  { group: '유실수', species: [{ name: '사과나무', aliases: ['사과'] }, { name: '배나무' }, { name: '블루베리', aliases: ['블루베리나무'] }, { name: '매실나무', aliases: ['매실'] }] },
  { group: '조경수', species: [{ name: '배롱나무', aliases: ['배롱', '백일홍나무'] }, { name: '느티나무', aliases: ['느티'] }] },
];
const NOW = new Date('2026-08-27T18:00:00+09:00');
const d = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('speciesInText — 카탈로그 수종 탐지(가장 긴 표기 우선)', () => {
  it('별칭·정식명 모두 잡고 정식명으로 돌려준다', () => {
    expect(speciesInText('배롱 8월 말 꽃이 안 필 때', CAT)).toBe('배롱나무');
    expect(speciesInText('사과 나무 묘목 고르기', CAT)).toBe('사과나무');
    expect(speciesInText('블루베리 물주기', CAT)).toBe('블루베리');
  });
  it("'배'는 별칭이 아니라 배롱·배수에 오탐 없음, 배나무는 잡힘", () => {
    expect(speciesInText('배수 문제와 배롱나무', CAT)).toBe('배롱나무');
    expect(speciesInText('배나무 가을 거름', CAT)).toBe('배나무');
  });
  it('카탈로그 없음·수종 없음이면 null', () => {
    expect(speciesInText('묘목 심기 전 흙 상태', CAT)).toBeNull();
    expect(speciesInText('배롱나무', undefined)).toBeNull();
  });
});

describe('speciesCoverage / overSpeciesCap — 30일 창 편수와 월 상한', () => {
  const items = [
    { title: '배롱나무 관리', ts: d(5) }, { title: '배롱나무선택', keyword: '배롱나무선택', ts: d(9) }, { title: '배롱 개화시기', ts: d(21) },
    { title: '블루베리 물주기', ts: d(3) },
    { title: '매실나무 전정', ts: d(40) },  // 창 밖
  ];
  it('30일 안 편수만 센다', () => {
    const cov = speciesCoverage(items, CAT, NOW);
    expect(cov.get('배롱나무')).toBe(3);
    expect(cov.get('블루베리')).toBe(1);
    expect(cov.has('매실나무')).toBe(false);
  });
  it(`상한(${SPECIES_MONTHLY_CAP}) 도달 수종은 기각, 미달·미다룸은 통과`, () => {
    const cov = speciesCoverage(items, CAT, NOW);
    expect(overSpeciesCap('배롱나무 꽃 안 피는 이유', cov, CAT)).toEqual({ name: '배롱나무', count: 3 });
    expect(overSpeciesCap('블루베리 가을 거름', cov, CAT)).toBeNull();
    expect(overSpeciesCap('느티나무 심는 간격', cov, CAT)).toBeNull();
  });
});

describe('speciesRotationBlock — 제안 금지·피함·우선 목록', () => {
  it('세 묶음을 분류별로 나열한다', () => {
    const cov = new Map([['배롱나무', 3], ['블루베리', 1]]);
    const b = speciesRotationBlock(CAT, cov);
    expect(b).toContain('제안 금지');
    expect(b).toContain('배롱나무(3편)');
    expect(b).toContain('피함: 블루베리(1편)');
    expect(b).toContain('· 유실수: 사과나무, 배나무, 매실나무');
    expect(b).toContain('· 조경수: 느티나무');
    expect(b).toContain('최소 5개');
  });
  it('카탈로그 없으면 빈 문자열', () => { expect(speciesRotationBlock(undefined, new Map())).toBe(''); });
});

describe('speciesCapFor — 수요 가중 월 상한(순수, 2026-09-04)', () => {
  it('수요가 크면 몇 편 더 허용한다', () => {
    expect(speciesCapFor(7110)).toBe(4);   // 회양목
    expect(speciesCapFor(1930)).toBe(3);   // 홍매화
    expect(speciesCapFor(230)).toBe(2);    // 포도나무 — 종전 그대로
  });
  it('수요 미상·0 은 종전 상한 그대로 — 조이지 않는다', () => {
    // 이 채널 최고 성적(하스카프베리 검색 1,085회)이 수요 목록 밖 수종에서 나왔다.
    // 낮은 수요로 상한을 낮췄다면 그 발견 자체를 막았을 것이다.
    expect(speciesCapFor(undefined)).toBe(2);
    expect(speciesCapFor(0)).toBe(2);
    expect(speciesCapFor(NaN)).toBe(2);
    expect(speciesCapFor(22)).toBe(2);     // 배롱나무 — 종전대로 막힌다
  });
});

describe('overSpeciesCap — 수종별 상한 함수', () => {
  const catalog = [{ group: '관목', species: [{ name: '배롱나무' }, { name: '회양목' }] }];
  const cov = new Map([['배롱나무', 2], ['회양목', 2]]);

  it('숫자 상한은 종전대로 동작한다', () => {
    expect(overSpeciesCap('배롱나무 전정', cov, catalog)).toMatchObject({ name: '배롱나무', count: 2 });
  });
  it('수종별 함수를 주면 그 수종만 여유가 생긴다', () => {
    const capFor = (n: string) => (n === '회양목' ? 4 : 2);
    expect(overSpeciesCap('회양목 생울타리', cov, catalog, capFor)).toBeNull();
    expect(overSpeciesCap('배롱나무 전정', cov, catalog, capFor)).not.toBeNull();
  });
  it('상한 함수가 던지면 종전 상한으로 떨어진다', () => {
    const boom = (): never => { throw new Error('수요 데이터 고장'); };
    expect(overSpeciesCap('배롱나무 전정', cov, catalog, boom)).not.toBeNull();
  });
  it('카탈로그에 없는 수종은 상한 대상이 아니다', () => {
    expect(overSpeciesCap('하스카프베리 재배', cov, catalog, () => 4)).toBeNull();
  });
});

describe('speciesRecency — 최근 사용 수종 제외(2026-09-17 사용자 확정)', () => {
  const spOf = (t: string): string | null => speciesInText(t, CAT);
  const items = [
    { title: '모과나무 가지치기', keyword: '모과나무 전정', ts: d(6) },   // 카탈로그 밖 — 이 눈으로는 안 잡힌다
    { title: '배롱나무 묘목 고르기', keyword: '배롱나무 묘목', ts: d(3) },
    { title: '배롱나무 전정', keyword: '배롱 가지치기', ts: d(12) },      // 같은 수종 더 옛 건은 덮지 않는다
    { title: '느티나무 심는 시기', keyword: '느티나무 식재', ts: d(40) }, // 창 밖
  ];

  it('수종별로 가장 최근 1건의 며칠 전만 남긴다', () => {
    const r = speciesRecency(items, spOf, NOW, 30);
    expect(r.get('배롱나무')).toBe(3);
    expect(r.has('느티나무')).toBe(false);   // 40일 전 — 창 밖
  });

  it('창을 0 으로 주면 빈 지도 — 게이트 끄기(SPECIES_RECENT_DAYS=0)', () => {
    expect(speciesRecency(items, spOf, NOW, 0).size).toBe(0);
  });

  it('판정 눈을 주입받는다 — 카탈로그 밖 수종도 사전 눈으로 잡힌다(아로니아 계보)', () => {
    const loose = (t: string): string | null => (t.includes('모과') ? '모과나무' : speciesInText(t, CAT));
    expect(speciesRecency(items, loose, NOW, 30).get('모과나무')).toBe(6);
  });

  it('usedRecently — 창 안 수종은 며칠 전까지 돌려주고, 밖이면 null', () => {
    const r = speciesRecency(items, spOf, NOW, 30);
    expect(usedRecently('배롱나무 가을 거름 주는 법', r, spOf)).toEqual({ name: '배롱나무', daysAgo: 3 });
    expect(usedRecently('느티나무 묘목 고르기', r, spOf)).toBeNull();
    expect(usedRecently('상토 배양토 차이', r, spOf)).toBeNull();   // 수종 없는 주제는 대상 아님
  });

  it('usedRecently — 각도·행위를 바꿔도 같은 수종이면 걸린다(카운트 상한과 다른 축)', () => {
    const r = speciesRecency([{ title: '배롱나무 가지치기', ts: d(3) }], spOf, NOW, 30);
    expect(usedRecently('배롱나무 묘목 고르기, 뿌리 상태 먼저', r, spOf)).not.toBeNull();
  });

  it('speciesRecentBlock — 가까운 순으로 금지 목록을 쓴다', () => {
    const r = speciesRecency(items, spOf, NOW, 30);
    const b = speciesRecentBlock(r, 30);
    expect(b).toContain('[최근 30일 안에 다룬 수종 — 제안 금지]');
    expect(b).toContain('배롱나무(3일 전)');
    expect(b).toContain('코드가 기각한다');
  });

  it('speciesRecentBlock — 빈 지도·창 0 이면 무주입', () => {
    expect(speciesRecentBlock(new Map(), 30)).toBe('');
    expect(speciesRecentBlock(new Map([['배롱나무', 3]]), 0)).toBe('');
  });
});
