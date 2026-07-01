/**
 * 런 공통 준비 — run_started/company_started/모델 배정/웜업/분해. debate·org 모드가 공유.
 */
import { CONFIG } from '../config';
import { ollama } from '../llm/ollama';
import { getSystemSpecs, autoAssignModels, estimateModelMemoryGB } from '../llm/models';
import type { ModelAssignment } from '../llm/models';
import { tierOverrides, resolveAssignment, isClaudeBackend } from '../llm/setting';
import { EventType } from '../events/types';
import type { EventBus } from '../events/bus';
import type { CompanyDef } from '../agents/company';
import { microJSON } from './agent';
import { asString } from '../util/str';

export interface SubProblem {
  id: string;
  text: string;
}

export interface Prepared {
  assign: ModelAssignment;
  subproblems: SubProblem[];
}

// 작업 분해 시스템 프롬프트 — 다양한 주제에 일반화(유형 식별 우선 + 양방향 안티드리프트 + 유형별 방식).
// (decompose-prompt-generalization-review 워크플로우: 7개 카테고리 병렬 판정→정제. 드리프트가 모든 유형에서
//  관찰돼, 동사로 유형을 고정하고 인접 유형으로의 전환을 양방향으로 차단한다. 예시는 일반 방법의 예시일 뿐.)
const DECOMPOSE_SYSTEM = `너는 작업 분해기다. 주어진 주제를 서로 독립적인 하위 문제로 나눠라.

[1. 먼저 유형을 식별하라] 분해 전, 주제의 (1) 의도·산출물 유형과 그것을 결정하는 핵심 동사(작성/보고서, 분석·평가, 수립·기획, 조사·연구, 의사결정, 조회), (2) 도메인을 파악하라. 식별한 산출물 유형은 분해의 절대 제약이다.

[2. 유형 충실성 — 드리프트 금지] 도메인 키워드(예: 진흥·혁신·디지털전환·신규진출·적자사업)가 유형을 더 쉬운 인접 유형으로 바꾸게 두지 마라. 동사가 유형을 결정한다. 경계를 양방향으로 지켜라:
- 작성/보고서 → 분석·평가·전략으로 바꾸지 마라(예: 결산보고서를 사업 성과/전략 분석으로).
- 분석·평가 → 처방(전략·실행과제·일정)으로 넘어가지 마라(예: 시장경쟁력 분석을 진입전략으로). 진출/도입 같은 행동 단어도 평가할 분석 차원으로 분해하라.
- 수립·기획 → 현황·트렌드 분석 보고서로 환원하지 마라(예: 로드맵 수립을 현황 분석으로).
- 조사·연구 → 평가·점수화·제언으로 바꾸지 마라.
- 의사결정 → 일반 원인·현황 분석으로 바꾸지 마라(존속/철수 결정을 적자 원인 분석으로).
- 조회 → 분석·효과·개선방안으로 바꾸지 마라.

[3. 유형별 분해 방식 — 아래는 예시이며, 식별한 유형의 표준 구성·관례를 따르라]
- 작성/보고서: 그 문서의 표준 목차·구성요소로(예: 결산보고서=세입·세출 결산(예산현액·집행률·불용·이월)·재무제표·기금/잉여금 처분·결산 총괄; 회계연도 단위로 예산/전년 대비 반영).
- 분석·평가: 답이 정해진 평가·진단 차원으로, SWOT·PEST 등 범용 틀 나열이 아니라 도메인·주제 특화 기준으로.
- 수립·기획: 목표(To-Be)·실행과제·자원·거버넌스·일정으로. 로드맵·다년도 계획이면 연차별 시간축·마일스톤을 필수로 포함.
- 운영·실행 기획(이벤트/행사/캠페인/런칭): 추상 전략과제·KPI가 아니라 운영 구성요소로(콘셉트·프로그램(식순)·대상자/의전·운영실행(장소·협력업체·인력·현장·비상대응)·예산/일정(D-day 역산)·홍보).
- 조사·연구: 답을 찾아야 할 리서치 질문 형태로(범위·대상, 현황, 핵심 동향 축, 현안·전망). 산출물은 출처 기반 사실 정리이지 평가기준이 아니다.
- 의사결정·문제해결: 최소 1개는 기준선(현행 유지)·철수안을 포함한 대안 집합, 1개는 평가기준·차원(도메인 관례 반영), 1개는 트레이드오프 종합·권고안. 선택지가 정의 안 된 비구조적 문제일 때만 문제의 하위 측면으로 분해.

[4. 조회 처리] 단일 정의·용어 조회처럼 더 쪼갤 게 없으면 1개로 둔다. 잔액·현황·집계처럼 산출이 필요하면 구성 수량(예: 잔액=총 한도−집행액 → 총 한도 확인/집행액 확인/잔액 산출)과 기준 시점·범위·단위로 분해하되, 모든 하위문제는 '확인·산출' 등 검색·집계 성격을 유지하라(원인·추세·개선방안 금지).

[5. 출력] 도메인 용어·관례를 반영하고, 하위 문제는 서로 독립적으로 2~4개(조회는 위 규칙대로) 작성하라.`;

async function decompose(microModel: string, topic: string, signal?: AbortSignal): Promise<SubProblem[]> {
  const parsed = await microJSON<{ subproblems?: Array<{ id?: string; text?: string }> }>(
    microModel,
    DECOMPOSE_SYSTEM,
    `주제: ${topic}\n\n위 지침에 따라 유형을 먼저 식별한 뒤 분해하라.\n형식: {"subproblems":[{"id":"sp1","text":"..."}]}`,
    { signal, maxOutputTokens: 700 },
  );
  const subs = (parsed?.subproblems ?? [])
    .map((s, i) => ({ id: asString(s?.id).trim() || `sp${i + 1}`, text: asString(s?.text).trim() })) // LLM 비문자열 필드 안전화
    .filter((s) => s.text);
  return subs.length ? subs : [{ id: 'sp1', text: topic }];
}

/** 공통 준비 단계. 모델이 없으면 error+run_done emit 후 null. */
export async function prepareRun(
  bus: EventBus,
  topic: string,
  company: CompanyDef,
  signal?: AbortSignal,
  directedAgentId?: string,
): Promise<Prepared | null> {
  bus.emit(EventType.run_started, {
    topic,
    // 직원 지명(단독) 런이면 그 직원 id — 프론트 오피스뷰의 솔로 안무 + 가짜 팀간회의 억제 신호. 전사/토론 런은 undefined.
    directed_agent_id: directedAgentId,
    config: { backend: CONFIG.backend, run_mode: CONFIG.runMode, concurrency: CONFIG.concurrency },
  });
  bus.emit(EventType.company_started, { name: company.name, mission: company.mission });

  const specs = getSystemSpecs();
  const claude = isClaudeBackend();
  let assign: ModelAssignment;
  if (claude) {
    // Claude 백엔드: 고정 클라우드 티어맵. Ollama 조회·웜업·'모델 없음' 하드에러 브랜치를 건너뛴다.
    assign = resolveAssignment();
  } else {
    const installed = await ollama.listModels();
    if (installed.length === 0) {
      bus.emit(EventType.error, { message: 'Ollama 에서 모델을 찾지 못했습니다. `ollama serve` 와 모델 설치를 확인하세요.' });
      bus.emit(EventType.run_done, { status: 'error' });
      return null;
    }
    // 웹 UI(LLM 설정)에서 고른 로컬 모델 우선. env LOCAL_LLM_MODEL 이 박혀 있으면 그것이 최우선(단일 모델 강제).
    assign = CONFIG.localModel
      ? { micro: CONFIG.localModel, standard: CONFIG.localModel, heavy: CONFIG.localModel, reason: `고정 모델 ${CONFIG.localModel}` }
      : autoAssignModels(installed, specs, tierOverrides());
  }
  // 모델 배정 가시화 — tier별 모델 + 예측 VRAM(GB, 로컬만 의미). claude 는 0.
  const vram = (m: string): number => (claude ? 0 : Math.round(estimateModelMemoryGB(m) * 10) / 10);
  const modelMap = {
    micro: { model: assign.micro, vram_gb: vram(assign.micro) },
    standard: { model: assign.standard, vram_gb: vram(assign.standard) },
    heavy: { model: assign.heavy, vram_gb: vram(assign.heavy) },
  };
  bus.emit(EventType.log, {
    message: `모델 배정 — ${assign.reason}`,
    specs: claude ? 'Claude 클라우드 백엔드' : specs.summary, models: modelMap, budget_gb: claude ? 0 : specs.safeModelBudgetGB,
  });

  if (!claude) void ollama.warm(assign.standard);

  // 분해는 런 전체의 프레임을 정하므로 도메인 충실성이 중요 → micro 대신 standard(문서 종류를 더 정확히 인식).
  const subproblems = await decompose(assign.standard, topic, signal);
  bus.emit(EventType.topic_decomposed, { subproblems, debate_gated: false });

  return { assign, subproblems };
}
