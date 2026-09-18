import React from 'react';
import { z } from 'zod';
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig, random, interpolate, Easing } from 'remotion';
import { TransitionSeries } from '@remotion/transitions';
import { Video } from '@remotion/media';
import { CutFlash } from './CutFlash';
import { sceneEnterFade } from './anim';
import { KenBurnsImage } from './KenBurnsImage';
import { KineticCaption, CAPTION_BOTTOM_PCT } from './KineticCaption';
import { PhraseCaption } from './PhraseCaption';
import { ProgressBar } from './ProgressBar';
import { StatCountUp } from './StatCountUp';
import { ListReveal } from './ListReveal';
import { QuoteCard } from './QuoteCard';
import { TitleOverlay } from './TitleOverlay';
import { SpotlightMask } from './SpotlightMask';
import { ParticleDrift } from './ParticleDrift';
import { BarChartGrow } from './BarChartGrow';
import { TakeawayCard } from './TakeawayCard';
import { CompareCard } from './CompareCard';
import { FONT_FAMILY } from './loadFonts';
import { pickFilmLook, filmLookEffects, type FilmLook } from './filmLook';
import { pickCaptionMotion, type CaptionMotionName } from './captionMotion';
import { assignTechniques, type EditTechnique } from './editTechniques';
import { TechniqueLayer } from './TechniqueLayer';
import { InsetZoom } from './InsetZoom';
import { saturation } from '@remotion/effects/saturation';
import { vibrance } from '@remotion/effects/vibrance';
import { glow } from '@remotion/effects/glow';
import { contrast } from '@remotion/effects/contrast';

export const autoShortsSchema = z.object({
  scenes: z.array(z.object({
    imageSrc: z.string().nullable(),
    audioSrc: z.string().nullable(),
    screenText: z.string(),
    durationInFrames: z.number(),
    videoSrc: z.string().nullable().optional(),
    clipFrames: z.number().optional(), // 실제 클립 길이(컴포지션 fps 기준 프레임) — 감속 재생 배율 산정용. 없으면 CLIP_SECONDS 폴백.
    /** 사용자가 찍어 올린 실촬영 화면인가(2026-09-04) — 파괴적 편집 기법이 이 씬을 피한다. */
    realFootage: z.boolean().optional(),
    /** 씬 초점(2026-09-09) — 화면 기준 0~1. 비전 QA 가 읽은 핵심 부위 중심을 서버가 cover 배치로 변환한 값.
     *  포인터 링·스포트라이트·인셋 확대창은 이 값이 있는 씬에만 걸린다. */
    focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
    kind: z.enum(['hook', 'stat', 'list', 'quote', 'chart', 'cta', 'compare']).optional(),
    stat: z.object({ value: z.number(), unit: z.string().optional(), label: z.string().optional() }).optional(),
    items: z.array(z.string()).max(4).optional(),
    /** CTA 결론(2026-08-28) — "조건 → 답" 쌍을 화면에 띄운다. 무음 시청·되감기 없음 대응. */
    takeaways: z.array(z.object({ when: z.string(), then: z.string() })).max(3).optional(),
    /** 대비 씬(2026-09-03) — "이것 말고 이것". 위치 추측이 필요 없는 연출(화살표 도해 대체). */
    compare: z.object({
      bad: z.object({ label: z.string(), note: z.string().optional() }),
      good: z.object({ label: z.string(), note: z.string().optional() }),
    }).optional(),
    quote: z.object({ text: z.string(), source: z.string().optional() }).optional(),
    chart: z.object({
      series: z.array(z.object({ label: z.string(), value: z.number() })).max(5),
      unit: z.string().optional(), highlight: z.number().optional(),
    }).optional(),
    /** 씬 연출(결정적 kind 기본값, 서버가 산정) — 미지정=종전 동작(fade 엔터 + index parity 켄번즈). */
    fx: z.object({
      enter: z.enum(['none', 'fade', 'slide-up', 'wipe', 'scale']).optional(),
      move: z.enum(['zoom-in', 'zoom-out', 'push', 'none']).optional(),
      intensity: z.enum(['subtle', 'normal', 'strong']).optional(),
      accent: z.enum(['spotlight', 'particles-leaves', 'particles-petals', 'particles-snow']).optional(),
    }).optional(),
    /** 구절 자막(2026-09-18) — 내레이션을 4~14자 구절로 나눈 것(씬 로컬 프레임). 서버가 본문 씬에만 채운다.
     *  있으면 하단(bottomPct)에 구절이 뜨고 라벨(screenText)은 9% 위로 비켜 선다. 없으면 종전(라벨만). */
    captions: z.array(z.object({ text: z.string(), startFrame: z.number(), endFrame: z.number() })).optional(),
  })),
  /** 카메라 드리프트 시드(2026-09-03) — 편·씬마다 다른 손 흔들림. 미지정=흔들림 없음(종전 궤도). */
  driftSeed: z.string().optional(),
  /** 룩 자리 이동(2026-09-04) — 형제편(같은 대본·이미지)이 원편과 다른 색을 받게. 원편 0, 형제 1. */
  lookOffset: z.number().optional(),
  totalFrames: z.number(),
  /** 자막 옵션 — 위치(하단 여백 %)·키워드 강조색·테두리·글자 크기. 미지정=컴포넌트 기본값. */
  caption: z.object({ bottomPct: z.number().optional(), keyword: z.string().optional(), outline: z.boolean().optional(), fontPx: z.number().optional(), hookFontPx: z.number().optional() }).optional(),
  /** 상단 고정 제목(별도 생성한 투명 캘리 PNG) — 전 씬 지속 오버레이. 미지정=없음(종전). */
  title: z.object({ imageSrc: z.string(), topPct: z.number().optional(), widthPct: z.number().optional() }).optional(),
});
export type AutoShortsProps = z.infer<typeof autoShortsSchema>;

const CLIP_SECONDS = 6; // clipFrames 미지정 시 감속 배율 산정 폴백 — 프레임 수는 fps 에서 유도

const Scene: React.FC<{ s: AutoShortsProps['scenes'][number]; index: number; caption?: AutoShortsProps['caption']; driftSeed?: string; look?: FilmLook; capMotion?: CaptionMotionName;
  /** 이 씬에 걸린 선택 기법(없으면 undefined). */
  tech?: EditTechnique; techSeed?: string;
  /** 다음 씬이 '줌 스루 전환'이면 이 씬 끝이 확대되며 흐려진다(앞 씬 쪽 절반). */
  exitZoom?: boolean }> = ({ s, index, caption, driftSeed, look, capMotion, tech, techSeed, exitZoom }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 필름 룩 — 배경(이미지·클립)에만 건다. 자막·카드는 별도 레이어라 영향이 없다(글자는 보정 대상이 아니다).
  const baseEffects = look ? filmLookEffects(look) : undefined;
  // 흑백 인서트 — 이 씬만 색을 뺀다. '잠깐 다른 결로 넘어갔다 돌아오는' 편집 장치다.
  //
  // 처음엔 duotone 을 썼는데 실렌더에서 원본 사진이 두 색으로 뭉개져 알아볼 수 없었다.
  // duotone 은 세기 파라미터가 없어(darkColor·lightColor·threshold 뿐) 약하게 걸 방법이 없다 —
  // 사진 기반 채널에는 맞지 않는 도구였다. 채도만 빼면 사진은 그대로 읽히면서 결만 바뀐다.
  // 컬러 팝(2026-09-08) — 씬 들어갈 때 채도·생동감이 올랐다 0.6초쯤에 정상으로 돌아온다. 흑백 인서트의 정반대.
  const pop = tech === '컬러 팝' ? interpolate(f, [0, 4, 20], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  // 소프트 글로우 — 밝은 부분에만(threshold) 부드러운 빛번짐. 세기는 편마다 조금 다르다.
  const glowFx = tech === '소프트 글로우' && techSeed
    ? [glow({ radius: 26, intensity: 0.32 + random(`${techSeed}:glow`) * 0.14, threshold: 0.58 })]
    : [];
  const popFx = pop > 0 ? [saturation({ amount: 1 + 0.32 * pop }), vibrance({ amount: 0.3 * pop }), contrast({ amount: 1 + 0.05 * pop })] : [];
  const extra = [...popFx, ...glowFx];
  const effects = extra.length ? [...(baseEffects ?? []), ...extra] : baseEffects;
  // 정지 강조 — 이 씬의 배경 모션만 멈춘다(자막·카드는 그대로 움직인다). 씬 길이는 안 건드린다.
  // 좌표 기법(포인터 링·인셋 확대창)도 배경을 고정한다 — 켄번즈·드리프트로 배경이 움직이면 좌표가 어긋난다.
  const pinned = tech === '포인터 링' || tech === '인셋 확대창';
  const frozen = tech === '정지 강조' || pinned;
  // 씬 엔터 이펙트 — 종전 '6프레임 페이드인(첫 씬 제외)'을 일반화. 씬 길이 불변이라 TTS 싱크 무손상.
  // TransitionSeries(씬 오버랩=전체 길이 단축)는 '오디오가 길이를 지배' 불변식·SRT 누적 시계와 충돌해 채택하지 않는다.
  const enter = s.fx?.enter ?? (index > 0 ? 'fade' : 'none');
  const p = enter === 'none' ? 1 : sceneEnterFade(f, 6);
  // 구절 자막(2026-09-18)이 있으면 라벨(screenText)은 9% 위로 올라가 구절에게 하단을 내준다.
  // 인셋 확대창도 같은 값을 본다 — 창이 자막을 덮지 않게 자리를 고르는 기준이 '라벨의 하단'이므로.
  const hasCaptions = !!s.captions?.length;
  const labelBottomPct = hasCaptions ? (caption?.bottomPct ?? CAPTION_BOTTOM_PCT) + 9 : caption?.bottomPct;
  const wrap: React.CSSProperties = { opacity: p };
  if (enter === 'slide-up') wrap.transform = `translateY(${(1 - p) * 24}px)`;
  else if (enter === 'scale') wrap.transform = `scale(${0.96 + 0.04 * p})`;
  else if (enter === 'wipe') { wrap.opacity = 1; wrap.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`; }
  // 아이리스 리빌(2026-09-08) — 씬이 원형으로 열리며 시작한다. 엔터 페이드 대신 이걸로 들어온다.
  if (tech === '아이리스 리빌') {
    const r = interpolate(f, [0, 18], [8, 150], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    wrap.opacity = 1;
    wrap.clipPath = `circle(${r.toFixed(1)}% at 50% 45%)`;
  }
  // 핸드헬드 흔들림 — 정지 이미지 씬에만(techniqueScene 이 실촬영 씬을 피한다), 아주 작게. 여러 사인파를 겹쳐 손떨림처럼.
  if (tech === '핸드헬드 흔들림' && techSeed && !s.videoSrc) {
    const amp = 3 + random(`${techSeed}:hha`) * 3; // 3~6px
    const ph1 = random(`${techSeed}:hh1`) * 6.28, ph2 = random(`${techSeed}:hh2`) * 6.28, ph3 = random(`${techSeed}:hh3`) * 6.28;
    const x = amp * Math.sin(f / 11 + ph1) + amp * 0.5 * Math.sin(f / 5.3 + ph2);
    const y = amp * 0.8 * Math.sin(f / 9 + ph3) + amp * 0.4 * Math.sin(f / 4.1 + ph1);
    wrap.transform = `${wrap.transform ?? ''} translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(1.025)`.trim();
  }
  // 줌 스루 전환(2026-09-09) — 이 씬은 확대된 채 흐리게 시작해 10프레임 안에 제자리로 온다(엔터 페이드 대신).
  // 앞 씬은 exitZoom 으로 끝 8프레임 동안 확대되며 흐려진다. 두 절반이 컷에서 만나 '뚫고 들어가는' 느낌이 된다.
  if (tech === '줌 스루 전환') {
    const q = interpolate(f, [0, 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    wrap.opacity = 1;
    wrap.transform = `${wrap.transform ?? ''} scale(${(1 + 0.3 * q).toFixed(3)})`.trim();
    if (q > 0.01) wrap.filter = `blur(${(6 * q).toFixed(1)}px)`;
  }
  if (exitZoom) {
    const q = interpolate(f, [s.durationInFrames - 8, s.durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
    if (q > 0.01) {
      wrap.transform = `${wrap.transform ?? ''} scale(${(1 + 0.35 * q).toFixed(3)})`.trim();
      wrap.filter = `blur(${(6 * q).toFixed(1)}px)`;
    }
  }
  return (
    <AbsoluteFill style={wrap}>
      {s.videoSrc ? (
        // 루프 금지 — 씬이 클립(≈6초)보다 길면 재생 속도를 낮춰 클립 한 번이 씬 전체를 덮는다.
        // 종전 <Loop>는 씬 중간에 클립이 처음으로 되감겨 '튕김'이 보였고(실측: 씬 6.6~8.0s vs 클립 6.04s
        // 로 거의 매 씬 발생), 감속 재생은 튕김 제거에 더해 I2V 잔결함(형태 흔들림)도 시각적으로 완화한다.
        // @remotion/media 의 <Video>(4.0.520) — OffthreadVideo 와 달리 effects 프롭을 받는다.
        // 그래서 클립 씬도 스틸 씬과 같은 필름 룩을 받는다(색이 튀면 보정 안 한 것만 못하다).
        <Video
          src={staticFile(s.videoSrc)}
          muted
          playbackRate={Math.min(1, (s.clipFrames ?? CLIP_SECONDS * fps) / Math.max(1, s.durationInFrames))}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          {...(effects ? { effects } : {})}
        />
      ) : (
        <KenBurnsImage src={s.imageSrc} total={s.durationInFrames} index={index} move={frozen ? 'none' : s.fx?.move} intensity={s.fx?.intensity} driftSeed={driftSeed && !pinned ? `${driftSeed}:${index}` : undefined} {...(effects ? { effects } : {})} />
      )}
      {/* 액센트 — 배경 위·자막/오버레이 아래(텍스트는 어두워지거나 가려지지 않게). 스포트라이트 기법 씬은 액센트 스포트라이트와 겹치지 않게. */}
      {s.fx?.accent === 'spotlight' && tech !== '스포트라이트' ? <SpotlightMask /> : null}
      {s.fx?.accent?.startsWith('particles-') ? (
        <ParticleDrift kind={s.fx.accent.slice('particles-'.length) as 'leaves' | 'petals' | 'snow'} sceneIndex={index} />
      ) : null}
      {/* 선택 기법 층 — 배경 위·자막 아래. 자막을 덮으면 읽기가 죽는다. */}
      {tech && techSeed ? <TechniqueLayer tech={tech} seed={techSeed} total={s.durationInFrames} {...(s.focus ? { focus: s.focus } : {})} /> : null}
      {tech === '인셋 확대창' && techSeed && s.imageSrc && s.focus ? <InsetZoom src={s.imageSrc} focus={s.focus} total={s.durationInFrames} seed={techSeed} {...(labelBottomPct != null ? { captionBottomPct: labelBottomPct } : {})} /> : null}
      {s.kind === 'stat' && s.stat ? <StatCountUp stat={s.stat} total={s.durationInFrames} {...(driftSeed ? { seed: `${driftSeed}:${index}` } : {})} /> : null}
      {s.kind === 'list' && s.items?.length ? <ListReveal items={s.items} total={s.durationInFrames} /> : null}
      {s.kind === 'quote' && s.quote ? <QuoteCard quote={s.quote} total={s.durationInFrames} /> : null}
      {s.kind === 'chart' && s.chart ? <BarChartGrow chart={s.chart} total={s.durationInFrames} /> : null}
      {s.kind === 'cta' && s.takeaways?.length ? <TakeawayCard takeaways={s.takeaways} total={s.durationInFrames} /> : null}
      {s.kind === 'compare' && s.compare ? <CompareCard compare={s.compare} /> : null}
      <KineticCaption text={s.screenText} variant={s.kind === 'hook' || s.kind === 'cta' ? s.kind : undefined} bottomPct={labelBottomPct} keyword={caption?.keyword} outline={caption?.outline} fontPx={caption?.fontPx} hookFontPx={caption?.hookFontPx} {...(capMotion ? { motion: capMotion } : {})} {...(tech === '키워드 팝' ? { pop: true } : {})} />
      {/* 구절 자막 — 라벨이 비켜 준 원래 자리(bottomPct)에 낭독 진행대로 한 구절씩. 본문 씬에만 온다(서버가 훅·CTA 엔 안 채운다). */}
      {hasCaptions ? <PhraseCaption captions={s.captions!} bottomPct={caption?.bottomPct} keyword={caption?.keyword} outline={caption?.outline} fontPx={caption?.fontPx} {...(capMotion ? { motion: capMotion } : {})} /> : null}
      {s.audioSrc ? <Audio src={staticFile(s.audioSrc)} /> : null}
    </AbsoluteFill>
  );
};

export const AutoShorts: React.FC<AutoShortsProps> = ({ scenes, caption, title, driftSeed, lookOffset }) => {
  // 룩은 편 단위로 하나 — 실제 촬영본은 한 편 안에서 색이 튀지 않는다. driftSeed(=쇼츠 id)가 없으면
  // 보정 없음(구 props 폴백).
  const look = driftSeed ? pickFilmLook(driftSeed, lookOffset ?? 0) : undefined;
  // 컷 빛샘 — 상시로 바꿨다(2026-09-04). 종전엔 3편 중 2편에만 걸었는데, 사용자가 "뭐가 바뀐지
  // 모르겠다"고 한 편이 하필 안 걸린 편이었다. 장치를 껐다 켜는 것보다 '같은 장치를 매번 다르게'가
  // 판박이를 더 잘 지운다 — 길이·세기·색을 편마다 가른다.
  const flashFrames = driftSeed ? 9 + Math.floor(random(`${driftSeed}:flashLen`) * 8) : 0; // 9~16프레임(0.3~0.53초)
  const flashStrength = driftSeed ? 0.18 + random(`${driftSeed}:flashAmp`) * 0.16 : 0;      // 0.18~0.34
  // 빛샘 색 — 실제 필름 라이트리크는 호박~주황 범위다. 청록으로 돌리면 필름이 아니라 글리치로 보인다.
  // 자막 모션 — 편마다 하나. 영상에서 가장 오래 보이는 요소라 여기가 갈려야 체감이 크다.
  const capMotion = driftSeed ? pickCaptionMotion(random(`${driftSeed}:capmotion`)) : undefined;
  // 선택 편집 기법 — 편마다 2가지. 파라미터만 갈리던 종전엔 8편이 사실상 2조합뿐이었다(실측).
  // 실촬영 씬 — 흑백·정지처럼 화면을 지우는 기법은 여기를 피한다(사장님 영상이 흑백으로 나갔다).
  const realScenes = new Set(scenes.flatMap((s, i) => (s.realFootage ? [i] : [])));
  // 초점 씬 — 좌표 기법(포인터 링·스포트라이트·인셋 확대창)은 QA 가 좌표를 준 정지 이미지 씬에만 걸린다.
  const focusScenes = new Set(scenes.flatMap((s, i) => (s.focus && !s.videoSrc ? [i] : [])));
  const techAt = assignTechniques(driftSeed ?? '', scenes.length, realScenes, focusScenes);
  // 줌 스루 전환은 앞 씬 끝에서 시작한다 — 그 씬에 exitZoom 을 준다.
  const zoomExit = new Set([...techAt].filter(([, t]) => t === '줌 스루 전환').map(([i]) => i - 1));
  const flashHue = Math.round((look && look.temperature < 0 ? 30 : 8) + (driftSeed ? random(`${driftSeed}:flashHue`) * 22 : 0));
  return (
  <AbsoluteFill style={{ background: '#000', fontFamily: FONT_FAMILY }}>
    {/*
      Series → TransitionSeries 로 옮긴 이유는 Overlay 하나 때문이다. Overlay 는 컷 위에 얹히기만
      하고 앞뒤 씬 길이를 건드리지 않는다 — 종전에 전환을 통째로 닫아 뒀던 이유("씬이 겹쳐 전체
      길이가 줄어 오디오 싱크가 깨진다")가 Overlay 에는 적용되지 않는다. Transition 은 여전히
      안 쓴다(그건 실제로 길이를 줄인다).
    */}
    <TransitionSeries>
      {scenes.flatMap((s, i) => {
        // name 은 Studio 타임라인 라벨 전용 — 렌더 결과에는 영향이 없다.
        const seq = (
          <TransitionSeries.Sequence key={`s${i}`} durationInFrames={Math.max(1, s.durationInFrames)} name={`씬${i + 1} · ${s.kind ?? '무연출'}`}>
            <Scene s={s} index={i} caption={caption} driftSeed={driftSeed} look={look} capMotion={capMotion} {...(techAt.get(i) ? { tech: techAt.get(i), techSeed: `${driftSeed}:${i}` } : {})} {...(zoomExit.has(i) ? { exitZoom: true } : {})} />
          </TransitionSeries.Sequence>
        );
        // 컷 위 빛샘 — 씬과 씬 사이에만(첫 씬 앞·마지막 씬 뒤에는 컷이 없다).
        // 커버가 되는 첫 프레임을 건드리지 않으려면 i>0 조건이 필수다.
        if (i === 0 || !driftSeed || !flashFrames) return [seq];
        return [
          <TransitionSeries.Overlay key={`o${i}`} durationInFrames={flashFrames}>
            <CutFlash cutIndex={i} seed={driftSeed} hueShift={flashHue} strength={flashStrength} />
          </TransitionSeries.Overlay>,
          seq,
        ];
      })}
    </TransitionSeries>
    {title?.imageSrc ? <TitleOverlay imageSrc={title.imageSrc} topPct={title.topPct} widthPct={title.widthPct} /> : null}
    <ProgressBar />
  </AbsoluteFill>
  );
};
