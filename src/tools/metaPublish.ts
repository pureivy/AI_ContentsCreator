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
  /** 행동차단(2207051) 후 최근 미디어에서 회수해 기록한 발행(발행은 됐으나 응답에 id 없던 케이스). */
  recovered?: boolean;
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

/** 그래프 에러 → 사람이 읽을 메시지(순수, 토큰류 미포함). subcode·사용자대면 제목 동봉 — 'Application
 *  request limit reached'(code 4)만으론 앱 레이트리밋과 행동차단(subcode 2207051)을 구분 못 하므로. */
export function graphError(json: unknown, status: number): string {
  const e = (json as { error?: { message?: unknown; code?: unknown; error_subcode?: unknown; error_user_title?: unknown } } | null)?.error;
  if (!e || typeof e.message !== 'string') return `HTTP ${status}`;
  const sub = e.error_subcode != null ? `, subcode ${e.error_subcode}` : '';
  const title = typeof e.error_user_title === 'string' && e.error_user_title ? ` — ${e.error_user_title}` : '';
  return `${e.message}${e.code != null ? `(code ${e.code}${sub})` : ''}${title}`.slice(0, 200);
}

/**
 * 발행 실패 힌트(순수) — 두 가지 다른 한도를 구분해 오안내 방지.
 * - code 4 'Application request limit reached' = 앱 API 레이트리밋(호출량 초과) → 일시적, 잠시 후 재시도. 발행 수 한도 아님.
 * - 그 외 'limit'(발행 quota 초과 등) = 24시간 발행 한도(quota_total, 실측 100건).
 * (graph.instagram.com 은 /me 노드 — content_publishing_limit 도 /me 경로.)
 */
export function metaLimitHint(error: string): string {
  // ① 인스타 행동 차단(게시 빈도/스팸 보호) — subcode 2207051. code 4·'request limit'로 오지만 앱 레이트리밋과
  //    다르다(is_transient=false, 게시 행동 자체 차단). 실측: 짧은 시간 다건 발행/재시도 시 발생. 회복은 수 시간~하루.
  if (/2207051|행동이 차단|action.?block/i.test(error)) {
    return ' — 인스타그램 행동 차단(게시 빈도 제한): 짧은 시간에 너무 많이 올려 일시 차단됐습니다. 수 시간~하루 후 재시도하고, 지금 반복 클릭은 금지(차단이 더 심해짐). 이미 인스타에 올라갔을 수 있으니 확인 후 재시도하세요.';
  }
  // ② 앱 API 레이트리밋 — 호출량(x-app-usage) 초과. 행동차단이 아닌 순수 code 4.
  if (/\(code 4\b|request limit reached/i.test(error)) {
    return ' — 앱 API 레이트리밋(호출량 초과, 일시적): 잠시(수십 분) 후 재시도. 발행 수 한도가 아닙니다.';
  }
  // ③ 24시간 발행 수 한도(quota_total).
  if (/limit/i.test(error)) {
    return ' — 24시간 발행 한도 가능성: 발행 quota 확인(GET /me/content_publishing_limit).';
  }
  return '';
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

/** 최근 미디어 목록에서 방금 올린 것 매칭(순수) — 캡션 프리픽스(24자)+미디어 타입 일치+nowMs 기준 3분 이내. */
export function matchRecentPublish(
  posts: Array<{ id?: string; caption?: string; timestamp?: string; media_type?: string }>,
  caption: string, mediaType: string, nowMs: number,
): string | null {
  const head = caption.replace(/\s+/g, ' ').trim().slice(0, 24);
  if (head.length < 8) return null; // 프리픽스 너무 짧으면 오매칭 위험 → 포기
  for (const p of posts) {
    if (!p.id || !p.caption || !p.timestamp || p.media_type !== mediaType) continue;
    if (nowMs - new Date(p.timestamp).getTime() > 3 * 60_000) continue; // 3분 이내만
    if (p.caption.replace(/\s+/g, ' ').trim().startsWith(head)) return p.id;
  }
  return null;
}

/**
 * 행동차단(subcode 2207051)은 발행을 처리하고도 403(응답에 id 없음)을 반환할 수 있다(실측 2026-07-24: 카드/릴스당
 * 정확히 1건만 게시 — 중복 아님). 그 경우 최근 내 미디어에서 방금 올린 것을 회수해 id 를 돌려준다 — '발행됐는데 미기록'
 * 으로 버튼이 안 바뀌고 재시도 중복을 유발하던 것을 막는다. 실패 시 null(원래 에러 유지).
 */
async function recoverPublishedId(token: string, caption: string, mediaType: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const j = await graphJson(`${GRAPH}/me/media?fields=id,caption,timestamp,media_type&limit=5&${tokenQs(token)}`, { signal }, '최근 미디어');
    const posts = (j as { data?: Array<{ id?: string; caption?: string; timestamp?: string; media_type?: string }> }).data ?? [];
    return matchRecentPublish(posts, caption, mediaType, Date.now());
  } catch { return null; }
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
      try {
        const pub = await graphJson(`${GRAPH}/me/media_publish`, {
          method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ creation_id: carId, access_token: token }),
        }, 'IG 발행');
        out.igMediaId = extractId(pub) ?? undefined;
      } catch (e) {
        // 행동차단(2207051)은 발행을 처리하고도 403(id 없음)을 반환할 수 있다 — 방금 올린 게시물을 회수해 기록.
        if (/2207051|행동이 차단/i.test(e instanceof Error ? e.message : String(e))) {
          const rec = await recoverPublishedId(token, message, imageUrls.length === 1 ? 'IMAGE' : 'CAROUSEL_ALBUM', signal);
          if (rec) { out.igMediaId = rec; out.recovered = true; }
        }
        if (!out.igMediaId) throw e; // 회복 못 하면 원래 에러(메시지 힌트 유지)
      }
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
    // 한도 힌트(스펙 §6) — 앱 레이트리밋(code 4)과 24h 발행 한도를 구분해 오안내 방지.
    out.error += metaLimitHint(out.error);
    return out;
  }
}

// ── 쇼츠 릴스 발행 ───────────────────────────────────────────────────────────
// IG(인스타 로그인)는 공개 video_url 필요 → fal 스토리지 경유. FB 는 video_reels 3단계(start→binary→finish, pageId 있을 때만).
// 릴스는 발행 즉시 공개(비공개·초안 없음, 스펙 §3) — 버튼 클릭=공개 발행 정책.

export interface MetaReelsResult {
  ok: boolean; igReelId?: string; igPermalink?: string; fbReelId?: string; error?: string;
  /** 행동차단(2207051) 후 최근 미디어에서 회수해 기록한 발행. */
  recovered?: boolean;
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
  slug: string; videoPath: string; caption: string; hashtags: string[]; thumbnailPath?: string;
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
      // 디자인 썸네일이 있으면 릴스 커버로 지정(cover_url = fal 공개 이미지 URL). 없거나 실패하면 IG 가 영상 프레임으로 자동.
      let coverUrl: string | null = null;
      if (opts.thumbnailPath && fs.existsSync(opts.thumbnailPath)) {
        try { coverUrl = await uploadToFalStorage(opts.thumbnailPath, 'image/jpeg', signal); }
        catch { coverUrl = null; }
      }
      const body = new URLSearchParams({ media_type: 'REELS', video_url: videoUrl, caption: message, share_to_feed: 'true', access_token: token });
      if (coverUrl) body.set('cover_url', coverUrl);
      const container = await graphJson(`${GRAPH}/me/media`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }, 'IG 릴스 컨테이너');
      const cid = extractId(container);
      if (!cid) throw new Error('IG 릴스 컨테이너 응답 이형');
      await waitContainer(cid, token, signal, 90); // 영상 다운로드+인코딩 — 3초×90회(호스티드 다운로드 여유)
      try {
        const pub = await graphJson(`${GRAPH}/me/media_publish`, {
          method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ creation_id: cid, access_token: token }),
        }, 'IG 릴스 발행');
        out.igReelId = extractId(pub) ?? undefined;
      } catch (e) {
        // 행동차단(2207051)은 릴스도 발행하고 403(id 없음)을 반환할 수 있다 — 방금 올린 영상을 회수해 기록.
        if (/2207051|행동이 차단/i.test(e instanceof Error ? e.message : String(e))) {
          const rec = await recoverPublishedId(token, message, 'VIDEO', signal);
          if (rec) { out.igReelId = rec; out.recovered = true; }
        }
        if (!out.igReelId) throw e;
      }
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
    out.error += metaLimitHint(out.error);
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
