/**
 * 전체 화면 롱폼 렌더(2026-10-23 견본 — 옵트인). full_scenes.ts 가 만든 진입점(remotion-entry-full)으로 LongFormFull → sample.mp4,
 * 세그먼트마다 55% 시점 한 장씩 대조표(contact.jpg — 장 이름·자막 띠까지 최종 모습).
 * 실행: tsx scripts/longform/full_render.ts <편 폴더> <A|B> [--chapter-total N] [--stills-only] [--frames a,b] [--presenter [--scene-scale 1] [--host-scale 0.6] [--month M] [--out 이름.mp4]]
 * --presenter = 진행자 비온이(LONGFORM_PRESENTER 와 같은 준비 — buildPresenter, 2026-10-23 코드 리그: 장면 bioneeCues 또는 자동 신호).
 */
import fs from 'node:fs';
import path from 'node:path';
import { RENDER_OPTS } from '../../src/tools/shortsRenderRemotion';
import { CONFIG } from '../../src/config';
import { loadEpisodeScript, loadMediaVideos } from '../../src/longform/episode';
import { toFullProps } from '../../src/longform/fullProps';
import { buildPresenter, fullFootageOf } from '../../src/longform/render';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ENTRY_DIR_FULL } from '../../src/longform/sceneFiles';
import { tileStills } from '../../src/longform/scenePreview';
import type { Timeline } from '../../src/longform/timeline';

const [dirArg, style] = process.argv.slice(2) as [string, 'A' | 'B'];
if (!dirArg || (style !== 'A' && style !== 'B')) throw new Error('사용법: full_render.ts <편 폴더> <A|B> [--chapter-total N] [--stills-only]');
const dir = path.resolve(dirArg);
const ci = process.argv.indexOf('--chapter-total');
const chapterTotal = ci > 0 ? Number(process.argv[ci + 1]) : undefined;
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Timeline;
const script = loadEpisodeScript(dir);
const species = new Map(loadMediaVideos(CONFIG.dataDir).filter((m) => m.species).map((m) => [m.id, m.species!]));
// 운영 렌더와 같은 끼움 카드 배정(scenes/insets.json 우선, 없으면 주인공 수종 규칙으로 계산).
const footage = fullFootageOf(dir, tl, (id) => species.get(id));
const argOf = (k: string): string | undefined => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const sceneKeys = [...new Set(tl.segments.map((s) => s.scene).filter((k): k is string => !!k && fs.existsSync(path.join(dir, 'scenes', `${k}.tsx`))))];
const presenter = process.argv.includes('--presenter')
  ? await buildPresenter(dir, tl, sceneKeys, {
    ffmpeg: async (a) => { await promisify(execFile)('ffmpeg', a, { timeout: 120_000 }); }, text: `${script.title} ${script.ytKeyLine ?? ''}`,
    ...(argOf('--month') ? { month: Number(argOf('--month')) } : {}), ...(argOf('--scene-scale') ? { sceneScale: Number(argOf('--scene-scale')) } : {}),
    log: (m: string) => console.log(m),
  })
  : undefined;
const hostScale = argOf('--host-scale') ? Number(argOf('--host-scale')) : undefined;
if (presenter) {
  console.log(`[진행자] 계절 ${presenter.season} · 장면 비율 ${presenter.sceneScale}${hostScale ? ` · 비온이 크기 ${hostScale}` : ''} · 장면이 고른 신호 ${presenter.authored}/${tl.segments.length}`);
  for (const [k, cs] of presenter.cues) console.log(`  ${k}: ${cs.map((c) => `${c.action}@${c.at.toFixed(1)}${c.params?.text ? `「${c.params.text}」` : ''}${c.params?.target && typeof c.params.target === 'object' ? `→(${c.params.target.x},${c.params.target.y})` : ''}`).join(' ') || '(가만히)'}`);
}
const props = toFullProps(script.title, tl, { style, footage, ...(chapterTotal ? { chapterTotal } : {}), ...(script.keywords?.length ? { keywords: script.keywords } : {}), ...(presenter ? { presenter: { ...presenter, ...(hostScale ? { hostScale } : {}) } } : {}) });

const work = path.join(dir, 'remotion-full');
const pub = path.join(work, 'public');
fs.mkdirSync(pub, { recursive: true });
const link = (from: string, name: string) => { const to = path.join(pub, name); if (fs.existsSync(to)) return; try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };
for (const s of tl.segments) link(path.join(dir, 'audio', s.audio), s.audio);
for (const f of footage.values()) link(path.join(dir, 'clips', f.src), f.src);
fs.writeFileSync(path.join(dir, 'props-full.json'), JSON.stringify(props, null, 2));

const [{ bundle }, { renderMedia, renderStill, selectComposition, openBrowser }] = await Promise.all([import('@remotion/bundler'), import('@remotion/renderer')]);
const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.join(dir, ENTRY_DIR_FULL, 'index.ts'), publicDir: pub, outDir: path.join(work, 'bundle'), enableCaching: false });
const browser = await openBrowser('chrome', { chromiumOptions: RENDER_OPTS.chromiumOptions });
const errors: string[] = [];
try {
  const composition = await selectComposition({ serveUrl, id: 'LongFormFull', inputProps: props, puppeteerInstance: browser });
  // 대조표 — 세그먼트마다 55% 시점.
  const sd = path.join(work, 'stills');
  fs.mkdirSync(sd, { recursive: true });
  const stills: string[] = [];
  for (const s of props.segments) {
    const out = path.join(sd, `${s.id}.png`);
    await renderStill({ serveUrl, composition, inputProps: props, frame: s.startFrame + Math.round(s.frames * 0.55), output: out, puppeteerInstance: browser, timeoutInMilliseconds: 120_000 });
    stills.push(out);
  }
  await tileStills(stills, path.join(dir, 'contact.jpg'), { cols: 4, width: 640, quality: 3 });
  // --frames a,b,c — 그 프레임들의 스틸(stills/f<n>.png, 진행자 입·자세 확인용).
  for (const n of (argOf('--frames') ?? '').split(',').filter(Boolean).map(Number)) {
    await renderStill({ serveUrl, composition, inputProps: props, frame: n, output: path.join(sd, `f${n}.png`), puppeteerInstance: browser, timeoutInMilliseconds: 120_000 });
  }
  console.log(`[대조표] ${path.join(dir, 'contact.jpg')} (${stills.length}장)`);
  if (!process.argv.includes('--stills-only')) {
    let last = -1;
    await renderMedia({
      serveUrl, composition, inputProps: props, codec: 'h264', outputLocation: path.join(dir, argOf('--out') ?? 'sample.mp4'), puppeteerInstance: browser, ...RENDER_OPTS, crf: CONFIG.longformCrf, // 본편과 같은 화질(2026-10-23)
      onBrowserLog: (l) => { if (l.type === 'error') errors.push(l.text.slice(0, 200)); },
      onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; console.log(`[렌더] ${p * 10}%`); } },
    });
    console.log(`[완료] ${path.join(dir, argOf('--out') ?? 'sample.mp4')} · ${(props.totalFrames / 30).toFixed(1)}초 · ${((Date.now() - t0) / 60000).toFixed(1)}분${errors.length ? ` · 브라우저 오류 ${errors.length}` : ''}`);
    for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ', e);
  }
} finally {
  await browser.close({ silent: true }).catch(() => {});
}
