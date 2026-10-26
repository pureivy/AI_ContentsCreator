/**
 * 사진·영상 보관소(2026-09-04) — 한 번 올려 두고 여러 콘텐츠가 꺼내 쓴다.
 *
 * 컴포저 첨부는 '이 런에만' 쓰인다. 그래서 같은 수국 사진을 수국 편마다 다시 올려야 했다.
 * 보관소는 그 반복을 없앤다: 올릴 때 어떤 수종인지 붙여 두면, 그 수종 콘텐츠가 만들어질 때
 * 자동으로 꺼내 쓴다.
 *
 * 문서 자료실(/sources)과 분리한 이유는 쓰임이 다르기 때문이다. 문서는 텍스트를 뽑아 위키에
 * 넣는 지식이고, 사진·영상은 화면에 그대로 나가는 소재다. 같은 곳에 두면 둘 다 어중간해진다.
 *
 * 파일 영속 패턴은 promises.ts 와 같다(원자적 교체, data/media/index.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { genId } from '../util/ids';
import { isStoreFileCorrupt, readJsonArray, writeJsonAtomic } from '../util/jsonStore';

export type MediaKind = 'image' | 'video';

export interface MediaItem {
  id: string;
  /** 저장 파일의 절대경로. */
  file: string;
  kind: MediaKind;
  /** 원 파일명 — 목록 표시용. */
  name: string;
  bytes: number;
  /** 영상 길이(초). 이미지는 undefined. 씬 배정이 이 값을 본다. */
  seconds?: number;
  /** 수종 이름(species.yaml 의 키) — 이 소재가 무슨 식물인지. 없으면 범용 소재. */
  species?: string;
  /** 자유 태그 — 계절·부위·상황("가을", "열매", "전정"). 매칭 보조. */
  tags?: string[];
  /** 브랜드 슬러그 — 브랜드가 여럿일 때 섞이지 않게. */
  brand?: string;
  /** 사람이 적은 메모. */
  note?: string;
  createdTs: string;
}

const MEDIA_DIR = (): string => path.join(CONFIG.dataDir, 'media');
const INDEX = (): string => path.join(MEDIA_DIR(), 'index.json');

// 깨진 색인(2026-10-26) — 종전엔 파싱 실패를 [] 로 삼켜 addMedia 가 [새 항목] 하나만 써서 보관소 목록 전체를 덮었다.
// 이제 깨지면 .corrupt-<시각> 으로 옮기고 이번 실행 동안 쓰기를 막는다(writeAll 이 던져 추가·수정·삭제가 실패로 드러난다).
function readAll(): MediaItem[] {
  return readJsonArray<MediaItem>(INDEX(), '보관소(media)').value ?? [];
}
function writeAll(rows: MediaItem[]): void {
  writeJsonAtomic(INDEX(), rows, { backup: true }); // 원자적 교체(tmp+fsync+rename) — 쓰기 도중 죽어도 목록이 깨지지 않는다
}
/** 보관소 색인이 깨져 저장을 막고 있나. */
export const mediaIndexCorrupt = (): boolean => isStoreFileCorrupt(INDEX());

export const mediaDir = MEDIA_DIR;

export function listMedia(brand?: string): MediaItem[] {
  const rows = readAll();
  // 파일이 사라진 항목은 목록에서 뺀다(수동 삭제·이동 대응) — 없는 파일을 씬에 배정하면 렌더가 빈다.
  const alive = rows.filter((r) => { try { return fs.existsSync(r.file); } catch { return false; } });
  return (brand ? alive.filter((r) => !r.brand || r.brand === brand) : alive)
    .sort((a, b) => b.createdTs.localeCompare(a.createdTs));
}

export function addMedia(input: Omit<MediaItem, 'id' | 'createdTs'>): MediaItem {
  const item: MediaItem = { ...input, id: genId('media'), createdTs: new Date().toISOString() };
  writeAll([item, ...readAll()]);
  return item;
}

export function updateMedia(id: string, patch: Partial<Pick<MediaItem, 'species' | 'tags' | 'note'>>): MediaItem | undefined {
  const rows = readAll();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return undefined;
  rows[i] = { ...rows[i]!, ...patch };
  writeAll(rows);
  return rows[i];
}

/** 목록에서 지우고 파일도 지운다. 파일 삭제 실패는 무시 — 목록에서 빠지면 더는 안 쓰인다. */
export function removeMedia(id: string): boolean {
  const rows = readAll();
  const hit = rows.find((r) => r.id === id);
  if (!hit) return false;
  writeAll(rows.filter((r) => r.id !== id));
  try { fs.rmSync(hit.file, { force: true }); } catch { /* 무해 */ }
  return true;
}

/**
 * 주제·키워드에 맞는 소재를 고른다(순수 판정 — 목록을 인자로 받는다).
 *
 * 우선순위가 중요하다. 수종이 일치하는 소재가 먼저다 — 수국 편에 회양목 사진이 들어가면
 * 안 쓰느니만 못하다. 그다음이 태그 일치, 마지막이 범용(수종 없는) 소재다.
 * 수종이 '다른' 소재는 아예 안 쓴다.
 */
function scoreMedia(
  items: readonly MediaItem[],
  opts: {
    species?: string; text?: string; kind?: MediaKind; limit?: number;
    /**
     * 수종 이름을 표준명으로 바꾸는 함수(2026-09-04). 호출부가 수종 사전을 물려 준다.
     *
     * 왜 필요한가. 사장님이 '음나무'로 딱지를 붙여 올린 영상이 '엄나무' 편에서 배제됐다.
     * 같은 나무(Kalopanax septemlobus)인데 부르는 이름이 둘이고, 코드는 글자만 비교했다.
     * 별칭은 이미 수종 사전이 알고 있다 — 그 판정을 여기로 끌어온다. 사전을 모르는 이름은
     * 그대로 둔다(fail-open): 사전에 없다는 이유로 소재를 버리지 않는다.
     */
    canon?: (name: string) => string;
    /** 지금 연월(연*12+월-1, 기본 KST 현재) — 촬영 월 고르기(pickShootMonth). 테스트가 고정값을 넘긴다. */
    nowYm?: number;
  },
): Array<{ m: MediaItem; s: number; g: number }> {
  const text = String(opts.text ?? '');
  const canon = (n: string): string => {
    const t = String(n ?? '').trim();
    if (!t) return '';
    try { return String(opts.canon?.(t) ?? t).trim() || t; } catch { return t; }
  };
  const want = canon(opts.species ?? '');
  const scored: Array<{ m: MediaItem; s: number; g: number }> = [];
  for (const m of items) {
    if (opts.kind && m.kind !== opts.kind) continue;
    const label = String(m.species ?? '').trim();
    const named = canon(label);
    // 수종 판정 — 사전이 그 종을 알면 이름으로 맞추고, 모르면 주제 문장에 그 이름이 있는지로 본다.
    //
    // 뒤쪽이 없으면 실측 사고가 난다(2026-09-04): 사장님이 사계장미 영상을 올린 뒤 사계장미 편이
    // 돌았는데, 그 시점 수종 사전에 사계장미가 없어 want 가 비었다. 그래서 '사계장미' 딱지가 붙은
    // 영상이 사계장미 편에서 배제됐다 — 사전에 없다는 이유로. 소재에 사람이 직접 적어 둔 이름이
    // 주제에 그대로 들어 있으면 그게 곧 근거다. 사전은 그 다음이다.
    // 사전이 그 종을 알면 표준명끼리 맞추고, 모르면 주제 문장에 그 이름(사용자가 적은 표기든
    // 표준명이든)이 있는지로 본다.
    // 사전이 모르는 딱지('매실나무'가 사전에 없던 실측 2026-09-08)도 끝의 '나무'를 뗀 어간(2자 이상)으로 맞춘다 —
    // 제목은 '매실 수확 시기'처럼 '나무'를 떼고 쓰는 일이 흔하다. 1자 어간('배'·'밤')은 오탐이 커서 안 쓴다.
    const stem = (n: string): string => (n.endsWith('나무') && n.length >= 4 ? n.slice(0, -2) : '');
    const inText = (n: string): boolean => !!n && (text.includes(n) || (!!stem(n) && text.includes(stem(n))));
    // 주 수종(want)이 잡혀도 제목에 적힌 다른 수종의 소재는 쓴다(2026-09-18 실사고): "복숭아나무와 자두나무, 손 가는
    // 일이 다릅니다" 편에서 want=복숭아나무 하나만 보고 자두나무 영상 2개를 버렸다 — 복숭아 영상은 없었으니 실촬영 0.
    // 두 수종을 비교하는 글에서 둘째 수종 화면은 무관한 소재가 아니다. 주 수종이 있으면 그쪽이 먼저(+50).
    const primary = !!want && named === want;
    const hit = named ? (primary || inText(label) || inText(named)) : false;
    if (label && !hit) continue; // 다른 수종·무관한 수종은 배제
    // 등급(g)과 가점(태그)을 나눠 센다(2026-09-28). 등급은 '수종이 맞느냐'이고 태그는 '더 어울리느냐'다.
    // 로테이션이 등급으로 후보를 자르므로 섞으면 안 된다 — 태그 하나(+10) 때문에 같은 수종의 다른 영상이
    // 후보에서 통째로 빠져 로테이션이 한 파일에 묶였다(실측: 자두나무 160 vs 150).
    const g = hit ? (primary ? 150 : 100) : 1; // 딱지 없는 범용 소재 — 없는 것보다 낫다(딱지가 있고 안 맞으면 위에서 이미 걸렀다)
    let s = g;
    for (const t of m.tags ?? []) if (t && !isShootDateTag(t) && text.includes(t)) s += 10; // 촬영 날짜 태그는 가점 대상 아님(pickShootMonth 가 맡는다)
    if (s > 0) scored.push({ m, s, g });
  }
  scored.sort((a, b) => b.s - a.s || b.m.createdTs.localeCompare(a.m.createdTs));
  return pickShootMonth(scored, opts.nowYm ?? kstYm()).slice(0, opts.limit ?? 8);
}

/** 지금 연·월(KST) — 연*12+월 꼴의 정수(달 비교·지난달 계산이 한 줄로 끝난다). */
function kstYm(now: number = Date.now()): number {
  const d = new Date(now + 9 * 3600_000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** 촬영 날짜 태그인가(순수) — "2026년 9월" 또는 "9월". 주제·검색어에 섞지 않는다(보관소 '글 시작'이 "단풍나무 9월 10월"을 주제로 넘겼다). */
export function isShootDateTag(t: string): boolean {
  return /^(?:\d{4}년\s*)?(?:1[0-2]|[1-9])월$/.test(String(t ?? '').trim());
}

/**
 * 소재의 촬영 연·월(연*12+월-1) — 태그 "2026년 9월"(2026-10-12 사장님: 보관소에 연도를 붙인다) 또는 연도 없는 "9월".
 * 연도 없는 태그는 올린 날의 연도로 본다(올린 달보다 큰 달이면 작년 — 1월에 올린 "12월" 영상). 촬영 월이 없거나 여럿이면 null.
 */
export function shootYmOf(m: Pick<MediaItem, 'tags'> & { createdTs?: string }): number | null {
  const found: number[] = [];
  for (const raw of m.tags ?? []) {
    const t = String(raw).trim();
    const full = /^(\d{4})년\s*(1[0-2]|[1-9])월$/.exec(t);
    if (full) { found.push(Number(full[1]) * 12 + Number(full[2]) - 1); continue; }
    const mo = /^(1[0-2]|[1-9])월$/.exec(t);
    if (mo) {
      const up = Date.parse(m.createdTs ?? '');
      const d = Number.isFinite(up) ? new Date(up + 9 * 3600_000) : new Date(Date.now() + 9 * 3600_000);
      const month = Number(mo[1]);
      const year = d.getUTCFullYear() - (month > d.getUTCMonth() + 1 ? 1 : 0);
      found.push(year * 12 + month - 1);
    }
  }
  const uniq = [...new Set(found)];
  return uniq.length === 1 ? uniq[0]! : null;
}
/** @deprecated 연도 없는 월만 — shootYmOf 를 쓴다. 테스트 호환용. */
export function shootMonthOf(m: Pick<MediaItem, 'tags'> & { createdTs?: string }): number | null {
  const ym = shootYmOf(m);
  return ym === null ? null : (ym % 12) + 1;
}

/**
 * 촬영 월 고르기(순수, 2026-10-12 사장님 지시) — 보관소 태그 "2026년 9월"·"2026년 10월"은 촬영 연월이다. 10월 글엔 10월 영상을 쓰려고 단 태그인데,
 * 종전엔 태그가 주제 문장에 "10월"이 있을 때만 가점(+10)을 받아 사실상 무시됐다(10월 단풍·모과 글이 9월 영상을 썼다).
 * 같은 수종 등급(g) 안에서: 이번 달 영상이 있으면 이번 달 것만, 없으면 지난달 것만, 둘 다 없으면 그대로("이번 달 우선, 없으면 지난달").
 * 연도까지 본다 — 내년 10월에 올해 10월 영상을 '이번 달'로 보지 않는다. 한 등급 안에서 두 달을 섞지 않는다. 촬영 월을 모르는 소재는 남긴다.
 * nowYm: 연*12+(월-1). 테스트가 고정값을 넘긴다.
 */
export function pickShootMonth<T extends { m: Pick<MediaItem, 'tags'> & { createdTs?: string }; g: number }>(scored: readonly T[], nowYm: number): T[] {
  const keep = new Map<number, number | null>(); // 등급 → 남길 촬영 연월(null = 거르지 않음)
  for (const g of new Set(scored.map((x) => x.g))) {
    const yms = new Set(scored.filter((x) => x.g === g).map((x) => shootYmOf(x.m)).filter((v): v is number => v !== null));
    keep.set(g, yms.has(nowYm) ? nowYm : yms.has(nowYm - 1) ? nowYm - 1 : null);
  }
  return scored.filter((x) => {
    const want = keep.get(x.g);
    if (want === null || want === undefined) return true;
    const ym = shootYmOf(x.m);
    return ym === null || ym === want;
  });
}

/**
 * 점수를 붙여 고른다(2026-09-28) — 로테이션이 '같은 등급 안에서만' 돌려야 하기 때문에 점수가 필요하다.
 *
 * `matchMedia` 는 점수를 버리고 목록만 돌려준다. 그 목록의 첫 항목만 집으면(종전 `limit: 1`) 같은 수종은
 * 영원히 같은 파일이 뽑힌다 — 그래서 후보를 다 받아 등급별로 나눌 자리가 필요해졌다.
 * 등급을 섞으면 안 되는 이유는 배점 자체에 있다: 수종 일치 150 > 제목에 적힌 다른 수종 100 > 범용 1.
 * 안 쓴 범용 소재가 다 쓴 수종 일치 소재를 이기면 수국 편에 회양목이 들어간다.
 */
export function matchMediaScored(
  items: readonly MediaItem[], opts: Parameters<typeof scoreMedia>[1],
): Array<{ item: MediaItem; score: number; grade: number }> {
  return scoreMedia(items, opts).map((x) => ({ item: x.m, score: x.s, grade: x.g }));
}

export function matchMedia(
  items: readonly MediaItem[], opts: Parameters<typeof scoreMedia>[1],
): MediaItem[] {
  return scoreMedia(items, opts).map((x) => x.m);
}
