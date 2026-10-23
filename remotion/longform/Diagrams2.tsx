// 롱폼 그림 애니메이션 2차(2026-10-19 사장님 지시) — 글자 카드(목록·비교·요약·숫자·막대·인용)를 그림으로 바꾼다.
// 여러 문장에 걸친 설명은 step 으로 이어 그린다: 앞 단계는 끝난 상태, 지금 단계만 움직이고, 뒤 단계는 아직 없다.
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { ACCENT, INK, LEAF } from './InfoPanel';
import { Branch, Bud, Chips, CollarJoint, Coin, Ground, Pot, ProcTree, Saw, Shears, WoodSection, leafCluster, leavesAlong } from './illus/Kit';
import { pointAt, type P } from './illus/geom';
import { Arrow, Badge, Draw, Label, RED, clamp, useProgress } from './diagramParts';

const DONE = -999;
const LATER = 99999;
/** 단계 k 의 지역 시각 — 앞 단계면 이미 끝남, 뒤 단계면 아직. */
const at = (step: number, k: number, local: number) => (k < step ? DONE : k === step ? local : LATER);

/** 잘려 사라지는 가지 — cutAt 이후 떨어지며 흐려진다. */
const Falling: React.FC<{ cutAt: number; pivot: P; children: React.ReactNode; dir?: number }> = ({ cutAt, pivot, children, dir = 1 }) => {
  const f = useCurrentFrame();
  const t = interpolate(f, [cutAt, cutAt + 20], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  if (t >= 1) return null;
  return <g transform={`translate(${dir * t * 30} ${t * 220}) rotate(${dir * t * 50} ${pivot[0]} ${pivot[1]})`} opacity={1 - t}>{children}</g>;
};

/** 빨간 강조 고리 — 그 가지를 짚는다. */
const Ping: React.FC<{ x: number; y: number; at: number; until?: number; color?: string }> = ({ x, y, at: a, until, color = RED }) => {
  const f = useCurrentFrame();
  if (f < a || (until != null && f > until)) return null;
  const t = (f - a) % 30;
  return (
    <g>
      <circle cx={x} cy={y} r={14 + t} fill="none" stroke={color} strokeWidth={4} opacity={1 - t / 30} />
      <circle cx={x} cy={y} r={10} fill={color} opacity={0.85} />
    </g>
  );
};

/** 가위 금지 표시. */
const NoCut: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at: a }) => {
  const p = useProgress(a, 10);
  if (p <= 0) return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${p})`}>
      <circle r={34} fill="#fff" stroke={RED} strokeWidth={6} />
      <Shears x={0} y={0} angle={-30} scale={0.35} />
      <path d="M -24 -24 L 24 24" stroke={RED} strokeWidth={6} strokeLinecap="round" />
    </g>
  );
};

const TRUNK: P[] = [[500, 575], [498, 420], [502, 250], [500, 120]];

// 주지 고르기 — step 0: 후보 중 세 개(각도·높이·방향)를 고른다, step 1: 같은 높이 둘 중 하나만.
export const ScaffoldPick: React.FC<{ step: number }> = ({ step }) => {
  const A: P[] = [[498, 430], [400, 370], [320, 300]], B: P[] = [[500, 432], [600, 372], [680, 302]];
  // 고르는 셋(A·D·E)은 모두 45° 이상 벌어진 가지, C 는 바짝 선(15°) 가지라 안 고른다 — 다음 장면의 '45° 이상' 규칙과 맞춘다.
  const C: P[] = [[500, 345], [474, 260], [462, 180]], D: P[] = [[501, 300], [600, 240], [680, 180]], E: P[] = [[500, 240], [440, 200], [390, 150]];
  const base = step > 0 ? DONE : 0;
  const pick = [A, D, E];
  return (
    <>
      <Ground y={566} seed="sp" />
      <Branch pts={TRUNK} w0={18} w1={11} at={base} dur={16} />
      {[A, C, D, E].map((l, i) => <Branch key={i} pts={l} w0={7} w1={2.5} at={base + 8 + i * 3} dur={14} />)}
      {step === 1 ? (
        <Falling cutAt={44} pivot={B[0]!}><Branch pts={B} w0={7} w1={2.5} at={DONE} stroke={RED} /></Falling>
      ) : <Branch pts={B} w0={7} w1={2.5} at={base + 10} dur={14} />}
      {step === 0 ? pick.map((l, i) => {
        const [x, y] = pointAt(l, 1);
        return (
          <g key={i}>
            <Branch pts={l} w0={7} w1={2.5} at={40 + i * 14} dur={1} fill="none" stroke={LEAF} />
            <Badge x={x + 10} y={y - 30} at={42 + i * 14} ok />
          </g>
        );
      }) : null}
      {step === 1 ? (
        <>
          <Ping x={498} y={430} at={8} until={44} />
          <Draw d="M 300 432 L 700 432" at={10} color={RED} width={4} dash />
          <Shears x={560} y={420} angle={200} scale={0.55} at={28} closeAt={44} hideAt={56} />
          <Chips x={510} y={432} at={44} />
          <Label x={500} y={510} at={60} color={LEAF} size={32}>같은 높이 → 하나만</Label>
        </>
      ) : null}
    </>
  );
};

// 헷갈리는 가지 6종 — step 0: 하나씩 짚기, 1: 도장지(제거·유인), 2: 교차지·역행지 제거, 3: 평행지 하나만·처진 가지 보류.
export const BranchTypes: React.FC<{ step: number; frames?: number }> = ({ step, frames = 150 }) => {
  const L: P[] = [[498, 400], [380, 340], [280, 290]], R: P[] = [[502, 360], [620, 300], [740, 260]], U: P[] = [[500, 260], [520, 180], [540, 110]];
  const sprout: P[] = [[620, 300], [624, 200], [628, 90]];
  const cross: P[] = [[400, 345], [480, 290], [580, 250]];
  const inward: P[] = [[720, 266], [660, 300], [580, 320]];
  const par1: P[] = [[460, 440], [380, 430], [300, 420]], par2: P[] = [[462, 470], [382, 460], [302, 452]];
  const droop: P[] = [[330, 312], [290, 380], [272, 450]];
  const sucker: P[] = [[494, 548], [466, 510], [446, 460]];
  const base = step > 0 ? DONE : 0;
  const tags: Array<[P[], string]> = [[sprout, '도장지'], [cross, '교차지'], [inward, '역행지'], [par2, '평행지'], [droop, '처진 가지'], [sucker, '대목순']];
  const gone = (k: number) => (step > k ? true : false);
  // 여섯 이름표가 문장 안에 다 나오게 — 세그먼트 길이에 맞춰 간격을 잡는다.
  const gap = Math.max(10, (frames - 40) / 6);
  return (
    <>
      <Ground y={566} seed="bt" />
      <Branch pts={TRUNK} w0={18} w1={11} at={base} dur={16} />
      {[L, R, U].map((l, i) => <Branch key={i} pts={l} w0={8} w1={3} at={base + 8 + i * 3} dur={14} />)}
      <Branch pts={par1} w0={5} w1={2} at={base + 14} dur={12} />
      <Branch pts={droop} w0={4} w1={1.5} at={base + 14} dur={12} {...(step === 3 ? { stroke: LEAF } : {})} />
      {/* 도장지 */}
      {gone(1) ? null : step === 1
        ? <Falling cutAt={44} pivot={sprout[0]!}><Branch pts={sprout} w0={7} w1={3} at={DONE} stroke={RED} /></Falling>
        : <Branch pts={sprout} w0={7} w1={3} at={base + 16} dur={12} />}
      {/* 교차지·역행지 */}
      {gone(2) ? null : step === 2
        ? <><Falling cutAt={30} pivot={cross[0]!}><Branch pts={cross} w0={5} w1={2} at={DONE} stroke={RED} /></Falling>
            <Falling cutAt={62} pivot={inward[0]!} dir={-1}><Branch pts={inward} w0={5} w1={2} at={DONE} stroke={RED} /></Falling></>
        : <><Branch pts={cross} w0={5} w1={2} at={base + 16} dur={12} /><Branch pts={inward} w0={5} w1={2} at={base + 16} dur={12} /></>}
      {/* 평행지 둘 중 하나 */}
      {gone(3) ? null : step === 3
        ? <Falling cutAt={30} pivot={par2[0]!}><Branch pts={par2} w0={5} w1={2} at={DONE} stroke={RED} /></Falling>
        : <Branch pts={par2} w0={5} w1={2} at={base + 14} dur={12} />}
      <Branch pts={sucker} w0={5} w1={2} at={base + 14} dur={12} />
      {step === 0 ? tags.map(([l, name], i) => {
        const [x, y] = pointAt(l, 0.7);
        return (
          <g key={i}>
            <Ping x={x} y={y} at={24 + i * gap} until={24 + i * gap + 30} />
            <Label x={x + (x < 500 ? -20 : 20)} y={y - 22} at={24 + i * gap} color={RED} size={26} anchor={x < 500 ? 'end' : 'start'}>{name}</Label>
          </g>
        );
      }) : null}
      {step === 1 ? (
        <>
          <Ping x={622} y={190} at={6} until={40} />
          <Shears x={650} y={300} angle={200} scale={0.5} at={26} closeAt={44} hideAt={56} />
          <Chips x={620} y={296} at={44} />
          <Draw d="M 740 260 Q 800 250 850 280" at={70} color={LEAF} width={8} dash />
          <Label x={860} y={250} at={76} color={LEAF} size={26} anchor="end">빈 자리면 눕혀 유인</Label>
        </>
      ) : null}
      {step === 2 ? <><Shears x={470} y={330} angle={150} scale={0.45} at={14} closeAt={30} hideAt={40} /><Shears x={690} y={250} angle={30} scale={0.45} at={46} closeAt={62} hideAt={72} /></> : null}
      {step === 3 ? (
        <>
          <Shears x={430} y={470} angle={160} scale={0.45} at={14} closeAt={30} hideAt={40} />
          {[0.6, 0.85].map((t, i) => { const [x, y] = pointAt(droop, t); return <Bud key={i} x={x} y={y} angle={160} kind="flower" size={14} at={50 + i * 4} />; })}
          <Badge x={220} y={470} at={60} ok />
        </>
      ) : null}
    </>
  );
};

// 끊는 자리 두 곳 — 바깥 눈 위, 지륭 바깥.
export const CutSpots: React.FC = () => {
  const edgeX = 200, y = 330, bw = 40;
  return (
    <>
      <Branch pts={[[150, 700], [152, 330], [148, -80]]} w0={96} w1={88} at={0} dur={10} />
      <CollarJoint edgeX={edgeX} y={y} bw={bw} len={680} state="whole" at={4} />
      {(() => {
        // CollarJoint 가 그리는 가지 곡선과 같은 점 — 잎·눈이 가지 위에 붙게.
        const limb: P[] = [[edgeX - bw * 0.3, y], [edgeX + 680 * 0.4, y - bw * 0.15], [edgeX + 680, y - bw * 0.5]];
        const [bx, by] = pointAt(limb, 0.82);
        return (
          <>
            {leavesAlong(limb.slice(1), 3, 'cs', 18, 34, undefined, 'serrate')}
            <Bud x={bx} y={by - bw * 0.3} angle={20} kind="leaf" size={16} at={20} />
            <Ping x={bx} y={by - bw * 0.55} at={30} until={90} color={ACCENT} />
            <Draw d={`M ${bx + 10} ${by - bw * 1.4} L ${bx + 10} ${by + bw * 0.6}`} at={34} color={RED} width={4} dash />
            <Label x={bx + 10} y={by - bw * 1.7} at={36} color={ACCENT} size={28}>눈 위</Label>
          </>
        );
      })()}
      <Ping x={edgeX + bw * 0.4} y={y} at={60} until={140} color={ACCENT} />
      <Draw d={`M ${edgeX + bw * 0.4} ${y - bw} L ${edgeX + bw * 0.4} ${y + bw}`} at={64} color={RED} width={4} dash />
      <Label x={edgeX + 40} y={y + 100} at={66} color={ACCENT} size={28} anchor="start">지륭 바깥</Label>
    </>
  );
};

// 리본 묶기 — step 0: 잎 달린 지금, 남길 주지 셋에 리본. step 1: 잎이 지면 표시한 것만 남기고 나머지는 판단.
const Bow: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at: a }) => {
  const p = useProgress(a, 8);
  return (
    <g transform={`translate(${x} ${y}) scale(${p})`}>
      <path d="M 0 0 L -18 -12 L -18 12 Z M 0 0 L 18 -12 L 18 12 Z" fill="#e8463a" stroke="#8e1f17" strokeWidth={1.5} />
      <circle r={5} fill="#c22f24" />
      <path d="M -2 4 L -8 22 M 2 4 L 8 22" stroke="#e8463a" strokeWidth={4} />
    </g>
  );
};

export const Ribbon: React.FC<{ step?: number }> = ({ step = 0 }) => {
  const limbs: P[][] = [[[498, 420], [400, 360], [300, 300]], [[500, 380], [610, 320], [720, 270]], [[500, 300], [430, 240], [370, 190]], [[500, 330], [560, 250], [600, 170]], [[500, 450], [600, 430], [690, 420]]];
  const keep = [0, 1, 2];
  const base = step > 0 ? DONE : 0;
  return (
    <>
      <Ground y={566} seed="rb" />
      <Branch pts={TRUNK} w0={18} w1={11} at={base} dur={14} />
      {limbs.map((l, i) => <Branch key={i} pts={l} w0={7} w1={2.5} at={base + 8 + i * 2} dur={12} />)}
      {limbs.flatMap((l, i) => leavesAlong(l, 4, `rb${i}`, base + 16, 26, step === 1 ? 6 + i * 3 : undefined, 'serrate'))}
      {keep.map((k, i) => { const [x, y] = pointAt(limbs[k]!, 0.45); return <Bow key={k} x={x} y={y} at={step > 0 ? DONE : 26 + i * 12} />; })}
      {step === 1 ? [3, 4].map((k) => <Draw key={k} d={`M ${limbs[k]![0]![0]} ${limbs[k]![0]![1]} L ${limbs[k]![2]![0]} ${limbs[k]![2]![1]}`} at={60} color={RED} width={4} dash />) : null}
      {step === 1 ? <Label x={820} y={140} at={66} color={RED} size={28}>나머지는 판단</Label> : null}
    </>
  );
};

// 잎 있을 때 vs 잎 진 뒤(매실) — step 0: 굵은 가지 본전정은 잎 진 뒤(오른쪽 톱질), step 1: 잎 있을 때는 마른 가지·뿌리목 순만(왼쪽).
export const SeasonSplit: React.FC<{ step?: number }> = ({ step = 0 }) => {
  const R = at(step, 0, 40), Lt = at(step, 1, 14);
  return (
    <>
      <Ground y={566} seed="ss" />
      <path d="M 500 40 L 500 560" stroke="#fff" strokeOpacity={0.8} strokeWidth={4} strokeDasharray="10 10" />
      <Label x={250} y={70} at={step > 0 ? DONE : 4} color={LEAF} size={32}>잎 있을 때</Label>
      <Label x={750} y={70} at={step > 0 ? DONE : 8} color={ACCENT} size={32}>잎 진 뒤</Label>
      <ProcTree seed="ssL" x={250} groundY={566} height={300} at={step > 0 ? DONE : 0} leafSize={20} leaf="serrate" />
      <Falling cutAt={Lt + 16} pivot={[230, 380]} dir={-1}><Branch pts={[[240, 380], [180, 340], [140, 320]]} w0={4} w1={1.5} at={DONE} fill="url(#kit-grey)" /></Falling>
      <Shears x={210} y={370} angle={200} scale={0.45} at={Lt} closeAt={Lt + 16} hideAt={Lt + 26} />
      <Falling cutAt={Lt + 46} pivot={[262, 560]}><Branch pts={[[262, 560], [290, 520], [300, 470]]} w0={3.5} w1={1.5} at={DONE} stroke={RED} /></Falling>
      <Shears x={290} y={556} angle={200} scale={0.4} at={Lt + 32} closeAt={Lt + 46} hideAt={Lt + 56} />
      <ProcTree seed="ssR" x={750} groundY={566} height={300} at={step > 0 ? DONE : 6} foliage="none" />
      <Falling cutAt={R + 26} pivot={[752, 440]}><Branch pts={[[752, 440], [850, 400], [930, 380]]} w0={7} w1={3} at={DONE} /></Falling>
      <Saw x={800} y={420} angle={100} scale={0.4} at={R} strokes={3} dur={24} hideAt={R + 26} />
    </>
  );
};

// 짧은 가지(꽃눈) vs 도장지(매실) — step 0: 짤막한 가지에 꽃눈. step 1: 곧게 솟은 도장지가 그늘을 드리운다.
export const SpurSprout: React.FC<{ step?: number }> = ({ step = 0 }) => {
  const f = useCurrentFrame();
  const base = step > 0 ? DONE : 0;
  const shade = step === 1 ? interpolate(f, [24, 40], [0, 0.4], clamp) : 0;
  const glow = 0.6 + 0.4 * Math.sin(f / 6);
  const main: P[] = [[-60, 436], [500, 410], [1060, 374]];
  const spurs = [0.15, 0.3, 0.45, 0.7, 0.85];
  return (
    <>
      <Ground y={566} seed="sps" />
      <Branch pts={main} w0={40} w1={20} at={base} dur={14} />
      {spurs.map((t, i) => {
        const [x, y] = pointAt(main, t);
        return (
          <g key={i}>
            <Branch pts={[[x, y - 10], [x + 6, y - 34], [x + 8, y - 50]]} w0={13} w1={11} at={base + 10 + i * 2} dur={8} />
            <Bud x={x + 8} y={y - 48} kind="flower" size={12} at={base + 16 + i * 2} />
            <circle cx={x + 8} cy={y - 60} r={18} fill="url(#kit-glow)" opacity={(step === 0 ? glow : 0.25) * useProgress(base + 24, 8)} />
          </g>
        );
      })}
      <Label x={250} y={300} at={step > 0 ? DONE : 30} color={LEAF} size={30}>짧은 가지 = 꽃눈</Label>
      {step === 1 ? (
        <>
          <path d="M 560 400 L 380 400 L 470 120 L 650 120 Z" fill="#000" opacity={shade} />
          <Branch pts={[[560, 400], [566, 250], [572, 80]]} w0={18} w1={6} at={4} dur={20} stroke={RED} />
          {leavesAlong([[560, 400], [566, 250], [572, 80]], 5, 'sps', 16, 34, undefined, 'serrate')}
          <Label x={640} y={110} at={22} color={RED} size={30} anchor="start">도장지 — 꽃눈 거의 없음</Label>
        </>
      ) : null}
    </>
  );
};

// 자두 자를 차례 — ① 죽은·병든 ② 처진 ③ 파고드는 ④ 도장지 순서로 짚고 없앤다.
export const PruneOrder: React.FC = () => {
  const items: Array<{ pts: P[]; fill?: string; t: number }> = [
    { pts: [[498, 380], [420, 330], [350, 300]], fill: 'url(#kit-grey)', t: 10 },
    { pts: [[500, 430], [600, 470], [660, 548]], t: 40 },
    { pts: [[700, 300], [620, 320], [540, 330]], t: 70 },
    { pts: [[560, 330], [566, 220], [572, 100]], t: 100 },
  ];
  return (
    <>
      <Ground y={566} seed="po" />
      <Branch pts={TRUNK} w0={18} w1={11} at={0} dur={14} />
      {[[[500, 360], [620, 300], [720, 266]], [[500, 280], [440, 200], [400, 130]], [[500, 420], [380, 400], [300, 380]]].map((l, i) => (
        <g key={i}><Branch pts={l as P[]} w0={7} w1={2.5} at={6} dur={12} />{leavesAlong(l as P[], 3, `po${i}`, 14, 26, undefined, 'serrate')}</g>
      ))}
      {items.map((it, i) => {
        const [x, y] = pointAt(it.pts, 0.6);
        return (
          <g key={i}>
            <Falling cutAt={it.t + 22} pivot={it.pts[0]!}><Branch pts={it.pts} w0={5} w1={2} at={4} dur={10} {...(it.fill ? { fill: it.fill } : {})} /></Falling>
            <g opacity={useProgress(it.t, 6) * (1 - useProgress(it.t + 30, 10))}>
              <circle cx={x} cy={y - 34} r={22} fill={RED} />
              <text x={x} y={y - 24} textAnchor="middle" fontSize={28} fontWeight={800} fill="#fff">{i + 1}</text>
            </g>
          </g>
        );
      })}
    </>
  );
};

// 어린 감나무 순서 — step 0: 중심 줄기, 1: 겹친 가지·파고드는·처진·도장지 제거, 2: 남긴 가지 끝은 조금만.
export const YoungPersimmon: React.FC<{ step: number }> = ({ step }) => {
  const base = step > 0 ? DONE : 0;
  const keepL: P[] = [[500, 420], [400, 360], [320, 300]], keepR: P[] = [[501, 360], [610, 300], [700, 250]];
  const dup: P[] = [[500, 424], [600, 370], [670, 320]];
  const inward: P[] = [[650, 285], [590, 300], [530, 310]];
  const droop: P[] = [[380, 352], [350, 420], [340, 480]];
  const sprout: P[] = [[600, 305], [604, 220], [606, 140]];
  const rm: Array<[P[], number]> = [[dup, 20], [inward, 44], [droop, 68], [sprout, 92]];
  const f = useCurrentFrame();
  const trim = step === 2 ? interpolate(f, [30, 44], [1, 0.9], clamp) : step > 2 ? 0.9 : 1;
  return (
    <>
      <Ground y={566} seed="yp" />
      <Branch pts={TRUNK} w0={18} w1={11} at={base} dur={14} {...(step === 0 ? { stroke: f > 30 ? ACCENT : undefined } : {})} />
      {step === 0 ? <Label x={560} y={110} at={36} color={ACCENT} size={30} anchor="start">중심 줄기 하나</Label> : null}
      {[keepL, keepR].map((l, i) => {
        const end = pointAt(l, trim);
        const pts: P[] = [l[0]!, l[1]!, end];
        return <g key={i}><Branch pts={pts} w0={7} w1={2.5} at={base + 8} dur={12} /></g>;
      })}
      {rm.map(([l, t], i) => (step > 1 ? null : step === 1
        ? <Falling key={i} cutAt={t} pivot={l[0]!}><Branch pts={l} w0={5} w1={2} at={DONE} stroke={RED} /></Falling>
        : <Branch key={i} pts={l} w0={5} w1={2} at={base + 10} dur={12} />))}
      {step === 1 ? rm.map(([l, t], i) => { const [x, y] = pointAt(l, 0.2); return <Shears key={i} x={x} y={y} angle={200} scale={0.4} at={t - 12} closeAt={t} hideAt={t + 8} />; }) : null}
      {step === 2 ? [keepL, keepR].map((l, i) => { const [x, y] = pointAt(l, 0.92); return <Shears key={i} x={x + 10} y={y - 6} angle={i ? 20 : 160} scale={0.38} at={18} closeAt={36} hideAt={50} />; }) : null}
      {step === 2 ? <Label x={500} y={540} at={54} color={LEAF} size={30}>끝은 조금만</Label> : null}
    </>
  );
};

// 가지 6개면 3개까지, 4개면 2개까지 — 두 그루를 나란히.
export const HalfPair: React.FC = () => {
  const f = useCurrentFrame();
  const tree = (cx: number, n: number, cut: number[], t0: number) => (
    <g>
      <Branch pts={[[cx, 560], [cx + 2, 470], [cx, 400]]} w0={12} w1={8} at={0} dur={12} />
      {Array.from({ length: n }, (_, i) => {
        const a = (-160 + (140 * i) / (n - 1)) * (Math.PI / 180);
        const end: P = [cx + Math.cos(a) * 150, 400 + Math.sin(a) * 150];
        const k = cut.indexOf(i);
        const gone = k < 0 ? 0 : interpolate(f, [t0 + k * 14, t0 + k * 14 + 12], [0, 1], clamp);
        return (
          <g key={i} opacity={1 - gone * 0.8}>
            <Branch pts={[[cx, 410], [(cx + end[0]) / 2, (410 + end[1]) / 2 - 10], end]} w0={4.5} w1={1.5} at={6 + i * 2} dur={10} {...(k >= 0 ? { stroke: RED } : {})} />
            {leafCluster(end[0], end[1], `hp${cx}${i}`, 14 + i, 22, undefined, 'broad', 2)}
          </g>
        );
      })}
    </g>
  );
  return (
    <>
      <Ground y={566} seed="hp" />
      {tree(270, 6, [1, 3, 5], 30)}
      {tree(730, 4, [0, 2], 80)}
      <Label x={270} y={120} at={70} color={ACCENT} size={44}>6 → 3</Label>
      <Label x={730} y={120} at={110} color={ACCENT} size={44}>4 → 2</Label>
    </>
  );
};

// 볕 6시간 — step 0: 엉킨 가지가 볕을 막는다, 1: 비우면 볕이 속까지 든다. 해가 하늘을 건너고 시계가 6시간을 센다.
export const SunHours: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const base = step > 0 ? DONE : 0;
  const u = step === 1 ? interpolate(f, [0, 150], [0, 1], clamp) : 0.15;
  const sx = 120 + 760 * u, sy = 300 - Math.sin(Math.PI * u) * 230;
  const clear = step === 1 ? interpolate(f, [10, 34], [0, 1], clamp) : 0;
  const hours = step === 1 ? Math.min(6, Math.floor(interpolate(f, [30, 120], [0, 6.99], clamp))) : 0;
  const tangle: P[][] = [[[500, 330], [560, 290], [450, 250]], [[500, 300], [440, 280], [560, 230]], [[500, 360], [600, 330], [470, 300]], [[500, 280], [530, 220], [440, 210]]];
  return (
    <>
      <Ground y={566} seed="sh" />
      <circle cx={sx} cy={sy} r={40} fill="#ffe27a" stroke="#f6c443" strokeWidth={4} />
      {[0, 1, 2, 3, 4].map((i) => {
        const tx = 430 + i * 35, ty = 330;
        const len = step === 1 ? clear : 0.55;
        return <line key={i} x1={sx} y1={sy} x2={sx + (tx - sx) * len} y2={sy + (ty - sy) * len} stroke="#ffd54a" strokeWidth={5} strokeOpacity={0.75} />;
      })}
      <ProcTree seed="sun" x={500} groundY={566} height={340} at={base} leafSize={26} leaf="broad" />
      {tangle.map((l, i) => <g key={i} opacity={1 - clear}><Branch pts={l} w0={4} w1={1.5} at={base + 10} dur={10} /></g>)}
      <ellipse cx={500} cy={300} rx={110} ry={80} fill="#000" opacity={0.25 * (1 - clear)} />
      <g transform="translate(880 470)" opacity={step === 1 ? 1 : 0}>
        <circle r={56} fill="#fff" stroke="#3a3d42" strokeWidth={5} />
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1={0} y1={-46} x2={0} y2={-40} stroke="#3a3d42" strokeWidth={3} transform={`rotate(${i * 30})`} />)}
        <path d={`M 0 0 L 0 -46 A 46 46 0 ${hours > 6 ? 1 : 0} 1 ${46 * Math.sin((hours * Math.PI) / 6)} ${-46 * Math.cos((hours * Math.PI) / 6)} Z`} fill="#ffd54a" opacity={0.8} />
        <line x1={0} y1={0} x2={34 * Math.sin((hours * Math.PI) / 6)} y2={-34 * Math.cos((hours * Math.PI) / 6)} stroke="#3a3d42" strokeWidth={5} strokeLinecap="round" />
        <text y={86} textAnchor="middle" fontSize={30} fontWeight={800} fill={INK} stroke="#14130f" strokeWidth={4} paintOrder="stroke">{hours}시간</text>
      </g>
    </>
  );
};

// 블루베리 — step 0: 잎 있을 때 마른·처진·겹친 가지만, 1: 잎 진 뒤 회색 원가지를 밑동에서.
export const BlueberrySeason: React.FC<{ step: number }> = ({ step }) => {
  const base = step > 0 ? DONE : 0;
  const canes: P[][] = [[[520, 452], [560, 300], [640, 160]], [[540, 452], [620, 340], [720, 250]], [[500, 452], [506, 330], [500, 200]]];
  const grey: P[] = [[470, 452], [430, 300], [360, 130]];
  const dead: P[] = [[600, 330], [660, 300], [700, 290]];
  const droop: P[] = [[530, 400], [610, 440], [680, 470]];
  const cross: P[] = [[480, 380], [540, 330], [610, 300]];
  return (
    <>
      <Pot x={500} y={460} w={300} h={150} />
      {step === 1
        ? <Falling cutAt={60} pivot={grey[0]!} dir={-1}><Branch pts={grey} w0={15} w1={7} at={DONE} fill="url(#kit-grey)" stroke={RED} /></Falling>
        : <Branch pts={grey} w0={15} w1={7} at={base} dur={16} fill="url(#kit-grey)" />}
      {canes.map((c, i) => <Branch key={i} pts={c} w0={9} w1={3} at={base + 6 + i * 3} dur={14} />)}
      {canes.flatMap((c, i) => leavesAlong(c, 5, `bbs${i}`, base + 18, 22, step === 1 ? 6 + i * 5 : undefined, 'small'))}
      {step === 0 ? (
        <>
          {[[dead, 30, 'url(#kit-grey)'], [droop, 56, undefined], [cross, 82, undefined]].map(([l, t, fill], i) => (
            <Falling key={i} cutAt={t as number} pivot={(l as P[])[0]!}><Branch pts={l as P[]} w0={4} w1={1.5} at={10} dur={10} stroke={RED} {...(fill ? { fill: fill as string } : {})} /></Falling>
          ))}
          {[[dead, 30], [droop, 56], [cross, 82]].map(([l, t], i) => { const [x, y] = pointAt(l as P[], 0.2); return <Shears key={i} x={x} y={y} angle={200} scale={0.4} at={(t as number) - 12} closeAt={t as number} hideAt={(t as number) + 8} />; })}
        </>
      ) : (
        <>
          <Label x={260} y={120} at={20} color={INK} size={28}>회색 원가지</Label>
          <Shears x={440} y={470} angle={-150} scale={0.55} at={44} closeAt={60} hideAt={72} />
          <Chips x={466} y={452} at={60} />
        </>
      )}
    </>
  );
};

// 자르면 안 되는 가지 셋 — 통통한 눈의 짧은 가지 / 굵은 뼈대 가지 / 올해 심은 나무.
export const DontCut: React.FC = () => (
  <>
    <Ground y={566} seed="dc" />
    {[170, 500, 830].map((x, i) => <circle key={i} cx={x} cy={300} r={140} fill="#fff" opacity={0.25 * useProgress(i * 30, 10)} />)}
    <g>
      <Branch pts={[[60, 360], [170, 350], [280, 330]]} w0={26} w1={18} at={0} dur={10} />
      <Branch pts={[[170, 346], [176, 310], [180, 290]]} w0={10} w1={7} at={8} dur={8} />
      <Bud x={180} y={292} kind="flower" size={26} at={12} />
    </g>
    <g>
      <Branch pts={[[440, 560], [442, 300], [440, 160]]} w0={60} w1={44} at={30} dur={12} />
      <Branch pts={[[470, 330], [560, 280], [620, 240]]} w0={30} w1={14} at={36} dur={12} />
    </g>
    <g>
      <Branch pts={[[830, 560], [832, 420], [830, 300]]} w0={14} w1={8} at={60} dur={12} />
      <path d="M 852 560 L 852 300" stroke="#c9a46a" strokeWidth={7} opacity={useProgress(62, 8)} />
      <path d="M 832 380 Q 844 372 852 380" stroke="#e8e0c8" strokeWidth={3} fill="none" opacity={useProgress(64, 8)} />
      {leafCluster(830, 300, 'dcs', 68, 22, undefined, 'oval', 3)}
    </g>
    <NoCut x={170} y={470} at={20} />
    <NoCut x={500} y={470} at={50} />
    <NoCut x={830} y={470} at={80} />
  </>
);

// 정리 — 지금(리본) → 잎 진 뒤(표시 따라 자르기) → 눈 트면(가위 내려놓기).
export const CalendarSteps: React.FC = () => (
  <>
    <Ground y={566} seed="cal" />
    <ProcTree seed="calA" x={180} groundY={566} height={250} at={0} leafSize={18} leaf="serrate" />
    {[0, 1].map((i) => <circle key={i} cx={150 + i * 60} cy={420 - i * 20} r={9} fill="#e8463a" opacity={useProgress(20 + i * 6, 6)} />)}
    <Arrow d="M 290 360 L 380 360" at={34} color={INK} head={[380, 360, 0]} />
    <ProcTree seed="calB" x={500} groundY={566} height={250} at={36} foliage="none" />
    <Shears x={540} y={380} angle={200} scale={0.45} at={52} closeAt={66} />
    <Arrow d="M 610 360 L 700 360" at={74} color={INK} head={[700, 360, 0]} />
    <ProcTree seed="calC" x={820} groundY={566} height={250} at={76} foliage="buds" />
    <NoCut x={900} y={500} at={100} />
    <Label x={180} y={120} at={10} color={LEAF} size={30}>지금</Label>
    <Label x={500} y={120} at={46} color={ACCENT} size={30}>잎 진 뒤</Label>
    <Label x={820} y={120} at={86} color={RED} size={30}>눈 트면</Label>
  </>
);

// 굵기(정정판) — 가지가 해마다 굵어지고, 지금 자른 상처는 연필 굵기, 3~4년 뒤 절단면은 500원 동전만(같은 크기).
export const Thickness2: React.FC<{ step?: number }> = ({ step = 0 }) => {
  const f = useCurrentFrame();
  const g = step > 0 ? 1 : interpolate(f, [10, 70], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const t0 = step === 1 ? 0 : LATER;
  const year = 1 + Math.floor(g * 3.99);
  // 실물 비율: 500원 동전 지름 26.5mm = 72px → 1mm ≈ 2.7px. 연필 지름 7.5mm ≈ 20px.
  // 지금 가지(상처) = 연필 굵기 20px, 3~4년 뒤 절단면 = 500원 72px.
  const w = 20 + g * 52;
  return (
    <>
      <Ground y={566} seed="th2" />
      <Branch pts={[[-60, 192], [500, 186], [1060, 178]]} w0={w} w1={w * 0.85} at={0} dur={10} />
      <text x={500} y={120} textAnchor="middle" fontSize={40} fontWeight={800} fill={ACCENT} stroke="#14130f" strokeWidth={5} paintOrder="stroke">{year}년</text>
      {/* 연필 — 지금 자르면 상처가 이 굵기 */}
      <g opacity={useProgress(t0 + 30, 10)}>
        <g transform="translate(150 410)">
          <rect x={0} y={-10} width={150} height={20} fill="#f2c94c" stroke="#b8921e" strokeWidth={2} />
          <path d="M 150 -10 L 182 0 L 150 10 Z" fill="#e8d2a8" /><path d="M 172 -3 L 182 0 L 172 3 Z" fill="#333" />
          <rect x={-14} y={-10} width={14} height={20} fill="#e88" />
        </g>
        <WoodSection x={240} y={470} r={10} />
      </g>
      <Label x={230} y={530} at={t0 + 34} color={LEAF} size={28}>지금 · 연필 굵기</Label>
      {/* 500원 — 3~4년 뒤 절단면이 이 크기 */}
      <g opacity={useProgress(t0 + 8, 10)}>
        <WoodSection x={640} y={420} r={36} />
      </g>
      <Coin x={740} y={420} r={36} at={t0 + 12} />
      <Label x={690} y={530} at={t0 + 16} color={RED} size={28}>3~4년 뒤 · 500원 동전만</Label>
    </>
  );
};
