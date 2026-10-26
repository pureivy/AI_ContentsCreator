import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApprovalStore, TIMEOUT_NOTE, TIMEOUT_REJECT_NOTE } from './store';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apr-'));
});

describe('ApprovalStore', () => {
  it('요청 → 승인 결정 → pending 비움', async () => {
    const s = new ApprovalStore(dir);
    const { approval, decided } = s.request({ action_type: 'publish', summary: 'x' }, 10_000);
    expect(s.list()).toHaveLength(1);
    expect(s.decide(approval.id, true, 'go')).toBe(true);
    const d = await decided;
    expect(d.approved).toBe(true);
    expect(d.by).toBe('user');
    expect(s.list()).toHaveLength(0);
  });

  it('writePending 은 tmp+rename — 대기 폴더에 .tmp 가 남지 않고 재적재된다(2026-10-26)', () => {
    const s = new ApprovalStore(dir);
    const { approval } = s.request({ action_type: 'publish', summary: 'x' }, 10_000);
    const names = fs.readdirSync(path.join(dir, 'pending'));
    expect(names).toEqual([`${approval.id}.json`]);
    expect(new ApprovalStore(dir).list().map((a) => a.id)).toEqual([approval.id]);
  });

  it('거부 결정', async () => {
    const s = new ApprovalStore(dir);
    const { approval, decided } = s.request({ action_type: 'publish', summary: 'x' }, 10_000);
    s.decide(approval.id, false, '아니오');
    expect((await decided).approved).toBe(false);
  });

  it('타임아웃 → fail-open 자동승인', async () => {
    const s = new ApprovalStore(dir);
    const { decided } = s.request({ action_type: 'publish', summary: 'x' }, 30);
    const d = await decided;
    expect(d.approved).toBe(true);
    expect(d.by).toBe('timeout');
  });

  it('알 수 없는 id 결정 → false', () => {
    const s = new ApprovalStore(dir);
    expect(s.decide('apr_none', true)).toBe(false);
  });

  it('영속화 — pending 재로딩', () => {
    const s1 = new ApprovalStore(dir);
    const { approval } = s1.request({ action_type: 'publish', summary: 'x' }, 100_000);
    const s2 = new ApprovalStore(dir);
    expect(s2.list().map((a) => a.id)).toContain(approval.id);
  });
});

describe('ApprovalStore — 2026-10-26 감사', () => {
  const hist = (id: string) => JSON.parse(fs.readFileSync(path.join(dir, 'history', `${id}.json`), 'utf-8'));
  it('깨진 대기 파일 하나가 나머지 로딩을 막지 않는다 — 깨진 건 .corrupt 로 격리', () => {
    const s1 = new ApprovalStore(dir);
    const { approval } = s1.request({ action_type: 'publish', summary: 'ok' }, 100_000);
    fs.writeFileSync(path.join(dir, 'pending', 'apr_aaa_bad.json'), '{"id":');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s2 = new ApprovalStore(dir);
    spy.mockRestore();
    expect(s2.list().map((a) => a.id)).toEqual([approval.id]);
    const left = fs.readdirSync(path.join(dir, 'pending'));
    expect(left.some((f) => f.startsWith('apr_aaa_bad.json.corrupt-'))).toBe(true);
    expect(left).not.toContain('apr_aaa_bad.json');
  });
  it('취소 → cancelled 로 정산, 뒤늦은 타이머가 자동승인으로 덮지 않는다', async () => {
    const s = new ApprovalStore(dir);
    const { approval, decided } = s.request({ action_type: 'image_generate', summary: 'x' }, 30);
    expect(s.cancel(approval.id)).toBe(true);
    expect((await decided).approved).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    const h = hist(approval.id);
    expect(h.status).toBe('cancelled');
    expect(h.decided_by).toBe('abort');
    expect(s.list()).toHaveLength(0);
    expect(s.cancel(approval.id)).toBe(false);
  });
  it('타임아웃 기록은 사람 승인이 아님을 적고, fail-closed 요청은 거부로 남긴다', async () => {
    const s = new ApprovalStore(dir);
    const open = s.request({ action_type: 'image_generate', summary: 'x' }, 20);
    expect((await open.decided).approved).toBe(true); // 정책(fail-open)은 그대로
    expect(hist(open.approval.id)).toMatchObject({ status: 'approved', decided_by: 'timeout', note: TIMEOUT_NOTE });
    const closed = s.request({ action_type: 'blog_publish', summary: 'x' }, 20, false);
    expect((await closed.decided).approved).toBe(false);
    expect(hist(closed.approval.id)).toMatchObject({ status: 'rejected', decided_by: 'timeout', note: TIMEOUT_REJECT_NOTE });
  });
});
