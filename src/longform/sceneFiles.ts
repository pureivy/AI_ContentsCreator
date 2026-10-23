/**
 * 문장 그림 장면 — 편 폴더에 생성하는 파일들(순수 문자열 생성 + 쓰기).
 *
 * data/longform/<편>/scenes/
 *   _kit.ts        장면 파일이 import 하는 유일한 로컬 모듈 — remotion/longform 의 Kit2·SceneStage 를 다시 내보낸다.
 *                  상대 경로는 path.relative 로 계산(데이터 폴더가 GEPA_DATA_DIR 로 옮겨도 맞는다). 작업 폴더에도 같은 꼴로 둔다 →
 *                  장면 파일을 작업 폴더에서 scenes/ 로 옮겨도 import 가 그대로 산다.
 *   sNNN.tsx       에이전트가 쓴 장면(NNN = 편 전체 세그먼트 번호, 3자리)
 *   registry.ts    검사를 통과한 장면만 정적 import 하는 등록표(웹팩은 동적 경로를 못 따라간다)
 * data/longform/<편>/remotion-entry/index.ts·Root.tsx — 등록표를 컨텍스트로 넣은 LongForm + 'Scene' 컴포지션 진입점.
 * node_modules(react·remotion)는 편 폴더에서 위로 올라가며 찾는다 — 데이터 폴더가 저장소 밖이면 번들이 실패한다(그때는 장면 없이 렌더).
 */
import fs from 'node:fs';
import path from 'node:path';

export const SCENE_DIR = 'scenes';
export const ENTRY_DIR = 'remotion-entry';
export const KIT_SHIM = '_kit.ts';

/** 장면 키(순수) — 편 전체 세그먼트 번호 → 's007'. 파일 이름·SVG id 접두사(`s007-`)도 이것. */
export const sceneKey = (i: number): string => `s${String(i).padStart(3, '0')}`;
export const SCENE_KEY_RE = /^s\d{3}$/;

/** from 폴더에서 to 파일로 가는 import 경로(순수) — posix, 확장자 뗌, 항상 ./ 나 ../ 로 시작. */
export function importPath(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile).split(path.sep).join('/').replace(/\.(tsx?|jsx?)$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/** _kit.ts 내용(순수). */
export function kitShimSource(dir: string, repo: string): string {
  const kit = importPath(dir, path.join(repo, 'remotion', 'longform', 'illus', 'Kit2.tsx'));
  const stage = importPath(dir, path.join(repo, 'remotion', 'longform', 'scenes', 'SceneStage.tsx'));
  return [
    '// 생성 파일 — 장면 키트 한 곳 가져오기(손대지 않는다). 장면 파일은 이 모듈·react·remotion 만 import 한다.',
    `export * from '${kit}';`,
    `export { SceneStage, type SceneProps, type BackdropKind, type CameraFocus } from '${stage}';`,
    '',
  ].join('\n');
}

/**
 * 전체 화면 장면(2026-10-23 견본, 옵트인)용 _kit.ts 내용(순수) — 스타일 키트 전부 + 무대 도우미 + 모양 계산 몇 개.
 * 장면 파일은 여전히 './_kit'·react·remotion 만 import 한다.
 */
export function kitShimSourceFull(dir: string, repo: string, style: 'A' | 'B', speciesFile?: string): string {
  const fs0 = path.join(repo, 'remotion', 'longform', 'fullscreen');
  const kit = importPath(dir, path.join(fs0, `style${style}`, 'kit.tsx'));
  const stage = importPath(dir, path.join(fs0, 'stage.tsx'));
  const geom = importPath(dir, path.join(fs0, 'geom.ts'));
  return [
    `// 생성 파일 — 전체 화면 장면 키트(스타일 ${style}) 한 곳 가져오기(손대지 않는다). 장면 파일은 이 모듈·react·remotion 만 import 한다.`,
    `export * from '${kit}';`,
    `export { FootageInset, atFromWords, beat, beatInOut, mix, clamp, SAFE, CAPTION_TOP, W, H, type FullSceneProps, type Footage, type Word } from '${stage}';`,
    `export { sectionGeom, potGeom, rootBallGeom, koreaGeom, type P } from '${geom}';`,
    // 이 편 전용 종 프리셋(2026-10-23 — 키트에 없는 수종, 서다인 작성·검사 통과분). scenes/_species.ts 가 있을 때만.
    ...(speciesFile ? [`export { EP_SPECIES } from '${importPath(dir, speciesFile)}';`] : []),
    '',
  ].join('\n');
}

/** 편 전용 종 프리셋 모듈 파일(scenes/_species.ts) — 있으면 경로, 없으면 undefined. */
export const SPECIES_MODULE = '_species.ts';
export function episodeSpeciesModule(dir: string): string | undefined {
  const f = path.join(dir, SCENE_DIR, SPECIES_MODULE);
  return fs.existsSync(f) ? f : undefined;
}

/** registry.ts 내용(순수) — keys 순서대로 정적 import. */
export function registrySource(keys: readonly string[]): string {
  for (const k of keys) if (!SCENE_KEY_RE.test(k)) throw new Error(`장면 키 아님: ${k}`);
  return [
    '// 생성 파일 — 검사를 통과한 장면만 정적으로 싣는다(longformScenes.ts).',
    "import type React from 'react';",
    "import type { SceneProps } from './_kit';",
    ...keys.map((k) => `import ${k} from './${k}';`),
    '',
    `export const SCENES: Record<string, React.ComponentType<SceneProps>> = { ${keys.join(', ')} };`,
    '',
  ].join('\n');
}

/** 전체 화면 등록표(순수) — registrySource 와 같되 장면 props 타입이 FullSceneProps. */
export function registrySourceFull(keys: readonly string[]): string {
  return registrySource(keys).replace("import type { SceneProps } from './_kit';", "import type { FullSceneProps as SceneProps } from './_kit';");
}

/** 전체 화면 진입점 두 파일(순수) — Root.tsx 가 makeLongFormFullRoot(등록표). */
export function entrySourcesFull(entryDir: string, registryFile: string, repo: string): { index: string; root: string } {
  const rootMod = importPath(entryDir, path.join(repo, 'remotion', 'longform', 'fullscreen', 'Root.tsx'));
  const reg = importPath(entryDir, registryFile);
  return {
    index: ['// 생성 파일 — 이 편 전용 전체 화면 롱폼 진입점(장면 등록표 포함).', "import { registerRoot } from 'remotion';", "import { Root } from './Root';", '', 'registerRoot(Root);', ''].join('\n'),
    root: [
      '// 생성 파일 — 장면 등록표를 넣은 LongFormFull + 장면 하나(Scene, 1920×1080) 컴포지션.',
      `import { makeLongFormFullRoot } from '${rootMod}';`,
      `import { SCENES } from '${reg}';`,
      '',
      'export const Root = makeLongFormFullRoot(SCENES);',
      '',
    ].join('\n'),
  };
}
export const ENTRY_DIR_FULL = 'remotion-entry-full';

/** 전체 화면 등록표·진입점 쓰기 — 진입점 index.ts 경로. */
export function writeEpisodeEntryFull(dir: string, keys: readonly string[], repo: string, style: 'A' | 'B'): string {
  const scenes = path.join(dir, SCENE_DIR);
  const entry = path.join(dir, ENTRY_DIR_FULL);
  writeIfChanged(path.join(scenes, KIT_SHIM), kitShimSourceFull(scenes, repo, style, episodeSpeciesModule(dir)));
  const registry = path.join(scenes, 'registry.ts');
  writeIfChanged(registry, registrySourceFull(keys));
  const src = entrySourcesFull(entry, registry, repo);
  writeIfChanged(path.join(entry, 'index.ts'), src.index);
  writeIfChanged(path.join(entry, 'Root.tsx'), src.root);
  return path.join(entry, 'index.ts');
}

/** 편 진입점 두 파일(순수) — index.ts(registerRoot) + Root.tsx(등록표 → makeLongFormRoot). */
export function entrySources(entryDir: string, registryFile: string, repo: string): { index: string; root: string } {
  const rootMod = importPath(entryDir, path.join(repo, 'remotion', 'longform', 'Root.tsx'));
  const reg = importPath(entryDir, registryFile);
  return {
    index: ["// 생성 파일 — 이 편 전용 롱폼 진입점(장면 등록표 포함).", "import { registerRoot } from 'remotion';", "import { Root } from './Root';", '', 'registerRoot(Root);', ''].join('\n'),
    root: [
      '// 생성 파일 — 장면 등록표를 컨텍스트로 넣은 LongForm + 장면 하나(Scene) 컴포지션.',
      `import { makeLongFormRoot } from '${rootMod}';`,
      `import { SCENES } from '${reg}';`,
      '',
      'export const Root = makeLongFormRoot(SCENES);',
      '',
    ].join('\n'),
  };
}

/** 쓰기 — 내용이 같으면 건드리지 않는다(웹팩 캐시·mtime 보존). 읽기 전용으로 남은 파일도 지우고 새로 쓴다. */
export function writeIfChanged(file: string, data: string, mode?: number): void {
  try { if (fs.readFileSync(file, 'utf8') === data) return; } catch { /* 없음 */ }
  try { fs.unlinkSync(file); } catch { /* 없음 */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, mode != null ? { encoding: 'utf8', mode } : 'utf8');
}

/** 편 폴더에 등록표·진입점을 쓴다 — 진입점 index.ts 경로. */
export function writeEpisodeEntry(dir: string, keys: readonly string[], repo: string): string {
  const scenes = path.join(dir, SCENE_DIR);
  const entry = path.join(dir, ENTRY_DIR);
  writeIfChanged(path.join(scenes, KIT_SHIM), kitShimSource(scenes, repo));
  const registry = path.join(scenes, 'registry.ts');
  writeIfChanged(registry, registrySource(keys));
  const src = entrySources(entry, registry, repo);
  writeIfChanged(path.join(entry, 'index.ts'), src.index);
  writeIfChanged(path.join(entry, 'Root.tsx'), src.root);
  return path.join(entry, 'index.ts');
}
