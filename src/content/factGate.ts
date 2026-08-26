/**
 * 사실 게이트(2026-08-26, 사용자 절대 규칙 "지어내거나 거짓을 이야기하면 절대 안됨") — 본문의 검증 가능한
 * 주장을 뽑아 브리프·주입 근거와 대조한다. 감사 실측: 표본 6편 원예 주장 85건 중 54% 무근거·5건 모순,
 * 본문 생성 후 사실을 보는 게이트가 0개였다(구 데이터감사 패스는 8f16a8c 에서 제거).
 * 순수 함수(추출·조립·집계)와 LLM 호출(추출·판정)을 분리한다 — 순수부만 단위 테스트.
 */

export type ClaimKind = 'number' | 'time' | 'species' | 'pest' | 'treatment' | 'law' | 'price' | 'experience' | 'stat' | 'general';
export type ClaimStatus = 'supported' | 'hedged_general' | 'unsupported' | 'contradicted';
export interface FactClaim { text: string; kind: ClaimKind; status: ClaimStatus; evidence?: string }
export interface FactGateResult {
  status: 'pass' | 'hold' | 'error';
  claims: FactClaim[];
  unsupported: string[];
  contradicted: string[];
  repaired: boolean;
  error?: string;
  checkedTs: string;
}
/** piece·카드·쇼츠 레코드에 남기는 요약(claims 제외). */
export interface FactGateInfo { status: 'pass' | 'hold' | 'error'; unsupported: string[]; contradicted: string[]; checkedTs: string }

const KINDS: ReadonlySet<string> = new Set(['number', 'time', 'species', 'pest', 'treatment', 'law', 'price', 'experience', 'stat', 'general']);
const STATUSES: ReadonlySet<string> = new Set(['supported', 'hedged_general', 'unsupported', 'contradicted']);

export function toFactGateInfo(r: FactGateResult): FactGateInfo {
  return { status: r.status, unsupported: r.unsupported, contradicted: r.contradicted, checkedTs: r.checkedTs };
}

/** 마크다운 본문 → 판정 단위 문장. 소제목·목록·표 행은 살리고 [IMAGE:]·코드펜스·표 구분선은 버린다. */
export function splitBodySentences(md: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence || !line) continue;
    if (/^\[IMAGE:/i.test(line)) continue;
    if (/^\|?\s*:?-{3,}/.test(line)) continue; // 표 구분선
    let text = line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').replace(/\*\*/g, '');
    if (text.startsWith('|')) text = text.split('|').map((c) => c.trim()).filter(Boolean).join(' · ');
    for (const s of text.split(/(?<=[.!?…])\s+/)) { const t = s.trim(); if (t) out.push(t); }
  }
  return out;
}

// 단위 뒤에 한글 조사가 바로 붙는다("3cm가", "10호를") — 조사를 막으면 안 된다. 영문자만 막아 '3ml' 이 'm' 으로 잘리지 않게 한다.
const UNIT_RE = /\d+(?:[.,]\d+)?\s*(?:cm|mm|ml|kg|m|g|l|리터|℃|도|%|퍼센트|호|년생|년|주|일|개|회|시간|분|배|그루|장|알)(?![A-Za-z])/i;
const MONTH_RE = /(?:^|[^\d])(?:1[0-2]|[1-9])\s*월|정월|이월|삼월|사월|오월|유월|칠월|팔월|구월|시월|십일월|십이월/;
const YEAR_RE = /(?:19|20)\d{2}\s*년/;
const SOLAR_TERMS = ['입춘', '우수', '경칩', '춘분', '청명', '곡우', '입하', '소만', '망종', '하지', '소서', '대서', '입추', '처서', '백로', '추분', '한로', '상강', '입동', '소설', '대설', '동지', '소한', '대한'];
const SOLAR_RE = new RegExp(SOLAR_TERMS.join('|'));

/** 수치·월·절기·연도가 든 문장(중복 제거, 상한). LLM 추출이 놓쳐도 판정 대상에 강제 포함한다. */
export function numericClaimSentences(md: string, max = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of splitBodySentences(md)) {
    if (!(UNIT_RE.test(s) || MONTH_RE.test(s) || YEAR_RE.test(s) || SOLAR_RE.test(s))) continue;
    if (seen.has(s)) continue;
    seen.add(s); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const CAP = { brief: 12000, critique: 3000, wiki: 6000, injected: 4000, verified: 3000 } as const;
const cut = (s: string | undefined, n: number): string => (s ?? '').trim().slice(0, n);

/** 근거 말뭉치 — 판정기가 출처 종류를 알도록 블록마다 머리말. SERP 제목은 경쟁 블로그 주장이라 넣지 않는다. */
export function buildEvidence(parts: { brief?: string; critiqueText?: string; wikiGrounding?: string; injected?: string; verified?: string }): string {
  const blocks: string[] = [];
  const b = cut(parts.brief, CAP.brief); if (b) blocks.push(`[리서치·SEO 브리프]\n${b}`);
  const c = cut(parts.critiqueText, CAP.critique); if (c) blocks.push(`[검수 의견]\n${c}`);
  const w = cut(parts.wikiGrounding, CAP.wiki); if (w) blocks.push(`[작가에게 주입된 위키 발췌]\n${w}`);
  const i = cut(parts.injected, CAP.injected); if (i) blocks.push(`[주입된 외부 지식(사람이 넣음)]\n${i}`);
  const v = cut(parts.verified, CAP.verified); if (v) blocks.push(`[근거 표기된 지식(verified)]\n${v}`);
  return blocks.join('\n\n');
}

export function gateVerdict(claims: FactClaim[]): Pick<FactGateResult, 'status' | 'unsupported' | 'contradicted'> {
  const unsupported = claims.filter((c) => c.status === 'unsupported').map((c) => c.text);
  const contradicted = claims.filter((c) => c.status === 'contradicted').map((c) => (c.evidence ? `${c.text} ← 근거: ${c.evidence}` : c.text));
  return { status: unsupported.length + contradicted.length > 0 ? 'hold' : 'pass', unsupported, contradicted };
}

/** 작가 수정 라운드 피드백(리비전 task 의 [검토자 수정 요청] 블록). */
export function formatGateFeedback(r: FactGateResult): string {
  const lines = [
    '사실 게이트 검사에서 아래 문장은 [리서치·SEO 브리프]와 제공 근거 자료 어디에도 근거가 없거나 근거와 모순된다.',
    '각 문장을 ①삭제하거나 ②유보어("대개/흔히/보통")를 붙인 일반론으로 낮추거나 ③근거 있는 판단 기준·관찰 방법으로 바꿔라.',
    '**기존 초안과 브리프에 없는 새 사실·수치를 추가하지 마라.** 글의 구조·어조·분량은 유지한다.',
  ];
  if (r.unsupported.length) lines.push('', '[근거 없음]', ...r.unsupported.map((s) => `- ${s}`));
  if (r.contradicted.length) lines.push('', '[근거와 모순]', ...r.contradicted.map((s) => `- ${s}`));
  return lines.join('\n');
}

// LLM 호출부(추출·판정·게이트)는 Task 2 에서 추가한다.
