import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { popIn, settleIn, smoothstep, anticipateScale, resolveBeats, takeawayFallbackBeats } from './anim';
import { CardStage, CardHeader, headerHeight, headerFontPx, CARD_WIDTH } from './CardStage';

/**
 * CTA 씬 결론 오버레이(2026-08-28 사용자 요청) — "무얼 심어라"를 화면에 띄운다.
 *
 * 배경(실측 short_6c8936f791): 내레이션은 "허리 높이면 회양목, 어깨 높이 상록이면 사철나무"라고
 * 답을 주는데, 화면에는 screenText "자리별 나무 정하기"라는 라벨만 떴다. 숏폼은 무음 시청이 흔하고
 * 되감기가 없다 — 소리로만 지나간 결론은 남지 않는다. list 씬엔 ListReveal 오버레이가 있는데
 * CTA 씬엔 아무것도 없어, 정작 가장 남아야 할 한 줄이 화면에서 빠져 있었다.
 *
 * 표기: 조건과 답을 화살표로 가른다("허리 높이 → 회양목"). 조건은 흐리게·답은 강조 — 시청자가
 * 자기 상황(조건)을 먼저 찾고 답으로 눈을 옮기는 순서다. 항목이 없으면 한 줄 결론으로 렌더한다.
 */
export const TakeawayCard: React.FC<{
  /** 결론 항목 — "조건 → 답" 쌍. 최대 3개(그 이상은 한 화면에 안 들어온다). */
  takeaways: Array<{ when: string; then: string }>;
  total: number;
}> = ({ takeaways, total }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 카드 자체는 씬 시작 직후 뜨고, 항목은 차례로 얹힌다 — 내레이션이 항목을 하나씩 말하는 속도에 맞춘다.
  const inP = interpolate(f, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rows = takeaways.slice(0, 3);
  // 마지막 항목이 화면에 다 뜬 뒤에도 읽을 시간이 남도록 전체의 55% 안에서 스태거를 끝낸다.
  const stagger = Math.max(1, Math.floor((total * 0.55) / Math.max(1, rows.length)));

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: '26%' }}>
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: 20, width: '82%',
          opacity: inP, transform: `translateY(${(1 - inP) * 18}px)`,
        }}
      >
        {rows.map((t, i) => {
          const p = popIn(f, fps, 12 + i * stagger); // 스프링 — 조건→답 한 줄씩 얹히는 리듬
          const o = Math.min(1, p);
          return (
            <div
              key={i}
              style={{
                background: 'rgba(0,0,0,.52)', borderRadius: 22, padding: '24px 34px',
                display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
                opacity: o, transform: `translateY(${(1 - p) * 20}px)`,
                textShadow: '0 3px 16px rgba(0,0,0,.65)',
              }}
            >
              <span style={{ fontSize: 46, fontWeight: 600, color: 'rgba(255,255,255,.82)' }}>{t.when}</span>
              <span style={{ fontSize: 42, color: '#ffd54a', fontWeight: 800 }}>→</span>
              <span style={{ fontSize: 56, fontWeight: 800, color: '#fff' }}>{t.then}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── 카드 모션 v2(2026-10-05) ─────────────────────────────────────────────────
// 행마다 조건 → (화살표) → 답 순서로 풀린다. 답은 행이 한 번 움츠렸다(예비 동작) 넘기며 튀어나온다 — 시선이 답에 꽂힌다.
// 행 박자는 서버(card.beats), 없으면 종전 산식(12 + i·씬 55% 등분).

// 종전(46·42·56)보다 답을 키운다 — 결론 씬은 라벨이 아래(구절 자막 없음)라 무대가 넉넉하다.
const TK_WHEN = 46, TK_ARROW = 44, TK_THEN = 62;

export const TakeawayCardV2: React.FC<{
  takeaways: Array<{ when: string; then: string }>;
  total: number; header?: string; headerAt?: number; beats?: number[]; topPx?: number; bottomPx: number;
}> = ({ takeaways, total, header, headerAt, beats, topPx, bottomPx }) => {
  const f = useCurrentFrame();
  const { width } = useVideoConfig();
  const cardW = Math.round(width * CARD_WIDTH);
  const rows = takeaways.slice(0, 3);
  const at = resolveBeats(beats, takeawayFallbackBeats(total, rows.length), 12, header && !headerAt ? 8 : 0);
  // 한 행이 두 줄로 접힐 수 있다(flexWrap) — 높이는 넉넉히 두 줄 기준으로 잡지 않고, 긴 행만 두 줄로 센다.
  const rowH = (t: { when: string; then: string }): number => {
    const oneLine = (t.when.length * TK_WHEN + t.then.length * TK_THEN) * 0.95 + TK_ARROW + 2 * 18 < cardW - 68;
    return (oneLine ? TK_THEN * 1.25 : TK_WHEN * 1.25 + TK_THEN * 1.25) + 40;
  };
  const est = (header ? headerHeight(headerFontPx(header, cardW)) : 0) + rows.reduce((a, t) => a + rowH(t), 0) + (rows.length - 1) * 16;
  return (
    <CardStage topPx={topPx} bottomPx={bottomPx} estHeight={est}>
      {header ? <CardHeader text={header} at={headerAt ?? 0} /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rows.map((t, i) => {
          const s0 = at[i]!;
          const answerAt = s0 + 10;
          // 시차: 행 판·조건 → 화살표(+5) → 답(+10, 직전 4프레임 행이 움츠림).
          const p = settleIn(f, s0, 14);
          const pa = settleIn(f, s0 + 5, 10);
          const pt = settleIn(f, answerAt, 12);
          const pulse = anticipateScale(f, answerAt, 4, 0.025, 10);
          return (
            <div key={i} style={{
              background: 'rgba(0,0,0,.72)', borderRadius: 22, padding: '20px 34px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, flexWrap: 'wrap',
              textShadow: '0 2px 12px rgba(0,0,0,.6)',
              opacity: smoothstep((f - s0) / 6),
              transform: `translateY(${((1 - p) * 22).toFixed(2)}px) scale(${pulse.toFixed(4)})`,
            }}>
              <span style={{ fontSize: TK_WHEN, fontWeight: 600, color: 'rgba(255,255,255,.86)' }}>{t.when}</span>
              <span style={{
                fontSize: TK_ARROW, color: '#ffd54a', fontWeight: 800, display: 'inline-block',
                opacity: smoothstep((f - s0 - 5) / 5), transform: `translateX(${((1 - pa) * -14).toFixed(2)}px)`,
              }}>→</span>
              <span style={{
                fontSize: TK_THEN, fontWeight: 800, color: '#fff', display: 'inline-block',
                opacity: Math.min(1, pt * 2), transform: `scale(${(0.7 + 0.3 * pt).toFixed(4)})`, transformOrigin: 'left center',
              }}>{t.then}</span>
            </div>
          );
        })}
      </div>
    </CardStage>
  );
};
