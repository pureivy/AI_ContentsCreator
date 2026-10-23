/**
 * 롱폼 대본 작가(2026-10-22) — 원문 글 묶음 → LongformScript JSON. 무거운 모델 한 번(+분량·검사 문제가 있으면 다시 묻기 최대 2번).
 * 사실 확인(factGateBlog strict) 뒤 근거 없는 문장은 한 번 고쳐 쓰고(LLM), 그래도 남으면 뺀다 — reviseUnsupported.
 * 낭독 발음이 끝내 안 맞는 문장은 뜻을 지키며 바꿔 쓴다 — rewordForPronunciation(assets.ts 의 reword 로 꽂힌다).
 *
 * 시범(2026-10-19) 실측에서 온 숫자: 낭독 6.05자/초(공백 제외, 속도 1.2) → 10분 ≈ 3,350자, 세그먼트 ~95개.
 * 영상이 0초인 수종은 장을 만들 수 없다(시범에서 배롱나무를 뺀 이유) — 작가에게 실촬영 재고표를 주고, 코드가 한 번 더 거른다.
 * 프롬프트의 예시 칸은 자리표시만 둔다(구체 예문은 모델이 그대로 베낀다 — org.ts NO_FABRICATED_EXPERIENCE 2026-10-05 리뷰).
 */
import { CONFIG } from '../config';
import { microJSON } from '../orchestrator/agent';
import { NO_FABRICATED_EXPERIENCE, SELLER_INQUIRY_BAN } from '../orchestrator/org';
import { brandContext, getBrand, lexiconGuide, mediaRulesGuide } from '../content/brand';
import type { FactGateResult } from '../content/factGate';
import { stripEmoji } from '../output/render';
import { scriptChars, validateScript, type Chapter, type LongformScript, type Segment } from './script';
import type { SourcePiece } from './source';

export const TARGET_CHARS = 3350;
export const CHARS_MIN = 3000;
export const CHARS_MAX = 3700;
const SEGMENT_MAX = 90;
const TITLE_MAX = 40;
const CHAPTER_TITLE_MAX = 20;
const WRITER_RETRIES = 2;

/** 분량 기준(2026-10-23 롱폼 주제 v2 짧은 편) — 목표 분 → 낭독 글자·장 수·세그먼트 수. 10분 이상이면 종전 상수 그대로. */
export interface LengthSpec { minutes: number; target: number; min: number; max: number; chMin: number; chMax: number; segments: number }
export function lengthSpec(minutes = 10): LengthSpec {
  if (!(minutes < 10)) return { minutes: 10, target: TARGET_CHARS, min: CHARS_MIN, max: CHARS_MAX, chMin: 6, chMax: 8, segments: 95 };
  const k = Math.max(3, minutes) / 10;
  const r50 = (n: number) => Math.round((n * k) / 50) * 50;
  return { minutes: Math.max(3, minutes), target: r50(TARGET_CHARS), min: r50(CHARS_MIN), max: r50(CHARS_MAX), chMin: 4, chMax: 6, segments: Math.round(95 * k) };
}

export type LlmJSON = <T>(model: string, system: string, user: string, opts: { maxOutputTokens?: number; signal?: AbortSignal }) => Promise<T | null>;
export const defaultLlmJSON: LlmJSON = (model, system, user, opts) => microJSON(model, system, user, opts);

/** 작가·고쳐 쓰기 공용 지침(브랜드·지어낸 경험·판매처 문의·어휘·파생 문체) — 숏폼 작가가 받는 것과 같은 묶음. */
export function sharedGuidance(): string {
  const b = getBrand();
  return [brandContext(), NO_FABRICATED_EXPERIENCE, SELLER_INQUIRY_BAN, lexiconGuide(b?.avoidJargon, b?.keepTerms), mediaRulesGuide()].filter(Boolean).join('\n\n');
}

interface RawSeg { narration?: unknown; footage?: unknown }
interface RawChapter { id?: unknown; title?: unknown; ytLabel?: unknown; species?: unknown; segments?: unknown }
export interface RawScript { title?: unknown; ytKeyLine?: unknown; ytHashtags?: unknown; keywords?: unknown; species?: unknown; chapters?: unknown }

const str = (v: unknown): string => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
/** 낭독 위생 — 이모지·괄호(TTS 가 읽어 버린다) 제거. */
const cleanNarration = (v: unknown): string => stripEmoji(str(v)).replace(/[()（）[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim();
const clipTitle = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max).replace(/[\s,·—-]+\S*$/, '').trim() || s.slice(0, max));

/**
 * LLM 출력 → 대본(순수). 장 id 는 영문 소문자로 고치고 세그먼트 id 는 `${장}-NN` 으로 다시 매긴다(장 순서 검사가 기대하는 꼴).
 * 수종은 실촬영 재고(inventory)에 있는 이름만 남긴다 — 재고에 없는 수종 장은 일반 장으로 내린다(빈 화면 방지).
 */
export function normalizeScript(raw: RawScript | null, ctx: { inventory: Record<string, number>; sourcePieceIds: string[]; sourceText: string }): LongformScript {
  const has = (sp: string) => (ctx.inventory[sp] ?? 0) > 0;
  const seen = new Set<string>();
  const chapters: Chapter[] = [];
  const rawChapters = Array.isArray(raw?.chapters) ? raw!.chapters as RawChapter[] : [];
  rawChapters.forEach((c, ci) => {
    let id = str(c?.id).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || `ch${ci + 1}`;
    while (seen.has(id)) id = `${id}${ci + 1}`;
    seen.add(id);
    const segs = (Array.isArray(c?.segments) ? c!.segments as RawSeg[] : [])
      .map((g) => ({ narration: cleanNarration(g?.narration), footage: strs(g?.footage).filter(has) }))
      .filter((g) => g.narration);
    if (!segs.length) return;
    const ytLabel = str(c?.ytLabel);
    chapters.push({
      id, title: clipTitle(str(c?.title) || `${ci + 1}장`, CHAPTER_TITLE_MAX),
      ...(ytLabel ? { ytLabel } : {}),
      species: strs(c?.species).filter(has),
      segments: segs.map((g, i): Segment => ({ id: `${id}-${String(i + 1).padStart(2, '0')}`, narration: g.narration, ...(g.footage.length ? { footage: g.footage } : {}) })),
    });
  });
  const chapterSpecies = chapters.flatMap((c) => c.species ?? []);
  // 일반 장 화면 수종 — 작가가 고른 편 수종(재고 안), 없으면 장 수종, 그것도 없으면 원문이 말하는 재고 수종.
  let species = [...new Set([...strs(raw?.species).filter(has), ...chapterSpecies])];
  if (!species.length) species = Object.keys(ctx.inventory).filter((sp) => has(sp) && ctx.sourceText.includes(sp.replace(/나무$/, '')));
  const title = clipTitle(str(raw?.title), TITLE_MAX);
  return {
    title: title || '롱폼',
    chapters,
    ...(str(raw?.ytKeyLine) ? { ytKeyLine: str(raw?.ytKeyLine) } : {}),
    ytHashtags: strs(raw?.ytHashtags).map((h) => h.replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean).slice(0, 5),
    keywords: [...new Set(strs(raw?.keywords))].filter((k) => k.length >= 2 && k.length <= 12).slice(0, 20),
    species,
    bannedWords: [],
    sourcePieceIds: ctx.sourcePieceIds,
  };
}

/** 분량·검사 문제(순수) — 다시 묻기 사유. 빈 배열 = 통과. */
export function scriptProblems(s: LongformScript, sourceText: string, len: LengthSpec = lengthSpec()): string[] {
  const out: string[] = [];
  const chars = scriptChars(s);
  if (chars < len.min || chars > len.max) out.push(`낭독 ${chars}자(공백 제외) — ${len.min.toLocaleString()}~${len.max.toLocaleString()}자(목표 ${len.target.toLocaleString()}자)로`);
  if (s.chapters.length < len.chMin || s.chapters.length > len.chMax) out.push(`장 ${s.chapters.length}개 — ${len.chMin}~${len.chMax}개로`);
  if (!s.title || s.title === '롱폼') out.push('제목 없음');
  return [...out, ...validateScript(s, sourceText)];
}

function writerPrompt(o: { topicLabel: string; anchorTitle: string; theme?: string; sources: SourcePiece[]; inventory: Record<string, number>; month: number }, len: LengthSpec = lengthSpec()): { system: string; user: string } {
  const inv = Object.entries(o.inventory).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([sp, s]) => `- ${sp}: ${Math.round(s)}초`).join('\n');
  const system = [
    `너는 나무 정원 채널의 ${len.minutes}분짜리 가로 유튜브 영상 대본 작가다. 블로그 글 여러 편을 한 편의 다큐 내레이션으로 엮는다.`,
    sharedGuidance(),
  ].join('\n\n');
  const user = `[이번 편]
주제: ${o.topicLabel} — 중심 글 '${o.anchorTitle}'. 아래 원문 글들을 한 이야기로 엮어라. 지금은 ${o.month}월이다(계절에 맞는 말투).${o.theme ? `
이 편이 답할 시청자 질문(묶음 주제): '${o.theme}' — 모든 장이 이 질문 하나를 따라가게 엮고, 질문에 답하지 않는 원문 내용은 빼라.` : ''}

[원문 글 — 사실은 여기서만]
${o.sources.map((s, i) => `### 글 ${i + 1}: ${s.title}\n${s.body.slice(0, 7000)}`).join('\n\n')}

[실촬영 재고 — 수종별 쓸 수 있는 영상 초]
${inv || '(없음)'}

[대본 규칙]
1. 낭독 합계 공백 제외 약 ${len.target.toLocaleString()}자(${len.min.toLocaleString()}~${len.max.toLocaleString()}자) — 낭독 6자/초라 ${len.minutes}분이 된다. 세그먼트(문장) 약 ${len.segments}개.
2. 세그먼트 하나 = 한 문장, 공백 포함 ${SEGMENT_MAX}자 이하. 다큐 내레이션 존댓말(~습니다·~요). 화면 자막으로도 그대로 나간다.
3. 사실·수치·월·시기는 원문 글에 있는 것만. 원문에 없는 월·날짜·숫자를 새로 만들지 마라. 원문 문장을 줄여 쓰고, 새 문장은 장 연결·도입·마무리만.
4. 장 ${len.chMin}~${len.chMax}개. 첫 장은 도입(무엇을 왜 보는지), 마지막 장은 정리. 장 id 는 영문 소문자(예: intro, outro, 수종 영문 이름). 장 title 은 화면 제목 ${CHAPTER_TITLE_MAX}자 이하, ytLabel 은 유튜브 챕터용 검색어 꼴 이름.
5. 수종 장(한 수종만 다루는 장)은 species 에 재고표의 수종 이름을 그대로 적는다. 재고표에 없는 수종은 수종 장을 만들지 마라(화면에 그 수종 영상이 없다). 여러 수종을 아우르는 일반 장은 species 를 빈 배열로.
6. 문장이 특정 수종을 말하면 footage 에 그 수종(재고표 이름)을 적는다. 아니면 생략.
7. "A가 아니라 B" 꼴은 대본 전체 3번 이하.
8. title: 검색에 걸리는 유튜브 제목 ${TITLE_MAX}자 이하(수종·작업 낱말을 앞쪽에). ytKeyLine: 설명 첫 줄 1~2문장(핵심 내용+주 키워드). ytHashtags: 5개(# 없이). keywords: 자막에서 색으로 띄울 핵심 용어 8~20개(원문에 나온 말). species: 일반 장 화면에 쓸 편 수종(재고표 이름).

[출력 JSON 꼴 — 값은 자리표시]
{"title":"…","ytKeyLine":"…","ytHashtags":["…"],"keywords":["…"],"species":["…"],"chapters":[{"id":"intro","title":"…","ytLabel":"…","species":[],"segments":[{"narration":"…"},{"narration":"…","footage":["…"]}]}]}`;
  return { system, user };
}

export interface WriteResult { script: LongformScript; attempts: number; problems: string[] }

/** 대본 쓰기 — 분량(3,000~3,700자, targetMinutes 면 lengthSpec)·장 수·검사 문제가 있으면 문제를 짚어 다시 묻는다(최대 2번). 가장 문제가 적은 판을 돌려준다. */
export async function writeScript(o: {
  topicLabel: string; anchorTitle: string; theme?: string; sources: SourcePiece[]; inventory: Record<string, number>; month: number;
  /** 목표 길이(분) — 없으면 10분(주제 v2 짧은 편이면 6). */
  targetMinutes?: number;
  llmJSON?: LlmJSON; model?: string; signal?: AbortSignal; log?: (m: string) => void;
}): Promise<WriteResult> {
  const llm = o.llmJSON ?? defaultLlmJSON;
  const model = o.model ?? CONFIG.cloudTierModels.heavy;
  const log = o.log ?? (() => {});
  const sourceText = o.sources.map((s) => s.body).join('\n\n');
  const ctx = { inventory: o.inventory, sourcePieceIds: o.sources.map((s) => s.pieceId), sourceText };
  const len = lengthSpec(o.targetMinutes);
  const { system, user } = writerPrompt(o, len);
  let best: WriteResult | null = null;
  let ask = user;
  for (let attempt = 1; attempt <= 1 + WRITER_RETRIES; attempt++) {
    if (o.signal?.aborted) throw new Error('취소됨');
    const raw = await llm<RawScript>(model, system, ask, { maxOutputTokens: 16000, signal: o.signal });
    const script = normalizeScript(raw, ctx);
    const problems = script.chapters.length ? scriptProblems(script, sourceText, len) : ['대본 JSON 없음'];
    log(`[대본] ${attempt}차 — 장 ${script.chapters.length} · 세그먼트 ${script.chapters.flatMap((c) => c.segments).length} · ${scriptChars(script)}자 · 문제 ${problems.length}`);
    if (script.chapters.length && (!best || problems.length < best.problems.length)) best = { script, attempts: attempt, problems };
    if (!problems.length) break;
    ask = `${user}\n\n[지난 판의 문제 — 고쳐서 대본 전체를 다시 써라]\n${problems.slice(0, 20).map((p) => `- ${p}`).join('\n')}`
      + (script.chapters.length ? `\n\n[지난 판]\n${JSON.stringify({ title: script.title, chapters: script.chapters.map((c) => ({ id: c.id, title: c.title, segments: c.segments.map((g) => g.narration) })) })}` : '');
  }
  if (!best) throw new Error('대본 작성 실패(LLM 무응답)');
  return best;
}

/** 근거 없는 주장 → 그 주장이 나온 세그먼트(순수) — 글자 두 개 묶음 겹침이 가장 큰 문장(0.35 이상). */
export function segmentsForClaims(s: LongformScript, claims: readonly string[]): Map<string, string[]> {
  const grams = (t: string) => { const x = t.replace(/[^가-힣0-9a-zA-Z]/g, ''); const g = new Set<string>(); for (let i = 0; i < x.length - 1; i++) g.add(x.slice(i, i + 2)); return g; };
  const segs = s.chapters.flatMap((c) => c.segments).map((g) => ({ id: g.id, grams: grams(g.narration) }));
  const out = new Map<string, string[]>();
  for (const claim of claims) {
    const cg = grams(claim);
    if (!cg.size) continue;
    let best: { id: string; score: number } | null = null;
    for (const g of segs) {
      let hit = 0;
      for (const x of cg) if (g.grams.has(x)) hit++;
      const score = hit / cg.size;
      if (!best || score > best.score) best = { id: g.id, score };
    }
    if (best && best.score >= 0.35) out.set(best.id, [...(out.get(best.id) ?? []), claim]);
  }
  return out;
}

/** 검사 문제 줄에서 세그먼트 id(순수) — validateScript 줄은 '<segId>: …' 꼴. */
export function segmentsForIssues(s: LongformScript, issues: readonly string[]): Map<string, string[]> {
  const ids = new Set(s.chapters.flatMap((c) => c.segments.map((g) => g.id)));
  const out = new Map<string, string[]>();
  for (const i of issues) {
    const id = i.split(':')[0]!.trim();
    if (ids.has(id)) out.set(id, [...(out.get(id) ?? []), i]);
  }
  return out;
}

/** 세그먼트 고치기·빼기 적용(순수) — 빈 문자열이면 뺀다. 빈 장은 장째 뺀다. 세그먼트 id 는 그대로(캐시·로그 추적). */
export function applyRevisions(s: LongformScript, rev: ReadonlyMap<string, string>): LongformScript {
  return {
    ...s,
    chapters: s.chapters
      .map((c) => ({ ...c, segments: c.segments.flatMap((g) => (rev.has(g.id) ? (rev.get(g.id) ? [{ ...g, narration: rev.get(g.id)! }] : []) : [g])) }))
      .filter((c) => c.segments.length),
  };
}

/** 근거 없는 문장 고쳐 쓰기(LLM 한 번) — 원문 근거로 고치거나, 근거가 없으면 빼라(빈 문자열). id → 새 문장. */
export async function reviseUnsupported(o: {
  script: LongformScript; flagged: Map<string, string[]>; sourceText: string; llmJSON?: LlmJSON; model?: string; signal?: AbortSignal;
}): Promise<Map<string, string>> {
  const llm = o.llmJSON ?? defaultLlmJSON;
  const segs = o.script.chapters.flatMap((c) => c.segments);
  const items = [...o.flagged.entries()].map(([id, why]) => ({ id, narration: segs.find((g) => g.id === id)?.narration ?? '', why }));
  if (!items.length) return new Map();
  const raw = await llm<{ revisions?: Array<{ id?: unknown; narration?: unknown }> }>(
    o.model ?? CONFIG.cloudTierModels.standard,
    ['너는 영상 대본 사실 검수자다. 원문 근거가 없는 문장을 원문에 맞게 고치거나 뺀다.', sharedGuidance()].join('\n\n'),
    `[원문 — 근거는 여기서만]\n${o.sourceText.slice(0, 40000)}\n\n[문제 문장]\n${items.map((x) => `- ${x.id}: "${x.narration}" — ${x.why.join(' / ')}`).join('\n')}\n\n`
      + `규칙: 문장마다 원문에 있는 사실로만 고쳐라(공백 포함 ${SEGMENT_MAX}자 이하, 앞뒤 문장과 이어지게, 존댓말). 원문에 근거가 전혀 없으면 narration 을 빈 문자열로(뺀다).\n`
      + '출력: {"revisions":[{"id":"…","narration":"…"}]}',
    { maxOutputTokens: 4000, signal: o.signal },
  );
  const out = new Map<string, string>();
  for (const r of raw?.revisions ?? []) {
    const id = str(r?.id);
    if (!o.flagged.has(id)) continue;
    const n = cleanNarration(r?.narration);
    out.set(id, n.length > SEGMENT_MAX ? '' : n);
  }
  return out;
}

export interface FactRecord {
  first: { status: string; unsupported: string[]; contradicted: string[]; issues: string[] };
  revised: Array<{ id: string; from: string; to: string }>;
  dropped: Array<{ id: string; narration: string }>;
  final: { status: string; unsupported: string[]; contradicted: string[]; issues: string[]; chars: number };
}

type Gate = (a: { model: string; body: string; evidence: string; signal?: AbortSignal; maxClaims?: number; strict?: boolean }) => Promise<FactGateResult>;

/**
 * 사실 확인 — factGateBlog strict + validateScript. 걸린 문장은 한 번 고쳐 쓰고 다시 확인, 그래도 걸리면 뺀다.
 * 판정 실패(error)는 고칠 문장을 모르는 것이라 그대로 기록만 하고 넘어간다(사람 검토가 마지막 관문).
 */
export async function factCheckScript(o: {
  script: LongformScript; sourceText: string; gate: Gate; llmJSON?: LlmJSON; model?: string; signal?: AbortSignal; log?: (m: string) => void;
}): Promise<{ script: LongformScript; record: FactRecord }> {
  const log = o.log ?? (() => {});
  const model = o.model ?? CONFIG.cloudTierModels.standard;
  const run = async (s: LongformScript) => {
    const body = s.chapters.flatMap((c) => c.segments).map((g) => g.narration).join('\n');
    const r = await o.gate({ model, body, evidence: o.sourceText, maxClaims: 80, strict: true, signal: o.signal });
    const issues = validateScript(s, o.sourceText);
    const flagged = segmentsForClaims(s, [...r.unsupported, ...r.contradicted]);
    for (const [id, why] of segmentsForIssues(s, issues)) flagged.set(id, [...(flagged.get(id) ?? []), ...why]);
    return { r, issues, flagged };
  };
  let script = o.script;
  const first = await run(script);
  const record: FactRecord = {
    first: { status: first.r.status, unsupported: first.r.unsupported, contradicted: first.r.contradicted, issues: first.issues },
    revised: [], dropped: [], final: { status: first.r.status, unsupported: first.r.unsupported, contradicted: first.r.contradicted, issues: first.issues, chars: scriptChars(script) },
  };
  log(`[사실] 1차 ${first.r.status} · 근거 없음 ${first.r.unsupported.length} · 모순 ${first.r.contradicted.length} · 검사 문제 ${first.issues.length} → 문장 ${first.flagged.size}`);
  if (!first.flagged.size) return { script, record };
  const segText = (s: LongformScript, id: string) => s.chapters.flatMap((c) => c.segments).find((g) => g.id === id)?.narration ?? '';
  const rev = await reviseUnsupported({ script, flagged: first.flagged, sourceText: o.sourceText, llmJSON: o.llmJSON, model, signal: o.signal });
  for (const id of first.flagged.keys()) {
    const to = rev.get(id) ?? '';
    if (to) record.revised.push({ id, from: segText(script, id), to });
    else record.dropped.push({ id, narration: segText(script, id) });
  }
  script = applyRevisions(script, new Map([...first.flagged.keys()].map((id) => [id, rev.get(id) ?? ''])));
  const second = await run(script);
  // 고쳐도 걸리는 문장은 뺀다 — 한 번만(무한 고리 없음).
  if (second.flagged.size) {
    for (const id of second.flagged.keys()) record.dropped.push({ id, narration: segText(script, id) });
    script = applyRevisions(script, new Map([...second.flagged.keys()].map((id) => [id, ''])));
  }
  const issues = validateScript(script, o.sourceText);
  record.final = { status: second.r.status, unsupported: second.r.unsupported, contradicted: second.r.contradicted, issues, chars: scriptChars(script) };
  log(`[사실] 고침 ${record.revised.length} · 뺌 ${record.dropped.length} · 남은 검사 문제 ${issues.length} · ${record.final.chars}자`);
  return { script, record };
}

/** 발음 바꿔 쓰기(LLM 짧게, 표준 모델) — 음성 인식이 다르게 들은 말을 뜻을 지키며 다른 말로(예: 한자어 → 쉬운 말). 실패면 null. */
export async function rewordForPronunciation(o: {
  narration: string; heard: string; llmJSON?: LlmJSON; model?: string; signal?: AbortSignal;
}): Promise<string | null> {
  const llm = o.llmJSON ?? defaultLlmJSON;
  const raw = await llm<{ narration?: unknown }>(
    o.model ?? CONFIG.cloudTierModels.standard,
    '너는 영상 낭독 문장 다듬는 사람이다. 음성 합성이 잘못 읽는 말을 뜻을 그대로 지키며 다른 말로 바꾼다.',
    `[문장]\n${o.narration}\n\n[음성 인식이 들은 것]\n${o.heard || '(못 들음)'}\n\n`
      + `규칙: 다르게 들린 낱말만 같은 뜻의 다른 말로 바꾸거나 어순을 바꿔라(예: 소리가 같은 다른 말로 들리는 한자어 → 쉬운 우리말, 숫자 읽기 → 아라비아 숫자). `
      + `사실·수치·뜻은 바꾸지 마라. 공백 포함 ${SEGMENT_MAX}자 이하 한 문장, 존댓말.\n출력: {"narration":"…"}`,
    { maxOutputTokens: 400, signal: o.signal },
  ).catch(() => null);
  const n = cleanNarration(raw?.narration);
  return n && n !== o.narration && n.length <= SEGMENT_MAX ? n : null;
}
