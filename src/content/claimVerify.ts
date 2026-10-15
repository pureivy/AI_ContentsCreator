/**
 * 블로그 근거 미확인 주장 사전 확인(2026-10-15 사장님 지시 — "블로그 글을 발행하기 전에 근거 미확인 주장들을 확실하게
 * 사전 검증한 후 발행").
 *
 * 왜: 사실 게이트는 브리프·사실 카드·위키에 근거가 없는 일반 상식 문장을 '참고(unverified)'로 통과시킨다. 그 문장이
 * 글의 핵심이면(음나무 가시 구별법) 파생 숏폼·카드가 충실히 옮길수록 '원문에서 근거 미확인으로 분류된 주장' 경고가
 * 붙는다 — 숏폼을 잘 써도 없앨 수 없는 경고였다(10-10~14 숏폼 22편 실측).
 *
 * 무엇: 그 문장들을 네이버 지식백과 **본문 전체**(두산백과·국가생물종지식정보·식품과학사전 등)와 공공기관 사이트에
 * 대조한다. 다른 블로그는 근거로 치지 않는다 — 출처 없는 주장을 '확인됨'으로 세탁하는 길이 된다.
 *   - 확인(supported): 문서의 문장을 그대로 인용해야 한다. 인용이 문서에 실제로 없거나 주장과 겹치는 낱말이 없으면
 *     확인으로 치지 않는다(결정적 검사) — 잘못된 '확인'이 이 기능에서 가장 나쁜 실패다.
 *   - 확인 못 함·어긋남: 호출부가 그 문장만 유보어로 낮추거나 지운다(repairSentences).
 *
 * 결과는 fact_gate.json 에 그대로 반영된다 — 파생 숏폼·카드는 거기서 '근거 미확인' 목록을 읽는다(sourceFlaggedClaims).
 */
import { naverEncyc, type EncycResult } from '../grounding/naver_encyc';
import { getSecret } from '../secrets/store';
import { stripTags } from '../grounding/naver_common';
import { salientTokens } from './inheritedClaims';
import { microJSON } from '../orchestrator/agent';
import { applySentenceRepairs, type SentenceRepair } from './factGate';

export interface VerifiedClaim { text: string; url: string; title: string; quote: string }
export interface VerifyOutcome {
  verified: VerifiedClaim[];
  contradicted: VerifiedClaim[];
  notFound: string[];
  /** 사실이 아니라 권유·평가·의견인 문장("그게 맞는 순서입니다") — 확인할 사실이 없어 근거 미확인 목록에서 뺀다. 수치가 든 문장은 여기 못 온다. */
  opinion: string[];
  /** 검색 시도·실패 수 — 검색이 막혀 0건인 것을 '확인할 게 없음'으로 오인하지 않게 로그에 남긴다. */
  searches: number; failedSearches: number; docs: number;
}

/** 근거로 치는 출처 — 네이버 지식백과 + 공공기관(*.go.kr: 농사로·농진청·원예원·국가생물종·생물자원관·산림청·지역 농업기술센터). */
export const AUTHORITATIVE_HOST_RE = /(?:^terms\.naver\.com|\.go\.kr)$/;

export function isAuthoritative(url: string): boolean {
  try { return AUTHORITATIVE_HOST_RE.test(new URL(url).hostname); } catch { return false; }
}

const squash = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * 문서 HTML → 본문 텍스트(순수). 지식백과는 머리·꼬리 메뉴를 걷어 낸다("글자크기" 뒤 ~ "AI 추천 태그"/"출처" 앞).
 * 그 밖(농사로 등)은 메뉴가 길어 앞 6000자가 메뉴뿐일 수 있다 — focus 낱말이 처음 나오는 곳 조금 앞부터 자른다.
 */
export function extractDocText(html: string, focus: readonly string[] = [], width = 6000): string {
  const t = squash(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  const start = t.indexOf('글자크기');
  if (start < 0) {
    const at = Math.max(0, densestAt(t, focus) - 300);
    return t.slice(at, at + width).trim();
  }
  const body = t.slice(start + 4);
  const end = body.search(/AI 추천 태그|좋아요 0 공유하기|출처 [^ ]+ 제공처/);
  const doc = (end > 0 ? body.slice(0, end) : body).trim();
  if (doc.length <= width) return doc;
  const at = Math.max(0, densestAt(doc, focus) - 300);
  return doc.slice(at, at + width);
}

/** focus 낱말이 가장 많이 몰린 곳(1,500자 창)의 시작 위치(순수). 메뉴에 한 번 스친 낱말보다 본문 덩어리를 고른다. */
export function densestAt(t: string, focus: readonly string[]): number {
  const pos: number[] = [];
  for (const f of focus) { if (!f) continue; let i = t.indexOf(f); while (i >= 0 && pos.length < 400) { pos.push(i); i = t.indexOf(f, i + f.length); } }
  if (!pos.length) return 0;
  pos.sort((a, b) => a - b);
  let best = pos[0]!; let bestN = 0;
  for (let a = 0, b = 0; a < pos.length; a++) {
    while (b < pos.length && pos[b]! - pos[a]! <= 1500) b++;
    if (b - a > bestN) { bestN = b - a; best = pos[a]!; }
  }
  return best;
}

/** 주장 → 검색어(순수): 수종 + 변별 낱말 2개. 수종이 없으면 변별 낱말 3개. */
export function queryFor(claim: string, species: string | null): string {
  const toks = [...salientTokens(claim)].filter((t) => !/\d/.test(t) && (!species || !species.includes(t) && !t.includes(species.replace(/나무$/, ''))));
  return [species, ...toks.slice(0, species ? 2 : 3)].filter(Boolean).join(' ');
}

/**
 * 판정 인용 검사(순수) — 인용이 문서에 그대로 있고(공백 무시), 8자 이상이며, 주장과 변별 낱말을 둘 이상 공유해야 한다.
 * 수종 이름만 겹치는 인용("음나무는 두릅나무과의 낙엽 교목")은 아무 주장이나 '확인'해 줄 수 있어 수종 낱말은 세지 않는다.
 */
export function quoteBacksClaim(claim: string, quote: string, docText: string, species: string | null): boolean {
  const q = squash(quote).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  if (q.length < 8) return false;
  if (!squash(docText).replace(/\s/g, '').includes(q.replace(/\s/g, ''))) return false;
  const stem = species?.replace(/나무$/, '') ?? '';
  const ct = [...salientTokens(claim)].filter((t) => !species || (t !== species && !(stem && t.startsWith(stem))));
  const qt = salientTokens(q);
  const qs = q.replace(/\s/g, '');
  // 낱말 하나('가시')만 겹치면 "줄기에 가시가 많다"가 "가시는 밑동이 넓적한 삼각형"을 확인해 준다 — 둘 이상(주장 낱말이 하나뿐이면 하나).
  const shared = ct.filter((t) => qt.has(t) || (t.length >= 2 && qs.includes(t))).length;
  return shared >= Math.min(2, ct.length) && shared > 0;
}

export interface WebHit { title: string; url: string; snippet: string }
export interface VerifyDeps {
  encyc: (q: string, n: number, signal?: AbortSignal) => Promise<EncycResult[]>;
  /** 네이버 웹문서 검색 — 'site:' 지정이 된다(DuckDuckGo 는 site: 질의가 0건, 2026-10-15 실측). */
  web: (q: string, n: number, signal?: AbortSignal) => Promise<WebHit[]>;
  fetchText: (url: string, focus: readonly string[], signal?: AbortSignal) => Promise<string>;
  /** LLM JSON 1콜 — 검색어 만들기와 판정에 쓴다. */
  judge: (model: string, system: string, user: string, signal?: AbortSignal) => Promise<unknown>;
}

/** 요청마다 15초 상한 — 런 신호만 넘기면 상한이 사라져 느린 공공 사이트 하나가 블로그 런 전체를 붙잡는다. */
const withTimeout = (signal?: AbortSignal): AbortSignal => (signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function naverWeb(q: string, n: number, signal?: AbortSignal): Promise<WebHit[]> {
  const id = getSecret('NAVER_CLIENT_ID'); const sec = getSecret('NAVER_CLIENT_SECRET');
  if (!id || !sec) return [];
  const r = await fetch(`https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(q)}&display=${n}`, {
    headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': sec }, signal: withTimeout(signal),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json() as { items?: Array<{ title?: string; link?: string; description?: string }> };
  return (j.items ?? []).map((i) => ({ title: stripTags(i.title ?? ''), url: i.link ?? '', snippet: stripTags(i.description ?? '') })).filter((i) => i.url);
}
/** HTML 바이트 → 문자열 — 농사로 옛 문서는 EUC-KR 이다(그대로 읽으면 글자가 깨져 판정이 늘 not_found, 2026-10-15 실측). */
export function decodeHtml(buf: ArrayBuffer, contentType: string): string {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 3000));
  const cs = (/charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8').toLowerCase();
  let txt: string;
  try { txt = new TextDecoder(/euc-?kr|ks_c_5601|cp949/.test(cs) ? 'euc-kr' : cs).decode(buf); }
  catch { txt = new TextDecoder('utf-8').decode(buf); }
  // 표시 없는 EUC-KR(농사로 mig_img 문서) — UTF-8 로 읽어 깨짐 문자가 많으면 EUC-KR 로 다시 읽는다.
  const bad = (txt.match(/\uFFFD/g) ?? []).length;
  if (bad > 20) { try { return new TextDecoder('euc-kr').decode(buf); } catch { /* 그대로 */ } }
  return txt;
}

export const defaultVerifyDeps: VerifyDeps = {
  encyc: naverEncyc,
  web: naverWeb,
  fetchText: async (url, focus, signal) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: withTimeout(signal) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(ct)) throw new Error(`문서 아님(${ct || '형식 없음'})`); // PDF·한글 첨부는 못 읽는다
    return extractDocText(decodeHtml(await r.arrayBuffer(), ct), focus, 2500);
  },
  judge: (model, system, user, signal) => microJSON(model, system, user, { maxOutputTokens: 3000, signal }),
};

const SYS = '너는 원예 사실 확인 담당이다. 주어진 문서에 실제로 적힌 내용만 근거로 판정한다. 상식이나 기억으로 판정하지 않는다.';

/** 검색어·사실 여부 계획(LLM 1콜). 실패하면 기계적 검색어(queryFor)로, 전부 사실로 본다. */
async function planQueries(deps: VerifyDeps, model: string, claims: readonly string[], species: string | null, signal?: AbortSignal): Promise<Array<{ q: string; factual: boolean }>> {
  const fallback = claims.map((c) => ({ q: queryFor(c, species), factual: true }));
  const user = [
    `수종: ${species ?? '(없음)'}`,
    '[문장]', ...claims.map((c, i) => `${i + 1}. ${c}`),
    [
      '문장마다 두 가지를 정하라.',
      '- factual: 확인할 수 있는 사실(식물의 형태·생리·생태, 재배 방법의 결과·원리)이 들어 있으면 true. 권유·평가·마음가짐·글의 안내("그게 맞는 순서입니다", "성공입니다", "평가하지 않습니다")뿐이면 false.',
      '- q: 공공기관(농사로·국가생물종지식정보)·백과사전에서 이 사실을 찾을 검색어. 2~4 낱말, 전문 용어가 있으면 쓴다(예: "도장지 꽃눈", "가지 절단 지륭"). 수종이 필요하면 넣는다.',
      'JSON: {"items":[{"index":1,"factual":true,"q":"..."}]}',
    ].join('\n'),
  ].join('\n\n');
  type Plan = { items?: Array<{ index?: unknown; factual?: unknown; q?: unknown } | null> };
  const j = await deps.judge(model, SYS, user, signal).catch(() => null) as Plan | null;
  if (!j || !Array.isArray(j.items)) return fallback;
  const out = [...fallback];
  for (const it of j.items) {
    const idx = Number(it?.index);
    if (!Number.isInteger(idx) || idx < 1 || idx > claims.length) continue;
    const q = typeof it?.q === 'string' && it.q.trim() ? it.q.trim().slice(0, 40) : out[idx - 1]!.q;
    // 수치가 든 문장은 의견으로 뺄 수 없다 — 반증 가능한 값이다(사실 게이트 isHardClaim 과 같은 원칙).
    const factual = it?.factual === false && !/\d/.test(claims[idx - 1]!) ? false : true;
    out[idx - 1] = { q, factual };
  }
  return out;
}

/**
 * 주장들을 권위 출처 문서와 대조한다. 주장마다 지식백과·농사로·공공기관 웹문서를 찾아 앞의 두 문서를 읽고, 한 번에 판정한다.
 * 실패는 fail-open — 검색·판정이 통째로 안 되면 null(호출부는 아무것도 바꾸지 않는다): 판정 실패를 '확인 못 함'으로 바꾸면
 * 검색이 막힌 날 멀쩡한 문장까지 일괄로 흐려진다.
 */
export async function verifyClaims(opts: {
  model: string; claims: readonly string[]; species: string | null; signal?: AbortSignal;
  deps?: VerifyDeps; maxClaims?: number; docsPerClaim?: number;
}): Promise<VerifyOutcome | null> {
  const deps = opts.deps ?? defaultVerifyDeps;
  const claims = [...new Set(opts.claims.map((c) => c.trim()).filter(Boolean))].slice(0, opts.maxClaims ?? 12);
  const out: VerifyOutcome = { verified: [], contradicted: [], notFound: [], opinion: [], searches: 0, failedSearches: 0, docs: 0 };
  if (!claims.length) return out;

  const plan = await planQueries(deps, opts.model, claims, opts.species, opts.signal);
  const factualIdx = claims.map((_, i) => i).filter((i) => plan[i]!.factual);
  out.opinion = claims.filter((_, i) => !plan[i]!.factual);

  // 1) 주장별 문서 — 지식백과 2 + 농사로 3 + 공공기관 웹문서. 다른 블로그는 버린다. 읽은 문서는 주장끼리 공유(캐시).
  const cache = new Map<string, string | null>();
  const perClaim = new Map<number, Array<{ url: string; title: string; text: string }>>();
  for (const i of factualIdx) {
    const q = plan[i]!.q;
    const hits: WebHit[] = [];
    const run = async (fn: () => Promise<WebHit[]>): Promise<void> => {
      out.searches += 1;
      try { hits.push(...(await fn()).filter((h) => isAuthoritative(h.url))); } catch { out.failedSearches += 1; }
    };
    await run(async () => (await deps.encyc(q, 2, opts.signal)).map((e) => ({ url: e.link, title: e.title, snippet: e.description })));
    await run(() => deps.web(`${q} site:nongsaro.go.kr`, 3, opts.signal));
    await run(() => deps.web(q, 10, opts.signal));
    const focus = [...new Set([...q.split(/\s+/), ...salientTokens(claims[i]!)])].filter((w) => w.length >= 2 && !/\d/.test(w) && (!opts.species || w !== opts.species));
    const docs: Array<{ url: string; title: string; text: string }> = [];
    for (const h of hits) {
      if (docs.length >= (opts.docsPerClaim ?? 2)) break;
      if (docs.some((d) => d.url === h.url)) continue;
      let text = cache.get(h.url);
      if (text === undefined) {
        try { text = await deps.fetchText(h.url, focus, opts.signal); } catch { text = null; }
        cache.set(h.url, text);
      }
      if (text && text.length >= 40) docs.push({ url: h.url, title: h.title, text });
    }
    perClaim.set(i, docs);
  }
  out.docs = [...cache.values()].filter(Boolean).length;
  const anyDocs = [...perClaim.values()].some((d) => d.length);
  if (!anyDocs) {
    if (out.searches > 0 && out.failedSearches >= out.searches) return null;
    out.notFound = factualIdx.map((i) => claims[i]!);
    return out;
  }

  // 2) 판정 — 주장마다 제 문서만 보여 주고, 문서 번호와 그대로 옮긴 인용을 요구한다.
  const blocks = factualIdx.map((i) => {
    const docs = perClaim.get(i) ?? [];
    const d = docs.length ? docs.map((x, k) => `  [${i + 1}-${k + 1}] ${x.title} (${x.url})\n  ${x.text.slice(0, 2500)}`).join('\n') : '  (문서 없음)';
    return `### 주장 ${i + 1}: ${claims[i]}\n${d}`;
  });
  const user = [
    ...blocks,
    [
      '주장마다 그 아래 문서만 보고 판정하라.',
      '- supported: 문서가 주장의 구체 내용(모양·위치·증상·원리·결과)을 **모두** 말한다. 일부만 맞으면 not_found 다. quote 에 그 문서 문장을 **글자 그대로** 옮겨라(요약·의역 금지, 120자 이내). doc 은 "1-2" 꼴.',
      '- contradicted: 문서가 같은 대상에 대해 주장과 **양립할 수 없는** 사실을 분명히 말한다(예: 주장 "봄에 자른다" ↔ 문서 "봄 전정은 피한다"). 주제가 다르거나 다른 측면을 말할 뿐이면 not_found 다. quote 에 그 문서 문장을 그대로 옮겨라.',
      '- not_found: 문서에 같은 사실이 없다. 비슷한 주제만 있으면 not_found 다.',
      '수종 소개 문장(과·속·분포)만으로는 구체 주장을 supported 로 판정하지 마라.',
      'JSON: {"results":[{"index":1,"verdict":"supported|contradicted|not_found","doc":"1-1","quote":"..."}]}',
    ].join('\n'),
  ].join('\n\n');
  let j: { results?: Array<{ index?: unknown; verdict?: unknown; doc?: unknown; quote?: unknown } | null> } | null;
  try { j = await deps.judge(opts.model, SYS, user, opts.signal) as typeof j; } catch { j = null; }
  if (!j || !Array.isArray(j.results)) return null;

  const decided = new Set<number>();
  for (const r of j.results) {
    const idx = Number(r?.index) - 1;
    if (!factualIdx.includes(idx) || decided.has(idx)) continue;
    const claim = claims[idx]!;
    const k = Number(String(r?.doc ?? '').split('-').pop()) - 1;
    const doc = (perClaim.get(idx) ?? [])[k];
    const quote = typeof r?.quote === 'string' ? r.quote : '';
    const verdict = r?.verdict;
    if ((verdict === 'supported' || verdict === 'contradicted') && doc && quoteBacksClaim(claim, quote, doc.text, opts.species)) {
      (verdict === 'supported' ? out.verified : out.contradicted).push({ text: claim, url: doc.url, title: doc.title, quote: squash(quote).slice(0, 160) });
      decided.add(idx);
    }
  }
  out.notFound = factualIdx.filter((i) => !decided.has(i)).map((i) => claims[i]!);
  return out;
}

/** fact_gate.json 에 남기는 사전 확인 기록 — 무엇이 어느 출처로 확인됐고, 무엇을 낮추거나 지웠는지. */
export interface ClaimVerifySummary {
  verified: VerifiedClaim[];
  /** 공식 자료에서 확인 못 해(또는 어긋나) 유보어로 낮추거나 지운 문장(원래 주장 텍스트). */
  repaired: string[];
  /** 확인 못 했지만 수정이 적용되지 않은 문장(문장 위치 못 찾음·제목 구조 보호) — 여전히 근거 미확인 목록에 남는다. */
  kept: string[];
  /** 사실이 아닌 안내·의견 문장 — 손대지 않는다("다음 편에서는…" 예고를 지우면 연재가 끊긴다). 목록에도 남는다. */
  opinion: string[];
  searches: number; failedSearches: number; docs: number;
  checkedTs: string;
}

const h2s = (b: string): number => (b.match(/^#{2,}\s/gm) ?? []).length;

/**
 * 굵은 글씨 되살리기(순수) — 교정 LLM 이 "**물이 부족할 때**는"을 "물이 부족할 때는"으로 돌려준다(시험 2026-10-15, 지시해도 빠짐).
 * 본문에서 굵었던 구절이 고친 문장에 맨글자로 남아 있으면 다시 감싼다.
 */
export function restoreBold(replacement: string, body: string): string {
  let out = replacement;
  for (const m of body.matchAll(/\*\*([^*\n]{2,40})\*\*/g)) {
    const p = m[1]!;
    if (out.includes(`**${p}**`) || !out.includes(p)) continue;
    out = out.replace(p, `**${p}**`);
  }
  return out;
}

/**
 * 확인 못 한 문장 낮추기(2026-10-15 사장님 선택: "낮추기만, 삭제는 어긋날 때만") — 사실 게이트의 repairSentences 와 다르다:
 * 그쪽은 구체 주장을 지우게 하는데, 여기 문장들은 '틀렸다'가 아니라 '공식 자료에 없다'일 뿐이다. 시험(배나무 노목 글)에서
 * 정석인 "세 번에 나눠서 끊어 주세요"가 통째로 지워졌다. 그래서 not_found 는 hedge 만(못 낮추면 그대로 둠), 지우기는
 * 공식 자료와 어긋난 문장(contradicted)에만 허용한다. 굵은 글씨·지시문의 지시는 보존한다.
 */
export async function hedgeUnconfirmed(
  model: string, body: string, notFound: readonly string[], contradicted: readonly VerifiedClaim[], signal?: AbortSignal,
): Promise<{ list: string[]; repairs: SentenceRepair[] } | null> {
  const list = [...notFound, ...contradicted.map((c) => c.text)];
  if (!list.length) return { list, repairs: [] };
  const user = [
    '아래 [본문]의 [문장]들을 고쳐라. 1~' + notFound.length + '번은 공식 자료에서 확인하지 못한 문장이다(틀렸다는 뜻이 아니다). '
      + (contradicted.length ? `${notFound.length + 1}번부터는 공식 자료와 어긋난 문장이다(근거 인용을 함께 준다).` : ''),
    '확인 못 한 문장(hedge만): 단정을 한 단계만 낮춘다 — 핵심 서술어에 "~할 수 있습니다", "~하는 경우가 많습니다", "~하는 편입니다"처럼 붙인다. '
      + '문장 중간 아무 데나 "보통"을 끼우지 마라("성질이 아직 보통 그대로"는 틀린 예). 이미 자연스럽게 낮출 곳이 없으면 action "keep".',
    '지시문("~하세요", "~하지 마세요")은 지시를 바꾸지 마라 — 이유·결과 쪽에만 유보를 붙이고, 이유가 없는 짧은 지시는 "keep".',
    '어긋난 문장: 근거 인용에 맞게 고치거나("hedge" 로 표시하고 고친 문장), 고칠 수 없으면 "delete".',
    '본문에 있던 굵은 글씨(**…**)·기호는 그대로 둔다. 새 사실·수치를 넣지 마라. 문장 길이는 비슷하게.',
    `[본문]\n${body.slice(0, 8000)}`,
    `[문장]\n${list.map((t, i) => `${i + 1}. ${t}${i >= notFound.length ? `  (근거: ${contradicted[i - notFound.length]!.quote})` : ''}`).join('\n')}`,
    'JSON: {"repairs":[{"index":1,"action":"hedge|keep|delete","replacement":"고친 문장(본문 표기 그대로, 마침표 포함) — keep·delete 면 빈 문자열"}]}',
  ].join('\n\n');
  const j = await microJSON<{ repairs?: Array<{ index?: unknown; action?: unknown; replacement?: unknown } | null> }>(
    model, '너는 원예 블로그 교정자다. 지시받은 문장만 최소한으로 고친다.', user, { maxOutputTokens: Math.min(3500, 400 + list.length * 180), signal },
  ).catch(() => null);
  if (!j || !Array.isArray(j.repairs)) return null;
  const out: SentenceRepair[] = [];
  const seen = new Set<number>();
  for (const r of j.repairs) {
    const index = Number(r?.index);
    if (!Number.isInteger(index) || index < 1 || index > list.length || seen.has(index)) continue;
    const action = r?.action;
    const replacement = typeof r?.replacement === 'string' ? r.replacement.trim() : '';
    if (action === 'hedge' && replacement) { out.push({ index, action: 'hedge', replacement }); seen.add(index); }
    else if (action === 'delete' && index > notFound.length) { out.push({ index, action: 'delete', replacement: '' }); seen.add(index); } // 지우기는 어긋난 문장만
  }
  return { list, repairs: out };
}

/**
 * 근거 미확인 처리(2026-10-15 사장님 선택: "확인 못 한 문장은 낮추거나 삭제") — 사실 게이트 결과의 무근거·참고 문장을
 * 공식 자료와 대조해, 확인된 건 목록에서 빼고(출처 기록), 확인 못 한 건 표적 수정(유보어·삭제)한 뒤 목록에서 뺀다.
 * 판정·검색이 통째로 실패하면 null — 아무것도 바꾸지 않는다(fail-open).
 */
export async function resolveUnverifiedClaims<R extends { status: 'pass' | 'hold' | 'error'; unsupported: string[]; contradicted: string[]; unverified?: string[] }>(a: {
  body: string; result: R; species: string | null; model: string;
  signal?: AbortSignal; deps?: VerifyDeps;
  /** 테스트용 — 기본은 hedgeUnconfirmed + applySentenceRepairs. */
  repair?: (body: string, notFound: readonly string[], contradicted: readonly VerifiedClaim[]) => Promise<{ body: string; applied: number; missed: string[] } | null>;
}): Promise<{ body: string; result: R & { claimVerify: ClaimVerifySummary }; note: string } | null> {
  const claims = [...a.result.unsupported, ...(a.result.unverified ?? [])];
  if (!claims.length) return null;
  const o = await verifyClaims({ model: a.model, claims, species: a.species, signal: a.signal, deps: a.deps, maxClaims: 20 });
  if (!o) return null;
  const verified = new Set(o.verified.map((v) => v.text));
  // 낮추기는 '참고(unverified)' 문장만 — 무근거(unsupported)는 수치·시기·약제 같은 hard 주장이라 유보어로 덮으면 사실 게이트의
  // 보류를 우회한다(repairSentences 도 이런 주장은 hedge 금지). 무근거는 공식 자료로 **확인될 때만** 목록에서 빠진다.
  const soft = new Set(a.result.unverified ?? []);
  const notFound = o.notFound.filter((t) => soft.has(t));
  const contradicted = o.contradicted.filter((c) => soft.has(c.text));
  const toRepair = [...new Set([...notFound, ...contradicted.map((c) => c.text)])];
  const repair = a.repair ?? (async (b: string, nf: readonly string[], cd: readonly VerifiedClaim[]) => {
    const h = await hedgeUnconfirmed(a.model, b, nf, cd, a.signal);
    return h ? applySentenceRepairs(b, h.list, h.repairs.map((r) => ({ ...r, replacement: restoreBold(r.replacement, b) }))) : null;
  });
  let body = a.body;
  let repaired: string[] = [];
  if (toRepair.length) {
    const rep = await repair(a.body, notFound, contradicted).catch(() => null);
    // 제목(H2) 구조가 깨지면 버린다 — runFactGateWithRepair 와 같은 보호.
    if (rep && rep.applied > 0 && h2s(rep.body) === h2s(a.body)) {
      body = rep.body;
      const missed = new Set(rep.missed);
      repaired = toRepair.filter((t) => !missed.has(t));
    }
  }
  const done = new Set([...verified, ...repaired]);
  const unsupported = a.result.unsupported.filter((t) => !done.has(t));
  const unverified = (a.result.unverified ?? []).filter((t) => !done.has(t));
  const status = a.result.status === 'hold' && unsupported.length + a.result.contradicted.length === 0 ? 'pass' : a.result.status;
  const summary: ClaimVerifySummary = {
    verified: o.verified, repaired, kept: [...toRepair.filter((t) => !repaired.includes(t)), ...a.result.unsupported.filter((t) => !verified.has(t))], opinion: o.opinion,
    searches: o.searches, failedSearches: o.failedSearches, docs: o.docs, checkedTs: new Date().toISOString(),
  };
  const note = `근거 확인 ${claims.length}문장 — 공식 자료 확인 ${o.verified.length} · 낮춤/고침 ${repaired.length} · 미적용 ${summary.kept.length} · 안내·의견 ${o.opinion.length} (문서 ${o.docs} · 검색 ${o.searches}${o.failedSearches ? `, 실패 ${o.failedSearches}` : ''})`;
  return { body, result: { ...a.result, unsupported, unverified, status, claimVerify: summary }, note };
}
