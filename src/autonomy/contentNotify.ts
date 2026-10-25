/**
 * 조각별 ready(검토 대기) 알림 — 블로그·카드뉴스·쇼츠가 검토 가능해지는 순간 push.
 * 텔레그램이면 미리보기 동봉(블로그=본문 발췌, 카드뉴스=슬라이드 앨범, 쇼츠=완성 영상),
 * 웹훅(Slack/Discord)은 텍스트. 킬스위치 NOTIFY_CONTENT_READY=0, 채널 미설정 시 no-op.
 * 실패는 무해 — 알림이 라이프사이클(ready 승격·발행)을 절대 막지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { CONFIG } from '../config';
import {
  notifyConfigured, notifyWebhookOnly, telegramCreds,
  sendTelegramHtml, sendTelegramPhotos, sendTelegramVideo, sendTelegramPhoto,
} from './notify';
import type { TgButton } from './notify';
import type { FactGateInfo } from '../content/factGate';
import { platformLabel, type ShortsPlatform } from '../content/shortsPlatform';
import { readStyleLint, readBriefGate } from '../sessions/digest';
import { META_LABEL_MD } from '../output/render';
import type { BriefGateRecord } from '../sessions/digest';
import { longformStore, type LongformRecord } from '../content/longform';

export interface BlogReadyInfo {
  id: string; title?: string; keyword?: string; seoScore?: number; brand?: string;
  /** 개정 런(자동 SEO 리비전·수동 수정요청) 산출물 — '↻ 개정본' 라벨로 원본 알림과 구분(중복 오해 방지). */
  revised?: boolean;
  /** 사실 게이트 판정 요약(스펙 §2-3) — hold·error 면 검토 알림에 보류 사유를 동봉. */
  factGate?: FactGateInfo;
}
export interface CardReadyInfo {
  id: string; topic: string; brand?: string; slides?: number; sourcePieceId?: string;
  planner?: string; designer?: string;
  factGate?: FactGateInfo;
}
export interface ShortsReadyInfo {
  id: string; topic: string; brand?: string; durationSec?: number; scenes?: number;
  sourcePieceId?: string; writer?: string; director?: string;
  /** 발행 대상 채널(2026-09-03 분리) — 버튼·캡션 표기에 쓴다. 미지정은 레거시(양쪽 겸용). */
  platform?: ShortsPlatform;
  factGate?: FactGateInfo;
}

/** 알림 발송 조건(킬스위치 + 채널 설정) — advancePieceReady 가 사이클 완료 알림 중복 억제 판정에도 쓴다. */
export function contentReadyNotifyEnabled(): boolean {
  return CONFIG.notifyContentReady && notifyConfigured();
}

/** 검토 링크 베이스 — STUDIO_BASE_URL(태일넷 등) 우선, 미설정·스킴 없음(링크화 불가)이면 로컬. */
export function studioBase(): string {
  return /^https?:\/\//i.test(CONFIG.studioBaseUrl) ? CONFIG.studioBaseUrl : `http://127.0.0.1:${CONFIG.port}`;
}

/** 검토 딥링크 — ?piece= 는 검토 탭 자동 선택용(프론트 2단계에서 해석, 그 전엔 스튜디오 홈으로 열림). */
export function reviewLink(pieceId?: string): string {
  return pieceId ? `${studioBase()}/?piece=${encodeURIComponent(pieceId)}` : `${studioBase()}/`;
}

/** 텔레그램 HTML 이스케이프(&·<·> — 우리가 넣는 <b> 태그 외 원문은 전부 평문). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 마크다운 → 발췌용 평문(이미지·링크·헤더·강조·코드펜스 제거, 공백 정리). 순수. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 세션 초안(draft.md 우선, 없으면 draft.json bodyMarkdown)에서 발췌를 뽑는다. 실패 시 빈 문자열. */
function readDraftExcerpt(runId: string, cap = 350): string {
  try {
    const dir = path.join(CONFIG.sessionsDir, runId);
    let md = '';
    try { md = fs.readFileSync(path.join(dir, 'draft.md'), 'utf-8'); } catch { /* 아래 폴백 */ }
    if (!md) {
      const d = JSON.parse(fs.readFileSync(path.join(dir, 'draft.json'), 'utf-8')) as { bodyMarkdown?: string };
      md = d.bodyMarkdown ?? '';
    }
    // 메타 이름표·구분선(2026-10-05 render.renderMarkdown)은 발췌에 넣지 않는다 — 메타 문장 자체는 요약이라 남긴다.
    const text = stripMarkdown(md.replace(`${META_LABEL_MD} `, '').replace(/^-{3,}\s*$/m, ''));
    return text.length > cap ? `${text.slice(0, cap)}…` : text;
  } catch {
    return '';
  }
}

// 웹훅 제목용은 평문 그대로, 텔레그램 HTML 에 넣을 땐 호출측이 escapeHtml 로 감싼다(브랜드 슬러그는 자유 문자열).
const brandTag = (brand?: string): string => (brand ? ` · ${brand}` : '');
// 잘라내기는 이스케이프 전에 — HTML 을 자르면 태그·엔티티가 중간에서 끊겨 텔레그램 400 이 난다.
const clip = (s: string, cap: number): string => (s.length > cap ? `${s.slice(0, cap)}…` : s);

const blogReadyLabel = (revised?: boolean): string => (revised ? '↻ 블로그 개정본 검토 대기' : '📝 블로그 초안 검토 대기');

/**
 * 보류 표시 줄(평문, 순수) — 호출측이 escapeHtml 로 감싼다. 파생은 라벨만 '원문 정합'.
 *
 * breakdown=false 면 '근거 없음 U · 모순 C' 내역을 뺀 건수만 낸다(2026-08-26 최종 리뷰 F5b) —
 * 카드·쇼츠의 보류는 parityIssues(원문 정합) 지적을 unsupported 칸에 담아 나른 것이라 '근거 없음'이
 * 아니고 contradicted 는 구조상 항상 0 이다. 블로그(사실 게이트)만 실제 판정이라 내역을 유지한다.
 */
export function factGateLines(info: FactGateInfo | undefined, maxItems: number, label = '사실 게이트', breakdown = true): string {
  if (!info) return '';
  const clip = (s: string): string => (s.length > 80 ? `${s.slice(0, 80)}…` : s);
  // 시기·수치 잔존(2026-08-27 권고 1) — 결정적 검사라 LLM 정합이 pass 여도 남을 수 있다. 어느 상태에서든 붙인다.
  const timing = info.timing ?? [];
  const timingBlock = timing.length
    ? [`⚠ 원문과 다른 시기·수치 ${timing.length}건`, ...timing.slice(0, 2).map((s) => `• ${clip(s)}`)].join('\n')
    : '';
  // 근거 미확인 사전 확인(블로그, 2026-10-15) — 무엇을 공식 자료로 확인했고 몇 문장을 낮추거나 지웠는지 한 줄.
  const v = info.verify;
  const verifyLine = v && v.verified + v.repaired + v.kept > 0
    ? `🔎 근거 확인 — 공식 자료 확인 ${v.verified} · 낮춤/삭제 ${v.repaired}${v.kept ? ` · 미적용 ${v.kept}` : ''}`
    : '';
  const withTiming = (s: string): string => [verifyLine, s, timingBlock].filter(Boolean).join('\n');
  if (info.status === 'error') return withTiming(`⚠ ${label} 판정 실패 — 수동 검토 필요`);
  // 참고(unverified) — 근거는 없지만 보류시키지 않은 일반 상식 문장(2026-08-27 지시 ①). 구 데이터는 필드가 없다.
  const soft = info.unverified ?? [];
  if (info.status !== 'hold') {
    if (!soft.length) return withTiming('');
    return withTiming([`✅ ${label} 통과 · 근거 미확인(참고) ${soft.length}건`, ...soft.slice(0, maxItems).map((s) => `• 참고: ${clip(s)}`)].join('\n'));
  }
  const items = [...info.unsupported, ...info.contradicted].slice(0, maxItems).map((s) => `• ${clip(s)}`);
  const total = info.unsupported.length + info.contradicted.length;
  const softTail = soft.length ? ` (참고 ${soft.length}건)` : '';
  const head = breakdown
    ? `⚠ ${label} 보류 ${total}건 — 근거 없음 ${info.unsupported.length} · 모순 ${info.contradicted.length}${softTail}`
    : `⚠ ${label} 보류 ${total}건${softTail}`;
  return withTiming([head, ...items].join('\n'));
}

/** 네이버 발행 버튼 이름 — 실제 동작과 같아야 한다(2026-10-01 전체공개 발행부터 NAVER_PUBLISH_PUBLIC 을 따른다). */
export const naverPublishLabel = (): string => (CONFIG.naverPublishPublic ? '네이버 발행(전체공개)' : '네이버 비공개 발행');
/** 자동 임시저장이 꺼진 동안의 안내 1줄(2026-08-27 사용자 확정) — 사람이 버튼을 눌러야 저장된다는 사실을 못 박는다. */
const manualReviewLine = (): string => `✋ 수동 검토 대기 — 아래 "${naverPublishLabel()}" 버튼으로 발행`;

/** 브리프 게이트 줄(2026-08-28) — `⚖ 브리프 반려 43/70 · 미해소 3건` + 지적 최대 2건. 순수 — 테스트 대상.
 * 통과(approved)면 빈 문자열: 정상은 알리지 않는다(줄이 늘면 반려 줄이 묻힌다).
 * 미파싱(unparsed)도 알린다 — 판정을 못 읽었다는 건 게이트가 이번 런에 작동하지 않았다는 뜻이라, 조용히
 * 넘기면 사람이 '검증됐다'고 오해한다. */
export function briefGateLines(g: BriefGateRecord | null | undefined, maxItems = 2): string {
  if (!g || g.verdict === 'approved') return '';
  const clip = (s: string): string => (s.length > 80 ? `${s.slice(0, 80)}…` : s);
  const score = g.score !== null && g.maxScore !== null ? ` ${g.score}/${g.maxScore}` : '';
  const head = g.verdict === 'unparsed'
    ? '⚖ 브리프 판정 미파싱 — 검증 미작동, 수동 검토 필요'
    : `⚖ 브리프 반려${score} · 미해소 ${g.unresolved.length}건`;
  return [head, ...g.unresolved.slice(0, maxItems).map((s) => `• ${clip(s)}`)].join('\n');
}

/**
 * 블로그 ready 텔레그램 메시지(HTML). 순수 — 테스트 대상(autoDraft 는 기본값만 CONFIG 에서 읽는다).
 * styleResidual = 문체 린트 수정 1회 뒤에도 남은 지적 수(2026-08-27 권고 3) — 0 이면 줄 자체가 없다.
 * briefGate = 브리프 게이트 기록(2026-08-28) — 통과·미기록이면 줄 자체가 없다.
 */
export function blogReadyHtml(p: BlogReadyInfo, excerpt: string, autoDraft = CONFIG.autoNaverDraft, styleResidual = 0, briefGate: BriefGateRecord | null = null): string {
  const meta = [p.keyword, typeof p.seoScore === 'number' ? `SEO ${p.seoScore}점` : '']
    .filter(Boolean).join(' · ');
  return [
    escapeHtml(`${blogReadyLabel(p.revised)}${brandTag(p.brand)}`),
    `<b>${escapeHtml(clip(p.title ?? '(제목 미정)', 200))}</b>`,
    meta ? escapeHtml(meta) : '',
    factGateLines(p.factGate, 3) ? escapeHtml(factGateLines(p.factGate, 3)) : '',
    // 브리프 게이트(2026-08-28) — 사실 게이트 '아래', 문체 '위'. 심각도 순서다: 본문 근거(사실) → 집필 재료의
    // 근거(브리프) → 말투(문체). 셋 다 발행을 막지 않는 표시 전용이고, 판단은 사람이 한다.
    briefGateLines(briefGate) ? escapeHtml(briefGateLines(briefGate)) : '',
    // 문체 린트 잔존(2026-08-27 권고 3) — 사실 게이트 줄 옆. 발행을 막지 않는 표시 전용이라 건수만 낸다.
    styleResidual > 0 ? escapeHtml(`✍ 문체 ${styleResidual}건 잔존`) : '',
    // 사실 게이트 줄 '아래' — 보류 사유를 먼저 읽고 버튼을 누르는 순서.
    autoDraft ? '' : escapeHtml(manualReviewLine()),
    excerpt ? `\n${escapeHtml(excerpt)}` : '',
    `\n검토: ${reviewLink(p.id)}`,
  ].filter(Boolean).join('\n');
}

/** 카드뉴스 ready 캡션(HTML, 앨범 첫 장에 부착). 순수 — 테스트 대상. */
export function cardnewsCaptionHtml(c: CardReadyInfo): string {
  const staff = [c.planner, c.designer].filter(Boolean).join('·');
  return [
    escapeHtml(`🖼 카드뉴스 검토 대기${brandTag(c.brand)}`),
    `<b>${escapeHtml(clip(c.topic, 200))}</b>`,
    escapeHtml([typeof c.slides === 'number' ? `${c.slides}장` : '', staff].filter(Boolean).join(' · ')),
    factGateLines(c.factGate, 2, '원문 정합', false) ? escapeHtml(factGateLines(c.factGate, 2, '원문 정합', false)) : '',
    `검토: ${reviewLink(c.sourcePieceId)}`,
  ].filter(Boolean).join('\n');
}

/** 쇼츠 ready 캡션(HTML, 영상에 부착). 순수 — 테스트 대상. */
export function shortsCaptionHtml(s: ShortsReadyInfo): string {
  const staff = [s.platform ? `${platformLabel(s.platform)}용` : '', s.writer, s.director].filter(Boolean).join('·');
  const specs = [
    typeof s.durationSec === 'number' ? `${s.durationSec}초` : '',
    typeof s.scenes === 'number' ? `씬 ${s.scenes}개` : '',
    staff,
  ].filter(Boolean).join(' · ');
  return [
    escapeHtml(`🎬 쇼츠 검토 대기${brandTag(s.brand)}`),
    `<b>${escapeHtml(clip(s.topic, 200))}</b>`,
    specs ? escapeHtml(specs) : '',
    factGateLines(s.factGate, 2, '원문 정합', false) ? escapeHtml(factGateLines(s.factGate, 2, '원문 정합', false)) : '',
    `검토: ${reviewLink(s.sourcePieceId)}`,
  ].filter(Boolean).join('\n');
}

/** 유튜브 업로드 완료 알림 입력 — 쇼츠 레코드에서 표시에 쓰는 필드만. */
export interface YoutubeUploadedInfo {
  id: string; topic: string; title?: string; brand?: string;
  durationSec?: number; scenes?: number; url: string;
  /** 공개 발행(2026-10-01) — 지금은 비공개지만 처리·썸네일 확인 뒤 자동 공개된다. 없으면 종전 '비공개 업로드'. */
  publicPending?: boolean;
  /** 처음부터 공개로 올림(2026-10-05, YOUTUBE_UPLOAD_PUBLIC_DIRECT) — 이미 공개, 서버는 커버만 확인한다. publicPending 보다 우선. */
  publicDirect?: boolean;
}

/**
 * 유튜브 비공개 업로드 완료 알림(사용자 요청 2026-08-31) — 발행 계열 중 이것만 알린다.
 * 릴스·인스타는 제외했다: 세트당 3건이면 금방 소음이 되고, 사용자가 확인하고 싶은 건 유튜브뿐이다.
 *
 * "비공개"를 문구에 못박는다 — 이 파이프라인은 유튜브에 비공개로만 올리고 전체공개 전환은 사람이 한다.
 * 알림이 '발행됐다'로 읽히면 이미 공개된 줄 알고 확인을 건너뛰게 된다.
 * 2026-10-01 공개 발행(publicPending)부터는 "자동 공개 예정"으로 쓴다 — 공개 전환·썸네일 확인은 서버가 하고,
 * 썸네일이 끝내 안 뜨면 따로 경고 알림이 간다.
 */
const youtubeUploadedHead = (s: YoutubeUploadedInfo): string =>
  s.publicDirect ? '📺 유튜브 공개 업로드 완료 — 이미 공개됨(커버 확인 중)'
    : s.publicPending ? '📺 유튜브 업로드 완료 — 자동 공개 예정(썸네일 확인)' : '📺 유튜브 비공개 업로드 완료';
export function youtubeUploadedHtml(s: YoutubeUploadedInfo): string {
  const specs = [
    typeof s.durationSec === 'number' ? `${s.durationSec}초` : '',
    typeof s.scenes === 'number' ? `씬 ${s.scenes}개` : '',
  ].filter(Boolean).join(' · ');
  return [
    escapeHtml(`${youtubeUploadedHead(s)}${brandTag(s.brand)}`),
    `<b>${escapeHtml(clip(s.title || s.topic, 200))}</b>`,
    specs ? escapeHtml(specs) : '',
    s.url,
  ].filter(Boolean).join('\n');
}

/**
 * 이 업로드가 텔레그램 알림을 낳는가(순수 판정 — 부르는 쪽이 중복을 피하는 근거).
 *
 * 왜 필요한가(2026-09-08). 텔레그램 버튼으로 업로드하면 완료 메시지가 두 통 왔다 —
 * 라우트가 notifyYoutubeUploaded 를 보내고, 버튼 핸들러가 자기 문구를 또 보냈다.
 * telegramBot 에는 '액션이 직접 보냈으면 빈 문자열을 반환한다'는 규칙이 이미 있는데
 * 유튜브만 안 지켰다. 그 규칙을 지키려면 '알림이 나갔나'를 알아야 한다.
 */
export function youtubeUploadNotifies(): boolean {
  return contentReadyNotifyEnabled() && !!telegramCreds();
}

/** 전송 — 알림 채널이 꺼져 있으면 조용히 통과. 실패는 무해(업로드 자체는 이미 성공했다). */
export async function notifyYoutubeUploaded(s: YoutubeUploadedInfo): Promise<void> {
  try {
    if (!contentReadyNotifyEnabled()) return;
    const html = youtubeUploadedHtml(s);
    // 유튜브에 올린 편은 다음 순서가 클립이다(2026-10-02) — 알림에서 바로 누르게 버튼을 단다.
    if (telegramCreds()) await sendTelegramHtml(html, [[{ text: '🟩 네이버 클립에도 올리기', callback_data: `nc:${s.id}` }]]);
    await notifyWebhookOnly({ title: `${youtubeUploadedHead(s)}${brandTag(s.brand)} · ${s.title || s.topic}`, body: s.url });
  } catch { /* 무해 */ }
}

/** 네이버 클립 업로드 결과 알림 입력(2026-10-02). 업로드는 수 분 걸려 버튼이 기다리지 않고, 끝나면 서버가 알린다. */
export interface NaverClipDoneInfo {
  id: string; title: string; brand?: string;
  /** PUBLISHED | RECOVERED | SUBMITTED | NOT_FOUND | 실패 상태들 */
  status: string; url?: string; error?: string; issues?: string[];
}
/** 알림 본문(순수). 'SUBMITTED'(등록 뒤 미확인)는 확인 버튼과 함께 — 두 번 공개되지 않게 재업로드 대신 확인을 유도한다. */
export function naverClipDoneHtml(s: NaverClipDoneInfo): { html: string; buttons?: TgButton[][] } {
  const title = `<b>${escapeHtml(clip(s.title, 200))}</b>`;
  const tail = [
    s.url ? escapeHtml(s.url) : '',
    s.issues?.length ? escapeHtml(`참고: ${s.issues.join(' / ')}`) : '',
  ].filter(Boolean);
  if (s.status === 'PUBLISHED' || s.status === 'RECOVERED') {
    const head = s.status === 'RECOVERED' ? '🟩 네이버 클립 — 이미 공개돼 있어 기록만 했습니다' : '🟩 네이버 클립 발행 완료(전체공개)';
    return { html: [escapeHtml(`${head}${brandTag(s.brand)}`), title, ...tail].join('\n') };
  }
  if (s.status === 'SUBMITTED') {
    return {
      html: [escapeHtml(`⚠️ 네이버 클립 — '등록'은 눌렀는데 공개 확인을 못 했습니다${brandTag(s.brand)}`), title,
        escapeHtml('다시 올리면 두 번 공개될 수 있어 막아 뒀습니다. 잠시 뒤 아래 버튼으로 확인하세요.'), ...tail].join('\n'),
      buttons: [[{ text: '🔎 클립 확인', callback_data: `nk:${s.id}` }]],
    };
  }
  if (s.status === 'NOT_FOUND') {
    return {
      html: [escapeHtml(`🟩 네이버 클립 — 공개된 클립이 없습니다. 다시 올릴 수 있습니다${brandTag(s.brand)}`), title].join('\n'),
      buttons: [[{ text: '🟩 네이버 클립', callback_data: `nc:${s.id}` }]],
    };
  }
  return { html: [escapeHtml(`⚠️ 네이버 클립 업로드 실패${brandTag(s.brand)}`), title, escapeHtml(s.error ?? s.status), ...tail].join('\n') };
}
/** 전송 — 알림 채널이 꺼져 있으면 조용히 통과. 실패는 무해. */
export async function notifyNaverClipDone(s: NaverClipDoneInfo): Promise<void> {
  try {
    // 버튼에 대한 답이라 '새 콘텐츠 알림' 설정과 무관하게 보낸다 — 끄면 "끝나면 알려드릴게요" 뒤에 침묵한다.
    if (!telegramCreds()) return;
    const m = naverClipDoneHtml(s);
    await sendTelegramHtml(m.html, m.buttons);
  } catch { /* 무해 */ }
}

/** 클립 올리기 권유 입력(2026-10-05) — 블로그 발행이 감지된 글의 유튜브용 완성 편. */
export interface NaverClipNudgeInfo { id: string; title: string; brand?: string; blogTitle?: string; /** 넣을 재생목록(없으면 문구에서 뺀다). */ playlist?: string }
/**
 * 클립 올리기 권유(순수) — 같은 날 올리게 버튼을 준다. 버튼은 스튜디오 버튼과 같은 `nc:`(같은 라우트·같은 중복 공개 방지,
 * 프로필이 바쁘면 대기열). 공개는 여전히 사람이 누른다 — 이 알림은 누를 기회만 준다.
 */
export function naverClipNudgeHtml(s: NaverClipNudgeInfo): { html: string; buttons: TgButton[][] } {
  return {
    html: [
      escapeHtml(`🟩 블로그가 발행됐습니다 — 이 숏폼을 네이버 클립에도 올릴까요?${brandTag(s.brand)}`),
      `<b>${escapeHtml(clip(s.title, 200))}</b>`,
      s.blogTitle ? escapeHtml(`원본 글: ${clip(s.blogTitle, 80)}`) : '',
      escapeHtml(`누르면 블로그 링크·카테고리${s.playlist ? `·재생목록(${s.playlist})` : ''}까지 채워 바로 공개합니다(전체공개).`),
    ].filter(Boolean).join('\n'),
    buttons: [[{ text: '🟩 네이버 클립에 올리기', callback_data: `nc:${s.id}` }]],
  };
}
/** 전송 — '새 콘텐츠 알림' 설정(NOTIFY_CONTENT_READY)과 텔레그램이 다 켜졌을 때만. 보냈으면 true. 실패는 무해. */
export async function notifyNaverClipNudge(s: NaverClipNudgeInfo): Promise<boolean> {
  try {
    if (!youtubeUploadNotifies()) return false; // 버튼이 본체라 웹훅만 있는 채널엔 보내지 않는다
    const m = naverClipNudgeHtml(s);
    return await sendTelegramHtml(m.html, m.buttons);
  } catch { return false; }
}

// 발행 버튼(인라인 키보드) — callback_data 규격은 telegramBot.parseCallback 과 한 쌍("<op>:<id>", ≤64바이트).
const blogButtons = (id: string): TgButton[][] => [[
  { text: `📗 ${naverPublishLabel()}`, callback_data: `bp:${id}` },
  { text: '✍ 수정요청', callback_data: `rv:${id}` },
]];
const cardnewsButtons = (id: string): TgButton[][] => [[
  { text: '📸 인스타 발행', callback_data: `cp:${id}` },
  { text: '✍ 수정요청', callback_data: `rv:${id}` },
]];
/**
 * 숏폼 검토 버튼 — 채널 전용 레코드는 그 채널 버튼만 띄운다(2026-09-03 채널 분리).
 * 레거시(platform 미지정)는 종전대로 둘 다. 잘못 눌러도 서버가 409 로 막지만, 애초에 안 보이는 게 낫다.
 */
const shortsButtons = (id: string, platform?: ShortsPlatform): TgButton[][] => [[
  ...(!platform || platform === 'youtube' ? [{ text: '▶️ 유튜브 업로드', callback_data: `sy:${id}` }] : []),
  ...(!platform || platform === 'instagram' ? [{ text: '🎬 릴스 발행', callback_data: `sm:${id}` }] : []),
  ...(!platform || platform === 'youtube' ? [{ text: '🟩 네이버 클립', callback_data: `nc:${id}` }] : []),
  { text: '✍ 수정요청', callback_data: `rv:${id}` },
]];

/** 블로그 초안 ready → 발췌 미리보기 알림. fire-and-forget(void 호출) 전제, 절대 throw 하지 않는다. */
export async function notifyBlogReady(p: BlogReadyInfo, runId: string): Promise<void> {
  try {
    if (!contentReadyNotifyEnabled()) return;
    const excerpt = readDraftExcerpt(runId);
    // 문체 린트 잔존 건수 — 세션 기록(style_lint.json)에서 읽는다. 없으면 0(구 런·린트 off·기록 실패).
    // Fix round 1 — `?.issues?.length` 로 한 단계 더 방어한다(readStyleLint 의 Array 검증과 이중). 여기서 던지면
    // 바깥 try 가 삼켜 텔레그램은 물론 notifyWebhookOnly 알림까지 함께 유실된다.
    const styleResidual = (runId ? readStyleLint(runId)?.issues?.length : 0) ?? 0;
    // 브리프 게이트 기록(2026-08-28) — style_lint 와 같은 경로. readBriefGate 가 손상 기록을 null 로
    // 떨어뜨리므로 여기서 던지지 않는다(던지면 바깥 try 가 삼켜 알림이 통째로 사라진다).
    const briefGate = runId ? readBriefGate(runId) : null;
    if (telegramCreds()) await sendTelegramHtml(blogReadyHtml(p, excerpt, undefined, styleResidual, briefGate), blogButtons(p.id));
    await notifyWebhookOnly({
      title: `${blogReadyLabel(p.revised)}${brandTag(p.brand)} · ${p.title ?? '(제목 미정)'}`,
      // 웹훅에도 반려를 싣는다 — 텔레그램만 보는 게 아니다(둘 중 하나만 보는 사람이 게이트를 못 보면 안 된다).
      body: [briefGateLines(briefGate), excerpt, `검토: ${reviewLink(p.id)}`].filter(Boolean).join('\n'),
    });
  } catch { /* 무해 */ }
}

/** 카드뉴스 ready → 슬라이드 앨범 알림(슬라이드 없거나 전송 실패 시 텍스트 폴백). */
export async function notifyCardnewsReady(c: CardReadyInfo, dir: string): Promise<void> {
  try {
    if (!contentReadyNotifyEnabled()) return;
    const caption = cardnewsCaptionHtml(c);
    if (telegramCreds()) {
      let slides: string[] = [];
      try {
        slides = fs.readdirSync(dir)
          .filter((f) => /^slide_\d+\.png$/.test(f)).sort()
          .map((f) => path.join(dir, f));
      } catch { /* 디렉토리 없음 — 텍스트 폴백 */ }
      const sent = await sendTelegramPhotos(slides, caption);
      // 앨범(sendMediaGroup)은 인라인 키보드를 지원하지 않아 버튼은 후속 메시지로 붙인다.
      if (sent) await sendTelegramHtml(`🖼 ${escapeHtml(clip(c.topic, 40))} — 발행:`, cardnewsButtons(c.id));
      else await sendTelegramHtml(caption, cardnewsButtons(c.id));
    }
    await notifyWebhookOnly({
      title: `🖼 카드뉴스 검토 대기${brandTag(c.brand)} · ${c.topic}`,
      body: `검토: ${reviewLink(c.sourcePieceId)}`,
    });
  } catch { /* 무해 */ }
}

const execFileP = promisify(execFile);

/** 텔레그램용 소형 커버(최장변 320px JPEG) — 디자인 썸네일 축소, 없으면 영상 첫 프레임. 실패 시 null(커버 없이 전송). */
async function tgVideoThumb(videoPath: string): Promise<string | null> {
  try {
    const dir = path.dirname(videoPath);
    const out = path.join(dir, 'tg-thumb.jpg');
    if (fs.existsSync(out)) return out;
    const design = path.join(dir, 'thumbnail.jpg');
    const src = fs.existsSync(design) ? design : videoPath;
    await execFileP('ffmpeg', ['-nostdin', '-y', '-i', src, '-frames:v', '1', '-vf', 'scale=-2:320', '-q:v', '5', out],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return fs.existsSync(out) ? out : null;
  } catch { return null; }
}

/** 쇼츠 ready → 완성 영상 알림(50MB 초과·전송 실패 시 텍스트 폴백). */
export async function notifyShortsReady(s: ShortsReadyInfo, videoPath: string): Promise<void> {
  try {
    if (!contentReadyNotifyEnabled()) return;
    const caption = shortsCaptionHtml(s);
    if (telegramCreds()) {
      // 1080×1920 고정 — Remotion 컴포지션·ffmpeg 폴백 모두 이 규격으로 렌더(shortsRender). 커버는 320px 축소본.
      const thumb = await tgVideoThumb(videoPath);
      const sent = await sendTelegramVideo(videoPath, caption, shortsButtons(s.id, s.platform),
        { width: 1080, height: 1920, thumbnailPath: thumb ?? undefined });
      if (!sent) await sendTelegramHtml(`${caption}\n(영상은 스튜디오에서 확인 — 전송 한도 초과/실패)`, shortsButtons(s.id, s.platform));
    }
    await notifyWebhookOnly({
      title: `🎬 쇼츠 검토 대기${brandTag(s.brand)} · ${s.topic}`,
      body: `검토: ${reviewLink(s.sourcePieceId)}`,
    });
  } catch { /* 무해 */ }
}

// ── 롱폼(2026-10-22) ──
// 영상은 1GB 라 텔레그램(50MB)으로 못 보낸다 — 썸네일 사진에 발행 버튼을 달고, 미리보기는 영상 주소(/api/longform/:id/video, 구간 요청 지원)를 바로 연다.
// 2026-10-25 사장님 제보: 제작실 주소(/)는 홈만 열려 롱폼 탭을 다시 찾아야 했다.

/** 길이 m:ss(순수). 없으면 빈 문자열. */
export function fmtMinSec(sec?: number): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
/** 유튜브 설명의 챕터 줄(0:00 …)만 앞에서 max 개(순수). */
export function chapterLines(desc: string | undefined, max = 8): string[] {
  return (desc ?? '').split('\n').map((l) => l.trim()).filter((l) => /^\d{1,2}:\d{2}(:\d{2})?\s/.test(l)).slice(0, max);
}
/** 롱폼 검토 대기 캡션(HTML, 썸네일 사진에 부착 — 1024자 안). 순수 — 테스트 대상. */
export function longformCaptionHtml(r: Pick<LongformRecord, 'id' | 'title' | 'ytTitle' | 'brand' | 'durationSec' | 'topicReason' | 'ytDescription'>): string {
  const len = fmtMinSec(r.durationSec);
  const chapters = chapterLines(r.ytDescription);
  return [
    escapeHtml(`🎞 롱폼 검토 대기${brandTag(r.brand)}`),
    `<b>${escapeHtml(clip(r.ytTitle || r.title, 120))}</b>`,
    len ? escapeHtml(`길이 ${len}`) : '',
    r.topicReason ? escapeHtml(`고른 이유: ${clip(r.topicReason, 160)}`) : '',
    chapters.length ? escapeHtml(['챕터', ...chapters.map((l) => clip(l, 48))].join('\n')) : '',
    escapeHtml(`▶ 미리보기(바로 재생): ${studioBase()}/api/longform/${encodeURIComponent(r.id)}/video`),
  ].filter(Boolean).join('\n');
}
/** 롱폼 발행 버튼 — callback_data 규격은 telegramBot.parseCallback 과 한 쌍(ly·lt·lf). */
export const longformButtons = (id: string): TgButton[][] => [[
  { text: '▶️ 유튜브 공개 발행', callback_data: `ly:${id}` },
  { text: '🖼 썸네일 다시', callback_data: `lt:${id}` },
]];

/**
 * 롱폼 ready → 썸네일 사진 + 캡션 + 버튼(썸네일 없으면 글자만). 보냈으면 notifiedTs 를 남기고 true.
 * reply=true 는 버튼에 대한 답(썸네일 다시 만든 뒤 재전송)이라 '새 콘텐츠 알림' 설정과 무관하게 보낸다.
 * 절대 throw 하지 않는다(알림이 제작·발행을 막지 않는다).
 */
export async function notifyLongformReady(rec: LongformRecord, opts: { reply?: boolean } = {}): Promise<boolean> {
  try {
    if (!opts.reply && !contentReadyNotifyEnabled()) return false;
    if (!telegramCreds()) return false;
    const caption = longformCaptionHtml(rec);
    const dir = longformStore().absDir(rec);
    const thumb = dir ? path.join(dir, 'thumbnail.jpg') : '';
    let sent = false;
    if (thumb && fs.existsSync(thumb)) {
      // 썸네일(1280x720 jpg ≤2MB)은 텔레그램 사진 한도(10MB) 안이다 — 실패하면 글자로 폴백.
      sent = await sendTelegramPhoto(thumb, caption, longformButtons(rec.id));
    }
    if (!sent) sent = await sendTelegramHtml(`${caption}\n${escapeHtml('(썸네일 없음 — 🖼 썸네일 다시로 만들 수 있습니다)')}`, longformButtons(rec.id));
    if (sent) longformStore().update(rec.id, { notifiedTs: new Date().toISOString() });
    // 문장 그림 대조표(2026-10-22) — 장면마다 55% 스틸 바둑판. 버튼 없는 둘째 사진(검토용), 실패해도 무해.
    const contact = dir ? path.join(dir, 'scenes', 'contact.jpg') : '';
    if (sent && !opts.reply && contact && fs.existsSync(contact)) {
      let n = '';
      try { n = ` ${(JSON.parse(fs.readFileSync(path.join(dir!, 'scenes', 'report.json'), 'utf8')) as { built?: number }).built ?? ''}개`; } catch { /* 숫자 없이 */ }
      await sendTelegramPhoto(contact, escapeHtml(`🎨 문장 그림${n} 대조표 — ${rec.ytTitle || rec.title}`)).catch(() => false);
    }
    if (!opts.reply) await notifyWebhookOnly({ title: `🎞 롱폼 검토 대기${brandTag(rec.brand)} · ${rec.ytTitle || rec.title}`, body: `${studioBase()}/` });
    return sent;
  } catch { return false; }
}

/** 롱폼 업로드 결과 알림 본문(순수) — 성공은 주소, 실패는 사유와 다시 누를 버튼. */
export function longformYoutubeDoneHtml(r: { id: string; title: string; brand?: string; url?: string; error?: string; thumbnailError?: string }): { html: string; buttons?: TgButton[][] } {
  if (r.url) {
    return {
      html: [
        escapeHtml(`📺 롱폼 유튜브 공개${brandTag(r.brand)}`),
        `<b>${escapeHtml(clip(r.title, 120))}</b>`,
        escapeHtml(r.url),
        r.thumbnailError ? escapeHtml(`⚠ ${clip(r.thumbnailError, 160)}`) : '',
      ].filter(Boolean).join('\n'),
    };
  }
  return {
    html: [
      escapeHtml(`⚠️ 롱폼 유튜브 업로드 실패${brandTag(r.brand)}`),
      `<b>${escapeHtml(clip(r.title, 120))}</b>`,
      escapeHtml(clip(r.error ?? '사유 불명', 300)),
    ].join('\n'),
    buttons: [[{ text: '▶️ 다시 올리기', callback_data: `ly:${r.id}` }]],
  };
}
/** 전송 — 버튼에 대한 답이라 '새 콘텐츠 알림' 설정과 무관하게 텔레그램이 있으면 보낸다("끝나면 알려 드립니다" 뒤 침묵 금지). */
export async function notifyLongformYoutubeDone(r: Parameters<typeof longformYoutubeDoneHtml>[0]): Promise<void> {
  try {
    const m = longformYoutubeDoneHtml(r);
    if (telegramCreds()) await sendTelegramHtml(m.html, m.buttons);
    await notifyWebhookOnly({ title: r.url ? `📺 롱폼 유튜브 공개 · ${r.title}` : `⚠️ 롱폼 유튜브 업로드 실패 · ${r.title}`, body: r.url ?? r.error ?? '' });
  } catch { /* 무해 */ }
}
