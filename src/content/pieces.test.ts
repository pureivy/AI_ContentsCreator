import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PieceStore, selectResumablePiece } from './pieces';
import type { Piece } from './pieces';

let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pieces-')); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('PieceStore (라이프사이클 영속)', () => {
  it('create → get/list 왕복 + 디스크 지속(원자적 index.json)', () => {
    const s = new PieceStore(dir);
    const p = s.create({ title: '초보자 홈카페 원두 고르는 법', keyword: '원두 고르는 법', subNiche: '홈카페' });
    expect(p.stage).toBe('idea');
    expect(p.errors).toBe(0);
    expect(s.get(p.id)?.title).toBe('초보자 홈카페 원두 고르는 법');
    expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(true);

    // 새 인스턴스가 디스크에서 재로드(재시작 내구성)
    const reloaded = new PieceStore(dir);
    expect(reloaded.get(p.id)?.keyword).toBe('원두 고르는 법');
    expect(reloaded.list()).toHaveLength(1);
  });

  it('setStage / setPublished — 발행 시 stage=published + url', () => {
    const s = new PieceStore(dir);
    const p = s.create({ title: 'x' });
    s.setStage(p.id, 'ready');
    expect(s.get(p.id)?.stage).toBe('ready');
    const pub = s.setPublished(p.id, 'https://blog.naver.com/foo/123');
    expect(pub?.stage).toBe('published');
    expect(pub?.publishedUrl).toBe('https://blog.naver.com/foo/123');
  });

  it('recordError — 캡(3회) 초과 시 error 로 종료(폭주 방지)', () => {
    const s = new PieceStore(dir);
    const p = s.create({ title: 'x', stage: 'draft' });
    expect(s.recordError(p.id)?.stage).toBe('draft'); // 1
    expect(s.recordError(p.id)?.stage).toBe('draft'); // 2
    const capped = s.recordError(p.id); // 3 → 종료
    expect(capped?.errors).toBe(3);
    expect(capped?.stage).toBe('error');
  });

  it('update 는 createdTs 보존 + updatedTs 갱신', () => {
    const s = new PieceStore(dir);
    const p = s.create({ title: 'x' });
    const u = s.update(p.id, { seoScore: 72 });
    expect(u?.createdTs).toBe(p.createdTs);
    expect(u?.seoScore).toBe(72);
  });
});

describe('selectResumablePiece (재개 우선 — 완전 자율 내구성)', () => {
  const mk = (over: Partial<Piece>): Piece => ({
    id: over.id ?? 'p', title: 't', stage: 'idea', createdTs: '2026-01-01T00:00:00.000Z',
    updatedTs: '2026-01-01T00:00:00.000Z', ...over,
  });

  it('비종료(idea/research/draft) & 라이브 런 없음 → 재개 선택', () => {
    const p = mk({ id: 'a', stage: 'idea' });
    expect(selectResumablePiece([p], () => false)?.id).toBe('a');
  });

  it('사용자 양보로 죽은 draft(런 종료) → 재개 대상(고아 방지)', () => {
    const stranded = mk({ id: 'a', stage: 'draft', runId: 'dead-run' });
    const isLive = (rid?: string) => rid === 'live-run'; // dead-run 은 살아있지 않음
    expect(selectResumablePiece([stranded], isLive)?.id).toBe('a');
  });

  it('라이브 런이 붙은 draft → 재개 안 함(진행 중이니 대기)', () => {
    const running = mk({ id: 'a', stage: 'draft', runId: 'live-run' });
    const isLive = (rid?: string) => rid === 'live-run';
    expect(selectResumablePiece([running], isLive)).toBeNull();
  });

  it('종료 스테이지(ready/published/error)는 절대 재개 안 함', () => {
    const pieces = [mk({ id: 'r', stage: 'ready' }), mk({ id: 'p', stage: 'published' }), mk({ id: 'e', stage: 'error' })];
    expect(selectResumablePiece(pieces, () => false)).toBeNull();
  });

  it('재개 대상 여럿이면 가장 오래된 것', () => {
    const older = mk({ id: 'old', stage: 'idea', createdTs: '2026-01-01T00:00:00.000Z' });
    const newer = mk({ id: 'new', stage: 'draft', createdTs: '2026-02-01T00:00:00.000Z' });
    expect(selectResumablePiece([newer, older], () => false)?.id).toBe('old');
  });
});
