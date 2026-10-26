import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = vi.hoisted(() => require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'cost-')) as string);
vi.mock('../config', () => ({ CONFIG: { dataDir: tmp, monthlyBudgetUsd: 0 } }));

import { estCostUsd, recordUsage, monthUsage, _resetLedgerForTest } from './cost';

describe('estCostUsd — 캐시 계상(2026-10-26)', () => {
  it('input_tokens 는 이미 캐시 제외분 — 신규 입력을 다시 깎지 않는다', () => {
    // sonnet: in 3 / out 15. 신규 1000 + 캐시 읽기 100000 → 3000 + 30000 = 33000 / 1e6
    expect(estCostUsd('claude-sonnet', 1000, 0, 100_000)).toBeCloseTo(0.033, 6);
  });
  it('캐시 생성은 입력가 ×1.25', () => {
    expect(estCostUsd('claude-sonnet', 0, 0, 0, 10_000)).toBeCloseTo(10_000 * 3 * 1.25 / 1e6, 9);
  });
});

describe('원장 저장', () => {
  const file = path.join(tmp, 'llm_usage.json');
  beforeEach(() => { _resetLedgerForTest(); for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true }); });

  it('원자적 저장 — 임시파일이 남지 않고 캐시 생성 토큰이 쌓인다', () => {
    recordUsage('claude-sonnet', 10, 5, 0, 200);
    expect(fs.readdirSync(tmp)).toEqual(['llm_usage.json']);
    expect(monthUsage().cacheCreationTokens).toBe(200);
  });
  it('깨진 원장은 .corrupt-<ts> 로 치워 두고 새로 시작', () => {
    fs.writeFileSync(file, '{깨진 json', 'utf-8');
    recordUsage('claude-sonnet', 10, 5);
    const names = fs.readdirSync(tmp);
    expect(names.some((n) => n.startsWith('llm_usage.json.corrupt-'))).toBe(true);
    expect(monthUsage().calls).toBe(1);
  });
  it('파일이 없으면(ENOENT) corrupt 파일을 만들지 않는다', () => {
    recordUsage('claude-sonnet', 10, 5);
    expect(fs.readdirSync(tmp).some((n) => n.includes('corrupt'))).toBe(false);
  });
});
