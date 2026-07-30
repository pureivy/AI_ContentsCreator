import { describe, expect, it } from 'vitest';
import { buildTitleArtPrompt } from './shortsTitleArt';

describe('buildTitleArtPrompt', () => {
  it('2줄 카피 — 한 줄로 이어 그리기(두 문구·색 구분 유지, 2줄 지시 없음)', () => {
    const p = buildTitleArtPrompt({ line1: '삽목 실패', line2: '진짜 원인은', points: [] });
    expect(p).toContain("'삽목 실패'");
    expect(p).toContain("'진짜 원인은'");
    expect(p).toContain('한 줄');
    expect(p).toContain('크림 화이트');
    expect(p).toContain('노랑');
    expect(p).toContain('줄바꿈 없이');
    expect(p).not.toContain('2줄');
    expect(p).toContain('검은색');
    expect(p).toContain('글로우·후광·번짐·그림자·빛무리는 절대');
  });

  it('1줄 카피 — 단독 한 줄(노랑 구간 없음)', () => {
    const p = buildTitleArtPrompt({ line1: '한여름 물주기', line2: '', points: [] });
    expect(p).toContain("'한여름 물주기'");
    expect(p).toContain('한 줄');
    expect(p).not.toContain('노랑');
    expect(p).not.toContain('2줄');
  });
});
