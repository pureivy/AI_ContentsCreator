/**
 * 수종 로테이션(순수) — 브랜드 수종 카탈로그(brand.yaml speciesCatalog) 기준으로 최근 30일 블로그가
 * 어느 수종에 몰렸는지 세고, 월 상한을 넘은 수종은 하드 기각·프롬프트 제안 금지, 안 다룬 수종은 우선 제안.
 * 2026-08-27 사용자: "배롱나무는 너무 많이 다뤘어. 나무 종류가 많을 텐데 왜 이래" — 실측 블로그 91편 중
 * 배롱 8·블루베리 7·포도 5, 씨앗 키워드 21개가 10종 안팎이라 두뇌가 그 안에서만 돌았다.
 */
export interface SpeciesEntry { name: string; aliases?: string[] }
export interface SpeciesGroup { group: string; species: SpeciesEntry[] }

/**
 * 30일 내 같은 수종 블로그 상한(초과분부터 하드 기각). 2 → 3(2026-09-17 사용자 확정).
 *
 * 2 는 최근 수종 창이 없던 시절의 숫자였다. 당시 창(CONFIG.speciesRecentDays, 09-17 기본 10일)이 간격을 잡아
 * 30일에 최대 4편이 물리적 한계라, 상한 2 는 창보다 먼저 막아 보너스 계단(성과·수요)을 가려 버렸다.
 * 3 이면 보통 수종이 3편, 잘 되는 수종이 4편으로 한 자리 앞선다 — 계단이 살아난다.
 * 용량 문제는 아니다: 수종을 단 글이 월 50편인데 카탈로그가 79종이라 병목은 상한이 아니라 제안 쪽이다.
 */
export const SPECIES_MONTHLY_CAP = 3;
export const SPECIES_WINDOW_DAYS = 30;

const compact = (s: string): string => (s ?? '').normalize('NFC').replace(/\s+/g, '');

/** 텍스트에 든 카탈로그 수종(정식명). 여러 개면 가장 긴 표기가 맞은 것 — '배롱나무'가 '배'보다 우선. */
export function speciesInText(text: string, catalog: SpeciesGroup[] | undefined): string | null {
  if (!text || !catalog?.length) return null;
  const t = compact(text);
  let best: { name: string; len: number; idx: number } | null = null;
  for (const g of catalog) {
    for (const sp of g.species ?? []) {
      for (const form of [sp.name, ...(sp.aliases ?? [])]) {
        const f = compact(form);
        if (f.length < 2) continue;
        const idx = t.indexOf(f);
        if (idx < 0) continue;
        if (!best || f.length > best.len || (f.length === best.len && idx < best.idx)) best = { name: sp.name, len: f.length, idx };
      }
    }
  }
  return best?.name ?? null;
}

/** 최근 days 일 블로그(제목+키워드)에서 수종별 편수. */
export function speciesCoverage(
  items: Array<{ title: string; keyword?: string; ts: string }>,
  catalog: SpeciesGroup[] | undefined,
  now = new Date(), days = SPECIES_WINDOW_DAYS,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!catalog?.length) return out;
  const since = now.getTime() - days * 86_400_000;
  for (const it of items) {
    const t = new Date(it.ts).getTime();
    if (!Number.isFinite(t) || t < since || t > now.getTime() + 60_000) continue;
    const sp = speciesInText(`${it.title} ${it.keyword ?? ''}`, catalog);
    if (sp) out.set(sp, (out.get(sp) ?? 0) + 1);
  }
  return out;
}

/**
 * 수종별 월 상한 — 수요가 큰 수종은 몇 편 더 허용한다(순수, 2026-09-04 사용자 확정).
 *
 * 종전엔 수요와 무관하게 전 수종 2편이었다. 실측 배분이 그래서 어긋났다:
 *   6편  배롱나무      수요 22/월      검색 유입 27회
 *   4편  포도나무      수요 230/월     검색 유입 461회
 *   3편  하스카프베리  수요 목록 밖    검색 유입 1,085회
 * 수종 수를 넓게 가는 건 유지한다(109편에 104소재 — 이미 최대치다). 편수 배분만 수요에 비례시킨다.
 *
 * **느슨하게만 만든다. 절대 조이지 않는다.** 이 채널 최고 성적(하스카프베리 검색 1,085회)은
 * 네이버 수요 목록에 아예 없는 수종에서 나왔다. 수요가 낮다고 상한을 낮췄다면 그 수종을 처음부터
 * 막았을 것이다 — 수요 데이터가 모르는 틈새가 실제로 가장 크게 먹혔다.
 */
export function speciesCapFor(volume: number | undefined, base = SPECIES_MONTHLY_CAP): number {
  const v = Number(volume);
  if (!Number.isFinite(v) || v <= 0) return base;   // 미상·0 은 종전 그대로 — 틈새를 막지 않는다
  if (v >= 5000) return base + 2;
  if (v >= 1000) return base + 1;
  return base;
}

/**
 * 최근 사용 수종 제외 창(순수 함수용 폴백 기본값) — 실제 값은 CONFIG.speciesRecentDays(09-17 10일 → 09-18 2일).
 * 이 상수는 2026-09-17 처음 정한 30일을 그대로 둔다 — 호출부 전부가 CONFIG 값을 넘기므로 실효값이 아니다.
 *
 * 종전 규칙은 카운트뿐이었다: 30일에 같은 수종 2편(수요 큰 수종 3~4편). 그래서 날짜 간격은 아무도 안
 * 재고 있었고, 며칠 만의 재등장이 규칙 안이었다 — 실측 2026-09-16: 모과나무 09-10→09-16(6일), 석류나무
 * 09-13→09-16(3일). 둘 다 누적 1편이라 상한에 안 닿았고 행위도 달라(전정→묘목, 시비→월동) 계열 쿨다운도
 * 안 걸렸다. 사장님: "최근 주제로 사용한 것들이 계속 나온다 — 최근 사용한 주제는 안 쓰기로 하지 않았나?"
 */
export const SPECIES_RECENT_DAYS = 30;

/**
 * 수종별 '며칠 전에 마지막으로 다뤘나'(순수) — 창 안의 가장 최근 1건만 남긴다.
 *
 * speciesOf 를 호출부에서 주입받는다 — 카탈로그 대조(speciesInText)만으로는 사전에 없는 새 이름을 놓치는데
 * (아로니아 실사고 2026-09-16), 그 판정 눈은 호출부마다 다르다. 지도를 만들 때와 후보를 잴 때 **같은 눈**을
 * 쓰는 것이 이 함수의 유일한 계약이다(다르면 키가 안 맞아 게이트가 조용히 통과한다).
 */
export function speciesRecency(
  items: Array<{ title: string; keyword?: string; ts: string }>,
  speciesOf: (text: string) => string | null | undefined,
  now = new Date(), days = SPECIES_RECENT_DAYS,
): Map<string, number> {
  const out = new Map<string, number>();
  if (days <= 0) return out;
  const nowMs = now.getTime();
  const since = nowMs - days * 86_400_000;
  for (const it of items) {
    const t = new Date(it.ts).getTime();
    if (!Number.isFinite(t) || t < since || t > nowMs + 60_000) continue;
    const sp = speciesOf(`${it.title} ${it.keyword ?? ''}`);
    if (!sp) continue;
    const ago = Math.max(0, Math.floor((nowMs - t) / 86_400_000));
    const prev = out.get(sp);
    if (prev === undefined || ago < prev) out.set(sp, ago);
  }
  return out;
}

/** 후보가 최근 창 안에 다룬 수종인가(순수) — {name, daysAgo} 또는 null. speciesOf 는 지도와 같은 눈. */
export function usedRecently(
  text: string, recency: Map<string, number>,
  speciesOf: (text: string) => string | null | undefined,
): { name: string; daysAgo: number } | null {
  if (!recency.size) return null;
  const sp = speciesOf(text);
  if (!sp) return null;
  const ago = recency.get(sp);
  return ago === undefined ? null : { name: sp, daysAgo: ago };
}

/**
 * 프롬프트 블록 — 최근 N일 다룬 수종(제안 금지).
 *
 * 금지형으로 쓴다. 지시 중에도 코드가 같이 막기 때문이다 — 코드는 통과시키는데 프롬프트만 금지하면
 * 지시끼리 충돌한다(수종·축 로테이션 블록을 지시 중에 뺀 이유가 그것이었다). 여기는 반대로 양쪽이 같다.
 */
export function speciesRecentBlock(recency: Map<string, number>, days = SPECIES_RECENT_DAYS): string {
  if (!recency.size || days <= 0) return '';
  const rows = [...recency.entries()].sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
    .map(([name, ago]) => `${name}(${ago}일 전)`);
  return `[최근 ${days}일 안에 다룬 수종 — 제안 금지]\n${rows.join(', ')}\n`
    + '이 수종은 각도·행위를 바꿔도 제안하지 마라(코드가 기각한다). 아직 안 다룬 수종에서 고른다.\n';
}

/**
 * 성과 가중 월 상한(순수, 2026-09-17 사용자 확정) — 검색량과 **숏폼 조회수**를 나란히 본다.
 *
 * 사장님: "검색량 큰 수종을 좀 더 허용하고, 올린 숏츠 조회수가 많은 것도 좀 더 허용하면 어때?"
 * perfRatio 는 그 수종 숏폼 조회수 중앙값 ÷ 우리 전체 중앙값(유튜브·인스타 중 큰 쪽). 절대 조회수가 아니라
 * 배수인 이유는 두 채널의 눈금이 전혀 다르기 때문이다(실측 2026-09-17: 유튜브 중앙 1,055 · 인스타 888).
 *
 * 두 보너스를 **더하지 않고 큰 쪽만** 쓴다. 검색량과 조회수는 부분적으로 같은 것을 재는 신호라 더하면
 * 한 수종이 상한을 독식한다 — 배롱나무(검색 100,550 · 조회 2.12배)가 정확히 그 모양이고, 로테이션 체계가
 * 애초에 그 수종 8편/월 때문에 생겼다. 어느 한 축만 강해도 자리를 더 주되, 두 배로 주지는 않는다.
 *
 * 실효 상한은 결국 최근 수종 창(CONFIG.speciesRecentDays)이 정한다 — 10일 창이면 30일에 세 편이 물리적
 * 최대치라, 여기서 4를 줘도 그 이상은 나올 수 없다. 이 함수는 천장이고 간격은 그쪽이 잡는다.
 */
export function speciesCapFrom(
  signals: { searchVolume?: number; perfRatio?: number },
  base = SPECIES_MONTHLY_CAP,
): number {
  const search = speciesCapFor(signals.searchVolume, base) - base;
  const r = Number(signals.perfRatio);
  const perf = !Number.isFinite(r) || r <= 0 ? 0 : r >= 3 ? 2 : r >= 1.5 ? 1 : 0;
  return base + Math.max(search, perf);
}

/** cap 인자 정규화(순수) — 숫자면 그대로, 함수면 수종별 상한. 종전 호출부는 그대로 동작한다. */
function capOf(cap: number | ((name: string) => number), name: string): number {
  if (typeof cap !== 'function') return cap;
  try { const n = cap(name); return Number.isFinite(n) && n >= 1 ? n : SPECIES_MONTHLY_CAP; }
  catch { return SPECIES_MONTHLY_CAP; }
}

/** 후보가 월 상한을 넘은 수종이면 {name,count}, 아니면 null. cap 은 숫자 또는 수종별 함수. */
export function overSpeciesCap(
  text: string, coverage: Map<string, number>, catalog: SpeciesGroup[] | undefined,
  cap: number | ((name: string) => number) = SPECIES_MONTHLY_CAP,
): { name: string; count: number } | null {
  const sp = speciesInText(text, catalog);
  if (!sp) return null;
  const n = coverage.get(sp) ?? 0;
  return n >= capOf(cap, sp) ? { name: sp, count: n } : null;
}

/** 프롬프트 블록 — 상한 도달(제안 금지) · 최근 다룸(피함) · 아직 안 다룬 수종(우선, 분류별). */
export function speciesRotationBlock(
  catalog: SpeciesGroup[] | undefined, coverage: Map<string, number>,
  cap: number | ((name: string) => number) = SPECIES_MONTHLY_CAP, minFresh = 5,
): string {
  if (!catalog?.length) return '';
  const capped: string[] = []; const recent: string[] = []; const freshGroups: string[] = [];
  for (const g of catalog) {
    const fresh: string[] = [];
    for (const sp of g.species ?? []) {
      const n = coverage.get(sp.name) ?? 0;
      if (n >= capOf(cap, sp.name)) capped.push(`${sp.name}(${n}편)`);
      else if (n > 0) recent.push(`${sp.name}(${n}편)`);
      else fresh.push(sp.name);
    }
    if (fresh.length) freshGroups.push(`  · ${g.group}: ${fresh.join(', ')}`);
  }
  const lines = [`[수종 로테이션 — 최근 ${SPECIES_WINDOW_DAYS}일 블로그 기준, 수종당 상한 ${cap}편]`];
  if (capped.length) lines.push(`- 상한 도달 → 제안 금지(코드가 기각한다): ${capped.join(', ')}`);
  if (recent.length) lines.push(`- 최근 다룸 → 가급적 피함: ${recent.join(', ')}`);
  if (freshGroups.length) lines.push(`- 아직 안 다룬 수종 → 우선(후보 중 최소 ${minFresh}개는 여기서):`, ...freshGroups);
  lines.push('- 수종은 카탈로그 정식명 그대로 쓰고, 한 후보에 수종 하나만. 총칭(나무·묘목·유실수·조경수)만으로 된 주제는 최대 1개.');
  return lines.join('\n');
}
