/**
 * 외부 fetch + 타임아웃 — run signal(취소)과 타임아웃 signal 을 결합해, 외부 그라운딩 API 가 응답하지
 * 않아도 무한 대기하지 않게 한다(리뷰 발견: 커넥터 fetch 가 signal 만 받고 타임아웃이 없어 work 단계가
 * 외부 API 무응답 시 멈췄다). 타임아웃/취소 시 fetch 가 AbortError 를 던지므로, 호출부 try/catch 가
 * 빈 결과로 처리해 런은 중단 없이 진행된다.
 */
import { CONFIG } from '../config';
import { anySignal } from './abort';

export function fetchTimeout(
  url: string,
  opts: RequestInit = {},
  signal?: AbortSignal,
  ms: number = CONFIG.groundingTimeoutMs,
): Promise<Response> {
  const timeout = AbortSignal.timeout(ms);
  return fetch(url, { ...opts, signal: signal ? anySignal([signal, timeout]) : timeout });
}

/** 네트워크 단계 실패(응답 전 끊김)의 원인 코드 — undici 는 "fetch failed" 만 메시지로 주고 진짜 이유는 cause 에 둔다. */
export function fetchErrorDetail(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const c = (e as { cause?: { code?: string; message?: string } } | null)?.cause;
  return c ? `${msg} (${c.code ?? c.message ?? 'cause'})` : msg;
}

/**
 * fetchTimeout + 네트워크 실패 한 번 다시(2026-10-16) — 응답을 받은 실패(HTTP 4xx·5xx)·타임아웃·취소는 그대로 던지고,
 * 연결 단계 실패(TypeError "fetch failed")만 잠깐 쉬었다 한 번 더 부른다.
 * 실측: 릴스·카드뉴스 IG 성과 수집이 매 틱 마지막 항목(가장 최신 게시물)만 "fetch failed"로 빠져, 아침에 올린 릴스가
 * 성과 탭에 16회로 멈춰 있었다(같은 시각 직접 조회는 195회로 정상).
 */
export async function fetchTimeoutRetry(
  url: string,
  opts: RequestInit = {},
  signal?: AbortSignal,
  ms: number = CONFIG.groundingTimeoutMs,
  retryDelayMs = 1500,
): Promise<Response> {
  try {
    return await fetchTimeout(url, opts, signal, ms);
  } catch (e) {
    const network = e instanceof TypeError && !signal?.aborted;
    if (!network) throw e;
    await new Promise((r) => setTimeout(r, retryDelayMs));
    return fetchTimeout(url, opts, signal, ms);
  }
}
