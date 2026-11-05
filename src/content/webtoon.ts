/**
 * 웹툰 숏폼 작업 기록(2026-11-05, 1단계 시범) — SHORT_marker 로 만드는 동안의 상태만 여기 둔다(data/webtoon/index.json).
 *
 * 숏폼 기록(data/shorts)은 영상이 나온 뒤에야 만든다. 만드는 중인 숏폼 기록은 부팅 복구가 우리 숏폼 파이프라인으로 다시 돌려
 * (recoveries) 전혀 다른 영상이 나오기 때문이다. 완성되면 shortId 로 숏폼 기록과 잇고, 발행·텔레그램·정리는 숏폼 쪽이 맡는다.
 */
import path from 'node:path';
import { CONFIG } from '../config';
import { activeBrandSlug } from './brand';
import { genId } from '../util/ids';
import { readJsonArray, writeJsonAtomic } from '../util/jsonStore';
import type { FactGateInfo } from './factGate';

/** writing 장면 목록 → checking 원문 대조 → drawing 그림 → review 사람 확인 → producing 영상 → ready. */
export type WebtoonStage = 'writing' | 'checking' | 'drawing' | 'review' | 'producing' | 'ready' | 'error' | 'cancelled';
export const WEBTOON_ACTIVE: readonly WebtoonStage[] = ['writing', 'checking', 'drawing', 'producing'];

export interface WebtoonScene { id: string; narration: string; motion?: string }

export interface WebtoonJob {
  id: string;
  brand?: string;
  /** 원본 블로그 글. */
  pieceId: string;
  topic: string;
  keyword?: string;
  /** SHORT_marker projects/<project> — 보통 id 와 같다(기존 프로젝트로 시험할 때만 다르다). */
  project: string;
  stage: WebtoonStage;
  hook?: string;
  scenes?: WebtoonScene[];
  /** 낭독 문장 원문 대조 결과 — 완성 때 숏폼 기록 factGate 로 넘어가 발행 확인(shortsFactHoldBlockReason)을 건다. */
  factGate?: FactGateInfo;
  /** 장면별 다시 그린 횟수(shotlist 의 redraw 와 같다). */
  redraws?: Record<string, number>;
  /** 완성 숏폼 기록 id. */
  shortId?: string;
  durationSec?: number;
  /** 단계별 걸린 시간(초). */
  wallSec?: Partial<Record<'writing' | 'drawing' | 'producing', number>>;
  /** 진행 로그 마지막 줄들(제작실 표시용). */
  log?: string[];
  error?: string;
  /** 실패·중단·취소 때 돌던 단계 — '이어서 만들기'가 어디서 다시 시작할지 정한다(오류 문구로 판정하지 않는다). */
  failedStage?: WebtoonStage | 'registering';
  /** 시험 실행 — 텔레그램 검토 알림을 보내지 않는다. */
  quiet?: boolean;
  createdTs: string;
  updatedTs: string;
}

export class WebtoonStore {
  private file: string;
  private items = new Map<string, WebtoonJob>();
  constructor(private dir: string = path.join(CONFIG.dataDir, 'webtoon')) {
    this.file = path.join(dir, 'index.json');
    const r = readJsonArray<WebtoonJob>(this.file, '웹툰(webtoon)');
    for (const j of r.value ?? []) if (j && j.id) this.items.set(j.id, j);
  }
  private persist(): void {
    try { writeJsonAtomic(this.file, [...this.items.values()], { backup: true }); } catch (e) {
      console.error(`[저장소] 웹툰(webtoon) 저장 실패 — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  create(input: { pieceId: string; topic: string; keyword?: string; project?: string; quiet?: boolean }): WebtoonJob {
    const now = new Date().toISOString();
    const id = genId('webtoon');
    const j: WebtoonJob = {
      id, brand: activeBrandSlug() || undefined, pieceId: input.pieceId, topic: input.topic.trim(),
      ...(input.keyword ? { keyword: input.keyword } : {}), project: input.project || id,
      ...(input.quiet ? { quiet: true } : {}), stage: 'writing', createdTs: now, updatedTs: now,
    };
    this.items.set(id, j);
    this.persist();
    return j;
  }
  get(id: string): WebtoonJob | undefined { return this.items.get(id); }
  list(): WebtoonJob[] { return [...this.items.values()].sort((a, b) => b.createdTs.localeCompare(a.createdTs)); }
  update(id: string, patch: Partial<WebtoonJob>): WebtoonJob | undefined {
    const j = this.items.get(id);
    if (!j) return undefined;
    const next: WebtoonJob = { ...j, ...patch, id: j.id, createdTs: j.createdTs, updatedTs: new Date().toISOString() };
    this.items.set(id, next);
    this.persist();
    return next;
  }
  /** 진행 로그 한 줄 덧붙이기(마지막 30줄만). */
  log(id: string, line: string): void {
    const j = this.items.get(id);
    if (!j) return;
    this.update(id, { log: [...(j.log ?? []), line].slice(-30) });
  }
}

let _store: WebtoonStore | null = null;
export function webtoonStore(): WebtoonStore {
  if (!_store) _store = new WebtoonStore();
  return _store;
}

/** 부팅 때 — 돌던 작업(프로세스가 서버와 함께 죽었다)은 '중단됨'으로 둔다. 다시 시작은 사람이(캐시로 이어서 만든다). */
export function markInterruptedWebtoon(store = webtoonStore()): string[] {
  const out: string[] = [];
  for (const j of store.list()) {
    if (!WEBTOON_ACTIVE.includes(j.stage)) continue;
    store.update(j.id, { stage: 'error', failedStage: j.stage, error: `서버 재시작으로 중단됨(${j.stage}) — 제작실 웹툰 탭에서 '이어서 만들기'를 누르세요` });
    out.push(j.id);
  }
  return out;
}
