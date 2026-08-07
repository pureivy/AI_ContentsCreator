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

  // 발화 첫머리 "잎" 오독 보정(실측 2026-08-07) — ElevenLabs 가 발화 시작의 "잎"을 로마자 ip 로
  // 읽어 "아이피"가 됐다(쇼츠 보리수 편 씬3·씬6 STT 재현). 종성 중화로 발음이 같은 "입"으로 치환.
  describe('발화 첫머리 잎 → 입 (발음 동일 치환, TTS 입력 전용)', () => {
    it('문두 "잎과"·"잎 "·단독 "잎"은 입으로', () => {
      expect(sanitizeForTts('잎과 뿌리만 보면 헷갈릴 일 없어요.')).toMatch(/^입과/);
      expect(sanitizeForTts('잎 뒷면에 은빛 비늘이 있으면')).toMatch(/^입 /);
      expect(sanitizeForTts('잎')).toBe('입');
      expect(sanitizeForTts('잎도 봅니다')).toMatch(/^입도/);
    });

    it('모음 조사(잎이·잎을)는 발음이 달라지므로 치환하지 않는다 — 실측상 오독도 없음', () => {
      expect(sanitizeForTts('잎이 나야 봄입니다.')).toMatch(/^잎이/);
      expect(sanitizeForTts('잎을 먼저 보세요')).toMatch(/^잎을/);
    });

    it('문장 중간의 잎은 건드리지 않는다', () => {
      expect(sanitizeForTts('그래서 잎과 열매로 구분합니다')).toContain('그래서 잎과');
    });
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
