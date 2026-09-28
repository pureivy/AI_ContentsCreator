import { describe, it, expect } from 'vitest';
import { themeInText, themeCoverage, overThemeCap, themeRotationBlock, THEME_MONTHLY_CAP, themeRecency, usedThemeRecently, themeRecentBlock, speciesSeed } from './topicThemes';
import type { TopicTheme } from './topicThemes';

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
  // 픽스처를 상한에서 **유도**한다 — 종전엔 '심기·이식' 4편을 하드코딩해 상한이 4일 때만 성립했고,
  // 2026-09-01 에 상한을 5로 올리자 두 건이 깨졌다. 상한이 다시 바뀌어도 계약은 그대로 성립해야 한다.
  const items = [
    ...Array.from({ length: THEME_MONTHLY_CAP }, (_, i) => ({ title: `감나무 심는 시기 ${i}`, ts: d(2 + i) })),
    { title: '깍지벌레 약', ts: d(4) }, { title: '옛날 접목 글', ts: d(45) },
  ];
  it('30일 창 편수', () => {
    const cov = themeCoverage(items, TH, NOW);
    expect(cov.get('심기·이식')).toBe(THEME_MONTHLY_CAP);
    expect(cov.get('병충해·문제 진단')).toBe(1);
    expect(cov.has('번식·접목·삽목')).toBe(false);
  });
  it(`상한(${THEME_MONTHLY_CAP}) 도달 축은 기각`, () => {
    const cov = themeCoverage(items, TH, NOW);
    expect(overThemeCap('대추나무 심는 시기', cov, TH)).toEqual({ theme: '심기·이식', count: THEME_MONTHLY_CAP });
    expect(overThemeCap('대추나무 접붙이기', cov, TH)).toBeNull();
  });
  // 2026-09-01 계약 변경: 상한 절반 이하는 '피함'이 아니라 '우선'이다. 종전엔 0편만 우선이라
  // 월 68편 체제에서 그 목록이 늘 비었고, 후보가 많이 다룬 축으로 몰려 유사 주제 폴백을 불렀다.
  it('블록은 금지·우선(적게 다룬 축)·검색어 예시를 나열', () => {
    const b = themeRotationBlock(TH, themeCoverage(items, TH, NOW));
    expect(b).toContain(`제안 금지(코드가 기각한다): 심기·이식(${THEME_MONTHLY_CAP}편)`);
    expect(b).toContain('· 병충해·문제 진단(1편)');                      // 1편 ≤ 상한 절반 → 우선
    expect(b).toContain('· 번식·접목·삽목(0편): 예) 나무 접붙이기, 눈접 붙이는 방법');
    expect(themeRotationBlock(undefined, new Map())).toBe('');
  });
});

// 좁은 장 경고(2026-08-30) — 실사고: 16축 중 7축이 상한에 닿은 상태에서 두뇌가 상한 축으로 후보를
// 채워 한 라운드 17건이 코드 기각됐고 생산이 멈췄다. 남은 자리를 세어 알려 주면 그 자리를 피한다.
describe('themeRotationBlock — 좁은 장 경고', () => {
  const cov = (m: Record<string, number>): Map<string, number> => new Map(Object.entries(m));

  it('남은 축이 요구 후보 수 이하면 경고를 낸다', () => {
    // 3축 중 2축 상한 → 열린 축 1개, 후보 2개 요구
    const b = themeRotationBlock(TH, cov({ '심기·이식': 9, '병충해·문제 진단': 5 }), THEME_MONTHLY_CAP, 2);
    expect(b).toContain('⚠ 지금 쓸 수 있는 축은 1개뿐이다(3축 중 2축 상한 도달)');
    expect(b).toContain('상한 축으로 자리를 메우면 그 후보는 버려진다');
  });

  it('여유가 있으면 경고를 내지 않는다 — 정상 상태의 소음 방지', () => {
    // 축을 넉넉히 둔 장: 10축 중 1축만 상한 → 열린 축 9개로 후보 3개 요구를 여유 있게 채운다.
    const many = Array.from({ length: 10 }, (_, i) => ({ theme: `축${i}`, seeds: [`시드${i}`], match: [`토큰${i}`] }));
    const b = themeRotationBlock(many, cov({ '축0': 9 }), THEME_MONTHLY_CAP, 3);
    expect(b).toContain('상한 도달 → 제안 금지');            // 상한 안내는 그대로 나온다
    expect(b).not.toContain('⚠ 지금 쓸 수 있는 축은');       // 좁은 장 경고만 없다
  });

  it('상한 축이 없으면 경고 자체가 없다', () => {
    expect(themeRotationBlock(TH, cov({}), THEME_MONTHLY_CAP, 8)).not.toContain('⚠');
  });

  it('우선 목록이 비면 대안을 덧붙인다 — 열린 축이 전부 상한 절반을 넘긴 장', () => {
    // 3축 중 2축 상한, 남은 1축도 3편(상한 4의 절반 초과) → 우선 목록 없음
    const b = themeRotationBlock(TH, cov({ '심기·이식': 9, '병충해·문제 진단': 5, '번식·접목·삽목': 3 }), THEME_MONTHLY_CAP, 2);
    expect(b).toContain('적게 다룬 축이 없으면 남은 축에서 편수가 적은 것부터 고른다');
  });

  it('축 정의가 없으면 종전대로 빈 문자열', () => {
    expect(themeRotationBlock(undefined, cov({}))).toBe('');
    expect(themeRotationBlock([], cov({}))).toBe('');
  });
});

// 실사고(2026-09-01 사용자 제보: "며칠 전과 유사한 목련 글을 또 썼다" → "다양한 주제로 쓰고 싶다").
// 원인은 다양성 장치가 스스로를 막은 것이다. 실측: 축 16 × 상한 4 = 월 수용량 64편인데 30일 생산이
// 68편이라 구조적으로 초과였고, 16축 중 10축이 상한에 닿았다. 기각 사유 1·2위가 주제 축 상한(93)과
// 소재 포화(83)였고, 깨끗한 후보가 0이 되자 기아 방지 폴백이 유사 주제를 21회 채택했다.
//
// 프롬프트의 '우선' 목록이 n===0 축만 담은 게 문제였다 — 매달 68편이 나오면 0편인 축이 존재하지 않아
// 그 목록이 늘 비고, 지시가 "가급적 피함"으로만 남는다. 적게 다룬 축을 명시적으로 지목해야 한다.
describe('themeRotationBlock — 커버리지 하위 축 우선 지목', () => {
  const th = (theme: string): TopicTheme => ({ theme, seeds: [`${theme} 씨앗`], match: [theme] });
  const themes = ['A', 'B', 'C', 'D', 'E'].map(th);

  it('0편 축이 없어도 적게 다룬 축을 우선 목록에 지목한다', () => {
    const cov = new Map([['A', 5], ['B', 5], ['C', 4], ['D', 1], ['E', 1]]);
    const out = themeRotationBlock(themes, cov, 5);
    expect(out).toMatch(/적게 다룬 축|우선/);
    expect(out).toContain('· D(1편)');
    expect(out).toContain('· E(1편)');
  });

  it('우선 목록은 편수가 적은 순으로 나온다', () => {
    const cov = new Map([['A', 5], ['B', 3], ['C', 1], ['D', 2], ['E', 5]]);
    const out = themeRotationBlock(themes, cov, 5);
    expect(out.indexOf('C')).toBeLessThan(out.indexOf('D')); // 1편 < 2편
  });

  it('상한 축은 우선 목록에 절대 오지 않는다', () => {
    const cov = new Map([['A', 5], ['B', 5], ['C', 5], ['D', 5], ['E', 0]]);
    const out = themeRotationBlock(themes, cov, 5);
    const prio = out.split('\n').filter((l) => l.includes('·')).join('\n');
    for (const t of ['A', 'B', 'C', 'D']) expect(prio).not.toContain(`· ${t}(`);
    expect(prio).toContain('· E(0편)');
  });

  it('한 번도 안 다룬 축은 여전히 최우선(적게 다룬 축보다 앞)', () => {
    const cov = new Map([['A', 5], ['B', 2], ['C', 0], ['D', 3], ['E', 5]]);
    const out = themeRotationBlock(themes, cov, 5);
    expect(out.indexOf('· C(0편)')).toBeLessThan(out.indexOf('· B(2편)'));
  });
});

describe('themeRecency — 최근 사용 축 제외(2026-09-17 사용자 확정)', () => {
  const thOf = (t: string): string | null => themeInText(t, TH);
  const items = [
    { title: '사과나무 접붙이기 요령', ts: d(2) },
    { title: '배나무 접목 시기', ts: d(5) },              // 같은 축 더 옛 건은 덮지 않는다
    { title: '감나무 심는 시기', ts: d(1) },
    { title: '매실나무 벌레 약', ts: d(20) },             // 창 밖
  ];

  it('축별로 가장 최근 1건의 며칠 전만 남긴다', () => {
    const r = themeRecency(items, thOf, NOW, 7);
    expect(r.get('번식·접목·삽목')).toBe(2);
    expect(r.get('심기·이식')).toBe(1);
    expect(r.has('병충해·문제 진단')).toBe(false);   // 20일 전 — 창 밖
  });

  it('창 0 이면 빈 지도 — 게이트 끄기(THEME_RECENT_DAYS=0)', () => {
    expect(themeRecency(items, thOf, NOW, 0).size).toBe(0);
  });

  it('usedThemeRecently — 수종을 바꿔도 같은 축이면 걸린다(카운트 상한과 다른 축)', () => {
    const r = themeRecency([{ title: '사과나무 접붙이기', ts: d(2) }], thOf, NOW, 7);
    expect(usedThemeRecently('호두나무 접목하는 법', r, thOf)).toEqual({ theme: '번식·접목·삽목', daysAgo: 2 });
    expect(usedThemeRecently('호두나무 벌레 약 고르기', r, thOf)).toBeNull();
    expect(usedThemeRecently('호두나무 이야기', r, thOf)).toBeNull();   // 축 없는 주제는 대상 아님
  });

  it('themeRecentBlock — 가까운 순으로 금지 목록을 쓴다', () => {
    const b = themeRecentBlock(themeRecency(items, thOf, NOW, 7), 7);
    expect(b).toContain('[최근 7일 안에 쓴 주제 축 — 제안 금지]');
    expect(b).toContain('심기·이식(1일 전)');
    expect(b).toContain('수종을 바꿔도');
  });

  it('themeRecentBlock — 빈 지도·창 0 이면 무주입', () => {
    expect(themeRecentBlock(new Map(), 7)).toBe('');
    expect(themeRecentBlock(new Map([['심기·이식', 1]]), 0)).toBe('');
  });
});

// 실사고(2026-09-29): 06:00 오토런이 후보 9개를 전부 기각당해 빈손으로 끝났다. 축 용량은 남아 있었다 —
// 29축 중 14축이 열려 있고 월 수용량 145편에 30일 생산 62편. 막힌 건 조합이었다: 열린 축이 하필
// 수종이 안 붙는 축(지지대·옥상 마당·비용·경계·전설·문학)이라 검색어 예시가 "나무 지지대 설치 방법"처럼
// 수종 없는 말이었고, 사장님 지시가 켜 둔 보관소 화이트리스트가 그런 제목을 '보관소 밖 수종'으로 기각했다
// (실측: "나무 멀칭, 제대로 깔아야 뿌리가 산다"). 수종이 자연스럽게 붙는 축은 전부 월 상한이었다.
describe('speciesSeed — 일반 검색어를 보관소 수종으로 한정(2026-09-29)', () => {
  it("홀로 선 '나무' 토큰을 수종으로 바꾼다", () => {
    expect(speciesSeed('나무 지지대', '감나무')).toBe('감나무 지지대');
    expect(speciesSeed('옥상 정원 나무', '감나무')).toBe('옥상 정원 감나무');
    expect(speciesSeed('시 속의 나무', '배롱나무')).toBe('시 속의 배롱나무');
  });
  it('조사가 붙은 나무도 그 자리에서 바꾼다 — 접두하면 "감나무 나무가 안 자라요" 가 된다', () => {
    expect(speciesSeed('나무가 안 자라요', '황금회화나무')).toBe('황금회화나무가 안 자라요');
    expect(speciesSeed('나무의 수명', '소나무')).toBe('소나무의 수명');
  });
  it("'나무' 가 없으면 앞에 붙인다", () => {
    expect(speciesSeed('묘목 파는 곳', '대추나무')).toBe('대추나무 묘목 파는 곳');
  });
  it("긴 단어 속 '나무' 는 바꾸지 않는다 — '감나무지주목' 같은 말이 생기면 안 된다", () => {
    expect(speciesSeed('나무지주목 설치방법', '감나무')).toBe('감나무 나무지주목 설치방법');
  });
  it('수종이 비면 원문 그대로', () => {
    expect(speciesSeed('나무 지지대', '')).toBe('나무 지지대');
  });
});

describe('themeRotationBlock — 보관소 지시 중에는 예시도 그 수종으로', () => {
  const cov = new Map([['심기·이식', 5]]); // 나머지 두 축은 0편이라 '적게 다룬 축'
  it('수종 목록을 주면 예시가 수종으로 한정된다', () => {
    const b = themeRotationBlock(TH, cov, THEME_MONTHLY_CAP, 8, ['감나무', '대추나무']);
    expect(b).toMatch(/감나무|대추나무/);
    expect(b).not.toMatch(/예\) 나무 접붙이기/); // 수종 없는 원문 예시는 안 나온다
    expect(b).toMatch(/보관소/);                  // 왜 한정했는지 한 줄 있어야 두뇌가 안 헤맨다
  });
  it('수종 목록이 없으면 종전 그대로(회귀)', () => {
    const before = themeRotationBlock(TH, cov);
    expect(themeRotationBlock(TH, cov, THEME_MONTHLY_CAP, 8, [])).toBe(before);
    expect(themeRotationBlock(TH, cov, THEME_MONTHLY_CAP, 8)).toBe(before);
    expect(before).toMatch(/예\) 나무 접붙이기/);
  });
});
