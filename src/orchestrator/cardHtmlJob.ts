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
import { findSpecies, speciesAnchor, isYoungHero } from '../content/species';
import { timingParityIssues } from '../content/timingParity';
import { inheritedClaims, writerSource, flaggedForPrompt } from '../content/inheritedClaims';
import { parityIssues } from './standaloneQa';
import { generateImagesForDraft } from '../tools/blog_skills';
import { cardRealFrames } from './cardFrames';
import { qaSceneImages } from './shortsSceneQa';
import { stdModel, visionCapable } from './visionCommon';
import { microJSON } from './agent';

/** 작가용 원문(근거 미확인 문장을 뺀 판본, 2026-10-15) — 판형 생성 때 쓰고 수정 요청이 다시 읽는다. */
const WRITER_SOURCE_FILE = 'source.writer.md';
/** 원문 사실 게이트가 건 주장(2026-10-26) — 판형 생성 때 쓰고 수정 요청의 칸 사실 대조가 다시 읽는다(종전엔 수정 때 빈 목록이라 승계 검사가 꺼졌다). */
const SOURCE_FLAGGED_FILE = 'source.flagged.json';

/** 저장된 원문 지적 목록(옛 카드·깨진 파일은 빈 목록). */
export function readSourceFlagged(dir: string): string[] {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, SOURCE_FLAGGED_FILE), 'utf-8')) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
import {
  insideDir, normalizeLayout, layoutFields, dropFields, parityKeys, layoutPrompt, toRenderSpec, genPhotoPrompt, renderCardSpec,
  CARD_FONT_DIR, CARD_MAX_GEN, CARD_EXTRA_FRAMES, dedupeBlogPhotos, realPhotoSlots, type BlogPhoto, type CardLayout, type LayoutSlide, type PhotoRef,
} from './cardLayout';

type Say = (m: string) => void;
type PlanLike = { title: string; slides: Array<{ headline: string; body: string }> };

/** 블로그 실촬영 사진(보관소 영상 프레임) 경로 — 카드 표지에 나가는 사진. 없으면 undefined(2026-10-15, 표지 문구 대조용). */
export function realBlogPhoto(pieceId: string | undefined): string | undefined {
  const runId = pieceId ? pieceStore().get(pieceId)?.runId : undefined;
  if (!runId) return undefined;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(CONFIG.sessionsDir, runId, 'image_manifest.json'), 'utf-8')) as { images?: Array<{ file_path?: string; source?: string }> };
    const fp = m.images?.find((im) => im?.source === 'archive_frame' && im.file_path && fs.existsSync(im.file_path))?.file_path;
    return fp ? String(fp) : undefined;
  } catch { return undefined; }
}

/** 블로그 사진 후보(세션 image_manifest, 도표 제외) — 원본은 정리 대상이라 카드 폴더 photos/ 로 복사해 둔다. */
/** 표지 밖 실촬영 칸 중 그 장 글과 안 맞는 칸(비전 1회, fail-open — 실패하면 빈 배열). */
export async function realPhotoMismatches(layout: CardLayout, blog: readonly BlogPhoto[], say: Say, signal?: AbortSignal): Promise<Array<{ slide: number; why: string }>> {
  const slots = realPhotoSlots(layout, blog);
  if (!slots.length || !visionCapable()) return [];
  const pathOf = (n: number): string | undefined => blog.find((b) => b.n === n)?.path;
  const items = slots.map((x) => ({ ...x, path: pathOf(x.n) })).filter((x): x is { slide: number; n: number; path: string } => !!x.path && fs.existsSync(x.path));
  if (!items.length) return [];
  try {
    // 응답을 못 받으면 한 번 더 — 종전엔 판정 실패가 '전부 맞음'과 같은 빈 배열로 조용히 지나갔다(card_c968068183: 7번 장 수관 사진 통과).
    const ask = (): Promise<{ mismatches?: Array<{ k?: unknown; why?: unknown }> } | null> => microJSON<{ mismatches?: Array<{ k?: unknown; why?: unknown }> }>(stdModel(),
      '당신은 카드뉴스 사진 검수자입니다. 사진을 직접 보고 요청된 JSON 스키마만 출력합니다.',
      [
        `사진 ${items.length}장과 그 사진이 들어갈 카드 장의 글이다(순번 같음). 각 사진이 그 글이 말하는 장면·부위·나무 단계를 보여 주는지 판정하라.`,
        '안 맞음의 예: 글은 밑동·흙·접목 자리를 말하는데 사진은 나무 윗부분만 보인다 / 글은 어린 묘목인데 사진은 큰 나무다 / 글은 가지를 구부리는 동작인데 사진엔 손이 닿을 가지가 안 보인다.',
        '분위기·배경으로 무난한 정도로는 맞음이 아니다 — 글이 가리키는 것이 사진에 보여야 맞음이다.',
        ...items.map((x, k) => { const sl = layout.slides[x.slide]!; return `${k + 1}) ${sl.title}${sl.lead ? ` — ${sl.lead.replace(/\s*\n\s*/g, ' ')}` : ''}`; }),
        'JSON 형식: {"mismatches":[{"k":순번,"why":"한 줄"}]} — 맞는 장은 빼라. 다 맞으면 빈 배열.',
      ].join('\n'),
      { maxOutputTokens: 600, visionPaths: items.map((x) => x.path), signal },
    ).catch(() => null);
    const j = (await ask()) ?? (await ask());
    if (!j || !Array.isArray(j.mismatches)) { say(`카드 실촬영 내용 대조 — 판정 실패(${items.length}칸), 그대로`); return []; }
    if (!j.mismatches.length) say(`카드 실촬영 내용 대조 — ${items.length}칸 모두 맞음`);
    return j.mismatches.flatMap((m) => {
      const k = Math.floor(Number(m?.k));
      return k >= 1 && k <= items.length ? [{ slide: items[k - 1]!.slide, why: String(m?.why ?? '').slice(0, 80) }] : [];
    });
  } catch { say('카드 실촬영 내용 대조 실패(무해) — 그대로'); return []; }
}

/**
 * 비교 판 좌우 맞추기(2026-10-27 배나무 카드 4번 장) — 사진 왼쪽은 작은 재래 배, 오른쪽은 큰 재배 배인데 칸은 왼쪽 '개량종'·오른쪽 '옛 품종'이었다.
 * 칸은 bad 왼쪽·good 오른쪽 고정이고 기획은 사진을 보지 않는다. 사진에 두 대상이 좌우로 갈려 보이고 반대면 칸 순서를 바꾼다(swap).
 * 판정 실패·한쪽만 보임·위아래 배치면 그대로.
 */
export async function alignCompareSides(layout: CardLayout, say: Say, signal?: AbortSignal): Promise<CardLayout> {
  if (!visionCapable()) return layout;
  const slides = [...layout.slides];
  for (const [i, sl] of layout.slides.entries()) {
    if (sl.kind !== 'compare' || !sl.bad || !sl.good || sl.photo?.use !== 'file' || !fs.existsSync(sl.photo.path)) continue;
    const j = await microJSON<{ left?: unknown }>(stdModel(),
      '당신은 카드뉴스 사진 검수자입니다. 사진을 직접 보고 요청된 JSON 스키마만 출력합니다.',
      [
        '사진 속 두 대상 중 어느 쪽이 화면 왼쪽에 있는지 판정하라.',
        `A: ${sl.bad.label} — ${sl.bad.text}`,
        `B: ${sl.good.label} — ${sl.good.text}`,
        '왼쪽에 A, 오른쪽에 B가 보이면 "A". 왼쪽에 B, 오른쪽에 A가 보이면 "B". 두 대상이 좌우로 갈려 보이지 않으면(한쪽만·섞임·위아래) 또는 모르겠으면 "none".',
        'JSON 형식: {"left":"A"|"B"|"none"}',
      ].join('\n'),
      { maxOutputTokens: 60, visionPaths: [sl.photo.path], signal },
    ).catch(() => null);
    if (String(j?.left ?? '').trim().toUpperCase() === 'B') {
      slides[i] = { ...sl, swap: true };
      say(`카드 비교 좌우 — ${i + 1}번 장 사진 왼쪽이 '${sl.good.text}'라 칸 순서를 사진에 맞춤`);
    }
  }
  return { ...layout, slides };
}

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
    if (flagged.length) for (const c of inheritedClaims([...flagged], asKey, 5, source)) drop.add(c.field);
    if (!drop.size) return l;
    say(`카드 칸 사실 대조 — ${drop.size}칸 지움(${[...parity].slice(0, 1).join('').slice(0, 50)})`);
    l = dropFields(l, drop);
    if (parity.length < 5) return l; // 5건 미만이면 다 본 것이다
  }
  return l;
}

/**
 * 겹침 미달 칸 글 뜻 대조(2026-11-03) — 바이그램 포함률은 어미·조사·동의어가 바뀌면 크게 떨어진다
 * ("땅에 심은 나무는 비와 눈으로 어느 정도 해결됩니다" → "노지는 비·눈으로 해결돼요" 0.40). 블루베리 겨울 카드에서
 * 원문을 줄인 칸 15개가 이 이유로 버려져 7장 중 6장이 사진 판으로 내려갔다. 원문 한 문장을 줄인 것뿐인 칸만 살린다.
 * 살린 칸도 뒤의 칸 사실 대조(factCheckFields)를 그대로 거친다. 실패하면 빈 집합(종전대로 버림).
 */
export async function rescueFields(texts: readonly string[], source: string, signal?: AbortSignal): Promise<Set<string>> {
  const list = texts.slice(0, 30);
  if (!list.length || !source.trim()) return new Set();
  const j = await microJSON<{ ok?: unknown }>(stdModel(),
    '당신은 카드뉴스 칸 글 검수자입니다. 요청된 JSON 스키마만 출력합니다.',
    [
      `[블로그 원문]\n${source.slice(0, 6000)}`,
      '',
      '[칸 글]',
      ...list.map((t, i) => `${i + 1}. ${t}`),
      '',
      '각 칸 글이 원문의 한 문장(또는 붙어 있는 두 문장)을 줄이거나 어미·낱말만 바꿔 말한 것인지 판정하라.',
      '통과: 원문이 말한 사실 그대로(동의어 바꿈·어미 바꿈·생략 가능 — 예 "땅에 심은 나무"→"노지", "됩니다"→"돼요").',
      '탈락: 원문에 없는 사실·이유·결과·조건을 더함, 원문의 유보("보통", "~할 수 있다", "경우가 많다")를 단정으로 바꿈, 원문과 뜻이 다름, 원문 여러 곳을 엮어 새 주장을 만듦.',
      '짧은 꼬리말(예 "거실 금지", "가지 탄력")은 원문이 그 내용을 말하면 통과.',
      'JSON 형식: {"ok":[통과한 칸 번호들]}',
    ].join('\n'),
    { maxOutputTokens: 200, signal },
  ).catch(() => null);
  const nums = Array.isArray(j?.ok) ? j.ok.map((x) => Math.floor(Number(x))) : [];
  return new Set(nums.filter((k) => k >= 1 && k <= list.length).map((k) => list[k - 1]!));
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

const SLIDE_PNG = /^slide_\d{2}\.png$/;

/**
 * 새로 찍은 장(tmp)을 카드 폴더로 올린다(순수 파일 작업, 2026-10-26) — 새 장이 하나라도 있을 때만 옛 slide_NN 을 지우고 옮긴다.
 * 없으면 옛 장을 그대로 두고 0 을 돌려준다. tmp 는 끝에 지운다.
 */
export function commitRenderedSlides(dir: string, tmp: string, expected?: number): number {
  try {
    const fresh = fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((f) => SLIDE_PNG.test(f)) : [];
    // 일부만 찍힌 렌더(only 등)면 옛 장을 지우지 않는다 — expected 가 있으면 전부 찍힌 때만 바꾼다(2026-10-26)
    if (!fresh.length || (expected !== undefined && fresh.length !== expected)) return 0;
    for (const f of fs.readdirSync(dir)) if (SLIDE_PNG.test(f)) fs.unlinkSync(path.join(dir, f));
    for (const f of fresh) fs.renameSync(path.join(tmp, f), path.join(dir, f));
    return fresh.length;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무해 */ }
  }
}

/**
 * 렌더 + 결과 정리 — 넘침 잔존은 로그로. 임시 폴더에 찍고 성공했을 때만 옛 slide_NN 과 바꾼다(2026-10-26) —
 * 종전엔 먼저 다 지우고 찍어, card_render.py 가 실패·시간 초과(취소 포함)하면 ready 카드가 0장으로 남았다(수선 경로는 slides:0 까지 기록).
 */
async function renderLayout(dir: string, l: CardLayout, coverNote: string | undefined, say: Say, signal?: AbortSignal): Promise<number> {
  const tmp = path.join(dir, `.render-${Date.now()}`);
  const spec = toRenderSpec(l, (r) => (r?.use === 'file' && insideDir(r.path, dir) ? r.path : undefined), {
    outDir: tmp, fontDir: CARD_FONT_DIR,
    brand: brandDisplay(),
    ...(coverNote ? { coverNote } : {}),
  });
  const specPath = path.join(dir, 'render-spec.json');
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2), 'utf-8');
  const r = await renderCardSpec(specPath, signal);
  if (!r || signal?.aborted) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무해 */ } throw new Error(signal?.aborted ? '취소됨' : '카드 렌더 실패 — card_render.py'); }
  const left = r.slides.filter((s) => s.issues.length);
  if (left.length) say(`카드 렌더 — 넘침 잔존 ${left.map((s) => `${s.n}번(${s.issues[0]})`).join(', ')}`);
  return commitRenderedSlides(dir, tmp, l.slides.length);
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
  // 추가 실촬영 컷(2026-10-15 사장님 제안) — 같은 수종 보관소 영상의 다른 순간. 같은 사진 반복·생성 사진(나무가 달라짐)을 줄인다.
  if (CARD_EXTRA_FRAMES > 0) {
    const real0 = blog.find((b) => b.real);
    const extra = await cardRealFrames({
      topic: o.topic, ...(o.keyword ? { keyword: o.keyword } : {}), cardDir: dir, count: CARD_EXTRA_FRAMES,
      avoid: real0 ? [real0.path] : [], ...(o.signal ? { signal: o.signal } : {}), log: say,
    });
    for (const f of extra) blog.push({ n: blog.length + 1, path: f.path, alt: f.alt, real: true });
  }
  say(`카드 판형 — 블로그 사진 ${blog.length}장(실촬영 ${blog.filter((b) => b.real).length}) · 새 사진 상한 ${CARD_MAX_GEN}장`);

  const sys = '당신은 인스타그램 카드뉴스 디자이너입니다. 요청된 JSON 스키마만 출력합니다.';
  // 칸 글은 근거 미확인 문장을 뺀 원문에서만 뽑는다(2026-10-15) — 칸 검사(normalizeLayout)도 같은 판본으로 봐서 그 문장을 옮긴 칸은 버려진다.
  // 사실 대조(factCheckFields)와 source.md(수정 요청·재검증)는 원문 전체.
  const writerSrc = writerSource(source, o.sourceFlagged ?? []).body;
  try { fs.writeFileSync(path.join(dir, WRITER_SOURCE_FILE), writerSrc, 'utf-8'); } catch { /* 없으면 수정 요청이 source.md 를 쓴다 */ }
  try { fs.writeFileSync(path.join(dir, SOURCE_FLAGGED_FILE), JSON.stringify(o.sourceFlagged ?? []), 'utf-8'); } catch { /* 없으면 수정 요청은 빈 목록 */ }
  const user = layoutPrompt({ plan, source: writerSrc, blog, maxGen: CARD_MAX_GEN, flagged: flaggedForPrompt(o.sourceFlagged ?? []) });
  let raw = await o.callJSON<unknown>(sys, user, 3000);
  if (!raw) raw = await o.callJSON<unknown>(sys, `${user}\n\n반드시 완결된 JSON 하나만 출력하라.`, 3000);
  try { fs.writeFileSync(path.join(dir, 'layout-raw.json'), JSON.stringify(raw, null, 2), 'utf-8'); } catch { /* 진단용 */ }
  const rejected = new Set<string>();
  let layout = normalizeLayout(raw, plan, writerSrc, blog.length, undefined, { rejected });
  const approved = await rescueFields([...rejected], writerSrc, o.signal);
  if (approved.size) {
    layout = normalizeLayout(raw, plan, writerSrc, blog.length, undefined, { approved });
    say(`카드 칸 원문 뜻 대조 — 겹침 미달 ${rejected.size}칸 중 ${approved.size}칸 살림`);
  } else if (rejected.size) say(`카드 칸 원문 뜻 대조 — 겹침 미달 ${rejected.size}칸, 살린 칸 없음`);
  say(`카드 판형 — ${layout.slides.map((s) => s.kind).join('·')}`);
  layout = await factCheckFields(layout, source, o.sourceFlagged ?? [], say, o.signal);

  // 표지 — 실촬영이 있으면 그것, 없으면 기획대로(없으면 첫 블로그 사진).
  const real = blog.find((b) => b.real);
  const s0 = layout.slides[0]!;
  if (real) s0.photo = { use: 'blog', n: real.n };
  else if (!s0.photo && blog[0]) s0.photo = { use: 'blog', n: blog[0].n };
  const coverNote = s0.photo?.use === 'blog' && s0.photo.n === real?.n ? coverNoteFor(real, brandDisplay().name) : undefined;

  // 새 사진 — 글자 없는 실사 + 원문 묘사 검수(숏폼 장면 검수와 같은 함수, 2026-10-12 사장님 "카드뉴스에도 원문 묘사 대조 검수").
  const deduped = dedupeBlogPhotos(layout, CARD_MAX_GEN);
  if (deduped) say(`카드 사진 반복 — 이미 쓴 블로그 사진 ${deduped}자리를 새 사진으로`);
  // 실촬영 내용 대조(2026-10-15 사장님 "첫 장은 괜찮고 나머지는 내용 우선") — 실측: 호두 활착 카드(card_605e40a1c9)에서 큰 나무
  // 수관을 올려다본 컷 위에 "밑동 주변이 꺼져 있나요"가 얹혔다. 표지 밖 실촬영 칸을 비전으로 보고, 그 장 글이 말하는 장면을
  // 보여 주지 않으면 그 칸은 새로 그린다(새 사진 몫 안에서).
  const mism = await realPhotoMismatches(layout, blog, say, o.signal);
  if (mism.length) {
    let gens = 0;
    layout.slides.forEach((sl) => { if (sl.photo?.use === 'gen') gens++; sl.items?.forEach((it) => { if (it.photo?.use === 'gen') gens++; }); sl.photos?.forEach((p) => { if (p.photo?.use === 'gen') gens++; }); });
    const swapped: number[] = [];
    for (const m of mism) {
      if (gens >= CARD_MAX_GEN) break;
      const sl = layout.slides[m.slide]!;
      sl.photo = { use: 'gen', scene: (`${sl.title}${sl.lead ? ` — ${sl.lead.replace(/\s*\n\s*/g, ' ')}` : ''} 를 그대로 보여 주는 장면`).slice(0, 160) };
      gens++; swapped.push(m.slide + 1);
    }
    say(`카드 실촬영 내용 대조 — ${mism.map((m) => `${m.slide + 1}번 장(${m.why.slice(0, 24)})`).join(', ')}${swapped.length ? ` → ${swapped.join(',')}번 장 새로 그림` : ' · 새 사진 몫 소진, 그대로'}`);
  }
  // 판이 내려가 사진 없이 남은 photo 판 — 안 쓴 블로그 사진, 그다음 새 사진(상한 안에서)으로 먼저 채운다(2026-11-03).
  // 실측: 블루베리 겨울 카드(card_734fb18f1d)는 칸 원문 대조로 7장 중 6장이 photo 판으로 내려갔는데 새 사진은 1장만 그렸고
  // (상한 6장), 빈 장은 생성 뒤에야 블로그 사진 3장을 두 번씩 돌려 채워 같은 사진이 두 번 나오고 8번 장은 글만 남았다.
  {
    const used = new Map<number, number>();
    const mark = (r: PhotoRef | undefined): void => { if (r?.use === 'blog') used.set(r.n, (used.get(r.n) ?? 0) + 1); };
    let gens = 0;
    layout.slides.forEach((s) => {
      mark(s.photo); s.items?.forEach((it) => mark(it.photo)); s.photos?.forEach((p) => mark(p.photo));
      if (s.photo?.use === 'gen') gens++; s.items?.forEach((it) => { if (it.photo?.use === 'gen') gens++; }); s.photos?.forEach((p) => { if (p.photo?.use === 'gen') gens++; });
    });
    const filled: number[] = [];
    // photo 판 먼저, 그다음 비교·숫자 판(2026-11-05) — 석류나무 카드(card_f170bba5e0) 6번 비교 판은 사진 없이 위 칸만 그려져
    // 아래 절반이 비었다(판형 지시는 "사진 넣어라"지만 응답이 빠뜨림). 사진 자리가 있는 판은 모두 채운다.
    const order = layout.slides.map((s, i) => ({ s, i })).filter(({ s }) => !s.photo && (s.kind === 'photo' || s.kind === 'compare' || s.kind === 'numbers'))
      .sort((a, b) => Number(a.s.kind !== 'photo') - Number(b.s.kind !== 'photo'));
    order.forEach(({ s, i }) => {
      const fresh = blog.find((b) => !used.get(b.n));
      if (fresh) { s.photo = { use: 'blog', n: fresh.n }; used.set(fresh.n, 1); return; }
      if (gens >= CARD_MAX_GEN) return;
      s.photo = { use: 'gen', scene: (`${s.title}${s.lead ? ` — ${s.lead.replace(/\s*\n\s*/g, ' ')}` : ''} 를 그대로 보여 주는 장면`).slice(0, 160) };
      gens++; filled.push(i + 1);
    });
    filled.sort((a, b) => a - b);
    if (filled.length) say(`카드 빈 사진 판 — ${filled.join(',')}번 장 새로 그림`);
  }
  const gen = collectGen(layout, CARD_MAX_GEN);
  const genPath = new Map<Extract<PhotoRef, { use: 'gen' }>, string>();
  if (gen.length) {
    const known = findSpecies(`${o.keyword ?? ''} ${plan.title}`);
    // 어린 나무 주제(활착·묘목·삽목)면 수종 수형(성목 설명 "큰 교목")을 뺀다(2026-10-15, 숏폼 주인공 나무와 같은 규칙).
    const young = isYoungHero(`${o.keyword ?? ''} ${plan.title}`) || /활착/.test(`${o.keyword ?? ''} ${plan.title}`);
    const subject = known ? speciesAnchor(known, { young }) : undefined;
    // 같은 세트 사진을 참조로(실촬영 먼저, 최대 3장) — 새 사진이 블로그 사진과 다른 나무로 그려지지 않게.
    const setRefs = CONFIG.shortsHeroTree ? [...blog].sort((a, b) => Number(b.real) - Number(a.real)).map((b) => b.path).filter((p) => fs.existsSync(p)).slice(0, 3) : [];
    const prompts = gen.map((g) => genPhotoPrompt(g.ref.scene, g.ref.must, subject, { setRefs: setRefs.length > 0, young }));
    const draftPath = path.join(dir, 'photos-gen-draft.json');
    const manPath = path.join(dir, 'photos-gen-manifest.json');
    fs.writeFileSync(draftPath, JSON.stringify({ imageSlots: gen.map((g, k) => ({ alt: `slide ${g.slide + 1} photo ${k + 1}`, prompt: prompts[k] })) }, null, 2), 'utf-8');
    say(`카드 사진 생성 — ${gen.length}장(글자 없는 실사)`);
    const r = await generateImagesForDraft(draftPath, path.join(dir, 'photos-gen'), manPath,
      { imageStyle: 'photorealistic', limit: gen.length, size: '1024x1536', timeoutMs: 150_000 * gen.length, ...(setRefs.length ? { refImages: setRefs } : {}) }, o.signal);
    let imgs: Array<string | null> = gen.map(() => null);
    try {
      const man = JSON.parse(fs.readFileSync(manPath, 'utf-8')) as { images?: Array<{ file_path?: string; error?: string } | null> };
      imgs = gen.map((_, k) => { const im = man.images?.[k]; return im?.file_path && !im.error && fs.existsSync(im.file_path) ? im.file_path : null; });
    } catch { if (!r.ok) say('카드 사진 생성 실패 — 사진 없는 판으로'); }
    if (imgs.some(Boolean)) {
      const qa = await qaSceneImages({
        dir, images: imgs, scenePrompts: prompts, preset: 'photorealistic', signal: o.signal,
        ...(setRefs.length ? { refImages: setRefs } : {}), // 다시 그릴 때도 같은 세트 사진을 참조로
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
    if (r.use === 'file') return insideDir(r.path, dir) && fs.existsSync(r.path) ? r.path : undefined;
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
  layout = await alignCompareSides(layout, say, o.signal);

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
        const lead = p.body.split('\n').map((x) => x.trim()).filter(Boolean).join('\n'); // 기획 줄바꿈 유지(normalizeLayout 과 같게)
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
  // 칸 글을 뽑을 원문은 근거 미확인 문장을 뺀 판본(2026-10-15) — 수정 요청이 그 문장을 칸으로 되살리지 않게. 옛 카드는 source.md.
  const fullSource = source; // 사실 대조는 원문 전체
  try { source = fs.readFileSync(path.join(dir, WRITER_SOURCE_FILE), 'utf-8') || source; } catch { /* 옛 카드 */ }
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
  let layout = normalizeLayout({ series: saved.series, slides: rawSlides }, plan, source, 0, dir);
  // normalizeLayout 은 표지·마무리 판을 고정한다 — 기존 판(kind)이 다른 장은 저장본 kind 를 따른다(같은 판으로만 수정).
  layout = await factCheckFields(layout, fullSource, readSourceFlagged(dir), say, signal); // 생성 때와 같은 지적 목록
  const count = await renderLayout(dir, layout, saved.coverNote, say, signal);
  if (!count) return null;
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({ ...layout, coverNote: saved.coverNote }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
  return { changed: [...changed].sort((a, b) => a - b), plan };
}
