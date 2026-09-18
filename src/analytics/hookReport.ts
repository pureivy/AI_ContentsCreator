/**
 * 숏폼 첫 2초·리듬 판정(2026-09-18, 스펙 §5) — scripts/shorts_hook_report.ts 가 쓰는 순수 집계.
 * 파일시스템·스토어 접근은 스크립트 쪽에 두고, 여기는 구간 나누기·중앙값·비율 계산만 담아 테스트를
 * 가짜 로우로 돌릴 수 있게 한다(rotation_report.ts 는 스크립트에 계산을 박아 놨지만, 이 판정은
 * 6h 400+ 게이트처럼 조건부 로직이 있어 별도 모듈로 뺀다).
 */

/** 중앙값(순수) — 빈 배열은 표본 없음(null, '-' 로 출력). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 불리언 배열 → 비율(순수) — 빈 배열은 표본 없음(null). */
export function ratioOf(flags: boolean[]): number | null {
  if (!flags.length) return null;
  return flags.filter(Boolean).length / flags.length;
}

export interface HookFootageRow { scene?: unknown }

/**
 * 훅(1번 씬) 실촬영 판정(순수, 리뷰 fix round 1) — clips/sources.json 은 2026-09-09 이후 편에만
 * 있다(src/orchestrator/shorts.ts 클립 재사용 주석 참조). sources.json 이 있으면 그 안의 scene===1
 * 존재 여부를 그대로 믿고(파일명 관례는 안 본다 — 실촬영 배정 안 된 편에 우연히 옛 user_01.mp4 가
 * 남아 있어도 오탐되지 않게), 없는 구편만 scene 1 파일명 관례(user_01.mp4, shorts.ts:1616)로 판정한다
 * — 둘 다 "이 씬에 실촬영을 배정했다"는 같은 사실을 다른 시대의 다른 자료로 기록한 것뿐이다.
 * 어느 경우든 참/거짓을 확정해 반환한다(표본에서 빼지 않는다) — 이 지표는 "전체 편 중 훅 실촬영 비율"
 * 이라 sources.json 이 없다고 그 편을 세지 않으면 분모가 왜곡된다.
 */
export function hookFootageFrom(sourcesRows: HookFootageRow[] | null, hasUser01File: boolean): boolean {
  if (sourcesRows) return sourcesRows.some((r) => r.scene === 1);
  return hasUser01File;
}

export interface YoutubeTsRow { youtubeTs?: string }

/**
 * youtubeTs 기준 구간 나누기(순수) — '배포 전 30일'은 [since-30일, since), '배포 후'는 [since, ∞).
 * youtubeTs 없는(미발행) 편은 두 구간 다 제외한다(브리프: youtubeTs 있는 편만 대상).
 */
export function segmentByYoutubeTs<T extends YoutubeTsRow>(
  rows: T[], sinceMs: number, beforeDays = 30,
): { before: T[]; after: T[] } {
  const span = beforeDays * 86_400_000;
  const before: T[] = [];
  const after: T[] = [];
  for (const r of rows) {
    if (!r.youtubeTs) continue;
    const t = Date.parse(r.youtubeTs);
    if (!Number.isFinite(t)) continue;
    if (t >= sinceMs - span && t < sinceMs) before.push(r);
    else if (t >= sinceMs) after.push(r);
  }
  return { before, after };
}

export interface SixHourSample { measuredAt: string; views: number }

/**
 * metaPublishedTs + 5~7시간 창 안의 마지막(가장 최신) meta:ig 조회수(순수) — 창 안 표본이 없으면 null
 * ('아직 못 잼'과 '0'을 구분, performance.ts viewsAtAge 와 같은 원칙).
 */
export function sixHourViewsIfEligible(metaPublishedTs: string, samples: SixHourSample[]): number | null {
  const pub = Date.parse(metaPublishedTs);
  if (!Number.isFinite(pub)) return null;
  const lo = pub + 5 * 3_600_000;
  const hi = pub + 7 * 3_600_000;
  let found: number | null = null;
  for (const s of samples) {
    const t = Date.parse(s.measuredAt);
    if (Number.isFinite(t) && t >= lo && t <= hi) found = s.views; // 여러 개면 마지막(가장 6h 에 가까운 값)
  }
  return found;
}

export interface SixHourRow { metaPublishedTs?: string; samples: SixHourSample[] }
export interface SixHourVerdict {
  /** 표본 5편 미만이면 null('-' 로 출력) — 있어도 몇 편으로 낸 숫자인지 eligible 로 항상 밝힌다. */
  ratio: number | null;
  /** 5~7시간 창 표본이 있어 분모에 들어간 편 수(전체 편수와 다르다 — 아직 6시간이 안 지난 편은 빠진다). */
  eligible: number;
}

/**
 * '6h 400+ 비율' — 5~7시간 창 표본이 있는 편이 5편 미만이면 판정 보류(ratio: null → '-').
 * eligible 을 항상 같이 반환해, 판정이 나온 경우에도 몇 편 표본인지(5편인지 40편인지) 감추지 않는다.
 */
export function sixHour400PlusRatio(rows: SixHourRow[]): SixHourVerdict {
  const eligible: number[] = [];
  for (const r of rows) {
    if (!r.metaPublishedTs) continue;
    const v = sixHourViewsIfEligible(r.metaPublishedTs, r.samples);
    if (v !== null) eligible.push(v);
  }
  if (eligible.length < 5) return { ratio: null, eligible: eligible.length };
  return { ratio: eligible.filter((v) => v >= 400).length / eligible.length, eligible: eligible.length };
}
