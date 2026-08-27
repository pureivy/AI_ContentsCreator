import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PieceStore, selectResumablePiece, autoDraftBlockedByFactGate, planAutoNaverDraft } from './pieces';
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

  it('clusterSeedId — 생성 시 기록되고 재로드에도 유지된다', () => {
    const s = new PieceStore(dir);
    const p = s.create({ title: '추희자두 후숙, 며칠이면 될까', keyword: '추희자두 후숙', clusterSeedId: 'cluster_abc' });
    expect(s.get(p.id)?.clusterSeedId).toBe('cluster_abc');
    expect(new PieceStore(dir).get(p.id)?.clusterSeedId).toBe('cluster_abc');
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

describe('autoDraftBlockedByFactGate — 자동 임시저장 차단 판정(사용자 확정: 자동 경로만 차단)', () => {
  const info = (status: 'pass' | 'hold' | 'error') => ({ status, unsupported: [], contradicted: [], checkedTs: 't' });
  it('hold·error 는 차단, pass·미실행은 통과', () => {
    expect(autoDraftBlockedByFactGate({ factGate: info('hold') })).toBe(true);
    expect(autoDraftBlockedByFactGate({ factGate: info('error') })).toBe(true);
    expect(autoDraftBlockedByFactGate({ factGate: info('pass') })).toBe(false);
    expect(autoDraftBlockedByFactGate({})).toBe(false);
  });
});

// 2026-08-27 사용자 확정 — 블로그는 근거 유무와 무관하게 전부 수동 검토 대기(자동 임시저장 기본 off).
// 결정 로직은 순수 함수 하나에만 있어야 한다(main.ts 는 이 결정에 따라 효과만 수행) — 여기서 네 갈래를 고정한다.
describe('planAutoNaverDraft — 자동 임시저장·리비전 결정(전면 수동 검토)', () => {
  const base = { runId: 'r1', stage: 'ready' as const };
  const on = { autoNaverDraft: true, seoMin: 80 };
  const off = { autoNaverDraft: false, seoMin: 80 };
  const hold = { status: 'hold' as const, unsupported: ['근거 없는 문장'], contradicted: [], checkedTs: 't' };

  it('off + SEO 통과 → 임시저장 호출 대신 draft-off(수동 검토 대기), on 이면 기존대로 draft', () => {
    expect(planAutoNaverDraft({ ...base, seoScore: 90 }, off)).toBe('draft-off');
    expect(planAutoNaverDraft({ ...base, seoScore: 90 }, on)).toBe('draft');
  });

  it('off 여도 SEO 판단·자동 리비전 결정은 그대로 수행한다(리비전은 유지)', () => {
    expect(planAutoNaverDraft({ ...base, seoScore: 70 }, off)).toBe('revise');
    expect(planAutoNaverDraft({ ...base, seoScore: 70 }, on)).toBe('revise');
    expect(planAutoNaverDraft({ ...base, seoScore: 70, autoRevisions: 1 }, off)).toBe('revise-exhausted');
    expect(planAutoNaverDraft({ ...base }, off)).toBe('revise-exhausted'); // SEO 미측정
  });

  it('off 면 사실 게이트 보류보다 먼저 걸러진다 — hold 로그는 on 일 때만 의미', () => {
    expect(planAutoNaverDraft({ ...base, seoScore: 90, factGate: hold }, off)).toBe('draft-off');
    expect(planAutoNaverDraft({ ...base, seoScore: 90, factGate: hold }, on)).toBe('fact-hold');
  });

  it('런 없음·ready 아님·이미 네이버 초안 있음은 skip(꺼짐 로그도 내지 않는다)', () => {
    expect(planAutoNaverDraft({ stage: 'ready', seoScore: 90 }, off)).toBe('skip');
    expect(planAutoNaverDraft({ ...base, stage: 'draft', seoScore: 90 }, off)).toBe('skip');
    expect(planAutoNaverDraft({ ...base, seoScore: 90, naverDraftUrl: 'https://blog.naver.com/x/1' }, off)).toBe('skip');
  });
});

// 킬스위치 회귀 가드(2026-08-26 최종 리뷰 F1) — FACT_GATE=off 로 돌린 런은 fact_gate.json 을 남기지
// 않는다. advancePieceReady 가 그때 키를 아예 안 실으면 직전 런의 hold 가 그대로 남아 자동 임시저장이
// 계속 막힌다("off 인데 안 꺼짐"). update 는 스프레드라 undefined 도 키로 실려 실제로 지워진다.
describe('PieceStore.update — factGate: undefined 로 이전 보류 해제', () => {
  it('hold 였던 piece 에 undefined 패치를 주면 자동 임시저장 차단이 풀린다(디스크에도 미영속)', () => {
    const s = new PieceStore(dir);
    const p = s.create({ title: '감나무 가을 전정' });
    s.update(p.id, { factGate: { status: 'hold', unsupported: ['근거 없는 문장'], contradicted: [], checkedTs: 't' } });
    expect(autoDraftBlockedByFactGate(s.get(p.id)!)).toBe(true);

    s.update(p.id, { factGate: undefined });
    expect(s.get(p.id)!.factGate).toBeUndefined();
    expect(autoDraftBlockedByFactGate(s.get(p.id)!)).toBe(false);
    // 재시작 후에도 풀린 상태여야 한다(JSON.stringify 가 undefined 키를 떨군다).
    expect(autoDraftBlockedByFactGate(new PieceStore(dir).get(p.id)!)).toBe(false);
  });
});
