/**
 * 쇼츠 Remotion 렌더러 — AutoShorts 컴포지션을 @remotion/renderer 로 mp4 렌더. renderShortsVideo
 * (ffmpeg 슬라이드쇼)와 동일 시그니처의 드롭인. 실패 시 호출부가 폴백한다.
 * 에셋(씬 이미지·TTS mp3)은 per-render public/ 로 스테이징해 staticFile(bare 파일명)로 참조한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { prepareScenes, buildSrt } from './shortsCommon';
import type { ShortsScene, ShortsRenderResult } from './shortsCommon';

export async function renderShortsVideoRemotion(
  dir: string, scenes: ShortsScene[], images: Array<string | null>,
  opts: { voice?: string; instructions?: string; signal?: AbortSignal } = {},
): Promise<ShortsRenderResult> {
  const entry = path.resolve('remotion/index.ts');
  if (!fs.existsSync(entry)) return { ok: false, issues: ['remotion 엔트리 부재'] };

  const work = path.join(dir, 'remotion');
  const publicDir = path.join(work, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  // 1) TTS·길이
  const { prepared, issues } = await prepareScenes(work, scenes, images, opts);
  if (!prepared.length) return { ok: false, issues: [...issues, '조립할 씬 없음'] };

  // 2) 에셋 스테이징(public/) — staticFile 참조용 bare 파일명으로 복사
  const propScenes = prepared.map((p) => {
    const nn = String(p.index + 1).padStart(2, '0');
    let imageSrc: string | null = null, audioSrc: string | null = null;
    if (p.imagePath) { const dst = `scene_${nn}${path.extname(p.imagePath) || '.png'}`; fs.copyFileSync(p.imagePath, path.join(publicDir, dst)); imageSrc = dst; }
    if (p.audioPath) { const dst = `narr_${nn}.mp3`; fs.copyFileSync(p.audioPath, path.join(publicDir, dst)); audioSrc = dst; }
    return { imageSrc, audioSrc, screenText: p.screenText, durationInFrames: p.durationInFrames };
  });
  const totalFrames = prepared.reduce((a, p) => a + p.durationInFrames, 0);
  const inputProps = { scenes: propScenes, totalFrames };

  // 3) 번들 + 렌더
  const videoPath = path.join(dir, 'final.mp4');
  try {
    const serveUrl = await bundle({ entryPoint: entry, publicDir });
    const composition = await selectComposition({ serveUrl, id: 'AutoShorts', inputProps });
    await renderMedia({ serveUrl, composition, codec: 'h264', outputLocation: videoPath, inputProps });
  } catch (e) {
    return { ok: false, issues: [...issues, `Remotion 렌더 실패: ${e instanceof Error ? e.message.slice(0, 160) : e}`] };
  }

  // 4) SRT
  const srtPath = path.join(dir, 'subtitles.srt');
  fs.writeFileSync(srtPath, buildSrt(prepared.map((p) => ({ narration: p.narration, durationSec: p.durationSec }))), 'utf-8');

  const durationSec = Math.round(prepared.reduce((a, p) => a + p.durationSec, 0) * 10) / 10;
  return { ok: true, videoPath, srtPath, durationSec, sceneCount: prepared.length, issues };
}
