// 가로 정보 영역 카드(롱폼 전용) — 숏폼 카드 컴포넌트는 세로 px 고정값이라 쓰지 않는다(설계 제약).
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { LfCard } from './types';
import { splitKeywords } from './keywords';
import { captionWordStyle, type CaptionMotionName } from '../captionMotion';

export const INK = '#f6f1e7';
export const MUTED = 'rgba(246,241,231,.62)';
export const ACCENT = '#e8b04b';
export const LEAF = '#8fc28a';
const PANEL_BG = 'rgba(20,19,15,.72)';

/** i 번째 항목 등장 진행도(0→1). animate=false 면 이미 다 나와 있다. */
function useReveal(i: number, animate: boolean, stepFrames = 8): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!animate) return 1;
  return spring({ frame: frame - 6 - i * stepFrames, fps, config: { damping: 200 } });
}

const Row: React.FC<{ i: number; animate: boolean; children: React.ReactNode }> = ({ i, animate, children }) => {
  const p = useReveal(i, animate);
  return <div style={{ opacity: p, transform: `translateX(${(1 - p) * 30}px)` }}>{children}</div>;
};

const ListCard: React.FC<{ header?: string; items: string[]; animate: boolean; focus?: number }> = ({ header, items, animate, focus }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
    {header ? <div style={{ fontSize: 44, fontWeight: 800, color: ACCENT, marginBottom: 8 }}>{header}</div> : null}
    {items.map((it, i) => (
      <Row key={i} i={i} animate={animate}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, background: PANEL_BG, borderRadius: 18, padding: '18px 28px', transition: 'none',
          opacity: focus === undefined || focus === i ? 1 : 0.45, outline: focus === i ? `4px solid ${ACCENT}` : 'none', transform: focus === i ? 'scale(1.03)' : 'none', transformOrigin: 'left center' }}>
          <div style={{ flex: '0 0 52px', height: 52, borderRadius: 26, background: ACCENT, color: '#1a160d', fontSize: 30, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
          <div style={{ fontSize: items.length > 4 ? 36 : 42, fontWeight: 700, color: INK, lineHeight: 1.25 }}>{it}</div>
        </div>
      </Row>
    ))}
  </div>
);

const CompareCard: React.FC<{ left: { label: string; items: string[] }; right: { label: string; items: string[] }; animate: boolean }> = ({ left, right, animate }) => (
  <div style={{ display: 'flex', gap: 28 }}>
    {[left, right].map((side, s) => (
      <Row key={s} i={s} animate={animate}>
        <div style={{ width: 520, minHeight: 300, background: PANEL_BG, borderRadius: 24, padding: '30px 34px', borderTop: `8px solid ${s === 0 ? LEAF : ACCENT}` }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: s === 0 ? LEAF : ACCENT, marginBottom: 20 }}>{side.label}</div>
          {side.items.map((it, i) => (
            <div key={i} style={{ fontSize: 40, fontWeight: 700, color: INK, lineHeight: 1.3, marginTop: i ? 14 : 0 }}>{it}</div>
          ))}
        </div>
      </Row>
    ))}
  </div>
);

const TakeawayCard: React.FC<{ lines: string[]; animate: boolean }> = ({ lines, animate }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    {lines.map((l, i) => (
      <Row key={i} i={i} animate={animate}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, background: PANEL_BG, borderRadius: 18, padding: '22px 30px', borderLeft: `8px solid ${ACCENT}` }}>
          <div style={{ fontSize: 44, fontWeight: 700, color: INK, lineHeight: 1.25 }}>{l}</div>
        </div>
      </Row>
    ))}
  </div>
);

const StatCard: React.FC<{ value: number; unit?: string; label?: string; animate: boolean }> = ({ value, unit, label, animate }) => {
  const p = useReveal(0, animate, 0);
  return (
    <div style={{ background: PANEL_BG, borderRadius: 24, padding: '34px 56px', display: 'inline-block', textAlign: 'center' }}>
      <div style={{ fontSize: 120, fontWeight: 800, color: ACCENT }}>{Math.round(interpolate(p, [0, 1], [0, value]))}{unit ?? ''}</div>
      {label ? <div style={{ fontSize: 40, fontWeight: 700, color: INK }}>{label}</div> : null}
    </div>
  );
};

const QuoteCard: React.FC<{ text: string; animate: boolean }> = ({ text, animate }) => {
  const p = useReveal(0, animate, 0);
  return (
    <div style={{ maxWidth: 1000, background: PANEL_BG, borderRadius: 24, padding: '40px 52px', opacity: p, transform: `translateY(${(1 - p) * 20}px)`, textAlign: 'center' }}>
      <div style={{ fontSize: 110, lineHeight: 0.6, color: ACCENT, fontWeight: 800 }}>“</div>
      <div style={{ fontSize: 46, fontWeight: 800, color: INK, lineHeight: 1.4, wordBreak: 'keep-all' }}>{text}</div>
    </div>
  );
};

const ChartCard: React.FC<{ header?: string; series: Array<{ label: string; value: number }>; unit?: string; animate: boolean }> = ({ header, series, unit, animate }) => {
  const max = Math.max(...series.map((x) => x.value));
  return (
    <div style={{ background: PANEL_BG, borderRadius: 24, padding: '30px 60px', textAlign: 'center' }}>
      {header ? <div style={{ fontSize: 40, fontWeight: 800, color: ACCENT, marginBottom: 12 }}>{header}</div> : null}
      <div style={{ display: 'flex', gap: 60, alignItems: 'flex-end', height: 420 }}>
        {series.map((x, i) => <Bar key={i} i={i} animate={animate} label={x.label} value={x.value} unit={unit} ratio={x.value / max} />)}
      </div>
    </div>
  );
};

const Bar: React.FC<{ i: number; animate: boolean; label: string; value: number; unit?: string; ratio: number }> = ({ i, animate, label, value, unit, ratio }) => {
  const p = useReveal(i, animate, 10);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: 220 }}>
      <div style={{ fontSize: 44, fontWeight: 800, color: ACCENT }}>{Math.round(value * p)}{unit ?? ''}</div>
      <div style={{ width: 120, height: 260 * ratio * p, background: i === 0 ? ACCENT : LEAF, borderRadius: '14px 14px 0 0' }} />
      <div style={{ fontSize: 36, fontWeight: 700, color: INK }}>{label}</div>
    </div>
  );
};

export const InfoCard: React.FC<{ card: LfCard; animate: boolean; focus?: number }> = ({ card, animate, focus }) => {
  switch (card.kind) {
    case 'list': return <ListCard header={card.header} items={card.items} animate={animate} focus={focus} />;
    case 'compare': return <CompareCard left={card.left} right={card.right} animate={animate} />;
    case 'takeaway': return <TakeawayCard lines={card.lines} animate={animate} />;
    case 'stat': return <StatCard value={card.value} unit={card.unit} label={card.label} animate={animate} />;
    case 'quote': return <QuoteCard text={card.text} animate={animate} />;
    case 'chart': return <ChartCard header={card.header} series={card.series} unit={card.unit} animate={animate} />;
  }
};

/** 지금 읽는 구절(크게, 가운데). 장마다 숏폼 자막 움직임 6종 중 하나로 단어가 들어오고, 키워드는 색·밑줄로 띄운다.
 *  pop=true(편집 기법 '키워드 팝')면 키워드가 한 번 더 크게 튄다. keywords 는 대본 강조어(없으면 시범 용어). */
export const Caption: React.FC<{ captions: Array<{ text: string; startFrame: number; endFrame: number }>; size: number; motion: string; pop?: boolean; width?: number; keywords?: readonly string[] }> = ({ captions, size, motion, pop, width = 1100, keywords }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = captions.find((x) => frame >= x.startFrame && frame < x.endFrame) ?? captions[captions.length - 1];
  if (!c) return null;
  const t = frame - c.startFrame;
  let w = 0;
  // 줄은 구절 단계에서 정해 둔다('\n' — 쉼표·연결 어미 자리). 글자 크기는 세그먼트 안 가장 긴 줄이 한 줄에 들어가게 하나로.
  const lineLen = (l: string) => l.replace(/\s/g, '').length + l.split(' ').length * 0.35;
  const longest = captions.reduce((m, x) => Math.max(m, ...x.text.split('\n').map(lineLen)), 0);
  const fit = Math.max(44, Math.min(size, Math.floor(width / (longest * 1.02))));
  const renderLine = (line: string, li: number) => (
    <div key={li} style={{ whiteSpace: 'nowrap' }}>
      {splitKeywords(line, keywords).flatMap((p, i) => p.text.split(/(\s+)/).filter(Boolean).map((word, k) => {
        if (/^\s+$/.test(word)) return <span key={`${li}-${i}-${k}`}>{word}</span>;
        const style = captionWordStyle(motion as CaptionMotionName, t, fps, w++, 3);
        if (!p.hot) return <span key={`${li}-${i}-${k}`} style={{ display: 'inline-block', ...style }}>{word}</span>;
        const punch = interpolate(t, [0, 4, 8], pop ? [0.8, 1.3, 1.08] : [0.85, 1.12, 1], { extrapolateRight: 'clamp' });
        return (
          <span key={`${li}-${i}-${k}`} style={{ display: 'inline-block', ...style }}>
            <span style={{ color: ACCENT, position: 'relative', display: 'inline-block', transform: `scale(${punch})` }}>
              {word}
              <span style={{ position: 'absolute', left: 0, right: 0, bottom: -6, height: 6, borderRadius: 3, background: ACCENT, transformOrigin: 'left', transform: `scaleX(${interpolate(t, [4, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })})` }} />
            </span>
          </span>
        );
      }))}
    </div>
  );
  return (
    <div style={{ fontSize: fit, fontWeight: 800, color: INK, lineHeight: 1.3, textAlign: 'center', textShadow: '0 3px 18px rgba(0,0,0,.55)' }}>
      {c.text.split('\n').map(renderLine)}
    </div>
  );
};
