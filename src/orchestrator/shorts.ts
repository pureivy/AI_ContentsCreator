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
import path from 'node:path';
import { CONFIG } from '../config';
import { microJSON, runAgent, extractFirstJson } from './agent';
import { getCompany } from '../agents/company-loader';
import { rolesById } from '../agents/company';
import { stripEmoji } from '../output/render';
import { shortsStore } from '../content/shorts';
import { notifyShortsReady } from '../autonomy/contentNotify';
import { generateImagesForDraft } from '../tools/blog_skills';
import { qaSceneImages } from './shortsSceneQa';
import { qaSceneClips } from './shortsClipQa';
import { standaloneIssues } from './standaloneQa';
import { i2vSceneClips, i2vGate } from './shortsSceneClips';
import { directSceneMotion } from './shortsMotionDirector';
import { renderShortsVideo, ensureShortsDownload, extractFirstFrame } from '../tools/shortsRender';
import { renderShortsVideoRemotion } from '../tools/shortsRenderRemotion';
import { generateDesignedThumbnail } from './shortsThumbnail';
import { uploadShortsToYoutube } from '../tools/youtubeUpload';
import { brandContext } from '../content/brand';
import { priorCoverageBrief } from '../content/priorCoverage';
import type { ShortsScene } from '../tools/shortsRender';
import { normalizeSceneKind } from '../tools/shortsCommon';
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
}

interface JobIO { bus?: EventBus; signal?: AbortSignal }

/** 역할 LLM 호출(JSON) — 버스가 있으면 runAgent(오피스 뷰 스폰·스트림·지표), 없으면 무음 microJSON. */
async function callRoleJSON<T>(
  io: JobIO, roleId: string, fallbackSystem: string, task: string,
  maxOutputTokens: number, emitSpawn: boolean,
): Promise<T | null> {
  const role = (() => { try { return rolesById(getCompany()).get(roleId); } catch { return undefined; } })();
  if (io.bus && role) {
    const out = await runAgent({
      bus: io.bus, role, model: stdModel(),
      task: `${task}\n\n다른 텍스트 없이 JSON만 출력하라.`,
      stage: 'work', emitSpawn, maxOutputTokens, signal: io.signal,
    });
    return extractFirstJson<T>(out.text);
  }
  // microJSON 폴백은 buildSystemPrompt 를 안 지나므로 브랜드 컨텍스트를 system 에 직접 합성.
  const sys = [role?.systemPrompt || fallbackSystem, brandContext()].filter(Boolean).join('\n\n');
  return microJSON<T>(stdModel(), sys, task, { maxOutputTokens, signal: io.signal });
}

/** 내레이션 위생 — 이모지·괄호 지문 제거(TTS 가 읽어버림), 길이 캡. */
function cleanNarration(s: unknown, cap = 120): string {
  return stripEmoji(String(s ?? ''))
    .replace(/[()（）[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().slice(0, cap);
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

async function planShorts(io: JobIO, topic: string, keyword: string | undefined, sourceBody: string | undefined, n: number, priorCoverage = ''): Promise<Plan | null> {
  const user = [
    `[주제] ${topic}`,
    keyword ? `[핵심 키워드] ${keyword}` : '',
    priorCoverage,
    sourceBody ? `[블로그 초안 본문 — 핵심 1~2개와 그것이 성립하는 이유(전제 인과 한 줄)를 함께 추려 재구성하라(문장 복붙 금지, 사실·수치는 원문에 있는 것만)]\n${sourceBody.slice(0, 4000)}` : '',
    '',
    `씬 ${n}개의 유튜브 숏폼 대본을 기획하라. 씬1=훅(3패턴 중 택1), 씬2=전제(이 영상이 무엇에 대한 이야기이고 왜 문제/중요한지를 못박는다 — 원문의 핵심 인과 한 줄), 마지막 씬=CTA.`,
    '시청자는 원문 블로그를 본 적이 없다 — 영상 단독으로 완결되게 써라: 핵심 주제어(식물명·행위명 등)를 훅 또는 씬2에서 반드시 명시하고, 지시어·축약어("짝"·"그 방법"·"두 그루" 류)는 앞 씬에서 뜻을 세운 뒤에만 사용하라.',
    '내레이션은 TTS 낭독용: 구어체 존댓말, 숫자는 한글로("30%"→"삼십 퍼센트"), 이모지·괄호 지문 금지.',
    '본문 씬 내레이션은 반드시 2문장(합쳐서 40~65자, 낭독 6~9초) — 방법 한 문장 + 이유/효과 한 문장. 씬2(전제)는 45~70자까지 허용. 훅·CTA 씬은 1~2문장(20~40자). 총 낭독 시간 30~55초를 맞춘다.',
    'screenText 는 씬당 1줄 15자 이내 키워드 요약(비워도 됨).',
    '씬 kind(선택): 씬1="hook", 마지막 씬="cta". 본문 씬 중 어울리는 곳에만 "stat"(핵심 수치 1개: value 숫자·unit 단위·label 15자)·"list"(items 2~4개, 각 18자)·"quote"(text 40자, source 출처) — 억지 배정 금지, 애매하면 kind 생략.',
    '수치 규칙: stat.value 는 원문(블로그 초안)에 있는 수치 또는 대본 구조상 자명한 숫자(단계 수·항목 수)만. 불확실하면 stat 을 쓰지 마라. narration 은 수치를 한글로 낭독하되 stat.value 는 아라비아 숫자.',
    'JSON 형식: {"title":"대표 제목","titles":["정보형","후킹형","질문형"],"scenes":[{"narration":"...","screenText":"...","kind":"hook|stat|list|quote|cta(선택)","stat":{"value":42,"unit":"%","label":"라벨"},"items":["항목"],"quote":{"text":"인용","source":"출처"}}],"description":"2~3줄","hashtags":["#니치","#범용","#shorts"]}',
  ].filter(Boolean).join('\n');
  type PlanRaw = { title?: unknown; titles?: unknown[]; scenes?: Array<{ narration?: unknown; screenText?: unknown; kind?: unknown; stat?: unknown; items?: unknown; quote?: unknown }>; description?: unknown; hashtags?: unknown };
  const sys = '당신은 유튜브 숏폼 작가입니다. 요청된 JSON 스키마만 출력합니다.';
  const parsePlan = (j: PlanRaw | null): Plan | null => {
    if (!j || !Array.isArray(j.scenes) || !j.scenes.length) return null;
    const scenes = j.scenes.slice(0, 8).map((s) => ({
      narration: cleanNarration(s?.narration),
      screenText: stripEmoji(String(s?.screenText ?? '')).trim().slice(0, 20),
      ...normalizeSceneKind(s), // 불량 페이로드는 {} 강등 — 기본 씬으로 렌더
    })).filter((s) => s.narration);
    if (scenes.length < 3) return null;
    const titles = (Array.isArray(j.titles) ? j.titles : []).map((t) => stripEmoji(String(t ?? '')).trim()).filter(Boolean).slice(0, 3);
    return {
      title: stripEmoji(String(j.title ?? '')).trim().slice(0, 60) || titles[0] || topic,
      titles: titles.length ? titles : [topic],
      scenes,
      description: String(j.description ?? '').trim().slice(0, 500),
      hashtags: normalizeHashtags(j.hashtags),
    };
  };
  let plan = parsePlan(await callRoleJSON<PlanRaw>(io, 'shorts_writer', sys, user, 2200, true));
  if (!plan) return null;
  // 단독 이해 검산 — 원문을 안 본 시청자 관점 텍스트 검사 후 1회 수정 라운드(fail-open, 실측 2026-07-29 결함 대응).
  try {
    const probs = await standaloneIssues('유튜브 숏폼 대본(씬 내레이션)', plan.scenes.map((s) => s.narration), topic, keyword, io.signal);
    if (probs.length) {
      const m = `단독 이해 검산 — ${probs.length}건 → 수정 라운드 (${probs[0]?.slice(0, 50)})`;
      console.log(`[숏폼] ${m}`); io.bus?.emit('log', { message: m });
      const fixed = parsePlan(await callRoleJSON<PlanRaw>(io, 'shorts_writer', sys,
        `${user}\n\n[단독 이해 검산 실패 — 아래 문제를 고쳐 같은 JSON 스키마로 완결 출력하라(설명 금지)]\n${probs.map((p) => `- ${p}`).join('\n')}`, 2600, false));
      if (fixed) plan = fixed; // 수정본 파싱 실패 시 원본 유지(검산이 기획을 막지 않는다)
    }
  } catch { /* 무해 */ }
  return plan;
}

async function designScenes(io: JobIO, topic: string, plan: Plan): Promise<{ preset: string; style: string; prompts: string[] }> {
  const user = [
    `[주제] ${topic}`,
    '[씬 — 내레이션 요지]',
    ...plan.scenes.map((s, i) => `${i + 1}. ${s.narration.slice(0, 60)}${s.screenText ? ` (자막: ${s.screenText})` : ''}`),
    '',
    `각 씬의 세로(9:16) 배경 이미지 프롬프트를 설계하라. scenes 는 정확히 ${plan.scenes.length}개.`,
    '이미지 안 글자 금지.',
    'style_preset 은 주제·내용·톤에 어울리게 선택하라 — photorealistic 을 기본값처럼 고르지 말 것. photorealistic=실물 시연·하우투·생활, manhwa=스토리·유머·과장, watercolor=감성·계절·에세이, ink_wash=차분한 전통·사색적 주제, flat_design=정보·정책·경제·비교·수치, retro_poster=이벤트·프로모션·복고.',
    'JSON 형식: {"style_preset":"photorealistic|manhwa|watercolor|ink_wash|flat_design|retro_poster","style":"모든 씬 공통 스타일 문구(팔레트·질감·조명)","scenes":[{"prompt":"장면 묘사(한국어 150자 이내)"}]}',
  ].join('\n');
  const j = await callRoleJSON<{ style_preset?: unknown; style?: unknown; scenes?: Array<{ prompt?: unknown }> }>(
    io, 'shorts_director', '당신은 숏폼 영상 디렉터입니다. 요청된 JSON 스키마만 출력합니다.', user, 1800, true,
  );
  const rawPreset = String(j?.style_preset ?? '').trim();
  const preset = PRESETS.has(rawPreset) ? rawPreset : (PRESET_ALIAS[rawPreset] ?? 'photorealistic');
  const style = String(j?.style ?? '').trim().slice(0, 200) || '밝고 깔끔한 한국 생활 사진풍, 부드러운 자연광';
  const prompts = plan.scenes.map((s, i) => {
    const p = String(j?.scenes?.[i]?.prompt ?? '').trim().slice(0, 200);
    return p || `${topic} 를 상징하는 한국 생활 장면, ${s.narration.slice(0, 30)} 분위기`;
  });
  return { preset, style, prompts };
}

/**
 * 숏폼 씬 이미지(gpt-image-2, 세로 9:16) 프롬프트 조립 — shorts-gen 의 스타일 일관성(전 씬 공통 앵커
 * 반복) + 시네마토그래피(구도·조명·씬 변주). 자막·내레이션은 렌더러가 얹으므로
 * 이미지엔 글자를 넣지 않는다(오타 원천 차단). 순수 함수(생성 없이 프롬프트 검증 가능).
 */
export function buildSceneImagePrompt(a: {
  style: string; scene: string; index: number; total: number;
}): string {
  const { style, index: i, total } = a;
  const scene = a.scene.trim() || '주제를 상징하는 한국 생활 장면';
  const isHook = i === 0;
  const p: string[] = [];
  p.push(`[전 씬 공통 스타일] ${style}`);
  p.push(`장면(씬 ${i + 1}/${total}${isHook ? ', 훅' : ''}): ${scene}.${isHook ? ' 첫 3초에 스크롤을 멈출, 가장 시선을 끄는 강렬한 장면으로 연출한다.' : ''}`);
  p.push('구도: 세로 9:16 프레임을 피사체로 자연스럽게 채운다.');
  p.push('시네마토그래피: 얕은 심도와 부드러운 조명으로 피사체를 또렷하게. 이전 씬과 구분되는 앵글·피사체·범위로 변주하되, 전 씬 공통 팔레트·질감·조명을 동일하게 유지해 시리즈 일관성을 낸다.');
  p.push('금지: 이미지 안에 글자·자막·숫자·로고·워터마크·간판 텍스트를 넣지 않는다(자막은 렌더러가 따로 얹는다). 손·손가락 왜곡과 어색한 합성을 피한다.');
  return p.join('\n');
}

/** 숏폼 생성 잡 — launch 래퍼가 버스·시그널을 주입(오피스 뷰 연동). 프론트는 GET 폴링. */
export async function runShortsJob(
  id: string,
  opts: { sourceBody?: string; sceneCount?: number; bus?: EventBus; signal?: AbortSignal } = {},
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
    const n = Math.min(Math.max(4, opts.sceneCount ?? 6), 8);

    // 1) 기획 — 대본(훅·씬·내레이션·자막)·제목 3후보·설명·해시태그
    store.update(id, { stage: 'planning' });
    opts.bus?.emit('phase', { team_id: 'shorts', phase: 'work' });
    // 같은 주제 기존 숏폼이 있으면 '관점 다르게' 주입(자기 자신·같은 글 파생 형제 제외).
    const priorCoverage = priorCoverageBrief('숏폼', short.topic, short.keyword, { excludeId: short.id, excludeSourcePieceId: short.sourcePieceId, brandSlug: short.brand });
    const plan = await planShorts(io, short.topic, short.keyword, opts.sourceBody, n, priorCoverage);
    if (!plan) throw new Error('기획 실패 — 작가 JSON 응답을 해석할 수 없습니다');
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
    say(`대본 완성 — ${plan.title.slice(0, 30)} · 씬 ${plan.scenes.length}개`);
    checkAbort();

    // 2) 디자인 — 씬별 세로 비주얼 프롬프트(전 씬 일관 스타일 + 장면 변주)
    store.update(id, {
      stage: 'designing', title: plan.title, titles: plan.titles,
      description: plan.description, hashtags: plan.hashtags,
    });
    const design = await designScenes(io, short.topic, plan);
    say(`디자인 확정 — ${design.preset} · ${design.style.slice(0, 40)}`);
    checkAbort();

    // 3) 씬 이미지 — 세로 1024×1536, 무텍스트(자막·내레이션은 렌더러가 얹음)
    store.update(id, { stage: 'rendering' });
    opts.bus?.emit('phase', { team_id: 'shorts', phase: 'integrate' });
    say(`씬 이미지 생성 시작 — gpt-image-2 세로 ${plan.scenes.length}장`);
    const bgDraft = {
      imageSlots: plan.scenes.map((s, i) => ({
        alt: s.screenText || s.narration.slice(0, 30),
        prompt: buildSceneImagePrompt({ style: design.style, scene: design.prompts[i] ?? '', index: i, total: plan.scenes.length }),
      })),
    };
    const bgDraftPath = path.join(dir, 'bg-draft.json');
    const bgManifestPath = path.join(dir, 'bg-manifest.json');
    fs.writeFileSync(bgDraftPath, JSON.stringify(bgDraft, null, 2), 'utf-8');
    await generateImagesForDraft(bgDraftPath, path.join(dir, 'scenes'), bgManifestPath,
      { imageStyle: design.preset, limit: plan.scenes.length, size: '1024x1536', timeoutMs: 150_000 * plan.scenes.length },
      opts.signal);
    // 슬롯 정렬 이미지 목록 — 실패 씬은 null(렌더러가 그라데이션 폴백, 순서 보존)
    let images: Array<string | null> = plan.scenes.map(() => null);
    try {
      const m = JSON.parse(fs.readFileSync(bgManifestPath, 'utf-8')) as { images?: Array<{ file_path?: string; error?: string } | null>; dry_run?: boolean };
      if (!m.dry_run) {
        images = plan.scenes.map((_, i) => {
          const im = m.images?.[i];
          const fp = im?.file_path ? String(im.file_path) : '';
          return fp && !im?.error && fs.existsSync(fp) ? fp : null;
        });
      }
    } catch { /* 전 씬 폴백 */ }

    // 3-b) 씬 배경 비전 QA — 잡글자·구도·왜곡 불량만 재생성(claude 비전, fail-open, 엔진 독립).
    const qa = await qaSceneImages({
      dir, images, scenePrompts: bgDraft.imageSlots.map((s) => s.prompt),
      preset: design.preset, signal: opts.signal,
    });
    images = qa.images;
    if (qa.regenerated) say(`씬 QA — ${qa.regenerated}장 재생성 (${qa.issues.slice(0, 3).join(' · ')})`);
    else if (qa.issues.length) say(`씬 QA — 이슈 ${qa.issues.length}건, 재생성 없음 (${qa.issues.slice(0, 3).join(' · ')})`);
    checkAbort();

    // 3-c-i) 모션 디렉터 — 비전이 QA 통과 이미지를 '직접 보고' 씬 의도(내레이션·kind)에 맞는
    //        씬별 I2V 모션 프롬프트 설계. I2V 게이트가 닫혀 있으면 비전 호출도 생략(낭비 방지).
    const motionPrompts = i2vGate()
      ? await directSceneMotion({
          images,
          scenes: plan.scenes.map((s) => ({ narration: s.narration, screenText: s.screenText, kind: s.kind })),
          styleHint: design.style, signal: opts.signal,
        })
      : images.map(() => null);
    const directed = motionPrompts.filter(Boolean).length;
    if (directed) say(`모션 디렉팅 — ${directed}/${plan.scenes.length}씬 맞춤 연출(나머지 정적 폴백)`);

    // 3-c) 씬 배경 I2V — fal 클립화(키 없으면 no-op, 실패 씬은 스틸 폴백, fail-open).
    const cv = await i2vSceneClips({
      dir, images, scenePrompts: bgDraft.imageSlots.map((s) => s.prompt), motionPrompts, signal: opts.signal,
    });
    const clipCount = cv.clips.filter(Boolean).length;
    if (clipCount) say(`씬 I2V — ${clipCount}/${plan.scenes.length}장 클립화${cv.issues.length ? ` (${cv.issues[0]})` : ''}`);
    else if (cv.issues.length) say(`씬 I2V — 클립 0장 (${cv.issues.slice(0, 2).join(' · ')})`);
    checkAbort();

    // 3-c-ii) 클립 비전 QA — 중간 프레임 검수(형태 붕괴·물체 출현·유령 글자·내레이션 모순),
    //         불량 클립만 QA 통과 스틸(켄번즈)로 강등. 재생성 없음 — 추가 과금 0, fail-open.
    if (clipCount) {
      const cq = await qaSceneClips({ dir, clips: cv.clips, narrations: plan.scenes.map((s) => s.narration), signal: opts.signal });
      cv.clips = cq.clips;
      if (cq.dropped) say(`클립 QA — ${cq.dropped}개 불량 → 스틸 폴백 (${cq.issues.slice(0, 2).join(' · ')})`);
      checkAbort();
    }

    // 4) 조립 — 기본 Remotion 모션그래픽, 실패 시 ffmpeg 슬라이드쇼로 폴백(무중단).
    say(CONFIG.shortsRenderer === 'ffmpeg' ? '영상 조립 시작 — ffmpeg 슬라이드쇼' : '영상 조립 시작 — Remotion 모션그래픽');
    let r = null as Awaited<ReturnType<typeof renderShortsVideo>> | null;
    if (CONFIG.shortsRenderer !== 'ffmpeg') {
      try { r = await renderShortsVideoRemotion(dir, plan.scenes, images, { clips: cv.clips, signal: opts.signal }); }
      catch (e) { say(`모션 렌더 예외 → ffmpeg 폴백: ${e instanceof Error ? e.message.slice(0, 80) : e}`); r = null; }
    }
    if (!r || !r.ok) {
      if (r) say('모션 렌더 실패 → ffmpeg 슬라이드쇼로 폴백');
      r = await renderShortsVideo(dir, plan.scenes, images, { signal: opts.signal });
    }
    if (!r.ok || !r.videoPath) throw new Error(`조립 실패 — ${r.issues.join(' · ').slice(0, 250)}`);
    const fallbacks = r.issues.filter((x) => x.includes('배경 폴백')).length;

    // 캡션 파일(업로드 편의) — 제목·설명·해시태그.
    const caption = [plan.title, '', plan.description, '', plan.hashtags.join(' ')].filter((x, i) => x || i === 1 || i === 3).join('\n');
    fs.writeFileSync(path.join(dir, 'caption.txt'), caption, 'utf-8');

    store.update(id, {
      stage: 'ready', scenes: r.sceneCount, durationSec: r.durationSec, bgFallbacks: fallbacks,
      topic: plan.title || short.topic,
    });
    say(`${plan.title.slice(0, 30)} — ${r.durationSec}초 · 씬 ${r.sceneCount}개 완성${fallbacks ? ` (배경 폴백 ${fallbacks}씬)` : ''}`);
    // 검토 대기 알림(완성 영상 동봉, 50MB 초과 시 텍스트 폴백) — fire-and-forget, 실패 무해.
    {
      const done = store.get(id);
      if (done) {
        void notifyShortsReady({
          id, topic: done.topic, brand: done.brand, durationSec: r.durationSec, scenes: r.sceneCount,
          sourcePieceId: done.sourcePieceId, writer: done.writer, director: done.director,
        }, r.videoPath);
      }
    }

    // 디자인 썸네일 — 훅 씬 배경 위에 손글씨 제목/핵심(gpt-image). best-effort: 실패해도 완성 유지(엔드포인트가 영상 프레임 폴백).
    try {
      const hook = images.find((p): p is string => !!p && fs.existsSync(p)) ?? null;
      const ok = await generateDesignedThumbnail({
        dir, title: plan.title, description: plan.description, titles: plan.titles, hookImage: hook, signal: opts.signal,
      });
      if (ok) store.update(id, {}); // updatedTs 갱신 → 포스터 URL(?v=updatedTs) 캐시버스트, 프레임 폴백본 대신 디자인 썸네일 표시
      say(ok ? '썸네일 생성 완료' : '썸네일 생성 스킵(프레임 폴백)');
    } catch (e) { say(`썸네일 생성 건너뜀(무해): ${e instanceof Error ? e.message.slice(0, 60) : e}`); }

    // ready 이후 자동 유튜브 업로드(옵트인) — 비공개 고정. 실패해도 잡은 이미 완성(수동 재시도 가능).
    if (CONFIG.autoYtUpload) {
      // 인트로(1.6초=디자인 썸네일) 붙은 영상 업로드 + 썸네일=그 영상 첫 프레임 — 미지정 시 유튜브가
      // 중간 프레임을 자동 선택해 커버가 엉뚱해짐(실측 2026-07-22, 사용자 방침: 맨 처음이 보이게).
      const ytVideo = (await ensureShortsDownload(dir).catch(() => null)) ?? r.videoPath;
      const ytCover = await extractFirstFrame(ytVideo, path.join(dir, 'yt-cover.jpg'), opts.signal).catch(() => null);
      const up = await uploadShortsToYoutube({
        slug: short.brand ?? '', videoPath: ytVideo,
        title: plan.title, description: plan.description, hashtags: plan.hashtags,
        thumbnailPath: ytCover ?? undefined,
        signal: opts.signal,
      });
      if (up.ok) { store.update(id, { youtubeId: up.videoId, youtubeUrl: up.url, youtubeTs: new Date().toISOString() }); say(`유튜브 비공개 업로드 완료 — ${up.url}`); }
      else say(`유튜브 자동 업로드 실패(수동 재시도 가능) — ${up.error}`);
    }
  } catch (e) {
    const msg = opts.signal?.aborted ? '취소됨' : e instanceof Error ? e.message.slice(0, 300) : String(e);
    store.update(id, { stage: 'error', error: msg });
    say(`${short.topic.slice(0, 30)} — 실패: ${msg}`);
  } finally {
    RUNNING.delete(id);
  }
}
