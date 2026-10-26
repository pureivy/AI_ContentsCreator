// 발행 가드(2026-10-26) — 네이버 재발행 409, 릴스 in-flight 락 순서, 유튜브 상한의 진행 중 편, 처리 안 된 rejection 보고기.
// 데이터 디렉토리는 임시 폴더로 바꾼다(실데이터 오염 금지) — config 가 모듈 로드 때 읽으므로 동적 import.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-guards-'));
process.env.GEPA_DATA_DIR = tmp;

// 릴스 재인코딩을 손으로 붙잡아 둔다 — 첫 요청이 이 await 에 머무는 동안 두 번째 요청이 락에 막히는지 본다.
let releaseVideo: ((v: string | null) => void) | null = null;
vi.mock('../tools/shortsRender', async (orig) => ({
  ...(await orig<typeof import('../tools/shortsRender')>()),
  ensureMetaVideo: vi.fn(() => new Promise<string | null>((r) => { releaseVideo = r; })),
}));

type App = { request: (p: string, init?: RequestInit) => Response | Promise<Response> };
type Main = {
  app: App;
  naverRepublishBlock: (p: { publishedUrl?: string; privateUrl?: string; naverPublishUnconfirmedTs?: string }, o?: { dryRun?: boolean; republish?: boolean }) => string | null;
  naverPublishPatch: (
    r: { privatePublished: boolean; publicPublished: boolean; draftUrl?: string },
    prev: { publishedUrl?: string; privateUrl?: string }, o: { republish?: boolean; nowIso: string },
  ) => { patch: Record<string, string | undefined>; publicNow?: string; unconfirmed: boolean };
  redactSecrets: (t: string) => string;
  connectorTestKeyBlock: (name: string, o: { staticKeys: ReadonlySet<string>; savedKeys: ReadonlySet<string> }) => string | null;
  fbPickCookieMatches: (cookie: string | undefined, state: string) => boolean;
  fbPickCookieName: (state: string) => string;
  AUTH_EXEMPT_PATHS: ReadonlySet<string>;
  youtubeCapUploads: (list: Array<{ id: string; brand?: string; youtubeTs?: string }>, inFlight: Set<string>, brand: string, nowIso: string) => Array<{ youtubeTs?: string }>;
  unhandledRejectionReporter: (send: (m: { title: string; body: string }) => Promise<unknown>, o?: { gapMs?: number; now?: () => number; log?: (m: string) => void }) => (r: unknown) => void;
};
let m: Main;

beforeAll(async () => {
  m = await import('./main') as unknown as Main;
});

const post = (p: string, body: unknown = {}) => m.app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('naverRepublishBlock — 이미 올라간 글 재발행 차단(순수)', () => {
  it('publishedUrl·privateUrl 이 있으면 사유 문장, 없으면 null', () => {
    expect(m.naverRepublishBlock({ publishedUrl: 'https://blog.naver.com/x/1' })).toContain('이미 네이버에 발행된 글');
    expect(m.naverRepublishBlock({ privateUrl: 'https://blog.naver.com/x/2' })).toContain('비공개로 발행된 글');
    expect(m.naverRepublishBlock({})).toBeNull();
  });
  it('시험 실행·republish 명시는 통과', () => {
    expect(m.naverRepublishBlock({ privateUrl: 'u' }, { dryRun: true })).toBeNull();
    expect(m.naverRepublishBlock({ privateUrl: 'u' }, { republish: true })).toBeNull();
  });
});

describe('POST /pieces/:id/naver-draft — 재발행 409', () => {
  it('비공개 발행분은 텔레그램 버튼(actor)으로 다시 눌러도 409 와 안내 문장', async () => {
    const { pieceStore } = await import('../content/pieces');
    const p = pieceStore().create({ title: '모과나무 삽목 시기' });
    pieceStore().update(p.id, { runId: 'run-nonexistent-guard', stage: 'ready', privateUrl: 'https://blog.naver.com/bionditree/223' });
    const r = await post(`/pieces/${p.id}/naver-draft`, { actor: '텔레그램' });
    expect(r.status).toBe(409);
    const j = await r.json() as { error: string };
    expect(j.error).toContain('이미 네이버에');
    expect(j.error).toContain('republish');
  });
  it('republish:true 면 이 가드는 지나간다(없는 초안이라 뒤 단계에서 멈춤 — 실제 발행 없음)', async () => {
    const { pieceStore } = await import('../content/pieces');
    const p = pieceStore().create({ title: '모과나무 삽목 시기 2' });
    pieceStore().update(p.id, { runId: 'run-nonexistent-guard', stage: 'ready', privateUrl: 'https://blog.naver.com/bionditree/224' });
    const r = await post(`/pieces/${p.id}/naver-draft`, { republish: true });
    const j = await r.json() as { error?: string };
    expect(j.error ?? '').not.toContain('이미 네이버에');
    expect([400, 404]).toContain(r.status); // 계정 미설정(400) 또는 draft.json 없음(404)
  });
  it('임시저장 폴백(naverDraftUrl 만)은 막지 않는다 — 다시 저장해 마무리하는 정상 경로', async () => {
    const { pieceStore } = await import('../content/pieces');
    const p = pieceStore().create({ title: '모과나무 삽목 시기 3' });
    pieceStore().update(p.id, { runId: 'run-nonexistent-guard', stage: 'ready', naverDraftUrl: 'https://blog.naver.com/x/postwrite' });
    const r = await post(`/pieces/${p.id}/naver-draft`, {});
    const j = await r.json() as { error?: string };
    expect(j.error ?? '').not.toContain('이미 네이버에');
  });
});

describe('POST /shorts/:id/meta — in-flight 락은 재인코딩 전에 잡고 끝나면 푼다', () => {
  it('첫 요청이 재인코딩 중이면 두 번째는 409 처리 중, 끝난 뒤엔 다시 받는다', async () => {
    const { shortsStore } = await import('../content/shorts');
    const s = shortsStore().create({ topic: '무화과 삽목', platform: 'instagram' });
    shortsStore().update(s.id, { stage: 'ready', durationSec: 25 });
    const first = post(`/shorts/${s.id}/meta`);
    for (let i = 0; i < 50 && !releaseVideo; i++) await new Promise((r) => setTimeout(r, 10));
    expect(releaseVideo).not.toBeNull(); // 첫 요청이 재인코딩 await 에 들어갔다
    const second = await post(`/shorts/${s.id}/meta`);
    expect(second.status).toBe(409);
    expect((await second.json() as { error: string }).error).toBe('이미 발행 처리 중입니다');
    releaseVideo!(null);
    releaseVideo = null;
    const r1 = await first;
    expect((await r1.json() as { error: string }).error).toBe('영상 파일 없음');
    // finally 가 풀었다 — 세 번째 요청은 락이 아니라 다시 재인코딩 단계로 들어간다
    const third = post(`/shorts/${s.id}/meta`);
    for (let i = 0; i < 50 && !releaseVideo; i++) await new Promise((r) => setTimeout(r, 10));
    expect(releaseVideo).not.toBeNull();
    releaseVideo!(null);
    expect((await (await third).json() as { error: string }).error).toBe('영상 파일 없음');
  });
});

describe('youtubeCapUploads — 올리는 중인 편도 하루 상한에 센다(순수)', () => {
  const now = '2026-10-26T01:00:00.000Z';
  it('같은 브랜드의 진행 중 편(youtubeTs 없음)을 지금 시각 업로드로 하나씩 더한다', () => {
    const list = [
      { id: 'a', brand: 'b1' }, { id: 'b', brand: 'b1' }, { id: 'c', brand: 'b2' },
      { id: 'd', brand: 'b1', youtubeTs: '2026-10-25T00:00:00.000Z' },
    ];
    const out = m.youtubeCapUploads(list, new Set(['a', 'c', 'd']), 'b1', now);
    expect(out.filter((x) => x.youtubeTs === now)).toHaveLength(1); // a 만(c 는 다른 브랜드, d 는 이미 기록됨)
    expect(out).toHaveLength(4); // b1 기록 3 + 진행 중 1
  });
  it('진행 중이 없으면 브랜드 기록 그대로', () => {
    expect(m.youtubeCapUploads([{ id: 'a' }], new Set(), '', now)).toEqual([{ id: 'a' }]);
  });
});

describe('unhandledRejectionReporter — 로그는 매번, 알림은 간격당 1회, 절대 던지지 않는다', () => {
  it('10분 안의 두 번째는 알림 없이 로그만', () => {
    let t = 0;
    const sent: string[] = []; const logs: string[] = [];
    const h = m.unhandledRejectionReporter(async (x) => { sent.push(x.body); }, { now: () => t, log: (s) => logs.push(s) });
    h(new Error('첫 오류'));
    t = 5 * 60_000; h('두 번째');
    t = 11 * 60_000; h('세 번째');
    expect(logs).toHaveLength(3);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('첫 오류');
    expect(sent[1]).toContain('세 번째');
  });
  it('알림이 동기로 던지거나 거부해도 처리기는 던지지 않는다', async () => {
    const boom = m.unhandledRejectionReporter(() => { throw new Error('send 실패'); }, { log: () => {} });
    expect(() => boom('x')).not.toThrow();
    const rej = m.unhandledRejectionReporter(() => Promise.reject(new Error('거부')), { log: () => {} });
    expect(() => rej('y')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // 거부가 처리됐는지(vitest 가 unhandled 로 잡지 않음)
  });
});

// ── 2026-10-26 통합 검토 후속 ──
describe('naverRepublishBlock — 발행 버튼은 눌렸지만 주소 확인 못 한 글', () => {
  it('주소가 없어도 확인 필요 표시가 있으면 막고, republish 는 통과', () => {
    const msg = m.naverRepublishBlock({ naverPublishUnconfirmedTs: '2026-10-26T06:10:00.000Z' });
    expect(msg).toContain('글 주소를 확인하지 못한');
    expect(m.naverRepublishBlock({ naverPublishUnconfirmedTs: '2026-10-26T06:10:00.000Z' }, { republish: true })).toBeNull();
  });
});

describe('naverPublishPatch — 잡 결과 → 조각 주소(순수)', () => {
  const now = '2026-10-26T06:00:00.000Z';
  const real = 'https://blog.naver.com/bionditree/224000000001';
  it('눌렸는데 진짜 주소가 없으면(편집기 주소) 확인 필요 시각을 찍는다', () => {
    const r = m.naverPublishPatch({ privatePublished: true, publicPublished: true, draftUrl: 'https://blog.naver.com/bionditree/postwrite' }, {}, { nowIso: now });
    expect(r.unconfirmed).toBe(true);
    expect(r.patch).toEqual({ naverPublishUnconfirmedTs: now });
    expect(r.publicNow).toBeUndefined();
  });
  it('주소가 확인되면 privateUrl·전체공개 주소, 확인 필요 표시는 지운다', () => {
    const r = m.naverPublishPatch({ privatePublished: true, publicPublished: true, draftUrl: real }, {}, { nowIso: now });
    expect(r.unconfirmed).toBe(false);
    expect(r.patch.privateUrl).toBe(real);
    expect('naverPublishUnconfirmedTs' in r.patch && r.patch.naverPublishUnconfirmedTs === undefined).toBe(true);
    expect(r.publicNow).toBe(real);
  });
  it('임시저장 폴백은 아무 표시도 건드리지 않는다', () => {
    expect(m.naverPublishPatch({ privatePublished: false, publicPublished: false, draftUrl: 'x/postwrite' }, { privateUrl: real }, { nowIso: now }).patch).toEqual({});
  });
  it('republish: 새 비공개 주소로 바꾸고, 옛 공개 주소는 지운다(RSS 감지가 새 글을 찾게)', () => {
    const r = m.naverPublishPatch({ privatePublished: true, publicPublished: false, draftUrl: real }, { publishedUrl: 'https://blog.naver.com/bionditree/1', privateUrl: 'https://blog.naver.com/bionditree/1' }, { republish: true, nowIso: now });
    expect(r.patch.privateUrl).toBe(real);
    expect('publishedUrl' in r.patch && r.patch.publishedUrl === undefined).toBe(true);
  });
  it('republish 인데 새 주소 확인 못 함: 옛 주소 둘 다 지우고 확인 필요 표시', () => {
    const r = m.naverPublishPatch({ privatePublished: true, publicPublished: false, draftUrl: 'x/postwrite' }, { publishedUrl: 'old1', privateUrl: 'old2' }, { republish: true, nowIso: now });
    expect(r.patch).toEqual({ privateUrl: undefined, publishedUrl: undefined, naverPublishUnconfirmedTs: now });
  });
});

describe('POST /pieces/:id/naver-draft — 확인 필요 표시도 409', () => {
  it('옛 텔레그램 버튼이 주소 확인 못 한 글을 다시 올리지 않는다', async () => {
    const { pieceStore } = await import('../content/pieces');
    const p = pieceStore().create({ title: '모과나무 삽목 시기 4' });
    pieceStore().update(p.id, { runId: 'run-nonexistent-guard', stage: 'ready', naverDraftUrl: 'https://blog.naver.com/x/postwrite', naverPublishUnconfirmedTs: '2026-10-26T06:10:00.000Z' });
    const r = await post(`/pieces/${p.id}/naver-draft`, { actor: '텔레그램' });
    expect(r.status).toBe(409);
    expect((await r.json() as { error: string }).error).toContain('글 주소를 확인하지 못한');
  });
});

describe('redactSecrets — 오류 문장 속 비밀 가리기(순수)', () => {
  it('쿼리 토큰·키·Bearer·JSON 토큰을 가리고 이름은 남긴다', () => {
    const t = m.redactSecrets('GET https://graph.instagram.com/me/media?fields=id&access_token=IGQabc123&limit=5 failed; Authorization: Bearer ya29.XYZ-_.1; serviceKey=SK%2B1 "refresh_token":"1//abc" client_secret=GOCSPX-1');
    expect(t).not.toMatch(/IGQabc123|ya29\.XYZ|SK%2B1|1\/\/abc|GOCSPX-1/);
    expect(t).toContain('access_token=***');
    expect(t).toContain('Bearer ***');
    expect(t).toContain('"refresh_token":"***"');
    expect(t).toContain('&limit=5');
  });
  it('보고기는 가린 문장만 로그·알림으로 낸다', () => {
    const sent: string[] = []; const logs: string[] = [];
    const h = m.unhandledRejectionReporter(async (x) => { sent.push(x.body); }, { log: (s) => logs.push(s) });
    h(new Error('fetch failed: https://x/y?access_token=SECRET1'));
    expect(logs.join('\n')).not.toContain('SECRET1');
    expect(sent.join('\n')).not.toContain('SECRET1');
  });
});

describe('connectorTestKeyBlock — 커넥터 시험·저장이 실을 수 있는 키(순수)', () => {
  const o = { staticKeys: new Set(['LAW_API_KEY']), savedKeys: new Set(['KOSIS_API']) };
  it('코드 커넥터 키·사용자 키 꼴·이미 저장된 옛 이름은 통과', () => {
    expect(m.connectorTestKeyBlock('LAW_API_KEY', o)).toBeNull();
    expect(m.connectorTestKeyBlock('MY_SERVICE_API_KEY', o)).toBeNull();
    expect(m.connectorTestKeyBlock('KOSIS_API', o)).toBeNull();
  });
  it('앱 자격 증명·예약 이름·꼴 밖 이름은 막는다(저장된 이름이어도 앱 자격 증명은 막음)', () => {
    expect(m.connectorTestKeyBlock('TELEGRAM_BOT_TOKEN', o)).toContain('앱이 직접 쓰는');
    expect(m.connectorTestKeyBlock('TELEGRAM_BOT_TOKEN', { ...o, savedKeys: new Set(['TELEGRAM_BOT_TOKEN']) })).toContain('앱이 직접 쓰는');
    expect(m.connectorTestKeyBlock('AUTH_TOKEN', o)).not.toBeNull();
    expect(m.connectorTestKeyBlock('PATH', o)).not.toBeNull();
    expect(m.connectorTestKeyBlock('', o)).not.toBeNull();
  });
  it('POST /connectors/test 는 막힌 이름이면 값을 읽기 전에 400', async () => {
    const r = await post('/connectors/test', { cfg: { keyName: 'TELEGRAM_BOT_TOKEN', endpoint: 'https://example.com/?q={query}&k={key}' } });
    expect(r.status).toBe(400);
  });
});

describe('AUTH_TOKEN 면제는 정확한 경로만 · 페이스북 페이지 선택은 쿠키까지', () => {
  it('면제 목록은 콜백·선택 네 경로뿐', () => {
    expect([...m.AUTH_EXEMPT_PATHS].sort()).toEqual(['/meta/fb/oauth/callback', '/meta/fb/pick', '/meta/oauth/callback', '/youtube/oauth/callback']);
  });
  it('토큰이 켜지면 접두만 같은 경로는 401, 면제 경로는 지나가 state 검사에서 멈춘다', async () => {
    process.env.AUTH_TOKEN = 'test-auth-token';
    try {
      expect((await m.app.request('/meta/fb/pickX?state=a')).status).toBe(401);
      expect((await m.app.request('/meta/fb/oauth/callback/x')).status).toBe(401);
      expect((await m.app.request('/meta/oauth/callbackZ')).status).toBe(401);
      expect((await m.app.request('/runs')).status).toBe(401);
      const pick = await m.app.request('/meta/fb/pick?state=deadbeef&page=1');
      expect(pick.status).toBe(400); // 면제는 됐고, 서버가 만든 적 없는 state 라 거절
      const cb = await m.app.request('/meta/fb/oauth/callback?state=deadbeef&code=c');
      expect(cb.status).toBe(200);
      expect(await cb.text()).toContain('유효하지 않거나 만료된');
    } finally { delete process.env.AUTH_TOKEN; }
  });
  it('fbPickCookieMatches — 콜백이 심은 쿠키와 state 가 같아야 한다', () => {
    expect(m.fbPickCookieMatches('a=1; fb_pick_abc123=abc123', 'abc123')).toBe(true);
    expect(m.fbPickCookieMatches('fb_pick_abc123=abc124', 'abc123')).toBe(false);
    expect(m.fbPickCookieMatches(undefined, 'abc123')).toBe(false);
    expect(m.fbPickCookieMatches('fb_pick_=', '')).toBe(false);
    // 두 연결을 동시에 열어도 각자 자기 쿠키로 통과한다(나중 콜백이 먼저 연 쪽을 덮지 않음)
    expect(m.fbPickCookieMatches('fb_pick_aaaa1111=aaaa1111ff; fb_pick_bbbb2222=bbbb2222ee', 'aaaa1111ff')).toBe(true);
    expect(m.fbPickCookieMatches('fb_pick_aaaa1111=aaaa1111ff; fb_pick_bbbb2222=bbbb2222ee', 'bbbb2222ee')).toBe(true);
  });
});

describe('GET /media/file/:id — 스트리밍 + Range', () => {
  it('Range 요청엔 206·Content-Range, 범위 밖은 416, 없으면 200 전체', async () => {
    const lib = await import('../content/mediaLibrary');
    const dir = typeof lib.mediaDir === 'function' ? lib.mediaDir() : String(lib.mediaDir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'clip.mp4');
    fs.writeFileSync(file, Buffer.from('0123456789'));
    const item = lib.addMedia({ file, kind: 'video', name: 'clip.mp4', bytes: 10 });
    const part = await m.app.request(`/media/file/${item.id}`, { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    expect((await m.app.request(`/media/file/${item.id}`, { headers: { range: 'bytes=50-' } })).status).toBe(416);
    const full = await m.app.request(`/media/file/${item.id}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(await full.text()).toBe('0123456789');
  });
});
