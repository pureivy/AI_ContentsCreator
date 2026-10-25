/**
 * 직접 제작 모션그래픽 — 파일럿 전용(2026-10-05 사장님 요청: "B 방식을 우리 숏폼 1~2편에 시험해 원본과 나란히 비교").
 *
 * 2026-10-12 사장님 결정("두 채널 모두 적용")으로 매일 제작에 연결했다 — runShortsJob·reviseShorts 가 렌더 직후
 * applyMotionGraphics 를 부른다(SHORTS_MOTION_GRAPHICS, 기본 켬). 시범 CLI(src/bench/pilotDirect.ts)는 그대로 남는다.
 * 원본은 final.basic.mp4 로 남기고 결과를 final.mp4 로 올린다. 실패·대상 아님(실촬영 없음·정보 카드 없음)이면 원본 그대로.
 *
 * 원본(Biz_Contents_Creator src/orchestrator/shortsDirectMotion.ts, 2026-10-01 매일 제작 확정본)의 방식:
 *   Claude Code 가 씬마다 HTML/CSS/SVG 애니메이션을 직접 짜고, 미리보기 프레임을 스스로 보며 고치고,
 *   브라우저 촬영기(scripts/mg_direct/render_frames.py)가 영상으로 찍는다. 색은 씬 그림에서 뽑고(palette.py),
 *   그래픽 씬은 '원본 그림 위에 그래픽만 얹은 시안'(styleframe.py compose)을 먼저 받아 코드로 재현, 카드는 "유리 + 알약".
 *
 * 우리 쪽 적응(사장님 지시 + 차이점):
 *  - 실촬영 씬(clips/user_NN.mp4)은 원본 그대로 — 원본 final.mp4 의 그 구간을 프레임 단위로 잘라 잇는다. 훅도 그대로.
 *  - 정보 씬(대비·목록·수치·인용·차트·결론 카드)만 직접 제작 그래픽으로. 일반 씬(카드 없음)은 원본 그대로.
 *  - 그래픽 씬 바탕 = 우리 Remotion 렌더에서 카드 필드만 뺀 판 — 제목 캘리·라벨·구절 자막·켄번즈·색보정이 원본과 같아
 *    비교에서 '카드만' 다르다. 음성은 원본 트랙 복사.
 *  - B 의 상담 채널 규칙(민감 주제·사람 표현) 대신 농원 규칙: 대본 밖 사실·숫자 금지, 수종 형태(잎·열매·가시) 그림 금지.
 *  - B 의 I2V·배경 새로 생성·장면 설계(designMotionGraphics) 단계는 가져오지 않았다(우리는 씬 그림·실촬영이 이미 있다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { CONFIG } from '../config';
import { probeDuration, sceneDurationSec, sceneFrames, captionsForScene, varyLayout, W, H } from '../tools/shortsCommon';
import type { ShortsScene, PreparedScene } from '../tools/shortsCommon';
import { RENDER_OPTS, stageAndBuildProps } from '../tools/shortsRenderRemotion';
import { microJSON } from './agent';
import { agentEnv, lastJson, runProc } from './cliProc';
import { isCreditExhausted, markImageCreditOut } from '../tools/imageCredit';

const HARNESS = path.resolve('scripts/mg_direct/render_frames.py');
const SF_SCRIPT = path.resolve('scripts/mg_direct/styleframe.py');
const PALETTE_SCRIPT = path.resolve('scripts/mg_direct/palette.py');
const INFO_CARD_REF = path.resolve('scripts/mg_direct/info_card_ref.html');
const FONTS = { bold: path.resolve('remotion/fonts/Pretendard-Bold.woff2'), extraBold: path.resolve('remotion/fonts/Pretendard-ExtraBold.woff2') };

/** B 사용자 지정 모션그래픽 디자인 지시(2026-09-30, 원문 그대로) — B 방식 비교라 그대로 싣는다. */
export const MG_USER_DIRECTIVE = '당신은 얼마나 놀라운 모션 그래픽 디자이너인지 보여주는 주제에 맞는 한글버전 모션그래픽 비디오를 만들어 보세요. 유튜브, 인스타의 인기있는 숏폼 처럼요. 전력을 다해요.';

/** 카드 필드 — 그래픽 씬 바탕판 렌더에서는 이걸 빼서 우리 카드가 안 그려지게 한다. */
const CARD_FIELDS = ['stat', 'items', 'quote', 'chart', 'takeaways', 'compare'] as const;

/** 그 씬이 우리 렌더에서 정보 카드를 그리는가(순수) — AutoShorts 의 카드 조건과 같다. */
export function hasInfoCard(sc: ShortsScene): boolean {
  switch (sc.kind) {
    case 'compare': return !!sc.compare;
    case 'list': return !!sc.items?.length;
    case 'cta': return !!sc.takeaways?.length;
    case 'stat': return !!sc.stat && Number.isFinite(sc.stat.value);
    case 'quote': return !!sc.quote?.text;
    case 'chart': return !!sc.chart?.series?.length;
    default: return false;
  }
}

/**
 * 직접 제작 그래픽으로 바꿀 씬(순수, 0부터) — 정보 카드 씬만. 실촬영 씬은 카드가 있어도 원본 그대로(사장님 규칙),
 * 훅은 원본 그대로(우리 훅 kind 는 카드가 없다 — 순수 정보 카드 훅이 생기면 그때 다시 본다).
 */
export function pickGraphicScenes(scenes: readonly ShortsScene[], realFootage: readonly boolean[]): number[] {
  return scenes.map((s, i) => (s.kind !== 'hook' && !realFootage[i] && hasInfoCard(s) ? i : -1)).filter((i) => i >= 0);
}

/** 카드 필드를 뺀 씬(순수) — kind 는 남긴다(연출 기본값·자막 배치가 kind 를 본다). */
export function stripCards(sc: ShortsScene): ShortsScene {
  const out = { ...sc } as ShortsScene & Record<string, unknown>;
  for (const k of CARD_FIELDS) delete out[k];
  return out;
}

/**
 * 화면에 꼭 보여줄 대본 정보(순수) — B 72ff79f 교훈: 에이전트에 내레이션·자막만 넘기면 카드의 결론이 사라진다.
 * B 에 없던 대비(compare)를 더했다 — 우리 정보 씬에서 가장 흔한 종류다.
 */
export function sceneInfo(sc: ShortsScene): string {
  const out: string[] = [];
  if (sc.compare) {
    const side = (s: { label: string; note?: string }) => `${s.label}${s.note ? `(${s.note})` : ''}`;
    out.push(`대비: ✕ ${side(sc.compare.bad)} / ✓ ${side(sc.compare.good)}`);
  }
  if (sc.items?.length) out.push(`목록: ${sc.items.map((x, k) => `${'①②③④⑤⑥'[k] ?? `${k + 1}.`} ${x}`).join(' ')}`);
  if (sc.takeaways?.length) out.push(`상황→행동: ${sc.takeaways.map((t) => `${t.when} → ${t.then}`).join(' / ')}`);
  if (sc.quote?.text) out.push(`인용: "${sc.quote.text}"${sc.quote.source ? ` — ${sc.quote.source}` : ''}`);
  if (sc.stat && Number.isFinite(sc.stat.value)) out.push(`수치: ${sc.stat.value}${sc.stat.unit ?? ''}${sc.stat.label ? ` ${sc.stat.label}` : ''}`);
  if (sc.chart?.series?.length) out.push(`차트: ${sc.chart.series.map((x) => `${x.label} ${x.value}${sc.chart!.unit ?? ''}`).join(', ')}`);
  return out.join(' | ');
}

/**
 * 그래픽 구역(순수) — 위는 제목 캘리(TitleOverlay: top% · 폭% · 높이 상한 26% contain), 아래는 본문 라벨.
 * Remotion 자막의 paddingBottom % 는 '폭' 기준이다(1080 × %). 구절 자막이 있으면 라벨이 9% 더 올라간다.
 * 라벨 상자 안쪽 여백 32px + 글자 한 줄(1.25em)까지 비켜 선다.
 */
export function stageBox(a: { titleTopPct: number; titleWidthPct: number; titleAspect: number | null; bottomPct: number; fontPx: number }): { top: number; height: number } {
  const titleBottom = a.titleAspect
    ? (a.titleTopPct / 100) * H + Math.min(0.26 * H, (a.titleWidthPct / 100) * W * a.titleAspect)
    : 0.12 * H;
  const labelTop = H - ((a.bottomPct + 9) / 100) * W - 32 - a.fontPx * 1.25;
  const top = Math.round(titleBottom + 20);
  const bottom = Math.round(labelTop - 24);
  return { top, height: Math.max(360, bottom - top) };
}

/** 씬 구간(순수) — 원본과 같은 산식(낭독 길이 + 0.6초, 하한 2.8초)의 프레임 범위. */
export function sceneRanges(frames: readonly number[], graphic: readonly number[]): Array<{ start: number; frames: number; graphic: boolean }> {
  let start = 0;
  return frames.map((f, i) => { const r = { start, frames: f, graphic: graphic.includes(i) }; start += f; return r; });
}

// 외부 프로세스·중첩 Claude Code 환경은 cliProc.ts 공용(2026-10-22 롱폼 장면 단계와 나눠 쓴다). agentEnv 는 여기서도 그대로 내보낸다.
export { agentEnv };

/** 촬영기·팔레트용 python3(플레이라이트·PIL 이 깔린 시스템 파이썬). */
async function systemPython(): Promise<string> {
  const r = await runProc('bash', ['-lc', 'command -v python3'], { timeoutMs: 15_000 });
  const p = r.stdout.trim().split('\n').pop()?.trim() ?? '';
  return p && fs.existsSync(p) ? p : 'python3';
}

export interface JobScene {
  index: number; frames: number; duration: number; fragment: string; bgFrames: string;
  narration: string; label: string; source: string; kind?: string; info?: string; styleframe?: string;
}

/** 에이전트 지시문(순수) — B agentPrompt 의 확정 스타일(classic) 갈래를 우리 화면 배치·농원 규칙으로 옮김. */
/**
 * 디테일 지시(2026-10-16) — HyperFrames 시범 4편에서 사장님이 짚은 장점(감나무 흙 편: 기존은 "구덩이" 계획을 네모 통으로 그려
 * 양동이 물이 오르내리는 것처럼 보였고, HyperFrames 판은 지면선 아래 파인 단면으로 그려 바로 읽혔다). 도구보다 다듬은 정도의
 * 차이로 보여 지시로 옮겼다. 같은 두 편 비교에서 기존 방식 + 이 지시가 HyperFrames 보다 디테일이 많고 비용은 적었다(감나무 흙 $5.70 vs $9.94,
 * 호두 $4.48 vs $6.90 · 지시 전 $2.6~2.8). 사장님 결정으로 매일 제작에 켬(CONFIG.mgDetailRules, MG_DETAIL_RULES=false 킬스위치).
 */
export const MG_DETAIL_RULES = [
  '- 그림은 내레이션이 말하는 대상이 한눈에 알아보이는 모양으로 그린다 — 구덩이면 지면선 아래로 파인 단면(흙 표면 선 + 움푹한 구덩이 + 그 안의 물), 양동이면 손잡이 달린 통, 가지면 휘는 선. 네모 상자·막대처럼 무엇인지 모를 도형으로 대신하지 않는다. 미리보기에서 "이 그림만 보고 무엇인지 알겠는가"를 확인한다.',
  '- 목록·단계 카드는 내레이션이 그 항목을 말하는 순간에 맞춰 그 줄을 강조색으로 짚는다(강조가 줄을 따라 옮겨 간다).',
  '- 상황→행동, 틀림→맞음은 화살표가 그려지며 두 쪽을 잇게 해 흐름을 보여 준다.',
].join('\n');

export function agentPrompt(topic: string, job: { scenes: JobScene[]; stage: { top: number; height: number } }, opts: { detailRules?: boolean } = {}): string {
  const { top, height } = job.stage;
  const bottom = top + height;
  const g = job.scenes;
  return [
    MG_USER_DIRECTIVE,
    '',
    '당신은 한국어 숏폼(세로 1080×1920) 모션그래픽 디자이너 겸 프론트엔드 개발자다. 이 폴더에서 씬별 애니메이션을 HTML/CSS/SVG 로 직접 만든다. 사람은 보고 있지 않다 — 질문하지 말고 끝까지 스스로 판단한다.',
    '채널: 조경수·묘목 농원(비온디트리)의 나무 정보 숏폼. 시청자는 마당·밭에 나무를 심는 일반인이다.',
    '',
    `[주제] ${topic}`,
    '[만들 씬] (job.json 에도 같은 정보가 있다)',
    ...g.map((s) => `- 씬 ${s.index + 1} → 파일 ${s.fragment} | 길이 ${s.duration.toFixed(1)}초 | 내레이션: ${s.narration} | 라벨(바탕에 이미 있음): ${s.label}${s.info ? ` | 반드시 보여줄 정보: ${s.info}` : ''}`),
    '',
    '[화면 규칙]',
    `- 바탕(미리보기 PNG 에 보인다)은 우리 기존 영상 그대로다: 맨 위 제목 캘리 이미지(y≈90~${top - 20}), 아래쪽 라벨(y≈${bottom + 24}~${bottom + 120})과 구절 자막(그 아래), 사진 같은 씬 그림. 이것들은 바탕에 구워져 있다 — 다시 그리지 않는다.`,
    `- 조각은 #stage 안에 들어간다: 가로 1080, 세로 ${height}, 화면 y=${top}~${bottom}. 제목·라벨과 겹치지 않게 stage 밖으로 나가지 않는다 — 자동 검사가 '그래픽 구역 밖'으로 표시한다.`,
    '- 색은 CSS 변수만: var(--bg) var(--bg2) var(--ink) var(--accent) var(--accent2) var(--card). 이 팔레트는 이 편의 씬 그림·제목 캘리에서 뽑은 색이다 — 그림의 자연광·초록·흙빛과 어울리게(형광·네온 원색 금지). 폰트는 상속(Pretendard, 굵기 800~900). 둥근 카드, 굵은 고딕.',
    '- 유리 카드(backdrop-filter)를 감싸는 상위 요소에는 opacity·filter·clip-path 를 걸지 않는다(값·애니메이션 모두) — 걸면 배경 흐림이 꺼져 흰 판이 된다. 등장 효과(opacity·transform)는 유리 카드 자신에게 건다. 자동 검사가 "유리 흐림 꺼짐"으로 표시한다.',
    '- 사람 몸(손·얼굴)과 수종 형태(특정 나무의 잎 모양·열매 모양·꽃·가시·수피)는 SVG 로 그리지 않는다 — 잘못 그리면 다른 나무로 보여 정보가 틀린다. 필요하면 일반 기호 아이콘(체크·엑스·화살표·달력·온도계·코·물방울·가위·방패 등)만 쓴다.',
    '- 조각 파일 구조: <style> 하나 + 루트 <div class="sNN"> 하나(NN=씬 번호 두 자리). 모든 선택자는 .sNN 으로 시작. 루트는 position:absolute; inset:0.',
    '- 움직임: CSS @keyframes + animation-delay(씬 시작 기준 초) + animation-fill-mode:both, 또는 SVG <animate>/<animateTransform>. 시간은 씬 안의 시간이다. 주요 요소는 씬 앞 55% 안에 등장, 끝 0.3초는 틀이 퇴장시킨다. 무한 반복은 은은한 것만.',
    '- 금지: <script>, 외부 주소(http), <img>/<video>/<iframe>/<link>, @import. JS 없이 CSS/SVG 만 쓴다.',
    '- "반드시 보여줄 정보"(대비·목록·상황→행동·수치)는 글자 그대로(줄이거나 바꾸거나 보태지 말고) 모두 화면에 보여준다 — 무음 시청자가 캡처해 가는 핵심이다. 이 정보 글자는 크기 규칙보다 가독성 우선(36~60px 가능).',
    '- 정보 카드 모양은 이 폴더의 info-card-ref.html 을 먼저 Read 해서 그대로 따른다("유리 + 알약": 흐린 유리 카드 + ✕ 흰 알약 / ✓ 강조색 알약 대비, 상황 흰 알약 → 화살표 → 행동 강조색 알약, 번호 원 + 알약 목록). 선택자 접두만 .sNN 으로 바꾸고, 등장 애니메이션은 자유. 카드 맨 위에는 짧은 머리글 한 줄(그 씬 내레이션·라벨의 핵심 구)을 둔다.',
    '- 글자: 그 씬의 내레이션·라벨·정보에 있는 표현만. 새 사실·숫자·시기·조언을 보태지 않는다(사실 검증을 통과한 대본이다). 라벨과 같은 문장을 그대로 크게 반복하지 말고, 핵심 단어·구조를 시각화한다.',
    '- 디자인: 템플릿처럼 같은 카드 반복 대신, 씬 내용의 논리(대비·순서·조건→답)에 맞는 연출을 고른다.',
    ...((opts.detailRules ?? CONFIG.mgDetailRules) ? [MG_DETAIL_RULES] : []),
    `- 크기·강도: 숏폼에서 한눈에 읽히게 — 머리글 52~80px 굵은 글자, 주 카드 폭 860~1000px, 아이콘 90~160px, 선·화살표 두께 6~12px. 단 구역 높이가 ${height}px 뿐이라 카드 전체 높이가 그 안에 들어가야 한다. 움직임은 분명하게(튀어나오기·그려지기·강조 펄스).`,
    '- 카드 스타일 통일: 모든 카드·말풍선·라벨 상자는 info-card-ref.html 의 유리 카드(background: rgba(255,255,255,.30); backdrop-filter: blur(28px) saturate(1.3); 2px 흰 테두리; 그림자)로 만든다. 불투명 흰 카드 금지 — 자동 검사가 "유리 아님"으로 표시한다. 씬 그림의 핵심 피사체(나무 줄기·열매·가지)는 가급적 피해서 배치하되, 피하려고 그래픽을 작게 만들지는 않는다.',
    '',
    '[절차] 그래픽 씬마다:',
    '1. 파일을 Write 로 작성한다.',
    '2. Bash 로 `./preview.sh N` 을 실행한다(N=씬 번호). 자동 검사 JSON(problems)과 preview/scene_NN_t*.png 4장이 나온다.',
    '3. PNG 를 Read 로 직접 보고 겹침·넘침·가독성(밝은 바탕 위 글자 대비)·움직임 흐름·제목/라벨과의 간격을 점검한다.',
    '4. problems 가 있거나 보기 불편하면 고쳐서 다시 실행한다(씬당 최대 3회).',
    ...(g.some((s) => s.styleframe) ? [
      '',
      '[스타일 프레임 씬] 아래 씬은 이미지 모델이 원본 씬 그림 위에 그래픽을 얹어 그린 목표 시안이 있다(참고용 — 시안은 제목·라벨이 없는 그림 위라 배치 높이는 위 구역 규칙이 우선).',
      ...g.filter((s) => s.styleframe).map((s) => `- 씬 ${s.index + 1}: 목표 시안 styleframes/${path.basename(s.styleframe!)} (Read 로 먼저 본다)`),
      '- 시안의 도형·아이콘·강조·색·크기 비율을 코드로 최대한 재현하고, 요소가 차례로 등장·강조되는 애니메이션을 설계한다(정지 화면 복제 아님).',
      '- 한글은 대본 문구를 정확히 쓴다 — 시안 속 글자가 틀렸거나 다르면 대본을 따른다.',
    ] : []),
    '',
    '[끝] 마지막 줄은 JSON 한 줄만: {"ok":true,"scenes":[{"scene":N,"idea":"한 줄 설명"}]} (검사를 통과하지 못한 씬이 있으면 ok:false 와 사유).',
  ].join('\n');
}

/** 시안 프롬프트 설계 지시문(순수) — B styleframePrompts(onImage) 를 우리 배치(제목 캘리·라벨 자리)로. */
export function styleframeUserPrompt(title: string, scenes: Array<{ n: number; narration: string; label: string; info: string }>, palette: { accent: string; accent2: string; ink: string; card: string }): string {
  return [
    `[주제] ${title}`,
    `[팔레트] 강조 ${palette.accent} · 보조 ${palette.accent2} · 글자 ${palette.ink} · 카드 ${palette.card}`,
    '[만들 핵심 장면]',
    ...scenes.map((s) => `씬 ${s.n} — 내레이션: ${s.narration} / 라벨: ${s.label}${s.info ? ` / 반드시 보여줄 정보: ${s.info}` : ''}`),
    '',
    '각 씬마다 세로 9:16 모션그래픽 "스타일 프레임"(완성 시안 한 장)을 그릴 이미지 프롬프트를 한국어로 써라.',
    '- 구성: 이 씬의 배경 그림(이미 있는 사진풍 나무 그림 — 이미지 편집으로 그 위에 얹는다)은 그대로 두고, 그 위에 얹을 평면 그래픽(흐린 반투명 유리 카드·알약·체크/엑스 기호·화살표)과 글자만 묘사한다. 배경을 다시 묘사하거나 바꾸라고 쓰지 않는다.',
    '- 배치: 화면 높이 28%~58% 사이에만(위는 제목, 아래는 자막 자리). 카드 폭은 화면 폭의 85~92%.',
    '- 그래픽 색은 위 팔레트, 자연광 나무 사진과 어울리게(형광·네온 금지). 글자는 굵은 고딕체로 크게.',
    '- "반드시 보여줄 정보"의 문구를 글자 그대로 모두 카드에 넣는다(따옴표로 정확히). 그 외 글자·숫자·로고 금지.',
    '- 정보 카드 모양: 흐린 반투명 유리 카드(흰 테두리) 안에 — 대비는 ✕ 흰 알약 / ✓ 강조색 알약(흰 글자), 상황→행동은 흰 알약 → 가는 화살표 → 강조색 알약, 목록은 강조색 번호 원 + 흰 알약 줄.',
    '- 사람의 얼굴·손, 특정 나무의 잎·열매·꽃 모양은 새로 그리지 않는다.',
    'JSON 형식: {"frames":[{"n":씬번호,"prompt":"이미지 프롬프트(300자 이내)"}]}',
  ].join('\n');
}

export interface PilotOptions {
  /** 쇼츠 id(data/shorts/<id>). */
  id: string;
  workName?: string;
  /** 시안(스타일 프레임) 생략 — gpt-image 호출 0. 기본은 B 확정 방식대로 생성. */
  noStyleframes?: boolean;
  /** 이미 있는 scene_NN.html 로 검사·촬영만. */
  skipAgent?: boolean;
  /** 에이전트 시간 상한(기본 30분 — B 와 같다). */
  agentTimeoutMs?: number;
  /** 디테일 지시를 이 편에만 켠다(시범 비교용, 2026-10-16). 미지정이면 CONFIG.mgDetailRules. */
  detailRules?: boolean;
  log?: (m: string) => void;
}

export interface PilotMetrics {
  id: string; graphicScenes: number[];
  phasesSec: Record<string, number>;
  wallSec: number;
  calls: { microJSON: number; gptImageCompose: number; gptImageOk: number; claudeCode: number };
  agent?: { turns?: number; durationMs?: number; costUsd?: number; exit: number; tail?: string };
  check?: { ok: boolean; problems: string[] };
  out?: string;
}

/** 파일럿 1편 — 바탕판 렌더 → 팔레트 → (시안) → 에이전트 → 검사 → 촬영·이어 붙이기. 결과·지표는 work/metrics.json. */
export async function runDirectMotionPilot(o: PilotOptions): Promise<PilotMetrics> {
  const log = o.log ?? ((m: string) => console.log(m));
  const t0 = Date.now();
  // 경로가 셸 스크립트(preview.sh)와 하위 명령에 들어간다 — id·작업 폴더 이름은 안전한 글자만 받는다(보안 검토 2026-10-12).
  if (!/^[A-Za-z0-9_-]+$/.test(o.id) || !/^[A-Za-z0-9_.-]+$/.test(o.workName ?? 'pilot-direct') || (o.workName ?? '').includes('..')) {
    throw new Error(`허용되지 않는 id·작업 폴더 이름 — ${o.id} / ${o.workName ?? ''}`);
  }
  const dir = path.join(CONFIG.dataDir, 'shorts', o.id);
  const work = path.join(dir, o.workName ?? 'pilot-direct');
  fs.mkdirSync(work, { recursive: true });
  // 발행 뒤 final.mp4 가 저화질 사본으로 바뀐 편도 시범할 수 있게(2026-10-16) — 모션그래픽 전 원본(final.basic.mp4)이 남아 있으면 그것을 쓴다.
  // 비그래픽 구간은 두 파일이 같다. 매일 제작(applyMotionGraphics)은 final.mp4 가 늘 있어 종전과 같다.
  const original = [path.join(dir, 'final.mp4'), path.join(dir, 'final.basic.mp4')].find((p) => fs.existsSync(p)) ?? path.join(dir, 'final.mp4');
  if (!fs.existsSync(original)) throw new Error(`원본 final.mp4 없음(보관 정리로 저화질 사본만 남은 편) — ${dir}`);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8')) as { title: string; scenes: ShortsScene[] };
  const record = (JSON.parse(fs.readFileSync(path.join(CONFIG.dataDir, 'shorts', 'index.json'), 'utf-8')) as Array<{ id: string; keyword?: string }>).find((x) => x.id === o.id);
  const nn = (i: number) => String(i + 1).padStart(2, '0');
  const m: PilotMetrics = { id: o.id, graphicScenes: [], phasesSec: {}, wallSec: 0, calls: { microJSON: 0, gptImageCompose: 0, gptImageOk: 0, claudeCode: 0 } };
  const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const s = Date.now(); try { return await fn(); } finally { m.phasesSec[name] = Math.round((Date.now() - s) / 100) / 10; } };
  const saveMetrics = () => { m.wallSec = Math.round((Date.now() - t0) / 100) / 10; fs.writeFileSync(path.join(work, 'metrics.json'), JSON.stringify(m, null, 2), 'utf-8'); };

  // 씬 그림(scene-images.json — 재생성 씬은 scenes-retry/ 를 가리킨다)·실촬영 클립·낭독 길이.
  const imgRel = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'scene-images.json'), 'utf-8')) as Array<string | null>; } catch { return []; } })();
  const images = plan.scenes.map((_, i) => { const r = imgRel[i]; const p = r ? path.join(dir, r) : ''; return p && fs.existsSync(p) ? p : null; });
  const clips = plan.scenes.map((_, i) => {
    for (const f of [`user_${nn(i)}.mp4`, `clip_${nn(i)}.mp4`]) { const p = path.join(dir, 'clips', f); if (fs.existsSync(p)) return p; }
    return null;
  });
  const realFootage = clips.map((c) => !!c && path.basename(c).startsWith('user_'));
  // 사장님 규칙(2026-10-12) — 모션그래픽 영상에도 실제 촬영 영상이 반드시 하나 들어간다. 실촬영 씬은 pickGraphicScenes 가 그래픽에서 빼므로 원본 그대로 남는다.
  if (!realFootage.some(Boolean)) throw new Error('실촬영 클립(clips/user_NN.mp4) 없음 — 실제 영상 1개 필수 규칙, 파일럿 대상 아님');
  const frames: number[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const narr = path.join(dir, 'remotion', `narr_${nn(i)}.mp3`);
    if (!fs.existsSync(narr)) throw new Error(`낭독 파일 없음: ${narr}`);
    frames.push(sceneFrames(sceneDurationSec(await probeDuration(narr))));
  }
  const graphic = pickGraphicScenes(plan.scenes, realFootage);
  m.graphicScenes = graphic.map((i) => i + 1);
  if (!graphic.length) throw new Error('정보 카드 씬 없음 — 파일럿 대상 아님');
  const ranges = sceneRanges(frames, graphic);
  const totalFrames = frames.reduce((a, b) => a + b, 0);
  log(`[준비] ${o.id} 씬 ${plan.scenes.length}개 · 그래픽 ${m.graphicScenes.join('·')} · 총 ${totalFrames}프레임`);

  // 1) 바탕판 — 우리 Remotion 렌더에서 그래픽 씬의 카드 필드만 뺀 것(실렌더와 같은 배치·시드·자막 옵션).
  const lay = varyLayout({
    bottomPct: CONFIG.shortsCaptionBottomPct, fontPx: CONFIG.shortsCaptionFontPx, hookFontPx: CONFIG.shortsCaptionHookFontPx,
    titleTopPct: CONFIG.shortsTitleTopPct, titleWidthPct: CONFIG.shortsTitleWidthPct,
  }, o.id);
  const titleArt = path.join(dir, 'title-art.png');
  const bgVideo = path.join(work, 'bg-nocards.mp4');
  if (!fs.existsSync(bgVideo)) {
    await phase('bgRender', async () => {
      const rwork = path.join(work, '.remotion');
      const publicDir = path.join(rwork, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      const scenes = plan.scenes.map((s, i) => (graphic.includes(i) ? stripCards(s) : s));
      let start = 0;
      const prepared: PreparedScene[] = scenes.map((s, i) => {
        const captions = captionsForScene(i, s.kind, s.narration, frames[i]!);
        const p: PreparedScene = {
          index: i, imagePath: images[i] ?? null, audioPath: path.join(dir, 'remotion', `narr_${nn(i)}.mp3`),
          screenText: s.screenText ?? '', narration: s.narration, durationSec: frames[i]! / 30, durationInFrames: frames[i]!, startFrame: start,
          ...(captions ? { captions } : {}),
        };
        start += frames[i]!;
        return p;
      });
      const inputProps = await stageAndBuildProps(publicDir, prepared, scenes, {
        clips, fxSeedKey: o.id,
        caption: {
          bottomPct: lay.bottomPct, fontPx: lay.fontPx, hookFontPx: lay.hookFontPx,
          ...(CONFIG.shortsCaptionKeyword && record?.keyword ? { keyword: record.keyword } : {}),
          ...(CONFIG.shortsCaptionOutline ? { outline: true } : {}),
        },
        ...(fs.existsSync(titleArt) ? { title: { imagePath: titleArt, topPct: lay.titleTopPct, widthPct: lay.titleWidthPct } } : {}),
      });
      const serveUrl = await bundle({ entryPoint: path.resolve('remotion/index.ts'), publicDir, outDir: path.join(rwork, 'bundle') });
      const composition = await selectComposition({ serveUrl, id: 'AutoShorts', inputProps, browserExecutable: RENDER_OPTS.browserExecutable });
      await renderMedia({ serveUrl, composition, codec: 'h264', outputLocation: bgVideo, inputProps, ...RENDER_OPTS });
    });
    log(`[바탕판] ${bgVideo} (${m.phasesSec.bgRender}초)`);
  }

  // 2) 그래픽 씬 바탕 프레임(JPG) — 촬영기가 같은 프레임 번호를 깐다.
  await phase('bgFrames', async () => {
    for (const i of graphic) {
      const out = path.join(work, 'bgframes', `scene_${nn(i)}`);
      if (fs.existsSync(path.join(out, `${String(frames[i]).padStart(4, '0')}.jpg`))) continue;
      fs.mkdirSync(out, { recursive: true });
      const r = await runProc('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-i', bgVideo, '-vf', `trim=start_frame=${ranges[i]!.start}:end_frame=${ranges[i]!.start + frames[i]!},setpts=PTS-STARTPTS`,
        '-q:v', '2', '-start_number', '1', path.join(out, '%04d.jpg')], { timeoutMs: 120_000 });
      if (r.code !== 0) throw new Error(`바탕 프레임 추출 실패 씬${i + 1}: ${r.stderr.slice(-200)}`);
    }
  });

  // 3) 팔레트 — 씬 그림 + 제목 캘리에서(B palette.py 그대로).
  const py = await systemPython();
  const palette = await phase('palette', async () => {
    const r = await runProc(py, [PALETTE_SCRIPT, '--images', ...images.filter((x): x is string => !!x), ...(fs.existsSync(titleArt) ? ['--title', titleArt] : [])], { timeoutMs: 60_000 });
    return lastJson<{ ok?: boolean; palette?: Record<string, string> }>(r.stdout)?.palette ?? null;
  }) ?? { bg: '#F4F1E8', bg2: '#DCE3D2', ink: '#1F2A1C', accent: '#3E7D3A', accent2: '#B5832E', card: '#FFFFFF' };
  log(`[팔레트] ${JSON.stringify(palette)}`);

  // 4) 시안(스타일 프레임) — LLM 1회로 프롬프트 → 씬 그림 위 compose(gpt-image). 결과는 styleframes/ 캐시.
  const sfDir = path.join(work, 'styleframes');
  if (!o.noStyleframes) {
    await phase('styleframes', async () => {
      fs.mkdirSync(sfDir, { recursive: true });
      const need = graphic.filter((i) => images[i] && !fs.existsSync(path.join(sfDir, `frame_${nn(i)}.png`)));
      if (!need.length) return;
      m.calls.microJSON++;
      const user = styleframeUserPrompt(plan.title, need.map((i) => ({ n: i + 1, narration: plan.scenes[i]!.narration, label: plan.scenes[i]!.screenText ?? '', info: sceneInfo(plan.scenes[i]!) })), palette as { accent: string; accent2: string; ink: string; card: string });
      const j = await microJSON<{ frames?: Array<{ n?: unknown; prompt?: unknown }> }>(CONFIG.cloudTierModels.heavy, '당신은 모션그래픽 아트 디렉터입니다. 요청된 JSON 스키마만 출력합니다.', user, { maxOutputTokens: 1500 }).catch(() => null);
      const prompts: Record<number, string> = {};
      for (const f of j?.frames ?? []) { const n = Number(f?.n); const p = String(f?.prompt ?? '').trim(); if (Number.isInteger(n) && p) prompts[n - 1] = p.slice(0, 600); }
      await Promise.all(need.map(async (i) => {
        const p = prompts[i];
        if (!p) { log(`[시안] 씬${i + 1} 프롬프트 없음`); return; }
        fs.writeFileSync(path.join(sfDir, `frame_${nn(i)}.prompt.txt`), p, 'utf-8');
        m.calls.gptImageCompose++;
        const r = await runProc(CONFIG.blogPython || 'python3', [SF_SCRIPT, 'compose', '--in', images[i]!, '--prompt', p, '--out', path.join(sfDir, `frame_${nn(i)}.png`)],
          { timeoutMs: 300_000, env: { ...process.env, ...(CONFIG.openaiApiKey ? { OPENAI_API_KEY: CONFIG.openaiApiKey } : {}) } });
        const res = lastJson<{ ok: boolean; error?: string }>(r.stdout);
        if (res?.ok) m.calls.gptImageOk++;
        else if (isCreditExhausted(res?.error ?? r.stderr)) markImageCreditOut('motion-styleframe'); // 시안 없이도 그래픽은 만든다 — 표시만
        log(`[시안] 씬${i + 1} ${res?.ok ? 'ok' : (res?.error ?? r.stderr.slice(-160))}`);
      }));
    });
  }

  // 5) 촬영 잡.
  const titleAspect = await (async () => {
    if (!fs.existsSync(titleArt)) return null;
    const r = await runProc('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', titleArt], { timeoutMs: 15_000 });
    const [w, h] = r.stdout.trim().split(',').map(Number);
    return w && h ? h / w : null;
  })();
  const stage = stageBox({ titleTopPct: lay.titleTopPct, titleWidthPct: lay.titleWidthPct, titleAspect, bottomPct: lay.bottomPct, fontPx: lay.fontPx });
  const jobScenes: JobScene[] = graphic.map((i) => {
    const sc = plan.scenes[i]!;
    const info = sceneInfo(sc);
    const sf = path.join(sfDir, `frame_${nn(i)}.png`);
    return {
      index: i, frames: frames[i]!, duration: frames[i]! / 30, fragment: `scene_${nn(i)}.html`, bgFrames: path.join(work, 'bgframes', `scene_${nn(i)}`),
      narration: sc.narration, label: sc.screenText ?? '', source: `${sc.narration} ${sc.screenText ?? ''} ${info}`.trim(),
      ...(sc.kind ? { kind: sc.kind } : {}), ...(info ? { info } : {}), ...(fs.existsSync(sf) ? { styleframe: sf } : {}),
    };
  });
  const job = { fps: 30, workDir: work, out: path.join(work, 'final.mp4'), original, palette, stage, fonts: FONTS, ranges, scenes: jobScenes };
  // 보안(2026-10-12 커밋 검토) — 에이전트 입력(낭독·화면 문구)은 웹 조사에서 온 글에서 파생된다. 에이전트가 쓸 수 있는
  // 작업 폴더 안의 job.json·preview.sh 를 고치면 출력 경로를 바꾸거나 허용된 ./preview.sh 로 임의 명령을 돌릴 수 있다.
  // 하네스가 실제로 읽는 job 은 작업 폴더 **밖**(cwd 밖은 acceptEdits 자동 승인 대상이 아니다)에 두고,
  // 작업 폴더의 job.json(안내용 사본)과 preview.sh 는 읽기 전용으로 만든다. 끝난 뒤 preview.sh 변조 여부도 확인한다.
  const jobPath = `${work}.job.json`;
  // 읽기 전용 파일은 덮어쓰기가 막히므로(같은 작업 폴더로 다시 돌 때) 지우고 새로 쓴다.
  const writeRO = (p: string, data: string, mode: number): void => {
    try { fs.unlinkSync(p); } catch { /* 없음 */ }
    fs.writeFileSync(p, data, { encoding: 'utf-8', mode });
  };
  writeRO(jobPath, JSON.stringify(job, null, 2), 0o444);
  writeRO(path.join(work, 'job.json'), JSON.stringify(job, null, 2), 0o444);
  fs.copyFileSync(INFO_CARD_REF, path.join(work, 'info-card-ref.html'));
  // 셸 인용은 작은따옴표로 — 큰따옴표 안에서는 $()·백틱이 살아난다.
  const sq = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;
  const previewSh = `#!/bin/bash\nexec ${sq(py)} ${sq(HARNESS)} ${sq(jobPath)} --preview "$1"\n`;
  writeRO(path.join(work, 'preview.sh'), previewSh, 0o555);

  // 6) 에이전트(Claude Code 1회 세션) — 씬 조각 작성·미리보기 확인·수정.
  if (!o.skipAgent) {
    await phase('agent', async () => {
      const prompt = agentPrompt(plan.title, job, o.detailRules != null ? { detailRules: o.detailRules } : {});
      fs.writeFileSync(path.join(work, 'agent-prompt.txt'), prompt, 'utf-8');
      const args = ['-p', '--model', CONFIG.cloudTierModels.heavy, '--setting-sources', '', '--no-session-persistence', '--max-turns', '90',
        '--permission-mode', 'acceptEdits', '--disallowedTools', 'AskUserQuestion',
        '--allowedTools', 'Read,Write,Edit,Glob,Bash(./preview.sh:*)', '--output-format', 'stream-json', '--verbose'];
      const agentLog = fs.createWriteStream(path.join(work, 'agent.jsonl'));
      agentLog.on('error', () => { /* 로그만 잃는다 */ });
      m.calls.claudeCode++;
      const r = await runProc(CONFIG.claudeCliPath, args, { cwd: work, env: agentEnv(process.env), timeoutMs: o.agentTimeoutMs ?? 30 * 60_000, stdin: prompt, onStdout: (d) => agentLog.write(d) });
      await new Promise<void>((res) => agentLog.end(() => res()));
      const lines = fs.readFileSync(path.join(work, 'agent.jsonl'), 'utf-8').trim().split('\n');
      type AgentResult = { type?: string; result?: string; num_turns?: number; duration_ms?: number; total_cost_usd?: number };
      let result: AgentResult | null = null;
      for (let k = lines.length - 1; k >= 0 && !result; k--) { try { const j = JSON.parse(lines[k]!) as AgentResult; if (j.type === 'result') result = j; } catch { /* 잡음 */ } }
      m.agent = {
        exit: r.code, ...(result?.num_turns != null ? { turns: result.num_turns } : {}), ...(result?.duration_ms != null ? { durationMs: result.duration_ms } : {}),
        ...(result?.total_cost_usd != null ? { costUsd: result.total_cost_usd } : {}), tail: (result?.result ?? r.stderr.slice(-200)).split('\n').pop()?.slice(0, 300),
      };
      log(`[에이전트] exit=${r.code}${r.aborted ? '(시간 초과)' : ''} 턴 ${result?.num_turns ?? '?'} ${m.agent.tail ?? ''}`);
    });
    saveMetrics();
  }

  // 7) 검사 → 촬영·이어 붙이기. 미리보기 스크립트가 바뀌었으면(쓰기 금지를 뚫었으면) 결과를 쓰지 않는다.
  try {
    if (fs.readFileSync(path.join(work, 'preview.sh'), 'utf-8') !== previewSh) throw new Error('preview.sh 변조 감지 — 이 편 모션그래픽 중단');
  } catch (e) { throw e instanceof Error && e.message.includes('변조') ? e : new Error('preview.sh 확인 실패'); }
  await phase('check', async () => {
    const c = await runProc(py, [HARNESS, jobPath, '--check-all'], { timeoutMs: 10 * 60_000 });
    fs.writeFileSync(path.join(work, 'check.json'), c.stdout, 'utf-8');
    try {
      const j = JSON.parse(c.stdout) as { ok: boolean; scenes: Array<{ scene: number; ok: boolean; problems: string[] }> };
      m.check = { ok: j.ok, problems: j.scenes.filter((s) => !s.ok).map((s) => `씬${s.scene}: ${s.problems.slice(0, 3).join('; ')}`) };
    } catch { m.check = { ok: false, problems: [`검사 결과 해석 실패 ${c.stderr.slice(-200)}`] }; }
    log(`[검사] ${m.check.ok ? '전 씬 통과' : m.check.problems.join(' | ')}`);
  });
  await phase('render', async () => {
    const r = await runProc(py, [HARNESS, jobPath, '--render'], { timeoutMs: 20 * 60_000 });
    const rr = r.code === 0 ? lastJson<{ ok?: boolean; out?: string }>(r.stdout) : null;
    if (rr?.ok && rr.out) m.out = rr.out;
    log(`[촬영] ${rr?.ok ? r.stdout.trim() : `실패 ${r.stderr.slice(-400)}`}`);
  });
  saveMetrics();
  return m;
}

/**
 * 매일 제작 연결(2026-10-12) — 정보 카드 씬만 직접 제작 모션그래픽으로 바꾼 영상을 final.mp4 로 올린다.
 * 작업 폴더는 매번 새로(motion-<시각>) — 바탕판(bg-nocards.mp4)이 폴더에 남아 있으면 그대로 다시 쓰여 수정 전 문구가 나간다
 * (모과나무 시범 2회째에서 확인). 원본은 final.basic.mp4 로 보관. 어떤 실패든 false — 원본 영상으로 진행한다.
 */
export async function applyMotionGraphics(id: string, opts: { log?: (m: string) => void } = {}): Promise<boolean> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const dir = path.join(CONFIG.dataDir, 'shorts', id);
  const final = path.join(dir, 'final.mp4');
  const workName = `motion-${Date.now()}`;
  try {
    // 에이전트 제한 60분(2026-10-16 사장님 요청, 종전 20분) — 디테일 지시를 켠 뒤 시범 한 편이 16.7분까지 걸려 20분이 빠듯했다.
    const m = await runDirectMotionPilot({ id, workName, agentTimeoutMs: 60 * 60_000, log: (x) => console.log('[모션그래픽]', x) });
    // 출력 경로는 우리가 만든 작업 폴더의 final.mp4 만 받는다(보안 — 다른 파일을 발행본으로 올리지 않게).
    if (m.out && path.resolve(m.out) !== path.resolve(dir, workName, 'final.mp4')) {
      log(`모션그래픽 건너뜀 — 예상 밖 출력 경로(${m.out.slice(0, 80)}) · 원본 영상 유지`);
      return false;
    }
    if (!m.out || !fs.existsSync(m.out) || m.check?.ok === false) {
      log(`모션그래픽 건너뜀 — ${m.check?.ok === false ? `검사 불합격(${(m.check.problems ?? []).slice(0, 2).join(' · ')})` : '결과 영상 없음'} · 원본 영상 유지`);
      return false;
    }
    fs.copyFileSync(final, path.join(dir, 'final.basic.mp4'));
    fs.copyFileSync(m.out, final);
    log(`모션그래픽 적용 — 씬 ${m.graphicScenes.join('·')} · ${Math.round(m.wallSec)}초${m.agent?.costUsd ? ` · $${m.agent.costUsd.toFixed(2)}` : ''}`);
    return true;
  } catch (e) {
    log(`모션그래픽 건너뜀 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)} · 원본 영상 유지`);
    return false;
  } finally {
    pruneMotionWork(path.join(dir, workName));
  }
}

/** 모션그래픽 작업 폴더에서 다시 안 쓰는 무거운 중간물(정규식 — 테스트 대상). 장면 HTML·시안·검사·지표·에이전트 기록은 사후 확인용으로 남긴다. */
export const MOTION_WORK_HEAVY = /^(?:bgframes|\.remotion|preview|(?:bg-nocards|final(?:\.auto)?|seg_\d+)\.mp4)$/;

/**
 * 성공·실패 모두 작업 폴더의 무거운 중간물을 걷는다(2026-10-22) — 편마다 ~150MB(바탕 프레임 JPG 수백 장·렌더 번들·미리보기)가
 * 10-12 매일 제작 뒤 하루 ~1.5GB씩 쌓였다. 작업 폴더는 매번 새로 만들어(motion-<시각>) 다시 쓰지 않으므로 잃는 것이 없다.
 * 시범 CLI(pilot-*)는 같은 폴더를 이어 쓰는 캐시라 여기서 지우지 않는다(applyMotionGraphics 에서만 부른다).
 */
export function pruneMotionWork(work: string): void {
  let entries: string[] = [];
  try { entries = fs.readdirSync(work); } catch { return; }
  for (const f of entries) {
    if (MOTION_WORK_HEAVY.test(f)) { try { fs.rmSync(path.join(work, f), { recursive: true, force: true }); } catch { /* 무해 — 새벽 정리가 다시 본다 */ } }
  }
}
