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
 *     렌더 잔여(remotion/bundle·public).
 *  2) 발행 keepDays 뒤: 씬 이미지·클립·낭독 mp3·세그먼트(쇼츠), 배경·레퍼런스(카드뉴스), 매니페스트에 없는 후보 이미지·
 *     스크린샷(블로그 세션). 수정요청 재조립이 발행 뒤엔 안 쓰이는 것들이다. clips/sources.json 은 남긴다(보관소 사용 현황이 읽는다).
 *  3) 미발행 staleDays 이상 쇼츠(ready·error): 버린 편으로 보고 색인에서 빼고 폴더는 휴지통으로(사용자 확정 "30일 넘은 쇼츠 버린 것").
 *  4) 글과 연결 안 된 세션 staleDays 이상: 통째로 휴지통(사용자 확정 "지워도 됨").
 *  5) 발행 끝난 쇼츠의 final.mp4 → preview.mp4 교체(shortsArchive 정책)를 여기서도 돈다 — 채널 분리 뒤 조건이 안 맞아 멈춰 있던 것.
 *
 * 남기는 것: 발행 편의 미리보기 영상·슬라이드·썸네일·대본·기록(json/srt/txt), 보관소 원본(data/media), 성과 시계열.
 * 진행 중인 런·생성 중인 편은 건드리지 않는다. 전 구간 fail-open — 한 항목이 실패해도 나머지는 계속한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { humanBytes } from '../util/prune';

export interface JanitorShort {
  id: string; stage: string; platform?: string;
  youtubeId?: string; igReelId?: string; metaPublishedTs?: string; youtubeTs?: string; videoArchivedTs?: string;
  createdTs: string; updatedTs?: string;
}
export interface JanitorCard { id: string; stage: string; igMediaId?: string; fbPostId?: string; metaPublishedTs?: string; createdTs: string; updatedTs?: string }
export interface JanitorPiece { id: string; runId?: string; publishedTs?: string; publishedUrl?: string }

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
  errors: string[];
  /** 이번 실행으로 돌려받는(또는 계획) 총 바이트 = moved + purged + archived. */
  totalBytes: number;
}

const DAY = 86_400_000;

/** ts 로부터 지난 일수(순수). 파싱 실패면 null. */
export function daysSince(ts: string | undefined, now: Date): number | null {
  const t = Date.parse(ts ?? '');
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY) : null;
}

/** 어느 채널이든 발행됐는가(순수) — 중간 산출물 정리 기준. 원본 교체(규칙 5)는 shortsArchive 가 채널 기준으로 따로 본다. */
export function isShortPublished(s: Pick<JanitorShort, 'youtubeId' | 'igReelId' | 'metaPublishedTs'>): boolean {
  return !!(s.youtubeId ?? '').trim() || !!(s.igReelId ?? '').trim() || !!(s.metaPublishedTs ?? '').trim();
}

/** 발행 시각(순수) — 유튜브·메타 기록 중 있는 것, 없으면 갱신 시각. */
export function shortPublishedTs(s: JanitorShort): string | undefined {
  return s.youtubeTs || s.metaPublishedTs || (isShortPublished(s) ? s.updatedTs : undefined);
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
  const out = ['refs', 'scenes/_refnorm', 'download.mp4', 'remotion/bundle', 'remotion/public'];
  if (published && publishedAgeDays !== null && publishedAgeDays >= keepDays) {
    out.push('scenes', 'scenes-retry', 'revise-imgs', 'segments', 'remotion', 'clips/*.mp4');
  }
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
  const report: JanitorReport = { dryRun, moved: {}, purged: { n: 0, bytes: 0 }, archived: { n: 0, bytes: 0 }, deletedShorts: [], errors: [], totalBytes: 0 };
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
  /** 폴더 기준 타깃 목록 적용 — 'clips/*.mp4' 꼴은 그 폴더의 mp4 파일만. */
  const applyTargets = (base: string, id: string, targets: string[], label: string): void => {
    for (const t of targets) {
      if (t.endsWith('/*.mp4')) {
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

  // ── 쇼츠
  const shortsRoot = path.join(deps.dataDir, 'shorts');
  const shorts = deps.shorts();
  const shortIds = new Set(shorts.map((s) => s.id));
  for (const id of listDirs(shortsRoot, /^short_/)) {
    if (shortIds.has(id) || deps.isShortRunning(id)) continue;
    trash(path.join(shortsRoot, id), 'orphan-shorts', id); // 규칙 1 — 고아 폴더
  }
  for (const s of shorts) {
    if (deps.isShortRunning(s.id)) continue;
    const dir = path.join(shortsRoot, s.id);
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
  for (const id of listDirs(cardsRoot, /^card_/)) if (!cardIds.has(id)) trash(path.join(cardsRoot, id), 'orphan-cardnews', id);
  for (const c of cards) {
    const published = !!(c.igMediaId || c.fbPostId);
    const age = daysSince(c.metaPublishedTs || (published ? c.updatedTs : undefined), now);
    applyTargets(path.join(cardsRoot, c.id), c.id, cardPruneTargets(published, age, keepDays), 'cardnews-intermediates');
  }

  // ── 블로그 세션
  const pieces = deps.pieces();
  const linked = new Map<string, JanitorPiece>();
  for (const p of pieces) if (p.runId) linked.set(p.runId, p);
  for (const runId of listDirs(deps.sessionsDir, /^[0-9a-f]{8,}$/i)) {
    if (deps.isSessionRunning(runId)) continue;
    const dir = path.join(deps.sessionsDir, runId);
    const p = linked.get(runId);
    if (!p) { // 규칙 4 — 글과 연결 안 된 세션
      let mtime = 0;
      try { mtime = fs.statSync(fs.existsSync(path.join(dir, 'run.json')) ? path.join(dir, 'run.json') : dir).mtimeMs; } catch { continue; }
      if (now.getTime() - mtime >= staleDays * DAY) trash(dir, 'unlinked-sessions', runId);
      continue;
    }
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
  log(`${dryRun ? '계획' : '정리'} — 휴지통 이동 ${humanBytes(movedBytes)}(${parts.join(' · ') || '없음'}) · 영구 삭제 ${report.purged.n}건 ${humanBytes(report.purged.bytes)} · 원본 교체 ${report.archived.n}건 ${humanBytes(report.archived.bytes)} · 미발행 정리 ${report.deletedShorts.length}편${report.errors.length ? ` · 오류 ${report.errors.length}` : ''}`);
  return report;
}
