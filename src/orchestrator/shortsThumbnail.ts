/**
 * 숏폼 디자인 썸네일 — 훅 씬(첫 장면)을 배경으로 그 위에 손글씨 제목+핵심을 gpt-image(edit)로 그려 넣은
 * '시선 끌기' 커버. 카드뉴스 handwritten_poster 와 동일 엔진(openai_image --allow-text, images.edit) 재사용.
 * best-effort — 키 없거나 실패하면 false 를 반환(호출부·엔드포인트가 영상 첫 프레임으로 폴백).
 * AI 가 한글을 그리므로 오타 위험 → 비전 QA 로 검수하고 1회 재생성으로 커버(카드뉴스와 동일 원리).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';
import { microJSON } from './agent';
import { stdModel, visionCapable } from './visionCommon';
import { generateImagesForDraft } from '../tools/blog_skills';

const execFileP = promisify(execFile);

interface ThumbCopy { line1: string; line2: string; points: string[] }

/** 제목을 두 줄로 — 단어(공백) 경계에서만 분할(단어를 중간에서 쪼개지 않음). 단어 하나면 한 줄. 순수. */
export function splitTwoLines(t: string): { line1: string; line2: string } {
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { line1: t, line2: '' };
  const half = t.length / 2;
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - half);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return { line1: words.slice(0, best).join(' '), line2: words.slice(best).join(' ') };
}
/** 설명에서 핵심 포인트 파생(순수) — 문장/구를 짧게 잘라 2~3개. LLM 이 points 를 비우거나 실패했을 때 폴백. */
export function derivePoints(desc: string): string[] {
  return (desc || '').split(/[.。!?\n·]/).map((s) => s.trim()).filter((s) => s.length >= 4 && s.length <= 22).slice(0, 3);
}

/** 썸네일 카피 — 시선 끄는 2줄 제목(단어 온전) + 핵심 2~3줄. LLM 실패·누락 시 제목·설명에서 폴백. */
async function planThumbnailCopy(input: { title: string; description: string; titles?: string[] }, signal?: AbortSignal): Promise<ThumbCopy> {
  const fallback = (): ThumbCopy => {
    const t = (input.title || '').replace(/[,·].*$/, '').trim() || '숏폼';
    return { ...splitTwoLines(t), points: derivePoints(input.description) };
  };
  try {
    const j = await microJSON<{ line1?: unknown; line2?: unknown; points?: unknown }>(
      stdModel(),
      '당신은 유튜브 숏폼 썸네일 카피라이터입니다. 요청 JSON 스키마만 출력합니다.',
      [
        `[제목] ${input.title}`,
        input.description ? `[설명] ${input.description}` : '',
        (input.titles && input.titles.length) ? `[제목 후보] ${input.titles.join(' / ')}` : '',
        '',
        '위 숏폼의 썸네일 문구를 만들어라.',
        '제목: 시선을 확 끄는 2줄. 각 줄은 짧게(공백 포함 8자 이내), 두 줄 합쳐 핵심 메시지. 절대 한 단어를 두 줄에 쪼개지 마라(단어는 통째로 한 줄, 줄바꿈은 단어·어절 경계에서만).',
        '핵심 포인트: 반드시 2~3개. 각 14자 이내, 궁금증·이득 자극. 과장·낚시성 금지, 내용에 근거.',
        'JSON: {"line1":"첫 줄","line2":"둘째 줄","points":["포인트1","포인트2","포인트3"]}',
      ].filter(Boolean).join('\n'),
      { maxOutputTokens: 400, signal },
    );
    const line1 = String(j?.line1 ?? '').trim().slice(0, 12);
    const line2 = String(j?.line2 ?? '').trim().slice(0, 12);
    if (!line1) return fallback();
    let points = (Array.isArray(j?.points) ? j.points : []).map((p) => String(p ?? '').trim().slice(0, 20)).filter(Boolean).slice(0, 3);
    if (!points.length) points = derivePoints(input.description); // LLM 이 포인트 누락 → 설명에서 보강(좌하단 빔 방지)
    return { line1, line2, points };
  } catch { return fallback(); }
}

/** 카피 → gpt-image 프롬프트(실측 검증본). 지정 한국어만, 오타 없이. */
function buildThumbnailPrompt(copy: ThumbCopy): string {
  const pts = copy.points.length ? copy.points.map((p) => `'${p}'`).join(', ') : '';
  const titleLine = copy.line2
    ? `그 위에 손으로 쓴 듯한 굵은 한국어 캘리그래피 제목을 정확히 2줄로 크게 배치한다: 1줄 '${copy.line1}' 는 크림 화이트, 2줄 '${copy.line2}' 는 선명한 노랑. 붓펜 질감에 밑줄 획으로 강조. 각 줄은 지정한 그대로 한 줄에 넣고, 한 단어를 글자 중간에서 쪼개 다음 줄로 넘기지 않는다.`
    : `그 위에 손으로 쓴 듯한 굵은 한국어 캘리그래피 제목 '${copy.line1}' 를 한 줄로 크게 배치한다(크림 화이트 바탕에 노랑 포인트, 붓펜 질감에 밑줄 획). 단어를 글자 중간에서 쪼개지 않는다.`;
  return [
    '세로 유튜브/인스타 썸네일. 참조로 준 사진을 배경으로 그대로 사용하고, 상단 45%를 부드러운 검정 그라데이션으로 살짝 덮어 글자 가독성을 확보한다.',
    titleLine,
    pts ? `왼쪽 하단에는 작은 손글씨로 핵심 ${copy.points.length}줄: ${pts}. 밑줄과 동그라미로 포인트.` : '',
    '별·구름 모양의 작은 손그림 낙서를 여백에 소량 추가. 밝고 생기있는 무드.',
    '중요: 모든 텍스트(제목·핵심 문구)는 좌우·상하 가장자리에서 넉넉히 안전 여백을 두고 화면 안쪽 중앙 영역에만 배치한다. 글자가 가장자리에 닿거나 프레임 밖으로 잘리지 않게 한다.',
    '한글 맞춤법을 정확히 지키고 글자가 깨지거나 오타가 없게 한다. 지정한 한국어 텍스트만 사용하고 영어나 의미 없는 글자는 넣지 않는다.',
  ].filter(Boolean).join(' ');
}

/** 비전 QA — 이미지의 한글이 기대 문구대로 정확한지. 비전 불가/판정 실패면 통과(파이프라인 차단 방지). */
async function qaKoreanText(imagePath: string, expected: string, signal?: AbortSignal): Promise<boolean> {
  if (!visionCapable()) return true;
  const j = await microJSON<{ ok?: boolean }>(
    stdModel(),
    '당신은 한국어 텍스트 검수자입니다. JSON 만 출력합니다.',
    `이 썸네일 이미지에 그려진 한국어 글자에 오타·깨진 자소·이상한 글자가 있는지 판정하라. 기대 문구(순서 무관): ${expected}. 모두 정확하면 ok=true, 하나라도 깨졌으면 ok=false. JSON: {"ok":true}`,
    { maxOutputTokens: 150, signal, visionPaths: [imagePath] },
  ).catch(() => null);
  return j?.ok !== false;
}

/** png → dir/thumbnail.jpg 변환(ffmpeg) — 임시파일에 쓰고 원자적 rename(찢긴 JPEG·부분 기록 방지). */
async function toThumbnailJpg(pngPath: string, dir: string, signal?: AbortSignal): Promise<void> {
  const tmp = path.join(dir, `.thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  await execFileP('ffmpeg', ['-nostdin', '-y', '-i', pngPath, '-q:v', '3', tmp], { timeout: 20_000, signal });
  fs.renameSync(tmp, path.join(dir, 'thumbnail.jpg')); // 같은 파일시스템 → 원자적 교체
}

/** 매니페스트 첫 이미지 — 슬롯 error(생성 실패)면 남아있는 stale 파일이라도 무시(형제 shorts.ts 가드와 동일). */
function manifestFirstImage(manifestPath: string): string | null {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { images?: Array<{ file_path?: string; error?: unknown }> };
    const im = m.images?.[0];
    if (!im || im.error) return null;
    return im.file_path && fs.existsSync(im.file_path) ? im.file_path : null;
  } catch { return null; }
}

/**
 * 훅 씬 배경 위에 디자인 썸네일 생성 → dir/thumbnail.jpg. 성공 true / 폴백해야 하면 false.
 * hookImage 없거나 키 없으면 false(영상 프레임 폴백). QA 2회 실패 시 마지막 생성본 사용(디자인 우선 방침).
 * 작업물은 실행별 고유 디렉터리(.thumb/<run>)에 격리하고 종료 시 정리 — 동시 실행·stale 재사용 방지. 어떤 예외도 밖으로 던지지 않음(폴백 유도).
 */
export async function generateDesignedThumbnail(input: {
  dir: string; title: string; description: string; titles?: string[]; hookImage: string | null; signal?: AbortSignal;
}): Promise<boolean> {
  if (!CONFIG.openaiApiKey) return false;
  if (!input.hookImage || !fs.existsSync(input.hookImage)) return false;
  const work = path.join(input.dir, '.thumb', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.mkdirSync(work, { recursive: true });
    const copy = await planThumbnailCopy(input, input.signal);
    const prompt = buildThumbnailPrompt(copy);
    const expected = [copy.line1, copy.line2, ...copy.points].filter(Boolean).join(' / ');
    const draftPath = path.join(work, 'draft.json');
    fs.writeFileSync(draftPath, JSON.stringify({ topic: copy.line1, imageSlots: [{ alt: '썸네일', prompt }] }), 'utf-8');

    let lastPng: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const outDir = path.join(work, `out${attempt}`);
      const manifest = path.join(work, `m${attempt}.json`);
      try {
        await generateImagesForDraft(draftPath, outDir, manifest,
          { imageStyle: 'photorealistic', allowText: true, size: '1024x1536', limit: 1, refImages: [input.hookImage], topic: copy.line1, timeoutMs: 150_000 },
          input.signal);
      } catch { continue; } // 이 시도 실패 → 다음 시도(또는 폴백)
      const png = manifestFirstImage(manifest); // 실패 슬롯이면 null → 이 시도 이미지 안 씀
      if (!png) continue;
      lastPng = png;
      if (await qaKoreanText(png, expected, input.signal)) { await toThumbnailJpg(png, input.dir, input.signal); return true; }
    }
    if (lastPng) { await toThumbnailJpg(lastPng, input.dir, input.signal); return true; } // QA 못 넘겨도 디자인본 우선
    return false;
  } catch { return false; } // 어떤 실패도 밖으로 던지지 않음 — 호출부(완성부·엔드포인트)는 프레임 폴백
  finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* 정리 실패 무해 */ } }
}
