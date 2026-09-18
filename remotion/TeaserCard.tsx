import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { popIn } from './anim';

/**
 * 결론 예고 카드(2026-09-18) — 씬 2 첫 1.5초, "끝에 나오는 것 · {조건} → ?" 를 상단 오른쪽에 잠깐 띄운다.
 *
 * 첫 몇 초에 이탈이 몰린다. 답(CTA 의 then)은 감추고 조건(when)만 보여 "끝에 무엇이 나오는지"를 예고하면
 * 마지막까지 볼 이유가 생긴다 — 답까지 보여 주면 그 이유가 사라진다(서버 teaserFor 가 조건만 넘긴다).
 *
 * 자리(상단 27%): 제목 캘리 아래·라벨 위의 빈 띠다. 캘리는 topPct(3~7%, varyLayout)에 실측 종횡비 ~2.4:1 로
 * 폭 70~78% → 높이 16~18% 라 아래 끝이 20~25% 에 온다. 라벨(screenText)은 구절 자막이 있으면 bottomPct+9(≤59)
 * 위로 올라가 위 끝이 아무리 높아도 ~31% 다. 카드는 한 줄·높이 ~3% 라 27~30% 에 들어간다. 오른쪽 정렬은
 * 캘리(가운데)와 라벨(가운데)의 세로 축을 피해 눈에 걸리는 시간을 줄이려는 것이다.
 */
const HOLD_FRAMES = 45;  // 보이는 시간(1.5초) — 읽을 만큼만. 오래 두면 라벨과 경쟁한다.
const FADE_FRAMES = 8;   // 페이드아웃
const TOP_PCT = 27;

export const TeaserCard: React.FC<{
  /** 예고 문구 — CTA 첫 takeaway 의 조건(12자 이내). */
  teaser: string;
}> = ({ teaser }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f >= HOLD_FRAMES + FADE_FRAMES) return null;
  const inP = interpolate(f, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const outP = interpolate(f, [HOLD_FRAMES, HOLD_FRAMES + FADE_FRAMES], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const s = popIn(f, fps); // 스프링 — 살짝 넘겼다 자리잡는다(TakeawayCard 와 같은 리듬)
  return (
    <div
      style={{
        position: 'absolute', top: `${TOP_PCT}%`, right: '4%', maxWidth: '88%',
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
