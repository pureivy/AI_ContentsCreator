/** 자비스(비서) 대화 코어 — 페르소나로 ollama 단일 chat, 업무지시면 delegate JSON 방출.
 *  format:'json' 미사용(자유응답 보존) → 자유 텍스트 후 firstJson 으로 delegate 추출. */
import { ollama } from '../llm/ollama';
import { getLlmSetting } from '../llm/setting';
import { getCompany } from '../agents/company-loader';
import { firstJson } from '../tools/classify';   // Step 3a 에서 classify.ts 가 export 노출

export interface JarvisTurn { role: 'user' | 'assistant'; content: string }
export interface JarvisReply { reply: string; delegate?: { task: string } }

export function jarvisSystemPrompt(): string {
  const co = getCompany();
  const sec = co.specialists.find((r) => r.id === 'secretary')
    ?? co.teams?.find((t) => t.lead?.id === 'secretary')?.lead;
  const persona = sec?.systemPrompt ?? '당신은 (재)경상북도경제진흥원 CEO를 보좌하는 비서입니다.';
  const name = sec?.name ?? '자비스';
  return [
    persona,
    `당신의 이름은 ${name} 입니다. 사용자와 친근하고 간결하게(1~3문장) 한국어로 대화합니다.`,
    '인사·잡담·간단한 질의에는 JSON 없이 바로 답합니다.',
    '사용자 발화가 실행 가능한 업무 지시이면, 짧은 확인 응답을 한 뒤 마지막 줄에 JSON 한 줄로',
    '{"delegate":{"task":"<담당 직원들이 수행할 과제 한 문장>"}} 를 출력합니다.',
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
    messages: [{ role: 'system', content: jarvisSystemPrompt() }, ...messages.slice(-12)],
    maxOutputTokens: 400, temperature: 0.4, signal: opts.signal,
  });
  const raw = (res.text ?? '').trim();
  const j = firstJson<{ delegate?: { task?: string } }>(raw);
  const task = j?.delegate?.task;
  if (task && String(task).trim()) {
    const reply = raw.replace(/\{[\s\S]*\}\s*$/, '').trim() || '네, 처리하겠습니다.';
    return { reply, delegate: { task: String(task).trim() } };
  }
  return { reply: raw };
}
