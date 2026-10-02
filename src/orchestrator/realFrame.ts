/**
 * 블로그 실촬영 컷 준비(2026-10-02) — 이미지 디자이너가 돌기 **전에** 이 글의 실사진 한 장을 정한다.
 *
 * 왜 디자이너 앞인가. 디자이너에게 '1번은 실사진이니 2·3번만 계획하라'고 말하려면 실사진이 실제로 나왔는지
 * 알아야 한다. 화면 중복 판정(blogFrames.findVisualDuplicate)도 뗀 뒤에야 할 수 있다. 그래서 고르기·떼기·
 * 판정·원장 기록을 한 번에 여기서 하고, finalize 는 이미 쓰인 blog-image-01.png 를 매니페스트 앞에 합치기만 한다.
 *
 * 동시 런(2026-10-02 리뷰) — 고르기는 결정적이라 같은 수종 런 둘이 동시에 돌면 같은 순간을 집는다. 그래서 확정
 * (위치·화면 재확인 → 파일 이동 → 원장 기록)만 잠금 파일 안에서 하고, 잠금 안에서 원장을 **다시 읽어** 본다.
 * 떼기(약 2초 × 최대 5회)는 잠금 밖이다 — 잠금은 짧게 쥔다. 잠금을 못 잡으면 확정하지 않는다(전부 생성 이미지).
 *
 * 원장 줄의 수명은 blogFrames.frameRowBlocks 가 읽을 때 정한다 — 이 파일은 그 판정에 필요한 글 색인·세션 흔적을 모은다.
 *
 * 전부 fail-open — 어디서 실패하든 null 을 돌려주면 그 글은 종전처럼 전부 생성 이미지다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { listMedia, matchMediaScored } from '../content/mediaLibrary';
import { findSpeciesLoose } from '../content/species';
import {
  appendBlogFrame, blockingFrameRows, blogFrameLedgerPath, findPositionClash, findVisualDuplicate, frameForPiece, frameLineageRuns,
  rankFramePicks, readBlogFrameLedger, readBlogFrameReleases, realFrameAlt, realFrameEntry, FRAME_BAD_PREFIX, FRAME_MAX_TRIES,
  type BlogFrameRow, type FrameCandidate, type FrameLiveness, type FrameOwnerPiece,
} from '../content/blogFrames';
import { captureBlogFrame } from '../tools/blog_skills';

export interface RealFramePlan {
  /** 세션의 images/blog-image-01.png 절대경로. */
  file: string;
  mediaId: string;
  mediaFile: string;
  atSec: number;
  species: string;
  tags: string[];
  alt: string;
  hash?: string;
  /** 같은 글의 리비전이 자기 컷을 다시 쓴 경우 — 새 컷을 먹지 않았다(원장엔 이 런의 재사용 줄(from)만 남겼다). */
  reused: boolean;
}

/** 실촬영 슬롯이 받는 첫 이미지 파일명 — openai_image.py 의 번호 규칙(blog-image-NN.png)과 같다. */
export const REAL_FRAME_FILENAME = 'blog-image-01.png';

/**
 * 원장 잠금 시간(ms). 확정 구간은 원장 읽기·파일 이동·한 줄 쓰기라 수십 ms 다 — staleMs 를 넘긴 잠금은 쥔 프로세스가
 * 죽은 것으로 보고 깬다. waitMs 안에 못 잡으면 이번 글은 실촬영 없이 간다. 테스트가 줄일 수 있게 객체로 둔다.
 */
export const FRAME_LOCK = { staleMs: 30_000, waitMs: 20_000, pollMs: 50 };

export async function prepareRealFrame(o: {
  runId: string; pieceId?: string; baseRunId?: string; topic: string; keyword?: string; brand?: string;
  signal?: AbortSignal; log: (m: string) => void;
}): Promise<RealFramePlan | null> {
  if (!CONFIG.blogRealFrame) return null;
  const imagesDir = path.join(CONFIG.sessionsDir, o.runId, 'images');
  const dest = path.join(imagesDir, REAL_FRAME_FILENAME);
  try {
    const ledgerFile = blogFrameLedgerPath(CONFIG.dataDir);
    const ledger = readBlogFrameLedger(ledgerFile);
    const live = frameLiveness(ledgerFile);
    const lib = listMedia(o.brand);
    const canon = (n: string): string => findSpeciesLoose(n)?.name ?? n;
    fs.mkdirSync(imagesDir, { recursive: true });

    // ── 같은 글이면 자기 컷을 다시 쓴다(리비전·같은 piece 재실행) — 새 컷을 먹지 않는다.
    const reused = await reuseOwnFrame({ ...o, ledgerFile, ledger, live, lib, dest });
    if (reused) return reused;

    // ── 새 컷 고르기 — 숏폼과 같은 등급 규칙(다른 수종 소재는 아예 후보가 아니다).
    const text = `${o.topic} ${o.keyword ?? ''}`.trim();
    const sp = findSpeciesLoose(text)?.name;
    const cands: FrameCandidate[] = matchMediaScored(lib, { species: sp, text, limit: 500, canon })
      .map(({ item, score, grade }) => ({
        mediaId: item.id, file: item.file, kind: item.kind, seconds: item.seconds, grade, bonus: score - grade,
        species: item.species ? canon(item.species) : (sp ?? ''), tags: item.tags ?? [], createdTs: item.createdTs,
      }));
    const label = sp ?? '범용';
    if (!cands.length) {
      o.log(`블로그 실촬영 컷 없음 — 보관소에 ${label} 소재가 없다(전부 생성 이미지)`);
      return null;
    }
    // 지금 막고 있는 줄만 본다 — 버려진 초안의 예약은 여기서 풀린다(frameRowBlocks).
    const rows = blockingFrameRows(ledger, live); // 이번 런의 거절도 바로 반영해 같은 화면을 두 번 시도하지 않는다
    const picks = rankFramePicks(cands, rows);
    if (!picks.length) {
      o.log(`블로그 실촬영 컷 소진 — ${label} 영상 추가 필요`);
      return null;
    }

    const tmp = path.join(imagesDir, '_real_frame_try.png');
    const base = { runId: o.runId, ...(o.pieceId ? { pieceId: o.pieceId } : {}) };
    const goneFiles = new Set<string>(); // 이번 런에 '파일 없음'이 난 소재 — 같은 파일의 다른 순간은 보지 않는다
    let tries = 0;
    try {
      for (const pick of picks) {
        if (tries >= FRAME_MAX_TRIES || o.signal?.aborted) break;
        if (goneFiles.has(pick.file)) continue;
        tries++;
        const cap = await captureBlogFrame({ kind: pick.kind, file: pick.file, atSec: pick.atSec }, tmp, o.signal);
        const at = cap.atSec ?? pick.atSec;
        const row = (status: BlogFrameRow['status'], extra: Partial<BlogFrameRow> = {}): BlogFrameRow => ({
          ts: new Date().toISOString(), ...base, mediaId: pick.mediaId, file: pick.file, kind: pick.kind,
          atSec: pick.kind === 'image' ? 0 : at, species: pick.species, status, ...extra,
        });
        if (cap.badMoment) {
          // 그 순간에서 한 장도 못 뗐다 — 기한부로 기록해 다음 런들이 같은 순간에 시도를 헛쓰지 않게(FRAME_BAD_TTL_DAYS).
          const r = row('rejected', { reason: `${FRAME_BAD_PREFIX}${cap.error ?? 'extract_failed'}`, atSec: pick.atSec });
          appendBlogFrame(ledgerFile, r); rows.push(r);
          o.log(`실촬영 컷 추출 실패 — ${path.basename(pick.file)} @${pick.atSec}초: 그 순간은 한동안 건너뜀`);
          continue;
        }
        if (cap.error) {
          o.log(`실촬영 컷 추출 실패(무해) — ${path.basename(pick.file)} @${pick.atSec}초: ${cap.error.slice(0, 80)}`);
          if (cap.error === 'no_input') { goneFiles.add(pick.file); continue; }
          if (cap.error.startsWith('error')) continue; // 그 파일의 문제(파이썬 예외) — 다른 파일은 될 수 있다
          break; // 스크립트가 아예 안 돈다(BLOG_PYTHON 미설정·출력 없음) — 남은 시도도 전부 같다
        }
        if (!cap.ok) {
          // 화질 거절은 기록한다 — 그 순간은 다음 글에서도 같은 이유로 버려진다(시도 횟수를 헛쓰지 않게).
          const r = row('rejected', { reason: cap.reason ?? 'quality', atSec: pick.atSec });
          appendBlogFrame(ledgerFile, r); rows.push(r);
          o.log(`실촬영 컷 거절 — ${path.basename(pick.file)} @${pick.atSec}초: ${cap.reason}`);
          continue;
        }
        if (!cap.hash || !fs.existsSync(tmp)) { o.log('실촬영 컷 결과에 해시·파일 없음 — 건너뜀'); continue; }

        // ── 확정(잠금 안) — 원장을 다시 읽어 그 사이 다른 런이 같은 자리·같은 화면을 가져갔는지 본다.
        const verdict = await withLedgerLock(ledgerFile, o.signal, () => {
          const all = readBlogFrameLedger(ledgerFile);
          const fresh = blockingFrameRows(all, frameLiveness(ledgerFile));
          // 같은 글(pieceId)·같은 글의 계보 런(pieceId 없는 수동 리비전 포함)의 줄은 자기 컷이라 뺀다.
          const own = { pieceId: o.pieceId, runIds: frameLineageRuns(all, { pieceId: o.pieceId, runIds: [o.runId, o.baseRunId] }) };
          const clash = findPositionClash({ mediaId: pick.mediaId, file: pick.file, kind: pick.kind, atSec: pick.kind === 'image' ? 0 : at }, fresh, own);
          if (clash) return { kind: 'clash' as const, row: clash };
          const dup = findVisualDuplicate({ hash: cap.hash, sig: cap.sig, species: pick.species, mediaId: pick.mediaId, file: pick.file }, fresh, own);
          if (dup) {
            // 겹친 대상을 적어 둔다 — 대상이 반납되면 이 거절도 풀린다(blockingFrameRows).
            const r = row('rejected', {
              reason: `dup:${dup.why}`, hash: cap.hash,
              dupOf: { mediaId: dup.row.mediaId, ...(dup.row.file ? { file: dup.row.file } : {}), atSec: dup.row.atSec },
            });
            appendBlogFrame(ledgerFile, r); rows.push(r);
            return { kind: 'dup' as const, ...dup };
          }
          fs.renameSync(tmp, dest);
          try {
            appendBlogFrame(ledgerFile, row('used', { hash: cap.hash, ...(cap.sig ? { sig: cap.sig } : {}) }));
          } catch (e) {
            // 원장에 못 남긴 실사진은 내보내지 않는다 — 파일이 남으면 finalize 의 매니페스트 복원이 표시 없이 집어 가
            // 실사진에 'AI 활용'이 붙고, 원장에도 없어 다른 글이 같은 순간을 또 쓴다.
            try { fs.rmSync(dest, { force: true }); } catch { /* 무해 */ }
            throw e;
          }
          return { kind: 'ok' as const };
        });
        if (verdict === null) {
          o.log('블로그 실촬영 컷 원장 잠금을 못 잡음 — 이번 글은 전부 생성 이미지');
          return null;
        }
        if (verdict.kind === 'clash') {
          o.log(`실촬영 컷 양보 — ${path.basename(pick.file)} @${at}초는 방금 다른 글(${verdict.row.runId})이 가져감`);
          continue;
        }
        if (verdict.kind === 'dup') {
          o.log(`실촬영 컷 거절 — ${path.basename(pick.file)} @${at}초가 이미 나간 사진(${verdict.row.runId} ${path.basename(verdict.row.file)} @${verdict.row.atSec}초)과 같아 보임(${verdict.why})`);
          continue;
        }
        const species = pick.species || label;
        // 대체텍스트는 글이 부르는 이름으로 — '백일홍 겨울나기' 글에 '배롱나무 — 직접 촬영'이 붙으면 독자가 다른 꽃으로 읽는다
        // (원장·중복 비교는 표준명 그대로). 소재 딱지가 제목에 그대로 있으면 그 이름, 아니면 표준명.
        const named = String(lib.find((m) => m.id === pick.mediaId)?.species ?? '').trim();
        const altName = named && text.includes(named) ? named : species;
        o.log(`블로그 실촬영 컷 — ${species} · ${path.basename(pick.file)} @${at}초 (후보 ${picks.length}곳 중 ${tries}번째 시도)`);
        return {
          file: dest, mediaId: pick.mediaId, mediaFile: pick.file, atSec: at, species, tags: pick.tags,
          alt: realFrameAlt(altName), hash: cap.hash, reused: false,
        };
      }
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* 무해 */ }
    }
    o.log(rankFramePicks(cands, rows).length
      ? `블로그 실촬영 컷 없음 — 이번 글은 ${tries}번 시도가 모두 거절(남은 후보는 다음 글에서)`
      : `블로그 실촬영 컷 소진 — ${label} 영상 추가 필요`);
    return null;
  } catch (e) {
    // 계획을 못 돌려주면 파일도 남기지 않는다 — 남은 blog-image-01.png 는 표시 없이 생성 이미지로 발행될 수 있다.
    try { fs.rmSync(dest, { force: true }); } catch { /* 무해 */ }
    o.log(`블로그 실촬영 컷 준비 실패(무해 — 전부 생성 이미지): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * 예약 수명 판정 재료 — 글 색인(data/pieces/index.json, pieceStore 싱글턴은 첫 dataDir 를 붙잡아 직접 읽는다)·반납 줄·
 * 세션 흔적(run.json = 런 끝남, draft.json = 초안 있음). 색인을 못 읽으면 빈 목록 — 그래도 판정은 막는 쪽으로 기운다.
 */
function frameLiveness(ledgerFile: string): FrameLiveness {
  let pieces: FrameOwnerPiece[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CONFIG.dataDir, 'pieces', 'index.json'), 'utf-8')) as unknown;
    if (Array.isArray(raw)) pieces = raw.filter((p): p is FrameOwnerPiece => !!p && typeof p === 'object' && typeof (p as FrameOwnerPiece).id === 'string');
  } catch { /* 색인 없음 */ }
  return {
    pieces,
    releases: readBlogFrameReleases(ledgerFile),
    session: (runId) => {
      const dir = path.join(CONFIG.sessionsDir, path.basename(runId));
      return { exists: fs.existsSync(dir), ended: fs.existsSync(path.join(dir, 'run.json')), draft: fs.existsSync(path.join(dir, 'draft.json')) };
    },
    now: Date.now(),
  };
}

/**
 * 원장 잠금(파일 'wx' 생성) 안에서 fn 을 돈다. 못 잡으면(대기 초과·취소) null — 호출부는 확정하지 않는다.
 * staleMs 를 넘긴 잠금은 깬다(쥔 프로세스가 죽은 경우). 풀 때는 내 토큰일 때만 지운다.
 */
async function withLedgerLock<T>(ledgerFile: string, signal: AbortSignal | undefined, fn: () => T): Promise<T | null> {
  const lock = `${ledgerFile}.lock`;
  const token = `${process.pid}:${Math.random().toString(36).slice(2)}:${Date.now()}`;
  const deadline = Date.now() + FRAME_LOCK.waitMs;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(lock, token, { flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    try {
      const seen = fs.readFileSync(lock, 'utf-8');
      if (Date.now() - fs.statSync(lock).mtimeMs > FRAME_LOCK.staleMs) breakStaleLock(lock, seen); // 죽은 잠금 — 다음 바퀴에 잡는다
    } catch { /* 그 사이 풀렸다 — 다음 바퀴에 잡는다 */ }
    if (signal?.aborted || Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, FRAME_LOCK.pollMs));
  }
  try {
    return fn();
  } finally {
    try { if (fs.readFileSync(lock, 'utf-8') === token) fs.rmSync(lock, { force: true }); } catch { /* 무해 */ }
  }
}

/**
 * 죽은 잠금 깨기(2026-10-02 2차 리뷰) — 읽고 지우기 사이에 다른 프로세스가 같은 죽은 잠금을 깨고 새로 잡으면, 그대로 지우면
 * 살아 있는 남의 잠금을 지운다. 그래서 먼저 고유한 이름으로 옮겨(rename 은 원자적) 내 것으로 만든 뒤, 옮긴 파일이 내가 본
 * 죽은 잠금(내용·오래됨)인지 다시 확인하고 지운다. 아니면(남의 새 잠금을 옮겼다) 제자리로 되돌린다 — link 는 덮어쓰지
 * 않으므로 그 사이 또 다른 프로세스가 잡았으면 되돌리지 않는다. 깼으면 true.
 */
export function breakStaleLock(lock: string, seen: string): boolean {
  const aside = `${lock}.stale-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try { fs.renameSync(lock, aside); } catch { return false; } // 그 사이 풀렸다
  let dead = false;
  try { dead = fs.readFileSync(aside, 'utf-8') === seen && Date.now() - fs.statSync(aside).mtimeMs > FRAME_LOCK.staleMs; } catch { /* 못 읽으면 되돌린다 */ }
  if (!dead) { try { fs.linkSync(aside, lock); } catch { /* 이미 다른 잠금이 섰다 — 덮지 않는다 */ } }
  try { fs.rmSync(aside, { force: true }); } catch { /* 무해 */ }
  return dead;
}

/**
 * 같은 글이 이미 받은 컷을 이 세션으로 가져온다. 원장의 pieceId 행이 정본이고, 없으면 원 런 매니페스트의 실촬영
 * 항목. 파일은 원 런 세션에서 복사하고(원본 그대로), 그 파일이 없으면 원장의 순간을 정확히 다시 뗀다.
 * 그 컷이 그사이 반납돼 다른 글이 같은 자리·같은 화면을 가져갔으면(버려졌던 글이 되살아난 경우) 다시 쓰지 않고 새로 고른다.
 */
async function reuseOwnFrame(o: {
  runId: string; pieceId?: string; baseRunId?: string; signal?: AbortSignal; log: (m: string) => void;
  ledgerFile: string; ledger: BlogFrameRow[]; live: FrameLiveness; lib: ReturnType<typeof listMedia>; dest: string;
}): Promise<RealFramePlan | null> {
  const row = frameForPiece(o.ledger, { pieceId: o.pieceId, baseRunId: o.baseRunId });
  const runs = [...new Set([o.baseRunId, row?.runId].filter((r): r is string => !!r && r !== o.runId))];
  let src = '';
  let srcRun = '';
  let entry: Record<string, unknown> | undefined;
  for (const rid of runs) {
    try {
      const dir = path.join(CONFIG.sessionsDir, rid);
      const e = realFrameEntry(JSON.parse(fs.readFileSync(path.join(dir, 'image_manifest.json'), 'utf-8')));
      const f = e?.filename ? path.join(dir, 'images', path.basename(String(e.filename))) : '';
      if (e && f && fs.existsSync(f) && (!row || e['mediaId'] === row.mediaId)) { src = f; srcRun = rid; entry = e; break; }
    } catch { /* 그 런은 건너뛴다 */ }
  }
  if (!row && !entry) return null;
  const mediaId = row?.mediaId ?? String(entry?.['mediaId'] ?? '');
  const item = o.lib.find((m) => m.id === mediaId);
  const atSec = row?.atSec ?? Number(entry?.['atSec'] ?? 0);
  const species = row?.species || String(entry?.['species'] ?? '') || String(item?.species ?? '');
  const mediaFile = row?.file ?? item?.file ?? '';
  const kind = row?.kind ?? (item?.kind === 'image' ? 'image' : 'video');
  if (!mediaId && !mediaFile) return null; // 원장에 남길 수 없는 컷은 다시 쓰지 않는다
  // 다른 글의 예약과 겹치는가 — 이 글(pieceId)·이 글의 계보 런(원 런·재사용 줄의 from 을 거슬러 닫은 것)의 줄은 자기 것이라 뺀다.
  const clashOf = (ledger: readonly BlogFrameRow[], live: FrameLiveness, hash: string | undefined, sig: string | undefined): BlogFrameRow | undefined => {
    const own = { pieceId: o.pieceId, runIds: frameLineageRuns(ledger, { pieceId: o.pieceId, runIds: [o.runId, o.baseRunId, row?.runId, srcRun] }) };
    const blocking = blockingFrameRows(ledger, live);
    return findPositionClash({ mediaId, file: mediaFile, kind, atSec }, blocking, own)
      ?? findVisualDuplicate({ hash, sig, species, mediaId, file: mediaFile }, blocking, own)?.row;
  };
  let hash = row?.hash ?? (typeof entry?.['hash'] === 'string' ? String(entry['hash']) : undefined);
  let sig = row?.sig;
  const early = clashOf(o.ledger, o.live, hash, sig);
  if (early) {
    o.log(`이 글의 옛 실촬영 컷은 그사이 다른 글(${early.runId})이 썼다 — 새 컷을 고른다`);
    return null;
  }
  if (src) {
    fs.copyFileSync(src, o.dest);
  } else if (row) {
    const cap = await captureBlogFrame({ kind: row.kind, file: row.file, atSec: row.atSec, exact: true }, o.dest, o.signal);
    if (!cap.ok) {
      try { fs.rmSync(o.dest, { force: true }); } catch { /* 무해 */ }
      o.log(`이 글의 실촬영 컷을 다시 못 만듦(${cap.error ?? cap.reason}) — 새 컷을 고른다`);
      return null;
    }
    hash ??= cap.hash;
    sig ??= cap.sig;
  } else {
    return null;
  }
  // ── 확정(잠금 안) — 재사용도 이 런·이 글 이름으로 원장에 'used' 줄을 남긴다(2026-10-02 2차 리뷰). 안 남기면 글의 runId 가
  // 이 런으로 옮겨 간 뒤 옛 줄이 주인 없는 줄이 되어 반납 줄·세션 판정으로 풀린다 — 발행된 글의 컷을 다른 글이 받는다
  // (실례: 글 삭제 → 같은 런 재승격 → 리비전). 확정 못 하면(잠금·충돌·기록 실패) 복사한 사진을 지우고 재사용하지 않는다.
  let verdict: 'ok' | BlogFrameRow | null = null;
  try {
    verdict = await withLedgerLock(o.ledgerFile, o.signal, () => {
      const clash = clashOf(readBlogFrameLedger(o.ledgerFile), frameLiveness(o.ledgerFile), hash, sig);
      if (clash) return clash;
      const from = row?.runId && row.runId !== o.runId ? row.runId : srcRun;
      appendBlogFrame(o.ledgerFile, {
        ts: new Date().toISOString(), runId: o.runId, ...(o.pieceId ? { pieceId: o.pieceId } : {}),
        mediaId, file: mediaFile, kind, atSec, species, ...(hash ? { hash } : {}), ...(sig ? { sig } : {}),
        status: 'used', ...(from ? { from } : {}),
      });
      return 'ok' as const;
    });
  } catch (e) {
    o.log(`이 글의 실촬영 컷 재사용 기록 실패(${e instanceof Error ? e.message : String(e)}) — 새 컷을 고른다`);
    verdict = null;
  }
  if (verdict !== 'ok') {
    try { fs.rmSync(o.dest, { force: true }); } catch { /* 무해 */ }
    o.log(verdict
      ? `이 글의 옛 실촬영 컷은 방금 다른 글(${verdict.runId})이 썼다 — 새 컷을 고른다`
      : '이 글의 실촬영 컷 재사용을 확정 못 함(원장 잠금·기록 실패) — 새 컷을 고른다');
    return null;
  }
  o.log(`블로그 실촬영 컷 — 같은 글의 기존 컷 재사용(${species} @${atSec}초, ${src ? '원 런 파일 복사' : '같은 순간 다시 뗌'}) · 새 컷 소비 없음`);
  return {
    file: o.dest, mediaId, mediaFile, atSec, species, tags: item?.tags ?? [],
    alt: realFrameAlt(species), ...(hash ? { hash } : {}), reused: true,
  };
}
