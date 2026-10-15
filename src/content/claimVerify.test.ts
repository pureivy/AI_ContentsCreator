import { describe, it, expect, vi } from 'vitest';

const micro = vi.hoisted(() => ({ next: null as unknown }));
vi.mock('../orchestrator/agent', () => ({ microJSON: async () => micro.next }));

import { restoreBold, isAuthoritative, isPrivateAddress, fetchAllowed, quoteBacksClaim, decodeHtml, densestAt, extractDocText, verifyClaims, resolveUnverifiedClaims, hedgeUnconfirmed, type VerifyDeps } from './claimVerify';

describe('isAuthoritative — 지식백과·공공기관만', () => {
  it('terms.naver.com·*.go.kr 은 근거, 블로그·위키는 아니다', () => {
    expect(isAuthoritative('https://terms.naver.com/entry.naver?docId=1')).toBe(true);
    expect(isAuthoritative('http://www.nongsaro.go.kr/portal/x')).toBe(true);
    expect(isAuthoritative('https://species.nibr.go.kr/a')).toBe(true);
    expect(isAuthoritative('https://blog.naver.com/x/1')).toBe(false);
    expect(isAuthoritative('https://ko.wikipedia.org/wiki/x')).toBe(false);
    expect(isAuthoritative('https://evil.go.kr.example.com/')).toBe(false);
  });
});

describe('quoteBacksClaim — 인용이 문서에 있고 주장과 낱말을 공유해야 확인', () => {
  const doc = '음나무는 두릅나무과의 낙엽 교목이다. 원줄기는 곧게 자라고 가지가 약간 나오며 줄기와 잎에는 가시가 있다.';
  it('문서에 그대로 있는 인용 + 겹치는 낱말 → 참', () => {
    expect(quoteBacksClaim('두릅나무는 줄기가 곧게 자랍니다', '원줄기는 곧게 자라고 가지가 약간 나오며', doc, '음나무')).toBe(true);
  });
  it('문서에 없는 인용(지어낸 문장) → 거짓', () => {
    expect(quoteBacksClaim('음나무 가시는 삼각형입니다', '가시는 밑동이 넓은 삼각형이다', doc, '음나무')).toBe(false);
  });
  it('수종 이름만 겹치는 인용(소개 문장) → 거짓', () => {
    expect(quoteBacksClaim('음나무 가시는 삼각형입니다', '음나무는 두릅나무과의 낙엽 교목이다', doc, '음나무')).toBe(false);
  });
});

describe('decodeHtml·densestAt·extractDocText', () => {
  it('표시 없는 EUC-KR 도 한글로 읽는다(농사로 옛 문서)', () => {
    const euc = new Uint8Array([0xB9, 0xE8, 0xB3, 0xAA, 0xB9, 0xAB]); // "배나무" EUC-KR
    const buf = new Uint8Array(30 * 6);
    for (let i = 0; i < 30; i++) buf.set(euc, i * 6);
    expect(decodeHtml(buf.buffer, 'text/html').slice(0, 3)).toBe('배나무');
  });
  it('메뉴에 한 번 스친 낱말보다 본문 덩어리를 고른다', () => {
    const t = `메뉴 전정 ${'가'.repeat(3000)} 본문 전정 도장지 꽃눈 전정 도장지`;
    expect(densestAt(t, ['전정', '도장지'])).toBeGreaterThan(3000);
  });
  it('지식백과 머리·꼬리를 걷어 낸다', () => {
    const html = '<div>메뉴 로그인</div><span>글자크기</span><p>음나무는 가시가 많다.</p><div>AI 추천 태그 #음나무</div>';
    expect(extractDocText(html)).toBe('음나무는 가시가 많다.');
  });
});

const fakeDeps = (judge: VerifyDeps['judge']): VerifyDeps => ({
  encyc: async () => [{ title: '음나무', link: 'https://terms.naver.com/entry.naver?docId=1', description: '' }],
  web: async () => [{ title: '블로그', url: 'https://blog.naver.com/a/1', snippet: '' }],
  fetchText: async () => '음나무는 낙엽 교목이다. 줄기와 가지에 굵은 가시가 많은 것이 특징이다. 봄 새순은 나물로 먹는다.',
  judge,
});
const CLAIMS = ['줄기와 가지에 가시가 많습니다.', '가시는 밑동이 넓적한 삼각형입니다.', '다음 편에서는 두릅나무를 다룹니다.'];
const planJson = { items: [{ index: 1, factual: true, q: '음나무 가시' }, { index: 2, factual: true, q: '음나무 가시 모양' }, { index: 3, factual: false, q: '' }] };

describe('verifyClaims — 판정 + 결정적 인용 검사', () => {
  it('확인·못찾음·의견을 가르고, 문서에 없는 인용의 supported 는 못찾음으로 내린다', async () => {
    let n = 0;
    const r = await verifyClaims({ model: 'm', claims: CLAIMS, species: '음나무', deps: fakeDeps(async () => (++n === 1 ? planJson : {
      results: [
        { index: 1, verdict: 'supported', doc: '1-1', quote: '줄기와 가지에 굵은 가시가 많은 것이 특징이다' },
        { index: 2, verdict: 'supported', doc: '1-1', quote: '가시는 밑동이 넓적한 삼각형이다' }, // 문서에 없는 인용
      ],
    })) });
    expect(r!.verified.map((v) => v.text)).toEqual([CLAIMS[0]]);
    expect(r!.notFound).toEqual([CLAIMS[1]]);
    expect(r!.opinion).toEqual([CLAIMS[2]]);
  });
  it('수치가 든 문장은 의견으로 뺄 수 없다', async () => {
    let n = 0;
    const r = await verifyClaims({ model: 'm', claims: ['3년 뒤에 열매가 열립니다.'], species: null, deps: fakeDeps(async () => (++n === 1
      ? { items: [{ index: 1, factual: false, q: 'x' }] } : { results: [{ index: 1, verdict: 'not_found' }] })) });
    expect(r!.opinion).toEqual([]);
    expect(r!.notFound).toEqual(['3년 뒤에 열매가 열립니다.']);
  });
  it('판정 실패면 null(아무것도 바꾸지 않음)', async () => {
    let n = 0;
    expect(await verifyClaims({ model: 'm', claims: CLAIMS, species: '음나무', deps: fakeDeps(async () => (++n === 1 ? planJson : null)) })).toBeNull();
  });
});

describe('resolveUnverifiedClaims — 확인은 빼고, 못 한 건 낮추거나 지운다', () => {
  const body = '## 가시\n줄기와 가지에 가시가 많습니다. 가시는 밑동이 넓적한 삼각형입니다.\n\n다음 편에서는 두릅나무를 다룹니다.';
  // 무근거(hold)는 '가시 많음' — 공식 자료로 확인되면 빠진다. 참고는 '삼각형'(못 찾음 → 낮춤)과 안내 문장.
  const result = { status: 'hold' as const, unsupported: [CLAIMS[0]!], contradicted: [], unverified: [CLAIMS[1]!, CLAIMS[2]!] };
  // 대조 순서는 [무근거, 참고] — 1=가시 많음(무근거), 2=삼각형, 3=다음 편 안내.
  const plan2 = { items: [{ index: 1, factual: true, q: '음나무 가시' }, { index: 2, factual: true, q: '음나무 가시 모양' }, { index: 3, factual: false, q: '' }] };
  const judge = (): VerifyDeps['judge'] => { let n = 0; return async () => (++n === 1 ? plan2 : { results: [{ index: 1, verdict: 'supported', doc: '1-1', quote: '줄기와 가지에 굵은 가시가 많은 것이 특징이다' }, { index: 2, verdict: 'supported', doc: '1-1', quote: '줄기와 가지에 굵은 가시가 많은 것이 특징이다' }] }); };
  it('확인 1 · 낮춤 1 · 의견은 그대로 — 무근거가 비면 pass (가시 낱말 하나만 겹친 인용은 확인이 아니다)', async () => {
    const v = await resolveUnverifiedClaims({
      body, result, species: '음나무', model: 'm', deps: fakeDeps(judge()),
      repair: async (b, nf) => ({ body: b.replace('가시는 밑동이 넓적한 삼각형입니다.', '가시는 밑동이 넓은 편입니다.'), applied: nf.length, missed: [] }),
    });
    expect(v!.body).toContain('밑동이 넓은 편');
    expect(v!.body).toContain('다음 편에서는 두릅나무를 다룹니다.');
    expect(v!.result.unsupported).toEqual([]);
    expect(v!.result.unverified).toEqual([CLAIMS[2]]);
    expect(v!.result.status).toBe('pass');
    expect(v!.result.claimVerify.repaired).toEqual([CLAIMS[1]]);
  });
  it('무근거(수치) 문장은 못 찾으면 낮추지 않고 보류 유지 — 공식 자료로 확인될 때만 빠진다', async () => {
    const hard = { status: 'hold' as const, unsupported: ['가시는 3년 뒤에 굵어집니다.'], contradicted: [], unverified: [] as string[] };
    let n = 0;
    const deps = fakeDeps(async () => (++n === 1 ? { items: [{ index: 1, factual: true, q: '음나무 가시' }] } : { results: [{ index: 1, verdict: 'not_found' }] }));
    let called = false;
    const v = await resolveUnverifiedClaims({ body: '가시는 3년 뒤에 굵어집니다.', result: hard, species: '음나무', model: 'm', deps,
      repair: async (b) => { called = true; return { body: b, applied: 1, missed: [] }; } });
    expect(called).toBe(false);
    expect(v!.result.unsupported).toEqual(['가시는 3년 뒤에 굵어집니다.']);
    expect(v!.result.status).toBe('hold');
  });
  it('수정이 제목 구조를 깨면 버리고 목록에 남긴다', async () => {
    const v = await resolveUnverifiedClaims({
      body, result, species: '음나무', model: 'm', deps: fakeDeps(judge()),
      repair: async (b) => ({ body: b.replace('## 가시\n', ''), applied: 1, missed: [] }),
    });
    expect(v!.body).toBe(body);
    expect(v!.result.unverified).toEqual([CLAIMS[1], CLAIMS[2]]);
    expect(v!.result.claimVerify.kept).toEqual([CLAIMS[1]]);
  });
});

describe('hedgeUnconfirmed — 확인 못 한 문장은 낮추기만, 지우기는 어긋난 문장만(2026-10-15 사장님 선택)', () => {
  it('not_found 의 delete 는 버리고, contradicted 의 delete 는 받는다, keep 은 손대지 않음', async () => {
    micro.next = { repairs: [
      { index: 1, action: 'delete', replacement: '' },                          // 확인 못 함 → 지우기 금지
      { index: 2, action: 'hedge', replacement: '껍질이 벗겨질 수 있습니다.' },
      { index: 3, action: 'keep', replacement: '' },
      { index: 4, action: 'delete', replacement: '' },                          // 어긋남 → 지우기 허용
    ] };
    const h = await hedgeUnconfirmed('m', '본문', ['그래서 세 번에 나눠서 끊어 주세요.', '껍질이 벗겨집니다.', '짧은 지시입니다.'],
      [{ text: '봄에 자릅니다.', url: 'https://terms.naver.com/x', title: 't', quote: '봄 전정은 피한다' }]);
    expect(h!.repairs).toEqual([
      { index: 2, action: 'hedge', replacement: '껍질이 벗겨질 수 있습니다.' },
      { index: 4, action: 'delete', replacement: '' },
    ]);
    expect(h!.list[3]).toBe('봄에 자릅니다.');
  });
});

describe('restoreBold — 교정이 벗긴 굵은 글씨를 되살린다', () => {
  it('본문에서 굵었던 구절만 다시 감싼다', () => {
    const body = '**물이 부족할 때**는 잎 끝부터 마릅니다. **과습일 때**는 아래 잎부터.';
    expect(restoreBold('물이 부족할 때는 잎 끝부터 마르는 경우가 많습니다.', body)).toBe('**물이 부족할 때**는 잎 끝부터 마르는 경우가 많습니다.');
    expect(restoreBold('**과습일 때**는 그대로.', body)).toBe('**과습일 때**는 그대로.');
  });
});

describe('SSRF 방지 — 검증 문서 가져오기(2026-10-15 보안 검토)', () => {
  it('fetchAllowed — 허용 호스트의 http(s)만, IP 직접 표기·다른 스킴·호스트 위장은 거절', () => {
    expect(fetchAllowed('https://terms.naver.com/entry.naver?docId=1')).toBe(true);
    expect(fetchAllowed('http://www.nongsaro.go.kr/portal/x')).toBe(true);
    expect(fetchAllowed('http://127.0.0.1:8787/runs')).toBe(false);
    expect(fetchAllowed('http://[::1]/')).toBe(false);
    expect(fetchAllowed('file:///etc/passwd')).toBe(false);
    expect(fetchAllowed('https://evil.go.kr.example.com/')).toBe(false);
    expect(fetchAllowed('https://localhost/')).toBe(false);
  });
  it('isPrivateAddress — 사설·루프백·링크로컬·IPv6 내부 주소', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.5', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['211.252.140.10', '8.8.8.8', '2001:4860:4860::8888']) expect(isPrivateAddress(ip)).toBe(false);
  });
});
