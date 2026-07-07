/**
 * 전역 설정 — 환경변수 기반. LLM 은 Claude Code CLI 단일 백엔드
 * (로컬 Ollama 경로·RAM 예산 자동배정은 2026-07-06 제거 — llm/claudeCli.ts 참조).
 */
import os from 'node:os';
import path from 'node:path';

// .env 로드 — CONFIG·getSecret(process.env 우선)이 값을 읽기 전에 반영. Node 20.12+/22 내장. 파일 없으면 무해.
// GEPA_ENV_FILE 지정 시 그 파일을 로드(기업별 인스턴스 분리 — 같은 소스 트리에서 여러 스튜디오를
// 띄울 때 공유 cwd/.env 대신 인스턴스 전용 env 를 부팅부터 사용; shell env 가 항상 우선).
try { process.loadEnvFile(process.env.GEPA_ENV_FILE || undefined); } catch { /* .env 없음 — 무해 */ }

const env = (k: string, d = ''): string => process.env[k] ?? d;
const envInt = (k: string, d: number): number => {
  const v = parseInt(env(k), 10);
  return Number.isFinite(v) ? v : d;
};
const envBool = (k: string, d: boolean): boolean => {
  const v = env(k).trim().toLowerCase();
  if (!v) return d;
  return !['0', 'false', 'no', 'off'].includes(v);
};

const ROOT = path.resolve(env('GEPA_DATA_DIR', path.join(process.cwd(), 'data')));

export type Termination = 'adaptive' | 'fixed';

export interface Config {
  // --- 서버 ---
  readonly port: number;
  readonly host: string;

  // --- LLM 백엔드(Claude 단일 — Ollama 제거 2026-07-06) ---
  /** 클라우드(claude) tier→모델. micro=고빈도 구조작업(속도), standard=창의 본문, heavy=편집 최종/플래그십. */
  readonly cloudTierModels: { readonly micro: string; readonly standard: string; readonly heavy: string };
  readonly requestTimeoutMs: number;
  /** 외부 그라운딩 커넥터(법령·KOSIS·DART 등) fetch 타임아웃(ms). 무응답 외부 API 무한 대기 방지. */
  readonly groundingTimeoutMs: number;
  /** 일반 호출 출력 상한. 통합 단계만 별도 상향. */
  readonly maxOutputTokens: number;
  readonly integrationMaxOutputTokens: number;

  // --- 거버넌스/동시성 ---
  /** 동시 LLM 세션 수 — 벽시계 1번 노브. */
  readonly concurrency: number;
  readonly teamParallel: number;
  readonly maxTurnsPerAgent: number;
  /** Claude(클라우드) 동시 호출 상한 — CLI spawn 동시 수(구독 rate limit 고려). */
  readonly anthropicConcurrency: number;
  /** Claude Code CLI 실행 파일 경로 — 구독(OAuth) 인증 호출용. */
  readonly claudeCliPath: string;
  /** 월 예산 캡($) — 무감시 자율 폭주 안전장치. 0=캡 없음(정액 기본). 메터드로 쓰면 설정. */
  readonly monthlyBudgetUsd: number;

  // --- 토론/조직 형태 ---
  readonly runMode: 'org' | 'debate';
  readonly minSpecialists: number;
  readonly maxSpecialists: number;
  readonly debateRounds: number;
  readonly debateRoundsCap: number;
  /** org(팀) 모드에서 팀 산출물에 적용할 비평→반박 라운드 수. 0=현행(비평 1회만). 팀 위계를 유지한 채 토론 추가. */
  readonly orgDebateRounds: number;
  readonly termination: Termination;

  // --- 오피스 연출(LLM 비용 0, 벽시계만) ---
  readonly choreoPauseMs: number;

  // --- 스트리밍 ---
  readonly tokenCoalesceMs: number;
  readonly ssePingSeconds: number;

  // --- 저장 경로 ---
  readonly dataDir: string;
  readonly wikiDir: string;
  readonly runsDir: string;
  readonly sessionsDir: string;
  readonly agentsDir: string;
  readonly approvalsDir: string;

  // --- 자율/승인 ---
  readonly defaultAutonomy: number;
  readonly requireApproval: boolean;
  readonly approvalTimeoutS: number;
  readonly writeSessionDigest: boolean;
  readonly evolveEmployees: boolean;

  // --- 외부 툴 ---
  readonly webSearch: boolean;

  // --- 블로그 스킬(외부 Python 툴: image_generate / blog_publish) — 전부 옵트인 ---
  /** 블로그 스킬 스크립트 전용 venv python 절대경로. 비면 블로그 툴이 '비활성' 반환(기본 안전). */
  readonly blogPython: string;
  /** openai_image.py·naver_publish.py 가 있는 디렉토리. */
  readonly blogScriptsDir: string;
  /** gpt-image-2 호출용 OpenAI 키 — 서브프로세스 env 로만 전달(로그·프롬프트에 안 실림). */
  readonly openaiApiKey: string;
  /** 이미지 생성 모델(기본 gpt-image-2). */
  readonly openaiImageModel: string;
  /** 네이버 로그인 세션(Playwright storage_state) 파일 경로 — blog_publish 용. */
  readonly naverSessionFile: string;
  /** finalize 후 완성 초안(draft.json)에 이미지 자동 생성(옵트인, 기본 off — 기본 런 경로 불변). */
  readonly blogAutoImage: boolean;
  /** ready 도달 시 자동 네이버 임시저장 — SEO 점수가 기준(naverDraftSeoMin) 이상일 때만. 발행은 여전히 사람 수동. */
  readonly autoNaverDraft: boolean;
  /** 자동 임시저장 SEO 최소 점수 — 미달이면 자동 리비전 1회 후 재평가, 그래도 미달이면 수동 검토로 남긴다. */
  readonly naverDraftSeoMin: number;
  /** 네이버 임시저장 성공(본문 확정) 시 카드뉴스 자동 파생 — piece당 1회. 글마다 이미지 5장 내외 생성 비용. */
  readonly autoCardNews: boolean;
  /** 네이버 임시저장 성공 시 숏폼(MP4) 자동 파생 — piece당 1회. 글마다 이미지 ~6장 + TTS·ffmpeg(로컬) 비용. */
  readonly autoShorts: boolean;

  // --- 음성 입출력 ---
  /** TTS 제공자: 'openai'(gpt-4o-mini-tts, 자연스러운 신경망 음성) | 'say'(macOS 로컬, 폴백). 기본 openai(키 없으면 자동 say 폴백). */
  readonly ttsProvider: string;
  /** OpenAI TTS 모델(기본 gpt-4o-mini-tts — instructions 로 톤 지시 가능). 미지원 시 tts-1-hd 로 바꿔 쓰면 된다. */
  readonly openaiTtsModel: string;
  /** OpenAI TTS 음색(alloy·echo·fable·onyx·nova·shimmer 등). 한국어 내레이션은 nova(따뜻·또렷) 기본. */
  readonly openaiTtsVoice: string;
  /** macOS say 폴백 음색. */
  readonly voiceTtsVoice: string;
  readonly voiceSttModel: string;

  // --- 에이전트 도구 루프 / 자율 사이클 (전부 옵트인 — 기본 off 라 기본 런 경로는 바이트 동일) ---
  /** 능동 다단계 tool-loop. on 이면 stage='work' 에이전트가 <tool> 태그로 추가 자료를 스스로 조회·재호출. */
  readonly agentToolLoop: boolean;
  /** 한 에이전트 턴에서 허용하는 총 도구 호출 수(로컬 속도 백스톱). */
  readonly agentMaxToolCalls: number;
  /** 생성 단계(작업·비평·종합)에서 모델 추론(thinking) 활성. 구조적 JSON 호출은 제외. 기본 off(속도·예산). */
  readonly agentThinking: boolean;
  /** 자율 레벨(0~3) 강제 — 쓰기성 도구를 autonomy 로 게이팅(2=승인, 3=자동, ≤1=차단). */
  readonly enforceAutonomy: boolean;
  /** 유휴 게이트 자율 사이클 주기(분). 기본 30(ON), 0=off. 사용자 런이 없을 때만 진입하고 사용자 런 도착 시 양보. */
  readonly autoCycleMinutes: number;
  /** 지식 리서치 런 주기(시간) — 자율 사이클 틱에서 마지막 리서치 후 이 시간이 지나면 콘텐츠 제작 대신
   *  리서치 런 1건(독자 궁금증·경쟁 콘텐츠 조사→팀 토론→두뇌 적재→직원 학습)을 띄운다. 0=off. */
  readonly researchCycleHours: number;
  /** 능동 셸 실행 도구(run_command) — tool-loop 와 별개로 명시 옵트인(기본 false). 위험 표면이라 이중 게이트. */
  readonly agentShell: boolean;
  /** 셸 allowlist — 명령 argv[0]의 basename 이 이 목록에 있을 때만 실행(env AGENT_SHELL_ALLOW, 쉼표구분). */
  readonly agentShellAllow: readonly string[];
  /** 셸 명령 타임아웃(ms) — 초과 시 SIGKILL. */
  readonly agentShellTimeoutMs: number;
  /** 일일 브리핑 시각 "HH:MM"(로컬 시간). 빈 문자열=off. 알림 채널 설정 시 그 시각에 다이제스트 전송. */
  readonly dailyBriefingTime: string;
  /** 자율 사이클 런 완료 시 알림 전송(알림 채널 설정돼 있을 때만 실제 발송). */
  readonly notifyAutoCycle: boolean;
  /** 콘텐츠 발행 케이던스(주당 신규 편수 목표). 자율 사이클의 신규 아이디어 생성 최소 간격을 이걸로 산정(재개는 무관). 사용자 결정: 주 2~3개. */
  readonly contentCadencePerWeek: number;
  /** 미발행 'ready' 초안 백로그 캡 — 사람이 검토·발행 안 한 초안이 이만큼 쌓이면 신규 생성 중단(홍수 방지). */
  readonly contentReadyCap: number;
  /** 일일 성과 동기화 시각 "HH:MM"(로컬). 빈 문자열=off. 등록된 수집기로 발행 piece 성과를 측정→강화(수집기 미설정 시 no-op). */
  readonly performanceSyncTime: string;
  /** 발행 후 성과 측정까지 대기일 — 네이버 트래픽이 축적될 시간(콜드스타트 지연). 이 창 도달 전 piece 는 측정 안 함. */
  readonly performanceWindowDays: number;
  /** 주입 지식(injected.md) 반영 한도(자 수) — 에이전트 매 런 시스템프롬프트에 들어가는 양. 초과분은 최신 우선(tail)로 잘림. */
  readonly injectedKnowledgeCap: number;
}

export const CONFIG: Config = {
  port: envInt('PORT', 8787),
  host: env('HOST', '127.0.0.1'),

  // 정액 구독이라 모델 선택은 품질 우선(속도 목적의 haiku 만 micro). 개별 override 가능.
  cloudTierModels: {
    micro: env('CLOUD_MICRO_MODEL', 'claude-haiku-4-5'),
    standard: env('CLOUD_STANDARD_MODEL', 'claude-sonnet-5'),
    heavy: env('CLOUD_HEAVY_MODEL', 'claude-opus-4-8'),
  },
  agentThinking: envBool('AGENT_THINKING', false),
  // 구 env 이름(LOCAL_LLM_*)은 하위 호환 폴백으로 유지.
  requestTimeoutMs: envInt('REQUEST_TIMEOUT_MS', envInt('LOCAL_LLM_TIMEOUT_MS', 600_000)),
  groundingTimeoutMs: Math.min(Math.max(3000, envInt('GROUNDING_TIMEOUT_MS', 15_000)), 120_000),
  // 출력 캡은 [1, 32768] 로 클램프 — env 0/음수가 빈 출력/무한생성을 유발하지 않게.
  maxOutputTokens: Math.min(Math.max(1, envInt('MAX_OUTPUT_TOKENS', envInt('LOCAL_LLM_MAX_OUTPUT_TOKENS', 8192))), 32_768),
  // CEO 종합·검토 출력 캡. 최종 산출물은 10페이지+ 완결 문서가 필요(≈15,000자≈~22k 토큰)하므로 24k 로 둔다.
  integrationMaxOutputTokens: Math.min(Math.max(1, envInt('INTEGRATION_MAX_OUTPUT_TOKENS', envInt('LOCAL_LLM_INTEGRATION_MAX_OUTPUT_TOKENS', 24_000))), 32_768),

  concurrency: envInt('CONCURRENCY', 4),
  teamParallel: envInt('TEAM_PARALLEL', 4),
  maxTurnsPerAgent: envInt('MAX_TURNS_PER_AGENT', 20),
  anthropicConcurrency: Math.max(1, envInt('ANTHROPIC_CONCURRENCY', 6)),
  claudeCliPath: env('CLAUDE_CLI_PATH', 'claude'),
  monthlyBudgetUsd: Math.max(0, Number(env('MONTHLY_BUDGET_USD', '0'))),

  runMode: (env('RUN_MODE', 'org') as 'org' | 'debate'),
  minSpecialists: envInt('MIN_SPECIALISTS', 2),
  // 콘텐츠 v1: 초안당 활성 멤버 2명(트렌드+SEO). 리뷰어=회사 크리틱, 성과분석가=벤치(cap 밖).
  maxSpecialists: envInt('MAX_SPECIALISTS', 2),
  debateRounds: envInt('DEBATE_ROUNDS', 2),
  debateRoundsCap: envInt('DEBATE_ROUNDS_CAP', 3),
  // 기본 1(ON) — 팀토론(비평→반박) 1라운드를 기본 활성. 끄려면 ORG_DEBATE_ROUNDS=0(또는 UI 토글).
  orgDebateRounds: Math.min(Math.max(0, envInt('ORG_DEBATE_ROUNDS', 1)), 3),
  termination: (env('TERMINATION', 'adaptive') as Termination),

  choreoPauseMs: envInt('CHOREO_PAUSE_MS', 300),

  tokenCoalesceMs: envInt('TOKEN_COALESCE_MS', 80),
  ssePingSeconds: envInt('SSE_PING_SECONDS', 15),

  dataDir: ROOT,
  wikiDir: path.join(ROOT, 'wiki'),
  runsDir: path.join(ROOT, 'runs'),
  sessionsDir: path.join(ROOT, 'sessions'),
  agentsDir: path.join(ROOT, 'agents'),
  approvalsDir: path.join(ROOT, 'approvals'),

  defaultAutonomy: envInt('DEFAULT_AUTONOMY', 2),
  requireApproval: envBool('REQUIRE_APPROVAL', false),
  approvalTimeoutS: envInt('APPROVAL_TIMEOUT_S', 600),
  writeSessionDigest: envBool('WRITE_SESSION_DIGEST', true),
  evolveEmployees: envBool('EVOLVE_EMPLOYEES', true), // 자가학습 — 런 종료 후 교훈 누적(백그라운드)

  webSearch: envBool('WEB_SEARCH', true),

  // 블로그 스킬(외부 Python) — 기본 비활성. BLOG_PYTHON 미설정 시 image_generate/blog_publish 가 '비활성' 반환.
  blogPython: env('BLOG_PYTHON', ''),
  blogScriptsDir: env('BLOG_SCRIPTS_DIR', path.join(process.cwd(), 'scripts', 'blog_skills')),
  openaiApiKey: env('OPENAI_API_KEY', ''),
  openaiImageModel: env('OPENAI_IMAGE_MODEL', 'gpt-image-2'),
  naverSessionFile: env('NAVER_SESSION_FILE', path.join(ROOT, '.naver_session.json')),
  blogAutoImage: envBool('BLOG_AUTO_IMAGE', false),
  autoNaverDraft: envBool('AUTO_NAVER_DRAFT', true),
  naverDraftSeoMin: Math.min(Math.max(0, envInt('NAVER_DRAFT_SEO_MIN', 80)), 100),
  autoCardNews: envBool('AUTO_CARDNEWS', true),
  autoShorts: envBool('AUTO_SHORTS', true),

  ttsProvider: env('TTS_PROVIDER', 'openai'),
  openaiTtsModel: env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
  openaiTtsVoice: env('OPENAI_TTS_VOICE', 'nova'),
  voiceTtsVoice: env('VOICE_TTS_VOICE', 'Yuna'),
  voiceSttModel: env('VOICE_STT_MODEL', 'mlx-community/whisper-large-v3-turbo'),

  // 옵트인 기능(기본 off/보수값). connect-ai 패리티(능동 실행·거버넌스 강제·자율 사이클)를 켜는 노브.
  agentToolLoop: envBool('AGENT_TOOL_LOOP', false),
  agentMaxToolCalls: Math.min(Math.max(1, envInt('AGENT_MAX_TOOL_CALLS', 4)), 12),
  enforceAutonomy: envBool('ENFORCE_AUTONOMY', true),
  // 무감시 비용/레이트 보호 기본 0(off) — 켜려면 AUTO_CYCLE_MINUTES=N.
  autoCycleMinutes: Math.max(0, envInt('AUTO_CYCLE_MINUTES', 0)),
  researchCycleHours: Math.max(0, envInt('RESEARCH_CYCLE_HOURS', 24)),
  agentShell: envBool('AGENT_SHELL', false),
  // 기본 allowlist 는 '읽기 전용 분석 명령'만 — python3/node/awk/sed/find 같은 범용 코드 실행기는 제외(임의
  // 실행기는 메타문자 없이도 RCE 가 되어 allowlist 를 무력화). 스크립트 실행이 필요하면 AGENT_SHELL_ALLOW 로
  // 명시 추가하되 autonomy=2(명령별 승인)와 함께 쓸 것 — 인터프리터 추가는 사실상 임의 실행을 허용함.
  agentShellAllow: env(
    'AGENT_SHELL_ALLOW',
    'ls,cat,grep,rg,wc,head,tail,echo,pwd,sort,uniq,cut,tr,date,which,file,stat,diff,nl,basename,dirname',
  ).split(',').map((s) => s.trim()).filter(Boolean),
  agentShellTimeoutMs: Math.min(Math.max(1000, envInt('AGENT_SHELL_TIMEOUT_MS', 60_000)), 600_000),
  dailyBriefingTime: env('DAILY_BRIEFING_TIME', '').trim(),
  notifyAutoCycle: envBool('NOTIFY_AUTO_CYCLE', true),
  contentCadencePerWeek: Math.max(1, envInt('CONTENT_CADENCE_PER_WEEK', 3)),
  contentReadyCap: Math.max(1, envInt('CONTENT_READY_CAP', 5)),
  performanceSyncTime: env('PERFORMANCE_SYNC_TIME', '').trim(),
  performanceWindowDays: Math.max(0, envInt('PERFORMANCE_WINDOW_DAYS', 14)),
  injectedKnowledgeCap: Math.max(500, envInt('INJECTED_KNOWLEDGE_CAP', 10000)),
};

export function systemRamGB(): number {
  return os.totalmem() / 1024 ** 3;
}
