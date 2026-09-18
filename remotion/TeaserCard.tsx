import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { popIn } from './anim';

/**
 * 결론 예고 카드(2026-09-18) — 씬 2 첫 1.5초, "끝에 나오는 것 · {조건} → ?" 를 상단 오른쪽에 잠깐 띄운다.
 *
 * 첫 몇 초에 이탈이 몰린다. 답(CTA 의 then)은 감추고 조건(when)만 보여 "끝에 무엇이 나오는지"를 예고하면
 * 마지막까지 볼 이유가 생긴다 — 답까지 보여 주면 그 이유가 사라진다(서버 teaserFor 가 조건만 넘긴다).
 *
 * 자리: 제목 캘리의 예약 상자 바로 아래다 — TitleOverlay 는 topPct(3~7%, varyLayout)에서 높이 26% 를 예약하므로
 * top = titleTopPct + 27(%) 이면 캘리 종횡비가 어떻든(실측 174편 최소 1.88:1 — 그때 캘리 아래 끝이 30% 까지 내려온다)
 * 겹치지 않는다(fix round 1; 종전 고정 27% 는 16% 의 편에서 캘리 밑획과 겹쳤다). 최대 지터에서도 34~37% 인데
 * 라벨(screenText)은 paddingBottom 이 폭 기준 % 라 아무리 높아도 위 끝이 ~60% 이고 구절 자막은 그 아래다.
 * 가운데 카드 연출(list·chart 등)이 있는 씬은 서버·Scene 이 아예 이 카드를 안 얹는다. 오른쪽 정렬은
 * 캘리(가운데)와 라벨(가운데)의 세로 축을 피해 눈에 걸리는 시간을 줄이려는 것이다.
 */
const HOLD_FRAMES = 45;  // 보이는 시간(1.5초) — 읽을 만큼만. 오래 두면 라벨과 경쟁한다.
const FADE_FRAMES = 8;   // 페이드아웃
const TITLE_BOX_PCT = 26; // TitleOverlay 가 예약하는 높이(%) — 그 파일의 height: '26%' 와 짝
const GAP_PCT = 1;

export const TeaserCard: React.FC<{
  /** 예고 문구 — CTA 첫 takeaway 의 조건(12자 이내). */
  teaser: string;
  /** 제목 캘리 topPct(TitleOverlay 와 같은 값). 없으면 TitleOverlay 기본값 5 와 같은 자리. */
  titleTopPct?: number;
}> = ({ teaser, titleTopPct = 5 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f >= HOLD_FRAMES + FADE_FRAMES) return null;
  const topPct = titleTopPct + TITLE_BOX_PCT + GAP_PCT;
  const inP = interpolate(f, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const outP = interpolate(f, [HOLD_FRAMES, HOLD_FRAMES + FADE_FRAMES], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const s = popIn(f, fps); // 스프링 — 살짝 넘겼다 자리잡는다(TakeawayCard 와 같은 리듬)
  return (
    <div
      style={{
        position: 'absolute', top: `${topPct}%`, right: '4%', maxWidth: '88%',
        display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap',
        background: 'rgba(0,0,0,.55)', borderRadius: 16, padding: '12px 22px',
        opacity: Math.min(inP, outP),
        transform: `translateY(${((1 - s) * 14).toFixed(2)}px) scale(${(0.92 + 0.08 * Math.min(1, s)).toFixed(3)})`,
        transformOrigin: 'right center',
        textShadow: '0 2px 12px rgba(0,0,0,.65)',
      }}
    >
      <span style={{ fontSize: 28, fontWeight: 600, color: 'rgba(255,255,255,.72)' }}>끝에 나오는 것 ·</span>
      <span style={{ fontSize: 34, fontWeight: 800, color: '#fff' }}>{teaser}</span>
      <span style={{ fontSize: 30, fontWeight: 800, color: '#ffd54a' }}>→ ?</span>
    </div>
  );
};
