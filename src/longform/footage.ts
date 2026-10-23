/**
 * 롱폼 시범 영상 구간 배정(순수) — 세그먼트마다 보관소 영상 한 구간, 없으면 카드 화면.
 * 숏폼의 "한 편 한 파일" 규칙과 달리 한 파일을 겹치지 않는 여러 구간으로 나눠 쓴다(설계 '화면').
 */
import { CHAPTER_SPECIES, FRUIT_SPECIES, type ChapterId, type ChapterPool } from './script';

/** 영상 시작·끝 손떨림 여백. */
export const EDGE_SEC = 0.5;

export interface MediaItem { id: string; file: string; kind: string; seconds: number; species?: string }

export type Shot =
  | { segId: string; mediaId: string; file: string; startSec: number; seconds: number }
  | { segId: string; cardOnly: true };

/** 장 영상 후보 — pools(대본 chapterPools)가 없으면 시범 CHAPTER_SPECIES(모르는 장은 과실나무 일반 장). */
const poolOf = (chapter: ChapterId, pools?: Record<string, ChapterPool>): ChapterPool => {
  if (pools?.[chapter]) return pools[chapter]!;
  const sp = CHAPTER_SPECIES[chapter];
  return Array.isArray(sp) ? { species: sp, own: true } : { species: FRUIT_SPECIES, own: false };
};
const inPool = (x: MediaItem, species: string[] | null): boolean => !!x.species && (species === null || species.includes(x.species));

export function planFootage(
  segs: Array<{ id: string; chapter: ChapterId; seconds: number; species?: string[] }>, media: MediaItem[], pools?: Record<string, ChapterPool>,
): Shot[] {
  const cursor = new Map<string, number>();
  const byId = new Map<string, Shot>();
  let prev: string | null = null;
  const left = (x: MediaItem) => x.seconds - EDGE_SEC - (cursor.get(x.id) ?? EDGE_SEC);
  const place = (seg: (typeof segs)[number]) => {
    // 세그먼트가 특정 수종을 말하면 그 수종만 — 다른 수종 영상 위에 이름을 얹지 않는다(설계 '화면').
    const pool = seg.species ?? poolOf(seg.chapter, pools).species;
    const fits = media.filter((x) => x.kind === 'video' && inPool(x, pool) && left(x) >= seg.seconds - 1e-6);
    const notPrev = fits.filter((x) => x.id !== prev);
    const pick = (notPrev.length ? notPrev : fits).sort((a, b) => left(b) - left(a))[0];
    if (!pick) {
      byId.set(seg.id, { segId: seg.id, cardOnly: true });
      prev = null;
      return;
    }
    const start = cursor.get(pick.id) ?? EDGE_SEC;
    byId.set(seg.id, { segId: seg.id, mediaId: pick.id, file: pick.file, startSec: start, seconds: seg.seconds });
    cursor.set(pick.id, start + seg.seconds);
    prev = pick.id;
  };
  // 수종 장이 먼저 자기 영상을 가져간다 — 일반 장이 모자란 수종 영상을 먼저 써 버리지 않게(리뷰 I2).
  for (const seg of segs) if (poolOf(seg.chapter, pools).own) place(seg);
  prev = null;
  for (const seg of segs) if (!poolOf(seg.chapter, pools).own) place(seg);
  return segs.map((s) => byId.get(s.id)!);
}

type VideoShot = Extract<Shot, { mediaId: string }>;

/**
 * 중간 컷(숏폼 cutAtFrame 과 같은 장치) — 일반 장의 긴 세그먼트(minSec 이상)에 다른 파일의 남은 구간을
 * 절반 길이로 하나 더 잡는다. 이미 쓴 구간 뒤(파일별 최대 끝)에서만 잡아 겹치지 않는다.
 * 수종 장은 영상이 모자라 건드리지 않는다.
 */
export function planMidCuts(
  segs: Array<{ id: string; chapter: ChapterId; seconds: number; species?: string[] }>, shots: Shot[], media: MediaItem[], minSec = 7,
  pools?: Record<string, ChapterPool>,
): Record<string, VideoShot> {
  const end = new Map<string, number>();
  for (const s of shots) if ('mediaId' in s) end.set(s.mediaId, Math.max(end.get(s.mediaId) ?? 0, s.startSec + s.seconds));
  const shotOf = new Map(shots.map((s) => [s.segId, s]));
  const out: Record<string, VideoShot> = {};
  for (const seg of segs) {
    const main = shotOf.get(seg.id);
    // 특정 수종을 말하는 세그먼트는 건너뛴다 — 두 번째 구간이 다른 수종이면 이름과 화면이 어긋난다(리뷰 R3-I1).
    const pool = poolOf(seg.chapter, pools);
    if (pool.own || seg.species || seg.seconds < minSec || !main || !('mediaId' in main)) continue;
    const half = seg.seconds / 2;
    const left = (x: MediaItem) => x.seconds - EDGE_SEC - Math.max(EDGE_SEC, end.get(x.id) ?? 0);
    const pick = media
      .filter((x) => x.kind === 'video' && inPool(x, pool.species) && x.id !== main.mediaId && left(x) >= half - 1e-6)
      .sort((a, b) => left(b) - left(a))[0];
    if (!pick) continue;
    const start = Math.max(EDGE_SEC, end.get(pick.id) ?? 0);
    out[seg.id] = { segId: seg.id, mediaId: pick.id, file: pick.file, startSec: start, seconds: half };
    end.set(pick.id, start + half);
  }
  return out;
}
