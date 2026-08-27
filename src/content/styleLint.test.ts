import { describe, it, expect } from 'vitest';
import { narrationStyleIssues, cardStyleIssues, hookKeywordLeadIssues, metaSummaryIssues, blogStyleIssues, styleRevisionReject } from './styleLint';

describe('hookKeywordLeadIssues — 훅 첫 2초 키워드 낭독(2026-08-20 조회수 감사)', () => {
  it('훅 앞 12자 안에 키워드 전체가 있으면 검출한다(공백 무시)', () => {
    expect(hookKeywordLeadIssues(['배롱나무 개화시기, 가지 끝을 보세요.'], '배롱나무 개화시기')).toHaveLength(1);
    expect(hookKeywordLeadIssues(['신비복숭아묘목 고를 때 접목부부터 봐요.'], '신비복숭아묘목')).toHaveLength(1);
  });
  it('키워드가 훅 뒤쪽·씬2 이후로 밀려 있으면 통과한다', () => {
    expect(hookKeywordLeadIssues(['까맣게 익어도 아직 이릅니다. 배롱나무 얘기예요.'], '배롱나무')).toEqual([]);
    expect(hookKeywordLeadIssues(['잠깐, 그 가지 자르지 마세요.', '배롱나무 개화시기 얘기입니다.'], '배롱나무 개화시기')).toEqual([]);
  });
  it('부분 문자열·지시 준수 대본은 오탐하지 않는다(리뷰 실측: 곶감나무⊃감나무, 짧은 제동 선행)', () => {
    expect(hookKeywordLeadIssues(['곶감나무 아래는 늦어요.'], '감나무')).toEqual([]);
    expect(hookKeywordLeadIssues(['잠깐, 배롱나무 그 가지 자르지 마세요.'], '배롱나무')).toEqual([]);
    expect(hookKeywordLeadIssues(['이 묘목, 잘못 골랐어요.'], '묘목')).toEqual([]);
  });
  it('공백 제거 15자 이상 긴 키워드도 첫 문장 시작이면 검출한다', () => {
    expect(hookKeywordLeadIssues(['배롱나무 개화시기 앞당기는 방법부터 볼게요.'], '배롱나무 개화시기 앞당기는 방법')).toHaveLength(1);
  });
  it('키워드 없음·2자 미만·빈 훅은 오탐 없이 통과한다', () => {
    expect(hookKeywordLeadIssues(['아무 훅 문장입니다.'], undefined)).toEqual([]);
    expect(hookKeywordLeadIssues(['아무 훅 문장입니다.'], '솔')).toEqual([]);
    expect(hookKeywordLeadIssues([], '배롱나무')).toEqual([]);
  });
});

describe('narrationStyleIssues', () => {
  it('한 씬 두 문장이 모두 -ㅂ니다 종결이면 검출한다', () => {
    const issues = narrationStyleIssues(['가지를 치웁니다. 눈으로 확인되는 것부터 거릅니다.']);
    expect(issues.some((i) => i.includes('-ㅂ니다'))).toBe(true);
  });

  it('어미가 섞인 씬·질문 종결은 통과한다', () => {
    expect(narrationStyleIssues(['가지를 치우세요. 눈에 보이는 것부터 거르면 돼요.'])).toEqual([]);
    expect(narrationStyleIssues(['어디부터 볼까요? 뿌리부터 봅니다.'])).toEqual([]);
  });

  it('훅 질문-반전 공식(보셨나요?+정작)을 검출한다 — 실측 15편 중 7편 지문', () => {
    const issues = narrationStyleIssues(['이름표부터 보셨나요? 정작 봐야 할 건 따로 있어요.']);
    expect(issues.some((i) => i.includes('공식'))).toBe(true);
  });

  it("'새 가지'(발음 혼동)와 '기 때문입니다' 2회를 검출한다", () => {
    const issues = narrationStyleIssues([
      '그래야 새 가지가 자라요.',
      '뿌리가 잘리기 때문입니다.',
      '물을 계속 옮기기 때문입니다.',
    ]);
    expect(issues.some((i) => i.includes('새로 난 가지'))).toBe(true);
    expect(issues.some((i) => i.includes('기 때문입니다'))).toBe(true);
  });

  it("'가 아니라' 재정의 문형 2회를 검출한다", () => {
    const issues = narrationStyleIssues([
      '날짜가 아니라 뿌리 상태로 정해져요.',
      '색이 아니라 송이 안 상태로 봐요.',
    ]);
    expect(issues.some((i) => i.includes('재정의'))).toBe(true);
  });
});

describe('cardStyleIssues', () => {
  it('3장 연속 -ㅂ니다 종결을 검출한다 — 실측 40장 중 36장 지문', () => {
    const issues = cardStyleIssues([
      { headline: 'h1', body: '이 두 선이 정합니다' },
      { headline: 'h2', body: '첫 줄\n둘 다 확인해야 안전합니다' },
      { headline: 'h3', body: '자리가 절반은 정해집니다' },
    ]);
    expect(issues.some((i) => i.includes('3장 연속'))).toBe(true);
  });

  it('중간에 다른 종결이 끼면 통과한다', () => {
    expect(cardStyleIssues([
      { headline: 'h1', body: '이 두 선이 정합니다' },
      { headline: 'h2', body: '판정은 맨 아래 알로' },
      { headline: 'h3', body: '자리가 절반은 정해집니다' },
    ])).toEqual([]);
  });
});

// 요약·설명 메타투(2026-08-27 말투 감사 권고 2) — 블로그 meta·쇼츠 description 이 "…를 정리했습니다"
// "…에 대해 알아봅니다" 로 끝나 검색 스니펫·유튜브 설명이 통째로 템플릿처럼 읽혔다(실측).
// 요약·설명은 "결론 한 줄 + 조건 한 줄" 꼴이어야 한다 — 그 대체 형식은 프롬프트가 지시하고,
// 여기는 프롬프트가 새는 경우를 잡는 결정적 2차 방어다(문체 린트와 같은 사상).
describe('metaSummaryIssues — 요약·설명 메타투(2026-08-27 권고 2)', () => {
  it('요약투 종결을 검출한다(양성 4)', () => {
    expect(metaSummaryIssues('가을 묘목 심는 법을 정리했습니다.')).toHaveLength(1);
    expect(metaSummaryIssues('현장에서 확인한 기준만 담았어요.')).toHaveLength(1);
    expect(metaSummaryIssues('묘목 고르는 법을 알아봅니다.')).toHaveLength(1);
    expect(metaSummaryIssues('가지치기에 대해 알아보겠습니다.')).toHaveLength(1);
  });
  it('요약투가 아닌 문장은 통과한다(음성 3)', () => {
    expect(metaSummaryIssues('정리한 뒤 심습니다.')).toEqual([]);
    expect(metaSummaryIssues('잎이 상한 나무는 9월에 비료를 줘도 소용없습니다. 갈변이 어디서 시작됐는지부터 보세요.')).toEqual([]);
    expect(metaSummaryIssues('묘목을 살펴본 자리에서 뿌리부터 확인하세요.')).toEqual([]);
  });
  it('빈 입력은 통과한다', () => {
    expect(metaSummaryIssues('')).toEqual([]);
  });
  it('지적 문구에 걸린 표현과 대체 형식이 들어간다(수정 라운드·재시도 피드백 겸용)', () => {
    const [msg] = metaSummaryIssues('묘목 고르는 법을 소개합니다.');
    expect(msg).toContain('소개합니다');
    expect(msg).toContain('결론 한 줄 + 조건 한 줄');
  });
});

// 블로그 문체 린트(2026-08-27 말투 감사 권고 3) — 쇼츠·카드에만 있던 결정적 문체 검사를 본문에도 건다.
// 실코퍼스(data/sessions/*/draft.json bodyMarkdown 209편) 측정으로 임계·경계를 정했다(task-3 보고서).
describe('blogStyleIssues — 블로그 본문 문체 4종(2026-08-27 권고 3)', () => {
  it('ⓐ 대비문 3회 이상을 검출한다', () => {
    const md = [
      '뿌리가 문제가 아니라 자리가 문제입니다.',
      '굵기가 아니라 잔뿌리를 봅니다.',
      '물의 양이 아니라 간격이 정합니다.',
    ].join('\n');
    const issues = blogStyleIssues(md);
    expect(issues.some((i) => i.includes('대비문'))).toBe(true);
    expect(issues.some((i) => i.includes('3회'))).toBe(true);
  });

  it("ⓐ 2회 이하는 통과하고, 조사 없는 비교('원줄기보다 굵어지면')는 대비문으로 세지 않는다", () => {
    const md = [
      '뿌리가 문제가 아니라 자리가 문제입니다.',
      '굵기가 아니라 잔뿌리를 봅니다.',
      '가지가 원줄기보다 굵어지면 잘라 냅니다.',
    ].join('\n');
    expect(blogStyleIssues(md)).toEqual([]);
  });

  it("ⓐ 조사가 붙은 대비('~보다는')는 대비문으로 센다", () => {
    const md = [
      '뿌리가 문제가 아니라 자리가 문제입니다.',
      '굵기가 아니라 잔뿌리를 봅니다.',
      '전체를 짧게 치기보다는 안쪽 가지를 솎습니다.',
    ].join('\n');
    expect(blogStyleIssues(md).some((i) => i.includes('대비문'))).toBe(true);
  });

  it('ⓑ 문장 20개 이상에서 합쇼체 비율 60% 초과를 검출한다', () => {
    const md = [
      ...Array.from({ length: 15 }, (_, i) => `${i + 1}번 자리는 볕이 좋습니다.`),
      ...Array.from({ length: 6 }, () => '물은 아침에 주세요.'),
    ].join('\n');
    expect(blogStyleIssues(md).some((i) => i.includes('합쇼체 비율 71%'))).toBe(true);
  });

  it('ⓑ 문장 20개 미만이면 비율을 보지 않는다', () => {
    const md = Array.from({ length: 10 }, (_, i) => `${i + 1}번 자리는 볕이 좋습니다.`).join('\n');
    expect(blogStyleIssues(md).some((i) => i.includes('합쇼체'))).toBe(false);
  });

  // 계획서 지정 정규식은 '습니다|입니다' 다 — '봅니다·줍니다' 같은 나머지 -ㅂ니다 는 분자에 안 들어간다.
  // 실코퍼스 209편: 지정 정규식이면 최대 59%(발동 0편)이고, '니다' 전체로 넓히면 중앙값 70%·169편 발동이라
  // 매 편 목소리를 갈아엎으라는 지적이 된다. 지정 범위를 그대로 두고 상한 가드로 쓴다(task-3 보고서).
  it('ⓑ 습니다·입니다가 아닌 -ㅂ니다 종결(봅니다)은 분자에 넣지 않는다', () => {
    const md = Array.from({ length: 21 }, (_, i) => `${i + 1}번 자리는 흙부터 봅니다.`).join('\n');
    expect(blogStyleIssues(md).some((i) => i.includes('합쇼체'))).toBe(false);
  });

  it('ⓒ 한 문장 유보 표현 2개 이상을 문장별로 검출한다', () => {
    const md = '겉흙이 하얗게 말라 보여도 아래는 젖어 있는 경우가 많아서 대개 과하게 줍니다.';
    const issues = blogStyleIssues(md);
    expect(issues.some((i) => i.startsWith('유보 중첩'))).toBe(true);
    expect(issues.some((i) => i.includes('경우가 많아서'))).toBe(true);
  });

  it('ⓒ 문장마다 유보 표현이 하나면 통과한다', () => {
    const md = '겉흙이 마르면 물을 줍니다.\n대개 이틀에 한 번이면 충분합니다.';
    expect(blogStyleIssues(md)).toEqual([]);
  });

  it('ⓓ 서술어 없이 끝나는 목록 줄을 검출한다', () => {
    const issues = blogStyleIssues('- 나무의 나이와 키\n- 접목 자리 확인');
    expect(issues.filter((i) => i.startsWith('명사형 종결 목록'))).toHaveLength(2);
    expect(issues.some((i) => i.includes('나무의 나이와 키'))).toBe(true);
  });

  it('ⓓ 서술어로 끝나는 목록 줄은 통과한다', () => {
    const md = '- 나무의 나이를 확인하세요.\n1. 접목 자리를 봅니다.\n- 흙이 말랐는지 만져 봐요.';
    expect(blogStyleIssues(md)).toEqual([]);
  });

  it('ⓓ 인용 체크박스(>>>)는 항목만 보고 첫 줄(상자 제목)은 제외한다', () => {
    const md = '>>> 올리브 체크\n>>> 1) 접목 자리 확인\n>>> 2) 품종 라벨 확인';
    const issues = blogStyleIssues(md);
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.includes('올리브 체크'))).toBe(false);
    expect(issues.some((i) => i.includes('접목 자리 확인'))).toBe(true);
  });

  it('원예 상용어(전정·관수·도장지·시비)는 차단하지 않는다', () => {
    const md = '전정은 늦겨울에 합니다.\n관수는 아침에 합니다.\n도장지는 밑동에서 올라옵니다.\n시비는 봄에 합니다.';
    expect(blogStyleIssues(md)).toEqual([]);
  });

  it('표·코드 블록은 검사 대상에서 벗긴다', () => {
    const md = [
      '| 항목 | 시기 |',
      '| --- | --- |',
      '| 전정 | 2월 |',
      '',
      '```',
      '- 코드 안 목록',
      '대개 보통 흔히 대체로',
      '```',
    ].join('\n');
    expect(blogStyleIssues(md)).toEqual([]);
  });

  it('빈 본문은 통과한다', () => {
    expect(blogStyleIssues('')).toEqual([]);
  });
});

// 문체 린트 수정본 채택 가드(Fix round 1) — 작가가 퇴화 응답(짧은 메타 답변)을 내면 완성된 본문이 통째로
// 그 답변으로 대체되던 결함을 막는다. 사실 게이트 재작성(factGate.ts)과 같은 성격의 구조 가드다.
describe('styleRevisionReject — 문체 수정본 채택 가드(Fix round 1)', () => {
  const original = [
    '## 심는 자리',
    '뿌리가 앉을 자리를 먼저 봅니다. 물이 고이는 곳은 피합니다.',
    '',
    '## 물 주기',
    '겉흙이 마르면 한 번에 충분히 줍니다. 잦은 물은 뿌리를 약하게 합니다.',
  ].join('\n');

  it('소제목이 있던 본문인데 수정본에 소제목이 없으면 폐기한다(구조 손실)', () => {
    expect(styleRevisionReject(original, '네, 지적하신 대비문을 줄여 다시 썼습니다.')).toBe('구조 손실');
  });

  it('소제목이 없던 본문이어도 분량이 급감하면 폐기한다(퇴화 메타 답변)', () => {
    const flat = '뿌리가 앉을 자리를 먼저 봅니다. 물이 고이는 곳은 피합니다. 겉흙이 마르면 한 번에 충분히 줍니다.';
    expect(styleRevisionReject(flat, '알겠습니다. 수정했습니다.')).toBe('분량 급감');
  });

  it('구조가 남아 있고 분량이 비슷하면 채택한다(null)', () => {
    const revised = original.replace('잦은 물은 뿌리를 약하게 합니다.', '물을 자주 주면 뿌리가 약해집니다.');
    expect(styleRevisionReject(original, revised)).toBeNull();
  });

  it('빈 응답·공백만이면 폐기한다', () => {
    expect(styleRevisionReject(original, '')).toBe('빈 응답');
    expect(styleRevisionReject(original, '   \n  ')).toBe('빈 응답');
  });

  it('소제목은 살아 있어도 분량이 60% 미만으로 줄면 폐기한다', () => {
    expect(styleRevisionReject(original, '## 심는 자리\n물 고이는 곳은 피합니다.')).toBe('분량 급감');
  });

  it('소제목이 없던 본문에 소제목을 붙여 오는 것은 막지 않는다(구조 개선)', () => {
    const flat = '뿌리가 앉을 자리를 먼저 봅니다. 물이 고이는 곳은 피합니다. 겉흙이 마르면 한 번에 충분히 줍니다.';
    expect(styleRevisionReject(flat, `## 심는 자리\n${flat}`)).toBeNull();
  });
});
