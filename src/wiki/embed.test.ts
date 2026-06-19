import { describe, it, expect } from 'vitest';
import { cosineSim, resolveEmbedModel } from './embed';

describe('cosineSim', () => {
  it('동일 벡터는 1', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('직교 벡터는 0', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('반대 방향은 -1', () => {
    expect(cosineSim([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
  });
  it('영벡터·빈 입력은 0(NaN 방지)', () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
    expect(cosineSim([], [1])).toBe(0);
  });
  it('스케일 불변(방향만 본다)', () => {
    expect(cosineSim([2, 4], [1, 2])).toBeCloseTo(1, 6);
  });
});

describe('resolveEmbedModel', () => {
  const m = (name: string) => ({ name, sizeGB: 1 });
  it('설치 모델 중 임베딩류를 자동 선택', () => {
    expect(resolveEmbedModel([m('gemma4:12b'), m('bge-m3:latest')])).toBe('bge-m3:latest');
    expect(resolveEmbedModel([m('nomic-embed-text'), m('qwen3:14b')])).toBe('nomic-embed-text');
  });
  it('임베딩 모델이 없으면 null(→ 휴리스틱 폴백)', () => {
    expect(resolveEmbedModel([m('gemma4:12b'), m('qwen3:14b')])).toBeNull();
    expect(resolveEmbedModel([])).toBeNull();
  });
  it('채팅 모델만 있으면 잘못 고르지 않는다', () => {
    expect(resolveEmbedModel([m('llama3:8b'), m('mistral:7b')])).toBeNull();
  });
});
