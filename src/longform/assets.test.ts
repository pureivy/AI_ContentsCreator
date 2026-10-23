import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assembleTimeline, synthesizeAll, type AssetDeps } from './assets';
import { loadEpisodeScript, saveEpisodeScript } from './episode';
import type { LongformScript } from './script';

const S = (): LongformScript => ({
  title: 't', species: ['감나무'],
  chapters: [
    { id: 'intro', title: '시작', species: [], segments: [{ id: 'intro-01', narration: '전정은 잎이 진 뒤에 합니다.' }, { id: 'intro-02', narration: '감나무를 봅니다.' }] },
    { id: 'gam', title: '감', species: ['감나무'], segments: [{ id: 'gam-01', narration: '감나무는 늦게 자릅니다.' }] },
  ],
});

/** mp3 = 낭독 글자 그대로, 받아쓰기 = 그 글자(단 '전정'은 '전쟁'으로 들린다). */
function fakeDeps(over: Partial<AssetDeps> = {}): AssetDeps & { synth: ReturnType<typeof vi.fn> } {
  return {
    synth: vi.fn(async (text: string) => Buffer.from(text)),
    stt: async (mp3) => mp3.toString().replace('전정은', '전쟁은 전쟁'),
    probe: async () => 2,
    cut: async (_src, _a, _b, out) => { fs.writeFileSync(out, 'clip'); },
    ...over,
  } as AssetDeps & { synth: ReturnType<typeof vi.fn> };
}

describe('synthesizeAll', () => {
  it('3번 녹음해도 0.9 미만이면 뜻 보존 바꿔 쓰기 → 대본·pron.json 갱신, 캐시는 재실행 비용 0', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-assets-'));
    saveEpisodeScript(dir, S());
    const deps = fakeDeps();
    const reword = vi.fn(async () => '가지치기는 잎이 진 뒤에 합니다.');
    const r = await synthesizeAll(dir, S(), { deps, reword });
    expect(reword).toHaveBeenCalledTimes(1);
    expect(r.rewordCount).toBe(1);
    expect(r.script.chapters[0]!.segments[0]!.narration).toBe('가지치기는 잎이 진 뒤에 합니다.');
    expect(loadEpisodeScript(dir).chapters[0]!.segments[0]!.narration).toBe('가지치기는 잎이 진 뒤에 합니다.');
    const pron = JSON.parse(fs.readFileSync(path.join(dir, 'pron.json'), 'utf8'));
    expect(pron['intro-01'].rewrites[0]).toMatchObject({ from: '전정은 잎이 진 뒤에 합니다.', to: '가지치기는 잎이 진 뒤에 합니다.' });
    expect(pron['intro-01'].takes).toBe(4); // 원문 3번 + 바꾼 문장 1번(첫 녹음에 통과)
    expect(pron['intro-02'].score).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'audio', 'intro-01.mp3.key'), 'utf8')).toBe('가지치기는 잎이 진 뒤에 합니다.');
    expect(r.durations).toEqual({ 'intro-01': 2, 'intro-02': 2, 'gam-01': 2 });
    // 다시 돌리면 낭독 비용 0
    deps.synth.mockClear();
    const again = await synthesizeAll(dir, r.script, { deps, reword });
    expect(deps.synth).not.toHaveBeenCalled();
    expect(again.ttsChars).toBe(0);
  });

  it('바꿔 쓴 대본이 검사를 깨면(accept=false) 받지 않는다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-assets-'));
    const r = await synthesizeAll(dir, S(), { deps: fakeDeps(), reword: async () => '9월에 합니다.', accept: () => false });
    expect(r.rewordCount).toBe(0);
    expect(r.script.chapters[0]!.segments[0]!.narration).toBe('전정은 잎이 진 뒤에 합니다.');
  });
});

describe('assembleTimeline', () => {
  it('대본 장 수종으로 배정하고 클립·timeline.json·footage.json 을 쓴다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-asm-'));
    const media = [
      { id: 'g1', file: '/m/g1.mp4', kind: 'video', seconds: 30, species: '감나무' },
      { id: 'p1', file: '/m/p1.mp4', kind: 'video', seconds: 30, species: '사과나무' },
    ];
    const r = await assembleTimeline(dir, S(), { 'intro-01': 2, 'intro-02': 2, 'gam-01': 2 }, media, { deps: fakeDeps() });
    const used = r.shots.filter((s) => 'mediaId' in s).map((s) => (s as { mediaId: string }).mediaId);
    expect(new Set(used)).toEqual(new Set(['g1'])); // 일반 장도 편 수종(감나무)만 — 사과나무는 이 편 수종이 아니다
    expect(fs.existsSync(path.join(dir, 'clips', 'gam-01.mp4'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')).segments).toHaveLength(3);
    expect(r.timeline.chapterStarts.map((c) => c.id)).toEqual(['intro', 'gam']);
  });
});
