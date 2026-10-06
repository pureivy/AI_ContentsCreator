import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeWindow, currentOccurrence, nextOccurrence, isDue, sanitizeTopic, PromiseStore, MAX_PENDING, SEASON_WINDOW_DAYS, EXPIRE_AFTER_DAYS, choosePromise, MAX_FULFILL_ATTEMPTS, promiseSourcesOfDeletedPiece, pieceWasPublished, type ContentPromise } from './promises';

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

// 만료 청소(2026-08-28) — 실측: 7/29~8/1 12건 적재 후 27일간 fulfilled 0건, 캡 만석으로 그 사이
// 모든 신규 예고가 조용히 거절됐다. 창을 놓친 약속이 이듬해까지 슬롯을 점유하던 구조가 원인.
describe('PromiseStore.expire — 만료 자동 청소', () => {
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'promises-exp-'));
  const d = (iso: string): Date => new Date(`${iso}T03:00:00Z`); // KST 정오 — 경계 애매함 회피

  /** 등록 시각을 과거로 되돌린 스토어 — 실제 백로그(7월 말 등록)를 재현한다.
   *  topicOf 로 주제를 달리 줄 수 있다 — create 가 같은 주제를 거절하므로 같은 창을 여러 건 만들 때 필요하다. */
  const storeCreatedAt = (createdIso: string, windows: string[],
    topicOf: (w: string, i: number) => string = (w) => `주제 ${w}`): PromiseStore => {
    const dir = tmp();
    const s0 = new PromiseStore(dir);
    windows.forEach((w, i) => { s0.create({ topic: topicOf(w, i), window: w, sourceKind: 'shorts', brand: 'b' }); });
    const file = path.join(dir, 'index.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<{ createdTs: string }>;
    for (const r of raw) r.createdTs = createdIso;
    fs.writeFileSync(file, JSON.stringify(raw), 'utf-8');
    return new PromiseStore(dir);
  };

  // 등록 시각을 반드시 고정한다 — create() 는 createdTs 에 **실제 현재 시각**을 넣는데, 만료 기준이
  // '등록 후 처음 오는 도래'라 등록 달이 바뀌면 첫 창이 이듬해로 밀린다. 종전엔 그냥 create() 를 쓰고
  // 창을 '8월'로 고정해 뒀는데, 그건 실제 시계가 8월 이하일 때만 통과하는 테스트였다.
  // 실측: 09-01 로 날짜가 넘어가자 두 건이 깨졌다(9월 등록 + '8월' 창 → 첫 창이 2027-08-01 로 밀림).
  it('유예 기간이 지난 pending 을 dropped 로 비운다', () => {
    const s = storeCreatedAt('2026-08-05T00:00:00.000Z', ['8월']);
    // 8/1 도래 + 90일(창 60 + 유예 30) → 10월 말 이후 만료
    expect(s.expire('b', d('2026-10-01'))).toEqual([]);       // 아직 유예 안
    const gone = s.expire('b', d('2026-11-15'));
    expect(gone.map((x) => x.topic)).toEqual(['주제 8월']);
    expect(s.list().every((x) => x.status === 'dropped')).toBe(true);
  });

  // 실사고(2026-08-28) — 첫 자율 틱이 9·10·11월 약속 8건을 "창 경과"로 통째 폐기했다. 원인은 기준 시각을
  // currentOccurrence 로 잡은 것: 8월에 9월을 물으면 **작년 9월**이 나와 도래 전 약속이 만료로 판정됐다.
  // 기준은 '등록 후 처음 오는 도래'여야 한다 — 약속은 그 창을 한 번 통과해 봐야 놓쳤다고 말할 수 있다.
  it('아직 도래하지 않은 약속은 지우지 않는다(7월 등록 · 8월 시점의 9~11월 약속)', () => {
    const s = storeCreatedAt('2026-07-29T00:00:00.000Z', ['9월', '10월', '11월']);
    expect(s.expire('b', d('2026-08-28'))).toEqual([]);
    for (const p of s.list()) expect(p.status).toBe('pending');
  });

  it('등록 후 첫 창이 열리고 유예까지 지나야 만료된다', () => {
    const s = storeCreatedAt('2026-07-29T00:00:00.000Z', ['9월', '11월']);
    // 9월 창(9/1~10/30) + 유예 30일 → 11/30 이후. 11월 약속은 아직 창 안.
    expect(s.expire('b', d('2026-11-15'))).toEqual([]);
    expect(s.expire('b', d('2026-12-15')).map((x) => x.topic)).toEqual(['주제 9월']);
    // 11월 창(11/1~12/31) + 유예 → 이듬해 1/30 이후
    expect(s.expire('b', d('2027-03-01')).map((x) => x.topic)).toEqual(['주제 11월']);
  });

  it('등록 달과 도래 달이 같으면 그 달의 창을 첫 창으로 본다', () => {
    const s = storeCreatedAt('2026-08-20T00:00:00.000Z', ['8월']);
    expect(s.expire('b', d('2026-10-01'))).toEqual([]);        // 창 안
    expect(s.expire('b', d('2026-11-15'))).toHaveLength(1);    // 창 + 유예 경과
  });

  it('시즌 창 안(이행 기회가 살아 있는 동안)에는 절대 지우지 않는다', () => {
    const s = new PromiseStore(tmp());
    const p = s.create({ topic: '9월 소재', window: '9월', sourceKind: 'shorts', brand: 'b' })!;
    for (const day of ['2026-09-01', '2026-09-15', '2026-10-20']) {
      expect(s.expire('b', d(day))).toEqual([]);
      expect(s.get(p.id)!.status).toBe('pending');
    }
    expect(isDue(s.get(p.id)!, d('2026-09-15'))).toBe(true); // 같은 창 정의를 공유한다
  });

  it('유예는 창보다 길다 — 며칠 늦었다고 약속을 버리지 않는다', () => {
    expect(EXPIRE_AFTER_DAYS).toBeGreaterThan(SEASON_WINDOW_DAYS);
  });

  it('시기 미상은 건드리지 않는다 — 사람이 처리하기로 한 목록을 뺏지 않는다', () => {
    const s = new PromiseStore(tmp());
    const p = s.create({ topic: '시기 없음', sourceKind: 'manual', brand: 'b' })!;
    expect(p.dueMonth).toBeNull();
    expect(s.expire('b', d('2030-01-01'))).toEqual([]);
    expect(s.get(p.id)!.status).toBe('pending');
  });

  it('다른 브랜드·비 pending 은 불변', () => {
    const s = new PromiseStore(tmp());
    const other = s.create({ topic: '남의 브랜드', window: '8월', sourceKind: 'shorts', brand: 'other' })!;
    const done = s.create({ topic: '이미 이행', window: '8월', sourceKind: 'shorts', brand: 'b' })!;
    s.update(done.id, { status: 'fulfilled', fulfilledPieceId: 'piece_x' });
    expect(s.expire('b', d('2026-12-01'))).toEqual([]);
    expect(s.get(other.id)!.status).toBe('pending');
    expect(s.get(done.id)!.status).toBe('fulfilled');
  });

  it('만료로 슬롯이 비면 새 예고가 다시 등록된다 — 이 기능의 존재 이유', () => {
    // 등록 시각 고정 — 위와 같은 이유(실제 시계가 8월을 넘기면 첫 창이 이듬해로 밀려 만료가 안 된다).
    const s = storeCreatedAt('2026-08-05T00:00:00.000Z', Array.from({ length: MAX_PENDING }, () => '8월'),
      (_w, i) => `묵은 주제 ${i}`); // 주제가 같으면 create 가 중복으로 거절해 만석이 안 된다
    const late = d('2026-12-01');
    expect(s.create({ topic: '새 예고', window: '12월', sourceKind: 'shorts', brand: 'b' })).toBeNull(); // 만석
    expect(s.expire('b', late)).toHaveLength(MAX_PENDING);
    expect(s.create({ topic: '새 예고', window: '12월', sourceKind: 'shorts', brand: 'b' })).not.toBeNull();
  });
});

describe('이행 대기열 — 다음 오토런 우선 이행(2026-10-02 사장님 확정)', () => {
  it('dueQueue — 시기와 무관하게 pending 전부, 등록 오래된 순', () => {
    const s = new PromiseStore(fs.mkdtempSync(path.join(os.tmpdir(), 'promises-q-')));
    s.create({ topic: '11월 건', window: '11월', sourceKind: 'shorts', brand: 'b' });
    s.create({ topic: '시기 미상 건', sourceKind: 'shorts', brand: 'b' });
    const done = s.create({ topic: '이미 갚은 건', window: '9월', sourceKind: 'shorts', brand: 'b' })!;
    s.update(done.id, { status: 'fulfilled', fulfilledPieceId: 'piece_1' });
    s.create({ topic: '다른 브랜드 건', sourceKind: 'shorts', brand: 'x' });
    expect(s.dueQueue('b').map((p) => p.topic)).toEqual(['11월 건', '시기 미상 건']);
    expect(s.fulfilledBy('piece_1')?.topic).toBe('이미 갚은 건');
    expect(s.fulfilledBy('piece_2')).toBeUndefined();
  });
  it('choosePromise — 막힌 약속은 건너뛰고 다음 약속을 고른다(맨 앞 1건에 멈추지 않는다)', () => {
    const mk = (topic: string): ContentPromise => ({ id: topic, topic, dueMonth: null, sourceKind: 'shorts', status: 'pending', createdTs: '', updatedTs: '' });
    const r = choosePromise([mk('카지노 묘목'), mk('석류나무 겨울전정'), mk('배롱나무 절단면')], {
      offBrand: (t) => (t.includes('카지노') ? '카지노' : null),
      starved: (t) => (t.includes('석류') ? '석류나무 3일 전' : null),
    });
    expect(r.pick?.topic).toBe('배롱나무 절단면');
    expect(r.dropped.map((d) => d.promise.topic)).toEqual(['카지노 묘목']);
    expect(r.held.map((h) => h.promise.topic)).toEqual(['석류나무 겨울전정']);
  });
  it('choosePromise — 전부 막히면 pick 없음', () => {
    const mk = (topic: string): ContentPromise => ({ id: topic, topic, dueMonth: null, sourceKind: 'shorts', status: 'pending', createdTs: '', updatedTs: '' });
    expect(choosePromise([mk('a')], { offBrand: () => null, starved: () => '부족' }).pick).toBeUndefined();
    expect(choosePromise([], { offBrand: () => null, starved: () => null }).pick).toBeUndefined();
  });
});

describe('이행 재시도 상한(2026-10-02 리뷰)', () => {
  it('실패로 되돌아온 약속은 대기열 뒤로, 상한에 닿으면 폐기', () => {
    const s = new PromiseStore(fs.mkdtempSync(path.join(os.tmpdir(), 'promises-att-')));
    const a = s.create({ topic: '먼저 한 약속', sourceKind: 'shorts', brand: 'b' })!;
    s.create({ topic: '나중 약속', sourceKind: 'shorts', brand: 'b' });
    s.update(a.id, { status: 'fulfilled', fulfilledPieceId: 'piece_fail' });
    s.reconcile('b', () => 'error');
    expect(s.get(a.id)?.status).toBe('pending');
    expect(s.dueQueue('b').map((p) => p.topic)).toEqual(['나중 약속', '먼저 한 약속']);
    for (let i = 1; i < MAX_FULFILL_ATTEMPTS; i++) {
      s.update(a.id, { status: 'fulfilled', fulfilledPieceId: 'piece_fail' });
      s.reconcile('b', () => 'error');
    }
    expect(s.get(a.id)?.status).toBe('dropped');
  });
});

describe('promiseSourcesOfDeletedPiece — 글 삭제 때 함께 취소할 예고 출처(2026-10-06)', () => {
  const piece = { id: 'piece_a', stage: 'ready' };
  it('미발행 글 + 미공개 파생 숏폼·카드는 모두 취소 대상 — 10-05 대추나무 사고 모양', () => {
    const shorts = [
      { id: 'short_ig', sourcePieceId: 'piece_a' },               // 미발행 인스타 숏폼(예고 예약)
      { id: 'short_yt', sourcePieceId: 'piece_a' },
      { id: 'short_other', sourcePieceId: 'piece_b' },
    ];
    const cards = [{ id: 'card_a', sourcePieceId: 'piece_a' }];
    expect(promiseSourcesOfDeletedPiece(piece, shorts, cards)).toEqual(['piece_a', 'short_ig', 'short_yt', 'card_a']);
  });
  it('이미 올라간 파생물의 예고는 남긴다 — 시청자가 이미 들었다', () => {
    const shorts = [
      { id: 's_yt', sourcePieceId: 'piece_a', youtubeId: 'abc' },
      { id: 's_ig', sourcePieceId: 'piece_a', igReelId: '1' },
      { id: 's_clip', sourcePieceId: 'piece_a', naverClipSubmittedTs: '2026-10-05T00:00:00Z' },
    ];
    const cards = [{ id: 'c_pub', sourcePieceId: 'piece_a', igMediaId: 'm' }];
    expect(promiseSourcesOfDeletedPiece(piece, shorts, cards)).toEqual(['piece_a']);
  });
  it('발행된 글 자체의 예고는 남긴다(네이버 글은 카드를 지워도 남는다)', () => {
    expect(promiseSourcesOfDeletedPiece({ id: 'piece_a', stage: 'published' }, [], [])).toEqual([]);
    expect(promiseSourcesOfDeletedPiece({ id: 'piece_a', stage: 'ready', publishedUrl: 'https://blog.naver.com/x/1' }, [], [])).toEqual([]);
  });
});

describe('settleByDeletedPiece — 사람이 지운 이행 글의 예고는 되살리지 않는다(2026-10-06)', () => {
  const store = (): PromiseStore => new PromiseStore(fs.mkdtempSync(path.join(os.tmpdir(), 'promises-del-')));
  it('미발행 이행 글 삭제 → dropped, 다음 틱 reconcile 이 되살리지 않는다 — 10-05 라일락 겨울눈 사고 모양', () => {
    const s = store();
    const a = s.create({ topic: '라일락 겨울눈 크기로 내년 꽃 양 가늠하기', window: '10월', sourceKind: 'shorts', sourceId: 'short_l', brand: 'b' })!;
    const other = s.create({ topic: '다른 약속', sourceKind: 'shorts', sourceId: 'short_o', brand: 'b' })!;
    s.update(a.id, { status: 'fulfilled', fulfilledPieceId: 'piece_del' });
    s.update(other.id, { status: 'fulfilled', fulfilledPieceId: 'piece_keep' });
    expect(s.settleByDeletedPiece('piece_del', false)).toBe(1);
    expect(s.reconcile('b', (pid) => (pid === 'piece_del' ? 'missing' : 'ok'))).toBe(0);
    expect(s.get(a.id)?.status).toBe('dropped');
    expect(s.dueQueue('b').map((p) => p.topic)).toEqual([]);
    expect(s.get(other.id)?.status).toBe('fulfilled'); // 다른 글의 약속은 그대로
  });
  it('발행된 이행 글 삭제 → 이행 완료로 남고 reconcile 도 안 건드린다', () => {
    const s = store();
    const a = s.create({ topic: '갚은 약속', sourceKind: 'shorts', brand: 'b' })!;
    s.update(a.id, { status: 'fulfilled', fulfilledPieceId: 'piece_pub' });
    expect(s.settleByDeletedPiece('piece_pub', true)).toBe(1);
    expect(s.reconcile('b', () => 'missing')).toBe(0);
    expect(s.get(a.id)?.status).toBe('fulfilled');
    expect(s.get(a.id)?.fulfilledPieceId).toBeUndefined();
  });
  it('pending 약속·다른 글은 건드리지 않는다', () => {
    const s = store();
    s.create({ topic: '아직 안 갚은 약속', sourceKind: 'shorts', brand: 'b' });
    expect(s.settleByDeletedPiece('piece_x', false)).toBe(0);
    expect(s.dueQueue('b')).toHaveLength(1);
  });
  it('pieceWasPublished — 비공개 발행·발행 단계도 발행으로 본다', () => {
    expect(pieceWasPublished({ stage: 'draft' })).toBe(false);
    expect(pieceWasPublished({ stage: 'ready', privateUrl: 'https://blog.naver.com/x/1' })).toBe(true);
    expect(pieceWasPublished({ stage: 'reflected' })).toBe(true);
  });
});
