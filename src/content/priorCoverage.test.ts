import { describe, it, expect } from 'vitest';
import { markdownHeadings, styleSignatureOf, recurringPhrases, recentLexemesToAvoid } from './priorCoverage';

describe('markdownHeadings — 소제목 추출(관점 다양성 주입 소스)', () => {
  it('##/### 소제목만 뽑고, 해시태그 줄(# 2개+)은 배제·cap 적용', () => {
    const body = [
      '# 큰제목',
      '본문 문단입니다.',
      '## 두 품종이 필수인 이유',
      '설명...',
      '### 심는 순서',
      '## 하스카프베리 #하스카프베리 #허니베리 #베리키우기', // 태그 나열 줄 — 제외돼야
    ].join('\n');
    const heads = markdownHeadings(body);
    expect(heads).toContain('두 품종이 필수인 이유');
    expect(heads).toContain('심는 순서');
    expect(heads).toContain('큰제목');
    expect(heads.some((h) => h.includes('#하스카프베리'))).toBe(false); // 태그 줄 배제
  });

  it('cap 으로 개수 제한', () => {
    const body = Array.from({ length: 10 }, (_, i) => `## 소제목${i}`).join('\n');
    expect(markdownHeadings(body, 3)).toHaveLength(3);
  });

  it('소제목 없으면 빈 배열', () => {
    expect(markdownHeadings('그냥 평문만 있습니다.\n두 번째 줄.')).toEqual([]);
  });
});

// 교차-글 스타일 다양성(2026-07-23 감사) — 도입 첫 문장·마무리 소제목·소제목 골격 추출.
describe('styleSignatureOf — 스타일 지문 추출(도입·마무리·구성)', () => {
  it('도입 첫 문장·마지막 소제목·소제목 골격을 뽑는다', () => {
    const body = [
      '장마 끝나고 마당이 허전한데, 지금 씨앗을 뿌려도 될지 망설이는 분들이 많습니다. 결론부터 말하면 가능합니다.',
      '',
      '## 7월 고온기에 잘 자라는 꽃',
      '설명...',
      '## 오늘 바로 할 일',
      '정리...',
    ].join('\n');
    const s = styleSignatureOf(body);
    expect(s.opening.startsWith('장마 끝나고')).toBe(true);
    expect(s.opening.includes('결론부터')).toBe(false); // 첫 문장까지만
    expect(s.closing).toBe('오늘 바로 할 일');
    expect(s.headings).toContain('7월 고온기에 잘 자라는 꽃');
  });
  it('빈 본문은 빈 지문', () => {
    const s = styleSignatureOf('');
    expect(s.opening).toBe('');
    expect(s.closing).toBe('');
  });
});

// 어휘 상투구 자동 추출(2026-08-06) — '갈리는 지점' 소제목 3편·카드뉴스 '사진' 헤드라인 3건 실측 대응.
// 하드코딩 예시 목록으로는 새로 생기는 상투구를 못 막아, 코퍼스 문서빈도(df)로 직접 채굴한다.
describe('recurringPhrases — 코퍼스 반복 상투구 채굴', () => {
  it('서로 다른 주제 3편에 반복된 2그램을 잡는다(문서빈도 기준)', () => {
    const docs = [
      '배롱나무·수국·능소화, 성격이 갈리는 지점',
      '부유, 태추, 조완과 마당에서 갈리는 지점',
      '화분과 마당, 8월에 갈리는 지점',
      '전혀 무관한 문서 하나',
    ];
    const out = recurringPhrases(docs, { minDocs: 3 });
    expect(out).toContain('갈리는 지점');
  });

  it('2편뿐이면 minDocs=3 미달 — 잡지 않는다', () => {
    const docs = ['여기서 갈리는 지점', '거기서 갈리는 지점', '무관한 글', '또 무관한 글'];
    expect(recurringPhrases(docs, { minDocs: 3 })).not.toContain('갈리는 지점');
  });

  it('같은 문서 안 반복은 1회로 센다(tf 아님)', () => {
    const docs = [
      '갈리는 지점, 또 갈리는 지점, 다시 갈리는 지점, 계속 갈리는 지점',
      '한 번 더 갈리는 지점',
      '무관한 글', '무관한 글 둘',
    ];
    expect(recurringPhrases(docs, { minDocs: 3 })).not.toContain('갈리는 지점');
  });

  it('exclude 어간이 든 n그램은 제외 — 소재어(도메인 용어)는 상투구가 아니다', () => {
    const docs = ['묘목 고르기 요령', '묘목 고르기 기준', '묘목 고르기 순서'];
    const out = recurringPhrases(docs, { minDocs: 3, exclude: ['묘목'] });
    expect(out.some((p) => p.includes('묘목'))).toBe(false);
  });

  it('exclude 는 양방향 — 어간 "가지치기"가 짧은 토큰 "가지"도 보호한다(나무 브랜드 오차단 방지)', () => {
    const docs = ['가지 정리 먼저', '가지 정리 나중', '가지 정리 항상'];
    const out = recurringPhrases(docs, { minDocs: 3, includeUnigrams: true, exclude: ['가지치기'] });
    expect(out.some((p) => p.includes('가지'))).toBe(false);
  });

  it('단일어 기능어(다른·전에·계속…)는 unigram 채굴에서 제외', () => {
    const docs = ['다른 것과 전에 본 것', '다른 곳과 전에 산 것', '다른 때와 전에 쓴 것'];
    const out = recurringPhrases(docs, { minDocs: 3, includeUnigrams: true });
    expect(out).not.toContain('다른');
    expect(out).not.toContain('전에');
  });

  it('전 토큰이 범용 꼬리말(STOP)로만 된 n그램은 제외', () => {
    const docs = ['관리 방법 하나', '관리 방법 둘', '관리 방법 셋'];
    expect(recurringPhrases(docs, { minDocs: 3 })).not.toContain('관리 방법');
  });

  it('includeUnigrams — 헤드라인류 짧은 문서의 단일어 반복(카드뉴스 "사진")을 잡는다', () => {
    const docs = [
      '심을 자리 오늘 사진 찍기',
      '연생 표기보다 사진 요청',
      '확인법 하나, 하루 세 번 사진',
    ];
    expect(recurringPhrases(docs, { minDocs: 3, includeUnigrams: true })).toContain('사진');
    expect(recurringPhrases(docs, { minDocs: 3 })).not.toContain('사진'); // 기본은 2그램부터
  });

  it('문장부호 경계 너머로는 n그램을 잇지 않는다', () => {
    const docs = ['앞말 끝. 뒷말 시작', '앞말 끝. 뒷말 시작', '앞말 끝. 뒷말 시작'];
    expect(recurringPhrases(docs, { minDocs: 3 })).not.toContain('끝 뒷말');
  });

  it('cap 으로 개수 제한, df 내림차순', () => {
    const docs = [
      '알파 베타 감마 델타', '알파 베타 감마 델타', '알파 베타 감마 델타', '알파 베타',
    ];
    const out = recurringPhrases(docs, { minDocs: 3, cap: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('알파 베타'); // df 4 — 최다
  });
});

describe('recentLexemesToAvoid — 본문 과사용 어간 채굴(자모 접두 그룹, docs 주입 순수 경로)', () => {
  // 15편 감사 실측 재현: '갈린다/갈립니다/갈리는'이 활용형으로 분산돼도 한 어간으로 잡힌다.
  const mk = (n: number, line: string): string[] => Array.from({ length: n }, () => `서두 문장. ${line} 마무리 문장.`);
  it('활용형 분산을 자모 접두로 묶어 잡는다', () => {
    // 85% 상한(기능어 방어)에 안 걸리게 일부 문서엔 미등장 — 실코퍼스 분포(15편 중 8편꼴) 재현.
    const docs = [
      ...mk(3, '여기서 결과가 갈린다'), ...mk(3, '판단이 갈립니다'), ...mk(3, '갈리는 지점이 있다'),
      ...mk(3, '전혀 무관한 내용의 글'),
    ];
    const out = recentLexemesToAvoid(undefined, { docs, titles: [], minDocs: 5 });
    expect(out.join(' ')).toMatch(/갈리|갈린|갈립/); // 대표형 하나로 보고(활용형 힌트 포함 가능)
  });
  it('기능형(합니다·때문 등)과 85%+ 편재어는 제외한다', () => {
    const docs = mk(9, '나무는 물을 좋아합니다 때문에 흙이 마릅니다');
    const out = recentLexemesToAvoid(undefined, { docs, titles: [], minDocs: 5 });
    expect(out.join(' ')).not.toContain('합니다');
    expect(out.join(' ')).not.toContain('때문');
    // '마릅니다'는 9/9 편재(=상한 초과) — 언어가 아니라 지문일 수 있으나 상한이 우선(과차단 방지)
    expect(out.join(' ')).not.toContain('마릅');
  });
  it('소재어(stems)와 제목 토큰은 보호한다', () => {
    const docs = [
      ...mk(5, '배롱나무 가지치기 방법이 갈린다'), ...mk(4, '배롱나무 가지치기 시기가 갈립니다'),
      ...mk(3, '전혀 무관한 내용의 글'),
    ];
    const out = recentLexemesToAvoid(undefined, {
      docs, titles: ['배롱나무 가지치기'], stems: ['배롱나무', '가지치기'], minDocs: 5,
    });
    expect(out.join(' ')).not.toContain('배롱');
    expect(out.join(' ')).not.toContain('가지치기');
    expect(out.join(' ')).toMatch(/갈리|갈린|갈립/);
  });
  it('코퍼스가 작으면(8편 미만) 판단 보류', () => {
    expect(recentLexemesToAvoid(undefined, { docs: mk(5, '결과가 갈린다'), titles: [], minDocs: 3 })).toEqual([]);
  });
});
