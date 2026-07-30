import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeWindow, currentOccurrence, nextOccurrence, isDue, sanitizeTopic, PromiseStore, MAX_PENDING } from './promises';

describe('normalizeWindow', () => {
  it('"N월"과 계절어를 도래 월로 정규화한다', () => {
    expect(normalizeWindow('9월')).toBe(9);
    expect(normalizeWindow('12 월')).toBe(12);
    expect(normalizeWindow('가을')).toBe(9);
    expect(normalizeWindow('내년 봄')).toBe(3);
  });
  it('미지정·해석 불가는 null(자동 이행 제외 — 수동 처리)', () => {
    expect(normalizeWindow(undefined)).toBeNull();
    expect(normalizeWindow('적절한 때')).toBeNull();
    expect(normalizeWindow('13월')).toBeNull();
  });
});

describe('sanitizeTopic — 예고 주제는 다음 런의 프롬프트가 된다', () => {
  it('이모지·제어문자 제거, 콜론 제거(그라운딩 seedKeyword 절단 방지), 공백 접기, 80자 캡', () => {
    expect(sanitizeTopic('가을 파종: 배추 심기 🌱')).toBe('가을 파종 배추 심기');
    expect(sanitizeTopic('제목：전각 콜론')).toBe('제목 전각 콜론');
    expect(sanitizeTopic('줄\n바꿈\t문자')).toBe('줄 바꿈 문자');
    expect(sanitizeTopic('가'.repeat(120)).length).toBe(80);
  });
});

describe('isDue — 시즌 창(도래 월 1일부터 60일)', () => {
  const sep = { dueMonth: 9 };
  it('창 도래 전 false, 창 안 true, 창(60일) 지나면 false', () => {
    expect(isDue(sep, new Date('2026-08-15T00:00:00+09:00'))).toBe(false);
    expect(isDue(sep, new Date('2026-09-01T00:00:00+09:00'))).toBe(true);
    expect(isDue(sep, new Date('2026-10-20T00:00:00+09:00'))).toBe(true);  // 60일 창 안
    expect(isDue(sep, new Date('2026-11-15T00:00:00+09:00'))).toBe(false); // 창 경과 — 철 지난 발화 방지
  });
  it('창을 놓치면 이듬해 같은 창에 재도래', () => {
    expect(isDue(sep, new Date('2027-09-02T00:00:00+09:00'))).toBe(true);
    expect(nextOccurrence(sep, new Date('2026-11-15T00:00:00+09:00'))!.toISOString().slice(0, 7)).toBe('2027-08'); // KST 2027-09-01 = UTC 08-31
  });
  it('12월 창은 이듬해 1월까지 이어진다(연도 랩)', () => {
    expect(isDue({ dueMonth: 12 }, new Date('2027-01-15T00:00:00+09:00'))).toBe(true); // 2026-12-01 창의 60일 안
  });
  it('시기 미상(null)은 자동 이행 대상이 아니다', () => {
    expect(isDue({ dueMonth: null }, new Date('2026-09-01T00:00:00+09:00'))).toBe(false);
  });
  it('손상 dueMonth(범위 밖)는 도래하지 않는다', () => {
    expect(isDue({ dueMonth: 0 as unknown as number }, new Date())).toBe(false);
    expect(currentOccurrence(13, new Date())).toBeNull();
  });
});

describe('PromiseStore', () => {
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'promises-'));
  it('생성·sourceId 재등록 방지·이행 후 30일 재약속 루프 방지', () => {
    const s = new PromiseStore(tmp());
    const a = s.create({ topic: '배롱나무 가을 식재법', window: '9월', sourceKind: 'shorts', sourceId: 'short_1', brand: 'b' })!;
    expect(a.dueMonth).toBe(9);
    expect(s.create({ topic: '전혀 다른 주제', sourceKind: 'shorts', sourceId: 'short_1', brand: 'b' })!.id).toBe(a.id); // 같은 출처는 1약속
    expect(s.create({ topic: '배롱나무 가을식재법', window: '10월', sourceKind: 'cardnews', brand: 'b' })!.id).toBe(a.id); // 동일 주제 병합
    s.update(a.id, { status: 'fulfilled', fulfilledPieceId: 'piece_x' });
    expect(s.create({ topic: '배롱나무 가을 식재법', sourceKind: 'cardnews', brand: 'b' })!.id).toBe(a.id); // 방금 갚은 약속 재등록 → 병합
  });
  it('브랜드 명시(null=범용)와 미이행 캡', () => {
    const s = new PromiseStore(tmp());
    expect(s.create({ topic: 'T', sourceKind: 'shorts', brand: null })!.brand).toBeUndefined();
    for (let i = 0; i < MAX_PENDING; i++) s.create({ topic: `주제 ${i}`, sourceKind: 'manual', brand: 'b' });
    expect(s.create({ topic: '초과 등록', sourceKind: 'manual', brand: 'b' })).toBeNull(); // 남발 가드
  });
  it('dropBySource — 소스 폐기 시 그 소스의 pending 만 dropped(다른 소스·비 pending 불변)', () => {
    const s = new PromiseStore(tmp());
    const a = s.create({ topic: '폐기될 카드의 예고', window: '9월', sourceKind: 'cardnews', sourceId: 'card_x', brand: 'b' })!;
    const b = s.create({ topic: '살아있는 쇼츠의 예고', window: '10월', sourceKind: 'shorts', sourceId: 'short_y', brand: 'b' })!;
    expect(s.dropBySource('card_x')).toBe(1);
    expect(s.list().find((p) => p.id === a.id)?.status).toBe('dropped');
    expect(s.list().find((p) => p.id === b.id)?.status).toBe('pending');
    expect(s.dropBySource('card_x')).toBe(0); // 멱등 — 이미 dropped 는 재계수 안 함
  });
  it('nextDue — 시기 명시+창 안만, 도래 이른 순; pending 정렬도 같은 기준(시기 미상은 뒤)', () => {
    const s = new PromiseStore(tmp());
    s.create({ topic: '시기 미상 건', sourceKind: 'manual', brand: 'b' });
    s.create({ topic: '가을 건', window: '9월', sourceKind: 'manual', brand: 'b' });
    const jul = new Date('2026-07-30T12:00:00+09:00');
    expect(s.nextDue('b', jul)).toBeUndefined();                    // 9월 창 전 + 미상 건은 자동 대상 아님
    const sep = new Date('2026-09-02T12:00:00+09:00');
    expect(s.nextDue('b', sep)?.topic).toBe('가을 건');
    expect(s.pending('b', sep).map((p) => p.topic)).toEqual(['가을 건', '시기 미상 건']); // 브리핑 표시도 픽커와 일치
  });
  it('reconcile — 이행 piece 가 사라지거나 error 면 pending 복원', () => {
    const s = new PromiseStore(tmp());
    const a = s.create({ topic: 'A', window: '7월', sourceKind: 'manual', brand: 'b' })!;
    const b = s.create({ topic: 'B', window: '7월', sourceKind: 'manual', brand: 'b' })!;
    s.update(a.id, { status: 'fulfilled', fulfilledPieceId: 'piece_dead' });
    s.update(b.id, { status: 'fulfilled', fulfilledPieceId: 'piece_ok' });
    const reverted = s.reconcile('b', (id) => (id === 'piece_dead' ? 'missing' : 'ok'));
    expect(reverted).toBe(1);
    expect(s.get(a.id)?.status).toBe('pending');
    expect(s.get(b.id)?.status).toBe('fulfilled');
  });
});
