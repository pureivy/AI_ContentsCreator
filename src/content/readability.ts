/**
 * 읽기 쉬움 검수(2026-10-05 사장님 확정 — 참고 블로그(ok_asis1) 2026-10-03 readability.ts 의 블로그 부분 이식).
 * "처음 읽는 독자가 한 번에 알아듣는가"를 보는 단계.
 *
 * 배경: 작가 지침은 상투어 금지·어미 다양화처럼 '피할 것'은 많이 걸지만, 독자가 알아듣는지는 어디서도 보지 않는다.
 * 참고 블로그에서는 지어낸 비유·문장 의인화·뜻 모를 소제목이 쌓여 "일반적인 한글이 아닌 것 같다"는 지적이 나왔다.
 * 우리 쪽 실측도 같은 결이다 — "1년에 가위를 몇 번 들 수 있는가", "무개화", "첫 식재자들"(brand.ts lexiconGuide 감사),
 * 풀이 없는 원예 용어가 행동 지시 자리에 선 "뿌리분 가장자리에 꽂으세요".
 *
 * 방식: LLM 이 안 읽히는 문장만 골라 일상어 치환안을 내고, 코드가 거른 뒤(본문에 실재·표/인용 줄 제외·키워드 보존)
 * 사실 게이트와 같은 문장 치환기(applySentenceRepairs — 새 수치 금지·원문 유사도 하한)로 적용한다.
 * 사실 게이트보다 먼저 돈다 — 게이트가 사람에게 나가는 최종 문장을 판정해야 하므로(org.ts packageDesignFinalize).
 * 쇼츠 대본 쪽(참고 블로그 SHORTS_READABILITY)은 쇼츠를 따로 분석 중이라 옮기지 않았다(2026-10-05).
 */
import { applySentenceRepairs, introducesNewFacts, diceSimilarity } from './factGate';
import { extractTimingNumbers } from './timingParity';
import { hasKeyword, naturalKeyword } from './keywordForm';

export interface ReadabilityFix { original: string; replacement: string }

const MAX_FIXES = 15;
/** 비유를 풀어 쓰면 글자 겹침이 크게 준다(참고 블로그 실측 "꺼낼 수 없는 카드죠"→"바로 할 수 없는 일이죠" ≈0.3) —
 *  사실 교정 하한(0.4)보다 낮게. 0 이 아닌 이유: 전혀 다른 문장으로 바꿔치기하는 응답은 여전히 막는다. */
export const READABILITY_SIM_FLOOR = 0.2;

export function readabilityPrompt(body: string, audience: string, keyword?: string): string {
  return [
    `[독자] ${audience || '일반 독자'} — 이 글을 처음 읽는 사람이다. 소리 내어 읽었을 때 한 번에 뜻이 들어와야 한다.`,
    '아래 [본문]에서 그 독자가 멈칫하거나 다시 읽어야 하는 문장·소제목만 골라, 같은 뜻의 일상적인 한국어로 고쳐라.',
    '고칠 대상:',
    '① 일상에서 쓰지 않는 비유·조어 — "1년에 가위를 몇 번 들 수 있는가"(일상에선 "1년에 몇 번 전정하는지"), "무개화", "첫 식재자들"(실측).',
    '② 문장·줄·표·사물을 주어로 세운 의인화 — "이 표가 답을 알려 줍니다"→"표를 보면 답이 보입니다". 나무가 물을 끌어올리는 것 같은 실제 생장 서술은 고치지 마라.',
    '③ 다른 뜻으로 먼저 읽히거나 짝이 안 맞는 말 — "동해"(바다로 읽힌다 → "겨울 추위 피해"), "갈립니다"(→ "달라져요"), "판가름·가늠"(→ "확인하다").',
    '④ 처음 나오는데 풀이가 없는 원예 용어가 판단·행동 지시 자리에 선 문장 — "뿌리분 가장자리에 꽂으세요"→"뿌리분(뿌리와 흙이 뭉친 덩어리) 가장자리에 꽂으세요". 용어를 빼지 말고 반 문장 풀이를 붙인다.',
    // 2026-10-05 — 대추나무 초안의 보고서·직역 말투(styleLint 보고서 말투 목록과 같은 말). 대체어를 함께 줘야 낯선 동의어로 새지 않는다.
    '⑤ 논문·보고서 말투가 그대로 들어온 문장 — 독자에게 하는 말로 풀어라. 예: "구간"(시기 뜻 → "시기·때"), "셈법"(→"~하면 됩니다"), '
      + '"그해 심기는 접습니다"(→"올해는 미루세요"), "묘목을 묻는"(→"심는"), "~이어야 뜻이 있습니다"(→"~이어야 제 역할을 합니다"), '
      + '"그 주에 끝내는 쪽으로 움직입니다"(→"그 주 안에 끝내세요"), "감안하고 가세요"(→"알고 심으세요").',
    '⑥ 앞뒤 맥락 없이 튀어나와 무슨 얘기인지 모를 문장.',
    // 2026-10-05 — 대추나무 초안 "…심는시기의 마지막 가을 창입니다"가 이 검수를 그대로 통과했다(창=window 직역, 검색어 꼴 주어).
    '⑦ 영어를 직역한 말 — 기간을 뜻하는 "창"("가을 식재 창입니다"→"가을에 심을 수 있는 때입니다", "마지막 가을 창"→"늦어도 △월까지"), "윈도우", "방향을 가져가다"(→"방향으로 간다").',
    '⑧ 띄어쓰기가 빠진 검색어 꼴이 문장 주어나 "~의" 명사구로 선 문장 — "○○ 심는시기의 마지막 …"→"○○는 … 심을 수 있어요"처럼 바른 띄어쓰기로 풀어 쓴다.',
    // 2026-10-05 — 토막 줄("봄에 심는다면 3월 중순에서 4월 중순이고요.")은 앞 줄과 합쳐야 고쳐지는데 '합치지 마라'가 막았다.
    // 사장님 결정(한 줄에 1~2문장)으로 바로 위 줄과 합치는 것만 허용한다 — 쪼개기·먼 문장 합치기는 계속 금지.
    '⑨ 앞 문장에 붙어야 할 꼬리가 혼자 한 줄인 토막("~이고요.", "~고요.", "~죠." 짧은 줄) — 바로 위 줄과 한 줄로 합친다. '
      + '이때만 original 에 두 줄을 줄바꿈(\\n) 그대로 이어 적고, replacement 는 한 줄(1~2문장)로 쓴다. 굵은 요약 줄(**…**)은 합치지 마라.',
    '규칙: 뜻·사실·수치·품종명·고유명사는 그대로 — 새 사실을 넣지 마라. 문장 길이와 원문의 존댓말 어미 결은 비슷하게. '
      + '고친 문장도 원문처럼 한 줄이다(여러 줄로 쪼개지 마라. 합치기는 ⑨의 바로 위 줄과만). 굵게(**) 표시는 그대로 둔다.',
    keyword ? `핵심 키워드 "${keyword}"가 든 문장은 고쳐도 키워드(대상+주제어)를 남겨라 — 띄어쓰기는 바르게("${naturalKeyword(keyword)}")·조사는 자연스럽게 바꿔도 된다(검색은 띄어쓰기·조사를 가려 읽는다).` : '',
    '표(| 로 시작하는 줄)·인용 프레임(> 로 시작)은 고치지 마라. 이미 자연스러운 문장은 건드리지 마라 — 고칠 게 없으면 빈 목록.',
    // 리뷰(2026-10-05) — "여러 문장을 묶지 말고"가 ⑨(두 줄 합치기)와 정면으로 부딪혔다. 예외를 같은 문장 안에 적는다.
    `original 은 본문에 있는 문장 하나를 글자 그대로(소제목이면 "## " 없이). ⑨ 토막 합치기만 두 줄을 줄바꿈으로 이어 적고, 그 밖에는 여러 문장을 묶지 마라. 최대 ${MAX_FIXES}개.`,
    `[본문]\n${body.slice(0, 9000)}`,
    'JSON 형식: {"fixes":[{"original":"본문 그대로의 문장","replacement":"고친 문장"}]}',
  ].filter(Boolean).join('\n');
}

/** LLM 치환안 거름(순수) — 본문에 실재, 표·인용 줄 아님, 실제 변경, 키워드 보존(띄어쓰기·조사 무시 — keywordForm.hasKeyword). */
export function acceptReadabilityFixes(body: string, raw: unknown, keyword?: string): ReadabilityFix[] {
  if (!Array.isArray(raw)) return [];
  const lines = body.split('\n');
  const out: ReadabilityFix[] = [];
  for (const f of raw) {
    // 소제목 마커는 양쪽에서 뗀다(참고 블로그 실측 2026-10-03: 둘 다 "## "를 달고 와 치환 결과가 "## ## 소제목"이 됐다 —
    // 마커는 치환기가 보존한다).
    const unmark = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/^#{1,6}\s+/, '').replace(/\r\n/g, '\n').trim() : '');
    const original = unmark((f as ReadabilityFix | null)?.original);
    const replacement = unmark((f as ReadabilityFix | null)?.replacement);
    if (!original || !replacement || original === replacement) continue;
    // 두 줄 합치기(⑨, 2026-10-05) — original 이 '\n'으로 이은 인접 두 줄이면 본문에 그대로 있어야 하고, 두 줄 모두
    // 산문(표·인용·소제목·목록 아님)이어야 한다. replacement 는 한 줄. 적용은 applyReadabilityFixes 2차(정확 일치 치환)가 맡는다.
    if (original.includes('\n')) {
      const pair = original.split('\n');
      if (pair.length !== 2 || replacement.includes('\n') || !body.includes(original)) continue;
      if (pair.some((l) => !l.trim() || /^\s*(\||>|#|[-*]\s|\d+[.)]\s|\[IMAGE:)/.test(l))) continue;
      // 굵은 요약 줄(**…**)은 합치지 않는다(리뷰 2026-10-05) — 첫머리 요약이 다음 줄과 섞이면 요약 칸이 깨진다.
      if (pair.some((l) => /^\s*\*\*.*\*\*\s*[.!?…]?\s*$/.test(l))) continue;
    } else {
      const line = lines.find((l) => l.includes(original));
      if (!line || /^\s*(\||>)/.test(line)) continue;
    }
    if (keyword && hasKeyword(original, keyword) && !hasKeyword(replacement, keyword)) continue;
    if (out.some((x) => x.original === original)) continue;
    out.push({ original, replacement });
    if (out.length >= MAX_FIXES) break;
  }
  return out;
}

/** 부정·금지 표지(리뷰 2026-10-05) — 읽기 쉬움 치환은 '같은 뜻 다른 말'만 허용한다. 하한 0.2 에서는
 *  "살충제는 쓰지 않아도 됩니다"→"살충제는 꼭 뿌려야 합니다"처럼 뜻이 뒤집힌 문장도 글자 겹침으로 통과했다.
 *  "말"은 "10월 말"과 겹쳐 활용형(말고·말아·마세요)만 본다. "안"은 띄어 쓴 부정("안 돼요")만 — "안에"는 아니다. */
// 2026-10-05 — "없이"(꽃가루받이 없이도)는 부정이 아니라 '~를 빼고'라 세지 않는다: 대추나무 초안의 단위결실성 문장 고침
// ("꽃가루받이 없이도 열매를 맺는 성질(단위결실성)")이 이 가드에 '부정 표지 변경'으로 막혔다.
const NEGATION_RE = /않|(?<![가-힣])안\s|못|없(?!이)|말고|말아|말라|마세요|마십시오|금지|삼가/g;
/** 필요·당위 표지 — 있고 없음이 바뀌면 권고 강도가 뒤집힌 것이다("~해도 됩니다"↔"꼭 ~해야 합니다"). */
const NECESSITY_RE = /꼭|반드시|필수|필요|[가-힣]야\s*(?:합니다|해요|한다|하죠|돼요|됩니다)/;
/** 월 뒤 시점(초·중순·말 …) — "10월 초"→"시월 말"은 값(10월)은 같아도 시기가 바뀐다. */
const MONTH_PART_RE = /(?:(?:1[0-2]|[1-9])\s*월|정월|십일월|십이월|이월|삼월|사월|오월|유월|칠월|팔월|구월|시월)\s*(초순|상순|중순|하순|초|중|말)?/g;

const digitList = (t: string): string => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).sort().join('|');
const tokenList = (t: string): string => [...new Set(extractTimingNumbers(t))].sort().join('|');
const monthParts = (t: string): string => Array.from(t.matchAll(MONTH_PART_RE), (m) => m[1] ?? '').sort().join('|');

/** 뜻 보존 가드(순수, 리뷰 2026-10-05) — 거부 사유, 통과면 null.
 *  수치·월·단위·절기는 양방향으로 같아야 하고(빠져도 바뀐 것), 부정 표지 개수·필요 표지 유무·월 시점이 같아야 한다. */
export function readabilityGuard(original: string, replacement: string, keyword?: string): string | null {
  if (digitList(original) !== digitList(replacement) || tokenList(original) !== tokenList(replacement)) return '수치·시기 변경';
  if (introducesNewFacts(original, replacement) || introducesNewFacts(replacement, original)) return '수치·시기 변경';
  if (monthParts(original) !== monthParts(replacement)) return '월 시점 변경';
  if ((original.match(NEGATION_RE) ?? []).length !== (replacement.match(NEGATION_RE) ?? []).length) return '부정 표지 변경';
  if (NECESSITY_RE.test(original) !== NECESSITY_RE.test(replacement)) return '필요·금지 극성 변경';
  if (keyword && hasKeyword(original, keyword) && !hasKeyword(replacement, keyword)) return '키워드 누락';
  return null;
}

/** 적용 — 뜻 보존 가드를 먼저 통과한 치환만 사실 게이트 문장 치환기로 적용한다(새 수치 금지·유사도 하한·마커 보존). */
export function applyReadabilityFixes(body: string, fixes: ReadabilityFix[], keyword?: string): { body: string; applied: number; missed: string[] } {
  const missed: string[] = [];
  const safe = fixes.filter((f) => (readabilityGuard(f.original, f.replacement, keyword) ? (missed.push(f.original), false) : true));
  const first = applySentenceRepairs(body, safe.map((f) => f.original),
    safe.map((f, i) => ({ index: i + 1, action: 'judgment' as const, replacement: f.replacement })), READABILITY_SIM_FLOOR);
  // 2차(참고 블로그 실측 13건 중 3건 미적용) — 두 문장을 묶어 보냈거나 인용 뒤라 문장 경계를 못 찾은 경우. 본문에 정확히
  // 한 번 나올 때만 글자 그대로 바꾼다(애매하면 건드리지 않는다). 리뷰(2026-10-05): 1차가 '거부'한 치환(새 사실·유사도 미달)까지
  // 여기서 그대로 적용되던 우회로를 닫았다 — 같은 새 사실 가드·유사도 하한을 다시 건다(문장 위치를 못 찾은 것만 구제).
  let out = first.body;
  let applied = first.applied;
  for (const original of first.missed) {
    const f = safe.find((x) => x.original === original)!;
    const once = out.split(original).length === 2;
    const ok = once && !introducesNewFacts(original, f.replacement) && diceSimilarity(original, f.replacement) >= READABILITY_SIM_FLOOR;
    if (ok) { out = out.replace(original, () => f.replacement); applied++; } else missed.push(original);
  }
  return { body: out, applied, missed };
}
