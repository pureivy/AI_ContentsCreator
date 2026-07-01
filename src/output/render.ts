/**
 * BlogDraft → 네이버 붙여넣기용 마크다운 / 스마트에디터 호환 HTML.
 * 외부 의존 없이 최소 마크다운 서브셋만 변환(스마트에디터가 안전히 받는 범위: h2/h3·p·ul/ol·strong).
 */
import type { BlogDraft } from './formatter';

/** 마크다운 — 제목 + 메타 + 본문 + 태그(+ 제목 후보 주석). */
export function renderMarkdown(d: BlogDraft): string {
  const parts = [
    `# ${d.titleCandidates[0] ?? d.topic}`,
    d.metaDescription ? `> ${d.metaDescription}` : '',
    d.bodyMarkdown.trim(),
    d.imageSlots.length ? `\n---\n**🖼 이미지 슬롯(발행 시 삽입):**\n${d.imageSlots.map((s, i) => `${i + 1}. ${s.alt} — _${s.prompt}_`).join('\n')}` : '',
    d.tags.length ? `**태그:** ${d.tags.map((t) => `#${t}`).join(' ')}` : '',
    d.titleCandidates.length > 1 ? `<!-- 제목 후보: ${d.titleCandidates.join(' / ')} -->` : '',
    `<!-- SEO 점수: ${d.seo.score}/100 · 핵심키워드: ${d.primaryKeyword} -->`,
  ].filter(Boolean);
  return parts.join('\n\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** 인라인 **강조** → <strong>. */
function inline(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** 최소 마크다운 → HTML(스마트에디터 붙여넣기용). 지원: ## h2, ### h3, - / 1. 리스트, 문단. */
export function renderHtml(d: BlogDraft): string {
  const lines = d.bodyMarkdown.split('\n');
  const html: string[] = [`<h1>${inline(d.titleCandidates[0] ?? d.topic)}</h1>`];
  if (d.metaDescription) html.push(`<p><em>${inline(d.metaDescription)}</em></p>`);
  let listType: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (listType) { html.push(`</${listType}>`); listType = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^###\s+(.*)$/))) { flushPara(); flushList(); html.push(`<h3>${inline(m[1]!)}</h3>`); }
    else if ((m = line.match(/^##\s+(.*)$/))) { flushPara(); flushList(); html.push(`<h2>${inline(m[1]!)}</h2>`); }
    else if ((m = line.match(/^#\s+(.*)$/))) { flushPara(); flushList(); html.push(`<h2>${inline(m[1]!)}</h2>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (listType !== 'ol') { flushList(); html.push('<ol>'); listType = 'ol'; } html.push(`<li>${inline(m[1]!)}</li>`); }
    else if ((m = line.match(/^\s*[-*·]\s+(.*)$/))) { flushPara(); if (listType !== 'ul') { flushList(); html.push('<ul>'); listType = 'ul'; } html.push(`<li>${inline(m[1]!)}</li>`); }
    else { flushList(); para.push(line.trim()); }
  }
  flushPara(); flushList();
  if (d.tags.length) html.push(`<p>${d.tags.map((t) => `#${esc(t)}`).join(' ')}</p>`);
  return html.join('\n');
}
