/**
 * 네이버 블로그 채널 단위 일일 지표(2026-10-02) — AI 브리핑 인용수 + 블로그 전체 검색어 목록.
 *
 * AI 브리핑 인용수. 2026-06-04 부터 블로그 프로필에 'AI 브리핑 인용수'가 붙는다(선정 크리에이터가 아니면
 * 로그인한 주인에게만 보인다 — PC 프로필 "2.3만 인용"). 화면 숫자의 실제 소스는 모바일 블로그의
 * api/current-user 응답 result.mateCitations 다(실측):
 *   {cumulativeCount: 23908, currentMonthCount: 449, selectionPeriodCount: 8123, currentMonth: 10, selectionPeriodMonth: 8}
 * cumulativeCount=누적, currentMonthCount=이번 달(currentMonth 월) 누적. selectionPeriod* 는 '선정 심사 기간'
 * 집계로 보이나 의미는 확인되지 않았다 — 원값만 적고 해석하지 않는다. 글별 인용수는 찾지 못했다 — 확인한 곳:
 * 모바일 블로그 홈의 api 응답 전부(current-user·post-list·popular-post-list 등), PC 프로필, mate.naver.com/my
 * (메이트 스튜디오 — 선정·지원금 내역뿐, 선정 0회). 메이트 소개에 따르면 '선정된 달'에만 검색 결과의 글에
 * 인용수가 붙는다. mateCitations 가 없거나 null 이면 0 이 아니라 상태로 남긴다.
 *
 * 블로그 전체 검색어. 글별 검색어는 naver_stats.py 가 글마다 모은다(측정창 안의 글만). 이 목록은 측정창 밖
 * 옛 글까지 포함한 '블로그로 들어온 검색어 전부'의 일별 합 — 글 귀속은 없다(통계 '유입분석 → 검색 유입' 소스,
 * api/blog/user/referer/search). 실측 2026-10-01: 상위 20개 + '기타' 45, 합 71 = refererTotalCount 71 —
 * 상위 20개 밖은 네이버가 묶어서 준다(size 인자 무시). 그래서 '기타'는 otherCv 로 따로 적고 truncated 표시.
 *
 * 브라우저를 띄우지 않는다 — 발행·클립이 쓰는 브랜드 프로필의 naver_cookies.json 만 읽는다(clipPerf 와 같은
 * 방식, 프로필 락 무관). 그래서 07:30 순수 API 잡에서 돈다. 쿠키가 풀리면 상태 'not_logged_in'.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../config';
import { isSafeBrandSlug } from '../content/brand';
import { fetchTimeout } from '../util/fetch';
import { clipCookieHeader } from './clipPerf';

export type KpiStatus = 'ok' | 'not_visible' | 'not_logged_in' | 'error';

export interface AiCitationRow {
  date: string; // KST YYYY-MM-DD(수집일)
  ts: string;
  status: KpiStatus;
  cumulative?: number;
  currentMonth?: number;
  currentMonthCount?: number;
  selectionPeriodMonth?: number;
  selectionPeriodCount?: number;
  note?: string;
}

export interface BlogSearchRow {
  date: string; // 통계 날짜(KST, 하루 전체)
  ts: string;
  scope: 'blog';
  status: KpiStatus;
  /** 그날 검색 유입 합(refererTotalCount). */
  searchCv?: number;
  queries?: Array<{ query: string; cv: number }>;
  /** 상위 20개 밖 검색어 유입 합('기타' 묶음) — 블로그 전체 목록은 20개까지만 온다. */
  otherCv?: number;
  /** 목록 합이 searchCv 보다 작다 — 네이버가 목록을 잘랐다. */
  truncated?: boolean;
  note?: string;
}

const kstDay = (d: Date): string => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const addDays = (ymd: string, n: number): string => {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : undefined);

/** api/current-user 응답 → 인용수 행(순수). */
export function aiCitationRowFrom(body: unknown, date: string, ts: string): AiCitationRow {
  const res = body && typeof body === 'object' ? (body as { result?: unknown }).result : undefined;
  if (!res || typeof res !== 'object') return { date, ts, status: 'error', note: '응답 형식 아님' };
  const r = res as { loggedIn?: unknown; mateCitations?: unknown };
  if (r.loggedIn !== true) return { date, ts, status: 'not_logged_in', note: '쿠키 세션 만료 — 블로그 발행 등 헤드풀 실행에서 재로그인되면 복구' };
  const mc = r.mateCitations;
  if (!mc || typeof mc !== 'object') return { date, ts, status: 'not_visible', note: 'mateCitations 없음 — 이 계정에 인용수가 노출되지 않음' };
  const m = mc as Record<string, unknown>;
  const cumulative = int(m.cumulativeCount);
  if (cumulative === undefined) return { date, ts, status: 'not_visible', note: 'cumulativeCount 없음' };
  return {
    date, ts, status: 'ok', cumulative,
    currentMonth: int(m.currentMonth), currentMonthCount: int(m.currentMonthCount),
    selectionPeriodMonth: int(m.selectionPeriodMonth), selectionPeriodCount: int(m.selectionPeriodCount),
  };
}

/** api/blog/user/referer/search 응답 → 블로그 전체 검색어 행(순수). */
export function blogSearchRowFrom(body: unknown, date: string, ts: string): BlogSearchRow {
  const base = { date, ts, scope: 'blog' as const };
  const b = body && typeof body === 'object' ? body as { statusCode?: unknown; result?: unknown } : null;
  if (!b) return { ...base, status: 'error', note: '응답 형식 아님' };
  if (b.statusCode !== 200) return { ...base, status: b.statusCode === 401 ? 'not_logged_in' : 'error', note: `statusCode ${String(b.statusCode)}` };
  const list = (b.result as { statDataList?: unknown } | undefined)?.statDataList;
  const byId = new Map<string, unknown>();
  for (const s of Array.isArray(list) ? list : []) {
    if (s && typeof s === 'object') byId.set(String((s as { dataId?: unknown }).dataId), (s as { data?: unknown }).data);
  }
  const rows = (byId.get('refererSearch') as { rows?: Record<string, unknown> } | undefined)?.rows;
  const qs = Array.isArray(rows?.searchQuery) ? rows!.searchQuery as unknown[] : [];
  const cvs = Array.isArray(rows?.cv) ? rows!.cv as unknown[] : [];
  const queries: Array<{ query: string; cv: number }> = [];
  let otherCv = 0;
  for (let i = 0; i < Math.min(qs.length, cvs.length); i++) {
    const query = String(qs[i] ?? '').trim();
    const cv = int(cvs[i]) ?? 0;
    // 상위 20개 뒤는 '기타' 한 줄로 뭉쳐 온다(실측 2026-10-01: 20개 + 기타 45). 검색어가 아니다.
    if (query === '기타') { otherCv += cv; continue; }
    if (query && cv > 0) queries.push({ query, cv });
  }
  queries.sort((x, y) => y.cv - x.cv || x.query.localeCompare(y.query));
  const total = int((byId.get('refererTotalCount') as { value?: unknown } | undefined)?.value);
  const sum = queries.reduce((n, q) => n + q.cv, 0);
  const truncated = otherCv > 0 || (total !== undefined && sum < total);
  return { ...base, status: 'ok', searchCv: total ?? sum + otherCv, queries, ...(otherCv ? { otherCv } : {}), ...(truncated ? { truncated: true } : {}) };
}

const fileFor = (kind: 'ai_citations' | 'search_queries', slug: string): string =>
  path.join(CONFIG.dataDir, 'analytics', `${kind}-${slug || 'default'}.jsonl`);

function readRows<T>(file: string): T[] {
  try {
    return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l) as T]; } catch { return []; }
    });
  } catch { return []; }
}
function appendRow(file: string, row: object): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf-8');
  } catch { /* 영속 실패 무해 */ }
}

export function readAiCitations(slug: string): AiCitationRow[] { return readRows<AiCitationRow>(fileFor('ai_citations', slug)); }
export function readBlogSearchQueries(slug: string): BlogSearchRow[] { return readRows<BlogSearchRow>(fileFor('search_queries', slug)); }

/** 최신 인용수 — 마지막 ok 행과(있으면) 그 뒤에 쌓인 실패 상태를 함께(순수 읽기). */
export function latestAiCitations(slug: string): { latest: AiCitationRow | null; prev: AiCitationRow | null; lastStatus: KpiStatus | null } {
  const rows = readAiCitations(slug);
  const ok = rows.filter((r) => r.status === 'ok');
  return { latest: ok[ok.length - 1] ?? null, prev: ok[ok.length - 2] ?? null, lastStatus: rows[rows.length - 1]?.status ?? null };
}

/** 아직 ok 로 기록되지 않은 통계 날짜들(순수) — 어제부터 거꾸로 최대 backfillDays 일, 오래된 순. */
export function missingSearchDates(rows: readonly BlogSearchRow[], now: Date = new Date(), backfillDays = 7): string[] {
  const have = new Set(rows.filter((r) => r.status === 'ok').map((r) => r.date));
  const yesterday = addDays(kstDay(now), -1);
  const out: string[] = [];
  for (let i = backfillDays - 1; i >= 0; i--) {
    const d = addDays(yesterday, -i);
    if (!have.has(d)) out.push(d);
  }
  return out;
}

function cookieFor(slug: string): string {
  if (slug && !isSafeBrandSlug(slug)) return '';
  try {
    const file = path.join(os.homedir(), '.naver-blog-profiles', slug || 'cli', 'naver_cookies.json');
    return clipCookieHeader(JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<{ name?: string; value?: string; domain?: string }>);
  } catch { return ''; }
}

async function getJson(url: string, cookie: string, referer: string): Promise<unknown> {
  const r = await fetchTimeout(url, { headers: { Cookie: cookie, Referer: referer, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } }, undefined, 20_000);
  const text = await r.text();
  try { return JSON.parse(text) as unknown; } catch { return { statusCode: r.status === 200 ? 598 : r.status }; }
}

/**
 * 이미 적힌 실패 상태인가(순수) — 같은 날짜·같은 상태의 행이 있으면 다시 적지 않는다(리뷰 2026-10-02: 빠른
 * 새로고침마다 not_logged_in 행이 쌓였다). ok 는 여기 오지 않는다(오늘 ok 면 아예 묻지 않는다).
 */
export function isRepeatStatusRow(rows: ReadonlyArray<{ date: string; status: KpiStatus }>, row: { date: string; status: KpiStatus }): boolean {
  return row.status !== 'ok' && rows.some((r) => r.date === row.date && r.status === row.status);
}

/**
 * 하루 1회 기록(멱등) — 인용수는 오늘 ok 행이 있으면 건너뛰고, 검색어는 ok 로 비어 있는 날만(최근 7일) 채운다.
 * 실패는 상태 행으로 남기고(같은 날·같은 상태는 한 번만) 다음 실행이 다시 시도한다. 어떤 예외도 밖으로 던지지 않는다.
 */
export async function recordNaverBlogKpis(slug: string, now: Date = new Date()): Promise<{ ai: KpiStatus | 'skipped'; searchDays: number }> {
  const ts = now.toISOString();
  const today = kstDay(now);
  const cookie = cookieFor(slug);
  let ai: KpiStatus | 'skipped' = 'skipped';
  const aiRows = readAiCitations(slug);
  if (!aiRows.some((r) => r.date === today && r.status === 'ok')) {
    let row: AiCitationRow;
    if (!cookie) row = { date: today, ts, status: 'not_logged_in', note: '브랜드 프로필 쿠키 파일 없음' };
    else {
      try { row = aiCitationRowFrom(await getJson('https://m.blog.naver.com/api/current-user', cookie, 'https://m.blog.naver.com/'), today, ts); }
      catch (e) { row = { date: today, ts, status: 'error', note: (e instanceof Error ? e.message : String(e)).slice(0, 120) }; }
    }
    if (!isRepeatStatusRow(aiRows, row)) appendRow(fileFor('ai_citations', slug), row);
    ai = row.status;
  }
  let searchDays = 0;
  if (cookie) {
    const searchRows = readBlogSearchQueries(slug);
    for (const d of missingSearchDates(searchRows, now)) {
      let row: BlogSearchRow;
      try {
        const body = await getJson(`https://blog.stat.naver.com/api/blog/user/referer/search?timeDimension=DATE&startDate=${d}&exclude=`, cookie, 'https://m.blog.naver.com/');
        row = blogSearchRowFrom(body, d, ts);
      } catch (e) { row = { date: d, ts, scope: 'blog', status: 'error', note: (e instanceof Error ? e.message : String(e)).slice(0, 120) }; }
      if (!isRepeatStatusRow(searchRows, row)) appendRow(fileFor('search_queries', slug), row);
      if (row.status !== 'ok') break; // 세션 만료·장애면 남은 날도 같다 — 실패 행을 줄줄이 쌓지 않는다
      searchDays++;
    }
  }
  return { ai, searchDays };
}
