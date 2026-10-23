/**
 * 전체 화면 장면 견본용 편 자르기(2026-10-23) — 편 앞머리에서 maxSec 안에 끝나는 세그먼트까지 잘라 새 폴더로.
 * 원본 편 폴더는 읽기만 한다. 오디오·클립은 하드 링크(같은 디스크가 아니면 복사).
 * 실행: tsx scripts/longform/full_slice.ts <원본 편 폴더> <새 폴더> [maxSec=70]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Timeline } from '../../src/longform/timeline';
import type { LongformScript } from '../../src/longform/script';

const [src, dst, maxS] = process.argv.slice(2);
if (!src || !dst) throw new Error('사용법: full_slice.ts <원본> <새 폴더> [maxSec]');
const maxFrames = Math.round(Number(maxS ?? 70) * 30);
const tl = JSON.parse(fs.readFileSync(path.join(src, 'timeline.json'), 'utf8')) as Timeline;
const script = JSON.parse(fs.readFileSync(path.join(src, 'script.json'), 'utf8')) as LongformScript;

// 앞에서부터 — 편 머리라 프레임을 다시 셀 필요가 없다(0부터 시작). 그래도 첫 장 시작을 0으로 맞춘다.
const base = tl.chapterStarts[0]!.startFrame;
const segs = tl.segments.filter((s) => s.startFrame + s.frames - base <= maxFrames);
const keepIds = new Set(segs.map((s) => s.id));
const chapters = new Set(segs.map((s) => s.chapter));
const out: Timeline = {
  segments: segs.map((s) => ({ ...s, startFrame: s.startFrame - base })),
  chapterStarts: tl.chapterStarts.filter((c) => chapters.has(c.id)).map((c) => ({ ...c, startFrame: c.startFrame - base })),
  totalFrames: Math.max(...segs.map((s) => s.startFrame - base + s.frames)),
};
const outScript: LongformScript = {
  ...script,
  chapters: script.chapters.filter((c) => chapters.has(c.id)).map((c) => ({ ...c, segments: c.segments.filter((g) => keepIds.has(g.id)) })),
};

fs.mkdirSync(path.join(dst, 'audio'), { recursive: true });
fs.mkdirSync(path.join(dst, 'clips'), { recursive: true });
const link = (from: string, to: string) => {
  if (fs.existsSync(to)) return;
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
};
for (const s of segs) {
  link(path.join(src, 'audio', s.audio), path.join(dst, 'audio', s.audio));
  for (const c of [s.clip, s.clip2]) if (c) link(path.join(src, 'clips', c), path.join(dst, 'clips', c));
}
fs.writeFileSync(path.join(dst, 'timeline.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(dst, 'script.json'), JSON.stringify(outScript, null, 2));
const footFile = path.join(src, 'footage.json');
if (fs.existsSync(footFile)) {
  const f = JSON.parse(fs.readFileSync(footFile, 'utf8')) as { shots?: Array<{ segId: string }> };
  fs.writeFileSync(path.join(dst, 'footage.json'), JSON.stringify({ ...f, shots: (f.shots ?? []).filter((x) => keepIds.has(x.segId)) }, null, 2));
}
fs.writeFileSync(path.join(dst, 'SOURCE.txt'), `원본: ${path.resolve(src)}\n세그먼트 ${segs.length}개 (${segs[0]?.id} ~ ${segs.at(-1)?.id}) · 장 ${out.chapterStarts.map((c) => c.id).join(', ')} · ${(out.totalFrames / 30).toFixed(1)}초\n`);
console.log(`[자르기] ${dst} — 세그먼트 ${segs.length}개 · 장 ${out.chapterStarts.length} · ${(out.totalFrames / 30).toFixed(1)}초`);
