/**
 * 혼합(H) 롱폼 견본 — 장면 단계(2026-10-23, 옵트인 견본. 본편 buildScenes 는 그대로 — 그 구조(묶음 세션·읽기 전용 하네스·변조 확인·사후 검사)를 작게 따라 했다).
 * types.json 의 card·diagram 세그먼트만 에이전트가 그린다(footage 는 결정적 — FootageFull). 갈래별 묶음(카드 묶음·도해 묶음, 각 ≤ 8, 동시 ≤ 3, heavy 모델).
 *  - card: 정보 카드 키트(KIT_API_H.md) — 흐린 실촬영 바탕 + 유리 카드. 글자는 문장 낱말만(검사).
 *  - diagram: 스타일 B 연필 도해(KIT_API_B.md, 읽기 전용 키트) — 구조만, 손·껍질 위주 구도 피함.
 * 에이전트: ./check.sh(빠른 검사+타입) → ./preview.sh(20·55·90% 스틸 + 자막 띠 침범) 를 Read 해 고친다.
 * 사후: scenes/ 로 옮겨 다시 검사(빠른 검사·tsc·55% 스틸·침범) → 통과한 것만 등록표(scenes/registry.ts)·진입점(remotion-entry-h). 기록 scenes/report-h.json.
 * 실행: tsx scripts/longform/hybrid_scenes.ts <편 폴더> [--dry] [--only card|diagram] [--max-turns N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG } from '../../src/config';
import { defaultSceneDeps, harnessScript, type AgentRun } from '../../src/orchestrator/longformScenes';
import { loadEpisodeScript, loadMediaVideos } from '../../src/longform/episode';
import { scenePromptFull } from '../../src/longform/sceneFull';
import { planBatches, sceneSpecs } from '../../src/longform/sceneJob';
import { CONTACT_AT, frameAt, renderSceneStills, tileStills, type StillItem } from '../../src/longform/scenePreview';
import { typecheckScenes } from '../../src/longform/sceneCheck';
import { zoneLeak } from '../../src/longform/sceneFull';
import type { Timeline } from '../../src/longform/timeline';
import { hybridExtra, hybridKitShim, hybridPublicFiles, lintHybrid, writeHybridEntry, type HJob, type HSpec, type HType } from './hybrid_lib';

const [dirArg] = process.argv.slice(2);
if (!dirArg) throw new Error('사용법: hybrid_scenes.ts <편 폴더> [--dry] [--only card|diagram] [--max-turns N]');
const dir = path.resolve(dirArg);
const repo = process.cwd();
const argv = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const dry = process.argv.includes('--dry');
const only = argv('--only') as HType | undefined;
const maxTurns = Number(argv('--max-turns') ?? CONFIG.longformSceneMaxTurns);

const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Timeline;
const types = JSON.parse(fs.readFileSync(path.join(dir, 'types.json'), 'utf8')) as { segments: Array<{ id: string; type: HType; reason: string }> };
const foot = JSON.parse(fs.readFileSync(path.join(dir, 'footage-h.json'), 'utf8')) as Record<string, { bg: string; fg?: string }>;
const typeOf = new Map(types.segments.map((s) => [s.id, s.type]));
const script = loadEpisodeScript(dir);
const chSpecies = Object.fromEntries(script.chapters.map((c) => [c.id, c.species ?? []]));
const species = new Map(loadMediaVideos(CONFIG.dataDir).filter((m) => m.species).map((m) => [m.id, m.species!]));
const chapterTotal = tl.chapterStarts.length;
const bySeg = new Map(tl.segments.map((s) => [s.id, s]));

const all: HSpec[] = sceneSpecs(tl.segments, chSpecies, (id) => species.get(id)).flatMap((sp) => {
  const t = typeOf.get(sp.segId);
  if (t !== 'card' && t !== 'diagram') return [];
  const s = bySeg.get(sp.segId)!;
  const bg = foot[sp.segId]?.bg;
  return [{
    ...sp, htype: t, captions: s.captions, chapterTotal,
    footage: t === 'card' ? '바탕 = 감나무 실촬영 흐림본(무대가 깐다)' : '실촬영 없음(끼움 카드 쓰지 않음)',
    full: { insetRequired: false, captions: s.captions, chapterTotal },
    ...(t === 'card' && bg ? { bg: { src: bg, startFrom: 0, durationInFrames: s.frames } } : {}),
  }];
});
const specs = only ? all.filter((s) => s.htype === only) : all;
const sceneDir = path.join(dir, 'scenes');
const clipsDir = path.join(dir, 'clips');
fs.mkdirSync(sceneDir, { recursive: true });

/** 혼합 영상 안에서 이웃 갈래 — 지시문에 같이 준다(앞뒤가 실촬영인지 카드인지 도해인지). */
const neighbor = (segId: string, d: -1 | 1): string => {
  const i = tl.segments.findIndex((s) => s.id === segId);
  const n = tl.segments[i + d];
  return n && n.chapter === tl.segments[i]!.chapter ? `${typeOf.get(n.id) === 'footage' ? '실촬영' : typeOf.get(n.id) === 'card' ? '정보 카드' : '연필 도해'}` : '장 경계';
};

function cardPrompt(job: HJob, kitApi: string): string {
  const keys = job.scenes.map((s) => s.key).join(', ');
  return [
    '당신은 한국어 숏폼·롱폼 모션그래픽 디자이너다. 나무 정원 유튜브 롱폼(가로 1920×1080)에서 정보 문장 하나마다 우리 숏폼 정보 카드("유리 + 알약")와 같은 모양·움직임의 카드 장면(Remotion .tsx)을 이 폴더에 만든다.',
    '이 영상은 문장마다 세 갈래 화면을 섞는다: 정보 카드(당신) · 연필 선화 도해 · 감나무 실촬영. 카드 바탕은 이 문장 구간의 감나무 실촬영 흐림본이다(무대가 깐다).',
    '아래 18%(y ≥ 886)에는 자막 띠가, 왼쪽 위에는 장 이름 알약이 따로 그려진다 — 카드는 그 두 곳을 비우고, 자막 문장을 통째로 다시 쓰지 않는다.',
    '사람은 보고 있지 않다 — 질문하지 말고 끝까지 스스로 판단한다.',
    `[이 편] ${script.title}`,
    '',
    '[만들 장면] (job.json 에도 같은 정보 — words 는 단어별 말하는 시각 어림(초))',
    ...job.scenes.map((s) => [
      `- ${s.key} → 파일 ${s.file} | 길이 ${s.frames}프레임(${s.seconds}초) | 장: ${s.chapterTitle} | 앞 화면: ${neighbor(s.segId, -1)} · 뒤 화면: ${neighbor(s.segId, 1)}`,
      `  문장: ${s.narration}`,
      `  갈래 사유: ${types.segments.find((x) => x.id === s.segId)?.reason ?? ''}`,
      ...(s.prev ? [`  (앞 문장: ${s.prev})`] : []),
      ...(s.next ? [`  (뒤 문장: ${s.next})`] : []),
    ].join('\n')),
    '',
    '[이 파이프라인의 규칙 — 키트 문서보다 우선]',
    "- import 는 `./_kit`, `react`, `remotion` 만. _kit.ts·job.json·check.sh·preview.sh 는 고치지 않는다.",
    '- 파일 하나 = 기본 내보내기 컴포넌트 하나(export default function Scene({ durationInFrames, words, footage }: FullSceneProps)), 반드시 <CardStage frames={durationInFrames} footage={footage} …> 무대 안에 카드 부품을 놓는다.',
    '- 카드 글자는 그 문장에 나온 말만(검사: 글자 두 개 묶음이 전부 문장에 있어야 통과). 숫자도 문장 숫자만. 글자는 맨 위 상수(const T1 = \'…\')로.',
    '- 숏폼 카드처럼 분명하게 움직인다: 카드가 떠오르고 → 줄·칸이 낭독 박자에 맞춰 차례로 들어오고 → 낭독이 짚는 줄로 포인트 색 강조가 옮겨 간다. 비교는 ✓ 쪽이 마지막에 튄다. 단계는 화살표가 그려진다.',
    '- 1080p 에서 한눈에 읽히는 크기(부품 기본 글자 크기 유지). 카드 아래 끝은 y 860 위.',
    '- 결정성: Math.random·Date·fetch·이미지·영상 태그·<filter>·<text> 금지. id 를 쓰면 장면 키 접두사(s003-…).',
    '',
    '[절차] 장면마다:',
    '1. Write 로 sNNN.tsx 를 쓴다.',
    '2. Bash `./check.sh sNNN` — 빠른 검사와 타입 검사. JSON 의 problems 가 비어야 한다.',
    '3. Bash `./preview.sh sNNN` — 20%·55%·90% 시점 스틸 세 장(장 이름 알약·자막 띠까지 최종 모습)을 붙인 preview/sNNN.png + 자막 띠 침범 검사. 반드시 Read 로 열어 본다: 글자 가독성(1080p), 넘침·잘림·겹침, 카드가 너무 작거나 비어 보이지 않나, 박자 순서(20% 에 이미 첫 줄이 보이나), 자막 띠·장 이름과 간격.',
    '4. 문제가 있으면 Edit 로 고치고 2~3 을 다시(장면당 고침 최대 2번).',
    `5. 묶음 장면(${keys})을 모두 끝낸다.`,
    '',
    '[끝] 마지막 줄은 JSON 한 줄만: {"ok":true,"scenes":[{"key":"s003","idea":"한 줄 설명"}]} (검사를 통과 못 한 장면이 있으면 ok:false 와 사유).',
    '',
    '────────── 정보 카드 키트 문서(KIT_API_H.md) ──────────',
    kitApi,
  ].join('\n');
}

const DIAGRAM_NOTE = [
  '────────── 혼합(H) 영상 추가 규칙 — 위 모든 것보다 우선 ──────────',
  '- 이 영상은 문장마다 정보 카드·연필 도해·감나무 실촬영을 섞는다. 이 묶음은 "카메라로 찍을 수 없는 구조"(땅속 뿌리·저장 양분·접붙인 자리 단면·언 흙층·지도) 문장만이다 — 구조를 크게, 단면·투시로 보여 준다.',
  '- 손(Hand)·나무껍질 질감 위주 구도는 쓰지 않는다(키트 수리 중). 나무는 구조를 보여 주는 크기·나이로, 땅 단면(GroundSection)과 뿌리(roots·rootP·store) 중심.',
  '- 앞뒤 화면이 실촬영·카드일 수 있다 — 이 장면만으로 문장의 구조가 읽혀야 한다. 실촬영 끼움 카드(FootageInset)는 쓰지 않는다.',
].join('\n');

const deps = defaultSceneDeps();
const writeRO = (p: string, data: string, mode = 0o444) => { try { fs.unlinkSync(p); } catch { /* 없음 */ } fs.writeFileSync(p, data, { encoding: 'utf8', mode }); };

async function runBatch(name: string, b: HSpec[]): Promise<{ moved: string[]; run?: AgentRun; problem?: string }> {
  const workRoot = path.join(sceneDir, 'work');
  const work = path.join(workRoot, name);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const job: HJob = { batch: name, repo, workDir: work, fps: 30, clipsDir, scenes: b };
  const jobPath = path.join(workRoot, `${name}.job.json`);
  const jobText = JSON.stringify(job, null, 1);
  writeRO(jobPath, jobText);
  writeRO(path.join(work, 'job.json'), jobText);
  const kit = hybridKitShim(work, repo);
  writeRO(path.join(work, '_kit.ts'), kit);
  const checkSh = harnessScript(repo, 'hybrid_check.ts', jobPath);
  const previewSh = harnessScript(repo, 'hybrid_preview.ts', jobPath);
  writeRO(path.join(work, 'check.sh'), checkSh, 0o555);
  writeRO(path.join(work, 'preview.sh'), previewSh, 0o555);
  const isCard = b[0]!.htype === 'card';
  const prompt = isCard
    ? cardPrompt(job, fs.readFileSync(path.join(repo, 'remotion', 'longform', 'hybrid', 'KIT_API_H.md'), 'utf8'))
    : `${scenePromptFull({ scenes: b, style: 'B' }, fs.readFileSync(path.join(repo, 'remotion', 'longform', 'fullscreen', 'KIT_API_B.md'), 'utf8'), { episodeTitle: script.title })}\n\n${DIAGRAM_NOTE}`;
  fs.writeFileSync(path.join(work, 'agent-prompt.txt'), prompt);
  let run: AgentRun;
  if (dry) {
    for (const s of b) fs.writeFileSync(path.join(work, s.file), isCard ? DRY_CARD : DRY_DIAGRAM);
    for (const s of b.slice(0, 1)) {
      console.log('[dry] check', execFileSync(path.join(work, 'check.sh'), [s.key], { encoding: 'utf8' }).slice(0, 600));
      console.log('[dry] preview', execFileSync(path.join(work, 'preview.sh'), [s.key], { encoding: 'utf8', timeout: 300_000 }).slice(0, 800));
    }
    run = { exit: 0, aborted: false, durationSec: 0, costUsd: 0, turns: 0 };
  } else {
    run = await deps.runAgent({ batch: name, workDir: work, prompt, timeoutMs: 60 * 60_000, maxTurns });
  }
  console.log(`[장면] ${name} 세션 끝 — exit ${run.exit}${run.aborted ? '(시간 초과)' : ''} · 턴 ${run.turns ?? '?'} · $${(run.costUsd ?? 0).toFixed(2)} · ${run.durationSec}초`);
  const same = (f: string, want: string) => { try { return fs.readFileSync(path.join(work, f), 'utf8') === want; } catch { return false; } };
  if (!same('check.sh', checkSh) || !same('preview.sh', previewSh) || !same('_kit.ts', kit) || fs.readFileSync(jobPath, 'utf8') !== jobText) return { moved: [], run, problem: '하네스 파일 변조 감지 — 이 묶음 장면을 버림' };
  const moved: string[] = [];
  for (const s of b) {
    const src = path.join(work, s.file);
    if (!fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink()) continue;
    fs.copyFileSync(src, path.join(sceneDir, s.file));
    moved.push(s.key);
  }
  return { moved, run };
}

const DRY_CARD = `import React from 'react';
import { CardStage, InfoList, type FullSceneProps } from './_kit';

export default function Scene({ durationInFrames, footage }: FullSceneProps) {
  return (
    <CardStage frames={durationInFrames} footage={footage}>
      <InfoList items={['감나무']} at={[4]} hiAt={[10]} />
    </CardStage>
  );
}
`;
const DRY_DIAGRAM = `import React from 'react';
import { FullStage, GroundSection, Tree, type FullSceneProps } from './_kit';

export default function Scene({ durationInFrames }: FullSceneProps) {
  return (
    <FullStage frames={durationInFrames}>
      <GroundSection x0={200} x1={1700} y={620} depth={220} seed="dry-g">
        <Tree x={950} y={620} h={420} age="mature" seed="dry-t" season="winter" roots="wide" rootW={800} />
      </GroundSection>
    </FullStage>
  );
}
`;

// ── 실행 ──
const t0 = Date.now();
for (const s of specs) { try { fs.unlinkSync(path.join(sceneDir, s.file)); } catch { /* 없음 */ } }
const groups = (['card', 'diagram'] as const).map((t) => specs.filter((s) => s.htype === t)).filter((g) => g.length);
// 갈래마다 한 세션(장 경계를 넘어도 — 카드 모양·도해 붓질을 한 세션이 영상 전체에서 맞춘다), 8개 넘으면 고르게 쪼갠다.
const batches = groups.flatMap((g) => planBatches(g.map((s) => ({ ...s, chapterIndex: 0 }))).map((b, i) => ({ name: `${g[0]!.htype}${i + 1}`, b: b.map((x) => g.find((y) => y.key === x.key)!) })));
console.log(`[장면] ${specs.length}개(card ${specs.filter((s) => s.htype === 'card').length} · diagram ${specs.filter((s) => s.htype === 'diagram').length}) · 묶음 ${batches.length} · 동시 ${Math.min(3, batches.length)}${dry ? ' · dry' : ''}`);
const report = { at: new Date().toISOString(), dry, perBatch: {} as Record<string, unknown>, costUsd: 0, failed: [] as Array<{ key: string; reason: string }>, pass: [] as string[], zone: {} as Record<string, unknown>, durationMin: 0 };
const fail = new Map<string, string>();
let next = 0;
await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
  while (next < batches.length) {
    const { name, b } = batches[next++]!;
    try {
      const r = await runBatch(name, b);
      report.costUsd += r.run?.costUsd ?? 0;
      report.perBatch[name] = { keys: b.map((s) => s.key), turns: r.run?.turns, costUsd: r.run?.costUsd, durationSec: r.run?.durationSec, exit: r.run?.exit, tail: r.run?.tail, ...(r.problem ? { problem: r.problem } : {}) };
      for (const s of b) if (!r.moved.includes(s.key)) fail.set(s.key, r.problem ?? '에이전트가 파일을 쓰지 않음');
    } catch (e) {
      for (const s of b) fail.set(s.key, `묶음 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}));

// ── 사후 검사(에이전트를 믿지 않는다) ──
fs.writeFileSync(path.join(sceneDir, '_kit.ts'), hybridKitShim(sceneDir, repo));
const present = all.filter((s) => fs.existsSync(path.join(sceneDir, s.file)));
let pass = present.filter((s) => {
  const p = lintHybrid(fs.readFileSync(path.join(sceneDir, s.file), 'utf8'), s);
  if (p.length) fail.set(s.key, `검사: ${p.slice(0, 3).join(' / ')}`);
  return !p.length;
});
if (pass.length) {
  const tc = await typecheckScenes(pass.map((s) => path.join(sceneDir, s.file)), repo);
  pass = pass.filter((s) => { const e = tc.get(path.resolve(path.join(sceneDir, s.file))) ?? []; if (e.length) fail.set(s.key, `타입: ${e.slice(0, 2).join(' / ')}`); return !e.length; });
}
const stillDir = path.join(sceneDir, 'stills-h');
let entry = writeHybridEntry(dir, pass.map((s) => s.key), repo);
if (pass.length) {
  const items: StillItem[] = pass.flatMap((s) => [
    { id: s.key, sceneKey: s.key, durationInFrames: s.frames, words: s.words, frame: frameAt(s.frames, CONTACT_AT), output: path.join(stillDir, `${s.key}_55.png`), extra: hybridExtra(s) },
    { id: `${s.key}@probe`, sceneKey: s.key, durationInFrames: s.frames, words: s.words, frame: frameAt(s.frames, CONTACT_AT), output: path.join(stillDir, '.probe', `${s.key}.png`), extra: hybridExtra(s, true) },
  ]);
  const res = await renderSceneStills({ entryPoint: entry, outDir: path.join(sceneDir, '.render-h'), items, publicFiles: hybridPublicFiles(pass, clipsDir) });
  for (const s of pass) {
    if (res.get(`${s.key}@probe`) === null) {
      const leak = await zoneLeak(path.join(stillDir, '.probe', `${s.key}.png`)).catch(() => null);
      if (leak) { report.zone[s.key] = leak; if (leak.caption > 0.02 || leak.chapter > 0.02) res.set(s.key, `자막 띠·장 이름 자리 침범 ${(leak.caption * 100).toFixed(1)}%·${(leak.chapter * 100).toFixed(1)}%`); }
    }
  }
  pass = pass.filter((s) => { const e = res.get(s.key); if (e) fail.set(s.key, `렌더: ${e}`); return e === null; });
  entry = writeHybridEntry(dir, pass.map((s) => s.key), repo);
  if (pass.length) await tileStills(pass.map((s) => path.join(stillDir, `${s.key}_55.png`)), path.join(sceneDir, 'contact-h.jpg'), { cols: 4, width: 640, quality: 3 });
}
report.pass = pass.map((s) => s.key);
report.failed = all.filter((s) => !report.pass.includes(s.key)).map((s) => ({ key: s.key, reason: fail.get(s.key) ?? '그리지 않음' }));
report.costUsd = Math.round(report.costUsd * 100) / 100;
report.durationMin = Math.round((Date.now() - t0) / 6000) / 10;
fs.writeFileSync(path.join(sceneDir, 'report-h.json'), JSON.stringify({ ...report, keys: Object.fromEntries(all.map((s) => [s.segId, { key: s.key, type: s.htype }])) }, null, 2));
console.log(`[장면] 통과 ${pass.length}/${all.length} · $${report.costUsd} · ${report.durationMin}분 · 진입점 ${entry}`);
for (const f of report.failed) console.log(`  탈락 ${f.key}: ${f.reason}`);
