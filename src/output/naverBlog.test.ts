import { describe, it, expect, vi, beforeEach } from 'vitest';
// microJSON 만 가짜로 — scoreSeo 가 같은 모듈의 findTemplateNumbers 를 쓰므로 부분 목이어야 한다.
vi.mock('../orchestrator/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../orchestrator/agent')>()),
  microJSON: vi.fn(),
}));
import { microJSON } from '../orchestrator/agent';
import { stripTrailingTagDump, stripInternalMarkers, packageNaverBlog, titleFormBlock, briefAngleForPackaging, bodySummaryForPackaging, capImageMarkers, countImageMarkers, BLOG_IMAGE_MAX } from './naverBlog';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config';

const mocked = microJSON as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mocked.mockReset());

// 실측(2026-08-10 사용자 지적): 작가 모델이 가끔 본문 끝에 맨 키워드를 나열한다("포도나무수확시기
// 포도수확시기 … 비온디트리" — 태그 접두 없음). 발행 레이어의 #태그 칩과 중복이고 본문 키워드
// 덤프는 스팸 신호가 된다. 종전 정규식은 "태그: #…" 접두 줄만 지워 맨 나열이 통과했다.
describe('stripTrailingTagDump — 본문 끝 태그·키워드 나열 제거(순수)', () => {
  it('"태그: #…" 줄을 제거한다(종전 동작 유지)', () => {
    expect(stripTrailingTagDump('본문입니다.\n\n태그: #사과 #배')).toBe('본문입니다.');
    expect(stripTrailingTagDump('본문입니다.\n\n**태그**: #사과 #배')).toBe('본문입니다.');
  });
  it('맨 키워드 나열(4개 이상 토큰·구두점 없음)을 제거한다', () => {
    const body = '나무가 자리 잡는 과정을 기록하고 있습니다.\n\n포도나무수확시기 포도수확시기 캠벨포도수확시기 화분포도 비온디트리';
    expect(stripTrailingTagDump(body)).toBe('나무가 자리 잡는 과정을 기록하고 있습니다.');
  });
  it('마침표로 끝나는 정상 마무리 문단은 남긴다', () => {
    const body = '첫 문단.\n\n계절마다 어떤 신호를 내는지 계속 기록합니다.';
    expect(stripTrailingTagDump(body)).toBe(body);
  });
  it('구두점이 있는 나열 문장은 남긴다', () => {
    const body = '본문.\n\n사과, 배, 감, 포도를 함께 심었습니다';
    expect(stripTrailingTagDump(body)).toBe(body);
  });
  it('토큰 3개 이하 짧은 줄은 남긴다(과제거 방지)', () => {
    const body = '본문.\n\n감사합니다 여러분 안녕히';
    expect(stripTrailingTagDump(body)).toBe(body);
  });
});

describe('stripInternalMarkers — URL 없는 [근거:]·데이터 없음 표식 제거(스펙 §6c)', () => {
  it('URL 없는 [근거:] 는 지우고, URL 있는 것은 (출처: URL) 로 바꾼다', () => {
    expect(stripInternalMarkers('4월 하순에 깨어납니다 [근거: 농사로].')).toBe('4월 하순에 깨어납니다.');
    expect(stripInternalMarkers('기준입니다 [근거: 확립된 원예학 지식] 그래서')).toBe('기준입니다 그래서');
    expect(stripInternalMarkers('심습니다 [근거: 산림청 https://www.forest.go.kr/x]')).toBe('심습니다 (출처: https://www.forest.go.kr/x)');
  });
  it('"⚠️ 데이터 없음:" 줄과 인라인 표식을 제거한다', () => {
    expect(stripInternalMarkers('앞\n- ⚠️ 데이터 없음: 발아율 (필요 자료: 실측)\n뒤')).toBe('앞\n뒤');
    expect(stripInternalMarkers('발아율은 ⚠️ 데이터 없음: 발아율 (필요 자료: 실측) 수준입니다.')).toBe('발아율은 수준입니다.');
  });
  // 백트래킹 폭발 가드(2026-08-26 최종 리뷰 F5a) — 종전 `(?:⚠️?)?\s*` 는 앞뒤 `\s*` 사이에 선택 그룹이
  // 끼어 "긴 공백 + 매칭 실패"에서 지수 백트래킹을 일으켰다. `(?:⚠️\s*)?` 로 공백을 그룹 안에 넣어 봉합.
  // stripEmoji 는 ⚠(Extended_Pictographic)와 VS16 을 함께 지우므로 맨 ⚠ 만 남는 경우는 없다(실측 확인).
  it('긴 공백 뒤 비매칭 텍스트에서 즉시 반환한다(백트래킹 폭발 없음)', () => {
    const input = `${' '.repeat(3000)}데이터`;
    const t0 = Date.now();
    expect(stripInternalMarkers(input)).toBe(input);
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('괄호 없는 인라인 표식은 문장 경계에서 멈춰 뒤 문장을 보존한다', () => {
    const out = stripInternalMarkers('발아율은 ⚠️ 데이터 없음: 매우 낮은 수준입니다. 다음 문단도 있습니다.');
    expect(out).toContain('다음 문단도 있습니다.');
    expect(out).not.toContain('데이터 없음');
  });
});

// 요약·설명 메타투 재시도(2026-08-27 권고 2) — 검색 스니펫(meta)이 "…를 정리했습니다"로 끝나면
// 프롬프트가 샌 것이다. 같은 콜을 1회만 다시 부르고, 재시도가 깨끗할 때만 meta 를 갈아끼운다:
// 제목 후보·태그는 자기 제약(15~40자·키워드 4/5 포함)이 따로 있어 meta 표적 재생성이 덮으면 안 된다.
describe('packageNaverBlog — meta 요약투 린트 + 1회 재시도(권고 2)', () => {
  const pack = (meta: string, titles: string[]) => ({
    primaryKeyword: '가을 묘목', titles, meta, tags: ['가을묘목', '묘목심기'], images: [{ alt: '뿌리', prompt: '뿌리 사진' }],
  });
  const input = { topic: '가을 묘목 심는 법', body: '뿌리부터 봅니다. 잎은 나중입니다.', model: 'micro' };
  const CLEAN = '잎이 상한 나무는 9월에 비료를 줘도 소용없습니다. 갈변이 어디서 시작됐는지부터 보세요.';

  it('meta 가 깨끗하면 재시도하지 않는다', async () => {
    mocked.mockResolvedValueOnce(pack(CLEAN, ['가을 묘목 고르는 기준 한 가지']));
    const b = await packageNaverBlog(input);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(b.draft.metaDescription).toBe(CLEAN);
  });

  it('요약투면 1회 재시도하고, 깨끗해진 meta 만 갈아끼운다(제목 후보는 1차 유지)', async () => {
    mocked
      .mockResolvedValueOnce(pack('가을 묘목 심는 법을 정리했습니다.', ['1차 제목 후보입니다']))
      .mockResolvedValueOnce(pack(CLEAN, ['재시도 제목 후보입니다']));
    const b = await packageNaverBlog(input);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(b.draft.metaDescription).toBe(CLEAN);
    expect(b.draft.titleCandidates).toEqual(['1차 제목 후보입니다']);
    expect(String(mocked.mock.calls[1]?.[2])).toContain('결론 한 줄 + 조건 한 줄');
  });

  it('재시도 후에도 잔존하면 1차 meta 를 유지하고 로그만 남긴다(콜 2회 초과 금지·발행 차단 없음)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocked
      .mockResolvedValueOnce(pack('가을 묘목 심는 법을 정리했습니다.', ['1차 제목 후보입니다']))
      .mockResolvedValueOnce(pack('묘목 고르는 법을 알아봅니다.', ['재시도 제목 후보입니다']));
    const b = await packageNaverBlog(input);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(b.draft.metaDescription).toBe('가을 묘목 심는 법을 정리했습니다.');
    expect(spy.mock.calls.some((c) => String(c[0]).includes('[메타] 요약투 잔존'))).toBe(true);
    spy.mockRestore();
  });

  it('재시도가 지적을 줄이기만 해도 채택한다(리뷰 2026-10-05 — 종전엔 0건일 때만)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocked
      .mockResolvedValueOnce(pack('가을 식재 창이라 묘목 심는 법을 정리했습니다.', ['1차 제목 후보입니다'])) // 요약투 + 직역 2건
      .mockResolvedValueOnce(pack('묘목 심는 법을 정리했습니다.', ['재시도 제목 후보입니다']));            // 요약투 1건
    const b = await packageNaverBlog(input);
    expect(b.draft.metaDescription).toBe('묘목 심는 법을 정리했습니다.');
    spy.mockRestore();
  });

  it('재시도 콜이 던져도 1차 결과로 계속 간다(fail-open)', async () => {
    mocked
      .mockResolvedValueOnce(pack('핵심만 담았어요.', ['1차 제목 후보입니다']))
      .mockRejectedValueOnce(new Error('boom'));
    const b = await packageNaverBlog(input);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(b.draft.metaDescription).toBe('핵심만 담았어요.');
  });

  // Fix wave(2026-08-27, 소견 4) — 권고 2 가 만든 이 두 번째 콜만 킬스위치가 없었다(계획서 Global
  // Constraints: 모든 새 동작에 킬스위치). off 면 검사 자체를 건너뛰어 콜이 1회로 돌아간다.
  it('META_SUMMARY_LINT=off 면 검사·재시도를 건너뛴다(콜 1회, 1차 meta 유지)', async () => {
    const cfg = CONFIG as unknown as { metaSummaryLint: boolean };
    const orig = cfg.metaSummaryLint;
    cfg.metaSummaryLint = false;
    try {
      mocked.mockResolvedValueOnce(pack('가을 묘목 심는 법을 정리했습니다.', ['1차 제목 후보입니다']));
      const b = await packageNaverBlog(input);
      expect(mocked).toHaveBeenCalledTimes(1);
      expect(b.draft.metaDescription).toBe('가을 묘목 심는 법을 정리했습니다.');
    } finally { cfg.metaSummaryLint = orig; }
  });
});

// 제목 형식 로테이션(2026-10-02) — 40편 실측 제목이 전부 "키워드, 관점 문장" 한 꼴이었다(키워드 맨 앞 40/40·
// 쉼표형 35/40·질문형 0). 시드의 titleForm 이 오면 1순위(=발행 제목)에 그 형식을 걸고, 안 오면 포장 프롬프트가
// 종전과 같아야 한다(킬스위치·구 시드 리비전).
describe('packageNaverBlog — 제목 형식(titleForm)', () => {
  const pack = (titles: string[]) => ({
    primaryKeyword: '배롱나무 가지치기', titles, meta: '잎이 진 뒤에 자릅니다. 굵은 가지는 봄으로 미룹니다.',
    tags: ['배롱나무가지치기', '배롱나무'], images: [{ alt: '가지', prompt: '가지 사진' }],
  });
  const base = { topic: '배롱나무 가지치기', body: '잎이 진 뒤에 자릅니다.', model: 'micro', keyword: '배롱나무 가지치기' };

  it('형식이 없으면 종전 시스템 프롬프트(키워드 앞쪽·클릭 유도·처서 예시)이고 형식 블록이 없다', async () => {
    mocked.mockResolvedValueOnce(pack(['배롱나무 가지치기, 잎이 진 뒤로 미루는 이유']));
    await packageNaverBlog(base);
    const [, sys, user] = mocked.mock.calls[0] as [string, string, string];
    expect(sys).toContain('핵심 키워드를 앞쪽에 자연스럽게, 15~40자, 클릭 유도');
    expect(sys).toContain('처서 전에 끝내야 하는 이유');
    expect(user).not.toContain('[이번 글 제목 형식');
  });

  it('형식이 오면 1순위에 그 형식을 걸고, 고정 키워드를 바른 띄어쓰기 꼴로 못박는다', async () => {
    mocked.mockResolvedValueOnce(pack(['배롱나무 가지치기, 언제 해야 하나요?']));
    await packageNaverBlog({ ...base, titleForm: 'question' });
    const [, sys, user] = mocked.mock.calls[0] as [string, string, string];
    expect(sys).not.toContain('클릭 유도');
    expect(sys).not.toContain('처서 전에 끝내야 하는 이유');
    expect(sys).toContain('[이번 글 제목 형식]을 따른다');
    expect(user).toContain('[이번 글 제목 형식 — titles 첫 번째 후보(발행 제목)에 반드시 적용] 질문형');
    expect(user).toContain('핵심 키워드 "배롱나무 가지치기"를 바른 띄어쓰기의 자연스러운 꼴("배롱나무 가지치기")로');
  });

  // 브리프의 '제목 후보'(키워드 앞부분·클릭 유도)와 SERP 제목이 형식 블록 뒤에 오면 마지막에 읽힌 꼴로 끌려간다.
  it('형식 블록은 브리프·SERP 뒤, 형식 줄 바로 앞에 오고 그 자료보다 우선함을 밝힌다', async () => {
    mocked.mockResolvedValueOnce(pack(['배롱나무 가지치기 시기와 방법']));
    await packageNaverBlog({ ...base, titleForm: 'variant', researchBrief: '제목 후보: 배롱나무 가지치기, 지금 하면 안 되는 이유', serpText: '1. 배롱나무 가지치기 꿀팁' });
    const user = String(mocked.mock.calls[0]?.[2]);
    const at = user.indexOf('[이번 글 제목 형식');
    expect(at).toBeGreaterThan(user.indexOf('[리서치·SEO 브리프]'));
    expect(at).toBeGreaterThan(user.indexOf('[네이버 상위 노출 제목(실측)]'));
    expect(at).toBeLessThan(user.indexOf('형식: {'));
    expect(user).toContain('패턴보다 우선한다');
  });

  it('형식 블록은 형식마다 다르다', () => {
    const forms = ['twist', 'question', 'answer', 'variant', 'compare'] as const;
    expect(new Set(forms.map((f) => titleFormBlock(f, 'X'))).size).toBe(5);
  });

  it('형식 런에서 1순위가 고정 키워드를 잃으면 키워드를 담은 다음 후보를 올린다(seo 키워드 포함 보증)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocked.mockResolvedValueOnce(pack(['언제 잘라야 하나요?', '배롱나무 가지치기, 언제 해야 하나요?', '배롱나무 가지치기 시기와 방법']));
    const b = await packageNaverBlog({ ...base, titleForm: 'question' });
    expect(b.draft.titleCandidates[0]).toBe('배롱나무 가지치기, 언제 해야 하나요?');
    expect(b.draft.titleCandidates).toHaveLength(3);
    expect(b.draft.seo.checklist.find((c) => c.label === '제목에 핵심 키워드 포함')?.ok).toBe(true);
    spy.mockRestore();
  });

  it('형식이 없는 런은 순서를 건드리지 않는다(종전 동작)', async () => {
    mocked.mockResolvedValueOnce(pack(['언제 잘라야 하나요?', '배롱나무 가지치기 시기와 방법']));
    const b = await packageNaverBlog(base);
    expect(b.draft.titleCandidates[0]).toBe('언제 잘라야 하나요?');
  });
});

// 2026-10-05 대추나무 초안 — 제목 "가을 vs 봄 성공률이 다른 이유"·메타 "…마지막 가을 창입니다"가 본문에 없는 주장이었다.
// 포장기는 브리프 앞 1,500자(처리 투명성 로그)와 런 주제("…마지막 식재 시즌")를 봤다. 각도·금칙 발췌와 본문 결론을 넘긴다.
describe('packageNaverBlog — 제목·메타·본문 일관성(2026-10-05)', () => {
  const fx = (n: string): string => fs.readFileSync(fileURLToPath(new URL(`../content/fixtures/${n}`, import.meta.url)), 'utf-8');
  const BRIEF = fx('jujube-trashed-brief.md');
  const BODY = fx('jujube-exemplar-body.md');

  it('briefAngleForPackaging — 휴지통 브리프에서 각도·검색 의도·확정 제목·금칙을 뽑고, 투명성 로그·구성안·밀도 설계는 뺀다', () => {
    const a = briefAngleForPackaging(BRIEF);
    expect(a).toContain('## §6. 차별화 각도 3개');
    expect(a).toContain('## §3. 검색 의도');
    expect(a).toContain('대추나무 심는시기, 11월에 심어도 되는지 세 가지로 확인하세요');
    expect(a).toContain('"마지막"류 마감 선언어 금지');
    expect(a).not.toContain('처리 투명성 로그');
    expect(a).not.toContain('확정 H2(그대로 사용)');
    expect(a).not.toContain('키워드 밀도 설계');
    expect(a).not.toContain('[근거:');
    expect(a.length).toBeLessThanOrEqual(1801);
  });
  it('briefAngleForPackaging — 표준 브리프 꼴("4. 차별화 각도: …") 라벨 줄, 못 찾으면 빈 문자열(앞 N자 폴백 없음)', () => {
    const std = ['1. 핵심 키워드: 감나무 가지치기', '2. 검색 의도: 정보 — 언제 자르는지', '3. 경쟁 현황: 오래된 글', '4. 차별화 각도: 잎 진 뒤 확인법', '5. 제목 방향·태그 후보: 질문형'].join('\n');
    const a = briefAngleForPackaging(std);
    expect(a).toContain('2. 검색 의도: 정보');
    expect(a).toContain('4. 차별화 각도: 잎 진 뒤 확인법');
    expect(a).toContain('5. 제목 방향');
    expect(a).not.toContain('경쟁 현황');
    expect(briefAngleForPackaging('처리 로그만 있는 브리프입니다.')).toBe('');
    expect(briefAngleForPackaging(undefined)).toBe('');
  });
  it('briefAngleForPackaging — 금칙 절 본문까지 싣는다: "## 6. 금칙" 머리글·"6. 금칙:" 라벨 두 꼴(리뷰 2026-10-05)', () => {
    const md = briefAngleForPackaging('# 브리프\n## 4. 차별화 각도\n가을 vs 봄 비교\n## 6. 금칙\n- 근거 없는 "마지막" 마감 선언\n- 성공률 수치 단정\n## 7. 섹션 구성안\n- a');
    expect(md).toContain('## 6. 금칙\n- 근거 없는 "마지막" 마감 선언\n- 성공률 수치 단정');
    expect(md.indexOf('금칙')).toBeLessThan(md.indexOf('차별화 각도')); // 금칙이 맨 앞(상한에 잘려도 남게)
    expect(md).not.toContain('섹션 구성안');
    const std = briefAngleForPackaging('1. 검색 의도: 언제 심나\n4. 차별화 각도: 땅 상태로 판단\n5. 제목 방향·태그 후보\n- 대추나무 심는 시기, 땅부터\n6. 금칙:\n- "마지막" 금지\n- 성공률 금지\n- 품종 등치 단정 금지');
    expect(std).toContain('6. 금칙:\n- "마지막" 금지\n- 성공률 금지\n- 품종 등치 단정 금지');
    expect(std).toContain('5. 제목 방향·태그 후보\n- 대추나무 심는 시기, 땅부터'); // 콜론 없는 번호 라벨
  });
  it('briefAngleForPackaging — 콜론 없는 라벨은 번호 줄만(본문 목록 "- 제목에 …"은 라벨이 아니다)', () => {
    expect(briefAngleForPackaging('- 제목에 키워드 넣기\n본문 문장')).toBe('');
  });
  it('bodySummaryForPackaging — 굵은 요약·도입과 결론 절을 담는다', () => {
    const s = bodySummaryForPackaging(BODY);
    expect(s).toContain('(첫머리)\n**대추나무는 가을에도, 봄에도 심을 수 있어요.**');
    expect(s).toContain('(결론 절)\n## 가을에 심을까, 봄에 심을까');
    expect(s).toContain('싹이 늦을 뿐이니 조급하게 뽑지 마세요.');
    expect(s).not.toContain('[IMAGE:');
  });
  it('포장 프롬프트: 런 주제는 참고로 낮추고, [이 글의 결론]과 브리프 발췌를 싣는다(앞 1,500자 아님)', async () => {
    mocked.mockResolvedValueOnce({ primaryKeyword: '대추나무 심는시기', titles: ['대추나무 심는 시기, 가을과 봄 중 언제가 좋을까요?'], meta: '대추나무는 가을과 봄에 심어요. 땅이 굳었으면 봄에 심으세요.', tags: ['대추나무'], images: [] });
    await packageNaverBlog({ topic: '대추나무, 11월 지금이 마지막 식재 시즌입니다', body: BODY, model: 'm', keyword: '대추나무 심는시기', researchBrief: BRIEF, titleForm: 'question' });
    const user = String(mocked.mock.calls[0]![2]);
    expect(user).toContain('[런 시작 주제 — 참고만. 본문·결론과 다르면 본문을 따른다] 대추나무, 11월 지금이 마지막 식재 시즌입니다');
    expect(user).toContain('[이 글의 결론 — titles·meta 는 이 말과 같은 주장이어야 한다');
    expect(user).toContain('(각도·제목 방향·금칙 발췌 — 금칙은 지켜라)');
    expect(user).not.toContain('처리 투명성 로그');
    expect(user).toContain('형식은 꼴만 정한다');
  });
  it('1순위 제목에 본문에 없는 주장(vs·성공률)이 있으면 근거 있는 키워드 후보로 바꾼다', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocked.mockResolvedValueOnce({ primaryKeyword: '대추나무 심는시기', titles: ['대추나무 심는시기, 가을 vs 봄 성공률이 다른 이유', '삽 한 번이면 알아요', '대추나무 심는 시기, 지금 심어도 될까요?'],
      meta: '대추나무는 가을과 봄에 심어요. 땅이 굳었으면 봄에 심으세요.', tags: ['대추나무'], images: [] });
    const b = await packageNaverBlog({ topic: 't', body: BODY, model: 'm', keyword: '대추나무 심는시기', titleForm: 'compare' });
    expect(b.draft.titleCandidates[0]).toBe('대추나무 심는 시기, 지금 심어도 될까요?');
    expect(spy.mock.calls.some((c) => String(c[0]).includes('본문에 없는 주장(vs·성공률)'))).toBe(true);
    spy.mockRestore();
  });
  it('메타에 본문에 없는 주장("마지막"·"생존율")이 있으면 같은 재시도에 지적을 싣는다', async () => {
    mocked
      .mockResolvedValueOnce({ primaryKeyword: '대추나무 심는시기', titles: ['대추나무 심는 시기, 지금 심어도 될까요?'], meta: '10월 하순부터 11월 초순이 마지막 시기예요. 늦으면 생존율이 높은 봄에 심으세요.', tags: [], images: [] })
      .mockResolvedValueOnce({ meta: '대추나무는 가을엔 10월 하순부터, 봄엔 3월 중순부터 심어요. 땅이 굳었으면 봄에 심으세요.' });
    const b = await packageNaverBlog({ topic: 't', body: BODY, model: 'm', keyword: '대추나무 심는시기' });
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(String(mocked.mock.calls[1]![2])).toContain('본문에 없는 주장 "마지막", "생존율"');
    expect(b.draft.metaDescription).toContain('3월 중순부터');
  });
});

// 2026-10-05 대추나무 리비전 dbb3ea1b6aa6 — draft.md 에 [IMAGE:] 6개, 이미지는 3장(실촬영 1 + 생성 2) → 빈 자리 3곳이 미리보기·발행에 남았다.
describe('capImageMarkers — 마커를 만들어질 이미지 장수로 맞춘다', () => {
  const md = (n: number) => Array.from({ length: n }, (_, i) => `## 절 ${i + 1}\n본문 ${i + 1}.\n\n[IMAGE: 장면 ${i + 1}]\n`).join('\n');
  it('6개 → 3개: 첫 마커(실촬영 자리)는 남기고 나머지는 고르게(첫·끝 포함)', () => {
    const r = capImageMarkers(md(6));
    expect(r).toMatchObject({ kept: 3, removed: 3 });
    expect([...r.body.matchAll(/\[IMAGE: ([^\]]+)\]/g)].map((m) => m[1])).toEqual(['장면 1', '장면 4', '장면 6']);
    expect(r.body).not.toMatch(/\n{3,}/);
    expect(r.body).toContain('본문 5.'); // 본문은 그대로
  });
  it('상한 이하면 그대로, 상한은 BLOG_IMAGE_MAX(3)', () => {
    expect(BLOG_IMAGE_MAX).toBe(3);
    const two = md(2);
    expect(capImageMarkers(two).body).toBe(two);
    expect(countImageMarkers(capImageMarkers(md(5), 2).body)).toBe(2);
    expect(countImageMarkers('본문 [IMAGE: 인라인] 문장')).toBe(0); // 렌더와 같은 판정 — 단독 줄만
  });
  it('실측 리비전 초안(dbb3ea1b6aa6): 6 → 3, 실사진 전용 설명이 빠진다', () => {
    const file = fileURLToPath(new URL('../../data/sessions/dbb3ea1b6aa6/draft.json', import.meta.url));
    if (!fs.existsSync(file)) return; // 세션 정리(janitor)로 지워졌으면 건너뛴다
    const body = String(JSON.parse(fs.readFileSync(file, 'utf-8')).bodyMarkdown ?? '');
    expect(countImageMarkers(body)).toBe(6);
    const r = capImageMarkers(body, BLOG_IMAGE_MAX, ['경북', '경산']);
    expect(countImageMarkers(r.body)).toBe(3);
    expect(r.body).not.toMatch(/\[IMAGE:[^\]]*(?:촬영|캡션|경산|2026)/);
  });
  it('포장: 본문 마커를 맞추고, 슬롯은 마커 수까지만(고아 이미지 방지)', async () => {
    mocked.mockResolvedValueOnce({ primaryKeyword: 'k', titles: ['가을 묘목 고르는 기준 한 가지'], meta: '잎이 상한 나무는 9월에 비료를 줘도 소용없습니다.', tags: [],
      images: [{ alt: 'a', prompt: 'p' }, { alt: 'b', prompt: 'q' }, { alt: 'c', prompt: 'r' }] });
    const b = await packageNaverBlog({ topic: 't', body: `${md(2)}\n[IMAGE: 2026-10 촬영 사진]\n${md(3)}`.replace(/\[IMAGE: 2026-10 촬영 사진\]/, ''), model: 'm' });
    expect(countImageMarkers(b.draft.bodyMarkdown)).toBe(3);
    const b2 = await packageNaverBlog({ topic: 't', body: md(2), model: 'm' });
    expect(b2.draft.imageSlots.length).toBeLessThanOrEqual(2);
  });
});
