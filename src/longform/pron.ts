/**
 * 낭독 발음 점수(순수) — 음성 인식 결과가 대본과 얼마나 같은지(0~1).
 * 문장부호·띄어쓰기는 무시하고, 숫자 표기 차이(세 개 ↔ 3개)는 양쪽을 같은 규칙으로 바꿔 벌점이 없게 한다.
 */
const NUM_WORDS: Array<[RegExp, string]> = [
  [/다섯/g, '5'], [/여섯/g, '6'], [/일곱/g, '7'], [/여덟/g, '8'], [/아홉/g, '9'],
  [/하나/g, '1'], [/두/g, '2'], [/세/g, '3'], [/네/g, '4'],
];

function norm(s: string): string {
  let t = s.replace(/[^가-힣0-9]/g, '');
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
