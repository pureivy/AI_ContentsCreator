/**
 * 성과 측정치 저장소 — piece 별 시계열(data/analytics/metrics/<pieceId>.jsonl, append-only).
 * 네이버는 게시물별 공개 API 가 없어, v1 주 경로는 **수동 입력**(사람이 네이버 통계에서 붙여넣기 → POST
 * /pieces/:id/metrics)이고, 브라우저 자동 수집은 스왑 가능한 수집기 뒤에 격리(별도 마일스톤).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

export interface SearchInflow { keyword: string; count: number; rank?: number; }
export interface MetricSample {
  measuredAt: string;
  views: number;
  dwellSec?: number;
  /** 유튜브 쇼츠 수집(youtube:api) 전용 — 네이버 piece 샘플엔 없음(하위호환 optional). */
  likes?: number;
  comments?: number;
  /** 메타(인스타) 수집(meta:ig) 전용 — 도달·저장·공유(하위호환 optional). */
  reach?: number;
  saved?: number;
  shares?: number;
  searchInflow: SearchInflow[];
  /** 'manual' | 'scrape:<collector>' — 수집 출처(신뢰도 구분). */
  source?: string;
}

function metricsDir(): string { return path.join(CONFIG.dataDir, 'analytics', 'metrics'); }
function metricsFile(pieceId: string): string { return path.join(metricsDir(), `${pieceId}.jsonl`); }

/** 측정치 1건 append(append-only 시계열 — 증가는 의도된 것, 재강화는 stage 게이트로 별도 제어). */
export function appendMetrics(pieceId: string, sample: MetricSample): void {
  try {
    fs.mkdirSync(metricsDir(), { recursive: true });
    fs.appendFileSync(metricsFile(pieceId), JSON.stringify(sample) + '\n', 'utf-8');
  } catch { /* 영속 실패 무해 */ }
}
export function readMetrics(pieceId: string): MetricSample[] {
  try {
    return fs.readFileSync(metricsFile(pieceId), 'utf-8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as MetricSample);
  } catch { return []; }
}
export function latestMetrics(pieceId: string): MetricSample | null {
  const all = readMetrics(pieceId);
  return all.length ? all[all.length - 1]! : null;
}
/** 채널별 최신 샘플(순수) — 한 시계열에 youtube:api·meta:ig·meta:fb 가 섞이므로 소스 접두로 갈라 고른다. */
export function latestSampleBySource(samples: MetricSample[], prefix: string): MetricSample | null {
  for (let i = samples.length - 1; i >= 0; i--) {
    if ((samples[i]!.source ?? '').startsWith(prefix)) return samples[i]!;
  }
  return null;
}
export function latestMetricsBySource(pieceId: string, prefix: string): MetricSample | null {
  return latestSampleBySource(readMetrics(pieceId), prefix);
}
/**
 * 채널 조회수 추이(순수, 스파크라인용) — 소스 접두로 거른 샘플을 '하루 1점(그날 마지막 값)'으로 압축.
 * 하루 여러 번 수집돼도 스파크라인이 톱니치지 않게 일 단위 정규화, 최근 maxPoints 일만 반환.
 */
export function viewsSeriesBySource(samples: MetricSample[], prefix: string, maxPoints = 14): number[] {
  const byDay = new Map<string, number>();
  for (const m of [...samples].filter((x) => (x.source ?? '').startsWith(prefix))
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))) {
    byDay.set(m.measuredAt.slice(0, 10), num(m.views)); // 같은 날은 마지막(최신) 값이 덮어씀
  }
  const series = [...byDay.values()];
  return series.length > maxPoints ? series.slice(-maxPoints) : series;
}
export function viewsSeriesFor(pieceId: string, prefix: string, maxPoints = 14): number[] {
  return viewsSeriesBySource(readMetrics(pieceId), prefix, maxPoints);
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function normInflow(v: unknown): SearchInflow | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const keyword = String(o.keyword ?? '').trim();
  if (!keyword) return null;
  const rank = o.rank != null ? num(o.rank) : undefined;
  return { keyword, count: num(o.count), ...(rank ? { rank } : {}) };
}

/**
 * 수동 입력 정규화(v1 주 경로) — {views, dwellSec?, searchInflow:[{keyword,count,rank?}]} JSON 을 안전 파싱.
 * 프론트(6f)는 네이버 통계 붙여넣기(CSV 등)를 이 형태로 변환해 전송한다.
 */
export function parseManualMetrics(input: unknown): MetricSample {
  const o = (input && typeof input === 'object' && !Array.isArray(input)) ? input as Record<string, unknown> : {};
  const inflow = Array.isArray(o.searchInflow)
    ? (o.searchInflow as unknown[]).map(normInflow).filter((x): x is SearchInflow => x !== null)
    : [];
  return {
    measuredAt: new Date().toISOString(),
    views: num(o.views),
    ...(o.dwellSec != null ? { dwellSec: num(o.dwellSec) } : {}),
    searchInflow: inflow,
    source: 'manual',
  };
}
