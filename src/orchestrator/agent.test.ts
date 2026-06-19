import { describe, it, expect } from 'vitest';
import { extractFirstJson } from './agent';

describe('extractFirstJson', () => {
  it('순수 JSON 객체를 파싱한다', () => {
    expect(extractFirstJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('코드펜스를 벗긴다', () => {
    expect(extractFirstJson('```json\n{"x":[1,2]}\n```')).toEqual({ x: [1, 2] });
  });
  it('머리말이 있어도 첫 객체를 뽑는다', () => {
    const raw = '네, 분해 결과입니다:\n{"subproblems":[{"id":"sp1","text":"a"}]}\n끝.';
    expect(extractFirstJson<{ subproblems: unknown[] }>(raw)?.subproblems).toHaveLength(1);
  });
  it('문자열 안의 중괄호에 속지 않는다', () => {
    expect(extractFirstJson('{"t":"a {nested} b"}')).toEqual({ t: 'a {nested} b' });
  });
  it('JSON 이 없으면 null', () => {
    expect(extractFirstJson('그냥 텍스트')).toBeNull();
  });
});
