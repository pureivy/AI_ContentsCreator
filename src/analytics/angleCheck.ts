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

/** 제목이 각도 토큰과 겹치는가(순수) — 겹친 토큰 목록. 공백 제거 제목에 토큰(또는 그 활용 변형)이 들어 있어야 한다. */
export function angleMatches(title: string, tokens: readonly string[]): string[] {
  const t = compact(title);
  if (!t) return [];
  return tokens.filter((tok) => {
    const k = compact(tok);
    if (!k) return false;
    if (variants(k).some((v) => t.includes(v))) return true;
    // 긴 토큰은 마지막 글자를 뗀 어간으로도 본다('자라는'↔'자람', '열리는'↔'열림') — 2자는 오탐이라 제외.
    return k.length >= 3 && t.includes(k.slice(0, -1));
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

/** 다음 라운드 노트 한 줄(순수) — 두뇌가 이 안에서 각도를 잡게. */
export function angleNote(species: string, angles: readonly string[]): string {
  return angles.length ? `${species} 실검색 연관어: ${angles.join(' · ')} — 이 중 하나로 각도를 잡아라` : '';
}
