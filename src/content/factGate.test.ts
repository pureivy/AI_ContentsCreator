// src/content/factGate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../orchestrator/agent', () => ({ microJSON: vi.fn() }));
import { microJSON } from '../orchestrator/agent';
import {
  splitBodySentences, numericClaimSentences, buildEvidence, gateVerdict, formatGateFeedback, toFactGateInfo,
  extractFactClaims, judgeClaims, factGateBlog, runFactGateWithRepair,
  isJudgmentSentence, hasHedge, hasEventMarkers, classifyClaim,
  applySentenceRepairs, repairSentences,
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
    // 출력 예산은 요청 주장 수에 비례(2026-08-26 최종 리뷰 F3) — 고정 1800 은 max 20 에서 잘려
    // 뒤쪽 주장이 통째로 유실됐다(잘린 JSON = 추출 실패 = fail-closed error).
    expect((mocked.mock.calls[0]![3] as { maxOutputTokens?: number }).maxOutputTokens).toBe(1500); // 600 + 5*180
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
    expect((mocked.mock.calls[0]![3] as { maxOutputTokens?: number }).maxOutputTokens).toBe(760); // 400 + 3*120
  });
});

describe('선분류(2026-08-26 hold 율 저감) — 3런 실측 문장', () => {
  it('판단·관점·권유·채널 자기서술은 주장이 아니다', () => {
    for (const s of [
      '감나무 가을 거름은 모자란 쪽이 안전하다고 봅니다.',
      '같은 무늬가 열매에도 보이면 거름과는 무관하다고 봅니다.',
      '가지 갈라진 곳에 흰 덩어리가 붙어 있거나 잎이 끈적하다면 벌레 쪽부터 보는 편입니다.',
      '화분에 담긴 흙 부피가 정해져 있으니 마당에 선 나무와 같은 기준으로 넣지 않는 게 안전합니다.',
      '병이나 벌레로 보이는 나무에 거름부터 넣는 건 순서가 틀렸습니다.',
      '병든 잎과 떨어진 열매를 치우는 일이 먼저예요.',
      '자동으로 물이 나오는 장치를 쓰고 있다면 이 시기에 타이머부터 손봐야 합니다',
      '묘목 한 그루가 뿌리내리는 과정을 계절 단위로 이어서 기록하고 있어요',
    ]) expect(isJudgmentSentence(s), s).toBe(true);
    for (const s of ['질소 성분이 앞선 화학비료는 가을에 양을 줄입니다.', '퇴비는 흙에서 천천히 분해되는 자재라 효과가 더디게 나옵니다.', '겉흙 3cm가 말랐을 때 줍니다.'])
      expect(isJudgmentSentence(s), s).toBe(false);
  });
  it('유보어 — 대부분·흔히·경우가 많 포함', () => {
    expect(hasHedge('심은 지 1~2년 된 어린나무는 뿌리가 아직 넓게 뻗지 못한 경우가 대부분입니다.')).toBe(true);
    expect(hasHedge('잎맥은 초록으로 남고 그 사이만 흐려지는 모습이면 흔히 양분 쪽입니다.')).toBe(true);
    expect(hasHedge('질소 성분이 앞선 화학비료는 가을에 양을 줄입니다.')).toBe(false);
  });
  it('fix round 1 — 낱개 "편입니다" 는 판단문이 아니라 유보문(반증 가능한 수종 주장까지 무조건 제외되던 오탐 수선)', () => {
    for (const s of ['단감나무는 영하 10도까지 견디는 편입니다.', '래빗아이는 더위·건조에 강하고 나무가 크게 자라는 편입니다'])
      expect(classifyClaim({ text: s, kind: 'species' }), s).toBe('hedged');
    expect(classifyClaim({ text: '벌레 쪽부터 보는 편입니다.', kind: 'general' })).toBe('judgment'); // 권유 고정구는 여전히 판단문
    expect(isJudgmentSentence('그 안이 본편입니다')).toBe(false); // 낱개 "편입니다" 오탐(본편=main episode) 재발 방지
  });
  it('사건 표지 — 연도·기간·우리 밭·문의 실태만', () => {
    expect(hasEventMarkers('지난해 우리 밭 어린 단감나무도 사흘 사이 스무 개 넘게 떨궜습니다')).toBe(true);
    expect(hasEventMarkers('저희 밭에서도 문의가 오면 이렇게 답합니다')).toBe(true);
    expect(hasEventMarkers("화분을 들었을 때 '아직 무겁네' 하는 날이 이어지면 그게 신호예요")).toBe(false);
    expect(hasEventMarkers('우리 나무 잎을 사흘 간격으로 두어 번 만져 보는 편이 정확합니다.')).toBe(false); // 관찰법 권유(사흘 간격 ≠ 사흘 만에)
  });
  it('fix round 1 — 기간 표지는 1인칭 주어와 함께일 때만 사건(동안 제거, 숫자는 일 단위 한정)', () => {
    expect(hasEventMarkers('맨뿌리 묘목은 심기 전 이틀 동안 물에 담가 둡니다.')).toBe(false); // '동안' 은 관찰법에도 흔함
    expect(hasEventMarkers('흙 산도는 pH 5.5~6.5 사이가 알맞습니다.')).toBe(false); // 숫자+'사이'는 일 단위가 아니면 표지 아님
    expect(hasEventMarkers('하루 이틀 만에 물러집니다')).toBe(false); // 기간 표지는 있으나 1인칭 주어가 없다
    expect(hasEventMarkers('우리 밭에서는 사흘 만에 떨어졌습니다')).toBe(true); // 1인칭 + 기간 = 사건
  });
  it('classifyClaim 우선순위: event > judgment > hedged > claim', () => {
    expect(classifyClaim({ text: '지난해 우리 밭에서는 그렇게 봤습니다.', kind: 'experience' })).toBe('event');
    expect(classifyClaim({ text: '모자란 쪽이 안전하다고 봅니다.', kind: 'general' })).toBe('judgment');
    expect(classifyClaim({ text: '흔히 양분 쪽입니다.', kind: 'pest' })).toBe('hedged');
    expect(classifyClaim({ text: '가을에 양을 줄입니다.', kind: 'treatment' })).toBe('claim');
    expect(classifyClaim({ text: '무거우면 그게 신호예요', kind: 'experience' })).toBe('claim'); // 표지 없는 experience 는 일반 주장
  });
});

describe('factGateBlog — 선분류 반영', () => {
  it('판단문은 판정에 보내지 않고 filtered 에 세며, 유보문은 판정이 unsupported 여도 hedged_general, 표지 없는 experience 는 일반 판정', async () => {
    mocked
      .mockResolvedValueOnce({ claims: [
        { text: '모자란 쪽이 안전하다고 봅니다.', kind: 'general' },
        { text: '흔히 양분 쪽입니다.', kind: 'pest' },
        { text: '무거우면 그게 신호예요', kind: 'experience' },
        { text: '가을에 양을 줄입니다.', kind: 'treatment' },
      ] })
      .mockResolvedValueOnce({ verdicts: [{ index: 1, status: 'unsupported' }, { index: 2, status: 'supported', evidence: '브리프' }, { index: 3, status: 'unsupported' }] });
    const r = await factGateBlog({ model: 'm', body: 'x', evidence: 'e' });
    const judgeUser = String(mocked.mock.calls[1]![2]);
    expect(judgeUser).not.toContain('안전하다고 봅니다');           // 판단문 제외
    expect(judgeUser).toContain('(유보)');                          // 유보문은 모순 여부만
    expect(r.filtered).toEqual({ judgment: 1, hedged: 1 });
    expect(r.claims.find((c) => c.text.includes('흔히'))!.status).toBe('hedged_general');
    expect(r.claims.find((c) => c.text.includes('무거우면'))!.status).toBe('supported');
    expect(r.claims.find((c) => c.text.includes('무거우면'))!.kind).toBe('general');
    expect(r.unsupported).toEqual(['가을에 양을 줄입니다.']);
    expect(r.status).toBe('hold');
    expect(r.claims.every((c) => !('hedged' in c))).toBe(true); // 내부 플래그가 fact_gate.json 으로 새지 않는다
  });
  it('유보문이라도 판정이 contradicted 면 유지한다', async () => {
    mocked
      .mockResolvedValueOnce({ claims: [{ text: '대개 9월에 줍니다.', kind: 'time' }] })
      .mockResolvedValueOnce({ verdicts: [{ index: 1, status: 'contradicted', evidence: '자사 글: 추분 후' }] });
    const r = await factGateBlog({ model: 'm', body: 'x', evidence: 'e' });
    expect(r.contradicted).toHaveLength(1);
  });
  it('전부 판단문이면 판정 콜 없이 pass', async () => {
    mocked.mockResolvedValueOnce({ claims: [{ text: '자리부터 정한다고 봅니다.', kind: 'general' }] });
    const r = await factGateBlog({ model: 'm', body: 'x', evidence: 'e' });
    expect(r.status).toBe('pass'); expect(mocked).toHaveBeenCalledTimes(1);
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

describe('runFactGateWithRepair — 1차 판정 → 수정 1회 → 2차 판정', () => {
  const R = (status: 'pass' | 'hold' | 'error', unsupported: string[] = []): FactGateResult =>
    ({ status, claims: [], unsupported, contradicted: [], repaired: false, checkedTs: 't' });
  it('1차 pass 면 수정 없이 끝', async () => {
    const repair = vi.fn();
    const r = await runFactGateWithRepair({ gate: async () => R('pass'), repair }, '본문');
    expect(r.body).toBe('본문'); expect(r.result.status).toBe('pass'); expect(repair).not.toHaveBeenCalled();
  });
  it('1차 hold 면 피드백으로 수정 후 2차 판정, repaired=true', async () => {
    const gate = vi.fn().mockResolvedValueOnce(R('hold', ['5cm'])).mockResolvedValueOnce(R('pass'));
    const repair = vi.fn(async (_b: string, f: string) => `## 고침\n${f.includes('5cm') ? 'ok' : 'no'}`);
    const r = await runFactGateWithRepair({ gate, repair }, '## 원본\n5cm');
    expect(r.body).toBe('## 고침\nok'); expect(r.result.status).toBe('pass'); expect(r.result.repaired).toBe(true);
  });
  it('수정본이 비거나 소제목이 없으면 원본 유지 + 1차 결과 유지', async () => {
    const gate = vi.fn().mockResolvedValueOnce(R('hold', ['5cm']));
    const r = await runFactGateWithRepair({ gate, repair: async () => '질문이 있습니다' }, '## 원본');
    expect(r.body).toBe('## 원본'); expect(r.result.status).toBe('hold'); expect(gate).toHaveBeenCalledTimes(1);
  });
  it('1차 error 면 수정하지 않고 error 유지(fail-closed)', async () => {
    const repair = vi.fn();
    const r = await runFactGateWithRepair({ gate: async () => R('error'), repair }, '## 원본');
    expect(r.result.status).toBe('error'); expect(repair).not.toHaveBeenCalled();
  });
});

describe('runFactGateWithRepair — firstPass 보존', () => {
  it('2차 결과에 1차 요약이 붙는다', async () => {
    const R = (status: 'pass' | 'hold', unsupported: string[] = []): FactGateResult => ({ status, claims: [], unsupported, contradicted: [], repaired: false, checkedTs: 't' });
    const gate = vi.fn().mockResolvedValueOnce(R('hold', ['a'])).mockResolvedValueOnce(R('pass'));
    const r = await runFactGateWithRepair({ gate, repair: async () => '## 고침' }, '## 원본');
    expect(r.result.firstPass).toEqual({ status: 'hold', unsupported: ['a'], contradicted: [], checkedTs: 't' });
  });
});

describe('applySentenceRepairs — 문장 단위 치환(순수)', () => {
  const body = '## 거름\n질소 성분이 앞선 화학비료는 가을에 양을 줄입니다. 퇴비는 흙에서 천천히 분해되는 자재라 효과가 더디게 나옵니다.\n\n잎에 뿌리는 영양제로 대신할 수 없습니다.';
  it('정확 일치·공백 정규화·앞 40자 접두 일치로 치환하고 delete 는 제거한다', () => {
    const r = applySentenceRepairs(body,
      ['질소 성분이 앞선 화학비료는 가을에 양을 줄입니다.', '퇴비는  흙에서 천천히 분해되는 자재라 효과가 더디게 나옵니다.', '잎에 뿌리는 영양제로 대신할 수 없습니'],
      [{ index: 1, action: 'hedge', replacement: '질소 성분이 앞선 화학비료는 가을에는 대개 양을 줄입니다.' }, { index: 2, action: 'judgment', replacement: '퇴비는 효과가 더디게 나오는 쪽이라고 봅니다.' }, { index: 3, action: 'delete', replacement: '' }]);
    expect(r.applied).toBe(3); expect(r.missed).toEqual([]);
    expect(r.body).toContain('가을에는 대개 양을 줄입니다.');
    expect(r.body).toContain('더디게 나오는 쪽이라고 봅니다.');
    expect(r.body).not.toContain('영양제로 대신할 수 없습니다');
    expect(r.body).not.toMatch(/\n{3,}/);
  });
  it('못 찾는 문장은 missed 로 남기고 나머지는 적용한다', () => {
    const r = applySentenceRepairs(body, ['없는 문장입니다.', '잎에 뿌리는 영양제로 대신할 수 없습니다.'],
      [{ index: 1, action: 'hedge', replacement: 'x' }, { index: 2, action: 'hedge', replacement: '잎에 뿌리는 영양제로는 대개 대신하기 어렵습니다.' }]);
    expect(r.applied).toBe(1); expect(r.missed).toEqual(['없는 문장입니다.']);
  });
  it('replacement 가 새 수치를 들이면 그 항목은 건너뛴다', () => {
    const r = applySentenceRepairs(body, ['잎에 뿌리는 영양제로 대신할 수 없습니다.'], [{ index: 1, action: 'hedge', replacement: '잎에 뿌리는 영양제는 3회까지는 대개 괜찮습니다.' }]);
    expect(r.applied).toBe(0); expect(r.missed).toEqual(['잎에 뿌리는 영양제로 대신할 수 없습니다.']);
  });
});

describe('repairSentences — 프롬프트·검증', () => {
  it('규칙(새 사실 금지·hedge/judgment/delete)이 프롬프트에 있고 잘못된 index/action 은 버린다', async () => {
    mocked.mockResolvedValueOnce({ repairs: [{ index: 1, action: 'hedge', replacement: 'a.' }, { index: 9, action: 'hedge', replacement: 'b.' }, { index: 2, action: 'rewrite', replacement: 'c.' }] });
    const r = await repairSentences('m', 'body', ['s1', 's2']);
    expect(r).toEqual([{ index: 1, action: 'hedge', replacement: 'a.' }]);
    const user = String(mocked.mock.calls[0]![2]);
    expect(user).toContain('새 사실·수치'); expect(user).toContain('hedge'); expect(user).toContain('judgment'); expect(user).toContain('delete');
  });
});

describe('runFactGateWithRepair — 표적 수정 우선', () => {
  const R = (status: 'pass' | 'hold', unsupported: string[] = []): FactGateResult => ({ status, claims: [], unsupported, contradicted: [], repaired: false, checkedTs: 't' });
  it('표적 수정이 적용되면 작가 재작성 없이 2차 판정', async () => {
    const gate = vi.fn().mockResolvedValueOnce(R('hold', ['a'])).mockResolvedValueOnce(R('pass'));
    const repair = vi.fn(); const targeted = vi.fn(async () => ({ body: '## 표적', applied: 1, missed: [] }));
    const r = await runFactGateWithRepair({ gate, repair, targeted }, '## 원본');
    expect(repair).not.toHaveBeenCalled(); expect(r.body).toBe('## 표적'); expect(r.result.repaired).toBe(true);
  });
  it('표적 수정이 하나도 안 붙으면 작가 재작성으로 폴백', async () => {
    const gate = vi.fn().mockResolvedValueOnce(R('hold', ['a'])).mockResolvedValueOnce(R('pass'));
    const repair = vi.fn(async () => '## 재작성'); const targeted = vi.fn(async () => ({ body: '## 원본', applied: 0, missed: ['a'] }));
    const r = await runFactGateWithRepair({ gate, repair, targeted }, '## 원본');
    expect(repair).toHaveBeenCalledTimes(1); expect(r.body).toBe('## 재작성');
  });
});
