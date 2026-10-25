/**
 * 롱폼 자산 — 세그먼트 낭독(mp3, 발음 확인) → 영상 구간 배정 → 클립 자르기 → timeline.json.
 * 이미 만든 mp3·클립은 다시 만들지 않는다(옆 .key 가 지금 키와 같으면 재사용 — 재실행 비용 0).
 * 시범 CLI(scripts/longform/assets.ts)와 제작 파이프라인이 같은 함수를 쓴다. 돈 드는 호출(TTS·STT·ffmpeg)은 deps 로 바꿔 끼운다.
 *
 * 발음(2026-10-19 시범 R3 → 2026-10-22 자동화): 문장마다 최대 3번 녹음해 음성 인식이 대본과 가장 가까운 것을 쓴다(목표 0.97).
 * 3번 뒤에도 0.9 미만이면 뜻을 지키며 문장을 바꿔 쓰고(reword — 시범에서 손으로 한 전정→가지치기 같은 고침) 다시 녹음한다(최대 2회).
 * 바꾼 문장은 narration 에 남는다(자막도 따라간다). 기록은 pron.json.
 *
 * 2026-10-25 보강: ① 받아쓰기 실패(던짐·빈 글자)는 'STT 실패'(sttError) — 점수 0 으로 읽혀 3번 녹음 + 바꿔 쓰기 2회(×3)를 태우던 것을
 * 숏폼(ttsCheck stt-error)처럼 첫 테이크를 지키고 끝낸다. ② 숫자·부정이 다르게 들리면(meaningMismatch) 점수와 무관하게 재녹음·바꿔 쓰기 길로,
 * 바꿔 쓴 문장이 원문과 숫자·부정이 다르면 녹음 전에 기각. ③ 끝까지 뜻 불일치이거나 0.9(PRON_REWORD_BELOW) 미만인 문장은 suspects 로 돌려 검토 알림에 싣는다.
 * 리뷰 보강(같은 날): 뜻 불일치 없는 테이크가 이기는 것은 점수가 0.9 이상이거나 상대와 0.05 안일 때만(0.6 ↔ 받아쓰기 헛경보 0.99 는 점수로).
 *   pron.json·script.json 은 문장마다 바로 쓴다(tmp → rename — 중간에 끊겨도 바꿔 쓴 문장·기록이 남는다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';
import { heardScore, meaningMismatch } from './pron';
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
/** 끝난 뒤에도 이 점수 미만(또는 뜻 불일치)이면 '발음 의심'으로 검토 알림에 싣는다 — 바꿔 쓰기 문턱과 같게(10-25 리뷰: 0.93 은 경고가 너무 잦았다). */
export const PRON_SUSPECT_BELOW = PRON_REWORD_BELOW;
/** 뜻 불일치 없는 테이크가 점수 낮아도 이기는 폭. */
export const PRON_CLEAN_MARGIN = 0.05;
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

export interface PronRewrite { from: string; to: string; heard: string; score: number; mismatch?: string }
/** sttError = 받아쓰기 실패(점수 모름 — 첫 테이크 그대로). mismatch = 숫자·부정이 다르게 들림(meaningMismatch 이유). text = 쓴 문장(알림용). */
export interface PronEntry { score: number; takes: number; heard?: string; rewrites?: PronRewrite[]; sttError?: true; mismatch?: string; text?: string }
/** 발음 의심 문장 — 검토 알림·레코드용. */
export interface PronSuspect { id: string; text: string; score: number; mismatch?: string }

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
  /** 받아쓰기 실패 문장 id — pron.json(지난 실행 포함) 기준, 지금 대본 문장만. */
  sttFailed: string[];
  /** 대본 문장 수(only 면 그 장만). */
  segmentCount: number;
  /** 끝까지 뜻 불일치이거나 PRON_SUSPECT_BELOW 미만(받아쓰기 실패 제외 — 모르는 것이지 의심이 아니다). */
  suspects: PronSuspect[];
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
  const pronFile = path.join(dir, 'pron.json');
  let prev: Record<string, PronEntry> = {};
  try { prev = JSON.parse(fs.readFileSync(pronFile, 'utf8')); } catch { /* 처음 */ }
  /** 문장마다 바로 — 끊겨도 바꿔 쓴 문장(script.json)·발음 기록(pron.json)이 남는다(tmp → rename). */
  let savedRewords = 0;
  const persist = (): void => {
    if (rewordCount > savedRewords) { saveEpisodeScript(dir, script); savedRewords = rewordCount; }
    if (!Object.keys(pron).length) return;
    fs.writeFileSync(`${pronFile}.tmp`, JSON.stringify({ ...prev, ...pron }, null, 2));
    fs.renameSync(`${pronFile}.tmp`, pronFile);
  };

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
      /**
       * 최대 3번 녹음해 가장 가까운 것(뜻 불일치 없는 테이크가 먼저, 그다음 점수). 받아쓰기가 실패하면 더 녹음하지 않는다 —
       * 첫 테이크면 그것을 sttError 로(점수 모름), 뒤 테이크면 앞서 판정한 가장 나은 테이크를.
       */
      type Take = { mp3: Buffer; score: number; heard: string; mismatch: string | null; sttError?: true };
      // 뜻 불일치 없는 쪽이 이기는 것은 점수가 바꿔 쓰기 문턱 이상이거나 상대와 PRON_CLEAN_MARGIN 안일 때만 — 아니면 점수로(받아쓰기 헛경보가 좋은 테이크를 버리지 않게).
      const better = (a: Take, b: Take) => {
        if (!a.mismatch === !b.mismatch) return a.score > b.score;
        const [clean, dirty] = a.mismatch ? [b, a] : [a, b];
        const cleanWins = clean.score >= PRON_REWORD_BELOW || clean.score >= dirty.score - PRON_CLEAN_MARGIN;
        return cleanWins ? clean === a : a.score > b.score;
      };
      const record = async (text: string, narration: string): Promise<Take & { takes: number }> => {
        const ctx = { previousText: spokenOf(flat[i - 1]), nextText: spokenOf(flat[i + 1]), narration, signal };
        let best: Take | null = null;
        let takes = 0;
        for (let take = 1; take <= PRON_MAX_TAKES && (!best || best.score < PRON_OK || best.mismatch); take++) {
          const mp3 = await deps.synth(text, ctx);
          ttsChars += text.length;
          takes++;
          const heard = await deps.stt(mp3, signal).then((t) => (String(t ?? '').trim() ? t : null), () => null);
          if (heard === null) {
            log(`[발음] ${g.id} 받아쓰기 실패 — ${best ? `앞 테이크(${best.score.toFixed(3)}) 유지` : '첫 테이크 그대로'}`);
            best ??= { mp3, score: 0, heard: '', mismatch: null, sttError: true };
            break;
          }
          const cand: Take = { mp3, score: heardScore(narration, heard), heard, mismatch: meaningMismatch(narration, heard) };
          if (best && take > 1) log(`[발음] ${g.id} 재녹음 ${take}: ${best.score.toFixed(3)} → ${cand.score.toFixed(3)}${cand.mismatch ? ` (${cand.mismatch})` : ''}`);
          if (!best || better(cand, best)) best = cand;
        }
        return { ...best!, takes };
      };
      let r = await record(spoken, g.narration);
      const entry: PronEntry = { score: r.score, takes: r.takes, heard: r.heard, ...(r.sttError ? { sttError: true as const } : {}), ...(r.mismatch ? { mismatch: r.mismatch } : {}) };
      // 뜻이 뒤집혀 들리는 말 — 문장을 바꿔 쓴다(발음 교정 표기 tts 가 있는 문장은 사람이 손본 것이라 건드리지 않는다). 받아쓰기 실패면 판정할 수 없어 안 바꾼다.
      for (let round = 1; round <= PRON_REWORD_ROUNDS && !r.sttError && (r.score < PRON_REWORD_BELOW || r.mismatch) && opts.reword && !g.tts; round++) {
        const cur = flatOf(script)[i]!;
        const next = (await opts.reword({ id: g.id, narration: cur.narration }, r.heard, signal).catch(() => null))?.trim();
        if (!next || next === cur.narration || next.length > SEGMENT_MAX) break;
        // 바꿔 쓰기가 숫자·부정을 바꾸면 뜻이 바뀐 것 — 녹음 전에 기각(다음 회차에 다시 묻는다).
        const shift = meaningMismatch(cur.narration, next);
        if (shift) { log(`[발음] ${g.id} 바꿔 쓰기 기각(${shift}): ${next}`); continue; }
        const candidate = replaceNarration(script, g.id, next);
        if (opts.accept && !opts.accept(candidate)) { log(`[발음] ${g.id} 바꿔 쓰기 기각(검사 문제 늘어남): ${next}`); break; }
        const again = await record(next, next);
        entry.takes += again.takes;
        (entry.rewrites ??= []).push({ from: cur.narration, to: next, heard: r.heard, score: again.score, ...(again.mismatch ? { mismatch: again.mismatch } : {}) });
        log(`[발음] ${g.id} 바꿔 쓰기 ${round}: ${r.score.toFixed(3)} → ${again.score.toFixed(3)} "${cur.narration}" → "${next}"`);
        if (again.sttError) break; // 받아쓰기가 죽었다 — 더 바꿔 써도 판정 못 한다(원문 유지)
        if (better(again, r)) {
          script = candidate;
          r = again;
          rewordCount++;
          Object.assign(entry, { score: again.score, heard: again.heard });
          if (again.mismatch) entry.mismatch = again.mismatch; else delete entry.mismatch;
        }
      }
      entry.text = flatOf(script)[i]!.narration;
      pron[g.id] = entry;
      const finalSpoken = spokenOf(flatOf(script)[i])!;
      fs.writeFileSync(file, r.mp3);
      fs.writeFileSync(`${file}.key`, finalSpoken);
      persist();
      log(`[낭독] ${g.id} ${r.score.toFixed(3)}`);
    }
    durations[g.id] = await deps.probe(file);
  }
  persist();
  const merged = { ...prev, ...pron };
  // 경고는 지난 실행 기록까지(캐시로 건너뛴 문장도 그 녹음 그대로 쓰인다 — 재시도한 편이 경고를 잃지 않게). 지금 대본 문장만.
  const segs = flatOf(script).filter((g) => !opts.only || g.chapter === opts.only);
  const sttFailed = segs.filter((g) => merged[g.id]?.sttError).map((g) => g.id);
  const suspects: PronSuspect[] = segs.flatMap((g) => {
    const e = merged[g.id];
    return e && !e.sttError && (e.mismatch || e.score < PRON_SUSPECT_BELOW) ? [{ id: g.id, text: g.narration, score: e.score, ...(e.mismatch ? { mismatch: e.mismatch } : {}) }] : [];
  });
  if (sttFailed.length) log(`[발음] 받아쓰기 실패 ${sttFailed.length}/${segs.length}문장 — 첫 테이크 그대로`);
  if (suspects.length) log(`[발음] 발음 의심 ${suspects.length}문장 — ${suspects.slice(0, 5).map((x) => x.id).join(', ')}`);
  return { script, durations, ttsChars, pron, rewordCount, sttFailed, segmentCount: segs.length, suspects };
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
