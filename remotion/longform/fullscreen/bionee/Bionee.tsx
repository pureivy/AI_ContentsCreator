// 비온이 그리기(2026-10-23) — Pose 하나를 받아 연필 선화 SVG <g> 로 그린다. 바탕은 칠하지 않는다(투명). 그림자는 땅에만.
// 좌표 = 캐릭터 로컬(원점 = 두 발 사이 땅, 키 ≈ 520) → translate(x,y) scale(size). 같은 화면에 여럿이면 idp 를 달리 준다(정의 id 앞머리).
// 선 = 굵기 변하는 리본(빛 반대쪽이 굵다) + 살짝 어긋난 덧선, 그늘 = 오른쪽 아래 빗금, 결 = 흑연 결 필터(떨림 + 결, 투명도는 그대로).
import React from 'react';
import { FONT_DODUM } from '../stage';
import {
  ARM, BODY_H0, BODY_H1, FACE, FOOT, PLANT, RIM, bodyOutline, bodyR, ellipseArc, rimR, hatch, ik, armCurve, leafShape, makeView, poly, proj, ribbon, ringEllipse, rimOutline, rn, smooth, surf, wobble,
  type P, type View,
} from './geom';
import { autoFlip, bootGeom, handGeom, handXf, type BootGeom } from './limbs';
import type { Arm, Pose, Season, Side } from './pose';

export const INK = '#2a2826';
export const INK2 = '#4a4845';
export const SOFT = '#8f8b84';
const POT = '#e8dfd4';
const POT_LIGHT = '#f2ece4';
const POT_SHADE = '#cfc2b4';
const INSIDE = '#a5998d';
const SOIL = '#7a7068';
const PEBBLE = '#3f3a36';
const BOOT = '#d5d5c7';
const BOOT_SOLE = '#8d8b80';
const BOOT_BAND = '#c3c3b4';
const SCLERA = '#fbf8f1';
export const ACCENT = '#e0523a';
const ACCENT_DARK = '#c13f2b';
const LEAF_AUTUMN_FRONT = '#e39a5c';
const LEAF_AUTUMN_BACK = '#d7b38c';
const LEAF: Record<Season, string> = { summer: '#cdc9c1', spring: '#e0ddd3', autumn: '#d3c8ba', winter: '#cfc8bd' };
const f1 = (n: number) => n.toFixed(1);
const D2R = Math.PI / 180;

/** 연필 선(굵기 변함) + 덧선. */
const Ink: React.FC<{ pts: P[]; w?: number; closed?: boolean; seed: string; o?: number; color?: string; ghost?: boolean; vary?: number }> = ({ pts, w = 4.2, closed = false, seed, o = 1, color = INK, ghost = true, vary }) => {
  if (pts.length < 2 || o <= 0) return null;
  const wp = wobble(pts, seed, 1.6, 6);
  return (
    <g opacity={o}>
      <path d={ribbon(wp, w, { closed, seed, ...(vary != null ? { vary } : {}) })} fill={color} fillRule="evenodd" opacity={0.92} />
      {ghost ? <path d={poly(wobble(pts, `${seed}g`, 2.6, 5), closed)} fill="none" stroke={color} strokeWidth={w * 0.28} strokeLinecap="round" opacity={0.42} transform="translate(1.3 0.9)" /> : null}
    </g>
  );
};

/** 빗금(clip 안). */
const Hatch: React.FC<{ clip: string; box: { x0: number; y0: number; x1: number; y1: number }; angle: number; spacing: number; seed: string; w?: number; o?: number; mask?: string; color?: string }> = ({ clip, box, angle, spacing, seed, w = 1.25, o = 0.6, mask, color = INK2 }) => (
  <g clipPath={`url(#${clip})`} opacity={o}>
    <path d={hatch(box, angle, spacing, seed)} stroke={color} strokeWidth={w} strokeLinecap="round" fill="none" {...(mask ? { mask: `url(#${mask})` } : {})} />
  </g>
);

/**
 * 몸 모양 따라 도는 빗금(2026-10-23 다듬기 — 거친 곧은 빗금 대신 H~2B 연필로 결 따라 긋는 느낌).
 * rings = 높이마다 앞면 호(θ a0→a1, 0 = 정면 가운데, π/2 = 오른쪽 가장자리), merid = 오른쪽 가장자리 쪽 경선(몸 곡선 따라 휨).
 * 빛은 화면 기준(왼쪽 위)이라 yaw 와 상관없이 늘 화면 오른쪽 아래가 그늘.
 */
function formHatch(v: View, rOf: (h: number) => number, o: { h0: number; h1: number; step: number; a0: number; a1: number; seed: string; merid?: [number, number, number] }): { rings: string; merid: string } {
  const pt = (h: number, th: number) => { const r = rOf(h); return proj(v, r * Math.sin(th), h, r * Math.cos(th)); };
  const rings: string[] = [];
  let i = 0;
  for (let h = o.h0; h <= o.h1; h += o.step, i++) {
    const a0 = o.a0 + (rn(o.seed, `a${i}`) + 0.5) * 0.35, a1 = o.a1 - (rn(o.seed, `b${i}`) + 0.5) * 0.06;
    const hh = h + rn(o.seed, `h${i}`) * o.step * 0.4;
    const pts: P[] = Array.from({ length: 9 }, (_, k) => pt(hh + rn(o.seed, `w${i}`) * k * 0.12, a0 + ((a1 - a0) * k) / 8));
    rings.push(poly(pts, false));
  }
  const merid: string[] = [];
  if (o.merid) {
    const [m0, m1, dm] = o.merid;
    let j = 0;
    for (let th = m0; th <= m1; th += dm, j++) {
      const t = th + rn(o.seed, `m${j}`) * dm * 0.4;
      const hA = o.h0 + (rn(o.seed, `ma${j}`) + 0.5) * 18, hB = o.h1 - (rn(o.seed, `mb${j}`) + 0.5) * 22;
      merid.push(poly(Array.from({ length: 11 }, (_, k) => pt(hA + ((hB - hA) * k) / 10, t)), false));
    }
  }
  return { rings: rings.join(' '), merid: merid.join(' ') };
}

// ── 팔·손 ─────────────────────────────────────────────

type ArmDraw = { side: Side; S: P; E: P; W: P; ang: number; flip: 1 | -1; pts: P[]; z: number; arm: Arm };

function armDraw(v: View, side: Side, arm: Arm): ArmDraw {
  const s = side === 'L' ? -1 : 1;
  const sh = surf(v, s * 82, ARM.h, bodyR(ARM.h) - 12);
  // 옆으로 돌면 팔꿈치는 뒤쪽(보는 방향 반대)으로 굽는다
  const turnK = Math.sin(v.yaw);
  const bendSide = (Math.abs(turnK) > 0.35 ? -Math.sign(turnK) : s) as -1 | 1;
  const { E, W } = ik(sh.p, [arm.x, arm.y], ARM.l1, ARM.l2, bendSide, arm.bend);
  const pts = armCurve(sh.p, E, W);
  const fore = Math.atan2(W[1] - pts[pts.length - 3]![1], W[0] - pts[pts.length - 3]![0]);
  // 손 방향 = 아래팔 방향(또는 지정 방향과 섞음) + 돌림
  const d = arm.dirW > 0 ? fore + angDiff(fore, arm.dir * D2R) * Math.min(1, arm.dirW) : fore;
  const ang = d + arm.roll * D2R;
  return { side, S: sh.p, E, W, ang, flip: autoFlip(arm.hand, ang, s as -1 | 1), pts, z: sh.z, arm };
}
const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/** 팔 + 손 — 겉선 층(굵은 잉크) → 채움 층 → 손가락 사이 선 → 그늘 빗금. 둥근 막대들을 겹쳐 하나의 실루엣이 된다. */
const ArmHand: React.FC<{ a: ArmDraw; idp: string; scale?: number; behindProp?: React.ReactNode }> = ({ a, idp, scale = 1, behindProp }) => {
  const g = handGeom(a.arm.hand, ARM.handR * scale);
  const X = handXf(a.W, a.ang, a.flip);
  const caps = [...g.fingers, g.thumb].map((c) => ({ a: X(c.a), b: X(c.b), w: c.w }));
  const pc = X(g.palm.c);
  const armD = poly(a.pts, false);
  const id = `${idp}-arm${a.side}`;
  const shapes = (stroke: string, extra: number) => (
    <>
      <path d={armD} fill="none" stroke={stroke} strokeWidth={ARM.w * scale + extra} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pc[0]} cy={pc[1]} r={g.palm.r + extra / 2} fill={stroke} />
      {caps.map((c, i) => <line key={i} x1={c.a[0]} y1={c.a[1]} x2={c.b[0]} y2={c.b[1]} stroke={stroke} strokeWidth={c.w + extra} strokeLinecap="round" />)}
    </>
  );
  // 손가락 끝 둥근 선(서로 겹친 손가락을 갈라 보이게)
  const tipArcs = caps.slice(0, 3).map((c, i) => {
    const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1];
    const t = Math.atan2(dy, dx);
    const r = c.w / 2;
    const p0: P = [c.b[0] + Math.cos(t + 1.75) * r, c.b[1] + Math.sin(t + 1.75) * r];
    const p1: P = [c.b[0] + Math.cos(t - 1.75) * r, c.b[1] + Math.sin(t - 1.75) * r];
    const back: P = [c.b[0] - dx / (Math.hypot(dx, dy) || 1) * r * 1.4, c.b[1] - dy / (Math.hypot(dx, dy) || 1) * r * 1.4];
    return <path key={i} d={`M ${f1(back[0] + Math.cos(t + 1.6) * r)} ${f1(back[1] + Math.sin(t + 1.6) * r)} L ${f1(p0[0])} ${f1(p0[1])} A ${f1(r)} ${f1(r)} 0 0 ${a.flip > 0 ? 0 : 0} ${f1(p1[0])} ${f1(p1[1])}`} fill="none" stroke={INK} strokeWidth={1.7} opacity={0.75 * (i === 2 ? 1 : 1)} strokeLinecap="round" />;
  });
  const xs = [...a.pts.map((p) => p[0]), pc[0] - 40, pc[0] + 40], ys = [...a.pts.map((p) => p[1]), pc[1] - 40, pc[1] + 40];
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  return (
    <g>
      <defs>
        <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x={box.x0 - 30} y={box.y0 - 30} width={box.x1 - box.x0 + 60} height={box.y1 - box.y0 + 60}>
          <g>{shapes('#fff', 0)}</g>
        </mask>
        <linearGradient id={`${id}-sg`} gradientUnits="userSpaceOnUse" x1={box.x0} y1={box.y0} x2={box.x1} y2={box.y1}>
          <stop offset={0.35} stopColor="#fff" stopOpacity={0} /><stop offset={1} stopColor="#fff" stopOpacity={1} />
        </linearGradient>
        <mask id={`${id}-sm`} maskUnits="userSpaceOnUse" x={box.x0 - 30} y={box.y0 - 30} width={box.x1 - box.x0 + 60} height={box.y1 - box.y0 + 60}>
          <rect x={box.x0 - 30} y={box.y0 - 30} width={box.x1 - box.x0 + 60} height={box.y1 - box.y0 + 60} fill={`url(#${id}-sg)`} />
        </mask>
      </defs>
      {behindProp}
      <g opacity={0.95}>{shapes(INK, 6.2 * scale)}</g>
      {shapes(POT_LIGHT, 0)}
      <g mask={`url(#${id}-m)`}>
        <g mask={`url(#${id}-sm)`} opacity={0.55}>
          <path d={hatch(box, 58, 3.8, `${id}h`)} stroke={INK2} strokeWidth={0.7} fill="none" />
        </g>
        {tipArcs}
      </g>
    </g>
  );
};

// ── 장화 ─────────────────────────────────────────────

const Boot: React.FC<{ b: BootGeom; idp: string; k: string; winter: boolean; leg?: boolean }> = ({ b, idp, k, winter, leg = false }) => {
  const id = `${idp}-boot${k}`;
  const xs = b.outline.map((p) => p[0]), ys = b.outline.map((p) => p[1]);
  const box = { x0: Math.min(...xs) - 4, y0: Math.min(...ys) - 4, x1: Math.max(...xs) + 4, y1: Math.max(...ys) + 4 };
  // 2026-10-23 다듬기 — 밑창·굽(어두운 고무) → 발등·목(장화 색) → 테 띠(한 톤 진하게) 덩이를 겹쳐 하나의 장화 실루엣
  const union = [b.sole, b.heel, b.foot, b.shaft, b.band].map((q) => poly(q)).join(' ');
  const upperD = `${poly(b.foot)} ${poly(b.shaft)}`;
  return (
    <g>
      <defs><clipPath id={`${id}-c`}><path d={upperD} /></clipPath><clipPath id={`${id}-b`}><path d={poly(b.band)} /></clipPath></defs>
      <path d={union} fill={INK} stroke={INK} strokeWidth={5.6} strokeLinejoin="round" />
      <path d={poly(b.sole)} fill={BOOT_SOLE} />
      <path d={poly(b.heel)} fill={BOOT_SOLE} />
      <path d={upperD} fill={BOOT} />
      <g clipPath={`url(#${id}-c)`}>
        <path d={hatch({ x0: (box.x0 + box.x1) / 2 - 2, y0: box.y0, x1: box.x1, y1: box.y1 }, 64, 2.8, `${id}h`)} stroke={INK2} strokeWidth={0.7} opacity={0.42} />
        {/* 둥근 앞코 윗면 반짝 */}
        <path d={poly(b.toeCap.slice(4, 9), false)} fill="none" stroke={SCLERA} strokeWidth={2.2} opacity={0.35 * b.toeVis} transform="translate(-2 -6)" />
      </g>
      <path d={poly(b.band)} fill={BOOT_BAND} />
      <g clipPath={`url(#${id}-b)`}><path d={hatch({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }, 64, 2.6, `${id}hb`)} stroke={INK2} strokeWidth={0.6} opacity={0.3} /></g>
      <Ink pts={lowerHalf(b.foot)} w={1.4} seed={`${id}s`} o={0.6} ghost={false} vary={0.2} />
      <Ink pts={b.toeCap} w={1.3} seed={`${id}t`} o={0.5 * b.toeVis} ghost={false} vary={0.3} />
      <Ink pts={b.cuff} w={1.7} seed={`${id}c`} o={0.8} ghost={false} vary={0.3} />
      <path d={poly(b.bandTop)} fill="none" stroke={INK} strokeWidth={1.6} opacity={0.8} />
      {leg ? (() => {
        // 다리 토막(2026-10-23) — 화분 밑에서 장화 입구로 들어간 짧은 다리(빈 장화 속이 보이지 않게)
        const xs2 = b.opening.map((q) => q[0]), cx = (Math.min(...xs2) + Math.max(...xs2)) / 2, hw = (Math.max(...xs2) - Math.min(...xs2)) * 0.4;
        const front = b.opening.filter((q) => q[1] >= b.top[1]).sort((p1, p2) => p1[0] - p2[0]);
        const y0 = b.top[1] - 46;
        const d = `M ${f1(cx - hw)} ${f1(y0)} L ${f1(cx - hw)} ${f1(b.top[1])} Q ${f1(cx)} ${f1(b.top[1] + hw * 0.5)} ${f1(cx + hw)} ${f1(b.top[1])} L ${f1(cx + hw)} ${f1(y0)} Z`;
        return (
          <g>
            <path d={poly(b.opening)} fill="#6b665e" />
            <path d={d} fill={POT_SHADE} />
            <path d={`M ${f1(cx - hw)} ${f1(y0)} L ${f1(cx - hw)} ${f1(b.top[1])} M ${f1(cx + hw)} ${f1(b.top[1])} L ${f1(cx + hw)} ${f1(y0)}`} stroke={INK} strokeWidth={2.2} fill="none" />
            <Ink pts={front} w={1.8} seed={`${id}o`} ghost={false} vary={0.2} />
          </g>
        );
      })() : <path d={poly(b.opening)} fill="#6b665e" stroke={INK} strokeWidth={1.9} />}
      <path d={union} fill="none" stroke={INK} strokeWidth={1} opacity={0.3} transform="translate(1 0.8)" />
      {winter ? b.snow.map((p, i) => (
        <g key={i}><circle cx={p[0]} cy={p[1]} r={i ? 4.2 : 5.5} fill={SCLERA} /><circle cx={p[0]} cy={p[1]} r={i ? 4.2 : 5.5} fill="none" stroke={INK} strokeWidth={1.2} opacity={0.7} /></g>
      )) : null}
    </g>
  );
};

/** 닫힌 볼록 다각형의 아래쪽 절반(밑창 위 선). */
function lowerHalf(pts: P[]): P[] {
  let i0 = 0, i1 = 0;
  pts.forEach((p, i) => { if (p[0] < pts[i0]![0]) i0 = i; if (p[0] > pts[i1]![0]) i1 = i; });
  const out: P[] = [];
  // hull 은 반시계(왼→아래→오) 순서 — 가장 왼쪽에서 가장 오른쪽까지
  for (let k = i0; ; k = (k + 1) % pts.length) { out.push(pts[k]!); if (k === i1 || out.length > pts.length) break; }
  return out;
}

/** 발 자리 + 걷기 → 장화 둘(뒤쪽 먼저). */
function boots(v: View, pose: Pose): Array<{ k: string; b: BootGeom }> {
  const out = (['L', 'R'] as const).map((side, i) => {
    const s = side === 'L' ? -1 : 1;
    const az = (s * FOOT.az) * D2R + v.yaw;
    const ph = pose.walkPhase + (i ? Math.PI : 0);
    const sw = Math.sin(ph);
    const lift = pose.walkAmt * Math.max(0, sw) * 15;
    const fwd = pose.walkAmt * Math.cos(ph) * -16;
    const toeUp = pose.walkAmt * (sw > 0 ? 0.42 * sw : 0) + Math.max(0, pose.pitch) * 0.05;
    // 착지 직후(위상 π 근처) 살짝 눌림 + 깡충 착지 눌림
    const wr = ((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const land = pose.walkAmt * 0.16 * Math.exp(-Math.pow((wr - Math.PI - 0.35) * 2.2, 2));
    const squash = land + Math.max(0, pose.squash) * 0.7 * (pose.lift < 2 ? 1 : 0);
    const b = bootGeom(v, { cx: FOOT.r * Math.sin(az), cz: FOOT.r * Math.cos(az), lift, fwd, toeUp, squash, toeYaw: s * 0.32 * (1 - pose.walkAmt * 0.6) });
    return { k: side, b };
  });
  return out.sort((a, b) => a.b.depth - b.b.depth);
}

// ── 얼굴 ─────────────────────────────────────────────

const Face: React.FC<{ v: View; pose: Pose; idp: string; faceAz: number }> = ({ v, pose, idp, faceAz }) => {
  const fy = Math.cos(Math.max(0, pose.pitch) * 0.7);
  const vis = (z: number) => smooth((z - 0.02) / 0.3);
  const lookDX = pose.lookX * 4.5, lookDY = pose.lookY * 4;
  const eyes = ([-1, 1] as const).map((s) => {
    const e = surf(v, faceAz + s * FACE.eyeAz, FACE.eyeH, bodyR(FACE.eyeH));
    const fx = Math.max(0.2, e.z);
    const winkClose = s < 0 ? Math.max(0, -pose.wink) : Math.max(0, pose.wink);
    const open = Math.max(0, pose.eyeOpen * (1 - winkClose));
    const happy = smooth(pose.happy * 1.2 - 0.1);
    const big = smooth(pose.big);
    const rx = 7.6 * fx, ry = 10.8 * fy;
    const [x, y] = e.p;
    const id = `${idp}-eye${s}`;
    const lidY = y - ry * (1 + big * 0.8) + pose.lid * 2 * ry * (1 + big * 0.8) * 0.9;
    const closed = open < 0.3;
    // 위로 굽은 ^ (웃는 눈) · 아래로 굽은 ‿ (감은 눈)
    const arcUp = `M ${f1(x - 10 * fx)} ${f1(y + 3)} Q ${f1(x)} ${f1(y - 9)} ${f1(x + 10 * fx)} ${f1(y + 3)}`;
    const arcDown = `M ${f1(x - 9 * fx)} ${f1(y)} Q ${f1(x)} ${f1(y + 6)} ${f1(x + 9 * fx)} ${f1(y)}`;
    const srx = rx + 8.5 * big * fx, sry = ry + 9 * big;
    return (
      <g key={s} opacity={vis(e.z)}>
        <defs><clipPath id={`${id}-lid`}><rect x={x - 40} y={lidY} width={80} height={80} /></clipPath></defs>
        <g opacity={1 - happy} clipPath={pose.lid > 0.01 ? `url(#${id}-lid)` : undefined}>
          {big > 0.01 ? (
            <g opacity={big}>
              <ellipse cx={x} cy={y - 2 * big} rx={srx} ry={sry} fill={SCLERA} />
              <ellipse cx={x} cy={y - 2 * big} rx={srx} ry={sry} fill="none" stroke={INK} strokeWidth={2.6} />
            </g>
          ) : null}
          {closed ? null : <ellipse cx={x + lookDX * (1 + big)} cy={y + lookDY * (1 + big) - 2 * big} rx={rx * (1 - 0.15 * big)} ry={ry * open * (1 - 0.2 * big)} fill={INK} />}
          {closed ? null : <circle cx={x + lookDX * (1 + big) - 2.2 * fx} cy={y + lookDY * (1 + big) - ry * open * 0.42} r={2.1} fill={SCLERA} opacity={0.9 * smooth(open)} />}
          {closed ? <path d={arcDown} fill="none" stroke={INK} strokeWidth={3.6} strokeLinecap="round" /> : null}
        </g>
        {pose.lid > 0.22 && happy < 0.5 ? <path d={`M ${f1(x - (srx + 2.5))} ${f1(lidY + 1)} Q ${f1(x)} ${f1(lidY - 1.5)} ${f1(x + srx + 2.5)} ${f1(lidY + 1 + s * 1.2)}`} fill="none" stroke={INK} strokeWidth={2.8} strokeLinecap="round" opacity={smooth((pose.lid - 0.22) * 5)} /> : null}
        {happy > 0 ? <path d={arcUp} fill="none" stroke={INK} strokeWidth={3.8} strokeLinecap="round" opacity={happy} /> : null}
      </g>
    );
  });
  // 눈썹
  const brows = pose.brow > 0.02 ? ([-1, 1] as const).map((s) => {
    const b = surf(v, faceAz + s * (FACE.eyeAz + 1), FACE.browH + (pose.big * 6), bodyR(FACE.browH));
    const fx = Math.max(0.2, b.z);
    const raise = -pose.browRaise * 7 - (s > 0 ? pose.browAsym * 9 : -pose.browAsym * 2);
    const tilt = pose.browTilt * 6; // + 안쪽 끝이 올라감(걱정)
    const [x, y] = b.p;
    const inner: P = [x - s * 9 * fx, y + raise - tilt * 0.9];
    const outer: P = [x + s * 9 * fx, y + raise + tilt * 0.6];
    const mid: P = [x, y + raise - 2.8 - (pose.browTilt < 0 ? tilt * -0.1 : 0)];
    return <path key={s} d={`M ${f1(inner[0])} ${f1(inner[1])} Q ${f1(mid[0])} ${f1(mid[1])} ${f1(outer[0])} ${f1(outer[1])}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" opacity={pose.brow * vis(b.z)} />;
  }) : null;
  // 볼
  const cheeks = ([-1, 1] as const).map((s) => {
    const c = surf(v, faceAz + s * FACE.cheekAz, FACE.cheekH + pose.happy * 3, bodyR(FACE.cheekH));
    const fx = Math.max(0.15, c.z);
    const k = Math.min(1.6, pose.cheek);
    const rx = 18.5 * fx * (0.9 + 0.12 * k), ry = 13.5 * fy * (0.9 + 0.12 * k);
    const id = `${idp}-ck${s}`;
    return (
      <g key={s} opacity={vis(c.z) * Math.min(1, k)}>
        <defs><clipPath id={id}><ellipse cx={c.p[0]} cy={c.p[1]} rx={rx} ry={ry} /></clipPath></defs>
        <ellipse cx={c.p[0]} cy={c.p[1]} rx={rx} ry={ry} fill={ACCENT} opacity={0.62 + 0.18 * Math.max(0, k - 1)} filter={`url(#${idp}-soft)`} />
        <g clipPath={`url(#${id})`} opacity={0.55}>
          <path d={hatch({ x0: c.p[0] - rx, y0: c.p[1] - ry, x1: c.p[0] + rx, y1: c.p[1] + ry }, 60, 3.2, id)} stroke={ACCENT_DARK} strokeWidth={1.1} />
        </g>
      </g>
    );
  });
  return <g>{cheeks}{brows}{eyes}<Mouth v={v} pose={pose} faceAz={faceAz} idp={idp} fy={fy} /></g>;
};

/** 입 — 벌림·넓이·동그람·웃음·물결·혀를 이어 붙인 모양(연속). */
const Mouth: React.FC<{ v: View; pose: Pose; faceAz: number; idp: string; fy: number }> = ({ v, pose, faceAz, idp, fy }) => {
  const m = surf(v, faceAz + pose.mouthX * 9, FACE.mouthH, bodyR(FACE.mouthH));
  if (m.z < 0.02) return null;
  const fx = Math.max(0.2, m.z);
  const [cx, cy] = m.p;
  const open = Math.max(0, pose.mOpen), round = pose.mRound;
  // 2026-10-23 — 휴대폰(640×360)에서도 말하는 입이 보이게: 벌릴수록 입이 넓어지고(×1.35까지) 세로로 더 열린다
  const grow = 1 + 0.35 * Math.min(1, open);
  const hw = 12.5 * (0.72 + 0.62 * pose.mWide) * (1 - 0.42 * round) * fx * grow;
  const sm = pose.smile;
  const cornerY = cy - sm * 3.2 + round * open * 4;
  const upY = cy + sm * 4.6 * (1 - open) - open * (2 + round * 7);
  const loY = cy + sm * 4.6 + open * (27 + round * 5) * fy;
  const k = 0.5 + round * 0.45;
  const Lc: P = [cx - hw, cornerY], Rc: P = [cx + hw, cornerY];
  // 위 입술 선(물결이면 사인)
  const upper: P[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    const x = u * u * u * Lc[0] + 3 * u * u * t * (cx - hw * k) + 3 * u * t * t * (cx + hw * k) + t * t * t * Rc[0];
    const yb = u * u * u * Lc[1] + 3 * u * u * t * upY + 3 * u * t * t * upY + t * t * t * Rc[1];
    upper.push([x, yb + Math.sin(t * Math.PI * 3) * 2.6 * pose.wavy * (1 - open)]);
  }
  const lower: P[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    const x = u * u * u * Rc[0] + 3 * u * u * t * (cx + hw * (k + 0.05)) + 3 * u * t * t * (cx - hw * (k + 0.05)) + t * t * t * Lc[0];
    const yb = u * u * u * Rc[1] + 3 * u * u * t * loY + 3 * u * t * t * loY + t * t * t * Lc[1];
    lower.push([x, yb]);
  }
  const id = `${idp}-mouth`;
  const tongueOut = smooth(pose.tongue);
  return (
    <g opacity={smooth((m.z - 0.02) / 0.3)}>
      {open > 0.04 ? (
        <g>
          <defs><clipPath id={id}><path d={poly([...upper, ...lower])} /></clipPath></defs>
          <path d={poly([...upper, ...lower])} fill="#2a201d" />
          <ellipse cx={cx + hw * 0.1} cy={loY - 1} rx={hw * 0.58} ry={Math.max(2, (loY - upY) * 0.34)} fill="#d9715d" opacity={0.9} clipPath={`url(#${id})`} />
          <path d={poly([...upper, ...lower])} fill="none" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
        </g>
      ) : (
        <path d={poly(upper, false)} fill="none" stroke={INK} strokeWidth={3.1} strokeLinecap="round" />
      )}
      {tongueOut > 0.02 ? (
        <g opacity={tongueOut}>
          <path d={`M ${f1(cx - 2)} ${f1(loY - 2)} q 0 ${f1(13 * tongueOut)} ${f1(8 * fx)} ${f1(13 * tongueOut)} q ${f1(8 * fx)} 0 ${f1(8 * fx)} ${f1(-13 * tongueOut)}`} fill="#e8836d" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
          <path d={`M ${f1(cx + 6 * fx)} ${f1(loY + 1)} l 0 ${f1(6 * tongueOut)}`} stroke={ACCENT_DARK} strokeWidth={1.2} />
        </g>
      ) : null}
    </g>
  );
};

// ── 식물(줄기·귀 잎·계절) ────────────────────────────────

type LeafDraw = { base: P; fork: P; ang: number; len: number; flipY: number; z: number; side: number };

function leafDraws(v: View, pose: Pose, fork: P, season: Season, wind: [number, number], flapA: number, bowK = 0): LeafDraw[] {
  return ([-1, 1] as const).map((s) => {
    const ear = s < 0 ? pose.earL : pose.earR;
    const droop = season === 'autumn' ? -10 : 0;
    const e = (19 + ear + droop + (s < 0 ? wind[0] : wind[1]) + flapA * (s < 0 ? 1 : -0.85)) * D2R;
    const az = s * (90 - Math.min(1, bowK * 5) * 38) * D2R + v.yaw * 0.55;
    const dx = Math.cos(e) * Math.sin(az);
    const dy = -Math.sin(e) * Math.cos(v.alpha) + Math.cos(e) * Math.cos(az) * Math.sin(v.alpha);
    const len = Math.max(0.55, Math.hypot(dx, dy));
    const ang = Math.atan2(dy, dx);
    // 잎자루 — 갈림에서 바깥 위로 짧게 휘어 올라 잎몸이 시작된다
    const base: P = [fork[0] + Math.sin(az) * 24 + dx * 6, fork[1] - 13 + dy * 4];
    return { base, fork, ang, len, flipY: Math.cos(ang) < 0 ? -1 : 1, z: Math.cos(az), side: s };
  });
}

const Leaf: React.FC<{ d: LeafDraw; season: Season; idp: string; k: string }> = ({ d, season, idp, k }) => {
  const id = `${idp}-leaf${k}`;
  const Ls = season === 'spring' ? 0.74 : season === 'autumn' ? 0.95 : 1;
  const L = PLANT.leafL * Ls * d.len, Wd = PLANT.leafW * Ls * (season === 'spring' ? 0.95 : 1);
  const sh = leafShape(L, Wd, season === 'autumn' ? 0.42 : 0.08, season === 'autumn' ? 0.7 : 0, season === 'spring' ? 0.5 : 0);
  const tf = `translate(${f1(d.base[0])} ${f1(d.base[1])}) rotate(${f1(d.ang / D2R)}) scale(1 ${d.flipY})`;
  const veins: string[] = [];
  for (let i = 3; i <= 21; i += 3) {
    const a = sh.axis[i]!, u = sh.upper[Math.min(26, i + 4)]!, lo = sh.lower[Math.min(26, i + 4)]!;
    veins.push(`M ${f1(a[0])} ${f1(a[1])} Q ${f1((a[0] + u[0]) / 2 + 4)} ${f1((a[1] + u[1]) / 2 + 2)} ${f1(a[0] + (u[0] - a[0]) * 0.86)} ${f1(a[1] + (u[1] - a[1]) * 0.86)}`);
    veins.push(`M ${f1(a[0])} ${f1(a[1])} Q ${f1((a[0] + lo[0]) / 2 + 4)} ${f1((a[1] + lo[1]) / 2 - 2)} ${f1(a[0] + (lo[0] - a[0]) * 0.86)} ${f1(a[1] + (lo[1] - a[1]) * 0.86)}`);
  }
  const box = { x0: -10, y0: -Wd * 1.3, x1: L + 10, y1: Wd * 1.3 };
  const pet = `M ${f1(d.fork[0])} ${f1(d.fork[1] + 4)} Q ${f1(d.fork[0] + (d.base[0] - d.fork[0]) * 0.25)} ${f1(d.base[1] - 2)} ${f1(d.base[0] + Math.cos(d.ang) * 10)} ${f1(d.base[1] + Math.sin(d.ang) * 10)}`;
  return (
    <g>
    <path d={pet} stroke={INK} strokeWidth={14} fill="none" strokeLinecap="round" />
    <path d={pet} stroke="#ddd7cd" strokeWidth={7.5} fill="none" strokeLinecap="round" />
    <g transform={tf}>
      <defs><clipPath id={id}><path d={poly(sh.outline)} /></clipPath></defs>
      <path d={poly(sh.outline)} fill={LEAF[season]} />
      <Hatch clip={id} box={box} angle={-28} spacing={3.2} seed={`${id}a`} w={0.7} o={0.42} />
      <Hatch clip={id} box={{ ...box, y0: Wd * 0.1 }} angle={-40} spacing={2.8} seed={`${id}b`} w={0.7} o={0.36} />
      {season === 'autumn' ? <path d={poly(sh.outline)} fill={ACCENT} opacity={0.06} /> : null}
      <path d={poly(sh.axis.slice(1, 25), false)} fill="none" stroke={INK} strokeWidth={1.9} opacity={0.8} />
      <path d={veins.join(' ')} fill="none" stroke={INK2} strokeWidth={1.2} opacity={0.75} />
      <Ink pts={sh.outline} w={3.8} closed seed={`${id}o`} />
    </g>
    </g>
  );
};

/** 겨울 귀 = 맨 가지(눈 달린 잔가지·겨울눈). */
const Twig: React.FC<{ d: LeafDraw; idp: string; k: string }> = ({ d, idp, k }) => {
  const tf = `translate(${f1(d.base[0])} ${f1(d.base[1])}) rotate(${f1(d.ang / D2R)}) scale(1 ${d.flipY})`;
  const L = 185 * d.len;
  const main: P[] = Array.from({ length: 9 }, (_, i) => { const t = i / 8; return [t * L, -Math.sin(t * 2.2) * 10] as P; });
  const sides: Array<[P, P]> = [[[L * 0.42, -9], [L * 0.62, -50]], [[L * 0.66, -9], [L * 0.88, 22]], [[L * 0.25, -6], [L * 0.34, 28]]];
  const buds: P[] = [main[8]!, sides[0][1], sides[1][1], sides[2][1]];
  return (
    <g transform={tf}>
      <path d={poly(main, false)} stroke={INK} strokeWidth={13} fill="none" strokeLinecap="round" />
      <path d={poly(main, false)} stroke={POT_SHADE} strokeWidth={8} fill="none" strokeLinecap="round" />
      {sides.map(([a, b], i) => <path key={i} d={`M ${f1(a[0])} ${f1(a[1])} Q ${f1((a[0] + b[0]) / 2 + 6)} ${f1((a[1] + b[1]) / 2)} ${f1(b[0])} ${f1(b[1])}`} stroke={INK} strokeWidth={5} fill="none" strokeLinecap="round" />)}
      {buds.map((b, i) => <g key={i}><ellipse cx={b[0]} cy={b[1]} rx={7} ry={9.5} transform={`rotate(${i === 0 ? 90 : i === 1 ? -30 : 30} ${b[0]} ${b[1]})`} fill={POT_SHADE} stroke={INK} strokeWidth={2} /></g>)}
      <ellipse cx={main[8]![0] - 2} cy={main[8]![1] - 8} rx={10} ry={4} fill={SCLERA} stroke={INK} strokeWidth={1.2} opacity={0.9} />
      <Ink pts={main} w={1.4} seed={`${idp}tw${k}`} ghost={false} />
    </g>
  );
};

// ── 소품 ─────────────────────────────────────────────

const PropDraw: React.FC<{ a: ArmDraw; pose: Pose; idp: string }> = ({ a, pose, idp }) => {
  const k = smooth(pose.propAmt);
  if (k <= 0.01 || pose.prop === 'none') return null;
  const [x, y] = a.W;
  const hc = handXf(a.W, a.ang, a.flip)([ARM.handR * 0.8, 0]);
  const sc = 0.4 + 0.6 * k;
  const tilt = pose.propTilt;
  if (pose.prop === 'sign') {
    // 2026-10-23 — 휴대폰(16:9 가 세로 360px 남짓)에서도 읽히게 글자를 크게(로컬 64 → 본편 크기에서 화면 약 35px)
    const text = pose.propText.slice(0, 6);
    const w = Math.max(200, 56 + [...text].reduce((a, ch) => a + (/[\x20-\x7e]/.test(ch) ? 36 : 62), 0)), h = 112;
    return (
      <g opacity={Math.min(1, k * 1.5)} transform={`translate(${f1(hc[0])} ${f1(hc[1])}) rotate(${f1(tilt)}) scale(${f1(sc)})`}>
        <rect x={-6} y={-150} width={12} height={185} rx={4} fill="#d9cdb9" />
        <path d={hatch({ x0: -6, y0: -150, x1: 6, y1: 35 }, 80, 6, `${idp}st`)} stroke={INK2} strokeWidth={0.9} opacity={0.5} />
        <Ink pts={[[-6, 35], [-6, -150], [6, -150], [6, 35]]} w={2.8} closed seed={`${idp}sts`} />
        <g transform={`translate(0 ${-150 - h / 2 + 6})`}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={9} fill="#efe6d6" />
          {[0.28, 0.55, 0.8].map((t, i) => <path key={i} d={`M ${f1(-w / 2 + 8)} ${f1(-h / 2 + h * t)} q ${f1(w * 0.3)} ${f1(rn(idp, i) * 6)} ${f1(w - 16)} ${f1(rn(idp, i + 9) * 4)}`} stroke={SOFT} strokeWidth={1} fill="none" opacity={0.7} />)}
          <path d={hatch({ x0: 0, y0: -h / 2, x1: w / 2, y1: h / 2 }, 58, 6, `${idp}sb`)} stroke={INK2} strokeWidth={0.9} opacity={0.22} />
          <Ink pts={[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]} w={3.4} closed seed={`${idp}sbo`} />
          <circle cx={-w / 2 + 12} cy={-h / 2 + 12} r={2.6} fill={INK} /><circle cx={w / 2 - 12} cy={-h / 2 + 12} r={2.6} fill={INK} />
          <text x={0} y={22} textAnchor="middle" fontFamily={FONT_DODUM} fontSize={62} fill={INK} style={{ fontWeight: 700 }}>{text}</text>
        </g>
      </g>
    );
  }
  if (pose.prop === 'stick') {
    const L = 170 * sc;
    const ex = x + Math.cos(a.ang) * L, ey = y + Math.sin(a.ang) * L;
    return (
      <g opacity={Math.min(1, k * 1.5)}>
        <line x1={x - Math.cos(a.ang) * 14} y1={y - Math.sin(a.ang) * 14} x2={ex} y2={ey} stroke={INK} strokeWidth={9} strokeLinecap="round" />
        <line x1={x - Math.cos(a.ang) * 14} y1={y - Math.sin(a.ang) * 14} x2={ex} y2={ey} stroke="#d9cdb9" strokeWidth={5} strokeLinecap="round" />
        <circle cx={ex} cy={ey} r={6} fill={INK} />
      </g>
    );
  }
  if (pose.prop === 'magnifier') {
    const L = 58 * sc, R = 40 * sc;
    const ex = hc[0] + Math.cos(a.ang - 0.9 * a.flip) * L, ey = hc[1] + Math.sin(a.ang - 0.9 * a.flip) * L;
    const cx = ex + Math.cos(a.ang - 0.9 * a.flip) * R, cy = ey + Math.sin(a.ang - 0.9 * a.flip) * R;
    return (
      <g opacity={Math.min(1, k * 1.5)}>
        <line x1={hc[0]} y1={hc[1]} x2={ex} y2={ey} stroke={INK} strokeWidth={14} strokeLinecap="round" />
        <line x1={hc[0]} y1={hc[1]} x2={ex} y2={ey} stroke="#b8ab98" strokeWidth={9} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={R} fill={SCLERA} opacity={0.55} />
        <path d={`M ${f1(cx - R * 0.55)} ${f1(cy - R * 0.1)} A ${f1(R * 0.6)} ${f1(R * 0.6)} 0 0 1 ${f1(cx - R * 0.05)} ${f1(cy - R * 0.6)}`} stroke={SOFT} strokeWidth={3} fill="none" />
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={INK} strokeWidth={6.5} />
        <circle cx={cx} cy={cy} r={R - 4} fill="none" stroke={SOFT} strokeWidth={1.4} />
      </g>
    );
  }
  // 물뿌리개 — 손잡이를 쥐고 몸통은 손 아래
  const s = sc;
  const flipX = a.side === 'L' ? -1 : 1;
  return (
    <g opacity={Math.min(1, k * 1.5)} transform={`translate(${f1(hc[0])} ${f1(hc[1])}) rotate(${f1(tilt)}) scale(${f1(s * flipX)} ${f1(s)})`}>
      <path d="M -40 28 L 40 28 L 34 98 Q 0 106 -34 98 Z" fill="#dcdcd0" />
      <path d={hatch({ x0: 0, y0: 28, x1: 40, y1: 104 }, 60, 5.5, `${idp}can`)} stroke={INK2} strokeWidth={1} opacity={0.5} />
      <Ink pts={[[-40, 28], [40, 28], [34, 98], [0, 104], [-34, 98]]} w={3.2} closed seed={`${idp}cb`} />
      <path d="M -26 30 Q -24 -14 0 -14 Q 24 -14 26 30" fill="none" stroke={INK} strokeWidth={7} />
      <path d="M -26 30 Q -24 -14 0 -14 Q 24 -14 26 30" fill="none" stroke="#dcdcd0" strokeWidth={3} />
      <path d="M 36 70 L 92 26 L 98 34 L 40 84 Z" fill="#dcdcd0" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <ellipse cx={97} cy={28} rx={8} ry={12} transform="rotate(-50 97 28)" fill="#dcdcd0" stroke={INK} strokeWidth={2.6} />
    </g>
  );
};

// ── 효과 ─────────────────────────────────────────────

const Fx: React.FC<{ pose: Pose; frame: number; waveHand?: P; waveSide: number; top: P }> = ({ pose, frame, waveHand, waveSide, top }) => {
  const out: React.ReactNode[] = [];
  const pop = (k: number) => 0.6 + 0.4 * smooth(k * 1.4);
  if (pose.fxSweat > 0.01) {
    const k = pose.fxSweat, dy = ((frame % 40) / 40) * 10 * k;
    out.push(<g key="sw" opacity={k} transform={`translate(${f1(top[0] + 150)} ${f1(top[1] + 40 + dy)}) scale(${f1(pop(k))})`}>
      <path d="M 0 -20 Q 13 0 10 9 A 10 10 0 0 1 -10 9 Q -13 0 0 -20 Z" fill="#eef2f2" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <path d="M -4 2 Q -5 7 -1 9" stroke={SOFT} strokeWidth={1.6} fill="none" />
    </g>);
  }
  if (pose.fxQuestion > 0.01) {
    const k = pose.fxQuestion, bob = Math.sin(frame * 0.18) * 4;
    out.push(<g key="q" opacity={k} transform={`translate(${f1(top[0] + 175)} ${f1(top[1] - 150 + bob)}) rotate(12) scale(${f1(pop(k))})`}>
      <path d="M -14 -10 Q -14 -30 2 -30 Q 18 -30 17 -15 Q 16 -4 4 2 Q -2 6 -1 16" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      <circle cx={-1} cy={30} r={4.5} fill={INK} />
    </g>);
  }
  if (pose.fxExclaim > 0.01) {
    const k = pose.fxExclaim;
    out.push(<g key="ex" opacity={k} transform={`translate(${f1(top[0] + 168)} ${f1(top[1] - 150)}) rotate(10) scale(${f1(pop(k))})`}>
      <path d="M -5 -36 L 5 -36 L 2 12 L -2 12 Z" fill={INK} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={0} cy={26} r={5.5} fill={INK} />
    </g>);
    // 놀람 빗살(머리 양옆)
    out.push(<g key="exl" opacity={k} stroke={INK} strokeWidth={3} strokeLinecap="round">
      {[-1, 1].map((s) => [0, 1, 2].map((i) => {
        const a = (-90 + s * (38 + i * 17)) * D2R, r0 = 205 + 8 * k, r1 = 228 + 14 * k;
        return <line key={`${s}${i}`} x1={top[0] + Math.cos(a) * r0} y1={top[1] - 30 + Math.sin(a) * r0 * 0.75} x2={top[0] + Math.cos(a) * r1} y2={top[1] - 30 + Math.sin(a) * r1 * 0.75} />;
      }))}
    </g>);
  }
  if (pose.fxSparkle > 0.01) {
    const k = pose.fxSparkle;
    const at: P = waveHand ?? [top[0] - 150, top[1] - 60];
    [[0, 0, 1], [26, -30, 0.6], [-22, -38, 0.45]].forEach(([dx, dy, s], i) => {
      const tw = 0.75 + 0.25 * Math.sin(frame * 0.35 + i * 2);
      const r = 13 * s! * tw * pop(k);
      const cx = at[0] + waveSide * (34 + dx!), cy = at[1] - 30 + dy!;
      out.push(<path key={`sp${i}`} opacity={k} d={`M ${f1(cx)} ${f1(cy - r)} Q ${f1(cx + r * 0.18)} ${f1(cy - r * 0.18)} ${f1(cx + r)} ${f1(cy)} Q ${f1(cx + r * 0.18)} ${f1(cy + r * 0.18)} ${f1(cx)} ${f1(cy + r)} Q ${f1(cx - r * 0.18)} ${f1(cy + r * 0.18)} ${f1(cx - r)} ${f1(cy)} Q ${f1(cx - r * 0.18)} ${f1(cy - r * 0.18)} ${f1(cx)} ${f1(cy - r)} Z`} fill={SCLERA} stroke={INK} strokeWidth={2} strokeLinejoin="round" />);
    });
  }
  if (pose.fxWave > 0.01 && waveHand) {
    const k = pose.fxWave;
    out.push(<g key="wv" opacity={k} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round">
      {[0, 1, 2].map((i) => {
        const r = 34 + i * 11;
        const a0 = -0.95, a1 = 0.1;
        const cx = waveHand[0], cy = waveHand[1] - 6;
        const s = waveSide;
        return <path key={i} opacity={1 - i * 0.22} d={`M ${f1(cx + s * Math.cos(a0) * r)} ${f1(cy + Math.sin(a0) * r)} A ${r} ${r} 0 0 ${s > 0 ? 1 : 0} ${f1(cx + s * Math.cos(a1) * r)} ${f1(cy + Math.sin(a1) * r)}`} />;
      })}
    </g>);
  }
  if (pose.fxShake > 0.01) {
    const k = pose.fxShake;
    out.push(<g key="sh" opacity={k} stroke={INK} strokeWidth={2.6} strokeLinecap="round">
      {[-1, 1].map((s) => [0, 1].map((i) => <path key={`${s}${i}`} d={`M ${f1(s * (198 + i * 14))} ${f1(-170 - i * 22)} q ${f1(s * 6)} 14 0 28`} fill="none" />))}
    </g>);
  }
  if (pose.fxLaugh > 0.01) {
    const k = pose.fxLaugh;
    out.push(<g key="lg" opacity={k} stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none">
      {[-1, 1].map((s) => [0, 1, 2].map((i) => {
        const a = (-90 + s * (60 + i * 14)) * D2R, r0 = 185, r1 = 205 + 6 * Math.sin(frame * 0.5 + i);
        return <line key={`${s}${i}`} x1={Math.cos(a) * r0} y1={-250 + Math.sin(a) * r0 * 0.6} x2={Math.cos(a) * r1} y2={-250 + Math.sin(a) * r1 * 0.6} />;
      }))}
    </g>);
  }
  return <g>{out}</g>;
};

// ── 전체 ─────────────────────────────────────────────

export type BioneeProps = {
  pose: Pose;
  season?: Season;
  /** 정의 id 앞머리(같은 SVG 안 여러 비온이면 서로 다르게) */
  idp?: string;
  /** 바람·펄럭임·효과 깜빡임용 프레임(결정적) */
  frame?: number;
  /** 흑연 결 필터(떨림+결). 기본 켬. */
  texture?: boolean;
  /** 땅 그림자. 기본 켬. */
  shadow?: boolean;
  /** 추가 배율(pose.size 에 곱함) */
  scale?: number;
};

/** 비온이 한 명 — 무대 좌표 (pose.x, pose.y) 에 발을 딛고 선다. SVG 안에 넣는다. */
export const Bionee: React.FC<BioneeProps> = ({ pose, season = 'summer', idp = 'bn', frame = 0, texture = true, shadow = true, scale = 1 }) => {
  // 숙임(pitch)은 정면일수록 '앞으로 숙여 위가 보임', 옆모습일수록 '기울기'로.
  const at = Math.abs(pose.turn);
  const pitchEff = pose.pitch * (1 - at);
  const leanEff = pose.lean + pose.pitch * Math.sign(pose.turn) * at * 40;
  const v = makeView(pose.turn, pitchEff);
  const faceAz = pose.lookX * 6;
  const body = bodyOutline(v);
  const rim = rimOutline(v);
  const top = ringEllipse(v, RIM.h1, rimR1());
  const inner = ringEllipse(v, RIM.h1, RIM.rIn);
  const soil = ringEllipse(v, RIM.soilH, RIM.rIn - 4);
  const R = bodyR(200);

  // 줄기(+ 늦게 따라옴)
  const base = proj(v, 0, PLANT.baseH, 0);
  // 꾸벅(앞으로 숙임)이면 줄기·떡잎이 카메라 쪽으로 넘어와 화분 입구(흙)를 덮는다(2026-10-23 다듬기)
  const bowK = Math.max(0, pose.pitch);
  const forkRaw = proj(v, 0, PLANT.forkH - bowK * 40, bowK * 190);
  const fork: P = [forkRaw[0] + pose.lagX, forkRaw[1] + pose.lagY];
  const bumpRaw = proj(v, 0, PLANT.bumpH - bowK * 10, bowK * 80);
  const bump: P = [bumpRaw[0] + pose.lagX * 0.55, bumpRaw[1] + pose.lagY * 0.5];
  const stemPts: P[] = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const c: P = [(base[0] + fork[0]) / 2 + pose.lagX * 0.1, (base[1] + fork[1]) / 2];
    return [(1 - t) * (1 - t) * base[0] + 2 * (1 - t) * t * c[0] + t * t * fork[0], (1 - t) * (1 - t) * base[1] + 2 * (1 - t) * t * c[1] + t * t * fork[1]] as P;
  });
  const wind: [number, number] = [Math.sin(frame * 0.071) * 2.4 + Math.sin(frame * 0.193 + 1) * 1.1, Math.sin(frame * 0.064 + 2) * 2.2 + Math.sin(frame * 0.177) * 1.2];
  const flapA = pose.flap * 18 * Math.sin(frame * 0.68);
  const leaves = leafDraws(v, pose, fork, season, wind, flapA, bowK);

  // 팔
  const armL = armDraw(v, 'L', pose.armL);
  const armR = armDraw(v, 'R', pose.armR);
  const arms = [armL, armR];
  const far = arms.filter((a) => a.z < -0.5);
  const near = arms.filter((a) => a.z >= -0.5);
  const propArm = pose.propSide === 'L' ? armL : armR;
  const armNode = (a: ArmDraw) => <ArmHand key={a.side} a={a} idp={idp} scale={a.z < -0.5 ? 0.94 : 1} behindProp={a === propArm ? <PropDraw a={a} pose={pose} idp={idp} /> : null} />;
  const waveArm = pose.fxWave > 0.01 ? (pose.armL.y < pose.armR.y ? armL : armR) : pose.armL.y < pose.armR.y ? armL : armR;

  const bootList = boots(v, pose);
  const id = (s: string) => `${idp}-${s}`;
  const sx = 1 + pose.squash * 0.5, sy = 1 - pose.squash;
  const k = (pose.size ?? 1) * scale;
  const shadowK = 1 / (1 + Math.max(0, pose.lift) / 120);
  const shadowO = pose.lift < -5 ? 0 : 1;

  // 몸통·테두리 빗금(몸 모양 따라)
  const bodyHatch = formHatch(v, bodyR, { h0: BODY_H0 + 4, h1: BODY_H1 - 4, step: 4.3, a0: -0.25, a1: 1.5, seed: id('bfh'), merid: [0.92, 1.52, 0.055] });
  const rimHatch = formHatch(v, (h) => rimR(h) + 0.5, { h0: RIM.h0 + 4, h1: RIM.h1 - 3, step: 4.2, a0: 0.15, a1: 1.52, seed: id('rfh'), merid: [1.05, 1.52, 0.06] });
  const rimLower = rim.lower;
  const shadowBand: P[] = [...rimLower, ...rimLower.slice().reverse().map((p) => [p[0], p[1] + 20] as P)];

  const winter = season === 'winter';
  return (
    <g transform={`translate(${f1(pose.x)} ${f1(pose.y)}) scale(${k})`}>
      <defs>
        <filter id={id('pen')} filterUnits="userSpaceOnUse" x={-520} y={-820} width={1040} height={960}>
          <feTurbulence type="fractalNoise" baseFrequency={0.032} numOctaves={2} seed={7} result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale={3.2} xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency={0.62} numOctaves={2} seed={3} result="g" />
          <feColorMatrix in="g" type="matrix" values="0.34 0 0 0 0.73  0.34 0 0 0 0.73  0.34 0 0 0 0.71  0 0 0 0 1" result="gg" />
          <feBlend in="d" in2="gg" mode="multiply" result="m" />
          <feComposite in="m" in2="d" operator="in" />
        </filter>
        <filter id={id('soft')} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={2.2} /></filter>
        <filter id={id('blur')} x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation={7} /></filter>
        <radialGradient id={id('sh')}><stop offset={0} stopColor="#5d5952" stopOpacity={0.42} /><stop offset={0.6} stopColor="#5d5952" stopOpacity={0.22} /><stop offset={1} stopColor="#5d5952" stopOpacity={0} /></radialGradient>
        <linearGradient id={id('potg')} gradientUnits="userSpaceOnUse" x1={-R} y1={-RIM.h0} x2={R} y2={-20}>
          <stop offset={0} stopColor={POT_LIGHT} /><stop offset={0.5} stopColor={POT} /><stop offset={1} stopColor={POT_SHADE} />
        </linearGradient>
        <linearGradient id={id('hm')} gradientUnits="userSpaceOnUse" x1={-R * 0.15} y1={-RIM.h0} x2={R * 0.95} y2={-30}>
          <stop offset={0} stopColor="#fff" stopOpacity={0} /><stop offset={0.55} stopColor="#fff" stopOpacity={0.7} /><stop offset={1} stopColor="#fff" stopOpacity={1} />
        </linearGradient>
        <mask id={id('hmask')} maskUnits="userSpaceOnUse" x={-300} y={-600} width={600} height={700}><rect x={-300} y={-600} width={600} height={700} fill={`url(#${id('hm')})`} /></mask>
        <radialGradient id={id('hm2')} gradientUnits="userSpaceOnUse" cx={R * 0.95} cy={-40} r={R * 1.05}>
          <stop offset={0} stopColor="#fff" stopOpacity={1} /><stop offset={0.55} stopColor="#fff" stopOpacity={0.55} /><stop offset={1} stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <mask id={id('hmask2')} maskUnits="userSpaceOnUse" x={-300} y={-600} width={600} height={700}><rect x={-300} y={-600} width={600} height={700} fill={`url(#${id('hm2')})`} /></mask>
        <clipPath id={id('body')}><path d={poly(body.pts)} /></clipPath>
        <clipPath id={id('rim')}><path d={poly(rim.pts)} /></clipPath>
        <clipPath id={id('band')}><path d={poly(shadowBand)} /></clipPath>
      </defs>
      {shadow && shadowO > 0 ? (
        <g>
          <ellipse cx={30} cy={4} rx={190 * shadowK} ry={22 * shadowK} fill={`url(#${id('sh')})`} filter={`url(#${id('blur')})`} />
          <ellipse cx={12} cy={2} rx={130 * shadowK} ry={9 * shadowK} fill="#5d5952" opacity={0.22 * shadowK} filter={`url(#${id('blur')})`} />
        </g>
      ) : null}
      <g transform={`translate(0 ${f1(-pose.lift - LEG_GAP)}) rotate(${f1(leanEff)}) scale(${f1(sx)} ${f1(sy)})`}>
        <g filter={texture ? `url(#${id('pen')})` : undefined}>
          {far.map(armNode)}
          <g transform={`translate(0 ${LEG_GAP})`}>{bootList.map(({ k: kk, b }) => <Boot key={kk} b={b} idp={idp} k={kk} winter={winter} leg />)}</g>
          {/* 몸통 */}
          <path d={poly(body.pts)} fill={`url(#${id('potg')})`} />
          <g clipPath={`url(#${id('body')})`}>
            {/* 2026-10-23 다듬기 — 옅은 결(H) + 몸 따라 도는 호(그늘 쪽) + 오른쪽 가장자리 경선(2B) + 테 밑 그림자 띠 */}
            <path d={hatch({ x0: -R - 10, y0: -RIM.h0 - 10, x1: R + 10, y1: 10 }, 64, 3.4, id('bh0'))} stroke={SOFT} strokeWidth={0.5} opacity={0.3} />
            <g mask={`url(#${id('hmask')})`}><path d={bodyHatch.rings} stroke={INK2} strokeWidth={0.7} fill="none" opacity={0.42} strokeLinecap="round" /></g>
            <g mask={`url(#${id('hmask2')})`}><path d={bodyHatch.merid} stroke={INK2} strokeWidth={0.65} fill="none" opacity={0.34} strokeLinecap="round" /></g>
            <g clipPath={`url(#${id('band')})`}><path d={hatch({ x0: -R - 20, y0: -RIM.h0 - 40, x1: R + 20, y1: -RIM.h0 + 60 }, 72, 2.3, id('bh3'))} stroke={INK2} strokeWidth={0.7} opacity={0.5} /></g>
          </g>
          <Ink pts={body.lower} w={4.6} seed={id('bo')} />
          {/* 얼굴(몸통 안으로 자름) */}
          <g clipPath={`url(#${id('body')})`}><Face v={v} pose={pose} idp={idp} faceAz={faceAz + pose.turn * 90 * 0} /></g>
          {/* 테두리 띠 */}
          <path d={poly(rim.pts)} fill={`url(#${id('potg')})`} />
          <g clipPath={`url(#${id('rim')})`}>
            <path d={hatch({ x0: -rimR1() - 10, y0: top.cy - 60, x1: rimR1() + 10, y1: -RIM.h0 + 30 }, 64, 3.4, id('rh0'))} stroke={SOFT} strokeWidth={0.5} opacity={0.3} />
            <g mask={`url(#${id('hmask')})`}><path d={rimHatch.rings} stroke={INK2} strokeWidth={0.7} fill="none" opacity={0.42} strokeLinecap="round" /></g>
            <g mask={`url(#${id('hmask2')})`}><path d={rimHatch.merid} stroke={INK2} strokeWidth={0.6} fill="none" opacity={0.3} strokeLinecap="round" /></g>
            <path d={poly(ellipseArc({ ...ringEllipse(v, RIM.h0 + 14, rimR1()), }, 0.05, Math.PI - 0.05), false)} fill="none" stroke={SOFT} strokeWidth={1.6} opacity={0.6} />
          </g>
          <Ink pts={rim.lower} w={4.4} seed={id('ro')} />
          <Ink pts={[rim.upper[0]!, rim.lower[0]!]} w={3.8} seed={id('rl')} ghost={false} />
          <Ink pts={[rim.upper[rim.upper.length - 1]!, rim.lower[rim.lower.length - 1]!]} w={4.4} seed={id('rr')} ghost={false} />
          {/* 위(입구·흙) */}
          <ellipse cx={top.cx} cy={top.cy} rx={top.rx} ry={top.ry} fill={POT_LIGHT} />
          <ellipse cx={inner.cx} cy={inner.cy} rx={inner.rx} ry={inner.ry} fill={INSIDE} />
          <g>
            <defs><clipPath id={id('open')}><ellipse cx={inner.cx} cy={inner.cy} rx={inner.rx} ry={inner.ry} /></clipPath></defs>
            <g clipPath={`url(#${id('open')})`}>
              <ellipse cx={soil.cx} cy={soil.cy + 2} rx={soil.rx} ry={soil.ry + 3} fill={SOIL} />
              {pebbles(soil, idp)}
              {winter ? <ellipse cx={soil.cx} cy={soil.cy + 1} rx={soil.rx * 0.98} ry={soil.ry * 1.1} fill={SCLERA} opacity={0.88} /> : null}
              <path d={hatch({ x0: -inner.rx, y0: inner.cy - inner.ry, x1: inner.rx, y1: inner.cy + inner.ry }, 20, 4, id('ih'))} stroke={INK} strokeWidth={0.9} opacity={0.35} />
            </g>
          </g>
          <Ink pts={ellipseArc(inner, Math.PI, 2 * Math.PI, 30)} w={2.6} seed={id('in1')} />
          <Ink pts={ellipseArc(inner, 0, Math.PI, 30)} w={2.2} seed={id('in2')} />
          <Ink pts={ellipseArc(top, 0, 2 * Math.PI, 60)} w={4.2} closed seed={id('top')} />
          {winter ? <SnowRim top={top} inner={inner} idp={idp} /> : null}
          {/* 식물 */}
          {leaves.filter((d) => d.z < 0).map((d) => (winter ? <Twig key={d.side} d={d} idp={idp} k={`${d.side}`} /> : <Leaf key={d.side} d={d} season={season} idp={idp} k={`${d.side}`} />))}
          <Stem pts={stemPts} bump={bump} idp={idp} winter={winter} />
          {season === 'spring' ? <SpringBud at={fork} idp={idp} /> : null}
          {leaves.filter((d) => d.z >= 0).map((d) => (winter ? <Twig key={d.side} d={d} idp={idp} k={`${d.side}`} /> : <Leaf key={d.side} d={d} season={season} idp={idp} k={`${d.side}`} />))}
          {season === 'autumn' ? <Persimmon at={[bump[0] + 30, bump[1] - 4]} idp={idp} frame={frame} /> : null}
          {near.map(armNode)}
          <Fx pose={pose} frame={frame} waveHand={waveArm.W} waveSide={waveArm.side === 'L' ? -1 : 1} top={[0, top.cy]} />
        </g>
      </g>
      {season === 'autumn' ? <FallingLeaf frame={frame} idp={idp} /> : null}
    </g>
  );
};

const rimR1 = () => 176;
/** 화분을 장화 위로 띄우는 높이(2026-10-23 다듬기 — 장화 목·테 띠가 화분 밑에 묻히지 않게). */
export const LEG_GAP = 18;

function pebbles(soil: { cx: number; cy: number; rx: number; ry: number }, idp: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < 26; i++) {
    const a = rn('peb', i) * 2 * Math.PI, rr = Math.sqrt(rn('peb', `r${i}`) + 0.5);
    const x = soil.cx + Math.cos(a) * soil.rx * rr * 0.92, y = soil.cy + Math.sin(a) * soil.ry * rr * 0.85;
    const r = 6 + (rn('peb', `s${i}`) + 0.5) * 7;
    out.push(<ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.6} fill={i % 3 ? PEBBLE : '#5a524b'} opacity={0.85} />);
  }
  return <g key={`${idp}-peb`}>{out}</g>;
}

const Stem: React.FC<{ pts: P[]; bump: P; idp: string; winter: boolean }> = ({ pts, bump, idp, winter }) => {
  // 줄기 관 — 밑이 굵고 위로 가늘게
  const n = pts.length;
  const L: P[] = [], Rr: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const w = (22 - 6 * (i / (n - 1))) / 2;
    L.push([pts[i]![0] - (dy / len) * w, pts[i]![1] + (dx / len) * w]);
    Rr.push([pts[i]![0] + (dy / len) * w, pts[i]![1] - (dx / len) * w]);
  }
  const id = `${idp}-stem`;
  return (
    <g>
      <defs><clipPath id={id}><path d={poly([...L, ...Rr.slice().reverse()])} /></clipPath></defs>
      <path d={poly([...L, ...Rr.slice().reverse()])} fill={winter ? POT_SHADE : '#ddd7cd'} />
      <g clipPath={`url(#${id})`}><path d={hatch({ x0: pts[0]![0] - 2, y0: pts[n - 1]![1] - 10, x1: pts[0]![0] + 16, y1: pts[0]![1] + 4 }, 80, 3.4, `${id}h`)} stroke={INK2} strokeWidth={1} opacity={0.6} /></g>
      <Ink pts={L} w={3.4} seed={`${id}l`} />
      <Ink pts={Rr} w={3.8} seed={`${id}r`} />
      <ellipse cx={bump[0]} cy={bump[1]} rx={17} ry={19} fill="#ddd7cd" />
      <path d={`M ${f1(bump[0] + 3)} ${f1(bump[1] - 17)} A 17 19 0 0 1 ${f1(bump[0] + 3)} ${f1(bump[1] + 17)}`} fill="none" stroke={INK2} strokeWidth={5} opacity={0.35} />
      <ellipse cx={bump[0]} cy={bump[1]} rx={17} ry={19} fill="none" stroke={INK} strokeWidth={3.4} />
      <path d={`M ${f1(bump[0] - 7)} ${f1(bump[1] - 8)} q 3 -4 7 -4`} stroke={SCLERA} strokeWidth={2.4} fill="none" opacity={0.8} />
    </g>
  );
};

const SpringBud: React.FC<{ at: P; idp: string }> = ({ at, idp }) => (
  <g>
    <path d={`M ${f1(at[0])} ${f1(at[1] + 4)} Q ${f1(at[0] + 3)} ${f1(at[1] - 18)} ${f1(at[0] + 1)} ${f1(at[1] - 34)}`} stroke={INK} strokeWidth={6} fill="none" strokeLinecap="round" />
    <path d={`M ${f1(at[0] + 1)} ${f1(at[1] - 30)} c -12 -6 -12 -24 1 -34 c 12 10 12 28 -1 34 Z`} fill="#e7e3d9" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
    <path d={`M ${f1(at[0] + 1)} ${f1(at[1] - 33)} l 0 -24`} stroke={INK2} strokeWidth={1.2} />
    <Ink pts={[[at[0] - 8, at[1] - 40], [at[0] - 2, at[1] - 56]]} w={1.2} seed={`${idp}bud`} ghost={false} />
  </g>
);

const Persimmon: React.FC<{ at: P; idp: string; frame: number }> = ({ at, idp, frame }) => {
  const sw = Math.sin(frame * 0.09) * 4;
  return (
    <g transform={`rotate(${f1(sw)} ${f1(at[0] - 10)} ${f1(at[1] - 10)})`}>
      <path d={`M ${f1(at[0] - 16)} ${f1(at[1] - 12)} Q ${f1(at[0] - 2)} ${f1(at[1] - 14)} ${f1(at[0])} ${f1(at[1] + 6)}`} stroke={INK} strokeWidth={3} fill="none" />
      <ellipse cx={at[0]} cy={at[1] + 26} rx={22} ry={20} fill={ACCENT} />
      <path d={hatch({ x0: at[0] - 22, y0: at[1] + 6, x1: at[0] + 22, y1: at[1] + 46 }, 60, 3.6, `${idp}ps`)} stroke={ACCENT_DARK} strokeWidth={1.1} opacity={0.5} clipPath={undefined} />
      <ellipse cx={at[0] - 7} cy={at[1] + 19} rx={5} ry={3.5} fill="#f7c2b0" opacity={0.9} />
      <ellipse cx={at[0]} cy={at[1] + 26} rx={22} ry={20} fill="none" stroke={INK} strokeWidth={3} />
      <path d={`M ${f1(at[0] - 13)} ${f1(at[1] + 9)} l 13 -4 l 13 4 l -7 3 l -6 -3 l -6 3 Z`} fill={INK2} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
    </g>
  );
};

/** 가을 — 감잎 한 장이 귀 옆에서 떨어진다(2026-10-23 다듬기: 본편 크기에서 씨앗처럼 보이던 작은 점을 감빛 잎 모양으로 — 크게, 잎맥, 뒤집히며 흔들려 내려옴). */
const FallingLeaf: React.FC<{ frame: number; idp: string }> = ({ frame, idp }) => {
  const T = 150, t = (frame % T) / T;
  const x = 190 + t * 120 + Math.sin(t * 7.5) * 38, y = -440 + t * 440;
  const o = Math.min(1, t * 6) * Math.min(1, (1 - t) * 5);
  const sh = leafShape(74, 25, 0.12, 0.2);
  const flipX = Math.cos(t * 9.4); // 뒤집히며 떨어진다(앞면·뒷면 번갈아)
  const tone = flipX > 0 ? LEAF_AUTUMN_FRONT : LEAF_AUTUMN_BACK;
  return (
    <g opacity={o} transform={`translate(${f1(x)} ${f1(y)}) rotate(${f1(Math.sin(t * 6) * 55 + 25)}) scale(1 ${f1(0.25 + 0.75 * Math.abs(flipX))}) translate(-37 0)`}>
      <path d={poly(sh.outline)} fill={tone} />
      <defs><clipPath id={`${idp}-flc`}><path d={poly(sh.outline)} /></clipPath></defs>
      <path d={hatch({ x0: 0, y0: -26, x1: 74, y1: 26 }, -35, 4, `${idp}flh`)} stroke={ACCENT_DARK} strokeWidth={0.8} opacity={0.35} clipPath={`url(#${idp}-flc)`} />
      <path d={poly(sh.axis, false)} stroke={INK2} strokeWidth={1.6} fill="none" />
      {[0.3, 0.55, 0.78].map((k, i) => { const a = sh.axis[Math.round(k * 26)]!; return <path key={i} d={`M ${f1(a[0])} ${f1(a[1])} l ${f1(10)} ${f1(-10)} M ${f1(a[0])} ${f1(a[1])} l ${f1(10)} ${f1(9)}`} stroke={INK2} strokeWidth={1} opacity={0.7} />; })}
      <Ink pts={sh.outline} w={2.6} closed seed={`${idp}fl`} ghost={false} />
    </g>
  );
};

const SnowRim: React.FC<{ top: { cx: number; cy: number; rx: number; ry: number }; inner: { cx: number; cy: number; rx: number; ry: number }; idp: string }> = ({ top, inner, idp }) => {
  // 테두리 위에 소복이 — 테두리 띠(바깥 타원 - 안 타원) 위를 덮고, 앞쪽 가장자리는 몽글몽글
  const N = 40;
  const front: P[] = Array.from({ length: N + 1 }, (_, i) => {
    const t = (Math.PI * i) / N;
    const bump = Math.abs(Math.sin(i * 0.95 + 0.4)) * 5 + (rn(idp, `sb${i}`) + 0.5) * 2.5;
    return [top.cx + Math.cos(t) * (top.rx + 3), top.cy + Math.sin(t) * (top.ry + 2) - 9 + bump] as P;
  });
  const back: P[] = Array.from({ length: N + 1 }, (_, i) => { const t = Math.PI + (Math.PI * i) / N; return [top.cx + Math.cos(t) * (top.rx + 2), top.cy + Math.sin(t) * (top.ry + 2) - 9] as P; });
  const innerUp: P[] = Array.from({ length: N + 1 }, (_, i) => { const t = (2 * Math.PI * i) / N; return [inner.cx + Math.cos(t) * inner.rx * 0.97, inner.cy + Math.sin(t) * inner.ry * 0.97 - 6] as P; });
  const cap = `${poly([...front.slice().reverse(), ...back.slice().reverse()].reverse())} ${poly(innerUp)}`;
  return (
    <g>
      <path d={cap} fill={SCLERA} fillRule="evenodd" />
      <Ink pts={front} w={2.4} seed={`${idp}snf`} />
      <Ink pts={back} w={1.6} seed={`${idp}snb`} o={0.7} />
      <path d={poly(front.map((p) => [p[0] + 2, p[1] + 5] as P), false)} stroke={SOFT} strokeWidth={1.2} fill="none" opacity={0.6} />
    </g>
  );
};

// ── 시트용 낱개 ───────────────────────────────────────

/** 손 하나 크게(시트) — 손목 (x,y), 각(도), 모양. */
export const HandSolo: React.FC<{ x: number; y: number; ang: number; hand: Arm['hand']; side?: Side; scale?: number; idp: string }> = ({ x, y, ang, hand, side = 'R', scale = 3, idp }) => {
  const a = (ang * Math.PI) / 180;
  const s = side === 'L' ? -1 : 1;
  const W: P = [0, 0];
  const pts: P[] = Array.from({ length: 6 }, (_, i) => [-(1 - i / 5) * 22 * Math.cos(a), -(1 - i / 5) * 22 * Math.sin(a)] as P);
  const arm: Arm = { x: 0, y: 0, hand, roll: 0, bend: 0, dirW: 0, dir: 0 };
  const d: ArmDraw = { side, S: pts[0]!, E: pts[3]!, W, ang: a, flip: autoFlip(hand, a, s as -1 | 1), pts, z: 1, arm };
  return <g transform={`translate(${x} ${y}) scale(${scale})`}><ArmHand a={d} idp={idp} /></g>;
};

/** 장화 하나 크게(시트). */
export const BootSolo: React.FC<{ x: number; y: number; turn: number; toeUp?: number; lift?: number; squash?: number; winter?: boolean; scale?: number; idp: string }> = ({ x, y, turn, toeUp = 0, lift = 0, squash = 0, winter = false, scale = 3, idp }) => {
  const v = makeView(turn, 0);
  const b = bootGeom(v, { cx: 0, cz: 0, lift, fwd: 0, toeUp, squash });
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={8} cy={2} rx={42} ry={6} fill="#5d5952" opacity={0.18} />
      <Boot b={b} idp={idp} k="s" winter={winter} />
    </g>
  );
};
