/**
 * 보관소 영상 로테이션(2026-09-28 사용자 요청) — 같은 수종에 영상이 여러 개면 번갈아 쓰고,
 * 하나뿐이면 편마다 그 영상의 다른 구간을 쓴다.
 *
 * 왜 필요한가(실측 2026-09-28). `matchMedia` 가 점수 → 최근 업로드 순으로 정렬하고 호출부가
 * `limit: 1` 로 한 개만 집으니, 같은 수종은 영원히 같은 파일이 뽑혔다. 89편의 `clips/sources.json`
 * 을 세 보면 예외가 없다 — 감나무는 보관소 영상 3개 중 1개가 6편에, 자두나무는 2개 중 1개가 5편에
 * 나갔다. 여러 영상을 가진 11수종 전부 같은 모양이고, 그 결과 보관소 영상 79개 중 50개(63%)가
 * 한 번도 화면에 안 나갔다(그중 16개는 같은 수종의 다른 파일이 이미 쓰여 가려진 것).
 * 구간도 89건 전부 `startSec: 0` 이었다 — 감나무 6편은 같은 파일의 같은 앞 6초였다.
 *
 * 무엇을 안 바꾸는가.
 *  · **한 편에 쓰는 영상 개수는 그대로 1개**다(사용자 확정 2026-09-08 "영상 한 개만 사용해").
 *    바꾸는 것은 '어느 것을' 고르느냐이지 '몇 개를' 쓰느냐가 아니다.
 *  · **한 편 안에서 한 영상을 여러 씬에 쪼개 넣지 않는다**(사용자 확정 2026-09-04, 실측으로 되돌린
 *    규칙 — 가운데 11초가 한 장면처럼 이어졌다). 구간이 달라지는 것은 편과 편 사이다.
 *  · `mediaStock.unusedStock` 의 주제 선정 신호는 수종 단위 그대로 둔다. 파일 단위로 바꾸면 남은
 *    파일이 있다는 이유로 같은 수종을 계속 밀어 주제 로테이션이 흔들린다.
 *
 * 구간을 '언제' 고르는지가 중요하다. 파일과 함께 **주제 확정 직후** 고른다 — 그래야 비전이 그 구간의
 * 프레임만 읽고, 작가가 실제로 나갈 화면을 보고 쓴다. 대본 뒤에 구간을 정하면 38초 영상의 뒷부분을
 * 쓰면서 설명은 앞부분 화면을 가리키게 된다(2026-09-04 에 배운 것이 그거다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MIN_CLIP_COVERAGE } from './userAssets';

/** 구간 시작점은 소수 첫째 자리로 맞춘다 — 이력의 startSec 과 글자 단위로 비교해야 '쓴 구간'을 안다. */
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * 한 파일에서 쓸 수 있는 구간 시작점들(초, 순수).
 *
 * 간격은 씬 길이 + 여유(applyUserSegments 가 SEGMENT_TAIL_SEC 만큼 더 뗀다)다. 남은 길이가 씬의
 * MIN_CLIP_COVERAGE 에 못 미치면 그 구간은 내지 않는다 — 과한 감속은 '고장 난 슬로모션'으로 보인다.
 *
 * 0 은 길이가 짧아도 언제나 낸다. 배정 가능 여부는 `planVideoSegments` 가 판단할 일이고, 여기서
 * 미리 빼면 짧은 영상이 편에서 통째로 사라진다(누락이 감속보다 나쁘다 — 2026-09-09 규칙).
 */
export function windowStarts(seconds: number, sceneSec: number, tailSec: number): number[] {
  if (!(seconds > 0)) return [];
  const stride = sceneSec + tailSec;
  // 씬을 **통째로** 덮을 수 있을 때만 다음 구간을 낸다. 하한(MIN_CLIP_COVERAGE 0.5)까지 허용하면 로테이션이
  // 감속을 새로 들여온다 — 실측(보관소 79개 길이 × 실제 252편 씬 길이): 하한 기준은 로테이션 100% 유지하지만
  // 감속 편이 0% → 10.1%, 통째 기준은 로테이션 91.3% 유지에 감속 1.4%. 0.5 는 허용 바닥이지 목표가 아니고,
  // 이 기능의 목적은 화면을 좋게 하는 것이다(다양성보다 화면이 먼저다). 부수 효과로 `usableStart` 되돌림도
  // 사실상 사라진다 — 잔여가 7초면 어느 편의 최단 씬 하한(실측 최대 4.4초)도 넘는다.
  const need = sceneSec;
  const out = [0];
  if (!(stride > 0)) return out;
  for (let k = 1; ; k++) {
    const s = round1(stride * k);
    if (seconds - s < need) break;
    out.push(s);
  }
  return out;
}

/**
 * 구간 간격을 잡을 때 쓰는 씬 하나의 몫(초, 순수) — 상한 ÷ 씬 수(35초 ÷ 5씬 = 7초).
 *
 * 고르는 쪽(주제 확정 직후)과 여분을 뽑는 쪽(렌더 직전)이 **같은 격자**를 봐야 한다. 격자가 어긋나면
 * 이력에 적힌 startSec 이 어느 구간인지 못 알아보고 로테이션이 늘 0으로 되돌아온다.
 */
export function windowSceneSec(maxDurationSec: number, scenes: number): number {
  const raw = maxDurationSec / Math.max(1, scenes);
  return Math.min(20, Math.max(3, Number.isFinite(raw) ? raw : 7));
}

/** 화면에 나간 (파일, 구간) 한 건. `at` 은 나간 시점(클 수록 최근). */
export interface RotationUse {
  readonly file: string;
  readonly startSec: number;
  readonly at: number;
}

/**
 * 후보 한 건 — `grade` 는 **수종 판정 등급만** 담는다(주 수종 150 > 제목에 적힌 다른 수종 100 > 범용 1).
 *
 * 태그 가점(+10)은 여기 섞지 마라. 등급으로 후보를 자르기 때문에, 태그 하나가 같은 수종의 다른 영상을
 * 후보에서 통째로 빼 버린다(실측 2026-09-28: 자두나무 두 영상이 160 vs 150 이 되어 로테이션이 한 파일에
 * 묶였다). 태그 선호는 입력 순서가 이미 담고 있다 — 동률일 때 앞 후보가 먼저 나간다.
 */
export interface RotationCandidate {
  readonly file: string;
  readonly seconds: number;
  readonly grade: number;
}

export interface RotationPick {
  readonly file: string;
  readonly startSec: number;
}

/**
 * 후보와 이력에서 쓸 (파일, 구간)을 고른다(순수).
 *
 * 순서가 둘이다. **파일이 먼저고 구간이 나중이다** — 사용자가 말한 것도 그 순서다("여러 보관소
 * 영상을 다양하게", 그다음 "영상이 하나밖에 없을 때도").
 *  1) 최상위 등급만 남긴다. 등급을 넘어 섞지 않는다 — 다 쓴 수종 일치 영상을 한 번 더 쓰는
 *     것이 안 쓴 범용 영상을 쓰는 것보다 낫다(수국 편에 회양목이 들어가면 안 쓰느니만 못하다).
 *  2) 파일을 마지막으로 쓴 시점 오름차순으로 줄 세운다(한 번도 안 쓴 것이 맨 앞).
 *  3 각 파일의 구간도 같은 자로 줄 세운다.
 *  4) 파일을 한 바퀴씩 돌며 낸다(파일1 첫 구간, 파일2 첫 구간, 파일1 둘째 구간, …) — 그래야
 *     `offset` 한 칸이 '다른 파일'이 되고, 파일이 하나뿐일 때만 '다른 구간'이 된다.
 *
 * `offset` 은 형제편(유튜브·인스타)을 가르는 값이다. 둘은 같은 글에서 몇 분 차이로 도는데 둘째
 * 런은 첫째의 `sources.json` 을 아직 못 본다(경합) — 이력만 믿으면 같은 것을 집는다. 채널별로 한
 * 칸 밀어 두면 경합과 무관하게 갈린다(2026-09-08 채널 완전 분리와 같은 방향).
 */
export function pickRotatedVideo(
  candidates: readonly RotationCandidate[],
  history: readonly RotationUse[],
  opts: { sceneSec: number; tailSec: number; offset?: number },
): RotationPick | undefined {
  const live = candidates.filter((c) => c.file && c.seconds > 0);
  if (!live.length) return undefined;
  const top = Math.max(...live.map((c) => c.grade));
  const tier = live.filter((c) => c.grade === top);

  // (파일, 구간) → 마지막으로 나간 시점. 없으면 -Infinity(한 번도 안 쓴 것이 가장 오래된 것).
  const lastAt = (file: string, startSec: number): number => {
    let at = -Infinity;
    for (const h of history) {
      if (h.file !== file || round1(h.startSec) !== startSec) continue;
      if (h.at > at) at = h.at;
    }
    return at;
  };

  const rows = tier.map((c, i) => {
    const wins = windowStarts(c.seconds, opts.sceneSec, opts.tailSec)
      .map((startSec) => ({ startSec, at: lastAt(c.file, startSec) }))
      // 안 쓴 구간이 먼저, 그다음 오래된 것. 둘 다 안 썼으면 앞 구간부터(종전 결과와 같게).
      .sort((a, b) => a.at - b.at || a.startSec - b.startSec);
    // 파일의 '나이'는 어느 구간이든 마지막으로 나간 시점이다 — 한 구간만 써도 그 파일은 쓴 파일이다.
    const newest = wins.reduce((m, w) => Math.max(m, w.at), -Infinity);
    return { file: c.file, wins, newest, i };
  }).filter((r) => r.wins.length);
  if (!rows.length) return undefined;

  rows.sort((a, b) => a.newest - b.newest || a.i - b.i); // 동률이면 입력 순서(총점·최신 순 — 태그 선호가 여기서 산다)
  const ranked: RotationPick[] = [];
  const deepest = Math.max(...rows.map((r) => r.wins.length));
  for (let k = 0; k < deepest; k++) {
    for (const r of rows) {
      const w = r.wins[k];
      if (w) ranked.push({ file: r.file, startSec: w.startSec });
    }
  }
  // offset 은 나머지로 돌린다 — 범위를 넘겼다고 빈 값을 내면 그 편에서 실촬영이 통째로 사라진다.
  const raw = Math.trunc(Number(opts.offset ?? 0));
  const n = Number.isFinite(raw) ? Math.max(0, raw) : 0; // NaN 이면 ranked[NaN]=undefined 라 실촬영이 통째로 사라진다
  return ranked[n % ranked.length];
}

/**
 * 배정에 쓴 구간을 뺀 나머지 구간들(순수) — 중간 컷 여분 클립 후보.
 *
 * 왜 같은 파일에서 뽑는가. 여분 풀은 종전에 '배정에 안 쓰인 보관소 영상'이었는데, 호출부가 한 편에
 * 영상 하나만 넘기고 그 하나는 반드시 쓰이므로(mustUse) 그 집합이 **항상 비어 있었다** — 89편 내내
 * 여분이 0건이었다(`sources.json` 에 role:'spare' 0). 같은 파일의 다른 구간을 쓰면 영상 개수를
 * 늘리지 않고(09-08 결정 유지) 09-18 의 중간 컷이 실제로 돈다.
 *
 * 먼 구간부터 낸다. 컷은 씬 가운데에서 일어나므로 배정 구간에서 멀수록 시간 점프가 커지고, 그래야
 * 컷이 컷으로 보인다. 같은 거리면 뒤쪽 구간을 먼저 준다.
 */
export function spareWindows(
  file: string, seconds: number, pickedStartSec: number,
  opts: { sceneSec: number; tailSec: number },
): Array<{ file: string; startSec: number; seconds: number }> {
  return windowStarts(seconds, opts.sceneSec, opts.tailSec)
    .filter((s) => s !== round1(pickedStartSec))
    .sort((a, b) => Math.abs(b - pickedStartSec) - Math.abs(a - pickedStartSec) || b - a)
    .map((startSec) => ({ file, startSec, seconds: round1(seconds - startSec) }));
}

/**
 * 이 편에서 그 구간을 실제로 쓸 수 있는지 보고, 못 쓰면 앞(0)으로 되돌린다(순수).
 *
 * 왜 필요한가(실측 2026-09-28). 구간은 씬 7초 격자로 고르므로 "남은 길이 ≥ 3.5초"만 보장한다. 그런데
 * 편마다 실제 씬 길이가 다르다 — 252편의 '가장 짧은 본문 씬'은 p50 6.1·p90 7.1·최대 8.8초이고,
 * **35편(13.9%)은 가장 짧은 씬조차 하한이 3.5초를 넘는다.** 그 편에서 잘라낸 꼬리는 어느 씬도 못 채우는데,
 * `planVideoSegments` 의 mustUse 는 길이를 안 보고 강제 배치한다(누락이 감속보다 나쁘다는 2026-09-09 규칙).
 * 그러면 0.5배 밑 감속이 걸려 MIN_CLIP_COVERAGE 가 막으려던 '고장 난 슬로모션'이 그대로 나온다.
 *
 * 그래서 이 편에서 못 쓸 구간은 로테이션을 포기하고 앞에서 뗀다 — 다양성보다 화면이 먼저다.
 * (구간 0 은 파일 전체를 쓸 수 있어 종전과 같다.)
 */
export function usableStart(seconds: number, startSec: number, sceneSeconds: readonly number[]): number {
  if (!(startSec > 0) || !(seconds > 0) || !sceneSeconds.length) return 0;
  // 가장 짧은 씬이 가장 채우기 쉽다 — 그 하한도 못 넘기면 이 편에 쓸 자리가 없다.
  const minNeed = Math.min(...sceneSeconds) * MIN_CLIP_COVERAGE;
  return seconds - startSec >= minNeed ? startSec : 0;
}

/**
 * 보관소 사용 이력을 읽는다(부수효과 — 모든 편의 `clips/sources.json` 을 훑는다).
 *
 * 새 저장소를 만들지 않는다. `applyUserSegments` 가 2026-09-08 부터 (씬, 파일, startSec, 길이)를
 * 이 파일에 적고 있고, 그게 곧 '화면에 나간 것'의 근거다(편 기록의 로그는 배정 시도일 뿐이다).
 * 시점은 그 파일의 mtime 으로 본다 — 구운 시각이 곧 쓴 시각이다.
 *
 * **`role:'spare'` 행은 세지 않는다(2026-09-28 리뷰에서 잡은 결함).** 한 편의 모든 행은 그 파일 mtime 하나로
 * 도장을 받는데, 여분은 '배정 안 된 구간'으로 골라진 것이라 배정 행과 **같은 시각으로 같이 적힌다.** 그러면
 * `pickRotatedVideo` 의 구간 정렬에서 `at` 이 동률이 되고 2차 기준(startSec 오름차순)이 늘 0번을 집는다 —
 * 재현: 19초 파일이 `0 → 0 → 0 → 0`(여분 제외 시 `0 → 8.2 → 0 → 8.2`). 보관소 영상 79개 중 51개가 구간
 * 2개짜리라 이 변경이 고치려던 결함("89편 전부 startSec 0")이 그대로 되살아난다.
 * 여분은 확정도 아니다 — 렌더러가 실측 길이로 다시 배정하고 스테이징이 실패하면 화면에 안 나간다.
 * 보관소 '사용 현황' 메뉴는 영향 없다(`buildMediaUsage` 는 자기 경로로 읽고 file·scene 만 본다).
 *
 * 실패는 빈 목록(fail-open): 이력을 못 읽었다고 영상 생성이 멈추면 안 되고, 그때는 종전처럼 첫 후보의 첫 구간이 나간다.
 */
export function readMediaHistory(shortsRoot: string): RotationUse[] {
  const out: RotationUse[] = [];
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(shortsRoot); } catch { return out; }
  for (const d of dirs) {
    const f = path.join(shortsRoot, d, 'clips', 'sources.json');
    try {
      const at = fs.statSync(f).mtimeMs;
      const j = JSON.parse(fs.readFileSync(f, 'utf-8')) as unknown;
      if (!Array.isArray(j)) continue;
      for (const r of j as Array<{ file?: unknown; startSec?: unknown; role?: unknown }>) {
        if (r?.role === 'spare') continue; // 위 주석 — 배정 행과 같은 시각이라 구간 로테이션을 멈춘다
        const file = String(r?.file ?? '').trim();
        if (!file) continue;
        const s = Number(r?.startSec);
        out.push({ file, startSec: Number.isFinite(s) ? round1(s) : 0, at });
      }
    } catch { /* 이 편만 건너뛴다 */ }
  }
  return out;
}
