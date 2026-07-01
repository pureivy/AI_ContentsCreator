/**
 * 네이버 검색광고(SearchAd) 키워드도구 커넥터 — 실제 월간 검색량 + 경쟁지수.
 * 활성: NAVER_SEARCHAD_API_KEY + NAVER_SEARCHAD_SECRET_KEY + NAVER_SEARCHAD_CUSTOMER_ID.
 * 발급: https://searchad.naver.com → 도구 → API 사용 관리 (광고비 불필요).
 *
 * 인증(HMAC-SHA256): message = `${timestamp}.${method}.${uri}` (uri=쿼리 제외 경로),
 *   signature = Base64(HMAC-SHA256(message, secretKey)). 헤더 X-Timestamp/X-API-KEY/X-Customer/X-Signature.
 */
import crypto from 'node:crypto';
import { getSecret } from '../secrets/store';
import { fetchTimeout } from '../util/fetch';
import { registerConnector } from './registry';
import { seedKeyword, toInt, GROUND_CAP } from './naver_common';

const APIKEY = 'NAVER_SEARCHAD_API_KEY';
const SECRET = 'NAVER_SEARCHAD_SECRET_KEY';
const CUSTOMER = 'NAVER_SEARCHAD_CUSTOMER_ID';
const BASE = 'https://api.searchad.naver.com';

export function searchAdEnabled(): boolean {
  return !!getSecret(APIKEY) && !!getSecret(SECRET) && !!getSecret(CUSTOMER);
}

function sign(timestamp: string, method: string, uri: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${method}.${uri}`).digest('base64');
}

export interface KeywordVolume {
  keyword: string;
  pc: number;      // 월간 PC 검색수
  mobile: number;  // 월간 모바일 검색수
  total: number;   // pc + mobile
  comp: string;    // 경쟁정도(낮음/중간/높음)
}

/**
 * 힌트 키워드로 연관 키워드 + 월간 검색량·경쟁도 조회. discover 파이프라인·ground() 공용.
 * hintKeywords 는 공백 없는 키워드(최대 5개). 실패 시 []. (연관어 포함 다수 반환 → total 내림차순)
 */
export async function searchAdVolumes(hints: string[], signal?: AbortSignal): Promise<KeywordVolume[]> {
  if (!searchAdEnabled()) return [];
  const seeds = hints.map((h) => h.replace(/\s+/g, '')).filter(Boolean).slice(0, 5);
  if (!seeds.length) return [];
  const uri = '/keywordstool';
  const ts = Date.now().toString();
  const sig = sign(ts, 'GET', uri, getSecret(SECRET)!);
  const url = `${BASE}${uri}?hintKeywords=${encodeURIComponent(seeds.join(','))}&showDetail=1`;
  const r = await fetchTimeout(url, {
    headers: {
      'X-Timestamp': ts,
      'X-API-KEY': getSecret(APIKEY)!,
      'X-Customer': getSecret(CUSTOMER)!,
      'X-Signature': sig,
    },
  }, signal);
  if (!r.ok) return [];
  const j = await r.json() as { keywordList?: Array<{ relKeyword?: string; monthlyPcQcCnt?: unknown; monthlyMobileQcCnt?: unknown; compIdx?: string }> };
  return (j.keywordList ?? [])
    .map((k) => {
      const pc = toInt(k.monthlyPcQcCnt);
      const mobile = toInt(k.monthlyMobileQcCnt);
      return { keyword: (k.relKeyword ?? '').trim(), pc, mobile, total: pc + mobile, comp: (k.compIdx ?? '').trim() || '-' };
    })
    .filter((k) => k.keyword)
    .sort((a, b) => b.total - a.total);
}

async function ground(query: string, signal?: AbortSignal): Promise<string> {
  if (!searchAdEnabled()) return '';
  const seed = seedKeyword(query);
  try {
    const vols = await searchAdVolumes([seed], signal);
    if (!vols.length) return '';
    const rows = vols.slice(0, 8).map((v) => `· ${v.keyword} — 월 ${v.total.toLocaleString()}회(PC ${v.pc.toLocaleString()}/모바일 ${v.mobile.toLocaleString()}), 경쟁 ${v.comp}`).join('\n');
    return `검색광고 실검색량 — 시드 "${seed}"의 연관 키워드(월간 검색수·경쟁도):\n${rows}`.slice(0, GROUND_CAP);
  } catch { return ''; }
}

registerConnector({
  id: 'naver_searchad',
  keyDef: {
    key: APIKEY,
    label: '네이버 검색광고 (실검색량)',
    icon: '📈',
    desc: '검색광고 키워드도구 — 실제 월간 검색량·경쟁도. SECRET_KEY·CUSTOMER_ID 도 함께 설정',
    placeholder: 'SearchAd 액세스 라이선스',
  },
  blockLabel: '[검색광고 실검색량]',
  scope: ['naver_searchad'], // SEO 역할(naver_searchad 툴 보유)에만 주입
  enabled: searchAdEnabled,
  ground,
});
