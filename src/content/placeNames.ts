/**
 * 옛 행정구역 이름 → 현행 이름(2026-09-29 사장님 지적: "경북 금릉은 김천의 옛지명 같은데").
 *
 * 경위. 호두 주산지 사실이 외부 블로그(hae-su.tistory.com)에서 왔고, 그 블로그가 옮긴 농업 자료가
 * **1995년 이전** 행정구역을 쓴다 — 같은 문장의 표기가 "호도나무"인 것이 같은 근거다. 사실 게이트는
 * '출처에 충실'이 임무라 옛 이름을 그대로 통과시켰고, 발행 대기 초안에 "경북 … 상주·금릉",
 * "충남 천안·공주·온양"이 그대로 실렸다. 게이트가 고장 난 게 아니라 출처가 낡은 것이다.
 *
 * 그래서 사실을 받아 적는 자리(factSupply.attachRefs)에서 한 번 현행 이름으로 옮긴다. 거기 한 곳이면
 * 사실 공급 → 브리프 → 사실 카드 → 본문이 모두 따라온다.
 *
 * ⚠ **맹목적 치환은 위험하다.** '금릉'은 파주의 현행 지명이고(경의중앙선 금릉역), '온양'은 아산의
 * 온양온천으로 지금도 쓰인다. '이리'는 낱말이고 '충무'는 충무공·충무로가 있다. 그래서 두 가지를 지킨다.
 *  · **경계** — 앞뒤가 한글이면 안 바꾼다(금릉역·온양온천·금릉동은 그대로). 조사는 예외로 허용한다
 *    (온양에 → 아산에). 이 목록의 이름들은 '·'·쉼표·공백으로 나열되는 꼴이라 경계가 잘 잡힌다.
 *  · **충돌 회피** — 낱말과 겹치는 이름은 맨 이름을 넣지 않고 '시' 가 붙은 꼴만 넣는다(이리시·충무시·대천시).
 *
 * 목록은 1995년 도농복합시 통합으로 사라진 시·군이다. 늘려야 하면 같은 두 규칙을 지켜서 넣어라 —
 * 맨 이름이 다른 뜻으로 흔히 쓰이는지 한 번 검색해 보고, 애매하면 '시'·'군' 붙은 꼴만 넣는다.
 */

/** 옛 이름 → 현행 이름. 긴 열쇠가 먼저 잡히도록 순서를 지킨다(금릉군 이 금릉 보다 앞). */
export const OBSOLETE_PLACES: ReadonlyArray<readonly [string, string]> = [
  // 시·군이 붙은 꼴 — 맨 이름이 낱말과 겹치는 것은 이쪽만 둔다.
  ['금릉군', '김천시'],
  ['온양시', '아산시'],
  ['삼천포시', '사천시'],
  ['장승포시', '거제시'],
  ['동광양시', '광양시'],
  ['이리시', '익산시'],   // '이리'는 낱말('이리 와')이라 맨 이름은 안 넣는다
  ['충무시', '통영시'],   // '충무'는 충무공·충무로가 있다
  ['대천시', '보령시'],   // '대천'은 대천리·대천동이 여럿이다
  ['송탄시', '평택시'],
  // 맨 이름 — 다른 뜻으로 쓰일 일이 드문 것만.
  ['금릉', '김천'],
  ['온양', '아산'],
  ['삼천포', '사천'],
  ['장승포', '거제'],
  ['동광양', '광양'],
];

/** 뒤에 붙어도 같은 지명으로 보는 조사 — 없으면 "온양에" 가 안 잡힌다. */
const JOSA = '(?:이|가|은|는|을|를|의|에서|에|도|만|으로|로|와|과|부터|까지|보다|처럼)?';

/** 앞뒤가 한글이면 다른 낱말이다(금릉역·온양온천). 조사 뒤는 한글이 아니어야 한다. */
function patternFor(name: string): RegExp {
  return new RegExp(`(?<![가-힣])${name}(${JOSA})(?![가-힣])`, 'g');
}

/** 옛 이름을 현행으로 바꾼다(순수). 바꿀 것이 없으면 원문을 그대로 돌려준다. */
export function currentPlaceNames(text: string): string {
  let out = String(text ?? '');
  if (!out) return out;
  for (const [from, to] of OBSOLETE_PLACES) {
    if (!out.includes(from)) continue;
    out = out.replace(patternFor(from), (_m, josa: string) => `${to}${josa}`);
  }
  return out;
}

/** 실제로 바뀐 쌍 — 무엇을 손댔는지 로그로 남기려고 따로 센다(순수). 오탐을 사람이 잡을 유일한 창이다. */
export function obsoletePlacesIn(text: string): Array<{ from: string; to: string }> {
  const s = String(text ?? '');
  const out: Array<{ from: string; to: string }> = [];
  if (!s) return out;
  for (const [from, to] of OBSOLETE_PLACES) {
    if (!s.includes(from)) continue;
    if (!patternFor(from).test(s)) continue;
    // 긴 열쇠가 이미 잡은 자리는 두 번 세지 않는다(금릉군 을 셌으면 금릉 은 건너뛴다).
    if (out.some((x) => from.startsWith(x.from) || x.from.startsWith(from))) continue;
    out.push({ from, to });
  }
  return out;
}
