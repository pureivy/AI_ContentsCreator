/**
 * 롱폼 편 폴더(data/longform/<dir>/) 입출력 — 대본 읽기·쓰기(시범 이관 포함), 보관소 영상 목록, 실촬영 재고.
 *
 * 시범(pilot-2026-10-19) 대본은 2026-10-22 일반화 전에 만들어져 금지어·원문 글 id 가 데이터에 없다.
 * 읽을 때만 채운다(파일은 고치지 않는다) — 시범 검사·다시 렌더가 예전과 같은 결과를 낸다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { EDGE_SEC, type MediaItem } from './footage';
import { PILOT_BANNED_WORDS, type LongformScript } from './script';
import { SOURCE_PIECES } from './source';

export const PILOT_DIR_NAME = 'pilot-2026-10-19';

export const longformRoot = (dataDir = CONFIG.dataDir): string => path.join(dataDir, 'longform');

/** 시범 이관(순수) — 시범 폴더 대본에만 금지어·원문 글 id 를 채운다. 다른 편은 그대로. */
export function migrateScript(s: LongformScript, dirName: string): LongformScript {
  if (dirName !== PILOT_DIR_NAME) return s;
  return { ...s, bannedWords: s.bannedWords ?? PILOT_BANNED_WORDS, sourcePieceIds: s.sourcePieceIds ?? [...SOURCE_PIECES] };
}

export function loadEpisodeScript(dir: string): LongformScript {
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8')) as LongformScript;
  return migrateScript(s, path.basename(dir));
}

/** 대본 저장(원자적 교체) — 발음 바꿔 쓰기·사실 확인이 문장을 고칠 때마다. */
export function saveEpisodeScript(dir: string, s: LongformScript): void {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'script.json');
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(s, null, 2));
  fs.renameSync(`${f}.tmp`, f);
}

/** 사람이 읽는 대본 평문(script.txt). */
export function scriptText(s: LongformScript): string {
  return `${s.title}\n\n${s.chapters.map((c) => `## ${c.title}\n\n${c.segments.map((g) => g.narration).join('\n')}`).join('\n\n')}\n`;
}

/**
 * 보관소 영상 후보 — 목록에는 있어도 파일이 정리된 항목이 있다(실측 2026-10-19: 영상 101개 중 4개) — 있는 파일만.
 * brand 를 주면 그 브랜드 영상만(시범 CLI 는 주지 않는다 — 시범 클립 배정이 예전과 같게).
 */
export function loadMediaVideos(dataDir = CONFIG.dataDir, brand?: string): MediaItem[] {
  let listed: Array<MediaItem & { brand?: string }> = [];
  try { listed = JSON.parse(fs.readFileSync(path.join(dataDir, 'media', 'index.json'), 'utf8')); } catch { return []; }
  return listed.filter((x) => x && x.kind === 'video' && typeof x.seconds === 'number' && x.seconds > 0
    && (!brand || !x.brand || x.brand === brand) && fs.existsSync(x.file));
}

/** 수종별 실촬영 쓸 수 있는 초(순수) — 앞뒤 손떨림 여백을 뺀다. 0초 수종은 없다(작가가 수종 장을 만들지 않게). */
export function footageInventory(media: readonly MediaItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of media) {
    if (m.kind !== 'video' || !m.species) continue;
    const usable = m.seconds - 2 * EDGE_SEC;
    if (usable > 0) out[m.species] = Math.round(((out[m.species] ?? 0) + usable) * 10) / 10;
  }
  return out;
}
