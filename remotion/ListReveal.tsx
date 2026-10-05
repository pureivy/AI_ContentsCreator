import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { staggerPop, settleIn, smoothstep, resolveBeats, listFallbackBeats } from './anim';
import { CardStage, CardHeader, headerHeight, headerFontPx, CARD_WIDTH } from './CardStage';
import { fitCaption } from './KineticCaption';

/** list 씬 오버레이 — 항목별 스태거 리빌(fade+slide-up), 번호 액센트. */
export const ListReveal: React.FC<{ items: string[]; total: number }> = ({ items, total }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: '28%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, width: '78%' }}>
        {items.map((it, i) => {
          const p = staggerPop(f, total, i, items.length, fps);
          const o = Math.min(1, p);
          return (
            <div key={i} style={{ background: 'rgba(0,0,0,.45)', borderRadius: 20, padding: '26px 36px', fontSize: 54, fontWeight: 800, color: '#fff', textShadow: '0 3px 16px rgba(0,0,0,.6)', opacity: o, transform: `translateY(${(1 - p) * 24}px)` }}>
              <span style={{ color: '#ffd54a', marginRight: 16 }}>{i + 1}</span>{it}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── 카드 모션 v2(2026-10-05) ─────────────────────────────────────────────────
// 파일럿 목록이 더 깔끔하고 크게 읽혔던 이유: 행마다 번호 원(배지)·같은 글자 크기·같은 줄 높이로 정렬돼 있었다.
// 종전은 숫자를 글자색만 바꿔 붙여 행마다 시작점이 흔들렸고, 글자(54px)가 길면 두 줄로 넘어갔다.
// 여기서는 모든 항목을 한 줄에 맞춘 '같은' 크기(상한 60, 하한 40)로 쓰고, 번호는 노란 원 안에 넣는다.
// 박자는 서버(card.beats — 그 항목을 말하는 순간), 없으면 종전 슬롯 분배(staggerPop 과 같은 산식).

const BADGE_PX = 60;
const ROW_PAD_X = 26, ROW_PAD_Y = 16, ROW_GAP = 14, BADGE_GAP = 20;
const ITEM_MAX = 60, ITEM_MIN = 40;

export const ListRevealV2: React.FC<{ items: string[]; total: number; header?: string; headerAt?: number; beats?: number[]; topPx?: number; bottomPx: number }> = ({ items, total, header, headerAt, beats, topPx, bottomPx }) => {
  const f = useCurrentFrame();
  const { width } = useVideoConfig();
  const cardW = Math.round(width * CARD_WIDTH);
  const at = resolveBeats(beats, listFallbackBeats(total, items.length), 10, header && !headerAt ? 8 : 0);
  const textW = cardW - 2 * ROW_PAD_X - BADGE_PX - BADGE_GAP - 8;
  const fontPx = Math.max(ITEM_MIN, Math.min(...items.map((t) => fitCaption(t, ITEM_MAX, textW, 1))));
  const rowH = Math.max(BADGE_PX, fontPx * 1.25) + 2 * ROW_PAD_Y;
  const est = (header ? headerHeight(headerFontPx(header, cardW)) : 0) + items.length * rowH + (items.length - 1) * ROW_GAP;
  return (
    <CardStage topPx={topPx} bottomPx={bottomPx} estHeight={est}>
      {header ? <CardHeader text={header} at={headerAt ?? 0} /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
        {items.map((it, i) => {
          const t = at[i]!;
          // 정착 넘김 + 시차: 행 판 → 번호 원(+3) → 글자(+5).
          const p = settleIn(f, t, 14);
          const pb = settleIn(f, t + 3, 12);
          const pt = settleIn(f, t + 5, 12);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: BADGE_GAP, padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px`,
              background: 'rgba(0,0,0,.70)', borderRadius: 20,
              opacity: smoothstep((f - t) / 6), transform: `translateY(${((1 - p) * 24).toFixed(2)}px)`,
            }}>
              <div style={{
                flex: 'none', width: BADGE_PX, height: BADGE_PX, borderRadius: '50%', background: '#ffd54a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 36, fontWeight: 900, color: '#141414', lineHeight: 1,
                opacity: Math.min(1, pb * 1.5), transform: `scale(${(0.4 + 0.6 * pb).toFixed(4)})`,
              }}>{i + 1}</div>
              <div style={{
                minWidth: 0, fontSize: fontPx, fontWeight: 800, color: '#fff', lineHeight: 1.25,
                textShadow: '0 2px 10px rgba(0,0,0,.6)',
                opacity: smoothstep((f - t - 5) / 6), transform: `translateX(${((1 - pt) * -16).toFixed(2)}px)`,
              }}>{it}</div>
            </div>
          );
        })}
      </div>
    </CardStage>
  );
};
