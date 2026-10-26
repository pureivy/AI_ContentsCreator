/**
 * 저장공간 정리(2026-09-10 사용자 확정) — 매일 새벽 1회 + 수동(POST /maintenance/janitor).
 *
 * 배경(실측 2026-09-10): data/ 23G, 디스크 88%. 하루 470MB 씩 늘어 한 번 지우는 걸로는 안 되고 규칙이 필요했다.
 *  · 쇼츠 11.9G — 원본 영상 5.5 · 씬 이미지 3.3 · 다운로드 캐시 1.5 · 참조 0.6 · 클립 0.5
 *  · 카드뉴스 6.7G — 배경·레퍼런스 3.8 · 슬라이드 2.9
 *  · 세션 2.5G — 이미지 2.3(실제 쓴 것 0.6, 후보 0.6, 글과 연결 안 된 옛 세션 1.2)
 *  · 색인에 없는 고아 폴더 73개 4.1G, 휴지통 1.2G
 *
 * 규칙(전부 data/.trash 를 거쳐 trashDays 뒤 영구 삭제 — 삭제 핸들러의 trashContentFiles 와 같은 원칙):
 *  1) 즉시·손실 없음: 색인에 없는 고아 폴더 / 참조 사본(refs·_refnorm) / 다운로드 캐시(download.mp4, 누르면 다시 만든다) /
 *     렌더 잔여(remotion/bundle·public) / 모션그래픽 작업 중간물(motion-*의 바탕 프레임·번들·미리보기, 2026-10-22).
 *  2) 발행 keepDays 뒤: 씬 이미지·클립·낭독 mp3·세그먼트·모션그래픽 작업 폴더·모션그래픽 전 원본(쇼츠), 배경·레퍼런스(카드뉴스), 매니페스트에 없는 후보 이미지·
 *     스크린샷(블로그 세션). 수정요청 재조립이 발행 뒤엔 안 쓰이는 것들이다. clips/sources.json 은 남긴다(보관소 사용 현황이 읽는다).
 *  3) 미발행 staleDays 이상 쇼츠(ready·error): 버린 편으로 보고 색인에서 빼고 폴더는 휴지통으로(사용자 확정 "30일 넘은 쇼츠 버린 것").
 *  4) 글과 연결 안 된 세션 staleDays 이상: 통째로 휴지통(사용자 확정 "지워도 됨").
 *  5) 발행 끝난 쇼츠의 final.mp4 → preview.mp4 교체(shortsArchive 정책)를 여기서도 돈다 — 채널 분리 뒤 조건이 안 맞아 멈춰 있던 것.
 *  6) 롱폼(2026-10-22): 렌더 잔여(remotion/bundle·public)·스틸·장면 에이전트 작업물(scenes/work·stills·.render)은 항상,
 *     유튜브 발행 keepDays 뒤엔 낭독(audio)·클립(clips)·그림(mg·scenes)·remotion·remotion-entry 폴더. final.mp4·thumbnail.jpg·script.json·timeline.json·subtitles.srt·youtube.txt·sources.md·기록 json 은 남긴다. 제작 중인 편은 건너뛴다.
 *
 * 남기는 것: 발행 편의 미리보기 영상·슬라이드·썸네일·대본·기록(json/srt/txt), 보관소 원본(data/media), 성과 시계열.
 * 진행 중인 런·생성 중인 편은 건드리지 않는다. 전 구간 fail-open — 한 항목이 실패해도 나머지는 계속한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { humanBytes } from '../util/prune';
import { releaseBlogFramesOfRemovedRun } from '../content/blogFrames';
import { isStoreFileCorrupt } from '../util/jsonStore';

export interface JanitorShort {
  id: string; stage: string; platform?: string;
  youtubeId?: string; igReelId?: string; metaPublishedTs?: string; youtubeTs?: string; videoArchivedTs?: string;
  /** 네이버 클립(2026-10-02) — 클립에만 올라간 편도 발행된 것이다(미발행 30일 삭제 대상이 아니다). */
  naverClipNo?: string; naverClipTs?: string;
  createdTs: string; updatedTs?: string;
}
export interface JanitorCard { id: string; stage: string; igMediaId?: string; fbPostId?: string; metaPublishedTs?: string; createdTs: string; updatedTs?: string }
export interface JanitorPiece { id: string; runId?: string; publishedTs?: string; publishedUrl?: string }
/** 롱폼 레코드(2026-10-22) — dir 은 data/longform/ 기준 폴더 이름. */
export interface JanitorLongform { id: string; dir: string; stage: string; youtubeId?: string; youtubeTs?: string }

export interface JanitorDeps {
  dataDir: string;
  sessionsDir: string;
  shorts: () => JanitorShort[];
  cards: () => JanitorCard[];
  pieces: () => JanitorPiece[];
  /** 색인에서 제거(예고 정리 포함) — 규칙 3. */
  removeShort: (id: string) => void;
  isShortRunning: (id: string) => boolean;
  isSessionRunning: (runId: string) => boolean;
  /** final→preview 교체. 회수 바이트(0 = 조건 미충족·이미 됨·실패). */
  archiveShort: (id: string) => Promise<number>;
  /** 미리보기·스틸 같은 작업 산출 폴더(예: out/) — keepDays 지난 항목은 휴지통으로. 코드가 읽지 않는 스크래치다(2026-09-10). */
  scratchDirs?: string[];
  /** 롱폼 레코드(없으면 롱폼 정리 안 함) · 지금 만드는 편인가. */
  longform?: () => JanitorLongform[];
  isLongformRunning?: (id: string) => boolean;
  /**
   * 색인이 깨졌나(2026-10-26) — 깨진 색인은 빈 목록으로 뜨므로 고아 규칙이 폴더를 통째로 휴지통에 보낸다.
   * 안 주면 util/jsonStore 의 깨짐 기억을 기본 경로(dataDir/{shorts,cardnews,pieces}/index.json)로 본다.
   */
  storeCorrupt?: () => { shorts?: boolean; cards?: boolean; pieces?: boolean };
  log?: (m: string) => void;
}

export interface JanitorOpts {
  now?: Date;
  /** true 면 옮기지 않고 계획·회수량만 낸다. */
  dryRun?: boolean;
  /** 발행 뒤 중간 산출물을 남겨 두는 일수(기본 14). */
  keepDays?: number;
  /** 미발행 쇼츠·미연결 세션을 버린 것으로 보는 일수(기본 30). */
  staleDays?: number;
  /** 휴지통 보관 일수(기본 7) — 지나면 영구 삭제. */
  trashDays?: number;
}

export interface JanitorReport {
  dryRun: boolean;
  /** 라벨별 휴지통 이동(또는 계획) 건수·바이트. */
  moved: Record<string, { n: number; bytes: number }>;
  /** 휴지통 영구 삭제. */
  purged: { n: number; bytes: number };
  /** final→preview 교체. */
  archived: { n: number; bytes: number };
  /** 색인에서 뺀 미발행 쇼츠 id. */
  deletedShorts: string[];
  /**
   * 고아 규칙 안전장치가 멈춘 범주(2026-10-26) — 비어 있지 않으면 사람에게 알릴 일이다(색인 깨짐·대량 삭제 직전).
   * category: orphan-shorts | orphan-cardnews | unlinked-sessions.
   */
  orphanGuard: Array<{ category: string; reason: string; candidates: number; folders: number }>;
  errors: string[];
  /** 이번 실행으로 돌려받는(또는 계획) 총 바이트 = moved + purged + archived. */
  totalBytes: number;
}

const DAY = 86_400_000;

/** 고아 규칙 한 번에 치울 수 있는 폴더 몫(2026-10-26) — 넘으면 색인 쪽 사고로 보고 그 범주를 통째로 멈춘다. */
export const ORPHAN_MAX_SHARE = 0.2;
/** 이 개수까지는 몫과 무관하게 치운다 — 폴더가 몇 개 없는 범주(새 브랜드·시험 데이터)에서 고아 1~2개가 영영 안 치워지지 않게. */
export const ORPHAN_MIN_ALLOWED = 3;
/** 크래시 잔여물(되돌림 사본·임시 렌더·클립 재배열 임시 파일)을 남겨 두는 일수 — 만드는 중인 작업의 것을 치우지 않게. */
export const LEFTOVER_DAYS = 2;

/**
 * 고아 규칙 안전장치(순수, 2026-10-26) — 멈출 이유(사람용 문장) 또는 null.
 * 색인이 깨졌거나, 비었는데 폴더가 있거나, 한 번에 몫(20%)·최소 허용(3개)을 넘게 치우게 되면 멈춘다.
 * 정상 운영에선 하루 고아가 몇 개뿐이라(재시작·삭제 버튼 직후) 몫을 넘는 건 색인 쪽 사고다.
 */
export function orphanGuardReason(o: { corrupt: boolean; indexSize: number; folders: number; candidates: number }): string | null {
  if (o.candidates <= 0) return null;
  if (o.corrupt) return '색인이 깨져 이번 실행 동안 믿을 수 없음';
  if (o.indexSize === 0 && o.folders > 0) return `색인이 비었는데 폴더가 ${o.folders}개 있음`;
  if (o.candidates > Math.max(ORPHAN_MIN_ALLOWED, o.folders * ORPHAN_MAX_SHARE)) return `한 번에 ${o.candidates}/${o.folders}개(${Math.round(ORPHAN_MAX_SHARE * 100)}% 초과)를 치우게 됨`;
  return null;
}

/** 쇼츠 폴더의 크래시 잔여물(순수) — 이름이 되돌림 사본(.<파일>.revise.bak·.cap.bak, orchestrator/shorts backupFiles)인가. */
export const isShortBackupLeftover = (name: string): boolean => /^\.[^/]+\.(revise|cap)\.bak$/.test(name);
/** clips/ 의 재배열 임시 파일(.realign-user_02.mp4 등, orchestrator/shorts 씬 재배열). */
export const isRealignLeftover = (name: string): boolean => /^\.realign-.+\.mp4$/.test(name);
/** 카드뉴스 폴더의 임시 렌더 폴더(.render-<ms>, orchestrator/cardHtmlJob renderLayout). */
export const isCardRenderLeftover = (name: string): boolean => /^\.render-\d+$/.test(name);

/** ts 로부터 지난 일수(순수). 파싱 실패면 null. */
export function daysSince(ts: string | undefined, now: Date): number | null {
  const t = Date.parse(ts ?? '');
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY) : null;
}

/** 어느 채널이든 발행됐는가(순수) — 중간 산출물 정리 기준. 원본 교체(규칙 5)는 shortsArchive 가 채널 기준으로 따로 본다. */
export function isShortPublished(s: Pick<JanitorShort, 'youtubeId' | 'igReelId' | 'metaPublishedTs' | 'naverClipNo'>): boolean {
  return !!(s.youtubeId ?? '').trim() || !!(s.igReelId ?? '').trim() || !!(s.metaPublishedTs ?? '').trim() || !!(s.naverClipNo ?? '').trim();
}

/** 발행 시각(순수) — 유튜브·메타 기록 중 있는 것, 없으면 갱신 시각. */
export function shortPublishedTs(s: JanitorShort): string | undefined {
  return s.youtubeTs || s.metaPublishedTs || s.naverClipTs || (isShortPublished(s) ? s.updatedTs : undefined);
}

/** 미발행 상태로 staleDays 이상 묵은 쇼츠인가(순수) — 규칙 3. 생성 중(planning 등)은 제외. */
export function isStaleUnpublishedShort(s: JanitorShort, now: Date, staleDays: number): boolean {
  if (isShortPublished(s)) return false;
  if (!['ready', 'error', 'failed'].includes(s.stage)) return false;
  const age = daysSince(s.createdTs, now);
  return age !== null && age >= staleDays;
}

/**
 * 쇼츠 폴더에서 치울 항목(순수) — 폴더 기준 상대경로. 'clips/*.mp4' 는 클립 파일만(sources.json 은 남긴다)을 뜻한다.
 * always 는 발행 여부와 무관, afterKeep 은 발행 뒤 keepDays 가 지났을 때만.
 */
export function shortPruneTargets(published: boolean, publishedAgeDays: number | null, keepDays: number): string[] {
  // motion-*(2026-10-22) — 모션그래픽 작업 폴더. 바탕 프레임·렌더 번들·미리보기는 다시 안 쓰는 중간물이라 항상,
  // 폴더 통째·시범 폴더(pilot-*)·모션그래픽 전 원본(final.basic.mp4)은 발행 keepDays 뒤(씬·낭독이 빠지면 다시 입힐 수도 없다).
  const out = ['refs', 'scenes/_refnorm', 'download.mp4', 'remotion/bundle', 'remotion/public',
    'motion-*/bgframes', 'motion-*/.remotion', 'motion-*/preview', 'motion-*/bg-nocards.mp4'];
  if (published && publishedAgeDays !== null && publishedAgeDays >= keepDays) {
    out.push('scenes', 'scenes-retry', 'revise-imgs', 'segments', 'remotion', 'clips/*.mp4', 'motion-*', 'pilot-*', 'final.basic.mp4');
  }
  return out;
}

/**
 * 롱폼 폴더에서 치울 항목(순수, 2026-10-22). 렌더 잔여·스틸은 항상(렌더할 때마다 다시 만든다), 유튜브 발행 keepDays 뒤엔
 * 다시 렌더할 재료(낭독·클립·그림 작업물·remotion). 완성 영상·썸네일·대본·타임라인·자막·올릴 글·원문은 대상이 아니다.
 */
export function longformPruneTargets(published: boolean, publishedAgeDays: number | null, keepDays: number): string[] {
  // 장면 에이전트 작업물(scenes/work: agent.jsonl·미리보기 PNG, scenes/stills·.render)은 장면을 다 만든 뒤엔 안 쓴다 — 항상.
  // 전체 화면 렌더(2026-10-23 기본값)의 번들·스테이징·대조표 스틸(remotion-full/bundle·public·stills)도 렌더할 때마다 다시 만든다 — 항상.
  // scenes/sNNN.tsx·registry·remotion-entry(-full)·실물 대조용 사진(refs)은 다시 렌더·다시 그릴 때 필요해 발행 뒤에만.
  const out = ['remotion/bundle', 'remotion/public', 'stills', 'scenes/work', 'scenes/stills', 'scenes/.render', 'remotion-full/bundle', 'remotion-full/public', 'remotion-full/stills'];
  if (published && publishedAgeDays !== null && publishedAgeDays >= keepDays) out.push('audio', 'clips', 'mg', 'scenes', 'remotion', 'remotion-entry', 'remotion-entry-full', 'remotion-full', 'refs');
  return out;
}

/** 카드뉴스 폴더에서 치울 항목(순수) — 발행 뒤 keepDays 지나면 배경·레퍼런스. 슬라이드·json 은 남긴다. */
export function cardPruneTargets(published: boolean, publishedAgeDays: number | null, keepDays: number): string[] {
  const out: string[] = ['bg/_refnorm'];
  if (published && publishedAgeDays !== null && publishedAgeDays >= keepDays) out.push('bg', 'bg-repair', 'refs');
  return out;
}

/** 폴더(또는 파일) 바이트 합. 없으면 0. */
export function pathBytes(p: string): number {
  let st: fs.Stats;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  for (const f of fs.readdirSync(p)) sum += pathBytes(path.join(p, f));
  return sum;
}

/** 휴지통 항목 중 trashDays 지난 것(순수 판정) — 항목 mtime 기준. */
export function trashEntryExpired(mtimeMs: number, now: Date, trashDays: number): boolean {
  return now.getTime() - mtimeMs >= trashDays * DAY;
}

export async function runJanitor(deps: JanitorDeps, opts: JanitorOpts = {}): Promise<JanitorReport> {
  const now = opts.now ?? new Date();
  const dryRun = !!opts.dryRun;
  const keepDays = opts.keepDays ?? 14;
  const staleDays = opts.staleDays ?? 30;
  const trashDays = opts.trashDays ?? 7;
  const report: JanitorReport = { dryRun, moved: {}, purged: { n: 0, bytes: 0 }, archived: { n: 0, bytes: 0 }, deletedShorts: [], orphanGuard: [], errors: [], totalBytes: 0 };
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const trashRoot = path.join(deps.dataDir, '.trash');
  const trashDir = path.join(trashRoot, `janitor-${stamp}`);
  const log = deps.log ?? (() => {});

  /** src 를 휴지통으로(또는 계획만). 존재하지 않으면 무시. */
  const trash = (src: string, label: string, rel: string): void => {
    let bytes = 0;
    try {
      if (!fs.existsSync(src)) return;
      bytes = pathBytes(src);
      if (!dryRun) {
        let dst = path.join(trashDir, label, rel);
        for (let k = 1; fs.existsSync(dst); k++) dst = path.join(trashDir, label, `${rel}~${k}`);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);
      }
      const m = (report.moved[label] ??= { n: 0, bytes: 0 });
      m.n++; m.bytes += bytes;
    } catch (e) {
      report.errors.push(`${label} ${rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  /** 폴더 기준 타깃 목록 적용 — 'clips/*.mp4' 꼴은 그 폴더의 mp4 파일만, 'motion-*' 꼴(첫 마디 접두 글롭)은 그 접두의 폴더마다. */
  const applyTargets = (base: string, id: string, targets: string[], label: string): void => {
    for (const t of targets) {
      const [head, ...rest] = t.split('/');
      if (head!.endsWith('-*')) {
        for (const d of listDirs(base, new RegExp(`^${head!.slice(0, -1).replace(/[.+?^${}()|[\]\\]/g, '\\$&')}`))) {
          const rel = path.join(d, ...rest);
          trash(path.join(base, rel), label, path.join(id, rel));
        }
      } else if (t.endsWith('/*.mp4')) {
        const d = path.join(base, t.slice(0, -'/*.mp4'.length));
        let files: string[] = [];
        try { files = fs.readdirSync(d).filter((f) => /\.mp4$/i.test(f)); } catch { continue; }
        for (const f of files) trash(path.join(d, f), label, path.join(id, t.slice(0, -'/*.mp4'.length), f));
      } else {
        trash(path.join(base, t), label, path.join(id, t));
      }
    }
  };
  const listDirs = (root: string, re: RegExp): string[] => {
    try { return fs.readdirSync(root).filter((f) => re.test(f) && fs.statSync(path.join(root, f)).isDirectory()); } catch { return []; }
  };
  const corrupt = deps.storeCorrupt?.() ?? {
    shorts: isStoreFileCorrupt(path.join(deps.dataDir, 'shorts', 'index.json')),
    cards: isStoreFileCorrupt(path.join(deps.dataDir, 'cardnews', 'index.json')),
    pieces: isStoreFileCorrupt(path.join(deps.dataDir, 'pieces', 'index.json')),
  };
  /** 고아 후보를 안전장치에 통과시킨다 — 멈추면 기록·로그하고 false(그 범주는 이번에 하나도 안 옮긴다). dryRun 도 같은 판정을 보여 준다. */
  const orphanAllowed = (category: string, o: { corrupt: boolean; indexSize: number; folders: number; candidates: number }): boolean => {
    const reason = orphanGuardReason(o);
    if (!reason) return true;
    report.orphanGuard.push({ category, reason, candidates: o.candidates, folders: o.folders });
    log(`⚠️ ${category} 정리 멈춤 — ${reason}(후보 ${o.candidates} / 폴더 ${o.folders}). 색인을 확인하세요.`);
    return false;
  };
  /** 크래시 잔여물 — LEFTOVER_DAYS 지난 것만(만드는 중인 작업의 사본·임시 파일은 건드리지 않는다). */
  const trashLeftovers = (base: string, id: string, match: (name: string) => boolean, sub = ''): void => {
    const d = sub ? path.join(base, sub) : base;
    let names: string[] = [];
    try { names = fs.readdirSync(d).filter(match); } catch { return; }
    for (const n of names) {
      try { if (now.getTime() - fs.lstatSync(path.join(d, n)).mtimeMs < LEFTOVER_DAYS * DAY) continue; } catch { continue; }
      trash(path.join(d, n), 'crash-leftovers', path.join(id, sub, n));
    }
  };

  // ── 쇼츠
  const shortsRoot = path.join(deps.dataDir, 'shorts');
  const shorts = deps.shorts();
  const shortIds = new Set(shorts.map((s) => s.id));
  const shortDirs = listDirs(shortsRoot, /^short_/);
  const orphanShorts = shortDirs.filter((id) => !shortIds.has(id) && !deps.isShortRunning(id));
  if (orphanAllowed('orphan-shorts', { corrupt: !!corrupt.shorts, indexSize: shorts.length, folders: shortDirs.length, candidates: orphanShorts.length })) {
    for (const id of orphanShorts) trash(path.join(shortsRoot, id), 'orphan-shorts', id); // 규칙 1 — 고아 폴더
  }
  for (const s of shorts) {
    if (deps.isShortRunning(s.id)) continue;
    const dir = path.join(shortsRoot, s.id);
    trashLeftovers(dir, s.id, isShortBackupLeftover); // 재조립 중 죽어 남은 되돌림 사본(2026-10-26)
    trashLeftovers(dir, s.id, isRealignLeftover, 'clips');
    if (isStaleUnpublishedShort(s, now, staleDays)) { // 규칙 3
      if (!dryRun) { try { deps.removeShort(s.id); } catch (e) { report.errors.push(`remove ${s.id}: ${e instanceof Error ? e.message : String(e)}`); continue; } }
      report.deletedShorts.push(s.id);
      trash(dir, 'stale-shorts', s.id);
      continue;
    }
    const published = isShortPublished(s);
    applyTargets(dir, s.id, shortPruneTargets(published, daysSince(shortPublishedTs(s), now), keepDays), 'shorts-intermediates');
    if (published && !s.videoArchivedTs && !dryRun) { // 규칙 5
      try { const freed = await deps.archiveShort(s.id); if (freed) { report.archived.n++; report.archived.bytes += freed; } }
      catch (e) { report.errors.push(`archive ${s.id}: ${e instanceof Error ? e.message : String(e)}`); }
    } else if (published && !s.videoArchivedTs && dryRun && fs.existsSync(path.join(dir, 'final.mp4'))) {
      report.archived.n++; report.archived.bytes += Math.round(pathBytes(path.join(dir, 'final.mp4')) * 0.75); // 실측 1/4 로 준다
    }
  }

  // ── 카드뉴스
  const cardsRoot = path.join(deps.dataDir, 'cardnews');
  const cards = deps.cards();
  const cardIds = new Set(cards.map((c) => c.id));
  const cardDirs = listDirs(cardsRoot, /^card_/);
  const orphanCards = cardDirs.filter((id) => !cardIds.has(id));
  if (orphanAllowed('orphan-cardnews', { corrupt: !!corrupt.cards, indexSize: cards.length, folders: cardDirs.length, candidates: orphanCards.length })) {
    for (const id of orphanCards) trash(path.join(cardsRoot, id), 'orphan-cardnews', id);
  }
  for (const c of cards) {
    trashLeftovers(path.join(cardsRoot, c.id), c.id, isCardRenderLeftover); // 렌더 중 죽어 남은 임시 폴더(2026-10-26)
    const published = !!(c.igMediaId || c.fbPostId);
    const age = daysSince(c.metaPublishedTs || (published ? c.updatedTs : undefined), now);
    applyTargets(path.join(cardsRoot, c.id), c.id, cardPruneTargets(published, age, keepDays), 'cardnews-intermediates');
  }

  // ── 롱폼(2026-10-22) — 색인에 있는 편만. 제작 중(producing·지금 만드는 편)은 건드리지 않는다.
  const longformRoot = path.join(deps.dataDir, 'longform');
  for (const lf of deps.longform?.() ?? []) {
    if (lf.stage === 'producing' || deps.isLongformRunning?.(lf.id)) continue;
    if (!lf.dir || lf.dir !== path.basename(lf.dir) || lf.dir === '.' || lf.dir === '..') continue; // 폴더 밖으로 나가는 이름은 거른다
    const published = !!(lf.youtubeId ?? '').trim();
    applyTargets(path.join(longformRoot, lf.dir), lf.dir, longformPruneTargets(published, daysSince(lf.youtubeTs, now), keepDays), 'longform-intermediates');
  }

  // ── 블로그 세션
  const pieces = deps.pieces();
  const linked = new Map<string, JanitorPiece>();
  for (const p of pieces) if (p.runId) linked.set(p.runId, p);
  const sessionDirs = listDirs(deps.sessionsDir, /^[0-9a-f]{8,}$/i);
  // 규칙 4 — 글과 연결 안 된 세션. 후보를 먼저 다 모아 안전장치(글 색인 깨짐·비어 있음·대량)에 통과시킨 뒤에 옮긴다.
  const unlinked: string[] = [];
  for (const runId of sessionDirs) {
    if (deps.isSessionRunning(runId) || linked.has(runId)) continue;
    const dir = path.join(deps.sessionsDir, runId);
    let mtime = 0;
    try { mtime = fs.statSync(fs.existsSync(path.join(dir, 'run.json')) ? path.join(dir, 'run.json') : dir).mtimeMs; } catch { continue; }
    if (now.getTime() - mtime >= staleDays * DAY) unlinked.push(runId);
  }
  if (orphanAllowed('unlinked-sessions', { corrupt: !!corrupt.pieces, indexSize: pieces.length, folders: sessionDirs.length, candidates: unlinked.length })) {
    for (const runId of unlinked) {
      // 블로그 실촬영 컷 반납(2026-10-02 2차 리뷰) — 초안 없는 미연결 런의 컷은 세션이 있을 때 이미 풀려 있었다. 세션을 치우면
      // 그 판정 근거가 사라져 다시 막히므로 옮기기 전에 반납 줄로 굳혀 둔다(조건·발행 글 보호는 함수 안). 계획(dryRun)이면 안 쓴다.
      if (!dryRun) releaseBlogFramesOfRemovedRun(runId, { dataDir: deps.dataDir, sessionsDir: deps.sessionsDir }, 'janitor-unlinked');
      trash(path.join(deps.sessionsDir, runId), 'unlinked-sessions', runId);
    }
  }
  for (const runId of sessionDirs) {
    if (deps.isSessionRunning(runId)) continue;
    const dir = path.join(deps.sessionsDir, runId);
    const p = linked.get(runId);
    if (!p) continue; // 미연결은 위에서 처리
    const age = daysSince(p.publishedTs, now);
    if (!(p.publishedUrl && age !== null && age >= keepDays)) continue;
    trash(path.join(dir, 'screenshots'), 'session-intermediates', path.join(runId, 'screenshots'));
    let used = new Set<string>();
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, '06_image_manifest.json'), 'utf-8')) as { images?: Array<{ file_path?: string } | null> };
      used = new Set((m.images ?? []).map((x) => path.basename(String(x?.file_path ?? ''))).filter(Boolean));
    } catch { continue; } // 매니페스트를 못 읽으면 어느 이미지가 쓰였는지 모른다 — 건드리지 않는다
    const imgDir = path.join(dir, 'images');
    let files: string[] = [];
    try { files = fs.readdirSync(imgDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)); } catch { continue; }
    for (const f of files) if (!used.has(f)) trash(path.join(imgDir, f), 'session-intermediates', path.join(runId, 'images', f));
  }

  // ── 작업 산출 폴더(out/ 등) — keepDays 지난 항목. pnpm preview·기법 스틸 같은 확인용 렌더라 다시 만들 수 있다.
  for (const sd of deps.scratchDirs ?? []) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(sd); } catch { continue; }
    for (const f of entries) {
      const p = path.join(sd, f);
      try { if (now.getTime() - fs.statSync(p).mtimeMs < keepDays * DAY) continue; } catch { continue; }
      trash(p, 'scratch-out', path.join(path.basename(sd), f));
    }
  }

  // ── 휴지통 영구 삭제(trashDays 경과)
  for (const entry of listDirs(trashRoot, /./)) {
    const p = path.join(trashRoot, entry);
    try {
      if (!trashEntryExpired(fs.statSync(p).mtimeMs, now, trashDays)) continue;
      const bytes = pathBytes(p);
      if (!dryRun) fs.rmSync(p, { recursive: true, force: true });
      report.purged.n++; report.purged.bytes += bytes;
    } catch (e) { report.errors.push(`purge ${entry}: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const movedBytes = Object.values(report.moved).reduce((a, m) => a + m.bytes, 0);
  report.totalBytes = movedBytes + report.purged.bytes + report.archived.bytes;
  const parts = Object.entries(report.moved).map(([k, v]) => `${k} ${v.n}건 ${humanBytes(v.bytes)}`);
  log(`${dryRun ? '계획' : '정리'} — 휴지통 이동 ${humanBytes(movedBytes)}(${parts.join(' · ') || '없음'}) · 영구 삭제 ${report.purged.n}건 ${humanBytes(report.purged.bytes)} · 원본 교체 ${report.archived.n}건 ${humanBytes(report.archived.bytes)} · 미발행 정리 ${report.deletedShorts.length}편${report.orphanGuard.length ? ` · 고아 정리 멈춤 ${report.orphanGuard.map((g) => g.category).join('·')}` : ''}${report.errors.length ? ` · 오류 ${report.errors.length}` : ''}`);
  return report;
}
