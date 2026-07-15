import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LlmWiki, slugify } from './llmwiki';

// compileDebateOverview 테스트용 LLM 목킹 — 다른 테스트는 llm 을 호출하지 않아 무해.
vi.mock('../llm/client', () => ({
  llm: { chat: vi.fn(async () => ({ text: '합의: [[장마철 배수]]가 우선 대응이다. 반박·기각: 절대 검색량 단정. 열린 질문: 지역별 편차.' })) },
}));

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

// macOS/iCloud 가 한글 장슬러그 파일명을 NFD ~255바이트에서 잘라 'x 2.md' 중복까지 만든 회귀(2026-07-13).
describe('slugify — 장슬러그 NFD 바이트 캡(+해시)', () => {
  const longTitle = '8월 휴가철·하반기 성수기 대비 경북 숙박·관광·식음료 중소·소상공인의 자금 확보·마케팅 고민 분석 (요약)';
  const nfdBytes = (s: string) => Buffer.byteLength(s.normalize('NFD'), 'utf-8');

  it('NFD 180바이트 초과 시 접두사+해시8로 캡, 결정적', () => {
    const s = slugify(longTitle);
    expect(nfdBytes(`${s}.md`)).toBeLessThanOrEqual(200); // 파일명 전체가 255바이트 한계 안쪽
    expect(s).toMatch(/-[0-9a-f]{8}$/);
    expect(slugify(longTitle)).toBe(s); // 같은 제목 → 같은 슬러그([[링크]] 해석 일치)
  });

  it('긴 공통 접두사를 가진 다른 제목은 다른 슬러그(절단 충돌 방지)', () => {
    const a = slugify(longTitle);
    const b = slugify(longTitle.replace('(요약)', '· 비평 (b0ff1796)'));
    expect(a).not.toBe(b);
  });

  it('짧은 슬러그는 기존 동작 불변', () => {
    expect(slugify('제2의 두뇌')).toBe('제2의-두뇌');
    expect(slugify('Local LLM!')).toBe('local-llm');
  });

  it('장제목 페이지 저장·조회 라운드트립 — 파일명=슬러그', () => {
    const w = new LlmWiki(dir);
    const p = w.upsertPage({ title: longTitle, type: 'concept', body: '본문' });
    expect(fs.existsSync(path.join(dir, `${p.slug}.md`))).toBe(true);
    expect(w.getPage(slugify(longTitle))?.title).toBe(longTitle);
  });

  it('생성자 수선 — 잘린 파일명(basename≠slug) 레거시 파일을 캡 슬러그로 복구', () => {
    new LlmWiki(dir); // 레이아웃 생성
    const fullSlug = '박'.repeat(60); // 캡 도입 전 80자 캡만 통과한 장슬러그(NFD 360바이트)
    const legacy = [
      '---', 'title: 긴 제목', `slug: ${fullSlug}`, 'type: concept',
      'aliases: []', 'sources: []', 'contributors: []',
      'updated: 2026-07-01', 'summary: s', '---', '', '본문', '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, `${'박'.repeat(20)} 2.md`), legacy, 'utf-8'); // iCloud 절단+중복 재현
    const w = new LlmWiki(dir);
    const canonical = slugify(fullSlug); // 캡 적용 결과(슬러그 재정규화와 동일)
    expect(fs.existsSync(path.join(dir, `${'박'.repeat(20)} 2.md`))).toBe(false); // 잔재 제거
    expect(fs.existsSync(path.join(dir, `${canonical}.md`))).toBe(true);
    expect(w.getPage(canonical)?.title).toBe('긴 제목');
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

// 80자 문자 절단 충돌(2026-07-15 실측): 같은 80자 접두의 장제목 입장·비평이 같은 슬러그로 붕괴해
// 서로를 덮어쓰고(본문 소실) 자기반박 루프까지 만들었다 — 절단 시 원문 해시8로 구분한다.
describe('slugify — 80자 절단 충돌 방지(원문 해시8)', () => {
  it('같은 80자 접두의 서로 다른 장제목 → 서로 다른 슬러그(결정적)', () => {
    const prefix = '가'.repeat(40) + ' ' + 'b'.repeat(45); // 정규화 후 86자 > 80
    const a = `${prefix} 리서치SEO팀 입장`;
    const b = `${prefix} 비평`;
    expect(slugify(a)).not.toBe(slugify(b));
    expect(slugify(a)).toBe(slugify(a)); // 결정적
  });
  it('80자 이하 제목은 종전과 동일(해시 없음)', () => {
    expect(slugify('제2의 두뇌')).toBe('제2의-두뇌');
  });
});

describe('rebuildIndex — PageType 전 타입 등재(debate 포함)', () => {
  it('8타입 각 1페이지 → index.md 에 전부 등재·헤더 수 일치', () => {
    const w = new LlmWiki(dir);
    const types = ['entity', 'concept', 'source', 'overview', 'answer', 'lesson', 'debate', 'performance'] as const;
    for (const t of types) w.upsertPage({ title: `${t} 페이지`, type: t, body: `${t} 본문` });
    w.rebuildIndex();
    const idx = fs.readFileSync(path.join(dir, 'index.md'), 'utf-8');
    expect(idx).toContain('페이지 8개');
    for (const t of types) expect(idx).toContain(`[[${t} 페이지]]`);
  });
});

// 슬러그 알고리즘 변천(절단→캡→절단해시)의 1회 수선 — 파일 rename 만 하고 참조(rebuts)를 안 고치면
// 토론 그래프 빨강 엣지가 유령을 가리킨다(2026-07-15 감사: 10/30 끊김).
describe('생성자 1회 수선 — 레거시 슬러그 rename + rebuts 재매핑', () => {
  it('구절단(80자) 슬러그 페이지가 새 슬러그로 개명되고, rebuts 참조도 따라온다', () => {
    fs.mkdirSync(dir, { recursive: true });
    const longTitle = 'a'.repeat(100);
    const legacySlug = 'a'.repeat(80); // 구 알고리즘: slice(0,80), 캡 비적용(ASCII 는 NFD 180B 이내)
    fs.writeFileSync(path.join(dir, `${legacySlug}.md`),
      `---\ntitle: ${longTitle}\nslug: ${legacySlug}\ntype: debate\naliases: []\nsources: []\ncontributors: []\nupdated: 2026-07-10\nsummary: s\n---\n본문\n`, 'utf-8');
    fs.writeFileSync(path.join(dir, '비평.md'),
      `---\ntitle: 비평\nslug: 비평\ntype: debate\naliases: []\nsources: []\ncontributors: []\nrebuts: ["${legacySlug}"]\nupdated: 2026-07-10\nsummary: s\n---\n비평 본문\n`, 'utf-8');
    const w = new LlmWiki(dir);
    const target = slugify(longTitle);
    expect(target).not.toBe(legacySlug);
    expect(fs.existsSync(path.join(dir, `${target}.md`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${legacySlug}.md`))).toBe(false);
    expect(w.getPage('비평')!.rebuts).toEqual([target]);
  });
  it('캡 이전 원 슬러그를 가리키는 rebuts 는 캡 슬러그로 재매핑, 자기반박은 제거', () => {
    fs.mkdirSync(dir, { recursive: true });
    const hangul = '위'.repeat(79); // NFD 180B 초과 → 캡 대상(문자수 80 이하 → 절단 없음)
    const capped = slugify(hangul);
    expect(capped).not.toBe(hangul.toLowerCase());
    fs.writeFileSync(path.join(dir, `${capped}.md`),
      `---\ntitle: ${hangul}\nslug: ${capped}\ntype: debate\naliases: []\nsources: []\ncontributors: []\nupdated: 2026-07-10\nsummary: s\n---\n입장\n`, 'utf-8');
    fs.writeFileSync(path.join(dir, '자기비평.md'),
      `---\ntitle: 자기비평\nslug: 자기비평\ntype: debate\naliases: []\nsources: []\ncontributors: []\nrebuts: ["${hangul.toLowerCase()}", "자기비평"]\nupdated: 2026-07-10\nsummary: s\n---\n비평\n`, 'utf-8');
    const w = new LlmWiki(dir);
    expect(w.getPage('자기비평')!.rebuts).toEqual([capped]); // 원슬러그→캡 재매핑 + 자기참조 제거
  });
});

describe('ensureSchema — 스키마 문서를 엔진 현행판으로 동기화', () => {
  it('낡은 WIKI_SCHEMA.md(pages/ 표기·5타입)는 현행판으로 덮어써진다', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'WIKI_SCHEMA.md'), '# 구버전\n- pages/*.md\n', 'utf-8');
    void new LlmWiki(dir);
    const doc = fs.readFileSync(path.join(dir, 'WIKI_SCHEMA.md'), 'utf-8');
    expect(doc).toContain('debate');
    expect(doc).not.toContain('pages/*.md');
  });
});

// 교훈·성과 페이지가 작성자·태그로만 연결된 '위성 섬'이 되던 문제(2026-07-16 그래프 검토) —
// 생성부가 이 헬퍼로 지식 본체와 [[링크]]를 만든다. always=무조건(스텁=생성 후보 신호), ifExists=실재 시만.
describe('relatedLine — 그래프 연결용 관련 링크 줄', () => {
  it('always 는 무조건, ifExists 는 실재 페이지만, 없으면 빈 문자열', () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: '여름 화분 (요약)', type: 'source', body: 'b' });
    expect(w.relatedLine(['여름화분'], ['여름 화분 (요약)', '없는 페이지']))
      .toBe('\n\n관련: [[여름화분]] · [[여름 화분 (요약)]]');
    expect(w.relatedLine([], ['없는 페이지'])).toBe('');
    expect(w.relatedLine([undefined, '여름화분', '여름화분'], [])).toBe('\n\n관련: [[여름화분]]'); // 빈값·중복 정리
  });
});

// 토론(입장·비평)이 상한 프루닝으로 증발하기 전 '<topic> (종합)' overview 로 응축(2026-07-16 설계).
// 같은 topic 재컴파일은 같은 페이지에 갱신 섹션 누적 = 컴파일 1회 + 지속 갱신(카파시).
describe('compileDebateOverview — 토론→종합 증분 컴파일', () => {
  it('overview 페이지 생성(+요약 링크·LLM 본문 [[링크]]) 및 재컴파일 머지(갱신 누적)', async () => {
    const w = new LlmWiki(dir);
    w.upsertPage({ title: '장마철 관리 (요약)', type: 'source', body: 'b' });
    const slug = await w.compileDebateOverview({
      topic: '장마철 관리', model: 'micro',
      positions: [{ name: '갑', text: '배수 우선 입장' }], critique: { name: '을', text: '검색량 단정 비평' },
    });
    expect(slug).toBe(slugify('장마철 관리 (종합)'));
    const p = w.getPage(slug!)!;
    expect(p.type).toBe('overview');
    expect(p.body).toContain('[[장마철 관리 (요약)]]');
    expect(p.links).toContain(slugify('장마철 배수'));
    const again = await w.compileDebateOverview({ topic: '장마철 관리', model: 'micro', positions: [{ name: '갑', text: '2차 입장' }] });
    expect(again).toBe(slug);
    expect(w.getPage(slug!)!.body).toContain('## 갱신');
    const idx = fs.readFileSync(path.join(dir, 'index.md'), 'utf-8');
    expect(idx).toContain('[[장마철 관리 (종합)]]'); // 인덱스 즉시 반영(🧭 종합 섹션)
  });
  it('입장이 비면 컴파일 생략(null)', async () => {
    const w = new LlmWiki(dir);
    expect(await w.compileDebateOverview({ topic: 't', model: 'm', positions: [] })).toBeNull();
  });
});
