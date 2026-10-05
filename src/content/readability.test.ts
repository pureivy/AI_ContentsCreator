import { describe, it, expect } from 'vitest';
import { readabilityPrompt, acceptReadabilityFixes, applyReadabilityFixes, readabilityGuard, READABILITY_SIM_FLOOR } from './readability';

// 읽기 쉬움 검수(2026-10-05, 참고 블로그 2026-10-03 이식) — 처음 읽는 독자가 멈칫할 문장만 일상어로.
// 예문은 우리 실측 꼴(지어낸 비유 "가위를 몇 번 들 수 있는가"·의인화·풀이 없는 용어)로 바꿨다. 한 문장 한 줄 본문.
const BODY = [
  '**가지치기 시기는 잎이 진 뒤입니다.**',
  '**전정은 겨울에 한 번이면 돼요.**',
  '',
  '1년에 가위를 몇 번 들 수 있는가부터 정해 둡니다.',
  '이 표가 답을 알려 줍니다.',
  '뿌리분 가장자리에 꽂으세요.',
  '',
  '| 시기 | 할 일 |',
  '|---|---|',
  '| 12월 | 웃자란 가지 정리 |',
  '',
  '>>> 오늘 볼 것',
  '',
  '## 가위를 드는 철',
].join('\n');

describe('readabilityPrompt', () => {
  it('독자·판정 기준·원예 실측 예·보존 규칙·한 줄 한 문장을 담는다', () => {
    const p = readabilityPrompt(BODY, '30~60대 초보 정원가', '가지치기 시기');
    expect(p).toContain('30~60대 초보 정원가');
    expect(p).toContain('1년에 가위를 몇 번 들 수 있는가');
    expect(p).toContain('뿌리분(뿌리와 흙이 뭉친 덩어리)');
    expect(p).toContain('"가지치기 시기"');
    expect(p).toMatch(/새 사실/);
    // 2026-10-05 저녁 — 사장님 결정(한 줄에 1~2문장): 쪼개기는 계속 금지, 바로 위 줄과 합치기(토막 줄)만 허용.
    expect(p).toContain('여러 줄로 쪼개지 마라. 합치기는 ⑨의 바로 위 줄과만');
    expect(p).toContain('⑨ 앞 문장에 붙어야 할 꼬리가 혼자 한 줄인 토막');
    expect(p).not.toContain('머릿속 문장'); // 상담 블로그 예문은 옮기지 않았다
  });
  it('키워드가 없으면 그 줄이 빠진다', () => {
    expect(readabilityPrompt(BODY, '')).not.toContain('핵심 키워드');
    expect(readabilityPrompt(BODY, '')).toContain('[독자] 일반 독자');
  });
});

describe('acceptReadabilityFixes — 결정적 거름', () => {
  it('본문에 없는 원문·표/인용 줄·키워드를 빼먹은 치환·같은 문장은 버린다', () => {
    const fixes = acceptReadabilityFixes(BODY, [
      { original: '1년에 가위를 몇 번 들 수 있는가부터 정해 둡니다.', replacement: '1년에 몇 번 전정할지부터 정해 둡니다.' },
      { original: '본문에 없는 문장입니다.', replacement: '아무거나.' },
      { original: '| 12월 | 웃자란 가지 정리 |', replacement: 'x' },
      { original: '오늘 볼 것', replacement: '오늘 확인할 것' },
      { original: '가지치기 시기는 잎이 진 뒤입니다.', replacement: '잎이 다 떨어진 뒤에 자르세요.' },
      { original: '이 표가 답을 알려 줍니다.', replacement: '이 표가 답을 알려 줍니다.' },
      { original: '## 가위를 드는 철', replacement: '## 전정하는 철' },
    ], '가지치기 시기');
    expect(fixes).toEqual([
      { original: '1년에 가위를 몇 번 들 수 있는가부터 정해 둡니다.', replacement: '1년에 몇 번 전정할지부터 정해 둡니다.' },
      { original: '가위를 드는 철', replacement: '전정하는 철' },
    ]);
  });
  it('불량 페이로드는 빈 목록, 최대 15개', () => {
    expect(acceptReadabilityFixes(BODY, null)).toEqual([]);
    expect(acceptReadabilityFixes(BODY, [{ original: 3 }, null] as unknown[])).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `문장 ${i}번입니다.`);
    const raw = many.map((o) => ({ original: o, replacement: `${o} 고침` }));
    expect(acceptReadabilityFixes(many.join('\n'), raw)).toHaveLength(15);
  });
});

describe('applyReadabilityFixes — 줄 구조·굵게·표를 지키며 문장만 바꾼다', () => {
  it('고친 문장만 바뀌고 한 줄 한 문장·표·소제목 마커는 그대로', () => {
    const r = applyReadabilityFixes(BODY, [
      { original: '이 표가 답을 알려 줍니다.', replacement: '표를 보면 답이 보입니다.' },
      { original: '뿌리분 가장자리에 꽂으세요.', replacement: '뿌리분(뿌리와 흙이 뭉친 덩어리) 가장자리에 꽂으세요.' },
      { original: '가위를 드는 철', replacement: '전정하는 철' },
      { original: '전정은 겨울에 한 번이면 돼요.', replacement: '전정은 겨울에 한 번만 해도 돼요.' },
    ]);
    expect(r.applied).toBe(4);
    expect(r.body.split('\n')).toHaveLength(BODY.split('\n').length);
    expect(r.body).toContain('\n표를 보면 답이 보입니다.\n');
    expect(r.body).toContain('\n**전정은 겨울에 한 번만 해도 돼요.**\n'); // 첫머리 굵은 요약 줄의 굵게 유지(factGate 2026-10-05)
    expect(r.body).toContain('\n## 전정하는 철');
    expect(r.body).toContain('| 12월 | 웃자란 가지 정리 |');
  });
  it('새 숫자가 생기거나 두 번 이상 나오는 원문은 건드리지 않음', () => {
    const r = applyReadabilityFixes('가나다 라마. 바사 아자.\n\n가나다 라마. 바사 아자.\n\n차카 타파. 하가 나다.', [
      { original: '가나다 라마. 바사 아자.', replacement: '가나다 라마요. 바사 아자요.' },
      { original: '차카 타파. 하가 나다.', replacement: '차카 타파. 하가 나다 3일.' },
    ]);
    expect(r.applied).toBe(0);
  });
  it('소제목 양쪽에 "## "가 붙어 와도 마커는 하나(참고 블로그 실측 "## ## ")', () => {
    const body = '본문.\n\n## 잎이 진 뒤 가위를 드는 이유\n\n내용.';
    const fixes = acceptReadabilityFixes(body, [{ original: '## 잎이 진 뒤 가위를 드는 이유', replacement: '## 잎이 진 뒤에 전정하는 이유' }]);
    const r = applyReadabilityFixes(body, fixes);
    expect(r.body).toContain('\n## 잎이 진 뒤에 전정하는 이유\n');
    expect(r.body).not.toContain('## ##');
  });
  it('유사도 하한은 사실 교정(0.4)보다 낮은 0.2', () => {
    expect(READABILITY_SIM_FLOOR).toBe(0.2);
  });
});

// 리뷰(2026-10-05) — 2차 패스가 1차의 거부(새 사실·유사도 미달)를 우회했고, 하한 0.2 는 뜻 뒤집힘까지 통과시켰다.
describe('applyReadabilityFixes — 뜻 보존 가드(리뷰 2026-10-05)', () => {
  const body = [
    '**가지치기 시기는 잎이 진 뒤입니다.**',
    '',
    '전정은 10월 초에 시작하면 됩니다.',
    '이 표가 답을 알려 줍니다.',
    '살충제는 쓰지 않아도 됩니다.',
  ].join('\n');
  it('"10월 초"→"시월 말" 은 1·2차 어디서도 적용되지 않는다', () => {
    const r = applyReadabilityFixes(body, [{ original: '전정은 10월 초에 시작하면 됩니다.', replacement: '전정은 시월 말에 시작하면 됩니다.' }]);
    expect(r.applied).toBe(0);
    expect(r.body).toBe(body);
    expect(r.missed).toEqual(['전정은 10월 초에 시작하면 됩니다.']);
  });
  it('엉뚱한 문장으로 바꿔치기(유사도 미달)는 본문에 한 번뿐이어도 2차에서 적용되지 않는다', () => {
    const r = applyReadabilityFixes(body, [{ original: '이 표가 답을 알려 줍니다.', replacement: '물은 흙이 마를 때 듬뿍 주세요.' }]);
    expect(r.applied).toBe(0);
    expect(r.body).toBe(body);
  });
  it('"살충제는 쓰지 않아도 됩니다"→"…꼭 뿌려야 합니다" 는 부정·필요 극성이 뒤집혀 거부', () => {
    expect(readabilityGuard('살충제는 쓰지 않아도 됩니다.', '살충제는 꼭 뿌려야 합니다.')).not.toBeNull();
    const r = applyReadabilityFixes(body, [{ original: '살충제는 쓰지 않아도 됩니다.', replacement: '살충제는 꼭 뿌려야 합니다.' }]);
    expect(r.applied).toBe(0);
    expect(r.body).toContain('\n살충제는 쓰지 않아도 됩니다.');
  });
  it('2차는 문장 경계를 못 찾은 치환만 구제한다(같은 뜻·같은 수치)', () => {
    const b = '앞 문장입니다.\n이 표가 답을 알려 줍니다. 그래서 정합니다.\n끝.';
    const r = applyReadabilityFixes(b, [{ original: '이 표가 답을 알려 줍니다. 그래서 정합니다.', replacement: '표를 보면 답이 보입니다. 그래서 정합니다.' }]);
    expect(r.applied).toBe(1);
    expect(r.body).toContain('표를 보면 답이 보입니다. 그래서 정합니다.');
  });
  it('readabilityGuard — 수치·단위·월·키워드는 그대로여야 하고, 같은 뜻 풀어쓰기는 통과', () => {
    expect(readabilityGuard('겉흙 3cm가 마르면 줍니다.', '겉흙 5cm가 마르면 줍니다.')).toBe('수치·시기 변경');
    expect(readabilityGuard('겉흙 3cm가 마르면 줍니다.', '겉흙이 마르면 줍니다.')).toBe('수치·시기 변경'); // 빠져도 바뀐 것
    expect(readabilityGuard('10월 초에 심어요.', '10월 말에 심어요.')).toBe('월 시점 변경');
    expect(readabilityGuard('물을 주면 안 됩니다.', '물을 주세요.')).toBe('부정 표지 변경');
    expect(readabilityGuard('비료가 필요합니다.', '비료를 줘도 됩니다.')).toBe('필요·금지 극성 변경');
    expect(readabilityGuard('가지치기 시기를 가늠합니다.', '시기를 확인합니다.', '가지치기 시기')).toBe('키워드 누락');
    expect(readabilityGuard('이 표가 답을 알려 줍니다.', '표를 보면 답이 보입니다.')).toBeNull();
    expect(readabilityGuard('10월 말 동해를 막으려면 감싸 줘야 합니다.', '10월 말 겨울 추위 피해를 막으려면 감싸 줘야 합니다.')).toBeNull();
    expect(readabilityGuard('뿌리분 안에 물이 고이지 않게 합니다.', '뿌리분(뿌리와 흙이 뭉친 덩어리) 안에 물이 고이지 않게 합니다.')).toBeNull();
  });
});

// 2026-10-05 대추나무 초안 — "…대추나무 심는시기의 마지막 가을 창입니다"가 이 검수를 통과했다. 직역 말투를 고칠 대상에 넣고,
// 키워드 보존은 띄어쓰기·조사를 무시해 본다(검색어 꼴을 바른 꼴로 고치는 치환이 '키워드 누락'으로 버려지지 않게).
describe('readability — 직역 말투·키워드 자연스러운 꼴(2026-10-05)', () => {
  it('프롬프트에 "창" 직역 예와 바른 띄어쓰기 꼴이 실린다', () => {
    const p = readabilityPrompt(BODY, '', '대추나무 심는시기');
    expect(p).toContain('"가을 식재 창입니다"→"가을에 심을 수 있는 때입니다"');
    expect(p).toContain('"대추나무 심는 시기"');
    expect(p).not.toContain('그 표기를 그대로 남겨라');
  });
  it('키워드 보존 판정은 띄어쓰기·조사를 무시한다', () => {
    const kw = '대추나무 심는시기';
    expect(readabilityGuard('대추나무 심는시기는 땅 상태로 가늠합니다.', '대추나무 심는 시기는 땅 상태로 확인해요.', kw)).toBeNull();
    expect(readabilityGuard('대추나무 심는시기는 땅 상태로 가늠합니다.', '대추나무를 심는 시기는 땅 상태로 확인해요.', kw)).toBeNull();
    expect(readabilityGuard('대추나무 심는시기는 땅 상태로 가늠합니다.', '땅 상태로 확인해요.', kw)).toBe('키워드 누락');
  });
});

// 2026-10-05 저녁 — 휴지통 대추나무 초안의 토막 줄("봄에 심는다면 3월 중순에서 4월 중순이고요.")은 앞 줄과 합쳐야 고쳐지는데
// '합치지 마라'와 문장 단위 치환기가 막았다. 바로 위 줄과의 두 줄 합치기만 허용하고, 뜻 보존 가드는 그대로 건다.
describe('readability — 토막 줄 합치기·"없이" 부정 오인(2026-10-05)', () => {
  const body = ['가을에 대추나무 묘목을 심는 시기는 10월 하순부터 11월 초순까지입니다.', '봄에 심는다면 3월 중순에서 4월 중순이고요.', '', '## 다음'].join('\n');
  const merge = { original: '가을에 대추나무 묘목을 심는 시기는 10월 하순부터 11월 초순까지입니다.\n봄에 심는다면 3월 중순에서 4월 중순이고요.',
    replacement: '가을엔 10월 하순부터 11월 초순까지, 봄엔 3월 중순부터 4월 중순까지 심어요.' };
  it('인접 두 산문 줄을 한 줄로 합치는 치환을 받아들이고 적용한다', () => {
    const fixes = acceptReadabilityFixes(body, [merge]);
    expect(fixes).toHaveLength(1);
    const r = applyReadabilityFixes(body, fixes);
    expect(r.applied).toBe(1);
    expect(r.body.split('\n')[0]).toBe(merge.replacement);
    expect(r.body).toContain('\n\n## 다음');
  });
  it('세 줄 이상·떨어진 줄·인용 줄·결과가 여러 줄인 합치기는 버린다', () => {
    expect(acceptReadabilityFixes(body, [{ ...merge, original: `${merge.original}\n` + '## 다음' }])).toEqual([]);
    expect(acceptReadabilityFixes(body, [{ ...merge, replacement: '가을엔 10월 하순부터.\n봄엔 3월 중순부터.' }])).toEqual([]);
    const q = '> 인용 줄입니다.\n봄에 심는다면 3월 중순에서 4월 중순이고요.';
    expect(acceptReadabilityFixes(q, [{ original: q, replacement: '인용 줄이고 봄엔 3월 중순에서 4월 중순이에요.' }])).toEqual([]);
  });
  it('합치기에도 뜻 보존 가드가 걸린다(월 시점이 바뀌면 거부)', () => {
    const bad = { ...merge, replacement: '가을엔 10월 초순부터 11월 초순까지, 봄엔 3월 중순부터 4월 중순까지 심어요.' };
    const r = applyReadabilityFixes(body, acceptReadabilityFixes(body, [bad]));
    expect(r.applied).toBe(0);
  });
  it('"없이"는 부정 표지가 아니다 — 단위결실성 풀이 고침이 통과한다', () => {
    expect(readabilityGuard('단위결실성이 있다는 말이 이 뜻입니다.', '꽃가루받이 없이도 열매를 맺는 성질(단위결실성)이 있다는 말입니다.')).toBeNull();
    expect(readabilityGuard('물을 주면 안 됩니다.', '물을 주세요.')).toBe('부정 표지 변경'); // 진짜 부정은 그대로 잡는다
    expect(readabilityGuard('물이 없으면 시듭니다.', '물이 있으면 시듭니다.')).toBe('부정 표지 변경');
  });
  it('프롬프트에 보고서 말투 대체어가 실린다', () => {
    const p = readabilityPrompt(body, '');
    expect(p).toContain('"구간"(시기 뜻 → "시기·때")');
    expect(p).toContain('"그해 심기는 접습니다"(→"올해는 미루세요")'); // 계절을 박지 않는다(리뷰 2026-10-05)
    expect(p).not.toContain('마지막 시기'); // '창' 대체어가 금칙어 '마지막'을 들이지 않는다
  });
  it('original 규칙이 ⑨(두 줄 합치기)와 부딪히지 않는다 · 굵은 요약 줄은 합치지 않는다(리뷰 2026-10-05)', () => {
    const p = readabilityPrompt(body, '');
    expect(p).toContain('⑨ 토막 합치기만 두 줄을 줄바꿈으로 이어 적고, 그 밖에는 여러 문장을 묶지 마라');
    expect(p).not.toContain('여러 문장을 묶지 말고)');
    const bold = '**가을엔 10월 하순부터 심어요.**\n봄이면 3월이고요.\n\n## 다음';
    expect(acceptReadabilityFixes(bold, [{ original: '**가을엔 10월 하순부터 심어요.**\n봄이면 3월이고요.', replacement: '**가을엔 10월 하순부터, 봄이면 3월에 심어요.**' }])).toEqual([]);
  });
});
