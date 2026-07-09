/**
 * 카드뉴스 메타(인스타·페북) 발행 — 브랜드별 계정(META_TOKENS)으로 ①FB 페이지 미공개 사진
 * 업로드(바이너리) ②그 CDN URL 로 IG 캐러셀 발행 ③같은 사진으로 FB 피드 게시.
 * IG API 는 공개 image_url 만 받으므로 FB CDN 을 재사용(외부 호스팅 무의존, 스펙 §6).
 * Node 내장 fetch/FormData 만 사용. 명시 실패 반환 — 사용자 트리거 액션(fail-open 아님).
 * 부분 성공 멱등: existing 에 있는 채널은 스킵. 토큰은 로그·에러에 싣지 않는다.
 */
import fs from 'node:fs';
import { getMetaAccount } from '../secrets/store';

export const GRAPH = 'https://graph.facebook.com/v23.0';

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

/** FB 사진 images 배열에서 최대 해상도 URL(첫 항목 = 최대, 순수). */
export function pickPhotoUrl(json: unknown): string | null {
  const imgs = (json as { images?: Array<{ source?: unknown }> } | null)?.images;
  const src = Array.isArray(imgs) ? imgs[0]?.source : undefined;
  return typeof src === 'string' && src ? src : null;
}

/** IG 미디어 {permalink} 추출(순수). */
export function parsePermalink(json: unknown): string | null {
  const p = (json as { permalink?: unknown } | null)?.permalink;
  return typeof p === 'string' && p ? p : null;
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

/** FB 페이지에 미공개 사진 업로드(바이너리) → photoId. */
async function uploadUnpublishedPhoto(pageId: string, token: string, filePath: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append('source', new Blob([fs.readFileSync(filePath)], { type: 'image/png' }), 'slide.png');
  form.append('published', 'false');
  form.append('access_token', token);
  const j = await graphJson(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: form, signal }, 'FB 사진 업로드');
  const id = extractId(j);
  if (!id) throw new Error('FB 사진 업로드 응답 이형(id 없음)');
  return id;
}
/** 캐러셀 컨테이너 처리 대기 — FINISHED 까지 3초×10회 폴링. */
async function waitContainer(containerId: string, token: string, signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < 10; i++) {
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
  existing?: { igPermalink?: string; fbPostId?: string }; signal?: AbortSignal;
}): Promise<MetaPublishResult> {
  const out: MetaPublishResult = { ok: false };
  try {
    const acct = getMetaAccount(opts.slug);
    if (!acct.pageId || !acct.igUserId || !acct.pageAccessToken) {
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

    // ① FB 미공개 사진 업로드 — IG(CDN URL)·FB(attached_media) 양쪽의 재료(순서 보존).
    const photoIds: string[] = [];
    for (const p of opts.slidePaths) photoIds.push(await uploadUnpublishedPhoto(acct.pageId, token, p, signal));

    // ② IG 캐러셀 — 기발행(existing.igPermalink)이면 스킵(부분 성공 재시도 멱등).
    if (!opts.existing?.igPermalink) {
      const childIds: string[] = [];
      for (const phId of photoIds) {
        // CDN URL 은 서명 만료가 있어 저장·재사용 금지 — 획득 즉시 컨테이너 생성(스펙 §6).
        const cdn = pickPhotoUrl(await graphJson(`${GRAPH}/${phId}?fields=images&${tokenQs(token)}`, { signal }, 'FB 사진 URL 조회'));
        if (!cdn) throw new Error('FB 사진 CDN URL 없음');
        const child = await graphJson(`${GRAPH}/${acct.igUserId}/media`, {
          method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ image_url: cdn, is_carousel_item: 'true', access_token: token }),
        }, 'IG 자식 컨테이너');
        const cid = extractId(child);
        if (!cid) throw new Error('IG 자식 컨테이너 응답 이형');
        childIds.push(cid);
      }
      const carousel = await graphJson(`${GRAPH}/${acct.igUserId}/media`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ media_type: 'CAROUSEL', children: childIds.join(','), caption: message, access_token: token }),
      }, 'IG 캐러셀 컨테이너');
      const carId = extractId(carousel);
      if (!carId) throw new Error('IG 캐러셀 컨테이너 응답 이형');
      await waitContainer(carId, token, signal);
      const pub = await graphJson(`${GRAPH}/${acct.igUserId}/media_publish`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: carId, access_token: token }),
      }, 'IG 발행');
      out.igMediaId = extractId(pub) ?? undefined;
      if (!out.igMediaId) throw new Error('IG 발행 응답 이형(id 없음)');
      if (out.igMediaId) {
        const perma = await graphJson(`${GRAPH}/${out.igMediaId}?fields=permalink&${tokenQs(token)}`, { signal }, 'IG 퍼머링크').catch(() => null);
        out.igPermalink = (perma === null ? null : parsePermalink(perma)) ?? `https://www.instagram.com/`;
      }
    }

    // ③ FB 피드 게시 — 기발행(existing.fbPostId)이면 스킵.
    if (!opts.existing?.fbPostId) {
      const feed = await graphJson(`${GRAPH}/${acct.pageId}/feed`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          message,
          attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))),
          access_token: token,
        }),
      }, 'FB 피드 게시');
      out.fbPostId = extractId(feed) ?? undefined;
      if (!out.fbPostId) throw new Error('FB 피드 응답 이형(id 없음)');
    }

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
