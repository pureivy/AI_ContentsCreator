// 비온이 동작 시간표(순수, 결정적) — 신호(cue) 목록 → 프레임마다 Pose. 2026-10-23.
// 층: ① 이동·방향(걷기·돌기 — 끝난 뒤에도 남는 값) → ② 가만히 있을 때의 생기(숨·흔들림·두리번·귀 까딱) → ③ 신호(동작마다 쥔 무리만 4~8프레임 섞어 넣고 뺌)
//     → ④ 말하기(입 열림 배열 + 모음 모양) → ⑤ 눈 깜빡임 → ⑥ 줄기 끝 늦게 따라오기(스프링, 지난 36프레임 다시 계산).
import { ARM, FACE, bodyR, makeView, smooth, surf, type P } from './geom';
import { DEFAULT_POSE, EXPR, HANDS, mixHand, mixInto, restArm, type Arm, type ExprName, type Group, type Pose, type PropKind, type Side } from './pose';
import { random } from 'remotion';
import { BIONEE_DEFAULT_DUR, type BioneeAction as Action, type BioneeCue as Cue, type BioneeCueParams as CueParams, type BioneeTarget as Target } from '../../../../src/longform/bioneeCues';

// 낱말 목록·신호 모양은 src/longform/bioneeCues.ts 가 정본(장면 파일 읽기·검사·편 시간표가 같은 정의를 쓴다 — 2026-10-23).
export { BIONEE_ACTIONS as ACTIONS } from '../../../../src/longform/bioneeCues';
export type { BioneeAction as Action, BioneeTarget as Target, BioneeCueParams as CueParams, BioneeCue as Cue } from '../../../../src/longform/bioneeCues';

export type ActorSpec = {
  cues: readonly Cue[];
  fps?: number;
  /** 기본 자리(땅 닿는 점, 무대 px) */
  home: { x: number; y: number };
  /** 크기(1 = 키 약 520px) */
  scale?: number;
  stageW?: number;
  /** 낭독 입 열림(프레임당 0~9, mouthStart 프레임부터) */
  mouth?: readonly number[];
  mouthStart?: number;
  /** 처음 방향(-1~1) */
  facing?: number;
  seed?: string;
};

export const DEFAULT_DUR: Record<Action, number> = BIONEE_DEFAULT_DUR;
const LOCO: ReadonlySet<Action> = new Set(['walkIn', 'walkOut', 'walkTo', 'turn']);
/** 반걸음 길이(로컬) — 걸은 거리로 위상을 잰다(발이 미끄러지지 않게). */
const STRIDE = 58;
const HALF_W = 235;

const cl = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 걷기 이동 — 가속·감속이 있되 가운데는 고른 속도. */
const moveEase = (u: number) => { const s = smooth(u); return 0.55 * u + 0.45 * s; };

type Loco = { x: number; turn: number; walkPhase: number; walkAmt: number; walkDir: number };

function resolveTo(to: CueParams['to'], cur: number): number {
  if (to == null) return cur;
  if (to === 'left') return -0.6;
  if (to === 'right') return 0.6;
  if (to === 'front') return 0;
  return cl(to, -1, 1);
}

/** ① 이동·방향 — 걷기·돌기 신호를 시간 순으로 쌓는다. */
function locoAt(f: number, spec: ActorSpec, cues: readonly Cue[]): Loco {
  const fps = spec.fps ?? 30, sc = spec.scale ?? 1, W = spec.stageW ?? 1920;
  const off = (side: 'left' | 'right') => (side === 'left' ? -HALF_W * sc - 30 : W + HALF_W * sc + 30);
  const firstWalk = cues.find((c) => LOCO.has(c.action) && c.action !== 'turn');
  let x = firstWalk?.action === 'walkIn' ? off(firstWalk.params?.from ?? 'left') : spec.home.x;
  let turn = spec.facing ?? 0;
  let phase = 0, amt = 0, dir = 0;
  for (const c of cues) {
    if (!LOCO.has(c.action)) continue;
    const s = c.at * fps, d = Math.max(1, (c.dur ?? DEFAULT_DUR[c.action]) * fps), e = s + d;
    if (f < s) break;
    const u = cl((f - s) / d, 0, 1);
    if (c.action === 'turn') { turn = lerp(turn, resolveTo(c.params?.to, turn), smooth(u)); continue; }
    const x0 = c.action === 'walkIn' ? off(c.params?.from ?? 'left') : x;
    const exitSide = c.params?.side === 'left' || c.params?.side === 'right' ? c.params.side : c.params?.from;
    const x1 = c.action === 'walkOut' ? off(exitSide ?? (x > W / 2 ? 'right' : 'left')) : (c.params?.x ?? spec.home.x);
    const pos = lerp(x0, x1, moveEase(u));
    const sgn = Math.sign(x1 - x0) || 1;
    if (f < e) {
      phase += (Math.abs(pos - x0) / sc / STRIDE) * Math.PI;
      amt = smooth(Math.min(u * 7, (1 - u) * 7, 1));
      dir = sgn;
      // 가는 쪽으로 돌아 걷고, 멈추면 원래 방향으로
      const k = smooth(Math.min(u * 6, (1 - u) * 5, 1));
      return { x: pos, turn: lerp(turn, sgn * 0.62, k), walkPhase: phase, walkAmt: amt, walkDir: dir };
    }
    phase += (Math.abs(x1 - x0) / sc / STRIDE) * Math.PI;
    x = x1;
  }
  return { x, turn, walkPhase: phase, walkAmt: 0, walkDir: 0 };
}

/** 어깨(로컬) — turn 에 따라 몸 표면을 돈다. */
export function shoulder(side: Side, turn: number, pitch = 0): P {
  const s = side === 'L' ? -1 : 1;
  return surf(makeView(turn, pitch), s * 82, ARM.h, bodyR(ARM.h) - 12).p;
}
/** 쉬는 손 자리(로컬) — 옆구리, turn 따라 돈다. */
export function restArmAt(side: Side, turn: number): Arm {
  const s = side === 'L' ? -1 : 1;
  const base = restArm(side);
  const p = surf(makeView(turn, 0), s * 84, 102, bodyR(102) + 18);
  // 뒤로 돌아간 팔은 손이 몸 가장자리 밖으로 조금 비죽 나오게(완전히 숨지 않게)
  const out = p.z < 0 ? 34 * Math.min(1, -p.z * 1.6) * (Math.sign(p.p[0]) || s) : 0;
  return { ...base, x: p.p[0] + out, y: p.p[1], dir: side === 'L' ? 50 + turn * 40 : 130 + turn * 40 };
}
const rel = (side: Side, turn: number, dx: number, dy: number): [number, number] => {
  const S = shoulder(side, turn);
  return [S[0] + (side === 'L' ? -dx : dx), S[1] + dy];
};
const arm = (x: number, y: number, hand: keyof typeof HANDS, o: Partial<Arm> = {}): Arm => ({ x, y, hand: HANDS[hand], roll: 0, bend: 0, dirW: 0, dir: 0, ...o });
const sideKey = (s: Side) => (s === 'L' ? 'armL' : 'armR') as 'armL' | 'armR';
const sg = (s: Side) => (s === 'L' ? -1 : 1);
const pulse = (t: number, k = 12) => Math.exp(-t / k);

type Ctx = { fps: number; sc: number; prev: Pose; t: number; dur: number; p: number; loco: Loco };

/** 무대 점 → 로컬. 방향 문자열이면 그쪽 먼 점. */
function targetLocal(tg: Target | undefined, prev: Pose, sc: number): P {
  if (!tg || tg === 'camera') return [0, -150];
  if (tg === 'left') return [-600, -300];
  if (tg === 'right') return [600, -300];
  if (tg === 'up') return [40, -900];
  if (tg === 'down') return [300, 60];
  return [(tg.x - prev.x) / sc, (tg.y - prev.y) / sc];
}

/** ③ 신호 하나의 목표 자세(부분) + 쥔 무리. */
function cueTarget(c: Cue, x: Ctx): { b: Partial<Pose>; g: Group[] } {
  const pr = c.params ?? {};
  const k = pr.strength ?? 1;
  const { prev, t, p, fps } = x;
  const sec = t / fps;
  const ex = (d: ExprName) => EXPR[pr.expr ?? d];
  switch (c.action) {
    case 'wave': {
      const s = pr.hand ?? 'R';
      const [hx, hy] = rel(s, prev.turn, 52, -74);
      const roll = Math.sin(sec * 2 * Math.PI * 1.7) * 24 * k;
      return { b: { [sideKey(s)]: arm(hx, hy, 'wave', { dirW: 1, dir: -90 + sg(s) * 12, roll }), ...ex('happy'), earL: 8, earR: 8, flap: 0.12, fxWave: 1, lean: -sg(s) * 3 * k }, g: [sideKey(s), 'face', 'ears', 'fx', 'body'] };
    }
    case 'point': {
      const T = targetLocal(pr.target, prev, x.sc);
      const s: Side = pr.hand ?? (T[0] >= 0 ? 'R' : 'L');
      const S = shoulder(s, prev.turn);
      const th = Math.atan2(T[1] - S[1], T[0] - S[0]);
      const reach = 64;
      const look: Pick<Pose, 'lookX' | 'lookY'> = { lookX: cl((T[0] - 0) / 380, -1, 1), lookY: cl((T[1] + 150) / 380, -1, 1) };
      return {
        b: {
          [sideKey(s)]: arm(S[0] + Math.cos(th) * reach, S[1] + Math.sin(th) * reach, 'point', { dirW: 1, dir: (th * 180) / Math.PI }),
          ...ex('calm'), ...look, turn: cl(prev.turn * 0.6 + 0.12 * sg(s) * k, -1, 1), lean: sg(s) * 2.5, fxSparkle: 0.8 * pulse(t, 18), earL: s === 'L' ? 6 : 0, earR: s === 'R' ? 6 : 0,
        },
        g: [sideKey(s), 'face', 'body', 'fx', 'ears'],
      };
    }
    case 'lookAt': {
      const T = targetLocal(pr.target, prev, x.sc);
      const sx = Math.sign(T[0]) || 0;
      return { b: { lookX: cl(T[0] / 380, -1, 1), lookY: cl((T[1] + 150) / 380, -1, 1), turn: cl(prev.turn + 0.18 * sx * k, -1, 1), lean: sx * 1.5 }, g: ['eyes', 'body'] };
    }
    case 'nod': {
      const n = pr.times ?? 2;
      const q = Math.pow(Math.sin(Math.PI * n * p), 2);
      return { b: { pitch: 0.24 * k * q, earL: -6 * q, earR: -6 * q, ...ex('happy'), lookY: 0.3 * q }, g: ['body', 'ears', 'face'] };
    }
    case 'shake': {
      const n = pr.times ?? 3;
      const env = Math.sin(Math.PI * p);
      return { b: { turn: cl(prev.turn + 0.24 * k * Math.sin(2 * Math.PI * n * p) * env, -1, 1), fxShake: env, ...ex('focused'), smile: -0.15, flap: 0.25 }, g: ['body', 'fx', 'face', 'ears'] };
    }
    case 'hop': {
      const n = pr.times ?? 1;
      const q = (p * n) % 1;
      let lift = 0, squash = 0;
      if (q < 0.2) squash = 0.17 * Math.sin((Math.PI * q) / 0.2);
      else if (q < 0.78) { const a = (q - 0.2) / 0.58; lift = 75 * k * 4 * a * (1 - a); squash = -0.11 * Math.sin(Math.PI * a); }
      else squash = 0.2 * Math.sin((Math.PI * (q - 0.78)) / 0.22);
      return { b: { lift, squash, ...ex('happy'), earL: lift > 0 ? 14 : -4, earR: lift > 0 ? 14 : -4, flap: lift > 0 ? 0.6 : 0 }, g: ['body', 'face', 'ears'] };
    }
    case 'think': {
      const s = pr.hand ?? (prev.turn > 0.2 ? 'R' : 'L');
      const v = makeView(prev.turn, 0);
      const chin = surf(v, sg(s) * 16, FACE.mouthH - 30, bodyR(FACE.mouthH - 30) + 22).p;
      return {
        b: {
          [sideKey(s)]: arm(chin[0], chin[1], 'chin', { dirW: 1, dir: s === 'L' ? -55 : -125 }),
          ...ex('thinking'), lookX: -sg(s) * 0.55, fxQuestion: smooth((sec - 0.35) * 3), lean: -sg(s) * 4 * k, turn: cl(prev.turn + 0.08 * sg(s), -1, 1),
          earL: s === 'L' ? -8 : 12, earR: s === 'R' ? -8 : 12,
        },
        g: [sideKey(s), 'face', 'fx', 'body', 'ears'],
      };
    }
    case 'thumbsUp': {
      const s = pr.hand ?? 'R';
      const [hx, hy] = rel(s, prev.turn, 52, -42);
      const pop = 1 - pulse(t, 5);
      return { b: { [sideKey(s)]: arm(hx, hy - 6 * pop, 'thumbsUp', { dirW: 1, dir: s === 'R' ? -8 : 188 }), ...ex('grin'), fxSparkle: pulse(t, 22), lean: -sg(s) * 3, lift: 8 * Math.sin(Math.min(1, t / 9) * Math.PI), earL: 10, earR: 10 }, g: [sideKey(s), 'face', 'fx', 'body', 'ears'] };
    }
    case 'surprised': {
      const v = makeView(prev.turn, 0);
      const hand = (s: Side) => { const q = surf(v, sg(s) * 50, FACE.cheekH - 2, bodyR(FACE.cheekH) + 24).p; return arm(q[0], q[1], 'open', { dirW: 1, dir: s === 'L' ? -70 : -110 }); };
      const jolt = Math.sin(Math.min(1, t / 7) * Math.PI);
      return {
        b: { armL: hand('L'), armR: hand('R'), ...ex('surprised'), earL: 28 * k, earR: 28 * k, flap: 0.5 * pulse(t, 10), lift: 16 * jolt * k, squash: -0.07 * jolt, pitch: -0.08, fxExclaim: 1 },
        g: ['armL', 'armR', 'face', 'ears', 'body', 'fx'],
      };
    }
    case 'worried': {
      const both = (s: Side) => arm(sg(s) * 26, -66, 'fist', { dirW: 1, dir: s === 'L' ? 20 : 160 });
      return { b: { armL: both('L'), armR: both('R'), ...ex('worried'), earL: -24 * k, earR: -24 * k, fxSweat: 1, lean: Math.sin(sec * 5) * 1.6, squash: 0.03 }, g: ['armL', 'armR', 'face', 'ears', 'fx', 'body'] };
    }
    case 'laugh': {
      const b = Math.abs(Math.sin(sec * Math.PI * 4.2));
      const belly = (s: Side) => arm(sg(s) * 78, -78 + b * 4, 'open', { dirW: 1, dir: s === 'L' ? 15 : 165 });
      return { b: { armL: belly('L'), armR: belly('R'), ...ex('laugh'), lift: 7 * b * k, squash: 0.04 * b, lean: Math.sin(sec * 3) * 2, pitch: -0.05, flap: 0.45, fxLaugh: 1 }, g: ['armL', 'armR', 'face', 'body', 'ears', 'fx'] };
    }
    case 'holdSign':
    case 'hold': {
      const s = pr.hand ?? 'R';
      const kind: Exclude<PropKind, 'none'> = c.action === 'holdSign' ? 'sign' : (pr.prop ?? 'magnifier');
      const lift = kind === 'sign' ? [92, -16] : kind === 'magnifier' ? [40, -60] : kind === 'stick' ? [55, -20] : [55, 6];
      const [hx, hy] = rel(s, prev.turn, lift[0]!, lift[1]!);
      const dir = kind === 'sign' ? (s === 'R' ? 200 : -20) : kind === 'stick' ? (s === 'R' ? -25 : 205) : kind === 'can' ? (s === 'R' ? 160 : 20) : s === 'R' ? -70 : -110;
      const hand = kind === 'stick' || kind === 'can' || kind === 'magnifier' ? 'hold' : 'hold';
      return {
        b: { [sideKey(s)]: arm(hx, hy + Math.sin(sec * 2.4) * 2, hand, { dirW: 1, dir }), prop: kind, propSide: s, propText: pr.text ?? '', propAmt: 1, propTilt: sg(s) * 3 + Math.sin(sec * 1.9) * 2.5, ...ex('happy'), earR: s === 'R' ? -16 : 4, earL: s === 'L' ? -16 : 4, lean: -sg(s) * 2 },
        g: [sideKey(s), 'prop', 'face', 'ears', 'body'],
      };
    }
    case 'bow': {
      const q = p < 0.3 ? smooth(p / 0.3) : p < 0.7 ? 1 : smooth((1 - p) / 0.3);
      const front = (s: Side) => arm(sg(s) * 40, -44, 'open', { dirW: 1, dir: s === 'L' ? 20 : 160 });
      return { b: { armL: front('L'), armR: front('R'), pitch: 0.17 * q * k, ...ex('happy'), earL: -30 * q, earR: -30 * q, squash: 0.07 * q }, g: ['armL', 'armR', 'body', 'face', 'ears'] };
    }
    case 'peek': {
      const side = pr.side ?? 'left';
      const inK = smooth(p / 0.22) * smooth((1 - p) / 0.2);
      const W = 1920;
      const out = side === 'left' ? -HALF_W * x.sc - 20 : W + HALF_W * x.sc + 20;
      const half = side === 'left' ? 20 * x.sc : W - 20 * x.sc;
      if (side === 'bottom') return { b: { lift: -lerp(560, 250, inK), ...ex('shy'), lookY: -0.4, earL: 10 * inK, earR: 10 * inK }, g: ['body', 'face', 'ears'] };
      const s = side === 'left' ? 1 : -1;
      return { b: { x: lerp(out, half, inK), lean: s * 13 * inK, turn: s * 0.35, ...ex('shy'), lookX: s * 0.8, lookY: 0, earL: 8, earR: 8 }, g: ['body', 'face', 'ears'] };
    }
    case 'face':
      return { b: { ...ex('neutral') }, g: ['face'] };
    case 'walkIn':
    case 'walkOut':
    case 'walkTo':
      return { b: { ...ex('calm') }, g: ['face'] };
    case 'turn':
      return { b: {}, g: [] };
  }
}

/** 깜빡임(0~1) — 2.5~5초 간격, 가끔 두 번. */
function blinkAt(f: number, seed: string): number {
  let t = 25;
  for (let k = 0; t <= f; k++) {
    const d = f - t;
    const shape = [0.5, 1, 1, 0.65, 0.25];
    if (d < 5) return shape[d]!;
    const dbl = random(`${seed}-dbl-${k}`) < 0.18;
    if (dbl && d >= 8 && d < 13) return shape[d - 8]!;
    t += 75 + Math.floor(random(`${seed}-blink-${k}`) * 75);
  }
  return 0;
}

/** ② 생기 — 숨·흔들림·두리번·귀 까딱(신호가 쥐지 않은 무리에만 남는다). */
function idleLayer(f: number, pose: Pose, seed: string): Pose {
  const o = { ...pose };
  o.squash += 0.012 * Math.sin((2 * Math.PI * f) / 102);
  o.lean += 0.9 * Math.sin((2 * Math.PI * f) / 138 + 0.7);
  // 두리번 — 5~8초마다 1.2초쯤 옆을 본다
  let t = 60;
  for (let k = 0; t <= f + 60; k++) {
    const len = 36 + Math.floor(random(`${seed}-gl-l${k}`) * 20);
    const d = f - t;
    if (d >= -8 && d < len + 8) {
      const g = smooth((d + 8) / 8) * smooth((len + 8 - d) / 8);
      o.lookX += (random(`${seed}-gl-x${k}`) - 0.5) * 1.3 * g;
      o.lookY += (random(`${seed}-gl-y${k}`) - 0.6) * 0.5 * g;
      o.turn += (random(`${seed}-gl-x${k}`) - 0.5) * 0.08 * g;
    }
    t += 150 + Math.floor(random(`${seed}-gl-${k}`) * 90);
  }
  // 귀 까딱
  t = 90;
  for (let k = 0; t <= f; k++) {
    const d = f - t;
    if (d < 12) { const q = Math.sin((Math.PI * d) / 12); if (random(`${seed}-ear-${k}`) < 0.5) o.earL += 12 * q; else o.earR += 12 * q; }
    t += 110 + Math.floor(random(`${seed}-eart-${k}`) * 100);
  }
  return o;
}

type Vowel = { open: number; wide: number; round: number; smile: number };
const VOWELS: Vowel[] = [
  { open: 1, wide: 0.6, round: 0, smile: 0.5 }, // 아
  { open: 0.6, wide: 1, round: 0, smile: 0.6 }, // 에
  { open: 0.85, wide: 0.15, round: 1, smile: 0.1 }, // 오
  { open: 0.5, wide: 0, round: 1, smile: 0 }, // 우
  { open: 0.38, wide: 1, round: 0, smile: 0.85 }, // 이
  { open: 0.75, wide: 0.45, round: 0.35, smile: 0.3 }, // 어
];
const VOWEL_PICK = [0, 0, 1, 2, 5, 3, 4, 0, 5, 1, 2, 0];

/** ④ 말하기 — 입 열림 + 음절마다 모음 모양(오르막에서 바뀌고, 3프레임에 걸쳐 섞임). */
function talkLayer(f: number, pose: Pose, spec: ActorSpec): Pose {
  const m = spec.mouth;
  if (!m || !m.length) return pose;
  const i = f - (spec.mouthStart ?? 0);
  if (i < 0 || i >= m.length + 4) return pose;
  const lv = i < m.length ? m[i]! : 0;
  // 음절 시작 찾기(오르막)
  let syl = 0, lastOn = -99, curOn = 0, prevOn = 0;
  for (let j = 2; j <= Math.min(i, m.length - 1); j++) {
    if (m[j]! >= 3 && m[j]! >= (m[j - 2] ?? 0) + 2 && j - lastOn >= 5) { syl++; prevOn = curOn; curOn = j; lastOn = j; }
  }
  const seed = spec.seed ?? 'bn';
  const vOf = (n: number) => VOWELS[VOWEL_PICK[Math.floor(random(`${seed}-v${n}`) * VOWEL_PICK.length)]!]!;
  const a = vOf(syl - 1), b = vOf(syl);
  const w = smooth((i - curOn) / 3);
  void prevOn;
  const v: Vowel = { open: lerp(a.open, b.open, w), wide: lerp(a.wide, b.wide, w), round: lerp(a.round, b.round, w), smile: lerp(a.smile, b.smile, w) };
  const kt = smooth(lv / 3);
  const o = { ...pose };
  // 2026-10-23 — 본편 크기(0.6)·휴대폰에서도 말하는 게 보이게 조금 크게 벌린다
  o.mOpen = Math.max(pose.mOpen * (1 - kt), Math.min(1.15, (lv / 9) * 1.25 * v.open));
  o.mWide = lerp(pose.mWide, v.wide, kt);
  o.mRound = lerp(pose.mRound, v.round, kt);
  o.smile = lerp(pose.smile, Math.max(v.smile, pose.smile * 0.6), kt);
  o.wavy = pose.wavy * (1 - kt);
  o.tongue = pose.tongue * (1 - kt);
  o.lift += lv * 0.35;
  // 강세 음절마다 살짝 끄덕(머리 까딱) — 음절 시작 4프레임 안, 큰 소리일수록
  if (curOn > 0 && i - curOn < 8 && lv >= 5) o.pitch += 0.045 * Math.exp(-(i - curOn) / 3) * (lv / 9);
  o.earL += lv * 0.5; o.earR += lv * 0.5;
  return o;
}

const sortCues = (cues: readonly Cue[]) => cues.slice().sort((a, b) => a.at - b.at);

/** ①~③ — 이동·생기·신호(말하기·깜빡임·스프링 전). */
function core(f: number, spec: ActorSpec, cues: readonly Cue[]): Pose {
  const fps = spec.fps ?? 30, sc = spec.scale ?? 1;
  const loco = locoAt(f, spec, cues);
  let pose: Pose = { ...DEFAULT_POSE, x: loco.x, y: spec.home.y, size: sc, turn: loco.turn, walkPhase: loco.walkPhase, walkAmt: loco.walkAmt, armL: restArmAt('L', loco.turn), armR: restArmAt('R', loco.turn) };
  // 걷기 — 몸 들썩·뒤뚱·가는 쪽으로 숙임·팔 흔들기
  if (loco.walkAmt > 0) {
    const a = loco.walkAmt, ph = loco.walkPhase;
    pose.lift += a * Math.abs(Math.sin(ph)) * 7;
    pose.lean += a * (Math.sin(ph) * 3.2 + loco.walkDir * 3);
    pose.squash += a * 0.03 * Math.cos(2 * ph);
    // 팔 흔들기 — 보는 방향(옆모습이면 화면 좌우)으로 앞뒤, 손은 반쯤 펴서 아래로
    const side = Math.abs(Math.sin((loco.turn * Math.PI) / 2));
    const sw = 30 * side + 8;
    const swing = (sd: Side, sgn: number): Arm => {
      const S = shoulder(sd, loco.turn);
      const c = Math.cos(ph) * sgn;
      const tgt: P = [S[0] + c * sw * loco.walkDir + (1 - side) * sg(sd) * 14, S[1] + 50 - Math.abs(c) * 8];
      const base = sd === 'L' ? pose.armL : pose.armR;
      return { ...base, x: lerp(base.x, tgt[0], a), y: lerp(base.y, tgt[1], a), hand: mixHand(base.hand, HANDS.open, 0.55 * a), dirW: 1, dir: lerp(base.dir, 90 - c * 35 * loco.walkDir, a) };
    };
    pose.armL = swing('L', 1);
    pose.armR = swing('R', -1);
    pose.flap = Math.max(pose.flap, 0.08 * a);
  }
  pose = idleLayer(f, pose, spec.seed ?? 'bn');
  for (const c of cues) {
    if (c.action === 'turn') continue;
    const B = c.params?.blend ?? 6;
    const s = c.at * fps, d = Math.max(1, (c.dur ?? DEFAULT_DUR[c.action]) * fps), e = s + d;
    if (f < s || f > e + B) continue;
    const t = f - s;
    const w = smooth(Math.min(t / B, (e + B - f) / B, 1));
    const { b, g } = cueTarget(c, { fps, sc, prev: pose, t, dur: d, p: cl(t / d, 0, 1), loco });
    pose = mixInto(pose, b, w, g);
  }
  return pose;
}

/** 한 프레임의 자세(결정적). */
export function poseAt(f: number, spec: ActorSpec): Pose {
  const cues = sortCues(spec.cues);
  let pose = core(f, spec, cues);
  pose = talkLayer(f, pose, spec);
  // ⑤ 깜빡임(눈을 뜨고 있을 때만)
  const bl = blinkAt(f, spec.seed ?? 'bn');
  if (bl > 0 && pose.happy < 0.5) pose = { ...pose, eyeOpen: pose.eyeOpen * (1 - bl * (pose.big > 0.5 ? 0.8 : 1)) };
  // ⑥ 줄기 끝 스프링 — 지난 36프레임 몸 끝(로컬) 움직임으로
  const sc = spec.scale ?? 1;
  const tip = (q: Pose): P => {
    const a = (q.lean * Math.PI) / 180;
    return [q.x / sc + Math.sin(a) * 420 + q.turn * 30, -q.lift - Math.cos(a) * 420 * (1 - q.squash) - Math.sin(q.pitch) * 150];
  };
  const N = 36;
  const hist: P[] = [];
  for (let k = f - N - 2; k <= f; k++) hist.push(tip(k === f ? pose : core(Math.max(0, k), spec, cues)));
  const om = (2 * Math.PI * 1.5) / 30, ze = 0.32;
  let ox = 0, oy = 0, vx = 0, vy = 0;
  for (let i = 2; i < hist.length; i++) {
    const ax = hist[i]![0] - 2 * hist[i - 1]![0] + hist[i - 2]![0];
    const ay = hist[i]![1] - 2 * hist[i - 1]![1] + hist[i - 2]![1];
    vx += -om * om * ox - 2 * ze * om * vx - ax; ox += vx;
    vy += -om * om * oy - 2 * ze * om * vy - ay; oy += vy;
  }
  const lagX = cl(ox, -45, 45), lagY = cl(oy * 0.6, -30, 30);
  return { ...pose, lagX, lagY, earL: pose.earL - lagY * 0.6 + lagX * 0.25, earR: pose.earR - lagY * 0.6 - lagX * 0.25 };
}

/** 시트·시험용 — 신호 하나를 t초 시점으로 본 자세(이동 없음). */
export function poseOf(action: Action, params: CueParams = {}, tSec = 0.6, base: Partial<Pose> = {}): Pose {
  const spec: ActorSpec = { cues: [{ at: 0, dur: Math.max(DEFAULT_DUR[action], tSec + 0.5), action, params }], home: { x: 0, y: 0 }, seed: 'sheet' };
  const f = Math.round(tSec * 30);
  const cues = sortCues(spec.cues);
  const p = core(f, spec, cues);
  return { ...p, ...base, lagX: 0, lagY: 0 };
}
