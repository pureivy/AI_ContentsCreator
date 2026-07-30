import { describe, expect, it } from 'vitest';
import { buildTitleArtPrompt } from './shortsTitleArt';

describe('buildTitleArtPrompt', () => {
  it('2줄 카피 — 두 줄 지시·줄별 색·검은 배경 제약 포함', () => {
    const p = buildTitleArtPrompt({ line1: '삽목 실패', line2: '진짜 원인은', points: [] });
    expect(p).toContain("'삽목 실패'");
    expect(p).toContain("'진짜 원인은'");
    expect(p).toContain('2줄');
    expect(p).toContain('검은색');
    expect(p).toContain('글로우·후광·번짐·그림자·빛무리는 절대');
  });

  it('1줄 카피 — 한 줄 분기(2줄 지시 없음)', () => {
    const p = buildTitleArtPrompt({ line1: '한여름 물주기', line2: '', points: [] });
    expect(p).toContain("'한여름 물주기'");
    expect(p).toContain('한 줄');
    expect(p).not.toContain('2줄');
  });
});
