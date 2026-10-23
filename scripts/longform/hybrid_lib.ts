/**
 * 혼합(H) 롱폼 견본 공용(2026-10-23, 옵트인 — 본편 장면 단계(longformScenes)는 건드리지 않는다).
 * 장면 키트 모듈(_kit.ts = 스타일 B 키트 + 정보 카드 키트), 갈래별 빠른 검사, 장면 하나 미리보기(장 이름 알약·자막 띠까지),
 * 진입점(remotion-entry-h)·등록표 쓰기. 장면 파일 규약은 전체 화면 장면과 같다(./_kit·react·remotion 만 import, 기본 내보내기 하나).
 */
import fs from 'node:fs';
import path from 'node:path';
import { lintScene, scanSource, sceneTexts, textOverlap } from '../../src/longform/sceneLint';
import { typecheckScenes } from '../../src/longform/sceneCheck';
import { importPath, kitShimSourceFull, registrySourceFull, writeIfChanged } from '../../src/longform/sceneFiles';
import { PREVIEW_AT, frameAt, renderSceneStills, tileStills, type StillItem } from '../../src/longform/scenePreview';
import { zoneLeak, zoneProblems } from '../../src/longform/sceneFull';
import type { SceneSpec } from '../../src/longform/sceneJob';

export type HType = 'card' | 'diagram' | 'footage';
export type Clip = { src: string; startFrom: number; durationInFrames: number };
export type HSpec = SceneSpec & { htype: Exclude<HType, 'footage'>; bg?: Clip; captions: Array<{ text: string; startFrame: number; endFrame: number }>; chapterTotal: number };
export interface HJob { batch: string; repo: string; workDir: string; fps: number; clipsDir: string; scenes: HSpec[] }

export const ENTRY_DIR_H = 'remotion-entry-h';
/** 카드 글자 덩어리 상한(한글, 공백 제외). */
export const CARD_TEXT_MAX = 18;

/** _kit.ts(순수) — 스타일 B 전체 화면 키트 + 정보 카드 키트. 두 갈래 장면이 같은 모듈을 쓴다(이름이 겹치지 않는다). */
export function hybridKitShim(dir: string, repo: string): string {
  const cards = importPath(dir, path.join(repo, 'remotion', 'longform', 'hybrid', 'cards.tsx'));
  return `${kitShimSourceFull(dir, repo, 'B').trimEnd().replace('전체 화면 장면 키트(스타일 B)', '혼합(H) 장면 키트(스타일 B 도해 + 정보 카드)')}\nexport * from '${cards}';\n`;
}

/** 갈래별 빠른 검사(순수). 도해 = 전체 화면 검사 그대로(실촬영 없음). 카드 = 라벨 수·길이 대신 '문장 낱말만'(글자 두 개 묶음 전부가 문장에)·덩어리 길이. */
export function lintHybrid(src: string, spec: Pick<HSpec, 'key' | 'narration' | 'htype'>): string[] {
  if (spec.htype === 'diagram') return lintScene(src, spec.key, spec.narration, { stage: 'FullStage', urlPrefixes: ['a-', 'b-'], noRawText: true, insetRequired: false, noFootage: true });
  const base = lintScene(src, spec.key, spec.narration, { stage: 'CardStage', urlPrefixes: ['h-'], noRawText: true, noFootage: true })
    .filter((p) => !p.startsWith('라벨 너무 김') && !/^라벨 \d+개/.test(p));
  const out = [...base];
  for (const t of sceneTexts(src)) {
    if (!/[가-힣]/.test(t.text)) continue;
    if (textOverlap(t.text, spec.narration) < 1) out.push(`카드 글자에 문장에 없는 낱말: "${t.text}" — 문장에 나온 말만(낱말 조합은 되지만 새 낱말·요약어 금지)`);
    const n = t.text.replace(/[^가-힣0-9a-zA-Z~]/g, '').length;
    if (n > CARD_TEXT_MAX) out.push(`카드 글자 덩어리 너무 김: "${t.text}" ${n}자 — ${CARD_TEXT_MAX}자 이하로 나눈다`);
  }
  // 한글 없는 글자(예: '6~14m')의 숫자도 문장 숫자만 — 경로·크기 문자열은 뺀다.
  const nums = new Set((spec.narration.match(/\d+(?:\.\d+)?/g) ?? []).map((x) => String(Number(x))));
  for (const s of scanSource(src).strings) {
    if (/[가-힣]/.test(s.text) || !/\d/.test(s.text) || /px|^M\s?\d|rgba?\(|%/.test(s.text)) continue;
    const bad = (s.text.match(/\d+(?:\.\d+)?/g) ?? []).map((x) => String(Number(x))).filter((x) => !nums.has(x));
    if (bad.length) out.push(`문장에 없는 숫자: "${s.text}" (${bad.join(', ')})`);
  }
  if (/<\s*(Tree|Hand|PersimmonFruit|PersimmonLeaf|Leaf|Fruit|BShrub)\b/.test(src)) out.push('카드 장면에 식물·손 그림 금지 — 바탕 실촬영이 수종을 보여 준다');
  return [...new Set(out)];
}

/** 미리보기·검사 스틸 props(순수). */
export function hybridExtra(spec: HSpec, probe = false): Record<string, unknown> {
  return {
    type: spec.htype, ...(spec.bg ? { footage: spec.bg } : {}),
    chapter: { index: spec.chapterIndex, total: spec.chapterTotal, title: spec.chapterTitle }, captions: spec.captions, ...(probe ? { probe: true } : {}),
  };
}
export function hybridPublicFiles(specs: readonly HSpec[], clipsDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of specs) if (s.bg) out[s.bg.src] = path.join(clipsDir, s.bg.src);
  return out;
}

/** 장면 하나 진입점(작업 폴더/.preview) — 혼합 'Scene' 컴포지션. */
export function writePreviewEntryHybrid(workDir: string, key: string, repo: string): string {
  const dir = path.join(workDir, '.preview');
  const mod = importPath(dir, path.join(repo, 'remotion', 'longform', 'hybrid', 'LongFormHybrid.tsx'));
  writeIfChanged(path.join(dir, 'index.ts'), "import { registerRoot } from 'remotion';\nimport { Root } from './Root';\n\nregisterRoot(Root);\n");
  writeIfChanged(path.join(dir, 'Root.tsx'), `import { makeHybridSceneComposition } from '${mod}';\nimport Target from './target';\n\nexport const Root = makeHybridSceneComposition({ target: Target });\n`);
  writeIfChanged(path.join(dir, 'target.ts'), `export { default } from '../${key}';\n`);
  return path.join(dir, 'index.ts');
}

export async function checkHybrid(job: HJob, key: string): Promise<{ ok: boolean; key: string; problems: string[] }> {
  const sc = job.scenes.find((s) => s.key === key);
  if (!sc) return { ok: false, key, problems: [`이 묶음에 없는 장면 키: ${key} (${job.scenes.map((s) => s.key).join(', ')})`] };
  const file = path.join(job.workDir, sc.file);
  if (!fs.existsSync(file)) return { ok: false, key, problems: [`파일 없음: ${sc.file}`] };
  const tc = await typecheckScenes([file], job.repo);
  const problems = [...lintHybrid(fs.readFileSync(file, 'utf8'), sc), ...(tc.get(path.resolve(file)) ?? [])];
  return { ok: !problems.length, key, problems };
}

/** 20·55·90% 스틸(장 이름 알약·자막 띠까지) 가로 붙임 preview/<key>.png + 검사 스틸로 자막 띠·장 이름 자리 침범 + 빠른 검사. */
export async function previewHybrid(job: HJob, key: string): Promise<{ ok: boolean; key: string; problems: string[]; image?: string; stills: string[] }> {
  const sc = job.scenes.find((s) => s.key === key);
  if (!sc) return { ok: false, key, problems: [`이 묶음에 없는 장면 키: ${key}`], stills: [] };
  const file = path.join(job.workDir, sc.file);
  if (!fs.existsSync(file)) return { ok: false, key, problems: [`파일 없음: ${sc.file}`], stills: [] };
  const problems = lintHybrid(fs.readFileSync(file, 'utf8'), sc);
  const entryPoint = writePreviewEntryHybrid(job.workDir, key, job.repo);
  const out = path.join(job.workDir, 'preview');
  const items: StillItem[] = PREVIEW_AT.flatMap((r) => [false, true].map((probe) => ({
    id: `${r}${probe ? 'p' : ''}`, sceneKey: 'target', durationInFrames: sc.frames, words: sc.words, frame: frameAt(sc.frames, r),
    output: path.join(out, probe ? '.probe' : '', `${key}_${Math.round(r * 100)}.png`), extra: hybridExtra(sc, probe),
  })));
  let res: Map<string, string | null>;
  try { res = await renderSceneStills({ entryPoint, outDir: path.join(job.workDir, '.preview'), items, publicFiles: hybridPublicFiles([sc], job.clipsDir) }); }
  catch (e) { return { ok: false, key, problems: [...problems, `번들 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 600)}`], stills: [] }; }
  for (const it of items) { const err = res.get(it.id); if (err) problems.push(`렌더 오류(${it.frame}프레임): ${err}`); }
  for (const it of items.filter((x) => x.extra?.probe && res.get(x.id) === null)) {
    try { problems.push(...zoneProblems(await zoneLeak(it.output), it.frame)); } catch { /* 측정 실패는 넘어간다 */ }
  }
  const stills = items.filter((it) => !it.extra?.probe && res.get(it.id) === null).map((it) => it.output);
  let image: string | undefined;
  if (stills.length) {
    image = path.join(out, `${key}.png`);
    try { await tileStills(stills, image, { cols: 3, width: 800 }); } catch { image = stills[0]; }
  }
  return { ok: !problems.length, key, problems: [...new Set(problems)], ...(image ? { image } : {}), stills };
}

/** 편 폴더에 _kit.ts·등록표·진입점(remotion-entry-h) — 진입점 index.ts 경로. */
export function writeHybridEntry(dir: string, keys: readonly string[], repo: string): string {
  const scenes = path.join(dir, 'scenes');
  const entry = path.join(dir, ENTRY_DIR_H);
  writeIfChanged(path.join(scenes, '_kit.ts'), hybridKitShim(scenes, repo));
  const registry = path.join(scenes, 'registry.ts');
  writeIfChanged(registry, registrySourceFull(keys));
  const mod = importPath(entry, path.join(repo, 'remotion', 'longform', 'hybrid', 'LongFormHybrid.tsx'));
  writeIfChanged(path.join(entry, 'index.ts'), "// 생성 파일 — 이 편 전용 혼합(H) 롱폼 진입점.\nimport { registerRoot } from 'remotion';\nimport { Root } from './Root';\n\nregisterRoot(Root);\n");
  writeIfChanged(path.join(entry, 'Root.tsx'), `// 생성 파일 — 장면 등록표를 넣은 LongFormHybrid + 장면 하나(Scene).\nimport { makeLongFormHybridRoot } from '${mod}';\nimport { SCENES } from '${importPath(entry, registry)}';\n\nexport const Root = makeLongFormHybridRoot(SCENES);\n`);
  return path.join(entry, 'index.ts');
}
