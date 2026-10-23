/**
 * 롱폼 시범 화면 props(순수) — Timeline → remotion/longform 의 LongFormProps.
 * 포스터 파일명 규칙: 클립 `<segId>.mp4` 의 한 장면 = `poster-<segId>.jpg`(render.ts 가 뽑는다).
 */
import type { LongFormProps, LfSegment } from './types';
import { FPS, GAP_SEC, type Timeline } from './timeline';
import { approxWords } from './sceneRules';
import { assignFx } from './fx';

/** 숏폼 자막 움직임 6종(remotion/captionMotion.ts 와 같은 이름). */
export const CAPTION_MOTIONS = ['튀어오름', '밀어올림', '옆에서', '커지며', '흐림에서', '또렷하게'];
export const stillOf = (segId: string): string => `still-${segId}.jpg`;

export const posterOf = (segId: string): string => `poster-${segId}.jpg`;

/** 목록 카드에서 낭독에 이름이 나온 항목(항목 머리말 = '—' 앞) — 지금 말하는 줄 강조. */
function focusOf(card: LfSegment['card'], narration: string): { focusItem?: number } {
  if (card?.kind !== 'list') return {};
  const i = card.items.findIndex((it) => {
    const head = it.split('—')[0]!.trim();
    return head.length >= 2 && narration.includes(head);
  });
  return i >= 0 ? { focusItem: i } : {};
}

export function toLongFormProps(
  title: string, tl: Timeline, opts: { focus?: Record<string, { x: number; y: number }>; seed?: string; keywords?: string[] } = {},
): LongFormProps {
  const seed = opts.seed ?? 'longform-pilot';
  const chapterIndex = new Map(tl.chapterStarts.map((c, i) => [c.id, i]));
  const clipped = (i: number) => tl.segments[i]?.clip ? tl.segments[i]! : undefined;

  /** 같은 장에서 직전 클립, 없으면 다음 클립의 세그먼트 id. */
  const nearestClip = (i: number): string | undefined => {
    const ch = tl.segments[i]!.chapter;
    for (let j = i - 1; j >= 0 && tl.segments[j]!.chapter === ch; j--) if (clipped(j)) return tl.segments[j]!.id;
    for (let j = i + 1; j < tl.segments.length && tl.segments[j]!.chapter === ch; j++) if (clipped(j)) return tl.segments[j]!.id;
    return undefined;
  };
  const nearestPoster = (i: number): string | undefined => { const id = nearestClip(i); return id ? posterOf(id) : undefined; };
  // 정지 화면 — 같은 장 클립을 돌아가며, 한 바퀴 돌 때마다 뽑는 시점을 바꾼다(같은 그림 반복 방지).
  // 특정 수종을 지정한 세그먼트는 정지 화면을 쓰지 않는다(다른 수종 화면 위에 이름을 얹지 않는다).
  const STILL_AT = [0.85, 0.45, 0.15, 0.65, 0.3];
  const stillPick = new Map<string, { from: string; at: number }>();
  const stillCount = new Map<string, number>();
  tl.segments.forEach((s) => {
    if (s.clip || s.footageHint) return;
    const pool = tl.segments.filter((x) => x.chapter === s.chapter && x.clip).map((x) => x.id);
    if (!pool.length) return;
    const k = stillCount.get(s.chapter) ?? 0;
    stillCount.set(s.chapter, k + 1);
    stillPick.set(s.id, { from: pool[k % pool.length]!, at: STILL_AT[Math.floor(k / pool.length) % STILL_AT.length]! });
  });
  const fx = assignFx(tl.segments.map((s, i) => ({ id: s.id, kind: s.clip ? 'video' as const : stillPick.has(s.id) ? 'still' as const : 'card' as const })), seed);

  // 같은 그림 묶음(연속한 같은 mg) — 앞 세그먼트들이 쓴 프레임만큼 시각을 이어 준다(경계에서 다시 재생하지 않게).
  const same = (a?: unknown, b?: unknown) => !!a && JSON.stringify(a) === JSON.stringify(b);
  const offset: number[] = [], chainOf: number[] = [];
  tl.segments.forEach((s, i) => {
    const prev = tl.segments[i - 1];
    offset[i] = prev && same(s.mg, prev.mg) ? offset[i - 1]! + prev.frames : 0;
  });
  for (let i = tl.segments.length - 1; i >= 0; i--) {
    const next = tl.segments[i + 1];
    chainOf[i] = next && same(tl.segments[i]!.mg, next.mg) ? chainOf[i + 1]! : offset[i]! + tl.segments[i]!.frames;
  }
  const segments: LfSegment[] = tl.segments.map((s, i) => {
    // 도해가 화면을 쓰면 카드는 안 보인다 — 카드는 실제로 처음 보이는 세그먼트에서 등장 애니메이션을 받는다(리뷰 M5).
    // 카드는 그 세그먼트에서만 — 다음 세그먼트로 이어 보여주던 규칙은 '너무 오래 머문다'는 지적으로 뺐다(2026-10-19).
    const visible = s.mg ? undefined : s.card;
    const isNew = !!visible;
    const pick = stillPick.get(s.id);
    const stillFrom = pick?.from;
    const f = fx[s.id]!;
    return {
      ...(pick ? { still: stillOf(s.id), stillFrom: pick.from, stillAt: pick.at } : {}),
      ...(stillFrom && opts.focus?.[s.id] ? { focus: opts.focus[s.id] } : {}),
      // 좌표 기법은 초점 좌표가 있어야 건다(숏폼 규칙) — 없으면 기법을 뺀다.
      ...(f.tech && (!['포인터 링', '스포트라이트', '인셋 확대창'].includes(f.tech) || opts.focus?.[s.id]) ? { tech: f.tech } : {}),
      enter: f.enter,
      ...(s.clip2 && s.cutAtFrame ? { clip2: s.clip2, cutAtFrame: s.cutAtFrame } : {}),
      ...(s.accent ? { accent: s.accent } : {}),
      ...(s.teaser ? { teaser: s.teaser } : {}),
      ...(s.topTitle ? { topTitle: s.topTitle } : {}),
      id: s.id, chapterIndex: chapterIndex.get(s.chapter)!, chapterTitle: s.chapterTitle,
      startFrame: s.startFrame, frames: s.frames, audio: s.audio,
      ...(s.clip ? { clip: s.clip } : {}),
      // 수종을 지정한 카드 장면은 다른 수종 장면을 배경으로도 깔지 않는다(리뷰 R3-M5).
      poster: s.clip ? posterOf(s.id) : s.footageHint ? undefined : nearestPoster(i),
      ...(visible ? { card: visible } : {}),
      cardIsNew: isNew,
      ...(s.mg ? { mg: s.mg } : {}),
      // 문장 그림 장면(2026-10-22 확장점) — 키만 넘긴다. 컴포넌트는 remotion 쪽 장면 등록표가 정적으로 들고 있다.
      ...(s.scene ? { scene: s.scene, sceneWords: approxWords(s.narration, s.frames / FPS - GAP_SEC) } : {}),
      ...(s.mg && offset[i]! > 0 ? { mgContinue: true, mgOffset: offset[i]! } : {}),
      ...(s.mg ? { mgChainFrames: chainOf[i]! } : {}),
      ...focusOf(visible, s.narration),
      captions: s.captions,
    };
  });

  const chapters = tl.chapterStarts.map((c, i) => {
    const first = tl.segments.findIndex((s) => s.chapter === c.id && s.clip);
    return { index: i, title: c.title, startFrame: c.startFrame, frames: c.frames, ...(first >= 0 ? { poster: posterOf(tl.segments[first]!.id) } : {}) };
  });

  const chapterMotions = chapters.map((_, i) => CAPTION_MOTIONS[i % CAPTION_MOTIONS.length]!);
  return { title, lookSeed: seed, chapterMotions, totalFrames: tl.totalFrames, chapters, segments, ...(opts.keywords?.length ? { keywords: opts.keywords } : {}) };
}
