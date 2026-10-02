import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  framePositions, rankFramePicks, hammingHex, signatureSimilarity, findVisualDuplicate, frameForPiece,
  withRealFrameSlot, mergeRealFrameManifest, realFrameEntry, readBlogFrameLedger, appendBlogFrame, realFrameAlt,
  findPositionClash, frameRowBlocks, blockingFrameRows, blogFrameReleaseFor, readBlogFrameReleases,
  releaseBlogFramesOfDeletedPiece, releaseBlogFramesOfRemovedRun, frameLineageRuns, realFrameSceneTags, blogFrameLedgerPath,
  FRAME_SIG_SAME, FRAME_SIG_W, FRAME_SIG_H, FRAME_BAD_TTL_DAYS,
  type BlogFrameRow, type FrameCandidate, type FrameLiveness, type FrameOwnerPiece, type FrameSessionState,
} from './blogFrames';

const vid = (mediaId: string, seconds: number, extra: Partial<FrameCandidate> = {}): FrameCandidate =>
  ({ mediaId, file: `/m/${mediaId}.mp4`, kind: 'video', seconds, grade: 150, species: '감나무', createdTs: '2026-09-01', ...extra });
const used = (mediaId: string, atSec: number, extra: Partial<BlogFrameRow> = {}): BlogFrameRow =>
  ({ ts: '', runId: 'r0', mediaId, file: `/m/${mediaId}.mp4`, kind: 'video', atSec, species: '감나무', status: 'used', ...extra });

/** 24x32 화면 서명 — 대각 그라디언트 + 밝은 사각형(나무 줄기 자리). dx 만큼 옆으로 민 화면. */
function sig(dx = 0, seed?: number): string {
  const b = Buffer.alloc(FRAME_SIG_W * FRAME_SIG_H);
  let s = seed ?? 0;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >> 16) & 255; };
  for (let y = 0; y < FRAME_SIG_H; y++) {
    for (let x = 0; x < FRAME_SIG_W; x++) {
      const X = x + dx;
      b[y * FRAME_SIG_W + x] = seed !== undefined ? rnd()
        : Math.max(0, Math.min(255, Math.round(y * 6 + X * 2 + (X >= 9 && X <= 13 && y >= 8 ? 90 : 0))));
    }
  }
  return b.toString('base64');
}

describe('framePositions — 한 영상에서 뗄 수 있는 순간(2.5초 격자, 앞뒤 1초 여백)', () => {
  it('17초 영상은 1~16초 사이 7곳', () => {
    expect(framePositions(17)).toEqual([1, 3.5, 6, 8.5, 11, 13.5, 16]);
  });
  it('9초 영상은 3곳, 짧은 영상은 가운데 한 곳, 길이 모름은 1초', () => {
    expect(framePositions(9)).toEqual([1, 3.5, 6]);
    expect(framePositions(1.5)).toEqual([0.8]);
    expect(framePositions(undefined)).toEqual([1]);
  });
});

describe('rankFramePicks — 다시 쓰지 않는다(순수)', () => {
  it('처음 쓰는 파일은 가운데 순간부터', () => {
    expect(rankFramePicks([vid('a', 17)], [])[0]).toMatchObject({ mediaId: 'a', atSec: 8.5 });
  });

  it('이미 뗀 순간의 ±1.5초 안은 다시 안 낸다 — 이웃 프레임은 같은 사진이다', () => {
    const picks = rankFramePicks([vid('a', 17)], [used('a', 9.2)]);
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) expect(Math.abs(p.atSec - 9.2)).toBeGreaterThan(1.5);
    expect(picks.map((p) => p.atSec)).not.toContain(8.5);
    expect(picks.map((p) => p.atSec)).toContain(11); // 1.8초 떨어짐 — 허용
  });

  it('같은 파일의 둘째 사용은 이미 쓴 순간에서 가장 먼 곳', () => {
    expect(rankFramePicks([vid('a', 17)], [used('a', 8.5)])[0]!.atSec).toBe(1); // 1·16 동률 → 앞
    expect(rankFramePicks([vid('a', 17)], [used('a', 8.5), used('a', 1)])[0]!.atSec).toBe(16);
  });

  it('블로그에 덜 쓰인 파일이 먼저다 — 안 쓴 파일이 맨 앞', () => {
    const picks = rankFramePicks([vid('a', 17, { createdTs: '2026-09-30' }), vid('b', 17)], [used('a', 8.5)]);
    expect(picks[0]!.mediaId).toBe('b');
  });

  it('파일을 한 바퀴씩 돌며 낸다 — 고정 화면 파일이 거절돼도 다음 시도는 다른 파일', () => {
    const picks = rankFramePicks([vid('a', 17, { createdTs: '2026-09-30' }), vid('b', 17)], []);
    expect(picks.slice(0, 4).map((p) => p.mediaId)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('다른 수종 소재는 절대 안 고른다 — 주 수종이 다 쓰여도 아래 등급으로 안 내려간다', () => {
    const own = vid('own', 4); // 순간 하나(1초)뿐
    const other = vid('other', 30, { grade: 100, species: '자두나무' });
    expect(rankFramePicks([own, other], []).every((p) => p.mediaId === 'own')).toBe(true);
    expect(rankFramePicks([own, other], [used('own', 1)])).toEqual([]); // 소진 → null 쪽(전부 생성 이미지)
  });

  it('모든 순간이 쓰이면 빈 목록(소진)', () => {
    const ledger = framePositions(9).map((t) => used('a', t));
    expect(rankFramePicks([vid('a', 9)], ledger)).toEqual([]);
  });

  it('거절 행도 그 순간을 막는다(다시 시도하지 않음) — 하지만 파일 사용 횟수로는 안 센다', () => {
    const rej = used('a', 8.5, { status: 'rejected', reason: 'blurry' });
    const picks = rankFramePicks([vid('a', 17, { createdTs: '2026-09-30' }), vid('b', 17)], [rej]);
    expect(picks.find((p) => p.mediaId === 'a' && p.atSec === 8.5)).toBeUndefined();
    expect(picks[0]!.mediaId).toBe('a'); // 쓴 적 0회 그대로 — 최근 업로드가 앞
  });

  it('보관소 사진은 평생 한 편 — 쓴 적이 있으면 후보에서 빠진다, 안 썼으면 영상보다 먼저', () => {
    const photo: FrameCandidate = { mediaId: 'p', file: '/m/p.jpg', kind: 'image', grade: 150, species: '감나무', createdTs: '2026-01-01' };
    expect(rankFramePicks([vid('a', 17), photo], [])[0]).toMatchObject({ mediaId: 'p', kind: 'image', atSec: 0 });
    const after = rankFramePicks([vid('a', 17), photo], [used('p', 0, { kind: 'image', file: '/m/p.jpg' })]);
    expect(after.some((x) => x.mediaId === 'p')).toBe(false);
  });

  it('태그 적합이 높은 파일이 먼저(필터는 아니다 — 다른 파일도 뒤에 남는다)', () => {
    const picks = rankFramePicks([vid('fruit', 17, { bonus: 0, createdTs: '2026-09-30' }), vid('seedling', 17, { bonus: 10 })], []);
    expect(picks[0]!.mediaId).toBe('seedling');
    expect(picks.some((p) => p.mediaId === 'fruit')).toBe(true);
  });
});

describe('화면 중복 판정 — 다른 순간이라도 같아 보이면 안 쓴다', () => {
  it('hammingHex — 64비트 hex 해밍 거리, 형식이 아니면 64', () => {
    expect(hammingHex('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingHex('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(hammingHex('000000000000000f', '0000000000000000')).toBe(4);
    expect(hammingHex('xyz', '0000000000000000')).toBe(64);
  });

  it('signatureSimilarity — 조금 밀린 같은 장면은 높고, 다른 화면은 낮다', () => {
    expect(signatureSimilarity(sig(0), sig(0))).toBeGreaterThan(0.99);
    expect(signatureSimilarity(sig(0), sig(2))).toBeGreaterThanOrEqual(FRAME_SIG_SAME); // 카메라가 조금 움직인 같은 장면
    expect(signatureSimilarity(sig(0), sig(0, 7))).toBeLessThan(FRAME_SIG_SAME);       // 무관한 화면
    expect(signatureSimilarity(sig(0), 'not-a-sig')).toBe(-1);
    expect(signatureSimilarity(undefined, sig(0))).toBe(-1);
  });

  it('같은 수종에 이미 나간 사진과 같아 보이면 거절 — 다른 파일이어도', () => {
    const ledger = [used('a', 8.5, { sig: sig(0), hash: '0f0f0f0f0f0f0f0f' })];
    const cap = { hash: 'f0f0f0f0f0f0f0f0', sig: sig(1), species: '감나무', mediaId: 'b', file: '/m/b.mp4' };
    expect(findVisualDuplicate(cap, ledger)?.why).toMatch(/화면 유사도/);
  });

  it('같은 순간을 다른 시각에 뗀 고정 화면(정적 영상)도 거절', () => {
    const ledger = [used('a', 3.5, { sig: sig(0) })];
    expect(findVisualDuplicate({ sig: sig(0), species: '감나무', mediaId: 'a', file: '/m/a.mp4' }, ledger)).not.toBeNull();
  });

  it('다른 수종 사진은 서명이 비슷해도 비교하지 않는다 — 대신 해시가 같으면(재전송본) 수종 무관하게 거절', () => {
    const ledger = [used('x', 3.5, { species: '살구나무', sig: sig(0), hash: '1234567812345678', file: '/m/x.mp4' })];
    const cap = { sig: sig(0), hash: 'edcba987edcba987', species: '감나무', mediaId: 'b', file: '/m/b.mp4' };
    expect(findVisualDuplicate(cap, ledger)).toBeNull();
    // 매실·살구 딱지로 따로 올라온 같은 영상(실측 해밍 0~1)
    expect(findVisualDuplicate({ ...cap, hash: '1234567812345679' }, ledger)?.why).toMatch(/해시 거리 1/);
  });

  it('거절 행과 같은 글(리비전) 행은 비교에서 뺀다', () => {
    const ledger = [
      used('a', 3.5, { sig: sig(0), status: 'rejected' }),
      used('a', 8.5, { sig: sig(0), pieceId: 'P1' }),
    ];
    const cap = { sig: sig(0), species: '감나무', mediaId: 'b', file: '/m/b.mp4' };
    expect(findVisualDuplicate(cap, ledger, { pieceId: 'P1' })).toBeNull();
    expect(findVisualDuplicate(cap, ledger, { pieceId: 'P2' })).not.toBeNull();
  });
});

describe('frameForPiece — 리비전은 자기 컷을 다시 쓴다(새 컷을 먹지 않는다)', () => {
  const ledger: BlogFrameRow[] = [
    used('a', 8.5, { runId: 'R1', pieceId: 'P1' }),
    used('b', 3.5, { runId: 'R9', pieceId: 'P9' }),
    used('a', 1, { runId: 'R1x', pieceId: 'P1', status: 'rejected' }),
  ];
  it('같은 piece 행이 정본 — 연쇄 리비전(원 런이 리비전 런이라 원장에 없음)도 piece 로 찾는다', () => {
    expect(frameForPiece(ledger, { pieceId: 'P1', baseRunId: 'R1' })).toMatchObject({ mediaId: 'a', atSec: 8.5 });
    expect(frameForPiece(ledger, { pieceId: 'P1', baseRunId: 'R2-revision' })).toMatchObject({ mediaId: 'a', atSec: 8.5 });
  });
  it('piece 를 모르면 원 런 행, 둘 다 없으면 없음(새 글)', () => {
    expect(frameForPiece(ledger, { baseRunId: 'R9' })).toMatchObject({ mediaId: 'b' });
    expect(frameForPiece(ledger, { pieceId: 'P-new' })).toBeUndefined();
  });
});

describe('슬롯·매니페스트 — 실촬영이 1번, 생성은 02부터', () => {
  it('withRealFrameSlot — 실촬영 1 + 생성 2, 총 3장', () => {
    const ed = [1, 2, 3].map((i) => ({ alt: `a${i}`, prompt: `p${i}` }));
    const real = { alt: realFrameAlt('감나무'), prompt: '실촬영' };
    expect(withRealFrameSlot(ed, real)).toEqual([real, ed[0], ed[1]]);
    expect(withRealFrameSlot(ed.slice(0, 2), real)).toEqual([real, ed[0], ed[1]]);
    expect(real.alt).toBe('감나무 — 비온디트리 농원에서 직접 촬영');
  });

  const real = { file_path: '/s/images/blog-image-01.png', alt: '감나무 — 직접 촬영', mediaId: 'm1', atSec: 8.4, species: '감나무', hash: 'ab' };

  it('생성 매니페스트(index 1·2) 앞에 실촬영 항목(index 0, archive_frame, ai:false)', () => {
    const gen = { images: [
      { index: 1, filename: 'blog-image-02.png', file_path: '/s/images/blog-image-02.png' },
      { index: 2, filename: 'blog-image-03.png', file_path: '/s/images/blog-image-03.png' },
    ], count: 2, ok: 2, model: 'gpt-image-2' };
    const m = mergeRealFrameManifest(gen, real);
    const imgs = m.images as Array<Record<string, unknown>>;
    expect(imgs.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(imgs[0]).toMatchObject({ filename: 'blog-image-01.png', source: 'archive_frame', ai: false, mediaId: 'm1', atSec: 8.4 });
    expect(m).toMatchObject({ count: 3, ok: 3, model: 'gpt-image-2' });
    expect(realFrameEntry(m)?.filename).toBe('blog-image-01.png');
  });

  it('복원 매니페스트(자리 순서·표시 없음·빈 자리 null)도 실촬영을 다시 표시하고 자리 번호를 index 로 박는다', () => {
    const recovered = { images: [{ file_path: '/s/images/blog-image-01.png' }, null, { file_path: '/s/images/blog-image-03.png' }] };
    const imgs = mergeRealFrameManifest(recovered, real).images as Array<Record<string, unknown>>;
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toMatchObject({ index: 0, source: 'archive_frame', ai: false });
    expect(imgs[1]).toMatchObject({ index: 2, file_path: '/s/images/blog-image-03.png' }); // 3번 마커 — 2번으로 당겨지지 않게
  });

  it('매니페스트가 없으면 실촬영만', () => {
    const imgs = mergeRealFrameManifest(undefined, real).images as unknown[];
    expect(imgs).toHaveLength(1);
  });
});

describe('원장 — 덧붙이기 전용, 읽기는 fail-open', () => {
  it('없는 파일은 빈 목록, 깨진 줄·필수 필드 없는 줄은 건너뛴다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blogframes-'));
    const f = path.join(dir, 'media', 'blog_frames.jsonl');
    expect(readBlogFrameLedger(f)).toEqual([]);
    appendBlogFrame(f, used('a', 8.5, { hash: 'abcd', sig: 'AAA=' }));
    fs.appendFileSync(f, '{깨진 줄\n\n{"note":"필드 없음"}\n', 'utf-8');
    appendBlogFrame(f, used('b', 0, { kind: 'image', status: 'rejected', reason: 'blurry' }));
    const rows = readBlogFrameLedger(f);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ mediaId: 'a', atSec: 8.5, status: 'used', hash: 'abcd', sig: 'AAA=' });
    expect(rows[1]).toMatchObject({ mediaId: 'b', kind: 'image', status: 'rejected', reason: 'blurry' });
  });
});

describe('findPositionClash — 확정 직전 재확인(동시 런이 같은 자리를 먼저 가져갔는가)', () => {
  it('같은 파일 ±1.5초 안의 used 줄과 겹치면 그 줄, 밖이면 없음', () => {
    const led = [used('a', 8.5, { runId: 'R1' })];
    expect(findPositionClash({ mediaId: 'a', file: '/m/a.mp4', kind: 'video', atSec: 9.6 }, led)?.runId).toBe('R1');
    expect(findPositionClash({ mediaId: 'a', file: '/m/a.mp4', kind: 'video', atSec: 11 }, led)).toBeUndefined();
    expect(findPositionClash({ mediaId: 'b', file: '/m/b.mp4', kind: 'video', atSec: 8.5 }, led)).toBeUndefined();
  });
  it('거절 줄·같은 글(pieceId) 줄은 겹침이 아니다. 사진은 그 파일의 used 줄이 하나라도 있으면 겹침', () => {
    expect(findPositionClash({ mediaId: 'a', file: '/m/a.mp4', kind: 'video', atSec: 8.5 }, [used('a', 8.5, { status: 'rejected' })])).toBeUndefined();
    expect(findPositionClash({ mediaId: 'a', file: '/m/a.mp4', kind: 'video', atSec: 8.5 }, [used('a', 8.5, { pieceId: 'P1' })], { pieceId: 'P1' })).toBeUndefined();
    expect(findPositionClash({ mediaId: 'p', file: '/m/p.mp4', kind: 'image', atSec: 0 }, [used('p', 0, { kind: 'image' })])).toBeDefined();
  });
});

describe('예약 수명 — 확실한 증거가 있을 때만 반납, 애매하면 막는다', () => {
  const NOW = Date.parse('2026-10-02T12:00:00Z');
  const T0 = '2026-10-02T09:00:00Z';
  const sess = (m: Record<string, Partial<FrameSessionState>> = {}) =>
    (rid: string): FrameSessionState => ({ exists: false, ended: false, draft: false, ...(m[rid] ?? {}) });
  const ctx = (o: Partial<FrameLiveness> = {}): FrameLiveness => ({ pieces: [], releases: [], session: sess(), now: NOW, ...o });
  const piece = (id: string, stage: string, extra: Partial<FrameOwnerPiece> = {}): FrameOwnerPiece => ({ id, stage, ...extra });
  const row = (extra: Partial<BlogFrameRow> = {}): BlogFrameRow => used('a', 8.5, { ts: T0, runId: 'R1', ...extra });

  it('진행·검토 중인 글의 컷은 막는다(pieceId 로, 없으면 runId 로 주인을 찾는다)', () => {
    for (const st of ['idea', 'research', 'draft', 'ready']) {
      expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx({ pieces: [piece('P1', st)] }))).toBe(true);
    }
    expect(frameRowBlocks(row(), ctx({ pieces: [piece('P9', 'ready', { runId: 'R1' })] }))).toBe(true);
  });

  it('발행 흔적이 있으면 영원히 막는다 — 단계·주소·비공개 주소·네이버 임시저장 어느 하나라도', () => {
    for (const p of [
      piece('P1', 'published'), piece('P1', 'measured'), piece('P1', 'reflected'),
      piece('P1', 'error', { publishedUrl: 'https://blog.naver.com/x/1' }), piece('P1', 'error', { privateUrl: 'u' }),
      piece('P1', 'error', { publishedTs: T0 }), piece('P1', 'error', { naverDraftUrl: 'u' }),
    ]) expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx({ pieces: [p] }))).toBe(true);
  });

  it('버려진 글(stage error, 발행 흔적·초안 없음)의 컷은 반납 — 초안이 있으면(카드에서 바로 발행될 수 있다) 막는다', () => {
    expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx({ pieces: [piece('P1', 'error')] }))).toBe(false);
    expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx({ pieces: [piece('P1', 'error', { runId: 'R1' })], session: sess({ R1: { exists: true, ended: true, draft: true } }) }))).toBe(true);
    expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx({ pieces: [piece('P1', 'error', { runId: 'R2' })], session: sess({ R2: { exists: true, ended: true, draft: true } }) }))).toBe(true);
  });

  it('지운 글 — 반납 줄이 없으면 막는다(발행됐을 수 있다). 반납 줄이 있으면 반납', () => {
    expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx())).toBe(true);
    const rel = blogFrameReleaseFor(piece('P1', 'ready', { runId: 'R1' }), undefined, '2026-10-02T10:00:00Z')!;
    expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx({ releases: [rel] }))).toBe(false);
    // 반납 뒤에 다른 글이 같은 순간을 다시 받았으면 그 예약은 덮지 않는다
    expect(frameRowBlocks(row({ ts: '2026-10-02T11:00:00Z' }), ctx({ releases: [{ ...rel, frames: [{ mediaId: 'a', atSec: 8.5 }] }] }))).toBe(true);
  });

  it('발행된 뒤 지운 글은 반납 줄을 만들지 않는다 → 영원히 막힘', () => {
    expect(blogFrameReleaseFor(piece('P1', 'published', { runId: 'R1' }), undefined, T0)).toBeNull();
    expect(blogFrameReleaseFor(piece('P1', 'ready', { runId: 'R1', naverDraftUrl: 'u' }), undefined, T0)).toBeNull();
    expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx())).toBe(true);
  });

  it('수동 런에서 시작해 리비전된 글 — 원장 줄은 pieceId 없이 옛 런, 반납 줄의 순간으로 짝을 짓는다', () => {
    const rel = blogFrameReleaseFor(piece('P1', 'ready', { runId: 'R2' }), { mediaId: 'a', atSec: 8.5 }, '2026-10-02T10:00:00Z')!;
    expect(rel).toMatchObject({ pieceId: 'P1', runIds: ['R2'], frames: [{ mediaId: 'a', atSec: 8.5 }] });
    const old = row({ runId: 'R1' });
    expect(frameRowBlocks(old, ctx({ session: sess({ R1: { exists: true, ended: true, draft: true } }) }))).toBe(true);
    expect(frameRowBlocks(old, ctx({ releases: [rel], session: sess({ R1: { exists: true, ended: true, draft: true } }) }))).toBe(false);
  });

  it('pieceId 없는 런 — 끝났고(run.json) 초안이 없으면 반납, 아직 돌거나(run.json 없음) 초안이 있으면 막는다', () => {
    const r = row();
    expect(frameRowBlocks(r, ctx({ session: sess({ R1: { exists: true, ended: true, draft: false } }) }))).toBe(false);
    expect(frameRowBlocks(r, ctx({ session: sess({ R1: { exists: true, ended: false, draft: false } }) }))).toBe(true);
    expect(frameRowBlocks(r, ctx({ session: sess({ R1: { exists: true, ended: true, draft: true } }) }))).toBe(true);
    // run.json 없이 하루가 지난 런은 도중에 죽은 런 — 초안이 없으면 반납, 있으면 여전히 막는다
    const stale = row({ ts: new Date(NOW - 25 * 3_600_000).toISOString() });
    expect(frameRowBlocks(stale, ctx({ session: sess({ R1: { exists: true, ended: false, draft: false } }) }))).toBe(false);
    expect(frameRowBlocks(stale, ctx({ session: sess({ R1: { exists: true, ended: false, draft: true } }) }))).toBe(true);
  });

  it('세션이 사라진 것만으로는 반납하지 않는다(리비전된 글의 옛 런 세션은 janitor 가 치운다)', () => {
    expect(frameRowBlocks(row(), ctx())).toBe(true);
  });

  it('pieceId 가 있는 런은 세션 흔적으로 반납하지 않는다(그 글이 되살아나 자기 컷을 다시 쓴다)', () => {
    expect(frameRowBlocks(row({ pieceId: 'P1' }), ctx({ session: sess({ R1: { exists: true, ended: true, draft: false } }) }))).toBe(true);
  });

  it('거절 줄은 막고, 추출 실패(bad:)는 기한이 지나면 풀린다', () => {
    expect(frameRowBlocks(row({ status: 'rejected', reason: 'blurry', ts: '2020-01-01T00:00:00Z' }), ctx())).toBe(true);
    expect(frameRowBlocks(row({ status: 'rejected', reason: 'bad:extract_failed' }), ctx())).toBe(true);
    const old = new Date(NOW - (FRAME_BAD_TTL_DAYS + 1) * 86_400_000).toISOString();
    expect(frameRowBlocks(row({ status: 'rejected', reason: 'bad:extract_failed', ts: old }), ctx())).toBe(false);
  });

  it('blockingFrameRows → rankFramePicks — 반납된 순간은 다시 후보가 된다', () => {
    const led = [row({ runId: 'R1', atSec: 8.5 })];
    const sessOk = sess({ R1: { exists: true, ended: true, draft: false } });
    expect(rankFramePicks([vid('a', 17)], blockingFrameRows(led, ctx({ session: sessOk })))[0]!.atSec).toBe(8.5);
    expect(rankFramePicks([vid('a', 17)], blockingFrameRows(led, ctx()))[0]!.atSec).not.toBe(8.5);
  });

  it('삭제 훅 — 미발행이면 세션 매니페스트의 실촬영 항목까지 담아 반납 줄을 덧붙이고, 원장 읽기는 그 줄을 건너뛴다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blogframes-rel-'));
    const dirs = { dataDir: path.join(dir, 'data'), sessionsDir: path.join(dir, 'sessions') };
    fs.mkdirSync(path.join(dirs.sessionsDir, 'R2'), { recursive: true });
    fs.writeFileSync(path.join(dirs.sessionsDir, 'R2', 'image_manifest.json'), JSON.stringify({ images: [
      { index: 0, filename: 'blog-image-01.png', source: 'archive_frame', ai: false, mediaId: 'a', atSec: 8.5 },
    ] }));
    const f = path.join(dirs.dataDir, 'media', 'blog_frames.jsonl');
    appendBlogFrame(f, row());
    expect(releaseBlogFramesOfDeletedPiece(piece('P1', 'published', { runId: 'R2' }), dirs)).toBe(false);
    expect(releaseBlogFramesOfDeletedPiece(piece('P1', 'ready', { runId: 'R2' }), dirs)).toBe(true);
    expect(readBlogFrameLedger(f)).toHaveLength(1);
    expect(readBlogFrameReleases(f)).toEqual([expect.objectContaining({ pieceId: 'P1', runIds: ['R2'], frames: [{ mediaId: 'a', atSec: 8.5 }], reason: 'piece-deleted' })]);
  });
});

describe('realFrameSceneTags — 계절 딱지는 장면이 아니다', () => {
  it('봄·여름·가을·겨울(초·늦·한 접두 포함)은 빼고, 계절이 들어간 장면 딱지는 남긴다', () => {
    expect(realFrameSceneTags(['가을', '결실주', '봄', '여름', '겨울', '늦가을', '한겨울', '겨울나기', '가을꽃', '묘목'])).toEqual(['결실주', '겨울나기', '가을꽃', '묘목']);
  });
});

describe('2차 리뷰(2026-10-02) — 재사용 계보·세션 치울 때 반납·중복 거절의 수명', () => {
  const NOW = Date.parse('2026-10-02T12:00:00Z');
  const live = (o: Partial<FrameLiveness> = {}): FrameLiveness => ({
    pieces: [], releases: [], session: () => ({ exists: true, ended: true, draft: true }), now: NOW, ...o,
  });

  it('frameLineageRuns — 같은 pieceId 줄의 런 + from 을 거슬러 닫는다(pieceId 없는 첫 줄까지)', () => {
    const ledger = [
      used('a', 8.5, { runId: 'R0' }),
      used('a', 8.5, { runId: 'R1', pieceId: 'P', from: 'R0' }),
      used('a', 8.5, { runId: 'R2', pieceId: 'P', from: 'R1' }),
      used('a', 3.5, { runId: 'X', pieceId: 'Q' }),
    ];
    expect([...frameLineageRuns(ledger, { pieceId: 'P', runIds: ['R3'] })].sort()).toEqual(['R0', 'R1', 'R2', 'R3']);
    // pieceId 없는 수동 리비전 — 원 런에서 from 으로만 잇는다
    expect([...frameLineageRuns([used('a', 8.5, { runId: 'M0' }), used('a', 8.5, { runId: 'M1', from: 'M0' })], { runIds: ['M2', 'M1'] })].sort()).toEqual(['M0', 'M1', 'M2']);
    expect(frameLineageRuns(ledger, { pieceId: 'P', runIds: [] }).has('X')).toBe(false);
  });

  it('findPositionClash·findVisualDuplicate — 계보 런(runIds) 줄은 자기 컷이라 빼고, 다른 런은 그대로 잡는다', () => {
    const rows = [used('a', 8.5, { runId: 'R0', hash: 'ffffffffffffffff' })];
    const cap = { mediaId: 'a', file: '/m/a.mp4', kind: 'video' as const, atSec: 8.5 };
    expect(findPositionClash(cap, rows, { runIds: new Set(['R0']) })).toBeUndefined();
    expect(findPositionClash(cap, rows, { runIds: new Set(['R9']) })?.runId).toBe('R0');
    const vis = { hash: 'ffffffffffffffff', species: '감나무', mediaId: 'a', file: '/m/a.mp4' };
    expect(findVisualDuplicate(vis, rows, { runIds: new Set(['R0']) })).toBeNull();
    expect(findVisualDuplicate(vis, rows)?.row.runId).toBe('R0');
  });

  it('원장 읽기 — from·dupOf 가 살아남는다(왕복)', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-rt-')), 'l.jsonl');
    appendBlogFrame(file, used('a', 8.5, { ts: 't', runId: 'R1', pieceId: 'P', from: 'R0' }));
    appendBlogFrame(file, { ...used('b', 3.5, { ts: 't', runId: 'R2' }), status: 'rejected', reason: 'dup:화면 유사도 0.80', dupOf: { mediaId: 'a', file: '/m/a.mp4', atSec: 8.5 } });
    const [a, b] = readBlogFrameLedger(file);
    expect(a!.from).toBe('R0');
    expect(b!.dupOf).toEqual({ mediaId: 'a', file: '/m/a.mp4', atSec: 8.5 });
  });

  it('중복 거절(dup:) — 대상 컷이 아직 막으면 막고, 대상이 풀리면 같이 풀린다. 대상 없는 옛 dup 줄은 계속 막는다', () => {
    const target = used('a', 8.5, { ts: '2026-10-02T09:00:00Z', runId: 'R1', pieceId: 'P1' });
    const dup: BlogFrameRow = { ...used('b', 3.5, { ts: '2026-10-02T10:00:00Z', runId: 'R2' }), status: 'rejected', reason: 'dup:화면 유사도 0.8', dupOf: { mediaId: 'a', file: '/m/a.mp4', atSec: 8.5 } };
    const legacy: BlogFrameRow = { ...used('c', 6, { ts: '2026-10-02T10:00:00Z', runId: 'R2' }), status: 'rejected', reason: 'dup:해시 거리 3' };
    const alive = live({ pieces: [{ id: 'P1', runId: 'R1', stage: 'ready' }] });
    expect(blockingFrameRows([target, dup, legacy], alive)).toEqual([target, dup, legacy]);
    const gone = live({ pieces: [{ id: 'P1', runId: 'R1', stage: 'error' }], session: () => ({ exists: true, ended: true, draft: false }) });
    expect(blockingFrameRows([target, dup, legacy], gone)).toEqual([legacy]);
    // 대상이 풀려도 같은 순간을 다른 줄(같은 글의 재사용 줄 등)이 막고 있으면 dup 도 막는다
    const reuse = used('a', 8.5, { ts: '2026-10-02T11:00:00Z', runId: 'R3', pieceId: 'P3', from: 'R1' });
    const keep = live({ pieces: [{ id: 'P1', runId: 'R1', stage: 'error' }, { id: 'P3', runId: 'R3', stage: 'published' }], session: () => ({ exists: true, ended: true, draft: false }) });
    expect(blockingFrameRows([target, dup, reuse], keep)).toEqual([dup, reuse]);
  });

  describe('releaseBlogFramesOfRemovedRun — 세션을 치우기 전 반납', () => {
    const setup = () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-rm-'));
      const dirs = { dataDir: path.join(root, 'data'), sessionsDir: path.join(root, 'sessions') };
      const ledger = blogFrameLedgerPath(dirs.dataDir);
      fs.mkdirSync(path.join(dirs.sessionsDir, 'R1'), { recursive: true });
      appendBlogFrame(ledger, used('a', 8.5, { ts: '2026-10-02T09:00:00Z', runId: 'R1' }));
      const pieces = (list: unknown): void => {
        fs.mkdirSync(path.join(dirs.dataDir, 'pieces'), { recursive: true });
        fs.writeFileSync(path.join(dirs.dataDir, 'pieces', 'index.json'), typeof list === 'string' ? list : JSON.stringify(list));
      };
      return { dirs, ledger, pieces };
    };

    it('초안 없고 가리키는 글도 없으면 runIds 만 적은 반납 줄 — 세션이 사라져도 그 컷은 풀린 채로', () => {
      const { dirs, ledger } = setup();
      expect(releaseBlogFramesOfRemovedRun('R1', dirs, 'janitor-unlinked')).toBe(true);
      const rel = readBlogFrameReleases(ledger);
      expect(rel).toHaveLength(1);
      expect(rel[0]).toMatchObject({ runIds: ['R1'], frames: [], reason: 'janitor-unlinked' });
      fs.rmSync(path.join(dirs.sessionsDir, 'R1'), { recursive: true });
      const ctx = live({ releases: rel, session: () => ({ exists: false, ended: false, draft: false }) });
      expect(blockingFrameRows(readBlogFrameLedger(ledger), ctx)).toEqual([]);
    });

    it('초안이 있거나·글이 그 런을 가리키거나·색인이 깨졌거나·이 런의 pieceId 없는 줄이 없으면 반납하지 않는다', () => {
      const a = setup();
      fs.writeFileSync(path.join(a.dirs.sessionsDir, 'R1', 'draft.json'), '{}');
      expect(releaseBlogFramesOfRemovedRun('R1', a.dirs)).toBe(false);
      const b = setup();
      b.pieces([{ id: 'P', runId: 'R1', stage: 'ready' }]);
      expect(releaseBlogFramesOfRemovedRun('R1', b.dirs)).toBe(false);
      const c = setup();
      c.pieces('{broken');
      expect(releaseBlogFramesOfRemovedRun('R1', c.dirs)).toBe(false);
      const d = setup();
      expect(releaseBlogFramesOfRemovedRun('R9', d.dirs)).toBe(false);
      for (const x of [a, b, c, d]) expect(readBlogFrameReleases(x.ledger)).toEqual([]);
    });

    it('발행 흔적이 있는 글이 같은 컷을 쓰면(원장 줄 또는 세션 매니페스트) 반납하지 않는다', () => {
      const a = setup();
      appendBlogFrame(a.ledger, used('a', 8.5, { ts: '2026-10-02T10:00:00Z', runId: 'R2', pieceId: 'P', from: 'R1' }));
      a.pieces([{ id: 'P', runId: 'R2', stage: 'published', publishedUrl: 'https://blog.naver.com/x/1' }]);
      expect(releaseBlogFramesOfRemovedRun('R1', a.dirs)).toBe(false);
      const b = setup(); // 옛 리비전(재사용 줄 없음) — 발행된 글 세션의 매니페스트가 같은 순간을 가리킨다
      fs.mkdirSync(path.join(b.dirs.sessionsDir, 'R2'), { recursive: true });
      fs.writeFileSync(path.join(b.dirs.sessionsDir, 'R2', '06_image_manifest.json'), JSON.stringify({ images: [{ source: 'archive_frame', mediaId: 'a', atSec: 8.5 }] }));
      b.pieces([{ id: 'P', runId: 'R2', stage: 'ready', naverDraftUrl: 'https://blog.naver.com/x/d' }]);
      expect(releaseBlogFramesOfRemovedRun('R1', b.dirs)).toBe(false);
      for (const x of [a, b]) expect(readBlogFrameReleases(x.ledger)).toEqual([]);
    });
  });
});
