/**
 * 숏폼 파이프라인 — 숏폼팀(standby)이 전담하는 전용 경로. 블로그 org 런과 무관.
 *
 * 기획(shorts_writer LLM: 훅·씬·내레이션·화면텍스트·제목3·해시태그) → 디자인(shorts_director
 * LLM: 씬별 세로 비주얼 프롬프트) → 씬 이미지(gpt-image-2, 1024×1536 세로·무텍스트) →
 * 조립(shortsRender: Pillow 자막 프레임 + TTS 내레이션 + ffmpeg 1080×1920 MP4).
 *
 * 실행 모델: 카드뉴스와 동일 — 서버가 launch 래퍼로 런 등록(오피스 뷰 연동), 프론트는 GET 폴링.
 * 직원 프롬프트는 회사 로스터(company.yaml)의 system_prompt 를 그대로 사용.
 */
import fs from 'node:fs';
import { SELLER_INQUIRY_BAN, NO_FABRICATED_EXPERIENCE } from './org';
import { lexiconGuide, mediaRulesGuide, varietyGuide } from '../content/brand';
import path from 'node:path';
import { CONFIG } from '../config';
import { microJSON, runAgent, extractFirstJson } from './agent';
import { getCompany } from '../agents/company-loader';
import { rolesById } from '../agents/company';
import { stripEmoji } from '../output/render';
import { shortsStore, shortsFactHoldBlockReason, type Shorts } from '../content/shorts';
import { platformPlanGuide, platformLabel, SIBLING_PREVIEW_FILE } from '../content/shortsPlatform';
import { writerById, writerByName, type ShortsWriter } from '../content/shortsWriters';
import { notifyShortsReady } from '../autonomy/contentNotify';
import { generateImagesForDraft } from '../tools/blog_skills';
import { qaSceneImages } from './shortsSceneQa';
import { applyMotionGraphics } from './shortsDirectMotion';
import { parseSceneMust, mustDesignerGuide, mustPromptLines, type SceneMust } from './sceneMust';
export { parseSceneMust } from './sceneMust';
import { qaSceneClips } from './shortsClipQa';
import { standaloneIssues, parityIssues, parityIssuesChecked, parityToInfo, PARITY_SOURCE_CHARS } from './standaloneQa';
import { timingParityIssues, formatTimingIssue, stripUnsourcedStatOverlays } from '../content/timingParity';
import type { FactGateInfo } from '../content/factGate';
import { isJudgmentSentence, preNotifyProblems, preNotifyAccept, diceSimilarity } from '../content/factGate';
import { SOURCE_ANCHOR_GUIDE, anchorsOf, anchorIssues, withAnchor, anchorOn } from '../content/sourceAnchor';
import type { ShortsPlatform } from '../content/shortsPlatform';
import { narrationStyleIssues, hookKeywordLeadIssues, hookLengthIssues, metaSummaryIssues, screenTextLabelIssues, monthWordOutsideNarration, compressionRelintProbs, closingSceneIssues, announcesNextEpisode, stripNextEpisode, mentionsNextEpisode, screenTextAnnounces, isPromiseSentence } from '../content/styleLint';
import { promiseStore, MAX_PENDING } from '../content/promises';
import { i2vSceneClips, i2vGate } from './shortsSceneClips';
import { directSceneMotion, detectSubjectScenes, selectI2vScenes } from './shortsMotionDirector';
import { renderShortsVideo, ensureShortsDownload, extractFirstFrame, cutVideoSegment, markThumbPending, clearThumbPending } from '../tools/shortsRender';
import { renderShortsVideoRemotion } from '../tools/shortsRenderRemotion';
import { generateDesignedThumbnail, thumbTextQaFailed, type ThumbCopy } from './shortsThumbnail';
import { inheritShortsAssets, inheritedSceneImages, inheritedClips, reviseClipsFor, reviseImagesFor, readSceneImageMap, writeSceneImageMap } from '../content/shortsInherit';
import { SOURCES_FILE, type UsageSource } from '../content/mediaUsage';
import { FOOTAGE_PARTS, NOW_RE, hookContradictsFootage } from '../content/footageState';
export { hookContradictsFootage };
import { findSpecies, findSpeciesLoose, speciesNamesIn, speciesAnchor, speciesSeasonalHint, appendSpecies, speciesNameFrom, normalizeLatinName, isYoungHero } from '../content/species';
export { isYoungHero };
import { isContainerTopic } from '../analytics/igAxis';
import { shortsGenreOf, genreGuide, genreSceneGuide, loreHookGuide, loreHookSource, type ShortsGenre } from '../content/shortsGenre';
import { planAssetScenes, styleRefs, planVideoSegments, orderAssetsByAssignment, SEGMENT_TAIL_SEC, type VideoSegment } from '../content/userAssets';
import { spareWindows, windowSceneSec, usableStart } from '../content/mediaRotation';
import { describeUserMedia, mediaPlanGuide, assignMediaToScenes, speciesRefFrame, clipMidFrame } from './shortsMediaBrief';
import { generateTitleArt } from './shortsTitleArt';
import { uploadShortsToYoutube } from '../tools/youtubeUpload';
import { blogUrlForPiece } from '../content/pieces';
import { brandContext, getBrand } from '../content/brand';
import { priorCoverageBrief, recentPhrasesToAvoid, OVERUSED_LEXEME_GUIDE } from '../content/priorCoverage';
import type { ShortsScene } from '../tools/shortsRender';
import { normalizeSceneKind, emptyKindScenes, dropEmptyKinds, bodyKindCoverage, fxSeed, varyLayout, fixMonthNames, cutAtWordBoundary, probeDuration, teaserFor, teaserSceneIndex, sceneFrames, midcutAt, planSpareClips, FPS } from '../tools/shortsCommon';
import { inheritedClaims, formatInherited, writerSource } from '../content/inheritedClaims';
import { classifyTitleType } from '../analytics/titleTiming';
import type { EventBus } from '../events/bus';

const RUNNING = new Set<string>();
export function isShortsRunning(id: string): boolean { return RUNNING.has(id); }

const PRESETS = new Set(['photorealistic', 'manhwa', 'watercolor', 'ink_wash', 'flat_design', 'retro_poster']);
const PRESET_ALIAS: Record<string, string> = {
  '사진풍': 'photorealistic', '수채화풍': 'watercolor', '플랫 일러스트': 'flat_design', '만화풍': 'manhwa',
};

const stdModel = (): string => CONFIG.cloudTierModels.standard;

interface Plan {
  title: string;
  titles: string[];
  scenes: ShortsScene[];
  description: string;
  hashtags: string[];
  /** 다음 편 예고 — CTA 에 예고를 넣었을 때만 작가가 선언(예고 대장 등록 → 자율 틱이 시기 도래 시 이행). */
  next?: { topic: string; window?: string };
  /** 원문 정합 잔존(스펙 §2-4) — 정합 문제로 수정 라운드를 돌았을 때만 재판정해 채운다. 표시 전용. */
  factGate?: FactGateInfo;
  /** 씬별 원문 근거 문장(2026-10-15, SHORTS_SOURCE_ANCHOR) — 작가가 짚은 원문 문장. 원문 대조 판정에 씬과 나란히 싣는다. */
  anchors?: string[];
}

interface JobIO { bus?: EventBus; signal?: AbortSignal }

/** 수정 요청(자유 피드백) 개정안 — LLM 이 '바뀐 것만' 돌려준다. 적용은 applyShortsRevision(순수)이 검증. */
export interface ShortsRevision {
  title?: unknown; description?: unknown; hashtags?: unknown;
  scenes?: Array<{ index?: unknown; narration?: unknown; screenText?: unknown; regen_image?: unknown; image_note?: unknown; quote?: { text?: unknown; source?: unknown } | null } | null>;
  /** 상단 캘리 문구(영상 오버레이·썸네일 공용 카피, title-copy.json) — 바뀔 때만. */
  titleArt?: { line1?: unknown; line2?: unknown; points?: unknown } | null;
}

/** 개정안 적용(순수, 테스트 대상) — 번호 범위·빈 문자열·길이 상한 검증, 유효 변경 없으면 null.
 *  regen_image 로 표시된 씬만 배경 이미지를 다시 그린다(내레이션·자막만 바뀌면 재조립만으로 충분).
 *  titleCopy(현 캘리 카피)가 주어지면 titleArt 문구 변경도 검증한다 — 없으면 titleArt 는 무시. */
export function applyShortsRevision(
  plan: Plan, cand: ShortsRevision | null,
  titleCopy?: { line1: string; line2: string; points?: string[] } | null,
): { plan: Plan; changedScenes: number[]; regenScenes: number[]; imageNotes: Map<number, string>; titleChanged: boolean; metaChanged: boolean; titleArtCopy: { line1: string; line2: string; points: string[] } | null } | null {
  if (!cand) return null;
  const out: Plan = { ...plan, scenes: plan.scenes.map((s) => ({ ...s })) };
  const changed: number[] = []; const regen: number[] = [];
  const imageNotes = new Map<number, string>();
  let titleChanged = false; let metaChanged = false;
  const str = (v: unknown, max: number): string => {
    const s = typeof v === 'string' ? stripEmoji(v).trim() : '';
    return s && s.length <= max ? s : '';
  };
  for (const s of cand.scenes ?? []) {
    const idx = typeof s?.index === 'number' && Number.isInteger(s.index) ? s.index : 0; // 1-base
    if (idx < 1 || idx > plan.scenes.length) continue;
    const narration = str(s?.narration, 240);
    const screenText = str(s?.screenText, 60);
    const wantRegen = s?.regen_image === true;
    // quote 편집은 kind='quote' 씬에만 허용 — 다른 씬에 quote 를 보내도 무시(§6a).
    const q = s?.quote && typeof s.quote === 'object' ? s.quote as { text?: unknown; source?: unknown } : null;
    const curScene = out.scenes[idx - 1]!;
    const quoteText = curScene.kind === 'quote' && q ? str(q.text, 40) : '';
    const quoteSource = curScene.kind === 'quote' && q ? cutAtWordBoundary(str(q.source, 60), 15) : '';
    if (!narration && !screenText && !wantRegen && !quoteText && !quoteSource) continue;
    const cur = curScene;
    const next = {
      ...cur,
      ...(narration ? { narration } : {}),
      ...(screenText ? { screenText } : {}),
      ...(quoteText || quoteSource
        ? { quote: { text: quoteText || cur.quote?.text || '', ...(quoteSource ? { source: quoteSource } : (cur.quote?.source ? { source: cur.quote.source } : {})) } }
        : {}),
    };
    const textChanged = next.narration !== cur.narration || next.screenText !== cur.screenText || JSON.stringify(next.quote) !== JSON.stringify(cur.quote);
    if (textChanged) { out.scenes[idx - 1] = next; changed.push(idx); }
    if (wantRegen) {
      regen.push(idx);
      if (!textChanged) changed.push(idx);
      const note = str(s?.image_note, 200);
      if (note) imageNotes.set(idx, note);
    }
  }
  const title = str(cand.title, 60);
  if (title && title !== plan.title) { out.title = title; titleChanged = true; }
  const description = str(cand.description, 600);
  if (description && description !== plan.description) { out.description = description; metaChanged = true; }
  if (Array.isArray(cand.hashtags)) {
    const tags = cand.hashtags.filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => (t.trim().startsWith('#') ? t.trim() : `#${t.trim()}`)).slice(0, 15);
    if (tags.length && JSON.stringify(tags) !== JSON.stringify(plan.hashtags ?? [])) { out.hashtags = tags; metaChanged = true; }
  }
  // 상단 캘리 문구 — 현 카피 대비 실변경만 인정(1줄=키워드 라벨 위계 유지, 미지정 필드는 현행 유지).
  let titleArtCopy: { line1: string; line2: string; points: string[] } | null = null;
  if (cand.titleArt && titleCopy) {
    const line1 = str(cand.titleArt.line1, 30) || titleCopy.line1;
    const line2 = str(cand.titleArt.line2, 30) || titleCopy.line2;
    const reqPoints = Array.isArray(cand.titleArt.points)
      ? cand.titleArt.points.map((p) => str(p, 40)).filter(Boolean).slice(0, 5) : [];
    const points = reqPoints.length ? reqPoints : (titleCopy.points ?? []);
    if (line1 !== titleCopy.line1 || line2 !== titleCopy.line2 || JSON.stringify(points) !== JSON.stringify(titleCopy.points ?? [])) {
      titleArtCopy = { line1, line2, points };
    }
  }
  if (!changed.length && !regen.length && !titleChanged && !metaChanged && !titleArtCopy) return null;
  return {
    plan: out, changedScenes: [...new Set(changed)].sort((a, b) => a - b),
    regenScenes: [...new Set(regen)].sort((a, b) => a - b), imageNotes, titleChanged, metaChanged, titleArtCopy,
  };
}

/** 수정 요청·재검산용 원문 묶음 — 원문 블로그 본문, 원문 게이트가 미확인으로 둔 문장, 이야기 사실(재배 편 훅 소재). */
export interface ShortsSource { body: string; flagged?: string[]; lore?: string[] }

/**
 * 수정 요청 뒤 사실 검증 다시 계산(2026-10-14 사장님 요청) — 사람이 지적 문장을 고쳐도 옛 보류(factGate)가 그대로 남아
 * 발행 때 확인을 또 받던 구멍. 생성 때와 같은 원문(이야기 사실 포함)·같은 세 축(원문 정합·시기·수치·승계)으로 다시 잰다.
 * 판정 실패면 null — 호출부는 옛 값을 그대로 둔다(실패를 '통과'로 읽지 않는다). 사람 수정은 자동으로 고쳐 쓰지 않는다.
 */
export async function recheckShortsFactGate(plan: Plan, topic: string, src: ShortsSource, signal?: AbortSignal): Promise<FactGateInfo | null> {
  const loreSrc = CONFIG.shortsLore && shortsGenreOf(topic, CONFIG.shortsLore) === 'howto' ? loreHookSource(src.lore ?? []) : '';
  const body = loreSrc ? `${src.body}\n\n${loreSrc}` : src.body;
  const texts = plan.scenes.map((s) => `${s.narration}${s.screenText ? ` (자막: ${s.screenText})` : ''}`
    + (s.takeaways?.length ? ` (결론: ${s.takeaways.map((t) => `${t.when} → ${t.then}`).join(', ')})` : '')
    + (s.items?.length ? ` (목록: ${s.items.join(', ')})` : ''));
  const issues = CONFIG.factGate ? await parityIssuesChecked('유튜브 숏폼 대본(씬 내레이션)', texts, body, signal) : [];
  if (!issues) return null;
  const display = [
    ...timingParityIssues(body, timingFields(plan)).map(formatTimingIssue),
    ...(src.flagged?.length ? inheritedClaims(src.flagged, timingFields(plan), 5, src.body) : []).map(formatInherited),
  ];
  const base = parityToInfo(issues);
  return display.length ? { ...base, timing: display } : base;
}

/**
 * 숏폼 수정 요청(검토 탭) — 피드백을 LLM 이 해석해 대본(내레이션·화면텍스트)·제목·설명·상단 캘리 문구를
 * 개정하고, 이미지 재생성이 필요한 씬만 다시 그린 뒤 재조립한다. 재사용: 무변경 씬 배경·I2V 클립·제목 캘리
 * (제목·캘리 문구가 안 바뀐 경우). 내레이션 TTS 는 조립 과정에서 전 씬 재합성된다(오독 교정 사전 적용).
 * 발행(유튜브 업로드·릴스) 이후엔 파일 교체가 불가하므로 거절한다.
 */
export async function reviseShorts(
  id: string, feedback: string,
  opts: { bus?: EventBus; signal?: AbortSignal; source?: ShortsSource } = {},
): Promise<{ ok: boolean; error?: string; changedScenes: number[]; regenScenes: number[]; titleChanged: boolean; titleArtChanged: boolean }> {
  const store = shortsStore();
  const short = store.get(id);
  const fail = (error: string) => ({ ok: false as const, error, changedScenes: [], regenScenes: [], titleChanged: false, titleArtChanged: false });
  if (!short) return fail('unknown shorts');
  if (short.stage !== 'ready') return fail('완성(ready) 상태가 아닙니다');
  if (short.youtubeUrl || short.igReelId) return fail('이미 업로드/발행됨 — 발행물 영상은 교체할 수 없습니다(새 파생 생성 필요)');
  if (RUNNING.has(id)) return fail('생성/수정 작업이 이미 진행 중입니다');
  RUNNING.add(id);
  const say = (m: string): void => { console.log(`[숏폼] ${m}`); opts.bus?.emit('log', { message: m }); };
  try {
    const dir = store.dirFor(id);
    let plan: Plan;
    try { plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8')) as Plan; }
    catch { return fail('plan.json 없음 — 수정 불가'); }
    const cur = plan.scenes.map((s, i) => `${i + 1}. [내레이션] ${s.narration}${s.screenText ? ` [화면텍스트] ${s.screenText}` : ''}`).join('\n');
    // 상단 캘리 카피 — 수정 LLM 입력에 포함해야 '캘리 문구만 있는 단어'(예: 훅 줄의 표현)를 겨냥한
    // 요청이 좌초하지 않는다(대본에 없는 단어라 씬 매칭 0 → 무변경 재조립 '수정 완료' 오보고 사고).
    let artCopy: ThumbCopy | null = null;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir, 'title-copy.json'), 'utf-8')) as Partial<ThumbCopy>;
      if (typeof c?.line1 === 'string' && c.line1.trim()) {
        artCopy = {
          line1: c.line1, line2: typeof c.line2 === 'string' ? c.line2 : '',
          points: Array.isArray(c.points) ? c.points.filter((p): p is string => typeof p === 'string') : [],
        };
      }
    } catch { /* 캘리 카피 없음 — titleArt 경로 비활성 */ }
    const j = await microJSON<ShortsRevision>(
      stdModel(),
      '당신은 숏폼 대본 에디터입니다. 요청된 JSON 스키마만 출력합니다.',
      [
        '아래 숏폼에 대한 검토자의 수정 요청을 반영해, "바뀌는 항목만" 돌려줘라. 요청과 무관한 씬·필드는 출력하지 마라.',
        `[제목] ${plan.title}`,
        `[씬]\n${cur}`,
        `[설명] ${plan.description}`,
        ...(artCopy ? [`[상단 캘리 문구(영상 오버레이·썸네일 공용)] 1줄(키워드 라벨): ${artCopy.line1}${artCopy.line2 ? ` / 2줄(훅): ${artCopy.line2}` : ''}${artCopy.points.length ? ` / 포인트: ${artCopy.points.join(' · ')}` : ''}`] : []),
        `[수정 요청] ${feedback}`,
        '규칙: 의미·톤 유지 범위에서 요청을 빠짐없이 반영, 내레이션 길이는 원문과 비슷하게(재생 시간 유지), 이모지 금지.',
        // 수정 경로에도 같은 문장 원칙(2026-10-12) — 기획에만 걸면 사람 수정 요청이 다시 어긋나게 만든다.
        ...(mediaRulesGuide() ? [mediaRulesGuide()] : []),
        '배경 그림 자체를 바꿔야 하는 요청(장면·소품·구도)이면 그 씬에 "regen_image":true 와 "image_note":"무엇을 어떻게"를 넣어라. 문구만 바뀌면 넣지 마라(배경은 무텍스트).',
        ...(artCopy ? ['상단 캘리 문구를 바꿔야 하는 요청이면 "titleArt" 에 바뀐 필드만 넣어라 — 1줄은 핵심 키워드 라벨(정확 표기 유지), 2줄은 짧은 훅. 캘리 문구와 무관한 요청이면 titleArt 를 넣지 마라.'] : []),
        '인용구(quote) 씬의 문구·출처를 바꾸는 요청이면 해당 씬에 "quote":{"text":"...","source":"..."}(바뀐 필드만)를 넣어라 — quote 씬이 아니면 넣지 마라. source 는 실제 원문에 있는 출처만 적어라(지어내지 마라).',
        `JSON 형식: {"scenes":[{"index":씬번호,"narration":"...","screenText":"...","regen_image":false,"image_note":"...","quote":{"text":"...","source":"..."}}],"title":"...","description":"...","hashtags":["#..."]${artCopy ? ',"titleArt":{"line1":"...","line2":"...","points":["..."]}' : ''}} — 바뀌는 필드만 포함.`,
      ].join('\n'),
      { maxOutputTokens: 1600, signal: opts.signal },
    ).catch(() => null);
    const applied = applyShortsRevision(plan, j, artCopy);
    if (!applied) return fail('수정 요청에서 반영할 변경을 찾지 못했습니다 — 요청을 더 구체적으로 써 주세요');
    plan = applied.plan;
    // 사실 검증 다시(2026-10-14) — 대본이 바뀌었으면 옛 보류를 새 대본 기준으로 갈아 끼운다. 판정 실패면 옛 값 유지.
    let factGate = short.factGate;
    if (opts.source?.body && (applied.changedScenes.length || applied.titleChanged)) {
      const fg = await recheckShortsFactGate(plan, short.topic, opts.source, opts.signal).catch(() => null);
      if (fg) {
        const n = (g: FactGateInfo | undefined): number => (g?.status === 'hold' ? g.unsupported.length : 0) + (g?.timing?.length ?? 0);
        say(`사실 검증 다시 — 남은 지적 ${n(short.factGate)}→${n(fg)}건`);
        factGate = fg; plan = { ...plan, factGate: fg };
      } else say('사실 검증 다시 — 판정 실패, 이전 결과 유지');
    }
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
    store.update(id, { title: plan.title, topic: plan.title, description: plan.description, hashtags: plan.hashtags, ...(factGate ? { factGate } : {}) });
    say(`수정 요청 반영 — 씬 ${applied.changedScenes.join(',') || '없음'}${applied.regenScenes.length ? ` · 배경 재생성 ${applied.regenScenes.join(',')}` : ''}${applied.titleChanged ? ' · 제목' : ''}${applied.titleArtCopy ? ' · 캘리 문구' : ''}`);

    // 씬 배경 재구성(2026-09-18 수정) — 씬 인덱스 지도(scene-images.json)가 진실, 없으면 매니페스트
    // 순서. 종전엔 bg-manifest.json 을 씬 번호로 읽었는데 그건 슬롯 순서(덮인 씬 제외)라 실촬영 씬
    // 뒤의 배경이 한 칸씩 당겨지고 마지막 씬이 비었다 — reviseImagesFor 참고. regen 씬만 새로 그림
    // (bg-draft 프롬프트 재사용).
    let manifestImages: Array<string | null> = [];
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'bg-manifest.json'), 'utf-8')) as { images?: Array<{ file_path?: string; error?: string } | null> };
      // 자리 보존 — 실패 슬롯은 null 로 남긴다(걸러내면 뒤가 당겨진다).
      manifestImages = (m.images ?? []).map((im) => {
        const fp = im?.file_path ? String(im.file_path) : '';
        return fp && !im?.error && fs.existsSync(fp) ? fp : null;
      });
    } catch { /* 매니페스트 없음 — 지도만 본다 */ }
    const images: Array<string | null> = reviseImagesFor(readSceneImageMap(dir, plan.scenes.length), manifestImages, plan.scenes.length);
    if (applied.regenScenes.length) {
      let slots: Array<{ prompt?: string }> = [];
      try { slots = (JSON.parse(fs.readFileSync(path.join(dir, 'bg-draft.json'), 'utf-8')) as { imageSlots?: Array<{ prompt?: string }> }).imageSlots ?? []; } catch { /* 프롬프트 없음 */ }
      const rd = {
        imageSlots: applied.regenScenes.map((k) => ({
          alt: plan.scenes[k - 1]!.screenText || plan.scenes[k - 1]!.narration.slice(0, 30),
          prompt: (slots[k - 1]?.prompt ?? '') + (applied.imageNotes.get(k) ? `\n[장면 수정 — 최우선] ${applied.imageNotes.get(k)}` : ''),
        })),
      };
      if (rd.imageSlots.every((s) => s.prompt.trim())) {
        const rdPath = path.join(dir, 'revise-draft.json');
        const rmPath = path.join(dir, 'revise-manifest.json');
        fs.writeFileSync(rdPath, JSON.stringify(rd, null, 2), 'utf-8');
        say(`씬 배경 재생성 — ${applied.regenScenes.join(',')}`);
        const rr = await generateImagesForDraft(rdPath, path.join(dir, 'revise-imgs'), rmPath,
          { limit: rd.imageSlots.length, size: '1024x1536', timeoutMs: 150_000 * rd.imageSlots.length }, opts.signal);
        if (rr.ok) {
          try {
            const rm = JSON.parse(fs.readFileSync(rmPath, 'utf-8')) as { images?: Array<{ file_path?: string; error?: string } | null> };
            applied.regenScenes.forEach((k, i) => {
              const fp = rm.images?.[i]?.file_path ? String(rm.images[i]!.file_path) : '';
              if (fp && !rm.images?.[i]?.error && fs.existsSync(fp)) { images[k - 1] = fp; delete plan.scenes[k - 1]?.focus; } // 새 그림 — 옛 초점 무효
            });
          } catch { /* 기존 배경 유지 */ }
        } else say('씬 배경 재생성 실패 — 기존 배경 유지');
      } else say('씬 프롬프트 원본 없음(bg-draft) — 배경 재생성 생략');
    }
    // 클립 재사용(2026-09-18 수정) — 종전엔 clip_NN.mp4 존재만 봐서 실촬영(user_NN.mp4)을 못 찾았다.
    // 훅(0)이 실촬영으로 덮인 편을 수정하면 그 씬이 이미지도 클립도 없이 그라데이션으로 퇴화했다
    // (SHORTS_HOOK_FOOTAGE 로 훅 실촬영이 늘면서 드러남). inheritedClips 로 실촬영을 먼저 찾고,
    // 재생성 씬에서도 실촬영은 유지한다 — reviseClipsFor 참고(배경 재생성은 실촬영 씬과 무관하다).
    const clips: Array<string | null> = reviseClipsFor(inheritedClips(dir, plan.scenes.length), applied.regenScenes);
    // 이미지도 클립도 없는 씬은 렌더러 그라데이션 — 편 폴더 밖 첨부 사진은 지도에 못 담겨 여기로 온다(reviseImagesFor 참고). 로그만.
    const bare = plan.scenes.map((_, i) => i + 1).filter((k) => !images[k - 1] && !clips[k - 1]);
    if (bare.length) say(`배경 없는 씬 ${bare.join(',')} — 그라데이션 폴백`);
    // 제목 캘리 — 제목/캘리 문구가 바뀌면 재생성, 아니면 기존 에셋 재사용(카피는 title-copy.json).
    let titleArt: { imagePath: string; copy: ThumbCopy } | null = null;
    if (CONFIG.shortsTitleOverlay) {
      const artPath = path.join(dir, 'title-art.png');
      if (applied.titleArtCopy || applied.titleChanged || !fs.existsSync(artPath)) {
        titleArt = await generateTitleArt({
          dir, title: plan.title, description: plan.description, titles: plan.titles, keyword: short.keyword, signal: opts.signal,
          ...(applied.titleArtCopy ? { copy: applied.titleArtCopy } : {}),
        });
        // 캘리 문구 교체가 핵심 요청인데 재생성이 실패하면 구 문구 그대로 '수정 완료'가 나간다 — 정직하게 실패.
        if (!titleArt && applied.titleArtCopy) return fail('상단 캘리 재생성 실패(생성/QA) — 잠시 후 다시 시도해 주세요');
        say(titleArt ? `상단 제목 캘리 재생성${applied.titleArtCopy ? ' — 문구 교체' : ''}` : '상단 제목 캘리 스킵');
      } else {
        try { titleArt = { imagePath: artPath, copy: JSON.parse(fs.readFileSync(path.join(dir, 'title-copy.json'), 'utf-8')) as ThumbCopy }; } catch { titleArt = null; }
      }
    }
    // 재조립 — 잡과 동일한 폴백 체인(Remotion → ffmpeg). 내레이션 TTS 는 전 씬 재합성(교정 사전 적용).
    say(CONFIG.shortsRenderer === 'ffmpeg' ? '재조립 시작 — ffmpeg 슬라이드쇼' : '재조립 시작 — Remotion 모션그래픽');
    const lay = layoutFor(id); // 편별 자막·제목 배치(보정값 기준 좁은 흔들림)
    const reassemble = async (p: Plan, imgs: Array<string | null>, clps: typeof clips): Promise<Awaited<ReturnType<typeof renderShortsVideo>>> => {
      let rr = null as Awaited<ReturnType<typeof renderShortsVideo>> | null;
      if (CONFIG.shortsRenderer !== 'ffmpeg') {
        try {
          rr = await renderShortsVideoRemotion(dir, p.scenes, imgs, {
            clips: clps, signal: opts.signal, ...writerVoiceOpts(short),
            caption: {
              bottomPct: lay.bottomPct, fontPx: lay.fontPx, hookFontPx: lay.hookFontPx,
              ...(CONFIG.shortsCaptionKeyword && short.keyword ? { keyword: short.keyword } : {}),
              ...(CONFIG.shortsCaptionOutline ? { outline: true } : {}),
            },
            ...(titleArt ? { title: { imagePath: titleArt.imagePath, topPct: lay.titleTopPct, widthPct: lay.titleWidthPct } } : {}),
          });
        } catch (e) { say(`모션 렌더 예외 → ffmpeg 폴백: ${e instanceof Error ? e.message.slice(0, 80) : e}`); rr = null; }
      }
      if (!rr || !rr.ok) {
        if (rr) say(`모션 렌더 실패 → ffmpeg 폴백${rr.issues.length ? ` (${rr.issues.join(' · ').slice(0, 120)})` : ''}`);
        rr = await renderShortsVideo(dir, p.scenes, imgs, {
          signal: opts.signal, ...writerVoiceOpts(short),
          ...(titleArt ? { title: { imagePath: titleArt.imagePath, topPct: CONFIG.shortsTitleTopPct, widthPct: CONFIG.shortsTitleWidthPct } } : {}),
        });
      }
      return rr;
    };
    let r = await reassemble(plan, images, clips);
    if (!r.ok || !r.videoPath) return fail(`재조립 실패 — ${r.issues.join(' · ').slice(0, 200)}`);
    // 길이 상한 집행(2026-08-20) — 잡 경로와 패리티. 수정요청이 내레이션을 늘려 상한을 넘기면 실측 속도
    // 재감량(LLM+결정적 트리밍)→재조립. 잔여 초과여도 수정 자체는 완료로 낸다(생성·완료 우선) —
    // 초과본 발행은 발행 핸들러 409 게이트가 막고, 아래 store 갱신이 실측 durationSec 을 기록해 게이트가 진실을 본다.
    let liveIdx = plan.scenes.map((_, i) => i);
    for (let round = 1; (r.durationSec ?? 0) > CONFIG.shortsMaxDurationSec && round <= 2; round++) {
      const io2: JobIO = { signal: opts.signal };
      const chars = shortsNarrationChars(plan);
      const cps = chars / Math.max(1, (r.durationSec ?? 1) - 2);
      const fit2 = await fitShortsPlanToDuration(io2, plan, Math.floor((CONFIG.shortsMaxDurationSec - 5) * cps));
      if (!fit2.compressed) { say(`길이 상한 재감량 무변화(${round}/2) — 이미 최소 구성`); break; }
      liveIdx = fit2.keptScenes.map((k) => liveIdx[k]!);
      plan = fit2.plan;
      fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
      try {
        const rdir = path.join(dir, 'remotion');
        for (const f of fs.readdirSync(rdir)) if (/^narr_\d+\.mp3$/.test(f)) fs.unlinkSync(path.join(rdir, f)); // 구 대본 TTS 소거
      } catch { /* 무해 */ }
      say(`길이 상한 초과 ${r.durationSec}초 — 재감량 ${fit2.beforeChars}→${fit2.afterChars}자${liveIdx.length < images.length ? ` · 씬 ${liveIdx.length}개로 축소` : ''}, 재조립(${round}/2)`);
      const r2 = await reassemble(plan, liveIdx.map((i) => images[i] ?? null), liveIdx.map((i) => clips[i] ?? null));
      if (!r2.ok || !r2.videoPath) break;
      r = r2;
    }
    if ((r.durationSec ?? 0) > CONFIG.shortsMaxDurationSec) {
      say(`⚠ 길이 상한 잔여 초과 — ${r.durationSec}초 > ${CONFIG.shortsMaxDurationSec}초. 수정은 완료로 처리 — 발행 게이트가 초과본을 막으니 대본 감량 수정을 한 번 더 요청해 주세요`);
    }
    const revisedVideoPath = r.videoPath; // 루프 재대입으로 풀린 내로잉 재확립
    if (!revisedVideoPath) return fail('재조립 실패 — 결과 영상 경로 없음');
    const caption = [plan.title, '', plan.description, '', plan.hashtags.join(' ')].filter((x, i) => x || i === 1 || i === 3).join('\n');
    fs.writeFileSync(path.join(dir, 'caption.txt'), caption, 'utf-8');
    // 수정 재조립도 모션그래픽을 다시 입힌다(2026-10-12) — 안 그러면 수정요청 한 번에 원본 카드로 되돌아간다.
    if (CONFIG.shortsMotionGraphics && !opts.signal?.aborted) await applyMotionGraphics(id, { log: say });
    store.update(id, { stage: 'ready', scenes: r.sceneCount, durationSec: r.durationSec, topic: plan.title });
    say(`수정 완료 — ${plan.title.slice(0, 30)} · ${r.durationSec}초`);
    // 썸네일 — 제목/캘리 문구/배경이 바뀐 경우 재생성(문구 일치 유지). 실패 무해.
    // 한글 QA 미해결 표식이 남아 있으면 무엇을 고쳤든 다시 만든다(2026-09-16 사용자 제보) — 종전엔 대본만
    // 고치는 수정요청에서 썸네일을 건드리지 않아, 발행할 때마다 같은 '오타 가능성 미해결' 경고가 되돌아왔다.
    if (applied.titleChanged || applied.titleArtCopy || applied.regenScenes.length || thumbTextQaFailed(dir)) {
      try {
        const hook = await hookStillFor(images, clips, dir, opts.signal);
        const ok = await generateDesignedThumbnail({
          dir, title: plan.title, description: plan.description, titles: plan.titles, keyword: short.keyword, hookImage: hook, signal: opts.signal,
          ...(titleArt ? { copy: titleArt.copy } : {}),
        });
        say(ok ? '썸네일 재생성 완료' : '썸네일 재생성 스킵');
      } catch { /* 무해 */ }
    }
    // 갱신 알림(완성 영상 재발송) — 사용자가 수정 결과를 바로 검수. 실패 무해.
    const done = store.get(id);
    if (done) {
      void notifyShortsReady({ id, topic: done.topic, brand: done.brand, platform: done.platform, durationSec: r.durationSec, scenes: r.sceneCount, sourcePieceId: done.sourcePieceId, writer: done.writer, director: done.director, factGate: done.factGate }, revisedVideoPath).catch(() => { /* 무해 */ });
    }
    return { ok: true, changedScenes: applied.changedScenes, regenScenes: applied.regenScenes, titleChanged: applied.titleChanged, titleArtChanged: !!applied.titleArtCopy };
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 200) : String(e));
  } finally {
    RUNNING.delete(id);
  }
}

/** 역할 LLM 호출(JSON) — 버스가 있으면 runAgent(오피스 뷰 스폰·스트림·지표), 없으면 무음 microJSON. */
async function callRoleJSON<T>(
  io: JobIO, roleId: string, fallbackSystem: string, task: string,
  maxOutputTokens: number, emitSpawn: boolean,
): Promise<T | null> {
  const role = (() => { try { return rolesById(getCompany()).get(roleId); } catch { return undefined; } })();
  if (io.bus && role) {
    const out = await runAgent({
      bus: io.bus, role, model: stdModel(),
      task: `${task}\n\n${NO_FABRICATED_EXPERIENCE}\n\n${SELLER_INQUIRY_BAN}\n\n${lexiconGuide(getBrand()?.avoidJargon, getBrand()?.keepTerms)}\n\n다른 텍스트 없이 JSON만 출력하라.`,
      // 단발 JSON 기획은 추론 강제 OFF(→ sonnet --effort low) — 카드뉴스와 동일한 사고 폭주 상한
      // 초과 계열(2026-08-11 실측) 예방.
      stage: 'work', emitSpawn, maxOutputTokens, think: false, signal: io.signal,
    });
    return extractFirstJson<T>(out.text);
  }
  // microJSON 폴백은 buildSystemPrompt 를 안 지나므로 브랜드 컨텍스트를 system 에 직접 합성.
  const sys = [role?.systemPrompt || fallbackSystem, brandContext(), NO_FABRICATED_EXPERIENCE, SELLER_INQUIRY_BAN, lexiconGuide(getBrand()?.avoidJargon, getBrand()?.keepTerms)].filter(Boolean).join('\n\n');
  return microJSON<T>(stdModel(), sys, task, { maxOutputTokens, signal: io.signal });
}

/** 내레이션 위생 — 이모지·괄호 지문 제거(TTS 가 읽어버림), 월 이름 고유어 교정(십월→시월), 길이 캡. */
function cleanNarration(s: unknown, cap = 120): string {
  return fixMonthNames(stripEmoji(String(s ?? ''))
    .replace(/[()（）[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, cap);
}

function normalizeHashtags(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [];
  const tags = arr
    .map((t) => String(t ?? '').trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
  if (!tags.some((t) => t.toLowerCase() === '#shorts')) tags.push('#shorts'); // 참고 자산 규약: #shorts 필수
  return [...new Set(tags)].slice(0, 8);
}

/**
 * 최근 숏폼 훅·CTA 원문 수집(같은 브랜드, 전량 fail-open) — 문형 로테이션 지시의 실물 근거.
 * 배경(자연스러움 감사 2026-08-11): 훅 "질문+반전" 공식 7/15편, CTA "계속 기록/정리" 7/15편으로
 * 채널 단위 지문화. recentStyleToAvoid(블로그)와 같은 원리 — 겹치면 안 되는 원문을 직접 보여준다.
 */
function recentHooksToAvoid(brand: string | undefined, excludeId: string, limit = 5): string {
  try {
    const store = shortsStore();
    const rows: string[] = [];
    for (const e of store.list()) {   // 최신부터 — shortsStore.list() 가 이미 createdTs 내림차순이다(뒤집지 않는다)
      if (e.id === excludeId || (e.brand ?? undefined) !== (brand ?? undefined)) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(store.dirFor(e.id), 'plan.json'), 'utf-8')) as
          { scenes?: Array<{ narration?: string }> };
        const hook = (p.scenes?.[0]?.narration ?? '').trim();
        const cta = (p.scenes?.[p.scenes.length - 1]?.narration ?? '').trim();
        if (hook || cta) rows.push(`- 훅: "${hook}" / CTA: "${cta}"`);
      } catch { /* plan.json 없는 항목(구버전·실패 런) 무시 */ }
      if (rows.length >= limit) break;
    }
    if (!rows.length) return '';
    return [
      '[최근 숏폼의 훅·CTA 원문 — 아래와 문형·첫 문장 구조가 겹치면 다시 써라]',
      ...rows,
    ].join('\n');
  } catch { return ''; }
}

/** TTS 실측 속도(자/초) — 2026-08-14 실측: 대본 460자 → 낭독 77.3초(포즈 포함) ≈ 5.9자/초.
 *  종전 프롬프트 가정(7자/초, "30~70자=5~10초")이 이걸 몰라서 55초 지시가 77초 영상이 됐다. */
// 낭독 속도 반영(2026-09-09 사용자 확정 "전 작가 공통 1.2, 씬 속도도 거기에 맞춰") — 5.9 는 속도 1.0 실측치다.
// 씬 길이는 실제 낭독 길이가 정하므로 속도를 올리면 씬은 저절로 짧아지지만, 대본 단계의 자수 예산·씬 길이 추정
// (실촬영 배정의 7할 규칙 포함)은 이 상수를 쓰므로 여기에도 속도를 곱해야 추정과 실제가 맞는다.
const SHORTS_TTS_CPS = 5.9 * CONFIG.elevenLabsSpeed;

function shortsNarrationChars(p: Plan): number { return p.scenes.reduce((s, x) => s + x.narration.length, 0); }

/** 문장 분리(트리밍용) — styleLint 와 같은 대략 규칙(종결부호 기준). */
const splitNarrSentences = (t: string): string[] => t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);

/** 판정 문장("~면 ~예요/~세요/~적어요") — 조건 뒤에 결론·지시가 붙은 꼴. 씬의 답이라 트리밍이 맨 나중에 건드린다(2026-10-05).
 *  조건절 문장은 전부 본다 — "긁어보면 속이 보여요" 같은 확인법도 조건→결과라 빼면 뒤 판정의 근거가 사라진다. */
const VERDICT_SENT_RE = /(?:면|다면|라면)[\s,].*(?:요|다|죠)[.!?…~]*$/;
/** 앞 문장을 되받는 첫머리 — 이런 문장이 뒤에 있으면 앞 문장을 빼면 지시어가 허공에 뜬다. */
const BACKREF_START_RE = /^(?:(?:그|이|저)\s|그래서|그럼|그러면|그런데|그러니|그렇다고|그때|이때|이런|그런|그게|이게|그건|이건|하지만|대신)/;

/**
 * 트리밍 보호 문장(순수) — 씬의 첫 문장(앞 씬을 받는 자리), 판정 문장, 다음 문장이 되받는 문장.
 * 실측(2026-10-05 숏폼 11편 분석): 종전 트리밍은 가장 긴 본문 씬의 '마지막 문장'을 뺐는데 그게 대개 판정이었다
 * (호두 유튜브 "그 아래서만 났다면 품종은 못 살린 거예요" 삭제 → 씬4가 확인법만 남고 답이 사라짐).
 */
export function protectedSentences(sents: readonly string[]): boolean[] {
  return sents.map((s, i) => i === 0 || VERDICT_SENT_RE.test(s) || isJudgmentSentence(s) || (i + 1 < sents.length && BACKREF_START_RE.test(sents[i + 1]!)));
}

/**
 * 결정적 트리밍(순수, 테스트 대상) — LLM 감량이 예산에 못 미쳐도(실측 2026-08-20: 목표 341자에 364자
 * 응답, 3라운드 전부 미달 → 60.7초 실패) 코드가 예산을 보장한다. 생성 실패 금지(사용자 확정 2026-08-20:
 * "쇼츠는 반드시 생성되어야 함")의 핵심 장치.
 * 1단계 — 문장 단위: 본문 씬(훅·CTA 제외, 씬2 전제는 후순위)에서 긴 씬부터 문장을 제거(전 씬 최소 1문장 유지).
 *   2026-10-05: 보호 문장(protectedSentences — 첫 문장·판정·되받히는 문장)이 아닌 문장을 먼저 뺀다. 본문 씬 전부가
 *   보호 문장뿐일 때만 종전대로 긴 씬의 마지막 문장을 뺀다. 씬2(전제)는 그 뒤 — 씬2 의 틀 문장이 남은 씬들의 전제다.
 * 2단계 — 씬 단위: 뒤쪽 본문 씬을 통째로 제거(훅·씬2·CTA 보존, 최소 4씬).
 * keptScenes 는 원본 씬 인덱스 — 렌더 시 씬별 이미지·클립 배열을 함께 줄이는 매핑에 쓴다.
 */
export function trimPlanToBudget(plan: Plan, budgetChars: number, minScenes = 4): { plan: Plan; keptScenes: number[]; trimmed: boolean } {
  const total = (scs: Array<{ narration: string }>): number => scs.reduce((s, x) => s + x.narration.length, 0);
  const scenes = plan.scenes.map((s) => ({ ...s }));
  const kept = scenes.map((_, i) => i);
  let changed = false;
  let guard = 40; // 폭주 방지 — 씬×문장 수보다 넉넉한 상한
  const dropAt = (i: number, k: number): void => {
    const ss = splitNarrSentences(scenes[i]!.narration);
    ss.splice(k, 1);
    scenes[i]!.narration = ss.join(' ').trim();
    changed = true;
  };
  /** 씬 i 에서 뺄 수 있는 비보호 문장 중 마지막 것의 위치(없으면 -1). */
  const freeIdx = (i: number): number => {
    const ss = splitNarrSentences(scenes[i]!.narration);
    if (ss.length < 2) return -1;
    const prot = protectedSentences(ss);
    for (let k = ss.length - 1; k >= 0; k--) if (!prot[k]) return k;
    return -1;
  };
  while (total(scenes) > budgetChars && guard-- > 0) {
    const order = [...scenes.keys()]
      .filter((i) => i > 0 && i < scenes.length - 1) // 훅·CTA 는 문장 트리밍 제외(각 1~2문장 핵심)
      .sort((a, b) => (a === 1 ? 1 : 0) - (b === 1 ? 1 : 0) || scenes[b]!.narration.length - scenes[a]!.narration.length);
    const body = order.filter((i) => i !== 1);
    // ① 본문 씬의 비보호 문장 ② 본문 씬의 마지막 문장(종전 규칙) ③ 씬2 의 비보호 문장 ④ 씬2 의 마지막 문장.
    const free = body.find((i) => freeIdx(i) >= 0);
    if (free !== undefined) { dropAt(free, freeIdx(free)); continue; }
    const legacy = body.find((i) => splitNarrSentences(scenes[i]!.narration).length >= 2);
    if (legacy !== undefined) { dropAt(legacy, splitNarrSentences(scenes[legacy]!.narration).length - 1); continue; }
    if (order.includes(1) && splitNarrSentences(scenes[1]!.narration).length >= 2) {
      const k = freeIdx(1);
      dropAt(1, k >= 0 ? k : splitNarrSentences(scenes[1]!.narration).length - 1);
      continue;
    }
    break; // 더 뺄 문장 없음 — 씬 단위로
  }
  while (total(scenes) > budgetChars && scenes.length > Math.max(1, minScenes)) { // 씬 하한(기본 4) — 쇼츠는 CONFIG.shortsScenes 를 넘겨 씬 수를 지킨다
    const drop = scenes.length - 2; // CTA 앞 본문 씬부터 뒤에서 제거
    scenes.splice(drop, 1);
    kept.splice(drop, 1);
    changed = true;
  }
  return { plan: { ...plan, scenes }, keptScenes: kept, trimmed: changed };
}

/** 제목 후보 유형 풀(2026-08-27 말투 감사 권고 5) — 종전 고정 3종(정보형·후킹형·질문형)이 채널 지문이 됐다. */
export const TITLE_TYPE_POOL = ['정보형', '후킹형', '질문형', '결론형', '장면형'] as const;

/**
 * 런별 제목 후보 유형 3종 선택(순수·주입 난수) — 유형 풀에서 매 런 다르게 고른다.
 *  · 질문형 상한: 최근 3편 중 1편이라도 질문형 후보를 냈으면 이번 런 풀에서 뺀다. 이렇게 하면 연속한
 *    어느 3편 창에서도 질문형이 1편을 넘지 않는다(편1이 썼으면 편2·3·4가 막히고 편5에서 다시 열린다).
 *    판정은 classifyTitleType(analytics/titleTiming) — 제목 유형 A/B 집계와 같은 분류기를 쓴다.
 *  · keywordFirst: 핵심 키워드가 있는 런은 '정보형'을 반드시 포함한다. 프롬프트의 "대표 제목과 정보형
 *    후보에는 키워드를 정확히 이 표기 그대로"(사용자 확정 자산)가 후보에서 통째로 사라지면 안 되기 때문.
 * recentTitles 는 최근 편들의 plan.json titles(최신 순).
 */
/**
 * 제목 유형 정의 줄(순수, Fix wave 2026-08-27 소견 3) — base(194bed6d) 프롬프트에는 이 줄이 아예 없었고
 * titles 는 JSON 형식 줄의 ["정보형","후킹형","질문형"] 로만 지시됐다. VOICE_ROTATION=off 면 제목 유형은
 * 종전 고정 3종으로 돌아가는데 5종 정의 줄만 남으면 base 와 달라진다(킬스위치 동일성 계약) — off 면 뺀다.
 */
export function shortsTitleTypeGuide(titleTypes: string[], rotation: boolean): string {
  if (!rotation) return '';
  return `제목 후보(titles) 3개는 서로 다른 유형으로 쓴다 — 순서대로 [${titleTypes.join(' / ')}]. 유형 정의: 정보형=무엇을 다루는 영상인지 그대로 알린다 / 후킹형=손해·실수·반전으로 클릭을 부른다 / 질문형=독자의 질문을 그대로 던진다 / 결론형="~은 ~입니다" 꼴로 답을 먼저 준다 / 장면형=손에 잡히는 한 장면을 그린다.`;
}

/**
 * 설명(description) 요약투 검사(순수, Fix wave 2026-08-27 소견 4) — 권고 2 가 새로 만든 이 검사만
 * 킬스위치가 없었다(timingParity·blogStyleLint·voiceRotation·structureVariety 는 전부 게이트를 가진다).
 * META_SUMMARY_LINT=off 면 블로그 meta 재시도(naverBlog)와 이 합류가 함께 멈춘다.
 */
export function descriptionLintIssues(description: string, on: boolean = CONFIG.metaSummaryLint): string[] {
  return on ? metaSummaryIssues(description).slice(0, 1) : [];
}

export function pickTitleTypes(
  recentTitles: string[][], opts: { keywordFirst?: boolean; rand?: () => number } = {},
): string[] {
  const rand = opts.rand ?? Math.random;
  const questionEpisodes = recentTitles.slice(0, 3)
    .filter((ts) => ts.some((t) => classifyTitleType(String(t ?? '')) === 'question')).length;
  const rest: string[] = TITLE_TYPE_POOL.filter((t) => t !== '질문형' || questionEpisodes < 1);
  const picked: string[] = [];
  if (opts.keywordFirst) picked.push(...rest.splice(rest.indexOf('정보형'), 1));
  while (picked.length < 3 && rest.length) {
    const i = Math.min(rest.length - 1, Math.floor(rand() * rest.length));
    picked.push(...rest.splice(i, 1));
  }
  return picked;
}

/**
 * 최근 숏폼의 제목 후보 원문(같은 브랜드, 최신 순, 전량 fail-open) — 질문형 상한 판정 입력.
 * shortsStore.list() 는 createdTs 내림차순(최신 순)이라 뒤집지 않는다.
 */
function recentShortsTitles(brand: string | undefined, excludeId: string, limit = 3): string[][] {
  try {
    const store = shortsStore();
    const rows: string[][] = [];
    for (const e of store.list()) {
      if (e.id === excludeId || (e.brand ?? undefined) !== (brand ?? undefined)) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(store.dirFor(e.id), 'plan.json'), 'utf-8')) as { titles?: unknown };
        const ts = (Array.isArray(p.titles) ? p.titles : []).map((t) => String(t ?? '').trim()).filter(Boolean);
        if (ts.length) rows.push(ts);
      } catch { /* plan.json 없는 항목(구버전·실패 런) 무시 */ }
      if (rows.length >= limit) break;
    }
    return rows;
  } catch { return []; }
}

/**
 * 최근 숏폼의 대표 제목(같은 브랜드, 최신 순, fail-open) — 제목 구조 수렴 차단용 입력.
 *
 * 후보(titles)를 보는 recentShortsTitles 와 목적이 다르다. 실측(2026-09-03, 최근 38편):
 * 후보는 47%만 쉼표를 쓰는데 대표 제목은 38/38 이 "<키워드 구>, <행동>" 한 틀이었다.
 * 후보 단계의 다양성이 대표 제목에서 통째로 붕괴한다 — 그런데 유튜브에 올라가는 건 대표 제목이다.
 * 원인은 단순했다: 후보에는 유형 지시가 있고 대표 제목에는 구조 지시가 아예 없었다.
 */
function recentShortsMainTitles(brand: string | undefined, excludeId: string, limit = 6): string[] {
  try {
    const store = shortsStore();
    const out: string[] = [];
    for (const e of store.list()) {
      if (e.id === excludeId || (e.brand ?? undefined) !== (brand ?? undefined)) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(store.dirFor(e.id), 'plan.json'), 'utf-8')) as { title?: unknown };
        const t = String(p.title ?? '').trim();
        if (t) out.push(t);
      } catch { /* plan.json 없는 항목 무시 */ }
      if (out.length >= limit) break;
    }
    return out;
  } catch { return []; }
}

/**
 * 제목 구조 지문(순수) — 대략의 문장 꼴만 본다. 정교한 구문 분석이 목적이 아니라
 * "최근 것들과 같은 틀인가"만 가르면 되기 때문이다.
 */
export function titleShape(t: string): 'question' | 'comma' | 'plain' {
  const x = t.trim();
  if (/[?？]\s*$/.test(x)) return 'question';
  if (x.includes(',')) return 'comma';
  return 'plain';
}

/**
 * 대표 제목 구조 수렴 차단(결정적, 2026-09-03) — 지시문이 안 먹어서 코드로 내린다.
 *
 * 실측: 최근 38편의 대표 제목이 38/38 "<키워드 구>, <행동>" 이었다. 프롬프트에 최근 제목을
 * 직접 보여주고 "구조가 겹치면 안 된다"고 못박은 뒤에도 다음 런이 또 쉼표 꼴을 냈다
 * (short_5b5f7f4231 — 후보 3개는 전부 쉼표가 없었는데 대표만 쉼표였다). compare 페이로드와
 * 같은 실패 유형이다: 읽히긴 하는데 안 따른다.
 *
 * 그래서 후보 중에 다른 꼴이 있으면 그걸로 바꾼다. 안전장치 두 가지:
 *  - 키워드 규칙이 우선이다. 키워드가 있으면 그것을 포함한 후보만 후보로 친다(검색 노출 자산).
 *  - 바꿀 것이 없으면 원본을 그대로 둔다(fail-open) — 억지로 이상한 제목을 만들지 않는다.
 */
export function diversifyTitle(
  title: string, candidates: readonly string[], recentTitles: readonly string[], keyword?: string,
): string {
  if (!title || recentTitles.length < 3) return title;
  const shape = titleShape(title);
  // 최근 것들의 과반이 이번 것과 같은 꼴일 때만 개입한다 — 우연히 겹친 한두 편으로 흔들지 않는다.
  const same = recentTitles.filter((t) => titleShape(t) === shape).length;
  if (same * 2 <= recentTitles.length) return title;
  const alt = candidates.find((c) => {
    const t = c.trim();
    return t && t !== title && titleShape(t) !== shape && (!keyword || t.includes(keyword));
  });
  return alt ? alt.slice(0, 60) : title;
}

/** 유보 표현 — 압축 LLM 이 "군더더기"로 지워 단정문(결론 반전)을 만든 실측 대응.
 *  '미루'는 "미루고/미룹니다"(유보)만 노린다 — 미루나무는 수종명이라 제외(2026-08-26 최종 리뷰 F5d).
 *  '수 있'(2026-10-05): 맨 '수 있'은 그대로 유보로 본다 — "썩을/안 필/입을/부러질/올 수 있어요"는 전부 가능성 유보이고,
 *  가능성 꼴만 남겼던 좁힘(…일/있을/생길/될 수 있)은 이들을 놓쳤다(리뷰 지적). 예외는 '알아보는 능력' 동사뿐이다 —
 *  "가려낼 수 있어요"(능력)를 유보로 오판한 실측(호두 인스타: 수정 라운드가 "가려내요"로 줄이자 긴 원문장을 되살렸고, 그
 *  초과분을 트리밍이 판정 문장으로 메웠다). 예외 목록: 가려낼·구별할·구분할·알아볼·알아챌·확인할·고를·찾을·볼·알. */
export const HEDGE_RE = /대개|흔히|보통|대체로|경우가 많|(?<!(?:가려낼|구별할|구분할|알아볼|알아챌|확인할|고를|찾을|볼|알)\s?)수 있|수도 있|봐요|가능성|편이에요|편입니다|미루(?!나무)/;
/** 원문에 유보 토큰이 있던 씬이 압축본에서 사라지면 원 내레이션으로 되돌린다(스펙 §6b) — 순수 함수, 입력 불변. */
export function restoreLostHedges(before: Plan, after: Plan): { plan: Plan; restored: number[] } {
  const restored: number[] = [];
  const scenes = after.scenes.map((s, i) => {
    const orig = before.scenes[i];
    if (!orig || !HEDGE_RE.test(orig.narration) || HEDGE_RE.test(s.narration)) return s;
    restored.push(i + 1);
    return { ...s, narration: orig.narration };
  });
  return { plan: { ...after, scenes }, restored };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 대본 흐름 보존(2026-10-05 숏폼 11편 분석, 사장님 승인) — 씬 사이 '건너뜀'이 작가 첫 원고 6/44(14%)에서 최종 17/44(39%)
// 로 늘었다. 늘어난 자리: 수정 라운드 11 · 압축 4 · 기계 트리밍 1 · CTA 잘림 1. 수정 라운드는 작가에게 현 대본을 안 주고
// 원 지시+문제 목록만 줘서 94%가 통째 재집필이었다(훅 85편 중 83편 교체, 씬 유사도 중앙 0.08). 아래 순수 함수들은
// 그 경로를 '문제 씬만 고치기'로 바꾸고, 씬 수 넘침이 CTA 를 자르지 않게 하고, 마지막에 이음새만 한 번 본다.
// ───────────────────────────────────────────────────────────────────────────────────────────────

/** 씬 수 맞추기(순수) — 넘치면 앞 n-1 + 마지막 씬(CTA). 모자라면 그대로(지어낼 수 없다).
 *  종전 parsePlan 은 앞에서 n 개를 잘라 마지막 CTA 를 떨어뜨렸다(09-18 이후 91편 중 20편이 CTA 없이 끝남 — 호두 인스타:
 *  수정본 7씬 → 앞 5씬만 남아 결론 카드 없이 "흔들어 보면…" 으로 끝남). */
export function fitSceneCount<T>(scenes: readonly T[], n: number): T[] {
  if (n < 2 || scenes.length <= n) return scenes.slice();
  return [...scenes.slice(0, n - 1), scenes[scenes.length - 1]!];
}

/**
 * 씬별 자수 예산(순수) — 작가 지시가 실제 예산에서 나오게(2026-10-05). 종전 지시는 "본문 2문장 40~65자, 30~55초"
 * (company.yaml)와 "본문 30~70자"(기획 프롬프트)였는데 실제 예산은 (상한 35초−여유 5초)×7.08자/초 ≈ 212자다 —
 * 첫 원고 93편 중 60편이 예산 초과, 30편이 평균 26% 압축됐고 압축이 이음 문장부터 지웠다.
 * 예산의 92%를 목표로 둔다(작가는 대개 조금 넘긴다). 훅은 훅 규칙(20자) 고정, 나머지를 씬2 1.1 · 본문 1.0 · CTA 0.75 로 나눈다.
 */
export function sceneCharBudgets(budgetChars: number, n: number, hookMax = 20): { hook: number; premise: number; body: number; cta: number; total: number } {
  const target = Math.floor(budgetChars * 0.92);
  const bodyCount = Math.max(0, n - 3);
  const unit = Math.max(0, target - hookMax) / (1.1 + bodyCount + 0.75);
  return {
    hook: hookMax,
    premise: Math.min(70, Math.floor(unit * 1.1)),
    body: Math.min(70, Math.floor(unit)),
    cta: Math.min(45, Math.floor(unit * 0.75)),
    total: budgetChars,
  };
}

/** 씬 i(0-base)의 자수 상한 — sceneCharBudgets 를 씬 자리에 맞춰 읽는다. */
export function sceneBudgetAt(b: ReturnType<typeof sceneCharBudgets>, i: number, n: number): number {
  return i === 0 ? b.hook : i === n - 1 ? b.cta : i === 1 ? b.premise : b.body;
}

/**
 * 훅 실촬영이 주제와 어긋나는가(순수, 2026-10-05) — 어긋나면 사유, 아니면 ''.
 * 실측(호두 인스타·유튜브): 주제 "잎이 안 나요"인데 훅 실촬영은 "초록 잎이 무성하고 열매" — 작가가 그 묘사로 훅을 써서
 * "잎이랑 열매가 저렇게 가득하죠"가 나갔다(주제와 정반대 장면을 가리킨다). 주제의 '없음·안 됨'과 화면의 '가득함'이
 * 같은 부위(잎·꽃·열매)에서 부딪히거나, 주제가 고사·시듦인데 화면이 싱싱하면 어긋남으로 본다.
 */
export function footageContradictsTopic(topic: string, footage: string | undefined): string {
  if (!footage) return '';
  const t = topic.replace(/\s+/g, ' ');
  const f = footage.replace(/\s+/g, ' ');
  for (const p of FOOTAGE_PARTS) if (p.absent.test(t) && p.full.test(f)) return `주제는 ${p.name}이 없거나 상한 상태인데 훅 화면은 ${p.name}이 가득한 장면`;
  if (/(?:고사|죽어|죽은|말라\s*죽|시들)/.test(t) && /(?:싱싱|무성|건강|푸르게)/.test(f)) return '주제는 고사·시듦인데 훅 화면은 싱싱한 나무';
  return '';
}


/**
 * 실촬영 화면 어긋남을 수정 라운드·검토 메시지 줄로(순수).
 *  씬1(훅) — 화면 위에서 말하므로 무엇이든 대조한다(씬1 지목이라 훅 수정이 열린다, problemsTargetHook).
 *  다른 씬(2026-10-15 사장님 지적) — "잎이 진 지금"처럼 **지금** 나무 상태를 단정하면 대조한다. 실측: 10-04 촬영 호두나무(잎 달림)를
 *  첫 장면에 보여 주고 씬2 가 "잎이 진 지금"이라 했다 — 블로그 요약 줄("잎이 진 지금, 손으로 만져 보면 됩니다")을 옮긴 것.
 */
export function hookFootageIssues(scene: { narration: string; screenText?: string } | undefined, footage: string | undefined, rest: ReadonlyArray<{ narration: string; screenText?: string }> = []): string[] {
  const out: string[] = [];
  const why = scene ? hookContradictsFootage(`${scene.narration} ${scene.screenText ?? ''}`, footage) : '';
  if (why) out.push(`씬1: 훅이 실촬영 화면과 어긋난다 — ${why}. 화면에 실제로 보이는 것만 말하거나, 화면을 가리키지 않는 단정 선언으로 바꿔라(자막도 함께)`);
  rest.forEach((s, i) => {
    const t = `${s.narration} ${s.screenText ?? ''}`;
    if (!NOW_RE.test(t)) return;
    const w = hookContradictsFootage(t, footage);
    if (w) out.push(`씬${i + 2}: 지금 나무 상태를 실촬영과 다르게 말한다 — ${w.replace(/^훅은/, '이 씬은')}. 첫 장면 실촬영은 이번 달 실제 나무다 — "지금 ~가 졌다" 같은 단정을 빼거나 "지기 시작하면", "잎이 지고 나면"처럼 조건으로 바꿔라`);
  });
  return out;
}

/** 화면을 가리키는 훅(장면 지목형) — 훅 화면이 주제와 어긋난 편에서 수정·흐름 단계가 이런 훅을 되살리면 거절한다. */
export const FOOTAGE_DEICTIC_RE = /^(?:지금\s*)?(?:이|저)\s|이렇게|저렇게|보이죠|보세요|가득|무성|주렁|매달/;

/** 훅 화면 어긋남일 때 작가·수정·흐름 프롬프트에 같은 문구로 싣는다. */
export function assertiveHookRule(why: string): string {
  return `[훅 — 화면 묘사 금지] 씬1 에 나가는 실촬영은 이 편 주제의 장면이 아니다(${why}). 씬1(훅) 내레이션은 화면을 묘사하거나 가리키지 말고("이 나무, 잎이 가득하죠" 류 금지) 단정 선언·숫자 제시형으로 써라. 실촬영 묘사를 주제의 증상처럼 쓰지 마라.`;
}

/** 키워드 핵심어(순수) — 키워드 안의 수종명, 없으면 첫 낱말. */
function keywordTokens(keyword: string): { head: string; rest: string[] } {
  const toks = keyword.split(/\s+/).map((x) => x.trim()).filter((x) => x.length >= 2);
  const sp = speciesNamesIn(keyword)[0];
  const head = sp ?? toks[0] ?? '';
  return { head, rest: toks.filter((x) => x !== head && !head.includes(x)) };
}

/**
 * 검색 키워드·답 앞세우기 린트(순수, 2026-10-05) — 네이버 클립 AI 요약은 낭독(음성 인식)·화면 글자를 읽고, 유튜브는 검색이
 * 천장 밖으로 나가는 유일한 길이다(09-08 실측). 유튜브 편: 씬1~2(내레이션·화면 텍스트)에 수종명과 키워드의 다른 낱말 하나가
 * 함께 나와야 한다. 인스타 편: 공유형 훅은 유지하되 수종명을 내레이션에서 한 번은 소리 내 말해야 한다. 최대 1건.
 */
export function keywordEarlyIssues(
  scenes: ReadonlyArray<{ narration: string; screenText?: string }>, keyword: string | undefined, platform: ShortsPlatform | undefined,
): string[] {
  if (!keyword?.trim() || !scenes.length) return [];
  const sq = (s: string): string => s.replace(/\s+/g, '');
  const { head, rest } = keywordTokens(keyword);
  if (!head) return [];
  if (platform === 'youtube') {
    const early = sq(scenes.slice(0, 2).map((s) => `${s.narration} ${s.screenText ?? ''}`).join(' '));
    const ok = early.includes(sq(head)) && (!rest.length || rest.some((r) => early.includes(sq(r))));
    return ok ? [] : [`항목2: 유튜브 편은 씬1~2 에서 검색 키워드("${keyword}")와 직접 답을 한 문장으로 말해야 한다 — 씬2 첫 문장을 "${head}${rest[0] ? ` ${rest[0]}` : ''}는 ~예요" 꼴의 답으로(훅은 종전대로 키워드로 열지 않는다)`];
  }
  const spoken = sq(scenes.map((s) => s.narration).join(' '));
  return spoken.includes(sq(head)) ? [] : [`항목2: 핵심 키워드의 대상("${head}")이 내레이션에 한 번도 안 나온다 — 소리로 한 번은 말하라(검색·AI 요약이 음성을 읽는다)`];
}

/** 부분 수정 응답(작가 LLM) — 고친 씬만. 씬 수·순서·연출 종류는 바꿀 수 없다. */
export interface PartialFix {
  scenes?: Array<{ index?: unknown; narration?: unknown; screenText?: unknown; takeaways?: unknown; items?: unknown } | null>;
  description?: unknown;
  next?: { topic?: unknown; window?: unknown } | null;
}

/** 대본 표시(부분 수정·흐름 점검 공용) — 화면 글자(자막·결론 카드·목록·대비)까지 같이 보여 줘야 함께 고친다. */
export function scriptForEdit(scenes: readonly ShortsScene[]): string {
  return scenes.map((s, i) => {
    const bits = [`씬${i + 1}${s.kind ? `[${s.kind}]` : ''} (${s.narration.length}자) 내레이션: ${s.narration}`];
    if (s.screenText) bits.push(`자막: ${s.screenText}`);
    if (s.takeaways?.length) bits.push(`결론 카드: ${s.takeaways.map((t) => `${t.when} → ${t.then}`).join(' / ')}`);
    if (s.items?.length) bits.push(`목록: ${s.items.join(' · ')}`);
    if (s.compare) bits.push(`대비: ${s.compare.bad.label} ✕ / ${s.compare.good.label} ○`);
    return bits.join(' | ');
  }).join('\n');
}

/**
 * 부분 수정 프롬프트(순수, 2026-10-05) — 문제 씬만 고쳐 돌려받는다. 원 기획 지시 전문을 다시 주지 않는다: 그 지시는
 * 전체 대본 스키마로 끝나 통째 재집필을 부른다(실측 94%). 대신 현 대본·문제·씬별 상한·원문 발췌·훅 규칙만 준다.
 * 길이는 참고 프로젝트의 교열 방식(원문 대비 1.2배 이내)을 따른다.
 */
export function partialFixPrompt(a: {
  scenes: readonly ShortsScene[]; problems: readonly string[]; budgets: ReturnType<typeof sceneCharBudgets>;
  stage: 'plan' | 'compressed'; sourceExcerpt?: string; flagged?: readonly string[]; hookRule?: string; keyword?: string;
  hookEditable: boolean; description?: string;
  /** 사실 수정 여유(2026-10-15 사장님 선택 "사실 수정에만 여유 3초") — 원문 조건·유보를 되살리느라 길어지는 몫(자). 보내기 전 수정만 준다. */
  factSlack?: number;
}): string {
  const n = a.scenes.length;
  const b = a.budgets;
  return [
    a.stage === 'compressed'
      ? '아래 숏폼 대본은 길이 상한에 맞추려 감량한 결과다. 감량 뒤 검산에서 문제가 나왔다.'
      : '아래 숏폼 대본(작가 첫 원고)에서 검산 문제가 나왔다.',
    '대본 전체를 다시 쓰지 마라. 문제가 지목한 씬만 고쳐 그 씬 번호와 새 내레이션을 돌려줘라 — 출력하지 않은 씬은 지금 그대로 쓴다.',
    '',
    `[현재 대본 — 씬 ${n}개]`,
    scriptForEdit(a.scenes),
    a.description ? `[설명] ${a.description}` : '',
    '',
    `[검산 문제]\n${a.problems.map((p) => `- ${p}`).join('\n')}`,
    '',
    '[고치는 규칙]',
    `· 씬 수(${n}개)·순서·연출 종류(kind)는 그대로다. 씬을 늘리거나 합치지 마라.`,
    '· 고친 씬은 앞 씬을 받아서 시작하고 다음 씬으로 넘겨 줘야 한다 — 이음말·정의 문장·판정 문장("~면 ~예요")을 지우지 마라. 앞 씬에서 세우지 않은 말을 새로 꺼내지 마라. 고친 문장이 다른 씬이 말한 사실과 어긋나면 안 된다(앞에서 "향이 한두 주면 사라진다"고 했으면 "향은 오래간다"고 쓰지 마라 — 라이브 점검 실측).',
    a.hookEditable
      ? `· 씬1(훅)은 문제가 씬1 을 지목했으니 고쳐도 된다 — ${b.hook}자 이내 한 문장, 키워드로 열지 마라.`
      : '· 씬1(훅)은 고치지 마라(문제가 훅을 지목하지 않았다).',
    a.factSlack
      ? `· 길이: 원문의 조건·유보·예외를 되살리는 게 먼저다 — 그 때문에 길어지는 건 고친 씬당 ${a.factSlack}자, 대본 전체 ${b.total + a.factSlack}자까지 괜찮다(씬별 기준 훅 ${b.hook}자 · 씬2 ${b.premise}자 · 본문 ${b.body}자 · 마지막 씬 ${b.cta}자). 조건을 빼서 짧게 맞추지 마라.`
      : `· 길이: 고친 씬은 지금 길이의 1.2배 이내, 씬별 상한 훅 ${b.hook}자 · 씬2 ${b.premise}자 · 본문 ${b.body}자 · 마지막 씬 ${b.cta}자. 대본 전체 ${b.total}자 이내. 늘려야 하면 같은 씬의 덜 중요한 말을 바꿔 말해 자리를 만든다.`,
    a.stage === 'compressed'
      // 감량 뒤 수정은 카드를 지키는 쪽(2026-10-05 리뷰) — 병합이 cards:'keepUnlessDiverged' 로 돈다. 프롬프트도 그 규칙대로 말한다.
      ? '· 내레이션을 고친 씬에 자막·결론 카드·목록이 있으면 새 내레이션에 맞춰 함께 돌려줘라(그대로 맞으면 그대로 옮겨 적어라). 돌려주지 않은 결론 카드·목록은 그대로 남는다 — 단 새 내레이션이 그 카드가 되받던 말을 지우면 카드도 지워진다.'
      : '· 내레이션을 고친 씬에 자막·결론 카드·목록이 있으면 새 내레이션에 맞춰 함께 돌려줘라(그대로 맞으면 그대로 옮겨 적어라). 돌려주지 않은 결론 카드·목록은 지워진다 — 화면에 옛 주장이 남는 것보다 낫기 때문이다.',
    '· 사실·수치·시기는 아래 원문에 있는 것만. 원문 결론의 방향을 뒤집지 마라. 유보어("대개/흔히/~일 수 있어요/~봐요")는 남겨라. 구어체 존댓말, 숫자는 한글 낭독, 이모지 금지.',
    a.keyword ? `· 핵심 키워드 "${a.keyword}" 의 대상 이름이 든 구절은 고쳐도 그 이름을 남겨라.` : '',
    a.hookRule ?? '',
    a.flagged?.length ? `[원문에서 근거가 확인되지 않은 주장 — 쓰지 마라]\n${a.flagged.slice(0, 6).map((c) => `- ${c}`).join('\n')}` : '',
    a.sourceExcerpt ? `[원문 블로그 발췌 — 사실 확인용, 문장 복붙 금지]\n${a.sourceExcerpt}` : '',
    '',
    'JSON 형식: {"scenes":[{"index":씬번호,"narration":"...","screenText":"...","takeaways":[{"when":"...","then":"..."}],"items":["..."]}],"description":"(설명 문제를 지적받았을 때만)","next":{"topic":"...","window":"N월"}} — 고친 씬만, screenText·takeaways·items·description·next 는 해당할 때만.',
  ].filter((x) => x !== '').join('\n');
}

/** 짧은 화면 글자가 새 내레이션과 여전히 맞는가 — 글자 두 개씩 겹침 비율(대략). */
function screenTextStillFits(screenText: string, narration: string): boolean {
  const grams = (s: string): Set<string> => {
    const x = s.replace(/[^가-힣0-9a-zA-Z]/g, '');
    return new Set(Array.from({ length: Math.max(0, x.length - 1) }, (_, i) => x.slice(i, i + 2)));
  };
  const a = grams(screenText);
  if (!a.size) return true;
  const b = grams(narration);
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / a.size >= 0.4;
}

/**
 * 부분 수정 병합(순수, 테스트 대상) — 고친 씬만 바꾸고 나머지는 그대로. 검증:
 *  · 번호 범위·중복·빈 문자열 거절, 씬1 은 hookEditable 일 때만, 훅 화면 어긋남 편은 화면 지목 훅(hookReject) 거절.
 *  · 길이: 원 길이 1.2배+4자 또는 그 자리의 씬 예산 중 큰 값 이내(감량본은 원 길이가 너무 짧아 정의를 되살릴 자리가 없다).
 *  · 키워드 대상 이름을 지운 수정 거절.
 *  · 내레이션이 바뀌었는데 결론 카드(takeaways)·목록(items)을 새로 안 주면 옛 것을 지운다 — 참고 프로젝트 3f2bdde 와 같다
 *    (옛 주장이 화면에만 남는 것보다 카드 없이 나가는 편이 안전). 자막은 새로 안 주면 새 내레이션과 겹치는 만큼만 남긴다
 *    (실측 모과 인스타: 감량 뒤 수정이 내레이션만 바꿔 CTA 자막 "꽃말은 평범"이 남았다).
 *  · budgetChars 를 주면 합계가 넘을 때 가장 많이 늘어난 수정부터 되돌린다(트리밍은 이음새를 다시 끊는다).
 *  · cards(2026-10-05 리뷰) — 새 카드·목록·자막을 안 준 채 내레이션만 바뀌었을 때 화면 글자를 어떻게 할지:
 *    'drop'(기본, 기획 단계 부분 수정) 위 규칙대로 지운다.
 *    'keep'(흐름 점검) 카드·목록·자막을 그대로 둔다 — 흐름 점검은 이음 말만 바꾸므로 화면의 결론이 틀릴 일이 없다
 *      (실측 산딸: 흐름 점검이 CTA 이음 문장을 고치자 결론 카드가 통째로 지워졌다, droppedCards=[5]).
 *    'keepUnlessDiverged'(감량 뒤 수정) 카드·목록은 그대로 두되, 옛 내레이션에 걸려 있던 카드(조건·결과 중 한 칸이라도 글자
 *      겹침 40% 이상)가 새 내레이션에서 걸 데가 사라졌으면 바뀐 말과 어긋난 것으로 보고 지운다(droppedCards 로 보고). 카드를
 *      처음부터 되풀이하지 않던 CTA(답은 화면에만)는 지우지 않는다. 자막은 'drop' 과 같다(새 내레이션과 겹칠 때만 남김).
 */
export function mergePartialFix(
  plan: Plan, cand: PartialFix | null | undefined,
  opts: { hookEditable: boolean; budgets: ReturnType<typeof sceneCharBudgets>; keyword?: string; hookReject?: RegExp; budgetChars?: number; onlyScenes?: readonly number[]; fixScreen?: (s: string) => string; cards?: 'drop' | 'keep' | 'keepUnlessDiverged';
    /** 씬 상한 여유(자, 2026-10-15) — 사실 수정 단계만. 대본 전체 여유는 budgetChars 에 호출부가 더해 준다. */
    slackChars?: number } ,
): { plan: Plan; changed: number[]; rejected: string[]; droppedCards: number[]; descriptionChanged: boolean } {
  const cardMode = opts.cards ?? 'drop';
  /** 옛 내레이션에 걸려 있던 카드가 새 내레이션에선 걸 데가 없다 — 'keepUnlessDiverged' 의 어긋남 판정(대략). 카드 = 칸 묶음. */
  const fitsAny = (fields: readonly string[], narr: string): boolean => fields.some((f) => !!f.trim() && screenTextStillFits(f, narr));
  const diverged = (cards: ReadonlyArray<readonly string[]>, oldN: string, newN: string): boolean =>
    cards.some((c) => fitsAny(c, oldN) && !fitsAny(c, newN));
  const n = plan.scenes.length;
  const scenes = plan.scenes.map((s) => ({ ...s }));
  const changed: number[] = []; const rejected: string[] = []; const droppedCards: number[] = [];
  const head = opts.keyword ? keywordTokens(opts.keyword).head.replace(/\s+/g, '') : '';
  const fixScreen = opts.fixScreen ?? ((s: string) => s);
  for (const s of cand?.scenes ?? []) {
    const idx = typeof s?.index === 'number' && Number.isInteger(s.index) ? s.index : Math.trunc(Number(s?.index));
    if (!Number.isInteger(idx) || idx < 1 || idx > n || changed.includes(idx)) continue;
    if (opts.onlyScenes && !opts.onlyScenes.includes(idx)) { rejected.push(`씬${idx}: 지목 밖`); continue; }
    const cur = scenes[idx - 1]!;
    const narration = s?.narration === undefined ? '' : cleanNarration(s.narration, 240);
    if (!narration) continue;
    if (idx === 1 && !opts.hookEditable && narration !== cur.narration) { rejected.push('씬1: 훅 수정 불가'); continue; }
    if (idx === 1 && opts.hookReject?.test(narration)) { rejected.push('씬1: 화면 지목 훅'); continue; }
    const cap = Math.max(Math.ceil(plan.scenes[idx - 1]!.narration.length * 1.2) + 4, sceneBudgetAt(opts.budgets, idx - 1, n)) + (opts.slackChars ?? 0);
    if (narration.length > cap) { rejected.push(`씬${idx}: ${narration.length}자 > 상한 ${cap}자`); continue; }
    if (head && plan.scenes[idx - 1]!.narration.replace(/\s+/g, '').includes(head) && !narration.replace(/\s+/g, '').includes(head)) { rejected.push(`씬${idx}: 키워드 대상 삭제`); continue; }
    const next: ShortsScene = { ...cur, narration };
    const st = typeof s?.screenText === 'string' ? fixScreen(stripEmoji(s.screenText).trim()).slice(0, 20) : undefined;
    const narrChanged = narration !== cur.narration;
    if (st !== undefined && st !== '') next.screenText = st;
    else if (cardMode !== 'keep' && narrChanged && cur.screenText && !screenTextStillFits(cur.screenText, narration)) next.screenText = '';
    const dropOld = (cards: ReadonlyArray<readonly string[]>): boolean => narrChanged && (cardMode === 'drop' || (cardMode === 'keepUnlessDiverged' && diverged(cards, cur.narration, narration)));
    if (cur.kind === 'cta' && s?.takeaways !== undefined) {
      const tk = normalizeSceneKind({ kind: 'cta', takeaways: s.takeaways }).takeaways;
      if (tk?.length) next.takeaways = tk;
    } else if (cur.takeaways?.length && dropOld(cur.takeaways.map((t) => [t.when, t.then]))) { delete next.takeaways; droppedCards.push(idx); }
    if (cur.kind === 'list' && s?.items !== undefined) {
      const it = normalizeSceneKind({ kind: 'list', items: s.items }).items;
      if (it?.length) next.items = it;
    } else if (cur.kind === 'list' && cur.items?.length && dropOld(cur.items.map((x) => [x]))) { delete next.items; delete next.kind; droppedCards.push(idx); }
    if (!narrChanged && next.screenText === cur.screenText && JSON.stringify(next.takeaways) === JSON.stringify(cur.takeaways) && JSON.stringify(next.items) === JSON.stringify(cur.items)) continue;
    scenes[idx - 1] = next;
    changed.push(idx);
  }
  // 예산 — 늘어난 수정부터 되돌린다.
  if (opts.budgetChars !== undefined) {
    const tot = (): number => scenes.reduce((a, x) => a + x.narration.length, 0);
    const growth = changed.map((k) => ({ k, g: scenes[k - 1]!.narration.length - plan.scenes[k - 1]!.narration.length }))
      .filter((x) => x.g > 0).sort((x, y) => y.g - x.g);
    for (const { k } of growth) {
      if (tot() <= opts.budgetChars) break;
      scenes[k - 1] = { ...plan.scenes[k - 1]! };
      changed.splice(changed.indexOf(k), 1);
      const di = droppedCards.indexOf(k);
      if (di >= 0) droppedCards.splice(di, 1);
      rejected.push(`씬${k}: 예산 초과로 되돌림`);
    }
  }
  const desc = typeof cand?.description === 'string' ? fixScreen(stripEmoji(cand.description).trim()).slice(0, 500) : '';
  const descriptionChanged = !!desc && desc !== plan.description;
  const nx = cand?.next && typeof cand.next.topic === 'string' && cand.next.topic.trim()
    ? { topic: cand.next.topic.trim().slice(0, 120), window: typeof cand.next.window === 'string' && cand.next.window.trim() ? cand.next.window.trim() : undefined }
    : undefined;
  return {
    plan: { ...plan, scenes, ...(descriptionChanged ? { description: desc } : {}), ...(nx && !plan.next ? { next: nx } : {}) },
    changed: changed.sort((a, b) => a - b), rejected, droppedCards: [...new Set(droppedCards)].sort((a, b) => a - b), descriptionChanged,
  };
}

/** 화면 카드(결론 카드·목록)가 사라진 씬 번호(순수, 1-base) — 어느 단계든 카드가 빠지면 로그로 남기려고(2026-10-05 리뷰).
 *  씬 수가 다르면(통째 재집필) 마지막 씬끼리 맞춰 본다 — 결론 카드는 늘 마지막 씬에 있다. */
export function lostCards(prev: Plan, next: Plan): number[] {
  const has = (s: ShortsScene | undefined): boolean => !!(s?.takeaways?.length || (s?.kind === 'list' && s.items?.length));
  if (prev.scenes.length !== next.scenes.length) {
    return has(prev.scenes[prev.scenes.length - 1]) && !has(next.scenes[next.scenes.length - 1]) ? [next.scenes.length] : [];
  }
  return prev.scenes.flatMap((s, i) => (has(s) && !has(next.scenes[i]) ? [i + 1] : []));
}

/** 문제가 훅(씬1)을 지목하는가 — "항목1:"(결정적 린트·단독 이해 공통 꼴) 또는 "1:"·"씬1". */
export function problemsTargetHook(problems: readonly string[]): boolean {
  return problems.some((p) => /^(?:항목\s*1(?![0-9~])|1\s*[:：]|씬\s*1(?![0-9]))/.test(p.trim()));
}

/** 건너뜀류 문제(단독 이해 항목 2·3 계열) — 지시어 미정의·전제 도약·화제 전환·미해소. */
const JUMP_PROBLEM_RE = /전제|도약|갑자기|정의 없이|정의되지|지시어|가리키|미해소|화제|연결 없이|이어지지|맥락 없이|뜬금/;
const problemScene = (p: string): number | null => {
  const m = p.trim().match(/^(?:항목\s*|씬\s*)?(\d+)/);
  return m ? Number(m[1]) : null;
};

/**
 * 남는 왜곡은 원문 문장으로(2026-10-15 사장님 선택 "원문 문장으로 바꾸기").
 * 실측: 보류 16편 중 12편은 같은 대본을 세 번 판정해 두 번 이상 같은 지적이 나왔다(진짜 왜곡). 보내기 전 수정을 다 거친 뒤에도
 * 남는 그런 씬은 작가식 재작성 대신 원문 문장을 거의 그대로(어미만 구어체) 옮긴다 — 말맛보다 원문과 어긋나지 않는 게 먼저다.
 */
/** 세 판정 중 두 번 이상 지목된 씬 번호(순수). 씬 번호 없는 지적은 셀 수 없어 뺀다. */
export function stableProblemScenes(judgments: ReadonlyArray<readonly string[] | null>, sceneCount: number, min = 2): number[] {
  const votes = new Map<number, number>();
  for (const list of judgments) {
    if (!list) continue;
    for (const sc of new Set(list.map(problemScene).filter((x): x is number => x !== null))) votes.set(sc, (votes.get(sc) ?? 0) + 1);
  }
  return [...votes].filter(([k, v]) => v >= min && k >= 1 && k <= sceneCount).map(([k]) => k).sort((a, b) => a - b);
}

/** 원문 문장 옮기기 프롬프트(순수). */
export function literalFixPrompt(a: { scenes: readonly ShortsScene[]; targets: readonly number[]; problems: readonly string[]; source: string; caps: Record<number, number>; keyword?: string }): string {
  return [
    '아래 숏폼 대본에서 지목한 씬은 원문과 어긋난다는 지적이 거듭 나왔다. 그 씬의 내레이션을 원문 문장으로 바꿔라.',
    '',
    `[현재 대본 — 씬 ${a.scenes.length}개]`,
    scriptForEdit(a.scenes),
    '',
    `[바꿀 씬] ${a.targets.join(', ')}`,
    `[지적]\n${a.problems.map((p) => `- ${p}`).join('\n')}`,
    '',
    '[규칙]',
    '· 지적과 관련된 원문 문장 1~2개를 골라 **거의 그대로** 옮겨라 — 어미만 구어체 존댓말(~요)로 바꾸고, 길면 덜 중요한 수식어만 뺀다. 코드가 원문과 글자 단위로 대조한다.',
    '· 원문의 조건("~이면", "~일 때"), 유보("보통", "대개", "~할 수 있어요"), 예외는 반드시 남긴다. 원문에 없는 말·연결·결론을 더하지 마라.',
    `· 길이: ${a.targets.map((k) => `씬${k} ${a.caps[k]}자`).join(' · ')} 이내. 숫자는 읽는 꼴의 한글로("3~4m" → "삼사 미터").`,
    '· screenText 는 새 내레이션의 핵심을 6~14자로. 앞뒤 씬과 이어지게 첫머리 접속어("그래서", "다만")는 써도 된다.',
    a.keyword ? `· 지금 씬에 "${keywordTokens(a.keyword).head}"(대상 이름)가 있으면 새 문장에도 남겨라 — 원문 문장 앞에 주어로 붙여도 된다.` : '',
    '',
    `[원문 블로그]\n${a.source}`,
    '',
    'JSON 형식: {"scenes":[{"index":씬번호,"narration":"...","screenText":"..."}]} — 지목한 씬만.',
  ].filter((x) => x !== '').join('\n');
}

const litNorm = (t: string): string => t.normalize('NFC').replace(/\*\*|__|[`#>|\[\]()]/g, '').replace(/[\s.,!?~·:;"'“”‘’…-]/g, '');
/** 내레이션이 원문 문장을 거의 그대로 옮겼는가(순수) — 내레이션 문장마다 원문 문장(또는 이웃 두 문장)과 글자쌍 유사도 ≥ floor.
 *  어미를 구어체로 바꾼 정도는 통과하고(실측 0.6~0.8), 작가식 재작성은 걸린다(0.2~0.4). 첫머리 접속어는 떼고 본다. */
export function isNearLiteral(narration: string, source: string, floor = 0.5): boolean {
  const src = source.split(/\n+/).flatMap((l) => l.split(/(?<=[.!?。](?:\*\*)?)\s+/)).map(litNorm).filter((x) => x.length >= 6);
  const windows = [...src, ...src.slice(1).map((x, i) => src[i]! + x)];
  const sents = narration.split(/(?<=[.!?。요다])\s+/).map((x) => litNorm(x.replace(/^(?:그래서|다만|그러니|그런데|또|그리고)\s*,?\s*/, ''))).filter((x) => x.length >= 4);
  return sents.length > 0 && sents.every((n) => windows.some((w) => diceSimilarity(n, w) >= floor || (w.includes(n) && n.length >= 8)));
}

/**
 * 부분 수정 채택 판정(순수) — "나아지지 않았으면 첫 원고를 둔다"(사장님 승인 정의: 문제가 늘었거나 새 건너뜀이 생김).
 * before/after 는 같은 종류의 검사 묶음이어야 한다(결정적 린트 + 단독 이해). 정합(원문 대조)은 양쪽 다 뺀다 — 한쪽에만
 * 있으면 늘 '나아짐'으로 보인다. 새 건너뜀 = 수정본의 건너뜀류 문제가 첫 원고에서 건너뜀으로 지목되지 않은 씬을 짚음
 * (씬 번호를 못 읽으면 건수 비교).
 */
export function partialFixVerdict(before: readonly string[], after: readonly string[], changed?: readonly number[]): { accept: boolean; why: string } {
  if (after.length > before.length) return { accept: false, why: `문제 ${before.length}→${after.length}건` };
  const jb = before.filter((p) => JUMP_PROBLEM_RE.test(p));
  const ja = after.filter((p) => JUMP_PROBLEM_RE.test(p));
  const seen = new Set(jb.map(problemScene).filter((x): x is number => x !== null));
  // changed(부분 수정이 바꾼 씬)를 주면 그 씬과 바로 뒤 씬에 걸린 건너뜀만 '새 것'으로 센다 — 손대지 않은 이음새의 새 지적은
  // 수정이 만든 게 아니라 판정 흔들림이다(그걸로 좋은 수정을 버리지 않게). 통째 재집필은 전 씬이 바뀌었으니 주지 않는다.
  const touched = (k: number): boolean => !changed || changed.includes(k) || changed.includes(k - 1);
  const fresh = ja.filter((p) => { const k = problemScene(p); return k === null ? false : !seen.has(k) && touched(k); });
  if (fresh.length) return { accept: false, why: `새 건너뜀 — ${fresh[0]!.slice(0, 60)}` };
  if (ja.length > jb.length && ja.some((p) => problemScene(p) === null)) return { accept: false, why: `건너뜀 ${jb.length}→${ja.length}건` };
  return { accept: true, why: `문제 ${before.length}→${after.length}건` };
}

/**
 * 부분 수정으로는 못 고치는 구조 문제(순수) — 통째 재집필로 넘긴다. 결론 부재(단독 이해 항목 4)·마지막 씬이 CTA 가 아님.
 * 부분 수정이 아무것도 못 고친 경우(응답 불가·유효 수정 0)도 호출부가 재집필로 넘긴다.
 */
export function structuralProblems(problems: readonly string[]): string[] {
  return problems.filter((p) => /결론 부재|결론이 (?:없|끝까지)|마지막 씬 kind/.test(p));
}

/**
 * 흐름 점검 프롬프트(순수, 2026-10-05, SHORTS_FLOW_CHECK) — 감량·트리밍까지 끝난 최종 대본의 이음새만 본다:
 * 씬 k+1 이 씬 k 를 받는가, 씬2 가 세운 틀(무엇을 왜)을 뒤 씬이 지키는가, CTA 가 본문에서 나오는가.
 * 끊긴 이음새의 문장만 고친다(최대 1회). 예산을 넘기느니 바꿔 말한다. 훅은 건드리지 않는다.
 */
export function flowCheckPrompt(a: { scenes: readonly ShortsScene[]; budgets: ReturnType<typeof sceneCharBudgets>; keyword?: string; hookRule?: string; sourceExcerpt?: string }): string {
  const n = a.scenes.length;
  const cur = a.scenes.reduce((s, x) => s + x.narration.length, 0);
  return [
    '아래는 완성 직전의 숏폼 대본이다. 소리로 한 번만 듣는 시청자 입장에서 씬 사이 이음새만 점검하라.',
    `[대본 — 씬 ${n}개, 내레이션 합계 ${cur}자]`,
    scriptForEdit(a.scenes),
    '',
    // 이음새마다 판정을 받는다(2026-10-05 라이브 점검) — "끊긴 곳만 보고하라"는 첫 판은 분석상 4곳 중 3곳이 끊긴 산딸나무 인스타
    // 최종본을 "끊김 없음"으로 냈다. 판정을 칸마다 강제하고 끊김의 꼴을 실례로 준다.
    `이음새 ${n - 1}곳(씬1→2 … 씬${n - 1}→${n})을 하나씩 판정하라. 끊김의 꼴:`,
    '  (a) 앞 씬들에 없던 대상·이름·기준이 이음말 없이 처음 나온다(예: 열매 보는 법 다음 씬이 갑자기 "산딸기는 가시 있는 덤불이고…")',
    '  (b) 앞 씬이 던진 질문·조건·약속에 답하지 않고 화제가 바뀐다',
    '  (c) 지시어("그", "이 기준", "그래서")가 앞에서 세우지 않은 것을 가리키거나, "그래서"인데 인과가 없다',
    '  (d) 씬2 가 세운 틀(무엇을 왜 보는지)을 뒤 씬이 벗어난다, 또는 마지막 씬이 본문에 없던 새 정보로 닫는다',
    '끊긴 이음새만 고쳐라 — 양쪽 씬 중 한 씬의 이음 문장(첫 문장 또는 끝 문장)만 바꿔 말한다. 멀쩡한 이음새의 씬은 출력하지 마라.',
    // 마지막 이음새는 앞 씬 끝에서 잇는다(2026-10-05 리뷰) — CTA 는 결론 카드·행동 문장을 싣는 자리라, 이음 말 때문에 고치면
    // 결론이 흔들린다(실측 산딸: CTA 를 고치자 결론 카드가 지워졌다). 코드도 마지막 이음새에선 씬${n}을 고칠 후보로 두지 않는다.
    `씬${n - 1}→${n}(마지막 이음새)이 끊겼으면 씬${n - 1} 끝 문장을 고쳐 마지막 씬으로 넘겨라 — 마지막 씬(결론·결론 카드)은 고치지 마라.`,
    `규칙: 씬1(훅)은 고치지 마라(1→2 가 끊겼으면 씬2 첫 문장으로 잇는다). 고친 씬은 지금 길이의 1.2배 이내, 대본 전체 ${a.budgets.total}자 이내 — 넘칠 것 같으면 덧붙이지 말고 바꿔 말하라. 다른 씬이 말한 사실과 어긋나게 쓰지 마라. 유보어·판정 문장은 남긴다. 구어체 존댓말, 이모지 금지.`,
    // 이음 말만 고치는 단계다(2026-10-05 리뷰) — 새 사실·판별 기준이 여기서 들어오면 원문 대조를 다시 받아야 한다.
    '새 사실·수치·판별 기준 추가 금지 — 이음 말(받는 말·넘기는 말)만 바꿔라. 이미 대본에 있는 말과 아래 원문에 있는 말로만 잇는다.',
    a.keyword ? `핵심 키워드 "${a.keyword}" 의 대상 이름이 든 구절은 그 이름을 남겨라.` : '',
    a.hookRule ?? '',
    a.sourceExcerpt ? `[원문 블로그 발췌 — 사실 확인용, 새 사실을 꺼내 오지 마라]\n${a.sourceExcerpt}` : '',
    `JSON 형식: {"transitions":[{"at":1,"ok":true,"why":"한 줄"} … 씬${n - 1}→${n} 까지 ${n - 1}개],"scenes":[{"index":씬번호,"narration":"..."}]} — 고칠 곳이 없으면 scenes 는 빈 배열.`,
  ].filter(Boolean).join('\n');
}

/** 흐름 점검 응답에서 고칠 수 있는 씬(끊긴 이음새 양쪽, 훅 제외) — 순수. transitions 의 ok:false 와 breaks(구 꼴) 둘 다 읽는다. */
export function flowBreaks(j: { transitions?: unknown; breaks?: unknown } | null | undefined): Array<{ at: number; why: string }> {
  const rows = [
    ...(Array.isArray(j?.transitions) ? j!.transitions as unknown[] : []).filter((t) => (t as { ok?: unknown } | null)?.ok === false),
    ...(Array.isArray(j?.breaks) ? j!.breaks as unknown[] : []),
  ];
  return rows.map((r) => ({ at: Math.trunc(Number((r as { at?: unknown } | null)?.at)), why: String((r as { why?: unknown } | null)?.why ?? '').slice(0, 80) }))
    .filter((r) => Number.isInteger(r.at));
}
/** 끊긴 이음새에서 고칠 수 있는 씬(순수) — 훅(씬1)과, 마지막 이음새의 마지막 씬(CTA)은 빼고 앞 씬으로 잇는다(2026-10-05 리뷰).
 *  CTA 를 이음 말 때문에 고치면 결론 카드·행동 문장이 흔들린다. 앞 이음새(k-1→k)에 걸린 씬은 그대로 후보다. */
export function flowFixScenes(breaks: ReadonlyArray<{ at: number }>, n: number): number[] {
  const out = new Set<number>();
  for (const { at: k } of breaks) {
    if (!Number.isInteger(k) || k < 1 || k >= n) continue;
    if (k >= 2) out.add(k);
    if (k + 1 < n) out.add(k + 1);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 기획 단계 수정 라운드의 채택 결정(호출자 주입, 2026-10-05 리뷰) — 부분 수정 판정 → 필요하면 통째 재집필.
 * 어느 호출(재검산·재집필)이 예외를 던져도 앞서 채택한 수정은 지킨다. 종전엔 재집필 예외가 바깥 try 로 튀어 채택한 부분
 * 수정을 버리고 오버레이 수치 제거(stripUnsourcedStatOverlays)·factGate 잔존 표시까지 건너뛰었다.
 * 재검산이 실패한 후보는 채택하지 않는다(나아졌는지 모른다). 돌려주는 stage 는 씬별 출처 기록용이다.
 */
export async function chooseFixedPlan(a: {
  base: Plan; merged: ReturnType<typeof mergePartialFix>; before: readonly string[];
  recheck: (p: Plan) => Promise<string[]>; fullRewrite: () => Promise<Plan | null>;
  hookConflict?: boolean; say: (m: string) => void;
}): Promise<{ plan: Plan; stage: string } | null> {
  const { base, merged, before } = a;
  let best: { plan: Plan; stage: string } | null = null;
  let needFull = !merged.changed.length && !merged.descriptionChanged && !(merged.plan.next && !base.next);
  if (!needFull) {
    const after = await a.recheck(merged.plan).catch(() => null);
    if (after) {
      const v = partialFixVerdict(before, after, merged.changed);
      if (v.accept) best = { plan: merged.plan, stage: '부분 수정' };
      if (structuralProblems(before).length && structuralProblems(after).length) needFull = true;
      a.say(`부분 수정 판정 — ${v.accept ? '채택' : '첫 원고 유지'}(${v.why})${needFull ? ' · 구조 문제 남음 → 통째 재집필' : ''}`);
    } else a.say('부분 수정 재검산 실패 — 첫 원고 유지');
  } else a.say('부분 수정 무효(유효 수정 0) → 통째 재집필');
  if (needFull) {
    let fixed = await a.fullRewrite().catch(() => null);
    // 훅 화면 어긋남 편에서 재집필이 화면 지목 훅을 되살리면 첫 원고 훅으로 되돌린다(첫 원고 훅이 멀쩡할 때만) — 부분 수정의 hookReject 와 같은 규칙.
    if (fixed && a.hookConflict && FOOTAGE_DEICTIC_RE.test(fixed.scenes[0]?.narration ?? '') && !FOOTAGE_DEICTIC_RE.test(base.scenes[0]?.narration ?? '')) {
      fixed = { ...fixed, scenes: [{ ...fixed.scenes[0]!, narration: base.scenes[0]!.narration }, ...fixed.scenes.slice(1)] };
    }
    if (!fixed) a.say(`통째 재집필 실패 — ${best ? '채택한 부분 수정 유지' : '첫 원고 유지'}`);
    else {
      const after2 = await a.recheck(fixed).catch(() => null);
      if (!after2) a.say(`통째 재집필 재검산 실패 — ${best ? '채택한 부분 수정 유지' : '첫 원고 유지'}`);
      else {
        const v2 = partialFixVerdict(before, after2);
        a.say(`통째 재집필 판정 — ${v2.accept ? '채택' : '유지'}(${v2.why})`);
        if (v2.accept) best = { plan: fixed, stage: '통째 재집필' };
      }
    }
  }
  return best;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 씬별 출처와 최종 원문 대조(2026-10-05 리뷰) — 첫 원고 뒤 LLM 단계(부분 수정·통째 재집필·감량·감량 뒤 수정·흐름 점검)가 씬을
// 바꿀 때마다 판본을 쌓고, 기획 파이프라인 끝에서 원문 대조를 한 번 돌려 지적된 '바뀐 씬'만 통과 판본으로 되돌린다.
// 종전엔 단계마다 따로 대조(factRecheck)하거나 아예 안 해서 틈이 있었고(첫 원고 지적 0건이면 부분 수정 뒤 재대조 없음),
// 바뀌지 않은 씬의 지적은 버렸다.
// ───────────────────────────────────────────────────────────────────────────────────────────────

/** 한 씬의 판본 — 만든 단계(stage), 원문 대조 결과(ok: true 통과·false 지적·undefined 미확인), 첫 원고 판본인가(draft). */
export interface SceneVersion { stage: string; scene: ShortsScene; ok?: boolean; draft?: boolean }
/** 씬 자리별 판본 더미(오래된 것 → 최신). 맨 위가 지금 대본의 그 씬이다. */
export type SceneTrace = SceneVersion[][];

export function traceStart(scenes: readonly ShortsScene[]): SceneTrace {
  return scenes.map((s) => [{ stage: '첫 원고', scene: { ...s }, draft: true }]);
}

/**
 * 단계 결과 기록(순수, 새 더미를 돌려준다).
 *  llm: LLM 이 쓴 단계면 바뀐 씬마다 새 판본을 쌓는다. 결정적 단계(트리밍·오버레이 제거·예고 정리)는 맨 위 판본을 제자리에서
 *       고친다 — 같은 판본의 손질이라 원문 대조 결과(ok)를 잇는다.
 *  kept: 씬이 빠졌을 때 새 씬 i 가 옛 몇 번 씬인지(trimPlanToBudget·fitShortsPlanToDuration 의 keptScenes, 0-base).
 *  씬 수가 바뀌었는데 kept 가 없으면(통째 재집필) 대응을 모르므로 더미를 새로 시작한다 — 되돌릴 판본이 없어 지적은 보류로 남는다.
 */
export function traceRecord(trace: SceneTrace, scenes: readonly ShortsScene[], stage: string, opts: { llm: boolean; kept?: readonly number[] }): SceneTrace {
  const same = (a: ShortsScene, b: ShortsScene): boolean => JSON.stringify(a) === JSON.stringify(b);
  let base = trace;
  if (opts.kept && opts.kept.length === scenes.length && opts.kept.every((k) => Number.isInteger(k) && k >= 0 && k < trace.length)) {
    base = opts.kept.map((k) => trace[k]!);
  }
  if (base.length !== scenes.length) return scenes.map((s) => [{ stage, scene: { ...s } }]);
  return base.map((vs, i) => {
    const top = vs[vs.length - 1]!;
    const s = scenes[i]!;
    if (same(top.scene, s)) return vs;
    if (opts.llm) return [...vs, { stage, scene: { ...s } }];
    return [...vs.slice(0, -1), { ...top, scene: { ...s } }];
  });
}

/** 원문 대조 결과를 지금 판본(맨 위)에 적는다(순수). issues=null(판정 실패)이면 그대로. 씬 번호를 못 읽는 지적이 섞이면
 *  통과(ok:true)는 적지 않는다 — 그 지적이 어느 씬 얘기인지 모른다. */
export function traceMarkParity(trace: SceneTrace, issues: readonly string[] | null): SceneTrace {
  if (!issues) return trace;
  const flagged = new Set(issues.map(problemScene));
  const unknown = flagged.has(null);
  return trace.map((vs, i) => {
    const bad = flagged.has(i + 1);
    if (!bad && unknown) return vs;
    const top = vs[vs.length - 1]!;
    return [...vs.slice(0, -1), { ...top, ok: !bad }];
  });
}

/** 첫 원고 뒤 LLM 단계가 바꿨는데 아직 원문 대조를 못 받은 씬이 있는가 — 최종 대조를 돌릴지(첫 원고 대조가 실패했어도 돈다). */
export function traceNeedsParity(trace: SceneTrace): boolean {
  return trace.some((vs) => vs[vs.length - 1]!.ok === undefined);
}

/**
 * 최종 원문 대조 뒤 되돌리기(순수). 지적된 씬 중 LLM 단계가 바꾼 씬(맨 위가 첫 원고 판본이 아님)은 가장 최근의 통과 판본
 * (ok:true)으로, 그런 판본이 없으면 지적받지 않은 첫 원고 판본으로 되돌린다. 되돌릴 판본이 없는 씬·바뀐 적 없는 씬의 지적·
 * 씬 번호를 못 읽는 지적은 remaining 으로 남긴다 — 보류(hold) 표시 대상이다(종전 factRecheck 는 이것들을 버렸다).
 * hookReject: 훅 화면 어긋남 편 — 되돌릴 훅 판본이 화면 지목 훅이면 되돌리지 않는다.
 */
export function finalParityRevert(trace: SceneTrace, scenes: readonly ShortsScene[], issues: readonly string[], opts: { hookReject?: RegExp } = {}): {
  scenes: ShortsScene[]; reverted: Array<{ scene: number; from: string; to: string }>; remaining: string[];
} {
  const out = scenes.map((s) => ({ ...s }));
  const reverted: Array<{ scene: number; from: string; to: string }> = [];
  const aligned = trace.length === scenes.length;
  const done = new Set<number>();
  for (const k of new Set(issues.map(problemScene))) {
    if (k === null || !aligned || k < 1 || k > scenes.length) continue;
    const vs = trace[k - 1]!;
    const top = vs[vs.length - 1]!;
    if (top.draft) continue; // LLM 단계가 바꾼 적 없는 씬 — 되돌릴 데가 없다, 지적은 보류로
    let target: SceneVersion | undefined;
    for (let j = vs.length - 2; j >= 0; j--) {
      const v = vs[j]!;
      if (v.ok === true || (v.draft && v.ok !== false)) { target = v; break; }
    }
    // 훅 화면 어긋남 편에서 화면 지목 훅으로 되돌리지 않는다 — 수정 단계들이 거절한 꼴이다(지적은 보류로 남긴다).
    if (!target || (k === 1 && opts.hookReject?.test(target.scene.narration))) continue;
    out[k - 1] = { ...target.scene };
    reverted.push({ scene: k, from: top.stage, to: target.stage });
    done.add(k);
  }
  const remaining = issues.filter((p) => { const k = problemScene(p); return k === null || !done.has(k); });
  return { scenes: out, reverted, remaining };
}

/**
 * 최종 원문 대조 결과로 factGate 를 만든다(순수). result=null(판정 실패) — 대본은 그대로 두고 판정 실패(error)로 표시하되,
 * 이미 보류(hold)면 그 표시를 지킨다. 결과가 있으면 잔존 지적(remaining)이 unsupported 가 되고(있으면 hold), 시기·수치·승계 잔존
 * (display)은 timing 칸에 싣는다. 지적·잔존·이전 표시가 다 없으면 undefined(필드 없음 — 종전 통과 편과 같다).
 */
export function finalFactGate(prev: FactGateInfo | undefined, result: { remaining: readonly string[]; display: readonly string[] } | null, now = new Date().toISOString()): FactGateInfo | undefined {
  if (!result) return prev?.status === 'hold' ? prev : { ...(prev ?? parityToInfo([])), status: 'error', checkedTs: now };
  if (!result.remaining.length && !result.display.length && !prev) return undefined;
  const base = { ...parityToInfo([...result.remaining]), checkedTs: now };
  return result.display.length ? { ...base, timing: [...result.display] } : base;
}

/** 종전 감량 뒤 수정 병합(순수, SHORTS_PARTIAL_FIX=false 경로) — 응답의 내레이션만 바꾸고 자막·결론 카드·목록·연출은 그대로 둔다. */
export function mergeNarrationOnly(plan: Plan, scenes: ReadonlyArray<{ index?: unknown; narration?: unknown } | null>): Plan {
  const out: Plan = { ...plan, scenes: plan.scenes.map((s) => ({ ...s })) };
  for (const s of scenes) {
    const idx = typeof s?.index === 'number' && Number.isInteger(s.index) ? s.index : 0; // 1-base
    if (idx < 1 || idx > out.scenes.length) continue;
    const narration = cleanNarration(s?.narration);
    if (narration) out.scenes[idx - 1] = { ...out.scenes[idx - 1]!, narration };
  }
  return out;
}

/** 길이 상한 초과 대본 압축 — LLM 감량(품질 우선) 후 예산 미달분은 결정적 트리밍이 마감(예산 보장).
 *  budgetCharsOverride: 렌더 후 실측 낭독 속도로 역산한 예산(재감량 경로) — 미지정 시 정적 예산.
 *  keptScenes: 살아남은 씬의 '입력 plan 기준' 인덱스(씬 제거 시 이미지·클립 매핑용). */
/**
 * kind 는 선언됐는데 페이로드가 빈 씬을 메운다 — 못 메우면 kind 를 뗀다(2026-09-04).
 *
 * 왜 지시문으로 안 끝나는가. 기획 프롬프트에는 이미 "compare 씬에는 bad·good 를 반드시 채워라"가
 * 예시까지 붙어 들어가 있다(2026-09-03 대응). 그런데도 세 런 연속으로 kind 만 오고 페이로드가
 * 비었다. 지시문을 더 세게 쓰는 건 이미 한 번 해 본 수라, 같은 수를 반복하는 대신 결정적으로 막는다.
 *
 * 재료는 대본 전체를 준다. 첫 판에서 실패한 이유가 이것이었다 — 그 씬의 내레이션 한 줄만 보여
 * 줬는데, 실측 대본은 대비를 두 씬에 나눠 말하고 있었다(씬4 "꽃 바로 아래 마디는 피하세요",
 * 씬5 "잎이 튼실한 자리 위를 잘라주세요"). compare 는 양쪽이 다 있어야 성립하므로 한 줄만으로는
 * 채울 수가 없었다. 모델이 게을렀던 게 아니라 재료를 반만 준 것이다.
 *
 * 응답이 아무것도 못 채우면 한 번 더 부른다 — 빈 응답·형식 오류 같은 일시적 실패는 재시도로 산다.
 * 두 번째도 못 채우면 거기서 멈춘다. 세 번째부터는 "지어내라"는 압력이 될 뿐이다.
 *
 * 왜 '떼는' 것까지 하는가. 빈 kind 는 화면만 비는 게 아니라 그 씬을 세 군데서 잘못 대접한다.
 *  · defaultSceneFx — 카드가 있는 씬으로 보고 얌전한 움직임(CARD_*)을 준다. 카드가 없는데.
 *  · defaultSceneFx — 계절 파티클 배정에서도 빠진다(카드 씬은 액센트를 안 받는다).
 *  · selectI2vScenes — kind 있는 씬은 점수 5, 없는 씬은 60. 즉 '화면에 이미 뭔가 있으니 모션은
 *    다른 데 주자'고 판단한다. 실제로는 배경과 자막뿐인 씬이 가장 심심한 씬이 된다.
 * 채우지 못한 kind 를 그대로 두면 이 셋이 전부 거짓 전제 위에서 돈다. 떼는 편이 정직하다.
 *
 * 지어내지 말라고 못박는다 — 대본에 없는 대비·수치를 만들어 채우면 사실 게이트를 우회하게 된다.
 */
const KIND_SHAPES: Record<string, string> = {
  stat: '{"value":숫자,"unit":"단위(선택)","label":"라벨(선택)"}',
  list: '["항목","항목"] (2~4개)',
  quote: '{"text":"인용문","source":"출처(원문에 그대로 있을 때만)"}',
  chart: '{"series":[{"label":"라벨","value":숫자}],"unit":"단위","highlight":강조인덱스}',
  compare: '{"bad":{"label":"14자 이내","note":"18자 이내"},"good":{"label":"14자 이내","note":"18자 이내"}}',
};

async function repairEmptyKinds(io: JobIO, plan: Plan): Promise<{ plan: Plan; filled: number[]; dropped: number[] }> {
  const empties = emptyKindScenes(plan.scenes);
  if (!empties.length) return { plan, filled: [], dropped: [] };
  const need = new Set(empties.map((e) => e.index));
  const ask = async (retry: boolean): Promise<Array<Record<string, unknown> | null>> => {
    const j = await microJSON<{ scenes?: Array<Record<string, unknown> | null> }>(
      stdModel(),
      '당신은 숏폼 대본 에디터입니다. 요청된 JSON 스키마만 출력합니다.',
      [
        '아래 숏폼 대본에서 일부 씬은 화면 연출 종류(kind)만 선언되고 그 내용이 비어 있다.',
        '그대로 두면 그 씬 화면에 아무것도 안 나온다. 내레이션이 이미 말하고 있는 것을 화면 값으로 옮겨라.',
        '',
        // 대본 전체를 준다 — 한 씬이 가리키는 대비·수치가 앞뒤 씬 문장에 걸쳐 있는 경우가 실제로 있다.
        ...plan.scenes.map((sc, i) => `씬${i + 1}${need.has(i + 1) ? ' ★채울 것' : ''}: ${sc.narration}${sc.screenText ? ` / 자막: ${sc.screenText}` : ''}`),
        '',
        ...empties.map((e) => `씬${e.index} 은 kind=${e.kind} 다. 채울 형식: ${KIND_SHAPES[e.kind] ?? ''}`),
        '',
        '★ 표시된 씬만 채워라. 그 씬이 가리키는 내용이 앞뒤 씬 문장에 나뉘어 있으면 대본 전체에서 찾아 합쳐라',
        '  (예: 한 씬이 "이건 피하세요", 다음 씬이 "이렇게 하세요"면 그 둘이 compare 의 bad·good 이다).',
        retry ? '앞선 시도가 아무것도 못 채웠다. 대본에 실제로 있는 말만으로 다시 시도하라.' : '',
        '대본에 없는 수치·대비를 지어내지 마라. 대본 어디에도 그 연출의 재료가 없으면 그 씬은 빼라',
        '(빈 채로 두는 것이 지어내는 것보다 낫다).',
        'JSON 형식: {"scenes":[{"index":씬번호,"kind":"연출종류","<해당 필드>":...}]}',
      ].filter(Boolean).join('\n'),
      { maxOutputTokens: 700, signal: io.signal },
    ).catch(() => null);
    return j?.scenes ?? [];
  };

  const scenes = plan.scenes.map((sc) => ({ ...sc }));
  const filled: number[] = [];
  const apply = (rows: Array<Record<string, unknown> | null>): void => {
    for (const r of rows) {
      const idx = Math.trunc(Number(r?.index));
      if (!Number.isInteger(idx) || idx < 1 || idx > scenes.length) continue;
      const want = empties.find((e) => e.index === idx);
      if (!want || filled.includes(idx)) continue; // 비어 있지 않던 씬은 건드리지 않는다
      const fixed = normalizeSceneKind({ ...r, kind: want.kind });
      if (emptyKindScenes([fixed]).length) continue; // 여전히 비었다 — 못 메운 것
      scenes[idx - 1] = { ...scenes[idx - 1]!, ...fixed };
      filled.push(idx);
    }
  };
  apply(await ask(false));
  if (!filled.length) apply(await ask(true)); // 일시적 실패는 재시도로 산다. 두 번이면 충분하다.

  // 끝내 못 메운 kind 는 뗀다 — 거짓 전제로 도는 하류 판단(연출·I2V)을 없앤다.
  const cleaned = dropEmptyKinds(scenes);
  return { plan: { ...plan, scenes: cleaned.scenes }, filled, dropped: cleaned.dropped };
}

async function fitShortsPlanToDuration(io: JobIO, plan: Plan, budgetCharsOverride?: number): Promise<{ plan: Plan; compressed: boolean; beforeChars: number; afterChars: number; keptScenes: number[] }> {
  const cap = CONFIG.shortsMaxDurationSec;
  const budget = budgetCharsOverride ?? Math.floor((cap - 5) * SHORTS_TTS_CPS); // 5초 여유 — TTS 속도 편차·업로드 인트로(1.6초)
  const before = shortsNarrationChars(plan);
  const allIdx = plan.scenes.map((_, i) => i);
  const keep = { plan, compressed: false, beforeChars: before, afterChars: before, keptScenes: allIdx };
  // 트리거: 정적 경로는 상한 예산(cap×CPS) 초과 시, 실측 예산 경로는 그 예산 초과 시.
  if (before <= (budgetCharsOverride ?? Math.floor(cap * SHORTS_TTS_CPS))) return keep;
  const cur = plan.scenes.map((s, i) => `${i + 1}. ${s.narration}`).join('\n');
  const j = await microJSON<{ scenes?: Array<{ index?: unknown; narration?: unknown } | null> }>(
    stdModel(),
    '당신은 숏폼 대본 에디터입니다. 요청된 JSON 스키마만 출력합니다.',
    [
      `아래 숏폼 내레이션 합계가 ${before}자로 낭독 상한(${cap}초 ≈ ${budget}자)을 넘는다. 씬 구성은 유지하고 내레이션만 감량해 합계 ${budget}자 이내로 만들어라.`,
      cur,
      `합계 ${budget}자 이내는 반드시 지켜라 — 표현 다듬기로 모자라면 덜 중요한 문장을 통째로 빼라. 찔끔 깎은 초과 응답은 무효다(실측: 목표 341자에 364자 응답이 반복돼 코드가 강제 트리밍하게 된다 — 그러면 네가 고른 문장이 아니라 뒤 문장이 잘린다).`,
      // 빼는 순서(2026-10-05 숏폼 11편 분석) — 압축이 "산딸기랑 자주 헷갈리는데" 같은 이음 문장과 "개화주란" 정의부터 지워
      // 씬 사이가 끊긴 4건이 나왔다. 이음·정의·판정은 문장 수는 적어도 흐름의 뼈대라 맨 나중에 뺀다.
      '빼는 순서: 먼저 수식어·예시·같은 말 되풀이 → 그다음 덧붙인 부연 → 맨 나중에야 ① 앞 씬을 받아 잇는 이음 문장("그래서/그런데/그럼 ~" 류, 앞 씬의 질문에 답하는 첫 문장) ② 뒤 씬이 쓰는 말의 정의 문장 ③ 판정 문장("~면 ~예요/~하세요"). 이 셋을 지우면 씬 사이가 끊긴다 — 줄여야 하면 지우지 말고 짧게 바꿔 말하라.',
      '규칙: 사실·수치·결론과 씬별 "무엇을+왜"는 유지하고 군더더기·중복 표현만 깎아라. 조사·주어를 떨어낸 초압축은 감량이 아니라 훼손이다("이 시기 질소 거름 주면" 금지 → "이 시기엔 질소 거름을 주면"). 구어체 존댓말·숫자 한글 낭독 등 원문 문체 유지, 이모지 금지. 유보어("대개/흔히/보통/~일 수 있다/~봐요/가능성")는 군더더기가 아니다 — 남겨라. 원문 결론의 방향("미루라/하지 마라")을 뒤집지 마라.',
      '마지막 씬(CTA)·결론 카드가 되받는 앞 씬의 사물·이름·근거(예: 결론이 "옹이부터 보라"면 옹이가 처음 나오는 문장)는 지우지 마라 — 지우면 결론이 허공에 뜬다(실측).',
      'JSON 형식: {"scenes":[{"index":씬번호,"narration":"..."}]} — 전 씬 포함.',
    ].join('\n'),
    { maxOutputTokens: 1200, signal: io.signal },
  ).catch(() => null);
  let out: Plan = { ...plan, scenes: plan.scenes.map((s) => ({ ...s })) };
  if (j?.scenes) {
    for (const s of j.scenes) {
      const idx = typeof s?.index === 'number' && Number.isInteger(s.index) ? s.index : 0; // 1-base
      if (idx < 1 || idx > out.scenes.length) continue;
      const narration = cleanNarration(s?.narration);
      if (narration && narration.length < out.scenes[idx - 1]!.narration.length) out.scenes[idx - 1]!.narration = narration;
    }
  }
  // 압축이 유보어를 지워 결론을 반전시킨 실측 대응 — 결정적 트리밍(예산 보장) 전에 원문장으로 복원.
  try {
    const hedged = restoreLostHedges(plan, out);
    if (hedged.restored.length) { out = hedged.plan; io.bus?.emit('log', { message: `압축 — 유보어 소실 씬 ${hedged.restored.join(',')} 원문장 복원` }); }
  } catch { /* fail-open — 복원 실패로 압축 자체를 막지 않는다 */ }
  // 결정적 마감 — LLM 무응답·부분 이행 모두 여기서 예산을 보장한다(생성 실패 금지의 전제).
  let keptScenes = allIdx;
  if (shortsNarrationChars(out) > budget) {
    const t = trimPlanToBudget(out, budget, CONFIG.shortsScenes); // 씬 수는 항상 유지(2026-09-09) — 문장만 깎는다
    out = t.plan;
    keptScenes = t.keptScenes;
  }
  const after = shortsNarrationChars(out);
  return after < before
    ? { plan: out, compressed: true, beforeChars: before, afterChars: after, keptScenes }
    : keep;
}

/**
 * 시기·수치 대조 입력(순수) — 시청자가 실제로 보고 듣는 파생 텍스트 전부: 내레이션·자막 + dataviz 오버레이
 * 값(stat·chart·list·quote) + 설명(유튜브 설명 = 인스타 캡션에 복제된다).
 */
export function timingFields(plan: Plan): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [];
  plan.scenes.forEach((s, i) => {
    const n = i + 1;
    if (s.narration) out.push({ field: `씬${n} 내레이션`, text: s.narration });
    if (s.screenText) out.push({ field: `씬${n} 자막`, text: s.screenText });
    if (s.kind === 'stat' && s.stat) out.push({ field: `씬${n} 오버레이`, text: `${s.stat.value}${s.stat.unit ?? ''} ${s.stat.label ?? ''}`.trim() });
    if (s.kind === 'chart' && s.chart) out.push({ field: `씬${n} 차트`, text: s.chart.series.map((x) => `${x.label} ${x.value}${s.chart?.unit ?? ''}`).join(', ') });
    if (s.kind === 'list' && s.items?.length) out.push({ field: `씬${n} 목록`, text: s.items.join(' / ') });
    if (s.kind === 'quote' && s.quote?.text) out.push({ field: `씬${n} 인용`, text: s.quote.text });
    // 결론 카드(2026-08-28) — 사용자 확정으로 화면이 답을 '단독으로' 진다(내레이션은 기준만 말한다).
    // 그래서 이 텍스트가 대조에서 빠지면 검증받지 않은 답이 화면에만 떠서 나간다 — 다른 오버레이와 동렬로 싣는다.
    if (s.kind === 'cta' && s.takeaways?.length) out.push({ field: `씬${n} 결론`, text: s.takeaways.map((t) => `${t.when} → ${t.then}`).join(', ') });
  });
  if (plan.description) out.push({ field: '설명', text: plan.description });
  return out;
}

/**
 * 이 숏폼이 다음 편을 예고해도 되는가(2026-10-02). 셋 중 하나라도 걸리면 예고 금지 — 이유를 함께 돌려준다.
 * ① 예고 대장 만석 — 등록이 거절돼 지켜지지 않는 약속이 영상에 남는다(실측: 12/12 에서 6편이 낭독, 등록 0).
 * ② 원글이 예고 이행 글 — 이행 글의 파생이 또 예고하면 약속이 꼬리를 물어 자율 틱이 같은 수종 후속편으로만 찬다
 *    (기존 266편 중 108편이 예고했다). 연쇄는 한 단계까지만.
 * ③ 같은 글의 다른 채널 편이 이미 예고했다 — 글 하나에 약속 하나. 이행 글은 블로그·두 채널 숏폼을 다 만든다.
 * 대장 읽기 실패는 '자리 있음'(fail-open).
 */
export function promiseRoomFor(short: { id?: string; brand?: string; sourcePieceId?: string }): { room: boolean; why?: string } {
  try {
    if (promiseStore().pending(short.brand ?? '').length >= MAX_PENDING) return { room: false, why: '예고 대장 만석' };
    if (short.sourcePieceId && promiseStore().fulfilledBy(short.sourcePieceId)) return { room: false, why: '예고 이행 글의 파생(연쇄 예고 금지)' };
    if (short.sourcePieceId) {
      const store = shortsStore();
      for (const sib of store.list()) {
        if (sib.id === short.id || sib.sourcePieceId !== short.sourcePieceId || sib.stage === 'error') continue;
        if (promiseStore().list().some((p) => p.sourceId === sib.id && p.status !== 'dropped')) return { room: false, why: '같은 글의 다른 채널 편이 이미 예고' };
        try {
          const sp = JSON.parse(fs.readFileSync(path.join(store.dirFor(sib.id), 'plan.json'), 'utf-8')) as { next?: { topic?: string } };
          if (sp.next?.topic) return { room: false, why: '같은 글의 다른 채널 편이 이미 예고' };
        } catch { /* 형제 대본 없음 — 통과 */ }
      }
    }
    return { room: true };
  } catch { return { room: true }; }
}

/**
 * 다음 편 예고 정리(순수, 2026-10-02 숏폼 10편 감사) — 낭독 직전 대본 기준으로 '영상이 한 약속 = 대장의 약속'을 맞춘다.
 *
 * 자리 있음: next 가 있는데 마지막 씬에 앞을 가리키는 말이 하나도 없으면(mentionsNextEpisode, 넉넉한 판정) next 를
 *   지운다 — 시청자가 듣지 않은 주제가 대장 자리를 먹지 않게(실측 10편 중 3편). 반대로 예고 문장은 있는데 next 가
 *   없으면(수정 라운드도 못 채움) 그 문장을 덜어낸다 — 등록할 주제가 없는 약속이다.
 * 자리 없음: 예고 문장과 자막의 예고 표지를 덜고 next 를 지운다.
 * 예고 문장뿐인 CTA 면 문장은 그대로 둔다(빈 CTA 보다 낫다) — 수정 라운드 린트가 먼저 잡는 경우다.
 * 예고를 덜어 CTA 의 행동 문장이 사라지면 자막의 행동 문장(ctaActionFromScreen)으로 닫는다 — 예고뿐인 CTA 도 그 문장으로 바꾼다.
 */
export function settleNextEpisode<P extends { scenes: Array<{ narration: string; screenText?: string }>; next?: { topic: string; window?: string } }>(
  plan: P, room: boolean,
): { plan: P; note?: string } {
  const lastIdx = plan.scenes.length - 1;
  const last = plan.scenes[lastIdx];
  if (!last) return { plan };
  const announced = announcesNextEpisode(last);
  const { next: _next, ...withoutNext } = plan;
  let why: string;
  if (room) {
    if (plan.next && !mentionsNextEpisode(last)) return { plan: withoutNext as P, note: `예고 없는 next 제거 — "${plan.next.topic.slice(0, 30)}"(영상이 말하지 않은 약속)` };
    if (plan.next || !announced) return { plan };
    why = '예고했지만 next 미선언';
  } else {
    if (!announced) return plan.next ? { plan: withoutNext as P, note: '예고 금지 — next 제거' } : { plan };
    why = '예고 금지';
  }
  const stripped = stripNextEpisode(last.narration);
  const cut = stripped !== last.narration.trim();
  // 행동 문장 되살리기(2026-10-05, 실측 산딸 유튜브 short_8a08fe7899) — 예고를 덜고 남은 CTA 가 "~게 정확해요" 같은 판정 한 줄뿐이면
  // 영상이 행동 없이 끝난다. 자막이 이미 행동 문장("열매부터 눌러보세요")이면 그걸 낭독에 붙인다 — 새 사실이 아니라 화면에 이미
  // 나가는 말이고, 덜어낸 예고보다 길어지지 않을 때만. 앞 씬과의 이음새(그 편의 4→5)는 이걸로 고쳐지지 않는다 — 이 정리는 흐름 점검 뒤에 돈다.
  const action = cut ? ctaActionFromScreen(stripped, last.screenText) : '';
  const fixed = action && `${stripped} ${action}`.trim().length <= last.narration.trim().length ? `${stripped} ${action}`.trim() : '';
  const scenes = plan.scenes.map((s, i) => (i === lastIdx
    ? { ...s, narration: fixed || stripped || s.narration, ...(screenTextAnnounces(s.screenText) ? { screenText: '' } : {}) }
    : s));
  return {
    plan: { ...withoutNext, scenes } as P,
    note: fixed ? `${why} — CTA 예고 문장 제거·자막 행동 문장으로 마무리("${action.slice(0, 20)}")`
      : stripped && cut ? `${why} — CTA 예고 문장 제거`
      : stripped ? `${why} — 자막 예고 표지 제거` : `${why} — CTA 가 예고뿐이라 문장은 유지(next 만 제거)`,
  };
}

/**
 * 예고를 덜어 낸 CTA 에 붙일 행동 문장(순수) — 남은 내레이션이 이미 "~세요"로 끝나면 빈 문자열(그대로 충분).
 * 자막이 "~세요"로 끝나는 행동 문장이고, 숫자(낭독은 한글 숫자)·예고 표지가 없고, 내레이션에 이미 같은 말이 없을 때만 그 자막을 쓴다.
 */
export function ctaActionFromScreen(remainder: string, screenText: string | undefined): string {
  const r = remainder.trim();
  if (/세요[.!?…~]*$/.test(r)) return '';
  const st = (screenText ?? '').trim();
  if (!/세요[.!?…~]*$/.test(st) || /[0-9]/.test(st) || isPromiseSentence(st) || screenTextAnnounces(st)) return '';
  const bare = st.replace(/[.!?…~]+$/, '');
  if (r.replace(/\s+/g, '').includes(bare.replace(/\s+/g, ''))) return '';
  return `${bare}.`;
}

/** 예고 주제에 대상 수종이 없으면 원글의 수종을 붙인다 — 주제가 그대로 다음 글 제목이 되므로(실측: "심는 구덩이 크기와 첫 물주기 순서"). */
export function promiseTopicWithSpecies(topic: string, context: string): string {
  if (speciesNamesIn(topic).length) return topic;
  const sp = findSpeciesLoose(context)?.name;
  return sp && !topic.includes(sp) ? `${sp} ${topic}` : topic;
}

/** quote 출처 라벨은 원문(블로그 본문)에 그 문자열이 있을 때만 유지 — 패러프레이즈에 가짜 출처("— 재배 기록")가 붙어 발행된 실측 6건 대응(스펙 §6a). */
export function pruneQuoteSources(plan: Plan, sourceBody: string | undefined): { plan: Plan; pruned: number } {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const body = sourceBody ? norm(sourceBody) : '';
  let pruned = 0;
  const scenes = plan.scenes.map((s) => {
    if (s.kind !== 'quote' || !s.quote?.source) return s;
    if (body && body.includes(norm(s.quote.source))) return s;
    pruned++;
    const { source: _drop, ...rest } = s.quote;
    return { ...s, quote: rest };
  });
  return { plan: { ...plan, scenes }, pruned };
}

/** 원문 핵심 축 요약(제목+소제목, 순수) — standaloneIssues 의 '원문 정합' 검사 입력. 파생이 아니면
 *  undefined(검사 생략). planShorts 의 1차 검산과 runShortsJob 의 감량 뒤 재검산(§4-1, fix round 1)
 *  양쪽이 같은 값을 만들어야 두 시점의 정합 판정이 어긋나지 않는다 — 한 곳에 둔다. */
function sourceCoreOf(topic: string, sourceBody: string | undefined): string | undefined {
  return sourceBody
    ? [topic, ...sourceBody.split('\n').filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim())]
        .filter(Boolean).slice(0, 8).join(' · ')
    : undefined;
}

export async function planShorts(io: JobIO, topic: string, keyword: string | undefined, sourceBody: string | undefined, n: number, priorCoverage = '', titleTypes: string[] = ['정보형', '후킹형', '질문형'], sourceFlagged: string[] = [], writerRole = 'shorts_writer', recentMainTitles: string[] = [], loreFacts: string[] = [],
  /** promiseRoom: 예고 대장에 자리가 있는가(없으면 예고 금지) · hookFootage: 씬1(훅)에 그대로 나갈 실촬영 영상의 비전 묘사.
   *  hookConflict: 훅 실촬영이 주제와 어긋난 사유(footageContradictsTopic) — 있으면 hookFootage 대신 단정형 훅을 강제한다.
   *  platform: 채널 — 유튜브는 씬2 에 '키워드+답' 한 문장(2026-10-05).
   *  trace: 씬별 출처 출력 칸(2026-10-05) — 돌려준 대본의 씬마다 어느 단계가 바꿨고 원문 대조를 받았는지. 최종 원문 대조(runShortsJob)가 쓴다. */
  extra: { promiseRoom?: boolean; hookFootage?: string; hookConflict?: string; platform?: ShortsPlatform; trace?: { value?: SceneTrace }; anchor?: boolean } = {}): Promise<Plan | null> {
  const capSec = CONFIG.shortsMaxDurationSec;
  // 원문 근거 짚기(2026-10-15) — 파생 편만. extra.anchor 는 시험용 강제(켜기·끄기).
  const anchored = !!sourceBody && (extra.anchor ?? anchorOn(CONFIG.shortsSourceAnchor, extra.platform));
  const promiseRoom = extra.promiseRoom !== false;
  const hookRule = extra.hookConflict ? assertiveHookRule(extra.hookConflict) : '';
  // 장르 분기(2026-09-18) — 원본 제목이 이야기 축이면 하우투 전용 네 줄(결론·기본형·takeaways·뽑을 것)을 이야기형으로.
  // 재배 편은 사실 공급이 모아 온 이야기 사실을 훅 소재로 받는다. 그 사실은 블로그 본문에 없으므로 정합·시기수치
  // 게이트가 보는 원문(sourceForGates)에도 같은 줄을 덧붙인다 — 안 그러면 훅이 '원문에 없는 사실'로 잡혀 수정된다.
  const genre: ShortsGenre = shortsGenreOf(topic, CONFIG.shortsLore);
  const guide = genreGuide(genre);
  const hooks = CONFIG.shortsLore && genre === 'howto' ? loreFacts : [];
  const hookSource = loreHookSource(hooks);
  const sourceForGates = sourceBody && hookSource ? `${sourceBody}\n\n${hookSource}` : sourceBody;
  // 작가가 받는 원문(2026-10-15) — 근거 미확인 문장을 뺀 판본. 판정은 위 sourceForGates(원문 전체)로 계속 본다.
  const ws = writerSource(sourceBody ?? '', sourceFlagged);
  if (ws.removed) { const m = `작가용 원문에서 근거 미확인 문장 ${ws.removed}개 뺌`; console.log(`[숏폼] ${m}`); io.bus?.emit('log', { message: m }); }
  const writerBody = sourceBody ? ws.body : undefined;
  const sourceForWriter = writerBody && hookSource ? `${writerBody}\n\n${hookSource}` : writerBody;
  // 제목 후보 유형(권고 5) — 스키마 예시와 유형 설명이 같은 목록을 가리켜야 작가가 순서대로 채운다.
  const titlesJson = titleTypes.map((t) => `"${t}"`).join(',');
  const budgetChars = Math.floor((capSec - 5) * SHORTS_TTS_CPS);
  // 씬 상한 = 요청 씬 수(2026-09-09). 종전 floor(capSec/8) 역산은 35초 상한에서 4가 되어 5번째 씬(CTA)을 잘라냈다.
  const maxScenes = Math.min(8, Math.max(3, n));
  // 씬별 자수(2026-10-05) — 같은 예산에서 나온다(sceneCharBudgets 주석). 35초·속도 1.2·5씬 → 훅 20 · 씬2 50 · 본문 45 · CTA 34.
  const budgets = sceneCharBudgets(budgetChars, maxScenes);
  const user = [
    `[주제] ${topic}`,
    keyword ? `[핵심 키워드] ${keyword}` : '',
    priorCoverage,
    writerBody ? `[블로그 초안 본문 — 핵심 1~2개와 그것이 성립하는 이유(전제 인과 한 줄)를 함께 추려 재구성하라(문장 복붙 금지, 사실·수치는 원문에 있는 것만)]\n${writerBody.slice(0, 4000)}` : '',
    // 원문 핵심 앵커(2026-08-24 실사고) — 블로그는 '화분 크기'가 핵심 축인데 유사주제 가드에 밀린 작가가
    // 그 축을 통째로 빼고 곁가지(겨울 자리)로만 대본을 만들어 세트의 메시지가 어긋났다. 소재 선택은
    // 원문이 이기고, 프레이밍(각도)은 중복 회피가 이긴다는 서열을 명시한다.
    // 2026-10-12 사장님 지시("블로그 글에서 핵심 내용만") — 원문 맨 위 굵은 요약 두 줄이 그 글이 고른 핵심이다. 그것을 첫 후보로.
    sourceBody ? '원문 핵심 앵커: 원문 맨 위 굵은 요약 두 줄(**…**)이 그 글의 핵심 답이다 — 그것을 첫 후보로 삼는다. 원문 제목·소제목이 힘준 핵심 축 중 최소 1개를 대본의 중심 소재로 삼아라 — 원문이 강조하지 않은 곁가지만으로 대본을 채우면 실패다. 그 핵심 축이 [이미 만든 유사 주제] 목록에서 이미 다뤄진 경우에만 다음 축으로 넘어가고, 전부 다뤄졌다면 소재는 유지하되 다른 독자 상황·글 유형으로 재구성하라(소재 선택은 원문이, 프레이밍은 중복 회피가 이긴다).' : '',
    // 매체 전환 선언(2026-08-28 사용자 지적) — 종전 지시는 "문장 복붙 금지"까지였다. 실측(short_b894bf71fb)
    // 유사도는 38~56%라 복붙은 안 했는데도, 씬 순서가 원문 소제목 순서를 그대로 따라가 '요약본'이 됐다:
    // 문제제기→방법→방법→다른주제→목록. 블로그는 훑어 읽으며 필요한 대목만 골라 가는 매체라 병렬 나열이
    // 통하지만, 숏폼은 되감기가 없어 한 줄기로 끝까지 끌고 가야 한다. 복붙 금지는 '문장'의 문제였고,
    // 이 지시는 '구성'의 문제다 — 원문에서 가져올 것은 사실이지 순서가 아니다.
    // 원문 미검증 주장 예방(2026-08-28 처방 C) — 사후 검출(inheritedClaims)의 짝. 작가가 애초에 안 쓰는 게
    // 가장 싸다. 원문에 '있으니까 안전하다'는 판단을 여기서 무너뜨린다 — 원문에 있어도 근거는 없는 문장들이다.
    sourceFlagged.length ? `[원문에서 근거가 확인되지 않은 주장 — 원문 본문에 적혀 있어도 대본·자막·화면 어디에도 쓰지 마라. 사실 게이트가 근거를 못 찾은 문장들이다]\n${sourceFlagged.slice(0, 8).map((c, i) => `${i + 1}. ${c}`).join('\n')}\n이 주장들을 바꿔 말하거나 요약해서 싣는 것도 금지다(수치·시기만 떼어 목록에 넣는 것 포함). 이 소재를 꼭 다뤄야 하면 단정 대신 조건·한계를 밝혀 쓰고 숫자는 적지 마라.` : '',
    sourceBody ? '[매체 전환 — 요약본이 아니라 새 대본] 원문에서 가져오는 것은 **사실과 근거**이지 구성이 아니다. 원문의 소제목 순서를 그대로 따라가지 마라 — 블로그는 필요한 대목만 골라 읽는 매체라 여러 갈래를 나란히 둬도 되지만, 숏폼은 되감기가 없어 한 줄기로만 끝까지 간다. 원문의 여러 축 중 **하나만 골라** 그 축으로 끝까지 밀고, 나머지는 통째로 버려라(다 담으면 아무것도 안 남는다). 고른 축은 훅에서 던진 문제와 마지막 씬의 답이 같은 줄기로 이어져야 한다.' : '',
    '',
    `씬 ${n}개의 유튜브 숏폼 대본을 기획하라. 씬1=훅 — 유형은 ① 장면 지목(청자가 지금 겪는 한 장면: 가위 앞에서 멈춘 손, 옆집 창, 콩알 열매) ② 단정 선언 ③ 숫자 제시. ①이 기본값이다(인스타 상위 8편 중 5편이 ①, 실측 2026-09-18). [최근 숏폼의 훅] 목록에 ①이 연달아 있으면 ②③으로. 씬2=전제(이 영상이 무엇에 대한 이야기이고 왜 문제/중요한지를 못박는다 — 원문의 핵심 인과 한 줄), 마지막 씬=CTA.`,
    // 씬2 인과 연결(2026-08-28) — 실측: 훅이 "옆집 창이 마당을 본다"로 사생활 긴장을 세웠는데 씬2가 그걸
    // 받지 않고 곧바로 "두 가지를 적어요"로 넘어가, 시청자에게 화제 전환으로 읽혔다. 원문에는 그 고리가
    // 있었다("그럼 나무를 몇 미터짜리로 심어야 할까요") — 대본이 떨어뜨린 것이다.
    '씬2는 훅이 세운 긴장을 **받아서** 이어라 — 훅의 문제가 왜 이 영상의 주제로 이어지는지 한 마디로 잇고 나서 전제를 말한다. 훅과 무관한 기준·항목을 씬2에서 새로 꺼내면 시청자에겐 화제 전환으로 들린다. 훅에서 세우지 않은 두 번째 축을 씬2에 끼워 넣지 마라.',
    '시청자는 원문 블로그를 본 적이 없다 — 영상 단독으로 완결되게 써라: 핵심 주제어(식물명·행위명 등)를 훅 또는 씬2에서 반드시 명시하고, 지시어·축약어("짝"·"그 방법"·"두 그루" 류)는 앞 씬에서 뜻을 세운 뒤에만 사용하라. 단, 명시는 검색 표기 그대로일 필요 없다 — 키워드 명사구를 통째로 주어 자리에 세우지 말고("가을 묘목 심는 법은 ~로 정해집니다" 식 금지, 검색용 문장 티가 난다) 조사·어순을 바꿔 말이 되는 꼴로 녹여라("가을에 묘목을 심을 땐 날짜보다 뿌리부터 봐요"). 검색 표기 그대로의 노출은 title·titles·description·해시태그·screenText 가 담당한다. 단 씬2(전제)의 정의 한 문장은 예외 — 뒤 씬에서 쓸 기준·개념(예: "두 선")은 씬2에서 이름 붙여 뜻을 세워라. 어순·조사는 바꿔도 되지만 정의 자체를 얼버무리지 마라. 훅에서 감춘 대상도 씬2에서 반드시 밝힌다.',
    // 검색어+답 앞세우기(2026-10-05 사장님 승인) — 네이버 클립 AI 요약은 낭독·화면 글자를 읽고, 유튜브는 검색이 유일한 확대 경로다.
    // 위 '키워드 명사구를 주어로 세우지 마라'는 검색어 나열 꼴을 막는 규칙이라, 말이 되는 '수종+행위는 ~예요' 답 문장과는 다르다 —
    // 둘이 부딪히지 않게 유튜브 씬2 만 예외로 못박는다. 훅(씬1)은 종전대로 키워드로 열지 않는다(hookKeywordLeadIssues).
    extra.platform === 'youtube' ? '단 이 유튜브 편의 씬2 첫 문장은 위 규칙의 예외다 — 훅을 받는 그 첫 문장이 곧 답이다: 검색 키워드의 대상과 행위를 주어로 세우고 그 답을 바로 말하는 한 문장으로 써라(예: "배롱나무 가지치기는 잎이 다 진 뒤, 11월부터예요"). 말이 되는 꼴로(검색어 나열 "가지치기 시기 배롱나무는" 금지). 씬2 screenText 에도 그 답을 짧게(예: "11월, 잎 진 뒤").' : '',
    extra.platform === 'instagram' && keyword ? '인스타 편은 공유형 훅을 유지하되, 핵심 키워드의 대상 이름(수종명)은 내레이션에서 한 번은 소리 내 말하라 — 검색·AI 요약이 음성을 읽는다.' : '',
    '훅 금지 문형: "~보셨나요?/~라고요? + 정작/사실은/그럼 이미 ~" 질문-반전 공식(최근 편들이 과다 사용). 단정 선언("까맣게 익어도 아직 이릅니다"), 구체 장면, 숫자 제시, 청자 상황 지목, 짧은 제동("잠깐,") 등에서 앞 편들과 다른 유형을 골라라.',
    // 첫 2초 훅 분리(2026-08-20 조회수 감사) — 최근 47편 중 17편이 첫 2초를 키워드·상품명 낭독에 써서
    // 추천 피드 이탈 요인이 됐다. 검색 표기는 제목·캘리·화면텍스트가 담당(사용자 확정 원칙 유지).
    '훅 첫 문장을 키워드·수종명·상품명 낭독으로 열지 마라 — 첫 2초(약 12자)가 스와이프 이탈을 결정한다. 긴장·장면·숫자·상황 지목으로 열고, 키워드 명시는 훅의 뒷문장 또는 씬2에서 하라.',
    // 훅 화면 고정(2026-10-02 숏폼 10편 감사) — 훅 씬에는 보관소 실촬영이 그대로 나가는데 작가는 그걸 몰라 장면을 지어냈다.
    // 실측 4/10편: 꽃 핀 배롱나무 밭 위에 "잎 다 떨어진 배롱나무 앞", 길가 대추나무 위에 "가지가 빗자루처럼 뭉쳐",
    // 서 있는 묘목 위에 "잔뿌리를 만지다 손이 멈췄어요". 비전 묘사는 맞았다(로그 대조) — 작가가 그게 훅인 줄 몰랐던 것.
    // 훅 화면이 주제와 어긋나면(2026-10-05, 호두 두 편) 묘사를 주지 않고 단정형 훅을 강제한다 — 묘사를 주면 작가가 그걸로 훅을 쓴다.
    hookRule,
    !hookRule && extra.hookFootage ? `[훅 화면 — 씬1 에는 이 실촬영 영상이 그대로 나간다] ${extra.hookFootage}\n씬1(훅) 내레이션은 이 화면에 실제로 보이는 것만 가리켜라 — 화면에 없는 손·도구·뿌리·리본, 화면과 다른 잎 상태(다 떨어진 잎·만개한 꽃)나 병 증상을 지어내지 마라. 위 장면 지목 예시(가위 앞에서 멈춘 손 등)보다 이 규칙이 우선한다. 장면 지목형이면 이 화면 속 대상을 지목하고, 화면이 주제의 장면과 다르면 화면 묘사 없는 단정 선언·숫자형 훅으로 써라.` : '',
    keyword ? `대표 제목(title)과 정보형 제목 후보에는 핵심 키워드 '${keyword}' 를 정확히 이 표기 그대로, 가급적 앞쪽에 포함하라(검색 노출용 — 제한된 글자수를 이유로 키워드를 빼지 마라). 키워드는 명사구 그대로 자연스럽게 결합하고 어미를 붙여 동사화하지 마라.` : '',
    `CTA 씬은 팔로우할 이유를 담아라 — 이 채널이 계속 주는 가치 한 구절(브랜드 맥락에 맞게)${promiseRoom ? ' 또는 다음 편 예고 중 하나' : ''}. "구독과 좋아요 부탁드려요" 같은 기계적 문구 금지. "계속 기록/정리해 드립니다" 계열 문구 재사용 금지 — 기록하는 채널 컨셉은 유지하되 표현은 매편 새로 지어라.`,
    // 예고는 대장에 자리가 있을 때만(2026-10-02) — 만석이면 등록이 거절돼 지켜지지 않는 약속이 영상에 남았다(실측 6/10편).
    // 이행은 다음 자율 틱이다(같은 날 사장님 확정) — 시기를 기다리지 않으므로 지금 계절에 맞는 주제만 예고하게 한다.
    promiseRoom
      ? '다음 편 예고를 CTA 에 넣었으면 JSON 의 next 필드에 그 주제를 선언하라 — 예고는 시스템이 약속으로 기록해 **다음 자율 제작(보통 반나절~하루 뒤)에 바로** 블로그 글과 숏폼으로 만든다. 그러니 지금 계절에 바로 할 수 있는 주제만 예고하라. next.topic 에는 대상 수종명을 반드시 넣어라("심는 구덩이 크기" 처럼 대상 없는 주제 금지 — 그대로 다음 글 제목이 된다). window 는 지금 달("N월"). 예고를 안 했으면 next 를 생략하라.'
      : '이번 편은 다음 편 예고 금지 — 예고 대장이 가득 차 지킬 수 없는 약속이 된다. "다음엔/다음 편에" 문장도, 자막의 \'예고\' 딱지도 쓰지 말고 팔로우할 가치 한 구절로 닫아라. next 필드는 생략하라.',
    '내레이션은 TTS 낭독용: 구어체 존댓말, 숫자는 한글로("30%"→"삼십 퍼센트") — 단 월 이름은 고유어로("10월"→"시월", "6월"→"유월") — 고유어 월은 내레이션에만 쓰고 title·titles·description·screenText·hashtags 에는 숫자 월("9월")을 쓴다. 이모지·괄호 지문 금지. 발음이 헷갈려 뜻이 뒤집히는 표현은 풀어 써라 — "새 가지"는 숫자 "세 가지"로 들리니 "새로 난 가지"처럼, 희귀 활용형("아뭅니다" 류)은 평이한 꼴("잘 아물어요")로.',
    // 이해도 감사(2026-08-11 블라인드 실측) 교훈: 문체 지침이 정의·이유 문장을 밀어내면 파생물이 원문 없이
    // 이해 불가가 된다 — 아래 우선순위 선언이 문체 블록 전체를 지배한다.
    '[우선순위] 아래 문체 지침은 표현 방식 지침이다 — 원문에서 추린 방법·이유·위험 근거 문장을 삭제하는 방식으로 이행하지 마라. 문체와 정보가 충돌하면 정보를 남기고 문체를 양보하라.',
    // 파생 문체 확정 규칙(2026-10-12 사장님 확정) — 모과나무 삽목 숏폼 2편이 원문 경고(봄에 당기지 마라)를 '봄에 바로 보여요'로 뒤집었다.
    mediaRulesGuide(),
    // 판매 품종 표기(2026-10-12 사장님 품종표) — 이 주제 수종의 품종을 말할 때 쓸 이름.
    varietyGuide(`${topic} ${keyword ?? ''}`),
    // 결론 의무+낭독 명료성(사용자 확정 2026-08-12): "잎 색 변화" 편 실측 — 보는 법 3갈래를 나열하고
    // 각각이 뭘 뜻하는지 한 번도 안 말해 "무얼 주장하는지 모르겠는" 영상이 됐다.
    guide.conclusion,
    '낭독 명료성: 소리로만 듣고 되돌릴 수 없는 매체다 — 동음이의 전문어는 풀어 말하고("수분 나무"→"꽃가루받이 나무", "눈"→"꽃이 될 눈", "뿌리분"→"뿌리와 흙이 뭉친 덩어리"), 주어·비교 대상을 떨어낸 조각문 금지("밀리미터보다 옆 가지와 비교해요" 식 초압축 — 실측). 내레이션에서 언급하는 개수("다섯 곳")는 실제로 그 수만큼 세어 줘야 한다.',
    '문장 종결을 섞어라: 한 씬의 두 문장을 같은 어미로 끝내지 마라("~ㅂ니다"+"~ㅂ니다" 금지). 대본 전체에서 "-ㅂ니다" 종결은 절반 이하로 하고 "~요/~죠/~거든요/~는데요/~하세요"를 섞어라. 습관적 설명 현재형("치웁니다", "심지 않습니다")은 청자에게 말 거는 꼴("치우세요", "지금은 심지 마세요")로. 아나운서 원고가 아니라 옆에서 알려주는 말로 들려야 한다.',
    '대본 전체 1~2곳에 사람 말의 결을 넣어라 — 짧은 제동("잠깐,"), 정정·양보("아, 포트묘는 예외예요"), 판단의 표명("색보다 끝알부터 봐요" — "나는/저는" 같은 1인칭 주어는 쓰지 마라, 주어 없이도 시점이 전달된다. 사용자 확정 2026-08-12). 겪지 않은 사건·일화를 지어내는 것은 금지(판단·관점만). 정보 밀도를 깎는 잡담도 금지. 판단 문장은 근거·이유 문장을 밀어내고 그 자리를 차지하게 하지 마라 — 근거에 덧붙이는 한 줄이다. "X가 아니라 Y" 재정의 문형은 대본 전체 1회 이하 — 앞 편들이 이미 상투로 만든 틀이다.',
    // 길이 지시는 실제 예산에서 계산한다(2026-10-05) — 종전 "본문 30~70자·총 20~25초·초당 약 6자"는 예산(212자)과 따로 놀아
    // 첫 원고 93편 중 60편이 넘쳤고 압축이 이음 문장부터 지웠다. "씬 수를 줄여서라도"는 항상 5씬(09-09 확정)과 부딪혀 뺐다.
    `[길이 예산 — 대본 전체 ${budgetChars}자 이내, 낭독 약 ${capSec - 5}초(TTS 실측 초당 약 ${SHORTS_TTS_CPS.toFixed(1)}자)] 씬별 상한: 훅 ${budgets.hook}자 · 씬2(전제) ${budgets.premise}자 · 본문 씬 각 ${budgets.body}자 · CTA ${budgets.cta}자. 이 상한 안에서 쓰면 감량 단계가 문장을 지우지 않는다 — 넘친 원고는 기계 감량이 이음 문장부터 지워 씬 사이가 끊긴다(실측). 줄일 것은 씬이 아니라 문장이다(씬 수는 ${maxScenes}개 고정).`,
    `본문 씬 내레이션은 1~2문장 — ${guide.bodyForm} 리듬만 변주하라: 이유를 먼저 두는 씬, 질문으로 끝나는 씬을 최소 1개 섞되(단, 씬당 "무엇을+왜"는 유지 — 리듬을 바꾸라는 것이지 정보를 빼라는 것이 아니다), 질문으로 끝냈으면 그 답을 반드시 바로 다음 씬 첫 문장에서 준다. "~기 때문입니다"는 대본 전체 1회 이하. 훅 씬은 ${budgets.hook}자 이내 한 문장(첫 2초 — 초과분은 코드가 되돌려 보낸다). CTA 씬은 1~2문장.`,
    `압축 안전선: ${capSec}초에 맞추더라도 조사·주어는 남겨라("이 시기 질소 거름 주면" 금지 → "이 시기엔 질소 거름을 주면"). 앞 문장의 주어가 바뀌면 새 주어를 밝혀라. screenText 에 "정의·구분법·요약·정리" 같은 대본용 딱지를 쓰지 마라 — 화면에는 독자에게 하는 말만.`,
    'screenText 는 씬당 1줄 15자 이내 키워드 요약(비워도 됨).',
    // CTA 결론 카드(2026-08-28 사용자 요청) — 결론이 소리로만 지나가면 무음 시청자에게 아무것도 안 남는다.
    // 실측(short_6c8936f791): 내레이션은 "허리 높이면 회양목, 어깨 높이 상록이면 사철나무"인데 화면엔 "자리별 나무 정하기".
    guide.takeaways,
    // 훅 소재(③, 재배 편만) — 이야기형은 원문 자체가 이야기라 안 준다.
    loreHookGuide(hooks),
    // 실측(2026-09-03, 최근 40편): 본문 씬 111개가 kind 없이 배경+자막만으로 흘렀고 chart 0회·quote 1회였다.
    // 종전 지시가 "억지 배정 금지, 애매하면 생략"으로 끝나 작가가 기본값을 '생략'으로 읽었다 —
    // 만들어 둔 연출(StatCountUp·ListReveal·BarChartGrow·QuoteCard)이 놀고 있었다.
    // '언제 붙이는가'를 방아쇠로 명시하고 최소 1개를 요구하되, 날조 방어는 그대로 둔다.
    '씬 kind: 씬1="hook", 마지막 씬="cta". 본문 씬은 아래 방아쇠에 걸리면 해당 kind 를 붙여라 — 무음으로 보는 시청자에게 배경+자막만 흐르는 씬은 아무것도 남기지 않는다.',
    // 방아쇠를 '내레이션이 …하면' 에서 '원문에 …이 있으면' 으로 뒤집는다(2026-09-03).
    // 종전 문구는 작가가 방금 쓴 내레이션을 되돌아보게 했는데, 애초에 수치를 안 쓰면 영영 안 걸린다.
    // 원문을 먼저 훑게 하면 소재가 가진 수치·목록이 대본으로 넘어온다(실측: stat 6·list 5 / 193씬).
    guide.extract,
    '  · 원문에 수치가 있고 그게 그 씬의 요지다 → "stat"(value 숫자·unit 단위·label 15자). 내레이션에서도 그 수치를 말해라 — 화면과 소리가 같은 것을 가리켜야 한다.',
    '  · 원문이 두 가지 이상을 나열·병렬한다 → "list"(items 2~4개, 각 18자). 준비물·순서·조건·품종 전부 해당한다. 내레이션이 다 읊을 필요는 없다 — 화면이 나열을 맡고 내레이션은 기준을 말한다.',
    '  · 흔한 실수와 올바른 방법을 대비한다 → "compare"',
    '  · 원문에 서로 견줄 수 있는 같은 단위의 수치가 둘 이상 있다(예: 봄 90% vs 가을 70%) → "chart"(series 각 {label 8자, value 숫자≥0}, unit, highlight 강조 인덱스). 단위가 다르거나 한쪽이 수치가 아니면 chart 가 아니라 compare 다.',
    '  · 원문 문장을 그대로 인용한다 → "quote"(text 40자, source 출처)',
    guide.kindRule,
    '수치 규칙: stat.value 와 chart.series 의 value 는 원문(블로그 초안)에 있는 수치 또는 대본 구조상 자명한 숫자(단계 수·항목 수)만. 불확실하면 그 kind 를 쓰지 마라. narration 은 수치를 한글로 낭독하되 JSON 값은 아라비아 숫자. chart 씬의 screenText 에는 핵심 수치 비교를 요약하라(렌더 실패 대비).',
    'description(유튜브 설명 — 인스타 캡션에도 그대로 복제된다)은 요약투로 끝내지 마라 — "정리했습니다/담았어요/알아봅니다/알아보세요/살펴봅니다/소개합니다" 금지. "결론 한 줄 + 조건 한 줄" 꼴로 써라(예: "잎이 상한 나무는 9월에 비료를 줘도 소용없습니다. 갈변이 어디서 시작됐는지부터 보세요.").',
    // compare 채우기(2026-09-03 실측): 첫 런에서 두 작가 모두 kind='compare' 만 보내고 bad·good 을 비웠다.
    // 내레이션은 실제로 대비를 말했으니 방아쇠는 먹었고, 빠진 건 '필드를 채우라'는 지시였다 —
    // takeaways 에는 그런 지시문이 따로 있었고 그건 매번 채워졌다. 같은 강도로 적는다.
    'compare 씬에는 bad·good 를 반드시 채워라 — kind 만 보내면 화면에 아무것도 안 나온다(한쪽이라도 비면 통째로 무시된다). bad=하지 말 것·틀린 쪽, good=할 것·맞는 쪽. label 은 대상(14자 이내), note 는 그 이유나 결과(18자 이내). 예: bad={"label":"웃자란 가지","note":"꽃눈이 안 앉아요"} good={"label":"짧은 곁가지","note":"여기 열매가 달려요"}. 내레이션이 말한 대비를 화면에 옮기는 것이지 새 내용을 지어내는 게 아니다 — 원문에 없는 대비는 만들지 마라.',
    // 대표 제목 구조 수렴 차단(2026-09-03 실측) — 최근 38편의 대표 제목이 38/38 "<키워드 구>, <행동>"
    // 이었다. 후보(titles)에는 유형 지시가 있는데 대표 제목에는 구조 지시가 아예 없어서, 모델이
    // 가장 자연스러운 한 꼴로 수렴한 것. 지시문만으로는 새므로 최근 제목을 직접 보여준다.
    recentMainTitles.length
      ? `[최근 대표 제목 — 구조가 겹치면 안 된다]\n${recentMainTitles.map((t) => `· ${t}`).join('\n')}\n대표 제목(title)은 위 제목들과 다른 문장 구조로 써라. 특히 "<키워드 구>, <행동>" 쉼표 두 토막 꼴이 위에 이미 많으면 이번엔 쓰지 마라. 쓸 수 있는 꼴: 쉼표 없이 한 문장으로 잇기("~는 ~부터 봅니다"), 결론 먼저("~은 ~입니다"), 질문("~면 어떻게 될까요"), 조건절("~할 때 ~하세요"), 장면 제시("~앞에서 손이 멈춘다면"). 단, 핵심 키워드를 앞쪽에 두라는 위 규칙이 이 규칙보다 우선한다 — 구조를 바꾸느라 키워드를 빼거나 뒤로 밀지 마라.`
      : '',
    shortsTitleTypeGuide(titleTypes, CONFIG.voiceRotation),
    anchored ? `${SOURCE_ANCHOR_GUIDE}\n각 scene 객체에 "src":"원문 문장 그대로" 키를 넣어라.` : '',
    `JSON 형식: {"title":"대표 제목","titles":[${titlesJson}],"scenes":[{"narration":"...","screenText":"...","kind":"hook|stat|list|quote|chart|compare|cta(선택)","stat":{"value":42,"unit":"%","label":"라벨"},"items":["항목"],"quote":{"text":"인용","source":"출처"},"chart":{"series":[{"label":"봄","value":90},{"label":"가을","value":70}],"unit":"%","highlight":0},"takeaways":[{"when":"허리 높이","then":"회양목"}],"compare":{"bad":{"label":"웃자란 가지","note":"꽃눈이 안 앉아요"},"good":{"label":"짧은 곁가지","note":"여기 열매가 달려요"}}}],"description":"2~3줄","hashtags":["#니치","#범용","#shorts"],"next":{"topic":"다음 편 주제(예고했을 때만)","window":"9월"}}`,
  ].filter(Boolean).join('\n');
  type PlanRaw = { title?: unknown; titles?: unknown[]; scenes?: Array<{ narration?: unknown; screenText?: unknown; kind?: unknown; stat?: unknown; items?: unknown; quote?: unknown; chart?: unknown; compare?: unknown; takeaways?: unknown; src?: unknown }>; description?: unknown; hashtags?: unknown; next?: { topic?: unknown; window?: unknown } };
  // 역할 프롬프트가 없을 때만 쓰이는 폴백(callRoleJSON: role.systemPrompt || fallback).
  const sys = '당신은 유튜브 숏폼 작가입니다. 요청된 JSON 스키마만 출력합니다.';
  // 고유어 월은 내레이션(TTS) 전용 — 화면·검색 필드는 숫자 월로 되돌린다(권고 5, 결정적).
  // 단 키워드 정확 표기가 깨지는 경우는 원문을 유지한다: 키워드 규칙(사용자 확정 자산)이 우선이다.
  const numMonth = (t: string): string => {
    if (!CONFIG.voiceRotation) return t; // 이 태스크(권고 5)의 되돌림 레버 하나로 묶는다 — .env.example 참조
    const out = monthWordOutsideNarration(t);
    return keyword && t.includes(keyword) && !out.includes(keyword) ? t : out;
  };
  const parsePlan = (j: PlanRaw | null): Plan | null => {
    if (!j || !Array.isArray(j.scenes) || !j.scenes.length) return null;
    // 여기서 n 개로 자르지 않는다(2026-10-05) — 앞에서 자르면 넘친 원고의 마지막 CTA 가 떨어진다(호두 인스타 7씬 → 결론 없이 끝남).
    // 씬 수는 호출부가 맞춘다: 첫 원고는 재요청, 그래도 넘치면 fitSceneCount(앞 n-1 + CTA). 12 는 폭주 방지 상한일 뿐이다.
    const rawScenes = j.scenes.slice(0, 12);
    const rawAnchors = anchorsOf(rawScenes);
    const pairs = rawScenes.map((s, i) => ({ scene: {
      narration: cleanNarration(s?.narration),
      screenText: numMonth(stripEmoji(String(s?.screenText ?? '')).trim()).slice(0, 20),
      ...normalizeSceneKind(s), // 불량 페이로드는 {} 강등 — 기본 씬으로 렌더
    }, src: rawAnchors[i] ?? '' })).filter((x) => x.scene.narration);
    const scenes = pairs.map((x) => x.scene);
    const anchors = anchored ? pairs.map((x) => x.src) : undefined;
    if (scenes.length < 3) return null;
    const titles = (Array.isArray(j.titles) ? j.titles : []).map((t) => numMonth(stripEmoji(String(t ?? '')).trim())).filter(Boolean).slice(0, 3);
    const next = j.next && typeof j.next.topic === 'string' && j.next.topic.trim()
      ? { topic: j.next.topic.trim().slice(0, 120), window: typeof j.next.window === 'string' && j.next.window.trim() ? j.next.window.trim() : undefined }
      : undefined;
    // 대표 제목 키워드 보정(결정적) — 종전엔 topic(블로그 SEO 제목, 키워드 강제 산물)을 작가가 채택할 때만
    // 우연히 포함됐다. 키워드 없는 창의 제목이 뽑히면 후보·topic 중 키워드 포함본으로 교체(없으면 원본 유지).
    // includes 검사는 60자 슬라이스 '결과'에 — 자르기 전 검사는 키워드가 경계 밖이면 도로 잘린다(리뷰 지적).
    let title = numMonth(stripEmoji(String(j.title ?? '')).trim()).slice(0, 60) || titles[0] || topic;
    if (keyword && !title.includes(keyword)) {
      const alt = [...titles, topic].map((t) => t.slice(0, 60)).find((t) => t.includes(keyword));
      if (alt) title = alt;
    }
    // 구조 수렴 차단은 키워드 보정 '뒤에' — 키워드 규칙이 우선이라는 계약을 순서로도 못박는다.
    const diversified = diversifyTitle(title, titles, recentMainTitles, keyword);
    if (diversified !== title) {
      console.log('[숏폼]', `대표 제목 구조 교체 — "${title}" → "${diversified}" (최근 편들과 같은 꼴)`);
      title = diversified;
    }
    return {
      title,
      titles: titles.length ? titles : [topic],
      scenes,
      description: numMonth(String(j.description ?? '').trim()).slice(0, 500),
      hashtags: normalizeHashtags((Array.isArray(j.hashtags) ? j.hashtags : []).map((t) => numMonth(String(t ?? '')))),
      ...(next ? { next } : {}),
      ...(anchors ? { anchors } : {}),
    };
  };
  // 예산 3000(CLI 상한 ×3=9000) — 문체 제약 투입(2026-08-11) 후 사고량 증가로 종전 2200(6600)이
  // 즉시 초과됐다(실측: 테스트 런 2건 연속 "exceeded 6600 output token maximum").
  let plan = parsePlan(await callRoleJSON<PlanRaw>(io, writerRole, sys, user, 3000, true));
  if (!plan) {
    // 파싱 불가·미완결 JSON 1회 재시도(카드뉴스와 동일 패턴) — 실측 2026-08-11 "보리수나무묘목" 런이
    // 단발 실패로 통째 죽었다. 재시도는 완결 JSON 강조 + 토큰 여유 상향.
    plan = parsePlan(await callRoleJSON<PlanRaw>(io, writerRole, sys,
      `${user}\n\n반드시 완결된 JSON 하나만 출력하라(설명·마크다운 코드펜스 금지).`, 3400, false));
  }
  if (plan && plan.scenes.length !== n) {
    // 씬 수 불일치 1회 재요청(2026-09-09 "씬을 항상 5개") — 작가가 4씬으로 줄여 오면 정확한 개수를 못박아 다시 받는다.
    io.bus?.emit('log', { message: `기획 씬 수 불일치 — ${plan.scenes.length}개(요청 ${n}개) · 1회 재요청` });
    const again = parsePlan(await callRoleJSON<PlanRaw>(io, writerRole, sys,
      `${user}\n\n씬은 정확히 ${n}개여야 한다(훅·전제·본문·CTA 를 합쳐 ${n}개) — 더도 덜도 말고 ${n}개. 반드시 완결된 JSON 하나만 출력하라.`, 3400, false));
    if (again && again.scenes.length === n) plan = again;
    else if (plan.scenes.length > n) {
      // 넘친 채로 남으면 앞 n-1 + 마지막 씬(CTA)으로 맞춘다(2026-10-05) — 종전엔 앞 n 개로 잘려 CTA 가 떨어졌다.
      io.bus?.emit('log', { message: `기획 씬 수 넘침 유지 — ${plan.scenes.length}개 → 앞 ${n - 1}개 + 마지막 씬(CTA)` });
      plan = { ...plan, scenes: fitSceneCount(plan.scenes, n), ...(plan.anchors ? { anchors: fitSceneCount(plan.anchors, n) } : {}) };
    } else io.bus?.emit('log', { message: `기획 씬 수 불일치 유지 — ${plan.scenes.length}개로 진행` });
  }
  if (!plan) return null;
  // 씬별 출처(2026-10-05) — 아래 단계마다 기록해 최종 원문 대조가 '바뀐 씬'을 통과 판본으로 되돌릴 수 있게 한다.
  let trace = traceStart(plan.scenes);
  const record = (stage: string, llm: boolean): void => { trace = traceRecord(trace, plan!.scenes, stage, { llm }); };
  // 단독 이해 검산 — 원문을 안 본 시청자 관점 텍스트 검사 후 1회 수정 라운드(fail-open, 실측 2026-07-29 결함 대응).
  try {
    // 원문 핵심 축 요약(제목+소제목) — 검산의 '원문 정합' 항목 입력. 파생이 아니면 undefined(검사 생략).
    const sourceCore = sourceCoreOf(topic, sourceBody);
    // 원문 정합(스펙 §2-4) — 파생물이 원문에 없는 사실을 새로 지어내거나 원문 결론을 뒤집는지 대조(fail-open).
    // 결론 카드를 함께 싣는다(2026-08-28) — 사용자 확정 분업에서 답은 화면에만 있다. 내레이션만 보여 주면
    // 정합 판정이 '답이 없는 대본'을 보게 되고, 화면의 답은 아무 검사도 받지 않는다.
    // 원문 근거 짚기(2026-10-15) — 작가가 짚은 원문 문장(원문에 실제로 있는 것만)을 씬 옆에 싣는다: 판정이 씬을 그 문장과 대조한다.
    const sceneTexts = (p: Plan): string[] => p.scenes.map((s, i) => withAnchor(`${s.narration}${s.screenText ? ` (자막: ${s.screenText})` : ''}`
      + (s.takeaways?.length ? ` (결론: ${s.takeaways.map((t) => `${t.when} → ${t.then}`).join(', ')})` : ''), p.anchors?.[i], sourceForGates ?? ''));
    if (plan.anchors && sourceForGates) {
      const ai = anchorIssues(plan.anchors, plan.scenes.length, sourceForGates);
      const am = `원문 근거 짚기 — 씬 ${plan.scenes.length}개 중 근거 문제 ${ai.length}건${ai.length ? `: ${ai.slice(0, 3).join(' / ')}` : ''}`;
      console.log('[숏폼]', am); io.bus?.emit('log', { message: am });
    }
    // FACT_GATE=off 면 LLM 정합 1차·잔존 판정을 통째로 건너뛴다(킬스위치가 실제로 꺼져야 한다 — 2026-08-26 최종 리뷰 F1):
    // parity 가 빈 배열이면 정합 지적이 수정 라운드 입력에서도 빠지고, 아래 소스별 캡의 'parity ≤2' 몫이
    // 비어 상한이 13 이 된다(다른 소스는 그대로).
    // 단 2026-08-27(권고 1) 이후로 plan.factGate 자체는 FACT_GATE=off 여도 붙을 수 있다 — 아래 잔존 블록이
    // (parity.length || timingResidual.length) 라, **자기 킬스위치(TIMING_PARITY)** 로 사는 시기·수치만
    // 잔존해도 열린다. 그때 status 는 parityToInfo([]) 의 'pass' 라 보류(hold)가 생기지 않는다(표시 전용).
    // 둘 다 끄려면 FACT_GATE=off + TIMING_PARITY=off.
    // 판정 실패(null)는 출처 기록에 '미확인'으로 남는다 — 최종 원문 대조가 다시 본다. 수정 라운드 입력에선 종전대로 빈 배열.
    const parityRaw = CONFIG.factGate && sourceForGates ? await parityIssuesChecked('유튜브 숏폼 대본(씬 내레이션)', sceneTexts(plan), sourceForGates, io.signal) : [];
    const parity = parityRaw ?? [];
    trace = traceMarkParity(trace, parityRaw);
    // 단독 이해 검산(LLM, 최대 5건) — 소스별 예약 캡의 몫 계산을 위해 먼저 변수로 받는다.
    // 결론 카드를 함께 넘긴다(2026-08-28) — 이 검사의 항목 4가 '결론 부재'다. 사용자 확정 분업에서
    // 답은 화면에만 있으므로, 내레이션만 보여 주면 잘 만든 CTA 가 매번 '결론 없음'으로 걸린다(과차단).
    // 판정자가 화면에 뜬 답까지 보고 나서 결론 유무를 판단하게 한다.
    const standalone = await standaloneIssues('유튜브 숏폼 대본(씬 내레이션)',
      plan.scenes.map((s) => `${s.narration}${s.takeaways?.length ? ` [화면 결론: ${s.takeaways.map((t) => `${t.when} → ${t.then}`).join(', ')}]` : ''}`),
      topic, keyword, io.signal, sourceCore);
    // 문체 결정적 린트(2026-08-11) — 프롬프트 지시만으로는 샌다는 실측("새 가지" 위반) 대응, 같은 수정 라운드에 얹는다.
    // 소스별 예약(2026-08-26 리뷰 수선) — 결정적 린트(문체·훅)를 앞에 둬 프롬프트-only 실측 누출 방지를
    // 우선 보장하고, LLM 판정(단독 이해·정합)은 각 소스당 상한을 둬 한쪽이 다른 쪽을 밀어내지 못하게 한다.
    // 시기·수치 원문 대조(2026-08-27 권고 1, 결정적) — 활엽수 실사고: 블로그가 "근거 확실치 않다"고 한 시기를
    // 파생 쇼츠가 내레이션·자막·오버레이 세 군데에서 단정했다. TIMING_PARITY=off 면 함수가 빈 배열을 낸다.
    const timingFor = (p: Plan): string[] => (sourceForGates ? timingParityIssues(sourceForGates, timingFields(p)).map(formatTimingIssue) : []);
    // 원문 미검증 주장 승계(2026-08-28 처방 C, 결정적) — 실사고: 블로그 게이트가 hold 인데 파생 숏폼은 pass 였고,
    // 원문에서 '근거 미확인'으로 분류된 손질 시기가 그대로 화면 목록에 떴다. 기존 두 축(정합·시기수치)은
    // "원문에 충실한가"만 봐서 통과시킨다 — 이 축이 "원문이 애초에 믿을 만한가"를 본다(detProbs 안에서 돈다).
    // 소스별 캡 합 최대 21(narrationStyleIssues ≤5 + hookKeywordLeadIssues ≤1 + hookLengthIssues ≤1 + standalone ≤4 + parity ≤2 + 시기·수치 ≤3 + 승계 ≤2 + 설명 요약투 ≤1 + 자막 딱지 ≤2) —
    // 이미 소스별로 상한을 뒀으므로 최종 캡을 또 씌우면 뒤 소스(정합)만 밀려나는 desync 가 재발한다. 최종 캡 없음.
    // 결정적 검사 묶음(2026-10-05 함수로 묶음) — 부분 수정 채택 판정이 수정 전·후에 같은 묶음을 다시 돌려 비교한다.
    const detProbs = (p: Plan): string[] => {
      const narrs = p.scenes.map((s) => s.narration);
      return [
        ...narrationStyleIssues(narrs),
        // 훅 키워드 낭독 결정적 린트(2026-08-20) — 프롬프트 지시 단독은 샌다는 실측 전례(문체 린트와 동일 사상).
        ...hookKeywordLeadIssues(narrs, keyword),
        // 훅 20자 한 문장 결정적 린트(§2 2026-09-18) — 문형·글자수 지시만으로는 새므로(같은 사상).
        ...hookLengthIssues(narrs).slice(0, 1),
        // 마무리 씬(2026-10-02, 결정적) — 대장 만석 예고·next 없는 예고·cta 아닌 마지막 씬. 위 캡 합 주석의 총계 밖 ≤2.
        ...closingSceneIssues(p.scenes, { promiseRoom, hasNext: !!p.next }).slice(0, 2),
        // 훅 화면 어긋남(2026-10-05) — 단정형 훅을 지시했는데도 화면 지목 훅이 나오면 되돌려 보낸다. 총계 밖 ≤1.
        // 훅 글 ↔ 훅 화면(2026-10-15) — 작가가 화면에 있는 잎을 "다 졌다"고 쓴 실측. 총계 밖 ≤1.
        ...(!extra.hookConflict ? hookFootageIssues(p.scenes[0], extra.hookFootage, p.scenes.slice(1)) : []),
        ...(extra.hookConflict && FOOTAGE_DEICTIC_RE.test(narrs[0] ?? '') ? [`항목1: 훅이 실촬영 화면을 가리킨다 — 그 화면은 이 편 주제의 장면이 아니다(${extra.hookConflict}). 화면 묘사 없이 단정 선언·숫자형으로 바꿔라`] : []),
        // 검색 키워드·답 앞세우기(2026-10-05) — 유튜브는 씬1~2, 인스타는 내레이션 어딘가. 총계 밖 ≤1.
        ...keywordEarlyIssues(p.scenes, keyword, extra.platform),
        ...timingFor(p).slice(0, 3),
        // 승계 지적(처방 C) — 소스별 예약 캡 원칙 그대로 몫을 준다(≤2). 위 캡 합 주석의 총계에 포함.
        ...(sourceFlagged.length ? inheritedClaims(sourceFlagged, timingFields(p), 5, sourceBody) : []).map(formatInherited).slice(0, 2),
        // 설명 요약투(2026-08-27 권고 2, 결정적) — description 은 유튜브 설명이자 인스타 캡션이다.
        // 새 콜을 만들지 않고 기존 수정 라운드에 얹는다(= 플랜이 말하는 "1회 재생성").
        // META_SUMMARY_LINT 게이트(Fix wave 소견 4) — 블로그 meta 재시도와 같은 레버로 함께 꺼진다.
        ...descriptionLintIssues(p.description),
        // 자막 대본 딱지(2026-08-27 권고 5, 결정적) — screenText 가 "정의/구분법/요약" 같은 목차 라벨로 끝나면
        // 화면이 강의 슬라이드처럼 읽힌다. 프롬프트 지시(압축 안전선)의 2차 방어, 비차단.
        // VOICE_ROTATION 게이트 — 이 태스크가 넣은 동작은 스위치 하나로 전부 되돌아간다.
        ...(CONFIG.voiceRotation ? screenTextLabelIssues(p.scenes.map((s) => s.screenText ?? '')).slice(0, 2) : []),
      ];
    };
    const probs = [...detProbs(plan), ...standalone.slice(0, 4), ...parity.slice(0, 2)];
    let planChanged = false;
    if (probs.length) {
      const m = `단독 이해·문체 검산 — ${probs.length}건 → 수정 라운드 (${probs[0]?.slice(0, 50)})`;
      console.log(`[숏폼] ${m}`); io.bus?.emit('log', { message: m });
      const say1 = (t: string): void => { console.log(`[숏폼] ${t}`); io.bus?.emit('log', { message: t }); };
      // 통째 재집필(종전 경로) — SHORTS_PARTIAL_FIX=off 이거나 부분 수정이 구조 문제를 못 고쳤을 때만.
      const fullRewrite = async (): Promise<Plan | null> => {
        const raw = parsePlan(await callRoleJSON<PlanRaw>(io, writerRole, sys,
          `${user}\n\n[단독 이해·문체 검산 실패 — 아래 문제를 고쳐 같은 JSON 스키마로 완결 출력하라(설명 금지)]\n${probs.map((p) => `- ${p}`).join('\n')}`, 3400, false));
        if (!raw) return null;
        // 씬 수가 어긋나도 뒤를 자르지 않는다 — 앞 n-1 + 마지막 씬(CTA)(2026-10-05, fitSceneCount 주석).
        const fixed = raw.scenes.length > maxScenes ? { ...raw, scenes: fitSceneCount(raw.scenes, maxScenes) } : raw;
        // 수정본 파싱 실패 시 원본 유지. 수정 라운드가 대본만 고치고 메타(제목 후보·설명·해시태그)를
        // 빠뜨려도 원본 것을 승계(무손실 병합 — parsePlan 의 [topic] 폴백 제목이 원본을 덮지 않게).
        return {
          ...fixed,
          titles: fixed.titles.length > 1 ? fixed.titles : plan!.titles,
          description: fixed.description || plan!.description,
          hashtags: fixed.hashtags.length ? fixed.hashtags : plan!.hashtags,
          // 예고 승계(2026-10-02) — 수정본이 next 를 빠뜨려도 CTA 가 여전히 예고하면 원본 선언을 잇는다. 종전엔
          // 이 병합이 next 를 떨어뜨려, 영상은 예고하는데 대장엔 안 올라가는 경로가 하나 더 있었다.
          ...(!fixed.next && plan!.next && promiseRoom && announcesNextEpisode(fixed.scenes[fixed.scenes.length - 1]) ? { next: plan!.next } : {}),
        };
      };
      if (!CONFIG.shortsPartialFix) {
        // 예외는 '수정 없음'으로(2026-10-05 리뷰) — 종전엔 바깥 try 로 튀어 오버레이 제거·factGate 를 건너뛰었다.
        const fixed = await fullRewrite().catch(() => null);
        if (fixed) {
          const lost = lostCards(plan, fixed);
          if (lost.length) say1(`통째 재집필 — 화면 카드 사라짐 씬 ${lost.join(',')}`);
          plan = fixed; planChanged = true; record('통째 재집필', true);
        }
      } else {
        // 부분 수정(2026-10-05, 사장님 승인) — 현 대본을 주고 문제 씬만 받는다. 실측: 통째 재집필이 94%였고 훅 85편 중 83편이
        // 바뀌었으며 수정 라운드가 건너뜀 11건을 새로 만들었다. 채택 판정은 수정 전·후 같은 검사 묶음(결정적 린트 + 단독 이해
        // 1회 재검산)으로 — 문제가 늘었거나 새 건너뜀이 생기면 첫 원고를 그대로 둔다. 정합(원문 대조)은 비교에서 뺀다
        // (수정 뒤 재판정은 아래 잔존 블록이 planChanged 로 하고, 첫 원고 지적이 없어 그 블록이 안 돌아도 runShortsJob 끝의 최종 원문 대조가 본다).
        const before = [...detProbs(plan), ...standalone.slice(0, 4)];
        const recheck = async (p: Plan): Promise<string[]> => [...detProbs(p), ...(await standaloneIssues('유튜브 숏폼 대본(씬 내레이션)',
          p.scenes.map((s) => `${s.narration}${s.takeaways?.length ? ` [화면 결론: ${s.takeaways.map((t) => `${t.when} → ${t.then}`).join(', ')}]` : ''}`),
          topic, keyword, io.signal, sourceCore)).slice(0, 4)];
        const hookEditable = problemsTargetHook(probs);
        const j = await callRoleJSON<PartialFix>(io, writerRole, sys, partialFixPrompt({
          scenes: plan.scenes, problems: probs, budgets, stage: 'plan', hookEditable, description: plan.description,
          // 원문 창은 정합 판정과 같은 길이(2026-10-05 리뷰) — 수정이 못 본 원문 뒤쪽 사실을 판정이 '없는 사실'로 잡지 않게.
          ...(sourceForWriter ? { sourceExcerpt: sourceForWriter.slice(0, PARITY_SOURCE_CHARS) } : {}),
          ...(sourceFlagged.length ? { flagged: sourceFlagged } : {}),
          ...(hookRule ? { hookRule } : {}), ...(keyword ? { keyword } : {}),
        }), 1600, false).catch(() => null);
        const merged = mergePartialFix(plan, j, {
          hookEditable, budgets, fixScreen: numMonth,
          ...(keyword ? { keyword } : {}), ...(extra.hookConflict ? { hookReject: FOOTAGE_DEICTIC_RE } : {}),
        });
        say1(`부분 수정 — 씬 ${merged.changed.join(',') || '없음'}${merged.descriptionChanged ? ' · 설명' : ''}${merged.droppedCards.length ? ` · 화면 카드 해제 ${merged.droppedCards.join(',')}` : ''}${merged.rejected.length ? ` · 거절 ${merged.rejected.slice(0, 3).join(' / ')}` : ''}`);
        const best = await chooseFixedPlan({
          base: plan, merged, before, recheck, fullRewrite, hookConflict: !!extra.hookConflict, say: say1,
        });
        if (best) {
          const lost = lostCards(plan, best.plan);
          if (lost.length && best.stage !== '부분 수정') say1(`${best.stage} — 화면 카드 사라짐 씬 ${lost.join(',')}`);
          plan = best.plan; planChanged = true; record(best.stage, true);
        }
      }
    }
    // dataviz 오버레이 결정적 제거(권고 1) — 반드시 수정 라운드 '뒤'에: 앞에서 떼면 작가가 같은 값을
    // 그대로 다시 실어 보내고(수정본은 parsePlan→normalizeSceneKind 를 새로 통과한다) 제거가 무효가 된다.
    if (sourceForGates) {
      const st = stripUnsourcedStatOverlays(plan.scenes, sourceForGates);
      if (st.removed.length) {
        plan = { ...plan, scenes: st.scenes };
        record('오버레이 제거', false);
        for (const v of st.removed) {
          const m3 = `오버레이 수치 원문 부재 → 제거 — "${v}"`;
          console.log(`[숏폼] ${m3}`); io.bus?.emit('log', { message: m3 });
        }
      }
    }
    // 시기·수치 잔존(권고 1) — 오버레이 제거까지 끝난 최종 대본 기준. LLM 재호출 없음(결정적).
    const timingResidual = sourceForGates ? timingParityIssues(sourceForGates, timingFields(plan)).map(formatTimingIssue) : [];
    // 승계 잔존(처방 C) — 수정 라운드 뒤 재계산. 원문 게이트가 hold 로 사람을 세운 사안을 파생물에서도
    // 보이게 하는 것이 이 축의 목적이라, 잔존이 있으면 검토 알림까지 반드시 나가야 한다.
    const inheritedResidual = (sourceFlagged.length ? inheritedClaims(sourceFlagged, timingFields(plan), 5, sourceBody) : []).map(formatInherited);
    // 설명 요약투 잔존(권고 2) — 수정 라운드 뒤 최종 description 기준. 로그만(발행 차단 없음).
    if (metaSummaryIssues(plan.description).length) console.log(`[메타] 요약투 잔존 — "${plan.description.slice(0, 60)}"`);
    // 원문 정합 잔존(스펙 §2-4) — 정합 문제로 수정 라운드가 돌았을 때만 1회 재판정(비용). 표시 전용.
    // 수정본 파싱 실패(planChanged=false) 는 대본이 1차 판정 때와 바이트 동일 — LLM 재호출 없이 1차 parity 를 그대로 잔존으로 재사용한다.
    // 시기·수치만 잔존해도 factGate 를 붙인다(그래야 텔레그램 줄이 나간다) — 단 status 는 정합 판정이 정한다:
    // 결정적 비차단 린트가 보류(hold)를 만들어 자동 임시저장까지 막아서는 안 된다.
    if ((parity.length || timingResidual.length || inheritedResidual.length) && sourceForGates) {
      // 재판정 결과는 출처 기록에도 적는다 — 최종 원문 대조가 이 판본을 '통과'로 되돌릴 자리로 쓴다.
      const recheckParity = parity.length && planChanged ? await parityIssuesChecked('유튜브 숏폼 대본(씬 내레이션)', sceneTexts(plan), sourceForGates, io.signal) : null;
      if (recheckParity) trace = traceMarkParity(trace, recheckParity);
      const base = parity.length
        ? (planChanged ? parityToInfo(recheckParity ?? []) : parityToInfo(parity))
        : parityToInfo([]);
      // timing 은 자르지 않고 통째로 싣는다 — 텔레그램 머리줄 N 은 잔존 '건수'라, 여기서 5건으로 자르면
      // 8건이 "5건"으로 나간다(Fix round 1). 예시 줄 캡(2줄)은 factGateLines 가 표시 시점에 씌운다.
      // 승계 잔존을 timing 칸에 합류시킨다 — FactGateInfo 스키마를 늘리지 않고 기존 표시 경로(factGateLines)를
      // 그대로 탄다. 두 축 다 '결정적·비차단·표시 전용'이라 성격이 같다(status 는 정합 판정이 정한다).
      const displayResidual = [...timingResidual, ...inheritedResidual];
      const factGate = displayResidual.length ? { ...base, timing: displayResidual } : base;
      plan = { ...plan, factGate };
      if (factGate.status === 'hold') { const m2 = `원문 정합 잔존 ${factGate.unsupported.length}건 — 검토 메시지에 표시`; console.log(`[숏폼] ${m2}`); io.bus?.emit('log', { message: m2 }); }
      if (timingResidual.length) { const m4 = `시기·수치 원문 불일치 잔존 ${timingResidual.length}건 — 검토 메시지에 표시`; console.log(`[숏폼] ${m4}`); io.bus?.emit('log', { message: m4 }); }
      if (inheritedResidual.length) { const m5 = `원문 미검증 주장 승계 잔존 ${inheritedResidual.length}건 — 검토 메시지에 표시`; console.log(`[숏폼] ${m5}`); io.bus?.emit('log', { message: m5 }); }
    }
  } catch { /* 무해 */ }
  // 다음 편 예고 정리(2026-10-02, 결정적) — 수정 라운드 뒤 최종 대본 기준. 낭독 직전에 finishShortsRun 이 대장을 다시 본다.
  {
    const st = settleNextEpisode(plan, promiseRoom);
    if (st.note) { plan = st.plan; record('예고 정리', false); const m = `예고 정리 — ${st.note}`; console.log(`[숏폼] ${m}`); io.bus?.emit('log', { message: m }); }
  }
  // quote 출처 가드 — factGate 등 위에서 채운 필드는 pruneQuoteSources 가 그대로 스프레드 보존한다(fail-open).
  try {
    const pq = pruneQuoteSources(plan, sourceForGates);
    if (pq.pruned) {
      const m = `quote 출처 ${pq.pruned}건 제거 — 원문에 없는 출처 라벨`;
      console.log(`[숏폼] ${m}`); io.bus?.emit('log', { message: m });
      plan = pq.plan; record('출처 정리', false);
    }
  } catch { /* fail-open */ }
  if (extra.trace) extra.trace.value = trace;
  return plan;
}

/** 지금 달(KST, 1~12) — 디렉터 프롬프트의 계절 기준. 서버 TZ 와 무관하게 서울 기준. */
function kstMonthNow(now: number = Date.now()): number {
  return new Date(now + 9 * 3600 * 1000).getUTCMonth() + 1;
}

async function designScenes(io: JobIO, topic: string, plan: Plan, keyword?: string, sourceBody?: string): Promise<{ preset: string; style: string; prompts: string[]; musts: Array<SceneMust | undefined>; subject?: string; subjectLatin?: string; species?: import('../content/species').Species; hero?: string; heroScenes?: number[] }> {
  const sceneGenreGuide = genreSceneGuide(shortsGenreOf(topic, CONFIG.shortsLore));
  // 훅(0번) 이미지 지침(2026-09-18, SHORTS_HOOK_FOOTAGE) — 실촬영이 훅을 못 채운 편은 이 프롬프트로
  // 생성한 이미지가 그대로 훅 화면이 된다. 넓은 풍경·정면 전경은 스와이프를 안 멈춘다(실측).
  const hookImageGuide = CONFIG.shortsHookFootage
    ? '씬1(훅)은 첫 2초에 스와이프를 멈추게 하는 화면 — 대비가 큰 클로즈업(잎 한 장, 열매 단면, 상처 난 줄기, 갓 자른 단면). 연장(가위·칼)은 그리지 않는다(2026-10-12 — 예시의 "가위 앞 손"이 연장 금지와 부딪혔다). 넓은 풍경·정면 나무 전경·글자 금지. 이야기형은 위 지침이 우선.'
    : '';
  const user = [
    `[주제] ${topic}`,
    keyword ? `[핵심 대상] ${keyword}` : '',
    '[씬 — 내레이션 요지]',
    ...plan.scenes.map((s, i) => `${i + 1}. ${s.narration.slice(0, 60)}${s.screenText ? ` (자막: ${s.screenText})` : ''}`),
    '',
    `각 씬의 세로(9:16) 배경 이미지 프롬프트를 설계하라. scenes 는 정확히 ${plan.scenes.length}개.`,
    '이미지 안 글자 금지.',
    // 원문 묘사 반영(2026-10-12 사장님 지시) — 디렉터가 원문을 못 봐서 모과나무 삽목 편의 삽수가 잎 달린 채·끝이 뭉툭하게,
    // 확인 장면이 다 자란 나무로 그려졌다(원문: 잎 진 맨가지, 아래 끝을 비스듬히, 깊은 화분, 표식).
    ...mustDesignerGuide(sourceBody, '씬'),
    // 계절·행동 일치(2026-10-02 숏폼 10편 감사) — 디렉터는 지금이 몇 월인지 몰랐다. 실측: 시월 꽃눈 편 두 개가 봄 개화·꽃봉오리
    // 그림으로 나갔고, "잎이 진 뒤에 자르세요" 씬에 잎 무성한 가지를 가위로 자르는 장면이 나갔다(메시지와 정반대).
    `계절: 지금은 ${kstMonthNow()}월이다. 모든 씬의 잎·꽃·열매 상태는 지금 계절로 그려라. 그 씬 내레이션이 다른 계절의 모습을 직접 말할 때만(예: "봄에 꽃이 피면") 그 계절로 그린다 — 지나간 일을 떠올리는 말("올여름 꽃 핀 자리")은 지금 계절의 흔적(시든 꽃자리·빈 꽃대)으로 그려라.`,
    '행동 일치: 내레이션이 미루라거나 하지 말라고 한 행동(예: 잎이 있을 때 자르기)을 화면이 진행 중인 것으로 그리지 마라 — 그 씬은 기다리는 모습이나 올바른 시점의 모습으로 그린다.',
    // 수종 오식별(2026-09-03 실사고) — "측백나무 생울타리" 편에서 4씬 중 1씬만 수종명을 적었고
    // 나머지는 "생울타리", "작은 나무 아이콘들"이라고만 써서, 이미지 모델이 활엽수를 그렸다.
    // 측백나무는 침엽수다. 원예 채널에서 수종이 틀린 화면은 신뢰를 직접 깎는다.
    // 수종 정확도(2026-09-04 2차) — 1차(수종 앵커)는 한글 이름 + 산문 묘사였는데, 그 묘사가
    // LLM 기억에서 나오다 보니 틀렸다. 실측: 남천을 "손바닥 모양으로 갈라진 잎"이라고 적었는데
    // 남천은 깃꼴겹잎이다. 학명을 함께 받는 이유가 여기 있다 — 이미지 모델은 식물 데이터셋을
    // 학명으로 학습해서, 한글 이름이나 산문 묘사보다 학명 한 줄이 훨씬 정확하게 꽂힌다.
    '수종 고정(가장 중요): 이 영상의 대상 식물을 두 칸으로 적어라. subject_latin 에는 학명(속명+종소명, 예: "Nandina domestica" "Platycladus orientalis"), subject 에는 한글 이름과 그림으로 구별되는 특징을 한 줄로(잎 모양·잎차례·수형·계절 색).',
    '특징은 정확해야 한다 — 겹잎인지 홑잎인지, 잎차례가 어떤지, 침엽인지 활엽인지를 틀리지 마라. 원문(블로그 초안)에 그 식물의 생김새 묘사가 있으면 그것을 우선하고, 확신이 없으면 특징을 짧게만 쓰되 학명은 반드시 채워라 — 학명 하나가 애매한 산문보다 정확하다.',
    '학명·이름을 모르는 소재(도구·흙·일반 정원 풍경)면 두 칸을 모두 비워라. 지어내지 마라.',
    '그리고 모든 씬 묘사(prompt)에 그 식물이 무엇인지 매번 명시하라 — "나무", "생울타리", "묘목" 처럼 뭉뚱그리지 마라. 화면에 식물이 안 나오는 씬(도구·흙·줄자만)은 예외다.',
    // 이야기형 편(2026-09-18) — 재배 시연이 아니라 그 나무가 선 자리·풍경. 하우투는 빈 문자열(종전 그대로).
    ...(sceneGenreGuide ? [sceneGenreGuide] : []),
    ...(hookImageGuide ? [hookImageGuide] : []),
    // 주인공 나무(2026-10-15 사장님 선택) — 호두나무 활착 편: 씬2 는 1년생 묘목, 씬3~5 는 아름드리 성목으로 그려졌다. 씬마다 지시가
    // 따로라 '이 영상이 따라가는 한 그루'가 없었다. 한 그루를 따라가는 편이면 그 나무를 한 줄로 정하고 나오는 씬을 표시하게 한다.
    ...(CONFIG.shortsHeroTree ? ['주인공 나무: 이 영상이 한 그루를 따라가면(활착 확인·가지치기 전후·한 나무의 상태 진단 등) hero 에 그 나무를 한 줄로 적어라 — 나이(몇 년생)·키·줄기 굵기·지금 상태(잎·가지)를 원문과 주제에 맞게(예: "올봄 심은 1년생 묘목, 키 약 1m, 줄기는 엄지 굵기, 잎이 지는 중"). 그 나무가 나오는 씬은 hero:true 로 표시하고, 그 씬의 prompt 에도 같은 나무로 묘사하라(크기·굵기를 바꾸지 마라). 여러 나무를 비교하거나 따라가는 한 그루가 없으면 hero 는 빈 문자열.'] : []),
    'style_preset 은 주제·내용·톤에 어울리게 선택하라 — photorealistic 을 기본값처럼 고르지 말 것. photorealistic=실물 시연·하우투·생활, manhwa=스토리·유머·과장, watercolor=감성·계절·에세이, ink_wash=차분한 전통·사색적 주제, flat_design=정보·정책·경제·비교·수치, retro_poster=이벤트·프로모션·복고.',
    `JSON 형식: {"style_preset":"photorealistic|manhwa|watercolor|ink_wash|flat_design|retro_poster","style":"모든 씬 공통 스타일 문구(팔레트·질감·조명)","subject_latin":"학명(모르면 빈 문자열)","subject":"한글 이름 — 구별되는 겉모습 한 줄(없으면 빈 문자열)",${CONFIG.shortsHeroTree ? '"hero":"주인공 나무 한 줄(없으면 빈 문자열)",' : ''}"scenes":[{"prompt":"장면 묘사(한국어 150자 이내)"${CONFIG.shortsHeroTree ? ',"hero":true' : ''}${sourceBody ? ',"must_show":["화면에 꼭 보여야 할 사실"],"must_not":["나오면 안 되는 것"]' : ''}}}]}`,
  ].join('\n');
  const j = await callRoleJSON<{ style_preset?: unknown; style?: unknown; subject?: unknown; subject_latin?: unknown; hero?: unknown; scenes?: Array<{ prompt?: unknown; hero?: unknown; must_show?: unknown; must_not?: unknown }> }>(
    io, 'shorts_director', '당신은 숏폼 영상 디렉터입니다. 요청된 JSON 스키마만 출력합니다.', user, sourceBody ? 2600 : 1800, true,
  );
  const rawPreset = String(j?.style_preset ?? '').trim();
  const preset = PRESETS.has(rawPreset) ? rawPreset : (PRESET_ALIAS[rawPreset] ?? 'photorealistic');
  const style = String(j?.style ?? '').trim().slice(0, 200) || '밝고 깔끔한 한국 생활 사진풍, 부드러운 자연광';
  const prompts = plan.scenes.map((s, i) => {
    const p = String(j?.scenes?.[i]?.prompt ?? '').trim().slice(0, 200);
    return p || `${topic} 를 상징하는 한국 생활 장면, ${s.narration.slice(0, 30)} 분위기`;
  });
  const musts = plan.scenes.map((_, i) => (sourceBody ? parseSceneMust(j?.scenes?.[i]) : undefined));
  // 수종 사전이 이긴다(2026-09-04) — LLM 기억보다 표가 정확하다. 표에 없으면 LLM 값을 쓴다.
  const known = findSpecies(`${keyword ?? ''} ${topic}`);
  const hero = CONFIG.shortsHeroTree ? String(j?.hero ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const heroScenes = hero ? plan.scenes.map((_, i) => i).filter((i) => j?.scenes?.[i]?.hero === true) : [];
  if (hero) console.log('[숏폼]', `주인공 나무 — ${hero} · 씬 ${heroScenes.map((i) => i + 1).join(',') || '(표시 없음)'}`);
  const subject = known ? speciesAnchor(known, { young: !!hero && isYoungHero(hero) }) : String(j?.subject ?? '').trim().slice(0, 120);
  const subjectLatin = known ? known.latin : normalizeLatinName(String(j?.subject_latin ?? ''));
  if (known) {
    console.log('[숏폼]', `수종 사전 적중 — ${known.name} (${known.latin})${known.verified ? '' : ' · 형태 묘사 미검토'}`);
  } else if (subjectLatin) {
    // 표에 없던 종 — 한 번 적어 두면 다음 편부터 같은 값을 쓴다(편마다 잎 모양이 달라지는 것 방지).
    const nm = speciesNameFrom(subject, keyword);
    if (nm && appendSpecies({ name: nm, latin: subjectLatin, leaf: subject })) {
      console.log('[숏폼]', `수종 사전 추가 — ${nm} (${subjectLatin}) · 검토 필요(auto)`);
    }
  }
  if (subject || subjectLatin) {
    console.log('[숏폼]', `수종 앵커 — ${subjectLatin ? `${subjectLatin} · ` : '학명 없음 · '}${subject || '(특징 없음)'}`);
    if (!subjectLatin) console.log('[숏폼]', '학명 미기재 — 한글 이름만으로는 이미지 모델이 종을 자주 틀린다');
  } else if (keyword) {
    console.log('[숏폼]', `수종 앵커 없음 — 디렉터가 '${keyword}' 겉모습을 못 적었다(화면 수종이 틀릴 수 있음)`);
  }
  return { preset, style, prompts, musts, ...(subject ? { subject } : {}), ...(subjectLatin ? { subjectLatin } : {}), ...(known ? { species: known } : {}),
    ...(hero && heroScenes.length ? { hero, heroScenes } : {}) };
}


/**
 * 학명 정규화(순수) — 속명+종소명 두 낱말만 통과시킨다.
 *
 * 이미지 모델은 식물 데이터셋을 학명으로 학습해서, 한글 이름이나 산문 묘사보다 학명 한 줄이
 * 훨씬 정확하게 꽂힌다. 다만 LLM 이 "Nandina domestica (남천)" 처럼 군더더기를 붙이거나
 * "나무" 같은 엉뚱한 값을 넣기도 하므로, 학명 꼴이 아니면 버린다 — 틀린 학명은 없느니만 못하다.
 *
 * 통과 조건: 첫 낱말은 대문자로 시작(속명), 둘째 낱말은 소문자(종소명), 둘 다 알파벳.
 * 품종명(세 번째 낱말)은 잘라낸다 — 이미지 모델에 도움이 안 되고 오히려 노이즈다.
 */
export { normalizeLatinName } from '../content/species'; // 수종 데이터 규칙이라 사전 옆으로 옮겼다(2026-09-06)

/**
 * 숏폼 씬 이미지(gpt-image-2, 세로 9:16) 프롬프트 조립 — shorts-gen 의 스타일 일관성(전 씬 공통 앵커
 * 반복) + 시네마토그래피(구도·조명·씬 변주). 자막·내레이션은 렌더러가 얹으므로
 * 이미지엔 글자를 넣지 않는다(오타 원천 차단). 순수 함수(생성 없이 프롬프트 검증 가능).
 */
// ── 촬영 지시 변주(2026-09-03) ────────────────────────────────────────────────
// 종전엔 모든 편·모든 씬에 "얕은 심도와 부드러운 조명"이 그대로 붙었다. 하필 그 둘은 생성 이미지의
// 기본값이자 'AI가 만든 사진' 하면 떠오르는 바로 그 문법이다 — 176편이 같은 지시를 받았으니
// 같은 얼굴로 나오는 게 당연했다.
//
// 나누는 기준이 중요하다. 조명·심도는 '전 씬 공통 팔레트·질감·조명 유지'라는 기존 의도가 있으므로
// 편 단위로 고정하고(편 간에만 갈림), 앵글·거리는 씬 단위로 갈라 한 편 안에서도 화면이 바뀌게 한다.
const LIGHTING: readonly string[] = [
  '부드러운 자연광, 그림자가 옅다',
  '측면에서 들어오는 또렷한 빛, 그림자 경계가 분명하다',
  '흐린 날의 고른 빛, 그림자가 거의 없고 색이 차분하다',
  '역광에 가까운 낮은 햇빛, 가장자리가 빛나고 앞면은 살짝 어둡다',
  '늦은 오후의 따뜻한 사광, 길게 늘어진 그림자',
];
const DEPTH: readonly string[] = [
  '얕은 심도로 피사체만 또렷하고 배경은 부드럽게 풀린다',
  '전경부터 배경까지 고르게 또렷한 깊은 심도',
  '중간 심도 — 피사체와 그 주변까지 읽히고 먼 배경만 풀린다',
];
const ANGLE: readonly string[] = [
  '눈높이에서 정면으로',
  '지면 가까이 낮은 각도에서 올려다보며',
  '위에서 내려다보는 부감으로',
  '어깨 너머로 손끝을 따라가듯',
  '비스듬한 측면에서',
];
const DISTANCE: readonly string[] = [
  '피사체가 프레임을 넉넉히 채우게',
  '한 발 물러나 주변 상황이 함께 보이게',
  '아주 가까이 붙어 질감이 드러나게',
  '피사체를 한쪽으로 밀고 반대쪽에 여백을 두어',
];
// 생활감 — 생성 이미지가 가장 티 나는 지점은 '너무 깨끗하다'는 것이다. 원예 소재에 실제로 있는
// 지저분함을 지시로 준다. 지어내는 게 아니라 현실을 복원하는 쪽이다.
// ⚠ 화분·받침은 컨테이너 재배 소품이다. 노지 수종 편에 들어가면 화면이 통째로 뒤집힌다 —
// 실사고(2026-09-06): "대추나무 결실주"(과수원 나무) 씬2 에 "색이 바랜 화분"이 배정되자
// 모델이 화분에 심긴 관엽식물을 그렸고, 대추나무가 아니게 됐다. 씬 QA 가 잡아 재생성했지만
// 재생성은 같은 프롬프트를 물려받으므로 화분이 그대로 따라가 또 틀렸다.
// 그래서 컨테이너 소품은 화분·실내 주제일 때만 쓴다(TEXTURE_POTTED).
const TEXTURE: readonly string[] = [
  '흙이 묻은 손과 손톱',
  '고르지 않은 흙 표면, 떨어진 잎 몇 장',
  '벌레 먹은 잎이나 마른 끝이 한두 장 섞여',
  '오래 써 길이 든 장갑과 앞치마',
];
/** 화분·실내 주제에서만 쓰는 생활감 — 노지 편에 넣으면 종 자체가 틀어진다. */
const TEXTURE_POTTED: readonly string[] = [
  '색이 바랜 화분, 물 자국이 남은 받침',
  '흙이 묻은 손과 손톱',
  '오래 써 길이 든 장갑과 앞치마',
];
const HOOK_PUSH: readonly string[] = [
  ' 첫 3초에 스크롤을 멈출, 가장 시선을 끄는 강렬한 장면으로 연출한다.',
  ' 첫 화면이다 — 무슨 일이 벌어지기 직전의 순간을 잡아 다음이 궁금해지게 한다.',
  ' 첫 화면이다 — 문제가 눈에 바로 보이는 상태를 클로즈업으로 보여준다.',
];

/**
 * 숏폼 씬 이미지(gpt-image-2, 세로 9:16) 프롬프트 조립 — shorts-gen 의 스타일 일관성(전 씬 공통 앵커
 * 반복) + 시네마토그래피(구도·조명·씬 변주). 자막·내레이션은 렌더러가 얹으므로
 * 이미지엔 글자를 넣지 않는다(오타 원천 차단). 순수 함수(생성 없이 프롬프트 검증 가능).
 *
 * seed(보통 쇼츠 id)를 주면 촬영 지시가 편마다 갈린다. 안 주면 종전 문구 그대로다.
 */
export function buildSceneImagePrompt(a: {
  style: string; scene: string; index: number; total: number; seed?: string; subject?: string; subjectLatin?: string; seasonal?: string;
  /** 화분·실내 주제인가 — 컨테이너 소품(화분·받침)을 써도 되는지 가른다(2026-09-06). */
  potted?: boolean;
  /** 이 종의 실물 사진이 참조로 첨부되는가(2026-09-06). 문구만 바꾼다 — 파일은 생성기가 붙인다. */
  speciesRef?: boolean;
  /** 성장 단계별 실제 크기(2026-09-08, 사전 size) — 없으면 학명으로 가늠하게 한다. */
  subjectSize?: string;
  /** 원문 묘사(2026-10-12) — 이 씬에 꼭 보여야 할 것·나오면 안 되는 것(designScenes must_show·must_not). */
  must?: SceneMust;
  /** 주인공 나무(2026-10-15) — 이 씬에 나오는 그 한 그루(나이·키·굵기·상태). 주인공이 나오는 씬에만 준다. */
  hero?: string;
  /** 이 씬이 주인공 첫 그림을 첫 번째 첨부로 받는가(SHORTS_HERO_CHAIN) — 문구만 바꾼다, 파일은 생성기가 붙인다. */
  heroChained?: boolean;
}): string {
  const { style, index: i, total, seed, subject, subjectLatin, seasonal } = a;
  const scene = a.scene.trim() || '주제를 상징하는 한국 생활 장면';
  const isHook = i === 0;
  const p: string[] = [];
  p.push(`[전 씬 공통 스타일] ${style}`);
  // 수종 앵커 — 씬 묘사가 "나무"라고만 해도 이 줄이 종을 못박는다. 실사고(2026-09-03): 측백나무
  // 편의 4씬 중 3씬이 활엽수로 나왔다. 침엽수인데. 원예 채널에서 이건 신뢰 문제다.
  // 학명을 앞에 세운다 — 한글 이름·산문 묘사보다 이미지 모델이 훨씬 정확하게 알아듣는다.
  // 실측(2026-09-04): 한글 묘사만 줬더니 남천을 "손바닥 모양 잎"으로 적었고(실제는 깃꼴겹잎)
  // 그대로 그려졌다.
  if (subjectLatin || subject) {
    const head = subjectLatin ? `${subjectLatin}${subject ? ` (${subject})` : ''}` : subject;
    p.push(`[대상 식물 — 화면의 나무·풀은 반드시 이 종] ${head}. 잎 모양·잎차례·수형을 이 종의 실제 모습대로 그린다. 다른 종으로 대체하거나 일반적인 나무로 뭉개지 마라.`);
    if (seasonal) p.push(`[이 씬에 나오는 부위] ${seasonal}. 이 종의 실제 꽃·열매 모양대로 그린다.`);
  }
  // 종 레퍼런스(2026-09-06) — 글자로 적은 형태를 모델이 못 옮긴다. 실측: 위 앵커가 "잎맥 세 개",
  // "지그재그 수형"을 다 적었는데도 깃꼴 잎맥의 매끈한 나무가 나왔다. 사장님이 찍은 그 수종
  // 프레임 한 장을 붙이자 한 번에 맞았다. 참조는 팔레트가 아니라 '이 종의 실물'로 못박는다.
  // 주인공 나무(2026-10-15 사장님 선택) — 이 씬의 나무는 영상이 따라가는 바로 그 한 그루다. 참조 사진(보관소 영상 프레임)은 대개
  // 사장님 밭의 큰 나무라, 크기·굵기까지 따라가면 묘목 편이 성목으로 그려진다 — 잎·수피 모양에만 쓰게 한다.
  if (a.hero) {
    p.push(`[주인공 나무 — 이 영상의 장면들은 같은 한 그루] ${a.hero}. 이 장면의 나무는 바로 이 나무다 — 나이·키·줄기 굵기·가지 수를 바꾸지 마라. 가까이 찍어도 줄기·가지 굵기는 이 나무 기준이다.`);
  }
  if (a.heroChained) {
    p.push('[첫 번째 첨부 사진 — 주인공 나무] 첫 번째 첨부는 앞 장면에서 그린 바로 그 나무다. 같은 나무로 이어지게 줄기 굵기·키·가지 배치·수피를 맞추고, 각도·거리·손 동작만 이 장면에 맞게 바꿔라. 두 번째부터의 첨부는 이 종의 실물 참조다.');
  }
  if (a.speciesRef) {
    p.push(a.hero && isYoungHero(a.hero)
      ? `[첨부 참조 사진 — 이 종의 실물${a.heroChained ? '(두 번째부터)' : ''}] 이 종의 잎 모양·잎맥·잎 가장자리·수피 질감만 이 사진과 같게 그린다. 사진 속 나무의 크기·줄기 굵기·수형은 따르지 마라 — 이 장면의 나무는 위 주인공 나무다. 구도·배치·피사체도 복제하지 마라.`
      : '[첨부 참조 사진 — 이 종의 실물] 첨부한 사진은 바로 이 종을 찍은 실물이다. 잎 모양·잎맥이 뻗는 방향·잎 가장자리·수피 질감·가지가 갈라지는 방식을 이 사진과 같게 그린다. 다만 구도·배치·피사체는 복제하지 말고 이 씬만의 장면으로 새로 구성한다.');
  }
  // 나무 크기(2026-09-08 사용자 지시) — 실측: 공작단풍(성목 2~3m) 마지막 씬이 사람 팔 위로 까마득히 솟은 거목으로 그려졌다.
  // 장면이 가리키는 성장 단계의 실제 크기로 그리고, 사람·손·화분 같은 비례 기준이 있으면 그것에 맞춘다.
  if (a.hero) {
    p.push('[나무 크기] 위 주인공 나무 묘사의 나이·키·굵기 그대로 그린다. 사람·손이 함께 나오면 그 비례로 크기를 잡아라 — 다른 씬보다 크거나 굵게 그리지 마라.');
  } else if (subjectLatin || subject) {
    p.push(a.subjectSize
      ? `[나무 크기 — 성장 단계에 맞게] 이 종의 실제 크기: ${a.subjectSize}. 장면 묘사가 가리키는 단계(묘목/유목/성목)의 크기로 그리고 성목 최대를 넘기지 마라. 사람·손·화분·도구가 함께 나오면 그 비례로 크기를 잡아라 — 사람 머리 위로 까마득히 솟는 거목으로 그리지 마라.`
      : `[나무 크기 — 성장 단계에 맞게] ${subjectLatin ?? subject}의 실제 성장 단계별 크기(묘목→유목→성목의 높이와 폭)를 가늠해 장면 묘사가 가리키는 단계의 크기로 그리고, 이 종의 실제 최대 크기를 넘기지 마라. 사람·손·화분·도구가 함께 나오면 그 비례로 크기를 잡아라.`);
  }
  // 연장은 화면에 넣지 않는다(2026-09-06 실사고) — 생활감이 "쓴 자국이 있는 도구"를 부르면
  // 전지가위가 들어오는데, 날과 축의 구조가 물리적으로 불가능하게 그려진다. 손만으로 충분하다.
  p.push('[연장] 전지가위·톱·삽 같은 연장은 화면에 넣지 마라 — 날·축·손잡이 구조가 어긋나게 그려진다. 손은 나무를 짚거나 가리키는 정도로만 쓴다.');
  // 원문 묘사(2026-10-12 사장님 지시) — 장면 묘사보다 구체적인 사실(사선으로 자른 끝·잎 없는 맨가지·묘목 나이별 크기)을 따로 못박는다.
  p.push(...mustPromptLines(a.must));
  if (!seed) { // 종전 동작 보존
    p.push(`장면(씬 ${i + 1}/${total}${isHook ? ', 훅' : ''}): ${scene}.${isHook ? HOOK_PUSH[0] : ''}`);
    p.push('구도: 세로 9:16 프레임을 피사체로 자연스럽게 채운다.');
    p.push('시네마토그래피: 얕은 심도와 부드러운 조명으로 피사체를 또렷하게. 이전 씬과 구분되는 앵글·피사체·범위로 변주하되, 전 씬 공통 팔레트·질감·조명을 동일하게 유지해 시리즈 일관성을 낸다.');
    p.push('금지: 이미지 안에 글자·자막·숫자·로고·워터마크·간판 텍스트를 넣지 않는다(자막은 렌더러가 따로 얹는다). 손·손가락 왜곡과 어색한 합성을 피한다.');
    return p.join('\n');
  }
  const vid = fxSeed(seed);                      // 편 단위 — 씬이 바뀌어도 같다
  const sc = fxSeed(`${seed}@${i}`);             // 씬 단위
  const at = <T,>(list: readonly T[], n: number, axis: number): T => list[fxSeed(`${n}#${axis}`) % list.length]!;
  p.push(`장면(씬 ${i + 1}/${total}${isHook ? ', 훅' : ''}): ${scene}.${isHook ? at(HOOK_PUSH, vid, 0) : ''}`);
  p.push(`구도: 세로 9:16. ${at(ANGLE, sc, 1)} ${at(DISTANCE, sc, 2)} 담는다.`);
  p.push(`빛과 심도(전 씬 동일): ${at(LIGHTING, vid, 3)}. ${at(DEPTH, vid, 4)}.`);
  p.push(`생활감: ${at(a.potted ? TEXTURE_POTTED : TEXTURE, sc, 5)} — 새것처럼 말끔하게 정돈된 연출은 피한다.`);
  p.push('씬 변주: 이전 씬과 구분되는 앵글·피사체·범위를 쓰되, 전 씬 공통 팔레트·질감·조명은 동일하게 유지해 시리즈 일관성을 낸다.');
  p.push('금지: 이미지 안에 글자·자막·숫자·로고·워터마크·간판 텍스트를 넣지 않는다(자막은 렌더러가 따로 얹는다). 손·손가락 왜곡과 어색한 합성을 피한다.');
  return p.join('\n');
}

/** 숏폼 생성 잡 — launch 래퍼가 버스·시그널을 주입(오피스 뷰 연동). 프론트는 GET 폴링. */
/**
 * 이 편을 쓴 작가의 목소리 옵션(2026-09-03) — 렌더 호출에 펼쳐 넣는다.
 * writerId 가 없으면(레거시 148편) 빈 객체 → 전역 기본 보이스로 종전과 동일하게 낭독된다.
 */
/**
 * 이 편의 자막·제목 배치(2026-09-03) — 보정값을 시드로 살짝 흔든다. 176편이 같은 픽셀에
 * 자막을 얹던 것을 편마다 어긋나게 하는 게 목적이다. 폭은 좁고 하한이 걸려 있어 읽기 편함은
 * 그대로다(varyLayout 주석 참조).
 */
function layoutFor(shortId: string): { bottomPct: number; fontPx: number; hookFontPx: number; titleTopPct: number; titleWidthPct: number } {
  return varyLayout({
    bottomPct: CONFIG.shortsCaptionBottomPct,
    fontPx: CONFIG.shortsCaptionFontPx,
    hookFontPx: CONFIG.shortsCaptionHookFontPx,
    titleTopPct: CONFIG.shortsTitleTopPct,
    titleWidthPct: CONFIG.shortsTitleWidthPct,
  }, shortId);
}

function writerVoiceOpts(short: Pick<Shorts, 'writerId' | 'writer'>): { elevenVoiceId?: string; elevenVoiceSettings?: Record<string, number> } {
  const w: ShortsWriter | undefined = writerById(short.writerId) ?? writerByName(short.writer);
  if (!w) return {}; // 레거시(148편) — 전역 기본 보이스로 종전과 동일
  console.log(`[숏폼] 낭독 — ${w.name} 목소리(${w.voiceNote})`);
  return { elevenVoiceId: w.voiceId, elevenVoiceSettings: { ...w.voiceSettings } };
}

// siblingPlanToAvoid 폐기(2026-09-03) — 형제편에게 원편 훅·제목을 보여주고 "겹치지 마라"고
// 하던 블록. 이제 대본을 공유하므로 겹칠 두 대본이 없다.

/**
 * 디자인 썸네일에 붙일 훅(0번) 정지 화면(2026-09-18) — 종전엔 늘 `images[0]`(또는 첫 정지
 * 이미지)이었다. 훅이 실촬영 영상으로 덮이면(SHORTS_HOOK_FOOTAGE) 그 씬은 이미지를 생성하지
 * 않으므로(`covered`) 정지 화면이 없다 — 클립 중간 지점을 뽑아 대신 쓴다. 추출이 실패하면
 * 종전 방식(images.find)으로 그대로 떨어진다(fail-open).
 * 완성 런·수정요청·대시보드 '썸네일 재생성' 버튼(main.ts)이 같이 쓴다 — 씬 인덱스 배열을 넘겨야
 * 한다(images[0] 이 훅). scenes/ 이름순 첫 파일은 훅이 실촬영이면 2번 씬 그림이다.
 */
export async function hookStillFor(
  images: ReadonlyArray<string | null>, clips: ReadonlyArray<string | null> | undefined,
  dir: string, signal?: AbortSignal,
): Promise<string | null> {
  const clip = clips?.[0];
  if (CONFIG.shortsHookFootage && !images[0] && clip && fs.existsSync(clip)) {
    try {
      const durationSec = await probeDuration(clip);
      const frame = await clipMidFrame(clip, durationSec, path.join(dir, 'refs'), signal);
      if (frame) return frame;
    } catch { /* fail-open — 아래 종전 방식으로 */ }
  }
  return images.find((p): p is string => !!p && fs.existsSync(p)) ?? null;
}

/**
 * 4) 조립~마무리 — 대본·이미지·클립이 준비된 뒤의 공통 경로.
 *
 * runShortsJob 본문에서 떼어냈다(2026-09-03). 형제편은 자산을 승계해 1~3단계를 통째로 건너뛰는데,
 * 그 뒤 할 일(렌더·길이 상한 집행·캡션·알림·썸네일·자동 업로드)은 원편과 완전히 같기 때문이다.
 * 복사본을 두면 둘이 언젠가 어긋난다.
 */
async function finishShortsRun(a: {
  id: string; store: ReturnType<typeof shortsStore>; dir: string; short: Shorts;
  plan: Plan; images: Array<string | null>; clips: Array<string | null>;
  opts: { bus?: EventBus; signal?: AbortSignal };
  say: (m: string) => void; checkAbort: () => void;
  /** 승계편이면 1 — 원편과 다른 필름 룩을 받는다. */
  lookOffset?: number;
  /** 여분 실촬영(2026-09-18, SHORTS_MIDCUT) — normalizeSpareClips 가 구운 clips/spare_NN.mp4. 5초 넘는 클립 씬의 뒷 절반을 이걸로 바꾼다. */
  spareClips?: string[];
}): Promise<void> {
  const { id, store, dir, short, images, clips, opts, say, checkAbort, lookOffset, spareClips } = a;
  let plan = a.plan;
  // 낭독 직전 예고 재확인·자리 예약(2026-10-02) — 기획 시점엔 자리가 있었어도 형제 채널 런이 그 사이 예고했을 수 있다.
  // 등록을 렌더 뒤에 하면 둘 다 확인을 통과하고 뒤엣것만 거절돼 '낭독은 했는데 등록은 없는' 편이 생긴다(리뷰 지적) —
  // 그래서 확인과 등록을 낭독 전에 한 자리에서 한다. 잡이 실패하면 runShortsJob 이 dropBySource 로 되돌린다.
  {
    const rm = promiseRoomFor(short);
    const notes: string[] = [];
    let st = settleNextEpisode(plan, rm.room);
    if (st.note) { plan = st.plan; notes.push(rm.room ? st.note : `${st.note}(${rm.why})`); }
    if (plan.next?.topic) {
      let reserved: ReturnType<ReturnType<typeof promiseStore>['create']> = null;
      try {
        reserved = promiseStore().create({
          topic: promiseTopicWithSpecies(plan.next.topic, `${short.keyword ?? ''} ${short.topic} ${plan.title}`), window: plan.next.window,
          sourceKind: 'shorts', sourceId: id, sourceTopic: plan.title, brand: short.brand ?? null,
        });
      } catch { /* 무해 — 아래에서 예고를 덜어낸다 */ }
      if (reserved) say(`예고 등록(낭독 전 예약) — "${reserved.topic.slice(0, 30)}"`);
      else {
        st = settleNextEpisode(plan, false);
        if (st.note) { plan = st.plan; notes.push(`${st.note}(등록 거절)`); }
      }
    }
    if (notes.length) {
      try { fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8'); } catch { /* 무해 — 메모리 대본으로 진행 */ }
      say(`예고 정리(낭독 직전) — ${notes.join(' · ')}`);
    }
  }
  // 씬→이미지 매핑을 남긴다 — 형제편이 이걸 읽어 같은 자리에 같은 그림을 놓는다.
  // 실촬영 씬은 이미지를 안 만들어 scenes/ 의 파일 수와 씬 수가 어긋나므로, 이름순 위치로는 밀린다.
  writeSceneImageMap(dir, images);
  const io: JobIO = { bus: opts.bus, signal: opts.signal };
  // 4) 조립 — 기본 Remotion 모션그래픽, 실패 시 ffmpeg 슬라이드쇼로 폴백(무중단).
  say(CONFIG.shortsRenderer === 'ffmpeg' ? '영상 조립 시작 — ffmpeg 슬라이드쇼' : '영상 조립 시작 — Remotion 모션그래픽');
  let titleArt: Awaited<ReturnType<typeof generateTitleArt>> = null;
  if (CONFIG.shortsRenderer !== 'ffmpeg' && CONFIG.shortsTitleOverlay) {
    // 상단 제목 캘리(썸네일과 같은 카피, 투명 PNG) — 렌더 전에 생성해야 오버레이 가능. 실패해도 무해(오버레이 생략).
    titleArt = await generateTitleArt({ dir, title: plan.title, description: plan.description, titles: plan.titles, keyword: short.keyword, signal: opts.signal });
    checkAbort(); // 취소가 '스킵' 메시지로 위장되지 않게 — abort 는 null 로 삼켜져 나온다
    say(titleArt ? '상단 제목 캘리 생성 완료' : '상단 제목 캘리 스킵(오버레이 없이 진행)');
  }
  // 조립 1회(Remotion → ffmpeg 폴백 체인) — 길이 상한 재조립(아래 하드 캡)이 재사용하므로 클로저로 묶는다.
  // imgs·clps 를 인자로 받는 이유: 결정적 트리밍이 씬을 제거하면 씬별 이미지·클립 배열도 같이 줄어야 한다.
  const lay = layoutFor(id); // 편별 자막·제목 배치(보정값 기준 좁은 흔들림)
  const assemble = async (p: Plan, imgs: Array<string | null>, clps: Array<string | null>): Promise<Awaited<ReturnType<typeof renderShortsVideo>>> => {
    let rr = null as Awaited<ReturnType<typeof renderShortsVideo>> | null;
    if (CONFIG.shortsRenderer !== 'ffmpeg') {
      try {
        rr = await renderShortsVideoRemotion(dir, p.scenes, imgs, {
          clips: clps, signal: opts.signal, ...writerVoiceOpts(short),
          // 자막 옵션 — 위치(플랫폼 UI 가림 회피)·키워드 강조색(설정 기반, A/B 선택 후 기본값 확정).
          caption: {
            bottomPct: lay.bottomPct,
            fontPx: lay.fontPx,
            hookFontPx: lay.hookFontPx,
            ...(CONFIG.shortsCaptionKeyword && short.keyword ? { keyword: short.keyword } : {}),
            ...(CONFIG.shortsCaptionOutline ? { outline: true } : {}),
          },
          ...(titleArt ? { title: { imagePath: titleArt.imagePath, topPct: lay.titleTopPct, widthPct: lay.titleWidthPct } } : {}),
          ...(spareClips?.length ? { spareClips } : {}),
        });
      }
      catch (e) { say(`모션 렌더 예외 → ffmpeg 폴백: ${e instanceof Error ? e.message.slice(0, 80) : e}`); rr = null; }
    }
    if (!rr || !rr.ok) {
      // 실패 사유 동봉(2026-08-08) — 종전엔 r.issues 를 버려 "왜 폴백했나"를 사후 추적할 수 없었다(관측 공백).
      if (rr) say(`모션 렌더 실패 → ffmpeg 슬라이드쇼로 폴백${rr.issues.length ? ` (${rr.issues.join(' · ').slice(0, 140)})` : ''}`);
      // 폴백에도 상단 제목 전달 — Remotion 실패 시 제목이 통째로 사라지던 실측(참나무 쇼츠) 봉합.
      rr = await renderShortsVideo(dir, p.scenes, imgs, {
        signal: opts.signal, ...writerVoiceOpts(short),
        ...(titleArt ? { title: { imagePath: titleArt.imagePath, topPct: CONFIG.shortsTitleTopPct, widthPct: CONFIG.shortsTitleWidthPct } } : {}),
      });
    }
    return rr;
  };
  let r = await assemble(plan, images, clips);
  if (!r.ok || !r.videoPath) throw new Error(`조립 실패 — ${r.issues.join(' · ').slice(0, 250)}`);
  // 길이 상한 집행(2026-08-20) — 소프트 경고(08-14)로는 61~77초 발행이 계속됐고, 08-11 길이 폭증이
  // 유튜브 하락 변곡점과 겹치는 최대 요인으로 실측됐다. 초과 시 '실측 낭독 속도'로 예산을 역산해
  // 재감량(LLM+결정적 트리밍 마감)→재조립(최대 2회). 그래도 초과면 error 가 아니라 ⚠ ready —
  // 생성이 항상 이긴다(사용자 확정 2026-08-20: "쇼츠는 반드시 생성되어야 함", 첫 하드 캡이 60.7초
  // 를 error 로 죽인 실사고 직후 지시). 초과본 발행은 발행 핸들러 409 게이트가 따로 막는다.
  let liveIdx = plan.scenes.map((_, i) => i); // 원본 씬 인덱스 추적 — 트리밍이 씬을 제거하면 이미지·클립 매핑에 사용
  for (let round = 1; (r.durationSec ?? 0) > CONFIG.shortsMaxDurationSec && round <= 2; round++) {
    checkAbort();
    const chars = shortsNarrationChars(plan);
    const cps = chars / Math.max(1, (r.durationSec ?? 1) - 2); // 인트로(1.6초)·여백 보정한 실측 자/초
    const fit2 = await fitShortsPlanToDuration(io, plan, Math.floor((CONFIG.shortsMaxDurationSec - 5) * cps));
    if (!fit2.compressed) { say(`길이 상한 재감량 무변화(${round}/2) — 이미 최소 구성`); break; }
    liveIdx = fit2.keptScenes.map((k) => liveIdx[k]!);
    plan = fit2.plan;
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8'); // 수정요청 재조립이 같은 대본을 보게
    // 구 대본 TTS 잔존 소거 — 재조립 라운드에서 씬 TTS 가 실패하면 ffmpeg 폴백이 감량 전 mp3 를
    // 재사용해 자막(신 대본)·오디오(구 대본) 불일치 영상이 될 수 있다(리뷰 지적). 대본이 바뀌었으니 캐시 무효.
    try {
      const rdir = path.join(dir, 'remotion');
      for (const f of fs.readdirSync(rdir)) if (/^narr_\d+\.mp3$/.test(f)) fs.unlinkSync(path.join(rdir, f));
    } catch { /* 디렉토리 없음 등 — 무해 */ }
    say(`길이 상한 초과 ${r.durationSec}초 — 실측 ${cps.toFixed(1)}자/초 기준 재감량 ${fit2.beforeChars}→${fit2.afterChars}자${liveIdx.length < images.length ? ` · 씬 ${liveIdx.length}개로 축소` : ''}, 재조립(${round}/2)`);
    const r2 = await assemble(plan, liveIdx.map((i) => images[i] ?? null), liveIdx.map((i) => clips[i] ?? null));
    if (!r2.ok || !r2.videoPath) break; // 재조립 실패 — 직전 완성본 유지(생성 우선)
    r = r2;
  }
  if ((r.durationSec ?? 0) > CONFIG.shortsMaxDurationSec) {
    say(`⚠ 길이 상한 잔여 초과 — ${r.durationSec}초 > ${CONFIG.shortsMaxDurationSec}초. 생성은 완료(생성 우선 원칙) — 발행 게이트가 초과본을 막으니 ✍수정요청으로 감량 후 발행`);
  }
  const finalVideoPath = r.videoPath; // 루프 재대입으로 풀린 내로잉 재확립(r2 는 ok+videoPath 확인분만 채택됨)
  if (!finalVideoPath) throw new Error('조립 실패 — 결과 영상 경로 없음');
  const fallbacks = r.issues.filter((x) => x.includes('배경 폴백')).length;

  // 캡션 파일(업로드 편의) — 제목·설명·해시태그.
  const caption = [plan.title, '', plan.description, '', plan.hashtags.join(' ')].filter((x, i) => x || i === 1 || i === 3).join('\n');
  fs.writeFileSync(path.join(dir, 'caption.txt'), caption, 'utf-8');
  // 직접 제작 모션그래픽(2026-10-12 사장님 결정 "두 채널 모두 적용") — '완성' 표시 전에 바꾼다(발행 버튼이 원본을 집지 않게).
  // 실촬영 씬은 원본 그대로, 정보 카드 씬만. 실패·대상 아님이면 원본 영상 그대로 진행.
  if (CONFIG.shortsMotionGraphics && !opts.signal?.aborted) {
    store.update(id, { stage: 'rendering' });
    await applyMotionGraphics(id, { log: say });
  }

  store.update(id, {
    stage: 'ready', scenes: r.sceneCount, durationSec: r.durationSec, bgFallbacks: fallbacks,
    topic: plan.title || short.topic,
  });
  say(`${plan.title.slice(0, 30)} — ${r.durationSec}초 · 씬 ${r.sceneCount}개 완성${fallbacks ? ` (배경 폴백 ${fallbacks}씬)` : ''}`);
  // 검토 대기 알림은 디자인 썸네일을 만든 **뒤**에 보낸다(아래, 2026-10-07 밤나무 사고) — 알림의 발행 버튼이 썸네일보다 먼저
  // 나가면 인트로·커버 없이 발행된다. 썸네일 생성 중 표시(.thumb-pending)는 지금 세운다 — 대시보드 버튼도 이걸 기다린다.
  markThumbPending(dir);
  {
    // 예고 정합 마감(2026-10-02) — 등록은 낭독 전에 예약했다(위). 렌더 뒤 재감량(fit2)이 예고 문장을 지웠으면
    // 영상에 남은 말이 기준이다 — 예고가 사라졌으면 예약을 취소한다.
    try {
      const mine = promiseStore().list().find((p) => p.sourceId === id && p.status === 'pending');
      if (mine && !mentionsNextEpisode(plan.scenes[plan.scenes.length - 1])) {
        promiseStore().dropBySource(id);
        say(`예고 취소 — 최종 대본에서 예고 문장이 빠짐("${mine.topic.slice(0, 30)}")`);
      }
    } catch { /* 무해 */ }
  }

  // 디자인 썸네일 — 훅 씬 배경 위에 손글씨 제목/핵심(gpt-image). best-effort: 실패해도 완성 유지(엔드포인트가 영상 프레임 폴백).
  try {
    const hook = await hookStillFor(images, clips, dir, opts.signal);
    const ok = await generateDesignedThumbnail({
      dir, title: plan.title, description: plan.description, titles: plan.titles, keyword: short.keyword, hookImage: hook, signal: opts.signal,
      ...(titleArt ? { copy: titleArt.copy } : {}), // 상단 제목 캘리와 같은 카피 재사용 — 영상·썸네일 문구 일치
    });
    if (ok) store.update(id, {}); // updatedTs 갱신 → 포스터 URL(?v=updatedTs) 캐시버스트, 프레임 폴백본 대신 디자인 썸네일 표시
    say(ok ? '썸네일 생성 완료' : '썸네일 생성 스킵(프레임 폴백)');
  } catch (e) { say(`썸네일 생성 건너뜀(무해): ${e instanceof Error ? e.message.slice(0, 60) : e}`); }
  finally { clearThumbPending(dir); }
  // 검토 대기 알림(완성 영상 동봉, 50MB 초과 시 텍스트 폴백) — 썸네일 뒤에 보낸다(위 주석). fire-and-forget, 실패 무해.
  {
    const done = store.get(id);
    if (done) {
      // 발송 정착 후 notifiedTs 기록 — 도중에 프로세스가 죽으면 미기록으로 남아 부팅 복구 스윕이 재발송.
      void notifyShortsReady({
        id, topic: done.topic, brand: done.brand, platform: done.platform, durationSec: r.durationSec, scenes: r.sceneCount,
        sourcePieceId: done.sourcePieceId, writer: done.writer, director: done.director, factGate: done.factGate,
      }, finalVideoPath).finally(() => { try { store.update(id, { notifiedTs: new Date().toISOString() }); } catch { /* 무해 */ } });
    }
  }

  // ready 이후 자동 유튜브 업로드(옵트인) — 비공개 고정. 실패해도 잡은 이미 완성(수동 재시도 가능).
  // 사실 검증 보류면 자동 업로드를 건너뛴다(2026-10-12) — 이 경로는 발행 라우트의 확인 단계를 거치지 않는다.
  const factHeld = !!shortsFactHoldBlockReason(store.get(id)?.factGate);
  if (CONFIG.autoYtUpload && factHeld) say('자동 유튜브 업로드 건너뜀 — 사실 검증 보류(텔레그램에서 확인 후 업로드)');
  if (CONFIG.autoYtUpload && !factHeld) {
    // 인트로(1.6초=디자인 썸네일) 붙은 영상 업로드 + 썸네일=그 영상 첫 프레임 — 미지정 시 유튜브가
    // 중간 프레임을 자동 선택해 커버가 엉뚱해짐(실측 2026-07-22, 사용자 방침: 맨 처음이 보이게).
    const ytVideo = (await ensureShortsDownload(dir).catch(() => null)) ?? finalVideoPath;
    const ytCover = await extractFirstFrame(ytVideo, path.join(dir, 'yt-cover.jpg'), opts.signal).catch(() => null);
    const up = await uploadShortsToYoutube({
      slug: short.brand ?? '', videoPath: ytVideo,
      title: plan.title, description: plan.description, hashtags: plan.hashtags,
      blogUrl: blogUrlForPiece(short.sourcePieceId), // 원본 블로그 링크 — 자동 업로드 시점 조회(대개 발행 전이라 생략됨)
      thumbnailPath: ytCover ?? undefined,
      signal: opts.signal,
    });
    if (up.ok) { store.update(id, { youtubeId: up.videoId, youtubeUrl: up.url, youtubeTs: new Date().toISOString() }); say(`유튜브 비공개 업로드 완료 — ${up.url}`); }
    else say(`유튜브 자동 업로드 실패(수동 재시도 가능) — ${up.error}`);
  }
}




/**
 * 중간 컷 여분 클립 굽기(fix round 1) — 배정에 안 쓰인 보관소 영상 중 실제로 쓰일 것만 clips/spare_NN.mp4 로 정규화한다.
 *
 * 쓰일 씬은 planSpareClips(렌더러와 같은 규칙: 5초 넘는 클립 씬, 뒷 절반의 MIN_CLIP_COVERAGE, 여분 하나는 한 번)가 자수 추정
 * 길이로 정한다. 씬 번호 순으로 돌려주므로 렌더러(stageAndBuildProps → planSpareClips, 실측 길이)가 같은 순서로 다시 집는다 —
 * 실측이 추정과 달라 후보 씬이 바뀌면 배정이 한 칸 밀릴 수 있지만 하한(MIN_CLIP_COVERAGE)은 렌더러가 다시 본다.
 * 굽기 실패는 그 여분을 버린다 — 실촬영 배치(applyUserSegments)와 달리 통짜 폴백이 없다: 통짜 원본(HEVC·회전)이 바로 문제라서다.
 */
async function normalizeSpareClips(a: {
  userVideoFiles: readonly string[]; videoDurations: ReadonlyMap<string, number>;
  videoPlan: ReadonlyArray<VideoSegment | null>; clips: ReadonlyArray<string | null>; sceneEst: readonly number[];
  dir: string; say: (m: string) => void; signal?: AbortSignal;
}): Promise<string[]> {
  const assigned = new Map<string, number>();
  for (const v of a.videoPlan) if (v) assigned.set(v.path, v.startSec);
  const pool: Array<{ path: string; seconds: number; startSec: number }> = [];
  for (const f of a.userVideoFiles) {
    const dur = a.videoDurations.get(f) ?? 0;
    if (dur <= 0) continue;
    // 종전 공급원 — 배정에 안 쓰인 파일. 컴포저에 여러 개 첨부했을 때만 존재한다.
    if (!assigned.has(f)) { pool.push({ path: f, seconds: dur, startSec: 0 }); continue; }
    // 배정된 파일의 남는 구간(2026-09-28) — 보관소 경로는 영상이 하나뿐이고 그 하나는 반드시 쓰이므로
    // 종전 공급원이 항상 비어 있었다(89편 내내 여분 0건). 같은 파일의 다른 구간이 유일한 여분이다.
    if (!CONFIG.shortsMediaRotate) continue;
    // 같은 파일에서 오는 여분은 **한 편에 하나만**. 클립 씬이 여럿이면(I2V 클립 포함) 같은 파일이 여러 자리를
    // 먹어 09-04("한 영상을 여러 씬에 쪼개 넣지 않는다")·09-08("한 편에 영상 1개") 경계를 넓힌다.
    // 중간 컷은 있으면 좋은 것이고, 목적(여분 0건 → 1건)은 하나로 달성된다.
    for (const w of spareWindows(f, dur, assigned.get(f)!, {
      sceneSec: windowSceneSec(CONFIG.shortsMaxDurationSec, CONFIG.shortsScenes), tailSec: SEGMENT_TAIL_SEC,
    }).slice(0, 1)) pool.push({ path: w.file, seconds: w.seconds, startSec: w.startSec });
  }
  if (!pool.length) return [];
  const est = a.sceneEst.map((sec, i) => ({ index: i, durationInFrames: sceneFrames(sec), hasClip: !!a.clips[i] }));
  const spareAt = planSpareClips(est, pool);
  const out: string[] = [];
  const rows: UsageSource[] = [];
  for (const [i, spare] of [...spareAt].sort(([x], [y]) => x - y)) {
    const frames = est[i]!.durationInFrames;
    const cut = midcutAt(frames) ?? Math.round(frames / 2);
    const seconds = (frames - cut) / FPS + SEGMENT_TAIL_SEC;
    const dst = path.join(a.dir, 'clips', `spare_${String(i + 1).padStart(2, '0')}.mp4`);
    try {
      out.push(await cutVideoSegment(spare.path, dst, spare.startSec, seconds, a.signal));
      rows.push({ scene: i + 1, file: spare.path, startSec: spare.startSec, seconds: Math.min(spare.seconds, seconds), role: 'spare' });
    } catch { a.say(`여분 실촬영 굽기 실패 — 씬 ${i + 1} 중간 컷은 원래 클립 그대로`); }
  }
  // 사용 현황 기록(fix round 2) — applyUserSegments 가 쓴 clips/sources.json 에 같은 모양으로 덧붙인다. 여분도 보관소 영상이
  // 화면에 들어간 것이라 안 적으면 '사용 현황'이 그 파일을 미사용으로 센다. 읽는 쪽(buildMediaUsage)은 file·scene 만 본다.
  // 실패는 삼킨다 — 기록 못 남겼다고 렌더가 멈추면 안 된다(applyUserSegments 와 같은 태도).
  if (rows.length) {
    try {
      const f = path.join(a.dir, SOURCES_FILE);
      let prev: UsageSource[] = [];
      try { const j = JSON.parse(fs.readFileSync(f, 'utf-8')) as unknown; if (Array.isArray(j)) prev = j as UsageSource[]; } catch { /* 없으면 새로 */ }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify([...prev, ...rows], null, 2), 'utf-8');
    } catch { /* 무해 */ }
  }
  if (out.length) a.say(`여분 실촬영 ${out.length}건 정규화 — 5초 넘는 실촬영 씬 ${rows.map((r) => `${r.scene}(${r.startSec}초)`).join(',')} 뒷 절반 교체 후보`);
  return out;
}

// 축은 같게, 각도만 다르게(2026-10-05) — 종전 "원문의 다른 축을 골라라"는 원문 핵심 앵커("핵심 축 중 최소 1개")·단독 이해
// 검산 항목 5(원문 핵심 축)·매체 전환("하나만 골라라")과 정면으로 부딪혔다. 두 번째 채널 편이 곁가지 축을 고르면 검산이
// '원문핵심 어긋남'으로 되돌리고, 수정 라운드가 원문 이름·시기를 덧붙여 건너뜀이 생겼다(라일락 인스타 실측).
export const SIBLING_ANGLE_RULE = '같은 훅·같은 결론 문장·같은 씬 순서를 쓰지 마라. 원문의 핵심 축은 같게 두고 각도만 바꿔라 — 다른 독자 상황(누가 언제 겪나), 다른 판정(무엇을 보고 어떻게 정하나), 다른 화자 시점(묻는 사람·알려주는 사람) 중 하나로. 채널 지침(유튜브=검색 답, 인스타=공유할 한 줄 판정)이 각도를 가른다.';

/**
 * 다른 채널용 형제 대본이 이미 있으면 그 제목·첫 문장을 '겹치지 마라' 지침으로 만든다(복원 2026-09-08).
 * 승계를 끄고 채널마다 독립 런으로 돌아오자 09-03 의 문제가 그대로 돌아왔다 — 동시에 띄우면 같은 원문에서
 * 같은 축의 대본이 나온다. 유튜브는 인스타를 못 보므로 '중복'이 문제가 아니라, 두 채널이 원하는 것(검색 답변형
 * vs 공유 판정형)이 달라 각도가 갈려야 한다는 것이 사용자 의도다. 읽기 실패는 무해(빈 문자열).
 */
/** 형제 편이 낸 대본 파일 — 최종 plan.json, 없으면 기획 채택 직후의 미리보기(SIBLING_PREVIEW_FILE). 둘 다 없으면 undefined.
 *  두 번째 채널 런의 출발 판정(server/main.ts startAfterSiblingPlan)과 '겹치지 마라' 지침(siblingPlanToAvoid)이 같이 쓴다. */
export function siblingPlanFile(dir: string): string | undefined {
  return [path.join(dir, 'plan.json'), path.join(dir, SIBLING_PREVIEW_FILE)].find((x) => fs.existsSync(x));
}

/** 형제 대본 미리보기 쓰기(2026-10-05) — 제목·훅만. 실패는 무해(두 번째 런은 plan.json 또는 대기 상한으로 출발한다). */
export function writeSiblingPreview(dir: string, plan: Pick<Plan, 'title' | 'scenes'>): void {
  try {
    fs.writeFileSync(path.join(dir, SIBLING_PREVIEW_FILE), JSON.stringify({ title: plan.title, scenes: plan.scenes.slice(0, 1).map((s) => ({ narration: s.narration })) }, null, 2), 'utf-8');
  } catch { /* 무해 */ }
}

function siblingPlanToAvoid(short: Shorts): string {
  if (!short.platform || !short.sourcePieceId) return '';
  try {
    const store = shortsStore();
    for (const sib of store.list()) {
      if (sib.id === short.id || sib.sourcePieceId !== short.sourcePieceId) continue;
      if (!sib.platform || sib.platform === short.platform) continue;
      // 최종 plan.json 이 없으면 기획 채택 직후의 미리보기(제목·훅)를 읽는다(2026-10-05, writeSiblingPreview).
      const f = siblingPlanFile(store.dirFor(sib.id));
      if (!f) continue;
      const plan = JSON.parse(fs.readFileSync(f, 'utf-8')) as { title?: string; scenes?: Array<{ narration?: string }> };
      const hook = plan.scenes?.[0]?.narration?.trim() ?? '';
      const title = plan.title?.trim() ?? '';
      if (!hook && !title) continue;
      return [
        `[다른 채널 대본 — 겹치지 마라] 같은 글로 ${platformLabel(sib.platform)}용 숏폼이 이미 이렇게 나갔다.`,
        title ? `· 제목: ${title}` : '',
        hook ? `· 첫 문장: ${hook}` : '',
        SIBLING_ANGLE_RULE,
      ].filter(Boolean).join('\n');
    }
  } catch { /* 형제 대본 읽기 실패는 무해 — 지침 없이 진행 */ }
  return '';
}

/**
 * 정해진 구간 배정대로 실촬영 영상을 굽고 씬 클립에 얹는다 — 생성 클립보다 실제로 찍은 화면이 낫다.
 *
 * 배정('어느 씬에 어느 구간')은 여기서 하지 않는다. 그건 대본이 나온 직후 내용 기준으로 정해지고
 * (planVideoSegments + assignMediaToScenes), 그래야 그 씬의 이미지·I2V 를 애초에 안 만든다.
 * 이 함수는 파일을 만드는 일만 한다.
 *
 * 모든 구간을 clips/user_NN.mp4 로 굽는다 — 첫 구간(startSec 0)도 예외 없이. 파일명이 곧 '실촬영'
 * 표시이고(shortsRenderRemotion 이 realFootage 를 세운다), 그 표시가 있어야 렌더러가 흑백·정지 같은
 * 파괴적 기법을 이 씬에서 피한다. 형제편 승계도 이 이름으로 원편의 배치를 그대로 물려받는다.
 *
 * 여유를 1.2초 더 떼는 이유: 배정에 쓴 씬 길이는 낭독 실측 전의 자수 추정이라 실제보다 짧을 수
 * 있다. 클립이 씬보다 짧으면 렌더러가 감속으로 늘려 슬로모션이 된다. 남는 꼬리는 그냥 잘린다.
 *
 * 굽기가 실패해도 올린 화면을 버리지 않는다 — 통짜라도 넣는다.
 */
async function applyUserSegments(
  clips: Array<string | null>, segments: ReadonlyArray<VideoSegment | null>,
  dir: string, say: (m: string) => void, signal?: AbortSignal,
): Promise<Array<string | null>> {
  if (!segments.some(Boolean)) return clips;
  const out = clips.slice();
  let placed = 0, fellBack = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const dst = path.join(dir, 'clips', `user_${String(i + 1).padStart(2, '0')}.mp4`);
    try {
      out[i] = await cutVideoSegment(seg.path, dst, seg.startSec, seg.seconds + SEGMENT_TAIL_SEC, signal);
      placed++;
    } catch {
      try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(seg.path, dst); out[i] = dst; }
      catch { out[i] = seg.path; }
      placed++; fellBack++;
    }
  }
  say(`실촬영 구간 ${placed}개 배치${fellBack ? ` · ${fellBack}개는 추출 실패로 통짜 사용` : ''}`);
  // 어느 파일이 어느 씬에 들어갔는지 기록(2026-09-08) — 보관소 '사용 현황'이 파일 단위로 정확히 보는 근거.
  // 종전엔 user_NN.mp4 존재로 '이 수종 영상이 쓰였다'까지만 알 수 있었다(같은 수종 영상이 둘이면 어느 것인지 모름).
  // 실패는 삼킨다 — 기록 못 남겼다고 렌더가 멈추면 안 된다(그 편은 종전처럼 추정으로 보인다).
  try {
    const rows = segments.map((seg, i) => (seg ? { scene: i + 1, file: seg.path, startSec: seg.startSec, seconds: seg.seconds } : null)).filter(Boolean);
    fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
    fs.writeFileSync(path.join(dir, SOURCES_FILE), JSON.stringify(rows, null, 2), 'utf-8');
  } catch { /* 무해 */ }
  return out;
}

export async function runShortsJob(
  id: string,
  opts: {
    sourceBody?: string; sceneCount?: number; bus?: EventBus; signal?: AbortSignal;
    /** 원문(블로그) 사실 게이트가 건 주장 — unsupported + unverified. 파생물에 재등장하면 승계 표시(처방 C). */
    sourceFlagged?: string[];
    /** 원문 런의 사실 공급이 모은 이야기 사실(2026-09-18) — 재배 편의 훅·CTA 소재. 이야기형 편은 안 쓴다. */
    loreFacts?: string[];
    /** 사용자 첨부 실사진(2026-09-04) — 일부 씬은 이 사진을 그대로 배경으로 쓰고,
     *  나머지 씬은 이 사진들의 색·빛·질감을 참고해 생성한다. */
    userAssets?: string[];
    /** 사용자 첨부 실촬영 영상(2026-09-04) — 길이가 맞는 본문 씬에 클립으로 얹는다. */
    userVideos?: string[];
    /** 영상별 구간 시작점(초, 2026-09-28 로테이션) — 파일 경로 → startSec. 없으면 앞에서 뗀다(종전).
     *  보관소에서 고를 때 파일과 함께 정해 온다. 그래야 비전이 그 구간만 읽고 작가가 실제로 나갈 화면을 보고 쓴다. */
    userVideoStarts?: Record<string, number>;
    /** 형제편 승계 원본(2026-09-03) — 이 쇼츠 id 의 대본·이미지·클립·캘리를 물려받고 낭독만 새로 뜬다.
     *  기획·디자인·이미지 생성·씬 QA·I2V 를 통째로 건너뛴다(편당 비용의 대부분이 이미지다). */
    inheritFrom?: string;
  } = {},
): Promise<void> {
  const store = shortsStore();
  const short = store.get(id);
  if (!short || RUNNING.has(id)) return;
  RUNNING.add(id);
  const dir = store.dirFor(id);
  const io: JobIO = { bus: opts.bus, signal: opts.signal };
  const say = (m: string): void => { console.log(`[숏폼] ${m}`); opts.bus?.emit('log', { message: m }); };
  const checkAbort = (): void => { if (opts.signal?.aborted) throw new Error('취소됨'); };
  try {
    fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
    // 씬 수 — 항상 CONFIG.shortsScenes(기본 5, 2026-09-09 사용자 확정 "씬을 항상 5개").
    // 종전에는 구조 시드(4~6)와 상한 역산(씬당 ~8초)이 정해 4씬이 섞여 나왔다. 명시 요청(opts.sceneCount)만 예외.
    // 채널별 씬 수 차등은 폐기(2026-09-03) — 대본을 공유하므로 채널마다 다를 수 없다.
    const n = Math.min(Math.max(3, opts.sceneCount ?? CONFIG.shortsScenes), 8);

    // 1-a) 형제편 승계(2026-09-03) — 원편이 만든 자산을 물려받고 낭독만 이 편 작가 목소리로 새로 뜬다.
    //      기획·디자인·이미지·씬QA·I2V 를 건너뛴다. 승계가 실패하면(원편 대본 없음) 일반 생성으로 돌아간다.
    const inheritedFrom = opts.inheritFrom ? store.get(opts.inheritFrom) : undefined;
    if (inheritedFrom) {
      const src = store.dirFor(inheritedFrom.id);
      const got = inheritShortsAssets(src, dir);
      if (got.ok) {
        const inheritedPlan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8')) as Plan;
        say(`자산 승계 — ${platformLabel(inheritedFrom.platform)}편(${inheritedFrom.id})에서 ${got.copied.join(' ')} · 대본·이미지 재생성 없음`);
        store.update(id, {
          stage: 'rendering', title: inheritedPlan.title, titles: inheritedPlan.titles,
          description: inheritedPlan.description, hashtags: inheritedPlan.hashtags,
          ...(inheritedPlan.factGate ? { factGate: inheritedPlan.factGate } : {}),
        });
        const inhImages = inheritedSceneImages(dir, inheritedPlan.scenes.length);
        const inhClips = inheritedClips(dir, inheritedPlan.scenes.length);
        say(`승계 자산 — 이미지 ${inhImages.filter(Boolean).length}/${inheritedPlan.scenes.length} · 클립 ${inhClips.filter(Boolean).length}`);
        // 원편이 실촬영을 어느 씬에 놓았는지 그대로 물려받는다(inheritedClips 가 user_NN 우선).
        // 승계분에 실촬영이 없을 때만(원편이 굽기에 실패했을 때) 이 편에서 다시 얹는다.
        const inhWithVideo = inhClips.some((c) => c && path.basename(c).startsWith('user_'))
          ? inhClips
          : await (async () => {
              const inhEst = inheritedPlan.scenes.map((sc) => Math.max(3.5, (sc.narration ?? '').length / SHORTS_TTS_CPS + 0.6));
              const inhVideoScenes = inhEst.filter((_, i) => i > 0 || CONFIG.shortsHookFootage);
              const vs = await Promise.all((opts.userVideos ?? []).map(async (f) => {
                const seconds = await probeDuration(f).catch(() => 0);
                const s0 = Number(opts.userVideoStarts?.[f]);
                const want = Number.isFinite(s0) && s0 > 0 && s0 < seconds ? s0 : 0;
                return { path: f, seconds, startSec: usableStart(seconds, want, inhVideoScenes) };
              }));
              // 본문 경로와 **같은 opts** 를 넘긴다(2026-09-28 리뷰). 가드(usableStart)는 훅 씬을 포함해 "쓸 수 있다"고
              // 판정하는데 배치가 hookFirst·mustUse 없이 돌면 훅에 못 놓고 본문은 첫 실패에서 break 해 **실촬영이 0개**가 된다
              // (실측: 보관소 79개 길이 × 실제 252편 씬 = 26,460 케이스 중 2,760건(10.4%) 누락. 종전 startSec=0 에선 0건).
              // 2026-09-09 "실촬영 누락은 감속보다 나쁘다"를 어기는 자리였다.
              return applyUserSegments(inhClips, planVideoSegments(
                vs.filter((v) => v.seconds > 0), inhEst, new Map(),
                { mustUse: true, hookFirst: CONFIG.shortsHookFootage },
              ), dir, say, opts.signal);
            })();
        await finishShortsRun({
          id, store, dir, short, plan: inheritedPlan, images: inhImages, clips: inhWithVideo,
          opts, say, checkAbort,
          lookOffset: 1, // 원편과 다른 색 — 같은 이미지를 쓰는 만큼 색이라도 갈라야 다른 편으로 읽힌다
        });
        return;
      }
      say(`자산 승계 실패(${inheritedFrom.id} 대본 없음) — 일반 생성으로 진행`);
    }

    // 0) 실촬영 소재 읽기(2026-09-04 사용자 지시) — 대본을 쓰기 전에 화면을 먼저 본다.
    //    종전엔 이게 파이프라인 맨 끝이라 대본·이미지·I2V 를 다 만든 뒤에 화면을 얹었다.
    //    그래서 배정 기준이 길이뿐이었고, 실촬영이 들어갈 씬의 이미지·클립은 만들어 놓고 버렸다.
    const userAssetFiles = (opts.userAssets ?? []).filter((f) => { try { return fs.existsSync(f); } catch { return false; } });
    const userVideoFiles = (opts.userVideos ?? []).filter((f) => { try { return fs.existsSync(f); } catch { return false; } });
    const videoDurations = new Map<string, number>();
    for (const f of userVideoFiles) videoDurations.set(f, await probeDuration(f).catch(() => 0));
    // 구간 시작점(2026-09-28) — 실제 길이를 넘는 값은 버린다(보관소 메타 길이가 틀렸거나 파일이 교체된 경우).
    const startOf = (f: string): number => {
      const s0 = Number(opts.userVideoStarts?.[f]);
      const dur = videoDurations.get(f) ?? 0;
      return Number.isFinite(s0) && s0 > 0 && s0 < dur ? s0 : 0;
    };
    // 비전은 '실제로 나갈 구간'만 읽는다 — 파일 전체를 읽히면 작가가 화면에 없는 장면을 전제로 쓴다(2026-09-04 교훈).
    const briefs = await describeUserMedia([
      ...userAssetFiles.map((f) => ({ file: f, kind: 'image' as const })),
      ...userVideoFiles.filter((f) => (videoDurations.get(f) ?? 0) > 0)
        .map((f) => ({
          file: f, kind: 'video' as const, seconds: videoDurations.get(f)!,
          ...(startOf(f) > 0 ? { startSec: startOf(f), windowSec: windowSceneSec(CONFIG.shortsMaxDurationSec, CONFIG.shortsScenes) + SEGMENT_TAIL_SEC } : {}),
        })),
    ], { topic: short.topic, ...(short.keyword ? { keyword: short.keyword } : {}), ...(opts.signal ? { signal: opts.signal } : {}) });
    if (briefs.length) say(`실촬영 소재 ${briefs.length}건 확인 — ${briefs.map((b) => b.what.slice(0, 28)).join(' · ')}`);
    else if (userAssetFiles.length || userVideoFiles.length) say('실촬영 소재를 읽지 못했다 — 길이 기준으로만 배정한다');
    const hookVideoBriefs = CONFIG.shortsHookFootage ? briefs.filter((b) => b.kind === 'video') : [];

    // 1) 기획 — 대본(훅·씬·내레이션·자막)·제목 3후보·설명·해시태그
    store.update(id, { stage: 'planning' });
    opts.bus?.emit('phase', { team_id: 'shorts', phase: 'work' });
    // 같은 주제 기존 숏폼이 있으면 '관점 다르게' 주입(자기 자신·같은 글 파생 형제 제외).
    const priorCoverage = priorCoverageBrief('숏폼', short.topic, short.keyword, { excludeId: short.id, excludeSourcePieceId: short.sourcePieceId, brandSlug: short.brand });
    // 반복 상투구 회피(2026-08-06) — 화면텍스트·훅 층위 반복은 주제 대조로 안 잡힌다. 최근 숏폼
    // 화면텍스트 코퍼스에서 문서빈도로 채굴해 금지 목록으로 주입(소재어는 stems 보호).
    const ticPhrases = recentPhrasesToAvoid('숏폼', short.brand, { stems: getBrand()?.compoundStems ?? [] });
    const phraseBlock = ticPhrases.length
      ? `[반복 표현 금지] 최근 숏폼들에서 이미 여러 번 쓴 표현이다 — 내레이션·화면텍스트에 쓰지 말고 다른 어휘·접근으로 풀어라: ${ticPhrases.map((p) => `'${p}'`).join(', ')}`
      : '';
    // 훅·CTA 문형 로테이션(2026-08-11) — 훅 질문-반전 공식 7/15편·CTA "계속 기록" 7/15편 실측.
    // 지시문 단독은 새므로 최근 편의 원문을 직접 보여주고 "겹치면 다시 써라"로 못박는다.
    const hooksBlock = recentHooksToAvoid(short.brand, short.id);
    // 제목 유형 로테이션(2026-08-27 권고 5) — 고정 3종(정보형·후킹형·질문형)이 채널 지문이 됐다.
    // 유형 풀 5종에서 런마다 3개, 질문형은 최근 3편 중 1편 이하. off 면 종전 고정 3종.
    const titleTypes = CONFIG.voiceRotation
      ? pickTitleTypes(recentShortsTitles(short.brand, short.id), { keywordFirst: !!short.keyword })
      : ['정보형', '후킹형', '질문형'];
    // 채널 지침(2026-09-03) — 같은 원문에서 유튜브용·인스타용이 서로 다른 대본이 되게 하는 축.
    const platformGuide = platformPlanGuide(short.platform);
    // 작가 문체(2026-09-03) — 편마다 다른 작가가 쓰고 그 작가의 목소리로 읽는다. 레거시는 빈 문자열.
    // 문체 지침은 각 작가 역할의 system_prompt 가 담당한다(company.yaml). 여기서는 어느 역할로
    // 호출할지와 로그 표기만 정한다 — 같은 말을 두 번 주면 서로 어긋날 때 무엇이 이겼는지 못 읽는다.
    const writerProfile = writerById(short.writerId) ?? writerByName(short.writer);
    const writerRole = writerProfile?.id ?? 'shorts_writer';
    // 다른 채널용 형제가 이미 대본을 냈으면 그 훅·제목을 보여주고 겹치지 말라고 못박는다(복원 2026-09-08).
    // 지침만으로는 같은 원문에서 같은 각도가 나온다(두 런이 같은 본문을 본다 — 09-03 실측). 두 번째 채널 런은
    // 첫 채널의 plan.json 을 기다렸다 출발한다(server/main.ts startAfterSiblingPlan).
    const siblingGuide = siblingPlanToAvoid(short);

    const promiseRoom = promiseRoomFor(short);
    if (!promiseRoom.room) say(`예고 금지 — ${promiseRoom.why}`);
    // 훅 화면(2026-10-02) — 보관소 영상 '파일'과 그 비전 묘사가 정확히 하나씩일 때만. 파일이 둘인데 묘사가 하나면
    // hookFirst 가 묘사 못 받은 다른 영상을 씬1에 둘 수 있다(리뷰 지적).
    const hookFootage = userVideoFiles.length === 1 && hookVideoBriefs.length === 1 ? hookVideoBriefs[0]!.what : undefined;
    // 훅 화면이 주제와 어긋나는가(2026-10-05, 호두 두 편 "잎이 안 나요" ↔ 화면 "잎이 무성") — 어긋나면 그 묘사를 작가에게 아예 안 준다.
    // mediaPlanGuide 도 같은 묘사를 "이 장면을 보여 주는 씬을 두라"로 싣기 때문에 거기서도 뺀다(배정은 그대로 — 화면은 씬1 에 나간다).
    const hookConflict = footageContradictsTopic(short.topic, hookFootage);
    if (hookConflict) say(`훅 화면 어긋남 — ${hookConflict} · 묘사 없이 단정형 훅으로`);
    const planBriefs = hookConflict ? briefs.filter((b) => b.what !== hookFootage) : briefs;
    say(`기획 가드 — 채널 ${platformLabel(short.platform)} · 작가 ${writerProfile?.name ?? short.writer ?? '미지정'} · 유사주제 ${priorCoverage ? '주입' : '해당없음'} · 반복표현 ${ticPhrases.length}건 · 훅/CTA 로테이션 ${hooksBlock ? '주입' : '해당없음'} · 형제 대본 ${siblingGuide ? '주입' : '없음'} · 제목 유형 ${titleTypes.join('·')} · 장르 ${shortsGenreOf(short.topic, CONFIG.shortsLore) === 'lore' ? '이야기형' : '하우투'} · 훅 소재 ${shortsGenreOf(short.topic, CONFIG.shortsLore) === 'howto' && CONFIG.shortsLore ? (opts.loreFacts ?? []).length : 0}건`);
    const traceBox: { value?: SceneTrace } = {};
    const planned = await planShorts(io, short.topic, short.keyword, opts.sourceBody, n, [platformGuide, siblingGuide, mediaPlanGuide(planBriefs), priorCoverage, phraseBlock, hooksBlock, OVERUSED_LEXEME_GUIDE].filter(Boolean).join('\n\n'), titleTypes, opts.sourceFlagged ?? [], writerRole,
      recentShortsMainTitles(short.brand, short.id), opts.loreFacts ?? [], // 대표 제목 구조 수렴 차단 · 훅 소재(이야기 사실)
      // 예고 대장 자리 · 훅 화면(2026-10-02) — 보관소 영상이 정확히 1개면 hookFirst 가 그걸 씬1에 놓는다. 여럿이면 어느 게
      // 훅이 될지 기획 시점엔 모르므로 묘사를 주지 않는다(종전 mediaPlanGuide 만).
      {
        promiseRoom: promiseRoom.room, ...(hookFootage && !hookConflict ? { hookFootage } : {}),
        ...(hookConflict ? { hookConflict } : {}), ...(short.platform ? { platform: short.platform } : {}),
        trace: traceBox,
      });
    if (!planned) throw new Error('기획 실패 — 작가 JSON 응답을 해석할 수 없습니다');
    // Plan 타입 재선언 — 길이 상한 루프의 재대입이 클로저(씬 map 등) 내로잉을 풀지 않게 non-null 로 고정.
    let plan: Plan = planned;
    // 씬별 출처(2026-10-05 리뷰) — planShorts 가 쌓은 판본 더미를 잇는다(못 받았으면 지금 대본을 첫 원고로 친다).
    let trace: SceneTrace = traceBox.value ?? traceStart(plan.scenes);
    // 형제 대본 미리보기(2026-10-05 리뷰) — 두 번째 채널 런은 이 편의 제목·훅만 보면 출발할 수 있다. 감량·감량 뒤 수정·흐름 점검·
    // 최종 원문 대조가 붙으며 plan.json 이 늦게 나와 대기 상한(SIBLING_PLAN_WAIT_MS)을 넘길 수 있어, 기획 단계 채택 직후 따로 쓴다.
    // plan.json 을 일찍 쓰지 않는 이유: 수정 요청·예고 대장(promiseRoomFor)·제목 이력·유사 주제가 plan.json 을 '최종본'으로 읽는다.
    writeSiblingPreview(dir, plan);
    // 길이 상한 집행(사용자 확정 2026-08-14: 총 60초 이내) — 예산 초과 대본은 1회 압축.
    const fit = await fitShortsPlanToDuration(io, plan);
    if (fit.compressed) say(`대본 감량 — ${fit.beforeChars}→${fit.afterChars}자(길이 상한 ${CONFIG.shortsMaxDurationSec}초 예산)`);
    plan = fit.plan;
    if (fit.compressed) trace = traceRecord(trace, plan.scenes, '감량', { llm: true, kept: fit.keptScenes });
    // 감량 뒤 재검산(§4-1, 2026-09-18) — fitShortsPlanToDuration 은 감량만 하고 재검산이 없어, 압축이
    // 문체·훅 규칙을 다시 어기거나 CTA 가 되받는 근거 문장을 지워도 그대로 통과했다(실측: "옹이부터
    // 보세요" CTA인데 압축이 옹이를 처음 소개하는 문장을 지워 결론이 허공에 떴다). planShorts 의 1차
    // 검산·수정 라운드가 쓰는 거대한 작가 프롬프트(`user` — 원문·유사주제·문체 가드 수십 줄을 엮은
    // 클로저 지역 변수)는 여기서 재현할 수 없어, 여기는 인덱스 기반 내레이션만 고치는 최소 라운드다 —
    // fitShortsPlanToDuration 자신의 압축 호출과 같은 스키마({"scenes":[{"index":...,"narration":"..."}]})
    // 를 재사용해 kind·stat·quote 등 씬의 나머지 필드는 그대로 보존한다(전체 재파싱은 작가가 안 돌려준
    // 필드를 normalizeSceneKind 가 지운다). topic·keyword·sourceBody 는 short/opts 에서 그대로 꺼낼 수
    // 있어 sourceCore(원문 정합 입력)만은 planShorts 와 동일하게 재구성한다(fix round 1).
    // 원문 정합 대조용 원문 — planShorts 의 sourceForGates 와 같은 값(재배 편은 이야기 사실 줄을 덧붙인다 — 훅 소재가 '원문에 없는 사실'로 안 잡히게).
    const loreSrc = CONFIG.shortsLore && shortsGenreOf(short.topic, CONFIG.shortsLore) === 'howto' ? loreHookSource(opts.loreFacts ?? []) : '';
    const sourceForGates = opts.sourceBody && loreSrc ? `${opts.sourceBody}\n\n${loreSrc}` : opts.sourceBody;
    // 고치는 작가에게 주는 발췌는 근거 미확인 문장을 뺀 판본(2026-10-15, planShorts 와 같은 규칙) — 판정은 sourceForGates.
    const writerBody = opts.sourceBody ? writerSource(opts.sourceBody, opts.sourceFlagged ?? []).body : undefined;
    const sourceForWriter = writerBody && loreSrc ? `${writerBody}\n\n${loreSrc}` : writerBody;
    const budget = Math.floor((CONFIG.shortsMaxDurationSec - 5) * SHORTS_TTS_CPS);
    const budgets = sceneCharBudgets(budget, plan.scenes.length);
    const hookRule = hookConflict ? assertiveHookRule(hookConflict) : '';
    const hookScreenIssues = (p: Plan): string[] => (hookFootage && !hookConflict ? hookFootageIssues(p.scenes[0], hookFootage, p.scenes.slice(1)) : []);
    const sceneTextsWithScreen = (p: Plan): string[] => p.scenes.map((s) => `${s.narration}${s.screenText ? ` (자막: ${s.screenText})` : ''}`
      + (s.takeaways?.length ? ` (결론: ${s.takeaways.map((t) => `${t.when} → ${t.then}`).join(', ')})` : '')
      + (s.items?.length ? ` (목록: ${s.items.join(', ')})` : ''));
    // 화면 글자 월 표기 — planShorts 의 numMonth 와 같은 규칙(고유어 월은 낭독 전용, 키워드 정확 표기가 깨지면 원문 유지).
    const screenMonth = (t: string): string => {
      if (!CONFIG.voiceRotation) return t;
      const o = monthWordOutsideNarration(t);
      return short.keyword && t.includes(short.keyword) && !o.includes(short.keyword) ? t : o;
    };
    if (fit.compressed) {
      // SHORTS_PARTIAL_FIX 가 이 단계 변경 전부를 가른다(2026-10-05 리뷰) — 끄면 종전 경로(원문 핵심 축 검사 포함 재검산, 번호
      // 목록 프롬프트, 전 씬 응답의 내레이션만 병합, 채택 판정 없음) 그대로다.
      const partial = CONFIG.shortsPartialFix;
      // 원문 핵심 축 지적은 이 단계에서 걸지 않는다(2026-10-05, 켬일 때) — 감량본은 축을 고를 단계가 아니고, 그 지적이 수정 라운드에
      // 원문 이름·시기를 끼워 넣게 해 건너뜀을 만들었다(라일락 두 편). 축 검사는 첫 원고 검산(planShorts)이 맡는다.
      // 끔이면 종전대로 planShorts 의 1차 검산과 같은 원문 정합 입력(sourceCoreOf, fix round 1)을 준다.
      const sourceCore = partial ? undefined : sourceCoreOf(short.topic, opts.sourceBody);
      const relint = async (p: Plan): Promise<string[]> => [
        ...compressionRelintProbs(p.scenes, short.keyword),
        ...(await standaloneIssues('유튜브 숏폼 대본(씬 내레이션)',
          p.scenes.map((s) => `${s.narration}${s.takeaways?.length ? ` [화면 결론: ${s.takeaways.map((t) => `${t.when} → ${t.then}`).join(', ')}]` : ''}`),
          short.topic, short.keyword, io.signal, sourceCore)).filter((x) => !partial || !/^원문\s*핵심/.test(x)).slice(0, 3),
      ];
      let relintProbs: string[] = [];
      try {
        relintProbs = await relint(plan);
      } catch { /* fail-open — 검산 판정 자체가 실패하면 '이상 없음'과 동일하게 다룬다 */ }
      // 예산은 try 밖에서 계산해 둔다 — 아래 수정 라운드가 무엇을 하든(성공·부분 실패·예외) 예산 가드는
      // 항상 돈다(fix round 1: 종전엔 이 가드가 수정 라운드와 같은 try 안에 있어, 라운드 중 예외가 나면
      // 늘어난(줄지 않은) 미가드 내레이션이 그대로 남을 수 있었다).
      if (relintProbs.length) {
        say(`감량 뒤 검산 — ${relintProbs.length}건 → 수정`);
        try {
          if (!partial) {
            // 종전 경로(SHORTS_PARTIAL_FIX=false) — 내레이션 번호 목록만 주고 전 씬을 받아 내레이션만 바꾼다(화면 글자는 손대지 않음).
            const cur = plan.scenes.map((s, i) => `${i + 1}. ${s.narration}`).join('\n');
            const j = await callRoleJSON<{ scenes?: Array<{ index?: unknown; narration?: unknown } | null> }>(
              io, writerRole,
              '당신은 유튜브 숏폼 작가입니다. 요청된 JSON 스키마만 출력합니다.',
              [
                '아래 숏폼 대본은 길이 상한을 맞추려 감량한 결과다. 감량 뒤 검산에서 문제가 나왔다 — 내레이션만 고쳐 같은 JSON 스키마로 완결 출력하라(설명 금지).',
                cur,
                `[감량 뒤 검산 실패 — 아래 문제를 고쳐라]\n${relintProbs.map((p) => `- ${p}`).join('\n')}`,
                `[예산] 모든 씬 내레이션 합계 ${budget}자 이내를 반드시 지켜라`,
                'JSON 형식: {"scenes":[{"index":씬번호,"narration":"..."}]} — 전 씬 포함.',
              ].join('\n\n'), 1600, false,
            ).catch(() => null);
            if (j?.scenes) {
              let out = mergeNarrationOnly(plan, j.scenes);
              // 압축과 같은 실측 대응(fix round 1) — 감량 뒤 수정 라운드도 유보어를 지워 결론을 반전시킬 수
              // 있다. fitShortsPlanToDuration 의 같은 처리(restoreLostHedges 호출부)와 같은 모양으로 둔다.
              try {
                const hedged = restoreLostHedges(plan, out);
                if (hedged.restored.length) { out = hedged.plan; say(`감량 뒤 검산 — 유보어 소실 씬 ${hedged.restored.join(',')} 원문장 복원`); }
              } catch { /* fail-open — 복원 실패로 수정 라운드 자체를 막지 않는다 */ }
              plan = out;
              trace = traceRecord(trace, plan.scenes, '감량 뒤 수정', { llm: true });
            }
          } else {
            // 감량 뒤 수정(2026-10-05) — 원문 발췌와 화면 글자(자막·결론 카드·목록)를 함께 주고 고친 씬만 받는다(부분 수정과 같은 병합).
            // 종전엔 내레이션 번호 목록만 줘서 작가가 원문 없이 사실을 지었고(산딸나무 CTA), 자막이 옛 내용으로 남았다(모과 "꽃말은 평범").
            // 결론 카드·목록은 응답이 빠뜨려도 지우지 않는다 — 새 내레이션과 어긋날 때만 지운다(cards:'keepUnlessDiverged', 리뷰).
            const hookEditable = problemsTargetHook(relintProbs);
            const j = await callRoleJSON<PartialFix>(io, writerRole, '당신은 유튜브 숏폼 작가입니다. 요청된 JSON 스키마만 출력합니다.',
              partialFixPrompt({
                scenes: plan.scenes, problems: relintProbs, budgets, stage: 'compressed', hookEditable,
                ...(sourceForWriter ? { sourceExcerpt: sourceForWriter.slice(0, PARITY_SOURCE_CHARS) } : {}),
                ...(opts.sourceFlagged?.length ? { flagged: opts.sourceFlagged } : {}),
                ...(hookRule ? { hookRule } : {}), ...(short.keyword ? { keyword: short.keyword } : {}),
              }), 1600, false).catch(() => null);
            const merged = mergePartialFix(plan, j, {
              hookEditable, budgets, budgetChars: budget, fixScreen: screenMonth, cards: 'keepUnlessDiverged',
              ...(short.keyword ? { keyword: short.keyword } : {}), ...(hookConflict ? { hookReject: FOOTAGE_DEICTIC_RE } : {}),
            });
            let out = merged.plan;
            const cardNote = merged.droppedCards.length ? ` · 화면 카드 해제(새 내레이션과 어긋남) 씬 ${merged.droppedCards.join(',')}` : '';
            if (merged.changed.length) say(`감량 뒤 수정 — 씬 ${merged.changed.join(',')}${cardNote}${merged.rejected.length ? ` · 거절 ${merged.rejected.slice(0, 3).join(' / ')}` : ''}`);
            // 압축과 같은 실측 대응(fix round 1) — 감량 뒤 수정 라운드도 유보어를 지워 결론을 반전시킬 수
            // 있다. fitShortsPlanToDuration 의 같은 처리(restoreLostHedges 호출부)와 같은 모양으로 둔다.
            try {
              const hedged = restoreLostHedges(plan, out);
              if (hedged.restored.length) { out = hedged.plan; say(`감량 뒤 검산 — 유보어 소실 씬 ${hedged.restored.join(',')} 원문장 복원`); }
            } catch { /* fail-open — 복원 실패로 수정 라운드 자체를 막지 않는다 */ }
            // 채택 판정(2026-10-05 리뷰) — 기획 단계 부분 수정과 같은 기준: 같은 검사 묶음(결정적 린트 + 단독 이해)을 다시 돌려
            // 문제가 늘었거나 바꾼 씬에 새 건너뜀이 생기면 감량본을 그대로 둔다. 재검산 실패도 '모름'이라 채택하지 않는다.
            if (merged.changed.length) {
              const after = await relint(out).catch(() => null);
              const v = after ? partialFixVerdict(relintProbs, after, merged.changed) : { accept: false, why: '재검산 실패' };
              say(`감량 뒤 수정 판정 — ${v.accept ? '채택' : '감량본 유지'}(${v.why})`);
              if (v.accept) {
                plan = out;
                trace = traceRecord(trace, plan.scenes, '감량 뒤 수정', { llm: true });
              }
            }
          }
        } catch { /* fail-open — 수정 라운드 실패 시 감량 결과를 그대로 쓴다(아래 예산 가드는 그대로 돈다) */ }
        // 결정적 마감 — 수정 라운드가 실패·부분 이행했어도 예산은 여기서 반드시 보장한다(try 밖, 무조건 실행).
        if (shortsNarrationChars(plan) > budget) {
          const t = trimPlanToBudget(plan, budget, CONFIG.shortsScenes);
          plan = t.plan;
          trace = traceRecord(trace, plan.scenes, '트리밍', { llm: false, kept: t.keptScenes });
        }
      } else {
        say('감량 뒤 검산 — 이상 없음');
      }
    }
    // 최종 흐름 점검(2026-10-05, SHORTS_FLOW_CHECK) — 감량·트리밍·감량 뒤 수정까지 끝난 대본의 이음새를 LLM 1회로 보고, 끊긴 이음
    // 문장만 고친다(훅 제외·예산 안에서만·최대 1회). 11편 분석에서 최종본 건너뜀 17/44 의 대부분은 앞 단계가 문장을 빼거나 바꾸며 생겼다 —
    // 앞 단계를 고쳐도 남는 것을 마지막에 한 번 잇는다. 고친 결과가 결정적 린트를 늘리거나 유보어를 지우면 그 수정은 버린다.
    if (CONFIG.shortsFlowCheck && plan.scenes.length >= 3) {
      try {
        const j = await microJSON<PartialFix & { transitions?: unknown; breaks?: unknown }>(stdModel(), '당신은 숏폼 대본 에디터입니다. 요청된 JSON 스키마만 출력합니다.',
          flowCheckPrompt({
            scenes: plan.scenes, budgets, ...(short.keyword ? { keyword: short.keyword } : {}), ...(hookRule ? { hookRule } : {}),
            // 짧은 원문 발췌(2026-10-05 리뷰) — 이음 말을 고를 때 원문 밖 말을 지어내지 않게. 판정은 아래 최종 원문 대조가 한다.
            ...(sourceForWriter ? { sourceExcerpt: sourceForWriter.slice(0, 1500) } : {}),
          }),
          { maxOutputTokens: 1400, signal: io.signal });
        const breaks = flowBreaks(j);
        const allowed = flowFixScenes(breaks, plan.scenes.length);
        if (!allowed.length) say('흐름 점검 — 끊긴 이음새 없음');
        else {
          // 화면 글자는 그대로(cards:'keep', 2026-10-05 리뷰) — 흐름 점검은 이음 말만 바꾼다. 종전 병합은 카드 없이 온 CTA 수정에
          // 결론 카드·자막을 지웠다(실측 산딸 droppedCards=[5]).
          const merged = mergePartialFix(plan, { scenes: j?.scenes ?? [] }, {
            hookEditable: false, budgets, budgetChars: budget, onlyScenes: allowed, fixScreen: screenMonth, cards: 'keep',
            ...(short.keyword ? { keyword: short.keyword } : {}),
          });
          const cardNote = merged.droppedCards.length ? ` · 화면 카드 해제 씬 ${merged.droppedCards.join(',')}` : '';
          let out = merged.plan;
          const hedged = restoreLostHedges(plan, out);
          if (hedged.restored.length) out = hedged.plan;
          const lint = (p: Plan): number => compressionRelintProbs(p.scenes, short.keyword).length;
          if (merged.changed.length && lint(out) > lint(plan)) {
            say(`흐름 점검 — 수정이 문체·훅 린트를 늘려 버림(끊김 ${breaks.map((b) => `${b.at}→${b.at + 1}`).join(',')})${cardNote}`);
          } else if (merged.changed.length) {
            plan = out;
            trace = traceRecord(trace, plan.scenes, '흐름 점검', { llm: true });
            say(`흐름 점검 — 끊김 ${breaks.map((b) => `${b.at}→${b.at + 1}`).join(',')} · 씬 ${merged.changed.join(',')} 이음 문장 수정${cardNote}${merged.rejected.length ? ` · 거절 ${merged.rejected.slice(0, 2).join(' / ')}` : ''}`);
          } else say(`흐름 점검 — 끊김 ${breaks.map((b) => `${b.at}→${b.at + 1}`).join(',')} · 유효 수정 없음${merged.rejected.length ? `(${merged.rejected.slice(0, 2).join(' / ')})` : ''}`);
        }
      } catch { say('흐름 점검 실패 — 대본 그대로 진행'); }
    }
    // 최종 원문 대조(2026-10-05 리뷰, FACT_GATE 아래) — 기획 파이프라인 끝(흐름 점검 뒤, plan.json·낭독 전)에서 한 번. 첫 원고 뒤 LLM
    // 단계(부분 수정·통째 재집필·감량·감량 뒤 수정·흐름 점검)가 바꿨는데 대조를 못 받은 씬이 있을 때만 돈다(traceNeedsParity).
    // 지적된 씬 중 바뀐 씬은 가장 최근 통과 판본(없으면 지적 없던 첫 원고 판본)으로 되돌리고, 나머지 지적(바뀐 적 없는 씬·되돌릴
    // 판본 없음·씬 번호 불명)은 factGate.unsupported 에 보류(hold)로 싣는다 — 종전 단계별 factRecheck 는 이것들을 버렸다.
    // fail-open: 판정 실패면 대본은 그대로 두고 판정 실패(error)로 표시한다(이미 hold 면 그대로). 숏폼 factGate 는 표시 전용이다
    // (텔레그램 검토 메시지) — 업로드를 막지 않는다.
    if (CONFIG.factGate && sourceForGates && traceNeedsParity(trace)) {
      const issues = await parityIssuesChecked('유튜브 숏폼 대본(씬 내레이션)', sceneTextsWithScreen(plan), sourceForGates, io.signal).catch(() => null);
      if (!issues) {
        plan = { ...plan, factGate: finalFactGate(plan.factGate, null) };
        say('최종 원문 대조 실패 — 대본 그대로 진행(판정 실패 표시)');
      } else {
        const r = finalParityRevert(trace, plan.scenes, issues, hookConflict ? { hookReject: FOOTAGE_DEICTIC_RE } : {});
        if (r.reverted.length) {
          const pre = plan;
          plan = { ...plan, scenes: r.scenes };
          // 옛 판본이 되살린 것을 다시 거른다 — 원문에 없는 오버레이 수치·출처 라벨, 길이 예산, 예고 정리(모두 결정적).
          const st = stripUnsourcedStatOverlays(plan.scenes, sourceForGates);
          if (st.removed.length) plan = { ...plan, scenes: st.scenes };
          plan = pruneQuoteSources(plan, sourceForGates).plan;
          if (shortsNarrationChars(plan) > budget) plan = trimPlanToBudget(plan, budget, CONFIG.shortsScenes).plan;
          const se = settleNextEpisode(plan, promiseRoom.room);
          if (se.note) plan = se.plan;
          const lost = lostCards(pre, plan);
          say(`최종 원문 대조 — 씬 ${r.reverted.map((x) => `${x.scene}(${x.from}→${x.to})`).join(', ')} 되돌림${lost.length ? ` · 화면 카드 사라짐 씬 ${lost.join(',')}` : ''} (${issues[0]?.slice(0, 50)})`);
        }
        // 시기·수치·승계 잔존도 최종 대본으로 다시 센다(결정적) — planShorts 의 값은 감량 전 대본 기준이다.
        const display = [
          ...timingParityIssues(sourceForGates, timingFields(plan)).map(formatTimingIssue),
          ...(opts.sourceFlagged?.length ? inheritedClaims(opts.sourceFlagged, timingFields(plan), 5, opts.sourceBody) : []).map(formatInherited),
          ...hookScreenIssues(plan),
        ];
        const fg = finalFactGate(plan.factGate, { remaining: r.remaining, display });
        if (fg) plan = { ...plan, factGate: fg };
        say(r.remaining.length
          ? `최종 원문 대조 — 잔존 ${r.remaining.length}건 보류(검토 메시지에 표시): ${r.remaining[0]!.slice(0, 50)}`
          : `최종 원문 대조 — 잔존 없음${r.reverted.length ? '(되돌림 뒤)' : ''}`);
      }
    }
    // 보내기 전 추가 수정(2026-10-14 사장님 확정, PRE_NOTIFY_RESOLVE) — 위 단계까지 거치고도 원문 정합 보류·시기·수치·승계 줄이
    // 남으면, 텔레그램에 "확인해 달라"고 넘기기 전에 그 문장만 최대 2번 더 고치고 다시 대조한다. 낭독·렌더 전이라 영상 재생성 비용이 없다.
    // 채택은 남은 문제가 엄격히 줄고 린트가 늘지 않을 때만(preNotifyAccept) — 아니면 앞 판본 그대로. 원문 대조를 받은 수정만 남는다.
    // 훅 글 ↔ 훅 화면(2026-10-15) — 감량·흐름·되돌림을 거친 최종 훅이 실촬영과 어긋나면 검토 줄로 싣는다(아래 보내기 전 수정이 씬1 을 고친다).
    {
      const hs = hookScreenIssues(plan);
      const prev = plan.factGate?.timing ?? [];
      if (hs.length && !prev.some((x) => hs.includes(x))) {
        plan = { ...plan, factGate: { ...(plan.factGate ?? parityToInfo([])), timing: [...prev, ...hs] } };
        say(`훅 화면 어긋남 — ${hs[0]!.slice(0, 70)}`);
      }
    }
    // 사실 수정 여유(2026-10-15 사장님 선택 "사실 수정에만 여유 3초") — 재현 실측: 보류 8편 중 5편에서 작가가 원문 조건을 되살린
    // 옳은 수정이 '예산 초과·상한 초과'로 버려졌다(대본이 이미 212자 예산에 꽉 차 있다). 이 단계는 원문 대조 문제만 고치므로
    // 씬 상한·대본 예산을 낭독 3초 몫만큼 넓힌다 — 35초 상한 안(예산은 상한 −5초에서 잡는다).
    const FACT_SLACK = Math.round(3 * SHORTS_TTS_CPS);
    const factBudget = budget + FACT_SLACK;
    if (CONFIG.preNotifyResolve && sourceForGates && !io.signal?.aborted) {
      const label = '유튜브 숏폼 대본(씬 내레이션)';
      const lint = (p: Plan): number => compressionRelintProbs(p.scenes, short.keyword).length;
      for (let round = 1; round <= 2; round++) {
        const problems = preNotifyProblems(plan.factGate);
        if (!problems.length) break;
        try {
          const hookEditable = problemsTargetHook(problems);
          const j = await callRoleJSON<PartialFix>(io, writerRole, '당신은 유튜브 숏폼 작가입니다. 요청된 JSON 스키마만 출력합니다.',
            partialFixPrompt({
              scenes: plan.scenes, problems, budgets, stage: 'plan', hookEditable, description: plan.description, factSlack: FACT_SLACK,
              sourceExcerpt: (sourceForWriter ?? sourceForGates).slice(0, PARITY_SOURCE_CHARS),
              ...(opts.sourceFlagged?.length ? { flagged: opts.sourceFlagged } : {}),
              ...(hookRule ? { hookRule } : {}), ...(short.keyword ? { keyword: short.keyword } : {}),
            }), 1600, false).catch(() => null);
          const merged = mergePartialFix(plan, j, {
            hookEditable, budgets, budgetChars: factBudget, slackChars: FACT_SLACK, fixScreen: screenMonth,
            ...(short.keyword ? { keyword: short.keyword } : {}), ...(hookConflict ? { hookReject: FOOTAGE_DEICTIC_RE } : {}),
          });
          if (!merged.changed.length && !merged.descriptionChanged) { say(`보내기 전 추가 수정 ${round}회 — 고친 씬 없음(잔존 ${problems.length}건 그대로${merged.rejected.length ? ` · 거절 ${merged.rejected.slice(0, 2).join(' / ')}` : ''})`); break; }
          let out = restoreLostHedges(plan, merged.plan).plan;
          // 되돌림 경로와 같은 결정적 뒷정리 — 원문에 없는 오버레이 수치·출처 라벨, 길이 예산(사실 여유 포함), 예고 정리.
          const st = stripUnsourcedStatOverlays(out.scenes, sourceForGates);
          if (st.removed.length) out = { ...out, scenes: st.scenes };
          out = pruneQuoteSources(out, sourceForGates).plan;
          if (shortsNarrationChars(out) > factBudget) out = trimPlanToBudget(out, factBudget, CONFIG.shortsScenes).plan;
          const se = settleNextEpisode(out, promiseRoom.room);
          if (se.note) out = se.plan;
          const issues = CONFIG.factGate ? await parityIssuesChecked(label, sceneTextsWithScreen(out), sourceForGates, io.signal).catch(() => null) : [];
          if (!issues) { say(`보내기 전 추가 수정 ${round}회 — 재대조 실패, 앞 판본 유지`); break; }
          const display = [
            ...timingParityIssues(sourceForGates, timingFields(out)).map(formatTimingIssue),
            ...(opts.sourceFlagged?.length ? inheritedClaims(opts.sourceFlagged, timingFields(out), 5, opts.sourceBody) : []).map(formatInherited),
            ...hookScreenIssues(out),
          ];
          const after = issues.length + display.length;
          if (!preNotifyAccept(problems.length, after, lint(plan), lint(out))) {
            say(`보내기 전 추가 수정 ${round}회 — 잔존 ${problems.length}→${after}건, 린트 ${lint(plan)}→${lint(out)} · 앞 판본 유지`);
            break;
          }
          plan = { ...out, factGate: finalFactGate(plan.factGate, { remaining: issues, display }) };
          trace = traceMarkParity(traceRecord(trace, plan.scenes, '보내기 전 추가 수정', { llm: true }), issues);
          say(`보내기 전 추가 수정 ${round}회 — 잔존 ${problems.length}→${after}건 채택(씬 ${merged.changed.join(',') || '설명'})`);
        } catch { say(`보내기 전 추가 수정 ${round}회 — 실패, 앞 판본 유지`); break; }
      }
      // 남는 왜곡은 원문 문장으로(2026-10-15 사장님 선택 "원문 문장으로 바꾸기") — 수정을 다 거쳤는데도 원문 정합 보류가 남으면
      // 두 번 더 판정해 세 번 중 두 번 이상 지목된 씬만(판정 흔들림 제외) 원문 문장을 거의 그대로 옮긴 문장으로 바꾼다.
      // 옮겼는지는 코드가 원문과 글자 단위로 대조하고(isNearLiteral), 바꾼 뒤 다시 판정해 그 씬 지적이 사라질 때만 채택한다.
      if (CONFIG.factGate && plan.factGate?.status === 'hold' && plan.factGate.unsupported.length && !io.signal?.aborted) {
        try {
          const cur = plan.factGate.unsupported;
          const more = await Promise.all([0, 1].map(() => parityIssuesChecked(label, sceneTextsWithScreen(plan), sourceForGates, io.signal).catch(() => null)));
          const targets = stableProblemScenes([cur, ...more], plan.scenes.length);
          if (!targets.length) say('원문 문장 옮기기 — 세 판정 중 두 번 이상 같은 씬 지적 없음(판정 흔들림), 건너뜀');
          else {
            const caps = Object.fromEntries(targets.map((k) => [k, sceneBudgetAt(budgets, k - 1, plan.scenes.length) + FACT_SLACK]));
            const probs = [...new Set([cur, ...more].flatMap((l) => l ?? []).filter((x) => targets.includes(problemScene(x) ?? -1)))].slice(0, 6);
            const j = await callRoleJSON<PartialFix>(io, writerRole, '당신은 유튜브 숏폼 작가입니다. 요청된 JSON 스키마만 출력합니다.',
              literalFixPrompt({ scenes: plan.scenes, targets, problems: probs, source: (sourceForWriter ?? sourceForGates).slice(0, PARITY_SOURCE_CHARS), caps, ...(short.keyword ? { keyword: short.keyword } : {}) }), 1200, false).catch(() => null);
            const cand = (j?.scenes ?? []).filter((x): x is NonNullable<typeof x> => !!x && targets.includes(Number(x.index)) && typeof x.narration === 'string');
            // 작가용 원문(근거 미확인 문장을 뺀 판본)과 대조 — 원문 전체와 대조하면 뺀 문장을 다시 옮겨 와도 '원문 일치'로 통과한다.
            const lit = cand.filter((x) => isNearLiteral(String(x.narration), sourceForWriter ?? sourceForGates));
            const merged = mergePartialFix(plan, { scenes: lit }, {
              hookEditable: targets.includes(1), budgets, budgetChars: factBudget, slackChars: FACT_SLACK, fixScreen: screenMonth, onlyScenes: targets,
              ...(short.keyword ? { keyword: short.keyword } : {}), ...(hookConflict ? { hookReject: FOOTAGE_DEICTIC_RE } : {}),
            });
            const why = [cand.length > lit.length ? `원문과 거리 먼 답 ${cand.length - lit.length}` : '', ...merged.rejected.slice(0, 2)].filter(Boolean).join(' · ');
            if (!merged.changed.length) say(`원문 문장 옮기기 — 씬 ${targets.join(',')} 바꾸지 못함${why ? ` (${why})` : ''}`);
            else {
              let out = merged.plan;
              const st = stripUnsourcedStatOverlays(out.scenes, sourceForGates);
              if (st.removed.length) out = { ...out, scenes: st.scenes };
              out = pruneQuoteSources(out, sourceForGates).plan;
              if (shortsNarrationChars(out) > factBudget) out = trimPlanToBudget(out, factBudget, CONFIG.shortsScenes).plan;
              const issues = await parityIssuesChecked(label, sceneTextsWithScreen(out), sourceForGates, io.signal).catch(() => null);
              const left = issues ? issues.filter((x) => merged.changed.includes(problemScene(x) ?? -1)).length : -1;
              // 채택 비교는 원문 정합 + 표시 줄(시기·수치·승계·훅 화면) 합계 — 옮긴 문장이 승계·훅 줄을 새로 만들면 안 된다.
              const display = [
                ...timingParityIssues(sourceForGates, timingFields(out)).map(formatTimingIssue),
                ...(opts.sourceFlagged?.length ? inheritedClaims(opts.sourceFlagged, timingFields(out), 5, opts.sourceBody) : []).map(formatInherited),
                ...hookScreenIssues(out),
              ];
              const before = cur.length + (plan.factGate.timing?.length ?? 0);
              if (!issues) say('원문 문장 옮기기 — 재대조 실패, 앞 판본 유지');
              else if (left === 0 && issues.length + display.length <= before && lint(out) <= lint(plan)) {
                plan = { ...out, factGate: finalFactGate(plan.factGate, { remaining: issues, display }) };
                trace = traceMarkParity(traceRecord(trace, plan.scenes, '원문 문장 옮기기', { llm: true }), issues);
                say(`원문 문장 옮기기 — 씬 ${merged.changed.join(',')} 채택 · 잔존 ${cur.length}→${issues.length}건`);
              } else say(`원문 문장 옮기기 — 씬 ${merged.changed.join(',')} 지적 ${left}건 남음·잔존 ${before}→${issues.length + display.length}건, 앞 판본 유지`);
            }
          }
        } catch { say('원문 문장 옮기기 — 실패, 앞 판본 유지'); }
      }
    }
    // 빈 연출 메우기(2026-09-04) — kind 만 오고 내용이 빈 씬은 화면에 아무것도 못 그린다.
    // 지시문은 이미 예시까지 붙여 뒀는데도 샜다. 메우고, 못 메우면 kind 를 뗀다(repairEmptyKinds 주석 참조).
    const repaired = await repairEmptyKinds(io, plan);
    if (repaired.filled.length || repaired.dropped.length) {
      plan = repaired.plan;
      say(`빈 연출 수선 — ${repaired.filled.length ? `씬 ${repaired.filled.join(',')} 채움` : ''}${repaired.filled.length && repaired.dropped.length ? ' · ' : ''}${repaired.dropped.length ? `씬 ${repaired.dropped.join(',')} 연출 해제(내용을 못 채움)` : ''}`);
    }
    // 결론 예고(2026-09-18, SHORTS_TEASER) — CTA 첫 조건을 본문 첫 씬에 실어 "끝에 무엇이 나오는지"만 보여 준다(답은 감춘다).
    // 가운데 카드 연출(list·chart 등)이 있는 씬은 건너뛴다(teaserSceneIndex) — 카드끼리 겹친다. 후보가 없으면 카드 없음.
    // plan.json 에 담아야 재조립·승계·미리보기가 같은 카드를 본다. takeaways 없는 편은 필드도 없다(종전 렌더 그대로).
    if (CONFIG.shortsTeaser) {
      const t = teaserFor(plan.scenes);
      const at = teaserSceneIndex(plan.scenes);
      if (t && at !== undefined && plan.scenes[at]) plan.scenes[at] = { ...plan.scenes[at], teaser: t };
    }
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
    // 본문 적용률만 본다 — 훅·CTA 는 프롬프트가 항상 붙이라 한 자리라 세어 봐야 규칙 위반이 안 드러난다.
    const cov = bodyKindCoverage(plan.scenes);
    const emptyKinds = emptyKindScenes(plan.scenes);
    say(`대본 완성 — ${plan.title.slice(0, 30)} · 씬 ${plan.scenes.length}개 · 낭독 ~${Math.round(shortsNarrationChars(plan) / SHORTS_TTS_CPS)}초 추정 · 본문 연출 ${cov.withKind}/${cov.body}${cov.kinds.length ? `(${cov.kinds.join('·')})` : ''}`);
    // '본문 씬 최소 1개' 규칙 위반 — 배경과 자막만으로 흐르는 영상이 된다. 무음 시청자에게 남는 게 없다.
    if (cov.body > 0 && cov.withKind === 0) say('본문 연출 없음 — 배경+자막만으로 렌더된다(본문 최소 1개 규칙 미달)');
    // 선언만 하고 페이로드를 안 채운 씬 — 화면에 아무것도 안 그려진다. 지시문이 안 먹은 신호다.
    if (emptyKinds.length) say(`연출 페이로드 누락 — ${emptyKinds.map((e) => `씬${e.index}(${e.kind})`).join(' ')} · 화면 요소 없이 렌더된다`);
    checkAbort();

    // 2) 디자인 — 씬별 세로 비주얼 프롬프트(전 씬 일관 스타일 + 장면 변주)
    store.update(id, {
      stage: 'designing', title: plan.title, titles: plan.titles,
      description: plan.description, hashtags: plan.hashtags,
      ...(plan.factGate ? { factGate: plan.factGate } : {}),
    });
    // 디렉터를 engaged 웨이브에 배선 — standby 팀은 org 와 달리 delegation 이벤트가 없어,
    // 디자인 단계 내내 오피스가 디렉터를 유휴·배회로 그리고 WORKING 칩도 0 이었다(수선 2026-08-12).
    opts.bus?.emit('delegation', { team_id: 'shorts', from: 'shorts_writer', to: 'shorts_director', summary: '씬 비주얼 연출' });
    const design = await designScenes(io, short.topic, plan, short.keyword, opts.sourceBody);
    { const n = design.musts.filter(Boolean).length; if (n) say(`원문 묘사 — ${n}씬에 꼭 보일 것·나오면 안 될 것 지정`); }
    say(`디자인 확정 — ${design.preset} · ${design.style.slice(0, 40)}`);
    checkAbort();

    // 3) 씬 이미지 — 세로 1024×1536, 무텍스트(자막·내레이션은 렌더러가 얹음)
    store.update(id, { stage: 'rendering' });
    opts.bus?.emit('phase', { team_id: 'shorts', phase: 'integrate' });
    // 소재 → 씬 배정(2026-09-04) — 대본이 나왔으니 내레이션과 소재 설명을 나란히 놓고 고른다.
    // 이 배정이 정해져야 '어느 씬을 생성하지 않을지'가 정해진다. 실패하면 길이 기준으로 떨어진다.
    const mediaAt = await assignMediaToScenes(briefs, plan.scenes, {
      ...(opts.signal ? { signal: opts.signal } : {}), hookFirst: CONFIG.shortsHookFootage,
    });
    const ordered = orderAssetsByAssignment(userAssetFiles, mediaAt, plan.scenes.length);
    // 영상 배정을 사진보다 먼저 정한다(2026-09-18) — 훅(0)에 실사를 채울 우선순위는 영상이 사진보다
    // 높다(움직임·클로즈업). 영상이 훅을 채우면 사진의 훅 예약은 필요 없다.
    // 씬 길이는 낭독 실측 전이라 자수로 추정한다(렌더러의 sceneDurationSec 와 같은 산식).
    const sceneEst = plan.scenes.map((sc) => Math.max(3.5, (sc.narration ?? '').length / SHORTS_TTS_CPS + 0.6));
    const videoPrefer = new Map<string, number>();
    for (const f of userVideoFiles) { const at = mediaAt.get(f); if (at !== undefined) videoPrefer.set(f, at); }
    // 구간이 이 편의 어떤 씬도 못 채우면 앞으로 되돌린다 — mustUse 가 강제 배치하면 0.5배 밑 감속이 걸린다(usableStart).
    const videoScenes = sceneEst.filter((_, i) => i > 0 || CONFIG.shortsHookFootage);
    const startHere = (f: string): number => usableStart(videoDurations.get(f) ?? 0, startOf(f), videoScenes);
    for (const f of userVideoFiles) {
      if (startOf(f) > 0 && startHere(f) === 0) say(`실촬영 구간 되돌림 — ${startOf(f)}초 뒤가 이 편의 씬을 못 채운다(앞에서 뗀다)`);
    }
    const videoPlan = planVideoSegments(
      userVideoFiles.map((f) => ({ path: f, seconds: videoDurations.get(f) ?? 0, startSec: startHere(f) })).filter((v) => v.seconds > 0),
      sceneEst, videoPrefer, { mustUse: true, hookFirst: CONFIG.shortsHookFootage }, // 보관소 영상 1개는 반드시 들어간다(사용자 확정 2026-09-08)
    );
    // 훅 화면 약속 점검(2026-10-02) — 작가는 이 영상이 씬1에 나간다고 듣고 훅을 썼다. 배치가 어긋났거나 구간이 되돌려졌으면
    // 훅 내레이션이 다른 화면을 가리킬 수 있다 — 막지는 않고(디렉터가 훅 이미지를 내레이션에 맞춰 그린다) 흔적을 남긴다.
    if (hookFootage) {
      const v0 = videoPlan[0];
      if (!v0 || v0.path !== userVideoFiles[0]) say('훅 화면 어긋남 — 작가에게 알린 실촬영이 씬1에 배치되지 않았다(훅 이미지로 대체)');
      else if (startHere(v0.path) !== startOf(v0.path)) say('훅 화면 어긋남 — 실촬영 구간이 앞으로 되돌려져 묘사한 구간과 다르다');
    }
    const rotated = videoPlan.filter((v) => v && v.startSec > 0).length;
    if (rotated) say(`실촬영 구간 로테이션 — ${rotated}씬이 영상 앞이 아닌 구간(${videoPlan.filter(Boolean).map((v) => `${v!.startSec}초`).join(' · ')})`);
    // 사진은 영상이 훅을 하나도 못 채웠을 때만 훅을 예약한다 — 영상이 우선이다.
    const assetPlan = planAssetScenes(ordered.assets, plan.scenes.length, ordered.order, {
      hookFirst: CONFIG.shortsHookFootage && !videoPlan.some(Boolean),
    });
    // 보관소 사진은 참조로도 쓰지 않는다(사용자 확정 2026-09-08 "보관소 이미지는 무시") — 종 참조는 보관소 영상 프레임 한 장뿐.
    // 컴포저에 직접 첨부한 사진(userAssets)만 종전대로 배경·톤 참조로 쓴다.
    const refPaths = styleRefs(ordered.assets, assetPlan);
    // 종 레퍼런스(2026-09-06) — 보관소에 이 수종 소재가 있으면 실물 한 장을 참조로 붙인다.
    // 사진이 없고 영상만 있는 경우가 대부분이라(대추나무가 그랬다) 프레임을 뽑아 쓴다.
    // 이게 없으면 앵커에 형태를 다 적어도 종이 틀린다 — 실측으로 확인했다.
    let speciesRefPath: string | null = null;
    if (!refPaths.length && userVideoFiles.length) {
      const src = userVideoFiles.find((f) => (videoDurations.get(f) ?? 0) > 0);
      if (src) {
        speciesRefPath = await speciesRefFrame(src, videoDurations.get(src) ?? 0, path.join(dir, 'refs'), opts.signal);
        if (speciesRefPath) say('종 레퍼런스 — 보관소 영상에서 실물 프레임 1장 첨부');
      }
    } else if (refPaths.length) {
      speciesRefPath = refPaths[0] ?? null; // 올린 사진이 있으면 그게 곧 실물이다
    }
    const genRefs = speciesRefPath ? [...new Set([speciesRefPath, ...refPaths])].slice(0, 4) : refPaths;
    if (videoPlan.some(Boolean) && ![...videoPrefer.entries()].some(([f, at]) => videoPlan[at]?.path === f)) {
      say(`실촬영 배정 보정 — 감독 배정이 무효(훅·범위 밖·길이 미달)라 씬 ${videoPlan.findIndex(Boolean) + 1}에 길이 규칙으로 넣음`);
    }
    // 실촬영이 덮는 씬 — 이미지도 I2V 도 만들지 않는다. 만들어 놓고 버리던 것이 헛돈이었다.
    const covered = new Set<number>();
    assetPlan.forEach((a, i) => { if (a) covered.add(i); });
    videoPlan.forEach((v, i) => { if (v) covered.add(i); });
    const slotScenes = plan.scenes.map((_, i) => i).filter((i) => !covered.has(i));
    // 실촬영이 한 씬이라도 들어가면 I2V 계열(모션 디렉팅·사람 판별·클립 생성)을 통째로 건너뛴다
    // (사용자 확정 2026-09-04). 셋 다 I2V 전용이라, I2V 를 안 만들면 비전 호출도 낭비다.
    const hasRealFootage = videoPlan.some(Boolean);
    if (userAssetFiles.length || userVideoFiles.length) {
      say(`실촬영 배정 — 사진 ${assetPlan.filter(Boolean).length}씬 · 영상 ${videoPlan.filter(Boolean).length}씬${covered.size ? ` · 이미지 ${covered.size}장 생성 안 함` : ''}`);
    }
    say(`씬 이미지 생성 시작 — ${CONFIG.openaiImageModel} 세로 ${slotScenes.length}장${covered.size ? ` (전체 ${plan.scenes.length}씬 중 ${covered.size}씬은 실촬영)` : ''}`);
    // 프롬프트는 '씬 번호대로' 한 벌 만든다 — 이 배열이 여러 곳의 기준이다.
    //  · bg-draft.json 은 전 씬을 담는다. 수정요청 재생성이 slots[씬번호-1] 로 읽고(위 applyRevision),
    //    씬 QA 재생성도 scenePrompts[원본 씬번호] 로 읽는다. 여기서 슬롯을 줄이면 그 둘이 어긋나
    //    엉뚱한 씬의 프롬프트로 좋은 이미지를 덮어쓴다.
    //  · 생성에 넘기는 draft 만 따로(bg-gen.json) 축약한다 — 실촬영 씬은 만들지 않는다.
    // 주인공 나무(2026-10-15 사장님 선택) — 디렉터가 표시한 씬에만 같은 나무 한 줄을 싣는다.
    const heroSet = new Set(design.heroScenes ?? []);
    const promptFor = (i: number, chained = false): string => buildSceneImagePrompt({
      // seed=쇼츠 id — 촬영 지시(조명·심도·앵글·생활감)가 편마다 갈린다. 재생성해도 같은 지시가 나온다.
      style: design.style, scene: design.prompts[i] ?? '', index: i, total: plan.scenes.length, seed: id,
      // 화분 소품은 화분·실내 주제일 때만 — 노지 수종에 넣으면 종 자체가 틀어진다(2026-09-06 실사고)
      potted: isContainerTopic(`${short.keyword ?? ''} ${short.topic}`),
      speciesRef: !!speciesRefPath,
      ...(design.species?.size ? { subjectSize: design.species.size } : {}),
      ...(design.subject ? { subject: design.subject } : {}),
      ...(design.subjectLatin ? { subjectLatin: design.subjectLatin } : {}),
      // 꽃·열매는 그 씬이 실제로 다룰 때만 — 늘 붙이면 꽃 없는 계절 장면에 꽃이 그려진다.
      // 2026-10-12 — 내레이션까지 보면 "열매 보려면"이 삽수 장면에 열매 묘사를 끌어왔다. 실제로 그리는 장면 묘사만 본다.
      ...(design.species ? { seasonal: speciesSeasonalHint(design.species, design.prompts[i] ?? '') } : {}),
      ...(design.musts[i] ? { must: design.musts[i] } : {}),
      ...(design.hero && heroSet.has(i) ? { hero: design.hero } : {}),
      ...(chained ? { heroChained: true } : {}),
    });
    const scenePromptsAll = plan.scenes.map((_, i) => promptFor(i));
    const altOf = (i: number): string => plan.scenes[i]!.screenText || plan.scenes[i]!.narration.slice(0, 30);
    const slotOf = (i: number): { alt: string; prompt: string } => ({ alt: altOf(i), prompt: scenePromptsAll[i]! });
    const bgDraft = { imageSlots: plan.scenes.map((_, i) => slotOf(i)) };
    const bgDraftPath = path.join(dir, 'bg-draft.json');
    const bgGenPath = path.join(dir, 'bg-gen.json');
    const bgManifestPath = path.join(dir, 'bg-manifest.json');
    fs.writeFileSync(bgDraftPath, JSON.stringify(bgDraft, null, 2), 'utf-8');
    fs.writeFileSync(bgGenPath, JSON.stringify({ imageSlots: slotScenes.map(slotOf) }, null, 2), 'utf-8');
    type GenItem = { file_path?: string; error?: string } | null;
    /** 씬 묶음 한 번 생성 — 묶음마다 지시 파일·출력 폴더·매니페스트를 따로 쓴다(파일 이름이 묶음 안 순번이라 겹친다). */
    const runGen = async (idxs: number[], tag: string, refs: readonly string[], chained: boolean): Promise<{ idx: number[]; images: GenItem[]; ok: boolean; output: string }> => {
      if (!idxs.length) return { idx: [], images: [], ok: true, output: '' };
      const genPath = path.join(dir, `bg-gen-${tag}.json`);
      const manPath = path.join(dir, `bg-manifest-${tag}.json`);
      fs.writeFileSync(genPath, JSON.stringify({ imageSlots: idxs.map((i) => ({ alt: altOf(i), prompt: chained ? promptFor(i, true) : scenePromptsAll[i]! })) }, null, 2), 'utf-8');
      fs.writeFileSync(manPath, '{}', 'utf-8'); // 지난 실행의 매니페스트를 오독하지 않게
      const r = await generateImagesForDraft(genPath, path.join(dir, 'scenes', ...(tag === 'main' ? [] : [tag])), manPath, // 묶음 폴더는 scenes/ 안 — 물려받기 복사·저장공간 정리가 scenes/ 를 통째로 다룬다
        {
          imageStyle: design.preset, limit: idxs.length, size: '1024x1536', timeoutMs: 150_000 * idxs.length,
          // 첨부 사진·실물 프레임을 레퍼런스로 — 종 레퍼런스가 있으면 맨 앞에 온다(형태의 근거). 이어 그리기 묶음은 주인공 첫 그림이 맨 앞.
          ...(refs.length ? { refImages: [...refs] } : {}),
        }, opts.signal);
      let ims: GenItem[] = [];
      try { ims = (JSON.parse(fs.readFileSync(manPath, 'utf-8')) as { images?: GenItem[] }).images ?? []; } catch { /* 실패 — 아래에서 빈 자리 */ }
      return { idx: idxs, images: ims, ok: r.ok, output: r.output };
    };
    // 주인공 나무 이어 그리기(2026-10-15 사장님 선택, SHORTS_HERO_CHAIN) — 주인공 첫 씬을 먼저 그리고, 나머지 주인공 씬은 그 그림을
    // 첫 참조로 붙여 같은 개체로 잇는다. 주인공이 안 나오는 씬은 그와 동시에 그린다. 기준 그림이 실패하면 따로 그린다.
    const heroSlots = slotScenes.filter((i) => heroSet.has(i));
    const chainHero = CONFIG.shortsHeroChain && !!design.hero && heroSlots.length >= 2;
    let heroRef: string | null = null;
    const genOuts: Array<{ idx: number[]; images: GenItem[]; ok: boolean; output: string }> = [];
    if (chainHero) {
      const first = heroSlots[0]!;
      const g1 = await runGen([first], 'hero1', genRefs, false);
      genOuts.push(g1);
      const fp = g1.images[0]?.file_path ? String(g1.images[0]!.file_path) : '';
      heroRef = fp && !g1.images[0]?.error && fs.existsSync(fp) ? fp : null;
      say(heroRef
        ? `주인공 나무 이어 그리기 — 씬${first + 1} 그림을 기준으로 씬 ${heroSlots.slice(1).map((i) => i + 1).join(',')}`
        : '주인공 나무 이어 그리기 — 기준 그림 실패, 나머지는 따로 그림');
      const chained = heroRef ? heroSlots.slice(1) : [];
      const rest = slotScenes.filter((i) => i !== first && !chained.includes(i));
      genOuts.push(...await Promise.all([
        runGen(chained, 'hero', heroRef ? [heroRef, ...genRefs].slice(0, 4) : genRefs, true),
        runGen(rest, 'rest', genRefs, false),
      ]));
    } else if (slotScenes.length) {
      genOuts.push(await runGen(slotScenes, 'main', genRefs, false));
    }
    const chainedSet = new Set(heroRef ? heroSlots.slice(1) : []);
    // 실제로 쓴 지시(이어 그린 씬은 '첫 번째 첨부 = 주인공' 문구 포함) — 씬 QA 재생성이 같은 지시·같은 첨부로 다시 그린다.
    const scenePromptsUsed = plan.scenes.map((_, i) => (chainedSet.has(i) ? promptFor(i, true) : scenePromptsAll[i]!));
    const refsFor = (i: number): string[] => (chainedSet.has(i) && heroRef ? [heroRef, ...genRefs].slice(0, 4) : genRefs);
    // 합친 매니페스트(슬롯 순서) — 수정 요청 재구성(reviseImagesFor)이 bg-manifest.json 을 슬롯 순서로 읽는다.
    const bySlot = new Map<number, GenItem>();
    for (const g of genOuts) g.idx.forEach((sc, k) => bySlot.set(sc, g.images[k] ?? null));
    fs.writeFileSync(bgManifestPath, JSON.stringify({ images: slotScenes.map((sc) => bySlot.get(sc) ?? null) }, null, 2), 'utf-8');
    // 실패를 소리 내어 남긴다(2026-09-09) — 종전엔 결과를 버려서 429(잔액 없음)가 '배경 폴백'으로만 보였다.
    for (const g of genOuts) if (!g.ok) say(`씬 이미지 스크립트 실패 — ${g.output.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 160) ?? ''}`);
    const errs = slotScenes.map((sc) => String(bySlot.get(sc)?.error ?? '')).filter(Boolean);
    if (errs.length) say(`씬 이미지 생성 실패 ${errs.length}/${slotScenes.length}장 — ${errs[0]!.replace(/\s+/g, ' ').slice(0, 160)}`);
    // 슬롯 정렬 이미지 목록 — 실패 씬은 null(렌더러가 그라데이션 폴백, 순서 보존)
    let images: Array<string | null> = plan.scenes.map(() => null);
    slotScenes.forEach((sceneIdx) => {
      const im = bySlot.get(sceneIdx);
      const fp = im?.file_path ? String(im.file_path) : '';
      images[sceneIdx] = fp && !im?.error && fs.existsSync(fp) ? fp : null;
    });
    // 실사진이 생성본을 이긴다 — 배정된 씬은 사용자가 올린 사진을 쓴다.
    images = images.map((g, i) => assetPlan[i] ?? g);

    // 3-b) 씬 배경 비전 QA — 잡글자·구도·왜곡 불량만 재생성(claude 비전, fail-open, 엔진 독립).
    const qa = await qaSceneImages({
      // 씬 번호대로인 배열이어야 한다 — QA 는 images 의 원본 인덱스로 이 배열을 찾는다.
      dir, images, scenePrompts: scenePromptsUsed,
      preset: design.preset, signal: opts.signal,
      // 재생성도 같은 레퍼런스를 받아야 한다 — 안 주면 종 근거 없이 다시 그려 또 틀린다(2026-09-06).
      // 이어 그린 주인공 씬은 주인공 첫 그림을 맨 앞에(2026-10-15).
      ...(genRefs.length ? { refImages: genRefs } : {}),
      refImagesFor: refsFor,
      ...(design.hero && heroSet.size ? { hero: design.hero, heroScenes: heroSet } : {}),
      ...(design.subject ? { subject: design.subject } : {}),
      ...(design.subjectLatin ? { subjectLatin: design.subjectLatin } : {}), // 수종 오식별 검사
      ...(design.species?.size ? { subjectSize: design.species.size } : {}),   // 크기 검사(2026-09-08)
      sceneHints: plan.scenes.map((s) => s.narration),                           // 초점 읽기(2026-09-09)
      sceneMust: design.musts,                                                   // 원문 묘사 대조(2026-10-12)
      // 실사진 자리는 QA 재생성에서 뺀다 — 사용자가 고른 사진을 우리가 생성본으로 바꾸면 안 된다.
      protectedScenes: new Set(assetPlan.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)),
    });
    images = qa.images;
    // 씬 초점(2026-09-09) — 좌표 기법(포인터 링·스포트라이트·인셋 확대창)의 입력. 이미지가 없거나 재생성된 씬은 없음.
    let focusN = 0;
    plan.scenes.forEach((sc, i) => { const pt = qa.focus[i]; if (pt && images[i]) { sc.focus = pt; focusN++; } else delete sc.focus; });
    if (focusN) say(`씬 초점 — ${focusN}씬 좌표 확보(포인터 링·스포트라이트·확대창 후보)`);
    // plan.json 은 기획 직후 한 번 쓰였다 — 초점을 담아 다시 쓴다. 안 그러면 수정요청 재조립(plan.json 을 읽는다)이 좌표 없이 돈다.
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
    if (qa.regenerated) say(`씬 QA — ${qa.regenerated}장 재생성 (${qa.issues.slice(0, 3).join(' · ')})`);
    else if (qa.issues.length) say(`씬 QA — 이슈 ${qa.issues.length}건, 재생성 없음 (${qa.issues.slice(0, 3).join(' · ')})`);
    checkAbort();

    // 3-c-i) 모션 디렉터 — 비전이 QA 통과 이미지를 '직접 보고' 씬 의도(내레이션·kind)에 맞는
    //        씬별 I2V 모션 프롬프트 설계. I2V 게이트가 닫혀 있으면 비전 호출도 생략(낭비 방지).
    const motionPrompts = i2vGate() && !hasRealFootage
      ? await directSceneMotion({
          images,
          scenes: plan.scenes.map((s) => ({ narration: s.narration, screenText: s.screenText, kind: s.kind })),
          styleHint: design.style, signal: opts.signal,
        })
      : images.map(() => null);
    const directed = motionPrompts.filter(Boolean).length;
    if (directed) say(`모션 디렉팅 — ${directed}/${plan.scenes.length}씬 맞춤 연출(나머지 정적 폴백)`);
    // 사람·손·도구 씬 판별(비전이 이미지를 직접 봄) — 그 씬은 I2V 를 건너뛰고 스틸로 남긴다.
    // 프롬프트로 '정지'를 요청하는 방식은 5B 모델이 무시해 실패했다(사용자 보고 2026-08-01).
    const subjectScenes = i2vGate() && !hasRealFootage ? await detectSubjectScenes(images, opts.signal) : new Set<number>();
    if (subjectScenes.size) say(CONFIG.shortsI2vSubjectScenes
      ? `사람·손·도구 씬 ${subjectScenes.size}개 — 카메라 전용 모션(사람·손은 사진처럼 정지)으로 I2V 후보 유지`
      : `사람·손·도구 씬 ${subjectScenes.size}개 — 모션 없이 스틸 유지(형태 왜곡 방지)`);

    // I2V 컷 선정 — '정말 움직임이 필요한 핵심 컷'만 클립화(기본 1 = 훅, env SHORTS_I2V_MAX_CLIPS).
    // 탈락 씬은 Remotion 네이티브 연출(fx: push·엔터 이펙트·강도 변주)이 움직임 공백을 채운다.
    const scenePrompts = plan.scenes.map((_, i) => design.prompts[i] ?? '');
    // 실촬영이 덮는 씬은 후보에서 아예 뺀다(2026-09-04) — 선정 뒤에 걸러 내면 상한 1편을 그 씬이
    // 잡아먹고 클립을 만든 뒤 버리게 된다. 사장님 지적이 정확했다: "실촬영을 쓰면 I2V는 안 만들어도 된다".
    // 실촬영이 한 씬이라도 들어가면 I2V 는 아예 안 만든다(사용자 확정 2026-09-04).
    //
    // I2V 의 존재 이유는 "전 씬이 정지 이미지라 화면에 움직임이 없다"는 것 하나다. 진짜로 찍은
    // 움직이는 화면이 들어간 순간 그 전제가 사라진다. 그런데도 다른 씬에 한 편을 만들면, 생성
    // 모션이 실촬영 옆에 붙어 오히려 티가 나고 돈은 돈대로 나간다.
    const i2vPlan = hasRealFootage
      ? { allowed: new Set<number>(), reasons: [] as string[] }
      : selectI2vScenes({
          kinds: plan.scenes.map((s) => s.kind), motionPrompts, subjectScenes, scenePrompts,
          images: images.map((im, i) => (covered.has(i) ? null : im)),
          max: CONFIG.shortsI2vMaxClips,
          allowSubject: CONFIG.shortsI2vSubjectScenes, // 2026-09-09 — 손 씬도 후보(카메라 전용 모션)
        });
    if (hasRealFootage) say('I2V 건너뜀 — 실촬영 화면이 들어간다(생성 모션이 필요 없다)');
    else if (i2vGate()) say(`I2V 컷 선정 — ${i2vPlan.allowed.size}/${plan.scenes.length}씬 (상한 ${CONFIG.shortsI2vMaxClips}${i2vPlan.reasons.length ? ` · ${i2vPlan.reasons.join(' ')}` : ''})`);

    // 3-c) 씬 배경 I2V — fal 클립화(키 없으면 no-op, 실패 씬은 스틸 폴백, fail-open).
    const cv = await i2vSceneClips({
      // 원시 장면 묘사를 넘긴다(빌드된 이미지 프롬프트 X) — 후자에는 '손·손가락 왜곡을 피한다' 는
      // 금지 문구가 항상 붙어 있어 손 판별(hasSubjectRisk)이 전 씬에 오탐했다(실측 2026-08-01).
      dir, images, scenePrompts, motionPrompts, subjectScenes, signal: opts.signal,
      allowSubject: CONFIG.shortsI2vSubjectScenes,
      // 실사진 씬은 I2V 대상에서 뺀다 — 실제로 찍은 사진을 생성 모델이 움직이면 형태가 무너진다.
      allowedScenes: new Set([...i2vPlan.allowed].filter((i) => !covered.has(i))),
    });
    // 실촬영 영상을 굽는다 — 배정은 위(내용 기준)에서 이미 정해졌고 여기서는 파일만 만든다.
    cv.clips = await applyUserSegments(cv.clips, videoPlan, dir, say, opts.signal);
    const clipCount = cv.clips.filter(Boolean).length;
    if (clipCount) say(`씬 I2V — ${clipCount}/${plan.scenes.length}장 클립화${cv.issues.length ? ` (${cv.issues[0]})` : ''}`);
    else if (cv.issues.length) say(`씬 I2V — 클립 0장 (${cv.issues.slice(0, 2).join(' · ')})`);
    checkAbort();

    // 3-c-ii) 클립 비전 QA — 중간 프레임 검수(형태 붕괴·물체 출현·유령 글자·내레이션 모순),
    //         불량 클립만 QA 통과 스틸(켄번즈)로 강등. 재생성 없음 — 추가 과금 0, fail-open.
    // 사장님 실촬영(user_NN.mp4)은 클립 QA 대상이 아니다(2026-09-08 실사고) — 이 검수는 I2V 생성 클립의 형태 붕괴·유령
    // 글자를 잡으려는 것인데, 사장님 영상을 "내레이션과 안 맞는다"며 버렸다. 그 씬은 영상이 들어갈 자리라 생성 이미지를
    // 안 만들어 둔 터라 '스틸 폴백'이 검은 배경이 됐다(공작단풍 유튜브편 3번 씬). 실촬영은 사용자의 선택이고 반드시 들어간다.
    const realClipAt = cv.clips.map((c) => !!c && path.basename(c).startsWith('user_'));
    const genClips = cv.clips.map((c, i) => (realClipAt[i] ? null : c));
    if (genClips.some(Boolean)) {
      const cq = await qaSceneClips({ dir, clips: genClips, narrations: plan.scenes.map((s) => s.narration), signal: opts.signal });
      cv.clips = cq.clips.map((c, i) => (realClipAt[i] ? cv.clips[i]! : c));
      if (cq.dropped) say(`클립 QA — ${cq.dropped}개 불량 → 스틸 폴백 (${cq.issues.slice(0, 2).join(' · ')})`);
      checkAbort();
    } else if (clipCount) {
      say('클립 QA 건너뜀 — 클립이 실촬영뿐(사장님 영상은 검수 대상이 아니다)');
    }

    // 여분 실촬영(2026-09-18, SHORTS_MIDCUT) — 씬 배정(videoPlan)에 안 들어간 보관소 영상. 5초 넘는 실촬영 씬의 뒷 절반을
    // 이걸로 바꾼다(한 영상은 한 씬 규칙과 별개 — 배정은 그대로고, 남는 영상을 같은 씬 안에서 잇는 것뿐이다).
    // 실제로 쓰일 것만 골라 실촬영 클립과 같은 굽기(cutVideoSegment: h264·yuv420p·회전 굽기·길이 절단)를 거친다(fix round 1) —
    // 보관소 원본은 HEVC·회전 메타·18~28초라, 통짜로 넣으면 디코더 없는 환경에서 렌더러 폴백이 필름 룩을 못 받고 번들만 커진다.
    // 어느 씬이 쓸지는 낭독 실측 전이라 자수 추정(sceneEst — videoPlan 과 같은 산식)으로 정하고, 뒷 절반 + 여유(SEGMENT_TAIL_SEC)만 뗀다.
    const spareClips = CONFIG.shortsMidcut ? await normalizeSpareClips({
      userVideoFiles, videoDurations, videoPlan, clips: cv.clips, sceneEst, dir, say, signal: opts.signal,
    }) : [];
    await finishShortsRun({
      id, store, dir, short, plan, images, clips: cv.clips, opts, say, checkAbort,
      ...(spareClips.length ? { spareClips } : {}),
    });
  } catch (e) {
    const msg = opts.signal?.aborted ? '취소됨' : e instanceof Error ? e.message.slice(0, 300) : String(e);
    store.update(id, { stage: 'error', error: msg });
    // 낭독 전에 예약한 예고를 되돌린다 — 실패한 편은 아무에게도 약속하지 않았다(2026-10-02).
    try { if (promiseStore().dropBySource(id)) say('예고 예약 취소 — 실패한 편'); } catch { /* 무해 */ }
    say(`${short.topic.slice(0, 30)} — 실패: ${msg}`);
  } finally {
    RUNNING.delete(id);
  }
}
