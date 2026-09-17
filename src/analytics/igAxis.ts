/**
 * 인스타 소재 축 성적(2026-09-04 사용자 확정) — 주제를 고를 때 '어느 각도로 잡을지'의 근거.
 *
 * 왜 인스타만 보는가. 유튜브 피드는 09-02 이후 노출이 끊겨 신호가 없고, 검색은 축이 아니라
 * 검색어 매칭이 레버다(ytSearchDemand). 지금 '피드에서 무엇이 먹히는가'를 말해 줄 수 있는
 * 채널은 인스타뿐이다 — 도달의 99.5%가 비팔로워 추천이라 순수한 추천 성적이다.
 *
 * 실측(111편, 2026-09-04):
 *   꽃·개화      8편  중앙 1,362      심기·자리   19편  중앙 818
 *   전정·가지치기 17편  중앙   943      열매·수확   12편  중앙 733
 *   관리·병해    10편  중앙   633      화분·실내    6편  중앙 491
 *   기타         39편  중앙   557   ← 가장 큰 덩어리가 최하위권
 *   전체 중앙 679
 *
 * 읽는 법이 중요하다. 최고 축과 최저 축의 차이는 2.8배로, 압도적이지는 않다. 진짜 문제는
 * 35%가 어느 축에도 안 걸린다는 것이다. 그래서 이 신호는 "이 소재를 다뤄라"가 아니라
 * "같은 소재라도 잘 먹히는 각도로 잡아라"로 쓴다 — 회양목 하나도 전정으로 잡을 수 있고
 * 심기로 잡을 수 있고 월동으로 잡을 수 있다.
 *
 * 축 분류는 표현 매칭이라 근사다. 정교한 분류기가 아니라 '기울이는 신호'로만 쓴다.
 *
 * '이야기·유래' 축(2026-09-18) — 읽을 거리 편(전설·꽃말·유래·역사·명소)이 블로그에 들어오면서(topicThemes 이야기 5축)
 * 그 파생 숏폼이 '기타'로 떨어졌다. 기타는 최하위 축이라 이 블록이 "기타로 읽히지 않게 하라"고 매 틱 말하는 것과
 * 두뇌 프롬프트의 "8개 중 2개는 읽을 거리"가 정면 충돌한다. 자기 칸을 주면 (1) 그 충돌이 사라지고 (2) 이야기 편의
 * 인스타 성적을 재배 축과 나란히 잴 수 있다. 판정 표현은 content/loreTopic 이 한 벌로 갖고 있다. 맨 앞에 두는
 * 이유: '꽃말'은 '꽃'을, '보호수'는 '보호'를 품어 뒤에 두면 꽃·개화/관리·병해가 먼저 잡는다.
 */
import { CONFIG } from '../config';
import { LORE_TOPIC_RE } from '../content/loreTopic';

export interface AxisPerf { readonly axis: string; readonly count: number; readonly median: number }

/** 소재 축 — 이름과 판별 표현. 앞에서부터 먼저 걸리는 축을 쓴다(구체적인 것을 앞에). */
export const AXIS_LORE = '이야기·유래';

export const IG_AXES: ReadonlyArray<{ axis: string; test: RegExp }> = [
  { axis: AXIS_LORE, test: LORE_TOPIC_RE },
  { axis: '전정·가지치기', test: /전정|가지치기|자르|잘라|솎|삽목|접목/ },
  { axis: '꽃·개화', test: /꽃|개화|봉오리|화단/ },
  { axis: '열매·수확', test: /열매|수확|과실|당도|익는/ },
  { axis: '화분·실내', test: /화분|베란다|실내|분갈이/ },
  { axis: '심기·자리', test: /심기|식재|이식|자리|생울타리|묘목/ },
  { axis: '관리·병해', test: /물주기|거름|비료|병해|해충|월동|보호/ },
];

/**
 * 이 주제가 '화분·실내' 재배 이야기인가(순수).
 *
 * 축 분류와 같은 표현을 쓴다 — 두 곳이 갈라지면 한쪽만 고쳐 놓고 고쳤다고 믿게 된다.
 * 쓰임은 다르다. 축 분류는 성적을 묶는 데 쓰고, 이 함수는 이미지 프롬프트가 화분·받침
 * 같은 컨테이너 소품을 넣어도 되는지 판정하는 데 쓴다.
 *
 * 왜 필요한가(실측 2026-09-06). "대추나무 결실주" 편의 씬2 프롬프트에 생활감 로테이션이
 * "색이 바랜 화분, 물 자국이 남은 받침"을 넣었다. 결실주는 과수원 나무인데 화분을 지시하니
 * 모델이 화분에 심긴 관엽식물을 그렸고, 대추나무가 아니게 됐다.
 */
export function isContainerTopic(text: string): boolean {
  const t = String(text ?? '');
  if (!t.trim()) return false;
  return (IG_AXES.find((a) => a.axis === '화분·실내')?.test ?? /$^/).test(t);
}

/** 축에 안 걸리는 소재의 이름 — 실측에서 가장 큰 덩어리이자 최하위권이다. */
export const AXIS_NONE = '기타';

/** 지금 켜진 축 — SHORTS_LORE=off 면 이야기 축을 빼서 종전 6축(이야기 편은 기타)으로 돌아간다. */
function activeAxes(): ReadonlyArray<{ axis: string; test: RegExp }> {
  return CONFIG.shortsLore ? IG_AXES : IG_AXES.filter((a) => a.axis !== AXIS_LORE);
}

/** 텍스트가 어느 축인가(순수). 어느 것에도 안 걸리면 AXIS_NONE. */
export function classifyAxis(text: string): string {
  const t = String(text ?? '');
  if (!t.trim()) return AXIS_NONE;
  return activeAxes().find((a) => a.test.test(t))?.axis ?? AXIS_NONE;
}

/** 중앙값(순수). 빈 배열은 0. */
function median(a: readonly number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/**
 * 편별 (텍스트, 조회수) → 축별 성적(순수). 표본이 minCount 미만인 축은 뺀다 —
 * 2~3편으로 만든 중앙값을 근거로 주제를 기울이면 잡음을 따라가게 된다.
 */
export function axisPerformance(
  rows: ReadonlyArray<{ text: string; views: number }>, minCount = 5,
): AxisPerf[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const v = Number(r?.views);
    if (!Number.isFinite(v) || v < 0) continue;
    const a = classifyAxis(r.text);
    by.set(a, [...(by.get(a) ?? []), v]);
  }
  return [...by.entries()]
    .filter(([, vs]) => vs.length >= minCount)
    .map(([axis, vs]) => ({ axis, count: vs.length, median: median(vs) }))
    .sort((x, y) => y.median - x.median);
}

/**
 * 주제 제안 프롬프트에 넣을 축 블록(순수).
 *
 * "이 소재를 다뤄라"가 아니라 "각도를 이렇게 잡아라"로 쓴다. 축은 소재가 아니라 프레이밍이고,
 * 같은 수종도 전정·심기·월동 어느 쪽으로든 잡을 수 있다. 계절과 싸우지 않게 하는 것도 이 때문이다.
 */
export function axisBlock(perf: readonly AxisPerf[]): string {
  if (perf.length < 2) return '';
  const top = perf.slice(0, 2).map((p) => p.axis);
  const none = perf.find((p) => p.axis === AXIS_NONE);
  return [
    '[인스타 소재 축 성적 — 같은 소재라도 어느 각도로 잡느냐로 도달이 갈린다(실측 중앙값)]',
    ...perf.map((p) => `- ${p.axis}: 중앙 ${p.median.toLocaleString()}회 (${p.count}편)`),
    '',
    `· 각도를 정할 때 위쪽 축(${top.join(', ')})으로 잡을 수 있으면 그렇게 잡아라.`,
    '· 축은 소재가 아니라 프레이밍이다 — 같은 수종도 전정으로, 심기로, 월동으로 잡을 수 있다.',
    none
      ? `· 다만 어느 축에도 안 걸리는 주제가 가장 많고(${none.count}편) 성적도 낮다(중앙 ${none.median.toLocaleString()}회). 주제를 정했으면 그 주제가 위 축 중 하나로 읽히는지 확인하라.`
      : '',
    // 이야기 축은 5편이 쌓이기 전엔 표에 안 나온다(minCount) — 그동안 위 '기타' 문장이 이야기 후보를 재배 각도로
    // 되돌리지 않게 못박는다. 표에 오르면 이 줄은 빠지고 숫자가 말한다.
    CONFIG.shortsLore && !perf.some((p) => p.axis === AXIS_LORE)
      ? '· 읽을 거리(전설·꽃말·유래·역사·명소 이야기)는 아직 표본이 없어 이 표에 없다 — 축 성적을 이유로 이야기 후보를 빼거나 재배 각도로 바꾸지 마라. 이야기 편은 따로 잰다.'
      : '',
    '· 계절과 싸우지 마라. 지금 시기에 맞지 않는 축이면 이 신호보다 시의성이 우선이다.',
  ].filter(Boolean).join('\n');
}
