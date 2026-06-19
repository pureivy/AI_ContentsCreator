import { describe, it, expect } from 'vitest';
import { extractVerifiedClaims } from './workspace';

describe('extractVerifiedClaims (검증 지식 Self-RAG)', () => {
  it('[근거: 출처] 태그가 붙은 주장만 추출한다', () => {
    const t = '경북 수출이 전년 대비 증가했다 [근거: 통계청 2024]. 이건 추측이라 태그가 없다.';
    const r = extractVerifiedClaims(t);
    expect(r.length).toBe(1);
    expect(r[0]!.source).toBe('통계청 2024');
    expect(r[0]!.claim).toContain('수출');
  });

  it('태그가 없으면 빈 배열', () => {
    expect(extractVerifiedClaims('근거 표시가 전혀 없는 일반 문장이다.')).toEqual([]);
  });

  it('여러 주장 + 전각 콜론(：) 변형을 처리한다', () => {
    const t = '민간 투자가 확대되었다 [근거: 진흥원 보고서]\n고용지표가 개선되었다 [근거：고용노동부]';
    const r = extractVerifiedClaims(t);
    expect(r.length).toBe(2);
    expect(r.map((x) => x.source)).toEqual(['진흥원 보고서', '고용노동부']);
    expect(r[0]!.claim).toContain('투자');
    expect(r[1]!.claim).toContain('고용');
  });

  it('너무 짧은 주장(8자 미만)이나 빈 출처는 버린다', () => {
    expect(extractVerifiedClaims('짧다 [근거: x]')).toEqual([]);
    expect(extractVerifiedClaims('충분히 긴 사실 주장이다 [근거: ]')).toEqual([]);
  });

  it('빈 입력은 빈 배열', () => {
    expect(extractVerifiedClaims('')).toEqual([]);
  });
});
