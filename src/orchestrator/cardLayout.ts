/**
 * 카드뉴스 HTML 판형(2026-10-12 사장님 채택 — "기존 카드뉴스가 너무 단조로워, 설명도 적고" → 감나무 카드 9장 시범 →
 * "매일 만드는 카드뉴스도 이 방식으로"). gpt-image 가 글자까지 그리던 카드를, 사진 + HTML 판형 8가지로 바꾼다.
 *
 * 흐름: 기획(planCards — 헤드라인·본문은 종전 사실 게이트를 모두 거친다) → 판형 고르기·칸 채우기(이 파일, 원문에서만 뽑음)
 * → 칸 검증(원문 겹침·새 숫자 금지·월 확인, 결정적) → 칸 사실 대조(parity·시기·승계 — 걸린 칸은 버린다) → 사진(블로그 사진 재사용,
 * 모자라면 글자 없는 사진 생성 + 원문 묘사 검수) → 렌더(scripts/blog_skills/card_render.py).
 *
 * 글자는 HTML 이 그리므로 오타 검수(qaSlide)가 필요 없다. 제목·본문(lead)은 기획 문구를 그대로 쓴다 — 칸만 새로 채운다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { introducesNewFacts } from '../content/factGate';
import { parseSceneMust, mustPromptLines, type SceneMust } from './sceneMust';

const execFileP = promisify(execFile);

export type CardKind = 'cover' | 'points' | 'photo' | 'compare' | 'pair' | 'numbers' | 'facts' | 'steps';
export const CARD_KINDS: readonly CardKind[] = ['cover', 'points', 'photo', 'compare', 'pair', 'numbers', 'facts', 'steps'];

/** 사진 자리 — 블로그 사진 n번(1부터) 또는 새로 그릴 장면. 렌더 직전에 파일 경로로 바뀐다. */
export type PhotoRef = { use: 'blog'; n: number } | { use: 'gen'; scene: string; must?: SceneMust } | { use: 'file'; path: string };

export interface LayoutSlide {
  kind: CardKind;
  title: string; accent?: string; lead?: string;
  kicker?: string; photo?: PhotoRef; photoNote?: string;
  items?: Array<{ emoji?: string; label?: string; title: string; text: string; photo?: PhotoRef }>;
  tags?: string[]; note?: string;
  bad?: { label: string; text: string }; good?: { label: string; text: string };
  photos?: Array<{ photo: PhotoRef; label: string }>;
  cards?: Array<{ label: string; text: string }>;
  stats?: Array<{ value: string; label: string }>;
  calendar?: Array<{ months: number[]; label: string }>;
  rows?: Array<{ big: string; small?: string; text: string }>;
  steps?: Array<{ emoji?: string; title: string; text: string }>;
  end?: { title: string };
}
export interface CardLayout { series: string; slides: LayoutSlide[] }

/** 블로그 사진 후보(세션 image_manifest 에서, 도표 제외). */
export interface BlogPhoto { n: number; path: string; alt: string; real: boolean; mediaId?: string }

// ── 칸 글자 상한(본문 1.5배 판, 2026-10-12 사장님 "본문 글자 1.5~2배") — 1080 폭에서 44px 글자로 두 줄 안쪽. ──
export const CAPS = {
  series: 12, kicker: 12, accent: 10, note: 34, tag: 10,
  itemTitle: 10, itemLabel: 10, itemText: 24,
  cmpLabel: 12, cmpText: 12, pairLabel: 6, cardLabel: 8, cardText: 28,
  statValue: 9, statLabel: 18, calLabel: 22, rowBig: 6, rowSmall: 8, rowText: 24,
  stepTitle: 10, stepText: 18, endTitle: 22, scene: 160,
} as const;

const clean = (v: unknown, cap: number): string => String(v ?? '').replace(/\s+/g, ' ').replace(/[<>]/g, '').trim().slice(0, cap);
/** 칸 글(순수) — 상한의 1.3배까지는 그대로(렌더러가 글자 배율로 맞춘다), 그보다 길면 버린다. 자르면 낱말 중간에서 끊긴다("확인해 보세"). */
const fitCap = (v: unknown, cap: number): string => { const t = String(v ?? '').replace(/\s+/g, ' ').replace(/[<>]/g, '').trim(); return t.length <= Math.ceil(cap * 1.3) ? t : ''; };
/** 이모지 한 글자(그 밖은 버림). */
export function oneEmoji(v: unknown): string | undefined {
  const m = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/u.exec(String(v ?? ''));
  return m ? m[0] : undefined;
}

/** 원문 문장들(순수) — 마크다운 기호·이미지 자리 줄을 걷어 낸다. */
export function sourceSentences(md: string): string[] {
  return String(md ?? '').split('\n')
    .filter((l) => !/^\s*\[IMAGE:/.test(l) && !/^\|?\s*-{3,}/.test(l))
    .flatMap((l) => l.replace(/^(?:#{1,6}|>+|[-*]|\d+[.)])\s*/, '').replace(/[*|]/g, ' ').split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 4);
}

const bigrams = (s: string): string[] => {
  const t = s.replace(/[\s.,·!?~()「」"'“”‘’:;/-]/g, '');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
};
/** 칸 글이 원문 한 문장에 얼마나 담겨 있나(0~1, 순수) — 칸 글 바이그램 중 가장 잘 맞는 원문 문장에 들어 있는 비율.
 *  짧은 칸 글을 긴 원문 문장과 견주므로 주사위 유사도가 아니라 '포함률'을 본다. */
export function coverage(text: string, sents: readonly string[]): number {
  const bg = bigrams(text);
  if (bg.length < 2) return 1; // 한두 글자(이모지·숫자 라벨)는 판정 대상 아님
  let best = 0;
  for (const s of sents) {
    const set = new Set(bigrams(s));
    const hit = bg.filter((b) => set.has(b)).length / bg.length;
    if (hit > best) best = hit;
  }
  return best;
}

/** 원문에서 뽑은 칸인가(순수) — 원문 문장 포함률 0.5 이상, 원문에 없는 수치·월·연도 없음. */
export function extractOk(text: string, source: string, sents: readonly string[]): boolean {
  const t = text.trim();
  if (!t) return false;
  if (introducesNewFacts(source, t)) return false;
  // 아주 짧은 칸(라벨·태그 — 바이그램 4개 이하)은 어미가 바뀌면 포함률이 크게 떨어진다("다 자라면 키가" → "다 자란 키"). 문턱을 낮춘다.
  return coverage(t, sents) >= (bigrams(t).length <= 4 ? 0.3 : 0.5);
}

/** 원문이 이 달을 말하나(순수) — "10월", "5~6월"(5·6 모두), "5-6월". */
export function monthMentioned(source: string, m: number): boolean {
  if (new RegExp(`(?:^|[^\\d])${m}\\s*월`).test(source)) return true;
  const re = /(\d{1,2})\s*[~∼\-–]\s*(\d{1,2})\s*월/g;
  for (let x = re.exec(source); x; x = re.exec(source)) {
    const a = Number(x[1]); const b = Number(x[2]);
    if (a <= m && m <= b) return true;
  }
  return false;
}

/** 사진 자리 정리(순수). 블로그 사진 번호가 없으면 버린다. gen 은 장면 글이 있어야 한다. */
export function parsePhotoRef(raw: unknown, blogCount: number): PhotoRef | undefined {
  const r = (raw ?? {}) as { use?: unknown; n?: unknown; scene?: unknown; must_show?: unknown; must_not?: unknown };
  if (typeof raw === 'string') {
    const m = /^blog:(\d+)$/.exec(raw.trim());
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= blogCount) return { use: 'blog', n: Number(m[1]) };
    return undefined;
  }
  if (r.use === 'blog') {
    const n = Math.floor(Number(r.n));
    return n >= 1 && n <= blogCount ? { use: 'blog', n } : undefined;
  }
  if (r.use === 'file') {
    // 이미 정해진 사진(수정 요청 재렌더) — 카드 폴더 안의 파일만.
    const p = String((raw as { path?: unknown }).path ?? '');
    return p && fs.existsSync(p) ? { use: 'file', path: p } : undefined;
  }
  if (r.use === 'gen') {
    const scene = clean(r.scene, CAPS.scene);
    if (scene.length < 6) return undefined;
    const must = parseSceneMust(r);
    return { use: 'gen', scene, ...(must ? { must } : {}) };
  }
  return undefined;
}

/**
 * 판형 정리·검증(순수, 테스트 대상) — LLM 이 낸 판형을 기획 장 수에 맞추고, 원문에서 뽑지 않은 칸은 버리고,
 * 칸이 모자란 판은 한 단계 단순한 판으로 내린다. 제목·본문은 기획 문구 그대로(이미 사실 게이트를 거쳤다).
 */
export function normalizeLayout(
  raw: unknown,
  plan: { title: string; slides: ReadonlyArray<{ headline: string; body: string }> },
  source: string,
  blogCount: number,
): CardLayout {
  const r = (raw ?? {}) as { series?: unknown; slides?: unknown[] };
  const rs = Array.isArray(r.slides) ? r.slides : [];
  const sents = sourceSentences(source);
  const ok = (t: string): boolean => !source.trim() || extractOk(t, source, sents);
  const total = plan.slides.length;
  const slides = plan.slides.map((ps, i): LayoutSlide => {
    const x = (rs[i] ?? {}) as Record<string, unknown>;
    const title = ps.headline;
    const lead = ps.body.split('\n').map((x) => x.trim()).filter(Boolean).join('\n') || undefined;
    const accentRaw = fitCap(x.accent, CAPS.accent);
    const accent = accentRaw && title.includes(accentRaw) ? accentRaw : undefined;
    const base = { title, ...(accent ? { accent } : {}), ...(lead ? { lead } : {}) };
    const photo = parsePhotoRef(x.photo, blogCount);
    const note = fitCap(x.note, CAPS.note);
    const noteOk = note && ok(note) ? { note } : {};
    let kind = (CARD_KINDS as readonly string[]).includes(String(x.kind)) ? (x.kind as CardKind) : 'photo';
    if (i === 0) kind = 'cover';
    else if (i === total - 1) kind = 'steps';
    else if (kind === 'cover' || kind === 'steps') kind = 'photo';

    const plain = (): LayoutSlide => ({ kind: 'photo', ...base, ...(photo ? { photo } : {}), ...noteOk });
    if (kind === 'cover') {
      const kicker = clean(x.kicker, CAPS.kicker);
      return { kind, ...base, ...(kicker ? { kicker } : {}), ...(photo ? { photo } : {}) };
    }
    if (kind === 'points') {
      const items = (Array.isArray(x.items) ? x.items : []).slice(0, 4).flatMap((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        const t = fitCap(o.title, CAPS.itemTitle); const text = fitCap(o.text, CAPS.itemText);
        if (!t || !text || !ok(`${t} ${text}`) || !ok(text)) return [];
        const label = fitCap(o.label, CAPS.itemLabel); const emoji = oneEmoji(o.emoji); const ph = parsePhotoRef(o.photo, blogCount);
        return [{ title: t, text, ...(label ? { label } : {}), ...(emoji ? { emoji } : {}), ...(ph ? { photo: ph } : {}) }];
      });
      return items.length >= 2 ? { kind, ...base, items, ...noteOk } : plain();
    }
    if (kind === 'photo') {
      const tags = (Array.isArray(x.tags) ? x.tags : []).map((t) => fitCap(t, CAPS.tag)).filter((t) => t && ok(t)).slice(0, 3);
      return { ...plain(), ...(tags.length && photo ? { tags } : {}) };
    }
    if (kind === 'compare') {
      const side = (v: unknown): { label: string; text: string } | undefined => {
        const o = (v ?? {}) as Record<string, unknown>;
        const label = fitCap(o.label, CAPS.cmpLabel); const text = fitCap(o.text, CAPS.cmpText);
        return label && text && ok(text) ? { label, text } : undefined;
      };
      const bad = side(x.bad); const good = side(x.good);
      return bad && good ? { kind, ...base, bad, good, ...(photo ? { photo } : {}) } : plain();
    }
    if (kind === 'pair') {
      const photos = (Array.isArray(x.photos) ? x.photos : []).slice(0, 2).flatMap((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        const ph = parsePhotoRef(o.photo, blogCount); const label = fitCap(o.label, CAPS.pairLabel);
        return ph && label ? [{ photo: ph, label }] : [];
      });
      const cards = (Array.isArray(x.cards) ? x.cards : []).slice(0, 2).flatMap((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const label = fitCap(o.label, CAPS.cardLabel); const text = fitCap(o.text, CAPS.cardText);
        return label && text && ok(text) ? [{ label, text }] : [];
      });
      // 두 사진은 달라야 한다 — 같은 사진에 다른 라벨(우드칩/솔잎)을 붙이면 거짓 설명이 된다(블루베리 멀칭 시험 2026-10-12).
      const distinct = photos.length === 2 && JSON.stringify(photos[0]!.photo) !== JSON.stringify(photos[1]!.photo);
      return distinct && cards.length === 2 ? { kind, ...base, photos, cards, ...noteOk } : plain();
    }
    if (kind === 'numbers') {
      const stats = (Array.isArray(x.stats) ? x.stats : []).slice(0, 3).flatMap((s) => {
        const o = (s ?? {}) as Record<string, unknown>;
        const value = fitCap(o.value, CAPS.statValue); const label = fitCap(o.label, CAPS.statLabel);
        // 수치 칸은 원문에 그 수치가 그대로 있어야 한다(숫자만 떼어 비교).
        const digits = value.match(/\d+(?:[.,]\d+)?/g) ?? [];
        return value && label && digits.length && digits.every((d) => source.includes(d)) && !introducesNewFacts(source, `${value} ${label}`) && ok(label)
          ? [{ value, label }] : [];
      });
      const calendar = (Array.isArray(x.calendar) ? x.calendar : []).slice(0, 3).flatMap((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const months = (Array.isArray(o.months) ? o.months : []).map((m) => Math.floor(Number(m))).filter((m) => m >= 1 && m <= 12);
        const label = fitCap(o.label, CAPS.calLabel);
        return months.length && label && months.every((m) => monthMentioned(source, m)) && !introducesNewFacts(source, label)
          ? [{ months: [...new Set(months)], label }] : [];
      });
      return stats.length || calendar.length
        ? { kind, ...base, ...(stats.length ? { stats } : {}), ...(calendar.length ? { calendar } : {}), ...(photo ? { photo } : {}) }
        : plain();
    }
    if (kind === 'facts') {
      const rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 4).flatMap((rw) => {
        const o = (rw ?? {}) as Record<string, unknown>;
        const big = fitCap(o.big, CAPS.rowBig); const small = fitCap(o.small, CAPS.rowSmall); const text = fitCap(o.text, CAPS.rowText);
        return big && text && ok(text) && !introducesNewFacts(source, `${big} ${small}`) ? [{ big, text, ...(small ? { small } : {}) }] : [];
      });
      return rows.length >= 2 ? { kind, ...base, rows } : plain();
    }
    // steps(마무리)
    // 마무리 할 일은 3개까지(4개면 큰 글자가 들어가지 않아 배율이 0.76 까지 줄었다 — 호두나무 시험).
    const steps = (Array.isArray(x.steps) ? x.steps : []).slice(0, 3).flatMap((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const t = fitCap(o.title, CAPS.stepTitle); const text = fitCap(o.text, CAPS.stepText); const emoji = oneEmoji(o.emoji);
      return t && text && ok(text) ? [{ title: t, text, ...(emoji ? { emoji } : {}) }] : [];
    });
    const endTitle = fitCap((x.end as { title?: unknown } | undefined)?.title, CAPS.endTitle);
    return { kind: 'steps', ...base, steps: steps.length >= 2 ? steps : [], end: { title: endTitle || '저장해 두고 필요할 때 꺼내 보세요' } };
  });
  return { series: clean(r.series, CAPS.series) || clean(plan.title, CAPS.series), slides };
}

/** 원문 대조용 칸 목록(순수) — 제목·본문을 뺀 새 칸만. key 는 지울 때 쓰는 주소. */
export interface FieldRef { key: string; field: string; text: string }
export function layoutFields(l: CardLayout): FieldRef[] {
  const out: FieldRef[] = [];
  l.slides.forEach((s, i) => {
    const at = `${i + 1}번 카드`;
    if (s.note) out.push({ key: `${i}.note`, field: at, text: s.note });
    s.tags?.forEach((t, k) => out.push({ key: `${i}.tags.${k}`, field: at, text: t }));
    s.items?.forEach((t, k) => out.push({ key: `${i}.items.${k}`, field: at, text: `${t.title} — ${t.text}` }));
    if (s.bad) out.push({ key: `${i}.bad`, field: at, text: `${s.bad.label}: ${s.bad.text}` });
    if (s.good) out.push({ key: `${i}.good`, field: at, text: `${s.good.label}: ${s.good.text}` });
    s.cards?.forEach((t, k) => out.push({ key: `${i}.cards.${k}`, field: at, text: `${t.label}: ${t.text}` }));
    s.stats?.forEach((t, k) => out.push({ key: `${i}.stats.${k}`, field: at, text: `${t.value} ${t.label}` }));
    s.calendar?.forEach((t, k) => out.push({ key: `${i}.calendar.${k}`, field: at, text: `${t.months.join('·')}월 — ${t.label}` }));
    s.rows?.forEach((t, k) => out.push({ key: `${i}.rows.${k}`, field: at, text: `${t.big}${t.small ? `(${t.small})` : ''} — ${t.text}` }));
    s.steps?.forEach((t, k) => out.push({ key: `${i}.steps.${k}`, field: at, text: `${t.title} — ${t.text}` }));
  });
  return out;
}

/** 걸린 칸 지우기(순수) — 지운 뒤 칸이 모자란 판은 단순한 판(photo)으로 내린다. 마무리 장은 steps 를 비운다. */
export function dropFields(l: CardLayout, keys: ReadonlySet<string>): CardLayout {
  if (!keys.size) return l;
  const slides = l.slides.map((s, i): LayoutSlide => {
    const keep = <T>(arr: T[] | undefined, name: string): T[] | undefined => arr?.filter((_, k) => !keys.has(`${i}.${name}.${k}`));
    const n: LayoutSlide = {
      ...s,
      ...(s.note && keys.has(`${i}.note`) ? { note: undefined } : {}),
      tags: keep(s.tags, 'tags'), items: keep(s.items, 'items'), cards: keep(s.cards, 'cards'),
      stats: keep(s.stats, 'stats'), calendar: keep(s.calendar, 'calendar'), rows: keep(s.rows, 'rows'), steps: keep(s.steps, 'steps'),
      ...(keys.has(`${i}.bad`) ? { bad: undefined } : {}), ...(keys.has(`${i}.good`) ? { good: undefined } : {}),
    };
    const short = (n.kind === 'points' && (n.items?.length ?? 0) < 2)
      || (n.kind === 'compare' && (!n.bad || !n.good))
      || (n.kind === 'pair' && (n.cards?.length ?? 0) < 2)
      || (n.kind === 'numbers' && !n.stats?.length && !n.calendar?.length)
      || (n.kind === 'facts' && (n.rows?.length ?? 0) < 2);
    if (short) return { kind: 'photo', title: n.title, ...(n.accent ? { accent: n.accent } : {}), ...(n.lead ? { lead: n.lead } : {}), ...(n.photo ? { photo: n.photo } : n.photos?.[0] ? { photo: n.photos[0].photo } : {}), ...(n.note ? { note: n.note } : {}) };
    if (n.kind === 'steps' && (n.steps?.length ?? 0) < 2) return { ...n, steps: [] };
    return n;
  });
  return { ...l, slides };
}

/** parity 지적("항목N: …")을 칸 주소로(순수). */
export function parityKeys(problems: readonly string[], fields: readonly FieldRef[]): Set<string> {
  const out = new Set<string>();
  for (const p of problems) {
    const m = /항목\s*(\d+)/.exec(p);
    const f = m ? fields[Number(m[1]) - 1] : undefined;
    if (f) out.add(f.key);
  }
  return out;
}

/** 판형 설계 지시(LLM 프롬프트, 순수). */
export function layoutPrompt(a: {
  plan: { title: string; slides: ReadonlyArray<{ headline: string; body: string }> };
  source: string; blog: readonly BlogPhoto[]; maxGen: number; flagged?: readonly string[];
}): string {
  const n = a.plan.slides.length;
  return [
    `인스타그램 카드뉴스 ${n}장의 판형을 고르고 칸을 채워라. 제목·본문은 아래 기획 문구를 그대로 쓴다(출력하지 마라) — 너는 판형(kind)과 그 판의 칸만 채운다.`,
    '[기획 — 장별 제목 / 본문]',
    ...a.plan.slides.map((s, i) => `${i + 1}. ${s.headline}${s.body ? ` / ${s.body.replace(/\n/g, ' ')}` : ''}`),
    '',
    `[블로그 원문 — 칸 글은 반드시 여기서만 뽑는다]\n${a.source.slice(0, 5000)}`,
    a.flagged?.length ? `[원문에서 근거가 확인되지 않은 주장 — 칸에 쓰지 마라]\n${a.flagged.slice(0, 8).map((c, i) => `${i + 1}. ${c}`).join('\n')}` : '',
    '',
    '[판형 8가지 — 장마다 하나]',
    '- cover(1번 장 고정): kicker(12자, 이모지 1개 + 짧은 꼬리말, 예 "🍊 감나무 편"), photo',
    '- points: items 2~4개 {emoji, label(10자, 예 "CHECK 1"), title(10자), text(24자), photo(선택 — 작은 사진)}, note(선택 34자 — 그 장의 정리 한 줄)',
    '- photo: photo(큰 사진), tags 1~3개(10자 — 사진에서 볼 곳), note(선택)',
    '- compare: bad{label 12자, text 12자}(틀린 쪽/다른 것), good{label, text}(맞는 쪽/이 나무), photo(선택)',
    '- pair: photos 정확히 2개 {photo, label 6자}, cards 정확히 2개 {label 8자, text 28자}, note(선택)',
    '- numbers: stats 1~3개 {value 9자(원문 수치 그대로, 예 "10~15m"), label 18자}, calendar 0~3줄 {months:[원문에 나온 달 숫자], label 22자}, photo(선택)',
    '- facts(어두운 판 — 이름·역사·기록 같은 읽을거리): rows 2~4개 {big 6자, small 8자, text 24자}',
    `- steps(${n}번 장 고정 — 마무리 행동): steps 2~3개 {emoji, title 10자, text 18자}, end{title 22자 — 저장 유도 한 줄}`,
    '',
    '[칸 규칙 — 어기면 그 칸은 버려진다]',
    '1) 칸 글은 원문 문장에서 뽑아 줄인 것 — 원문 문장의 낱말을 그대로 쓰고, 원문에 없는 사실·수치·월·연도·품종을 넣지 마라. 유보("보통")가 있으면 지켜라.',
    '2) 제목·본문이 이미 한 말을 칸에서 되풀이하지 말고, 그 장의 설명을 더해라(이유·특징·조건·차이). 같은 사실을 여러 장에 반복하지 마라.',
    '3) 글자 상한을 지켜라(휴대폰에서 큰 글자로 읽힌다). 문장은 "~요/~다"로 짧게.',
    '4) 판은 내용에 맞게 고르고 고루 섞어라 — 같은 판을 세 장 연속 쓰지 마라. 구별·비교 내용이면 compare, 확인 항목·특징 나열이면 points, 사진으로 보여 줄 부위가 있으면 photo, 두 부위·두 시기면 pair, 원문에 수치·달이 있으면 numbers, 이름·유래·기록이면 facts.',
    '5) 이모지는 칸 내용과 맞는 것 하나씩.',
    '',
    '[사진]',
    a.blog.length
      ? `블로그 사진(재사용 우선 — {"use":"blog","n":번호}). 한 사진은 두 번까지:\n${a.blog.map((b) => `${b.n}. ${b.alt}${b.real ? ' (실제 촬영)' : ''}`).join('\n')}`
      : '블로그 사진 없음.',
    `맞는 블로그 사진이 없을 때만 새로 그린다 — {"use":"gen","scene":"장면 묘사 160자(글자 없는 사진)","must_show":["원문이 말한 모습"],"must_not":["나오면 안 되는 것"]}. 새로 그리는 사진은 세트 전체에서 ${a.maxGen}장 이하. 사진이 필요 없는 판(points 의 emoji 칸·facts·steps)은 사진을 넣지 마라.`,
    '사진이 들어가는 판(cover·photo·compare·pair·numbers)은 사진을 반드시 넣어라 — 맞는 블로그 사진이 없으면 gen 으로. 사진 없이 글만 있는 photo 판은 빈 화면처럼 보인다. 같은 블로그 사진을 연달아 쓰지 마라.',
    '장면 묘사·must_show 는 원문이 말한 모습대로(삽수는 잎 없는 맨가지, 묘목은 원문이 말한 나이·크기). 칼·가위·톱은 그리지 마라.',
    '',
    `JSON 형식: {"series":"카드 상단 머리말 12자(예 \\"산길 나무 구별 노트\\")","slides":[{"kind":"cover","accent":"제목 안에서 강조할 낱말(제목에 있는 그대로)","kicker":"...","photo":{...}}, ...]} — slides 는 정확히 ${n}개, 순서대로.`,
  ].filter(Boolean).join('\n');
}

/** 렌더 입력(spec)으로 — 사진 자리를 파일 경로로 바꾼다(순수). */
export function toRenderSpec(l: CardLayout, resolve: (r: PhotoRef | undefined) => string | undefined, opts: {
  outDir: string; fontDir: string; brand: { name?: string; handle?: string }; coverNote?: string; only?: number[];
}): Record<string, unknown> {
  const ph = (r: PhotoRef | undefined): string | undefined => resolve(r);
  return {
    series: l.series, outDir: opts.outDir, fontDir: opts.fontDir, brand: opts.brand, ...(opts.only ? { only: opts.only } : {}),
    slides: l.slides.map((s, i) => ({
      ...s,
      photo: ph(s.photo),
      ...(i === 0 && opts.coverNote ? { photoNote: opts.coverNote } : {}),
      ...(s.items ? { items: s.items.map((it) => ({ ...it, photo: ph(it.photo) })) } : {}),
      ...(s.photos ? { photos: s.photos.map((p) => ({ label: p.label, photo: ph(p.photo) })) } : {}),
    })),
  };
}

/** 글자 없는 사진 프롬프트(순수) — 카드 사진 칸용. */
export function genPhotoPrompt(scene: string, must: SceneMust | undefined, subject?: string): string {
  return [
    subject ? `[대상 식물 — 화면의 나무·풀은 반드시 이 종] ${subject}. 잎 모양·잎차례·수형을 이 종의 실제 모습대로.` : '',
    `장면: ${scene}`,
    ...mustPromptLines(must),
    '세로 사진(2:3). 자연광 실사 사진, 피사체가 화면 가운데에서 또렷하게. 글자·숫자·간판·워터마크·로고 없음. 칼·가위·톱 같은 연장 없음.',
  ].filter(Boolean).join('\n');
}

/** HTML 렌더 실행 — scripts/blog_skills/card_render.py. 실패 시 null. */
export async function renderCardSpec(specPath: string, signal?: AbortSignal): Promise<{ ok: boolean; slides: Array<{ n: number; k: number; issues: string[] }> } | null> {
  const py = path.resolve('scripts/blog_skills/venv/bin/python');
  const script = path.resolve('scripts/blog_skills/card_render.py');
  try {
    const { stdout } = await execFileP(fs.existsSync(py) ? py : 'python3', [script, specPath], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024, signal });
    const line = stdout.split('\n').reverse().find((l) => l.startsWith('RESULT_JSON '));
    return line ? JSON.parse(line.slice('RESULT_JSON '.length)) as { ok: boolean; slides: Array<{ n: number; k: number; issues: string[] }> } : null;
  } catch { return null; }
}

/** 폰트 폴더(Remotion 과 공유). */
export const CARD_FONT_DIR = path.resolve('remotion/fonts');
/** 세트당 새로 그리는 사진 상한(비용). */
export const CARD_MAX_GEN = Math.max(0, Math.min(8, Number(process.env.CARDNEWS_HTML_MAX_GEN ?? 4) || 0));
