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
 */
import { CONFIG } from '../config';
import { activeBrandSlug, getBrand } from '../content/brand';
import { pieceStore, type Piece } from '../content/pieces';
import { shortsStore, type Shorts } from '../content/shorts';
import { longformStore, type LongformRecord } from '../content/longform';
import { latestMetrics, latestMetricsBySource } from '../analytics/performance';
import { readDemandSnap } from '../analytics/topicDemand';
import { offSeasonSubject, type SeasonalSubject } from '../content/seasonalSubjects';
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

export interface TopicPiece { id: string; title: string; runId?: string; species: string | null; topic: string | null; blogViews: number; shortsViews: number; views: number }

export interface TopicDeps {
  pieces: () => Array<Pick<Piece, 'id' | 'title' | 'keyword' | 'runId' | 'brand' | 'publishedUrl'>>;
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
}

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
  };
}

/** 조회 합산 순위(순수) — 이 브랜드 발행 글 전부, 큰 순. */
export function rankPieces(d: Pick<TopicDeps, 'pieces' | 'shorts' | 'blogViews' | 'shortViews' | 'brand' | 'catalog'>): TopicPiece[] {
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
      return { id: p.id, title: p.title, runId: p.runId, species, topic: topicOf(text, species), blogViews, shortsViews, views: blogViews + shortsViews };
    })
    .sort((a, b) => b.views - a.views || a.id.localeCompare(b.id));
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
}

export interface TopicCandidate {
  piece: TopicPiece; rank: number; ok: boolean; why: string; related?: TopicPiece[];
  /** 기둥이 될 수 있나(쓴 글·같은 키·최근 작업 주제·제철 통과) — 관련 글 수와 무관. */
  eligible?: boolean;
  /** 묶음 후보(LLM 이 고를 풀) — 같은 작업 주제 최대 COHERE_POOL 편 + 같은 수종 다른 작업 몇 편, 거의 같은 제목 제외. */
  pool?: TopicPiece[];
}

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
    if (related.length < RELATED_MIN) return { piece: p, rank: i + 1, ok: false, why: `같은 주제 글 ${related.length}편 — ${RELATED_MIN}편 미만`, related, eligible: true, pool };
    return { piece: p, rank: i + 1, ok: true, why: '선정 가능', related, eligible: true, pool };
  });
}

/** 고른 이유 한 줄(순수) — 텔레그램 캡션에 그대로. */
export function topicReason(c: TopicCandidate, skippedAbove: number): string {
  const p = c.piece;
  const n = (c.related?.length ?? 0) + 1;
  return `조회 합산 ${c.rank}위 '${p.title}'(블로그 ${fmtViews(p.blogViews)}+숏폼 ${fmtViews(p.shortsViews)}) 중심, 같은 주제(${topicLabel(p.topic)}) 글 ${n}편`
    + (skippedAbove ? ` — 위 ${skippedAbove}편은 이미 만든 주제·제철 아님 등으로 건너뜀` : ' — 지난 롱폼과 겹치지 않음');
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
  if (i < 0) return null;
  const c = all[i]!;
  return {
    topicKey: `${c.piece.topic}:${c.piece.species ?? 'general'}`, topic: c.piece.topic!, anchor: c.piece,
    pieces: [c.piece, ...(c.related ?? [])], reason: topicReason(c, i),
  };
}

/**
 * 묶음 일관성(2026-10-22) — 같은 작업 주제라도 기둥과 엮은 글이 서로 다른 질문이면(감나무 묘목 + 하스카프 라벨 + 무화과 겨울 기온…)
 * 한 편의 이야기가 안 된다. 싼 LLM 한 번이 후보 풀에서 기둥과 함께 '시청자 질문 하나'에 답하는 글 3~5편을 고른다.
 */
export interface CoherencePick { theme: string; pieceIds: string[]; why: string }
export type CoherenceLlm = (o: { anchor: TopicPiece; candidates: TopicPiece[]; signal?: AbortSignal }) => Promise<CoherencePick | null>;

/** 지시문(순수). */
export function coherencePrompt(anchor: TopicPiece, candidates: readonly TopicPiece[]): { system: string; user: string } {
  return {
    system: '너는 나무 정원 유튜브 채널의 편집장이다. 블로그 글 묶음으로 10분짜리 영상 한 편을 만든다. 요청된 JSON 만 출력한다.',
    user: [
      `[중심 글] ${anchor.title}${anchor.species ? ` (수종 ${anchor.species})` : ''}`,
      '',
      '[후보 글] id | 제목 | 수종 | 작업 분류',
      ...candidates.map((c) => `${c.id} | ${c.title} | ${c.species ?? '-'} | ${topicLabel(c.topic)}`),
      '',
      '중심 글과 함께 시청자의 질문 하나에 답하는 글을 후보에서 3~5편 골라라. 영상 한 편이 처음부터 끝까지 그 질문 하나를 따라가야 한다.',
      '- 같은 수종의 다른 단계(고르기→심기→첫해 관리)나, 같은 작업을 여러 수종에 견주는 묶음은 좋다.',
      '- 수종도 작업도 질문도 따로 노는 글(예: 감나무 묘목 + 다른 과수 라벨 읽기 + 또 다른 나무 겨울 기온)은 고르지 마라.',
      '- 억지로 채우지 마라 — 어울리는 글이 3편 미만이면 있는 만큼만 고른다(pieceIds 가 3개 미만이면 이 중심 글은 쓰지 않는다).',
      'theme: 그 질문을 담은 편의 작업 제목(한국어 25자 이내). why: 왜 한 이야기인지 한 문장.',
      '',
      '{"theme":"…","pieceIds":["…"],"why":"…"}',
    ].join('\n'),
  };
}

/** LLM 부품 — 표준 모델 한 번. */
export function coherenceLlm(llm: LlmJSON, model: string = CONFIG.cloudTierModels.standard): CoherenceLlm {
  return async ({ anchor, candidates, signal }) => {
    const { system, user } = coherencePrompt(anchor, candidates);
    const raw = await llm<{ theme?: unknown; pieceIds?: unknown; why?: unknown }>(model, system, user, { maxOutputTokens: 800, ...(signal ? { signal } : {}) });
    if (!raw) return null;
    const ids = Array.isArray(raw.pieceIds) ? raw.pieceIds.filter((x): x is string => typeof x === 'string') : [];
    return { theme: typeof raw.theme === 'string' ? raw.theme.trim().slice(0, 40) : '', pieceIds: ids, why: typeof raw.why === 'string' ? raw.why.trim().slice(0, 200) : '' };
  };
}

/**
 * 주제 선정(LLM 묶음 모드) — 결정적 거르기(쓴 글·같은 키·최근 작업 주제·제철·거의 같은 제목)는 그대로, 기둥 후보 위에서부터 최대
 * COHERE_ANCHORS 개를 LLM 에 물어 3편 이상 한 질문으로 묶이는 첫 기둥을 쓴다. 없으면 null(no_topic).
 */
export async function selectCoherentTopic(d: TopicDeps, llm: CoherenceLlm, o: { signal?: AbortSignal; log?: (m: string) => void } = {}): Promise<TopicChoice | null> {
  const all = evaluateTopics(d);
  const anchors = all.map((c, i) => ({ c, i })).filter(({ c }) => c.eligible && (c.pool?.length ?? 0) >= RELATED_MIN).slice(0, COHERE_ANCHORS);
  const rejected: string[] = [];
  for (const { c, i } of anchors) {
    const pick = await llm({ anchor: c.piece, candidates: c.pool!, ...(o.signal ? { signal: o.signal } : {}) });
    const byId = new Map(c.pool!.map((p) => [p.id, p]));
    const ids = [...new Set(pick?.pieceIds ?? [])].filter((id) => byId.has(id)).slice(0, RELATED_MAX);
    if (!pick || ids.length < RELATED_MIN || !pick.theme) {
      rejected.push(`'${c.piece.title}'(${ids.length}편)`);
      o.log?.(`[주제] 기둥 '${c.piece.title}' — 한 질문으로 묶이는 글 ${ids.length}편, 다음 기둥`);
      continue;
    }
    const related = ids.map((id) => byId.get(id)!);
    const base = topicReason({ ...c, related }, i);
    return {
      topicKey: `${c.piece.topic}:${c.piece.species ?? 'general'}`, topic: c.piece.topic!, anchor: c.piece, pieces: [c.piece, ...related], theme: pick.theme,
      reason: `${base} — 묶음 주제 '${pick.theme}'${pick.why ? `: ${pick.why}` : ''}${rejected.length ? ` (한 이야기로 안 묶여 넘긴 기둥: ${rejected.join(', ')})` : ''}`,
    };
  }
  return null;
}
