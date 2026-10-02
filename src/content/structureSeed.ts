/**
 * 런별 구조 시드(2026-08-27 권고 4 — 골격 다양화).
 *
 * 문제: 작가·기획 프롬프트가 골격을 **자리까지 고정**해 놨다(중심 명제 인용은 "도입 훅 직후", 프레임
 * 체크리스트는 "글당 1곳"). 문구를 아무리 다양화해도 글의 뼈대가 매편 같은 자리에 같은 순서로 서서
 * "같은 사람이 같은 틀로 찍어낸 글" 인상이 남았다(말투 감사 §3).
 *
 * 해법: 런마다 골격을 한 벌 뽑아(시드) 프롬프트에 [이번 글 구조] 로 주입한다. 시드 한 벌은 블로그(도입 유형·
 * 중심 명제 인용 위치·표/체크리스트/예고 온오프)와 파생물(카드 본문 줄 수·해시태그 수·쇼츠 씬 수) 값을
 * 모두 담지만, **한 세트가 같은 시드를 공유하지는 않는다** — 카드·쇼츠 잡은 각자 currentStructureSeed() 로
 * 새로 뽑아 자기 필드만 읽는다. 그래서 블로그 런이 남긴 cardLines·hashtags·shortsScenes 는 읽히지 않는다.
 *
 * 2026-10-02 확장(네이버 2026-07-06 스팸 공지 — "동일·유사 템플릿으로 문장 일부만 바꾼 페이지" 제외·강등 대상):
 * 시드가 도입·인용·표만 돌리는 사이 **제목·도입 공식·소제목**은 매편 같았다(최근 발행 40편 실측: 제목 키워드 맨 앞 40/40·
 * "키워드, 문장" 쉼표형 35/40·질문형 0/40, 소제목 번호 0/202·질문 2/202, 5개 고정 25/40, 대비 시드 런 9/10 이
 * "~라는 말이 많다 → 그런데" 통념 반박 도입). 그래서 제목 형식(titleForm)·소제목 형식(headingStyle)·소제목 수(headings)·
 * 도입 직후 빠른 답(quickAnswer)을 시드에 더하고, 도입에 '답 먼저(answer)'를 넣으면서 대비(contrast)의 몫을 1/4 → 1/9 로 줄였다.
 * 우리 데이터상 제목 꼴(숫자·질문·경고·길이)별 조회수 차이는 없었다 — 목적은 '마법의 제목'이 아니라 템플릿 스팸 위험
 * 회피와, 소제목을 AI 브리핑이 뽑아 갈 수 있는 답 단위로 만드는 것이다. 새 필드는 structure.json 에 함께 남아
 * 형식별 성과 비교의 키가 된다. **구 기록(이 날짜 이전 런)에는 새 필드가 없다** — 그래서 타입에서 선택 필드다.
 *
 * 불변식:
 *  - 선택 블록(표·체크리스트·예고·빠른 답)은 **정확히 2개만** true — 다 켜면 지금과 같은 만능 골격이 되고,
 *    하나만 켜면 글이 앙상해진다. 도입이 'answer'(첫 2~3문장에 답)면 빠른 답 블록은 후보에서 빠진다 — 같은 답을
 *    두 번 하게 되므로. 그 런은 표·체크리스트·예고 중 2개다.
 *  - 통념 반박 공식("~라고들 합니다. 그런데…")은 도입이 'contrast' 인 런에서만 허용한다. 다른 도입 유형의 블록은
 *    그 공식을 명시적으로 금지한다 — 다른 지시(frameAvoid ⑤·priorCoverage 글 유형 목록)가 '통념 반박'을 권해도
 *    도입에서는 쓰지 않는다.
 *  - 예고는 "결론을 다음 편으로 미루기"가 아니다(결론 의무는 보호 자산). 켜져도 '마무리를 완결한 뒤
 *    맨 끝 한 줄' 까지만 허용한다. 이 한 줄과 genreGuide 의 '예고로 닫지 마라' 는 같은 프롬프트에 함께
 *    들어가면 정면 충돌하므로, 예고가 켜진 런에서는 buildGenreGuide(axes, teaser) 가 그 문장을 뺀다
 *    (org.ts — Fix round 2026-08-27). 결론을 미루지 말라는 제약은 위 괄호 문구가 계속 건다.
 *  - 킬스위치 STRUCTURE_VARIETY=off → 새로 '뽑는' 자리(currentStructureSeed/resolveStructureSeed)만
 *    FIXED_STRUCTURE_SEED 고정(종전 동작). 이미 기록된 시드를 '읽는' 승계는 킬스위치와 무관하다.
 */
import { CONFIG } from '../config';
import { readStructureSeed, writeStructureSeed } from '../sessions/digest';

/** 중심 명제 인용(">> " 따옴표)을 놓을 자리. 'none' 이면 이번 글엔 쓰지 않는다. */
export type ThesisQuotePos = 'none' | 'after-hook' | 'mid' | 'before-close';
/** 도입 훅의 유형 — 장면/질문/주장/대비/답 먼저(2026-10-02). */
export type OpenerKind = 'scene' | 'question' | 'claim' | 'contrast' | 'answer';
/** 제목 형식(2026-10-02) — twist=키워드+쉼표+관점 문장(종전 단일 형식)·question·answer=키워드+구체 답·
 *  variant=키워드+자연스러운 하위 주제어 하나(변형 키워드 A/B)·compare=비교·종류. 제목은 포장 단계(naverBlog)가 만든다. */
export type TitleForm = 'twist' | 'question' | 'answer' | 'variant' | 'compare';
/** 소제목 형식(2026-10-02) — sentence=완결 서술문(종전)·numbered=순서 번호·question=질문형·keyword=키워드 변형 명사구. */
export type HeadingStyle = 'sentence' | 'numbered' | 'question' | 'keyword';

export interface StructureSeed {
  thesisQuote: ThesisQuotePos;
  /** 마크다운 비교표를 쓸지. */
  table: boolean;
  /** ">>> " 프레임(마무리 요약·행동 체크리스트 박스)을 쓸지. */
  checklist: boolean;
  /** 마무리 뒤 다음 편 예고 한 줄을 붙일지. */
  teaser: boolean;
  openers: OpenerKind;
  /** 카드뉴스 본문 장 body 줄 수. */
  cardLines: 2 | 3 | 4 | 5;
  /** 카드뉴스 해시태그 개수(10~15). */
  hashtags: number;
  /** 쇼츠 씬 수(4~6) — 2026-09-09부터 쇼츠는 읽지 않는다(항상 CONFIG.shortsScenes). 다이제스트 호환용으로만 남긴다. */
  shortsScenes: 4 | 5 | 6;
  // ── 2026-10-02 추가분 — 구 기록에는 없다(선택 필드). 없으면 그 줄을 지시하지 않는다(개정이 없던 골격을 만들지 않게).
  /** 제목 형식 — 포장 단계 제목 후보 1순위(=발행 제목)에 적용. */
  titleForm?: TitleForm;
  /** 소제목 형식. */
  headingStyle?: HeadingStyle;
  /** H2 소제목 수(3~6, 마무리 포함) — seo.ts 의 'H2 3개 이상' 하한을 지킨다. */
  headings?: 3 | 4 | 5 | 6;
  /** 도입 직후 '빠른 답' 블록(한 줄 답 또는 작은 시기·지역 정리) — 선택 블록 4종 중 하나. */
  quickAnswer?: boolean;
}

const THESIS: readonly ThesisQuotePos[] = ['none', 'after-hook', 'mid', 'before-close'];
/**
 * 도입 유형 추첨 가중치 — 대비(contrast)는 1/9(종전 균등 4택의 1/4). 통념 반박 도입이 "매편 같은 글" 인상의
 * 대표 지문이라 몫을 줄였다. 나머지 넷은 균등(각 2/9).
 */
const OPENER_WEIGHTS: ReadonlyArray<readonly [OpenerKind, number]> = [
  ['scene', 2], ['question', 2], ['claim', 2], ['answer', 2], ['contrast', 1],
];
const TITLE_FORMS: readonly TitleForm[] = ['twist', 'question', 'answer', 'variant', 'compare'];
const HEADING_STYLES: readonly HeadingStyle[] = ['sentence', 'numbered', 'question', 'keyword'];
/** 선택 블록 — 정확히 2개만 켠다(불변식). */
type OptionalBlock = 'table' | 'checklist' | 'teaser' | 'quickAnswer';

/**
 * 킬스위치 off 시의 고정 시드 = 2026-08-27 이전 동작.
 *  - thesisQuote 'after-hook' : 구 문구 "도입 훅 직후가 최적"
 *  - table+checklist true, teaser false : 구 문구는 표·프레임을 권하고 예고는 금지했다("이 글 안에서 완결")
 *  - openers 'question' : 구 문구의 도입 처방("독자의 상황·질문으로 바로 시작한다" — 지금은 이 블록에 위임)
 *  - cardLines 4 / hashtags 12 : 카드 프롬프트에 수치 지시가 없던 자리의 기본값(계획서 지정값)
 *  - shortsScenes 5 : 40초 상한에서 구 계산(min(6, 8, floor(40/8))) 이 내던 실제 값
 */
export const FIXED_STRUCTURE_SEED: StructureSeed = {
  thesisQuote: 'after-hook',
  table: true,
  checklist: true,
  teaser: false,
  openers: 'question',
  cardLines: 4,
  hashtags: 12,
  shortsScenes: 5,
  // 2026-10-02 추가분(titleForm·headingStyle·headings·quickAnswer)은 일부러 넣지 않는다 — 이 시드는 structure.json 에 남고
  // 리비전이 승계한다. off 런 기록에 값이 있으면, 나중에 다시 켠 뒤의 개정이 원 글에 없던 제목 형식·소제목 형식·빠른 답을
  // "유지하라"고 지시한다(초안에 없는 골격 = 재구성 지시). 없으면 structureBlock 이 그 줄을 안 낸다(구 기록과 같은 취급).
};

/** rand() 가 1 을 돌려줘도 인덱스가 넘치지 않게 클램프(테스트 경계값). */
const pick = <T>(arr: readonly T[], r: number): T => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))]!;
const int = (lo: number, hi: number, r: number): number => Math.min(hi, lo + Math.floor(r * (hi - lo + 1)));
/** 가중 추첨 — r∈[0,1]. 경계값 1 도 마지막 항목으로 클램프. */
const pickWeighted = <T>(items: ReadonlyArray<readonly [T, number]>, r: number): T => {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = r * total;
  for (const [v, w] of items) { if (x < w) return v; x -= w; }
  return items[items.length - 1]![0];
};

/** 시드 한 벌을 뽑는다(순수 — rand 주입으로 테스트 가능). */
/**
 * 전방 갭(Fix wave 2026-08-27 소견 7, 기록용) — teaser 가 켜지는 런은 2/3(off 가 균등 3택이라. 2026-10-02 빠른 답
 * 블록이 후보에 들어오며 약 54%)인데,
 * **블로그 예고는 예고 이행 루프가 잡지 않는다**: promiseStore().create 호출부는 cardnews·shorts(그리고
 * 수동 등록)뿐이고 블로그 경로에는 next 수집이 없다. 즉 그 한 줄은 약속으로 기록되지도, 시즌 창에
 * 이행되지도 않는다. 회귀는 아니다 — 금지 지시가 있던 때에도 실측 10/10편이 예고로 닫혔고, 이번 시드는
 * 그 비율을 2/3 로 낮추면서 '결론을 예고로 미루지 마라' 제약을 새로 붙였다.
 * 닫으려면 (a) 블로그 포장 단계에서 마무리 예고 문장을 뽑아 promiseStore().create({sourceKind:'blog'}) 로
 * 등록하거나 (b) 이행 배선이 생길 때까지 teaser 를 상수 false 로 고정한다(선택 블록은 표·체크리스트 2택).
 * (b)는 '선택 블록 중 정확히 2개만 true' 불변식을 다시 써야 하므로 배선(a) 쪽이 자연스럽다.
 */
export function pickStructureSeed(rand: () => number): StructureSeed {
  const thesisQuote = pick(THESIS, rand());
  const openers = pickWeighted(OPENER_WEIGHTS, rand());
  // 선택 블록은 후보에서 '서로 다른 둘'을 뽑는 방식 — 정확히 2개 true 가 구조적으로 보장된다.
  // 도입이 답 먼저면 빠른 답 블록은 후보에서 뺀다(같은 답 두 번). 2026-10-02 전에는 '끌 하나'(3택) 방식이었다.
  const pool: OptionalBlock[] = openers === 'answer'
    ? ['table', 'checklist', 'teaser']
    : ['table', 'checklist', 'teaser', 'quickAnswer'];
  const first = pick(pool, rand());
  const rest = pool.filter((b) => b !== first);
  const on = new Set<OptionalBlock>([first, pick(rest, rand())]);
  return {
    thesisQuote,
    table: on.has('table'),
    checklist: on.has('checklist'),
    teaser: on.has('teaser'),
    openers,
    cardLines: int(2, 5, rand()) as StructureSeed['cardLines'],
    hashtags: int(10, 15, rand()),
    shortsScenes: int(4, 6, rand()) as StructureSeed['shortsScenes'],
    titleForm: pick(TITLE_FORMS, rand()),
    headingStyle: pick(HEADING_STYLES, rand()),
    headings: int(3, 6, rand()) as NonNullable<StructureSeed['headings']>,
    quickAnswer: on.has('quickAnswer'),
  };
}

/** 킬스위치를 본 시드 — off 면 고정 시드 사본(호출부가 변형해도 상수가 오염되지 않게 복사). */
export function currentStructureSeed(rand: () => number = Math.random): StructureSeed {
  return CONFIG.structureVariety ? pickStructureSeed(rand) : { ...FIXED_STRUCTURE_SEED };
}

/**
 * 새 집필 런의 시드 확정 — 뽑아서 sessions/<runId>/structure.json 에 남긴다(리비전이 승계).
 * 영속화 실패는 fail-open(부가 기록 실패로 런이 죽으면 안 된다, 스펙 §8).
 */
export function resolveStructureSeed(runId: string): StructureSeed {
  const seed = currentStructureSeed();
  try { writeStructureSeed(runId, seed); } catch { /* fail-open */ }
  return seed;
}

/**
 * 리비전 런의 시드 — **승계 전용**이다. 물려받을 시드가 없으면(이 기능 이전 런·기록 손상) null 을 돌려준다:
 * 초안에 없는 골격을 새로 뽑아 "유지하라"고 말하면 그건 유지가 아니라 재구성 지시다. 호출부는 null 일 때
 * STRUCTURE_KEEP_BLOCK(있는 그대로 두라)을 넣는다.
 * 승계분은 자기 런에도 남긴다 — 연쇄 리비전이 같은 골격을 물려받는다(브리프·사실 카드와 같은 패턴).
 * 킬스위치는 보지 않는다(Fix round 2026-08-27): STRUCTURE_VARIETY 는 시드를 '뽑는' 동작만 지배한다.
 * off 로 되돌린 뒤 다양화 시드로 쓰인 초안을 개정할 때 고정 시드를 끼워 넣으면, 초안에 없는 표·프레임을
 * "유지하라"고 말하는 셈이라 작가가 없던 구조를 새로 만든다. 기록이 있으면 승계, 없으면 null 이 양쪽 다 옳다.
 */
export function inheritStructureSeed(runId: string, baseRunId?: string): StructureSeed | null {
  const inherited = baseRunId ? readStructureSeed(baseRunId) : null;
  if (!inherited) return null;
  try { writeStructureSeed(runId, inherited); } catch { /* fail-open */ }
  return inherited;
}

/**
 * 골격 '유지' 블록 — 시드를 모르는 자리에 쓴다(승계 실패한 리비전, 지적만 고치는 수정 라운드).
 * BLOG_BODY_GUIDE 가 인용구·프레임·표를 [이번 글 구조] 에 위임하므로, 블록이 아예 없으면 작가는
 * "안 켜졌다"로 읽어 멀쩡한 프레임·표를 걷어낸다 — 그 공백을 이 문장이 막는다.
 */
export const STRUCTURE_KEEP_BLOCK =
  '[이번 글 구조] 이 글의 기존 골격을 그대로 유지한다 — 중심 명제 인용(">> ")·프레임 박스(">>> ")·표는 지금 초안에 있는 대로 두고, 이번 수정에서 새로 넣거나 빼지 마라.';

/** 통념 반박 공식 금지 — contrast 가 아닌 도입 유형에 붙는다(2026-10-02, 40편 중 대비 시드 런 9/10 이 이 꼴). */
const NO_MYTH_PIVOT =
  ' 이번 글은 대비 도입이 아니다 — "~라고들 합니다/~라는 말이 많습니다/흔히 ~로 압니다 → 그런데·하지만·다만" 식 통념-반박 공식으로 열지 마라'
  + '(다른 지시가 \'통념 반박\' 유형을 권해도 도입에서는 쓰지 않는다 — 반박이 필요하면 본문 섹션에서 한다).';

const OPENER_TEXT: Record<OpenerKind, string> = {
  scene: '장면 — 현장에서 눈에 보이는 한 장면(무엇이 어떻게 보이는지)으로 연다.' + NO_MYTH_PIVOT,
  question: '질문 — 독자가 실제로 던지는 질문 한 줄로 열고, 바로 이어 그 답의 방향을 준다.' + NO_MYTH_PIVOT,
  claim: '주장 — 이 글의 관점(무엇을 기준으로 보는지)을 먼저 단정해 놓고 그 근거로 들어간다.' + NO_MYTH_PIVOT,
  answer: '답 먼저 — 첫 2~3문장 안에 검색 질문의 구체적인 답(시기·기간·수치·조건 중 브리프에 근거가 있는 것)을 바로 준다. '
    + '배경·공감 문장으로 뜸 들이지 않는다.' + NO_MYTH_PIVOT,
  contrast: '대비 — 흔한 통념을 먼저 놓고 어긋나는 지점을 짚으며 연다("~라고들 합니다. 그런데…" 꼴은 이 유형에서만 허용).',
};

/** 소제목 형식 지시 — 소제목은 AI 브리핑·검색 스니펫이 답 단위로 뽑아 가는 자리라, 형식이 답을 담게 한다. */
const HEADING_TEXT: Record<HeadingStyle, string> = {
  sentence: '완결 서술문 — 소제목만 읽어도 그 섹션의 답이 보이게 한 문장으로 쓴다',
  numbered: '번호 — "## 1. …", "## 2. …"처럼 읽는 순서 번호를 붙인 짧은 명사구로 쓴다(모든 H2에 연속 번호). '
    + '번호는 읽는 순서 안내일 뿐 "N가지" 쪼개기가 아니다 — 본문·제목에서 "N가지"로 약속하지 마라',
  question: '질문 — 독자가 검색창에 칠 법한 질문으로 쓰고("…언제 하나요?"), 소제목 바로 아래 첫 문장이 그 질문의 답이다',
  keyword: '키워드 구 — 핵심 대상에 하위 주제어(시기·방법·간격·온도·지역·크기 같은 것)를 붙인 명사구로 쓴다'
    + '(예: "○○ 심는 시기", "○○ 지역별 월동 방법"). 하위 주제어는 소제목마다 다르게, 핵심 키워드 정확 표기는 소제목 1곳까지(나머지는 변형)',
};

const THESIS_TEXT: Record<ThesisQuotePos, string> = {
  none: '쓰지 마라(이번 글은 0곳 — 중심 명제는 본문 문장으로 녹인다)',
  'after-hook': '도입 훅 직후에 1곳',
  mid: '본문 중간(가운데 소제목 근처)에 1곳',
  'before-close': '마무리 직전에 1곳',
};

/**
 * 작가 프롬프트에 넣을 [이번 글 구조] 블록. revise 모드는 '이렇게 써라'가 아니라 '이 골격을 유지하라'로
 * 말한다 — 리비전은 잘 쓰인 구조를 보존하는 것이 목적이라, 구성 지시문을 그대로 넣으면 재구성을 부른다.
 */
export function structureBlock(seed: StructureSeed, opts: { revise?: boolean } = {}): string {
  // 페르소나(company.yaml content_lead)의 [도입부 — 첫 3문장 규칙]·"H2 3~5개"·[마무리 — 이웃 전환](예고)이 매 런
  // 시스템 프롬프트로 같은 꼴을 지시한다 — 이 블록이 이번 글에 한해 그보다 우선함을 명시한다(2026-10-02).
  const head = opts.revise
    ? '[이번 글 구조] 이 글의 골격은 아래와 같다 — 개정하면서 이 골격을 유지하고, 요청과 무관한 구조 변경은 하지 마라.'
    : '[이번 글 구조] 이번 글에만 적용되는 골격이다 — 아래대로 쓰고, 꺼진 요소는 넣지 마라(매 글 같은 배치를 피하려는 지시다). '
      + '작가 기본 지침의 도입부 규칙·소제목 개수와 형식·마무리 예고 규칙과 겹치면 이 블록이 우선한다.';
  // 2026-10-02 추가 필드는 구 기록에 없다 — 있을 때만 줄을 낸다(없는 골격을 '유지하라'고 말하면 재구성 지시가 된다).
  const headingLine = seed.headingStyle && HEADING_TEXT[seed.headingStyle]
    ? `- 소제목(## H2): ${seed.headings ? `정확히 ${seed.headings}개(마무리 포함), ` : ''}형식은 ${HEADING_TEXT[seed.headingStyle]}`
    : '';
  const quickLine = typeof seed.quickAnswer === 'boolean'
    ? `- 빠른 답: ${seed.quickAnswer
      ? '넣는다 — 도입 2~3문장 바로 뒤, 첫 소제목 앞에 검색 질문의 답을 한눈에 주는 블록 1곳(한 줄 답, 또는 2~4줄 짧은 목록으로 시기·지역·조건별 답). '
        + (seed.table ? '표가 켜져 있으니 그 표를 이 자리에 둬도 된다(표는 글 전체 1개). ' : '')
        + '브리프에 근거가 있는 값만 쓰고, 이것으로 결론을 대신하지 마라(본문·마무리는 그대로 쓴다)'
      : '넣지 마라 — 도입에서 바로 본문 섹션으로 들어간다'}`
    : '';
  return [
    head,
    `- 도입 유형: ${OPENER_TEXT[seed.openers]}`,
    quickLine,
    headingLine,
    `- 중심 명제 인용(">> " 따옴표): ${THESIS_TEXT[seed.thesisQuote]}`,
    `- 표: ${seed.table ? '넣는다 — 비교·정리·수치 한 곳을 마크다운 표로' : '넣지 마라 — 비교·정리는 문장과 목록으로 푼다'}`,
    `- 체크리스트(">>> " 프레임): ${seed.checklist ? '넣는다 — 마무리 요약·행동 체크리스트 박스 1곳' : '넣지 마라 — 마무리는 문단으로 맺는다'}`,
    `- 예고: ${seed.teaser
      ? '마무리를 완결한 뒤, 맨 끝에 다음 편에서 이어 다룰 것 한 줄만(이 글의 결론을 예고로 미루지 마라)'
      : '넣지 마라 — 이 글 안에서 완결한다'}`,
  ].filter(Boolean).join('\n');
}

/**
 * 제목 형식 지시(2026-10-02) — 포장 단계(naverBlog.packageNaverBlog)가 제목 후보 1순위(=발행 제목)에 건다.
 * 공통 제약: 핵심 키워드 정확 표기 포함(seo.ts '제목에 핵심 키워드 포함'이 includes 판정)·15~40자·본문이 약속하지 않은 것 금지.
 * 키워드·연관어 나열은 어느 형식에서도 금지 — 네이버는 키워드 나열 제목을 저품질로 본다.
 * 예시는 ○○ 자리표시로만 둔다 — 실제 수종 예시 구절은 모델이 그대로 베낀다(2026-09-18 마가목 소제목 사고).
 */
export const TITLE_FORM_TEXT: Record<TitleForm, string> = {
  twist: '관점형 — 핵심 키워드 뒤 쉼표, 이어서 이 글의 관점·이유를 담은 짧은 문장(예: "○○ 가지치기, 잎이 진 뒤로 미루는 이유")',
  question: '질문형 — 독자가 실제로 검색할 법한 질문을 물음표로 끝낸다. 핵심 키워드를 질문 안에 그대로 넣는다(예: "○○ 가지치기, 언제 해야 하나요?"). 답은 제목에 쓰지 않는다',
  answer: '답 먼저형 — 핵심 키워드와 본문의 구체적인 답(시기·기간·수치·조건)을 그대로 담는다(예: "○○ 심는 시기, 남부 △월·중부 △월"). '
    + '본문에 그런 구체 값이 없으면 지어내지 말고 질문형으로 쓴다',
  variant: '정보형 — 핵심 키워드에 자연스러운 하위 주제어 하나를 이어 붙인 담백한 제목(예: "○○ 가지치기 시기와 방법", "○○ 심는 간격과 깊이"). '
    + '하위 주제어는 하나(많아야 "A와 B" 한 쌍)만 — 연관어를 나열하지 말고, 관점·반전 문장을 덧붙이지 않는다',
  compare: '비교·종류형 — 본문이 실제로 견주는 대상·조건(종류·품종·지역·화분과 노지)을 제목에 드러낸다(예: "○○ 화분과 노지, 월동 방법 차이", "○○ 종류별 꽃 피는 시기"). '
    + '본문에 비교가 없으면 정보형(키워드 + 하위 주제어 하나)으로 쓴다',
};
