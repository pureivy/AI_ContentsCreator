import { describe, it, expect } from 'vitest';
import { namedAt, speciesAdviceNeed, factsUsedIn, parseSpeciesAdvice, speciesAdviceFeedback, speciesAdviceGuide } from './speciesAdvice';

describe('factsUsedIn — 같은 수종 최근 글에 이미 쓴 도감 사실', () => {
  it('어미가 바뀌어도 한 문장에 담겼으면 쓴 것, 다른 내용은 아님', () => {
    const body = '## 호두나무\n호두나무는 성목이 되면 10~15m까지 올라가고 수관이 넓게 퍼집니다. 물은 흙이 마를 때 줍니다.';
    const used = factsUsedIn(['호두나무는 성목이 되면 10~15m까지 자란다', '호두나무는 눈이 늦게 튼다'], [body]);
    expect(used.has('호두나무는 성목이 되면 10~15m까지 자란다')).toBe(true);
    expect(used.has('호두나무는 눈이 늦게 튼다')).toBe(false);
  });
  it('사진 자리·주석 줄은 보지 않는다', () => {
    expect(factsUsedIn(['호두나무는 눈이 늦게 튼다'], ['[IMAGE: 호두나무는 눈이 늦게 튼다]']).size).toBe(0);
  });
});

describe('parseSpeciesAdvice — 검사 응답', () => {
  it('수종 고유·일반론 개수를 센다, 형식이 틀리면 null', () => {
    const c = parseSpeciesAdvice({ items: [
      { text: '5월까지 기다린 뒤 판정', specific: true, trait: '눈이 늦게 틈' },
      { text: '줄기 흔들어 보기', specific: false, trait: '무시' },
      { text: '', specific: true },
    ] });
    expect(c).toEqual({ items: [{ text: '5월까지 기다린 뒤 판정', specific: true, trait: '눈이 늦게 틈' }, { text: '줄기 흔들어 보기', specific: false }], specific: 1, generic: 1 });
    expect(parseSpeciesAdvice({ items: 'x' })).toBeNull();
    expect(parseSpeciesAdvice({ items: [] })).toBeNull();
  });
});

describe('지침·피드백 문구', () => {
  it('일반론 조언과 쓸 사실을 담고, 지어내지 말라고 한다', () => {
    const f = speciesAdviceFeedback('대추나무', { items: [{ text: '줄기 흔들기', specific: false }], specific: 0, generic: 1 }, ['- [이 주제] 대추나무는 새싹이 늦게 튼다 (근거: a, u)']);
    expect(f).toContain('0개뿐');
    expect(f).toContain('- 줄기 흔들기');
    expect(f).toContain('새싹이 늦게 튼다');
    expect(f).toContain('지어내지 마라');
    expect(speciesAdviceGuide('대추나무', '활착')).toContain('주제 "활착"');
  });
});

describe('speciesAdviceNeed', () => {
  it('2개 이상, 조언의 30% 이상', () => {
    expect(speciesAdviceNeed(4)).toBe(2);
    expect(speciesAdviceNeed(15)).toBe(5);
  });
});

describe('코드 리뷰 반영 2026-11-03', () => {
  it('namedAt — 다른 수종 이름 속 부분은 아니다', () => {
    expect(namedAt('겹벚나무 꽃 시기', '벚나무')).toBe(false);
    expect(namedAt('벚나무 꽃 시기', '벚나무')).toBe(true);
    expect(namedAt('정원 벚나무', '벚나무')).toBe(true);
    expect(namedAt('백목련 가지치기', '목련')).toBe(false);
  });
  it('factsUsedIn — 수종 이름만 겹친 짧은 사실은 쓴 것으로 보지 않는다', () => {
    const body = '대추나무는 대추나무 밭에서 키웁니다.';
    expect(factsUsedIn(['대추나무는 가시가 있다'], [body], 0.6, ['대추나무']).size).toBe(0);
  });
});
