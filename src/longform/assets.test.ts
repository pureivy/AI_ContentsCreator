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

// 2026-10-25 — 받아쓰기 실패·숫자/부정 오독·바꿔 쓰기 뜻 바뀜·발음 의심 목록.
describe('synthesizeAll — 받아쓰기 실패와 뜻 대조', () => {
  const one = (narration: string): LongformScript => ({ title: 't', species: [], chapters: [{ id: 'a', title: 'A', species: [], segments: [{ id: 'a-01', narration }, { id: 'a-02', narration: '감나무를 봅니다.' }] }] });
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lf-assets-'));

  it('받아쓰기가 던지거나 비면 STT 실패 — 첫 테이크 그대로, 재녹음·바꿔 쓰기 없음, pron.json·결과에 센다', async () => {
    for (const stt of [async () => { throw new Error('mlx_whisper 없음'); }, async () => '  ']) {
      const dir = tmp();
      const deps = fakeDeps({ stt });
      const reword = vi.fn(async () => '다른 문장입니다.');
      const r = await synthesizeAll(dir, S(), { deps, reword });
      expect(deps.synth).toHaveBeenCalledTimes(3); // 문장마다 한 번(종전: 3번 + 바꿔 쓰기 2회 × 3번)
      expect(reword).not.toHaveBeenCalled();
      expect(r.sttFailed).toEqual(['intro-01', 'intro-02', 'gam-01']);
      expect(r.segmentCount).toBe(3);
      expect(r.suspects).toEqual([]); // 모르는 것이지 의심이 아니다
      const pron = JSON.parse(fs.readFileSync(path.join(dir, 'pron.json'), 'utf8'));
      expect(pron['intro-01']).toMatchObject({ sttError: true, takes: 1 });
      // 다시 돌리면(캐시) 녹음 없이도 경고는 지난 기록에서 그대로
      deps.synth.mockClear();
      const again = await synthesizeAll(dir, r.script, { deps, reword });
      expect(deps.synth).not.toHaveBeenCalled();
      expect(again.sttFailed).toHaveLength(3);
    }
  });

  it('둘째 테이크 받아쓰기가 실패하면 더 녹음하지 않고 판정한 첫 테이크를 쓴다(sttError 아님)', async () => {
    let n = 0;
    const deps = fakeDeps({ stt: async (mp3) => { if (n++ === 1) throw new Error('시간 초과'); return mp3.toString().replace('전정은', '전쟁은 전쟁'); } });
    const r = await synthesizeAll(tmp(), S(), { deps, only: 'intro' });
    expect(r.pron['intro-01']).toMatchObject({ takes: 2 });
    expect(r.pron['intro-01']!.sttError).toBeUndefined();
    expect(r.sttFailed).toEqual([]);
  });

  it('점수는 높아도 부정이 빠져 들리면 재녹음·바꿔 쓰기 길로, 끝까지 그러면 발음 의심', async () => {
    const said = '이 시기에는 절대 가지를 자르면 안 됩니다.';
    const deps = fakeDeps({ stt: async (mp3) => mp3.toString().replace('안 됩니다', '됩니다') });
    const reword = vi.fn(async () => '이 시기에는 절대 가지를 자르지 마세요.');
    const r = await synthesizeAll(tmp(), one(said), { deps, reword });
    // 원문 3번(점수 0.94 지만 부정 불일치라 계속) + 바꾼 문장(부정 '안'→'말' 로 바뀜 → 녹음 전 기각, 2회)
    expect(deps.synth.mock.calls.filter((c) => c[0] === said)).toHaveLength(3);
    expect(reword).toHaveBeenCalledTimes(2);
    expect(r.rewordCount).toBe(0);
    expect(r.pron['a-01']!.mismatch).toContain('부정');
    expect(r.suspects).toEqual([expect.objectContaining({ id: 'a-01', text: said, mismatch: expect.stringContaining('부정') })]);
  });

  it('숫자가 다르게 들리면 바꿔 쓰고, 바꾼 문장이 맞게 들리면 받는다(점수가 낮아도 뜻 일치가 먼저)', async () => {
    // 원문만 '5월'로 들리고 바꾼 문장은 그대로 들린다.
    const deps = fakeDeps({ stt: async (mp3) => (mp3.toString() === '꽃눈은 3월에 부풉니다.' ? '꽃눈은 5월에 부풉니다' : mp3.toString()) });
    const reword = vi.fn(async () => '꽃눈은 3월이 되면 부풉니다.');
    const r = await synthesizeAll(tmp(), one('꽃눈은 3월에 부풉니다.'), { deps, reword });
    expect(reword).toHaveBeenCalledTimes(1);
    expect(r.rewordCount).toBe(1);
    expect(r.script.chapters[0]!.segments[0]!.narration).toBe('꽃눈은 3월이 되면 부풉니다.');
    expect(r.pron['a-01']!.mismatch).toBeUndefined();
    expect(r.suspects).toEqual([]);
  });

  it('바꿔 쓰기가 숫자를 바꾸면(4미터 → 40미터) 녹음 전에 기각', async () => {
    const deps = fakeDeps({ stt: async (mp3) => mp3.toString().replace('4미터', '40미터') });
    const reword = vi.fn(async () => '간격은 40미터가 좋습니다.');
    const r = await synthesizeAll(tmp(), one('간격은 4미터가 좋습니다.'), { deps, reword });
    expect(deps.synth.mock.calls.some((c) => c[0] === '간격은 40미터가 좋습니다.')).toBe(false);
    expect(r.rewordCount).toBe(0);
    expect(r.suspects.map((x) => x.id)).toEqual(['a-01']);
  });
});

// 10-25 리뷰 — 테이크 고르기(뜻 불일치 없는 쪽 우선은 0.9 이상·0.05 안일 때만)·발음 의심 문턱 0.9·문장마다 저장.
describe('synthesizeAll — 테이크 고르기·발음 의심 문턱·중간 저장', () => {
  const said = '이 시기에는 절대로 굵은 가지를 함부로 자르면 안 됩니다.';
  const DIRTY = '이 시기에는 절대로 굵은 가지를 함부로 자르면 됩니다'; // 0.957 · 부정 불일치
  const DIRTY2 = '이 시기에는 절대로 굵은 거지를 함부로 자르면 됩니다'; // 0.913 · 부정 불일치
  const CLEAN91 = '이 시게에는 전대로 굵은 가지를 함부로 자르면 안 됩니다'; // 0.913
  const CLEAN87 = '이 시게에는 전대로 굴은 가지를 함부로 자르면 안 됩니다'; // 0.870
  const CLEAN74 = '이 시게에는 전대로 굴은 거지를 함브로 자르먼 안 됩니다'; // 0.739
  const one = (): LongformScript => ({ title: 't', species: [], chapters: [{ id: 'a', title: 'A', species: [], segments: [{ id: 'a-01', narration: said }, { id: 'a-02', narration: '감나무를 봅니다.' }] }] });
  const run = async (takes: string[]) => {
    let n = 0;
    const deps = fakeDeps({ stt: async (mp3) => (mp3.toString() === said ? takes[Math.min(n++, takes.length - 1)]! : mp3.toString()) });
    return synthesizeAll(fs.mkdtempSync(path.join(os.tmpdir(), 'lf-take-')), one(), { deps });
  };
  it('뜻 불일치 없는 테이크라도 0.9 미만이고 0.05 밖이면 점수로 고른다(0.74 ↔ 0.957 → 0.957)', async () => {
    const r = await run([DIRTY, CLEAN74, CLEAN74]);
    expect(r.pron['a-01']!.score).toBeCloseTo(0.957, 2);
    expect(r.pron['a-01']!.mismatch).toContain('부정');
    expect((await run([DIRTY, CLEAN87, CLEAN87])).pron['a-01']!.score).toBeCloseTo(0.957, 2); // 0.87 < 0.9 · 0.087 차이
  });
  it('0.9 이상이거나 0.05 안이면 뜻 불일치 없는 쪽(0.913 ↔ 0.957, 0.870 ↔ 0.913)', async () => {
    const a = await run([DIRTY, CLEAN91, CLEAN91]);
    expect(a.pron['a-01']!.score).toBeCloseTo(0.913, 2);
    expect(a.pron['a-01']!.mismatch).toBeUndefined();
    expect(a.suspects).toEqual([]); // 0.913 — 종전 문턱 0.93 이면 발음 의심이었다
    const b = await run([DIRTY2, CLEAN87, CLEAN87]);
    expect(b.pron['a-01']!.score).toBeCloseTo(0.87, 2);
    expect(b.pron['a-01']!.mismatch).toBeUndefined();
    expect(b.suspects.map((x) => x.id)).toEqual(['a-01']); // 0.9 미만은 의심
  });
  it('중간에 끊겨도(둘째 문장 합성이 던짐) 첫 문장의 바꿔 쓴 대본·pron.json 이 남는다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-persist-'));
    const s: LongformScript = { title: 't', species: [], chapters: [{ id: 'a', title: 'A', species: [], segments: [{ id: 'a-01', narration: '꽃눈은 3월에 부풉니다.' }, { id: 'a-02', narration: '감나무를 봅니다.' }] }] };
    saveEpisodeScript(dir, s);
    const deps = fakeDeps({
      synth: vi.fn(async (text: string) => { if (text === '감나무를 봅니다.') throw new Error('끊김'); return Buffer.from(text); }),
      stt: async (mp3) => (mp3.toString() === '꽃눈은 3월에 부풉니다.' ? '꽃눈은 5월에 부풉니다' : mp3.toString()),
    });
    await expect(synthesizeAll(dir, s, { deps, reword: async () => '꽃눈은 3월이 되면 부풉니다.' })).rejects.toThrow('끊김');
    expect(loadEpisodeScript(dir).chapters[0]!.segments[0]!.narration).toBe('꽃눈은 3월이 되면 부풉니다.');
    const pron = JSON.parse(fs.readFileSync(path.join(dir, 'pron.json'), 'utf8'));
    expect(Object.keys(pron)).toEqual(['a-01']);
    expect(pron['a-01'].rewrites).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'pron.json.tmp'))).toBe(false);
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
