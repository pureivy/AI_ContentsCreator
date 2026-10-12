import { describe, it, expect } from 'vitest';
import { matchMedia, type MediaItem } from './mediaLibrary';

const mk = (o: Partial<MediaItem>): MediaItem => ({
  id: o.id ?? 'm', file: '/f.jpg', kind: o.kind ?? 'image', name: 'f.jpg', bytes: 1,
  createdTs: o.createdTs ?? '2026-09-01T00:00:00Z', ...o,
} as MediaItem);

describe('matchMedia — 주제에 맞는 소재 고르기', () => {
  it('수종이 맞는 소재가 최우선', () => {
    const items = [mk({ id: 'a' }), mk({ id: 'b', species: '수국' })];
    expect(matchMedia(items, { species: '수국' })[0]!.id).toBe('b');
  });
  it('다른 수종은 아예 안 쓴다 — 수국 편에 회양목 사진은 없느니만 못하다', () => {
    const items = [mk({ id: 'x', species: '회양목' })];
    expect(matchMedia(items, { species: '수국' })).toHaveLength(0);
  });
  it('수종 없는 범용 소재는 쓴다', () => {
    const items = [mk({ id: 'g' })];
    expect(matchMedia(items, { species: '수국' })).toHaveLength(1);
  });
  it('제목에 적힌 둘째 수종의 소재도 쓴다 — 주 수종 소재가 없으면 그것이 유일한 실촬영(2026-09-18 복숭아·자두 실사고)', () => {
    const text = '복숭아나무와 자두나무, 손 가는 일이 다릅니다';
    const plum = mk({ id: 'plum', kind: 'video', species: '자두나무' });
    expect(matchMedia([plum], { species: '복숭아나무', text, kind: 'video' }).map((m) => m.id)).toEqual(['plum']);
    // 주 수종 소재가 있으면 그쪽이 먼저
    const peach = mk({ id: 'peach', kind: 'video', species: '복숭아나무', createdTs: '2026-08-01T00:00:00Z' });
    expect(matchMedia([plum, peach], { species: '복숭아나무', text, kind: 'video' }).map((m) => m.id)).toEqual(['peach', 'plum']);
    // 제목에 없는 수종은 여전히 배제
    const fig = mk({ id: 'fig', kind: 'video', species: '무화과나무' });
    expect(matchMedia([fig], { species: '복숭아나무', text, kind: 'video' })).toHaveLength(0);
  });
  it('태그가 주제에 걸리면 점수가 오른다', () => {
    const items = [mk({ id: 'p' }), mk({ id: 'q', tags: ['전정'] })];
    expect(matchMedia(items, { text: '가을 전정 방법' })[0]!.id).toBe('q');
  });
  it('종류로 거른다', () => {
    const items = [mk({ id: 'i', kind: 'image' }), mk({ id: 'v', kind: 'video' })];
    expect(matchMedia(items, { kind: 'video' }).map((m) => m.id)).toEqual(['v']);
  });
  it('상한을 지킨다', () => {
    const items = Array.from({ length: 20 }, (_, i) => mk({ id: `m${i}` }));
    expect(matchMedia(items, { limit: 3 })).toHaveLength(3);
  });
  it('같은 점수면 최신 우선', () => {
    const items = [
      mk({ id: 'old', species: '수국', createdTs: '2026-01-01T00:00:00Z' }),
      mk({ id: 'new', species: '수국', createdTs: '2026-09-01T00:00:00Z' }),
    ];
    expect(matchMedia(items, { species: '수국' })[0]!.id).toBe('new');
  });
  // 2026-09-04 실측 사고 — 사장님이 '사계장미' 딱지를 붙여 올린 영상이 사계장미 편에서 배제됐다.
  // 그 시점 수종 사전에 사계장미가 없어 opts.species 가 비었고, 딱지가 붙은 소재는 점수가 0이었다.
  it('사전이 그 수종을 몰라도 주제 문장에 이름이 있으면 쓴다', () => {
    const items = [mk({ id: 'r', species: '사계장미', kind: 'video' })];
    const got = matchMedia(items, { text: '사계장미 전정, 꽃 진 자리 어디를 자르나요', kind: 'video' });
    expect(got.map((m) => m.id)).toEqual(['r']);
  });
  it('사전도 모르고 주제에도 이름이 없으면 안 쓴다', () => {
    const items = [mk({ id: 'r', species: '사계장미' })];
    expect(matchMedia(items, { text: '수국 9월 관리' })).toHaveLength(0);
  });
  it('주 수종 판정이 있어도 제목에 적힌 다른 수종 딱지는 쓴다 — 제목에 없는 수종만 배제(2026-09-18 규칙 변경)', () => {
    // 종전(09-04)엔 사전 판정이 있으면 제목 문장을 안 봤다. 그 규칙이 "복숭아나무와 자두나무" 편에서 자두 영상을
    // 버리게 했다. 제목이 그 수종을 직접 부르면 그 소재는 무관하지 않다.
    const items = [mk({ id: 'r', species: '사계장미' })];
    expect(matchMedia(items, { species: '회양목', text: '사계장미 전정' })).toHaveLength(1);
    expect(matchMedia(items, { species: '회양목', text: '회양목 전정' })).toHaveLength(0);
  });
  it('빈 목록은 빈 결과', () => {
    expect(matchMedia([], { species: '수국' })).toEqual([]);
  });
});

describe('matchMedia — 별칭이 달라도 같은 나무면 쓴다(2026-09-04 실사고)', () => {
  // 사장님이 '음나무'로 딱지를 붙여 올린 영상이 '엄나무 묘목' 편에서 배제됐다.
  // 같은 나무(Kalopanax septemlobus)인데 부르는 이름이 둘이고 코드는 글자만 비교했다.
  const canon = (n: string): string => (['엄나무', '음나무', '개두릅나무'].includes(n) ? '음나무' : n);

  it('사전이 아는 별칭은 표준명으로 맞춘다', () => {
    const items = [mk({ id: 'v', species: '음나무', kind: 'video' })];
    expect(matchMedia(items, { species: '엄나무', kind: 'video', canon }).map((m) => m.id)).toEqual(['v']);
  });
  it('반대 방향도 같다 — 소재에 별칭, 주제에 표준명', () => {
    const items = [mk({ id: 'v', species: '엄나무' })];
    expect(matchMedia(items, { species: '음나무', canon })).toHaveLength(1);
  });
  it('사전 판정이 없어도 주제 문장에 사용자가 적은 표기가 있으면 쓴다', () => {
    const items = [mk({ id: 'v', species: '음나무' })];
    expect(matchMedia(items, { text: '음나무 묘목 고르기', canon })).toHaveLength(1);
  });
  it('다른 나무는 여전히 배제한다 — 별칭 처리가 문을 열어서는 안 된다', () => {
    const items = [mk({ id: 'v', species: '두릅나무' })];
    expect(matchMedia(items, { species: '엄나무', canon })).toHaveLength(0);
  });
  it('canon 이 없으면 종전대로 글자 비교', () => {
    const items = [mk({ id: 'v', species: '음나무' })];
    expect(matchMedia(items, { species: '엄나무' })).toHaveLength(0);
  });
  it('canon 이 던져도 안 터진다 — 사전 실패로 소재를 잃지 않는다', () => {
    const items = [mk({ id: 'v', species: '음나무' })];
    const boom = (): string => { throw new Error('사전 고장'); };
    expect(matchMedia(items, { species: '음나무', canon: boom })).toHaveLength(1);
  });
});

describe("matchMedia — 사전이 모르는 딱지도 '나무'를 뗀 어간으로 맞춘다(2026-09-08)", () => {
  const items = [
    { id: 'a', file: '/x/a.mp4', kind: 'video', name: 'a', bytes: 1, species: '매실나무', createdTs: '2026-09-08T00:00:00Z' },
    { id: 'b', file: '/x/b.mp4', kind: 'video', name: 'b', bytes: 1, species: '배나무', createdTs: '2026-09-08T00:00:00Z' },
  ] as never[];
  it("'매실 수확 시기' 제목이 '매실나무' 딱지 영상을 잡는다", () => {
    expect(matchMedia(items, { text: '매실 수확 시기', kind: 'video' }).map((m) => m.id)).toEqual(['a']);
  });
  it("1자 어간은 안 쓴다 — '배수' 제목이 '배나무' 영상을 잡으면 안 된다", () => {
    expect(matchMedia(items, { text: '마당 배수 문제', kind: 'video' })).toEqual([]);
  });
});

// 2026-10-12 사장님 지시 — 보관소 태그는 촬영 연월("2026년 10월"). 이번 달 우선, 없으면 지난달, 한 등급 안에서 섞지 않는다.
import { pickShootMonth, shootYmOf, isShootDateTag, matchMediaScored as mms } from './mediaLibrary';
const YM = (y: number, m: number) => y * 12 + m - 1;
describe('pickShootMonth — 촬영 연월 고르기', () => {
  const v = (id: string, species: string, tags: string[], createdTs = '2026-10-05T00:00:00Z') => ({ id, file: `/x/${id}.mp4`, kind: 'video' as const, name: id, bytes: 1, species, tags, createdTs });
  it('이번 달 영상이 있으면 이번 달 것만(촬영 월 모르는 소재는 남김)', () => {
    const lib = [v('a', '감나무', ['2026년 9월']), v('b', '감나무', ['2026년 10월']), v('c', '감나무', [])];
    expect(mms(lib, { species: '감나무', text: '감나무', kind: 'video', nowYm: YM(2026, 10) }).map((x) => x.item.id).sort()).toEqual(['b', 'c']);
  });
  it('이번 달이 없으면 지난달 것만 · 작년 같은 달은 이번 달이 아니다', () => {
    const lib = [v('a', '단풍나무', ['2026년 9월']), v('b', '단풍나무', ['2025년 10월'])];
    expect(mms(lib, { species: '단풍나무', text: '단풍나무', kind: 'video', nowYm: YM(2026, 10) }).map((x) => x.item.id)).toEqual(['a']);
  });
  it('1월의 지난달은 작년 12월', () => {
    const out = pickShootMonth([{ m: { tags: ['2026년 12월'] }, g: 150 }, { m: { tags: ['2026년 11월'] }, g: 150 }], YM(2027, 1));
    expect(out).toEqual([{ m: { tags: ['2026년 12월'] }, g: 150 }]);
  });
  it('등급마다 따로 고른다', () => {
    expect(pickShootMonth([{ m: { tags: ['2026년 9월'] }, g: 150 }, { m: { tags: ['2026년 10월'] }, g: 100 }], YM(2026, 10))).toHaveLength(2);
  });
  it('shootYmOf — 연도 태그, 연도 없는 태그는 올린 날 기준(올린 달보다 크면 작년)', () => {
    expect(shootYmOf({ tags: ['2026년 10월'] })).toBe(YM(2026, 10));
    expect(shootYmOf({ tags: ['10월'], createdTs: '2026-10-12T00:00:00Z' })).toBe(YM(2026, 10));
    expect(shootYmOf({ tags: ['12월'], createdTs: '2027-01-03T00:00:00Z' })).toBe(YM(2026, 12));
    expect(shootYmOf({ tags: ['2026년 9월', '2026년 10월'] })).toBeNull();
    expect(isShootDateTag('2026년 10월')).toBe(true);
    expect(isShootDateTag('10월')).toBe(true);
    expect(isShootDateTag('열매')).toBe(false);
  });
});
