/**
 * 롱폼 가로 손글씨 썸네일(2026-10-22 사장님 요청: "썸네일은 숏폼처럼 손글씨 스타일") — 쇼츠 엔진
 * (generateDesignedThumbnail: gpt-image edit + 한글 QA 3회·낱말 교체·QA 미해결 표식)을 가로로 돌린다.
 *
 * 참조 사진은 실촬영 한 컷이다. final.mp4 의 프레임은 쓰지 않는다 — 모든 문장에 자막·장 제목·모션그래픽이
 * 구워져 있어(시범 실측), 그걸 참조로 주면 이미지 모델이 그 글자를 따라 그리거나 깨뜨려 한글 QA 를 스스로 망친다.
 * 그래서 timeline.json 의 세그먼트별 실촬영 클립(clips/<seg>.mp4, 세로 1080x1920)에서 영상의 30% 지점에 가까운
 * 컷을 골라 가운데를 3:2 로 잘라 쓴다. 클립이 없을 때만 final.mp4 의 30% 지점으로 물러선다.
 *
 * 돈이 드는 호출(이미지 생성)은 generateLongformThumbnail 하나뿐이고, 사람이 누른 재생성·제작 파이프라인만 부른다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FPS } from '../longform/timeline';
import { generateDesignedThumbnail, thumbTextQaFailed, type ThumbCopyLlm } from './shortsThumbnail';
import { probeDuration } from '../tools/shortsCommon';
import type { LongformThumbState } from '../content/longform';

const execFileP = promisify(execFile);

/** 참조 컷을 고를 영상 위치(전체 길이 비율) — 도입부(인사·예고)를 지나 본론의 나무가 나오는 자리. */
export const REF_POSITION = 0.3;
export const REF_FRAME_FILE = 'thumb-ref.jpg';

interface TimelineSeg { id?: string; startFrame?: number; frames?: number; clip?: string }

/** 30% 지점에 가장 가까운(세그먼트 가운데 기준) 실촬영 클립 세그먼트(순수). 클립 있는 세그먼트가 없으면 null. */
export function pickRefSegment(segments: readonly TimelineSeg[], totalFrames: number, ratio = REF_POSITION): TimelineSeg | null {
  const target = totalFrames * ratio;
  let best: TimelineSeg | null = null;
  let bestD = Infinity;
  for (const s of segments) {
    if (!s.clip || typeof s.startFrame !== 'number') continue;
    const d = Math.abs(s.startFrame + (s.frames ?? 0) / 2 - target);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/** 참조 프레임 ffmpeg 인자(순수) — 세로·가로 어느 원본이든 가운데를 3:2 로 잘라 1536x1024(생성 크기)로. */
export function refFrameArgs(src: string, seekSec: number, out: string): string[] {
  return [
    '-nostdin', '-y', '-ss', seekSec.toFixed(2), '-i', src, '-frames:v', '1',
    '-vf', "crop='min(iw,ih*3/2)':'min(ih,iw*2/3)',scale=1536:1024", '-q:v', '2', out,
  ];
}

/** 설명에서 썸네일 카피용 요약만(순수) — '챕터' 줄 앞 첫 문단. 챕터 타임스탬프·해시태그를 카피 LLM 에 주지 않는다. */
export function descriptionSummary(desc: string): string {
  const head = (desc || '').split(/\n\s*챕터\s*\n/)[0] ?? '';
  return head.split(/\n\s*\n/)[0]!.replace(/#\S+/g, '').trim();
}

/** dir/thumb-ref.jpg 추출 — 실촬영 클립 우선, 없으면 final.mp4 의 30% 지점. 실패하면 null(무해). */
export async function extractLongformRefFrame(dir: string, signal?: AbortSignal): Promise<string | null> {
  const out = path.join(dir, REF_FRAME_FILE);
  const run = async (src: string, sec: number): Promise<boolean> => {
    try {
      await execFileP('ffmpeg', refFrameArgs(src, sec, out), { timeout: 60_000, signal });
      return fs.existsSync(out) && fs.statSync(out).size > 0;
    } catch { return false; }
  };
  let totalFrames = 0;
  try {
    const t = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf-8')) as { segments?: TimelineSeg[]; totalFrames?: number };
    totalFrames = Number(t.totalFrames) || 0;
    const seg = pickRefSegment(t.segments ?? [], totalFrames);
    const clip = seg?.clip ? path.join(dir, 'clips', path.basename(seg.clip)) : '';
    // 클립 앞 0.5초는 이어 붙인 자리라 흔들릴 수 있어 1초 지점(짧으면 0.5초).
    if (clip && fs.existsSync(clip) && (await run(clip, 1) || await run(clip, 0.5))) return out;
  } catch { /* timeline 없음 — final.mp4 로 */ }
  const final = path.join(dir, 'final.mp4');
  if (!fs.existsSync(final)) return null;
  const dur = totalFrames > 0 ? totalFrames / FPS : await probeDuration(final).catch(() => 0);
  return dur > 0 && await run(final, dur * REF_POSITION) ? out : null;
}

/**
 * 가로 손글씨 썸네일 생성 → dir/thumbnail.jpg(1280x720·2MB 이하). 결과 상태를 돌려준다:
 * ok(QA 통과) · qa_failed(오타 의심 — 발행 게이트가 막는다) · none(참조 컷·키·생성 실패 — 썸네일 없이 둔다).
 * 기존 thumbnail.jpg 는 새 이미지가 나왔을 때만 바뀐다(실패하면 이전 것이 남는다 — 그 상태를 그대로 판독).
 * generated=false 면 이번에 새로 만든 게 없다(참조 컷 없음·키 없음·생성 실패) — 재생성 버튼은 이걸 실패로 알린다.
 */
export async function generateLongformThumbnail(o: {
  dir: string; title: string; description: string; keyword?: string; signal?: AbortSignal;
  /** 썸네일 문구 LLM — 제작 파이프라인은 이미지 디자이너(윤소이) 역할 호출(2026-10-23). 없으면 쇼츠와 같은 microJSON. */
  copyLlm?: ThumbCopyLlm;
}): Promise<{ generated: boolean; state: LongformThumbState }> {
  const ref = await extractLongformRefFrame(o.dir, o.signal);
  const generated = !!ref && await generateDesignedThumbnail({
    dir: o.dir, title: o.title, description: descriptionSummary(o.description), keyword: o.keyword,
    hookImage: ref, signal: o.signal, orientation: 'landscape', ...(o.copyLlm ? { copyLlm: o.copyLlm } : {}),
  });
  return { generated, state: longformThumbStateOf(o.dir) };
}

/** 폴더의 썸네일 상태 판독(파일만 본다) — 재시작으로 'pending' 이 남은 레코드를 되돌릴 때도 쓴다. */
export function longformThumbStateOf(dir: string): LongformThumbState {
  if (!fs.existsSync(path.join(dir, 'thumbnail.jpg'))) return 'none';
  return thumbTextQaFailed(dir) ? 'qa_failed' : 'ok';
}
