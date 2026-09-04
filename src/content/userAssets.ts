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

/**
 * 첨부 영상을 씬에 배정한다(순수).
 *
 * 이미지와 규칙이 다르다. 이미지는 어느 씬에 놓아도 화면이 성립하지만, 영상은 길이가 맞아야 한다 —
 * 씬보다 많이 짧으면 렌더러가 감속으로 늘려 덮는데 0.5배 밑으로 가면 슬로모션이 아니라 결함으로 보인다.
 * 그래서 '충분히 긴 영상'만 배정하고 나머지는 안 쓴다(억지로 넣느니 생성 이미지가 낫다).
 *
 * 훅(0)은 피한다 — 첫 프레임이 커버인데, 영상 첫 프레임은 대개 정지 상태라 커버로 약하다.
 * 실사진은 훅에 넣지만 영상은 본문에 넣는 이유가 그것이다.
 */
export function planVideoScenes(
  videos: ReadonlyArray<{ path: string; seconds: number }>,
  sceneSeconds: readonly number[],
): AssetPlan {
  const out: Array<string | null> = sceneSeconds.map(() => null);
  if (!videos.length || !sceneSeconds.length) return out;
  const pool = videos.filter((v) => v.path && v.seconds > 0).slice();
  // 본문 씬부터(훅 제외), 긴 씬부터 채운다 — 긴 씬일수록 채울 영상을 고르기 어렵다.
  const order = sceneSeconds
    .map((sec, i) => ({ i, sec }))
    .filter((x) => x.i > 0)
    .sort((a, b) => b.sec - a.sec);
  for (const { i, sec } of order) {
    if (!pool.length) break;
    // 감속을 최소화하는 쪽으로 고른다.
    //  1순위: 씬을 통째로 덮는 영상(감속 없음) 중 가장 짧은 것 — 더 긴 영상은 더 긴 씬에 남긴다
    //  2순위: 못 덮으면 하한을 넘는 것 중 가장 긴 것 — 감속 폭이 가장 작다
    // 종전엔 '하한만 넘으면 가장 짧은 것'을 골라서, 10초 씬에 5초 영상을 넣어 0.5배까지 늘렸다.
    let exact = -1, partial = -1;
    for (let k = 0; k < pool.length; k++) {
      const d = pool[k]!.seconds;
      if (d >= sec) { if (exact < 0 || d < pool[exact]!.seconds) exact = k; continue; }
      if (d < sec * MIN_CLIP_COVERAGE) continue;
      if (partial < 0 || d > pool[partial]!.seconds) partial = k;
    }
    const best = exact >= 0 ? exact : partial;
    if (best < 0) continue;
    out[i] = pool.splice(best, 1)[0]!.path;
  }
  return out;
}
