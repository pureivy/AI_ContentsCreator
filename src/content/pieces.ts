/**
 * Piece 저장소 — 콘텐츠 1건의 라이프사이클(idea→research→draft→ready→published→measured→reflected)을
 * 런과 별개로 영속한다. 완전 자율 캘린더가 여러 런·재시작에 걸쳐 piece 를 이동시키므로, 스테이지를 디스크에
 * (data/pieces/index.json, 원자적 tmp+rename) 지속해 재시작·중단 후에도 stranded 되지 않게 한다.
 *
 * 초안 asset(draft.{json,md,html})은 이미 finalize 가 data/sessions/<runId>/ 에 쓰므로(6c), piece 는 runId
 * 참조만 들고 초안은 디스크에서 재로드한다 — 메모리 전용 positions 의존(재시작 409)을 피한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { genId } from '../util/ids';

export type PieceStage =
  | 'idea' | 'research' | 'draft' | 'ready' | 'published' | 'measured' | 'reflected' | 'error';

/** 비종료 스테이지 — 자율 사이클이 '재개' 대상으로 스캔(런이 죽어 stranded 된 piece 회수). */
export const RESUMABLE_STAGES: readonly PieceStage[] = ['idea', 'research', 'draft'];

export interface Piece {
  id: string;
  /** 초안을 생산한 org 런 id — draft.* 는 data/sessions/<runId>/ 에서 재로드. */
  runId?: string;
  /** 브랜드(고객사) 슬러그 — 생성 시점의 활성 브랜드. 범용 모드 생성물은 undefined. */
  brand?: string;
  title: string;
  keyword?: string;
  subNiche?: string;
  stage: PieceStage;
  publishedUrl?: string;
  /** 네이버 임시저장 성공 시 편집기 URL(발행 아님 — 사람이 네이버에서 확인 후 발행). */
  naverDraftUrl?: string;
  /** 마지막 네이버 임시저장 시각(ISO). */
  naverDraftTs?: string;
  /** 네이버 발행 성공 시각(ISO) — 성과 대시보드 '발행일'·날짜 정렬 기준(2026-07-20). 최초 발행 1회 기록. */
  publishedTs?: string;
  seoScore?: number;
  /** 실런 실패 횟수(사용자 양보=취소는 제외) — 폭주 방지 캡. */
  errors?: number;
  /** SEO 미달로 자동 리비전을 돌린 횟수 — 자동 임시저장 게이트의 무한 루프 방지(캡 1). */
  autoRevisions?: number;
  /** 검토 대기(ready) 알림 발송 시각 — 미기록이면 부팅 복구 스윕이 재발송(재시작으로 fire-and-forget 유실 대비, 2026-07-31). */
  notifiedTs?: string;
  /** 자율 사이클이 만든 것인지(수동 생성과 카덴스 쿼터 분리용). */
  auto?: boolean;
  createdTs: string;
  updatedTs: string;
}

export interface CreatePieceInput { title: string; keyword?: string; subNiche?: string; stage?: PieceStage; brand?: string; auto?: boolean; }

const MAX_ERRORS = 3;

export class PieceStore {
  private file: string;
  private items = new Map<string, Piece>();
  constructor(dir: string = path.join(CONFIG.dataDir, 'pieces')) {
    this.file = path.join(dir, 'index.json');
    this.load();
  }
  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Piece[];
      if (Array.isArray(raw)) for (const p of raw) if (p && p.id) this.items.set(p.id, p);
    } catch { /* 없으면 빈 스토어 */ }
  }
  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...this.items.values()], null, 2), 'utf-8');
      fs.renameSync(tmp, this.file); // 원자적 교체 — 부분 쓰기로 인덱스 오염 방지.
    } catch { /* 영속 실패 무해(다음 변경에서 재시도) */ }
  }
  create(input: CreatePieceInput): Piece {
    const now = new Date().toISOString();
    const p: Piece = {
      id: genId('piece'), title: input.title.trim(),
      keyword: input.keyword?.trim() || undefined, subNiche: input.subNiche?.trim() || undefined,
      brand: input.brand?.trim() || undefined, auto: input.auto,
      stage: input.stage ?? 'idea', errors: 0, createdTs: now, updatedTs: now,
    };
    this.items.set(p.id, p);
    this.persist();
    return p;
  }
  get(id: string): Piece | undefined { return this.items.get(id); }
  /** 생성순(오래된→최신) 정렬 사본. */
  list(): Piece[] { return [...this.items.values()].sort((a, b) => a.createdTs.localeCompare(b.createdTs)); }
  update(id: string, patch: Partial<Piece>): Piece | undefined {
    const p = this.items.get(id);
    if (!p) return undefined;
    const next: Piece = { ...p, ...patch, id: p.id, createdTs: p.createdTs, updatedTs: new Date().toISOString() };
    this.items.set(id, next);
    this.persist();
    return next;
  }
  setStage(id: string, stage: PieceStage): Piece | undefined { return this.update(id, { stage }); }
  setPublished(id: string, url: string, publishedTs?: string): Piece | undefined {
    const cur = this.items.get(id);
    // publishedTs 는 최초 발행 1회만 기록(재감지·URL 갱신에도 최초 발행일 보존). RSS 감지는 실제
    // 발행시각(pubDate)을 넘겨 정확한 발행일이 되고, 수동 발행은 미지정 → now(발행 등록 시각).
    return this.update(id, { stage: 'published', publishedUrl: url, ...(cur?.publishedTs ? {} : { publishedTs: publishedTs || new Date().toISOString() }) });
  }
  /** piece 삭제(카드 제거) — 산출물 파일(sessions·성과 샘플)은 남긴다(비파괴: 인덱스에서만 제거). */
  remove(id: string): boolean {
    const existed = this.items.delete(id);
    if (existed) this.persist();
    return existed;
  }
  /** 실런 실패 기록 — 사용자 양보(취소)에는 호출하지 않는다. 캡 초과 시 'error' 로 종료(폭주 방지). */
  recordError(id: string): Piece | undefined {
    const p = this.items.get(id);
    if (!p) return undefined;
    const errors = (p.errors ?? 0) + 1;
    return this.update(id, errors >= MAX_ERRORS ? { errors, stage: 'error' } : { errors });
  }
}

/**
 * 재개 대상 선택(순수 — 테스트 가능) — 비종료 스테이지 & 라이브 런 없음 중 가장 오래된 piece. 없으면 null.
 * 자율 틱은 '새 아이디어 제안'보다 이 재개를 먼저 처리해, 사용자 런 양보·재시작으로 죽은 piece 를 회수한다.
 */
export function selectResumablePiece(pieces: Piece[], isLive: (runId?: string) => boolean): Piece | null {
  const resumable = pieces
    .filter((p) => RESUMABLE_STAGES.includes(p.stage) && !isLive(p.runId))
    .sort((a, b) => a.createdTs.localeCompare(b.createdTs));
  return resumable[0] ?? null;
}

let _store: PieceStore | null = null;
/** 프로세스 공유 단일 스토어. */
export function pieceStore(): PieceStore { return (_store ??= new PieceStore()); }
