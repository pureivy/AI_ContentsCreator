import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 실제 ffmpeg·파이썬 대신 — 뗀 사진 파일만 쓰고 결과를 돌려준다.
const capture = vi.fn();
vi.mock('../tools/blog_skills', () => ({ captureBlogFrame: (...a: unknown[]) => capture(...a) }));

import { CONFIG } from '../config';
import { prepareRealFrame, breakStaleLock, FRAME_LOCK } from './realFrame';
import { readBlogFrameLedger, blogFrameLedgerPath, releaseBlogFramesOfDeletedPiece, FRAME_SIG_W, FRAME_SIG_H } from '../content/blogFrames';

// CONFIG 는 런타임 가변 객체(readonly 는 타입 힌트일 뿐) — 킬스위치·경로를 강제하고 복원한다.
const cfg = CONFIG as unknown as { blogRealFrame: boolean; dataDir: string; sessionsDir: string };
const saved = { ...cfg };

/** 무관한 두 화면을 가르는 서명 — seed 마다 다른 잡음. */
function sig(seed: number): string {
  const b = Buffer.alloc(FRAME_SIG_W * FRAME_SIG_H);
  let s = seed;
  for (let i = 0; i < b.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; b[i] = (s >> 16) & 255; }
  return b.toString('base64');
}

let root = '';
const logs: string[] = [];
const log = (m: string): void => { logs.push(m); };

function setupArchive(items: Array<{ id: string; species: string; seconds: number }>): void {
  const media = path.join(cfg.dataDir, 'media');
  fs.mkdirSync(media, { recursive: true });
  const rows = items.map((it, i) => {
    const file = path.join(media, `${it.id}.mp4`);
    fs.writeFileSync(file, 'x');
    return { id: it.id, file, kind: 'video', name: `${it.id}.mp4`, bytes: 1, seconds: it.seconds, species: it.species, tags: ['가을', '결실주'], createdTs: `2026-09-0${i + 1}T00:00:00Z` };
  });
  fs.writeFileSync(path.join(media, 'index.json'), JSON.stringify(rows), 'utf-8');
}

/** 성공 캡처 — 출력 파일을 실제로 쓰고 서명은 호출마다 다르게(같아 보이지 않는 화면). */
function okCapture(sigSeed = (n: number) => n): void {
  let n = 0;
  capture.mockImplementation(async (src: { atSec: number }, out: string) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, 'png');
    n++;
    // 해시는 호출마다 무관한 값(거리 ~32) — 이 테스트들은 서명으로 같은 화면을 가른다.
    return { ok: true, atSec: src.atSec, hash: Buffer.from(sig(1000 + n), 'base64').subarray(0, 8).toString('hex'), sig: sig(sigSeed(n)) };
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'realframe-'));
  cfg.dataDir = path.join(root, 'data');
  cfg.sessionsDir = path.join(root, 'sessions');
  cfg.blogRealFrame = true;
  capture.mockReset();
  logs.length = 0;
  setupArchive([{ id: 'media_gam1', species: '감나무', seconds: 17 }, { id: 'media_jadu', species: '자두나무', seconds: 30 }]);
});
const savedLock = { ...FRAME_LOCK };
afterEach(() => { Object.assign(cfg, saved); Object.assign(FRAME_LOCK, savedLock); });

describe('prepareRealFrame — 블로그 실촬영 컷 준비', () => {
  it('킬스위치 BLOG_REAL_FRAME=false 면 아무것도 안 한다(종전 — 전부 생성 이미지)', async () => {
    cfg.blogRealFrame = false;
    okCapture();
    expect(await prepareRealFrame({ runId: 'R1', topic: '감나무 가지치기', log })).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    expect(fs.existsSync(blogFrameLedgerPath(cfg.dataDir))).toBe(false);
  });

  it('주 수종 영상의 가운데 순간을 떼어 blog-image-01.png 로 쓰고 원장에 남긴다 — 다른 수종 영상은 안 본다', async () => {
    okCapture();
    const plan = await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log });
    expect(plan).toMatchObject({ mediaId: 'media_gam1', atSec: 8.5, species: '감나무', reused: false, alt: '감나무 — 비온디트리 농원에서 직접 촬영' });
    expect(plan!.file).toBe(path.join(cfg.sessionsDir, 'R1', 'images', 'blog-image-01.png'));
    expect(fs.existsSync(plan!.file)).toBe(true);
    expect(capture.mock.calls.every((c) => String((c[0] as { file: string }).file).includes('media_gam1'))).toBe(true);
    const rows = readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: 'R1', pieceId: 'P1', mediaId: 'media_gam1', status: 'used' });
    expect(fs.existsSync(path.join(cfg.sessionsDir, 'R1', 'images', '_real_frame_try.png'))).toBe(false); // 임시 파일 정리
  });

  it('같은 수종 둘째 글은 다른 순간 — 같은 순간을 다시 쓰지 않는다', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log });
    const b = await prepareRealFrame({ runId: 'R2', pieceId: 'P2', topic: '감나무 수확', log });
    expect(b!.atSec).not.toBe(a!.atSec);
    expect(Math.abs(b!.atSec - a!.atSec)).toBeGreaterThan(1.5);
  });

  it('같아 보이는 화면이면 거절하고 다음 후보로 — 거절도 원장에 남아 다음 글이 다시 시도하지 않는다', async () => {
    okCapture((n) => (n <= 2 ? 1 : n)); // 첫 글과 둘째 글의 첫 시도가 같은 화면(서명 같음)
    await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log });
    const b = await prepareRealFrame({ runId: 'R2', pieceId: 'P2', topic: '감나무 수확', log });
    expect(b).not.toBeNull();
    const rows = readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir));
    expect(rows.map((r) => r.status)).toEqual(['used', 'rejected', 'used']);
    expect(rows[1]!.reason).toMatch(/^dup:/);
    expect(rows[1]!.dupOf).toEqual({ mediaId: rows[0]!.mediaId, file: rows[0]!.file, atSec: rows[0]!.atSec }); // 대상이 풀리면 같이 풀린다
    expect(logs.some((m) => m.includes('같아 보임'))).toBe(true);
  });

  it('모든 순간을 다 쓰면 null + 소진 로그(전부 생성 이미지)', async () => {
    okCapture();
    for (let i = 0; i < 7; i++) expect(await prepareRealFrame({ runId: `R${i}`, pieceId: `P${i}`, topic: '감나무', log })).not.toBeNull();
    expect(await prepareRealFrame({ runId: 'R8', pieceId: 'P8', topic: '감나무', log })).toBeNull();
    expect(logs.at(-1)).toBe('블로그 실촬영 컷 소진 — 감나무 영상 추가 필요');
  });

  it('추출 실패는 fail-open — 거절로 기록하지 않고(일시 장애일 수 있다) null', async () => {
    capture.mockResolvedValue({ ok: false, error: '(블로그 스킬 비활성 — BLOG_PYTHON 미설정)' });
    expect(await prepareRealFrame({ runId: 'R1', topic: '감나무', log })).toBeNull();
    expect(readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir))).toEqual([]);
    expect(capture).toHaveBeenCalledTimes(1); // 스크립트가 안 도는 상태 — 남은 시도도 같아 바로 멈춘다
  });

  it('extract_failed 순간은 기한부로 기록 — 다음 런이 그 순간에 시도를 헛쓰지 않는다', async () => {
    okCapture();
    const ok = capture.getMockImplementation()!;
    capture.mockImplementationOnce(async () => ({ ok: false, error: 'extract_failed', badMoment: true }));
    const a = await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log });
    expect(a).not.toBeNull();
    const rows = readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir));
    expect(rows[0]).toMatchObject({ status: 'rejected', reason: 'bad:extract_failed', atSec: 8.5 });
    capture.mockClear();
    capture.mockImplementation(ok);
    await prepareRealFrame({ runId: 'R2', pieceId: 'P2', topic: '감나무 수확', log });
    expect(capture.mock.calls.some((c) => (c[0] as { atSec: number }).atSec === 8.5)).toBe(false);
  });

  it('보관소에 그 수종 소재가 없으면 null — 다른 수종 영상으로 채우지 않는다', async () => {
    okCapture();
    expect(await prepareRealFrame({ runId: 'R1', topic: '사과나무 전정', log })).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('리비전 런 — 같은 글은 자기 컷을 다시 쓴다(회귀: 리비전마다 새 컷을 먹으면 안 된다)', () => {
  async function original(): Promise<string> {
    okCapture();
    const plan = await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log });
    // finalize 가 남기는 매니페스트(실촬영 항목)
    fs.writeFileSync(path.join(cfg.sessionsDir, 'R1', 'image_manifest.json'), JSON.stringify({ images: [
      { index: 0, filename: 'blog-image-01.png', file_path: plan!.file, source: 'archive_frame', ai: false, mediaId: plan!.mediaId, atSec: plan!.atSec },
    ] }), 'utf-8');
    fs.writeFileSync(plan!.file, 'ORIGINAL');
    capture.mockClear();
    return plan!.mediaId;
  }

  it('원 런 세션의 파일을 복사한다 — 추출도 새 컷도 없고, 원장엔 같은 컷의 재사용 줄 하나(2026-10-02 2차 리뷰)', async () => {
    const mediaId = await original();
    const before = readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir));
    const r = await prepareRealFrame({ runId: 'R2', pieceId: 'P1', baseRunId: 'R1', topic: '감나무 가지치기', log });
    expect(r).toMatchObject({ mediaId, atSec: 8.5, reused: true });
    expect(fs.readFileSync(r!.file, 'utf-8')).toBe('ORIGINAL');
    expect(capture).not.toHaveBeenCalled();
    const after = readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir));
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ runId: 'R2', pieceId: 'P1', from: 'R1', status: 'used', mediaId, atSec: 8.5, hash: before[0]!.hash, sig: before[0]!.sig });
  });

  it('연쇄 리비전(원 런이 리비전 런) — piece 로 찾아 같은 컷', async () => {
    await original();
    const r2 = await prepareRealFrame({ runId: 'R2', pieceId: 'P1', baseRunId: 'R1', topic: '감나무 가지치기', log });
    fs.writeFileSync(path.join(cfg.sessionsDir, 'R2', 'image_manifest.json'), JSON.stringify({ images: [
      { index: 0, filename: 'blog-image-01.png', file_path: r2!.file, source: 'archive_frame', ai: false, mediaId: r2!.mediaId, atSec: r2!.atSec },
    ] }), 'utf-8');
    const r3 = await prepareRealFrame({ runId: 'R3', pieceId: 'P1', baseRunId: 'R2', topic: '감나무 가지치기', log });
    expect(r3).toMatchObject({ mediaId: r2!.mediaId, atSec: r2!.atSec, reused: true });
    expect(capture).not.toHaveBeenCalled();
    // 새 컷은 하나뿐 — 줄은 런마다 하나씩(같은 순간, from 으로 이어짐)
    const used = readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir)).filter((r) => r.status === 'used');
    expect(used.map((r) => [r.runId, r.from ?? null])).toEqual([['R1', null], ['R2', 'R1'], ['R3', 'R2']]);
    expect(new Set(used.map((r) => `${r.mediaId}@${r.atSec}`)).size).toBe(1);
  });

  it('원 런 파일이 없으면 원장의 순간을 정확히(exact) 다시 뗀다 — 새 순간을 고르지 않는다', async () => {
    await original();
    fs.rmSync(path.join(cfg.sessionsDir, 'R1'), { recursive: true, force: true });
    okCapture();
    const r = await prepareRealFrame({ runId: 'R2', pieceId: 'P1', baseRunId: 'R1', topic: '감나무 가지치기', log });
    expect(r).toMatchObject({ atSec: 8.5, reused: true });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![0]).toMatchObject({ atSec: 8.5, exact: true });
    const used = readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir)).filter((x) => x.status === 'used');
    expect(used.map((x) => [x.runId, x.atSec, x.from ?? null])).toEqual([['R1', 8.5, null], ['R2', 8.5, 'R1']]);
  });
});

describe('동시 런·잠금 — 같은 사진이 두 글에 나가면 안 된다(2026-10-02 리뷰)', () => {
  const imgOf = (rid: string): string => path.join(cfg.sessionsDir, rid, 'images', 'blog-image-01.png');
  const lockOf = (): string => `${blogFrameLedgerPath(cfg.dataDir)}.lock`;

  it('같은 수종 런 둘이 같은 원장을 읽고 같은 순간을 떼도 한쪽만 확정 — 다른 쪽은 양보하고 다른 순간', async () => {
    let started = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    let n = 0;
    capture.mockImplementation(async (src: { atSec: number }, out: string) => {
      if (++started === 2) open();
      await gate; // 둘 다 첫 원장 읽기·고르기를 마친 뒤에야 떼기가 끝난다
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, 'png');
      n++;
      return { ok: true, atSec: src.atSec, hash: Buffer.from(sig(2000 + n), 'base64').subarray(0, 8).toString('hex'), sig: sig(n) };
    });
    const [a, b] = await Promise.all([
      prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log }),
      prepareRealFrame({ runId: 'R2', topic: '감나무 수확', log }), // 수동 런(pieceId 없음)
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a!.atSec - b!.atSec)).toBeGreaterThan(1.5);
    const usedRows = readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir)).filter((r) => r.status === 'used');
    expect(usedRows).toHaveLength(2);
    expect(new Set(usedRows.map((r) => r.atSec)).size).toBe(2);
    expect(logs.some((m) => m.includes('양보'))).toBe(true);
    expect(fs.existsSync(lockOf())).toBe(false);
  });

  it('죽은 잠금(오래된 파일)은 깨고 진행한다', async () => {
    okCapture();
    fs.mkdirSync(path.dirname(lockOf()), { recursive: true });
    fs.writeFileSync(lockOf(), 'dead');
    const old = new Date(Date.now() - FRAME_LOCK.staleMs - 5_000);
    fs.utimesSync(lockOf(), old, old);
    expect(await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무', log })).not.toBeNull();
    expect(fs.existsSync(lockOf())).toBe(false);
  });

  it('죽은 잠금 깨기 — 고유 이름으로 옮긴 뒤 내용이 그대로면 지운다, 남은 찌꺼기 없음', () => {
    fs.mkdirSync(path.dirname(lockOf()), { recursive: true });
    fs.writeFileSync(lockOf(), 'dead');
    const old = new Date(Date.now() - FRAME_LOCK.staleMs - 5_000);
    fs.utimesSync(lockOf(), old, old);
    expect(breakStaleLock(lockOf(), 'dead')).toBe(true);
    expect(fs.existsSync(lockOf())).toBe(false);
    expect(fs.readdirSync(path.dirname(lockOf())).filter((f) => f.includes('.stale-'))).toEqual([]);
  });

  it('죽은 잠금 깨기 경합 — 그 사이 다른 프로세스가 새로 잡은 잠금이면 제자리로 되돌린다(지우지 않는다)', () => {
    fs.mkdirSync(path.dirname(lockOf()), { recursive: true });
    fs.writeFileSync(lockOf(), 'fresh-owner'); // 내가 본 것은 'dead' 였지만 지금은 남의 새 잠금
    expect(breakStaleLock(lockOf(), 'dead')).toBe(false);
    expect(fs.readFileSync(lockOf(), 'utf-8')).toBe('fresh-owner');
    expect(fs.readdirSync(path.dirname(lockOf())).filter((f) => f.includes('.stale-'))).toEqual([]);
    // 내용이 같아도 오래되지 않았으면(방금 새로 쓴 잠금) 되돌린다
    fs.writeFileSync(lockOf(), 'dead');
    expect(breakStaleLock(lockOf(), 'dead')).toBe(false);
    expect(fs.readFileSync(lockOf(), 'utf-8')).toBe('dead');
  });

  it('살아 있는 남의 잠금을 끝내 못 잡으면 확정하지 않는다 — null·원장 used 없음·사진 파일 없음', async () => {
    okCapture();
    FRAME_LOCK.waitMs = 150;
    fs.mkdirSync(path.dirname(lockOf()), { recursive: true });
    fs.writeFileSync(lockOf(), 'other');
    expect(await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무', log })).toBeNull();
    expect(readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir)).filter((r) => r.status === 'used')).toEqual([]);
    expect(fs.existsSync(imgOf('R1'))).toBe(false);
    expect(fs.readFileSync(lockOf(), 'utf-8')).toBe('other'); // 남의 잠금은 건드리지 않는다
  });

  it('원장 기록이 실패하면 옮긴 사진을 지운다 — 표시 없는 실사진이 생성 이미지로 발행되지 않게', async () => {
    okCapture();
    fs.mkdirSync(blogFrameLedgerPath(cfg.dataDir), { recursive: true }); // 원장 자리가 폴더 → 덧붙이기 실패
    expect(await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무', log })).toBeNull();
    expect(fs.existsSync(imgOf('R1'))).toBe(false);
  });
});

describe('예약 수명 — 버려진 초안은 컷을 돌려준다, 발행·진행 중인 글은 막는다', () => {
  const writePieces = (pieces: unknown[]): void => {
    fs.mkdirSync(path.join(cfg.dataDir, 'pieces'), { recursive: true });
    fs.writeFileSync(path.join(cfg.dataDir, 'pieces', 'index.json'), JSON.stringify(pieces), 'utf-8');
  };

  it('pieceId 없는 런이 초안 없이 끝나면(run.json·draft.json 없음) 그 순간을 다음 글이 쓸 수 있다', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R1', topic: '감나무 가지치기', log });
    fs.writeFileSync(path.join(cfg.sessionsDir, 'R1', 'run.json'), '{"status":"cancelled"}');
    const b = await prepareRealFrame({ runId: 'R2', pieceId: 'P2', topic: '감나무 수확', log });
    expect(b!.atSec).toBe(a!.atSec);
  });

  it('초안이 남은 런(글로 승격됐을 수 있다)·아직 도는 런의 컷은 막는다', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R1', topic: '감나무 가지치기', log }); // 아직 run.json 없음 = 도는 중
    const b = await prepareRealFrame({ runId: 'R2', topic: '감나무 수확', log });
    expect(Math.abs(b!.atSec - a!.atSec)).toBeGreaterThan(1.5);
    fs.writeFileSync(path.join(cfg.sessionsDir, 'R1', 'run.json'), '{}');
    fs.writeFileSync(path.join(cfg.sessionsDir, 'R1', 'draft.json'), '{}');
    const c = await prepareRealFrame({ runId: 'R3', topic: '감나무 비료', log });
    expect(Math.abs(c!.atSec - a!.atSec)).toBeGreaterThan(1.5);
  });

  it('발행된 글의 컷은 끝까지 막힌다 — 버려진(error) 글의 컷은 풀린다', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log });
    writePieces([{ id: 'P1', runId: 'R1', stage: 'published', publishedUrl: 'https://blog.naver.com/x/1' }]);
    const b = await prepareRealFrame({ runId: 'R2', pieceId: 'P2', topic: '감나무 수확', log });
    expect(Math.abs(b!.atSec - a!.atSec)).toBeGreaterThan(1.5);
    writePieces([{ id: 'P1', runId: 'R1', stage: 'published' }, { id: 'P2', runId: 'R2', stage: 'error' }]);
    const c = await prepareRealFrame({ runId: 'R3', pieceId: 'P3', topic: '감나무 비료', log });
    expect(c!.atSec).toBe(b!.atSec);
  });

  it('버려졌다 되살아난 글 — 그사이 다른 글이 그 컷을 가져갔으면 옛 컷을 다시 쓰지 않고 새로 고른다', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log });
    fs.writeFileSync(path.join(cfg.sessionsDir, 'R1', 'image_manifest.json'), JSON.stringify({ images: [
      { index: 0, filename: 'blog-image-01.png', file_path: a!.file, source: 'archive_frame', ai: false, mediaId: a!.mediaId, atSec: a!.atSec },
    ] }), 'utf-8');
    writePieces([{ id: 'P1', runId: 'R1', stage: 'error' }]);
    const b = await prepareRealFrame({ runId: 'R2', pieceId: 'P2', topic: '감나무 수확', log });
    expect(b!.atSec).toBe(a!.atSec); // 반납된 컷을 다른 글이 받음
    writePieces([{ id: 'P1', runId: 'R1', stage: 'research' }, { id: 'P2', runId: 'R2', stage: 'ready' }]);
    const r = await prepareRealFrame({ runId: 'R3', pieceId: 'P1', baseRunId: 'R1', topic: '감나무 가지치기', log });
    expect(r).toMatchObject({ reused: false });
    expect(Math.abs(r!.atSec - a!.atSec)).toBeGreaterThan(1.5);
    expect(logs.some((m) => m.includes('다른 글(R2)이 썼다'))).toBe(true);
  });
});

describe('재사용도 원장에 줄을 남긴다 — 발행 흔적이 있는 글의 컷은 끝까지 막힌다(2026-10-02 2차 리뷰)', () => {
  const writePieces = (pieces: unknown[]): void => {
    fs.mkdirSync(path.join(cfg.dataDir, 'pieces'), { recursive: true });
    fs.writeFileSync(path.join(cfg.dataDir, 'pieces', 'index.json'), JSON.stringify(pieces), 'utf-8');
  };
  /** finalize 가 남기는 것 — 실촬영 매니페스트 항목·초안·런 끝 표시. */
  const finishRun = (rid: string, plan: { file: string; mediaId: string; atSec: number }): void => {
    const dir = path.join(cfg.sessionsDir, rid);
    fs.writeFileSync(path.join(dir, 'image_manifest.json'), JSON.stringify({ images: [
      { index: 0, filename: 'blog-image-01.png', file_path: plan.file, source: 'archive_frame', ai: false, mediaId: plan.mediaId, atSec: plan.atSec },
    ] }), 'utf-8');
    fs.writeFileSync(path.join(dir, 'draft.json'), '{}');
    fs.writeFileSync(path.join(dir, 'run.json'), '{}');
  };
  const usedRows = () => readBlogFrameLedger(blogFrameLedgerPath(cfg.dataDir)).filter((r) => r.status === 'used');

  it('회귀: 글 삭제(반납) → 같은 런을 새 글로 재승격 → 리비전 → 발행 — 셋째 글이 그 컷을 받으면 안 된다', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R', pieceId: 'P1', topic: '감나무 가지치기', log });
    finishRun('R', a!);
    // P1 삭제(미발행 — 반납 줄) → 같은 런 R 을 P2 로 재승격
    expect(releaseBlogFramesOfDeletedPiece({ id: 'P1', runId: 'R', stage: 'ready' }, { dataDir: cfg.dataDir, sessionsDir: cfg.sessionsDir })).toBe(true);
    writePieces([{ id: 'P2', runId: 'R', stage: 'ready' }]);
    // P2 리비전 — 같은 컷을 재사용하고 원장에 자기 줄을 남긴다
    const r = await prepareRealFrame({ runId: 'R2', pieceId: 'P2', baseRunId: 'R', topic: '감나무 가지치기', log });
    expect(r).toMatchObject({ mediaId: a!.mediaId, atSec: a!.atSec, reused: true });
    const mine = usedRows().filter((x) => x.runId === 'R2');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ pieceId: 'P2', from: 'R', mediaId: a!.mediaId, atSec: a!.atSec, hash: usedRows()[0]!.hash });
    // piece.runId 가 R2 로 옮겨 가고 발행된다 — 옛 줄(R·P1)은 주인이 없고 반납 줄에 덮여 풀렸다
    finishRun('R2', r!);
    writePieces([{ id: 'P2', runId: 'R2', stage: 'published', publishedUrl: 'https://blog.naver.com/x/2' }]);
    const c = await prepareRealFrame({ runId: 'R9', pieceId: 'P9', topic: '감나무 비료', log });
    expect(c).not.toBeNull();
    expect(Math.abs(c!.atSec - a!.atSec)).toBeGreaterThan(1.5);
  });

  it('pieceId 없는 런에서 승격된 글의 연쇄 리비전 — 자기 옛 줄과 부딪히지 않고 같은 컷을 계속 쓴다', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R0', topic: '감나무 가지치기', log }); // 컴포저 런(pieceId 없음)
    finishRun('R0', a!);
    writePieces([{ id: 'P', runId: 'R0', stage: 'ready' }]);
    const r1 = await prepareRealFrame({ runId: 'R1', pieceId: 'P', baseRunId: 'R0', topic: '감나무 가지치기', log });
    expect(r1).toMatchObject({ atSec: a!.atSec, reused: true });
    finishRun('R1', r1!);
    writePieces([{ id: 'P', runId: 'R1', stage: 'ready' }]);
    fs.rmSync(path.join(cfg.sessionsDir, 'R1', 'image_manifest.json')); // 매니페스트 없이 원장 줄만으로도 찾는다
    const r2 = await prepareRealFrame({ runId: 'R2', pieceId: 'P', baseRunId: 'R1', topic: '감나무 가지치기', log });
    expect(r2).toMatchObject({ mediaId: a!.mediaId, atSec: a!.atSec, reused: true });
    expect(logs.some((m) => m.includes('다른 글'))).toBe(false);
    expect(usedRows().map((x) => [x.runId, x.from ?? null])).toEqual([['R0', null], ['R1', 'R0'], ['R2', 'R1']]);
    // 발행 뒤 셋째 글은 그 컷을 못 받는다(옛 런 R0 세션이 치워져도)
    writePieces([{ id: 'P', runId: 'R2', stage: 'published', publishedUrl: 'https://blog.naver.com/x/3' }]);
    fs.rmSync(path.join(cfg.sessionsDir, 'R0'), { recursive: true, force: true });
    const c = await prepareRealFrame({ runId: 'R9', pieceId: 'P9', topic: '감나무 비료', log });
    expect(Math.abs(c!.atSec - a!.atSec)).toBeGreaterThan(1.5);
  });

  it('pieceId 없는 리비전 런(수동) — 원 런 줄을 자기 것으로 보고 재사용, 줄은 pieceId 없이 from 만', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R0', topic: '감나무 가지치기', log });
    finishRun('R0', a!);
    const r = await prepareRealFrame({ runId: 'R1', baseRunId: 'R0', topic: '감나무 가지치기', log });
    expect(r).toMatchObject({ atSec: a!.atSec, reused: true });
    const row = usedRows().find((x) => x.runId === 'R1');
    expect(row).toMatchObject({ from: 'R0', atSec: a!.atSec });
    expect(row!.pieceId).toBeUndefined();
  });

  it('재사용 확정에 잠금을 못 잡으면 복사한 사진을 지우고 재사용하지 않는다', async () => {
    okCapture();
    const a = await prepareRealFrame({ runId: 'R1', pieceId: 'P1', topic: '감나무 가지치기', log });
    finishRun('R1', a!);
    FRAME_LOCK.waitMs = 120;
    const lock = `${blogFrameLedgerPath(cfg.dataDir)}.lock`;
    fs.writeFileSync(lock, 'other');
    expect(await prepareRealFrame({ runId: 'R2', pieceId: 'P1', baseRunId: 'R1', topic: '감나무 가지치기', log })).toBeNull();
    expect(fs.existsSync(path.join(cfg.sessionsDir, 'R2', 'images', 'blog-image-01.png'))).toBe(false);
    expect(usedRows().filter((x) => x.runId === 'R2')).toEqual([]);
  });
});
