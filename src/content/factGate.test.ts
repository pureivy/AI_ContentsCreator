// src/content/factGate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../orchestrator/agent', () => ({ microJSON: vi.fn() }));
import { microJSON } from '../orchestrator/agent';
import {
  splitBodySentences, numericClaimSentences, buildEvidence, gateVerdict, formatGateFeedback, toFactGateInfo,
  extractFactClaims, judgeClaims, factGateBlog,
} from './factGate';
import type { FactClaim, FactGateResult } from './factGate';

const mocked = microJSON as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mocked.mockReset());

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

describe('extractFactClaims — 추출 프롬프트·검증', () => {
  it('mustInclude 문장을 프롬프트에 넣고, 알 수 없는 kind 는 general 로 정규화한다', async () => {
    mocked.mockResolvedValueOnce({ claims: [{ text: '겉흙 3cm', kind: 'number' }, { text: '잎맥 사이 노랑', kind: 'weird' }, { text: '', kind: 'number' }] });
    const r = await extractFactClaims('m', '본문', ['겉흙 3cm'], { max: 5 });
    expect(r).toEqual([{ text: '겉흙 3cm', kind: 'number' }, { text: '잎맥 사이 노랑', kind: 'general' }]);
    const user = String(mocked.mock.calls[0]![2]);
    expect(user).toContain('반드시 포함');
    expect(user).toContain('겉흙 3cm');
    expect(user).toContain('최대 5개');
  });
  it('LLM 실패(null)면 null', async () => {
    mocked.mockResolvedValueOnce(null);
    expect(await extractFactClaims('m', '본문', [])).toBeNull();
  });
});

describe('judgeClaims — 판정 규칙', () => {
  it('index 로 매핑하고, experience 는 근거와 무관하게 unsupported, 미판정은 unsupported', async () => {
    mocked.mockResolvedValueOnce({ verdicts: [{ index: 1, status: 'supported', evidence: '브리프: 3cm' }, { index: 2, status: 'supported' }] });
    const r = await judgeClaims('m', [
      { text: '겉흙 3cm', kind: 'number' }, { text: '지난해 우리 밭', kind: 'experience' }, { text: '9월 시비', kind: 'time' },
    ], '[리서치·SEO 브리프]\n3cm');
    expect(r).toEqual([
      { text: '겉흙 3cm', kind: 'number', status: 'supported', evidence: '브리프: 3cm' },
      { text: '지난해 우리 밭', kind: 'experience', status: 'unsupported' },
      { text: '9월 시비', kind: 'time', status: 'unsupported' },
    ]);
    const user = String(mocked.mock.calls[0]![2]);
    expect(user).toContain('18~24cm');           // 반올림 오탐 예시
    expect(user).toContain('6호=18cm');           // 호↔cm 환산표
    expect(user).toContain('hedged_general');
    expect(user).toContain('검색량');             // 운영 수치 제외 규칙
  });
});

describe('factGateBlog — 종단', () => {
  it('추출→판정→집계, 무근거 있으면 hold', async () => {
    mocked
      .mockResolvedValueOnce({ claims: [{ text: '5cm 두께로 덮습니다', kind: 'number' }] })
      .mockResolvedValueOnce({ verdicts: [{ index: 1, status: 'unsupported' }] });
    const r = await factGateBlog({ model: 'm', body: '짚을 5cm 두께로 덮습니다.', evidence: '브리프' });
    expect(r.status).toBe('hold');
    expect(r.unsupported).toEqual(['5cm 두께로 덮습니다']);
    expect(r.repaired).toBe(false);
    expect(r.checkedTs).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('주장이 0건이면 pass', async () => {
    mocked.mockResolvedValueOnce({ claims: [] });
    const r = await factGateBlog({ model: 'm', body: '잔뿌리를 봅니다.', evidence: '' });
    expect(r.status).toBe('pass');
    expect(mocked).toHaveBeenCalledTimes(1); // 판정 콜 생략
  });
  it('LLM 실패면 error(자동 경로 fail-closed)', async () => {
    mocked.mockResolvedValueOnce(null);
    const r = await factGateBlog({ model: 'm', body: '3cm', evidence: '' });
    expect(r.status).toBe('error');
    expect(r.error).toContain('추출');
  });
});
