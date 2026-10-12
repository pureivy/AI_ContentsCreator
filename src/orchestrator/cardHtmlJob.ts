/**
 * 카드뉴스 HTML 판형 잡(2026-10-12 사장님 "매일 만드는 카드뉴스도 이 방식으로") — 기획이 끝난 뒤 cardnews.ts 가 부른다.
 * 판형 고르기·칸 채우기 → 칸 사실 대조 → 사진(블로그 재사용·생성·원문 묘사 검수) → HTML 렌더 → layout.json·design.json.
 * 수정 요청(reviseHtmlCard)은 칸 글·사진 장면만 바꿔 다시 렌더한다(그림 오타 재생성 경로는 HTML 판에 해당 없음).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { pieceStore } from '../content/pieces';
import { listMedia, shootYmOf } from '../content/mediaLibrary';
import { getBrand } from '../content/brand';
import { findSpecies, speciesAnchor } from '../content/species';
import { timingParityIssues } from '../content/timingParity';
import { inheritedClaims } from '../content/inheritedClaims';
import { parityIssues } from './standaloneQa';
import { generateImagesForDraft } from '../tools/blog_skills';
import { qaSceneImages } from './shortsSceneQa';
import { stdModel } from './visionCommon';
import { microJSON } from './agent';
import {
  normalizeLayout, layoutFields, dropFields, parityKeys, layoutPrompt, toRenderSpec, genPhotoPrompt, renderCardSpec,
  CARD_FONT_DIR, CARD_MAX_GEN, type BlogPhoto, type CardLayout, type LayoutSlide, type PhotoRef,
} from './cardLayout';

type Say = (m: string) => void;
type PlanLike = { title: string; slides: Array<{ headline: string; body: string }> };

/** 블로그 사진 후보(세션 image_manifest, 도표 제외) — 원본은 정리 대상이라 카드 폴더 photos/ 로 복사해 둔다. */
export function blogPhotosFor(pieceId: string | undefined, cardDir: string): BlogPhoto[] {
  if (!pieceId) return [];
  const runId = pieceStore().get(pieceId)?.runId;
  if (!runId) return [];
  let m: { images?: Array<{ file_path?: string; alt?: string; source?: string; mediaId?: string }> } = {};
  try { m = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, runId, 'image_manifest.json'), 'utf-8')) as typeof m; } catch { return []; }
  const dst = path.join(cardDir, 'photos');
  fs.mkdirSync(dst, { recursive: true });
  const out: BlogPhoto[] = [];
  for (const im of m.images ?? []) {
    const fp = String(im?.file_path ?? '');
    if (!fp || im?.source === 'diagram' || !fs.existsSync(fp)) continue;
    const n = out.length + 1;
    const to = path.join(dst, `blog-${String(n).padStart(2, '0')}${path.extname(fp) || '.png'}`);
    try { fs.copyFileSync(fp, to); } catch { continue; }
    out.push({ n, path: to, alt: String(im?.alt ?? '').slice(0, 80), real: im?.source === 'archive_frame', ...(im?.mediaId ? { mediaId: im.mediaId } : {}) });
  }
  return out;
}

/** 카드에 찍는 상호·계정 — brand.yaml name 은 슬러그(bionditree)라 한글 상호로 바꾼다. */
export function brandDisplay(): { name: string; handle: string } {
  const n = getBrand()?.name ?? '';
  if (n === 'bionditree' || n === '비온디트리') return { name: process.env.CARD_BRAND_NAME ?? '비온디트리', handle: process.env.CARD_BRAND_HANDLE ?? 'biondi_tree' };
  return { name: process.env.CARD_BRAND_NAME ?? n, handle: process.env.CARD_BRAND_HANDLE ?? '' };
}

/** 실촬영 표지 꼬리표 — "📷 비온디트리 실제 촬영 · 2026년 10월"(촬영 월은 보관소 태그에서, 없으면 생략). */
export function coverNoteFor(p: BlogPhoto | undefined, brandName: string): string | undefined {
  if (!p?.real) return undefined;
  let ym: number | null = null;
  try { const mi = listMedia().find((x) => x.id === p.mediaId); if (mi) ym = shootYmOf(mi); } catch { /* 월 생략 */ }
  return `📷 ${brandName} 실제 촬영${ym !== null ? ` · ${Math.floor(ym / 12)}년 ${(ym % 12) + 1}월` : ''}`;
}

/** 칸 사실 대조 — 원문 정합(LLM)·시기·승계. 걸린 칸은 지운다(최대 2회 — parity 는 한 번에 5건까지만 보고한다). */
async function factCheckFields(layout: CardLayout, source: string, flagged: readonly string[], say: Say, signal?: AbortSignal): Promise<CardLayout> {
  let l = layout;
  for (let round = 1; round <= 2; round++) {
    const fields = layoutFields(l);
    if (!fields.length || !source.trim()) return l;
    const drop = new Set<string>();
    const parity = CONFIG.factGate ? await parityIssues('인스타그램 카드뉴스 칸(장별 설명 글)', fields.map((f) => `${f.field}: ${f.text}`), source, signal) : [];
    for (const k of parityKeys(parity, fields)) drop.add(k);
    const asKey = fields.map((f) => ({ field: f.key, text: f.text }));
    for (const t of timingParityIssues(source, asKey)) drop.add(t.field);
    if (flagged.length) for (const c of inheritedClaims([...flagged], asKey)) drop.add(c.field);
    if (!drop.size) return l;
    say(`카드 칸 사실 대조 — ${drop.size}칸 지움(${[...parity].slice(0, 1).join('').slice(0, 50)})`);
    l = dropFields(l, drop);
    if (parity.length < 5) return l; // 5건 미만이면 다 본 것이다
  }
  return l;
}

/** 사진 자리 모으기 — 장 순서대로 PhotoRef 를 꺼낸다(gen 은 상한까지만 남기고 나머지는 지운다). */
function collectGen(l: CardLayout, max: number): Array<{ ref: Extract<PhotoRef, { use: 'gen' }>; slide: number }> {
  const out: Array<{ ref: Extract<PhotoRef, { use: 'gen' }>; slide: number }> = [];
  const take = (r: PhotoRef | undefined, slide: number): PhotoRef | undefined => {
    if (r?.use !== 'gen') return r;
    if (out.length >= max) return undefined;
    out.push({ ref: r, slide });
    return r;
  };
  l.slides.forEach((s, i) => {
    s.photo = take(s.photo, i);
    s.items?.forEach((it) => { it.photo = take(it.photo, i); });
    s.photos?.forEach((p) => { p.photo = take(p.photo, i) ?? p.photo; });
  });
  return out;
}

/** 사진이 빠진 pair·사진 칸 정리 — pair 는 두 장 다 있어야 한다(아니면 photo 판으로). */
function fixMissingPhotos(l: CardLayout, has: (r: PhotoRef | undefined) => boolean): CardLayout {
  return {
    ...l,
    slides: l.slides.map((s): LayoutSlide => {
      if (s.kind === 'pair' && !(s.photos ?? []).every((p) => has(p.photo))) {
        const one = (s.photos ?? []).find((p) => has(p.photo));
        return { kind: 'photo', title: s.title, ...(s.accent ? { accent: s.accent } : {}), ...(s.lead ? { lead: s.lead } : {}), ...(one ? { photo: one.photo } : {}), ...(s.note ? { note: s.note } : {}) };
      }
      return { ...s, ...(s.photo && !has(s.photo) ? { photo: undefined } : {}), ...(s.items ? { items: s.items.map((it) => ({ ...it, ...(it.photo && !has(it.photo) ? { photo: undefined } : {}) })) } : {}) };
    }),
  };
}

/** 사진 자리를 파일로 고정(layout.json 영속용 — 수정 요청 재렌더가 같은 사진을 쓴다). */
function pinPhotos(l: CardLayout, resolve: (r: PhotoRef | undefined) => string | undefined): CardLayout {
  const pin = (r: PhotoRef | undefined): PhotoRef | undefined => { const p = resolve(r); return p ? { use: 'file', path: p } : undefined; };
  return {
    ...l,
    slides: l.slides.map((s) => ({
      ...s,
      ...(s.photo ? { photo: pin(s.photo) } : {}),
      ...(s.items ? { items: s.items.map((it) => ({ ...it, ...(it.photo ? { photo: pin(it.photo) } : {}) })) } : {}),
      ...(s.photos ? { photos: s.photos.map((p) => ({ label: p.label, photo: pin(p.photo)! })) } : {}),
    })),
  };
}

/** 렌더 + 결과 정리 — 기존 slide_NN 을 지우고 새로 찍는다. 넘침 잔존은 로그로. */
async function renderLayout(dir: string, l: CardLayout, coverNote: string | undefined, say: Say, signal?: AbortSignal): Promise<number> {
  for (const f of fs.readdirSync(dir)) if (/^slide_\d{2}\.png$/.test(f)) fs.unlinkSync(path.join(dir, f));
  const spec = toRenderSpec(l, (r) => (r?.use === 'file' ? r.path : undefined), {
    outDir: dir, fontDir: CARD_FONT_DIR,
    brand: brandDisplay(),
    ...(coverNote ? { coverNote } : {}),
  });
  const specPath = path.join(dir, 'render-spec.json');
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2), 'utf-8');
  const r = await renderCardSpec(specPath, signal);
  if (!r) throw new Error('카드 렌더 실패 — card_render.py');
  const left = r.slides.filter((s) => s.issues.length);
  if (left.length) say(`카드 렌더 — 넘침 잔존 ${left.map((s) => `${s.n}번(${s.issues[0]})`).join(', ')}`);
  return fs.readdirSync(dir).filter((f) => /^slide_\d{2}\.png$/.test(f)).length;
}

export interface HtmlCardResult { count: number; layout: CardLayout }

/** 생성 잡 본체 — runCardNewsJob 이 기획 직후 부른다. callJSON 은 카드뉴스 디자이너 역할 호출(오피스 뷰 연동). */
export async function designHtmlCards(o: {
  dir: string; plan: PlanLike; topic: string; keyword?: string; sourceBody?: string; sourcePieceId?: string;
  sourceFlagged?: string[]; say: Say; signal?: AbortSignal;
  callJSON: <T>(sys: string, user: string, budget: number) => Promise<T | null>;
}): Promise<HtmlCardResult> {
  const { dir, plan, say } = o;
  const source = o.sourceBody ?? '';
  fs.writeFileSync(path.join(dir, 'source.md'), source, 'utf-8'); // 수정 요청이 같은 원문으로 칸을 검증한다
  const blog = blogPhotosFor(o.sourcePieceId, dir);
  say(`카드 판형 — 블로그 사진 ${blog.length}장(실촬영 ${blog.filter((b) => b.real).length}) · 새 사진 상한 ${CARD_MAX_GEN}장`);

  const sys = '당신은 인스타그램 카드뉴스 디자이너입니다. 요청된 JSON 스키마만 출력합니다.';
  const user = layoutPrompt({ plan, source, blog, maxGen: CARD_MAX_GEN, flagged: o.sourceFlagged ?? [] });
  let raw = await o.callJSON<unknown>(sys, user, 3000);
  if (!raw) raw = await o.callJSON<unknown>(sys, `${user}\n\n반드시 완결된 JSON 하나만 출력하라.`, 3000);
  try { fs.writeFileSync(path.join(dir, 'layout-raw.json'), JSON.stringify(raw, null, 2), 'utf-8'); } catch { /* 진단용 */ }
  let layout = normalizeLayout(raw, plan, source, blog.length);
  say(`카드 판형 — ${layout.slides.map((s) => s.kind).join('·')}`);
  layout = await factCheckFields(layout, source, o.sourceFlagged ?? [], say, o.signal);

  // 표지 — 실촬영이 있으면 그것, 없으면 기획대로(없으면 첫 블로그 사진).
  const real = blog.find((b) => b.real);
  const s0 = layout.slides[0]!;
  if (real) s0.photo = { use: 'blog', n: real.n };
  else if (!s0.photo && blog[0]) s0.photo = { use: 'blog', n: blog[0].n };
  const coverNote = s0.photo?.use === 'blog' && s0.photo.n === real?.n ? coverNoteFor(real, brandDisplay().name) : undefined;

  // 새 사진 — 글자 없는 실사 + 원문 묘사 검수(숏폼 장면 검수와 같은 함수, 2026-10-12 사장님 "카드뉴스에도 원문 묘사 대조 검수").
  const gen = collectGen(layout, CARD_MAX_GEN);
  const genPath = new Map<Extract<PhotoRef, { use: 'gen' }>, string>();
  if (gen.length) {
    const known = findSpecies(`${o.keyword ?? ''} ${plan.title}`);
    const subject = known ? speciesAnchor(known) : undefined;
    const prompts = gen.map((g) => genPhotoPrompt(g.ref.scene, g.ref.must, subject));
    const draftPath = path.join(dir, 'photos-gen-draft.json');
    const manPath = path.join(dir, 'photos-gen-manifest.json');
    fs.writeFileSync(draftPath, JSON.stringify({ imageSlots: gen.map((g, k) => ({ alt: `slide ${g.slide + 1} photo ${k + 1}`, prompt: prompts[k] })) }, null, 2), 'utf-8');
    say(`카드 사진 생성 — ${gen.length}장(글자 없는 실사)`);
    const r = await generateImagesForDraft(draftPath, path.join(dir, 'photos-gen'), manPath,
      { imageStyle: 'photorealistic', limit: gen.length, size: '1024x1536', timeoutMs: 150_000 * gen.length }, o.signal);
    let imgs: Array<string | null> = gen.map(() => null);
    try {
      const man = JSON.parse(fs.readFileSync(manPath, 'utf-8')) as { images?: Array<{ file_path?: string; error?: string } | null> };
      imgs = gen.map((_, k) => { const im = man.images?.[k]; return im?.file_path && !im.error && fs.existsSync(im.file_path) ? im.file_path : null; });
    } catch { if (!r.ok) say('카드 사진 생성 실패 — 사진 없는 판으로'); }
    if (imgs.some(Boolean)) {
      const qa = await qaSceneImages({
        dir, images: imgs, scenePrompts: prompts, preset: 'photorealistic', signal: o.signal,
        ...(known ? { subject, subjectLatin: known.latin } : {}),
        sceneHints: gen.map((g) => plan.slides[g.slide]?.headline ?? ''),
        sceneMust: gen.map((g) => g.ref.must),
      });
      if (qa.regenerated || qa.issues.length) say(`카드 사진 검수 — 다시 그림 ${qa.regenerated}장${qa.issues.length ? ` · ${qa.issues.slice(0, 2).join(' / ')}` : ''}`);
      imgs = qa.images;
    }
    gen.forEach((g, k) => { const p = imgs[k]; if (p) genPath.set(g.ref, p); });
  }
  const resolve = (r: PhotoRef | undefined): string | undefined => {
    if (!r) return undefined;
    if (r.use === 'file') return fs.existsSync(r.path) ? r.path : undefined;
    if (r.use === 'blog') return blog.find((b) => b.n === r.n)?.path;
    return genPath.get(r);
  };
  layout = fixMissingPhotos(layout, (r) => !!resolve(r));
  // 사진 판인데 사진이 빈 장 — 블로그 사진 중 덜 쓴 것으로 채운다(바로 앞 장과 같은 사진은 피한다). 글만 있는 photo 판은 빈 화면처럼 보인다.
  if (blog.length) {
    const used = new Map<number, number>();
    const mark = (r: PhotoRef | undefined): void => { if (r?.use === 'blog') used.set(r.n, (used.get(r.n) ?? 0) + 1); };
    layout.slides.forEach((s) => { mark(s.photo); s.items?.forEach((it) => mark(it.photo)); s.photos?.forEach((p) => mark(p.photo)); });
    layout.slides.forEach((s, i) => {
      if (s.kind !== 'photo' || s.photo) return;
      const prev = layout.slides[i - 1]?.photo;
      const pick = [...blog].filter((b) => !(prev?.use === 'blog' && prev.n === b.n)).sort((a, b) => (used.get(a.n) ?? 0) - (used.get(b.n) ?? 0))[0];
      if (pick && (used.get(pick.n) ?? 0) < 2) { s.photo = { use: 'blog', n: pick.n }; used.set(pick.n, (used.get(pick.n) ?? 0) + 1); }
    });
  }
  layout = pinPhotos(layout, resolve);

  const count = await renderLayout(dir, layout, coverNote, say, o.signal);
  if (!count) throw new Error('카드 렌더 결과 없음');
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({ ...layout, coverNote }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, 'design.json'), JSON.stringify({ mode: 'html', slideMap: layout.slides.map((_, i) => i + 1) }, null, 2), 'utf-8');
  return { count, layout };
}

/** HTML 판 카드인가(design.json mode). */
export function isHtmlCard(dir: string): boolean {
  try { return (JSON.parse(fs.readFileSync(path.join(dir, 'design.json'), 'utf-8')) as { mode?: string }).mode === 'html'; } catch { return false; }
}

/** 저장된 판형으로 다시 렌더(그림 오타 재생성 요청 등 — HTML 판은 글자를 다시 찍기만 하면 된다). */
export async function rerenderHtmlCard(dir: string, say: Say, signal?: AbortSignal): Promise<number> {
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf-8')) as CardLayout & { coverNote?: string };
  // 종전 수정 경로(캡션·문구 개정)가 plan.json 만 고쳤을 수 있다 — 장 수가 같으면 제목·본문은 기획 문구를 따른다.
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8')) as PlanLike;
    if (plan.slides.length === saved.slides.length) {
      saved.slides = saved.slides.map((s, i) => {
        const p = plan.slides[i]!;
        const lead = p.body.replace(/\s*\n+\s*/g, ' ').trim();
        return { ...s, title: p.headline, ...(lead ? { lead } : { lead: undefined }), ...(s.accent && !p.headline.includes(s.accent) ? { accent: undefined } : {}) };
      });
      fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(saved, null, 2), 'utf-8');
    }
  } catch { /* 저장 판형 그대로 */ }
  return renderLayout(dir, saved, saved.coverNote, say, signal);
}

/**
 * 수정 요청(HTML 판) — 제목·본문·칸 글을 고치고, 필요하면 사진 장면을 다시 그린다. 고친 칸은 원문 겹침·사실 대조를 다시 거친다.
 * 반환: 바뀐 장 번호(1부터). 바뀐 게 없으면 null.
 */
export async function reviseHtmlCard(dir: string, feedback: string, say: Say, signal?: AbortSignal): Promise<{ changed: number[]; plan: PlanLike } | null> {
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf-8')) as CardLayout & { coverNote?: string };
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8')) as PlanLike;
  let source = '';
  try { source = fs.readFileSync(path.join(dir, 'source.md'), 'utf-8'); } catch { /* 원문 없는 카드 — 칸 검증 생략 */ }
  const view = saved.slides.map((s, i) => ({ index: i + 1, ...s, photo: s.photo ? '(사진)' : undefined, items: s.items?.map((it) => ({ ...it, photo: it.photo ? '(사진)' : undefined })), photos: s.photos?.map((p) => ({ label: p.label })) }));
  const j = await microJSON<{ slides?: Array<Record<string, unknown> & { index?: unknown }>; photo_regen?: Array<{ index?: unknown; scene?: unknown; must_show?: unknown; must_not?: unknown }> }>(
    stdModel(), '당신은 카드뉴스 편집자입니다. 요청된 JSON 스키마만 출력합니다.',
    [
      '아래 카드뉴스(장별 판형 JSON)에 검토자의 수정 요청을 반영하라. 바뀌는 장만, 그 장의 전체 칸을 같은 스키마로 돌려줘라(kind 는 바꾸지 말 것).',
      `[카드]\n${JSON.stringify(view, null, 1).slice(0, 9000)}`,
      `[수정 요청] ${feedback}`,
      source ? `[블로그 원문 — 칸 글은 여기서만]\n${source.slice(0, 4000)}` : '',
      '사진을 바꿔 달라는 요청이면 photo_regen 에 그 장 번호와 새 장면(글자 없는 사진 묘사)·must_show·must_not 을 적어라.',
      'JSON 형식: {"slides":[{"index":2,"title":"...","lead":"...","items":[...],...}],"photo_regen":[{"index":4,"scene":"...","must_show":[],"must_not":[]}]}',
    ].filter(Boolean).join('\n'),
    { maxOutputTokens: 2400, signal },
  ).catch(() => null);
  if (!j) return null;
  const changed = new Set<number>();
  const rawSlides = saved.slides.map((s) => ({ ...s })) as Array<Record<string, unknown>>;
  for (const ch of j.slides ?? []) {
    const i = Math.floor(Number(ch.index)) - 1;
    if (!(i >= 0 && i < rawSlides.length)) continue;
    const cur = rawSlides[i]!;
    const merged: Record<string, unknown> = { ...cur, ...ch, kind: cur.kind, photo: cur.photo };
    if (Array.isArray(ch.items) && Array.isArray(cur.items)) merged.items = (ch.items as Array<Record<string, unknown>>).map((it, k) => ({ ...it, photo: (cur.items as Array<{ photo?: unknown }>)[k]?.photo }));
    if (cur.photos) merged.photos = cur.photos;
    if (typeof ch.title === 'string' && ch.title.trim()) plan.slides[i] = { ...plan.slides[i]!, headline: ch.title.trim().slice(0, 40) };
    if (typeof ch.lead === 'string') plan.slides[i] = { ...plan.slides[i]!, body: ch.lead.trim().slice(0, 220) };
    rawSlides[i] = merged;
    changed.add(i + 1);
  }
  // 사진 다시 그리기
  const regen = (j.photo_regen ?? []).flatMap((x) => {
    const i = Math.floor(Number(x.index)) - 1;
    const scene = String(x.scene ?? '').trim();
    return i >= 0 && i < rawSlides.length && scene.length >= 6 ? [{ i, scene: scene.slice(0, 160), must: { show: (Array.isArray(x.must_show) ? x.must_show : []).map(String).slice(0, 4), not: (Array.isArray(x.must_not) ? x.must_not : []).map(String).slice(0, 3) } }] : [];
  }).slice(0, 3);
  if (regen.length) {
    const prompts = regen.map((g) => genPhotoPrompt(g.scene, g.must));
    const draftPath = path.join(dir, 'photos-regen-draft.json');
    const manPath = path.join(dir, 'photos-regen-manifest.json');
    const outDir = path.join(dir, `photos-regen-${Date.now()}`);
    fs.writeFileSync(draftPath, JSON.stringify({ imageSlots: regen.map((g, k) => ({ alt: `slide ${g.i + 1}`, prompt: prompts[k] })) }, null, 2), 'utf-8');
    await generateImagesForDraft(draftPath, outDir, manPath, { imageStyle: 'photorealistic', limit: regen.length, size: '1024x1536', timeoutMs: 150_000 * regen.length }, signal);
    let imgs: Array<string | null> = regen.map(() => null);
    try {
      const man = JSON.parse(fs.readFileSync(manPath, 'utf-8')) as { images?: Array<{ file_path?: string; error?: string } | null> };
      imgs = regen.map((_, k) => { const im = man.images?.[k]; return im?.file_path && !im.error && fs.existsSync(im.file_path) ? im.file_path : null; });
      const qa = await qaSceneImages({ dir, images: imgs, scenePrompts: prompts, preset: 'photorealistic', signal, sceneMust: regen.map((g) => g.must) });
      imgs = qa.images;
    } catch { /* 사진 교체 실패 — 기존 사진 유지 */ }
    regen.forEach((g, k) => {
      const p = imgs[k];
      if (!p) return;
      const s = rawSlides[g.i]!;
      if (s.photos && Array.isArray(s.photos)) (s.photos as Array<{ photo?: unknown }>)[0]!.photo = { use: 'file', path: p };
      else s.photo = { use: 'file', path: p };
      changed.add(g.i + 1);
    });
  }
  if (!changed.size) return null;
  let layout = normalizeLayout({ series: saved.series, slides: rawSlides }, plan, source, 0);
  // normalizeLayout 은 표지·마무리 판을 고정한다 — 기존 판(kind)이 다른 장은 저장본 kind 를 따른다(같은 판으로만 수정).
  layout = await factCheckFields(layout, source, [], say, signal);
  const count = await renderLayout(dir, layout, saved.coverNote, say, signal);
  if (!count) return null;
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({ ...layout, coverNote: saved.coverNote }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
  return { changed: [...changed].sort((a, b) => a - b), plan };
}
