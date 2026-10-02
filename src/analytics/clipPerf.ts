/**
 * 네이버 클립 성과 수집(2026-10-02) — 클립에 올린 숏폼의 재생수·좋아요를 하루 한 번 시계열(naver:clip)로 남긴다.
 *
 * 클립엔 공개 성과 API 가 없다. 클립 크리에이터 화면이 쓰는 목록 API(contents/cursor)가 편마다
 * playCount·likeCount 를 주고, 로그인 쿠키만 있으면 브라우저 없이 부를 수 있다(쿠키 없으면 401, 실측).
 * 쿠키는 블로그 발행·클립 업로드가 쓰는 브랜드 프로필의 naver_cookies.json — 파일만 읽으므로 네이버 프로필
 * 뮤텍스(naverProfileBusy)와 무관하다. 클립별 상세 분석(시청 지속 등)은 네이버가 하루쯤 뒤에 공개해 아직 안 모은다.
 * 전량 fail-open — 실패는 로그만 남기고 다른 채널 수집을 막지 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchTimeout } from '../util/fetch';
import { appendMetrics, type MetricSample } from './performance';
import { shortsStore } from '../content/shorts';
import { isSafeBrandSlug } from '../content/brand';

const API = 'https://clip-service-elb-public.io.naver.com/studio/webapi';

/** 브랜드 프로필의 쿠키 → Cookie 헤더(순수). 네이버 도메인 쿠키만. */
export function clipCookieHeader(cookies: Array<{ name?: string; value?: string; domain?: string }>): string {
  return cookies
    .filter((c) => c.name && typeof c.value === 'string' && (c.domain ?? '').includes('naver.com'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** 목록 항목 → 클립 번호별 표본(순수). 초안·번호 없는 항목은 뺀다. */
export function clipSamplesFromItems(items: unknown[], measuredAt: string): Map<string, MetricSample> {
  const out = new Map<string, MetricSample>();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (o.draft === true || o.mediaContentNo === null || o.mediaContentNo === undefined) continue;
    const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0; };
    out.set(String(o.mediaContentNo), {
      measuredAt, views: n(o.playCount), likes: n(o.likeCount), searchInflow: [], source: 'naver:clip',
    });
  }
  return out;
}

function profileDirFor(slug: string): string {
  if (slug && !isSafeBrandSlug(slug)) throw new Error(`무효한 브랜드 슬러그: ${slug}`);
  return path.join(os.homedir(), '.naver-blog-profiles', slug || 'cli');
}

async function getJson(url: string, cookie: string): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const r = await fetchTimeout(url, { headers: { Cookie: cookie, Referer: 'https://clipcreators.naver.com/', 'User-Agent': 'Mozilla/5.0' } }, undefined, 20_000);
  if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? ' — 네이버 로그인이 풀렸습니다(블로그 발행을 한 번 돌리면 갱신)' : ''}`);
  return await r.json() as Record<string, unknown>;
}

/** 클립 팔로워 수(2026-10-02) — 프로필 정보의 profileSummary.numberOfFollowers. 실패·미로그인은 null(무해). */
export async function fetchClipFollowers(slug: string): Promise<number | null> {
  try {
    const cookie = clipCookieHeader(JSON.parse(fs.readFileSync(path.join(profileDirFor(slug), 'naver_cookies.json'), 'utf-8')) as Array<{ name?: string; value?: string; domain?: string }>);
    if (!cookie) return null;
    const self = await getJson(`${API}/profiles/self`, cookie);
    return clipFollowersOf(self);
  } catch { return null; }
}
/** 프로필 응답 → 팔로워 수(순수). 프로필이 배열로 오기도 한다. */
export function clipFollowersOf(self: unknown): number | null {
  const prof = (Array.isArray(self) ? self[0] : self) as { profileSummary?: { numberOfFollowers?: unknown } } | undefined;
  const n = prof?.profileSummary?.numberOfFollowers;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** 브랜드 하나의 클립 목록을 모두 훑어(최대 10쪽) 번호별 표본을 만든다. */
async function fetchBrandClipSamples(slug: string, want: Set<string>): Promise<Map<string, MetricSample>> {
  const cookiesPath = path.join(profileDirFor(slug), 'naver_cookies.json');
  const cookie = clipCookieHeader(JSON.parse(fs.readFileSync(cookiesPath, 'utf-8')) as Array<{ name?: string; value?: string; domain?: string }>);
  if (!cookie) throw new Error('네이버 로그인 쿠키 없음');
  const self = await getJson(`${API}/profiles/self`, cookie);
  const prof = Array.isArray(self) ? self[0] : self;
  const key = String(prof?.profileKey ?? '');
  if (!key) throw new Error('클립 프로필 없음');
  const now = new Date().toISOString();
  const found = new Map<string, MetricSample>();
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const j = await getJson(`${API}/profiles/${key}/contents/cursor?type=VOD&size=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, cookie) as Record<string, unknown>;
    for (const [no, s] of clipSamplesFromItems(Array.isArray(j.items) ? j.items : [], now)) found.set(no, s);
    if ([...want].every((no) => found.has(no))) break;
    const next = typeof j.nextCursor === 'string' ? j.nextCursor : '';
    if (!next || next === cursor) break;
    cursor = next;
  }
  return found;
}

/** 일일 클립 성과 동기화 — perf-sync 틱·성과 새로고침에서 다른 채널과 나란히 호출. */
export async function syncShortsClipPerformance(): Promise<void> {
  try {
    const clipped = shortsStore().list().filter((s) => !!s.naverClipNo);
    if (!clipped.length) return;
    const byBrand = new Map<string, typeof clipped>();
    for (const s of clipped) byBrand.set(s.brand ?? '', [...(byBrand.get(s.brand ?? '') ?? []), s]);
    for (const [slug, list] of byBrand) {
      try {
        const samples = await fetchBrandClipSamples(slug, new Set(list.map((s) => s.naverClipNo!)));
        let n = 0;
        for (const s of list) {
          const sample = samples.get(s.naverClipNo!);
          if (!sample) continue; // 삭제·비공개 전환 — 표본 없음
          appendMetrics(s.id, sample);
          n++;
        }
        console.log('[perf-sync]', `네이버 클립 성과 ${n}/${list.length}편 수집(브랜드 '${slug || '범용'}')`);
      } catch (e) {
        console.log('[perf-sync]', `네이버 클립 성과 수집 실패(무해, 브랜드 '${slug || '범용'}'): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    console.log('[perf-sync]', `네이버 클립 성과 수집 실패(무해): ${e instanceof Error ? e.message : String(e)}`);
  }
}
