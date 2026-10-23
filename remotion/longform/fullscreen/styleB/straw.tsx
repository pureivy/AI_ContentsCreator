// 스타일 B 짚 감싸기(2026-10-23 B4) — 실제 월동 짚싸기 모양: 볏짚 다발을 줄기에 세로로 둘러 세우고, 위·가운데·아래 세 곳을 새끼줄로 묶는다.
// 묶은 곳은 잘록, 그 사이는 짚이 부풀고, 위·아래 끝은 묶음 밖으로 짚 끝이 흩어져 삐죽 나온다. 원통에 가로 띠를 두른 모양 금지.
// 짚은 가는 세로 선 다발(밝은 쪽 H 성기게 → 그늘 쪽 2B 촘촘), 새끼줄은 꼬인 줄(비스듬한 짧은 마디).
import React from 'react';
import { random } from 'remotion';
import { smoothOpen } from '../geomHand';
import type { P } from '../geom';
import { Accent, PB, PLine, TONE } from './pencil';

const f1 = (n: number) => n.toFixed(1);

/**
 * 짚 감싸기 — 줄기 가운데 x, 아래 y1(땅 가까이)·위 y0, 다발 너비 w(줄기 굵기 + 20~30). p = 아래에서 위로 감아 올라가는 진행(0~1).
 * hi = 포인트 색(말할 때만). 옛 StrawWrap 과 같은 props.
 */
export const BStrawWrap: React.FC<{ x: number; y0: number; y1: number; w: number; p?: number; hi?: number; o?: number; seed?: string }> = ({ x, y0, y1, w, p = 1, hi = 0, o = 1, seed = 'sw' }) => {
  if (p <= 0 || o <= 0) return null;
  const H = (y1 - y0) * Math.min(1, p);
  const top = y1 - H;
  const R = (k: string) => random(`${seed}:${k}`);
  // 묶는 자리(전체 높이 기준 — 위 12%·가운데·아래 12%) 중 이미 감긴 높이 안의 것만
  const tiesAll = [0.12, 0.5, 0.88].map((k) => y0 + (y1 - y0) * k);
  const ties = tiesAll.filter((ty) => ty > top + 8);
  // 반폭(y) — 묶은 곳 잘록(0.78), 사이는 부풂(1.04), 위·아래 끝은 묶음 밖에서 살짝 벌어짐
  const half = (y: number) => {
    const t = (y - y0) / Math.max(1, y1 - y0);
    let v = 0.5 * w;
    let pinch = 0;
    for (const k of [0.12, 0.5, 0.88]) pinch = Math.max(pinch, Math.exp(-(((t - k) / 0.055) ** 2)));
    v *= 1.04 - 0.26 * pinch;
    if (t < 0.12) v *= 1 + (0.12 - t) * 1.1; // 위 끝 벌어짐
    if (t > 0.88) v *= 1 + (t - 0.88) * 1.4; // 아래 끝 벌어짐
    return v;
  };
  const N = 26;
  const ys = Array.from({ length: N + 1 }, (_, i) => top + (H * i) / N);
  const L: P[] = ys.map((y, i) => [x - half(y) + (R(`jl${i}`) - 0.5) * 1.6, y]);
  const Rt: P[] = ys.map((y, i) => [x + half(y) + (R(`jr${i}`) - 0.5) * 1.6, y]);
  const body = `${smoothOpen([...L])} L ${f1(Rt[N]![0])} ${f1(Rt[N]![1])} ${smoothOpen([...Rt].reverse()).replace(/^M [^C]+/, '')} Z`;
  // 짚 줄기 — 가는 세로 선(다발 둘레 위치 u: −1 왼 ~ 1 오른). 묶음 사이 부푼 모양을 따라 휜다. 그늘(오른쪽) 쪽 촘촘·짙게.
  const strawH: string[] = [], straw2: string[] = [];
  const nS = Math.max(14, Math.round(w / 2.6));
  for (let i = 0; i < nS; i++) {
    const u = -0.96 + (1.92 * (i + R(`su${i}`) * 0.6)) / nS;
    const yA = top + (R(`sa${i}`) < 0.5 ? 0 : R(`sb${i}`) * H * 0.4);
    const yB = y1 - (R(`sc${i}`) < 0.6 ? 0 : R(`sd${i}`) * H * 0.35);
    if (yB - yA < 10) continue;
    const pts: P[] = [];
    for (let k = 0; k <= 8; k++) { const y = yA + ((yB - yA) * k) / 8; pts.push([x + Math.sin((u * Math.PI) / 2) * half(y) * 0.96 + (R(`sw${i}${k}`) - 0.5) * 1.1, y]); }
    const d = smoothOpen(pts);
    if (u > 0.15 || i % 2 === 0) (u > 0.35 ? straw2 : strawH).push(d);
  }
  // 위·아래 흩어진 짚 끝 — 묶음 밖으로 부채꼴(위는 위·바깥, 아래는 땅 쪽·바깥), 길이·각 제각각
  const tips: string[] = [];
  const fan = (yy: number, dir: -1 | 1, n: number, len: number, key: string) => {
    for (let i = 0; i < n; i++) {
      const u = -1 + (2 * (i + R(`${key}u${i}`) * 0.7)) / n;
      const bx = x + u * half(yy) * 0.95;
      const ang = u * 0.55 + (R(`${key}a${i}`) - 0.5) * 0.5; // 바깥으로 벌어짐
      const l = len * (0.45 + R(`${key}l${i}`) * 0.75);
      const ex = bx + Math.sin(ang) * l, ey = yy + dir * Math.cos(ang) * l;
      const mx = (bx + ex) / 2 + (R(`${key}m${i}`) - 0.5) * 3, my = (yy + ey) / 2;
      tips.push(`M ${f1(bx)} ${f1(yy)} Q ${f1(mx)} ${f1(my)} ${f1(ex)} ${f1(ey)}`);
    }
  };
  fan(top + 2, -1, Math.round(nS * 0.8), Math.max(10, w * 0.32), 'ft');
  if (p >= 0.98) fan(y1 - 2, 1, Math.round(nS * 0.6), Math.max(6, w * 0.16), 'fb');
  // 그늘 — 오른쪽 1/3 에 둘레를 감는 짧은 호(H), 묶음 바로 위·아래 잘록한 자리엔 2B 짧은 그늘
  const shade: string[] = [];
  for (let y = top + 6; y < y1 - 4; y += 4.2) {
    const hw = half(y);
    shade.push(`M ${f1(x + hw * 0.42)} ${f1(y)} Q ${f1(x + hw * 0.8)} ${f1(y + 1.6)} ${f1(x + hw * 0.97)} ${f1(y + 0.4)}`);
  }
  // 새끼줄 — 묶은 자리마다 두 가닥 꼰 줄: 위·아래 테두리(살짝 아래로 휜 호 = 위에서 본 둘레) + 비스듬한 꼬임 마디
  const rope = (ty: number, i: number) => {
    const hw = half(ty) * 1.02, rh = Math.max(4.5, w * 0.075);
    const sag = Math.max(2, w * 0.05);
    const arc = (dy: number) => `M ${f1(x - hw)} ${f1(ty + dy)} Q ${f1(x)} ${f1(ty + dy + sag * 2)} ${f1(x + hw)} ${f1(ty + dy)}`;
    const band = `M ${f1(x - hw)} ${f1(ty - rh / 2)} Q ${f1(x)} ${f1(ty - rh / 2 + sag * 2)} ${f1(x + hw)} ${f1(ty - rh / 2)} L ${f1(x + hw)} ${f1(ty + rh / 2)} Q ${f1(x)} ${f1(ty + rh / 2 + sag * 2)} ${f1(x - hw)} ${f1(ty + rh / 2)} Z`;
    const twists: string[] = [];
    const nT = Math.max(5, Math.round((hw * 2) / (rh * 0.9)));
    for (let k = 0; k <= nT; k++) {
      const u = -1 + (2 * k) / nT;
      const xx = x + u * hw * 0.98;
      const yc = ty + sag * 2 * (1 - u * u) * 0.5; // 호 따라
      twists.push(`M ${f1(xx - rh * 0.45)} ${f1(yc + rh * 0.5)} Q ${f1(xx)} ${f1(yc + rh * 0.1)} ${f1(xx + rh * 0.4)} ${f1(yc - rh * 0.5)}`);
    }
    // 매듭 — 한쪽(왼쪽 앞)에 작은 매듭 + 늘어진 끝 둘
    const kx = x - hw * 0.55 + (i % 2) * hw * 0.9, ky = ty + sag * 1.4;
    const knot = `M ${f1(kx - rh * 0.5)} ${f1(ky)} a ${f1(rh * 0.6)} ${f1(rh * 0.55)} 0 1 0 ${f1(rh * 1.1)} 0 a ${f1(rh * 0.6)} ${f1(rh * 0.55)} 0 1 0 ${f1(-rh * 1.1)} 0 Z`;
    const ends = `M ${f1(kx)} ${f1(ky + rh * 0.4)} q ${f1(-rh * 0.4)} ${f1(rh * 1.4)} ${f1(-rh * 0.2)} ${f1(rh * 2.6)} M ${f1(kx + rh * 0.3)} ${f1(ky + rh * 0.4)} q ${f1(rh * 0.5)} ${f1(rh * 1.2)} ${f1(rh * 0.6)} ${f1(rh * 2.2)}`;
    return (
      <g key={`r${i}`}>
        <path d={band} fill={PB.paper} />
        <path d={twists.join(' ')} fill="none" stroke={PB.lead2} strokeWidth={1.1} strokeLinecap="round" />
        <PLine d={arc(-rh / 2)} w={1.5} seed={`${seed}ra${i}`} double={false} />
        <PLine d={arc(rh / 2)} w={1.7} seed={`${seed}rb${i}`} double={false} />
        <path d={knot} fill={PB.paper} stroke={PB.lead} strokeWidth={1.3} />
        <path d={ends} fill="none" stroke={PB.lead} strokeWidth={1.2} strokeLinecap="round" />
      </g>
    );
  };
  return (
    <g opacity={o}>
      <path d={body} fill={PB.paper} />
      {hi > 0 ? <Accent d={body} o={hi} /> : null}
      <path d={strawH.join(' ')} fill="none" stroke={TONE.H.color} strokeWidth={0.9} strokeLinecap="round" />
      <path d={straw2.join(' ')} fill="none" stroke={PB.lead2} strokeWidth={0.95} strokeLinecap="round" opacity={0.9} />
      <path d={shade.join(' ')} fill="none" stroke={TONE.H.color} strokeWidth={0.9} strokeLinecap="round" opacity={0.85} />
      <path d={tips.join(' ')} fill="none" stroke={PB.lead2} strokeWidth={0.95} strokeLinecap="round" />
      {/* 윤곽 — 다발 양옆(짚이 삐죽해 끊긴 선), 위·아래는 짚 끝이 대신한다 */}
      <PLine d={smoothOpen(L)} w={1.6} seed={`${seed}l`} />
      <PLine d={smoothOpen(Rt)} w={2.0} seed={`${seed}r`} />
      {ties.map((ty) => rope(ty, tiesAll.indexOf(ty)))}
    </g>
  );
};
