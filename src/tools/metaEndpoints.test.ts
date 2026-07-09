import { describe, it, expect } from 'vitest';
import { app } from '../server/main';

describe('메타 OAuth·상태 라우트', () => {
  it('GET /meta/status → client/connected 불리언', async () => {
    const res = await app.request('/meta/status');
    expect(res.status).toBe(200);
    const j = await res.json() as { client: boolean; connected: boolean };
    expect(typeof j.client).toBe('boolean');
    expect(typeof j.connected).toBe('boolean');
  });
  it('GET /meta/oauth/start: 클라이언트 미설정이면 400, 비정상 슬러그 400', async () => {
    const bad = await app.request('/meta/oauth/start?brand=../evil');
    expect(bad.status).toBe(400);
  });
  it('GET /meta/oauth/callback: state 없음 → 실패 안내(200 HTML)', async () => {
    const res = await app.request('/meta/oauth/callback');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('연결 실패');
  });
});

describe('POST /cardnews/:id/publish 가드', () => {
  it('미존재 id → 404', async () => {
    const res = await app.request('/cardnews/nope-xyz/publish', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown cardnews' });
  });
});
