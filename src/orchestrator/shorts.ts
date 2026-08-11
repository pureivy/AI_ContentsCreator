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
import { lexiconGuide } from '../content/brand';
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
import { narrationStyleIssues } from '../content/styleLint';
import { promiseStore } from '../content/promises';
import { i2vSceneClips, i2vGate } from './shortsSceneClips';
import { directSceneMotion, detectSubjectScenes, selectI2vScenes } from './shortsMotionDirector';
import { renderShortsVideo, ensureShortsDownload, extractFirstFrame } from '../tools/shortsRender';
import { renderShortsVideoRemotion } from '../tools/shortsRenderRemotion';
import { generateDesignedThumbnail } from './shortsThumbnail';
import { generateTitleArt } from './shortsTitleArt';
import { uploadShortsToYoutube } from '../tools/youtubeUpload';
import { blogUrlForPiece } from '../content/pieces';
import { brandContext, getBrand } from '../content/brand';
import { priorCoverageBrief, recentPhrasesToAvoid } from '../content/priorCoverage';
import type { ShortsScene } from '../tools/shortsRender';
import { normalizeSceneKind, fixMonthNames } from '../tools/shortsCommon';
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
      task: `${task}\n\n${NO_FABRICATED_EXPERIENCE}\n\n${SELLER_INQUIRY_BAN}\n\n${lexiconGuide(getBrand()?.avoidJargon)}\n\n다른 텍스트 없이 JSON만 출력하라.`,
      stage: 'work', emitSpawn, maxOutputTokens, signal: io.signal,
    });
    return extractFirstJson<T>(out.text);
  }
  // microJSON 폴백은 buildSystemPrompt 를 안 지나므로 브랜드 컨텍스트를 system 에 직접 합성.
  const sys = [role?.systemPrompt || fallbackSystem, brandContext(), NO_FABRICATED_EXPERIENCE, SELLER_INQUIRY_BAN, lexiconGuide(getBrand()?.avoidJargon)].filter(Boolean).join('\n\n');
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
    for (const e of [...store.list()].reverse()) {   // 최신부터
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

async function planShorts(io: JobIO, topic: string, keyword: string | undefined, sourceBody: string | undefined, n: number, priorCoverage = ''): Promise<Plan | null> {
  const user = [
    `[주제] ${topic}`,
    keyword ? `[핵심 키워드] ${keyword}` : '',
    priorCoverage,
    sourceBody ? `[블로그 초안 본문 — 핵심 1~2개와 그것이 성립하는 이유(전제 인과 한 줄)를 함께 추려 재구성하라(문장 복붙 금지, 사실·수치는 원문에 있는 것만)]\n${sourceBody.slice(0, 4000)}` : '',
    '',
    `씬 ${n}개의 유튜브 숏폼 대본을 기획하라. 씬1=훅(3패턴 중 택1), 씬2=전제(이 영상이 무엇에 대한 이야기이고 왜 문제/중요한지를 못박는다 — 원문의 핵심 인과 한 줄), 마지막 씬=CTA.`,
    '시청자는 원문 블로그를 본 적이 없다 — 영상 단독으로 완결되게 써라: 핵심 주제어(식물명·행위명 등)를 훅 또는 씬2에서 반드시 명시하고, 지시어·축약어("짝"·"그 방법"·"두 그루" 류)는 앞 씬에서 뜻을 세운 뒤에만 사용하라. 단, 명시는 검색 표기 그대로일 필요 없다 — 키워드 명사구를 통째로 주어 자리에 세우지 말고("가을 묘목 심는 법은 ~로 정해집니다" 식 금지, 검색용 문장 티가 난다) 조사·어순을 바꿔 말이 되는 꼴로 녹여라("가을에 묘목을 심을 땐 날짜보다 뿌리부터 봐요"). 검색 표기 그대로의 노출은 title·titles·description·해시태그·screenText 가 담당한다.',
    '훅 금지 문형: "~보셨나요?/~라고요? + 정작/사실은/그럼 이미 ~" 질문-반전 공식(최근 편들이 과다 사용). 단정 선언("까맣게 익어도 아직 이릅니다"), 구체 장면, 숫자 제시, 청자 상황 지목, 짧은 제동("잠깐,") 등에서 앞 편들과 다른 유형을 골라라.',
    keyword ? `대표 제목(title)과 정보형 제목 후보에는 핵심 키워드 '${keyword}' 를 정확히 이 표기 그대로, 가급적 앞쪽에 포함하라(검색 노출용 — 제한된 글자수를 이유로 키워드를 빼지 마라). 키워드는 명사구 그대로 자연스럽게 결합하고 어미를 붙여 동사화하지 마라.` : '',
    'CTA 씬은 팔로우할 이유를 담아라 — 이 채널이 계속 주는 가치 한 구절(브랜드 맥락에 맞게) 또는 다음 편 예고 중 하나. "구독과 좋아요 부탁드려요" 같은 기계적 문구 금지. "계속 기록/정리해 드립니다" 계열 문구 재사용 금지 — 기록하는 채널 컨셉은 유지하되 표현은 매편 새로 지어라.',
    '다음 편 예고를 CTA 에 넣었으면 JSON 의 next 필드에 그 주제와 적절한 시기("N월")를 선언하라 — 예고는 시스템이 약속으로 기록해 그 시기에 실제로 제작한다. 지킬 수 있는 예고만 하고, 예고를 안 했으면 next 를 생략하라.',
    '내레이션은 TTS 낭독용: 구어체 존댓말, 숫자는 한글로("30%"→"삼십 퍼센트") — 단 월 이름은 고유어로("10월"→"시월", "6월"→"유월"). 이모지·괄호 지문 금지. 발음이 헷갈려 뜻이 뒤집히는 표현은 풀어 써라 — "새 가지"는 숫자 "세 가지"로 들리니 "새로 난 가지"처럼, 희귀 활용형("아뭅니다" 류)은 평이한 꼴("잘 아물어요")로.',
    '문장 종결을 섞어라: 한 씬의 두 문장을 같은 어미로 끝내지 마라("~ㅂ니다"+"~ㅂ니다" 금지). 대본 전체에서 "-ㅂ니다" 종결은 절반 이하로 하고 "~요/~죠/~거든요/~는데요/~하세요"를 섞어라. 습관적 설명 현재형("치웁니다", "심지 않습니다")은 청자에게 말 거는 꼴("치우세요", "지금은 심지 마세요")로. 아나운서 원고가 아니라 옆에서 알려주는 말로 들려야 한다.',
    '대본 전체 1~2곳에 사람 말의 결을 넣어라 — 짧은 제동("잠깐,"), 정정·양보("아, 포트묘는 예외예요"), 1인칭 판단("저는 색보다 끝알부터 봅니다"). 겪지 않은 사건·일화를 지어내는 것은 금지(판단·관점의 1인칭만). 정보 밀도를 깎는 잡담도 금지. "X가 아니라 Y" 재정의 문형은 대본 전체 1회 이하 — 앞 편들이 이미 상투로 만든 틀이다.',
    '본문 씬 내레이션은 1~3문장(합쳐서 30~70자, 낭독 5~10초) — "방법 한 문장+이유 한 문장"은 기본형일 뿐이니 씬마다 문장 수·리듬을 똑같이 맞추지 마라. 이유를 먼저 두는 씬, 질문으로 끝나 다음 씬이 답하는 씬을 최소 1개 섞어라(모든 씬이 결론으로 닫히면 짧은 설명서 여섯 장이 된다). "~기 때문입니다"는 대본 전체 1회 이하. 씬2(전제)는 45~70자까지 허용. 훅·CTA 씬은 1~2문장(20~40자). 총 낭독 시간 30~55초를 맞춘다.',
    'screenText 는 씬당 1줄 15자 이내 키워드 요약(비워도 됨).',
    '씬 kind(선택): 씬1="hook", 마지막 씬="cta". 본문 씬 중 어울리는 곳에만 "stat"(핵심 수치 1개: value 숫자·unit 단위·label 15자)·"list"(items 2~4개, 각 18자)·"quote"(text 40자, source 출처)·"chart"(비교 수치 2~5개가 막대그래프로 자라나는 연출: series 각 {label 8자, value 숫자≥0}, unit 단위, highlight 강조할 막대 인덱스) — 억지 배정 금지, 애매하면 kind 생략. chart 는 내레이션이 수치 비교를 말할 때만.',
    '수치 규칙: stat.value 와 chart.series 의 value 는 원문(블로그 초안)에 있는 수치 또는 대본 구조상 자명한 숫자(단계 수·항목 수)만. 불확실하면 그 kind 를 쓰지 마라. narration 은 수치를 한글로 낭독하되 JSON 값은 아라비아 숫자. chart 씬의 screenText 에는 핵심 수치 비교를 요약하라(렌더 실패 대비).',
    'JSON 형식: {"title":"대표 제목","titles":["정보형","후킹형","질문형"],"scenes":[{"narration":"...","screenText":"...","kind":"hook|stat|list|quote|chart|cta(선택)","stat":{"value":42,"unit":"%","label":"라벨"},"items":["항목"],"quote":{"text":"인용","source":"출처"},"chart":{"series":[{"label":"봄","value":90},{"label":"가을","value":70}],"unit":"%","highlight":0}}],"description":"2~3줄","hashtags":["#니치","#범용","#shorts"],"next":{"topic":"다음 편 주제(예고했을 때만)","window":"9월"}}',
  ].filter(Boolean).join('\n');
  type PlanRaw = { title?: unknown; titles?: unknown[]; scenes?: Array<{ narration?: unknown; screenText?: unknown; kind?: unknown; stat?: unknown; items?: unknown; quote?: unknown }>; description?: unknown; hashtags?: unknown; next?: { topic?: unknown; window?: unknown } };
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
    const next = j.next && typeof j.next.topic === 'string' && j.next.topic.trim()
      ? { topic: j.next.topic.trim().slice(0, 120), window: typeof j.next.window === 'string' && j.next.window.trim() ? j.next.window.trim() : undefined }
      : undefined;
    // 대표 제목 키워드 보정(결정적) — 종전엔 topic(블로그 SEO 제목, 키워드 강제 산물)을 작가가 채택할 때만
    // 우연히 포함됐다. 키워드 없는 창의 제목이 뽑히면 후보·topic 중 키워드 포함본으로 교체(없으면 원본 유지).
    // includes 검사는 60자 슬라이스 '결과'에 — 자르기 전 검사는 키워드가 경계 밖이면 도로 잘린다(리뷰 지적).
    let title = stripEmoji(String(j.title ?? '')).trim().slice(0, 60) || titles[0] || topic;
    if (keyword && !title.includes(keyword)) {
      const alt = [...titles, topic].map((t) => t.slice(0, 60)).find((t) => t.includes(keyword));
      if (alt) title = alt;
    }
    return {
      title,
      titles: titles.length ? titles : [topic],
      scenes,
      description: String(j.description ?? '').trim().slice(0, 500),
      hashtags: normalizeHashtags(j.hashtags),
      ...(next ? { next } : {}),
    };
  };
  // 예산 3000(CLI 상한 ×3=9000) — 문체 제약 투입(2026-08-11) 후 사고량 증가로 종전 2200(6600)이
  // 즉시 초과됐다(실측: 테스트 런 2건 연속 "exceeded 6600 output token maximum").
  let plan = parsePlan(await callRoleJSON<PlanRaw>(io, 'shorts_writer', sys, user, 3000, true));
  if (!plan) return null;
  // 단독 이해 검산 — 원문을 안 본 시청자 관점 텍스트 검사 후 1회 수정 라운드(fail-open, 실측 2026-07-29 결함 대응).
  try {
    // 문체 결정적 린트(2026-08-11) — 프롬프트 지시만으로는 샌다는 실측("새 가지" 위반) 대응, 같은 수정 라운드에 얹는다.
    const probs = [
      ...await standaloneIssues('유튜브 숏폼 대본(씬 내레이션)', plan.scenes.map((s) => s.narration), topic, keyword, io.signal),
      ...narrationStyleIssues(plan.scenes.map((s) => s.narration)),
    ].slice(0, 8);
    if (probs.length) {
      const m = `단독 이해·문체 검산 — ${probs.length}건 → 수정 라운드 (${probs[0]?.slice(0, 50)})`;
      console.log(`[숏폼] ${m}`); io.bus?.emit('log', { message: m });
      const fixed = parsePlan(await callRoleJSON<PlanRaw>(io, 'shorts_writer', sys,
        `${user}\n\n[단독 이해·문체 검산 실패 — 아래 문제를 고쳐 같은 JSON 스키마로 완결 출력하라(설명 금지)]\n${probs.map((p) => `- ${p}`).join('\n')}`, 3400, false));
      // 수정본 파싱 실패 시 원본 유지. 수정 라운드가 대본만 고치고 메타(제목 후보·설명·해시태그)를
      // 빠뜨려도 원본 것을 승계(무손실 병합 — parsePlan 의 [topic] 폴백 제목이 원본을 덮지 않게).
      if (fixed) {
        plan = {
          ...fixed,
          titles: fixed.titles.length > 1 ? fixed.titles : plan.titles,
          description: fixed.description || plan.description,
          hashtags: fixed.hashtags.length ? fixed.hashtags : plan.hashtags,
        };
      }
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
    // 반복 상투구 회피(2026-08-06) — 화면텍스트·훅 층위 반복은 주제 대조로 안 잡힌다. 최근 숏폼
    // 화면텍스트 코퍼스에서 문서빈도로 채굴해 금지 목록으로 주입(소재어는 stems 보호).
    const ticPhrases = recentPhrasesToAvoid('숏폼', short.brand, { stems: getBrand()?.compoundStems ?? [] });
    const phraseBlock = ticPhrases.length
      ? `[반복 표현 금지] 최근 숏폼들에서 이미 여러 번 쓴 표현이다 — 내레이션·화면텍스트에 쓰지 말고 다른 어휘·접근으로 풀어라: ${ticPhrases.map((p) => `'${p}'`).join(', ')}`
      : '';
    // 훅·CTA 문형 로테이션(2026-08-11) — 훅 질문-반전 공식 7/15편·CTA "계속 기록" 7/15편 실측.
    // 지시문 단독은 새므로 최근 편의 원문을 직접 보여주고 "겹치면 다시 써라"로 못박는다.
    const hooksBlock = recentHooksToAvoid(short.brand, short.id);
    say(`기획 가드 — 유사주제 ${priorCoverage ? '주입' : '해당없음'} · 반복표현 ${ticPhrases.length}건 · 훅/CTA 로테이션 ${hooksBlock ? '주입' : '해당없음'}`);
    const plan = await planShorts(io, short.topic, short.keyword, opts.sourceBody, n, [priorCoverage, phraseBlock, hooksBlock].filter(Boolean).join('\n\n'));
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
    // 사람·손·도구 씬 판별(비전이 이미지를 직접 봄) — 그 씬은 I2V 를 건너뛰고 스틸로 남긴다.
    // 프롬프트로 '정지'를 요청하는 방식은 5B 모델이 무시해 실패했다(사용자 보고 2026-08-01).
    const subjectScenes = i2vGate() ? await detectSubjectScenes(images, opts.signal) : new Set<number>();
    if (subjectScenes.size) say(`사람·손·도구 씬 ${subjectScenes.size}개 — 모션 없이 스틸 유지(형태 왜곡 방지)`);

    // I2V 컷 선정 — '정말 움직임이 필요한 핵심 컷'만 클립화(기본 1 = 훅, env SHORTS_I2V_MAX_CLIPS).
    // 탈락 씬은 Remotion 네이티브 연출(fx: push·엔터 이펙트·강도 변주)이 움직임 공백을 채운다.
    const scenePrompts = plan.scenes.map((_, i) => design.prompts[i] ?? '');
    const i2vPlan = selectI2vScenes({
      kinds: plan.scenes.map((s) => s.kind), motionPrompts, subjectScenes, scenePrompts, images,
      max: CONFIG.shortsI2vMaxClips,
    });
    if (i2vGate()) say(`I2V 컷 선정 — ${i2vPlan.allowed.size}/${plan.scenes.length}씬 (상한 ${CONFIG.shortsI2vMaxClips}${i2vPlan.reasons.length ? ` · ${i2vPlan.reasons.join(' ')}` : ''})`);

    // 3-c) 씬 배경 I2V — fal 클립화(키 없으면 no-op, 실패 씬은 스틸 폴백, fail-open).
    const cv = await i2vSceneClips({
      // 원시 장면 묘사를 넘긴다(빌드된 이미지 프롬프트 X) — 후자에는 '손·손가락 왜곡을 피한다' 는
      // 금지 문구가 항상 붙어 있어 손 판별(hasSubjectRisk)이 전 씬에 오탐했다(실측 2026-08-01).
      dir, images, scenePrompts, motionPrompts, subjectScenes, allowedScenes: i2vPlan.allowed, signal: opts.signal,
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
    let titleArt: Awaited<ReturnType<typeof generateTitleArt>> = null;
    if (CONFIG.shortsRenderer !== 'ffmpeg') {
      // 상단 제목 캘리(썸네일과 같은 카피, 투명 PNG) — 렌더 전에 생성해야 오버레이 가능. 실패해도 무해(오버레이 생략).
      if (CONFIG.shortsTitleOverlay) {
        titleArt = await generateTitleArt({ dir, title: plan.title, description: plan.description, titles: plan.titles, keyword: short.keyword, signal: opts.signal });
        checkAbort(); // 취소가 '스킵' 메시지로 위장되지 않게 — abort 는 null 로 삼켜져 나온다
        say(titleArt ? '상단 제목 캘리 생성 완료' : '상단 제목 캘리 스킵(오버레이 없이 진행)');
      }
      try {
        r = await renderShortsVideoRemotion(dir, plan.scenes, images, {
          clips: cv.clips, signal: opts.signal,
          // 자막 옵션 — 위치(플랫폼 UI 가림 회피)·키워드 강조색(설정 기반, A/B 선택 후 기본값 확정).
          caption: {
            bottomPct: CONFIG.shortsCaptionBottomPct,
            fontPx: CONFIG.shortsCaptionFontPx,
            hookFontPx: CONFIG.shortsCaptionHookFontPx,
            ...(CONFIG.shortsCaptionKeyword && short.keyword ? { keyword: short.keyword } : {}),
            ...(CONFIG.shortsCaptionOutline ? { outline: true } : {}),
          },
          ...(titleArt ? { title: { imagePath: titleArt.imagePath, topPct: CONFIG.shortsTitleTopPct, widthPct: CONFIG.shortsTitleWidthPct } } : {}),
        });
      }
      catch (e) { say(`모션 렌더 예외 → ffmpeg 폴백: ${e instanceof Error ? e.message.slice(0, 80) : e}`); r = null; }
    }
    if (!r || !r.ok) {
      // 실패 사유 동봉(2026-08-08) — 종전엔 r.issues 를 버려 "왜 폴백했나"를 사후 추적할 수 없었다(관측 공백).
      if (r) say(`모션 렌더 실패 → ffmpeg 슬라이드쇼로 폴백${r.issues.length ? ` (${r.issues.join(' · ').slice(0, 140)})` : ''}`);
      // 폴백에도 상단 제목 전달 — Remotion 실패 시 제목이 통째로 사라지던 실측(참나무 쇼츠) 봉합.
      r = await renderShortsVideo(dir, plan.scenes, images, {
        signal: opts.signal,
        ...(titleArt ? { title: { imagePath: titleArt.imagePath, topPct: CONFIG.shortsTitleTopPct, widthPct: CONFIG.shortsTitleWidthPct } } : {}),
      });
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
        // 발송 정착 후 notifiedTs 기록 — 도중에 프로세스가 죽으면 미기록으로 남아 부팅 복구 스윕이 재발송.
        void notifyShortsReady({
          id, topic: done.topic, brand: done.brand, durationSec: r.durationSec, scenes: r.sceneCount,
          sourcePieceId: done.sourcePieceId, writer: done.writer, director: done.director,
        }, r.videoPath).finally(() => { try { store.update(id, { notifiedTs: new Date().toISOString() }); } catch { /* 무해 */ } });
      }
      // 예고 대장 등록 — CTA 에 다음 편 예고를 선언했으면 약속으로 기록(자율 틱이 시기 도래 시 이행). 실패 무해.
      // brand 는 잡의 것을 명시(null=범용) — 라이브 activeBrand 로의 오귀속 방지.
      if (plan.next?.topic) {
        try {
          const pr = promiseStore().create({
            topic: plan.next.topic, window: plan.next.window,
            sourceKind: 'shorts', sourceId: id, sourceTopic: plan.title, brand: done?.brand ?? null,
          });
          if (pr) say(`예고 등록 — "${pr.topic.slice(0, 30)}"${pr.window ? ` (${pr.window})` : ''}`);
          else say('예고 등록 보류 — 미이행 약속이 가득(백로그 캡)');
        } catch { /* 무해 */ }
      }
    }

    // 디자인 썸네일 — 훅 씬 배경 위에 손글씨 제목/핵심(gpt-image). best-effort: 실패해도 완성 유지(엔드포인트가 영상 프레임 폴백).
    try {
      const hook = images.find((p): p is string => !!p && fs.existsSync(p)) ?? null;
      const ok = await generateDesignedThumbnail({
        dir, title: plan.title, description: plan.description, titles: plan.titles, keyword: short.keyword, hookImage: hook, signal: opts.signal,
        ...(titleArt ? { copy: titleArt.copy } : {}), // 상단 제목 캘리와 같은 카피 재사용 — 영상·썸네일 문구 일치
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
        blogUrl: blogUrlForPiece(short.sourcePieceId), // 원본 블로그 링크 — 자동 업로드 시점 조회(대개 발행 전이라 생략됨)
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
