import { describe, expect, it } from 'vitest';
import { aroundName, attachLoreRefs, collectLore, htmlText, isThin, loreMarkdown, loreQueries, pickPages } from './webtoonLore';

describe('webtoonLore', () => {
  it('질의 — 전설·꽃말·유래, 별칭은 하나 더', () => {
    const q = loreQueries('동백나무', '동백');
    expect(q).toContain('동백나무 꽃말');
    expect(q).toContain('동백나무 이름 유래');
    expect(q.at(-1)).toBe('동백 전설 유래');
    expect(loreQueries('감나무')).toHaveLength(7);
  });

  it('본문 가져올 쪽 — 수종 이름과 이야기 낱말이 같이 있어야', () => {
    const hits = [
      { title: '동백 재배', url: 'a', snippet: '동백나무 심는 시기' },
      { title: '동백꽃 전설', url: 'b', snippet: '동백나무에 얽힌 이야기' },
      { title: '꽃말 모음', url: 'c', snippet: '장미의 꽃말' },
    ];
    expect(pickPages(hits, ['동백나무'])).toEqual([1]);
  });

  it('HTML 평문·이름 둘레', () => {
    const t = htmlText('<p>머리말 하나입니다</p><script>x()</script><p>옛날 한 마을에 동백나무가 있었습니다</p><p>그 뒤 이야기가 이어집니다</p>');
    expect(t).not.toContain('x()');
    expect(aroundName(t, ['동백나무'])).toContain('동백나무가 있었습니다');
    expect(aroundName('관계없는 글입니다', ['동백나무'])).toBe('');
  });

  it('번호가 자료 밖이거나 줄거리가 짧으면 버린다', () => {
    const docs = [{ title: '백과', url: 'u1' }, { title: '블로그', url: 'u2' }];
    const r = attachLoreRefs({
      facts: [{ text: '꽃말은 기다림', kind: 'flower_language', ref: 1 }, { text: '지어낸 말', kind: 'legend', ref: 9 }, { text: '꽃말은 기다림', kind: 'flower_language', ref: 2 }],
      legends: [{ title: '전설', beats: ['가', '나', '다'], ref: 2 }, { title: '짧음', beats: ['가'], ref: 1 }, { title: '번호 없음', beats: ['가', '나', '다'], ref: 0 }],
    }, docs);
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0]).toMatchObject({ source: '백과', url: 'u1' });
    expect(r.legends.map((l) => l.title)).toEqual(['전설']);
  });

  it('빈약 판정과 자료 글', () => {
    expect(isThin({ facts: [], legends: [] })).toBe(true);
    const d = { species: '동백나무', queries: [], checkedTs: '', status: 'ok' as const,
      facts: [{ text: '꽃말은 기다림', kind: 'flower_language', ref: 1, source: '백과', url: 'u1' }],
      legends: [{ title: '섬 처녀', beats: ['가', '나', '다'], ref: 1, source: '백과', url: 'u1' }] };
    expect(isThin(d)).toBe(false);
    const md = loreMarkdown(d);
    expect(md).toContain('## 전설: 섬 처녀');
    expect(md).toContain('## 꽃말');
    expect(md).toContain('(출처: 백과, u1)');
  });

  it('수집 — 검색 0건은 error, 빈약하면 thin', async () => {
    const none = await collectLore({ name: '동백나무', model: 'm' }, { encyc: async () => [], web: async () => [], llm: async () => null, page: async () => '' });
    expect(none.status).toBe('error');
    const thin = await collectLore({ name: '동백나무', model: 'm' }, {
      encyc: async () => [{ title: '동백나무 꽃말', link: 'https://x/1', description: '동백나무 꽃말은 기다림' }],
      web: async () => [], page: async () => '',
      llm: async () => ({ facts: [{ text: '동백나무 꽃말은 기다림', kind: 'flower_language', ref: 1 }], legends: [] }),
    });
    expect(thin.status).toBe('thin');
    expect(thin.facts).toHaveLength(1);
  });
});
