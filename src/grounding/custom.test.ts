import { describe, it, expect, vi, afterEach } from 'vitest';
import { isSafeRegexSource, fetchPublicFollow } from './custom';

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchPublicFollow — 리다이렉트 매 단계 SSRF 재검사(2026-10-26)', () => {
  it('공개 호스트가 127.0.0.1 로 30x 하면 거부하고 그 주소로는 요청하지 않는다', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://127.0.0.1:8787/x' } }),
    );
    await expect(fetchPublicFollow('https://1.1.1.1/start')).rejects.toThrow(/허용 밖/);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('http 로 내려가는 리다이렉트도 거부', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 301, headers: { location: 'http://1.1.1.1/' } }),
    );
    await expect(fetchPublicFollow('https://1.1.1.1/start')).rejects.toThrow(/허용 밖/);
  });
  it('공개 주소로의 리다이렉트는 따라가고, 무한 리다이렉트는 hops 에서 끊는다', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/b' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await fetchPublicFollow('https://1.1.1.1/a');
    expect(await r.text()).toBe('ok');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockReset();
    spy.mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } }));
    await expect(fetchPublicFollow('https://1.1.1.1/a')).rejects.toThrow(/리다이렉트 과다/);
    expect(spy).toHaveBeenCalledTimes(6);
  });
});

describe('isSafeRegexSource — ReDoS 위험 정규식 거부', () => {
  it('중첩 수량자(치명적 백트래킹) 거부', () => {
    expect(isSafeRegexSource('(a+)+')).toBe(false);
    expect(isSafeRegexSource('(a*)*')).toBe(false);
    expect(isSafeRegexSource('(.+)+$')).toBe(false);
  });
  it('200자 초과·비문자열 거부', () => {
    expect(isSafeRegexSource('a'.repeat(201))).toBe(false);
    expect(isSafeRegexSource(undefined as unknown as string)).toBe(false);
  });
  it('정상 패턴 허용', () => {
    expect(isSafeRegexSource('<title>([^<]+)</title>')).toBe(true);
    expect(isSafeRegexSource('\\d{1,3}')).toBe(true);
  });
});
