# 숏폼 첫 2초·리듬·낭독 개편 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 숏폼의 첫 2초(화면·문장·낭독)와 영상 리듬(구절 자막·결론 예고·중간 컷)을 바꾸고, 채널별 작가 번갈기·감량 뒤 재검산·이야기형 지침 3건을 고친다. 전부 킬스위치 뒤에.

**Architecture:** 파이프라인은 그대로(planShorts → fit → designScenes → 소재 배정 → 이미지 → prepareScenes(TTS) → stageAndBuildProps → Remotion). 각 태스크는 순수 함수(테스트) + 그 함수를 꽂는 배선 한두 줄. Remotion 쪽은 props 계산을 서버(shortsCommon)에서 순수 함수로 끝내고 컴포넌트는 프레임만 본다.

**Tech Stack:** TypeScript/Node 20 ESM, vitest, Remotion 4.0.520(remotion/*.tsx, `pnpm typecheck` 가 remotion/tsconfig 도 검사), ElevenLabs TTS, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-09-18-shorts-first-seconds-design.md`

## Global Constraints

- 킬스위치 5개 전부 `src/config.ts` 에 `envBool(..., true)` — off 면 종전 동작과 바이트 단위로 같아야 한다: `SHORTS_HOOK_FOOTAGE`, `SHORTS_HOOK_VOICE`, `SHORTS_CAPTIONS`, `SHORTS_TEASER`, `SHORTS_MIDCUT`.
- 이미지 생성 횟수 불변(씬당 1장, 실촬영 씬은 0장). 35초 상한 불변. 발행 경로 불변.
- 순수 함수는 네트워크·LLM·파일시스템 없이 테스트한다. Remotion 컴포넌트는 props 계산을 순수 함수로 빼서 테스트하고, 컴포넌트 자체는 `pnpm typecheck` 로만 검증한다.
- `<break …/>` 태그는 ElevenLabs 경로에서만 텍스트에 들어간다(openai/say 폴백은 태그를 낭독한다) — `synthesizeElevenLabs` 안에서만 주입.
- 프롬프트 문구를 바꿀 때 예시 구절은 형식만 보여 준다(작가가 그대로 베낀 실측 — 2026-09-18 마가목).
- 커밋 메시지는 한국어 요약 + 본문, 끝에 두 줄:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir`
- 삭제는 `trash`, 이동은 `mv -n`. 작업 트리의 `data/**` 런타임 변경은 건드리지도 커밋하지도 않는다.

---

### Task 1: §0 채널별 작가 번갈기

**Files:**
- Modify: `src/content/shortsWriters.ts` (pure helper 추가)
- Modify: `src/server/main.ts:1266-1270` (`assignShortsWriter`), 호출부 `:1339`(shortsCreateHandler), `:1521`(deriveShortsFromPiece)
- Test: `src/content/shortsWriters.test.ts`

**Interfaces:**
- Produces: `recentWriterIdsFor(shorts: ReadonlyArray<{ platform?: string; writerId?: string }>, platform: string | undefined, limit = 12): Array<string | undefined>` — `shorts` 는 최신순, 같은 채널(`(s.platform ?? '') === (platform ?? '')`)만 남겨 앞 `limit` 개의 `writerId`.
- `assignShortsWriter(platform?: ShortsPlatform)` — `pickWriter(recentWriterIdsFor(shortsStore().list(), platform))`.

- [ ] **Step 1: 실패 테스트**

```ts
// src/content/shortsWriters.test.ts (기존 describe 뒤에 추가)
describe('recentWriterIdsFor — 채널별 최근 작가(2026-09-18)', () => {
  const rows = [
    { platform: 'instagram', writerId: 'shorts_writer' },
    { platform: 'youtube', writerId: 'shorts_writer_b' },
    { platform: 'instagram', writerId: 'shorts_writer' },
    { platform: 'youtube', writerId: 'shorts_writer_b' },
    { writerId: 'shorts_writer' }, // 레거시(채널 미기록)
  ];
  it('같은 채널의 기록만 최신순으로', () => {
    expect(recentWriterIdsFor(rows, 'youtube')).toEqual(['shorts_writer_b', 'shorts_writer_b']);
    expect(recentWriterIdsFor(rows, 'instagram')).toEqual(['shorts_writer', 'shorts_writer']);
  });
  it('채널 미지정은 레거시(채널 없는) 기록만 본다', () => {
    expect(recentWriterIdsFor(rows, undefined)).toEqual(['shorts_writer']);
  });
  it('limit 을 지킨다', () => {
    expect(recentWriterIdsFor(rows, 'youtube', 1)).toEqual(['shorts_writer_b']);
  });
  it('유튜브가 임태윤만 12편이면 다음은 유하린, 인스타가 유하린만이면 다음은 임태윤 — 채널 안에서 번갈고 두 편은 다른 목소리', () => {
    expect(pickWriter(recentWriterIdsFor(rows, 'youtube')).id).toBe('shorts_writer');
    expect(pickWriter(recentWriterIdsFor(rows, 'instagram')).id).toBe('shorts_writer_b');
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm vitest run src/content/shortsWriters.test.ts` → `recentWriterIdsFor is not a function`.
- [ ] **Step 3: 구현**

```ts
// src/content/shortsWriters.ts — pickWriter 앞에
/**
 * 채널별 최근 작가(2026-09-18). 종전엔 채널 구분 없이 최근 12편을 봐서, 한 글의 두 편이 같은 순간 파생되면
 * 항상 유튜브=임태윤·인스타=유하린으로 굳었다(실측 24편 12:12). 채널 안에서 번갈아야 한다는 사장님 요구.
 * shorts 는 최신순. 채널 미기록(레거시)은 '' 채널로 본다.
 */
export function recentWriterIdsFor(
  shorts: ReadonlyArray<{ platform?: string; writerId?: string }>, platform: string | undefined, limit = 12,
): Array<string | undefined> {
  return shorts.filter((s) => (s.platform ?? '') === (platform ?? '')).slice(0, limit).map((s) => s.writerId);
}
```
`src/server/main.ts`:
```ts
function assignShortsWriter(platform?: ShortsPlatform): { writer: string; writerId: string; director?: string } {
  const w = pickWriter(recentWriterIdsFor(shortsStore().list(), platform)); // 채널별 번갈기(2026-09-18)
  console.log(`[숏폼] 작가 배정 — 채널 ${platform ?? '미지정'} · ${w.name}`);
  return { writer: w.name, writerId: w.id, director: shortsActorNames().director };
}
```
호출부 두 곳을 `...assignShortsWriter(platform)` 로. import 에 `recentWriterIdsFor` 추가.
- [ ] **Step 4: 통과 확인** — 위 테스트 + `pnpm tsc --noEmit`.
- [ ] **Step 5: 커밋** — `fix(shorts): 작가 배정을 채널별로 번갈기 — 한 글의 두 편이 같은 순간 파생돼 채널마다 목소리가 굳던 것`

---

### Task 2: §4-2·§4-3 이야기형 지침 — 추정 보존·kind 요구 완화

**Files:**
- Modify: `src/content/shortsGenre.ts` (LORE.conclusion 문장 추가, `GenreGuide.kindRule` 필드)
- Modify: `src/orchestrator/shorts.ts:875` ("본문 씬 중 최소 1개는 반드시 kind …" 줄을 `guide.kindRule` 로)
- Test: `src/content/shortsGenre.test.ts`

**Interfaces:**
- `GenreGuide` += `readonly kindRule: string`. HOWTO.kindRule = 기존 875줄 문자열 그대로. LORE.kindRule = 아래.

- [ ] **Step 1: 실패 테스트**

```ts
it('이야기형은 원문의 추정을 단정으로 바꾸지 말라고 하고(회화나무 실측), kind 를 억지로 붙이지 않는다', () => {
  const l = genreGuide('lore');
  expect(l.conclusion).toContain('추정으로 쓴 문장');
  expect(l.conclusion).toContain('원문이 이유로 명시한');
  expect(l.kindRule).toContain('억지로 kind 를 붙이지 마라');
  expect(l.kindRule).not.toContain('최소 1개는 반드시');
  expect(genreGuide('howto').kindRule).toContain('최소 1개는 반드시 kind');
});
```
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — LORE.conclusion 끝에 추가: `' 원문이 추정으로 쓴 문장("~겠죠", "~로 봅니다", "~에서 찾습니다")은 대본·takeaways 에서도 추정으로 두고("~라고 봐요", "~일지도"), 원문이 이유로 명시한 사실을 우선하라 — 추정을 화면 결론으로 굳히지 마라.'` LORE.kindRule: `'  이야기형은 억지로 kind 를 붙이지 마라 — 연도·수령·그루 수처럼 단위가 있는 숫자만 "stat", 옛 기록·시구를 원문 문장 그대로 인용할 때만 "quote", 이름·전승이 셋 이상 나열될 때만 "list". 해당이 없으면 본문 씬 전부 kind 없이 배경+자막으로 간다(숫자 "1자" 같은 억지 stat 금지 — 실측).'`. HOWTO.kindRule = 875줄 문자열 이동. shorts.ts 875줄을 `guide.kindRule,` 로.
- [ ] **Step 4: 통과** — `pnpm vitest run src/content/shortsGenre.test.ts` + tsc.
- [ ] **Step 5: 커밋** — `fix(shorts): 이야기형 대본은 원문 추정을 단정으로 굳히지 않고 kind 를 억지로 붙이지 않는다`

---

### Task 3: §4-1 감량 뒤 재검산

**Files:**
- Modify: `src/orchestrator/shorts.ts` — `fitShortsPlanToDuration` 프롬프트(`:720-731`), `runShortsJob` 의 fit 직후(`:1673-1676`)
- Modify: `src/content/styleLint.ts` (`hookLengthIssues` 는 Task 4 에서 만든다 — 이 태스크는 그것 없이 시작하고, Task 4 뒤 재검산 목록에 편입한다)
- Test: `src/orchestrator/shorts.test.ts` (없으면 생성) — 순수 `compressionRelintProbs`

**Interfaces:**
- Produces: `compressionRelintProbs(scenes: Array<{ narration: string }>, keyword?: string): string[]` — `narrationStyleIssues` + `hookKeywordLeadIssues` (Task 4 뒤 `hookLengthIssues` 추가). 순수, export.
- `runShortsJob`: `fit.compressed` 면 `const probs = [...compressionRelintProbs(plan.scenes, short.keyword), ...(await standaloneIssues(...)).slice(0, 3)]` → 있으면 `callRoleJSON` 수정 1회(기존 수정 라운드와 같은 sys/user 골격, 단 사용자 프롬프트에 `[예산] 모든 씬 내레이션 합계 ${budget}자 이내를 반드시 지켜라` 추가) → 결과가 예산 초과면 `trimPlanToBudget(plan, budget, CONFIG.shortsScenes).plan`. 로그 `감량 뒤 검산 — N건 → 수정` / `감량 뒤 검산 — 이상 없음`.

- [ ] **Step 1: 실패 테스트**

```ts
// src/orchestrator/shorts.test.ts
import { describe, it, expect } from 'vitest';
import { compressionRelintProbs } from './shorts';
describe('compressionRelintProbs — 감량 뒤 결정적 재검산(2026-09-18)', () => {
  it('훅 키워드 낭독·질문+반전 공식을 다시 잡는다', () => {
    const probs = compressionRelintProbs([{ narration: '회화나무 심는 법 보셨나요? 정작 뿌리가 문제죠.' }, { narration: '둘째 씬이에요.' }], '회화나무');
    expect(probs.some((p) => p.includes('키워드'))).toBe(true);
  });
  it('깨끗한 대본은 빈 배열', () => {
    expect(compressionRelintProbs([{ narration: '가위 든 손이 멈추는 가지, 꼭 하나씩 있죠.' }, { narration: '그 가지는 대개 웃자란 쪽이에요.' }])).toEqual([]);
  });
});
```
(shorts.ts 를 import 하면 무거운 의존이 딸려 온다 — 테스트가 import 만으로 실패하면 `compressionRelintProbs` 를 `src/content/styleLint.ts` 로 옮기고 거기서 export 한다. 어느 쪽이든 순수.)
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 감량 프롬프트 규칙 줄에 추가: `'마지막 씬(CTA)·결론 카드가 되받는 앞 씬의 사물·이름·근거(예: 결론이 "옹이부터 보라"면 옹이가 처음 나오는 문장)는 지우지 마라 — 지우면 결론이 허공에 뜬다(실측).'` 배선은 Interfaces 대로. `standaloneIssues` 호출 인자는 planShorts 안의 호출(`:978-980`)과 같은 꼴(sourceCore 는 없으면 undefined).
- [ ] **Step 4: 통과** — 테스트 + tsc.
- [ ] **Step 5: 커밋** — `fix(shorts): 감량 뒤 검산 재실행 — 감량이 CTA 가 되받는 근거를 지우던 것(회화나무 옹이)`

---

### Task 4: §2 훅 문형 명시·20자 한 문장·길이 린트

**Files:**
- Modify: `src/content/styleLint.ts` (`hookLengthIssues`)
- Modify: `src/orchestrator/shorts.ts:830, 836, 853(훅·CTA 문장 규칙), 996(probs)`; Task 3 의 `compressionRelintProbs` 에 편입
- Test: `src/content/styleLint.test.ts`

**Interfaces:**
- Produces: `hookLengthIssues(narrations: string[], max = 24): string[]` — 훅(첫 씬) 공백 제거 글자 수가 `max` 초과 또는 문장 종결 부호(`[.!?…]`)가 2개 이상이면 `['항목1: 훅이 N자·M문장 — 20자 이내 한 문장으로 줄여라(첫 2초가 이탈을 정한다)']`.

- [ ] **Step 1: 실패 테스트**

```ts
describe('hookLengthIssues — 훅 20자 한 문장(2026-09-18)', () => {
  it('24자 초과면 지적', () => {
    expect(hookLengthIssues(['올리브 화분 들였는데 잎이 자꾸 떨어진다면요. 원인은 물보다 묘목 고를 때부터 있었어요.'])).toHaveLength(1);
  });
  it('두 문장이면 지적', () => {
    expect(hookLengthIssues(['삽부터 들면 못 버텨요. 순서가 틀렸거든요.'])).toHaveLength(1);
  });
  it('20자 한 문장은 통과', () => {
    expect(hookLengthIssues(['블루베리 색, 반은 거짓말이에요.'])).toEqual([]);
    expect(hookLengthIssues([])).toEqual([]);
  });
});
```
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 린트는 Interfaces 대로. 프롬프트:
  - 830: `씬1=훅(3패턴 중 택1)` → `씬1=훅 — 유형은 ① 장면 지목(청자가 지금 겪는 한 장면: 가위 앞에서 멈춘 손, 옆집 창, 콩알 열매) ② 단정 선언 ③ 숫자 제시. ①이 기본값이다(인스타 상위 8편 중 5편이 ①, 실측 2026-09-18). [최근 숏폼의 훅] 목록에 ①이 연달아 있으면 ②③으로.`
  - 853 의 `훅·CTA 씬은 1~2문장(20~40자)` → `훅 씬은 20자 이내 한 문장(첫 2초 — 초과분은 코드가 되돌려 보낸다). CTA 씬은 1~2문장(20~40자)`.
  - 996: `...hookLengthIssues(plan.scenes.map((s) => s.narration)).slice(0, 1),`
  - Task 3 의 `compressionRelintProbs` 에 `hookLengthIssues` 추가.
- [ ] **Step 4: 통과** — 테스트 + tsc.
- [ ] **Step 5: 커밋** — `feat(shorts): 훅은 장면 지목 기본·20자 한 문장 — 허공 참조 "3패턴" 정리, 길이 린트`

---

### Task 5: §2 C 훅 낭독 — 표현 폭·첫 구절 쉼

**Files:**
- Modify: `src/config.ts` (`shortsHookVoice: envBool('SHORTS_HOOK_VOICE', true)`)
- Modify: `src/voice/tts.ts` (`injectHookBreak`, synthesize/synthesizeElevenLabs 에 `hookBreak?: boolean`)
- Modify: `src/tools/shortsCommon.ts` (`hookVoiceSettings`, `prepareScenes` index 0 적용)
- Test: `src/voice/tts.test.ts`(있으면 추가, 없으면 생성), `src/tools/shortsCommon.test.ts`

**Interfaces:**
- `injectHookBreak(text: string): string` — 이미 `<break` 가 있으면 그대로. 첫 쉼표가 있으면 `injectPauseBreaks` 와 같은 자리에 `0.4s`(쉼표 뒤), 없으면 첫 어절(공백) 뒤에 `<break time="0.4s" /> `. 어절이 하나면 그대로.
- `hookVoiceSettings(base: Record<string, number> | undefined): Record<string, number>` — `{ ...base, stability: max(0.2, (base.stability ?? 0.5) - 0.1), style: min(0.6, (base.style ?? 0) + 0.15) }`.
- `prepareScenes`: `i === 0 && CONFIG.shortsHookVoice` 면 `elevenVoiceSettings: hookVoiceSettings(opts.elevenVoiceSettings)`, `hookBreak: true`(pauseBreaks 대신). `synthesizeElevenLabs`: `text: opts.hookBreak ? injectHookBreak(text) : (opts.pauseBreaks ? injectPauseBreaks(text) : text)`.

- [ ] **Step 1: 실패 테스트**

```ts
// tts.test.ts
describe('injectHookBreak — 훅 첫 구절 뒤 쉼(2026-09-18)', () => {
  it('쉼표가 없으면 첫 어절 뒤', () => {
    expect(injectHookBreak('가위 든 손이 멈추는 가지, 꼭 하나씩 있죠.')).toBe('가위 든 손이 멈추는 가지, <break time="0.4s" /> 꼭 하나씩 있죠.');
    expect(injectHookBreak('블루베리 색 반은 거짓말이에요.')).toBe('블루베리 <break time="0.4s" /> 색 반은 거짓말이에요.');
  });
  it('이미 break 가 있거나 어절이 하나면 그대로', () => {
    expect(injectHookBreak('잠깐, <break time="0.2s" /> 멈춰요')).toContain('0.2s');
    expect(injectHookBreak('잠깐')).toBe('잠깐');
  });
});
// shortsCommon.test.ts
describe('hookVoiceSettings', () => {
  it('stability -0.1(하한 0.2), style +0.15(상한 0.6)', () => {
    expect(hookVoiceSettings({ stability: 0.5, similarity_boost: 0.75 })).toEqual({ stability: 0.4, similarity_boost: 0.75, style: 0.15 });
    expect(hookVoiceSettings({ stability: 0.25, style: 0.5 })).toEqual({ stability: 0.2, style: 0.6 });
    expect(hookVoiceSettings(undefined)).toEqual({ stability: 0.4, style: 0.15 });
  });
});
```
- [ ] **Step 2: 실패 확인.** — [ ] **Step 3: 구현**(Interfaces). 부동소수 비교는 `toBeCloseTo` 로 바꿔도 된다. — [ ] **Step 4: 통과 + tsc.**
- [ ] **Step 5: 커밋** — `feat(shorts): 훅 씬 낭독 — 표현 폭 키우고 첫 구절 뒤 0.4초 쉼(SHORTS_HOOK_VOICE)`

---

### Task 6: §1 훅 씬 실촬영 우선 + 훅 이미지 지침

**Files:**
- Modify: `src/config.ts` (`shortsHookFootage: envBool('SHORTS_HOOK_FOOTAGE', true)`)
- Modify: `src/content/userAssets.ts` (`planVideoSegments` opts.hookFirst, `planAssetScenes` opts.hookFirst)
- Modify: `src/orchestrator/shortsMediaBrief.ts:170-171` (프롬프트), 새 export `clipMidFrame(file, seconds, outDir, signal)` (= `speciesRefFrame` 골격, 파일명 `hook-frame.jpg`)
- Modify: `src/orchestrator/shorts.ts` — `planVideoSegments(... , { mustUse: true, hookFirst: CONFIG.shortsHookFootage })`, `planAssetScenes(..., { hookFirst: CONFIG.shortsHookFootage && !videoPlan.some(Boolean) })`(사진은 영상이 하나도 없을 때만 훅 예약 — 순서상 videoPlan 을 먼저 계산해야 하면 호출 순서를 바꾼다: 영상 배정 → 사진 배정), 썸네일 `hook` 도출(`:1442`, `:347`)을 헬퍼 `hookStillFor(images, clips, dir, signal)` 로 — `images[0]` 없고 `clips[0]` 있으면 `clipMidFrame`; `designScenes` 훅 이미지 지침 한 줄
- Test: `src/content/userAssets.test.ts`

**Interfaces:**
- `planVideoSegments(videos, sceneSeconds, prefer, opts: { mustUse?: boolean; hookFirst?: boolean })` — `hookFirst` 면 (0) 단계 전에: `prefer` 가 씬0에 준 클립이 있고 `fits` 면 씬0에 배치; 없으면 `fits(v, sceneSeconds[0])` 인 클립 중 가장 긴 것을 씬0에. 이후 종전 규칙(씬0은 claimed 라 자연히 제외). `hookFirst` false 면 종전과 동일(세 필터 유지).
- `planAssetScenes(assets, sceneCount, order?, opts?: { hookFirst?: boolean })` — `hookFirst` 면 `seq` 앞에 0을 끼운다(중복 제거).
- `assignMediaToScenes` 프롬프트 170-171: `'씬1(훅)에는 첫 2초에 손이 멈추게 하는 영상(움직임·클로즈업)을 우선 배정하라 — 첫 화면이 실사면 채널 인상이 달라진다(2026-09-18).'`, 171 의 `(씬1 제외)` 삭제. 단 `CONFIG.shortsHookFootage` off 면 종전 문구(함수에 `hookFirst` 인자 추가).

- [ ] **Step 1: 실패 테스트**

```ts
describe('planVideoSegments hookFirst(2026-09-18)', () => {
  const secs = [3.5, 6, 6, 6, 4];
  it('hookFirst 면 씬0이 먼저 받는다 — 배정된 클립이 있으면 그것, 없으면 가장 긴 클립', () => {
    const v = [{ path: 'a.mp4', seconds: 7 }, { path: 'b.mp4', seconds: 12 }];
    const out = planVideoSegments(v, secs, new Map([['a.mp4', 0]]), { hookFirst: true });
    expect(out[0]?.path).toBe('a.mp4');
    const out2 = planVideoSegments(v, secs, new Map(), { hookFirst: true });
    expect(out2[0]?.path).toBe('b.mp4');
  });
  it('hookFirst 가 없으면 종전 — 씬0은 비운다', () => {
    const v = [{ path: 'a.mp4', seconds: 7 }];
    expect(planVideoSegments(v, secs, new Map([['a.mp4', 0]]))[0]).toBeNull();
  });
  it('훅 길이에 못 미치는 클립은 훅에 안 넣는다', () => {
    const v = [{ path: 'a.mp4', seconds: 1 }];
    expect(planVideoSegments(v, [3.5, 6], new Map(), { hookFirst: true })[0]).toBeNull();
  });
});
describe('planAssetScenes hookFirst', () => {
  it('내용 배정이 씬2·3이어도 씬0을 먼저 준다', () => {
    const out = planAssetScenes(['p1', 'p2', 'p3'], 5, [2, 3, 0, 1, 4], { hookFirst: true });
    expect(out[0]).toBe('p1');
    expect(planAssetScenes(['p1', 'p2', 'p3'], 5, [2, 3, 0, 1, 4])[0]).toBeNull(); // 종전: cap 3 이라 0은 못 받음? → 실제 종전 결과를 먼저 찍어 보고 고정
  });
});
```
(마지막 기대값은 구현 전에 `npx tsx -e` 로 종전 결과를 찍어 고정한다 — 종전 동작 불변이 목적.)
- [ ] **Step 2: 실패 확인.** — [ ] **Step 3: 구현**(Interfaces). `hookStillFor` 는 `shorts.ts` 안의 두 썸네일 호출부에서 공용. `designScenes` 에 `'씬1(훅)은 첫 2초에 스와이프를 멈추게 하는 화면 — 대비가 큰 클로즈업(가위 앞에서 멈춘 손, 잎 한 장, 열매 단면, 상처 난 줄기). 넓은 풍경·정면 나무 전경·글자 금지.'`(이야기형은 Task 이전의 `sceneGenreGuide` 가 앞에 있으니 그 뒤에 두고 "이야기형은 위 지침이 우선" 한 구절).
- [ ] **Step 4: 통과 + tsc.** — [ ] **Step 5: 커밋** — `feat(shorts): 훅 씬에 실촬영 우선 — 씬0 제외 필터를 옵션화, 썸네일은 클립 중간 프레임(SHORTS_HOOK_FOOTAGE)`

---

### Task 7: §3-1 구절 자막

**Files:**
- Modify: `src/config.ts` (`shortsCaptions: envBool('SHORTS_CAPTIONS', true)`)
- Modify: `src/tools/shortsCommon.ts` (`splitPhrases`, `captionsFor`, `PreparedScene.captions?`, `prepareScenes` 채움, `buildSrt` 구절 옵션)
- Modify: `src/tools/shortsRenderRemotion.ts` (`captions` 프롭 통과)
- Modify: `remotion/AutoShorts.tsx` (스키마 `captions`, Scene 에 `<PhraseCaption>`), Create: `remotion/PhraseCaption.tsx`
- Test: `src/tools/shortsCommon.test.ts`

**Interfaces:**
- `splitPhrases(narration: string): string[]` — 문장 종결(`[.!?…]`)·쉼표·접속 어미(`고 `, `면 `, `는데 `, `지만 `) 경계로 나누되 각 구절 4~14자, 짧은 조각은 앞 구절에 붙인다. 공백 정리.
- `captionsFor(narration: string, durationInFrames: number, fps = FPS, tailPadSec = TAIL_PAD_SEC): Array<{ text: string; startFrame: number; endFrame: number }>` — 낭독 구간 = `durationInFrames - tailPadSec*fps`(하한 1), 구절 글자 수 비례로 나눔, 마지막 구절은 씬 끝까지.
- `PreparedScene.captions?: Caption[]` — `CONFIG.shortsCaptions` 일 때 채움.
- AutoShorts 스키마 `captions: z.array(z.object({ text: z.string(), startFrame: z.number(), endFrame: z.number() })).optional()`. `PhraseCaption`: `useCurrentFrame()` 으로 현재 구절 하나를 하단(bottomPct)에 띄우고 구절 시작마다 단어 스태거 리셋(`captionWordStyle(motion, f - startFrame, fps, i)`); 기존 `KineticCaption`(screenText 라벨)은 `captions` 가 있으면 라벨을 위쪽(`bottomPct + 9`)으로 올린다. 훅 씬은 종전(라벨만, 노란색) 유지 — 훅 자막 = screenText.
- `buildSrt(scenes)` — `captions` 가 있는 씬은 구절별 항목.

- [ ] **Step 1: 실패 테스트**

```ts
describe('splitPhrases / captionsFor — 구절 자막(2026-09-18)', () => {
  it('문장·쉼표·접속 경계로 4~14자 구절', () => {
    const p = splitPhrases('가위 든 손이 멈추는 가지, 꼭 하나씩 있죠. 그 가지는 대개 웃자란 쪽이에요.');
    expect(p).toEqual(['가위 든 손이 멈추는 가지,', '꼭 하나씩 있죠.', '그 가지는 대개', '웃자란 쪽이에요.']);
  });
  it('짧은 조각은 앞에 붙는다', () => {
    expect(splitPhrases('잠깐, 멈춰요.')).toEqual(['잠깐, 멈춰요.']);
  });
  it('글자 수 비례 타이밍, 마지막 구절은 씬 끝까지', () => {
    const c = captionsFor('가위 든 손이 멈추는 가지, 꼭 하나씩 있죠.', 150, 30, 0.6);
    expect(c[0]!.startFrame).toBe(0);
    expect(c[c.length - 1]!.endFrame).toBe(150);
    expect(c.every((x, i) => i === 0 || x.startFrame === c[i - 1]!.endFrame)).toBe(true);
  });
  it('빈 내레이션은 빈 배열', () => { expect(captionsFor('', 60)).toEqual([]); });
});
```
- [ ] **Step 2: 실패 확인.** — [ ] **Step 3: 구현**(Interfaces; 구절 분할 기대값이 구현과 어긋나면 기대값이 아니라 분할 규칙을 스펙(4~14자, 경계 우선순위 문장>쉼표>접속)에 맞춰 조정하고 그 이유를 보고서에 적는다). — [ ] **Step 4: 통과 + `pnpm typecheck`(remotion 포함).**
- [ ] **Step 5: 커밋** — `feat(shorts): 구절 자막 — 내레이션을 글자 수 비례 타이밍으로 하단에 띄운다(무음 자동재생 대응, SHORTS_CAPTIONS)`

---

### Task 8: §3-2 결론 예고 카드

**Files:**
- Modify: `src/config.ts` (`shortsTeaser: envBool('SHORTS_TEASER', true)`)
- Modify: `src/tools/shortsCommon.ts` (`teaserFor(scenes)`, `ShortsScene.teaser?: string`)
- Modify: `src/orchestrator/shorts.ts` (plan.json 쓰기 직전 `plan.scenes[1].teaser = teaserFor(plan.scenes)` — `CONFIG.shortsTeaser` 일 때)
- Modify: `src/tools/shortsRenderRemotion.ts` (`teaser` 통과), `remotion/AutoShorts.tsx` (스키마 `teaser: z.string().optional()`, Scene 에 `<TeaserCard>`), Create: `remotion/TeaserCard.tsx`
- Test: `src/tools/shortsCommon.test.ts`

**Interfaces:**
- `teaserFor(scenes: ReadonlyArray<{ kind?: string; takeaways?: Array<{ when: string; then: string }> }>): string | undefined` — CTA 씬의 첫 takeaway `when`(12자 이내로 자름), 없으면 undefined. 씬이 2개 이하면 undefined.
- `TeaserCard`: 씬 첫 45프레임 동안 상단 오른쪽 작은 카드 `끝에 나오는 것 · {teaser} → ?`(popIn 12프레임, 마지막 8프레임 페이드아웃). 라벨·구절 자막과 겹치지 않게 상단 22% 지점.

- [ ] **Step 1: 실패 테스트**

```ts
describe('teaserFor — 결론 예고(2026-09-18)', () => {
  it('CTA takeaways 의 첫 조건만, 답은 안 준다', () => {
    expect(teaserFor([{ kind: 'hook' }, {}, {}, { kind: 'cta', takeaways: [{ when: '허리 높이', then: '회양목' }] }])).toBe('허리 높이');
  });
  it('takeaways 없거나 씬이 2개 이하면 undefined', () => {
    expect(teaserFor([{ kind: 'hook' }, {}, { kind: 'cta' }])).toBeUndefined();
    expect(teaserFor([{ kind: 'hook' }, { kind: 'cta', takeaways: [{ when: 'a', then: 'b' }] }])).toBeUndefined();
  });
  it('12자로 자른다', () => {
    expect(teaserFor([{}, {}, {}, { kind: 'cta', takeaways: [{ when: '가나다라마바사아자차카타파하', then: 'x' }] }])).toHaveLength(12);
  });
});
```
- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 + typecheck.**
- [ ] **Step 5: 커밋** — `feat(shorts): 씬2 결론 예고 카드 — 끝에 나올 조건만 보여 주고 답은 감춘다(SHORTS_TEASER)`

---

### Task 9: §3-3 중간 컷

**Files:**
- Modify: `src/config.ts` (`shortsMidcut: envBool('SHORTS_MIDCUT', true)`)
- Modify: `src/tools/shortsCommon.ts` (`midcutAt(durationInFrames, fps = FPS, minSec = 5): number | undefined` — 씬이 `minSec` 초 초과면 중간 프레임, 아니면 undefined)
- Modify: `src/tools/shortsRenderRemotion.ts` (`cutAtFrame` 통과; 여분 클립 `videoSrc2` — `opts.clips` 에 없고 `opts.spareClips?: string[]` 로 받은 실촬영 중 씬 길이 절반을 `MIN_CLIP_COVERAGE` 로 덮는 것; 없으면 생략)
- Modify: `src/orchestrator/shorts.ts` (`spareClips`: `planVideoSegments` 가 안 쓴 `userVideoFiles` — `videoPlan` 에 없는 파일)
- Modify: `remotion/AutoShorts.tsx` 스키마 `cutAtFrame: z.number().optional()`, `videoSrc2: z.string().nullable().optional()`, `clipFrames2`; `remotion/KenBurnsImage.tsx` — `cutAtFrame` 이 있으면 그 프레임부터 `index + 7`(다른 팬 궤도)·`scale 1.25 기준` 으로 새로 시작(local frame 을 `f - cutAtFrame` 으로), 그 프레임에 `CutFlash` 는 안 붙인다(빛샘은 씬 경계 전용). 클립 씬은 `videoSrc2` 가 있을 때만 두 번째 `<Video>` 로 교체(`Sequence from={cutAtFrame}`).
- Test: `src/tools/shortsCommon.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
describe('midcutAt — 5초 넘는 씬은 중간에 컷(2026-09-18)', () => {
  it('5초 이하는 없음, 초과면 중간 프레임', () => {
    expect(midcutAt(150, 30)).toBeUndefined();
    expect(midcutAt(151, 30)).toBe(76);
    expect(midcutAt(240, 30)).toBe(120);
  });
});
```
- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 + typecheck.** `CONFIG.shortsMidcut` off 면 `cutAtFrame` 을 아예 안 넣는다.
- [ ] **Step 5: 커밋** — `feat(shorts): 5초 넘는 씬은 중간에 다른 크롭으로 점프컷, 여분 클립이 있으면 클립 교체(SHORTS_MIDCUT)`

---

### Task 10: §5 판정 스크립트 + .env 문서

**Files:**
- Create: `scripts/shorts_hook_report.ts`
- Modify: `.env`(git-ignored — 커밋 금지) 주석 블록: `# 숏폼 첫 2초·리듬(2026-09-18) — SHORTS_HOOK_FOOTAGE=on SHORTS_HOOK_VOICE=on SHORTS_CAPTIONS=on SHORTS_TEASER=on SHORTS_MIDCUT=on`

**Interfaces:** `TZ=Asia/Seoul npx tsx scripts/shorts_hook_report.ts [--since 2026-09-18]` — `shortsStore().list()` 중 `youtubeTs` 있는 편을 구간(배포 전 30일 / since 이후)으로 나눠: 편수, 훅 글자 수 중앙(`plan.json` scenes[0].narration 공백 제거), 훅 실촬영 비율(`clips/sources.json` 에 scene 1), 인스타 72h+ 조회 중앙(`meta:ig` 최신 views, `metaPublishedTs` 기준 72h 경과), 공유≥3 비율(`meta:ig` shares), 유튜브 시청비율 중앙(`youtube:analytics` avgViewPct). 표본 0이면 `-`.

- [ ] **Step 1: 스크립트 작성** (`scripts/rotation_report.ts` 의 골격·import 방식을 따른다).
- [ ] **Step 2: 실행** — `TZ=Asia/Seoul npx tsx scripts/shorts_hook_report.ts` 가 두 구간 표를 찍는다(배포 후 구간은 0편이어도 헤더는 나온다). 기준선 숫자(배포 전 30일)를 보고서에 옮긴다.
- [ ] **Step 3: 커밋** — `chore(scripts): 숏폼 첫 2초 판정 리포트 — 훅 글자 수·실촬영·인스타 72h 조회·공유·유튜브 시청비율`

---

### Task 11: 검증 — 전체 테스트·타입·실제 파생 1편

**Files:** 없음(검증만). 보고서에 결과.

- [ ] **Step 1:** `pnpm typecheck && pnpm test` — 전부 통과.
- [ ] **Step 2:** 실행 중 런이 없음을 확인(`curl -s http://127.0.0.1:8787/runs`)한 뒤 `launchctl kickstart -k gui/$(id -u)/com.gepa.ai-contents-studio`, 15초 뒤 `/autonomy/status` 응답 확인.
- [ ] **Step 3:** 보관소 영상이 있는 수종의 최근 조각 하나를 골라(`data/pieces/index.json` 에서 `stage: ready`·keyword 가 `data/media` 파일명에 있는 수종) `POST /pieces/:id/shorts {"platform":"youtube"}` 로 1편 파생. `data/shorts/<id>/plan.json` 이 생기면: 훅 글자 수 ≤ 24 · `scenes[1].teaser` 존재 여부 · 로그 `작가 배정 — 채널 youtube` · `실촬영 배정 — … 영상 N씬` 에서 씬1 포함 여부(`clips/sources.json` scene 1) · 렌더 완료 후 `public/` 의 props(`inputProps.json` 또는 로그)에 `captions`·`cutAtFrame` 이 있는지. 발행하지 않는다.
- [ ] **Step 4:** 보고서에 실측 줄 그대로 인용. 어긋나는 항목은 BLOCKED 가 아니라 DONE_WITH_CONCERNS 로 사실대로.

---

## Self-review

- 스펙 §2 → Task 1, §3-1 → Task 6, §3-2 → Task 6(designScenes 줄), §4-1 → Task 4, §4-2 → Task 5, §5-1 → Task 7, §5-2 → Task 8, §5-3 → Task 9, §6-1 → Task 3(+Task 4 편입), §6-2·§6-3 → Task 2, §7 → Task 10, §8 킬스위치 → 각 태스크 config.
- 이름 일치: `recentWriterIdsFor`, `compressionRelintProbs`, `hookLengthIssues`, `injectHookBreak`, `hookVoiceSettings`, `clipMidFrame`, `hookStillFor`, `splitPhrases`, `captionsFor`, `teaserFor`, `midcutAt` — 태스크 간 참조가 이 이름으로만 이뤄진다.
- Task 3 는 Task 4 의 린트를 나중에 편입한다(순서 3→4, 4 에서 3 의 함수에 한 줄 추가). 순서를 바꾸지 않는다.
