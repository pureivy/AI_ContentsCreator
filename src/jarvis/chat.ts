/** 자비스(비서) 대화 코어 — 페르소나로 ollama 단일 chat, 업무지시면 delegate JSON 방출.
 *  format:'json' 미사용(자유응답 보존) → 자유 텍스트 후 firstJson 으로 delegate 추출. */
import { llm } from '../llm/client';
import { getLlmSetting, isClaudeBackend, resolveAssignment } from '../llm/setting';
import { getCompany } from '../agents/company-loader';
import { firstJson } from '../tools/classify';   // Step 3a 에서 classify.ts 가 export 노출
import { kstNowKo } from '../util/time';

export interface JarvisTurn { role: 'user' | 'assistant'; content: string }
export interface JarvisReply { reply: string; delegate?: { task: string; agent?: string } }

const SECRETARY_ID = 'secretary';   // 자비스 본인(비서실 lead) — 위임 대상에서 제외(자기위임 방지)

/** 위임 대상 후보 — 비-CEO 직원에서 비서(자비스) 자신을 뺀 목록. 자비스가 이 중 1명을 고른다.
 *  (specialists 자체는 office 뷰·org 모드가 쓰므로 건드리지 않고, 여기서만 필터.) */
function delegatableSpecialists() {
  return getCompany().specialists.filter((r) => r.id !== SECRETARY_ID);
}
function roster(): string {
  // id | 실명 | 직함 | 주요 업무(specialty). specialty 는 재원(일반회계 vs 수탁회계)·겸장 사업·
  // 계약/감사/IT 등 변별 단서를 담아 정확한 라우팅에 결정적 — title 만으론 인접 직무가 안 갈림.
  return delegatableSpecialists()
    .map((r) => {
      const spec = (r.specialty ?? '').replace(/\s*\(※[^)]*\)\s*/g, ' ').trim(); // 토론 전용 비평가 주석 제거
      const s = spec.length > 150 ? spec.slice(0, 150) + '…' : spec;
      return `${r.id} | ${r.name ?? ''} | ${r.title}${s ? ' | ' + s : ''}`;
    })
    .join('\n');
}
function validAgentIds(): Set<string> {
  return new Set(delegatableSpecialists().map((r) => r.id));
}

export function jarvisSystemPrompt(): string {
  // 짧은 페르소나 + 직원 명단(위임 대상 선택용). 잡담 저지연 위해 장문 회사 페르소나는 안 씀.
  // 팀장 id 는 실제 회사 로스터에서 동적으로 — 하드코딩(구 정부 팀 id) 제거.
  const leads = (getCompany().teams ?? []).map((t) => t.lead.id).filter((id) => id !== SECRETARY_ID);
  const leadRule = leads.length
    ? `담당 선택: 특정 분야의 구체적 실무는 그 분야 담당자에게, 여러 분야가 걸친 복합 업무나 팀 전체 총괄·방향 설정은 팀장(${leads.join('·')})에게 맡깁니다.`
    : '담당 선택: 각 업무를 가장 적합한 담당자에게 맡깁니다.';
  return [
    "당신은 '자비스'(JARVIS), 주인님을 보좌하는 인공지능 비서입니다.",
    `현재 시각은 ${kstNowKo()} 입니다. 오늘 날짜·요일·시간을 묻는 질문에는 반드시 이 값(대한민국 표준시)을 기준으로 답하고, 학습 시점의 날짜를 추측하지 마세요.`,
    '사용자를 항상 "주인님"이라고 부르며, 친근하고 간결하게(1~2문장) 한국어로 대화합니다.',
    '인사·잡담·간단한 질의, 그리고 일정 관리·미팅 예약·메모·받아쓰기 등 비서 본연의 일은 JSON 없이 직접 답하고 위임하지 않습니다.',
    '그 밖의 실행 가능한 업무 지시이면, 짧은 확인 응답 후 마지막 줄에 JSON 한 줄로',
    '{"delegate":{"task":"<과제 한 문장>","agent":"<아래 직원 목록 id 중 그 일에 가장 적합한 1명>"}} 를 출력합니다.',
    leadRule,
    '직원 목록(id | 실명 | 직함 | 주요 업무):',
    roster(),
  ].join('\n');
}

function resolveModel(): string {
  // Claude 백엔드: 자비스 잡담·위임판정은 저지연 micro(haiku). 로컬: 설정 모델 우선.
  if (isClaudeBackend()) return resolveAssignment().micro;
  const m = getLlmSetting().localModel;
  return m && m.trim() ? m : 'gemma4:12b';
}

export async function jarvisChat(
  messages: JarvisTurn[],
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<JarvisReply> {
  const model = opts.model ?? resolveModel();
  const res = await llm.chat({
    model,
    messages: [{ role: 'system', content: jarvisSystemPrompt() }, ...messages.slice(-8)],
    maxOutputTokens: 200, temperature: 0.4, think: false, signal: opts.signal, // think:false → 잡담 저지연(추론 토글 무관)
  });
  const raw = (res.text ?? '').trim();
  const j = firstJson<{ delegate?: { task?: string; agent?: string } }>(raw);
  const task = j?.delegate?.task;
  if (task && String(task).trim()) {
    const reply = raw.replace(/\{[\s\S]*\}\s*$/, '').trim() || '네, 처리하겠습니다.';
    const a = j?.delegate?.agent ? String(j.delegate.agent).trim() : '';
    const agent = a && validAgentIds().has(a) ? a : undefined;   // 유효 직원 id 만 채택
    return { reply, delegate: agent ? { task: String(task).trim(), agent } : { task: String(task).trim() } };
  }
  return { reply: raw };
}
