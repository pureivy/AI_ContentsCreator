import { describe, it, expect } from 'vitest';
import { scoreSeo } from './seo';

// 도입부 판정(2026-10-05) — 첫머리 굵은 요약 두 줄(편집 확정 규칙)이 생기며 '첫 문단'이 요약 한 줄이 될 수 있다.
// 참고 블로그 2026-10-02 수선(첫 소제목 앞 글 문단 2개)을 이식하고, 굵게 마커는 떼고 본다.
const check = (r: ReturnType<typeof scoreSeo>, label: string) => r.checklist.find((c) => c.label === label);
const LABEL = '첫 문단에 핵심 키워드';
const tags = ['a', 'b', 'c', 'd', 'e'];
const tail = ['## 하나', '본문입니다. '.repeat(300), '## 둘', '## 셋'];
const score = (body: string) => scoreSeo({ title: '라일락 꽃말, 첫사랑이 된 이유 열다섯 자', body, primaryKeyword: '라일락 꽃말', tags, imageSlots: 1 });

describe('scoreSeo — 첫 문단 키워드 = 첫 소제목 앞 글 문단 2개', () => {
  it('첫머리 굵은 요약 안의 키워드를 인정한다(굵게 마커가 키워드를 갈라도)', () => {
    const body = ['**라일락** **꽃말**은 첫사랑의 시작이에요.\n**향이 짧아서 붙은 이름이에요.**', '도입 문장입니다.', ...tail].join('\n\n');
    expect(check(score(body), LABEL)?.ok).toBe(true); // 마커를 떼면 "라일락 꽃말" 그대로 — 종전 includes 판정은 놓쳤다
    const ok = ['**라일락 꽃말은 첫사랑의 시작입니다.**\n**향이 짧아서 붙은 이름이에요.**', '도입 문장입니다.', ...tail].join('\n\n');
    expect(check(score(ok), LABEL)?.ok).toBe(true);
    const split = ['**라일락** 꽃말은 첫사랑의 시작입니다.', '도입 문장입니다.', ...tail].join('\n\n');
    expect(check(score(split), LABEL)?.ok).toBe(true);
  });
  it('요약에 없고 바로 다음 도입 문단에 있어도 인정한다', () => {
    const body = ['**첫사랑의 시작이라는 뜻입니다.**\n**향이 짧아서 붙은 이름이에요.**', '[IMAGE: 라일락]', '---', '라일락 꽃말을 찾아오셨나요.', ...tail].join('\n\n');
    expect(check(score(body), LABEL)?.ok).toBe(true);
  });
  it('세 번째 문단·소제목 뒤 키워드는 인정하지 않는다', () => {
    const late = ['첫 줄.', '둘째 줄.', '셋째 문단에 라일락 꽃말.', ...tail].join('\n\n');
    expect(check(score(late), LABEL)?.ok).toBe(false);
    const afterH2 = ['첫 줄.', '## 라일락 꽃말 소제목', '본문 라일락 꽃말'].join('\n\n');
    expect(check(score(afterH2), LABEL)?.ok).toBe(false);
  });
  // 리뷰(2026-10-05) — 소제목으로 바로 시작하는 글이 늘 미달이던 것을 고쳤다: 첫 소제목·그 아래 굵은 요약 덩어리까지 인정.
  it('소제목으로 바로 시작하는 글 — 첫 소제목에 키워드가 있으면 인정', () => {
    const body = ['## 라일락 꽃말', '첫사랑이라는 뜻입니다.', ...tail].join('\n\n');
    expect(check(score(body), LABEL)?.ok).toBe(true);
  });
  it('소제목으로 바로 시작하는 글 — 소제목 아래 굵은 요약 덩어리의 키워드도 인정', () => {
    const body = ['## 첫사랑의 꽃', '**라일락 꽃말은 첫사랑입니다.**\n**향은 두 주 갑니다.**', ...tail].join('\n\n');
    expect(check(score(body), LABEL)?.ok).toBe(true);
  });
  it('소제목으로 바로 시작해도 키워드가 소제목·요약에 없고 보통 문단에만 있으면 미달', () => {
    const body = ['## 첫사랑의 꽃', '라일락 꽃말은 첫사랑입니다.', ...tail].join('\n\n');
    expect(check(score(body), LABEL)?.ok).toBe(false);
    const late = ['## 첫사랑의 꽃', '**향은 두 주 갑니다.**', '## 라일락 꽃말', ...tail].join('\n\n');
    expect(check(score(late), LABEL)?.ok).toBe(false);
  });
  it('다른 항목과 점수 계산은 그대로(9항목)', () => {
    const ok = ['**라일락 꽃말은 첫사랑의 시작입니다.**', ...tail].join('\n\n');
    expect(score(ok).checklist).toHaveLength(9);
  });
});

// 2026-10-05 대추나무 초안 — 키워드 판정이 includes 라 검색어 꼴("대추나무 심는시기")을 그대로 써야 통과했고,
// 그게 "…대추나무 심는시기의 마지막 가을 창입니다" 같은 문장을 낳았다. 바른 띄어쓰기·조사가 붙은 꼴도 통과해야 한다.
describe('scoreSeo — 키워드 판정은 띄어쓰기·조사 무시', () => {
  const kw = '대추나무 심는시기';
  const run = (title: string, lead: string) => scoreSeo({ title, body: [lead, '도입 문장입니다.', ...tail].join('\n\n'), primaryKeyword: kw, tags, imageSlots: 1 });
  it('제목·첫 문단에 "대추나무 심는 시기는"이 있으면 통과', () => {
    const r = run('대추나무 심는 시기는 언제일까, 가을과 봄 비교', '**대추나무 심는 시기는 땅 상태로 정해요.**');
    expect(check(r, '제목에 핵심 키워드 포함')?.ok).toBe(true);
    expect(check(r, LABEL)?.ok).toBe(true);
  });
  it('토큰 사이 조사("대추나무를 심는 시기")도 통과, 검색어 꼴 그대로도 여전히 통과', () => {
    expect(check(run('대추나무를 심는 시기, 가을이 나은 이유', '대추나무를 심는 시기는 10월 하순이에요.'), LABEL)?.ok).toBe(true);
    expect(check(run('대추나무 심는시기, 가을 vs 봄 성공률', '대추나무 심는시기는 땅으로 봅니다.'), '제목에 핵심 키워드 포함')?.ok).toBe(true);
  });
  it('키워드가 없으면 여전히 미달', () => {
    const r = run('가을에 나무 심을 때 확인할 것 세 가지', '땅 상태부터 봅니다.');
    expect(check(r, '제목에 핵심 키워드 포함')?.ok).toBe(false);
    expect(check(r, LABEL)?.ok).toBe(false);
  });
  it('밀도는 자연스러운 꼴도 센다', () => {
    const r = run('대추나무 심는 시기, 가을 vs 봄', '대추나무 심는 시기는 가을이에요. 대추나무를 심는 시기는 땅이 정해요.');
    expect(check(r, '키워드 밀도 0.5~2.5%(과최적화 경계)')?.note).toMatch(/\(2회\)$/);
  });
});
