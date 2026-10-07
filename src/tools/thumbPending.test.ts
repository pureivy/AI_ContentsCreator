import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markThumbPending, clearThumbPending, thumbPending, waitForThumbnail, THUMB_PENDING_FILE, THUMB_PENDING_STALE_MS } from './shortsRender';

describe('썸네일 생성 중 표시 — 발행 버튼이 썸네일을 기다린다(2026-10-07 밤나무 사고)', () => {
  const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-pending-'));
  it('표시가 있으면 기다리고, 지워지면 바로 진행', async () => {
    const d = dir();
    markThumbPending(d);
    expect(thumbPending(d)).toBe(true);
    setTimeout(() => clearThumbPending(d), 60);
    const t0 = Date.now();
    expect(await waitForThumbnail(d, 5_000, 10)).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });
  it('시간이 다 되면 false(호출부는 종전대로 진행)', async () => {
    const d = dir();
    markThumbPending(d);
    expect(await waitForThumbnail(d, 50, 10)).toBe(false);
  });
  it('표시가 없으면 즉시, 오래된(죽은 프로세스) 표시는 무시', async () => {
    const d = dir();
    expect(await waitForThumbnail(d, 50, 10)).toBe(true);
    markThumbPending(d);
    const old = (Date.now() - THUMB_PENDING_STALE_MS - 1_000) / 1000;
    fs.utimesSync(path.join(d, THUMB_PENDING_FILE), old, old);
    expect(thumbPending(d)).toBe(false);
  });
});
