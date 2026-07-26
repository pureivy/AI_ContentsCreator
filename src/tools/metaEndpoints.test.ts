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

// 페이스북 페이지 연결(독립 축) — 인스타 상태와 별개 필드로 보고돼야 UI 가 '어느 채널이 연결됐나'를 구분한다.
describe('페이스북 페이지 연결 라우트', () => {
  it('GET /meta/status → fbClient/fbConnected 도 보고, 토큰류는 미노출', async () => {
    const res = await app.request('/meta/status');
    const j = await res.json() as Record<string, unknown>;
    expect(typeof j.fbClient).toBe('boolean');
    expect(typeof j.fbConnected).toBe('boolean');
    // 응답 어디에도 토큰 필드가 없어야 한다(페이지 id 는 공개 식별자라 허용)
    expect(Object.keys(j)).not.toContain('pageToken');
    expect(Object.keys(j)).not.toContain('pageAccessToken');
    expect(JSON.stringify(j)).not.toMatch(/access_token/i);
  });
  it('GET /meta/fb/oauth/start: 메타 앱 미설정이면 400(안내), 비정상 슬러그 400', async () => {
    const bad = await app.request('/meta/fb/oauth/start?brand=../evil');
    expect(bad.status).toBe(400);
    const noApp = await app.request('/meta/fb/oauth/start');
    expect(noApp.status).toBe(400); // META_APP_ID 미설정(테스트 환경) → 조치 안내
    expect(await noApp.text()).toContain('META_APP_ID');
  });
  it('GET /meta/fb/oauth/callback: state 없음 → 실패 안내(200 HTML)', async () => {
    const res = await app.request('/meta/fb/oauth/callback');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('연결 실패');
  });
  it('GET /meta/fb/pick: 만료·미상 state → 400(임의 페이지 저장 불가)', async () => {
    const res = await app.request('/meta/fb/pick?state=bogus&page=123');
    expect(res.status).toBe(400);
  });
  it('POST /meta/fb/disconnect: 비정상 슬러그 400', async () => {
    const res = await app.request('/meta/fb/disconnect?brand=../evil', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('POST /cardnews/:id/publish 가드', () => {
  it('미존재 id → 404', async () => {
    const res = await app.request('/cardnews/nope-xyz/publish', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown cardnews' });
  });
});

describe('POST /shorts/:id/meta 가드', () => {
  it('미존재 id → 404(JSON 본문 단언 — Hono 폴백과 변별)', async () => {
    const res = await app.request('/shorts/nope-xyz/meta', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown shorts' });
  });
});
