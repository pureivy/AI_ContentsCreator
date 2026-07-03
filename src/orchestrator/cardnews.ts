/**
 * 카드뉴스 파이프라인 — 카드뉴스팀(standby)이 전담하는 전용 경로. 블로그 org 런과 무관.
 *
 * 기획(cardnews_planner LLM) → 디자인(cardnews_designer LLM) → 배경 생성(gpt-image-2,
 * openai_image.py 재사용 — 1024 정사각·no text 자동 부가) → 텍스트 렌더(cardnews_render.py,
 * Pillow 한글 오버레이). 텍스트를 코드로 얹는 이유: AI 이미지의 한글 오타 문제 회피(참고
 * 프로젝트 card-news-maker 의 핵심 설계 유지).
 *
 * 실행 모델: 서버 백그라운드 잡(네이버 임시저장 잡과 동일 패턴) — 프론트는 GET 폴링.
 * 직원 프롬프트는 회사 로스터(company.yaml)의 system_prompt 를 그대로 사용 — 직원 편집
 * UI 에서 프롬프트를 고치면 다음 생성부터 반영된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { microJSON } from './agent';
import { getCompany } from '../agents/company-loader';
import { rolesById } from '../agents/company';
import { stripEmoji } from '../output/render';
import { cardNewsStore } from '../content/cardnews';
import { generateImagesForDraft, renderCardSlides } from '../tools/blog_skills';

const RUNNING = new Set<string>();
export function isCardNewsRunning(id: string): boolean { return RUNNING.has(id); }

const PRESETS = new Set(['photorealistic', 'manhwa', 'watercolor', 'ink_wash', 'flat_design', 'retro_poster']);
// 디자이너가 한국어 스타일명으로 답해도 수용 — 프리셋 키로 정규화.
const PRESET_ALIAS: Record<string, string> = {
  '사진풍': 'photorealistic', '수채화풍': 'watercolor', '플랫 일러스트': 'flat_design', '만화풍': 'manhwa',
};

const stdModel = (): string => (CONFIG.backend === 'local' ? CONFIG.tierModels.standard : CONFIG.cloudTierModels.standard);

interface PlanSlide { headline: string; body: string }
interface Plan { title: string; slides: PlanSlide[]; caption: string; hashtags: string[] }

function rolePrompt(id: string, fallback: string): string {
  try {
    const r = rolesById(getCompany()).get(id);
    return r?.systemPrompt || fallback;
  } catch { return fallback; }
}

/** 카드 텍스트 위생 — 이모지 제거(렌더 안정성)·길이 캡. */
const cleanLine = (s: unknown, cap: number): string => stripEmoji(String(s ?? '')).trim().slice(0, cap);

function normalizeHashtags(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [];
  return arr
    .map((t) => String(t ?? '').trim().replace(/\s+/g, '')) // 붙여쓰기(네이버·인스타 관례)
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .slice(0, 15);
}

async function planCards(topic: string, keyword: string | undefined, sourceBody: string | undefined, n: number, signal?: AbortSignal): Promise<Plan | null> {
  const system = rolePrompt('cardnews_planner', '당신은 인스타그램 카드뉴스 기획자입니다. 요청된 JSON 스키마만 출력합니다.');
  const user = [
    `[주제] ${topic}`,
    keyword ? `[핵심 키워드] ${keyword}` : '',
    sourceBody ? `[블로그 초안 본문 — 핵심만 추려 재구성하라(문장 복붙 금지, 사실·수치는 원문에 있는 것만)]\n${sourceBody.slice(0, 4000)}` : '',
    '',
    `슬라이드 ${n}장(표지 1 + 본문 ${Math.max(1, n - 2)} + 마무리 1)의 카드뉴스를 기획하라.`,
    '표지와 마무리 장의 body 는 비우거나 한 줄로 짧게. 카드 텍스트에 이모지 금지(캡션에는 허용).',
    'JSON 형식: {"title":"...","slides":[{"headline":"...","body":"줄바꿈은 \\n"}],"caption":"...","hashtags":["#태그1","#태그2"]}',
  ].filter(Boolean).join('\n');
  const j = await microJSON<{ title?: unknown; slides?: Array<{ headline?: unknown; body?: unknown }>; caption?: unknown; hashtags?: unknown }>(
    stdModel(), system, user, { maxOutputTokens: 2000, signal },
  );
  if (!j || !Array.isArray(j.slides) || !j.slides.length) return null;
  const slides = j.slides.slice(0, 8).map((s) => ({
    headline: cleanLine(s?.headline, 40),
    body: cleanLine(s?.body, 220),
  })).filter((s) => s.headline);
  if (slides.length < 2) return null;
  return {
    title: cleanLine(j.title, 60) || topic,
    slides,
    caption: String(j.caption ?? '').trim().slice(0, 1000),
    hashtags: normalizeHashtags(j.hashtags),
  };
}

async function designBackgrounds(topic: string, plan: Plan, signal?: AbortSignal): Promise<{ preset: string; style: string; prompts: string[] }> {
  const system = rolePrompt('cardnews_designer', '당신은 카드뉴스 배경 프롬프트 디자이너입니다. 요청된 JSON 스키마만 출력합니다.');
  const user = [
    `[주제] ${topic}`,
    '[슬라이드]',
    ...plan.slides.map((s, i) => `${i + 1}. ${s.headline}${s.body ? ` — ${s.body.replace(/\n/g, ' ').slice(0, 60)}` : ''}`),
    '',
    `각 슬라이드의 배경 이미지 프롬프트를 설계하라. slides 는 정확히 ${plan.slides.length}개.`,
    'JSON 형식: {"style_preset":"photorealistic|watercolor|flat_design|manhwa","style":"모든 장 공통 스타일 문구(팔레트·질감·조명)","slides":[{"prompt":"장면 묘사(한국어 150자 이내)"}]}',
  ].join('\n');
  const j = await microJSON<{ style_preset?: unknown; style?: unknown; slides?: Array<{ prompt?: unknown }> }>(
    stdModel(), system, user, { maxOutputTokens: 1600, signal },
  );
  const rawPreset = String(j?.style_preset ?? '').trim();
  const preset = PRESETS.has(rawPreset) ? rawPreset : (PRESET_ALIAS[rawPreset] ?? 'photorealistic');
  const style = String(j?.style ?? '').trim().slice(0, 200) || '밝고 깔끔한 한국 생활 사진풍, 부드러운 자연광';
  const prompts = plan.slides.map((s, i) => {
    const p = String(j?.slides?.[i]?.prompt ?? '').trim().slice(0, 200);
    return p || `${topic} 를 상징하는 한국 생활 장면, ${s.headline} 분위기`; // 디자이너 응답 부족 시 폴백
  });
  return { preset, style, prompts };
}

/** 카드뉴스 생성 잡 — create 직후 void 로 호출(백그라운드), 프론트는 GET 폴링. */
export async function runCardNewsJob(id: string, opts: { sourceBody?: string; slideCount?: number } = {}): Promise<void> {
  const store = cardNewsStore();
  const card = store.get(id);
  if (!card || RUNNING.has(id)) return;
  RUNNING.add(id);
  const dir = store.dirFor(id);
  try {
    fs.mkdirSync(path.join(dir, 'bg'), { recursive: true });
    const n = Math.min(Math.max(3, opts.slideCount ?? 5), 8);

    // 1) 기획 — 슬라이드 구성·카피·캡션
    store.update(id, { stage: 'planning' });
    const plan = await planCards(card.topic, card.keyword, opts.sourceBody, n);
    if (!plan) throw new Error('기획 실패 — 기획자 JSON 응답을 해석할 수 없습니다');
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ title: plan.title, slides: plan.slides }, null, 2), 'utf-8');

    // 2) 디자인 — 배경 프롬프트(전 장 일관 스타일 + 장면 변주)
    store.update(id, { stage: 'designing', caption: plan.caption, hashtags: plan.hashtags });
    const design = await designBackgrounds(card.topic, plan);

    // 3) 배경 생성 — openai_image.py 재사용(기본 1024 정사각, no-text 자동 부가). 키 없으면
    //    스크립트가 dry-run → 렌더러가 그라데이션 폴백으로 전 장 완성(fail-open).
    store.update(id, { stage: 'rendering' });
    const bgDraft = {
      imageSlots: plan.slides.map((s, i) => ({
        alt: s.headline,
        prompt: `${design.style}. ${design.prompts[i]}. 이미지 중앙과 상단은 텍스트를 올릴 수 있는 단순한 여백으로 남긴다`,
      })),
    };
    const bgDraftPath = path.join(dir, 'bg-draft.json');
    const bgManifestPath = path.join(dir, 'bg-manifest.json');
    fs.writeFileSync(bgDraftPath, JSON.stringify(bgDraft, null, 2), 'utf-8');
    await generateImagesForDraft(bgDraftPath, path.join(dir, 'bg'), bgManifestPath, { imageStyle: design.preset, limit: plan.slides.length });

    // 4) 텍스트 렌더 — Pillow 오버레이(슬라이드 번호·반투명 박스·그림자)
    const renderManifestPath = path.join(dir, 'render-manifest.json');
    const r = await renderCardSlides(path.join(dir, 'plan.json'), bgManifestPath, dir, renderManifestPath);
    let ok = 0, count = plan.slides.length, fallbacks = 0;
    try {
      const m = JSON.parse(fs.readFileSync(renderManifestPath, 'utf-8')) as { ok?: number; count?: number; slides?: Array<{ bg_fallback?: boolean }> };
      ok = m.ok ?? 0; count = m.count ?? count;
      fallbacks = (m.slides ?? []).filter((s) => s.bg_fallback).length;
    } catch { /* 아래에서 실패 처리 */ }
    if (!ok) throw new Error(`렌더 실패 — ${r.output.slice(-300)}`);

    // 캡션 파일(다운로드 편의) — 캡션 + 해시태그.
    const captionText = [plan.caption, plan.hashtags.join(' ')].filter(Boolean).join('\n\n');
    if (captionText) fs.writeFileSync(path.join(dir, 'caption.txt'), captionText, 'utf-8');

    store.update(id, { stage: 'ready', slides: ok, bgFallbacks: fallbacks, topic: plan.title || card.topic });
    console.log(`[카드뉴스] ${plan.title.slice(0, 30)} — ${ok}/${count}장 완성${fallbacks ? ` (배경 폴백 ${fallbacks})` : ''}`);
  } catch (e) {
    store.update(id, { stage: 'error', error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    console.log(`[카드뉴스] ${card.topic.slice(0, 30)} — 실패: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    RUNNING.delete(id);
  }
}
