import { describe, it, expect } from 'vitest';
import { pruneArchive } from './speciesRefsArchive';

describe('pruneArchive(2026-11-09 자료실 → 정답 사진)', () => {
  it('같은 자료는 하나만, 농원 사진은 최신 keep 장만 — 다른 사진은 그대로', () => {
    const r = pruneArchive([
      { file: 'c1.jpg', role: 'leaf' },
      { file: 'm_a.jpg', role: 'archive', media: 'a', added: '2026-11-01' },
      { file: 'm_b.jpg', role: 'archive', media: 'b', added: '2026-11-03' },
      { file: 'm_c.jpg', role: 'archive', media: 'c', added: '2026-11-02' },
      { file: 'm_b2.jpg', role: 'archive', media: 'b', added: '2026-10-01' },
    ], 2);
    expect(r.photos.map((p) => p.file)).toEqual(['c1.jpg', 'm_b.jpg', 'm_c.jpg']);
    expect(r.dropped.sort()).toEqual(['m_a.jpg', 'm_b2.jpg']);
  });
});
