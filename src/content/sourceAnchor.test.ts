import { describe, it, expect } from 'vitest';
import { anchorFound, anchorsOf, anchorIssues, withAnchor, anchorOn } from './sourceAnchor';

const SRC = [
  '## 상처 크기',
  '손가락 한 개 정도 굵기면 **선택**입니다. 비가 잦으면 바르는 편이 낫습니다.',
  '그보다 굵으면 면이 마른 뒤 얇게 덮으세요.',
].join('\n');

describe('anchorFound — 짚은 문장이 원문에 실제로 있는가', () => {
  it('글자 그대로(공백·굵은 글씨 무시)면 참', () => {
    expect(anchorFound('손가락 한 개 정도 굵기면 선택입니다.', SRC)).toBe(true);
  });
  it('두 문장을 이어 붙여도 각각 원문에 있으면 참', () => {
    expect(anchorFound('비가 잦으면 바르는 편이 낫습니다. 그보다 굵으면 면이 마른 뒤 얇게 덮으세요.', SRC)).toBe(true);
  });
  it('지어낸 인용(원문에 없는 단정)은 거짓', () => {
    expect(anchorFound('손가락 하나로 가려지면 그냥 둬도 됩니다.', SRC)).toBe(false);
  });
  it('너무 짧으면 거짓', () => {
    expect(anchorFound('선택', SRC)).toBe(false);
  });
});

describe('anchorsOf·anchorIssues·withAnchor', () => {
  it('src 없는 씬은 빈 문자열', () => {
    expect(anchorsOf([{ src: ' 문장. ' }, {}, null])).toEqual(['문장.', '', '']);
  });
  it('훅·CTA 는 빼고 본문 씬만 — 근거 없음·원문에 없음을 센다', () => {
    const issues = anchorIssues(['', '', '손가락 하나로 가려지면 그냥 둬도 됩니다.', '그보다 굵으면 면이 마른 뒤 얇게 덮으세요.', ''], 5, SRC);
    expect(issues).toEqual([
      '씬2: 근거 원문 문장 없음',
      '씬3: 적은 근거가 원문에 없음 — "손가락 하나로 가려지면 그냥 둬도 됩니다."',
    ]);
  });
  it('원문에 있는 근거만 판정 입력에 붙인다', () => {
    expect(withAnchor('씬', '그보다 굵으면 면이 마른 뒤 얇게 덮으세요.', SRC)).toContain('이 씬의 원문 근거');
    expect(withAnchor('씬', '지어낸 문장입니다 정말로.', SRC)).toBe('씬');
  });
});

describe('anchorOn — 스위치', () => {
  it('off 기본, instagram 이면 인스타만, all 이면 전부', () => {
    expect(anchorOn('off', 'instagram')).toBe(false);
    expect(anchorOn('instagram', 'instagram')).toBe(true);
    expect(anchorOn('instagram', 'youtube')).toBe(false);
    expect(anchorOn('all', 'youtube')).toBe(true);
  });
});
