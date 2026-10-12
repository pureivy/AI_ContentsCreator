/**
 * 블로그 설명 도표 적용(2026-10-12) — 세션의 draft.json·image_manifest.json·images/ 에 도표 2장을 끼워 넣는다.
 * 순수 로직은 src/output/blogDiagrams.ts, 렌더는 scripts/blog_skills/blog_diagram.py. 실패는 무해(도표 없이 종전 그대로).
 * 이미지 파일은 새 마커 순서대로 blog-image-NN.png 로 다시 매긴다 — 발행(마커 순서 ↔ 매니페스트 순서)과
 * 미리보기(슬롯 i ↔ blog-image-{i+1})가 같은 짝을 보게 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BlogDraft } from '../output/formatter';
import { draftFiles } from '../output/naverBlog';
import { extractStepsDiagram, insertDiagramMarkers, summaryInsertAt, summaryPrompt, validateSummaryItems, type DiagramSpec } from '../output/blogDiagrams';
import { renderBlogDiagram } from '../tools/blog_skills';
import { microJSON } from './agent';
import { stdModel } from './visionCommon';

const FONT_DIR = path.resolve('remotion/fonts');

export async function applyBlogDiagrams(
  sessionDir: string, draft: BlogDraft, opts: { kicker?: string; brand?: string; handle?: string; signal?: AbortSignal; log?: (m: string) => void } = {},
): Promise<{ draft: BlogDraft; added: number } | null> {
  const log = opts.log ?? (() => {});
  sessionDir = path.resolve(sessionDir); // 렌더러가 spec 폴더를 cwd 로 쓴다 — 상대 경로면 파일을 못 찾는다
  const manifestPath = path.join(sessionDir, 'image_manifest.json');
  const imagesDir = path.join(sessionDir, 'images');
  let manifest: { images?: Array<Record<string, unknown>> } = { images: [] };
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { /* 이미지 없음 — 도표만 */ }
  const images = (manifest.images ?? []).slice().sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  if (images.some((e) => e.source === 'diagram')) return null; // 이미 적용됨(재실행 멱등)
  const body = draft.bodyMarkdown;
  const kicker = (opts.kicker || draft.primaryKeyword || draft.topic || '').slice(0, 20);

  const specs: DiagramSpec[] = [];
  const steps = extractStepsDiagram(body);
  if (steps) specs.push(steps);
  try {
    const j = await microJSON<{ title?: unknown; items?: Array<{ label?: unknown; text?: unknown }> }>(
      stdModel(), '당신은 블로그 요약 도표 편집자입니다. 요청된 JSON 스키마만 출력합니다.', summaryPrompt(body, kicker),
      { maxOutputTokens: 700, signal: opts.signal },
    );
    const items = validateSummaryItems(body, Array.isArray(j?.items) ? j!.items! : []);
    const title = String(j?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || '한눈에 보기';
    if (items.length >= 3) specs.push({ kind: 'points', title, items, insertAt: summaryInsertAt(body, steps?.insertAt), alt: `${title} 도표` });
    else log(`요약 도표 생략 — 본문과 맞는 칸 ${items.length}개(3개 미만)`);
  } catch { log('요약 도표 생략 — 생성 실패'); }
  if (!specs.length) return null;

  fs.mkdirSync(imagesDir, { recursive: true });
  const rendered: Array<{ spec: DiagramSpec; file: string }> = [];
  for (const [k, spec] of specs.entries()) {
    const file = path.join(imagesDir, `diagram-${k + 1}.png`);
    const specPath = path.join(sessionDir, `diagram-${k + 1}.json`);
    fs.writeFileSync(specPath, JSON.stringify({ ...spec, kicker, brand: opts.brand ?? '비온디트리', handle: opts.handle ?? 'biondi_tree', out: file, fontDir: FONT_DIR }), 'utf-8');
    const r = await renderBlogDiagram(specPath, opts.signal);
    if (r.ok && fs.existsSync(file)) rendered.push({ spec, file });
    else log(`도표 렌더 실패(${spec.kind}) — ${r.output.slice(-120)}`);
  }
  if (!rendered.length) return null;

  const ins = insertDiagramMarkers(body, rendered.map((r) => r.spec));
  const oldSlots = draft.imageSlots;
  // 새 마커 순서대로 출처를 모은다 — 기존 마커가 이미지보다 많으면(자리표시) 그 자리는 슬롯만 있고 파일이 없다.
  const entries = ins.order.map((o) => (o.kind === 'old'
    ? { slot: oldSlots[o.i] ?? { alt: '', prompt: '' }, img: images[o.i] }
    : { slot: { alt: rendered[o.d]!.spec.alt, prompt: '도표(HTML 렌더) — 본문 문장으로 만든 설명 도표' },
        img: { filename: '', file_path: rendered[o.d]!.file, alt: rendered[o.d]!.spec.alt, source: 'diagram', style: 'diagram' } as Record<string, unknown> }));
  // 파일 이름 다시 매기기 — 겹침 없이 두 단계(임시 → 최종).
  const tmp = entries.map((e, i) => {
    const src = e.img?.file_path ? String(e.img.file_path) : '';
    if (!src || !fs.existsSync(src)) return null;
    const t = path.join(imagesDir, `.renum-${i}.png`);
    fs.renameSync(src, t);
    return t;
  });
  const newImages: Array<Record<string, unknown>> = [];
  entries.forEach((e, i) => {
    const t = tmp[i];
    if (!t) return;
    const name = `blog-image-${String(i + 1).padStart(2, '0')}.png`;
    const dest = path.join(imagesDir, name);
    fs.renameSync(t, dest);
    newImages.push({ ...(e.img ?? {}), index: i, filename: name, file_path: dest });
  });
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, images: newImages }, null, 2), 'utf-8');
  const next: BlogDraft = { ...draft, bodyMarkdown: ins.body, imageSlots: entries.map((e) => e.slot) };
  for (const f of draftFiles(next, true)) if (f.name === 'draft.json' || f.name === 'draft.md' || f.name === 'image-prompts.md') fs.writeFileSync(path.join(sessionDir, f.name), f.content, 'utf-8');
  // diagram-N.json(도표 문구 원본)은 남긴다 — 어떤 문장으로 도표를 만들었는지 사후 확인용.
  log(`설명 도표 ${rendered.length}장 — ${rendered.map((r) => r.spec.title).join(' · ')}`);
  return { draft: next, added: rendered.length };
}
