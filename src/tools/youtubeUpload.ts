/**
 * 유튜브 숏폼 업로드 — 브랜드별 refresh token(YOUTUBE_TOKENS)으로 access token 을 갱신해
 * videos.insert(multipart)로 비공개(private) 업로드한다.
 * 공개 발행(2026-10-01 사용자 확정, YOUTUBE_PUBLISH_PUBLIC) — 비공개로 올릴 때 예약 공개(publishAt)를 안전망으로 걸고,
 * publishWhenReady 가 처리 완료를 기다려 공개로 바꾼 뒤 썸네일이 실제로 떴는지 확인한다. 공개 상태에서 올리지 않는
 * 이유: 썸네일이 안 붙은 영상은 공개 상태에서 고쳐지지 않고 '비공개 → 공개' 전환 때만 고쳐졌다(2026-08-31 실증).
 * Node 내장 fetch 만 사용(새 의존성 없음). 명시 실패 반환 — 사용자 트리거 액션(fail-open 아님).
 * 재시도 없음(videos.insert = 1600 쿼터단위/건). 토큰·시크릿은 로그·에러에 싣지 않는다.
 */
import fs from 'node:fs';
import { getSecret, getYoutubeAccount } from '../secrets/store';

export interface YtUploadResult { ok: boolean; videoId?: string; url?: string; error?: string; thumbnailError?: string }

/** snippet/status 메타데이터(순수) — 제목 100자·꺾쇠 제거, 설명 5000자, tags ≤15개·30자, private 고정.
 *  blogUrl(파생 쇼츠의 원본 네이버 글, 2026-07-31)은 설명 본문과 태그 사이 클릭 가능한 링크 줄.
 *  publishAt(2026-10-01) — 예약 공개 시각(ISO). 비공개일 때만 걸 수 있고, 그 시각에 유튜브가 스스로 공개한다. */
export function buildVideoMeta(title: string, description: string, hashtags: string[], blogUrl?: string, publishAt?: string): Record<string, unknown> {
  const clean = (s: string): string => s.replace(/[<>]/g, ''); // 유튜브 API 는 제목·설명·태그에 <> 금지
  const t = clean(title).trim().slice(0, 100) || '쇼츠';
  const tagLine = hashtags.filter(Boolean).join(' ');
  const linkLine = blogUrl ? `📖 전체 가이드(블로그): ${blogUrl}` : '';
  const desc = clean([description.trim(), linkLine, tagLine].filter(Boolean).join('\n\n')).slice(0, 5000);
  const tags = hashtags.map((h) => clean(h.replace(/^#/, '')).trim().slice(0, 30)).filter(Boolean).slice(0, 15);
  return {
    snippet: { title: t, description: desc, tags, categoryId: '22' },
    // containsSyntheticMedia: 스튜디오의 'AI 사용(변형·합성 콘텐츠) 공개 — 예' 체크와 동일.
    // 쇼츠는 전량 AI 생성(스크립트·TTS 음성·AI 배경/클립)이라 상시 true — 유튜브 공개 의무 준수.
    status: { privacyStatus: 'private', ...(publishAt ? { publishAt } : {}), selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
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
 * 비공개로 되돌릴 때(썸네일 복구)는 호출부가 새 publishAt 을 준다 — 되돌린 뒤 서버가 죽어도 그 시각에 다시 공개되게.
 */
export function buildStatusUpdate(id: string, current: Record<string, unknown> | undefined, privacy: 'public' | 'private', publishAt?: string): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const k of ['embeddable', 'license', 'publicStatsViewable']) if (current?.[k] !== undefined) keep[k] = current[k];
  const at = privacy === 'private' && publishAt ? { publishAt } : {};
  return { id, status: { ...keep, privacyStatus: privacy, ...at, selfDeclaredMadeForKids: false, containsSyntheticMedia: true } };
}

/** 썸네일 복구로 비공개로 되돌릴 때 거는 예약 공개(분) — 그 사이 서버가 죽어도 영상이 비공개로 남지 않게. */
export const RECOVERY_SAFETY_MIN = 10;

export type ThumbState = 'ok' | 'placeholder' | 'not_public';
/**
 * 공개 썸네일 판정(순수) — oEmbed 가 200 이 아니면 아직 공개 전(비공개 영상은 401/403).
 * 공개인데 이미지가 1,097바이트 회색 자리표시면 썸네일 없음 — 정상은 수십~수백 KB(2026-08-31·10-01 실측).
 */
export function classifyThumb(oembedStatus: number, oarBytes: number, hqBytes: number): ThumbState {
  if (oembedStatus !== 200) return 'not_public';
  return Math.max(oarBytes, hqBytes) > 2000 ? 'ok' : 'placeholder';
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
  /** 예약 공개 시각(ISO) — 공개 발행일 때 안전망(PUBLISH_SAFETY_MIN). 없으면 종전대로 비공개 고정. */
  publishAt?: string;
}): Promise<YtUploadResult> {
  try {
    const clientId = getSecret('YOUTUBE_OAUTH_CLIENT_ID') ?? '';
    const clientSecret = getSecret('YOUTUBE_OAUTH_CLIENT_SECRET') ?? '';
    if (!clientId || !clientSecret) return { ok: false, error: '유튜브 OAuth 클라이언트 미설정 — 키 탭에서 입력하세요' };
    const { refreshToken } = getYoutubeAccount(opts.slug);
    if (!refreshToken) return { ok: false, error: '유튜브 채널 미연결 — 채널 연결을 먼저 하세요' };
    if (!fs.existsSync(opts.videoPath)) return { ok: false, error: '영상 파일 없음' };

    const timeout = AbortSignal.timeout(180_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const access = await refreshAccessToken(clientId, clientSecret, refreshToken, signal);

    const boundary = `yt-${Date.now().toString(36)}-gepa`;
    const body = buildMultipartBody(
      buildVideoMeta(opts.title, opts.description, opts.hashtags, opts.blogUrl, opts.publishAt),
      fs.readFileSync(opts.videoPath), boundary);
    const r = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    const j: unknown = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = (j as { error?: { errors?: Array<{ reason?: string }> } })?.error?.errors?.[0]?.reason ?? String(r.status);
      return { ok: false, error: reason === 'quotaExceeded' ? '유튜브 일일 쿼터 초과 — 내일 재시도' : `업로드 실패(${reason})` };
    }
    const id = extractVideoId(j);
    if (!id) return { ok: false, error: '업로드 응답 이형(id 없음)' };
    // 커스텀 썸네일 설정(best-effort) — 쇼츠는 Data API(thumbnails.set)로 커버 지정이 안 돼 403 이 정상(영상 업로드는 성공).
    // 쇼츠 커버는 스튜디오/앱의 '동영상 프레임' 선택으로만 지정된다(첫 프레임=디자인 썸네일). 실패는 note 만.
    const thumbnailError = await setThumbnail(access, id, opts.thumbnailPath, signal);
    // 쇼츠 분류는 파일(세로 1080×1920·3분 이하)로 자동 판정 — URL 은 표시용이지만 쇼츠 플레이어로 열리게 /shorts/ 형식.
    return { ok: true, videoId: id, url: `https://youtube.com/shorts/${id}`, thumbnailError };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}

/**
 * 커스텀 썸네일 설정(best-effort) — 쇼츠는 Data API(thumbnails.set)로 커버 지정이 안 돼 403 이 정상일 수 있다(영상은 무관).
 * 쇼츠 커버는 스튜디오/앱의 '동영상 프레임' 선택으로만 지정된다(첫 프레임=디자인 썸네일). 실패 사유 문자열, 성공·생략은 undefined.
 */
async function setThumbnail(access: string, id: string, thumbnailPath: string | undefined, signal?: AbortSignal): Promise<string | undefined> {
  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return undefined;
  try {
    const tr = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'image/jpeg' },
      body: fs.readFileSync(thumbnailPath),
    });
    if (tr.ok) return undefined;
    const tj: unknown = await tr.json().catch(() => ({}));
    const reason = (tj as { error?: { errors?: Array<{ reason?: string }> } })?.error?.errors?.[0]?.reason ?? String(tr.status);
    // 403 forbidden 은 채널 미인증뿐 아니라 토큰·권한 문제일 수도 있어 사유를 그대로 노출(영상은 업로드됨).
    return `쇼츠 커버는 API 지정 불가(사유 ${reason}) — 스튜디오/앱에서 '동영상 프레임' 맨 앞(0초=디자인 썸네일)으로 지정`;
  } catch (te) { return te instanceof Error ? te.message.slice(0, 80) : String(te); }
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
  return classifyThumb(oe, await bytes(`https://i.ytimg.com/vi/${id}/oardefault.jpg`), await bytes(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`));
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
    const back = await setPrivacy(access, id, current, 'private', opts.signal,
      new Date(Date.now() + RECOVERY_SAFETY_MIN * 60_000).toISOString());
    if (back !== 'ok') {
      return { state: 'public', thumb: t, recovered: false, note: `공개됐지만 썸네일 없음 — 자동 복구 실패(${back}), 스튜디오에서 비공개→썸네일 지정→공개` };
    }
    await sleep(Math.min(pollMs, 20_000), opts.signal);
    const te = await setThumbnail(access, id, opts.thumbnailPath, opts.signal);
    if (te) log(`썸네일 지정 응답: ${te.slice(0, 60)}`);
    const again = await setPrivacy(access, id, current, 'public', opts.signal);
    if (again !== 'ok') return { state: 'failed', thumb: t, recovered: true, note: `복구 중 공개 재전환 실패(${again}) — 비공개 상태, ${RECOVERY_SAFETY_MIN}분 뒤 예약 공개로 공개된다(안 되면 스튜디오에서 공개)` };
    t = await waitThumb();
    return { state: 'public', thumb: t, recovered: true,
      note: t === 'ok' ? '공개 · 썸네일 복구됨' : '공개됐지만 썸네일이 여전히 없음 — 스튜디오에서 비공개→썸네일 지정→공개' };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 80) : String(e);
    return { state: 'failed', thumb: 'unknown', recovered: false,
      note: publishAtCleared
        ? `공개 처리 중 오류: ${why} — 공개 전환은 이미 됐다. 썸네일 복구 중이었다면 비공개로 되돌렸을 수 있어 ${RECOVERY_SAFETY_MIN}분 뒤 예약 공개에 맡겼다 — 공개·썸네일을 확인하세요`
        : `공개 처리 중 오류: ${why} — 업로드 때 건 예약 공개 시각에 공개된다` };
  }
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
