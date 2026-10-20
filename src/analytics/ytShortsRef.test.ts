import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('ytShortsRef', () => {
  let tmp: string;
  const top = vi.fn();
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytref-'));
    top.mockReset();
    vi.resetModules();
    vi.doMock('../config', () => ({ CONFIG: { dataDir: tmp } }));
    vi.doMock('../content/brand', () => ({ activeBrandSlug: () => '', brandFileSuffixFor: () => '' }));
    vi.doMock('../grounding/youtube', () => ({ youtubeShortsTop: top }));
  });
  afterEach(() => { vi.doUnmock('../config'); vi.doUnmock('../content/brand'); vi.doUnmock('../grounding/youtube'); fs.rmSync(tmp, { recursive: true, force: true }); });

  const vid = (title: string, views: number) => ({ videoId: title, title, channel: '', publishedAt: '', views, durationMin: 1, durationSec: 30 });
  const file = () => path.join(tmp, 'topics', 'yt-shorts-ref.json');

  it('같은 날 두 번째 호출은 캐시 적중(API 1회), 공백·대소문자 정규화', async () => {
    top.mockResolvedValue([vid('A', 1000)]);
    const { getShortsRef } = await import('./ytShortsRef');
    const now = new Date('2026-10-20T10:00:00');
    expect((await getShortsRef('모과  삽목', undefined, undefined, now)).length).toBe(1);
    expect((await getShortsRef('모과 삽목', undefined, undefined, new Date('2026-10-20T22:00:00'))).length).toBe(1);
    expect(top).toHaveBeenCalledTimes(1);
  });
  it('빈 결과도 캐시하고, 다음 날엔 다시 부른다', async () => {
    top.mockResolvedValue([]);
    const { getShortsRef } = await import('./ytShortsRef');
    await getShortsRef('석류', undefined, undefined, new Date('2026-10-20T10:00:00'));
    await getShortsRef('석류', undefined, undefined, new Date('2026-10-20T11:00:00'));
    expect(top).toHaveBeenCalledTimes(1);
    await getShortsRef('석류', undefined, undefined, new Date('2026-10-21T10:00:00'));
    expect(top).toHaveBeenCalledTimes(2);
  });
  it('14일 지난 항목은 정리한다', async () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ date: '2026-09-01', entries: { 옛날: { ts: '2026-09-01T00:00:00.000Z', videos: [] }, 최근: { ts: '2026-10-15T00:00:00.000Z', videos: [] } } }));
    top.mockResolvedValue([]);
    const { getShortsRef } = await import('./ytShortsRef');
    await getShortsRef('새것', undefined, undefined, new Date('2026-10-20T10:00:00'));
    const saved = JSON.parse(fs.readFileSync(file(), 'utf-8')) as { entries: Record<string, unknown> };
    expect(Object.keys(saved.entries).sort()).toEqual(['새것', '최근'].sort());
  });
  it('API 예외는 []', async () => {
    top.mockRejectedValue(new Error('x'));
    const { getShortsRef } = await import('./ytShortsRef');
    expect(await getShortsRef('모과')).toEqual([]);
  });
  it('블록 — 영상 없으면 빈 문자열, 있으면 제목·만회 표기와 지침', async () => {
    const { buildShortsRefBlock } = await import('./ytShortsRef');
    expect(buildShortsRefBlock('모과', [])).toBe('');
    const b = buildShortsRefBlock('모과', [{ title: '모과 삽목', views: 23_456, durationSec: 30 }, { title: 'B', views: 900, durationSec: 20 }], '2026-10-20');
    expect(b).toContain('[같은 소재 유튜브 쇼츠 — 조회 상위(2026-10-20 수집');
    expect(b).toContain('- "모과 삽목"(2.3만회)');
    expect(b).toContain('- "B"(900회)');
    expect(b).toContain('베끼지 마라');
  });
});
