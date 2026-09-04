import { describe, it, expect } from 'vitest';
import { matchMedia, type MediaItem } from './mediaLibrary';

const mk = (o: Partial<MediaItem>): MediaItem => ({
  id: o.id ?? 'm', file: '/f.jpg', kind: o.kind ?? 'image', name: 'f.jpg', bytes: 1,
  createdTs: o.createdTs ?? '2026-09-01T00:00:00Z', ...o,
} as MediaItem);

describe('matchMedia — 주제에 맞는 소재 고르기', () => {
  it('수종이 맞는 소재가 최우선', () => {
    const items = [mk({ id: 'a' }), mk({ id: 'b', species: '수국' })];
    expect(matchMedia(items, { species: '수국' })[0]!.id).toBe('b');
  });
  it('다른 수종은 아예 안 쓴다 — 수국 편에 회양목 사진은 없느니만 못하다', () => {
    const items = [mk({ id: 'x', species: '회양목' })];
    expect(matchMedia(items, { species: '수국' })).toHaveLength(0);
  });
  it('수종 없는 범용 소재는 쓴다', () => {
    const items = [mk({ id: 'g' })];
    expect(matchMedia(items, { species: '수국' })).toHaveLength(1);
  });
  it('태그가 주제에 걸리면 점수가 오른다', () => {
    const items = [mk({ id: 'p' }), mk({ id: 'q', tags: ['전정'] })];
    expect(matchMedia(items, { text: '가을 전정 방법' })[0]!.id).toBe('q');
  });
  it('종류로 거른다', () => {
    const items = [mk({ id: 'i', kind: 'image' }), mk({ id: 'v', kind: 'video' })];
    expect(matchMedia(items, { kind: 'video' }).map((m) => m.id)).toEqual(['v']);
  });
  it('상한을 지킨다', () => {
    const items = Array.from({ length: 20 }, (_, i) => mk({ id: `m${i}` }));
    expect(matchMedia(items, { limit: 3 })).toHaveLength(3);
  });
  it('같은 점수면 최신 우선', () => {
    const items = [
      mk({ id: 'old', species: '수국', createdTs: '2026-01-01T00:00:00Z' }),
      mk({ id: 'new', species: '수국', createdTs: '2026-09-01T00:00:00Z' }),
    ];
    expect(matchMedia(items, { species: '수국' })[0]!.id).toBe('new');
  });
  it('빈 목록은 빈 결과', () => {
    expect(matchMedia([], { species: '수국' })).toEqual([]);
  });
});
