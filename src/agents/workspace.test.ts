import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractVerifiedClaims } from './workspace';

describe('extractVerifiedClaims (검증 지식 Self-RAG)', () => {
  it('[근거: 출처] 태그가 붙은 주장만 추출한다', () => {
    const t = '경북 수출이 전년 대비 증가했다 [근거: 통계청 2024]. 이건 추측이라 태그가 없다.';
    const r = extractVerifiedClaims(t);
    expect(r.length).toBe(1);
    expect(r[0]!.source).toBe('통계청 2024');
    expect(r[0]!.claim).toContain('수출');
  });

  it('태그가 없으면 빈 배열', () => {
    expect(extractVerifiedClaims('근거 표시가 전혀 없는 일반 문장이다.')).toEqual([]);
  });

  it('여러 주장 + 전각 콜론(：) 변형을 처리한다', () => {
    const t = '민간 투자가 확대되었다 [근거: 진흥원 보고서]\n고용지표가 개선되었다 [근거：고용노동부]';
    const r = extractVerifiedClaims(t);
    expect(r.length).toBe(2);
    expect(r.map((x) => x.source)).toEqual(['진흥원 보고서', '고용노동부']);
    expect(r[0]!.claim).toContain('투자');
    expect(r[1]!.claim).toContain('고용');
  });

  it('너무 짧은 주장(8자 미만)이나 빈 출처는 버린다', () => {
    expect(extractVerifiedClaims('짧다 [근거: x]')).toEqual([]);
    expect(extractVerifiedClaims('충분히 긴 사실 주장이다 [근거: ]')).toEqual([]);
  });

  it('빈 입력은 빈 배열', () => {
    expect(extractVerifiedClaims('')).toEqual([]);
  });
});

describe('appendMemory — 명시 brand 귀속(오귀속 회귀)', () => {
  const tmp = path.join(os.tmpdir(), `workspace-brand-attr-test-${process.pid}`);
  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무해 */ }
    delete process.env.GEPA_DATA_DIR;
    vi.resetModules();
  });
  it('활성 브랜드(범용)와 무관하게 명시 브랜드 파일에 기록되고, 활성 파일로 새지 않는다', async () => {
    fs.mkdirSync(tmp, { recursive: true });
    process.env.GEPA_DATA_DIR = tmp;
    vi.resetModules();
    const ws = await import('./workspace');
    ws.appendMemory('tester', '명시 귀속 교훈', '브랜드a');
    const brandFile = path.join(tmp, 'agents', 'tester', 'memory-브랜드a.md');
    expect(fs.existsSync(brandFile)).toBe(true);
    expect(fs.readFileSync(brandFile, 'utf-8')).toContain('명시 귀속 교훈');
    // 활성 브랜드(신선한 tmp = 범용)의 memory.md 로 새지 않음 — 오귀속 회귀 가드
    expect(fs.existsSync(path.join(tmp, 'agents', 'tester', 'memory.md'))).toBe(false);
  });
});
