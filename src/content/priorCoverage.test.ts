import { describe, it, expect } from 'vitest';
import { markdownHeadings, styleSignatureOf } from './priorCoverage';

describe('markdownHeadings — 소제목 추출(관점 다양성 주입 소스)', () => {
  it('##/### 소제목만 뽑고, 해시태그 줄(# 2개+)은 배제·cap 적용', () => {
    const body = [
      '# 큰제목',
      '본문 문단입니다.',
      '## 두 품종이 필수인 이유',
      '설명...',
      '### 심는 순서',
      '## 하스카프베리 #하스카프베리 #허니베리 #베리키우기', // 태그 나열 줄 — 제외돼야
    ].join('\n');
    const heads = markdownHeadings(body);
    expect(heads).toContain('두 품종이 필수인 이유');
    expect(heads).toContain('심는 순서');
    expect(heads).toContain('큰제목');
    expect(heads.some((h) => h.includes('#하스카프베리'))).toBe(false); // 태그 줄 배제
  });

  it('cap 으로 개수 제한', () => {
    const body = Array.from({ length: 10 }, (_, i) => `## 소제목${i}`).join('\n');
    expect(markdownHeadings(body, 3)).toHaveLength(3);
  });

  it('소제목 없으면 빈 배열', () => {
    expect(markdownHeadings('그냥 평문만 있습니다.\n두 번째 줄.')).toEqual([]);
  });
});

// 교차-글 스타일 다양성(2026-07-23 감사) — 도입 첫 문장·마무리 소제목·소제목 골격 추출.
describe('styleSignatureOf — 스타일 지문 추출(도입·마무리·구성)', () => {
  it('도입 첫 문장·마지막 소제목·소제목 골격을 뽑는다', () => {
    const body = [
      '장마 끝나고 마당이 허전한데, 지금 씨앗을 뿌려도 될지 망설이는 분들이 많습니다. 결론부터 말하면 가능합니다.',
      '',
      '## 7월 고온기에 잘 자라는 꽃',
      '설명...',
      '## 오늘 바로 할 일',
      '정리...',
    ].join('\n');
    const s = styleSignatureOf(body);
    expect(s.opening.startsWith('장마 끝나고')).toBe(true);
    expect(s.opening.includes('결론부터')).toBe(false); // 첫 문장까지만
    expect(s.closing).toBe('오늘 바로 할 일');
    expect(s.headings).toContain('7월 고온기에 잘 자라는 꽃');
  });
  it('빈 본문은 빈 지문', () => {
    const s = styleSignatureOf('');
    expect(s.opening).toBe('');
    expect(s.closing).toBe('');
  });
});
