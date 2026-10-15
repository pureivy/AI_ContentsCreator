/**
 * 블로그 말투·반복·일관성 결정적 린트(순수, 2026-10-05 사장님 지적 — 대추나무 초안 전수 분석).
 *
 * 배경(분석: 휴지통 대추나무 초안 17204dfaf8d3 vs 사람 편집자 고쳐 쓰기):
 *  - 브리프가 소제목·템플릿 문장·키워드 횟수까지 정해 줬고 작가가 그대로 옮겼다("그해 식재는 접습니다" 글자 그대로).
 *  - 근거 없는 주장이 "~라고 봅니다"로 사실 게이트를 통과했다. 사람 상위글은 '봅니다'를 천 자당 0.02회, 우리 글은 1.3회 쓴다.
 *  - 메타·굵은 요약·도입·인용이 같은 답(같은 날짜)을 네 번 되풀이했다.
 *  - "~이고요." 토막 줄, 보고서 말투(구간·셈법·접다·묻다·뜻이 있다·쪽으로 움직이다·가늠).
 *  - 소제목 6개 중 4개에 수종명, "~습니까?" 질문 소제목.
 * 문장 지시만으로는 새므로 결정적으로 잡아 문체 린트 수정 라운드(BLOG_STYLE_LINT, org.ts packageDesignFinalize)에 싣는다.
 * 전량 fail-open — 검출 결과는 수정 라운드 입력일 뿐 발행을 막지 않는다. 범주마다 3건까지만 낸다(한 라운드에 지적이
 * 쏟아지면 작가가 본문을 통째로 다시 써 styleRevisionReject 에 걸리거나 다른 데가 망가진다).
 * 기준값은 휴지통 초안(걸려야 함)·사람 편집자 고쳐 쓰기(걸리면 안 됨)·최근 초안 25편 리플레이로 잡았다.
 */
import { hasKeyword } from './keywordForm';

const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);
/** 강조·인라인 마커를 걷는다(문장 비교용). */
const unmark = (s: string): string => s.replace(/\*\*|[*_`]/g, '').trim();
/** 공백·문장부호를 걷은 비교용 문자열. */
const squash = (s: string): string => s.replace(/[\s.,!?…·:;"'“”‘’()\[\]~\-—]+/g, '');

/** 문자 바이그램 Dice 유사도 — factGate.diceSimilarity 와 같은 정의. 이 모듈을 순수(agent·CONFIG 무의존)로 두려고 따로 둔다. */
function bigrams(s: string): Set<string> {
  const t = squash(s);
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}
function diceSets(A: Set<string>, B: Set<string>): number {
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}
export function dice(a: string, b: string): number { return diceSets(bigrams(a), bigrams(b)); }

type LineKind = 'heading' | 'quote' | 'list' | 'table' | 'bold' | 'prose' | 'blank' | 'other';
interface MdLine { kind: LineKind; text: string; raw: string; beforeFirstH2: boolean }

/** 마크다운 줄 분류. 코드펜스·[IMAGE:]·구분선은 'other'(문장 아님). bold = 줄 전체가 **…** 인 단독 줄. */
function mdLines(md: string): MdLine[] {
  const out: MdLine[] = [];
  let seenH2 = false;
  let inFence = false;
  for (const raw of String(md ?? '').split('\n')) {
    const t = raw.trim();
    if (/^```/.test(t)) { inFence = !inFence; out.push({ kind: 'other', text: '', raw, beforeFirstH2: !seenH2 }); continue; }
    let kind: LineKind;
    let text = t;
    if (inFence) kind = 'other';
    else if (!t) kind = 'blank';
    else if (/^#{1,6}\s/.test(t)) { kind = 'heading'; text = t.replace(/^#{1,6}\s+/, ''); if (/^##\s/.test(t)) seenH2 = true; }
    else if (/^\|/.test(t)) kind = 'table';
    else if (/^>+/.test(t)) { kind = 'quote'; text = t.replace(/^>+\s*/, ''); }
    else if (/^(?:[-*·]\s+|\d+[.)]\s+)/.test(t)) { kind = 'list'; text = t.replace(/^(?:[-*·]\s+|\d+[.)]\s+)/, ''); }
    else if (/^\[IMAGE:/.test(t) || /^(?:-{3,}|\*{3,})$/.test(t)) kind = 'other';
    else if (/^\*\*[^*].*\*\*[.!?…]?$/.test(t) && !/\*\*\s+\S.*\*\*/.test(t.slice(2, -2))) kind = 'bold';
    else kind = 'prose';
    out.push({ kind, text: unmark(text), raw, beforeFirstH2: kind === 'heading' && /^##\s/.test(t) ? false : !seenH2 });
  }
  return out;
}

const splitSents = (t: string): string[] => t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
/** 문장이 되는 줄(산문·굵은 줄·인용·목록)의 문장들. 소제목·표는 뺀다. */
function bodySentences(lines: MdLine[]): string[] {
  return lines.filter((l) => l.kind === 'prose' || l.kind === 'bold' || l.kind === 'quote' || l.kind === 'list')
    .flatMap((l) => splitSents(l.text));
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 브리프 복사(2026-10-05) — 브리프 §7-2 템플릿 "그해 식재는 접습니다"가 본문 `>` 인용에 글자 그대로 들어갔고,
//    "확정 H2(그대로 사용)" 6개 중 3개가 본문 소제목이 됐다. 브리프는 사실·각도만 주는 자료다.
//    자동 수집 사실 절(재배·이야기 사실 조사)은 옮겨 쓰라고 준 사실이라 비교에서 뺀다.
//    기준: 20자 이상 문장이 브리프 문장과 Dice 0.7 이상이면 '복사'. 3문장 이상이거나 소제목이 1개라도 복사면 지적
//    (사람 편집자 고쳐 쓰기는 브리프 서리 문장을 사실로 옮기고도 0~1문장 — 사실 몇 개를 옮기는 건 정상이다).
// ─────────────────────────────────────────────────────────────────────────────
const BRIEF_COPY_SIM = 0.7;
const BRIEF_COPY_MIN_CHARS = 20;
const BRIEF_COPY_MAX_SENTS = 2;
/** 브리프에서 자동 수집 사실 절(이후 전부)을 잘라 낸다 — 작가가 옮겨 쓰도록 준 사실이다. */
const FACT_SUPPLY_HEAD_RE = /^#{1,4}\s*재배·이야기 사실 조사/m;

export function briefCopyIssues(body: string, brief?: string): string[] {
  const src = String(brief ?? '');
  if (!src.trim() || !String(body ?? '').trim()) return [];
  const cut = src.search(FACT_SUPPLY_HEAD_RE);
  const briefText = cut >= 0 ? src.slice(0, cut) : src;
  // 브리프 줄 → 비교 단위: 표 칸·목록 항목·문장. 마크다운·따옴표를 걷는다.
  const units = briefText.split('\n')
    .flatMap((l) => (/^\s*\|/.test(l) ? l.split('|') : [l]))
    .map((l) => unmark(l.replace(/^\s*(?:#{1,6}|>+|[-*·]|\d+[.)])\s*/, '').replace(/[“”"「」]/g, '')))
    .flatMap((l) => [l, ...splitSents(l)])
    .filter((l) => squash(l).length >= 8);
  const unitSets = [...new Set(units)].map((u) => ({ u, g: bigrams(u), q: squash(u) }));
  const lines = mdLines(body);
  const copiedOf = (s: string, floor: number): string | null => {
    const q = squash(s);
    const g = bigrams(s);
    for (const x of unitSets) {
      if (x.q.length >= q.length && x.q.includes(q)) return x.u;
      if (diceSets(g, x.g) >= floor) return x.u;
    }
    return null;
  };
  const copied = bodySentences(lines).filter((s) => squash(s).length >= BRIEF_COPY_MIN_CHARS && copiedOf(s, BRIEF_COPY_SIM));
  const headings = lines.filter((l) => l.kind === 'heading' && squash(l.text).length >= 8 && copiedOf(l.text, 0.8)).map((l) => l.text);
  const issues: string[] = [];
  if (copied.length > BRIEF_COPY_MAX_SENTS) {
    issues.push(`브리프 문장 복사 ${copied.length}문장 — 브리프는 사실 자료다. 문장·예시 문구를 옮기지 말고 사실만 가져와 독자에게 하는 말로 새로 써라: `
      + copied.slice(0, 3).map((s) => `"${clip(s, 50)}"`).join(', '));
  }
  if (headings.length) issues.push(`브리프 소제목 복사 — ${headings.slice(0, 3).map((h) => `"${clip(h, 40)}"`).join(', ')}: 소제목은 독자가 실제로 묻는 말로 새로 써라`);
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 판단 유보 '봅니다/보입니다'(2026-10-05) — 사람 상위글 천 자당 0.02회, 우리 1.3회. 1인칭 주어를 막은 채 판단을
//    '~라고 봅니다'로 돌려 말하던 지문이고, 사실 게이트에서 무근거 주장을 통과시키는 통로였다. 글당 1회까지.
//    1인칭 주어(저는·제가·저라면)는 사장님 결정(2026-10-05)으로 계속 금지 — 함께 잡는다.
// ─────────────────────────────────────────────────────────────────────────────
/** 판단을 감싸는 꼴만 센다 — "~다고/~라고/~(으)로 봅니다", "~게/~처럼/~(으)로/~듯 보입니다".
 *  리뷰(2026-10-05): 종전엔 '봅니다' 전부를 세어 관찰 동작("세 군데를 겹쳐 봅니다", "생김새부터 봅니다", "그늘 안인지 밖인지
 *  봅니다")까지 걸렸다 — 최근 40편 리플레이 36편 발동 중 상당수가 이 꼴이었다. "가지 끝만 보입니다"(눈에 보인다)도 세지 않는다. */
const BOMNIDA_RE = /(?:다고|라고|로|으로)\s*봅니다|(?:게|처럼|로|으로|듯|듯이)\s*보입니다/g;
const FIRST_PERSON_RE = /(?<![가-힣])(?:저는|제가|저라면|저도|저희는|저희가|저희도|저희 [가-힣]+|우리\s*(?:밭|농원|농장|과수원|하우스)[가-힣]*|제 기준|제 생각|제 경험)(?![가-힣])/g;
/** 겪지 않은 경험 주장(2026-10-05 대추나무 리비전 dbb3ea1b6aa6 "경산 밭에서 저희가 직접 해 보며 세운 기준입니다") —
 *  우리에게는 공개된 재배 기록이 없다(org.NO_FABRICATED_EXPERIENCE). "해 보며/해 보니/키워 보니/심어 봤"처럼 겪은 결과를 말하는 꼴만 —
 *  독자에게 권하는 "직접 해 보세요"·"심어 보면"(조건)은 잡지 않는다. */
//  "-아/어 봤자"(해 봤자 소용없다)·"해 보면서 감을 잡으세요"(권유)도 잡지 않게 '봤자'와 '보면서'는 뺀다.
const EXPERIENCE_CLAIM_RE = /(?:해|키워|심어|길러|재배해|옮겨|겪어)\s*(?:보며|보니까|보니|봤(?!자)|본\s*(?:결과|경험|바))/g;

/** '봅니다/보입니다'(판단 뜻) 횟수 — 블로그(글당 1회)·카드뉴스(세트당 1회) 공용. */
export function bomnidaCount(text: string): number { return (String(text ?? '').match(BOMNIDA_RE) ?? []).length; }
/** 1인칭 주어(저는·제가·저라면·저희 밭·우리 밭 …) — 중복 없이. 블로그·카드뉴스 공용. */
export function firstPersonHits(text: string): string[] { return [...new Set(String(text ?? '').match(FIRST_PERSON_RE) ?? [])]; }
/** 겪지 않은 경험 주장("직접 해 보며", "키워 보니") — 중복 없이. 블로그·카드뉴스 공용. */
export function experienceClaimHits(text: string): string[] { return [...new Set(String(text ?? '').match(EXPERIENCE_CLAIM_RE) ?? [])]; }
/** 경험 주장 지적 문구 — 블로그·카드뉴스 공용. */
export const experienceClaimIssue = (hits: string[]): string =>
  `겪지 않은 경험 주장 "${hits.slice(0, 3).join('", "')}" — 우리에게는 공개된 재배 기록이 없다. 겪은 일처럼 쓰지 말고 관찰 방법·일반 사실로 바꿔라("~하면 ~를 확인하세요")`;

export function judgmentHedgeIssues(body: string): string[] {
  const lines = mdLines(body).filter((l) => l.kind !== 'heading' && l.kind !== 'other');
  const text = lines.map((l) => l.text).join('\n');
  const issues: string[] = [];
  const bom = bomnidaCount(text);
  if (bom > 1) {
    const ex = bodySentences(lines).filter((s) => new RegExp(BOMNIDA_RE.source).test(s)).slice(0, 3);
    issues.push(`'봅니다/보입니다' ${bom}회 — 글당 1회까지. 판단은 독자에게 직접 권하거나("~하세요", "~하면 됩니다") 일반 서술("보통 ~입니다")로 쓰고, 근거 없는 주장은 감싸지 말고 빼라: `
      + ex.map((s) => `"${clip(s, 45)}"`).join(', '));
  }
  const fp = firstPersonHits(text);
  if (fp.length) issues.push(`1인칭 주어 "${fp.slice(0, 3).join('", "')}" — 쓰지 않는다(사장님 결정). 주어 없이 권하는 말("~하세요")로 바꿔라`);
  const ex = experienceClaimHits(text);
  if (ex.length) issues.push(experienceClaimIssue(ex));
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 반복(2026-10-05) — 대추나무 초안: "땅이 굳었으면 봄으로" 권고 6회, "10월 하순~11월 초순" 메타·요약·도입 연속,
//    굵은 요약을 도입이 다시 읽어 줌. "요약을 되풀이하지 마라" 문장만 있고 검사기가 없었다.
// ─────────────────────────────────────────────────────────────────────────────
const NEAR_DUP_SIM = 0.42;
const NEAR_DUP_MIN_CHARS = 15;
/** 월+시점 표현("10월 하순", "3월 중순"). 같은 표현이 3번 이상이면 같은 답을 되풀이한 것이다. */
const DATE_EXPR_RE = /(1[0-2]|[1-9])\s*월\s*(초순|상순|중순|하순|초|말)/g;
/** 권고 문장 — 행동을 권하거나 결정을 내리는 종결. */
const RECOMMEND_RE = /(?:세요|마세요|십시오|면 됩니다|면 돼요|게 좋아요|게 좋습니다|게 낫|쪽이 낫|게 안전|이 안전|넘깁니다|넘기세요|미루|기다리|접습니다|접고|끝내)/;
const RECOMMEND_SHARED = 2;
const RECOMMEND_TOPIC_SHARE = 0.12;
/** 내용어 키 — 어절에서 조사를 떼고 앞 두 음절(굳었다면→굳었, 봄으로→봄). 기능어·흔한 부사는 뺀다. */
const PARTICLE_TAIL_RE = /(?:에서는|으로는|에서|으로|까지|부터|에는|이나|이면|라면|이라|은|는|이|가|을|를|에|도|만|로|의|와|과)$/;
const STOP_KEYS = new Set(['그래', '그리', '그런', '이때', '그때', '하지', '있습', '있어', '없습', '없어', '합니', '해요', '하면', '하세', '한번', '다시',
  '이번', '그해', '올해', '정도', '때문', '경우', '먼저', '바로', '아직', '조금', '이미', '모두', '이렇', '그렇', '보세', '주세', '마세', '됩니', '돼요']);
function contentKeys(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.split(/[^가-힣]+/)) {
    if (w.length < 2) continue;
    const root = w.length > 2 ? w.replace(PARTICLE_TAIL_RE, '') : w.replace(/(?<=.)(?:이|가|은|는|을|를|에|도|만|로)$/, '');
    const key = root.slice(0, 2);
    if (!key || STOP_KEYS.has(key)) continue;
    out.add(key);
  }
  return out;
}

export function repetitionIssues(body: string): string[] {
  const lines = mdLines(body);
  const sents = bodySentences(lines).filter((s) => squash(s).length >= NEAR_DUP_MIN_CHARS);
  const issues: string[] = [];
  // a) 거의 같은 문장 쌍
  const sets = sents.map((s) => bigrams(s));
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < sents.length; i++) {
    for (let j = i + 1; j < sents.length; j++) {
      if (diceSets(sets[i]!, sets[j]!) >= NEAR_DUP_SIM) pairs.push([sents[i]!, sents[j]!]);
    }
  }
  // 한 쌍만 0.42~0.5 인 것은 비교 문장("모과나무는 가지에 가시가 없습니다"/"명자나무는 가지에 가시가 있는 편")일 수 있어 넘긴다.
  if (pairs.length >= 2 || pairs.some(([a, b]) => dice(a, b) >= 0.5)) {
    issues.push(`거의 같은 문장 반복 ${pairs.length}쌍 — 한 번만 말하고 나머지는 지우거나 새 정보로 바꿔라: `
      + pairs.slice(0, 2).map(([a, b]) => `"${clip(a, 35)}" ≈ "${clip(b, 35)}"`).join(' / '));
  }
  // b) 같은 날짜 표현 3회 이상 — 표는 뺀다(리뷰 2026-10-05: 비교표는 칸마다 같은 월을 적는 게 정상이다).
  const text = lines.filter((l) => l.kind !== 'heading' && l.kind !== 'table').map((l) => l.text).join('\n');
  const dates = new Map<string, number>();
  for (const m of text.matchAll(DATE_EXPR_RE)) {
    const k = `${m[1]}월 ${m[2]}`;
    dates.set(k, (dates.get(k) ?? 0) + 1);
  }
  const overDates = [...dates].filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]);
  if (overDates.length) {
    issues.push(`같은 날짜 표현 반복 — ${overDates.slice(0, 3).map(([k, n]) => `"${k}" ${n}회`).join(', ')}: 시기는 한 곳에서 분명히 말하고, 다른 곳에서는 "그때", "이 무렵"처럼 받거나 빼라`);
  }
  // c) 같은 권고 3회 이상 — 글자 겹침(Dice)은 말을 바꿔 되풀이한 권고("그해 심기는 접습니다"/"식재는 접고 봄으로 넘깁니다"/
  //    "억지로 묻지 말고 봄까지 기다리는")를 못 잡는다(실측 0.04~0.44). 권고 문장끼리 내용어(조사 뗀 어절 머리)를 2개 이상
  //    나누면 같은 권고로 묶고, 한 묶음이 3문장 이상이면 지적한다.
  //    글 전체에 흔한 내용어(이 글의 소재 — '가지'·'눈' 글의 가지·눈)는 묶음 근거에서 뺀다(실측 오탐: 꽃눈 글 권고 4문장).
  const df = new Map<string, number>();
  for (const s of sents) for (const k of contentKeys(s)) df.set(k, (df.get(k) ?? 0) + 1);
  const topicCap = Math.max(4, sents.length * RECOMMEND_TOPIC_SHARE);
  const recs = sents.filter((s) => RECOMMEND_RE.test(s));
  const keys = recs.map((s) => new Set([...contentKeys(s)].filter((k) => (df.get(k) ?? 0) < topicCap)));
  for (let i = 0; i < recs.length; i++) {
    const group = [i];
    for (let j = 0; j < recs.length; j++) {
      if (j === i) continue;
      let shared = 0;
      for (const k of keys[i]!) if (keys[j]!.has(k)) shared++;
      if (shared >= RECOMMEND_SHARED) group.push(j);
    }
    if (group.length > 2) {
      issues.push(`같은 권고 ${group.length}회 — "${clip(recs[i]!, 45)}" 같은 말이 여러 곳에 있다. 결론 한 곳에서만 권하고 나머지는 지우거나 새 정보로 바꿔라`);
      break;
    }
  }
  // d) 굵은 요약 줄을 첫 도입 덩어리가 되풀이 — 같은 문장이거나 같은 숫자·날짜를 다시 말한다.
  const first = lines.findIndex((l) => l.kind !== 'blank');
  if (first >= 0 && lines[first]!.kind === 'bold') {
    let i = first;
    const summary: string[] = [];
    while (i < lines.length && lines[i]!.kind === 'bold') summary.push(lines[i++]!.text);
    while (i < lines.length && lines[i]!.kind === 'blank') i++;
    const intro: string[] = [];
    while (i < lines.length && (lines[i]!.kind === 'prose' || lines[i]!.kind === 'quote')) intro.push(lines[i++]!.text);
    const nums = (t: string): string[] => [...new Set([...t.matchAll(DATE_EXPR_RE)].map((m) => `${m[1]}월 ${m[2]}`).concat(t.match(/\d+(?:[.,]\d+)?\s*(?:cm|m|%|℃|도|년|그루|개)/g) ?? []))];
    const sumNums = nums(summary.join(' '));
    const introSents = intro.flatMap(splitSents);
    const echoed = introSents.filter((s) => summary.some((m) => dice(m, s) >= 0.5) || nums(s).some((n) => sumNums.includes(n)));
    if (echoed.length) issues.push(`굵은 요약을 도입이 되풀이 — "${clip(echoed[0]!, 45)}": 도입은 요약에 없는 상황·근거로 시작하라`);
  }
  // e) 첫 소제목 앞 인용 블록 — 굵은 요약 + 인용, 또는 인용 2개 이상이면 첫머리가 같은 답으로 쌓인다.
  let quoteBlocks = 0;
  let hasSummary = false;
  for (let i = 0; i < lines.length && lines[i]!.beforeFirstH2; i++) {
    const l = lines[i]!;
    if (l.kind === 'bold') hasSummary = true;
    if (l.kind === 'quote' && (i === 0 || lines[i - 1]!.kind !== 'quote')) quoteBlocks++;
  }
  if (quoteBlocks > 1 || (quoteBlocks && hasSummary)) {
    issues.push(`첫 소제목 앞 인용 ${quoteBlocks}곳${hasSummary ? '(굵은 요약과 함께)' : ''} — 첫머리는 굵은 요약과 도입 한 덩어리까지만. 인용은 본문 섹션으로 옮기거나 빼라`);
  }
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 토막 줄(2026-10-05) — 한 문장 한 줄 규칙과 어미 배합 수량 규칙이 만나 앞 문장에 붙어야 할 꼬리가 혼자 한 줄을 차지했다
//    ("봄에 심는다면 3월 중순에서 4월 중순이고요.", "다섯 그루 심으면 한 그루를 수분수로 두는 셈법이고요.").
//    바로 앞 줄이 같은 덩어리의 산문이고, 이 줄이 '~고요./~죠.' 한 문장뿐인 짧은 줄이면 토막이다.
// ─────────────────────────────────────────────────────────────────────────────
const ORPHAN_GOYO_MAX = 32;
const ORPHAN_JYO_MAX = 15;

export function orphanFragmentIssues(body: string): string[] {
  const lines = mdLines(body);
  const hits: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!;
    const prev = lines[i - 1]!;
    if (l.kind !== 'prose' || prev.kind !== 'prose') continue;
    const sents = splitSents(l.text);
    if (sents.length !== 1) continue;
    const n = squash(l.text).length;
    if ((/고요[.!]?$/.test(l.text) && n <= ORPHAN_GOYO_MAX) || (/죠[.!]?$/.test(l.text) && n <= ORPHAN_JYO_MAX)) hits.push(l.text);
  }
  if (!hits.length) return [];
  return [`토막 줄 ${hits.length}개 — 앞 문장에 붙어야 할 꼬리가 혼자 한 줄이다. 앞 줄과 한 줄에 잇거나(한 줄에 1~2문장) "~이고, ~예요"처럼 한 문장으로 합쳐라: `
    + hits.slice(0, 3).map((s) => `"${clip(s, 40)}"`).join(', ')];
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 보고서 말투·직역어(2026-10-05) — 사람 상위글 18편에 거의 없는 말. 브리프 말투가 옮겨 오거나, 흔한 말을 금지어로
//    막자(priorCoverage 기계 채굴) 우회어로 생겼다. calqueIssues(창·윈도우·가져가다)와 짝이다. 대체 표현을 함께 준다 —
//    "하지 마라"만 주면 또 다른 낯선 동의어로 빠져나간다(분석 6번).
// ─────────────────────────────────────────────────────────────────────────────
const REPORT_SPEAK: ReadonlyArray<{ re: RegExp; label: string; use: string }> = [
  { re: /구간/g, label: '구간', use: '시기·때·무렵' },
  { re: /셈법/g, label: '셈법', use: '"~하면 됩니다"로 풀어 쓰기' },
  // 대체어는 계절을 박지 않는다(리뷰 2026-10-05) — "봄에 심으세요"는 가을 작업·전정 글에 틀린 시기를 심는다.
  { re: /(?:심기|식재|계획|작업|이식|파종|전정|가지치기|올해|그해|올가을|올봄)(?:는|은|를|을|도)?\s*접(?:습니다|어요|고|는다|으세요|어야|었|자)/g, label: '접다(포기)', use: '"올해는 미루세요"' },
  { re: /(?:묘목을|나무를|그루를|억지로)\s*묻(?:는|을|고|으면|습니다|지|어(?!\s*두))/g, label: '묻다(심다)', use: '심다(가식으로 잠시 묻어 두는 것만 "묻어 두다")' },
  // '뜻이 있다'(의미가 있다) 꼴만 — "붉은 열매라는 뜻이에요"(낱말 풀이)는 정상 한국어다(리뷰 2026-10-05 오탐).
  { re: /뜻이\s*있(?:습니다|어요)/g, label: '뜻이 있다', use: '"제 역할을 합니다", "의미가 있어요", 또는 용어를 앞세워 풀이' },
  { re: /쪽으로\s*움직/g, label: '~쪽으로 움직이다', use: '"~하세요", "~하는 게 좋아요"' },
  { re: /(?:는|은|기다리는)\s*쪽이\s*(?:낫|좋|안전|유리)|확률이\s*(?:높|낮)/g, label: '~하는 쪽이 낫다/확률이 높다', use: '근거가 있으면 "~하면 더 잘 삽니다"처럼 직접, 없으면 빼기' },
  { re: /감안하고\s*가/g, label: '감안하고 가다', use: '"~라는 건 알고 심으세요"' },
  { re: /가늠/g, label: '가늠', use: '확인하다·알아보다' },
];

export function reportSpeakIssues(text: string): string[] {
  const src = unmark(String(text ?? ''));
  const found = REPORT_SPEAK.map((r) => ({ ...r, hits: src.match(r.re) ?? [] })).filter((r) => r.hits.length);
  if (!found.length) return [];
  return [`보고서·직역 말투 — ${found.map((r) => `"${r.hits[0]!.trim()}"(${r.label}${r.hits.length > 1 ? ` ${r.hits.length}회` : ''} → ${r.use})`).join(', ')}`];
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 소제목(2026-10-05) — 대추나무 초안 소제목 6개 중 4개에 수종명, 2개에 키워드("대추나무 심는시기"), "~습니까?" 질문.
//    수종명은 소제목 2곳까지, 키워드는 1곳까지, 질문은 "~할까요?/~나요?"로.
// ─────────────────────────────────────────────────────────────────────────────
/** 합쇼체 의문(-ㅂ니까/-습니까)으로 끝나는 제목인가 — "다릅니까?", "봅니까?", "고칩니까?": 니까 앞 음절의 받침이 ㅂ이거나 '습'.
 *  블로그 소제목·카드뉴스 헤드라인 공용. */
export function isStiffQuestion(h: string): boolean {
  const m = /([가-힣])니까\??$/.exec(String(h ?? '').trim());
  if (!m) return false;
  const c = m[1]!.charCodeAt(0) - 0xac00;
  return m[1] === '습' || c % 28 === 17;
}
const GENERIC_HEAD_RE = /^(?:가을|봄|여름|겨울|화분|묘목|정원|마당|텃밭|베란다|실내|노지|나무|과일|유실수|조경수|초보|\d)/;
export function headingIssues(body: string, keyword?: string): string[] {
  const heads = mdLines(body).filter((l) => l.kind === 'heading' && /^##\s/.test(l.raw.trim())).map((l) => l.text);
  if (!heads.length) return [];
  const issues: string[] = [];
  const kw = String(keyword ?? '').trim();
  const species = kw.split(/\s+/)[0] ?? '';
  if (kw) {
    const withKw = heads.filter((h) => hasKeyword(h, kw));
    // 키워드가 수종 이름 한 낱말("블루베리")이면 키워드 1곳 상한은 걸지 않는다 — 수종명 2곳 상한이 맡는다(리뷰 2026-10-05:
    // 같은 소제목 셋이 '키워드 3곳'·'수종명 3곳' 두 번 지적되고, 2곳은 수종 상한으론 정상인데 키워드 상한에 걸렸다).
    const kwIsSpecies = !/\s/.test(kw) && kw === species && species.length >= 2 && !GENERIC_HEAD_RE.test(species);
    if (withKw.length > 1 && !kwIsSpecies) issues.push(`소제목 키워드 ${withKw.length}곳 — 핵심 키워드는 소제목 1곳까지. 나머지는 독자가 실제로 묻는 말로 써라: ${withKw.slice(0, 3).map((h) => `"${clip(h, 30)}"`).join(', ')}`);
    // 키워드 첫 토큰을 수종명으로 본다 — "가을 묘목 심기"처럼 계절·일반어로 시작하는 키워드는 수종 검사를 건너뛴다.
    if (species.length >= 2 && !GENERIC_HEAD_RE.test(species)) {
      const withSp = heads.filter((h) => h.replace(/\s+/g, '').includes(species));
      if (withSp.length > 2) issues.push(`소제목 수종명 "${species}" ${withSp.length}곳 — 2곳까지. 글 전체가 그 나무 이야기라 소제목마다 이름을 붙이지 않아도 된다`);
    }
  }
  const stiff = heads.filter(isStiffQuestion);
  if (stiff.length) issues.push(`딱딱한 질문 소제목 — ${stiff.slice(0, 2).map((h) => `"${clip(h, 30)}"`).join(', ')}: "~할까요?/~나요?"처럼 말하듯 써라`);
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ 일관성(2026-10-05) — 제목 "가을 vs 봄 성공률이 다른 이유"·메타 "마지막 가을 창"이 본문에 없는 주장이었다
//    (본문엔 성공률 비교가 없고, 브리프는 '마지막'을 금지했다). 제목·메타·굵은 요약에 나온 최상급·비교·확률 표현과
//    월+시점 표현은 본문(요약 줄 제외)에도 있어야 한다. 포장(naverBlog — 제목 순서·meta 재시도)과 본문 린트가 함께 쓴다.
// ─────────────────────────────────────────────────────────────────────────────
const CLAIM_TOKEN_RE = /마지막|가장|최고|최적|유일|성공률|생존율|살아남|확률|\bvs\b|\d+\s*가지/gi;

/** text(제목·메타·요약)에만 있고 본문 근거가 없는 주장어·날짜. 빈 배열이면 일관. */
export function unsupportedClaimTokens(text: string, body: string): string[] {
  const t = unmark(String(text ?? ''));
  const b = unmark(String(body ?? '')).replace(/\s+/g, '');
  const out = new Set<string>();
  for (const m of t.match(CLAIM_TOKEN_RE) ?? []) {
    const tok = m.toLowerCase().replace(/\s+/g, '');
    if (!b.toLowerCase().includes(tok)) out.add(m);
  }
  for (const m of t.matchAll(DATE_EXPR_RE)) {
    if (!b.includes(`${m[1]}월${m[2]}`)) out.add(`${m[1]}월 ${m[2]}`);
  }
  return [...out];
}

/** 굵은 요약 줄의 주장이 본문(요약 줄 제외)에 근거가 있는가. */
export function summaryCoherenceIssues(body: string): string[] {
  const lines = mdLines(body);
  const first = lines.findIndex((l) => l.kind !== 'blank');
  if (first < 0 || lines[first]!.kind !== 'bold') return [];
  let i = first;
  const summary: string[] = [];
  while (i < lines.length && lines[i]!.kind === 'bold') summary.push(lines[i++]!.text);
  const rest = lines.slice(i).map((l) => l.text).join('\n');
  const bad = unsupportedClaimTokens(summary.join(' '), rest);
  return bad.length ? [`굵은 요약에만 있는 주장 "${bad.slice(0, 3).join('", "')}" — 요약은 본문 결론과 같은 말이어야 한다. 본문에 근거가 없으면 요약에서 빼라`] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ 이미지 마커 설명(2026-10-05 대추나무 리비전 dbb3ea1b6aa6) — "[IMAGE: 경산 밭 … 2026-10 촬영]", "[IMAGE: … + 촬영 날짜가 확인되는
//    캡션]"처럼 실사진에서만 지킬 수 있는 요구(지명·날짜·촬영·캡션)를 적었다. 생성 이미지는 그걸 지킬 수 없고(디자이너가
//    "경산 밭 배경"을 그대로 옮겼다), 실촬영 자리 설명은 코드가 정한다. 마커에는 장면만 쓴다. 지운 결과는 cleanImageMarkerDesc.
// ─────────────────────────────────────────────────────────────────────────────
/** 실사진 전용 요구 — 촬영·직접 찍은·캡션·날짜(연-월, 월 일). */
const PHOTO_ONLY_RE = /촬영|찍은|찍어|캡션|날짜|\d{4}\s*[-./년]\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일/;
/** 구도 지시(근접 촬영·접사·가까이 찍은)는 생성 이미지도 지킬 수 있는 장면 설명이라 뺀다(최근 40편 리플레이 오탐 3건). */
const CAMERA_SHOT_RE = /(?:근접|접사|클로즈업|확대|탑다운|정면|측면|위에서|가까이)\s*(?:촬영(?:한)?|찍은|사진)/g;
const photoOnly = (t: string): boolean => PHOTO_ONLY_RE.test(t.replace(CAMERA_SHOT_RE, ''));
/** 우리 농장 지칭 — "우리 밭"·"저희 농원"·"농원에서". */
const OWN_PLACE_RE = /(?:우리|저희)\s*(?:밭|농원|농장)|농원/;

/** 마커 설명에서 실사진 전용 요구를 덜어 낸다(순수). 쉼표·가운뎃점·대시·+ 로 나눈 마디 중 그런 마디는 버리고, 지명은 지운다.
 *  남는 게 없으면 '본문 장면'. places = 브랜드 지역 낱말(예: ['경북', '경산'] — 지명 사전 없이 "고추 밭" 같은 장면어까지
 *  지우지 않게 브랜드 지역만 본다). */
export function cleanImageMarkerDesc(desc: string, places: readonly string[] = []): string {
  const placeRe = places.filter((p) => p.length >= 2).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const strip = (t: string): string => {
    let x = t;
    for (const p of placeRe) x = x.replace(new RegExp(`${p}\\s*(?:지역|일대|에서|의)?\\s*`, 'g'), '');
    return x.replace(/\s{2,}/g, ' ').trim();
  };
  const src = String(desc ?? '').trim();
  const parts = src.split(/\s*(?:,|，|—|–|\+|\s-\s)\s*/).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !photoOnly(p) && !OWN_PLACE_RE.test(p));
  if (kept.length === parts.length && strip(src) === src) return src; // 고칠 것 없음 — 구분자까지 그대로
  return kept.map(strip).filter(Boolean).join(', ') || '본문 장면';
}

/** 이미지 마커 설명 린트 — 실사진 전용 요구가 든 마커. */
export function imageMarkerIssues(body: string): string[] {
  const bad = [...String(body ?? '').matchAll(/^\s*\[IMAGE:([^\]]*)\]\s*$/gm)].map((m) => (m[1] ?? '').trim())
    .filter((d) => photoOnly(d) || OWN_PLACE_RE.test(d));
  if (!bad.length) return [];
  return [`이미지 마커에 실사진 전용 요구 ${bad.length}곳 — 생성 이미지는 지명·날짜·촬영·캡션을 지킬 수 없다. 마커에는 장면만 써라: `
    + bad.slice(0, 2).map((d) => `"${clip(d, 40)}"`).join(', ')];
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ AI 티(2026-10-16 사장님 요청 — humanizer 공통 항목을 한글로 옮겨 실측). 기준선은 네이버 2022년 이전 글 52편(생성형 AI 이전).
//    · "X가 아니라 Y" 틀: 우리 블로그 25편 중 72%·천 자당 0.38, 사람 31%·0.12 — 핵심 문장마다 이 틀로 답을 세운다. 한 번은 사람도 쓴다.
//    · em dash(—): 우리 32%(8편, 거의 소제목·목록 이름표 "경쟁 줄기 — …"), 사람 4%.
//    · 과장·홍보 수식어·번역투·셋 나열은 사람보다 적어 잡지 않는다(금지어를 늘리면 우회어가 생긴다 — ⑤ 주석).
// ─────────────────────────────────────────────────────────────────────────────
/** "X가 아니라 Y" 틀 — '뿐(만) 아니라'(첨가)는 다른 뜻이라 뺀다. */
const NOT_BUT_RE = /(?<!뿐\s?만?\s?)아니라(?=\s)/;
export const NOT_BUT_MAX = 1;
export function notButIssues(body: string): string[] {
  const lines = mdLines(body).filter((l) => l.kind !== 'other' && l.kind !== 'table' && l.kind !== 'blank');
  const hits = lines.flatMap((l) => (l.kind === 'heading' ? [l.text] : splitSents(l.text))).filter((s) => NOT_BUT_RE.test(s));
  if (hits.length <= NOT_BUT_MAX) return [];
  return [`"X가 아니라 Y" 틀 ${hits.length}번 — 글 전체에서 ${NOT_BUT_MAX}번까지. 가장 중요한 한 곳만 남기고 나머지는 Y를 바로 말하라`
    + `(예: "기준은 키가 아니라 굵기입니다" → "기준은 줄기 굵기입니다. 키는 덜 중요해요"): ${hits.slice(0, 3).map((s) => `"${clip(s, 40)}"`).join(', ')}`];
}
/** 긴 줄표(—, ―) — 소제목·목록 이름표의 "A — B" 꼴. */
const DASH_RE = /\s[—―]\s?|[—―]/;
export function emDashIssues(body: string): string[] {
  const hits = mdLines(body).filter((l) => l.kind !== 'other' && l.kind !== 'table' && DASH_RE.test(l.text)).map((l) => l.text);
  if (!hits.length) return [];
  return [`긴 줄표(—) ${hits.length}곳 — 쓰지 마라. 소제목은 한 마디로 줄이고, 목록 이름표는 "경쟁 줄기: ~"나 "경쟁 줄기는 ~"처럼, 문장 안이면 쉼표나 두 문장으로: `
    + hits.slice(0, 3).map((s) => `"${clip(s, 40)}"`).join(', ')];
}

/** 블로그 본문 신규 린트 묶음 — styleLint.blogStyleIssues 가 덧붙인다. */
export function blogVoiceIssues(body: string, opts: { keyword?: string; brief?: string } = {}): string[] {
  const src = String(body ?? '');
  if (!src.trim()) return [];
  return [
    ...briefCopyIssues(src, opts.brief),
    ...judgmentHedgeIssues(src),
    ...repetitionIssues(src),
    ...orphanFragmentIssues(src),
    ...reportSpeakIssues(mdLines(src).filter((l) => l.kind !== 'other').map((l) => l.text).join('\n')),
    ...headingIssues(src, opts.keyword),
    ...summaryCoherenceIssues(src),
    ...imageMarkerIssues(src),
    ...notButIssues(src),
    ...emDashIssues(src),
  ];
}
