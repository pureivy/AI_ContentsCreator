import { describe, expect, it } from 'vitest';
import { heardScore } from './pron';

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
