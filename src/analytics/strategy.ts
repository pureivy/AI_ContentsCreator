/**
 * 콘텐츠 전략(data/analytics/strategy.json) — 실측 성과의 EWMA 누적. 키워드/서브니치 점수를 유지하고,
 * scheduler.proposeContentIdeas 가 [성과 상위 키워드]로 읽어 다음 기획을 조향한다(compounding 루프의 상태).
 * 콜드스타트(측정 piece < N)는 탐색(다양화), 이후 exploit — proposeContentIdeas 프롬프트가 이 신호를 반영.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

export interface KeywordScore { keyword: string; score: number; samples: number; updatedAt: string; }
export interface Strategy {
  winners: KeywordScore[];
  subNiches: Record<string, number>;
  measuredPieces: number;
  updatedAt: string;
}

const EWMA_ALPHA = 0.3;      // 최신 성과 반영률(과거 0.7 유지) — 수주 지연·교란 신호라 급변동 억제.
const COLD_START_N = 12;     // 측정 piece 이 이만큼 쌓이기 전까진 탐색(다양화) 우선.
const MAX_WINNERS = 50;

function strategyFile(): string { return path.join(CONFIG.dataDir, 'analytics', 'strategy.json'); }

export function readStrategy(): Strategy {
  try {
    const s = JSON.parse(fs.readFileSync(strategyFile(), 'utf-8')) as Partial<Strategy>;
    return {
      winners: Array.isArray(s.winners) ? s.winners : [],
      subNiches: (s.subNiches && typeof s.subNiches === 'object') ? s.subNiches : {},
      measuredPieces: typeof s.measuredPieces === 'number' ? s.measuredPieces : 0,
      updatedAt: s.updatedAt ?? '',
    };
  } catch { return { winners: [], subNiches: {}, measuredPieces: 0, updatedAt: '' }; }
}

function writeStrategy(s: Strategy): void {
  try {
    fs.mkdirSync(path.dirname(strategyFile()), { recursive: true });
    const tmp = `${strategyFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8');
    fs.renameSync(tmp, strategyFile()); // 원자적 교체.
  } catch { /* 영속 실패 무해 */ }
}

/**
 * 성과 신호로 EWMA 갱신 — 키워드/서브니치 1차 귀속(작가 등 에이전트 2차·약: reinforce 에서 별도).
 * measuredPieces 증가(incMeasured)는 **piece 당 정확히 1회**만 호출자가 보장(멱등 — reinforce stage 게이트).
 */
export function updateStrategy(input: { keyword?: string; subNiche?: string; signal: number; incMeasured?: boolean }): Strategy {
  const s = readStrategy();
  const now = new Date().toISOString();
  const kw = input.keyword?.trim();
  if (kw) {
    const w = s.winners.find((x) => x.keyword === kw);
    if (w) { w.score = EWMA_ALPHA * input.signal + (1 - EWMA_ALPHA) * w.score; w.samples += 1; w.updatedAt = now; }
    else s.winners.push({ keyword: kw, score: input.signal, samples: 1, updatedAt: now });
    s.winners.sort((a, b) => b.score - a.score);
    if (s.winners.length > MAX_WINNERS) s.winners = s.winners.slice(0, MAX_WINNERS);
  }
  const sn = input.subNiche?.trim();
  if (sn) {
    const prev = s.subNiches[sn];
    s.subNiches[sn] = prev != null ? EWMA_ALPHA * input.signal + (1 - EWMA_ALPHA) * prev : input.signal;
  }
  if (input.incMeasured) s.measuredPieces += 1;
  s.updatedAt = now;
  writeStrategy(s);
  return s;
}

/** 콜드스타트 여부 — 측정 piece 이 임계 미만이면 탐색(다양화) 국면. */
export function isColdStart(): boolean { return readStrategy().measuredPieces < COLD_START_N; }
