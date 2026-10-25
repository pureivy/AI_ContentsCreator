/**
 * 댓글 읽기·답글 올리기 — 채널별 통로(댓글 담당, 2026-10-25).
 *
 * - 유튜브: Data API v3. 채널 전체 댓글을 한 번에(commentThreads allThreadsRelatedToChannelId, 1단위) 읽고,
 *   답글은 comments.insert(50단위). 연결 토큰의 youtube.force-ssl 범위로 된다(재연결 불필요, 2026-10-25 실측).
 * - 인스타: graph.instagram.com. 댓글 읽기·답글은 instagram_business_manage_comments 권한이 있어야 한다 —
 *   없으면 CommentScopeError(사장님이 메타를 다시 연결해야 함).
 * - 네이버 블로그·클립: 같은 네이버 댓글 상자(cbox)를 쓴다. 읽기는 로그인 없는 공개 목록 주소로(2026-10-25 실측),
 *   답글은 공개 API 가 없어 브라우저 조작(naver_comment_reply.py — 사람이 누른 버튼에서만).
 *
 * 읽기 함수는 실패를 던진다(호출부가 채널별로 삼킨다). 응답 해석은 순수 함수로 떼어 시험한다.
 */
import { fetchTimeout } from '../util/fetch';
import { GRAPH } from './metaPublish';
import type { FoundComment } from '../content/comments';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const YT = 'https://www.googleapis.com/youtube/v3';
const CBOX_LIST = 'https://apis.naver.com/commentBox/cbox/web_naver_list_jsonp.json';

/** 인스타 댓글 권한 없음 — 메타 재연결이 필요하다. */
export class CommentScopeError extends Error {}

// ───────────────────────── 유튜브 ─────────────────────────

interface YtCommentSnippet { authorDisplayName?: string; authorChannelId?: { value?: string }; textOriginal?: string; textDisplay?: string; publishedAt?: string; videoId?: string }
interface YtThread { id?: string; snippet?: { videoId?: string; totalReplyCount?: number; topLevelComment?: { id?: string; snippet?: YtCommentSnippet } }; replies?: { comments?: Array<{ snippet?: YtCommentSnippet }> } }

/** commentThreads 응답 → 댓글(순수). 우리 채널이 단 답글이 있으면 answered. */
export function parseYoutubeThreads(json: { items?: YtThread[] }, channelId: string): FoundComment[] {
  const out: FoundComment[] = [];
  for (const t of json.items ?? []) {
    const top = t.snippet?.topLevelComment;
    const s = top?.snippet;
    const videoId = t.snippet?.videoId ?? s?.videoId ?? '';
    if (!top?.id || !s || !videoId) continue;
    const replies = t.replies?.comments ?? [];
    out.push({
      platform: 'youtube', externalId: top.id, author: s.authorDisplayName ?? '', text: (s.textOriginal ?? s.textDisplay ?? '').trim(),
      commentTs: s.publishedAt ?? '', targetId: videoId, targetUrl: `https://www.youtube.com/shorts/${videoId}`,
      own: s.authorChannelId?.value === channelId,
      answered: replies.some((r) => r.snippet?.authorChannelId?.value === channelId),
    });
  }
  return out;
}

/** 채널 전체 최근 댓글(최신순 최대 100개 — 30분마다 보므로 충분). */
export async function fetchYoutubeComments(access: string, channelId: string, signal?: AbortSignal): Promise<FoundComment[]> {
  const out: FoundComment[] = [];
  let page = '';
  for (let i = 0; i < 2; i++) {
    const u = `${YT}/commentThreads?part=snippet,replies&allThreadsRelatedToChannelId=${encodeURIComponent(channelId)}&order=time&maxResults=50&textFormat=plainText${page ? `&pageToken=${page}` : ''}`;
    const r = await fetchTimeout(u, { headers: { Authorization: `Bearer ${access}` } }, signal, 20_000);
    const j = await r.json().catch(() => ({})) as { items?: YtThread[]; nextPageToken?: string; error?: { message?: string } };
    if (!r.ok) throw new Error(`유튜브 댓글 읽기 실패: ${j.error?.message ?? `HTTP ${r.status}`}`);
    out.push(...parseYoutubeThreads(j, channelId));
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return out;
}

/** 지금 그 댓글에 우리 답글이 있나 — 올리기 직전 중복 방지(재시작·두 번 누름). 못 읽으면 null(모름). */
export async function youtubeAlreadyAnswered(access: string, channelId: string, parentId: string, signal?: AbortSignal): Promise<boolean | null> {
  try {
    const r = await fetchTimeout(`${YT}/comments?part=snippet&parentId=${encodeURIComponent(parentId)}&maxResults=100`, { headers: { Authorization: `Bearer ${access}` } }, signal, 20_000);
    const j = await r.json().catch(() => ({})) as { items?: Array<{ snippet?: YtCommentSnippet }> };
    if (!r.ok) return null;
    return (j.items ?? []).some((c) => c.snippet?.authorChannelId?.value === channelId);
  } catch { return null; }
}

export async function postYoutubeReply(access: string, parentId: string, text: string, signal?: AbortSignal): Promise<string> {
  const r = await fetchTimeout(`${YT}/comments?part=snippet`, {
    method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
  }, signal, 30_000);
  const j = await r.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!r.ok || !j.id) throw new Error(`유튜브 답글 실패: ${j.error?.message ?? `HTTP ${r.status}`}`);
  return j.id;
}

// ───────────────────────── 인스타 ─────────────────────────

interface IgComment { id?: string; text?: string; timestamp?: string; username?: string; replies?: { data?: Array<{ username?: string }> } }

/** 그래프 권한 오류인가(순수) — (#10)·(#200)·OAuthException 권한 문구. */
export function isIgScopeError(j: unknown): boolean {
  const e = (j as { error?: { code?: number; message?: string } } | null)?.error;
  if (!e) return false;
  return e.code === 10 || e.code === 200 || /permission|권한/i.test(e.message ?? '');
}

/** 미디어 한 개의 댓글 응답 → 댓글(순수). 우리 계정 이름의 답글이 있으면 answered. */
export function parseIgComments(json: { data?: IgComment[] }, media: { id: string; permalink?: string }, myUsername: string): FoundComment[] {
  const me = myUsername.toLowerCase();
  return (json.data ?? []).flatMap((c) => {
    if (!c.id) return [];
    return [{
      platform: 'instagram' as const, externalId: c.id, author: c.username ?? '', text: (c.text ?? '').trim(), commentTs: c.timestamp ?? '',
      targetId: media.id, targetUrl: media.permalink, own: !!me && (c.username ?? '').toLowerCase() === me,
      answered: (c.replies?.data ?? []).some((r) => !!me && (r.username ?? '').toLowerCase() === me),
    }];
  });
}

async function igJson(url: string, signal?: AbortSignal, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const r = await fetchTimeout(url, init, signal, 20_000);
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) {
    if (isIgScopeError(j)) throw new CommentScopeError('인스타 댓글 권한이 없습니다 — 메타를 다시 연결해 주세요(댓글 관리 권한 추가)');
    const msg = (j.error as { message?: string } | undefined)?.message;
    throw new Error(`인스타 ${msg ?? `HTTP ${r.status}`}`);
  }
  return j;
}
const qs = (token: string): string => `access_token=${encodeURIComponent(token)}`;

/** 최근 게시물(maxAgeMs 안) 가운데 댓글이 있는 것만 댓글을 연다. */
export async function fetchInstagramComments(token: string, maxAgeMs: number, now = new Date(), signal?: AbortSignal): Promise<FoundComment[]> {
  const me = await igJson(`${GRAPH}/me?fields=username&${qs(token)}`, signal) as { username?: string };
  const media = await igJson(`${GRAPH}/me/media?fields=id,timestamp,permalink,comments_count&limit=50&${qs(token)}`, signal) as { data?: Array<{ id?: string; timestamp?: string; permalink?: string; comments_count?: number }> };
  const out: FoundComment[] = [];
  let counted = 0;
  for (const m of media.data ?? []) {
    if (!m.id || !(m.comments_count ?? 0)) continue;
    if (now.getTime() - Date.parse(m.timestamp ?? '') > maxAgeMs) continue;
    counted++;
    const j = await igJson(`${GRAPH}/${m.id}/comments?fields=id,text,timestamp,username,replies{username}&limit=50&${qs(token)}`, signal) as { data?: IgComment[] };
    out.push(...parseIgComments(j, { id: m.id, permalink: m.permalink }, me.username ?? ''));
  }
  // 댓글 권한이 없으면 오류 대신 빈 목록이 온다(2026-10-25 실측: comments_count 1 인데 data []) — 댓글 수가 있는 게시물이
  // 있는데 하나도 못 읽었으면 권한 문제로 본다. 10-26 실측: 재연결로 권한을 받아도 메타 앱이 '개발 중' 모드면
  // 앱 역할이 없는 사람(일반 고객)의 댓글은 똑같이 빈 목록으로 온다 — 재연결만 안내하면 사장님이 헛돈다.
  if (counted > 0 && out.length === 0) throw new CommentScopeError('인스타 댓글이 API 에서 비어 옵니다 — 메타 앱이 \'개발 중\' 모드면 고객 댓글이 걸러집니다(앱 라이브 전환·댓글 관리 권한 검수 필요). 권한을 추가하기 전 연결이면 메타를 다시 연결해 주세요');
  return out;
}

/** 못 읽으면 null(모름). */
export async function instagramAlreadyAnswered(token: string, commentId: string, signal?: AbortSignal): Promise<boolean | null> {
  try {
    const me = await igJson(`${GRAPH}/me?fields=username&${qs(token)}`, signal) as { username?: string };
    const j = await igJson(`${GRAPH}/${commentId}/replies?fields=username&${qs(token)}`, signal) as { data?: Array<{ username?: string }> };
    const u = (me.username ?? '').toLowerCase();
    if (!u) return null;
    return (j.data ?? []).some((r) => (r.username ?? '').toLowerCase() === u);
  } catch { return null; }
}

export async function postInstagramReply(token: string, commentId: string, text: string, signal?: AbortSignal): Promise<string> {
  const j = await igJson(`${GRAPH}/${commentId}/replies?message=${encodeURIComponent(text)}&${qs(token)}`, signal, { method: 'POST' }) as { id?: string };
  if (!j.id) throw new Error('인스타 답글 실패: 응답에 id 없음');
  return j.id;
}

// ───────────────────────── 네이버(블로그·클립 공통 댓글 상자) ─────────────────────────

/** JSONP 껍질 벗기기(순수) — `/**\/cb({...});` → 객체. */
export function parseJsonp<T = unknown>(raw: string): T | null {
  const a = raw.indexOf('(');
  const b = raw.lastIndexOf(')');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(raw.slice(a + 1, b)) as T; } catch { return null; }
}

interface CboxComment {
  commentNo?: string; parentCommentNo?: string; replyLevel?: number; replyAllCount?: number; contents?: string; userName?: string;
  regTimeGmt?: string; manager?: boolean; deleted?: boolean; visible?: boolean; secret?: boolean; expose?: boolean;
}

/** 댓글 상자 본문의 HTML 조각 → 글(순수) — <br> 은 줄바꿈, 나머지 태그 제거, 엔티티 몇 개 복원. */
export function cboxText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}

/** 네이버 시각 "2026-10-25T13:04:35+0000" → ISO(순수). */
function cboxTs(s: string | undefined): string {
  if (!s) return '';
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/**
 * 댓글 상자 목록 → 최상위 댓글(순수). 주인(manager) 답글이 붙은 댓글은 answered.
 * 목록에 답글이 다 안 실렸는데(replyAllCount > 실린 답글 수) 주인 답글을 못 찾으면 — 확인할 수 없으니 answered 로 본다
 * (모르는 채 초안을 보내는 것보다 놓치는 쪽이 낫다: 사장님이 이미 답했을 가능성이 크다).
 */
export function parseCboxList(json: { result?: { commentList?: CboxComment[] } }, base: { platform: 'blog' | 'clip'; targetId: string; targetUrl?: string; targetTitle?: string }): FoundComment[] {
  const list = json.result?.commentList ?? [];
  const out: FoundComment[] = [];
  for (const c of list) {
    if (!c.commentNo || (c.replyLevel ?? 1) !== 1) continue;
    if (c.deleted || c.visible === false || c.secret || c.expose === false) continue;
    const replies = list.filter((r) => r.parentCommentNo === c.commentNo && r.commentNo !== c.commentNo && (r.replyLevel ?? 1) >= 2);
    const ownReply = replies.some((r) => r.manager);
    const unseen = (c.replyAllCount ?? 0) > replies.length;
    out.push({
      platform: base.platform, externalId: c.commentNo, author: c.userName ?? '', text: cboxText(c.contents ?? ''), commentTs: cboxTs(c.regTimeGmt),
      targetId: base.targetId, targetUrl: base.targetUrl, targetTitle: base.targetTitle,
      own: !!c.manager, answered: ownReply || unseen,
    });
  }
  return out;
}

async function cboxList(params: Record<string, string>, referer: string, signal?: AbortSignal): Promise<{ result?: { commentList?: CboxComment[] } }> {
  const q = new URLSearchParams({ templateId: 'default', lang: 'ko', country: 'KR', pageSize: '100', indexSize: '10', listQType: 'PAGE', pageType: 'more', page: '1', initialize: 'true', useAltSort: 'true', _callback: 'cb', ...params });
  const r = await fetchTimeout(`${CBOX_LIST}?${q}`, { headers: { 'User-Agent': UA, Referer: referer } }, signal, 20_000);
  const j = parseJsonp<{ success?: boolean; message?: string; result?: { commentList?: CboxComment[] } }>(await r.text());
  if (!r.ok || !j || j.success === false) throw new Error(`네이버 댓글 읽기 실패: ${j?.message ?? `HTTP ${r.status}`}`);
  return j;
}

// ── 블로그 ──
export const blogPostUrl = (blogId: string, logNo: string): string => `https://blog.naver.com/${blogId}/${logNo}`;
const postViewUrl = (blogId: string, logNo: string): string => `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${logNo}`;

/** 글 보기 화면에서 네이버 내부 blogNo(댓글 상자 번호에 필요)를 찾는다. */
export async function fetchBlogNo(blogId: string, anyLogNo: string, signal?: AbortSignal): Promise<string> {
  const r = await fetchTimeout(postViewUrl(blogId, anyLogNo), { headers: { 'User-Agent': UA } }, signal, 20_000);
  const m = /blogNo\s*=\s*'?(\d+)/.exec(await r.text());
  if (!m) throw new Error('블로그 번호(blogNo)를 찾지 못했습니다');
  return m[1]!;
}

/** 글 목록의 댓글 수(순수 해석) — commentCount 빈 값은 0. */
export function parseBlogPostList(json: { postList?: Array<{ logNo?: string; title?: string; commentCount?: string }> }): Array<{ logNo: string; title: string; comments: number }> {
  return (json.postList ?? []).flatMap((p) => {
    if (!p.logNo) return [];
    let title = p.title ?? '';
    try { title = decodeURIComponent(title.replace(/\+/g, ' ')); } catch { /* 그대로 */ }
    return [{ logNo: p.logNo, title, comments: Number(p.commentCount) || 0 }];
  });
}

/** 최근 글(pages×30편)의 댓글 수. */
export async function fetchBlogPostCounts(blogId: string, pages = 4, signal?: AbortSignal): Promise<Array<{ logNo: string; title: string; comments: number }>> {
  const out: Array<{ logNo: string; title: string; comments: number }> = [];
  for (let p = 1; p <= pages; p++) {
    const u = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=${p}&categoryNo=0&parentCategoryNo=0&countPerPage=30`;
    const r = await fetchTimeout(u, { headers: { 'User-Agent': UA, Referer: `https://blog.naver.com/${blogId}` } }, signal, 20_000);
    // 네이버가 제목 안의 역슬래시를 그대로 둬 JSON 이 깨지는 일이 있다 — 고쳐서 읽는다.
    const txt = (await r.text()).replace(/\\'/g, "'");
    let j: { postList?: Array<{ logNo?: string; title?: string; commentCount?: string }> };
    try { j = JSON.parse(txt) as typeof j; } catch { throw new Error('블로그 글 목록을 읽지 못했습니다'); }
    const rows = parseBlogPostList(j);
    out.push(...rows);
    if (rows.length < 30) break;
  }
  return out;
}

export async function fetchBlogPostComments(blogId: string, blogNo: string, logNo: string, title: string, signal?: AbortSignal): Promise<FoundComment[]> {
  const j = await cboxList({ ticket: 'blog', pool: 'blogid', objectId: `${blogNo}_201_${logNo}`, groupId: blogNo }, postViewUrl(blogId, logNo), signal);
  return parseCboxList(j, { platform: 'blog', targetId: `${blogId}/${logNo}`, targetUrl: blogPostUrl(blogId, logNo), targetTitle: title });
}

// ── 클립 ──
const CLIP_API = 'https://creatorhub-api.naver.com/api/v7.0';

export async function fetchClipProfileId(handle: string, signal?: AbortSignal): Promise<string> {
  const r = await fetchTimeout(`${CLIP_API}/clip/profiles?clipId=${encodeURIComponent(handle)}`, { headers: { 'User-Agent': UA, Referer: 'https://clip.naver.com/' } }, signal, 20_000);
  const j = await r.json().catch(() => ({})) as { body?: { profileId?: string } };
  if (!j.body?.profileId) throw new Error('클립 프로필을 찾지 못했습니다');
  return j.body.profileId;
}

export interface ClipCard { mediaId: string; description: string; comments: number; publishedTime: string }

/** 클립 피드 카드 → 클립(순수). */
export function parseClipCards(json: { body?: { cards?: Array<{ content?: { mediaId?: string; description?: string; publishedTime?: string; interaction?: { comment?: { count?: number } } } }> } }): ClipCard[] {
  return (json.body?.cards ?? []).flatMap((c) => {
    const ct = c.content;
    if (!ct?.mediaId) return [];
    return [{ mediaId: ct.mediaId, description: ct.description ?? '', comments: ct.interaction?.comment?.count ?? 0, publishedTime: ct.publishedTime ?? '' }];
  });
}

/** 채널의 클립(최근 50개) — 피드는 세션을 먼저 받아야 목록을 준다. */
export async function fetchClipCards(profileId: string, signal?: AbortSignal): Promise<ClipCard[]> {
  const rec = `recType=CLIP_PC&recId=${encodeURIComponent(JSON.stringify({ targetProfileId: profileId, open: true, tab: 'all' }))}&playback=false`;
  const h = { headers: { 'User-Agent': UA, Referer: 'https://clip.naver.com/' } };
  const first = await (await fetchTimeout(`${CLIP_API}/feed/content?${rec}&deviceType=html5_mo`, h, signal, 20_000)).json().catch(() => ({})) as { body?: { session?: { id?: string } } };
  const sid = first.body?.session?.id;
  if (!sid) throw new Error('클립 목록 세션을 받지 못했습니다');
  const j = await (await fetchTimeout(`${CLIP_API}/feed/contents?${rec}&sessionId=${encodeURIComponent(sid)}&count=50`, h, signal, 20_000)).json().catch(() => ({})) as Parameters<typeof parseClipCards>[0];
  return parseClipCards(j);
}

export const clipCommentsUrl = (profileId: string, mediaId: string): string =>
  `https://clip.naver.com/comments/?meta=${encodeURIComponent(JSON.stringify({ ticket: 'clip', groupId: profileId, id: mediaId, params: { templateId: 'default', pool: 'cbox8' }, exposeComment: true, manager: true, commentStickerServiceCode: 'clip', fallback: false }))}`;

export async function fetchClipComments(profileId: string, card: ClipCard, signal?: AbortSignal): Promise<FoundComment[]> {
  const j = await cboxList({ ticket: 'clip', pool: 'cbox8', objectId: card.mediaId, groupId: profileId }, 'https://clip.naver.com/', signal);
  return parseCboxList(j, { platform: 'clip', targetId: card.mediaId, targetUrl: clipCommentsUrl(profileId, card.mediaId), targetTitle: card.description.split('\n')[0] });
}

/**
 * 올리기 직전 — 그 네이버 댓글에 이미 주인 답글이 있나(블로그·클립 공통). 못 읽거나, 목록에 답글이 다 안 실려
 * (replyAllCount > 실린 답글 수) 주인 답글을 못 찾으면 null(모름) — 목록 해석(parseCboxList)과 같은 보수 기준.
 */
export async function naverAlreadyAnswered(kind: 'blog' | 'clip', ids: { blogId?: string; blogNo?: string; logNo?: string; profileId?: string; mediaId?: string }, commentNo: string, signal?: AbortSignal): Promise<boolean | null> {
  try {
    const j = kind === 'blog'
      ? await cboxList({ ticket: 'blog', pool: 'blogid', objectId: `${ids.blogNo}_201_${ids.logNo}`, groupId: ids.blogNo ?? '' }, postViewUrl(ids.blogId ?? '', ids.logNo ?? ''), signal)
      : await cboxList({ ticket: 'clip', pool: 'cbox8', objectId: ids.mediaId ?? '', groupId: ids.profileId ?? '' }, 'https://clip.naver.com/', signal);
    const list = j.result?.commentList ?? [];
    const replies = list.filter((r) => r.parentCommentNo === commentNo && r.commentNo !== commentNo);
    if (replies.some((r) => !!r.manager)) return true;
    const parent = list.find((r) => r.commentNo === commentNo);
    if (!parent || (parent.replyAllCount ?? 0) > replies.length) return null;
    return false;
  } catch { return null; }
}
