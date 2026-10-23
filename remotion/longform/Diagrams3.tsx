// 롱폼 그림 애니메이션 3차(2026-10-19 사장님 지시 "텍스트만 있는 부분도 애니메이션") — 자막만 나오던 문장에
// 그 문장이 말하는 장면을 그린다. step 이 있는 그림은 이어지는 문장에서 앞 단계가 끝난 상태로 이어 간다.
import React from 'react';
import { Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { ACCENT, INK, LEAF } from './InfoPanel';
import { Branch, Bud, Chips, CollarJoint, Coin, Gardener, Ground, Leaf, Pot, ProcTree, Saw, Shears, WoodSection, leafCluster, leavesAlong, type LeafShape } from './illus/Kit';
import { growTree, pointAt, taperOutline, type P } from './illus/geom';
import { Arrow, Badge, Draw, Label, RED, clamp, useProgress } from './diagramParts';

const DONE = -999;
const at = (step: number, k: number, local: number) => (k < step ? DONE : k === step ? local : 99999);
const TRUNK: P[] = [[500, 575], [498, 420], [502, 250], [500, 120]];

const Q: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at: a }) => {
  const f = useCurrentFrame();
  const p = useProgress(a, 8);
  const bob = Math.sin((f - a) / 6) * 4;
  return <text x={x} y={y + bob} textAnchor="middle" fontSize={54 * p} fontWeight={800} fill={ACCENT} stroke="#14130f" strokeWidth={6} paintOrder="stroke">?</text>;
};

const Fruit: React.FC<{ x: number; y: number; r?: number; at: number; color?: string; fadeAt?: number }> = ({ x, y, r = 14, at: a, color = '#e05a3a', fadeAt }) => {
  const p = useProgress(a, 8) * (fadeAt == null ? 1 : 1 - useProgress(fadeAt, 10));
  if (p <= 0) return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${p})`}>
      <ellipse cx={r * 0.25} cy={r * 0.9} rx={r * 0.8} ry={r * 0.22} fill="#000" opacity={0.18} />
      <circle r={r} fill={color === '#e05a3a' ? 'url(#kit-fruit)' : color} />
      <circle r={r} fill="url(#kit-glow)" opacity={0.0} />
      <ellipse cx={-r * 0.35} cy={-r * 0.38} rx={r * 0.28} ry={r * 0.18} fill="#fff" opacity={0.55} />
      <path d={`M 0 ${-r} q 2 -6 6 -8`} stroke="#5a3920" strokeWidth={2} fill="none" />
    </g>
  );
};

const NoSign: React.FC<{ x: number; y: number; at: number; r?: number }> = ({ x, y, at: a, r = 40 }) => {
  const p = useProgress(a, 8);
  if (p <= 0) return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${p})`}>
      <circle r={r} fill="#fff" fillOpacity={0.85} stroke={RED} strokeWidth={7} />
      <Shears x={0} y={0} angle={-30} scale={r / 110} />
      <path d={`M ${-r * 0.7} ${-r * 0.7} L ${r * 0.7} ${r * 0.7}`} stroke={RED} strokeWidth={7} strokeLinecap="round" />
    </g>
  );
};

/** 작은 나무(가지 몇 개) — 연도별 비교 그림용. */
const SmallTree: React.FC<{ x: number; base?: number; h: number; n: number; at: number; leaf?: boolean; cut?: number[]; cutAt?: number; seed: string }> = ({ x, base = 560, h, n, at: a, leaf, cut = [], cutAt = 0, seed }) => {
  const f = useCurrentFrame();
  return (
    <g>
      <Branch pts={[[x, base], [x + 2, base - h * 0.5], [x, base - h * 0.62]]} w0={Math.max(5, h / 26)} w1={Math.max(3, h / 42)} at={a} dur={12} />
      {Array.from({ length: n }, (_, i) => {
        const ang = (-150 + (120 * i) / Math.max(1, n - 1)) * (Math.PI / 180);
        const s: P = [x, base - h * (0.45 + 0.15 * (i % 2))];
        const e: P = [s[0] + Math.cos(ang) * h * 0.45, s[1] + Math.sin(ang) * h * 0.45];
        const k = cut.indexOf(i);
        const gone = k < 0 ? 0 : interpolate(f, [cutAt + k * 10, cutAt + k * 10 + 10], [0, 1], clamp);
        return (
          <g key={i} opacity={1 - gone * 0.85}>
            <Branch pts={[s, [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2 - 6], e]} w0={Math.max(2.5, h / 70)} w1={1.2} at={a + 6 + i} dur={10} {...(k >= 0 ? { stroke: RED } : {})} />
            {leaf ? leafCluster(e[0], e[1], `${seed}${i}`, a + 14 + i, h * 0.08, undefined, 'serrate', 2) : null}
          </g>
        );
      })}
    </g>
  );
};

// ── 도입 ─────────────────────────────────────────────

/** step 0: 가위를 들었다 내려놓는 정원사, step 1: 가지마다 물음표, 열매가 사라질까 봐. */
export const Hesitate: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const lift = step === 0 ? interpolate(f, [10, 34, 70, 96], [0, 1, 1, 0], clamp) : 0;
  return (
    <>
      <Ground y={566} seed="hs" />
      <Gardener x={230} groundY={566} scale={1.15} reachAt={step === 0 ? 10 : 99999} armTo={interpolate(lift, [0, 1], [100, -20])} />
      <ProcTree seed="hes" x={650} groundY={566} height={340} at={step > 0 ? DONE : 0} leafSize={22} leaf="serrate" />
      {step === 1 ? (
        <>
          {[[560, 330], [700, 260], [760, 380], [600, 210]].map(([x, y], i) => <Q key={i} x={x!} y={y!} at={8 + i * 8} />)}
          {[[620, 300], [700, 330], [580, 360]].map(([x, y], i) => <Fruit key={i} x={x!} y={y!} at={DONE} fadeAt={50 + i * 6} />)}
        </>
      ) : null}
    </>
  );
};

/** 잎이 지면 가지 구조가 드러난다 — mode fall: 잎이 떨어지고 구조가 빛난다, hold: 잎 달린 동안 가위 금지. */
export const LeafDrop: React.FC<{ v?: string; mode?: 'fall' | 'hold' }> = ({ v = 'serrate', mode = 'fall' }) => {
  // v = '잎모양:시드' — 장마다 다른 나무가 되게 시드를 바꾼다(같은 그림 반복 방지).
  const [shapeName, seedPart] = v.split(':');
  const shape = (shapeName ?? 'serrate') as LeafShape;
  v = `${shapeName}${seedPart ?? ''}`;
  const note = seedPart === 'j' ? '높이부터 본다' : seedPart === 'g' ? '이때부터 작업' : '가지 구조가 훤히';
  const f = useCurrentFrame();
  const glow = mode === 'fall' ? interpolate(f, [80, 100], [0, 1], clamp) : 0;
  const tree = growTree(`ld${v}`, [500, 566], 380, { depth: 3, spread: 32 });
  return (
    <>
      <Ground y={566} seed="ld" />
      <ProcTree seed={`ld${v}`} x={500} groundY={566} height={380} at={0} leafSize={shape === 'broad' ? 30 : 24} leaf={shape} {...(mode === 'fall' ? { fallAt: 34 } : {})} />
      {mode === 'fall' ? <Label x={500} y={70} at={96} color={ACCENT} size={32}>{note}</Label> : null}
      {mode === 'fall' && seedPart === 'j' ? <Draw d="M 300 150 L 700 150" at={100} color={ACCENT} width={4} dash /> : null}
      {mode === 'hold' ? <NoSign x={820} y={170} at={40} /> : null}
    </>
  );
};

/** 블루베리 화분 — 잎이 지면 손대는 가지가 달라진다. */
export const PotDrop: React.FC = () => {
  const canes: P[][] = [[[470, 452], [430, 300], [360, 140]], [[520, 452], [560, 300], [640, 160]], [[540, 452], [620, 340], [720, 250]], [[500, 452], [506, 330], [500, 200]]];
  return (
    <>
      <Pot x={500} y={460} w={300} h={150} />
      {canes.map((c, i) => <Branch key={i} pts={c} w0={i === 0 ? 24 : 15} w1={5} at={i * 3} dur={14} {...(i === 0 ? { fill: 'url(#kit-grey)' } : {})} />)}
      {canes.flatMap((c, i) => leavesAlong(c, 6, `pd${i}`, 16, 22, 50 + i * 4, 'small'))}
      <Draw d="M 470 452 L 360 140" at={100} color={ACCENT} width={5} dash />
    </>
  );
};

/** 오늘의 차례 — 다섯 장을 작은 그림으로. */
export const ChapterMap: React.FC = () => {
  const xs = [120, 310, 500, 690, 880];
  const names = ['어린 나무', '매실', '자두', '감나무', '블루베리'];
  return (
    <>
      <Ground y={566} seed="cm" />
      {xs.map((x, i) => (
        <g key={i}>
          {i === 4 ? <Pot x={x} y={480} w={110} h={70} /> : null}
          <SmallTree x={x} base={i === 4 ? 476 : 520} h={i === 0 ? 160 : 220} n={i === 4 ? 3 : 4} at={i * 14} leaf seed={`cm${i}`} />
          {i === 1 ? [0, 1, 2].map((k) => <circle key={k} cx={x - 30 + k * 30} cy={370 - k * 10} r={8} fill="#f6d0dc" opacity={useProgress(14 + 20, 8)} />) : null}
          {i === 3 ? <Fruit x={x + 20} y={380} r={12} at={i * 14 + 20} color="#f0a03a" /> : null}
          <Label x={x} y={130} at={i * 14 + 6} color={INK} size={26}>{names[i]!}</Label>
          <text x={x} y={90} textAnchor="middle" fontSize={34} fontWeight={800} fill={ACCENT} stroke="#14130f" strokeWidth={5} paintOrder="stroke" opacity={useProgress(i * 14, 6)}>{i + 1}</text>
        </g>
      ))}
    </>
  );
};

/** 미리 봐 두기 — 잎 달린 지금 돋보기로 남길 가지를 짚고, 겨울 고민 시간이 줄어든다. */
export const PlanAhead: React.FC = () => {
  const f = useCurrentFrame();
  const mx = interpolate(f, [10, 60], [380, 640], clamp), my = interpolate(f, [10, 60], [360, 260], clamp);
  return (
    <>
      <Ground y={566} seed="pa" />
      <ProcTree seed="plan" x={520} groundY={566} height={360} at={0} leafSize={22} leaf="serrate" />
      <g transform={`translate(${mx} ${my})`} opacity={useProgress(6, 8)}>
        <circle r={46} fill="#cfe9f7" fillOpacity={0.35} stroke="#3a3d42" strokeWidth={8} />
        <path d="M 32 32 L 70 70" stroke="#3a3d42" strokeWidth={12} strokeLinecap="round" />
      </g>
      {[[400, 360], [640, 260], [470, 230]].map(([x, y], i) => <Badge key={i} x={x!} y={y!} at={30 + i * 14} ok />)}
      <g transform="translate(860 140)" opacity={useProgress(80, 8)}>
        <circle r={50} fill="#fff" stroke="#3a3d42" strokeWidth={5} />
        <path d={`M 0 0 L 0 -40 A 40 40 0 0 1 ${40 * Math.sin(interpolate(f, [86, 120], [5.6, 1.6], clamp))} ${-40 * Math.cos(interpolate(f, [86, 120], [5.6, 1.6], clamp))} Z`} fill={LEAF} opacity={0.8} />
      </g>
    </>
  );
};

// ── 주지 장 ──────────────────────────────────────────

/** 심은 지 1~3년 — 묘목이 해마다 자란다. */
export const YoungAge: React.FC = () => {
  const f = useCurrentFrame();
  const y = Math.min(3, 1 + Math.floor(interpolate(f, [10, 90], [0, 2.99], clamp)));
  return (
    <>
      <Ground y={566} seed="ya" />
      {[1, 2, 3].map((k, i) => <g key={k} opacity={k <= y ? 1 : 0.15}><SmallTree x={220 + i * 280} h={150 + i * 90} n={2 + i} at={10 + i * 30} leaf seed={`ya${k}`} /></g>)}
      {[1, 2, 3].map((k, i) => <Label key={k} x={220 + i * 280} y={120} at={10 + i * 30} color={k === y ? ACCENT : INK} size={36}>{`${k}년`}</Label>)}
    </>
  );
};

/** 목표는 올해 열매보다 앞으로 십수 년 쓸 골격 — 열매가 흐려지고 뼈대가 빛나며 큰 나무 윤곽이 겹친다. */
export const Skeleton: React.FC = () => {
  const f = useCurrentFrame();
  const ghost = interpolate(f, [60, 100], [0, 0.35], clamp);
  return (
    <>
      <Ground y={566} seed="sk" />
      <g opacity={ghost}><ProcTree seed="skbig" x={500} groundY={566} height={520} at={DONE} foliage="none" /></g>
      <Branch pts={TRUNK} w0={18} w1={11} at={0} dur={14} stroke={f > 40 ? ACCENT : undefined} />
      {[[[498, 430], [400, 370], [320, 300]], [[501, 330], [600, 270], [680, 210]], [[500, 250], [440, 200], [390, 150]]].map((l, i) => <Branch key={i} pts={l as P[]} w0={16} w1={4} at={8 + i * 3} dur={12} stroke={f > 40 ? ACCENT : undefined} />)}
      {[[360, 330], [640, 250], [420, 180]].map(([x, y], i) => <Fruit key={i} x={x!} y={y!} at={12 + i * 4} fadeAt={30 + i * 4} />)}
      <Label x={500} y={70} at={70} color={ACCENT} size={32}>앞으로 십수 년 쓸 골격</Label>
    </>
  );
};

/** step 0: 열매 수는 세지 않는다, 1: 볕·바람이 속까지 드는지 본다, 2: 속이 어두운 나무는 안쪽 가지가 말라 죽는다. */
export const LightAir: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const base = step > 0 ? DONE : 0;
  const dense = step === 2;
  return (
    <>
      <Ground y={566} seed="la" />
      <ProcTree seed={dense ? 'ladense' : 'la'} x={500} groundY={566} height={380} at={step === 2 ? 0 : base} leafSize={24} leaf="serrate" />
      {step === 0 ? (
        <>
          {[[430, 300], [560, 260], [600, 340], [480, 230]].map(([x, y], i) => <Fruit key={i} x={x!} y={y!} at={10 + i * 4} />)}
          <g opacity={useProgress(40, 8)}>
            <text x={820} y={180} textAnchor="middle" fontSize={64} fontWeight={800} fill={INK} stroke="#14130f" strokeWidth={6} paintOrder="stroke">4개</text>
            <path d="M 760 200 L 880 140" stroke={RED} strokeWidth={9} strokeLinecap="round" />
          </g>
        </>
      ) : null}
      {step === 1 ? [0, 1, 2, 3].map((i) => {
        const p = interpolate(f, [10 + i * 6, 40 + i * 6], [0, 1], clamp);
        return <line key={i} x1={120} y1={140 + i * 30} x2={120 + (400 - 120) * p} y2={140 + i * 30 + (260 - 140 - i * 30) * p} stroke="#ffd54a" strokeWidth={6} strokeOpacity={0.8} />;
      }) : null}
      {step === 1 ? [0, 1, 2].map((i) => <path key={`w${i}`} d={`M ${820 - interpolate(f, [20, 70], [0, 200], clamp)} ${260 + i * 40} q 30 -14 60 0 t 60 0`} stroke="#ffffff" strokeWidth={4} fill="none" opacity={0.8} />) : null}
      {dense ? (
        <>
          <ellipse cx={500} cy={300} rx={130} ry={90} fill="#000" opacity={0.35 * useProgress(30, 14)} />
          {[[480, 320], [520, 290]].map(([x, y], i) => <Branch key={i} pts={[[500, 340], [x!, y!], [x! + (i ? 30 : -30), y! - 30]]} w0={8} w1={2} at={30} dur={10} fill="url(#kit-grey)" />)}
          {[[340, 260], [660, 230], [620, 380]].map(([x, y], i) => <Fruit key={i} x={x!} y={y!} at={60 + i * 6} />)}
          <Label x={500} y={70} at={70} color={RED} size={30}>열매는 바깥에만</Label>
        </>
      ) : null}
    </>
  );
};

/** step 0: 각도가 좁은 가지를 끈으로 당겨 벌린다, 1: 여름에 해 두면 겨울 가위질이 절반. */
export const SpreadTie: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const open = step === 0 ? interpolate(f, [30, 80], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) }) : 1;
  const deg = 18 + open * 30;
  const r = (deg * Math.PI) / 180;
  const crotch: P = [500, 380];
  const tip: P = [crotch[0] + Math.sin(r) * 280, crotch[1] - Math.cos(r) * 280];
  const mid: P = [crotch[0] + Math.sin(r) * 150, crotch[1] - Math.cos(r) * 150];
  return (
    <>
      <Ground y={566} seed="st" />
      <Branch pts={[[500, 575], [498, 400], [502, 220], [500, 80]]} w0={20} w1={11} at={step > 0 ? DONE : 0} dur={14} />
      <Branch pts={[crotch, mid, tip]} w0={8} w1={2.5} at={step > 0 ? DONE : 6} dur={14} fill={step === 1 ? 'url(#kit-new)' : undefined} />
      {leavesAlong([crotch, mid, tip], 4, 'st', step > 0 ? DONE : 14, 26, undefined, 'serrate')}
      <rect x={840} y={500} width={16} height={70} fill="#8a5a37" opacity={useProgress(step > 0 ? DONE : 16, 8)} />
      <path d={`M ${mid[0]} ${mid[1]} L 848 504`} stroke="#e8e0c8" strokeWidth={4} opacity={useProgress(step > 0 ? DONE : 22, 8)} />
      <Label x={700} y={120} at={step > 0 ? DONE : 84} color={LEAF} size={32}>{`${Math.round(deg)}°`}</Label>
      {step === 1 ? (
        <>
          <g opacity={useProgress(10, 8)}>
            <circle cx={180} cy={150} r={40} fill="#ffd54a" /><Label x={180} y={230} at={10} color={INK} size={28}>여름</Label>
          </g>
          <Arrow d="M 250 150 L 360 150" at={30} color={INK} head={[360, 150, 0]} />
          <g opacity={useProgress(40, 8)}><Shears x={180} y={360} angle={-30} scale={0.6} /><Label x={180} y={430} at={40} color={INK} size={28}>겨울 가위질</Label></g>
          <Label x={180} y={480} at={60} color={ACCENT} size={40}>½</Label>
        </>
      ) : null}
    </>
  );
};

/** 줄기에 딱 붙여 자르면 안 된다 — 붙여 자른 자국에 X, 지륭이 같이 잘려 나간다. */
export const FlushCut: React.FC = () => {
  const f = useCurrentFrame();
  const cutAt = 50;
  const drop = interpolate(f, [cutAt, cutAt + 20], [0, 1], clamp);
  const edgeX = 330, y = 300, bw = 62;
  return (
    <>
      <Branch pts={[[275, 700], [279, 300], [273, -80]]} w0={112} w1={104} at={0} dur={10} />
      <CollarJoint edgeX={edgeX} y={y} bw={bw} len={620} state={f >= cutAt ? 'flush' : 'whole'} at={4} />
      {f >= cutAt ? (
        <g transform={`translate(${drop * 40} ${drop * 300}) rotate(${drop * 25} ${edgeX} ${y})`} opacity={1 - drop * 0.8}>
          <Branch pts={[[edgeX, y], [edgeX + 250, y - 9], [edgeX + 620, y - 31]]} w0={bw * 1.2} w1={bw * 0.55} at={DONE} />
        </g>
      ) : null}
      <Draw d={`M ${edgeX - 2} ${y - bw} L ${edgeX - 2} ${y + bw}`} at={14} color={RED} width={5} dash />
      <Badge x={edgeX - 2} y={y - bw * 1.6} at={24} ok={false} />
      <Label x={520} y={170} at={28} color={RED} size={30} anchor="start">줄기에 딱 붙여 자르기</Label>
      <Label x={520} y={470} at={cutAt + 20} color={ACCENT} size={28} anchor="start">상처를 덮는 테두리까지 잘려 나감</Label>
    </>
  );
};

// ── 매실 ─────────────────────────────────────────────

/** 핵과류 굵은 상처는 느리게 아물고, 아물다 만 자리에서 썩어 들어간다. */
export const SlowHeal: React.FC = () => {
  const f = useCurrentFrame();
  const heal = interpolate(f, [20, 120], [0, 0.4], clamp);
  const rot = interpolate(f, [80, 150], [0, 1], clamp);
  return (
    <>
      <Ground y={566} seed="sh2" />
      <Branch pts={[[500, 590], [504, 300], [498, 30]]} w0={160} w1={130} at={0} dur={12} />
      <g transform="translate(500 300)">
        <ellipse rx={60} ry={80} fill="#e9c58f" />
        <ellipse rx={60 * (1 - heal)} ry={80 * (1 - heal)} fill="#7a4f2a" />
        <ellipse rx={36 * rot} ry={50 * rot} fill="#2a1a0e" opacity={0.85} />
      </g>
      <Label x={760} y={220} at={30} color={INK} size={30}>아무는 속도가 느림</Label>
      <Label x={760} y={420} at={90} color={RED} size={30}>아물다 만 자리 → 썩음</Label>
    </>
  );
};

/** 매실은 꽃이 이르다 — 꽃봉오리가 부풀어 피면 늦게 든 가위는 꽃눈째 자른다. 비 오는 날도 피한다. */
export const EarlyBloom: React.FC = () => {
  const f = useCurrentFrame();
  const bloom = interpolate(f, [20, 60], [0, 1], clamp);
  const twig: P[] = [[-60, 440], [480, 380], [900, 296]];
  return (
    <>
      <Ground y={566} seed="eb" />
      <Branch pts={twig} w0={26} w1={10} at={0} dur={12} />
      {[0.25, 0.45, 0.62, 0.8, 0.94].map((t, i) => {
        const [x, y] = pointAt(twig, t);
        return (
          <g key={i} transform={`translate(${x} ${y - 14})`}>
            <circle r={7 + bloom * 3} fill="#f6d0dc" />
            {bloom > 0.5 ? [0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx={Math.cos((a * Math.PI) / 180) * 17} cy={Math.sin((a * Math.PI) / 180) * 17} rx={15} ry={12} fill="#fbe3ea" stroke="#f2c4d0" strokeWidth={1} opacity={(bloom - 0.5) * 2} transform={`rotate(${a} ${Math.cos((a * Math.PI) / 180) * 17} ${Math.sin((a * Math.PI) / 180) * 17})`} />) : null}
          </g>
        );
      })}
      <Shears x={700} y={260} angle={200} scale={0.6} at={64} closeAt={78} />
      <Badge x={560} y={180} at={80} ok={false} />
      <g opacity={useProgress(100, 8)}>
        <ellipse cx={200} cy={130} rx={70} ry={30} fill="#9aa5ae" />
        {[0, 1, 2, 3].map((i) => <line key={i} x1={160 + i * 25} y1={170 + ((f * 3 + i * 10) % 40)} x2={152 + i * 25} y2={188 + ((f * 3 + i * 10) % 40)} stroke="#6fa8dc" strokeWidth={4} />)}
        <path d="M 130 90 L 270 220" stroke={RED} strokeWidth={8} strokeLinecap="round" />
      </g>
    </>
  );
};

/** 덤불은 두 해에 나눠 줄인다 — 올겨울 절반, 다음 겨울 나머지. */
export const TwoYears: React.FC = () => {
  const f = useCurrentFrame();
  const extra: P[][] = Array.from({ length: 8 }, (_, i) => {
    const a = ((-160 + i * 20) * Math.PI) / 180;
    const s: P = [500, 420 - (i % 3) * 50];
    return [s, [s[0] + Math.cos(a) * 110, s[1] + Math.sin(a) * 110], [s[0] + Math.cos(a) * 220, s[1] + Math.sin(a) * 200]];
  });
  const y1 = interpolate(f, [40, 60], [0, 1], clamp), y2 = interpolate(f, [100, 120], [0, 1], clamp);
  return (
    <>
      <Ground y={566} seed="ty" />
      <ProcTree seed="tyb" x={500} groundY={566} height={360} at={0} foliage="none" />
      {extra.map((l, i) => <g key={i} opacity={1 - (i % 2 ? y1 : y2) * 0.9}><Branch pts={l} w0={4} w1={1.5} at={6} dur={10} stroke={RED} /></g>)}
      <Label x={250} y={80} at={36} color={ACCENT} size={32}>올겨울 절반</Label>
      <Label x={750} y={80} at={96} color={ACCENT} size={32}>다음 겨울 나머지</Label>
    </>
  );
};

// ── 자두 ─────────────────────────────────────────────

/** 달력 — 1~2월에 가위. */
export const Calendar12: React.FC = () => {
  const months = ['11월', '12월', '1월', '2월', '3월'];
  return (
    <>
      <Ground y={566} seed="cal12" />
      {months.map((m, i) => {
        const hot = i === 2 || i === 3;
        return (
          <g key={i} transform={`translate(${140 + i * 180} 300)`} opacity={useProgress(i * 6, 8)}>
            <rect x={-70} y={-90} width={140} height={170} rx={14} fill="#fff" stroke={hot ? ACCENT : '#c9c3b6'} strokeWidth={hot ? 8 : 3} />
            <rect x={-70} y={-90} width={140} height={40} rx={14} fill={hot ? ACCENT : '#c9c3b6'} />
            <text y={30} textAnchor="middle" fontSize={44} fontWeight={800} fill={hot ? '#14130f' : '#8a857a'}>{m}</text>
          </g>
        );
      })}
      <Shears x={410} y={150} angle={-20} scale={0.7} at={40} closeAt={56} />
      <Label x={500} y={480} at={50} color={ACCENT} size={34}>수형 잡기와 본 전정</Label>
    </>
  );
};

/** 허공에서 뚝 — 높이선에서 자르면 잘린 끝 아래에서 새 가지가 다발로 솟는다. */
export const HeadingCut: React.FC = () => {
  const f = useCurrentFrame();
  const burst = interpolate(f, [50, 110], [0, 1], clamp);
  return (
    <>
      <Ground y={566} seed="hc" />
      <Branch pts={[[500, 575], [498, 400], [500, 200]]} w0={18} w1={13} at={0} dur={14} />
      <Draw d="M 300 200 L 700 200" at={10} color={ACCENT} width={4} dash />
      <Shears x={540} y={196} angle={200} scale={0.6} at={24} closeAt={40} hideAt={52} />
      <Chips x={500} y={200} at={40} />
      {[-40, -20, 0, 18, 36].map((a, i) => {
        const r = (a * Math.PI) / 180;
        return <Branch key={i} pts={[[500, 206 + i * 4], [500 + Math.sin(r) * 60 * burst, 206 - 60 * burst], [500 + Math.sin(r) * 130 * burst, 206 - 150 * burst]]} w0={9} w1={3} at={50 + i * 2} dur={10} fill="url(#kit-new)" />;
      })}
      <Badge x={780} y={140} at={100} ok={false} />
      <Label x={780} y={240} at={104} color={RED} size={30}>새 가지가 다발로</Label>
    </>
  );
};

/** 곁가지·바깥 눈 위에서 자르면 나무가 그 방향으로 힘을 넘긴다. */
export const LateralCut: React.FC = () => {
  const f = useCurrentFrame();
  const gone = interpolate(f, [44, 60], [0, 1], clamp);
  return (
    <>
      <Ground y={566} seed="lc" />
      <Branch pts={[[500, 575], [498, 400], [500, 300]]} w0={18} w1={13} at={0} dur={14} />
      <Branch pts={[[500, 320], [620, 250], [760, 200]]} w0={9} w1={3} at={8} dur={12} />
      <g opacity={1 - gone}><Branch pts={[[500, 300], [502, 200], [504, 80]]} w0={12} w1={4} at={6} dur={12} stroke={RED} /></g>
      <Draw d="M 470 296 L 540 288" at={20} color={RED} width={5} dash />
      <Shears x={560} y={290} angle={200} scale={0.55} at={30} closeAt={44} hideAt={56} />
      <Chips x={502} y={294} at={44} />
      <Arrow d="M 620 250 Q 720 200 820 140" at={64} color={LEAF} head={[820, 140, -30]} />
      <Label x={760} y={330} at={70} color={LEAF} size={30}>바깥 곁가지 위</Label>
      {leavesAlong([[500, 320], [620, 250], [760, 200]], 3, 'lc', 14, 26, undefined, 'serrate')}
    </>
  );
};

/** 이미 높은 나무는 2~3년에 나눠 조금씩 낮춘다. */
export const StepDown: React.FC = () => {
  const f = useCurrentFrame();
  const y = Math.min(3, Math.floor(interpolate(f, [20, 110], [0, 3.99], clamp)));
  const tops = [80, 150, 220, 290];
  return (
    <>
      <Ground y={566} seed="sd" />
      <Branch pts={[[500, 575], [498, 420], [500, 300]]} w0={20} w1={13} at={0} dur={12} />
      {[0, 1, 2].map((k) => {
        const gone = y > k ? 1 : 0;
        return (
          <g key={k} opacity={1 - gone * 0.85}>
            <Branch pts={[[500, tops[k + 1]! + 10], [500 + (k % 2 ? 40 : -40), tops[k]! + 30], [500 + (k % 2 ? 70 : -70), tops[k]!]]} w0={8} w1={2.5} at={6} dur={12} {...(gone ? { stroke: RED } : {})} />
          </g>
        );
      })}
      {[[[500, 360], [400, 320], [320, 300]], [[500, 340], [600, 300], [690, 280]]].map((l, i) => <Branch key={i} pts={l as P[]} w0={9} w1={3} at={8} dur={12} />)}
      {[0, 1, 2, 3].map((k) => <Draw key={k} d={`M 360 ${tops[k]} L 640 ${tops[k]}`} at={20 + k * 30} color={k === y ? ACCENT : '#ffffff'} width={3} dash />)}
      {[1, 2, 3].map((k) => <Label key={k} x={700} y={tops[k]! + 10} at={20 + k * 30} color={ACCENT} size={28} anchor="start">{`${k}년째`}</Label>)}
      <g opacity={1 - useProgress(60, 20)}>
        <path d="M 220 566 L 260 140 M 300 566 L 330 140" stroke="#a8854f" strokeWidth={8} />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <path key={i} d={`M ${226 + i * 5} ${520 - i * 60} L ${296 + i * 5} ${520 - i * 60}`} stroke="#a8854f" strokeWidth={6} />)}
      </g>
    </>
  );
};

// ── 감나무 ───────────────────────────────────────────

/** 춥고 바람 없는 날 오전 — 낮은 해, 멈춘 깃발, 시계 오전. */
export const ColdMorning: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <>
      <Ground y={566} seed="cmo" />
      <circle cx={160} cy={360} r={44} fill="#ffe7a0" opacity={useProgress(0, 10)} />
      <ProcTree seed="cmo" x={560} groundY={566} height={340} at={0} foliage="none" />
      <g opacity={useProgress(16, 8)}>
        <path d="M 850 566 L 850 300" stroke="#6b6b6b" strokeWidth={6} />
        <path d="M 850 300 L 850 360 L 855 360 Z" fill="#c0392b" />
        <path d="M 852 300 q 4 30 0 60" stroke="#c0392b" strokeWidth={8} fill="none" />
      </g>
      {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={260 + random(`fr${i}`) * 600} cy={120 + random(`fy${i}`) * 300} r={3} fill="#fff" opacity={0.5 + 0.5 * Math.sin(f / 8 + i)} />)}
      <g transform="translate(160 160)" opacity={useProgress(24, 8)}>
        <circle r={50} fill="#fff" stroke="#3a3d42" strokeWidth={5} />
        <line x1={0} y1={0} x2={0} y2={-34} stroke="#3a3d42" strokeWidth={5} strokeLinecap="round" />
        <line x1={0} y1={0} x2={-26} y2={-14} stroke="#3a3d42" strokeWidth={5} strokeLinecap="round" />
        <text y={86} textAnchor="middle" fontSize={28} fontWeight={800} fill={INK} stroke="#14130f" strokeWidth={4} paintOrder="stroke">오전</text>
      </g>
      <Shears x={600} y={300} angle={200} scale={0.5} at={50} closeAt={66} />
    </>
  );
};

/** 어린 감나무 모양은 3년에 나눠 잡는다 — 해마다 조금씩. */
export const ThreeYears: React.FC = () => (
  <>
    <Ground y={566} seed="tyy" />
    {[0, 1, 2].map((i) => <SmallTree key={i} x={200 + i * 300} h={200 + i * 60} n={5} at={i * 30} cut={i === 0 ? [1] : i === 1 ? [3] : [0]} cutAt={20 + i * 30} seed={`tyy${i}`} />)}
    {[0, 1, 2].map((i) => <Label key={i} x={200 + i * 300} y={110} at={i * 30} color={ACCENT} size={34}>{`${i + 1}년`}</Label>)}
    <Label x={500} y={60} at={90} color={LEAF} size={30}>애매하면 덜 자르고 다음 해에</Label>
  </>
);

/** 깍지벌레 — step 0: 가지에 갈색 비늘이 다닥다닥(돋보기), 1: 심한 가지부터 잘라낸다. */
export const ScaleInsect: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const twig: P[] = [[-60, 412], [480, 360], [1060, 290]];
  const gone = step === 1 ? interpolate(f, [40, 60], [0, 1], clamp) : 0;
  return (
    <>
      <Ground y={566} seed="si" />
      <g transform={`translate(0 ${gone * 200})`} opacity={1 - gone}>
        <Branch pts={twig} w0={36} w1={16} at={step > 0 ? DONE : 0} dur={12} />
        {Array.from({ length: 34 }, (_, i) => {
          const [x, y] = pointAt(twig, 0.25 + (i / 34) * 0.6);
          return <ellipse key={i} cx={x + (random(`sc${i}`) - 0.5) * 20} cy={y + (random(`sy${i}`) - 0.5) * 16} rx={3.6} ry={2.6} fill="#7a4a24" stroke="#4a2c14" strokeWidth={1.5} opacity={useProgress(step > 0 ? DONE : 10 + i * 2, 6)} />;
        })}
      </g>
      {step === 0 ? (
        <g transform="translate(520 340)" opacity={useProgress(46, 8)}>
          <circle r={90} fill="#cfe9f7" fillOpacity={0.25} stroke="#3a3d42" strokeWidth={10} />
          {/* 렌즈 속 — 3배로 보인 비늘(깍지벌레 2~3mm) */}
          <g clipPath="url(#lensclip)">
            <defs><clipPath id="lensclip"><circle r={84} /></clipPath></defs>
            <rect x={-90} y={-38} width={180} height={76} rx={8} fill="#6b4529" transform="rotate(-7)" />
            {Array.from({ length: 9 }, (_, i) => <ellipse key={i} cx={-70 + i * 17 + (i % 2) * 5} cy={-8 + (i % 3) * 10} rx={10} ry={7.5} fill="#7a4a24" stroke="#3b2412" strokeWidth={2} transform={`rotate(-7)`} />)}
          </g>
          <path d="M 64 64 L 130 130" stroke="#3a3d42" strokeWidth={16} strokeLinecap="round" />
          <Label x={0} y={-120} at={50} color={INK} size={30}>깍지벌레</Label>
        </g>
      ) : (
        <>
          <Shears x={140} y={390} angle={200} scale={0.55} at={24} closeAt={40} hideAt={52} />
          <Chips x={110} y={398} at={40} />
          <Branch pts={[[-60, 484], [480, 470], [1060, 446]]} w0={30} w1={16} at={DONE} />
          <Label x={500} y={140} at={56} color={LEAF} size={30}>심한 가지부터</Label>
        </>
      )}
    </>
  );
};

// ── 블루베리 ─────────────────────────────────────────

/** 블루베리는 주지를 고정하지 않는다 — 땅에서 새 줄기가 올라와 묵은 줄기를 교대한다(순환). */
export const CaneCycle: React.FC = () => {
  const f = useCurrentFrame();
  const t = interpolate(f, [10, 140], [0, 1], clamp);
  const canes = [0, 1, 2, 3].map((i) => {
    const age = Math.max(0, Math.min(1, t * 1.6 - i * 0.3));
    return { x: 420 + i * 55, age };
  });
  return (
    <>
      <Pot x={500} y={460} w={320} h={150} />
      {canes.map((c, i) => c.age > 0 ? (
        <Branch key={i} pts={[[c.x, 452], [c.x + (i - 1.5) * 20, 452 - 160 * c.age], [c.x + (i - 1.5) * 50, 452 - 300 * c.age]]} w0={10 + c.age * 12} w1={4} at={DONE} fill={c.age > 0.8 ? 'url(#kit-grey)' : c.age > 0.4 ? undefined : 'url(#kit-new)'} />
      ) : null)}
      <Arrow d="M 760 300 A 90 90 0 1 1 760 299" at={60} color={LEAF} head={[760, 299, -90]} />
      <Label x={760} y={160} at={64} color={LEAF} size={28}>새 줄기 → 교대</Label>
    </>
  );
};

/** step 0: 3년쯤 그루 아래가 굵어지고 원가지에 열매가 가장 많다, 1: 해가 갈수록 끝에 잔가지만, 알이 작아진다 → 새 줄기로. */
export const CaneAge: React.FC<{ step: number }> = ({ step }) => {
  const cane: P[] = [[480, 452], [470, 300], [440, 120]];
  const twigs = step === 1;
  return (
    <>
      <Pot x={500} y={460} w={300} h={150} />
      <Branch pts={cane} w0={step === 1 ? 17 : 14} w1={6} at={step > 0 ? DONE : 0} dur={14} {...(step === 1 ? { fill: 'url(#kit-grey)' } : {})} />
      {[0.4, 0.6, 0.8].map((t, i) => { const [x, y] = pointAt(cane, t); return <Branch key={i} pts={[[x, y], [x + 50, y - 20], [x + 90, y - 30]]} w0={7} w1={2} at={step > 0 ? DONE : 10} dur={8} {...(step === 1 ? { fill: 'url(#kit-grey)' } : {})} />; })}
      {[0.4, 0.6, 0.8].flatMap((t, i) => {
        const [x, y] = pointAt(cane, t);
        return [0, 1, 2, 3].map((k) => <circle key={`${i}${k}`} cx={x + 60 + k * 10} cy={y - 14 + (k % 2) * 10} r={twigs ? 5 : 11} fill="#3b4f8f" opacity={useProgress(step > 0 ? DONE : 20 + i * 4, 6)} />);
      })}
      {twigs ? [0.85, 0.92, 0.98].map((t, i) => { const [x, y] = pointAt(cane, t); return <Branch key={`t${i}`} pts={[[x, y], [x - 20 + i * 20, y - 30], [x - 30 + i * 30, y - 50]]} w0={3} w1={1.5} at={10 + i * 4} dur={8} fill="url(#kit-grey)" />; }) : null}
      {twigs ? <Branch pts={[[540, 452], [548, 320], [560, 200]]} w0={8} w1={4} at={50} dur={20} fill="url(#kit-new)" /> : null}
      <Label x={760} y={160} at={step > 0 ? 30 : 30} color={step === 1 ? RED : LEAF} size={30}>{step === 1 ? '알이 작아짐' : '열매가 가장 많은 때'}</Label>
      {twigs ? <Label x={760} y={420} at={70} color={LEAF} size={28}>아래 새 줄기로 세대 교체</Label> : null}
    </>
  );
};

/** 넘길 가지에 테이프 — 잎이 진 뒤에도 그대로 찾는다. */
export const TapeMark: React.FC = () => {
  const canes: P[][] = [[[470, 452], [430, 300], [360, 140]], [[520, 452], [560, 300], [640, 160]], [[540, 452], [620, 340], [720, 250]]];
  return (
    <>
      <Pot x={500} y={460} w={300} h={150} />
      {canes.map((c, i) => <Branch key={i} pts={c} w0={i === 0 ? 24 : 15} w1={5} at={i * 3} dur={12} {...(i === 0 ? { fill: 'url(#kit-grey)' } : {})} />)}
      {canes.flatMap((c, i) => leavesAlong(c, 6, `tm${i}`, 12, 22, 70 + i * 4, 'small'))}
      {[0].map((i) => { const [x, y] = pointAt(canes[i]!, 0.4); return <rect key={i} x={x - 16} y={y - 8} width={32} height={16} rx={4} fill="#f2c94c" stroke="#b8921e" strokeWidth={2} opacity={useProgress(30, 8)} transform={`rotate(-20 ${x} ${y})`} />; })}
      <Label x={760} y={160} at={36} color={ACCENT} size={28}>테이프 표시</Label>
      <Label x={760} y={420} at={110} color={LEAF} size={28}>잎이 져도 그대로</Label>
    </>
  );
};

// ── 마무리 ───────────────────────────────────────────

/** 통통한 눈이 붙은 짧은 가지 — 내년 봄의 꽃(유령 꽃이 겹쳐 핀다). */
export const SpurClose: React.FC = () => {
  const f = useCurrentFrame();
  const ghost = interpolate(f, [50, 80], [0, 0.6], clamp);
  return (
    <>
      <Branch pts={[[-60, 476], [500, 450], [1060, 414]]} w0={76} w1={60} at={0} dur={12} />
      <Branch pts={[[500, 430], [506, 380], [510, 350]]} w0={26} w1={22} at={8} dur={10} />
      <Bud x={510} y={354} kind="flower" size={20} at={18} plump={1.1} />
      <g transform="translate(512 300)" opacity={ghost}>
        {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx={Math.cos((a * Math.PI) / 180) * 40} cy={Math.sin((a * Math.PI) / 180) * 40} rx={30} ry={22} fill="#fde3ea" />)}
        <circle r={16} fill="#f2c94c" />
      </g>
      <Label x={780} y={200} at={40} color={ACCENT} size={30}>손가락 한 마디</Label>
      <Label x={250} y={180} at={60} color={LEAF} size={30}>내년 봄의 꽃</Label>
    </>
  );
};

/** step 0(사과·배): 짧은 가지에 열매가 몰리고, 위를 덮은 긴 가지를 정리. step 1(자두·매실): 짧은 가지·새 가지 둘 다 남긴다. */
export const FruitingWood: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const main: P[] = [[-60, 300], [500, 280], [1060, 250]];
  const long: P[] = [[300, 288], [540, 170], [820, 110]];
  const cut = step === 0 ? interpolate(f, [60, 80], [0, 1], clamp) : 0;
  return (
    <>
      <Ground y={566} seed="fw" />
      <Branch pts={main} w0={50} w1={36} at={0} dur={12} />
      {[0.15, 0.38, 0.62, 0.85].map((t, i) => {
        const [x, y] = pointAt(main, t);
        return (
          <g key={i}>
            <Branch pts={[[x, y + 10], [x + 4, y + 30], [x + 6, y + 50]]} w0={15} w1={12} at={8 + i * 2} dur={8} />
            <Fruit x={x + 8} y={y + 50 + (step === 0 ? 66 : 44)} r={step === 0 ? 66 : 44} at={14 + i * 3} color={step === 0 ? '#e05a3a' : '#7b3f8c'} />
          </g>
        );
      })}
      {step === 0 ? (
        <g opacity={1 - cut}><Branch pts={long} w0={20} w1={6} at={20} dur={14} stroke={RED} />{leavesAlong(long, 4, 'fw', 30, 30, undefined, 'serrate')}</g>
      ) : (
        <>
          <Branch pts={long} w0={18} w1={6} at={DONE} fill="url(#kit-new)" />
          {[0.5, 0.8].map((t, i) => { const [x, y] = pointAt(long, t); return <Fruit key={i} x={x} y={y + 52} r={40} at={20 + i * 6} color="#7b3f8c" />; })}
          <Badge x={130} y={180} at={40} ok /><Badge x={860} y={90} at={46} ok />
        </>
      )}
      {step === 0 ? <><Shears x={330} y={276} angle={200} scale={0.5} at={46} closeAt={60} hideAt={72} /><Label x={200} y={140} at={20} color={INK} size={28}>사과·배</Label></> : <Label x={200} y={140} at={10} color={INK} size={28}>자두·매실</Label>}
    </>
  );
};

/** 낙엽이 진 뒤에는 눈만 남아 또렷하다. */
export const BudReveal: React.FC = () => {
  const twig: P[] = [[-60, 432], [500, 390], [1060, 320]];
  const f = useCurrentFrame();
  return (
    <>
      <Ground y={566} seed="br" />
      <Branch pts={twig} w0={30} w1={14} at={0} dur={12} />
      {[0.2, 0.38, 0.56, 0.74, 0.9].flatMap((t, i) => {
        const [x, y] = pointAt(twig, t);
        return [
          <Leaf key={`l${i}`} x={x} y={y - 6} angle={-60 - i * 6} size={70} at={4 + i} fallAt={24 + i * 6} seed={`br${i}`} />,
          <Bud key={`b${i}`} x={x + 4} y={y - 8} kind={i % 2 ? 'flower' : 'leaf'} size={i % 2 ? 22 : 16} at={60 + i * 4} />,
        ];
      })}
      <circle cx={500} cy={300} r={260} fill="url(#kit-glow)" opacity={0.25 * interpolate(f, [70, 100], [0, 1], clamp)} />
    </>
  );
};

/** step 0: 원줄기 굵기의 절반을 넘으면 이미 뼈대, 1: 지웠다고 상상하면 윗부분에 뻥 뚫린 자리 → 둔다. */
export const ScaffoldThick: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const ghost = step === 1 ? interpolate(f, [16, 40], [1, 0.15], clamp) : 1;
  return (
    <>
      <Ground y={566} seed="sth" />
      <Branch pts={[[440, 700], [442, 300], [440, -80]]} w0={92} w1={84} at={step > 0 ? DONE : 0} dur={12} />
      <g opacity={ghost}>
        <Branch pts={[[480, 330], [620, 270], [800, 220]]} w0={56} w1={18} at={step > 0 ? DONE : 6} dur={14} />
        {leavesAlong([[600, 270], [800, 220]], 4, 'sth', step > 0 ? DONE : 18, 32, undefined, 'serrate')}
      </g>
      {step === 0 ? (
        <>
          <Draw d="M 395 420 L 485 420" at={24} color={ACCENT} width={5} />
          <Draw d="M 500 300 L 500 356" at={34} color={ACCENT} width={5} />
          <Label x={440} y={460} at={26} color={ACCENT} size={28}>원줄기</Label>
          <Label x={560} y={250} at={36} color={ACCENT} size={28} anchor="start">절반 넘게 굵다</Label>
        </>
      ) : (
        <>
          <ellipse cx={680} cy={230} rx={170} ry={110} fill="none" stroke={RED} strokeWidth={5} strokeDasharray="14 10" opacity={useProgress(30, 8)} />
          <Label x={680} y={100} at={36} color={RED} size={30}>뻥 뚫린 자리</Label>
          <Badge x={860} y={420} at={60} ok />
        </>
      )}
    </>
  );
};

/** 굵은 가지를 밑동에서 자르면 둘레에서 곧은 순이 여러 개 솟는다. */
export const StubSprouts: React.FC = () => {
  const f = useCurrentFrame();
  const g = interpolate(f, [30, 110], [0, 1], clamp);
  const edgeX = 330, y = 330, bw = 62;
  return (
    <>
      <Branch pts={[[275, 700], [279, 300], [273, -80]]} w0={112} w1={104} at={0} dur={10} />
      <CollarJoint edgeX={edgeX} y={y} bw={bw} len={600} state="flush" at={4} />
      {[-34, -16, 2, 18, 34].map((a, i) => {
        const r = (a * Math.PI) / 180;
        const sx = edgeX - 6 + (i % 2) * 8, sy = y - bw * 0.9 + i * bw * 0.4;
        return <Branch key={i} pts={[[sx, sy], [sx + 20 + Math.sin(r) * 30 * g, sy - 90 * g], [sx + 30 + Math.sin(r) * 50 * g, sy - 200 * g]]} w0={7} w1={2.5} at={30 + i * 4} dur={14} fill="url(#kit-new)" />;
      })}
      <Label x={760} y={160} at={90} color={RED} size={30}>곧은 순이 여러 개</Label>
    </>
  );
};

/** 부담스러운 굵은 가지는 끝만 짧게, 잔가지를 줄여 빛이 통하게. */
export const TipTrim: React.FC = () => {
  const f = useCurrentFrame();
  const main: P[] = [[160, 400], [520, 330], [880, 280]];
  const twigs = [0.3, 0.45, 0.6, 0.75];
  return (
    <>
      <Ground y={566} seed="tt" />
      <Branch pts={[[140, 700], [142, 300], [140, -80]]} w0={84} w1={76} at={0} dur={12} />
      <Branch pts={[main[0]!, main[1]!, pointAt(main, interpolate(f, [30, 44], [1, 0.9], clamp))]} w0={40} w1={14} at={4} dur={12} />
      {twigs.map((t, i) => {
        const [x, y] = pointAt(main, t);
        const gone = i % 2 ? interpolate(f, [60 + i * 6, 72 + i * 6], [0, 1], clamp) : 0;
        return <g key={i} opacity={1 - gone * 0.9}><Branch pts={[[x, y], [x + 30, y - 50], [x + 50, y - 90]]} w0={8} w1={2} at={10 + i * 2} dur={8} {...(i % 2 ? { stroke: RED } : {})} /></g>;
      })}
      <Shears x={830} y={260} angle={200} scale={0.45} at={18} closeAt={30} hideAt={40} />
      {/* 솎아 낸 틈으로 드는 햇살 — 부드러운 빛줄기 */}
      {[0, 1, 2].map((i) => <path key={i} d={`M ${280 + i * 140} -20 L ${340 + i * 140} -20 L ${420 + i * 140} 320 L ${330 + i * 140} 320 Z`} fill="#fff3b0" opacity={0.22 * interpolate(f, [90, 120], [0, 1], clamp)} filter="url(#kit-soft)" />)}
    </>
  );
};

/** 굵은 가지를 꼭 빼야 한다면 — 강추위는 피하고 늦겨울~이른 봄. */
export const LateWinter: React.FC = () => {
  const f = useCurrentFrame();
  const temp = interpolate(f, [20, 90], [0, 1], clamp);
  return (
    <>
      <Ground y={566} seed="lw" />
      {Array.from({ length: 18 }, (_, i) => <circle key={i} cx={60 + random(`sn${i}`) * 880} cy={(random(`sy${i}`) * 500 + f * 2) % 520} r={4} fill="#fff" opacity={0.85 * (1 - temp)} />)}
      <g transform="translate(150 300)">
        <rect x={-14} y={-160} width={28} height={220} rx={14} fill="#fff" stroke="#3a3d42" strokeWidth={4} />
        <circle cy={80} r={28} fill="#e05a48" stroke="#3a3d42" strokeWidth={4} />
        <rect x={-7} y={60 - 200 * (0.2 + temp * 0.45)} width={14} height={200 * (0.2 + temp * 0.45)} fill="#e05a48" />
      </g>
      {['한겨울', '늦겨울', '이른 봄'].map((m, i) => (
        <g key={i} transform={`translate(${400 + i * 200} 200)`} opacity={useProgress(i * 10, 8)}>
          <rect x={-80} y={-50} width={160} height={100} rx={14} fill="#fff" stroke={i === 0 ? '#9aa5ae' : ACCENT} strokeWidth={i === 0 ? 3 : 7} />
          <text y={12} textAnchor="middle" fontSize={32} fontWeight={800} fill={i === 0 ? '#9aa5ae' : '#14130f'}>{m}</text>
        </g>
      ))}
      <path d="M 330 140 L 470 260" stroke={RED} strokeWidth={7} opacity={useProgress(30, 8)} strokeLinecap="round" />
      <Saw x={700} y={420} angle={0} scale={0.55} at={70} strokes={3} dur={24} />
    </>
  );
};

/** step 0: 올해 새로 심은 나무 — 부러진·마른·병든 가지만 정리하고 손을 뗀다, 1: 잎이 만든 양분이 뿌리로, 새 뿌리. */
export const NewPlant: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const base = step > 0 ? DONE : 0;
  const roots = step === 1 ? interpolate(f, [20, 110], [0, 1], clamp) : 0;
  const twigs: Array<[P[], string | undefined]> = [[[[500, 330], [440, 300], [400, 290]], 'url(#kit-grey)'], [[[500, 300], [560, 270], [600, 230]], undefined], [[[500, 280], [470, 230], [450, 200]], undefined]];
  return (
    <>
      <rect x={40} y={420} width={920} height={180} rx={18} fill="url(#kit-soil)" />
      <Branch pts={[[500, 430], [502, 330], [500, 200]]} w0={9} w1={4} at={base} dur={12} />
      <path d="M 530 430 L 530 180" stroke="#c9a46a" strokeWidth={7} opacity={useProgress(base + 4, 8)} />
      {twigs.map(([l, fill], i) => {
        const cutAt = 30 + i * 18;
        const gone = step === 0 ? interpolate(f, [cutAt, cutAt + 10], [0, 1], clamp) : 1;
        return <g key={i} opacity={1 - gone}><Branch pts={l} w0={3.5} w1={1.5} at={base + 6} dur={8} stroke={RED} {...(fill ? { fill } : {})} /></g>;
      })}
      {leafCluster(500, 200, 'np', base + 10, 24, undefined, 'serrate', 4)}
      {step === 1 ? (
        <>
          {[-60, -25, 15, 50].map((a, i) => {
            const r = (a * Math.PI) / 180;
            return <path key={i} d={`M 500 440 Q ${500 + Math.sin(r) * 80 * roots} ${470 + 40 * roots} ${500 + Math.sin(r) * 200 * roots} ${470 + 100 * roots}`} stroke="#d9b48c" strokeWidth={5} fill="none" />;
          })}
          <Arrow d="M 560 210 Q 620 320 560 430" at={10} color={LEAF} head={[560, 430, 100]} />
          <Label x={760} y={330} at={14} color={LEAF} size={28}>양분이 뿌리로</Label>
          <Label x={760} y={560} at={70} color={ACCENT} size={28}>새 뿌리</Label>
        </>
      ) : <Label x={760} y={200} at={80} color={LEAF} size={28}>여기까지만</Label>}
    </>
  );
};

/** step 0: 짧은 가지마다 통통한 눈을 세어 본다, 1: 다 세어 본 다음에 가위를 든다. */
export const BudCount: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const main: P[] = [[-60, 436], [500, 410], [1060, 374]];
  const spots = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
  const n = step === 0 ? Math.min(6, Math.floor(interpolate(f, [16, 110], [0, 6.99], clamp))) : 6;
  return (
    <>
      <Ground y={566} seed="bc" />
      <Branch pts={main} w0={40} w1={20} at={step > 0 ? DONE : 0} dur={12} />
      {spots.map((t, i) => {
        const [x, y] = pointAt(main, t);
        return (
          <g key={i}>
            <Branch pts={[[x, y - 10], [x + 4, y - 30], [x + 6, y - 44]]} w0={13} w1={11} at={step > 0 ? DONE : 6 + i} dur={8} />
            <Bud x={x + 6} y={y - 42} kind="flower" size={12} at={step > 0 ? DONE : 10 + i} />
            {i < n ? <text x={x + 6} y={y - 100} textAnchor="middle" fontSize={34} fontWeight={800} fill={ACCENT} stroke="#14130f" strokeWidth={5} paintOrder="stroke">{i + 1}</text> : null}
          </g>
        );
      })}
      {step === 1 ? <><Badge x={500} y={180} at={10} ok /><Shears x={500} y={520} angle={-10} scale={0.7} at={30} /></> : null}
    </>
  );
};
