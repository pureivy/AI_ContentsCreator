/**
 * 전체 화면 문장 그림 장면(2026-10-23 견본 — 옵트인, 본편 기본값 아님).
 * 종전 장면(오른쪽 칸 1000×620 + 왼쪽 실촬영 패널)과 달리 장면이 1920×1080 전체를 쓰고, 실촬영은 장면이 고른 박자에 끼움 카드로만.
 * 아래 18%(y ≥ 886)는 자막 띠, 왼쪽 위는 장 이름 — 장면은 그리지 않는다(무대가 잘라 내고 검사가 잰다).
 * 실촬영 규칙(사장님 결정): 문장이 실제 모습·상태·크기·색·질감을 말할 때만, 그리고 장마다 최소 한 번(그 장 수종 영상이 있으면) —
 * 장마다 '지정 장면' 하나를 고르고(pickInsetKeys) 그 장면은 FootageInset 필수(검사), 나머지는 에이전트가 판단.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lintScene, type LintOpts } from './sceneLint';
import { typecheckScenes } from './sceneCheck';
import { importPath, writeIfChanged } from './sceneFiles';
import { PREVIEW_AT, frameAt, renderSceneStills, tileStills, type StillItem } from './scenePreview';
import { LABEL_MAX_KO, LABEL_MAX_NUMERIC, MAX_LABELS } from './sceneRules';
import { footageOf, type FullFootage } from './fullProps';
import { pickHeroSpecies, type LongformScript } from './script';
import type { SceneJob, SceneSpec } from './sceneJob';
import type { TimedSegment } from './timeline';
import { PART_KO } from './speciesCommons';

const execFileP = promisify(execFile);

export const FULL_W = 1920;
export const FULL_H = 1080;
export const CAPTION_TOP = 886;
export const CHAPTER_ZONE = { x0: 0, y0: 0, x1: 760, y1: 110 } as const;
/** 자막 띠·장 이름 자리 침범 허용치(그 상자 픽셀 중 비율) — 안티에일리어싱 몇 점은 봐준다. */
export const ZONE_TOLERANCE = 0.002;

export type FullMode = { stage: 'full'; style: 'A' | 'B'; kitApiPath?: string; /** 진행자 비온이가 켜진 편 — 키트 문서의 진행자 단락을 넣는다(꺼지면 뺀다). */ presenter?: boolean };

/** 실제 모습 말하기 점수(순수) — 실촬영 지정 장면 고르기. 보이는 것(크기·굵기·잎·열매·껍질·색·모습)과 수종 지정(footageHint)에 점수. 땅속(뿌리)은 영상에 안 보여 빼다. */
export function lookScore(narration: string, footageHint?: readonly string[]): number {
  let n = footageHint?.length ? 2 : 0;
  for (const rx of [/\d+\s*(m|cm|미터|센티)/, /키|높이|자라면|자란/, /굵|몸통|줄기/, /잎|열매|꽃|눈\b|가지/, /껍질|색|모습|모양|크기/]) if (rx.test(narration)) n++;
  return n;
}

/** 장마다 지정 장면 하나(순수) — 실촬영이 있는 세그먼트 중 lookScore 최고(같으면 앞). 실촬영 없는 장은 없음. */
export function pickInsetKeys(specs: ReadonlyArray<Pick<SceneSpec, 'key' | 'chapterIndex' | 'narration'> & { hint?: readonly string[]; hasFootage: boolean }>): Set<string> {
  const best = new Map<number, { key: string; score: number }>();
  for (const s of specs) {
    if (!s.hasFootage) continue;
    const score = lookScore(s.narration, s.hint);
    const cur = best.get(s.chapterIndex);
    if (!cur || score > cur.score) best.set(s.chapterIndex, { key: s.key, score });
  }
  return new Set([...best.values()].map((b) => b.key));
}

/**
 * 끼움 카드에 쓸 수 있는 수종(순수, 2026-10-23 사장님 결정) — 장 id → 수종. 수종 장은 그 수종, 수종 없는 장(도입·마무리·일반)은
 * 편 주인공 수종(heroSpecies, 없으면 장 수종 최다)만. 다른 수종은 절대 끼우지 않는다. 주인공도 없으면 빈 배열(카드 없음).
 */
export function insetSpecies(script: Pick<LongformScript, 'chapters' | 'species' | 'heroSpecies'>): Record<string, string[]> {
  const hero = script.heroSpecies ?? pickHeroSpecies(undefined, { chapters: script.chapters }, {});
  return Object.fromEntries(script.chapters.map((c) => [c.id, c.species?.length ? c.species : hero ? [hero] : []]));
}

export type InsetFootage = FullFootage & { species: string; /** 다른 장 세그먼트 클립을 빌려 왔으면 그 세그먼트 id. */ borrowed?: string };
export interface InsetPlan { footage: Map<string, InsetFootage>; /** 끼움 카드가 하나도 없는 장과 사유(기록용). */ missing: Array<{ chapter: string; why: string }> }

/**
 * 세그먼트별 끼움 카드 실촬영(순수) — 자기 클립이 그 장 수종이면 그대로. 장 전체에 쓸 클립이 없으면(주인공 수종 영상이 수종 장에 먼저
 * 배정돼 도입·마무리에 남지 않은 경우) 같은 수종의 다른 장 클립을 빌려 그 장에서 실제 모습을 가장 많이 말하는 문장 하나에 준다 —
 * 장마다 최소 한 번. 그 수종 영상이 아예 없으면 빌리지 않고 missing 에 적는다.
 */
export function planInsets(segments: readonly TimedSegment[], chapterSpecies: Record<string, string[]>, mediaSpecies: (id: string) => string | undefined): InsetPlan {
  const footage = new Map<string, InsetFootage>();
  const speciesOfSeg = (s: TimedSegment) => ('mediaId' in s.shot ? mediaSpecies(s.shot.mediaId) : undefined);
  for (const s of segments) {
    const f = footageOf(s, chapterSpecies[s.chapter] ?? [], mediaSpecies);
    if (f) footage.set(s.id, { ...f, species: speciesOfSeg(s)! });
  }
  const missing: InsetPlan['missing'] = [];
  const lent = new Map<string, number>();
  const chapters = [...new Set(segments.map((s) => s.chapter))];
  for (const ch of chapters) {
    const mine = segments.filter((s) => s.chapter === ch);
    if (mine.some((s) => footage.has(s.id))) continue;
    const allowed = chapterSpecies[ch] ?? [];
    if (!allowed.length) { missing.push({ chapter: ch, why: '이 장·편 주인공 수종이 없음' }); continue; }
    const donors = segments.filter((s) => s.clip && allowed.includes(speciesOfSeg(s) ?? ''))
      .sort((a, b) => (lent.get(a.id) ?? 0) - (lent.get(b.id) ?? 0) || b.frames - a.frames);
    const donor = donors[0];
    if (!donor) { missing.push({ chapter: ch, why: `${allowed.join('·')} 실촬영 없음` }); continue; }
    let target = mine[0]!;
    for (const s of mine) if (lookScore(s.narration, s.footageHint) > lookScore(target.narration, target.footageHint)) target = s;
    lent.set(donor.id, (lent.get(donor.id) ?? 0) + 1);
    footage.set(target.id, { src: donor.clip!, startFrom: 0, durationInFrames: Math.min(donor.frames, target.frames), species: speciesOfSeg(donor)!, borrowed: donor.id });
  }
  return { footage, missing };
}

/** 종전 장면 명세에 전체 화면 정보를 붙인다(순수). chapterSpecies: 장 id → 끼움 카드 수종(insetSpecies). plan 을 주면 그 배정을 쓴다. */
export function fullSpecs(specs: SceneSpec[], segments: readonly TimedSegment[], chapterSpecies: Record<string, string[]>, mediaSpecies: (id: string) => string | undefined, chapterTotal: number, plan?: InsetPlan): SceneSpec[] {
  const bySeg = new Map(segments.map((s) => [s.id, s]));
  const insets = (plan ?? planInsets(segments, chapterSpecies, mediaSpecies)).footage;
  const ft = new Map(specs.map((sp) => {
    const f = insets.get(sp.segId);
    return [sp.key, f ? { src: f.src, startFrom: f.startFrom, durationInFrames: f.durationInFrames, species: f.species } : undefined] as const;
  }));
  const picks = pickInsetKeys(specs.map((sp) => ({ key: sp.key, chapterIndex: sp.chapterIndex, narration: sp.narration, hasFootage: !!ft.get(sp.key), ...(bySeg.get(sp.segId)!.footageHint ? { hint: bySeg.get(sp.segId)!.footageHint } : {}) })));
  return specs.map((sp) => {
    const f = ft.get(sp.key);
    const s = bySeg.get(sp.segId)!;
    return {
      ...sp,
      footage: f ? `${f.species} 실촬영 있음(끼움 카드 가능)` : '실촬영 없음(끼움 카드 쓰지 않음)',
      full: { ...(f ? { footage: f } : {}), insetRequired: picks.has(sp.key), captions: s.captions, chapterTotal },
    };
  });
}

/** 검사 옵션(순수) — 전체 화면 장면 하나. */
export function fullLintOpts(spec: SceneSpec): LintOpts {
  return { stage: 'FullStage', urlPrefixes: ['a-', 'b-'], noRawText: true, insetRequired: !!spec.full?.insetRequired, noFootage: !spec.full?.footage, noHands: true };
}

/** 스틸 한 장 props(순수) — 미리보기·검사 공용. */
export function fullExtra(spec: SceneSpec, style: 'A' | 'B', probe = false): Record<string, unknown> {
  return {
    style, ...(spec.full?.footage ? { footage: { src: spec.full.footage.src, startFrom: spec.full.footage.startFrom, durationInFrames: spec.full.footage.durationInFrames } } : {}),
    chapter: { index: spec.chapterIndex, total: spec.full?.chapterTotal ?? 1, title: spec.chapterTitle },
    ...(spec.full?.captions ? { captions: spec.full.captions } : {}),
    ...(probe ? { probe: true } : {}),
  };
}

/** 번들 public 에 놓을 실촬영(이름 → 원본). */
export function fullPublicFiles(specs: readonly SceneSpec[], clipsDir?: string): Record<string, string> {
  if (!clipsDir) return {};
  const out: Record<string, string> = {};
  for (const s of specs) if (s.full?.footage) out[s.full.footage.src] = path.join(clipsDir, s.full.footage.src);
  return out;
}

/** 검사 스틸(probe — 단색 바탕에 그림만)에서 자막 띠·장 이름 자리를 침범한 픽셀 비율. 단색(#ff00ff)이 아닌 픽셀을 센다. */
export async function zoneLeak(png: string): Promise<{ caption: number; chapter: number }> {
  const measure = async (crop: string, area: number): Promise<number> => {
    const { stdout } = await execFileP('ffmpeg', ['-v', 'error', '-i', png, '-vf', `crop=${crop}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }) as unknown as { stdout: Buffer };
    let bad = 0;
    for (let i = 0; i + 2 < stdout.length; i += 3) {
      const r = stdout[i]!, g = stdout[i + 1]!, b = stdout[i + 2]!;
      if (!(r > 200 && g < 70 && b > 200)) bad++;
    }
    return bad / area;
  };
  const capH = FULL_H - CAPTION_TOP;
  const cz = CHAPTER_ZONE;
  return {
    caption: await measure(`${FULL_W}:${capH}:0:${CAPTION_TOP}`, FULL_W * capH),
    chapter: await measure(`${cz.x1 - cz.x0}:${cz.y1 - cz.y0}:${cz.x0}:${cz.y0}`, (cz.x1 - cz.x0) * (cz.y1 - cz.y0)),
  };
}
export const zoneProblems = (leak: { caption: number; chapter: number }, frame: number): string[] => [
  ...(leak.caption > ZONE_TOLERANCE ? [`자막 띠 침범(${frame}프레임): y ≥ ${CAPTION_TOP} 에 그림 ${(leak.caption * 100).toFixed(1)}% — 그림·카드를 y ≤ 860 안으로`] : []),
  ...(leak.chapter > ZONE_TOLERANCE ? [`장 이름 자리 침범(${frame}프레임): 왼쪽 위 x<760·y<110 에 그림 ${(leak.chapter * 100).toFixed(1)}% — 비운다`] : []),
];

/** 미리보기 진입점(작업 폴더/.preview) — 전체 화면 'Scene'(장 이름·자막 띠 포함). */
export function writePreviewEntryFull(workDir: string, key: string, repo: string): string {
  const dir = path.join(workDir, '.preview');
  const rootMod = importPath(dir, path.join(repo, 'remotion', 'longform', 'fullscreen', 'Root.tsx'));
  writeIfChanged(path.join(dir, 'index.ts'), "import { registerRoot } from 'remotion';\nimport { Root } from './Root';\n\nregisterRoot(Root);\n");
  writeIfChanged(path.join(dir, 'Root.tsx'), `import { makeSceneFullComposition } from '${rootMod}';\nimport Target from './target';\n\nexport const Root = makeSceneFullComposition({ target: Target });\n`);
  writeIfChanged(path.join(dir, 'target.ts'), `export { default } from '../${key}';\n`);
  return path.join(dir, 'index.ts');
}

/** 에이전트 검사 한 장면(./check.sh, 전체 화면) — 빠른 검사(전체 화면 옵션) + 타입 검사. */
export async function checkSceneFull(job: SceneJob, key: string): Promise<{ ok: boolean; key: string; problems: string[] }> {
  const sc = job.scenes.find((s) => s.key === key);
  if (!sc) return { ok: false, key, problems: [`이 묶음에 없는 장면 키: ${key} (${job.scenes.map((s) => s.key).join(', ')})`] };
  const file = path.join(job.workDir, sc.file);
  if (!fs.existsSync(file)) return { ok: false, key, problems: [`파일 없음: ${sc.file}`] };
  const lint = lintScene(fs.readFileSync(file, 'utf8'), key, sc.narration, fullLintOpts(sc));
  const tc = await typecheckScenes([file], job.repo);
  const problems = [...lint, ...(tc.get(path.resolve(file)) ?? [])];
  return { ok: !problems.length, key, problems };
}

/**
 * 에이전트 미리보기(./preview.sh, 전체 화면) — 20·55·90% 스틸(장 이름·자막 띠 포함 — 최종 모습)을 가로로 붙인 preview/<key>.png +
 * 같은 시점 검사 스틸(probe)로 자막 띠·장 이름 자리 침범 검사 + 빠른 검사.
 */
export async function previewSceneFull(job: SceneJob, key: string): Promise<{ ok: boolean; key: string; problems: string[]; image?: string; stills: string[] }> {
  const sc = job.scenes.find((s) => s.key === key);
  if (!sc) return { ok: false, key, problems: [`이 묶음에 없는 장면 키: ${key} (${job.scenes.map((s) => s.key).join(', ')})`], stills: [] };
  const file = path.join(job.workDir, sc.file);
  if (!fs.existsSync(file)) return { ok: false, key, problems: [`파일 없음: ${sc.file}`], stills: [] };
  const style = job.style ?? 'A';
  const problems = lintScene(fs.readFileSync(file, 'utf8'), key, sc.narration, fullLintOpts(sc));
  const entryPoint = writePreviewEntryFull(job.workDir, key, job.repo);
  const out = path.join(job.workDir, 'preview');
  const items: StillItem[] = PREVIEW_AT.flatMap((r) => [false, true].map((probe) => ({
    id: `${r}${probe ? 'p' : ''}`, sceneKey: 'target', durationInFrames: sc.frames, words: sc.words, frame: frameAt(sc.frames, r),
    output: path.join(out, probe ? '.probe' : '', `${key}_${Math.round(r * 100)}.png`), extra: fullExtra(sc, style, probe),
  })));
  let res: Map<string, string | null>;
  try { res = await renderSceneStills({ entryPoint, outDir: path.join(job.workDir, '.preview'), items, publicFiles: fullPublicFiles([sc], job.clipsDir) }); }
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

/** 에이전트 지시문(순수, 한국어) — 전체 화면 키트 문서(KIT_API_A/B.md) + 이 파이프라인의 규칙·절차. */
export function scenePromptFull(job: Pick<SceneJob, 'scenes' | 'style' | 'species'>, kitApi: string, o: { episodeTitle?: string } = {}): string {
  const g = job.scenes;
  const keys = g.map((s) => s.key).join(', ');
  const styleName = job.style === 'B' ? '스타일 B(연필 선화 + 포인트 색 하나)' : '스타일 A(세밀화 + 원예 도해)';
  return [
    `당신은 나무 정원 유튜브 롱폼(가로 10분)의 문장 그림 담당이다. 낭독 문장 하나마다 그 문장이 말하는 것을 ${styleName} 키트 부품으로 그려 움직이는 Remotion 장면 파일(.tsx)을 이 폴더에 만든다.`,
    '장면은 화면 전체(1920×1080)를 쓴다. 아래 18%(y ≥ 886)에는 자막 띠가, 왼쪽 위에는 장 이름이 따로 그려진다 — 장면은 그 두 곳에 아무것도 그리지 않고, 자막을 다시 쓰지 않는다.',
    '사람은 보고 있지 않다 — 질문하지 말고 끝까지 스스로 판단한다.',
    ...(o.episodeTitle ? [`[이 편] ${o.episodeTitle}`] : []),
    '',
    '[만들 장면] (job.json 에도 같은 정보 — words 는 단어별 말하는 시각 어림(초))',
    ...g.map((s) => [
      `- ${s.key} → 파일 ${s.file} | 길이 ${s.frames}프레임(${s.seconds}초) | 장: ${s.chapterTitle}${s.species.length ? ` (수종 ${s.species.join('·')})` : ''} | ${s.footage}`,
      `  문장: ${s.narration}`,
      ...(s.full?.insetRequired ? ['  ★ 이 장의 실촬영 지정 장면 — 문장에서 실제 모습·크기·상태를 말하는 박자에 <FootageInset footage={footage} …/> 를 반드시 한 번 띄운다(최소 3초).'] : []),
      ...(s.prev ? [`  (앞 문장: ${s.prev})`] : []),
      ...(s.next ? [`  (뒤 문장: ${s.next})`] : []),
    ].join('\n')),
    ...(job.species?.length ? [
      '',
      '[이 묶음 수종 — 식물은 이 프리셋으로만 그린다(임의 모양·다른 수종 흉내 금지)]',
      ...job.species.map((sp) => `- ${sp.nameKo}: ${sp.use}${sp.note ? ` — ${sp.note}` : ''}${sp.refs.length || sp.ext?.length ? `\n  실물 대조용 사진 — 우리 실촬영: ${sp.refs.length ? sp.refs.join(', ') : '없음'}${sp.ext?.length ? ` / 공개 도감 사진(출처 기록됨): ${sp.ext.map((x) => `${PART_KO[x.part]} ${x.file}`).join(', ')}` : ''}` : ''}`),
      '그리기 전에 실물 대조용 사진을 Read 로 한 번 열어 잎(모양·가장자리·나는 방식)·꽃·열매·수형·껍질을 보고, 미리보기에서 그 모습과 다르면 고친다. 계절은 문장의 때를 따른다(사진의 계절이 아니라).',
      ...(job.species.some((sp) => sp.ext?.length) ? ['공개 도감 사진은 우리 실촬영에 없는 부위(수피·꽃·겨울 모습·묘목 등)를 대조하는 내부 참고다 — 형태만 보고 그린다. 사진을 장면에 넣거나 따라 베끼지 않는다.'] : []),
    ] : []),
    '',
    '[이 파이프라인의 규칙 — 아래 키트 문서보다 우선]',
    "- import 는 `./_kit`(키트 전부 + FullStage·FootageInset·박자 도우미·FullSceneProps), `react`, `remotion` 만. _kit.ts·job.json·check.sh·preview.sh 는 고치지 않는다.",
    '- 파일 하나 = 기본 내보내기 컴포넌트 하나(export default function Scene({ durationInFrames, words, footage }: FullSceneProps)), <FullStage frames={durationInFrames} …> 무대 안에 그린다.',
    `- 화면 글자는 그 문장에 나온 말만(요약·새 사실·다른 문장의 말 금지). 라벨 ${MAX_LABELS}개 이하, 한글 라벨 ${LABEL_MAX_KO}자·숫자 라벨 ${LABEL_MAX_NUMERIC}자 이하(공백 제외). 라벨의 숫자는 문장에 나온 숫자만. 라벨은 맨 위 상수(const L1 = '…')로, 키트 라벨 부품으로 labels 층에만. <text> 직접 쓰기 금지.`,
    '- 좌표는 화면 픽셀(1920×1080). 그림·라벨은 안전 상자 x 90~1830, y 120~860 안. 끼움 카드도 카드 아래 끝(y + h/2 + 9)이 860 을 넘지 않게.',
    '- 포인트 색은 지금 낭독이 말하는 것에만 — 그 말을 하는 박자에 켜고(hi·color·soilHi 등) 박자가 끝나면 끈다(until·beatInOut). 한 화면에 포인트 색 덩어리는 하나(많아야 둘).',
    '- 실촬영 끼움 카드(FootageInset): 실촬영이 있는 장면에서만, 문장이 실제 모습·상태·크기·색·질감을 말할 때만. 주인공 그림을 가리지 않는 빈 쪽에(그림을 반대쪽으로 비켜 그린다). 실촬영이 없다고 적힌 장면은 쓰지 않는다.',
    '- SVG id·부품 id 는 장면 키 접두사: s007 장면이면 `s007-glow`. url(#…) 은 그 접두사나 키트 공용 a-·b- 만. 부품 seed 는 모양을 정한다 — 같은 장 이웃 장면과 같은 나무를 이어 그리면 같은 seed·age·h(장 이름으로: `hardiness-big`), 한 장면 안의 두 나무는 서로 다른 seed.',
    '- 결정성: Math.random·Date·fetch·이미지·외부 주소·<filter> 금지. 무작위는 random(\'시드\')(remotion). 모든 움직임은 useCurrentFrame() 의 함수.',
    '- 문장이 말하는 순서대로 나타나게 — atFromWords(words, 낱말, fps, 기본프레임) 로 그 말을 하는 순간에 맞춘다(기본프레임은 문장 속 위치 비율로).',
    '- 같은 장의 이웃 장면과 일관되게: 같은 나무·땅은 같은 부품·나이·크기 비율로. 앞뒤 문장을 읽고 이어지는 그림을 만들되, 이번 문장이 새로 말하는 것을 주인공으로(같은 그림 반복 금지). 화면을 넓게 쓴다 — 주인공은 크게.',
    '- 사람 얼굴·브랜드·글씨 간판 금지. 수종 모양은 키트 부품(Tree·Leaf·Persimmon 등)으로만.',
    '',
    '[절차] 장면마다:',
    '1. Write 로 sNNN.tsx 를 쓴다.',
    '2. Bash `./check.sh sNNN` — 빠른 검사와 타입 검사. JSON 의 problems 가 비어야 한다.',
    '3. Bash `./preview.sh sNNN` — 20%·55%·90% 시점 스틸 세 장(장 이름·자막 띠까지 최종 모습)을 붙인 preview/sNNN.png + 자막 띠 침범 검사. 반드시 Read 로 열어 본다: 문장을 그림으로 알아볼 수 있나, 겹침·잘림·빈 화면·글자 가독성, 끼움 카드가 주인공을 가리지 않나, 박자 순서.',
    '4. 문제가 있으면 Edit 로 고치고 2~3 을 다시(장면당 고침 최대 2번). 그래도 안 되면 다음 장면으로.',
    `5. 묶음 장면(${keys})을 모두 끝낸다. 한 장면에 너무 오래 매달리지 않는다(턴 수에 한도가 있다).`,
    '',
    '[끝] 마지막 줄은 JSON 한 줄만: {"ok":true,"scenes":[{"key":"s007","idea":"한 줄 설명","inset":true}]} (검사를 통과 못 한 장면이 있으면 ok:false 와 사유).',
    '',
    '────────── 장면 키트 문서 ──────────',
    kitApi,
  ].join('\n');
}
