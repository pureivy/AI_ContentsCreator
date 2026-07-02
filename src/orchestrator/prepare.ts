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

// 콘텐츠 리서치 분해 프롬프트 — 네이버 블로그(정보/하우투·리뷰) 글감을 검색 노출 목표의 리서치 하위 과제로 나눈다.
// (구 정부 문서 유형 분해에서 콘텐츠 리서치로 전환 — 산출물은 '조사·분석'이지 초안 작성이 아니다.)
const DECOMPOSE_SYSTEM = `너는 콘텐츠 리서치 기획자다. 주어진 주제(네이버 블로그 글감)를 서로 독립적인 리서치 하위 과제로 나눠라.

[전제] 정보/하우투·리뷰 콘텐츠이며, 목표는 네이버 검색 노출(SEO)이다. 하위 과제는 모두 '조사·분석' 성격을 유지하라(본문 초안 작성이 아니다).

[분해 축 — 아래에서 서로 겹치지 않는 2~4개를 고른다]
- 키워드/검색량: 타겟 핵심 키워드·연관 키워드, 검색량·경쟁도(검색광고·데이터랩 근거).
- 검색 의도: 이 검색을 하는 독자가 실제로 원하는 것(정보 습득·비교·구매 결정·따라하기).
- 경쟁 콘텐츠: 현재 상위 노출된 글들의 구성·강점과 빈틈(우리가 더 잘할 차별화 각도).
- 본문 소주제: 글에 담을 핵심 소주제·섹션(하우투면 단계, 리뷰면 항목·장단점).

[출력] 도메인·주제에 맞는 구체적 표현으로, 하위 과제는 서로 독립적으로 2~4개 작성하라.`;

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
  /** true 면 분해(decompose) 생략 — 리비전 런(기존 초안 개정)처럼 하위 문제가 무의미한 경로. */
  skipDecompose = false,
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

  // 콘텐츠 리서치 분해 — 구조적 단발이라 micro(haiku)로 충분·저비용. (리비전 런은 생략)
  const subproblems = skipDecompose ? [] : await decompose(assign.micro, topic, signal);
  if (!skipDecompose) bus.emit(EventType.topic_decomposed, { subproblems, debate_gated: false });

  return { assign, subproblems };
}
