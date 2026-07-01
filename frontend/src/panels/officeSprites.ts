// 오피스 뷰 스프라이트 — 참고 프로젝트(AI_Contents_Office/office-view)의 멀티포즈 아바타 재사용.
// 콘텐츠 역할 → 캐릭터 매핑 + 상태→포즈 선택(순수). 스프라이트는 /sprites/<char>_<pose>.png.
// 참고 엔진: sit/stand/walk 포즈, 좌향은 walkR/sit_right 를 좌우 반전(scaleX(-1))해 재사용.

export type Pose = "stand" | "sit_front" | "sit_right" | "lounge" | "walkF1" | "walkF2" | "walkR1" | "walkR2";

// 역할 id → 스프라이트 캐릭터(참고 아바타 세트). 캐릭터가 역할과 맞는 것으로 재사용.
const ROLE_SPRITE: Record<string, string> = {
  ceo: "main",             // 편집장·총괄 → 오케스트레이터
  content_lead: "blogger", // 수석 작가 → 블로거
  perf_analyst: "analyst", // 성과 분석가 → 분석
  reviewer: "critic-fact", // 팩트체커·리뷰어 → 팩트검증
  research_lead: "propose", // 리서치·전략 디렉터 → 주제제안
  trend_researcher: "reflect",   // 트렌드 리서처 → 회고
  seo_strategist: "wiki-ingest", // SEO 전략가 → 지식정리
};

/** 역할 id/레벨/직무 → 스프라이트 캐릭터. 매칭 없으면 null(이모지 폴백). */
export function spriteFor(id = "", level = "", title = ""): string | null {
  if (ROLE_SPRITE[id]) return ROLE_SPRITE[id];
  const k = (id + " " + title).toLowerCase();
  if (level === "ceo" || /편집장|총괄|editor|chief/.test(k)) return "main";
  if (/작가|카피|content|writer|copy/.test(k)) return "blogger";
  if (/성과|분석|analyst|perf/.test(k)) return "analyst";
  if (/리뷰|팩트|검증|비평|review|critic|fact/.test(k)) return "critic-fact";
  if (/디렉터|research_lead|기획|propose/.test(k)) return "propose";
  if (/트렌드|trend|리서처|reflect/.test(k)) return "reflect";
  if (/seo|키워드|keyword|wiki/.test(k)) return "wiki-ingest";
  if (level === "lead") return "propose";   // 미지 리드 폴백
  return null;
}

/**
 * 상태·이동 → 포즈 + 좌우반전. 참고 엔진 pose-selection 이식:
 *  - 이동 중: 아래로(정면) 이동이면 walkF 워크사이클, 그 외엔 walkR(좌향이면 반전).
 *  - 작업(책상): sit_front · 휴식: lounge · 그 외(회의·잡담·커피·통화·유휴): stand.
 */
export function poseFor(
  actKind: string, walking: boolean, movingDown: boolean, frame: 0 | 1, faceLeft: boolean,
  face: "up" | "down" | "left" | "right" = "down",
): { pose: Pose; flip: boolean } {
  if (walking) {
    if (movingDown) return { pose: frame ? "walkF2" : "walkF1", flip: false };
    return { pose: frame ? "walkR2" : "walkR1", flip: faceLeft };
  }
  if (actKind === "rest") return { pose: "lounge", flip: false };
  if (actKind === "work") {
    // 데스크 방향에 맞춰 착석 포즈 — 좌우 열은 측면 착석(sit_right, 한쪽은 반전), 상하 행은 정면.
    if (face === "left") return { pose: "sit_right", flip: true };   // 오른쪽 열(왼쪽을 봄)
    if (face === "right") return { pose: "sit_right", flip: false };  // 왼쪽 열(오른쪽을 봄)
    return { pose: "sit_front", flip: false };
  }
  return { pose: "stand", flip: false }; // chat/huddle/coffee/phone/idle
}
