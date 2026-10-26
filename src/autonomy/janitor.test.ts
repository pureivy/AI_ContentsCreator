import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { appendBlogFrame, blogFrameLedgerPath, readBlogFrameReleases } from '../content/blogFrames';
import { daysSince, isShortPublished, shortPublishedTs, isStaleUnpublishedShort, shortPruneTargets, cardPruneTargets, longformPruneTargets, trashEntryExpired, runJanitor, orphanGuardReason, isShortBackupLeftover, isRealignLeftover, isCardRenderLeftover, type JanitorDeps } from './janitor';

const NOW = new Date('2026-09-10T03:30:00+09:00');
const ago = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('janitor 순수 판정(2026-09-10 저장공간 정리)', () => {
  it('daysSince — 파싱 실패는 null', () => {
    expect(daysSince(ago(3), NOW)).toBe(3);
    expect(daysSince(undefined, NOW)).toBeNull();
    expect(daysSince('x', NOW)).toBeNull();
  });
  it('isShortPublished — 어느 채널이든 id·발행시각이 있으면 발행. 빈 문자열은 미발행', () => {
    expect(isShortPublished({ youtubeId: 'y' })).toBe(true);
    expect(isShortPublished({ naverClipNo: '7617327' })).toBe(true); // 클립에만 올라간 편(2026-10-02)
    expect(isShortPublished({ metaPublishedTs: ago(1) })).toBe(true);
    expect(isShortPublished({ youtubeId: '', igReelId: '' })).toBe(false);
  });
  it('shortPublishedTs — 유튜브·메타 시각 우선, 없으면 발행된 편만 갱신 시각', () => {
    expect(shortPublishedTs({ id: 'a', stage: 'ready', youtubeId: 'y', youtubeTs: ago(5), updatedTs: ago(1), createdTs: ago(9) })).toBe(ago(5));
    expect(shortPublishedTs({ id: 'a', stage: 'ready', igReelId: 'i', updatedTs: ago(1), createdTs: ago(9) })).toBe(ago(1));
    expect(shortPublishedTs({ id: 'a', stage: 'ready', updatedTs: ago(1), createdTs: ago(9) })).toBeUndefined();
  });
  it('isStaleUnpublishedShort — 미발행 ready/error 가 30일 넘으면 버린 편, 생성 중·발행됨·최근 편은 아님', () => {
    expect(isStaleUnpublishedShort({ id: 'a', stage: 'ready', createdTs: ago(31) }, NOW, 30)).toBe(true);
    expect(isStaleUnpublishedShort({ id: 'a', stage: 'error', createdTs: ago(40) }, NOW, 30)).toBe(true);
    expect(isStaleUnpublishedShort({ id: 'a', stage: 'ready', createdTs: ago(29) }, NOW, 30)).toBe(false);
    expect(isStaleUnpublishedShort({ id: 'a', stage: 'planning', createdTs: ago(90) }, NOW, 30)).toBe(false);
    expect(isStaleUnpublishedShort({ id: 'a', stage: 'ready', youtubeId: 'y', createdTs: ago(90) }, NOW, 30)).toBe(false);
  });
  it('shortPruneTargets — 참조·캐시·렌더 잔여는 항상, 씬·클립·낭독은 발행 14일 뒤에만. sources.json 은 대상이 아니다', () => {
    const a = shortPruneTargets(false, null, 14);
    expect(a).toEqual(['refs', 'scenes/_refnorm', 'download.mp4', 'remotion/bundle', 'remotion/public',
      'motion-*/bgframes', 'motion-*/.remotion', 'motion-*/preview', 'motion-*/bg-nocards.mp4']);
    expect(shortPruneTargets(true, 13, 14)).toEqual(a);
    const b = shortPruneTargets(true, 14, 14);
    for (const t of ['scenes', 'scenes-retry', 'clips/*.mp4', 'remotion', 'motion-*', 'pilot-*', 'final.basic.mp4']) expect(b).toContain(t);
    expect(b).not.toContain('clips');
    expect(b).not.toContain('final.mp4');
    expect(b).not.toContain('preview.mp4');
  });
  it('cardPruneTargets — 발행 14일 뒤 배경·레퍼런스만. 슬라이드는 절대 대상이 아니다', () => {
    expect(cardPruneTargets(false, null, 14)).toEqual(['bg/_refnorm']);
    expect(cardPruneTargets(true, 20, 14)).toEqual(['bg/_refnorm', 'bg', 'bg-repair', 'refs']);
  });
  it('trashEntryExpired — 7일 경과 판정', () => {
    expect(trashEntryExpired(NOW.getTime() - 8 * 86_400_000, NOW, 7)).toBe(true);
    expect(trashEntryExpired(NOW.getTime() - 6 * 86_400_000, NOW, 7)).toBe(false);
  });
});

describe('runJanitor — 임시 data 디렉터리에서 실제 이동·삭제(fail-open)', () => {
  const mk = (): { root: string; deps: JanitorDeps; removed: string[] } => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-'));
    const w = (rel: string, size = 10): void => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(size)); };
    // 발행 20일 지난 쇼츠 — 중간 산출물 정리 대상, sources.json·final·preview 는 남는다
    w('shorts/short_pub/scenes/blog-image-01.png', 100); w('shorts/short_pub/clips/user_02.mp4', 100); w('shorts/short_pub/clips/sources.json', 5);
    w('shorts/short_pub/remotion/narr_01.mp3', 50); w('shorts/short_pub/refs/species-ref.jpg', 30); w('shorts/short_pub/download.mp4', 200);
    w('shorts/short_pub/preview.mp4', 40); w('shorts/short_pub/plan.json', 5); w('shorts/short_pub/thumbnail.jpg', 5);
    // 모션그래픽(2026-10-22) — 발행 20일: 작업 폴더·시범 폴더·모션그래픽 전 원본까지
    w('shorts/short_pub/motion-1/scene_02.html', 5); w('shorts/short_pub/motion-1/bgframes/scene_02/0001.jpg', 100);
    w('shorts/short_pub/pilot-direct/metrics.json', 5); w('shorts/short_pub/final.basic.mp4', 300);
    // 발행 3일 된 쇼츠 — 참조·캐시만
    w('shorts/short_new/scenes/blog-image-01.png', 100); w('shorts/short_new/refs/x.jpg', 30); w('shorts/short_new/final.mp4', 300);
    // 모션그래픽 — 발행 3일: 무거운 중간물만, 장면 HTML·시범 폴더·원본은 남는다
    w('shorts/short_new/motion-1/scene_02.html', 5); w('shorts/short_new/motion-1/bgframes/scene_02/0001.jpg', 100);
    w('shorts/short_new/motion-1/.remotion/bundle/b.js', 50); w('shorts/short_new/motion-1/preview/scene_02_t0.5.png', 40);
    w('shorts/short_new/motion-2/bg-nocards.mp4', 200); w('shorts/short_new/pilot-direct/bgframes/scene_02/0001.jpg', 100);
    w('shorts/short_new/final.basic.mp4', 300);
    // 미발행 40일 ready — 색인에서 빼고 통째로 휴지통
    w('shorts/short_stale/final.mp4', 300); w('shorts/short_stale/plan.json', 5);
    // 고아 폴더
    w('shorts/short_orphan/final.mp4', 300);
    // 생성 중(isRunning) — 절대 안 건드림
    w('shorts/short_running/refs/x.jpg', 30);
    // 카드뉴스 — 발행 20일: bg·refs 정리, 슬라이드 유지 / 고아
    w('cardnews/card_pub/bg/blog-image-01.png', 100); w('cardnews/card_pub/refs/r.png', 50); w('cardnews/card_pub/slide_01.png', 80);
    w('cardnews/card_orphan/slide_01.png', 80);
    // 세션 — 연결·발행 20일: 매니페스트 밖 이미지·스크린샷 정리 / 미연결 40일: 통째 / 미연결 5일: 유지
    w('sessions/aaaaaaaa1111/images/blog-image-01.png', 100); w('sessions/aaaaaaaa1111/images/blog-image-02.png', 100);
    w('sessions/aaaaaaaa1111/screenshots/s.png', 20); w('sessions/aaaaaaaa1111/draft.md', 5);
    fs.writeFileSync(path.join(root, 'sessions/aaaaaaaa1111/06_image_manifest.json'), JSON.stringify({ images: [{ file_path: '/x/images/blog-image-01.png' }] }));
    w('sessions/bbbbbbbb2222/run.json', 5); fs.utimesSync(path.join(root, 'sessions/bbbbbbbb2222/run.json'), new Date(NOW.getTime() - 40 * 86_400_000), new Date(NOW.getTime() - 40 * 86_400_000));
    w('sessions/cccccccc3333/run.json', 5);
    // 휴지통 — 10일 지난 항목은 영구 삭제, 어제 것은 유지
    w('.trash/old-entry/f.bin', 500); fs.utimesSync(path.join(root, '.trash/old-entry'), new Date(NOW.getTime() - 10 * 86_400_000), new Date(NOW.getTime() - 10 * 86_400_000));
    w('.trash/fresh-entry/f.bin', 500);
    const removed: string[] = [];
    const deps: JanitorDeps = {
      dataDir: root, sessionsDir: path.join(root, 'sessions'),
      shorts: () => [
        { id: 'short_pub', stage: 'ready', platform: 'youtube', youtubeId: 'y', youtubeTs: ago(20), createdTs: ago(21), videoArchivedTs: ago(19) },
        { id: 'short_new', stage: 'ready', platform: 'youtube', youtubeId: 'y', youtubeTs: ago(3), createdTs: ago(4) },
        { id: 'short_stale', stage: 'ready', createdTs: ago(40) },
        { id: 'short_running', stage: 'rendering', createdTs: ago(0) },
      ],
      cards: () => [{ id: 'card_pub', stage: 'ready', igMediaId: 'i', metaPublishedTs: ago(20), createdTs: ago(21) }],
      pieces: () => [{ id: 'p1', runId: 'aaaaaaaa1111', publishedUrl: 'https://n/1', publishedTs: ago(20) }],
      removeShort: (id) => { removed.push(id); },
      isShortRunning: (id) => id === 'short_running',
      isSessionRunning: () => false,
      archiveShort: async (id) => (id === 'short_new' ? 225 : 0),
    };
    return { root, deps, removed };
  };
  const exists = (root: string, rel: string): boolean => fs.existsSync(path.join(root, rel));

  it('dryRun 은 아무것도 옮기지 않고 회수량만 낸다', async () => {
    const { root, deps, removed } = mk();
    const r = await runJanitor(deps, { now: NOW, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(removed).toEqual([]);
    expect(exists(root, 'shorts/short_orphan/final.mp4')).toBe(true);
    expect(exists(root, '.trash/old-entry/f.bin')).toBe(true);
    expect(r.moved['orphan-shorts']?.bytes).toBe(300);
    expect(r.deletedShorts).toEqual(['short_stale']);
    expect(r.totalBytes).toBeGreaterThan(0);
  });

  it('실행 — 규칙대로 옮기고, 남길 것은 남기고, 진행 중은 건드리지 않는다', async () => {
    const { root, deps, removed } = mk();
    const r = await runJanitor(deps, { now: NOW });
    // 발행 20일 쇼츠: 중간 산출물은 휴지통, sources.json·preview·plan·thumbnail 은 유지
    expect(exists(root, 'shorts/short_pub/scenes')).toBe(false);
    expect(exists(root, 'shorts/short_pub/clips/user_02.mp4')).toBe(false);
    expect(exists(root, 'shorts/short_pub/clips/sources.json')).toBe(true);
    expect(exists(root, 'shorts/short_pub/remotion')).toBe(false);
    expect(exists(root, 'shorts/short_pub/download.mp4')).toBe(false);
    expect(exists(root, 'shorts/short_pub/preview.mp4')).toBe(true);
    expect(exists(root, 'shorts/short_pub/plan.json')).toBe(true);
    // 발행 3일 쇼츠: 참조만 치우고 씬·원본 유지, 원본 교체는 deps 가 수행(225 회수 보고)
    expect(exists(root, 'shorts/short_new/refs')).toBe(false);
    expect(exists(root, 'shorts/short_new/scenes/blog-image-01.png')).toBe(true);
    expect(r.archived).toEqual({ n: 1, bytes: 225 });
    // 모션그래픽 — 발행 3일: 바탕 프레임·번들·미리보기·바탕판만, 장면 HTML·시범 캐시·원본은 유지
    expect(exists(root, 'shorts/short_new/motion-1/bgframes')).toBe(false);
    expect(exists(root, 'shorts/short_new/motion-1/.remotion')).toBe(false);
    expect(exists(root, 'shorts/short_new/motion-1/preview')).toBe(false);
    expect(exists(root, 'shorts/short_new/motion-2/bg-nocards.mp4')).toBe(false);
    expect(exists(root, 'shorts/short_new/motion-1/scene_02.html')).toBe(true);
    expect(exists(root, 'shorts/short_new/pilot-direct/bgframes/scene_02/0001.jpg')).toBe(true);
    expect(exists(root, 'shorts/short_new/final.basic.mp4')).toBe(true);
    expect(exists(root, '.trash/janitor-20260910/shorts-intermediates/short_new/motion-1/bgframes/scene_02/0001.jpg')).toBe(true);
    // 모션그래픽 — 발행 20일: 폴더 통째·시범 폴더·모션그래픽 전 원본
    expect(exists(root, 'shorts/short_pub/motion-1')).toBe(false);
    expect(exists(root, 'shorts/short_pub/pilot-direct')).toBe(false);
    expect(exists(root, 'shorts/short_pub/final.basic.mp4')).toBe(false);
    // 미발행 40일: 색인 제거 + 통째 휴지통
    expect(removed).toEqual(['short_stale']);
    expect(exists(root, 'shorts/short_stale')).toBe(false);
    // 고아·진행 중
    expect(exists(root, 'shorts/short_orphan')).toBe(false);
    expect(exists(root, 'shorts/short_running/refs/x.jpg')).toBe(true);
    // 카드뉴스
    expect(exists(root, 'cardnews/card_pub/bg')).toBe(false);
    expect(exists(root, 'cardnews/card_pub/refs')).toBe(false);
    expect(exists(root, 'cardnews/card_pub/slide_01.png')).toBe(true);
    expect(exists(root, 'cardnews/card_orphan')).toBe(false);
    // 세션
    expect(exists(root, 'sessions/aaaaaaaa1111/images/blog-image-01.png')).toBe(true);
    expect(exists(root, 'sessions/aaaaaaaa1111/images/blog-image-02.png')).toBe(false);
    expect(exists(root, 'sessions/aaaaaaaa1111/screenshots')).toBe(false);
    expect(exists(root, 'sessions/bbbbbbbb2222')).toBe(false);
    expect(exists(root, 'sessions/cccccccc3333')).toBe(true);
    // 휴지통: 10일 지난 것만 영구 삭제, 이번에 옮긴 것은 janitor-YYYYMMDD 아래
    expect(exists(root, '.trash/old-entry')).toBe(false);
    expect(exists(root, '.trash/fresh-entry/f.bin')).toBe(true);
    expect(exists(root, '.trash/janitor-20260910/orphan-shorts/short_orphan/final.mp4')).toBe(true);
    expect(r.purged).toEqual({ n: 1, bytes: 500 });
    expect(r.errors).toEqual([]);
  });

  it('두 번 돌려도 멱등 — 두 번째는 옮길 것이 없다', async () => {
    const { deps } = mk();
    await runJanitor(deps, { now: NOW });
    const r2 = await runJanitor({ ...deps, shorts: () => deps.shorts().filter((s) => s.id !== 'short_stale') }, { now: NOW });
    expect(Object.values(r2.moved).reduce((a, m) => a + m.n, 0)).toBe(0);
    expect(r2.purged.n).toBe(0);
  });
});

describe('runJanitor — 작업 산출 폴더(out/)', () => {
  it('keepDays 지난 항목만 휴지통으로, 최근 것은 남긴다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-out-'));
    const out = path.join(root, 'out'); fs.mkdirSync(path.join(out, 'tech'), { recursive: true });
    fs.writeFileSync(path.join(out, 'old.mp4'), Buffer.alloc(100)); fs.writeFileSync(path.join(out, 'tech', 'x.png'), Buffer.alloc(10)); fs.writeFileSync(path.join(out, 'fresh.png'), Buffer.alloc(10));
    const old = new Date(NOW.getTime() - 20 * 86_400_000);
    fs.utimesSync(path.join(out, 'old.mp4'), old, old); fs.utimesSync(path.join(out, 'tech'), old, old);
    const deps: JanitorDeps = {
      dataDir: root, sessionsDir: path.join(root, 'sessions'), shorts: () => [], cards: () => [], pieces: () => [],
      removeShort: () => {}, isShortRunning: () => false, isSessionRunning: () => false, archiveShort: async () => 0, scratchDirs: [out],
    };
    const r = await runJanitor(deps, { now: NOW });
    expect(fs.existsSync(path.join(out, 'old.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'tech'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'fresh.png'))).toBe(true);
    expect(r.moved['scratch-out']).toEqual({ n: 2, bytes: 110 });
  });
});

describe('runJanitor — 미연결 세션을 치우기 전 실촬영 컷 반납(2026-10-02 2차 리뷰)', () => {
  const mk = (withDraft: boolean) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-frames-'));
    const run = 'dddddddd4444';
    const dir = path.join(root, 'sessions', run);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), '{}');
    if (withDraft) fs.writeFileSync(path.join(dir, 'draft.json'), '{}');
    const old = new Date(NOW.getTime() - 40 * 86_400_000);
    fs.utimesSync(path.join(dir, 'run.json'), old, old);
    appendBlogFrame(blogFrameLedgerPath(root), { ts: ago(40), runId: run, mediaId: 'a', file: '/m/a.mp4', kind: 'video', atSec: 8.5, species: '감나무', status: 'used' });
    const deps: JanitorDeps = {
      // 글 색인이 비면 2026-10-26 안전장치가 '색인 사고'로 보고 미연결 세션 정리를 멈춘다 — 다른 런에 연결된 글 하나를 둔다.
      dataDir: root, sessionsDir: path.join(root, 'sessions'), shorts: () => [], cards: () => [], pieces: () => [{ id: 'p_other', runId: 'ffffffff6666' }],
      removeShort: () => {}, isShortRunning: () => false, isSessionRunning: () => false, archiveShort: async () => 0,
    };
    return { root, run, dir, deps, releases: () => readBlogFrameReleases(blogFrameLedgerPath(root)) };
  };

  it('초안 없는 미연결 세션 — 반납 줄을 남긴 뒤 휴지통으로', async () => {
    const t = mk(false);
    await runJanitor(t.deps, { now: NOW });
    expect(fs.existsSync(t.dir)).toBe(false);
    expect(t.releases()).toEqual([expect.objectContaining({ runIds: [t.run], frames: [], reason: 'janitor-unlinked' })]);
  });

  it('초안이 있으면 반납하지 않는다(세션은 종전처럼 치운다) · dryRun 은 아무것도 안 쓴다', async () => {
    const a = mk(true);
    await runJanitor(a.deps, { now: NOW });
    expect(fs.existsSync(a.dir)).toBe(false);
    expect(a.releases()).toEqual([]);
    const b = mk(false);
    await runJanitor(b.deps, { now: NOW, dryRun: true });
    expect(fs.existsSync(b.dir)).toBe(true);
    expect(b.releases()).toEqual([]);
  });

  it('발행 흔적이 있는 글이 같은 컷을 쓰면 반납하지 않는다', async () => {
    const t = mk(false);
    appendBlogFrame(blogFrameLedgerPath(t.root), { ts: ago(30), runId: 'eeeeeeee5555', pieceId: 'P', from: t.run, mediaId: 'a', file: '/m/a.mp4', kind: 'video', atSec: 8.5, species: '감나무', status: 'used' });
    fs.mkdirSync(path.join(t.root, 'pieces'), { recursive: true });
    fs.writeFileSync(path.join(t.root, 'pieces', 'index.json'), JSON.stringify([{ id: 'P', runId: 'eeeeeeee5555', stage: 'published', publishedUrl: 'https://n/1' }]));
    await runJanitor({ ...t.deps, pieces: () => [{ id: 'P', runId: 'eeeeeeee5555', publishedUrl: 'https://n/1' }] }, { now: NOW });
    expect(t.releases()).toEqual([]);
  });
});

describe('janitor 롱폼(2026-10-22)', () => {
  it('longformPruneTargets — 렌더 잔여·스틸은 항상, 낭독·클립·그림 작업물·remotion 은 유튜브 발행 14일 뒤. 완성 영상·대본은 대상이 아니다', () => {
    // 전체 화면 렌더(2026-10-23 기본값)의 번들·스테이징·대조표 스틸도 항상.
    const always = ['remotion/bundle', 'remotion/public', 'stills', 'scenes/work', 'scenes/stills', 'scenes/.render', 'remotion-full/bundle', 'remotion-full/public', 'remotion-full/stills'];
    expect(longformPruneTargets(false, null, 14)).toEqual(always);
    expect(longformPruneTargets(true, 13, 14)).toEqual(always);
    const b = longformPruneTargets(true, 14, 14);
    for (const t of ['audio', 'clips', 'mg', 'scenes', 'remotion', 'remotion-entry', 'remotion-entry-full', 'remotion-full', 'refs']) expect(b).toContain(t);
    for (const keep of ['final.mp4', 'thumbnail.jpg', 'script.json', 'timeline.json', 'subtitles.srt', 'youtube.txt', 'sources.md', 'contact.jpg', 'species']) expect(b).not.toContain(keep);
  });

  it('runJanitor — 발행 20일 편은 재료까지, 미발행 편은 렌더 잔여만, 제작 중인 편은 건드리지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-lf-'));
    const w = (rel: string, size = 10): void => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(size)); };
    for (const d of ['2026-08-17-prune', '2026-09-07-plant', '2026-09-10-care']) {
      for (const f of ['final.mp4', 'thumbnail.jpg', 'script.json', 'timeline.json', 'subtitles.srt', 'youtube.txt', 'sources.md', 'audio/intro-01.mp3', 'clips/intro-01.mp4', 'mg/s01.png', 'remotion/bundle/b.js', 'remotion/public/a.mp3', 'stills/f1.png',
        'remotion-full/bundle/b.js', 'remotion-full/public/a.mp3', 'remotion-entry-full/index.ts', 'refs/감나무/01.jpg', 'species/index.json', 'contact.jpg']) w(`longform/${d}/${f}`);
    }
    const deps: JanitorDeps = {
      dataDir: root, sessionsDir: path.join(root, 'sessions'),
      shorts: () => [], cards: () => [], pieces: () => [],
      removeShort: () => {}, isShortRunning: () => false, isSessionRunning: () => false, archiveShort: async () => 0,
      longform: () => [
        { id: 'long_a', dir: '2026-08-17-prune', stage: 'ready', youtubeId: 'y', youtubeTs: ago(20) },
        { id: 'long_b', dir: '2026-09-07-plant', stage: 'ready' },
        { id: 'long_c', dir: '2026-09-10-care', stage: 'producing' },
        { id: 'long_bad', dir: '../shorts', stage: 'ready', youtubeId: 'y', youtubeTs: ago(30) },
      ],
      isLongformRunning: () => false,
    };
    const r = await runJanitor(deps, { now: NOW });
    const ex = (rel: string) => fs.existsSync(path.join(root, 'longform', rel));
    for (const gone of ['audio', 'clips', 'mg', 'remotion', 'stills', 'remotion-full', 'remotion-entry-full', 'refs']) expect(ex(`2026-08-17-prune/${gone}`)).toBe(false);
    for (const keep of ['final.mp4', 'thumbnail.jpg', 'script.json', 'timeline.json', 'subtitles.srt', 'youtube.txt', 'sources.md', 'contact.jpg', 'species/index.json']) expect(ex(`2026-08-17-prune/${keep}`)).toBe(true);
    // 미발행 편 — 렌더 잔여·스틸만, 다시 렌더할 재료는 남는다
    expect(ex('2026-09-07-plant/remotion/bundle')).toBe(false);
    expect(ex('2026-09-07-plant/stills')).toBe(false);
    expect(ex('2026-09-07-plant/audio/intro-01.mp3')).toBe(true);
    expect(ex('2026-09-07-plant/clips/intro-01.mp4')).toBe(true);
    expect(ex('2026-09-07-plant/remotion-full/bundle')).toBe(false);
    expect(ex('2026-09-07-plant/remotion-full/public')).toBe(false);
    expect(ex('2026-09-07-plant/remotion-entry-full/index.ts')).toBe(true);
    expect(ex('2026-09-07-plant/refs/감나무/01.jpg')).toBe(true);
    // 제작 중 — 그대로
    expect(ex('2026-09-10-care/remotion/bundle/b.js')).toBe(true);
    expect(ex('2026-09-10-care/stills/f1.png')).toBe(true);
    expect(r.moved['longform-intermediates']?.n).toBeGreaterThan(0);
    expect(r.errors).toEqual([]);
  });
});

describe('janitor 고아 규칙 안전장치·크래시 잔여물(2026-10-26)', () => {
  it('orphanGuardReason — 깨짐·빈 색인+폴더·20% 초과는 멈춤, 3개 이하는 몫과 무관하게 허용', () => {
    expect(orphanGuardReason({ corrupt: false, indexSize: 300, folders: 300, candidates: 0 })).toBeNull();
    expect(orphanGuardReason({ corrupt: true, indexSize: 0, folders: 300, candidates: 300 })).toContain('깨져');
    expect(orphanGuardReason({ corrupt: false, indexSize: 0, folders: 300, candidates: 300 })).toContain('비었는데');
    expect(orphanGuardReason({ corrupt: false, indexSize: 200, folders: 300, candidates: 100 })).toContain('20%');
    expect(orphanGuardReason({ corrupt: false, indexSize: 280, folders: 300, candidates: 20 })).toBeNull();
    expect(orphanGuardReason({ corrupt: false, indexSize: 2, folders: 5, candidates: 3 })).toBeNull();
  });
  it('잔여물 이름 — 앞 점으로 고정(색인 index.json.bak·.corrupt 증거는 절대 해당 없음)', () => {
    expect(isShortBackupLeftover('.final.mp4.revise.bak')).toBe(true);
    expect(isShortBackupLeftover('.subtitles.srt.cap.bak')).toBe(true);
    expect(isShortBackupLeftover('index.json.bak')).toBe(false);
    expect(isShortBackupLeftover('final.mp4')).toBe(false);
    expect(isRealignLeftover('.realign-user_02.mp4')).toBe(true);
    expect(isRealignLeftover('user_02.mp4')).toBe(false);
    expect(isCardRenderLeftover('.render-1761400000000')).toBe(true);
    expect(isCardRenderLeftover('render-spec.json')).toBe(false);
  });

  const mk = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-guard-'));
    const w = (rel: string): string => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; };
    const old = (p: string): void => { const t = new Date(NOW.getTime() - 3 * 86_400_000); fs.utimesSync(p, t, t); };
    for (let i = 0; i < 10; i++) w(`shorts/short_${i}/final.mp4`);
    for (let i = 0; i < 10; i++) w(`cardnews/card_${i}/slide_01.png`);
    for (let i = 0; i < 10; i++) { const p = w(`sessions/abcdef0${i}/run.json`); const t = new Date(NOW.getTime() - 40 * 86_400_000); fs.utimesSync(p, t, t); }
    const base = (over: Partial<JanitorDeps> = {}): JanitorDeps => ({
      dataDir: root, sessionsDir: path.join(root, 'sessions'),
      shorts: () => Array.from({ length: 10 }, (_, i) => ({ id: `short_${i}`, stage: 'ready', createdTs: ago(1) })),
      cards: () => Array.from({ length: 10 }, (_, i) => ({ id: `card_${i}`, stage: 'ready', createdTs: ago(1) })),
      pieces: () => Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, runId: `abcdef0${i}` })),
      removeShort: () => {}, isShortRunning: () => false, isSessionRunning: () => false, archiveShort: async () => 0,
      ...over,
    });
    return { root, w, old, base, ex: (rel: string) => fs.existsSync(path.join(root, rel)) };
  };

  it('빈 색인(깨짐·유실) + 폴더 있음 → 고아 정리를 통째로 멈추고 보고한다', async () => {
    const t = mk();
    const r = await runJanitor(t.base({ shorts: () => [], cards: () => [], pieces: () => [] }), { now: NOW });
    expect(r.orphanGuard.map((g) => g.category).sort()).toEqual(['orphan-cardnews', 'orphan-shorts', 'unlinked-sessions']);
    expect(r.moved).toEqual({});
    expect(t.ex('shorts/short_0/final.mp4') && t.ex('cardnews/card_0/slide_01.png') && t.ex('sessions/abcdef00/run.json')).toBe(true);
  });
  it('깨짐 표시가 오면 색인이 남아 있어도 멈춘다', async () => {
    const t = mk();
    const r = await runJanitor(t.base({ shorts: () => [{ id: 'short_0', stage: 'ready', createdTs: ago(1) }], storeCorrupt: () => ({ shorts: true }) }), { now: NOW });
    expect(r.orphanGuard).toEqual([expect.objectContaining({ category: 'orphan-shorts', candidates: 9, folders: 10 })]);
    expect(t.ex('shorts/short_5')).toBe(true);
  });
  it('20% 초과면 멈추고, 이하면 종전처럼 치운다', async () => {
    const t = mk();
    const half = await runJanitor(t.base({ cards: () => Array.from({ length: 5 }, (_, i) => ({ id: `card_${i}`, stage: 'ready', createdTs: ago(1) })) }), { now: NOW, dryRun: true });
    expect(half.orphanGuard).toEqual([expect.objectContaining({ category: 'orphan-cardnews', candidates: 5 })]);
    const r = await runJanitor(t.base({ cards: () => Array.from({ length: 8 }, (_, i) => ({ id: `card_${i}`, stage: 'ready', createdTs: ago(1) })) }), { now: NOW });
    expect(r.orphanGuard).toEqual([]);
    expect(r.moved['orphan-cardnews']?.n).toBe(2);
    expect(t.ex('cardnews/card_9')).toBe(false);
  });
  it('크래시 잔여물 — 2일 지난 것만 치우고, 최근 것·만드는 중인 편은 둔다', async () => {
    const t = mk();
    const oldBak = t.w('shorts/short_1/.final.mp4.revise.bak'); t.old(oldBak);
    t.w('shorts/short_1/.plan.json.revise.bak'); // 방금 생긴 것 — 재조립 중일 수 있다
    const oldCap = t.w('shorts/short_2/.subtitles.srt.cap.bak'); t.old(oldCap);
    const oldRealign = t.w('shorts/short_1/clips/.realign-user_02.mp4'); t.old(oldRealign);
    const runBak = t.w('shorts/short_3/.final.mp4.revise.bak'); t.old(runBak);
    const render = t.w('cardnews/card_1/.render-1761000000000/slide_01.png'); t.old(render); t.old(path.dirname(render));
    t.w('cardnews/card_2/.render-1761400000000/slide_01.png');
    const r = await runJanitor(t.base({ isShortRunning: (id) => id === 'short_3' }), { now: NOW });
    expect(r.moved['crash-leftovers']?.n).toBe(4);
    expect(t.ex('shorts/short_1/.final.mp4.revise.bak')).toBe(false);
    expect(t.ex('shorts/short_1/.plan.json.revise.bak')).toBe(true);
    expect(t.ex('shorts/short_2/.subtitles.srt.cap.bak')).toBe(false);
    expect(t.ex('shorts/short_1/clips/.realign-user_02.mp4')).toBe(false);
    expect(t.ex('shorts/short_3/.final.mp4.revise.bak')).toBe(true);
    expect(t.ex('cardnews/card_1/.render-1761000000000')).toBe(false);
    expect(t.ex('cardnews/card_2/.render-1761400000000')).toBe(true);
    expect(t.ex('shorts/short_1/final.mp4')).toBe(true);
  });
});
