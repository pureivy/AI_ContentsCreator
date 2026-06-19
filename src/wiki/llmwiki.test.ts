import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LlmWiki, slugify } from './llmwiki';

let dir: string;
beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lw-')), 'wiki');
});

describe('slugify', () => {
  it('공백·특수문자 정리, 한글 보존', () => {
    expect(slugify('Local LLM!')).toBe('local-llm');
    expect(slugify('제2의 두뇌')).toBe('제2의-두뇌');
  });
});

describe('LlmWiki', () => {
  it('스키마 문서를 초기화한다', () => {
    new LlmWiki(dir);
    expect(fs.existsSync(path.join(dir, 'WIKI_SCHEMA.md'))).toBe(true);
  });

  it('페이지 생성·프런트매터 라운드트립·[[링크]] 파싱', () => {
    const w = new LlmWiki(dir);
    const p = w.upsertPage({ title: 'Ollama', type: 'entity', body: '로컬 추론 서버. [[Local LLM]]을 실행한다.', summary: '로컬 LLM 서버' });
    expect(p.slug).toBe('ollama');
    const re = w.getPage('ollama');
    expect(re?.title).toBe('Ollama');
    expect(re?.type).toBe('entity');
    expect(re?.summary).toBe('로컬 LLM 서버');
    expect(re?.links).toContain('local-llm'); // [[Local LLM]] → slug
  });

  it('같은 제목 재적재 시 갱신 섹션 추가(중복 페이지 X)', () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: '제2의 두뇌', type: 'concept', body: '초안' });
    w.upsertPage({ title: '제2의 두뇌', type: 'concept', body: '추가 정보' });
    expect(w.list().filter((p) => p.slug === '제2의-두뇌')).toHaveLength(1);
    expect(w.getPage('제2의-두뇌')?.body).toContain('## 갱신');
    expect(w.getPage('제2의-두뇌')?.body).toContain('추가 정보');
  });

  it('query — 인덱스 우선 관련 페이지 본문 반환', () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: 'Ollama 튜닝', type: 'concept', body: '컨텍스트 길이를 16384로 설정한다.' });
    w.upsertPage({ title: '무관한 글', type: 'concept', body: '딴 얘기.' });
    const { hits, context } = w.query('ollama 튜닝 컨텍스트');
    expect(hits[0]?.title).toBe('Ollama 튜닝');
    expect(context).toContain('16384');
  });

  it('graph — [[링크]] → 노드/엣지', () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: 'A', type: 'entity', body: '[[B]] 참조' });
    w.upsertPage({ title: 'B', type: 'entity', body: '내용' });
    const g = w.graph();
    expect(g.nodes.length).toBe(2);
    expect(g.links.length).toBe(1); // A→B
  });

  it('lint — 고아·끊긴 링크 탐지', () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: 'A', type: 'entity', body: '[[없는페이지]] 참조' });
    const r = w.lint();
    expect(r.danglingLinks.some((d) => d.to === '없는페이지')).toBe(true);
  });

  it('summary 가 대괄호로 시작/끝나도 배열로 오파싱 안 됨(라운드트립)', () => {
    const w = new LlmWiki(dir);
    const p = w.upsertPage({ title: '대괄호', type: 'concept', body: 'x', summary: '[중요] 요약 [a,b]' });
    expect(w.getPage(p.slug)?.summary).toBe('[중요] 요약 [a,b]');
  });

  it('배열 메타(aliases) 값의 쉼표가 항목을 쪼개지 않음', () => {
    const w = new LlmWiki(dir);
    const p = w.upsertPage({ title: '쉼표', type: 'concept', body: 'x', aliases: ['두뇌, 제2의', 'LLM'] });
    expect(w.getPage(p.slug)?.aliases).toEqual(['두뇌, 제2의', 'LLM']);
  });

  it('getPage — 경로 탈출 거부', () => {
    const w = new LlmWiki(dir);
    expect(w.getPage('../../../etc/passwd')).toBeUndefined();
    expect(w.getPage('a/b')).toBeUndefined();
  });

  it('lint — danglingLinks.to 는 슬러그가 아닌 원제목', () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: 'A', type: 'entity', body: '[[Local LLM]] 참조' });
    expect(w.lint().danglingLinks.some((d) => d.to === 'Local LLM')).toBe(true);
  });

  it('upsertPage — source → entity 승격(강등은 막음)', () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: 'X', type: 'source', body: '원본' });
    w.upsertPage({ title: 'X', type: 'entity', body: '추출' });
    expect(w.getPage('x')?.type).toBe('entity');
    w.upsertPage({ title: 'X', type: 'source', body: '다시 소스' });
    expect(w.getPage('x')?.type).toBe('entity'); // 강등 안 됨
  });

  it('rebuildIndex — index.md 생성', () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: '엔티티1', type: 'entity', body: 'x', summary: '요약1' });
    w.rebuildIndex();
    const idx = fs.readFileSync(path.join(dir, 'index.md'), 'utf-8');
    expect(idx).toContain('[[엔티티1]]');
    expect(idx).toContain('🔑 엔티티');
  });
});
