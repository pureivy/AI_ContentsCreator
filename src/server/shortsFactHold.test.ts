// 숏폼 사실 검증 보류 발행 게이트(2026-10-12 사장님 확정) — 세 발행 라우트가 네트워크에 닿기 전에 409 fact_hold 로 멈추는지.
// 데이터 디렉토리는 임시 폴더로 바꾼다(실데이터 오염 금지) — config 가 모듈 로드 때 읽으므로 동적 import.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-fact-hold-'));
process.env.GEPA_DATA_DIR = tmp;

type App = { request: (p: string, init?: RequestInit) => Response | Promise<Response> };
let app: App;
let ids: { yt: string; ig: string };

beforeAll(async () => {
  ({ app } = await import('./main') as unknown as { app: App });
  const { shortsStore } = await import('../content/shorts');
  const hold = { status: 'hold' as const, unsupported: ['겨울 넘기면 살았다고 봐요.'], contradicted: [], checkedTs: '2026-10-12T00:00:00Z' };
  const mk = (platform: 'youtube' | 'instagram') => {
    const s = shortsStore().create({ topic: '모과나무 삽목', platform });
    shortsStore().update(s.id, { stage: 'ready', durationSec: 25, factGate: hold });
    return s.id;
  };
  ids = { yt: mk('youtube'), ig: mk('instagram') };
});

const post = (p: string, body: unknown = {}) => app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('숏폼 사실 검증 보류 — 발행 라우트 게이트', () => {
  it('유튜브·릴스·클립 모두 409 fact_hold 와 근거 없는 문장을 돌려준다', async () => {
    for (const [p, id] of [['youtube', ids.yt], ['meta', ids.ig], ['naver-clip', ids.yt]] as const) {
      const r = await post(`/shorts/${id}/${p}`);
      expect(r.status).toBe(409);
      const j = await r.json() as { error: string; fact_hold?: string[] };
      expect(j.error).toContain('사실 검증 보류');
      expect(j.fact_hold).toEqual(['겨울 넘기면 살았다고 봐요.']);
    }
  });
  it('썸네일 강행(force)만으로는 풀리지 않는다 — 사실 검증 확인은 따로', async () => {
    const j = await (await post(`/shorts/${ids.ig}/meta`, { force: true })).json() as { fact_hold?: string[] };
    expect(j.fact_hold).toBeTruthy();
  });
});
