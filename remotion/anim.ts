import { spring } from 'remotion';
import { noise2D } from '@remotion/noise';

export function clamp01(x: number): number { return Math.min(1, Math.max(0, x)); }
/** smoothstep 이징(0..1) — 선형 대비 시작·끝이 부드러워 Ken Burns 류 저속 모션에 적합. */
export function smoothstep(p: number): number {
  const t = clamp01(p);
  return t * t * (3 - 2 * t);
}
/** Ken Burns 스케일 — smoothstep 이징 + 씬별 변주: 짝수 씬 줌인(1→max), 홀수 씬 줌아웃(max→1). */
export function kenBurnsScale(local: number, total: number, max = 1.08, index = 0): number {
  const p = smoothstep(total > 0 ? local / total : 0);
  const zoomOut = index % 2 === 1;
  return zoomOut ? max - (max - 1) * p : 1 + (max - 1) * p;
}
// 팬 방향 4종 순환 — 전 씬 동일 대각선(↗ 고정)이던 단조로움 제거. 단위 벡터(±1).
const PAN_DIRS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: -1, y: -1 },
];
export function kenBurnsPan(local: number, total: number, index = 0): { x: number; y: number } {
  const p = smoothstep(total > 0 ? local / total : 0);
  const d = PAN_DIRS[index % PAN_DIRS.length]!;
  return { x: (p - 0.5) * 24 * d.x, y: (p - 0.5) * 24 * d.y };
}
/** 씬 시작 페이드인만(0→1, ease) — 씬 전환 하드컷 완화. 오디오 싱크(씬 길이) 불변. */
export function sceneEnterFade(local: number, fade = 6): number {
  return smoothstep(fade > 0 ? local / fade : 1);
}
// 배경 모션 어휘 — I2V 상한제(핵심 컷만 클립화)에서 스틸 씬의 '움직임 공백'을 메우는 결정적 연출.
export type KenMove = 'zoom-in' | 'zoom-out' | 'push' | 'none';
export type KenIntensity = 'subtle' | 'normal' | 'strong';
// 진폭 재보정(2026-08-10 실런 체감 부족 실측): 종전 줌 8%/팬 ±12px(화면 1%)는 6~7초 씬에서 정지로
// 보였다. zoom=최대 배율, pan=최대 오프셋(px, ±), push=훅 강줌 배율.
const INTENSITY: Record<KenIntensity, { zoom: number; pan: number; push: number }> = {
  subtle: { zoom: 1.05, pan: 14, push: 1.15 },
  normal: { zoom: 1.12, pan: 30, push: 1.22 },
  strong: { zoom: 1.28, pan: 70, push: 1.35 }, // 2차 상향(2026-08-10 사용자 재보정 요청)
};
// 상시 오버스캔 + 축별 팬 캡 — objectFit:cover 는 이미지를 요소 상자 '안에서' 크롭하므로
// 커버 오버플로는 여유가 아니다(우측 검은 띠 실측 2026-08-10: 줌아웃 끝 s=1.08 에서 가로 여유
// (s-1)*540=43px < 시프트 70*1.08=75.6px → 32px 노출). 여유는 스케일 몫뿐이라 팬 오프셋을
// 축별 허용치(|t| ≤ (s-1)*half/s, 안전율 0.94)로 클램프한다 — 어떤 조합에도 노출 불가.
const OVERSCAN = 1.08;
// 1080x1920 절반 — 축별 여유 산정 기준. 기본값은 종전 하드코딩과 동일하고, 호출부가
// useVideoConfig 로 읽은 실제 치수를 넘기면 컴포지션 크기가 바뀌어도 팬 캡이 따라간다.
const HALF_W = 540, HALF_H = 960;
const axisCap = (scale: number, half: number): number => Math.max(0, ((scale - 1) * half) / scale) * 0.94;
const clampAbs = (v: number, cap: number): number => Math.max(-cap, Math.min(cap, v));
// ── 손 흔들림 드리프트(2026-09-03) ────────────────────────────────────────────
// 켄번즈는 직선 궤도라 정직하지만 기계적이다 — 정지 이미지 위에 완벽하게 매끄러운 등속 줌이
// 얹히면 "생성 이미지에 효과 하나 걸었다"가 그대로 읽힌다. 실사 소재가 없어 스틸로 버텨야 하는
// 지금 상황에서, 궤도를 저주파 노이즈로 흔들어 손으로 든 카메라처럼 만든다.
//
// 진폭은 일부러 작다(±12px ≈ 화면 폭의 1%, 회전 0.3°). 크게 흔들면 멀미가 나고, 무엇보다
// 배경이 자막·카드보다 시끄러워진다. 목적은 '움직임을 보태는 것'이 아니라 '기계적 완벽함을
// 깨는 것'이다.
const DRIFT_PX = 12;
const DRIFT_DEG = 0.3;
const DRIFT_PERIOD = 110; // 프레임 — 30fps 에서 약 3.7초 주기. 씬 길이(5~8초)보다 길어야 흔들림이 반복돼 보이지 않는다.
/**
 * 저주파 카메라 드리프트(순수·결정적). seed 가 없으면 0 — 구 호출부는 종전 궤도 그대로다.
 * 축마다 다른 노이즈 흐름을 써서 x·y 가 같이 움직이는(=대각선 왕복) 부자연스러움을 피한다.
 */
export function cameraDrift(local: number, seed?: string): { x: number; y: number; rotate: number } {
  if (!seed) return { x: 0, y: 0, rotate: 0 };
  const t = local / DRIFT_PERIOD;
  return {
    x: noise2D(`${seed}:dx`, t, 0) * DRIFT_PX,
    y: noise2D(`${seed}:dy`, t, 0) * DRIFT_PX,
    rotate: noise2D(`${seed}:dr`, t, 0) * DRIFT_DEG,
  };
}

/**
 * Ken Burns 확장 무브(순수) — move·intensity 둘 다 미지정이면 종전 index parity(줌 1.08·팬 ±12,
 * 오버스캔 없음) 그대로라 구 props 폴백 불변. intensity 지정 시 신 진폭 + 앞쪽 몰림 타이밍:
 * 줌·팬은 씬의 85%, push 는 70% 지점에 완료돼 초반 체감 속도를 높인다(이후 정지=settle).
 * 'push'는 훅용 강줌+미세 회전(1.5° 캡)+팬 40%, 'none'은 완전 정지.
 */
export function kenBurnsMove(local: number, total: number, index = 0, move?: KenMove, intensity?: KenIntensity, half: { w: number; h: number } = { w: HALF_W, h: HALF_H }, driftSeed?: string): { scale: number; x: number; y: number; rotate: number } {
  if (move === 'none') return { scale: 1, x: 0, y: 0, rotate: 0 };
  if (!move && !intensity) { // 구 동작 보존 — fx 없는 씬(옛 props·명시 폴백)
    const pan = kenBurnsPan(local, total, index);
    return { scale: kenBurnsScale(local, total, 1.08, index), x: pan.x, y: pan.y, rotate: 0 };
  }
  const cfg = INTENSITY[intensity ?? (move === 'push' ? 'strong' : 'normal')]; // push 는 강줌이 본질
  const window = move === 'push' ? 0.7 : 0.85;
  const p = smoothstep(total > 0 ? Math.min(1, local / (total * window)) : 0);
  const d = PAN_DIRS[index % PAN_DIRS.length]!;
  if (move === 'push') {
    const scale = OVERSCAN * (1 + (cfg.push - 1) * p);
    const dr = cameraDrift(local, driftSeed);
    return {
      scale,
      x: clampAbs((p - 0.5) * 2 * cfg.pan * 0.4 * d.x + dr.x, axisCap(scale, half.w)),
      y: clampAbs((p - 0.5) * 2 * cfg.pan * 0.4 * d.y + dr.y, axisCap(scale, half.h)),
      rotate: 1.5 * p + dr.rotate,
    };
  }
  const zoomOut = move === 'zoom-out' || (move === undefined && index % 2 === 1);
  const scale = OVERSCAN * (zoomOut ? cfg.zoom - (cfg.zoom - 1) * p : 1 + (cfg.zoom - 1) * p);
  const dr = cameraDrift(local, driftSeed);
  return {
    scale,
    x: clampAbs((p - 0.5) * 2 * cfg.pan * d.x + dr.x, axisCap(scale, half.w)),
    y: clampAbs((p - 0.5) * 2 * cfg.pan * d.y + dr.y, axisCap(scale, half.h)),
    rotate: dr.rotate,
  };
}
/** 자막 단어 i 의 등장 진행도(0..1, ease-out) — 이산 점프 대신 rise 프레임 동안 부드럽게. */
export function captionWordProgress(local: number, index: number, perWord = 6, rise = 5): number {
  const start = index * perWord;
  const p = clamp01((local - start) / Math.max(1, rise));
  return 1 - Math.pow(1 - p, 3);
}
/** 스포트라이트 개방 반경(%) — open 프레임 동안 30%→150%(전체 공개). 훅 첫 순간 시선 고정용. */
export function spotlightRadius(local: number, open = 24): number {
  return 30 + 120 * smoothstep(open > 0 ? Math.min(1, local / open) : 1);
}
/** 결정적 의사난수 0..1 (mulberry32 계열, 순수) — 파티클에 Math.random 금지(프레임 간 불일치로 렌더 깨짐). */
export function hash01(seed: number): number {
  let t = (Math.floor(seed) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** 파티클 상태(순수·결정적) — seed 고정 궤적: 순환 낙하(y01 0..1.15), 사인 스웨이, 회전, 크기 변주. */
export function particleState(seed: number, local: number): { x01: number; y01: number; sway: number; rot: number; size01: number } {
  const r1 = hash01(seed), r2 = hash01(seed * 7 + 1), r3 = hash01(seed * 13 + 2), r4 = hash01(seed * 31 + 3);
  const speed = 0.004 + r2 * 0.004; // 프레임당 낙하(화면비) ≈ 4~8초에 화면 한 바퀴
  return {
    x01: r1,
    y01: (r3 * 1.15 + local * speed) % 1.15, // 위 여유 포함 순환 — 씬 내내 끊김 없이
    sway: Math.sin(local * (0.03 + r4 * 0.03) + r1 * 6.28) * (0.02 + r2 * 0.02),
    rot: (local * (1 + r4 * 2) + r1 * 360) % 360,
    size01: r3,
  };
}
export function sceneFadeOpacity(local: number, total: number, fade = 6): number {
  if (total <= 0) return 1;
  const fin = clamp01(local / fade);
  const fout = clamp01((total - local) / fade);
  return clamp01(Math.min(fin, fout));
}
/** ease-out 카운트업 — total-settle 프레임까지 value 도달, 이후 유지. 정수 value→정수, 소수→1자리. */
export function countUpValue(local: number, total: number, value: number, settle = 12): number {
  const dur = Math.max(1, total - settle);
  const p = clamp01(local / dur);
  const eased = 1 - Math.pow(1 - p, 3);
  const d = Number.isInteger(value) ? 0 : 1;
  return Number((value * eased).toFixed(d));
}
/**
 * 세는 수가 아닌 단위인가(2026-10-02) — 달력 월·순번은 0부터 올라가면 중간값이 다른 뜻으로 읽힌다.
 * 실측: "11월 가을 심기 마감선" 카드가 0→11 로 올라가며 "2월 마감선"·"8월 마감선"이 잠깐씩 보였다. 기간인 '개월'은 센다.
 */
export function isStaticStatUnit(unit?: string): boolean {
  return /^(?:월|월초|월말|월중|번째|회차|주차)$/.test((unit ?? '').trim());
}
/** 리스트 항목 index 의 등장 진행도(0..1) — enter 프레임부터 씬의 windowRatio 구간에 슬롯 분배. */
export function staggerProgress(local: number, total: number, index: number, count: number, enter = 15, windowRatio = 0.6, rise = 12): number {
  if (count <= 0) return 1;
  const windowEnd = Math.max(enter + 1, total * windowRatio);
  const slot = (windowEnd - enter) / count;
  const start = enter + slot * index;
  return clamp01((local - start) / rise);
}

// ── 스프링 등장(2026-09-03) ───────────────────────────────────────────────────
// 종전 등장은 전부 cubic ease-out 이었다. 끝이 부드럽긴 해도 '멈추는' 느낌이라, 쇼츠에서 원하는
// '툭 튀어 들어와 자리잡는' 맛이 없다. Remotion 의 spring() 은 순수 함수라 fps 만 넘겨주면
// 여기서도 쓸 수 있다 — 훅은 호출부(컴포넌트)에서 useVideoConfig 로 읽는다.
//
// 씬 길이는 건드리지 않는다. 씬 오버랩(TransitionSeries)을 거부한 이유는 '오디오가 길이를
// 지배한다'는 불변식이었는데, 고정 길이 Series.Sequence 안쪽의 스프링은 길이에 영향이 없다.

/** 등장 스프링(0..1, 살짝 넘겼다 자리잡음) — delay 프레임 뒤 시작. */
export function popIn(local: number, fps: number, delay = 0): number {
  return spring({
    frame: local - delay,
    fps,
    // damping 을 낮춰 1 을 살짝 넘겼다 돌아온다(오버슛). mass 를 줄여 반응을 빠르게.
    config: { damping: 13, stiffness: 160, mass: 0.6 },
    durationInFrames: 22,
  });
}
/** 자막 단어 index 의 스프링 등장 — perWord 간격으로 순차. captionWordProgress 의 스프링판. */
export function captionWordPop(local: number, fps: number, index: number, perWord = 6): number {
  return popIn(local, fps, index * perWord);
}
/** 스프링 스태거 — staggerProgress 와 같은 슬롯 분배에 스프링 곡선을 씌운 것. */
export function staggerPop(local: number, total: number, index: number, count: number, fps: number, enter = 15, windowRatio = 0.6): number {
  if (count <= 0) return 1;
  const windowEnd = Math.max(enter + 1, total * windowRatio);
  const slot = (windowEnd - enter) / count;
  return popIn(local, fps, enter + slot * index);
}

// ── 카드 모션 v2(2026-10-05) ─────────────────────────────────────────────────
// 직접 제작 모션그래픽 파일럿에서 읽기 좋았던 움직임(순차 공개·예비 동작·정착 넘김·안쪽 요소 시차)을 결정적 곡선으로
// 옮긴다. 전부 프레임만 입력으로 받는 순수 함수다(스프링 물리 대신 닫힌 식 — 테스트로 넘김 폭을 못박을 수 있다).
// 씬 길이와 무관하다 — 고정 길이 시퀀스 안의 transform·opacity 만 바꾼다.

/** 정착 넘김 폭 — easeOutBack 의 s. 1.2 면 최대 ≈ +5.3% 넘겼다 돌아온다(1.7 은 +10% 로 출렁여 보였다). */
export const SETTLE_OVERSHOOT = 1.2;
/** easeOutBack(0..1 → 0..≈1.05..1) — 끝에서 살짝 넘겼다 자리 잡는다. 입력은 0..1 로 자른다. */
export function backOut(t: number, s = SETTLE_OVERSHOOT): number {
  const x = clamp01(t) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
}
/** 카드·행 정착(0 → 넘김 → 1) — delay 프레임부터 dur 프레임 동안. delay 전에는 0. */
export function settleIn(local: number, delay: number, dur = 14): number {
  if (local < delay) return 0;
  return backOut((local - delay) / Math.max(1, dur));
}
/**
 * 예비 동작 배율 — at 프레임에 새 요소가 뜨기 직전 pre 프레임 동안 1 → 1−depth 로 움츠렸다가, at 부터 back 프레임 동안
 * 넘겼다 1 로 돌아온다. 정답이 '툭' 들어오기 전에 숨을 한 번 들이쉬는 셈이다. 그 밖에서는 정확히 1.
 */
export function anticipateScale(local: number, at: number, pre = 5, depth = 0.03, back = 10): number {
  if (local >= at + back) return 1;
  if (local >= at) return 1 - depth + depth * backOut((local - at) / Math.max(1, back));
  if (pre <= 0 || local < at - pre) return 1;
  return 1 - depth * smoothstep((local - (at - pre)) / pre);
}
/** 선 긋기 진행(0..1, 시작·끝 부드럽게) — 취소선·화살표·밑줄. */
export function drawIn(local: number, start: number, dur = 8): number {
  return smoothstep((local - start) / Math.max(1, dur));
}
/**
 * 서버 박자 → 실제 등장 프레임(순수). 박자가 없거나 개수가 안 맞으면 fallback(종전 박자). 순서와 최소 간격(minGap)을
 * 보장하고 floor 이전에는 뜨지 않게 민다. 서버가 이미 지킨 조건이지만 직접 만든 props 도 오므로 한 번 더 건다.
 */
export function resolveBeats(beats: readonly number[] | undefined, fallback: readonly number[], minGap = 10, floor = 0): number[] {
  const src = beats && beats.length === fallback.length && beats.every((b) => Number.isFinite(b)) ? beats : fallback;
  const out: number[] = [];
  src.forEach((b, i) => out.push(Math.round(Math.max(b, i === 0 ? floor : out[i - 1]! + minGap))));
  return out;
}
/** 종전 목록 박자(staggerPop 과 같은 슬롯 분배) — v2 목록의 fail-open 기본값. */
export function listFallbackBeats(total: number, count: number, enter = 15, windowRatio = 0.6): number[] {
  const windowEnd = Math.max(enter + 1, total * windowRatio);
  const slot = (windowEnd - enter) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => Math.round(enter + slot * i));
}
/** 종전 결론 행 박자(TakeawayCard 와 같은 산식) — v2 결론 카드의 fail-open 기본값. */
export function takeawayFallbackBeats(total: number, count: number): number[] {
  const stagger = Math.max(1, Math.floor((total * 0.55) / Math.max(1, count)));
  return Array.from({ length: count }, (_, i) => 12 + i * stagger);
}
