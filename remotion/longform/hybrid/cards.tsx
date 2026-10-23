// 혼합(H) 롱폼 정보 카드 부품(2026-10-23, 옵트인 견본) — 숏폼 모션그래픽 정보 카드("유리 + 알약", motion-*/info-card-ref.html)를
// 가로 1920×1080 용 Remotion 컴포넌트로 옮겼다. 흐린 유리 카드 + 흰 알약 줄 + 번호 원 + ✕ 흰 알약 / ✓ 포인트 색 알약 + 그려지는 화살표 + 숫자 강조.
// 움직임은 숏폼과 같은 결: 카드가 아래에서 떠오르고(.55s), 머리글이 튀어나오고, 줄이 차례로 미끄러져 들어오고, 낭독이 짚는 줄로 강조가 옮겨 간다.
// 모든 시각(at·hiAt·until)은 장면 안 프레임. 글자는 전부 props 로 받는다 — 그 문장에 나온 말만(검사가 잰다).
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { clamp } from '../fullscreen/stage';
import { FONT_CARD, HY, useProbe } from './HybridStage';

// ── 시간 도우미 ───────────────────────────────────────────────
const OUT = Easing.bezier(0.2, 0.9, 0.3, 1);
const POP = Easing.bezier(0.2, 1.45, 0.45, 1);
/** at 부터 dur 프레임 동안 0 → 1(숏폼 카드 등장 곡선). */
export const enter = (f: number, at: number, dur = 16): number => interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: OUT });
/** 튀어나오기 0 → 1(살짝 넘침). */
export const popIn = (f: number, at: number, dur = 14): number => interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: POP });
/** until 에서 dur 프레임 동안 1 → 0(없으면 1). */
const leave = (f: number, until?: number, dur = 10): number => (until == null ? 1 : interpolate(f, [until, until + dur], [1, 0], { ...clamp, easing: Easing.in(Easing.cubic) }));
/** 강조 세기 0~1 — on 에 켜지고 off 에 꺼진다(5프레임 섞기). */
const glow = (f: number, on?: number, off?: number): number => (on == null ? 0 : interpolate(f, [on, on + 5], [0, 1], clamp) * (off == null ? 1 : interpolate(f, [off, off + 6], [1, 0], clamp)));
/** 지금 강조할 줄 — hiAt[i] 이 지난 마지막 줄(hiUntil 이 지나면 없음). */
const activeAt = (f: number, hiAt: readonly number[] | undefined, i: number, hiUntil?: number): number => {
  if (!hiAt || hiAt[i] == null) return 0;
  const next = hiAt.slice(i + 1).find((x) => x != null);
  return glow(f, hiAt[i], next ?? hiUntil);
};
const mixColor = (a: [number, number, number, number], b: [number, number, number, number], t: number): string =>
  `rgba(${a.map((v, k) => (k < 3 ? Math.round(v + (b[k]! - v) * t) : +(v + (b[k]! - v) * t).toFixed(3))).join(',')})`;
const WHITE_PILL: [number, number, number, number] = [255, 255, 255, 0.82];
const ACCENT: [number, number, number, number] = [224, 82, 58, 1];
const INK: [number, number, number, number] = [38, 37, 36, 1];
const WHITE: [number, number, number, number] = [255, 255, 255, 1];

// ── 틀 ─────────────────────────────────────────────────────────
/** 유리 카드 — 흐린 반투명(rgba 255,.30) + 흰 테두리 + 그림자 + backdrop blur. 등장(opacity·transform)은 카드 자신에게만 건다. */
export const GlassCard: React.FC<{ at?: number; until?: number; width?: number; pad?: string; style?: React.CSSProperties; children?: React.ReactNode }> = ({ at = 0, until, width = 1240, pad = '40px 48px 44px', style, children }) => {
  const f = useCurrentFrame();
  const probe = useProbe();
  const p = enter(f, at, 17);
  const o = p * leave(f, until);
  if (o <= 0) return <div style={{ width, flex: '0 0 auto', visibility: 'hidden' }} />;
  return (
    <div style={{
      width, flex: '0 0 auto', boxSizing: 'border-box', padding: pad, borderRadius: 48, background: HY.glass, border: `2px solid ${HY.glassEdge}`,
      backdropFilter: 'blur(28px) saturate(1.3)', WebkitBackdropFilter: 'blur(28px) saturate(1.3)',
      boxShadow: probe ? 'none' : '0 26px 60px rgba(20,24,16,.26), inset 0 1px 0 rgba(255,255,255,.9)',
      opacity: o, transform: `translateY(${(1 - p) * 42}px) scale(${0.96 + 0.04 * p})`, fontFamily: FONT_CARD, ...style,
    }}>{children}</div>
  );
};

/** 머리글 — variant 'pill'(포인트 색 알약 + 흰 글자, 기본) | 'title'(포인트 색 글자 + 흰 빛). */
export const CardHead: React.FC<{ text: string; at?: number; variant?: 'pill' | 'title'; size?: number }> = ({ text, at = 4, variant = 'pill', size = 58 }) => {
  const f = useCurrentFrame();
  const p = popIn(f, at);
  const common: React.CSSProperties = { opacity: Math.min(1, p * 1.4), transform: `scale(${0.82 + 0.18 * p})`, textAlign: 'center', fontWeight: 900, letterSpacing: -1, fontSize: size, lineHeight: 1.2 };
  return variant === 'pill'
    ? <div style={{ ...common, padding: '14px 34px 16px', borderRadius: 999, background: HY.accent, color: '#fff', boxShadow: '0 10px 24px rgba(0,0,0,.18)' }}>{text}</div>
    : <div style={{ ...common, color: HY.accent, textShadow: '0 2px 0 rgba(255,255,255,.8), 0 0 18px rgba(255,255,255,.6)' }}>{text}</div>;
};

/** 번호 원(포인트 색 + 흰 숫자). glow 0~1 = 강조(흰 테 + 커짐). */
const NumBadge: React.FC<{ n: number | string; size?: number; glow?: number }> = ({ n, size = 78, glow: g = 0 }) => (
  <div style={{ flex: '0 0 auto', width: size, height: size, borderRadius: '50%', background: HY.accent, color: '#fff', fontSize: size * 0.52, fontWeight: 900,
    display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${1 + 0.14 * g})`, boxShadow: `0 0 0 ${10 * g}px rgba(255,255,255,${0.6 * g})` }}>{n}</div>
);

// ── 목록 ───────────────────────────────────────────────────────
/**
 * 목록 카드 — 번호 원 + 흰 알약 줄. at[i] 에 i 번째 줄이 왼쪽에서 미끄러져 들어오고, hiAt[i] 에 그 줄이 포인트 색으로 짚인다(다음 줄로 옮겨 감).
 * title 이 있으면 머리글 알약. numbered=false 면 번호 대신 작은 점.
 */
export const InfoList: React.FC<{ title?: string; items: readonly string[]; at: readonly number[]; hiAt?: readonly number[]; hiUntil?: number; numbered?: boolean; cardAt?: number; until?: number; width?: number; size?: number }> = ({ title, items, at, hiAt, hiUntil, numbered = true, cardAt, until, width, size = 50 }) => {
  const f = useCurrentFrame();
  return (
    <GlassCard at={cardAt ?? Math.max(0, (at[0] ?? 0) - 10)} {...(until != null ? { until } : {})} {...(width ? { width } : {})}>
      {title ? <CardHead text={title} at={(cardAt ?? Math.max(0, (at[0] ?? 0) - 10)) + 5} /> : null}
      {items.map((it, i) => {
        const p = enter(f, at[i] ?? 0, 14);
        const g = activeAt(f, hiAt, i, hiUntil);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: i === 0 && !title ? 0 : 20, opacity: p, transform: `translateX(${(1 - p) * -46}px)` }}>
            {numbered ? <NumBadge n={i + 1} glow={g} /> : <div style={{ width: 22, height: 22, borderRadius: '50%', background: HY.accent, flex: '0 0 auto', marginLeft: 26, marginRight: 26 }} />}
            <div style={{ flex: 1, padding: '15px 34px 17px', borderRadius: 999, background: mixColor(WHITE_PILL, ACCENT, g), color: mixColor(INK, WHITE, g),
              fontSize: size, fontWeight: 900, letterSpacing: -1, transform: `translateX(${14 * g}px)` }}>{it}</div>
          </div>
        );
      })}
    </GlassCard>
  );
};

// ── 대비 ───────────────────────────────────────────────────────
export type Side = { label: string; note?: string };
/**
 * 대비 카드 — ✕ 흰 알약(틀린·불리한 쪽) / ✓ 포인트 색 알약(맞는·유리한 쪽). noAt 에 ✕ 줄이 왼쪽에서, okAt 에 ✓ 줄이 오른쪽에서 들어오고
 * ✕ 줄은 흐려지며(dimNo) ✓ 줄이 한 번 튄다. layout 'rows'(위아래, 기본) | 'side'(좌우 두 칸 + 가운데 화살표).
 * marks 로 기호를 바꿀 수 있다(예: 둘 다 사실인 비교면 ['A','B'] 대신 noMark·okMark 에 글자 없는 기호 '◦').
 */
export const Compare: React.FC<{ title?: string; no: Side; ok: Side; noAt: number; okAt: number; dimNo?: boolean; layout?: 'rows' | 'side'; cardAt?: number; until?: number; width?: number; noMark?: string; okMark?: string }> = ({ title, no, ok, noAt, okAt, dimNo = true, layout = 'rows', cardAt, until, width, noMark = '✕', okMark = '✓' }) => {
  const f = useCurrentFrame();
  const c0 = cardAt ?? Math.max(0, noAt - 10);
  const pN = enter(f, noAt, 15);
  const pO = enter(f, okAt, 16);
  const dim = dimNo ? interpolate(f, [okAt + 12, okAt + 34], [1, 0.55], clamp) : 1;
  const pulse = interpolate(f, [okAt + 18, okAt + 26, okAt + 40, okAt + 50], [0, 1, 1, 0], clamp);
  const sideBox = (s: Side, good: boolean, extra: React.CSSProperties): React.ReactNode => (
    <div style={{ flex: 1, padding: '18px 34px 20px', borderRadius: 40, background: good ? HY.accent : HY.pill, color: good ? '#fff' : HY.ink,
      boxShadow: good ? `0 12px 26px rgba(0,0,0,.18), 0 0 0 ${12 * pulse}px rgba(255,255,255,${0.45 * pulse})` : 'none', transform: good ? `scale(${1 + 0.035 * pulse})` : 'none', ...extra }}>
      <div style={{ fontSize: 50, fontWeight: 900, letterSpacing: -1, lineHeight: 1.18 }}>{s.label}</div>
      {s.note ? <div style={{ fontSize: 34, fontWeight: 800, opacity: 0.88, marginTop: 4 }}>{s.note}</div> : null}
    </div>
  );
  const mark = (m: string, good: boolean, p: number): React.ReactNode => (
    <div style={{ flex: '0 0 auto', width: 92, height: 92, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50, fontWeight: 900,
      background: good ? '#fff' : HY.pill, color: good ? HY.accent : HY.ink, boxShadow: good ? '0 6px 16px rgba(0,0,0,.18)' : 'none', transform: `scale(${good ? popIn(f, okAt + 4) : p})` }}>{m}</div>
  );
  if (layout === 'side') {
    const arrowP = interpolate(f, [okAt - 8, okAt + 6], [0, 1], clamp);
    return (
      <GlassCard at={c0} {...(until != null ? { until } : {})} width={width ?? 1500}>
        {title ? <CardHead text={title} at={c0 + 5} /> : null}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 26, marginTop: title ? 26 : 0 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 18, opacity: pN * dim, transform: `translateX(${(1 - pN) * -56}px)` }}>{mark(noMark, false, pN)}{sideBox(no, false, {})}</div>
          <svg width={86} height={60} viewBox="0 0 86 60" style={{ alignSelf: 'center', flex: '0 0 auto' }}>
            <path d="M6 30 H70 M54 12 L74 30 L54 48" fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={140} strokeDashoffset={140 * (1 - arrowP)} />
          </svg>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 18, opacity: pO, transform: `translateX(${(1 - pO) * 56}px)` }}>{mark(okMark, true, pO)}{sideBox(ok, true, {})}</div>
        </div>
      </GlassCard>
    );
  }
  return (
    <GlassCard at={c0} {...(until != null ? { until } : {})} {...(width ? { width } : {})}>
      {title ? <CardHead text={title} at={c0 + 5} variant="title" size={62} /> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: title ? 24 : 0, opacity: pN * dim, transform: `translateX(${(1 - pN) * -56}px)` }}>{mark(noMark, false, pN)}{sideBox(no, false, {})}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 22, opacity: pO, transform: `translateX(${(1 - pO) * 56}px)` }}>{mark(okMark, true, pO)}{sideBox(ok, true, {})}</div>
    </GlassCard>
  );
};

// ── 흐름·단계 ───────────────────────────────────────────────────
/** 그려지는 화살표(흰 선 + 흑연 겹선) — at 부터 12프레임 동안 그려진다. dir 'right'|'down'. */
export const DrawArrow: React.FC<{ at: number; length?: number; dir?: 'right' | 'down'; color?: string }> = ({ at, length = 90, dir = 'right', color = HY.ink }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 12], [0, 1], { ...clamp, easing: OUT });
  const L = length;
  const d = `M6 30 H${L - 14} M${L - 32} 12 L${L - 10} 30 L${L - 32} 48`;
  const total = L + 60;
  return (
    <svg width={L} height={60} viewBox={`0 0 ${L} 60`} style={{ flex: '0 0 auto', transform: dir === 'down' ? 'rotate(90deg)' : undefined }}>
      <path d={d} fill="none" stroke="#fff" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" opacity={0.5} strokeDasharray={total} strokeDashoffset={total * (1 - p)} />
      <path d={d} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} strokeDasharray={total} strokeDashoffset={total * (1 - p)} />
    </svg>
  );
};

/**
 * 단계·흐름 카드 — 알약 칸들이 화살표로 이어진다(가로 기본, 칸이 넷 넘거나 길면 direction='column').
 * at[i] 에 i 번째 칸이 튀어나오고 그 앞 화살표가 그려진다. hiAt 로 낭독이 짚는 칸을 포인트 색으로. numbered 면 칸 머리에 번호 원.
 * last='accent' 면 마지막 칸(결과·행동)을 처음부터 포인트 색 알약으로(숏폼 상황→행동).
 */
export const Steps: React.FC<{ title?: string; steps: readonly string[]; at: readonly number[]; hiAt?: readonly number[]; hiUntil?: number; numbered?: boolean; direction?: 'row' | 'column'; last?: 'accent' | 'plain'; cardAt?: number; until?: number; width?: number; size?: number }> = ({ title, steps, at, hiAt, hiUntil, numbered = false, direction = 'row', last = 'plain', cardAt, until, width, size = 48 }) => {
  const f = useCurrentFrame();
  const c0 = cardAt ?? Math.max(0, (at[0] ?? 0) - 10);
  return (
    <GlassCard at={c0} {...(until != null ? { until } : {})} width={width ?? 1500}>
      {title ? <CardHead text={title} at={c0 + 5} /> : null}
      <div style={{ display: 'flex', flexDirection: direction, alignItems: 'center', justifyContent: 'center', gap: direction === 'row' ? 14 : 8, marginTop: title ? 28 : 0 }}>
        {steps.map((s, i) => {
          const p = popIn(f, at[i] ?? 0);
          const g = Math.max(activeAt(f, hiAt, i, hiUntil), last === 'accent' && i === steps.length - 1 ? 1 : 0);
          return (
            <React.Fragment key={i}>
              {i > 0 ? <DrawArrow at={(at[i] ?? 0) - 8} dir={direction === 'row' ? 'right' : 'down'} length={direction === 'row' ? 80 : 70} /> : null}
              <div style={{ flex: direction === 'row' ? 1 : '0 0 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 14, padding: numbered ? '14px 30px 14px 14px' : '18px 30px 20px', borderRadius: 999,
                background: mixColor(WHITE_PILL, ACCENT, g), color: mixColor(INK, WHITE, g), opacity: Math.min(1, p * 1.4), transform: `scale(${(0.86 + 0.14 * p) * (1 + 0.04 * g)})`,
                boxShadow: g > 0.5 ? '0 10px 24px rgba(0,0,0,.16)' : 'none', justifyContent: 'center' }}>
                {numbered ? <div style={{ flex: '0 0 auto', width: 64, height: 64, borderRadius: '50%', background: g > 0.5 ? '#fff' : HY.accent, color: g > 0.5 ? HY.accent : '#fff', fontSize: 34, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div> : null}
                <div style={{ fontSize: size, fontWeight: 900, letterSpacing: -1, textAlign: 'center', lineHeight: 1.18 }}>{s}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </GlassCard>
  );
};

// ── 숫자·범위 ───────────────────────────────────────────────────
/**
 * 범위 막대 — 0 ~ axisMax 눈금자 위에 min~max 구간이 포인트 색으로 그려진다(at 부터). valueText(예: '6~14m')는 크게 튀어나온다.
 * orient 'v' 면 세로 자(키·높이), 'h' 면 가로 자. minText·maxText = 구간 끝 글자(예: '6m', '14m'). label = 자 옆 짧은 말(문장 낱말).
 * 숫자를 세어 올리지 않는다(문장에 없는 숫자가 화면에 지나가면 안 된다).
 */
export const RangeBar: React.FC<{ min: number; max: number; axisMax: number; valueText: string; minText?: string; maxText?: string; label?: string; at: number; orient?: 'h' | 'v'; cardAt?: number; until?: number; width?: number }> = ({ min, max, axisMax, valueText, minText, maxText, label, at, orient = 'v', cardAt, until, width }) => {
  const f = useCurrentFrame();
  const c0 = cardAt ?? Math.max(0, at - 12);
  const pv = popIn(f, at + 10, 16);
  const draw = interpolate(f, [at, at + 22], [0, 1], { ...clamp, easing: OUT });
  const ends = interpolate(f, [at + 16, at + 26], [0, 1], clamp);
  const big = (
    <div style={{ textAlign: 'center', opacity: Math.min(1, pv * 1.3), transform: `scale(${0.7 + 0.3 * pv})` }}>
      <div style={{ fontSize: 168, fontWeight: 900, color: HY.accent, letterSpacing: -4, lineHeight: 1, textShadow: '0 4px 0 rgba(255,255,255,.85), 0 0 26px rgba(255,255,255,.55)' }}>{valueText}</div>
      {label ? <div style={{ display: 'inline-block', marginTop: 22, padding: '12px 30px 14px', borderRadius: 999, background: HY.pill, color: HY.ink, fontSize: 44, fontWeight: 900 }}>{label}</div> : null}
    </div>
  );
  if (orient === 'v') {
    const Hh = 560; const top = 30; const x = 120;
    const yOf = (v: number) => top + Hh - (v / axisMax) * Hh;
    const ticks = Array.from({ length: 5 }, (_, k) => (axisMax * k) / 4);
    const y0 = yOf(min); const y1 = yOf(max);
    const segTop = y0 - (y0 - y1) * draw;
    return (
      <GlassCard at={c0} {...(until != null ? { until } : {})} width={width ?? 1180} pad="34px 56px 34px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <div style={{ position: 'relative', flex: '0 0 auto', width: 330, height: Hh + 2 * top }}>
          <svg width={330} height={Hh + 2 * top} viewBox={`0 0 330 ${Hh + 2 * top}`} style={{ position: 'absolute', left: 0, top: 0 }}>
            <path d={`M${x} ${top} V${top + Hh}`} stroke={HY.ink} strokeWidth={6} strokeLinecap="round" opacity={0.55} />
            {ticks.map((t, k) => <path key={k} d={`M${x - 18} ${yOf(t)} H${x + 18}`} stroke={HY.ink} strokeWidth={5} strokeLinecap="round" opacity={0.45} />)}
            <path d={`M${x} ${top + Hh} H${x + 150}`} stroke={HY.ink} strokeWidth={6} strokeLinecap="round" opacity={0.55} />
            <rect x={x - 22} y={segTop} width={44} height={Math.max(0, y0 - segTop)} rx={22} fill={HY.accent} />
            <g opacity={ends}>
              <path d={`M${x + 30} ${y0} H${x + 70}`} stroke={HY.accent} strokeWidth={6} strokeLinecap="round" />
              <path d={`M${x + 30} ${y1} H${x + 70}`} stroke={HY.accent} strokeWidth={6} strokeLinecap="round" />
            </g>
          </svg>
            {minText ? <div style={{ position: 'absolute', left: x + 84, top: y0 - 32, fontSize: 48, fontWeight: 900, color: HY.ink, opacity: ends, whiteSpace: 'nowrap' }}>{minText}</div> : null}
            {maxText ? <div style={{ position: 'absolute', left: x + 84, top: y1 - 32, fontSize: 48, fontWeight: 900, color: HY.accentDeep, opacity: ends, whiteSpace: 'nowrap' }}>{maxText}</div> : null}
          </div>
          <div style={{ flex: 1 }}>{big}</div>
        </div>
      </GlassCard>
    );
  }
  const Wd = 1100; const x0 = 40;
  const xOf = (v: number) => x0 + (v / axisMax) * Wd;
  const a = xOf(min); const b = xOf(max);
  return (
    <GlassCard at={c0} {...(until != null ? { until } : {})} width={width ?? 1300}>
      {big}
      <svg width={Wd + 2 * x0} height={150} viewBox={`0 0 ${Wd + 2 * x0} 150`} style={{ display: 'block', margin: '30px auto 0' }}>
        <path d={`M${x0} 70 H${x0 + Wd}`} stroke={HY.ink} strokeWidth={6} strokeLinecap="round" opacity={0.5} />
        {Array.from({ length: 5 }, (_, k) => <path key={k} d={`M${xOf((axisMax * k) / 4)} 52 V88`} stroke={HY.ink} strokeWidth={5} strokeLinecap="round" opacity={0.42} />)}
        <rect x={a} y={50} width={Math.max(0, (b - a) * draw)} height={40} rx={20} fill={HY.accent} />
      </svg>
      <div style={{ position: 'relative', height: 56, opacity: ends }}>
        {minText ? <div style={{ position: 'absolute', left: a - 60, width: 120, textAlign: 'center', fontSize: 44, fontWeight: 900, color: HY.ink }}>{minText}</div> : null}
        {maxText ? <div style={{ position: 'absolute', left: b - 60, width: 120, textAlign: 'center', fontSize: 44, fontWeight: 900, color: HY.accentDeep }}>{maxText}</div> : null}
      </div>
    </GlassCard>
  );
};

/** 숫자 하나 강조 — 큰 숫자(포인트 색)가 튀어나오고 밑줄 원호가 그려진다. label = 숫자 위·아래 짧은 말(문장 낱말). */
export const BigNumber: React.FC<{ value: string; label?: string; sub?: string; at: number; cardAt?: number; until?: number; width?: number; size?: number }> = ({ value, label, sub, at, cardAt, until, width, size = 190 }) => {
  const f = useCurrentFrame();
  const p = popIn(f, at, 16);
  const line = interpolate(f, [at + 8, at + 24], [0, 1], { ...clamp, easing: OUT });
  return (
    <GlassCard at={cardAt ?? Math.max(0, at - 10)} {...(until != null ? { until } : {})} width={width ?? 860} style={{ textAlign: 'center' }}>
      {label ? <div style={{ fontSize: 48, fontWeight: 900, color: HY.ink, letterSpacing: -1, opacity: enter(f, at - 6) }}>{label}</div> : null}
      <div style={{ fontSize: size, fontWeight: 900, color: HY.accent, letterSpacing: -5, lineHeight: 1.05, opacity: Math.min(1, p * 1.3), transform: `scale(${0.7 + 0.3 * p})`, textShadow: '0 4px 0 rgba(255,255,255,.85), 0 0 26px rgba(255,255,255,.55)' }}>{value}</div>
      <svg width={Math.min(520, (width ?? 860) - 140)} height={34} viewBox="0 0 520 34" preserveAspectRatio="none" style={{ display: 'block', margin: '0 auto' }}>
        <path d="M14 22 C150 6 370 6 506 20" fill="none" stroke={HY.accent} strokeWidth={10} strokeLinecap="round" strokeDasharray={520} strokeDashoffset={520 * (1 - line)} />
      </svg>
      {sub ? <div style={{ display: 'inline-block', marginTop: 14, padding: '12px 30px 14px', borderRadius: 999, background: HY.pill, color: HY.ink, fontSize: 42, fontWeight: 900, opacity: enter(f, at + 18) }}>{sub}</div> : null}
    </GlassCard>
  );
};

// ── 점검표 ─────────────────────────────────────────────────────
/** 점검표 — 네모 칸 + 알약 줄. at[i] 에 줄이 들어오고 checkAt[i] 에 칸에 ✓(또는 marks[i]='no' 면 ✕)가 그려진다. */
export const Checklist: React.FC<{ title?: string; items: readonly string[]; at: readonly number[]; checkAt?: readonly number[]; marks?: ReadonlyArray<'ok' | 'no'>; cardAt?: number; until?: number; width?: number; size?: number }> = ({ title, items, at, checkAt, marks, cardAt, until, width, size = 48 }) => {
  const f = useCurrentFrame();
  const c0 = cardAt ?? Math.max(0, (at[0] ?? 0) - 10);
  return (
    <GlassCard at={c0} {...(until != null ? { until } : {})} {...(width ? { width } : {})}>
      {title ? <CardHead text={title} at={c0 + 5} /> : null}
      {items.map((it, i) => {
        const p = enter(f, at[i] ?? 0, 14);
        const ca = checkAt?.[i] ?? (at[i] ?? 0) + 12;
        const c = interpolate(f, [ca, ca + 10], [0, 1], { ...clamp, easing: OUT });
        const bad = marks?.[i] === 'no';
        const d = bad ? 'M18 18 L52 52 M52 18 L18 52' : 'M14 37 L30 53 L57 18';
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: i === 0 && !title ? 0 : 20, opacity: p, transform: `translateX(${(1 - p) * -46}px)` }}>
            <svg width={70} height={70} viewBox="0 0 70 70" style={{ flex: '0 0 auto' }}>
              <rect x={4} y={4} width={62} height={62} rx={16} fill={c > 0.5 && !bad ? HY.accent : HY.pill} stroke="#fff" strokeWidth={3} />
              <path d={d} fill="none" stroke={bad ? HY.ink : '#fff'} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={80} strokeDashoffset={80 * (1 - c)} />
            </svg>
            <div style={{ flex: 1, padding: '15px 34px 17px', borderRadius: 999, background: HY.pill, color: HY.ink, fontSize: size, fontWeight: 900, letterSpacing: -1, opacity: bad ? 1 - 0.35 * c : 1 }}>{it}</div>
          </div>
        );
      })}
    </GlassCard>
  );
};

// ── 낱개 ───────────────────────────────────────────────────────
/** 알약 하나 — tone 'accent'(포인트 색·흰 글자) | 'white'(흰 알약·흑연 글자) | 'dim'. at 에 튀어나온다. 카드 밖(무대 위)에 바로 놓아도 된다. */
export const Pill: React.FC<{ text: string; at?: number; until?: number; tone?: 'accent' | 'white' | 'dim'; size?: number }> = ({ text, at = 0, until, tone = 'white', size = 46 }) => {
  const f = useCurrentFrame();
  const p = popIn(f, at) * leave(f, until);
  const bg = tone === 'accent' ? HY.accent : tone === 'dim' ? HY.pillDim : HY.pill;
  return <div style={{ flex: '0 0 auto', padding: '14px 32px 16px', borderRadius: 999, background: bg, color: tone === 'accent' ? '#fff' : HY.ink, fontSize: size, fontWeight: 900, letterSpacing: -1,
    opacity: Math.min(1, p * 1.4), transform: `scale(${0.85 + 0.15 * p})`, boxShadow: tone === 'accent' ? '0 10px 24px rgba(0,0,0,.18)' : 'none', fontFamily: FONT_CARD }}>{text}</div>;
};

/** 가로·세로 묶음(레이아웃만). */
export const HStack: React.FC<{ gap?: number; align?: React.CSSProperties['alignItems']; children?: React.ReactNode }> = ({ gap = 28, align = 'center', children }) => (
  <div style={{ display: 'flex', flexDirection: 'row', alignItems: align, justifyContent: 'center', gap }}>{children}</div>
);
export const VStack: React.FC<{ gap?: number; align?: React.CSSProperties['alignItems']; children?: React.ReactNode }> = ({ gap = 22, align = 'center', children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, justifyContent: 'center', gap }}>{children}</div>
);

export { CardStage, HY } from './HybridStage';
