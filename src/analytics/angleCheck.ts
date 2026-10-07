/**
 * 실검색 각도 검증(2026-09-21) — 후보 제목의 '내용'이 사람들이 실제로 치는 검색어 안에 있는가.
 *
 * 실측: 자율런이 "호두나무가 못 자라는 이유, 흙부터 점검하세요"를 냈는데, 시스템이 가진 근거는 수종 검색량
 * (호두나무 9,700/월)뿐이었다. 검색량 표는 키워드가 수종 하나이고, 자동완성 트렌드는 하루 시드 3개라 호두나무 뒤에
 * 사람들이 뭘 치는지 본 적이 없다. '흙'이라는 각도는 두뇌가 지어낸 것이다. 지시("인기 검색어에 등장하는 내용")가
 * 수종 수준까지만 반영되던 구멍.
 *
 * 설계: 후보의 수종명으로 네이버·유튜브 자동완성을 즉석 조회(공개 API, 키 없음) → 연관어에서 각도 토큰을 뽑아
 * 제목과 대조. 하나도 안 겹치면 '내용 미검증'으로 후순위(기각 아님 — 연관어가 비는 수종도 있다) + 다음 라운드
 * 노트에 연관어를 실어 그 안에서 각도를 잡게 한다. 조회 실패·연관어 없음은 통과(fail-open).
 */

import { looksLikeGardenQuery } from './discoverySeeds';

/** 각도 토큰으로 안 치는 말 — 문법·범용어. '이유'·'방법'은 어느 제목에나 있어 겹침의 근거가 못 된다. */
const STOP = new Set([
  '이유', '방법', '법', '하는', '되는', '있는', '없는', '좋은', '및', '그', '저', '안', '잘', '왜', '뭐', '어떻게', '언제',
  '나무', '추천', '뜻', '영어', '영어로', '한자', '판매', '파는곳', '파는', '구입', '구매', '사진', '그림', '이미지', '위치', '근처', '주변',
]);

/**
 * 자동완성 잡음 걸러내기(순수) — 실측(2026-09-21): '호두나무' 네이버 자동완성 8개 중 원예는 '호두나무 묘목' 하나,
 * 나머지는 캠핑장·식탁·한의원·도마·카페·떡방(상호·가구). '무궁화'는 무궁화호·반점·신탁. 원예 의도가 보이는
 * 구절만 각도 근거로 쓴다(discoverySeeds 의 GARDEN_INTENT_RE 와 같은 눈).
 */
export function gardenSuggestions(suggestions: readonly string[]): string[] {
  return suggestions.filter((q) => looksLikeGardenQuery(q));
}

/** 공백 제거·소문자(순수) — 제목과 토큰을 같은 꼴로 대조. */
const compact = (s: string): string => String(s ?? '').replace(/\s+/g, '').toLowerCase();

/**
 * 연관어 목록에서 각도 토큰(순수). 수종명(과 '나무' 뗀 어간)을 지우고 어절로 나눠, 2자 이상·불용어 아닌 것만.
 * 반환 순서는 첫 등장 순(자동완성 순위가 곧 수요 순위다).
 */
export function angleTokens(species: string, suggestions: readonly string[]): string[] {
  const sp = compact(species);
  const stem = sp.endsWith('나무') && sp.length >= 4 ? sp.slice(0, -2) : '';
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sug of suggestions) {
    let s = String(sug ?? '');
    if (sp) s = s.split(species).join(' ');
    if (stem) s = s.split(stem).join(' ');
    for (const w of s.split(/[\s,·/()]+/)) {
      const t = w.trim();
      if (t.length < 2 || STOP.has(t)) continue;
      const k = compact(t);
      if (!k || k === sp || (stem && k === stem) || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** 용언 어미 — 자동완성은 '심는 시기', 제목은 '심기 전' 식으로 어미가 갈린다. 어간에 이 어미들을 붙여 본다. */
const ENDINGS = ['는', '기', '은', '을', '고', '한', '할', '면'];
/** 토큰의 활용 변형(순수) — 어미로 끝나는 2자 이상 토큰만. '심는' → 심는·심기·심은·… */
function variants(k: string): string[] {
  if (k.length < 2 || !ENDINGS.includes(k.slice(-1))) return [k];
  const stem = k.slice(0, -1);
  return [k, ...ENDINGS.map((e) => stem + e)];
}

/**
 * 같은 각도로 보는 말 묶음(2026-10-07 사장님 "비슷한 말도 같은 각도로") — 실측: "모과나무 잎과 꽃으로 자를 가지를 먼저
 * 정하세요"가 연관어 '가지치기·전지'와 같은 주제인데 글자가 달라 각도 밖으로 기각됐다. 연관어 토큰이 어느 묶음의 말을
 * 품고 있으면, 제목에 그 묶음의 다른 말이 있어도 겹친 것으로 본다. 2자 이상 원예 용어만(한 글자 '물'·'때'는 오탐이라 뺀다).
 * 활용형은 직접 적는다(자르·자를·잘라) — 어간 하나로 묶으면 '자라는'(생장)까지 끌려온다.
 */
export const ANGLE_SYNONYMS: ReadonlyArray<readonly string[]> = [
  ['가지치기', '전정', '전지', '자르기', '자르는', '자를', '자른', '잘라', '잘린', '솎아', '순지르기', '수형'],
  ['심기', '심는', '심을', '심은', '식재', '옮겨심', '이식', '아주심'],
  ['묘목', '모종', '어린나무', '접목묘', '실생묘'],
  ['거름', '비료', '시비', '퇴비', '밑거름', '웃거름'],
  ['물주기', '물주는', '물을주', '관수', '급수'],
  ['병충해', '병해', '해충', '벌레', '깍지벌레', '진딧물', '방제', '약치기'],
  ['열매', '결실', '열리', '열린', '착과', '수확', '과실'],
  ['개화', '꽃눈', '꽃피', '꽃이피', '피는', '꽃봉오리'],
  ['월동', '겨울나기', '보온', '동해', '추위'],
  ['번식', '삽목', '꺾꽂이', '접목', '접붙이', '휘묻이'],
  ['키우기', '키우는', '재배', '기르기', '기르는', '관리'],
  ['안열려요', '안열림', '안열리', '열매가없', '열매없', '열매안'],
  ['마르고', '마르는', '마른', '말라', '시들', '갈변', '타들'],
  ['종류', '품종'],
  ['가격', '비용', '시세'],
];

/** 토큰이 품은 묶음들(순수). */
function synonymGroupsOf(k: string): Array<readonly string[]> {
  return ANGLE_SYNONYMS.filter((g) => g.some((w) => w.length >= 2 && k.includes(w)));
}

/** 제목이 각도 토큰과 겹치는가(순수) — 겹친 토큰 목록. 공백 제거 제목에 토큰(또는 그 활용 변형·같은 묶음의 말)이 들어 있어야 한다. */
export function angleMatches(title: string, tokens: readonly string[]): string[] {
  const t = compact(title);
  if (!t) return [];
  return tokens.filter((tok) => {
    const k = compact(tok);
    if (!k) return false;
    if (variants(k).some((v) => t.includes(v))) return true;
    // 긴 토큰은 마지막 글자를 뗀 어간으로도 본다('자라는'↔'자람', '열리는'↔'열림') — 2자는 오탐이라 제외.
    if (k.length >= 3 && t.includes(k.slice(0, -1))) return true;
    // 같은 각도의 다른 말(2026-10-07) — '전지' 연관어에 "자를 가지" 제목.
    return synonymGroupsOf(k).some((g) => g.some((w) => w.length >= 2 && t.includes(w)));
  });
}

export interface AngleVerdict {
  /** 'ok' 겹침 있음 · 'unverified' 연관어는 있는데 제목이 그 밖 · 'unknown' 연관어 없음(통과) */
  status: 'ok' | 'unverified' | 'unknown';
  matched: string[];
  /** 두뇌에 줄 연관어(상위 8개). */
  angles: string[];
}

/** 후보 판정(순수). */
export function angleVerdict(species: string, title: string, suggestions: readonly string[]): AngleVerdict {
  const tokens = angleTokens(species, gardenSuggestions(suggestions));
  const angles = tokens.slice(0, 8);
  if (!tokens.length) return { status: 'unknown', matched: [], angles };
  const matched = angleMatches(title, tokens);
  return { status: matched.length ? 'ok' : 'unverified', matched, angles };
}

/**
 * 검색 근거 없음(순수, 2026-10-07) — 연관어가 하나도 없고(unknown) 재배 수요도 0 으로 **잰** 수종. 종전엔 unknown 이 통과라
 * '아무도 안 찾는 주제'가 '찾는 사람은 있는데 각도만 벗어난 주제'(unverified → 후순위)보다 유리했다(실측: "설중매나무 월동" 채택,
 * 재배 검색 0·자동완성 없음 — 같은 틱의 무화과·밤나무·호두나무 각도 밖은 기각). 재배 수요를 못 쟀으면(undefined) 종전대로 통과.
 */
export function searchless(v: Pick<AngleVerdict, 'status'> | null, cultivation: number | undefined): boolean {
  return !!v && v.status === 'unknown' && cultivation === 0;
}

/** 다음 라운드 노트 한 줄(순수) — 두뇌가 이 안에서 각도를 잡게. */
export function angleNote(species: string, angles: readonly string[]): string {
  return angles.length ? `${species} 실검색 연관어: ${angles.join(' · ')} — 이 중 하나로 각도를 잡아라` : '';
}

/**
 * 우리 블로그 유입 검색어 중 그 수종 것(순수, 2026-10-07) — 자동완성은 '남들이 치는 말', 유입어는 '우리 글에 실제로
 * 들어온 말'이다(예: "마가목 묘목 심는 시기"). 연관어에 함께 넣어 각도 판정의 근거를 넓힌다. 수종명 또는 '나무' 뗀 어간 포함.
 */
export function inflowSuggestionsFor(species: string, queries: readonly string[]): string[] {
  const sp = compact(species);
  if (!sp) return [];
  const stem = sp.endsWith('나무') && sp.length >= 4 ? sp.slice(0, -2) : '';
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const k = compact(q);
    if (!k || seen.has(k) || !(k.includes(sp) || (stem && k.includes(stem)))) continue;
    seen.add(k);
    out.push(String(q).trim());
  }
  return out;
}
