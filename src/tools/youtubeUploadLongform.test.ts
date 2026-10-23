import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLongformMeta, nextOffsetFromRange, resumableUpload } from './youtubeUpload';

const KiB256 = 262_144;
/** 테스트용 영상 파일(내용은 위치값 바이트) — 실제 구글은 치지 않는다. */
function tmpVideo(bytes: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-upload-'));
  const p = path.join(dir, 'final.mp4');
  const b = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) b[i] = i % 251;
  fs.writeFileSync(p, b);
  return p;
}

type Seen = { url: string; method: string; headers: Record<string, string>; bodyLen: number; firstByte?: number };
/** 순서대로 응답을 내는 가짜 fetch — 요청 머리·바디 길이를 기록한다. */
function fakeFetch(responses: Array<Response | Error>, seen: Seen[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body as Uint8Array | string | undefined;
    const bodyLen = body == null ? 0 : typeof body === 'string' ? body.length : body.byteLength;
    seen.push({ url, method: String(init?.method), headers: { ...(init?.headers as Record<string, string>) }, bodyLen, firstByte: body instanceof Uint8Array ? body[0] : undefined });
    const next = responses.shift();
    if (!next) throw new Error('예상 밖 요청');
    if (next instanceof Error) throw next;
    return next;
  };
}
const resp = (status: number, opts: { json?: unknown; headers?: Record<string, string> } = {}): Response =>
  new Response(opts.json !== undefined ? JSON.stringify(opts.json) : null, { status, headers: opts.headers });

describe('buildLongformMeta(순수)', () => {
  it('처음부터 공개·AI 공개·카테고리, 제목 폴백은 영상, 설명에 해시태그를 덧붙이지 않는다', () => {
    const m = buildLongformMeta('', '요약 <b>\n\n챕터\n0:00 시작\n\n#가지치기', ['#가지치기', '', '감나무']) as {
      snippet: { title: string; description: string; tags: string[]; categoryId: string };
      status: { privacyStatus: string; selfDeclaredMadeForKids: boolean; containsSyntheticMedia: boolean; publishAt?: string };
    };
    expect(m.snippet.title).toBe('영상');
    expect(m.snippet.description).toBe('요약 b\n\n챕터\n0:00 시작\n\n#가지치기');
    expect(m.snippet.tags).toEqual(['가지치기', '감나무']);
    expect(m.snippet.categoryId).toBe('26');
    expect(m.status.privacyStatus).toBe('public');
    expect(m.status.selfDeclaredMadeForKids).toBe(false);
    expect(m.status.containsSyntheticMedia).toBe(true);
    expect(m.status.publishAt).toBeUndefined();
  });
  it('제목 100자·태그 15개 캡', () => {
    const m = buildLongformMeta('가'.repeat(150), 'd', Array.from({ length: 20 }, (_, i) => `t${i}`)) as { snippet: { title: string; tags: string[] } };
    expect(m.snippet.title).toHaveLength(100);
    expect(m.snippet.tags).toHaveLength(15);
  });
});

describe('nextOffsetFromRange(순수)', () => {
  it('Range 끝+1, 없으면 0(받은 바이트 없음)', () => {
    expect(nextOffsetFromRange('bytes=0-262143')).toBe(262_144);
    expect(nextOffsetFromRange(null)).toBe(0);
    expect(nextOffsetFromRange('')).toBe(0);
  });
});

describe('resumableUpload — 청크 루프(가짜 fetch)', () => {
  it('세션 열기 → 청크 PUT(256KiB) → 308 부분 수신이면 Range 위치부터 → 500 이면 위치 조회 후 재개 → 201 id', async () => {
    const total = 700_000;
    const video = tmpVideo(total);
    const seen: Seen[] = [];
    const session = 'https://upload.example/session-1';
    const f = fakeFetch([
      resp(200, { headers: { Location: session } }),                // 세션 열기
      resp(308, { headers: { Range: `bytes=0-${KiB256 - 1}` } }),   // 1청크 다 받음
      resp(308, { headers: { Range: 'bytes=0-400000' } }),          // 2청크 일부만 받음
      resp(500),                                                    // 3청크 서버 오류
      resp(308, { headers: { Range: 'bytes=0-500000' } }),          // 위치 조회 → 500001 부터
      resp(201, { json: { id: 'vid_123' } }),                       // 마지막 청크 → 완료
    ], seen);
    const progress: number[] = [];
    const r = await resumableUpload({
      access: 'tok', videoPath: video, meta: { snippet: { title: 't' } },
      fetchImpl: f, chunkBytes: KiB256, retryDelaysMs: [0, 0, 0], onProgress: (s) => progress.push(s),
    });
    expect(r).toEqual({ ok: true, videoId: 'vid_123' });
    // 세션 열기 머리
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.url).toContain('uploadType=resumable');
    expect(seen[0]!.headers['X-Upload-Content-Length']).toBe(String(total));
    expect(seen[0]!.headers['X-Upload-Content-Type']).toBe('video/mp4');
    // 청크·위치 조회의 Content-Range
    expect(seen.slice(1).map((s) => s.headers['Content-Range'])).toEqual([
      `bytes 0-${KiB256 - 1}/${total}`,
      `bytes ${KiB256}-${2 * KiB256 - 1}/${total}`,
      `bytes 400001-${400001 + KiB256 - 1}/${total}`,
      `bytes */${total}`,
      `bytes 500001-${total - 1}/${total}`,
    ]);
    expect(seen.slice(1).every((s) => s.url === session && s.method === 'PUT')).toBe(true);
    expect(seen[4]!.headers['Content-Length']).toBe('0');
    expect(seen[4]!.bodyLen).toBe(0);
    // 재개 청크는 파일의 그 위치에서 읽는다(바이트 = 위치 % 251)
    expect(seen[3]!.firstByte).toBe(400001 % 251);
    expect(seen[5]!.bodyLen).toBe(total - 500001);
    expect(progress).toEqual([KiB256, 400001, 500001]);
  });

  it('쿼터 초과는 세션 열기에서 한국어로', async () => {
    const seen: Seen[] = [];
    const r = await resumableUpload({
      access: 'tok', videoPath: tmpVideo(1000), meta: {},
      fetchImpl: fakeFetch([resp(403, { json: { error: { errors: [{ reason: 'quotaExceeded' }] } } })], seen),
    });
    expect(r).toEqual({ ok: false, error: '유튜브 일일 쿼터 초과 — 내일 재시도' });
  });

  it('401 이면 토큰만 새로 받아 같은 위치에서 잇는다', async () => {
    const seen: Seen[] = [];
    let refreshed = 0;
    const r = await resumableUpload({
      access: 'old', videoPath: tmpVideo(1000), meta: {}, chunkBytes: KiB256, retryDelaysMs: [0, 0, 0],
      refreshAccess: async () => { refreshed++; return 'new'; },
      fetchImpl: fakeFetch([resp(200, { headers: { Location: 'https://u/s' } }), resp(401), resp(200, { json: { id: 'v1' } })], seen),
    });
    expect(r).toEqual({ ok: true, videoId: 'v1' });
    expect(refreshed).toBe(1);
    expect(seen[2]!.headers.Authorization).toBe('Bearer new');
    expect(seen[2]!.headers['Content-Range']).toBe('bytes 0-999/1000');
  });

  it('네트워크 오류가 재시도 한도를 넘으면 실패로 끝난다(무한 루프 없음)', async () => {
    const seen: Seen[] = [];
    const net = new Error('socket hang up');
    const r = await resumableUpload({
      access: 't', videoPath: tmpVideo(1000), meta: {}, retryDelaysMs: [0, 0],
      fetchImpl: fakeFetch([resp(200, { headers: { Location: 'https://u/s' } }), net, net, net, net, net], seen),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('재시도 2회');
  });

  it('세션 만료(404)는 처음부터 다시 올리라고 알린다', async () => {
    const r = await resumableUpload({
      access: 't', videoPath: tmpVideo(1000), meta: {},
      fetchImpl: fakeFetch([resp(200, { headers: { Location: 'https://u/s' } }), resp(404)], []),
    });
    expect(r).toEqual({ ok: false, error: '업로드 세션 만료 — 처음부터 다시 올리세요' });
  });
});
