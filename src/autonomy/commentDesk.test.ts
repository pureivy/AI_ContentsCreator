import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanReplyDraft, commentButtons, commentCardHtml, enabledCommentPlatforms, parseCommentButtonId, postCommentReply, reviseCommentReply, runCommentCycle, skipCommentReply, type CommentDeskDeps } from './commentDesk';
import { loadCommentState, updateCommentItem, type FoundComment } from '../content/comments';

const now = new Date('2026-10-25T12:00:00Z');
const found = (p: Partial<FoundComment> = {}): FoundComment => ({
  platform: 'blog', externalId: '908631733635645587', author: '마춤휀스', text: '흙공 경계 밖으로 새 뿌리가 나갔는지는 땅을 얼마나 파야 보이나요?',
  commentTs: '2026-10-25T07:40:45.000Z', targetId: 'biondi_tree/224452392468', targetUrl: 'https://blog.naver.com/biondi_tree/224452392468', own: false, answered: false, ...p,
});

let dir = '';
let file = '';
let sent: Array<{ html: string; buttons?: unknown }> = [];
const deps = (over: Partial<CommentDeskDeps> = {}): CommentDeskDeps => ({
  collect: async () => ({ found: [found()], errors: [], patch: { counts: { 'blog:224452392468': 1 } } }),
  draft: async () => ({ reply: '안녕하세요 😊\n10~15cm 파 보세요.', needsCheck: '', spam: false }),
  resolve: () => ({ ref: { kind: 'piece', id: 'piece_7b05c12edc' }, title: '심은 대추나무 활착 실패 진단', body: '[블로그 글]\n흙공…' }),
  send: async (html, buttons) => { sent.push({ html, buttons }); return true; },
  log: () => {}, file, ...over,
});
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-')); file = path.join(dir, 'index.json'); sent = []; });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('runCommentCycle', () => {
  it('새 댓글 → 초안을 담고 버튼 달린 카드를 보낸다. 다음 주기엔 다시 보내지 않는다', async () => {
    const r = await runCommentCycle(deps(), now);
    expect(r.added).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain('블로그 · 「심은 대추나무 활착 실패 진단」');
    expect(sent[0]!.html).toContain('10~15cm');
    const s = loadCommentState(file);
    expect(s.items[0]!.status).toBe('pending');
    expect(s.items[0]!.notifiedTs).toBeDefined();
    expect(s.counts).toEqual({ 'blog:224452392468': 1 });
    expect(s.since.blog).toBe('2026-10-23T12:00:00.000Z');
    expect(sent[0]!.buttons).toEqual(commentButtons(s.items[0]!.id));
    await runCommentCycle(deps(), now);
    expect(sent).toHaveLength(1);
  });
  it('스팸은 버튼 없이 한 줄만 알린다', async () => {
    await runCommentCycle(deps({ draft: async () => ({ reply: '', needsCheck: '', spam: true }) }), now);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain('스팸');
    expect(sent[0]!.buttons).toBeUndefined();
    expect(loadCommentState(file).items[0]!.status).toBe('skipped');
  });
  it('초안 실패여도 인사 초안 + 확인 필요로 보낸다', async () => {
    await runCommentCycle(deps({ draft: async () => null }), now);
    expect(sent[0]!.html).toContain('확인 필요');
  });
  it('텔레그램 실패분은 다음 주기에 다시 보낸다', async () => {
    let ok = false;
    const d = deps({ send: async (html) => { if (ok) sent.push({ html }); return ok; } });
    await runCommentCycle(d, now);
    expect(loadCommentState(file).items[0]!.notifiedTs).toBeUndefined();
    ok = true;
    await runCommentCycle(d, now);
    expect(sent).toHaveLength(1);
  });
  it('상한(8개)을 넘긴 블로그 댓글은 그 글의 본 댓글 수를 지워 다음 주기에 다시 연다', async () => {
    const many = Array.from({ length: 10 }, (_, i) => found({ externalId: String(100 + i), commentTs: `2026-10-25T08:0${i}:00.000Z` }));
    const d = deps({ collect: async () => ({ found: many, errors: [], patch: { counts: { 'blog:224452392468': 10 } } }) });
    await runCommentCycle(d, now);
    const s = loadCommentState(file);
    expect(s.items).toHaveLength(8);
    expect(s.counts?.['blog:224452392468']).toBeUndefined();
  });
});

describe('버튼 동작', () => {
  it('건너뛰기·이미 올린 답글은 다시 못 올림·고치기(그대로:)', async () => {
    await runCommentCycle(deps(), now);
    const id = loadCommentState(file).items[0]!.id;
    expect(skipCommentReply(id, file).ok).toBe(true);
    expect(loadCommentState(file).items[0]!.status).toBe('skipped');
    const r = await reviseCommentReply(id, '그대로: 안녕하세요! 한 뼘만 파 보세요.', { send: async (h, b) => { sent.push({ html: h, buttons: b }); return true; }, file });
    expect(r.ok).toBe(true);
    const it2 = loadCommentState(file).items[0]!;
    expect(it2.draft).toBe('안녕하세요! 한 뼘만 파 보세요.');
    expect(it2.status).toBe('pending');
    expect(sent.at(-1)!.html).toContain('고친 초안 1');
    expect(sent.at(-1)!.buttons).toEqual(commentButtons(id, 1));
    // 옛 카드(초안 0)의 [올리기]는 막는다 — 화면과 다른 새 초안이 올라가지 않게
    const old = await postCommentReply(id, { withNaver: async () => { throw new Error('부르면 안 됨'); }, file }, 0);
    expect(old.status).toBe(409);
    expect(old.message).toContain('고친 초안');
    expect(loadCommentState(file).items[0]!.status).toBe('pending');
    updateCommentItem(id, { status: 'posted' }, file);
    const p = await postCommentReply(id, { withNaver: async () => { throw new Error('부르면 안 됨'); }, file });
    expect(p.status).toBe(409);
    expect((await reviseCommentReply(id, '더 짧게', { file })).status).toBe(409);
  });
  it('지시형 고치기는 먼저 초안과 지시를 넘긴다', async () => {
    await runCommentCycle(deps(), now);
    const id = loadCommentState(file).items[0]!.id;
    let seen: { previous?: string; feedback?: string } = {};
    await reviseCommentReply(id, '더 짧게', { file, send: async () => true, draft: async (x) => { seen = x; return { reply: '짧게', needsCheck: '', spam: false }; } });
    expect(seen.previous).toContain('10~15cm');
    expect(seen.feedback).toBe('더 짧게');
  });
});

describe('검토 반영(2026-10-25)', () => {
  it('초안을 쓰는 사이 올리는 중이 되면 고친 초안으로 덮지 않는다', async () => {
    await runCommentCycle(deps(), now);
    const id = loadCommentState(file).items[0]!.id;
    const r = await reviseCommentReply(id, '더 짧게', { file, send: async () => { throw new Error('카드 보내면 안 됨'); }, draft: async () => {
      updateCommentItem(id, { status: 'posting' }, file); // LLM 대기 중 [올리기]
      return { reply: '짧게', needsCheck: '', spam: false };
    } });
    expect(r.status).toBe(409);
    const it2 = loadCommentState(file).items[0]!;
    expect(it2.status).toBe('posting');
    expect(it2.draft).toContain('10~15cm');
  });
  it('초안 쓰다 끊기면 본 댓글 수를 저장하지 않아 다음 주기가 그 글을 다시 연다', async () => {
    await expect(runCommentCycle(deps({ draft: async () => { throw new Error('x'); }, resolve: () => { throw new Error('재시작'); } }), now)).rejects.toThrow();
    expect(loadCommentState(file).counts?.['blog:224452392468']).toBeUndefined();
  });
  it('보관 상한으로 버린 옛 댓글도 다시 담지 않는다(seen)', async () => {
    await runCommentCycle(deps(), now);
    const s = loadCommentState(file);
    expect(s.seen).toEqual(['blog:908631733635645587']);
  });
  it('버튼 id 해석', () => {
    expect(parseCommentButtonId('cmt_0123456789_r2')).toEqual({ id: 'cmt_0123456789', rev: 2 });
    expect(parseCommentButtonId('cmt_0123456789')).toEqual({ id: 'cmt_0123456789' });
  });
  it('카드: 따옴표 든 주소는 링크로 넣지 않고, 이모지를 반으로 자르지 않는다', () => {
    const base = { id: 'cmt_1', platform: 'instagram' as const, brand: '', externalId: 'x', author: 'a', commentTs: '', targetId: 'v', contentTitle: 't', draft: 'd', status: 'pending' as const, createdTs: '' };
    expect(commentCardHtml({ ...base, text: 'x', targetUrl: 'https://x.com/a"b' })).not.toContain('<a href');
    const html = commentCardHtml({ ...base, text: '😊'.repeat(700) });
    expect(html).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('순수 도우미', () => {
  it('초안 정리', () => {
    expect(cleanReplyDraft({ reply: '**굵게**\n\n\n\n끝' })).toEqual({ reply: '굵게\n\n끝', needsCheck: '', spam: false });
    expect(cleanReplyDraft({ reply: '' })).toBeNull();
    expect(cleanReplyDraft({ spam: true })?.spam).toBe(true);
  });
  it('카드 HTML 은 댓글 내용을 이스케이프한다', () => {
    const html = commentCardHtml({ id: 'cmt_1', platform: 'youtube', brand: '', externalId: 'x', author: '<b>a</b>', text: '<script>', commentTs: '', targetId: 'v', contentTitle: 't', draft: 'd', status: 'pending', createdTs: '' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('채널 설정', () => {
    expect(enabledCommentPlatforms('youtube, blog,foo')).toEqual(['blog', 'youtube']);
  });
  it('콜백 데이터 64바이트 이내', () => {
    for (const row of commentButtons('cmt_0123456789')) for (const b of row) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
});
