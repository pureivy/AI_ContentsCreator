// 롱폼 개념 도해(모션그래픽) — 선이 그려지며 나타나고, 말한 대상을 알아보는 모양으로 그린다.
// 숏폼 MG 디테일 지시(2026-10-16): 대상의 생김새·지금 말하는 것 강조·상황→행동 화살표.
// 좌표는 viewBox 1000×600 기준.
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import type { Mg } from './types';
import { ACCENT, INK, LEAF, MUTED } from './InfoPanel';
import { Backdrop, Branch, Bud, Camera, Chips, CollarJoint, Coin, Gardener, Ground, KitDefs, MacroCtx, MiniTree, Pot, ProcTree, Saw, Shears, WoodSection, leafCluster, leavesAlong } from './illus/Kit';
import { pointAt } from './illus/geom';
import { Arrow, Badge, Callout, Draw, GREY, Label, RED, WOOD, useProgress } from './diagramParts';
import * as D3 from './Diagrams3';
import { BlueberrySeason, BranchTypes, CalendarSteps, CutSpots, DontCut, HalfPair, PruneOrder, Ribbon, ScaffoldPick, SeasonSplit, SpurSprout, SunHours, Thickness2, YoungPersimmon } from './Diagrams2';

// ── 개별 도해 ──────────────────────────────────────────────────────────────

const Timeline: React.FC<{ start: string; end: string }> = ({ start, end }) => {
  const band = useProgress(30, 22);
  const frame = useCurrentFrame();
  const pulse = 1 + 0.15 * Math.sin(frame / 5);
  return (
    <>
      <MiniTree x={170} y={390} mode="leafy" at={0} scale={1.15} />
      <MiniTree x={500} y={390} mode="leafy" at={6} scale={1.15} fallAt={20} />
      <MiniTree x={830} y={390} mode="budding" at={12} scale={1.15} />
      <Draw d="M 60 420 L 940 420" at={0} color={GREY} width={8} />
      <rect x={300} y={402} width={400 * band} height={36} rx={12} fill={ACCENT} opacity={0.85} />
      <g transform={`translate(170 420) scale(${pulse})`}><circle r={14} fill={LEAF} /></g>
      <Label x={170} y={478} at={8} color={LEAF} size={30}>지금 · 잎 있음</Label>
      <Label x={500} y={478} at={12} color={MUTED} size={30}>휴면기</Label>
      <Label x={830} y={478} at={16} color={MUTED} size={30}>눈 트는 때</Label>
      <Draw d="M 300 396 L 300 520" at={22} color={INK} width={5} />
      <Draw d="M 700 396 L 700 520" at={24} color={INK} width={5} />
      <Label x={300} y={560} at={26} size={32}>{start}</Label>
      <Label x={700} y={560} at={30} size={32}>{end}</Label>
      <Shears x={350} y={66} angle={-8} scale={0.7} at={44} closeAt={62} />
      <Label x={560} y={78} at={46} color={ACCENT} size={42}>가위 드는 때</Label>
    </>
  );
};

const Angle: React.FC<{ ok: boolean }> = ({ ok }) => {
  const frame = useCurrentFrame();
  const deg = ok ? 45 : 22;
  const rad = (deg * Math.PI) / 180;
  const crotch: [number, number] = [500, 360];
  const tipAt = (len: number, bend = 0): [number, number] => [crotch[0] + Math.sin(rad) * len + bend, crotch[1] - Math.cos(rad) * len];
  const limb: Array<[number, number]> = [crotch, tipAt(150, -6), tipAt(310)];
  // 좁은 각은 열매 무게에 찢어진다 — 끝에서 가지가 바깥으로 기운다.
  const tear = ok ? 0 : interpolate(frame, [58, 78], [0, 9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  const arcR = 120;
  const [ax, ay] = [crotch[0] + Math.sin(rad) * arcR, crotch[1] - Math.cos(rad) * arcR];
  return (
    <>
      <Ground y={560} seed="ang" />
      <Branch pts={[[500, 572], [496, 420], [502, 250], [498, 60]]} w0={24} w1={12} at={0} dur={22} />
      <g transform={`rotate(${tear} ${crotch[0]} ${crotch[1]})`}>
        <Branch pts={limb} w0={12} w1={3} at={14} dur={20} />
        {[0.45, 0.7].map((t, i) => { const [bx, by] = pointAt(limb, t); return <Branch key={i} pts={[[bx, by], [bx + (i ? 30 : -24), by - 40], [bx + (i ? 44 : -30), by - 78]]} w0={9} w1={2.5} at={26 + i * 3} dur={12} />; })}
        {leavesAlong(limb, 6, `ang${ok}`, 30, 28)}
        {leafCluster(...pointAt(limb, 1), `angtip${ok}`, 36, 26)}
        {ok ? null : [0.55, 0.8].map((t, i) => { const [fx, fy] = pointAt(limb, t); return <circle key={i} cx={fx + 14} cy={fy + 18} r={16} fill="#c9a23a" opacity={useProgress(40 + i * 4, 8)} />; })}
      </g>
      {ok ? null : <path d={`M 500 366 L 506 330 L 512 366 Z`} fill="#2a1a0e" opacity={useProgress(34, 10)} />}
      <Draw d={`M ${crotch[0]} ${crotch[1] - arcR} A ${arcR} ${arcR} 0 0 1 ${ax} ${ay}`} at={30} color={ok ? LEAF : RED} width={8} />
      <Label x={ok ? 640 : 330} y={ok ? 300 : 260} at={36} color={ok ? LEAF : RED} size={44}>{ok ? '45°↑' : '30° 미만'}</Label>
      {ok ? null : <Draw d="M 492 380 L 478 410 L 496 432 L 480 462" at={60} color={RED} width={6} />}
      {ok ? null : <Callout x={506} y={350} tx={330} ty={430} at={44} color={RED}>껍질이 말려 들어간 자리</Callout>}
      <Badge x={800} y={170} at={48} ok={ok} />
      <Label x={800} y={262} at={52} color={ok ? LEAF : RED} size={32}>{ok ? '남길 주지' : '열매 달린 해에 찢어짐'}</Label>
    </>
  );
};

const TopView: React.FC<{ spread: boolean }> = ({ spread }) => {
  const emptyFade = useProgress(44, 12);
  const dirs = spread ? [0, 125, 235] : [160, 185, 210];
  const ends = dirs.map((d) => { const r = (d * Math.PI) / 180; return [500 + Math.sin(r) * 210, 310 - Math.cos(r) * 210] as [number, number]; });
  return (
    <>
      <ellipse cx={500} cy={310} rx={250} ry={250} fill="#3f6b33" opacity={0.18} />
      <Draw d="M 500 60 A 250 250 0 1 1 499.9 60" at={0} color="#ffffff" width={3} dash />
      <Label x={500} y={44} at={4} color={INK} size={30}>북</Label>
      <Label x={500} y={600} at={4} color={INK} size={30}>남</Label>
      {ends.map((e, i) => (
        <g key={i}>
          <Branch pts={[[500, 310], [500 + (e[0] - 500) * 0.5 + 10, 310 + (e[1] - 310) * 0.5], e]} w0={14} w1={4} at={10 + i * 6} dur={16} />
          {leavesAlong([[500, 310], e], 4, `tv${spread}${i}`, 26 + i * 4, 30, undefined, 'serrate')}
        </g>
      ))}
      <WoodSection x={500} y={310} r={30} />
      {spread
        ? <Badge x={850} y={300} at={44} ok />
        : <>
            <path d="M 280 310 A 220 220 0 0 1 720 310 Z" fill={RED} opacity={0.22 * emptyFade} />
            <Label x={500} y={190} at={48} color={RED} size={40}>몇 년째 빈 자리</Label>
            <Badge x={850} y={300} at={52} ok={false} />
          </>}
      <Label x={850} y={380} at={48} color={spread ? LEAF : RED} size={30}>{spread ? '서로 다른 방향' : '셋 다 남쪽'}</Label>
    </>
  );
};

const Graft: React.FC = () => {
  const frame = useCurrentFrame();
  const gone = interpolate(frame, [70, 92], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <Ground y={560} seed="graft" />
      <Branch pts={[[500, 572], [498, 400], [502, 250], [500, 130]]} w0={20} w1={11} at={0} dur={20} />
      <path d="M 486 394 Q 500 386 514 394 Q 516 404 500 406 Q 484 404 486 394 Z" fill="#6e4a2c" opacity={useProgress(14, 10)} />
      <Callout x={514} y={398} tx={660} ty={420} at={18} color={ACCENT}>접목 부위</Callout>
      <Branch pts={[[500, 260], [420, 190], [370, 120]]} w0={8} w1={2.5} at={10} dur={16} />
      <Branch pts={[[502, 220], [590, 160], [640, 100]]} w0={7} w1={2.5} at={12} dur={16} />
      {leavesAlong([[500, 260], [420, 190], [370, 120]], 4, 'gu1', 26, 30, undefined, 'serrate')}
      {leavesAlong([[502, 220], [590, 160], [640, 100]], 4, 'gu2', 28, 30, undefined, 'serrate')}
      <Label x={720} y={160} at={30} color={LEAF} size={32}>심은 품종</Label>
      <g opacity={1 - gone} transform={`translate(${-gone * 30} ${gone * 30})`}>
        <Branch pts={[[492, 488], [440, 440], [400, 360]]} w0={6} w1={2} at={30} dur={16} stroke={RED} />
        {leavesAlong([[492, 488], [440, 440], [400, 360]], 3, 'gs', 40, 24, undefined, 'oval')}
      </g>
      <Label x={330} y={340} at={44} color={RED} size={34} anchor="end">대목순</Label>
      <Shears x={470} y={500} angle={200} scale={0.6} at={56} closeAt={70} hideAt={82} />
      <Chips x={490} y={488} at={70} />
      <Label x={230} y={530} at={74} color={RED} size={30}>보이는 즉시 제거</Label>
    </>
  );
};

const BudCut: React.FC = () => {
  const frame = useCurrentFrame();
  const fall = interpolate(frame, [62, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  return (
    <>
      <Ground y={566} seed="bud" />
      <Branch pts={[[400, 580], [402, 420], [400, 300]]} w0={34} w1={26} at={0} dur={16} />
      <g transform={`translate(${fall * -20} ${fall * 280}) rotate(${-fall * 60} 400 292)`} opacity={1 - fall * 0.8}>
        <Branch pts={[[400, 302], [398, 200], [404, 80]]} w0={26} w1={14} at={6} dur={14} />
      </g>
      <Bud x={414} y={330} angle={58} kind="leaf" size={26} at={14} />
      <Callout x={436} y={318} tx={560} ty={380} at={22} color={LEAF}>바깥 눈</Callout>
      <Draw d="M 350 296 L 460 286" at={30} color={RED} width={5} dash />
      <Label x={250} y={250} at={34} color={RED} size={32}>5mm 남짓 위</Label>
      <Shears x={350} y={292} angle={-6} scale={0.7} at={40} closeAt={62} hideAt={74} />
      <Chips x={400} y={292} at={62} />
      <Arrow d="M 440 316 Q 600 250 700 130" at={76} head={[700, 130, -55]} />
      <Label x={690} y={104} at={84} color={ACCENT} size={32} anchor="end">내년 가지 방향</Label>
      <Label x={90} y={470} at={92} color={INK} size={26} weight={700} anchor="start">너무 바짝 → 눈이 마름</Label>
      <Label x={90} y={510} at={96} color={INK} size={26} weight={700} anchor="start">2~3cm 남김 → 토막이 마름</Label>
    </>
  );
};

const Collar: React.FC = () => {
  const frame = useCurrentFrame();
  const cutAt = 64;
  const cut = frame >= cutAt;
  const drop = interpolate(frame, [cutAt, cutAt + 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  const heal = interpolate(frame, [90, 130], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const edgeX = 330, y = 300, bw = 62;
  const cutX = edgeX + bw * 0.4;
  return (
    <>
      <Branch pts={[[275, 700], [279, 300], [273, -80]]} w0={112} w1={104} at={0} dur={10} />
      <CollarJoint edgeX={edgeX} y={y} bw={bw} len={620} state={cut ? 'cut' : 'whole'} at={4} heal={heal} />
      {cut ? (
        <g transform={`translate(${drop * 40} ${drop * 300}) rotate(${drop * 25} ${cutX} ${y})`} opacity={1 - drop * 0.8}>
          <Branch pts={[[cutX, y - 2], [edgeX + 250, y - 9], [edgeX + 620, y - 31]]} w0={bw * 0.98} w1={bw * 0.55} at={-999} />
        </g>
      ) : null}
      <Callout x={edgeX + 14} y={y - bw * 0.72} tx={470} ty={150} at={18} color={ACCENT}>지륭 — 부푼 테두리</Callout>
      <Draw d={`M ${cutX} ${y - bw * 0.8} L ${cutX} ${y + bw * 0.8}`} at={30} color={RED} width={4} dash />
      <Saw x={cutX} y={y} angle={90} scale={0.5} at={40} strokes={3} dur={24} hideAt={cutAt + 2} />
      <Label x={470} y={470} at={36} color={RED} size={30} anchor="start">테두리 바로 바깥에서</Label>
      <Label x={470} y={520} at={96} color={LEAF} size={30} anchor="start">몇 년 안에 도넛처럼 메워짐</Label>
    </>
  );
};

const ThreeCut: React.FC = () => {
  const frame = useCurrentFrame();
  const drop = interpolate(frame, [52, 74], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  const final = frame >= 100;
  const edgeX = 205, y = 300, bw = 54;
  return (
    <>
      <Branch pts={[[150, 700], [154, 300], [148, -80]]} w0={104} w1={96} at={0} dur={10} />
      {/* ①·② 뒤 남은 토막(지륭~680) — 마지막 ③에서 지륭 바깥으로 정리 */}
      <CollarJoint edgeX={edgeX} y={y} bw={bw} len={drop > 0 ? 470 : 760} state={final ? 'cut' : 'whole'} at={4} />
      {drop > 0 && !final ? <ellipse cx={edgeX + 470} cy={y - 18} rx={8} ry={bw * 0.42} fill="#e7c08c" stroke="#5d3c24" strokeWidth={2} /> : null}
      {drop < 1 ? (
        <g transform={`translate(${drop * 30} ${drop * 300}) rotate(${drop * 40} ${edgeX + 470} ${y})`} opacity={1 - drop * 0.7}>
          {drop > 0 ? <Branch pts={[[edgeX + 470, y - 18], [edgeX + 620, y - 26], [edgeX + 760, y - 40]]} w0={bw * 0.75} w1={bw * 0.5} at={-999} /> : null}
        </g>
      ) : null}
      <Saw x={edgeX + 420} y={y + 30} angle={-90} scale={0.4} at={16} strokes={2} dur={16} hideAt={34} />
      <Label x={edgeX + 420} y={y + 110} at={18} color={INK} size={28}>① 밑면에 톱자국</Label>
      <Saw x={edgeX + 470} y={y - 40} angle={90} scale={0.4} at={36} strokes={2} dur={16} hideAt={54} />
      <Label x={edgeX + 500} y={y - 110} at={38} color={INK} size={28}>② 바깥에서 위로부터</Label>
      <Chips x={edgeX + 470} y={y} at={52} />
      <Saw x={edgeX + bw * 0.4} y={y - 30} angle={90} scale={0.4} at={80} strokes={2} dur={16} hideAt={98} />
      <Label x={edgeX + 70} y={y + 170} at={84} color={ACCENT} size={28} anchor="start">③ 지륭 바깥에서 마무리</Label>
    </>
  );
};

const Reach: React.FC = () => {
  const lineY = 138;
  return (
    <>
      <Ground y={560} seed="reach" />
      <Gardener x={230} groundY={560} scale={1.25} reachAt={4} />
      <ProcTree seed="reach7" x={700} groundY={566} height={380} at={0} depth={3} spread={30} leafSize={24} leaf="serrate" />
      {/* 손끝 높이 위로 솟은 가지 — 높이만 보여 준다(자르는 자리는 곁가지 위, 다음 문장들의 몫). */}
      <Branch pts={[[700, 410], [703, 260], [708, 80]]} w0={6} w1={2.5} at={22} dur={18} stroke={RED} />
      <Draw d={`M 330 ${lineY} L 960 ${lineY}`} at={28} color={ACCENT} width={5} dash />
      <Label x={670} y={lineY - 20} at={32} color={ACCENT} size={34} anchor="end">손끝 = 높이 상한</Label>
      <Label x={830} y={92} at={44} color={RED} size={30}>손끝 위로 솟은 가지</Label>
    </>
  );
};

const TipBud: React.FC = () => {
  const frame = useCurrentFrame();
  const glow = 0.6 + 0.4 * Math.sin(frame / 6);
  const twig: Array<[number, number]> = [[-60, 540], [450, 380], [820, 230]];
  return (
    <>
      <Ground y={566} seed="tip" />
      <Branch pts={twig} w0={30} w1={14} at={0} dur={18} />
      {[0.3, 0.5, 0.68].map((t, i) => { const [x, y] = pointAt(twig, t); return <Bud key={i} x={x} y={y - 6} angle={-20} kind="leaf" size={14} at={10 + i * 3} />; })}
      <circle cx={812} cy={214} r={46} fill="url(#kit-glow)" opacity={glow * useProgress(22, 8)} />
      <Bud x={820} y={232} angle={60} kind="flower" size={15} at={18} />
      <Bud x={792} y={246} angle={-10} kind="flower" size={13} at={20} />
      <Callout x={824} y={200} tx={880} ty={110} at={26} color={ACCENT}>열매 눈</Callout>
      <Label x={430} y={210} at={30} color={INK} size={28} weight={700}>지난해 자란 가지 끝</Label>
      <Draw d="M 740 170 L 772 330" at={44} color={RED} width={5} dash />
      <Shears x={740} y={160} angle={70} scale={0.6} at={46} closeAt={64} />
      <Badge x={600} y={170} at={66} ok={false} />
      <Label x={600} y={530} at={70} color={RED} size={32}>끝을 다 자르면 그해 열매가 사라짐</Label>
    </>
  );
};

const Half: React.FC = () => {
  const frame = useCurrentFrame();
  const limbs: Array<Array<[number, number]>> = [
    [[500, 360], [360, 290], [260, 220]], [[500, 340], [420, 230], [380, 130]], [[500, 330], [500, 210], [500, 90]],
    [[500, 330], [580, 220], [620, 120]], [[500, 345], [640, 280], [740, 210]], [[500, 380], [650, 360], [780, 330]],
  ];
  const cut = [1, 3, 5];
  return (
    <>
      <Ground y={566} seed="half" />
      <Branch pts={[[500, 580], [502, 450], [500, 340]]} w0={18} w1={11} at={0} dur={16} />
      {limbs.map((l, i) => {
        const k = cut.indexOf(i);
        const gone = k < 0 ? 0 : interpolate(frame, [44 + k * 12, 56 + k * 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <g key={i} opacity={1 - gone * 0.85}>
            <Branch pts={l} w0={6} w1={2} at={8 + i * 3} dur={14} {...(k >= 0 ? { stroke: RED } : {})} />
          </g>
        );
      })}
      {cut.map((i, k) => { const [x, y] = pointAt(limbs[i]!, 0.25); return <Shears key={i} x={x} y={y} angle={-40} scale={0.45} at={36 + k * 12} closeAt={44 + k * 12} hideAt={52 + k * 12} />; })}
      <Label x={500} y={56} at={84} color={ACCENT} size={42}>6개 중 최대 3개까지</Label>
    </>
  );
};

const Cane: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [70, 96], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const canes: Array<Array<[number, number]>> = [[[520, 452], [560, 300], [640, 160]], [[540, 452], [620, 340], [720, 250]], [[480, 452], [440, 330], [380, 230]]];
  return (
    <>
      <Pot x={500} y={460} w={300} h={150} />
      <g opacity={1 - fade * 0.85} transform={`translate(${-fade * 30} ${fade * 40}) rotate(${-fade * 12} 470 452)`}>
        <Branch pts={[[470, 452], [430, 300], [360, 130]]} w0={15} w1={7} at={0} dur={18} fill="url(#kit-grey)" />
        {[0.55, 0.8].map((t, i) => { const [x, y] = pointAt([[470, 452], [430, 300], [360, 130]], t); return <Branch key={i} pts={[[x, y], [x - 30, y - 30], [x - 50, y - 44]]} w0={6} w1={2} at={10} dur={10} fill="url(#kit-grey)" />; })}
      </g>
      <Label x={250} y={120} at={14} color={INK} size={30}>묵은 회색 원가지</Label>
      {canes.map((c, i) => (
        <g key={i}>
          <Branch pts={c} w0={9} w1={3} at={6 + i * 3} dur={16} />
        </g>
      ))}
      <Branch pts={[[500, 452], [506, 340], [500, 210]]} w0={8} w1={4} at={34} dur={24} fill="url(#kit-new)" />
      <Label x={560} y={200} at={50} color={LEAF} size={30} anchor="start">새 줄기</Label>
      <Shears x={440} y={470} angle={-150} scale={0.55} at={56} closeAt={70} hideAt={82} />
      <Chips x={466} y={452} at={70} />
      <Label x={760} y={560} at={86} color={ACCENT} size={30}>한 해에 하나씩 교체</Label>
    </>
  );
};

const Buds: React.FC = () => {
  const plump = useProgress(30, 18);
  return (
    <>
      <Branch pts={[[-60, 478], [500, 440], [1060, 396]]} w0={66} w1={54} at={0} dur={16} />
      <Bud x={300} y={432} angle={-8} kind="leaf" size={52} at={10} />
      <Label x={300} y={250} at={16} color={LEAF} size={36}>잎눈</Label>
      <Label x={300} y={540} at={18} color={INK} size={28} weight={700}>납작 · 끝이 뾰족</Label>
      <Bud x={700} y={414} angle={-6} kind="flower" size={50} at={14} plump={0.8 + plump * 0.4} />
      <circle cx={700} cy={360} r={110} fill="url(#kit-glow)" opacity={0.35 * plump} />
      <Label x={700} y={230} at={34} color={ACCENT} size={36}>꽃눈 · 내년 봄의 꽃</Label>
      <Label x={700} y={540} at={36} color={INK} size={28} weight={700}>둥글고 통통</Label>
      <Arrow d="M 400 360 L 590 360" at={44} color={INK} head={[590, 360, 0]} />
      <Label x={495} y={330} at={48} color={INK} size={26} weight={700}>옆 눈과 비교</Label>
    </>
  );
};

/** 도해별 확대 지점 — 그 순간 말하는 부위로 카메라가 들어간다. */
const FOCUS: Partial<Record<Mg['kind'], { x: number; y: number; at: number; scale?: number }>> = {
  budcut: { x: 480, y: 300, at: 24, scale: 1.2 },
  collar: { x: 520, y: 300, at: 26, scale: 1.15 },
  tipbud: { x: 640, y: 300, at: 30, scale: 1.15 },
};

/** 확대 장면 — 땅·하늘 대신 초점이 나간 숲 배경(나무의 일부를 가까이 본 것). */
const MACRO = new Set<Mg['kind']>(['collar', 'flushCut', 'threecut', 'cutSpots', 'stubSprouts', 'scaffoldThick', 'slowHeal', 'tipTrim', 'budcut', 'tipbud', 'buds',
  'spurClose', 'fruitingWood', 'budReveal', 'budCount', 'spurSprout', 'scaleInsect', 'earlyBloom', 'thickness']);

export const Diagram: React.FC<{ mg: Mg; frames?: number }> = ({ mg, frames = 150 }) => {
  const macro = MACRO.has(mg.kind);
  const body = (() => {
    switch (mg.kind) {
      case 'timeline': return <Timeline start={mg.start} end={mg.end} />;
      case 'thickness': return <Thickness2 step={mg.step ?? 0} />;
      case 'angle': return <Angle ok={mg.ok} />;
      case 'topview': return <TopView spread={mg.spread} />;
      case 'graft': return <Graft />;
      case 'budcut': return <BudCut />;
      case 'collar': return <Collar />;
      case 'threecut': return <ThreeCut />;
      case 'reach': return <Reach />;
      case 'tipbud': return <TipBud />;
      case 'half': return <Half />;
      case 'cane': return <Cane />;
      case 'buds': return <Buds />;
      case 'scaffoldPick': return <ScaffoldPick step={mg.step} />;
      case 'branchTypes': return <BranchTypes step={mg.step} frames={frames} />;
      case 'cutSpots': return <CutSpots />;
      case 'ribbon': return <Ribbon step={mg.step ?? 0} />;
      case 'seasonSplit': return <SeasonSplit step={mg.step ?? 0} />;
      case 'spurSprout': return <SpurSprout step={mg.step ?? 0} />;
      case 'pruneOrder': return <PruneOrder />;
      case 'youngPersimmon': return <YoungPersimmon step={mg.step} />;
      case 'halfPair': return <HalfPair />;
      case 'sunHours': return <SunHours step={mg.step} />;
      case 'blueberrySeason': return <BlueberrySeason step={mg.step} />;
      case 'dontCut': return <DontCut />;
      case 'calendarSteps': return <CalendarSteps />;
      case 'hesitate': return <D3.Hesitate step={mg.step ?? 0} />;
      case 'leafDrop': return <D3.LeafDrop v={mg.v ?? 'serrate'} mode={mg.step === 1 ? 'hold' : 'fall'} />;
      case 'potDrop': return <D3.PotDrop />;
      case 'chapterMap': return <D3.ChapterMap />;
      case 'planAhead': return <D3.PlanAhead />;
      case 'youngAge': return <D3.YoungAge />;
      case 'skeleton': return <D3.Skeleton />;
      case 'lightAir': return <D3.LightAir step={mg.step ?? 0} />;
      case 'spreadTie': return <D3.SpreadTie step={mg.step ?? 0} />;
      case 'flushCut': return <D3.FlushCut />;
      case 'slowHeal': return <D3.SlowHeal />;
      case 'earlyBloom': return <D3.EarlyBloom />;
      case 'twoYears': return <D3.TwoYears />;
      case 'calendar12': return <D3.Calendar12 />;
      case 'headingCut': return <D3.HeadingCut />;
      case 'lateralCut': return <D3.LateralCut />;
      case 'stepDown': return <D3.StepDown />;
      case 'coldMorning': return <D3.ColdMorning />;
      case 'threeYears': return <D3.ThreeYears />;
      case 'scaleInsect': return <D3.ScaleInsect step={mg.step ?? 0} />;
      case 'caneCycle': return <D3.CaneCycle />;
      case 'caneAge': return <D3.CaneAge step={mg.step ?? 0} />;
      case 'tapeMark': return <D3.TapeMark />;
      case 'spurClose': return <D3.SpurClose />;
      case 'fruitingWood': return <D3.FruitingWood step={mg.step ?? 0} />;
      case 'budReveal': return <D3.BudReveal />;
      case 'scaffoldThick': return <D3.ScaffoldThick step={mg.step ?? 0} />;
      case 'stubSprouts': return <D3.StubSprouts />;
      case 'tipTrim': return <D3.TipTrim />;
      case 'lateWinter': return <D3.LateWinter />;
      case 'newPlant': return <D3.NewPlant step={mg.step ?? 0} />;
      case 'budCount': return <D3.BudCount step={mg.step ?? 0} />;
    }
  })();
  return (
    <MacroCtx.Provider value={macro}>
    <svg viewBox="0 0 1000 620" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      <KitDefs />
      <Backdrop />
      <g clipPath="url(#kit-frame)">
        <Camera frames={frames} {...(FOCUS[mg.kind] ? { focus: FOCUS[mg.kind]! } : {})}>{body}</Camera>
      </g>
    </svg>
    </MacroCtx.Provider>
  );
};
