/**
 * 대비 카드(2026-09-03) — "이것 말고 이것"을 화면에서 나란히 보여준다.
 *
 * 가리키기 도해(화살표)를 걷어낸 자리를 메운다. 그쪽이 실패한 이유는 모양이 아니라 구조였다:
 * 작가는 대본을 쓸 때 배경 이미지를 본 적이 없어 '이미지의 어디'를 지정할 수 없다(실측 2026-09-03,
 * 화살표가 가지 사이 빈 공간을 가리켰다). 반면 '무엇 대신 무엇'은 원문만으로 정확히 쓸 수 있다 —
 * 위치 추측이 필요 없는 연출이라 틀릴 여지가 없다.
 *
 * 세로 9:16 에서는 좌우 분할이 글자를 너무 좁게 만들어 위아래로 쌓는다. 위=틀림(붉은), 아래=맞음(초록).
 * 두 패널이 0.4초 간격으로 들어와 시선이 위→아래로 흐른다.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';
import { popIn, settleIn, drawIn, smoothstep, anticipateScale, resolveBeats } from './anim';
import { CardStage, CardHeader, headerHeight, headerFontPx, CARD_WIDTH } from './CardStage';
import { fitCaption } from './KineticCaption';

const BAD = '#FF6B5E';
const GOOD = '#4ADE80';

const Panel: React.FC<{
  side: { label: string; note?: string }; tone: string; mark: string; delay: number;
}> = ({ side, tone, mark, delay }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = popIn(f, fps, delay); // 오버슛이 있어 두 패널이 차례로 '툭' 얹힌다
  const o = Math.min(1, p);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 28, padding: '34px 44px',
      background: 'rgba(0,0,0,0.66)', borderRadius: 26, border: `4px solid ${tone}`,
      opacity: o, transform: `translateY(${(1 - p) * 26}px)`,
    }}>
      <div style={{
        flex: 'none', width: 92, height: 92, borderRadius: '50%', background: tone,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 58, fontWeight: 900, color: '#141414', lineHeight: 1,
      }}>{mark}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 60, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>{side.label}</div>
        {side.note ? (
          <div style={{ fontSize: 38, fontWeight: 600, color: 'rgba(255,255,255,0.82)', marginTop: 10 }}>{side.note}</div>
        ) : null}
      </div>
    </div>
  );
};

export const CompareCard: React.FC<{
  compare: { bad: { label: string; note?: string }; good: { label: string; note?: string } };
}> = ({ compare }) => (
  <AbsoluteFill style={{
    display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 40,
    padding: '0 70px', paddingBottom: 380, // 자막 영역(하단)을 비운다
  }}>
    <Panel side={compare.bad} tone={BAD} mark="✕" delay={4} />
    <Panel side={compare.good} tone={GOOD} mark="✓" delay={16} />
  </AbsoluteFill>
);

// ── 카드 모션 v2(2026-10-05) ─────────────────────────────────────────────────
// 파일럿(직접 제작)에서 가장 잘 읽혔던 점: 대비가 한꺼번에 뜨지 않고 차례로 풀린다. 순서를 못박는다 —
//   ✕ 줄 → ✓ 줄 → (틀린 쪽 취소선·사이 화살표) → 정답 알약.
// ✕·✓ 박자는 서버가 낭독에 맞춰 준다(card.beats — 그 말을 하는 순간). 없으면 종전 박자(4·16프레임).
// 어두운 카드·흰 글자는 그대로다 — 파일럿의 밝은 유리판은 초록 잎 위에서 덜 읽혔다.

const MARK_PX = 88;
const PANEL_PAD_X = 34, PANEL_PAD_Y = 30, PANEL_GAP = 30, ARROW_H = 52;
const LABEL_MAX = 64, LABEL_MIN = 42, NOTE_MAX = 40, NOTE_MIN = 28;

const PanelV2: React.FC<{
  side: { label: string; note?: string }; tone: string; mark: string; at: number;
  labelPx: number; notePx: number;
  /** 틀린 쪽 — strikeAt 부터 취소선이 그어지고 글자가 살짝 물러난다. */
  strikeAt?: number;
  /** 맞는 쪽 — pillAt 에 라벨 뒤로 초록 알약이 튀어나온다(직전 4프레임 줄이 움츠림). */
  pillAt?: number;
}> = ({ side, tone, mark, at, labelPx, notePx, strikeAt, pillAt }) => {
  const f = useCurrentFrame();
  // 정착 넘김 + 안쪽 요소 시차: 판 → 표식(+3) → 라벨(+5) → 메모(+8).
  const p = settleIn(f, at, 14);
  const pm = settleIn(f, at + 3, 12);
  const pl = settleIn(f, at + 5, 12);
  const pn = settleIn(f, at + 8, 12);
  const strike = strikeAt !== undefined ? drawIn(f, strikeAt, 8) : 0;
  const pill = pillAt !== undefined ? settleIn(f, pillAt, 12) : 0;
  const pulse = pillAt !== undefined ? anticipateScale(f, pillAt, 4, 0.025, 10) : 1;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: PANEL_GAP, padding: `${PANEL_PAD_Y}px ${PANEL_PAD_X}px`,
      background: 'rgba(0,0,0,0.72)', borderRadius: 26, border: `4px solid ${tone}`,
      opacity: smoothstep((f - at) / 6),
      transform: `translateY(${((1 - p) * 28).toFixed(2)}px) scale(${pulse.toFixed(4)})`,
    }}>
      <div style={{
        flex: 'none', width: MARK_PX, height: MARK_PX, borderRadius: '50%', background: tone,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 54, fontWeight: 900, color: '#141414', lineHeight: 1,
        opacity: Math.min(1, pm * 1.5), transform: `scale(${(0.4 + 0.6 * pm).toFixed(4)})`,
      }}>{mark}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ opacity: smoothstep((f - at - 5) / 6), transform: `translateX(${((1 - pl) * -18).toFixed(2)}px)` }}>
          <span style={{
            position: 'relative', display: 'inline-block', isolation: 'isolate',
            fontSize: labelPx, fontWeight: pillAt !== undefined ? 900 : 800, lineHeight: 1.2,
            color: `rgba(255,255,255,${(1 - 0.18 * strike).toFixed(3)})`,
          }}>
            {pillAt !== undefined ? (
              <span style={{
                position: 'absolute', inset: '-6px -16px', borderRadius: 999, background: '#15803d', zIndex: -1,
                boxShadow: '0 0 0 3px rgba(74,222,128,.55)',
                opacity: Math.min(1, pill * 2), transform: `scale(${(0.6 + 0.4 * pill).toFixed(4)})`,
              }} />
            ) : null}
            {side.label}
            {strikeAt !== undefined ? (
              <span style={{
                position: 'absolute', left: -6, right: -6, top: '52%', height: 6, borderRadius: 3, background: tone,
                transform: `scaleX(${strike.toFixed(4)})`, transformOrigin: 'left center',
              }} />
            ) : null}
          </span>
        </div>
        {side.note ? (
          <div style={{
            fontSize: notePx, fontWeight: 600, color: 'rgba(255,255,255,0.86)', marginTop: 8, whiteSpace: 'nowrap',
            opacity: smoothstep((f - at - 8) / 6), transform: `translateY(${((1 - pn) * 10).toFixed(2)}px)`,
          }}>{side.note}</div>
        ) : null}
      </div>
    </div>
  );
};

/** ✕ 에서 ✓ 로 내려가는 화살표 — 선이 그어지듯(스트로크 대시) 나타난다. 레이아웃 높이는 처음부터 고정. */
const DownArrow: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const p = drawIn(f, at, 8);
  const len = 60;
  return (
    <div style={{ height: ARROW_H, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <svg width={60} height={ARROW_H} viewBox={`0 0 60 ${ARROW_H}`} style={{ opacity: p > 0 ? 1 : 0 }}>
        <path d={`M30 4 V${ARROW_H - 8} M18 ${ARROW_H - 20} L30 ${ARROW_H - 7} L42 ${ARROW_H - 20}`}
          fill="none" stroke="#ffd54a" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={len} strokeDashoffset={(len * (1 - p)).toFixed(2)} />
      </svg>
    </div>
  );
};

export const CompareCardV2: React.FC<{
  compare: { bad: { label: string; note?: string }; good: { label: string; note?: string } };
  total: number;
  header?: string;
  headerAt?: number;
  /** 서버 박자 [✕, ✓](씬 로컬 프레임) — 없으면 종전 박자. */
  beats?: number[];
  topPx?: number;
  bottomPx: number;
}> = ({ compare, total, header, headerAt, beats, topPx, bottomPx }) => {
  const f = useCurrentFrame();
  const { width } = useVideoConfig();
  const cardW = Math.round(width * CARD_WIDTH);
  // 머리줄이 있으면 첫 줄은 그 뒤 8프레임부터 — 제목 → 내용 순서.
  const [badAt, goodAt] = resolveBeats(beats, [4, 16], 12, header && !headerAt ? 8 : 0) as [number, number];
  // 정답 알약은 ✓ 줄이 자리 잡은 뒤, 단 씬 끝 0.5초 전에는 떠야 읽힌다.
  const lineAt = goodAt + 6;
  const pillAt = Math.max(goodAt + 8, Math.min(goodAt + 16, total - 15));
  // 글자 크기 — 두 라벨이 같은 크기여야 대비가 읽힌다(작은 쪽에 맞춤). 한 줄 맞춤, 하한 아래면 하한(줄바꿈 허용).
  const textW = cardW - 2 * PANEL_PAD_X - MARK_PX - PANEL_GAP - 8 - 32; // 32 = 알약 좌우 튀어나옴
  const labelPx = Math.max(LABEL_MIN, Math.min(...[compare.bad.label, compare.good.label].map((t) => fitCaption(t, LABEL_MAX, textW, 1))));
  const notes = [compare.bad.note, compare.good.note].filter((t): t is string => !!t);
  const notePx = notes.length ? Math.max(NOTE_MIN, Math.min(...notes.map((t) => fitCaption(t, NOTE_MAX, textW, 1)))) : NOTE_MAX;
  const panelH = (n?: string): number => Math.max(MARK_PX, labelPx * 1.2 + (n ? 8 + notePx * 1.3 : 0)) + 2 * PANEL_PAD_Y + 8;
  const est = (header ? headerHeight(headerFontPx(header, cardW)) : 0) + panelH(compare.bad.note) + ARROW_H + panelH(compare.good.note);
  // 예비 동작 — ✓ 줄이 뜨기 직전 카드 전체가 3% 움츠렸다 넘기며 받는다.
  const pulse = anticipateScale(f, goodAt, 5, 0.03, 10);
  return (
    <CardStage topPx={topPx} bottomPx={bottomPx} estHeight={est} pulse={pulse}>
      {header ? <CardHeader text={header} at={headerAt ?? 0} /> : null}
      <PanelV2 side={compare.bad} tone={BAD} mark="✕" at={badAt} labelPx={labelPx} notePx={notePx} strikeAt={lineAt} />
      <DownArrow at={lineAt} />
      <PanelV2 side={compare.good} tone={GOOD} mark="✓" at={goodAt} labelPx={labelPx} notePx={notePx} pillAt={pillAt} />
    </CardStage>
  );
};
