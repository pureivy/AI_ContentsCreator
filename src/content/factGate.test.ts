// src/content/factGate.test.ts
import { describe, it, expect } from 'vitest';
import {
  splitBodySentences, numericClaimSentences, buildEvidence, gateVerdict, formatGateFeedback, toFactGateInfo,
} from './factGate';
import type { FactClaim, FactGateResult } from './factGate';

describe('splitBodySentences — 마크다운 본문을 판정 단위 문장으로', () => {
  it('소제목·표 행·목록을 문장으로 살리고 [IMAGE:]·코드펜스는 버린다', () => {
    const md = [
      '## 물주기 기준', '흙이 마르면 줍니다. 겉흙 3cm가 말랐을 때가 기준이에요.',
      '[IMAGE: 화분 사진]', '```', 'code', '```',
      '| 나이 | 화분 |', '|---|---|', '| 1년생 | 6~8호 |', '- 9월에는 거름을 줄입니다',
    ].join('\n');
    const s = splitBodySentences(md);
    expect(s).toContain('물주기 기준');
    expect(s).toContain('흙이 마르면 줍니다.');
    expect(s).toContain('겉흙 3cm가 말랐을 때가 기준이에요.');
    expect(s).toContain('1년생 · 6~8호');
    expect(s).toContain('9월에는 거름을 줄입니다');
    expect(s.some((x) => x.includes('IMAGE'))).toBe(false);
    expect(s.some((x) => x === 'code')).toBe(false);
    expect(s.some((x) => /^\|?-{3}/.test(x))).toBe(false);
  });
});

describe('numericClaimSentences — 수치·시기 문장 결정적 추출', () => {
  it('단위 수치·월·고유어 월·절기·연도 문장을 뽑는다', () => {
    const md = [
      '겉흙 3cm가 말랐을 때 줍니다.', '9월에는 거름을 줄입니다.', '시월이 지나면 물을 더 줄여요.',
      '처서가 지나면 새순이 멈춥니다.', '2025년 기준입니다.', '잔뿌리를 먼저 봅니다.', '두 해째 나무라면 가지가 열 개 안팎입니다.',
    ].join('\n');
    const s = numericClaimSentences(md);
    expect(s).toContain('겉흙 3cm가 말랐을 때 줍니다.');
    expect(s).toContain('9월에는 거름을 줄입니다.');
    expect(s).toContain('시월이 지나면 물을 더 줄여요.');
    expect(s).toContain('처서가 지나면 새순이 멈춥니다.');
    expect(s).toContain('2025년 기준입니다.');
    expect(s).not.toContain('잔뿌리를 먼저 봅니다.');
  });
  it('상한을 지키고 중복은 없앤다', () => {
    const md = Array.from({ length: 40 }, (_, i) => `${i + 1}cm 간격으로 심습니다.`).join('\n') + '\n3cm 간격으로 심습니다.';
    expect(numericClaimSentences(md, 10)).toHaveLength(10);
    expect(new Set(numericClaimSentences(md)).size).toBe(numericClaimSentences(md).length);
  });
});

describe('buildEvidence — 근거 말뭉치 조립', () => {
  it('블록마다 머리말을 붙이고 빈 블록은 뺀다', () => {
    const e = buildEvidence({ brief: '브리프 내용', critiqueText: '', wikiGrounding: '### 감나무 [런 산출 요약]\n발췌', verified: '- (2026-08-25) 4월 하순 부화 _(근거: 농사로)_' });
    expect(e).toContain('[리서치·SEO 브리프]\n브리프 내용');
    expect(e).toContain('[작가에게 주입된 위키 발췌]');
    expect(e).toContain('[근거 표기된 지식(verified)]');
    expect(e).not.toContain('[검수 의견]');
  });
  it('블록별 상한으로 자른다(브리프 12000자)', () => {
    const e = buildEvidence({ brief: 'x'.repeat(20000) });
    expect(e.length).toBeLessThan(12500);
  });
});

describe('gateVerdict — 판정 집계', () => {
  const c = (text: string, status: FactClaim['status'], kind: FactClaim['kind'] = 'number'): FactClaim => ({ text, kind, status });
  it('supported·hedged_general 만 있으면 pass', () => {
    expect(gateVerdict([c('a', 'supported'), c('b', 'hedged_general', 'general')]).status).toBe('pass');
  });
  it('unsupported 1건이면 hold, 목록에 원문이 들어간다', () => {
    const v = gateVerdict([c('5cm 두께로 덮습니다', 'unsupported')]);
    expect(v.status).toBe('hold');
    expect(v.unsupported).toEqual(['5cm 두께로 덮습니다']);
    expect(v.contradicted).toEqual([]);
  });
  it('contradicted 는 근거 발췌를 붙여 보고한다', () => {
    const v = gateVerdict([{ text: '잎이 진 뒤 거름', kind: 'time', status: 'contradicted', evidence: '자사 글: 추분 후 시비' }]);
    expect(v.status).toBe('hold');
    expect(v.contradicted[0]).toBe('잎이 진 뒤 거름 ← 근거: 자사 글: 추분 후 시비');
  });
});

describe('formatGateFeedback / toFactGateInfo', () => {
  const r: FactGateResult = {
    status: 'hold', claims: [], unsupported: ['5cm 두께로 덮습니다'], contradicted: ['잎이 진 뒤 거름 ← 근거: 추분 후'],
    repaired: false, checkedTs: '2026-08-26T00:00:00.000Z',
  };
  it('작가 수정 요청문에 문장 목록과 새 사실 금지 규칙이 들어간다', () => {
    const f = formatGateFeedback(r);
    expect(f).toContain('5cm 두께로 덮습니다');
    expect(f).toContain('잎이 진 뒤 거름');
    expect(f).toContain('새 사실·수치를 추가하지 마라');
  });
  it('info 는 claims 를 뺀 요약만 담는다', () => {
    expect(toFactGateInfo(r)).toEqual({ status: 'hold', unsupported: r.unsupported, contradicted: r.contradicted, checkedTs: r.checkedTs });
  });
});
