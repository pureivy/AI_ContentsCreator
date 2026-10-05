/**
 * 핵심 키워드의 '자연스러운 꼴'(2026-10-05 사장님 지적 — 대추나무 초안).
 *
 * 배경: piece.keyword 는 검색어 꼴이다("대추나무 심는시기" — 사람들이 검색창에 붙여 치는 모양). 그런데 파이프라인이
 * 곳곳에서 이 표기를 '띄어쓰기까지 그대로' 요구했고(seo.ts includes 판정·제목 형식·첫머리 굵은 요약·리비전 피드백),
 * 작가는 그걸 맞추려고 검색어를 명사구 주어로 세웠다 — "10월 하순부터 11월 초순이 대추나무 심는시기의 마지막 가을 창입니다".
 * 네이버 검색은 형태소·띄어쓰기를 가려 읽으므로 "대추나무 심는 시기는"이 검색 손실을 만들지 않는다.
 * 그래서 ① 글에는 바른 띄어쓰기 꼴(naturalKeyword)을 쓰게 하고 ② 판정은 띄어쓰기·조사를 무시한다(hasKeyword).
 */

/** 관형형 어미 뒤에 붙어 검색어에서 자주 띄어쓰기가 빠지는 의존·일반 명사. */
const NOUN_AFTER_NEUN = '시기|방법|법|요령|때|곳|이유|순서|간격|기간|시간|정도|팁';
/** '는'이 아닌 ㄴ·ㄹ 받침 관형형(심을·이식할·옮긴) 뒤 — 오탐(계산법·연결법)을 피하려 때·시기만 본다. */
const NOUN_AFTER_NL = new Set(['때', '시기']);
const GLUED_RE = new RegExp(`(?<=[가-힣])([가-힣])(${NOUN_AFTER_NEUN})(?![가-힣])`, 'gu');

/** 한글 음절의 종성이 ㄴ(4) 또는 ㄹ(8)인가. */
function endsNL(ch: string): boolean {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return false;
  const jong = c % 28;
  return jong === 4 || jong === 8;
}

/**
 * 검색어 꼴 → 글에 쓸 꼴(순수·멱등). 관형형 어미 바로 뒤에 붙은 명사를 띄운다:
 * "심는시기"→"심는 시기", "키우는법"→"키우는 법", "고르는방법"→"고르는 방법", "이식할때"→"이식할 때".
 * 그 밖에는 손대지 않는다(형태소 사전이 없어 명사+명사 합성어는 판단하지 않는다).
 */
export function naturalKeyword(kw: string): string {
  const s = String(kw ?? '').trim().replace(/\s+/g, ' ');
  return s.replace(GLUED_RE, (m, adn: string, noun: string) =>
    (adn === '는' || (endsNL(adn) && NOUN_AFTER_NL.has(noun)) ? `${adn} ${noun}` : m));
}

/** 키워드 토큰 사이에 끼어도 되는 조사("대추나무를 심는 시기"). */
const JOIN_PARTICLE = '(?:을|를|이|가|은|는|의|에|도|과|와)?';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 띄어쓰기·굵게/이탤릭 마커를 걷어 낸 비교용 문자열. */
const squash = (s: string): string => String(s ?? '').replace(/[\s*_]+/g, '');

/** 키워드 판정 정규식 — 띄어쓰기 무시(공백을 걷은 문자열에 건다)·토큰 사이 조사 허용. 뒤에 붙는 조사는 부분 일치라 저절로 통과. */
function keywordRegex(kw: string, flags = 'u'): RegExp | null {
  const tokens = naturalKeyword(kw).split(' ').map((t) => t.replace(/[*_]/g, '')).filter(Boolean);
  if (!tokens.length) return null;
  return new RegExp(tokens.map(esc).join(JOIN_PARTICLE), flags);
}

/** 텍스트에 키워드가 (띄어쓰기·조사를 무시하고) 들어 있는가(순수). */
export function hasKeyword(text: string, kw: string): boolean {
  const re = keywordRegex(kw);
  return !!re && re.test(squash(text));
}

/** 키워드 출현 횟수(순수) — hasKeyword 와 같은 관대한 판정. */
export function countKeyword(text: string, kw: string): number {
  const re = keywordRegex(kw, 'gu');
  return re ? (squash(text).match(re) ?? []).length : 0;
}

/**
 * 작가·포장 프롬프트용 키워드 쓰는 법 블록(순수). 키워드가 없으면 빈 문자열.
 * 예시는 ○○ 자리표시로만 둔다 — 실제 수종 예시 구절은 모델이 그대로 베낀다(2026-09-18 마가목 소제목 사고).
 */
export function keywordWritingGuide(kw?: string): string {
  const raw = String(kw ?? '').trim();
  if (!raw) return '';
  const nat = naturalKeyword(raw);
  return `[핵심 키워드 쓰는 법] ${nat !== raw ? `검색어는 "${raw}"이지만 글에는 바른 띄어쓰기로 "${nat}"라고 쓴다. ` : `핵심 키워드: "${nat}". `}`
    // 리뷰(2026-10-05) — 종전 "어순을 바꿔도 된다"(예: "○○는 언제 심나요")는 SEO 판정(hasKeyword — 낱말 순서는 본다)에서 떨어졌다.
    // 제목·첫 문단은 낱말 순서를 지키고 조사만, 그 밖은 어순 변형 허용. 예시는 자리표시(○○·△월)로만 — 구체 날짜는 모델이 베낀다.
    + '제목·첫 문단에는 키워드 낱말 순서를 그대로 지키고 조사만 붙여라("○○를 심는 시기는", "○○ 심는 시기가") — 검색 판정은 띄어쓰기·조사는 가려 읽지만 낱말 순서는 본다. '
    + '그 밖의 본문에서는 어순을 바꿔 자연스럽게 녹여도 된다("○○는 언제 심나요"). '
    + '검색어 꼴을 그대로 문장 주어로 세우거나 "○○ 심는시기의 마지막 …"처럼 "의"로 잇는 명사구로 쓰지 마라 — '
    + '"△월 하순이 ○○ 심는시기의 마지막 가을 창입니다"(X) → "○○는 △월 하순부터 △월 초순까지 심을 수 있어요"(O).';
}
