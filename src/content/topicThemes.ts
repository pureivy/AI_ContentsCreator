/**
 * 주제 축 로테이션(순수) — brand.yaml topicThemes(심기·구매·거름·전정·병충해·번식·정원 조성…) 기준으로
 * 최근 30일 블로그가 어느 축에 몰렸는지 세고, 월 상한을 넘은 축은 하드 기각·안 다룬 축은 우선 제안.
 * 2026-08-27 사용자: "수종뿐 아니라 나무 관리·정원 관리·나무 구매·접붙이기 등 다양한 주제를 조사해서 후보군에".
 * 수종 로테이션(speciesRotation)과 직교 — 한 글은 수종 하나 × 축 하나.
 */
export interface TopicTheme { theme: string; seeds: string[]; match: string[] }

// 상한 4 → 5(2026-09-01 사용자 확정, 최소 상향). 산술이 안 맞았다: 축 16 × 4 = 월 수용량 64편인데
// 30일 생산이 68편이라 구조적 초과였고, 어느 축이든 결국 상한에 닿아 16축 중 10축이 막혔다.
// 상한만 올리면 쏠림이 커지므로(실측 '묘목 구매·선택' 11편) 축 확대·하위 축 우선과 함께 간다.
export const THEME_MONTHLY_CAP = 5;
export const THEME_WINDOW_DAYS = 30;

const compact = (s: string): string => (s ?? '').normalize('NFC').replace(/\s+/g, '');

/** 텍스트가 속한 축(첫 매치 토큰이 가장 앞에 나오는 축). */
export function themeInText(text: string, themes: TopicTheme[] | undefined): string | null {
  if (!text || !themes?.length) return null;
  const t = compact(text);
  let best: { theme: string; idx: number; len: number } | null = null;
  for (const th of themes) {
    for (const tok of th.match ?? []) {
      const f = compact(tok);
      if (f.length < 1) continue;
      const idx = t.indexOf(f);
      if (idx < 0) continue;
      if (!best || idx < best.idx || (idx === best.idx && f.length > best.len)) best = { theme: th.theme, idx, len: f.length };
    }
  }
  return best?.theme ?? null;
}

export function themeCoverage(
  items: Array<{ title: string; keyword?: string; ts: string }>, themes: TopicTheme[] | undefined,
  now = new Date(), days = THEME_WINDOW_DAYS,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!themes?.length) return out;
  const since = now.getTime() - days * 86_400_000;
  for (const it of items) {
    const t = new Date(it.ts).getTime();
    if (!Number.isFinite(t) || t < since || t > now.getTime() + 60_000) continue;
    const th = themeInText(`${it.title} ${it.keyword ?? ''}`, themes);
    if (th) out.set(th, (out.get(th) ?? 0) + 1);
  }
  return out;
}

export function overThemeCap(
  text: string, coverage: Map<string, number>, themes: TopicTheme[] | undefined, cap = THEME_MONTHLY_CAP,
): { theme: string; count: number } | null {
  const th = themeInText(text, themes);
  if (!th) return null;
  const n = coverage.get(th) ?? 0;
  return n >= cap ? { theme: th, count: n } : null;
}

/**
 * 최근 사용 축 제외 창(기본값, 2026-09-17 사용자 확정) — 실제 값은 CONFIG.themeRecentDays.
 *
 * 수종에 건 날짜 창(speciesRotation.SPECIES_RECENT_DAYS)과 같은 모양이고 같은 결함을 고친다. 축 상한은
 * '30일에 5편'이라 하루 세 편을 전부 전정으로 채워도 규칙 안이었다. 실측 2026-09-17(최근 30일 70편):
 * 가지치기 11 · 거름 11 · 수확 8 · 묘목 구매 6 — 네 축이 절반을 먹었고 24축 중 6축은 한 편도 없었다.
 * 창은 7일 — 축 24개에 하루 2.5편이면 한 바퀴가 ~10일이라 굶지 않는다.
 */
export const THEME_RECENT_DAYS = 7;

/** 축별 '며칠 전에 마지막으로 썼나'(순수) — 창 안의 가장 최근 1건. themeOf 는 지도·검사 공용 눈. */
export function themeRecency(
  items: Array<{ title: string; keyword?: string; ts: string }>,
  themeOf: (text: string) => string | null | undefined,
  now = new Date(), days = THEME_RECENT_DAYS,
): Map<string, number> {
  const out = new Map<string, number>();
  if (days <= 0) return out;
  const nowMs = now.getTime();
  const since = nowMs - days * 86_400_000;
  for (const it of items) {
    const t = new Date(it.ts).getTime();
    if (!Number.isFinite(t) || t < since || t > nowMs + 60_000) continue;
    const th = themeOf(`${it.title} ${it.keyword ?? ''}`);
    if (!th) continue;
    const ago = Math.max(0, Math.floor((nowMs - t) / 86_400_000));
    const prev = out.get(th);
    if (prev === undefined || ago < prev) out.set(th, ago);
  }
  return out;
}

/** 후보가 최근 창 안에 쓴 축인가(순수) — {theme, daysAgo} 또는 null. */
export function usedThemeRecently(
  text: string, recency: Map<string, number>,
  themeOf: (text: string) => string | null | undefined,
): { theme: string; daysAgo: number } | null {
  if (!recency.size) return null;
  const th = themeOf(text);
  if (!th) return null;
  const ago = recency.get(th);
  return ago === undefined ? null : { theme: th, daysAgo: ago };
}

/** 프롬프트 블록 — 최근 N일 쓴 축(제안 금지). 코드가 같이 막으므로 금지형으로 쓴다(지시 중에도 주입). */
export function themeRecentBlock(recency: Map<string, number>, days = THEME_RECENT_DAYS): string {
  if (!recency.size || days <= 0) return '';
  const rows = [...recency.entries()].sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
    .map(([theme, ago]) => `${theme}(${ago}일 전)`);
  return `[최근 ${days}일 안에 쓴 주제 축 — 제안 금지]\n${rows.join(', ')}\n`
    + '수종을 바꿔도 이 축이면 기각된다(코드가 막는다). 아래 로테이션의 적게 다룬 축에서 골라라.\n';
}

/** 프롬프트 블록 — 상한 도달(제안 금지) · 최근 다룸 · 아직 안 다룬 축(우선, 발굴 검색어 예시 동반). */
/**
 * 일반 검색어 씨앗을 특정 수종으로 한정한다(순수, 2026-09-29).
 *
 * 왜 필요한가(실사고). 사장님 지시가 보관소를 가리키면 코드가 53종 화이트리스트를 하드로 건다
 * (scheduler `libGate`). 그런데 로테이션이 지목하는 '적게 다룬 축'은 하필 수종이 안 붙는 축들이라
 * (지지대·옥상 마당·비용·경계·전설·문학) 씨앗이 "나무 지지대 설치 방법"처럼 수종 없는 말이다.
 * 두뇌가 그 예시를 그대로 따라 제목을 지으면 화이트리스트가 '보관소 밖 수종'으로 기각한다
 * (실측 09-29 06:00: "나무 멀칭, 제대로 깔아야 뿌리가 산다"). 수종이 자연스럽게 붙는 축은 전부
 * 월 상한이라, 열린 축에 수종을 붙여 주지 않으면 그 틱은 후보가 전멸한다.
 *
 * 규칙은 둘뿐이다. 홀로 선 '나무' 토큰이 있으면 그 자리를 수종이 차지하고, 없으면 앞에 붙인다.
 * **토큰 단위로만 바꾼다** — '나무지주목' 처럼 더 긴 낱말 속의 '나무' 를 건드리면 '감나무지주목' 이
 * 되어 아무도 안 치는 말이 나온다.
 */
export function speciesSeed(seed: string, species: string): string {
  const sp = String(species ?? '').trim();
  const s = String(seed ?? '').trim();
  if (!sp || !s) return s;
  // 조사가 붙은 '나무가·나무를·나무의…' 도 같은 자리다 — 조사는 남기고 앞머리만 바꾼다.
  // 이게 없으면 "나무가 안 자라요" 가 "감나무 나무가 안 자라요" 로 접두되어 아무도 안 치는 말이 된다.
  const JOSA = /^나무(이|가|를|은|는|의|에|에서|도|만|으로|로|와|과|부터|까지|보다|처럼)?$/;
  const parts = s.split(/\s+/);
  const at = parts.findIndex((w) => JOSA.test(w));
  if (at >= 0) { parts[at] = parts[at]!.replace(/^나무/, sp); return parts.join(' '); }
  return `${sp} ${s}`;
}

export function themeRotationBlock(
  themes: TopicTheme[] | undefined,
  coverage: Map<string, number>,
  cap = THEME_MONTHLY_CAP,
  /** 이 라운드가 요구하는 후보 수 — 남은 축이 이보다 적으면 '좁은 장' 경고를 낸다. */
  candidates = 8,
  /** 보관소 지시가 강제하는 수종 목록(2026-09-29). 주면 적게 다룬 축의 예시를 그 수종으로 적는다.
   *  비면 종전과 글자 단위로 같다 — 지시가 꺼진 평소 런은 아무것도 안 바뀐다. */
  species: readonly string[] = [],
): string {
  if (!themes?.length) return '';
  // 우선 목록의 기준을 'n===0' 에서 **커버리지 하위**로 바꾼다(2026-09-01 사용자 요청: 다양한 주제).
  // 실측: 30일 68편이 나오면 0편인 축이 존재하지 않아 '아직 안 다룬 축' 목록이 늘 비었고, 남는 지시가
  // "가급적 피함"뿐이라 후보가 결국 많이 다룬 축으로 몰렸다. 16축 중 10축 상한 → 깨끗한 후보 0 →
  // 기아 폴백이 유사 주제를 채택(목련 중복). 적게 다룬 축을 이름으로 지목해야 후보가 그쪽으로 간다.
  // 임계는 상한의 절반 — 상한 5면 2편 이하가 '적게 다룬' 축이다(고정 숫자보다 상한을 따라가게).
  const lowMark = Math.max(1, Math.floor(cap / 2));
  const capped: string[] = []; const recent: string[] = [];
  const priority: Array<{ n: number; line: string }> = [];
  for (const th of themes) {
    const n = coverage.get(th.theme) ?? 0;
    // 지시가 수종을 강제하면 예시도 그 수종으로 — 축마다 시작 수종을 옮겨 한 축 안에서도 여러 종이 보이게 한다.
    const raw = (th.seeds ?? []).slice(0, 4);
    const seeds = (species.length
      ? raw.map((sd, j) => speciesSeed(sd, species[(themes.indexOf(th) + j) % species.length]!))
      : raw).join(', ');
    if (n >= cap) capped.push(`${th.theme}(${n}편)`);
    else if (n <= lowMark) priority.push({ n, line: `  · ${th.theme}(${n}편): 예) ${seeds}` });
    else recent.push(`${th.theme}(${n}편)`);
  }
  priority.sort((a, b) => a.n - b.n); // 적은 순 — 0편이 있으면 그게 맨 앞
  const fresh = priority.map((p) => p.line);
  const lines = [`[주제 축 로테이션 — 최근 ${THEME_WINDOW_DAYS}일 블로그 기준, 축당 상한 ${cap}편 · 수종 로테이션과 별개 축]`];
  if (capped.length) lines.push(`- 상한 도달 → 제안 금지(코드가 기각한다): ${capped.join(', ')}`);
  if (recent.length) lines.push(`- 최근 다룸 → 가급적 피함: ${recent.join(', ')}`);
  if (fresh.length) {
    lines.push('- 적게 다룬 축 → **여기서 우선 고른다**(사람들이 실제로 치는 검색어 예시):', ...fresh);
    // 왜 예시에 수종이 박혀 있는지 한 줄로 못박는다 — 안 적으면 두뇌가 예시의 수종을 '고정값'으로 읽거나
    // 반대로 수종을 떼고 일반 제목을 지어 화이트리스트에 걸린다(둘 다 실측된 실패다).
    if (species.length) lines.push('  ※ 지시가 보관소 수종만 허용하므로 예시도 그 수종으로 적었다. 수종은 보관소 목록 안에서 바꿔도 되지만, 수종 없는 일반 제목은 코드가 기각한다.');
  }
  lines.push('- 후보 8개는 서로 다른 축에서 고르고, 수종 × 축 조합은 기존 글과 겹치지 않게.');
  // 좁은 장에서의 지시 강화(2026-08-30) — 축이 많이 막히면 "가급적 피함"까지 써야 후보가 채워진다.
  // 그 사실을 명시하지 않으면 두뇌가 상한 축에서 8개를 억지로 만들고 전부 코드 기각된다(실측: 16축 중
  // 7축 포화 상태에서 한 라운드 17건 기각, 생산 정지). 남은 자리를 세어 알려 주는 편이 정확하다.
  // 임계는 '축의 절반'이 아니라 **요구 후보 수**로 잡는다 — 위 줄이 "후보 8개를 서로 다른 축에서"라고
  // 요구하므로, 열린 축이 그보다 적거나 겨우 같으면 그 지시가 이미 성립하지 않는다(실측: 16축 중 7축
  // 포화 = 열린 9축이지만 그중 6축은 이미 다룬 것이라 실질 여유가 없었다).
  const open = themes.length - capped.length;
  if (capped.length && open <= candidates + 1) {
    lines.push(
      `- ⚠ 지금 쓸 수 있는 축은 ${open}개뿐이다(${themes.length}축 중 ${capped.length}축 상한 도달).`
      + ` 후보 8개를 채우려면 '아직 안 다룬 축'과 '최근 다룸' 축을 모두 써라 — 상한 축으로 자리를 메우면 그 후보는 버려진다.`
      + (fresh.length ? '' : ' 적게 다룬 축이 없으면 남은 축에서 편수가 적은 것부터 고른다.'),
    );
  }
  return lines.join('\n');
}
