import { describe, it, expect } from 'vitest';
import { stripTrailingTagDump } from './naverBlog';

// 실측(2026-08-10 사용자 지적): 작가 모델이 가끔 본문 끝에 맨 키워드를 나열한다("포도나무수확시기
// 포도수확시기 … 비온디트리" — 태그 접두 없음). 발행 레이어의 #태그 칩과 중복이고 본문 키워드
// 덤프는 스팸 신호가 된다. 종전 정규식은 "태그: #…" 접두 줄만 지워 맨 나열이 통과했다.
describe('stripTrailingTagDump — 본문 끝 태그·키워드 나열 제거(순수)', () => {
  it('"태그: #…" 줄을 제거한다(종전 동작 유지)', () => {
    expect(stripTrailingTagDump('본문입니다.\n\n태그: #사과 #배')).toBe('본문입니다.');
    expect(stripTrailingTagDump('본문입니다.\n\n**태그**: #사과 #배')).toBe('본문입니다.');
  });
  it('맨 키워드 나열(4개 이상 토큰·구두점 없음)을 제거한다', () => {
    const body = '나무가 자리 잡는 과정을 기록하고 있습니다.\n\n포도나무수확시기 포도수확시기 캠벨포도수확시기 화분포도 비온디트리';
    expect(stripTrailingTagDump(body)).toBe('나무가 자리 잡는 과정을 기록하고 있습니다.');
  });
  it('마침표로 끝나는 정상 마무리 문단은 남긴다', () => {
    const body = '첫 문단.\n\n계절마다 어떤 신호를 내는지 계속 기록합니다.';
    expect(stripTrailingTagDump(body)).toBe(body);
  });
  it('구두점이 있는 나열 문장은 남긴다', () => {
    const body = '본문.\n\n사과, 배, 감, 포도를 함께 심었습니다';
    expect(stripTrailingTagDump(body)).toBe(body);
  });
  it('토큰 3개 이하 짧은 줄은 남긴다(과제거 방지)', () => {
    const body = '본문.\n\n감사합니다 여러분 안녕히';
    expect(stripTrailingTagDump(body)).toBe(body);
  });
});
