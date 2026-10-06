import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { coverFilter, coverStale, ensureShortsCover, COVER_FILE } from './shortsCover';

describe('coverFilter · coverStale(순수)', () => {
  it('흐림 배경은 꽉 채워 자르고, 전경은 전체가 들어가게 축소해 가운데', () => {
    const f = coverFilter(1080, 1920);
    expect(f).toContain('force_original_aspect_ratio=increase,crop=1080:1920');
    expect(f).toContain('force_original_aspect_ratio=decrease[fg]');
    expect(f).toContain('overlay=(W-w)/2:(H-h)/2');
  });
  it('커버 없음·썸네일보다 오래됨이면 재생성', () => {
    expect(coverStale(100, null)).toBe(true);
    expect(coverStale(100, 50)).toBe(true);
    expect(coverStale(100, 100)).toBe(false);
  });
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe.skipIf(!hasFfmpeg)('ensureShortsCover — 실제 ffmpeg', () => {
  const probe = (p: string) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p]).toString().trim();

  it('2:3 썸네일 → 1080×1920 커버, 신선하면 재사용', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-cover-'));
    execFileSync('ffmpeg', ['-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=1024x1536', '-frames:v', '1', path.join(dir, 'thumbnail.jpg')], { stdio: 'ignore' });
    const out = await ensureShortsCover(dir);
    expect(out).toBe(path.join(dir, COVER_FILE));
    expect(probe(out!)).toBe('1080,1920');
    const mt = fs.statSync(out!).mtimeMs;
    expect(await ensureShortsCover(dir)).toBe(out);
    expect(fs.statSync(out!).mtimeMs).toBe(mt); // 재사용(재생성 안 함)
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.shorts-cover-'))).toEqual([]); // 임시파일 잔존 없음
  });

  it('썸네일이 없으면 null', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-cover-'));
    expect(await ensureShortsCover(dir)).toBeNull();
  });
});
