import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCommentItem, loadCommentState, mutateCommentState, pickNewComments, sweepPostingComments, updateCommentItem, type FoundComment } from './comments';

const now = new Date('2026-10-25T12:00:00Z');
const f = (p: Partial<FoundComment>): FoundComment => ({
  platform: 'blog', externalId: '1', author: '마춤휀스', text: '얼마나 파야 보이나요?', commentTs: '2026-10-25T07:40:45.000Z',
  targetId: 'biondi_tree/224452392468', own: false, answered: false, ...p,
});

let dir = '';
let file = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-')); file = path.join(dir, 'index.json'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('pickNewComments', () => {
  it('우리 댓글·이미 답한 댓글·빈 댓글·이틀 넘은 댓글은 뺀다', () => {
    const got = pickNewComments([
      f({ externalId: 'a' }), f({ externalId: 'b', own: true }), f({ externalId: 'c', answered: true }),
      f({ externalId: 'd', text: '  ' }), f({ externalId: 'e', commentTs: '2026-10-22T00:00:00Z' }),
    ], { items: [], since: {} }, now);
    expect(got.map((x) => x.externalId)).toEqual(['a']);
  });
  it('기준 시각이 있으면 그 뒤만, 이미 담은 댓글은 다시 담지 않는다(재시작해도 텔레그램 중복 없음)', () => {
    const s = { items: [], since: { blog: '2026-10-20T00:00:00Z' } } as Parameters<typeof pickNewComments>[1];
    const first = pickNewComments([f({ externalId: 'x', commentTs: '2026-10-21T00:00:00Z' })], s, now);
    expect(first).toHaveLength(1);
    addCommentItem(s as never, first[0]!, { brand: 'b', contentTitle: 't', draft: 'd' }, now);
    expect(pickNewComments([f({ externalId: 'x', commentTs: '2026-10-21T00:00:00Z' })], s, now)).toEqual([]);
    // 다른 채널의 같은 번호는 다른 댓글
    expect(pickNewComments([f({ platform: 'clip', externalId: 'x' })], s, now)).toHaveLength(1);
  });
});

describe('상태 파일', () => {
  it('추가·수정·끊긴 올리기 정리', () => {
    const item = mutateCommentState((s) => addCommentItem(s, f({}), { brand: 'b', contentTitle: '대추나무', draft: '안녕하세요' }, now), file);
    expect(item.id).toMatch(/^cmt_[0-9a-f]{10}$/); // 텔레그램 콜백 규격([A-Za-z0-9_]{1,48})
    expect(item).not.toHaveProperty('own');
    updateCommentItem(item.id, { status: 'posting' }, file);
    expect(sweepPostingComments(file)).toBe(1);
    const got = loadCommentState(file).items[0]!;
    expect(got.status).toBe('failed');
    expect(got.error).toContain('확인');
  });
});
