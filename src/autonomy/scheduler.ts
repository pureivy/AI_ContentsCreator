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
import { brandContext, brandProductLines, brandSeedKeywords, activeBrandSlug, brandFileSuffix, offBrandTerm, getBrand } from '../content/brand';
import { seasonalContext } from '../util/solarTerms';
import { collectExistingContent, findSimilarContent, saturatedThemes, saturatedThemeMatches } from '../content/novelty';

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
/** 정지 함수 + runNow(수동 즉시 1틱, isEnabled 토글 무시·isBusy·재진입 가드는 유지). */
export type AutoCycleControl = (() => void) & { runNow: () => Promise<void> };

export function startAutoCycle<T = string>(deps: AutoCycleDeps<T>): AutoCycleControl {
  let ticking = false; // 재진입 가드 — pickWork(LLM)이 주기보다 길어도 틱이 겹쳐 다중 자율런이 뜨지 않게.
  // 핵심 1틱 — isEnabled 게이트 제외(타이머 틱과 수동 실행이 공유). isBusy·재진입은 항상 적용.
  const core = async (): Promise<void> => {
    if (ticking) return;
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
  const timer = (deps.intervalMs > 0)
    ? setInterval(() => {
        if (deps.isEnabled && !deps.isEnabled()) return; // 오토런 오프 — 타이머 틱만 조용히 통과(수동 runNow 는 무관)
        void core();
      }, deps.intervalMs)
    : null;
  if (timer && typeof timer.unref === 'function') timer.unref(); // 프로세스 종료를 막지 않게
  const stop = (() => { if (timer) clearInterval(timer); }) as AutoCycleControl;
  stop.runNow = core; // 수동 즉시 실행(사용자 '자율런 돌려줘') — 토글 무시, isBusy·재진입 가드 유지
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

/**
 * 오토런 지시문 판별(순수) — 주제창에 "오토런 실행해줘" 같은 지시를 치면 콘텐츠 런이 돌아 지시문
 * 제목의 글이 검토함에 쌓였다(실측 3회: "자율런 실행", "오토런 실행해줘"×2 — 2026-08-05·08-08).
 * 짧고(≤15자) 오토런 지칭+실행 동사로만 이루어진 입력만 지시로 본다 — "오토런 기능을 소개하는 글"
 * 같은 정상 주제는 길이·구성에서 걸리지 않는다. 호출부(startHandler)가 런 대신 자율 틱으로 라우팅.
 * 명사부에 콘텐츠런 계열 추가(실측 5번째 변형 2026-08-09: "콘텐츠 란 실행"이 새어 들어가 두뇌 그라운딩
 * 주제 선정 → 참나무 자기 강화 런이 됐다). 단독 "콘텐츠"는 명사부가 아니다(런/란 접미 필수).
 */
export function isAutorunDirective(topic: string): boolean {
  const t = (topic || '').trim();
  if (!t || t.length > 15) return false;
  return /^(오토런|자율런|자율\s*사이클|콘텐츠\s*[런란])(\s*(실행|시작|돌려|틱|가동)(해\s?줘|해라|해|줘|주세요)?)?\s*$/.test(t);
}

export interface DailyDeps {
  /** "HH:MM" 로컬 시각. 형식 불일치면 no-op. */
  time: string;
  run: () => void;
  log?: (msg: string) => void;
  /** 발동 이력 영속 키(파일명). 주면 프로세스 재기동에도 '오늘 이미 돌았음'이 유지되고,
   *  예정 시각을 지나 부팅해도 그날 몫을 따라잡는다. 미지정이면 종전(메모리 전용) 동작. */
  key?: string;
}

/**
 * 오늘 실행 도래 판정(순수) — 예정 시각 **이후 아무 때나** 참(따라잡기).
 *
 * 종전 조건은 `now.getHours() === hh && now.getMinutes() >= mm` 이라 예정 시각이 든 **그 한 시간 안에**
 * 프로세스가 살아 있어야만 발동했다(07:30 이면 07:30~07:59 창). tsx watch 는 TS 를 고칠 때마다 자식을
 * 재기동하므로 그 창을 놓치면 그날 팔로워 스냅샷·성과 동기화가 통째로 사라진다 — 실측 2026-08-02:
 * followers 스냅샷이 07-31 에서 멈춰 08-01 하루가 비었다.
 */
export function dailyDue(now: Date, hh: number, mm: number, today: string, lastFired: string): boolean {
  if (today === lastFired) return false; // 당일 1회만
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
  let lastFired = deps.key ? readLastFired(deps.key) : '';
  const tick = (): void => {
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (!dailyDue(now, hh, mm, today, lastFired)) return;
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
export interface ContentIdea { title: string; keyword?: string; subNiche?: string; }

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
function readStrategyWinners(): string {
  try {
    const slug = activeBrandSlug();
    const raw = JSON.parse(readSafe(path.join(CONFIG.dataDir, 'analytics', slug ? `strategy-${slug}.json` : 'strategy.json'))) as {
      winners?: Array<{ keyword?: string; score?: number }>;
    };
    return eligibleWinners(raw.winners ?? [], getBrand()?.perfEraSince)
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
  '다음에 제작하면 검색 노출·유입에 가치있는 네이버 블로그(정보/하우투·리뷰) 콘텐츠 아이디어 한 개를 제안하라.\n' +
  '- 검색 의도가 뚜렷하고 실용적인 주제(하우투/비교/리뷰/체크리스트 등). 시의성·계절성도 고려한다.\n' +
  '- [브랜드 컨텍스트]가 있으면 그 기업의 제품·타겟 고객의 관심사와 자연스럽게 연결되는 주제를 우선하라(노골적 광고성 주제 금지 — 독자에게 유용한 정보가 우선).\n' +
  '- [성과 상위 키워드]는 어떤 분야가 통했는지의 참고다 — 그 분야의 인접·연관 영역에서 새로운 키워드를 발굴하라(성과 키워드 자체나 그 변형의 재사용은 금지). 없으면(콜드스타트) 영역 안에서 다양하게 탐색한다.\n' +
  '- 단, 성과 기록에는 브랜드 범위가 지금과 달랐던 시절의 주제가 남아 있을 수 있다. 그런 키워드는 "무엇이 통했나"의 신호(예: 계절 타이밍·비교·증상 진단 같은 접근 방식)로만 읽고, 그 소재 자체나 인접 소재로 확장하지 마라 — 소재 범위의 기준은 언제나 [브랜드 컨텍스트]다.\n' +
  '- [최근 제작]·[최근 자율주제]와 중복되지 않게 하라.\n' +
  '- [기존 콘텐츠] 목록과 주제·키워드가 유사하면 안 된다 — 같은 키워드나 그것을 포함·확장한 키워드 재사용 금지, 완전히 새로운 각도의 주제를 골라라(사용자 원칙).\n' +
  '- title 은 클릭·검색에 유리한 한국어 제목, keyword 는 검색량 있을 법한 핵심 타겟 키워드 1개, subNiche 는 세부 분야다.';

/**
 * 다음에 제작할 콘텐츠 아이디어 1건 제안 — 조직 헌장(팀·업무 범위) + 성과 전략(strategy.json)에 그라운딩.
 * 위키 인덱스는 주제 생성에서 제외(anti-drift): 과거 적재 자료로 편향되는 피드백 루프를 끊는다(구 gov 버전의 근본 교훈 유지).
 * 모델 — 클라우드 micro(haiku). (Ollama 로컬 분기는 백엔드 제거와 함께 삭제 — 2026-07-06)
 */
// 콘텐츠 각도 메뉴(브랜드 무관) — 아이디어가 매번 '계절 케어 하우투'로 수렴하지 않게 각도를 로테이션한다.
const IDEA_ANGLES = [
  '하우투(단계별 실행 절차)', '구매·선택 가이드(옵션 비교·고르는 기준)', '흔한 실패·오해 바로잡기',
  '초보 입문(처음 시작하는 사람 기준)', '다음 시즌·시기 대비(지금 준비할 것)', '증상·상황별 진단',
  '실제 사례·후기 관점', '한 가지 쟁점 깊이 파기',
];
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
  // "없음"이 아니라 "쓸 수 있는 게 없음" — 시대 컷오프(perfEraSince)로 옛 정체성 성과를 일부러 뺀
  // 경우가 있어서, 데이터가 아예 없다고 말하면 두뇌가 '신생 브랜드'로 오해한다.
  const coldstart = seeds.length
    ? `(지금 정체성에 쓸 성과 키워드 없음 — 아래 브랜드 시드 키워드에서 출발해 탐색)\n${seeds.map((k) => `- ${k}`).join('\n')}`
    : '(없음 — 콜드스타트)';
  const seedBlock = seedKeywordBlock(winners, seeds);
  // 신규성 가드(사용자 원칙 2026-07-15) — 브랜드의 기존 글·쇼츠·카드뉴스 제목+키워드와 유사 금지.
  // 프롬프트 주입(사전)과 findSimilarContent 사후 검사 이중 방어 — 유사하면 기각 사유를 담아 1회 재시도.
  const existing = collectExistingContent(activeBrandSlug() || undefined);
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
  const baseUser =
    // 절기 시의성 신호(2026-08-07 사용자 제안) — 종전엔 "시의성·계절성 고려" 지시만 있고 오늘 날짜가
    // 없어 공회전했다. 날짜+절기 한 줄이면 두뇌가 "처서 지나면 가을 식재 준비" 같은 타이밍을 스스로 잡는다.
    `${seasonalContext()}\n\n` +
    (brand ? `${brand}\n\n` : '') +
    `[팀·업무 범위]\n${teamLines}\n\n` +
    `[성과 상위 키워드(참고용 씨앗 — 이 테마만 반복하지 말 것)]\n${winners || coldstart}\n\n` +
    seedBlock +
    `[기존 콘텐츠 — 주제·키워드 유사 금지]\n${existingLines || '(없음)'}\n\n` +
    `[최근 제작 — 중복 회피]\n${done || '(없음)'}\n\n` +
    `[최근 자율주제 — 중복 회피]\n${recentAuto.slice(-5).join('\n') || '(없음)'}\n\n` +
    diversityBlock +
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
    // 브랜드 소재 게이트(하드) — 프롬프트 유도가 실패해도 금지 소재는 코드가 막는다(2026-07-31 정체성 각인).
    const off = offBrandTerm(`${title} ${keyword ?? ''}`);
    if (off) {
      rejectNote = `[직전 제안 기각 — 브랜드가 다루지 않는 소재 "${off}" 포함] 브랜드 컨텍스트의 소개·금지를 다시 보고, 나무·묘목 범위 안의 완전히 다른 주제로 제안하라.`;
      console.log(`[auto-cycle] 아이디어 기각(브랜드 범위 밖) — "${title}" (소재 "${off}")`);
      continue;
    }
    const sim = findSimilarContent({ title, ...(keyword ? { keyword } : {}) }, existing);
    if (sim.length) {
      const top = sim[0]!;
      rejectNote = `[직전 제안 기각 — 기존 ${top.kind} "${top.title}"와(과) ${top.via === 'keyword' ? '키워드' : '주제'} 유사] 완전히 다른 주제·키워드로 다시 제안하라.`;
      console.log(`[auto-cycle] 아이디어 기각(기존과 유사) — "${title}" ≈ (${top.kind}) "${top.title}"`);
      continue;
    }
    // 개념 포화 기각 — 표면 유사(findSimilarContent)는 통과했지만 핵심 소재가 여러 편과 겹치면 1회만 다른 축 유도.
    // attempt 0 에서만(2번째 시도는 통과시켜 기아 방지 — 다양성은 강제하되 생산은 막지 않는다).
    if (diversityOn && attempt === 0) {
      const sat = saturatedThemeMatches({ title, ...(keyword ? { keyword } : {}) }, existing, 3, getBrand()?.compoundStems ?? []);
      if (sat.length) {
        rejectNote = `[직전 제안 기각 — 이미 포화된 소재(기존 "${sat[0]!.title}"와 핵심 소재 다수 겹침)] 소재 자체를 바꿔라: 계절·대상·각도·포맷 중 최소 하나를 확 틀어라.`;
        console.log(`[auto-cycle] 아이디어 기각(소재 포화) — "${title}" ≈ "${sat[0]!.title}"`);
        continue;
      }
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
