import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { captionWordStyle, type CaptionMotionName } from './captionMotion';
import { fitCaption, kwMatcher, CAPTION_SIDE_PAD, CAPTION_BOTTOM_PCT } from './KineticCaption';

export interface PhraseCue { text: string; startFrame: number; endFrame: number }

/**
 * 구절 자막(2026-09-18) — 내레이션을 4~14자 구절로 나눈 것을 낭독 진행에 맞춰 하단에 한 구절씩 띄운다.
 *
 * 릴스·쇼츠는 무음 자동재생으로 시작한다. 종전엔 화면 글자가 씬당 15자 라벨(screenText)뿐이라 소리를
 * 켜기 전엔 무슨 얘긴지 알 수 없었다. 이 층은 라벨 아래(원래 라벨 자리)에 내레이션을 그대로 흘려,
 * 소리 없이도 내용이 읽히게 한다. 훅·CTA 씬엔 오지 않는다 — 서버(prepareScenes)가 본문 씬에만 채운다.
 *
 * 글자·테두리·모션 관례는 본문 라벨(KineticCaption)과 같다. 크기만 라벨의 85% — 두 층이 같은 크기면
 * 위계가 사라진다. 한 줄이 우선이다: 한 줄에 맞춘 크기가 목표의 70% 이상이면 한 줄, 그보다 줄어야
 * 하면 두 줄 맞춤으로 돌아간다(라벨과 같은 규칙). 구절이 14자 안이면 사실상 늘 한 줄이다.
 * 단어 스태거는 구절이 바뀔 때마다 처음부터 다시 시작한다 — 구절 시작 프레임 기준 로컬 프레임.
 */
export const PhraseCaption: React.FC<{
  captions: ReadonlyArray<PhraseCue>;
  /** 하단 여백(%) — 라벨이 비켜 준 원래 자리(KineticCaption 과 같은 기준). */
  bottomPct?: number;
  keyword?: string;
  outline?: boolean;
  /** 라벨 글자 크기(px) — 구절은 이것의 85%. */
  fontPx?: number;
  motion?: CaptionMotionName;
}> = ({ captions, bottomPct = CAPTION_BOTTOM_PCT, keyword, outline, fontPx = 70, motion = '튀어오름' }) => {
  const f = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const cur = captions.find((c) => c.startFrame <= f && f < c.endFrame);
  if (!cur) return null;
  const words = cur.text.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const wanted = Math.round(fontPx * 0.85);
  const boxWidth = Math.max(200, width - CAPTION_SIDE_PAD);
  const oneLine = fitCaption(cur.text, wanted, boxWidth, 1);
  const size = oneLine >= wanted * 0.7 ? oneLine : fitCaption(cur.text, wanted, boxWidth);
  const isKw = kwMatcher(keyword);
  const local = f - cur.startFrame;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: `${bottomPct}%` }}>
      {/* 배경 박스 없음(본문 라벨과 동일) — 가독성은 textShadow·테두리 담당 */}
      <div style={{ padding: '32px 64px', display: 'flex', flexWrap: 'wrap', gap: '0 14px', justifyContent: 'center' }}>
        {words.map((w, i) => (
          <span key={`${cur.startFrame}:${i}`} style={{
            fontSize: size, fontWeight: 800,
            color: isKw(w) ? '#ffd54a' : '#fff',
            lineHeight: 1.25, textShadow: '0 3px 18px rgba(0,0,0,.75)',
            ...(outline ? { WebkitTextStroke: '8px rgba(0,0,0,0.9)', paintOrder: 'stroke fill' } : {}),
            ...captionWordStyle(motion, local, fps, i),
          }}>{w}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
