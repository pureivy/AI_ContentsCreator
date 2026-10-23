/**
 * 전체 화면 롱폼 진행자 '비온이'(2026-10-23, LONGFORM_PRESENTER — 기본 꺼짐) — 순수 부분.
 * 세그먼트마다 자세 신호(cue)·계절·입 열림(낭독 소리 크기 → 프레임당 0~9)을 정한다. 그리기는 remotion/longform/fullscreen/presenter/Presenter.tsx.
 * 신호 규칙: 장면 파일이 `export const presenterCue = {...}` 를 내보내면 그대로 → 편 첫 세그먼트 = 손 흔들기, 마지막 = 인사(절)
 * → 경고 말(안 됩니다·금지·주의·위험·죽) = 놀람 → 장면 강조 박자(hi 라벨의 atFromWords 낱말) = 가리키기 → 요령·정리 말 = 두 손 모음 → 그 밖 = 가만히.
 * 바로 앞 세그먼트와 같은 자세(가만히 빼고)는 피해 다음 후보로 내린다(같은 몸짓이 이어지면 기계 같다).
 */
import type { Word } from './sceneRules';

export type PresenterSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type PresenterPose = 'idle' | 'wave' | 'point' | 'clasp' | 'surprised' | 'bow';
export type PresenterTarget = 'left' | 'right' | 'up';
/** at·until = 세그먼트 안 초. point 는 target(없으면 right — 진행자가 왼쪽 아래라 화면 가운데 쪽). */
export type PresenterCue = { pose: PresenterPose; at?: number; until?: number; target?: PresenterTarget };

const POSES: readonly PresenterPose[] = ['idle', 'wave', 'point', 'clasp', 'surprised', 'bow'];
const TARGETS: readonly PresenterTarget[] = ['left', 'right', 'up'];
/** 몸짓을 쥐고 있는 시간(초) — 그 뒤 가만히로 돌아간다. */
export const CUE_HOLD_SEC = 2.2;

const WARN_RX = /안\s?됩니다|안\s?돼|금지|주의|위험|죽/;
const TIP_RX = /요령|정리|기억|됩니다|확인/;

/** 계절(순수) — 대본 제목·요약에 계절 낱말이 있으면 그것, 없으면 렌더 시점 달(3–5 봄, 6–8 여름, 9–11 가을, 12–2 겨울). */
export function presenterSeason(text: string, month: number): PresenterSeason {
  const hit = (/(봄|여름|가을|겨울)/.exec(text) ?? [])[1];
  if (hit) return ({ 봄: 'spring', 여름: 'summer', 가을: 'autumn', 겨울: 'winter' } as const)[hit as '봄'];
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/** 장면 파일이 내보낸 presenterCue(순수) — `export const presenterCue = { pose: 'clasp', at: 2.5, target: 'up' }` 꼴만 읽는다. */
export function sceneCueOverride(src: string): PresenterCue | undefined {
  const m = /export\s+const\s+presenterCue\s*(?::\s*[\w.]+\s*)?=\s*\{([^}]*)\}/.exec(src);
  if (!m) return undefined;
  const body = m[1]!;
  const pose = (/pose\s*:\s*['"](\w+)['"]/.exec(body) ?? [])[1] as PresenterPose | undefined;
  if (!pose || !POSES.includes(pose)) return undefined;
  const at = Number((/\bat\s*:\s*([\d.]+)/.exec(body) ?? [])[1]);
  const until = Number((/\buntil\s*:\s*([\d.]+)/.exec(body) ?? [])[1]);
  const target = (/target\s*:\s*['"](\w+)['"]/.exec(body) ?? [])[1] as PresenterTarget | undefined;
  return { pose, ...(Number.isFinite(at) ? { at } : {}), ...(Number.isFinite(until) ? { until } : {}), ...(target && TARGETS.includes(target) ? { target } : {}) };
}

/**
 * 장면 강조 박자(순수) — 처음 나오는 `hi` 라벨(BLabel … hi)의 at 변수 → 그 변수의 atFromWords 낱말, x·y 가 숫자면 그 자리.
 * hi 라벨이 없으면 처음 나오는 beat/beatInOut 의 박자 변수. 못 찾으면 undefined.
 */
export function sceneAccent(src: string): { word: string; x?: number; y?: number } | undefined {
  const vars = new Map<string, string>();
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*atFromWords\(\s*words\s*,\s*['"]([^'"]+)['"]/g)) vars.set(m[1]!, m[2]!);
  for (const m of src.matchAll(/<BLabel\b([^>]*)>/g)) {
    const attrs = m[1]!;
    if (!/\shi(?=[\s/>]|$)/.test(attrs)) continue;
    const v = (/\bat=\{\s*(\w+)/.exec(attrs) ?? [])[1];
    const word = v ? vars.get(v) : undefined;
    if (!word) continue;
    const x = Number((/\bx=\{\s*(\d+)\s*\}/.exec(attrs) ?? [])[1]);
    const y = Number((/\by=\{\s*(\d+)\s*\}/.exec(attrs) ?? [])[1]);
    return { word, ...(Number.isFinite(x) ? { x } : {}), ...(Number.isFinite(y) ? { y } : {}) };
  }
  const b = /\bbeat(?:InOut)?\(\s*f\s*,\s*(\w+)/.exec(src);
  const word = b ? vars.get(b[1]!) : undefined;
  return word ? { word } : undefined;
}

/** 강조 자리 → 가리킬 쪽. 진행자는 왼쪽 아래(x≈60~300)라 대개 오른쪽, 진행자 머리 위쪽(x<560)이면 위. */
export function targetOf(acc: { x?: number; y?: number } | undefined): PresenterTarget {
  if (acc?.x != null && acc.x < 560) return 'up';
  return 'right';
}

/** 낱말들을 한 칸 띄어 이은 글에서 rx 가 처음 맞는 자리의 낱말 시각(띄어 쓴 말 — '안 됩니다' — 도 잡는다). */
export const wordAt = (words: readonly Word[], rx: RegExp): number | undefined => {
  const m = rx.exec(words.map((w) => w.w).join(' '));
  if (!m) return undefined;
  let pos = 0;
  for (const w of words) {
    if (m.index < pos + w.w.length + 1) return w.start;
    pos += w.w.length + 1;
  }
  return undefined;
};

export type CueInput = {
  narration: string; words: readonly Word[]; speechSec: number;
  accent?: { word: string; x?: number; y?: number }; override?: PresenterCue;
};

/** 편 전체 신호(순수) — segs 순서 = 편 순서. */
export function presenterCues(segs: readonly CueInput[]): PresenterCue[] {
  const out: PresenterCue[] = [];
  let prev: PresenterCue | undefined;
  segs.forEach((s, i) => {
    const hold = (at: number): { at: number; until: number } => ({ at, until: Math.max(at + 0.5, Math.min(at + CUE_HOLD_SEC, s.speechSec)) });
    const cands: PresenterCue[] = [];
    if (s.override) cands.push(s.override);
    else if (i === 0) cands.push({ pose: 'wave', at: 0, until: Math.min(2.6, Math.max(1.2, s.speechSec)) });
    else if (i === segs.length - 1) cands.push({ pose: 'bow', at: Math.max(0, s.speechSec - 0.4) });
    else {
      const w = wordAt(s.words, WARN_RX);
      if (w != null) cands.push({ pose: 'surprised', ...hold(w) });
      if (s.accent) {
        const at = s.words.find((x) => x.w.includes(s.accent!.word))?.start;
        if (at != null) cands.push({ pose: 'point', target: targetOf(s.accent), ...hold(at) });
      }
      const t = wordAt(s.words, TIP_RX);
      if (t != null) cands.push({ pose: 'clasp', ...hold(t) });
    }
    const same = (a: PresenterCue, b?: PresenterCue) => !!b && a.pose === b.pose && (a.target ?? '') === (b.target ?? '');
    const pick = s.override ?? cands.find((c) => i === 0 || i === segs.length - 1 || !same(c, prev)) ?? { pose: 'idle' as const };
    out.push(pick);
    prev = pick;
  });
  return out;
}

/**
 * 입 열림(순수) — 낭독 PCM(모노 float) → 프레임당 0~9. 프레임 창의 RMS 를 그 세그먼트 말소리 상위 90% 값으로 나눠 맞추고,
 * 아주 작은 소리(숨·끝 여운)는 0. 두 프레임씩 같은 값(초당 15번 바뀜), 열릴 땐 바로, 닫힐 땐 한 번에 3칸까지만(입이 덜컥 닫히지 않게).
 */
export function mouthLevels(pcm: Float32Array, rate: number, fps: number, frames: number): number[] {
  const per = rate / fps;
  const rms: number[] = [];
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f * per), b = Math.min(pcm.length, Math.floor((f + 1) * per));
    let s = 0;
    for (let k = a; k < b; k++) s += pcm[k]! * pcm[k]!;
    rms.push(b > a ? Math.sqrt(s / (b - a)) : 0);
  }
  const voiced = rms.filter((v) => v > 0.004).sort((x, y) => x - y);
  const ref = voiced.length ? voiced[Math.floor(voiced.length * 0.9)]! : 1;
  const out: number[] = [];
  let last = 0;
  for (let f = 0; f < rms.length; f++) {
    // 입 모양은 두 프레임씩(초당 15번) 바꾼다 — 30fps 로 바꾸면 입이 떨린다. 두 프레임 중 큰 쪽.
    if (f % 2 === 1) { out.push(last); continue; }
    const r = Math.max(rms[f]!, rms[f + 1] ?? 0) / Math.max(ref, 1e-6);
    let lv = r < 0.12 ? 0 : Math.min(9, Math.round(r * 9));
    if (lv < last - 3) lv = last - 3;
    out.push(lv);
    last = lv;
  }
  return out;
}

/** 장면 키트 지시문(순수) — 진행자가 켜진 편이면 키트 문서 뒤에 비온이 문서(KIT_API_BIONEE.md — 2026-10-23 코드 리그 신호)를 붙이고, 꺼지면 키트 문서 그대로(꺼진 편의 장면 지시문은 종전과 같다). */
export function kitForPresenter(kit: string, presenterDoc?: string): string {
  return presenterDoc ? `${kit.replace(/\n*$/, '')}\n\n${presenterDoc.trim()}\n` : kit;
}
