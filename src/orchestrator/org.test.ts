import { describe, it, expect } from 'vitest';
import { REVISE_NO_NEW_FACTS, buildReviseContext, BLOG_BODY_GUIDE } from './org';
import { FACT_CARD_HEADER } from '../content/factGate';

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
  it('사실 카드(2026-08-26)가 있으면 맨 앞 블록으로 들어간다', () => {
    const ctx = buildReviseContext({ factCard: '- 사실', brief: '브리프B', voiceGuide: 'V', baseBody: '## 초안', feedback: '고쳐라' });
    expect(ctx.startsWith(`${FACT_CARD_HEADER}\n- 사실`)).toBe(true);
  });
  it('사실 카드가 없으면 그 블록만 빠진다(기존 순서 불변)', () => {
    const ctx = buildReviseContext({ brief: '브리프B', voiceGuide: 'V', baseBody: 'B', feedback: 'F' });
    expect(ctx).not.toContain('[사실 카드');
  });
});

it('BLOG_BODY_GUIDE — 사실 범위 한정·[근거:] 표기 금지 문구', () => {
  expect(BLOG_BODY_GUIDE).toContain('브리프·제공 자료에 있는 것만 쓴다');
  expect(BLOG_BODY_GUIDE).toContain('[근거: …] 표기는 남기지 않는다');
  expect(BLOG_BODY_GUIDE).not.toContain('사실·수치는 근거로 뒷받침([근거: 출처])');
});

// 골격 다양화(2026-08-27 권고 4) — 자리 고정 문구가 매 글 같은 배치를 만들던 것을 시드에 위임한다.
it('BLOG_BODY_GUIDE — 인용구·프레임·표의 자리 고정 문구가 [이번 글 구조] 위임으로 바뀌었다', () => {
  expect(BLOG_BODY_GUIDE).toContain('글당 0~1곳 — 아래 [이번 글 구조] 지시를 따른다');
  expect(BLOG_BODY_GUIDE).not.toContain('글의 중심 명제 한 문장(글당 1곳, 도입 훅 직후가 최적)');
  expect(BLOG_BODY_GUIDE).toContain('아래 [이번 글 구조] 에서 켜졌을 때만');
  expect(BLOG_BODY_GUIDE).toContain('이번 글에 넣을지는 아래 [이번 글 구조] 를 따른다');
});

it('리비전 컨텍스트에 [이번 글 구조] 블록이 들어간다(같은 시드 승계)', () => {
  const ctx = buildReviseContext({ brief: 'B', voiceGuide: 'V', baseBody: '초안', feedback: 'F', structure: '[이번 글 구조] 골격' });
  expect(ctx).toContain('[이번 글 구조] 골격');
  expect(ctx.indexOf('[이번 글 구조] 골격')).toBeLessThan(ctx.indexOf('[기존 초안]'));
});
