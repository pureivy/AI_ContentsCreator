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
import { appendMetrics, readMetrics, type MetricSample } from './performance';
import { shortsStore, type Shorts } from '../content/shorts';
import { isSafeBrandSlug } from '../content/brand';
import { llmWikiFor } from '../wiki/llmwiki';
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
  const age = now - t;
  if (age > days * 4 * 86_400_000) return false; // 포기 지평(측정창 4배) — 영구 비공개/삭제 영상 무한 재시도 방지
  return age <= days * 86_400_000 || !s.perfReflected;
}

/**
 * 강화 시 역할 메모리 기록 여부(순수) — 긍정(≥0.6)은 즉시, 부정은 공개 상태 실측 2틱 이상일 때만.
 * 비공개→늦공개 쇼츠가 공개 직후 낮은 조회수로 "저조" 오귀속되는 것을 차단(스펙 §9 상호작용).
 * 위키 적재는 이 게이트와 무관하게 항상 수행(수치 보존).
 */
export function shouldRecordMemory(signal: number, publicSampleCount: number): boolean {
  return signal >= 0.6 || publicSampleCount >= 2;
}

/** 소스별 샘플 수(순수) — 유튜브·메타 샘플이 한 JSONL 에 공존하므로 게이트 카운트는 소스 필터 필수
 *  (무필터 시 메타 샘플 혼입으로 카운트가 부풀어 비공개→늦공개 오귀속 방지 게이트가 무력화됨, 스펙 §4.3). */
export function countSamples(samples: Pick<MetricSample, 'source'>[], source: string): number {
  return samples.filter((s) => s.source === source).length;
}

/** 이번 틱 메타(릴스) 수집 대상인가(순수) — shortsPerfDue 의 메타 채널 판. 유튜브 창과 독립. */
export function shortsMetaPerfDue(
  s: Pick<Shorts, 'igReelId' | 'metaPublishedTs' | 'metaPerfReflected'>, now: number, days: number,
): boolean {
  if (!s.igReelId || !s.metaPublishedTs) return false;
  const t = new Date(s.metaPublishedTs).getTime();
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  if (age > days * 4 * 86_400_000) return false; // 포기 지평(측정창 4배) — 삭제 릴스 무한 재시도 방지
  return age <= days * 86_400_000 || !s.metaPerfReflected;
}

/** videos.list 50개 배치 — 키 없으면 빈 Map. 배치별 fail-open — 성공한 배치는 보존. */
async function fetchVideoStats(videoIds: string[], signal?: AbortSignal): Promise<Map<string, VideoStats>> {
  const key = getSecret('YOUTUBE_API_KEY');
  const out = new Map<string, VideoStats>();
  if (!key || !videoIds.length) return out;
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50).join(',');
    try {
      const r = await fetchTimeout(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${encodeURIComponent(key)}`, {}, signal);
      if (!r.ok) throw new Error(`videos.list HTTP ${r.status}`);
      for (const [id, st] of parseStatsResponse(await r.json())) out.set(id, st);
    } catch (e) { // 배치별 fail-open — 성공한 배치 결과는 보존, 실패분은 다음 틱 재시도
      console.log('[perf-sync]', `videos.list 배치 실패(해당 ≤50건 이번 틱 스킵): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/** 강화 1회 — reinforceFromPerformance(piece) 미러. 역할 부재·위키 실패는 무해. 신호를 반환. */
function reinforceShorts(s: Shorts, m: MetricSample): number {
  const signal = shortsSignal(m.views, m.likes ?? 0);
  const keyword = s.sourcePieceId
    ? (() => { try { return pieceStore().get(s.sourcePieceId!)?.keyword; } catch { return undefined; } })() ?? s.keyword
    : s.keyword;
  const brand = s.brand && isSafeBrandSlug(s.brand) ? s.brand : ''; // 경로 싱크 재검증(관례) — 비정상 슬러그는 범용 강등
  const title = s.title ?? s.topic;
  const verdict = signal >= 0.6 ? '이 주제·구성이 노출로 이어짐 — 유사 각도 유지' : '노출 저조 — 훅·주제 각도 재고';
  if (shouldRecordMemory(signal, countSamples(readMetrics(s.id), 'youtube:api'))) {
    for (const role of ['shorts_writer', 'shorts_director']) {
      try {
        appendMemory(role, `쇼츠 성과: "${title}"${keyword ? ` (키워드 "${keyword}")` : ''} — 조회 ${m.views}·좋아요 ${m.likes ?? 0}, 성과신호 ${signal.toFixed(2)}. ${verdict}.`, brand);
        appendActivity(role, `📈 쇼츠 성과 학습: ${title.slice(0, 40)}`);
      } catch { /* 역할 부재 등 — 무해 */ }
    }
  }
  try {
    llmWikiFor(brand).upsertPage({
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
  return signal;
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
          const sig = reinforceShorts(s, sample);
          shortsStore().update(s.id, { perfReflected: true });
          console.log('[perf-sync]', `쇼츠 강화 완료: ${(s.title ?? s.topic).slice(0, 30)} (신호 ${sig.toFixed(2)})`);
        }
      } catch (e) { console.log('[perf-sync]', `쇼츠 ${s.id} 실패(무해): ${e instanceof Error ? e.message : String(e)}`); }
    }
  } catch (e) { console.log('[perf-sync]', `쇼츠 동기화 실패(무해): ${e instanceof Error ? e.message : String(e)}`); }
}
