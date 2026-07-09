/**
 * 카드뉴스 메타 성과 수집·강화 — 발행된 카드뉴스(igMediaId·publishedTs)의 IG 인사이트
 * (views·reach·saved·shares·likes·comments)와 FB 반응을 매일 수집해 시계열(appendMetrics)에
 * 쌓고, 측정창(shortsPerfDays 재사용) 경과 시 1회 강화(cardnews_planner·designer 메모리+위키,
 * perfReflected 멱등). 전량 fail-open — shortsPerf.ts 의 사촌(스펙 §7).
 */
import { CONFIG } from '../config';
import { fetchTimeout } from '../util/fetch';
import { getMetaAccount } from '../secrets/store';
import { GRAPH } from '../tools/metaPublish';
import { appendMetrics, readMetrics, type MetricSample } from './performance';
import { shouldRecordMemory } from './shortsPerf';
import { cardNewsStore, type CardNews } from '../content/cardnews';
import { isSafeBrandSlug } from '../content/brand';
import { llmWikiFor } from '../wiki/llmwiki';
import { appendMemory, appendActivity } from '../agents/workspace';

/** 카드뉴스 성과 → 0~1 스칼라(순수) — 도달 로그 0.4 + 저장률(2%≈만점) 0.35 + 공유율(1%≈만점) 0.25.
 *  perf_analyst 진단 기준(저장=실용 가치·공유=공감 가치 중심)과 일치, 강화 임계 0.6 규약 공유. */
export function cardnewsSignal(reach: number, saved: number, shares: number): number {
  const reachScore = Math.min(1, Math.log10(Math.max(0, reach) + 1) / 4); // 1만 도달 ≈ 1.0
  const savedRate = reach > 0 ? Math.min(1, saved / reach / 0.02) : 0;
  const shareRate = reach > 0 ? Math.min(1, shares / reach / 0.01) : 0;
  return 0.4 * reachScore + 0.35 * savedRate + 0.25 * shareRate;
}
/** IG insights 응답 → {지표명: 값}(순수) — 이형·결측·음수 방어. */
export function parseIgInsights(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return out;
  for (const it of data) {
    const o = it as { name?: unknown; values?: Array<{ value?: unknown }> };
    if (typeof o?.name !== 'string') continue;
    const v = Number(o.values?.[0]?.value);
    out[o.name] = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  return out;
}
/** FB 게시물 필드 응답 → 반응·댓글·공유 수(순수). */
export function parseFbEngagement(json: unknown): { likes: number; comments: number; shares: number } {
  const o = json as {
    reactions?: { summary?: { total_count?: unknown } };
    comments?: { summary?: { total_count?: unknown } };
    shares?: { count?: unknown };
  } | null;
  const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };
  return { likes: n(o?.reactions?.summary?.total_count), comments: n(o?.comments?.summary?.total_count), shares: n(o?.shares?.count) };
}
/** 이번 틱 수집 대상인가(순수) — shortsPerfDue 미러(igMediaId·publishedTs 기준, 포기 지평 4배). */
export function cardnewsPerfDue(
  c: Pick<CardNews, 'igMediaId' | 'publishedTs' | 'perfReflected'>, now: number, days: number,
): boolean {
  if (!c.igMediaId || !c.publishedTs) return false;
  const t = new Date(c.publishedTs).getTime();
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  if (age > days * 4 * 86_400_000) return false;
  return age <= days * 86_400_000 || !c.perfReflected;
}
