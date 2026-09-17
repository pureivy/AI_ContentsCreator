import { describe, it, expect } from 'vitest';
import { isLoreTopic, LORE_TOKENS, LORE_TOPIC_RE } from './loreTopic';

describe('isLoreTopic — 읽을 거리 주제 판정(순수)', () => {
  it('이야기 5축 표현을 잡는다', () => {
    expect(isLoreTopic('은행나무 전설, 천 년을 산 나무')).toBe(true);
    expect(isLoreTopic('동백꽃 꽃말과 이름 유래')).toBe(true);
    expect(isLoreTopic('회화나무가 서원 마당에 선 이유')).toBe(true);
    expect(isLoreTopic('시 속 소나무, 윤선도가 본 것')).toBe(true);
    expect(isLoreTopic('메타세쿼이아 가로수길, 담양의 가을')).toBe(true);
    expect(isLoreTopic('마량리 동백나무 숲, 천연기념물이 된 사연')).toBe(true);
  });
  it('재배 제목은 안 잡는다 — 부분 문자열 가로채기 실측(노래기·그림자·상징) 재현', () => {
    expect(isLoreTopic('노래기 방제, 지금 뿌려야 하는 약')).toBe(false);
    expect(isLoreTopic('그림자 지는 자리, 일조 진단법')).toBe(false);
    expect(isLoreTopic('가을 정원의 상징, 단풍 감상법')).toBe(false);
    expect(isLoreTopic('전정가위 종류별 쓰임새')).toBe(false);
    expect(isLoreTopic('동백나무 산성 흙, pH 측정과 배수 확인 방법')).toBe(false);
    expect(isLoreTopic('자두나무 가지치기, 높이는 손이 정합니다')).toBe(false);
  });
  it('빈 문자열·비문자열은 false', () => {
    expect(isLoreTopic('')).toBe(false);
    expect(isLoreTopic('   ')).toBe(false);
    expect(isLoreTopic(undefined as unknown as string)).toBe(false);
  });
  it('정규식은 토큰 전부를 담는다(토큰을 고치면 정규식이 따라온다)', () => {
    for (const t of LORE_TOKENS) expect(LORE_TOPIC_RE.test(`나무 ${t} 이야기`)).toBe(true);
  });
});
