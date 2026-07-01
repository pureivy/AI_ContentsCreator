/**
 * Anthropic Claude 클라이언트 — 기존 Ollama 와 동일한 ChatParams→ChatResult 계약 구현.
 * 호출부(orchestrator/agent 등)는 모델 id 로만 분기(llm/client.ts 파사드)하므로 이 파일을 몰라도 된다.
 *
 * 인증: new Anthropic() (apiKey 미지정) → SDK 자격증명 체인이 `ant auth login` OAuth 프로필을 자동 사용.
 *   ANTHROPIC_API_KEY 가 있으면 메터드 API 키 폴백. (로컬 단일 사용자 도구엔 표준 개발 패턴; 대규모/비대화형엔
 *   Anthropic 은 API 키·WIF 권장 — 회색지대.)
 * 토큰 갱신: OAuth 액세스 토큰은 ~8h 만료. 장시간 무감시 자율에 대비해 매 호출 클라이언트를 새로 구성한다
 *   (구성은 네트워크 없이 자격증명 파일만 읽어 저렴 → 갱신된 토큰 반영). LLM 호출 비용에 비해 무시가능.
 *
 * 모델별 파라미터 주의(그대로 안 지키면 400):
 *  - Sonnet 5 / Opus 4.8 등: temperature/top_p/top_k 전달 시 400 → 생략. thinking 은 명시(안 하면 Sonnet 은 adaptive=과금).
 *  - Haiku 4.5: temperature 허용, thinking/effort 미지원 → thinking 생략.
 */
import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from '../config';
import { getSecret } from '../secrets/store';
import { Semaphore } from '../util/semaphore';
import { recordUsage } from './cost';
import type { ChatParams, ChatResult, ChatMessage } from './ollama';

// 클라우드는 KV 슬롯 경합이 없어 단일 슬롯 불필요 — 넉넉한 동시성 + SDK 429 백오프.
const SLOT = new Semaphore(CONFIG.anthropicConcurrency);

/** ChatMessage[] → Anthropic {system, messages}. system 은 top-level 로 추출, messages 는 user 로 시작·빈 내용 제거. */
function toAnthropic(msgs: ChatMessage[]): { system?: string; messages: Anthropic.MessageParam[] } {
  const systemParts: string[] = [];
  const out: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    const content = (m.content ?? '').trim();
    if (m.role === 'system') { if (content) systemParts.push(content); continue; }
    if (!content) continue; // 빈 user/assistant 는 400 유발 → 제거
    out.push({ role: m.role, content });
  }
  // Anthropic 은 messages[0] 이 user 여야 함. 선두 assistant 면 최소 user 턴을 붙여 컨텍스트 보존.
  if (out.length && out[0]!.role === 'assistant') out.unshift({ role: 'user', content: '이어서 진행합니다.' });
  if (!out.length) out.push({ role: 'user', content: '(빈 입력)' });
  return { system: systemParts.join('\n\n') || undefined, messages: out };
}

export class AnthropicClient {
  async chat(params: ChatParams): Promise<ChatResult> {
    return SLOT.run(() => this._chat(params));
  }

  private async _chat(params: ChatParams): Promise<ChatResult> {
    const apiKey = getSecret('ANTHROPIC_API_KEY') || undefined; // 없으면 OAuth 프로필 사용
    const client = new Anthropic(apiKey ? { apiKey } : {});
    const model = params.model;
    const isHaiku = /haiku/i.test(model);
    const maxTokens = Math.min(Math.max(1, params.maxOutputTokens ?? CONFIG.maxOutputTokens), 64_000);
    const wantThink = (params.think ?? false) && params.format !== 'json';

    const { system, messages } = toAnthropic(params.messages);
    const base = { model, max_tokens: maxTokens, messages, ...(system ? { system } : {}) };
    const req: Anthropic.MessageStreamParams = isHaiku
      ? { ...base, ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}) }
      : { ...base, thinking: wantThink ? { type: 'adaptive' } : { type: 'disabled' } };

    const t0 = Date.now();
    let text = '';
    let inTok = 0, outTok = 0, cacheRead = 0, stopReason = '', outModel = model;
    try {
      const stream = client.messages.stream(req, { signal: params.signal });
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          text += ev.delta.text;
          params.onDelta?.(ev.delta.text);
        }
      }
      const final = await stream.finalMessage();
      stopReason = final.stop_reason ?? '';
      outModel = final.model ?? model;
      inTok = final.usage?.input_tokens ?? 0;
      outTok = final.usage?.output_tokens ?? 0;
      cacheRead = final.usage?.cache_read_input_tokens ?? 0;
      // stop_reason==='refusal' 이면 content 비어있음 → 빈 text 반환(호출측 빈 출력 처리에 위임).
    } catch (e) {
      throw new Error(`Anthropic ${model}: ${(e as Error).message}`);
    }
    recordUsage(outModel, inTok, outTok, cacheRead);

    return {
      text: text.trim(),
      model: outModel,
      promptEvalCount: inTok,
      evalCount: outTok,
      totalDurationMs: Date.now() - t0,
      loadDurationMs: 0,
      truncated: stopReason === 'max_tokens',
      doneReason: stopReason,
    };
  }
}

export const anthropic = new AnthropicClient();
