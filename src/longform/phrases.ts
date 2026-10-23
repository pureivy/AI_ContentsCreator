/**
 * 롱폼 자막 구절(순수) — 숏폼 splitPhrases 는 14자 상한 안에서 낱말을 채워 넣어 "몰라서, 자르면"처럼
 * 뒷말에 붙어야 할 말이 앞 구절 끝에 걸렸다(사장님 지적 2026-10-19). 롱폼은 문장 → 쉼표 → 연결 어미 순으로
 * 끊고, 길면 가운데에 가까운 연결 어미에서, 없으면 가운데 낱말 경계에서 나눈다. 짧은 조각은 뒤 구절에 붙인다.
 */
/** 한 구절 상한 — 화면에서 두 줄로 고르게 나눠 보여 주므로 넉넉히. 이보다 길면 연결 어미에서만 끊는다. */
const MAX = 24;
const MIN = 6;
/** 연결 어미가 없을 때만 낱말 경계에서 억지로 끊는 상한. */
const HARD_MAX = 32;
const CONNECTIVE = /(?:고|면|서|며|지만|는데|도록|봐|니까|려면|어도|해도)[,]?$/;
/** '~에서'·'~면서' 같은 조사·관용 결합은 끊지 않는다 — '밑동에서 / 뗄 때는', '자르면 / 안 되는'. */
const NOT_CONNECTIVE = /(?:에서|에게서|부터서|다고|라고|가지만|그리고|그러고|창고|절단면|순서)[,]?$/;

const plen = (s: string) => s.replace(/\s/g, '').length;

function splitClause(clause: string): string[] {
  if (plen(clause) <= MAX) return [clause];
  const words = clause.split(' ');
  const total = plen(clause);
  let best = -1, bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(' ');
    const l = plen(left), r = total - l;
    if (l < MIN || r < MIN) continue;
    const mid = Math.abs(l - total / 2);
    // 연결 어미 경계만 쓴다. 꾸미는 말과 꾸밈 받는 말 사이(중심 / 줄기)를 자르지 않기 위해,
    // 낱말 경계 억지 분할은 HARD_MAX 를 넘을 때만 허용한다.
    const prev = words[i - 1]!, next = words[i] ?? '';
    // 붙여 둔 나열이 너무 길면 쉼표 자리도 끊을 수 있는 경계로 본다.
    const conn = (CONNECTIVE.test(prev) && !NOT_CONNECTIVE.test(prev) && !(/면$/.test(prev) && /^안$/.test(next))) || (prev.endsWith(',') && total > HARD_MAX);
    if (!conn && total <= HARD_MAX) continue;
    const score = conn ? mid : mid + total;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) return [clause];
  return [...splitClause(words.slice(0, best).join(' ')), ...splitClause(words.slice(best).join(' '))];
}

export function splitLongPhrases(narration: string): string[] {
  const text = (narration ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    // 쉼표 조각 — 끝 낱말이 서술(연결 어미·종결)이 아니면 명사 나열·동격('매실, 자두,', '부푼 테두리,')이라
    // 뒤 조각에 붙인다. 서술로 끝나는 쉼표('몰라서,')에서만 끊는다.
    const raw = sentence.split(/(?<=,)\s+/);
    const joined: string[] = [];
    let glue = '';
    raw.forEach((r, i) => {
      const t = glue ? `${glue} ${r}` : r;
      const lastWord = r.replace(/,$/, '').split(' ').pop() ?? '';
      const predicate = CONNECTIVE.test(lastWord) || /(?:다|요|죠|만|데|게|면|서|고|며|부터|까지)$/.test(lastWord);
      if (r.endsWith(',') && !predicate && i < raw.length - 1) glue = t;
      else { joined.push(t); glue = ''; }
    });
    if (glue) joined.push(glue);
    const pieces = joined.flatMap(splitClause);
    // 짧은 조각은 뒤 조각에 붙인다(같은 문장 안). 마지막이면 앞에.
    const merged: string[] = [];
    let carry = '';
    for (const p of pieces) {
      const t = carry ? `${carry} ${p}` : p;
      carry = '';
      if (plen(t) < MIN) carry = t;
      else merged.push(t);
    }
    if (carry) {
      if (merged.length) merged[merged.length - 1] = `${merged[merged.length - 1]} ${carry}`;
      else merged.push(carry);
    }
    // 붙여서 상한을 넘으면 다시 나눈다.
    out.push(...merged.flatMap((m) => (plen(m) > MAX ? splitClause(m) : [m])));
  }
  return out;
}

/** 구절별 표시 프레임(순수) — 낭독 구간을 글자 수 비례로 나누고, 마지막 구절은 세그먼트 끝까지 남긴다. */
/** 화면 한 줄 상한(공백 제외) — 넘으면 줄 바꿀 자리를 직접 정한다(화면이 아무 데서나 가르지 않게). */
const LINE = 22;

/** 뒤 낱말을 꾸미는 말 — 이 뒤에서는 줄을 바꾸지 않는다('굵은 / 상처', '새 / 가지', '여섯 / 유형'). */
const NO_BREAK_AFTER = /^(?:굵은|작은|짧은|같은|가는|처진|부푼|통통한|짤막하게|새|곧은|묵은|바랜|올라온|자란|심은|된|진|병든|솟은|멈춘|겹친|파고드는|여섯|전체|두세|이런|모든|다른|굵고|곧게|\d+~?\d*년|나무|가지|어린|회색으로|손가락처럼|부풀기|들어갈)$/;
/** 앞말에 매인 말 — 이 앞에서는 줄을 바꾸지 않는다('곁가지 / 중', '1~3년 / 된', '나무 / 윗부분'). */
const NO_BREAK_BEFORE = /^(?:중|수|수의|전|전까지가|후|때|것|뒤|쯤|끝|끝부분에|유형|윗부분에|된|안|순은|사이가)$/;
/** 조사로 끝나 한 덩어리가 닫히는 자리 — 줄 바꾸기 좋은 곳. */
const PARTICLE_END = /(?:를|을|에|에서|로|으로|와|과|도|에게|까지|부터|처럼|마다|가|이|는|은|만)$/;

/** 두 줄 나누기 — 쉼표 > 연결 어미 > 가운데 낱말 경계 순, 가운데에 가까운 곳. */
export function twoLines(text: string): string {
  if (plen(text) <= LINE) return text;
  const words = text.split(' ');
  const total = plen(text);
  let best = -1, bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const l = plen(words.slice(0, i).join(' '));
    if (l < 5 || total - l < 5) continue;
    const prev = words[i - 1]!, next = words[i]!;
    const rank = NO_BREAK_AFTER.test(prev) || NO_BREAK_BEFORE.test(next) || (/면$/.test(prev) && /^안$/.test(next)) ? 9
      : prev.endsWith(',') ? 0
      : CONNECTIVE.test(prev) && !NOT_CONNECTIVE.test(prev) ? 1
      : PARTICLE_END.test(prev) ? 2 : 3;
    const score = rank * total + Math.abs(l - total / 2);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best < 0 ? text : `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
}

export function longCaptions(narration: string, frames: number, tailFrames: number): Array<{ text: string; startFrame: number; endFrame: number }> {
  const phrases = splitLongPhrases(narration);
  if (!phrases.length || frames < 1) return [];
  const spoken = Math.max(1, frames - tailFrames);
  const w = phrases.map(plen);
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0, start = 0;
  return phrases.map((text, i) => {
    acc += w[i]!;
    const end = i === phrases.length - 1 ? frames : Math.round((spoken * acc) / total);
    const c = { text: twoLines(text), startFrame: start, endFrame: end };
    start = end;
    return c;
  });
}
