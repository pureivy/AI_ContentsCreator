/**
 * 네이버 데이터랩(검색어트렌드) 커넥터 — NAVER_CLIENT_ID + NAVER_CLIENT_SECRET(검색 API 와 동일 키).
 * 용도: 키워드의 상대적 검색 트렌드(0~100 비율, 시간축) — 절대량이 아닌 '방향(상승/하락)'.
 * (절대 검색량은 naver_searchad 로. 데이터랩은 트렌드 방향 보조.)  POST /v1/datalab/search.
 */
import { getSecret } from '../secrets/store';
import { fetchTimeout } from '../util/fetch';
import { registerConnector } from './registry';
import { seedKeyword, GROUND_CAP } from './naver_common';

const CID = 'NAVER_CLIENT_ID';
const CSEC = 'NAVER_CLIENT_SECRET';
export function datalabEnabled(): boolean { return !!getSecret(CID) && !!getSecret(CSEC); }

export interface TrendPoint { period: string; ratio: number }
export interface KeywordTrend { keyword: string; points: TrendPoint[]; direction: '상승' | '하락' | '보합' }

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

/** 최근 N개월 월간 검색어트렌드(상대 0~100). discover·ground() 공용. 실패 시 []. */
export async function datalabTrend(keywords: string[], months = 6, signal?: AbortSignal): Promise<KeywordTrend[]> {
  if (!datalabEnabled()) return [];
  const kws = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 5);
  if (!kws.length) return [];
  const end = new Date();
  const start = new Date(); start.setMonth(start.getMonth() - months);
  const body = {
    startDate: ymd(start), endDate: ymd(end), timeUnit: 'month',
    keywordGroups: kws.map((k) => ({ groupName: k, keywords: [k] })),
  };
  const r = await fetchTimeout('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: { 'X-Naver-Client-Id': getSecret(CID)!, 'X-Naver-Client-Secret': getSecret(CSEC)!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, signal);
  if (!r.ok) return [];
  const j = await r.json() as { results?: Array<{ title?: string; data?: Array<{ period?: string; ratio?: number }> }> };
  return (j.results ?? []).map((res) => {
    const points = (res.data ?? []).map((d) => ({ period: d.period ?? '', ratio: typeof d.ratio === 'number' ? d.ratio : 0 }));
    const first = points[0]?.ratio ?? 0;
    const last = points[points.length - 1]?.ratio ?? 0;
    const direction: KeywordTrend['direction'] = last > first * 1.1 ? '상승' : last < first * 0.9 ? '하락' : '보합';
    return { keyword: (res.title ?? '').trim(), points, direction };
  });
}

async function ground(query: string, signal?: AbortSignal): Promise<string> {
  if (!datalabEnabled()) return '';
  const kw = seedKeyword(query);
  try {
    const trends = await datalabTrend([kw], 6, signal);
    if (!trends.length || !trends[0]!.points.length) return '';
    const t = trends[0]!;
    const spark = t.points.map((p) => `${p.period.slice(2, 7)}:${Math.round(p.ratio)}`).join(' ');
    return `검색어트렌드 "${t.keyword}" — 최근 6개월 방향: ${t.direction} (상대지수 0~100)\n${spark}`.slice(0, GROUND_CAP);
  } catch { return ''; }
}

registerConnector({
  id: 'naver_datalab',
  keyDef: {
    key: CSEC,
    label: '네이버 데이터랩 (Client Secret)',
    icon: '🟢',
    desc: '데이터랩 검색어트렌드 — 키워드 상승/하락 방향(검색 API 와 동일 키)',
    placeholder: '네이버 개발자 Client Secret',
  },
  blockLabel: '[검색어트렌드(데이터랩)]',
  scope: ['naver_datalab'], // 트렌드 리서처 역할에만 주입
  enabled: datalabEnabled,
  ground,
});
