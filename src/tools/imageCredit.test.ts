import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sent: string[] = [];
let tgOk = true;
vi.mock('../autonomy/notify', () => ({ sendTelegramHtml: async (html: string) => { if (!tgOk) return false; sent.push(html); return true; } }));

import { CONFIG } from '../config';
import {
  checkImageCredit, clearImageCredit, creditAlertHtml, deferForCredit, imageCreditOut, isCreditExhausted,
  loadCreditState, markImageCreditOut, noteImageOk, onImageCreditBack, probeImageCredit, CREDIT_DEFER_MAX_MS, CREDIT_REMIND_MS,
} from './imageCredit';

const cfg = CONFIG as unknown as { openaiApiKey: string };
const QUOTA_BODY = JSON.stringify({ error: { message: 'You have no credits remaining. Add credits to continue using the API', type: 'insufficient_quota', code: 'credit_balance_exhausted' } });
const res = (status: number, body = '{}'): Response => new Response(body, { status });
const fetchOf = (r: Response | Error): typeof fetch => (async () => { if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch;

let dir = '';
let file = '';
let key = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-credit-'));
  file = path.join(dir, 'image-credit.json');
  key = cfg.openaiApiKey;
  cfg.openaiApiKey = 'sk-test';
  sent.length = 0;
  tgOk = true;
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  cfg.openaiApiKey = key;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('isCreditExhausted', () => {
  it('10-25 실측 오류 문구를 잡는다', () => {
    expect(isCreditExhausted(`Error code: 429 - {'error': {'message': 'You have no credits remaining.', 'type': 'insufficient_quota', 'code': 'credit_balance_exhausted'}}`)).toBe(true);
    expect(isCreditExhausted('billing_hard_limit_reached')).toBe(true);
  });
  it('일반 속도 제한·다른 오류는 잔액 소진이 아니다', () => {
    expect(isCreditExhausted('Error code: 429 - Rate limit reached for requests')).toBe(false);
    expect(isCreditExhausted('timeout')).toBe(false);
    expect(isCreditExhausted(undefined)).toBe(false);
  });
});

describe('상태 표시·미룬 편', () => {
  it('처음 표시할 때만 true, 30초 뒤 첫 알림에 그 사이 멈춘 편이 실린다', async () => {
    expect(markImageCreditOut('shorts', file)).toBe(true);
    expect(markImageCreditOut('shorts', file)).toBe(false);
    expect(imageCreditOut(file)).toBe(true);
    deferForCredit({ pieceId: 'p1', platform: 'instagram', auto: true, title: '무화과 가지 꽂기' }, file);
    deferForCredit({ pieceId: 'p1', platform: 'instagram', auto: true, title: '무화과 가지 꽂기' }, file); // 중복 무시
    expect(loadCreditState(file).deferred).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('잔액 소진');
    expect(sent[0]).toContain('무화과 가지 꽂기 (인스타)');
    expect(sent[0]).toContain('platform.openai.com/settings/organization/billing');
  });
  it('해제하면 표시가 풀리고 일주일 넘은 편은 버린다', () => {
    const now = new Date('2026-10-25T09:00:00Z');
    markImageCreditOut('x', file, now);
    deferForCredit({ pieceId: 'old', title: '옛 글' }, file, new Date(now.getTime() - CREDIT_DEFER_MAX_MS - 1000));
    deferForCredit({ pieceId: 'new', platform: 'youtube', title: '새 글' }, file, now);
    const list = clearImageCredit(file, now);
    expect(list.map((d) => d.pieceId)).toEqual(['new']);
    expect(imageCreditOut(file)).toBe(false);
    expect(loadCreditState(file).deferred).toEqual([]);
  });
  it('원본 글 없는 편은 "직접 다시 만들어야 함"으로 표시한다', () => {
    const html = creditAlertHtml('out', { deferred: [{ shortId: 's1', title: '주제 <직접>', ts: '' }] });
    expect(html).toContain('주제 &lt;직접&gt; — 직접 다시 만들어야 함');
  });
});

describe('probeImageCredit', () => {
  it('2xx 만 ok, 429+잔액 문구 = out, 그 밖(일반 429·망 오류·401·404)은 unknown', async () => {
    expect(await probeImageCredit(fetchOf(res(200)))).toBe('ok');
    expect(await probeImageCredit(fetchOf(res(429, QUOTA_BODY)))).toBe('out');
    expect(await probeImageCredit(fetchOf(res(429, '{"error":{"message":"Rate limit reached"}}')))).toBe('unknown');
    expect(await probeImageCredit(fetchOf(new Error('ECONNRESET')))).toBe('unknown');
    expect(await probeImageCredit(fetchOf(res(401)))).toBe('unknown');
    expect(await probeImageCredit(fetchOf(res(404)))).toBe('unknown'); // 모델 폐기로 '해제→다시 표시'가 10분마다 돌지 않게
  });
  it('키가 없으면 확인하지 않고 ok(스크립트가 dry-run)', async () => {
    cfg.openaiApiKey = '';
    expect(await probeImageCredit(fetchOf(res(429, QUOTA_BODY)))).toBe('ok');
  });
});

describe('checkImageCredit', () => {
  it('표시가 없으면 확인 없이 true', async () => {
    expect(await checkImageCredit(fetchOf(new Error('호출되면 안 됨')), file)).toBe(true);
  });
  it('아직 소진이면 false — 첫 알림을 못 보냈으면 보내고, 그 뒤로는 6시간마다만', async () => {
    const t0 = new Date('2026-10-25T09:00:00Z');
    const t1 = new Date(t0.getTime() + 600_000);
    markImageCreditOut('x', file, t0);
    expect(await checkImageCredit(fetchOf(res(429, QUOTA_BODY)), file, t1)).toBe(false);
    expect(sent).toHaveLength(1); // 30초 타이머 전 — 첫 알림
    expect(await checkImageCredit(fetchOf(res(429, QUOTA_BODY)), file, new Date(t1.getTime() + CREDIT_REMIND_MS - 1000))).toBe(false);
    expect(sent).toHaveLength(1);
    expect(await checkImageCredit(fetchOf(res(429, QUOTA_BODY)), file, new Date(t1.getTime() + CREDIT_REMIND_MS))).toBe(false);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('아직 소진');
  });
  it('충전되면 해제·재개 알림·미룬 편을 넘긴다(동시 호출해도 한 번)', async () => {
    const got: string[][] = [];
    onImageCreditBack((list) => { got.push(list.map((d) => `${d.pieceId}:${d.platform}`)); return list.slice(0, 1); });
    markImageCreditOut('x', file);
    deferForCredit({ pieceId: 'p1', platform: 'youtube', title: '글' }, file);
    deferForCredit({ pieceId: 'p2', platform: 'instagram', title: '상한에 걸린 글' }, file);
    const f = fetchOf(res(200));
    const [a, b] = await Promise.all([checkImageCredit(f, file), checkImageCredit(f, file)]);
    expect(a && b).toBe(true);
    expect(got).toEqual([['p1:youtube', 'p2:instagram']]);
    expect(imageCreditOut(file)).toBe(false);
    const back = sent.find((x) => x.includes('재개')) ?? '';
    expect(back).toContain('• 글 (유튜브)');
    expect(back).not.toContain('상한에 걸린 글'); // 실제로 다시 만든 편만 싣는다
    expect(back).toContain('1편은 다시 만들지 않았습니다');
  });
  it('첫 알림을 못 보냈으면 다음 점검이 첫 알림 문구로 다시 보낸다', async () => {
    tgOk = false;
    markImageCreditOut('x', file);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(loadCreditState(file).lastAlertTs).toBeUndefined();
    tgOk = true;
    expect(await checkImageCredit(fetchOf(res(429, QUOTA_BODY)), file)).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('OpenAI 이미지 잔액 소진 —');
    expect(loadCreditState(file).lastAlertTs).toBeDefined();
  });
  it('확인 호출이 막혀 있어도 실제 그림이 나오면 풀린다', () => {
    const got: number[] = [];
    onImageCreditBack((list) => { got.push(list.length); return list; });
    markImageCreditOut('x', file);
    deferForCredit({ pieceId: 'p1', platform: 'youtube', title: '글' }, file);
    noteImageOk(file);
    expect(imageCreditOut(file)).toBe(false);
    expect(got).toEqual([1]);
    noteImageOk(file); // 표시가 없으면 아무 일 없음
    expect(got).toEqual([1]);
  });
});
