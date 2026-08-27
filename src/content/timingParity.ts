/**
 * 파생 콘텐츠 시기·수치 원문 대조(2026-08-27 말투 감사 권고 1) — 결정적(LLM 없음).
 *
 * 실사고(활엽수 편): 블로그는 "적기는 보통 봄… 가을이 낫다고 말할 근거는 확실치 않습니다"인데,
 * 같은 소재 쇼츠가 내레이션("지금이 심기 좋은 때")·자막("낙엽나무는 지금 적기")·화면 수치
 * 오버레이("8월 · 낙엽수 식재 시작") 세 군데에서 8월을 적기로 단정했다. 세 채널을 다 보는 단골에게
 * 가장 먼저 들키는 어긋남이고, 사실 기반 원칙(2026-08-26 사용자 확정)에 직결된다.
 *
 * 성격: LLM 정합 검사(standaloneQa.parityIssues)와 **별개 축**이다. LLM 쪽은 프롬프트에서 반올림·
 * 범위 의역을 명시적으로 인정하지만, 여기는 "원문에 없는 시기·수치는 파생물에 새로 못 만든다"만 본다.
 * 그래서 이쪽이 더 엄격하고, 그만큼 fail-open·비차단(발행을 막지 않는다)으로만 쓴다 —
 * 검출은 기존 정합 수정 라운드에 문자열로 합류하고, 잔존은 텔레그램 표시로 끝난다.
 * 예외적으로 쇼츠 stat 오버레이만 결정적으로 제거한다(화면에 큼직하게 박히는 숫자라 수정 라운드를 못 믿는다).
 *
 * 킬스위치: TIMING_PARITY=off — 검출과 오버레이 제거를 함께 끈다.
 */
import { CONFIG } from '../config';
import type { SceneKindFields } from '../tools/shortsCommon';

export interface TimingIssue { field: string; token: string; text: string }

/** 고유어 월 → 숫자월. 긴 것부터 대조해야 '십이월'이 '이월'로 잘리지 않는다. */
const NATIVE_MONTHS: ReadonlyArray<readonly [string, number]> = [
  ['십이월', 12], ['십일월', 11], ['시월', 10], ['십월', 10], ['정월', 1], ['일월', 1],
  ['이월', 2], ['삼월', 3], ['사월', 4], ['오월', 5], ['유월', 6], ['육월', 6],
  ['칠월', 7], ['팔월', 8], ['구월', 9],
];
const NATIVE_MONTH_RE = new RegExp(NATIVE_MONTHS.map(([w]) => w).join('|'), 'g');

/** 24절기 — 계절+시점("늦가을")은 너무 일반이라 제외하고, 이름이 특정된 절기만 본다. */
const SOLAR_TERMS = [
  '입춘', '우수', '경칩', '춘분', '청명', '곡우', '입하', '소만', '망종', '하지', '소서', '대서',
  '입추', '처서', '백로', '추분', '한로', '상강', '입동', '소설', '대설', '동지', '소한', '대한',
] as const;
/**
 * 앞이 한글이면 낱말 조각(필요"하지" 않다)이라 제외하고, 뒤는 조사·시간 명사만 허용한다
 * ("하지만"의 만, "대한민국"의 민은 조사가 아니므로 차단). 그래도 남는 두 상용구는 아래에서 따로 막는다.
 */
const PARTICLE_TAIL = '가이는은를을에의도부까와과랑로으께경무전후쯤';
const SOLAR_RE = new RegExp(
  `(?<![가-힣])(${SOLAR_TERMS.join('|')})(?=[^가-힣]|[${PARTICLE_TAIL}]|$)`, 'g',
);
/** 절기 형태와 겹치는 상용구 — 정규식 경계만으로 못 막는 두 건(실제 원예 문장에서 흔하다). */
function solarTermIsFalsePositive(term: string, before: string, after: string): boolean {
  if (term === '하지' && /^\s*(?:마|말|않|못|맙)/.test(after)) return true; // "하지 마세요"·"하지 않습니다"
  if (term === '대한' && /에\s*$/.test(before)) return true;               // "묘목에 대한"
  return false;
}

/** 숫자+단위 — 긴 단위를 먼저 둬야 '2주일'이 '2주'로, '50ml'이 '50m'로 잘리지 않는다. */
const UNITS = ['주일', '개월', '리터', 'cm', 'kg', 'ml', 'm', 'g', '일', '주', '년', '회', '번', '배', '도', '℃', '원', '%'] as const;
const UNIT_ALT = UNITS.join('|');
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const UNIT_RE = new RegExp(`(${NUM})\\s*(${UNIT_ALT})`, 'g');
/** 범위 표기("20~30cm") — 원문에만 적용해 그 사이 값을 통과시킨다. */
const RANGE_RE = new RegExp(`(${NUM})\\s*[~\\-–—−]\\s*(${NUM})\\s*(${UNIT_ALT})`, 'g');
const MONTH_RE = /(\d{1,2})\s*월/g;
const MONTH_RANGE_RE = /(\d{1,2})\s*[~\-–—−]\s*(\d{1,2})\s*월/g;
/** 시각 — '3시간'은 기간이지 시각이 아니라서 뺀다. */
const CLOCK_RE = /(\d{1,2})\s*시(?![간])/g;

const num = (s: string): number => Number(s.replace(/,/g, ''));
/** 표시용 숫자 정규화 — 천 단위 쉼표만 흡수한다(1,200원 ↔ 1200원 이 같은 수치로 읽히게). */
const normNum = (s: string): string => s.replace(/,/g, '');
const normUnit = (u: string): string => (u === '℃' ? '도' : u);

/**
 * 시기·수치 토큰 결정적 추출(순수). 정규화: 공백 제거, ℃→도, 고유어 월→숫자월, 천 단위 쉼표 제거.
 * 중복은 접어 첫 등장 순서로 돌려준다.
 */
export function extractTimingNumbers(text: string): string[] {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  // 고유어 월을 먼저 숫자월로 바꿔 두면 아래 월 정규식 하나로 둘 다 잡힌다.
  const t = s.replace(NATIVE_MONTH_RE, (w) => `${NATIVE_MONTHS.find(([k]) => k === w)![1]}월`);
  const out: string[] = [];
  const push = (tok: string): void => { if (tok && !out.includes(tok)) out.push(tok); };

  for (const m of t.matchAll(MONTH_RE)) push(`${num(m[1]!)}월`);
  for (const m of t.matchAll(CLOCK_RE)) push(`${num(m[1]!)}시`);
  for (const m of t.matchAll(UNIT_RE)) push(`${normNum(m[1]!)}${normUnit(m[2]!)}`);
  for (const m of t.matchAll(SOLAR_RE)) {
    const term = m[1]!;
    const at = m.index ?? 0;
    if (solarTermIsFalsePositive(term, t.slice(0, at), t.slice(at + term.length))) continue;
    push(term);
  }
  return out;
}

interface SourceIndex {
  tokens: Set<string>;
  months: Set<number>;
  /** 단위별 범위 — 원문 "20~30cm" 안의 값은 통과시킨다(반올림은 통과시키지 않는다). */
  ranges: Array<{ unit: string; lo: number; hi: number }>;
}

function indexSource(sourceBody: string): SourceIndex {
  const s = String(sourceBody ?? '');
  const tokens = new Set(extractTimingNumbers(s));
  const months = new Set<number>();
  for (const tok of tokens) { const m = /^(\d+)월$/.exec(tok); if (m) months.add(Number(m[1])); }
  const t = s.replace(NATIVE_MONTH_RE, (w) => `${NATIVE_MONTHS.find(([k]) => k === w)![1]}월`);
  for (const m of t.matchAll(MONTH_RANGE_RE)) {
    const lo = num(m[1]!); const hi = num(m[2]!);
    for (let i = Math.min(lo, hi); i <= Math.max(lo, hi); i++) months.add(i);
  }
  const ranges: SourceIndex['ranges'] = [];
  for (const m of t.matchAll(RANGE_RE)) {
    const lo = num(m[1]!); const hi = num(m[2]!);
    ranges.push({ unit: normUnit(m[3]!), lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
  }
  return { tokens, months, ranges };
}

const UNIT_TOKEN_RE = new RegExp(`^(${NUM})(${UNIT_ALT})$`);

function tokenInSource(token: string, idx: SourceIndex): boolean {
  if (idx.tokens.has(token)) return true;
  const mo = /^(\d+)월$/.exec(token);
  if (mo) return idx.months.has(Number(mo[1])); // 9월 ↔ "9월 중순" — 같은 월이면 통과
  const un = UNIT_TOKEN_RE.exec(token);
  if (un) {
    const v = num(un[1]!); const u = un[2]!;
    return idx.ranges.some((r) => r.unit === u && v >= r.lo && v <= r.hi);
  }
  return false;
}

/**
 * 파생 텍스트에만 있는 시기·수치를 보고한다(순수, 원문이 비면 검사 안 함 — 파생물이 아니라는 뜻).
 * 같은 field 안의 같은 토큰은 한 번만 보고한다.
 */
export function timingParityIssues(
  sourceBody: string, derived: Array<{ field: string; text: string }>,
): TimingIssue[] {
  if (!CONFIG.timingParity) return [];
  const src = String(sourceBody ?? '');
  if (!src.trim() || !derived?.length) return [];
  // 원문에 시기·수치가 하나도 없어도 검사한다 — 그때야말로 파생물이 없는 시기를 새로 만든 사고다(활엽수 편).
  const idx = indexSource(src);
  const out: TimingIssue[] = [];
  const seen = new Set<string>();
  for (const d of derived) {
    const text = String(d?.text ?? '');
    if (!text.trim()) continue;
    for (const token of extractTimingNumbers(text)) {
      if (tokenInSource(token, idx)) continue;
      const key = `${d.field}||${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ field: d.field, token, text });
    }
  }
  return out;
}

/** 수정 라운드 입력 한 줄(기존 정합 지적과 같은 자리에 섞인다). 텍스트는 60자에서 자른다(프롬프트 비대 방지). */
export function formatTimingIssue(i: TimingIssue): string {
  const t = i.text.length > 60 ? `${i.text.slice(0, 60)}…` : i.text;
  return `시기·수치 원문 불일치 — ${i.field}: "${t}" (원문에 없는 ${i.token})`;
}

/**
 * 쇼츠 stat 오버레이 결정적 제거 — 값이 원문에 없으면 오버레이 자체를 뗀다(kind·stat 삭제 = normalizeSceneKind
 * 의 `{}` 강등과 같은 표현). 화면에 큼직하게 박히는 숫자라 수정 라운드(LLM)에 맡기지 않는다.
 * 단위 없는 값(단계 수·항목 수처럼 대본 구조상 자명한 숫자)은 대조할 수 없으므로 건드리지 않는다.
 * 반드시 수정 라운드 **뒤**에 부를 것 — 앞에서 떼면 작가가 같은 값을 다시 실어 보낼 수 있다.
 */
export function stripUnsourcedStatOverlays<T extends SceneKindFields>(
  scenes: T[], sourceBody: string,
): { scenes: T[]; removed: string[] } {
  const list = scenes ?? [];
  if (!CONFIG.timingParity || !String(sourceBody ?? '').trim()) return { scenes: list, removed: [] };
  const idx = indexSource(sourceBody);
  const removed: string[] = [];
  const next = list.map((sc) => {
    if (sc?.kind !== 'stat' || !sc.stat) return sc;
    const composed = `${sc.stat.value}${sc.stat.unit ?? ''}`;
    const tokens = extractTimingNumbers(composed);
    if (!tokens.length) return sc;                       // 단위 없는 자명한 숫자 — 대조 불가
    if (tokens.every((t) => tokenInSource(t, idx))) return sc;
    removed.push(tokens.find((t) => !tokenInSource(t, idx))!);
    const { kind: _kind, stat: _stat, ...rest } = sc;
    return rest as unknown as T;
  });
  return { scenes: next, removed };
}
