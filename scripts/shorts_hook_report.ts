/**
 * 숏폼 첫 2초·리듬 판정(2026-09-18, 스펙 §5) — 오늘 올라간 훅 실촬영·훅 음성·자막·예고·점프컷 기능들이
 * 실제로 성과에 붙었는지, '배포 전 30일' vs '배포 후' 로 편수·훅 길이·실촬영 비율·인스타/유튜브 성과를 비교한다.
 * API 호출 0회(로컬 스토어·산출물 파일만 읽는다).
 *
 *   TZ=Asia/Seoul npx tsx scripts/shorts_hook_report.ts                          → 오늘 날짜를 경계로
 *   TZ=Asia/Seoul npx tsx scripts/shorts_hook_report.ts --since 2026-09-18        → 그 날짜를 경계로
 *   TZ=Asia/Seoul npx tsx scripts/shorts_hook_report.ts --since 2026-09-18 --brand bionditree
 *
 * 새 기능이 오늘 올라간 참이라 '배포 후' 구간은 당분간 0편이어도 정상(헤더는 항상 찍는다) — 기준선은
 * '배포 전 30일' 숫자를 본다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { shortsStore, type Shorts } from '../src/content/shorts';
import { readMetrics, latestSampleBySource } from '../src/analytics/performance';
import { median, ratioOf, hookFootageFrom, segmentByYoutubeTs, sixHour400PlusRatio, type SixHourRow } from '../src/analytics/hookReport';

function parseArgs(argv: string[]): { since: string; brand: string } {
  let since = '';
  let brand = 'bionditree';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since' && argv[i + 1]) since = argv[++i]!;
    else if (argv[i] === '--brand' && argv[i + 1]) brand = argv[++i]!;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    since = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // 기본: 오늘(Asia/Seoul)
  }
  return { since, brand };
}

/** plan.json scenes[0].narration 공백 제거 길이(순수 I/O 래퍼) — 없거나 못 읽으면 null. */
function hookCharsOf(id: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(shortsStore().dirFor(id), 'plan.json'), 'utf-8');
    const plan = JSON.parse(raw) as { scenes?: Array<{ narration?: unknown }> };
    const narration = plan.scenes?.[0]?.narration;
    return typeof narration === 'string' ? narration.replace(/\s+/g, '').length : null;
  } catch { return null; }
}

/**
 * clips/sources.json 에 scene 1(훅) 실촬영 클립이 있는가 — 그 파일 자체가 없는 구편(2026-09-09 이전)은
 * user_01.mp4 파일명 관례로 폴백한다(hookFootageFrom, 리뷰 fix round 1).
 */
function hasHookFootage(id: string): boolean {
  const dir = shortsStore().dirFor(id);
  let rows: Array<{ scene?: unknown }> | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'clips', 'sources.json'), 'utf-8')) as unknown;
    if (Array.isArray(parsed)) rows = parsed as Array<{ scene?: unknown }>;
  } catch { /* sources.json 없음/파싱 불가 → rows null 유지, 아래서 폴백 */ }
  const hasUser01 = fs.existsSync(path.join(dir, 'clips', 'user_01.mp4'));
  return hookFootageFrom(rows, hasUser01);
}

// 단위를 포맷터 안에 넣는다 — 밖에서 문자열로 이어 붙이면 표본 0(null) 일 때 '-자'·'-%' 처럼 단위가 샌다.
const fmtNum = (n: number | null, unit = '', digits = 0): string => (n === null ? '-' : `${n.toFixed(digits)}${unit}`);
const fmtPct = (n: number | null): string => (n === null ? '-' : `${Math.round(n * 100)}%`);

function summarize(label: string, rows: Shorts[]): string[] {
  const now = Date.now();
  const hookChars: number[] = [];
  const footageFlags: boolean[] = [];
  const igViews: number[] = [];
  const sharesFlags: boolean[] = [];
  const sixHourRows: SixHourRow[] = [];
  const ytPct: number[] = [];

  for (const r of rows) {
    const chars = hookCharsOf(r.id);
    if (chars !== null) hookChars.push(chars);
    footageFlags.push(hasHookFootage(r.id));

    const samples = readMetrics(r.id); // 편당 1회만 읽고 아래 세 지표(인스타 조회·공유·6h 창)를 모두 여기서 뽑는다.
    const latestIg = latestSampleBySource(samples, 'meta:ig');
    if (latestIg) {
      if (r.metaPublishedTs && now - Date.parse(r.metaPublishedTs) >= 72 * 3_600_000 && typeof latestIg.views === 'number') {
        igViews.push(latestIg.views);
      }
      sharesFlags.push((latestIg.shares ?? 0) >= 3);
    }
    sixHourRows.push({
      metaPublishedTs: r.metaPublishedTs,
      samples: samples.filter((s) => s.source === 'meta:ig').map((s) => ({ measuredAt: s.measuredAt, views: s.views })),
    });

    const yt = latestSampleBySource(samples, 'youtube:analytics')?.avgViewPct;
    if (typeof yt === 'number') ytPct.push(yt);
  }

  const sixHour = sixHour400PlusRatio(sixHourRows);

  return [
    `【${label}】 ${rows.length}편`,
    `  훅 글자 수 중앙       ${fmtNum(median(hookChars), '자')} (표본 ${hookChars.length})`,
    `  훅 실촬영 비율        ${fmtPct(ratioOf(footageFlags))} (표본 ${footageFlags.length})`,
    `  인스타 72h+ 조회 중앙 ${fmtNum(median(igViews))} (표본 ${igViews.length})`,
    `  공유≥3 비율          ${fmtPct(ratioOf(sharesFlags))} (표본 ${sharesFlags.length})`,
    `  6h 400+ 비율          ${sixHour.ratio === null ? '-' : fmtPct(sixHour.ratio)} (표본 ${sixHour.eligible})`,
    `  유튜브 시청비율 중앙  ${fmtNum(median(ytPct), '%', 1)} (표본 ${ytPct.length})`,
  ];
}

const { since, brand } = parseArgs(process.argv.slice(2));
const sinceMs = new Date(`${since}T00:00:00+09:00`).getTime(); // Asia/Seoul 고정 — 실행 TZ 와 무관하게 경계 일치

const all = shortsStore().list().filter((s) => (s.brand ?? '') === brand);
const { before, after } = segmentByYoutubeTs(all, sinceMs);

console.log(`숏폼 첫 2초·리듬 판정 — 브랜드 ${brand} · 경계 ${since}\n`);
for (const line of summarize('배포 전 30일', before)) console.log(line);
console.log('');
for (const line of summarize(`배포 후 (${since}~)`, after)) console.log(line);
