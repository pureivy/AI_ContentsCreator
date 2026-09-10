/**
 * 네이버 블로그 색인 자동 점검(사용자 요청 2026-07-23) — 발행 글이 네이버 블로그 검색(Open API)에서
 * 자기 postId 로 뜨는지 확인한다. NAVER_CLIENT_ID/SECRET(검색·데이터랩 공용) 설정 시 활성.
 *
 * 해석 주의(중요):
 * - **이 검색은 저품질 판정에 쓰지 않는다**(2026-09-11 사용자 확정). 종전엔 '자기 제목 검색에 없음'을
 *   저품질 의심으로 브리핑에 올렸는데, 실측으로 오탐이 확인됐다:
 *     · 의심 48편 중 47편이 네이버 조회가 잡혔고 중앙값 19회로, '있음' 글(11회)보다 오히려 높았다.
 *     · 의심 글 하나는 본문 문장으로 검색하니 28위로 나왔다 — 색인은 돼 있고 제목 검색에서 밀린 것뿐.
 *     · 제목을 따옴표로 묶어도 무관한 글 30개가 돌아온다. 이 API 는 정확 일치가 아니라 단어 유사 검색이다.
 *     · 같은 제목으로 검색되는 전체 글 수 중앙값이 의심 346 vs 있음 8(43배) — 재는 것은 품질이 아니라
 *       '제목이 얼마나 흔한가'다. 흔한 제목일수록 30위 밖으로 밀려 무조건 의심으로 찍혔다.
 * - **있음 = 약한 양성**일 뿐 "정상"이 아니다. openapi.naver 블로그 검색은 사용자 통합검색 색인보다
 *   관대해서, 저품질 글도 여기엔 뜰 수 있다. 그래서 문구는 "블로그 검색결과에 있음/없음"으로만.
 * - 저품질 의심은 lowTrafficSuspects(실제 유입)가 판정한다. 이 검색 결과는 참고 수치로만 브리핑에 남는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { getSecret } from '../secrets/store';
import { fetchTimeout } from '../util/fetch';
import { pieceStore } from '../content/pieces';
import { activeBrandSlug } from '../content/brand';

const CID = 'NAVER_CLIENT_ID';
const CSEC = 'NAVER_CLIENT_SECRET';
export const GRACE_DAYS = 7; // 발행 후 이만큼 지나야 '없음'을 저품질 신호로 본다(그 전엔 색인 대기).
export function naverIndexingEnabled(): boolean { return !!getSecret(CID) && !!getSecret(CSEC); }

/** 네이버 블로그 글 URL → { blogId, postId }. 두 형식 지원: /blogId/postId, PostView.naver?blogId=&logNo=. 순수. */
export function naverBlogRef(url: string): { blogId: string; postId: string } {
  const clean = /blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)/.exec(url || '');
  if (clean) return { blogId: clean[1]!, postId: clean[2]! };
  return {
    blogId: /[?&]blogId=([^&]+)/.exec(url || '')?.[1] ?? '',
    postId: /[?&]logNo=(\d+)/.exec(url || '')?.[1] ?? '',
  };
}

/** 블로그 검색에 이 postId 가 있는지(있음=true). API 실패는 throw(호출부가 '점검불가'로 구분). */
async function searchHasPost(title: string, postId: string, signal?: AbortSignal): Promise<boolean> {
  const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(title)}&display=30&sort=sim`;
  const r = await fetchTimeout(url, {
    headers: { 'X-Naver-Client-Id': getSecret(CID)!, 'X-Naver-Client-Secret': getSecret(CSEC)! },
  }, signal);
  if (!r.ok) throw new Error(`naver search ${r.status}`);
  const j = await r.json() as { items?: Array<{ link?: string }> };
  return (j.items ?? []).some((it) => !!postId && (it.link || '').includes(postId));
}

export interface IndexStatus { title: string; ageDays: number; found: boolean; checkable: boolean }
export interface IndexReport { ts: string; brand: string; results: IndexStatus[] }

/** 활성 브랜드 발행 블로그 글의 색인 상태(라이브 API). 자격증명 없으면 빈 배열. */
export async function checkNaverIndexing(now = Date.now(), signal?: AbortSignal): Promise<IndexStatus[]> {
  if (!naverIndexingEnabled()) return [];
  const brand = activeBrandSlug() || '';
  const out: IndexStatus[] = [];
  for (const p of pieceStore().list()) {
    if ((p.brand ?? '') !== brand || !p.publishedUrl) continue;
    const { postId } = naverBlogRef(p.publishedUrl);
    if (!postId) continue;
    const ageDays = Math.floor((now - new Date(p.updatedTs).getTime()) / 86_400_000);
    let found = false, checkable = true;
    try { found = await searchHasPost(p.title, postId, signal); } catch { checkable = false; }
    out.push({ title: p.title, ageDays: Number.isFinite(ageDays) ? Math.max(0, ageDays) : 0, found, checkable });
  }
  return out;
}

const cacheFile = (): string => path.join(CONFIG.dataDir, '_shared', 'naver-indexing.json');
/** 점검 후 결과를 캐시 파일에 기록(브리핑이 동기로 읽는다). API 부하 낮음(글 수만큼 검색 1회). */
export async function refreshNaverIndexingCache(now = Date.now(), signal?: AbortSignal): Promise<IndexReport | null> {
  if (!naverIndexingEnabled()) return null;
  const results = await checkNaverIndexing(now, signal);
  const report: IndexReport = { ts: new Date(now).toISOString(), brand: activeBrandSlug() || '', results };
  try { fs.mkdirSync(path.dirname(cacheFile()), { recursive: true }); fs.writeFileSync(cacheFile(), JSON.stringify(report)); } catch { /* 영속 실패 무해 */ }
  return report;
}
// ── 저품질 의심 판정(2026-09-11 사용자 확정) — 근거를 '제목 검색'에서 '실제 유입'으로 바꿨다 ──
// 네이버 저품질의 실제 증상은 검색 노출이 막혀 유입이 끊기는 것이다. 우리는 네이버 조회수를 매일
// 수집하고 있으므로(scrape:naver_advisor) 그 값을 직접 보는 편이 검색 순위 추측보다 정확하다.
/** 이 일수가 지나야 '유입 없음'을 신호로 본다(그 전엔 아직 쌓이는 중). */
export const LOW_TRAFFIC_DAYS = 21;
/** 누적 조회가 이 수 미만이면 유입이 사실상 없다고 본다. 실측 분포: 발행 21일+ 글 89편의 10% 분위가 4회. */
export const LOW_TRAFFIC_VIEWS = 5;

/** 코호트 비교를 재는 나이 — 발행 후 이 일수 시점의 누적 조회로 최근분과 이전분을 견준다. */
export const COHORT_AGE_DAYS = 14;
/** 이 일수 미만이면 '최근 발행분', 이상이면 '그 이전'. */
export const COHORT_SPLIT_DAYS = 45;

/** 유입 판정 입력 — views 가 null 이면 측정 기록이 없는 글(판정 보류). viewsAtAge 는 COHORT_AGE_DAYS 시점 누적. */
export interface TrafficRow { title: string; ageDays: number; views: number | null; viewsAtAge?: number | null }

/**
 * 유입이 사실상 없는 글(순수) — 발행 minDays 경과 && 누적 조회 minViews 미만. 조회가 적은 순.
 * 측정 기록이 없는 글(views null)은 '모름'이지 '없음'이 아니라 판정에서 뺀다.
 */
export function lowTrafficSuspects(
  rows: readonly TrafficRow[], minDays = LOW_TRAFFIC_DAYS, minViews = LOW_TRAFFIC_VIEWS,
): TrafficRow[] {
  return rows
    .filter((r) => typeof r.views === 'number' && r.ageDays >= minDays && r.views < minViews)
    .sort((a, b) => (a.views ?? 0) - (b.views ?? 0));
}

/** 조회 중앙값(순수) — 측정된 글만, 값이 없으면 null. */
export function medianViews(rows: readonly TrafficRow[]): number | null {
  const v = rows.map((r) => r.views).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)]! : null;
}

/**
 * 블로그 단위 낙차(순수) — 저품질은 글 하나가 아니라 블로그 전체에 온다. 최근 발행분과 그 이전을
 * **같은 나이(COHORT_AGE_DAYS 일차) 누적 조회**로 견준다.
 *
 * 누적 조회를 그냥 비교하면 안 된다 — 오래된 글이 언제나 크므로 '최근이 적다'가 항상 참이 되어 매일
 * 거짓 경보가 난다(실측 2026-09-11: 최근 30일 11회 vs 그 이전 35회로 경고가 떴는데, 같은 나이로 맞추니
 * 11회 vs 8회로 낙차가 없었다). 아직 그 나이가 안 된 글은 표본에서 빠진다(viewsAtAge null).
 */
export function cohortMedians(
  rows: readonly TrafficRow[], splitDays = COHORT_SPLIT_DAYS,
): { recent: number | null; older: number | null; recentN: number; olderN: number } {
  const pick = (f: (age: number) => boolean): TrafficRow[] =>
    rows.filter((r) => f(r.ageDays) && typeof r.viewsAtAge === 'number')
      .map((r) => ({ ...r, views: r.viewsAtAge! }));
  const recent = pick((a) => a >= COHORT_AGE_DAYS && a < splitDays);
  const older = pick((a) => a >= splitDays);
  return { recent: medianViews(recent), older: medianViews(older), recentN: recent.length, olderN: older.length };
}

/** 캐시된 색인 리포트(동기) — 브리핑용. 없으면 null. */
export function readNaverIndexingReport(): IndexReport | null {
  try { const r = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as IndexReport; return Array.isArray(r.results) ? r : null; } catch { return null; }
}
