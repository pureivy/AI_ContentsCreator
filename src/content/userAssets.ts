/**
 * 사용자 첨부 실사진의 씬 배정(2026-09-04).
 *
 * 이 채널의 오랜 약점은 화면이 전부 생성 이미지라는 것이었다. 8월에 "실사진이 지금 당장 없다"고
 * 해서 I2V·필름룩으로 우회했지만, 실제로 찍은 사진 한 장이 그 모든 우회보다 낫다.
 *
 * 두 갈래로 쓴다.
 *  (가) 배경으로 직접 — 배정된 씬은 생성하지 않고 그 사진을 쓴다. 생성비도 그만큼 준다.
 *  (나) 스타일 레퍼런스로 — 나머지 씬은 그 사진들의 색·빛·질감을 참고해 생성한다.
 *      한두 장만 올려도 전 씬의 톤이 그 사진에 맞춰진다.
 */

/** 씬 배정 결과 — index 는 씬 번호(0-base), null 은 생성으로 남김. */
export type AssetPlan = ReadonlyArray<string | null>;

/**
 * 사진을 씬에 배정한다(순수).
 *
 * 배정 규칙은 단순하게 둔다 — 사진이 어느 씬에 어울리는지는 비전이 판단할 일이고, 여기서는
 * '몇 장을 어디에 놓을까'만 정한다. 앞에서부터 채우되 훅(0)을 먼저 준다: 첫 프레임이 곧 커버라
 * 실사진이 커버가 되면 '생성 이미지 채널'이라는 인상이 가장 크게 깎인다.
 *
 * 전 씬을 실사진으로 덮지는 않는다 — 사진이 씬 내용과 안 맞으면 생성본만 못하다. 상한은 씬의
 * 절반(올림)이고, 그 이상 올려도 나머지는 스타일 레퍼런스로만 쓰인다.
 */
export function planAssetScenes(assets: readonly string[], sceneCount: number, order?: readonly number[]): AssetPlan {
  const out: Array<string | null> = Array.from({ length: Math.max(0, sceneCount) }, () => null);
  if (!assets.length || sceneCount <= 0) return out;
  const cap = Math.min(assets.length, Math.ceil(sceneCount / 2));
  // 배정 순서 — 지정이 없으면 훅부터 앞에서 차례로.
  const seq = (order?.length ? order : Array.from({ length: sceneCount }, (_, i) => i))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < sceneCount);
  const seen = new Set<number>();
  let k = 0;
  for (const idx of seq) {
    if (k >= cap) break;
    if (seen.has(idx)) continue;
    seen.add(idx);
    out[idx] = assets[k++]!;
  }
  return out;
}

/**
 * 내용 기준 배정을 planAssetScenes 가 받는 (사진 순서, 씬 순서) 쌍으로 편다(순수, 2026-09-04).
 *
 * planAssetScenes 는 "사진 목록을 씬 순서대로 하나씩 꽂는" 함수다. 그래서 "3번 사진은 2번 씬"
 * 같은 배정을 그대로 못 받는다. 여기서 두 배열의 순서를 맞춰 준다 — 배정된 사진을 앞으로 당기고,
 * 씬 순서도 같은 차례로 놓는다. 배정 없는 사진은 뒤에 붙고 종전 순서(훅부터)로 채워진다.
 */
export function orderAssetsByAssignment(
  assets: readonly string[], at: ReadonlyMap<string, readonly number[]>, sceneCount: number,
): { assets: string[]; order: number[] } {
  const taken = new Set<number>();
  const head: Array<{ file: string; scene: number }> = [];
  for (const f of assets) {
    // 사진은 한 장이 한 씬이다(planAssetScenes 계약) — 여러 씬을 받았으면 첫 자리만 쓴다.
    const i = [...(at.get(f) ?? [])].sort((a, b) => a - b).find((k) => Number.isInteger(k) && k >= 0 && k < sceneCount && !taken.has(k));
    if (i === undefined) continue;
    taken.add(i);
    head.push({ file: f, scene: i });
  }
  head.sort((a, b) => a.scene - b.scene);
  const rest = assets.filter((f) => !head.some((h) => h.file === f));
  const tail = Array.from({ length: sceneCount }, (_, i) => i).filter((i) => !taken.has(i));
  return { assets: [...head.map((h) => h.file), ...rest], order: [...head.map((h) => h.scene), ...tail] };
}

/** 배정되지 않은 사진 — 스타일 레퍼런스로 넘긴다(생성 API 의 refImages 상한 4장). */
export function styleRefs(assets: readonly string[], plan: AssetPlan, max = 4): string[] {
  const used = new Set(plan.filter((x): x is string => !!x));
  const rest = assets.filter((a) => !used.has(a));
  // 배정된 사진도 톤의 기준이므로, 남는 게 없으면 배정분에서 앞쪽 몇 장을 참조로 재사용한다.
  return (rest.length ? rest : assets.slice()).slice(0, max);
}

/** 씬 길이 대비 영상이 이만큼은 되어야 배정한다. 이보다 짧으면 감속 배율이 0.5 밑으로 떨어져
 *  실촬영 영상이 '고장 난 슬로모션'으로 보인다(렌더러는 클립 한 번으로 씬을 덮으려 속도를 낮춘다). */
export const MIN_CLIP_COVERAGE = 0.5;

/** 씬 하나에 넣을 영상 구간 — 원본 경로와 그 안에서 잘라 쓸 위치. */
export interface VideoSegment {
  readonly path: string;
  /** 원본에서 이 구간이 시작하는 지점(초). 0 이면 앞에서부터. */
  readonly startSec: number;
  /** 이 구간의 길이(초). */
  readonly seconds: number;
}

/**
 * 첨부 영상을 '구간으로 쪼개' 여러 씬에 배정한다(순수, 2026-09-04 사용자 허락).
 *
 * planVideoScenes 는 영상 하나를 씬 하나에만 썼다. 그래서 23초짜리 한 개를 올리면 6초 씬 하나만
 * 덮고 17초가 버려졌다(실측). 사장님이 "숏폼 방향에 맞춰 자르거나 수정해도 된다"고 하셔서,
 * 한 영상에서 서로 다른 구간을 떼어 여러 씬에 나눠 넣는다. 같은 장면이 반복되지 않게 구간은
 * 겹치지 않고, 씬 순서대로 앞에서 뒤로 진행한다 — 영상 자체의 시간 흐름이 편의 흐름과 맞는다.
 *
 * 지키는 것 셋(전부 종전 규칙과 같은 이유):
 *  · 훅(0)은 비운다 — 영상 첫 프레임은 대개 정지 상태라 커버로 약하다.
 *
 * prefer 는 "이 영상은 이 씬(들)"이라는 내용 기준 배정이다(감독이 대본과 소재 설명을 보고 고른다).
 * 배정을 받은 영상은 그 자리에만 들어간다 — 길이 기준으로 더 퍼뜨리지 않는다. 길이는 배정을 못
 * 받은 영상에만 쓰는 차선책이다. 내용을 본 판단을 길이가 덮어쓰면 분석을 앞으로 당긴 의미가 없다.
 *  · 구간이 씬 길이의 MIN_CLIP_COVERAGE 밑이면 안 쓴다 — 과한 감속은 결함으로 보인다.
 *  · 전 씬을 실촬영으로 덮지 않는다(상한 = 씬의 절반, 올림) — 한 클립을 4~5씬에 늘어놓으면
 *    같은 장면이 도는 것처럼 보이고 내레이션과도 어긋난다. 실사진 배정과 같은 상한·같은 이유.
 */
export function planVideoSegments(
  videos: ReadonlyArray<{ path: string; seconds: number }>,
  sceneSeconds: readonly number[],
  prefer: ReadonlyMap<string, readonly number[]> = new Map(),
): ReadonlyArray<VideoSegment | null> {
  const out: Array<VideoSegment | null> = sceneSeconds.map(() => null);
  if (!videos.length || !sceneSeconds.length) return out;
  // 남은 시간을 들고 다닌다 — 한 영상에서 여러 구간을 떼므로 '얼마나 남았나'가 선택 기준이다.
  const pool = videos
    .filter((v) => v.path && v.seconds > 0)
    .map((v) => ({ path: v.path, left: v.seconds, scenes: [] as Array<{ i: number; seconds: number }> }));
  if (!pool.length) return out;
  const cap = Math.ceil(sceneSeconds.length / 2);
  const claimed = new Set<number>();
  let placed = 0;

  // 0) 내용으로 정해진 자리 먼저(2026-09-04) — 감독이 대본과 소재 설명을 나란히 놓고 고른 것.
  //    길이 규칙은 여기서도 그대로다: 훅은 비우고, 씬 길이의 절반에 못 미치면 그 자리는 포기한다.
  for (const [file, ats] of prefer) {
    const v = pool.find((x) => x.path === file);
    if (!v) continue;
    for (const at of [...ats].sort((a, b) => a - b)) {
      if (placed >= cap) break;
      if (!Number.isInteger(at) || at <= 0 || at >= sceneSeconds.length || claimed.has(at)) continue;
      const sec = sceneSeconds[at]!;
      if (v.left < sec * MIN_CLIP_COVERAGE) continue;
      const take = Math.min(sec, v.left);
      v.scenes.push({ i: at, seconds: take });
      v.left -= take;
      claimed.add(at);
      placed++;
    }
  }

  // 1) 남은 씬 — 길이 기준으로 채운다. 다만 '배정을 못 받은 영상'만 대상이다(2026-09-04 실측).
  //
  // 왜 배정받은 영상은 제외하는가. 실측에서 넓게 찍은 하우스 밭 영상 하나가 3씬을 먹었다. 감독이
  // 고른 자리는 그중 한 곳("비닐하우스 장미도 마디 선택이 쌓인 결과예요")뿐이었고, 나머지 둘은
  // 길이만 보고 채운 자리였다 — 그 두 씬은 "마디를 어디서 자르나"를 설명하는 클로즈업 대목이라
  // 밭 전경이 말과 겉돌았다. 게다가 같은 화면이 세 씬 이어져 한 장면이 길게 이어지는 것처럼 보였다.
  // 내용을 본 판단이 있는데 길이가 그걸 덮어쓰면, 분석을 앞으로 당긴 의미가 없다.
  const unassigned = new Set(pool.filter((v) => !prefer.has(v.path)).map((v) => v.path));
  const order = unassigned.size
    ? sceneSeconds.map((sec, i) => ({ i, sec })).filter((x) => x.i > 0 && !claimed.has(x.i)).sort((a, b) => b.sec - a.sec)
    : [];
  for (const { i, sec } of order) {
    if (placed >= cap) break;
    // 감속을 최소화하는 쪽으로 고른다(종전과 같은 기준, 대상이 '남은 시간'으로 바뀐 것뿐).
    //  1순위: 씬을 통째로 덮을 만큼 남은 것 중 가장 적게 남은 것 — 여유가 큰 영상은 뒤 씬에 남긴다
    //  2순위: 못 덮으면 하한을 넘는 것 중 가장 많이 남은 것 — 감속 폭이 가장 작다
    let exact = -1, partial = -1;
    for (let k = 0; k < pool.length; k++) {
      if (!unassigned.has(pool[k]!.path)) continue; // 배정받은 영상은 길이로 더 퍼뜨리지 않는다
      const left = pool[k]!.left;
      if (left >= sec) { if (exact < 0 || left < pool[exact]!.left) exact = k; continue; }
      if (left < sec * MIN_CLIP_COVERAGE) continue;
      if (partial < 0 || left > pool[partial]!.left) partial = k;
    }
    const best = exact >= 0 ? exact : partial;
    if (best < 0) continue;
    const take = Math.min(sec, pool[best]!.left);
    pool[best]!.scenes.push({ i, seconds: take });
    pool[best]!.left -= take;
    claimed.add(i);
    placed++;
  }

  // 2) 구간 위치 — 영상마다 씬 번호 순으로 앞에서 뒤로 떼어 낸다. 배정 순서(긴 씬 먼저)가 아니라
  //    씬 순서를 따르는 이유: 영상의 시간 흐름과 편의 흐름이 어긋나면 같은 소재가 거꾸로 흐른다.
  for (const v of pool) {
    let cursor = 0;
    for (const sc of v.scenes.slice().sort((a, b) => a.i - b.i)) {
      out[sc.i] = { path: v.path, startSec: cursor, seconds: sc.seconds };
      cursor += sc.seconds;
    }
  }
  return out;
}
