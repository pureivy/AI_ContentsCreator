/**
 * 유휴 게이트 자율 사이클(옵트인: AUTO_CYCLE_MINUTES>0) — Connect AI 15분 오토사이클의 로컬·속도우선 변형.
 *
 * 핵심 긴장: 이 앱의 모든 속도 설계가 '단일 KV 슬롯(concurrency=1)'에 수렴하는데, 상시 백그라운드 LLM
 * 루프는 그 슬롯을 점유해 사용자 런을 지연시킨다. 그래서 이 스케줄러는 세 가지로 충돌을 회피한다.
 *   (1) 사용자 런이 하나라도 진행 중이면 진입조차 안 함(유휴 게이트).
 *   (2) 자율 런도 사용자 런과 같은 LLM_SLOT 으로 큐잉 → 단일 KV 슬롯 불변식 자동 보존.
 *   (3) 사용자 런 도착 시 양보(진행 중 자율 런 abort) — main.ts 의 launchRun 이 처리.
 * 기본 ON(config autoCycleMinutes=30). 켜져도 '가장 가치있는 단일 작업'을 micro 로 1건 제안해 저비용 런 1개만 띄운다(끄려면 AUTO_CYCLE_MINUTES=0).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { resolveAssignment } from '../llm/setting';
import { getCompany } from '../agents/company-loader';
import { microJSON } from '../orchestrator/agent';
import { asString } from '../util/str';
import { brandContext, brandProductLines, brandSeedKeywords, activeBrandSlug, brandFileSuffix } from '../content/brand';
import { collectExistingContent, findSimilarContent } from '../content/novelty';

export interface AutoCycleDeps<T = string> {
  /** 사이클 주기(ms). ≤0 이면 스케줄러는 no-op. */
  intervalMs: number;
  /** 사용자/기존 런이 진행 중인가(유휴 게이트). true 면 이번 틱을 건너뛴다. */
  isBusy: () => boolean;
  /** 오토런 스위치(사용자 토글) — false 면 틱이 조용히 아무 일도 하지 않는다(타이머는 유지). 미지정 = 항상 온. */
  isEnabled?: () => boolean;
  /** 이번 틱에 처리할 작업(재개 대상 piece 또는 새 아이디어). null 이면 띄우지 않음. */
  pickWork: (signal?: AbortSignal) => Promise<T | null>;
  /** 선택된 작업으로 자율 런을 띄운다(main.ts 의 launchRun 으로 위임). */
  launch: (work: T) => void;
  /** 로그 표기용 — 작업을 한 줄로 요약. */
  describe?: (work: T) => string;
  log?: (msg: string) => void;
}

/** 자율 사이클 시작. 반환값은 정지 함수. intervalMs≤0 이면 아무것도 하지 않는다. */
export function startAutoCycle<T = string>(deps: AutoCycleDeps<T>): () => void {
  if (!(deps.intervalMs > 0)) return () => {};
  let ticking = false; // 재진입 가드 — pickWork(LLM)이 주기보다 길어도 틱이 겹쳐 다중 자율런이 뜨지 않게.
  const tick = async (): Promise<void> => {
    if (ticking) return;
    if (deps.isEnabled && !deps.isEnabled()) return; // 오토런 오프 — 조용히 통과(토글 온이면 다음 틱부터 재개)
    ticking = true;
    try {
      if (deps.isBusy()) { deps.log?.('사용자 런 진행 중 — 자율 사이클 건너뜀'); return; }
      const work = await deps.pickWork();
      // 제안 도중 사용자 런이 도착했을 수 있으니 launch 직전 재확인(유휴 게이트 비원자성 완화).
      if (deps.isBusy()) { deps.log?.('제안 도중 사용자 런 도착 — 자율 사이클 보류'); return; }
      if (work != null) { deps.log?.(`자율 사이클 — "${deps.describe?.(work) ?? String(work)}"`); deps.launch(work); }
      else deps.log?.('자율 사이클 — 처리할 작업 없음(재개 대상·신규 아이디어 모두 없음)');
    } catch (e) {
      deps.log?.(`자율 사이클 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      ticking = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, deps.intervalMs);
  if (typeof timer.unref === 'function') timer.unref(); // 프로세스 종료를 막지 않게
  return () => clearInterval(timer);
}

// ── 오토런 온/오프 토글(사용자 요청 2026-07-16) — 앱 전역 스위치(브랜드 무관), 재시작에도 유지 ──
// AUTO_CYCLE_MINUTES(주기 설정)와 별개다: 주기는 기능의 존재, 토글은 사용자의 일시 정지 스위치.
const autorunFile = (): string => path.join(CONFIG.dataDir, '_shared', 'autorun.json');
let _autorunCache: boolean | undefined;
/** 오토런 켜짐 여부 — 파일 없음/깨짐은 온(기존 동작 불변). 1회 읽고 캐시(틱마다 디스크 안 침). */
export function autoRunEnabled(): boolean {
  if (_autorunCache === undefined) {
    try { _autorunCache = (JSON.parse(fs.readFileSync(autorunFile(), 'utf-8')) as { enabled?: unknown }).enabled !== false; }
    catch { _autorunCache = true; }
  }
  return _autorunCache;
}
export function setAutoRunEnabled(v: boolean): void {
  _autorunCache = v;
  try {
    fs.mkdirSync(path.dirname(autorunFile()), { recursive: true });
    fs.writeFileSync(autorunFile(), JSON.stringify({ enabled: v }));
  } catch { /* 영속 실패해도 런타임 토글은 유효(다음 재시작에 기본 온) */ }
}

export interface DailyDeps {
  /** "HH:MM" 로컬 시각. 형식 불일치면 no-op. */
  time: string;
  run: () => void;
  log?: (msg: string) => void;
}

/** 매일 지정 시각(로컬)에 1회 run() 호출 — 1분 간격 체크 + 당일 1회 가드. 정지 함수 반환. */
export function startDaily(deps: DailyDeps): () => void {
  const m = /^(\d{1,2}):(\d{2})$/.exec((deps.time || '').trim());
  if (!m) return () => {};
  const hh = Number(m[1]); const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return () => {};
  let lastFired = '';
  const tick = (): void => {
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (today === lastFired) return; // 당일 1회만
    if (now.getHours() === hh && now.getMinutes() >= mm) {
      lastFired = today;
      try { deps.log?.(`일일 브리핑 발송(${deps.time})`); deps.run(); }
      catch (e) { deps.log?.(`일일 브리핑 오류: ${e instanceof Error ? e.message : String(e)}`); }
    }
  };
  const timer = setInterval(tick, 60_000);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

function readSafe(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

// 최근 자율 주제(중복 회피) — Connect AI 의 '24h 내 반복 금지'에 대응하는 경량 메모리.
const recentAuto: string[] = [];

/** 다음에 제작할 콘텐츠 아이디어(구조화). */
export interface ContentIdea { title: string; keyword?: string; subNiche?: string; }

// 성과 전략(analytics/strategy.json, 6d 연동) 있으면 승자 키워드를 아이디어 재료로 — 없으면 콜드스타트(무시).
function readStrategyWinners(): string {
  try {
    const slug = activeBrandSlug();
    const raw = JSON.parse(readSafe(path.join(CONFIG.dataDir, 'analytics', slug ? `strategy-${slug}.json` : 'strategy.json'))) as {
      winners?: Array<{ keyword?: string; score?: number }>;
    };
    return (raw.winners ?? [])
      .filter((w) => w && w.keyword)
      .slice(0, 8)
      .map((w) => `- ${w.keyword}${typeof w.score === 'number' ? ` (점수 ${w.score.toFixed(2)})` : ''}`)
      .join('\n');
  } catch { return ''; }
}

const IDEA_SYSTEM =
  '너는 1인 AI 콘텐츠 회사의 자율 편집 기획자다. 아래 [팀·업무 범위]가 이 회사가 다루는 콘텐츠 영역이다. ' +
  '다음에 제작하면 검색 노출·유입에 가치있는 네이버 블로그(정보/하우투·리뷰) 콘텐츠 아이디어 한 개를 제안하라.\n' +
  '- 검색 의도가 뚜렷하고 실용적인 주제(하우투/비교/리뷰/체크리스트 등). 시의성·계절성도 고려한다.\n' +
  '- [브랜드 컨텍스트]가 있으면 그 기업의 제품·타겟 고객의 관심사와 자연스럽게 연결되는 주제를 우선하라(노골적 광고성 주제 금지 — 독자에게 유용한 정보가 우선).\n' +
  '- [성과 상위 키워드]는 어떤 분야가 통했는지의 참고다 — 그 분야의 인접·연관 영역에서 새로운 키워드를 발굴하라(성과 키워드 자체나 그 변형의 재사용은 금지). 없으면(콜드스타트) 영역 안에서 다양하게 탐색한다.\n' +
  '- [최근 제작]·[최근 자율주제]와 중복되지 않게 하라.\n' +
  '- [기존 콘텐츠] 목록과 주제·키워드가 유사하면 안 된다 — 같은 키워드나 그것을 포함·확장한 키워드 재사용 금지, 완전히 새로운 각도의 주제를 골라라(사용자 원칙).\n' +
  '- title 은 클릭·검색에 유리한 한국어 제목, keyword 는 검색량 있을 법한 핵심 타겟 키워드 1개, subNiche 는 세부 분야다.';

/**
 * 다음에 제작할 콘텐츠 아이디어 1건 제안 — 조직 헌장(팀·업무 범위) + 성과 전략(strategy.json)에 그라운딩.
 * 위키 인덱스는 주제 생성에서 제외(anti-drift): 과거 적재 자료로 편향되는 피드백 루프를 끊는다(구 gov 버전의 근본 교훈 유지).
 * 모델 — 클라우드 micro(haiku). (Ollama 로컬 분기는 백엔드 제거와 함께 삭제 — 2026-07-06)
 */
export async function proposeContentIdeas(signal?: AbortSignal): Promise<ContentIdea | null> {
  const c = getCompany();
  // 팀·업무 범위(헌장) — 아이디어 생성의 재료(회사 정체성·콘텐츠 영역이 specialty 에 담겨 있음).
  // 비서실(자비스)은 응대·라우팅 헌장이라 콘텐츠 영역이 아님 — 주제 그라운딩 오염 방지 위해 제외.
  const teamLines = (c.teams ?? [])
    .filter((t) => t.id !== 'secretariat')
    .map((t) => `- ${t.name}: ${(t.lead?.specialty || '').replace(/\s+/g, ' ').slice(0, 200)}`)
    .filter((l) => l.length > 6)
    .join('\n');
  if (!teamLines.trim()) return null; // 조직 구성이 없으면 제안 불가

  const done = readSafe(path.join(CONFIG.dataDir, '_shared', `decisions${brandFileSuffix()}.md`)).slice(-500);
  const winners = readStrategyWinners();

  const micro = resolveAssignment().micro;

  // 브랜드 설정 시: 주제를 브랜드 제품·타겟에 조향 + 콜드스타트는 시드 키워드에서 출발 +
  // subNiche 를 제품 라인으로 제약(기존 서브니치 EWMA 가 그대로 '제품 라인별 성과 학습'이 된다).
  const brand = brandContext();
  const seeds = brandSeedKeywords();
  const productLines = brandProductLines();
  const coldstart = seeds.length
    ? `(성과 데이터 없음 — 아래 브랜드 시드 키워드에서 출발해 탐색)\n${seeds.map((k) => `- ${k}`).join('\n')}`
    : '(없음 — 콜드스타트)';
  // 신규성 가드(사용자 원칙 2026-07-15) — 브랜드의 기존 글·쇼츠·카드뉴스 제목+키워드와 유사 금지.
  // 프롬프트 주입(사전)과 findSimilarContent 사후 검사 이중 방어 — 유사하면 기각 사유를 담아 1회 재시도.
  const existing = collectExistingContent(activeBrandSlug() || undefined);
  const existingLines = existing.slice(0, 30)
    .map((e) => `- (${e.kind}) ${e.title}${e.keyword ? ` [키워드: ${e.keyword}]` : ''}`).join('\n');
  const baseUser =
    (brand ? `${brand}\n\n` : '') +
    `[팀·업무 범위]\n${teamLines}\n\n` +
    `[성과 상위 키워드]\n${winners || coldstart}\n\n` +
    `[기존 콘텐츠 — 주제·키워드 유사 금지]\n${existingLines || '(없음)'}\n\n` +
    `[최근 제작 — 중복 회피]\n${done || '(없음)'}\n\n` +
    `[최근 자율주제 — 중복 회피]\n${recentAuto.slice(-5).join('\n') || '(없음)'}\n\n` +
    (productLines.length ? `subNiche 는 반드시 다음 제품 라인 중 가장 관련 있는 하나로: ${productLines.join(' | ')}\n\n` : '') +
    `형식: {"title":"...","keyword":"...","subNiche":"..."}`;

  let rejectNote = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const o = await microJSON<{ title?: unknown; keyword?: unknown; subNiche?: unknown }>(
      micro, IDEA_SYSTEM, rejectNote ? `${baseUser}\n\n${rejectNote}` : baseUser, { maxOutputTokens: 200, signal },
    ).catch(() => null);
    const title = asString(o?.title).trim().replace(/^["'\-•\s]+/, '').slice(0, 120);
    if (!title || recentAuto.includes(title)) return null;
    const keyword = asString(o?.keyword).trim() || undefined;
    const sim = findSimilarContent({ title, ...(keyword ? { keyword } : {}) }, existing);
    if (sim.length) {
      const top = sim[0]!;
      rejectNote = `[직전 제안 기각 — 기존 ${top.kind} "${top.title}"와(과) ${top.via === 'keyword' ? '키워드' : '주제'} 유사] 완전히 다른 주제·키워드로 다시 제안하라.`;
      console.log(`[auto-cycle] 아이디어 기각(기존과 유사) — "${title}" ≈ (${top.kind}) "${top.title}"`);
      continue;
    }
    recentAuto.push(title);
    if (recentAuto.length > 20) recentAuto.shift();
    return { title, keyword, subNiche: asString(o?.subNiche).trim() || undefined };
  }
  return null; // 2회 모두 유사 — 이번 주기 스킵(다음 주기에 새 각도로 재시도)
}

// ============================================================
// 지식 리서치 미션(자율) — 콘텐츠 제작과 별개로, 주기적으로 브랜드 영역의 독자 궁금증·경쟁 콘텐츠
// (네이버 블로그·유튜브)를 조사하는 런을 제안한다. 조사→팀 토론→두뇌(위키) 적재→직원 학습(reflect)의
// 지식 컴파운딩 루프 입구 — 시간이 갈수록 지식은 촘촘해지고 직원은 똑똑해진다(사용자 확정 2026-07-06).
// ============================================================
interface ResearchState { lastTs?: string; prevTs?: string; recent?: string[] }
// slug 인자: 호출 시점의 활성 브랜드가 아니라 '틱 시작 시점에 고정한 브랜드'로 상태를 읽고 쓰기 위한 명시 전달.
// (제안 LLM 대기 수 초 사이 브랜드가 전환되면 기록이 엉뚱한 브랜드 파일로 가던 버그의 봉합점.)
function researchStatePath(slug?: string): string {
  const suffix = slug === undefined ? brandFileSuffix() : (slug ? `-${slug}` : '');
  return path.join(CONFIG.dataDir, '_shared', `research-state${suffix}.json`); // 브랜드별 주기·이력 분리
}
function readResearchState(slug?: string): ResearchState {
  try { return JSON.parse(readSafe(researchStatePath(slug))) as ResearchState; } catch { return {}; }
}
function writeResearchState(st: ResearchState, slug?: string): void {
  try {
    fs.mkdirSync(path.dirname(researchStatePath(slug)), { recursive: true });
    fs.writeFileSync(researchStatePath(slug), JSON.stringify(st, null, 2), 'utf-8');
  } catch { /* 무해 — 기록 실패 시 다음 틱에 리서치가 한 번 더 뜰 뿐 */ }
}

/** 마지막 리서치 런 이후 주기(시간)가 지났는가 — 자율 사이클의 리서치/콘텐츠 분기 게이트. 0=off. */
export function researchDue(hours: number, slug?: string): boolean {
  if (!(hours > 0)) return false;
  const st = readResearchState(slug);
  if (!st.lastTs) return true;
  const t = new Date(st.lastTs).getTime();
  if (!Number.isFinite(t)) return true; // 손상된 lastTs(NaN) — 게이트가 영구히 잠기지 않게 즉시 due 처리
  return Date.now() - t >= hours * 3600_000;
}

/** 리서치 런 시작 기록 — 주기 게이트 갱신 + 최근 미션(중복 회피) 누적. 시작 시점 기록이라 실패해도 폭주하지
 *  않고, 취소(양보) 시엔 rollbackResearchLaunch 가 직전 상태(prevTs)로 되돌려 창이 소각되지 않는다. */
export function recordResearchLaunch(title: string, slug?: string): void {
  const st = readResearchState(slug);
  const recent = [...(st.recent ?? []), title].slice(-10);
  writeResearchState({ lastTs: new Date().toISOString(), prevTs: st.lastTs, recent }, slug);
}

/** 리서치 런 취소(사용자 양보) 롤백 — lastTs 를 직전 값으로 복원하고 미션을 recent 에서 제거해,
 *  조사가 실제로 이뤄지지 않은 영역이 24h 창 소각·중복회피 블랙리스트에 걸리지 않게 한다.
 *  오류 종료는 롤백하지 않는다(계속 실패하는 미션의 틱마다 재시도 폭주 방지 — 기록 시점 트레이드오프 유지). */
export function rollbackResearchLaunch(title: string, slug?: string): void {
  const st = readResearchState(slug);
  writeResearchState({
    ...(st.prevTs ? { lastTs: st.prevTs } : {}),
    recent: (st.recent ?? []).filter((t) => t !== title),
  }, slug);
}

const RESEARCH_SYSTEM =
  '너는 1인 AI 콘텐츠 회사의 리서치 디렉터다. 아래 [팀·업무 범위]가 이 회사의 콘텐츠 영역이다. ' +
  '지금 조사하면 향후 콘텐츠 기획에 가장 가치있는 지식 리서치 미션 한 개를 제안하라.\n' +
  '- 미션은 "독자들이 실제로 궁금해하는 것(질문·고민)"과 "경쟁 콘텐츠(네이버 블로그·유튜브 상위)의 강점·빈틈"을 파악하는 조사다 — 글 제작이 아니다.\n' +
  '- [브랜드 컨텍스트]가 있으면 그 기업의 제품·타겟 고객 관심 영역을 우선하라. 시의성·계절성을 고려한다.\n' +
  '- [최근 리서치]와 중복되지 않게 하라 — 아직 조사되지 않은 영역을 고른다.\n' +
  '- title 은 조사 대상을 담은 한국어 한 줄(예: "7월 장마철 텃밭 관리 — 독자 질문·경쟁 콘텐츠 분석").';

/** 지식 리서치 미션 1건 제안 — 브랜드 컨텍스트·시드 키워드에 그라운딩, 최근 리서치와 중복 회피.
 *  slug: 틱 시작 시점에 고정한 브랜드(researchDue/recordResearchLaunch 와 동일 상태 파일을 보게). */
export async function proposeResearchMission(signal?: AbortSignal, slug?: string): Promise<string | null> {
  const c = getCompany();
  const teamLines = (c.teams ?? [])
    .filter((t) => t.id !== 'secretariat')   // 비서실(자비스) 헌장은 콘텐츠 영역 아님 — 리서치 그라운딩 제외
    .map((t) => `- ${t.name}: ${(t.lead?.specialty || '').replace(/\s+/g, ' ').slice(0, 200)}`)
    .filter((l) => l.length > 6)
    .join('\n');
  if (!teamLines.trim()) return null;
  const brand = brandContext();
  const seeds = brandSeedKeywords();
  const st = readResearchState(slug);
  const user =
    (brand ? `${brand}\n\n` : '') +
    `[팀·업무 범위]\n${teamLines}\n\n` +
    (seeds.length ? `[브랜드 시드 키워드]\n${seeds.map((k) => `- ${k}`).join('\n')}\n\n` : '') +
    `[최근 리서치 — 중복 회피]\n${(st.recent ?? []).slice(-5).join('\n') || '(없음)'}\n\n` +
    `형식: {"title":"..."}`;
  const o = await microJSON<{ title?: unknown }>(
    resolveAssignment().micro, RESEARCH_SYSTEM, user, { maxOutputTokens: 120, signal },
  ).catch(() => null);
  const title = asString(o?.title).trim().replace(/^["'\-•\s]+/, '').slice(0, 120);
  if (!title || (st.recent ?? []).includes(title)) return null;
  return title;
}
