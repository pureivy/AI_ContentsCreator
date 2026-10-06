/**
 * 쇼츠 커버(유튜브 쇼츠 목록용 9:16) — 디자인 썸네일(thumbnail.jpg, gpt-image 2:3)을 검은 띠 없이
 * 1080×1920 으로 맞춘 dir/shorts-cover.jpg.
 *
 * 왜 따로 만드나(실측 2026-09-30): 채널 쇼츠 탭 그리드는 Studio(데스크톱)에서 지정한 쇼츠 커버만 쓰고,
 * 권장 비율은 9:16 이다. 종전 yt-cover.jpg 는 2:3 썸네일을 9:16 에 레터박스한 인트로 첫 프레임이라
 * 위아래 검은 띠가 그대로 커버가 됐다. 가운데 자르기(크롭)는 제목·글머리 가장자리가 잘려 탈락 —
 * 원본 전체를 가운데 두고 남는 위아래를 같은 그림의 흐린 확대본으로 채운다(9:16 원본이면 흐림층이 가려져 사실상 스케일만).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const COVER_W = 1080;
export const COVER_H = 1920;
export const COVER_FILE = 'shorts-cover.jpg';

/** 흐림 채움 필터(순수) — 배경: 꽉 채워 자른 뒤 흐림·살짝 어둡게 / 전경: 전체가 들어가게 축소 후 가운데. */
export function coverFilter(w = COVER_W, h = COVER_H): string {
  return `[0:v]split=2[a][b];`
    + `[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:2,eq=brightness=-0.06[bg];`
    + `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];`
    + `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuvj420p`;
}

/** 재생성 필요 여부(순수) — 커버가 없거나 원본 썸네일보다 오래됐으면 true. */
export function coverStale(thumbMtimeMs: number, coverMtimeMs: number | null): boolean {
  return coverMtimeMs == null || coverMtimeMs < thumbMtimeMs;
}

/**
 * dir/thumbnail.jpg → dir/shorts-cover.jpg(1080×1920). 신선하면 재사용, 썸네일 없으면 null.
 * 임시파일+rename(원자적). best-effort — 실패는 null(호출부는 커버 없이 진행).
 */
export async function ensureShortsCover(dir: string, signal?: AbortSignal): Promise<string | null> {
  const thumb = path.join(dir, 'thumbnail.jpg');
  const out = path.join(dir, COVER_FILE);
  let thumbMt: number;
  try { thumbMt = fs.statSync(thumb).mtimeMs; } catch { return null; }
  let coverMt: number | null = null;
  try { coverMt = fs.statSync(out).mtimeMs; } catch { /* 없음 */ }
  if (!coverStale(thumbMt, coverMt)) return out;
  const tmp = path.join(dir, `.shorts-cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  try {
    await execFileP('ffmpeg', ['-nostdin', '-y', '-i', thumb, '-filter_complex', coverFilter(), '-frames:v', '1', '-q:v', '2', tmp],
      { timeout: 30_000, signal, maxBuffer: 8 * 1024 * 1024 });
    fs.renameSync(tmp, out);
    return out;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 무해 */ }
    return fs.existsSync(out) ? out : null; // 옛 커버라도 있으면 그걸 쓴다
  }
}
