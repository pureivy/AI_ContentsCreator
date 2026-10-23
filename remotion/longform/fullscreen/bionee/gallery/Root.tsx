// 비온이 시험 합성 모음(2026-10-23) — BioneeSheet(동작 시트, 개념 그림 대조), BioneeTest(15초 시험 영상), BioneeAlpha(투명 정지 화면), BioneeFront.
// 개념 그림·낭독 소리는 렌더 스크립트가 publicDir 로 넣는다(concept.png). 입 열림은 inputProps.mouth.
import React from 'react';
import { AbsoluteFill, Composition, Img, staticFile, useCurrentFrame } from 'remotion';
import { FONT_DODUM } from '../../stage';
import { FullStage, GroundLine, Tree } from '../../styleB/kit';
import { Bionee, BootSolo, HandSolo } from '../Bionee';
import { BioneeActor } from '../BioneeActor';
import { DEFAULT_POSE, EXPR, HANDS, type ExprName, type HandName, type Pose, type Season } from '../pose';
import { poseOf, restArmAt, type Cue } from '../timeline';

const PAPER = '#f5f2ea';
const Label: React.FC<{ x: number; y: number; size?: number; children: string; anchor?: 'middle' | 'start' }> = ({ x, y, size = 30, children, anchor = 'middle' }) => (
  <text x={x} y={y} fontFamily={FONT_DODUM} fontSize={size} fill="#3a3836" textAnchor={anchor}>{children}</text>
);
const P = (o: Partial<Pose>, turn = o.turn ?? 0): Pose => ({ ...DEFAULT_POSE, armL: restArmAt('L', turn), armR: restArmAt('R', turn), ...o });

const SW = 2600, SH = 3000;
const Sheet: React.FC<{ concept?: boolean }> = ({ concept = false }) => {
  const turns: Array<[number, string]> = [[-1, '왼쪽 옆'], [-0.5, '왼쪽 3/4'], [0, '정면'], [0.5, '오른쪽 3/4'], [1, '오른쪽 옆']];
  const exprs: ExprName[] = ['neutral', 'happy', 'grin', 'laugh', 'surprised', 'worried', 'angry', 'thinking', 'sleepy', 'playful', 'sad', 'shy'];
  const exprKo: Record<string, string> = { neutral: '기본', happy: '웃음 ^^', grin: '활짝', laugh: '크게 웃음', surprised: '놀람', worried: '걱정', angry: '뿔남', thinking: '생각', sleepy: '졸림(반눈)', playful: '장난(메롱)', sad: '시무룩', shy: '수줍음' };
  const hands: Array<[HandName, string, number]> = [['open', '편 손', -60], ['wave', '흔드는 손', -80], ['point', '가리킴', -10], ['thumbsUp', '엄지 척', -10], ['fist', '주먹', -10], ['hold', '쥐기(팻말)', -10], ['chin', '턱 괴기', -70], ['clap', '손뼉', -80]];
  const ears: Array<[string, Partial<Pose>]> = [['쫑긋', { earL: 30, earR: 30 }], ['축 처짐', { earL: -28, earR: -28, ...EXPR.sad }], ['한쪽만', { earL: -12, earR: 24, ...EXPR.thinking }], ['펄럭', { earL: 18, earR: -6, flap: 0.6 }]];
  const seasons: Array<[Season, string]> = [['spring', '봄 — 새잎·눈'], ['summer', '여름 — 둥근 잎'], ['autumn', '가을 — 물든 잎·감'], ['winter', '겨울 — 맨가지·눈']];
  const props: Array<[string, Pose]> = [
    ['팻말', poseOf('holdSign', { text: '잎이 진 뒤' }, 0.8)],
    ['돋보기', poseOf('hold', { prop: 'magnifier' }, 0.8)],
    ['물뿌리개', poseOf('hold', { prop: 'can' }, 0.8)],
    ['지시봉', poseOf('hold', { prop: 'stick' }, 0.8)],
  ];
  const acts: Array<[string, Pose]> = [
    ['걷기', { ...P({ turn: 0.62 }), walkAmt: 1, walkPhase: 1.2, lift: 6, lean: 4 }],
    ['깡충(공중)', poseOf('hop', {}, 0.3)],
    ['꾸벅', poseOf('bow', {}, 0.55)],
    ['가리키기', poseOf('point', { target: 'right' }, 0.8)],
    ['손 흔들기', poseOf('wave', {}, 0.5)],
    ['생각', poseOf('think', {}, 1.0)],
    ['엄지 척', poseOf('thumbsUp', {}, 0.6)],
    ['놀람', poseOf('surprised', {}, 0.25)],
    ['걱정', poseOf('worried', {}, 0.7)],
    ['크게 웃음', poseOf('laugh', {}, 0.6)],
  ];
  let k = 0;
  const id = () => `s${k++}`;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {/* 개념 그림 — 렌더 스크립트가 publicDir 에 concept.png 를 넣고 concept=true 로 부를 때만 */}
      {concept ? <Img src={staticFile('concept.png')} style={{ position: 'absolute', left: 30, top: 70, width: 760 }} /> : null}
      <svg viewBox={`0 0 ${SW} ${SH}`} style={{ position: 'absolute', inset: 0 }}>
        <Label x={30} y={50} size={34} anchor="start">개념 그림(승인안)</Label>
        <Label x={830} y={50} size={34} anchor="start">코드 리그 — 돌아보기(turn -1 … +1)</Label>
        {turns.map(([t, n], i) => (
          <g key={i}><Bionee pose={P({ x: 1000 + i * 360, y: 520, size: 0.68, turn: t })} idp={id()} frame={0} /><Label x={1000 + i * 360} y={575}>{n}</Label></g>
        ))}
        <Label x={30} y={660} size={34} anchor="start">표정 12</Label>
        {exprs.map((e, i) => {
          const c = i % 6, r = Math.floor(i / 6);
          const pz = P({ ...EXPR[e], x: 230 + c * 420, y: 960 + r * 370, size: 0.6 });
          return <g key={e}><Bionee pose={pz} idp={id()} frame={0} /><Label x={230 + c * 420} y={1000 + r * 370}>{exprKo[e]!}</Label></g>;
        })}
        <Label x={30} y={1430} size={34} anchor="start">손 모양 8 · 장화(정면·3/4·옆·앞코 들림·착지 눌림·겨울)</Label>
        {hands.map(([h, n, a], i) => (
          <g key={h}><HandSolo x={150 + i * 175} y={1590} ang={a} hand={HANDS[h]} idp={id()} scale={2.0} /><Label x={150 + i * 175} y={1690} size={26}>{n}</Label></g>
        ))}
        {([[0, 0, 0, 0, false, '정면'], [0.5, 0, 0, 0, false, '3/4'], [1, 0, 0, 0, false, '옆'], [1, 0.45, 12, 0, false, '앞코 들림'], [0.5, 0, 0, 0.18, false, '착지 눌림'], [0.3, 0, 0, 0, true, '겨울 눈']] as const).map(([t, tu, l, sq, w, n], i) => (
          <g key={`b${i}`}><BootSolo x={1640 + i * 160} y={1625} turn={t} toeUp={tu} lift={l} squash={sq} winter={w} idp={id()} scale={1.75} /><Label x={1640 + i * 160} y={1690} size={26}>{n}</Label></g>
        ))}
        <Label x={30} y={1780} size={34} anchor="start">귀 잎 반응 4 · 계절 4</Label>
        {ears.map(([n, o], i) => <g key={n}><Bionee pose={P({ x: 200 + i * 310, y: 2150, size: 0.58, ...o })} idp={id()} frame={4} /><Label x={200 + i * 310} y={2195}>{n}</Label></g>)}
        {seasons.map(([s, n], i) => <g key={s}><Bionee pose={P({ x: 1440 + i * 310, y: 2150, size: 0.58 })} season={s} idp={id()} frame={60} /><Label x={1440 + i * 310} y={2195} size={26}>{n}</Label></g>)}
        <Label x={30} y={2280} size={34} anchor="start">소품 4 · 동작 10</Label>
        {props.map(([n, pz], i) => <g key={n}><Bionee pose={{ ...pz, x: 180 + i * 330, y: 2620, size: 0.5 }} idp={id()} frame={10} /><Label x={180 + i * 330} y={2665}>{n}</Label></g>)}
        {acts.slice(0, 4).map(([n, pz], i) => <g key={n}><Bionee pose={{ ...pz, x: 1520 + i * 280, y: 2620, size: 0.5 }} idp={id()} frame={10} /><Label x={1520 + i * 280} y={2665}>{n}</Label></g>)}
        {acts.slice(4).map(([n, pz], i) => <g key={n}><Bionee pose={{ ...pz, x: 260 + i * 420, y: 2930, size: 0.42 }} idp={id()} frame={10} /><Label x={260 + i * 420} y={2975}>{n}</Label></g>)}
      </svg>
    </AbsoluteFill>
  );
};

// ── 시험 영상(15.5초) ───────────────────────────────────
export const TEST_CUES: Cue[] = [
  { at: 0, dur: 2.2, action: 'walkIn', params: { from: 'left', x: 640 } },
  { at: 2.3, dur: 1.5, action: 'wave', params: { hand: 'R' } },
  { at: 3.9, dur: 0.5, action: 'turn', params: { to: 0.3 } },
  { at: 4.0, dur: 3.6, action: 'point', params: { target: { x: 1440, y: 430 } } },
  { at: 7.7, dur: 1.1, action: 'surprised' },
  { at: 7.7, dur: 0.4, action: 'turn', params: { to: 0 } },
  { at: 8.9, dur: 1.6, action: 'think' },
  { at: 10.6, dur: 1.7, action: 'holdSign', params: { text: '잎이 진 뒤' } },
  { at: 12.4, dur: 1.0, action: 'laugh' },
  { at: 12.4, dur: 1.0, action: 'thumbsUp', params: { expr: 'laugh' } },
  { at: 13.5, dur: 1.0, action: 'bow' },
  { at: 14.4, dur: 1.6, action: 'walkOut', params: { side: 'left' } },
];
export const TEST_FRAMES = 16 * 30;
export type TestProps = { mouth?: number[]; mouthStart?: number; transparent?: boolean; season?: Season };

const Test: React.FC<TestProps> = ({ mouth = [], mouthStart = 120, transparent = false, season = 'summer' }) => {
  const actor = <BioneeActor cues={TEST_CUES} home={{ x: 640, y: 846 }} scale={0.78} mouth={mouth} mouthStart={mouthStart} season={season} idp="t" />;
  if (transparent) return <AbsoluteFill>{actor}</AbsoluteFill>;
  return (
    <AbsoluteFill>
      <FullStage frames={TEST_FRAMES}>
        <GroundLine x0={80} x1={1840} y={848} />
        <Tree x={1440} y={848} h={560} age="young" seed="bn-tree" species="persimmon" season="autumn" leaves="autumn" fruit />
      </FullStage>
      {actor}
    </AbsoluteFill>
  );
};

const Front: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }}>
        <Bionee pose={{ ...P({}), x: 960, y: 900, size: 1.5 }} idp="a" frame={f} />
      </svg>
    </AbsoluteFill>
  );
};

/** 다듬기 대조(2026-10-23) — 정면 크게·꾸벅·장화 확대·계절 넷. */
const Detail: React.FC = () => (
  <AbsoluteFill style={{ background: PAPER }}>
    <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }}>
      <Bionee pose={{ ...P({}), x: 330, y: 760, size: 1.18 }} idp="d0" frame={0} />
      <Bionee pose={{ ...poseOf('bow', {}, 0.55), x: 920, y: 760, size: 1.0 }} idp="d1" frame={10} />
      <Bionee pose={{ ...P({ turn: 0.62 }), walkAmt: 1, walkPhase: 1.2, lift: 6, lean: 4, x: 1390, y: 760, size: 1.0 }} idp="d2" frame={10} />
      {([[0, 0, 0, false], [0.5, 0, 0, false], [1, 0, 0, false], [1, 0.45, 12, false], [0.3, 0, 0, true]] as const).map(([t, tu, l, w], i) => (
        <BootSolo key={i} x={1730 + (i % 2) * 140} y={300 + Math.floor(i / 2) * 150} turn={t} toeUp={tu} lift={l} winter={w} idp={`db${i}`} scale={2.2} />
      ))}
      {(['spring', 'summer', 'autumn', 'winter'] as const).map((s, i) => <Bionee key={s} pose={{ ...P({}), x: 250 + i * 470, y: 1060, size: 0.42 }} season={s} idp={`ds${i}`} frame={60} />)}
    </svg>
  </AbsoluteFill>
);

export const BioneeGalleryRoot: React.FC = () => (
  <>
    <Composition id="BioneeDetail" component={Detail} fps={30} width={1920} height={1080} durationInFrames={1} />
    <Composition id="BioneeFront" component={Front} fps={30} width={1920} height={1080} durationInFrames={1} />
    <Composition id="BioneeSheet" component={Sheet} defaultProps={{ concept: false }} fps={30} width={SW} height={SH} durationInFrames={1} />
    <Composition id="BioneeTest" component={Test} defaultProps={{} as TestProps} fps={30} width={1920} height={1080} durationInFrames={TEST_FRAMES} />
    <Composition id="BioneeAlpha" component={Test} defaultProps={{ transparent: true } as TestProps} fps={30} width={1920} height={1080} durationInFrames={TEST_FRAMES} />
  </>
);
