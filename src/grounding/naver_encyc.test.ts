import { describe, it, expect } from 'vitest';
import { parseEncycItems } from './naver_encyc';

describe('parseEncycItems — 지식백과 응답 파서(순수)', () => {
  it('title/description 의 <b> 태그를 벗기고 link 를 그대로 둔다', () => {
    const json = { items: [
      { title: '<b>음나무</b>', link: 'https://terms.naver.com/entry.naver?docId=1', description: '두릅나무과의 <b>낙엽</b> 교목' },
      { title: '엄나무', link: 'https://terms.naver.com/entry.naver?docId=2', description: '음나무의 다른 이름' },
    ] };
    expect(parseEncycItems(json)).toEqual([
      { title: '음나무', link: 'https://terms.naver.com/entry.naver?docId=1', description: '두릅나무과의 낙엽 교목' },
      { title: '엄나무', link: 'https://terms.naver.com/entry.naver?docId=2', description: '음나무의 다른 이름' },
    ]);
  });
  it('link 없는 항목은 버리고 limit 로 자른다', () => {
    const json = { items: [{ title: 'a', description: 'x' }, { title: 'b', link: 'https://b', description: 'y' }, { title: 'c', link: 'https://c', description: 'z' }] };
    expect(parseEncycItems(json, 1)).toEqual([{ title: 'b', link: 'https://b', description: 'y' }]);
  });
  it('items 가 없거나 형식이 다르면 빈 배열', () => {
    expect(parseEncycItems(null)).toEqual([]);
    expect(parseEncycItems({ items: 'x' })).toEqual([]);
  });
});
