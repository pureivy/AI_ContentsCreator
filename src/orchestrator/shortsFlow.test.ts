/**
 * 숏폼 대본 흐름 보존(2026-10-05) — 11편 분석에서 건너뜀이 첫 원고 14% → 최종 39% 로 늘어난 경로별 수선의 순수 조각.
 * 실데이터 사례(호두·산딸·모과)는 data/sessions/<id>/events.jsonl 의 단계별 원고에서 옮겼다.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  fitSceneCount, sceneCharBudgets, sceneBudgetAt, trimPlanToBudget, protectedSentences, HEDGE_RE, restoreLostHedges,
  mergePartialFix, partialFixVerdict, structuralProblems, problemsTargetHook, footageContradictsTopic, FOOTAGE_DEICTIC_RE, hookContradictsFootage, hookFootageIssues, stableProblemScenes, isNearLiteral, literalFixPrompt,
  keywordEarlyIssues, partialFixPrompt, flowCheckPrompt, flowFixScenes, flowBreaks, scriptForEdit, assertiveHookRule, SIBLING_ANGLE_RULE,
  lostCards, chooseFixedPlan, traceStart, traceRecord, traceMarkParity, traceNeedsParity, finalParityRevert, finalFactGate, writeSiblingPreview, siblingPlanFile, mergeNarrationOnly,
} from './shorts';
import { platformPlanGuide, SIBLING_PREVIEW_FILE } from '../content/shortsPlatform';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type P = Parameters<typeof trimPlanToBudget>[0];
const mk = (scenes: P['scenes']): P => ({ title: 't', titles: ['t'], description: '설명', hashtags: ['#a'], scenes });
const total = (p: P): number => p.scenes.reduce((s, x) => s + x.narration.length, 0);
const B212 = sceneCharBudgets(212, 5);

describe('fitSceneCount — 넘친 씬은 앞 n-1 + 마지막(CTA)', () => {
  it('7씬 → 5씬이면 CTA(마지막)를 남긴다 — 호두 인스타 수정본 실측(종전 앞 5개 → CTA 소실)', () => {
    const s = ['훅', '전제', '본1', '본2', '본3', '본4', 'CTA'];
    expect(fitSceneCount(s, 5)).toEqual(['훅', '전제', '본1', '본2', 'CTA']);
  });
  it('n 이하면 그대로(지어내지 않는다)', () => {
    expect(fitSceneCount(['a', 'b', 'c'], 5)).toEqual(['a', 'b', 'c']);
    expect(fitSceneCount(['a', 'b', 'c', 'd', 'e'], 5)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('sceneCharBudgets — 작가 지시가 실제 예산에서 나온다', () => {
  it('35초·속도 1.2(212자)·5씬 → 훅 20 · 씬2 50 · 본문 45 · CTA 34, 합이 예산 안', () => {
    expect(B212).toMatchObject({ hook: 20, premise: 50, body: 45, cta: 34, total: 212 });
    const sum = B212.hook + B212.premise + 2 * B212.body + B212.cta;
    expect(sum).toBeLessThanOrEqual(212);
    expect(sum).toBeGreaterThan(180); // 너무 박하지 않게 — 예산의 92% 목표
  });
  it('예산이 크면 씬 상한(본문 70·CTA 45)에서 멈춘다', () => {
    const b = sceneCharBudgets(324, 5);
    expect(b.body).toBeLessThanOrEqual(70);
    expect(b.cta).toBeLessThanOrEqual(45);
  });
  it('sceneBudgetAt — 자리별로 읽는다', () => {
    expect([0, 1, 2, 3, 4].map((i) => sceneBudgetAt(B212, i, 5))).toEqual([20, 50, 45, 45, 34]);
  });
});

describe('trimPlanToBudget — 판정 문장은 맨 나중에(2026-10-05)', () => {
  // 호두 유튜브(short_7b28d47042) 감량 뒤 수정본 V3 — 224자, 예산 212. 종전 트리밍은 씬4 판정
  // "그 아래서만 났다면 품종은 못 살린 거예요." 를 지웠다(최종본 씬4 가 확인법만 남고 답이 사라짐).
  const hodoYt = mk([
    { narration: '잎이 가득해야 할 자리, 올해 비었죠.' },
    { narration: '호두나무 잎이 안 나면, 시월 가지 속 색으로 산 가지와 죽은 가지를 가려요.' },
    { narration: '가지를 긁어보면 속이 초록인지 말랐는지 보여요. 그 색이 결론의 첫 단서예요.' },
    { narration: '가지 속이 다 말랐다면, 묘목 접붙인 자리 아래서만 싹이 났는지도 확인하세요. 그 아래서만 났다면 품종은 못 살린 거예요.' },
    { narration: '속이 멀쩡하면 배수와 지주만 손보고 기다리세요. 말랐으면 서리 전 자리를 옮겨 심으세요.', kind: 'cta' },
  ]);
  it('실데이터 재현 — 판정 문장을 지키고 비보호 문장("그 색이 결론의 첫 단서예요.")을 뺀다', () => {
    expect(total(hodoYt)).toBe(224);
    const r = trimPlanToBudget(hodoYt, 212, 5);
    expect(total(r.plan)).toBeLessThanOrEqual(212);
    expect(r.plan.scenes[3]!.narration).toContain('그 아래서만 났다면 품종은 못 살린 거예요.');
    expect(r.plan.scenes[2]!.narration).toBe('가지를 긁어보면 속이 초록인지 말랐는지 보여요.');
    expect(r.keptScenes).toEqual([0, 1, 2, 3, 4]);
  });
  it('protectedSentences — 첫 문장·판정·다음 문장이 되받는 문장', () => {
    expect(protectedSentences(['방법이에요.', '덧붙인 말이에요.'])).toEqual([true, false]);
    expect(protectedSentences(['방법이에요.', '그늘이면 꽃이 적어요.'])).toEqual([true, true]); // 판정
    expect(protectedSentences(['방법이에요.', '옹이가 보여요.', '그래서 옹이부터 봐요.'])).toEqual([true, true, false]); // 되받힘
  });
  it('본문 전부가 보호 문장이면 종전대로 긴 본문 씬의 마지막 문장을 뺀다(예산 보장 우선)', () => {
    const p = mk([
      { narration: '훅이에요.' }, { narration: '전제예요. 덧붙임이에요.' },
      { narration: '젖었으면 미뤄요. 말랐으면 주세요.' }, { narration: 'CTA예요.' },
    ]);
    const r = trimPlanToBudget(p, total(p) - 3, 4);
    expect(r.plan.scenes[2]!.narration).toBe('젖었으면 미뤄요.');
    expect(r.plan.scenes[1]!.narration).toBe('전제예요. 덧붙임이에요.'); // 씬2 는 본문 다음
  });
});

describe('HEDGE_RE — 맨 "수 있"은 유보, 알아보는 능력 동사만 예외(2026-10-05 리뷰)', () => {
  it('가능성 유보는 전부 보호 — 리뷰가 짚은 다섯 꼴(좁힘이 놓쳤던 것)', () => {
    for (const t of ['뿌리가 썩을 수 있어요.', '내년엔 꽃이 안 필 수 있어요.', '냉해를 입을 수 있어요.', '가지가 부러질 수 있어요.', '진딧물이 올 수 있어요.']) {
      expect(HEDGE_RE.test(t)).toBe(true);
    }
    // 예외 목록 밖 동사는 유보로 본다 — "옮겨 심을 수 있어요"→"옮겨 심어요"는 허용→지시로 결론이 바뀐다(종전 좁힘 테스트는 false 였다).
    expect(HEDGE_RE.test('지금 옮겨 심을 수 있어요.')).toBe(true);
  });
  it('알아보는 능력 동사는 유보가 아니다(가려낼·구별할·구분할·알아볼·확인할·고를·찾을·볼·알)', () => {
    for (const t of ['산 쪽과 죽은 쪽을 가려낼 수 있어요.', '잎 모양으로 구별할 수 있어요.', '껍질로 구분할 수 있어요.', '색으로 알아볼 수 있어요.',
      '긁어서 확인할 수 있어요.', '좋은 묘목을 고를 수 있어요.', '접목 턱을 찾을 수 있어요.', '속을 볼 수 있어요.', '색으로 알 수 있어요.']) {
      expect(HEDGE_RE.test(t)).toBe(false);
    }
  });
  it('restoreLostHedges — "썩을 수 있어요"→"썩어요" 단정은 되돌린다', () => {
    const before = mk([{ narration: '훅.' }, { narration: '물이 고이면 뿌리가 썩을 수 있어요.' }]);
    const after = mk([{ narration: '훅.' }, { narration: '물이 고이면 뿌리가 썩어요.' }]);
    expect(restoreLostHedges(before, after).restored).toEqual([2]);
  });
  it('가능성 꼴(종전 테스트 유지)', () => {
    expect(HEDGE_RE.test('뿌리 문제일 수 있어요.')).toBe(true);
    expect(HEDGE_RE.test('그늘이면 꽃이 적을 수도 있어요.')).toBe(true);
    expect(HEDGE_RE.test('곰팡이가 생길 수 있어요.')).toBe(true);
    expect(HEDGE_RE.test('대개 봄에 피어요.')).toBe(true);
  });
  it('실데이터 재현(호두 인스타 씬2) — "가려낼 수 있어요"→"가려내요" 수정은 되돌리지 않는다', () => {
    const before = mk([{ narration: '훅.' }, { narration: '잎이 안 나는 호두나무를 보면 이 모습이 떠올라요. 10월엔 가지 색으로 산 쪽과 죽은 쪽을 가려낼 수 있어요.' }]);
    const after = mk([{ narration: '훅.' }, { narration: '잎이 안 나는 호두나무를 보면 이 모습이 떠올라요. 가지 색으로 산 쪽과 죽은 쪽을 가려내요.' }]);
    expect(restoreLostHedges(before, after).restored).toEqual([]);
  });
});

describe('mergePartialFix — 문제 씬만 바꾼다', () => {
  const base = mk([
    { narration: '싹났다고 다 살아난 게 아니에요.', kind: 'hook', screenText: '싹=생존 아님' },
    { narration: '작년에 호두 묘목 심은 분, 밑동에 접목 턱 있죠.', screenText: '접목 턱 위 vs 아래' },
    { narration: '턱 위에서 싹났으면 사려던 호두 그대로예요.', kind: 'list', items: ['턱 위 싹', '턱 아래 싹'] },
    { narration: '흙 더 덮어놨으면 턱이 묻혀있을 수 있어요.', screenText: '턱 묻혔나 확인' },
    { narration: '턱 위 싹이면 그냥 키우세요.', kind: 'cta', takeaways: [{ when: '턱 위 싹', then: '그냥 키우기' }] },
  ]);
  const opts = { hookEditable: false, budgets: B212 };
  it('지목한 씬만 바뀌고 나머지는 바이트 동일', () => {
    const r = mergePartialFix(base, { scenes: [{ index: 4, narration: '흙을 더 덮었다면 접목 턱이 묻혔을 수 있어요.', screenText: '턱 묻혔나 확인' }] }, opts);
    expect(r.changed).toEqual([4]);
    expect(r.plan.scenes[3]!.narration).toBe('흙을 더 덮었다면 접목 턱이 묻혔을 수 있어요.');
    for (const i of [0, 1, 2, 4]) expect(r.plan.scenes[i]).toEqual(base.scenes[i]);
    expect(r.plan.scenes.length).toBe(5);
  });
  it('훅은 문제가 지목했을 때만 — 아니면 거절', () => {
    const c = { scenes: [{ index: 1, narration: '접목 턱 위아래만 보세요.' }] };
    expect(mergePartialFix(base, c, opts).changed).toEqual([]);
    expect(mergePartialFix(base, c, { ...opts, hookEditable: true }).changed).toEqual([1]);
  });
  it('훅 화면 어긋남 편은 화면 지목 훅을 거절한다', () => {
    const c = { scenes: [{ index: 1, narration: '이 나무, 잎이 가득하죠.' }] };
    const r = mergePartialFix(base, c, { ...opts, hookEditable: true, hookReject: FOOTAGE_DEICTIC_RE });
    expect(r.changed).toEqual([]);
    expect(r.rejected[0]).toContain('화면 지목');
  });
  it('길이 — 1.2배+4자와 씬 예산 중 큰 값을 넘으면 거절', () => {
    const long = '가'.repeat(60);
    const r = mergePartialFix(base, { scenes: [{ index: 4, narration: long }] }, opts);
    expect(r.changed).toEqual([]);
    expect(r.rejected[0]).toMatch(/상한/);
  });
  it('키워드 대상 이름을 지운 수정은 거절', () => {
    const r = mergePartialFix(base, { scenes: [{ index: 2, narration: '작년에 묘목 심은 분, 밑동에 접목 턱 있죠.' }] }, { ...opts, keyword: '호두 묘목' });
    expect(r.changed).toEqual([]);
  });
  it('내레이션이 바뀌었는데 결론 카드를 안 주면 옛 카드를 지운다(3f2bdde) — 주면 바꾼다', () => {
    const dropped = mergePartialFix(base, { scenes: [{ index: 5, narration: '턱 아래뿐이면 품종이 바뀐 거예요.' }] }, opts);
    expect(dropped.plan.scenes[4]!.takeaways).toBeUndefined();
    expect(dropped.droppedCards).toEqual([5]);
    const kept = mergePartialFix(base, { scenes: [{ index: 5, narration: '턱 아래뿐이면 품종이 바뀐 거예요.', takeaways: [{ when: '턱 아래만 싹', then: '품종 바뀜' }] }] }, opts);
    expect(kept.plan.scenes[4]!.takeaways).toEqual([{ when: '턱 아래만 싹', then: '품종 바뀜' }]);
    expect(kept.droppedCards).toEqual([]);
  });
  it('목록 씬도 같다 — 목록을 안 주면 목록·연출을 뗀다', () => {
    const r = mergePartialFix(base, { scenes: [{ index: 3, narration: '턱 위에서 싹이 났으면 사려던 품종이 살아 있어요.' }] }, opts);
    expect(r.plan.scenes[2]!.items).toBeUndefined();
    expect(r.plan.scenes[2]!.kind).toBeUndefined();
  });
  it('자막 — 새로 안 주면 새 내레이션과 겹칠 때만 남긴다(모과 인스타 "꽃말은 평범" 잔존 실측)', () => {
    const p = mk([{ narration: '훅.' }, { narration: '전제.' }, { narration: '본문.' }, { narration: '꽃말은 평범하지만 향은 진해요.', kind: 'cta', screenText: '꽃말은 평범' }]);
    const stale = mergePartialFix(p, { scenes: [{ index: 4, narration: '노랗게 익으면 향을 맡아 보세요.' }] }, opts);
    expect(stale.plan.scenes[3]!.screenText).toBe('');
    const fits = mergePartialFix(p, { scenes: [{ index: 4, narration: '꽃말은 평범해도 향은 오래가요.' }] }, opts);
    expect(fits.plan.scenes[3]!.screenText).toBe('꽃말은 평범');
  });
  it('budgetChars — 합계가 넘으면 가장 많이 늘어난 수정부터 되돌린다', () => {
    const b = total(base);
    const r = mergePartialFix(base, { scenes: [
      { index: 2, narration: `${base.scenes[1]!.narration} 턱이 핵심이에요.` },
      { index: 4, narration: '흙 덮었으면 턱이 묻혔을 수 있어요.' },
    ] }, { ...opts, budgetChars: b });
    expect(r.changed).toEqual([4]);
    expect(total(r.plan)).toBeLessThanOrEqual(b);
  });
  it('onlyScenes — 흐름 점검은 끊긴 이음새 양쪽만', () => {
    const r = mergePartialFix(base, { scenes: [{ index: 2, narration: '작년에 호두 묘목 심었다면, 밑동 접목 턱부터 봐요.' }, { index: 4, narration: '흙을 덮었다면 턱이 묻혔을 수 있어요.' }] }, { ...opts, onlyScenes: [4] });
    expect(r.changed).toEqual([4]);
  });
  it('유효 응답이 없으면 무변화', () => {
    expect(mergePartialFix(base, null, opts).changed).toEqual([]);
    expect(mergePartialFix(base, { scenes: [{ index: 9, narration: 'x' }, { index: 2, narration: '' }] }, opts).changed).toEqual([]);
  });
});

describe('partialFixVerdict — 나아지지 않았으면 첫 원고(문제 증가 또는 새 건너뜀)', () => {
  it('문제가 늘면 거절', () => {
    expect(partialFixVerdict(['항목1: a'], ['항목1: a', '항목2: b']).accept).toBe(false);
  });
  it('새 씬의 건너뜀이 생기면 거절', () => {
    const v = partialFixVerdict(['항목4: 전제가 갑자기 등장'], ['항목3: 앞에서 정의 없이 쓰인 지시어']);
    expect(v.accept).toBe(false);
    expect(v.why).toContain('새 건너뜀');
  });
  it('부분 수정이 바꾼 씬(또는 그 다음 씬)에 걸린 건너뜀만 새 것으로 센다 — 손대지 않은 이음새의 새 지적은 판정 흔들림', () => {
    expect(partialFixVerdict(['항목2: 지시어'], ['항목4: 전제가 갑자기 등장'], [2]).accept).toBe(true);
    expect(partialFixVerdict(['항목2: 지시어'], ['항목3: 전제가 갑자기 등장'], [2]).accept).toBe(false);
  });
  it('같은 씬의 건너뜀이 남거나 문제가 줄면 채택', () => {
    expect(partialFixVerdict(['항목4: 전제가 갑자기 등장', '항목1: 훅이 30자'], ['항목4: 전제가 갑자기 등장']).accept).toBe(true);
    expect(partialFixVerdict(['항목1: 훅이 30자'], []).accept).toBe(true);
  });
  it('structuralProblems / problemsTargetHook', () => {
    expect(structuralProblems(['항목4: 결론 부재 — 판정이 끝까지 없다', '항목2: x'])).toHaveLength(1);
    expect(structuralProblems(['항목5: 마지막 씬 kind 가 "list" 다'])).toHaveLength(1);
    expect(problemsTargetHook(['항목1: 훅이 31자 — 20자 이내'])).toBe(true);
    expect(problemsTargetHook(['1: 핵심 주제어가 없다'])).toBe(true);
    expect(problemsTargetHook(['항목12: x', '항목3: y'])).toBe(false);
  });
});

describe('footageContradictsTopic — 훅 실촬영이 주제와 어긋나는가', () => {
  it('실데이터(호두 두 편) — "잎이 안 나요" ↔ "초록 잎이 무성"', () => {
    expect(footageContradictsTopic('호두나무 잎이 안 나요, 늦게까지 안 떨어지면 봅니다', '호두나무로 보이는 나무에 초록 잎이 무성하고 둥근 열매')).toContain('잎');
    expect(footageContradictsTopic('호두나무 잎이 안 나요, 10월에 여기부터 봅니다', '호두나무 가지에 초록 잎이 무성하게 달려 있고 열매')).not.toBe('');
  });
  it('주제가 없음·안 됨이 아니면 어긋남이 아니다', () => {
    expect(footageContradictsTopic('배롱나무 가지치기 시기', '꽃 핀 배롱나무 밭')).toBe('');
    expect(footageContradictsTopic('호두나무 잎이 안 나요', undefined)).toBe('');
  });
  it('화면 지목 훅 판별 + 단정형 규칙 문구', () => {
    expect(FOOTAGE_DEICTIC_RE.test('이 나무, 잎이랑 열매가 저렇게 가득하죠.')).toBe(true);
    expect(FOOTAGE_DEICTIC_RE.test('싹났다고 다 살아난 게 아니에요.')).toBe(false);
    expect(assertiveHookRule('x')).toContain('단정 선언');
  });
});

describe('keywordEarlyIssues — 검색 키워드·답 앞세우기', () => {
  const sc = (a: string, b: string, rest = '본문이에요.'): Array<{ narration: string; screenText?: string }> =>
    [{ narration: a }, { narration: b }, { narration: rest }, { narration: '끝이에요.' }];
  it('유튜브 — 씬1~2 에 수종명 + 키워드 다른 낱말이 없으면 1건', () => {
    expect(keywordEarlyIssues(sc('잎 다 진 뒤가 답이에요.', '지금 자르면 꽃눈이 날아가요.'), '배롱나무 가지치기', 'youtube')).toHaveLength(1);
    expect(keywordEarlyIssues(sc('지금 자르면 내년 꽃이 없어요.', '배롱나무 가지치기는 잎이 다 진 뒤, 11월부터예요.'), '배롱나무 가지치기', 'youtube')).toEqual([]);
  });
  it('인스타 — 수종명이 내레이션 어딘가에 한 번은', () => {
    expect(keywordEarlyIssues(sc('마당에 이 나무 있는 분.', '지금 자르면 꽃이 없어요.'), '배롱나무 가지치기', 'instagram')).toHaveLength(1);
    expect(keywordEarlyIssues(sc('마당에 이 나무 있는 분.', '지금 자르면 꽃이 없어요.', '배롱나무는 잎 진 뒤예요.'), '배롱나무 가지치기', 'instagram')).toEqual([]);
  });
  it('키워드가 없으면 검사 안 함', () => {
    expect(keywordEarlyIssues(sc('a', 'b'), undefined, 'youtube')).toEqual([]);
  });
});

describe('프롬프트 — 부분 수정·흐름 점검·채널·형제 지침', () => {
  const scenes = [
    { narration: '싹났다고 다 살아난 게 아니에요.', kind: 'hook' as const },
    { narration: '접목 턱 위는 품종, 아래는 대목이에요.', screenText: '턱 위 vs 아래' },
    { narration: '턱 아래서만 솟았으면 위쪽은 죽은 거예요.' },
    { narration: '흙에 묻혔으면 파서 꺼내세요.' },
    { narration: '턱 위 싹이면 그냥 키우세요.', kind: 'cta' as const, takeaways: [{ when: '턱 위 싹', then: '그냥 키우기' }] },
  ];
  it('부분 수정 — 현 대본·문제·씬별 상한을 주고, 통째 재집필 스키마(title/titles)는 안 준다', () => {
    const t = partialFixPrompt({ scenes, problems: ['항목4: 흙 덮은 전제가 갑자기 등장'], budgets: B212, stage: 'plan', hookEditable: false, sourceExcerpt: '원문 발췌', keyword: '호두 묘목' });
    expect(t).toContain('대본 전체를 다시 쓰지 마라');
    expect(t).toContain(scriptForEdit(scenes));
    expect(t).toContain('항목4: 흙 덮은 전제가 갑자기 등장');
    expect(t).toContain('훅 20자 · 씬2 50자 · 본문 45자 · 마지막 씬 34자');
    expect(t).toContain('씬1(훅)은 고치지 마라');
    expect(t).toContain('결론 카드: 턱 위 싹 → 그냥 키우기');
    expect(t).toContain('원문 발췌');
    expect(t).not.toContain('"titles"');
  });
  it('부분 수정 — 훅을 지목하면 훅 수정 허용, 훅 화면 규칙을 싣는다', () => {
    const t = partialFixPrompt({ scenes, problems: ['항목1: 훅이 30자'], budgets: B212, stage: 'compressed', hookEditable: true, hookRule: assertiveHookRule('잎 ↔ 무성') });
    expect(t).toContain('감량한 결과');
    expect(t).toContain('문제가 씬1 을 지목했으니 고쳐도 된다');
    expect(t).toContain('화면 묘사 금지');
  });
  it('흐름 점검 — 이음새·씬2 틀·CTA 를 보고 훅은 안 고친다, 예산 명시', () => {
    const t = flowCheckPrompt({ scenes, budgets: B212 });
    expect(t).toContain('씬2 가 세운 틀');
    expect(t).toContain('씬1(훅)은 고치지 마라');
    expect(t).toContain('212자 이내');
    expect(t).toContain('"transitions"');
    expect(t).toContain('이음새 4곳');
    expect(t).toContain('산딸기는 가시 있는 덤불');
  });
  it('flowBreaks — 이음새별 판정(ok:false)과 구 꼴(breaks)을 읽는다', () => {
    expect(flowBreaks({ transitions: [{ at: 1, ok: true }, { at: 3, ok: false, why: '산딸기 갑자기' }] })).toEqual([{ at: 3, why: '산딸기 갑자기' }]);
    expect(flowBreaks({ breaks: [{ at: 2 }] })).toEqual([{ at: 2, why: '' }]);
    expect(flowBreaks({ transitions: [{ at: 'x', ok: false }] })).toEqual([]);
    expect(flowBreaks(null)).toEqual([]);
  });
  it('flowFixScenes — 끊긴 이음새 양쪽(훅 제외), 범위 밖 무시', () => {
    expect(flowFixScenes([{ at: 1 }], 5)).toEqual([2]);
    // 마지막 이음새(4→5)는 앞 씬(4)으로만 잇는다 — CTA(결론 카드)는 흐름 점검이 고치지 않는다(2026-10-05 리뷰).
    expect(flowFixScenes([{ at: 3 }, { at: 4 }], 5)).toEqual([3, 4]);
    expect(flowFixScenes([{ at: 4 }], 5)).toEqual([4]);
    expect(flowFixScenes([{ at: 0 }, { at: 5 }], 5)).toEqual([]);
  });
  it('유튜브 지침은 씬2 에 "키워드+답" 한 문장, 인스타는 공유형 유지 + 수종명 한 번', () => {
    const yt = platformPlanGuide('youtube');
    expect(yt).toContain('배롱나무 가지치기는 잎이 다 진 뒤, 11월부터예요');
    expect(yt).toContain('훅(씬1)은 키워드 낭독으로 열지 않는다');
    const ig = platformPlanGuide('instagram');
    expect(ig).toContain('공유');
    expect(ig).toContain('수종명');
    expect(ig).not.toContain('11월부터예요');
  });
  it('형제 대본 지침 — 같은 핵심 축, 다른 각도(원문 핵심 앵커와 충돌 제거)', () => {
    expect(SIBLING_ANGLE_RULE).toContain('핵심 축은 같게');
    expect(SIBLING_ANGLE_RULE).toMatch(/상황.*판정.*화자/);
    expect(SIBLING_ANGLE_RULE).not.toContain('다른 축을 골라');
  });
});

describe('흐름 점검 병합 — 화면 글자를 지킨다(2026-10-05 리뷰 1)', () => {
  // 산딸 꼴 — 흐름 점검이 CTA 이음 문장만 고쳤는데 결론 카드·자막이 지워졌다(실측 droppedCards=[5]).
  const sandal = mk([
    { narration: '빨갛다고 다 익은 게 아니에요.', kind: 'hook' },
    { narration: '산딸나무 열매는 익으면 말랑해져요. 그게 기준이에요.', screenText: '말랑하면 익음' },
    { narration: '붉게 물들어도 눌러서 단단하면 아직이에요.' },
    { narration: '겉이 오돌토돌한 공 모양이면 산딸나무 열매예요.' },
    { narration: '눌러서 말랑하면 그때 따세요.', kind: 'cta', screenText: '말랑하면 수확', takeaways: [{ when: '눌러서 말랑', then: '수확' }, { when: '아직 단단', then: '며칠 더' }] },
  ]);
  const flowCand = { scenes: [{ index: 5, narration: '그러니 눌러 보고 말랑할 때 따세요.' }] };
  it('재현 — 기본 병합(cards 지정 없음)은 이음 문장만 바뀐 CTA 의 결론 카드·자막을 지운다', () => {
    const r = mergePartialFix(sandal, flowCand, { hookEditable: false, budgets: B212 });
    expect(r.droppedCards).toEqual([5]);
    expect(r.plan.scenes[4]!.takeaways).toBeUndefined();
    expect(r.plan.scenes[4]!.screenText).toBe('');
  });
  it("cards:'keep'(흐름 점검) — 결론 카드·자막·목록 유지, droppedCards 없음", () => {
    const r = mergePartialFix(sandal, flowCand, { hookEditable: false, budgets: B212, cards: 'keep' });
    expect(r.changed).toEqual([5]);
    expect(r.droppedCards).toEqual([]);
    expect(r.plan.scenes[4]!.takeaways).toEqual(sandal.scenes[4]!.takeaways);
    expect(r.plan.scenes[4]!.screenText).toBe('말랑하면 수확');
    const list = mk([{ narration: '훅.' }, { narration: '전제 문장.' }, { narration: '세 가지를 보세요.', kind: 'list', items: ['색', '단단함', '모양'] }, { narration: '끝.', kind: 'cta' }]);
    const l = mergePartialFix(list, { scenes: [{ index: 3, narration: '그래서 이 세 가지를 보세요.' }] }, { hookEditable: false, budgets: B212, cards: 'keep' });
    expect(l.plan.scenes[2]!.items).toEqual(['색', '단단함', '모양']);
    expect(l.plan.scenes[2]!.kind).toBe('list');
  });
  it('lostCards — 어느 단계든 화면 카드가 사라진 씬(씬 수가 다르면 마지막 씬끼리)', () => {
    const dropped = mergePartialFix(sandal, flowCand, { hookEditable: false, budgets: B212 }).plan;
    expect(lostCards(sandal, dropped)).toEqual([5]);
    expect(lostCards(sandal, sandal)).toEqual([]);
    expect(lostCards(sandal, mk(sandal.scenes.slice(0, 3).concat([{ narration: '끝.', kind: 'cta' }])))).toEqual([4]);
  });
  it('흐름 점검 프롬프트 — 마지막 이음새는 앞 씬으로, 새 사실·판별 기준 금지, 짧은 원문 발췌', () => {
    const t = flowCheckPrompt({ scenes: sandal.scenes, budgets: B212, sourceExcerpt: '산딸나무 열매는 9~10월에 붉게 익는다' });
    expect(t).toContain('씬4→5(마지막 이음새)이 끊겼으면 씬4 끝 문장을 고쳐');
    expect(t).toContain('마지막 씬(결론·결론 카드)은 고치지 마라');
    expect(t).toContain('새 사실·수치·판별 기준 추가 금지');
    expect(t).toContain('산딸나무 열매는 9~10월에 붉게 익는다');
    expect(flowCheckPrompt({ scenes: sandal.scenes, budgets: B212 })).not.toContain('원문 블로그 발췌');
  });
});

describe("감량 뒤 수정 병합 — cards:'keepUnlessDiverged'(2026-10-05 리뷰 7)", () => {
  const o = { hookEditable: false, budgets: B212, cards: 'keepUnlessDiverged' as const };
  const withCta = (narration: string) => mk([{ narration: '훅.' }, { narration: '전제 문장.' }, { narration: '본문.' },
    { narration, kind: 'cta', takeaways: [{ when: '눌러서 말랑', then: '수확' }] }]);
  it('카드를 되풀이하지 않던 CTA(답은 화면에만) — 응답이 카드를 빠뜨려도 지우지 않는다', () => {
    const r = mergePartialFix(withCta('이 기준 하나면 실패가 없어요.'), { scenes: [{ index: 4, narration: '이 기준만 기억하면 돼요.' }] }, o);
    expect(r.changed).toEqual([4]);
    expect(r.droppedCards).toEqual([]);
    expect(r.plan.scenes[3]!.takeaways).toEqual([{ when: '눌러서 말랑', then: '수확' }]);
  });
  it('카드가 되받던 말이 그대로면 유지', () => {
    const r = mergePartialFix(withCta('눌러서 말랑하면 그때 따세요.'), { scenes: [{ index: 4, narration: '눌러 보고 말랑하면 따세요.' }] }, o);
    expect(r.droppedCards).toEqual([]);
    expect(r.plan.scenes[3]!.takeaways).toBeDefined();
  });
  it('카드가 되받던 말이 사라지면(바뀐 말과 어긋남) 지우고 droppedCards 로 보고', () => {
    const r = mergePartialFix(withCta('눌러서 말랑하면 그때 따세요.'), { scenes: [{ index: 4, narration: '색이 검붉어지면 따세요.' }] }, o);
    expect(r.droppedCards).toEqual([4]);
    expect(r.plan.scenes[3]!.takeaways).toBeUndefined();
  });
  it('감량 뒤 수정 프롬프트는 카드가 남는다고 말한다(기획 단계는 종전대로 지워진다고)', () => {
    const sc = withCta('끝.').scenes;
    expect(partialFixPrompt({ scenes: sc, problems: ['항목3: x'], budgets: B212, stage: 'compressed', hookEditable: false })).toContain('돌려주지 않은 결론 카드·목록은 그대로 남는다');
    expect(partialFixPrompt({ scenes: sc, problems: ['항목3: x'], budgets: B212, stage: 'plan', hookEditable: false })).toContain('돌려주지 않은 결론 카드·목록은 지워진다');
  });
});

describe('chooseFixedPlan — 재집필·재검산 예외에도 채택한 수정을 지킨다(2026-10-05 리뷰 6)', () => {
  const base = mk([{ narration: '훅.' }, { narration: '전제.' }, { narration: '본문 하나.' }, { narration: '본문 둘.' }, { narration: '끝.', kind: 'cta' }]);
  const merged = mergePartialFix(base, { scenes: [{ index: 3, narration: '본문 하나를 고쳤어요.' }] }, { hookEditable: false, budgets: B212 });
  const say = (): void => { /* 로그 무시 */ };
  it('부분 수정 채택 뒤 구조 문제가 남아 재집필을 부르고, 재집필이 예외를 던지면 부분 수정을 지킨다', async () => {
    const before = ['항목4: 결론 부재 — 끝까지 답이 없다'];
    const r = await chooseFixedPlan({
      base, merged, before, say,
      recheck: async () => ['항목4: 결론 부재 — 끝까지 답이 없다'],
      fullRewrite: async () => { throw new Error('LLM 끊김'); },
    });
    expect(r?.stage).toBe('부분 수정');
    expect(r?.plan.scenes[2]!.narration).toBe('본문 하나를 고쳤어요.');
  });
  it('재검산이 예외면 그 후보는 채택하지 않는다(나아졌는지 모른다) — 예외를 밖으로 던지지 않는다', async () => {
    const r = await chooseFixedPlan({
      base, merged, before: ['항목3: x'], say,
      recheck: async () => { throw new Error('검산 실패'); },
      fullRewrite: async () => null,
    });
    expect(r).toBeNull();
  });
  it('유효 수정 0 → 재집필, 재집필 재검산이 나아졌으면 채택', async () => {
    const none = mergePartialFix(base, null, { hookEditable: false, budgets: B212 });
    const rewritten = mk([{ narration: '새 훅.' }, { narration: '새 전제.' }, { narration: '새 본문.' }, { narration: '새 본문 둘.' }, { narration: '새 끝.', kind: 'cta' }]);
    const r = await chooseFixedPlan({ base, merged: none, before: ['항목3: x', '항목4: y'], say, recheck: async () => ['항목3: x'], fullRewrite: async () => rewritten });
    expect(r?.stage).toBe('통째 재집필');
  });
});

describe('씬별 출처·최종 원문 대조(2026-10-05 리뷰 3)', () => {
  const s = (n: string) => ({ narration: n });
  const draft = [s('훅.'), s('전제 원고.'), s('본문 원고.'), s('본문 둘 원고.'), { narration: '끝 원고.', kind: 'cta' as const }];
  it('흐름 점검이 바꾼 씬이 지적되면 지적 없던 첫 원고 판본으로 되돌린다', () => {
    let t = traceMarkParity(traceStart(draft), []); // 첫 원고 대조: 지적 없음
    const flowed = draft.map((x, i) => (i === 3 ? s('본문 둘, 새 사실이 들어감.') : x));
    t = traceRecord(t, flowed, '흐름 점검', { llm: true });
    expect(traceNeedsParity(t)).toBe(true);
    const r = finalParityRevert(t, flowed, ['항목4: 원문에 없는 사실']);
    expect(r.reverted).toEqual([{ scene: 4, from: '흐름 점검', to: '첫 원고' }]);
    expect(r.scenes[3]!.narration).toBe('본문 둘 원고.');
    expect(r.remaining).toEqual([]);
  });
  it('가장 최근 통과 판본을 고른다 — 부분 수정(재대조 통과) → 감량(지적)이면 부분 수정 판본으로', () => {
    let t = traceMarkParity(traceStart(draft), ['항목3: 첫 원고 지적']);
    const fixed = draft.map((x, i) => (i === 2 ? s('본문 고침.') : x));
    t = traceMarkParity(traceRecord(t, fixed, '부분 수정', { llm: true }), []);
    const squeezed = fixed.map((x, i) => (i === 2 ? s('본문 감량.') : x));
    t = traceRecord(t, squeezed, '감량', { llm: true });
    const r = finalParityRevert(t, squeezed, ['항목3: 결론 반전']);
    expect(r.scenes[2]!.narration).toBe('본문 고침.');
    expect(r.reverted[0]!.to).toBe('부분 수정');
  });
  it('바뀐 적 없는 씬의 지적은 버리지 않고 남긴다(종전 factRecheck 결함) — 보류 표시 대상', () => {
    let t = traceMarkParity(traceStart(draft), []);
    const flowed = draft.map((x, i) => (i === 3 ? s('본문 둘 고침.') : x));
    t = traceRecord(t, flowed, '흐름 점검', { llm: true });
    const r = finalParityRevert(t, flowed, ['항목2: 원문에 없는 시기']);
    expect(r.reverted).toEqual([]);
    expect(r.remaining).toEqual(['항목2: 원문에 없는 시기']);
  });
  it('첫 원고도 지적받았던 바뀐 씬은 되돌릴 판본이 없다 — 남긴다', () => {
    let t = traceMarkParity(traceStart(draft), ['항목3: 지적']);
    const fixed = draft.map((x, i) => (i === 2 ? s('본문 고침.') : x));
    t = traceRecord(t, fixed, '부분 수정', { llm: true });
    const r = finalParityRevert(t, fixed, ['항목3: 또 지적']);
    expect(r.reverted).toEqual([]);
    expect(r.remaining).toEqual(['항목3: 또 지적']);
  });
  it('씬 번호를 못 읽는 지적은 남기고, 통과(ok:true)도 적지 않는다', () => {
    const t = traceMarkParity(traceStart(draft), ['전체적으로 원문과 다름']);
    expect(t.every((vs) => vs[0]!.ok === undefined)).toBe(true);
    expect(finalParityRevert(t, draft, ['전체적으로 원문과 다름']).remaining).toEqual(['전체적으로 원문과 다름']);
  });
  it('트리밍 kept 로 자리를 다시 맞춘다 — 결정적 단계는 판본을 쌓지 않고 맨 위를 고친다', () => {
    let t = traceMarkParity(traceStart(draft), []);
    const squeezed = draft.map((x, i) => (i === 3 ? s('본문 둘 감량.') : x));
    t = traceRecord(t, squeezed, '감량', { llm: true });
    const trimmed = [squeezed[0]!, squeezed[1]!, squeezed[3]!, squeezed[4]!]; // 씬3 제거
    t = traceRecord(t, trimmed, '트리밍', { llm: false, kept: [0, 1, 3, 4] });
    expect(t.length).toBe(4);
    expect(t[2]!.map((v) => v.stage)).toEqual(['첫 원고', '감량']);
    const r = finalParityRevert(t, trimmed, ['항목3: 지적']);
    expect(r.scenes[2]!.narration).toBe('본문 둘 원고.');
    // 결정적 손질은 같은 판본 — 첫 원고만 트리밍된 씬은 여전히 첫 원고(바뀐 적 없음)
    const t2 = traceRecord(traceStart(draft), draft.map((x, i) => (i === 2 ? s('본문.') : x)), '트리밍', { llm: false });
    expect(t2[2]!.length).toBe(1);
    expect(t2[2]![0]!.draft).toBe(true);
  });
  it('통째 재집필로 씬 수가 바뀌면 더미를 새로 시작 — 되돌릴 판본이 없어 지적은 남는다', () => {
    const t = traceRecord(traceMarkParity(traceStart(draft), []), draft.slice(0, 4), '통째 재집필', { llm: true });
    expect(t.every((vs) => vs.length === 1 && !vs[0]!.draft)).toBe(true);
    expect(traceNeedsParity(t)).toBe(true);
    expect(finalParityRevert(t, draft.slice(0, 4), ['항목2: x']).remaining).toEqual(['항목2: x']);
  });
  it('훅 화면 어긋남 편 — 화면 지목 훅 판본으로는 되돌리지 않고 지적을 남긴다', () => {
    const d = [s('이 나무, 잎이 가득하죠.'), ...draft.slice(1)];
    let t = traceMarkParity(traceStart(d), []);
    const fixed = [s('잎 안 나는 호두, 원인은 셋이에요.'), ...draft.slice(1)];
    t = traceRecord(t, fixed, '부분 수정', { llm: true });
    const r = finalParityRevert(t, fixed, ['항목1: 원문에 없는 수치'], { hookReject: FOOTAGE_DEICTIC_RE });
    expect(r.reverted).toEqual([]);
    expect(r.remaining).toEqual(['항목1: 원문에 없는 수치']);
    expect(finalParityRevert(t, fixed, ['항목1: 원문에 없는 수치']).reverted).toHaveLength(1); // 가드 없으면 되돌린다
  });
  it('대조를 다 받은 더미면 최종 대조를 건너뛴다', () => {
    expect(traceNeedsParity(traceMarkParity(traceStart(draft), []))).toBe(false);
  });
  it('finalFactGate — 잔존은 hold, 시기·수치(timing)는 그대로 싣고, 판정 실패는 error(이미 hold 면 유지)', () => {
    const fg = finalFactGate(undefined, { remaining: ['항목2: x'], display: ['시기 3월 ↔ 원문 4월'] }, 'T');
    expect(fg).toMatchObject({ status: 'hold', unsupported: ['항목2: x'], timing: ['시기 3월 ↔ 원문 4월'], checkedTs: 'T' });
    expect(finalFactGate(undefined, { remaining: [], display: [] })).toBeUndefined();
    expect(finalFactGate({ status: 'hold', unsupported: ['old'], contradicted: [], checkedTs: 'a' }, { remaining: [], display: [] }, 'T')).toMatchObject({ status: 'pass', unsupported: [] });
    expect(finalFactGate(undefined, null, 'T')).toMatchObject({ status: 'error', checkedTs: 'T' });
    const timingOnly = { status: 'pass' as const, unsupported: [], contradicted: [], timing: ['t'], checkedTs: 'a' };
    expect(finalFactGate(timingOnly, null, 'T')).toMatchObject({ status: 'error', timing: ['t'] });
    const hold = { status: 'hold' as const, unsupported: ['h'], contradicted: [], checkedTs: 'a' };
    expect(finalFactGate(hold, null)).toBe(hold);
  });
});

describe('형제 대본 미리보기(2026-10-05 리뷰 5)', () => {
  it('제목·훅만 plan.sibling.json 에 쓴다(plan.json 은 건드리지 않는다)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-'));
    writeSiblingPreview(dir, mk([{ narration: '빨갛다고 다 익은 게 아니에요.' }, { narration: '전제.' }]));
    const j = JSON.parse(fs.readFileSync(path.join(dir, SIBLING_PREVIEW_FILE), 'utf-8')) as { title: string; scenes: Array<{ narration: string }> };
    expect(SIBLING_PREVIEW_FILE).toBe('plan.sibling.json');
    expect(j.title).toBe('t');
    expect(j.scenes).toEqual([{ narration: '빨갛다고 다 익은 게 아니에요.' }]);
    expect(fs.existsSync(path.join(dir, 'plan.json'))).toBe(false);
    writeSiblingPreview(path.join(dir, 'nope', 'deeper'), mk([{ narration: 'x' }])); // 실패는 무해(던지지 않는다)
  });
  it('siblingPlanFile — 출발 판정·겹침 지침이 같이 쓰는 읽기: plan.json 우선, 없으면 미리보기, 둘 다 없으면 undefined', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-'));
    expect(siblingPlanFile(dir)).toBeUndefined();
    writeSiblingPreview(dir, mk([{ narration: '훅.' }]));
    expect(siblingPlanFile(dir)).toBe(path.join(dir, SIBLING_PREVIEW_FILE)); // plan.json 없이 미리보기만 있어도 출발
    fs.writeFileSync(path.join(dir, 'plan.json'), '{}');
    expect(siblingPlanFile(dir)).toBe(path.join(dir, 'plan.json'));
  });
});

describe('감량 뒤 수정 — 킬스위치 끔(종전 병합)·채택 판정(2026-10-05 리뷰 4·7)', () => {
  it('SHORTS_PARTIAL_FIX=false 경로(mergeNarrationOnly) — 내레이션만 바꾸고 자막·결론 카드·목록·연출은 바이트 동일', () => {
    const p = mk([{ narration: '훅.' }, { narration: '전제.', screenText: '전제 자막' }, { narration: '셋을 보세요.', kind: 'list', items: ['가', '나'] },
      { narration: '눌러서 말랑하면 따세요.', kind: 'cta', screenText: '말랑하면 수확', takeaways: [{ when: '말랑', then: '수확' }] }]);
    const out = mergeNarrationOnly(p, [{ index: 3, narration: '이 둘을 보세요.' }, { index: 4, narration: '색이 검붉으면 따세요.' }, { index: 9, narration: 'x' }, null]);
    expect(out.scenes[2]).toEqual({ ...p.scenes[2], narration: '이 둘을 보세요.' });
    expect(out.scenes[3]).toEqual({ ...p.scenes[3], narration: '색이 검붉으면 따세요.' });
    expect(out.scenes[0]).toEqual(p.scenes[0]);
    expect(p.scenes[3]!.narration).toBe('눌러서 말랑하면 따세요.'); // 입력 불변
  });
  it('채택 판정 — 감량 뒤 수정이 문제를 늘리거나 바꾼 씬에 새 건너뜀을 만들면 감량본 유지', () => {
    const before = ['항목3: 문장이 조사 없이 끊겼다', '항목4: "그 기준"이 가리키는 말이 앞에 없다'];
    expect(partialFixVerdict(before, [...before, '항목2: 훅이 키워드로 시작'], [3]).accept).toBe(false);
    expect(partialFixVerdict(before, ['항목5: 결론이 갑자기 다른 화제'], [4]).accept).toBe(false); // 바꾼 씬(4)의 다음 씬 새 건너뜀
    expect(partialFixVerdict(before, ['항목4: "그 기준"이 가리키는 말이 앞에 없다'], [3]).accept).toBe(true);
  });
});

describe('킬스위치 — SHORTS_PARTIAL_FIX · SHORTS_FLOW_CHECK', () => {
  it('기본 켬, false 면 끔', async () => {
    const keep = { a: process.env.SHORTS_PARTIAL_FIX, b: process.env.SHORTS_FLOW_CHECK };
    delete process.env.SHORTS_PARTIAL_FIX; delete process.env.SHORTS_FLOW_CHECK;
    vi.resetModules();
    let { CONFIG } = await import('../config');
    expect(CONFIG.shortsPartialFix).toBe(true);
    expect(CONFIG.shortsFlowCheck).toBe(true);
    process.env.SHORTS_PARTIAL_FIX = 'false'; process.env.SHORTS_FLOW_CHECK = 'false';
    vi.resetModules();
    ({ CONFIG } = await import('../config'));
    expect(CONFIG.shortsPartialFix).toBe(false);
    expect(CONFIG.shortsFlowCheck).toBe(false);
    if (keep.a === undefined) delete process.env.SHORTS_PARTIAL_FIX; else process.env.SHORTS_PARTIAL_FIX = keep.a;
    if (keep.b === undefined) delete process.env.SHORTS_FLOW_CHECK; else process.env.SHORTS_FLOW_CHECK = keep.b;
    vi.resetModules();
  });
});

describe('hookContradictsFootage — 작가가 쓴 훅이 훅 화면과 어긋나는가(2026-10-15)', () => {
  const summer = '맑은 하늘 아래 호두나무 가지와 잎, 열매를 아래에서 올려다본 모습';
  it('실측: 잎·열매가 아직 달린 10월 초 촬영 영상에 "잎 다 떨어진 이 나무" — 어긋남', () => {
    expect(hookContradictsFootage('잎 다 떨어진 이 나무, 죽은 걸까요 잎이 다 졌어요', summer)).toContain('잎');
    expect(hookFootageIssues({ narration: '잎 다 떨어진 이 나무, 죽은 걸까요', screenText: '잎이 다 졌어요' }, summer)[0]).toMatch(/^씬1:/);
    expect(problemsTargetHook(hookFootageIssues({ narration: '잎 다 떨어진 이 나무', screenText: '' }, summer))).toBe(true);
  });
  it('화면에 맞는 훅·화면이 잎 없음이라 적은 판독은 통과', () => {
    expect(hookContradictsFootage('이 호두나무, 뿌리는 잘 내렸을까요', summer)).toBe('');
    expect(hookContradictsFootage('잎 다 떨어진 이 나무, 죽은 걸까요', '잎이 다 떨어진 앙상한 호두나무 가지')).toBe('');
    expect(hookContradictsFootage('잎 다 떨어진 이 나무', undefined)).toBe('');
  });
});

describe('남는 왜곡은 원문 문장으로(2026-10-15)', () => {
  it('stableProblemScenes — 세 판정 중 두 번 이상 지목된 씬만, 번호 없는 지적·실패 판정은 뺀다', () => {
    expect(stableProblemScenes([['항목3: a', '5번: b'], ['3: c'], null], 5)).toEqual([3]);
    expect(stableProblemScenes([['항목3: a'], ['항목4: b'], ['원문과 다름']], 5)).toEqual([]);
    expect(stableProblemScenes([['항목9: a'], ['9: b']], 5)).toEqual([]);
  });
  const src = '가지 끝을 손으로 구부려 보세요. 휘었다가 되돌아오면 산 가지입니다. 반대로 밑동 바로 위까지 전부 부러지면 봄을 기다릴 이유가 없습니다.';
  it('isNearLiteral — 어미만 바꾼 원문은 통과, 작가식 재작성은 걸린다(호두 활착 실측)', () => {
    expect(isNearLiteral('휘었다가 되돌아오면 산 가지예요.', src)).toBe(true);
    expect(isNearLiteral('그래서 휘었다가 되돌아오면 산 가지예요. 밑동 바로 위까지 전부 부러지면 봄을 기다릴 이유가 없어요.', src)).toBe(true);
    expect(isNearLiteral('가지 끝을 손으로 구부려 보세요. 휘다가 되돌아오면 뿌리는 살아 있을 가능성이 커요.', src)).toBe(false);
  });
  it('isNearLiteral — 작가용 원문(근거 미확인 문장을 뺀 판본)과 대조하면 뺀 문장을 옮겨 와도 통과 못 한다', async () => {
    const { writerSource } = await import('../content/inheritedClaims');
    const flagged = ['반대로 밑동 바로 위까지 전부 부러지면 봄을 기다릴 이유가 없습니다.'];
    const ws = writerSource(src, flagged, true).body;
    expect(isNearLiteral('밑동 바로 위까지 전부 부러지면 봄을 기다릴 이유가 없어요.', src)).toBe(true);
    expect(isNearLiteral('밑동 바로 위까지 전부 부러지면 봄을 기다릴 이유가 없어요.', ws)).toBe(false);
  });
  it('literalFixPrompt — 바꿀 씬·씬별 길이·조건 보존 규칙을 싣는다', () => {
    const t = literalFixPrompt({ scenes: [{ narration: '훅' }, { narration: '둘' }, { narration: '셋' }] as never, targets: [2], problems: ['2: 유보를 단정으로'], source: src, caps: { 2: 71 } });
    expect(t).toContain('[바꿀 씬] 2');
    expect(t).toContain('씬2 71자');
    expect(t).toMatch(/조건.*유보.*반드시 남긴다/);
  });
  it('mergePartialFix slackChars — 사실 수정은 씬 상한을 넘겨도 받는다', () => {
    const plan = { title: 't', scenes: [{ narration: '훅입니다' }, { narration: '가지 끝을 손으로 구부려 보세요. 휘다가 되돌아오면 뿌리는 살아 있어요.' }] } as never;
    const budgets = sceneCharBudgets(212, 2);
    const long = '가지 끝을 손으로 구부려 보세요. 휘었다가 되돌아오면 산 가지예요. 밑동 위까지 다 부러지면 포기할 때예요.';
    const cand = { scenes: [{ index: 2, narration: long }] };
    const tight = mergePartialFix(plan, cand, { hookEditable: false, budgets: { ...budgets, premise: 40, body: 40, cta: 40 } });
    expect(tight.changed).toEqual([]);
    const slack = mergePartialFix(plan, cand, { hookEditable: false, budgets: { ...budgets, premise: 40, body: 40, cta: 40 }, slackChars: 21 });
    expect(slack.changed).toEqual([2]);
  });
});

describe('hookFootageIssues — 다른 씬이 지금 나무 상태를 실촬영과 다르게 말하면(2026-10-15 사장님 지적)', () => {
  const oct = '맑은 날 하늘을 배경으로 호두나무 가지와 잎, 초록 열매';
  it('실측: 첫 장면 10월 초 실촬영(잎 달림) + 씬2 "잎이 진 지금" — 씬2 지적', () => {
    const r = hookFootageIssues({ narration: '이 잎, 색이 벌써 다릅니다' }, oct, [{ narration: '호두나무 활착은 잎보다 가지로 확인해요. 잎이 진 지금, 가지를 만져 보면 됩니다.' }, { narration: '가지 끝을 구부려 보세요.' }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^씬2:/);
  });
  it('"지금" 없이 일반론으로 말하면("가을에 잎이 지는 건 정상") 지적하지 않는다', () => {
    expect(hookFootageIssues({ narration: '이 잎, 색이 벌써 다릅니다' }, oct, [{ narration: '잎이 지는 건 가을이라 정상이에요.' }])).toEqual([]);
  });
});
