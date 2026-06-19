/**
 * semanticQuery 통합 — ollama.listModels/embed 를 stub 해 결정적으로 검증.
 *  (1) 임베딩 모델 없음 → 휴리스틱 query() 와 동일(회귀 0).
 *  (2) 임베딩 모델 있음 → 코사인 유사도로 재정렬.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LlmWiki } from './llmwiki';
import { ollama } from '../llm/ollama';

let dir: string;
let w: LlmWiki;

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sq-')), 'wiki');
  w = new LlmWiki(dir);
  // 후보가 limit 보다 많도록 12개 — 공통 토큰 '데이터'로 휴리스틱 recall 되게.
  for (let i = 0; i < 12; i++) {
    w.upsertPage({ title: `데이터 페이지 ${i}`, type: 'concept', body: `데이터 분석 항목 ${i} 로컬 속도 위키`, summary: `요약 ${i}` });
  }
});
afterEach(() => vi.restoreAllMocks());

describe('semanticQuery', () => {
  it('임베딩 모델이 없으면 휴리스틱 query() 와 동일(회귀 0)', async () => {
    vi.spyOn(ollama, 'listModels').mockResolvedValue([{ name: 'gemma4:12b', sizeGB: 8 }]);
    const heur = w.query('데이터 분석', 4);
    const sem = await w.semanticQuery('데이터 분석', 4);
    expect(sem.hits.map((p) => p.slug)).toEqual(heur.hits.map((p) => p.slug));
  });

  it('임베딩 모델이 있으면 코사인 유사도로 재정렬한다', async () => {
    vi.spyOn(ollama, 'listModels').mockResolvedValue([{ name: 'bge-m3', sizeGB: 1 }]);
    // 질의와 '데이터 페이지 7' 만 동일 벡터([1,0,0,0]) → 코사인 1위. 나머지는 직교([0,1,0,0]).
    vi.spyOn(ollama, 'embed').mockImplementation(async (_m: string, input: string[]) =>
      input.map((t) => (t.startsWith('질의키') || t.includes('데이터 페이지 7')) ? [1, 0, 0, 0] : [0, 1, 0, 0]),
    );
    const sem = await w.semanticQuery('질의키 데이터 분석', 4);
    expect(sem.hits[0]?.slug).toBe('데이터-페이지-7'); // 코사인 1위
    expect(sem.hits.length).toBeLessThanOrEqual(4);
  });

  it('임베딩 결과를 캐시한다(.embeddings.json 생성)', async () => {
    vi.spyOn(ollama, 'listModels').mockResolvedValue([{ name: 'bge-m3', sizeGB: 1 }]);
    vi.spyOn(ollama, 'embed').mockImplementation(async (_m: string, input: string[]) => input.map(() => [0.1, 0.2, 0.3, 0.4]));
    await w.semanticQuery('데이터 분석', 4);
    expect(fs.existsSync(path.join(dir, '.embeddings.json'))).toBe(true);
  });
});
