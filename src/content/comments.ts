/**
 * 댓글 담당(2026-10-25 사장님 요청) — 블로그·클립·유튜브·인스타에 달린 새 댓글과 답글 초안을 담는 저장소.
 * 답글은 텔레그램 [올리기] 버튼을 눌러야만 올라간다(블로그 잠금 원칙 — 에이전트는 네이버에 직접 쓰지 않는다).
 *
 * data/comments/index.json 하나에 상태를 둔다(원자적 교체). 같은 댓글(채널+댓글 번호)은 한 번만 담는다 —
 * 재시작해도 같은 댓글로 텔레그램을 다시 보내지 않게.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../config';
import { genId } from '../util/ids';
import { readJsonFile, writeJsonAtomic } from '../util/jsonStore';

export type CommentPlatform = 'blog' | 'clip' | 'youtube' | 'instagram';
export const COMMENT_PLATFORMS: readonly CommentPlatform[] = ['blog', 'clip', 'youtube', 'instagram'];
export const COMMENT_PLATFORM_LABEL: Record<CommentPlatform, string> = { blog: '블로그', clip: '네이버 클립', youtube: '유튜브', instagram: '인스타' };

/** 플랫폼에서 읽어 온 댓글 한 개(최상위 댓글만 — 대댓글은 답할 대상이 아니다). */
export interface FoundComment {
  platform: CommentPlatform;
  /** 답글을 달 대상 댓글 번호(유튜브 댓글 id·인스타 댓글 id·네이버 commentNo). */
  externalId: string;
  author: string;
  text: string;
  commentTs: string;
  /** 댓글이 달린 글·영상 — 유튜브 videoId · 인스타 미디어 id · 블로그 `blogId/logNo` · 클립 mediaId. */
  targetId: string;
  targetUrl?: string;
  /** 플랫폼이 알려 주는 제목·설명 첫 줄(우리 기록과 못 맞출 때 쓴다). */
  targetTitle?: string;
  /** 우리(채널 주인)가 쓴 댓글. */
  own: boolean;
  /** 우리가 이미 답글을 달았다. */
  answered: boolean;
}

export type CommentStatus = 'pending' | 'posting' | 'posted' | 'skipped' | 'failed';

export interface CommentItem extends Omit<FoundComment, 'own' | 'answered'> {
  id: string;
  brand: string;
  /** 우리 쪽 원본 — 답글 초안의 근거(대본·본문)를 여기서 읽는다. */
  contentRef?: { kind: 'short' | 'longform' | 'card' | 'piece'; id: string };
  contentTitle: string;
  draft: string;
  /** 본문에 근거가 없거나 구매·가격 문의라 사장님 확인이 필요한 이유. */
  needsCheck?: string;
  status: CommentStatus;
  createdTs: string;
  updatedTs?: string;
  notifiedTs?: string;
  postedTs?: string;
  postedText?: string;
  error?: string;
  revisions?: number;
}

export interface CommentState {
  items: CommentItem[];
  /** 채널별 기준 시각 — 이보다 먼저 달린 댓글은 담지 않는다(처음 켤 때 옛 댓글이 한꺼번에 오지 않게). */
  since: Partial<Record<CommentPlatform, string>>;
  /** 글·클립별 마지막으로 본 댓글 수(`blog:logNo`·`clip:mediaId` → 수) — 늘어난 것만 댓글을 연다. */
  counts?: Record<string, number>;
  /** 블로그 id → 네이버 내부 blogNo(댓글 상자 주소에 필요). */
  blogNo?: Record<string, string>;
  /** 클립 채널 이름(@handle) → 클립 프로필 id. */
  clipProfileId?: Record<string, string>;
  /** 인스타 댓글 권한이 없다고 알린 시각(하루 한 번만). */
  igScopeAlertTs?: string;
  /** 한 번이라도 담은 댓글 키(`platform:externalId`) — items 를 보관 상한으로 버린 뒤에도 같은 댓글을 다시 담지 않게. */
  seen?: string[];
}

/** 처음 켤 때 거슬러 올라가 담는 기간 — 이틀 안의 답 안 한 댓글은 담는다. */
export const COMMENT_BACKFILL_MS = 2 * 24 * 3600_000;
/** 보관 상한 — 오래된 처리 완료 항목부터 버린다. */
const MAX_ITEMS = 600;
/** 담은 댓글 키 보관 상한(키만이라 가볍다). */
const MAX_SEEN = 5000;

function defaultFile(): string {
  return process.env.VITEST
    ? path.join(os.tmpdir(), `comments-vitest-${process.pid}.json`)
    : path.join(CONFIG.dataDir, 'comments', 'index.json');
}

/** 읽기 — 없으면 빈 상태. 깨졌으면(2026-10-26) .corrupt-<시각> 으로 옮기고 빈 상태를 주되 이번 실행 동안 저장은 막힌다
 *  (종전엔 빈 상태로 읽혀 다음 저장이 담은 댓글·본 댓글 키를 다 덮어, 이미 답한 댓글이 다시 담겼다). */
export function loadCommentState(file = defaultFile()): CommentState {
  const r = readJsonFile<Partial<CommentState>>(file, '댓글(comments)', (v) => !!v && typeof v === 'object' && !Array.isArray(v));
  const j = r.value ?? {};
  return { ...j, items: Array.isArray(j.items) ? j.items : [], since: j.since ?? {} };
}

/** 저장 — 실패하면 던진다. 올리기 잠금(posting)이 디스크에 안 남은 채 진행되면 두 번 누를 때 두 번 올라간다(검토 2026-10-25).
 *  깨진 색인이면 저장이 거부돼 던지므로 올리기(claimForPost)도 '기록을 저장하지 못해 올리지 않았습니다'로 멈춘다(fail-closed). */
export function saveCommentState(s: CommentState, file = defaultFile()): void {
  writeJsonAtomic(file, s, { backup: true });
}

const keyOf = (p: CommentPlatform, externalId: string): string => `${p}:${externalId}`;

/**
 * 새로 담을 댓글 고르기(순수) — 우리 댓글·이미 답한 댓글·기준 시각 이전·이미 담은 댓글은 뺀다.
 * since 가 없는 채널은 now - COMMENT_BACKFILL_MS 를 기준으로 삼는다(첫 주기).
 */
export function pickNewComments(found: readonly FoundComment[], s: Pick<CommentState, 'items' | 'since' | 'seen'>, now = new Date()): FoundComment[] {
  const seen = new Set([...s.items.map((i) => keyOf(i.platform, i.externalId)), ...(s.seen ?? [])]);
  const out: FoundComment[] = [];
  for (const f of found) {
    if (f.own || f.answered || !f.text.trim()) continue;
    const since = s.since[f.platform] ?? new Date(now.getTime() - COMMENT_BACKFILL_MS).toISOString();
    const t = Date.parse(f.commentTs);
    if (!Number.isFinite(t) || t <= Date.parse(since)) continue;
    const k = keyOf(f.platform, f.externalId);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out.sort((a, b) => a.commentTs.localeCompare(b.commentTs));
}

/** 담기 — 초안까지 붙은 항목을 상태에 넣는다(보관 상한 넘으면 처리 끝난 옛 항목부터 버림). */
export function addCommentItem(s: CommentState, f: FoundComment, extra: { brand: string; contentRef?: CommentItem['contentRef']; contentTitle: string; draft: string; needsCheck?: string; status?: CommentStatus }, now = new Date()): CommentItem {
  const { own: _own, answered: _answered, ...base } = f;
  const item: CommentItem = {
    ...base, id: genId('cmt'), brand: extra.brand, contentRef: extra.contentRef, contentTitle: extra.contentTitle,
    draft: extra.draft, needsCheck: extra.needsCheck || undefined, status: extra.status ?? 'pending', createdTs: now.toISOString(),
  };
  s.items.push(item);
  s.seen = [...(s.seen ?? []), keyOf(f.platform, f.externalId)].slice(-MAX_SEEN);
  if (s.items.length > MAX_ITEMS) {
    const done = s.items.filter((i) => i.status !== 'pending' && i.status !== 'posting');
    const drop = new Set(done.slice(0, s.items.length - MAX_ITEMS).map((i) => i.id));
    s.items = s.items.filter((i) => !drop.has(i.id));
  }
  return item;
}

/** 읽고-고치고-쓰기를 await 없이 한 번에 — 주기 작업과 버튼 라우트가 서로의 변경을 덮어쓰지 않게. */
export function mutateCommentState<T>(fn: (s: CommentState) => T, file = defaultFile()): T {
  const s = loadCommentState(file);
  const out = fn(s);
  saveCommentState(s, file);
  return out;
}

/** 한 항목 고치기(파일에서 읽고 바로 씀) — 없으면 undefined. */
export function updateCommentItem(id: string, patch: Partial<CommentItem>, file = defaultFile(), now = new Date()): CommentItem | undefined {
  const s = loadCommentState(file);
  const i = s.items.findIndex((x) => x.id === id);
  if (i < 0) return undefined;
  const next = { ...s.items[i]!, ...patch, id, updatedTs: now.toISOString() };
  s.items[i] = next;
  saveCommentState(s, file);
  return next;
}

export function getCommentItem(id: string, file = defaultFile()): CommentItem | undefined {
  return loadCommentState(file).items.find((x) => x.id === id);
}

/** 재시작에 끊긴 '올리는 중' — 올라갔는지 모르므로 실패로 바꿔 사장님이 확인하게 한다(다시 누르면 다시 시도). */
export function sweepPostingComments(file = defaultFile(), now = new Date()): number {
  const s = loadCommentState(file);
  let n = 0;
  for (const i of s.items) {
    if (i.status === 'posting') { i.status = 'failed'; i.error = '올리는 중 서버가 다시 시작됨 — 채널에서 올라갔는지 확인하세요'; i.updatedTs = now.toISOString(); n++; }
  }
  if (n) saveCommentState(s, file);
  return n;
}
