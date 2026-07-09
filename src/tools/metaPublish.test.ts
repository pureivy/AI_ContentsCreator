import { describe, it, expect } from 'vitest';
import { buildIgCaption, extractId, pickPhotoUrl, parsePermalink, graphError } from './metaPublish';

describe('metaPublish 순수 헬퍼', () => {
  it('buildIgCaption: 캡션+해시태그 결합, 2200자 캡', () => {
    expect(buildIgCaption('본문', ['#a', '#b'])).toBe('본문\n\n#a #b');
    expect(buildIgCaption('', ['#a'])).toBe('#a');
    expect(buildIgCaption('x'.repeat(3000), []).length).toBe(2200);
  });
  it('extractId: {id} 추출, 이형은 null', () => {
    expect(extractId({ id: '123' })).toBe('123');
    expect(extractId({})).toBeNull();
    expect(extractId(null)).toBeNull();
    expect(extractId({ id: 42 })).toBeNull();
  });
  it('pickPhotoUrl: images[0].source(최대 해상도), 이형은 null', () => {
    expect(pickPhotoUrl({ images: [{ source: 'https://cdn/a.png' }, { source: 'https://cdn/small.png' }] })).toBe('https://cdn/a.png');
    expect(pickPhotoUrl({ images: [] })).toBeNull();
    expect(pickPhotoUrl({})).toBeNull();
  });
  it('parsePermalink: {permalink} 추출', () => {
    expect(parsePermalink({ permalink: 'https://www.instagram.com/p/x/' })).toBe('https://www.instagram.com/p/x/');
    expect(parsePermalink({})).toBeNull();
  });
  it('graphError: 그래프 에러 메시지 추출(토큰 미노출), 없으면 HTTP 코드', () => {
    expect(graphError({ error: { message: 'Invalid parameter', code: 100 } }, 400)).toBe('Invalid parameter(code 100)');
    expect(graphError({}, 500)).toBe('HTTP 500');
  });
});
