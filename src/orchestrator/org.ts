/**
 * Org 모드 런 엔진 — CEO → 팀 → 팀원 위계(GEPA org 모드 패리티).
 *
 * 흐름: CEO 분해 → 대기 → 각 팀(team_parallel 병렬) { 팀장 분해 → 배정 → 팀원 작업(concurrency 직렬)
 *       → 팀장 종합 } → CEO 통합. 위계가 안무에 그대로 보이도록 phase 를 단계별로 emit 한다.
 * 이벤트: phase·team_spawned·delegation·team_deliverable 로 오피스 안무를 구동.
 */
import { CONFIG } from '../config';
import { modelForTier } from '../llm/models';
import type { ModelAssignment } from '../llm/models';
import type { EventBus } from '../events/bus';
import { DEFAULT_COMPANY } from '../agents/company';
import type { TeamDef } from '../agents/company';
import { mapLimit } from '../util/semaphore';
import { isAbort } from '../util/abort';
import { asString } from '../util/str';
import { runAgent, microJSON, buildSystemPrompt, findTemplateNumbers } from './agent';
import { personaPrompt } from '../content/personas';
import { prepareRun } from './prepare';
import { finalizeRun } from './finalize';
import { formatterFor } from '../output';
import type { AssetBundle } from '../output';
import { parseImagePlan, draftFiles } from '../output/naverBlog';
import { naverSerp } from '../grounding/naver_search';
import { seedKeyword } from '../grounding/naver_common';
import { getRunSettings } from '../runsettings';
import { brandContext, activeBrandSlug, getBrand, lexiconGuide } from '../content/brand';
import { priorCoverageBrief, recentStyleToAvoid, recentPhrasesToAvoid } from '../content/priorCoverage';
import { collectExistingContent } from '../content/novelty';
import type { RunOptions, RunOutcome } from './run';

interface TeamResult {
  team: TeamDef;
  deliverable: string;
  /** 자가학습(reflect) roster 매칭용 — 팀 id 가 아니라 실제 참여 역할(팀원+팀장) 단위 산출물. */
  participants: Array<{ id: string; name: string; text: string }>;
}

/**
 * 판매처 문의 프레임 금지(사용자 지시 2026-08-01 "판매처에 물어볼 답변은 필요 없는데").
 * 블로그 본문과 파생 콘텐츠(카드뉴스·쇼츠)가 공유한다.
 *
 * 파생에도 거는 이유는 **예방**이지 실측된 누출이 아니다 — 정확히 해둔다.
 * 신비복숭아 카드뉴스(2장·8장이 "판매처에 물어보세요")를 근거로 삼았었는데, 그건 08-01 10:14
 * 생성으로 블로그 가드(같은 날 19:01, 9f8d370)보다 앞선다. 게다가 planCards 는 sourceBody(원문 본문)를
 * 받아 재구성하므로 그 문구는 당시 원문을 상속한 것이지 기획자가 독립 생성한 것이 아니다.
 * 그럼에도 파생에 거는 근거는 둘: (1) 가드가 구조상 org.ts 작가에만 닿아 파생 기획자에는 없었다,
 * (2) 파생 기획자는 원문에 없는 '마무리 장'을 스스로 쓰므로 거기서 구매 체크리스트로 닫을 여지가 남는다.
 * 원문이 깨끗해지면 파생도 대체로 깨끗해질 것이라, 실효는 앞으로 몇 편으로만 확인된다.
 */
export const SELLER_INQUIRY_BAN =
  '[판매처 문의 프레임 금지] "판매처에 물어보세요"·"이렇게 질문하세요"·"이런 답이 오면 통과" 같은 문의 안내를 '
  + '내용의 뼈대나 한 꼭지(섹션·슬라이드·장면)로 삼지 마라(사용자 지시 2026-08-01 — 그런 내용은 필요 없다). '
  + '독자가 알고 싶은 것은 우리가 아는 답이다. 우리가 아는 범위에서 판단 기준·관찰 방법·대안을 직접 제시하고, '
  + '정말 개체마다 달라 단정할 수 없는 항목이면 한 문장으로만 언급하고 넘어가라. '
  + '특히 마지막 꼭지를 "구매 전 물어볼 것" 체크리스트로 닫지 마라.';

/**
 * 지어낸 경험 금지(사용자 확정 2026-08-02). 블로그·카드뉴스·쇼츠 공용.
 *
 * 배경: '[근거와 목소리] … 직접 겪고 확인한 것을 근거로 써라 — 언제 무엇이 어떻게 됐는지 구체적으로'
 * 라는 지침을 넣었는데(판매처로 판단을 떠넘기던 문제 대응), **브랜드에 실경험 기록이 하나도 없다**
 * (brand.products=[], 위키 748장에 재배 실측 없음). 데이터 없이 구체성을 요구하면 모델은 지어낸다.
 * 실측 2026-08-02, 최근 12편 중 2편:
 *   "지난해 우리 밭 어린 단감나무도 사흘 사이 스무 개 넘게 떨궜습니다"  ← 밭 관찰 날조
 *   "저희 밭에서도 문의가 오면 …라고 답합니다"                        ← 영업 실태 날조
 *
 * 다만 1인칭을 통째로 막으면 판단을 외부로 떠넘기는 문제(실측 5→32회)가 재발한다.
 * 그래서 **관점은 살리고 사건만 죽인다** — 아래 문구가 그 경계를 명시한다.
 */
export const NO_FABRICATED_EXPERIENCE =
  '[겪지 않은 일을 지어내지 마라] 우리에게는 공개된 재배 기록이 없다. '
  + '**실제로 있었던 일처럼 쓰는 구체 서술을 만들어내지 마라** — 연도·시기("지난해", "재작년"), 기간("사흘 사이"), '
  + '수량("스무 개 넘게"), 특정 개체의 결과, 우리 밭·농장·포장에서 관찰했다는 진술, '
  + '"문의가 오면 이렇게 답한다" 같은 영업 실태 서술이 여기 해당한다. 브랜드명을 본문에서 자기 지칭으로 끌어들이지도 마라.\n'
  + '대신 **1인칭 판단과 관점은 그대로 유지하라** — "이럴 땐 자리부터 정합니다", "굵기보다 잔뿌리를 봅니다", '
  + '"이 경우는 이렇게 봅니다"처럼 우리가 무엇을 어떻게 판단하는지는 단정해서 써라. '
  + '판단을 판매처·기관·독자에게 떠넘기지 말고, 일반적으로 성립하는 사실과 관찰 방법으로 직접 답하라. '
  + '요컨대 **목소리는 우리 것으로, 사건은 지어내지 않는다.**';

// 네이버 블로그(정보/하우투·리뷰) 본문 작성 지침 — 합성(작가 단독 집필) 단계 task 에 덧붙인다.
// 작가(content_lead)는 자신의 페르소나(systemPrompt)로 글을 쓰고, 이 지침이 구조·SEO·분량을 고정한다.
const BLOG_BODY_GUIDE =
  '너는 지금 최종 발행용 블로그 본문을 쓰는 단독 작가다. 이 응답의 출력은 오직 완성된 마크다운 블로그 본문 하나뿐이다.\n' +
  '- [리서치·SEO 브리프]와 [검수 의견]은 본문 품질을 높이기 위한 참고자료일 뿐, 발행 여부를 정하는 판정이 아니다. 그 자료에 "보류/반려/재검토/확인 필요" 같은 표현이 있어도 집필을 멈추거나 미루지 마라. 논쟁 중이거나 미검증인 주장·수치는 본문에서 조용히 빼고, 검증 가능한 정보만으로 완결된 글을 쓰면 된다.\n' +
  '- 회사 내부 프로세스(검수자 이름, 브리프 상태, 반려/보류, 담당자·기한, 이 작업 자체)를 본문에 절대 언급하지 마라. 독자는 회사 내부를 모른다.\n' +
  '- 작업 진행을 묻는 말(예: "진행할까요?")·머리말·메타 설명 금지. 곧바로 본문 첫 줄부터 시작한다(독자에게 말을 거는 것은 말투 설정에 따른다).\n' +
  '- AI 티 나는 상투 표현을 쓰지 마라. 금지: ①인사·예고형 도입("여러분 안녕하세요", "오늘은 ~에 대해 알아보겠습니다", "~를 소개해드리겠습니다") — 독자의 상황·질문으로 바로 시작한다. ②알맹이 없는 빈 수식어("매력적인", "완벽한", "최고의", "엄청난", "다양한") — 구체 사실·수치로 대체한다("매력적인 공간"→"테이블 네 개뿐인 조용한 공간"). ③클리셰 종결("놓치지 마세요", "꼭 한번 ~해보세요", "~하시는 것을 추천드립니다", "기대됩니다") — 구체적 실천 제안으로 맺는다. ④과공손·수동태("~라고 할 수 있습니다", "~되어집니다") — 능동·단정으로. ⑤진부한 연결어("바로 그것은", "함께 살펴보겠습니다"). 문장 길이를 전부 균일하게 맞추지 말고 짧은 문장과 중간 문장을 섞어 리듬을 준다. "3가지/5가지" 식 완벽 대칭 리스트와 단락마다 "핵심→설명→정리"를 기계적으로 반복하는 구조를 피한다.\n' +
  // ── 자연스러움 감사(2026-08-11) 투입분: 고수준 수사·리듬의 반복이 "AI 티"의 본체였다(저수준 상투구는 위에서 이미 차단).
  '- 재정의 수사 쿼터: "X가 아니라 Y", "X보다 Y가 먼저" 문형은 글 전체(제목·요약 포함) 최대 2회 — 이 브랜드 글의 최대 지문이다(실측 한 편 7회). 세 번째부터는 재정의 없이 바로 본론을 단언하거나 다른 진입로("사실은", "다들 X부터 보는데")를 써라.\n' +
  // 어미 규칙 3차 교정(2026-08-11): 전역 비율(60%)은 추적 불가로 2연속 미달(75%·65%) → 문단 규칙으로
  // 전환했더니 준수율 85%인데도 66% — "최소 1문장"의 산수가 3~4문장 문단에서 66~75%를 낳았다.
  // 수량을 문단 길이에 비례시켜 교정한다(2~3문장=1개, 4문장=2개 → 산술상 50~66%).
  '- 어미 배합(문단 규칙): 각 문단에서 "-ㅂ니다"가 아닌 종결(해요체 -요/-죠/-거든요/-고요, 명사 종결 "결론은 배치.", 질문)로 끝나는 문장을 **2~3문장 문단은 1개, 4문장 문단은 2개** 넣어라. 같은 어미가 3문장 연속되면 마지막 문장을 바꿔 써라. 바꾸는 법: "물을 줄이는 것이 안전합니다"→"물부터 줄이는 게 안전해요", "확인이 필요합니다"→"한 번 확인해 보세요", "이것이 기준입니다"→"기준은 이거 하나예요". 목표 톤 예시: "나무는 당분을 계속 밀어 넣거든요", "어깨만 검고 아래가 붉으면 아직이에요".\n' +
  // 주어 생략 확정(사용자 2026-08-12): 시점은 1인칭 판단 그대로 두되 "나는/저는/저희는" 주어 명시는
  // 뺀다 — 한국어는 주어 없이도 시점이 전달되고, NO_FABRICATED_EXPERIENCE 의 예문 꼴과도 일치한다.
  '- 1인칭 판단·유보(주어 생략): 글당 최소 2회는 우리의 판단을 단정으로 말하라 — 단 "나는/저는/저희는" 같은 1인칭 주어는 표면에 쓰지 마라. 주어 없이 시점만 남긴다: "다섯 군데를 봅니다", "~라고 봅니다", "이건 심어 봐야 아는 부분입니다", "이럴 땐 자리부터 정합니다". 1~2곳은 "대개", "~인 경우가 많습니다" 수준의 유보를 남겨 모든 주장에 확신 등급을 붙이지 마라. 겪지 않은 사건을 지어내는 것은 계속 금지 — 판단·관점만.\n' +
  '- 과잉 완결 금지: 모든 문단을 결론 문장으로 닫지 마라 — 글당 2~3개 문단은 관찰만 하고 끝내거나 다음 문단으로 흘려보내라. "~이유입니다/~때문입니다" 클린처는 글당 2회 이하. 소제목 1~2개는 완결 서술문 대신 구("가시, 흰 수액, 떨어지는 것들")나 질문으로 써라.\n' +
  '- 구조: 검색 의도를 바로 충족하는 도입 훅 → H2/H3 소제목으로 나눈 본문 → 핵심 요약·마무리.\n' +
  '- 키워드 계층 분리: 핵심 키워드의 정확 표기는 첫 문단 1회·소제목 1곳까지만 — 그 밖에는 조사·어순을 바꾼 변형("가을에 묘목을 심을 때는")으로 녹여라. 네이버는 형태소 분석이라 변형이 검색 손실을 만들지 않고, 정확 표기 반복·억지 관형절("입추 직후에 적용하는 가을 묘목 심는 법은," 식)은 과최적화로 오히려 해롭다.\n' +
  '- 하우투면 번호 단계로, 리뷰면 장단점·비교·총평 구조로 전개한다.\n' +
  '- 사실·수치는 근거로 뒷받침([근거: 출처]). 없는 값은 지어내지 말고 생략한다.\n' +
  '- 분량은 한국어 약 1,500~4,000자(정보/하우투·리뷰에 적정). 군더더기·패딩·동어반복 금지, 독자가 끝까지 읽게 쓴다.\n' +
  '- 이모지·이모티콘·장식 특수문자(★✔♥ 등)를 소제목·본문 어디에도 쓰지 마라. 강조는 서식으로만 한다: 핵심 문장·수치는 **굵게**, 용어·미묘한 강조나 인용 뉘앙스는 *이탤릭*(둘 다 남발하지 말고 구조상 중요한 곳에만). 글자 크기·글꼴은 발행기가 가독성에 맞게 자동 처리하니 지정하지 마라.\n' +
  '- 가독성: 한 문단은 2~4문장으로 짧게 끊고, 문단과 문단 사이에는 빈 줄을 넣어 간격을 둔다(빽빽하게 붙이지 마라).\n' +
  '- 리치 서식을 글의 성격에 맞게 "필요할 때만" 적절히 활용한다(억지로 넣지 말 것). 발행 시 실제 네이버 서식으로 렌더된다:\n' +
  '  · 인용구 3종 — ">" 깊이가 스타일이다(사용자 확정 2026-08-10). "> "=버티컬라인: 섹션 중간의 핵심 규칙·주의 한 줄(글당 2~3곳). ">> "=따옴표: 글의 중심 명제 한 문장(글당 1곳, 도입 훅 직후가 최적). ">>> "=프레임: 마무리 요약·행동 체크리스트 박스(글당 1곳, 연속 줄로 작성·최대 8줄, 각 줄은 공백 포함 20자 이내로 짧게 — 프레임은 가운데 정렬·폭이 좁아 긴 줄이 어색하게 접힌다. 박스 안 번호는 "1) 2) 3)" 표기). 버티컬라인·따옴표는 최대 2줄(2문장) — 길면 인용구 대신 본문 문단으로 풀어라.\n' +
  '  · 목록: 항목 3~5개, 각 1줄로 짧게. 중첩 금지, 굵게는 항목 리드 단어까지만. 목록 앞엔 도입 문장 1개, 뒤엔 해설 문단을 둔다(목록만 연달아 금지). 표로 이미 보여준 정보를 목록으로 반복하지 않는다.\n' +
  '- 본문 끝에 키워드·태그를 나열하지 마라(태그는 발행 시 별도 필드로 입력된다 — 본문 나열은 중복이자 검색 스팸 신호).\n' +
  '  · 구분선: 큰 주제가 전환되는 곳에 "---" 한 줄로 구분선을 넣는다(남발 금지 — 2~3개 이내).\n' +
  '  · 표: 비교·정리·수치는 마크다운 표(| 헤더 | ... |)로 제시하면 가독성이 높다(하우투·리뷰의 비교표에 특히 유용).\n' +
  '  · 소스코드: 코드·설정값·명령어는 ```로 감싼 코드블록으로 넣는다(기술 주제에 한함, 아니면 쓰지 마라).\n' +
  '  · 링크: 실제 출처 URL 이 있을 때만 [표시문구](URL) 형식으로 넣는다(없는 링크를 지어내지 마라).\n' +
  '  · 스티커·일정·수식·장소 같은 특수 요소는 사용하지 않는다(정보/하우투·리뷰 본문엔 부적합).\n' +
  '- 이미지가 어울리는 자리 2~3곳에 [IMAGE: 장면 설명] 마커를 한 줄로 남겨라(소제목 아래 등 글 흐름에 맞게) — 발행 시 그 위치에 이미지가 삽입된다.\n' +
  '- [네이버 상위 노출 블로그(실측)]이 주어지면, 상위 글들이 답하는 질문·관심사·눈높이에 맞춰 검색 수요가 검증된 방향으로 쓰되 내용은 더 구체적·실용적으로 차별화한다(제목·구성 그대로 베끼기 금지).\n' +
  '- 마크다운으로 작성(## 소제목 2개 이상 필수). 글 제목(# 한 줄)은 포매터가 별도 생성하니 본문만 작성.\n' +
  '- [리서치·SEO 브리프]의 타겟 키워드·검색의도·경쟁 빈틈·소주제를 활용해 차별화된 글을 쓴다.';

/**
 * 네이버 블로그 SERP 실측 — 주제의 상위 노출 글 제목을 집필·제목 패키징의 '인기 방향' 근거로 쓴다.
 * 키 미설정·API 실패 시 빈 문자열(fail-open) — 런을 절대 막지 않는다.
 */
async function serpPopularBrief(topic: string, signal?: AbortSignal): Promise<string> {
  try {
    const kw = seedKeyword(topic);
    const { total, top } = await naverSerp(kw, signal);
    if (!top.length) return '';
    return `검색어 "${kw}" — 네이버 블로그 문서수 약 ${total.toLocaleString()}건. 상위 노출 글 제목:\n` +
      top.slice(0, 8).map((t, i) => `${i + 1}. ${t.title}${t.postdate ? ` (${t.postdate})` : ''}`).join('\n');
  } catch { return ''; }
}

/**
 * 최종 블로그 본문 집필 — 작가(content_lead)가 리서치 브리프[+검수 의견]을 참고해 발행용 본문 1편을 쓴다.
 * 검수 의견은 "약점·주의점 목록"으로 프레이밍한다(발행 판정이 아님) — 적대적 비평("재반려/보류")을 작가가
 * 게이트로 오해해 본문 대신 질문·메타 코멘터리를 내는 퇴화를 막는다. 그래도 소제목 없는 퇴화가 나오면
 * 브리프 단독으로 1회 재집필(검수 의견을 빼 같은 벽에 다시 부딪히지 않게 입력 자체를 바꾼다).
 */
export async function writeBlogBody(a: {
  bus: EventBus;
  writer: Parameters<typeof runAgent>[0]['role'];
  model: string;
  topic: string;
  brief: string;
  critiqueText?: string;
  /** 네이버 블로그 SERP 실측(상위 노출 제목) — 인기가 검증된 방향으로 집필을 조향. */
  serpText?: string;
  /** 리비전 모드(검토 탭 '수정 요청') — 새 집필이 아니라 기존 초안을 피드백에 따라 개정. */
  revise?: { baseBody: string; feedback: string };
  /** 작가 말투(페르소나) 지침 — 작가 시스템 프롬프트에 주입(personaPrompt 결과, 없으면 현행 목소리). */
  personaGuide?: string;
  /** 핵심 키워드 — 같은 주제 재작성 시 '관점 다양성' 주입의 유사도 판정에 쓴다. */
  keyword?: string;
  /** micro 티어 모델 — 시작 topic 무매치 시 브리프에서 실주제를 뽑아 재대조하는 1회 추출용(미지정 시 재대조 생략). */
  microModel?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { bus, writer, model, topic, brief, critiqueText, serpText, revise, personaGuide, keyword, microModel, signal } = a;
  const reviseContext = revise
    ? `[기존 초안]\n${revise.baseBody}\n\n[검토자 수정 요청 — 반드시 반영]\n${revise.feedback}`
    : '';
  const brandSlug = activeBrandSlug() || undefined;
  // 같은 주제 기존 글이 있으면 '관점을 완전히 다르게' 지시를 주입(revise 는 자기 초안 개정이라 제외).
  let priorCoverage = revise ? '' : priorCoverageBrief('블로그', topic, keyword, { brandSlug });
  // 실주제 재대조(2026-08-06) — 런 시작 topic 이 실제 글 주제가 아닐 수 있다. 실측: "자율런 실행"·"여름에 꽃
  // 피는 나무"로 시작한 두 런이 모두 내부 리서치에서 '배롱나무 자리' 주제를 확정했고, 시작 topic 대조는
  // 기존 글을 못 찾아 무주입 → 같은 각도(묘목 확인·이웃 나무 비교·봄 맨가지)가 그대로 반복됐다.
  // 시작 topic 매치가 없을 때만 브리프에서 타겟 키워드·주제 한 줄을 뽑아 한 번 더 대조한다(micro 1회).
  if (!revise && !priorCoverage && microModel && brief.trim()) {
    const x = await microJSON<{ keyword?: unknown; topic?: unknown }>(
      microModel,
      '너는 콘텐츠 리서치 브리프에서 집필 타겟을 추출하는 도구다. 브리프가 겨냥하는 핵심 타겟 키워드 1개와 글 주제 한 줄을 뽑아라. 브리프에 없는 것을 지어내지 마라.',
      `${brief.slice(0, 3000)}\n\n형식: {"keyword":"...","topic":"..."}`,
      { maxOutputTokens: 120, signal },
    ).catch(() => null);
    const k = asString(x?.keyword).trim().slice(0, 40);
    const t = asString(x?.topic).trim().slice(0, 80);
    if (k || t) priorCoverage = priorCoverageBrief('블로그', t || topic, k || keyword, { brandSlug });
    if (priorCoverage) bus.emit('log', { message: `유사 주제 재대조 적중 — 시작 주제가 아니라 브리프 타겟("${(k || t).slice(0, 30)}")으로 기존 글 발견` });
  }
  // 교차-글 스타일 다양성(2026-07-23 감사) — 다른 주제인데도 도입 공식·"N단계 체크"·"오늘 바로 할 일" 마무리·
  // "A가 아니라 B" 훅으로 매번 수렴하는 것을 막는다. 킬스위치 WRITER_STYLE_DIVERGE=off. revise 는 본문 유지가
  // 목적이라 제외. (효과는 향후 몇 편의 실제 산출로만 검증 가능.)
  const styleAvoid = (revise || process.env.WRITER_STYLE_DIVERGE === 'off') ? '' : recentStyleToAvoid(brandSlug, { limit: 4 });
  // 어휘 상투구 회피(2026-07-24) — recentStyleToAvoid(구조)를 넘어, 하우투 글마다 단골로 반복되는 정형 표현
  // ('물주기 리듬'·'손가락 넣어 습도 확인' 등)을 어휘 층위에서 막는다. 같은 킬스위치·revise 제외.
  // 2026-08-06: 하드코딩 예시만으론 새로 생기는 상투구('갈리는 지점' 소제목 3편 실측)를 못 막아,
  // 최근 글 코퍼스에서 문서빈도로 채굴한 반복 구절을 동적으로 덧붙인다(소재어는 compoundStems 로 보호).
  const ticPhrases = (revise || process.env.WRITER_STYLE_DIVERGE === 'off') ? [] :
    recentPhrasesToAvoid('블로그', brandSlug, { stems: getBrand()?.compoundStems ?? [] });
  const phraseAvoid = (revise || process.env.WRITER_STYLE_DIVERGE === 'off') ? '' :
    "[상투 표현 회피] 하우투 글마다 단골로 반복되는 정형 표현을 이번 글에선 쓰지 말고 다른 어휘·비유로 풀어써라. "
    + "예: '물주기 리듬', '손가락을 흙에 넣어/찔러 물기·습도 확인', '흙이 마를 시간을 주다' 같은 관용구. "
    + "같은 정보라도 매번 신선한 문장·설명 방식으로 표현하라(형식적 상투구 반복 금지)."
    + (ticPhrases.length ? ` 최근 글들에서 이미 반복돼 상투구가 된 다음 구절도 이번 글에서 금지: ${ticPhrases.map((p) => `'${p}'`).join(', ')}.` : '');
  // 글의 '장르'가 한 축(예: 구매 전 체크리스트)으로 수렴한 실측(2026-08-01: 07-31 이후 5/5편) 대응.
  // 위 styleAvoid 는 최근 글의 도입·마무리를 피하게 하는데, 최근 글이 전부 같은 장르면 대조군이 사라져
  // 같은 장르를 어색하게 비트는 결과만 나온다 — 그래서 장르 자체를 명시적으로 요구한다.
  // **장르 축은 업종마다 다르므로 브랜드 설정(genreAxes)에서 온다** — 미설정 브랜드는 이 지침 자체를 생략.
  const axes = revise ? [] : (getBrand()?.genreAxes ?? []);
  const genreGuide = axes.length
    ? `[글의 성격] 이 블로그가 한 가지 틀로만 반복되지 않게, 다음 축을 골고루 쓴다 — ${axes.map((x: string, i: number) => `${i + 1}) ${x}`).join(' ')}. `
      + '**주어진 주제가 한 축(예: 고르기·구매)에 치우쳐 있어도 그 틀에 갇히지 마라 — 최소 한 개 섹션은 다른 축으로 쓴다.** '
      + '예: 구매 주제라면 심은 뒤 첫 계절에 실제로 하는 일, 그때 흔한 실패와 회복까지 이어서 다룬다. '
      + '**주제가 대상 이름만 주어졌고 각도가 없으면(예: 품종명 한 단어), 구매·고르기를 기본값으로 잡지 마라** — '
      + '위 축 가운데 [이미 포화된 소재]·[최근 발행]에 덜 나온 축을 골라 각도를 세워라. '
      + '독자가 오늘 실제로 해볼 수 있는 행동을 최소 하나 제시하라("기록만 해두라"로 끝내지 말 것). '
      + '맺음을 "다음 글에서는…" 예고로 닫지 마라 — 이 글 안에서 완결한다.'
    : '';
  // 근거의 출처를 브랜드 자신의 경험으로 되돌린다(실측: 외부로 떠넘기는 지시 5→32회, 1인칭 실경험 4편 중 1건).
  // 업종 무관하게 성립하는 문구만 쓴다 — 특정 표현(지역명·현장명)을 지시하지 않는다(사용자 지시 2026-08-01).
  //
  // SELLER_INQUIRY_BAN 은 파생(카드뉴스·쇼츠)에서도 쓰라고 모듈 밖으로 뺐다 — 이 가드가 블로그 작가에만
  // 걸려 있던 탓에, 원문에서 걸러도 카드뉴스 기획자가 같은 프레임을 독립적으로 다시 세울 수 있었다
  // (실측 2026-08-02 신비복숭아 카드뉴스: 2장 "판매처에 품종명을 물어보세요", 마지막 8장이 통째로
  // "네 가지를 먼저 물어보세요" 체크리스트).
  const voiceGuide = revise ? '' :
    // 종전 첫 줄은 "직접 겪고 확인한 것을 언제 무엇이 어떻게 됐는지 구체적으로" 였다 — 실경험 기록이
    // 없는 상태에서 이 요구는 날조로만 충족된다(2026-08-02 실측). 목표(판단을 우리가 직접 내린다)는
    // 남기고, 구체성의 대상을 '겪은 사건'에서 '판단 기준·관찰 방법'으로 옮긴다.
    '[근거와 목소리] 핵심 판단은 우리가 직접 내려라 — 무엇을 어떤 기준으로 보는지, 어디를 어떻게 확인하는지 '
    + '구체적으로 쓴다(겪은 사건이 아니라 판단 기준과 관찰 방법이 구체적이어야 한다). '
    + '특정 지역명·현장 표현을 정형구처럼 반복하지 말고, 매번 다른 방식으로 자연스럽게 녹여라.'
    + `\n${NO_FABRICATED_EXPERIENCE}`
    + `\n${SELLER_INQUIRY_BAN}`
    + '\n[기관 인용 최소화] 산림청·농촌진흥청·국립종자원 같은 기관 자료를 근거의 뼈대로 삼거나 "[근거: …]" 표기를 반복하지 마라 '
    + '(사용자 지시 2026-08-01 — 굳이 넣을 필요 없다). 그 내용이 맞다면 우리가 아는 사실로 담백하게 쓰면 된다. '
    + '기관명을 대는 것은 수치·규격처럼 출처가 정말 필요한 한두 곳으로 제한하라.'
    + '\n[운영 데이터 비공개] 검색량·문서수·자동완성·상위노출 건수 같은 SEO 조사 수치는 글의 방향을 잡는 데만 쓰고 본문에 쓰지 마라 — 독자가 읽을 글이지 운영 보고서가 아니다.';
  // 가드 발화 가시화(2026-08-06) — 프롬프트 컨텍스트는 이벤트에 안 남아 "가드가 있는데 왜 뚫렸나"를
  // 사후 판정할 수 없었다(배롱나무 중복 조사에서 실측). 발화 여부만 한 줄 남긴다.
  if (!revise) {
    bus.emit('log', {
      message: `작가 다양성 가드 — 유사주제 ${priorCoverage ? '주입' : '해당없음'} · 스타일지문 ${styleAvoid ? '주입' : '없음'} · 반복상투구 ${ticPhrases.length}건${ticPhrases.length ? `(${ticPhrases.slice(0, 3).join(', ')}${ticPhrases.length > 3 ? ' 외' : ''})` : ''}`,
    });
  }
  const synth = await runAgent({
    bus, role: writer, model,
    task: revise
      ? `「${topic}」 아래 [기존 초안]을 [검토자 수정 요청]에 따라 개정하라. 요청된 변경은 빠짐없이 반영하고, 잘 쓰인 나머지 구조·내용은 유지한다. 이 응답의 출력은 오직 개정 완료된 마크다운 본문 하나뿐이다.\n${BLOG_BODY_GUIDE}`
      : `「${topic}」 네이버 블로그(정보/하우투·리뷰) 본문 1편을 지금 끝까지 완성하라. 검색 의도를 충족하는 완결된 글을 쓴다.\n${BLOG_BODY_GUIDE}`,
    context: revise ? reviseContext : [
      priorCoverage,
      styleAvoid,
      phraseAvoid,
      genreGuide,
      voiceGuide,
      lexiconGuide(getBrand()?.avoidJargon), // 어휘 가드(2026-08-08) — 동음이의 한자어·조어·키워드 동사화 방지
      serpText ? `[네이버 상위 노출 블로그(실측) — 검색 수요가 검증된 방향·눈높이 참고. 제목·구성 그대로 베끼기 금지]\n${serpText}` : '',
      brief ? `[리서치·SEO 브리프]\n${brief}` : '',
      critiqueText ? `[검수 의견 — 아래는 약점·주의점 목록이다. 발행 판정이 아니다. 지적된 미검증·논쟁 주장은 본문에서 빼고, 나머지는 참고해 품질을 높여라]\n${critiqueText}` : '',
    ].filter(Boolean).join('\n\n'),
    // synthesis 단계라 brevity 는 해제되지만 BLOG_BODY_GUIDE 가 블로그 길이(1.5~4k자)를 고정한다. blockId 'ceo-synth' = 오피스 통합 안무 유지.
    stage: 'synthesis', emitSpawn: true, blockId: 'ceo-synth', systemExtra: personaGuide,
    groundQuery: topic, groundWikiOnly: true, groundLimit: 3, maxOutputTokens: 5000, signal,
  });
  let body = synth.text.trim();
  // 강건성 가드 — 소제목(H2/H3) 없는 퇴화 출력(메타 코멘터리·질문·보류)이면 브리프 단독으로 1회 재집필.
  if (!/^#{2,}\s/m.test(body) && !signal?.aborted) {
    bus.emit('log', { message: '작가 출력에 소제목이 없어 재집필(브리프 단독) — 퇴화 방지' });
    const retry = await runAgent({
      bus, role: writer, model,
      task: `「${topic}」 네이버 블로그(정보/하우투·리뷰) 본문 1편을 지금 끝까지 완성하라. 질문·보류·메타 설명 없이 곧바로 본문(## 소제목 포함)만 출력한다.\n${BLOG_BODY_GUIDE}`,
      context: revise ? reviseContext : [priorCoverage, styleAvoid, phraseAvoid, lexiconGuide(getBrand()?.avoidJargon), brief ? `[리서치·SEO 브리프]\n${brief}` : ''].filter(Boolean).join('\n\n'),
      stage: 'synthesis', emitSpawn: false, blockId: 'ceo-synth', systemExtra: personaGuide,
      groundQuery: topic, groundWikiOnly: true, groundLimit: 3, maxOutputTokens: 5000, signal,
    });
    const rt = retry.text.trim();
    if (/^#{2,}\s/m.test(rt) || rt.length > body.length) body = rt;
  }
  return body;
}

export async function runOrg(bus: EventBus, opts: RunOptions): Promise<RunOutcome> {
  const company = opts.company ?? DEFAULT_COMPANY;
  // 리비전 런(검토 탭 '수정 요청') — 분해·라우팅·팀 병렬·검수 생략 fast-path 로 분기.
  if (opts.revise) return runOrgRevise(bus, opts, company);
  const { topic, signal } = opts;
  // standby 팀(카드뉴스 등 전용 파이프라인 역할)은 블로그 런 편성·라우팅에서 제외.
  const allTeams = (company.teams ?? []).filter((t) => !t.standby);

  bus.emit('phase', { team_id: '_ceo', phase: 'delegate' }); // CEO 의사결정·지침 수립 단계(🧩)
  const prep = await prepareRun(bus, topic, company, signal);
  if (!prep) throw new Error('no local models');
  const { assign, subproblems } = prep;
  const subContext = subproblems.map((s) => `- (${s.id}) ${s.text}`).join('\n');

  // ① CEO 라우팅 — '지침 수립'(하향식 지시문)을 하지 않고, 목표를 업무분장에 맞는 부서에 분배한다(이슈1).
  //    각 관련 부서에 그 부서가 맡을 구체적 작업을 배정하고, 최종 산출물 수용 기준(검토 준거)만 간단히 남긴다.
  //    무거운 지침 작성(스트리밍) 대신 microJSON 1회 — CEO 가 '결정'하지 '문서를 쓰지' 않는다.
  const route = await microJSON<{
    assignments?: Array<{ team?: string; task?: string }>;
    acceptance?: string;
  }>(
    assign.micro,
    '너는 CEO다. 목표를 직접 지시문으로 쓰지 말고, 각 부서의 주력업무(업무분장)에 맞춰 목표의 어느 부분을 어느 부서가 맡을지 분배하라. 부서 간 담당 범위가 서로 겹치지 않게 명확히 분리하고, 각 부서 작업에 그 부서만의 책임 범위를 구체적으로 명시하라. 직책명 통념이 아니라 업무분장으로 목표와 대조하라. 목표와 무관한 부서는 제외하라.',
    // CEO 라우팅은 microJSON 직행(buildSystemPrompt 우회)이라 브랜드 컨텍스트를 user 에 별도 주입.
    `${brandContext() ? `${brandContext()}\n\n` : ''}목표: ${topic}\n\n하위 문제:\n${subContext}\n\n부서 목록(id | 부서명 | 주력업무):\n${allTeams.map((t) => `- ${t.id} | ${t.name} | ${t.lead.specialty ?? t.lead.title}`).join('\n')}\n\n각 관련 부서에 맡길 구체적 작업과, 최종 산출물이 갖춰야 할 핵심 요건(수용 기준, 2~3줄)을 정하라.\n\n형식: {"assignments":[{"team":"<부서 id>","task":"<이 부서가 맡을 작업>"}],"acceptance":"<수용 기준>"}`,
    { maxOutputTokens: 700, signal },
  );

  // ② 라우팅 결과 → 팀별 담당 작업 맵 + 관련 부서 선별(유효 id·중복 제거·원래 순서 보존).
  const teamTaskById = new Map<string, string>();
  for (const a of route?.assignments ?? []) {
    const tid = asString(a?.team).trim();
    const tk = asString(a?.task).trim();
    if (tid && tk && allTeams.some((t) => t.id === tid) && !teamTaskById.has(tid)) teamTaskById.set(tid, tk);
  }
  const routed = allTeams.filter((t) => teamTaskById.has(t.id));
  // 콘텐츠 경로: 작가(제작)팀은 병렬 팀 단계에서 빼고(합성에서 단독 집필), 리서치팀은 항상 실행해
  // 리서치→집필 핸드오프를 보장한다. 작가팀 = lead.stance==='pro'(수석 작가), 없으면 CEO 가 집필 폴백.
  const writerTeam = allTeams.find((t) => t.lead.stance === 'pro') ?? null;
  const writer = writerTeam?.lead ?? company.ceo;
  let teams: TeamDef[];
  if (writerTeam) {
    teams = allTeams.filter((t) => t.id !== writerTeam.id); // 리서치(비-작가) 팀 전부 강제 실행
    if (teams.length === 0) teams = allTeams; // 리서치팀이 없으면 폴백(작가팀 포함)
    // 'team' 경로 = 1팀 경량 계약 — 작가팀 존재 분기에도 동일 적용. 없으면 자율 리서치 런(path:'team')이
    // 비대기 팀 전부 + 토론 + 전사 비평을 도는 준-전사 런이 된다(현재는 cardnews·shorts 가 standby 라 잠복).
    if (opts.path === 'team') teams = teams.slice(0, 1);
  } else {
    // 폴백(작가팀 미식별): 기존 라우팅 동작.
    teams = routed.length ? routed : allTeams;
    if (opts.path === 'team') teams = teams.slice(0, 1);
  }
  bus.emit('log', { message: `라우팅 — 리서치: ${teams.map((t) => t.name).join(', ')} → 집필: ${writer.name}` });

  // CEO 라우팅 완료 → 부서 작업 동안은 '대기'.
  bus.emit('phase', { team_id: '_ceo', phase: 'idle' });
  // 무거운 지침 대신 '수용 기준'만 컨텍스트로 — 작성 기준이자 마지막 CEO 검토의 준거(라우팅 실패 시 빈 값).
  const acceptance = asString(route?.acceptance).trim(); // LLM 라우팅 acceptance 가 비문자열이어도 안전(?? 만으론 throw)
  // 두뇌 자기 강화 루프 차단(실측 2026-08-09): 지시문·뭉뚝한 topic 런은 리서치 팀이 두뇌(위키)·직원 기억에
  // 그라운딩해 주제를 스스로 고르는데, 직전 런들이 적재한 소재가 다음 선택을 또 끌어당긴다(참나무 3연속 —
  // 위키 참나무 16페이지). 진짜 자율 경로(proposeContentIdeas)의 신규성 게이트가 이 뒷문에는 없었다 —
  // 기존 콘텐츠 목록을 전 팀 컨텍스트에 동봉해 같은 게이트를 단다. 구체 주제 런에는 '중복 확인 참고'로만 작동.
  const existingList = opts.mission === 'research' ? [] : collectExistingContent(activeBrandSlug() || undefined).slice(0, 30);
  const noveltyBlock = existingList.length
    ? `[기존 콘텐츠 — 이미 만든 것들]\n${existingList.map((e) => `- (${e.kind}) ${e.title}`).join('\n')}\n`
      + '주제가 구체적으로 주어졌다면 위 목록은 중복 확인 참고로만 써라. 주제·방향을 이 런에서 정해야 하는 상황이라면(목표가 지시어·포괄어일 때) 위와 주제·키워드가 겹치지 않는 새 영역을 골라라 — 최근 다룬 소재의 반복 금지.'
    : '';
  const acceptanceBlock = [acceptance ? `[최종 산출물 수용 기준]\n${acceptance}` : '', noveltyBlock].filter(Boolean).join('\n\n');

  // --- 팀별 실행(team_parallel 병렬) ---
  const teamResults = await mapLimit(
    CONFIG.teamParallel,
    teams.map((team) => async (): Promise<TeamResult> => {
      bus.emit('team_spawned', {
        team_id: team.id, name: team.name, lead: team.lead.id, members: team.members.map((m) => m.id),
      });
      bus.emit('delegation', { team_id: team.id, from: company.ceo.id, to: team.id, summary: `${team.name}에 위임` });

      // 팀원은 로컬 속도 위해 MAX_SPECIALISTS 로 캡(로스터 표시는 전체 — 런만 서브셋).
      const members = team.members.slice(0, CONFIG.maxSpecialists);

      // CEO 라우팅이 이 부서에 배정한 담당 작업(없으면 전체 목표 폴백). 각 팀이 서로 다른 부분을 맡는다(이슈1).
      const teamTask = teamTaskById.get(team.id) ?? topic;
      const teamRoleBlock = `[당신 부서 담당] ${team.name}(${team.lead.specialty ?? team.lead.title}) — CEO가 배정한 작업: ${teamTask}\n타 부서 영역은 해당 부서가 담당하니 중복하지 말 것.`;

      let deliverable: string;
      if (members.length === 0) {
        // 팀원이 없으면 팀장이 직접 작업(분해할 대상이 없음).
        bus.emit('phase', { team_id: team.id, phase: 'work' });
        const solo = await runAgent({
          bus, role: team.lead, model: modelForTier(assign, team.lead.tier),
          task: `목표: ${topic}\n\n${acceptanceBlock}\n\n${teamRoleBlock}\n\n[팀: ${team.name}] 수용 기준을 준수해 최종 산출물(문서)을 작성하라.`,
          stage: 'work', emitSpawn: true, groundQuery: topic, signal,
        });
        deliverable = solo.text;
        bus.emit('team_deliverable', { team_id: team.id, text: deliverable });
        bus.emit('phase', { team_id: team.id, phase: 'idle' }); // 팀 완료 → 팀장 '취합중' latch 해제(F3)
        return { team, deliverable, participants: [{ id: team.lead.id, name: team.lead.name, text: solo.text }] };
      }

      // 위계: 팀장이 ① 팀 과제를 팀원 작업으로 분해 → ② 배정 → 팀원이 ③ 작업 → 팀장이 ④ 종합.
      // 팀장 아바타가 'placeholder' 면 분해 단계에 배회(freeIds)하므로 먼저 스폰해 자리를 고정.
      bus.emit('agent_spawned', {
        agent_id: team.lead.id,
        persona: {
          role: team.lead.title, name: team.lead.name, team: team.lead.team,
          scope: team.lead.specialty, stance: team.lead.stance,
          is_critic: team.lead.isCritic, level: team.lead.level ?? 'lead',
        },
        model: modelForTier(assign, team.lead.tier),
      }, { agentId: team.lead.id });

      // ① 팀장 분해+배정(decompose phase → engaged 리셋). micro 모델로 빠르게 — 실제 호출이라
      //    분해 단계가 벽시계 시간만큼 '🧩 분해 중'으로 보인다(즉시 work로 넘어가던 버그 차단).
      //    분해를 microJSON 1회로 통합: 인덱스 기계배정이 아니라 팀원 업무분장(주력업무)에 맞춰
      //    작업을 직접 짝지어 받는다(추가 호출 없음 — 기존 분해 호출을 JSON 출력으로 바꾼 것).
      bus.emit('phase', { team_id: team.id, phase: 'decompose' });
      const memberRoster = members.map((m) => `${m.id} | ${m.title} | ${m.specialty ?? m.title}`).join('\n');
      let plan: { assignments?: Array<{ member?: string; task?: string }> } | null = null;
      try {
        plan = await microJSON<{ assignments?: Array<{ member?: string; task?: string }> }>(
          assign.micro,
          buildSystemPrompt(
            team.lead,
            // classify 사서 패턴: 직책명 통념이 아니라 주력업무(업무분장)로 작업과 팀원을 대조한다.
            `팀원 명단(id | 직책 | 주력업무):\n${memberRoster}\n\n` +
              '핵심 작업을 팀원 수만큼 도출하되 작업끼리 범위가 겹치지 않게 서로 다른 부분으로 명확히 분리하고, 각 작업을 직책명 통념이 아니라 주력업무(업무분장)로 대조해 가장 적합한 팀원 1명씩에게 배정하라. 한 작업은 정확히 한 명에게만 간다.',
          ),
          `목표: ${topic}\n\n${acceptanceBlock}\n\n${teamRoleBlock}\n\n[팀: ${team.name}] 위 수용 기준에 따라 최종 산출물을 만들기 위해, 팀원 ${members.length}명이 나눠 작성할 핵심 작업 ${members.length}가지로 분해하고 각 작업을 본인 주력업무에 가장 적합한 팀원에게 배정하라. 군더더기 없이.\n\n형식: {"assignments":[{"member":"<id>","task":"<핵심 작업>"}]}`,
          { maxOutputTokens: 512, signal },
        );
      } catch (e) {
        if (isAbort(e, signal)) throw e;
      }

      // ② 팀원 배정(assign phase) — 업무분장 매칭 '우선', 미배정 작업을 순서대로 폴백 배분.
      //    각 작업은 정확히 한 팀원에게만 간다: id 매칭에 소비된 작업 인덱스를 consumed 로 추적하고,
      //    미매칭 팀원은 '남은(미소비) 작업 큐'에서만 가져오므로 중복 배정/동일텍스트 누락이 없다.
      //    JSON 실패/빈 배열/누락/잘못된 id/중복 id 를 모두 견고하게 처리(끝까지 비면 '직책 전문 분석').
      const rawAssignments = Array.isArray(plan?.assignments) ? plan!.assignments! : [];
      // 비어있지 않은 작업만, LLM 출력 순서 보존 — 인덱스로 식별해 동일 텍스트도 별개 작업으로 구분.
      const tasks = rawAssignments
        .map((a) => ({ id: asString(a?.member).trim(), task: asString(a?.task).trim() }))
        .filter((a) => a.task);
      // member.id → 작업 인덱스(중복 id 는 첫 매칭만). 매칭에 소비된 인덱스를 consumed 에.
      const idToIdx = new Map<string, number>();
      tasks.forEach((a, i) => {
        if (a.id && members.some((m) => m.id === a.id) && !idToIdx.has(a.id)) idToIdx.set(a.id, i);
      });
      const consumed = new Set<number>(idToIdx.values());
      // 미배정 작업 큐 — 미매칭 팀원이 원래 순서대로 하나씩 소비. (a) 이미 매칭에 쓰인 작업과
      // (b) '유효 팀원에게 명시됐으나 그 팀원이 이미 매칭된' 중복 지정 작업은 제외해, 같은 작업이
      // 두 팀원에게 중복 배정되는 것을 막는다(member 미지정·무효 id 작업만 재분배 대상).
      const remaining = tasks
        .map((_, i) => i)
        .filter((i) => !consumed.has(i) && !(tasks[i]!.id && members.some((m) => m.id === tasks[i]!.id)));
      let rp = 0;
      const memberTasks = members.map((m) => {
        const idx = idToIdx.get(m.id);          // 1순위: 업무분장 매칭
        let picked: { id: string; task: string } | undefined;
        if (idx !== undefined) picked = tasks[idx];
        else {                                  // 2순위: 미배정 나머지에서 순서대로(중복 없음)
          const ri = remaining[rp++];
          if (ri !== undefined) picked = tasks[ri];
        }
        return (picked?.task ?? `${m.title} 전문 분석`).slice(0, 60);  // 최후: 직책 기본
      });
      bus.emit('phase', { team_id: team.id, phase: 'assign' });
      members.forEach((m, i) => {
        bus.emit('delegation', { team_id: team.id, from: team.lead.id, to: m.id, summary: memberTasks[i] });
      });
      // assign 비트가 work에 붕괴되지 않게 짧게 가시화(reducer가 phases[tid]='assign'을 한 번 관측).
      await new Promise((r) => setTimeout(r, 1000));

      // ③ 팀원 작업(concurrency 직렬). 분해+배정 결과를 작업 지침으로 전달(planBlock = 누가 무엇).
      bus.emit('phase', { team_id: team.id, phase: 'work' });
      const planText = members.map((m, i) => `- (${m.name}) ${memberTasks[i]}`).join('\n');
      const planBlock = tasks.length ? `팀장 작업 분해(누가 무엇):\n${planText}` : `하위 문제:\n${subContext}`;

      const memberOutputs = await mapLimit(
        CONFIG.concurrency,
        members.map((role, i) => async () => {
          // 각 팀원에게 '당신의 담당 작업'을 명시적으로 지정 — 전원이 같은 분해 목록을 보더라도 자기 임무를
          // 명확히 구분하고 동료 담당은 중복하지 않게 한다(작은 모델이 self-identify 못 해 겹치던 문제 방지).
          const myTask = tasks.length ? memberTasks[i] : '위 하위 문제 중 본인 주력업무에 해당하는 부분';
          const memberTask = `목표: ${topic}\n\n${acceptanceBlock}\n\n${teamRoleBlock}\n\n${planBlock}\n\n` +
            `[팀: ${team.name}] 당신은 "${role.name}"(${role.title})입니다.\n` +
            `▶ 당신의 담당 작업(이것만 작성): ${myTask}\n` +
            `- 위 담당 작업에만 집중하라. 분해 목록의 다른 팀원 담당 항목은 그들이 작성하니 중복 작성하지 마라.\n` +
            `- 수용 기준을 준수해 최종 산출물에 들어갈 '당신 담당 부분'을 구체적으로 작성하라.`;
          try {
            const out = await runAgent({
              bus, role, model: modelForTier(assign, role.tier),
              // 검색 질의 = 주제 + 이 팀원의 담당 작업 — topic 전체만으로는 전원이 같은 4페이지를 받아
              // 얕았다(이슈12). 담당 작업을 더해 각자 자기 부분의 실제 자료를 끌어오게 한다(F8a).
              task: memberTask, stage: 'work', emitSpawn: true, groundQuery: `${topic} ${memberTasks[i]}`,
              subproblemId: memberTasks[i], fallbackModel: assign.heavy, signal,
            });
            return { role, text: out.text };
          } catch (e) {
            if (isAbort(e, signal)) throw e;
            bus.emit('agent_failed', { agent_id: role.id, error: e instanceof Error ? e.message : String(e), isolated: true }, { agentId: role.id });
            return { role, text: '' };
          }
        }),
      );

      // ④ 팀장이 팀원 산출물을 종합해 '부서 최종 산출물(문서)'을 작성(report phase). 검토·취합.
      bus.emit('phase', { team_id: team.id, phase: 'report' });
      // 빈 팀원 섹션 제외 — 리드 컨텍스트 오염 방지 + 아래 직결 폴백의 재료.
      const combined = memberOutputs.filter((o) => o.text.trim()).map((o) => `## ${o.role.name}\n${o.text}`).join('\n\n');
      const led = await runAgent({
        bus, role: team.lead, model: modelForTier(assign, team.lead.tier),
        task: `[${team.name}] 팀원 산출물을 종합해, 수용 기준을 준수하는 우리 부서의 최종 산출물(완성된 문서)을 작성하라.`,
        context: [acceptanceBlock, teamRoleBlock, `[팀원 산출물]\n${combined}`].filter(Boolean).join('\n\n'),
        stage: 'work', fallbackModel: assign.heavy, signal,
      });
      // 리드 종합이 비면 팀원 산출 직결 폴백 — 실측 2회(2026-08-10 입추·08-11 어린이 정원): 리드 1명의
      // 빈 출력이 정상 팀원 산출까지 폐기해 런 전체가 비었다. 미다듬 문서가 빈 산출물보다 낫고,
      // 하류(통합·집필)가 어차피 재구성한다.
      deliverable = led.text.trim() ? led.text : combined;
      if (!led.text.trim() && combined) bus.emit('log', { message: `[${team.name}] 리드 종합 빈 출력 — 팀원 산출 직결 폴백` });
      bus.emit('team_deliverable', { team_id: team.id, text: deliverable });
      bus.emit('phase', { team_id: team.id, phase: 'idle' }); // 팀 완료 → 팀장 '취합중' latch 해제(F3)
      // 자가학습(reflect) roster 는 개별 역할 id 로 매칭하므로, 팀 단위가 아니라 팀원 개별 산출물 + 팀장 종합을 전달한다.
      const participants = [
        ...memberOutputs.filter((o) => o.text.trim()).map((o) => ({ id: o.role.id, name: o.role.name, text: o.text })),
        { id: team.lead.id, name: team.lead.name, text: led.text },
      ];
      return { team, deliverable, participants };
    }),
  );

  // 빈 팀 산출물 제외 — 통합·다이제스트 오염 방지.
  const usableTeams = teamResults.filter((t) => t.deliverable.trim());
  if (usableTeams.length === 0) {
    // throw — 종전엔 빈 deliverable 로 resolve 해 런이 'done'으로 기록됐다(실측 2026-08-11: 사용자가
    // "완료인데 산출물이 없다"로 발견). launchRun 의 catch 가 error 기록·piece recordError 를 일관 처리한다.
    throw new Error('모든 팀이 빈 산출물 — 통합할 내용이 없습니다.');
  }

  // --- 팀 토론(옵트인: ORG_DEBATE_ROUNDS>0) — 팀 위계를 유지한 채 산출물을 비평→반박으로 정련한다.
  //     비평가가 전 팀 산출물의 교차 약점(모순·중복·누락·약한 근거)을 지적하면, 각 팀장이 비평+동료 팀
  //     산출물을 반영해 자기 산출물을 갱신(rebuttal)한다. 기본 0 이면 건너뛰어 기존 동작과 동일(회귀 0). ---
  const debateCritic = company.specialists.find((s) => s.isCritic);
  const debateRounds = getRunSettings().orgDebateRounds; // UI 토글(런타임) 우선 — 미설정이면 env 기본
  if (debateRounds > 0 && debateCritic) {
    bus.emit('log', { message: `팀 토론 ${debateRounds}라운드 — 비평→반박으로 팀 산출물 정련` });
  }
  for (let round = 1; round <= debateRounds && debateCritic && !signal?.aborted; round++) {
    bus.emit('phase', { team_id: '_ceo', phase: 'review' });
    // 1) 비평 — 전 팀 산출물의 교차 약점을 팀별로 지적
    const combined = usableTeams.map((t) => `## ${t.team.name}\n${t.deliverable}`).join('\n\n');
    const crit = await runAgent({
      bus, role: debateCritic, model: modelForTier(assign, debateCritic.tier),
      task: `라운드 ${round}: 각 팀 산출물을 비판적으로 검토하라. 팀 간 모순·중복·누락·약한 근거를 구체적으로 지적하고, 어느 팀이 무엇을 어떻게 보완해야 하는지 팀별로 명시하라.`,
      context: combined, stage: 'critique', emitSpawn: round === 1, signal,
    });
    bus.emit('critique', { round, text: crit.text }, { agentId: debateCritic.id });
    if (signal?.aborted) break;
    // 2) 반박/정련 — 각 팀장이 비평 + 동료 팀 산출물을 반영해 자기 산출물을 갱신(팀 단위 병렬)
    const revised = await mapLimit(
      CONFIG.teamParallel,
      usableTeams.map((t) => async (): Promise<TeamResult> => {
        try {
          // 토론 라운드 = 팀원이 회의 테이블에 모여 비평을 놓고 토의하는 모습(work 아님).
          // 'debate' phase 를 emit 해 OfficeView 가 팀장→상석·팀원→테이블 둘레로 모이게 한다.
          bus.emit('phase', { team_id: t.team.id, phase: 'debate' });
          const peers = usableTeams.filter((o) => o.team.id !== t.team.id)
            .map((o) => `## ${o.team.name} 산출물\n${o.deliverable}`).join('\n\n');
          const out = await runAgent({
            bus, role: t.team.lead, model: modelForTier(assign, t.team.lead.tier),
            task: `라운드 ${round} 반박: 아래 [비평]과 [동료 팀 산출물]을 반영해 '${t.team.name}'의 산출물을 보완·갱신하라.\n` +
              `- 지적된 약점·모순을 해소하고, 동료 팀과 중복되는 부분은 줄이며, 누락은 채워라.\n` +
              `- 기존의 실수치·근거([근거: ...])는 보존·강화하되 지어내지 마라(없으면 "⚠️ 데이터 없음").\n` +
              `- 차이만 쓰지 말고 갱신된 완성 산출물 전체를 출력하라.`,
            context: [`[비평]\n${crit.text}`, peers ? `[동료 팀 산출물]\n${peers}` : '', `[현재 ${t.team.name} 산출물]\n${t.deliverable}`].filter(Boolean).join('\n\n'),
            stage: 'rebuttal', signal,
          });
          const next = out.text.trim() || t.deliverable;
          if (next !== t.deliverable) bus.emit('team_deliverable', { team_id: t.team.id, text: next });
          bus.emit('phase', { team_id: t.team.id, phase: 'idle' });
          return { ...t, deliverable: next };
        } catch (e) {
          if (isAbort(e, signal)) throw e;
          return t; // 반박 실패 팀은 기존 산출물 유지
        }
      }),
    );
    for (let i = 0; i < usableTeams.length; i++) if (revised[i]) usableTeams[i] = revised[i]!;
  }

  // --- 회사급 비평(선택) — 토론 여부와 무관하게 **최종(반박 후) 산출물**을 신선하게 비평해 합성 입력으로
  //     쓴다. 토론 라운드 비평은 그 라운드의 '반박 전' 상태를 가리켜 합성엔 stale 하므로 여기서 재비평한다.
  //     (라운드 critic 은 반박을 구동하고, 이 회사급 critic 은 합성용 최종 비평 — 역할이 다르다.) ---
  const critic = company.specialists.find((s) => s.isCritic);
  let critiqueText = '';
  if (critic) {
    const combined = usableTeams.map((t) => `## ${t.team.name}\n${t.deliverable}`).join('\n\n');
    const c = await runAgent({
      bus, role: critic, model: modelForTier(assign, critic.tier),
      task: '각 팀 산출물을 비판적으로 검토하라. 약점·모순·누락을 지적하라.',
      context: combined, stage: 'critique', emitSpawn: true, signal,
    });
    critiqueText = c.text;
    bus.emit('critique', { round: 1, text: critiqueText }, { agentId: critic.id });
  }

  // --- 최종 블로그 본문 — 작가(content_lead)가 리서치 브리프[+검수 의견]를 통합해 단일 글 1편을 집필.
  //     구 8-섹션 CEO 문서 합성 + 결산 데이터감사 패스를 대체 — 비용·형태를 네이버 블로그(정보/하우투·리뷰)에 맞춘다.
  //     제작팀(작가)은 병렬 팀 단계에서 빠졌고, 여기서 리서치팀 브리프를 받아 단독 집필한다(리서치→집필 핸드오프). ---
  bus.emit('phase', { team_id: '_ceo', phase: 'integrate' });
  const writerModel = modelForTier(assign, writer.tier);
  const brief = usableTeams.map((t) => `## ${t.team.name}\n${t.deliverable}`).join('\n\n');
  // 지식 리서치 런 — 블로그 집필을 생략하고 팀 산출물 종합(brief)이 곧 산출물(리서치 보고서).
  // 조사→토론→두뇌 적재→직원 학습만 수행한다(SERP 조향·포장도 불필요).
  const research = opts.mission === 'research';
  if (research) bus.emit('log', { message: '지식 리서치 런 — 집필·포장 생략, 리서치 보고서를 두뇌(위키)에 적재' });
  // 인기 방향 조향 — 실제 네이버 블로그 상위 노출 글(실측 SERP)을 작가·제목 패키저에 주입(fail-open).
  const serpText = research ? '' : await serpPopularBrief(topic, signal);
  if (serpText) bus.emit('log', { message: `네이버 SERP 실측 — 상위 노출 ${serpText.split('\n').length - 1}건을 집필 방향에 반영` });
  const body = research ? '' : await writeBlogBody({ bus, writer, model: writerModel, topic, brief, critiqueText: critiqueText || undefined, serpText, personaGuide: personaPrompt(opts.persona, opts.personaText), keyword: opts.keyword, microModel: assign.micro, signal });
  const finalDeliverable = body || brief || usableTeams.map((t) => t.deliverable).join('\n\n');

  return packageDesignFinalize({
    bus, topic, company, assign, subproblems, teams: usableTeams,
    critic: critic ?? null, critiqueText, writerTeam, finalDeliverable, brief, serpText, keyword: opts.keyword,
    mission: opts.mission, signal,
  });
}

/**
 * 본문 확정 이후의 공통 꼬리 — 포장(포매터) → 이미지 디자이너 협의(슬롯 확정) → finalize(자산 저장·
 * 이미지 실생성·위키 적재·회고). 일반 런(runOrg)과 리비전 런(runOrgRevise)이 공유한다.
 */
async function packageDesignFinalize(a: {
  bus: EventBus;
  topic: string;
  company: NonNullable<RunOptions['company']>;
  assign: ModelAssignment;
  subproblems: Array<{ id: string; text: string }>;
  teams: TeamResult[];
  critic: { id: string; name: string } | null;
  critiqueText: string;
  writerTeam: TeamDef | null;
  finalDeliverable: string;
  brief: string;
  /** 네이버 SERP 실측(상위 노출 제목) — 제목 후보가 인기 패턴을 따르게 패키저에 전달. */
  serpText?: string;
  /** 핵심 타겟 키워드(piece.keyword) — 패키저 primaryKeyword 고정(재추출 방지). */
  keyword?: string;
  /** 지식 리서치 런 — 발행 포장(draft.json) 생략(캘린더 비오염). 위키 적재·자가학습은 그대로. */
  mission?: 'research';
  signal?: AbortSignal;
}): Promise<RunOutcome> {
  const { bus, topic, company, assign, subproblems, teams, critic, critiqueText, writerTeam, finalDeliverable, brief, serpText, keyword, mission, signal } = a;

  // 잔여 플레이스홀더/가짜수치 경고(생성 지침이 이미 금지 — 보통 0건).
  const placeholders = findTemplateNumbers(finalDeliverable);
  if (placeholders.length) {
    bus.emit('log', { message: `검증 — 잔여 플레이스홀더/가짜수치 ${placeholders.length}건: ${placeholders.slice(0, 6).join(', ')}` });
  }

  // --- 발행용 초안 포장 — org 본문을 제목·메타·태그·이미지 슬롯·SEO 점수로 포장(재생성 아님). 실패해도 본문은 유지.
  //     리서치 런은 통째로 생략 — draft.json 이 안 생겨 piece 승격·자동 네이버 임시저장이 자연 차단된다. ---
  let assets: AssetBundle | undefined;
  if (!signal?.aborted && mission !== 'research') {
    try {
      bus.emit('phase', { team_id: '_ceo', phase: 'review' });
      assets = await formatterFor('naver_blog')({ topic, body: finalDeliverable, researchBrief: brief, serpText, keyword, model: assign.micro, signal });
      bus.emit('log', { message: `초안 포장 — 제목 "${assets.meta.title}" · SEO ${assets.draft.seo.score}/100 · 태그 ${assets.draft.tags.length}개 · 이미지 ${assets.draft.imageSlots.length}슬롯` });
    } catch (e) {
      bus.emit('log', { message: `초안 포장 실패(본문 유지): ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // --- 이미지 협의·기획 — 제작팀 이미지 디자이너가 작가의 최종 카피를 검토해(협의) 슬롯(alt/프롬프트)을 확정.
  //     실제 파일 생성은 finalizeRun 의 generateImagesForDraft 가 '확정된 draft.json 슬롯'으로 수행한다.
  //     디자이너가 로스터에 없거나 OPENAI 키 미설정이면 통째로 건너뜀(기존 동작 불변, fail-open). ---
  let autoImages = false;
  const designer = writerTeam?.members.find((m) => (m.tools ?? []).includes('image_generate'));
  if (assets && designer && CONFIG.openaiApiKey && !signal?.aborted) {
    try {
      const slotLines = assets.draft.imageSlots.map((s, i) => `${i + 1}. ${s.alt} — ${s.prompt}`).join('\n') || '(초안 슬롯 없음)';
      const markers = [...finalDeliverable.matchAll(/\[IMAGE:([^\]]+)\]/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean).slice(0, 6);
      const plan = await runAgent({
        bus, role: designer, model: modelForTier(assign, designer.tier),
        task:
          '수석 작가의 최종 카피를 검토하고(협의), 본문 [IMAGE:] 슬롯과 글의 톤에 맞는 삽입 이미지 계획을 확정하라. ' +
          '각 이미지: alt(대체텍스트, 한국어) · prompt(생성 프롬프트 — 피사체·구도·스타일·조명, 한국 생활 맥락, 텍스트/워터마크/로고 금지, 150자 이내로 간결하게). ' +
          '최대 3장. 협의 코멘트는 1~2문장으로 짧게, 마지막 줄에 JSON 한 줄로 출력: {"images":[{"alt":"...","prompt":"..."}]}',
        context:
          `[작가 최종 카피(발췌)]\n${finalDeliverable.slice(0, 5000)}\n\n` +
          (markers.length ? `[본문 IMAGE 마커]\n${markers.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\n` : '') +
          `[슬롯 초안(편집자)]\n${slotLines}`,
        // 1600 토큰 — 한국어 상세 프롬프트 3개 + 코멘트가 700 에선 잘려 JSON 이 깨졌다(E2E 실측).
        stage: 'work', emitSpawn: true, groundWikiOnly: true, maxOutputTokens: 1600, signal,
      });
      const slots = parseImagePlan(plan.text, 3);
      if (slots.length) assets.draft.imageSlots = slots;
      autoImages = true;                               // 슬롯 확정 → finalize 가 실제 이미지 생성
      bus.emit('log', { message: `이미지 기획(${designer.name} 디자이너) — 슬롯 ${assets.draft.imageSlots.length}개 확정${slots.length ? '' : ' (계획 파싱 실패 — 편집자 슬롯 유지)'}` });
    } catch (e) {
      bus.emit('log', { message: `이미지 기획 실패(무해 — 프롬프트 슬롯 유지): ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  // 이미지 실생성이 예정된 런(finalize 게이트와 동일 조건)이면 draft.html 이 생성 파일(images/blog-image-0N.png)을
  // <img> 로 참조하게 재렌더 — 본문 [IMAGE:] 마커 위치에 이미지가 실제로 삽입된 미리보기가 된다.
  if (assets) {
    const imagesReady = !!CONFIG.openaiApiKey && (CONFIG.blogAutoImage || autoImages)
      && assets.draft.imageSlots.length > 0 && !signal?.aborted; // 키 없으면 dry-run(파일 미생성) — 자리표시 박스 유지
    assets.files = draftFiles(assets.draft, imagesReady); // 슬롯 갱신 반영 겸 재동기화
  }

  await finalizeRun({
    bus, topic, ceoId: company.ceo.id, ceoName: company.ceo.name,
    assignReason: assign.reason, subproblems,
    positions: teams.map((t) => ({ id: t.team.id, name: t.team.name, stance: 'neutral', text: t.deliverable })),
    participants: teams.flatMap((t) => t.participants), // 자가학습 roster — 팀원 개별 역할(F1)
    critique: critic && critiqueText ? { id: critic.id, name: critic.name, text: critiqueText } : undefined,
    deliverable: finalDeliverable, converged: false, ingestModel: assign.micro, reflectModel: assign.standard, assets, autoImages, signal,
  });

  return {
    deliverable: finalDeliverable, modelAssignment: assign,
    positions: teams.map((t) => ({ id: t.team.id, name: t.team.name, stance: 'neutral', text: t.deliverable })),
    subproblems,
  };
}

/**
 * 리비전 런(검토 탭 '수정 요청') — 분해·라우팅·팀 병렬·검수를 생략하는 fast-path.
 * 작가(수석 작가, 없으면 CEO)가 '기존 초안 + 검토자 피드백'으로 본문을 개정하고,
 * 이후 포장·이미지 디자이너 협의·finalize 는 일반 런과 동일하게 수행된다.
 */
async function runOrgRevise(bus: EventBus, opts: RunOptions, company: NonNullable<RunOptions['company']>): Promise<RunOutcome> {
  const { topic, signal } = opts;
  const revise = opts.revise!;
  bus.emit('phase', { team_id: '_ceo', phase: 'delegate' });
  const prep = await prepareRun(bus, topic, company, signal, undefined, /* skipDecompose */ true);
  if (!prep) throw new Error('no local models');
  const { assign } = prep;
  const allTeams = company.teams ?? [];
  const writerTeam = allTeams.find((t) => t.lead.stance === 'pro') ?? null;
  const writer = writerTeam?.lead ?? company.ceo;
  bus.emit('log', { message: `리비전 런 — 검토자 수정 요청 반영 개정(리서치·검수 생략): "${revise.feedback.slice(0, 120)}"` });
  bus.emit('phase', { team_id: '_ceo', phase: 'integrate' });
  const body = await writeBlogBody({
    bus, writer, model: modelForTier(assign, writer.tier), topic, brief: '', revise, signal,
  });
  const finalDeliverable = body || revise.baseBody;

  return packageDesignFinalize({
    bus, topic, company, assign, subproblems: [], teams: [],
    critic: null, critiqueText: '', writerTeam, finalDeliverable, brief: '',
    serpText: await serpPopularBrief(topic, signal), // 제목 재패키징도 인기 패턴 참고(fail-open)
    keyword: opts.keyword, signal,
  });
}
