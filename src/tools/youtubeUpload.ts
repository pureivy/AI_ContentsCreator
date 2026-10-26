/**
 * 유튜브 숏폼 업로드 — 브랜드별 refresh token(YOUTUBE_TOKENS)으로 access token 을 갱신해
 * videos.insert(multipart)로 업로드한다. 기본은 처음부터 공개(2026-10-05, YOUTUBE_UPLOAD_PUBLIC_DIRECT — verifyPublicCover 참고).
 * 공개 발행(2026-10-01 사용자 확정, YOUTUBE_PUBLISH_PUBLIC) — 비공개로 올릴 때 예약 공개(publishAt)를 안전망으로 걸고,
 * publishWhenReady 가 처리 완료를 기다려 공개로 바꾼 뒤 썸네일이 실제로 떴는지 확인한다. 공개 상태에서 올리지 않는
 * 이유: 썸네일이 안 붙은 영상은 공개 상태에서 고쳐지지 않고 '비공개 → 공개' 전환 때만 고쳐졌다(2026-08-31 실증).
 * Node 내장 fetch 만 사용(새 의존성 없음). 명시 실패 반환 — 사용자 트리거 액션(fail-open 아님).
 * 재시도 없음(videos.insert = 1600 쿼터단위/건). 토큰·시크릿은 로그·에러에 싣지 않는다.
 */
import fs from 'node:fs';
import { getSecret, getYoutubeAccount } from '../secrets/store';
import { CONFIG } from '../config';

export interface YtUploadResult { ok: boolean; videoId?: string; url?: string; error?: string; thumbnailError?: string }

/** snippet/status 메타데이터(순수) — 제목 100자·꺾쇠 제거, 설명 5000자, tags ≤15개·30자, private 고정.
 *  blogUrl(파생 쇼츠의 원본 네이버 글, 2026-07-31)은 설명 본문과 태그 사이 클릭 가능한 링크 줄.
 *  publishAt(2026-10-01) — 예약 공개 시각(ISO). 비공개일 때만 걸 수 있고, 그 시각에 유튜브가 스스로 공개한다. */
export function buildVideoMeta(title: string, description: string, hashtags: string[], blogUrl?: string, publishAt?: string, privacy: 'public' | 'private' = 'private'): Record<string, unknown> {
  const clean = (s: string): string => s.replace(/[<>]/g, ''); // 유튜브 API 는 제목·설명·태그에 <> 금지
  const t = clean(title).trim().slice(0, 100) || '쇼츠';
  const tagLine = hashtags.filter(Boolean).join(' ');
  const linkLine = blogUrl ? `📖 전체 가이드(블로그): ${blogUrl}` : '';
  const desc = clean([description.trim(), linkLine, tagLine].filter(Boolean).join('\n\n')).slice(0, 5000);
  const tags = hashtags.map((h) => clean(h.replace(/^#/, '')).trim().slice(0, 30)).filter(Boolean).slice(0, 15);
  return {
    snippet: { title: t, description: desc, tags, categoryId: CONFIG.youtubeCategoryId },
    // containsSyntheticMedia: 스튜디오의 'AI 사용(변형·합성 콘텐츠) 공개 — 예' 체크와 동일.
    // 쇼츠는 전량 AI 생성(스크립트·TTS 음성·AI 배경/클립)이라 상시 true — 유튜브 공개 의무 준수.
    // 예약 공개(publishAt)는 비공개일 때만 유효하다 — 공개 업로드에 실으면 유튜브가 거절한다.
    status: { privacyStatus: privacy, ...(publishAt && privacy === 'private' ? { publishAt } : {}), selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  };
}

/**
 * 예약 공개 안전망(분) — 공개 발행일 때 업로드에 publishAt 을 이만큼 뒤로 건다. 공개 전환(videos.update)이 권한 부족·
 * 서버 재시작으로 못 돌아도 이 시각에 유튜브가 공개한다. 쇼츠 처리는 보통 1~3분이라 30분이면 전환이 먼저 끝난다.
 */
export const PUBLISH_SAFETY_MIN = 30;

/**
 * videos.update(part=status) 바디(순수). part=status 는 상태를 **통째로 덮어쓴다** — 빠진 필드는 기본값으로 돌아간다.
 * 그래서 지금 상태에서 쓸 수 있는 필드(embeddable·license·publicStatsViewable)를 옮겨 싣고 공개 여부만 바꾼다.
 * 아동용 아님·AI 합성 공개는 업로드 때와 같게 못박는다. 현재 상태의 publishAt 은 옮기지 않는다 — 공개로 가면 의미가 없다.
 * publishAt 인자는 아직 한 번도 공개된 적 없는 영상에만 쓸 수 있다 — 한 번 공개된 영상에 걸면 유튜브가 invalidPublishAt 으로
 * 요청을 통째로 거절한다(2026-10-02 실측: 썸네일 복구의 비공개 되돌림에 실었다가 복구가 안 됐다).
 */
export function buildStatusUpdate(id: string, current: Record<string, unknown> | undefined, privacy: 'public' | 'private', publishAt?: string): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const k of ['embeddable', 'license', 'publicStatsViewable']) if (current?.[k] !== undefined) keep[k] = current[k];
  const at = privacy === 'private' && publishAt ? { publishAt } : {};
  return { id, status: { ...keep, privacyStatus: privacy, ...at, selfDeclaredMadeForKids: false, containsSyntheticMedia: true } };
}

export type ThumbState = 'ok' | 'placeholder' | 'not_public';
/**
 * 공개 썸네일 판정(순수) — oEmbed 가 200 이 아니면 아직 공개 전(비공개 영상은 401/403).
 * 판정은 **세로(oardefault)만** 본다 — 쇼츠 피드·채널 쇼츠 칸이 쓰는 게 이것이고, 1,097바이트 회색 자리표시면
 * 썸네일 없음(정상은 수십~수백 KB, 2026-08-31·10-01 실측). 가로(hqdefault)는 판정에 쓰지 않는다:
 * 10-02 배롱나무 편은 가로에 디자인 썸네일이 멀쩡히 있는데 세로가 자리표시라 쇼츠 화면에 중간 프레임이 나왔고,
 * 가로를 예비로 보던 종전 판정이 이를 '정상'으로 넘겨 복구를 안 돌렸다.
 */
export function classifyThumb(oembedStatus: number, oarBytes: number): ThumbState {
  if (oembedStatus !== 200) return 'not_public';
  return oarBytes > 2000 ? 'ok' : 'placeholder';
}

/** multipart/related 바디 조립(순수 Buffer) — ① JSON 메타 ② video/mp4 바이트. */
export function buildMultipartBody(meta: Record<string, unknown>, video: Buffer, boundary: string): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`, 'utf-8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  return Buffer.concat([head, video, tail]);
}

/** videos.insert 응답에서 id 안전 추출(순수). */
export function extractVideoId(json: unknown): string | null {
  const id = (json as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id ? id : null;
}

/** refresh token → access token. 실패 사유는 사람이 읽을 메시지로(토큰 값 미노출). */
async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const j = await r.json() as { access_token?: string; error?: string };
  if (!r.ok || !j.access_token) {
    throw new Error(j.error === 'invalid_grant' ? '토큰 만료 — 채널 재연결 필요' : `토큰 갱신 실패(${j.error ?? r.status})`);
  }
  return j.access_token;
}

/** 브랜드 채널의 액세스 토큰(공용 헬퍼) — 애널리틱스 수집 등 업로드 외 경로에서 재사용. */
export async function youtubeAccessToken(slug: string, signal?: AbortSignal): Promise<string> {
  const clientId = getSecret('YOUTUBE_OAUTH_CLIENT_ID') ?? '';
  const clientSecret = getSecret('YOUTUBE_OAUTH_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) throw new Error('유튜브 OAuth 클라이언트 미설정');
  const { refreshToken } = getYoutubeAccount(slug);
  if (!refreshToken) throw new Error('유튜브 채널 미연결');
  return refreshAccessToken(clientId, clientSecret, refreshToken, signal);
}

export async function uploadShortsToYoutube(opts: {
  slug: string; videoPath: string;
  title: string; description: string; hashtags: string[];
  /** 원본 네이버 블로그 URL(파생 쇼츠일 때) — 설명에 '전체 가이드' 링크 줄로 삽입. */
  blogUrl?: string;
  thumbnailPath?: string; signal?: AbortSignal;
  /** 예약 공개 시각(ISO) — 비공개→공개 방식의 안전망(PUBLISH_SAFETY_MIN). 없으면 종전대로 비공개 고정. */
  publishAt?: string;
  /** 처음부터 공개로 올린다(2026-10-05, YOUTUBE_UPLOAD_PUBLIC_DIRECT) — 커버는 verifyPublicCover 로 확인. */
  privacy?: 'public' | 'private';
  /** API 커버 지정(thumbnails.set)을 건너뛴다(2026-10-06 시험, YOUTUBE_SHORTS_SET_THUMBNAIL=false). */
  skipThumbnail?: boolean;
}): Promise<YtUploadResult> {
  // 업로드 요청을 보낸 뒤의 실패는 '안 올라갔다'가 아니다(2026-10-26) — 구글이 파일을 다 받고 응답만 끊기면(180초 시간 초과·
  // 응답 본문 깨짐) 공개 영상은 있는데 기록이 없고, 재시도가 같은 영상을 한 번 더 공개한다. 그래서 요청을 보낸 뒤 실패하면
  // 채널 업로드 목록에서 방금 올린 영상(같은 제목 + 업로드 시작 뒤)을 찾아 기록한다.
  let access: string | undefined;
  let uploadStartMs = 0;
  let sentTitle = '';
  const recover = async (why: string): Promise<YtUploadResult | null> => {
    if (!access || !uploadStartMs) return null;
    const id = await recoverRecentUpload(opts.slug, access, sentTitle, Math.max(uploadStartMs - 60_000, Date.now() - RECOVER_WINDOW_MS));
    if (!id) return null;
    console.log(`[youtube] 업로드 응답 유실(${why}) — 채널 업로드 목록에서 회수: ${id}`);
    const thumbnailError = opts.skipThumbnail ? undefined : await setThumbnail(access, id, opts.thumbnailPath, AbortSignal.timeout(60_000));
    return { ok: true, videoId: id, url: `https://youtube.com/shorts/${id}`, thumbnailError };
  };
  try {
    const clientId = getSecret('YOUTUBE_OAUTH_CLIENT_ID') ?? '';
    const clientSecret = getSecret('YOUTUBE_OAUTH_CLIENT_SECRET') ?? '';
    if (!clientId || !clientSecret) return { ok: false, error: '유튜브 OAuth 클라이언트 미설정 — 키 탭에서 입력하세요' };
    const { refreshToken } = getYoutubeAccount(opts.slug);
    if (!refreshToken) return { ok: false, error: '유튜브 채널 미연결 — 채널 연결을 먼저 하세요' };
    if (!fs.existsSync(opts.videoPath)) return { ok: false, error: '영상 파일 없음' };

    const timeout = AbortSignal.timeout(180_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    access = await refreshAccessToken(clientId, clientSecret, refreshToken, signal);

    const boundary = `yt-${Date.now().toString(36)}-gepa`;
    const meta = buildVideoMeta(opts.title, opts.description, opts.hashtags, opts.blogUrl, opts.publishAt, opts.privacy ?? 'private');
    sentTitle = String((meta.snippet as { title?: unknown }).title ?? '');
    const body = buildMultipartBody(meta, fs.readFileSync(opts.videoPath), boundary);
    uploadStartMs = Date.now();
    const r = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    const j: unknown = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 5xx 는 구글이 받고도 응답만 실패했을 수 있다 — 회수부터. 4xx(쿼터 초과 등)는 올라가지 않은 것.
      if (r.status >= 500) { const rec = await recover(`HTTP ${r.status}`); if (rec) return rec; }
      const reason = (j as { error?: { errors?: Array<{ reason?: string }> } })?.error?.errors?.[0]?.reason ?? String(r.status);
      return { ok: false, error: reason === 'quotaExceeded' ? '유튜브 일일 쿼터 초과 — 내일 재시도' : `업로드 실패(${reason})` };
    }
    const id = extractVideoId(j);
    if (!id) return (await recover('id 없음')) ?? { ok: false, error: '업로드 응답 이형(id 없음) — 채널에 올라갔는지 확인 후 재시도하세요' };
    // 커스텀 썸네일 설정(best-effort) — 우리 채널은 200(채널 인증), 미인증 채널은 403. 실패는 note 만.
    // 쇼츠 탭 커버(oardefault)에 반영됐다는 증거는 아직 없다 — 10-05·10-06 두 편 모두 사장님이 앱에서 손으로 고쳤다.
    // 그래서 처리 완료 뒤 한 번 더 지정한다(resetThumbnailAfterProcessing). 지정을 아예 빼면 ok_asis1 처럼 oardefault 가 비어
    // 쇼츠 탭에 중간 장면이 뜬다(10-06 실측 6/6) — skipThumbnail 은 끄는 스위치로만 남긴다.
    const thumbnailError = opts.skipThumbnail ? undefined : await setThumbnail(access, id, opts.thumbnailPath, signal);
    // 쇼츠 분류는 파일(세로 1080×1920·3분 이하)로 자동 판정 — URL 은 표시용이지만 쇼츠 플레이어로 열리게 /shorts/ 형식.
    return { ok: true, videoId: id, url: `https://youtube.com/shorts/${id}`, thumbnailError };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 120) : String(e);
    // 업로드 요청을 보낸 뒤의 예외(시간 초과·연결 끊김)면 올라갔는지 먼저 확인한다 — 보내기 전 예외는 recover 가 그냥 null.
    const rec = await recover(why.slice(0, 60)).catch(() => null);
    if (rec) return rec;
    return { ok: false, error: uploadStartMs ? `${why} — 채널에 올라갔는지 확인 후 재시도하세요` : why };
  }
}

/** 업로드 회수 창(2026-10-26) — 업로드 목록에서 이보다 오래된 항목은 방금 올린 영상으로 보지 않는다(같은 제목 옛 영상 오매칭 방지). */
const RECOVER_WINDOW_MS = 5 * 60_000;

/**
 * 채널 업로드 목록에서 방금 올린 영상 매칭(순수, 2026-10-26) — 제목이 **정확히** 같고 publishedAt 이 sinceMs 이후
 * (시계 차 1분 허용해 nowMs+1분 이전)인 항목. 시간 창이 없으면 같은 제목의 옛 영상(재시도로 생긴 중복 포함)을 붙인다.
 * 둘 이상이면 어느 것인지 모르니 null — 엉뚱한 영상을 기록하느니 실패로 두고 사람이 본다.
 */
export function matchRecentUpload(
  items: ReadonlyArray<{ snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }>,
  title: string, sinceMs: number, nowMs: number,
): string | null {
  if (!title.trim()) return null;
  const hits = items.filter((it) => {
    const s = it.snippet;
    const at = Date.parse(s?.publishedAt ?? '');
    return !!s?.resourceId?.videoId && s.title === title && Number.isFinite(at) && at >= sinceMs && at <= nowMs + 60_000;
  });
  return hits.length === 1 ? hits[0]!.snippet!.resourceId!.videoId! : null;
}

/** 브랜드별 업로드 재생목록 id 캐시 — channels.list 를 회수 때마다 부르지 않게.
 *  6시간 TTL + 채널 재연결 때 비움(2026-10-26 검토) — 종전엔 영영 안 비워, 다른 채널로 다시 연결하면 회수가 옛 채널 목록을 봤다. */
const uploadsPlaylistCache = new Map<string, { pl: string; ts: number }>();
const UPLOADS_PLAYLIST_TTL_MS = 6 * 3600_000;
/** 브랜드 채널 토큰이 바뀌었을 때(OAuth 콜백) 부른다 — slug 미지정이면 전부. */
export function clearUploadsPlaylistCache(slug?: string): void {
  if (slug === undefined) uploadsPlaylistCache.clear(); else uploadsPlaylistCache.delete(slug);
}

/**
 * 응답이 유실된 업로드 회수(2026-10-26) — channels.list(contentDetails, 1단위)로 업로드 재생목록을 찾고
 * playlistItems.list(1단위)에서 matchRecentUpload. 원래 요청의 signal 은 이미 끊겼을 수 있어(그게 원인일 수 있다)
 * 호출마다 새 15초 시간 제한을 쓴다. 목록 반영이 몇 초 늦을 수 있어 못 찾으면 한 번 더 본다. 실패는 null(원래 오류 유지).
 */
export async function recoverRecentUpload(
  slug: string, access: string, title: string, sinceMs: number,
  o: { fetchImpl?: FetchLike; retryDelayMs?: number; now?: () => number } = {},
): Promise<string | null> {
  const f: FetchLike = o.fetchImpl ?? ((u, i) => fetch(u, i));
  const now = o.now ?? Date.now;
  const get = async (url: string): Promise<unknown> => {
    const r = await f(url, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  try {
    const hit = uploadsPlaylistCache.get(slug);
    let pl = hit && now() - hit.ts < UPLOADS_PLAYLIST_TTL_MS ? hit.pl : undefined;
    if (!pl) {
      const j = await get('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true') as { items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> };
      pl = j.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!pl) return null;
      uploadsPlaylistCache.set(slug, { pl, ts: now() });
    }
    for (let i = 0; i < 2; i++) {
      if (i > 0) await sleep(o.retryDelayMs ?? 5_000);
      const j = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=5&playlistId=${encodeURIComponent(pl)}`) as { items?: Array<{ snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }> };
      const id = matchRecentUpload(j.items ?? [], title, sinceMs, Date.now());
      if (id) return id;
    }
    return null;
  } catch { return null; }
}

/**
 * 커스텀 썸네일 설정(best-effort) — 쇼츠는 Data API(thumbnails.set)로 커버 지정이 안 돼 403 이 정상일 수 있다(영상은 무관).
 * 쇼츠 커버는 스튜디오/앱의 '동영상 프레임' 선택으로만 지정된다(첫 프레임=디자인 썸네일). 실패 사유 문자열, 성공·생략은 undefined.
 */
async function setThumbnail(access: string, id: string, thumbnailPath: string | undefined, signal?: AbortSignal): Promise<string | undefined> {
  const r = await postThumbnail(access, id, thumbnailPath, signal);
  if (!r) return undefined;
  if (r.error !== undefined) return r.error;
  // 403 forbidden 은 채널 미인증뿐 아니라 토큰·권한 문제일 수도 있어 사유를 그대로 노출(영상은 업로드됨).
  return `쇼츠 커버는 API 지정 불가(사유 ${r.reason}) — 스튜디오/앱에서 '동영상 프레임' 맨 앞(0초=디자인 썸네일)으로 지정`;
}

/** thumbnails.set 원시 호출 — 성공·생략은 undefined, API 거절은 {reason}, 예외는 {error}(문구는 부르는 쪽이 채널에 맞게 짓는다). */
async function postThumbnail(access: string, id: string, thumbnailPath: string | undefined, signal?: AbortSignal): Promise<{ reason?: string; error?: string } | undefined> {
  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return undefined;
  try {
    const tr = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'image/jpeg' },
      body: fs.readFileSync(thumbnailPath),
    });
    if (tr.ok) return undefined;
    const tj: unknown = await tr.json().catch(() => ({}));
    return { reason: (tj as { error?: { errors?: Array<{ reason?: string }> } })?.error?.errors?.[0]?.reason ?? String(tr.status) };
  } catch (te) { return { error: te instanceof Error ? te.message.slice(0, 80) : String(te) }; }
}

/**
 * 롱폼 메타데이터(순수, 2026-10-22) — 쇼츠 buildVideoMeta 와 같은 정리 규칙(꺾쇠 제거·제목 100자·설명 5000자·
 * 태그 15개·30자)에 처음부터 공개. 설명은 챕터 줄(0:00 …)과 해시태그를 이미 담고 와서 덧붙이지 않는다 —
 * 쇼츠처럼 해시태그 줄을 또 붙이면 같은 태그가 두 번 나온다. 빈 제목 폴백은 '영상'(쇼츠가 아니다).
 */
export function buildLongformMeta(title: string, description: string, tags: string[]): Record<string, unknown> {
  const clean = (s: string): string => s.replace(/[<>]/g, '');
  const t = clean(title).trim().slice(0, 100) || '영상';
  const desc = clean(description.trim()).slice(0, 5000);
  const tg = tags.map((h) => clean(h.replace(/^#/, '')).trim().slice(0, 30)).filter(Boolean).slice(0, 15);
  return {
    snippet: { title: t, description: desc, tags: tg, categoryId: CONFIG.youtubeCategoryId },
    // 롱폼도 TTS 낭독·AI 도해·모션그래픽이 들어가 AI 사용 공개(예)를 상시 건다 — 쇼츠와 같은 정책.
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  };
}

/** 재개형 업로드 응답의 Range("bytes=0-N") → 다음에 보낼 바이트 위치(순수). Range 가 없으면 받은 바이트가 없다는 뜻이라 0. */
export function nextOffsetFromRange(range: string | null | undefined): number {
  const m = /bytes=(\d+)-(\d+)/.exec(range ?? '');
  return m ? Number(m[2]) + 1 : 0;
}

/** 재개형 업로드 기본값 — 16MiB 청크(256KiB 배수 필수), 청크당 5분, 청크 재시도 3회(2s·8s·20s). */
export const RESUMABLE_CHUNK_BYTES = 16 * 1024 * 1024;
const RESUMABLE_CHUNK_TIMEOUT_MS = 5 * 60_000;
const RESUMABLE_RETRY_DELAYS_MS = [2_000, 8_000, 20_000];

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * 유튜브 재개형 업로드(resumable) 청크 루프 — 1GB 롱폼용(2026-10-22).
 *
 * 왜 따로 만드나. 쇼츠 업로드(uploadShortsToYoutube)는 파일을 통째로 읽어 multipart 한 번에 보내고 전체에 180초를 건다.
 * 10분 가로 영상은 1GB 가까이라 메모리에 통째로 올리면 서버가 휘청이고, 180초 안에 끝나지도 않는다.
 * 그래서 세션을 연 뒤(POST → Location) 16MiB씩 파일에서 읽어 PUT 한다 — 시간 제한은 청크마다 건다.
 *
 * 끊김 처리: 5xx·네트워크 오류면 잠시 쉬고 빈 PUT(Content-Range 에 총길이만)으로 서버가 받은 위치를 물어 거기서 잇는다(청크당 3회까지).
 * 308(Resume Incomplete)의 Range 가 다음 시작점이다 — 보낸 청크 일부만 받았을 수 있어 늘 Range 를 따른다.
 * 401 은 액세스 토큰(1시간)이 업로드 도중 만료된 것 — 세션 주소는 토큰과 무관해 토큰만 새로 받아 잇는다.
 * fetch 는 주입(테스트용) — 실제 구글을 치지 않고 청크 루프를 검증한다.
 */
export async function resumableUpload(o: {
  access: string; videoPath: string; meta: Record<string, unknown>;
  signal?: AbortSignal; onProgress?: (sent: number, total: number) => void;
  refreshAccess?: () => Promise<string>;
  /** 완료 응답에 id 가 없을 때 채널 업로드 목록에서 방금 올린 영상을 찾는다(2026-10-26) — 못 찾으면 null. */
  recover?: () => Promise<string | null>;
  fetchImpl?: FetchLike; chunkBytes?: number; chunkTimeoutMs?: number; retryDelaysMs?: number[];
}): Promise<{ ok: true; videoId: string } | { ok: false; error: string }> {
  const f: FetchLike = o.fetchImpl ?? ((u, i) => fetch(u, i));
  const chunk = o.chunkBytes ?? RESUMABLE_CHUNK_BYTES;
  const delays = o.retryDelaysMs ?? RESUMABLE_RETRY_DELAYS_MS;
  const sig = (): AbortSignal => {
    const t = AbortSignal.timeout(o.chunkTimeoutMs ?? RESUMABLE_CHUNK_TIMEOUT_MS);
    return o.signal ? AbortSignal.any([o.signal, t]) : t;
  };
  const failText = (j: unknown, status: number): string => {
    const reason = apiReason(j, status);
    return reason === 'quotaExceeded' ? '유튜브 일일 쿼터 초과 — 내일 재시도' : `업로드 실패(${reason})`;
  };
  let access = o.access;
  const total = (await fs.promises.stat(o.videoPath)).size;
  if (total <= 0) return { ok: false, error: '영상 파일이 비어 있음' };

  // 1) 세션 열기 — 메타데이터만 보내고 업로드 주소(Location)를 받는다. 쿼터 초과는 여기서 난다.
  const init = async (): Promise<Response> => f('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', signal: sig(),
    headers: {
      Authorization: `Bearer ${access}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(total), 'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(o.meta),
  });
  let r0 = await init();
  if (r0.status === 401 && o.refreshAccess) { access = await o.refreshAccess(); r0 = await init(); }
  if (!r0.ok) return { ok: false, error: failText(await r0.json().catch(() => ({})), r0.status) };
  const session = r0.headers.get('location');
  if (!session) return { ok: false, error: '업로드 세션 주소(Location) 없음' };

  // 서버가 받은 위치 묻기 — 받은 게 끝까지면 200/201(완료), 아니면 308 + Range.
  const queryStatus = async (): Promise<Response> => f(session, {
    method: 'PUT', signal: sig(),
    headers: { Authorization: `Bearer ${access}`, 'Content-Length': '0', 'Content-Range': `bytes */${total}` },
  });
  // 완료(200/201)인데 본문을 못 읽으면(2026-10-26) 영상은 이미 채널에 있다 — 실패로 돌리면 기록 없는 공개 영상 + 재시도 중복.
  // 위치 조회를 한 번 더 해 본문을 다시 받고, 그래도 없으면 업로드 목록에서 회수(o.recover)한다.
  const done = async (r: Response | null): Promise<{ ok: true; videoId: string } | { ok: false; error: string }> => {
    const id = r ? extractVideoId(await r.json().catch(() => ({}))) : null;
    if (id) return { ok: true, videoId: id };
    try {
      const q = await queryStatus();
      if (q.status === 200 || q.status === 201) {
        const id2 = extractVideoId(await q.json().catch(() => ({})));
        if (id2) return { ok: true, videoId: id2 };
      }
    } catch { /* 조회 실패 — 업로드 목록 회수로 */ }
    const rec = await o.recover?.().catch(() => null);
    if (rec) {
      console.log(`[youtube] 롱폼 완료 응답 이형 — 채널 업로드 목록에서 회수: ${rec}`);
      return { ok: true, videoId: rec };
    }
    return { ok: false, error: '업로드 응답 이형(id 없음) — 업로드는 끝났을 수 있으니 채널을 확인한 뒤 재시도하세요' };
  };

  const fh = await fs.promises.open(o.videoPath, 'r');
  try {
    let offset = 0;
    let failures = 0;
    while (offset < total) {
      if (o.signal?.aborted) return { ok: false, error: '업로드 중단됨' };
      const end = Math.min(offset + chunk, total) - 1;
      const buf = Buffer.alloc(end - offset + 1);
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      if (bytesRead !== buf.length) return { ok: false, error: '영상 파일 읽기 실패(길이 불일치)' };
      let r: Response | null = null;
      try {
        r = await f(session, {
          method: 'PUT', signal: sig(),
          headers: { Authorization: `Bearer ${access}`, 'Content-Length': String(buf.length), 'Content-Range': `bytes ${offset}-${end}/${total}` },
          body: new Uint8Array(buf.buffer, buf.byteOffset, buf.length),
        });
      } catch (e) {
        if (o.signal?.aborted) return { ok: false, error: '업로드 중단됨' };
        r = null; // 네트워크 오류·청크 시간 초과 — 아래 재개 절차로
        if (failures >= delays.length) return { ok: false, error: `업로드 끊김 — 재시도 ${delays.length}회 실패(${e instanceof Error ? e.message.slice(0, 60) : String(e)})` };
      }
      if (r && (r.status === 200 || r.status === 201)) return await done(r);
      if (r && r.status === 308) {
        offset = nextOffsetFromRange(r.headers.get('range'));
        failures = 0;
        o.onProgress?.(offset, total);
        continue;
      }
      if (r && r.status === 401 && o.refreshAccess && failures < delays.length) {
        failures++;
        access = await o.refreshAccess(); // 토큰 만료 — 세션은 살아 있으니 토큰만 갈고 같은 위치에서 다시
        continue;
      }
      if (r && !(r.status >= 500 && r.status < 600)) {
        if (r.status === 404 || r.status === 410) return { ok: false, error: '업로드 세션 만료 — 처음부터 다시 올리세요' };
        return { ok: false, error: failText(await r.json().catch(() => ({})), r.status) };
      }
      // 5xx·네트워크 오류 — 쉬었다가 서버가 받은 위치를 물어 거기서 잇는다.
      if (failures >= delays.length) return { ok: false, error: `업로드 실패 — 서버 오류로 재시도 ${delays.length}회 소진(${r?.status ?? '네트워크'})` };
      await sleep(delays[failures] ?? 0, o.signal).catch(() => undefined);
      failures++;
      if (o.signal?.aborted) return { ok: false, error: '업로드 중단됨' };
      try {
        const q = await queryStatus();
        if (q.status === 200 || q.status === 201) return await done(q);
        if (q.status === 308) { offset = nextOffsetFromRange(q.headers.get('range')); o.onProgress?.(offset, total); }
        // 그 외(5xx 등)는 위치를 모르는 채로 같은 청크를 다시 보낸다 — 실패 횟수는 이미 셌다.
      } catch { /* 위치 조회 실패 — 같은 청크 재전송 */ }
    }
    // 마지막 청크가 308 로 끝났는데 offset==total 이면 완료 응답을 못 받은 것 — 위치를 한 번 더 묻는다.
    // 이 조회가 끊겨도(2026-10-26) 바이트는 다 갔다 — 예외로 던지지 말고 done 의 회수 절차(재조회·업로드 목록)를 탄다.
    const q = await queryStatus().catch(() => null);
    if (!q || q.status === 200 || q.status === 201) return await done(q);
    return { ok: false, error: `업로드 완료 확인 실패(${q.status})` };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/**
 * 롱폼 유튜브 업로드(2026-10-22) — 재개형 업로드로 처음부터 공개, 끝나면 썸네일(thumbnails.set) 지정.
 * 쇼츠와 달리 가로 영상은 API 썸네일이 그대로 커버가 된다(oardefault 판정·비공개 전환 복구 없음).
 * 명시 실패 반환 — 사람이 누른 발행이라 실패 사유를 그대로 돌려준다. 썸네일 실패는 영상과 별개(thumbnailError).
 */
export async function uploadLongformToYoutube(opts: {
  slug: string; videoPath: string; title: string; description: string; tags: string[];
  thumbnailPath?: string; signal?: AbortSignal;
  onProgress?: (sent: number, total: number) => void;
  /** 테스트용 주입 — 기본은 전역 fetch·16MiB 청크. */
  fetchImpl?: FetchLike; chunkBytes?: number; retryDelaysMs?: number[];
}): Promise<YtUploadResult> {
  try {
    const clientId = getSecret('YOUTUBE_OAUTH_CLIENT_ID') ?? '';
    const clientSecret = getSecret('YOUTUBE_OAUTH_CLIENT_SECRET') ?? '';
    if (!clientId || !clientSecret) return { ok: false, error: '유튜브 OAuth 클라이언트 미설정 — 키 탭에서 입력하세요' };
    const { refreshToken } = getYoutubeAccount(opts.slug);
    if (!refreshToken) return { ok: false, error: '유튜브 채널 미연결 — 채널 연결을 먼저 하세요' };
    if (!fs.existsSync(opts.videoPath)) return { ok: false, error: '영상 파일 없음' };
    const tokenSignal = (): AbortSignal => (opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000));
    const fresh = (): Promise<string> => refreshAccessToken(clientId, clientSecret, refreshToken, tokenSignal());
    const access = await fresh();
    const meta = buildLongformMeta(opts.title, opts.description, opts.tags);
    const sentTitle = String((meta.snippet as { title?: unknown }).title ?? '');
    // 회수 창은 업로드 시작 기준(1분 여유) — 롱폼은 업로드에만 수십 분이 걸려 '지금부터 5분'으로는 놓칠 수 있다.
    const startMs = Date.now();
    const up = await resumableUpload({
      access, videoPath: opts.videoPath, meta,
      signal: opts.signal, onProgress: opts.onProgress, refreshAccess: fresh,
      recover: async () => recoverRecentUpload(opts.slug, await fresh().catch(() => access), sentTitle, startMs - 60_000, { fetchImpl: opts.fetchImpl }),
      fetchImpl: opts.fetchImpl, chunkBytes: opts.chunkBytes, retryDelaysMs: opts.retryDelaysMs,
    });
    if (!up.ok) return { ok: false, error: up.error };
    const id = up.videoId;
    // 업로드가 길어 처음 토큰이 만료됐을 수 있다 — 썸네일은 새 토큰으로(실패하면 처음 토큰으로 시도).
    const thumbAccess = await fresh().catch(() => access);
    const tr = await postThumbnail(thumbAccess, id, opts.thumbnailPath, tokenSignal());
    const thumbnailError = !tr ? undefined
      : tr.error !== undefined ? `썸네일 지정 실패(${tr.error}) — 유튜브 스튜디오에서 썸네일을 직접 올리세요`
        : `썸네일 지정 거절(사유 ${tr.reason}) — 유튜브 스튜디오에서 썸네일을 직접 올리세요`;
    return { ok: true, videoId: id, url: `https://www.youtube.com/watch?v=${id}`, thumbnailError };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('aborted')); return; }
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = (): void => { clearTimeout(t); reject(new Error('aborted')); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/** 공개 썸네일 탐침 — oEmbed 상태 + i.ytimg 이미지 크기(캐시 우회 쿼리). 인증 불필요. */
async function probeThumb(id: string, signal?: AbortSignal): Promise<ThumbState> {
  const bytes = async (u: string): Promise<number> => {
    try { const r = await fetch(`${u}?t=${Date.now()}`, { signal }); return r.ok ? (await r.arrayBuffer()).byteLength : 0; } catch { return 0; }
  };
  let oe = 0;
  try { oe = (await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/shorts/${id}`, { signal })).status; } catch { oe = 0; }
  if (oe !== 200) return 'not_public';
  return classifyThumb(oe, await bytes(`https://i.ytimg.com/vi/${id}/oardefault.jpg`));
}

type YtApiError = { error?: { errors?: Array<{ reason?: string }>; message?: string } };
const apiReason = (j: unknown, status: number): string => (j as YtApiError)?.error?.errors?.[0]?.reason ?? String(status);

/** 공개 여부 변경(videos.update part=status). 권한 부족(insufficientPermissions)이면 'no_scope' — 연결 토큰에 youtube.force-ssl 이 없을 때. */
async function setPrivacy(access: string, id: string, current: Record<string, unknown> | undefined, privacy: 'public' | 'private', signal?: AbortSignal, publishAt?: string): Promise<'ok' | 'no_scope' | string> {
  const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status', {
    method: 'PUT', signal,
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildStatusUpdate(id, current, privacy, publishAt)),
  });
  if (r.ok) return 'ok';
  const j: unknown = await r.json().catch(() => ({}));
  const reason = apiReason(j, r.status);
  if (r.status === 403 && /insufficient/i.test(reason)) return 'no_scope';
  // forbidden 은 권한 부족이 아니라 '연결된 채널이 이 영상의 주인이 아님'이다(2026-10-01 실측: 재연결 때 다른 채널을 골랐다).
  if (r.status === 403 && /forbidden/i.test(reason)) return '공개 전환 거절(forbidden) — 연결된 채널이 이 영상의 채널이 아님, 채널 연결 확인';
  return `공개 전환 실패(${reason})`;
}

export interface YtPublishOutcome {
  /** public = 공개 확인 · scheduled = 권한이 없어 예약 공개 시각에 맡김 · failed = 처리 실패·전환 실패 */
  state: 'public' | 'scheduled' | 'failed';
  thumb: ThumbState | 'unknown';
  /** 썸네일이 없어 비공개→공개를 한 번 더 했는가(08-31 실증 복구 절차). */
  recovered: boolean;
  note: string;
}

/**
 * 업로드 뒤 공개 발행(2026-10-01) — 처리 완료 대기 → 공개 전환 → 썸네일 확인 → 없으면 비공개→(썸네일)→공개 1회 복구.
 * 사람이 누른 업로드의 뒷일이라 호출부는 기다리지 않고(void) 결과만 로그·알림한다. 실패해도 영상은 올라가 있고,
 * 업로드 때 건 예약 공개(publishAt)가 있으면 그 시각에 공개된다.
 */
export async function publishWhenReady(opts: {
  slug: string; videoId: string; thumbnailPath?: string; publishAt?: string;
  log?: (m: string) => void; signal?: AbortSignal;
  /** 테스트용 대기 조정 — 기본은 처리 15초×40회(10분), 썸네일 30초×16회(8분), 예약 공개 뒤 여유 2분. */
  pollMs?: number; processTries?: number; thumbTries?: number; scheduleGraceMs?: number;
}): Promise<YtPublishOutcome> {
  const log = opts.log ?? (() => {});
  const pollMs = opts.pollMs ?? 15_000;
  const thumbMs = opts.pollMs ?? 30_000;
  const id = opts.videoId;
  const waitThumb = async (): Promise<ThumbState> => {
    let t: ThumbState = 'not_public';
    for (let i = 0; i < (opts.thumbTries ?? 16); i++) {
      await sleep(thumbMs, opts.signal);
      t = await probeThumb(id, opts.signal);
      if (t === 'ok') return t;
    }
    return t;
  };
  // 첫 공개 전환이 성공하면 업로드 때 건 예약 공개(publishAt)가 지워진다 — 이후 오류 문구가 '예약 공개될 수 있음'이면 거짓이다.
  let publishAtCleared = false;
  try {
    let access = await youtubeAccessToken(opts.slug, opts.signal);
    // 1) 처리 완료 대기 — 썸네일이 만들어진 뒤(가능하면) 공개로 바꾼다.
    let current: Record<string, unknown> | undefined;
    let processed = false;
    let listError = '';
    for (let i = 0; i < (opts.processTries ?? 40) && !processed; i++) {
      await sleep(pollMs, opts.signal);
      if (i > 0 && i % 20 === 0) access = await youtubeAccessToken(opts.slug, opts.signal); // 토큰 수명 여유
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${id}`, {
        headers: { Authorization: `Bearer ${access}` }, signal: opts.signal,
      });
      const j = await r.json().catch(() => ({})) as { items?: Array<{ status?: Record<string, unknown>; processingDetails?: { processingStatus?: string; thumbnailsAvailability?: string } }> };
      if (!r.ok) { listError = apiReason(j, r.status); continue; }
      const it = j.items?.[0];
      if (!it) continue;
      current = it.status;
      const up = String(it.status?.uploadStatus ?? '');
      if (['failed', 'rejected', 'deleted'].includes(up)) return { state: 'failed', thumb: 'unknown', recovered: false, note: `유튜브 처리 실패(${up}) — 공개 안 함` };
      const pd = it.processingDetails;
      processed = up === 'processed' && (!pd?.thumbnailsAvailability || pd.thumbnailsAvailability === 'available' || i >= 8);
    }
    if (!processed) log(`처리 완료 확인 전에 대기 한도 도달${listError ? `(조회 오류 ${listError})` : ''} — 그대로 공개 전환 시도`);
    // 2) 공개 전환
    const pub = await setPrivacy(access, id, current, 'public', opts.signal);
    if (pub === 'no_scope') {
      const at = opts.publishAt ? Date.parse(opts.publishAt) : NaN;
      if (!Number.isFinite(at)) return { state: 'failed', thumb: 'unknown', recovered: false, note: '채널 권한에 공개 전환이 없음 — 채널 연결을 다시 하세요(스튜디오에서 수동 공개)' };
      log(`채널 권한에 공개 전환이 없음 — 예약 공개(${new Date(at).toISOString().slice(11, 16)}Z)에 맡김. 채널 연결을 다시 하면 바로 공개·썸네일 복구까지 자동`);
      await sleep(Math.max(0, at - Date.now()) + (opts.scheduleGraceMs ?? 120_000), opts.signal);
      const t = await waitThumb();
      return { state: t === 'not_public' ? 'failed' : 'scheduled', thumb: t, recovered: false,
        note: t === 'ok' ? '예약 공개됨 · 썸네일 확인' : t === 'placeholder' ? '예약 공개됐지만 썸네일 없음 — 스튜디오에서 비공개→썸네일 지정→공개(권한이 없어 자동 복구 불가)' : '예약 시각이 지나도 공개 확인 안 됨' };
    }
    if (pub !== 'ok') return { state: 'failed', thumb: 'unknown', recovered: false, note: `${pub} — 예약 공개 시각에 공개될 수 있음` };
    publishAtCleared = true;
    log('공개 전환 완료 — 썸네일 확인 중');
    // 3) 썸네일 확인 → 없으면 08-31 복구 절차(비공개 → 썸네일 지정 → 공개) 한 번
    let t = await waitThumb();
    if (t === 'ok') return { state: 'public', thumb: t, recovered: false, note: '공개 · 썸네일 확인' };
    log(`썸네일 ${t === 'placeholder' ? '없음(회색 자리표시)' : '확인 불가'} — 비공개→공개로 한 번 더(복구 절차)`);
    access = await youtubeAccessToken(opts.slug, opts.signal);
    // 예약 공개를 싣지 않는다 — 이미 공개된 영상이라 invalidPublishAt 으로 거절된다(10-02 실측). 대신 비공개 구간을 짧게
    // 둔다(대기 ≤20초 → 썸네일 지정 → 곧바로 공개). 그 사이 서버가 죽으면 비공개로 남으니 실패 문구가 그걸 알린다.
    const back = await setPrivacy(access, id, current, 'private', opts.signal);
    if (back !== 'ok') {
      return { state: 'public', thumb: t, recovered: false, note: `공개됐지만 썸네일 없음 — 자동 복구 실패(${back}), 스튜디오에서 비공개→썸네일 지정→공개` };
    }
    await sleep(Math.min(pollMs, 20_000), opts.signal);
    const te = await setThumbnail(access, id, opts.thumbnailPath, opts.signal);
    if (te) log(`썸네일 지정 응답: ${te.slice(0, 60)}`);
    const again = await setPrivacy(access, id, current, 'public', opts.signal);
    if (again !== 'ok') return { state: 'failed', thumb: t, recovered: true, note: `복구 중 공개 재전환 실패(${again}) — 영상이 비공개 상태, 스튜디오에서 공개하세요` };
    t = await waitThumb();
    return { state: 'public', thumb: t, recovered: true,
      note: t === 'ok' ? '공개 · 썸네일 복구됨' : '공개됐지만 썸네일이 여전히 없음 — 스튜디오에서 비공개→썸네일 지정→공개' };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 80) : String(e);
    return { state: 'failed', thumb: 'unknown', recovered: false,
      note: publishAtCleared
        ? `공개 처리 중 오류: ${why} — 공개 전환은 이미 됐다. 썸네일 복구 중이었다면 비공개로 남았을 수 있다 — 스튜디오에서 공개 여부·썸네일을 확인하세요`
        : `공개 처리 중 오류: ${why} — 업로드 때 건 예약 공개 시각에 공개된다` };
  }
}

/**
 * 처리 완료 뒤 커버 재지정(2026-10-06 시험, YOUTUBE_SHORTS_RESET_THUMBNAIL) — 업로드 직후의 thumbnails.set 은 200 인데도
 * 쇼츠 탭 커버(oardefault)가 비거나 중간 장면이라 사장님이 매번 손으로 고쳤다. 유튜브가 처리를 끝낸 뒤(processingStatus
 * succeeded) 같은 이미지를 한 번 더 지정해 본다. 결과는 뒤이은 verifyPublicCover 로그로 판정한다. 실패해도 영상은 무관.
 */
export async function resetThumbnailAfterProcessing(opts: {
  slug: string; videoId: string; thumbnailPath?: string; signal?: AbortSignal; pollMs?: number; tries?: number;
}): Promise<string> {
  if (!opts.thumbnailPath || !fs.existsSync(opts.thumbnailPath)) return '커버 이미지 없음 — 재지정 생략';
  try {
    const access = await youtubeAccessToken(opts.slug, opts.signal);
    let status = '';
    for (let i = 0; i < (opts.tries ?? 20) && status !== 'succeeded'; i++) {
      await sleep(opts.pollMs ?? 15_000, opts.signal);
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=processingDetails&id=${opts.videoId}`, {
        headers: { Authorization: `Bearer ${access}` }, signal: opts.signal,
      });
      const j = await r.json().catch(() => ({})) as { items?: Array<{ processingDetails?: { processingStatus?: string } }> };
      status = String(j.items?.[0]?.processingDetails?.processingStatus ?? '');
      if (status === 'failed' || status === 'terminated') return `처리 ${status} — 재지정 생략`;
    }
    const te = await setThumbnail(access, opts.videoId, opts.thumbnailPath, opts.signal);
    const when = status === 'succeeded' ? '처리 완료 뒤' : '처리 완료 확인 전(대기 한도)';
    return te ? `${when} 커버 재지정 실패: ${te.slice(0, 60)}` : `${when} 커버 재지정 200`;
  } catch (e) {
    return `커버 재지정 중단(무해): ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`;
  }
}

export type CoverState = 'first' | 'middle' | 'missing' | 'unknown';
export interface CoverOutcome { state: CoverState; note: string }
/** 커버 확인 결과가 텔레그램 알림감인가(리뷰 2026-10-05) — 확인된 문제(중간 장면·없음)만. unknown(파이썬 없음·조회 실패·
 *  잠정 커버)은 로그만 남긴다 — 판정 못 한 것을 '확인 필요'로 보내면 매 업로드마다 헛알림이 된다. */
export const coverNeedsAlert = (s: CoverState): boolean => s === 'middle' || s === 'missing';

/**
 * 공개 업로드 뒤 쇼츠 커버 확인(2026-10-05, 10-06 정정) — 채널 쇼츠 탭 커버가 첫 장면(디자인 썸네일)인지 그림으로 본다.
 *
 * 쇼츠 탭 커버 = Studio 에서 지정한 sardefault, 없으면 oardefault, 그것도 비면 유튜브가 중간 장면(oar2)을 대신 보여 준다
 * (ok_asis1 studioCover.ts 실측 09-30). 그래서 끝까지 비어 있는 것(missing)도 '중간 장면이 보이는 상태'로 알린다.
 * 비공개로 되돌리는 08-31 복구는 하지 않는다(그 전환이 중간 장면 커버를 만들던 길). check 는 주입(테스트용).
 */
export async function verifyPublicCover(opts: {
  videoId: string; check: (id: string, signal?: AbortSignal) => Promise<{ state: CoverState; cover?: string }>;
  signal?: AbortSignal; pollMs?: number; tries?: number;
}): Promise<CoverOutcome> {
  const pollMs = opts.pollMs ?? 30_000;
  const tries = opts.tries ?? 20;
  let last: CoverState = 'unknown';
  let middleSeen = 0;
  for (let i = 0; i < tries; i++) {
    await sleep(pollMs, opts.signal);
    try { last = (await opts.check(opts.videoId, opts.signal)).state; } catch { last = 'unknown'; }
    if (last === 'first') return { state: 'first', note: '공개 · 쇼츠 탭 커버가 첫 장면(디자인 썸네일)' };
    // 처리 직후 잠깐 다른 프레임이 걸렸다가 바뀌는지 보려고 중간 장면은 두 번 연속 봐야 확정한다.
    if (last === 'middle' && ++middleSeen >= 2) break;
    if (last !== 'middle') middleSeen = 0;
  }
  if (last === 'middle') return { state: 'middle', note: '공개됐지만 쇼츠 탭 커버가 중간 장면 — 유튜브 앱/스튜디오에서 커버를 맨 앞 프레임(0초)으로 지정하세요' };
  if (last === 'missing') return { state: 'missing', note: '공개됐지만 쇼츠 탭 커버가 비어 있음(유튜브가 중간 장면을 대신 보여 줌) — 앱에서 커버를 맨 앞 프레임(0초)으로 지정하세요' };
  return { state: 'unknown', note: '공개됨 · 커버 판정 불가(이미지 조회 실패) — 앱에서 한 번 확인하세요' };
}

export interface YtChannel { id: string; title: string }

/** 이 액세스 토큰의 채널(channels.list mine=true). 채널이 없거나 조회 실패면 null. */
export async function fetchMyChannel(access: string, signal?: AbortSignal): Promise<YtChannel | null> {
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${access}` }, signal });
    const j = await r.json() as { items?: Array<{ id?: string; snippet?: { title?: string } }> };
    const it = j.items?.[0];
    return r.ok && it?.id ? { id: it.id, title: it.snippet?.title ?? it.id } : null;
  } catch { return null; }
}

/** 영상 목록의 다수 채널(순수) — 이 브랜드가 올려 온 채널을 업로드 이력으로 판정한다. 빈 목록이면 null. */
export function majorityChannel(items: ReadonlyArray<{ snippet?: { channelId?: string; channelTitle?: string } }>): YtChannel | null {
  const n = new Map<string, { title: string; count: number }>();
  for (const it of items) {
    const id = it.snippet?.channelId;
    if (!id) continue;
    const e = n.get(id) ?? { title: it.snippet?.channelTitle ?? id, count: 0 };
    e.count++; n.set(id, e);
  }
  let best: YtChannel | null = null; let bestN = 0;
  for (const [id, e] of n) if (e.count > bestN) { best = { id, title: e.title }; bestN = e.count; }
  return best;
}

/** 이 브랜드가 올려 온 채널 — 업로드한 영상(최근 최대 20편)의 채널을 조회해 다수결. 공개 영상은 어느 토큰으로도 보인다. */
export async function channelOfUploads(access: string, videoIds: readonly string[], signal?: AbortSignal): Promise<YtChannel | null> {
  const ids = videoIds.filter(Boolean).slice(0, 20);
  if (!ids.length) return null;
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.map(encodeURIComponent).join(',')}`, { headers: { Authorization: `Bearer ${access}` }, signal });
    if (!r.ok) return null;
    const j = await r.json() as { items?: Array<{ snippet?: { channelId?: string; channelTitle?: string } }> };
    return majorityChannel(j.items ?? []);
  } catch { return null; }
}

/**
 * 채널 연결 보호 장치(순수, 2026-10-01 실사고) — 재연결 때 계정 선택을 잘못하면 다른 채널(그날은 Acoustic AI Singer)로
 * 연결되는데, 완료 화면이 똑같아 티가 안 났다. 그대로 업로드하면 엉뚱한 채널에 올라간다.
 * expected(저장된 채널 → 없으면 업로드 이력의 채널)와 다르면 저장하지 않는다. 채널을 일부러 바꿀 땐 changeChannel.
 */
export function decideChannelConnect(me: YtChannel, expected: YtChannel | null, changeChannel: boolean): { save: boolean; message: string } {
  if (!expected || expected.id === me.id) return { save: true, message: `채널 '${me.title}'` };
  if (changeChannel) return { save: true, message: `채널을 '${expected.title}' → '${me.title}'(으)로 바꿈` };
  return {
    save: false,
    message: `선택한 채널은 '${me.title}'인데, 이 브랜드는 '${expected.title}' 채널에 올려 왔습니다 — 저장하지 않았습니다. ` +
      `계정 선택 화면에서 '${expected.title}' 채널이 있는 구글 계정을 고르세요`,
  };
}

/** 브랜드 채널의 구독자 수 조회 — 팔로워 추적(analytics/followers)용. 미연결·실패는 null(무해). */
export async function fetchYoutubeSubscribers(slug: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const clientId = getSecret('YOUTUBE_OAUTH_CLIENT_ID') ?? '';
    const clientSecret = getSecret('YOUTUBE_OAUTH_CLIENT_SECRET') ?? '';
    const { refreshToken } = getYoutubeAccount(slug);
    if (!clientId || !clientSecret || !refreshToken) return null;
    const sg = signal ?? AbortSignal.timeout(15_000);
    const access = await refreshAccessToken(clientId, clientSecret, refreshToken, sg);
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', {
      headers: { Authorization: `Bearer ${access}` }, signal: sg,
    });
    const j = await r.json() as { items?: Array<{ statistics?: { subscriberCount?: string } }> };
    const n = Number(j.items?.[0]?.statistics?.subscriberCount);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
