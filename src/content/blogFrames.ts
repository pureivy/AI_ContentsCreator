/**
 * 블로그 실촬영 컷(2026-10-02 사장님 결정) — 글마다 한 장은 보관소 영상의 한 순간을 사진처럼 떼어 넣는다.
 *
 * 왜 필요한가. 블로그 이미지가 전부 gpt-image-2 생성 실사풍이었다. 네이버 2026-07-06 스팸 공지가 '실제로
 * 오인될 수 있는 생성 이미지'를 위험으로 적었고, 상위 노출 농원 글은 현장 사진을 쓴다. 보관소에는 사진이 0장이고
 * 영상이 79개(60수종, 휴대폰 세로 9~39초)라 영상의 한 순간을 사진으로 쓴다. 나머지 이미지는 종전대로 생성한다.
 *
 * 규칙의 중심은 '다시 쓰지 않는다'다(사장님 재강조 2026-10-02). 같은 수종 글이 여러 편이어도 같은 사진·같은
 * 영상 화면이 두 번 나가면 안 된다. 같은 영상의 다른 순간은 되지만(사장님 아이디어) **실제로 달라 보여야** 한다.
 * 그래서 두 겹으로 막는다.
 *  1) 위치 — 같은 파일에서 이미 뗀 순간의 ±1.5초 안은 쓴 것으로 본다(이웃 프레임은 사실상 같은 사진이다).
 *  2) 화면 — 뗀 사진이 이미 블로그에 나간 같은 수종(또는 같은 파일) 사진과 같아 보이면 버린다. 삼각대처럼
 *     고정된 화면은 시각이 달라도 같은 사진이고, 걸으며 찍은 영상도 2.5초 사이는 대개 같은 나무를 조금 돈 화면이다.
 *     판정은 '화면 서명'(흐린 24x32 회색조, ±3칸 밀어 본 최대 상관)으로 한다 — 아래 FRAME_SIG_SAME 주석의 실측.
 *     지각 해시(dHash 64비트)도 같이 남기고, 수종 표기와 무관하게 원장 전체와 견줘 '사실상 같은 파일'을 잡는다
 *     (실측: 매실나무·살구나무 딱지로 따로 올라온 두 영상이 같은 순간 해밍 거리 0~1 — 같은 영상의 재전송본이다).
 * 보관소 사진(kind:'image')은 평생 한 편에만 쓴다.
 *
 * 후보는 숏폼과 같은 등급 규칙이다(mediaLibrary.matchMediaScored) — 최상위 수종 등급만, 다른 수종 영상은
 * 절대 안 쓴다. 딱지 없는 범용 소재는 수종 일치가 하나도 없을 때만 등급 1로 올라온다. 최상위 등급이 다 쓰였으면
 * 아래 등급으로 내려가지 않고 null(그 글은 전부 생성 이미지) — 수국 편에 회양목 사진이 들어가면 안 쓰느니만 못하다.
 *
 * 원장(data/media/blog_frames.jsonl)은 덧붙이기만 한다. janitor 는 data/media 를 건드리지 않는다(보관소 원본과
 * 같은 자리). 읽기는 fail-open — 없거나 깨진 줄은 건너뛴다.
 *
 * 예약의 수명(2026-10-02 리뷰) — 'used' 줄은 초안을 만들 때 써진다. 글이 끝내 안 나가면 그 컷을 영영 먹으면
 * 안 된다(수종당 글 수 중앙값이 4편뿐이다). 그래서 줄을 고치지 않고 **읽을 때** 주인 글의 상태로 막을지 정한다
 * (frameRowBlocks). 원칙은 '확실한 증거가 있을 때만 반납, 애매하면 막는다' — 발행 흔적이 있는 글의 컷은 영원히 막는다.
 */
import fs from 'node:fs';
import path from 'node:path';

/** 격자 간격(초) — 같은 파일에서 뗄 수 있는 순간들. ±1.5초 규칙과 겹치지 않게 그보다 넓다. */
export const FRAME_STEP_SEC = 2.5;
/** 앞뒤 여백(초) — 영상 첫·끝 1초는 손이 흔들리거나 화면이 넘어가는 중이다. */
export const FRAME_EDGE_SEC = 1.0;
/** 같은 파일에서 이 거리 안의 순간은 이미 쓴 것으로 본다(이웃 프레임 = 같은 사진). */
export const FRAME_NEAR_SEC = 1.5;
/**
 * 화면 서명 유사도 문턱 — 이 값 **이상**이면 같은 사진으로 보고 버린다(같은 수종·같은 파일끼리).
 *
 * 보정(2026-10-02, 보관소 79개 × 2.5초 격자 556컷, 눈으로 가른 짝):
 *  · 같아 보이는 짝 22개(같은 영상 2.5~12.5초 차, 고정 화면·살짝 돈 화면) — 서명 0.65~0.96, dHash 거리 5~26.
 *  · 달라 보이는 같은 영상 짝 4개(줄 전경 ↔ 열매 근접 등) — 서명 0.48~0.70.
 *  · 다른 수종 무작위 짝 40개 — 서명 −0.13~0.52, dHash 24~43.
 * dHash 는 같아 보이는 짝(최대 26)과 다른 수종 짝(최소 24)이 겹쳐 문턱을 못 잡는다 — 그래서 서명으로 가른다.
 * 처음엔 0.62(같아 보이는 짝 최저 0.65 바로 아래)로 두고 실제 선택기를 보관소 전체에 돌려 뽑힌 컷을 눈으로 봤다.
 * 같은 파일에서 뽑힌 0.57~0.62 짝(매실 bd8b86 8.9초↔0.5초 0.59 등)은 여전히 같은 나무·같은 구도로 읽혔다 →
 * 0.55 로 내렸다. 달라 보인 짝 중 0.48·0.50(무화과 울타리↔가지 근접 등)은 통과, 0.67·0.70(대추 줄 전경↔열매
 * 근접 등)은 거절된다 — 애매하면 안 쓰는 쪽이다. 대가: 수종당 글 수(소진 전)
 * 합계 360 → 317, 중앙값 4 그대로. 남는 한계 — 같은 나무를 크게 돌아 찍은 두 컷(0.4대)은 '다른 사진'으로 통과한다.
 */
export const FRAME_SIG_SAME = 0.55;
/** 서명 비교에서 밀어 보는 칸 수(24x32 기준 ±3칸 ≈ 화면의 12%) — 카메라가 조금 움직인 같은 장면을 맞춘다. */
export const FRAME_SIG_SHIFT = 3;
export const FRAME_SIG_W = 24;
export const FRAME_SIG_H = 32;
/**
 * dHash 해밍 거리 — 이 값 **미만**이면 수종 표기와 무관하게 같은 화면(재전송·중복 업로드)으로 본다.
 * 실측: 중복 업로드 짝 0~1, 그 밖의 다른 파일 짝 최저 11(556컷 전수) — 그 사이 10.
 */
export const FRAME_HASH_IDENTICAL = 10;
/** 한 런에서 뽑아 볼 최대 횟수 — 1회 약 2초(ffmpeg 1초 구간 + 보정). 거절이 이어지면 이번 글은 전부 생성 이미지. */
export const FRAME_MAX_TRIES = 5;
/**
 * 추출 실패(extract_failed — ffmpeg 는 돌았는데 그 순간에서 한 장도 안 나옴) 기록의 유효 일수. 그 순간을 다음 런마다
 * 다시 시도해 5번의 기회를 헛쓰지 않게 막되, 일시 장애였을 수도 있으니 이 기간이 지나면 다시 본다.
 */
export const FRAME_BAD_TTL_DAYS = 7;
/** 추출 실패 기록의 reason 접두 — 화질·중복 거절(영구)과 가른다. */
export const FRAME_BAD_PREFIX = 'bad:';
/**
 * 런이 이 시간보다 오래 돌 수는 없다 — run.json(런 끝에 써진다) 없이 이만큼 지난 런은 도중에 죽은 것(서버 재시작 등)으로
 * 보고 '끝난 런'처럼 판정한다. 안 그러면 죽은 런의 예약이 영영 안 풀린다.
 */
export const FRAME_RUN_MAX_HOURS = 24;

export type FrameKind = 'video' | 'image';

/** 원장 한 줄. status 'rejected' 는 '그 순간은 다시 볼 필요가 없다'는 기록이다(품질·중복 거절). */
export interface BlogFrameRow {
  ts: string;
  runId: string;
  pieceId?: string;
  mediaId: string;
  file: string;
  kind: FrameKind;
  /** 실제로 뗀 순간(초). 사진은 0. */
  atSec: number;
  species: string;
  /** dHash 64비트 hex(16자). 거절 행은 없을 수 있다. */
  hash?: string;
  /** 화면 서명(24x32 회색조 base64) — 같은 사진처럼 보이는지 재는 값. */
  sig?: string;
  status: 'used' | 'rejected';
  reason?: string;
  /**
   * 재사용 줄(2026-10-02 2차 리뷰) — 같은 글의 리비전이 자기 컷을 다시 쓸 때 이 런 이름으로 새 'used' 줄을 남기고, 그 컷을
   * 받아 온 런을 적는다. 글의 runId 가 리비전 런으로 옮겨 가도 그 컷이 현재 런의 줄로 막히게 하고, 같은 글의 옛 줄들을
   * 계보(frameLineageRuns)로 묶어 자기 컷과 부딪히지 않게 한다.
   */
  from?: string;
  /** 중복 거절 줄(dup:)이 겹친 대상 컷 — 대상이 더는 막지 않으면 이 거절도 풀린다(blockingFrameRows). 없으면(옛 줄) 계속 막는다. */
  dupOf?: { mediaId: string; file?: string; atSec: number };
}

export interface FrameCandidate {
  mediaId: string;
  file: string;
  kind: FrameKind;
  /** 영상 길이(초). 모르면 첫 순간 하나만 낸다. */
  seconds?: number;
  /** 수종 등급(150 주 수종 / 100 제목의 다른 수종 / 1 범용) — matchMediaScored 의 grade. */
  grade: number;
  /** 태그 적합 가점(score - grade). 등급과 섞지 않는다(mediaRotation 주석 — 섞으면 등급이 뒤집힌다). */
  bonus?: number;
  species?: string;
  tags?: string[];
  createdTs?: string;
}

export interface FramePick {
  mediaId: string;
  file: string;
  kind: FrameKind;
  atSec: number;
  species: string;
  tags: string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 한 영상에서 뗄 수 있는 순간들(초, 순수) — 1초부터 끝-1초까지 2.5초 격자. 짧아서 하나도 없으면 가운데 하나. */
export function framePositions(seconds: number | undefined): number[] {
  const L = Number(seconds);
  if (!(L > 0)) return [FRAME_EDGE_SEC];
  const out: number[] = [];
  for (let t = FRAME_EDGE_SEC; t <= L - FRAME_EDGE_SEC + 1e-9; t += FRAME_STEP_SEC) out.push(round1(t));
  return out.length ? out : [round1(L / 2)];
}

const sameMedia = (r: { mediaId: string; file: string }, c: { mediaId: string; file: string }): boolean =>
  (!!r.mediaId && r.mediaId === c.mediaId) || (!!r.file && r.file === c.file);

/**
 * 시도할 (파일, 순간) 순서(순수). 첫 항목이 가장 바람직하고, 거절되면 다음으로 넘어간다.
 *
 *  1) 최상위 등급만 — 등급을 넘어 섞지 않는다.
 *  2) 파일 순서: 태그 적합 높은 것 → 블로그에 덜 쓰인 것(안 쓴 것이 맨 앞) → 사진 먼저(진짜 사진이 프레임보다 낫다)
 *     → 최근 업로드. 태그는 숏폼처럼 필터가 아니라 순서로만 쓴다 — 필터로 쓰면 그 태그 파일이 바닥나는 순간
 *     같은 수종의 다른 영상이 남아 있어도 실사진이 0장이 된다.
 *  3) 순간 순서: 그 파일에서 이미 본(쓴·거절한) 순간들과 가장 먼 것. 처음이면 가운데부터.
 *  4) 파일을 한 바퀴씩 돌며 낸다(파일1 첫 순간, 파일2 첫 순간, 파일1 둘째 순간…) — 고정 화면 파일에서 해시 거절이
 *     나면 같은 파일의 이웃 순간도 십중팔구 거절이라, 다음 시도는 다른 파일이어야 시도 횟수가 헛되지 않다.
 */
export function rankFramePicks(cands: readonly FrameCandidate[], ledger: readonly BlogFrameRow[]): FramePick[] {
  if (!cands.length) return [];
  const top = Math.max(...cands.map((c) => c.grade));
  const pool = cands.filter((c) => c.grade === top);
  const perFile = pool.map((c) => {
    const seen = ledger.filter((r) => sameMedia(r, c));
    const used = new Set(seen.filter((r) => r.status === 'used').map((r) => round1(r.atSec))).size;
    let times: number[];
    if (c.kind === 'image') {
      times = seen.length ? [] : [0]; // 사진은 평생 한 편 — 쓴 적도, 거절된 적도 있으면 끝
    } else {
      const marks = seen.map((r) => r.atSec);
      const L = Number(c.seconds) > 0 ? Number(c.seconds) : 0;
      const mid = L > 0 ? L / 2 : FRAME_EDGE_SEC;
      times = framePositions(c.seconds)
        .filter((t) => marks.every((m) => Math.abs(t - m) > FRAME_NEAR_SEC))
        .map((t) => ({ t, far: marks.length ? Math.min(...marks.map((m) => Math.abs(t - m))) : 0 }))
        .sort((a, b) => (marks.length ? b.far - a.far : Math.abs(a.t - mid) - Math.abs(b.t - mid)) || a.t - b.t)
        .map((x) => x.t);
    }
    return { c, used, times };
  }).filter((x) => x.times.length);
  perFile.sort((a, b) =>
    (b.c.bonus ?? 0) - (a.c.bonus ?? 0)
    || a.used - b.used
    || (a.c.kind === b.c.kind ? 0 : a.c.kind === 'image' ? -1 : 1)
    || String(b.c.createdTs ?? '').localeCompare(String(a.c.createdTs ?? ''))
    || a.c.mediaId.localeCompare(b.c.mediaId));
  const out: FramePick[] = [];
  const depth = Math.max(0, ...perFile.map((x) => x.times.length));
  for (let k = 0; k < depth; k++) {
    for (const { c, times } of perFile) {
      if (k >= times.length) continue;
      out.push({ mediaId: c.mediaId, file: c.file, kind: c.kind, atSec: times[k]!, species: String(c.species ?? ''), tags: [...(c.tags ?? [])] });
    }
  }
  return out;
}

/** 두 64비트 hex 해시의 해밍 거리. 형식이 아니면 64(가장 멂 — 비교 불가를 중복으로 오판하지 않는다). */
export function hammingHex(a: string, b: string): number {
  const ok = (h: string): boolean => /^[0-9a-f]{16}$/i.test(h);
  if (!ok(a) || !ok(b)) return 64;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

function decodeSig(b64: string): Float64Array | null {
  try {
    const buf = Buffer.from(String(b64 ?? ''), 'base64');
    if (buf.length !== FRAME_SIG_W * FRAME_SIG_H) return null;
    return Float64Array.from(buf);
  } catch { return null; }
}

/** a 의 가운데(가장자리 m칸 뺀 부분)를 b 위에서 밀어 보며 정규화 상관의 최댓값. */
function shiftNcc(a: Float64Array, b: Float64Array, m: number): number {
  const W = FRAME_SIG_W, H = FRAME_SIG_H, w = W - 2 * m, h = H - 2 * m, n = w * h;
  const za = new Float64Array(n);
  let mean = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mean += (za[y * w + x] = a[(y + m) * W + x + m]!);
  mean /= n;
  let sd = 0;
  for (let i = 0; i < n; i++) { za[i] = za[i]! - mean; sd += za[i]! * za[i]!; }
  sd = Math.sqrt(sd / n) + 1e-6;
  let best = -1;
  for (let dy = 0; dy <= 2 * m; dy++) {
    for (let dx = 0; dx <= 2 * m; dx++) {
      let mb = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mb += b[(y + dy) * W + x + dx]!;
      mb /= n;
      let sb = 0, dot = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = b[(y + dy) * W + x + dx]! - mb;
          sb += v * v;
          dot += za[y * w + x]! * v;
        }
      }
      const r = dot / n / (sd * (Math.sqrt(sb / n) + 1e-6));
      if (r > best) best = r;
    }
  }
  return best;
}

/**
 * 두 화면 서명이 얼마나 같은 사진처럼 보이는가(순수, −1~1). 양쪽 방향으로 밀어 보고 큰 값.
 * 서명이 없거나 형식이 아니면 −1(비교 불가를 중복으로 오판하지 않는다 — 대신 dHash 판정은 그대로 산다).
 */
export function signatureSimilarity(a: string | undefined, b: string | undefined, shift = FRAME_SIG_SHIFT): number {
  const A = a ? decodeSig(a) : null;
  const B = b ? decodeSig(b) : null;
  if (!A || !B) return -1;
  return Math.max(shiftNcc(A, B, shift), shiftNcc(B, A, shift));
}

/**
 * 이미 블로그에 나간 사진과 같은 화면인가(순수). 두 겹이다.
 *  · 같은 수종(표준명)이거나 같은 파일 — 서명 유사도 ≥ FRAME_SIG_SAME.
 *  · 수종 무관 — dHash 거리 < FRAME_HASH_IDENTICAL(중복 업로드·재전송본).
 * 같은 글의 리비전(pieceId 같음)·같은 글의 계보 런(runIds — frameLineageRuns, pieceId 없는 런 포함)은 자기 사진이라 뺀다.
 * 무엇과 겹쳤는지 돌려준다(로그용).
 */
export function findVisualDuplicate(
  cap: { hash?: string; sig?: string; species: string; mediaId: string; file: string },
  ledger: readonly BlogFrameRow[],
  opts: { pieceId?: string; runIds?: ReadonlySet<string> } = {},
): { row: BlogFrameRow; why: string } | null {
  for (const r of ledger) {
    if (r.status !== 'used') continue;
    if (isOwnRow(r, opts)) continue;
    if (cap.hash && r.hash) {
      const d = hammingHex(cap.hash, r.hash);
      if (d < FRAME_HASH_IDENTICAL) return { row: r, why: `해시 거리 ${d}` };
    }
    const kin = sameMedia(r, cap) || (!!cap.species && r.species === cap.species);
    if (kin && cap.sig && r.sig) {
      const sim = signatureSimilarity(cap.sig, r.sig);
      if (sim >= FRAME_SIG_SAME) return { row: r, why: `화면 유사도 ${sim.toFixed(2)}` };
    }
  }
  return null;
}

/** 같은 글의 줄인가 — pieceId 가 같거나, 같은 글의 계보 런(runIds)의 줄. */
const isOwnRow = (r: BlogFrameRow, opts: { pieceId?: string; runIds?: ReadonlySet<string> }): boolean =>
  (!!opts.pieceId && r.pieceId === opts.pieceId) || (!!r.runId && !!opts.runIds?.has(r.runId));

/**
 * 실제로 뗀 순간이 이미 다른 글의 컷 자리인가(순수) — 같은 파일 ±FRAME_NEAR_SEC 안의 'used' 줄(사진은 그 파일의
 * 'used' 줄 아무거나). 고를 때의 원장은 낡았을 수 있어 확정 직전(잠금 안)에 다시 본다. 같은 글(pieceId·계보 런)은 뺀다.
 */
export function findPositionClash(
  cap: { mediaId: string; file: string; kind: FrameKind; atSec: number },
  ledger: readonly BlogFrameRow[],
  opts: { pieceId?: string; runIds?: ReadonlySet<string> } = {},
): BlogFrameRow | undefined {
  return ledger.find((r) => r.status === 'used' && !isOwnRow(r, opts) && sameMedia(r, cap)
    && (cap.kind === 'image' || r.kind === 'image' || Math.abs(r.atSec - cap.atSec) <= FRAME_NEAR_SEC));
}

// ------------------------------ 예약 수명(읽을 때 판정) ------------------------------

/** 주인 글 — data/pieces/index.json 의 필요한 필드만. */
export interface FrameOwnerPiece {
  id: string; runId?: string; stage: string;
  publishedUrl?: string; privateUrl?: string; publishedTs?: string; naverDraftUrl?: string;
}

/** 런 세션의 흔적 — run.json 은 런이 끝날 때(finally)만 써지므로 '끝났는가'의 증거다. */
export interface FrameSessionState { exists: boolean; ended: boolean; draft: boolean }

/**
 * 반납 줄(원장에 덧붙인다) — 미발행 글을 지울 때 그 글의 컷을 돌려준다. mediaId·file 이 없어 readBlogFrameLedger
 * (와 그 이전 판)는 이 줄을 건너뛴다. frames 는 그 글 세션 매니페스트의 실촬영 항목 — 수동 런에서 시작해 리비전된
 * 글은 원장 줄에 pieceId 가 없고 runId 도 옛 런이라, 순간으로 짝을 짓는다.
 */
export interface BlogFrameRelease {
  ts: string;
  status: 'released';
  pieceId?: string;
  runIds: string[];
  frames: Array<{ mediaId: string; atSec: number }>;
  reason: string;
}

export interface FrameLiveness {
  pieces: readonly FrameOwnerPiece[];
  releases: readonly BlogFrameRelease[];
  session: (runId: string) => FrameSessionState;
  now: number;
}

const PUBLISHED_STAGES = new Set(['published', 'measured', 'reflected']);

/**
 * 발행 흔적(순수) — 하나라도 있으면 그 글의 컷은 영원히 막는다. 네이버 임시저장(naverDraftUrl)도 친다 — 사람이
 * 네이버 임시저장 글을 거기서 바로 발행할 수 있고, 그러면 우리 쪽엔 기록이 안 남는다.
 */
export function pieceHasPublishEvidence(p: FrameOwnerPiece): boolean {
  return PUBLISHED_STAGES.has(p.stage) || !!p.publishedUrl || !!p.privateUrl || !!p.publishedTs || !!p.naverDraftUrl;
}

function releaseCovers(rel: BlogFrameRelease, row: BlogFrameRow): boolean {
  // 반납 뒤에 새로 잡은 예약은 덮지 않는다(반납된 순간을 다른 글이 다시 받은 경우).
  const rt = Date.parse(row.ts), lt = Date.parse(rel.ts);
  if (!(Number.isFinite(rt) && Number.isFinite(lt)) || rt > lt) return false;
  if (row.pieceId) return row.pieceId === rel.pieceId;
  return rel.runIds.includes(row.runId)
    || rel.frames.some((f) => f.mediaId === row.mediaId && Math.abs(f.atSec - row.atSec) < 0.05);
}

/**
 * 이 원장 줄이 지금도 그 순간을 막는가(순수). 반납은 확실한 증거가 있을 때만이다.
 *  · 거절 줄 — 막는다(그 순간은 다시 볼 필요가 없다). 단 추출 실패(bad:)는 FRAME_BAD_TTL_DAYS 뒤 풀린다.
 *  · 주인 글이 색인에 있다 — 발행 흔적이 있으면 영원히 막는다. 진행·검토 중이면 막는다. stage 'error'(버려진 글)이고
 *    발행 흔적도 초안(draft.json — 그 줄의 런·글의 현재 런)도 없으면 반납 — 그 글이 되살아나면 다시 막힌다(읽을 때 판정).
 *  · 주인 글이 색인에 없다 — 지운 글이면 반납 줄이 있을 때만 반납(지울 때 미발행을 확인하고 쓴 줄이다).
 *    pieceId 없는 런(컴포저 런 — 끝나야 글로 승격된다)은 런이 끝났고(run.json, 또는 FRAME_RUN_MAX_HOURS 경과 — 죽은 런)
 *    초안(draft.json)이 없을 때만 반납 — 초안이 없으면 글로 승격되지도, 리비전되지도 않는다.
 *  · 세션이 사라진 것만으로는 반납하지 않는다 — 리비전된 수동 글은 piece.runId 가 새 런으로 옮겨 옛 런 세션이
 *    '글과 연결 안 된 세션'으로 janitor 에 치워지는데, 그 컷은 발행된 글이 쓰고 있을 수 있다. 대신 세션을 치우는 쪽이
 *    초안 없는 미연결 런이면 미리 반납 줄을 남긴다(releaseBlogFramesOfRemovedRun).
 */
export function frameRowBlocks(row: BlogFrameRow, ctx: FrameLiveness): boolean {
  // 대상이 적힌 중복 거절(dup:)은 원장 전체를 봐야 판정된다 — blockingFrameRows 가 대상이 아직 막는지로 다시 가른다.
  // 여기서는 혼자 판정할 수 없으니 막는다(애매하면 막는다).
  if (row.status === 'rejected') {
    if (!String(row.reason ?? '').startsWith(FRAME_BAD_PREFIX)) return true;
    const t = Date.parse(row.ts);
    return !(Number.isFinite(t) && ctx.now - t >= FRAME_BAD_TTL_DAYS * 86_400_000);
  }
  const owner = (row.pieceId ? ctx.pieces.find((p) => p.id === row.pieceId) : undefined)
    ?? (row.runId ? ctx.pieces.find((p) => p.runId === row.runId) : undefined);
  if (owner) {
    if (pieceHasPublishEvidence(owner) || owner.stage !== 'error') return true;
    // 버려진 글이라도 초안이 있으면 막는다 — 카드에서 사람이 그 초안(실사진 포함 매니페스트)을 바로 발행할 수 있다.
    const runs = [row.runId, owner.runId].filter((r): r is string => !!r);
    return runs.some((r) => ctx.session(r).draft);
  }
  if (ctx.releases.some((rel) => releaseCovers(rel, row))) return false;
  if (!row.pieceId && row.runId) {
    const s = ctx.session(row.runId);
    const t = Date.parse(row.ts);
    const dead = Number.isFinite(t) && ctx.now - t >= FRAME_RUN_MAX_HOURS * 3_600_000;
    if (s.exists && (s.ended || dead) && !s.draft) return false;
  }
  return true;
}

/** 같은 컷인가 — 같은 소재의 같은 순간(±0.05초). */
const sameFrame = (a: { mediaId: string; file?: string; atSec: number }, b: { mediaId: string; file?: string; atSec: number }): boolean =>
  sameMedia({ mediaId: a.mediaId, file: a.file ?? '' }, { mediaId: b.mediaId, file: b.file ?? '' }) && Math.abs(a.atSec - b.atSec) < 0.05;

/**
 * 지금 막고 있는 줄만(순수) — 고르기·중복 판정·소진 판정이 모두 이것을 본다.
 * 중복 거절(dup:) 줄은 겹친 대상 컷(dupOf)을 지금 막고 있는 'used' 줄이 하나라도 있을 때만 막는다(2026-10-02 2차 리뷰) —
 * 대상이 반납되면 그 순간을 다시 시도할 수 있다. 다시 시도해도 확정 직전 findVisualDuplicate 가 살아 있는 컷과 또 견주므로
 * 같은 사진이 두 번 나가지는 않는다(거절 줄은 시도 횟수를 아끼는 기록일 뿐이다). 대상이 안 적힌 옛 dup 줄은 계속 막는다.
 */
export function blockingFrameRows(ledger: readonly BlogFrameRow[], ctx: FrameLiveness): BlogFrameRow[] {
  const dupWithTarget = (r: BlogFrameRow): boolean => r.status === 'rejected' && String(r.reason ?? '').startsWith('dup:') && !!r.dupOf;
  const verdict = ledger.map((r) => (dupWithTarget(r) ? false : frameRowBlocks(r, ctx)));
  const liveUsed = ledger.filter((r, i) => verdict[i] && r.status === 'used');
  return ledger.filter((r, i) => (dupWithTarget(r) ? liveUsed.some((u) => sameFrame(u, r.dupOf!)) : verdict[i]));
}

/**
 * 이 글의 계보 런(순수) — 같은 글이 거쳐 온 런들. seed(현재 런·원 런·찾은 줄의 런) + 같은 pieceId 줄의 런에서 시작해
 * 재사용 줄의 from 을 거슬러 닫는다. pieceId 없는 런(컴포저 런에서 승격된 글의 첫 줄, 수동 리비전)도 이렇게 묶인다 —
 * 안 묶으면 초안이 남아 계속 막는 옛 줄과 자기 컷이 부딪혀 리비전마다 새 컷을 먹는다.
 */
export function frameLineageRuns(
  ledger: readonly BlogFrameRow[], seed: { pieceId?: string; runIds: ReadonlyArray<string | undefined> },
): Set<string> {
  const out = new Set(seed.runIds.filter((r): r is string => !!r));
  if (seed.pieceId) for (const r of ledger) if (r.status === 'used' && r.pieceId === seed.pieceId && r.runId) out.add(r.runId);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of ledger) {
      if (r.status === 'used' && r.from && out.has(r.runId) && !out.has(r.from)) { out.add(r.from); grew = true; }
    }
  }
  return out;
}

/**
 * 지우는 글의 반납 줄(순수). 발행 흔적이 있으면 null — 카드를 지워도 네이버 글은 남으므로 그 컷은 영원히 막는다.
 * realEntry 는 그 글 세션 매니페스트의 실촬영 항목(realFrameEntry).
 */
export function blogFrameReleaseFor(
  piece: FrameOwnerPiece, realEntry: ManifestImage | undefined, ts: string, reason = 'piece-deleted',
): BlogFrameRelease | null {
  if (pieceHasPublishEvidence(piece)) return null;
  const mediaId = String(realEntry?.['mediaId'] ?? '');
  const atSec = Number(realEntry?.['atSec']);
  return {
    ts, status: 'released', pieceId: piece.id, runIds: piece.runId ? [piece.runId] : [],
    frames: mediaId && Number.isFinite(atSec) ? [{ mediaId, atSec }] : [], reason,
  };
}

/**
 * 글 삭제 훅(fail-open) — 미발행 글이면 반납 줄을 덧붙인다. 세션을 휴지통으로 옮기기 **전에** 불러야 매니페스트를 읽는다.
 */
export function releaseBlogFramesOfDeletedPiece(
  piece: FrameOwnerPiece, dirs: { dataDir: string; sessionsDir: string }, reason?: string,
): boolean {
  try {
    let entry: ManifestImage | undefined;
    if (piece.runId) {
      try { entry = realFrameEntry(JSON.parse(fs.readFileSync(path.join(dirs.sessionsDir, piece.runId, 'image_manifest.json'), 'utf-8'))); }
      catch { /* 매니페스트 없음 — pieceId·runId 로만 짝짓는다 */ }
    }
    const rel = blogFrameReleaseFor(piece, entry, new Date().toISOString(), reason);
    if (!rel) return false;
    const file = blogFrameLedgerPath(dirs.dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(rel)}\n`, 'utf-8');
    return true;
  } catch { return false; }
}

/**
 * 세션을 치우기 전 반납(2026-10-02 2차 리뷰, fail-open) — janitor 의 미연결 세션 이동·DELETE /runs/:id 가 부른다.
 *
 * pieceId 없는 런(컴포저 런)의 예약은 frameRowBlocks 가 '세션이 있고, 끝났고, 초안이 없다'를 보고 푼다. 세션이 사라지면
 * 그 근거가 없어져 다시 막힌다 — 이미 풀려 있던 판정을 반납 줄로 굳혀 둔다. 조건은 frameRowBlocks 와 같다:
 * 그 런을 가리키는 글이 없고(색인), 초안(draft.json)이 없다. 색인을 못 읽으면 반납하지 않는다.
 * 발행 흔적이 있는 글이 같은 컷을 쓰고 있으면(그 글의 원장 줄·세션 매니페스트의 실촬영 항목) 반납하지 않는다.
 *
 * 반납 줄은 runIds 만 적고 frames 는 비운다 — 이 런의 줄은 전부 이 runId 를 달고 있어 runIds 로 충분하다. frames 로
 * 짝을 지으면 releaseCovers 가 다른 런의 pieceId 없는 같은 순간 줄(같은 글 계보의 재사용 줄 등)까지 풀어 버린다.
 */
export function releaseBlogFramesOfRemovedRun(
  runId: string, dirs: { dataDir: string; sessionsDir: string }, reason = 'session-removed',
): boolean {
  try {
    if (!runId || path.basename(runId) !== runId) return false;
    const dir = path.join(dirs.sessionsDir, runId);
    if (fs.existsSync(path.join(dir, 'draft.json'))) return false;
    let pieces: FrameOwnerPiece[] = [];
    const idx = path.join(dirs.dataDir, 'pieces', 'index.json');
    if (fs.existsSync(idx)) {
      const raw = JSON.parse(fs.readFileSync(idx, 'utf-8')) as unknown; // 깨졌으면 throw → 반납 안 함
      if (!Array.isArray(raw)) return false;
      pieces = raw.filter((p): p is FrameOwnerPiece => !!p && typeof p === 'object' && typeof (p as FrameOwnerPiece).id === 'string');
    }
    if (pieces.some((p) => p.runId === runId)) return false;
    const file = blogFrameLedgerPath(dirs.dataDir);
    const ledger = readBlogFrameLedger(file);
    const mine = ledger.filter((r) => r.status === 'used' && r.runId === runId && !r.pieceId);
    if (!mine.length) return false;
    for (const p of pieces.filter(pieceHasPublishEvidence)) {
      if (ledger.some((r) => r.status === 'used' && r.runId !== runId && (r.pieceId === p.id || (!!p.runId && r.runId === p.runId))
        && mine.some((m) => sameFrame(m, r)))) return false;
      if (!p.runId) continue;
      for (const name of ['image_manifest.json', '06_image_manifest.json']) {
        let e: ManifestImage | undefined;
        try { e = realFrameEntry(JSON.parse(fs.readFileSync(path.join(dirs.sessionsDir, p.runId, name), 'utf-8'))); } catch { continue; }
        const at = Number(e?.['atSec']);
        if (e && Number.isFinite(at) && mine.some((m) => sameFrame(m, { mediaId: String(e['mediaId'] ?? ''), atSec: at }))) return false;
      }
    }
    const rel: BlogFrameRelease = { ts: new Date().toISOString(), status: 'released', runIds: [runId], frames: [], reason };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(rel)}\n`, 'utf-8');
    return true;
  } catch { return false; }
}

/**
 * 이 글이 이미 받은 실촬영 컷(순수) — 같은 글의 리비전은 새 컷을 먹지 않고 자기 것을 다시 쓴다.
 * pieceId 가 같은 행이 정본이고(연쇄 리비전도 같은 piece), 없으면 원 런(baseRunId) 행. 여럿이면 가장 나중 줄 —
 * 리비전마다 재사용 줄(from)이 덧붙으므로 마지막 줄이 지금 런 바로 앞의 것이다.
 */
export function frameForPiece(ledger: readonly BlogFrameRow[], opts: { pieceId?: string; baseRunId?: string }): BlogFrameRow | undefined {
  const used = ledger.filter((r) => r.status === 'used');
  const byPiece = opts.pieceId ? used.filter((r) => r.pieceId === opts.pieceId) : [];
  const byRun = opts.baseRunId ? used.filter((r) => r.runId === opts.baseRunId) : [];
  return (byPiece.length ? byPiece : byRun).at(-1);
}

/** 계절 딱지(정확히 일치만 — '겨울나기' 같은 장면 딱지는 남는다). */
const SEASON_TAG = /^(초|늦|한)?(봄|여름|가을|겨울)$/;

/**
 * 디자이너에게 넘길 장면 딱지(순수) — 계절 딱지는 뺀다. 보관소 딱지의 계절은 '찍은 철'이지 이 장면이 무엇인지가
 * 아니다(79개 전부 '가을'). 그대로 넘기면 2·3번 생성 그림까지 글과 무관하게 그 계절로 끌려간다.
 */
export function realFrameSceneTags(tags: readonly string[]): string[] {
  return tags.map((t) => String(t).trim()).filter((t) => t && !SEASON_TAG.test(t));
}

/** 실촬영 컷 슬롯 대체텍스트 — 발행 alt 와 미리보기 캡션에 그대로 나간다. */
export function realFrameAlt(species: string): string {
  return `${species || '나무'} — 비온디트리 농원에서 직접 촬영`;
}

/**
 * 이미지 슬롯 앞에 실촬영 컷을 끼우고 총 장수를 맞춘다(순수). 실촬영이 첫 [IMAGE:] 마커를 받는다
 * (smarteditor.draftToFinalContent 가 슬롯 i 를 i 번째 마커에 놓는다). 총 3장 = 실촬영 1 + 생성 2 —
 * 작가가 다는 마커가 실측 2~3개라 4장째는 대개 본문 끝 고아 이미지가 된다(2026-10-02 세션 조사).
 */
export function withRealFrameSlot<T extends { alt: string; prompt: string }>(
  slots: readonly T[], real: { alt: string; prompt: string }, total = 3,
): Array<{ alt: string; prompt: string }> {
  return [{ alt: real.alt, prompt: real.prompt }, ...slots.slice(0, Math.max(0, total - 1))];
}

export interface ManifestImage { index?: number; filename?: string; file_path?: string; [k: string]: unknown }

/**
 * 생성 매니페스트(블로그 이미지 02~) 앞에 실촬영 컷 항목을 합친다(순수). 실촬영 항목은 index 0 · source
 * 'archive_frame' · ai:false — 발행(naver_publish.is_real_photo)은 source 'archive_frame' 만 보고 'AI 활용' 표시를
 * 끈다(ai:false 는 기록용 — 모델이 쓰는 blog_publish 경로는 두 필드를 지운다).
 * 생성 쪽에 같은 자리(index 0 / blog-image-01.png)가 있으면 버린다(복원 매니페스트가 실촬영 파일을 표시 없이
 * 집어 온 경우). index 가 없는 항목(복원 매니페스트 — 자리 순서)은 자리 번호를 index 로 박는다 — 발행 쪽이
 * 빈 자리를 압축하면 그 뒤 이미지가 앞 마커로 당겨지기 때문이다.
 */
export function mergeRealFrameManifest(
  manifest: unknown,
  real: { file_path: string; alt: string; mediaId: string; atSec: number; species: string; hash?: string },
): Record<string, unknown> {
  const src = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest as Record<string, unknown> : {};
  const imgs = Array.isArray(src.images) ? src.images as Array<ManifestImage | null> : [];
  const realName = path.basename(real.file_path);
  const rest = imgs
    .map((it, pos) => (it && typeof it === 'object' ? { ...it, index: typeof it.index === 'number' ? it.index : pos } : null))
    .filter((it): it is ManifestImage & { index: number } => !!it
      && it.index !== 0 && path.basename(String(it.filename ?? it.file_path ?? '')) !== realName);
  const entry = {
    index: 0, filename: realName, file_path: real.file_path, alt: real.alt,
    source: 'archive_frame', ai: false, mediaId: real.mediaId, atSec: real.atSec, species: real.species,
    ...(real.hash ? { hash: real.hash } : {}),
  };
  const images: ManifestImage[] = [entry, ...rest];
  const ok = images.filter((e) => !('error' in e) && !e['dry_run']).length;
  return { ...src, images, count: images.length, ok };
}

/** 실촬영 매니페스트 항목(있으면) — 리비전이 원 런 세션의 파일을 그대로 복사해 오는 데 쓴다. */
export function realFrameEntry(manifest: unknown): ManifestImage | undefined {
  const src = manifest && typeof manifest === 'object' ? manifest as Record<string, unknown> : {};
  const imgs = Array.isArray(src.images) ? src.images as Array<ManifestImage | null> : [];
  return imgs.find((it): it is ManifestImage => !!it && typeof it === 'object' && it['source'] === 'archive_frame');
}

// ------------------------------ 원장(덧붙이기 전용) ------------------------------

export function blogFrameLedgerPath(dataDir: string): string {
  return path.join(dataDir, 'media', 'blog_frames.jsonl');
}

/** 원장 읽기 — 없거나 깨진 줄은 건너뛴다(fail-open). 필수 필드가 없는 줄도 버린다. */
export function readBlogFrameLedger(file: string): BlogFrameRow[] {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return []; }
  const out: BlogFrameRow[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Partial<BlogFrameRow>;
      if (!o || typeof o !== 'object' || (!o.mediaId && !o.file)) continue;
      const at = Number(o.atSec);
      out.push({
        ts: String(o.ts ?? ''), runId: String(o.runId ?? ''), ...(o.pieceId ? { pieceId: String(o.pieceId) } : {}),
        mediaId: String(o.mediaId ?? ''), file: String(o.file ?? ''), kind: o.kind === 'image' ? 'image' : 'video',
        atSec: Number.isFinite(at) ? at : 0, species: String(o.species ?? ''),
        ...(typeof o.hash === 'string' && o.hash ? { hash: o.hash } : {}),
        ...(typeof o.sig === 'string' && o.sig ? { sig: o.sig } : {}),
        status: o.status === 'rejected' ? 'rejected' : 'used',
        ...(o.reason ? { reason: String(o.reason) } : {}),
        ...(typeof o.from === 'string' && o.from ? { from: o.from } : {}),
        ...(o.dupOf && typeof o.dupOf === 'object' && (o.dupOf.mediaId || o.dupOf.file) && Number.isFinite(Number(o.dupOf.atSec))
          ? { dupOf: { mediaId: String(o.dupOf.mediaId ?? ''), ...(o.dupOf.file ? { file: String(o.dupOf.file) } : {}), atSec: Number(o.dupOf.atSec) } }
          : {}),
      });
    } catch { /* 깨진 줄 — 건너뛴다 */ }
  }
  return out;
}

/** 반납 줄만 읽는다(fail-open). */
export function readBlogFrameReleases(file: string): BlogFrameRelease[] {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return []; }
  const out: BlogFrameRelease[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.includes('"released"')) continue;
    try {
      const o = JSON.parse(t) as Partial<BlogFrameRelease>;
      if (!o || o.status !== 'released') continue;
      out.push({
        ts: String(o.ts ?? ''), status: 'released', ...(o.pieceId ? { pieceId: String(o.pieceId) } : {}),
        runIds: Array.isArray(o.runIds) ? o.runIds.map(String).filter(Boolean) : [],
        frames: Array.isArray(o.frames)
          ? o.frames.filter((f) => f && typeof f.mediaId === 'string' && Number.isFinite(Number(f.atSec))).map((f) => ({ mediaId: f.mediaId, atSec: Number(f.atSec) }))
          : [],
        reason: String(o.reason ?? ''),
      });
    } catch { /* 깨진 줄 — 건너뛴다 */ }
  }
  return out;
}

export function appendBlogFrame(file: string, row: BlogFrameRow): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf-8');
}
