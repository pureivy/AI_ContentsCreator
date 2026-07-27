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
  it('GET /meta/fb/oauth/start: 비정상 슬러그 400', async () => {
    const bad = await app.request('/meta/fb/oauth/start?brand=../evil');
    expect(bad.status).toBe(400);
  });
  // 이 라우트의 결과는 로컬 .env(META_APP_ID 설정 여부)에 좌우된다 — 앰비언트 상태에 기대면
  // '키를 넣었더니 테스트가 깨지는' 가짜 실패가 난다. 두 상태 각각의 계약을 명시해 양쪽에서 변별력 유지.
  it('GET /meta/fb/oauth/start: 앱 미설정이면 조치 안내 400, 설정됐으면 페북 대화상자로 리디렉트', async () => {
    const st = await (await app.request('/meta/status')).json() as { fbClient: boolean };
    const res = await app.request('/meta/fb/oauth/start');
    if (!st.fbClient) {
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('META_APP_ID'); // 어느 키를 채워야 하는지 지목
      return;
    }
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.host).toBe('www.facebook.com');
    expect(loc.pathname).toContain('/dialog/oauth');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://localhost:8788/meta/fb/oauth/callback');
    expect(loc.searchParams.get('scope')).toContain('pages_manage_posts');
    expect(loc.searchParams.get('state')).toBeTruthy();   // CSRF nonce 없으면 콜백이 거부돼야 함
    expect(loc.search).not.toContain('client_secret');    // 시크릿은 프런트채널에 절대 실리지 않는다
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
