/**
 * 롱폼 한 편 제작(2026-10-22 사장님 결정 — 매주 토요일 24:00 시작(10-24 일요일에서 옮김), 완성되면 텔레그램 검토 알림, 발행은 사람 버튼).
 *
 * 단계(레코드 progress 에 한국어로): 주제 선정 → 대본 작성 → 사실 확인 → 낭독 → 실촬영 배정 → 그림 → 렌더 → 썸네일 → 완성.
 * 산출물은 data/longform/<yyyy-mm-dd>-<작업 주제>/ (시범과 같은 꼴: script.json·sources.md·factgate.json·pron.json·audio/·clips/·
 * timeline.json·final.mp4·subtitles.srt·youtube.txt·thumbnail.jpg).
 *
 * 그림(문장마다 모션그래픽)은 장면 단계(longformScenes.ts buildScenes)가 만든다 — 장 단위 Claude Code 세션이 문장마다 장면 파일을 쓰고,
 * 검사를 통과한 장면만 편 전용 진입점의 등록표에 싣고 timeline.json·script.json 에 scene 키를 쓴다.
 *
 * 화면 꼴(2026-10-23 사장님 결정, LONGFORM_LAYOUT·LONGFORM_STYLE): 기본은 전체 화면(full) + 스타일 B(연필 선화) —
 * 장면이 화면 전체를 쓰고 실촬영은 문장이 실제 모습을 말할 때 장면 안 끼움 카드로만(장마다 최소 한 번, 수종 없는 장은 편 주인공 수종만).
 * 그림 전에 '수종 형태' 단계(speciesPreset.ts — 서다인이 키트에 없는 수종 프리셋 작성 + 실물 대조용 사진: 우리 실촬영 프레임,
 * 실촬영이 못 보여 주는 부위는 공개 도감 사진(speciesCommons.ts — Wikimedia Commons, 출처 기록·내부 대조용만))를 거친다.
 * 렌더는 renderEpisodeFull(LongFormFull, remotion-entry-full). panel 은 종전(왼쪽 실촬영 + 오른쪽 그림 칸, remotion-entry → LongForm).
 *
 * 무거운 단계(낭독·렌더)는 오토런 블로그 런·숏폼 생성이 돌고 있으면 끝날 때까지 기다린다(60초 간격, 최대 3시간 — 넘으면 그냥 간다).
 * 한 번에 한 편만(모듈 잠금). 돈 드는 부품은 전부 deps 로 바꿔 끼운다 — 테스트는 전부 가짜.
 *
 * 검토 알림 경고(2026-10-25) — 빠진 장면·받아쓰기 실패·발음 의심·사실 확인 실패/잔여 주장을 레코드에 남겨 캡션 맨 위에 싣는다(발행은 막지 않는다).
 * 재시작으로 끊긴 주간 편은 같은 폴더로 한 번 자동 재시도(resumeLongformEpisode — 사실 확인까지 끝난 대본·낭독·클립·장면 파일 재사용).
 *   수종 형태(species/index.json·scenes/_species.ts)가 있으면 그대로 쓰고, 비용은 앞 실행 레코드 costUsd 에 이어 센다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { LongformStore, longformResendDue, longformRetryDue, longformStore, type LongformRecord } from '../content/longform';
import { factGateBlog } from '../content/factGate';
import { monthSpendUsd } from '../llm/cost';
import { notify } from '../autonomy/notify';
import { notifyLongformReady } from '../autonomy/contentNotify';
import { generateLongformThumbnail } from './longformThumbnail';
import { coherenceLlm, defaultTopicDeps, selectCoherentTopic, selectTopic, topicLabel, type TopicChoice } from '../longform/topic';
import { loadSources, type SourcePiece } from '../longform/source';
import { footageInventory, loadEpisodeScript, loadMediaVideos, saveEpisodeScript, scriptText } from '../longform/episode';
import { factCheckScript, rewordForPronunciation, writeScript, defaultLlmJSON, type FactRecord, type LlmJSON } from '../longform/writer';
import { assembleTimeline, defaultAssetDeps, synthesizeAll, type AssetDeps } from '../longform/assets';
import { defaultRenderDeps, renderEpisode, renderEpisodeFull, type RenderDeps } from '../longform/render';
import { loadSpeciesIndex, prepareSpecies, type SpeciesIndex } from '../longform/speciesPreset';
import { SCENE_DIR, SPECIES_MODULE } from '../longform/sceneFiles';
import type { SceneStageMode } from './longformScenes';
import type { FullStyle } from '../longform/fullProps';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildYoutubeMeta } from '../longform/youtubeMeta';
import { buildScenes } from './longformScenes';
import { LF_DESIGNER, LF_TEAM, LF_WRITER, designerBrief, emitStaffSpawn, staffLlm, staffOfficeStart, staffRole, staffSay } from './longformStaff';
import { sceneReviewer } from './longformReview';
import { appendActivity } from '../agents/workspace';
import type { EventBus } from '../events/bus';
import { pickHeroSpecies, validateScript, type LongformScript } from '../longform/script';
import type { MediaItem } from '../longform/footage';
import type { TimedSegment } from '../longform/timeline';

/** ElevenLabs 글자당 비용 추정(USD) — 요금제 초과 단가 근사. 기록용(편당 비용 표시). */
export const LF_TTS_USD_PER_CHAR = 0.0003;
export const BUSY_POLL_MS = 60_000;
export const BUSY_MAX_MS = 3 * 60 * 60_000;
/** 사실 확인 뒤 이보다 짧아지면 영상이 안 된다(10분의 3/4 남짓). */
const MIN_CHARS_AFTER_FACT = 2500;

export interface LongformDeps {
  store: LongformStore;
  /** data/longform 절대 경로(store 와 같은 곳). */
  root: string;
  /** 주제 선정 — 수동 지정(pieceIds)은 결정적, 자동은 LLM 묶음 일관성(selectCoherentTopic). */
  selectTopic: (pieceIds?: string[], signal?: AbortSignal) => TopicChoice | null | Promise<TopicChoice | null>;
  loadSources: (pieceIds: string[]) => Promise<SourcePiece[]>;
  /** 보관소 영상(있는 파일만, 브랜드). */
  media: (brand: string) => MediaItem[];
  llmJSON: LlmJSON;
  factGate: typeof factGateBlog;
  assets: () => Promise<AssetDeps>;
  render: () => Promise<RenderDeps>;
  /** 화면 꼴 — 전체 화면(스타일)·종전 칸 나눔. 운영은 CONFIG(LONGFORM_LAYOUT·LONGFORM_STYLE). */
  layout: { stage: 'full'; style: FullStyle; presenter?: boolean } | { stage: 'panel' };
  /** 문장 그림 장면 단계 — 만든 장면 수, 에이전트 비용(USD, CLI 보고), 편 전용 진입점(장면이 있을 때만), 검토(정하람) 결과. mode = 전체 화면이면 그 옵션. */
  buildScenes: (dir: string, segments: TimedSegment[], signal?: AbortSignal, mode?: SceneStageMode, opts?: { resume?: boolean }) => Promise<{ built: number; costUsd?: number; entryPoint?: string; contact?: string; review?: { redo: number; redone: number; skipped?: string } }>;
  /** 수종 형태 단계(전체 화면만) — 편 수종 프리셋(키트 내장·서다인 작성·일반형)·실물 대조용 사진. 실패해도 편은 간다. */
  species: (o: { dir: string; script: LongformScript; media: MediaItem[]; sourceText: string; signal?: AbortSignal }) => Promise<SpeciesIndex>;
  /** 보관소 영상 id → 수종(전체 화면 렌더의 끼움 카드 배정 폴백). */
  mediaSpecies: (id: string) => string | undefined;
  thumbnail: typeof generateLongformThumbnail;
  notifyReady: (rec: LongformRecord) => Promise<boolean>;
  notifyFail: (title: string, body: string) => Promise<unknown>;
  /** 지금 무거운 작업을 미뤄야 하는 이유(오토런 블로그 런·숏폼 생성 중) — 없으면 null. */
  isBusy: () => string | null;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 이번 달 LLM 원장 누적(USD) — 시작·끝 차이를 편 비용으로 근사(같은 시각 다른 런 비용이 섞일 수 있다). */
  spendUsd: () => number;
  now: () => Date;
  log: (m: string) => void;
  /** 직원 activity.log 한 줄(2026-10-23 — 편이 끝날 때 작가·디자이너에게 무엇을 만들었고 얼마 들었고 무엇이 실패했는지). */
  noteActivity: (roleId: string, line: string) => void;
}

const execFileP = promisify(execFile);

const sleepAbortable = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * 운영 부품. bus = 이 편의 오피스 런 버스(있으면 직원들이 오피스에서 일하는 모습으로 보인다) — 주제 묶음은 이수민(perf_analyst),
 * 장면 세션에는 차민혁(longform_designer)의 기억·스킬, 완성 장면 검토는 정하람(reviewer, LONGFORM_REVIEW).
 */
export function defaultLongformDeps(bus?: EventBus): LongformDeps {
  const store = longformStore();
  const opt = bus ? { bus } : {};
  return {
    store,
    root: path.join(CONFIG.dataDir, 'longform'),
    selectTopic: (ids, signal) => (ids?.length ? selectTopic(defaultTopicDeps(), ids)
      : selectCoherentTopic(defaultTopicDeps(), coherenceLlm(staffLlm('perf_analyst', { ...opt, fallback: defaultLlmJSON, summary: '롱폼 주제 묶음' })), { ...(signal ? { signal } : {}), log: (m) => console.log('[롱폼]', m) })),
    loadSources: (ids) => loadSources(ids),
    media: (brand) => loadMediaVideos(CONFIG.dataDir, brand),
    llmJSON: defaultLlmJSON,
    factGate: factGateBlog,
    assets: defaultAssetDeps,
    render: defaultRenderDeps,
    layout: CONFIG.longformLayout === 'panel' ? { stage: 'panel' } : { stage: 'full', style: CONFIG.longformStyle, ...(CONFIG.longformPresenter ? { presenter: true } : {}) },
    buildScenes: (dir, segments, signal, mode, sceneOpts) => buildScenes(dir, segments, signal, {
      designerBrief: () => designerBrief(),
      activity: (line) => appendActivity(LF_DESIGNER, line),
      ...(CONFIG.longformReview ? { review: sceneReviewer({ ...opt, activity: (line) => appendActivity('reviewer', line) }) } : {}),
    }, mode, sceneOpts),
    species: (o) => prepareSpecies({
      ...o, repo: path.resolve('.'), model: CONFIG.cloudTierModels.heavy, log: (m) => console.log('[롱폼]', m),
      llm: staffLlm('research_lead', { ...opt, fallback: defaultLlmJSON, summary: '롱폼 수종 형태 프리셋' }),
      ffmpeg: async (args) => { await execFileP('ffmpeg', args, { timeout: 60_000 }); },
      // 실촬영이 못 보여 주는 부위 — Wikimedia Commons 공개 도감 사진(내부 대조용, 출처·라이선스 기록). 실패해도 간다.
      commons: { fetch: (url, init) => fetch(url, init) },
    }),
    mediaSpecies: (() => {
      let m: Map<string, string> | null = null;
      return (id: string) => { m ??= new Map(loadMediaVideos(CONFIG.dataDir).filter((x) => x.species).map((x) => [x.id, x.species!])); return m.get(id); };
    })(),
    thumbnail: generateLongformThumbnail,
    notifyReady: (rec) => notifyLongformReady(rec),
    notifyFail: (title, body) => notify({ title, body }),
    isBusy: () => null,
    sleep: sleepAbortable,
    spendUsd: () => monthSpendUsd(),
    now: () => new Date(),
    log: (m) => console.log('[롱폼]', m),
    noteActivity: (roleId, line) => appendActivity(roleId, line),
  };
}

let running: string | null = null;
/** 지금 만드는 편 id(없으면 null) — 라우트 409·janitor 건너뛰기·재시작 대기가 본다. */
export function longformEpisodeRunning(): string | null { return running; }

/** 편 폴더 이름(순수) — `yyyy-mm-dd-<작업 주제>`, 겹치면 -2·-3. 로컬 날짜(토요일 24:00 = 일요일 날짜). */
export function episodeDirName(now: Date, topic: string, exists: (name: string) => boolean): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'episode';
  const base = `${d}-${slug}`;
  let name = base;
  for (let k = 2; exists(name); k++) name = `${base}-${k}`;
  return name;
}

/** 무거운 단계 전 대기 — 오토런·숏폼이 돌면 끝날 때까지(최대 3시간). 기다린 ms. */
async function waitIdle(d: LongformDeps, id: string, stage: string, signal?: AbortSignal): Promise<number> {
  const t0 = Date.now();
  let waited = 0;
  for (let why = d.isBusy(); why && waited < BUSY_MAX_MS; why = d.isBusy()) {
    if (signal?.aborted) throw new Error('취소됨');
    d.store.update(id, { progress: `${stage} 대기 — ${why}` });
    await d.sleep(BUSY_POLL_MS, signal);
    waited += BUSY_POLL_MS;
  }
  if (waited >= BUSY_MAX_MS && d.isBusy()) d.log(`${stage} 대기 3시간 초과 — 그대로 진행`);
  return Date.now() - t0;
}

export interface BeginResult { ok: true; id: string; done: Promise<EpisodeResult> }
export interface BeginError { ok: false; error: string; message: string }
export interface EpisodeResult { ok: boolean; id: string; error?: string }

/**
 * 시작 — 잠금·주제 선정(LLM 한 번, 수 초)·레코드 생성까지 기다린다(라우트가 id 를 바로 돌려준다), 나머지는 done 이 끝날 때까지 뒤에서.
 * 이미 만드는 편이 있으면 busy, 고를 주제가 없으면 no_topic. 잠금은 첫 await 전에 잡는다(동시 두 요청이 같이 통과하지 않게).
 */
export async function beginLongformEpisode(o: { brand: string; pieceIds?: string[]; signal?: AbortSignal; bus?: EventBus; deps?: Partial<LongformDeps>; trigger?: LongformRecord['trigger'] }): Promise<BeginResult | BeginError> {
  if (running) return { ok: false, error: 'busy', message: `이미 롱폼을 만드는 중입니다(${running})` };
  const d: LongformDeps = { ...defaultLongformDeps(o.bus), ...o.deps };
  running = '주제 선정';
  let topic: TopicChoice | null;
  try { topic = await d.selectTopic(o.pieceIds?.length ? o.pieceIds : undefined, o.signal); }
  catch (e) { running = null; return { ok: false, error: 'no_topic', message: `주제 선정 실패: ${e instanceof Error ? e.message : String(e)}` }; }
  if (!topic) { running = null; return { ok: false, error: 'no_topic', message: '고를 주제가 없습니다 — 이미 만든 주제·제철 아님·한 질문으로 묶이는 글 부족' }; }
  // 레코드 만들기가 던지면(폴더 이름·저장 실패) 잠금을 풀고 돌려준다(2026-10-26) — 종전엔 running='주제 선정'이 남아 서버를 다시 켤 때까지 늘 busy 였다.
  let rec: LongformRecord;
  try {
    const dirName = episodeDirName(d.now(), topic.topic, (n) => fs.existsSync(path.join(d.root, n)) || d.store.list().some((r) => r.dir === n));
    rec = d.store.create({
      dir: dirName, brand: o.brand, stage: 'producing',
      title: topic.theme || `${topicLabel(topic.topic)} — ${topic.anchor.title}`,
      patch: { progress: '주제 선정', topicReason: topic.reason, topicKey: topic.topicKey, sourcePieceIds: topic.pieces.map((p) => p.id), thumbState: 'none', ...(o.trigger ? { trigger: o.trigger } : {}) },
    });
  } catch (e) { running = null; return { ok: false, error: 'create_failed', message: `편 만들기 실패: ${e instanceof Error ? e.message : String(e)}` }; }
  running = rec.id;
  const done = produce(rec, topic, d, o.signal, o.bus).finally(() => { running = null; });
  return { ok: true, id: rec.id, done };
}

/** 한 편 끝까지(스케줄러용) — 시작 실패는 그대로 결과로. onStarted = 레코드가 생기면(런 제목을 편 제목으로). */
export async function runLongformEpisode(o: { brand: string; pieceIds?: string[]; signal?: AbortSignal; bus?: EventBus; deps?: Partial<LongformDeps>; trigger?: LongformRecord['trigger']; onStarted?: (id: string) => void }): Promise<EpisodeResult> {
  const b = await beginLongformEpisode(o);
  if (!b.ok) {
    const d = { ...defaultLongformDeps(), ...o.deps };
    d.log(`시작 안 함 — ${b.message}`);
    // 주간 자동 실행이 조용히 건너뛰지 않게 — 주제 없음·이미 만드는 중 모두 사유와 함께 알린다(2026-10-25 — 종전엔 만드는 중이면 조용히 건너뛰었다).
    await d.notifyFail('🎞 롱폼 이번 주 건너뜀', b.message).catch(() => {});
    return { ok: false, id: '', error: b.message };
  }
  try { o.onStarted?.(b.id); } catch { /* 표시만 잃는다 */ }
  return b.done;
}

/** 편 폴더의 주제(topic.json) — 재시도가 같은 주제·같은 글로 잇는다. 없거나 깨지면 null. */
function readTopic(dir: string): TopicChoice | null {
  try { const t = JSON.parse(fs.readFileSync(path.join(dir, 'topic.json'), 'utf8')) as TopicChoice; return t?.topicKey && Array.isArray(t.pieces) && t.anchor ? t : null; } catch { return null; }
}

/**
 * 끊긴 편 이어 만들기(2026-10-25 — 재시작으로 끊긴 주간 편 자동 재시도). 같은 레코드·같은 폴더: 사실 확인까지 끝난 대본이 있으면 그대로 쓰고
 * (낭독 mp3·클립은 문장 키 캐시라 비용 0), 그림은 buildScenes resume(있는 장면 파일은 두고 빠진 것만). autoRetried 를 먼저 남긴다 —
 * 이 재시도가 또 끊기면 다음 부팅은 재시도하지 않는다(재시작 고리에서 돈을 계속 쓰지 않게).
 */
export async function resumeLongformEpisode(o: { id: string; signal?: AbortSignal; bus?: EventBus; deps?: Partial<LongformDeps> }): Promise<BeginResult | BeginError> {
  if (running) return { ok: false, error: 'busy', message: `이미 롱폼을 만드는 중입니다(${running})` };
  const d: LongformDeps = { ...defaultLongformDeps(o.bus), ...o.deps };
  const rec = d.store.get(o.id);
  const dir = rec ? d.store.absDir(rec) : null;
  if (!rec || !dir) return { ok: false, error: 'unknown_longform', message: `이어 만들 롱폼이 없습니다(${o.id})` };
  running = rec.id;
  d.store.update(rec.id, { stage: 'producing', autoRetried: true, error: undefined, progress: '재시도 — 주제 확인' });
  // topic.json 이 없는 옛 편은 같은 글로 다시 고른다(수동 지정 경로 — 결정적).
  let topic = readTopic(dir);
  if (!topic && rec.sourcePieceIds?.length) { try { topic = await d.selectTopic(rec.sourcePieceIds, o.signal); } catch { topic = null; } }
  if (!topic) {
    running = null;
    d.store.update(rec.id, { stage: 'error', error: '재시도 실패: 주제를 다시 찾지 못했습니다 — 다시 만드세요', progress: undefined });
    return { ok: false, error: 'no_topic', message: '이어 만들 주제를 찾지 못했습니다' };
  }
  const done = produce(d.store.get(rec.id)!, topic, d, o.signal, o.bus, { resume: true }).finally(() => { running = null; });
  return { ok: true, id: rec.id, done };
}

/**
 * 부팅 정리(2026-10-25) — 제작은 이 프로세스 메모리에서만 돈다. 새 프로세스엔 살아 있는 제작이 없으니 제작 중(producing) 편을 본다:
 * 자동 재시도 대상(longformRetryDue — 오늘 주간 자동 실행으로 시작, 아직 재시도 전)은 producing 으로 둔다(호출부가 잠시 뒤 resumeLongformEpisode —
 * 재시작이 잇따르면 다음 부팅이 다시 본다). 나머지는 error 로 닫는다(안 닫으면 제작실에 영원히 '만드는 중'). 반환은 알림용(닫기 전 progress 그대로).
 */
export function sweepInterruptedLongform(store: LongformStore, now: Date): { closed: LongformRecord[]; retry: LongformRecord[] } {
  const closed: LongformRecord[] = [], retry: LongformRecord[] = [];
  for (const x of store.list()) {
    if (x.stage !== 'producing') continue;
    if (longformRetryDue(x, now)) { retry.push(x); continue; }
    store.update(x.id, { stage: 'error', error: `서버 재시작으로 제작이 끊겼습니다${x.progress ? `(${x.progress})` : ''} — 다시 만드세요`, progress: undefined });
    closed.push(x);
  }
  return { closed, retry };
}

/** 끊긴 편 알림 문구(순수). retrying = 같은 폴더로 한 번 다시 시작함. */
export function interruptedNotice(x: Pick<LongformRecord, 'title' | 'progress' | 'autoRetried'>, retrying: boolean): { title: string; body: string } {
  return {
    title: `⚠️ 롱폼 제작이 서버 재시작으로 끊겼습니다 · ${x.title}${x.progress ? ` (${x.progress})` : ''}`,
    body: retrying ? '같은 폴더로 한 번 자동으로 다시 시작합니다 — 끝난 낭독·클립·장면은 다시 만들지 않습니다.'
      : `${x.autoRetried ? '자동 재시도도 끊겨 더 시도하지 않습니다. ' : ''}제작실 롱폼 탭에서 다시 만드세요.`,
  };
}

/**
 * 유실된 검토 알림 다시 보내기(2026-10-25 — 부팅·하루 한 번). longformResendDue(완성·알림 없음·아직 안 올림·7일 안)만.
 * notifyLongformReady 가 보내면 notifiedTs 를 남기므로 실패한 것은 다음 번에 다시 본다. 보낸 수.
 */
export async function resendLongformNotices(o: { store: LongformStore; now: Date; send: (rec: LongformRecord) => Promise<boolean>; log?: (m: string) => void }): Promise<number> {
  let n = 0;
  for (const x of o.store.list()) {
    if (!longformResendDue(x, o.now)) continue;
    const ok = await o.send(x).catch(() => false);
    o.log?.(`유실된 검토 알림 재발송 ${ok ? '성공' : '실패'} — ${x.title.slice(0, 30)}`);
    if (ok) n++;
  }
  return n;
}

/** 사실 확인 상태(순수) — 판정기 재시도도 실패면 error, 문장에 안 붙어 남은 주장이 있으면 residual. */
export function factStateOf(r: Pick<FactRecord, 'final'>): NonNullable<LongformRecord['factState']> {
  if (r.final.status === 'error') return { status: 'error' };
  const n = r.final.residual?.length ?? 0;
  return n ? { status: 'residual', residual: n } : { status: 'ok' };
}

/** 재시도 — 사실 확인까지 끝난 대본(factgate.json 은 사실 확인 직후, script.json 은 그 뒤 낭독 바꿔 쓰기까지 반영). 없으면 null. */
function savedFactScript(dir: string): { script: LongformScript; record: FactRecord } | null {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'factgate.json'), 'utf8')) as FactRecord;
    return record?.final ? { script: loadEpisodeScript(dir), record } : null;
  } catch { return null; }
}

async function produce(rec: LongformRecord, topic: TopicChoice, d: LongformDeps, signal?: AbortSignal, bus?: EventBus, opts: { resume?: boolean } = {}): Promise<EpisodeResult> {
  const id = rec.id;
  const dir = d.store.absDir(rec);
  const spend0 = d.spendUsd();
  // 재시도 — 앞 실행 비용을 잃지 않게 이어 센다(장면 비용은 buildScenes 가 이번 실행분만 돌려준다 — 겹치지 않는다).
  const priorUsd = opts.resume ? rec.costUsd ?? 0 : 0;
  let ttsChars = 0;
  let sceneUsd = 0; // 장면 에이전트(Claude Code CLI 보고 비용 — LLM 원장 밖)
  const cost = () => Math.round((priorUsd + (d.spendUsd() - spend0) + ttsChars * LF_TTS_USD_PER_CHAR + sceneUsd) * 100) / 100;
  const stage = (progress: string, patch: Partial<LongformRecord> = {}) => { d.store.update(id, { progress, ...patch }); d.log(`${id} ${progress}`); bus?.emit('log', { message: `롱폼 ${progress}` }); };
  // 직원 배선(2026-10-23) — 대본·고쳐 쓰기는 한서윤, 썸네일 문구는 윤소이. 버스가 없으면 d.llmJSON(테스트는 가짜)에 역할 system 만 붙는다.
  const staff = (roleId: string, summary: string) => staffLlm(roleId, { ...(bus ? { bus } : {}), fallback: d.llmJSON, summary });
  const writerLlm = staff(LF_WRITER, '롱폼 대본');
  let sceneNote = '';
  const abortCheck = () => { if (signal?.aborted) throw new Error('취소됨'); };
  try {
    if (!dir) throw new Error(`폴더 이름이 안전하지 않음: ${rec.dir}`);
    fs.mkdirSync(dir, { recursive: true });
    // 재시도(resume)가 같은 주제로 잇게 남긴다.
    if (!opts.resume) fs.writeFileSync(path.join(dir, 'topic.json'), JSON.stringify(topic, null, 2));
    // 재시도 — 사실 확인까지 끝난 대본이 있으면 대본 작성·사실 확인을 건너뛴다(같은 문장이어야 낭독·클립·장면 캐시가 맞는다).
    const saved = opts.resume ? savedFactScript(dir) : null;

    // ── 대본 작성
    stage(saved ? '대본 이어 쓰기' : '대본 작성');
    const sources = await d.loadSources(topic.pieces.map((p) => p.id));
    fs.writeFileSync(path.join(dir, 'sources.md'), sources.map((s) => `# ${s.title} (${s.pieceId})\n\n${s.body}\n`).join('\n---\n\n'));
    const sourceText = sources.map((s) => s.body).join('\n\n');
    const brandMedia = d.media(rec.brand);
    const inventory = footageInventory(brandMedia);
    let script: LongformScript;
    let fact: { script: LongformScript; record: FactRecord };
    if (saved) {
      d.log(`${id} 재시도 — 사실 확인까지 끝난 대본을 그대로 씁니다`);
      fact = saved;
      script = saved.script;
      d.store.update(id, { title: script.title });
    } else {
      const w = await writeScript({
        topicLabel: topicLabel(topic.topic), anchorTitle: topic.anchor.title, ...(topic.theme ? { theme: topic.theme } : {}), sources, inventory, month: d.now().getMonth() + 1,
        llmJSON: writerLlm, signal, log: d.log, ...(topic.targetMinutes ? { targetMinutes: topic.targetMinutes } : {}),
      });
      script = w.script;
      // 편 주인공 수종(2026-10-23) — 주제 기준 글 수종(재고 있으면) → 장 수종 최다. 일반 장 화면·끼움 카드는 이 수종만.
      const hero = script.heroSpecies ?? pickHeroSpecies(topic.anchor.species ?? undefined, script, inventory);
      if (hero) script = { ...script, heroSpecies: hero };
      saveEpisodeScript(dir, script);
      d.store.update(id, { title: script.title });
      abortCheck();

      // ── 사실 확인
      stage('사실 확인');
      // 걸린 문장 고쳐 쓰기는 작가(한서윤) — 숏폼도 원문 정합 수정은 작가(writerRole)가 한다. 판정(factGateBlog)은 그대로.
      fact = await factCheckScript({ script, sourceText, gate: d.factGate, llmJSON: writerLlm, signal, log: d.log });
      script = fact.script;
      fs.writeFileSync(path.join(dir, 'factgate.json'), JSON.stringify({ ...fact.record, writer: { attempts: w.attempts, problems: w.problems } }, null, 2));
      saveEpisodeScript(dir, script);
      fs.writeFileSync(path.join(dir, 'script.txt'), scriptText(script));
    }
    // 판정 실패·남은 주장은 편을 멈추지 않는다 — 검토 알림 경고로.
    const factState = factStateOf(fact.record);
    d.store.update(id, { factState });
    if (factState.status !== 'ok') d.log(`${id} 사실 확인 경고 — ${factState.status === 'error' ? '판정 실패' : `남은 주장 ${factState.residual}건`}`);
    if (fact.record.final.issues.length) throw new Error(`대본 검사 문제 ${fact.record.final.issues.length}건 — ${fact.record.final.issues.slice(0, 3).join(' / ')}`);
    // 짧은 편(주제 v2, targetMinutes < 10)은 하한도 같은 비율로 — 8분 편이면 2,000자.
    const minChars = Math.round(MIN_CHARS_AFTER_FACT * Math.min(1, (topic.targetMinutes ?? 10) / 10));
    if (fact.record.final.chars < minChars) throw new Error(`사실 확인 뒤 대본이 ${fact.record.final.chars}자로 짧아짐(최소 ${minChars})`);
    abortCheck();

    // ── 낭독(발음 확인·바꿔 쓰기)
    await waitIdle(d, id, '낭독', signal);
    stage('낭독');
    const assetDeps = await d.assets();
    const baseIssues = validateScript(script, sourceText).length;
    const syn = await synthesizeAll(dir, script, {
      deps: assetDeps, signal, log: d.log,
      reword: (seg, heard, sig) => rewordForPronunciation({ narration: seg.narration, heard, llmJSON: d.llmJSON, signal: sig }),
      // 바꿔 쓴 문장이 시기·수치 검사를 새로 깨면 받지 않는다.
      accept: (next) => validateScript(next, sourceText).length <= baseIssues,
    });
    script = syn.script;
    ttsChars += syn.ttsChars;
    d.store.update(id, {
      sttFailed: syn.sttFailed.length, sttTotal: syn.segmentCount, pronSuspectCount: syn.suspects.length,
      pronSuspect: syn.suspects.slice(0, 5).map((x) => ({ id: x.id, text: x.text.slice(0, 40), score: Math.round(x.score * 1000) / 1000, ...(x.mismatch ? { mismatch: x.mismatch } : {}) })),
    });
    // 받아쓰기가 절반 넘게 실패해도 편은 끝까지 간다(발음 확인만 못 한 것) — 검토 알림 경고로.
    if (syn.sttFailed.length * 2 > syn.segmentCount) d.log(`${id} 받아쓰기 실패 ${syn.sttFailed.length}/${syn.segmentCount}문장 — 발음 확인 없이 진행`);
    if (syn.rewordCount) fs.writeFileSync(path.join(dir, 'script.txt'), scriptText(script));
    abortCheck();

    // ── 실촬영 배정 + 올릴 글
    stage('실촬영 배정');
    const asm = await assembleTimeline(dir, script, syn.durations, brandMedia, { deps: assetDeps, signal, log: d.log });
    const yt = buildYoutubeMeta(script, asm.timeline);
    d.store.update(id, { ytTitle: yt.title, ytDescription: yt.description, ytTags: yt.tags, durationSec: Math.round(asm.timeline.totalFrames / 30) });
    abortCheck();

    // ── 수종 형태(전체 화면만 — 키트에 없는 수종 프리셋은 서다인, 실물 대조용 사진). 실패해도 일반형으로 간다.
    const full = d.layout.stage === 'full' ? d.layout : undefined;
    let speciesNote = '';
    if (full) {
      stage('수종 형태');
      try {
        // 재시도 — 지난 실행의 수종 표·_species.ts 가 있으면 그대로(다시 쓰면 EP_SPECIES id·모양이 바뀌어 이미 그린 장면이 깨진다).
        const prev = saved && fs.existsSync(path.join(dir, SCENE_DIR, SPECIES_MODULE)) ? loadSpeciesIndex(dir) : null;
        if (prev) d.log(`${id} 재시도 — 지난 수종 형태를 그대로 씁니다`);
        const sx = prev ?? await d.species({ dir, script, media: brandMedia, sourceText, ...(signal ? { signal } : {}) });
        speciesNote = sx.species.map((e) => `${e.nameKo} ${e.source === 'builtin' ? '내장' : e.source === 'episode' ? '새 프리셋' : '일반형'}·사진 ${e.refs.length}${e.commons?.length ? `·도감 ${e.commons.length}` : ''}`).join(', ');
        d.log(`${id} 수종 형태 — ${speciesNote || '수종 없음'}`);
      } catch (e) { d.log(`${id} 수종 형태 실패(일반형으로 진행): ${e instanceof Error ? e.message : String(e)}`); }
      abortCheck();
    }

    // ── 그림(문장마다 모션그래픽 — 별도 장면 단계)
    stage('그림');
    // 오피스: 차민혁이 그림 단계 내내 '렌더링 중'(팀 phase integrate) — 장면은 Claude Code 세션이 그리므로 runAgent 스폰이 없다.
    const designer = bus ? staffRole(LF_DESIGNER) : undefined;
    if (bus && designer) { emitStaffSpawn(bus, designer, CONFIG.cloudTierModels.heavy); staffOfficeStart(bus, designer, { phase: 'integrate', summary: '문장 그림' }); }
    // 재시도는 이미 그린 장면 파일을 두고 빠진 것만(buildScenes resume — 대본을 그대로 이어 써서 문장이 같다).
    const sceneOpts = saved ? { resume: true } : undefined;
    const fullMode: SceneStageMode | undefined = full ? { stage: 'full', style: full.style, ...(full.presenter ? { presenter: true } : {}) } : undefined;
    const segs = asm.timeline.segments;
    const sc = sceneOpts ? await d.buildScenes(dir, segs, signal, fullMode, sceneOpts) : fullMode ? await d.buildScenes(dir, segs, signal, fullMode) : await d.buildScenes(dir, segs, signal);
    sceneUsd += sc.costUsd ?? 0;
    d.store.update(id, { sceneBuilt: sc.built, sceneTotal: asm.timeline.segments.length });
    sceneNote = `장면 ${sc.built}/${asm.timeline.segments.length}${sc.review ? ` · 검토 다시 그림 ${sc.review.redone}/${sc.review.redo}${sc.review.skipped ? `(${sc.review.skipped.slice(0, 40)})` : ''}` : ''}`;
    d.log(`${id} 그림 ${sceneNote}${sc.costUsd ? ` · $${sc.costUsd}` : ''}`);
    if (bus && designer) { staffSay(bus, LF_DESIGNER, `롱폼 그림 ${sceneNote}`); bus.emit('phase', { team_id: LF_TEAM, phase: 'work' }); }
    abortCheck();

    // ── 렌더
    await waitIdle(d, id, '렌더', signal);
    stage('렌더 0%');
    const onProgress = (pct: number) => { if (pct % 10 === 0) d.store.update(id, { progress: `렌더 ${pct}%` }); };
    const r = full
      ? await renderEpisodeFull(dir, { deps: await d.render(), style: full.style, ...(full.presenter ? { presenter: true } : {}), signal, log: d.log, mediaSpecies: d.mediaSpecies, onProgress, ...(sc.entryPoint ? { entryPoint: sc.entryPoint } : {}) })
      : await renderEpisode(dir, { deps: await d.render(), signal, log: d.log, ...(sc.entryPoint ? { entryPoint: sc.entryPoint } : {}), onProgress });
    abortCheck();

    // ── 썸네일(가로 손글씨 — 실패해도 편은 완성, 텔레그램 '썸네일 다시'로)
    stage('썸네일', { thumbState: 'pending' });
    const th = await d.thumbnail({ dir, title: r.yt.title, description: r.yt.description, keyword: script.keywords?.[0], signal, copyLlm: staff('image_designer', '롱폼 썸네일 문구') })
      .catch(() => ({ generated: false, state: 'none' as const }));

    // ── 완성
    const done = d.store.update(id, {
      stage: 'ready', progress: undefined, error: undefined, durationSec: r.durationSec, thumbState: th.state,
      title: script.title, ytTitle: r.yt.title, ytDescription: r.yt.description, ytTags: r.yt.tags, costUsd: cost(),
    })!;
    d.log(`${id} 완성 — ${r.durationSec}초 · 렌더 ${r.renderSec}초 · 비용 약 $${done.costUsd}`);
    noteEnd(d, `[롱폼 완성] ${script.title.slice(0, 30)} — ${Math.floor(r.durationSec / 60)}분 ${r.durationSec % 60}초 · ${full ? `전체 화면 ${full.style} · ` : ''}${sceneNote || '장면 없음'}${speciesNote ? ` · 수종 ${speciesNote}` : ''} · 사실 확인 고침 ${fact.record.revised.length}·뺌 ${fact.record.dropped.length} · 비용 약 $${done.costUsd}`);
    if (bus) bus.emit('phase', { team_id: LF_TEAM, phase: 'idle' });
    pruneEpisodeWork(dir, d.log);
    // 검토 알림(발행 버튼)이 안 나가면 글자 알림으로라도 — 부팅·하루 한 번 재발송(resendLongformNotices)이 버튼 알림을 다시 시도한다.
    if (!(await d.notifyReady(done).catch(() => false))) {
      d.log(`${id} 검토 알림 전송 실패 — 글자 알림으로 대신`);
      await d.notifyFail(`🎞 롱폼 완성 — 검토 알림 전송 실패 · ${script.title}`, '썸네일·발행 버튼 알림을 보내지 못했습니다. 제작실 롱폼 탭에서 확인하세요(곧 다시 보냅니다).').catch(() => {});
    }
    return { ok: true, id };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const cur = d.store.get(id);
    d.store.update(id, { stage: 'error', error: `${cur?.progress ?? ''} 단계 실패: ${error}`.trim(), progress: undefined, costUsd: cost(), ...(cur?.thumbState === 'pending' ? { thumbState: 'none' } : {}) });
    d.log(`${id} 실패 — ${error}`);
    noteEnd(d, `[롱폼 실패] ${(cur?.title ?? id).slice(0, 30)} — ${cur?.progress ?? ''} 단계: ${error.slice(0, 120)}${sceneNote ? ` · ${sceneNote}` : ''} · 비용 약 $${cost()}`);
    if (bus) bus.emit('phase', { team_id: LF_TEAM, phase: 'idle' });
    // 사람이 취소한 것은 실패가 아니다 — 짧게만.
    if (signal?.aborted) await d.notifyFail(`🎞 롱폼 제작 취소됨 · ${cur?.title ?? id}`, `${cur?.progress ?? ''} 단계에서 취소했습니다.`).catch(() => {});
    else await d.notifyFail(`⚠️ 롱폼 제작 실패 · ${cur?.title ?? id}`, `${cur?.progress ?? ''} 단계에서 멈췄습니다: ${error}\n고른 이유: ${topic.reason}`).catch(() => {});
    return { ok: false, id, error };
  }
}

/**
 * 완성 직후 작업 중간물 걷기(2026-10-23) — 음나무 편 scenes/work 2.1GB(에이전트 기록·미리보기)·scenes/stills 1.0GB 가
 * 새벽 정리까지 남아 있었다. 장면 파일(sNNN.tsx)·대조표·낭독·클립은 남겨 다시 렌더할 수 있다(번들·스틸은 렌더 때 다시 생긴다).
 * fail-open — 못 지워도 편은 완성이고, 03:30 janitor 가 같은 대상을 다시 본다.
 */
export const EPISODE_WORK_DIRS = ['scenes/work', 'scenes/stills', 'scenes/.render', 'remotion-full/bundle', 'remotion-full/stills', 'remotion/bundle'] as const;
export function pruneEpisodeWork(dir: string, log: (m: string) => void = () => {}): void {
  for (const rel of EPISODE_WORK_DIRS) {
    try { fs.rmSync(path.join(dir, rel), { recursive: true, force: true }); } catch (e) { log(`중간물 정리 실패 ${rel}: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

/** 편 끝 기록(작가·디자이너 activity.log) — 실패해도 편 결과에는 영향 없음. */
function noteEnd(d: LongformDeps, line: string): void {
  for (const roleId of [LF_WRITER, LF_DESIGNER]) { try { d.noteActivity(roleId, line); } catch { /* 기록만 잃는다 */ } }
}
