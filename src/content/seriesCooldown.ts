/**
 * 수종 계열 쿨다운(2026-08-24 사용자 지시) — 같은 수종(계열) 주제가 짧은 기간 연속 채택되는 것을 막는다.
 * 실사고: 포도나무 글 4편/6일 — 시드 상주 + 트렌드 자동완성 + 리서치 기회 판정이 같은 계열을 동시에
 * 밀었고(신호는 전부 옳았다), 유사 폴백까지 채택해 줬는데 '계열 연속 억제' 장치가 없었다.
 *
 * 계열 키 = 'XX나무' 어간(포도나무→포도, 블루베리나무→블루베리) — 언어 규칙 추출이라 브랜드 소재를
 * 코드에 박지 않는다(브랜드 오염 금지 원칙). 총칭 어간(과실·유실·조경 등)은 계열이 아니므로 제외.
 * 판정은 최근 창(기본 7일) 내 같은 계열 blog piece 가 cap(기본 2)편 이상일 때 발동 — 시간이 지나면
 * 자연 해제된다(영구 금지가 아니라 편중 완화).
 */
import { pieceStore } from './pieces';

/** 계열이 아닌 총칭·범주 어간 — 'XX나무' 꼴이지만 특정 수종을 지칭하지 않는 한국어 일반 어휘. */
const GENERIC_STEMS = new Set(['과실', '유실', '조경', '정원', '낙엽', '상록', '침엽', '활엽', '어린', '가로수']);

/** 계열 어간 추출(순수, 테스트 대상) — 공백 무시 'XX나무' 패턴의 어간(2~8자), 총칭 제외. */
export function seriesStems(text: string): string[] {
  const t = (text || '').normalize('NFC').replace(/\s+/g, '');
  const out = new Set<string>();
  for (const m of t.matchAll(/([가-힣]{2,8})나무/g)) {
    const stem = m[1]!;
    if (!GENERIC_STEMS.has(stem)) out.add(stem);
  }
  return [...out];
}

/**
 * 쿨다운 판정(순수, 테스트 대상) — recent 에서 계열 어간별 편수를 세고, 후보 텍스트에 그 어간이
 * 들어 있으며 편수가 cap 이상인 계열 어간을 반환(없으면 null). 후보에 '나무' 접미가 없어도
 * ("포도 수확 후 관리") 최근 편의 어간('포도')과 포함 대조로 걸린다.
 */
export function seriesCooldownHit(
  candidateText: string,
  recent: Array<{ text: string; createdTs: string }>,
  opts: { days?: number; cap?: number; now?: number } = {},
): string | null {
  const { days = 7, cap = 2, now = Date.now() } = opts;
  const cutoff = now - days * 86_400_000;
  const cand = (candidateText || '').normalize('NFC').replace(/\s+/g, '');
  if (!cand) return null;
  const counts = new Map<string, number>();
  for (const r of recent) {
    const t = new Date(r.createdTs).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    for (const stem of seriesStems(r.text)) counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [stem, n] of counts) {
    if (n >= cap && cand.includes(stem) && (best === null || n > (counts.get(best) ?? 0))) best = stem;
  }
  return best;
}

/** 실적재 판정 — 활성 브랜드의 blog piece 이력으로 계산. 실패는 무해(null=쿨다운 없음, fail-open). */
export function seriesCooldownFor(candidateText: string, brandSlug?: string): string | null {
  try {
    const recent = pieceStore().list()
      .filter((p) => (p.brand ?? '') === (brandSlug ?? ''))
      .map((p) => ({ text: `${p.title} ${p.keyword ?? ''}`, createdTs: p.createdTs }));
    return seriesCooldownHit(candidateText, recent);
  } catch { return null; }
}

/** 현재 쿨다운 중인 계열 어간 목록 — 프롬프트 회피 목록·트렌드 시드 제외에 쓴다. 실패는 빈 배열. */
export function cooledSeries(brandSlug?: string, opts: { days?: number; cap?: number; now?: number } = {}): string[] {
  try {
    const { days = 7, cap = 2, now = Date.now() } = opts;
    const cutoff = now - days * 86_400_000;
    const counts = new Map<string, number>();
    for (const p of pieceStore().list()) {
      if ((p.brand ?? '') !== (brandSlug ?? '')) continue;
      const t = new Date(p.createdTs).getTime();
      if (!Number.isFinite(t) || t < cutoff) continue;
      for (const stem of seriesStems(`${p.title} ${p.keyword ?? ''}`)) counts.set(stem, (counts.get(stem) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n >= cap).map(([s]) => s);
  } catch { return []; }
}
