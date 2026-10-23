/**
 * 롱폼 유튜브 올릴 글(2026-10-20) — 챕터 타임스탬프·설명 조립. 결정적(LLM 없음).
 * 유튜브 챕터 규칙: 첫 줄 0:00, 3개 이상, 각 10초 이상. 설명에 < > 는 API 가 거절한다.
 */
import { CHAPTER_SPECIES, type Chapter, type ChapterId } from './script';

export const YT_DESC_MAX = 5000;
const CHAPTER_MIN_SEC = 10;
const CHAPTERS_MIN = 3;

export function fmtChapterTime(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${Math.floor(t / 60)}:${ss}`;
}

type Start = { id: ChapterId; title: string; startFrame: number };

/** 챕터 이름 — ytLabel(작가가 쓴 검색형 이름) 우선, 없으면 장 제목. 시범(장 수종이 데이터에 없음)만 CHAPTER_SPECIES 로 수종·과일나무 접두. */
function labelOf(start: Start, ch: Chapter | undefined): string {
  if (ch?.ytLabel?.trim()) return ch.ytLabel.trim();
  const title = start.title;
  const sp = ch?.species !== undefined ? (ch.species.length ? ch.species : null) : CHAPTER_SPECIES[start.id];
  if (!sp) return title;
  if (sp === 'any-fruit') return /과일나무|과실나무/.test(title) ? title : `과일나무 ${title}`;
  const name = sp[0]!;
  // '매실나무' 장에 '매실 — …' 제목이 오므로 '나무' 뗀 어간으로도 비교한다.
  const stem = name.replace(/나무$/, '');
  return title.includes(name) || title.includes(stem) ? title : `${name} ${title}`;
}

export function buildChapters(
  chapterStarts: Start[], scriptChapters: Chapter[], fps = 30, totalFrames?: number,
): { lines: string[]; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map(scriptChapters.map((c) => [c.id, c]));
  if (chapterStarts.length < CHAPTERS_MIN) problems.push(`챕터 ${chapterStarts.length}개 — 유튜브는 3개 이상 필요`);
  if (chapterStarts[0] && chapterStarts[0].startFrame !== 0) problems.push('첫 챕터가 0:00 이 아님 — 0:00 으로 맞춤');
  const lines = chapterStarts.map((c, i) => {
    const sec = i === 0 ? 0 : c.startFrame / fps;
    const label = labelOf(c, byId.get(c.id));
    const next = chapterStarts[i + 1]?.startFrame ?? totalFrames;
    if (next !== undefined && (next - c.startFrame) / fps < CHAPTER_MIN_SEC) problems.push(`"${label}" 챕터가 ${CHAPTER_MIN_SEC}초 미만`);
    return `${fmtChapterTime(sec)} ${label}`;
  });
  return { lines, problems };
}

export function buildYoutubeDescription(o: { keyLine: string; chapters: string[]; hashtags: string[]; blogUrl?: string }): string {
  const parts = [o.keyLine.trim(), '', '챕터', ...o.chapters];
  if (o.blogUrl) parts.push('', `블로그 글: ${o.blogUrl}`);
  const tags = o.hashtags.map((h) => h.trim().replace(/^#*/, '#').replace(/\s+/g, '')).filter((h) => h.length > 1);
  if (tags.length) parts.push('', tags.join(' '));
  return parts.join('\n').replace(/[<>]/g, '').slice(0, YT_DESC_MAX);
}

/** 유튜브 태그(순수) — 해시태그(# 뗌) + 장 수종 대표 이름, 중복 없이 15개까지. */
export function buildYoutubeTags(hashtags: readonly string[], chapters: readonly Chapter[]): string[] {
  const raw = [...hashtags.map((h) => h.replace(/^#+/, '').replace(/\s+/g, '')), ...chapters.map((c) => c.species?.[0] ?? '')];
  return [...new Set(raw.map((t) => t.trim()).filter((t) => t.length > 1))].slice(0, 15);
}

/** 올릴 글 한 벌(순수) — 제목·설명(챕터 포함)·태그·점검 사항. 렌더 뒤 youtube.txt 와 레코드(ytTitle 등)에 같은 값을 쓴다. */
export function buildYoutubeMeta(
  script: { title: string; ytKeyLine?: string; ytHashtags?: string[]; chapters: Chapter[] },
  tl: { chapterStarts: Start[]; totalFrames: number }, fps = 30,
): { title: string; description: string; tags: string[]; problems: string[] } {
  const yt = buildChapters(tl.chapterStarts, script.chapters, fps, tl.totalFrames);
  const description = buildYoutubeDescription({ keyLine: script.ytKeyLine ?? script.title, chapters: yt.lines, hashtags: script.ytHashtags ?? [] });
  return { title: script.title, description, tags: buildYoutubeTags(script.ytHashtags ?? [], script.chapters), problems: yt.problems };
}
