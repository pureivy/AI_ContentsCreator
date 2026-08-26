import { describe, it, expect } from 'vitest';
import { REVISE_NO_NEW_FACTS, buildReviseContext } from './org';

describe('리비전 컨텍스트(스펙 §3) — 브리프·목소리 지침이 개정에도 들어간다', () => {
  it('브리프·voiceGuide·기존 초안·수정 요청 순으로 조립한다', () => {
    const ctx = buildReviseContext({ brief: '브리프B', voiceGuide: '[근거와 목소리] V', baseBody: '## 초안', feedback: '고쳐라' });
    expect(ctx.indexOf('[근거와 목소리] V')).toBeGreaterThanOrEqual(0);
    expect(ctx.indexOf('[리서치·SEO 브리프]\n브리프B')).toBeLessThan(ctx.indexOf('[기존 초안]\n## 초안'));
    expect(ctx).toContain('[검토자 수정 요청 — 반드시 반영]\n고쳐라');
  });
  it('브리프가 없으면 그 블록만 빠진다', () => {
    const ctx = buildReviseContext({ brief: '', voiceGuide: 'V', baseBody: 'B', feedback: 'F' });
    expect(ctx).not.toContain('[리서치·SEO 브리프]');
  });
  it('새 사실 금지 문구 상수', () => {
    expect(REVISE_NO_NEW_FACTS).toContain('새 사실·수치·시기를 추가하지 마라');
  });
});
