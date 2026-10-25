import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REDO_BATCH_MAX, buildScenes, sessionLimitReset, type AgentRunInput, type SceneDeps } from './longformScenes';
import type { SceneJob } from '../longform/sceneJob';
import type { TimedSegment } from '../longform/timeline';

// 전 구간 가짜 에이전트(Claude Code CLI 를 띄우지 않는다)·가짜 tsc·가짜 스틸 — 빠른 검사(lint)·파일·등록표·키 기록은 진짜.
const REPO = path.resolve('.');
const goodScene = (key: string) => `import React from 'react';
import { SceneStage, Planter, type SceneProps } from './_kit';
export default function Scene({ durationInFrames }: SceneProps) {
  return <SceneStage frames={durationInFrames}><Planter id="${key}-pot" x={500} y={470} /></SceneStage>;
}
`;

function episode(chapters: Array<[string, number]>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-scenes-'));
  const segments: TimedSegment[] = [];
  for (const [ch, n] of chapters) for (let i = 0; i < n; i++) {
    const id = `${ch}-${String(i + 1).padStart(2, '0')}`;
    segments.push({ id, chapter: ch, chapterTitle: `${ch} 장`, narration: `${ch} 장의 ${i + 1}번째 문장입니다.`, audio: `${id}.mp3`, startFrame: segments.length * 150, frames: 150, captions: [], shot: { segId: id, cardOnly: true } });
  }
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ segments, chapterStarts: [], totalFrames: segments.length * 150 }));
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ title: '시험 편', chapters: chapters.map(([ch]) => ({ id: ch, title: `${ch} 장`, species: [], segments: segments.filter((s) => s.chapter === ch).map((s) => ({ id: s.id, narration: s.narration })) })) }));
  return { dir, segments };
}

function deps(over: Partial<SceneDeps> & { write?: (job: SceneJob, o: AgentRunInput) => void } = {}): SceneDeps & { agent: ReturnType<typeof vi.fn> } {
  const agent = vi.fn(async (o: AgentRunInput) => {
    const job = JSON.parse(fs.readFileSync(path.join(o.workDir, 'job.json'), 'utf8')) as SceneJob;
    if (over.write) over.write(job, o);
    else for (const s of job.scenes) fs.writeFileSync(path.join(o.workDir, s.file), goodScene(s.key));
    return { exit: 0, aborted: false, turns: 20, costUsd: 2.5, durationSec: 60 };
  });
  return {
    repo: REPO,
    runAgent: agent,
    typecheck: async (files) => new Map(files.map((f) => [path.resolve(f), []])),
    renderStills: async (o) => new Map(o.items.map((it) => { fs.mkdirSync(path.dirname(it.output), { recursive: true }); fs.writeFileSync(it.output, 'png'); return [it.id, null] as [string, string | null]; })),
    tile: vi.fn(async (_files: readonly string[], out: string) => { fs.writeFileSync(out, 'jpg'); }),
    mediaSpecies: () => undefined,
    concurrency: 3, budgetUsd: 60, maxTurns: 90, batchTimeoutMs: 1000,
    log: () => {},
    ...over,
    agent,
  } as SceneDeps & { agent: ReturnType<typeof vi.fn> };
}

const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

describe('buildScenes — 묶음·세션·사후 검사·등록표', () => {
  it('장 경계 묶음, 사후 검사(빠른 검사·타입·렌더) 탈락은 장면 없이, 키·등록표·보고·대조표', async () => {
    const { dir, segments } = episode([['a', 6], ['b', 4]]);
    const d = deps({
      write: (job, o) => {
        for (const s of job.scenes) {
          if (s.key === 's004') continue; // 쓰지 않음
          const src = s.key === 's001' ? goodScene(s.key).replace('return <', 'const r = Math.random();\n  return <') : goodScene(s.key);
          fs.writeFileSync(path.join(o.workDir, s.file), src);
        }
      },
      typecheck: async (files) => new Map(files.map((f) => [path.resolve(f), f.endsWith('s002.tsx') ? ['s002.tsx:3 TS2322 형식 오류'] : []])),
      renderStills: async (o) => new Map(o.items.map((it) => [it.id, it.sceneKey === 's003' && it.id.endsWith('0.9') ? 'boom' : null] as [string, string | null])),
    });
    const r = await buildScenes(dir, segments, undefined, d);
    expect(d.agent).toHaveBeenCalledTimes(3);
    const batchKeys = d.agent.mock.calls.map((c) => readJson(path.join((c[0] as AgentRunInput).workDir, 'job.json')).scenes.map((s: { key: string }) => s.key));
    expect(batchKeys).toEqual([['s000', 's001', 's002', 's003', 's004', 's005'], ['s006', 's007', 's008', 's009'], ['s004']]); // 빠진 s004 한 번 더(t01)
    expect(r.built).toBe(6);
    expect(r.costUsd).toBe(7.5); // 2묶음 + t01
    expect(r.entryPoint).toBe(path.join(dir, 'remotion-entry', 'index.ts'));
    const report = readJson(path.join(dir, 'scenes', 'report.json'));
    const why = Object.fromEntries(report.failed.map((f: { key: string; reason: string }) => [f.key, f.reason]));
    expect(why.s001).toContain('Math.random');
    expect(why.s002).toContain('타입');
    expect(why.s003).toContain('렌더 오류: boom');
    expect(why.s004).toContain('파일을 쓰지 않음');
    expect(report.perBatch.b01).toMatchObject({ turns: 20, costUsd: 2.5, durationSec: 60 });
    const registry = fs.readFileSync(path.join(dir, 'scenes', 'registry.ts'), 'utf8');
    expect(registry).toContain('= { s000, s005, s006, s007, s008, s009 };');
    const tl = readJson(path.join(dir, 'timeline.json'));
    expect(tl.segments.map((s: { scene?: string }) => s.scene ?? null)).toEqual(['s000', null, null, null, null, 's005', 's006', 's007', 's008', 's009']);
    const script = readJson(path.join(dir, 'script.json'));
    expect(script.chapters[0].segments[0].scene).toBe('s000');
    expect(script.chapters[0].segments[1].scene).toBeUndefined();
    expect(r.contact).toBe(path.join(dir, 'scenes', 'contact.jpg'));
    expect((d.tile as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(6);
    // 하네스: 작업 폴더 밖 job, 읽기 전용 셸·사본, 셸은 키 인자 하나만 넘긴다
    const work = path.join(dir, 'scenes', 'work', 'b01');
    expect(fs.existsSync(path.join(dir, 'scenes', 'work', 'b01.job.json'))).toBe(true);
    expect(fs.statSync(path.join(work, 'check.sh')).mode & 0o222).toBe(0);
    expect(fs.readFileSync(path.join(work, 'preview.sh'), 'utf8')).toContain('scene_preview.ts');
    expect(fs.readFileSync(path.join(work, 'agent-prompt.txt'), 'utf8')).toContain('장면 키트 API');
  });

  it('비용 상한을 넘으면 새 묶음을 띄우지 않는다 — 남은 장면은 폴백', async () => {
    const { dir, segments } = episode([['a', 2], ['b', 2], ['c', 2]]);
    const d = deps({ concurrency: 1, budgetUsd: 2 });
    const r = await buildScenes(dir, segments, undefined, d);
    expect(d.agent).toHaveBeenCalledTimes(1);
    expect(r.built).toBe(2);
    const report = readJson(path.join(dir, 'scenes', 'report.json'));
    expect(report.perBatch.b02.skipped).toContain('비용 상한');
    expect(report.failed.map((f: { key: string }) => f.key)).toEqual(['s002', 's003', 's004', 's005']);
  });

  it('동시 묶음 수를 지킨다', async () => {
    const { dir, segments } = episode([['a', 1], ['b', 1], ['c', 1], ['d', 1]]);
    let live = 0, peak = 0;
    const base = deps();
    const d = deps({
      concurrency: 2,
      runAgent: async (o) => { live++; peak = Math.max(peak, live); await new Promise((res) => setTimeout(res, 20)); const r = await base.runAgent(o); live--; return r; },
    });
    const r = await buildScenes(dir, segments, undefined, d);
    expect(peak).toBe(2);
    expect(r.built).toBe(4);
  });

  it('취소되면 남은 묶음을 건너뛰고 장면 없이 끝낸다', async () => {
    const { dir, segments } = episode([['a', 1], ['b', 1]]);
    const ac = new AbortController();
    const base = deps();
    const d = deps({ concurrency: 1, runAgent: async (o) => { const r = await base.runAgent(o); ac.abort(); return r; } });
    const r = await buildScenes(dir, segments, ac.signal, d);
    expect(r.built).toBe(0);
    expect(r.entryPoint).toBeUndefined();
    expect(readJson(path.join(dir, 'scenes', 'report.json')).perBatch.b02.skipped).toBe('취소됨');
  });

  it('하네스 셸을 바꾸면 그 묶음 장면을 버린다', async () => {
    const { dir, segments } = episode([['a', 2]]);
    const d = deps({
      write: (job, o) => {
        for (const s of job.scenes) fs.writeFileSync(path.join(o.workDir, s.file), goodScene(s.key));
        fs.chmodSync(path.join(o.workDir, 'check.sh'), 0o755);
        fs.writeFileSync(path.join(o.workDir, 'check.sh'), '#!/bin/bash\necho ok\n');
      },
    });
    const r = await buildScenes(dir, segments, undefined, d);
    expect(r.built).toBe(0);
    expect(readJson(path.join(dir, 'scenes', 'report.json')).failed[0].reason).toContain('변조');
  });

  it('번들이 실패하면 장면 없이(진입점 없음)', async () => {
    const { dir, segments } = episode([['a', 1]]);
    const r = await buildScenes(dir, segments, undefined, deps({ renderStills: async () => { throw new Error('webpack'); } }));
    expect(r).toMatchObject({ built: 0 });
    expect(r.entryPoint).toBeUndefined();
    expect(readJson(path.join(dir, 'timeline.json')).segments[0].scene).toBeUndefined();
  });
});

describe('buildScenes — 디자이너 기억·검토 뒤 다시 그리기(2026-10-23)', () => {
  it('묶음 지시문 끝에 디자이너 기억, 묶음마다 activity 한 줄', async () => {
    const { dir, segments } = episode([['a', 2], ['b', 1]]);
    const activity = vi.fn();
    const d = deps({ designerBrief: () => '[디자이너 기억] 비유를 글자 그대로 그리지 않는다', activity });
    await buildScenes(dir, segments, undefined, d);
    const prompt = fs.readFileSync(path.join(dir, 'scenes', 'work', 'b01', 'agent-prompt.txt'), 'utf8');
    expect(prompt.trimEnd().endsWith('[디자이너 기억] 비유를 글자 그대로 그리지 않는다')).toBe(true);
    expect(activity).toHaveBeenCalledTimes(2);
    expect(activity.mock.calls[0]![0]).toContain('b01 s000~s001');
  });

  it('검토가 고른 장면만 한 묶음(r01)으로 다시 그리고, 통과하면 바꾼다 — review.json 기록', async () => {
    const { dir, segments } = episode([['a', 3]]);
    const review = vi.fn(async (o: { items: Array<{ key: string; still?: string; labels: string[] }> }) => {
      expect(o.items.map((i) => i.key)).toEqual(['s000', 's001', 's002']);
      expect(o.items[0]!.still).toBe(path.join(dir, 'scenes', 'stills', 's000_55.png'));
      return { redo: [{ key: 's001', reason: '동전을 그렸다 — 뿌리의 양분을 그려라' }, { key: 'zzz', reason: '모르는 키' }], mode: 'vision' as const, checked: 3 };
    });
    const d = deps({
      review,
      write: (job, o) => {
        for (const s of job.scenes) {
          const seeded = fs.existsSync(path.join(o.workDir, s.file));
          fs.writeFileSync(path.join(o.workDir, s.file), seeded ? goodScene(s.key).replace('x={500}', 'x={520}') : goodScene(s.key));
        }
      },
    });
    const r = await buildScenes(dir, segments, undefined, d);
    expect(review).toHaveBeenCalledTimes(1);
    expect(d.agent).toHaveBeenCalledTimes(2);
    const redoCall = d.agent.mock.calls[1]![0] as AgentRunInput;
    expect(redoCall.batch).toBe('r01');
    expect(redoCall.prompt).toContain('s001: 동전을 그렸다');
    expect(readJson(path.join(redoCall.workDir, 'job.json')).scenes.map((s: { key: string }) => s.key)).toEqual(['s001']);
    expect(r.built).toBe(3);
    expect(r.review).toEqual({ redo: 1, redone: 1 });
    expect(r.costUsd).toBe(5);
    expect(fs.readFileSync(path.join(dir, 'scenes', 's001.tsx'), 'utf8')).toContain('x={520}');
    const rec = readJson(path.join(dir, 'scenes', 'review.json'));
    expect(rec).toMatchObject({ checked: 3, mode: 'vision', redo: [{ key: 's001', result: 'redone' }] });
    expect(readJson(path.join(dir, 'scenes', 'report.json')).perBatch.r01.keys).toEqual(['s001']);
  });

  it('다시 그린 장면이 검사에서 떨어지면 원래 장면으로 되돌린다(장면 수 그대로)', async () => {
    const { dir, segments } = episode([['a', 2]]);
    let round = 0;
    const d = deps({
      review: async () => ({ redo: [{ key: 's000', reason: '계절이 안 맞는다' }], mode: 'text' as const, checked: 2 }),
      write: (job, o) => {
        round++;
        for (const s of job.scenes) fs.writeFileSync(path.join(o.workDir, s.file), round === 1 ? goodScene(s.key) : goodScene(s.key).replace('return <', 'const r = Math.random();\n  return <'));
      },
    });
    const r = await buildScenes(dir, segments, undefined, d);
    expect(r.built).toBe(2);
    expect(r.review).toEqual({ redo: 1, redone: 0 });
    expect(fs.readFileSync(path.join(dir, 'scenes', 's000.tsx'), 'utf8')).not.toContain('Math.random');
    const rec = readJson(path.join(dir, 'scenes', 'review.json'));
    expect(rec.redo[0]).toMatchObject({ key: 's000', result: 'kept' });
    expect(rec.redo[0].why).toContain('검사에서 떨어짐');
    expect(fs.readFileSync(path.join(dir, 'scenes', 'registry.ts'), 'utf8')).toContain('s000, s001');
    expect(readJson(path.join(dir, 'scenes', 'report.json')).failed).toEqual([]);
  });

  it('검토가 던지거나 비면 첫 그림 그대로(fail-open), 비용 상한이면 다시 그리지 않는다', async () => {
    const a = episode([['a', 1]]);
    const r1 = await buildScenes(a.dir, a.segments, undefined, deps({ review: async () => { throw new Error('llm down'); } }));
    expect(r1.built).toBe(1);
    expect(readJson(path.join(a.dir, 'scenes', 'review.json')).skipped).toContain('llm down');
    const b = episode([['a', 1]]);
    const r2 = await buildScenes(b.dir, b.segments, undefined, deps({ review: async () => null }));
    expect(r2).toMatchObject({ built: 1, review: { redo: 0, redone: 0, skipped: '검토 응답 없음' } });
    const c = episode([['a', 1]]);
    const d3 = deps({ budgetUsd: 1, review: async () => ({ redo: [{ key: 's000', reason: 'x' }], mode: 'vision' as const, checked: 1 }) });
    const r3 = await buildScenes(c.dir, c.segments, undefined, d3);
    expect(d3.agent).toHaveBeenCalledTimes(1);
    expect(r3.review?.skipped).toContain('비용 상한');
  });
});

describe('sceneLabels', () => {
  it('맨 위 const L… 상수만', async () => {
    const { sceneLabels } = await import('./longformScenes');
    expect(sceneLabels("const L1 = '뿌리';\nconst L2 = \"양분\";\nconst GROUND = 600;\nconst label = 'x';")).toEqual(['뿌리', '양분']);
  });
});

describe('buildScenes — 전체 화면(기본값, 2026-10-23)', () => {
  const fullScene = (key: string, inset: boolean) => `import React from 'react';
import { FootageInset, FullStage, Tree, EP_SPECIES, type FullSceneProps } from './_kit';
export default function Scene({ durationInFrames, footage }: FullSceneProps) {
  return <FullStage frames={durationInFrames}${inset ? ' overlay={<FootageInset footage={footage} x={1450} y={470} at={10} />}' : ''}><Tree x={650} y={780} h={560} seed="${key}-t" species={EP_SPECIES.apple} /></FullStage>;
}
`;
  it('주인공 수종 끼움 카드(빌려 오기)·insets.json·묶음 수종 표·실물 사진 복사·_kit 의 EP_SPECIES·검토에 실물 사진', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-scenes-full-'));
    const mk = (id: string, ch: string, narration: string, clip?: string): TimedSegment => ({
      id, chapter: ch, chapterTitle: `${ch} 장`, narration, audio: `${id}.mp3`, startFrame: 0, frames: 150, captions: [],
      ...(clip ? { clip: `${id}.mp4`, shot: { segId: id, mediaId: clip, file: '/v.mp4', startSec: 0.5, seconds: 5 } } : { shot: { segId: id, cardOnly: true } }),
    });
    const segments = [mk('intro-01', 'intro', '올가을 고민입니다.', 'm_pear'), mk('intro-02', 'intro', '다 자라면 잎이 넓고 열매가 큽니다.'), mk('apple-01', 'apple', '사과나무 줄기를 봅니다.', 'm_apple'), mk('apple-02', 'apple', '사과나무 잎입니다.', 'm_apple')];
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ segments, chapterStarts: [], totalFrames: 600 }));
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ title: '사과나무 편', heroSpecies: '사과나무', species: ['사과나무', '배나무'], chapters: [
      { id: 'intro', title: 'intro 장', species: [], segments: segments.slice(0, 2).map((s) => ({ id: s.id, narration: s.narration })) },
      { id: 'apple', title: 'apple 장', species: ['사과나무'], segments: segments.slice(2).map((s) => ({ id: s.id, narration: s.narration })) },
    ] }));
    // 수종 형태 단계 결과(가짜) — 사과나무 편 전용 프리셋 + 실물 사진 2장
    fs.mkdirSync(path.join(dir, 'refs', '사과나무'), { recursive: true });
    for (const f of ['01.jpg', '02.jpg', 'commons-bark-1.jpg', 'commons-flower-1.jpg']) fs.writeFileSync(path.join(dir, 'refs', '사과나무', f), 'jpg');
    fs.mkdirSync(path.join(dir, 'species'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'species', 'index.json'), JSON.stringify({ at: 'x', hero: '사과나무', species: [{ nameKo: '사과나무', source: 'episode', id: 'apple', use: 'species={EP_SPECIES.apple}', confidence: { habit: 'high', leaf: 'low', flower: 'high', fruit: 'high' }, refs: ['refs/사과나무/01.jpg', 'refs/사과나무/02.jpg'], latin: 'Malus pumila', commons: [{ part: 'flower', file: 'refs/사과나무/commons-flower-1.jpg', license: 'CC BY-SA 4.0' }, { part: 'bark', file: 'refs/사과나무/commons-bark-1.jpg', license: 'CC BY 3.0' }] }] }));
    fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scenes', '_species.ts'), 'export const EP_SPECIES = {};\n');
    const kitApiPath = path.join(dir, 'KIT.md');
    fs.writeFileSync(kitApiPath, '키트 문서(시험)');
    const review = vi.fn(async () => ({ redo: [], mode: 'vision' as const, checked: 4 }));
    const d = deps({
      mediaSpecies: (id) => ({ m_apple: '사과나무', m_pear: '배나무' } as Record<string, string>)[id],
      write: (job, o) => { for (const s of job.scenes) fs.writeFileSync(path.join(o.workDir, s.file), fullScene(s.key, !!s.full?.insetRequired)); },
      review,
    });
    const r = await buildScenes(dir, segments, undefined, d, { stage: 'full', style: 'B', kitApiPath });
    expect(r.built).toBe(4);
    expect(r.entryPoint).toBe(path.join(dir, 'remotion-entry-full', 'index.ts'));
    const insets = readJson(path.join(dir, 'scenes', 'insets.json'));
    expect(insets['intro-01']).toBeUndefined(); // 배나무 영상 — 사과나무 편 도입에 끼우지 않는다
    expect(insets['intro-02']).toMatchObject({ species: '사과나무', borrowed: 'apple-01' });
    const report = readJson(path.join(dir, 'scenes', 'report.json'));
    expect(report.insetKeys).toEqual(['s001', 's002']);
    expect(report.insetMissing).toEqual([]);
    expect(report.insetBorrowed).toEqual({ 'intro-02': 'apple-01' });
    // 묶음 — 도입(수종 없음)도 주인공 수종 표·사진
    const jobs = d.agent.mock.calls.map((c) => readJson(path.join((c[0] as AgentRunInput).workDir, 'job.json')) as SceneJob);
    expect(jobs.map((j) => j.species?.map((x) => x.nameKo))).toEqual([['사과나무'], ['사과나무']]);
    const work = (jobs[0]!).workDir;
    expect(fs.existsSync(path.join(work, 'refs', '사과나무', '01.jpg'))).toBe(true);
    const prompt = fs.readFileSync(path.join(work, 'agent-prompt.txt'), 'utf8');
    expect(prompt).toContain('- 사과나무: species={EP_SPECIES.apple} — 이 편 전용 프리셋(서다인 작성) — 신뢰 낮음: leaf');
    expect(prompt).toContain('실물 대조용 사진 — 우리 실촬영: refs/사과나무/01.jpg, refs/사과나무/02.jpg / 공개 도감 사진(출처 기록됨): ');
    // 두 번째 묶음(사과나무 줄기 문장) — 수피 도감 사진이 먼저, 작업 폴더에 복사
    const work2 = (jobs[1]!).workDir;
    expect(jobs[1]!.species?.[0]?.ext?.[0]).toEqual({ part: 'bark', file: 'refs/사과나무/commons-bark-1.jpg' });
    expect(fs.existsSync(path.join(work2, 'refs', '사과나무', 'commons-bark-1.jpg'))).toBe(true);
    expect(prompt).toContain('키트 문서(시험)');
    expect(fs.readFileSync(path.join(work, '_kit.ts'), 'utf8')).toContain("export { EP_SPECIES } from '../../_species';");
    expect(fs.readFileSync(path.join(dir, 'scenes', '_kit.ts'), 'utf8')).toContain("export { EP_SPECIES } from './_species';");
    // 검토 — 장면 수종·실물 사진(절대 경로)
    const rv = (review.mock.calls[0] as unknown as [{ items: Array<{ species?: string[] }>; refs?: Array<{ file: string }> }])[0];
    expect(rv.items.map((it) => it.species)).toEqual([['사과나무'], ['사과나무'], ['사과나무'], ['사과나무']]);
    expect(rv.refs?.map((x) => x.file)).toEqual(['01.jpg', '02.jpg', 'commons-flower-1.jpg', 'commons-bark-1.jpg'].map((f) => path.join(dir, 'refs/사과나무', f)));
    expect((rv.refs as Array<{ part?: string }>).map((x) => x.part)).toEqual([undefined, undefined, 'flower', 'bark']);
  });

  it('_species.ts 를 고친 묶음은 버리고 원래대로 되돌린다', async () => {
    const { dir, segments } = episode([['a', 1]]);
    fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scenes', '_species.ts'), 'export const EP_SPECIES = {};\n');
    const kitApiPath = path.join(dir, 'KIT.md');
    fs.writeFileSync(kitApiPath, 'k');
    const d = deps({ write: (job, o) => { fs.writeFileSync(path.join(dir, 'scenes', '_species.ts'), 'evil'); for (const s of job.scenes) fs.writeFileSync(path.join(o.workDir, s.file), fullScene(s.key, false)); } });
    const r = await buildScenes(dir, segments, undefined, d, { stage: 'full', style: 'B', kitApiPath });
    expect(r.built).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'scenes', '_species.ts'), 'utf8')).toBe('export const EP_SPECIES = {};\n');
    expect(readJson(path.join(dir, 'scenes', 'report.json')).failed[0].reason).toContain('변조');
  });
});

// 구독 세션 한도(2026-10-25 대추나무 편 — 7·8장 24장면이 한도로 비었다).
describe('구독 세션 한도 — 기다렸다 빠진 장면만 다시', () => {
  const LIMIT = "You've hit your session limit · resets 3am (Asia/Seoul)";
  it('sessionLimitReset — 다음 그 시각, 못 읽으면 한 시간 뒤, 한도 문구가 아니면 null', () => {
    expect(sessionLimitReset(LIMIT, new Date(2026, 9, 25, 2, 10))).toEqual(new Date(2026, 9, 25, 3, 0));
    expect(sessionLimitReset(LIMIT, new Date(2026, 9, 25, 4, 0))).toEqual(new Date(2026, 9, 26, 3, 0));
    expect(sessionLimitReset("You've hit your limit · resets 11:30pm", new Date(2026, 9, 25, 20, 0))).toEqual(new Date(2026, 9, 25, 23, 30));
    expect(sessionLimitReset("You've hit your session limit", new Date(2026, 9, 25, 2, 0))).toEqual(new Date(2026, 9, 25, 3, 0));
    expect(sessionLimitReset('{"ok":true}', new Date())).toBeNull();
    expect(sessionLimitReset(undefined, new Date())).toBeNull();
  });
  it('한도에 걸리면 남은 묶음을 띄우지 않고, 풀릴 때까지 기다린 뒤 빠진 장면만 다시 그린다', async () => {
    const { dir, segments } = episode([['a', 6], ['b', 6], ['c', 6]]);
    let limited = false;
    const sleep = vi.fn(async () => {});
    const d = deps({ concurrency: 1, now: () => new Date(2026, 9, 25, 2, 0), sleep });
    d.runAgent = vi.fn(async (o: AgentRunInput) => {
      const job = JSON.parse(fs.readFileSync(path.join(o.workDir, 'job.json'), 'utf8')) as SceneJob;
      if (job.scenes[0]!.key === 's006' && !limited) {
        limited = true;
        fs.writeFileSync(path.join(o.workDir, job.scenes[0]!.file), goodScene(job.scenes[0]!.key)); // 한 장 쓰고 죽음
        return { exit: 1, aborted: false, turns: 10, costUsd: 1, durationSec: 30, tail: LIMIT };
      }
      for (const sc of job.scenes) fs.writeFileSync(path.join(o.workDir, sc.file), goodScene(sc.key));
      return { exit: 0, aborted: false, turns: 20, costUsd: 2.5, durationSec: 60 };
    });
    const r = await buildScenes(dir, segments, undefined, d);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((sleep.mock.calls[0] as unknown as [number])[0]).toBe(60 * 60_000 + 3 * 60_000); // 02:00 → 03:00 + 여유 3분
    const calls = (d.runAgent as ReturnType<typeof vi.fn>).mock.calls.map((c) => readJson(path.join((c[0] as AgentRunInput).workDir, 'job.json')).scenes.map((x: { key: string }) => x.key));
    expect(calls).toHaveLength(4); // b01 · b02(한도) · (b03 안 띄움) · 다시 2묶음
    expect(calls[2]).toEqual(['s007', 's008', 's009', 's010', 's011']); // 이미 쓴 s006 은 빼고
    expect(calls[3]).toEqual(['s012', 's013', 's014', 's015', 's016', 's017']);
    expect(r.built).toBe(18);
    const rep = readJson(path.join(dir, 'scenes', 'report.json'));
    expect(rep.perBatch.b03.skipped).toContain('구독 세션 한도');
    expect(rep.failed).toEqual([]);
  });
  it('풀리는 시각이 너무 멀면 기다리지 않고 장면 없이', async () => {
    const { dir, segments } = episode([['a', 6], ['b', 6]]);
    const sleep = vi.fn(async () => {});
    const d = deps({ concurrency: 1, now: () => new Date(2026, 9, 25, 4, 0), sleep }); // 다음 3시 = 23시간 뒤
    d.runAgent = vi.fn(async () => ({ exit: 1, aborted: false, turns: 1, costUsd: 0, durationSec: 2, tail: LIMIT }));
    const r = await buildScenes(dir, segments, undefined, d);
    expect(sleep).not.toHaveBeenCalled();
    expect(r.built).toBe(0);
    expect(readJson(path.join(dir, 'scenes', 'report.json')).failed[0].reason).toBe('구독 세션 한도로 파일 없음');
  });
  it('턴 상한으로 빠진 장면은 절반 크기 묶음(tNN)으로 한 번 더, 또 빠지면 사유는 턴 상한', async () => {
    const { dir, segments } = episode([['a', 8]]);
    const d = deps({ concurrency: 1 });
    d.runAgent = vi.fn(async (o: AgentRunInput) => {
      const job = JSON.parse(fs.readFileSync(path.join(o.workDir, 'job.json'), 'utf8')) as SceneJob;
      if (job.scenes.length === 8) { // 첫 묶음 — 앞 2장만 쓰고 턴 소진
        for (const sc of job.scenes.slice(0, 2)) fs.writeFileSync(path.join(o.workDir, sc.file), goodScene(sc.key));
        return { exit: 1, aborted: false, turns: 91, costUsd: 12, durationSec: 900 };
      }
      for (const sc of job.scenes) if (sc.key !== 's007') fs.writeFileSync(path.join(o.workDir, sc.file), goodScene(sc.key));
      return { exit: 0, aborted: false, turns: 50, costUsd: 4, durationSec: 600 };
    });
    const r = await buildScenes(dir, segments, undefined, d);
    const calls = (d.runAgent as ReturnType<typeof vi.fn>).mock.calls.map((c) => readJson(path.join((c[0] as AgentRunInput).workDir, 'job.json')).scenes.map((x: { key: string }) => x.key));
    expect(REDO_BATCH_MAX).toBe(4);
    expect(calls).toEqual([['s000', 's001', 's002', 's003', 's004', 's005', 's006', 's007'], ['s002', 's003', 's004'], ['s005', 's006', 's007']]);
    expect(r.built).toBe(7);
    const rep = readJson(path.join(dir, 'scenes', 'report.json'));
    expect(Object.keys(rep.perBatch)).toEqual(['b01', 't01', 't02']);
    expect(rep.failed).toEqual([{ key: 's007', reason: '에이전트가 파일을 쓰지 않음' }]);
    // 다시 그린 묶음도 턴 상한이면 사유가 턴 상한
    const e2 = episode([['a', 3]]);
    const d2 = deps({ concurrency: 1 });
    d2.runAgent = vi.fn(async () => ({ exit: 1, aborted: false, turns: 91, costUsd: 1, durationSec: 60 }));
    await buildScenes(e2.dir, e2.segments, undefined, d2);
    expect(d2.runAgent).toHaveBeenCalledTimes(2);
    expect(readJson(path.join(e2.dir, 'scenes', 'report.json')).failed[0].reason).toBe('턴 상한 90 소진으로 파일 없음');
  });
  it('비용 상한이면 빠진 장면을 다시 그리지 않는다', async () => {
    const { dir, segments } = episode([['a', 4]]);
    const d = deps({ budgetUsd: 10 });
    d.runAgent = vi.fn(async () => ({ exit: 1, aborted: false, turns: 91, costUsd: 12, durationSec: 900 }));
    const r = await buildScenes(dir, segments, undefined, d);
    expect(d.runAgent).toHaveBeenCalledTimes(1);
    expect(r.built).toBe(0);
  });
  it('resume — 있는 장면 파일은 두고 빠진 장면만 그리고, 검사·키 기록은 전부', async () => {
    const { dir, segments } = episode([['a', 6], ['b', 4]]);
    fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(dir, 'scenes', `s00${i}.tsx`), goodScene(`s00${i}`));
    const d = deps();
    const r = await buildScenes(dir, segments, undefined, d, undefined, { resume: true });
    const calls = d.agent.mock.calls.map((c) => readJson(path.join((c[0] as AgentRunInput).workDir, 'job.json')).scenes.map((x: { key: string }) => x.key));
    expect(calls).toEqual([['s006', 's007', 's008', 's009']]);
    expect(r.built).toBe(10);
    expect(readJson(path.join(dir, 'timeline.json')).segments.map((x: { scene?: string }) => x.scene)).toEqual(['s000', 's001', 's002', 's003', 's004', 's005', 's006', 's007', 's008', 's009']);
  });
});
