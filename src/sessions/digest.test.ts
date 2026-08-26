import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-')); vi.doMock('../config', () => ({ CONFIG: { sessionsDir: tmp } })); });
afterEach(() => { vi.doUnmock('../config'); vi.resetModules(); });

describe('세션 파일 IO — research_brief.md / fact_gate.json', () => {
  it('브리프를 쓰고 읽는다(없으면 빈 문자열)', async () => {
    const { writeResearchBrief, readResearchBrief } = await import('./digest');
    expect(readResearchBrief('r1')).toBe('');
    writeResearchBrief('r1', '## 리서치팀\n브리프');
    expect(readResearchBrief('r1')).toBe('## 리서치팀\n브리프');
    expect(fs.existsSync(path.join(tmp, 'r1', 'research_brief.md'))).toBe(true);
  });
  it('게이트 결과를 JSON 으로 쓰고 읽는다(없으면 null)', async () => {
    const { writeFactGate, readFactGate } = await import('./digest');
    expect(readFactGate('r2')).toBeNull();
    const r = { status: 'hold' as const, claims: [], unsupported: ['5cm'], contradicted: [], repaired: false, checkedTs: 't' };
    writeFactGate('r2', r);
    expect(readFactGate('r2')).toEqual(r);
  });
});
