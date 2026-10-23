// 스타일 B 손(2026-10-23 손질) — 3D 뼈대 손(geomHand)을 연필로: 윤곽(합친 실루엣) → 종이 가림 → 결 따라 빗금 → 주름·손톱·솔기.
// 자세 hold·pinch·open·pour·point·press·shears, 왼손/오른손, 맨손/장갑. layer 로 쥔 물건 앞/뒤를 나눠 그린다.
import React, { useMemo } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { clamp } from '../stage';
import { handGeom2, type HandG, type HandPoseName } from '../geomHand';
import type { P } from '../geom';
import { DONE, PB, TONE, toneColor } from './pencil';

export type HandSide = 'right' | 'left';

/** 손 크기 — 식물 키(px)와 실제 키(m)로 정한다(1mm = h/(m·1000) px). 읽히게 boost 배(기본 1.25) 키운다. scale 1 = 손 길이 약 190px. */
export function handScaleFor(plantPx: number, plantMeters: number, boost = 1.25): number {
  return (plantPx / (plantMeters * 1000)) * boost;
}

const W_CONTOUR = TONE.B2.w * 1.15;
/** 윤곽 끊김 무늬(pathLength 1 기준) — 연필을 뗐다 다시 댄 자리. */
const BREAKS = ['0.27 0.012 0.34 0.016 0.358 0', '0.19 0.014 0.41 0.01 0.376 0', '0.33 0.018 0.22 0.012 0.42 0', '0.4 0.012 0.3 0.015 0.273 0'];

/** 손 그림 한 부위. */
const Part: React.FC<{ g: HandG; i: number; k: number; p: number; det: number; det6: number; hi: number; uid: string }> = ({ g, i, k, p, det, det6, hi, uid }) => {
  const pt = g.parts[i]!;
  const sw = (w: number) => w / k; // 화면 굵기 고정
  const prog = p < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - p } : {};
  const cid = `b-hand-${uid}-${i}`;
  const fillCol = hi > 0 && (pt.part === 'finger' || pt.part === 'thumb' || pt.part === 'palm') ? PB.accentWash : PB.paper;
  // 소매·맨팔 먼 끝 — 흐리게 지운다(연필 스케치처럼 끝이 사라짐, 닫힌 깡통 끝 금지)
  const fz = pt.fade;
  const mid = `${cid}-fm`;
  // (B4) 선 굵기 위계 — 손가락처럼 덩어리가 여럿(접힌 마디)이면 바깥 실루엣만 굵게 먼저 긋고, 덩어리끼리 겹친 안쪽 접힘선은 가늘게.
  //   마디마다 같은 굵은 윤곽을 두르면 나무 인형(피노키오) 마디처럼 보인다.
  const multi = pt.groups.length > 1;
  const contour = (d: string, key: string, w: number, n: number) => <path key={key} d={d} fill="none" stroke={PB.lead} strokeWidth={sw(w)} strokeLinejoin="round" strokeLinecap="round" {...(p < 1 ? prog : { pathLength: 1, strokeDasharray: BREAKS[n % BREAKS.length]! })} />;
  const body = (
    <g>
      {multi ? pt.groups.flatMap((gr, gi) => gr.shapes.map((d, j) => contour(d, `O${gi}-${j}`, W_CONTOUR * 1.75, i * 7 + gi * 3 + j))) : null}
      {pt.groups.map((gr, gi) => (
        <g key={gi}>
          {/* 윤곽 — 굵게 먼저(종이 칠이 안쪽 반을 덮어 합친 실루엣만 남는다), 덧선도 칠 밑에 */}
          {/* (B4) 끊김 있는 부드러운 윤곽 — 다 그린 뒤엔 군데군데 짧게 끊는다(조각마다 끊는 자리를 엇갈려), 굵기도 조금 가늘게 */}
          {gr.shapes.map((d, j) => contour(d, `o${j}`, multi && gi > 0 ? W_CONTOUR * 0.95 : W_CONTOUR * 1.75, i * 5 + gi * 3 + j))}
          {det > 0 ? gr.shapes.map((d, j) => <path key={`g${j}`} d={d} fill="none" stroke={PB.lead} strokeWidth={sw(1.2)} opacity={0.4 * det} transform={`translate(${sw(1.6)} ${sw(-1.1)})`} pathLength={1} strokeDasharray="0.31 0.02 0.22 0.015 0.4 0.03" />) : null}
          {gr.shapes.map((d, j) => <path key={`f${j}`} d={d} fill={PB.paper} opacity={Math.min(1, p * 2)} />)}
          {hi > 0 && fillCol !== PB.paper ? <g opacity={0.7 * hi}>{gr.shapes.map((d, j) => <path key={`a${j}`} d={d} fill={PB.accentWash} />)}</g> : null}
          <g clipPath={`url(#${cid})`} opacity={det}>
            <path d={gr.hatch} fill="none" stroke={TONE.H.color} strokeWidth={sw(TONE.H.hatch)} strokeLinecap="round" opacity={0.95} />
            {gr.hatch2 ? <path d={gr.hatch2} fill="none" stroke={PB.lead2} strokeWidth={sw(TONE.B2.hatch)} strokeLinecap="round" opacity={0.85} /> : null}
            {gr.core ? <path d={gr.core} fill="none" stroke={TONE.B6.color} strokeWidth={sw(TONE.B6.hatch * 0.9)} strokeLinecap="round" opacity={0.75 * det6} /> : null}
          </g>
        </g>
      ))}
      <g opacity={det}>
        {pt.details.map((q, j) => <path key={`d${j}`} d={q.d} fill="none" stroke={toneColor(q.tone)} strokeWidth={sw(q.w * (q.tone === 'dark' ? 1.2 : 1))} strokeLinecap="round" {...(q.dash ? { strokeDasharray: q.dash } : {})} />)}
        {pt.nails.map((d, j) => <path key={`n${j}`} d={d} fill={PB.paper} stroke={PB.lead2} strokeWidth={sw(1.25)} strokeLinejoin="round" />)}
      </g>
    </g>
  );
  return (
    <g>
      <defs>
        <clipPath id={cid}>{pt.shapes.map((d, j) => <path key={j} d={d} />)}</clipPath>
        {fz ? (
          <mask id={mid} maskUnits="userSpaceOnUse" x={-4000} y={-4000} width={8000} height={8000}>
            <linearGradient id={`${mid}-g`} gradientUnits="userSpaceOnUse" x1={fz.a[0]} y1={fz.a[1]} x2={fz.b[0]} y2={fz.b[1]}>
              <stop offset={0} stopColor="#fff" stopOpacity={1} /><stop offset={1} stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <rect x={-4000} y={-4000} width={8000} height={8000} fill={`url(#${mid}-g)`} />
          </mask>
        ) : null}
      </defs>
      {fz ? <g mask={`url(#${mid})`}>{body}</g> : body}
    </g>
  );
};

/**
 * 손 — 쥐는 점 (x,y). pose: hold(세로 줄기 쥠)·shears(전정가위 쥠)·pinch(엄지·검지로 집기 — 끝이 (x,y))·open(벌린 손 — 뿌리 풀기, 손끝 쪽이 (x,y))·
 * pour(오므린 손바닥으로 붓기)·point(검지 끝이 (x,y))·press(손바닥으로 흙 누르기 — 손바닥 밑이 (x,y)).
 * side 'right'(기본, 오른쪽에서 들어옴 — 단 open 은 뿌리분 왼쪽·팔이 왼쪽 위에서)·'left'(거울). glove = 장갑. angle = 화면 회전. scale 1 ≈ 손 길이 190px(handScaleFor 로 식물에 맞춤).
 * curl(0~1) = 손가락 굽힘 — 없으면 나타난 뒤 저절로 오므린다. layer: 'back'(쥔 물건 뒤 — 손바닥·팔)·'front'(앞 — 손가락)·'all'.
 * hold/shears 는 <Hand layer="back"/> → 줄기 → <Hand layer="front"/> 순으로 그리면 줄기를 감싼다.
 */
export const Hand: React.FC<{
  x: number; y: number; pose?: HandPoseName; side?: HandSide; glove?: boolean; angle?: number; scale?: number; flip?: boolean;
  at?: number; o?: number; hi?: number; curl?: number; layer?: 'back' | 'front' | 'all'; sleeve?: number; slide?: number; uid?: string; shearsOpen?: number;
}> = ({ x, y, pose = 'hold', side, glove = false, angle = 0, scale = 1, flip, at = DONE, o = 1, hi = 0, curl, layer = 'all', sleeve = 150, slide = 60, uid, shearsOpen = 0 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const autoCurl = interpolate(f, [at + 8, at + 26], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const c = curl ?? (at === DONE ? 1 : autoCurl);
  const cq = Math.round(c * 20) / 20; // 모양 계산 아끼기
  const sq = Math.round(scale * 10) / 10; // 화면 크기 단계(빗금 간격·세부 생략)
  const g = useMemo(() => handGeom2(pose, { curl: cq, glove, sleeve, scale: sq }), [pose, cq, glove, sleeve, sq]);
  if (p <= 0 || o <= 0) return null;
  const left = side === 'left' || flip === true;
  const det = interpolate(p, [0.45, 1], [0, 1], clamp);
  const det6 = interpolate(f, [at + 16, at + 26], [0, 1], clamp);
  const sl = (1 - p) * slide;
  const id = uid ?? `${pose}${Math.round(x)}${Math.round(y)}`;
  const idx = g.parts.map((_, i) => i).filter((i) => layer === 'all' || (layer === 'front' ? g.front.has(i) : !g.front.has(i)));
  const showShears = pose === 'shears' && layer !== 'front';
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${left ? -scale : scale} ${scale}) translate(${sl} ${sl * 0.3})`} opacity={o * Math.min(1, p * 1.6)}>
      {showShears ? <ShearsG k={scale} open={shearsOpen} p={p} /> : null}
      {idx.map((i) => <Part key={i} g={g} i={i} k={scale} p={p} det={det} det6={det6} hi={hi} uid={id} />)}
    </g>
  );
};

/** 전정가위(손 좌표, 쥐는 점 원점) — 손잡이 둘은 손 안, 날은 왼쪽 위로. open 0~1 = 날 벌림. */
const ShearsG: React.FC<{ k: number; open: number; p: number }> = ({ k, open, p }) => {
  const sw = (w: number) => w / k;
  const a = open * 16;
  const pivot: P = [-52, -54];
  // 손잡이(아래 → 위 축), 날 둘(곧은 날 + 휜 받침날)
  const handleA = 'M -6 70 C -12 30 -22 -10 -40 -44 L -56 -58 L -44 -64 L -30 -50 C -10 -18 4 26 12 70 Z';
  const handleB = 'M -24 74 C -28 34 -36 -4 -50 -40 L -60 -50 L -66 -40 C -54 -10 -46 34 -42 74 Z';
  const blade = 'M -46 -62 C -70 -88 -100 -118 -132 -150 C -128 -132 -112 -104 -92 -82 C -80 -70 -66 -58 -56 -48 Z';
  const anvil = 'M -60 -50 C -80 -70 -100 -96 -118 -128 C -124 -122 -120 -104 -108 -86 C -96 -68 -82 -54 -66 -40 Z';
  const spring = 'M -30 -20 c -8 4 -14 0 -16 -6 c 6 0 10 -2 12 -8 c -8 2 -14 -2 -16 -8';
  const prog = p < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - p } : {};
  const piece = (d: string, hatch: boolean, key: string) => (
    <g key={key}>
      <path d={d} fill={PB.paper} stroke={PB.lead} strokeWidth={sw(2.4)} strokeLinejoin="round" {...prog} />
      {hatch ? <path d={d} fill="url(#b-h50f)" opacity={0.55} /> : null}
    </g>
  );
  return (
    <g>
      <g transform={`rotate(${-a} ${pivot[0]} ${pivot[1]})`}>{piece(handleB, true, 'hb')}{piece(anvil, true, 'an')}</g>
      <g transform={`rotate(${a} ${pivot[0]} ${pivot[1]})`}>
        {piece(blade, false, 'bl')}
        <path d="M -60 -66 C -84 -92 -108 -120 -128 -146" fill="none" stroke={PB.lead2} strokeWidth={sw(1)} />
        {piece(handleA, true, 'ha')}
      </g>
      <circle cx={pivot[0]} cy={pivot[1]} r={6} fill={PB.paper} stroke={PB.lead} strokeWidth={sw(1.8)} />
      <circle cx={pivot[0]} cy={pivot[1]} r={2} fill={PB.lead} />
      <path d={spring} fill="none" stroke={PB.lead2} strokeWidth={sw(1.4)} />
    </g>
  );
};
