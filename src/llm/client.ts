/**
 * LLM 프로바이더 파사드 — 모델 id 프리픽스로 백엔드 분기.
 *   claude-*  → Anthropic Claude
 *   그 외     → 로컬 Ollama(폴백/레거시; 콘텐츠 스튜디오 v1 은 claude 단독)
 *
 * 호출부는 `ollama.chat` 대신 `llm.chat` 을 쓰고, 임베딩·모델목록 등 Ollama 전용 기능은
 * 여전히 `ollama.*` 를 직접 쓴다. tier→모델 배정이 claude 모델 id 를 반환하면 자동으로 여기서 Claude 로 간다.
 */
import type { ChatParams, ChatResult } from './ollama';
import { ollama } from './ollama';
import { anthropic } from './anthropic';

export const llm = {
  chat(params: ChatParams): Promise<ChatResult> {
    return params.model.startsWith('claude-') ? anthropic.chat(params) : ollama.chat(params);
  },
};
