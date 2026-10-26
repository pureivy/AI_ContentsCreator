/**
 * 사실 게이트 조임 스위치 2개의 오프라인 영향 측정(2026-10-26, LLM 호출 0회·서버 무관).
 *
 *   pnpm tsx scripts/fact_gate_switch_report.ts [편수=20] [위키 사본 폴더]
 *
 * ① FACT_HEDGE_HARD_TIMING — 최근 자동 블로그 글의 문장을 끔/켬으로 선분류해 'hedged → claim' 으로 바뀌는 문장을 센다.
 *    (i) draft.md 전 문장(상한 추정 — 실제 게이트는 LLM 이 뽑은 주장만 선분류한다)
 *    (ii) fact_gate.json 에 실제로 유보문으로 기록된 주장(filtered.hedged·firstPass·hedged_general) — 실제 증가분.
 *    근거 대리 지표: 그 문장의 수치 토큰이 같은 런의 fact_card.md·research_brief.md 에 있는가(없으면 보류 후보).
 * ② WIKI_FACT_EXCLUDE_RUN_SOURCES — 같은 글의 런 topic 으로 forFacts 위키 질의(org.ts 와 같은 limit 3)를 끔/켬 비교.
 *    위키 생성자가 마이그레이션 쓰기를 하므로 data/wiki-<brand> 를 사본 폴더에 복사해 그 사본으로만 읽는다.
 *    자기 글 페이지(sources 에 run:<그 런>)는 게이트 시점엔 없었으므로 뺀다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../src/config';
import { splitBodySentences, classifyClaim, HARD_FACT_RE, HARD_TIMING_RE } from '../src/content/factGate';
import { LlmWiki, provenanceLabel, type WikiPage } from '../src/wiki/llmwiki';

const N = Math.max(1, Number(process.argv[2]) || 20);
const DATA = path.dirname(CONFIG.wikiDir);
const SESS = path.join(DATA, 'sessions');

interface Piece { id: string; title: string; auto?: boolean; brand?: string; runId?: string; createdTs: string }
const pieces = (JSON.parse(fs.readFileSync(path.join(DATA, 'pieces', 'index.json'), 'utf-8')) as Piece[])
  .filter((p) => p.auto && p.runId && fs.existsSync(path.join(SESS, p.runId, 'draft.md')))
  .sort((a, b) => b.createdTs.localeCompare(a.createdTs))
  .slice(0, N);

const read = (p: string): string => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };
const norm = (s: string): string => s.replace(/\s+/g, '');
/** 수치 토큰(숫자+단위·월·순) — 근거 대리 지표용. */
function numTokens(s: string): string[] {
  const out = new Set<string>();
  for (const re of [HARD_FACT_RE, HARD_TIMING_RE]) {
    for (const m of s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const t = norm(m[0].replace(/^\D(?=\d)/, '')).replace(/^보다.*?(?=\d)/, '');
      if (/\d/.test(t)) out.add(t.toLowerCase());
    }
  }
  return [...out];
}

// ---------- ① ----------
let allOff = 0, allOn = 0, allSent = 0, hedOff = 0, hedOn = 0, realHedged = 0, realFlip = 0, flipEvid = 0, flipJudgeEv = 0;
const examples: Array<{ title: string; s: string; ev: boolean }> = [];
const allFlipExamples: Array<{ title: string; s: string }> = [];
const perPost: Array<{ title: string; offClaim: number; onClaim: number; realHedged: number; realFlip: number; flipNoEv: number }> = [];

for (const p of pieces) {
  const dir = path.join(SESS, p.runId!);
  const body = read(path.join(dir, 'draft.md'));
  const sents = splitBodySentences(body);
  let offC = 0, onC = 0;
  for (const s of sents) {
    const off = classifyClaim({ text: s, kind: 'general' }, false);
    const on = classifyClaim({ text: s, kind: 'general' }, true);
    if (off === 'claim') offC++;
    if (on === 'claim') onC++;
    if (off === 'hedged') hedOff++;
    if (on === 'hedged') hedOn++;
    if (off === 'hedged' && on === 'claim') allFlipExamples.push({ title: p.title, s });
  }
  allSent += sents.length; allOff += offC; allOn += onC;

  const fg = (() => { try { return JSON.parse(read(path.join(dir, 'fact_gate.json'))); } catch { return null; } })();
  const hedgedTexts = new Map<string, string | undefined>(); // text → 판정기 evidence(있으면)
  if (fg) {
    for (const t of [...(fg.filtered?.hedged ?? []), ...(fg.firstPass?.filtered?.hedged ?? [])]) if (!hedgedTexts.has(t)) hedgedTexts.set(t, undefined);
    for (const c of fg.claims ?? []) if (c.status === 'hedged_general') hedgedTexts.set(c.text, c.evidence || hedgedTexts.get(c.text));
  }
  const evidence = norm(read(path.join(dir, 'fact_card.md')) + read(path.join(dir, 'research_brief.md'))).toLowerCase();
  let rf = 0, noEv = 0;
  for (const [t, judgeEv] of hedgedTexts) {
    if (classifyClaim({ text: t, kind: 'general' }, false) !== 'hedged') continue; // 이미 claim(종전 HARD_FACT_RE) 은 제외
    realHedged++;
    if (classifyClaim({ text: t, kind: 'general' }, true) !== 'claim') continue;
    rf++; realFlip++;
    const toks = numTokens(t);
    const ev = toks.length > 0 && toks.every((k) => evidence.includes(k));
    if (ev) flipEvid++; else noEv++;
    if (judgeEv) flipJudgeEv++;
    examples.push({ title: p.title, s: t, ev });
  }
  perPost.push({ title: p.title, offClaim: offC, onClaim: onC, realHedged: [...hedgedTexts.keys()].length, realFlip: rf, flipNoEv: noEv });
}

const pct = (a: number, b: number): string => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
console.log(`\n=== ① FACT_HEDGE_HARD_TIMING — 최근 자동 블로그 ${pieces.length}편 ===`);
console.log(`(i) draft.md 전 문장 ${allSent}개: 유보(hedged) ${hedOff} → ${hedOn} · 판정 대상(claim) ${allOff} → ${allOn} (+${allOn - allOff}, ${pct(allOn - allOff, allOff)}) · 편당 ${(allOff / pieces.length).toFixed(1)} → ${(allOn / pieces.length).toFixed(1)}`);
console.log(`(ii) fact_gate.json 실제 유보 주장 ${realHedged}개 중 claim 전환 ${realFlip}개(${pct(realFlip, realHedged)}) · 편당 ${(realFlip / pieces.length).toFixed(2)}`);
console.log(`     전환분 근거 대리: 수치 토큰이 사실카드·브리프에 모두 있음 ${flipEvid} / 없음 ${realFlip - flipEvid}(보류 후보) · 판정기 evidence 기록 있음 ${flipJudgeEv}`);
console.log(`     전환 1건 이상인 편 ${perPost.filter((x) => x.realFlip > 0).length}/${pieces.length}, 근거 없는 전환 1건 이상인 편 ${perPost.filter((x) => x.flipNoEv > 0).length}/${pieces.length}`);
console.log('\n편별: 제목 | 전문장 claim 끔→켬 | 기록 유보 주장 | 전환 | 근거없는 전환');
for (const x of perPost) console.log(`  ${x.title.slice(0, 34).padEnd(34)} | ${x.offClaim}→${x.onClaim} | ${x.realHedged} | ${x.realFlip} | ${x.flipNoEv}`);
const ex = [...examples.map((e) => ({ ...e, src: '기록' })), ...allFlipExamples.filter((a) => !examples.some((e) => e.s === a.s)).map((a) => ({ ...a, ev: false, src: '본문' }))].slice(0, 15);
console.log('\n새로 판정될 문장 예시(최대 15, [기록]=fact_gate 유보 주장 · [본문]=draft 전 문장, 근거O/X=수치 토큰 근거 대리):');
ex.forEach((e, i) => console.log(`  ${i + 1}. [${e.src}${e.src === '기록' ? (e.ev ? '·근거O' : '·근거X') : ''}] ${e.s}  — ${e.title.slice(0, 24)}`));

// ---------- ② ----------
const srcWiki = CONFIG.wikiDir.replace(/wiki$/, `wiki-${pieces[0]?.brand ?? 'bionditree'}`);
const copyRoot = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'wikicopy-'));
const copyWiki = path.join(copyRoot, path.basename(srcWiki));
if (!fs.existsSync(copyWiki)) fs.cpSync(srcWiki, copyWiki, { recursive: true });
const w = new LlmWiki(copyWiki);
const labelHist = new Map<string, number>();
for (const pg of w.allPages()) { const l = `${pg.type}/${provenanceLabel(pg)}`; labelHist.set(l, (labelHist.get(l) ?? 0) + 1); }
console.log(`\n=== ② WIKI_FACT_EXCLUDE_RUN_SOURCES — 위키 사본 ${copyWiki} (${w.allPages().length}쪽) ===`);
console.log('위키 구성(type/출처 라벨):', [...labelHist].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));

/** forFacts limit 3 — 자기 글 페이지를 뺀 상위 3쪽과 그 발췌 글자 수(판정기 CAP.wiki=6000 적용). */
function factQuery(topic: string, runId: string, exclude: boolean): { hits: WikiPage[]; chars: number } {
  const r = w.query(topic, 20, { forFacts: true, excludeRunSources: exclude });
  const sections: Array<{ p: WikiPage; len: number }> = [];
  let cursor = 0;
  const heads = r.hits.map((p) => `### ${p.title} [${provenanceLabel(p)}]\n`);
  const starts = heads.map((h) => { const i = r.context.indexOf(h, cursor); if (i >= 0) cursor = i + h.length; return i; });
  r.hits.forEach((p, i) => {
    const end = i + 1 < starts.length && starts[i + 1]! >= 0 ? starts[i + 1]! - 2 : r.context.length;
    sections.push({ p, len: starts[i]! >= 0 ? end - starts[i]! : 0 });
  });
  const kept = sections.filter((x) => !x.p.sources.includes(`run:${runId}`)).slice(0, 3);
  const chars = Math.min(6000, kept.reduce((n, x) => n + x.len, 0) + Math.max(0, kept.length - 1) * 2);
  return { hits: kept.map((x) => x.p), chars };
}

let hOff = 0, hOn = 0, cOff = 0, cOn = 0, zeroOn = 0;
const offLabels = new Map<string, number>(), onLabels = new Map<string, number>();
console.log('\n편별: topic | 위키 근거 쪽 끔→켬 | 발췌 글자 끔→켬 | 끔 상태 라벨');
for (const p of pieces) {
  let topic = p.title;
  try { topic = JSON.parse(read(path.join(SESS, p.runId!, 'run.json'))).topic || p.title; } catch { /* 제목 폴백 */ }
  const off = factQuery(topic, p.runId!, false);
  const on = factQuery(topic, p.runId!, true);
  hOff += off.hits.length; hOn += on.hits.length; cOff += off.chars; cOn += on.chars;
  if (!on.hits.length) zeroOn++;
  for (const x of off.hits) { const l = provenanceLabel(x); offLabels.set(l, (offLabels.get(l) ?? 0) + 1); }
  for (const x of on.hits) { const l = provenanceLabel(x); onLabels.set(l, (onLabels.get(l) ?? 0) + 1); }
  console.log(`  ${topic.slice(0, 34).padEnd(34)} | ${off.hits.length}→${on.hits.length} | ${off.chars}→${on.chars} | ${off.hits.map((x) => provenanceLabel(x)).join(', ')}`);
}
const n = pieces.length;
console.log(`\n합계: 위키 근거 쪽 편당 ${(hOff / n).toFixed(2)} → ${(hOn / n).toFixed(2)} · 발췌 글자 편당 ${Math.round(cOff / n)} → ${Math.round(cOn / n)} (증감 ${cOn >= cOff ? '+' : '-'}${pct(Math.abs(cOn - cOff), cOff)}) · 켬 때 위키 근거 0쪽인 편 ${zeroOn}/${n}`);
console.log('끔 라벨 분포:', [...offLabels].map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('켬 라벨 분포:', [...onLabels].map(([k, v]) => `${k} ${v}`).join(' · ') || '(없음)');
