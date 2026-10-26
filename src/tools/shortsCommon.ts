/**
 * 쇼츠 렌더러 공유 상수·헬퍼 — ffmpeg 슬라이드쇼(shortsRender)와 Remotion(shortsRenderRemotion)이
 * "오디오가 길이를 지배" 불변식·SRT·길이·씬 전처리를 공유한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { synthesize } from '../voice/tts';
import { sttAvailable } from '../voice/stt';
import { synthesizeChecked, ttsCheckNote, hardToHear } from '../voice/ttsCheck';
import { speciesNamesIn } from '../content/species';
import { CONFIG } from '../config';
import { MIN_CLIP_COVERAGE } from '../content/userAssets';
import { numberTokens } from '../longform/pron';

const execFileP = promisify(execFile);

export const FPS = 30;
export const W = 1080;
export const H = 1920;
export const MIN_SCENE_SEC = 2.8;
export const TAIL_PAD_SEC = 0.6;
export const FRAME_W = 1620;
export const FRAME_H = 2880;

export const SHORTS_TTS_TONE =
  '활기차고 대화하듯, 약간 빠른 템포로 친근하게 낭독한다. 첫 훅은 궁금증을 자아내게 힘주어, 핵심 수치와 결론은 또렷하고 자신감 있게. 광고 성우톤이 아니라 아는 사람이 알려주듯.';

export type SceneKind = 'hook' | 'stat' | 'list' | 'quote' | 'chart' | 'cta' | 'compare';
export interface SceneKindFields {
  kind?: SceneKind;
  stat?: { value: number; unit?: string; label?: string };
  items?: string[];
  quote?: { text: string; source?: string };
  chart?: { series: Array<{ label: string; value: number }>; unit?: string; highlight?: number };
  /** CTA 결론(2026-08-28) — "조건 → 답" 쌍. 무음 시청·되감기 없는 매체라 결론은 화면에도 남겨야 한다. */
  takeaways?: Array<{ when: string; then: string }>;
  /**
   * 대비 씬(2026-09-03) — 틀린 것과 맞는 것을 화면에서 나란히 보여준다.
   * 가리키기 도해(화살표)를 뺀 자리를 메운다: 작가는 이미지를 못 보므로 '이미지의 어디'는 못 짚지만,
   * '무엇 대신 무엇'은 원문만으로 정확히 쓸 수 있다. 위치 추측이 필요 없는 연출이다.
   */
  compare?: { bad: { label: string; note?: string }; good: { label: string; note?: string } };
  /**
   * 씬 초점(2026-09-09) — 비전 QA 가 이미지에서 읽은 '핵심 부위 중심'(이미지 기준 0~1, 왼쪽 위 원점).
   * 포인터 링·스포트라이트·인셋 확대창의 입력. 렌더 시 coverFocus 로 화면 좌표로 바꾼다.
   * 이미지가 바뀌면(재생성·수정요청) 지운다 — 옛 그림의 좌표로 새 그림을 짚으면 엉뚱한 곳을 가리킨다.
   */
  focus?: { x: number; y: number };
}
export interface ShortsScene extends SceneKindFields {
  narration: string; screenText?: string;
  /** 결론 예고(2026-09-18) — CTA 의 첫 조건(답은 뺀다). 오케스트레이터가 본문 한 씬에만 넣는다(teaserFor·teaserSceneIndex). */
  teaser?: string;
}

/**
 * 결론 예고 문구(순수, 2026-09-18) — CTA 씬 첫 takeaway 의 조건(when)만 돌려준다. 답(then)은 끝까지 감춘다.
 * 첫 몇 초 안에 "끝에 무엇이 나오는지"를 보여 주면 마지막까지 보게 만드는 이유가 생긴다 — 답까지 보여 주면
 * 그 이유가 사라진다. 씬이 2개 이하(훅+CTA 뿐)면 예고할 '중간'이 없으므로 undefined. takeaways 가 없어도 undefined —
 * 그 편은 종전과 똑같이 렌더된다(필드 자체를 안 만든다). normalizeSceneKind 가 when 을 12자로 이미 잘라 두지만
 * 구 plan.json 이나 직접 만든 씬도 오므로 같은 상한을 다시 건다.
 */
export function teaserFor(scenes: ReadonlyArray<{ kind?: string; takeaways?: Array<{ when: string; then: string }> }>): string | undefined {
  if (scenes.length <= 2) return undefined;
  const when = scenes.find((s) => s.kind === 'cta')?.takeaways?.[0]?.when;
  if (typeof when !== 'string' || !when.trim()) return undefined;
  return cutAtWordBoundary(when, 12) || undefined;
}
/** 화면 가운데 큰 카드를 그리는 연출 — 예고 카드(상단 오른쪽 띠)와 세로로 겹친다(fix round 1 실측: 4항목 list 위 끝 ≈27.8%,
 *  chart ≈26.8%, compare·quote ≈29%). remotion/AutoShorts.tsx 의 Scene 이 같은 목록으로 렌더 시점에 한 번 더 거른다. */
const TEASER_CLASH_KINDS: ReadonlySet<string> = new Set(['list', 'chart', 'compare', 'quote', 'stat']);
/**
 * 예고 카드를 얹을 씬(순수, fix round 1) — 본문(index ≥ 1, cta 아님) 중 가운데 카드 연출이 없는 첫 씬. 없으면 undefined(카드 없음).
 * 종전엔 무조건 씬 2였는데, 씬 2가 list·chart 면 카드와 연출 패널이 상단 오른쪽에서 겹쳤다.
 */
export function teaserSceneIndex(scenes: ReadonlyArray<{ kind?: string }>): number | undefined {
  for (let i = 1; i < scenes.length; i++) {
    const k = scenes[i]?.kind;
    if (k === 'cta' || (k && TEASER_CLASH_KINDS.has(k))) continue;
    return i;
  }
  return undefined;
}

/**
 * 이미지 기준 초점 → 화면 기준 초점(순수). 배경은 objectFit: cover 로 놓이므로 이미지 가장자리가 잘린다 —
 * 1024×1536 을 1080×1920 에 놓으면 폭이 1280 으로 늘어 좌우 100px 씩 잘린다. 잘린 띠에 떨어진 초점은 null.
 */
export function coverFocus(
  focus: { x: number; y: number }, imgW: number, imgH: number, canvasW = W, canvasH = H,
): { x: number; y: number } | null {
  if (!(imgW > 0 && imgH > 0) || !Number.isFinite(focus.x) || !Number.isFinite(focus.y)) return null;
  const scale = Math.max(canvasW / imgW, canvasH / imgH);
  const dispW = imgW * scale, dispH = imgH * scale;
  const x = (focus.x * dispW + (canvasW - dispW) / 2) / canvasW;
  const y = (focus.y * dispH + (canvasH - dispH) / 2) / canvasH;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

/**
 * LLM 씬 오브젝트에서 kind·페이로드를 검증 추출 — 실패 시 {} 로 강등(fail-open, 렌더 무중단).
 * 캡: stat unit 6자·label 15자, list 2~4개·각 18자, quote text 40자·source 15자.
 */
const asText = (v: unknown): string => (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : ''; // 오브젝트 등은 '' — '[object Object]' 렌더 유출 방지

/** 상한 안 마지막 공백에서 자른다(단어 경계) — 15자 하드 절단이 "재배노트"를 "재배노"로 깨던 실측 대응. */
export function cutAtWordBoundary(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const sp = head.lastIndexOf(' ');
  return (sp > 0 ? head.slice(0, sp) : head).trim();
}

/**
 * kind 는 선언됐는데 그 페이로드가 비어 렌더가 아무것도 못 그리는 씬(순수, 2026-09-03).
 *
 * normalizeSceneKind 는 불량 페이로드를 조용히 {kind} 로 강등한다(fail-open — 렌더 무중단이 우선).
 * 그 침묵이 실측에서 문제가 됐다: compare 도입 첫 런에서 두 작가 모두 kind 만 보내고 bad·good 을
 * 비웠는데 로그에 아무 흔적이 없어, 영상을 열어 보고서야 알았다. 지시문이 안 먹은 것을 다음 런
 * 전에 알아채려면 세어서 말해 줘야 한다.
 *
 * cta 는 제외한다 — takeaways 생략이 설계상 허용된다(조건 없는 단일 행동 결론).
 */
export function emptyKindScenes(scenes: ReadonlyArray<SceneKindFields>): Array<{ index: number; kind: SceneKind }> {
  const out: Array<{ index: number; kind: SceneKind }> = [];
  scenes.forEach((s, i) => {
    const k = s.kind;
    if (!k) return;
    const missing =
      (k === 'stat' && !s.stat) ||
      (k === 'list' && !s.items?.length) ||
      (k === 'quote' && !s.quote) ||
      (k === 'chart' && !s.chart) ||
      (k === 'compare' && !s.compare);
    if (missing) out.push({ index: i + 1, kind: k });
  });
  return out;
}

/**
 * 페이로드가 빈 kind 를 떼어 낸다(순수, 2026-09-04).
 *
 * 빈 kind 는 화면만 비는 게 아니라 그 씬을 세 군데서 잘못 대접한다.
 *  · defaultSceneFx — 카드가 있는 씬으로 보고 얌전한 움직임(CARD_*)을 준다. 카드가 없는데.
 *  · defaultSceneFx — 계절 파티클 배정에서도 빠진다(카드 씬은 액센트를 안 받는다).
 *  · selectI2vScenes — kind 있는 씬은 점수 5, 없는 씬은 60. '화면에 이미 뭔가 있으니 모션은
 *    다른 데 주자'고 판단한다. 실제로는 배경과 자막뿐인 씬이 가장 심심한 씬이 된다.
 * 그래서 못 채운 kind 는 남겨 두지 않는다 — 셋 다 거짓 전제 위에서 돌게 된다.
 *
 * hook·cta 는 대상이 아니다(emptyKindScenes 가 이미 제외한다) — 페이로드 없이도 성립하는 자리다.
 */
export function dropEmptyKinds<T extends SceneKindFields>(scenes: readonly T[]): { scenes: T[]; dropped: number[] } {
  const out = scenes.map((s) => ({ ...s }));
  const dropped: number[] = [];
  for (const e of emptyKindScenes(out)) {
    const { kind: _drop, ...rest } = out[e.index - 1]!;
    out[e.index - 1] = rest as T;
    dropped.push(e.index);
  }
  return { scenes: out, dropped };
}

/**
 * 본문 씬의 연출 적용률(순수) — 훅·CTA 를 뺀 가운데 씬 중 몇 개가 kind 를 가졌나.
 *
 * 종전 로그는 `scenes.map(s => s.kind).filter(Boolean)` 으로 전 씬을 셌는데, 훅과 CTA 는 프롬프트가
 * 항상 붙이라고 못박은 자리라 이 값은 사실상 절대 0 이 되지 않는다 — 그래서 "본문 씬 최소 1개"
 * 규칙이 지켜지는지 한 번도 확인된 적이 없었다(실측 2026-09-03: 40편 193씬 중 본문 113개가
 * kind 없이 나갔는데 로그는 매번 "연출 hook·cta" 라고만 찍혔다).
 *
 * 가장자리 판정은 위치와 kind 둘 다 본다 — 프롬프트는 씬1=hook·마지막=cta 를 요구하지만
 * 작가가 어기는 경우가 있어, 어느 쪽으로든 훅/CTA 로 보이면 본문에서 뺀다.
 */
export function bodyKindCoverage(scenes: ReadonlyArray<SceneKindFields>): { body: number; withKind: number; kinds: SceneKind[] } {
  const kinds: SceneKind[] = [];
  let body = 0;
  scenes.forEach((s, i) => {
    if (i === 0 || i === scenes.length - 1 || s.kind === 'hook' || s.kind === 'cta') return;
    body++;
    if (s.kind) kinds.push(s.kind);
  });
  return { body, withKind: kinds.length, kinds };
}

export function normalizeSceneKind(raw: unknown): SceneKindFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = String(r.kind ?? '').trim().toLowerCase();
  if (kind === 'hook') return { kind };
  // CTA 결론 카드(2026-08-28 사용자 요청) — 실측(short_6c8936f791): 내레이션은 "허리 높이면 회양목,
  // 어깨 높이 상록이면 사철나무"라고 답을 주는데 화면엔 "자리별 나무 정하기" 라벨만 떴다. 조건·답이
  // 모두 있는 쌍만 싣고, 없거나 불량이면 kind 만 남긴다(종전 동작 — CTA 씬 자체는 유지).
  // 대비 씬 — 양쪽이 다 있어야 성립한다(한쪽만 있으면 대비가 아니다). 불량이면 kind 만 남긴다.
  if (kind === 'compare') {
    const side = (v: unknown): { label: string; note?: string } | null => {
      const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      const label = cutAtWordBoundary(asText(o.label), 14);
      if (!label) return null;
      const note = cutAtWordBoundary(asText(o.note), 18);
      return note ? { label, note } : { label };
    };
    const bad = side(r.bad), good = side(r.good);
    return bad && good ? { kind, compare: { bad, good } } : { kind };
  }
  if (kind === 'cta') {
    const takeaways = (Array.isArray(r.takeaways) ? r.takeaways : [])
      .map((x) => {
        const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        // when 은 시청자가 자기 상황을 찾는 조건, then 은 답 — 둘 다 있어야 화살표 표기가 성립한다.
        const when = cutAtWordBoundary(asText(o.when), 12);
        const then = cutAtWordBoundary(asText(o.then), 12);
        return when && then ? { when, then } : null;
      })
      .filter((x): x is { when: string; then: string } => !!x)
      .slice(0, 3);
    return takeaways.length ? { kind, takeaways } : { kind };
  }
  if (kind === 'stat') {
    const s = (r.stat && typeof r.stat === 'object' ? r.stat : {}) as Record<string, unknown>;
    const rawVal = asText(s.value).replace(/,/g, '').trim();
    const value = rawVal ? Number(rawVal) : NaN; // 빈 값은 Number('')=0 함정 회피 — 명시 거부
    if (!Number.isFinite(value) || Math.abs(value) >= 1e12) return {}; // 12자리+ 는 CountUp 패널 넘침 — 강등
    const unit = asText(s.unit).slice(0, 6);
    const label = asText(s.label).slice(0, 15);
    return { kind: 'stat', stat: { value, ...(unit ? { unit } : {}), ...(label ? { label } : {}) } };
  }
  if (kind === 'list') {
    const items = (Array.isArray(r.items) ? r.items : [])
      .map((x) => asText(x).slice(0, 18)).filter(Boolean).slice(0, 4);
    if (items.length < 2) return {};
    return { kind: 'list', items };
  }
  if (kind === 'quote') {
    const q = (r.quote && typeof r.quote === 'object' ? r.quote : {}) as Record<string, unknown>;
    const text = asText(q.text).slice(0, 40);
    if (!text) return {};
    const source = cutAtWordBoundary(asText(q.source), 15);
    return { kind: 'quote', quote: { text, ...(source ? { source } : {}) } };
  }
  if (kind === 'chart') {
    const c = (r.chart && typeof r.chart === 'object' ? r.chart : {}) as Record<string, unknown>;
    const series = (Array.isArray(c.series) ? c.series : [])
      .map((x) => {
        const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        const rawVal = asText(o.value).replace(/,/g, '').trim();
        const value = rawVal ? Number(rawVal) : NaN;
        const label = asText(o.label).slice(0, 8);
        // 음수·비유한·12자리+ 거부(막대 좌표계·패널 넘침), 라벨 필수(축 없는 막대 무의미)
        return Number.isFinite(value) && value >= 0 && value < 1e12 && label ? { label, value } : null;
      })
      .filter((x): x is { label: string; value: number } => !!x)
      .slice(0, 5);
    if (series.length < 2 || series.every((s) => s.value === 0)) return {}; // 비교가 성립해야 차트
    const unit = asText(c.unit).slice(0, 6);
    const hi = Math.floor(Number(asText(c.highlight)));
    return {
      kind: 'chart',
      chart: { series, ...(unit ? { unit } : {}), ...(Number.isFinite(hi) && hi >= 0 && hi < series.length ? { highlight: hi } : {}) },
    };
  }
  return {};
}
export interface ShortsRenderResult {
  ok: boolean; videoPath?: string; srtPath?: string;
  durationSec?: number; sceneCount?: number; issues: string[];
}
/** 구절 자막 한 조각 — 프레임은 씬 로컬(0 = 씬 첫 프레임). */
export interface Caption { text: string; startFrame: number; endFrame: number }
export interface PreparedScene {
  index: number; imagePath: string | null; audioPath: string | null;
  screenText: string; narration: string;
  durationSec: number; durationInFrames: number; startFrame: number;
  /** 구절 자막(2026-09-18) — 본문 씬(훅·CTA 제외)에만, CONFIG.shortsCaptions 일 때 채운다. 없으면 종전 라벨만. */
  captions?: Caption[];
}

export function sceneDurationSec(audioDurSec: number): number {
  return Math.max(MIN_SCENE_SEC, (audioDurSec > 0 ? audioDurSec : 0) + TAIL_PAD_SEC);
}
export function sceneFrames(durSec: number): number { return Math.round(durSec * FPS); }

/** 월 이름 고유어 교정(순수) — TTS 숫자 한글화 지시가 '10월'을 '십월'로 만들던 실측(2026-08-08 어휘 감사)
 *  대응. 시월·유월은 불규칙이라 프롬프트에 안 맡기고 결정적으로 치환한다. 낭독·자막 공용. */
export function fixMonthNames(s: string): string {
  return (s ?? '').replace(/십월/g, '시월').replace(/육월/g, '유월');
}

/** 낭독 소수점 교정(순수, 2026-10-27 배나무 편) — 작가가 19.5m 를 "십구point오미터"로 써서 영어로 읽혔다. 한글 수 사이의 point·포인트 → " 점 ". */
export function fixSpokenDecimals(s: string): string {
  return (s ?? '').replace(/([영일이삼사오육륙칠팔구십백천만])\s*(?:point|포인트)\s*(?=[영일이삼사오육륙칠팔구])/gi, '$1 점 ');
}

// ── 자막 숫자 표기(2026-10-27 사장님 결정 "자막은 아라비아 숫자") ─────────────────────
// 낭독은 한글 수로 쓰고(TTS 오독 방지) 자막은 그 낭독 대본에서 나온다 — 그래서 자막에 "이백오십 년"이 그대로 찍혔다.
// 자막에 보일 때만 숫자로 바꾼다(타이밍·TTS 는 한글 원문 기준). 단위가 뒤따를 때만 바꾼다 — 이 시기·오래·사과처럼
// 수 글자로 시작하는 낱말을 건드리지 않게. 한 글자 수(이·사·오…)는 길이·비율·연·개월처럼 낱말과 안 겹치는 단위 앞에서만.
// 고유어 수(두 그루·한 해)는 그대로 둔다.
const SINO_DIGIT: Record<string, number> = { 영: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
const SINO_MULT: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
/** 화면 표기 — 길이·무게·비율은 기호로, 나머지는 단위 그대로. */
const DISPLAY_UNIT: Record<string, string> = {
  센티미터: 'cm', 밀리미터: 'mm', 킬로미터: 'km', 킬로그램: 'kg', 밀리리터: 'mL', 퍼센트: '%', 미터: 'm', 센티: 'cm', 그램: 'g', 리터: 'L',
  개월: '개월', 년생: '년생', 년차: '년차', 년: '년', 주일: '주일',
  시간: '시간', 그루: '그루', 포기: '포기', 송이: '송이', 가지: '가지', 마리: '마리', 일: '일', 주: '주', 분: '분', 초: '초',
  도: '도', 배: '배', 개: '개', 살: '살', 평: '평', 번: '번', 회: '회', 명: '명', 원: '원', 층: '층', 종: '종',
};
/** 한 글자 수도 바꾸는 단위 — '이 시간·이 번·이 가지·이 배'처럼 지시어와 겹치는 단위는 뺀다. */
const STRONG_UNITS = new Set(['센티미터', '밀리미터', '킬로미터', '킬로그램', '밀리리터', '퍼센트', '미터', '센티', '그램', '리터', '개월', '년생', '년차', '년', '주일']);
const LENGTH_UNITS = new Set(['센티미터', '밀리미터', '킬로미터', '미터', '센티']);
/** 짧은 단위(일·분·도·배…) 뒤가 한글이면 조사일 때만 — '이십 배나무'·'삼십 분재'·'십 도시'를 단위로 읽지 않게. */
const PARTICLE_START = /^(?:$|[^가-힣]|[이가은는을를의에도만부까쯤짜째씩로으와과엔예])/;
const SINO_RUN = '[영일이삼사오육륙칠팔구십백천만]+';
const UNIT_ALT = Object.keys(DISPLAY_UNIT).sort((a, b) => b.length - a.length).join('|');
const DISPLAY_NUM_RE = new RegExp(`(?<![가-힣])(${SINO_RUN})(?:\\s?점\\s?([영일이삼사오육륙칠팔구]+))?\\s?(${UNIT_ALT})(\\s?반(?=$|[^가-힣]|[이은을의에쯤까정으]))?`, 'g');
const MONTH_END = '(?=$|[^가-힣]|[에은는도부까의말초중순쯤경이을로과엔])';
const MONTH_NUM: Record<string, number> = { 십이: 12, 십일: 11, 시: 10, 유: 6, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 칠: 7, 팔: 8, 구: 9 };
const MONTH_RE = new RegExp(`(?<![가-힣])(${Object.keys(MONTH_NUM).join('|')})월${MONTH_END}`, 'g');
/** 띄어 쓴 이웃 수(일 이 미터 = 1~2m) — 긴 단위 앞에서만 붙여 범위로 읽힌다. */
const SPACED_PAIR_RE = new RegExp(`(?<![가-힣])([일이삼사오육칠팔])\\s([이삼사오육칠팔구])(?=\\s?(?:${[...STRONG_UNITS].sort((a, b) => b.length - a.length).join('|')}))`, 'g');
/** 1000 이상은 천 단위 쉼표(24,000명). */
const fmtNum = (n: number): string => (n >= 1000 ? n.toLocaleString('en-US') : String(n));
const MONTH_PAIR_RE = new RegExp(`(?<![가-힣])(?:구시|([이삼사오육칠팔])([삼사오육칠팔구]))월${MONTH_END}`, 'g');

/**
 * 숫자 카드의 값을 그 씬에서 말하나(순수, 2026-10-27 배나무 편) — 씬2 카드에 '250년'을 띄웠는데 낭독은 씬3에서야 말했다.
 * 작가 규칙("내레이션에서도 그 수치를 말해라")을 어긴 카드는 화면이 소리보다 앞서 나간다. 한자어(이백오십 년)·고유어(세 가지)·숫자 모두 센다.
 */
export function statSpoken(narration: string, value: number): boolean {
  const n = fixSpokenDecimals(narration ?? '').replace(/(\d)([만천])\s+(?=\d)/g, '$1$2'); // 2만 4천 → 2만4천(numberTokens 가 한 덩어리로)
  const shown = (numeralsForDisplay(n).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, '')));
  return [...shown, ...numberTokens(n).map(Number)].some((x) => Math.abs(x - value) < 1e-9);
}

/** 말하지 않은 숫자 카드는 빼고 일반 씬으로(순수) — 라벨(screenText)·자막은 그대로. Remotion 렌더와 모션그래픽 대상 판정이 같이 쓴다. */
export function dropUnspokenStat<T extends ShortsScene>(sc: T): T {
  if (sc.kind !== 'stat' || !sc.stat || statSpoken(sc.narration, sc.stat.value)) return sc;
  const { stat: _stat, kind: _kind, ...rest } = sc;
  return rest as T;
}

/** 한자어 수 낱말 → 정수(순수). 자릿값 순서가 어긋나면(삼사·사이·십백) null — 낱말이지 수가 아니다. */
export function parseSinoNumber(w: string): number | null {
  let total = 0, section = 0, digit: number | null = null, lastMult = Infinity;
  for (const ch of w) {
    if (ch in SINO_DIGIT) {
      if (digit !== null) return null;
      digit = SINO_DIGIT[ch]!;
    } else if (ch in SINO_MULT) {
      const m = SINO_MULT[ch]!;
      if (m >= lastMult || digit === 0) return null;
      section += (digit ?? 1) * m; digit = null; lastMult = m;
    } else if (ch === '만') {
      if (total || digit === 0) return null;
      total = (section + (digit ?? 0) || 1) * 10_000; section = 0; digit = null; lastMult = Infinity;
    } else return null;
  }
  if (w.length > 1 && w.includes('영')) return null; // 영은 홀로(영 점 오)만
  return total + section + (digit ?? 0);
}

/**
 * 자막용 숫자 표기(순수) — "수령 이백오십 년, 키가 십구 점 오 미터예요" → "수령 250년, 키가 19.5m예요".
 * 이웃한 한 자리 수 둘은 범위(삼사 미터 → 3~4m, 사오월 → 4~5월), "오에서 십 미터" → "5~10m". 바꿀 수 없으면 원문 그대로.
 */
export function numeralsForDisplay(s: string): string {
  let t = (s ?? '')
    .replace(MONTH_PAIR_RE, (m, a?: string, b?: string) => {
      if (!a) return '9~10월';
      return SINO_DIGIT[b!]! === SINO_DIGIT[a]! + 1 ? `${SINO_DIGIT[a]}~${SINO_DIGIT[b!]}월` : m;
    })
    .replace(MONTH_RE, (_m, w: string) => `${MONTH_NUM[w]}월`)
    .replace(SPACED_PAIR_RE, (m, a: string, b: string) => (SINO_DIGIT[b]! === SINO_DIGIT[a]! + 1 ? `${a}${b}` : m));
  t = t.replace(DISPLAY_NUM_RE, (m: string, num: string, dec: string | undefined, unit: string, half: string | undefined, offset: number, all: string) => {
    if (!STRONG_UNITS.has(unit) && !PARTICLE_START.test(all.slice(offset + m.length))) return m;
    const shown = DISPLAY_UNIT[unit]!;
    const tail = half && !LENGTH_UNITS.has(unit) ? half : '';
    if (num === '일' && unit === '주일') return m; // 일주일은 낱말
    // 이웃한 한 자리 수 둘 = 범위(오륙도 같은 고유명은 도·배 앞이라 뺀다, 일이는 '일이 많다'와 겹쳐 긴 단위 앞에서만)
    if (!dec && num.length === 2 && (num[0] !== '일' || STRONG_UNITS.has(unit)) && unit !== '도' && unit !== '배') {
      const a = SINO_DIGIT[num[0]!], b = SINO_DIGIT[num[1]!];
      if (a !== undefined && b !== undefined && b === a + 1) return `${a}~${b}${shown}${tail}`;
    }
    const n = parseSinoNumber(num);
    if (n === null) return m;
    if (num.length === 1 && num in SINO_DIGIT && !dec && !STRONG_UNITS.has(unit)) return m; // 이 시간·이 번·오 분
    let value = fmtNum(n);
    if (dec) value += '.' + [...dec].map((c) => SINO_DIGIT[c]).join('');
    else if (half && LENGTH_UNITS.has(unit)) value += '.5';
    return `${value}${shown}${tail}`;
  });
  // 범위 앞 수 — "오에서 10m" → "5~10m"(앞 수는 단위 없이 온다). 한 글자 '일'은 '일에서(일터에서)'와 겹쳐 뺀다.
  return t.replace(new RegExp(`(?<![가-힣])(${SINO_RUN})\\s?에서\\s?(?=\\d)`, 'g'), (m, num: string) => {
    if (num === '일') return m;
    const n = parseSinoNumber(num);
    return n === null ? m : `${fmtNum(n)}~`;
  });
}

// ── 구절 자막(2026-09-18) ────────────────────────────────────────────────────
// 인스타 릴스·유튜브 쇼츠는 무음 자동재생으로 시작한다 — 첫 시청에서 낭독은 안 들린다. 종전 화면 글자는
// 씬당 15자 라벨(screenText)뿐이라, 소리를 켜기 전엔 무슨 얘긴지 알 수 없었다. 내레이션을 4~14자 구절로
// 나눠 낭독 진행에 맞춰 하단에 한 구절씩 띄운다. 단어 단위 싱크(forced alignment)는 없다 — 구절 글자 수
// 비례로 시각을 배정한다. ElevenLabs 낭독 속도가 대체로 고르므로 구절 단위에서는 어긋남이 눈에 안 띈다.
const PHRASE_MIN = 4;
const PHRASE_MAX = 14;
/** 공백 뺀 글자 수 — 화면 폭을 먹는 건 글자지 공백이 아니다. 문장부호는 센다(화면에 보인다). */
const phraseLen = (s: string): number => Array.from(s.replace(/\s+/g, '')).length;

/** 경계 정규식 뒤의 공백에서 자른다 — 경계 문자(마침표·쉼표·어미)는 앞 조각에 남는다. */
const splitAfter = (s: string, re: RegExp): string[] => s.split(re).map((t) => t.trim()).filter(Boolean);

/** 상한을 넘는 조각을 '상한 안 마지막 공백'에서 잘라 나간다(탐욕). 첫 단어가 이미 상한을 넘으면 통째로 둔다. */
const packWords = (s: string): string[] => {
  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [], len = 0;
  for (const w of words) {
    const wl = phraseLen(w);
    if (cur.length && len + wl > PHRASE_MAX) { out.push(cur.join(' ')); cur = []; len = 0; }
    cur.push(w); len += wl;
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
};

/**
 * 내레이션 → 4~14자 구절(순수). 경계 우선순위: 문장 종결(.!?…) > 쉼표 > 접속 어미(고·면·는데·지만) >
 * 상한 안 마지막 공백. 상위 경계로 나눈 조각이 상한 안이면 더 내려가지 않는다 — "잠깐, 멈춰요." 는 쉼표가
 * 있어도 한 구절이다. 4자 미만 조각은 앞 구절에 붙인다(첫 조각이면 뒤에). 붙여서 상한을 살짝 넘겨도
 * 다시 나누지 않는다 — 넘친 만큼은 렌더러가 글자를 줄여 받고, 2~3자 조각이 몇 프레임 깜빡이는 쪽이 더 나쁘다.
 */
export function splitPhrases(narration: string): string[] {
  const text = (narration ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const levels: Array<(s: string) => string[]> = [
    (s) => splitAfter(s, /(?<=[.!?…])\s+/),
    (s) => splitAfter(s, /(?<=,)\s+/),
    (s) => splitAfter(s, /(?<=(?:고|면|는데|지만))\s+/),
    packWords,
  ];
  let pieces = [text];
  for (const split of levels) {
    pieces = pieces.flatMap((p) => (phraseLen(p) > PHRASE_MAX ? split(p) : [p]));
  }
  // 짧은 조각 흡수 — 앞 구절에, 앞이 없으면 뒤에. 한 번만 지나간다(다시 나누지 않으므로 종료가 보장된다).
  const out: string[] = [];
  let carry = '';
  for (const p of pieces) {
    const t = carry ? `${carry} ${p}` : p;
    carry = '';
    if (phraseLen(t) < PHRASE_MIN) {
      if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${t}`;
      else carry = t;
    } else out.push(t);
  }
  if (carry) out.push(carry);
  return out;
}

/**
 * 구절별 표시 프레임(순수). 낭독 구간 = durationInFrames − 꼬리 여백(하한 1). 구절 글자 수 비례로 나누되
 * 누적 반올림이라 경계가 빈틈없이 이어지고, 마지막 구절은 씬 끝(꼬리 여백 포함)까지 남는다 — 낭독이
 * 끝나도 마지막 말은 화면에 남아 있어야 읽는다.
 */
export function captionsFor(narration: string, durationInFrames: number, fps = FPS, tailPadSec = TAIL_PAD_SEC): Caption[] {
  const phrases = splitPhrases(narration);
  if (!phrases.length || !(durationInFrames >= 1)) return [];
  const spoken = Math.max(1, durationInFrames - Math.round(tailPadSec * fps));
  const weights = phrases.map(phraseLen);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Caption[] = [];
  let acc = 0, start = 0;
  phrases.forEach((text, i) => {
    acc += weights[i]!;
    const end = i === phrases.length - 1 ? durationInFrames : Math.round((spoken * acc) / total);
    out.push({ text: numeralsForDisplay(text), startFrame: start, endFrame: end }); // 표기만 숫자로 — 시각 배분(weights)은 낭독 한글 기준
    start = end;
  });
  return out;
}

/**
 * 이 씬에 구절 자막을 붙이나, 붙이면 무엇을 — 본문 씬(index ≥ 1, 훅·CTA 아님)에만, CONFIG.shortsCaptions 일 때만.
 * 아니면 undefined(필드 자체를 안 만든다 — off 경로가 종전과 같아야 한다). prepareScenes 와 미리보기 스크립트
 * (scripts/preview_shorts.ts·preview_techniques.ts)가 같은 판정을 쓴다 — 미리보기가 실렌더와 다른 화면을 보여주면 안 된다.
 * 훅은 라벨(screenText)이 곧 자막이고 CTA 는 결론 카드가 화면을 쓴다.
 */
export function captionsForScene(index: number, kind: SceneKind | undefined, narration: string, durationInFrames: number): Caption[] | undefined {
  if (!CONFIG.shortsCaptions || index < 1 || kind === 'hook' || kind === 'cta') return undefined;
  const captions = captionsFor(narration, durationInFrames);
  return captions.length ? captions : undefined;
}

// ── 중간 컷(2026-09-18, SHORTS_MIDCUT) ───────────────────────────────────────
// 한 씬이 5초를 넘으면 같은 화면이 그만큼 머문다 — 숏폼에서 5초는 길다. 씬 중간에서 다른 크롭으로 점프컷하면
// 씬 수·낭독·자막은 그대로 둔 채 화면만 한 번 더 바뀐다. 스틸 씬은 켄번즈 궤도를 바꾸고(KenBurnsImage cutAtFrame),
// 클립 씬은 여분 실촬영이 있을 때만 뒷 절반을 다른 클립으로 바꾼다(없으면 컷 없음 — 같은 클립을 끊어 봐야 튐만 보인다).
/**
 * 씬 중간 컷 프레임(순수) — minSec 초를 넘는 씬만, 중간 프레임. 이하면 undefined(필드 자체를 안 만든다).
 * 반올림이다(floor 가 아니라) — 브리프 검산값(151→76)을 따른다. 홀수 길이에서 1프레임 차이라 화면상 의미는 없다.
 */
export function midcutAt(durationInFrames: number, fps = FPS, minSec = 5): number | undefined {
  if (!(durationInFrames > minSec * fps)) return undefined;
  return Math.round(durationInFrames / 2);
}

/**
 * 클립 씬 중간 컷의 여분 클립 배정(순수). 컷 후보인 클립 씬(index 순)마다, 아직 안 쓴 여분 중 뒷 절반
 * (durationInFrames − cut)을 MIN_CLIP_COVERAGE 이상 덮는 첫 것을 준다 — planVideoSegments 와 같은 하한(과한 감속은
 * 결함으로 보인다). 여분 하나는 한 편에서 한 번만. 스틸 씬·컷 후보 아닌 씬은 건너뛴다(그 씬은 켄번즈 컷 또는 컷 없음).
 * stageAndBuildProps 가 씬을 병렬(Promise.all)로 처리하므로 배정은 그 전에 여기서 한 번에 정한다 — await 사이에서
 * 같은 여분을 두 씬이 집는 경쟁을 없애고, 같은 입력엔 같은 배정이 나온다.
 */
export function planSpareClips<T extends { path: string; seconds: number; startSec?: number }>(
  scenes: ReadonlyArray<{ index: number; durationInFrames: number; hasClip: boolean }>,
  spares: readonly T[],
  fps = FPS,
): Map<number, T> {
  const out = new Map<number, T>();
  const pool = spares.filter((v) => v.path && v.seconds > 0);
  if (!pool.length) return out;
  // 같은 파일의 다른 구간은 서로 다른 여분이다(2026-09-28) — 한 편에 보관소 영상이 하나만 넘어오므로
  // '안 쓰인 다른 파일'이라는 종전 공급원은 항상 비어 있었다(89편 내내 여분 0건). 그래서 중복 판정을
  // 경로가 아니라 (경로, 구간)으로 본다. 렌더러는 이미 구워진 spare_NN.mp4 를 넘기므로 경로가 이미 다르다.
  const keyOf = (v: T): string => `${v.path}@${v.startSec ?? 0}`;
  const used = new Set<string>();
  for (const sc of [...scenes].sort((a, b) => a.index - b.index)) {
    if (!sc.hasClip) continue;
    const cut = midcutAt(sc.durationInFrames, fps);
    if (cut === undefined) continue;
    const need = (MIN_CLIP_COVERAGE * (sc.durationInFrames - cut)) / fps;
    const pick = pool.find((v) => !used.has(keyOf(v)) && v.seconds >= need);
    if (!pick) continue;
    used.add(keyOf(pick));
    out.set(sc.index, pick);
  }
  return out;
}

export function fmtSrtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}
/**
 * SRT — 구절 자막이 있는 씬은 구절별 항목(프레임/FPS 시각 + 씬 시계), 없는 씬은 종전대로 씬당 한 항목. 번호는 이어진다.
 * 구절 시각은 씬 끝(clock + durationSec)에서 클램프한다 — endFrame = round(durationSec·FPS) 라 프레임 시각이 durationSec 을
 * 최대 ½프레임 넘을 수 있고, 다음 씬은 반올림 전 durationSec 에서 시작하므로 클램프 없이는 항목이 16ms 겹친다(실측).
 */
export function buildSrt(scenes: { narration: string; durationSec: number; captions?: Caption[] }[]): string {
  const lines: string[] = [];
  // 영상 씬 시작은 씬마다 round(durationSec·FPS) 프레임을 누적한다(sceneFrames). SRT 도 같은 정수 프레임 시계를 쓴다 —
  // 반올림 전 초를 누적하면 8씬쯤에서 ~0.1초 어긋났다(2026-10-26).
  let clockFrames = 0, n = 0;
  for (const sc of scenes) {
    const clock = clockFrames / FPS;
    clockFrames += sceneFrames(sc.durationSec);
    const end = clockFrames / FPS;
    const cues = sc.captions?.length
      ? sc.captions.map((c) => ({ from: Math.min(end, clock + c.startFrame / FPS), to: Math.min(end, clock + c.endFrame / FPS), text: c.text }))
      : [{ from: clock, to: end, text: numeralsForDisplay(sc.narration) }];
    for (const c of cues) lines.push(`${++n}`, `${fmtSrtTime(c.from)} --> ${fmtSrtTime(c.to)}`, c.text, '');
  }
  return lines.join('\n');
}
export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execFileP('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { timeout: 15_000 });
  const d = parseFloat(String(stdout).trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe 길이 측정 실패: ${file}`);
  return d;
}

/** 이미지 크기(ffprobe) — 초점 좌표 변환용. 실패하면 throw(호출부가 초점 없이 진행). */
export async function probeImageSize(file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await execFileP('ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { timeout: 15_000 });
  const [w, h] = String(stdout).trim().split(',').map((v) => parseInt(v, 10));
  if (!(w! > 0 && h! > 0)) throw new Error(`ffprobe 크기 측정 실패: ${file}`);
  return { w: w!, h: h! };
}

/**
 * 훅(0번) 씬 낭독 표현 폭(2026-09-18) — stability 를 낮춰(하한 0.2) 억양 변화 폭을 넓히고,
 * style 을 높여(상한 0.6) 감정 표현을 키운다. base 를 변형하지 않고 새 객체를 반환한다
 * (작가별 공유 설정 객체를 다른 씬이 이어 쓰므로 훅 씬만 바꾸고 원본은 그대로 둬야 한다).
 */
export function hookVoiceSettings(base: Record<string, number> | undefined): Record<string, number> {
  const b = base ?? {};
  return {
    ...b,
    stability: Math.max(0.2, (b.stability ?? 0.5) - 0.1),
    style: Math.min(0.6, (b.style ?? 0) + 0.15),
  };
}

/** 씬별 TTS 합성(실패 시 무음)·길이 실측·프레임/오프셋 산출. 두 렌더러 공유. */
export async function prepareScenes(
  workDir: string, scenes: ShortsScene[], images: Array<string | null>,
  opts: {
    voice?: string; instructions?: string; signal?: AbortSignal;
    /** 작가별 목소리(2026-09-03) — 미지정이면 전역 기본 보이스. */
    elevenVoiceId?: string; elevenVoiceSettings?: Record<string, number>;
    /** 씬별 클립(2026-09-04) — 배경 폴백 판정에만 쓴다. 클립이 있으면 이미지가 없어도 화면은 찬다. */
    clips?: Array<string | null>;
  },
): Promise<{ prepared: PreparedScene[]; issues: string[] }> {
  fs.mkdirSync(workDir, { recursive: true });
  const issues: string[] = [];
  const prepared: PreparedScene[] = [];
  let startFrame = 0;
  // 낭독 소수점(2026-10-27) — 대본을 고치는 경로가 여럿이라 TTS·자막이 모두 지나는 여기서 한 번 더 교정한다.
  scenes = scenes.map((sc) => {
    const narration = fixSpokenDecimals(sc.narration);
    if (/[A-Za-z]/.test(narration)) console.log(`[숏폼] ⚠ 낭독에 영어 글자 — TTS 가 영어로 읽습니다: ${narration.slice(0, 60)}`);
    return narration === sc.narration ? sc : { ...sc, narration };
  });
  // 수종명 발음 확인(2026-10-02) — STT 가용성은 수종명이 나온 첫 씬에서 한 번만 본다(which 셸 호출).
  let sttOk: boolean | undefined;
  // 받아쓰기가 끝내 못 적은 이름(2026-10-02 리뷰) — 이팝나무처럼 STT 어휘 밖인 이름은 발음이 맞아도 매번 3회 합성이 된다.
  // 한 번 'miss' 로 끝난 이름은 이 편 나머지 씬에서 확인하지 않는다.
  const sttDeaf = new Set<string>();
  for (let i = 0; i < scenes.length; i++) {
    if (opts.signal?.aborted) throw new Error('취소됨');
    const sc = scenes[i]!;
    const nn = String(i + 1).padStart(2, '0');
    let audioPath: string | null = null, audioDur = 0;
    try {
      // 몰아 읽기 대응(실측 2026-08-11, 30클립 중 8클립 경계 0ms): 문장·쉼표 경계 break 태그 +
      // 이웃 씬 스티칭(경계 운율 연속). 둘 다 ElevenLabs 경로 전용이라 폴백(openai/say)엔 무영향.
      // 훅(0번) 씬은 표현 폭을 넓히고 첫 구절 뒤 쉼을 준다(2026-09-18) — hookBreak 가 pauseBreaks 를 대신한다.
      const isHook = i === 0 && CONFIG.shortsHookVoice;
      const synth = (): Promise<Buffer> => synthesize(sc.narration, {
        voice: opts.voice, instructions: opts.instructions ?? SHORTS_TTS_TONE,
        elevenVoiceId: opts.elevenVoiceId,
        elevenVoiceSettings: isHook ? hookVoiceSettings(opts.elevenVoiceSettings) : opts.elevenVoiceSettings,
        pauseBreaks: CONFIG.shortsTtsBreaks,
        hookBreak: isHook,
        previousText: CONFIG.shortsTtsStitch ? scenes[i - 1]?.narration : undefined,
        nextText: CONFIG.shortsTtsStitch ? scenes[i + 1]?.narration : undefined,
        signal: opts.signal,
      });
      // 수종명이 나오는 씬만 받아 적어 확인한다 — 안 들리면 같은 옵션으로 최대 2회 재합성(voice/ttsCheck).
      // 이름은 원문 내레이션에서 뽑는다(TTS 입력 정제본이 아니라). 끄면 사전·STT 를 아예 안 건드린다.
      const names = CONFIG.shortsTtsSttCheck ? speciesNamesIn(sc.narration).filter((n) => !sttDeaf.has(n)) : [];
      if (names.length && sttOk === undefined) {
        sttOk = sttAvailable();
        if (!sttOk) console.log('[숏폼] 발음 확인 건너뜀 — STT 없음(mlx_whisper·ffmpeg)');
      }
      let mp3: Buffer;
      if (names.length && sttOk) {
        const checked = await synthesizeChecked(synth, names, { signal: opts.signal });
        const note = ttsCheckNote(i + 1, checked);
        if (note) console.log(`[숏폼] ${note}`);
        // 받아쓰기가 한 번 실패하면 이 편 나머지 씬은 확인 없이 간다 — 씬마다 상한(45초)까지 기다리지 않게.
        if (checked.outcome === 'stt-error') sttOk = false;
        for (const n of hardToHear(checked)) sttDeaf.add(n); // 미검출·재합성으로야 들린 이름(2026-10-16 — recovered 포함)
        mp3 = checked.mp3;
      } else mp3 = await synth();
      audioPath = path.join(workDir, `narr_${nn}.mp3`);
      fs.writeFileSync(audioPath, mp3);
      audioDur = await probeDuration(audioPath);
    } catch (e) { issues.push(`씬${i + 1} TTS 실패(무음): ${e instanceof Error ? e.message.slice(0, 80) : e}`); }
    const durationSec = sceneDurationSec(audioDur);
    const durationInFrames = sceneFrames(durationSec);
    const imagePath = images[i] && fs.existsSync(images[i]!) ? images[i]! : null;
    // 클립이 있으면 이미지가 없어도 화면은 영상으로 찬다 — 폴백이 아니다(2026-09-04).
    // 실촬영 씬은 이미지를 아예 안 만들므로, 이 구분이 없으면 정상 런마다 "배경 폴백"이 찍혀
    // 정작 이미지 생성이 실패했을 때 그 경보를 못 알아본다.
    const hasClip = !!opts.clips?.[i] && (() => { try { return fs.existsSync(opts.clips![i]!); } catch { return false; } })();
    if (!imagePath && !hasClip) issues.push(`씬${i + 1} 배경 폴백(그라데이션)`);
    // 구절 자막(2026-09-18) — 본문 씬에만(판정은 captionsForScene, 미리보기와 공용). 끄면 필드 자체가 없어 렌더가 종전과 같다.
    const captions = captionsForScene(i, sc.kind, sc.narration, durationInFrames);
    prepared.push({
      index: i, imagePath, audioPath, screenText: sc.screenText ?? '', narration: sc.narration, durationSec, durationInFrames, startFrame,
      ...(captions ? { captions } : {}),
    });
    startFrame += durationInFrames;
  }
  return { prepared, issues };
}

/** 클립 스테이징 판정 — 존재하는 클립이면 public 파일명(clip_NN.mp4), 아니면 null. 복사는 호출자. */
export function resolveClipSrc(clip: string | null | undefined, nn: string): string | null {
  return clip && fs.existsSync(clip) ? `clip_${nn}.mp4` : null;
}

// 씬 연출(fx) — AutoShorts zod 스키마와 동일 어휘. 결정적 kind 기본값(LLM 무관, 순수)이라 재현 가능.
export type SceneAccent = 'spotlight' | 'particles-leaves' | 'particles-petals' | 'particles-snow';
export interface SceneFx {
  enter?: 'none' | 'fade' | 'slide-up' | 'wipe' | 'scale';
  move?: 'zoom-in' | 'zoom-out' | 'push' | 'none';
  intensity?: 'subtle' | 'normal' | 'strong';
  accent?: SceneAccent;
}
/** 계절 파티클(순수) — 봄(3~5) 꽃잎, 가을(9~11) 낙엽, 겨울(12~2) 눈. 여름은 낙하 파티클이 부자연이라 없음. */
export function seasonalParticles(month?: number): SceneAccent | undefined {
  if (!month || month < 1 || month > 12) return undefined;
  if (month >= 3 && month <= 5) return 'particles-petals';
  if (month >= 9 && month <= 11) return 'particles-leaves';
  if (month === 12 || month <= 2) return 'particles-snow';
  return undefined;
}
/**
 * 문자열 → 안정적 정수 시드(순수). 같은 쇼츠는 언제 다시 렌더해도 같은 연출을 받는다.
 *
 * FNV-1a 뒤에 murmur3 의 마무리 혼합(fmix32)을 붙인다. FNV 만 쓰면 하위 비트가 문자열 끝쪽
 * 글자에만 좌우돼서, `"…:0"` `"…:1"` 처럼 접미사가 같은 키들이 같은 하위 비트를 받는다.
 * 실제로 그 함정에 빠졌다 — 서로 다른 쇼츠 두 편이 5개 씬 연출을 통째로 똑같이 받았다.
 */
export function fxSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
/**
 * 축별로 후보 하나를 고른다(순수). 시프트로 비트를 나눠 쓰지 않고 축마다 다시 해싱한다 —
 * 나눠 쓰면 축 하나당 2~3비트뿐이라 편이 달라도 같은 조합이 나오기 쉽다.
 */
function pick<T>(list: readonly T[], seed: number, axis: number): T {
  return list[fxSeed(`${seed}#${axis}`) % list.length]!;
}

// ── 자막·제목 배치 미세 변주(2026-09-03) ─────────────────────────────────────
// 자막 크기·위치와 상단 제목 배치가 176편 전부 같은 픽셀에 있었다. 사용자가 손보정한 값이라
// 갈아엎지 않는다 — 보정값을 중심으로 좁은 폭만 흔든다. 편끼리 프레임이 겹치지 않게 하는 게
// 목적이고, 읽기 편함은 보정값이 이미 잡아 놨다.
//
// 폭이 좁은 데는 이유가 있다. bottomPct 를 크게 흔들면 플랫폼 UI(하단 ~25%)에 자막이 먹히고,
// fontPx 를 크게 흔들면 줄바꿈이 달라져 두 줄이 세 줄이 된다.
const JITTER = { bottomPct: 3, fontPx: 3, hookFontPx: 4, titleTopPct: 2, titleWidthPct: 4 } as const;

/** 시드 기준 −n..+n 의 정수 흔들림(순수). */
function jitter(seed: number, axis: number, n: number): number {
  return (fxSeed(`${seed}~${axis}`) % (2 * n + 1)) - n;
}

/**
 * 편별 자막·제목 배치(순수). seed 가 없으면 보정값 그대로다(구 호출부·테스트 불변).
 * 하한을 두는 값들은 그 하한을 절대 안 넘는다 — 자막이 플랫폼 UI 에 먹히거나 제목이 잘리면
 * 변주의 이득보다 손해가 크다.
 */
export function varyLayout(
  base: { bottomPct: number; fontPx: number; hookFontPx: number; titleTopPct: number; titleWidthPct: number },
  seed?: string,
): { bottomPct: number; fontPx: number; hookFontPx: number; titleTopPct: number; titleWidthPct: number } {
  if (!seed) return base;
  const n = fxSeed(seed);
  return {
    bottomPct: Math.max(30, base.bottomPct + jitter(n, 0, JITTER.bottomPct)),      // 30 미만은 하단 UI 위험
    fontPx: Math.max(56, base.fontPx + jitter(n, 1, JITTER.fontPx)),
    hookFontPx: Math.max(70, base.hookFontPx + jitter(n, 2, JITTER.hookFontPx)),
    titleTopPct: Math.max(3, base.titleTopPct + jitter(n, 3, JITTER.titleTopPct)), // 3 미만은 상단 UI 에 물림
    titleWidthPct: Math.min(88, Math.max(64, base.titleWidthPct + jitter(n, 4, JITTER.titleWidthPct))),
  };
}

// ── 연출 변주표(2026-09-03) ─────────────────────────────────────────────────
// 종전엔 kind 하나에 연출 하나가 고정이었다 — 훅은 언제나 push+스포트라이트, stat 은 언제나
// fade+subtle. 편마다 같은 자리에서 같은 움직임이 나오니 여러 편을 이어 보면 한 틀에서 찍어낸
// 티가 난다. 유튜브 노출이 끊긴 뒤 '틀에서 찍어낸 티'를 줄이는 게 과제가 됐으므로, kind 별로
// '허용되는 연출 묶음'을 두고 쇼츠 id 시드로 고른다.
//
// 무작위가 아니라 시드다 — 같은 쇼츠를 재조립해도 같은 화면이 나와야 재작성 경로가 성립한다.
// 묶음 안의 후보는 전부 그 kind 에 안전한 것만 담는다(카드 씬 배경이 strong 으로 튀지 않는 등).
// 훅은 enter 를 절대 바꾸지 않는다 — 'none' 고정(2026-09-03 실사고).
// 첫 프레임이 곧 커버다: 유튜브 업로드는 extractFirstFrame 으로 프레임 0 을 커버로 지정하고
// 릴스 커버도 같은 자리를 쓴다. 그런데 'none' 을 뺀 엔터는 전부 opacity 0 에서 시작하므로
// 프레임 0 이 새까맣게 나온다. 상단 캘리는 씬 밖 오버레이라 그대로 보여서, 결과가 '검은 배경에
// 제목만' 이 된다(실측: short_1a95e1e542, 프레임 0 평균 밝기 8/255).
// 변주는 move·intensity·accent 로만 준다 — 이 셋은 프레임 0 불투명도에 영향이 없다.
const HOOK_FX: readonly SceneFx[] = [
  { enter: 'none', move: 'push', intensity: 'strong', accent: 'spotlight' },
  { enter: 'none', move: 'zoom-in', intensity: 'strong', accent: 'spotlight' },
  { enter: 'none', move: 'push', intensity: 'strong' },
  { enter: 'none', move: 'zoom-out', intensity: 'strong', accent: 'spotlight' },
];
// 'wipe' 는 변주 묶음에서 뺀다(2026-09-03 실측). Series 는 씬을 겹치지 않으므로 와이프가 아직
// 안 열린 쪽에는 아무것도 없고, 루트 배경인 검정이 그대로 드러난다 — 실측에서 씬 전환 0.2초 동안
// 화면 오른쪽 절반이 순검정이었다(t=10s 우측 테두리 밝기 0.0). 전환이 아니라 결함으로 보인다.
// 스키마에는 남겨 둔다(옛 props 호환) — 자동 선택만 안 한다.
// 카드 씬 — 패널이 주인공이라 배경은 subtle~normal 로 묶는다(strong 은 시선을 뺏는다).
const CARD_ENTER: readonly NonNullable<SceneFx['enter']>[] = ['fade', 'scale', 'slide-up', 'fade'];
const CARD_MOVE: readonly NonNullable<SceneFx['move']>[] = ['zoom-in', 'zoom-out', 'none'];
const CARD_INTENSITY: readonly NonNullable<SceneFx['intensity']>[] = ['subtle', 'subtle', 'normal'];
// 본문(카드 없는) 씬 — 배경뿐이라 크게 움직여도 된다.
const BODY_ENTER: readonly NonNullable<SceneFx['enter']>[] = ['slide-up', 'fade', 'scale', 'slide-up'];
const BODY_MOVE: readonly NonNullable<SceneFx['move']>[] = ['zoom-in', 'zoom-out', 'push'];
const CTA_ENTER: readonly NonNullable<SceneFx['enter']>[] = ['fade', 'scale', 'slide-up'];

/**
 * kind 기반 씬 연출(순수) — I2V 상한제로 스틸이 된 씬의 움직임 공백을 Remotion 네이티브로 메운다.
 * 클립 씬은 undefined(클립이 곧 모션 — 종전 fade 엔터 유지).
 *
 * seed 를 주면 kind 별 허용 묶음에서 편마다 다른 조합을 고른다(편 간 판박이 제거). seed 를 안 주면
 * 종전 고정 연출 그대로다 — 구 호출부·테스트 불변.
 *
 * 파티클은 런당 최대 2씬(본문 한 곳 + cta) — 과장 방지 캡을 코드로 강제한다.
 */
export function defaultSceneFx(kind: SceneKind | undefined, index: number, hasClip: boolean, month?: number, seed?: number): SceneFx | undefined {
  if (hasClip) return undefined;
  const seasonal = seasonalParticles(month);
  if (seed === undefined) { // 종전 동작 보존
    if (kind === 'hook' || (index === 0 && !kind)) return { enter: 'none', move: 'push', intensity: 'strong', accent: 'spotlight' };
    if (kind === 'stat') return { enter: 'fade', intensity: 'subtle' };
    if (kind === 'list') return { enter: 'wipe', intensity: 'subtle' };
    if (kind === 'quote') return { enter: 'scale', intensity: 'subtle' };
    if (kind === 'chart') return { enter: 'slide-up', intensity: 'subtle' };
    if (kind === 'cta') return { enter: 'fade', move: 'zoom-out', intensity: 'normal', ...(seasonal ? { accent: seasonal } : {}) };
    return { enter: index % 2 === 0 ? 'slide-up' : 'fade', intensity: 'strong', ...(seasonal && index === 1 ? { accent: seasonal } : {}) };
  }
  // 씬마다 다른 축을 쓰도록 시드에 index 를 섞는다 — 한 편 안에서도 씬끼리 같은 조합이 반복되지 않게.
  const sc = fxSeed(`${seed}:${index}`);
  if (kind === 'hook' || (index === 0 && !kind)) return pick(HOOK_FX, sc, 0);
  if (kind === 'cta') {
    return { enter: pick(CTA_ENTER, sc, 0), move: pick(['zoom-out', 'zoom-in'] as const, sc, 2), intensity: 'normal', ...(seasonal ? { accent: seasonal } : {}) };
  }
  if (kind === 'stat' || kind === 'list' || kind === 'quote' || kind === 'chart' || kind === 'compare') {
    return { enter: pick(CARD_ENTER, sc, 0), move: pick(CARD_MOVE, sc, 2), intensity: pick(CARD_INTENSITY, sc, 4) };
  }
  // 파티클은 본문 한 곳에만 — 어느 본문 씬이 걸릴지는 편마다 달라진다(종전엔 항상 index 1).
  // 반드시 편 단위 seed 로 뽑는다. 씬 단위 sc 로 뽑으면 씬마다 제각기 '내가 그 자리'라고 판단해
  // 캡이 무너진다(테스트가 실제로 2곳을 잡아냈다).
  const particleAt = 1 + (seed % 2);
  return {
    enter: pick(BODY_ENTER, sc, 0), move: pick(BODY_MOVE, sc, 2), intensity: 'strong',
    ...(seasonal && index === particleAt ? { accent: seasonal } : {}),
  };
}
