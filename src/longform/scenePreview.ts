/**
 * 장면 스틸 — 에이전트 미리보기(./preview.sh: 장면 하나 20%·55%·90% 세 장 + 가로로 붙인 한 장)와
 * 파이프라인 대조표(통과 장면마다 55% 한 장 → 6열 바둑판 contact.jpg). 둘 다 'Scene' 컴포지션(1100×680)을 쓴다.
 * 'Scene' 은 ErrorBoundary 로 감싸지 않는다 — 장면이 던지면 renderStill 이 실패해 그 장면이 드러난다(registry.tsx).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RENDER_OPTS } from '../tools/shortsRenderRemotion';
import { importPath, writeIfChanged } from './sceneFiles';
import type { Word } from './sceneRules';
import { SAFETY_NO_RENDER, lintScene } from './sceneLint';
import type { SceneJob } from './sceneJob';
import { isInternalRef } from './speciesCommons';

const execFileP = promisify(execFile);

/** 미리보기·검사 스틸 시점(장면 길이 비율). */
export const PREVIEW_AT = [0.2, 0.55, 0.9] as const;
export const CONTACT_AT = 0.55;
export const frameAt = (frames: number, r: number): number => Math.min(frames - 1, Math.max(0, Math.round(frames * r)));

export interface StillItem { id: string; sceneKey: string; durationInFrames: number; words?: Word[]; frame: number; output: string; /** 컴포지션 props 에 더할 것(전체 화면 장면 — 스타일·실촬영·자막·검사 모드). */ extra?: Record<string, unknown> }

/** 번들 하나 + 브라우저 하나로 여러 스틸 — 실패는 항목별 사유(던지지 않는다). */
export async function renderSceneStills(o: { entryPoint: string; outDir: string; items: StillItem[]; cache?: boolean; signal?: AbortSignal; /** 번들 public 에 놓을 파일(이름 → 원본, 하드 링크) — 실촬영 끼움 카드용. */ publicFiles?: Record<string, string> }): Promise<Map<string, string | null>> {
  // 가드 — 내부 대조용 사진(refs/** · commons-*)은 번들 public 에 놓지 않는다(장면이 실물 사진을 화면에 띄울 길을 막는다).
  const publicFiles = Object.entries(o.publicFiles ?? {}).filter(([name, src]) => !isInternalRef(name) && !isInternalRef(src));
  const [{ bundle }, { renderStill, selectComposition, openBrowser }] = await Promise.all([import('@remotion/bundler'), import('@remotion/renderer')]);
  const publicDir = path.join(o.outDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  for (const [name, src] of publicFiles) {
    const dst = path.join(publicDir, name);
    if (fs.existsSync(dst)) continue;
    try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
  }
  const serveUrl = await bundle({ entryPoint: o.entryPoint, publicDir, outDir: path.join(o.outDir, 'bundle'), enableCaching: o.cache ?? false });
  const browser = await openBrowser('chrome', { chromiumOptions: RENDER_OPTS.chromiumOptions, browserExecutable: RENDER_OPTS.browserExecutable });
  const res = new Map<string, string | null>();
  try {
    for (const it of o.items) {
      if (o.signal?.aborted) { res.set(it.id, '취소됨'); continue; }
      const inputProps = { sceneKey: it.sceneKey, durationInFrames: it.durationInFrames, ...(it.words ? { words: it.words } : {}), ...(it.extra ?? {}) };
      try {
        fs.mkdirSync(path.dirname(it.output), { recursive: true });
        const composition = await selectComposition({ serveUrl, id: 'Scene', inputProps, puppeteerInstance: browser });
        await renderStill({ serveUrl, composition, inputProps, frame: it.frame, output: it.output, puppeteerInstance: browser, timeoutInMilliseconds: 60_000 });
        res.set(it.id, null);
      } catch (e) {
        res.set(it.id, (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 4).join(' ').slice(0, 400));
      }
    }
  } finally {
    await browser.close({ silent: true }).catch(() => {});
  }
  return res;
}

/** 미리보기 진입점(작업 폴더/.preview) — index·Root 는 고정, target.ts 만 바꿔 장면 하나를 싣는다. */
export function writePreviewEntry(workDir: string, key: string, repo: string): string {
  const dir = path.join(workDir, '.preview');
  const reg = importPath(dir, path.join(repo, 'remotion', 'longform', 'scenes', 'registry.tsx'));
  writeIfChanged(path.join(dir, 'index.ts'), "import { registerRoot } from 'remotion';\nimport { Root } from './Root';\n\nregisterRoot(Root);\n");
  writeIfChanged(path.join(dir, 'Root.tsx'), `import { makeSceneComposition } from '${reg}';\nimport Target from './target';\n\nexport const Root = makeSceneComposition({ target: Target });\n`);
  writeIfChanged(path.join(dir, 'target.ts'), `export { default } from '../${key}';\n`);
  return path.join(dir, 'index.ts');
}

/** 스틸 여러 장을 바둑판으로(ffmpeg tile) — 모두 같은 크기(1100×680)라는 전제. 번호 붙인 사본(링크)을 이미지 열로 읽는다. */
export async function tileStills(files: readonly string[], out: string, o: { cols: number; width: number; quality?: number }): Promise<void> {
  if (!files.length) throw new Error('붙일 스틸 없음');
  const cols = Math.min(o.cols, files.length);
  const rows = Math.ceil(files.length / cols);
  const seq = `${out}.seq`;
  fs.rmSync(seq, { recursive: true, force: true });
  fs.mkdirSync(seq, { recursive: true });
  try {
    files.forEach((f, i) => fs.symlinkSync(path.resolve(f), path.join(seq, `${String(i + 1).padStart(4, '0')}.png`)));
    await execFileP('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-start_number', '1', '-i', path.join(seq, '%04d.png'),
      '-vf', `scale=${o.width}:-2,tile=${cols}x${rows}:padding=6:margin=6:color=0x14130f`, '-frames:v', '1', ...(o.quality ? ['-q:v', String(o.quality)] : []), out], { timeout: 120_000 });
  } finally {
    fs.rmSync(seq, { recursive: true, force: true });
  }
}

/**
 * 에이전트 미리보기 한 장면(./preview.sh) — 빠른 검사 결과 + 20%·55%·90% 스틸 세 장 + 가로로 붙인 preview/<key>.png.
 * 렌더 오류(장면이 던짐)는 problems 에 그대로 — 에이전트가 고친다.
 */
export async function previewScene(job: SceneJob, key: string): Promise<{ ok: boolean; key: string; problems: string[]; image?: string; stills: string[] }> {
  const sc = job.scenes.find((s) => s.key === key);
  if (!sc) return { ok: false, key, problems: [`이 묶음에 없는 장면 키: ${key} (${job.scenes.map((s) => s.key).join(', ')})`], stills: [] };
  const file = path.join(job.workDir, sc.file);
  if (!fs.existsSync(file)) return { ok: false, key, problems: [`파일 없음: ${sc.file}`], stills: [] };
  const problems = lintScene(fs.readFileSync(file, 'utf8'), key, sc.narration);
  if (problems.some((x) => x.startsWith('보안:'))) return { ok: false, key, problems: [...problems, SAFETY_NO_RENDER], stills: [] };
  const entryPoint = writePreviewEntry(job.workDir, key, job.repo);
  const out = path.join(job.workDir, 'preview');
  const items: StillItem[] = PREVIEW_AT.map((r) => ({
    id: String(r), sceneKey: 'target', durationInFrames: sc.frames, words: sc.words, frame: frameAt(sc.frames, r),
    output: path.join(out, `${key}_${Math.round(r * 100)}.png`),
  }));
  let res: Map<string, string | null>;
  try { res = await renderSceneStills({ entryPoint, outDir: path.join(job.workDir, '.preview'), items }); }
  catch (e) { return { ok: false, key, problems: [...problems, `번들 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 600)}`], stills: [] }; }
  const stills = items.filter((it) => res.get(it.id) === null).map((it) => it.output);
  for (const it of items) { const err = res.get(it.id); if (err) problems.push(`렌더 오류(${it.frame}프레임): ${err}`); }
  let image: string | undefined;
  if (stills.length) {
    image = path.join(out, `${key}.png`);
    try { await tileStills(stills, image, { cols: 3, width: 733 }); } catch { image = stills[0]; }
  }
  return { ok: !problems.length, key, problems, ...(image ? { image } : {}), stills };
}
