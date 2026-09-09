import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { daysSince, isShortPublished, shortPublishedTs, isStaleUnpublishedShort, shortPruneTargets, cardPruneTargets, trashEntryExpired, runJanitor, type JanitorDeps } from './janitor';

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
    expect(a).toEqual(['refs', 'scenes/_refnorm', 'download.mp4', 'remotion/bundle', 'remotion/public']);
    expect(shortPruneTargets(true, 13, 14)).toEqual(a);
    const b = shortPruneTargets(true, 14, 14);
    for (const t of ['scenes', 'scenes-retry', 'clips/*.mp4', 'remotion']) expect(b).toContain(t);
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
    // 발행 3일 된 쇼츠 — 참조·캐시만
    w('shorts/short_new/scenes/blog-image-01.png', 100); w('shorts/short_new/refs/x.jpg', 30); w('shorts/short_new/final.mp4', 300);
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
