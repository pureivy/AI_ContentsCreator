import { describe, it, expect } from 'vitest';
import { normalizeBrand, brandContext, brandProductLines, brandSeedKeywords, brandSlug, isSafeBrandSlug, brandFileSuffixFor } from './brand';

// 브랜드 프로필 — 정규화·주입 블록(순수 함수) 회귀 방지.
describe('normalizeBrand', () => {
  it('name 이 없으면 null(미설정)', () => {
    expect(normalizeBrand(null)).toBeNull();
    expect(normalizeBrand({})).toBeNull();
    expect(normalizeBrand({ name: '  ' })).toBeNull();
  });
  it('제품은 name 필수·트림·캡', () => {
    const b = normalizeBrand({
      name: ' 한빛수제청 ',
      products: [{ name: ' 유자청 ', features: ' 국산 유자 100% ' }, { name: '' }, { name: '자몽청' }],
    })!;
    expect(b.name).toBe('한빛수제청');
    expect(b.products.map((p) => p.name)).toEqual(['유자청', '자몽청']);
    expect(b.products[0]!.features).toBe('국산 유자 100%');
  });
  it('배열 필드는 빈 항목 제거', () => {
    const b = normalizeBrand({ name: 'X', products: [], seedKeywords: ['수제청', '', ' 선물세트 '], banned: [' 과장 광고 '] })!;
    expect(b.seedKeywords).toEqual(['수제청', '선물세트']);
    expect(b.banned).toEqual(['과장 광고']);
  });
});

describe('brandContext', () => {
  it('미설정이면 빈 문자열(기존 동작 불변 보장)', () => {
    expect(brandContext(null)).toBe('');
  });
  it('설정 시 업체·제품·타겟·금지를 포함한 블록', () => {
    const b = normalizeBrand({
      name: '한빛수제청', industry: '식품', products: [{ name: '유자청', features: '국산 유자 100%' }],
      audience: '3040 주부', tone: '친근한 존댓말', banned: ['최고'], seedKeywords: ['수제청'],
    })!;
    const ctx = brandContext(b);
    expect(ctx).toContain('[브랜드 컨텍스트');
    expect(ctx).toContain('한빛수제청');
    expect(ctx).toContain('유자청 — 국산 유자 100%');
    expect(ctx).toContain('3040 주부');
    expect(ctx).toContain('금지: 최고');
    expect(ctx).toContain('노골적 광고 금지');
  });
});

describe('isSafeBrandSlug — 경로 탈출 차단', () => {
  it('정상 슬러그(한글 포함) 허용', () => {
    expect(isSafeBrandSlug('국민원예종묘')).toBe(true);
    expect(isSafeBrandSlug('hanbit-청')).toBe(true);
  });
  it('경로 문자·빈 값·과길이 거부', () => {
    for (const bad of ['../secrets', '..', 'a/b', 'a\\b', 'a.yaml', '', 'x'.repeat(65)]) {
      expect(isSafeBrandSlug(bad)).toBe(false);
    }
  });
  it('brandSlug 산출물은 항상 안전', () => {
    for (const name of ['한빛 수제청!', '../../etc', 'A.B/C\\D', '  ']) {
      expect(isSafeBrandSlug(brandSlug(name))).toBe(true);
    }
  });
});

describe('보조 헬퍼', () => {
  const b = normalizeBrand({ name: 'X', products: [{ name: 'A' }, { name: 'B' }], seedKeywords: ['k1'] })!;
  it('제품 라인 목록', () => expect(brandProductLines(b)).toEqual(['A', 'B']));
  it('시드 키워드', () => expect(brandSeedKeywords(b)).toEqual(['k1']));
  it('null 안전', () => {
    expect(brandProductLines(null)).toEqual([]);
    expect(brandSeedKeywords(null)).toEqual([]);
  });
});

describe('brandFileSuffixFor — 명시 슬러그 접미(순수)', () => {
  it("undefined·''(범용) → '', 슬러그 → '-슬러그'", () => {
    expect(brandFileSuffixFor(undefined)).toBe('');
    expect(brandFileSuffixFor('')).toBe('');
    expect(brandFileSuffixFor('브랜드a')).toBe('-브랜드a');
  });
});
