/**
 * 롱폼 편집 기법 배정(순수) — 숏폼 편집 기법 14종(remotion/editTechniques.ts)을 롱폼 세그먼트에 나눠 건다.
 * 화면을 덮는 효과는 쓰지 않는다(사장님 지시 2026-10-19) — 장면 전환·자막 기법만. 기법끼리 붙지 않게 띄운다(붙으면 기법이 아니라 필터가 된다).
 */
import { random } from 'remotion';

export type FxTech =
  | '레터박스' | '정지 강조' | '테두리 프레임' | '비네트 호흡'
  | '컬러 팝' | '아이리스 리빌' | '소프트 글로우' | '핸드헬드 흔들림' | '초점 띠'
  | '포인터 링' | '스포트라이트' | '인셋 확대창' | '키워드 팝' | '줌 스루 전환';

// 2026-10-19 사장님 지시: 실촬영·정지 화면 위에 덮는 효과(테두리 프레임·레터박스·비네트·초점 띠·포인터 링·
// 스포트라이트·인셋·정지 강조·흔들림·컬러 팝·글로우)는 쓰지 않는다. 화면을 덮지 않는 장면 전환·자막 기법만 남긴다.
export const VIDEO_TECHS: FxTech[] = ['아이리스 리빌', '줌 스루 전환', '키워드 팝'];
export const STILL_TECHS: FxTech[] = [];

export type Enter = 'fade' | 'slide-up' | 'wipe' | 'scale';
export const ENTERS: Enter[] = ['fade', 'slide-up', 'wipe', 'scale'];

/** 영상 기법 사이 최소 간격(세그먼트 수). 정지 화면은 수가 적어 2로 둔다. */
const VIDEO_GAP = 3;
const STILL_GAP = 2;

export interface SegFx { tech?: FxTech; enter: Enter }

export function assignFx(segs: Array<{ id: string; kind: 'video' | 'still' | 'card' }>, seed: string): Record<string, SegFx> {
  const out: Record<string, SegFx> = {};
  let last = -99;
  let vi = Math.floor(random(`${seed}:v`) * VIDEO_TECHS.length);
  let si = Math.floor(random(`${seed}:s`) * STILL_TECHS.length);
  segs.forEach((s, i) => {
    const enter = ENTERS[Math.floor(random(`${seed}:enter:${s.id}`) * ENTERS.length)]!;
    let tech: FxTech | undefined;
    if (i > 0) {
      if (s.kind === 'still' && STILL_TECHS.length && i - last >= STILL_GAP) tech = STILL_TECHS[si++ % STILL_TECHS.length];
      else if (s.kind === 'video' && i - last >= VIDEO_GAP) tech = VIDEO_TECHS[vi++ % VIDEO_TECHS.length];
    }
    if (tech) last = i;
    out[s.id] = tech ? { tech, enter } : { enter };
  });
  return out;
}
