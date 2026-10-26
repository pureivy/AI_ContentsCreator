import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyShortsRevision, backupFiles, realignSceneAssets, settleNextEpisode, trimPlanToBudget, pruneQuoteSources, restoreLostHedges, HEDGE_RE, timingFields, pickTitleTypes, TITLE_TYPE_POOL, shortsTitleTypeGuide, descriptionLintIssues, buildSceneImagePrompt, isYoungHero, diversifyTitle, titleShape, normalizeLatinName, parseSceneMust } from './shorts';
import { ShortsStore } from '../content/shorts';

type ShortsPlan = Parameters<typeof applyShortsRevision>[0];

describe('trimPlanToBudget — 결정적 트리밍(생성 실패 금지의 예산 보장, 2026-08-20)', () => {
  const mk = (narrs: string[]): ShortsPlan => ({
    title: '제목', titles: ['제목'], description: '설명', hashtags: ['#a'],
    scenes: narrs.map((n, i) => ({ narration: n, screenText: `t${i}` })),
  });
  it('예산 이내면 무변화(trimmed=false, 전 씬 유지)', () => {
    const p = mk(['훅.', '전제.', '본문.', '마무리.']);
    const r = trimPlanToBudget(p, 999);
    expect(r.trimmed).toBe(false);
    expect(r.keptScenes).toEqual([0, 1, 2, 3]);
  });
  it('1단계: 본문 씬의 마지막 문장부터 깎아 예산을 맞춘다(훅·CTA 문장 보존)', () => {
    const p = mk(['훅 문장입니다.', '전제 문장입니다.', '방법 문장입니다. 이유 문장입니다.', 'CTA 문장입니다.']);
    const before = p.scenes.reduce((s, x) => s + x.narration.length, 0);
    const r = trimPlanToBudget(p, before - 5);
    expect(r.trimmed).toBe(true);
    expect(r.plan.scenes[2]!.narration).toBe('방법 문장입니다.'); // 뒤 문장 제거
    expect(r.plan.scenes[0]!.narration).toBe('훅 문장입니다.');
    expect(r.keptScenes).toEqual([0, 1, 2, 3]); // 씬 수 유지
  });
  it('2단계: 문장으로 모자라면 뒤쪽 본문 씬을 통째 제거 — keptScenes 가 원본 인덱스를 준다', () => {
    const p = mk(['훅번째문장입니다.', '전제번째문장입니다.', '본문하나입니다.', '본문둘입니다.', '본문셋입니다.', 'CTA입니다.']);
    const r = trimPlanToBudget(p, 45); // 전체 ~50자 → 씬 제거 필요
    expect(r.trimmed).toBe(true);
    expect(r.plan.scenes.length).toBeLessThan(6);
    expect(r.keptScenes[0]).toBe(0); // 훅 보존
    expect(r.keptScenes[r.keptScenes.length - 1]).toBe(5); // CTA 보존
    expect(r.plan.scenes.length).toBeGreaterThanOrEqual(4); // 최소 4씬
  });
  it('minScenes 를 주면 그 아래로 씬을 빼지 않는다 — 예산 초과여도 문장만 깎고 씬 수를 지킨다(2026-09-09 항상 5씬)', () => {
    const p = mk(['훅번째문장입니다.', '전제번째문장입니다.', '본문하나입니다.', '본문둘입니다.', 'CTA입니다.']);
    const r = trimPlanToBudget(p, 20, 5);
    expect(r.plan.scenes.length).toBe(5);
    expect(r.keptScenes).toEqual([0, 1, 2, 3, 4]);
  });
  it('최소 구성(4씬·전 씬 1문장)에서는 더 깎지 않고 멈춘다(생성 우선 — 무한루프 없음)', () => {
    const p = mk(['훅.', '전제.', '본문.', 'CTA.']);
    const r = trimPlanToBudget(p, 3);
    expect(r.plan.scenes.length).toBe(4);
  });
});

describe('applyShortsRevision — 수정 요청 개정안 적용(순수)', () => {
  const base: ShortsPlan = {
    title: '원제목', titles: ['원제목', '후보2'], description: '설명', hashtags: ['#a'],
    scenes: [
      { narration: 'n1', screenText: 't1' },
      { narration: 'n2', screenText: 't2' },
    ],
  };
  it('내레이션 교체 → changedScenes, 배경 재생성 아님', () => {
    const r = applyShortsRevision(base, { scenes: [{ index: 1, narration: '새 내레이션' }] });
    expect(r).not.toBeNull();
    expect(r!.changedScenes).toEqual([1]);
    expect(r!.regenScenes).toEqual([]);
    expect(r!.plan.scenes[0]!.narration).toBe('새 내레이션');
    expect(r!.plan.scenes[0]!.screenText).toBe('t1'); // 미지정 보존
  });
  it('regen_image 씬은 regenScenes + image_note 보관', () => {
    const r = applyShortsRevision(base, { scenes: [{ index: 2, regen_image: true, image_note: '화분을 테라코타로' }] });
    expect(r!.regenScenes).toEqual([2]);
    expect(r!.changedScenes).toEqual([2]);
    expect(r!.imageNotes.get(2)).toBe('화분을 테라코타로');
  });
  it('제목 변경은 titleChanged, 유효 변경 없으면 null', () => {
    expect(applyShortsRevision(base, { title: '새 제목' })!.titleChanged).toBe(true);
    expect(applyShortsRevision(base, { title: '원제목' })).toBeNull();
    expect(applyShortsRevision(base, { scenes: [{ index: 5, narration: 'x' }] })).toBeNull();
    expect(applyShortsRevision(base, null)).toBeNull();
  });
  it('titleArt 캘리 문구 변경 — 실변경만 인정, 미지정 필드는 현행 유지', () => {
    const cur = { line1: '묘목 식재 준비', line2: '손끝으로 답 찾기', points: ['활착 가르는 손끝 감각'] };
    const r = applyShortsRevision(base, { titleArt: { line2: '흙덩이가 알려주는 답' } }, cur);
    expect(r!.titleArtCopy).toEqual({ line1: '묘목 식재 준비', line2: '흙덩이가 알려주는 답', points: ['활착 가르는 손끝 감각'] });
    expect(r!.titleChanged).toBe(false); // plan.title 은 무변경
  });
  it('titleArt — 동일 문구·현 카피 부재는 무변경(null)', () => {
    const cur = { line1: '묘목 식재 준비', line2: '손끝으로 답 찾기', points: ['p'] };
    expect(applyShortsRevision(base, { titleArt: { line2: '손끝으로 답 찾기' } }, cur)).toBeNull();
    expect(applyShortsRevision(base, { titleArt: { line2: '새 훅' } })).toBeNull(); // 현 카피 없음 → 무시
    expect(applyShortsRevision(base, { titleArt: { line2: '새 훅' } }, null)).toBeNull();
  });
});

const P = (scenes: Array<Record<string, unknown>>) => ({ title: 't', titles: ['t'], scenes, description: '', hashtags: [] }) as never;
describe('pruneQuoteSources — 원문에 없는 출처 라벨 제거(스펙 §6a)', () => {
  it('원문에 문자열이 있으면 유지, 없으면 source 만 삭제, 원문 없으면 전부 삭제', () => {
    const plan = P([
      { narration: 'a', kind: 'quote', quote: { text: 'q1', source: '농사로' } },
      { narration: 'b', kind: 'quote', quote: { text: 'q2', source: '재배 기록' } },
      { narration: 'c' },
    ]);
    const r = pruneQuoteSources(plan, '농사로 자료에 따르면 …');
    expect(r.pruned).toBe(1);
    expect(r.plan.scenes[0]!.quote).toEqual({ text: 'q1', source: '농사로' });
    expect(r.plan.scenes[1]!.quote).toEqual({ text: 'q2' });
    expect(pruneQuoteSources(plan, undefined).pruned).toBe(2);
  });
});
describe('timingFields — 시기·수치 대조 입력(권고 1)', () => {
  it('내레이션·자막·dataviz 오버레이 값·설명을 전부 필드로 낸다', () => {
    const plan = {
      title: 'T', titles: ['T'], description: '9월 기준 설명', hashtags: ['#a'],
      scenes: [
        { narration: '훅입니다', screenText: '훅' },
        { narration: '수치 씬', kind: 'stat' as const, stat: { value: 8, unit: '월', label: '식재 시작' } },
        { narration: '차트 씬', kind: 'chart' as const, chart: { series: [{ label: '봄', value: 90 }, { label: '가을', value: 70 }], unit: '%' } },
      ],
    } as unknown as ShortsPlan;
    expect(timingFields(plan)).toEqual([
      { field: '씬1 내레이션', text: '훅입니다' },
      { field: '씬1 자막', text: '훅' },
      { field: '씬2 내레이션', text: '수치 씬' },
      { field: '씬2 오버레이', text: '8월 식재 시작' },
      { field: '씬3 내레이션', text: '차트 씬' },
      { field: '씬3 차트', text: '봄 90%, 가을 70%' },
      { field: '설명', text: '9월 기준 설명' },
    ]);
  });

  // 결론 카드(2026-08-28) — 사용자 확정 분업에서 답은 화면에만 있다. 대조에서 빠지면 검증 안 받은
  // 답이 화면으로 나간다(다른 오버레이는 전부 실리는데 이것만 빠져 있었다).
  it('CTA 결론 카드도 대조 대상에 싣는다 — 화면이 답을 단독으로 지기 때문', () => {
    const plan = {
      title: 'T', titles: ['T'], description: '', hashtags: [],
      scenes: [
        { narration: '기준만 말합니다', screenText: '두 기준', kind: 'cta' as const,
          takeaways: [{ when: '무릎~허리', then: '회양목' }, { when: '어깨 상록', then: '사철나무' }] },
      ],
    } as unknown as ShortsPlan;
    expect(timingFields(plan)).toEqual([
      { field: '씬1 내레이션', text: '기준만 말합니다' },
      { field: '씬1 자막', text: '두 기준' },
      { field: '씬1 결론', text: '무릎~허리 → 회양목, 어깨 상록 → 사철나무' },
    ]);
  });

  it('takeaways 가 없는 CTA 는 결론 필드를 만들지 않는다(회귀 0)', () => {
    const plan = {
      title: 'T', titles: ['T'], description: '', hashtags: [],
      scenes: [{ narration: '마무리', kind: 'cta' as const }],
    } as unknown as ShortsPlan;
    expect(timingFields(plan)).toEqual([{ field: '씬1 내레이션', text: '마무리' }]);
  });
});
describe('applyShortsRevision — quote 편집', () => {
  it('kind=quote 씬만 text·source 를 바꾼다', () => {
    const plan = P([{ narration: 'a', kind: 'quote', quote: { text: 'old', source: 's' } }, { narration: 'b' }]);
    const r = applyShortsRevision(plan, { scenes: [{ index: 1, quote: { text: 'new', source: '농사로' } }, { index: 2, quote: { text: 'x' } }] });
    expect(r?.plan.scenes[0]!.quote).toEqual({ text: 'new', source: '농사로' });
    expect(r?.plan.scenes[1]!.quote).toBeUndefined();
    expect(r?.changedScenes).toEqual([1]);
  });
});
describe('restoreLostHedges — 압축이 유보어를 지우면 원문장 유지(스펙 §6b, 결론 반전 실측 2건)', () => {
  it('유보 토큰이 있던 씬이 압축본에서 사라지면 원 내레이션으로 되돌린다', () => {
    const before = P([{ narration: '잎이 대체로 멀쩡하면 거름은 잎이 진 뒤로 미루고 봐요.' }, { narration: '물은 아침에 주세요.' }]);
    const after = P([{ narration: '잎이 멀쩡할 때만 거름을 주세요.' }, { narration: '물은 아침에.' }]);
    const r = restoreLostHedges(before, after);
    expect(r.restored).toEqual([1]);
    expect(r.plan.scenes[0]!.narration).toBe('잎이 대체로 멀쩡하면 거름은 잎이 진 뒤로 미루고 봐요.');
    expect(r.plan.scenes[1]!.narration).toBe('물은 아침에.');
  });
  it('압축본이 유보어를 지켰거나 원문에 유보어가 없으면 그대로', () => {
    const before = P([{ narration: '대개 물 쪽 문제예요.' }]);
    const after = P([{ narration: '대개 물 문제예요.' }]);
    expect(restoreLostHedges(before, after).restored).toEqual([]);
  });
  // 수종명 오탐(2026-08-26 최종 리뷰 F5d) — '미루나무'는 유보어가 아니다. 오탐이면 압축된 씬이
  // 통째로 원문장으로 되돌아가 길이 예산(40초)을 깨뜨린다.
  it("'미루나무'만 든 내레이션은 유보 문장으로 보지 않는다", () => {
    expect(HEDGE_RE.test('미루나무는 물가에서 빨리 자랍니다.')).toBe(false);
    expect(HEDGE_RE.test('전정은 잎이 진 뒤로 미루고 봅니다.')).toBe(true); // 진짜 유보는 유지
    const before = P([{ narration: '미루나무는 물가에서 빨리 자랍니다.' }]);
    const after = P([{ narration: '미루나무는 빨리 자랍니다.' }]);
    expect(restoreLostHedges(before, after).restored).toEqual([]);
  });
});

// ── 2026-08-27 말투 감사 권고 5 — 제목 후보 유형 로테이션(고정 3종 → 5종 풀, 질문형 상한) ────
describe('pickTitleTypes — 런별 제목 유형 선택·질문형 상한', () => {
  /** 결정적 난수 — 같은 값을 되풀이해 선택 경로를 고정한다. */
  const fixed = (v: number) => () => v;

  it('항상 3개를 중복 없이 유형 풀에서 고른다', () => {
    const t = pickTitleTypes([], { rand: fixed(0) });
    expect(t).toHaveLength(3);
    expect(new Set(t).size).toBe(3);
    t.forEach((x) => expect(TITLE_TYPE_POOL as readonly string[]).toContain(x));
  });

  it('최근 3편 중 1편이라도 질문형을 썼으면 이번 런에서 질문형을 뺀다', () => {
    const recent = [['가을에 묘목 심어도 될까요?'], ['묘목 고르는 법'], ['겨울 전정 순서']];
    for (let i = 0; i < 50; i++) expect(pickTitleTypes(recent)).not.toContain('질문형');
  });

  it('최근 3편에 질문형이 없으면 질문형도 후보로 남는다', () => {
    const recent = [['묘목 고르는 법'], ['겨울 전정 순서']];
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) pickTitleTypes(recent).forEach((x) => seen.add(x));
    expect(seen.has('질문형')).toBe(true);
  });

  it('상한 판정 창은 최근 3편까지 — 4편째의 질문형은 세지 않는다', () => {
    const recent = [['묘목 고르는 법'], ['겨울 전정 순서'], ['잎이 노랗게 변한 이유'], ['지금 심어도 될까요?']];
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) pickTitleTypes(recent).forEach((x) => seen.add(x));
    expect(seen.has('질문형')).toBe(true);
  });

  it('키워드가 있는 런은 정보형을 반드시 포함한다(키워드 정확 표기 규칙 유지)', () => {
    for (let i = 0; i < 100; i++) expect(pickTitleTypes([], { keywordFirst: true })).toContain('정보형');
  });
});

// Fix wave(2026-08-27, 소견 3) — 5종 유형 정의 줄은 base(194bed6d) 프롬프트에 없던 줄이다(약 150자).
// VOICE_ROTATION=off 면 제목 유형은 종전 고정 3종으로 돌아가는데 정의 줄만 남아 base 와 달랐다.
describe('shortsTitleTypeGuide — 제목 유형 정의 줄(VOICE_ROTATION)', () => {
  it('off 면 줄 자체가 빠진다(base 프롬프트엔 없던 줄)', () => {
    expect(shortsTitleTypeGuide(['정보형', '후킹형', '질문형'], false)).toBe('');
  });
  it('on 이면 이번 런이 고른 3유형 순서와 5종 정의가 실린다', () => {
    const s = shortsTitleTypeGuide(['정보형', '결론형', '장면형'], true);
    expect(s).toContain('정보형 / 결론형 / 장면형');
    expect(s).toContain('장면형=');
    expect(s).toContain('결론형=');
  });
});

// Fix wave(2026-08-27, 소견 4) — 권고 2 가 새로 만든 검사에 되돌릴 레버가 없었다(다른 넷은 전부 게이트를 가진다).
describe('descriptionLintIssues — 설명 요약투 검사(META_SUMMARY_LINT)', () => {
  const bad = '가을 묘목 심는 법을 정리했습니다.';
  it('on 이면 요약투를 잡아 수정 라운드로 넘긴다(최대 1건)', () => {
    expect(descriptionLintIssues(bad, true)).toHaveLength(1);
  });
  it('off 면 빈 배열 — 검사와 재생성 합류가 함께 멈춘다', () => {
    expect(descriptionLintIssues(bad, false)).toEqual([]);
  });
  it('깨끗한 설명은 어느 쪽이든 통과', () => {
    const ok = '잎이 상한 나무는 9월에 비료를 줘도 소용없습니다. 갈변이 어디서 시작됐는지부터 보세요.';
    expect(descriptionLintIssues(ok, true)).toEqual([]);
  });
});

// 이 파일의 리더들(recentHooksToAvoid·recentShortsTitles)이 기대는 스토어 계약 — 방향이 뒤집히면
// '최근 5편' 주입이 조용히 '가장 오래된 5편'이 된다(2026-08-27 실측 결함, 회귀 방지).
describe('ShortsStore.list() — createdTs 내림차순(최신순) 고정', () => {
  it('최신 항목을 먼저 돌려준다 — 리더는 .reverse() 하면 안 된다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-store-'));
    try {
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify([
        { id: 'old', topic: '옛 편', stage: 'ready', createdTs: '2026-07-13T00:00:00.000Z', updatedTs: '2026-07-13T00:00:00.000Z' },
        { id: 'mid', topic: '중간 편', stage: 'ready', createdTs: '2026-08-01T00:00:00.000Z', updatedTs: '2026-08-01T00:00:00.000Z' },
        { id: 'new', topic: '최신 편', stage: 'ready', createdTs: '2026-08-26T00:00:00.000Z', updatedTs: '2026-08-26T00:00:00.000Z' },
      ]), 'utf-8');
      expect(new ShortsStore(dir).list().map((e) => e.id)).toEqual(['new', 'mid', 'old']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildSceneImagePrompt — 촬영 지시 변주', () => {
  const base = { style: '가을빛 수채화', scene: '수국 앞에서 가위를 든 손', total: 4 };

  it('시드가 없으면 종전 문구 그대로', () => {
    const t = buildSceneImagePrompt({ ...base, index: 1 });
    expect(t).toContain('얕은 심도와 부드러운 조명');
    expect(t).toContain('구도: 세로 9:16 프레임을 피사체로 자연스럽게 채운다.');
  });
  it('시드를 주면 조명·심도·앵글·생활감 지시가 붙는다', () => {
    const t = buildSceneImagePrompt({ ...base, index: 1, seed: 'short_a' });
    expect(t).toContain('빛과 심도(전 씬 동일)');
    expect(t).toContain('생활감:');
    expect(t).toMatch(/구도: 세로 9:16\. .+ 담는다\./);
  });
  it('빛·심도는 한 편 안에서 모든 씬이 같다 — 시리즈 일관성 유지', () => {
    const light = (i: number) => buildSceneImagePrompt({ ...base, index: i, seed: 'short_a' })
      .split('\n').find((l) => l.startsWith('빛과 심도'));
    expect(new Set([0, 1, 2, 3].map(light)).size).toBe(1);
  });
  it('앵글·생활감은 씬마다 갈린다 — 한 편 안에서도 화면이 바뀐다', () => {
    const frame = (i: number) => buildSceneImagePrompt({ ...base, index: i, seed: 'short_a' })
      .split('\n').filter((l) => l.startsWith('구도') || l.startsWith('생활감')).join();
    expect(new Set([0, 1, 2, 3].map(frame)).size).toBeGreaterThan(1);
  });
  it('편이 다르면 빛·심도가 갈린다 — 176편이 같은 조명을 받던 문제', () => {
    const light = (id: string) => buildSceneImagePrompt({ ...base, index: 1, seed: id })
      .split('\n').find((l) => l.startsWith('빛과 심도'));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => light(`short_${i}`)));
    expect(seen.size).toBeGreaterThan(3);
  });
  it('글자 금지·손 왜곡 방어는 시드와 무관하게 항상 붙는다', () => {
    for (const seed of [undefined, 'short_a', 'short_b']) {
      const t = buildSceneImagePrompt({ ...base, index: 0, seed });
      expect(t).toContain('글자·자막·숫자·로고·워터마크');
      expect(t).toContain('손·손가락 왜곡');
      expect(t).toContain('[전 씬 공통 스타일] 가을빛 수채화');
    }
  });
});

describe('diversifyTitle — 대표 제목 구조 수렴 차단', () => {
  const recent = [
    '상토 배양토 차이 몰라도, 포대 수는 이렇게 계산해요',
    '수국 9월 관리, 이번 달엔 이것만 정해요',
    '산수유 열매 적을 때, 지금 확인할 순서',
  ];

  it('실사고 재현 — 후보가 전부 무쉼표인데 대표만 쉼표였던 short_5b5f7f4231', () => {
    const title = '측백나무 생울타리, 몇 그루인지 줄자로 끝냅니다';
    const cands = [
      '측백나무 생울타리 그루 수 계산법',
      '측백나무 그루 수는 폭과 길이로 나옵니다',
      '측백나무 심는데 왜 그루 수부터 세야 할까요',
    ];
    const out = diversifyTitle(title, cands, recent, '측백나무');
    expect(out).not.toBe(title);
    expect(out).not.toContain(',');
    expect(out).toContain('측백나무'); // 키워드 규칙은 지킨다
  });
  it('키워드 없는 후보는 안 고른다 — 검색 노출 자산이 우선', () => {
    const title = '수국 9월 관리, 이것만 정해요';
    const cands = ['가지를 자를지 둘지 먼저 정합니다']; // 키워드 없음
    expect(diversifyTitle(title, cands, recent, '수국')).toBe(title);
  });
  it('최근 것들과 꼴이 다르면 그대로 둔다', () => {
    const title = '측백나무 그루 수는 폭으로 정해집니다'; // plain
    expect(diversifyTitle(title, ['측백나무 계산법, 이렇게'], recent, '측백나무')).toBe(title);
  });
  it('바꿀 후보가 없으면 원본 유지(fail-open)', () => {
    const title = '수국 9월 관리, 이것만 정해요';
    expect(diversifyTitle(title, ['수국 관리, 다른 쉼표 제목'], recent, '수국')).toBe(title);
    expect(diversifyTitle(title, [], recent, '수국')).toBe(title);
  });
  it('최근 표본이 3편 미만이면 개입하지 않는다', () => {
    const title = '수국 9월 관리, 이것만 정해요';
    expect(diversifyTitle(title, ['수국 관리는 이렇게 합니다'], recent.slice(0, 2), '수국')).toBe(title);
  });
  it('최근 과반이 같은 꼴일 때만 개입한다', () => {
    const mixed = ['수국 관리는 이렇습니다', '산수유 열매가 적은 이유', '상토 차이, 뒷면을 보세요'];
    const title = '측백나무 생울타리, 줄자로 끝냅니다'; // comma — mixed 중 1/3 만 comma
    expect(diversifyTitle(title, ['측백나무 그루 수 계산법'], mixed, '측백나무')).toBe(title);
  });
  it('titleShape — 물음표·쉼표·평서를 가른다', () => {
    expect(titleShape('수국 언제 자를까요?')).toBe('question');
    expect(titleShape('수국 9월 관리, 이것만')).toBe('comma');
    expect(titleShape('수국은 9월에 결정됩니다')).toBe('plain');
  });
});

describe('buildSceneImagePrompt — 나무 크기(2026-09-08)', () => {
  const base = { style: '수채', scene: '잎이 진 겨울 골격을 올려다본 전신 구도', index: 4, total: 5, seed: 'short_x' };
  it('사전에 size 가 있으면 그 크기와 성목 최대를 지키라고 못박는다', () => {
    const t = buildSceneImagePrompt({ ...base, subjectLatin: 'Acer palmatum var. dissectum', subjectSize: '성목 2~3m, 최대 4m' });
    expect(t).toContain('[나무 크기 — 성장 단계에 맞게] 이 종의 실제 크기: 성목 2~3m, 최대 4m');
    expect(t).toContain('거목으로 그리지 마라');
  });
  it('size 가 없으면 학명으로 가늠하게 한다', () => {
    const t = buildSceneImagePrompt({ ...base, subjectLatin: 'Ziziphus jujuba' });
    expect(t).toContain('Ziziphus jujuba의 실제 성장 단계별 크기');
  });
  it('수종이 없으면 크기 줄도 없다', () => {
    expect(buildSceneImagePrompt(base)).not.toContain('[나무 크기');
  });
});

describe('buildSceneImagePrompt — 수종 앵커', () => {
  const base = { style: '플랫 디자인', scene: '담장 위 작은 나무들', index: 2, total: 4 };
  const SUBJ = '측백나무 — 비늘 모양 잎의 침엽수, 원뿔형 수형';

  it('subject 를 주면 씬 묘사보다 먼저 종을 못박는다', () => {
    const t = buildSceneImagePrompt({ ...base, subject: SUBJ });
    expect(t).toContain('[대상 식물');
    expect(t).toContain('측백나무');
    expect(t.indexOf('[대상 식물')).toBeLessThan(t.indexOf('장면(씬'));
  });
  it('시드 유무와 무관하게 항상 걸린다 — 수종 정확성은 연출 변주와 별개다', () => {
    for (const seed of [undefined, 'short_a']) {
      expect(buildSceneImagePrompt({ ...base, seed, subject: SUBJ })).toContain('[대상 식물');
    }
  });
  it('subject 가 없으면 앵커 줄이 안 붙는다(종전 동작)', () => {
    expect(buildSceneImagePrompt(base)).not.toContain('[대상 식물');
  });
  it('실사고 재현 — 씬 묘사가 "작은 나무들"뿐이어도 종이 프롬프트에 남는다', () => {
    // short_5b5f7f4231: 4씬 중 1씬만 수종명을 적었고 나머지는 "생울타리"·"작은 나무 아이콘들"
    // 이라 활엽수가 나왔다(측백나무는 침엽수).
    const t = buildSceneImagePrompt({ style: '플랫', scene: '담장 위에 일정 간격으로 배치된 작은 나무 아이콘들', index: 2, total: 4, subject: SUBJ });
    expect(t).toContain('침엽수');
  });
});

describe('normalizeLatinName — 학명만 통과시킨다', () => {
  it('정상 학명', () => {
    expect(normalizeLatinName('Nandina domestica')).toBe('Nandina domestica');
    expect(normalizeLatinName('Platycladus orientalis')).toBe('Platycladus orientalis');
  });
  it('군더더기를 떼어낸다', () => {
    expect(normalizeLatinName('Nandina domestica (남천)')).toBe('Nandina domestica');
    expect(normalizeLatinName('  Cornus officinalis  ')).toBe('Cornus officinalis');
    expect(normalizeLatinName('Hydrangea macrophylla var. serrata')).toBe('Hydrangea macrophylla');
  });
  it('학명이 아니면 버린다 — 틀린 학명은 없느니만 못하다', () => {
    for (const bad of ['남천', '나무', '', 'nandina domestica', 'Nandina', 'N. domestica', '123 456']) {
      expect(normalizeLatinName(bad)).toBe('');
    }
  });
});

describe('buildSceneImagePrompt — 학명 앵커', () => {
  const base = { style: '수채화', scene: '마당의 나무', index: 2, total: 4 };
  it('학명이 있으면 앞에 세운다', () => {
    const t = buildSceneImagePrompt({ ...base, subjectLatin: 'Nandina domestica', subject: '남천 — 깃꼴겹잎' });
    expect(t).toContain('Nandina domestica');
    expect(t).toContain('남천');
    expect(t.indexOf('Nandina')).toBeLessThan(t.indexOf('장면(씬'));
  });
  it('학명만 있어도 앵커가 붙는다', () => {
    expect(buildSceneImagePrompt({ ...base, subjectLatin: 'Nandina domestica' })).toContain('[대상 식물');
  });
  it('둘 다 없으면 앵커 줄이 없다', () => {
    expect(buildSceneImagePrompt(base)).not.toContain('[대상 식물');
  });
  it('잎차례까지 지시한다 — 남천을 손바닥잎으로 그린 실사고 대응', () => {
    expect(buildSceneImagePrompt({ ...base, subjectLatin: 'Nandina domestica' })).toContain('잎차례');
  });
});

describe('buildSceneImagePrompt — 종 레퍼런스·연장 금지(2026-09-06)', () => {
  const base = { style: '자연광', scene: '줄기 구조', index: 1, total: 4, seed: 's1' };
  it('레퍼런스가 붙으면 팔레트가 아니라 실물이라고 못박는다', () => {
    // 실측: 앵커에 "잎맥 세 개"·"지그재그 수형"을 다 적어도 종이 틀렸다. 실물 프레임 한 장이
    // 붙자 맞았다. 참조를 스타일로만 읽히면 그 효과가 사라진다.
    const p = buildSceneImagePrompt({ ...base, subjectLatin: 'Ziziphus jujuba', speciesRef: true });
    expect(p).toContain('이 종의 실물');
    expect(p).toContain('잎맥이 뻗는 방향');
    expect(p).toContain('구도·배치·피사체는 복제하지 말고'); // 전 씬이 같은 그림이 되면 안 된다
  });
  it('레퍼런스가 없으면 그 줄은 안 나온다', () => {
    expect(buildSceneImagePrompt({ ...base, subjectLatin: 'Ziziphus jujuba' })).not.toContain('이 종의 실물');
  });
  it('연장은 언제나 금지 — 전지가위 날·축이 물리적으로 불가능하게 그려졌다', () => {
    const p = buildSceneImagePrompt(base);
    expect(p).toContain('[연장]');
    expect(p).toContain('전지가위');
  });
  it('생활감이 도구를 부르지 않는다 — 연장 금지와 모순되면 안 된다', () => {
    for (let i = 0; i < 12; i++) {
      const p = buildSceneImagePrompt({ ...base, index: i, total: 12, seed: `seed${i}` });
      const line = p.split('\n').find((l) => l.startsWith('생활감:')) ?? '';
      expect(line, line).not.toContain('도구');
    }
  });
  it('화분 소품은 화분 주제에서만 — 노지 편에 나오면 종이 틀어진다', () => {
    for (let i = 0; i < 12; i++) {
      const line = buildSceneImagePrompt({ ...base, index: i, total: 12, seed: `s${i}` })
        .split('\n').find((l) => l.startsWith('생활감:')) ?? '';
      expect(line, line).not.toContain('화분');
    }
    const potted = Array.from({ length: 12 }, (_, i) =>
      buildSceneImagePrompt({ ...base, index: i, total: 12, seed: `s${i}`, potted: true })
        .split('\n').find((l) => l.startsWith('생활감:')) ?? '');
    expect(potted.some((l) => l.includes('화분'))).toBe(true);
  });
});

describe('settleNextEpisode — 영상이 한 약속 = 대장의 약속(2026-10-02)', () => {
  const plan = (cta: string, next?: { topic: string; window?: string }, screenText?: string) => ({
    scenes: [{ narration: '훅' }, { narration: '본문' }, { narration: cta, ...(screenText !== undefined ? { screenText } : {}) }],
    ...(next ? { next } : {}),
  });
  it('대장 만석 + 예고 → 예고 문장·자막 딱지·next 를 덜어낸다', () => {
    const r = settleNextEpisode(plan('가지 뻗기를 다스려야 짧은가지가 늘어요. 다음엔 전정 요령을 짚어볼게요.', { topic: '사과나무 전정 요령', window: '10월' }, '짧은가지 늘리는 법 예고'), false);
    expect(r.plan.scenes[2]!.narration).toBe('가지 뻗기를 다스려야 짧은가지가 늘어요.');
    expect(r.plan.scenes[2]!.screenText).toBe(''); // 예고 표지가 달린 자막은 통째로 비운다(남기면 엉뚱한 라벨)
    expect(r.plan.next).toBeUndefined();
    expect(r.note).toContain('예고 문장 제거');
  });
  it('대장 만석 + 예고뿐인 CTA → 문장은 유지하고 next 만 지운다', () => {
    const r = settleNextEpisode(plan('다음엔 겨울눈 보는 법 짚어볼게요.', { topic: '대추나무 겨울눈' }), false);
    expect(r.plan.scenes[2]!.narration).toBe('다음엔 겨울눈 보는 법 짚어볼게요.');
    expect(r.plan.next).toBeUndefined();
  });
  it('자리 있음 + 예고 + next → 그대로', () => {
    const p = plan('자른 자리는 다음 편에 보여드릴게요.', { topic: '배롱나무 절단면' });
    const r = settleNextEpisode(p, true);
    expect(r.plan).toBe(p);
    expect(r.note).toBeUndefined();
  });
  it('자리 있음 + 예고 없이 next 만 → next 제거(시청자가 듣지 않은 약속)', () => {
    const r = settleNextEpisode(plan('지금 마당 대추나무부터 살펴보세요.', { topic: '대추나무 겨울눈 확인법' }), true);
    expect(r.plan.next).toBeUndefined();
    expect(r.note).toContain('예고 없는 next');
  });
  it('예고도 next 도 없으면 손대지 않는다', () => {
    const p = plan('뿌리 보고 결정하세요.');
    expect(settleNextEpisode(p, false).plan).toBe(p);
    expect(settleNextEpisode(p, true).plan).toBe(p);
  });
});

describe('settleNextEpisode — 실제 문형(2026-10-02 리뷰, 기존 266편)', () => {
  const plan = (cta: string, next?: { topic: string }, screenText?: string) => ({
    scenes: [{ narration: '훅' }, { narration: '본문' }, { narration: cta, ...(screenText !== undefined ? { screenText } : {}) }],
    ...(next ? { next } : {}),
  });
  it.each([
    '화분나무 이야기는 다음에 다뤄볼게요.',
    '이어서 다뤄볼게요.',
    '다음 장은 물 주기 차이예요.',
    '가을엔 흙 배합도 다뤄볼게요.',
    '시월에 다룰게요.',
    '다시 올게요.',
    '다음 영상에서 열매 솎는 법 알려드릴게요.',
  ])('자리 있음 + next 있음 → 예고한 편의 next 를 지우지 않는다: %s', (cta) => {
    const p = plan(cta, { topic: '후속 주제' });
    expect(settleNextEpisode(p, true).plan.next).toEqual({ topic: '후속 주제' });
  });
  it('약한 표지만 있어도(이어집니다) next 를 지키는 쪽으로 판정', () => {
    const p = plan('열매 이야기는 이어집니다.', { topic: '후속' });
    expect(settleNextEpisode(p, true).plan).toBe(p);
  });
  it('자리 있음 + 예고했는데 next 없음 → 예고 문장을 덜어낸다', () => {
    const r = settleNextEpisode(plan('뿌리부터 보세요. 다음엔 묻는 법을 짚어볼게요.'), true);
    expect(r.plan.scenes[2]!.narration).toBe('뿌리부터 보세요.');
    expect(r.note).toContain('next 미선언');
  });
  it('대장 만석 + 자막만 예고("다음엔 겨울눈 이야기") → 자막을 비우고 next 제거', () => {
    const r = settleNextEpisode(plan('지금 가지 끝을 보세요.', { topic: '겨울눈' }, '다음엔 겨울눈 이야기'), false);
    expect(r.plan.scenes[2]!.screenText).toBe('');
    expect(r.plan.next).toBeUndefined();
  });
  it('"다음엔 ~ 보세요"(지시문)는 예고가 아니라 지우지 않는다', () => {
    const p = plan('다음엔 술이 보이는지 보세요.');
    expect(settleNextEpisode(p, false).plan).toBe(p);
  });
});

describe('settleNextEpisode — 예고를 덜어도 CTA 는 행동으로 닫는다(2026-10-05, 실측 short_8a08fe7899)', () => {
  // 산딸 유튜브 편 낭독 직전 대본(세션 316b859a3942 감량본) — 같은 글의 인스타 편이 먼저 예고해 자리 없음(room=false).
  // 종전: 예고 문장만 덜어 "가을엔 개화주보다 열매를 눌러보는 게 정확해요." 한 줄로 끝났다(행동 없음, 4→5 건너뜀).
  const takeaways = [
    { when: '겉만 붉을 때', then: '아직 안 익음' }, { when: '눌러서 물렁할 때', then: '다 익은 상태' }, { when: '가시 있으면', then: '산딸기, 다른 나무' },
  ];
  const real = {
    scenes: [
      { narration: '저 나무, 가을에 꽃 핀다죠.', screenText: '가을에 꽃 핀다?', kind: 'hook' },
      { narration: '산딸나무 가을 개화주는 꽃이 아니라 다음 여름 꽃 볼 키까지 왔다는 뜻이에요.', screenText: '꽃은 여름에 끝났어요' },
      { narration: '가지에 달린 붉은 열매, 겉만 붉으면 아직이고 눌러서 물렁해야 익은 거예요.', screenText: '눌러서 확인하기', kind: 'compare' },
      { narration: '열매만 보면 산딸기와 헷갈리는데, 산딸나무는 가시 없이 외줄기로 칠에서 십이 미터 자라요.', screenText: '가시 있으면 산딸기', kind: 'stat' },
      { narration: '가을엔 개화주보다 열매를 눌러보는 게 정확해요. 다음엔 미국산딸나무 열매와 비교해드릴게요.', screenText: '열매부터 눌러보세요', kind: 'cta', takeaways },
    ],
    next: { topic: '미국산딸나무와 산딸나무 열매 모양 구분', window: '10월' },
  };
  it('예고 문장을 덜고 남은 판정 뒤에 자막의 행동 문장을 붙인다 — 카드·자막·다른 씬은 그대로', () => {
    const r = settleNextEpisode(real, false);
    const cta = r.plan.scenes[4]!;
    expect(cta.narration).toBe('가을엔 개화주보다 열매를 눌러보는 게 정확해요. 열매부터 눌러보세요.');
    expect(cta.narration).not.toContain('다음엔');
    expect(cta.screenText).toBe('열매부터 눌러보세요');
    expect(cta.takeaways).toEqual(takeaways);
    expect(cta.narration.length).toBeLessThanOrEqual(real.scenes[4]!.narration.length);
    expect(r.plan.scenes.slice(0, 4)).toEqual(real.scenes.slice(0, 4));
    expect(r.plan.next).toBeUndefined();
    expect(r.note).toContain('자막 행동 문장');
  });
  it('남은 문장이 이미 "~세요"면 붙이지 않는다', () => {
    const p = { scenes: [{ narration: '훅' }, { narration: '본문' }, { narration: '열매부터 눌러보세요. 다음엔 미국산딸나무와 비교해드릴게요.', screenText: '열매부터 눌러보세요' }] };
    expect(settleNextEpisode(p, false).plan.scenes[2]!.narration).toBe('열매부터 눌러보세요.');
  });
  it('예고뿐인 CTA 는 자막 행동 문장으로 바꾼다 — 자막이 행동 문장이 아니면 종전대로 유지', () => {
    const teaser = '다음엔 겨울눈 보는 법 짚어볼게요.';
    const a = settleNextEpisode({ scenes: [{ narration: '훅' }, { narration: teaser, screenText: '가지 끝부터 보세요' }] }, false);
    expect(a.plan.scenes[1]!.narration).toBe('가지 끝부터 보세요.');
    const b = settleNextEpisode({ scenes: [{ narration: '훅' }, { narration: teaser, screenText: '겨울눈 보는 법' }] }, false);
    expect(b.plan.scenes[1]!.narration).toBe(teaser);
  });
  it('숫자가 든 자막·예고 표지 자막은 낭독에 쓰지 않는다', () => {
    const base = '가을엔 열매가 더 정확해요. 다음엔 미국산딸나무와 비교해드릴게요.';
    expect(settleNextEpisode({ scenes: [{ narration: '훅' }, { narration: base, screenText: '7m 거리 두세요' }] }, false).plan.scenes[1]!.narration).toBe('가을엔 열매가 더 정확해요.');
    expect(settleNextEpisode({ scenes: [{ narration: '훅' }, { narration: base, screenText: '다음엔 꼭 보세요' }] }, false).plan.scenes[1]!.narration).toBe('가을엔 열매가 더 정확해요.');
  });
});

// 2026-10-12 사장님 지시 — 이미지가 블로그 원문 묘사(사선으로 자른 끝·잎 없는 맨가지)를 반영해야 한다.
describe('원문 묘사 — 디렉터 must 정리와 이미지 프롬프트 블록', () => {
  it('parseSceneMust: 문자열만·짧게·상한, 비면 undefined', () => {
    expect(parseSceneMust({ must_show: ['잎 없는 맨가지', '', 3, 'a', 'b', 'c'], must_not: ['칼'] })).toEqual({ show: ['잎 없는 맨가지', '3', 'a', 'b'], not: ['칼'] });
    expect(parseSceneMust({})).toBeUndefined();
    expect(parseSceneMust(null)).toBeUndefined();
  });
  it('buildSceneImagePrompt: must 가 있으면 보여야 함·나오면 안 됨 블록을 싣는다', () => {
    const t = buildSceneImagePrompt({ style: 's', scene: '작업대 위 삽수', index: 1, total: 5, seed: 'x', subject: '모과나무', must: { show: ['아래 끝이 사선으로 잘린 삽수'], not: ['잎 달린 가지'] } });
    expect(t).toContain('[원문 묘사 — 이 장면에 반드시 이렇게 보여야 함] 아래 끝이 사선으로 잘린 삽수');
    expect(t).toContain('[이 장면에 나오면 안 됨 — 원문과 어긋남] 잎 달린 가지');
    expect(buildSceneImagePrompt({ style: 's', scene: 'x', index: 1, total: 5, seed: 'x' })).not.toContain('[원문 묘사');
  });
});

describe('주인공 나무 — 씬 이미지 지시(2026-10-15 사장님 지적)', () => {
  const base = { style: '자연광', scene: '가지를 구부리는 손', index: 2, total: 5, seed: 's', subjectLatin: 'Juglans regia', subject: '호두나무 — 깃꼴겹잎', speciesRef: true };
  const hero = '올봄 심은 1년생 묘목, 키 약 1m, 줄기는 엄지 굵기, 잎이 지는 중';
  it('주인공 씬에는 같은 나무 한 줄을 싣고, 참조 사진은 잎·수피 모양에만 쓰게 한다', () => {
    const p = buildSceneImagePrompt({ ...base, hero });
    expect(p).toContain(`[주인공 나무 — 이 영상의 장면들은 같은 한 그루] ${hero}`);
    expect(p).toMatch(/사진 속 나무의 크기·줄기 굵기·수형은 따르지 마라/);
    expect(p).toMatch(/\[나무 크기\] 위 주인공 나무/);
    expect(p).not.toContain('첫 번째 첨부');
  });
  it('이어 그린 씬은 첫 번째 첨부가 주인공 그림이라고 밝힌다', () => {
    const p = buildSceneImagePrompt({ ...base, hero, heroChained: true });
    expect(p).toContain('[첫 번째 첨부 사진 — 주인공 나무]');
    expect(p).toContain('(두 번째부터)');
  });
  it('주인공이 없으면 종전 문구 그대로', () => {
    const p = buildSceneImagePrompt(base);
    expect(p).not.toContain('주인공');
    expect(p).toContain('[첨부 참조 사진 — 이 종의 실물] 첨부한 사진은 바로 이 종을 찍은 실물이다');
  });
  it('isYoungHero — 묘목·1년생·올봄 심은 나무는 어리다, 성목은 아니다', () => {
    expect(isYoungHero(hero)).toBe(true);
    expect(isYoungHero('2년생 접목묘, 키 1.5m')).toBe(true);
    expect(isYoungHero('심은 지 15년 된 성목, 줄기 지름 30cm')).toBe(false);
    expect(isYoungHero('13년생 성목, 키 6m')).toBe(false);
  });
  it('성목 주인공(가지치기 전후)은 참조 사진을 수형 근거로 그대로 쓴다 — 크기 제한 문구는 어린 나무만', () => {
    const p = buildSceneImagePrompt({ ...base, hero: '심은 지 12년 된 성목 배나무, 키 4m' });
    expect(p).toContain('[주인공 나무');
    expect(p).not.toMatch(/사진 속 나무의 크기·줄기 굵기·수형은 따르지 마라/);
  });
});

describe('재조립 되돌림·씬 자산 다시 맞춤(2026-10-26)', () => {
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-fix-'));
  it('backupFiles — restore 는 바뀐 파일을 되돌리고 새로 생긴 파일은 지운다, drop 은 사본만 지운다', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'plan.json'), '옛 대본');
    fs.writeFileSync(path.join(d, 'final.mp4'), '옛 영상');
    const b = backupFiles(d, ['plan.json', 'final.mp4', 'scene-images.json'], 'revise');
    fs.writeFileSync(path.join(d, 'plan.json'), '새 대본');
    fs.writeFileSync(path.join(d, 'final.mp4'), '반쯤 쓴');
    fs.writeFileSync(path.join(d, 'scene-images.json'), '[]');
    b.restore();
    b.restore(); // 두 번 불러도 무해
    expect(fs.readFileSync(path.join(d, 'plan.json'), 'utf-8')).toBe('옛 대본');
    expect(fs.readFileSync(path.join(d, 'final.mp4'), 'utf-8')).toBe('옛 영상');
    expect(fs.existsSync(path.join(d, 'scene-images.json'))).toBe(false);
    const b2 = backupFiles(d, ['final.mp4'], 'cap');
    fs.writeFileSync(path.join(d, 'final.mp4'), '새 영상');
    b2.drop();
    expect(fs.readFileSync(path.join(d, 'final.mp4'), 'utf-8')).toBe('새 영상');
    expect(fs.readdirSync(d).filter((f) => f.endsWith('.bak'))).toEqual([]);
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('realignSceneAssets — 씬 3이 빠지면 user_04 가 user_03 이 되고, 빠진 씬 클립은 지운다(지도·sources.json 도)', () => {
    const d = tmp();
    const c = path.join(d, 'clips');
    fs.mkdirSync(c, { recursive: true });
    fs.mkdirSync(path.join(d, 'scenes'), { recursive: true });
    for (const f of ['user_01.mp4', 'user_03.mp4', 'user_04.mp4', 'clip_05.mp4', 'spare_01.mp4']) fs.writeFileSync(path.join(c, f), f);
    fs.writeFileSync(path.join(d, 'clips', 'sources.json'), JSON.stringify([{ scene: 1, file: 'a' }, { scene: 3, file: 'b' }, { scene: 4, file: 'c' }]));
    const img = (n: number): string => { const p = path.join(d, 'scenes', `blog-image-0${n}.png`); fs.writeFileSync(p, 'x'); return p; };
    const images = [null, img(2), null, null, img(5)];
    const clips = [path.join(c, 'user_01.mp4'), null, path.join(c, 'user_03.mp4'), path.join(c, 'user_04.mp4'), path.join(c, 'clip_05.mp4')];
    const r = realignSceneAssets(d, [0, 1, 3, 4], images, clips);
    expect(fs.readdirSync(c).sort()).toEqual(['clip_04.mp4', 'sources.json', 'spare_01.mp4', 'user_01.mp4', 'user_03.mp4']);
    expect(fs.readFileSync(path.join(c, 'user_03.mp4'), 'utf-8')).toBe('user_04.mp4'); // 옛 씬4 클립
    expect(fs.readFileSync(path.join(c, 'clip_04.mp4'), 'utf-8')).toBe('clip_05.mp4');
    expect(r.clips).toEqual([path.join(c, 'user_01.mp4'), null, path.join(c, 'user_03.mp4'), path.join(c, 'clip_04.mp4')]);
    expect(r.images).toEqual([null, images[1], null, images[4]]);
    expect(JSON.parse(fs.readFileSync(path.join(d, 'scene-images.json'), 'utf-8'))).toEqual([null, 'scenes/blog-image-02.png', null, 'scenes/blog-image-05.png']);
    expect(JSON.parse(fs.readFileSync(path.join(c, 'sources.json'), 'utf-8'))).toEqual([{ scene: 1, file: 'a' }, { scene: 3, file: 'c' }]);
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('realignSceneAssets — 번호가 안 맞는 클립 경로는 살아있을 때만 돌려주고, 빠진 번호 밖 user_NN 은 지우지 않는다', () => {
    const d = tmp();
    const c = path.join(d, 'clips');
    fs.mkdirSync(c, { recursive: true });
    for (const f of ['user_02.mp4', 'user_09.mp4']) fs.writeFileSync(path.join(c, f), f);
    const gone = path.join(d, 'elsewhere', 'gone.mp4'); // 이미 없는 파일
    const r = realignSceneAssets(d, [0, 2], [null, null, gone], [null, path.join(c, 'user_02.mp4'), gone]);
    expect(r.clips).toEqual([null, null]);
    expect(fs.existsSync(path.join(c, 'user_02.mp4'))).toBe(false); // 빠진 씬 2
    expect(fs.existsSync(path.join(c, 'user_09.mp4'))).toBe(true); // 씬 범위 밖 번호는 그대로
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('realignSceneAssets — 빠진 씬이 없으면 파일을 건드리지 않는다', () => {
    const d = tmp();
    const r = realignSceneAssets(d, [0, 1], ['a', null], [null, 'b']);
    expect(r).toEqual({ images: ['a', null], clips: [null, 'b'] });
    expect(fs.readdirSync(d)).toEqual([]);
    fs.rmSync(d, { recursive: true, force: true });
  });
});
