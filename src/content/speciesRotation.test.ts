import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { findSpeciesLoose } from './species';
import { speciesInText, speciesCoverage, overSpeciesCap, speciesRotationBlock, SPECIES_MONTHLY_CAP, speciesCapFor, speciesCapFrom, speciesRecency, usedRecently, speciesRecentBlock } from './speciesRotation';

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
    expect(speciesCapFor(7110)).toBe(5);   // 회양목 — 기본 3 + 2
    expect(speciesCapFor(1930)).toBe(4);   // 홍매화 — 기본 3 + 1
    expect(speciesCapFor(230)).toBe(3);    // 포도나무 — 보너스 없음(기본값)
  });
  it('수요 미상·0 은 종전 상한 그대로 — 조이지 않는다', () => {
    // 이 채널 최고 성적(하스카프베리 검색 1,085회)이 수요 목록 밖 수종에서 나왔다.
    // 낮은 수요로 상한을 낮췄다면 그 발견 자체를 막았을 것이다.
    expect(speciesCapFor(undefined)).toBe(3);
    expect(speciesCapFor(0)).toBe(3);
    expect(speciesCapFor(NaN)).toBe(3);
    expect(speciesCapFor(22)).toBe(3);     // 수요 22/월 — 보너스 없음
  });
});

describe('overSpeciesCap — 수종별 상한 함수', () => {
  const catalog = [{ group: '관목', species: [{ name: '배롱나무' }, { name: '회양목' }] }];
  const cov = new Map([['배롱나무', 3], ['회양목', 3]]);   // 기본 상한 3(2026-09-17)에 닿은 상태

  it('숫자 상한은 종전대로 동작한다', () => {
    expect(overSpeciesCap('배롱나무 전정', cov, catalog)).toMatchObject({ name: '배롱나무', count: 3 });
  });
  it('수종별 함수를 주면 그 수종만 여유가 생긴다', () => {
    const capFor = (n: string) => (n === '회양목' ? 5 : 3);
    expect(overSpeciesCap('회양목 생울타리', cov, catalog, capFor)).toBeNull();
    expect(overSpeciesCap('배롱나무 전정', cov, catalog, capFor)).not.toBeNull();
  });
  it('상한 함수가 던지면 종전 상한으로 떨어진다', () => {
    const boom = (): never => { throw new Error('수요 데이터 고장'); };
    expect(overSpeciesCap('배롱나무 전정', cov, catalog, boom)).not.toBeNull();
  });
  it('카탈로그에 없는 수종은 상한 대상이 아니다', () => {
    expect(overSpeciesCap('하스카프베리 재배', cov, catalog, () => 5)).toBeNull();
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

describe('speciesCapFrom — 검색량·숏폼 조회수 가중 상한(2026-09-17 사용자 확정)', () => {
  const B = 3;   // 기본 상한을 명시 — 기본값이 바뀌어도 계단 자체를 검증한다
  it('숏폼이 우리 중앙값의 3배 이상이면 두 자리 더 준다', () => {
    expect(speciesCapFrom({ perfRatio: 3.31 }, B)).toBe(5);   // 무화과
  });
  it('1.5배 이상이면 한 자리', () => {
    expect(speciesCapFrom({ perfRatio: 2.12 }, B)).toBe(4);   // 배롱나무
  });
  it('중앙값 언저리·미달은 기본 상한 그대로 — 조이지는 않는다', () => {
    expect(speciesCapFrom({ perfRatio: 1.01 }, B)).toBe(3);   // 감나무
    expect(speciesCapFrom({ perfRatio: 0.6 }, B)).toBe(3);    // 단풍나무
    expect(speciesCapFrom({}, B)).toBe(3);
    expect(speciesCapFrom({ perfRatio: NaN }, B)).toBe(3);
  });
  it('두 신호는 더하지 않고 큰 쪽만 — 한 수종이 상한을 독식하지 못하게', () => {
    // 배롱나무: 검색 100,550(+2) · 조회 2.12배(+1) → 6 이 아니라 5.
    expect(speciesCapFrom({ searchVolume: 100550, perfRatio: 2.12 }, B)).toBe(5);
  });
  it('검색량만 커도, 조회수만 커도 자리를 받는다', () => {
    expect(speciesCapFrom({ searchVolume: 7110 }, B)).toBe(5);
    expect(speciesCapFrom({ searchVolume: 30, perfRatio: 3.5 }, B)).toBe(5);
  });
});

describe('실제 브랜드 카탈로그(data/brands/bionditree.yaml) — 농원 흔한 수종이 수종 판정에 잡힌다(2026-10-02 2차 리뷰)', () => {
  // 수종 필수·하한 면제 게이트의 눈(scheduler.speciesKeyOf)과 같은 순서 — 사전(느슨) → 카탈로그.
  const cat = (YAML.parse(fs.readFileSync(path.join('data', 'brands', 'bionditree.yaml'), 'utf-8')) as { speciesCatalog: Parameters<typeof speciesInText>[1] }).speciesCatalog;
  const keyOf = (t: string): string | null => findSpeciesLoose(t)?.name ?? speciesInText(t, cat) ?? null;

  it('향나무·율마·주목(복합 표기)과 흔한 수종 전부', () => {
    const want: Record<string, string> = {
      '향나무 가지치기 시기': '향나무', '가이즈카향나무 전정': '향나무', '율마 키우기': '율마', '골드크레스트 물주기': '율마',
      '주목 가지치기 시기': '주목나무', '주목 열매 독성': '주목나무', '주목나무 묘목': '주목나무',
      '회양목 전정': '회양목', '소나무 전지': '소나무', '단풍나무 심기': '단풍나무', '은행나무 암수 구별': '은행나무',
      '느티나무 키우기': '느티나무', '벚나무 병해충': '벚나무', '목련 꽃눈': '목련', '동백나무 월동': '동백나무',
      '무궁화 진딧물': '무궁화', '산수유 열매': '산수유', '이팝나무 꽃': '이팝나무', '철쭉 전정 시기': '철쭉',
      '영산홍 꽃 진 뒤': '철쭉', '화살나무 가지치기': '화살나무', '남천 키우기': '남천',
    };
    for (const [t, sp] of Object.entries(want)) expect([t, keyOf(t)]).toEqual([t, sp]);
    // 알려진 한계 — 사전의 느슨한 어간('단풍')이 카탈로그보다 먼저라 '화살나무 단풍'은 단풍나무로 읽힌다('단풍 시기'와 같은 부류).
    expect(keyOf('화살나무 단풍')).toBe('단풍나무');
    // 측백 계열 품종은 측백으로 잡히기만 하면 된다(사전은 서양측백, 카탈로그는 측백나무)
    for (const t of ['스카이로켓 생울타리', '에메랄드그린 간격', '블루엔젤 키우기']) expect(keyOf(t)).toMatch(/측백/);
  });

  it("'주목'은 동음이의어 — 단독으로는 수종이 아니다(주목할 만한·주목받는)", () => {
    expect(keyOf('주목할 만한 가을 정원 관리')).toBeNull();
    expect(keyOf('요즘 주목받는 정원 트렌드')).toBeNull();
  });
});
