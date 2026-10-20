/**
 * 유튜브 쇼츠 기획 참고(2026-10-20 사장님 "참고만") — 같은 소재의 유튜브 쇼츠 조회 상위(제목·조회수)를 작가에게 보여 준다.
 * 주제 선정·기각에는 쓰지 않는다. search.list 가 101유닛이라 키워드당 하루 1회만 부르고 디스크에 캐시한다
 * (빈 결과도 캐시 — 같은 날 재실행·수정 요청이 쿼터를 다시 쓰지 않게). 전량 fail-open.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { activeBrandSlug, brandFileSuffixFor } from '../content/brand';
import { youtubeShortsTop } from '../grounding/youtube';

export interface ShortsRefVideo { title: string; views: number; durationSec: number }
interface RefEntry { ts: string; videos: ShortsRefVideo[] }
interface RefCache { date: string; entries: Record<string, RefEntry> }

const PRUNE_DAYS = 14;

function cachePath(slug?: string): string {
  const s = slug ?? activeBrandSlug();
  return path.join(CONFIG.dataDir, 'topics', `yt-shorts-ref${brandFileSuffixFor(s || undefined)}.json`);
}

function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const normKeyword = (kw: string): string => kw.trim().replace(/\s+/g, ' ').toLowerCase();

function readCache(f: string): RefCache {
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf-8')) as RefCache;
    if (raw && typeof raw.date === 'string' && raw.entries && typeof raw.entries === 'object') return raw;
  } catch { /* 없음·손상 → 빈 캐시 */ }
  return { date: '', entries: {} };
}

/** 키워드의 쇼츠 조회 상위 — 오늘 캐시가 있으면 API 없이 반환. 실패 시 []. */
export async function getShortsRef(keyword: string, slug?: string, signal?: AbortSignal, now = new Date()): Promise<ShortsRefVideo[]> {
  const kw = normKeyword(keyword);
  if (!kw) return [];
  try {
    const f = cachePath(slug);
    const cache = readCache(f);
    const today = localDateStr(now);
    const hit = cache.entries[kw];
    if (hit && localDateStr(new Date(hit.ts)) === today) return hit.videos;
    const videos = (await youtubeShortsTop(kw, signal)).map((v) => ({ title: v.title.slice(0, 80), views: v.views, durationSec: v.durationSec }));
    const cutoff = now.getTime() - PRUNE_DAYS * 86_400_000;
    const entries: Record<string, RefEntry> = {};
    for (const [k, e] of Object.entries(cache.entries)) if (new Date(e.ts).getTime() >= cutoff) entries[k] = e;
    entries[kw] = { ts: now.toISOString(), videos };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, JSON.stringify({ date: today, entries } satisfies RefCache, null, 2), 'utf-8');
    fs.renameSync(`${f}.tmp`, f);
    return videos;
  } catch { return []; }
}

/** 작가 주입 블록(순수, 테스트 대상). 영상 없으면 ''. */
export function buildShortsRefBlock(keyword: string, videos: ShortsRefVideo[], date = localDateStr()): string {
  if (!videos.length) return '';
  const fmt = (n: number): string => n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : String(n);
  const lines = videos.map((v) => `- "${v.title}"(${fmt(v.views)}회)`);
  return `[같은 소재 유튜브 쇼츠 — 조회 상위(${date} 수집, 검색어 "${keyword.trim()}")]\n${lines.join('\n')}\n` +
    '참고 지침: 여러 편에 공통으로 쓰인 낱말·각도(질문형·결과 공개·비교 등)만 참고하라. 제목·문장을 베끼지 마라. 우리 원문 사실 밖의 내용은 쓰지 마라.';
}
