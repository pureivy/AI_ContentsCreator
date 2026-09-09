/**
 * 편집 기법 뽑기(2026-09-04) — 편마다 '쓰는 기술 자체'가 달라지게.
 *
 * 종전엔 파라미터만 갈렸다. 실측: 8편을 돌려 보면 '사용된 기술 목록'이 2가지 조합뿐이었고,
 * 매 편 같은 9종(필름룩·자막모션·켄번즈·드리프트·컷빛샘·진행바·캘리·스포트라이트·파티클)을 썼다.
 * 색과 리듬이 달라도 '무엇을 쓰는가'가 같으면 편집 방식이 하나로 읽힌다.
 *
 * 그래서 선택 기법 풀을 두고 편마다 2가지를 뽑는다. 각 기법 안에서 또 파라미터가 갈린다.
 *
 * 풀에 넣는 기준:
 *  · 씬 길이를 안 바꾼다 — 낭독이 길이를 지배한다는 불변식은 절대 못 건드린다.
 *  · 화면의 '어디'를 알 필요가 없다 — 였는데, 2026-09-09 에 좌표 기법 셋을 들이면서 조건부로 풀었다.
 *    작가는 여전히 이미지를 못 보지만, 씬 QA(비전)가 이미지를 직접 보고 '핵심 부위 중심'을 focus 로
 *    돌려준다. 좌표가 있는 씬에만 건다(TECHNIQUES_NEED_FOCUS) — 없으면 그 기법은 이번 편에서 빠진다.
 */
import { random } from 'remotion';

/**
 * 풀 개편(2026-09-08 사장님 확정) — '흑백 인서트'를 뺐다. 나무 색(붉은 잎·초록 새순)이 곧 정보인 채널에서 색을 빼는
 * 기법은 안 맞는다(실측: 공작단풍 유튜브편 3번 씬이 회색으로 나갔다). 대신 다섯 가지를 넣었다.
 *  · 컬러 팝 — 씬 들어갈 때 0.6초쯤 채도·생동감이 올랐다 내려온다(흑백의 정반대). Scene 의 effects 에서.
 *  · 아이리스 리빌 — 씬이 원형으로 열리며 시작한다. Scene 의 clipPath 에서.
 *  · 소프트 글로우 — 밝은 부분에 부드러운 빛번짐(꽃·역광 잎). Scene 의 effects 에서.
 *  · 핸드헬드 흔들림 — 정지 이미지 씬에 아주 작은 손떨림. Scene 의 transform 에서. 실촬영 씬 제외(이중 흔들림).
 *  · 초점 띠 — 위아래를 살짝 흐리고 가운데 띠만 선명(틸트시프트). TechniqueLayer 에서. 실촬영 씬 제외(잎 디테일).
 *
 * 2차 확장(2026-09-09 사장님 확정) — 종전 9종이 전부 '화면 전체의 분위기'였다. 시선을 한 지점으로 모으는
 * 기법과 씬 사이를 잇는 기법이 없었다. 다섯을 더 넣었다.
 *  · 포인터 링 — 초점 좌표에 원이 조여들며 짚는다(자를 자리·접목 자리). TechniqueLayer. 좌표 필요.
 *  · 스포트라이트 — 초점만 밝고 주변은 어둡게. TechniqueLayer. 좌표 필요.
 *  · 인셋 확대창 — 귀퉁이 둥근 창에 초점 부위를 2배쯤 확대해 띄운다(굵기·잎 갈래). InsetZoom. 좌표+정지 이미지 필요.
 *  · 키워드 팝 — 자막 속 핵심 단어만 커지며 색이 붙는다. KineticCaption 의 pop.
 *  · 줌 스루 전환 — 앞 씬 끝에서 확대되며 다음 씬으로 뚫고 들어간다. Scene 의 transform·filter(앞 씬 exitZoom).
 */
export type EditTechnique =
  | '레터박스' | '정지 강조' | '테두리 프레임' | '비네트 호흡'
  | '컬러 팝' | '아이리스 리빌' | '소프트 글로우' | '핸드헬드 흔들림' | '초점 띠'
  | '포인터 링' | '스포트라이트' | '인셋 확대창' | '키워드 팝' | '줌 스루 전환';
export const EDIT_TECHNIQUES: readonly EditTechnique[] = [
  '레터박스', '정지 강조', '테두리 프레임', '비네트 호흡',
  '컬러 팝', '아이리스 리빌', '소프트 글로우', '핸드헬드 흔들림', '초점 띠',
  '포인터 링', '스포트라이트', '인셋 확대창', '키워드 팝', '줌 스루 전환',
];
/** 한 편이 뽑는 기법 수 — 2개. 하나면 티가 안 나고, 셋이면 서로 싸운다. */
export const TECHNIQUES_PER_VIDEO = 2;

/**
 * 편 시드 → 뽑힌 기법 순서(순수·결정적·중복 없음).
 * 같은 편은 재렌더해도 같은 기법을 받는다. count 를 풀 크기로 주면 '전체 우선순위'가 된다(assignTechniques).
 */
export function pickTechniques(seed: string, count = TECHNIQUES_PER_VIDEO): EditTechnique[] {
  const pool = [...EDIT_TECHNIQUES];
  const out: EditTechnique[] = [];
  // 상한을 루프 밖에서 고정한다 — 안에서 pool.length 를 다시 읽으면 splice 로 줄어든 길이가
  // 상한까지 끌어내려 요청한 개수보다 적게 뽑힌다(테스트가 5개 요청에 3개를 잡아냈다).
  const want = Math.min(count, pool.length);
  for (let i = 0; i < want; i++) {
    const k = Math.floor(random(`${seed}:tech:${i}`) * pool.length) % pool.length;
    out.push(pool.splice(k, 1)[0]!);
  }
  return out;
}

/**
 * 실촬영 화면에 걸면 안 되는 기법(2026-09-04 실측).
 *
 * 사장님이 찍어 올린 사계장미 영상이 하필 '흑백 인서트'가 걸린 씬에 들어가 흑백으로 나갔다.
 * 실촬영을 쓰는 값어치는 화면이 진짜로 보이는 데 있는데 색을 빼면 그게 사라진다. '정지 강조'도
 * 같은 이유로 뺀다 — 실제로 찍은 화면을 세워 두면 영상을 쓴 이유 자체가 없어진다.
 * 나머지(레터박스·테두리·비네트)는 화면 위에 얹히기만 하므로 실촬영에도 무해하다.
 */
// 2026-09-08: 흑백 인서트는 풀에서 빠졌고, 핸드헬드(영상 위 이중 흔들림)·초점 띠(잎 디테일 흐림)를 추가로 피한다.
// 2026-09-09: 인셋 확대창은 정지 이미지를 확대해 띄우는 것이라 영상 씬에는 못 건다.
export const TECHNIQUES_UNSAFE_ON_REAL: readonly EditTechnique[] = ['정지 강조', '핸드헬드 흔들림', '초점 띠', '인셋 확대창'];

/**
 * 실촬영 씬에만 거는 기법(2026-09-09 사장님 확정 "테두리 프레임은 보관소 영상이 나올 때만").
 * 인화지 테두리는 '진짜 찍은 한 장을 붙여 놓은' 느낌이라, 생성 이미지에 걸면 거짓 신호가 된다.
 * 실촬영 씬이 없는 편에서는 이 기법이 빠지고 다음 후보로 넘어간다.
 */
export const TECHNIQUES_ONLY_ON_REAL: readonly EditTechnique[] = ['테두리 프레임'];

/**
 * 초점 좌표가 있어야 걸 수 있는 기법(2026-09-09) — 씬 QA 가 이미지에서 읽은 '핵심 부위 중심'을 쓴다.
 * 좌표 없이 화면 가운데를 짚으면 엉뚱한 곳을 가리키는 것이니, 좌표가 없는 씬에는 아예 안 건다.
 */
export const TECHNIQUES_NEED_FOCUS: readonly EditTechnique[] = ['포인터 링', '스포트라이트', '인셋 확대창'];

/**
 * 기법이 걸릴 씬 번호(순수) — 씬마다 다 걸면 기법이 아니라 필터가 된다.
 * 훅(0)은 뺀다: 첫 프레임이 곧 커버라 여기를 건드리면 커버가 바뀐다(2026-09-03 실사고).
 *
 * realScenes 는 실촬영 화면이 들어간 씬 번호다. 파괴적인 기법은 그 씬을 피해서 고르고,
 * 피할 자리가 없으면 아예 안 건다(-1) — 억지로 거느니 안 거는 편이 낫다.
 * focusScenes 는 초점 좌표가 있는 씬 번호다. 좌표 기법은 그 안에서만 고른다.
 */
export function techniqueScene(
  seed: string, tech: EditTechnique, sceneCount: number,
  realScenes: ReadonlySet<number> = new Set(), focusScenes: ReadonlySet<number> = new Set(),
): number {
  if (sceneCount <= 2) return -1; // 본문이 없으면 걸 자리도 없다
  const body: number[] = [];
  const avoid = TECHNIQUES_UNSAFE_ON_REAL.includes(tech);
  const onlyReal = TECHNIQUES_ONLY_ON_REAL.includes(tech);
  const needFocus = TECHNIQUES_NEED_FOCUS.includes(tech);
  for (let i = 1; i < sceneCount - 1; i++) { // 훅·CTA 제외
    if (avoid && realScenes.has(i)) continue;
    if (onlyReal && !realScenes.has(i)) continue;
    if (needFocus && !focusScenes.has(i)) continue;
    body.push(i);
  }
  if (!body.length) return -1;
  return body[Math.floor(random(`${seed}:techscene:${tech}`) * body.length) % body.length]!;
}

/**
 * 편 하나의 기법 배정(순수) — 씬 번호 → 기법. count 개가 자리를 잡을 때까지 시드 순서대로 시도한다.
 *
 * 종전엔 2개를 뽑고 못 거는 것은 그냥 버렸다. 좌표 기법이 들어오면서 '못 거는' 경우가 흔해졌다
 * (초점 좌표가 없는 편). 버리는 대신 다음 후보로 넘어가야 편마다 2개가 실제로 걸린다.
 * 한 씬에 하나만 — 둘이 겹치면 서로 싸운다.
 */
export function assignTechniques(
  seed: string, sceneCount: number,
  realScenes: ReadonlySet<number> = new Set(), focusScenes: ReadonlySet<number> = new Set(),
  count = TECHNIQUES_PER_VIDEO,
): Map<number, EditTechnique> {
  const out = new Map<number, EditTechnique>();
  if (!seed) return out;
  for (const t of pickTechniques(seed, EDIT_TECHNIQUES.length)) {
    if (out.size >= count) break;
    const at = techniqueScene(seed, t, sceneCount, realScenes, focusScenes);
    if (at < 0 || out.has(at)) continue;
    out.set(at, t);
  }
  return out;
}
