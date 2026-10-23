// 자막 강조 조각(순수) — 숫자·단위와 핵심 용어를 색으로 띄운다.
// 용어는 대본이 정한다(LongformScript.keywords → props.keywords, 2026-10-22). 없으면 시범(겨울 전정) 용어 목록.
export const PILOT_TERMS = ['주지', '원가지', '원줄기', '곁가지', '지륭', '도장지', '교차지', '역행지', '평행지', '대목순', '접목', '휴면기', '꽃눈', '잎눈', '열매 눈', '꽃봉오리', '깍지벌레', '본전정', '수형'];
const NUM = String.raw`\d+(?:~\d+)?\s?(?:mm|cm|m|개|년|도|원|시간|그루|해)?`;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map<string, RegExp>();
function termsRe(terms: readonly string[]): RegExp {
  const key = terms.join('\u0000');
  let re = reCache.get(key);
  if (!re) {
    // 긴 말부터 — '열매 눈'이 '눈'보다 먼저 잡히게.
    const words = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length).map(esc);
    re = new RegExp(`(${[NUM, ...words].join('|')})`, 'g');
    reCache.set(key, re);
  }
  return re;
}

export interface Piece { text: string; hot: boolean }

export function splitKeywords(text: string, terms: readonly string[] = PILOT_TERMS): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(termsRe(terms.length ? terms : PILOT_TERMS))) {
    if (!m[0]) continue;
    if (m.index! > at) out.push({ text: text.slice(at, m.index), hot: false });
    out.push({ text: m[0], hot: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hot: false });
  return out;
}
