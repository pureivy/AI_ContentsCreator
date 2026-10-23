// 장면 자동화용 순수 도우미 — 박자(beat), 낭독 단어 → 프레임(atFromWords), 글자 길이 검사(labelLen), 안전 영역.
// React·remotion 훅을 쓰지 않는다(테스트·파이프라인 검사기에서도 그대로 부른다).
import { Easing, interpolate } from 'remotion';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 도해 좌표계(viewBox) — 모든 장면 좌표는 이 1000×620 기준. */
export const VIEW = { w: 1000, h: 620 } as const;
/** 글자 안전 영역 — 가장자리 둥근 모서리·카메라 당김(최대 1.04배)을 피한 상자. */
export const SAFE = { x0: 48, y0: 44, x1: 952, y1: 580 } as const;
export type SafeBox = { x0: number; y0: number; x1: number; y1: number };
/** 배경별 땅·탁자 높이 — sky 는 Ground(y=GROUND_Y), indoor 는 탁자 윗면(TABLE_Y). */
export const GROUND_Y = 560;
export const TABLE_Y = 520;

// 글자 한도·라벨 길이·단어 시각 타입은 src/longform/sceneRules.ts 공용(파이프라인 검사기와 같은 값).
export { LABEL_MAX_KO, LABEL_MAX_NUMERIC, MAX_LABELS, labelLen, type LabelCheck, type Word } from '../../../src/longform/sceneRules';
import type { Word } from '../../../src/longform/sceneRules';

/** 글자 폭 어림 — 한글·전각은 글자 크기만큼, 영문·숫자·기호는 0.6배. */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += /[ᄀ-ᇿ㄰-㆏가-힯　-〿＀-￯←-⇿]/.test(ch) ? size * 0.98 : ch === ' ' ? size * 0.3 : size * 0.6;
  return w;
}

/** 라벨 기준점을 안전 영역 안으로 민다 — 글자 상자(어림 폭·글자 크기 높이)가 상자 밖으로 나가지 않게. */
export function clampLabel(x: number, y: number, text: string, size: number, anchor: 'start' | 'middle' | 'end' = 'middle', safe: SafeBox = SAFE): { x: number; y: number } {
  const w = textWidth(text, size) + size * 0.24; // 테두리 몫
  const left = anchor === 'start' ? 0 : anchor === 'middle' ? w / 2 : w;
  const right = w - left;
  const nx = Math.min(Math.max(x, safe.x0 + left), safe.x1 - right);
  // y 는 글자 바닥선 — 위로 글자 크기만큼, 아래로 0.25배(받침).
  const ny = Math.min(Math.max(y, safe.y0 + size), safe.y1 - size * 0.25);
  return { x: nx, y: ny };
}

/** 박자 — at 부터 dur 프레임 동안 0→1(기본 ease-out cubic). 결정적. */
export function beat(frame: number, at: number, dur = 18, ease: 'out' | 'inOut' | 'linear' | 'back' = 'out'): number {
  const easing = ease === 'linear' ? (t: number) => t : ease === 'inOut' ? Easing.inOut(Easing.cubic) : ease === 'back' ? Easing.out(Easing.back(1.6)) : Easing.out(Easing.cubic);
  return interpolate(frame, [at, at + Math.max(1, dur)], [0, 1], { ...clamp, easing });
}

/** 나타났다 사라지는 박자 — at 에서 inDur 동안 켜지고, until 부터 outDur 동안 꺼진다(0~1). until 이 없으면 켜진 채. */
export function beatInOut(frame: number, at: number, until?: number, inDur = 12, outDur = 10): number {
  const a = beat(frame, at, inDur);
  if (until == null) return a;
  return a * (1 - beat(frame, until, outDur, 'inOut'));
}

/** 두 값 사이 — 박자 진행값 t(0~1)로 a→b. */
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const norm = (s: string) => s.normalize('NFC').replace(/[\s.,!?·…~"'“”‘’()[\]{}:;]/g, '').toLowerCase();
/**
 * 낭독 단어 → 프레임. words 의 start 는 '이 장면 시작부터 잰 초'. 조사가 붙어도 찾게 부분 일치(피트모스 ⊂ 피트모스를).
 * 못 찾으면 fallback(기본 0)을 돌려준다 — NaN 을 내지 않는다. nth: 같은 단어가 여러 번이면 몇 번째(0부터).
 * lead: 말보다 몇 프레임 먼저 보여 줄지(기본 4 — 눈이 귀보다 먼저).
 */
export function atFromWords(words: Word[] | undefined, token: string, fps: number, fallback = 0, opts: { nth?: number; lead?: number } = {}): number {
  const t = norm(token);
  if (!words || !t) return fallback;
  let k = opts.nth ?? 0;
  for (const wd of words) {
    if (!Number.isFinite(wd.start)) continue;
    if (norm(wd.w).includes(t)) {
      if (k-- > 0) continue;
      return Math.max(0, Math.round(wd.start * fps) - (opts.lead ?? 4));
    }
  }
  return fallback;
}
