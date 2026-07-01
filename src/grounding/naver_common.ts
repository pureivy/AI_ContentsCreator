/**
 * 네이버 SEO 커넥터 공용 유틸 — 시드 키워드 추출·숫자 파싱·태그 제거.
 * 각 커넥터(naver_search/searchad/datalab/autocomplete)와 discover 파이프라인이 공유.
 */

/** 블로그 글감(문장)에서 검색 API 용 핵심 키워드 근사 추출 — 하우투/트렌드 접미 제거. */
export function seedKeyword(query: string): string {
  const first = (query.split('\n')[0] ?? query).trim();
  const stripped = first
    .replace(/\s*(하는\s*법|하는법|방법|팁|정리|총정리|추천|비교|후기|가격|순위|리뷰)\s*$/g, '')
    .trim();
  return (stripped || first).slice(0, 30).trim();
}

/** "1,234" · "< 10" · number → 정수(비숫자 제거). SearchAd 저조검색 "< 10" 은 ~10 으로 근사. */
export function toInt(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/[^\d]/g, '');
  return s ? parseInt(s, 10) : 0;
}

/** HTML 태그·엔티티 제거(네이버 검색 결과 title 은 <b> 강조 포함). */
export function stripTags(s: string): string {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 커넥터 ground() 주입 텍스트 상한(프리필 비용 억제). config 노브가 없으면 800. */
export const GROUND_CAP = 800;
