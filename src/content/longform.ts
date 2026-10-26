/**
 * 롱폼 레코드 스토어(2026-10-22) — shorts.ts 와 같은 파일 영속 패턴(원자적 교체).
 *
 * 롱폼은 10분 가로 영상 한 편이 1GB 가까이 된다. 산출물(final.mp4·script.json·timeline.json·
 * subtitles.srt·thumbnail.jpg)은 data/longform/<dir>/ 에, 인덱스(index.json)는 목록·상태 폴링용 메타만 담는다.
 *
 * dir 은 **data/longform/ 기준 상대 경로**(폴더 이름)다 — 데이터 디렉터리를 갈아끼워도(GEPA_DATA_DIR) 레코드가
 * 그대로 따라오게 절대 경로를 박지 않는다. 시범(pilot-2026-10-19)처럼 id 와 폴더 이름이 다를 수 있어 따로 둔다.
 * 실제 경로는 absDir() 로만 얻는다(경로 밖으로 나가는 dir 은 거절).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { activeBrandSlug } from './brand';
import { genId } from '../util/ids';
import { isStoreFileCorrupt, readJsonArray, writeJsonAtomic } from '../util/jsonStore';

export type LongformStage = 'producing' | 'ready' | 'error';
/** 썸네일 상태 — pending=생성 중 · ok=QA 통과 · qa_failed=한글 QA 미해결(발행 게이트) · none=아직 없음. */
export type LongformThumbState = 'pending' | 'ok' | 'qa_failed' | 'none';
/** 유튜브 업로드 상태 — 업로드는 뒤에서 돈다(수 분~수십 분). 화면·텔레그램은 이걸 보고 진행을 안다. */
export type LongformYoutubeState = 'uploading' | 'processing' | 'done' | 'failed';

export interface LongformRecord {
  id: string;
  brand: string;
  title: string;
  /** data/longform/ 기준 폴더 이름(상대) — absDir() 참고. */
  dir: string;
  stage: LongformStage;
  /** 진행 표시(제작 단계 문구, 업로드 중엔 '업로드 42%'). */
  progress?: string;
  error?: string;
  createdTs: string;
  updatedTs?: string;
  durationSec?: number;
  /** 이 주제를 고른 이유(블로그+숏폼 조회 합산 상위 등) — 알림에 그대로 싣는다. */
  topicReason?: string;
  sourcePieceIds?: string[];
  /** 주제 키(`작업:기둥 수종` — longform/topic.ts) — 같은 주제를 다시 만들지 않는 판정에 쓴다. */
  topicKey?: string;
  ytTitle?: string;
  /** 유튜브 설명 — 챕터 줄(0:00 …)을 포함한다. */
  ytDescription?: string;
  ytTags?: string[];
  thumbState?: LongformThumbState;
  youtubeState?: LongformYoutubeState;
  youtubeError?: string;
  youtubeId?: string;
  youtubeUrl?: string;
  youtubeTs?: string;
  /** 검토 대기 알림 발송 시각. */
  notifiedTs?: string;
  costUsd?: number;
  // ── 품질 경고(2026-10-25) — 검토 알림 캡션 맨 위에 싣는다. 발행은 막지 않는다(사람이 보고 누른다).
  /** 그림 단계 — 만든 장면 수 / 문장 수. built < total 이면 빠진 장면은 실촬영+자막. */
  sceneBuilt?: number;
  sceneTotal?: number;
  /** 낭독 받아쓰기 실패 문장 수 / 문장 수 — 그 문장은 발음 확인 없이 첫 녹음 그대로. */
  sttFailed?: number;
  sttTotal?: number;
  /** 발음 의심(숫자·부정이 다르게 들렸거나 점수 0.9 미만) — 앞 몇 개만. pronSuspectCount 는 전체 수. */
  pronSuspect?: Array<{ id: string; text: string; score: number; mismatch?: string }>;
  pronSuspectCount?: number;
  /** 사실 확인 — ok · error(판정기 재시도도 실패) · residual(근거 없는/모순 주장이 문장에 안 붙어 남음, residual = 건수). */
  factState?: { status: 'ok' | 'error' | 'residual'; residual?: number };
  /** 누가 시작했나 — weekly(매주 자동). 재시작으로 끊긴 주간 편만 자동 재시도한다. */
  trigger?: 'weekly' | 'manual';
  /** 재시작으로 끊겨 한 번 자동 재시도했다(같은 폴더) — 두 번째로 끊기면 재시도하지 않는다(재시작 고리에서 돈을 계속 쓰지 않게). */
  autoRetried?: boolean;
}

/** 로컬 날짜 yyyy-mm-dd(순수). */
const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 재시작으로 끊긴 편을 자동으로 한 번 다시 만들까(순수) — 오늘 주간 자동 실행으로 시작했고 아직 재시도 전인 제작 중 편만. */
export function longformRetryDue(r: Pick<LongformRecord, 'stage' | 'trigger' | 'autoRetried' | 'createdTs'>, now: Date): boolean {
  return r.stage === 'producing' && r.trigger === 'weekly' && !r.autoRetried && localDay(new Date(r.createdTs)) === localDay(now);
}

/** 검토 알림 다시 보낼까(순수) — 완성됐는데 알림이 안 나갔고 아직 안 올린 7일 안 편(시범 편은 올렸으니 제외). */
export const LONGFORM_RESEND_DAYS = 7;
export function longformResendDue(r: Pick<LongformRecord, 'stage' | 'notifiedTs' | 'youtubeId' | 'youtubeUrl' | 'youtubeState' | 'createdTs'>, now: Date): boolean {
  if (r.stage !== 'ready' || r.notifiedTs || r.youtubeId || r.youtubeUrl || r.youtubeState) return false;
  const age = now.getTime() - new Date(r.createdTs).getTime();
  return Number.isFinite(age) && age >= 0 && age < LONGFORM_RESEND_DAYS * 86_400_000;
}

export interface CreateLongformInput {
  /** 시범처럼 이미 있는 폴더를 잇는 경우 id 를 고정한다. 없으면 long_xxxxxxxxxx. */
  id?: string;
  title: string;
  /** 폴더 이름 — 없으면 id 와 같게. */
  dir?: string;
  brand?: string;
  stage?: LongformStage;
  patch?: Partial<LongformRecord>;
}

/** 폴더 이름이 data/longform/ 밖으로 나가지 않는가(순수) — '..'·절대 경로·구분자 섞인 이름 거절. */
export function isSafeLongformDir(dir: string): boolean {
  return !!dir && dir === path.basename(dir) && dir !== '.' && dir !== '..' && !/[\\/]/.test(dir);
}

/** 열린 범위(bytes=N-) 한 번에 보낼 최대 크기 — 1GB 를 한 응답으로 흘리지 않는다(브라우저는 이어서 다음 범위를 묻는다). */
export const LONGFORM_RANGE_CAP = 8 * 1024 * 1024;

/**
 * 영상 Range 머리 해석(순수) — null=Range 없음(전체 200 스트림) · 'invalid'=만족 불가(416) · {start,end}=206 부분.
 * 쇼츠 라우트는 범위 전체를 Buffer 로 잡는데, 롱폼은 1GB 라 브라우저가 'bytes=0-'(끝까지)를 물으면 메모리가 터진다.
 * 그래서 열린 범위는 cap 만큼만 답한다(206 + 정확한 Content-Range — 표준상 서버가 더 짧게 답해도 된다).
 * 끝을 밝힌 범위·뒤에서 K바이트(bytes=-K)는 그대로 — 어차피 스트림으로 흘린다. 여러 범위(쉼표)는 전체로 답한다.
 */
export function longformRange(header: string | undefined, size: number, cap = LONGFORM_RANGE_CAP): { start: number; end: number } | 'invalid' | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (!m[1] && !m[2])) return null;
  if (size <= 0) return 'invalid';
  if (!m[1]) {
    const k = parseInt(m[2]!, 10);
    if (!Number.isFinite(k) || k <= 0) return 'invalid';
    return { start: Math.max(0, size - k), end: size - 1 };
  }
  const start = parseInt(m[1], 10);
  if (!Number.isFinite(start) || start >= size) return 'invalid';
  const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : Math.min(size - 1, start + cap - 1);
  return start > end ? 'invalid' : { start, end };
}

export class LongformStore {
  private file: string;
  private items = new Map<string, LongformRecord>();
  constructor(private root: string = path.join(CONFIG.dataDir, 'longform')) {
    this.file = path.join(root, 'index.json');
    this.load();
  }
  /** 색인이 깨져(ENOENT 아닌 읽기·파싱 실패) 이번 실행 동안 저장을 막고 있나(2026-10-26) — 정리기가 이 목록을 믿지 않게 한다. */
  get corrupt(): boolean { return isStoreFileCorrupt(this.file); }
  private load(): void {
    // 없으면 빈 스토어, 깨졌으면 .corrupt-<시각> 으로 옮기고 빈 채로 뜨되 저장은 막는다(util/jsonStore).
    const r = readJsonArray<LongformRecord>(this.file, '롱폼(longform)');
    for (const s of r.value ?? []) if (s && s.id) this.items.set(s.id, s);
  }
  private persistWarned = false;
  private persist(): void {
    try {
      writeJsonAtomic(this.file, [...this.items.values()], { backup: true }); // tmp+fsync+rename, 직전 판은 .bak
    } catch (e) {
      // 영속 실패는 다음 변경에서 재시도 — 다만 깨진 색인으로 막힌 경우는 한 번만 크게 남긴다(매 변경마다 로그 홍수 방지).
      if (this.corrupt && this.persistWarned) return;
      if (this.corrupt) this.persistWarned = true;
      console.error(`[저장소] 롱폼(longform) 저장 실패 — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /** 레코드 산출물 폴더(절대). dir 이 안전하지 않으면 null — 라우트가 파일을 서빙하기 전에 반드시 거친다. */
  absDir(rec: Pick<LongformRecord, 'dir'>): string | null {
    return isSafeLongformDir(rec.dir) ? path.join(this.root, rec.dir) : null;
  }
  create(input: CreateLongformInput): LongformRecord {
    const id = input.id ?? genId('long');
    const dir = input.dir ?? id;
    if (!isSafeLongformDir(dir)) throw new Error(`롱폼 폴더 이름이 안전하지 않음: ${dir}`);
    if (this.items.has(id)) throw new Error(`이미 있는 롱폼 id: ${id}`);
    const now = new Date().toISOString();
    const rec: LongformRecord = {
      ...input.patch,
      id, dir, title: input.title.trim(),
      brand: input.brand ?? activeBrandSlug(),
      stage: input.stage ?? 'producing',
      createdTs: now, updatedTs: now,
    };
    this.items.set(id, rec);
    this.persist();
    return rec;
  }
  get(id: string): LongformRecord | undefined { return this.items.get(id); }
  /** 최신순 정렬 사본. */
  list(): LongformRecord[] { return [...this.items.values()].sort((a, b) => b.createdTs.localeCompare(a.createdTs)); }
  update(id: string, patch: Partial<LongformRecord>): LongformRecord | undefined {
    const s = this.items.get(id);
    if (!s) return undefined;
    // id·createdTs·dir 은 바꾸지 않는다 — dir 이 바뀌면 영상 서빙 경로가 조용히 바뀐다.
    const next: LongformRecord = { ...s, ...patch, id: s.id, createdTs: s.createdTs, dir: s.dir, updatedTs: new Date().toISOString() };
    this.items.set(id, next);
    this.persist();
    return next;
  }
  /** 인덱스에서만 제거 — 산출물 파일은 남긴다(shorts 와 같은 비파괴 원칙). */
  remove(id: string): boolean {
    const existed = this.items.delete(id);
    if (existed) this.persist();
    return existed;
  }
}

let _store: LongformStore | null = null;
export function longformStore(): LongformStore {
  if (!_store) _store = new LongformStore();
  return _store;
}
