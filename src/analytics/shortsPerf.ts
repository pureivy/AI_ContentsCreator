/**
 * 유튜브 쇼츠 성과 수집·강화 — 업로드된 쇼츠(youtubeId·youtubeTs)의 조회수·좋아요·댓글을
 * videos.list(YOUTUBE_API_KEY, 50개 배치=1쿼터단위)로 매일 수집해 기존 시계열(appendMetrics)에
 * 쌓고, 측정창(SHORTS_PERF_DAYS) 경과 시 1회 강화(shorts_writer·shorts_director 메모리+위키,
 * perfReflected 멱등). 비공개 영상은 API 가 통계를 안 주므로 자동 스킵 — 공개 전환 후 재개(스펙 §9).
 * 전량 fail-open — 실패는 해당 쇼츠만 스킵, 다음 틱 재시도. reinforceFromPerformance(piece)의 사촌.
 */
import { CONFIG } from '../config';
import { getSecret } from '../secrets/store';
import { fetchTimeout } from '../util/fetch';
import { appendMetrics, type MetricSample } from './performance';
import { shortsStore, type Shorts } from '../content/shorts';
import { llmWiki } from '../wiki/llmwiki';
import { appendMemory, appendActivity } from '../agents/workspace';
import { pieceStore } from '../content/pieces';

export interface VideoStats { views: number; likes: number; comments: number }

/** 쇼츠 성과 → 0~1 스칼라(순수) — views 로그 스케일(1만뷰≈1.0) 0.8 + 좋아요율(1%≈만점) 0.2. */
export function shortsSignal(views: number, likes: number): number {
  const viewScore = Math.min(1, Math.log10(Math.max(0, views) + 1) / 4);
  const likeScore = views > 0 ? Math.min(1, likes / views / 0.01) : 0;
  return 0.8 * viewScore + 0.2 * likeScore;
}

/** videos.list 응답 → videoId→통계 Map(순수) — 이형·결측·음수 방어. */
export function parseStatsResponse(json: unknown): Map<string, VideoStats> {
  const out = new Map<string, VideoStats>();
  const items = (json as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return out;
  const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };
  for (const it of items) {
    const o = it as { id?: unknown; statistics?: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown } };
    const id = typeof o?.id === 'string' ? o.id : '';
    if (!id) continue;
    out.set(id, { views: n(o.statistics?.viewCount), likes: n(o.statistics?.likeCount), comments: n(o.statistics?.commentCount) });
  }
  return out;
}

/** 이번 틱 수집 대상인가(순수) — 창 내 매일, 또는 창 경과 후 미강화(강화 기회 유실 방지). */
export function shortsPerfDue(s: Pick<Shorts, 'youtubeId' | 'youtubeTs' | 'perfReflected'>, now: number, days: number): boolean {
  if (!s.youtubeId || !s.youtubeTs) return false;
  const t = new Date(s.youtubeTs).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t <= days * 86_400_000 || !s.perfReflected;
}

/** videos.list 50개 배치 — 키 없으면 빈 Map. HTTP 오류는 throw(호출자 fail-open). */
async function fetchVideoStats(videoIds: string[], signal?: AbortSignal): Promise<Map<string, VideoStats>> {
  const key = getSecret('YOUTUBE_API_KEY');
  const out = new Map<string, VideoStats>();
  if (!key || !videoIds.length) return out;
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50).join(',');
    const r = await fetchTimeout(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${encodeURIComponent(key)}`, {}, signal);
    if (!r.ok) throw new Error(`videos.list HTTP ${r.status}`);
    for (const [id, st] of parseStatsResponse(await r.json())) out.set(id, st);
  }
  return out;
}

/** 강화 1회 — reinforceFromPerformance(piece) 미러. 역할 부재·위키 실패는 무해. */
function reinforceShorts(s: Shorts, m: MetricSample): void {
  const signal = shortsSignal(m.views, m.likes ?? 0);
  const keyword = s.sourcePieceId
    ? (() => { try { return pieceStore().get(s.sourcePieceId!)?.keyword; } catch { return undefined; } })() ?? s.keyword
    : s.keyword;
  const title = s.title ?? s.topic;
  const verdict = signal >= 0.6 ? '이 주제·구성이 노출로 이어짐 — 유사 각도 유지' : '노출 저조 — 훅·주제 각도 재고';
  for (const role of ['shorts_writer', 'shorts_director']) {
    try {
      appendMemory(role, `쇼츠 성과: "${title}"${keyword ? ` (키워드 "${keyword}")` : ''} — 조회 ${m.views}·좋아요 ${m.likes ?? 0}, 성과신호 ${signal.toFixed(2)}. ${verdict}.`);
      appendActivity(role, `📈 쇼츠 성과 학습: ${title.slice(0, 40)}`);
    } catch { /* 역할 부재 등 — 무해 */ }
  }
  try {
    llmWiki().upsertPage({
      title: `쇼츠 성과: ${title}`, type: 'performance',
      body:
        `조회 ${m.views}회 · 좋아요 ${m.likes ?? 0} · 댓글 ${m.comments ?? 0} · 성과신호 ${signal.toFixed(2)}\n` +
        `키워드: ${keyword ?? '-'} · 브랜드: ${s.brand ?? '범용'}\n` +
        (s.youtubeUrl ? `\n[근거: ${s.youtubeUrl}]` : ''),
      summary: `쇼츠 "${title}" 성과신호 ${signal.toFixed(2)} (조회 ${m.views})`,
      sources: [s.youtubeUrl ? `perf:${s.youtubeUrl}` : 'perf:youtube'],
      aliases: keyword ? [keyword] : [],
    });
  } catch { /* 위키 실패는 강화를 막지 않음 */ }
}

/** 일일 쇼츠 성과 동기화 — perf-sync 틱에서 piece 동기화와 나란히 호출(Task 3). */
export async function syncShortsPerformance(): Promise<void> {
  try {
    if (!getSecret('YOUTUBE_API_KEY')) return; // 커넥터 키 없음 — no-op
    const days = CONFIG.shortsPerfDays;
    const now = Date.now();
    const due = shortsStore().list().filter((s) => shortsPerfDue(s, now, days));
    if (!due.length) return;
    const stats = await fetchVideoStats(due.map((s) => s.youtubeId!));
    for (const s of due) {
      try {
        const st = stats.get(s.youtubeId!);
        if (!st) { console.log('[perf-sync]', `쇼츠 ${s.id} 통계 없음(비공개/삭제) — 스킵`); continue; }
        const sample: MetricSample = {
          measuredAt: new Date().toISOString(), views: st.views, likes: st.likes, comments: st.comments,
          searchInflow: [], source: 'youtube:api',
        };
        appendMetrics(s.id, sample);
        const windowOver = now - new Date(s.youtubeTs!).getTime() > days * 86_400_000;
        if (windowOver && !s.perfReflected) {
          reinforceShorts(s, sample);
          shortsStore().update(s.id, { perfReflected: true });
          console.log('[perf-sync]', `쇼츠 강화 완료: ${(s.title ?? s.topic).slice(0, 30)} (신호 ${shortsSignal(st.views, st.likes).toFixed(2)})`);
        }
      } catch (e) { console.log('[perf-sync]', `쇼츠 ${s.id} 실패(무해): ${e instanceof Error ? e.message : String(e)}`); }
    }
  } catch (e) { console.log('[perf-sync]', `쇼츠 동기화 실패(무해): ${e instanceof Error ? e.message : String(e)}`); }
}
