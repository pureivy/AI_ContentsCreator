/** 자비스(비서) 대화 코어 — 페르소나로 ollama 단일 chat, 업무지시면 delegate JSON 방출.
 *  format:'json' 미사용(자유응답 보존) → 자유 텍스트 후 firstJson 으로 delegate 추출. */
import { ollama } from '../llm/ollama';
import { getLlmSetting } from '../llm/setting';
import { getCompany } from '../agents/company-loader';
import { firstJson } from '../tools/classify';   // Step 3a 에서 classify.ts 가 export 노출

export interface JarvisTurn { role: 'user' | 'assistant'; content: string }
export interface JarvisReply { reply: string; delegate?: { task: string; agent?: string } }

const SECRETARY_ID = 'secretary';   // 자비스 본인(비서실 lead) — 위임 대상에서 제외(자기위임 방지)

/** 위임 대상 후보 — 비-CEO 직원에서 비서(자비스) 자신을 뺀 목록. 자비스가 이 중 1명을 고른다.
 *  (specialists 자체는 office 뷰·org 모드가 쓰므로 건드리지 않고, 여기서만 필터.) */
function delegatableSpecialists() {
  return getCompany().specialists.filter((r) => r.id !== SECRETARY_ID);
}
function roster(): string {
  return delegatableSpecialists().map((r) => `${r.id} | ${r.name ?? ''} | ${r.title}`).join('\n');
}
function validAgentIds(): Set<string> {
  return new Set(delegatableSpecialists().map((r) => r.id));
}

export function jarvisSystemPrompt(): string {
  // 짧은 페르소나 + 직원 명단(위임 대상 선택용). 잡담 저지연 위해 장문 회사 페르소나는 안 씀.
  return [
    "당신은 '자비스'(JARVIS), 주인님을 보좌하는 인공지능 비서입니다.",
    '사용자를 항상 "주인님"이라고 부르며, 친근하고 간결하게(1~2문장) 한국어로 대화합니다.',
    '인사·잡담·간단한 질의에는 JSON 없이 바로 답합니다.',
    '실행 가능한 업무 지시이면, 짧은 확인 응답 후 마지막 줄에 JSON 한 줄로',
    '{"delegate":{"task":"<과제 한 문장>","agent":"<아래 직원 목록 id 중 그 일에 가장 적합한 1명>"}} 를 출력합니다.',
    '직원 목록(id | 실명 | 주력업무):',
    roster(),
  ].join('\n');
}

function resolveModel(): string {
  // server/main.ts 의 standard 해석과 동일 취지: 설정된 로컬 모델 우선.
  const m = getLlmSetting().localModel;
  return m && m.trim() ? m : 'gemma4:12b';
}

export async function jarvisChat(
  messages: JarvisTurn[],
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<JarvisReply> {
  const model = opts.model ?? resolveModel();
  const res = await ollama.chat({
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
