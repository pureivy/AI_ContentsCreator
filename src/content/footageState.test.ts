import { describe, it, expect } from 'vitest';
import { cardPhotoIssues } from './footageState';

describe('cardPhotoIssues — 카드 표지 문구 ↔ 표지 실촬영(2026-10-15)', () => {
  const oct = '야외 호두나무 가지와 잎, 초록 열매가 달린 모습';
  it('실측: 잎 달린 실촬영 표지 위 "잎 다 떨어졌는데 죽은 걸까요" — 1번 카드 지적', () => {
    const r = cardPhotoIssues([{ headline: '호두나무 활착, 잎 지면 헷갈려요', body: '잎 다 떨어졌는데\n죽은 걸까요' }, { headline: '가지로 확인하세요' }], oct);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^1번 카드\(표지\)/);
    expect(r[0]).toContain('문구는');
  });
  it('다른 장은 "지금" 상태를 단정할 때만', () => {
    expect(cardPhotoIssues([{ headline: '표지' }, { headline: '가을 낙엽은 정상이에요', body: '잎이 지는 건 자연스러워요' }], oct)).toEqual([]);
    expect(cardPhotoIssues([{ headline: '표지' }, { headline: '잎이 진 지금', body: '가지를 만져 보세요' }], oct)[0]).toMatch(/^2번 카드:/);
  });
  it('사진 판독이 없으면 아무것도 하지 않는다', () => {
    expect(cardPhotoIssues([{ headline: '잎 다 떨어졌어요' }], undefined)).toEqual([]);
  });
});
