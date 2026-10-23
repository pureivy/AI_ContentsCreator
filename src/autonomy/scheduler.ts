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
import { brandContext, brandProductLines, brandSeedKeywords, activeBrandSlug, brandFileSuffix, offBrandTerm, getBrand, lintLexicon } from '../content/brand';
import { titleTypeGuidanceBlock } from '../analytics/titleTiming';
import { shortsTopicSignalBlock, speciesShortsPerf, hitTitleBlock } from '../analytics/shortsPerf';
import { collectPopularityRows, scoreSpeciesPopularity, naverPrior, speciesPopularityBlock } from '../analytics/speciesPopularity';
import { readBlogSearchQueries } from '../analytics/naverBlogKpi';
import { refreshExtTopics, readExtTopicsSnap, extTopicsBlock, extSuggestionsFor, cultivationTotal, cultivationMeasured } from '../analytics/externalTopics';
import { topicVerdictBlock, avoidVerdictFor, consumeOpportunityVerdict } from '../analytics/topicVerdicts';
import { trendSignalBlock, ytAutocomplete } from '../analytics/trendSignal';
import { naverAutocomplete } from '../grounding/naver_autocomplete';
import { angleVerdict, angleNote, inflowSuggestionsFor, searchless } from '../analytics/angleCheck';
import { assessCandidatesDemand, speciesSeasons, demandSignalBlock, demandRejectBlock, demandRejectFor, rememberDemandReject, rememberDemandRows, demandVerdict, formatDemandLine, normKw, readDemandSnap, familyVolume, type DemandRow, type DemandVerdict } from '../analytics/topicDemand';
import { searchAdEnabled } from '../grounding/naver_searchad';
import { ytNicheBlock } from '../analytics/ytNiche';
import { ensureSeriesLabels, classifyCandidates, seriesScoresFor, gateForLabels, fillLabelsFromKnown, cooldownSummary } from '../analytics/seriesLedger';
import { fallbackSeriesLabels } from '../content/seriesCooldown';
import { seasonalContext } from '../util/solarTerms';
import { offSeasonSubject, seasonalSubjectBlock, formatMonths } from '../content/seasonalSubjects';
import { speciesCoverage, overSpeciesCap, speciesRotationBlock, speciesInText, speciesCapFrom, speciesRecency, usedRecently, speciesRecentBlock } from '../content/speciesRotation';
import { pieceStore } from '../content/pieces';
import { overThemeCap, themeRotationBlock, THEME_MONTHLY_CAP, themeInText, themeRecency, usedThemeRecently, themeRecentBlock, speciesSeed } from '../content/topicThemes';
import { brandThemeCoverage } from '../analytics/discoverySeeds';
import { collectExistingContent, findSimilarContent, saturatedThemes, saturatedThemeMatches } from '../content/novelty';
import { rankSearchDemand, searchDemandBlock, unconvertedSubjects, normalizeTerm } from '../analytics/ytSearchDemand';
import { shortsSearchTerms, igReelViews } from '../analytics/shortsPerf';
import { axisPerformance, axisBlock } from '../analytics/igAxis';
import { isLoreTopic } from '../content/loreTopic';
import { unusedStock, stockBlock, usedSpecies } from '../content/mediaStock';
import { shortsStore } from '../content/shorts';
import { topicTargetBlock, topicPriorityBlock, demandGateForTarget, platformLabel, type ShortsPlatform } from '../content/shortsPlatform';
import { listMedia } from '../content/mediaLibrary';
import { notify } from './notify';
import { findSpecies, findSpeciesLoose } from '../content/species';

export interface AutoCycleDeps<T = string> {
  /** 사이클 주기(ms). ≤0 이면 스케줄러는 no-op. */
  intervalMs: number;
  /** 사용자/기존 런이 진행 중인가(유휴 게이트). true 면 이번 틱을 건너뛴다. */
  isBusy: () => boolean;
  /** 오토런 스위치(사용자 토글) — false 면 틱이 조용히 아무 일도 하지 않는다(타이머는 유지). 미지정 = 항상 온. */
  isEnabled?: () => boolean;
  /** 이번 틱에 처리할 작업(재개 대상 piece 또는 새 아이디어). null 이면 띄우지 않음.
   *  force=true 는 사용자가 직접 실행한 틱(runNow) — 케이던스 간격을 기다리지 않고 즉시 생산한다
   *  (사용자 결정 2026-08-09). 타이머 자동 틱은 force 없음(무인 도배 방지 유지). */
  pickWork: (signal?: AbortSignal, force?: boolean, userTriggered?: boolean) => Promise<T | null>;
  /** 선택된 작업으로 자율 런을 띄운다(main.ts 의 launchRun 으로 위임). */
  launch: (work: T) => void;
  /** 로그 표기용 — 작업을 한 줄로 요약. */
  describe?: (work: T) => string;
  log?: (msg: string) => void;
}

/** 자율 사이클 시작. 반환값은 정지 함수. intervalMs≤0 이면 아무것도 하지 않는다. */
/** 1틱 결과 — busy(런 충돌)만 재시도할 가치가 있는 상태다(idle=할 일 없음, launched=성공). */
export type AutoTickOutcome = 'launched' | 'idle' | 'busy' | 'overlap' | 'error';
/** 정지 함수 + runNow(수동 즉시 1틱) + runNowPersistent(busy 시 재시도 — 슬롯·지시 침묵 소멸 방지). */
export type AutoCycleControl = (() => void) & {
  runNow: () => Promise<AutoTickOutcome>;
  runNowPersistent: (opts?: { label?: string; retryMs?: number; maxAttempts?: number; respectToggle?: boolean; userTriggered?: boolean }) => Promise<AutoTickOutcome>;
};

export function startAutoCycle<T = string>(deps: AutoCycleDeps<T>): AutoCycleControl {
  let ticking = false; // 재진입 가드 — pickWork(LLM)이 주기보다 길어도 틱이 겹쳐 다중 자율런이 뜨지 않게.
  // 핵심 1틱 — isEnabled 게이트 제외(타이머 틱과 수동 실행이 공유). isBusy·재진입은 항상 적용.
  // userTriggered — 사용자가 "자율런" 지시문·수동 틱 버튼으로 직접 촉발한 틱인가(2026-08-29 사용자 확정).
  // force 로는 구분할 수 없다: 정각 슬롯도 force 로 돈다(간격 우회가 목적이라 같다). 그래서 별도 신호로 흘린다.
  const core = async (force = false, userTriggered = false): Promise<AutoTickOutcome> => {
    if (ticking) return 'overlap';
    ticking = true;
    try {
      // 블로커는 사용자 런일 수도, 다른 자율 런(리서치 등)일 수도 있다 — '사용자 런'으로 단정하던
      // 종전 문구는 실사고(2026-08-18: 리서치 런에 밀린 18:00 슬롯) 원인 추적을 헷갈리게 했다.
      if (deps.isBusy()) { deps.log?.('진행 중 런 있음 — 자율 사이클 건너뜀'); return 'busy'; }
      const work = await deps.pickWork(undefined, force, userTriggered);
      // 제안 도중 다른 런이 도착했을 수 있으니 launch 직전 재확인(유휴 게이트 비원자성 완화).
      if (deps.isBusy()) { deps.log?.('제안 도중 다른 런 도착 — 자율 사이클 보류'); return 'busy'; }
      if (work != null) { deps.log?.(`자율 사이클 — "${deps.describe?.(work) ?? String(work)}"`); deps.launch(work); return 'launched'; }
      deps.log?.('자율 사이클 — 처리할 작업 없음(재개 대상·신규 아이디어 모두 없음)');
      return 'idle';
    } catch (e) {
      deps.log?.(`자율 사이클 오류: ${e instanceof Error ? e.message : String(e)}`);
      return 'error';
    } finally {
      ticking = false;
    }
  };
  const timer = (deps.intervalMs > 0)
    ? setInterval(() => {
        if (deps.isEnabled && !deps.isEnabled()) return; // 오토런 오프 — 타이머 틱만 조용히 통과(수동 runNow 는 무관)
        void core();
      }, deps.intervalMs)
    : null;
  if (timer && typeof timer.unref === 'function') timer.unref(); // 프로세스 종료를 막지 않게
  const stop = (() => { if (timer) clearInterval(timer); }) as AutoCycleControl;
  // 수동 즉시 실행(사용자 '자율런 돌려줘') — 토글 무시, isBusy·재진입 가드 유지.
  // force=true: 사용자 지시는 케이던스를 기다리지 않고 즉시 생산(사용자 결정 2026-08-09).
  stop.runNow = () => core(true, true); // 수동 즉시 실행 = 사용자 촉발
  // busy(런 충돌) 시 포기하지 않는 실행 — 정각 슬롯·사용자 오토런 지시가 진행 중 런에 밀려 조용히
  // 소멸하던 실사고(2026-08-18: 30분 유휴 틱의 리서치 런이 18:00 슬롯을 삼킴) 봉합. 동시 대기는 1건만.
  let persistentWaiting = false;
  stop.runNowPersistent = async (opts = {}) => {
    const { label = '자율 틱', retryMs = 180_000, maxAttempts = 10, respectToggle = false, userTriggered = false } = opts;
    if (persistentWaiting) { deps.log?.(`${label} — 이미 재시도 대기 중(중복 요청 무시)`); return 'busy'; }
    persistentWaiting = true;
    try {
      for (let i = 1; ; i++) {
        if (respectToggle && deps.isEnabled && !deps.isEnabled()) return 'idle'; // 대기 중 토글 오프 존중
        const r = await core(true, userTriggered);
        if (r !== 'busy' && r !== 'overlap') return r;
        if (i >= maxAttempts) { deps.log?.(`${label} — 재시도 ${maxAttempts}회 소진(런 장기 점유), 이번 슬롯 포기`); return 'busy'; }
        deps.log?.(`${label} — 진행 중 런 종료 대기, ${Math.max(1, Math.round(retryMs / 60_000))}분 후 재시도(${i}/${maxAttempts})`);
        await new Promise<void>((resolve) => setTimeout(resolve, retryMs));
      }
    } finally {
      persistentWaiting = false;
    }
  };
  return stop;
}

/** 파생 콘텐츠 일일 케이던스 게이트(순수) — lastCreatedTs 에서 24h/N 경과 여부. 호출부가 '자율 생산분의
 *  마지막 생성 ts'만 넘겨(수동 제외) 오토런은 사용자와 무관하게 자기 몫을 채운다. perDay<=0 = off.
 *  손상 ts 는 게이트가 영구히 잠기지 않게 즉시 due. */
export function derivedContentDue(perDay: number, lastCreatedTs: string | undefined, now = Date.now()): boolean {
  if (!(perDay > 0)) return false;
  if (!lastCreatedTs) return true;
  const t = new Date(lastCreatedTs).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t >= 86_400_000 / perDay;
}

// ── 오토런 온/오프 토글(사용자 요청 2026-07-16) — 앱 전역 스위치(브랜드 무관), 재시작에도 유지 ──
// AUTO_CYCLE_MINUTES(주기 설정)와 별개다: 주기는 기능의 존재, 토글은 사용자의 일시 정지 스위치.
const autorunFile = (): string => path.join(CONFIG.dataDir, '_shared', 'autorun.json');

/**
 * 자율런 지시(2026-09-10 사용자 확정) — "보관소의 수종별 수확 후 전정 및 거름주는 방법"처럼 사람이 준 테마 안에서만
 * 주제를 고르게 하는 옵션. 켜져 있으면 아이디어 제안 프롬프트 맨 위에 최우선 블록으로 들어가고, 자율 판단 게이트
 * (수종·축 월 상한, 검색 수요, 계열 쿨다운, 소재 포화, 리서치 폐기)는 기각 대신 로그만 남긴다. 사장님 정책 게이트
 * (브랜드 범위, 시기, 기존 글 유사 금지, 함정어)는 그대로다. 클러스터 형제 공급로는 지시 중 건너뛴다.
 * 끄면 종전 자율런과 바이트 단위로 같다(블록 미주입·게이트 원상). made/maxPieces 로 편수 상한, 두뇌가 '더 낼 주제
 * 없음'이라 답하면 자동으로 꺼지고 알린다.
 */
export interface AutorunDirective {
  text: string;
  on: boolean;
  createdTs: string;
  /** 편수 상한(선택) — 도달하면 자동으로 꺼진다. */
  maxPieces?: number;
  /** 이 지시로 채택된 주제 수. */
  made: number;
  /** 꺼진 사유(상한·수동) 또는 최근 보류 사유(소진) — 화면 표시용. */
  lastResult?: string;
  /** 마지막 소진 판정 시각(2026-09-18) — 지시는 그대로 켜 두고 그 틱만 쉰다. 알림은 이 시각 기준으로 6시간당 1회. */
  exhaustedTs?: string;
}
interface AutorunState { enabled?: boolean; directive?: AutorunDirective }
let _autorunState: AutorunState | undefined;
function autorunState(): AutorunState {
  if (_autorunState === undefined) {
    try {
      const raw = JSON.parse(fs.readFileSync(autorunFile(), 'utf-8')) as AutorunState;
      _autorunState = raw && typeof raw === 'object' ? raw : {};
    } catch { _autorunState = {}; }
  }
  return _autorunState;
}
function writeAutorunState(): void {
  try {
    fs.mkdirSync(path.dirname(autorunFile()), { recursive: true });
    fs.writeFileSync(autorunFile(), JSON.stringify(autorunState()));
  } catch { /* 영속 실패해도 런타임 값은 유효(다음 재시작에 기본값) */ }
}
/** 오토런 켜짐 여부 — 파일 없음/깨짐은 온(기존 동작 불변). 1회 읽고 캐시(틱마다 디스크 안 침). */
export function autoRunEnabled(): boolean { return autorunState().enabled !== false; }
export function setAutoRunEnabled(v: boolean): void { autorunState().enabled = v; writeAutorunState(); }

/** 저장된 지시(꺼진 것 포함) — 화면이 문구를 보여 주고 다시 켤 수 있게. 없으면 null. */
export function autorunDirective(): AutorunDirective | null { return autorunState().directive ?? null; }
/** 지금 적용 중인 지시 — 켜져 있고 문구가 있을 때만. */
export function activeDirective(): AutorunDirective | null {
  const d = autorunState().directive;
  return d && d.on && d.text.trim() ? d : null;
}
/**
 * 지시 설정 — text 를 주면 새 지시(made 0 부터), 없으면 기존 지시의 on/maxPieces 만 바꾼다.
 * text 가 빈 문자열이면 지시 삭제. maxPieces null 은 상한 해제.
 */
export function setAutorunDirective(input: { text?: string; on?: boolean; maxPieces?: number | null }): AutorunDirective | null {
  const st = autorunState();
  if (typeof input.text === 'string') {
    const text = input.text.trim().slice(0, 300);
    if (!text) { delete st.directive; writeAutorunState(); return null; }
    if (!st.directive || st.directive.text !== text) {
      st.directive = { text, on: input.on ?? true, createdTs: new Date().toISOString(), made: 0 };
    } else if (typeof input.on === 'boolean') st.directive.on = input.on;
  } else if (st.directive && typeof input.on === 'boolean') {
    st.directive.on = input.on;
    if (input.on) delete st.directive.lastResult;
  }
  if (st.directive && input.maxPieces !== undefined) {
    if (input.maxPieces === null || !(input.maxPieces > 0)) delete st.directive.maxPieces;
    else st.directive.maxPieces = Math.floor(input.maxPieces);
  }
  writeAutorunState();
  return st.directive ?? null;
}
export function clearAutorunDirective(): void { delete autorunState().directive; writeAutorunState(); }
/** 지시로 주제 하나 채택 — 편수를 올리고 상한에 닿으면 끈다. */
export function noteDirectivePiece(): { made: number; finished: boolean } {
  const d = autorunState().directive;
  if (!d) return { made: 0, finished: false };
  d.made += 1;
  const finished = !!d.maxPieces && d.made >= d.maxPieces;
  if (finished) { d.on = false; d.lastResult = `편수 상한 ${d.maxPieces}편 도달`; }
  writeAutorunState();
  return { made: d.made, finished };
}
/** 소진 알림 간격 — 같은 지시가 계속 소진이면 6시간에 한 번만 알린다(틱마다 울리면 소음). */
export const DIRECTIVE_EXHAUST_NOTIFY_MS = 6 * 3_600_000;
/**
 * 두뇌가 '지시 안에서 더 낼 주제 없음'이라 답함 — **지시는 켜 둔 채** 그 틱만 쉰다(2026-09-18 사장님 확정
 * "지시 유지, 그 틱은 쉬기"). 종전(09-10)엔 여기서 지시를 껐는데, 같은 틱의 채널 폴백이 꺼진 상태로 돌아
 * 지시 밖 수종(편백)을 냈고, 사장님이 다시 켜야 했다. 지시를 끄는 건 사장님뿐이다.
 * 반환: 이번 소진을 알릴 것인가(간격 안이면 false).
 */
export function holdDirective(reason: string, now = new Date()): boolean {
  const d = autorunState().directive;
  if (!d) return false;
  const prev = d.exhaustedTs ? Date.parse(d.exhaustedTs) : NaN;
  const notify = !Number.isFinite(prev) || now.getTime() - prev >= DIRECTIVE_EXHAUST_NOTIFY_MS;
  d.exhaustedTs = now.toISOString();
  d.lastResult = `소진 보류 — ${reason || '더 낼 주제 없음'}`.slice(0, 160);
  writeAutorunState();
  return notify;
}
/** 지시가 이번 틱에 소진 판정을 받았는가(같은 틱의 채널 폴백이 지시 없이 도는 것을 막는다). */
export function directiveExhaustedWithin(ms: number, now = new Date()): boolean {
  const d = autorunState().directive;
  if (!d?.on || !d.exhaustedTs) return false;
  const t = Date.parse(d.exhaustedTs);
  return Number.isFinite(t) && now.getTime() - t < ms;
}

/**
 * 지시 블록(순수) — 아이디어 제안 프롬프트 맨 위. 보관소 수종 목록을 같이 주면 "보관소의 수종별" 같은 지시를
 * 두뇌가 스스로 펼칠 수 있다. 소진 응답 형식을 여기서 정한다(proposeContentIdeas 가 exhausted 를 읽는다).
 */
export function directiveBlock(d: Pick<AutorunDirective, 'text' | 'maxPieces' | 'made'>, librarySpecies: readonly string[] = []): string {
  const lib = librarySpecies.length
    ? `\n· 지시가 '보관소'나 '촬영한 수종'을 가리키면 이 목록에서 고른다(보관소 수종): ${librarySpecies.join(', ')}`
    : '';
  const quota = d.maxPieces ? `\n· 편수 상한 ${d.maxPieces}편 중 ${d.made}편 진행됨.` : '';
  return `[사장님 지시 — 최우선]\n"${d.text}"\n` +
    `· 후보 ${IDEA_CANDIDATES}개는 전부 이 지시 안에서 낸다 — 지시 밖 소재는 제안하지 마라. 지시가 여러 대상(수종별 등)을 뜻하면 대상마다 하나씩 나눠 낸다.${lib}${quota}\n` +
    '· [기존 콘텐츠 — 유사 금지]는 그대로 지킨다 — 지시에 맞아도 이미 다룬 글과 겹치면 다른 대상·다른 대목으로.\n' +
    '· 검색 수요 신호는 참고일 뿐, 이 지시가 그것보다 앞선다(브랜드 범위·시기·함정어 규칙은 그대로).\n' +
    '· 단 로테이션 규칙은 이 지시보다 앞선다(2026-09-17 사장님 확정) — 최근 다룬 수종, 최근 쓴 주제 축,\n' +
    '  축 월 상한, 계열 쿨다운. 전부 코드가 기각한다. 지시 안에서 아직 안 쓴 수종×축 조합으로 내라.\n' +
    '· 지시 안에서 아직 안 다룬 새 주제가 정말 없으면 {"ideas":[],"exhausted":true,"reason":"한 줄"} 로 답하라.';
}
/**
 * 지시가 보관소를 가리키는가(순수) — 그러면 목록 밖 수종을 코드가 막는다(2026-09-16 사용자 확정).
 * 프롬프트에 목록을 줘도 두뇌는 벗어난다: 실측으로 지시 13편 중 2편(포도·아로니아)이 목록 밖이었고,
 * 아로니아는 검색 수요가 사실상 0(10미만/월·계열 최대 0)에 수종 사전에도 없어 자동 학습까지 됐다.
 * 지시 중엔 수요·계열·축 게이트를 통과시키므로 그것들을 잡을 그물이 아예 없었다.
 */
export function directiveWantsLibrary(text: string): boolean {
  return /보관소|촬영|재고|찍은/.test(text || '');
}

/**
 * 후보가 보관소 수종을 가리키지 않는가(순수) — 두 경로가 모두 실패할 때만 true.
 *  ① 목록 이름 글자 대조('감나무' 또는 '나무'를 뗀 어간) — 수종 사전과 무관하다. 사전에 없는 새 이름
 *     (아로니아처럼)도 이 대조로 잡힌다.
 *  ② 사전 표준명 대조 — 별칭으로 쓴 경우('백일홍' → 배롱나무)를 살린다.
 * 목록이 비면 강제할 근거가 없으므로 false(종전 동작).
 */
export function offLibrarySpecies(
  text: string, lib: readonly string[], canon: (t: string) => string | undefined,
): boolean {
  if (!lib.length) return false;
  const t = (text || '').replace(/\s+/g, '');
  const hit = lib.some((sp) => {
    const s = (sp || '').replace(/\s+/g, '');
    if (!s) return false;
    if (t.includes(s)) return true;
    const stem = s.replace(/나무$/, '');
    return stem.length >= 2 && t.includes(stem);
  });
  if (hit) return false;
  const c = canon(text);
  return !(c && lib.includes(c));
}

/** 보관소에 있는 수종(표준명, 중복 제거) — 지시 블록 입력. 실패는 빈 목록. */
export function librarySpeciesFor(slug: string): string[] {
  try {
    const canon = (n: string): string => findSpecies(n)?.name ?? n;
    return [...new Set(listMedia(slug || undefined).map((m) => m.species).filter((s): s is string => !!s).map(canon))];
  } catch { return []; }
}

/**
 * 오토런 지시문 판별(순수) — 주제창에 "오토런 실행해줘" 같은 지시를 치면 콘텐츠 런이 돌아 지시문
 * 제목의 글이 검토함에 쌓였다(실측 3회: "자율런 실행", "오토런 실행해줘"×2 — 2026-08-05·08-08).
 * 짧고(≤15자) 오토런 지칭+실행 동사로만 이루어진 입력만 지시로 본다 — "오토런 기능을 소개하는 글"
 * 같은 정상 주제는 길이·구성에서 걸리지 않는다. 호출부(startHandler)가 런 대신 자율 틱으로 라우팅.
 * 명사부에 콘텐츠런 계열 추가(실측 5번째 변형 2026-08-09: "콘텐츠 란 실행"이 새어 들어가 두뇌 그라운딩
 * 주제 선정 → 참나무 자기 강화 런이 됐다). 단독 "콘텐츠"는 명사부가 아니다(런/란 접미 필수).
 * 확장(2026-08-14): 목적어 조사(을/를) 선택 허용 + 부사 슬롯(좀·한번·지금·다시·바로) + 사동형
 * (실행시켜/실행시키)·돌리 변형 포괄 — "자율런을 실행해줘"·"자율런 좀 돌려줘"·"실행시켜줘"가 새던 구멍.
 * 지시명사 앵커(오토런/자율런 등)+길이 캡은 유지해 정상 주제 오탐을 막는다.
 */
export function isAutorunDirective(topic: string): boolean {
  const t = (topic || '').trim();
  if (!t || t.length > 15) return false;
  return /^(오토런|자율런|자율\s*사이클|콘텐츠\s*[런란])[을를]?(\s*(좀|한번|지금|다시|바로))*(\s*(실행|시작|가동|틱|돌려|돌리)(\s*(시켜|시키|해))?\s*(줘|주세요|라|자)?)?\s*$/.test(t);
}

export interface DailyDeps {
  /** "HH:MM" 로컬 시각. 형식 불일치면 no-op. */
  time: string;
  run: () => void;
  log?: (msg: string) => void;
  /** 발동 이력 영속 키(파일명). 주면 프로세스 재기동에도 '오늘 이미 돌았음'이 유지되고,
   *  예정 시각을 지나 부팅해도 그날 몫을 따라잡는다. 미지정이면 종전(메모리 전용) 동작. */
  key?: string;
  /** 요일(0=일~6=토, JS getDay) — 주면 그 요일에만(매주 1회, 2026-10-22 롱폼). 따라잡기도 그 요일 안에서만
   *  (월 00:00 을 서버가 꺼져 놓쳤으면 월요일 낮에 켜질 때 돈다 — 화요일로 밀리지 않는다). 미지정이면 매일. */
  weekday?: number;
}

/**
 * 오늘 실행 도래 판정(순수) — 예정 시각 **이후 아무 때나** 참(따라잡기).
 *
 * 종전 조건은 `now.getHours() === hh && now.getMinutes() >= mm` 이라 예정 시각이 든 **그 한 시간 안에**
 * 프로세스가 살아 있어야만 발동했다(07:30 이면 07:30~07:59 창). tsx watch 는 TS 를 고칠 때마다 자식을
 * 재기동하므로 그 창을 놓치면 그날 팔로워 스냅샷·성과 동기화가 통째로 사라진다 — 실측 2026-08-02:
 * followers 스냅샷이 07-31 에서 멈춰 08-01 하루가 비었다.
 */
export function dailyDue(now: Date, hh: number, mm: number, today: string, lastFired: string, weekday?: number): boolean {
  if (today === lastFired) return false; // 당일 1회만
  if (weekday !== undefined && now.getDay() !== weekday) return false; // 매주 그 요일만 — 다음 날로 넘어가면 다음 주까지 기다린다
  return now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
}

const dailyStateFile = (key: string): string => path.join(CONFIG.dataDir, '_shared', `daily-${key}.json`);
function readLastFired(key: string): string {
  try { return String((JSON.parse(fs.readFileSync(dailyStateFile(key), 'utf-8')) as { lastFired?: unknown }).lastFired ?? ''); }
  catch { return ''; }
}
function writeLastFired(key: string, day: string): void {
  try {
    const f = dailyStateFile(key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ lastFired: day }), 'utf-8');
  } catch { /* 영속 실패 무해 — 최악의 경우 재기동 시 한 번 더 돈다 */ }
}

/** 매일 지정 시각(로컬)에 1회 run() 호출 — 1분 간격 체크 + 당일 1회 가드. 정지 함수 반환. */
export function startDaily(deps: DailyDeps): () => void {
  const m = /^(\d{1,2}):(\d{2})$/.exec((deps.time || '').trim());
  if (!m) return () => {};
  const hh = Number(m[1]); const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return () => {};
  const weekday = deps.weekday !== undefined && Number.isInteger(deps.weekday) && deps.weekday >= 0 && deps.weekday <= 6 ? deps.weekday : undefined;
  if (deps.weekday !== undefined && weekday === undefined) return () => {}; // 요일 오설정 — 매일로 새지 않게 no-op
  let lastFired = deps.key ? readLastFired(deps.key) : '';
  const tick = (): void => {
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (!dailyDue(now, hh, mm, today, lastFired, weekday)) return;
    lastFired = today;
    if (deps.key) writeLastFired(deps.key, today); // 재기동해도 같은 날 다시 안 돌게
    try { deps.log?.(`일일 브리핑 발송(${deps.time})`); deps.run(); }
    catch (e) { deps.log?.(`일일 브리핑 오류: ${e instanceof Error ? e.message : String(e)}`); }
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
export interface ContentIdea {
  title: string; keyword?: string; subNiche?: string;
  /** 주제를 고를 때 본 채널(2026-09-08) — piece.shortsTarget 으로 기록된다. */
  target?: ShortsPlatform;
  /** 사장님 지시(2026-09-10) 아래서 채택됐는가 — 로그·화면 표시용. */
  directive?: boolean;
}

/**
 * 주제 조향에 쓸 성과 키워드 선별(순수) — 두 겹.
 *
 * 1. **소재 게이트**: banned 에 걸리는 키워드 제외(채소·다육 등).
 * 2. **시대 컷오프**: 브랜드 정체성 재정립 이전에 **처음 측정된** 키워드 제외.
 *    게이트만으로는 부족하다는 게 실측으로 드러났다(2026-08-01: bionditree 상위 8개 중 5개가
 *    여름꽃종류·7월에 심는 꽃·화분곰팡이·여름화분물주기·반려동물 안전한 식물). 이들은 나무 브랜드의
 *    소재가 아니지만 banned 토큰에 안 걸린다 — '꽃'은 꽃나무(배롱나무·벚나무)를 살려야 해서
 *    스톱워드이기 때문이다. 즉 게이트를 조이면 정상 주제가 죽고, 안 조이면 옛 정체성이 살아남는다.
 *    해법은 소재 판정이 아니라 시대 판정이다.
 *
 * 기준 시각은 firstSeenAt(불변) — updatedAt 은 측정창 안에서 매일 갱신돼 컷오프를 무너뜨린다.
 * 구파일 호환: firstSeenAt 이 없으면 updatedAt 으로 대체(readStrategy 가 백필하지만 직접 파싱 경로도 있다).
 * since 미설정이면 시대 필터 없음 — 정체성을 바꾼 적 없는 브랜드는 종전 동작 그대로.
 */
export function eligibleWinners<T extends { keyword?: string; firstSeenAt?: string; updatedAt?: string }>(
  winners: T[], since?: string,
): T[] {
  return winners.filter((w) => {
    if (!w || !w.keyword || offBrandTerm(w.keyword)) return false;
    if (!since) return true;
    const born = (w.firstSeenAt || w.updatedAt || '').slice(0, 10);
    return born ? born >= since : false; // 시각을 모르면 옛 것으로 본다(보수적)
  });
}

// 성과 전략(analytics/strategy.json, 6d 연동) 있으면 승자 키워드를 아이디어 재료로 — 없으면 콜드스타트(무시).
/** 최근 30일 블로그의 수종별 편수(브랜드 카탈로그 기준) — 후보 루프·예고·클러스터 게이트가 공유. */
export function speciesCoverageFor(slug: string | undefined, now = new Date()): Map<string, number> {
  try {
    const items = pieceStore().list()
      .filter((p) => (p.brand ?? '') === (slug ?? '') && p.stage !== 'idea' && p.stage !== 'error')
      .map((p) => ({ title: p.title, keyword: p.keyword, ts: p.createdTs }));
    return speciesCoverage(items, getBrand()?.speciesCatalog, now);
  } catch { return new Map(); }
}

/**
 * 수종 판정 눈(최근 수종 게이트 전용) — **수종 사전 먼저**, 없으면 브랜드 카탈로그.
 *
 * 순서가 중요하다. 카탈로그(brand.yaml)는 로테이션 가족으로 묶여 있어 체리나무가 앵두나무를, 단풍나무가
 * 공작단풍을 별칭으로 흡수한다. 카운트 상한에서는 무해한 근사였다(두 수종이 2편을 나눠 쓴다). 하지만
 * 날짜 창에서는 '같은 수종이다'라는 단정이 되어, 체리 글 하나가 앵두를 한 달간 잠근다. 사장님의 수종
 * 사전(data/species.yaml)은 둘을 별개로 두고 있고, 공작단풍나무 학명은 사장님이 직접 정정했다
 * (2026-09-08 — 일반 단풍으로 적혀 있어 맞게 그린 씬이 반려됐다). 그 눈을 따른다.
 * 사전에 없는 이름은 카탈로그로 떨어지고, 둘 다 없으면 null(수종 없는 주제 — 게이트 대상 아님).
 *
 * 최근 수종 지도와 후보 검사는 반드시 이 함수를 같이 써야 한다(다른 눈을 쓰면 키가 안 맞아
 * 게이트가 조용히 통과한다). 카운트 상한·로테이션 블록은 종전 눈(카탈로그) 그대로다.
 */
function speciesKeyOf(text: string): string | null {
  return findSpeciesLoose(text)?.name ?? speciesInText(text, getBrand()?.speciesCatalog) ?? null;
}

/** 로테이션 지도의 재료 — 이 브랜드의 종료되지 않은 블로그 편(아이디어·에러 제외). */
function rotationItems(slug: string | undefined): Array<{ title: string; keyword?: string; ts: string }> {
  return pieceStore().list()
    .filter((p) => (p.brand ?? '') === (slug ?? '') && p.stage !== 'idea' && p.stage !== 'error')
    .map((p) => ({ title: p.title, keyword: p.keyword, ts: p.createdTs }));
}

/** 사실 부족 기록(2026-09-17)을 로테이션 재료 꼴로 — rotationItems 는 error 조각을 빼므로 별도. ts 는 부족 판정 시각.
 *  kind(2026-09-18): 'lore'=이야기 사실 부족(그 수종의 이야기 각도만 막는다), 'general'=고유 사실 전체 부족(수종 자체를 막는다). */
export function factStarvedItems(
  pieces: Array<{ title: string; keyword?: string; brand?: string; factStarved?: { ts: string; kind?: string } }>, slug: string | undefined,
  kind: 'general' | 'lore' = 'general',
): Array<{ title: string; keyword?: string; ts: string }> {
  return pieces
    .filter((p) => (p.brand ?? '') === (slug ?? '') && p.factStarved?.ts && ((p.factStarved.kind === 'lore') === (kind === 'lore')))
    .map((p) => ({ title: p.title, ...(p.keyword ? { keyword: p.keyword } : {}), ts: p.factStarved!.ts }));
}
/** 최근 CONFIG.factStarvedDays 안에 사실 부족으로 닫힌 수종 → 며칠 전. */
export function factStarvedRecencyFor(slug: string | undefined, now = new Date(), kind: 'general' | 'lore' = 'general'): Map<string, number> {
  try { return speciesRecency(factStarvedItems(pieceStore().list(), slug, kind), speciesKeyOf, now, CONFIG.factStarvedDays); }
  catch { return new Map(); }
}
/** 후보가 사실 부족 수종인가(순수) — 일반 부족은 각도 불문, 이야기 부족은 후보가 이야기 축일 때만 잡는다.
 *  마가목 실측(2026-09-18): 재배 사실 17건·이야기 3건 — 재배 글은 열어 두고 "설화" 각도만 막아야 한다. */
export function starvedHit(text: string, general: Map<string, number>, lore: Map<string, number>): { name: string; daysAgo: number; kind: 'general' | 'lore' } | null {
  const g = usedRecently(text, general, speciesKeyOf);
  if (g) return { ...g, kind: 'general' };
  if (!isLoreTopic(text)) return null;
  const l = usedRecently(text, lore, speciesKeyOf);
  return l ? { ...l, kind: 'lore' } : null;
}

/** 최근 CONFIG.speciesRecentDays 일 안에 다룬 수종 → 며칠 전. 후보 루프·예고·클러스터 게이트 공용. */
export function speciesRecencyFor(slug: string | undefined, now = new Date()): Map<string, number> {
  try { return speciesRecency(rotationItems(slug), speciesKeyOf, now, CONFIG.speciesRecentDays); }
  catch { return new Map(); }
}

/** 축 판정 눈(공용) — 지도와 후보 검사가 같이 써야 한다. 상한 게이트(overThemeCap)와도 같은 눈이다. */
function themeKeyOf(text: string): string | null {
  return themeInText(text, getBrand()?.topicThemes);
}

/** 최근 CONFIG.themeRecentDays 일 안에 쓴 주제 축 → 며칠 전. 수종 창과 직교. */
export function themeRecencyFor(slug: string | undefined, now = new Date()): Map<string, number> {
  try { return themeRecency(rotationItems(slug), themeKeyOf, now, CONFIG.themeRecentDays); }
  catch { return new Map(); }
}

/** 후보 한 건이 최근 축인가 — 예고·클러스터 경로(main.ts)용. */
export function usedThemeRecentlyFor(text: string, slug: string | undefined, now = new Date()): { theme: string; daysAgo: number } | null {
  if (CONFIG.themeRecentDays <= 0) return null;
  return usedThemeRecently(text, themeRecencyFor(slug, now), themeKeyOf);
}

/**
 * 후보 한 건이 최근 수종인가 — 예고·클러스터 경로(main.ts)용 편의 함수. 지도를 매번 새로 만든다
 * (경로당 후보 1건이라 비용이 무의미하고, 틱 사이 코퍼스 변화를 그대로 반영한다).
 */
export function usedRecentlyFor(text: string, slug: string | undefined, now = new Date()): { name: string; daysAgo: number } | null {
  if (CONFIG.speciesRecentDays <= 0) return null;
  return usedRecently(text, speciesRecencyFor(slug, now), speciesKeyOf);
}

/** 후보 한 건이 최근 사실 부족으로 닫힌 수종인가 — 예고·클러스터 경로(main.ts)용. 후보 루프의 같은 게이트와 같은 눈.
 *  rotationItems 는 error 조각을 빼므로 usedRecentlyFor 로는 안 보인다(최종 리뷰 I1). */
export function factStarvedRecentlyFor(text: string, slug: string | undefined, now = new Date()): { name: string; daysAgo: number; kind: 'general' | 'lore' } | null {
  if (CONFIG.factStarvedDays <= 0) return null;
  return starvedHit(text, factStarvedRecencyFor(slug, now), factStarvedRecencyFor(slug, now, 'lore'));
}

function readStrategyWinners(): string {
  try {
    const slug = activeBrandSlug();
    const raw = JSON.parse(readSafe(path.join(CONFIG.dataDir, 'analytics', slug ? `strategy-${slug}.json` : 'strategy.json'))) as {
      winners?: Array<{ keyword?: string; score?: number }>;
    };
    const cov = speciesCoverageFor(slug || undefined);
    const themeCovW = brandThemeCoverage(new Date(), slug || '');
    const recentSp = speciesRecencyFor(slug || undefined);
    return eligibleWinners(raw.winners ?? [], getBrand()?.perfEraSince)
      // 월 상한에 닿은 수종의 성과 키워드는 빼서 '통했던 배롱'이 매 틱 되주입되는 고리를 끊는다(2026-08-27).
      .filter((w) => !overSpeciesCap(w.keyword ?? '', cov, getBrand()?.speciesCatalog))
      // 최근 창 안에 다룬 수종도 같은 이유로 뺀다(2026-09-17) — 아래 후보 게이트가 기각할 소재를
      // '통했던 키워드'로 들이밀면 후보 8개가 통째로 코드 기각으로 날아간다.
      .filter((w) => !usedRecently(w.keyword ?? '', recentSp, speciesKeyOf))
      .filter((w) => !overThemeCap(w.keyword ?? '', themeCovW, getBrand()?.topicThemes))   // 축 상한도 같은 이유(수렴 고리 차단)
      .slice(0, 8)
      .map((w) => `- ${w.keyword}${typeof w.score === 'number' ? ` (점수 ${w.score.toFixed(2)})` : ''}`)
      .join('\n');
  } catch { return ''; }
}

/**
 * 시드 키워드 블록(순수) — 성과 winners 와 **나란히** 주기 위한 것.
 *
 * 종전 프롬프트는 `winners || coldstart` 하나뿐이라, winners 가 한 줄이라도 있으면 시드가 통째로
 * 사라졌다. 그래서 브랜드 yaml 의 seedKeywords 에 새 축을 넣어도 주제 선정에 아무 영향이 없었다
 * (실측 2026-08-01: bionditree winners 19개 중 게이트 통과 8개 → 시드 16개 전부 미주입).
 * 게다가 살아남은 winners 는 정체성 재정립(07-31) 전에 쌓인 것이라 '여름꽃종류'·'7월에 심는 꽃'처럼
 * 지금 축과 무관한 소재가 섞여 있다 — '꽃'은 신규성 스톱워드라 소재 게이트가 걸러내지 못한다.
 *
 * winners 가 비었을 땐 coldstart 가 이미 같은 시드를 담으므로 빈 문자열(중복 주입 방지).
 */
export function seedKeywordBlock(winners: string, seeds: string[]): string {
  if (!winners || !seeds.length) return '';
  return `[브랜드 시드 키워드(성과가 아직 없는 축 — 위 성과 키워드 대신 여기서 골라도 된다)]\n${seeds.map((k) => `- ${k}`).join('\n')}\n\n`;
}

const IDEA_SYSTEM =
  '너는 1인 AI 콘텐츠 회사의 자율 편집 기획자다. 소재 범위의 기준은 [브랜드 컨텍스트]다 — 소개가 말하는 영역 안에서만, ' +
  '금지 목록의 소재는 절대 제안하지 마라. [팀·업무 범위]는 제작 공정 설명일 뿐 소재 범위가 아니다. ' +
  '다음에 제작하면 검색 노출·유입에 가치있는 네이버 블로그 콘텐츠 아이디어(정보·하우투·리뷰와 **읽을 거리** — 전설·설화·꽃말·유래·역사·쓰임새·문학·명소처럼 수종과 얽힌 이야기)를 서로 소재가 다른 8개, 가장 자신 있는 것부터 순서대로 제안하라(2026-08-27 사용자 확정 8개 — 검색량·시기·수종 게이트가 겹쳐 후보가 전멸하지 않게 폭을 넓힌다).\n' +
  // 2026-09-18 정정 — "최소 2개"가 보관소 수종(묘목장 나무, 이야기 거의 없음) 틱에서 없는 이야기를 지어내게 했고,
  // 분류어(설화·전설)가 제목에 그대로 박혔다(실측: "마가목 설화와 자생지, …옮기는 법" — 설화 없음). 있을 때만, 내용으로.
  '- 읽을 거리 후보는 그 수종에 실제로 전해지는 이야기가 있을 때만 낸다 — 궁궐·서원·마을의 오래된 나무, 천연기념물·보호수, 널리 알려진 꽃말, 기록된 이름 유래, 고사·문학 속 나무. 있으면 최대 2개, 없으면 0개(억지로 채우지 마라 — 묘목장 수종 대부분은 이야기가 없다). "설화·전설·꽃말" 같은 분류어를 제목에 붙여 이야기 글처럼 보이게 하지 말고 이야기의 내용을 제목으로 써라(예: keyword "회화나무" + 제목 "회화나무가 선비의 나무가 된 이유"). 이야기 후보의 keyword 는 수종명 그대로. 시의성·계절성도 고려한다.\n' +
  '- [브랜드 컨텍스트]가 있으면 그 기업의 제품·타겟 고객의 관심사와 자연스럽게 연결되는 주제를 우선하라(노골적 광고성 주제 금지 — 독자에게 유용한 정보가 우선).\n' +
  '- [성과 상위 키워드]는 어떤 분야가 통했는지의 참고다 — 그 분야의 인접·연관 영역에서 새로운 키워드를 발굴하라(성과 키워드 자체나 그 변형의 재사용은 금지). 없으면(콜드스타트) 영역 안에서 다양하게 탐색한다.\n' +
  '- 단, 성과 기록에는 브랜드 범위가 지금과 달랐던 시절의 주제가 남아 있을 수 있다. 그런 키워드는 "무엇이 통했나"의 신호(예: 계절 타이밍·비교·증상 진단 같은 접근 방식)로만 읽고, 그 소재 자체나 인접 소재로 확장하지 마라 — 소재 범위의 기준은 언제나 [브랜드 컨텍스트]다.\n' +
  '- [최근 제작]·[최근 자율주제]와 중복되지 않게 하라.\n' +
  '- [기존 콘텐츠]와 겹치지 않는 새 소재를 우선하라. 좋은 주제가 기존과 겹치면 버리지 말고, 기존 글과 뚜렷이 다른 시각(대상·상황·계절·관점)을 잡아 제안하라(사용자 원칙 2026-08-14 — 종전 "완전히 새로운 각도만"에서 개정).\n' +
  '- title 은 클릭·검색에 유리한 한국어 제목, keyword 는 검색량 있을 법한 핵심 타겟 키워드 1개, subNiche 는 세부 분야다.\n' +
  '- keyword 는 사람이 실제로 검색창에 치는 말이다. [검색 수요 실측] 표에 있는 표기를 그대로 쓰는 것이 제일 좋다.\n' +
  '- **검색량이 큰 표기가 수종명 한 어절이면 그대로 keyword 로 써라.** 각도는 제목이 진다 — keyword "능소화" + 제목 ' +
  '"능소화, 벽이 상하는 이유와 올바른 심기"처럼. 키워드를 "능소화 심는 법"으로 좁히면 수요만 잃고 각도는 그대로다(실측: 능소화 47,000 vs 좁힌 표기 대부분 0~30).\n' +
  '- 표에 없는 소재라면 2~3어절(수종명+행위·대상: "매실나무 가지치기", "사과나무 묘목")로 써라. 설명형 구절("묘목 식재 흙 준비" 식)은 검색량이 0이라 코드가 기각한다.';

/**
 * 다음에 제작할 콘텐츠 아이디어 1건 제안 — 조직 헌장(팀·업무 범위) + 성과 전략(strategy.json)에 그라운딩.
 * 위키 인덱스는 주제 생성에서 제외(anti-drift): 과거 적재 자료로 편향되는 피드백 루프를 끊는다(구 gov 버전의 근본 교훈 유지).
 * 모델 — 클라우드 micro(haiku). (Ollama 로컬 분기는 백엔드 제거와 함께 삭제 — 2026-07-06)
 */
// 콘텐츠 각도 메뉴(브랜드 무관) — 아이디어가 매번 '계절 케어 하우투'로 수렴하지 않게 각도를 로테이션한다.
// '다음 시즌·시기 대비' 축은 제거(2026-08-27 사용자 확정 "지금~다음 달만" — 8월 말 단풍 실사고). 시의성은
// seasonalContext(절기)와 [시기 밖 소재] 블록이 담당한다.
const IDEA_ANGLES = [
  '하우투(단계별 실행 절차)', '구매·선택 가이드(옵션 비교·고르는 기준)', '흔한 실패·오해 바로잡기',
  '초보 입문(처음 시작하는 사람 기준)', '증상·상황별 진단',
  '실제 사례·후기 관점', '한 가지 쟁점 깊이 파기',
  '읽을 거리(전설·설화·꽃말·유래·역사·쓰임새·문학·명소 속 이 나무)',
];
/** 후보 파서(순수, 테스트 대상) — {ideas:[...]} 8후보 응답을 방어적으로 정규화. 구형 단일 오브젝트
 *  응답({title,...})도 1건 목록으로 수용(하위호환). 제목 정리·중복 제거·상한. */
export const IDEA_CANDIDATES = 8; // 2026-08-27 사용자 확정(5→8)
export function normalizeIdeaCandidates(raw: unknown, max = IDEA_CANDIDATES): Array<{ title: string; keyword?: string; subNiche?: string }> {
  const src = (raw as { ideas?: unknown } | null)?.ideas;
  const list = Array.isArray(src) ? src : [raw];
  const out: Array<{ title: string; keyword?: string; subNiche?: string }> = [];
  const seen = new Set<string>();
  for (const o of list) {
    const title = asString((o as { title?: unknown } | null)?.title).trim().replace(/^["'\-•\s]+/, '').slice(0, 120);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const keyword = asString((o as { keyword?: unknown } | null)?.keyword).trim();
    const subNiche = asString((o as { subNiche?: unknown } | null)?.subNiche).trim();
    out.push({ title, ...(keyword ? { keyword } : {}), ...(subNiche ? { subNiche } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

/** 이름·꽃말·상징 유래 주제의 수종 앵커 부재 판정(순수, 테스트 대상) — '회화나무 꽃말'은 통과,
 *  '튤립 꽃말'·'나무 이름 유래'(총칭)는 기각. '~나무' 표기가 한국어 수종명 대부분을 커버한다. */
export function lacksSpeciesAnchor(text: string): boolean {
  const t = (text || '').normalize('NFC');
  // '상징'은 수사적 사용("가을의 상징")이 흔해 트리거에서 제외 — 축의 핵심 표지만 본다.
  // 2026-09-17 읽을 거리 축 — 전설·설화·민담·신화도 같은 함정(총칭·화초 미끄러짐)이라 트리거에 넣는다.
  if (!/꽃말|유래|전설|설화|민담|신화/.test(t)) return false;
  // 앵커 = 수종 사전 적중(능소화·무궁화처럼 '나무'로 안 끝나는 수종) 또는 ○○나무 표기.
  if (findSpeciesLoose(t)) return false;
  return !/[가-힣]{1,6}나무/.test(t);
}

/**
 * 수종 필수 게이트(2026-10-02, BLOG_REQUIRE_SPECIES) — 메인 키워드가 구체적 수종을 부르는가.
 *
 * 자체 데이터(공개 163편): 조회수를 확실히 가르는 건 하나뿐이었다 — 메인 키워드에 수종이 있느냐. 기간을 맞춰도
 * 14일 ×1.4(p=0.04)·30일 ×2.5(n=66), 묘목 글 안에서 중앙 23 vs 6. 하위 15편은 대부분 "가을 물주기 시기"·
 * "정원 상태 진단"·"묘목선별"·"그늘 정원 나무" 같은 수종 없는 주제였고, 실제 검색 유입어의 81%가
 * '수종 + 증상·시기 질문'("자두나무 가지치기 언제")이다.
 *
 * 눈은 최근 수종 게이트와 같다(speciesKeyOf: 사전 느슨 → 카탈로그) — 매실·음나무(엄나무)·블루베리처럼 '나무'를
 * 떼고 쓰거나 사전에 없는 카탈로그 수종도 잡는다. 다만 느슨한 어간이 식물 용어 속에서 가짜로 걸리는 자리는
 * 가린다 — 로그·조각 전수 대조(10-02)에서 나온 진짜 오탐은 둘뿐이었다: '도장지'(회양목 별칭 도장나무의 어간)·
 * '포도당'(포도). 가리지 않으면 "여름 도장지 정리"가 회양목 글로 통과하고, 보정이 키워드에 '도장'을 박는다.
 */
const SPECIES_FALSE_STEMS = /도장지|포도당/g;
export function requiredSpeciesOf(text: string, keyOf: (t: string) => string | null = speciesKeyOf): string | null {
  const t = String(text ?? '').normalize('NFC').replace(SPECIES_FALSE_STEMS, ' ');
  return t.trim() ? keyOf(t) : null;
}

/**
 * 검색량 하한 면제 대상인가(2026-10-02 사장님 결정 "수종 키워드는 하한 면제", DEMAND_FLOOR_SPECIES_EXEMPT) — 판정 눈은 수종 필수
 * 게이트와 같다(requiredSpeciesOf). 자체 데이터: 조회수는 검색량과 상관이 없었고 실제 유입의 81%가 '수종 + 증상·시기' 롱테일
 * (검색량 아주 작음)이었다 — 상위 글 "감나무 깍지벌레"도 검색량은 작았다. 수종 없는 일반 키워드는 하한 그대로다.
 */
export function speciesFloorExempt(
  keyword: string | undefined, on: boolean = CONFIG.demandFloorSpeciesExempt,
  speciesOf: (t: string) => string | null = requiredSpeciesOf,
): boolean {
  return on && !!keyword && !!speciesOf(keyword);
}

/**
 * 기각 기억 조회(2026-10-02 2차 리뷰) — 하한 면제 키워드(speciesFloorExempt)는 기억을 보지 않고 실제 조회로 간다. 면제 전 하한으로
 * 쌓인 기억이 30일 동안 그 키워드를 막지 않게, 그리고 시즌 판정·로그가 실제 행으로 돌게 한다. 후보 루프와 예고·클러스터
 * (main.demandCheckFor)가 같은 규칙을 쓰도록 한 곳에 둔다.
 */
export function rememberedDemandReject(
  slug: string, keyword: string | undefined,
  exempt: (keyword: string) => boolean = (k) => speciesFloorExempt(k),
  lookup: (slug: string, keyword: string | undefined) => ReturnType<typeof demandRejectFor> = demandRejectFor,
): ReturnType<typeof demandRejectFor> {
  return keyword && exempt(keyword) ? null : lookup(slug, keyword);
}

/**
 * 이번 틱에 수종 필수를 거는가(순수) — 사람이 고른 주제는 걸지 않는다.
 * 수동 런·예고 이행은 proposeContentIdeas 를 거치지 않으므로 애초에 대상이 아니다. 여기서 가르는 건 지시뿐이다:
 * 지시문이 수종을 정하지 않으면("정원 관리 글") 사장님이 일반 주제를 고른 것이라 면제한다. 지시가 수종을 부르거나
 * 보관소(=수종 목록)를 가리키면 수종에 묶인 지시라 그대로 건다 — 보관소 지시는 libGate 가 이미 제목·키워드 어딘가의
 * 수종을 강제하므로, 이 게이트가 더하는 건 '그 수종을 키워드로 옮기기'뿐이다.
 */
export function speciesRequiredFor(
  on: boolean, directive: { text: string } | null | undefined,
  speciesOf: (t: string) => string | null = requiredSpeciesOf,
): boolean {
  if (!on) return false;
  if (!directive) return true;
  return directiveWantsLibrary(directive.text) || !!speciesOf(directive.text);
}

// 낱말 끝 조사 — 긴 것부터(에서·으로가 에·로보다 먼저).
const JOSA_TAIL = /(에서|으로|부터|까지|보다|처럼|이란|이|가|를|을|은|는|의|에|도|만|로|와|과|란)$/;

/**
 * 제목에 실제로 쓰인 수종 표기(순수) — 대표명이 아니라 글자 그대로. '매실'은 사전에서 설중매나무(별칭)로
 * 풀리는데, 대표명을 키워드에 넣으면 "설중매나무 가지치기"처럼 아무도 안 치는 말이 된다.
 * 낱말 단위로 보고 끝의 조사만 뗀다(떼고도 같은 수종일 때만 — '포도'의 '도'를 조사로 떼면 수종이 사라진다).
 */
export function speciesSurfaceIn(text: string, speciesOf: (t: string) => string | null = requiredSpeciesOf): string | null {
  for (const raw of String(text ?? '').normalize('NFC').split(/[\s,·…!?:;"'“”‘’()[\]/|~—]+/)) {
    const w = raw.replace(/[.\-]+$/, '');
    if (!w) continue;
    const sp = speciesOf(w);
    if (!sp) continue;
    const m = w.match(JOSA_TAIL);
    if (m) {
      const stem = w.slice(0, -m[0].length);
      if (stem && speciesOf(stem) === sp) return stem;
    }
    return w;
  }
  return null;
}

/**
 * 결정적 구제(순수) — 키워드엔 수종이 없는데 제목이 수종을 부르면 그 수종을 키워드로 옮긴다(기각하지 않는다).
 * "나무 심는 깊이" + 제목 "블루베리, 심는 깊이가…" → "블루베리 심는 깊이". 옮기는 규칙은 speciesSeed(09-29 축 씨앗
 * 보정과 같은 함수) — 홀로 선 '나무' 자리를 수종이 차지하고, 없으면 앞에 붙인다.
 * 키워드가 없으면 메인 키워드는 제목이라(하류가 제목에서 뽑는다) 바꿀 것이 없다.
 */
export function bindSpeciesKeyword<T extends { title: string; keyword?: string }>(
  cand: T, speciesOf: (t: string) => string | null = requiredSpeciesOf,
): { cand: T; from?: string } {
  if (!cand.keyword || speciesOf(cand.keyword)) return { cand };
  const surface = speciesSurfaceIn(cand.title, speciesOf);
  if (!surface) return { cand };
  return { cand: { ...cand, keyword: speciesSeed(cand.keyword, surface) }, from: cand.keyword };
}

/**
 * 축 씨앗에 붙일 '지금 쓸 수 있는' 수종(순수) — 수종 필수 틱에서 themeRotationBlock 예시를 일반어("나무 심는 깊이")
 * 대신 수종 표기("○○ 심는 깊이")로 적기 위한 목록. 막힌 수종(최근 창·월 상한·사실 부족)은 빼고, 수요 표에서
 * 시즌 지수가 하한 미만으로 실측된 수종도 뺀다(모름은 남긴다 — 수요 목록 밖 틈새를 막지 않는 기존 원칙).
 * 검색량 큰 순, 같으면 카탈로그 순. 비면 빈 배열 → 블록은 종전 일반 씨앗 그대로(게이트·프롬프트 줄이 따로 말한다).
 */
export function inSeasonSpecies(
  names: readonly string[],
  opts: { blocked: (n: string) => boolean; volumeOf: (n: string) => number | undefined; seasonOf: (n: string) => number | undefined; minSeason: number; limit?: number },
): string[] {
  return [...new Set(names)]
    .filter((n) => n && !opts.blocked(n))
    .filter((n) => { const s = opts.seasonOf(n); return s === undefined || s >= opts.minSeason; })
    .map((n, i) => ({ n, i, v: opts.volumeOf(n) ?? 0 }))
    .sort((a, b) => (b.v - a.v) || (a.i - b.i))
    .slice(0, opts.limit ?? 12)
    .map((e) => e.n);
}

/** 수종 필수 프롬프트 블록 — 예시는 형식만(09-18 '설화 딱지' 교훈: 예시 구절은 그대로 출력에 박힌다).
 *  floorExempt(수종 키워드 하한 면제, 2026-10-02) 면 마지막 줄이 '수종 + 증상·시기 질문 롱테일을 keyword 로'가 된다 — 종전 줄은
 *  "표에 없는 긴 질문형 keyword 는 하한에 걸린다"며 수종명 단독으로 물러서게 했는데, 면제 뒤엔 그 롱테일이 바로 노릴 자리다.
 *  off 면 종전 문구 그대로. */
export function speciesRequiredBlock(floorExempt: boolean): string {
  return '[수종 필수 — 자체 데이터(2026-10-02)]\n' +
    '· 후보마다 구체적인 수종 하나에 묶어라. keyword 에 수종명이 반드시 들어간다 — 수종 없는 일반 키워드(형식: "나무 심는 깊이"·"묘목 고르는 법"·"정원 나무 추천")는 코드가 기각한다.\n' +
    '  근거: 우리 블로그에서 수종이 키워드에 있는 글은 같은 기간 조회가 1.4~2.5배였고, 하위권은 거의 다 수종 없는 일반 주제였다.\n' +
    '· 일반 소재(심기·물주기·거름·지지대·울타리·도구…)는 지금 철에 맞는 수종 하나를 골라 그 수종의 이야기로 좁혀라(형식: "○○ 심는 깊이", "○○ 묘목 고르는 법"). 추천·종류 글도 대표 수종 하나를 keyword 로 세운다.\n' +
    (floorExempt
      ? '· 실제 검색 유입의 81%가 "수종 + 증상·시기 질문"이다(형식: "○○나무 가지치기 언제", "○○나무 잎 마름 증상", "○○ 열매 안 열리는 이유"). keyword 를 이런 수종 + 증상·시기 질문 롱테일로 세워라 — 수종이 든 keyword 는 검색량 하한을 걸지 않는다(검색량이 작아도 기각되지 않는다. 우리 글 조회수는 검색량과 상관이 없었다). [검색 수요 실측]·연관어 표에 같은 뜻의 표기가 있으면 그 표기를 쓴다.\n'
      : '· 실제 검색 유입의 81%가 "수종 + 증상·시기 질문"이다(형식: "○○나무 가지치기 언제", "○○나무 잎 마름 증상"). 그런 표기가 [검색 수요 실측]·연관어 표에 있으면 그대로 keyword 로 쓰고, 없으면 keyword 는 수종명(또는 수종명+행위 2어절)으로 두고 질문은 제목이 진다 — 표에 없는 긴 질문형 keyword 는 검색량 하한에 걸린다.\n');
}

/**
 * 후보 1건의 검색 수요 판정 + 로그·기각사유 문구(순수, 테스트 대상).
 *
 * 종전 주제 선정은 절대 검색량을 한 번도 보지 않았다 — 실측(2026-08-26)으로 우리가 쓰던 롱테일이
 * 0~30/월이었고('가을 거름' 0·'유실수 가을 시비' 0·'사과나무 비료' 30), '비료' 계열은 데이터랩
 * 8월 지수가 3월의 13% 였다. 소재가 아니라 **표기와 시기**가 문제였다는 뜻이라, 후보 단계에서
 * 이 둘을 갈라 본다: 검색량 하한 미달만 하드 기각, 비수기는 후순위(demote)다.
 *
 * rows 에 없는 키워드(미조회·조회 실패·keyword 없음)는 unknown — 게이트를 통째로 생략한다(fail-open).
 * '수요가 없다'는 단정은 실제 응답을 받았을 때만 한다.
 *
 * opts.relax: 마지막 라운드의 기아 방지 밸브 — 하한 미달을 기각 대신 후순위로 낮춘다(`relaxed: true`).
 * 통과·비수기 판정은 건드리지 않는다(밸브가 만든 후순위인지 원래 비수기인지 채택 로그가 갈려야 하므로).
 *
 * opts.remembered: 지난 틱에 실측으로 하한 미달을 받아 기억된 키워드(2026-08-27) — rows 를 아예 보지 않고
 * 그때의 실측 줄로 판정한다(그래서 호출부는 이 후보를 API 조회 대상에서도 뺀다 — 조회 비용 0).
 *
 * opts.floorExempt: 검색량 하한 면제 판정(2026-10-02, 기본 speciesFloorExempt — 수종 키워드). 면제 키워드는 하한 미달이어도
 * 기각하지 않고 시즌 지수만 본다(통과 또는 비수기 demote, `exempted: true`, 줄 끝에 '수종 키워드 하한 면제'). 행이 없으면(미조회·
 * 조회 실패) 종전과 같은 unknown — 면제가 '모름'을 통과로 바꾸는 일은 없다(원래 통과다). 기억된 기각도 보지 않는다:
 * 면제 전 하한으로 쌓인 기억이 30일 동안 그 키워드를 계속 막는다.
 *
 * opts.speciesSeason(2026-10-20): 면제 키워드 행에 시즌 지수가 없으면(10미만/월이라 데이터랩에도 없음 — 면제 50건 중 41건)
 * '시즌만 본다'가 아무것도 안 보는 통과가 됐다(10월 "화분 겹벚나무" 5월 꽃 글 실사고). 그때만 수종 이름의 시즌으로 대신 보고,
 * cfg.minSpeciesSeason 미만이면 비수기 demote. 줄에 '수종 "○○" 시즌 0.05' 를 붙여 대체 판정이 얼마나 도는지 로그로 센다.
 */
export function demandGateDecision(
  rows: Map<string, DemandRow>,
  keyword: string | undefined,
  cfg: { minVolume: number; minSeason: number; minSpeciesSeason?: number },
  opts: {
    relax?: boolean; remembered?: { line: string }; floorExempt?: (keyword: string) => boolean;
    speciesSeason?: (keyword: string) => { name: string; idx: number } | undefined;
  } = {},
): { verdict: DemandVerdict; line: string; relaxed?: boolean; exempted?: boolean } {
  const exempt = !!keyword && (opts.floorExempt ?? ((k: string) => speciesFloorExempt(k)))(keyword);
  // 기억된 기각은 rows 보다 먼저 본다 — 이 후보는 조회하지 않았으니 rows 에 없고(unknown = fail-open),
  // 순서를 뒤집으면 기억이 통째로 무력화된다. 기아 방지 밸브는 기억에도 똑같이 적용한다: 규칙을 갈라 두면
  // '기억됐다는 이유로' 마지막 라운드 밸브가 안 먹혀 후보 전멸 시 슬롯이 선다.
  if (opts.remembered && !exempt) {
    return opts.relax
      ? { verdict: 'demote', line: opts.remembered.line, relaxed: true }
      : { verdict: 'reject', line: opts.remembered.line };
  }
  // 정확 일치 우선, 실패하면 정규화 대조 — assessCandidatesDemand 가 정규화 키로 중복을 걸러 담기 때문에
  // '가을 거름'과 '가을거름'이 한 라운드에 같이 오면 뒤엣것이 미조회로 빠져 게이트를 그냥 통과했다.
  const row = keyword
    ? rows.get(keyword) ?? [...rows.values()].find((r) => normKw(r.keyword) === normKw(keyword))
    : undefined;
  const line = row ? formatDemandLine(row) : '';
  const verdict = demandVerdict(row, cfg);
  // 하한만 뺀다(minVolume 0) — 시즌 지수 판정은 그대로라 비수기 수종 키워드는 종전처럼 후순위다.
  if (exempt && verdict === 'reject') {
    let v = demandVerdict(row, { ...cfg, minVolume: 0 });
    // 시즌 지수가 없을 때만 수종 이름 시즌으로 대신 본다(행이 없으면 위에서 이미 unknown — 여기 오지 않는다).
    const sp = row && row.seasonIdx === undefined && cfg.minSpeciesSeason ? opts.speciesSeason?.(keyword!) : undefined;
    if (sp && v === 'pass' && sp.idx < cfg.minSpeciesSeason!) v = 'demote';
    const spLine = sp ? ` · 수종 "${sp.name}" 시즌 ${sp.idx.toFixed(2)}` : '';
    return { verdict: v, line: `${line}${spLine} · 수종 키워드 하한 면제`, exempted: true };
  }
  if (opts.relax && verdict === 'reject') return { verdict: 'demote', line, relaxed: true };
  return { verdict, line };
}

/**
 * 이번 판정을 기각 기억(원장)에 남길 것인가(순수, 테스트 대상).
 *
 * `remembered` 가 있으면 항상 false — 이 가드가 이 함수의 존재 이유다. 지워지면 후보 루프가 기억을 읽을
 * 때마다 다시 써서 `ts` 가 매 틱 갱신되고, TTL 30일이 영영 만료되지 않는 '조용한 영구 금지'가 된다.
 * `relaxed: true` 는 'API 원 판정이 reject 였는데 마지막 라운드 밸브가 후순위로 낮췄다'는 뜻이라 기억
 * 대상이고, 순수 비수기 demote 는 아니다(수요는 있고 지금이 아닐 뿐 — 다음 시즌에 다시 제안돼야 한다).
 * `unknown` 도 아니다(미조회·조회 실패 = '측정 안 함'이라, 기억하면 미측정이 30일 금지로 굳는다 — fail-open).
 *
 * 반환 타입이 술어(`keyword is string`)인 것은 호출부에서 `keyword` 를 좁혀 중복 `&& keyword` 를 없애기 위함.
 */
export function shouldRememberDemandReject(
  demand: { verdict: DemandVerdict; relaxed?: boolean },
  remembered: unknown,
  keyword: string | undefined,
): keyword is string {
  if (remembered || !keyword) return false;
  return demand.verdict === 'reject' || demand.relaxed === true;
}

/**
 * 후보 검사 순서(순수, 2026-09-17 사용자 요청 "검색 많이 되는 주제를 먼저") — 1차 계열, 2차 검색량.
 *
 * 종전 정렬은 계열 게이트(soft 는 뒤로)뿐이라, 같은 등급 안에서는 두뇌가 내놓은 순서가 그대로 채택
 * 순서였다. 게이트를 통과한 **첫** 후보가 채택되므로, 그 라운드에 월 3,000짜리 후보와 월 30짜리 후보가
 * 같이 있어도 앞에 놓인 쪽이 이겼다. 수요 실측은 이미 라운드 앞머리에서 묶음으로 받아 두므로(비용 0),
 * 그 숫자로 줄만 세우면 '통과한 것 중 가장 많이 찾는 후보'가 채택된다.
 *
 * 계열이 1차인 이유: 쿨다운은 코퍼스 건강 규칙이고 검색량은 기대 수익이다. 수익으로 건강을 이기게 하면
 * 검색량 큰 계열 하나로 쏠린다(배롱 8편/월 실사고의 구조).
 * 측정값이 없는 후보(조회 대상 밖·조회 실패)는 0 이 아니라 **동점**으로 둔다 — 모름을 '검색량 0'으로
 * 깎으면 수요 목록 밖 틈새 수종이 영영 뒤로 밀린다(최고 성적 하스카프베리가 그 목록 밖이었다).
 */
export function orderCandidates<T>(
  items: readonly T[],
  levelOf: (x: T) => string,
  volumeOf: (x: T) => number | undefined,
): T[] {
  return items.map((x, i) => ({ x, i }))
    .sort((a, b) => {
      const soft = (levelOf(a.x) === 'soft' ? 1 : 0) - (levelOf(b.x) === 'soft' ? 1 : 0);
      if (soft) return soft;
      const va = volumeOf(a.x); const vb = volumeOf(b.x);
      if (va !== undefined && vb !== undefined && va !== vb) return vb - va;
      return a.i - b.i;   // 모름끼리·동점은 두뇌가 내놓은 순서(자신 있는 것부터)
    })
    .map((e) => e.x);
}

/**
 * 후순위 보관함에서 채택할 후보 하나(순수) — rank 오름차순, 같은 rank 는 먼저 담긴 순서를 유지한다
 * (rank 0=비수기, 1=기아 방지 밸브, 2=최근 축, 3=최근 수종, 4=실검색 각도 밖(2026-09-21). '지금 덜 찾는 소재'가 '아예 검색량이 없는
 * 소재'보다 항상 낫고, 둘 다 로테이션이 겹치는 후보보다 낫다).
 * 엄격 부등호 비교라서 안정성이 구현에 박혀 있다 — sort 로 바꾸면 동률 순서 보장을 잃는다.
 */
export function pickDemoted<T extends { rank: number }>(list: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const cur of list) if (best === undefined || cur.rank < best.rank) best = cur;
  return best;
}

/**
 * 라운드 끝 채택 경합(순수) — 후순위 보관함 vs 유사 폴백. 어느 쪽이 이기는지만 돌려주고 로그·조립은
 * 호출부가 한다(경로별 로그 문구를 그대로 유지하기 위해).
 *
 * rank 0(비수기)은 폴백을 이긴다 — 아직 안 다룬 새 소재이고 소재 자체엔 수요가 있다(지금 덜 찾을 뿐).
 * rank 1(기아 방지 밸브 = 검색량 하한 미달)은 폴백에 진다(2026-08-26 최종 리뷰 I3) — '이 표기로는
 * 아무도 안 찾는다'가 실측된 후보라, 이미 다룬 소재라도 검색량이 확인된 유사 폴백이 낫다.
 * rank 2(최근 축)·3(최근 수종)도 폴백에 진다(2026-09-17) — '안 겹치는 소재의 유사 각도'가 '겹치는 소재의
 * 새 각도'보다 낫다. 수종이 축보다 뒤다(같은 나무가 또 나오는 쪽이 눈에 더 띈다).
 * 폴백이 없으면 rank 1·2·3 도 채택한다(좌초보다는 생산).
 */
export function pickRoundAdoption<T extends { rank: number }>(
  demoted: readonly T[],
  hasFallback: boolean,
): { source: 'demoted'; pick: T } | { source: 'fallback' } | undefined {
  const best = pickDemoted(demoted);
  if (best && (best.rank < 1 || !hasFallback)) return { source: 'demoted', pick: best };
  if (hasFallback) return { source: 'fallback' };
  return undefined;
}

/**
 * opts.target(2026-09-08) — 이번 틱이 어느 채널을 보고 주제를 고르는가. 'instagram' 이면 프롬프트의
 * 출발점이 [검색 수요 실측] 표에서 [인스타 소재 축 성적]×제철로 바뀌고, 검색량 하한(하드 기각)을 걸지
 * 않는다(배롱나무: 월 검색 22 · 인스타 중앙 2,757 — 검색량으로 조이면 인스타 히트가 못 태어난다).
 * 'youtube'·미지정은 종전 그대로(검색 우선). 시기 밖 소재·수종/축 상한·쿨다운·유사 게이트는 채널과
 * 무관하게 그대로 건다 — 그것들은 채널이 아니라 코퍼스 건강의 규칙이다.
 */
export async function proposeContentIdeas(signal?: AbortSignal, opts: { target?: ShortsPlatform } = {}): Promise<ContentIdea | null> {
  const target = opts.target;
  const igTarget = target === 'instagram';
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
  // 브랜드 슬러그는 여기서 한 번 고정한다 — 프롬프트 조립과 후보 루프가 LLM 왕복(수 초)을 여러 번 건너므로
  // 그 사이 브랜드가 전환되면 기각 기억을 A 로 읽고 B 에 쓰게 된다(아래 ResearchState 의 slug 고정과 같은 버그).
  const slug = activeBrandSlug() || '';
  // 외부 인기(네이버 재배 수요·유튜브 30일, 2026-10-07) — 하루 한 번 백그라운드 갱신, 이번 틱은 이미 있는 스냅샷을 쓴다.
  if (CONFIG.topicPerfHints) {
    void refreshExtTopics(slug, librarySpeciesFor(slug), (t) => findSpeciesLoose(t)?.name, signal, (sp) => findSpecies(sp)?.aliases ?? []).catch(() => {});
  }
  const extSnap = (() => { try { return readExtTopicsSnap(slug); } catch { return null; } })();
  const speciesCov = speciesCoverageFor(slug);   // 수종 로테이션(2026-08-27) — 프롬프트 블록·후보 게이트·winners 필터 공용
  // 수종 월 상한에 수요 가중(2026-09-04 사용자 확정) — 수요 큰 수종은 몇 편 더 허용한다.
  // 실측 배분이 어긋나 있었다: 수요 22/월 배롱나무에 6편, 검색 1,085회를 물어다 준 수종엔 3편.
  // 느슨하게만 만든다 — 수요 미상 수종은 종전 상한(2편) 그대로다. 최고 성적이 수요 목록 밖
  // 수종(하스카프베리)에서 나왔으므로, 낮은 수요로 조이면 그 발견 자체를 막게 된다.
  const demandRows = (() => {
    try { return (readDemandSnap(slug || undefined)?.rows ?? []).map((r) => ({ keyword: r.keyword, total: Math.max(r.volume, r.familyMax) })); }
    catch { return [] as Array<{ keyword: string; total: number }>; }
  })();
  // 숏폼 성과 배수(2026-09-17 사용자 확정) — 검색량과 나란히 상한을 느슨하게 하는 두 번째 신호.
  // 최근 수종 게이트와 같은 눈(speciesKeyOf)으로 집계해야 이름이 맞는다.
  const perfRatios = speciesShortsPerf(speciesKeyOf, slug || undefined);
  const speciesCap = (name: string): number => {
    try {
      return speciesCapFrom(
        { searchVolume: familyVolume(demandRows, name).max, perfRatio: perfRatios.get(name) },
        CONFIG.speciesMonthlyCap,
      );
    } catch { return CONFIG.speciesMonthlyCap; }
  };
  const themeCov = brandThemeCoverage(new Date(), slug);   // 주제 축 로테이션(2026-08-27) — 수종과 직교
  // 최근 수종·축 제외(2026-09-17 사용자 확정) — 카운트(월 상한)와 달리 '며칠 전'을 잰다. 둘 다 지시 중에도 건다.
  const speciesRecent = speciesRecencyFor(slug);
  const factStarvedRecent = factStarvedRecencyFor(slug);   // 사실 부족 수종(2026-09-17) — 검색해도 안 나온 수종은 창 안에서 재제안 금지
  const factStarvedRecentLore = factStarvedRecencyFor(slug, new Date(), 'lore'); // 이야기 사실 부족(2026-09-18) — 그 수종의 이야기 각도만 막는다
  const themeRecent = themeRecencyFor(slug);

  // 브랜드 설정 시: 주제를 브랜드 제품·타겟에 조향 + 콜드스타트는 시드 키워드에서 출발 +
  // subNiche 를 제품 라인으로 제약(기존 서브니치 EWMA 가 그대로 '제품 라인별 성과 학습'이 된다).
  const brand = brandContext();
  const seeds = brandSeedKeywords();
  const productLines = brandProductLines();
  // "없음"이 아니라 "쓸 수 있는 게 없음" — 시대 컷오프(perfEraSince)로 옛 정체성 성과를 일부러 뺀
  // 경우가 있어서, 데이터가 아예 없다고 말하면 두뇌가 '신생 브랜드'로 오해한다.
  const coldstart = seeds.length
    ? `(지금 정체성에 쓸 성과 키워드 없음 — 아래 브랜드 시드 키워드에서 출발해 탐색)\n${seeds.map((k) => `- ${k}`).join('\n')}`
    : '(없음 — 콜드스타트)';
  const seedBlock = seedKeywordBlock(winners, seeds);
  // 신규성 가드(사용자 원칙 2026-07-15) — 브랜드의 기존 글·쇼츠·카드뉴스 제목+키워드와 유사 금지.
  // 프롬프트 주입(사전)과 findSimilarContent 사후 검사 이중 방어 — 유사하면 기각 사유를 담아 1회 재시도.
  const existing = collectExistingContent(activeBrandSlug() || undefined);
  // 실측 유튜브 검색어(2026-09-04 사용자 확정) — 이 채널에서 재현 가능한 성장 축은 검색이다.
  // 피드가 끊긴 뒤에도 검색만 살아남았고, 평탄선을 넘긴 두 편은 둘 다 검색으로 넘겼다.
  // 잡음 거르기는 여기서 한다: 수집된 말에는 무관한 트렌드어가 섞인다("감스트 리중딱" 등).
  // 우리 분야인지는 수종 사전과 브랜드 업종어로 판정한다 — 둘 다 이미 있는 데이터다.
  const searchBlock = (() => {
    try {
      const stems = [...(getBrand()?.compoundStems ?? []), ...seeds];
      const covered = existing.map((e) => normalizeTerm(`${e.title} ${e.keyword ?? ''}`));
      const scored = shortsSearchTerms(activeBrandSlug() || undefined);
      const rows = rankSearchDemand(scored, {
        // 그 말을 정면으로 다룬 편이 있는가 — 제목·키워드에 그 말이 통째로 들어갔는지로 본다.
        isCovered: (k) => { const n = normalizeTerm(k); return covered.some((c) => c.includes(n)); },
        // 우리 분야의 말인가 — 수종 이름이나 업종어를 품고 있으면 우리 것으로 본다.
        isRelevant: (k) => !!findSpecies(k) || stems.some((t) => t && k.includes(t)),
        limit: 15,
      });
      // 편은 있는데 검색이 0 인 소재 — ①(외부 수요)만으로는 못 보는 '각도 실패' 신호.
      return searchDemandBlock(rows, { missed: unconvertedSubjects(scored) });
    } catch { return ''; } // fail-open — 신호 하나 때문에 제안이 멈추면 안 된다
  })();
  // 인스타 소재 축 성적(2026-09-04 사용자 확정) — 같은 소재라도 각도로 도달이 갈린다.
  // 실측 111편: 꽃·개화 중앙 1,362 · 전정 943 … 기타 557(39편, 가장 큰 덩어리이자 최하위권).
  // "이 소재를 다뤄라"가 아니라 "각도를 이렇게 잡아라"로 쓴다 — 계절과 싸우지 않게.
  // 실촬영 재고(2026-09-06) — 아직 화면에 안 나간 사장님 촬영본이 있는 수종.
  // 소진 판정은 clips/user_*.mp4 존재로 본다(배정 시도가 아니라 구워진 것이 근거).
  const stockBlockStr = (() => {
    try {
      const brandSlug = activeBrandSlug() || undefined;
      const canon = (n: string): string => findSpecies(n)?.name ?? n;
      const used = usedSpecies(shortsStore().list().filter((x) => !brandSlug || x.brand === brandSlug), {
        hasUserClip: (id) => {
          try { return fs.readdirSync(path.join(CONFIG.dataDir, 'shorts', id, 'clips')).some((f) => f.startsWith('user_')); }
          catch { return false; }
        },
        speciesOf: (t) => findSpeciesLoose(t)?.name, // 소재 매칭과 같은 눈(2026-09-08) — 제목이 '나무'를 떼도 잡는다
      });
      return stockBlock(unusedStock(listMedia(brandSlug), used, canon));
    } catch { return ''; }
  })();
  const axisBlockStr = (() => {
    try { return axisBlock(axisPerformance(igReelViews(activeBrandSlug() || undefined))); }
    catch { return ''; } // fail-open
  })();
  // 사장님 지시(2026-09-10) — 켜져 있으면 최우선 블록 + 자율 판단 게이트 완화. 꺼져 있으면 아래 전부 종전 그대로.
  const directive = activeDirective();
  const libSpecies = directive ? librarySpeciesFor(slug) : [];
  const directiveBlockStr = directive ? directiveBlock(directive, libSpecies) : '';
  // 보관소 지시면 목록을 코드로 강제한다 — 프롬프트 지시만으로는 샌다(위 offLibrarySpecies 주석의 실측).
  const libGate = !!directive && directiveWantsLibrary(directive.text) && libSpecies.length > 0;
  if (libGate) console.log(`[auto-cycle] 보관소 수종 강제 — ${libSpecies.length}종, 목록 밖 주제는 기각`);
  if (directive) console.log(`[auto-cycle] 사장님 지시 적용 — "${directive.text.slice(0, 50)}"${directive.maxPieces ? ` (${directive.made}/${directive.maxPieces}편)` : ` (${directive.made}편째)`}`);
  // 수종 필수(2026-10-02, BLOG_REQUIRE_SPECIES) — 메인 키워드가 수종을 부르게 한다. 사장님 지시가 수종을 정하지 않은
  // 일반 지시면 면제(사람이 고른 범위). off 면 아래 프롬프트 줄·키워드 보정·게이트·축 예시 수종이 전부 빠진다(종전 동작).
  const needSpecies = speciesRequiredFor(CONFIG.blogRequireSpecies, directive);
  if (CONFIG.blogRequireSpecies && !needSpecies) console.log('[auto-cycle] 수종 필수 면제 — 사장님 지시가 수종을 정하지 않은 일반 지시');
  // 축 예시에 박을 수종 — 보관소 지시면 종전대로 보관소 목록, 수종 필수 틱이면 지금 열린 제철 수종(일반 씨앗 "나무 심는 깊이"를
  // 두뇌가 그대로 따라 쓰면 게이트가 기각한다 — 09-29 보관소 조임과 같은 구조라 같은 장치로 푼다).
  const seedSpecies: string[] = libGate ? libSpecies : needSpecies ? (() => {
    try {
      const snap = readDemandSnap(slug || undefined)?.rows ?? [];
      const seasonBy = new Map<string, number>();
      for (const r of snap) {
        const k = requiredSpeciesOf(r.keyword);
        if (k && typeof r.seasonIdx === 'number') seasonBy.set(k, Math.max(seasonBy.get(k) ?? 0, r.seasonIdx));
      }
      const names = (getBrand()?.speciesCatalog ?? []).flatMap((g) => (g.species ?? []).map((s) => s.name));
      return inSeasonSpecies(names, {
        blocked: (n) => !!usedRecently(n, speciesRecent, speciesKeyOf)
          || (speciesCov.get(n) ?? 0) >= speciesCap(n)
          || !!starvedHit(n, factStarvedRecent, factStarvedRecentLore),
        volumeOf: (n) => familyVolume(demandRows, n).max || undefined,
        seasonOf: (n) => seasonBy.get(requiredSpeciesOf(n) ?? n),
        minSeason: CONFIG.topicDemandMinSeason,
      });
    } catch { return []; }   // fail-open — 예시 수종이 없어도 게이트·프롬프트 줄은 그대로 선다
  })() : [];
  const existingLines = existing.slice(0, 30)
    .map((e) => `- (${e.kind}) ${e.title}${e.keyword ? ` [키워드: ${e.keyword}]` : ''}`).join('\n');
  // 다양성 강제(2026-07-23 감사) — 킬스위치 CONTENT_DIVERSITY=off 로 끔. 표면 novelty 가 못 잡는 '소재 쏠림'을
  // 포화 소재어 회피 + 각도 로테이션으로 완화(탐색 예산). 실효는 향후 몇 편의 실제 산출로만 판단 가능.
  const diversityOn = process.env.CONTENT_DIVERSITY !== 'off';
  // 합성어 어간은 브랜드 설정에서(업종어) — 미설정 브랜드는 확장 없이 종전 동작.
  const satTokens = diversityOn ? saturatedThemes(existing, 3, getBrand()?.compoundStems ?? []).slice(0, 15).map((t) => t.token) : []; // 상위 15개(빈도순)만 — 과도한 회피목록 방지
  const diversityBlock = diversityOn
    ? `[이미 포화된 소재 — 이번엔 이 소재어들을 피하라]\n${satTokens.length ? satTokens.join(', ') : '(아직 포화 없음 — 자유롭게)'}\n\n`
      + `[이번 글의 각도 — 아래 중 최근 자율주제와 다른 각도 하나를 골라 그 각도로 잡아라]\n${IDEA_ANGLES.join(' | ')}\n\n`
    : '';
  // 어휘 함정어를 소스에서 차단(실측 2026-08-10: 아이디어가 keyword 를 "유실수 가을 시비"로 뽑자
  // 하류의 키워드 정확 표기 강제가 어휘 가드를 이겨 제목·본문에 함정어가 살아남았다 — SEO 리비전조차
  // 키워드 고정 때문에 못 뺀다. keyword 가 태어나는 여기가 유일하게 싼 차단 지점).
  const jargonList = getBrand()?.avoidJargon ?? [];
  // 계열 원장 v2(2026-08-25) — 미분류 편 배치 분류(대개 no-op) 후 감쇠 점수 요약.
  // hard=기각 대상, soft=회피 권고+신호(트렌드·기회) 제외만. 실패는 전부 fail-open(빈 요약).
  await ensureSeriesLabels(activeBrandSlug() || undefined, signal).catch(() => {});
  const cdown = cooldownSummary(activeBrandSlug() || undefined);
  // 지금 코드가 막는 꼴(2026-10-07) — 참고 블록(히트 제목·수종 반응)이 기각될 것을 권하지 않게 같은 게이트로 걸러 낸다.
  const speciesBlockedNow = (text: string): boolean =>
    !!usedRecently(text, speciesRecent, speciesKeyOf) || !!overSpeciesCap(text, speciesCov, getBrand()?.speciesCatalog, speciesCap);
  const titleBlockedNow = (text: string): boolean =>
    speciesBlockedNow(text)
    || !!usedThemeRecently(text, themeRecent, themeKeyOf) || !!overThemeCap(text, themeCov, getBrand()?.topicThemes)
    || cdown.excludeTokens.some((t) => !!t && text.includes(t))
    || !!offSeasonSubject(text, getBrand()?.seasonalSubjects);
  // 수종 반응 참고(2026-10-07) — 프롬프트 참고 표시만, 정렬·후순위·기각엔 안 쓴다(speciesPopularity 머리말의 실측:
  // 갈리는 건 수종보다 주제). 보관소 지시면 보관소 수종 안에서만 보여 준다.
  const popularityBlockStr = (() => {
    if (!CONFIG.topicPerfHints) return '';
    try {
      const rows = collectPopularityRows((t) => findSpeciesLoose(t)?.name, slug);
      const pool = [...new Set([...librarySpeciesFor(slug), ...rows.map((r) => r.species)])];
      // 사전값은 네이버 '재배' 수요(외부 인기 스냅샷) — 없으면 수종 이름 검색량(먹거리 수요가 섞여 크게 보인다).
      const pop = scoreSpeciesPopularity(rows, pool, naverPrior(pool, (sp) => cultivationTotal(extSnap, sp) ?? (familyVolume(demandRows, sp).max || undefined)));
      return speciesPopularityBlock(pop, libGate ? libSpecies : [], speciesBlockedNow);
    } catch { return ''; }
  })();
  const seriesScores = seriesScoresFor(activeBrandSlug() || undefined);
  // 여유 시드는 라벨 게이트로 판정(리뷰 지적: 부분문자열 대조는 '심는'≠'심기' 활용형을 놓쳐
  // 쿨다운 계열 시드를 '여유 있는 방향'으로 추천하는 자기모순을 만들었다).
  const freeSeeds = seeds.filter((k) => gateForLabels(fillLabelsFromKnown(k, fallbackSeriesLabels(k), seriesScores), seriesScores).level === 'none');
  const jargonLine = jargonList.length
    ? `[제목·키워드 어휘] 다음 말은 일반 독자가 다른 뜻으로 읽거나 모른다 — title·keyword 에 쓰지 말고 화살표처럼 풀어 써라: ${jargonList.map((j) => `${j.term}→${j.use}`).join(', ')}\n\n`
    : '';
  const baseUser =
    // 절기 시의성 신호(2026-08-07 사용자 제안) — 종전엔 "시의성·계절성 고려" 지시만 있고 오늘 날짜가
    // 없어 공회전했다. 날짜+절기 한 줄이면 두뇌가 "처서 지나면 가을 식재 준비" 같은 타이밍을 스스로 잡는다.
    `${seasonalContext()}\n\n` +
    (directiveBlockStr ? `${directiveBlockStr}\n\n` : '') +
    (() => { const b = seasonalSubjectBlock(getBrand()?.seasonalSubjects); return b ? `${b}\n\n` : ''; })() +
    // 채널 목표(2026-09-08) — 절기·제철 바로 뒤, 로테이션·검색 표보다 앞. 인스타 목표는 '무엇을 보고 고르나'를
    // 통째로 바꾸므로 신호들보다 먼저 읽혀야 한다. 미지정은 무주입(종전 프롬프트 그대로).
    (target ? `${topicTargetBlock(target)}\n\n` : '') +
    // 최근 수종·축 제외(2026-09-17) — 지시 중에도 넣는다. 아래 후보 게이트가 지시와 무관하게 기각하므로
    // 코드와 프롬프트가 같은 말을 한다(수종 로테이션 블록을 지시 중에 뺀 이유는 그 반대였다).
    (() => { const b = speciesRecentBlock(speciesRecent, CONFIG.speciesRecentDays); return b ? `${b}\n` : ''; })() +
    (() => { const b = themeRecentBlock(themeRecent, CONFIG.themeRecentDays); return b ? `${b}\n` : ''; })() +
    // 수종 로테이션 블록은 '제안 불가'를 말한다 — 지시 중엔 코드가 수종 월 상한을 통과시키므로 지시끼리
    // 충돌하지 않게 뺀다(최근 수종 창은 위 블록이 따로 말한다).
    (directive ? '' : (() => { const b = speciesRotationBlock(getBrand()?.speciesCatalog, speciesCov, speciesCap); return b ? `${b}\n\n` : ''; })()) +
    // 축 로테이션 블록은 지시 중에도 넣는다(2026-09-17) — 축 상한은 더 이상 지시로 통과되지 않고,
    // 이 블록은 '적게 다룬 축'을 이름으로 지목해 후보를 그쪽으로 보내는 유일한 장치다.
    // 지시가 보관소를 가리키면 예시도 그 수종으로 적는다(2026-09-29 실사고) — 적게 다룬 축은 수종이
    // 안 붙는 축(지지대·옥상 마당·비용·경계·전설·문학)이라, 일반 씨앗을 그대로 보여 주면 두뇌가 수종
    // 없는 제목을 짓고 화이트리스트(libGate)가 그걸 기각한다. 열린 축과 허용 수종이 서로를 못 만나
    // 후보가 전멸하던 조임을 푼다. libGate 가 아니면 빈 배열 → 블록은 종전과 글자 단위로 같다.
    // 수종 필수 틱(2026-10-02)도 같은 장치를 쓴다 — 예시를 열린 제철 수종으로 적는다(seedSpecies, 꺼지면 종전 그대로).
    (() => {
      const b = libGate
        ? themeRotationBlock(getBrand()?.topicThemes, themeCov, THEME_MONTHLY_CAP, 8, seedSpecies)
        : themeRotationBlock(getBrand()?.topicThemes, themeCov, THEME_MONTHLY_CAP, 8, seedSpecies,
          '  ※ 예시의 수종은 지금 열린 제철 수종으로 붙인 자리 표시다. 다른 수종으로 바꿔도 되지만, 수종 없는 일반 키워드는 코드가 기각한다.');
      return b ? `${b}\n\n` : '';
    })() +
    (needSpecies ? `${speciesRequiredBlock(CONFIG.demandFloorSpeciesExempt)}\n` : '') +
    (searchBlock ? `${searchBlock}\n\n` : '') +
    (axisBlockStr ? `${axisBlockStr}\n\n` : '') +
    (stockBlockStr ? `${stockBlockStr}\n\n` : '') +
    jargonLine +
    (brand ? `${brand}\n\n` : '') +
    `[팀·업무 범위]\n${teamLines}\n\n` +
    `[성과 상위 키워드(참고용 씨앗 — 이 테마만 반복하지 말 것)]\n${winners || coldstart}\n\n` +
    seedBlock +
    // 후속 카드(2026-08-12) — 제목 유형 A/B 실측을 기획에 연결. 표본 게이트 미달이면 빈 문자열(무주입).
    titleTypeGuidanceBlock(activeBrandSlug() || '') +
    // 조회수 감사(2026-08-20) 3종 배선 — 전부 데이터 부족·실패 시 빈 문자열(무주입, fail-open).
    // ① 쇼츠 채널 실측: 파생 숏폼 YT/IG 조회수가 주제 선정에 처음으로 되먹임된다(종전 winners=블로그 전용).
    shortsTopicSignalBlock(activeBrandSlug() || '') +
    // ①-a 히트 제목·수종 반응 참고(2026-10-07) — 조회는 수종보다 주제로 갈린다. 터진 제목의 꼴을 보여 주고, 수종표는 참고로만.
    (CONFIG.topicPerfHints ? hitTitleBlock(slug, Date.now(), titleBlockedNow) : '') +
    (popularityBlockStr ? `${popularityBlockStr}\n` : '') +
    (CONFIG.topicPerfHints ? extTopicsBlock(extSnap, libGate ? libSpecies : [], speciesBlockedNow) : '') +
    // ② 리서치 실측 판정 역류: 폐기(avoid)·기회(opportunity) 키워드 — 하드 계열의 기회만 주입 제외
    //    (소프트 계열의 검증된 기회는 살린다 — 리뷰 지적: 소프트 제외+정렬 중첩이 준하드로 작동하던 문제).
    topicVerdictBlock(undefined, cdown.excludeTokensHard) +
    // ③ 실검색 연관어(네이버+유튜브 자동완성 일일 스냅샷 diff): 쿨다운 계열 시드는 목록에서 제외.
    trendSignalBlock(undefined, cdown.excludeTokens) +
    // ③-a 검색 수요 실측(2026-08-26): 시드 키워드의 절대 검색량·시즌 지수 표. 연관어(무엇을 검색하나)
    //     옆에 붙여야 두뇌가 '이 표기로 몇 명이 찾는가'까지 함께 본다. 스냅샷 없음·킬스위치 off 면 빈 문자열.
    //     쿨다운 계열 행은 뺀다 — 금지된 계열이 '수요 있는 소재'로 표에 남으면 지시끼리 충돌한다.
    // 최근 수종도 표에서 뺀다(2026-09-17) — 표가 커질수록 상위 행이 고정되는데, 그 행이 최근 수종이면
    // 두뇌는 '수요 있는 소재'로 읽고 코드는 기각한다(쿨다운 계열 행을 뺀 것과 같은 지시 충돌).
    // 수종 키워드 하한 면제(2026-10-02) — 켜져 있으면 표의 하한 문구가 '일반 키워드에만'으로 바뀐다(off 면 종전 그대로).
    demandSignalBlock(activeBrandSlug() || '', [...cdown.excludeTokens, ...speciesRecent.keys()], { speciesFloorExempt: CONFIG.demandFloorSpeciesExempt }) +
    // ③-a' 수요 미달로 이미 기각된 키워드(2026-08-27): 재제안 금지 목록. 수요 표 바로 뒤에 붙여야
    //      '수요가 있는 것'과 '이미 없다고 실측된 것'을 두뇌가 한 자리에서 본다. 항목 없으면 빈 문자열.
    //      아래 [신호 우선순위]의 "금지가 항상 이긴다"가 이 블록에도 그대로 적용된다(줄 변경 불필요).
    //      인스타 목표 틱(2026-09-08)엔 넣지 않는다 — 코드는 하한 미달을 통과시키는데 두뇌만 '제안 금지'를 받으면
    //      지시끼리 충돌한다(위 주석의 대칭 사고). 기억 자체는 그대로 쌓인다 — 유튜브 틱에서 다시 쓰인다.
    // 하한 면제 수종 키워드(2026-10-02)는 금지 목록에서 뺀다 — 면제 전에 쌓인 기억이 '제안 금지'로 실리면 코드는 통과시키는데 두뇌만 피한다.
    (igTarget || directive ? '' : demandRejectBlock(slug, undefined, CONFIG.demandFloorSpeciesExempt ? (k) => speciesFloorExempt(k) : undefined)) + // 지시 중엔 수요 미달을 코드가 통과시킨다 — 금지 블록도 뺀다
    // ③-b 유튜브 니치 동향(2026-08-25): 최근 7일 조회 상위 영상 — 소재·프레이밍의 실반응 신호.
    ytNicheBlock(undefined, cdown.excludeTokens) +
    // ④ 계열 쿨다운 v2(감쇠 점수): 하드=금지(아래 후보 게이트가 코드로도 기각), 소프트=회피 권고 + 빈 방향 유도.
    // 지시 중에도 넣는다(2026-09-17) — 계열 쿨다운 하드가 더 이상 지시로 통과되지 않으므로
    // 코드와 프롬프트가 같은 말을 한다(종전엔 코드가 통과시켜 지시끼리 충돌했다).
    ((cdown.hard.length || cdown.soft.length)
      ? `[계열 쿨다운 — 최근 집중해서 다룬 계열(괄호는 감쇠 점수)]\n`
        + (cdown.hard.length ? `금지: ${cdown.hard.join(', ')} — 이 계열·조합은 제안 불가.\n` : '')
        + (cdown.soft.length ? `가급적 회피: ${cdown.soft.join(', ')} — 꼭 쓰려면 안 다룬 새 조합(다른 행위·상황)으로만.\n` : '')
        + (freeSeeds.length ? `여유 있는 방향(쿨다운 아닌 시드 예): ${freeSeeds.slice(0, 6).join(', ')}\n` : '')
        + '\n'
      : '') +
    // 신호 서열 선언(리뷰 지적) — 명령형 블록 6종이 서열 없이 나열되면 micro 가 어느 지시에 최적화할지 비결정적.
    // 로테이션을 서열 1군에 명시(2026-08-30) — 종전 서열은 쿨다운·폐기·유사만 '금지'로 세우고 축·수종
    // 상한을 빼놨다. 그러면 아래 시드·수요 표·연관어가 막힌 축 키워드를 내밀 때 두뇌가 그쪽을 따르고,
    // 후보 8개가 전부 코드 기각으로 날아간다(실측 2026-08-30: 한 라운드 기각 17건 중 대부분이 축 상한,
    // 16축 중 7축 포화 상태에서 생산이 멈춤). 로테이션 블록은 이미 '제안 금지'라 적고 있었지만 서열
    // 선언이 그것을 1군으로 인정하지 않아 지시끼리 사실상 동급이었다.
    // 문구는 shortsPlatform.topicPriorityBlock 이 채널 목표별로 든다(2026-09-08) — 유튜브·미지정은 종전 문구 그대로.
    topicPriorityBlock(target) +
    `[기존 콘텐츠 — 주제·키워드 유사 금지]\n${existingLines || '(없음)'}\n\n` +
    `[최근 제작 — 중복 회피]\n${done || '(없음)'}\n\n` +
    `[최근 자율주제 — 중복 회피]\n${recentAuto.slice(-5).join('\n') || '(없음)'}\n\n` +
    diversityBlock +
    (productLines.length ? `subNiche 는 반드시 다음 제품 라인 중 가장 관련 있는 하나로: ${productLines.join(' | ')}\n\n` : '') +
    `형식: {"ideas":[{"title":"...","keyword":"...","subNiche":"..."} — 서로 소재가 다른 8개]}`;

  // 후보 수 확장(2026-08-14, 사용자 승인) — 사이클당 1건×2시도는 포화 시즌에 슬롯 좌초를 만들었다
  // (08-12~14 3슬롯 연속: 틱당 보류 2+기각 2~4, 지연 38분+). 한 호출로 5후보를 받아 게이트를 통과하는
  // 첫 후보를 채택 — 개당 통과율 p 일 때 시도당 통과율이 1-(1-p)^5 로 뛴다. 비용은 haiku 소형 호출 1회분.
  // 지시 아래 채택 — 편수를 올리고 상한에 닿으면 끄고 알린다(세 채택 경로 공용).
  const markDirectivePiece = (): void => {
    if (!directive) return;
    const r = noteDirectivePiece();
    if (r.finished) {
      console.log(`[auto-cycle] 사장님 지시 완료 — "${directive.text.slice(0, 40)}" ${r.made}편(상한 도달) → 지시 꺼짐, 다음 틱부터 기존 자율런`);
      void notify({ title: '자율런 지시 완료', body: `"${directive.text.slice(0, 60)}" — 편수 상한 ${r.made}편에 닿아 지시를 껐습니다. 다음부터는 기존 자율런으로 돕니다.` }).catch(() => {});
    }
  };
  let rejectNote = '';
  // 수종 없는 후보 최후 보류함(2026-10-02) — **라운드 밖에 산다. 일부러다.** 아래 후순위 보관함(demoted)은 라운드 안에서만
  // 살지만, 이 게이트는 1라운드에서 '원래라면 채택됐을' 후보를 막는다. 그 틱의 2라운드가 다른 게이트(축 상한·최근 축·
  // 보관소 밖)로 전멸하면, 보관함이 라운드와 함께 사라질 경우 이 게이트 하나가 빈 틱을 만든다(09-29 전멸과 같은 꼴).
  // 그래서 두 라운드를 다 써도 수종 붙은 후보가 없을 때만, 여기 담긴 것 중 종전 규칙이 골랐을 것을 채택한다.
  // rank: -1 = 모든 게이트 통과(종전이면 즉시 채택) · 0~4 = 후순위 보관함과 같은 뜻 · 0.5 = 유사 폴백 자격
  // (pickRoundAdoption 서열 그대로 — 비수기는 유사 폴백을 이기고, 유사 폴백은 rank 1 이상을 이긴다).
  const noSpeciesReserve: Array<{ idea: ContentIdea; rank: number; line: string }> = [];
  const adoptNoSpecies = (): ContentIdea | null => {
    const best = pickDemoted(noSpeciesReserve);
    if (!best) return null;
    const { idea, line } = best;
    console.log(`[auto-cycle] 수종 없는 후보 채택(기아 방지 — 두 라운드에 수종 붙은 후보 없음) — "${idea.title}"${idea.keyword ? ` (키워드 "${idea.keyword}")` : ''}`);
    if (CONFIG.topicDemandGate && searchAdEnabled()) console.log(`[auto-cycle] 수요 게이트 — "${idea.title}" ${line || '조회 없음'} 채택${target ? ` · 채널 목표 ${platformLabel(target)}` : ''}`);
    recentAuto.push(idea.title);
    if (recentAuto.length > 20) recentAuto.shift();
    markDirectivePiece();
    if (idea.keyword) consumeOpportunityVerdict(idea.keyword);
    return { ...idea, ...(target ? { target } : {}), ...(directive ? { directive: true } : {}) };
  };
  const IDEA_ROUNDS = 2;   // 마지막 라운드 판정(기아 방지 밸브)이 이 숫자에 매달려 있어 상수로 묶는다
  // 블로그 유입 검색어(최근 30일) — 실검색 각도 판정의 연관어에 더한다(2026-10-07). 틱당 한 번 읽는다(파일, 비용 0).
  const blogInflowQueries: string[] = (() => {
    if (!CONFIG.angleCheck) return [];
    try {
      const since = Date.now() - 30 * 86_400_000;
      return readBlogSearchQueries(slug).filter((r) => Date.parse(r.ts) >= since).flatMap((r) => (r.queries ?? []).map((q) => q.query));
    } catch { return []; }
  })();
  for (let attempt = 0; attempt < IDEA_ROUNDS; attempt++) {
    // 실패 사유를 삼키지 않는다 — 실사고 2026-08-31 08:55~10:55: 런처 축소 PATH 로 claude CLI 가
    // ENOENT 였는데 여기서 조용히 null 이 되어, 오토런 틱이 2시간 동안 "처리할 작업 없음"만 남겼다.
    // 아래 기각 분기들은 모두 사유를 남기는데 이 경로만 예외였던 것이 원인 추적을 막았다.
    let callError = '';
    // 출력 상한 2000(실사고 2026-08-31 17:00 정각 슬롯) — 종전 900 은 claudeCli 의 3배 환산(2700)이
    // 하한 4000 에 눌려 실효 4000 이었고, 그 4000 을 응답이 넘겨 "exceeded the 4000 output token
    // maximum" 으로 라운드가 통째로 죽었다. 이 프롬프트는 후보 8개를 한국어 제목·키워드·서브니치로
    // 요구하는 데다 로테이션·쿨다운·수요 블록이 계속 늘어 출력이 커졌다. 2000×3=6000 으로 5할 여유를 준다.
    // (haiku 는 --effort low 를 안 붙여 기본 effort 로 돌기 때문에 사고 토큰도 이 상한을 함께 쓴다.)
    const o = await microJSON<{ ideas?: unknown }>(
      micro, IDEA_SYSTEM, rejectNote ? `${baseUser}\n\n${rejectNote}` : baseUser, { maxOutputTokens: 2000, signal },
    ).catch((e: unknown) => { callError = e instanceof Error ? e.message : String(e); return null; });
    if (directive && (o as { exhausted?: unknown } | null)?.exhausted === true) {
      // 지시 소진 — 두뇌가 '지시 안에서 더 낼 주제 없음'이라 답했다. 지시는 켜 둔 채 이번 틱만 쉰다(2026-09-18).
      // 수종·축 창이 지나면 저절로 후보가 열린다. 끄는 건 사장님 몫 — 알림에 그렇게 적는다.
      const reason = asString((o as { reason?: unknown }).reason).trim().slice(0, 120);
      // 단 1라운드에서 수종 없음으로 미룬 후보가 있으면 그것을 채택한다(2026-10-02) — 종전이면 그 후보는 1라운드에 이미
      // 채택됐다. 여기서 쉬면 수종 필수 게이트 혼자 빈 틱을 만든다. 채택하는 틱이라 소진 보류 기록·'쉼' 알림은 남기지 않는다.
      if (noSpeciesReserve.length) {
        console.log(`[auto-cycle] 사장님 지시 소진 — "${directive.text.slice(0, 40)}" (${reason || '더 낼 주제 없음'}) → 1라운드 보류 후보로 채택`);
        return adoptNoSpecies();
      }
      const shouldNotify = holdDirective(reason);
      console.log(`[auto-cycle] 사장님 지시 소진 — "${directive.text.slice(0, 40)}" (${reason || '더 낼 주제 없음'}) → 지시 유지, 이번 틱은 쉼`);
      if (shouldNotify) {
        void notify({ title: '자율런 지시 — 이번 틱 쉼', body: `"${directive.text.slice(0, 60)}" — ${directive.made}편 만든 뒤 지금은 지시 안에서 더 낼 주제가 없어 이번 틱을 쉽니다${reason ? `(${reason})` : ''}. 지시는 켜 둡니다 — 수종·축 금지 창이 풀리면 다시 냅니다. 일반 자율런으로 돌리려면 지시를 꺼 주세요.` }).catch(() => {});
      }
      return null;
    }
    // 수종 키워드 보정(2026-10-02) — 수요 조회·계열 분류·정렬이 전부 cand.keyword 를 읽으므로 그보다 **앞에서** 바꾼다
    // (루프 안에서 바꾸면 새 키워드는 수요 행이 없어 '조회 없음'으로 fail-open 통과한다).
    const cands = normalizeIdeaCandidates(o).map((c) => {
      if (!needSpecies) return c;
      const r = bindSpeciesKeyword(c);
      if (r.from) console.log(`[auto-cycle] 수종 키워드 보정 — "${r.from}" → "${r.cand.keyword}" (제목 "${c.title}")`);
      return r.cand;
    });
    if (!cands.length) {
      const last = attempt >= IDEA_ROUNDS - 1;
      console.log(`[auto-cycle] 아이디어 제안 실패 — ${callError || '모델 응답이 후보 0개(형식 불일치)'}`
        + ` → ${last ? '이번 주기 스킵' : '다음 라운드 재시도'}`);
      // 종전엔 첫 라운드 실패가 곧 틱 전체 포기였다 — 응답 절단은 매 호출 달라지는 일시적 실패라
      // 남은 라운드를 써 보지도 않고 버릴 이유가 없다(라운드 수 IDEA_ROUNDS 로 이미 상한이 있다).
      if (last) return adoptNoSpecies();   // 1라운드에서 수종 없음으로 미룬 후보가 있으면 그것(없으면 null — 종전과 같다)
      continue;
    }
    // 검색 수요 묶음 조회(2026-08-26) — 라운드당 딱 1회(검색광고 ≤2콜 + 데이터랩 1콜). 후보당 개별
    // 조회는 라운드당 수십 콜이 된다. 킬스위치 off 면 호출 자체를 생략해 비용이 0이다.
    // 검색광고 자격이 없으면(키 미설정) 조회도 로그도 하지 않는다 — '조회 실패'가 아니라 '측정 안 함'이고,
    // 그 상태에서 "조회 없음 채택" 같은 줄을 남기면 하지도 않은 측정을 했다고 로그가 주장하게 된다.
    const demandOn = CONFIG.topicDemandGate && searchAdEnabled();
    const demandCfg = { minVolume: CONFIG.topicDemandMinVolume, minSeason: CONFIG.topicDemandMinSeason, minSpeciesSeason: CONFIG.topicDemandSpeciesSeasonMin };
    // 기억된 기각 키워드는 조회 대상에서 뺀다(2026-08-27) — 판정은 기억으로 이미 나 있으므로 조회 비용 0.
    // 하한 면제 수종 키워드(2026-10-02)는 기억이 있어도 다시 조회한다 — 기억은 면제 전 하한으로 쌓인 것이라 판정에 안 쓰고,
    // 새 행이 있어야 시즌 지수(비수기 후순위)를 본다.
    const demandTargets = demandOn
      ? cands.map((c) => c.keyword).filter((k): k is string => !!k && (speciesFloorExempt(k) || !demandRejectFor(slug, k)))
      : [];
    // 후보 계열 분류(라운드당 micro 1콜, 실패 시 결정적 폴백 + 원장 키 포함 대조 보강) + 게이트 선계산.
    // 소프트 후보는 뒤로 미룬다(안정 정렬) — none 후보가 있으면 그쪽을 먼저 채택.
    // 계열 분류와 수요 조회는 서로 무관한 외부 왕복이라 같이 기다린다(틱 지연을 직렬로 늘리지 않게).
    const [candLabels, demandRows] = await Promise.all([
      classifyCandidates(cands, signal),
      // 조회 예외가 Promise.all 을 거부시키면 계열 분류까지 잃고 틱 전체가 날아간다 — 레그 단위로 삼킨다.
      demandTargets.length
        ? assessCandidatesDemand(demandTargets, signal).catch(() => new Map<string, DemandRow>())
        : Promise.resolve(new Map<string, DemandRow>()),
    ]);
    // fail-open — 요청은 했는데 응답이 통째로 비면 '검색량 0'이 아니라 '모름'이다(키 없음·HTTP 오류 포함).
    if (demandTargets.length && !demandRows.size) console.log('[auto-cycle] 수요 조회 실패 — 게이트 생략');
    // 실측 누적(2026-09-17 사용자 확정 "표를 키운다") — 이미 받아 둔 숫자라 추가 비용 0. 종전엔 기각분만
    // 30일 기억에 남고 통과분은 버려져, 두뇌가 보는 표가 시드 조회분(오늘 26행)에 머물렀다.
    if (demandRows.size) rememberDemandRows(demandRows.values(), slug || undefined);
    // 수종 이름 시즌(2026-10-20) — 하한 면제 키워드인데 자기 시즌 지수가 없는 후보의 수종만 데이터랩에 묻는다(라운드당 0~2콜).
    // 표(rememberDemandRows)에는 싣지 않는다 — 키워드 실측이 아니라 판정용 근사라, 행에 섞으면 표가 키워드 시즌이라고 주장한다.
    // 묻는 이름은 키워드에 적힌 표기 그대로(speciesSurfaceIn) — 대표명으로 물으면 '매실'이 아무도 안 치는 '설중매나무'의 시즌이 된다.
    const seasonNameOf = (kw: string): string | null => speciesSurfaceIn(kw) ?? requiredSpeciesOf(kw);
    const speciesSeasonBy = await (async (): Promise<Map<string, number>> => {
      if (!demandRows.size || !(CONFIG.topicDemandSpeciesSeasonMin > 0)) return new Map();
      const names = new Set<string>();
      for (const c of cands) {
        if (!c.keyword || !speciesFloorExempt(c.keyword)) continue;
        const row = demandRows.get(c.keyword) ?? [...demandRows.values()].find((r) => normKw(r.keyword) === normKw(c.keyword!));
        const sp = row && row.seasonIdx === undefined ? seasonNameOf(c.keyword) : null;
        if (sp) names.add(sp);
      }
      return names.size ? speciesSeasons([...names], signal).catch(() => new Map<string, number>()) : new Map();
    })();
    const speciesSeasonOf = (kw: string): { name: string; idx: number } | undefined => {
      const name = seasonNameOf(kw);
      const idx = name ? speciesSeasonBy.get(name) : undefined;
      return name && idx !== undefined ? { name, idx } : undefined;
    };
    // 채택 시 수요 실측을 한 줄 남긴다(세 채택 경로 공용) — 나중에 '왜 이 주제였나'를 로그만으로 재구성하려면
    // 기각뿐 아니라 통과한 후보의 숫자도 있어야 한다. 게이트 off 면 아무 말도 하지 않는다(무주입 원칙).
    // 판정 line 을 아는 호출부는 그대로 넘긴다 — 기억으로 기각됐다가 밸브·폴백으로 되살아난 후보는
    // 애초에 조회 대상에서 빠져(demandTargets) demandRows 에 없으므로, 여기서 다시 계산하면 실측이
    // 엄연히 있는데도 '조회 없음 채택'이라고 로그가 주장하게 된다(위 무주입 원칙의 대칭 사고).
    const logDemandAdopt = (title: string, keyword?: string, known?: string): void => {
      if (!demandOn) return;
      const line = known || demandGateDecision(demandRows, keyword, demandCfg, { speciesSeason: speciesSeasonOf }).line;
      console.log(`[auto-cycle] 수요 게이트 — "${title}" ${line || '조회 없음'} 채택${target ? ` · 채널 목표 ${platformLabel(target)}` : ''}`);
    };
    // 후보의 실측 검색량(정확 일치 우선, 없으면 정규화 대조) — 정렬 2차 키. 조회 대상 밖이면 undefined.
    const volumeOf = (kw: string | undefined): number | undefined => {
      if (!kw || !demandRows.size) return undefined;
      const row = demandRows.get(kw) ?? [...demandRows.values()].find((r) => normKw(r.keyword) === normKw(kw));
      return row ? Math.max(row.volume, row.familyMax) : undefined;
    };
    const gated = orderCandidates(
      cands.map((cand, i) => ({
        cand,
        gate: gateForLabels(fillLabelsFromKnown(`${cand.title} ${cand.keyword ?? ''}`, candLabels[i]!, seriesScores), seriesScores),
      })),
      (e) => e.gate.level,
      (e) => volumeOf(e.cand.keyword),
    );
    const rejects: string[] = [];
    let noSpRound = 0;   // 이번 라운드 '수종 없음' 수 — 라운드 끝 노트에 '버리지 말고 수종에 묶어라' 줄을 붙일지
    // 유사 폴백(사용자 원칙 개정 2026-08-14) — 기존과 유사한 후보는 기각이 아니라 '다른 시각 생성'
    // 대상. 새 소재 후보를 우선하되, 이번 라운드에 새 소재가 없으면 유사 후보를 채택한다 — 집필 시점에
    // priorCoverageBrief 가 이전 글 앵글을 주입해 프레이밍을 바꾼다(same-topic different content 배선).
    let similarFallback: ContentIdea | null = null;
    let similarFallbackLine = '';   // 그 후보의 수요 판정 문구(기억 경로는 demandRows 에 없다 — 채택 로그용)
    // 후순위 보관함 — 라운드 안에서만 산다(라운드 밖에 두면 1라운드 기각 사유를 되먹인 뒤에도
    // 그 라운드의 후보가 2라운드 끝에 되살아난다).
    // rank 0=비수기, 1=기아 방지 밸브(아래), 2=최근 축, 3=최근 수종.
    // line 은 그 후보의 판정 문구 — 채택 로그가 '조회 없음'으로 새지 않게 함께 들고 간다(기억 경로는
    // 조회 대상에서 빠져 demandRows 에 없다). rotation 은 rank 2·3 의 사유(로그 문구용).
    // rank 3.5 = 비수기(2026-10-07 사장님 "비시즌 주제는 후순위여도 걸리면 조회수가 안 나온다") — 로테이션 후순위보다 뒤, 각도 밖보다 앞.
    const demoted: Array<{ idea: ContentIdea; rank: number; line: string; rotation?: string }> = [];
    // 실검색 각도 검증(2026-09-21) — 후보 수종별 자동완성(네이버+유튜브)을 이 라운드에서 한 번씩만 조회한다.
    // 공개 엔드포인트라 키·비용 없음. 실패는 빈 배열(fail-open → 판정 unknown → 통과).
    const angleSuggest = new Map<string, string[]>();
    const angleHints = new Map<string, string[]>(); // 수종 → 연관어(다음 라운드 노트용 — rejects 는 4건만 실리므로 따로 모은다)
    if (CONFIG.angleCheck) {
      const spNames = [...new Set(gated.map(({ cand }) => findSpeciesLoose(`${cand.title} ${cand.keyword ?? ''}`)?.name).filter((n): n is string => !!n))];
      await Promise.all(spNames.map(async (sp) => {
        const [nv, yt] = await Promise.all([naverAutocomplete(sp, signal).catch(() => []), ytAutocomplete(sp, signal).catch(() => [])]);
        // 우리 블로그 실제 유입 검색어(2026-10-07)도 연관어로 — 남들이 치는 말 + 우리 글에 들어온 말.
        // 외부 인기 스냅샷의 네이버 재배 연관어(2026-10-07)도 — 자동완성이 비거나 잡음뿐인 수종을 메운다.
        angleSuggest.set(sp, [...nv, ...yt, ...inflowSuggestionsFor(sp, blogInflowQueries), ...extSuggestionsFor(extSnap, sp)]);
      }));
    }
    for (const { cand, gate } of gated) {
      const { title, keyword } = cand;
      // 수종 필수(2026-10-02) — 판정은 여기서, 처리는 '채택·보관' 자리에서 한다. 다른 게이트는 그대로 다 거치게 둬야
      // (1) 기각 사유가 진짜 결격 순서대로 남고 (2) 최후 보류함에 든 후보가 다른 게이트를 건너뛴 채 채택되지 않는다
      // (유사 폴백 자격·비수기 보관 주석의 포도 4편 사고와 같은 구멍). 보정(bindSpeciesKeyword)은 이미 끝난 키워드다.
      const noSp = needSpecies && !requiredSpeciesOf(keyword || title);
      const holdNoSpecies = (rank: number, line: string, where: string): void => {
        console.log(`[auto-cycle] 아이디어 기각(수종 없음) — "${title}"${keyword ? ` (키워드 "${keyword}")` : ''} · ${where} → 최후 보류(두 라운드에 수종 붙은 후보가 없을 때만)`);
        // 한 후보에 노트 한 줄(2026-10-02) — 후순위 분기가 방금 사유를 남겼으면 거기에 이어 붙인다. 따로 두 줄을 넣으면
        // 노트에 실리는 4건 중 2자리를 한 후보가 먹는다.
        const why = `수종 없음(키워드 "${keyword ?? title}" — 지금 철 수종 하나에 묶어 "○○ ${(keyword ?? '').replace(/^나무\s*/, '') || '소재'}" 꼴로)`;
        const prev = rejects.at(-1);
        if (prev?.startsWith(`"${title}"=`)) rejects[rejects.length - 1] = `${prev} · ${why}`;
        else rejects.push(`"${title}"=${why}`);
        noSpeciesReserve.push({ idea: { title, ...(keyword ? { keyword } : {}), ...(cand.subNiche ? { subNiche: cand.subNiche } : {}) }, rank, line });
        noSpRound++;
      };
      // 실검색 각도(2026-09-21) — 판정은 후보마다 여기서 한 번, 처리는 **모든 채택·보관 자리**에서 angleOff 로(2026-10-07).
      // 마가목 사고: 유사 폴백·후순위 보관이 각도 검사보다 앞에서 후보를 잡아, 연관어(열매·효능·가격) 밖인 "마가목 이름이
      // 신농본초경에 남은 이유"가 검사를 한 번도 안 거치고 채택됐다. 다른 게이트는 그대로 다 거친 뒤 각 자리에서 부른다.
      const angleSp = CONFIG.angleCheck ? findSpeciesLoose(`${title} ${keyword ?? ''}`)?.name : undefined;
      const angleV = angleSp ? angleVerdict(angleSp, title, angleSuggest.get(angleSp) ?? []) : null;
      /** 각도 밖이면 처리하고 true(호출부는 continue). 마지막 라운드 전엔 기각+연관어 노트, 마지막 라운드는 후순위(rank 4)만 —
       *  어느 자리에서 걸리든 rank 4 라 유사 폴백·비수기·로테이션 후순위보다 항상 뒤다. */
      const noSearch = !!angleSp && searchless(angleV, cultivationMeasured(extSnap, angleSp));
      const angleOff = (line: string): boolean => {
        if (!angleV || !angleSp || !(angleV.status === 'unverified' || noSearch)) return false;
        if (noSearch) {
          // 검색 근거 없음(2026-10-07 설중매 사고) — 연관어도 재배 수요도 0. 각도 밖과 같은 대우(기각 → 마지막 라운드 rank 4).
          rejects.push(`"${title}"=검색 근거 없음(${angleSp} — 연관 검색어·재배 검색량 0, 사람들이 찾는 수종으로)`);
          if (attempt < IDEA_ROUNDS - 1) {
            console.log(`[auto-cycle] 아이디어 기각(검색 근거 없음) — "${title}" (${angleSp}: 연관어 0 · 재배 검색 0)`);
            return true;
          }
          console.log(`[auto-cycle] 아이디어 후순위(검색 근거 없음·기아 방지) — "${title}" (${angleSp})`);
          if (gate.level === 'none' && noSp) holdNoSpecies(4, line, '후순위');
          else if (gate.level === 'none') {
            demoted.push({ idea: { title, ...(keyword ? { keyword } : {}), ...(cand.subNiche ? { subNiche: cand.subNiche } : {}) }, rank: 4, line, rotation: `검색 근거 없음 — ${angleSp}` });
          }
          return true;
        }
        // 마지막 라운드가 아니면 기각 — 노트의 연관어를 받은 다음 라운드가 그 안에서 다시 내게 한다(첫 실측 2026-09-21:
        // 1라운드 끝에 후순위 채택이 돌아 연관어 노트가 한 번도 안 쓰인 채 '마가목 명소' 각도가 나갔다).
        rejects.push(`"${title}"=실검색 각도 밖(${angleSp})`);
        angleHints.set(angleSp, angleV.angles);
        if (attempt < IDEA_ROUNDS - 1) {
          console.log(`[auto-cycle] 아이디어 기각(실검색 각도 밖) — "${title}" (${angleSp} 연관어: ${angleV.angles.join(' · ')})`);
          return true;
        }
        console.log(`[auto-cycle] 아이디어 후순위(실검색 각도 밖·기아 방지) — "${title}" (${angleSp} 연관어: ${angleV.angles.join(' · ')})`);
        if (gate.level === 'none' && noSp) holdNoSpecies(4, line, '후순위');
        else if (gate.level === 'none') {
          demoted.push({ idea: { title, ...(keyword ? { keyword } : {}), ...(cand.subNiche ? { subNiche: cand.subNiche } : {}) }, rank: 4, line, rotation: `실검색 각도 밖 — ${angleSp}` });
        }
        return true;
      };
      if (recentAuto.includes(title)) {
        // 종전엔 여기서 로그 없이 전체 return null — 재탕 제목 하나가 슬롯을 '침묵 좌초'시켰다(08-14 관측).
        console.log(`[auto-cycle] 아이디어 스킵(최근 제안 재탕) — "${title}"`);
        rejects.push(`"${title}"=최근 제안 재탕`);
        continue;
      }
      // 브랜드 소재 게이트(하드) — 프롬프트 유도가 실패해도 금지 소재는 코드가 막는다(2026-07-31 정체성 각인).
      const off = offBrandTerm(`${title} ${keyword ?? ''}`);
      if (off) {
        console.log(`[auto-cycle] 아이디어 기각(브랜드 범위 밖) — "${title}" (소재 "${off}")`);
        rejects.push(`"${title}"=브랜드가 안 다루는 소재(${off})`);
        continue;
      }
      // 보관소 지시 강제(하드, 비용 0, 2026-09-16) — 지시가 보관소를 가리키면 목록 밖 수종은 여기서 막는다.
      // 지시 중엔 수요·계열·축 게이트가 전부 통과라, 이 그물이 없으면 목록 밖 주제가 그대로 발행까지 간다.
      if (libGate && offLibrarySpecies(`${title} ${keyword ?? ''}`, libSpecies, (t) => findSpeciesLoose(t)?.name)) {
        console.log(`[auto-cycle] 아이디어 기각(보관소 밖 수종) — "${title}"`);
        rejects.push(`"${title}"=보관소에 없는 수종(지시는 보관소에 소재가 있는 수종만 — 예: ${libSpecies.slice(0, 8).join(', ')})`);
        continue;
      }
      // 시기 소재 게이트(하드, 비용 0) — 검색량 게이트는 keyword 만 재므로 제목의 달력 소재를 따로 본다
      // (2026-08-27: "활엽수" 키워드(시즌 0.81)에 단풍 글이 묻어 나감). 이번 달·다음 달 밖이면 기각.
      const offSeason = offSeasonSubject(`${title} ${keyword ?? ''}`, getBrand()?.seasonalSubjects);
      if (offSeason) {
        console.log(`[auto-cycle] 아이디어 기각(시기 밖 소재) — "${title}" (${offSeason.term}: ${formatMonths(offSeason.months)}, 지금 ${new Date().getMonth() + 1}월)`);
        rejects.push(`"${title}"=시기 밖 소재(${offSeason.term}은 ${formatMonths(offSeason.months)} — 지금~다음 달 검색 소재만)`);
        continue;
      }
      // 최근 수종 게이트(하드, 비용 0, 2026-09-17 사용자 확정) — 창 안에 다룬 수종은 각도·행위를 바꿔도 기각.
      // 카운트 상한과 다른 축이다: 상한은 '30일에 몇 편'만 재서 6일·3일 간격 재등장을 규칙 안으로 허용했다
      // (모과나무 09-10→09-16, 석류나무 09-13→09-16 — 둘 다 누적 1편/상한 2편, 행위도 달라 쿨다운 미발동).
      // **지시 중에도 건다** — 사장님이 지시문에 직접 쓴 조건이라 완화 대상이 아니다.
      // 마지막 라운드는 기각이 아니라 후순위로 낮춘다(아래 보관 지점) — 카탈로그 79종 중 창 안이 32종이라
      // 여유가 크지 않고, 그 때문에 슬롯이 서는 것은 사장님이 원한 바가 아니다(검색 수요 밸브와 같은 형태).
      const recentSp = usedRecently(`${title} ${keyword ?? ''}`, speciesRecent, speciesKeyOf);
      if (recentSp && attempt < IDEA_ROUNDS - 1) {   // 마지막 라운드는 기각 대신 후순위(아래 보관 지점)
        console.log(`[auto-cycle] 아이디어 기각(최근 수종) — "${title}" (${recentSp.name} ${recentSp.daysAgo}일 전)`);
        rejects.push(`"${title}"=최근 ${CONFIG.speciesRecentDays}일 안에 다룬 수종(${recentSp.name} ${recentSp.daysAgo}일 전 — 아직 안 다룬 수종으로)`);
        continue;
      }
      // 수종 월 상한 게이트(하드, 비용 0, 2026-08-27) — 최근 30일 같은 수종 블로그가 상한이면 어떤 각도든 기각.
      // 유사 폴백보다 앞이라 '다른 시각' 우회도 막힌다(배롱 8편/월 실사고).
      // 지시 중에도 건다(2026-09-17 사용자 확정) — 축·계열과 같은 이유. 대신 상한 자체가 검색량·숏폼
      // 조회수로 느슨해진다(speciesCapFrom): 잘 되는 수종은 막는 게 아니라 자리를 더 준다.
      const capped = overSpeciesCap(`${title} ${keyword ?? ''}`, speciesCov, getBrand()?.speciesCatalog, speciesCap);
      if (capped) {
        // 상한은 수종마다 다르다(검색량·숏폼 성과 보너스) — 기본값이 아니라 그 수종의 실제 상한을 찍는다.
        console.log(`[auto-cycle] 아이디어 기각(수종 월 상한) — "${title}" (${capped.name}: 30일 ${capped.count}편 ≥ ${speciesCap(capped.name)})`);
        rejects.push(`"${title}"=수종 월 상한(${capped.name} 최근 30일 ${capped.count}편 — 아직 안 다룬 수종으로)`);
        continue;
      }
      // 최근 축 게이트(하드, 비용 0, 2026-09-17 사용자 확정) — 창 안에 쓴 축은 수종을 바꿔도 기각.
      // 상한(5편/30일)이 카운트라 하루 세 편을 전부 전정으로 채워도 규칙 안이었다. 실측 30일 70편:
      // 가지치기 11 · 거름 11 · 수확 8 · 묘목 구매 6 — 네 축이 절반, 24축 중 6축은 0편.
      // 수종 창과 같은 형태: 지시 중에도 걸고, 마지막 라운드는 후순위(rank 2)로 살린다.
      const recentTh = usedThemeRecently(`${title} ${keyword ?? ''}`, themeRecent, themeKeyOf);
      if (recentTh && attempt < IDEA_ROUNDS - 1) {
        console.log(`[auto-cycle] 아이디어 기각(최근 축) — "${title}" (${recentTh.theme} ${recentTh.daysAgo}일 전)`);
        rejects.push(`"${title}"=최근 ${CONFIG.themeRecentDays}일 안에 쓴 축(${recentTh.theme} ${recentTh.daysAgo}일 전 — 다른 축으로)`);
        continue;
      }
      // 주제 축 월 상한 게이트(하드, 비용 0, 2026-08-27) — 같은 축(심기·구매·거름·전정…)이 30일 상한이면 기각.
      // 지시 중에도 건다(2026-09-17 사용자 확정) — 지시는 '무엇을 다룰지'를 좁히는 도구지 코퍼스 건강
      // 규칙을 끄는 도구가 아니다. 실측: 지시 완화로 축 상한이 31회 열렸고 26회가 '수확·열매 관리'였다.
      const cappedTheme = overThemeCap(`${title} ${keyword ?? ''}`, themeCov, getBrand()?.topicThemes);
      if (cappedTheme) {
        console.log(`[auto-cycle] 아이디어 기각(주제 축 월 상한) — "${title}" (${cappedTheme.theme}: 30일 ${cappedTheme.count}편 ≥ ${THEME_MONTHLY_CAP})`);
        rejects.push(`"${title}"=주제 축 월 상한(${cappedTheme.theme} 최근 30일 ${cappedTheme.count}편 — 아직 안 다룬 축으로)`);
        continue;
      }
      // 어휘 함정어 게이트(하드) — keyword 로 태어난 함정어는 하류 어디서도 못 뺀다(키워드 고정 강제가
      // 어휘 가드·린트·리비전을 전부 이김, 실측 2026-08-10 "유실수 가을 시비"). 프롬프트 유도 실패 대비 코드 차단.
      const jarg = lintLexicon(`${title} ${keyword ?? ''}`, jargonList);
      if (jarg.length) {
        console.log(`[auto-cycle] 아이디어 기각(어휘 함정어) — "${title}" ("${jarg[0]!.term}")`);
        rejects.push(`"${title}"=함정어(${jarg[0]!.term} — ${jarg[0]!.use}로)`);
        continue;
      }
      // 리서치 폐기 판정 게이트(하드, 2026-08-20) — 실측으로 폐기된 키워드가 프롬프트 지시를 뚫고
      // 재제안되던 실사고(처서: 08-16 폐기 판정 후 08-18~20 3건 재배정) 봉합. 정규화 완전 일치만
      // 기각해 과차단을 막는다(파생 주제 판단은 프롬프트의 topicVerdictBlock 이 담당).
      const avoided = keyword ? avoidVerdictFor(keyword) : null;
      if (avoided && directive) console.log(`[auto-cycle] 리서치 폐기 판정 통과(사장님 지시) — "${title}"`);
      else if (avoided) {
        console.log(`[auto-cycle] 아이디어 기각(리서치 폐기 판정) — "${title}" (키워드 "${keyword}": ${avoided.reason.slice(0, 50)})`);
        rejects.push(`"${title}"=리서치 실측 폐기 키워드(${keyword} — ${avoided.reason.slice(0, 40)})`);
        continue;
      }
      // 검색 수요 게이트(하드 기각 1종, 2026-08-26) — 절대 검색량(검색광고)이 하한 미달이면 기각한다.
      // 계열 최대(표기만 다른 연관어)까지 봐도 미달일 때만이라, '표기가 나쁜 좋은 소재'는 살아남는다.
      // 비수기(시즌 지수 미달)는 여기서 판정만 하고 기각하지 않는다 — 처리는 아래 채택 직전(후순위).
      //
      // 기아 방지 밸브(마지막 라운드) — 우리 롱테일은 실측 0~30/월이라 5후보가 통째로 하한에 걸릴 수 있고,
      // 2라운드까지 전멸하면 null 을 반환해 슬롯이 선다. 그래서 마지막 라운드에서는 하한 미달을 기각이
      // 아니라 후순위로 낮춘다(아래 소재 포화 게이트의 'attempt 0 에서만 … 기아 방지' 선례와 같은 형태).
      // 첫 라운드는 종전대로 하드 기각이라 사유가 rejectNote 로 두뇌에 전달돼 2라운드 제안이 실제로 바뀐다.
      //
      // 기각 기억(2026-08-27) — 지난 틱에 실측으로 하한 미달을 받은 키워드는 조회 없이 그때의 줄로 기각하고,
      // 이번 틱에 새로 난 API 기각은 기억에 남긴다. 이미 기억된 건은 다시 쓰지 않는다(쓰면 읽을 때마다
      // ts 가 갱신돼 TTL 30일이 영영 끝나지 않는다).
      // 기억 조회에는 `demandOn`(검색광고 키 여부)을 걸지 않는다 — 기억은 이미 받아 둔 실측이라 키가
      // 필요 없고(그게 '재조회 0'의 요점), 프롬프트의 금지 블록은 CONFIG.topicDemandGate 만 보므로
      // 여기에 키 조건을 더하면 "제안 금지"라고 시켜 놓고 게이트는 통과시키는 지시 충돌이 난다.
      const remembered = rememberedDemandReject(slug, keyword);
      // 채널 목표별 처리(2026-09-08, 순수 함수 demandGateForTarget) — 인스타 목표는 relax 를 안 쓴다. 마지막
      // 라운드에 reject 가 demote(relaxed) 로 바뀌면 아래 통과 분기에 안 걸리고 후순위 보관함·유사 폴백 실격으로
      // 흘러가, '하한을 걸지 않는다'가 마지막 라운드에만 뒤집힌다. 인스타에서 reject 는 언제나 통과라 밸브가 필요 없다.
      const tg = demandGateForTarget(target, attempt === IDEA_ROUNDS - 1);
      const demand = demandGateDecision(demandRows, keyword, demandCfg, {
        relax: tg.relax,
        speciesSeason: speciesSeasonOf,
        ...(remembered ? { remembered: { line: remembered.line } } : {}),
      });
      // 기억은 '실측 결과'이지 '채택 자격'이 아니다 — 판정이 난 자리에서 바로 기록한다. 아래 게이트
      // (계열 하드·수종 앵커·유사·소재 포화)에 먼저 걸려 continue 되는 후보도 실측은 이미 받았으므로,
      // 여기서 기록하지 않으면 다음 틱에 같은 키워드가 또 검색광고 조회를 태운다(이 태스크가 없애려던
      // 재조회 낭비가 마지막 라운드 경로에만 남던 비대칭). 실패는 함수 안에서 삼켜지는 fire-and-forget.
      if (shouldRememberDemandReject(demand, remembered, keyword)) rememberDemandReject(slug, keyword, demand.line);
      // 수종 키워드 하한 면제(2026-10-02) — 종전이면 여기서 '검색 수요 미달'로 기각됐을 후보. 면제가 얼마나 도는지 로그로 센다.
      if (demand.exempted) console.log(`[auto-cycle] 검색량 하한 면제(수종 키워드) — "${title}" (${demand.line})`);
      // 인스타 목표(2026-09-08) — 검색량 하한은 걸지 않는다. 기억·실측 어느 쪽이든 '하한 미달'은 이 글의
      // 결격이 아니다(이 글은 검색이 아니라 공유로 퍼진다). 로그는 남겨 나중에 '검색 0 인데 인스타에서 터졌나'를
      // 대조할 수 있게 한다. 비수기(demote)는 그대로 — 인스타야말로 제철이 생명이다.
      if (directive && demand.verdict === 'reject') {
        // 지시 중엔 **수요 하한만** 면제한다 — 사장님이 직접 고른 틈새 수종을 검색량으로 막지 않기 위해서다.
        // 비수기(demote)는 면제 대상이 아니다(2026-09-17 사용자 확정): 하한 미달은 '이 소재를 찾는 사람이
        // 원래 적다'지만 비수기는 '지금이 그 시기가 아니다'라 성격이 다르다. 실사고 2026-09-17: 지시가
        // 둘을 같이 풀어 9월에 "이팝나무 꽃, 한여름 초입"(시즌 0.01, 개화는 5~6월)이 채택됐다.
        console.log(`[auto-cycle] 검색 수요 미달 통과(사장님 지시) — "${title}"${demand.line ? ` (${demand.line})` : ''}`);
      } else if (tg.lowVolumePasses && demand.verdict === 'reject') {
        console.log(`[auto-cycle] 검색 수요 미달 통과(인스타 목표) — "${title}" (${demand.line})`);
      } else if (demand.verdict === 'reject') {
        console.log(remembered
          ? `[auto-cycle] 아이디어 기각(검색 수요 미달·기억) — "${title}" (${demand.line})`
          : `[auto-cycle] 아이디어 기각(검색 수요 미달) — "${title}" (${demand.line})`);
        rejects.push(`"${title}"=검색 수요 미달(${demand.line})`);
        continue;
      }
      // 계열 쿨다운 v2 게이트(하드만 기각, 2026-08-25) — 감쇠 점수 기반. 조합(수종×행위)은 엄격,
      // 단독은 느슨, 소프트는 기각 없이 순서만 뒤로(위 정렬) — 포도 4편/6일·전정 6편/7일 실사고 계보.
      // 지시 중에도 건다(2026-09-17 사용자 확정) — 실측: 지시 완화로 19회가 '전정', 6회가 '시비'로 열렸다.
      if (gate.level === 'hard') {
        console.log(`[auto-cycle] 아이디어 기각(계열 쿨다운 하드) — "${title}" (${gate.key}: ${gate.why})`);
        rejects.push(`"${title}"=계열 쿨다운(${gate.key} — 최근 집중, 다른 계열·조합으로)`);
        continue;
      }
      // 사실 부족 수종 게이트(하드, 비용 0, 2026-09-17) — 고유 사실이 기준 미만이라 집필 못 한 수종은 각도를
      // 바꿔도 같은 검색 결과다. 지시 중에도 건다. 마지막 라운드에도 기각(후순위로 살리면 같은 벽에 또 부딪힌다).
      const starved = starvedHit(`${title} ${keyword ?? ''}`, factStarvedRecent, factStarvedRecentLore);
      if (starved) {
        console.log(`[auto-cycle] 아이디어 기각(사실 부족 수종${starved.kind === 'lore' ? '·이야기 각도' : ''}) — "${title}" (${starved.name} ${starved.daysAgo}일 전)`);
        rejects.push(starved.kind === 'lore'
          ? `"${title}"=최근 ${CONFIG.factStarvedDays}일 안에 이야기 사실 부족으로 닫힌 수종(${starved.name} — 이 수종은 이야기 각도 말고 실용 각도로)`
          : `"${title}"=최근 ${CONFIG.factStarvedDays}일 안에 사실 부족으로 닫힌 수종(${starved.name} — 자료가 있는 다른 수종으로)`);
        continue;
      }
      // 수종 앵커 게이트(하드) — 이름·상징 유래 축(4순위, 2026-08-13 투입) 전용 함정 차단. 실측(08-01):
      // '나무 이름 유래' 총칭은 검색 0이고, 앵커 없는 꽃말·유래 주제는 화초 꽃말로 미끄러지는데 브랜드
      // 소재 게이트가 못 막는다(장미·국화류는 금지 목록에 없음). '~나무' 수종 앵커를 코드로 강제한다.
      if (lacksSpeciesAnchor(`${title} ${keyword ?? ''}`)) {
        console.log(`[auto-cycle] 아이디어 기각(수종 앵커 없음) — "${title}"`);
        rejects.push(`"${title}"=꽃말·유래 주제인데 수종명(○○나무) 앵커 없음`);
        continue;
      }
      const sim = findSimilarContent({ title, ...(keyword ? { keyword } : {}) }, existing);
      if (sim.length) {
        if (angleOff(demand.line)) continue;   // 유사 폴백도 실검색 각도 안이어야 한다(2026-10-07 마가목 사고)
        const top = sim[0]!;
        console.log(`[auto-cycle] 아이디어 유사 감지 — "${title}" ≈ (${top.kind}) "${top.title}" → 새 소재 우선, 없으면 다른 시각으로 채택`);
        // 폴백 자격은 계열 게이트 none 후보만(리뷰 확정: 소프트 후보가 폴백으로 채택되면 창설 사고
        // 경로 — 포도 4편째 유사 폴백 채택 — 가 감쇠 완화 뒤로 다시 열린다).
        // 검색량 하한 미달(마지막 라운드 완화로 demote 된 것 포함)은 폴백 자격도 없다 — 2026-08-27 실사고:
        // "올리브나무 화분 재배" 10미만/월이 유사 폴백으로 채택돼 게이트가 무력화됐다.
        // 최근 수종(마지막 라운드 후순위 후보)은 폴백 자격도 없다(2026-09-17) — 여기서 걸러 주지 않으면
        // 최근 수종이 유사 폴백 경로로 채택돼 게이트가 무력화된다(수요 하한 미달을 자격에서 뺀 것과 같은 구멍).
        // 수종 없는 후보는 유사 폴백 자리도 못 잡는다(2026-10-02) — 잡으면 수종 붙은 후순위 후보(rank 1~4)를 이긴다.
        // 자격은 같으므로 최후 보류함에 유사 폴백 서열(0.5)로 넣는다.
        if (noSp && gate.level === 'none' && !demand.relaxed && !recentSp && !recentTh) holdNoSpecies(0.5, demand.line, '유사 폴백 자격');
        else if (!similarFallback && gate.level === 'none' && demand.verdict !== 'demote' && !recentSp && !recentTh) {   // 비수기도 폴백 자격 없음(2026-10-07)
          similarFallback = { title, ...(keyword ? { keyword } : {}), ...(cand.subNiche ? { subNiche: cand.subNiche } : {}) };
          similarFallbackLine = demand.line;   // 마지막 라운드에 기억으로 후순위가 된 후보가 여기로 온다(로그가 '조회 없음'으로 새지 않게)
        }
        continue; // 이번 라운드의 새 소재 후보를 먼저 소진한다
      }
      // 개념 포화 기각 — 표면 유사(findSimilarContent)는 통과했지만 핵심 소재가 여러 편과 겹치면 1회만 다른 축 유도.
      // attempt 0 에서만(2번째 시도는 통과시켜 기아 방지 — 다양성은 강제하되 생산은 막지 않는다).
      if (diversityOn && attempt === 0 && !directive) { // 소재 포화는 자율 판단 — 지시 중엔 안 건다
        const sat = saturatedThemeMatches({ title, ...(keyword ? { keyword } : {}) }, existing, 3, getBrand()?.compoundStems ?? []);
        if (sat.length) {
          console.log(`[auto-cycle] 아이디어 기각(소재 포화) — "${title}" ≈ "${sat[0]!.title}"`);
          rejects.push(`"${title}"=포화 소재(기존 "${sat[0]!.title}"와 겹침)`);
          continue;
        }
      }
      // 비수기 후순위 — 판정은 위(리서치 폐기 다음)에서 났지만 **보관은 여기서** 한다. 위에서 바로
      // 보관하면 수종 앵커·유사·소재 포화 게이트를 건너뛴 후보가 라운드 끝에 채택돼, 유사 폴백 자격을
      // 계열 게이트 none 으로 좁혀 막았던 구멍이 두 번째 폴백 경로로 다시 열린다(위 유사 폴백 자격
      // 주석의 포도 4편 사고 계보). 로그는 항상, 보관은 자격(계열 none)일 때만 — 유사 폴백과 같은 규칙.
      // 로테이션 후순위(마지막 라운드 기아 방지, 2026-09-17) — 보관은 **여기서** 한다. 게이트 자리에서 바로
      // 보관하면 수종 앵커·유사·소재 포화를 건너뛴 후보가 라운드 끝에 채택된다(아래 비수기 보관 주석과 같은 이유).
      // 수종(3)이 축(2)보다 뒤다 — 같은 나무가 또 나오는 것이 같은 축이 또 나오는 것보다 눈에 잘 띈다.
      // 둘 다 유사 폴백에 진다: '안 겹치는 소재의 유사 각도'가 '겹치는 소재의 새 각도'보다 낫다.
      if (recentSp || recentTh) {
        if (angleOff(demand.line)) continue;   // 로테이션 후순위도 각도 밖이면 rank 4(2026-10-07)
        const why = recentSp
          ? `최근 수종 — ${recentSp.name} ${recentSp.daysAgo}일 전`
          : `최근 축 — ${recentTh!.theme} ${recentTh!.daysAgo}일 전`;
        console.log(`[auto-cycle] 아이디어 후순위(${recentSp ? '최근 수종' : '최근 축'}·기아 방지) — "${title}" (${why.split(' — ')[1]})`);
        rejects.push(`"${title}"=후순위(${why})`);
        if (gate.level === 'none' && noSp) holdNoSpecies(recentSp ? 3 : 2, demand.line, '후순위');
        else if (gate.level === 'none') {
          demoted.push({
            idea: { title, ...(keyword ? { keyword } : {}), ...(cand.subNiche ? { subNiche: cand.subNiche } : {}) },
            rank: recentSp ? 3 : 2,
            line: demand.line,
            rotation: why,
          });
        }
        continue;
      }
      // 지시 중에도 건다(2026-09-17 사용자 확정) — 위 수요 게이트 주석의 이팝나무 실사고. 기각이 아니라
      // 후순위라 지시 안에 제철 후보가 없으면 결국 이 후보가 채택된다(생산은 안 멈춘다).
      if (demand.verdict === 'demote') {
        if (angleOff(demand.line)) continue;   // 비수기·수요 미달 후순위도 각도 밖이면 rank 4(2026-10-07)
        // 비수기는 마지막 라운드 전엔 기각(2026-10-07 사장님) — 종전엔 1라운드 끝에 바로 채택돼 2라운드(제철 후보)를 시도조차
        // 안 했다(실측: "무화과 가지 끝이 마르는 이유" 시즌 0.24 가 1라운드에서 채택). 사유는 노트로 가 2라운드가 제철로 다시 낸다.
        if (!demand.relaxed && attempt < IDEA_ROUNDS - 1) {
          console.log(`[auto-cycle] 아이디어 기각(검색 비수기) — "${title}" (${demand.line})`);
          // 수종 없음이면 한 줄에 같이 적는다(노트 4자리를 한 후보가 두 자리 먹지 않게 — holdNoSpecies 의 합치기 규칙과 같다).
          rejects.push(`"${title}"=검색 비수기(${demand.line} — 지금 철에 사람들이 찾는 주제로)${noSp ? ` · 수종 없음(키워드 "${keyword ?? title}" — 지금 철 수종 하나에 묶어)` : ''}`);
          continue;
        }
        console.log(demand.relaxed
          ? `[auto-cycle] 아이디어 후순위(검색 수요 미달·기아 방지) — "${title}" (${demand.line})`
          : `[auto-cycle] 아이디어 후순위(검색 비수기) — "${title}" (${demand.line})`);
        // (기억 기록은 위 판정 지점에서 이미 끝났다 — 이 블록보다 위의 게이트에 걸려 여기 못 오는
        //  후보도 실측은 받았으므로, 기록을 채택 자격 판단 뒤로 미루면 그 후보만 매 틱 재조회된다.)
        // 후순위 사유도 노트에 남긴다(2026-08-26 최종 리뷰 M3) — 종전엔 rejects 가 비어 2라운드 노트가
        // "전부 무효"로 나가, 두뇌는 뭐가 문제였는지(비수기냐 수요 미달이냐) 모른 채 다시 제안했다.
        // 보관 자격(계열 none)과 무관하게 기록한다 — 노트는 두뇌에게 주는 정보고, 보관은 별개 판단이다.
        rejects.push(`"${title}"=후순위(${demand.relaxed ? '검색 수요 미달' : '검색 비수기'}${demand.line ? ` — ${demand.line}` : ''})`);
        if (gate.level === 'none' && noSp) holdNoSpecies(demand.relaxed ? 1 : 0, demand.line, '후순위');
        else if (gate.level === 'none') {
          demoted.push({
            idea: { title, ...(keyword ? { keyword } : {}), ...(cand.subNiche ? { subNiche: cand.subNiche } : {}) },
            // 비수기 3.5(2026-10-07) — 종전 0(가장 앞, 유사 폴백도 이김)이었으나 지금 안 찾는 주제는 조회가 안 나온다.
            // 이제 로테이션 후순위(2·3)와 유사 폴백에 지고, 각도 밖(4)만 이긴다. 하한 미달(1)은 종전 그대로.
            rank: demand.relaxed ? 1 : 3.5,
            line: demand.line,              // 채택되면 이 실측 줄이 로그에 그대로 간다(기억 경로는 demandRows 에 없다)
          });
        }
        continue;
      }
      // 실검색 각도 검증(2026-09-21) — 수종 검색량은 통과했어도 제목의 '내용'이 사람들이 실제 치는 연관어 밖이면
      // 후순위(rank 4, 기각 아님). 호두나무 실사고: 연관어는 묘목·재배·가지치기·열매 안 열려요인데 '흙부터'로 나갔다.
      // 노트에 연관어를 실어 다음 라운드가 그 안에서 각도를 잡게 한다. 연관어가 없는 수종은 판정 없이 통과.
      if (angleOff(demand.line)) continue;
      if (angleV?.status === 'ok') console.log(`[auto-cycle] 실검색 각도 일치 — "${title}" (${angleSp}: ${angleV.matched.join(' · ')})`);
      // 수종 없음(2026-10-02) — 다른 게이트를 전부 통과한 후보다(종전이면 여기서 채택). 막고 다음 후보로 간다.
      // 1라운드 사유는 rejectNote 로 두뇌에 가서 2라운드가 수종을 붙여 다시 낸다. 최후 보류함이 빈 틱을 막는다.
      if (noSp) { holdNoSpecies(-1, demand.line, '다른 게이트 전부 통과'); continue; }
      // 판정 시점의 line 을 그대로 넘긴다 — 인스타 목표에서 기억 기각을 통과한 후보는 demandRows 에 없어
      // 여기서 다시 계산하면 '조회 없음 채택'으로 새는 비대칭이 있었다(리뷰 2026-09-08).
      logDemandAdopt(title, keyword, demand.line || undefined);
      recentAuto.push(title);
      if (recentAuto.length > 20) recentAuto.shift();
      markDirectivePiece();
      if (keyword) consumeOpportunityVerdict(keyword); // 채택된 리서치 기회는 소진 — 다음 기획에 반복 주입 방지(2026-08-24)
      return { title, ...(keyword ? { keyword } : {}), ...(cand.subNiche ? { subNiche: cand.subNiche } : {}), ...(target ? { target } : {}), ...(directive ? { directive: true } : {}) };
    }
    // 제철 후보가 전멸했으면 후순위 보관함과 유사 폴백 중에서 고른다(pickRoundAdoption). 비수기(rank 0)는
    // '지금 덜 찾는다'일 뿐 수요가 없는 게 아니고 아직 안 다룬 새 소재라 폴백을 이긴다. 반대로 하한 미달
    // (rank 1)은 검색량이 실측으로 0 에 가까운 후보라, 검색량이 있을 수 있는 유사 폴백에 진다(리뷰 I3).
    const adoption = pickRoundAdoption(demoted, !!similarFallback);
    if (adoption?.source === 'demoted') {
      const { idea, rank, line, rotation } = adoption.pick;
      console.log(rank === 4
        ? `[auto-cycle] 실검색 각도 밖 후보 채택(대안 없음) — "${idea.title}" (${rotation})`
        : rotation
        ? `[auto-cycle] 로테이션 후보 채택(기아 방지) — "${idea.title}" (${rotation} · 안 겹치는 후보 없음)`
        : rank === 1
          ? `[auto-cycle] 수요 미달 후보 채택(기아 방지) — "${idea.title}"`
          : `[auto-cycle] 수요 비수기 후보 채택(대안 없음) — "${idea.title}"`);
      logDemandAdopt(idea.title, idea.keyword, line);
      recentAuto.push(idea.title);
      if (recentAuto.length > 20) recentAuto.shift();
      markDirectivePiece();
      if (idea.keyword) consumeOpportunityVerdict(idea.keyword);
      return { ...idea, ...(target ? { target } : {}), ...(directive ? { directive: true } : {}) };
    }
    // 새 소재 후보가 전멸했지만 유사 후보가 있으면 채택 — 좌초 대신 '같은 소재, 다른 시각' 글로 간다.
    // 폴백은 계열 게이트 none 후보만 대입되므로(위 자격 조건) 재검사 불필요 — v1의 폴백 뚫림
    // 실사고(포도 4편째)는 자격+N7 바닥선 이중으로 봉쇄돼 있다.
    if (similarFallback) {
      console.log(`[auto-cycle] 유사 주제 채택(다른 시각 생성) — "${similarFallback.title}"`);
      logDemandAdopt(similarFallback.title, similarFallback.keyword, similarFallbackLine);
      recentAuto.push(similarFallback.title);
      if (recentAuto.length > 20) recentAuto.shift();
      markDirectivePiece();
      if (similarFallback.keyword) consumeOpportunityVerdict(similarFallback.keyword);
      return { ...similarFallback, ...(target ? { target } : {}), ...(directive ? { directive: true } : {}) };
    }
    // 문구가 '전부 기각'이면 후순위 항목이 섞였을 때 노트가 사실과 어긋난다(후순위는 기각이 아니다).
    // 실검색 연관어(2026-09-21) — 각도 밖으로 기각된 수종은 '피하라'가 아니라 '이 각도로 다시 내라'다. 일반 기각 사유와
    // 문장이 반대라 따로 붙인다(rejects 4건 슬라이스에 밀리지 않게).
    const angleLines = [...angleHints.entries()].map(([sp, angles]) => angleNote(sp, angles)).filter(Boolean);
    rejectNote = `[직전 제안 ${cands.length}건 전부 채택 불가(기각 또는 후순위) — 사유: ${rejects.slice(0, 4).join(' · ') || '전부 무효'}] 이 사유들과 소재를 전부 피해, 완전히 다른 소재·키워드로 5건을 다시 제안하라.`
      + (angleLines.length ? `\n[실검색 연관어 — 아래 수종은 피하지 말고 이 각도로 다시 내라(사람들이 실제 치는 검색어다)]\n${angleLines.map((l) => `· ${l}`).join('\n')}` : '')
      // 수종 없음(2026-10-02)은 위 '전부 피해'와 반대다 — 소재는 살리고 수종에 묶으면 된다(연관어 줄과 같은 이유로 따로 붙인다).
      + (noSpRound ? `\n[수종 없음 ${noSpRound}건 — 그 소재는 버리지 말고 지금 철 수종 하나에 묶어 다시 내라(형식: "○○ 심는 깊이"). keyword 에 수종명이 없으면 코드가 기각한다]` : '');
  }
  // 두 라운드 전부 기각 — 수종 없음으로 미룬 후보가 있으면 그것을 채택한다(이 게이트 혼자서는 빈 틱을 만들지 않는다).
  // 없으면 null — 이번 주기 스킵(다음 주기에 새 각도로 재시도).
  return adoptNoSpecies();
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
    `${seasonalContext()}\n\n` + // 절기 시의성 신호 — 리서치 미션도 계절 타이밍에 맞게(아이디어 경로와 동일)
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
  // 브랜드 소재 게이트(하드) — 리서치 미션도 금지 소재면 스킵(다음 주기 재시도, 2026-07-31 정체성 각인).
  const off = offBrandTerm(title);
  if (off) { console.log(`[auto-cycle] 리서치 미션 기각(브랜드 범위 밖) — "${title}" (소재 "${off}")`); return null; }
  return title;
}
