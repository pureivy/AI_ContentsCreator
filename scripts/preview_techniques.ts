/**
 * 편집 기법 스틸 미리보기 — 기법마다 그 기법이 걸리는 시드를 찾아 한 프레임씩 PNG 로 뽑는다(API 호출 0회).
 *
 *   pnpm tsx scripts/preview_techniques.ts short_xxx                → out/tech/<기법>-<프레임>.png (풀 전체)
 *   pnpm tsx scripts/preview_techniques.ts short_xxx "포인터 링,줌 스루 전환"
 *
 * 기존 쇼츠의 씬 이미지를 그대로 쓰고(낭독은 없음, 씬 6초 고정), 초점은 본문 씬 전부에 (0.5, 0.55)를 준다 —
 * 좌표 기법을 실제 이미지 위에서 보려는 것이지 좌표의 정확도를 보는 것이 아니다(그건 씬 QA 몫).
 * 스테이징·props 조립은 실렌더와 같은 함수(stageAndBuildProps)를 부른다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill } from '@remotion/renderer';
import { RENDER_OPTS, stageAndBuildProps } from '../src/tools/shortsRenderRemotion';
import type { ShortsScene, PreparedScene } from '../src/tools/shortsCommon';
import { assignTechniques, EDIT_TECHNIQUES, type EditTechnique } from '../remotion/editTechniques';
import { CONFIG } from '../src/config';

async function main(): Promise<void> {
  const [, , shortId, list] = process.argv;
  if (!shortId) { console.error('사용법: pnpm tsx scripts/preview_techniques.ts short_xxx [기법,기법]'); process.exit(2); }
  const dir = path.resolve('data/shorts', shortId);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8')) as { scenes: ShortsScene[] };
  const index = JSON.parse(fs.readFileSync(path.resolve('data/shorts/index.json'), 'utf-8')) as Array<{ id: string; keyword?: string }>;
  const keyword = index.find((s) => s.id === shortId)?.keyword;
  const images = fs.readdirSync(path.join(dir, 'scenes')).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  const FR = 180; // 씬 6초 고정 — 낭독 없이 화면만 본다
  const prepared: PreparedScene[] = plan.scenes.map((s, i) => ({
    index: i, imagePath: images[i] ? path.join(dir, 'scenes', images[i]!) : null, audioPath: null,
    screenText: s.screenText ?? '', narration: s.narration, durationSec: FR / 30, durationInFrames: FR, startFrame: i * FR,
  }));
  const scenes: ShortsScene[] = plan.scenes.map((s) => ({ ...s, focus: { x: 0.5, y: 0.55 } }));
  const n = scenes.length;
  const focusSet = new Set(Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1));
  const wanted = (list ? list.split(',').map((t) => t.trim()) : [...EDIT_TECHNIQUES]) as EditTechnique[];
  const outDir = path.resolve('out/tech');
  const publicDir = path.join(outDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  // 시드 찾기 — 기법이 걸리는 첫 시드(결정적이라 다시 돌려도 같다).
  const picks: Array<{ t: EditTechnique; seed: string; at: number }> = [];
  for (const t of wanted) {
    let found: { seed: string; at: number } | null = null;
    for (let k = 0; k < 800 && !found; k++) {
      const seed = `tech-${t}-${k}`;
      for (const [at, tt] of assignTechniques(seed, n, new Set(), focusSet)) if (tt === t) found = { seed, at };
    }
    if (found) picks.push({ t, ...found }); else console.log(`${t}: 시드 못 찾음(씬 ${n}개)`);
  }
  if (!picks.length) return;

  // 스테이징은 한 번(파일명이 시드와 무관) — 번들도 한 번.
  // 실렌더와 같은 자막 위치·제목 캘리(있으면) — 창·링이 자막과 겹치는지 실제 배치로 본다.
  const titleArt = path.join(dir, 'title-art.png');
  const baseProps = await stageAndBuildProps(publicDir, prepared, scenes, {
    fxSeedKey: picks[0]!.seed,
    caption: { bottomPct: CONFIG.shortsCaptionBottomPct, ...(keyword ? { keyword } : {}) },
    ...(fs.existsSync(titleArt) ? { title: { imagePath: titleArt, topPct: CONFIG.shortsTitleTopPct, widthPct: CONFIG.shortsTitleWidthPct } } : {}),
  });
  const serveUrl = await bundle({ entryPoint: path.resolve('remotion/index.ts'), publicDir, outDir: path.join(outDir, 'bundle') });
  for (const { t, seed, at } of picks) {
    const inputProps = { ...baseProps, driftSeed: seed };
    const composition = await selectComposition({ serveUrl, id: 'AutoShorts', inputProps });
    const frames = t === '줌 스루 전환' ? [at * FR - 3, at * FR + 3] : [at * FR + 24];
    for (const frame of frames) {
      const output = path.join(outDir, `${t.replace(/\s+/g, '_')}-${frame}.png`);
      await renderStill({ serveUrl, composition, inputProps, frame, output, chromiumOptions: RENDER_OPTS.chromiumOptions, timeoutInMilliseconds: RENDER_OPTS.timeoutInMilliseconds });
      console.log(`${t} — 씬 ${at + 1} · 프레임 ${frame} → ${path.relative(process.cwd(), output)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
