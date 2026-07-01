/**
 * 네이버 블로그 포매터 — org 본문을 발행용 초안(제목·메타·태그·이미지 슬롯·SEO 점수)으로 포장.
 * 본문은 생성하지 않는다(작가가 이미 씀). 구조작업(제목/메타/태그/이미지 프롬프트)만 microJSON 1콜.
 */
import { microJSON } from '../orchestrator/agent';
import { asString } from '../util/str';
import { seedKeyword } from '../grounding/naver_common';
import { scoreSeo } from './seo';
import { renderMarkdown, renderHtml } from './render';
import { registerFormatter } from './formatter';
import type { AssetBundle, BlogDraft, FormatterInput } from './formatter';

const PACK_SYSTEM =
  '너는 네이버 블로그 SEO 편집자다. 주어진 블로그 본문을 바탕으로 발행용 메타데이터를 만든다.\n' +
  '- primaryKeyword: 이 글의 핵심 타겟 키워드 1개(검색량 있을 법한 명사구).\n' +
  '- titles: 검색 노출에 유리한 제목 후보 5개. 핵심 키워드를 앞쪽에 자연스럽게, 15~40자, 클릭 유도. 과장·낚시 금지.\n' +
  '- meta: 100~200자 요약(검색 스니펫용). 핵심 키워드 포함, 글의 이득을 한 문장으로.\n' +
  '- tags: 5~10개(핵심·연관 키워드, # 없이). 본문과 무관한 태그 금지.\n' +
  '- images: 본문 흐름에 맞는 이미지 3개 슬롯. alt(대체텍스트)와 prompt(이미지 생성 프롬프트, 한국어).\n' +
  '본문에 없는 사실을 지어내지 마라.';

export async function packageNaverBlog(input: FormatterInput): Promise<AssetBundle> {
  const { topic, body, researchBrief, model, signal } = input;
  let meta: {
    primaryKeyword?: string; titles?: unknown; meta?: string; tags?: unknown;
    images?: Array<{ alt?: string; prompt?: string }>;
  } | null = null;
  try {
    meta = await microJSON(
      model, PACK_SYSTEM,
      `[주제] ${topic}\n\n[본문]\n${body.slice(0, 6000)}\n${researchBrief ? `\n[리서치·SEO 브리프]\n${researchBrief.slice(0, 1500)}` : ''}\n\n` +
      `형식: {"primaryKeyword":"...","titles":["...","...","...","...","..."],"meta":"...","tags":["...","..."],"images":[{"alt":"...","prompt":"..."}]}`,
      { maxOutputTokens: 900, signal },
    );
  } catch { /* 포장 실패 시 폴백 아래 */ }

  const primaryKeyword = (asString(meta?.primaryKeyword).trim() || seedKeyword(topic));
  const titles = (Array.isArray(meta?.titles) ? meta!.titles as unknown[] : [])
    .map((t) => asString(t).trim()).filter(Boolean).slice(0, 5);
  const titleCandidates = titles.length ? titles : [topic];
  const metaDescription = asString(meta?.meta).trim().slice(0, 200);
  const tags = (Array.isArray(meta?.tags) ? meta!.tags as unknown[] : [])
    .map((t) => asString(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10);
  const imageSlots = (meta?.images ?? [])
    .map((im) => ({ alt: asString(im?.alt).trim(), prompt: asString(im?.prompt).trim() }))
    .filter((im) => im.alt || im.prompt).slice(0, 5);
  const internalLinks = input.internalLinks ?? [];

  const seo = scoreSeo({ title: titleCandidates[0] ?? topic, body, primaryKeyword, tags, imageSlots: imageSlots.length });
  const draft: BlogDraft = { topic, primaryKeyword, titleCandidates, metaDescription, tags, imageSlots, internalLinks, bodyMarkdown: body, seo };

  const md = renderMarkdown(draft);
  const files = [
    { name: 'draft.json', content: JSON.stringify(draft, null, 2) },
    { name: 'draft.md', content: md },
    { name: 'draft.html', content: renderHtml(draft) },
  ];
  if (imageSlots.length) {
    files.push({ name: 'image-prompts.md', content: imageSlots.map((s, i) => `${i + 1}. **${s.alt}**\n   ${s.prompt}`).join('\n\n') });
  }
  return {
    platform: 'naver_blog',
    files,
    meta: { title: titleCandidates[0], titleCandidates, seoScore: seo.score, tags, primaryKeyword },
    draft,
  };
}

registerFormatter('naver_blog', packageNaverBlog);
