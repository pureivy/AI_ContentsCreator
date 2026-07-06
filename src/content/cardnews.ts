/**
 * 카드뉴스 레코드 스토어 — pieces.ts 와 동일한 파일 영속 패턴(원자적 교체).
 * 산출물(slide_NN.png·caption.txt·plan.json)은 data/cardnews/<id>/ 에 저장되고,
 * 인덱스(index.json)는 목록·상태 폴링용 메타만 담는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { activeBrandSlug } from './brand';
import { genId } from '../util/ids';

export type CardNewsStage = 'planning' | 'designing' | 'rendering' | 'ready' | 'error';

export interface CardNews {
  id: string;
  /** 브랜드(고객사) 슬러그 — 생성 시점의 활성 브랜드(범용이면 undefined). */
  brand?: string;
  /** 주제(독립 생성) 또는 원본 블로그 제목(파생). */
  topic: string;
  keyword?: string;
  /** 블로그 초안에서 파생된 경우 원본 piece id. */
  sourcePieceId?: string;
  stage: CardNewsStage;
  /** 완성 슬라이드 수(ready 시). */
  slides?: number;
  /** 배경 폴백(그라데이션)으로 렌더된 장 수 — 이미지 생성 실패 진단용. */
  bgFallbacks?: number;
  caption?: string;
  hashtags?: string[];
  /** 담당자 실명(기획·디자인) — UI 표기. */
  planner?: string;
  designer?: string;
  error?: string;
  createdTs: string;
  updatedTs: string;
}

export interface CreateCardNewsInput {
  topic: string;
  keyword?: string;
  sourcePieceId?: string;
  planner?: string;
  designer?: string;
}

export class CardNewsStore {
  private file: string;
  private items = new Map<string, CardNews>();
  constructor(private dir: string = path.join(CONFIG.dataDir, 'cardnews')) {
    this.file = path.join(dir, 'index.json');
    this.load();
  }
  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as CardNews[];
      if (Array.isArray(raw)) for (const c of raw) if (c && c.id) this.items.set(c.id, c);
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
  /** 카드뉴스 산출물 디렉토리(data/cardnews/<id>). */
  dirFor(id: string): string { return path.join(this.dir, id); }
  create(input: CreateCardNewsInput): CardNews {
    const now = new Date().toISOString();
    const c: CardNews = {
      id: genId('card'),
      brand: activeBrandSlug() || undefined, topic: input.topic.trim(),
      keyword: input.keyword?.trim() || undefined,
      sourcePieceId: input.sourcePieceId,
      planner: input.planner, designer: input.designer,
      stage: 'planning', createdTs: now, updatedTs: now,
    };
    this.items.set(c.id, c);
    this.persist();
    return c;
  }
  get(id: string): CardNews | undefined { return this.items.get(id); }
  /** 최신순 정렬 사본. */
  list(): CardNews[] { return [...this.items.values()].sort((a, b) => b.createdTs.localeCompare(a.createdTs)); }
  update(id: string, patch: Partial<CardNews>): CardNews | undefined {
    const c = this.items.get(id);
    if (!c) return undefined;
    const next: CardNews = { ...c, ...patch, id: c.id, createdTs: c.createdTs, updatedTs: new Date().toISOString() };
    this.items.set(id, next);
    this.persist();
    return next;
  }
  /** 카드 제거 — 산출물 파일(slide/caption)은 남긴다(비파괴: 인덱스에서만 제거, pieces 와 동일 원칙). */
  remove(id: string): boolean {
    const existed = this.items.delete(id);
    if (existed) this.persist();
    return existed;
  }
}

let _store: CardNewsStore | null = null;
export function cardNewsStore(): CardNewsStore {
  if (!_store) _store = new CardNewsStore();
  return _store;
}
