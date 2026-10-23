import { describe, expect, it } from 'vitest';
import { CHAPTER_ORDER, PILOT_BANNED_WORDS, chapterPools, pickHeroSpecies, scriptChars, speciesNorm, validateScript, type LongformScript } from './script';

const SOURCE = '잎이 진 뒤 자릅니다. 9월에는 새 줄기만 자릅니다.';

function make(narrations: Record<string, string[]> = {}): LongformScript {
  return {
    title: '과실나무 겨울 전정 총정리',
    chapters: CHAPTER_ORDER.map((id) => ({
      id,
      title: id,
      segments: (narrations[id] ?? ['잎이 진 뒤 자릅니다.']).map((narration, i) => ({ id: `${id}-${String(i + 1).padStart(2, '0')}`, narration })),
    })),
  };
}

describe('validateScript', () => {
  it('통과하는 대본은 문제가 없다', () => {
    expect(validateScript(make(), SOURCE)).toEqual([]);
  });

  it('장 순서가 다르면 장 순서 문제', () => {
    const s = make();
    [s.chapters[1], s.chapters[2]] = [s.chapters[2]!, s.chapters[1]!];
    expect(validateScript(s, SOURCE).some((p) => p.includes('장 순서'))).toBe(true);
  });

  it('90자를 넘는 세그먼트는 그 id 로 보고한다', () => {
    const issues = validateScript(make({ jadu: ['가'.repeat(91)] }), SOURCE);
    expect(issues.some((p) => p.includes('jadu-01'))).toBe(true);
  });

  it('원문에 있어도 편 금지어(시범: 9월) 문장은 막는다', () => {
    const s = make({ blueberry: ['9월에는 새 줄기만 자릅니다.'] });
    s.bannedWords = PILOT_BANNED_WORDS;
    const issues = validateScript(s, SOURCE);
    expect(issues.some((p) => p.includes('9월'))).toBe(true);
  });

  it('금지어 기본값은 없음 — 새 편은 원문에 있는 9월을 쓸 수 있다', () => {
    expect(validateScript(make({ blueberry: ['9월에는 새 줄기만 자릅니다.'] }), SOURCE)).toEqual([]);
  });

  it('원문에 없는 월은 시기 대조 문제', () => {
    const issues = validateScript(make({ gam: ['11월에 자릅니다.'] }), '잎이 진 뒤 자릅니다');
    expect(issues.some((p) => p.includes('11월'))).toBe(true);
  });

  it("'A가 아니라 B' 는 3회까지만", () => {
    const three = ['가지가 아니라 눈입니다.', '줄기가 아니라 뿌리입니다.', '봄이 아니라 겨울입니다.'];
    expect(validateScript(make({ outro: three }), SOURCE)).toEqual([]);
    const four = [...three, '잎이 아니라 가지입니다.'];
    expect(validateScript(make({ outro: four }), SOURCE).some((p) => p.includes('아니라'))).toBe(true);
  });
});

describe('scriptChars', () => {
  it('공백을 세지 않는다', () => {
    expect(scriptChars(make({ intro: ['가 나'] }))).toBe(2 + 6 * '잎이진뒤자릅니다.'.length);
  });
});

describe('화면 글자 검사', () => {
  it('카드·도해·장 제목 글자의 9월과 원문에 없는 수치도 잡는다', () => {
    const s = make();
    s.bannedWords = PILOT_BANNED_WORDS;
    s.chapters[0]!.title = '9월 정리';
    s.chapters[1]!.segments[0]!.card = { kind: 'list', items: ['11월에 자르기'] };
    s.chapters[2]!.segments[0]!.mg = { kind: 'timeline', start: '7cm', end: '눈' };
    const issues = validateScript(s, SOURCE);
    expect(issues.some((p) => p.includes('intro') && p.includes('9월'))).toBe(true);
    expect(issues.some((p) => p.includes('11월'))).toBe(true);
    expect(issues.some((p) => p.includes('7cm'))).toBe(true);
  });
});

describe('일반화된 대본(2026-10-22)', () => {
  const ep = (): LongformScript => ({
    title: '사과나무 심기 총정리',
    species: ['사과나무', '배나무'],
    chapters: [
      { id: 'intro', title: '시작', species: [], segments: [{ id: 'intro-01', narration: '잎이 진 뒤 자릅니다.' }] },
      { id: 'apple', title: '사과', species: ['사과나무'], segments: [{ id: 'apple-01', narration: '잎이 진 뒤 자릅니다.' }] },
      { id: 'outro', title: '끝', species: [], segments: [{ id: 'outro-01', narration: '잎이 진 뒤 자릅니다.' }] },
    ],
  });
  it('장 id 는 자유 — 시범 순서를 강제하지 않는다', () => {
    expect(validateScript(ep(), SOURCE)).toEqual([]);
  });
  it('세그먼트 id 가 장 id 로 시작하지 않으면 장이 섞인 것', () => {
    const s = ep();
    s.chapters[1]!.segments[0]!.id = 'intro-02';
    expect(validateScript(s, SOURCE).some((p) => p.includes('intro-02'))).toBe(true);
  });
  it('장 id 중복·빈 장은 문제', () => {
    const s = ep();
    s.chapters[2]!.id = 'apple';
    s.chapters[2]!.segments = [];
    const issues = validateScript(s, SOURCE);
    expect(issues.some((p) => p.includes('중복'))).toBe(true);
    expect(issues.some((p) => p.includes('세그먼트 없는'))).toBe(true);
  });
  it('chapterPools — 수종 장은 자기 수종, 일반 장은 편 수종, 시범 장은 CHAPTER_SPECIES 폴백', () => {
    const p = chapterPools(ep());
    expect(p.apple).toEqual({ species: ['사과나무'], own: true });
    expect(p.intro).toEqual({ species: ['사과나무', '배나무'], own: false });
    const pilot = chapterPools(make());
    expect(pilot.jadu).toEqual({ species: ['자두나무'], own: true });
    expect(pilot.intro!.own).toBe(false);
    expect(pilot.intro!.species).toContain('감나무');
  });
  it('chapterPools — 주인공 수종이 있으면 일반 장은 그 수종만(다른 수종 영상 금지), 수종 장은 그대로', () => {
    const p = chapterPools({ ...ep(), heroSpecies: '사과나무' });
    expect(p.intro).toEqual({ species: ['사과나무'], own: false });
    expect(p.apple).toEqual({ species: ['사과나무'], own: true });
  });
  it('pickHeroSpecies — 기준 글 수종(재고 표기로) → 장 수종 최다 → 편 수종 첫째', () => {
    const s = ep();
    expect(pickHeroSpecies('블루베리', s, { 블루베리나무: 30, 사과나무: 10 })).toBe('블루베리나무');
    expect(pickHeroSpecies('감나무', s, { 사과나무: 10 })).toBe('사과나무'); // 재고 없음 → 장 수종 최다
    expect(pickHeroSpecies(undefined, { chapters: [], species: ['배나무'] }, {})).toBe('배나무');
    expect(pickHeroSpecies(undefined, { chapters: [] }, {})).toBeUndefined();
    expect(speciesNorm('블루베리 나무')).toBe('블루베리');
  });
});
