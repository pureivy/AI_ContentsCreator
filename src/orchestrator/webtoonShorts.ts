/**
 * 웹툰 숏폼(2026-11-05, 1단계 시범) — SHORT_marker 를 불러 블로그 글로 웹툰 나레이션 숏폼을 만든다.
 * 설계: SHORT_marker/docs/integration-design.md.
 *
 *  ① 장면 목록(SHORT_marker write_shotlist --source) → ② 낭독 문장 원문 대조(숏폼 원문 정합과 같은 판정)
 *  → ③ 그림만(produce --images-only) → ④ 사람 확인(제작실 웹툰 탭 — 승인·장면 다시 그리기)
 *  → ⑤ 영상(produce) → ⑥ 숏폼 기록 등록(format 'webtoon', 인스타) → 기존 텔레그램 검토·발행 버튼.
 *
 * 한 번에 한 편(Mac Studio 한 대). 서버가 재시작되면 돌던 단계는 '중단됨'이 되고, '이어서 만들기'는 캐시로 이어 간다.
 * 숏폼 기록은 영상이 나온 뒤에야 만든다 — 만드는 중인 숏폼 기록은 부팅 복구가 우리 파이프라인으로 다시 돌린다.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { CONFIG } from '../config';
import { pieceStore } from '../content/pieces';
import { shortsStore } from '../content/shorts';
import { webtoonStore, type WebtoonJob, type WebtoonScene } from '../content/webtoon';
import type { FactGateInfo } from '../content/factGate';
import { notifyShortsReady } from '../autonomy/contentNotify';
import { parityIssuesChecked, parityToInfo } from './standaloneQa';
import { THUMB_FRAME_FILE } from '../tools/shortsRender';
import { generateDesignedThumbnail } from './shortsThumbnail';
import { produce, projectDir, SM_EXIT_TEXT, shortMarkerReady, writeShotlist, type SmResult } from '../tools/shortMarker';

const execFileP = promisify(execFile);
const running = new Map<string, AbortController>();
/** 숏폼 기록 등록 중인 작업 — 실패하면 failedStage 'registering'(이어서 만들기는 등록만 다시). */
const registering = new Set<string>();
/** 웹툰 단계가 도는 중인가 — /api/performance webtoonBusy(재시작 전 확인). */
export function webtoonBusy(): number { return running.size; }

interface Shotlist { id: string; hook?: string; scenes: Array<{ id: string; narration: string; motion?: string; redraw?: number }>; [k: string]: unknown }

/** 장면 목록 요약(순수). */
export function shotlistScenes(s: Shotlist): WebtoonScene[] {
  return (s.scenes ?? []).map((sc) => ({ id: sc.id, narration: String(sc.narration ?? ''), ...(sc.motion ? { motion: sc.motion } : {}) }));
}

/** 장면 다시 그리기(순수) — 고른 장면의 redraw 를 1 올린다(SHORT_marker 가 그 장면만 새 시드로 그린다). 모르는 장면 id 는 무시. */
export function bumpRedraw(s: Shotlist, ids: readonly string[]): { shotlist: Shotlist; bumped: string[] } {
  const want = new Set(ids);
  const bumped: string[] = [];
  const scenes = s.scenes.map((sc) => {
    if (!want.has(sc.id)) return sc;
    bumped.push(sc.id);
    return { ...sc, redraw: (sc.redraw ?? 0) + 1 };
  });
  return { shotlist: { ...s, scenes }, bumped };
}

/** 숏폼 기록 글(순수) — 제목은 훅, 설명은 낭독 첫머리, 해시태그는 키워드. */
export function webtoonShortsMeta(job: Pick<WebtoonJob, 'topic' | 'keyword' | 'hook'>, scenes: readonly WebtoonScene[]): { title: string; description: string; hashtags: string[] } {
  const title = (job.hook || job.topic).trim().slice(0, 60);
  const lines = scenes.map((s) => s.narration.trim()).filter(Boolean);
  const description = lines.slice(0, 3).join(' ').slice(0, 300);
  const kw = (job.keyword ?? '').replace(/\s+/g, '');
  const hashtags = [...new Set([kw && `#${kw}`, '#웹툰', '#정원일기'].filter(Boolean) as string[])];
  return { title, description, hashtags };
}

function readShotlist(project: string): Shotlist | null {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir(project), 'shotlist.json'), 'utf-8')) as Shotlist; } catch { return null; }
}

function jobDir(id: string): string { return path.join(CONFIG.dataDir, 'webtoon', id); }

function sourceBodyFor(pieceId: string): { body: string; topic: string; keyword?: string } | { error: string } {
  const piece = pieceStore().get(pieceId);
  if (!piece) return { error: '모르는 블로그 글입니다' };
  if (!piece.runId) return { error: '초안이 아직 없습니다' };
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, piece.runId, 'draft.json'), 'utf-8')) as { bodyMarkdown?: string };
    const body = (d.bodyMarkdown ?? '').trim();
    if (!body) return { error: '초안 본문(draft.json)이 비어 있습니다' };
    return { body, topic: piece.title, ...(piece.keyword ? { keyword: piece.keyword } : {}) };
  } catch { return { error: '초안 본문(draft.json)을 읽을 수 없습니다' }; }
}

/** 영상 1초 화면(제목이 보이는 훅) → thumbnail.jpg. 실패해도 등록은 계속(발행 때 영상 프레임 폴백). */
async function webtoonCover(video: string, out: string): Promise<void> {
  try { await execFileP('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', video, '-frames:v', '1', '-q:v', '2', out], { timeout: 30_000 }); }
  catch (e) { console.log(`[웹툰] 커버 추출 실패(무해) — ${e instanceof Error ? e.message.slice(0, 80) : e}`); }
}

const fail = (r: SmResult): string => `${SM_EXIT_TEXT[r.code] ?? '오류'}${r.error ? ` — ${r.error.slice(0, 200)}` : ''}`;

/** 한 단계 돌리기 — 같은 작업을 두 번 돌리지 않는다. 끝나면(성공·실패·취소) running 에서 뺀다. */
function runStage(id: string, body: (signal: AbortSignal, say: (l: string) => void) => Promise<void>): void {
  const ac = new AbortController();
  running.set(id, ac);
  const say = (l: string): void => { webtoonStore().log(id, l); };
  void body(ac.signal, say).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    const cur = webtoonStore().get(id);
    const failedStage = registering.has(id) ? 'registering' as const : cur?.stage;
    registering.delete(id);
    webtoonStore().update(id, { ...(ac.signal.aborted ? { stage: 'cancelled' as const, error: '취소됨' } : { stage: 'error' as const, error: msg.slice(0, 300) }), ...(failedStage ? { failedStage } : {}) });
    console.log(`[웹툰] ${id} ${ac.signal.aborted ? '취소' : `실패 — ${msg.slice(0, 120)}`}`);
  }).finally(() => { running.delete(id); });
}

/** ①②③ — 장면 목록(없을 때만) → 원문 대조 → 그림. 끝나면 review. */
async function draftAndDraw(id: string, signal: AbortSignal, say: (l: string) => void, rewrite = false): Promise<void> {
  const store = webtoonStore();
  let job = store.get(id)!;
  const src = sourceBodyFor(job.pieceId);
  if ('error' in src) throw new Error(src.error);
  // 장면 목록 단계에서 실패했으면(규칙 검사 오류가 남은 목록도 파일은 써진다) 다시 쓴다 — 남은 목록으로 그리면 한글 프롬프트·영상 상한 초과가 그대로 나간다.
  let sl = rewrite ? null : readShotlist(job.project);
  if (!sl) {
    store.update(id, { stage: 'writing', error: undefined });
    const dir = jobDir(id); fs.mkdirSync(dir, { recursive: true });
    const sourceFile = path.join(dir, 'source.md');
    fs.writeFileSync(sourceFile, src.body, 'utf-8');
    const t0 = Date.now();
    const r = await writeShotlist({ topic: job.topic, project: job.project, sourceFile, signal, onLine: say, force: rewrite || fs.existsSync(path.join(projectDir(job.project), 'shotlist.json')) });
    if (!r.ok) throw new Error(`장면 목록 — ${fail(r)}`);
    sl = readShotlist(job.project);
    if (!sl) throw new Error('장면 목록 파일을 읽을 수 없습니다');
    job = store.update(id, { wallSec: { ...job.wallSec, writing: Math.round((Date.now() - t0) / 1000) } })!;
  }
  const scenes = shotlistScenes(sl);
  store.update(id, { stage: 'checking', hook: sl.hook, scenes });
  // ② 숏폼 원문 정합과 같은 판정 — 이야기체 의역("번쩍 들었죠")은 인정하고, 원문에 없는 사실·결론 반전·유보의 단정만 잡는다.
  // 판정 실패는 'error'(발행은 막지 않되 검토에 '수동 확인'으로 보인다). 막는 건 발행 단계의 확인 한 번(shortsFactHoldBlockReason).
  // 훅은 제목·캡션 첫 줄이 된다 — 낭독과 함께 대조한다(1번 항목).
  const texts = [...(sl.hook ? [`(제목) ${sl.hook}`] : []), ...scenes.map((s) => s.narration)];
  const issues = CONFIG.factGate ? await parityIssuesChecked('웹툰 숏폼 제목·낭독(장면 내레이션)', texts, src.body, signal) : [];
  const factGate: FactGateInfo = issues ? parityToInfo(issues) : { status: 'error', unsupported: [], contradicted: [], checkedTs: new Date().toISOString() };
  say(`원문 대조 — ${factGate.status === 'pass' ? '이상 없음' : factGate.status === 'hold' ? `확인 필요 ${factGate.unsupported.length}건` : '판정 실패(수동 확인)'}`);
  if (signal.aborted) throw new Error('취소됨');
  store.update(id, { stage: 'drawing', factGate });
  const t1 = Date.now();
  const r = await produce({ project: job.project, imagesOnly: true, signal, onLine: say });
  if (!r.ok) throw new Error(`그림 — ${fail(r)}`);
  const cur = store.get(id)!;
  store.update(id, { stage: 'review', wallSec: { ...cur.wallSec, drawing: Math.round((Date.now() - t1) / 1000) } });
  console.log(`[웹툰] ${cur.topic.slice(0, 30)} — 그림 ${scenes.length}장 준비, 제작실 확인 대기`);
}

/** 새 작업 시작 — 202 용. project 를 주면 그 SHORT_marker 프로젝트(장면 목록이 이미 있으면 그대로)로 — 시험용. */
export function beginWebtoon(a: { pieceId: string; project?: string; quiet?: boolean }): { ok: true; id: string } | { ok: false; status: 409 | 422; error: string } {
  if (!CONFIG.webtoonShorts) return { ok: false, status: 409, error: '웹툰 숏폼이 꺼져 있습니다(WEBTOON_SHORTS)' };
  const bad = shortMarkerReady();
  if (bad) return { ok: false, status: 422, error: bad };
  if (running.size) return { ok: false, status: 409, error: '다른 웹툰 작업이 도는 중입니다(Mac Studio 한 대)' };
  const src = sourceBodyFor(a.pieceId);
  if ('error' in src) return { ok: false, status: 422, error: src.error };
  if (a.project && !/^[\w-]{1,64}$/.test(a.project)) return { ok: false, status: 422, error: '프로젝트 이름은 영문·숫자·_- 만' };
  const job = webtoonStore().create({ pieceId: a.pieceId, topic: src.topic, ...(src.keyword ? { keyword: src.keyword } : {}), ...(a.project ? { project: a.project } : {}), ...(a.quiet ? { quiet: true } : {}) });
  console.log(`[웹툰] 시작 — ${src.topic.slice(0, 40)} (${job.id}${a.project ? ` · 프로젝트 ${a.project}` : ''})`);
  runStage(job.id, (signal, say) => draftAndDraw(job.id, signal, say));
  return { ok: true, id: job.id };
}

type Act = { ok: true } | { ok: false; status: 404 | 409 | 422; error: string };
function idle(id: string): WebtoonJob | Act {
  const job = webtoonStore().get(id);
  if (!job) return { ok: false, status: 404, error: '모르는 웹툰 작업' };
  if (running.has(id) || running.size) return { ok: false, status: 409, error: '웹툰 작업이 도는 중입니다' };
  return job;
}
const isAct = (x: WebtoonJob | Act): x is Act => 'ok' in x;

/** 장면 다시 그리기 — review 에서만. */
export function redrawWebtoon(id: string, sceneIds: readonly string[]): Act {
  if (!CONFIG.webtoonShorts) return { ok: false, status: 409, error: '웹툰 숏폼이 꺼져 있습니다(WEBTOON_SHORTS)' };
  const job = idle(id); if (isAct(job)) return job;
  if (job.stage !== 'review') return { ok: false, status: 409, error: '그림 확인 단계에서만 다시 그릴 수 있습니다' };
  const sl = readShotlist(job.project);
  if (!sl) return { ok: false, status: 422, error: '장면 목록이 없습니다' };
  const { shotlist, bumped } = bumpRedraw(sl, sceneIds);
  if (!bumped.length) return { ok: false, status: 422, error: '다시 그릴 장면을 고르세요' };
  fs.writeFileSync(path.join(projectDir(job.project), 'shotlist.json'), JSON.stringify(shotlist, null, 2), 'utf-8');
  const redraws = { ...job.redraws }; for (const b of bumped) redraws[b] = (redraws[b] ?? 0) + 1;
  webtoonStore().update(id, { stage: 'drawing', redraws });
  runStage(id, async (signal, say) => {
    say(`장면 다시 그리기 — ${bumped.join(', ')}`);
    const r = await produce({ project: job.project, imagesOnly: true, signal, onLine: say });
    if (!r.ok) throw new Error(`그림 — ${fail(r)}`);
    webtoonStore().update(id, { stage: 'review' });
  });
  return { ok: true };
}

/** 그림 승인 → 영상 → 숏폼 기록 등록. */
export function approveWebtoon(id: string): Act {
  if (!CONFIG.webtoonShorts) return { ok: false, status: 409, error: '웹툰 숏폼이 꺼져 있습니다(WEBTOON_SHORTS)' };
  const job = idle(id); if (isAct(job)) return job;
  if (job.stage !== 'review') return { ok: false, status: 409, error: '그림 확인 단계가 아닙니다' };
  webtoonStore().update(id, { stage: 'producing', error: undefined, failedStage: undefined });
  runStage(id, async (signal, say) => {
    const t0 = Date.now();
    const r = await produce({ project: job.project, signal, onLine: say });
    if (!r.ok || !r.mp4) throw new Error(`영상 — ${fail(r)}`);
    const cur = webtoonStore().get(id)!;
    webtoonStore().update(id, { wallSec: { ...cur.wallSec, producing: Math.round((Date.now() - t0) / 1000) }, ...(r.duration_sec ? { durationSec: r.duration_sec } : {}) });
    await registerShorts(id, r);
  });
  return { ok: true };
}

/** 실패·중단·취소된 작업 이어서 — 장면 목록이 있으면 그림부터(캐시라 다 그린 장면은 건너뛴다). */
export function resumeWebtoon(id: string): Act {
  const job = idle(id); if (isAct(job)) return job;
  if (job.stage !== 'error' && job.stage !== 'cancelled') return { ok: false, status: 409, error: '실패·중단된 작업만 이어서 만들 수 있습니다' };
  if (!CONFIG.webtoonShorts) return { ok: false, status: 409, error: '웹툰 숏폼이 꺼져 있습니다(WEBTOON_SHORTS)' };
  // 멈춘 단계(failedStage)부터 — 영상·등록 단계면 그림은 이미 사람이 승인했다(영상은 캐시로 이어 간다).
  const f = job.failedStage;
  if (f === 'producing' || f === 'registering') { webtoonStore().update(id, { stage: 'review', error: undefined }); return approveWebtoon(id); }
  const rewrite = f === 'writing';
  webtoonStore().update(id, { stage: 'writing', error: undefined, failedStage: undefined });
  runStage(id, (signal, say) => draftAndDraw(id, signal, say, rewrite));
  return { ok: true };
}

export function cancelWebtoon(id: string): Act {
  const ac = running.get(id);
  if (!ac) {
    const job = webtoonStore().get(id);
    if (!job) return { ok: false, status: 404, error: '모르는 웹툰 작업' };
    if (job.stage === 'review') { webtoonStore().update(id, { stage: 'cancelled', error: '사람이 취소' }); return { ok: true }; }
    return { ok: false, status: 409, error: '도는 단계가 없습니다' };
  }
  ac.abort();
  return { ok: true };
}

/** 장면 그림 경로(제작실 표시용) — 프로젝트 assets 안의 파일만. */
export function webtoonImagePath(id: string, sceneId: string): string | null {
  const job = webtoonStore().get(id);
  if (!job || !/^s\d{2}$/.test(sceneId)) return null;
  const p = path.join(projectDir(job.project), 'assets', `img_${sceneId}.png`);
  return fs.existsSync(p) ? p : null;
}

/** ⑥ 숏폼 기록 등록 — 파일을 data/shorts/<id>/ 로 옮겨 담고 ready 로. 텔레그램 검토 알림(시험 실행은 생략). */
async function registerShorts(id: string, r: SmResult): Promise<void> {
  const store = webtoonStore();
  const job = store.get(id)!;
  const scenes = job.scenes ?? [];
  const meta = webtoonShortsMeta(job, scenes);
  const ss = shortsStore();
  registering.add(id);
  // 등록을 다시 하는 경우(앞 등록이 도중에 끊김) 그 기록을 다시 쓴다 — 기록이 둘 생기지 않게.
  const prev = job.shortId ? ss.get(job.shortId) : undefined;
  if (prev?.igReelId || prev?.youtubeId) throw new Error('이미 발행된 숏폼 기록입니다 — 다시 등록하지 않습니다');
  const short = prev ?? ss.create({
    topic: job.topic, ...(job.keyword ? { keyword: job.keyword } : {}), sourcePieceId: job.pieceId,
    format: 'webtoon', webtoonId: id, writer: '웹툰(SHORT_marker)', director: '웹툰(SHORT_marker)',
  });
  if (!prev) store.update(id, { shortId: short.id });
  const dir = ss.dirFor(short.id);
  try {
    fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
    fs.copyFileSync(r.mp4!, path.join(dir, 'final.mp4'));
    // 장면 그림 — 발행 직전 디자인 썸네일(hookStillFor)이 scenes/ 와 plan.json 씬 수로 훅 그림을 찾는다.
    scenes.forEach((s, i) => {
      const img = path.join(projectDir(job.project), 'assets', `img_${s.id}.png`);
      if (fs.existsSync(img)) fs.copyFileSync(img, path.join(dir, 'scenes', `scene-${String(i + 1).padStart(2, '0')}.png`));
    });
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ title: meta.title, format: 'webtoon', webtoonId: id, scenes: scenes.map((s) => ({ narration: s.narration })) }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(dir, 'caption.txt'), [meta.title, '', meta.description, '', meta.hashtags.join(' ')].join('\n'), 'utf-8');
    // 릴스 커버(2026-11-06 사장님 결정 — 11-05 '영상 첫 화면'을 바꿈): 다른 릴스와 같은 디자인 썸네일(gpt-image)을 첫 장면 그림으로.
    // 첫 화면은 제목 상자가 작고 자막 조각이 걸려 프로필 격자에서 웹툰만 밋밋했다. 영상 1초 화면은 실패 때 대체본(.thumb-frame 표식 —
    // 발행 직전 보강 ensureDesignThumbnailBeforePublish 가 한 번 더 그려 본다).
    await webtoonCover(path.join(dir, 'final.mp4'), path.join(dir, 'thumbnail.jpg'));
    if (fs.existsSync(path.join(dir, 'thumbnail.jpg'))) fs.writeFileSync(path.join(dir, THUMB_FRAME_FILE), new Date().toISOString(), 'utf-8');
    if (!job.quiet) {
      const hook = path.join(dir, 'scenes', 'scene-01.png');
      const ok = await generateDesignedThumbnail({
        dir, title: meta.title, description: meta.description, titles: [meta.title], hookImage: fs.existsSync(hook) ? hook : null,
        ...(job.keyword ? { keyword: job.keyword } : {}), signal: AbortSignal.timeout(240_000),
      }).catch(() => false);
      console.log(`[웹툰] 디자인 썸네일 ${ok ? '완료' : '못 만듦 — 영상 1초 화면을 커버로 두고 발행 직전에 한 번 더 그린다'}`);
    }
  } catch (e) {
    // planning 기록이 남지 않게 — 실패로 닫는다(부팅 복구도 웹툰 기록은 재개하지 않는다).
    ss.update(short.id, { stage: 'error', error: `웹툰 등록 실패 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
    throw e;
  }
  const done = ss.update(short.id, {
    stage: 'ready', error: undefined, title: meta.title, titles: [meta.title], description: meta.description, hashtags: meta.hashtags,
    durationSec: r.duration_sec ?? job.durationSec, scenes: scenes.length, ...(job.factGate ? { factGate: job.factGate } : {}),
    // 시험 실행은 알림을 보내지 않는다 — notifiedTs 를 먼저 남겨 부팅 복구 스윕도 보내지 않게.
    ...(job.quiet ? { notifiedTs: new Date().toISOString() } : {}),
  })!;
  registering.delete(id);
  store.update(id, { stage: 'ready', shortId: short.id, failedStage: undefined });
  console.log(`[웹툰] 완성 — ${meta.title} · ${done.durationSec ?? '?'}초 → 숏폼 ${short.id}${job.quiet ? ' (시험 실행 — 알림 생략)' : ''}`);
  if (job.quiet || done.notifiedTs) return;
  void notifyShortsReady({
    id: short.id, topic: done.topic, brand: done.brand, platform: done.platform, durationSec: done.durationSec, scenes: done.scenes,
    sourcePieceId: done.sourcePieceId, writer: done.writer, director: done.director, factGate: done.factGate,
  }, path.join(dir, 'final.mp4')).finally(() => { try { ss.update(short.id, { notifiedTs: new Date().toISOString() }); } catch { /* 무해 */ } });
}
