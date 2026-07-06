/**
 * 네이버 블로그 포매터 — org 본문을 발행용 초안(제목·메타·태그·이미지 슬롯·SEO 점수)으로 포장.
 * 본문은 생성하지 않는다(작가가 이미 씀). 구조작업(제목/메타/태그/이미지 프롬프트)만 microJSON 1콜.
 */
import { microJSON } from '../orchestrator/agent';
import { firstJson } from '../tools/classify';
import { asString } from '../util/str';
import { seedKeyword } from '../grounding/naver_common';
import { scoreSeo } from './seo';
import { renderMarkdown, renderHtml, stripEmoji } from './render';
import { registerFormatter } from './formatter';
import { brandContext } from '../content/brand';
import type { AssetBundle, BlogDraft, FormatterInput } from './formatter';

const PACK_SYSTEM =
  '너는 네이버 블로그 SEO 편집자다. 주어진 블로그 본문을 바탕으로 발행용 메타데이터를 만든다.\n' +
  '- primaryKeyword: 이 글의 핵심 타겟 키워드 1개(검색량 있을 법한 명사구).\n' +
  '- titles: 검색 노출에 유리한 제목 후보 5개. 핵심 키워드를 앞쪽에 자연스럽게, 15~40자, 클릭 유도. 과장·낚시 금지.\n' +
  '  [네이버 상위 노출 제목]이 주어지면 실제 상위 글들의 제목 패턴(구체 수치·대상·상황 명시)을 참고하되 그대로 베끼지 마라.\n' +
  '- meta: 100~200자 요약(검색 스니펫용). 핵심 키워드 포함, 글의 이득을 한 문장으로.\n' +
  '- tags: 5~10개(핵심·연관 키워드, # 없이). 띄어쓰기 없이 붙여쓴다("카페창업" O, "카페 창업" X). 본문과 무관한 태그 금지.\n' +
  '- images: 본문 흐름에 맞는 이미지 3개 슬롯. alt(대체텍스트)와 prompt(이미지 생성 프롬프트, 한국어).\n' +
  '이모지·이모티콘·장식 특수문자는 제목·메타·태그 어디에도 쓰지 마라. 본문에 없는 사실을 지어내지 마라.';

export async function packageNaverBlog(input: FormatterInput): Promise<AssetBundle> {
  const { topic, researchBrief, serpText, model, signal } = input;
  const pinnedKeyword = stripEmoji(asString(input.keyword).trim());
  // 이모지 결정적 제거 — 지침(작가·편집자 프롬프트)이 1차 방어, 여기가 최종 보증(발행 초안엔 이모지 0).
  // + 작가가 본문 끝에 남기는 "태그: #..." 줄 제거(태그는 별도 필드 — 렌더 태그 칩과 중복 방지).
  const body = stripEmoji(input.body)
    .replace(/\n+\s*(?:\*\*)?태그(?:\*\*)?\s*[:：][^\n]*$/u, '')
    .trimEnd();
  let meta: {
    primaryKeyword?: string; titles?: unknown; meta?: string; tags?: unknown;
    images?: Array<{ alt?: string; prompt?: string }>;
  } | null = null;
  try {
    meta = await microJSON(
      model, PACK_SYSTEM,
      `[주제] ${topic}\n\n[본문]\n${body.slice(0, 6000)}\n` +
      // SEO 포장도 microJSON 직행 — 브랜드 설정 시 태그·메타에 브랜드 연관 키워드가 자연스럽게 실리게.
      (brandContext() ? `\n${brandContext()}\n` : '') +
      (pinnedKeyword ? `\n[핵심 키워드(고정)] ${pinnedKeyword} — primaryKeyword 는 정확히 이 값으로 쓰고, titles 5개 중 4개 이상과 meta 에 이 표기를 그대로 포함하라.\n` : '') +
      (serpText ? `\n[네이버 상위 노출 제목(실측)]\n${serpText.slice(0, 800)}\n` : '') +
      `${researchBrief ? `\n[리서치·SEO 브리프]\n${researchBrief.slice(0, 1500)}` : ''}\n\n` +
      `형식: {"primaryKeyword":"...","titles":["...","...","...","...","..."],"meta":"...","tags":["...","..."],"images":[{"alt":"...","prompt":"..."}]}`,
      { maxOutputTokens: 900, signal },
    );
  } catch { /* 포장 실패 시 폴백 아래 */ }

  // 고정 키워드 우선 — LLM 재추출값은 고정이 없을 때만(과녁 고정: 검사기·리비전 피드백·제목이 같은 표기를 본다).
  const primaryKeyword = pinnedKeyword || stripEmoji(asString(meta?.primaryKeyword).trim() || seedKeyword(topic));
  const titles = (Array.isArray(meta?.titles) ? meta!.titles as unknown[] : [])
    .map((t) => stripEmoji(asString(t)).trim()).filter(Boolean).slice(0, 5);
  const titleCandidates = titles.length ? titles : [topic];
  const metaDescription = stripEmoji(asString(meta?.meta)).trim().slice(0, 200);
  const tags = (Array.isArray(meta?.tags) ? meta!.tags as unknown[] : [])
    .map((t) => stripEmoji(asString(t)).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10);
  const imageSlots = (meta?.images ?? [])
    .map((im) => ({ alt: stripEmoji(asString(im?.alt)).trim(), prompt: asString(im?.prompt).trim() }))
    .filter((im) => im.alt || im.prompt).slice(0, 3); // 이미지 실생성 한도(3장)와 일치 — 미생성 파일 참조 방지
  const internalLinks = input.internalLinks ?? [];

  const seo = scoreSeo({ title: titleCandidates[0] ?? topic, body, primaryKeyword, tags, imageSlots: imageSlots.length });
  const draft: BlogDraft = { topic, primaryKeyword, titleCandidates, metaDescription, tags, imageSlots, internalLinks, bodyMarkdown: body, seo };

  return {
    platform: 'naver_blog',
    files: draftFiles(draft),
    meta: { title: titleCandidates[0], titleCandidates, seoScore: seo.score, tags, primaryKeyword },
    draft,
  };
}

/**
 * 초안 → 세션 파일 목록(draft.json/md/html + image-prompts.md). 슬롯이 갱신되면(디자이너 협의) 재호출해 동기화.
 * imagesReady=true 면 draft.html 이 세션 images/blog-image-0N.png 를 <img> 로 참조(이미지 실생성 런).
 */
export function draftFiles(draft: BlogDraft, imagesReady = false): Array<{ name: string; content: string }> {
  const files = [
    { name: 'draft.json', content: JSON.stringify(draft, null, 2) },
    { name: 'draft.md', content: renderMarkdown(draft) },
    { name: 'draft.html', content: renderHtml(draft, { imagesReady }) },
  ];
  if (draft.imageSlots.length) {
    files.push({ name: 'image-prompts.md', content: draft.imageSlots.map((s, i) => `${i + 1}. **${s.alt}**\n   ${s.prompt}`).join('\n\n') });
  }
  return files;
}

/**
 * 이미지 디자이너의 계획 텍스트 → 이미지 슬롯(alt/prompt). 자유 서술 뒤 JSON 한 줄
 * ({"images":[{"alt","prompt"}]}) 을 firstJson 으로 추출, alt·prompt 둘 다 있는 항목만 최대 max.
 * 실패/빈 계획이면 [] — 호출부가 기존 슬롯을 유지(fail-open). 순수 함수 — 단위 테스트 대상.
 */
export function parseImagePlan(text: string, max = 3): Array<{ alt: string; prompt: string }> {
  const j = firstJson<{ images?: Array<{ alt?: unknown; prompt?: unknown }> }>(text ?? '');
  const arr = Array.isArray(j?.images) ? j!.images : [];
  return arr
    .map((im) => ({ alt: asString(im?.alt).trim(), prompt: asString(im?.prompt).trim() }))
    .filter((im) => im.alt && im.prompt)
    .slice(0, Math.max(1, max));
}

registerFormatter('naver_blog', packageNaverBlog);
