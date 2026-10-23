// 비온이 자세(pose) — 한 프레임의 모든 조절값(연속값이라 섞을 수 있다). 순수. 2026-10-23.
// 그리기(Bionee.tsx)는 이 값만 보고 그린다. 시간표(timeline.ts)가 신호(cue) → 프레임마다 Pose 를 만든다.

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Side = 'L' | 'R';

/** 손 모양(연속값) — 손가락 셋(검지 c0·중지 c1·약지 c2) 굽힘 0~1, 벌림, 엄지 각(도, 손 방향 기준)·굽힘. */
export type HandShape = { spread: number; c0: number; c1: number; c2: number; thumbAng: number; thumbCurl: number };
export const HANDS = {
  /** 쉬기 — 개념 그림처럼 화분 옆구리에 손을 댄 주먹 비슷한 손 */
  rest: { spread: 0.2, c0: 0.85, c1: 0.85, c2: 0.85, thumbAng: 80, thumbCurl: 0.2 },
  open: { spread: 0.55, c0: 0, c1: 0, c2: 0, thumbAng: 70, thumbCurl: 0 },
  wave: { spread: 0.95, c0: 0, c1: 0, c2: 0, thumbAng: 82, thumbCurl: 0 },
  point: { spread: 0.15, c0: 0, c1: 1, c2: 1, thumbAng: 55, thumbCurl: 0.55 },
  thumbsUp: { spread: 0.1, c0: 1, c1: 1, c2: 1, thumbAng: 92, thumbCurl: 0 },
  fist: { spread: 0.1, c0: 1, c1: 1, c2: 1, thumbAng: 35, thumbCurl: 0.7 },
  hold: { spread: 0.05, c0: 0.92, c1: 0.92, c2: 0.92, thumbAng: 40, thumbCurl: 0.45 },
  chin: { spread: 0.3, c0: 0.45, c1: 0.55, c2: 0.65, thumbAng: 95, thumbCurl: 0.1 },
  clap: { spread: 0.05, c0: 0, c1: 0, c2: 0, thumbAng: 25, thumbCurl: 0 },
} as const satisfies Record<string, HandShape>;
export type HandName = keyof typeof HANDS;

/** 팔 — 손목 목표(로컬 좌표, 절대), 손 모양, 손 돌림(도, 아래팔 방향 기준 더함), 팔꿈치 방향(0 자동), 손 방향 고정(handDir: NaN 이면 아래팔 따라). */
export type Arm = { x: number; y: number; hand: HandShape; roll: number; bend: number; dirW: number; dir: number };

export type PropKind = 'none' | 'sign' | 'magnifier' | 'can' | 'stick';

export type Pose = {
  /** 무대 위치(땅 닿는 점, 무대 px) */
  x: number; y: number;
  /** 몸 들림(로컬, 위 +) · 크기 배율(1) */
  lift: number; size: number;
  /** -1 왼쪽 옆모습 … 0 정면 … +1 오른쪽 옆모습 */
  turn: number;
  /** 기울기(도, + 시계) · 앞으로 숙임(0~0.9, 라디안) · 눌림(+)/늘어남(-) */
  lean: number; pitch: number; squash: number;
  /** 걷기 위상(라디안 누적) · 걷기 정도(0~1) */
  walkPhase: number; walkAmt: number;
  /** 귀 잎 각(도, + 쫑긋/위, - 처짐) · 펄럭임 세기(0~1) · 줄기 끝 늦게 따라옴(로컬 px, 계산됨) */
  earL: number; earR: number; flap: number; lagX: number; lagY: number;
  /** 눈 — 뜸(0~1) · 윙크(-1 왼 감음, +1 오 감음) · 웃는 눈 ^^ · 놀란 큰 눈 · 반쯤 감김 · 시선(-1~1) */
  eyeOpen: number; wink: number; happy: number; big: number; lid: number; lookX: number; lookY: number;
  /** 눈썹 — 보임(0~1) · 올림(-1~1) · 기울기(+ 걱정 八, - 화남 V) · 한쪽만 올림(생각) */
  brow: number; browRaise: number; browTilt: number; browAsym: number;
  /** 입 — 벌림 · 넓이 · 동그람(o/u) · 웃음(-1~1) · 물결(걱정) · 혀 내밀기 · 옆으로 치우침 */
  mOpen: number; mWide: number; mRound: number; smile: number; wavy: number; tongue: number; mouthX: number;
  /** 볼 진하기(0~1.6) */
  cheek: number;
  armL: Arm; armR: Arm;
  /** 효과(0~1) */
  fxSweat: number; fxSparkle: number; fxQuestion: number; fxExclaim: number; fxWave: number; fxShake: number; fxLaugh: number;
  /** 소품 — 종류·든 손·글자(팻말)·나타남(0~1)·기울기(도) */
  prop: PropKind; propSide: Side; propText: string; propAmt: number; propTilt: number;
};

/** 표정 묶음(얼굴 그룹 값). */
export type FaceVals = Pick<Pose, 'eyeOpen' | 'wink' | 'happy' | 'big' | 'lid' | 'lookX' | 'lookY' | 'brow' | 'browRaise' | 'browTilt' | 'browAsym' | 'mOpen' | 'mWide' | 'mRound' | 'smile' | 'wavy' | 'tongue' | 'mouthX' | 'cheek'>;
const F0: FaceVals = { eyeOpen: 1, wink: 0, happy: 0, big: 0, lid: 0, lookX: 0, lookY: 0, brow: 0, browRaise: 0, browTilt: 0, browAsym: 0, mOpen: 0, mWide: 0.35, mRound: 0, smile: 0.75, wavy: 0, tongue: 0, mouthX: 0, cheek: 1 };
export const EXPR = {
  neutral: F0,
  calm: { ...F0, smile: 0.6 },
  happy: { ...F0, happy: 1, smile: 1, mOpen: 0.22, mWide: 0.6, cheek: 1.25 },
  grin: { ...F0, smile: 1, mOpen: 0.42, mWide: 1, cheek: 1.25 },
  laugh: { ...F0, happy: 1, smile: 1, mOpen: 0.9, mWide: 1, cheek: 1.5 },
  surprised: { ...F0, big: 1, brow: 1, browRaise: 1, mOpen: 0.55, mRound: 1, mWide: 0.2, smile: 0, cheek: 0.8 },
  worried: { ...F0, brow: 1, browTilt: 1, browRaise: 0.35, smile: -0.25, wavy: 1, mWide: 0.45, lookY: 0.15, cheek: 0.8 },
  angry: { ...F0, brow: 1, browTilt: -1, browRaise: -0.4, smile: -0.55, mWide: 0.45, lid: 0.3, cheek: 0.9 },
  thinking: { ...F0, brow: 1, browAsym: 1, browRaise: 0.2, smile: 0.1, mWide: 0.12, mouthX: 0.55, lookX: 0.55, lookY: -0.65 },
  sleepy: { ...F0, lid: 0.62, smile: 0.35, mWide: 0.25 },
  playful: { ...F0, wink: 1, smile: 0.95, mOpen: 0.18, mWide: 0.5, tongue: 1, cheek: 1.3 },
  sad: { ...F0, brow: 1, browTilt: 0.85, smile: -0.7, lid: 0.25, lookY: 0.55, cheek: 0.7 },
  shy: { ...F0, cheek: 1.65, lookX: -0.75, lookY: 0.45, smile: 0.65, mWide: 0.12, happy: 0.35 },
  focused: { ...F0, brow: 1, browTilt: -0.35, browRaise: -0.15, smile: 0.2, mWide: 0.2 },
} as const satisfies Record<string, FaceVals>;
export type ExprName = keyof typeof EXPR;

export const restArm = (side: Side): Arm => ({ x: side === 'L' ? -160 : 160, y: -100, hand: HANDS.rest, roll: 0, bend: 0, dirW: 0.7, dir: side === 'L' ? 50 : 130 });

export const DEFAULT_POSE: Pose = {
  x: 0, y: 0, lift: 0, size: 1, turn: 0, lean: 0, pitch: 0, squash: 0, walkPhase: 0, walkAmt: 0,
  earL: 0, earR: 0, flap: 0, lagX: 0, lagY: 0,
  ...EXPR.neutral,
  armL: restArm('L'), armR: restArm('R'),
  fxSweat: 0, fxSparkle: 0, fxQuestion: 0, fxExclaim: 0, fxWave: 0, fxShake: 0, fxLaugh: 0,
  prop: 'none', propSide: 'R', propText: '', propAmt: 0, propTilt: 0,
};

// ── 섞기 ─────────────────────────────────────────────

const L = (a: number, b: number, t: number) => a + (b - a) * t;
export const mixHand = (a: HandShape, b: HandShape, t: number): HandShape => ({
  spread: L(a.spread, b.spread, t), c0: L(a.c0, b.c0, t), c1: L(a.c1, b.c1, t), c2: L(a.c2, b.c2, t), thumbAng: L(a.thumbAng, b.thumbAng, t), thumbCurl: L(a.thumbCurl, b.thumbCurl, t),
});
export const mixArm = (a: Arm, b: Arm, t: number): Arm => ({
  x: L(a.x, b.x, t), y: L(a.y, b.y, t), hand: mixHand(a.hand, b.hand, t), roll: L(a.roll, b.roll, t), bend: t < 0.5 ? a.bend : b.bend,
  dirW: L(a.dirW, b.dirW, t), dir: a.dirW <= 0 ? b.dir : b.dirW <= 0 ? a.dir : L(a.dir, b.dir, t),
});

/** 무리(그룹) — 신호 하나가 어떤 무리를 쥐는지. 쥔 무리만 섞는다(손 흔들며 걱정 표정 같은 겹침이 된다). */
export type Group = 'body' | 'face' | 'eyes' | 'mouth' | 'armL' | 'armR' | 'ears' | 'fx' | 'prop';
const KEYS: Record<Exclude<Group, 'armL' | 'armR' | 'prop'>, Array<keyof Pose>> = {
  body: ['x', 'y', 'lift', 'size', 'turn', 'lean', 'pitch', 'squash'],
  face: ['eyeOpen', 'wink', 'happy', 'big', 'lid', 'lookX', 'lookY', 'brow', 'browRaise', 'browTilt', 'browAsym', 'mOpen', 'mWide', 'mRound', 'smile', 'wavy', 'tongue', 'mouthX', 'cheek'],
  eyes: ['lookX', 'lookY'],
  mouth: ['mOpen', 'mWide', 'mRound', 'smile', 'wavy', 'tongue', 'mouthX'],
  ears: ['earL', 'earR', 'flap'],
  fx: ['fxSweat', 'fxSparkle', 'fxQuestion', 'fxExclaim', 'fxWave', 'fxShake', 'fxLaugh'],
};

/** a 를 b 쪽으로 t 만큼(무리 groups 만). b 는 부분 자세. */
export function mixInto(a: Pose, b: Partial<Pose>, t: number, groups: readonly Group[]): Pose {
  if (t <= 0) return a;
  const o: Pose = { ...a };
  const rec = o as unknown as Record<string, number>;
  for (const g of groups) {
    if (g === 'armL' || g === 'armR') { const v = b[g]; if (v) o[g] = mixArm(a[g], v, t); continue; }
    if (g === 'prop') {
      if (b.prop && b.prop !== 'none') {
        // 소품 종류는 섞을 수 없다 — 다른 소품이면 먼저 넣고 새 것으로
        const same = a.prop === b.prop || a.propAmt <= 0.01;
        o.prop = same || t > 0.5 ? b.prop : a.prop;
        o.propSide = same || t > 0.5 ? (b.propSide ?? a.propSide) : a.propSide;
        o.propText = same || t > 0.5 ? (b.propText ?? a.propText) : a.propText;
        o.propAmt = same ? L(a.propAmt, b.propAmt ?? 1, t) : t > 0.5 ? (t - 0.5) * 2 * (b.propAmt ?? 1) : a.propAmt * (1 - t * 2);
        o.propTilt = L(a.propTilt, b.propTilt ?? 0, t);
      }
      continue;
    }
    for (const k of KEYS[g]) {
      const v = (b as Record<string, unknown>)[k];
      if (typeof v === 'number') rec[k] = L((a as unknown as Record<string, number>)[k]!, v, t);
    }
  }
  return o;
}
