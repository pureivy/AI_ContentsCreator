/**
 * 외부 인기 — 수종별 '재배 수요'와 인기 재배 주제(2026-10-07 사장님 "네이버·유튜브·인스타의 주제·수종도 반영해야").
 *
 * 왜 따로 재나. 수요 게이트는 수종 이름 하나의 검색량만 본다. 그런데 연관 키워드를 펼치면 먹거리·약재 수요가 섞여 있다
 * (실측 2026-10-07): 마가목 34,180 = 효능 29,750·열매 7,090·진액 3,110 … 묘목은 560. 블루베리 56,090 = 냉동 29,030·효능 …
 * 묘목 4,360. 감나무는 이름(9,430)보다 품종 '태추단감'(111,800, 묘목 2,570)이 크다. 묘목 농원에 맞는 수요는 재배 쪽이다.
 *
 *  · 네이버: 검색광고 키워드도구(연관어+월 검색량)를 보관소 수종마다 하루 한 번 — 재배 의도 연관어만(CULTIVATION_RE, 먹거리 제외).
 *  · 유튜브: search.list 최근 30일 조회순을 하루 YT_SPECIES_PER_DAY 종씩 돌아가며(쿼터 100/종) — 재배 영상 제목만.
 *  · 인스타: 외부 데이터 없음(해시태그 검색은 메타 앱 심사 필요, 2026-10-07 실측 #200) — 우리 릴스 성과(speciesPopularity)로 갈음.
 *
 * 쓰임: 프롬프트 참고 블록 + 실검색 각도 판정의 연관어 + 수종 반응표의 사전값. 게이트(기각)에는 안 쓴다(09-29 전멸 교훈).
 * 갱신은 자율런 주제 제안 때 하루 한 번 백그라운드(main.ts 성과 동기화 틱은 다른 작업과 파일이 겹쳐 손대지 않았다).
 * 전량 fail-open — 키 없음·실패는 무주입.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { activeBrandSlug, brandFileSuffixFor } from '../content/brand';
import { getSecret } from '../secrets/store';
import { fetchTimeout } from '../util/fetch';
import { searchAdEnabled, searchAdVolumes } from '../grounding/naver_searchad';
import { parseYtSearch } from './ytNiche';

export interface ExtKeyword { kw: string; vol: number }
export interface ExtVideo { title: string; views: number }
export interface ExtSpecies {
  naver?: { date: string; total: number; top: ExtKeyword[] };
  yt?: { date: string; videos: ExtVideo[] };
}
export interface ExtTopicsSnap { date: string; species: Record<string, ExtSpecies> }

/** 재배 의도(엄격) — 묘목 농원 독자가 치는 말. looksLikeGardenQuery 는 열매·가격·약까지 원예로 쳐 먹거리 수요가 섞인다. */
const CULTIVATION_RE = /묘목|심기|심는|심을|식재|옮겨|이식|키우기|키우는|기르기|재배|가지치기|전정|전지|순지르기|물주기|비료|거름|시비|병충해|병해|벌레|깍지|진딧|월동|삽목|접목|접붙|번식|분갈이|화분|정원|조경|울타리|개화|꽃이?안|열매가?안|안열|수확시기|생육|자라|크기|간격|품종|종류|시기|방법|관리|죽|마르|시들|노랗|갈변|잎/;
/** 먹거리·약재·상품 — 재배 말이 섞여도 이게 있으면 뺀다(예외: 묘목이 같이 있으면 둔다 — '묘목 가격'은 재배 수요다). */
const FOOD_RE = /효능|효과|진액|즙|주스|스무디|레시피|요리|먹는|먹는법|칼로리|냉동|생과|건조|말린|차$|술|담그|주$|분말|가루|영양|다이어트|부작용|택배|직거래|가격|파는곳|구매|판매|쿠팡|생블루|유기농/;

export function isCultivationQuery(q: string): boolean {
  const t = (q ?? '').replace(/\s+/g, '');
  if (!t || !CULTIVATION_RE.test(t)) return false;
  return !FOOD_RE.test(t) || /묘목/.test(t);
}

/**
 * 연관어가 그 수종 것인가(순수). 키워드도구 연관어엔 '때죽나무·조경수·개업화분·아스파라거스키우기'처럼 수종과 무관한 말이
 * 섞여 온다(2026-10-07 첫 수집 실측) — 수종 사전에 없는 이름이라 speciesOf 로는 못 거른다. 그래서 이름이 들어 있어야 받는다:
 * 표준명·별칭, '나무' 뗀 어간(2자 이상), 한 글자 어간(감·밤·배)은 '감나무·감묘목·단감' 꼴만(감자·배추 같은 오탐 방지).
 * 품종 수요(감나무 → '태추단감묘목')는 '단감'으로 잡힌다.
 */
export function namesSpecies(keyword: string, species: string, aliases: readonly string[] = []): boolean {
  return speciesNamePos(keyword, species, aliases) >= 0;
}

/** 연관어 안에서 그 수종 이름이 끝나는 위치(없으면 -1, 순수) — 두 수종 이름이 겹칠 때 뒤에 오는 쪽(합성어의 중심)을 고른다. */
export function speciesNamePos(keyword: string, species: string, aliases: readonly string[] = []): number {
  const k = (keyword ?? '').replace(/\s+/g, '');
  const sp = (species ?? '').replace(/\s+/g, '');
  if (!k || !sp) return -1;
  const end = (tok: string): number => { const i = tok ? k.lastIndexOf(tok) : -1; return i < 0 ? -1 : i + tok.length; };
  let pos = Math.max(end(sp), ...aliases.map((a) => end((a ?? '').replace(/\s+/g, ''))));
  const stem = sp.endsWith('나무') ? sp.slice(0, -2) : '';
  if (stem.length >= 2) pos = Math.max(pos, end(stem));
  if (stem.length === 1) {
    const m = [...k.matchAll(new RegExp(`${stem}(?=나무|묘목)|단${stem}`, 'g'))].at(-1);
    if (m) pos = Math.max(pos, (m.index ?? 0) + m[0].length);
  }
  return pos;
}

/**
 * 키워드도구 결과 → 그 수종의 재배 수요(순수). 그 수종 이름이 든 재배 의도 연관어만(namesSpecies·isCultivationQuery),
 * 다른 수종으로 읽히는 연관어는 뺀다(speciesOf 가 다른 이름을 돌려주면).
 */
export function cultivationDemand(
  species: string, rows: ReadonlyArray<{ keyword: string; total: number }>,
  speciesOf: (t: string) => string | null | undefined, topN = 6, aliases: readonly string[] = [],
  /** 다른 수종(이름·별칭) — 이름이 겹치면(사과대추묘목: 사과·대추) 뒤에 오는 쪽 것이다(대추). */
  others: ReadonlyArray<{ name: string; aliases?: readonly string[] }> = [],
): { total: number; top: ExtKeyword[] } {
  const kept: ExtKeyword[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const kw = (r.keyword ?? '').trim();
    const k = kw.replace(/\s+/g, '');
    if (!k || seen.has(k) || !(r.total > 0) || !isCultivationQuery(kw)) continue;
    const pos = speciesNamePos(kw, species, aliases);
    if (pos < 0 || others.some((o) => o.name !== species && speciesNamePos(kw, o.name, o.aliases ?? []) > pos)) continue;
    const other = speciesOf(kw);
    if (other && other !== species) continue;
    seen.add(k);
    kept.push({ kw, vol: r.total });
  }
  kept.sort((a, b) => b.vol - a.vol);
  return { total: kept.reduce((s, x) => s + x.vol, 0), top: kept.slice(0, topN) };
}

export const YT_SPECIES_PER_DAY = 8;
const YT_WINDOW_DAYS = 30;
const YT_KEEP = 4;
/** 프롬프트에 쓸 수 있는 데이터의 최대 나이(일). */
export const EXT_STALE_DAYS = 14;

function snapPath(slug?: string): string {
  const s = slug ?? activeBrandSlug();
  return path.join(CONFIG.dataDir, 'topics', `ext-topics${brandFileSuffixFor(s || undefined)}.json`);
}

export function readExtTopicsSnap(slug?: string): ExtTopicsSnap | null {
  try {
    const raw = JSON.parse(fs.readFileSync(snapPath(slug), 'utf-8')) as ExtTopicsSnap;
    return raw && typeof raw.date === 'string' && raw.species && typeof raw.species === 'object' ? raw : null;
  } catch { return null; }
}

const localDate = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 유튜브를 돌 순서(순수) — 한 번도 안 잰 수종 먼저, 그다음 오래된 순. */
export function ytRotation(species: readonly string[], snap: ExtTopicsSnap | null, n = YT_SPECIES_PER_DAY): string[] {
  return species.map((sp, i) => ({ sp, i, d: snap?.species?.[sp]?.yt?.date ?? '' }))
    .sort((a, b) => a.d.localeCompare(b.d) || a.i - b.i)
    .slice(0, n).map((x) => x.sp);
}

let refreshing = false;
/** 하루 한 번 갱신(같은 날 재호출 no-op, 동시 호출 1회). 보관소 수종 목록을 받는다. */
export async function refreshExtTopics(
  slug: string, species: readonly string[], speciesOf: (t: string) => string | null | undefined, signal?: AbortSignal,
  aliasesOf: (sp: string) => readonly string[] = () => [],
): Promise<void> {
  if (refreshing || !species.length) return;
  const today = localDate();
  const prev = readExtTopicsSnap(slug);
  if (prev?.date === today) return;
  refreshing = true;
  try {
    const out: ExtTopicsSnap = { date: today, species: { ...(prev?.species ?? {}) } };
    // 네이버 — 수종마다 1콜(힌트를 묶으면 연관어가 섞여 수종별로 못 가른다). 키워드도구 속도 제한을 피해 조금씩 쉰다.
    let nv = 0;
    if (searchAdEnabled()) {
      for (const sp of species) {
        if (signal?.aborted) break;
        try {
          const rows = await searchAdVolumes([sp], signal);
          if (rows.length) {
            const d = cultivationDemand(sp, rows, speciesOf, 6, aliasesOf(sp), species.map((name) => ({ name, aliases: aliasesOf(name) })));
            out.species[sp] = { ...out.species[sp], naver: { date: today, ...d } };
            nv++;
          }
        } catch { /* 수종별 fail-open */ }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    // 유튜브 — 하루 YT_SPECIES_PER_DAY 종, 최근 30일 조회순. 조회수는 videos.list 1콜.
    let yv = 0;
    const key = getSecret('YOUTUBE_API_KEY');
    if (key) {
      const after = new Date(Date.now() - YT_WINDOW_DAYS * 86_400_000).toISOString();
      const picked = new Map<string, { sp: string; title: string }>();
      const turn = ytRotation(species, prev);
      for (const sp of turn) {
        if (signal?.aborted) break;
        try {
          const u = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount' +
            `&publishedAfter=${encodeURIComponent(after)}&regionCode=KR&relevanceLanguage=ko&maxResults=15` +
            `&q=${encodeURIComponent(sp)}&key=${encodeURIComponent(key)}`;
          const r = await fetchTimeout(u, {}, signal);
          if (!r.ok) throw new Error(`search.list HTTP ${r.status}`);
          for (const v of parseYtSearch(await r.json())) {
            // 재배 영상만 — 캠핑장·먹방·여행 등 잡음 제거. 다른 수종 영상도 뺀다.
            const other = speciesOf(v.title);
            if (!picked.has(v.videoId) && isCultivationQuery(v.title) && namesSpecies(v.title, sp, aliasesOf(sp)) && (!other || other === sp)) picked.set(v.videoId, { sp, title: v.title });
          }
          out.species[sp] = { ...out.species[sp], yt: { date: today, videos: [] } }; // 잰 날을 남긴다(영상 0 이어도 회전이 돈다)
        } catch { /* 쿼터 초과 등 — 그 수종은 다음 날 */ }
      }
      if (picked.size) {
        const stats = new Map<string, number>();
        try {
          const ids = [...picked.keys()].slice(0, 50).join(',');
          const r = await fetchTimeout(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${encodeURIComponent(key)}`, {}, signal);
          if (r.ok) {
            const j = await r.json() as { items?: Array<{ id?: unknown; statistics?: { viewCount?: unknown } }> };
            for (const it of j.items ?? []) { const n = Number(it?.statistics?.viewCount); if (typeof it?.id === 'string' && Number.isFinite(n)) stats.set(it.id, n); }
          }
        } catch { /* 통계 없이 제목만 */ }
        for (const sp of turn) {
          const vids = [...picked.entries()].filter(([, v]) => v.sp === sp)
            .map(([id, v]) => ({ title: v.title.slice(0, 60), views: stats.get(id) ?? 0 }))
            .sort((a, b) => b.views - a.views).slice(0, YT_KEEP);
          if (out.species[sp]?.yt) { out.species[sp]!.yt!.videos = vids; if (vids.length) yv++; }
        }
      }
    }
    if (!nv && !yv) return;
    const f = snapPath(slug);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(out, null, 2), 'utf-8');
    fs.renameSync(`${f}.tmp`, f);
    console.log(`[trend] 외부 인기 갱신 — 네이버 재배 수요 ${nv}종 · 유튜브 ${yv}종(${today})`);
  } catch (e) {
    console.log(`[trend] 외부 인기 갱신 실패(무해): ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    refreshing = false;
  }
}

const fresh = (date: string | undefined, now: number): boolean => {
  const t = Date.parse(`${date ?? ''}T00:00:00`);
  return Number.isFinite(t) && now - t <= EXT_STALE_DAYS * 86_400_000;
};

/** 그 수종의 외부 연관어(순수) — 실검색 각도 판정용. 네이버 재배 연관어만(짧은 검색어). 유튜브 영상 제목은 넣지 않는다 —
 *  긴 제목의 일반 단어('아닙니다'·'끝이')까지 각도 토큰이 되어 판정이 헐거워진다. 낡은 데이터는 뺀다. */
export function extSuggestionsFor(snap: ExtTopicsSnap | null, species: string, now = Date.now()): string[] {
  const n = snap?.species?.[species]?.naver;
  return n && fresh(n.date, now) ? (n.top ?? []).map((x) => x.kw) : [];
}

/** 잰 재배 수요(순수) — 0 포함. 안 쟀거나 낡으면 undefined('0 으로 쟀다'와 '모른다'를 가른다). */
export function cultivationMeasured(snap: ExtTopicsSnap | null, species: string, now = Date.now()): number | undefined {
  const n = snap?.species?.[species]?.naver;
  return n && fresh(n.date, now) && Number.isFinite(n.total) ? n.total : undefined;
}

/** 수종별 네이버 재배 수요(순수) — 수종 반응표의 사전값. 낡거나 없으면 undefined. */
export function cultivationTotal(snap: ExtTopicsSnap | null, species: string, now = Date.now()): number | undefined {
  const n = snap?.species?.[species]?.naver;
  return n && fresh(n.date, now) && n.total > 0 ? n.total : undefined;
}

/**
 * 프롬프트 블록(순수) — 재배 수요 상위 수종과 그 수종에서 사람들이 찾는 주제. lib 이 있으면 그 안에서만,
 * exclude(지금 코드가 막는 수종)는 뺀다. 데이터가 없으면 빈 문자열.
 */
export function extTopicsBlock(
  snap: ExtTopicsSnap | null, lib: readonly string[] = [], exclude: (sp: string) => boolean = () => false,
  now = Date.now(), maxSpecies = 10,
): string {
  if (!snap) return '';
  const fmtN = (n: number): string => n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString();
  const rows = Object.entries(snap.species)
    .filter(([sp]) => (!lib.length || lib.includes(sp)) && !(() => { try { return exclude(sp); } catch { return false; } })())
    .map(([sp, e]) => ({ sp, total: cultivationTotal(snap, sp, now) ?? 0, nv: fresh(e.naver?.date, now) ? e.naver?.top ?? [] : [], yt: fresh(e.yt?.date, now) ? e.yt?.videos ?? [] : [] }))
    .filter((r) => r.nv.length || r.yt.length)
    .sort((a, b) => b.total - a.total)
    .slice(0, maxSpecies);
  if (!rows.length) return '';
  const lines = rows.map((r) => {
    const nv = r.nv.slice(0, 4).map((k) => `${k.kw} ${fmtN(k.vol)}`).join(' · ');
    const yt = r.yt.slice(0, 2).map((v) => `"${v.title}"(${fmtN(v.views)}회)`).join(' · ');
    return `- ${r.sp}${r.total ? `(재배 검색 월 ${fmtN(r.total)})` : ''}: ${nv || '네이버 재배 연관어 없음'}${yt ? ` | 유튜브 30일: ${yt}` : ''}`;
  });
  return '[외부 인기 — 지금 사람들이 찾는 재배 주제(네이버 연관 검색량 월간 · 유튜브 최근 30일 조회, 먹거리·효능 검색은 뺐다)]\n' +
    `${lines.join('\n')}\n` +
    '반영 지침: 수종 이름 검색량은 열매·효능 같은 먹거리 수요가 섞여 크게 보인다 — 묘목 농원 글은 위 재배 검색어 안에서 각도를 잡아라.' +
    ' 품종 이름(예: 품종명+묘목)으로 찾는 수요가 크면 그 품종을 제목에 써도 된다. 제목을 그대로 베끼지는 마라.\n\n';
}
