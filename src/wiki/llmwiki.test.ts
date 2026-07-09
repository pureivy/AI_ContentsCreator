import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LlmWiki, slugify } from './llmwiki';

const sha1 = (s: string) => createHash('sha1').update(s.trim()).digest('hex');

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

  it('recordDebate — 토론을 1급 노드 + 반박(rebuts) 엣지로 영속화', async () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: '전기요금', type: 'concept', body: '산업용 전기요금 체계.' }); // 산출 개념(relates 대상)
    const created = await w.recordDebate({
      topic: '전기료 지원', runId: 'abcd1234ef',
      critique: { name: '비평가', text: '근거가 약하다.' },
      positions: [
        { name: '기획팀', text: '바우처 도입을 제안한다.' },
        { name: '법무팀', text: '법령 개정이 필요하다.' },
      ],
      relatesTo: ['전기요금'],
    });
    expect(created.length).toBe(3); // 입장 2 + 비평 1
    const critSlug = created.find((s) => s.includes('비평'))!;
    expect(w.getPage(critSlug)?.type).toBe('debate');
    expect(w.getPage(critSlug)?.rebuts.length).toBe(2); // 비평 → 두 입장
    const g = w.graph();
    const rebuts = (g.links as Array<{ kind: string; target: string }>).filter((l) => l.kind === 'rebuts');
    expect(rebuts.length).toBe(2); // 비평 → 두 입장(빨강 반박 엣지 2개)
    // 두 입장 노드가 산출 개념([[전기요금]])으로 relates 연결돼 지식 그래프에 합류
    const relSrc = (g.links as Array<{ kind: string; target: string; source: string }>)
      .filter((l) => l.kind === 'relates' && l.target === '전기요금').map((l) => l.source);
    expect(relSrc).toContain(created[0]); // 기획팀 입장
    expect(relSrc).toContain(created[1]); // 법무팀 입장
  });

  it('recordDebate — rebuts 가 프런트매터 라운드트립으로 보존', async () => {
    await new LlmWiki(dir).recordDebate({
      topic: 'T', runId: 'r1',
      critique: { name: 'C', text: '비평' }, positions: [{ name: 'P', text: '입장' }],
    });
    const crit = new LlmWiki(dir).list('debate').find((p) => p.title.includes('비평'))!; // 디스크 재로드
    expect(crit.rebuts.length).toBe(1);
  });

  it('recordDebate — prune 그룹 무결성·현재 run 보호(dangling rebuts 0)', async () => {
    const w = new LlmWiki(dir);
    let lastRun = '';
    for (let i = 0; i < 35; i++) { // keepRuns(30) 초과로 prune 유발
      lastRun = `run${i}`;
      await w.recordDebate({ topic: `토픽${i}`, runId: lastRun, critique: { name: 'C', text: '비평' }, positions: [{ name: 'P', text: '입장' }] });
    }
    expect(w.list('debate').length).toBeLessThanOrEqual(30 * 2); // 캡 적용 — 무한 증식 X
    const survived = w.list('debate').filter((p) => p.aliases.includes(`run:${lastRun}`));
    expect(survived.length).toBe(2); // 현재(마지막) run 의 입장+비평 보호 — 방금 만든 토론이 안 지워짐
    // 그룹 무결성 — 비평의 rebuts 가 살아있는 입장만 가리킴(dangling 빨강 엣지/유령 stub 0)
    const g = w.graph();
    const real = new Set((g.nodes as Array<{ id: string; category?: string }>).filter((n) => n.category !== 'stub').map((n) => n.id));
    const dangling = (g.links as Array<{ kind: string; target: string }>).filter((l) => l.kind === 'rebuts' && !real.has(l.target));
    expect(dangling.length).toBe(0);
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

// 자료 업로드 내용 중복 판정 — /sources 가 '동일 내용'만 건너뛰도록 원문(raw) 해시를 쓴다.
// 과거엔 페이지 본문(누적·청크) 해시로 비교해 청크/갱신된 문서의 재업로드를 놓쳤다.
describe('referencedRawHashes — 업로드 원문(raw) 기준 내용 중복 판정', () => {
  it('청크 분할 문서도 원문 해시로 재업로드를 잡는다(본문 해시 방식이 깨지는 경우)', () => {
    const w = new LlmWiki(dir);
    const big = Array.from({ length: 300 }, (_, i) => `행 ${i}: 데이터 값 항목 ${i} 내용 텍스트 라인`).join('\n');
    const ref = w.saveRaw('큰문서.txt', big);
    w.addSourceDoc({ title: '큰문서', body: big, sources: [ref] });
    expect(w.list('source').length).toBeGreaterThan(1);             // 실제로 청크 분할됨(본문≠원문)
    expect(w.referencedRawHashes().has(sha1(big))).toBe(true);      // 같은 파일 재업로드 → 건너뜀
  });

  it('같은 제목 다른 내용으로 갱신(append)된 뒤에도 원래 원문 재업로드를 잡는다', () => {
    const w = new LlmWiki(dir);
    const v1 = '버전1 본문 내용', v2 = '버전2 다른 본문 내용';
    w.addSourceDoc({ title: '리포트', body: v1, sources: [w.saveRaw('리포트.txt', v1)] });
    w.addSourceDoc({ title: '리포트', body: v2, sources: [w.saveRaw('리포트.txt', v2)] }); // 같은 slug → 갱신
    const seen = w.referencedRawHashes();
    expect(seen.has(sha1(v1))).toBe(true);   // v1 재업로드 → 건너뜀
    expect(seen.has(sha1(v2))).toBe(true);   // v2 재업로드 → 건너뜀
  });

  it('삭제된 자료의 고아 raw 는 제외 — 삭제 후 같은 파일 재업로드 가능', () => {
    const w = new LlmWiki(dir);
    const body = '삭제 테스트 본문';
    const p = w.addSourceDoc({ title: '지울자료', body, sources: [w.saveRaw('지울자료.txt', body)] });
    expect(w.referencedRawHashes().has(sha1(body))).toBe(true);
    w.deletePage(p.slug);
    expect(w.referencedRawHashes().has(sha1(body))).toBe(false); // 참조 끊김 → 재업로드 허용
  });
});

describe('llmWikiFor — 명시 브랜드 디렉터리 귀속(오귀속 회귀)', () => {
  const tmp = path.join(os.tmpdir(), `llmwiki-brand-attr-test-${process.pid}`);
  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무해 */ }
    delete process.env.GEPA_DATA_DIR;
    vi.resetModules();
  });
  it('활성 브랜드(범용)와 무관하게 명시 브랜드 위키 디렉터리에 기록', async () => {
    fs.mkdirSync(tmp, { recursive: true });
    process.env.GEPA_DATA_DIR = tmp;
    vi.resetModules();
    const w = await import('./llmwiki');
    w.llmWikiFor('브랜드x').upsertPage({
      title: '귀속 테스트', type: 'performance',
      body: '본문', summary: '요약', sources: ['perf:test'], aliases: [],
    });
    expect(fs.existsSync(path.join(tmp, 'wiki-브랜드x'))).toBe(true);   // 명시 브랜드 디렉터리
    expect(fs.existsSync(path.join(tmp, 'wiki'))).toBe(false);          // 활성(범용) 디렉터리로 새지 않음
  });
});
