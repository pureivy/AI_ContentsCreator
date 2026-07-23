/**
 * 같은 주제 재작성 시 '관점 다양성' 주입(사용자 원칙 2026-07-21) — 기존 novelty 가드는 유사 주제를
 * "차단"하지만, 사용자가 같은 주제로 또 만들 때(force) 내용이 앵글까지 똑같아지는 문제가 있었다
 * (실측: 하스카프베리 글 2편 — 문자열 12% 겹침이나 소제목·구성·비교가 동일).
 *
 * 이 모듈은 같은 kind(블로그↔블로그 등)의 유사 주제 기존 콘텐츠가 '이미 다룬 구성'을 뽑아, 생성기
 * (작가·기획자) 프롬프트에 "핵심 사실은 담되 진입점·강조·구성은 완전히 다르게" 지시로 주입한다.
 * 사실을 피하라는 게 아니라 프레이밍을 다르게 — 정의적 사실을 빼면 글이 틀려지므로.
 *
 * 전량 fail-open: 스토어·파일·파싱 어디가 실패해도 빈 문자열을 반환해 파이프라인은 기존대로 진행한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { keywordSimilar, titleSimilar } from './novelty';
import { pieceStore } from './pieces';
import { cardNewsStore } from './cardnews';
import { shortsStore } from './shorts';

export type ContentKind = '블로그' | '카드뉴스' | '숏폼';

interface PriorOutline { title: string; outline: string }

/** 후보(새 콘텐츠 주제/키워드)와 기존 항목이 '같은 주제'인가 — 키워드 포함/유사 + 제목 유사(관대). */
function sameTopic(candTitle: string, candKey: string, e: { title: string; keyword?: string }): boolean {
  if (candKey && e.keyword && keywordSimilar(candKey, e.keyword)) return true; // '하스카프베리 재배' ↔ '하스카프베리'
  if (candKey && e.title && keywordSimilar(candKey, e.title)) return true;     // 키워드 ⊂ 제목
  if (titleSimilar(candTitle, e.title)) return true;
  return false;
}

/** 마크다운 본문에서 소제목(##/###) 추출 — 해시태그 줄(# 2개 이상)은 제외. */
export function markdownHeadings(body: string, cap = 6): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/^#{1,3}\s*(.+)$/gm)) {
    const h = (m[1] || '').trim();
    if (!h || (h.match(/#/g) || []).length >= 2) continue; // 태그 나열 줄 배제
    out.push(h.slice(0, 50));
    if (out.length >= cap) break;
  }
  return out;
}

/** 본문 마크다운의 '스타일 지문'(순수) — 도입 첫 문장·마무리 소제목·소제목 골격. 교차-글 다양성 지시의 원자료. */
export function styleSignatureOf(body: string): { opening: string; closing: string; headings: string } {
  const hs = markdownHeadings(body);
  const plain = (body || '')
    .replace(/^#{1,6}.*$/gm, ' ')          // 소제목 줄 제거
    .replace(/\[IMAGE:[^\]]*\]/g, ' ')     // 이미지 마커 제거
    .replace(/[#*>`|_~-]/g, ' ')           // 서식 문자 제거
    .replace(/\s+/g, ' ').trim();
  const opening = (plain.split(/(?<=[.!?。])\s/)[0] ?? plain).slice(0, 60);
  return { opening, closing: hs[hs.length - 1] ?? '', headings: hs.join(' · ') };
}
/** 블로그 초안 스타일 지문 — piece.runId → draft.json 의 bodyMarkdown(디스크). 실패 시 null. */
function blogStyleSig(runId: string | undefined): { opening: string; closing: string; headings: string } | null {
  if (!runId) return null;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, runId, 'draft.json'), 'utf-8')) as { bodyMarkdown?: string };
    const body = d.bodyMarkdown ?? '';
    if (!body.trim()) return null;
    const s = styleSignatureOf(body);
    return (s.opening || s.headings) ? s : null;
  } catch { return null; }
}
/** 블로그 초안 소제목 — piece.runId → data/sessions/<runId>/draft.json 의 bodyMarkdown. */
function blogOutline(runId: string | undefined): string {
  if (!runId) return '';
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, runId, 'draft.json'), 'utf-8')) as { bodyMarkdown?: string };
    return markdownHeadings(d.bodyMarkdown ?? '').join(' · ');
  } catch { return ''; }
}

/** 카드뉴스/숏폼 plan.json 에서 구성 요약 — 슬라이드 헤드라인 / 씬 화면텍스트. */
function planOutline(dir: string, kind: 'card' | 'short'): string {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8')) as {
      slides?: Array<{ headline?: string }>; scenes?: Array<{ screenText?: string; narration?: string }>;
    };
    if (kind === 'card') {
      return (p.slides ?? []).map((s) => (s.headline || '').trim()).filter(Boolean).slice(0, 6).join(' · ');
    }
    return (p.scenes ?? []).map((s) => (s.screenText || s.narration || '').trim().slice(0, 24)).filter(Boolean).slice(0, 6).join(' · ');
  } catch { return ''; }
}

/** 같은 kind·같은 브랜드·유사 주제의 기존 콘텐츠 구성(최신순, 파생·자기 자신 제외). */
function collectPriorOutlines(
  kind: ContentKind, topic: string, keyword: string | undefined,
  opts: { excludeId?: string; excludeSourcePieceId?: string; brandSlug?: string },
): PriorOutline[] {
  const candKey = (keyword || topic || '').trim();
  const candTitle = (topic || '').trim();
  const brand = opts.brandSlug;
  // 브랜드 격리(사용자 원칙) — brandSlug 지정 시 같은 브랜드만 대조. undefined 는 필터 안 함.
  const brandOk = (b?: string): boolean => brand === undefined || (b ?? undefined) === brand;
  const out: PriorOutline[] = [];
  if (kind === '블로그') {
    // 최신부터 — 최근 것이 가장 관련 높음. 블로그 piece 는 원본(파생 아님).
    for (const e of [...pieceStore().list()].reverse()) {
      if (e.id === opts.excludeId || !brandOk(e.brand)) continue;
      if (!sameTopic(candTitle, candKey, e)) continue;
      out.push({ title: e.title, outline: blogOutline(e.runId) });
      if (out.length >= 2) break;
    }
  } else if (kind === '카드뉴스') {
    for (const e of cardNewsStore().list()) { // 이미 최신순
      if (e.id === opts.excludeId || !brandOk(e.brand)) continue;
      if (opts.excludeSourcePieceId && e.sourcePieceId === opts.excludeSourcePieceId) continue; // 같은 글 파생 형제 제외
      if (!sameTopic(candTitle, candKey, { title: e.topic, keyword: e.keyword })) continue;
      out.push({ title: e.topic, outline: planOutline(cardNewsStore().dirFor(e.id), 'card') });
      if (out.length >= 2) break;
    }
  } else {
    for (const e of shortsStore().list()) {
      if (e.id === opts.excludeId || !brandOk(e.brand)) continue;
      if (opts.excludeSourcePieceId && e.sourcePieceId === opts.excludeSourcePieceId) continue;
      if (!sameTopic(candTitle, candKey, { title: e.topic, keyword: e.keyword })) continue;
      out.push({ title: e.topic, outline: planOutline(shortsStore().dirFor(e.id), 'short') });
      if (out.length >= 2) break;
    }
  }
  return out;
}

/**
 * 생성기 프롬프트에 붙일 '관점 다양성' 지시 블록 — 유사 주제 기존 콘텐츠가 없으면 빈 문자열(무주입).
 * 사실은 담되 프레이밍(진입점·독자 상황·강조·예시·구성·순서·깊이)을 완전히 다르게 하라는 지시.
 */
export function priorCoverageBrief(
  kind: ContentKind, topic: string, keyword: string | undefined,
  opts: { excludeId?: string; excludeSourcePieceId?: string; brandSlug?: string } = {},
): string {
  try {
    const priors = collectPriorOutlines(kind, topic, keyword, opts);
    if (!priors.length) return '';
    const lines = priors.map((o, i) => `${i + 1}. "${o.title}"${o.outline ? ` (다룬 것: ${o.outline})` : ''}`);
    return [
      `[이미 만든 유사 주제 ${kind} — 반드시 다른 각도로 써라]`,
      '이 주제로 이미 아래를 만들었다:',
      ...lines,
      // 앵커링 방지 — 위 구성을 "피할 목록"으로 보여주되, 흉내 금지를 강하게 못박고 divergence '방향'을 처방한다.
      '경고: 위 구성은 참고가 아니라 "이미 써먹어서 반복하면 안 되는 것"이다. 위의 소제목·전개 순서·도입·비교 대상을 그대로 따라가면 실패다.',
      '대신 진입 프레임 자체를 바꿔라 — 아래 중 위 글과 겹치지 않는 하나를 골라 그 각도로 처음부터 새로 구성하라:',
      '· 다른 독자 상황(예: 이미 심었는데 열매가 안 달리는 사람 / 공간·화분 제약 / 특정 계절·시기)',
      '· 다른 글 유형(통념 반박 / 실패·시행착오 복기 / 단계별 체크리스트 / 자주 묻는 질문 / 한 가지 쟁점 심화)',
      '주제의 정의적 핵심 사실은 한두 줄로만 짚고, 나머지 분량은 위 글이 다루지 않은 새 정보·상황·예시로 채워라.',
    ].join('\n');
  } catch { return ''; }
}

/**
 * 최근 발행한 같은 유형(블로그) 글의 '스타일 지문'(도입 첫 문장·마무리 소제목·소제목 골격)을 모아,
 * 작가에게 "이 도입·마무리·구성을 반복하지 말고 다르게 쓰라"는 교차-글 다양성 지시 블록으로 만든다.
 * novelty(주제 중복)·priorCoverage(같은 주제 각도)를 넘어, **다른 주제인데도 매번 같은 틀로 수렴**하는 것을
 * 막는다(2026-07-23 감사: 도입 공식·"N단계 체크"·"오늘 바로 할 일" 마무리·"A가 아니라 B" 훅 과반복). 전량 fail-open.
 */
export function recentStyleToAvoid(
  brandSlug: string | undefined, opts: { excludeRunId?: string; limit?: number } = {},
): string {
  try {
    const brandOk = (b?: string): boolean => brandSlug === undefined || (b ?? undefined) === brandSlug;
    const sigs: Array<{ opening: string; closing: string; headings: string }> = [];
    for (const e of [...pieceStore().list()].reverse()) {   // 최신부터
      if (e.runId === opts.excludeRunId || !brandOk(e.brand)) continue;
      const s = blogStyleSig(e.runId);
      if (s) sigs.push(s);
      if (sigs.length >= (opts.limit ?? 4)) break;
    }
    if (!sigs.length) return '';
    const lines = sigs.map((s, i) => `${i + 1}. 도입: "${s.opening}…" / 마무리 소제목: "${s.closing}" / 구성: ${s.headings}`);
    return [
      '[최근 발행한 같은 유형 글의 도입·마무리·구성 — 아래와 겹치지 말 것]',
      ...lines,
      '위 글들과 다른 진입 방식·다른 마무리·다른 소제목 구성으로 써라. 특히 아래 과반복 틀을 이번 글에서 반복하지 마라: '
        + '①도입 공식(계절/날씨 장면→독자의 흔한 실수→"결론부터/그런데" 반전) ②"N단계 체크법" 소제목 ③"오늘 바로 할 일/정리/요약" 식 마무리 '
        + '④"A가 아니라 B"·"X보다 Y가 먼저" 대비 훅. 같은 소재라도 진입 프레임·구성·마무리 방식을 반드시 바꿔라.',
    ].join('\n');
  } catch { return ''; }
}
