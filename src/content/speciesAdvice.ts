/**
 * 수종 특성 조언(2026-11-03 사장님 "수종별로 주제가 비슷하더라도 수종 특성에 맞는 내용이 있어야").
 *
 * 실측: 블로그 16편(전정·활착·월동·삽목 묶음)의 실천 조언 206개 중 수종 특성에서 나온 것은 57개(28%).
 * 활착 4편(호두·밤·대추)은 "가지 구부리기 → 긁어 초록 → 눈 눌러 보기 → 줄기 흔들기 → 물 빠짐" 같은 뼈대였고,
 * 수종 이야기는 주제와 상관없이 같은 도감 문장(호두 3편 "10~15m·간격 8~10m", 감 3편 "원산 중국 남부·6~14m")이었다.
 * 공급 사실에 있던 "대추나무는 새싹이 아주 늦게 튼다"는 대추 활착 글에 쓰이지 않았다.
 *
 * 세 가지를 한다 — ① 같은 수종 최근 글에 이미 쓴 도감 사실은 작가에게 다시 주지 않는다(주제 고유 사실은 예외)
 * ② 작가 필수 지침: 조언 2개 이상은 그 수종 특성에서 ③ 초안 검사: 수종 이름을 다른 나무로 바꿔도 맞는 조언만 있으면 수정 1회.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { pieceStore } from './pieces';

const compact = (s: string): string => (s ?? '').normalize('NFC').replace(/\s+/g, '');
const bigrams = (s: string): Set<string> => {
  const t = (s ?? '').normalize('NFC').replace(/[\s.,·!?~()「」"'“”‘’:;/\-*#>|]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};

/** 이름이 글자 경계에서 시작하는가(순수) — "겹벚나무"의 "벚나무", "백목련"의 "목련"은 다른 수종이다. */
export function namedAt(text: string, name: string): boolean {
  const t = (text ?? '').normalize('NFC'); const n = compact(name); // 글은 띄어쓰기를 남겨야 앞 글자 경계를 본다
  if (!n) return false;
  for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) {
    if (i === 0 || !/[가-힣]/.test(t[i - 1]!)) return true;
  }
  return false;
}

/** 같은 수종 최근 글 본문(draft.md) — 같은 브랜드·최근 days 일·최신 max 편. 이번 런은 뺀다. 별칭으로도 맞춘다. */
export function recentSpeciesBodies(species: string, opts: { aliases?: readonly string[]; brand?: string; excludeRunId?: string; days?: number; max?: number; now?: number } = {}): string[] {
  const days = opts.days ?? 60; const max = opts.max ?? 8; const now = opts.now ?? Date.now();
  const names = [species, ...(opts.aliases ?? [])].filter((n) => compact(n).length >= 2);
  if (!names.length) return [];
  const out: string[] = [];
  const list = pieceStore().list().slice().reverse();
  for (const p of list) {
    if (out.length >= max) break;
    if (!p.runId || p.runId === opts.excludeRunId) continue;
    if (opts.brand && p.brand && p.brand !== opts.brand) continue;
    if (now - Date.parse(p.createdTs) > days * 86_400_000) continue;
    const hay = `${p.title ?? ''} ${p.keyword ?? ''}`;
    if (!names.some((n) => namedAt(hay, n))) continue;
    try { out.push(fs.readFileSync(path.join(CONFIG.sessionsDir, p.runId, 'draft.md'), 'utf-8')); } catch { /* 본문 없는 런 */ }
  }
  return out;
}

/** 사실 중 최근 글 어느 문장에 이미 담긴 것(순수) — 사실 바이그램의 min(0.6) 이상이 한 문장에 들어 있으면 쓴 것으로 본다. */
export function factsUsedIn(facts: readonly string[], bodies: readonly string[], threshold = 0.6, names: readonly string[] = []): Set<string> {
  // 수종 이름 바이그램은 분모·적중을 함께 부풀린다(짧은 사실이 쉽게 '이미 씀'이 된다) — 이름은 지우고 견준다.
  const ordered = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  const strip = (t: string): string => ordered.reduce((acc, n) => acc.split(n).join(' '), t);
  const origFacts = facts;
  bodies = bodies.map(strip); facts = facts.map((x) => strip(x).trim() || x);
  const sents = bodies.flatMap((b) => b.split('\n')).filter((l) => !/^\s*(\[IMAGE|<!--|\|)/.test(l))
    .flatMap((l) => l.split(/(?<=[.?!])\s+/)).map((x) => bigrams(x)).filter((x) => x.size >= 4);
  const used = new Set<string>();
  facts.forEach((f, k) => {
    const fb = bigrams(f);
    if (fb.size < 4) return;
    for (const s of sents) {
      let hit = 0; for (const x of fb) if (s.has(x)) hit++;
      if (hit / fb.size >= threshold) { used.add(origFacts[k]!); break; }
    }
  });
  return used;
}

/** 작가 필수 지침 한 줄(순수). */
export function speciesAdviceGuide(species: string, angle?: string): string {
  return [
    `수종 특성 조언 — 이 글의 실천 조언 중 30% 이상(최소 2개)은 ${species}만의 특성에서 나와야 한다: 근거 사실([이 주제]·[재배] 줄)에 있는 ${species}의 성질을 이유로 대고,`,
    `그래서 다른 나무와 무엇을 다르게 하는지(시기·방법·판단 기준)를 써라${angle ? ` — 주제 "${angle}"에서 ${species}가 다른 점` : ''}.`,
    '수종 이름만 바꾸면 어느 나무에나 맞는 일반론(줄기 흔들어 보기·밑동 멀칭·잎 진 뒤 전정 등)은 줄이고, 쓸 때는 그 수종에서 달라지는 점을 붙여라.',
    '키·원산지·분류·학명·껍질 색 같은 도감 소개는 조언의 이유로 쓸 때만 넣는다. 근거 사실에 없는 수종 특성을 아는 대로 지어내지 마라.',
  ].join(' ');
}

export interface SpeciesAdviceItem { text: string; specific: boolean; trait?: string }
export interface SpeciesAdviceCheck { items: SpeciesAdviceItem[]; specific: number; generic: number }

/** 검사 프롬프트(순수). */
export function speciesAdvicePrompt(body: string, species: string): string {
  return [
    `[블로그 본문 — ${species} 글]`,
    body.slice(0, 9000),
    '',
    '본문에서 독자에게 하라고 하는 실천 조언·판단 기준을 최대 15개 뽑아라(설명·소개 문장은 빼고).',
    `각 조언에 specific 을 판정하라: 본문의 "${species}"를 사과나무·소나무·단풍나무 같은 다른 나무로 바꿨을 때 그 조언이 틀리거나 달라져야 하면 true(${species}의 성질 때문에 다르게 하는 조언),`,
    '바꿔도 그대로 맞으면 false(어느 나무에나 맞는 일반론). 수종 이름이 문장에 들어 있어도 내용이 일반론이면 false.',
    'specific 이 true 면 trait 에 그 조언이 기대는 수종 성질을 짧게 적어라.',
    'JSON 형식: {"items":[{"text":"조언 요약 30자","specific":true,"trait":"..."}]}',
  ].join('\n');
}

/** 검사 응답 정리(순수). */
export function parseSpeciesAdvice(raw: unknown): SpeciesAdviceCheck | null {
  const list = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return null;
  const items = list.slice(0, 20).flatMap((x): SpeciesAdviceItem[] => {
    const o = (x ?? {}) as Record<string, unknown>;
    const text = String(o.text ?? '').trim().slice(0, 80);
    if (!text) return [];
    const trait = String(o.trait ?? '').trim().slice(0, 60);
    return [{ text, specific: o.specific === true, ...(o.specific === true && trait ? { trait } : {}) }];
  });
  if (!items.length) return null;
  const specific = items.filter((i) => i.specific).length;
  return { items, specific, generic: items.length - specific };
}

/** 수종 고유 조언 기준(순수) — 2개 이상이면서 조언 수의 30% 이상. */
export function speciesAdviceNeed(items: number): number { return Math.max(2, Math.ceil(items * 0.3)); }

/** 수정 라운드 피드백(순수) — 일반론 조언 목록 + 쓸 수 있는 수종 사실. */
export function speciesAdviceFeedback(species: string, check: SpeciesAdviceCheck, factLines: readonly string[], need = 2): string {
  const generic = check.items.filter((i) => !i.specific).slice(0, 8);
  return [
    `[수종 특성 조언] 이 글의 조언 ${check.items.length}개 중 ${species} 특성에서 나온 것이 ${check.specific}개뿐이다(기준 ${need}개). 나머지는 수종 이름만 바꿔도 맞는 일반론이다.`,
    generic.length ? `일반론 조언:\n${generic.map((g) => `- ${g.text}`).join('\n')}` : '',
    factLines.length ? `쓸 수 있는 ${species} 사실(이 안에서만):\n${factLines.slice(0, 10).join('\n')}` : '',
    `위 사실 중 이 글 주제와 이어지는 것을 골라, 일반론 조언 몇 개를 "${species}는 ~라서 ~하게 한다"로 바꾸거나 새 조언으로 더하라.`,
    '사실 목록에 없는 수종 특성은 지어내지 마라. 맞는 사실이 없으면 억지로 넣지 말고 그대로 둔다. 소제목·구조·분량·다른 사실·수치는 그대로.',
  ].filter(Boolean).join('\n');
}
