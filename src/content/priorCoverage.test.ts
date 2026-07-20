import { describe, it, expect } from 'vitest';
import { markdownHeadings } from './priorCoverage';

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
