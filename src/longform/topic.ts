/**
 * 롱폼 주제 선정(2026-10-22 사장님 결정) — 블로그+숏폼 조회 합산 상위 묶음. 결정적(LLM·외부 호출 없음, 로컬 데이터만).
 *
 * 시범(2026-10-19)을 손으로 고른 방식 그대로다: 발행 글마다 블로그 조회 + 그 글에서 파생된 숏폼 조회(유튜브·인스타·
 * 페북·네이버 클립)를 더해 줄 세우고, 맨 위 글(기둥)과 같은 주제의 글 3~5편을 엮는다.
 *
 * 주제 = 유튜브 작업 재생목록 분류(youtubePlaylists TOPIC_PLAYLISTS — 병충해·가지치기·심기·관리·구별·꽃열매)를 그대로 쓴다.
 * 채널 홈에서 이미 이 분류로 묶어 보여 주므로, 롱폼이 같은 분류를 따르면 재생목록·챕터가 같은 말을 한다.
 * topicKey = `${작업}:${기둥 수종}`(수종이 없으면 general). 이미 만든 롱폼과 겹치는 것은 셋으로 막는다:
 *   ① 같은 topicKey(영구) ② 이미 롱폼 원문으로 쓴 글(영구 — 같은 글을 두 번 영상으로 만들지 않는다)
 *   ③ 같은 작업 주제를 최근 TOPIC_COOLDOWN_DAYS 안에 만들었으면(두 주 연속 가지치기 같은 반복 방지).
 * 제철: 기둥 제목의 시기 소재(brand seasonalSubjects — offSeasonSubject)와 수종 검색 시즌 지수(수요 스냅샷 로컬 파일)로 판정.
 * 모르면 통과(fail-open) — 오토런 수종 선정(inSeasonSpecies)과 같은 원칙.
 *
 * v2 점수(2026-10-23 사장님 승인, LONGFORM_TOPIC_MODE=v2 — 비교 확인 전까지 기본은 views):
 *   블로그 하루 조회(발행 뒤 경과일, 최소 V2_MIN_DAYS) × 제철 앞당김(작업 철이 2~6주 뒤면 가점) × 판매 수종 가점.
 *   블로그 조회는 대부분 네이버 검색 유입 = 실제 검색 수요라 오래 검색되는 긴 영상과 맞는다. 숏폼 조회는 편당 ~1,000
 *   첫 배분 천장에 눌려 평평해 주제를 못 가른다 — 같은 점수일 때만 순서를 정한다(정렬 둘째 키).
 *   한 질문에 답하는 글이 V2_FULL_MIN_POSTS 편 이상일 때만 10분 편, 없으면 1~2편 짧은 편(목표 SHORT_TARGET_MINUTES 분).
 *   (음나무 편이 글 한 편을 10분으로 늘려 "이미 여러 글이 자세히 다룹니다" 같은 문장이 나왔다.)
 */
import { CONFIG } from '../config';
import { activeBrandSlug, getBrand } from '../content/brand';
import { pieceStore, type Piece } from '../content/pieces';
import { shortsStore, type Shorts } from '../content/shorts';
import { longformStore, type LongformRecord } from '../content/longform';
import { latestMetrics, latestMetricsBySource } from '../analytics/performance';
import { readDemandSnap } from '../analytics/topicDemand';
import { offSeasonSubject, type SeasonalSubject } from '../content/seasonalSubjects';
import type { TopicMode } from '../config';
import { TOPIC_PLAYLISTS, speciesOf, topicOf } from '../tools/youtubePlaylists';
import type { SpeciesGroup } from '../content/speciesRotation';
import { readFinalBody, SOURCE_PIECES } from './source';
import { PILOT_DIR_NAME } from './episode';
import type { LlmJSON } from './writer';

/** 같은 작업 주제 재사용 대기(일). */
export const TOPIC_COOLDOWN_DAYS = 28;
export const RELATED_MIN = 3;
export const RELATED_MAX = 5;
/** 묶음 일관성(LLM 모드, 2026-10-22) — 후보 풀 크기·같은 수종 다른 작업 추가분·LLM 에 물어볼 기둥 수. */
export const COHERE_POOL = 12;
export const COHERE_SPECIES_EXTRA = 4;
export const COHERE_ANCHORS = 3;
/** 한 묶음에 같은 수종 글은 이만큼까지(기둥 포함) — 한 수종 글만 엮으면 장이 비슷해진다. */
const PER_SPECIES_MAX = 2;
/** 제목 글자 겹침이 이 이상이면 거의 같은 글(같은 글을 두 번 쓴 편)로 본다. */
const NEAR_DUP = 0.6;

/** v2 제철 단계 — lead = 작업 철이 2~6주 뒤, soon = 2주 안, in = 지금 철, none = 모름·먼 철. */
export type SeasonPhase = 'lead' | 'soon' | 'in' | 'none';
export interface V2Score {
  ageDays: number;
  /** 블로그 하루 조회 = 누적 / max(V2_MIN_DAYS, 경과일). */
  perDay: number;
  season: { phase: SeasonPhase; mult: number; label: string };
  sales: { mult: number; label: string };
  /** perDay × 제철 × 판매. 숏폼은 같은 점수일 때만(정렬 둘째 키). */
  score: number;
}

export interface TopicPiece { id: string; title: string; runId?: string; species: string | null; topic: string | null; blogViews: number; shortsViews: number; views: number; v2?: V2Score }

export interface TopicDeps {
  pieces: () => Array<Pick<Piece, 'id' | 'title' | 'keyword' | 'runId' | 'brand' | 'publishedUrl' | 'publishedTs'> & Partial<Pick<Piece, 'createdTs'>>>;
  shorts: () => Array<Pick<Shorts, 'id' | 'sourcePieceId' | 'brand'>>;
  blogViews: (pieceId: string) => number;
  /** 숏폼 한 편의 채널 조회 합(유튜브 api 우선 + 인스타 + 페북 + 네이버 클립). */
  shortViews: (shortId: string) => number;
  records: () => Array<Pick<LongformRecord, 'dir' | 'createdTs' | 'topicKey' | 'sourcePieceIds' | 'title' | 'stage'>>;
  hasBody: (runId: string) => boolean;
  brand: string;
  catalog?: SpeciesGroup[];
  seasonalSubjects?: SeasonalSubject[];
  /** 수종 시즌 지수(0~1, 모르면 undefined). */
  seasonOf: (species: string) => number | undefined;
  minSeason: number;
  now: Date;
  /** 순위 방식(LONGFORM_TOPIC_MODE) — 없으면 views(종전 조회 합산). */
  mode?: TopicMode;
  /** 판매 수종(카탈로그 이름) — brand varieties(사장님 품종표). 표 밖 판매 수종은 가점 없음(감점도 없음). */
  sales?: ReadonlySet<string>;
  /** 블로그 조회 표본을 잰 때(ISO) — 하루 조회의 분모 끝. 없으면 now. */
  blogMeasuredAt?: (pieceId: string) => string | undefined;
}

/** v2 상수(2026-10-23). 하루 조회 분모 하한 — 갓 발행한 글이 하루 이틀 조회로 튀지 않게. */
export const V2_MIN_DAYS = 7;
const V2_UNKNOWN_AGE_DAYS = 30;
/** 앞당김 창(일) — 작업 철 시작이 이 안이면 lead, LEAD_MIN_DAYS 미만이면 soon. */
export const LEAD_MIN_DAYS = 14;
export const LEAD_MAX_DAYS = 42;
export const SEASON_MULT: Record<SeasonPhase, number> = { lead: 1.4, soon: 1.2, in: 1.1, none: 1 };
export const SALES_MULT = 1.15;
/** 판매 수종 + 심기(구매) 철이 지금이거나 6주 안. */
export const SALES_SEASON_MULT = 1.3;
/** 수종 검색 시즌 지수가 이 이상이면(달 정보가 없을 때만) 지금 철로 본다 — 앞당김 판정에는 안 쓴다(지금/다음 달 최대치라 못 가른다). */
const SEASON_IDX_IN = 0.7;
/** 10분 편이 되는 한 질문 글 수(기둥 포함). 미만이면 짧은 편. */
export const V2_FULL_MIN_POSTS = 3;
export const FULL_TARGET_MINUTES = 10;
export const SHORT_TARGET_MINUTES = 6;
/**
 * 작업 달력(새 가정 — 로컬 데이터에 작업별 달이 없다, 2026-10-23). 가지치기 = 겨울 전정(잎 진 뒤~눈 트기 전).
 * 심기는 brand seasonalSubjects 의 '… 식재' 달(봄 식재·가을 식재)을 쓴다. 병충해·관리·꽃열매·구별은 철이 일정하지 않아 모름(중립).
 */
export const TASK_MONTHS: Record<string, number[]> = { prune: [12, 1, 2] };
const TASK_WORD: Record<string, string> = { prune: '전정', plant: '심기', care: '관리', symptom: '병충해', fruit: '꽃·열매' };
const SEASON_WORDS: ReadonlyArray<[string, number[]]> = [['봄', [3, 4, 5]], ['여름', [6, 7, 8]], ['가을', [9, 10, 11]], ['겨울', [12, 1, 2]]];

/** 채널별 최신 표본 조회 합 — 유튜브는 공개 API 표본 우선(애널리틱스 표본과 겹쳐 세지 않는다, main.ts 성과 탭과 같은 규칙). */
export function shortViewsOf(id: string, latest: (id: string, prefix: string) => { views?: number } | null = latestMetricsBySource): number {
  const yt = latest(id, 'youtube:api') ?? latest(id, 'youtube:');
  return ['meta:ig', 'meta:fb', 'naver:clip'].reduce((n, p) => n + (latest(id, p)?.views ?? 0), yt?.views ?? 0);
}

/** 운영 데이터로 채운 부품 — 전부 로컬 파일(지표 jsonl·스토어·수요 스냅샷). */
export function defaultTopicDeps(now = new Date()): TopicDeps {
  const brand = activeBrandSlug() || '';
  const b = getBrand();
  const catalog = b?.speciesCatalog as SpeciesGroup[] | undefined;
  // 수요 스냅샷의 키워드 시즌 지수를 수종별 최대로 — 오토런 축 예시 수종(scheduler seedSpecies)과 같은 계산.
  const seasonBy = new Map<string, number>();
  for (const r of readDemandSnap(brand || undefined)?.rows ?? []) {
    const sp = speciesOf(r.keyword, catalog);
    if (sp && typeof r.seasonIdx === 'number') seasonBy.set(sp, Math.max(seasonBy.get(sp) ?? 0, r.seasonIdx));
  }
  // 판매 수종 = 사장님 품종표(brand varieties) 키를 카탈로그 이름으로(엄나무 ↔ 음나무 같은 별칭 정리).
  const sales = new Set(Object.keys(b?.varieties ?? {}).map((k) => speciesOf(k, catalog) ?? k));
  return {
    pieces: () => pieceStore().list(),
    shorts: () => shortsStore().list(),
    blogViews: (id) => latestMetrics(id)?.views ?? 0,
    shortViews: (id) => shortViewsOf(id),
    records: () => longformStore().list(),
    hasBody: (runId) => !!readFinalBody(runId, CONFIG.sessionsDir),
    brand, catalog, seasonalSubjects: b?.seasonalSubjects,
    seasonOf: (sp) => seasonBy.get(sp),
    minSeason: CONFIG.topicDemandMinSeason,
    now,
    mode: CONFIG.longformTopicMode,
    sales,
    blogMeasuredAt: (id) => latestMetrics(id)?.measuredAt,
  };
}

/** 심기(구매) 철 달(순수) — brand seasonalSubjects 의 '… 식재' 소재 달 합. */
export function plantMonths(subjects: SeasonalSubject[] | undefined): number[] {
  return [...new Set((subjects ?? []).filter((s) => s?.term?.includes('식재')).flatMap((s) => s.months ?? []))];
}

/**
 * 글의 작업 철(순수) — 제목 먼저(brand 시기 소재·'N월'·'N~M월'·봄여름가을겨울), 없으면 작업 달력(TASK_MONTHS·심기 = 식재 달).
 * 모르면 null(중립). what = 이유 문구용 이름('겨울 전정'·'월동'·'9월'…).
 */
export function seasonMonthsOf(title: string, topic: string | null, subjects?: SeasonalSubject[]): { months: number[]; what: string } | null {
  const ms = new Set<number>();
  const what: string[] = [];
  const task = topic ? TASK_WORD[topic] ?? '' : '';
  for (const s of subjects ?? []) {
    if (!s?.term || !s.months?.length || !title.includes(s.term)) continue;
    s.months.forEach((m) => ms.add(m));
    what.push(s.term);
  }
  for (const m of title.matchAll(/(\d{1,2})\s*[~∼-]\s*(\d{1,2})월|(\d{1,2})월/g)) {
    const [a, b] = m[3] ? [Number(m[3]), Number(m[3])] : [Number(m[1]), Number(m[2])];
    if (!(a >= 1 && a <= 12 && b >= 1 && b <= 12)) continue;
    for (let k = a; ; k = (k % 12) + 1) { ms.add(k); if (k === b) break; }
    what.push(`${m[0].replace(/\s/g, '')}${task ? ` ${task}` : ''}`);
  }
  for (const [w, months] of SEASON_WORDS) {
    // '겨울 전에'는 겨울 앞(지금) — 철로 치지 않는다('겨울전정'은 그대로 겨울).
    if (!new RegExp(`${w}(?!\\s*전(?!정))`).test(title)) continue;
    months.forEach((m) => ms.add(m));
    what.push(`${w}${task ? ` ${task}` : ''}`);
  }
  if (ms.size) return { months: [...ms], what: what[0]! };
  const tm = topic === 'plant' ? plantMonths(subjects) : topic ? TASK_MONTHS[topic] ?? [] : [];
  return tm.length ? { months: tm, what: task } : null;
}

/** 작업 철 단계(순수) — 이번 달이 철이면 in, 아니면 다음 철 첫날까지 일수로 lead(14~42일)·soon(14일 미만)·none. */
export function seasonPhase(months: readonly number[], now: Date): { phase: SeasonPhase; days: number } {
  const cur = now.getMonth() + 1;
  if (months.includes(cur)) return { phase: 'in', days: 0 };
  for (let k = 1; k <= 12; k++) {
    if (!months.includes(((cur - 1 + k) % 12) + 1)) continue;
    const days = Math.round((new Date(now.getFullYear(), now.getMonth() + k, 1).getTime() - now.getTime()) / 86_400_000);
    if (days > LEAD_MAX_DAYS) return { phase: 'none', days };
    return { phase: days >= LEAD_MIN_DAYS ? 'lead' : 'soon', days };
  }
  return { phase: 'none', days: Infinity };
}

/** v2 점수(순수) — 하루 조회 × 제철 앞당김 × 판매 수종. */
export function v2Score(
  p: Pick<TopicPiece, 'title' | 'topic' | 'species' | 'blogViews'> & { publishedTs?: string; measuredAt?: string },
  d: Pick<TopicDeps, 'seasonalSubjects' | 'sales'> & Partial<Pick<TopicDeps, 'seasonOf' | 'now'>>,
): V2Score {
  const now = d.now ?? new Date();
  const pub = p.publishedTs ? Date.parse(p.publishedTs) : NaN;
  const end = p.measuredAt ? Date.parse(p.measuredAt) : now.getTime();
  const ageDays = Number.isFinite(pub) && Number.isFinite(end) ? Math.max(0, (end - pub) / 86_400_000) : V2_UNKNOWN_AGE_DAYS;
  const perDay = p.blogViews / Math.max(V2_MIN_DAYS, ageDays);
  // 제철 — 달을 알면 앞당김 판정, 모르면 수종 검색 시즌이 높을 때만 '지금 철'(살짝), 그 밖은 중립.
  let season: V2Score['season'] = { phase: 'none', mult: 1, label: '' };
  const sm = seasonMonthsOf(p.title, p.topic, d.seasonalSubjects);
  if (sm) {
    const { phase, days } = seasonPhase(sm.months, now);
    const label = phase === 'in' ? `지금 ${sm.what} 철` : phase === 'none' ? '' : `${Math.max(1, Math.round(days / 7))}주 뒤 ${sm.what} 철`;
    season = { phase, mult: SEASON_MULT[phase], label };
  } else if (p.species && (d.seasonOf?.(p.species) ?? 0) >= SEASON_IDX_IN) {
    season = { phase: 'in', mult: SEASON_MULT.in, label: `${p.species} 검색 철` };
  }
  // 판매 — 품종표 수종이면 가점, 심기(구매) 철이 지금이거나 6주 안이면 더 크게.
  let sales: V2Score['sales'] = { mult: 1, label: '' };
  if (p.species && d.sales?.has(p.species)) {
    const pm = plantMonths(d.seasonalSubjects);
    const buying = pm.length > 0 && seasonPhase(pm, now).phase !== 'none';
    sales = buying ? { mult: SALES_SEASON_MULT, label: '판매 수종·심기 철' } : { mult: SALES_MULT, label: '판매 수종' };
  }
  return { ageDays, perDay, season, sales, score: perDay * season.mult * sales.mult };
}

/** 하루 조회 표기(순수) — 10 미만은 소수 한 자리. */
export const fmtPerDay = (n: number): string => (n >= 10 ? Math.round(n).toLocaleString('ko-KR') : (Math.round(n * 10) / 10).toString());

/** v2 이유 괄호(순수) — '블로그 하루 12회 · 5주 뒤 겨울 전정 철 · 판매 수종 · 숏폼 1,000'. */
export function v2Caption(p: TopicPiece): string {
  if (!p.v2) return '';
  return [`블로그 하루 ${fmtPerDay(p.v2.perDay)}회`, p.v2.season.label, p.v2.sales.label, p.shortsViews ? `숏폼 ${fmtViews(p.shortsViews)}` : ''].filter(Boolean).join(' · ');
}

/** 순위(순수) — 이 브랜드 발행 글 전부. views = 조회 합산 큰 순(종전), v2 = v2 점수 큰 순(같으면 숏폼 조회 큰 순). */
export function rankPieces(d: Pick<TopicDeps, 'pieces' | 'shorts' | 'blogViews' | 'shortViews' | 'brand' | 'catalog'> & Partial<Pick<TopicDeps, 'mode' | 'seasonalSubjects' | 'sales' | 'seasonOf' | 'now' | 'blogMeasuredAt'>>): TopicPiece[] {
  const shortsBy = new Map<string, string[]>();
  for (const s of d.shorts()) {
    if (!s.sourcePieceId || (s.brand ?? '') !== d.brand) continue;
    shortsBy.set(s.sourcePieceId, [...(shortsBy.get(s.sourcePieceId) ?? []), s.id]);
  }
  return d.pieces()
    .filter((p) => (p.brand ?? '') === d.brand && !!p.publishedUrl)
    .map((p) => {
      const text = `${p.keyword ?? ''} ${p.title}`.trim();
      const species = speciesOf(text, d.catalog);
      const blogViews = d.blogViews(p.id);
      const shortsViews = (shortsBy.get(p.id) ?? []).reduce((n, id) => n + d.shortViews(id), 0);
      const topic = topicOf(text, species);
      const measuredAt = d.blogMeasuredAt?.(p.id);
      const v2 = v2Score({ title: p.title, topic, species, blogViews, publishedTs: p.publishedTs ?? p.createdTs, ...(measuredAt ? { measuredAt } : {}) }, d);
      return { id: p.id, title: p.title, runId: p.runId, species, topic, blogViews, shortsViews, views: blogViews + shortsViews, v2 };
    })
    .sort(d.mode === 'v2'
      ? (a, b) => b.v2.score - a.v2.score || b.shortsViews - a.shortsViews || a.id.localeCompare(b.id)
      : (a, b) => b.views - a.views || a.id.localeCompare(b.id));
}

/** 숫자 한국어 줄임(순수) — 12,345 → '1.2만', 980 → '980'. */
export function fmtViews(n: number): string {
  if (n >= 10_000) return `${(Math.round(n / 1000) / 10).toLocaleString('ko-KR')}만`;
  return n.toLocaleString('ko-KR');
}

/** 글자 두 개 묶음 겹침(Dice, 순수) — 제목이 거의 같은 글 거르기. */
export function titleSimilarity(a: string, b: string): number {
  const grams = (s: string) => { const t = s.replace(/\s+/g, ''); const g: string[] = []; for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2)); return g; };
  const A = grams(a), B = grams(b);
  if (!A.length || !B.length) return 0;
  const bag = new Map<string, number>();
  for (const g of B) bag.set(g, (bag.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of A) { const n = bag.get(g) ?? 0; if (n > 0) { hit++; bag.set(g, n - 1); } }
  return (2 * hit) / (A.length + B.length);
}

/** 작업 주제 이름(이유 문구용) — TOPIC_PLAYLISTS 키와 한 쌍. 모르는 키는 재생목록 제목 그대로. */
const TOPIC_LABELS: Record<string, string> = { symptom: '병충해·증상', prune: '가지치기', plant: '묘목·심기', care: '물·거름·월동 관리', lore: '구별·나무 이야기', fruit: '꽃눈·열매' };
export const topicLabel = (key: string | null): string => (key && TOPIC_LABELS[key]) || TOPIC_PLAYLISTS.find((p) => p.key === key)?.title || (key ?? '');

export interface TopicChoice {
  topicKey: string;
  topic: string;
  anchor: TopicPiece;
  /** 기둥 + 관련 글(대본 원문 순서 — 기둥 먼저). */
  pieces: TopicPiece[];
  reason: string;
  /** 묶음 주제(LLM 이 고른 시청자 질문 하나 — 편의 작업 제목). 결정적 선정·수동 지정이면 없음. */
  theme?: string;
  /** 목표 길이(분, v2) — 한 질문 글이 V2_FULL_MIN_POSTS 편 미만이면 SHORT_TARGET_MINUTES. 없으면 대본 기본(10분). */
  targetMinutes?: number;
}

export interface TopicCandidate {
  piece: TopicPiece; rank: number; ok: boolean; why: string; related?: TopicPiece[];
  /** 기둥이 될 수 있나(쓴 글·같은 키·최근 작업 주제·제철 통과) — 관련 글 수와 무관. */
  eligible?: boolean;
  /** 묶음 후보(LLM 이 고를 풀) — 같은 작업 주제 최대 COHERE_POOL 편 + 같은 수종 다른 작업 몇 편, 거의 같은 제목 제외. */
  pool?: TopicPiece[];
}

/** 10분 편에 필요한 관련 글 수(기둥 제외) — views 는 종전 RELATED_MIN, v2 는 기둥 포함 V2_FULL_MIN_POSTS 편. */
const minRelatedOf = (mode: TopicMode | undefined): number => (mode === 'v2' ? V2_FULL_MIN_POSTS - 1 : RELATED_MIN);

/** 이미 만든 롱폼 — 쓴 글 id·topicKey·최근 작업 주제. 시범 레코드(키·원문 목록 없음)는 원문 고정 목록·제목 분류로 채운다. */
function usedOf(d: Pick<TopicDeps, 'records' | 'now' | 'catalog'>): { pieces: Set<string>; keys: Set<string>; recentTopics: Set<string> } {
  const pieces = new Set<string>(), keys = new Set<string>(), recentTopics = new Set<string>();
  for (const r of d.records()) {
    if (r.stage === 'error') continue; // 실패한 편은 주제를 쓰지 않은 것
    const ids = r.sourcePieceIds ?? (r.dir === PILOT_DIR_NAME ? [...SOURCE_PIECES] : []);
    ids.forEach((id) => pieces.add(id));
    const sp = speciesOf(r.title, d.catalog);
    const key = r.topicKey ?? (() => { const t = topicOf(r.title, sp); return t ? `${t}:${sp ?? 'general'}` : null; })();
    if (!key) continue;
    keys.add(key);
    const age = (d.now.getTime() - Date.parse(r.createdTs)) / 86_400_000;
    if (age < TOPIC_COOLDOWN_DAYS) recentTopics.add(key.split(':')[0]!);
  }
  return { pieces, keys, recentTopics };
}

/** 제철 판정(순수) — 시기 밖 소재면 그 사유, 수종 시즌이 낮으면 그 사유, 아니면 null(모름 = 통과). */
function offSeasonWhy(p: TopicPiece, d: Pick<TopicDeps, 'seasonalSubjects' | 'seasonOf' | 'minSeason' | 'now'>): string | null {
  const sub = offSeasonSubject(p.title, d.seasonalSubjects, d.now);
  if (sub) return `제철 아님('${sub.term}' ${sub.months.join('·')}월)`;
  const s = p.species ? d.seasonOf(p.species) : undefined;
  if (s !== undefined && s < d.minSeason) return `제철 아님(${p.species} 시즌 ${s.toFixed(2)})`;
  return null;
}

/** 후보 전부 판정(순수) — 드라이런 CLI 가 상위 몇 개를 그대로 보여 준다. */
export function evaluateTopics(d: TopicDeps): TopicCandidate[] {
  const ranked = rankPieces(d);
  const minRel = minRelatedOf(d.mode);
  const used = usedOf(d);
  const okBase = (p: TopicPiece): string | null => {
    if (!p.topic) return '주제 분류 없음';
    if (used.pieces.has(p.id)) return '이미 롱폼 원문으로 쓴 글';
    if (!p.runId || !d.hasBody(p.runId)) return '발행 본문 파일 없음';
    return offSeasonWhy(p, d);
  };
  return ranked.map((p, i) => {
    const base = okBase(p);
    if (base) return { piece: p, rank: i + 1, ok: false, why: base };
    const key = `${p.topic}:${p.species ?? 'general'}`;
    if (used.keys.has(key)) return { piece: p, rank: i + 1, ok: false, why: `이미 만든 주제(${key})` };
    if (used.recentTopics.has(p.topic!)) return { piece: p, rank: i + 1, ok: false, why: `최근 ${TOPIC_COOLDOWN_DAYS}일 안에 같은 작업 주제(${topicLabel(p.topic)})` };
    // 묶음 후보 풀(LLM 모드) — 같은 작업 주제 조회 큰 순 최대 COHERE_POOL + 같은 수종 다른 작업 최대 COHERE_SPECIES_EXTRA.
    const pool: TopicPiece[] = [];
    let extra = 0;
    for (const q of ranked) {
      if (q.id === p.id || okBase(q)) continue;
      const sameTask = q.topic === p.topic;
      const sameSp = !!p.species && q.species === p.species;
      if (!sameTask && !sameSp) continue;
      if (sameTask ? pool.length - extra >= COHERE_POOL : extra >= COHERE_SPECIES_EXTRA) continue;
      if ([p, ...pool].some((x) => titleSimilarity(x.title, q.title) >= NEAR_DUP)) continue;
      pool.push(q);
      if (!sameTask) extra++;
    }
    // 관련 글 — 같은 주제, 조회 큰 순, 거의 같은 제목·한 수종 쏠림 제외.
    const picked: TopicPiece[] = [p];
    const perSp = new Map<string, number>(p.species ? [[p.species, 1]] : []);
    for (const q of ranked) {
      if (picked.length > RELATED_MAX) break;
      if (q.id === p.id || q.topic !== p.topic || okBase(q)) continue;
      if (picked.some((x) => titleSimilarity(x.title, q.title) >= NEAR_DUP)) continue;
      if (q.species && (perSp.get(q.species) ?? 0) >= PER_SPECIES_MAX) continue;
      picked.push(q);
      if (q.species) perSp.set(q.species, (perSp.get(q.species) ?? 0) + 1);
    }
    const related = picked.slice(1);
    if (related.length < minRel) return { piece: p, rank: i + 1, ok: false, why: `같은 주제 글 ${related.length}편 — ${minRel}편 미만`, related, eligible: true, pool };
    return { piece: p, rank: i + 1, ok: true, why: '선정 가능', related, eligible: true, pool };
  });
}

/** 고른 이유 한 줄(순수) — 텔레그램 캡션에 그대로. v2 는 점수 근거(하루 조회·제철·판매), 짧은 편이면 그 사실도. */
export function topicReason(c: TopicCandidate, skippedAbove: number, mode: TopicMode = 'views', short = false): string {
  const p = c.piece;
  const n = (c.related?.length ?? 0) + 1;
  const head = mode === 'v2' && p.v2
    ? `v2 점수 ${c.rank}위 '${p.title}'(${v2Caption(p)}) 중심, 같은 주제(${topicLabel(p.topic)}) 글 ${n}편`
    : `조회 합산 ${c.rank}위 '${p.title}'(블로그 ${fmtViews(p.blogViews)}+숏폼 ${fmtViews(p.shortsViews)}) 중심, 같은 주제(${topicLabel(p.topic)}) 글 ${n}편`;
  return head
    + (skippedAbove ? ` — 위 ${skippedAbove}편은 이미 만든 주제·제철 아님 등으로 건너뜀` : ' — 지난 롱폼과 겹치지 않음')
    + (short ? ` — 한 질문에 답하는 글이 ${V2_FULL_MIN_POSTS}편 미만이라 짧은 편(목표 ${SHORT_TARGET_MINUTES}분)` : '');
}

/**
 * v2 짧은 편(순수) — 10분 묶음이 하나도 없을 때 가장 위 기둥 후보(쓴 글·같은 키·최근 작업·제철 통과)를 1~2편으로.
 * related = 함께 엮을 글(LLM 이 확인한 것 — 결정적 선정이면 같은 주제 조회 큰 순), 1편까지만.
 */
export function shortChoice(all: TopicCandidate[], related?: (c: TopicCandidate) => TopicPiece[] | undefined, note = ''): TopicChoice | null {
  const j = all.findIndex((c) => c.eligible);
  if (j < 0) return null;
  const c = all[j]!;
  const rel = (related?.(c) ?? c.related ?? []).slice(0, V2_FULL_MIN_POSTS - 2);
  return {
    topicKey: `${c.piece.topic}:${c.piece.species ?? 'general'}`, topic: c.piece.topic!, anchor: c.piece, pieces: [c.piece, ...rel],
    reason: topicReason({ ...c, related: rel }, j, 'v2', true) + note, targetMinutes: SHORT_TARGET_MINUTES,
  };
}

/** 주제 선정 — 맞는 후보가 없으면 null. pieceIds 를 주면(수동 지정) 그 글들로 묶는다(첫 글이 기둥). */
export function selectTopic(d: TopicDeps, pieceIds?: string[]): TopicChoice | null {
  if (pieceIds?.length) {
    const ranked = rankPieces(d);
    const byId = new Map(ranked.map((p) => [p.id, p]));
    const pieces = pieceIds.map((id) => byId.get(id) ?? { id, title: id, species: null, topic: null, blogViews: 0, shortsViews: 0, views: 0 });
    const anchor = pieces[0]!;
    const topic = anchor.topic ?? 'manual';
    return {
      topicKey: `${topic}:${anchor.species ?? 'general'}`, topic, anchor, pieces,
      reason: `사람이 고른 글 ${pieces.length}편 — '${anchor.title}' 중심(조회 합산 ${fmtViews(anchor.views)})`,
    };
  }
  const all = evaluateTopics(d);
  const i = all.findIndex((c) => c.ok);
  if (i < 0) return d.mode === 'v2' ? shortChoice(all) : null;
  const c = all[i]!;
  return {
    topicKey: `${c.piece.topic}:${c.piece.species ?? 'general'}`, topic: c.piece.topic!, anchor: c.piece,
    pieces: [c.piece, ...(c.related ?? [])], reason: topicReason(c, i, d.mode),
    ...(d.mode === 'v2' ? { targetMinutes: FULL_TARGET_MINUTES } : {}),
  };
}

/**
 * 묶음 일관성(2026-10-22) — 같은 작업 주제라도 기둥과 엮은 글이 서로 다른 질문이면(감나무 묘목 + 하스카프 라벨 + 무화과 겨울 기온…)
 * 한 편의 이야기가 안 된다. 싼 LLM 한 번이 후보 풀에서 기둥과 함께 '시청자 질문 하나'에 답하는 글 3~5편을 고른다.
 */
export interface CoherencePick { theme: string; pieceIds: string[]; why: string }
export type CoherenceLlm = (o: { anchor: TopicPiece; candidates: TopicPiece[]; signal?: AbortSignal; minRelated?: number }) => Promise<CoherencePick | null>;

/** 지시문(순수). */
export function coherencePrompt(anchor: TopicPiece, candidates: readonly TopicPiece[], minRelated: number = RELATED_MIN): { system: string; user: string } {
  return {
    system: '너는 나무 정원 유튜브 채널의 편집장이다. 블로그 글 묶음으로 10분짜리 영상 한 편을 만든다. 요청된 JSON 만 출력한다.',
    user: [
      `[중심 글] ${anchor.title}${anchor.species ? ` (수종 ${anchor.species})` : ''}`,
      '',
      '[후보 글] id | 제목 | 수종 | 작업 분류',
      ...candidates.map((c) => `${c.id} | ${c.title} | ${c.species ?? '-'} | ${topicLabel(c.topic)}`),
      '',
      `중심 글과 함께 시청자의 질문 하나에 답하는 글을 후보에서 ${minRelated}~${RELATED_MAX}편 골라라. 영상 한 편이 처음부터 끝까지 그 질문 하나를 따라가야 한다.`,
      '- 같은 수종의 다른 단계(고르기→심기→첫해 관리)나, 같은 작업을 여러 수종에 견주는 묶음은 좋다.',
      '- 수종도 작업도 질문도 따로 노는 글(예: 감나무 묘목 + 다른 과수 라벨 읽기 + 또 다른 나무 겨울 기온)은 고르지 마라.',
      `- 억지로 채우지 마라 — 어울리는 글이 ${minRelated}편 미만이면 있는 만큼만 고른다(pieceIds 가 ${minRelated}개 미만이면 이 중심 글은 쓰지 않는다).`,
      'theme: 그 질문을 담은 편의 작업 제목(한국어 25자 이내). why: 왜 한 이야기인지 한 문장.',
      '',
      '{"theme":"…","pieceIds":["…"],"why":"…"}',
    ].join('\n'),
  };
}

/** LLM 부품 — 표준 모델 한 번. */
export function coherenceLlm(llm: LlmJSON, model: string = CONFIG.cloudTierModels.standard): CoherenceLlm {
  return async ({ anchor, candidates, signal, minRelated }) => {
    const { system, user } = coherencePrompt(anchor, candidates, minRelated);
    const raw = await llm<{ theme?: unknown; pieceIds?: unknown; why?: unknown }>(model, system, user, { maxOutputTokens: 800, ...(signal ? { signal } : {}) });
    if (!raw) return null;
    const ids = Array.isArray(raw.pieceIds) ? raw.pieceIds.filter((x): x is string => typeof x === 'string') : [];
    return { theme: typeof raw.theme === 'string' ? raw.theme.trim().slice(0, 40) : '', pieceIds: ids, why: typeof raw.why === 'string' ? raw.why.trim().slice(0, 200) : '' };
  };
}

/**
 * 주제 선정(LLM 묶음 모드) — 결정적 거르기(쓴 글·같은 키·최근 작업 주제·제철·거의 같은 제목)는 그대로, 기둥 후보 위에서부터 최대
 * COHERE_ANCHORS 개를 LLM 에 물어 3편 이상 한 질문으로 묶이는 첫 기둥을 쓴다. 없으면 null(no_topic).
 * v2 는 기둥 포함 V2_FULL_MIN_POSTS 편이면 10분 편, 없으면 맨 위 기둥 후보로 짧은 편(LLM 이 확인한 글 1편까지만 엮는다).
 */
export async function selectCoherentTopic(d: TopicDeps, llm: CoherenceLlm, o: { signal?: AbortSignal; log?: (m: string) => void } = {}): Promise<TopicChoice | null> {
  const all = evaluateTopics(d);
  const v2 = d.mode === 'v2';
  const minRel = minRelatedOf(d.mode);
  const anchors = all.map((c, i) => ({ c, i })).filter(({ c }) => c.eligible && (c.pool?.length ?? 0) >= minRel).slice(0, COHERE_ANCHORS);
  const rejected: string[] = [];
  const confirmed = new Map<string, TopicPiece[]>();
  for (const { c, i } of anchors) {
    const pick = await llm({ anchor: c.piece, candidates: c.pool!, ...(o.signal ? { signal: o.signal } : {}), ...(v2 ? { minRelated: minRel } : {}) });
    const byId = new Map(c.pool!.map((p) => [p.id, p]));
    const ids = [...new Set(pick?.pieceIds ?? [])].filter((id) => byId.has(id)).slice(0, RELATED_MAX);
    if (pick?.theme) confirmed.set(c.piece.id, ids.map((id) => byId.get(id)!));
    if (!pick || ids.length < minRel || !pick.theme) {
      rejected.push(`'${c.piece.title}'(${ids.length}편)`);
      o.log?.(`[주제] 기둥 '${c.piece.title}' — 한 질문으로 묶이는 글 ${ids.length}편, 다음 기둥`);
      continue;
    }
    const related = ids.map((id) => byId.get(id)!);
    const base = topicReason({ ...c, related }, i, d.mode);
    return {
      topicKey: `${c.piece.topic}:${c.piece.species ?? 'general'}`, topic: c.piece.topic!, anchor: c.piece, pieces: [c.piece, ...related], theme: pick.theme,
      reason: `${base} — 묶음 주제 '${pick.theme}'${pick.why ? `: ${pick.why}` : ''}${rejected.length ? ` (한 이야기로 안 묶여 넘긴 기둥: ${rejected.join(', ')})` : ''}`,
      ...(v2 ? { targetMinutes: FULL_TARGET_MINUTES } : {}),
    };
  }
  if (!v2) return null;
  const s = shortChoice(all, (c) => confirmed.get(c.piece.id) ?? [], rejected.length ? ` (한 이야기로 안 묶여 넘긴 기둥: ${rejected.join(', ')})` : '');
  if (s) o.log?.(`[주제] 10분 묶음 없음 — 짧은 편 '${s.anchor.title}' ${s.pieces.length}편(목표 ${SHORT_TARGET_MINUTES}분)`);
  return s;
}
