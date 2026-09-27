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
export function planAssetScenes(
  assets: readonly string[], sceneCount: number, order?: readonly number[],
  opts: { hookFirst?: boolean } = {},
): AssetPlan {
  const out: Array<string | null> = Array.from({ length: Math.max(0, sceneCount) }, () => null);
  if (!assets.length || sceneCount <= 0) return out;
  const cap = Math.min(assets.length, Math.ceil(sceneCount / 2));
  // 배정 순서 — 지정이 없으면 훅부터 앞에서 차례로.
  const seq0 = (order?.length ? order : Array.from({ length: sceneCount }, (_, i) => i))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < sceneCount);
  // 훅 예약(2026-09-18) — 영상이 한 편도 훅을 못 채웠을 때, 내용 배정 순서와 무관하게 사진이라도
  // 먼저 준다(SHORTS_HOOK_FOOTAGE). 중복 제거하며 0 을 맨 앞으로 당긴다.
  const seq = opts.hookFirst ? [0, ...seq0.filter((i) => i !== 0)] : seq0;
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
  assets: readonly string[], at: ReadonlyMap<string, number>, sceneCount: number,
): { assets: string[]; order: number[] } {
  const taken = new Set<number>();
  const head: Array<{ file: string; scene: number }> = [];
  for (const f of assets) {
    const i = at.get(f);
    if (!Number.isInteger(i) || i! < 0 || i! >= sceneCount || taken.has(i!)) continue;
    taken.add(i!);
    head.push({ file: f, scene: i! });
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

/**
 * 구간을 뗄 때 씬 길이보다 더 떼는 여유(초).
 *
 * 배정에 쓴 씬 길이는 낭독 실측 전의 자수 추정이라 실제보다 짧을 수 있다. 클립이 씬보다 짧으면 렌더러가
 * 감속으로 늘려 슬로모션이 된다. 남는 꼬리는 그냥 잘린다. 구간 로테이션(mediaRotation)의 간격도 이 값을
 * 더해서 잡는다 — 잘라 쓰는 폭과 구간 간격이 어긋나면 구간이 서로 겹친다.
 */
export const SEGMENT_TAIL_SEC = 1.2;

/** 씬 하나에 넣을 영상 구간 — 원본 경로와 그 안에서 잘라 쓸 위치. */
export interface VideoSegment {
  readonly path: string;
  /** 원본에서 이 구간이 시작하는 지점(초). */
  readonly startSec: number;
  /** 이 구간의 길이(초). */
  readonly seconds: number;
}

/**
 * 첨부 영상을 씬에 배정한다(순수).
 *
 * 규칙은 하나다 — **영상 하나는 씬 하나**(사용자 확정 2026-09-04).
 *
 * 한때 한 영상을 여러 구간으로 쪼개 여러 씬에 넣어 봤다. 23초짜리가 6초 씬 하나만 덮고 나머지가
 * 버려지는 게 아까웠기 때문이다. 실측 결과가 분명했다: 넓게 찍은 하우스 밭 영상 하나가 5씬 중
 * 3씬을 먹으니 가운데 11초가 한 장면처럼 이어졌고, 그중 둘은 클로즈업을 설명하는 대목이라
 * 화면과 말이 겉돌았다. 단조로움을 지우려고 시작한 일인데 단조로움을 만들었다. 아까운 것보다
 * 어긋나는 것이 나쁘다.
 *
 * 지키는 것:
 *  · 훅(0)은 비운다 — 영상 첫 프레임은 대개 정지 상태라 커버로 약하다.
 *  · 씬 길이의 MIN_CLIP_COVERAGE 에 못 미치는 영상은 안 쓴다 — 과한 감속은 결함으로 보인다.
 *  · prefer(감독이 내용을 보고 고른 자리)가 길이보다 우선한다. 배정을 못 받은 영상만 길이로 채운다.
 *
 * 구간은 언제나 영상 앞에서 뗀다. 어디를 쓸지는 사람이 올릴 때 이미 정한 것이고, 코드가 중간
 * 어딘가를 골라야 할 근거가 없다.
 */
export function planVideoSegments(
  videos: ReadonlyArray<{ path: string; seconds: number; startSec?: number }>,
  sceneSeconds: readonly number[],
  prefer: ReadonlyMap<string, number> = new Map(),
  opts: { mustUse?: boolean; hookFirst?: boolean } = {},
): ReadonlyArray<VideoSegment | null> {
  const out: Array<VideoSegment | null> = sceneSeconds.map(() => null);
  if (!videos.length || !sceneSeconds.length) return out;
  const pool = videos.filter((v) => v.path && v.seconds > 0);
  if (!pool.length) return out;
  const claimed = new Set<number>();
  const used = new Set<string>();
  // 쓸 수 있는 길이는 파일 전체가 아니라 startSec 뒤로 남은 길이다(2026-09-28 로테이션).
  // 전체 길이로 판정하면 9.6초 파일을 6초부터 잘라 3.6초로 7초 씬을 덮으며 0.5배 감속이 걸린다 —
  // MIN_CLIP_COVERAGE 가 막으려던 '고장 난 슬로모션'이 바로 그것이다. 보관소 길이 분포에 9~13초가 여럿이라 실제로 터진다.
  const avail = (v: { seconds: number; startSec?: number }): number => v.seconds - Math.max(0, v.startSec ?? 0);
  const fits = (v: { seconds: number; startSec?: number }, sec: number): boolean => avail(v) >= sec * MIN_CLIP_COVERAGE;
  const place = (v: { path: string; seconds: number; startSec?: number }, i: number): void => {
    out[i] = { path: v.path, startSec: Math.max(0, v.startSec ?? 0), seconds: Math.min(sceneSeconds[i]!, avail(v)) };
    claimed.add(i);
    used.add(v.path);
  };

  // -1) 훅(0) 예약(2026-09-18, SHORTS_HOOK_FOOTAGE) — 실사면 채널 인상이 첫 화면에서 갈린다.
  //     감독이 훅에 고른 영상이 있고 길이가 되면 그것, 아니면 훅 길이를 채울 수 있는 가장 긴 영상.
  //     아무것도 안 맞으면 훅은 비우고 아래 종전 규칙(훅 제외)을 그대로 탄다.
  if (opts.hookFirst) {
    const hookSec = sceneSeconds[0]!;
    let hookPick: { path: string; seconds: number; startSec?: number } | undefined;
    for (const [file, at] of prefer) {
      if (at !== 0) continue;
      const v = pool.find((x) => x.path === file);
      if (v && fits(v, hookSec)) { hookPick = v; break; }
    }
    if (!hookPick) hookPick = pool.filter((v) => fits(v, hookSec)).sort((a, b) => avail(b) - avail(a))[0];
    if (hookPick) place(hookPick, 0);
  }

  // 0) 내용으로 정해진 자리 먼저 — 감독이 대본과 소재 설명을 나란히 놓고 고른 것.
  for (const [file, at] of prefer) {
    const v = pool.find((x) => x.path === file);
    if (!v || used.has(file)) continue;
    if (!Number.isInteger(at) || at <= 0 || at >= sceneSeconds.length || claimed.has(at)) continue;
    if (!fits(v, sceneSeconds[at]!)) continue;
    place(v, at);
  }

  // 1) 자리를 못 잡은 영상을 길이로 채운다 — 내용을 본 판단이 '성공'했으면 길이가 덮어쓰지 않는다(used).
  //    배정이 훅(0)·범위 밖·길이 미달로 무효가 된 영상도 여기로 온다(2026-09-09 실측: 감독이 훅에 놓은
  //    영상이 prefer 에 있다는 이유로 보정에서도 빠져 편 전체에서 사라졌다).
  //    긴 씬부터(채울 영상을 고르기 어려운 쪽부터), 감속이 가장 작은 영상을 고른다.
  const rest = pool.filter((v) => !used.has(v.path));
  if (rest.length) {
    const order = sceneSeconds
      .map((sec, i) => ({ i, sec }))
      .filter((x) => x.i > 0 && !claimed.has(x.i))
      .sort((a, b) => b.sec - a.sec);
    for (const { i, sec } of order) {
      const usable = rest.filter((v) => !used.has(v.path) && fits(v, sec));
      if (!usable.length) break;
      // 씬을 통째로 덮는 것 중 가장 짧은 것(여유가 큰 영상은 더 긴 씬에 남긴다),
      // 없으면 하한을 넘는 것 중 가장 긴 것(감속 폭이 가장 작다).
      const exact = usable.filter((v) => avail(v) >= sec).sort((a, b) => avail(a) - avail(b))[0];
      place(exact ?? usable.sort((a, b) => avail(b) - avail(a))[0]!, i);
    }
  }
  // 2) 반드시 하나는 쓴다(사용자 확정 2026-09-08 "실제 촬영 영상은 한 개를 반드시 사용해") — 배정도 길이도
  //    못 잡았으면 훅을 뺀 씬 중 가장 짧은 씬에 가장 긴 영상을 놓는다. 감속보다 누락이 나쁘다.
  if (opts.mustUse && !used.size) {
    const v = [...pool].sort((a, b) => avail(b) - avail(a))[0];
    const cand = sceneSeconds.map((sec, i) => ({ i, sec })).filter((x) => x.i > 0 && !claimed.has(x.i)).sort((a, b) => a.sec - b.sec)[0];
    if (v && cand) place(v, cand.i);
  }
  return out;
}
