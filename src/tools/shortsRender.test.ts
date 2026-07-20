import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { ensureShortsThumbnail } from './shortsRender';

afterEach(() => vi.restoreAllMocks());

// ffmpeg 실행 분기는 통합(실영상)으로 검증 — 여기선 파일 존재·신선도 판정(순수 fs 로직)만.
describe('ensureShortsThumbnail', () => {
  it('영상 없고 썸네일도 없으면 null', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(await ensureShortsThumbnail('/d')).toBeNull();
  });
  it('영상 없어도 기존 썸네일 있으면 그 경로 반환(재추출 안 함)', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p).endsWith('thumbnail.jpg'));
    expect(await ensureShortsThumbnail('/d')).toBe('/d/thumbnail.jpg');
  });
  it('썸네일이 영상보다 최신이면 ffmpeg 없이 재사용', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockImplementation((p) => ({ mtimeMs: String(p).endsWith('thumbnail.jpg') ? 200 : 100 }) as fs.Stats);
    expect(await ensureShortsThumbnail('/d')).toBe('/d/thumbnail.jpg');
  });
});
