import { describe, it, expect } from 'vitest';
import { shortsGenreOf, genreGuide, genreSceneGuide, pickLoreHooks, loreHookSource, loreHookGuide } from './shortsGenre';
import type { SuppliedFact } from './factSupply';

describe('shortsGenreOf — 원본 제목으로 장르', () => {
  it('이야기 축 제목은 lore, 재배 제목은 howto', () => {
    expect(shortsGenreOf('은행나무 전설, 천 년을 산 나무')).toBe('lore');
    expect(shortsGenreOf('동백꽃 꽃말과 이름 유래')).toBe('lore');
    expect(shortsGenreOf('동백나무 산성 흙, pH 측정과 배수 확인 방법')).toBe('howto');
  });
  it('킬스위치가 꺼지면 항상 howto(종전 동작)', () => {
    expect(shortsGenreOf('은행나무 전설, 천 년을 산 나무', false)).toBe('howto');
  });
});

describe('genreGuide — 장르별 네 줄', () => {
  it('하우투는 행동 결론·방법+이유·조건→답·수치·나열, 이야기형은 눈이 바뀌는 한 줄·장면+뜻·이름→뜻·연도·인물·기록', () => {
    const h = genreGuide('howto');
    expect(h.conclusion).toContain('행동 결론');
    expect(h.bodyForm).toContain('방법 한 문장+이유 한 문장');
    expect(h.takeaways).toContain('"조건 → 답"');
    expect(h.extract).toContain('수치와 나열');
    const l = genreGuide('lore');
    expect(l.conclusion).toContain('하우투가 아니다');
    expect(l.conclusion).not.toContain('행동 결론을 최소 1개');
    expect(l.bodyForm).toContain('장면·사건 한 문장+그 뜻 한 문장');
    expect(l.takeaways).toContain('"이름·장면 → 뜻·유래"');
    expect(l.extract).toContain('연도·수령');
  });
  it('이야기형도 takeaways 를 요구한다 — 결론 카드가 빠지면 단독 이해 검산의 결론 부재 지적이 매편 난다', () => {
    expect(genreGuide('lore').takeaways).toMatch(/^CTA 씬에는 takeaways 를 채워라/);
  });
  it('두 장르 모두 원문 밖 사실을 막는 문장을 갖는다', () => {
    for (const g of ['howto', 'lore'] as const) {
      expect(genreGuide(g).takeaways).toContain('원문(블로그 초안)에 있어야 한다');
    }
    expect(genreGuide('lore').conclusion).toContain('지어 넣지 마라');
  });
  it('씬 디자인 지침은 이야기형만', () => {
    expect(genreSceneGuide('howto')).toBe('');
    expect(genreSceneGuide('lore')).toContain('ink_wash·watercolor·manhwa');
  });
});

describe('pickLoreHooks — 사실 공급에서 훅 소재', () => {
  const f = (text: string, kind: SuppliedFact['kind'] = 'lore', specific = true): SuppliedFact =>
    ({ text, kind, source: 'src', url: 'https://x', specific });
  it('고유 이야기 사실만, 최대 3건, 순서 유지', () => {
    const hooks = pickLoreHooks([
      f('산성 흙을 좋아한다', 'cultivation'),
      f('꽃말은 겸손한 아름다움이다'),
      f('나무는 늘 푸르다', 'lore', false),
      f('부산의 시목이다'),
      f('춘백이라고도 부른다'),
      f('네 번째 사실'),
    ]);
    expect(hooks).toEqual(['꽃말은 겸손한 아름다움이다', '부산의 시목이다', '춘백이라고도 부른다']);
  });
  it('공백만 다른 중복은 하나로, 너무 긴 문장(160자 초과)은 뺀다', () => {
    const long = '가'.repeat(161);
    expect(pickLoreHooks([f('꽃말은  겸손한 아름다움이다'), f('꽃말은 겸손한 아름다움이다'), f(long)])).toEqual(['꽃말은 겸손한 아름다움이다']);
  });
  it('입력이 없으면 빈 배열', () => {
    expect(pickLoreHooks(undefined)).toEqual([]);
    expect(pickLoreHooks([])).toEqual([]);
  });
});

describe('loreHookSource / loreHookGuide', () => {
  it('빈 소재면 둘 다 빈 문자열(무주입)', () => {
    expect(loreHookSource([])).toBe('');
    expect(loreHookGuide([])).toBe('');
  });
  it('원문 덧붙임은 사실 줄을 그대로 담고, 작가 블록은 번호와 사용 규칙을 담는다', () => {
    const src = loreHookSource(['꽃말은 겸손한 아름다움이다', '부산의 시목이다']);
    expect(src).toContain('- 꽃말은 겸손한 아름다움이다');
    expect(src).toContain('- 부산의 시목이다');
    const guide = loreHookGuide(['꽃말은 겸손한 아름다움이다']);
    expect(guide).toContain('1. 꽃말은 겸손한 아름다움이다');
    expect(guide).toContain('재배 결론을 밀어내지 마라');
    expect(guide).toContain('안 써도 된다');
  });
});
