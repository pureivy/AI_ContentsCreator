/**
 * 낭독 발음 점수(순수) — 음성 인식 결과가 대본과 얼마나 같은지(0~1).
 * 문장부호·띄어쓰기는 무시하고, 숫자 표기 차이(세 개 ↔ 3개)는 양쪽을 같은 규칙으로 바꿔 벌점이 없게 한다.
 * 범위·단위(10~15m ↔ 10에서 15미터)도 낭독 표기(spellNumbersForTts)로 양쪽을 맞춘다(10-25 — 고친 문장이 바꿔 쓰기에 걸리지 않게).
 * 소수점은 '점'으로 남긴다(10-25 — 문장부호로 지워져 1.8m ↔ 18미터가 1.0 이었다).
 *
 * 점수만으로는 못 잡는 오독(10-25) — 숫자·부정 한 글자가 뜻을 뒤집는다("자르면 안 됩니다" ↔ "자르면 됩니다"는 0.9 를 넘는다).
 * meaningMismatch 가 숫자열·부정 낱말을 따로 대조한다(받아쓰기 대조·바꿔 쓰기 기각 두 곳).
 */
import { spellNumbersForTts } from '../voice/audio';

const NUM_WORDS: Array<[RegExp, string]> = [
  [/다섯/g, '5'], [/여섯/g, '6'], [/일곱/g, '7'], [/여덟/g, '8'], [/아홉/g, '9'],
  [/하나/g, '1'], [/두/g, '2'], [/세/g, '3'], [/네/g, '4'],
];

/** 소수점 → '점'(1.8 → 1점8), 천 단위 쉼표 제거(1,000 → 1000) — 문장부호 지우기 전에. */
const keepDecimal = (s: string): string => s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/(\d)\.(?=\d)/g, '$1점').replace(/쩜/g, '점');

function norm(s: string): string {
  let t = keepDecimal(spellNumbersForTts(s)).replace(/[^가-힣0-9]/g, '');
  for (const [re, d] of NUM_WORDS) t = t.replace(re, d);
  return t;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export function heardScore(script: string, heard: string): number {
  const a = norm(script), b = norm(heard);
  const n = Math.max(a.length, b.length);
  return n === 0 ? 1 : 1 - levenshtein(a, b) / n;
}

/** 달 이름(시월·유월·삼월…) → 숫자 — 받아쓰기가 '10월'을 '시월'로 적어도 숫자 대조가 틀렸다고 하지 않게. 앞이 한글이면 안 바꾸고, 뒤는 끝·조사만(이월동 같은 낱말 제외). */
const MONTH_MAP = new Map([['십이', '12'], ['십일', '11'], ['시', '10'], ['유', '6'], ['일', '1'], ['이', '2'], ['삼', '3'], ['사', '4'], ['오', '5'], ['칠', '7'], ['팔', '8'], ['구', '9']]);
const MONTH_RE = new RegExp(`(?<![가-힣])(${[...MONTH_MAP.keys()].join('|')})\\s?월(?=$|[^가-힣]|[에은는도부까의말초중순쯤경])`, 'g');
/** 고유어 수 → 숫자 — 낱말 첫머리이고 뒤에 세는 말이 올 때만(두다·세균·네모를 숫자로 읽지 않게). */
const NATIVE_MAP = new Map([['하나', '1'], ['한', '1'], ['두', '2'], ['세', '3'], ['네', '4'], ['다섯', '5'], ['여섯', '6'], ['일곱', '7'], ['여덟', '8'], ['아홉', '9'], ['열', '10'], ['스무', '20']]);
const NATIVE_RE = new RegExp(`(?<![가-힣])(${[...NATIVE_MAP.keys()].sort((a, b) => b.length - a.length).join('|')})(?=\\s?(?:개|번|곳|그루|가지|해|살|명|시간|달|주|포기|차례|단계|유형|배|쌍|군데|마디|뼘|줄|장|쪽|송이|알|뿌리|손|칸|씩|째)|(?<=하나))`, 'g');

/** 날수·주 낱말(10-25 리뷰 — 열흘 ↔ 10일·일주일 ↔ 1주일이 숫자 불일치로 잡히던 것). */
const DAY_WORDS: Array<[RegExp, string]> = [[/열흘/g, '10일'], [/보름/g, '15일'], [/이틀/g, '2일'], [/사흘/g, '3일'], [/나흘/g, '4일']];
const SINO = new Map([['일', 1], ['이', 2], ['삼', 3], ['사', 4], ['오', 5], ['육', 6], ['륙', 6], ['칠', 7], ['팔', 8], ['구', 9]]);
const SINO_CH = '일이삼사오육륙칠팔구';
/** 이웃한 한자어 수 두 개 + 단위(사오월·이삼년생·오륙 미터) → 범위 — 이웃한 수일 때만(이사월 같은 낱말 제외), 첫 글자 '일'·번·개 는 낱말과 겹쳐 뺀다(일이 번거롭다). */
const SINO_PAIR_RE = new RegExp(`(?<![가-힣])([이삼사오육륙칠팔])([${SINO_CH}])(?=\\s?(?:월|년|일|주|개월|시간|미터|센티|그루|살))`, 'g');
/** 십이 든 한자어 수 + 단위(십 미터·이십 년) — 한 글자 수(이·사)는 낱말과 겹쳐 길이 단위 앞에서만. */
const SINO_TEN_RE = new RegExp(`(?<![가-힣])(?:([${SINO_CH}]?)십([${SINO_CH}]?)(?=\\s?(?:년|일|주|개월|분|초|시간|도|미터|센티|킬로|그램|퍼센트|배|번|그루|개|살|cm|m))|([이삼사오육륙칠팔구])(?=\\s?(?:미터|센티|킬로|퍼센트|개월)))`, 'g');
/** 1천500·1천5백·3만·1만2천(받아쓰기 표기) → 숫자 하나. */
const unitNumber = (m: string): string => {
  let total = 0, sec = 0;
  for (const [, d, u] of m.matchAll(/(\d+)([만천백])?/g)) {
    const n = Number(d);
    if (u === '만') { total += (sec + n) * 10_000; sec = 0; } else sec += n * (u === '천' ? 1000 : u === '백' ? 100 : 1);
  }
  return String(total + sec);
};

/**
 * 숫자열(순수) — 낭독 표기·천 단위 쉼표·달 이름·고유어 수(세 개 → 3)를 맞춘 뒤 숫자 덩어리. 소수는 한 덩어리(0.5 ↔ 5 를 가른다).
 * 10-25 리뷰: 날수 낱말(열흘·보름)·일주일·한자어 범위(사오월·이삼년)·십 단위·천/만 표기(1천500)·받아쓰기 소수점(1점5)도 같은 숫자로.
 */
export function numberTokens(s: string): string[] {
  let t = spellNumbersForTts(s).replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  for (const [re, d] of DAY_WORDS) t = t.replace(re, d);
  t = t.replace(new RegExp(`(?<![가-힣])([${SINO_CH}])주일`, 'g'), (_m, w: string) => `${SINO.get(w)}주일`)
    .replace(SINO_PAIR_RE, (m, a: string, b: string) => (SINO.get(b)! === SINO.get(a)! + 1 ? `${SINO.get(a)}에서 ${SINO.get(b)}` : m))
    .replace(MONTH_RE, (_m, w: string) => `${MONTH_MAP.get(w)}월`)
    .replace(SINO_TEN_RE, (_m, a: string | undefined, b: string | undefined, one: string | undefined) => String(one ? SINO.get(one)! : (a ? SINO.get(a)! : 1) * 10 + (b ? SINO.get(b)! : 0)))
    .replace(NATIVE_RE, (w: string) => NATIVE_MAP.get(w) ?? w)
    .replace(/(\d)\s?[점쩜]\s?(?=\d)/g, '$1.')
    .replace(/\d+(?:[만천백]\d*)+/g, unitNumber);
  return t.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * 부정 낱말 수(순수) — 안·못(띄어 쓴 낱말이거나 되다/하다에 붙은 꼴만 — 안쪽·안전·못(쇠못) 제외), 않·없(어디든), -지 마/말(금지).
 * 띄어쓰기를 봐야 해서 원문 그대로 센다.
 */
const NEG_RE: Array<[string, RegExp]> = [
  ['안', /(?<![가-힣])안(?=\s|$|[돼되됩됐된])/g],
  ['못', /(?<![가-힣])못(?=\s|$|[하해합했한할되돼됩된])/g],
  ['않', /않/g],
  ['없', /없/g],
  ['말', /지\s?(?:마(?:세요|십시오|라|요)|말(?:아|고|라|게|자))/g],
];
export function negationCounts(s: string): Record<string, number> {
  return Object.fromEntries(NEG_RE.map(([k, re]) => [k, (s.match(re) ?? []).length]));
}
/** 띄어쓰기를 지운 글자 수(안·못은 글자 그대로) — 받아쓰기 띄어쓰기 차이(안 심어도 ↔ 안심어도·잘 못 ↔ 잘못·못 자리 ↔ 못자리)를 거른다. */
const RAW_NEG: Record<string, RegExp> = { 안: /안/g, 못: /못/g, 않: /않/g, 없: /없/g, 말: /지(?:마(?:세요|십시오|라|요)|말(?:아|고|라|게|자))/g };
const rawNegCount = (s: string, k: string): number => (s.replace(/\s+/g, '').match(RAW_NEG[k]!) ?? []).length;

/**
 * 뜻이 바뀌었나(순수) — 숫자·부정 대조. 이유 문자열(없으면 null).
 * 숫자: 두 쪽 다 숫자가 있을 때만 숫자열이 달라야 틀린 것 — 받아쓰기가 수를 낱말(열·스물…)로 적으면 한쪽이 비어 점수(편집 거리)가 맡는다.
 * 부정: 종류마다 개수가 다르면 틀린 것 — 띄어쓰기를 지우고 세어도 다를 때만(10-25 리뷰: 같은 글자를 붙여 적은 받아쓰기는 뜻이 같다).
 */
export function meaningMismatch(a: string, b: string): string | null {
  const na = numberTokens(a), nb = numberTokens(b);
  if (na.length && nb.length && [...na].sort().join(',') !== [...nb].sort().join(',')) return `숫자 ${na.join('·')} ↔ ${nb.join('·')}`;
  const ga = negationCounts(a), gb = negationCounts(b);
  const neg = Object.keys(ga).filter((k) => ga[k] !== gb[k] && rawNegCount(a, k) !== rawNegCount(b, k));
  return neg.length ? `부정 ${neg.map((k) => `${k} ${ga[k]}↔${gb[k]}`).join('·')}` : null;
}
