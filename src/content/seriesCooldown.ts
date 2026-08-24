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

/** 행위 축(2026-08-24 사용자 지적) — 수종을 바꿔도 같은 '행위' 반복이면 편중이다(실측: 전정·가지치기
 *  계열 6편/7일 — 나무전정방법·수종별 전정시기·순 정리·가지 정리법·가지 정리·과실나무 전정).
 *  원예 일반 어휘의 동의어 묶음이라 브랜드 소재 하드코딩이 아니다. 새 행위 축은 여기 한 줄로 추가.
 *  용어는 공백 제거 후 포함 대조 — '가지' 단독은 "세 가지" 오탐이 있어 넣지 않는다(합성어만). */
const ACTIVITY_AXES: Array<{ id: string; terms: string[] }> = [
  { id: '전정·가지치기', terms: ['전정', '가지치기', '가지정리', '도장지', '순정리'] },
];
const AXIS_BY_ID = new Map(ACTIVITY_AXES.map((a) => [a.id, a]));

/** 키 매칭(공백 제거 텍스트 기준) — 수종 키는 어간 포함, 행위 축 키는 동의어 중 하나 포함. */
function matchesKey(strippedText: string, key: string): boolean {
  const axis = AXIS_BY_ID.get(key);
  return axis ? axis.terms.some((t) => strippedText.includes(t)) : strippedText.includes(key);
}

/** 계열 어간 추출(순수, 테스트 대상) — 공백 무시 'XX나무' 어간(2~8자, 총칭 제외) + 'XX베리' 전체어.
 *  베리 패턴(2026-08-24 보강): 블루베리·하스카프베리류는 '나무' 없이 쓰이는 게 보통이라
 *  나무 패턴만으로는 계열이 안 잡혔다(블루베리 3편/3일 미검출 실사고). */
export function seriesStems(text: string): string[] {
  const t = (text || '').normalize('NFC').replace(/\s+/g, '');
  const out = new Set<string>();
  for (const m of t.matchAll(/([가-힣]{2,8})나무/g)) {
    const stem = m[1]!;
    if (!GENERIC_STEMS.has(stem)) out.add(stem);
  }
  for (const m of t.matchAll(/[가-힣]{2,6}베리/g)) out.add(m[0]!);
  return [...out];
}

/**
 * 쿨다운 판정(순수, 테스트 대상) — recent 에서 계열 어간별 편수를 세고, 후보 텍스트에 그 어간이
 * 들어 있으며 편수가 cap 이상인 계열 어간을 반환(없으면 null). 후보에 '나무' 접미가 없어도
 * ("포도 수확 후 관리") 최근 편의 어간('포도')과 포함 대조로 걸린다.
 */
/** 계열별 편수 집계(2단계, 2026-08-24 보강) — 1) 창 내 전 편에서 어간을 발견하고, 2) 그 어간을
 *  '포함'하는 편 수를 센다(편당 1회). 종전 1단계 집계는 어간 표기('XX나무')가 있는 편만 세서
 *  "블루베리 꽃눈 확인법"류(나무 미표기)가 빠졌다 — 블루베리 3편/3일 미검출 실사고. */
function countSeries(recent: Array<{ text: string; createdTs: string }>, cutoff: number): Map<string, number> {
  const inWindow = recent
    .filter((r) => { const t = new Date(r.createdTs).getTime(); return Number.isFinite(t) && t >= cutoff; })
    .map((r) => (r.text || '').normalize('NFC').replace(/\s+/g, ''));
  const stems = new Set<string>();
  for (const t of inWindow) for (const s of seriesStems(t)) stems.add(s);
  const counts = new Map<string, number>();
  for (const s of stems) counts.set(s, inWindow.filter((t) => t.includes(s)).length);
  // 행위 축 집계(2026-08-24) — 축은 정적 목록이라 발견 단계 불필요, 동의어 중 하나라도 포함하면 그 편 산입.
  for (const axis of ACTIVITY_AXES) {
    const n = inWindow.filter((t) => axis.terms.some((term) => t.includes(term))).length;
    if (n > 0) counts.set(axis.id, n);
  }
  return counts;
}

export function seriesCooldownHit(
  candidateText: string,
  recent: Array<{ text: string; createdTs: string }>,
  opts: { days?: number; cap?: number; now?: number } = {},
): string | null {
  const { days = 7, cap = 2, now = Date.now() } = opts;
  const cand = (candidateText || '').normalize('NFC').replace(/\s+/g, '');
  if (!cand) return null;
  const counts = countSeries(recent, now - days * 86_400_000);
  let best: string | null = null;
  for (const [key, n] of counts) {
    if (n >= cap && matchesKey(cand, key) && (best === null || n > (counts.get(best) ?? 0))) best = key;
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

function cooledKeys(brandSlug?: string, opts: { days?: number; cap?: number; now?: number } = {}): string[] {
  const { days = 7, cap = 2, now = Date.now() } = opts;
  const recent = pieceStore().list()
    .filter((p) => (p.brand ?? '') === (brandSlug ?? ''))
    .map((p) => ({ text: `${p.title} ${p.keyword ?? ''}`, createdTs: p.createdTs }));
  return [...countSeries(recent, now - days * 86_400_000).entries()].filter(([, n]) => n >= cap).map(([k]) => k);
}

/** 현재 쿨다운 중인 계열의 표시명 목록(프롬프트 회피 블록용). 실패는 빈 배열. */
export function cooledSeries(brandSlug?: string, opts: { days?: number; cap?: number; now?: number } = {}): string[] {
  try {
    return cooledKeys(brandSlug, opts).map((k) =>
      AXIS_BY_ID.has(k) ? `${k}(행위 축)` : k.endsWith('베리') ? `${k} 계열` : `${k}나무 계열`);
  } catch { return []; }
}

/** 현재 쿨다운 중인 계열의 매칭 토큰 목록(트렌드 시드 제외 등 포함 대조용) — 행위 축은 동의어 전개. */
export function cooledSeriesTokens(brandSlug?: string, opts: { days?: number; cap?: number; now?: number } = {}): string[] {
  try {
    const out = new Set<string>();
    for (const k of cooledKeys(brandSlug, opts)) {
      const axis = AXIS_BY_ID.get(k);
      if (axis) for (const t of axis.terms) out.add(t);
      else out.add(k);
    }
    return [...out];
  } catch { return []; }
}
