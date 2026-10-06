/**
 * 예고 대장(약속 큐) — 콘텐츠가 "다음 편 예고"를 하면 그 약속을 기록하고, 자율 틱이 시기 도래 시
 * 신규 아이디어보다 먼저 그 주제를 생산해 갚는다(사용자 지적 2026-07-30: 예고만 하고 안 지키면
 * 시청자 신뢰 역효과). cardnews.ts 와 동일한 파일 영속 패턴(원자적 교체, data/promises/index.json).
 *
 * 캡처: 쇼츠·카드뉴스 기획 JSON 의 next 필드(작가가 예고를 썼을 때만) + 수동 등록 API.
 * 이행(리뷰 반영 2026-07-30): 시기가 명시된(dueMonth) 약속만 자동 이행 대상이고, 도래 후
 * 60일의 '시즌 창' 안에서만 발화한다 — 계절 콘텐츠가 철 지나 나가면 역가치(9월 파종 글이 12월에).
 * 창을 놓친 약속은 이듬해 같은 창에 다시 도래. 시기 없는 약속은 브리핑에만 노출(수동 처리).
 * → 2026-10-02 사장님 확정으로 이행 기준이 바뀌었다: 시기와 무관하게 다음 자율 틱에서 등록순으로 갚는다
 *   (dueQueue·choosePromise). 시기 창(isDue·nextDue)은 만료 계산과 기존 표시용으로만 남는다.
 * fulfilled 마킹은 런이 실제로 시작된 뒤(호출측 launch)에만 — 실패 piece 는 reconcile 이 pending 복원.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { activeBrandSlug, offBrandTerm } from './brand';
import { genId } from '../util/ids';

export type PromiseStatus = 'pending' | 'fulfilled' | 'dropped';

export interface ContentPromise {
  id: string;
  /** 브랜드 슬러그 — 생성 시점 확정(범용이면 undefined). */
  brand?: string;
  /** 예고한 주제 — 이행 시 piece 제목이 된다(콜론은 생성 시 제거 — 그라운딩 seedKeyword 절단 방지). */
  topic: string;
  /** 시기 원문 표기("9월"·"가을" 등) — 표시용. */
  window?: string;
  /** 도래 판정용 월(1~12). null=시기 미상 — 자동 이행 대상 아님(브리핑 노출·수동 처리). */
  dueMonth: number | null;
  /** 약속의 출처 — 어느 콘텐츠가 한 예고인지. */
  sourceKind: 'shorts' | 'cardnews' | 'blog' | 'manual';
  sourceId?: string;
  sourceTopic?: string;
  status: PromiseStatus;
  fulfilledPieceId?: string;
  /** 이행 실패로 pending 에 되돌려진 횟수(2026-10-02) — 대기열 뒤로 밀고, MAX_FULFILL_ATTEMPTS 에 닿으면 폐기. */
  attempts?: number;
  createdTs: string;
  updatedTs: string;
}

/** 미이행 백로그 캡 — 예고 남발이 신규 아이디어 슬롯을 무한 선점하지 않게(초과 등록은 거절). */
export const MAX_PENDING = 12;
/**
 * 이행 재시도 상한(2026-10-02) — 이행 글이 실패하면 reconcile 이 pending 으로 되살리는데, 등록순 대기열에서는 그 약속이
 * 다시 맨 앞이라 매 틱 같은 실패를 반복하며 뒤 약속을 막는다(리뷰 지적: 사실 부족 재시도는 강제 틱이라 시간당 여러 번).
 * 두 번 실패하면 버린다.
 */
export const MAX_FULFILL_ATTEMPTS = 2;
/** 시즌 창 — 도래 월 1일부터 이 기간 안에서만 자동 이행(지나면 이듬해로 재도래). */
export const SEASON_WINDOW_DAYS = 60;
/**
 * 만료 청소 기준(2026-08-28 사용자 확정) — 시즌 창을 놓친 채 이 기간을 넘긴 약속은 자동 dropped.
 *
 * 배경(실측): 7/29~8/1 에 12건이 쌓인 뒤 27일간 fulfilled 가 0건이었다. 캡(MAX_PENDING)이 만석이라
 * 그 뒤 모든 신규 예고가 조용히 거절됐다 — 시청자에게 "다음 편에 다루겠다"고 약속한 영상을 발행하면서
 * 시스템은 그 약속을 등록조차 못 하는 상태가 한 달 가까이 이어졌다.
 *
 * 캡을 올리는 것으로는 안 풀린다(시간만 벌 뿐). 백로그가 스스로 숨을 쉬어야 한다 — 창을 놓친 약속은
 * 이듬해까지 pending 으로 남아 슬롯을 점유하는데, 1년 뒤 그 주제를 그때 맥락으로 다시 잡는 편이 낫다.
 *
 * 값: 시즌 창(60일)보다 넉넉히 길게 둔다. 창 안에서는 이행 기회가 매 틱 살아 있어야 하고, 창을 놓친
 * 뒤에도 한 달쯤은 사람이 손으로 이행할 여지를 남긴다(60+30). 창이 지나자마자 지우면 "며칠 늦었다고
 * 약속을 버리는" 꼴이 된다.
 */
export const EXPIRE_AFTER_DAYS = SEASON_WINDOW_DAYS + 30;
const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** 시기 표기 → 도래 월(1~12). "N월" 우선, 계절어는 시작 월로. 해석 불가·미지정=null(자동 이행 제외). 순수. */
export function normalizeWindow(window?: string): number | null {
  const w = (window ?? '').trim();
  if (!w) return null;
  const m = w.match(/(\d{1,2})\s*월/);
  if (m) { const n = Number(m[1]); return n >= 1 && n <= 12 ? n : null; }
  if (w.includes('봄')) return 3;
  if (w.includes('여름')) return 6;
  if (w.includes('가을')) return 9;
  if (w.includes('겨울')) return 12;
  return null;
}

/** KST 기준 dueMonth 1일 00:00 의 UTC Date — 로케일 무관 산술(Intl 폴백에 흔들리지 않음, fail-open은 호출측). 순수. */
function kstMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - KST_MS);
}

/** now 가 속하거나 직전에 지난 도래 창의 시작 시각(올해 또는 작년 발생분). 순수. */
export function currentOccurrence(dueMonth: number, now: Date): Date | null {
  if (!Number.isInteger(dueMonth) || dueMonth < 1 || dueMonth > 12 || !Number.isFinite(now.getTime())) return null;
  const k = new Date(now.getTime() + KST_MS);
  const y = k.getUTCMonth() + 1 >= dueMonth ? k.getUTCFullYear() : k.getUTCFullYear() - 1;
  return kstMonthStart(y, dueMonth);
}

/** 자동 이행 도래 판정 — dueMonth 가 있고, 지금이 그 시즌 창([도래 1일, +60일)) 안일 때만. 순수. */
export function isDue(p: Pick<ContentPromise, 'dueMonth'>, now: Date = new Date()): boolean {
  if (p.dueMonth === null) return false; // 시기 미상 — 자동 이행 제외(수동 처리)
  const occ = currentOccurrence(p.dueMonth, now);
  if (!occ) return false;
  return now.getTime() >= occ.getTime() && now.getTime() < occ.getTime() + SEASON_WINDOW_DAYS * DAY_MS;
}

/**
 * 기준 시각(보통 등록 시점) 이후 처음 오는 도래 창의 시작. 만료 계산 전용 — '이 약속이 통과해야 할
 * 첫 창'을 가리킨다. 등록 당월이면 그 달 1일(이미 창 안에서 등록된 경우)을 그대로 쓴다. 순수.
 */
function firstOccurrenceOnOrAfter(dueMonth: number, fromMs: number): number | null {
  if (!Number.isInteger(dueMonth) || dueMonth < 1 || dueMonth > 12 || !Number.isFinite(fromMs)) return null;
  const k = new Date(fromMs + KST_MS);
  const y = k.getUTCFullYear();
  const sameYear = kstMonthStart(y, dueMonth).getTime();
  // 등록 달과 도래 달이 같으면 그 달 1일이 fromMs 보다 앞설 수 있다 — 그때도 '그 창'이 이 약속의 첫 창이다.
  if (k.getUTCMonth() + 1 <= dueMonth) return sameYear;
  return kstMonthStart(y + 1, dueMonth).getTime();
}

/** 표시·정렬용 다음 도래 시각 — 창 안이면 현재 발생분, 지났으면 이듬해 발생분. 시기 미상은 null. 순수. */
export function nextOccurrence(p: Pick<ContentPromise, 'dueMonth'>, now: Date = new Date()): Date | null {
  if (p.dueMonth === null) return null;
  const occ = currentOccurrence(p.dueMonth, now);
  if (!occ) return null;
  if (now.getTime() < occ.getTime() + SEASON_WINDOW_DAYS * DAY_MS) return occ;
  return kstMonthStart(new Date(occ.getTime() + KST_MS).getUTCFullYear() + 1, p.dueMonth);
}

/** 주제 정규화(저장용) — 이모지·제어문자 제거, 콜론 제거(그라운딩 절단 방지), 공백 접기, 80자 캡. 순수. */
export function sanitizeTopic(raw: string): string {
  return raw
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[:\uFF1A]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

const normTopic = (t: string): string => t.replace(/\s+/g, '').toLowerCase();
const FULFILLED_DEDUP_DAYS = 30;

/**
 * 글 삭제 때 함께 취소할 예고의 출처 id(순수, 2026-10-06 사장님 요청 "글 지우면 예고도 취소되게").
 *
 * 실사고(10-05~06): 대추나무 글을 지우고 새로 썼는데, 지운 글에서 파생된 인스타 숏폼(미발행)이 낭독 전에 예약해 둔
 * "다음 편: 대추나무 가을 심기 순서"가 대장에 남아, 다음 날 아침 오토런이 그 예고를 갚느라 대추나무 글을 또 썼다.
 * 숏폼·카드를 직접 지울 때는 dropBySource 가 돌지만, 글을 지울 때는 그 글의 파생물이 남아 예고도 살아 있었다.
 *
 * 취소 대상: 그 글 자체(미발행일 때)와, 그 글에서 파생된 숏폼·카드 중 **아직 어디에도 올라가지 않은 것**.
 * 이미 공개된 파생물의 예고는 남긴다 — 시청자가 이미 "다음 편"을 들었고, 글 카드를 지워도 그 영상은 남아 있다.
 */
/** 네이버에 올라간 흔적이 있는 글인가(비공개 발행 포함) — 카드를 지워도 그 글은 남는다. */
export function pieceWasPublished(piece: { stage?: string; publishedUrl?: string; privateUrl?: string; publishedTs?: string }): boolean {
  return !!(piece.publishedUrl || piece.privateUrl || piece.publishedTs)
    || ['published', 'measured', 'reflected'].includes(piece.stage ?? '');
}

export function promiseSourcesOfDeletedPiece(
  piece: { id: string; stage?: string; publishedUrl?: string; privateUrl?: string; publishedTs?: string },
  shorts: ReadonlyArray<{ id: string; sourcePieceId?: string; youtubeId?: string; igReelId?: string; naverClipNo?: string; naverClipSubmittedTs?: string; fbReelId?: string }>,
  cards: ReadonlyArray<{ id: string; sourcePieceId?: string; igMediaId?: string; igPermalink?: string }>,
): string[] {
  const out: string[] = [];
  if (!pieceWasPublished(piece)) out.push(piece.id);
  for (const s of shorts) {
    if (s.sourcePieceId !== piece.id) continue;
    if (s.youtubeId || s.igReelId || s.naverClipNo || s.naverClipSubmittedTs || s.fbReelId) continue;
    out.push(s.id);
  }
  for (const c of cards) {
    if (c.sourcePieceId !== piece.id) continue;
    if (c.igMediaId || c.igPermalink) continue;
    out.push(c.id);
  }
  return out;
}

export class PromiseStore {
  private file: string;
  private items = new Map<string, ContentPromise>();
  constructor(dir: string = path.join(CONFIG.dataDir, 'promises')) {
    this.file = path.join(dir, 'index.json');
    this.load();
  }
  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as ContentPromise[];
      if (Array.isArray(raw)) for (const p of raw) if (p && p.id) this.items.set(p.id, p);
    } catch { /* 없으면 빈 스토어 */ }
  }
  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...this.items.values()], null, 2), 'utf-8');
      fs.renameSync(tmp, this.file); // 원자적 교체
    } catch { /* 영속 실패 무해(다음 변경에서 재시도) */ }
  }
  list(): ContentPromise[] { return [...this.items.values()]; }
  get(id: string): ContentPromise | undefined { return this.items.get(id); }
  /**
   * 등록 — 중복·남발 가드 3중: ①같은 sourceId 의 기존 약속(재실행 잡의 재등록 방지) ②같은 브랜드
   * 동일 주제의 pending 또는 최근 30일 내 fulfilled(방금 갚은 약속의 재약속 루프 방지) ③미이행 캡.
   * brand 는 명시값만 신뢰(null=범용) — 잡의 브랜드가 라이브 activeBrand 로 오귀속되지 않게.
   * 반환: 등록/병합된 약속, 캡 초과·빈 주제는 null.
   */
  create(input: {
    topic: string; window?: string;
    sourceKind: ContentPromise['sourceKind']; sourceId?: string; sourceTopic?: string;
    /** undefined=수동(활성 브랜드로 귀속) · null=범용 명시 · 문자열=해당 브랜드. */
    brand?: string | null;
  }): ContentPromise | null {
    const topic = sanitizeTopic(input.topic);
    if (!topic) return null;
    // 브랜드 소재 게이트(2026-07-31 정체성 각인) — 오프브랜드 예고는 등록 자체를 거부(활성 브랜드 프로필 기준).
    // 예고 이행 경로가 신규성·범위 검사를 다 우회하므로 입구에서 막는 게 가장 싸다. 수동 등록도 동일 적용.
    const off = offBrandTerm(topic);
    if (off) { console.log(`[promises] 예고 등록 거부(브랜드 범위 밖) — "${topic.slice(0, 40)}" (소재 "${off}")`); return null; }
    const brand = input.brand === undefined ? (activeBrandSlug() || undefined) : (input.brand || undefined);
    if (input.sourceId) {
      const bySource = this.list().find((p) => p.sourceId === input.sourceId);
      if (bySource) return bySource;
    }
    const cutoff = Date.now() - FULFILLED_DEDUP_DAYS * DAY_MS;
    const dup = this.list().find((p) =>
      (p.brand ?? '') === (brand ?? '') && normTopic(p.topic) === normTopic(topic)
      && (p.status === 'pending' || (p.status === 'fulfilled' && new Date(p.updatedTs).getTime() > cutoff)));
    if (dup) return dup;
    if (this.pending(brand ?? '').length >= MAX_PENDING) return null; // 남발 가드 — 호출측이 로그
    const now = new Date().toISOString();
    const p: ContentPromise = {
      id: genId('promise'), brand, topic,
      window: input.window?.trim().slice(0, 40) || undefined,
      dueMonth: normalizeWindow(input.window),
      sourceKind: input.sourceKind, sourceId: input.sourceId, sourceTopic: input.sourceTopic?.slice(0, 120),
      status: 'pending', createdTs: now, updatedTs: now,
    };
    this.items.set(p.id, p);
    this.persist();
    return p;
  }
  update(id: string, patch: Partial<Omit<ContentPromise, 'id' | 'createdTs'>>): ContentPromise | undefined {
    const cur = this.items.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedTs: new Date().toISOString() };
    this.items.set(id, next);
    this.persist();
    return next;
  }
  /** 소스 콘텐츠 폐기 시 예고 정리 — 그 소스가 만든 pending 약속을 dropped 로(발행 전 폐기 = 시청자 약속 없음).
   *  실측 2026-07-30: 카드 폐기 후 예고가 대장에 남아 9월에 근거 없는 이행 제작이 돌 뻔함. 반환 = 정리 건수. */
  dropBySource(sourceId: string): number {
    let n = 0;
    for (const p of this.list()) {
      if (p.sourceId === sourceId && p.status === 'pending') { this.update(p.id, { status: 'dropped' }); n++; }
    }
    return n;
  }
  /**
   * 이행 글을 사람이 지웠을 때(2026-10-06 사장님 확정) — 그 글이 갚던 약속을 되살리지 않는다.
   * 종전엔 reconcile 이 '이행 글 유실'로 보고 pending 으로 되돌려, 지운 주제가 다음 오토런에 같은 제목으로 다시 만들어졌다
   * (실례: 10-05 라일락 겨울눈 글 삭제 → 10-06 17시 같은 주제 재생산). 사람이 지운 건 실패가 아니라 '이 주제는 됐다'는 뜻이다.
   *  · 미발행 글 → dropped(이 약속은 더 갚지 않는다).
   *  · 발행된 글 → fulfilled 그대로 두고 fulfilledPieceId 만 뗀다(네이버 글이 남아 약속은 이미 갚았다. reconcile 이 안 본다).
   * reconcile 의 'missing' 복원은 사람이 지우지 않은 유실(색인 손상 등)용으로 남는다. 반환 = 정리 건수.
   */
  settleByDeletedPiece(pieceId: string, published: boolean): number {
    let n = 0;
    for (const p of this.list()) {
      if (p.status !== 'fulfilled' || p.fulfilledPieceId !== pieceId) continue;
      this.update(p.id, published ? { fulfilledPieceId: undefined } : { status: 'dropped', fulfilledPieceId: undefined });
      n++;
    }
    return n;
  }
  /** 자동 이행 대상 — 시기 명시 + 시즌 창 안(브랜드 일치). 도래일 이른 순 → 등록 오래된 순. */
  nextDue(brand: string, now: Date = new Date()): ContentPromise | undefined {
    return this.list()
      .filter((p) => p.status === 'pending' && (p.brand ?? '') === brand && isDue(p, now))
      .sort((a, b) =>
        (currentOccurrence(a.dueMonth!, now)?.getTime() ?? 0) - (currentOccurrence(b.dueMonth!, now)?.getTime() ?? 0)
        || a.createdTs.localeCompare(b.createdTs))[0];
  }
  /**
   * 이행 대기열(2026-10-02 사장님 확정 — "예고가 있으면 다음 오토런에서 그 주제로 블로그·숏폼을 우선 제작").
   *
   * 자율 틱은 이제 nextDue 가 아니라 이걸 본다. 종전 nextDue 는 시즌 창 안의 '맨 앞 1건'만 돌려줘서 그 1건이
   * 보류되면 뒤 약속은 한 번도 검토되지 않았다 — 실측: 07-29 배롱나무 약속이 소재 포화 오탐으로 40틱 연속
   * 보류되는 동안 31건 중 이행 0. 시기(window)도 더 이상 기다리지 않는다 — 시청자가 들은 말은 "다음엔"이다.
   * 시기 미상 약속도 대상이다. 등록 오래된 순(먼저 한 약속부터 갚는다).
   */
  dueQueue(brand: string): ContentPromise[] {
    return this.list()
      .filter((p) => p.status === 'pending' && (p.brand ?? '') === brand)
      .sort((a, b) => (a.attempts ?? 0) - (b.attempts ?? 0) || a.createdTs.localeCompare(b.createdTs)); // 실패해 되돌아온 약속은 뒤로
  }
  /** 이 piece 가 갚고 있는 약속(이행 표시 뒤) — 숏폼 자율 하루 상한 면제 판정용. */
  fulfilledBy(pieceId: string): ContentPromise | undefined {
    return this.list().find((p) => p.status === 'fulfilled' && p.fulfilledPieceId === pieceId);
  }
  /** 미이행 목록(브랜드) — 브리핑·UI 용. 시기 있는 건 다음 도래 이른 순, 시기 미상은 맨 뒤(등록순). nextDue 와 같은 기준. */
  pending(brand: string, now: Date = new Date()): ContentPromise[] {
    return this.list()
      .filter((p) => p.status === 'pending' && (p.brand ?? '') === brand)
      .sort((a, b) =>
        (nextOccurrence(a, now)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (nextOccurrence(b, now)?.getTime() ?? Number.MAX_SAFE_INTEGER)
        || a.createdTs.localeCompare(b.createdTs));
  }
  /**
   * 정합 복원 — fulfilled 인데 이행 piece 가 사라졌거나 종료 실패(stage:'error')면 pending 으로 복원.
   * 자율 틱이 매번 호출(저비용) — "갚은 척 기록만 남고 산출물은 없는" 신뢰 역전을 막는다.
   * 되돌릴 때마다 attempts 를 올리고 MAX_FULFILL_ATTEMPTS 에 닿으면 pending 대신 dropped(2026-10-02).
   */
  reconcile(brand: string, pieceState: (pieceId: string) => 'ok' | 'error' | 'missing'): number {
    let reverted = 0;
    for (const p of this.list()) {
      if (p.status !== 'fulfilled' || (p.brand ?? '') !== brand || !p.fulfilledPieceId) continue;
      const st = pieceState(p.fulfilledPieceId);
      if (st === 'error' || st === 'missing') {
        const attempts = (p.attempts ?? 0) + 1;
        this.update(p.id, attempts >= MAX_FULFILL_ATTEMPTS
          ? { status: 'dropped', fulfilledPieceId: undefined, attempts }
          : { status: 'pending', fulfilledPieceId: undefined, attempts });
        reverted++;
      }
    }
    return reverted;
  }
  /**
   * 만료 청소(2026-08-28) — 시즌 창을 놓친 지 EXPIRE_AFTER_DAYS 넘은 pending 을 dropped 로.
   * 자율 틱이 reconcile 과 함께 매번 호출(저비용, 순수 산술). 실측 대응: 백로그 만석으로 27일간
   * 신규 예고가 전부 소실됐다 — 창을 놓친 약속이 이듬해까지 슬롯을 점유하는 구조가 원인이었다.
   *
   * 기준 시각은 **도래 창의 끝**이지 등록일이 아니다. 등록일 기준이면 먼 미래를 예고한 약속(8월에 등록한
   * 12월 건)이 도래도 하기 전에 지워진다. 시기 미상(dueMonth=null)은 건드리지 않는다 — 자동 이행
   * 대상이 아니라 애초에 사람이 처리하기로 한 것들이라, 자동으로 지우면 사람의 목록을 뺏는 셈이다.
   */
  expire(brand: string, now: Date = new Date()): ContentPromise[] {
    const gone: ContentPromise[] = [];
    for (const p of this.list()) {
      if (p.status !== 'pending' || (p.brand ?? '') !== brand || p.dueMonth === null) continue;
      // 기준은 **등록 후 처음 오는 도래**다(2026-08-28 실사고 수선). 약속은 그 창을 한 번 통과해 봐야
      // '놓쳤다'고 말할 수 있다 — 7월에 등록한 9월 약속은 8월 시점에 아직 아무것도 놓치지 않았다.
      //
      // 처음엔 currentOccurrence 로 짰다가 사고가 났다: 그건 '오늘이 속하거나 직전에 지난 발생분'이라
      // 8월에 9월 약속을 물으면 **작년 9월**을 돌려준다. 그 기준으로 재니 도래도 안 한 약속이 "창 경과"로
      // 판정됐고, 첫 자율 틱에서 9·10·11월 약속 8건이 통째로 폐기됐다(실측). nextOccurrence 로 바꿔도
      // 같았다 — 미래 도래에서 1년을 빼면 결국 등록 전의 창을 가리키기 때문이다.
      const created = new Date(p.createdTs).getTime();
      if (!Number.isFinite(created)) continue; // 손상 레코드는 건드리지 않는다(fail-open)
      const firstDue = firstOccurrenceOnOrAfter(p.dueMonth, created);
      if (!firstDue) continue;
      // 그 창이 열린 뒤 유예(창 60일 + 30일)까지 지났으면 만료. 창이 아직 안 왔거나 진행 중이면 미래라 통과.
      const deadline = firstDue + EXPIRE_AFTER_DAYS * DAY_MS;
      if (now.getTime() >= deadline) {
        const u = this.update(p.id, { status: 'dropped' });
        if (u) gone.push(u);
      }
    }
    return gone;
  }
}

/**
 * 대기열에서 이번 틱에 갚을 약속 하나를 고른다(순수, 2026-10-02).
 *
 * 걸리는 약속은 건너뛰고 다음 약속을 본다 — 맨 앞 하나가 막혀 전부 멈추던 구조(nextDue)의 수선이다.
 * 약속에 거는 검사는 둘뿐이다: 브랜드 범위 밖이면 폐기, 사실 부족 수종이면 보류(pending 유지).
 * 주제 다양성용 게이트(소재 포화·최근 수종·최근 축·검색 수요)는 일부러 안 건다 — 그건 시스템이 스스로 고르는
 * 주제에 거는 규칙이고, 예고는 시청자에게 이미 한 약속이라 '같은 수종 연속'이 오히려 정상이다.
 */
export function choosePromise(
  queue: readonly ContentPromise[],
  checks: { offBrand: (topic: string) => string | null; starved: (topic: string) => string | null },
): { pick?: ContentPromise; dropped: Array<{ promise: ContentPromise; term: string }>; held: Array<{ promise: ContentPromise; reason: string }> } {
  const dropped: Array<{ promise: ContentPromise; term: string }> = [];
  const held: Array<{ promise: ContentPromise; reason: string }> = [];
  for (const p of queue) {
    const off = checks.offBrand(p.topic);
    if (off) { dropped.push({ promise: p, term: off }); continue; }
    const starved = checks.starved(p.topic);
    if (starved) { held.push({ promise: p, reason: starved }); continue; }
    return { pick: p, dropped, held };
  }
  return { dropped, held };
}

let store: PromiseStore | null = null;
export function promiseStore(): PromiseStore {
  store ??= new PromiseStore();
  return store;
}
