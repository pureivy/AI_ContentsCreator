/**
 * 롱폼 대본 스키마·검증 — 결정적(LLM 없음).
 * 설계: docs/superpowers/specs/2026-10-19-longform-pilot-design.md · 매주 자동화 docs/superpowers/plans/2026-10-22-longform-weekly.md
 *
 * 2026-10-22 일반화: 장 id·장 수종·금지어·캡션 강조어는 대본(데이터)이 정한다. 시범(pilot-2026-10-19) 대본은 이 필드가 없어
 * CHAPTER_SPECIES·FRUIT_SPECIES·PILOT_BANNED_WORDS 를 대신 쓴다(loadEpisodeScript 가 금지어를 채운다).
 */
import { timingParityIssues } from '../content/timingParity';
import type { Accent, LfCard, Mg } from './types';

export type { Mg };

/** 장 id — 시범은 intro·scaffold·maesil·jadu·gam·blueberry·outro, 새 편은 작가가 정한 영문 소문자 id. */
export type ChapterId = string;

/** 시범 장 순서(시범 모양 대본에만 강제 — chapterOrderIssues). */
export const CHAPTER_ORDER: ChapterId[] = ['intro', 'scaffold', 'maesil', 'jadu', 'gam', 'blueberry', 'outro'];

/** 시범 장 수종 — 장에 species 가 없을 때의 폴백. 수종 장은 그 수종(별칭 포함) 영상만, 일반 장은 과실나무 아무거나. */
export const CHAPTER_SPECIES: Record<string, string[] | 'any-fruit'> = {
  intro: 'any-fruit',
  scaffold: 'any-fruit',
  maesil: ['매실나무', '설중매', '설중매나무'],
  jadu: ['자두나무'],
  gam: ['감나무'],
  blueberry: ['블루베리', '블루베리나무'],
  outro: 'any-fruit',
};

export const FRUIT_SPECIES: string[] = [
  '감나무', '대추나무', '사과나무', '미니사과나무', '석류나무', '배나무', '호두나무', '매실나무', '설중매', '설중매나무',
  '모과나무', '체리나무', '앵두나무', '보리수나무', '왕보리수나무', '왕보리수', '살구나무', '밤나무', '무화과', '자두나무',
  '블루베리', '블루베리나무', '머루나무', '으름나무', '오디나무', '금귤나무', '구지뽕나무',
];

/** 시범(겨울 전정 편) 금지어 — 원문(9월 기준 글)에 있어도 겨울 편에서는 쓰지 않는다(설계 반목표). 새 편 기본값은 없음. */
export const PILOT_BANNED_WORDS = ['9월', '구월'];

export type Card = LfCard;

/** footage: 이 문장이 특정 수종을 말할 때 화면에 쓸 수종(보관소 species 값). */
export interface Segment {
  id: string; narration: string; card?: Card; mg?: Mg; footage?: string[];
  /**
   * 문장 그림(모션그래픽) 장면 모듈 키(2026-10-22 확장점) — 장면 단계(buildScenes)가 채운다. 없으면 도해 없이
   * 실촬영+자막(시범처럼 mg 가 있으면 mg)으로 그린다.
   */
  scene?: string;
  /** 낭독 전용 표기(발음 교정) — 자막은 narration 그대로. */
  tts?: string;
  accent?: Accent; teaser?: string; topTitle?: string;
}
export interface Chapter {
  id: ChapterId; title: string; segments: Segment[];
  /**
   * 수종 장의 보관소 수종 이름(별칭 포함) — 이 장 화면에는 이 수종 영상만. 빈 배열 = 일반 장(편 수종 아무거나).
   * 없으면(시범) CHAPTER_SPECIES 폴백.
   */
  species?: string[];
  /** 유튜브 챕터 이름 직접 지정(2026-10-20) — 없으면 youtubeMeta 가 수종·장 제목으로 만든다. */
  ytLabel?: string;
}
export interface LongformScript {
  title: string; chapters: Chapter[];
  /** 유튜브 설명 첫 줄(핵심 내용+주 키워드) — 없으면 제목. */
  ytKeyLine?: string;
  /** 유튜브 설명 해시태그(# 없이도 됨). */
  ytHashtags?: string[];
  /** 일반 장 화면에 쓸 수종(편 전체) — 없으면 장 수종 합집합, 그것도 없으면(시범) FRUIT_SPECIES. */
  species?: string[];
  /**
   * 편 주인공 수종(2026-10-23 사장님 결정) — 있으면 일반 장(도입·마무리 등 수종 없는 장)의 화면은 이 수종 영상만(다른 수종 금지).
   * produce() 가 주제 기준 글 수종(재고 있을 때)으로 채운다. 시범·견본에는 없다(종전 그대로).
   */
  heroSpecies?: string;
  /** 자막 강조어(키워드 팝) — 없으면 시범 전정 용어 목록. */
  keywords?: string[];
  /** 이 편에서 쓰지 않는 말(낭독·화면 글자 모두) — 없으면 없음. 시범은 PILOT_BANNED_WORDS. */
  bannedWords?: string[];
  /** 원문 글 id(낭독 근거) — 없으면(시범) source.ts SOURCE_PIECES. */
  sourcePieceIds?: string[];
}

/** 장 화면 영상 후보(순수) — own=수종 장(자기 수종 영상만, 먼저 배정), species=null 이면 보관소 아무 영상. */
export interface ChapterPool { species: string[] | null; own: boolean }

export function chapterPools(s: Pick<LongformScript, 'chapters' | 'species' | 'heroSpecies'>): Record<string, ChapterPool> {
  // 주인공 수종이 있으면 일반 장은 그 수종만 — 감나무 편 마무리에 다른 수종(초록 열매) 영상이 들어간 첫 편 교훈(10-22).
  const episode = s.heroSpecies ? [s.heroSpecies] : [...new Set([...(s.species ?? []), ...s.chapters.flatMap((c) => c.species ?? [])])];
  const out: Record<string, ChapterPool> = {};
  for (const c of s.chapters) {
    if (c.species?.length) { out[c.id] = { species: c.species, own: true }; continue; }
    const pilot = c.species === undefined ? CHAPTER_SPECIES[c.id] : undefined;
    if (Array.isArray(pilot)) { out[c.id] = { species: pilot, own: true }; continue; }
    // 일반 장 — 편 수종 아무거나. 시범(장 수종이 데이터에 없음)은 과실나무 목록.
    out[c.id] = { species: episode.length ? episode : pilot === 'any-fruit' ? FRUIT_SPECIES : null, own: false };
  }
  return out;
}

/** 수종 이름 비교용(순수) — 공백·끝 '나무' 를 뗀다('블루베리나무' = '블루베리'). */
export const speciesNorm = (s: string): string => s.replace(/\s/g, '').replace(/나무$/, '');

/**
 * 편 주인공 수종 고르기(순수) — 주제 기준 글 수종이 실촬영 재고에 있으면 그것(재고 표기로), 아니면 장 수종 중 세그먼트가 가장 많은 것
 * (같으면 앞 장), 그것도 없으면 편 수종 첫째. 없으면 undefined(일반 장은 종전처럼 편 수종).
 */
export function pickHeroSpecies(anchorSpecies: string | undefined, s: Pick<LongformScript, 'chapters' | 'species'>, inventory: Record<string, number>): string | undefined {
  if (anchorSpecies) {
    const inv = Object.keys(inventory).find((k) => (inventory[k] ?? 0) > 0 && speciesNorm(k) === speciesNorm(anchorSpecies));
    if (inv) return inv;
  }
  const count = new Map<string, number>();
  for (const c of s.chapters) for (const sp of c.species ?? []) count.set(sp, (count.get(sp) ?? 0) + c.segments.length);
  let best: string | undefined;
  for (const [sp, n] of count) if (!best || n > count.get(best)!) best = sp;
  return best ?? s.species?.[0];
}

const SEGMENT_MAX = 90;
const NOT_A_BUT_B_MAX = 3;
const NOT_A_BUT_B = /[가-힣](?:가|이) 아니라/g;

export function scriptChars(s: LongformScript): number {
  return s.chapters.flatMap((c) => c.segments).reduce((n, g) => n + g.narration.replace(/\s/g, '').length, 0);
}

export function cardText(c: Card): string {
  switch (c.kind) {
    case 'list': return [c.header ?? '', ...c.items].join(' ');
    case 'compare': return [c.left.label, ...c.left.items, c.right.label, ...c.right.items].join(' ');
    case 'stat': return `${c.value}${c.unit ?? ''} ${c.label ?? ''}`;
    case 'takeaway': return c.lines.join(' ');
    case 'quote': return c.text;
    case 'chart': return [c.header ?? '', ...c.series.map((x) => `${x.label} ${x.value}${c.unit ?? ''}`)].join(' ');
  }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 장 순서 일관성(순수). 시범 모양 대본(장에 species 필드가 없고 id 가 전부 CHAPTER_ORDER 안)은 시범 순서 그대로여야 한다.
 * 모든 대본: 장 id 중복 없음·빈 장 없음·세그먼트 id 는 `${장 id}-` 로 시작하고 중복 없음(장이 섞이면 영상 배정·챕터가 어긋난다).
 */
export function chapterOrderIssues(s: LongformScript): string[] {
  const out: string[] = [];
  const order = s.chapters.map((c) => c.id);
  const pilotShaped = s.chapters.every((c) => c.species === undefined) && order.every((id) => CHAPTER_ORDER.includes(id));
  if (pilotShaped && order.join() !== CHAPTER_ORDER.join()) out.push(`장 순서가 다름: ${order.join(' → ')}`);
  if (!s.chapters.length) out.push('장이 없음');
  const dupCh = order.filter((id, i) => order.indexOf(id) !== i);
  if (dupCh.length) out.push(`장 id 중복: ${[...new Set(dupCh)].join(', ')}`);
  const seen = new Set<string>();
  for (const c of s.chapters) {
    if (!c.segments.length) out.push(`${c.id}: 세그먼트 없는 장`);
    for (const g of c.segments) {
      if (!g.id.startsWith(`${c.id}-`)) out.push(`${g.id}: 장 '${c.id}' 세그먼트 id 가 장 id 로 시작하지 않음 — 장 순서가 섞임`);
      if (seen.has(g.id)) out.push(`${g.id}: 세그먼트 id 중복`);
      seen.add(g.id);
    }
  }
  return out;
}

/** 문제 목록(빈 배열 = 통과). */
export function validateScript(s: LongformScript, sourceText: string): string[] {
  const out: string[] = [...chapterOrderIssues(s)];
  const segs = s.chapters.flatMap((c) => c.segments);
  // 편별 금지어 — 시범은 원문(9월 기준 글)에 있어도 겨울 편에서 쓰지 않는 '9월'(설계 반목표). 새 편 기본값은 없음.
  const banned = (s.bannedWords ?? []).map((w) => w.trim()).filter(Boolean);
  const bannedRe = banned.length ? new RegExp(banned.map(escapeRe).join('|')) : null;
  for (const g of segs) {
    if (g.narration.length > SEGMENT_MAX) out.push(`${g.id}: ${g.narration.length}자 — ${SEGMENT_MAX}자 넘음`);
    const hit = bannedRe ? g.narration.match(bannedRe) : null;
    if (hit) out.push(`${g.id}: 금지어 '${hit[0]}' — 이 편에서 쓰지 않는 말`);
  }
  // 화면 글자(장 제목·카드·도해 문구)도 같은 시기·수치 규칙을 받는다(리뷰 I5).
  const screen = [
    ...s.chapters.map((c) => ({ field: `${c.id}:제목`, text: c.title })),
    ...segs.flatMap((g) => [
      ...(g.card ? [{ field: `${g.id}:카드`, text: cardText(g.card) }] : []),
      ...(g.mg?.kind === 'timeline' ? [{ field: `${g.id}:도해`, text: `${g.mg.start} ${g.mg.end}` }] : []),
      ...(g.teaser ? [{ field: `${g.id}:예고`, text: g.teaser }] : []),
      ...(g.topTitle ? [{ field: `${g.id}:제목`, text: g.topTitle }] : []),
    ]),
  ];
  for (const f of screen) {
    const hit = bannedRe ? f.text.match(bannedRe) : null;
    if (hit) out.push(`${f.field}: 금지어 '${hit[0]}' 문구 — 이 편에서 쓰지 않는 말`);
  }
  for (const i of timingParityIssues(sourceText, [...segs.map((g) => ({ field: g.id, text: g.narration })), ...screen])) {
    out.push(`${i.field}: 원문에 없는 시기·수치 ${i.token}`);
  }
  const notAButB = segs.reduce((n, g) => n + (g.narration.match(NOT_A_BUT_B)?.length ?? 0), 0);
  if (notAButB > NOT_A_BUT_B_MAX) out.push(`'A가 아니라 B' ${notAButB}회 — ${NOT_A_BUT_B_MAX}회 이하로`);
  return out;
}
