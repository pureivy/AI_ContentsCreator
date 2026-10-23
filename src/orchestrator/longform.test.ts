import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LongformStore, type LongformRecord } from '../content/longform';
import type { FactGateResult } from '../content/factGate';
import type { LongformDeps } from './longform';
import { beginLongformEpisode, episodeDirName, longformEpisodeRunning, runLongformEpisode } from './longform';
import type { TopicChoice } from '../longform/topic';
import type { LlmJSON } from '../longform/writer';
import { buildScenes, type AgentRunInput, type SceneDeps } from './longformScenes';
import { prepareSpecies } from '../longform/speciesPreset';
import type { SceneJob } from '../longform/sceneJob';

// 전 구간 가짜(LLM·ElevenLabs·STT·ffmpeg·Remotion·이미지·텔레그램) — 임시 폴더의 작은 데이터로 한 편을 끝까지 돌린다.
const SENT = '감나무는 잎이 진 뒤에 가지를 정리하면 나무가 덜 지치고 다음 해 열매도 고르게 답니다';
const SOURCE = `${SENT}. 사과나무도 잎이 진 뒤에 봅니다.`;

const TOPIC: TopicChoice = {
  topicKey: 'prune:감나무', topic: 'prune',
  anchor: { id: 'piece_a', title: '감나무 가지치기', species: '감나무', topic: 'prune', blogViews: 100, shortsViews: 2000, views: 2100 },
  pieces: ['piece_a', 'piece_b', 'piece_c', 'piece_d'].map((id) => ({ id, title: id, species: '감나무', topic: 'prune', blogViews: 1, shortsViews: 1, views: 2 })),
  reason: "조회 합산 1위 '감나무 가지치기'(블로그 100+숏폼 2,000) 중심, 같은 주제(가지치기) 글 4편 — 지난 롱폼과 겹치지 않음",
};

const writerJSON = () => ({
  title: '감나무 가지치기 총정리', ytKeyLine: '감나무 가지치기 핵심', ytHashtags: ['감나무', '가지치기'], keywords: ['가지'], species: ['감나무'],
  chapters: Array.from({ length: 7 }, (_, ci) => ({
    id: ci === 0 ? 'intro' : ci === 6 ? 'outro' : `ch${ci}`, title: `장 ${ci + 1}`, ytLabel: `감나무 가지치기 ${ci + 1}`, species: ci === 3 ? ['감나무'] : [],
    segments: Array.from({ length: 14 }, () => ({ narration: `${SENT}.` })),
  })),
});

const pass = (): FactGateResult => ({ status: 'pass', claims: [], unsupported: [], contradicted: [], unverified: [], repaired: false, checkedTs: '' });

function setup(over: Partial<LongformDeps> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-orch-'));
  const store = new LongformStore(root);
  const notifyReady = vi.fn(async (_r: LongformRecord) => true);
  const notifyFail = vi.fn(async () => 1);
  const llmJSON = vi.fn(async () => writerJSON()) as unknown as LlmJSON;
  const deps: Partial<LongformDeps> = {
    store, root,
    selectTopic: () => TOPIC,
    loadSources: async (ids) => ids.map((id) => ({ pieceId: id, title: id, body: SOURCE })),
    media: () => [{ id: 'm1', file: '/m/gam.mp4', kind: 'video', seconds: 600, species: '감나무' }],
    llmJSON,
    factGate: vi.fn(async () => pass()),
    assets: async () => ({
      synth: async (text: string) => Buffer.from(text),
      stt: async (mp3: Buffer) => mp3.toString(),
      probe: async () => 4,
      cut: async (_s: string, _a: number, _b: number, out: string) => { fs.writeFileSync(out, 'clip'); },
    }),
    render: async () => ({
      bundle: async () => 'serve',
      renderMedia: async (o) => { o.onProgress(0.5); o.onProgress(1); fs.writeFileSync(o.output, 'mp4'); },
      renderStill: async () => {},
      ffmpeg: async (args) => { fs.writeFileSync(args[args.length - 1]!, 'img'); },
      probe: async () => 4,
    }),
    layout: { stage: 'full', style: 'B' },
    buildScenes: vi.fn(async () => ({ built: 0 })),
    species: vi.fn(async () => ({ at: '', species: [] })),
    mediaSpecies: (id: string) => (id === 'm1' ? '감나무' : undefined),
    thumbnail: vi.fn(async (o: { dir: string }) => { fs.writeFileSync(path.join(o.dir, 'thumbnail.jpg'), 'jpg'); return { generated: true, state: 'ok' as const }; }),
    notifyReady, notifyFail,
    isBusy: () => null,
    sleep: async () => {},
    spendUsd: () => 0,
    now: () => new Date(2026, 9, 26, 0, 0),
    log: () => {},
    noteActivity: vi.fn(),
    ...over,
  };
  return { root, store, deps, notifyReady, notifyFail };
}

describe('runLongformEpisode — 가짜 부품으로 한 편 끝까지', () => {
  it('주제 → 대본 → 사실 → 낭독 → 배정 → 수종 형태 → 그림 → 렌더(전체 화면 B) → 썸네일 → ready + 텔레그램', async () => {
    const bundle = vi.fn(async (_o: { entryPoint: string }) => 'serve');
    const comps: Array<string | undefined> = [];
    const base = await setup().deps.render!();
    const { root, store, deps, notifyReady } = setup({ render: async () => ({ ...base, bundle, renderMedia: async (o) => { comps.push(o.composition); return base.renderMedia(o); } }) });
    const r = await runLongformEpisode({ brand: 'bionditree', deps });
    expect(r.ok).toBe(true);
    const rec = store.get(r.id)!;
    expect(rec.stage).toBe('ready');
    expect(rec.dir).toBe('2026-10-26-prune');
    expect(rec.progress).toBeUndefined();
    expect(rec.topicReason).toBe(TOPIC.reason);
    expect(rec.topicKey).toBe('prune:감나무');
    expect(rec.sourcePieceIds).toEqual(['piece_a', 'piece_b', 'piece_c', 'piece_d']);
    expect(rec.title).toBe('감나무 가지치기 총정리');
    expect(rec.ytTitle).toBe('감나무 가지치기 총정리');
    expect(rec.ytDescription).toContain('0:00 감나무 가지치기 1');
    expect(rec.ytTags).toContain('감나무');
    expect(rec.thumbState).toBe('ok');
    expect(rec.durationSec).toBeGreaterThan(0);
    expect(rec.costUsd).toBeGreaterThan(0); // ElevenLabs 글자 추정
    const dir = path.join(root, rec.dir);
    for (const f of ['script.json', 'script.txt', 'sources.md', 'factgate.json', 'pron.json', 'timeline.json', 'final.mp4', 'subtitles.srt', 'youtube.txt', 'report.md', 'thumbnail.jpg', 'props-full.json', 'remotion-entry-full/index.ts']) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
    expect(fs.existsSync(path.join(dir, 'props.json'))).toBe(false); // 종전 화면(panel) props 는 안 만든다
    expect(fs.readdirSync(path.join(dir, 'audio')).filter((f) => f.endsWith('.mp3'))).toHaveLength(98);
    const props = JSON.parse(fs.readFileSync(path.join(dir, 'props-full.json'), 'utf8'));
    expect(props.keywords).toEqual(['가지']);
    expect(props.style).toBe('B');
    // 주인공 수종 — 대본에 기록, 도입·마무리(수종 없는 장)에도 감나무 끼움 카드
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8')).heroSpecies).toBe('감나무');
    const bySeg = new Map(props.segments.map((x: { id: string; footage?: unknown }) => [x.id, x]));
    expect((bySeg.get('intro-01') as { footage?: unknown }).footage).toBeTruthy();
    expect((bySeg.get('outro-01') as { footage?: unknown }).footage).toBeTruthy();
    expect(fs.readFileSync(path.join(dir, 'report.md'), 'utf8')).toContain('전체 화면 스타일 B');
    expect(bundle.mock.calls[0]![0].entryPoint).toBe(path.join(dir, 'remotion-entry-full', 'index.ts'));
    expect(comps).toEqual(['LongFormFull']);
    expect(deps.species).toHaveBeenCalledTimes(1);
    expect(deps.buildScenes).toHaveBeenCalledTimes(1);
    expect((deps.buildScenes as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![3]).toEqual({ stage: 'full', style: 'B' });
    expect(notifyReady).toHaveBeenCalledTimes(1);
    expect(notifyReady.mock.calls[0]![0].stage).toBe('ready');
    expect(longformEpisodeRunning()).toBeNull();
  });

  it('종전 화면(LONGFORM_LAYOUT=panel) — 수종 형태 단계 없이, 장면 단계 진입점으로 LongForm 렌더(props.json), 에이전트 비용을 편 비용에', async () => {
    const bundle = vi.fn(async (_o: { entryPoint: string }) => 'serve');
    const base = setup();
    const baseRender = await base.deps.render!();
    const comps: Array<string | undefined> = [];
    const { root, store, deps } = setup({
      layout: { stage: 'panel' },
      buildScenes: vi.fn(async () => ({ built: 3, costUsd: 4.5, entryPoint: '/ep/remotion-entry/index.ts' })),
      render: async () => ({ ...baseRender, bundle, renderMedia: async (o) => { comps.push(o.composition); return baseRender.renderMedia(o); } }),
    });
    const r = await runLongformEpisode({ brand: 'b', deps });
    expect(r.ok).toBe(true);
    expect(bundle.mock.calls[0]![0].entryPoint).toBe('/ep/remotion-entry/index.ts');
    expect(comps).toEqual([undefined]); // 기본 'LongForm'
    expect(fs.existsSync(path.join(root, store.get(r.id)!.dir, 'props.json'))).toBe(true);
    expect(deps.species).not.toHaveBeenCalled();
    expect((deps.buildScenes as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![3]).toBeUndefined();
    expect(store.get(r.id)!.costUsd).toBeGreaterThanOrEqual(4.5);
  });

  it('전체 화면 dry run — 진짜 수종 형태 단계(서다인 가짜 LLM·가짜 ffmpeg)·진짜 장면 단계(가짜 세션·tsc·스틸)·진짜 전체 화면 렌더 배선', async () => {
    const REPO = path.resolve('.');
    const SENT2 = '사과나무도 잎이 진 뒤에 봅니다';
    const script = writerJSON();
    script.species = ['감나무', '사과나무'];
    script.chapters[6]!.segments[0] = { narration: `${SENT2}.` };
    const persimmon = JSON.parse(fs.readFileSync(path.join(REPO, 'remotion/longform/fullscreen/species/persimmon.json'), 'utf8'));
    const llmJSON = vi.fn(async (_m: string, _s: string, user: string) => (user.includes('[수종] 사과나무')
      ? { id: 'apple', profile: { ...persimmon, id: 'apple', nameKo: '사과나무', latin: 'Malus pumila', fruit: { type: 'pome', ratio: 0.9, sizeCm: [6, 9], bearing: 'single', months: [9, 10] } }, confidence: { habit: 'high', leaf: 'medium', flower: 'medium', fruit: 'high' } }
      : script)) as unknown as LlmJSON;
    const kitApiPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lf-kit-')), 'KIT.md');
    fs.writeFileSync(kitApiPath, '키트(시험)');
    const prompts: string[] = [];
    const sceneDeps: Partial<SceneDeps> = {
      repo: REPO, concurrency: 3, budgetUsd: 60, maxTurns: 90, batchTimeoutMs: 1000, log: () => {},
      mediaSpecies: (id) => ({ m1: '감나무', m2: '사과나무' } as Record<string, string>)[id],
      runAgent: async (o: AgentRunInput) => {
        prompts.push(o.prompt);
        const job = JSON.parse(fs.readFileSync(path.join(o.workDir, 'job.json'), 'utf8')) as SceneJob;
        for (const sc of job.scenes) {
          const inset = sc.full?.footage ? ' overlay={<FootageInset footage={footage} x={1450} y={470} at={10} />}' : '';
          fs.writeFileSync(path.join(o.workDir, sc.file), `import React from 'react';
import { FootageInset, FullStage, Tree, type FullSceneProps } from './_kit';
export default function Scene({ durationInFrames, footage }: FullSceneProps) {
  return <FullStage frames={durationInFrames}${inset}><Tree x={650} y={780} h={560} seed="${sc.key}-t" species="persimmon" /></FullStage>;
}
`);
        }
        return { exit: 0, aborted: false, turns: 5, costUsd: 0.5, durationSec: 1 };
      },
      typecheck: async (files) => new Map(files.map((f) => [path.resolve(f), []])),
      renderStills: async (o) => new Map(o.items.map((it) => { fs.mkdirSync(path.dirname(it.output), { recursive: true }); fs.writeFileSync(it.output, 'png'); return [it.id, null] as [string, string | null]; })),
      tile: async (_f, out) => { fs.writeFileSync(out, 'jpg'); },
    };
    const bundle = vi.fn(async (_o: { entryPoint: string; publicDir: string }) => 'serve');
    const comps: Array<string | undefined> = [];
    let rendered: { segments: Array<{ id: string; scene?: string; footage?: { src: string } }> } | undefined;
    const ffmpeg = async (args: string[]) => { fs.writeFileSync(args[args.length - 1]!, 'img'); };
    const base = await setup().deps.render!();
    const { root, store, deps, notifyReady } = setup({
      llmJSON,
      // 사과나무 영상이 조금 있다 — 주인공(감나무) 편의 일반 장에는 들어가지 않아야 한다.
      media: () => [{ id: 'm1', file: '/m/gam.mp4', kind: 'video', seconds: 600, species: '감나무' }, { id: 'm2', file: '/m/apple.mp4', kind: 'video', seconds: 30, species: '사과나무' }],
      mediaSpecies: (id) => ({ m1: '감나무', m2: '사과나무' } as Record<string, string>)[id],
      buildScenes: (dir, segs, signal, mode) => buildScenes(dir, segs, signal, sceneDeps, mode ? { ...mode, kitApiPath } : undefined),
      species: (o) => prepareSpecies({ ...o, repo: REPO, llm: llmJSON, model: 'm', ffmpeg }),
      render: async () => ({ ...base, bundle, renderMedia: async (o) => { comps.push(o.composition); rendered = o.inputProps as typeof rendered; return base.renderMedia(o); } }),
    });
    const r = await runLongformEpisode({ brand: 'bionditree', deps });
    expect(r.ok).toBe(true);
    const rec = store.get(r.id)!;
    expect(rec.stage).toBe('ready');
    const dir = path.join(root, rec.dir);
    // 수종 형태 — 감나무 내장, 사과나무 서다인 작성 + 실물 사진(감나무 영상에서만)
    const ix = JSON.parse(fs.readFileSync(path.join(dir, 'species', 'index.json'), 'utf8'));
    expect(ix.hero).toBe('감나무');
    expect(ix.species.map((e: { nameKo: string; source: string }) => `${e.nameKo}:${e.source}`)).toEqual(['감나무:builtin', '사과나무:episode']);
    expect(ix.species[0].refs.length).toBeGreaterThanOrEqual(3);
    expect(ix.species[1].refs).toHaveLength(4); // 사과나무 영상 1개에서 4장
    // 화면 — 사과나무 영상은 어느 세그먼트에도 배정되지 않았다(수종 장 없음, 일반 장은 주인공만)
    const shots = JSON.parse(fs.readFileSync(path.join(dir, 'footage.json'), 'utf8')).shots as Array<{ mediaId?: string }>;
    expect(shots.some((x) => x.mediaId === 'm2')).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'scenes', '_species.ts'), 'utf8')).toContain('apple:');
    // 장면 — 98장면 전부 통과, 장마다 지정 장면 하나(7장), 끼움 카드 없는 장 없음
    const rep = JSON.parse(fs.readFileSync(path.join(dir, 'scenes', 'report.json'), 'utf8'));
    expect(rep.built).toBe(98);
    expect(rep.insetKeys).toHaveLength(7);
    expect(rep.insetMissing).toEqual([]);
    expect(prompts.some((p) => p.includes('- 감나무: species="persimmon"'))).toBe(true);
    // 완성 직후 작업 중간물은 걷힌다(pruneEpisodeWork) — 장면 파일·대조표는 남는다
    expect(fs.existsSync(path.join(dir, 'scenes', 'work'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'scenes', 'contact.jpg'))).toBe(true);
    // 렌더 — 편 전용 전체 화면 진입점, LongFormFull, 장면·끼움 카드가 props 에, 카드 클립 스테이징
    expect(bundle.mock.calls[0]![0].entryPoint).toBe(path.join(dir, 'remotion-entry-full', 'index.ts'));
    expect(comps).toEqual(['LongFormFull']);
    expect(rendered!.segments.every((x) => x.scene)).toBe(true);
    const intro = rendered!.segments.find((x) => x.id === 'intro-01')!;
    expect(intro.footage?.src).toBe('intro-01.mp4');
    expect(fs.existsSync(path.join(dir, 'remotion-full', 'public', 'intro-01.mp4'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'scenes', 'registry.ts'), 'utf8')).toContain('s097');
    for (const f of ['final.mp4', 'subtitles.srt', 'youtube.txt', 'report.md', 'scenes/contact.jpg', 'thumbnail.jpg']) expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    expect(rec.costUsd).toBeGreaterThan(0);
    expect(notifyReady).toHaveBeenCalledTimes(1);
  });

  it('낭독·렌더 전에는 블로그 런·숏폼이 끝날 때까지 기다린다', async () => {
    let busy = 3;
    const sleep = vi.fn(async () => {});
    const { deps } = setup({ isBusy: () => (busy-- > 0 ? '블로그 런 진행 중' : null), sleep });
    const r = await runLongformEpisode({ brand: 'b', deps });
    expect(r.ok).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('한 번에 한 편 — 만드는 중이면 두 번째는 busy', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const { deps } = setup({ loadSources: async (ids) => { await gate; return ids.map((id) => ({ pieceId: id, title: id, body: SOURCE })); } });
    // 두 요청이 같은 틱에 들어와도(주제 선정 await 전) 둘째는 busy — 잠금은 첫 await 전에 잡는다.
    const pa = beginLongformEpisode({ brand: 'b', deps });
    const pb = beginLongformEpisode({ brand: 'b', deps });
    const [a, b] = await Promise.all([pa, pb]);
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, error: 'busy' });
    release();
    if (a.ok) await a.done;
    expect(longformEpisodeRunning()).toBeNull();
  });

  it('단계가 실패하면 stage=error·error 기록·실패 알림, 잠금은 풀린다', async () => {
    const { store, deps, notifyFail, notifyReady } = setup({ factGate: async () => { throw new Error('판정기 죽음'); } });
    const r = await runLongformEpisode({ brand: 'b', deps });
    expect(r.ok).toBe(false);
    const rec = store.get(r.id)!;
    expect(rec.stage).toBe('error');
    expect(rec.error).toContain('사실 확인');
    expect(rec.error).toContain('판정기 죽음');
    expect(notifyFail).toHaveBeenCalledTimes(1);
    expect(notifyReady).not.toHaveBeenCalled();
    expect(longformEpisodeRunning()).toBeNull();
  });

  it('직원 배선 — 대본은 한서윤 역할 system 으로, 썸네일 문구는 윤소이 LLM, 끝나면 작가·디자이너 activity 기록', async () => {
    const { deps } = setup({ buildScenes: vi.fn(async () => ({ built: 90, costUsd: 3, review: { redo: 2, redone: 1 } })) });
    const r = await runLongformEpisode({ brand: 'b', deps });
    expect(r.ok).toBe(true);
    const system = String((deps.llmJSON as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]);
    expect(system).toContain('"한서윤"(롱폼 작가)');
    expect(system).toContain('대본 작가'); // 과제 system(writerPrompt)이 뒤에 그대로
    expect(typeof (deps.thumbnail as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0].copyLlm).toBe('function');
    const notes = (deps.noteActivity as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(notes.map((c) => c[0])).toEqual(['longform_writer', 'longform_designer']);
    expect(notes[0]![1]).toContain('[롱폼 완성] 감나무 가지치기 총정리');
    expect(notes[0]![1]).toContain('검토 다시 그림 1/2');
  });

  it('실패해도 작가·디자이너 activity 에 실패 단계를 남긴다', async () => {
    const { deps } = setup({ factGate: async () => { throw new Error('판정기 죽음'); } });
    await runLongformEpisode({ brand: 'b', deps });
    const notes = (deps.noteActivity as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(notes).toHaveLength(2);
    expect(notes[1]![1]).toContain('[롱폼 실패]');
    expect(notes[1]![1]).toContain('사실 확인 단계');
  });

  it('짧은 편(주제 v2 targetMinutes 6) — 대본은 6분 기준으로 묻고, 사실 확인 뒤 하한도 같은 비율(약 2,000자 대본이 통과)', async () => {
    const shortJSON = () => ({ ...writerJSON(), chapters: writerJSON().chapters.slice(0, 5).map((c) => ({ ...c, segments: c.segments.slice(0, 11) })) });
    const short = setup({ selectTopic: () => ({ ...TOPIC, targetMinutes: 6 }), llmJSON: vi.fn(async () => shortJSON()) as unknown as LlmJSON });
    const r = await runLongformEpisode({ brand: 'b', deps: short.deps });
    expect(r.ok).toBe(true);
    const call = (short.deps.llmJSON as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[1])).toContain('6분짜리');
    expect(String(call[2])).toContain('장 4~6개');
    // 같은 대본이 10분 편이면 하한(2,500자)에 걸린다.
    const full = setup({ llmJSON: vi.fn(async () => shortJSON()) as unknown as LlmJSON });
    const r2 = await runLongformEpisode({ brand: 'b', deps: full.deps });
    expect(r2.ok).toBe(false);
    expect(full.store.get(r2.id)!.error).toContain('짧아짐');
  });

  it('고를 주제가 없으면 레코드를 만들지 않고 알린다', async () => {
    const { store, deps, notifyFail } = setup({ selectTopic: () => null });
    const r = await runLongformEpisode({ brand: 'b', deps });
    expect(r.ok).toBe(false);
    expect(store.list()).toEqual([]);
    expect(notifyFail).toHaveBeenCalledTimes(1);
  });
});

describe('episodeDirName', () => {
  it('날짜-주제, 겹치면 -2', () => {
    const now = new Date(2026, 9, 26, 0, 0);
    expect(episodeDirName(now, 'prune', () => false)).toBe('2026-10-26-prune');
    expect(episodeDirName(now, 'prune', (n) => n === '2026-10-26-prune')).toBe('2026-10-26-prune-2');
    expect(episodeDirName(now, '가지', () => false)).toBe('2026-10-26-episode');
  });
});

describe('pruneEpisodeWork(2026-10-23 완성 직후 중간물 걷기)', () => {
  it('작업 폴더·스틸·번들만 지우고 장면 파일·대조표·클립·낭독·완성 영상은 남긴다', async () => {
    const fsm = await import('node:fs'); const pathm = await import('node:path'); const osm = await import('node:os');
    const { pruneEpisodeWork } = await import('./longform');
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'lf-prune-'));
    const mk = (rel: string) => { fsm.mkdirSync(pathm.dirname(pathm.join(dir, rel)), { recursive: true }); fsm.writeFileSync(pathm.join(dir, rel), 'x'); };
    for (const r of ['scenes/work/b01/agent.jsonl', 'scenes/stills/s000.png', 'scenes/.render/a.png', 'remotion-full/bundle/x.js', 'remotion/bundle/y.js',
      'scenes/s000.tsx', 'scenes/contact.jpg', 'clips/a.mp4', 'audio/a.mp3', 'final.mp4', 'remotion-full/public/a.mp3']) mk(r);
    pruneEpisodeWork(dir);
    for (const gone of ['scenes/work', 'scenes/stills', 'scenes/.render', 'remotion-full/bundle', 'remotion/bundle']) expect(fsm.existsSync(pathm.join(dir, gone)), gone).toBe(false);
    for (const kept of ['scenes/s000.tsx', 'scenes/contact.jpg', 'clips/a.mp4', 'audio/a.mp3', 'final.mp4', 'remotion-full/public/a.mp3']) expect(fsm.existsSync(pathm.join(dir, kept)), kept).toBe(true);
  });
});
