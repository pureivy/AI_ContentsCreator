// 종 프리셋 스키마(2026-10-23 스타일 B) — 식물은 반드시 종 프리셋으로 그린다(임의 모양 금지).
// 같은 모양의 JSON(species/*.json)을 src 쪽에서도 읽을 수 있다 — parseSpeciesProfile 로 검사 후 쓴다.
// 프리셋 없는 수종은 GENERIC_BROADLEAF(일반 활엽수)로 그리고 보고한다.

export type LeafShape = 'ovate' | 'elliptic' | 'lanceolate' | 'obovate' | 'orbicular' | 'cordate' | 'palmate' | 'pinnate';
export type LeafMargin = 'entire' | 'serrate' | 'doubleSerrate' | 'undulate' | 'lobed';
export type LeafSpec = {
  /** 엽형 */ shape: LeafShape;
  /** 엽연 */ margin: LeafMargin;
  /** 맥 — 우상맥·장상맥 */ venation: 'pinnate' | 'palmate';
  /** 엽서 — 어긋나기·마주나기·돌려나기 */ arrangement: 'alternate' | 'opposite' | 'whorled';
  /** 잎몸 폭 / 길이 */ widthRatio: number;
  tip: 'acuminate' | 'acute' | 'obtuse' | 'rounded';
  base: 'cuneate' | 'rounded' | 'cordate' | 'truncate';
  /** 잎자루 길이 / 잎몸 길이(실제 비 — 음나무처럼 잎자루가 잎몸만큼 길면 1 이상) */ petiole: number;
  /** 잎몸 길이(cm) 범위 — 잎자루 빼고. 12cm 를 넘는 큰 잎은 키트가 가지를 성기고 굵게, 잎을 가지 끝에 모아 그린다. */ sizeCm: [number, number];
  /** 곁맥 쌍 수(우상맥) 또는 주맥 수(장상맥) */ veins: number;
  /** 손바닥 갈래 수(palmate) · 작은잎 쌍 수(pinnate) */ lobes?: number;
  /** 광택(지우개 윤기 띠) */ glossy?: boolean;
  /** 잎 처짐(0 곧게 ~ 1 늘어짐) */ droop?: number;
  /** 가장 넓은 자리(0 밑 ~ 1 끝, 선택 — 없으면 엽형 기본값). 감 0.55 = 가운데나 조금 위. */ peak?: number;
};
export type FlowerSpec = {
  /** 꽃잎(갈래) 수 */ petals: number;
  /** 모양 — urceolate(항아리·종)·open(펼친 접시)·tubular(통) */ shape: 'urceolate' | 'open' | 'tubular';
  petalShape?: 'round' | 'oval' | 'notched' | 'pointed';
  double?: boolean;
  /** 꽃받침 — small·large(감처럼 큼)·none */ calyx: 'small' | 'large' | 'none';
  /** 수술 — many(다발)·few·hidden */ stamens: 'many' | 'few' | 'hidden';
  /** 꽃차례 */ inflorescence: 'solitary' | 'corymb' | 'raceme' | 'panicle';
  /** 피는 자리 */ position: 'axil' | 'tip' | 'oldWood';
  sizeCm: number;
  months: number[];
  /** 꽃 고개 — 아래로 숙임(항아리꽃) */ nodding?: boolean;
};
export type FruitSpec = {
  /** 형태 */ type: 'persimmon' | 'pome' | 'pear' | 'drupe' | 'berry' | 'jujube' | 'chestnut';
  /** 세로/가로(편구형 < 1) */ ratio: number;
  sizeCm: [number, number];
  /** 달리는 방식 */ bearing: 'single' | 'cluster';
  /** 송이 열매 수(cluster) */ clusterN?: number;
  months: number[];
};
export type HabitSpec = {
  /** 수형 — 직립·개장·원개·수양·관목(다간) */ form: 'upright' | 'spreading' | 'round' | 'weeping' | 'shrub';
  /** 곁가지 벌어짐(도) */ branchAngle: number;
  /** 정아 우세(0 약함 ~ 1 강함 — 중심 줄기가 곧게 위로) */ apical: number;
  /** 수관 너비/높이 */ crownWH: number;
  /** 다 자란 키(m) 범위 */ heightM: [number, number];
  /** 관목 줄기 수 */ stems?: number;
  /** 수피 — 거북등(blocky)·세로 골(furrowed)·매끈(smooth)·벗겨짐(peeling) */ bark: 'blocky' | 'furrowed' | 'smooth' | 'peeling';
  /** 줄기·가지에 가시가 있음(음나무·두릅·탱자 등, 선택) — 어린 나무는 줄기·가지 모두, 성목은 가지에 그린다. */ prickles?: boolean;
};
export type SpeciesProfile = {
  id: string; nameKo: string; latin: string;
  /** 형태 근거 출처(도감·실촬영 등) */ sources: string[];
  habit: HabitSpec; leaf: LeafSpec; flower: FlowerSpec; fruit: FruitSpec;
  /** 잎 나는 달·잎 지는 달 */ leafOutMonth: number; leafFallMonth: number;
};

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** JSON 검사 — 문제 목록(빈 배열이면 통과). src 쪽에서 프리셋 JSON 을 읽을 때 쓴다. */
export function checkSpeciesProfile(x: unknown): string[] {
  const p = x as Partial<SpeciesProfile>;
  const out: string[] = [];
  if (!p || typeof p !== 'object') return ['객체 아님'];
  for (const k of ['id', 'nameKo', 'latin'] as const) if (typeof p[k] !== 'string') out.push(`${k} 없음`);
  if (!p.habit || !isNum(p.habit.branchAngle) || !isNum(p.habit.crownWH)) out.push('habit 불완전');
  if (!p.leaf || !isNum(p.leaf.widthRatio) || !Array.isArray(p.leaf.sizeCm)) out.push('leaf 불완전');
  if (!p.flower || !isNum(p.flower.petals)) out.push('flower 불완전');
  if (!p.fruit || !isNum(p.fruit.ratio) || !Array.isArray(p.fruit.sizeCm)) out.push('fruit 불완전');
  return out;
}
export function parseSpeciesProfile(x: unknown): SpeciesProfile {
  const bad = checkSpeciesProfile(x);
  if (bad.length) throw new Error(`종 프리셋 형식 오류: ${bad.join(', ')}`);
  return x as SpeciesProfile;
}
