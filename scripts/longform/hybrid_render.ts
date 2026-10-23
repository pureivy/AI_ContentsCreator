/**
 * 혼합(H) 롱폼 견본 렌더(2026-10-23, 옵트인). hybrid_scenes.ts 가 만든 진입점(remotion-entry-h)으로 LongFormHybrid → sample.mp4,
 * 세그먼트마다 55% 시점 한 장씩 대조표(contact.jpg — 장 이름·자막 띠까지 최종 모습).
 * 실행: tsx scripts/longform/hybrid_render.ts <편 폴더> [--stills-only] [--at 프레임,프레임…(추가 점검 스틸)] [--copy <폴더>(작게 다시 인코딩한 사본·대조표)]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RENDER_OPTS } from '../../src/tools/shortsRenderRemotion';
import { loadEpisodeScript } from '../../src/longform/episode';
import { approxWords } from '../../src/longform/sceneRules';
import { tileStills } from '../../src/longform/scenePreview';
import { FPS, GAP_SEC, type Timeline } from '../../src/longform/timeline';
import { ENTRY_DIR_H, type HType } from './hybrid_lib';
import type { LongFormHybridProps } from '../../remotion/longform/hybrid/LongFormHybrid';

const [dirArg] = process.argv.slice(2);
if (!dirArg) throw new Error('사용법: hybrid_render.ts <편 폴더> [--stills-only] [--at f1,f2] [--copy 폴더]');
const dir = path.resolve(dirArg);
const argv = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Timeline;
const script = loadEpisodeScript(dir);
const types = JSON.parse(fs.readFileSync(path.join(dir, 'types.json'), 'utf8')) as { segments: Array<{ id: string; type: HType }> };
const foot = JSON.parse(fs.readFileSync(path.join(dir, 'footage-h.json'), 'utf8')) as Record<string, { bg: string; fg?: string }>;
const rep = JSON.parse(fs.readFileSync(path.join(dir, 'scenes', 'report-h.json'), 'utf8')) as { pass: string[]; keys: Record<string, { key: string; type: HType }> };
const typeOf = new Map(types.segments.map((s) => [s.id, s.type]));
const chapterIndex = new Map(tl.chapterStarts.map((c, i) => [c.id, i]));
const clip = (src: string, frames: number) => ({ src, startFrom: 0, durationInFrames: frames });

const props: LongFormHybridProps = {
  title: script.title, totalFrames: tl.totalFrames, chapterTotal: tl.chapterStarts.length,
  ...(script.keywords?.length ? { keywords: script.keywords } : {}),
  chapters: tl.chapterStarts.map((c, i) => {
    const first = tl.segments.find((s) => s.chapter === c.id && foot[s.id]);
    return { index: i, title: c.title, startFrame: c.startFrame, frames: c.frames, ...(first ? { bg: clip(foot[first.id]!.bg, c.frames) } : {}) };
  }),
  segments: tl.segments.map((s) => {
    const type = typeOf.get(s.id) ?? 'footage';
    const key = rep.keys[s.id]?.key;
    const scene = key && rep.pass.includes(key) ? key : undefined;
    const f = foot[s.id];
    return {
      id: s.id, type, chapterIndex: chapterIndex.get(s.chapter) ?? 0, chapterTitle: s.chapterTitle, startFrame: s.startFrame, frames: s.frames, audio: s.audio, captions: s.captions,
      ...(scene ? { scene, sceneWords: approxWords(s.narration, s.frames / FPS - GAP_SEC) } : {}),
      ...(f ? { bg: clip(f.bg, s.frames) } : {}), ...(f?.fg ? { fg: clip(f.fg, s.frames) } : {}),
    };
  }),
};

const work = path.join(dir, 'remotion-h');
const pub = path.join(work, 'public');
fs.mkdirSync(pub, { recursive: true });
const link = (from: string, name: string) => { const to = path.join(pub, name); if (fs.existsSync(to)) fs.unlinkSync(to); try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };
for (const s of tl.segments) link(path.join(dir, 'audio', s.audio), s.audio);
for (const f of Object.values(foot)) for (const c of [f.bg, f.fg]) if (c) link(path.join(dir, 'clips', c), c);
fs.writeFileSync(path.join(dir, 'props-h.json'), JSON.stringify(props, null, 2));

const [{ bundle }, { renderMedia, renderStill, selectComposition, openBrowser }] = await Promise.all([import('@remotion/bundler'), import('@remotion/renderer')]);
const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.join(dir, ENTRY_DIR_H, 'index.ts'), publicDir: pub, outDir: path.join(work, 'bundle'), enableCaching: false });
const browser = await openBrowser('chrome', { chromiumOptions: RENDER_OPTS.chromiumOptions });
const errors: string[] = [];
try {
  const composition = await selectComposition({ serveUrl, id: 'LongFormHybrid', inputProps: props, puppeteerInstance: browser });
  const sd = path.join(work, 'stills');
  fs.mkdirSync(sd, { recursive: true });
  const stills: string[] = [];
  for (const s of props.segments) {
    const out = path.join(sd, `${s.id}.png`);
    await renderStill({ serveUrl, composition, inputProps: props, frame: s.startFrame + Math.round(s.frames * 0.55), output: out, puppeteerInstance: browser, timeoutInMilliseconds: 120_000 });
    stills.push(out);
  }
  await tileStills(stills, path.join(dir, 'contact.jpg'), { cols: 4, width: 640, quality: 3 });
  console.log(`[대조표] ${path.join(dir, 'contact.jpg')} (${stills.length}장)`);
  for (const fr of (argv('--at') ?? '').split(',').filter(Boolean).map(Number)) {
    await renderStill({ serveUrl, composition, inputProps: props, frame: fr, output: path.join(sd, `at_${fr}.png`), puppeteerInstance: browser, timeoutInMilliseconds: 120_000 });
    console.log(`[점검] ${path.join(sd, `at_${fr}.png`)}`);
  }
  if (!process.argv.includes('--stills-only')) {
    let last = -1;
    await renderMedia({
      serveUrl, composition, inputProps: props, codec: 'h264', outputLocation: path.join(dir, 'sample.mp4'), puppeteerInstance: browser, ...RENDER_OPTS,
      onBrowserLog: (l) => { if (l.type === 'error') errors.push(l.text.slice(0, 200)); },
      onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; console.log(`[렌더] ${p * 10}%`); } },
    });
    console.log(`[완료] ${path.join(dir, 'sample.mp4')} · ${(props.totalFrames / 30).toFixed(1)}초 · ${((Date.now() - t0) / 60000).toFixed(1)}분${errors.length ? ` · 브라우저 오류 ${errors.length}` : ''}`);
    for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ', e);
  }
} finally {
  await browser.close({ silent: true }).catch(() => {});
}
const copy = argv('--copy');
if (copy && fs.existsSync(path.join(dir, 'sample.mp4'))) {
  fs.mkdirSync(copy, { recursive: true });
  const out = path.join(copy, 'H_sample.mp4');
  // 28MB 아래로 — 영상 비트레이트를 길이에 맞춰 정한다(오디오 128k 별도, 여유 10%).
  const sec = props.totalFrames / 30;
  const kbps = Math.floor(((27 * 8 * 1024) / sec - 128) * 0.9);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'sample.mp4'), '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.4)}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
  fs.copyFileSync(path.join(dir, 'contact.jpg'), path.join(copy, 'H_contact.jpg'));
  console.log(`[사본] ${out} ${(fs.statSync(out).size / 1048576).toFixed(1)}MB · ${path.join(copy, 'H_contact.jpg')}`);
}
