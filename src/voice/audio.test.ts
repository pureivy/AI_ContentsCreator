import { describe, it, expect } from 'vitest';
import { sanitizeForTts, parseSayVoices } from './audio';

describe('sanitizeForTts', () => {
  it('마크다운/링크/이모지를 제거하고 공백을 정리한다', () => {
    const out = sanitizeForTts('**굵게** [링크](http://x) 끝 🎉\n\n다음줄');
    expect(out).not.toContain('**');
    expect(out).not.toContain('](http');
    expect(out).not.toContain('🎉');
    expect(out).toContain('굵게');
    expect(out).toContain('링크');
    expect(out).toContain('다음줄');
  });

  it('maxLen 으로 길이를 자른다', () => {
    expect(sanitizeForTts('가'.repeat(5000), 100).length).toBeLessThanOrEqual(100);
  });
});

describe('parseSayVoices', () => {
  it('say -v ? 출력에서 ko_KR 음성 이름만 추출한다', () => {
    const raw = [
      'Alex                en_US    # Most people recognize me by my voice.',
      'Yuna                ko_KR    # 안녕하세요. 제 이름은 유나입니다.',
      'Eddy (한국어(한국))      ko_KR    # 안녕하세요.',
      'Sandy               en_US    # Hello',
    ].join('\n');
    const v = parseSayVoices(raw);
    expect(v).toContain('Yuna');
    expect(v).toContain('Eddy');
    expect(v).not.toContain('Alex');
  });
});
