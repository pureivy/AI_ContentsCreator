import { describe, it, expect } from 'vitest';
import { igTokenPlan, igTokenExpiresAt, IG_TOKEN_LIFE_DAYS } from '../secrets/store';
import { igTokenNeedsAlert, probeIgToken, refreshIgToken } from './igToken';

const day = 86_400_000;
const t0 = new Date('2026-09-18T09:00:00.000Z');

describe('igTokenPlan — 인스타 토큰 유지보수 판정(순수, 2026-09-18 만료 사고)', () => {
  it('발급 시각 미상 → stamp(오늘을 기준점으로)', () => {
    expect(igTokenPlan(undefined, t0)).toBe('stamp');
    expect(igTokenPlan('not-a-date', t0)).toBe('stamp');
  });
  it('7일 미만 → none, 7일 이상 → refresh, 60일 지나면 expired', () => {
    expect(igTokenPlan(new Date(t0.getTime() - 6 * day).toISOString(), t0)).toBe('none');
    expect(igTokenPlan(new Date(t0.getTime() - 7 * day).toISOString(), t0)).toBe('refresh');
    expect(igTokenPlan(new Date(t0.getTime() - 59 * day).toISOString(), t0)).toBe('refresh');
    expect(igTokenPlan(new Date(t0.getTime() - 60 * day).toISOString(), t0)).toBe('expired');
  });
  it('만료 시각은 발급 + 60일', () => {
    expect(igTokenExpiresAt(t0.toISOString())?.getTime()).toBe(t0.getTime() + IG_TOKEN_LIFE_DAYS * day);
    expect(igTokenExpiresAt(undefined)).toBeNull();
  });
});

describe('igTokenNeedsAlert — 만료·무효는 항상, 갱신 실패는 7일 이내만', () => {
  it('판정별', () => {
    expect(igTokenNeedsAlert({ slug: 'b', action: 'expired' })).toBe(true);
    expect(igTokenNeedsAlert({ slug: 'b', action: 'invalid' })).toBe(true);
    expect(igTokenNeedsAlert({ slug: 'b', action: 'refresh-failed', daysLeft: 20 })).toBe(false);
    expect(igTokenNeedsAlert({ slug: 'b', action: 'refresh-failed', daysLeft: 7 })).toBe(true);
    expect(igTokenNeedsAlert({ slug: 'b', action: 'refreshed', daysLeft: 60 })).toBe(false);
    expect(igTokenNeedsAlert({ slug: 'b', action: 'none' })).toBe(false);
  });
});

describe('probeIgToken / refreshIgToken — 그래프 응답 해석(fetch 주입)', () => {
  const mk = (status: number, body: unknown): typeof fetch =>
    (async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response) as unknown as typeof fetch;
  it('살아 있는 토큰 → ok, code 190 → 무효 메시지', async () => {
    expect(await probeIgToken('t', mk(200, { user_id: '1' }))).toEqual({ ok: true });
    const r = await probeIgToken('t', mk(400, { error: { code: 190, message: 'Session has expired' } }));
    expect(r).toMatchObject({ ok: false, code: 190, message: 'Session has expired' });
  });
  it('갱신 성공은 새 토큰, 실패는 메시지', async () => {
    expect(await refreshIgToken('t', mk(200, { access_token: 'NEW', expires_in: 5184000 }))).toEqual({ ok: true, token: 'NEW' });
    expect(await refreshIgToken('t', mk(400, { error: { message: 'too young' } }))).toEqual({ ok: false, message: 'too young' });
  });
  it('네트워크 예외는 ok:false 로 삼킨다(fail-open)', async () => {
    const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect((await probeIgToken('t', boom)).ok).toBe(false);
    expect((await refreshIgToken('t', boom)).ok).toBe(false);
  });
});
