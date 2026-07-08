/**
 * 쇼츠 렌더러 공유 상수·헬퍼 — ffmpeg 슬라이드쇼(shortsRender)와 Remotion(shortsRenderRemotion)이
 * "오디오가 길이를 지배" 불변식·SRT·길이·씬 전처리를 공유한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { synthesize } from '../voice/tts';

const execFileP = promisify(execFile);

export const FPS = 30;
export const W = 1080;
export const H = 1920;
export const MIN_SCENE_SEC = 2.8;
export const TAIL_PAD_SEC = 0.6;
export const FRAME_W = 1620;
export const FRAME_H = 2880;

export const SHORTS_TTS_TONE =
  '활기차고 대화하듯, 약간 빠른 템포로 친근하게 낭독한다. 첫 훅은 궁금증을 자아내게 힘주어, 핵심 수치와 결론은 또렷하고 자신감 있게. 광고 성우톤이 아니라 아는 사람이 알려주듯.';

export type SceneKind = 'hook' | 'stat' | 'list' | 'quote' | 'cta';
export interface SceneKindFields {
  kind?: SceneKind;
  stat?: { value: number; unit?: string; label?: string };
  items?: string[];
  quote?: { text: string; source?: string };
}
export interface ShortsScene extends SceneKindFields { narration: string; screenText?: string }

/**
 * LLM 씬 오브젝트에서 kind·페이로드를 검증 추출 — 실패 시 {} 로 강등(fail-open, 렌더 무중단).
 * 캡: stat unit 6자·label 15자, list 2~4개·각 18자, quote text 40자·source 15자.
 */
const asText = (v: unknown): string => (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : ''; // 오브젝트 등은 '' — '[object Object]' 렌더 유출 방지

export function normalizeSceneKind(raw: unknown): SceneKindFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = String(r.kind ?? '').trim().toLowerCase();
  if (kind === 'hook' || kind === 'cta') return { kind };
  if (kind === 'stat') {
    const s = (r.stat && typeof r.stat === 'object' ? r.stat : {}) as Record<string, unknown>;
    const rawVal = asText(s.value).replace(/,/g, '').trim();
    const value = rawVal ? Number(rawVal) : NaN; // 빈 값은 Number('')=0 함정 회피 — 명시 거부
    if (!Number.isFinite(value)) return {};
    const unit = asText(s.unit).slice(0, 6);
    const label = asText(s.label).slice(0, 15);
    return { kind: 'stat', stat: { value, ...(unit ? { unit } : {}), ...(label ? { label } : {}) } };
  }
  if (kind === 'list') {
    const items = (Array.isArray(r.items) ? r.items : [])
      .map((x) => asText(x).slice(0, 18)).filter(Boolean).slice(0, 4);
    if (items.length < 2) return {};
    return { kind: 'list', items };
  }
  if (kind === 'quote') {
    const q = (r.quote && typeof r.quote === 'object' ? r.quote : {}) as Record<string, unknown>;
    const text = asText(q.text).slice(0, 40);
    if (!text) return {};
    const source = asText(q.source).slice(0, 15);
    return { kind: 'quote', quote: { text, ...(source ? { source } : {}) } };
  }
  return {};
}
export interface ShortsRenderResult {
  ok: boolean; videoPath?: string; srtPath?: string;
  durationSec?: number; sceneCount?: number; issues: string[];
}
export interface PreparedScene {
  index: number; imagePath: string | null; audioPath: string | null;
  screenText: string; narration: string;
  durationSec: number; durationInFrames: number; startFrame: number;
}

export function sceneDurationSec(audioDurSec: number): number {
  return Math.max(MIN_SCENE_SEC, (audioDurSec > 0 ? audioDurSec : 0) + TAIL_PAD_SEC);
}
export function sceneFrames(durSec: number): number { return Math.round(durSec * FPS); }

export function fmtSrtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}
export function buildSrt(scenes: { narration: string; durationSec: number }[]): string {
  const lines: string[] = [];
  let clock = 0;
  scenes.forEach((sc, i) => {
    lines.push(`${i + 1}`, `${fmtSrtTime(clock)} --> ${fmtSrtTime(clock + sc.durationSec)}`, sc.narration, '');
    clock += sc.durationSec;
  });
  return lines.join('\n');
}
export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execFileP('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { timeout: 15_000 });
  const d = parseFloat(String(stdout).trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe 길이 측정 실패: ${file}`);
  return d;
}

/** 씬별 TTS 합성(실패 시 무음)·길이 실측·프레임/오프셋 산출. 두 렌더러 공유. */
export async function prepareScenes(
  workDir: string, scenes: ShortsScene[], images: Array<string | null>,
  opts: { voice?: string; instructions?: string; signal?: AbortSignal },
): Promise<{ prepared: PreparedScene[]; issues: string[] }> {
  fs.mkdirSync(workDir, { recursive: true });
  const issues: string[] = [];
  const prepared: PreparedScene[] = [];
  let startFrame = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (opts.signal?.aborted) throw new Error('취소됨');
    const sc = scenes[i]!;
    const nn = String(i + 1).padStart(2, '0');
    let audioPath: string | null = null, audioDur = 0;
    try {
      const mp3 = await synthesize(sc.narration, { voice: opts.voice, instructions: opts.instructions ?? SHORTS_TTS_TONE, signal: opts.signal });
      audioPath = path.join(workDir, `narr_${nn}.mp3`);
      fs.writeFileSync(audioPath, mp3);
      audioDur = await probeDuration(audioPath);
    } catch (e) { issues.push(`씬${i + 1} TTS 실패(무음): ${e instanceof Error ? e.message.slice(0, 80) : e}`); }
    const durationSec = sceneDurationSec(audioDur);
    const durationInFrames = sceneFrames(durationSec);
    const imagePath = images[i] && fs.existsSync(images[i]!) ? images[i]! : null;
    if (!imagePath) issues.push(`씬${i + 1} 배경 폴백(그라데이션)`);
    prepared.push({ index: i, imagePath, audioPath, screenText: sc.screenText ?? '', narration: sc.narration, durationSec, durationInFrames, startFrame });
    startFrame += durationInFrames;
  }
  return { prepared, issues };
}
