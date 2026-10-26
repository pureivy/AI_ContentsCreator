/**
 * Claude 사용량 원장 + 비용 추정 — data/llm_usage.json(월별).
 *
 * 사용자 확인상 Claude 구독은 정액이지만(모델 무관), 리뷰어 권고대로 원장·안전캡은 무비용 보험으로 상시 유지한다.
 * 정액이면 이 수치는 참고용, 혹시 메터드로 밝혀지면 이미 추적·게이팅 준비가 돼 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

interface Price { input: number; output: number } // USD / 1M tokens (2026-06 기준)
const PRICES: Array<{ re: RegExp; price: Price }> = [
  { re: /opus/i, price: { input: 5, output: 25 } },
  { re: /sonnet/i, price: { input: 3, output: 15 } },
  { re: /haiku/i, price: { input: 1, output: 5 } },
  { re: /fable|mythos/i, price: { input: 10, output: 50 } },
];
function priceFor(model: string): Price {
  for (const p of PRICES) if (p.re.test(model)) return p.price;
  return { input: 3, output: 15 };
}

/**
 * 비용 추정(2026-10-26 수정) — Anthropic usage 의 input_tokens 는 캐시 읽기·캐시 생성을 '이미 제외'한 신규 입력이다.
 * 종전엔 inTok 에서 cacheRead 를 또 빼서 신규 입력이 0 으로 눌렸고, cache_creation 은 아예 세지 않았다(원장 과소 계상).
 * 신규 입력 ×1.0 + 캐시 생성 ×1.25 + 캐시 읽기 ×0.1 + 출력.
 */
export function estCostUsd(model: string, inTok: number, outTok: number, cacheReadTok = 0, cacheCreateTok = 0): number {
  const p = priceFor(model);
  const freshIn = Math.max(0, inTok);
  return (freshIn * p.input + cacheCreateTok * p.input * 1.25 + cacheReadTok * p.input * 0.1 + outTok * p.output) / 1_000_000;
}

interface MonthLedger { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens?: number; costUsd: number }
type Ledger = Record<string, MonthLedger>; // key: 'YYYY-MM'

const ledgerFile = (): string => path.join(CONFIG.dataDir, 'llm_usage.json');
let _ledger: Ledger | null = null;

function load(): Ledger {
  if (_ledger) return _ledger;
  try { _ledger = JSON.parse(fs.readFileSync(ledgerFile(), 'utf-8')) as Ledger; }
  catch (e) {
    _ledger = {};
    // 파일이 없는 것(ENOENT)만 정상 시작. 읽기·파싱 실패는 원본을 치워 두어야 첫 기록이 월 누적 전체를 덮어쓰지 않는다.
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      try { fs.renameSync(ledgerFile(), `${ledgerFile()}.corrupt-${Date.now()}`); } catch { /* 보존 실패 무해 */ }
    }
  }
  return _ledger!;
}
/** 테스트용 — 메모리 캐시 비움. */
export function _resetLedgerForTest(): void { _ledger = null; }
function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 호출 usage 를 월별 원장에 누적하고 이번 호출의 추정 비용($)을 반환. */
export function recordUsage(model: string, inTok: number, outTok: number, cacheReadTok = 0, cacheCreateTok = 0): number {
  const cost = estCostUsd(model, inTok, outTok, cacheReadTok, cacheCreateTok);
  const led = load();
  const k = monthKey();
  const m = led[k] ?? (led[k] = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 });
  m.calls++; m.inputTokens += inTok; m.outputTokens += outTok; m.cacheReadTokens += cacheReadTok; m.cacheCreationTokens = (m.cacheCreationTokens ?? 0) + cacheCreateTok; m.costUsd += cost;
  try {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    // 원자적 저장 — 쓰는 도중 크래시로 반쯤 쓴 JSON 이 남으면 다음 부팅 때 원장이 통째로 사라진다.
    const tmp = `${ledgerFile()}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(led, null, 2), 'utf-8');
    fs.renameSync(tmp, ledgerFile());
  } catch { /* 원장 영속 실패는 무해 */ }
  return cost;
}

export function monthSpendUsd(d = new Date()): number { return load()[monthKey(d)]?.costUsd ?? 0; }
export function monthUsage(d = new Date()): MonthLedger {
  return load()[monthKey(d)] ?? { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
}

/** 무감시 자율 폭주 안전장치 — 월 예산 캡 초과 여부(0 이면 캡 없음). */
export function overBudget(): boolean {
  const cap = CONFIG.monthlyBudgetUsd;
  return cap > 0 && monthSpendUsd() >= cap;
}
