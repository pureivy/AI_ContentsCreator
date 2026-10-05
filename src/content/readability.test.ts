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
    expect(p).toContain('여러 문장으로 쪼개거나 앞뒤 문장과 합치지 마라');
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
