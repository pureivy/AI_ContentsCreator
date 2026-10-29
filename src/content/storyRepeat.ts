/**
 * 같은 수종 같은 이야기 판정(2026-10-30 사장님 "조회 많은 수종을 쓰되 이전에 작성된 내용과 다른 이야기를 해야 한다").
 *
 * 왜 따로 두나. 종전 '다른 이야기' 장치는 제목·키워드 글자 유사도(novelty)뿐이었다. 그런데 두뇌가 키워드를 수종명 한 어절로
 * 쓰니(scheduler IDEA_SYSTEM) 같은 수종이면 어떤 각도든 키워드가 같아 '유사'로 밀렸고 — 잘 된 수종일수록 다시 못 나왔다 —
 * 반대로 제목 글자만 다르면 같은 이야기가 통과했다. 실측(블로그 220편 재생, 60일 창): 배나무 가지치기 6주에 4편,
 * 하스카프베리 '두 품종' 3편, 감나무 깍지벌레 3편.
 *
 * 판정: 같은 수종 + 같은 소재(아래 SUBJECTS)를 STORY_WINDOW_DAYS 안에 다시 쓰면 같은 이야기. 수종은 같아도 소재가 다르면 통과다.
 * 보정(같은 220편): 같은 수종 60일 안 82건 중 33건이 걸렸고, 걸린 것 대부분이 위의 진짜 반복이었다. 글자 토큰 겹침
 * 방식은 '아니라·합니다·전에' 같은 말에 걸려 오탐이 많아 버렸다.
 * 소재 사전은 근사다 — 어느 소재에도 안 걸리면 판정하지 않는다(fail-open). 이야기 글(전설·유래)은 재배 소재가 아니라 뺀다.
 */
import { LORE_TOPIC_RE } from './loreTopic';
import { pieceStore } from './pieces';

export const STORY_WINDOW_DAYS = 60;

/** 소재 — 앞에서부터 먼저 걸리는 것(구체적인 것을 앞에). '꽃이'·'자리'처럼 넓은 말은 뒤에 둔다.
 *  리뷰 반영(2026-10-30): '고르'는 '자리 고르는 법'을 품종으로 잘못 잡아 '품종 고르·묘목 고르'로 좁혔고, '한 그루'(심는 법에도
 *  나옴)·'영양'(영양 성분)·'밑동'(밑동 굵기)·'솎'(열매 솎기)은 다른 이야기를 같은 소재로 묶어 뺐거나 좁혔다. */
export const STORY_SUBJECTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['병해충', /깍지벌레|진딧물|응애|벌레|해충|병해|병충|탄저|흰가루|썩음|부란|노균|곰팡이/],
  ['삽목·접목', /삽목|꺾꽂이|꽂기|접목|접붙|대목/],
  ['전정', /전정|가지치기|가지 ?정리|순 ?정리|순지르기|자르|잘라|가지 ?솎/],
  ['월동', /월동|겨울나기|동해|얼기|얼어|보온|밑동 ?덮/],
  ['거름', /거름|비료|시비|퇴비/],
  ['물', /물주기|물 ?주|물 ?간격|관수|과습|배수/],
  ['활착', /활착|몸살/],
  ['결실', /열매가? ?안|열매 안|결실|낙과|수정|꽃가루|자가|두 품종/],
  ['개화', /꽃 ?(안|이 적|색|눈)|개화|꽃이/],
  ['수확', /수확|따는|익는|당도/],
  ['품종·구별', /품종|구별|종류|구분|묘목 ?고르/],
  ['심기·자리', /심기|심는|심을|식재|이식|옮겨|자리|간격|생울타리|울타리/],
  ['화분', /화분|분갈이|베란다|실내/],
  ['단풍·잎', /단풍|물드|잎 ?색|낙엽/],
];

/** 제목의 소재(순수). 이야기 글이거나 어느 소재에도 안 걸리면 undefined. */
export function storySubjectOf(title: string): string | undefined {
  const t = String(title ?? '');
  if (!t.trim() || LORE_TOPIC_RE.test(t)) return undefined;
  return STORY_SUBJECTS.find(([, re]) => re.test(t))?.[0];
}

export interface StoryPrior { title: string; species?: string; ts: string }
export interface StoryRepeat { subject: string; prior: StoryPrior; daysAgo: number }

/** 후보가 같은 수종의 최근 글과 같은 소재인가(순수). 가장 최근 것을 돌려준다. 수종·소재를 모르면 null. */
export function findStoryRepeat(
  cand: { title: string; species?: string }, priors: readonly StoryPrior[], now = Date.now(), windowDays = STORY_WINDOW_DAYS,
): StoryRepeat | null {
  if (!cand.species) return null;
  const subject = storySubjectOf(cand.title);
  if (!subject) return null;
  let best: StoryRepeat | null = null;
  for (const p of priors) {
    if (p.species !== cand.species) continue;
    const at = Date.parse(p.ts);
    if (!Number.isFinite(at)) continue;
    const daysAgo = Math.floor((now - at) / 86_400_000);
    if (daysAgo < 0 || daysAgo >= windowDays) continue;
    if (storySubjectOf(p.title) !== subject) continue;
    if (!best || daysAgo < best.daysAgo) best = { subject, prior: p, daysAgo };
  }
  return best;
}

/** 브랜드 블로그 글 → 비교 대상(순수 아님 — 저장소 읽기). 아이디어·에러로 닫힌 글은 뺀다(로테이션 지도 rotationItems 와 같은 규칙 —
 *  사실 부족으로 한 번도 안 나간 글이 60일 동안 그 소재를 막지 않게). 시각은 발행 시각, 없으면 착수 시각. */
export function collectStoryPriors(slug: string, speciesOf: (text: string) => string | undefined): StoryPrior[] {
  try {
    return pieceStore().list()
      .filter((p) => (p.brand ?? '') === slug && p.stage !== 'idea' && p.stage !== 'error')
      .map((p) => ({ title: p.title, species: speciesOf(`${p.title} ${p.keyword ?? ''}`), ts: p.publishedTs ?? p.createdTs }));
  } catch { return []; }
}
