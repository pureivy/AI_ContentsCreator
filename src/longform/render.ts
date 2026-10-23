/**
 * 롱폼 렌더 — timeline.json → 포스터·정지 화면·스테이징 → LongForm(별도 진입점 remotion/longform/index.ts) → final.mp4
 * + subtitles.srt·report.md·youtube.txt. 시범 CLI(scripts/longform/render.ts)와 제작 파이프라인이 같은 함수를 쓴다.
 *
 * 문장 그림 장면(2026-10-22 확장점): 세그먼트의 scene 키는 props 로 그대로 넘어간다(toLongFormProps). 장면 컴포넌트는
 * remotion/longform 진입점이 정적으로 import 한 등록표에 있어야 번들에 들어간다(웹팩은 동적 경로를 못 따라간다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RENDER_OPTS } from '../tools/shortsRenderRemotion';
import { CONFIG } from '../config';
import { posterOf, toLongFormProps } from './props';
import { FPS, GAP_SEC, type Timeline } from './timeline';
import { loadEpisodeScript } from './episode';
import { buildYoutubeMeta } from './youtubeMeta';
import { toFullProps, type FullFootage, type FullStyle, type LongFormFullProps } from './fullProps';
import { insetSpecies, planInsets } from './sceneFull';
import { ENTRY_DIR_FULL, SCENE_DIR, writeEpisodeEntryFull } from './sceneFiles';
import { tileStills } from './scenePreview';
import type { LongFormProps } from './types';
import { isInternalRef } from './speciesCommons';
import { approxWords } from './sceneRules';
import { mouthLevels, presenterSeason, sceneAccent, type PresenterSeason } from './presenter';
import { autoBioneeCues, sceneBioneeCues, type BioneeCue } from './bioneeCues';

const execFileP = promisify(execFile);

export const LONGFORM_ENTRY = (): string => path.resolve('remotion', 'longform', 'index.ts');

export interface RenderDeps {
  /** 번들 → serveUrl. */
  bundle: (o: { entryPoint: string; publicDir: string; outDir: string }) => Promise<string>;
  /** 렌더(진행률 0~1 콜백). composition 기본 'LongForm'(종전), 전체 화면은 'LongFormFull'. */
  renderMedia: (o: { serveUrl: string; inputProps: LongFormProps | LongFormFullProps; output: string; signal?: AbortSignal; onProgress: (p: number) => void; composition?: string }) => Promise<void>;
  renderStill: (o: { serveUrl: string; inputProps: LongFormProps | LongFormFullProps; frame: number; output: string; composition?: string }) => Promise<void>;
  ffmpeg: (args: string[]) => Promise<void>;
  probe: (file: string) => Promise<number>;
}

/** 기본 부품 — 실제 Remotion·ffmpeg(RENDER_OPTS 그대로). 무거운 모듈은 쓸 때만 불러온다. */
export async function defaultRenderDeps(): Promise<RenderDeps> {
  const [{ bundle }, { renderMedia, renderStill, selectComposition, makeCancelSignal }, { probeDuration }] = await Promise.all([
    import('@remotion/bundler'), import('@remotion/renderer'), import('../tools/shortsCommon'),
  ]);
  return {
    // 웹팩 캐시는 고정 진입점(시범)만 — 편마다 만든 진입점은 설정 해시가 달라 캐시가 편마다 ~200MB 씩 쌓인다(한 번 쓰고 끝).
    // 웹팩 캐시는 끈다 — 진입점·설정 해시마다 수백 MB 씩 node_modules/.cache 에 쌓였다(10-23 1.9GB). 번들은 수 초라 손해가 작다.
    bundle: (o) => bundle({ ...o, enableCaching: false }),
    renderMedia: async (o) => {
      const composition = await selectComposition({ serveUrl: o.serveUrl, id: o.composition ?? 'LongForm', inputProps: o.inputProps });
      const { cancelSignal, cancel } = makeCancelSignal();
      if (o.signal?.aborted) cancel();
      o.signal?.addEventListener('abort', () => cancel());
      await renderMedia({
        serveUrl: o.serveUrl, composition, inputProps: o.inputProps, codec: 'h264', outputLocation: o.output, cancelSignal, ...RENDER_OPTS, crf: CONFIG.longformCrf,
        onProgress: ({ progress }) => o.onProgress(progress),
      });
    },
    renderStill: async (o) => {
      const composition = await selectComposition({ serveUrl: o.serveUrl, id: o.composition ?? 'LongForm', inputProps: o.inputProps });
      await renderStill({ serveUrl: o.serveUrl, composition, inputProps: o.inputProps, frame: o.frame, output: o.output, chromiumOptions: RENDER_OPTS.chromiumOptions, timeoutInMilliseconds: RENDER_OPTS.timeoutInMilliseconds });
    },
    ffmpeg: async (args) => { await execFileP('ffmpeg', args, { timeout: 120_000 }); },
    probe: probeDuration,
  };
}

const srtTime = (frame: number): string => {
  const ms = Math.round((frame / FPS) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** 자막 파일(순수). */
export function timelineSrt(tl: Timeline): string {
  const cues = tl.segments.flatMap((s) => s.captions.map((c) => ({ a: s.startFrame + c.startFrame, b: s.startFrame + c.endFrame, text: c.text })));
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.a)} --> ${srtTime(c.b)}\n${c.text}\n`).join('\n');
}

export interface RenderResult {
  totalFrames: number;
  durationSec: number;
  renderSec: number;
  yt: { title: string; description: string; tags: string[]; problems: string[] };
  /** stills 모드면 뽑은 파일들(렌더 안 함). */
  stills?: string[];
}

/**
 * 렌더 한 편. stills 를 주면 그 프레임만 뽑고(dir/stills/f<N>.png) 영상은 만들지 않는다.
 * 스테이징 사본(remotion/public)·번들(remotion/bundle)은 렌더 뒤에도 남긴다 — 정리는 janitor 몫(항상 치우는 대상).
 */
export async function renderEpisode(dir: string, opts: {
  deps: RenderDeps; stills?: number[]; signal?: AbortSignal; log?: (m: string) => void; onProgress?: (pct: number) => void;
  /** Remotion 진입점 — 기본 remotion/longform/index.ts. 장면 단계가 편마다 만든 진입점(장면 등록표 포함)을 쓸 때만 바꾼다. */
  entryPoint?: string;
}): Promise<RenderResult> {
  const { deps } = opts;
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const publicDir = path.join(dir, 'remotion', 'public');
  const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Timeline;
  const script = loadEpisodeScript(dir);
  fs.mkdirSync(publicDir, { recursive: true });

  for (const s of tl.segments) {
    // 복사 대신 하드 링크(stage) — 10-23 시범 편 remotion/public 이 클립·낭독 사본으로 3.0GB 를 차지했다.
    stage(path.join(dir, 'audio', s.audio), path.join(publicDir, s.audio));
    if (s.clip2) stage(path.join(dir, 'clips', s.clip2), path.join(publicDir, s.clip2));
    if (!s.clip) continue;
    const clip = path.join(dir, 'clips', s.clip);
    stage(clip, path.join(publicDir, s.clip));
    const poster = path.join(publicDir, posterOf(s.id));
    // 클립이 다시 잘렸으면 포스터도 다시(시범 리뷰 M3).
    if (!fs.existsSync(poster) || fs.statSync(poster).mtimeMs < fs.statSync(clip).mtimeMs) await deps.ffmpeg(['-v', 'error', '-y', '-ss', '1', '-i', clip, '-frames:v', '1', '-q:v', '3', poster]);
  }
  // 정지 화면 — 영상이 없는 세그먼트는 같은 장 클립의 한 장면(stillAt 지점)을 띄운다.
  const focusFile = path.join(dir, 'focus.json');
  const focus = fs.existsSync(focusFile) ? JSON.parse(fs.readFileSync(focusFile, 'utf8')) as Record<string, { x: number; y: number }> : {};
  const props = toLongFormProps(script.title, tl, { focus, ...(script.keywords?.length ? { keywords: script.keywords } : {}) });
  for (const s of props.segments) {
    if (!s.still || !s.stillFrom) continue;
    const clip = path.join(dir, 'clips', `${s.stillFrom}.mp4`);
    const still = path.join(publicDir, s.still);
    const key = `${s.stillFrom}@${s.stillAt}`;
    if (!fs.existsSync(still) || fs.statSync(still).mtimeMs < fs.statSync(clip).mtimeMs || !fs.existsSync(`${still}.key`) || fs.readFileSync(`${still}.key`, 'utf8') !== key) {
      const dur = await deps.probe(clip);
      const at = Math.min(dur - 0.2, Math.max(0.1, dur * (s.stillAt ?? 0.85)));
      await deps.ffmpeg(['-v', 'error', '-y', '-ss', at.toFixed(2), '-i', clip, '-frames:v', '1', '-q:v', '2', still]);
      fs.writeFileSync(`${still}.key`, key);
    }
  }
  fs.writeFileSync(path.join(dir, 'props.json'), JSON.stringify(props, null, 2));
  if (opts.signal?.aborted) throw new Error('취소됨');

  const serveUrl = await deps.bundle({ entryPoint: opts.entryPoint ?? LONGFORM_ENTRY(), publicDir, outDir: path.join(dir, 'remotion', 'bundle') });
  const tBundle = Date.now();
  const yt = buildYoutubeMeta(script, tl, FPS);

  if (opts.stills?.length) {
    const sd = path.join(dir, 'stills');
    fs.mkdirSync(sd, { recursive: true });
    const out: string[] = [];
    for (const f of opts.stills) {
      const file = path.join(sd, `f${f}.png`);
      await deps.renderStill({ serveUrl, inputProps: props, frame: f, output: file });
      out.push(file);
      log(`[스틸] f${f}.png`);
    }
    return { totalFrames: tl.totalFrames, durationSec: tl.totalFrames / FPS, renderSec: 0, yt, stills: out };
  }

  let last = -1;
  await deps.renderMedia({
    serveUrl, inputProps: props, output: path.join(dir, 'final.mp4'), signal: opts.signal,
    onProgress: (progress) => {
      const p = Math.floor(progress * 20);
      if (p !== last) { last = p; log(`[렌더] ${p * 5}%`); opts.onProgress?.(p * 5); }
    },
  });
  // 취소 레이스 가드 — 렌더가 취소 직전 프레임까지 쓰고 완주해 버린 경우.
  if (opts.signal?.aborted) throw new Error('취소됨');
  const tRender = Date.now();

  const cardOnly = tl.segments.filter((s) => !s.clip).length;
  writeTextOutputs(dir, tl, yt, [`장 ${tl.chapterStarts.length}, 세그먼트 ${tl.segments.length} (실촬영 ${tl.segments.length - cardOnly} · 카드 화면 ${cardOnly})`], { t0, tBundle, tRender }, log);
  log(`[완료] final.mp4 · 렌더 ${((tRender - tBundle) / 60000).toFixed(1)}분`);
  return { totalFrames: tl.totalFrames, durationSec: Math.round(tl.totalFrames / FPS), renderSec: Math.round((tRender - tBundle) / 1000), yt };
}

/** 렌더 뒤 글 파일 — subtitles.srt·report.md·youtube.txt(두 화면 꼴 공용). layoutLine = 보고 둘째 줄 '길이' 뒤 내용. */
function writeTextOutputs(dir: string, tl: Timeline, yt: RenderResult['yt'], layoutLines: string[], t: { t0: number; tBundle: number; tRender: number }, log: (m: string) => void): void {
  fs.writeFileSync(path.join(dir, 'subtitles.srt'), timelineSrt(tl));
  const chars = tl.segments.reduce((n, s) => n + s.narration.length, 0);
  const [first, ...rest] = layoutLines;
  fs.writeFileSync(path.join(dir, 'report.md'), [
    `# 롱폼 렌더 보고 (${new Date().toISOString()})`,
    `- 길이: ${(tl.totalFrames / FPS).toFixed(1)}초 (${tl.totalFrames}프레임), ${first}`,
    ...rest.map((l) => `- ${l}`),
    `- 낭독 글자(공백 포함, ElevenLabs 과금 기준): ${chars}`,
    `- 스테이징+번들: ${((t.tBundle - t.t0) / 1000).toFixed(0)}초, 렌더: ${((t.tRender - t.tBundle) / 1000).toFixed(0)}초, 전체: ${((Date.now() - t.t0) / 60000).toFixed(1)}분`,
  ].join('\n') + '\n');
  // 유튜브 올릴 글 — 제목·설명(챕터 포함)·점검 사항. 설명 첫 줄이 검색에 쓰이는 핵심 줄.
  fs.writeFileSync(path.join(dir, 'youtube.txt'), [`제목:\n${yt.title}`, `설명:\n${yt.description}`, `태그:\n${yt.tags.join(', ')}`,
    ...(yt.problems.length ? [`점검:\n${yt.problems.map((p) => `- ${p}`).join('\n')}`] : [])].join('\n\n') + '\n');
  log(`[유튜브] youtube.txt · 챕터 ${tl.chapterStarts.length}${yt.problems.length ? ` · 점검 ${yt.problems.length}건` : ''}`);
}

export const FULL_WORK_DIR = 'remotion-full';

/** 끼움 카드 배정 — 장면 단계가 남긴 scenes/insets.json(빌려 온 클립까지) 우선, 없으면 같은 규칙으로 다시 계산(주인공 수종 규칙). */
export function fullFootageOf(dir: string, tl: Timeline, mediaSpecies: (id: string) => string | undefined): Map<string, FullFootage> {
  const file = path.join(dir, SCENE_DIR, 'insets.json');
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, FullFootage>;
      return new Map(Object.entries(raw).map(([k, f]) => [k, { src: f.src, startFrom: f.startFrom, durationInFrames: f.durationInFrames }]));
    } catch { /* 깨짐 — 다시 계산 */ }
  }
  const plan = planInsets(tl.segments, insetSpecies(loadEpisodeScript(dir)), mediaSpecies);
  return new Map([...plan.footage].map(([k, f]) => [k, { src: f.src, startFrom: f.startFrom, durationInFrames: f.durationInFrames }]));
}

/**
 * 하드 링크(안 되면 복사) — 원본이 더 새로우면 다시. 돌려주는 값 = 스테이징했나.
 * 가드: 내부 대조용 사진(refs/** · commons-*, 공개 도감 사진 포함)은 렌더 public 에 절대 놓지 않는다 — 영상·썸네일에 들어가면 안 된다.
 */
export function stagePublic(from: string, to: string): boolean {
  if (isInternalRef(from) || isInternalRef(to)) return false;
  stage(from, to);
  return true;
}
function stage(from: string, to: string): void {
  if (isInternalRef(from) || isInternalRef(to)) return; // 가드(stagePublic 참고)
  try {
    const a = fs.statSync(from);
    const b = fs.statSync(to);
    if (b.size === a.size && b.mtimeMs >= a.mtimeMs) return;
    fs.unlinkSync(to);
  } catch { /* 없음 */ }
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
}

/**
 * 진행자 비온이가 켜졌을 때 장면 그림 층 축소 비율((W, CAPTION_TOP) 기준). 2026-10-23 사장님: "비온이는 화면 위에 있어야 해" —
 * 줄이면 왼쪽에 빈 띠가 생겨 배경이 끊겨 보인다. 1 = 장면은 화면 전체(종이·땅·풀이 끝까지), 비온이는 그 위 덮개 층.
 * 장면은 왼쪽 아래(x<420·y>560)에 주인공·라벨·끼움 카드만 두지 않는다(KIT_API_BIONEE.md). 1 이 아니면 좌표 변환·자리 계산이 그 비율을 따른다.
 */
export const PRESENTER_SCENE_SCALE = 1;

/**
 * 진행자 준비(LONGFORM_PRESENTER, 2026-10-23 코드 리그) — 세그먼트마다 비온이 신호와 입 열림(낭독 mp3 → ffmpeg 모노 PCM → 프레임당 0~9).
 * 신호 = 장면 파일의 `export const bioneeCues = [...]`(장면 담당이 문장마다 고름 — 빈 배열이면 그 문장은 가만히), 없거나 못 읽으면 자동(autoBioneeCues).
 * 계절 = 대본 제목·요약의 계절 낱말, 없으면 지금 달. 입 PCM 은 work/presenter 에 남긴다(janitor 가 remotion-full 째 치운다).
 */
export async function buildPresenter(dir: string, tl: Timeline, keys: readonly string[], o: {
  ffmpeg: RenderDeps['ffmpeg']; text: string; month?: number; sceneScale?: number; log?: (m: string) => void;
}): Promise<{ season: PresenterSeason; sceneScale: number; cues: Map<string, BioneeCue[]>; mouth: Map<string, number[]>; authored: number }> {
  const work = path.join(dir, FULL_WORK_DIR, 'presenter');
  fs.mkdirSync(work, { recursive: true });
  const RATE = 6000;
  const mouth = new Map<string, number[]>();
  for (const s of tl.segments) {
    const raw = path.join(work, `${s.id}.f32`);
    await o.ffmpeg(['-v', 'error', '-y', '-i', path.join(dir, 'audio', s.audio), '-ac', '1', '-ar', String(RATE), '-f', 'f32le', raw]);
    const buf = fs.readFileSync(raw);
    const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength - (buf.byteLength % 4)));
    mouth.set(s.id, mouthLevels(pcm, RATE, FPS, s.frames));
  }
  const src = (k?: string): string => (k && keys.includes(k) ? fs.readFileSync(path.join(dir, SCENE_DIR, `${k}.tsx`), 'utf8') : '');
  const info = tl.segments.map((s) => {
    const code = src(s.scene);
    const speechSec = Math.max(0.5, s.frames / FPS - GAP_SEC);
    const accent = code ? sceneAccent(code) : undefined;
    const own = code ? sceneBioneeCues(code, { segSec: s.frames / FPS, narration: s.narration }) : { found: false, problems: [] as string[] };
    if (own.problems.length) o.log?.(`[비온이] ${s.id}: ${own.problems.join(' / ')}`);
    return { narration: s.narration, words: approxWords(s.narration, speechSec), speechSec, segSec: s.frames / FPS, ...(accent ? { accent } : {}), own };
  });
  const auto = autoBioneeCues(info);
  let authored = 0;
  const cues = new Map(tl.segments.map((s, i) => {
    const own = info[i]!.own;
    if (own.found && own.cues) { authored++; return [s.id, own.cues] as const; }
    return [s.id, auto[i]!] as const;
  }));
  return { season: presenterSeason(o.text, o.month ?? new Date().getMonth() + 1), sceneScale: o.sceneScale ?? PRESENTER_SCENE_SCALE, cues, mouth, authored };
}

/**
 * 전체 화면 렌더 한 편(2026-10-23 본편 기본값 — LONGFORM_LAYOUT=full). timeline.json → LongFormFull(편 전용 진입점 remotion-entry-full)
 * → final.mp4 + subtitles.srt·report.md·youtube.txt + 완성 화면 대조표(contact.jpg, 세그먼트마다 55% 시점 — final.mp4 에서 뽑는다).
 * 장면 키는 timeline 의 scene(장면 단계가 쓴 통과분) 중 파일이 있는 것만 등록한다 — 진입점을 주지 않으면 여기서 다시 쓴다(폴더를 옮겨도 산다).
 * 스테이징(remotion-full/public — 낭독·끼움 카드 클립)·번들(remotion-full/bundle)은 렌더 뒤에도 남긴다(janitor 가 치운다).
 */
export async function renderEpisodeFull(dir: string, opts: {
  deps: RenderDeps; style: FullStyle; stills?: number[]; signal?: AbortSignal; log?: (m: string) => void; onProgress?: (pct: number) => void;
  entryPoint?: string; repo?: string; chapterTotal?: number;
  /** 진행자 비온이(LONGFORM_PRESENTER, 기본 꺼짐) — 켜면 왼쪽 아래에 서서 말하고 몸짓한다. 끄면 화면은 종전과 같다. */
  presenter?: boolean;
  /** 보관소 영상 id → 수종(insets.json 이 없을 때만 쓴다). */
  mediaSpecies?: (id: string) => string | undefined;
  tile?: typeof tileStills;
}): Promise<RenderResult & { contact?: string }> {
  const { deps } = opts;
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const repo = opts.repo ?? path.resolve('.');
  const work = path.join(dir, FULL_WORK_DIR);
  const publicDir = path.join(work, 'public');
  const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Timeline;
  const script = loadEpisodeScript(dir);
  fs.mkdirSync(publicDir, { recursive: true });

  const footage = fullFootageOf(dir, tl, opts.mediaSpecies ?? (() => undefined));
  // 등록할 장면 — timeline 의 scene 키 중 파일이 있는 것만(정리된 장면은 종이 바탕 + 카드로 대신).
  const keys = [...new Set(tl.segments.map((s) => s.scene).filter((k): k is string => !!k && fs.existsSync(path.join(dir, SCENE_DIR, `${k}.tsx`))))];
  const tlR: Timeline = { ...tl, segments: tl.segments.map((s) => { if (!s.scene || keys.includes(s.scene)) return s; const { scene: _drop, ...rest } = s; return rest; }) };
  const presenter = opts.presenter ? await buildPresenter(dir, tlR, keys, { ffmpeg: deps.ffmpeg, text: `${script.title} ${script.ytKeyLine ?? ''}`, log }) : undefined;
  const props = toFullProps(script.title, tlR, { style: opts.style, footage, ...(opts.chapterTotal ? { chapterTotal: opts.chapterTotal } : {}), ...(script.keywords?.length ? { keywords: script.keywords } : {}), ...(presenter ? { presenter } : {}) });
  for (const s of tl.segments) stage(path.join(dir, 'audio', s.audio), path.join(publicDir, s.audio));
  for (const f of new Set([...footage.values()].map((x) => x.src))) stage(path.join(dir, 'clips', f), path.join(publicDir, f));
  fs.writeFileSync(path.join(dir, 'props-full.json'), JSON.stringify(props, null, 2));
  if (opts.signal?.aborted) throw new Error('취소됨');

  const entryPoint = opts.entryPoint ?? writeEpisodeEntryFull(dir, keys, repo, opts.style);
  const serveUrl = await deps.bundle({ entryPoint, publicDir, outDir: path.join(work, 'bundle') });
  const tBundle = Date.now();
  const yt = buildYoutubeMeta(script, tl, FPS);

  if (opts.stills?.length) {
    const sd = path.join(work, 'stills');
    fs.mkdirSync(sd, { recursive: true });
    const out: string[] = [];
    for (const f of opts.stills) {
      const file = path.join(sd, `f${f}.png`);
      await deps.renderStill({ serveUrl, inputProps: props, frame: f, output: file, composition: 'LongFormFull' });
      out.push(file);
      log(`[스틸] f${f}.png`);
    }
    return { totalFrames: tl.totalFrames, durationSec: tl.totalFrames / FPS, renderSec: 0, yt, stills: out };
  }

  let last = -1;
  const final = path.join(dir, 'final.mp4');
  await deps.renderMedia({
    serveUrl, inputProps: props, output: final, signal: opts.signal, composition: 'LongFormFull',
    onProgress: (progress) => {
      const p = Math.floor(progress * 20);
      if (p !== last) { last = p; log(`[렌더] ${p * 5}%`); opts.onProgress?.(p * 5); }
    },
  });
  if (opts.signal?.aborted) throw new Error('취소됨');
  const tRender = Date.now();

  // 완성 화면 대조표 — 세그먼트마다 55% 시점(장 이름·자막 띠까지 최종 모습). 실패해도 편은 완성.
  let contact: string | undefined;
  try {
    const sd = path.join(work, 'stills');
    fs.mkdirSync(sd, { recursive: true });
    const frames: string[] = [];
    for (const s of props.segments) {
      const f = path.join(sd, `${s.id}.png`); // tileStills 는 PNG 차례 파일을 붙인다
      await deps.ffmpeg(['-v', 'error', '-y', '-ss', ((s.startFrame + s.frames * 0.55) / FPS).toFixed(2), '-i', final, '-frames:v', '1', '-vf', 'scale=640:-2', f]);
      frames.push(f);
    }
    contact = path.join(dir, 'contact.jpg');
    await (opts.tile ?? tileStills)(frames, contact, { cols: 4, width: 640, quality: 3 });
  } catch (e) { contact = undefined; log(`[대조표] 실패: ${e instanceof Error ? e.message : String(e)}`); }

  const withScene = props.segments.filter((s) => s.scene).length;
  const insets = props.segments.filter((s) => s.footage).length;
  let missing: Array<{ chapter: string; why: string }> = [];
  try { missing = (JSON.parse(fs.readFileSync(path.join(dir, SCENE_DIR, 'report.json'), 'utf8')) as { insetMissing?: typeof missing }).insetMissing ?? []; } catch { /* 장면 보고 없음 */ }
  writeTextOutputs(dir, tl, yt, [
    `장 ${tl.chapterStarts.length}, 세그먼트 ${tl.segments.length} (전체 화면 스타일 ${opts.style} · 장면 ${withScene} · 대신 화면 ${tl.segments.length - withScene} · 끼움 카드 가능 ${insets})`,
    ...(missing.length ? [`끼움 카드 없는 장: ${missing.map((m) => `${m.chapter}(${m.why})`).join(', ')}`] : []),
    `진입점: ${path.relative(dir, entryPoint) || ENTRY_DIR_FULL}${contact ? ' · 대조표 contact.jpg' : ''}`,
  ], { t0, tBundle, tRender }, log);
  log(`[완료] final.mp4(전체 화면 ${opts.style}) · 렌더 ${((tRender - tBundle) / 60000).toFixed(1)}분`);
  return { totalFrames: tl.totalFrames, durationSec: Math.round(tl.totalFrames / FPS), renderSec: Math.round((tRender - tBundle) / 1000), yt, ...(contact ? { contact } : {}) };
}
