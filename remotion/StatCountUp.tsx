import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { countUpValue, isStaticStatUnit, sceneFadeOpacity, settleIn } from './anim';
import { DrawnUnderline } from './DrawnUnderline';

/** stat 씬 오버레이 — 중앙대(하단 25% 자막 세이프존 회피) 반투명 패널에 CountUp 수치+단위+라벨. */
export const StatCountUp: React.FC<{ stat: { value: number; unit?: string; label?: string }; total: number; seed?: string }> = ({ stat, total, seed }) => {
  const f = useCurrentFrame();
  // 달력 월·순번은 세지 않고 처음부터 최종값 — 카운트업 중간값이 다른 날짜로 읽힌다(isStaticStatUnit).
  const v = isStaticStatUnit(stat.unit) ? stat.value : countUpValue(f, total, stat.value);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: '30%' }}>
      <div style={{ background: 'rgba(0,0,0,.45)', borderRadius: 32, padding: '48px 72px', textAlign: 'center', opacity: sceneFadeOpacity(f, total, 8) }}>
        <div style={{ fontSize: 160, fontWeight: 900, color: '#fff', lineHeight: 1, textShadow: '0 4px 24px rgba(0,0,0,.6)' }}>
          {v.toLocaleString('ko-KR')}
          {stat.unit ? <span style={{ fontSize: 72, fontWeight: 800, marginLeft: 8 }}>{stat.unit}</span> : null}
        </div>
        {/* 수치 아래 손그림 밑줄 — 카운트업이 멈출 즈음 그어져 '여기가 핵심'을 짚는다. */}
        {seed ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
            <DrawnUnderline seed={`${seed}:stat`} delay={Math.max(8, Math.round(total * 0.35))} width={300} />
          </div>
        ) : null}
        {stat.label ? <div style={{ fontSize: 44, fontWeight: 700, color: 'rgba(255,255,255,.92)', marginTop: 20 }}>{stat.label}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

/**
 * 카드 모션 v2(2026-10-05) — 자리·크기·카운트업은 종전 그대로, 등장만 바꿨다: 판이 살짝 넘겼다 정착하고(정착 넘김),
 * 수치(+3)·라벨(+8)이 판보다 늦게 따라온다(안쪽 요소 시차). 끝 페이드아웃은 종전과 같다.
 */
export const StatCountUpV2: React.FC<{ stat: { value: number; unit?: string; label?: string }; total: number; seed?: string }> = ({ stat, total, seed }) => {
  const f = useCurrentFrame();
  const v = isStaticStatUnit(stat.unit) ? stat.value : countUpValue(f, total, stat.value);
  const p = settleIn(f, 0, 16);
  const pv = settleIn(f, 3, 14);
  const pl = settleIn(f, 8, 14);
  const fadeOut = Math.min(1, Math.max(0, (total - f) / 8));
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: '30%' }}>
      <div style={{
        background: 'rgba(0,0,0,.45)', borderRadius: 32, padding: '48px 72px', textAlign: 'center',
        opacity: Math.min(1, p * 1.6, fadeOut), transform: `scale(${(0.9 + 0.1 * p).toFixed(4)})`,
      }}>
        <div style={{
          fontSize: 160, fontWeight: 900, color: '#fff', lineHeight: 1, textShadow: '0 4px 24px rgba(0,0,0,.6)',
          opacity: Math.min(1, pv * 1.5), transform: `translateY(${((1 - pv) * 18).toFixed(2)}px)`,
        }}>
          {v.toLocaleString('ko-KR')}
          {stat.unit ? <span style={{ fontSize: 72, fontWeight: 800, marginLeft: 8 }}>{stat.unit}</span> : null}
        </div>
        {seed ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
            <DrawnUnderline seed={`${seed}:stat`} delay={Math.max(8, Math.round(total * 0.35))} width={300} />
          </div>
        ) : null}
        {stat.label ? (
          <div style={{
            fontSize: 44, fontWeight: 700, color: 'rgba(255,255,255,.92)', marginTop: 20,
            opacity: Math.min(1, pl * 1.5), transform: `translateY(${((1 - pl) * 12).toFixed(2)}px)`,
          }}>{stat.label}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
