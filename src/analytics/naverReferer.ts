/**
 * 네이버 블로그 글별 검색 유입 검색어(2026-10-02) — naver_stats.py 가 남긴 통계 '유입경로' 원본을 해석한다.
 *
 * 왜 새로 만들었나. 성과 표본 3,853건의 searchInflow 가 전부 빈 배열이었다. 수집기가 크리에이터 어드바이저의
 * 'inflow-*' 후보 경로 넷을 찍어 봤는데 캡처 167건 어디에도 응답이 한 번도 없었다(전부 404 → resp.ok 거짓 →
 * 덤프에도 안 남음). 어드바이저에 있는 검색어는 realtime-summary 의 '오늘 블로그 전체 상위 3개'뿐이고 글 귀속이
 * 없어 일부러 버리고 있었다. 글별 검색어는 블로그 통계(blog.stat.naver.com) 게시물 화면 '유입경로' 탭에 있다:
 *   - api/blog/article/referer/total            도메인별 유입(검색 엔진 여부 referrerSearchEngine '1'/'0')
 *   - api/blog/article/referer/total/detail      도메인 하나의 검색어 전부(size=200)
 * total 에 딸려 오는 refererDetail 은 1위 도메인만·최대 20행이라 그것만 쓰면 검색어가 잘린다(실측: 34개 중 20개).
 *
 * 누적으로 맞춘다. topInflow 는 키워드별 '최대값'으로 병합하고, 강화는 D+14 표본 하나의 searchInflow 를 본다 —
 * 둘 다 값이 누적이라는 전제다(조회수와 같은 성질). 그래서 매번 발행일부터 지금까지의 기간을 통째로 다시 묻는다:
 * 지난 달은 MONTH, 이번 달은 끝난 주 WEEK + 나머지 DATE. 진행 중인 주·월은 네이버가 500 을 준다(실측).
 */
import type { SearchInflow } from './performance';

const kstDay = (d: Date): string => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const addDays = (ymd: string, n: number): string => {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};
const addMonths = (ymd01: string, n: number): string => {
  const d = new Date(Date.UTC(+ymd01.slice(0, 4), +ymd01.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};
const isMonday = (ymd: string): boolean =>
  new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay() === 1;

export interface StatPeriod { dim: 'MONTH' | 'WEEK' | 'DATE'; start: string; }

/**
 * 발행일 → 지금까지를 겹치지 않게 덮는 통계 기간(순수, KST).
 * - 발행 달 ~ 지난 달: MONTH(최근 maxMonths 개월까지 — 그보다 오래된 글은 앞이 빠진다).
 * - 이번 달: 월요일에 시작해 이틀 전까지 끝난 주는 WEEK(주간 롤업은 다음 월요일 새벽 완료 — 하루 여유),
 *   나머지 날은 DATE(오늘 포함 — 오늘 값은 실시간이라 다음 수집이 덮어 맞춘다).
 * 롤업이 늦어 진행 중인(끝난 지 3일 안 된) MONTH/WEEK 가 500·빈 자리표시를 주면 수집기가 그 기간을 DATE 로
 * 쪼개 다시 묻는다. 401·로그인 벽·오래된 기간의 실패는 쪼개지 않는다(리뷰 2026-10-02 — 199콜 폭주).
 */
export function statInflowPeriods(publishedTs: string | undefined, now: Date = new Date(), maxMonths = 6): StatPeriod[] {
  const pubMs = publishedTs ? Date.parse(publishedTs) : NaN;
  if (!Number.isFinite(pubMs)) return [];
  const pub = kstDay(new Date(pubMs));
  const today = kstDay(now);
  if (pub > today) return [];
  const m0 = `${today.slice(0, 7)}-01`;
  const out: StatPeriod[] = [];
  const firstMonth = `${pub.slice(0, 7)}-01`;
  const floor = addMonths(m0, -maxMonths);
  for (let m = firstMonth > floor ? firstMonth : floor; m < m0; m = addMonths(m, 1)) out.push({ dim: 'MONTH', start: m });
  const weekCutoff = addDays(today, -2);
  for (let d = pub > m0 ? pub : m0; d <= today;) {
    if (isMonday(d) && addDays(d, 6) <= weekCutoff) { out.push({ dim: 'WEEK', start: d }); d = addDays(d, 7); }
    else { out.push({ dim: 'DATE', start: d }); d = addDays(d, 1); }
  }
  return out;
}

export const periodsArg = (ps: StatPeriod[]): string => ps.map((p) => `${p.dim}:${p.start}`).join(',');

/** 열 배열(columnar) → 행 객체(순수). 열 길이가 다르면 가장 짧은 길이까지만(어긋난 꼬리는 버린다). */
export function columnarRows(data: unknown, cols: readonly string[]): Array<Record<string, unknown>> {
  const rows = (data && typeof data === 'object' ? (data as { rows?: unknown }).rows : null) as Record<string, unknown> | null;
  if (!rows || typeof rows !== 'object') return [];
  const arrs = cols.map((c) => (Array.isArray(rows[c]) ? rows[c] as unknown[] : null));
  if (arrs.some((a) => a === null)) return [];
  const n = Math.min(...arrs.map((a) => a!.length));
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) out.push(Object.fromEntries(cols.map((c, j) => [c, arrs[j]![i]])));
  return out;
}

const cnt = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

export interface RefererSummary {
  /** 모든 기간이 성공했나(하나 이상, 실패 0) — false 면 호출부는 종전 값(빈 유입)을 유지한다. 조회수와 무관하다. */
  ok: boolean;
  /** 검색어 누적(유입 수 내림차순, 상위 limit 개). 검색 순위(rank)는 네이버가 주지 않는다. */
  inflow: SearchInflow[];
  /** 검색 엔진 도메인 유입 합(검색어를 못 받은 Google 등은 referrerSearchEngine '0' 이라 빠진다). */
  searchCv: number;
  /** 모든 도메인 유입 합(=그 기간 조회수). */
  totalCv: number;
  /** 서로 다른 검색어 수(상위 limit 로 자르기 전). */
  distinctQueries: number;
  /** 검색 유입 중 검색어 상세를 못 받은 유입 수(상세 요청 실패·200행 초과) — 0 이 아니면 inflow 가 일부다. */
  missingQueryCv: number;
  periodsOk: number;
  periodsFailed: number;
  /** 덮은 가장 이른 날짜(MONTH/WEEK 는 시작일) — 오래된 글은 maxMonths 앞이 빠진다. */
  since?: string;
}

/**
 * naver_stats.py --referer-out 덤프 → 글별 누적 검색 유입(순수). 형식이 깨졌으면 ok=false.
 * 수집기가 상한(시간·호출 수·연속 실패)에 걸려 중단한 덤프(aborted)도 ok=false — 값이 누적이라 일부 기간만
 * 합치면 과소 계상된 검색 유입이 그 표본에 적힌다(리뷰 2026-10-02). 중단은 아니지만 기간 하나라도 실패한 덤프도
 * 같은 이유로 ok=false(2차 리뷰) — 그 표본은 검색 유입 없이 조회수만 적히고, 다음 수집이 발행일부터 다시 묻는다.
 * expanded=true 인 기간(롤업 전이라 DATE 로 쪼갠 MONTH/WEEK)은 합산하지 않는다 — 쪼갠 DATE 들이 대신한다.
 */
export function parseRefererDump(dump: unknown, limit = 30): RefererSummary {
  const empty: RefererSummary = { ok: false, inflow: [], searchCv: 0, totalCv: 0, distinctQueries: 0, missingQueryCv: 0, periodsOk: 0, periodsFailed: 0 };
  const periods = dump && typeof dump === 'object' ? (dump as { periods?: unknown }).periods : null;
  if (!Array.isArray(periods)) return empty;
  if ((dump as { aborted?: unknown }).aborted) return empty;
  const byQuery = new Map<string, number>();
  const r = { ...empty };
  for (const p of periods) {
    if (!p || typeof p !== 'object') continue;
    const per = p as { dim?: unknown; start?: unknown; status?: unknown; expanded?: unknown; total?: unknown; details?: unknown };
    if (per.expanded === true) continue;
    if (Number(per.status) !== 200) { r.periodsFailed++; continue; }
    r.periodsOk++;
    if (typeof per.start === 'string' && (!r.since || per.start < r.since)) r.since = per.start;
    const domains = columnarRows(per.total, ['referrerDomain', 'referrerSearchEngine', 'cv']);
    const searchByDomain = new Map<string, number>();
    for (const d of domains) {
      const cv = cnt(d.cv);
      r.totalCv += cv;
      if (String(d.referrerSearchEngine) === '1' && cv > 0) {
        r.searchCv += cv;
        const key = String(d.referrerDomain ?? '');
        searchByDomain.set(key, (searchByDomain.get(key) ?? 0) + cv);
      }
    }
    const got = new Map<string, number>();
    for (const det of Array.isArray(per.details) ? per.details : []) {
      if (!det || typeof det !== 'object') continue;
      const dd = det as { domain?: unknown; status?: unknown; data?: unknown };
      if (Number(dd.status) !== 200) continue;
      let sum = 0;
      for (const row of columnarRows(dd.data, ['searchQuery', 'cv'])) {
        const q = String(row.searchQuery ?? '').trim();
        const cv = cnt(row.cv);
        // '기타'는 목록 밖 묶음(블로그 전체 목록에서 실측) — 검색어가 아니다. 빠진 몫은 missingQueryCv 로 드러난다.
        if (!q || !cv || q === '기타') continue;
        byQuery.set(q, (byQuery.get(q) ?? 0) + cv);
        sum += cv;
      }
      const dom = String(dd.domain ?? '');
      got.set(dom, (got.get(dom) ?? 0) + sum);
    }
    for (const [dom, cv] of searchByDomain) r.missingQueryCv += Math.max(0, cv - (got.get(dom) ?? 0));
  }
  r.ok = r.periodsOk > 0 && r.periodsFailed === 0;
  r.distinctQueries = byQuery.size;
  r.inflow = [...byQuery.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    // rank 는 넣지 않는다 — 네이버가 주는 검색 순위가 없고, 유입 순서를 rank 로 적으면 강화가 위키에
    // "(14, 1위)"로 써서 '검색 1위'로 읽힌다.
    .map(([keyword, count]) => ({ keyword, count }));
  return r;
}
