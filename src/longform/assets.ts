/**
 * 롱폼 자산 — 세그먼트 낭독(mp3, 발음 확인) → 영상 구간 배정 → 클립 자르기 → timeline.json.
 * 이미 만든 mp3·클립은 다시 만들지 않는다(옆 .key 가 지금 키와 같으면 재사용 — 재실행 비용 0).
 * 시범 CLI(scripts/longform/assets.ts)와 제작 파이프라인이 같은 함수를 쓴다. 돈 드는 호출(TTS·STT·ffmpeg)은 deps 로 바꿔 끼운다.
 *
 * 발음(2026-10-19 시범 R3 → 2026-10-22 자동화): 문장마다 최대 3번 녹음해 음성 인식이 대본과 가장 가까운 것을 쓴다(목표 0.97).
 * 3번 뒤에도 0.9 미만이면 뜻을 지키며 문장을 바꿔 쓰고(reword — 시범에서 손으로 한 전정→가지치기 같은 고침) 다시 녹음한다(최대 2회).
 * 바꾼 문장은 narration 에 남는다(자막도 따라간다). 기록은 pron.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';
import { heardScore } from './pron';
import { planFootage, planMidCuts, type MediaItem, type Shot } from './footage';
import { buildTimeline, GAP_SEC, type Timeline } from './timeline';
import { chapterPools, type LongformScript, type Segment } from './script';
import { saveEpisodeScript } from './episode';

const execFileP = promisify(execFile);

export const PRON_OK = 0.97;
export const PRON_MAX_TAKES = 3;
/** 3번 녹음 뒤에도 이 점수 미만이면 문장을 바꿔 쓴다. */
export const PRON_REWORD_BELOW = 0.9;
export const PRON_REWORD_ROUNDS = 2;
const SEGMENT_MAX = 90;

export interface AssetDeps {
  /** 한 번 합성(mp3). 수종 이름 확인 재합성(synthesizeChecked)은 이 안에서 해도 된다. */
  synth: (text: string, ctx: { previousText?: string; nextText?: string; narration: string; signal?: AbortSignal }) => Promise<Buffer>;
  /** 받아쓰기(실패하면 던져도 된다 — 빈 글자로 친다). */
  stt: (mp3: Buffer, signal?: AbortSignal) => Promise<string>;
  probe: (file: string) => Promise<number>;
  /** 원본 구간 → 1080×1920 무음 클립. */
  cut: (src: string, startSec: number, seconds: number, out: string, signal?: AbortSignal) => Promise<void>;
}

/** 기본 부품 — 실제 ElevenLabs·mlx_whisper·ffmpeg. 테스트·드라이런은 바꿔 끼운다. */
export async function defaultAssetDeps(): Promise<AssetDeps> {
  const [{ synthesize }, { synthesizeChecked, transcribeTake }, { speciesNamesIn }, { probeDuration }] = await Promise.all([
    import('../voice/tts'), import('../voice/ttsCheck'), import('../content/species'), import('../tools/shortsCommon'),
  ]);
  return {
    synth: async (text, ctx) => {
      const synth = () => synthesize(text, { pauseBreaks: CONFIG.shortsTtsBreaks, previousText: ctx.previousText, nextText: ctx.nextText, signal: ctx.signal });
      const names = speciesNamesIn(ctx.narration);
      return names.length ? (await synthesizeChecked(synth, names, { signal: ctx.signal })).mp3 : synth();
    },
    stt: (mp3, signal) => transcribeTake(mp3, signal),
    probe: probeDuration,
    cut: async (src, startSec, seconds, out, signal) => {
      // 회전 메타는 ffmpeg 가 자동 적용한다 — 세로로 세운 뒤 1080×1920 에 채워 자른다(가로 원본도 같은 틀).
      await execFileP('ffmpeg', ['-v', 'error', '-y', '-ss', startSec.toFixed(3), '-t', seconds.toFixed(3), '-i', src, '-an',
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', out],
      { timeout: 300_000, signal });
    },
  };
}

/** 파일이 있고, 옆 .key 가 지금 키와 같으면 재사용. */
export function fresh(file: string, key: string): boolean {
  try { return fs.existsSync(file) && fs.readFileSync(`${file}.key`, 'utf8') === key; } catch { return false; }
}

export interface PronRewrite { from: string; to: string; heard: string; score: number }
export interface PronEntry { score: number; takes: number; heard?: string; rewrites?: PronRewrite[] }

export interface SynthesizeOpts {
  deps: AssetDeps;
  /** 이 장만(시범 CLI --only 실측). */
  only?: string;
  /** 캐시가 있어도 다시 녹음할 세그먼트 id. */
  retake?: Set<string>;
  /** 뜻 보존 바꿔 쓰기(LLM) — 없으면 바꿔 쓰지 않는다(시범 CLI). null 이면 포기. */
  reword?: (seg: { id: string; narration: string }, heard: string, signal?: AbortSignal) => Promise<string | null>;
  /** 바꿔 쓴 대본을 받아들일지(validateScript 문제 수가 늘지 않았는지 등). 없으면 받아들인다. */
  accept?: (next: LongformScript) => boolean;
  signal?: AbortSignal;
  log?: (m: string) => void;
}

export interface SynthesizeResult {
  script: LongformScript;
  durations: Record<string, number>;
  /** 이번 실행 ElevenLabs 글자(재녹음 포함). */
  ttsChars: number;
  pron: Record<string, PronEntry>;
  rewordCount: number;
}

const replaceNarration = (s: LongformScript, id: string, narration: string): LongformScript => ({
  ...s, chapters: s.chapters.map((c) => ({ ...c, segments: c.segments.map((g) => (g.id === id ? { ...g, narration } : g)) })),
});

/** 세그먼트 낭독 전부 — dir/audio/<segId>.mp3(+.key). 바꿔 쓴 문장이 있으면 script.json 을 고쳐 쓴다. */
export async function synthesizeAll(dir: string, input: LongformScript, opts: SynthesizeOpts): Promise<SynthesizeResult> {
  const { deps, signal } = opts;
  const log = opts.log ?? (() => {});
  const audioDir = path.join(dir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  let script = input;
  const durations: Record<string, number> = {};
  const pron: Record<string, PronEntry> = {};
  let ttsChars = 0;
  let rewordCount = 0;
  const flatOf = (s: LongformScript) => s.chapters.flatMap((c) => c.segments.map((g) => ({ ...g, chapter: c.id })));

  const ids = flatOf(script).map((g) => g.id);
  for (let i = 0; i < ids.length; i++) {
    if (signal?.aborted) throw new Error('취소됨');
    const flat = flatOf(script);
    const g = flat[i]!;
    if (opts.only && g.chapter !== opts.only) continue;
    const file = path.join(audioDir, `${g.id}.mp3`);
    const spokenOf = (x: Segment | undefined) => (x ? (x.tts ?? x.narration) : undefined);
    // 캐시 키 = 낭독 문장 — 문장을 고치면 다시 만든다(시범 리뷰 M3: segId 만 보면 옛 음성이 조용히 남는다).
    // 낭독은 발음 교정 표기(tts)가 있으면 그것으로 — 자막은 narration 그대로.
    const spoken = spokenOf(g)!;
    if (!fresh(file, spoken) || opts.retake?.has(g.id)) {
      /** 최대 3번 녹음해 가장 가까운 것. */
      const record = async (text: string, narration: string): Promise<{ mp3: Buffer; score: number; heard: string; takes: number }> => {
        const ctx = { previousText: spokenOf(flat[i - 1]), nextText: spokenOf(flat[i + 1]), narration, signal };
        let best: { mp3: Buffer; score: number; heard: string } | null = null;
        let takes = 0;
        for (let take = 1; take <= PRON_MAX_TAKES && (!best || best.score < PRON_OK); take++) {
          const mp3 = await deps.synth(text, ctx);
          ttsChars += text.length;
          takes++;
          const heard = await deps.stt(mp3, signal).catch(() => '');
          const score = heardScore(narration, heard);
          if (best && take > 1) log(`[발음] ${g.id} 재녹음 ${take}: ${best.score.toFixed(3)} → ${score.toFixed(3)}`);
          if (!best || score > best.score) best = { mp3, score, heard };
        }
        return { ...best!, takes };
      };
      let r = await record(spoken, g.narration);
      const entry: PronEntry = { score: r.score, takes: r.takes, heard: r.heard };
      // 뜻이 뒤집혀 들리는 말 — 문장을 바꿔 쓴다(발음 교정 표기 tts 가 있는 문장은 사람이 손본 것이라 건드리지 않는다).
      for (let round = 1; round <= PRON_REWORD_ROUNDS && r.score < PRON_REWORD_BELOW && opts.reword && !g.tts; round++) {
        const cur = flatOf(script)[i]!;
        const next = (await opts.reword({ id: g.id, narration: cur.narration }, r.heard, signal).catch(() => null))?.trim();
        if (!next || next === cur.narration || next.length > SEGMENT_MAX) break;
        const candidate = replaceNarration(script, g.id, next);
        if (opts.accept && !opts.accept(candidate)) { log(`[발음] ${g.id} 바꿔 쓰기 기각(검사 문제 늘어남): ${next}`); break; }
        const again = await record(next, next);
        entry.takes += again.takes;
        (entry.rewrites ??= []).push({ from: cur.narration, to: next, heard: r.heard, score: again.score });
        log(`[발음] ${g.id} 바꿔 쓰기 ${round}: ${r.score.toFixed(3)} → ${again.score.toFixed(3)} "${cur.narration}" → "${next}"`);
        if (again.score > r.score) {
          script = candidate;
          r = again;
          rewordCount++;
          Object.assign(entry, { score: again.score, heard: again.heard });
        }
      }
      pron[g.id] = entry;
      const finalSpoken = spokenOf(flatOf(script)[i])!;
      fs.writeFileSync(file, r.mp3);
      fs.writeFileSync(`${file}.key`, finalSpoken);
      log(`[낭독] ${g.id} ${r.score.toFixed(3)}`);
    }
    durations[g.id] = await deps.probe(file);
  }
  if (rewordCount) saveEpisodeScript(dir, script);
  if (Object.keys(pron).length) {
    const f = path.join(dir, 'pron.json');
    let prev: Record<string, unknown> = {};
    try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 처음 */ }
    fs.writeFileSync(f, JSON.stringify({ ...prev, ...pron }, null, 2));
  }
  return { script, durations, ttsChars, pron, rewordCount };
}

export interface AssembleResult { timeline: Timeline; shots: Shot[]; mids: Record<string, Shot>; cardOnly: number }

/**
 * 영상 구간 배정 → 클립 자르기 → timeline.json·footage.json. 장 영상 후보는 대본(chapterPools — 수종 장은 자기 수종,
 * 일반 장은 편 수종; 시범은 CHAPTER_SPECIES 폴백).
 */
export async function assembleTimeline(
  dir: string, script: LongformScript, durations: Record<string, number>, media: MediaItem[],
  opts: { deps: Pick<AssetDeps, 'cut'>; signal?: AbortSignal; log?: (m: string) => void },
): Promise<AssembleResult> {
  const log = opts.log ?? (() => {});
  const clipDir = path.join(dir, 'clips');
  fs.mkdirSync(clipDir, { recursive: true });
  const pools = chapterPools(script);
  const flat = script.chapters.flatMap((c) => c.segments.map((g) => ({ ...g, chapter: c.id })));
  const segs = flat.map((g) => ({ id: g.id, chapter: g.chapter, seconds: durations[g.id]! + GAP_SEC, ...(g.footage ? { species: g.footage } : {}) }));
  const shots = planFootage(segs, media, pools);
  // 중간 컷 — 일반 장의 7초 이상 세그먼트에 두 번째 구간(숏폼 cutAtFrame 장치).
  const mids = planMidCuts(segs, shots, media, 7, pools);
  const cuts: Array<{ name: string; shot: Extract<Shot, { mediaId: string }> }> = [
    ...shots.filter((s): s is Extract<Shot, { mediaId: string }> => 'mediaId' in s).map((s) => ({ name: `${s.segId}.mp4`, shot: s })),
    ...Object.values(mids).map((s) => ({ name: `${s.segId}~2.mp4`, shot: s })),
  ];
  for (const { name, shot: s } of cuts) {
    if (opts.signal?.aborted) throw new Error('취소됨');
    const out = path.join(clipDir, name);
    const key = `${s.file}|${s.startSec.toFixed(3)}|${s.seconds.toFixed(3)}`;
    if (fresh(out, key)) continue;
    await opts.deps.cut(s.file, s.startSec, s.seconds, out, opts.signal);
    fs.writeFileSync(`${out}.key`, key);
    log(`[클립] ${name} ← ${s.mediaId} ${s.startSec.toFixed(1)}s +${s.seconds.toFixed(1)}s`);
  }
  const timeline = buildTimeline(script, durations, shots, mids);
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2));
  fs.writeFileSync(path.join(dir, 'footage.json'), JSON.stringify({ shots, mids }, null, 2));
  const cardOnly = shots.filter((s) => 'cardOnly' in s).length;
  log(`[타임라인] ${(timeline.totalFrames / 30).toFixed(1)}초 · 세그먼트 ${timeline.segments.length} · 정지 화면 ${cardOnly} · 중간 컷 ${Object.keys(mids).length}`);
  return { timeline, shots, mids, cardOnly };
}
