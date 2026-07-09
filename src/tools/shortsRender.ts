/**
 * 숏폼 렌더러 — 씬 이미지 + TTS 내레이션 + 자막을 ffmpeg 로 세로(1080×1920) MP4 로 조립.
 *
 * 설계(참고 자산 이식 근거):
 *  - 내레이션은 TTS(voice/tts synthesize — OpenAI gpt-4o-mini-tts 기본, 실패 시 macOS say 폴백) →
 *    씬 길이는 오디오 실측(ffprobe). 숏폼 톤(활기·빠른 템포)은 instructions 로 전달
 *  - 화면 텍스트는 Pillow(shorts_frame.py)로 프레임에 미리 굽는다 — 홈브류 ffmpeg 가 drawtext
 *    (freetype) 없이 빌드돼 있어(실측 'No such filter') 자막 필터를 쓸 수 없고, AI 이미지에
 *    글자를 맡기지도 않는다(오타 원천 차단)
 *  - 출력은 H.264 + AAC(참고 프로젝트 사운드 감독 규칙), 씬별 세그먼트 → concat demuxer(-c copy)
 *  - 씬 이미지에 느린 줌(zoompan ~1.10)으로 정지화면 지루함 완화 — 프레임을 1.5배(1620×2880)로
 *    렌더해 줌 다운스케일 후에도 텍스트가 선명
 *  - 씬 이미지 누락 시 그라데이션 폴백(내러티브 순서 보존 — 장 스킵 대신 배경만 대체)
 *  - BGM 은 로컬 음악 생성 모델이 없어 미탑재. 추후 추가 시 내레이션 100%·BGM 30% 볼륨 규칙 적용.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';
import { synthesize } from '../voice/tts';
import {
  FPS, W, H, FRAME_W, FRAME_H,
  type ShortsScene, type ShortsRenderResult, sceneDurationSec, sceneFrames, fmtSrtTime, probeDuration, SHORTS_TTS_TONE,
} from './shortsCommon';

export type { ShortsScene, ShortsRenderResult } from './shortsCommon';

const execFileP = promisify(execFile);

async function ff(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  await execFileP('ffmpeg', ['-nostdin', '-y', ...args], { timeout: timeoutMs, signal, maxBuffer: 8 * 1024 * 1024 });
}

/**
 * 씬 배열 → dir/final.mp4 + subtitles.srt. images[i] 는 씬 i 의 배경(없으면 null → 단색 폴백).
 * 개별 씬 실패는 이슈로 기록하고 해당 씬을 단색 배경·무음으로라도 완성(전체 실패 방지).
 */

export async function renderShortsVideo(
  dir: string, scenes: ShortsScene[], images: Array<string | null>,
  opts: { voice?: string; instructions?: string; signal?: AbortSignal } = {},
): Promise<ShortsRenderResult> {
  const issues: string[] = [];
  if (!CONFIG.blogPython || !fs.existsSync(CONFIG.blogPython)) {
    return { ok: false, issues: ['BLOG_PYTHON 미설정 — 씬 프레임(Pillow) 합성 불가'] };
  }
  const frameScript = path.join(CONFIG.blogScriptsDir, 'shorts_frame.py');
  const segDir = path.join(dir, 'segments');
  fs.mkdirSync(segDir, { recursive: true });

  const segFiles: string[] = [];
  const srtLines: string[] = [];
  let clock = 0;

  for (let i = 0; i < scenes.length; i++) {
    if (opts.signal?.aborted) throw new Error('취소됨');
    const scene = scenes[i]!;
    const nn = String(i + 1).padStart(2, '0');

    // 1) 내레이션 TTS → mp3 (실패 시 무음 씬으로 폴백).
    //    Remotion 경로가 먼저 합성해 둔 mp3(dir/remotion/narr_NN.mp3)가 있으면 재사용 — 폴백 시 TTS 이중 과금 방지.
    let audioPath: string | null = null;
    let audioDur = 0;
    try {
      const remotionMp3 = path.join(dir, 'remotion', `narr_${nn}.mp3`);
      const dst = path.join(segDir, `narr_${nn}.mp3`);
      if (fs.existsSync(remotionMp3)) {
        fs.copyFileSync(remotionMp3, dst);
      } else {
        const mp3 = await synthesize(scene.narration, { voice: opts.voice, instructions: opts.instructions ?? SHORTS_TTS_TONE, signal: opts.signal });
        fs.writeFileSync(dst, mp3);
      }
      audioDur = await probeDuration(dst);
      audioPath = dst;
    } catch (e) {
      issues.push(`씬${i + 1} TTS 실패(무음 진행): ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    const dur = sceneDurationSec(audioDur);
    const frames = sceneFrames(dur);

    // 2) 씬 프레임 합성(Pillow) — 배경 커버핏 + 화면 텍스트 굽기(이미지 누락 시 그라데이션 폴백)
    const img = images[i] && fs.existsSync(images[i]!) ? images[i]! : '';
    if (!img) issues.push(`씬${i + 1} 배경 폴백(그라데이션)`);
    const framePath = path.join(segDir, `frame_${nn}.png`);
    await execFileP(CONFIG.blogPython, [frameScript,
      '--image', img, '--text', (scene.screenText ?? '').trim(), '--index', String(i),
      '--output', framePath, '--width', String(FRAME_W), '--height', String(FRAME_H)],
      { timeout: 60_000, signal: opts.signal });

    // 3) 세그먼트 — 느린 줌(zoompan) + 내레이션. 프레임이 이미 목표 비율이라 스케일 불필요.
    const seg = path.join(segDir, `seg_${nn}.mp4`);
    const audioArgs = audioPath
      ? ['-i', audioPath]
      : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
    await ff([
      '-i', framePath, ...audioArgs,
      '-filter_complex',
      `[0:v]zoompan=z='min(zoom+0.0006,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}[v];[1:a]apad[a]`,
      '-map', '[v]', '-map', '[a]',
      '-t', dur.toFixed(2),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      seg,
    ], 120_000, opts.signal);
    segFiles.push(seg);

    srtLines.push(`${i + 1}`, `${fmtSrtTime(clock)} --> ${fmtSrtTime(clock + dur)}`, scene.narration, '');
    clock += dur;
  }

  if (!segFiles.length) return { ok: false, issues: [...issues, '조립할 씬 없음'] };

  // 3) concat(-c copy — 전 세그먼트 동일 파라미터) + srt
  const listPath = path.join(segDir, 'concat.txt');
  fs.writeFileSync(listPath, segFiles.map((f) => `file '${f}'`).join('\n'), 'utf-8');
  const videoPath = path.join(dir, 'final.mp4');
  await ff(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', videoPath], 60_000, opts.signal);
  const srtPath = path.join(dir, 'subtitles.srt');
  fs.writeFileSync(srtPath, srtLines.join('\n'), 'utf-8');

  return { ok: true, videoPath, srtPath, durationSec: Math.round(clock * 10) / 10, sceneCount: scenes.length, issues };
}
