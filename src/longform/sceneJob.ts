/**
 * 문장 그림 장면 — 묶음 나누기·작업 명세(job.json)·에이전트 지시문(순수).
 * 한 묶음 = Claude Code 세션 하나 = 같은 장의 연속 문장 최대 8개(장이 길면 고르게 쪼갠다). 장 경계를 넘지 않는다 —
 * 한 세션 안에서 같은 장의 화분·나무를 같은 모양으로 이어 그리게.
 */
import { approxWords, LABEL_MAX_KO, LABEL_MAX_NUMERIC, MAX_LABELS, type Word } from './sceneRules';
import { sceneKey } from './sceneFiles';
import { FPS, GAP_SEC, type TimedSegment } from './timeline';
import type { RefPart } from './speciesCommons';

export const BATCH_MAX = 8;

export interface SceneSpec {
  key: string; file: string; index: number; segId: string;
  narration: string; prev?: string; next?: string;
  chapterIndex: number; chapterTitle: string;
  frames: number; seconds: number;
  /** 장 수종(대본) — 비면 일반 장. */
  species: string[];
  /** 왼쪽 패널에 보이는 화면(실촬영 수종·정지 화면). */
  footage: string;
  words: Word[];
  /** 전체 화면 장면(2026-10-23 견본, 옵트인) — 끼움 카드용 실촬영·장 지정 여부·자막·장 번호. 없으면 종전 장면. */
  full?: SceneFullSpec;
}

export interface SceneFullSpec {
  footage?: { src: string; startFrom: number; durationInFrames: number; species: string };
  /** 이 장의 실촬영 지정 장면 — FootageInset 필수. */
  insetRequired: boolean;
  captions: Array<{ text: string; startFrame: number; endFrame: number }>;
  chapterTotal: number;
}

export interface SceneJob {
  batch: number; repo: string; workDir: string; fps: number; scenes: SceneSpec[];
  /** 전체 화면 장면(옵트인) — 스타일·실촬영 원본 폴더(clips). 없으면 종전 장면. */
  stage?: 'full'; style?: 'A' | 'B'; clipsDir?: string;
  /**
   * 전체 화면 — 이 묶음이 그릴 수종의 프리셋 쓰는 법(use: 장면에 그대로 쓸 species 값)·주의·실물 대조용 사진(작업 폴더 기준 경로).
   * 수종 형태 단계(speciesPreset.ts)가 없었으면 비어 있다. refs = 우리 실촬영 프레임, ext = 공개 도감 사진(Wikimedia Commons, 출처 기록됨 —
   * 실촬영이 못 보여 주는 부위만, 내부 대조용).
   */
  species?: Array<{ nameKo: string; use: string; note?: string; refs: string[]; ext?: Array<{ part: RefPart; file: string }> }>;
}

/** 세그먼트 → 장면 명세(순수). mediaSpecies: 보관소 영상 id → 수종. */
export function sceneSpecs(segments: readonly TimedSegment[], chapterSpecies: Record<string, string[]>, mediaSpecies: (id: string) => string | undefined): SceneSpec[] {
  const chapterIdx = new Map<string, number>();
  for (const s of segments) if (!chapterIdx.has(s.chapter)) chapterIdx.set(s.chapter, chapterIdx.size);
  return segments.map((s, i) => {
    const prev = segments[i - 1]?.chapter === s.chapter ? segments[i - 1]!.narration : undefined;
    const next = segments[i + 1]?.chapter === s.chapter ? segments[i + 1]!.narration : undefined;
    const sp = 'mediaId' in s.shot ? mediaSpecies(s.shot.mediaId) : undefined;
    const footage = 'mediaId' in s.shot ? `${sp ?? '나무'} 실촬영 영상` : s.footageHint?.length ? `영상 없음(${s.footageHint.join('·')} 이야기)` : '같은 장 실촬영의 정지 화면';
    const key = sceneKey(i);
    return {
      key, file: `${key}.tsx`, index: i, segId: s.id, narration: s.narration, ...(prev ? { prev } : {}), ...(next ? { next } : {}),
      chapterIndex: chapterIdx.get(s.chapter)!, chapterTitle: s.chapterTitle, frames: s.frames, seconds: Math.round((s.frames / FPS) * 10) / 10,
      species: chapterSpecies[s.chapter] ?? [], footage, words: approxWords(s.narration, s.frames / FPS - GAP_SEC),
    };
  });
}

/** 묶음 나누기(순수) — 장마다 연속 구간을 최대 max 개씩 고르게(9개 = 5+4). */
export function planBatches(specs: readonly SceneSpec[], max = BATCH_MAX): SceneSpec[][] {
  const out: SceneSpec[][] = [];
  let i = 0;
  while (i < specs.length) {
    let j = i;
    while (j < specs.length && specs[j]!.chapterIndex === specs[i]!.chapterIndex) j++;
    const run = specs.slice(i, j);
    const parts = Math.ceil(run.length / max);
    const size = Math.ceil(run.length / parts);
    for (let k = 0; k < run.length; k += size) out.push(run.slice(k, k + size));
    i = j;
  }
  return out;
}

/** 에이전트 지시문(순수, 한국어) — KIT_API.md 전문 + 이 파이프라인의 규칙·절차. */
export function scenePrompt(job: Pick<SceneJob, 'scenes'>, kitApi: string, o: { episodeTitle?: string } = {}): string {
  const g = job.scenes;
  const keys = g.map((s) => s.key).join(', ');
  return [
    '당신은 나무 정원 유튜브 롱폼(가로 10분)의 문장 그림 담당이다. 낭독 문장 하나마다 그 문장이 말하는 것을 세밀화 부품으로 그려 움직이는 Remotion 장면 파일(.tsx)을 이 폴더에 만든다.',
    '사람은 보고 있지 않다 — 질문하지 말고 끝까지 스스로 판단한다. 화면 왼쪽에는 실촬영 영상이, 장면 아래에는 문장 자막이 따로 나온다(장면 안에 자막을 다시 쓰지 않는다).',
    ...(o.episodeTitle ? [`[이 편] ${o.episodeTitle}`] : []),
    '',
    '[만들 장면] (job.json 에도 같은 정보 — words 는 단어별 말하는 시각 어림(초))',
    ...g.map((s) => [
      `- ${s.key} → 파일 ${s.file} | 길이 ${s.frames}프레임(${s.seconds}초) | 장: ${s.chapterTitle}${s.species.length ? ` (수종 ${s.species.join('·')})` : ''} | 왼쪽 화면: ${s.footage}`,
      `  문장: ${s.narration}`,
      ...(s.prev ? [`  (앞 문장: ${s.prev})`] : []),
      ...(s.next ? [`  (뒤 문장: ${s.next})`] : []),
    ].join('\n')),
    '',
    '[이 파이프라인의 규칙 — 아래 키트 문서보다 우선]',
    "- import 는 `./_kit`(키트 전부 + SceneStage·SceneProps), `react`, `remotion` 만. 키트 문서의 `../SceneStage`·`../../illus/Kit2` 대신 `import { SceneStage, type SceneProps, Planter, … } from './_kit';` 한 줄로. _kit.ts·job.json·check.sh·preview.sh 는 고치지 않는다.",
    '- 파일 하나 = 기본 내보내기 컴포넌트 하나(export default function Scene({ durationInFrames, words }: SceneProps)), SceneStage 무대 안에 그린다.',
    `- 화면 글자는 그 문장에 나온 말만(요약·새 사실·다른 문장의 말 금지). 라벨 ${MAX_LABELS}개 이하(숫자 눈금 별개), 한글 라벨 ${LABEL_MAX_KO}자·숫자 라벨 ${LABEL_MAX_NUMERIC}자 이하(공백 제외). 라벨의 숫자는 문장에 나온 숫자만. 라벨은 맨 위 상수(const L1 = '…')로.`,
    '- SVG id·부품 id 는 장면 키 접두사: s007 장면이면 `s007-glow`, `s007-pot`. url(#…) 은 그 접두사나 공용 kit-·k2- 만.',
    '- 결정성: Math.random·Date·fetch·이미지·외부 주소·<filter> 금지. 무작위는 random(\'시드\')(remotion). 모든 움직임은 useCurrentFrame() 의 함수.',
    '- 문장이 말하는 순서대로 나타나게 — atFromWords(words, 낱말, fps, 기본프레임) 로 그 말을 하는 순간에 맞춘다(words 는 글자 비례 어림이라 기본프레임도 문장 속 위치 비율로 잡는다).',
    '- 가짜 원근 금지(화분을 rotate 로 기울여 바닥 보이기 등) — 시점 전환(Planter view="bottom")을 쓴다. 납작한 도형으로 부품을 흉내 내지 않는다.',
    '- 이웃 장면과 일관되게: 같은 장에서 같은 화분·나무·흙은 같은 부품·재질·색·크기 비율로 그린다. 앞뒤 문장을 읽고 이어지는 그림을 만든다(같은 그림 반복은 피하고, 이번 문장이 새로 말하는 것을 주인공으로).',
    '- 사람 얼굴·브랜드·글씨 간판 금지. 수종 모양(잎·열매)은 키트 부품(Shrub leaf·berries·fruit, Leaf shape)으로만.',
    '',
    '[절차] 장면마다:',
    '1. Write 로 sNNN.tsx 를 쓴다.',
    '2. Bash `./check.sh sNNN` — 빠른 검사(글자·결정성·id·라벨)와 타입 검사. JSON 의 problems 가 비어야 한다.',
    '3. Bash `./preview.sh sNNN` — 20%·55%·90% 시점 스틸 세 장을 가로로 붙인 preview/sNNN.png 가 나온다. 반드시 Read 로 열어 본다: 문장을 그림으로 알아볼 수 있나, 겹침·잘림·빈 화면·글자 가독성, 박자 순서.',
    '4. 문제가 있으면 Edit 로 고치고 2~3 을 다시(장면당 고침 최대 2번). 그래도 안 되면 다음 장면으로 넘어간다.',
    `5. 묶음 장면(${keys})을 모두 끝낸다. 한 장면에 너무 오래 매달리지 않는다(턴 수에 한도가 있다).`,
    '',
    '[끝] 마지막 줄은 JSON 한 줄만: {"ok":true,"scenes":[{"key":"s007","idea":"한 줄 설명"}]} (검사를 통과 못 한 장면이 있으면 ok:false 와 사유).',
    '',
    '────────── 장면 키트 문서(KIT_API.md) ──────────',
    kitApi,
  ].join('\n');
}
