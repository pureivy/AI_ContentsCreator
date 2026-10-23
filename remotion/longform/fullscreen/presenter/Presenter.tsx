// 진행자 '비온이'(2026-10-23, LONGFORM_PRESENTER — 기본 꺼짐). 화분 마스코트가 왼쪽 아래(자막 띠 위)에 서서 낭독에 맞춰 입을 움직이고,
// 세그먼트 신호(cue)대로 몸짓한다. 그림 = 계절 × 자세 스프라이트(연필 일러스트 webp, 얼굴 위치 정렬됨), 움직임 = 이 파일.
//  · 숨쉬기(위아래 3px·3.4초)·흔들림(발끝 기준 ±1.1°·4.6초), 말할 때 살짝 들썩
//  · 자세 바꿈 = 5프레임 겹쳐 바꾸기 + 살짝 눌렸다 펴짐
//  · 눈 깜빡임 = 3~5초마다(결정적 난수) 눈 자리에 화분 색 눈꺼풀 + 감은 눈 선
//  · 입 = 세그먼트 mouth(낭독 소리 크기 → 프레임당 0~9): 0~2 스프라이트 입 그대로, 3~5 반쯤, 6~9 크게 — 화분 색으로 원래 입을 덮고 연필 선으로 그린다
//  · 첫 세그먼트 = 크게(1.25배) 손 흔들며 등장 → 제자리 크기, 마지막 = 절(인사) 뒤 아래로 퇴장
// 전역 프레임으로 돈다(LongFormFull 맨 위 층) — 세그먼트 Sequence 안에 두지 않는다(자세 바꿈이 세그먼트 경계를 넘는다).
import React from 'react';
import { Img, interpolate, random, useCurrentFrame } from 'remotion';
import { CAPTION_TOP, clamp } from '../stage';
import { SPRITES, type SpritePose } from './sprites';
import meta from './sprites/sprites.json';
import type { FullSegment, LongFormFullProps } from '../../../../src/longform/fullProps';
import type { PresenterCue } from '../../../../src/longform/presenter';

const FPS = 30;
/** 스프라이트 캔버스(640) 안 캐릭터: 잎 끝 y≈89 ~ 발끝 y≈604, 왼쪽 x≈70. */
const SPRITE = meta.size;
const CHAR_TOP = 89;
const CHAR_FOOT = 604;
const CHAR_LEFT = 70;
/** 화면 배치 — 캐릭터 키 ≈ 화면 높이 24%(260px), 왼쪽 x≈60, 발끝 = 자막 띠 위 14px. */
export const PRESENTER_BOX = { left: 60, foot: CAPTION_TOP - 14, height: 260 } as const;
const K = PRESENTER_BOX.height / (CHAR_FOOT - CHAR_TOP);
const SPRITE_PX = SPRITE * K;
const SPRITE_LEFT = PRESENTER_BOX.left - CHAR_LEFT * K;
const SPRITE_TOP = PRESENTER_BOX.foot - CHAR_FOOT * K;
/** 몸 중심(발 사이) — 크기·흔들림 기준점(스프라이트 좌표). */
const PIVOT = { x: 320, y: CHAR_FOOT };
const XFADE = 5;
const INK = '#262524';
const MOUTH_DARK = '#3d3835';

type Anchor = { x: number; y: number; w: number; h: number };
type SpriteMeta = { eyeL: Anchor; eyeR: Anchor; mouth: Anchor; pot: string };
const META = meta.sprites as unknown as Record<string, SpriteMeta>;

type Season = NonNullable<LongFormFullProps['presenter']>['season'];
// 2026-10-23: 본편은 코드 리그(bionee/BioneeActor)로 바뀌어 이 스프라이트 진행자는 쓰지 않는다(파일만 남김) — 세그먼트 cue 는 여기서만 정의.
type Seg = Pick<FullSegment, 'startFrame' | 'frames' | 'mouth'> & { cue?: PresenterCue };

const spriteOf = (c: PresenterCue | undefined): SpritePose => {
  if (!c || c.pose === 'idle') return 'idle';
  if (c.pose === 'point') return `point_${c.target ?? 'right'}` as SpritePose;
  return c.pose;
};

/** 자세 바뀜 목록(전역 프레임) — 세그먼트 시작 = 가만히, 신호 at~until = 그 자세. 첫 세그먼트 신호는 0프레임부터. */
function poseEvents(segs: readonly Seg[]): Array<{ frame: number; pose: SpritePose }> {
  const ev: Array<{ frame: number; pose: SpritePose }> = [];
  segs.forEach((s, i) => {
    const end = s.startFrame + s.frames;
    ev.push({ frame: s.startFrame, pose: 'idle' });
    const c = s.cue;
    if (!c || c.pose === 'idle') return;
    const at = Math.min(end - 1, s.startFrame + Math.round((c.at ?? 0) * FPS));
    ev.push({ frame: i === 0 && (c.at ?? 0) <= 0.1 ? s.startFrame : at, pose: spriteOf(c) });
    if (c.pose !== 'bow') {
      const until = c.until != null ? s.startFrame + Math.round(c.until * FPS) : at + Math.round(2.2 * FPS);
      if (until < end) ev.push({ frame: until, pose: 'idle' });
    }
  });
  // 같은 자세가 이어지면 합친다(겹쳐 바꾸기를 하지 않게).
  return ev.filter((e, i) => i === 0 || e.pose !== ev[i - 1]!.pose);
}

/** 깜빡임 정도(0~1) — 3~5초 간격, 6프레임. */
function blinkAt(f: number): number {
  let t = 40;
  for (let k = 0; t <= f; k++) {
    const d = f - t;
    if (d < 6) return [0.55, 1, 1, 0.7, 0.3, 0.1][d]!;
    t += 90 + Math.floor(random(`bionee-blink-${k}`) * 60);
  }
  return 0;
}

/** 입(스프라이트 좌표) — 화분 색 덮개(가장자리 흐림) + 연필 선 입. level 3~5 반, 6~9 크게. */
const Mouth: React.FC<{ m: Anchor; pot: string; level: number; id: string }> = ({ m, pot, level, id }) => {
  if (level < 3) return null;
  const big = level >= 6;
  const w = m.w * (big ? 0.72 : 0.62);
  const h = big ? m.w * (0.36 + (level - 6) * 0.03) : m.w * (0.16 + (level - 3) * 0.03);
  const top = m.y - m.h * 0.45;
  const x0 = m.x - w / 2, x1 = m.x + w / 2;
  // 위 선은 원래 웃는 입처럼 살짝 휘고, 아래는 둥근 그릇.
  const d = `M ${x0} ${top} Q ${m.x} ${top + h * 0.22} ${x1} ${top} C ${x1 - w * 0.02} ${top + h * 0.75} ${m.x + w * 0.28} ${top + h} ${m.x} ${top + h} C ${m.x - w * 0.28} ${top + h} ${x0 + w * 0.02} ${top + h * 0.75} ${x0} ${top} Z`;
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-cover`}>
          <stop offset="0%" stopColor={pot} stopOpacity={1} />
          <stop offset="72%" stopColor={pot} stopOpacity={1} />
          <stop offset="100%" stopColor={pot} stopOpacity={0} />
        </radialGradient>
        <clipPath id={`${id}-in`}><path d={d} /></clipPath>
      </defs>
      <ellipse cx={m.x} cy={m.y} rx={m.w * 0.72} ry={m.h * 1.25} fill={`url(#${id}-cover)`} />
      <path d={d} fill={MOUTH_DARK} />
      {big ? <ellipse cx={m.x} cy={top + h * 1.02} rx={w * 0.3} ry={h * 0.36} fill="#9b948c" clipPath={`url(#${id}-in)`} /> : null}
      <path d={d} fill="none" stroke={INK} strokeWidth={3.2} strokeLinejoin="round" strokeLinecap="round" />
    </g>
  );
};

/** 눈꺼풀 — 화분 색으로 눈을 덮고, 많이 감기면 아래로 휜 감은 눈 선. */
const Lids: React.FC<{ e: Anchor[]; pot: string; p: number }> = ({ e, pot, p }) => {
  if (p <= 0) return null;
  return (
    <g>
      {e.map((a, i) => (
        <g key={i}>
          <ellipse cx={a.x} cy={a.y - a.h * 0.5 * (1 - p)} rx={a.w * 0.95} ry={a.h * 0.72 * p + 1} fill={pot} />
          {p > 0.5 ? <path d={`M ${a.x - a.w * 0.85} ${a.y} Q ${a.x} ${a.y + a.h * 0.4} ${a.x + a.w * 0.85} ${a.y}`} fill="none" stroke={INK} strokeWidth={3.4} strokeLinecap="round" /> : null}
        </g>
      ))}
    </g>
  );
};

/** 스프라이트 한 장 + 그 위 눈·입(같은 좌표계). */
const Figure: React.FC<{ season: Season; pose: SpritePose; opacity: number; level: number; blink: number; id: string }> = ({ season, pose, opacity, level, blink, id }) => {
  const key = `${season}_${pose}`;
  const m = META[key]!;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity }}>
      <Img src={SPRITES[season][pose]} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <svg viewBox={`0 0 ${SPRITE} ${SPRITE}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        {pose === 'bow' ? null : <Lids e={[m.eyeL, m.eyeR]} pot={m.pot} p={blink} />}
        <Mouth m={m.mouth} pot={m.pot} level={pose === 'bow' ? 0 : level} id={`${id}-${key}`} />
      </svg>
    </div>
  );
};

export const Presenter: React.FC<{ season: Season; segments: readonly Seg[] }> = ({ season, segments }) => {
  const f = useCurrentFrame();
  if (!segments.length) return null;
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const start = first.startFrame;
  const end = last.startFrame + last.frames;
  if (f < start || f >= end) return null;

  const ev = poseEvents(segments);
  let ci = 0;
  for (let i = 0; i < ev.length; i++) if (ev[i]!.frame <= f) ci = i;
  const cur = ev[ci]!;
  const prev = ci > 0 ? ev[ci - 1]! : undefined;
  const t = f - cur.frame;
  const fading = prev && t < XFADE;
  const mix = fading ? t / XFADE : 1;
  const squash = fading || t < XFADE + 3 ? Math.sin(Math.PI * Math.min(1, t / (XFADE + 3))) : 0;

  // 지금 세그먼트의 입 열림.
  const seg = segments.find((s) => f >= s.startFrame && f < s.startFrame + s.frames);
  const level = seg?.mouth?.[f - seg.startFrame] ?? 0;

  // 등장(첫 14프레임 솟아오름) · 처음엔 1.25배 → 2.6~3.4초에 제자리 크기 · 퇴장(마지막 16프레임 아래로).
  const enter = interpolate(f - start, [0, 14], [0, 1], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 3) });
  const big = interpolate(f - start, [78, 102], [1.25, 1], clamp);
  const exit = interpolate(f, [end - 16, end - 1], [0, 1], clamp);
  const breath = Math.sin((2 * Math.PI * f) / (3.4 * FPS));
  const sway = Math.sin((2 * Math.PI * f) / (4.6 * FPS) + 0.7) * 1.1;
  const talk = level >= 3 ? -Math.min(3, level * 0.35) : 0;
  const bowLean = cur.pose === 'bow' ? interpolate(t, [0, 10], [0, 1], clamp) : prev?.pose === 'bow' ? 1 - mix : 0;
  const sx = (1 + 0.035 * squash) * (1 + 0.004 * breath);
  const sy = (1 - 0.05 * squash) * (1 + 0.010 * breath) * (1 - 0.05 * bowLean);
  const ty = (1 - enter) * 90 + exit * 120 + breath * 2.2 + talk + bowLean * 6;
  const s = big * (0.7 + 0.3 * enter);

  return (
    <div style={{
      position: 'absolute', left: SPRITE_LEFT, top: SPRITE_TOP, width: SPRITE_PX, height: SPRITE_PX,
      opacity: Math.min(enter * 1.4, 1) * (1 - exit),
      transformOrigin: `${PIVOT.x * K}px ${PIVOT.y * K}px`,
      transform: `translateY(${ty}px) scale(${s * sx}, ${s * sy}) rotate(${sway + bowLean * 4}deg)`,
    }}>
      {/* 앞 자세는 밑에 남겨 두고(화분이 비쳐 보이지 않게) 새 자세를 위에 띄운다. */}
      {fading ? <Figure season={season} pose={prev!.pose} opacity={1 - mix * mix} level={0} blink={0} id="pv-a" /> : null}
      <Figure season={season} pose={cur.pose} opacity={fading ? mix : 1} level={level} blink={fading ? 0 : blinkAt(f - start)} id="pv-b" />
    </div>
  );
};
