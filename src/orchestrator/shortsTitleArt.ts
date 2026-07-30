/**
 * 쇼츠 상단 제목 캘리 — 썸네일과 같은 카피를 한 줄 캘리로 순수 검은 배경 위에 생성(gpt-image)한 뒤
 * 로컬 휘도 매트(title_matte.py)로 투명 PNG 화 → 영상 상단 고정 오버레이 에셋(dir/title-art.png).
 * gpt-image-2 는 투명 배경 미지원(실측 400)이고 gpt-image-1 투명 모드는 한글 오타·후광이 생겨,
 * 검은 단색 배경 + 스크린 합성 역산이 신뢰 경로다(사용자 확정 2026-07-30).
 * best-effort — 키 없음·생성 실패·매트 실패 모두 null(오버레이 없이 렌더, 파이프라인 차단 없음).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';
import { manifestFirstImage, planThumbnailCopy, qaKoreanText } from './shortsThumbnail';
import type { ThumbCopy } from './shortsThumbnail';
import { generateImagesForDraft } from '../tools/blog_skills';

const execFileP = promisify(execFile);

/** 카피 → 검은 배경 캘리 프롬프트(PoC 실측 검증본 2026-07-30 — 오타 없음·후광 없음·낙서 온전).
 *  영상 오버레이는 항상 한 줄 — 2줄은 상한 박스(26%) 안에서 본문 카드를 가리고, 가로 캔버스(1536×1024)엔
 *  한 줄 조판이 글자도 커져 오타·매트 품질에 유리하다. 썸네일 2줄 레이아웃과 별개(문구는 공유). */
export function buildTitleArtPrompt(copy: ThumbCopy): string {
  const titleLine = copy.line2
    ? `굵은 한국어 붓펜 캘리그래피 제목을 정확히 한 줄로 크게 그린다: '${copy.line1}' 는 크림 화이트, 바로 이어서 같은 줄에 '${copy.line2}' 는 선명한 노랑(두 문구를 줄바꿈 없이 하나의 줄로 이어 쓴다). 진짜 붓으로 쓴 붓글씨(획 끝이 갈라지고 흘림·삐침이 살아있는 획) — 크레용체·색연필체·둥근 마커체 금지.`
    : `굵은 한국어 붓펜 캘리그래피 제목 '${copy.line1}' 를 한 줄로 크게 그린다(크림 화이트). 진짜 붓으로 쓴 붓글씨(획 끝이 갈라지고 흘림·삐침이 살아있는 획) — 크레용체·색연필체·둥근 마커체 금지.`;
  return [
    '완전히 순수한 검은색(#000000) 단색 배경 위에,',
    titleLine,
    '제목 아래에 밑줄 획으로 강조. 여백에 작은 손그림 낙서(별·구름·반짝임)를 2~3개만 작게 추가한다.',
    '글로우·후광·번짐·그림자·빛무리는 절대 넣지 않는다 — 선명하고 또렷한 획만. 배경은 어떤 무늬도 없는 순수 검정.',
    '한글 맞춤법을 정확히 지키고 글자가 깨지거나 오타가 없게 한다. 지정한 한국어 텍스트만 사용한다.',
  ].join(' ');
}

/** 검은 배경 PNG → 투명 매트 PNG(title_matte.py). 실패 시 false.
 *  임시 파일은 srcPng 옆(작업 디렉터리 — finally 에서 통째로 정리됨)에 써서 프로세스 급사 시 고아를 남기지 않는다. */
async function toTransparentMatte(srcPng: string, outPng: string, signal?: AbortSignal): Promise<boolean> {
  const script = path.join(CONFIG.blogScriptsDir, 'title_matte.py');
  const tmp = path.join(path.dirname(srcPng), `matte-${Date.now()}.png`);
  try {
    await execFileP(CONFIG.blogPython, [script, srcPng, tmp], { timeout: 30_000, signal });
    fs.renameSync(tmp, outPng); // 같은 파일시스템 → 원자적 교체
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 무해 */ }
    return false;
  }
}

/**
 * 제목 캘리 에셋 생성 → { imagePath: dir/title-art.png, copy }. 실패·비활성 시 null.
 * copy 는 이후 generateDesignedThumbnail 에 넘겨 썸네일 문구와 일치시킨다.
 * QA 2회 실패 시 마지막 생성본 사용(썸네일과 동일한 디자인 우선 방침).
 */
export async function generateTitleArt(input: {
  dir: string; title: string; description: string; titles?: string[]; signal?: AbortSignal;
}): Promise<{ imagePath: string; copy: ThumbCopy } | null> {
  if (!CONFIG.openaiApiKey) return null;
  // 매트 전제조건을 생성 전에 검사 — 파이썬/스크립트가 없으면 이미지 생성비(최대 2회)만 태우고 버리게 된다.
  if (!CONFIG.blogPython || !fs.existsSync(path.join(CONFIG.blogScriptsDir, 'title_matte.py'))) return null;
  const work = path.join(input.dir, '.title', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.mkdirSync(work, { recursive: true });
    const copy = await planThumbnailCopy(input, input.signal);
    const prompt = buildTitleArtPrompt(copy);
    const expected = [copy.line1, copy.line2].filter(Boolean).join(' / ');
    const draftPath = path.join(work, 'draft.json');
    fs.writeFileSync(draftPath, JSON.stringify({ topic: copy.line1, imageSlots: [{ alt: '제목 캘리', prompt }] }), 'utf-8');

    let lastPng: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const outDir = path.join(work, `out${attempt}`);
      const manifest = path.join(work, `m${attempt}.json`);
      try {
        await generateImagesForDraft(draftPath, outDir, manifest,
          { imageStyle: 'calligraphy', allowText: true, size: '1536x1024', limit: 1, topic: copy.line1, timeoutMs: 150_000 },
          input.signal);
      } catch { continue; }
      const png = manifestFirstImage(manifest);
      if (!png) continue;
      lastPng = png;
      if (await qaKoreanText(png, expected, input.signal)) break;
    }
    if (!lastPng) return null;
    const out = path.join(input.dir, 'title-art.png');
    if (!(await toTransparentMatte(lastPng, out, input.signal))) return null;
    // 카피 영속화 — 수동 썸네일 재생성 엔드포인트가 영상 속 캘리와 같은 문구를 재사용할 수 있게(실패 무해).
    try { fs.writeFileSync(path.join(input.dir, 'title-copy.json'), JSON.stringify(copy), 'utf-8'); } catch { /* 무해 */ }
    return { imagePath: out, copy };
  } catch { return null; } // 어떤 실패도 밖으로 던지지 않음 — 오버레이 없이 렌더
  finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* 정리 실패 무해 */ } }
}
