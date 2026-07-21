/**
 * 유튜브 숏폼 업로드 — 브랜드별 refresh token(YOUTUBE_TOKENS)으로 access token 을 갱신해
 * videos.insert(multipart)로 비공개(private) 업로드. 공개 전환은 항상 사람이 유튜브 스튜디오에서.
 * Node 내장 fetch 만 사용(새 의존성 없음). 명시 실패 반환 — 사용자 트리거 액션(fail-open 아님).
 * 재시도 없음(videos.insert = 1600 쿼터단위/건). 토큰·시크릿은 로그·에러에 싣지 않는다.
 */
import fs from 'node:fs';
import { getSecret, getYoutubeAccount } from '../secrets/store';

export interface YtUploadResult { ok: boolean; videoId?: string; url?: string; error?: string; thumbnailError?: string }

/** snippet/status 메타데이터(순수) — 제목 100자·꺾쇠 제거, 설명 5000자, tags ≤15개·30자, private 고정. */
export function buildVideoMeta(title: string, description: string, hashtags: string[]): Record<string, unknown> {
  const clean = (s: string): string => s.replace(/[<>]/g, ''); // 유튜브 API 는 제목·설명·태그에 <> 금지
  const t = clean(title).trim().slice(0, 100) || '쇼츠';
  const tagLine = hashtags.filter(Boolean).join(' ');
  const desc = clean([description.trim(), tagLine].filter(Boolean).join('\n\n')).slice(0, 5000);
  const tags = hashtags.map((h) => clean(h.replace(/^#/, '')).trim().slice(0, 30)).filter(Boolean).slice(0, 15);
  return {
    snippet: { title: t, description: desc, tags, categoryId: '22' },
    // containsSyntheticMedia: 스튜디오의 'AI 사용(변형·합성 콘텐츠) 공개 — 예' 체크와 동일.
    // 쇼츠는 전량 AI 생성(스크립트·TTS 음성·AI 배경/클립)이라 상시 true — 유튜브 공개 의무 준수.
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  };
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

export async function uploadShortsToYoutube(opts: {
  slug: string; videoPath: string;
  title: string; description: string; hashtags: string[];
  thumbnailPath?: string; signal?: AbortSignal;
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
      buildVideoMeta(opts.title, opts.description, opts.hashtags),
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
    // 커스텀 썸네일 설정(best-effort) — 채널 전화 인증이 안 된 계정은 403(영상 업로드는 이미 성공). 실패는 note 만.
    let thumbnailError: string | undefined;
    if (opts.thumbnailPath && fs.existsSync(opts.thumbnailPath)) {
      try {
        const tr = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}`, {
          method: 'POST', signal,
          headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'image/jpeg' },
          body: fs.readFileSync(opts.thumbnailPath),
        });
        if (!tr.ok) {
          const tj: unknown = await tr.json().catch(() => ({}));
          const reason = (tj as { error?: { errors?: Array<{ reason?: string }> } })?.error?.errors?.[0]?.reason ?? String(tr.status);
          thumbnailError = /forbidden|unverified/i.test(reason) ? '채널 전화 인증 후 커스텀 썸네일 가능(영상은 업로드됨)' : `썸네일 설정 실패(${reason})`;
        }
      } catch (te) { thumbnailError = te instanceof Error ? te.message.slice(0, 80) : String(te); }
    }
    return { ok: true, videoId: id, url: `https://youtube.com/watch?v=${id}`, thumbnailError };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}
