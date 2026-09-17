/**
 * 읽을 거리(이야기) 주제 판정 — 순수(2026-09-18).
 *
 * 토큰은 data/brands/bionditree.yaml topicThemes 의 이야기 5축(전설·설화·민담 / 꽃말·상징·이름 유래 /
 * 역사·문화·쓰임새 / 문학·예술 속 나무 / 명소·군락지·풍경) match 목록을 그대로 옮긴 것이다. '노래 속'처럼
 * 구절형인 이유는 부분 문자열 가로채기(노래→노래기, 그림→그림자, 상징→"가을의 상징") 실측(2026-09-17) 때문 —
 * 축 목록을 고치면 여기도 같이 고친다.
 *
 * 쓰는 곳: 인스타 축 성적의 '이야기·유래' 축(analytics/igAxis), 숏폼 기획 장르 분기(content/shortsGenre).
 * scheduler.lacksSpeciesAnchor 의 트리거(꽃말|유래|전설|설화|민담|신화)는 목적이 다르다(총칭·화초로 미끄러지는
 * 후보만 잡는다) — 일부러 좁게 둔 것이니 여기로 합치지 마라.
 */
export const LORE_TOKENS: readonly string[] = [
  '전설', '설화', '민담', '옛이야기', '신화',
  '꽃말', '유래', '이름의 뜻', '이름 뜻', '라 부르는 이유',
  '역사', '궁궐', '서원', '마을 나무', '목재로', '약재로', '풍습', '옛날에는',
  '시 속', '소설 속', '그림 속', '노래 속', '시조', '민요', '문학 속',
  '명소', '군락', '가로수길', '숲길', '천연기념물', '보호수',
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 이야기 토큰 하나라도 걸리면 매치 — 축 분류(igAxis)의 test 로도 그대로 쓴다. */
export const LORE_TOPIC_RE = new RegExp(LORE_TOKENS.map(escapeRe).join('|'));

/** 제목·주제 문장이 읽을 거리(이야기) 주제인가. 빈 문자열은 false. */
export function isLoreTopic(text: string): boolean {
  const t = String(text ?? '');
  if (!t.trim()) return false;
  return LORE_TOPIC_RE.test(t);
}
