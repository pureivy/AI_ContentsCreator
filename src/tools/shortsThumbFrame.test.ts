import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { hasDesignThumbnail, isFrameThumbnail, THUMB_FRAME_FILE } from './shortsRender';

describe('hasDesignThumbnail — 영상 장면 대체본은 디자인 썸네일이 아니다(2026-10-27 배나무 인스타 편)', () => {
  const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'thumbframe-'));
  it('파일 없음 → false', () => {
    expect(hasDesignThumbnail(dir())).toBe(false);
  });
  it('thumbnail.jpg 만 있으면 디자인 썸네일', () => {
    const d = dir(); fs.writeFileSync(path.join(d, 'thumbnail.jpg'), 'x');
    expect(hasDesignThumbnail(d)).toBe(true);
    expect(isFrameThumbnail(d)).toBe(false);
  });
  it('장면 대체 표식이 있으면 false', () => {
    const d = dir(); fs.writeFileSync(path.join(d, 'thumbnail.jpg'), 'x'); fs.writeFileSync(path.join(d, THUMB_FRAME_FILE), 't');
    expect(isFrameThumbnail(d)).toBe(true);
    expect(hasDesignThumbnail(d)).toBe(false);
  });
});
