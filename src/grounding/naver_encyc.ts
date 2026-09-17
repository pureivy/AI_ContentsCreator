/**
 * 네이버 검색 API(지식백과) 커넥터 — NAVER_CLIENT_ID + NAVER_CLIENT_SECRET(naver_search 와 같은 키).
 * 용도: 사실 공급(factSupply)의 1차 출처 — 두산백과·국가생물종지식정보 등 수종 고유 사실이 여기서 나온다.
 * 그라운딩 레지스트리에 등록하지 않는다(같은 키 카드가 UI에 중복되고 이 도구를 가진 역할도 없다) —
 * 코드가 직접 부르는 함수 하나다. 실패·미설정은 [] (fail-open).
 */
import { getSecret } from '../secrets/store';
import { fetchTimeout } from '../util/fetch';
import { stripTags } from './naver_common';

const CID = 'NAVER_CLIENT_ID';
const CSEC = 'NAVER_CLIENT_SECRET';

export interface EncycResult { title: string; link: string; description: string }

export function naverEncycEnabled(): boolean { return !!getSecret(CID) && !!getSecret(CSEC); }

/** 응답 파서(순수) — link 없는 항목은 버린다(출처 URL 이 곧 채택 조건이라 링크 없는 사실은 쓸모가 없다). */
export function parseEncycItems(json: unknown, limit = 5): EncycResult[] {
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: EncycResult[] = [];
  for (const it of items) {
    const o = it as { title?: unknown; link?: unknown; description?: unknown } | null;
    const link = typeof o?.link === 'string' ? o.link.trim() : '';
    if (!link) continue;
    out.push({ title: stripTags(String(o?.title ?? '')), link, description: stripTags(String(o?.description ?? '')) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function naverEncyc(query: string, display = 5, signal?: AbortSignal): Promise<EncycResult[]> {
  const q = query.trim();
  if (!q || !naverEncycEnabled()) return [];
  try {
    const url = `https://openapi.naver.com/v1/search/encyc.json?query=${encodeURIComponent(q)}&display=${display}`;
    const r = await fetchTimeout(url, {
      headers: { 'X-Naver-Client-Id': getSecret(CID)!, 'X-Naver-Client-Secret': getSecret(CSEC)! },
    }, signal);
    if (!r.ok) return [];
    return parseEncycItems(await r.json(), display);
  } catch { return []; }
}
