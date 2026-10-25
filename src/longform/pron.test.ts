import { describe, expect, it } from 'vitest';
import { heardScore, meaningMismatch, negationCounts, numberTokens } from './pron';

describe('heardScore', () => {
  it('같은 문장이면 1, 문장부호·띄어쓰기는 무시', () => {
    expect(heardScore('가지를 자릅니다.', '가지를  자릅니다')).toBe(1);
  });
  it('숫자 표기 차이(세 개 ↔ 3개)는 벌점이 없다', () => {
    expect(heardScore('세 곳입니다', '3곳입니다')).toBe(1);
    expect(heardScore('여섯 유형', '6유형')).toBe(1);
  });
  it('뜻이 바뀌는 오독은 점수가 떨어진다', () => {
    expect(heardScore('겨울 전정은 그때 시작합니다', '겨울 전쟁은 그때 시작합니다')).toBeLessThan(0.95);
  });
});

// 2026-10-25 — 점수만으로는 못 잡던 뜻 뒤집힘(숫자·부정)과 소수점 사각.
describe('소수점·meaningMismatch', () => {
  it('소수점은 지우지 않는다 — 1.8m ↔ 18미터가 더는 1.0 이 아니다', () => {
    expect(heardScore('1.8m 까지 자랍니다.', '18미터까지 자랍니다')).toBeLessThan(0.97);
    expect(heardScore('1.8m 까지 자랍니다.', '1.8미터까지 자랍니다')).toBe(1);
    expect(heardScore('1,000그루', '1000그루')).toBe(1);
  });
  it('반드시 잡을 오독 — 부정 빠짐·달·자릿수·소수', () => {
    expect(meaningMismatch('이 시기에는 절대 가지를 자르면 안 됩니다.', '이 시기에는 절대 가지를 자르면 됩니다')).toContain('부정');
    expect(meaningMismatch('꽃눈은 3월에 부풉니다.', '꽃눈은 5월에 부풉니다')).toContain('숫자');
    expect(meaningMismatch('간격은 4미터입니다.', '간격은 40미터입니다')).toContain('숫자');
    expect(meaningMismatch('간격은 0.5m 입니다.', '간격은 5미터입니다')).toContain('숫자');
    expect(meaningMismatch('1.8m 까지 자랍니다.', '18미터까지 자랍니다')).toContain('숫자');
    expect(meaningMismatch('자르지 마세요.', '자르세요')).toContain('부정');
    expect(meaningMismatch('잎이 없습니다', '잎이 있습니다')).toContain('부정');
    expect(meaningMismatch('자르지 않습니다', '자릅니다')).toContain('부정');
    expect(meaningMismatch('뿌리가 못 버팁니다', '뿌리가 버팁니다')).toContain('부정');
    expect(meaningMismatch('안 자르면 안 됩니다', '자르면 안 됩니다')).toContain('부정'); // 개수로 센다
  });
  it('헛경보 없음 — 달·수를 낱말로 적은 받아쓰기, 붙여 쓴 안돼, 안쪽·두다·세균', () => {
    expect(meaningMismatch('10월에 심습니다.', '시월에 심습니다')).toBeNull();
    expect(meaningMismatch('6월 초에', '유월 초에')).toBeNull();
    expect(meaningMismatch('세 그루를 심습니다.', '3그루를 심습니다')).toBeNull();
    expect(meaningMismatch('열 그루', '10그루')).toBeNull();
    expect(meaningMismatch('10~15m 높이', '10에서 15미터 높이')).toBeNull();
    expect(meaningMismatch('지금 자르면 안됩니다.', '지금 자르면 안 됩니다')).toBeNull();
    expect(meaningMismatch('집 안에 둡니다.', '집 안에 둡니다')).toBeNull();
    expect(meaningMismatch('안쪽 가지를 그대로 두면 3년 뒤 열립니다', '안쪽 가지를 그대로 도면 3년 뒤 열립니다')).toBeNull();
    expect(meaningMismatch('세균이 3일 만에 번집니다', '새균이 3일 만에 번집니다')).toBeNull();
    // 받아쓰기가 수를 낱말로만 적으면(한쪽에 숫자 없음) 숫자 대조는 하지 않는다 — 점수가 맡는다
    expect(meaningMismatch('스물다섯 그루', '25그루')).toBeNull();
  });
  it('numberTokens·negationCounts', () => {
    expect(numberTokens('0.5m 와 3월, 두 번')).toEqual(['0.5', '3', '2']);
    expect(numberTokens('그대로 두면 됩니다')).toEqual([]);
    expect(negationCounts('못을 박고 안쪽을 봅니다')).toMatchObject({ 안: 0, 못: 0 });
    expect(negationCounts('자르지 못합니다')).toMatchObject({ 못: 1 });
  });
});

// 10-25 리뷰 — 띄어쓰기만 다른 부정·낱말로 적은 수가 '뜻 불일치'로 잡히던 헛경보.
describe('meaningMismatch 헛경보 줄이기 — 띄어쓰기·수 낱말', () => {
  it('부정: 띄어쓰기만 다르면 같은 뜻(안심어도·못자랍니다·잘못·화분안·안 쪽·못 자리)', () => {
    expect(meaningMismatch('지금은 안 심어도 됩니다', '지금은 안심어도 됩니다')).toBeNull();
    expect(meaningMismatch('뿌리가 못 자랍니다', '뿌리가 못자랍니다')).toBeNull();
    expect(meaningMismatch('잘 못 자르면 상합니다', '잘못 자르면 상합니다')).toBeNull();
    expect(meaningMismatch('화분 안 흙을 봅니다', '화분안 흙을 봅니다')).toBeNull();
    expect(meaningMismatch('안쪽 가지를 자릅니다', '안 쪽 가지를 자릅니다')).toBeNull();
    expect(meaningMismatch('못자리에 둡니다', '못 자리에 둡니다')).toBeNull();
  });
  it('부정: 반드시 잡을 것은 그대로', () => {
    expect(meaningMismatch('자르면 안 됩니다', '자르면 됩니다')).toContain('부정');
    expect(meaningMismatch('자르지 마세요', '자르세요')).toContain('부정');
    expect(meaningMismatch('잎이 없습니다', '잎이 있습니다')).toContain('부정');
    expect(meaningMismatch('자라지 않습니다', '자랍니다')).toContain('부정');
    expect(meaningMismatch('뿌리가 못 버팁니다', '뿌리가 버팁니다')).toContain('부정');
  });
  it('숫자: 낱말로 적은 수(일주일·열흘·사오월·이삼년생·1천500·1점5·두 해·십 미터)는 같은 수', () => {
    expect(meaningMismatch('일주일에 한 번 줍니다', '1주일에 한 번 줍니다')).toBeNull();
    expect(meaningMismatch('열흘 뒤에 봅니다', '10일 뒤에 봅니다')).toBeNull();
    expect(meaningMismatch('보름 뒤 3번', '15일 뒤 3번')).toBeNull();
    expect(meaningMismatch('4~5월에 핍니다', '사오월에 핍니다')).toBeNull();
    expect(meaningMismatch('2~3년생 묘목', '이삼년생 묘목')).toBeNull();
    expect(meaningMismatch('1,500그루', '1천500그루')).toBeNull();
    expect(meaningMismatch('3만 그루', '30000그루')).toBeNull();
    expect(meaningMismatch('1.5미터까지', '1점5미터까지')).toBeNull();
    expect(meaningMismatch('두 해 뒤 3월', '2해 뒤 3월')).toBeNull();
    expect(meaningMismatch('10미터까지 자랍니다', '십 미터까지 자랍니다')).toBeNull();
    expect(numberTokens('사오월')).toEqual(['4', '5']);
    expect(numberTokens('이사월에')).toEqual([]); // 이웃한 수가 아니면 낱말
    expect(numberTokens('일이 번거롭습니다')).toEqual([]);
  });
  it('숫자: 진짜 오독은 그대로 잡는다', () => {
    expect(meaningMismatch('6~14m 높이', '63미터 높이')).toContain('숫자');
    expect(meaningMismatch('3월에 심습니다', '5월에 심습니다')).toContain('숫자');
    expect(meaningMismatch('4미터 간격', '40미터 간격')).toContain('숫자');
    expect(meaningMismatch('1.5미터', '15미터')).toContain('숫자');
    expect(meaningMismatch('1,500그루', '150그루')).toContain('숫자');
  });
});
