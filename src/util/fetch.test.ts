import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTimeoutRetry, fetchErrorDetail } from './fetch';

afterEach(() => vi.restoreAllMocks());

// 2026-10-16 실측 — IG 성과 수집이 매 틱 마지막 항목만 "fetch failed"로 빠져 최신 릴스가 16회에 멈춰 있었다.
describe('fetchTimeoutRetry — 연결 단계 실패만 한 번 다시', () => {
  it('fetch failed(TypeError)면 한 번 더 불러 받은 응답을 돌려준다', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await fetchTimeoutRetry('https://graph.instagram.com/x', {}, undefined, 5000, 1);
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('HTTP 오류 응답은 다시 부르지 않는다', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const r = await fetchTimeoutRetry('https://graph.instagram.com/x', {}, undefined, 5000, 1);
    expect(r.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('두 번째도 실패하면 그대로 던진다', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchTimeoutRetry('https://graph.instagram.com/x', {}, undefined, 5000, 1)).rejects.toThrow('fetch failed');
  });
  it('fetchErrorDetail — cause 코드를 붙인다', () => {
    expect(fetchErrorDetail(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe('fetch failed (ECONNRESET)');
    expect(fetchErrorDetail(new Error('IG insights HTTP 500'))).toBe('IG insights HTTP 500');
  });
});
