/**
 * 진행자 비온이 코드 리그 신호(2026-10-23, LONGFORM_PRESENTER — 기본 꺼짐) — 순수 부분.
 * ① 낱말 목록(동작·표정·params) — 리그(remotion/longform/fullscreen/bionee/timeline.ts)가 이 정의를 다시 내보낸다(루트 tsc rootDir=src 라 정의는 이쪽).
 * ② 장면 파일의 `export const bioneeCues = [...]` 리터럴 읽기(eval 없이, JSON5 비슷하게) + 검사(이상한 신호는 버리고 문제 문장으로 남긴다).
 * ③ 장면이 신호를 안 주면 자동 신호(첫 = 걸어 들어와 손 흔들기, 경고 = 놀람·걱정, 질문 = 생각, 강조 = 그 그림 가리키기, 요령 = 엄지, 끝 = 꾸벅 → 걸어 나감).
 * ④ 편 전체 시간표 — 세그먼트 신호를 전역 초로, 장면 좌표를 화면 좌표로(장면 축소가 1 이면 그대로), 장 제목 카드 동안의 몸짓, 입 열림 이어 붙이기.
 * LongFormFull(번들)이 ④를 부르므로 node 모듈을 import 하지 않는다.
 */
import type { Word } from './sceneRules';
import { wordAt } from './presenter';

export const BIONEE_ACTIONS = ['walkIn', 'walkOut', 'walkTo', 'wave', 'point', 'lookAt', 'nod', 'shake', 'hop', 'think', 'thumbsUp', 'surprised', 'worried', 'laugh', 'holdSign', 'hold', 'turn', 'bow', 'peek', 'face'] as const;
export type BioneeAction = (typeof BIONEE_ACTIONS)[number];
export const BIONEE_EXPRS = ['neutral', 'calm', 'happy', 'grin', 'laugh', 'surprised', 'worried', 'angry', 'thinking', 'sleepy', 'playful', 'sad', 'shy', 'focused'] as const;
export type BioneeExpr = (typeof BIONEE_EXPRS)[number];
export type BioneeProp = 'sign' | 'magnifier' | 'can' | 'stick';
export type BioneeTarget = { x: number; y: number } | 'left' | 'right' | 'up' | 'down' | 'camera';
export type BioneeCueParams = {
  /** 쓰는 손(화면 기준 왼쪽 팔 L / 오른쪽 팔 R) */
  hand?: 'L' | 'R';
  /** 가리킬·볼 곳 — 무대 px 점 또는 방향 */
  target?: BioneeTarget;
  /** turn: 돌아설 방향(-1~1 또는 'left'|'right'|'front') */
  to?: number | 'left' | 'right' | 'front';
  /** walkIn: 들어오는 쪽 · walkOut: 나가는 쪽 */
  from?: 'left' | 'right';
  /** walkIn/walkTo: 멈출 x(무대 px) */
  x?: number;
  /** holdSign: 팻말 글자(6자 이내) */
  text?: string;
  /** hold: 소품 */
  prop?: BioneeProp;
  /** 표정 덮어쓰기 */
  expr?: BioneeExpr;
  /** peek: 내다보는 화면 가장자리 · walkOut: 나가는 쪽 */
  side?: 'left' | 'right' | 'bottom';
  /** nod/shake/hop: 횟수 */
  times?: number;
  /** 세기(0.3~1.5, 기본 1) */
  strength?: number;
  /** 섞는 프레임(4~8, 기본 6) */
  blend?: number;
};
/** 신호 — at·dur 는 초(장면 파일에선 세그먼트 시작 기준, 편 시간표에선 편 시작 기준). */
export type BioneeCue = { at: number; dur?: number; action: BioneeAction; params?: BioneeCueParams };

export const BIONEE_DEFAULT_DUR: Record<BioneeAction, number> = {
  walkIn: 2.0, walkOut: 1.8, walkTo: 1.5, wave: 1.6, point: 2.0, lookAt: 1.5, nod: 0.9, shake: 1.0, hop: 0.7, think: 2.0, thumbsUp: 1.4,
  surprised: 1.2, worried: 1.6, laugh: 1.4, holdSign: 2.5, hold: 2.0, turn: 0.5, bow: 1.2, peek: 2.5, face: 1.5,
};

/** 한 문장에 신호 몇 개까지. */
export const MAX_CUES_PER_SEGMENT = 3;
/** 팻말 글자 수 상한(공백 포함 — 리그가 6자에서 자른다). */
export const SIGN_MAX = 6;

// ── ② 리터럴 읽기 ─────────────────────────────────────

type Lit = string | number | boolean | null | Lit[] | { [k: string]: Lit };

/** JSON5 비슷한 리터럴 하나(작은따옴표·따옴표 없는 키·끝 쉼표·주석 허용). 식·변수·계산은 던진다. */
function parseLiteralAt(src: string, start: number): { value: Lit; end: number } {
  let i = start;
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      return;
    }
  };
  const fail = (why: string): never => { throw new Error(`${why} (${i}번째 글자: ${JSON.stringify(src.slice(i, i + 16))})`); };
  const str = (): string => {
    const q = src[i]!;
    i++;
    let out = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\n') fail('따옴표가 닫히지 않음');
      if (src[i] === '\\') { const c = src[i + 1] ?? ''; out += c === 'n' ? '\n' : c; i += 2; continue; }
      out += src[i]; i++;
    }
    if (src[i] !== q) fail('따옴표가 닫히지 않음');
    i++;
    return out;
  };
  const value = (): Lit => {
    ws();
    const c = src[i];
    if (c === '[') {
      i++;
      const arr: Lit[] = [];
      for (;;) {
        ws();
        if (src[i] === ']') { i++; return arr; }
        arr.push(value());
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ']') { i++; return arr; }
        fail('배열에 쉼표나 ] 가 와야 함');
      }
    }
    if (c === '{') {
      i++;
      const obj: Record<string, Lit> = {};
      for (;;) {
        ws();
        if (src[i] === '}') { i++; return obj; }
        let key: string;
        if (src[i] === '"' || src[i] === "'") key = str();
        else { const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i)); if (!m) fail('키 이름이 와야 함'); key = m![0]; i += key.length; }
        ws();
        if (src[i] !== ':') fail(`'${key}' 뒤에 : 가 와야 함`);
        i++;
        obj[key] = value();
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === '}') { i++; return obj; }
        fail('객체에 쉼표나 } 가 와야 함');
      }
    }
    if (c === '"' || c === "'") return str();
    const num = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      const after = src.slice(i).trimStart()[0];
      if (after && /[-+*/%]/.test(after)) fail('계산식은 안 됨 — 숫자 그대로');
      return Number(num[0]);
    }
    for (const [w, v] of [['true', true], ['false', false], ['null', null]] as const) {
      if (src.startsWith(w, i) && !/[\w$]/.test(src[i + w.length] ?? '')) { i += w.length; return v; }
    }
    return fail('리터럴만 쓸 수 있음(변수·함수·계산식 금지)');
  };
  const v = value();
  return { value: v, end: i };
}

/** 장면 파일 안 `export const bioneeCues = [...]` 자리(글자 범위, '[' ~ ']' 다음). 못 읽으면 error. */
export function bioneeCuesSpan(src: string): { start: number; end: number; value?: Lit; error?: string } | undefined {
  const m = /export\s+const\s+bioneeCues\s*(?::\s*[\w.$<>[\]\s|]+?)?\s*=\s*(?=\[)/.exec(src);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  try {
    const { value, end } = parseLiteralAt(src, start);
    return { start, end, value };
  } catch (e) {
    return { start, end: start, error: e instanceof Error ? e.message : String(e) };
  }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const cl = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const tokens = (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** 신호 하나 검사(순수) — 고친 신호 또는 버린 까닭. segSec 가 있으면 at·dur 를 세그먼트 안으로, narration 이 있으면 팻말 낱말이 문장에 있는지. */
export function validateCue(raw: unknown, ctx: { segSec?: number; narration?: string } = {}): { cue?: BioneeCue; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problems: ['신호는 { at, action, … } 객체'] };
  const r = raw as Record<string, unknown>;
  if (!oneOf(r.action, BIONEE_ACTIONS)) return { problems: [`없는 동작: ${JSON.stringify(r.action)} — ${BIONEE_ACTIONS.join('·')} 중 하나`] };
  const action = r.action;
  if (!num(r.at) || r.at < 0) return { problems: [`${action}: at(초)이 0 이상 숫자가 아님`] };
  let at = r.at;
  let dur = num(r.dur) && r.dur > 0 ? r.dur : undefined;
  if (r.dur != null && dur == null) problems.push(`${action}: dur 가 양수가 아님 — 기본 길이로`);
  const p = (r.params ?? {}) as Record<string, unknown>;
  if (r.params != null && (typeof r.params !== 'object' || Array.isArray(r.params))) return { problems: [`${action}: params 는 객체`] };
  const out: BioneeCueParams = {};
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case 'hand': if (oneOf(v, ['L', 'R'] as const)) out.hand = v; else problems.push(`${action}: hand 는 'L'·'R'`); break;
      case 'target':
        if (oneOf(v, ['left', 'right', 'up', 'down', 'camera'] as const)) out.target = v;
        else if (v && typeof v === 'object' && !Array.isArray(v) && num((v as Record<string, unknown>).x) && num((v as Record<string, unknown>).y)) {
          const t = v as { x: number; y: number };
          out.target = { x: cl(t.x, 0, 1920), y: cl(t.y, 0, 1080) };
        } else problems.push(`${action}: target 은 { x, y } 또는 'left'·'right'·'up'·'down'·'camera'`);
        break;
      case 'to': if (num(v)) out.to = cl(v, -1, 1); else if (oneOf(v, ['left', 'right', 'front'] as const)) out.to = v; else problems.push(`${action}: to 는 -1~1 또는 'left'·'right'·'front'`); break;
      case 'from': if (oneOf(v, ['left', 'right'] as const)) out.from = v; else problems.push(`${action}: from 은 'left'·'right'`); break;
      case 'x': if (num(v)) out.x = cl(v, 0, 1920); else problems.push(`${action}: x 는 숫자`); break;
      case 'text': if (typeof v === 'string') out.text = v.trim(); else problems.push(`${action}: text 는 글자`); break;
      case 'prop': if (oneOf(v, ['magnifier', 'can', 'stick'] as const)) out.prop = v; else problems.push(`${action}: prop 은 'magnifier'·'can'·'stick'`); break;
      case 'expr': if (oneOf(v, BIONEE_EXPRS)) out.expr = v; else problems.push(`${action}: 없는 표정 ${JSON.stringify(v)}`); break;
      case 'side': if (oneOf(v, ['left', 'right', 'bottom'] as const)) out.side = v; else problems.push(`${action}: side 는 'left'·'right'·'bottom'`); break;
      case 'times': if (num(v)) out.times = Math.round(cl(v, 1, 4)); else problems.push(`${action}: times 는 숫자`); break;
      case 'strength': if (num(v)) out.strength = cl(v, 0.3, 1.5); else problems.push(`${action}: strength 는 숫자`); break;
      case 'blend': if (num(v)) out.blend = cl(v, 4, 8); else problems.push(`${action}: blend 는 숫자`); break;
      default: problems.push(`${action}: 모르는 params '${k}' — 뺌`);
    }
  }
  if (action === 'holdSign') {
    const t = out.text ?? '';
    if (!t) return { problems: [...problems, 'holdSign: text(팻말 글자)가 없음'] };
    if ([...t].length > SIGN_MAX) return { problems: [...problems, `holdSign: 팻말 "${t}" ${[...t].length}자 — ${SIGN_MAX}자 이내`] };
    if (ctx.narration != null) {
      const sent = ctx.narration.replace(/\s+/g, '');
      const miss = tokens(t).filter((w) => !sent.includes(w));
      if (miss.length) return { problems: [...problems, `holdSign: 팻말 "${t}" 의 ${miss.map((w) => `'${w}'`).join(', ')} 이(가) 문장에 없음 — 이 문장에 나온 말만`] };
    }
  }
  if (ctx.segSec != null) {
    const S = Math.max(0.3, ctx.segSec);
    if (at > S - 0.2) { problems.push(`${action}: at ${at}초가 문장 길이(${S.toFixed(1)}초) 밖 — 안으로 당김`); at = Math.max(0, S - 0.6); }
    const d = dur ?? BIONEE_DEFAULT_DUR[action];
    if (at + d > S) dur = Math.max(0.3, S - at);
  }
  const cue: BioneeCue = { at: Math.round(at * 100) / 100, ...(dur != null ? { dur: Math.round(dur * 100) / 100 } : {}), action, ...(Object.keys(out).length ? { params: out } : {}) };
  return { cue, problems };
}

/**
 * 장면 파일의 비온이 신호(순수). found = 내보냈나(빈 배열이면 '이 문장은 가만히' — 자동 신호로 채우지 않는다).
 * 못 읽으면 found 는 true 지만 cues 는 undefined(렌더는 자동 신호로), problems 에 까닭.
 */
export function sceneBioneeCues(src: string, ctx: { segSec?: number; narration?: string } = {}): { found: boolean; cues?: BioneeCue[]; problems: string[] } {
  const span = bioneeCuesSpan(src);
  if (!span) return { found: false, problems: [] };
  if (span.error) return { found: true, problems: [`bioneeCues 를 읽을 수 없음: ${span.error} — 객체 리터럴만(계산식·변수 금지)`] };
  if (!Array.isArray(span.value)) return { found: true, problems: ['bioneeCues 는 배열'] };
  const problems: string[] = [];
  const cues: BioneeCue[] = [];
  for (const raw of span.value) {
    const r = validateCue(raw, ctx);
    problems.push(...r.problems);
    if (r.cue) cues.push(r.cue);
  }
  cues.sort((a, b) => a.at - b.at);
  if (cues.length > MAX_CUES_PER_SEGMENT) problems.push(`비온이 신호 ${cues.length}개 — 한 문장에 ${MAX_CUES_PER_SEGMENT}개까지(앞의 ${MAX_CUES_PER_SEGMENT}개만 씀)`);
  return { found: true, cues: cues.slice(0, MAX_CUES_PER_SEGMENT), problems };
}

/** 검사·글자 세기용 — 장면 소스에서 bioneeCues 리터럴을 빈 배열로(팻말 글자가 장면 라벨로 세어지지 않게). */
export function stripBioneeCues(src: string): string {
  const s = bioneeCuesSpan(src);
  return s && !s.error ? `${src.slice(0, s.start)}[]${src.slice(s.end)}` : src;
}

// ── ③ 자동 신호 ───────────────────────────────────────

const WARN_RX = /안\s?됩니다|안\s?돼|금지|주의|위험|죽|망가|썩/;
const WORRY_RX = /죽|위험|망가|썩/;
const ASK_RX = /\?|왜|일까|을까|ㄹ까|까요/;
const TIP_RX = /요령|정리|기억|확인|좋습니다|됩니다/;

export type AutoCueInput = {
  narration: string; words: readonly Word[]; speechSec: number; segSec: number;
  /** 장면 강조 박자(sceneAccent) — x·y 는 장면 무대 좌표 */
  accent?: { word: string; x?: number; y?: number };
};

/** 편 전체 자동 신호(순수) — segs 순서 = 편 순서, 결과 = 세그먼트마다 신호 목록(장면 좌표, 세그먼트 초). 바로 앞과 같은 동작은 다음 후보로. */
export function autoBioneeCues(segs: readonly AutoCueInput[]): BioneeCue[][] {
  let prev: BioneeAction | undefined;
  return segs.map((s, i) => {
    const S = s.segSec;
    const fit = (c: BioneeCue): BioneeCue => {
      const at = cl(c.at, 0, Math.max(0, S - 0.5));
      const d = Math.min(c.dur ?? BIONEE_DEFAULT_DUR[c.action], Math.max(0.4, S - at));
      return { ...c, at: Math.round(at * 100) / 100, dur: Math.round(d * 100) / 100 };
    };
    let out: BioneeCue[];
    if (i === 0) {
      out = [{ at: 0, dur: 1.6, action: 'walkIn' }, { at: 1.7, dur: 1.5, action: 'wave' }];
      if (segs.length === 1) out.push({ at: Math.max(3.3, S - 1.4), dur: 1.2, action: 'bow' });
    } else if (i === segs.length - 1) {
      const bowAt = Math.max(0, S - 3.2);
      out = [{ at: bowAt, dur: 1.2, action: 'bow' }, { at: Math.max(bowAt + 1.3, S - 1.9), dur: 1.8, action: 'walkOut', params: { side: 'left' } }];
    } else {
      const cands: BioneeCue[] = [];
      const warnAt = wordAt(s.words, WARN_RX);
      if (warnAt != null) cands.push({ at: warnAt, dur: 1.5, action: WORRY_RX.test(s.narration) ? 'worried' : 'surprised' });
      if (ASK_RX.test(s.narration)) cands.push({ at: Math.max(0, Math.min(s.speechSec - 2.0, s.speechSec * 0.5)), dur: 2.0, action: 'think' });
      if (s.accent) {
        const at = s.words.find((w) => w.w.includes(s.accent!.word))?.start;
        if (at != null) cands.push({ at, dur: 2.0, action: 'point', params: { target: s.accent.x != null && s.accent.y != null ? { x: s.accent.x, y: s.accent.y } : 'right' } });
      }
      const tipAt = wordAt(s.words, TIP_RX);
      if (tipAt != null) cands.push({ at: tipAt, dur: 1.4, action: 'thumbsUp' });
      const pick = cands.find((c) => c.action !== prev);
      out = pick ? [pick] : [];
    }
    const res = out.map(fit);
    prev = res.length ? res[res.length - 1]!.action : undefined; // 가만히 한 문장을 사이에 두면 같은 몸짓도 괜찮다
    return res;
  });
}

// ── ④ 편 전체 시간표 ──────────────────────────────────

const FPS = 30;
/** 무대 크기·자막 띠 위 끝 — sceneFull.FULL_W·CAPTION_TOP 과 같다(이 파일은 번들에 들어가 sceneFull 을 import 하지 않는다). */
export const STAGE_W = 1920;
export const STAGE_CAPTION_TOP = 886;
/**
 * 비온이 기본 크기(1 = 리그 키 약 547px) — 0.6 = 키 ≈ 328px(화면 높이 30%). 2026-10-23 크기 비교(22·28·30·34%, 휴대폰 640×360 축소본까지)에서 고름:
 * 22% 는 휴대폰에서 얼굴·팻말이 안 읽히고, 34% 는 주 그림과 다툰다. 30% = 팻말 글자 휴대폰 약 12px·얼굴 읽힘.
 * (그때는 장면을 0.84 로 줄였지만 사장님 지적으로 장면은 화면 전체 + 비온이는 덮개 층으로 바꿈 — PRESENTER_SCENE_SCALE 1.)
 */
export const BIONEE_SCALE = 0.6;
/** 비온이 반폭(리그 로컬 px — 잎·손 끝까지). */
const HALF_LOCAL = 245;
/** 비온이가 서는 왼쪽 아래 자리(장면 무대 px — 장면은 여기에 주인공·라벨·끼움 카드를 두지 않는다. 배경·땅은 이어 그린다). */
export const BIONEE_ZONE = { x1: 420, y0: 560 } as const;
/** 비온이 자리(화면 px) — 발 닿는 점(자막 띠 위 12px), 왼쪽 끝에서 반폭만큼. 걷기 x 범위 = 집 ~ 비운 자리 오른쪽 끝(반폭 빼고). */
export function bioneePlace(scale: number, sceneScale: number): { home: { x: number; y: number }; walk: { min: number; max: number } } {
  const hx = Math.round(40 + HALF_LOCAL * scale);
  const zoneRight = sceneToScreen({ x: BIONEE_ZONE.x1, y: 0 }, sceneScale).x;
  return { home: { x: hx, y: STAGE_CAPTION_TOP - 12 }, walk: { min: hx - 20, max: Math.max(hx, Math.round(zoneRight - HALF_LOCAL * scale * 0.7)) } };
}
/** 장 제목 카드 동안 바라볼 곳(제목 가운데). */
const TITLE_AT = { x: 960, y: 500 } as const;

/** 장면 좌표 → 화면 좌표 — LongFormFull 이 장면 층을 (W, CAPTION_TOP) 기준 sceneScale 로 줄인 것과 같은 변환. */
export const sceneToScreen = (p: { x: number; y: number }, sceneScale: number): { x: number; y: number } => ({
  x: Math.round(STAGE_W + (p.x - STAGE_W) * sceneScale), y: Math.round(STAGE_CAPTION_TOP + (p.y - STAGE_CAPTION_TOP) * sceneScale),
});

export type BioneeSegIn = { startFrame: number; frames: number; bionee?: readonly BioneeCue[]; mouth?: readonly number[] };
export type BioneeHost = { cues: BioneeCue[]; mouth: number[]; home: { x: number; y: number }; scale: number };

/**
 * 편 전체 비온이 시간표(순수) — 세그먼트 신호(장면 좌표·세그먼트 초) → 전역 신호(화면 좌표·편 초) + 전역 입 열림(장 카드 프레임은 0).
 * 규칙: 걸어 들어오기는 첫 세그먼트에만(첫 장 제목 카드 동안 미리 들어와 말 시작 때 서 있다), 걸어 나가기는 마지막 세그먼트에만,
 * 빼꼼(peek)은 그림 위를 지나가니 빼고, 걷기 x 는 왼쪽 아래 빈 자리 안으로. 장 제목 카드 동안엔 제목을 바라보고 깡충(제목은 가리지 않는다).
 */
export function bioneeTimeline(segs: readonly BioneeSegIn[], chapters: ReadonlyArray<{ startFrame: number; frames: number }>, totalFrames: number, o: { sceneScale: number; scale?: number }): BioneeHost {
  const sc = o.sceneScale;
  const scale = o.scale ?? BIONEE_SCALE;
  const place = bioneePlace(scale, sc);
  const walkX = (x: number) => cl(sceneToScreen({ x, y: 0 }, sc).x, place.walk.min, place.walk.max);
  const cues: BioneeCue[] = [];
  const firstCard = chapters.find((c) => c.startFrame === 0 && c.frames > 0);
  segs.forEach((s, i) => {
    const off = s.startFrame / FPS;
    const segSec = s.frames / FPS;
    for (const c of s.bionee ?? []) {
      if (c.action === 'peek') continue;
      if (c.action === 'walkIn' && i !== 0) continue;
      if (c.action === 'walkOut' && i !== segs.length - 1) continue;
      const p: BioneeCueParams = { ...(c.params ?? {}) };
      if (p.target && typeof p.target === 'object') p.target = sceneToScreen(p.target, sc);
      if (p.x != null) p.x = walkX(p.x);
      if (c.action === 'walkIn') p.from = 'left';
      if (c.action === 'walkOut') { p.side = 'left'; delete p.from; }
      let at = off + cl(c.at, 0, segSec);
      let dur = Math.min(c.dur ?? BIONEE_DEFAULT_DUR[c.action], Math.max(0.3, off + segSec - at));
      // 첫 등장 — 첫 장 제목 카드가 있으면 그 카드 동안 들어와 말 시작 때 서 있게
      if (c.action === 'walkIn' && firstCard && c.at < 1) { at = firstCard.startFrame / FPS + 0.3; dur = Math.min(dur, Math.max(1.2, firstCard.frames / FPS - 0.5)); }
      if (c.action === 'walkOut') {
        // 걸어 나가기는 편이 끝나기 전에 다 나가게(2026-10-23 — 끝에서 잘리면 나가다 만 것처럼 보인다)
        dur = c.dur ?? BIONEE_DEFAULT_DUR.walkOut;
        at = Math.max(off, Math.min(at, off + segSec - dur - EXIT_PAD));
      }
      cues.push({ at: round2(at), dur: round2(dur), action: c.action, ...(Object.keys(p).length ? { params: p } : {}) });
    }
  });
  // 등장·퇴장이 빠졌으면 채운다 — 첫 등장은 걸어 들어오기(첫 장 카드 동안), 편 끝은 걸어 나가기(마지막 신호 뒤)
  if (segs.length && !cues.some((c) => c.action === 'walkIn')) {
    const a = firstCard ? firstCard.startFrame / FPS + 0.3 : segs[0]!.startFrame / FPS;
    cues.push({ at: round2(a), dur: round2(firstCard ? Math.min(2.0, Math.max(1.2, firstCard.frames / FPS - 0.5)) : 1.6), action: 'walkIn', params: { from: 'left' } });
  }
  const last = segs[segs.length - 1];
  if (last && !cues.some((c) => c.action === 'walkOut')) {
    const end = (last.startFrame + last.frames) / FPS;
    const lastEnd = Math.max(last.startFrame / FPS, ...cues.map((c) => c.at + (c.dur ?? BIONEE_DEFAULT_DUR[c.action])));
    // 편 끝 전에 다 나가게 — 마지막 신호와 겹쳐도 몸짓(얼굴·팔)은 걸으며 이어진다
    const d = BIONEE_DEFAULT_DUR.walkOut;
    cues.push({ at: round2(Math.max(last.startFrame / FPS, Math.min(lastEnd + 0.1, end - d - EXIT_PAD))), dur: d, action: 'walkOut', params: { side: 'left' } });
  }
  // 장 제목 카드 — 제목을 바라보고(몸·눈) 반가워 깡충. 첫 카드에서 걸어 들어오는 중이면 깡충은 걷기 뒤.
  for (const ch of chapters) {
    if (ch.frames <= 0) continue;
    const a = ch.startFrame / FPS, d = ch.frames / FPS;
    const walking = cues.find((c) => c.action === 'walkIn' && c.at >= a - 0.01 && c.at < a + d);
    const t0 = walking ? walking.at + (walking.dur ?? BIONEE_DEFAULT_DUR.walkIn) : a + 0.25;
    if (t0 + 0.5 > a + d) continue;
    cues.push({ at: round2(t0), dur: round2(Math.max(0.5, a + d - t0 - 0.15)), action: 'lookAt', params: { target: { ...TITLE_AT } } });
    if (t0 + 0.9 <= a + d) cues.push({ at: round2(t0 + 0.15), dur: 0.7, action: 'hop' });
  }
  cues.sort((x, y) => x.at - y.at);
  const mouth = new Array<number>(Math.max(0, totalFrames)).fill(0);
  for (const s of segs) {
    const m = s.mouth ?? [];
    for (let k = 0; k < Math.min(m.length, s.frames); k++) {
      const f = s.startFrame + k;
      if (f >= 0 && f < mouth.length) mouth[f] = m[k]!;
    }
  }
  return { cues, mouth, home: place.home, scale };
}
const round2 = (x: number) => Math.round(x * 100) / 100;
/** 걸어 나가기를 편 끝보다 이만큼(초) 먼저 끝낸다. */
const EXIT_PAD = 0.15;
