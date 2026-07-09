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
