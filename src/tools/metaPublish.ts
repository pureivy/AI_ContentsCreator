/**
 * 카드뉴스·쇼츠 메타(인스타그램) 발행 — 브랜드별 계정(META_TOKENS)으로 발행.
 * 인스타 로그인 방식(graph.instagram.com)은 공개 URL 만 받고 로컬·resumable 업로드 미지원(Meta 문서) →
 * 슬라이드 이미지·릴스 영상을 fal 스토리지 공개 URL 로 올려 image_url/video_url 로 전달([[falStorage]]).
 * 카드뉴스는 1장=단일 이미지·2~10장=캐러셀. FB 페이지 경로(피드·릴스)는 pageId 있을 때만(현재 IG 로그인은 미실행).
 * Node 내장 fetch 만 사용. 명시 실패 반환 — 사용자 트리거 액션(fail-open 아님). 토큰은 로그·에러에 싣지 않는다.
 * 멱등: 발행된 미디어 id(existing.igMediaId/igReelId)로 스킵 — 중복 공개 발행 방지. 퍼머링크는 재시도로 보강.
 */
import fs from 'node:fs';
import { getMetaAccount } from '../secrets/store';
import { uploadToFalStorage } from './falStorage';

// 인스타그램 로그인 방식(2026-07-20) — 콘텐츠 발행은 graph.instagram.com. 페이지 없음.
// FB 페이지 경로(video_reels·feed·photos)는 pageId 있을 때만 호출(현재 IG 로그인은 pageId='' → 미실행).
export const GRAPH = 'https://graph.instagram.com/v23.0';

export interface MetaPublishResult {
  ok: boolean; igMediaId?: string; igPermalink?: string; fbPostId?: string; error?: string;
}

/** IG 캡션(순수) — 본문+해시태그 줄바꿈 결합, IG 한도 2200자 캡. */
export function buildIgCaption(caption: string, hashtags: string[]): string {
  const tagLine = hashtags.filter(Boolean).join(' ');
  return [caption.trim(), tagLine].filter(Boolean).join('\n\n').slice(0, 2200);
}

/** 그래프 응답 {id} 안전 추출(순수). */
export function extractId(json: unknown): string | null {
  const id = (json as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id ? id : null;
}

/** IG 미디어 {permalink} 추출(순수). */
export function parsePermalink(json: unknown): string | null {
  const p = (json as { permalink?: unknown } | null)?.permalink;
  return typeof p === 'string' && p ? p : null;
}

/**
 * 실제 게시물 퍼머링크만 인정(순수) — 일반 홈 URL(과거 폴백 잔재)은 '미보유'로 취급해
 * 재시도가 진짜 링크로 보강하게 한다. 발행 성공 후 퍼머링크 GET 이 일시 실패해도 홈 URL 을 저장하지 않는다.
 */
export function realPermalink(p: string | null | undefined): string | undefined {
  if (!p) return undefined;
  return /^https?:\/\/(www\.)?instagram\.com\/?$/i.test(p) ? undefined : p;
}

/** 그래프 에러 → 사람이 읽을 메시지(순수, 토큰류 미포함). */
export function graphError(json: unknown, status: number): string {
  const e = (json as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  return e && typeof e.message === 'string'
    ? `${e.message}${e.code != null ? `(code ${e.code})` : ''}`.slice(0, 160)
    : `HTTP ${status}`;
}

async function graphJson(url: string, init: RequestInit, what: string): Promise<unknown> {
  const r = await fetch(url, init);
  const j: unknown = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${what} 실패: ${graphError(j, r.status)}`);
  return j;
}
const tokenQs = (token: string): string => `access_token=${encodeURIComponent(token)}`;
/** 캐러셀 컨테이너 처리 대기 — FINISHED 까지 3초×maxTries회 폴링. */
async function waitContainer(containerId: string, token: string, signal?: AbortSignal, maxTries = 10): Promise<void> {
  for (let i = 0; i < maxTries; i++) {
    const j = await graphJson(`${GRAPH}/${containerId}?fields=status_code&${tokenQs(token)}`, { signal }, '컨테이너 상태');
    const st = (j as { status_code?: string }).status_code;
    if (st === 'FINISHED') return;
    if (st === 'ERROR' || st === 'EXPIRED') throw new Error(`IG 컨테이너 처리 실패(${st})`);
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error('IG 컨테이너 처리 시간 초과 — 잠시 후 재시도하세요');
}

export async function publishCardNewsToMeta(opts: {
  slug: string; slidePaths: string[]; caption: string; hashtags: string[];
  existing?: { igMediaId?: string; igPermalink?: string; fbPostId?: string }; signal?: AbortSignal;
}): Promise<MetaPublishResult> {
  const out: MetaPublishResult = { ok: false };
  try {
    const acct = getMetaAccount(opts.slug);
    if (!acct.igUserId || !acct.pageAccessToken) {
      return { ok: false, error: '메타 미연결 — 카드뉴스 탭에서 메타 연결을 먼저 하세요' };
    }
    if (opts.slidePaths.length > 10) return { ok: false, error: `IG 캐러셀은 최대 10장(현재 ${opts.slidePaths.length}장)` };
    if (!opts.slidePaths.length || !opts.slidePaths.every((p) => fs.existsSync(p))) {
      return { ok: false, error: '슬라이드 파일 없음' };
    }
    const timeout = AbortSignal.timeout(300_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const message = buildIgCaption(opts.caption, opts.hashtags);
    const token = acct.pageAccessToken;

    // IG 발행 — 이미 발행된 미디어 id(existing.igMediaId) 있으면 스킵(중복 공개 발행 방지, 라우트가 영속).
    out.igMediaId = opts.existing?.igMediaId;
    out.igPermalink = realPermalink(opts.existing?.igPermalink);
    if (!out.igMediaId) {
      // ① 슬라이드를 fal 스토리지 공개 URL 로 올림 — 인스타 로그인은 공개 image_url 필수(로컬 업로드 미지원, Meta 문서).
      //    PNG 그대로 허용 실측. 순서 보존(슬라이드 정렬 순).
      const imageUrls: string[] = [];
      for (const p of opts.slidePaths) imageUrls.push(await uploadToFalStorage(p, 'image/png', signal));

      // ② 컨테이너 — 1장은 단일 이미지 포스트(캐러셀은 2~10장), 2장 이상은 캐러셀.
      let carId: string;
      if (imageUrls.length === 1) {
        const single = await graphJson(`${GRAPH}/me/media`, {
          method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ image_url: imageUrls[0]!, caption: message, access_token: token }),
        }, 'IG 이미지 컨테이너');
        const sid = extractId(single);
        if (!sid) throw new Error('IG 이미지 컨테이너 응답 이형');
        carId = sid;
      } else {
        const childIds: string[] = [];
        for (const url of imageUrls) {
          const child = await graphJson(`${GRAPH}/me/media`, {
            method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ image_url: url, is_carousel_item: 'true', access_token: token }),
          }, 'IG 자식 컨테이너');
          const cid = extractId(child);
          if (!cid) throw new Error('IG 자식 컨테이너 응답 이형');
          childIds.push(cid);
        }
        const carousel = await graphJson(`${GRAPH}/me/media`, {
          method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ media_type: 'CAROUSEL', children: childIds.join(','), caption: message, access_token: token }),
        }, 'IG 캐러셀 컨테이너');
        const cid = extractId(carousel);
        if (!cid) throw new Error('IG 캐러셀 컨테이너 응답 이형');
        carId = cid;
      }

      // ③ 처리 완료 대기 후 발행.
      await waitContainer(carId, token, signal);
      const pub = await graphJson(`${GRAPH}/me/media_publish`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: carId, access_token: token }),
      }, 'IG 발행');
      out.igMediaId = extractId(pub) ?? undefined;
      if (!out.igMediaId) throw new Error('IG 발행 응답 이형(id 없음)');
    }
    // 퍼머링크 보강 — 발행됐고(미디어 id) 아직 실제 링크 없으면 조회. 일시 실패 시 undefined(홈 URL 폴백 없음) → 다음 재시도가 채움.
    if (out.igMediaId && !out.igPermalink) {
      const perma = await graphJson(`${GRAPH}/${out.igMediaId}?fields=permalink&${tokenQs(token)}`, { signal }, 'IG 퍼머링크').catch(() => null);
      out.igPermalink = realPermalink(perma ? parsePermalink(perma) : null);
    }
    // FB 피드 게시는 인스타 로그인 방식(페이지 없음)에선 불가 — 제거(과거 FB 페이지 경로는 pageId 있을 때만 유효했음).

    out.ok = true;
    return out;
  } catch (e) {
    // 채널별 부분 성공은 out 에 남아 있음 — 라우트가 성공분을 저장하고 실패 원인만 보고(성공 위장 금지).
    out.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    // 발행 한도 도달 힌트(스펙 §6) — 메타 에러 문구에 limit 이 보이면 확인 경로 안내.
    if (/limit/i.test(out.error)) out.error += ' — 24시간 발행 한도(100건) 가능성: GET /{ig-user-id}/content_publishing_limit 로 확인';
    return out;
  }
}

// ── 쇼츠 릴스 발행 ───────────────────────────────────────────────────────────
// IG(인스타 로그인)는 공개 video_url 필요 → fal 스토리지 경유. FB 는 video_reels 3단계(start→binary→finish, pageId 있을 때만).
// 릴스는 발행 즉시 공개(비공개·초안 없음, 스펙 §3) — 버튼 클릭=공개 발행 정책.

export interface MetaReelsResult {
  ok: boolean; igReelId?: string; igPermalink?: string; fbReelId?: string; error?: string;
}

/** 업로드 URI 에 영상 바이너리 POST(IG rupload·FB upload_url 공통 규약) — {success:true} 아니면 throw. */
async function uploadVideoBinary(uploadUrl: string, token: string, videoPath: string, what: string, signal?: AbortSignal): Promise<void> {
  const buf = fs.readFileSync(videoPath);
  const r = await fetch(uploadUrl, {
    method: 'POST', signal,
    headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(buf.byteLength), 'Content-Type': 'application/octet-stream' },
    body: buf,
  });
  const j: unknown = await r.json().catch(() => ({}));
  if (!r.ok || !(j as { success?: boolean }).success) throw new Error(`${what} 실패: ${graphError(j, r.status)}`);
}

/** FB 릴스 3단계 — start(video_id·upload_url) → 바이너리 → finish(PUBLISHED). video_id 반환. */
async function publishFbReel(pageId: string, token: string, videoPath: string, description: string, signal?: AbortSignal): Promise<string> {
  const start = await graphJson(`${GRAPH}/${pageId}/video_reels`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ upload_phase: 'start', access_token: token }),
  }, 'FB 릴스 시작') as { video_id?: string; upload_url?: string };
  if (!start.video_id || !start.upload_url) throw new Error('FB 릴스 시작 응답 이형');
  await uploadVideoBinary(start.upload_url, token, videoPath, 'FB 릴스 업로드', signal);
  const fin = await graphJson(`${GRAPH}/${pageId}/video_reels`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description, access_token: token }),
  }, 'FB 릴스 발행') as { success?: boolean };
  if (!fin.success) throw new Error('FB 릴스 발행 응답 이형(success 없음)');
  return start.video_id;
}

export async function publishShortsToMeta(opts: {
  slug: string; videoPath: string; caption: string; hashtags: string[];
  existing?: { igReelId?: string; igPermalink?: string; fbReelId?: string }; signal?: AbortSignal;
}): Promise<MetaReelsResult> {
  const out: MetaReelsResult = { ok: false };
  try {
    const acct = getMetaAccount(opts.slug);
    if (!acct.igUserId || !acct.pageAccessToken) {
      return { ok: false, error: '메타 미연결 — 카드뉴스/숏폼 탭에서 메타 연결을 먼저 하세요' };
    }
    if (!fs.existsSync(opts.videoPath)) return { ok: false, error: '영상 파일 없음' };
    const timeout = AbortSignal.timeout(600_000); // 영상 업로드+인코딩 — 카드뉴스(5분)의 2배 여유
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const message = buildIgCaption(opts.caption, opts.hashtags);
    const token = acct.pageAccessToken;

    // ① IG 릴스 — 이미 발행된 릴스 id(existing.igReelId) 있으면 스킵(중복 공개 발행 방지, 라우트가 영속).
    // 인스타 로그인 방식은 로컬·resumable 업로드 미지원(Meta 문서) → 영상을 fal 스토리지 공개 URL 로 올려 video_url 로 전달.
    out.igReelId = opts.existing?.igReelId;
    out.igPermalink = realPermalink(opts.existing?.igPermalink);
    if (!out.igReelId) {
      const videoUrl = await uploadToFalStorage(opts.videoPath, 'video/mp4', signal);
      const container = await graphJson(`${GRAPH}/me/media`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ media_type: 'REELS', video_url: videoUrl, caption: message, share_to_feed: 'true', access_token: token }),
      }, 'IG 릴스 컨테이너');
      const cid = extractId(container);
      if (!cid) throw new Error('IG 릴스 컨테이너 응답 이형');
      await waitContainer(cid, token, signal, 90); // 영상 다운로드+인코딩 — 3초×90회(호스티드 다운로드 여유)
      const pub = await graphJson(`${GRAPH}/me/media_publish`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: cid, access_token: token }),
      }, 'IG 릴스 발행');
      out.igReelId = extractId(pub) ?? undefined;
      if (!out.igReelId) throw new Error('IG 릴스 발행 응답 이형(id 없음)');
    }
    // 퍼머링크 보강 — 발행됐고(릴스 id) 아직 실제 링크 없으면 조회. 일시 실패 시 undefined(홈 URL 폴백 없음) → 다음 재시도가 채움.
    if (out.igReelId && !out.igPermalink) {
      const perma = await graphJson(`${GRAPH}/${out.igReelId}?fields=permalink&${tokenQs(token)}`, { signal }, 'IG 퍼머링크').catch(() => null);
      out.igPermalink = realPermalink(perma ? parsePermalink(perma) : null);
    }

    // ② FB 릴스 — 페이지 연결(pageId) 있을 때만. 인스타그램 로그인 방식은 페이지가 없어 스킵(IG 릴스만).
    if (acct.pageId && !opts.existing?.fbReelId) {
      try {
        out.fbReelId = await publishFbReel(acct.pageId, token, opts.videoPath, message, signal);
      } catch (fe) {
        console.log('[meta] FB 릴스 건너뜀(IG 성공 유지) — ' + (fe instanceof Error ? fe.message.slice(0, 120) : String(fe)));
      }
    }

    out.ok = true;
    return out;
  } catch (e) {
    // 채널별 부분 성공은 out 에 남아 있음 — 라우트가 성공분을 저장하고 실패 원인만 보고(성공 위장 금지).
    out.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    if (/limit/i.test(out.error)) out.error += ' — 24시간 발행 한도 가능성: content_publishing_limit 확인';
    return out;
  }
}

export interface IgMediaItem { id: string; permalink: string; timestamp: string; caption: string; type: string; }

/**
 * 계정의 IG 미디어 목록(페이지네이션) — 재조정(reconcile)용. 발행 중 서버 재시작 등으로 로컬 영속이 유실돼도
 * 라이브 릴스를 다시 찾아 백필하기 위해 사용. 미연결이면 throw, 페이징 next 는 graph.instagram.com 호스트만 따른다.
 */
export async function listIgMedia(slug: string): Promise<IgMediaItem[]> {
  const acct = getMetaAccount(slug);
  if (!acct.igUserId || !acct.pageAccessToken) throw new Error('메타 미연결');
  const token = acct.pageAccessToken;
  const out: IgMediaItem[] = [];
  let url: string | null = `${GRAPH}/me/media?fields=id,media_type,media_product_type,permalink,timestamp,caption&limit=50&${tokenQs(token)}`;
  for (let guard = 0; url && guard < 20; guard++) {
    const j = await graphJson(url, {}, 'IG 미디어 목록') as { data?: Array<Record<string, string>>; paging?: { next?: string } };
    for (const m of j.data ?? []) {
      out.push({ id: m.id ?? '', permalink: m.permalink ?? '', timestamp: m.timestamp ?? '', caption: m.caption ?? '', type: m.media_product_type ?? m.media_type ?? '' });
    }
    const next = j.paging?.next;
    url = next && /^https:\/\/graph\.instagram\.com\//.test(next) ? next : null;
  }
  return out;
}

/**
 * 라이브 IG 릴스를 미추적 쇼츠에 매칭(순수) — 캡션이 쇼츠 제목으로 시작하면 동일 콘텐츠로 본다.
 * igReelId 이미 있는 쇼츠는 건너뛰고, 한 릴스 id 는 한 쇼츠에만 선점(중복 매칭 방지). 재조정 백필용.
 */
export function matchOrphanReels(
  shorts: Array<{ id: string; title: string; igReelId?: string }>,
  reels: Array<{ id: string; permalink: string; timestamp: string; caption: string }>,
): Array<{ shortsId: string; reelId: string; permalink: string; timestamp: string }> {
  const claimed = new Set(shorts.map((s) => s.igReelId).filter((x): x is string => !!x));
  const matches: Array<{ shortsId: string; reelId: string; permalink: string; timestamp: string }> = [];
  for (const s of shorts) {
    if (s.igReelId) continue;
    const title = s.title.trim();
    if (!title) continue;
    const m = reels.find((r) => !claimed.has(r.id) && r.caption.trim().startsWith(title));
    if (!m) continue;
    claimed.add(m.id);
    matches.push({ shortsId: s.id, reelId: m.id, permalink: m.permalink, timestamp: m.timestamp });
  }
  return matches;
}
