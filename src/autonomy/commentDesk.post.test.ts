import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 올리기 도중 예외(2026-10-26) — 채널 '이미 답했나' 판정만 갈아 끼운다(네트워크 없이).
const answered = vi.hoisted(() => ({ value: false as boolean | null }));
vi.mock('../tools/commentPlatforms', async (orig) => ({
  ...(await orig<typeof import('../tools/commentPlatforms')>()),
  naverAlreadyAnswered: async () => answered.value,
}));

import { postCommentReply, runCommentCycle, type CommentDeskDeps } from './commentDesk';
import { loadCommentState } from '../content/comments';

let dir = '';
let file = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-post-'));
  file = path.join(dir, 'index.json');
  answered.value = false;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const deps = (): CommentDeskDeps => ({
  collect: async () => ({
    found: [{ platform: 'blog', externalId: '9001', author: '손님', text: '언제 심나요?', commentTs: '2026-10-25T07:40:45.000Z', targetId: 'biondi_tree/224452392468', targetUrl: 'https://blog.naver.com/biondi_tree/224452392468', own: false, answered: false }],
    errors: [], patch: {},
  }),
  draft: async () => ({ reply: '11월에 심으세요.', needsCheck: '', spam: false }),
  resolve: () => ({ title: '감나무 심기', body: '…' }),
  send: async () => true,
  log: () => {}, file,
});

describe('postCommentReply — 올리기 시작 뒤 예외는 failed(중복 답글 방지)', () => {
  it('올리는 도중 끊기면 failed + 채널 확인 안내, 다음 [올리기]는 판정이 모름(null)이면 다시 올리지 않는다', async () => {
    await runCommentCycle(deps(), new Date('2026-10-25T12:00:00Z'));
    const id = loadCommentState(file).items[0]!.id;
    const first = await postCommentReply(id, { withNaver: async () => { throw new Error('socket hang up'); }, file });
    expect(first.ok).toBe(false);
    expect(first.message).toContain('채널에서 확인');
    const it1 = loadCommentState(file).items[0]!;
    expect(it1.status).toBe('failed'); // 종전엔 'pending' 으로 돌아가 다음 누름이 그대로 다시 올렸다
    answered.value = null;
    let called = 0;
    const again = await postCommentReply(id, { withNaver: async () => { called++; return { status: 'POSTED', output: '' }; }, file });
    expect(again.status).toBe(409);
    expect(called).toBe(0);
    expect(loadCommentState(file).items[0]!.status).toBe('failed');
  });
  it('채널이 "아직 없음(false)"을 확실히 말하면 failed 뒤에도 다시 올린다', async () => {
    await runCommentCycle(deps(), new Date('2026-10-25T12:00:00Z'));
    const id = loadCommentState(file).items[0]!.id;
    await postCommentReply(id, { withNaver: async () => { throw new Error('timeout'); }, file });
    answered.value = false;
    const again = await postCommentReply(id, { withNaver: async () => ({ status: 'POSTED', output: '' }), file });
    expect(again.ok).toBe(true);
    expect(loadCommentState(file).items[0]!.status).toBe('posted');
  });
});
