/**
 * Ollama 네이티브 직접 클라이언트 (Connect AI 벤치마킹).
 *
 * 원본 GEPA: Claude CLI 서브프로세스 → Ollama `/v1/messages`. 매 턴 거대 프롬프트 + 프로세스 오버헤드.
 * 여기: `/api/chat` 를 fetch 로 직접 스트리밍. 프로세스/SDK 오버헤드 0, 프롬프트는 호출측이 최소로 통제.
 *
 * 핵심 규칙(원본 실측 교훈 보존):
 *  - `num_ctx` 를 options 에 절대 넣지 않는다 → 요청별 옵션 변동은 Ollama 모델 리로드 스래시.
 *    컨텍스트 길이는 서버 env(OLLAMA_CONTEXT_LENGTH)로만 통제한다.
 *  - `keep_alive` 는 요청에 같이 보내 상주 유도(서버 기본 5m 되돌림 완화). 정식 경로는 서버 env.
 *  - `num_predict`(=max output)로 소형 모델 폭주를 백스톱.
 */
import { CONFIG } from '../config';
import type { InstalledModel } from './models';
import { anySignal } from '../util/abort';
import { Semaphore } from '../util/semaphore';
import { getRunSettings } from '../runsettings';

/** 전역 LLM 슬롯 — 모든 chat() 호출을 프로세스 단위로 게이트. 로컬 concurrency=1 이면 동시 런이
 *  여럿이어도 한 번에 하나의 생성만(단일 Ollama KV 슬롯 불변식을 런 경계를 넘어 보장). */
const LLM_SLOT = new Semaphore(CONFIG.concurrency);

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  keepAlive?: string;
  signal?: AbortSignal;
  /** Ollama 구조화 출력 — 'json' 이면 유효 JSON 강제(분해·배정·수렴판정 등 파싱 신뢰도↑). */
  format?: 'json';
  /** 토큰 델타 콜백(스트리밍 UI용). */
  onDelta?: (text: string) => void;
}

export interface ChatResult {
  text: string;
  model: string;
  promptEvalCount: number;
  evalCount: number;
  totalDurationMs: number;
  loadDurationMs: number;
  /** done_reason === 'length' (num_predict 한도 절단). */
  truncated: boolean;
  doneReason: string;
}

export interface LoadedModel {
  name: string;
  expiresAt: string;
  sizeVramGB: number;
  contextLength: number;
}

export class OllamaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'OllamaError';
  }
}

export class OllamaClient {
  constructor(private readonly baseUrl: string = CONFIG.ollamaBaseUrl) {}

  private url(p: string): string {
    return this.baseUrl.replace(/\/+$/, '') + p;
  }

  /** 설치된 모델 목록 (GET /api/tags). 실패 시 []. */
  async listModels(): Promise<InstalledModel[]> {
    try {
      const r = await fetch(this.url('/api/tags'), { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return [];
      const data = (await r.json()) as { models?: Array<{ name: string; size?: number }> };
      return (data.models ?? [])
        .filter((m) => m.name)
        .map((m) => ({ name: m.name, sizeGB: (m.size ?? 0) / 1024 ** 3 }));
    } catch {
      return [];
    }
  }

  /** 현재 메모리 상주 모델 (GET /api/ps) — keep_alive/num_ctx 적용 확인용. */
  async loaded(): Promise<LoadedModel[]> {
    try {
      const r = await fetch(this.url('/api/ps'), { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return [];
      const data = (await r.json()) as {
        models?: Array<{ name: string; expires_at?: string; size_vram?: number; context_length?: number }>;
      };
      return (data.models ?? []).map((m) => ({
        name: m.name,
        expiresAt: m.expires_at ?? '',
        sizeVramGB: (m.size_vram ?? 0) / 1024 ** 3,
        contextLength: m.context_length ?? 0,
      }));
    } catch {
      return [];
    }
  }

  async version(): Promise<string | null> {
    try {
      const r = await fetch(this.url('/api/version'), { signal: AbortSignal.timeout(2000) });
      if (!r.ok) return null;
      return ((await r.json()) as { version?: string }).version ?? null;
    } catch {
      return null;
    }
  }

  /** 모델 선적재(웜업) — POST /api/generate 에 프롬프트 없이 keep_alive 만. 첫 호출 콜드 로드 제거. */
  async warm(model: string, keepAlive = CONFIG.keepAlive): Promise<boolean> {
    try {
      const r = await fetch(this.url('/api/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: keepAlive }),
        signal: AbortSignal.timeout(120_000), // 콜드 로드는 느릴 수 있음
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /**
   * 임베딩(POST /api/embed) — 위키 의미검색용. input 배열을 한 번에 보내 임베딩 배열을 받는다.
   * 실패(모델 미설치·연결오류)는 null 반환 → 호출측이 휴리스틱으로 폴백(회귀 0).
   */
  async embed(model: string, input: string[], signal?: AbortSignal): Promise<number[][] | null> {
    if (!model || !input.length) return null;
    try {
      const r = await fetch(this.url('/api/embed'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input, keep_alive: CONFIG.keepAlive }),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
      if (!r.ok) return null;
      const data = (await r.json()) as { embeddings?: number[][] };
      return Array.isArray(data.embeddings) && data.embeddings.length ? data.embeddings : null;
    } catch {
      return null;
    }
  }

  /**
   * 채팅 완성 — /api/chat 스트리밍(NDJSON). onDelta 로 토큰을 흘리고, 완료 시 집계 반환.
   * num_ctx 는 의도적으로 미포함(서버 env 전담).
   */
  async chat(params: ChatParams): Promise<ChatResult> {
    return LLM_SLOT.run(() => this._chat(params));
  }

  private async _chat(params: ChatParams): Promise<ChatResult> {
    // 추론(thinking) — AGENT_THINKING 활성 + 생성 단계(구조적 JSON 호출 제외)에서만 켠다. 추론은 답변
    // 품질을 높이지만 토큰 예산을 잠식하므로(이 모델은 단순 질문에도 ~500~1000토큰 추론) 활성 시 num_predict 에
    // thinkingBudgetTokens 를 더해 답변(content)이 잘리지 않게 한다. 미설정(기본)이면 기존대로 think:false.
    const wantThink = getRunSettings().agentThinking && params.format !== 'json';
    const baseOut = Math.max(1, params.maxOutputTokens ?? CONFIG.maxOutputTokens);
    const numPredict = wantThink ? Math.min(baseOut + CONFIG.thinkingBudgetTokens, 32_768) : baseOut;
    const body = {
      model: params.model,
      messages: params.messages,
      stream: true,
      think: wantThink,
      // 구조화 출력 — format:'json' 이면 Ollama 가 유효 JSON 만 생성(코드펜스·머리말 잡음 제거).
      ...(params.format ? { format: params.format } : {}),
      keep_alive: params.keepAlive ?? CONFIG.keepAlive,
      options: {
        num_predict: numPredict,
        temperature: params.temperature ?? CONFIG.temperature,
        top_p: params.topP ?? CONFIG.topP,
        top_k: params.topK ?? CONFIG.topK,
        // ⚠ num_ctx 절대 금지 — 서버 env(OLLAMA_CONTEXT_LENGTH)로만.
      },
    };

    const timeout = AbortSignal.timeout(CONFIG.requestTimeoutMs);
    const signal = params.signal ? anySignal([params.signal, timeout]) : timeout;

    let resp: Response;
    try {
      resp = await fetch(this.url('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw new OllamaError(`Ollama 연결 실패: ${(e as Error).message}`);
    }
    if (!resp.ok || !resp.body) {
      const txt = await resp.text().catch(() => '');
      throw new OllamaError(`Ollama HTTP ${resp.status}: ${txt.slice(0, 200)}`, resp.status);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const parts: string[] = [];
    const result: ChatResult = {
      text: '', model: params.model, promptEvalCount: 0, evalCount: 0,
      totalDurationMs: 0, loadDurationMs: 0, truncated: false, doneReason: '',
    };

    const handleLine = (line: string): void => {
      const s = line.trim();
      if (!s) return;
      let obj: {
        message?: { content?: string };
        done?: boolean;
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
        total_duration?: number;
        load_duration?: number;
        error?: string;
      };
      try {
        obj = JSON.parse(s);
      } catch {
        return; // 부분 라인 — 다음 청크에서 합쳐짐(아래 buffer 처리로 방지되지만 방어적)
      }
      if (obj.error) throw new OllamaError(`Ollama: ${obj.error}`);
      const delta = obj.message?.content;
      if (delta) {
        parts.push(delta);
        params.onDelta?.(delta);
      }
      if (obj.done) {
        result.doneReason = obj.done_reason ?? '';
        result.truncated = obj.done_reason === 'length';
        result.promptEvalCount = obj.prompt_eval_count ?? 0;
        result.evalCount = obj.eval_count ?? 0;
        result.totalDurationMs = (obj.total_duration ?? 0) / 1e6;
        result.loadDurationMs = (obj.load_duration ?? 0) / 1e6;
      }
    };

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          handleLine(line);
        }
      }
      // 마지막 잔여 라인(주로 done 메트릭) — 파싱 실패는 진단만(text 는 이미 수집됨).
      if (buffer.trim()) {
        try { handleLine(buffer); }
        catch (e) { console.warn('[ollama] 종료 라인 파싱 실패:', (e as Error).message); }
      }
    } finally {
      // throw/abort 시에도 스트림·소켓 해제(단일 KV 슬롯 누수 방지).
      await reader.cancel().catch(() => {});
    }

    result.text = parts.join('').trim();
    return result;
  }
}


/** 모듈 공용 싱글톤. */
export const ollama = new OllamaClient();
