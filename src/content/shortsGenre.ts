/**
 * 숏폼 기획의 장르 분기 — 순수(2026-09-18 사용자 요청 "숏폼도 블로그처럼 내용 다양화").
 *
 * 숏폼은 주제를 따로 고르지 않는다 — 블로그 조각에서 파생된다. 읽을 거리 축(2026-09-17)이 블로그에 들어오면 숏폼도
 * 이야기 편이 되는데, 기획 지침이 하우투 전용("행동 결론 1개", "방법 한 문장+이유 한 문장", takeaways "조건→답",
 * "원문에서 수치·나열을 뽑아라")이라 전설 글을 받으면 방법 꼴로 눌러 짜거나 어긋난다. 장르별로 그 네 줄만 바꾼다.
 * 훅 규칙·매체 전환·원문 핵심 앵커·화풍 지침은 장르와 무관하니 orchestrator/shorts 에 그대로 둔다.
 *
 * takeaways 는 이야기형에서도 유지한다(뜻만 바꿈) — standaloneIssues 의 '결론 부재' 항목이 결론 카드를 보고 판정하므로,
 * 카드를 빼면 이야기 편마다 그 지적이 나서 수정 라운드 하나를 태운다.
 *
 * 훅 소재(③): 재배 편에도 사실 공급(factSupply)이 이야기 사실을 8건씩 모아 오는데 숏폼은 안 쓰고 있었다. 이야기 사실
 * 최대 3건을 훅·CTA 소재로 준다. 이 사실은 블로그 본문에 없으므로(동백나무 런 실측 8건 중 6건 본문 부재) 정합·시기수치
 * 게이트가 보는 원문에도 같은 줄을 덧붙여야 한다 — loreHookSource 가 그 덧붙임이다.
 */
import { isLoreTopic } from './loreTopic';
import type { SuppliedFact } from './factSupply';

export type ShortsGenre = 'howto' | 'lore';

/** 원본 조각 제목으로 장르를 정한다. enabled=false(SHORTS_LORE=off)면 항상 하우투. */
export function shortsGenreOf(topic: string, enabled = true): ShortsGenre {
  return enabled && isLoreTopic(topic) ? 'lore' : 'howto';
}

export interface GenreGuide {
  /** '결론 의무: …' 한 줄. */
  readonly conclusion: string;
  /** 본문 씬 기본형 구절 — "본문 씬 내레이션은 1~3문장 — " 뒤에 붙는다. */
  readonly bodyForm: string;
  /** 'CTA 씬에는 takeaways 를 채워라 — …' 한 줄. */
  readonly takeaways: string;
  /** '  [먼저 할 일] …' 한 줄(kind 방아쇠 앞). */
  readonly extract: string;
  /** '  본문 씬 중 …' 한 줄(kind 방아쇠 뒤 — 최소 1개 요구 여부는 장르마다 다르다). */
  readonly kindRule: string;
}

const HOWTO: GenreGuide = {
  conclusion: '결론 의무: 구별·진단 소재면 각 갈래에 그것이 대개 무엇을 뜻하는지 한 마디를 붙여라("이건 대개 물 쪽 문제예요" — 통설 수준은 "대개/흔히"를 붙여 단정 가능, 사건 날조와 다르다). 영상 전체에 명시적 판정 또는 행동 결론을 최소 1개 남기고, 결론을 다음 편 예고로 대체하지 마라.',
  bodyForm: '"방법 한 문장+이유 한 문장"이 기본형이다.',
  takeaways: 'CTA 씬에는 takeaways 를 채워라 — 이 영상의 결론("무얼 하라/무얼 골라라")을 "조건 → 답" 쌍 1~3개로 화면에 띄운다(when=시청자가 자기 상황을 알아보는 조건, then=그때의 답, 각 12자 이내). 예: {"when":"허리 높이","then":"회양목"}. 답은 화면이 지고 내레이션은 기준·이유를 말한다(사용자 확정 2026-08-28) — 그러니 내레이션이 수종명·품목명을 일일이 읊지 않아도 되고, takeaways 가 내레이션을 그대로 복창할 필요도 없다. 다만 **답의 근거는 반드시 원문(블로그 초안)에 있어야 한다** — 원문에 없는 답을 화면에 지어 넣지 마라. 화면에만 나가는 만큼 이 항목은 내레이션보다 더 엄격히 원문에 붙어라. 조건별로 답이 갈리는 소재가 아니면 when 에 핵심 상황, then 에 할 일을 넣어라(예: {"when":"심기 전","then":"뿌리부터 확인"}). 결론이 조건과 무관한 단일 행동뿐이면 takeaways 를 생략해도 된다 — 억지로 쪼개지 마라.',
  extract: '  [먼저 할 일] 대본을 쓰기 전에 원문(블로그 초안)에서 수치와 나열을 뽑아라. 원예 글에는 대개 둘 다 있다 — 수치는 간격·깊이·리터·횟수·기간·온도·비율, 나열은 준비물·순서·조건·품종. 뽑은 것이 있으면 그 내용을 담은 본문 씬에 아래 kind 를 붙인다.',
  kindRule: '  본문 씬 중 최소 1개는 반드시 kind 를 갖게 하라 — 본문이 전부 비면 그 영상은 처음부터 끝까지 배경과 자막만으로 흐른다. 다만 원문에 없는 수치·나열을 지어내 채우지는 마라. 지어낼 상황이면 그 씬 대신 다른 본문 씬에 붙일 곳을 찾아라(날조 금지가 최소 1개보다 우선한다).',
};

const LORE: GenreGuide = {
  conclusion: '결론 의무(이야기형): 이 편은 하우투가 아니다 — 재배 방법·행동 지시로 끝내지 마라. 대신 마지막 본문 씬에 이 이야기가 오늘 이 나무를 보는 눈을 어떻게 바꾸는지 한 줄을 남겨라("그래서 서원 마당엔 늘 이 나무가 있었다", "그 꽃말을 알고 보면 지는 모습이 달리 보인다"). 전승·유래는 원문이 말한 만큼만 — "~라고 전한다/~로 알려져 있다"를 붙이고, 원문에 없는 인물·연도·사건을 지어 넣지 마라. 결론을 다음 편 예고로 대체하지 마라. 원문이 추정으로 쓴 문장("~겠죠", "~로 봅니다", "~에서 찾습니다")은 대본·takeaways 에서도 추정으로 두고("~라고 봐요", "~일지도"), 원문이 이유로 명시한 사실을 우선하라 — 추정을 화면 결론으로 굳히지 마라.',
  bodyForm: '"장면·사건 한 문장+그 뜻 한 문장"이 기본형이다. 한 줄기는 시간(옛날→지금) 또는 장소(그 나무가 선 자리→내 마당) 중 하나로 잡고 끝까지 간다.',
  takeaways: 'CTA 씬에는 takeaways 를 채워라 — 이 영상이 남기는 것을 "이름·장면 → 뜻·유래" 쌍 1~3개로 화면에 띄운다(when=이름·장면·물음, then=그 뜻·유래·답, 각 12자 이내). 예: {"when":"동백 꽃말","then":"겸손한 아름다움"}, {"when":"꽃째 지는 이유","then":"꿀샘이 큰 꽃"}. 답은 화면이 지고 내레이션은 사연을 말한다. 답의 근거는 반드시 원문(블로그 초안)에 있어야 한다 — 원문에 없는 뜻·유래를 화면에 지어 넣지 마라.',
  extract: '  [먼저 할 일] 대본을 쓰기 전에 원문(블로그 초안)에서 연도·수령·높이·그루 수 같은 숫자, 인물·지명·다른 이름, 옛 기록·시구를 뽑아라. 이야기 글에는 대개 있다. 뽑은 것이 있으면 그 내용을 담은 본문 씬에 아래 kind 를 붙인다 — 숫자가 요지면 "stat"(수령 500년, 85그루), 이름·전승이 여럿 나열되면 "list", 옛 기록·시구를 원문 문장 그대로 인용할 수 있으면 "quote"(출처는 원문에 적힌 것만).',
  kindRule: '  이야기형은 억지로 kind 를 붙이지 마라 — 연도·수령·그루 수처럼 단위가 있는 숫자만 "stat", 옛 기록·시구를 원문 문장 그대로 인용할 때만 "quote", 이름·전승이 셋 이상 나열될 때만 "list". 해당이 없으면 본문 씬 전부 kind 없이 배경+자막으로 간다(숫자 "1자" 같은 억지 stat 금지 — 실측).',
};

export function genreGuide(genre: ShortsGenre): GenreGuide {
  return genre === 'lore' ? LORE : HOWTO;
}

/** 씬 디자인(이미지 프롬프트) 지침 — 이야기형만 한 줄. 하우투는 빈 문자열(종전 프롬프트 그대로). */
export function genreSceneGuide(genre: ShortsGenre): string {
  if (genre !== 'lore') return '';
  return '이야기형 편(전설·꽃말·유래·역사·명소): 재배 시연(손·가위·삽·화분) 장면이 아니라 그 나무가 선 자리와 풍경을 그려라 — 서원 마당·마을 어귀·군락지·계절 속의 그 나무. 옛 장면은 특정 인물의 얼굴 없이 분위기로. style_preset 은 ink_wash·watercolor·manhwa 중에서 고른다(photorealistic 은 이 편에 쓰지 마라).';
}

/** 사실 공급 결과에서 훅 소재로 쓸 이야기 사실 — 고유(specific) 이야기 사실만, 공백 제거 중복은 하나로, 최대 max 건. */
export function pickLoreHooks(facts: ReadonlyArray<SuppliedFact> | undefined, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of facts ?? []) {
    if (!f || f.kind !== 'lore' || !f.specific) continue;
    const text = String(f.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 160) continue;
    const key = text.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** 정합·시기수치 게이트가 보는 원문에 덧붙이는 줄 — 훅이 이 사실을 말해도 '원문에 없는 사실'로 잡히지 않게. */
export function loreHookSource(hooks: ReadonlyArray<string>): string {
  if (!hooks.length) return '';
  return `[이 나무의 이야기 사실(자동 수집 — 훅 소재)]\n${hooks.map((h) => `- ${h}`).join('\n')}`;
}

/** 작가 프롬프트 블록 — 재배 편에서만 쓴다(이야기형은 원문 자체가 이야기다). */
export function loreHookGuide(hooks: ReadonlyArray<string>): string {
  if (!hooks.length) return '';
  return [
    '[훅 소재 — 이 나무의 이야기 사실(자동 수집, 근거 있음)]',
    ...hooks.map((h, i) => `${i + 1}. ${h}`),
    '훅(씬1) 또는 CTA 한 곳에 이 중 1건을 써도 된다 — 첫 2초의 장면·긴장으로만 쓰고, 본문 씬의 재배 결론을 밀어내지 마라. 그대로 옮기지 말고 한 문장으로 줄이되 사실을 바꾸거나 부풀리지 마라(꽃말·전승은 "~라고 하죠" 정도). 이 편의 주제와 안 어울리면 안 써도 된다.',
  ].join('\n');
}
