/**
 * 유튜브 채널 정리(2026-10-15 사장님 결정) — 재생목록 자동 구성 + 옛 영상 카테고리 맞추기.
 *
 * 재생목록이 하나도 없어 채널 홈(90일 유입 2,294회)에서 187편이 시간순으로만 보였다. 영상마다
 * 작업 재생목록 하나(가지치기·병충해·심기·관리·꽃열매·구별)와, 5편 이상 쌓인 수종이면 수종 재생목록 하나에 넣는다.
 * 꽃·화분·채소처럼 나무 채널과 거리가 먼 7월 초기 편은 작업 재생목록에 넣지 않는다(treeish).
 *
 * 카테고리: 업로드가 '22 인물/블로그'로 고정돼 있었다 → 26 노하우/스타일(CONFIG.youtubeCategoryId). 새 업로드는
 * 업로드 코드가, 옛 영상은 여기서 videos.update 로 바꾼다.
 *
 * 쿼터가 제약이다: playlists.insert·playlistItems.insert·videos.update 가 각 50단위, 하루 한도 10,000 에서 업로드가
 * 편당 ~1,600 을 쓴다. 그래서 하루 예산(CONFIG.ytMaintDailyUnits)만큼만 하고 나머지는 다음 날 이어서 한다(성과 동기화 잡).
 * 멱등: 재생목록은 제목으로 찾아 재사용하고, 넣기 전에 재생목록의 현재 영상 목록을 본다 — 다시 돌려도 중복이 안 생긴다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { youtubeAccessToken } from './youtubeUpload';
import { speciesInText } from '../content/speciesRotation';
import { findSpeciesLoose } from '../content/species';
import type { SpeciesGroup } from '../content/speciesRotation';

const API = 'https://www.googleapis.com/youtube/v3';
const COST_WRITE = 50;
export const SPECIES_PLAYLIST_MIN = 5;

export interface TopicPlaylist { key: string; title: string; description: string; re: RegExp }

/** 작업 재생목록 — 위에서부터 먼저 맞는 하나만(영상당 1개, 쿼터 절약). 제목은 검색어 그대로(채널 키워드 조사 2026-10-15). */
export const TOPIC_PLAYLISTS: readonly TopicPlaylist[] = [
  {
    key: 'symptom', title: '나무 병충해·증상 진단 — 열매 안 열릴 때',
    description: '잎이 마르거나 하얘질 때, 꽃이 안 피고 열매가 안 열릴 때 — 증상부터 원인을 좁혀 봅니다.',
    re: /병충해|깍지벌레|벌레|곰팡이|흰가루|진딧물|잎마름|황색화|일소|추위 피해|피해 회복|안 피는|안 달리|안 열리|안열리|열매 없|열매가 없|열매 적|잎이 안 나|병일까|원인|상처|하얗다면|비면|죽은|부족|진단/,
  },
  {
    key: 'prune', title: '과일나무 가지치기·전정 시기 모음',
    description: '수종별 가지치기(전지·전정) 시기와 자를 곳을 1분 안에 정리합니다.',
    re: /가지치기|전정|전지|자르|잘라|자른|끊어내|가지 정리|순지르기/,
  },
  {
    key: 'plant', title: '묘목 고르기·심는 시기·옮겨심기',
    description: '좋은 묘목 고르는 법, 심는 시기와 자리, 옮겨심기·삽목까지.',
    re: /묘목|모종|심기|심는|심을|심어|심으면|심고|식재|이식|옮겨|옮깁|삽목|꽂아|접붙이|접목|결실주|개화주|고르는 법|고르기|선별|판별|선택|품종|라벨|활착|조경수|추천|자리 간격|배치 간격|울타리|그루 ?수/,
  },
  {
    key: 'care', title: '나무 물주기·거름·월동 관리',
    description: '계절마다 지금 할 일 — 물주기, 거름 주는 시기, 멀칭과 겨울나기.',
    re: /물주기|물 주|물은|물 더|물부터|물 줄이|급수|거름|비료|시비|퇴비|월동|겨울 나기|겨울 자리|멀칭|과습|통풍|상토|배양토|제초매트|보호대|지주|관리/,
  },
  {
    key: 'lore', title: '나무 종류 구별법·나무 이야기',
    description: '잎 한 장으로 구별하는 법, 이름과 상징에 얽힌 나무 이야기.',
    re: /구별|구분|종류|이름이|이름은|상징|사연|자생지|꽃말|국화|궁궐|절 마당|향,|향이|차이/,
  },
  {
    key: 'fruit', title: '꽃눈·열매·수확 시기',
    description: '꽃눈 보는 법, 개화 시기, 열매가 익는 신호와 수확 시기.',
    re: /수확|열매|꽃눈|개화|꽃 색|꽃,|꽃 |꽃이|끝물|낙과|씨앗/,
  },
];

/** 수종 재생목록 제목(수종명 → 제목). 찾기도 이 제목으로 한다 — 바꾸면 새 재생목록이 생긴다. */
export const speciesPlaylistTitle = (name: string): string => `${name} 키우기 — 심기·가지치기·관리 모음`;

const TREEISH = /나무|묘목|유실수|과실|과수|정원|조경|전정|낙엽수|활엽수|침엽수|울타리/;

export interface PlaylistItemInput { videoId: string; keyword?: string; title?: string; topic?: string }

/** 영상 → 작업 재생목록 키(순수). 나무 채널과 먼 편(수종도 나무 낱말도 없음)은 null. */
export function topicOf(text: string, species: string | null): string | null {
  if (!species && !TREEISH.test(text)) return null;
  return TOPIC_PLAYLISTS.find((p) => p.re.test(text))?.key ?? null;
}

/** 영상 → 수종(순수, 카탈로그 정식명 우선 · 없으면 느슨한 사전 매칭). */
export function speciesOf(text: string, catalog: SpeciesGroup[] | undefined, loose: (t: string) => string | null = (t) => findSpeciesLoose(t)?.name ?? null): string | null {
  return speciesInText(text, catalog) ?? loose(text);
}

export interface Membership { videoId: string; keys: string[] }
export interface PlaylistPlan { members: Membership[]; titles: Record<string, string>; descriptions: Record<string, string> }

/**
 * 영상 묶음 → 재생목록 배정(순수). 키는 'topic:prune'·'species:감나무'. 수종은 min 편 이상일 때만 재생목록을 만든다
 * — 1~2편짜리 재생목록이 채널 홈을 어지럽히지 않게. 수종이 나중에 min 에 닿으면 그날 생기고 옛 편도 채워진다.
 */
export function planPlaylists(
  items: readonly PlaylistItemInput[], catalog: SpeciesGroup[] | undefined, min = SPECIES_PLAYLIST_MIN,
  loose?: (t: string) => string | null,
): PlaylistPlan {
  const rows = items.map((it) => {
    const text = `${it.keyword ?? ''} ${it.title ?? it.topic ?? ''}`.trim();
    const sp = speciesOf(text, catalog, loose);
    return { videoId: it.videoId, sp, topic: topicOf(text, sp) };
  });
  const count = new Map<string, number>();
  for (const r of rows) if (r.sp) count.set(r.sp, (count.get(r.sp) ?? 0) + 1);
  const titles: Record<string, string> = {}; const descriptions: Record<string, string> = {};
  for (const p of TOPIC_PLAYLISTS) { titles[`topic:${p.key}`] = p.title; descriptions[`topic:${p.key}`] = p.description; }
  const members: Membership[] = [];
  for (const r of rows) {
    const keys: string[] = [];
    if (r.topic) keys.push(`topic:${r.topic}`);
    if (r.sp && (count.get(r.sp) ?? 0) >= min) {
      const k = `species:${r.sp}`;
      keys.push(k);
      titles[k] = speciesPlaylistTitle(r.sp);
      descriptions[k] = `${r.sp} 심는 시기, 가지치기, 물·거름, 증상까지 — 비온디트리 ${r.sp} 영상 모음.`;
    }
    if (keys.length) members.push({ videoId: r.videoId, keys });
  }
  // 실제로 쓰이는 키만 남긴다(빈 작업 재생목록을 만들지 않게).
  const used = new Set(members.flatMap((m) => m.keys));
  for (const k of Object.keys(titles)) if (!used.has(k)) { delete titles[k]; delete descriptions[k]; }
  return { members, titles, descriptions };
}

/** 하루 예산 장부(순수) — 쓰기 한 번(50) 할 여유가 있으면 차감하고 true. */
export class QuotaBudget {
  constructor(public remaining: number) {}
  take(units = COST_WRITE): boolean { if (this.remaining < units) return false; this.remaining -= units; return true; }
}

// ── API(부작용) ─────────────────────────────────────────────────────────────

class QuotaStop extends Error {}

async function yt(token: string, method: 'GET' | 'POST' | 'PUT', pathQ: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const r = await fetch(`${API}${pathQ}`, {
    method, signal,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => ({})) as { error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> } };
  if (r.ok && !j.error) return j;
  const reason = j.error?.errors?.[0]?.reason ?? '';
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(reason)) throw new QuotaStop(reason);
  throw new Error(`${j.error?.code ?? r.status} ${reason || (j.error?.message ?? '').slice(0, 120)}`);
}

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

async function listMyPlaylists(token: string, signal?: AbortSignal): Promise<Map<string, string>> {
  const byTitle = new Map<string, string>();
  let page = '';
  do {
    const j = await yt(token, 'GET', `/playlists?part=snippet&mine=true&maxResults=50${page ? `&pageToken=${page}` : ''}`, undefined, signal);
    for (const p of j.items ?? []) byTitle.set(String(p.snippet?.title ?? ''), String(p.id));
    page = j.nextPageToken ?? '';
  } while (page);
  return byTitle;
}

async function listPlaylistVideos(token: string, playlistId: string, signal?: AbortSignal): Promise<Set<string>> {
  const ids = new Set<string>();
  let page = '';
  do {
    const j = await yt(token, 'GET', `/playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=50${page ? `&pageToken=${page}` : ''}`, undefined, signal);
    for (const it of j.items ?? []) ids.add(String(it.contentDetails?.videoId ?? ''));
    page = j.nextPageToken ?? '';
  } while (page);
  return ids;
}

export interface MaintResult {
  createdPlaylists: string[]; added: number; recategorized: number;
  pendingAdds: number; pendingCategory: number; stoppedBy?: 'budget' | 'quota'; errors: string[];
}

/**
 * 하루치 정리 — 재생목록 만들기·채우기 → 옛 영상 카테고리. 예산이나 쿼터가 다하면 멈추고 다음 날 이어서 한다.
 * dryRun 이면 읽기만 하고(쓰기 0) 할 일 수만 센다.
 */
export async function runYoutubeMaintenance(opts: {
  slug: string; items: readonly PlaylistItemInput[]; catalog: SpeciesGroup[] | undefined;
  budgetUnits?: number; dryRun?: boolean; signal?: AbortSignal; log?: (m: string) => void;
  /** 이 영상들만 손댄다(업로드 직후 1편). 배정(수종 5편 기준)은 items 전체로 계산한다. */
  onlyVideoIds?: readonly string[];
}): Promise<MaintResult> {
  const log = opts.log ?? (() => {});
  const res: MaintResult = { createdPlaylists: [], added: 0, recategorized: 0, pendingAdds: 0, pendingCategory: 0, errors: [] };
  const budget = new QuotaBudget(opts.budgetUnits ?? CONFIG.ytMaintDailyUnits);
  const token = await youtubeAccessToken(opts.slug, opts.signal);
  const plan = planPlaylists(opts.items, opts.catalog);

  // 공개 영상만 — 지워졌거나 비공개면 재생목록에 넣지 않는다(공개되면 다음 날 들어간다). 카테고리도 같이 읽는다(50편당 1단위).
  const ids = [...new Set(opts.onlyVideoIds ?? opts.items.map((i) => i.videoId))];
  const live = new Map<string, { categoryId: string; snippet: Record<string, unknown> }>();
  for (let i = 0; i < ids.length; i += 50) {
    const j = await yt(token, 'GET', `/videos?part=snippet,status&id=${ids.slice(i, i + 50).join(',')}`, undefined, opts.signal);
    for (const v of j.items ?? []) if (v.status?.privacyStatus === 'public') live.set(String(v.id), { categoryId: String(v.snippet?.categoryId ?? ''), snippet: v.snippet ?? {} });
  }

  try {
    const existing = await listMyPlaylists(token, opts.signal);
    const want = new Map<string, string[]>(); // key → videoIds
    for (const m of plan.members) {
      if (!live.has(m.videoId)) continue;
      for (const k of m.keys) want.set(k, [...(want.get(k) ?? []), m.videoId]);
    }
    for (const [key, vids] of want) {
      const title = plan.titles[key] ?? key;
      let pid = existing.get(title);
      let fresh = false;
      if (!pid) {
        res.pendingAdds += vids.length;
        if (opts.dryRun) continue;
        if (!budget.take()) { res.stoppedBy = 'budget'; continue; }
        const j = await yt(token, 'POST', '/playlists?part=snippet,status', {
          snippet: { title, description: plan.descriptions[key] ?? '', defaultLanguage: 'ko' }, status: { privacyStatus: 'public' },
        }, opts.signal);
        pid = String(j.id); existing.set(title, pid); res.createdPlaylists.push(title); fresh = true;
        res.pendingAdds -= vids.length;
        log(`재생목록 만듦 — ${title}`);
      }
      // 방금 만든 재생목록은 비어 있다 — 바로 읽으면 반영 전이라 404 playlistNotFound(실측 2026-10-15).
      const have = fresh ? new Set<string>() : await listPlaylistVideos(token, pid, opts.signal);
      const missing = vids.filter((v) => !have.has(v));
      res.pendingAdds += missing.length;
      if (opts.dryRun) continue;
      for (const v of missing) {
        if (!budget.take()) { res.stoppedBy = 'budget'; break; }
        try {
          await yt(token, 'POST', '/playlistItems?part=snippet', { snippet: { playlistId: pid, resourceId: { kind: 'youtube#video', videoId: v } } }, opts.signal);
          res.added += 1; res.pendingAdds -= 1;
        } catch (e) {
          if (e instanceof QuotaStop) throw e;
          res.errors.push(`${title}/${v}: ${e instanceof Error ? e.message : String(e)}`);
        }
        await sleep(400); // 같은 재생목록 연속 삽입은 409/SERVICE_UNAVAILABLE 이 난다
      }
    }

    // 옛 영상 카테고리 — snippet 전체를 돌려보내야 한다(빠진 필드는 지워진다): 제목·설명·태그·언어를 그대로 싣는다.
    const target = CONFIG.youtubeCategoryId;
    const stale = [...live].filter(([, v]) => v.categoryId !== target);
    res.pendingCategory = stale.length;
    if (!opts.dryRun) {
      for (const [id, v] of stale) {
        if (!budget.take()) { res.stoppedBy = 'budget'; break; }
        const s = v.snippet as { title?: string; description?: string; tags?: string[]; defaultLanguage?: string; defaultAudioLanguage?: string };
        try {
          await yt(token, 'PUT', '/videos?part=snippet', {
            id,
            snippet: {
              title: s.title, description: s.description ?? '', categoryId: target,
              ...(s.tags ? { tags: s.tags } : {}),
              ...(s.defaultLanguage ? { defaultLanguage: s.defaultLanguage } : {}),
              ...(s.defaultAudioLanguage ? { defaultAudioLanguage: s.defaultAudioLanguage } : {}),
            },
          }, opts.signal);
          res.recategorized += 1; res.pendingCategory -= 1;
        } catch (e) {
          if (e instanceof QuotaStop) throw e;
          res.errors.push(`카테고리 ${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
        await sleep(300);
      }
    }
  } catch (e) {
    if (!(e instanceof QuotaStop)) throw e;
    res.stoppedBy = 'quota';
  }
  return res;
}

/** 서버 쪽 입력 — 이 브랜드의 유튜브에 올라간 숏폼. */
export function youtubeItemsFrom(list: ReadonlyArray<{ brand?: string; youtubeId?: string; keyword?: string; title?: string; topic?: string }>, slug: string): PlaylistItemInput[] {
  return list.filter((s) => s.youtubeId && (!s.brand || s.brand === slug))
    .map((s) => ({ videoId: s.youtubeId!, keyword: s.keyword, title: s.title, topic: s.topic }));
}

/** 진행 기록(대시보드·사후 추적용) — data/_shared/yt-maint-<slug>.json. */
export function writeMaintLog(slug: string, r: MaintResult): void {
  try {
    const f = path.join(CONFIG.dataDir, '_shared', `yt-maint-${slug}.json`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ...r }, null, 2), 'utf-8');
  } catch { /* 무해 */ }
}

/**
 * 업로드 직후 그 1편을 재생목록에 넣는다(fail-open — 업로드 결과를 바꾸지 않는다). 비공개 업로드는 공개된 뒤
 * 다음 날 정리 잡이 넣는다. 수종 재생목록이 아직 없는 수종(5편 미만)이면 작업 재생목록만.
 */
export function addUploadedToPlaylists(slug: string, videoId: string, items: readonly PlaylistItemInput[], catalog: SpeciesGroup[] | undefined): void {
  if (!CONFIG.ytPlaylists || !slug || !videoId) return;
  void runYoutubeMaintenance({ slug, items, catalog, onlyVideoIds: [videoId], budgetUnits: 300 })
    .then((r) => { if (r.added || r.createdPlaylists.length) console.log(`[발행담당] 재생목록 추가 ${r.added}건${r.createdPlaylists.length ? ` · 새 재생목록 ${r.createdPlaylists.join(', ')}` : ''}`); })
    .catch((e) => console.log(`[발행담당] 재생목록 추가 실패(무해) — ${e instanceof Error ? e.message : String(e)}`));
}
