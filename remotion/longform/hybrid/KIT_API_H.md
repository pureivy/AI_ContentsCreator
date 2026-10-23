# 혼합(H) 롱폼 정보 카드 키트 — "유리 + 알약" (가로 1920×1080)

숏폼 모션그래픽 정보 카드(흐린 유리 카드 + 알약 줄 + 번호 원 + ✕/✓ + 화살표 + 숫자 강조)를 가로 화면용 Remotion 부품으로 옮긴 키트.
바탕은 그 문장의 **주인공 수종 실촬영 흐림본**(무대가 깐다). 장면은 카드만 놓는다. 문장 하나 = 장면 파일 하나.

## 1. 틀

```tsx
// s003 "심는 시기, 품종, 심은 자리. 이 셋이 11월이 되기 전에 결과를 절반쯤 정해 놓는다고 봅니다."
import React from 'react';
import { useVideoConfig } from 'remotion';
import { CardStage, HStack, InfoList, BigNumber, atFromWords, type FullSceneProps } from './_kit';

const T1 = '심는 시기';   // 화면 글자는 전부 맨 위 상수. 그 문장에 나온 말만(낱말 순서·조합은 바꿔도 되지만 새 낱말 금지).
const T2 = '품종';
const T3 = '심은 자리';
const T4 = '11월';
const T5 = '되기 전에';

export default function Scene({ durationInFrames, words, footage }: FullSceneProps) {
  const { fps } = useVideoConfig();
  const a1 = atFromWords(words, '시기,', fps, 6);
  const a2 = atFromWords(words, '품종,', fps, 30);
  const a3 = atFromWords(words, '자리.', fps, 55);
  const a4 = atFromWords(words, '11월이', fps, 110);
  return (
    <CardStage frames={durationInFrames} footage={footage} layout="row" gap={40}>
      <InfoList items={[T1, T2, T3]} at={[a1, a2, a3]} hiAt={[a1 + 4, a2 + 4, a3 + 4]} hiUntil={a4 - 4} width={900} />
      <BigNumber value={T4} sub={T5} at={a4} width={640} />
    </CardStage>
  );
}
```
- props `{ durationInFrames, words?, footage? }` — `footage` 는 바탕 흐림본. **반드시 `<CardStage frames={durationInFrames} footage={footage}>` 로 감싼다.**
- `CardStage {frames, footage, layout='column'|'row', gap=28, dim?}` — 카드들을 안전 상자(x 90~1830, y 120~860) 가운데에 세로(기본)·가로로 놓는다.

## 2. 화면
- 1920×1080. 아래 y ≥ 886 = 자막 띠(문장이 이미 자막으로 나온다), 왼쪽 위(x<760, y<110) = 장 이름 알약. 카드는 안전 상자 안에만 — 높이 합 740px 이하.
- 카드 하나면 폭 1100~1500, 둘을 나란히(`layout="row"`)면 합 1700 이하. 글자 크기는 부품 기본값(머리글 58, 줄 48~50, 큰 숫자 168~190)이 1080p 에서 읽히는 크기 — 줄이지 않는다.
- 화면을 꽉 채우려 하지 말고, 카드 하나(많아야 둘)로 이 문장의 논리(목록·대비·순서·숫자)를 한눈에.

## 3. 규칙
**글자** — 카드 글자는 **그 문장에 나온 말만**(자막과 같은 말을 통째로 반복하지 말고 핵심 낱말·구를 뽑는다). 새 낱말·요약어·숫자 금지. 숫자는 문장에 나온 숫자만. 글자는 맨 위 상수(`const T1 = '…'`)로 두고 부품 props 로만 넘긴다. 한 글자 덩어리 18자 이하.
**머리글(title)** — 넣을 때도 문장 속 구(예: '추위에 불리한 까닭'). 붙일 말이 없으면 빼도 된다.
**박자** — 줄·칸은 그 말을 하는 순간에 들어온다(`atFromWords(words, 낱말, fps, 기본프레임)`). 첫 카드는 0~12프레임 안에 떠오른다. 마지막 15프레임엔 새로 나타나는 것 없음. 강조(`hiAt`)는 낭독이 짚는 줄을 따라 옮겨 간다.
**색** — 부품이 정한다(포인트 색 = 감 주황빨강 하나, 흰 알약, 흑연 글자). 색·글꼴·그림자를 직접 바꾸지 않는다(`style` 덮어쓰기 금지).
**결정성** — `Math.random`·`Date`·네트워크·이미지·영상 태그·`<filter>`·`<text>` 금지. 모든 움직임은 부품의 `at`·`hiAt` 로.
**그림** — 나무·잎·열매·손을 SVG 로 그리지 않는다(바탕 실촬영이 수종을 보여 준다). 필요하면 부품의 ✕·✓·화살표·번호·막대만.

## 4. 부품 (`./_kit`)
시각은 모두 장면 안 프레임. `cardAt` = 카드가 떠오르는 프레임(기본: 첫 줄 10프레임 전), `until` = 카드가 사라지는 프레임(없으면 끝까지), `width` = 카드 폭(px).

- `InfoList {title?, items, at[], hiAt?[], hiUntil?, numbered=true, size=50, cardAt?, until?, width=1240}` — 번호 원 + 흰 알약 줄(목록·나열). `hiAt[i]` 에 i 번째 줄이 포인트 색으로 짚힌다(다음 줄의 hiAt 에 넘어감, `hiUntil` 에 끔).
- `Compare {title?, no:{label,note?}, ok:{label,note?}, noAt, okAt, dimNo=true, layout='rows'|'side', noMark='✕', okMark='✓', cardAt?, until?, width?}` — ✕ 흰 알약(틀린·불리한 쪽) / ✓ 포인트 색 알약(맞는·유리한 쪽). `side` = 좌우 두 칸 + 가운데 그려지는 화살표(흐름 있는 대비). 두 쪽이 옳고 그름이 아니면 `dimNo={false}` + 기호를 `noMark='·' okMark='·'` 처럼 중립으로.
- `Steps {title?, steps, at[], hiAt?[], hiUntil?, numbered=false, direction='row'|'column', last='plain'|'accent', size=48, cardAt?, until?, width=1500}` — 칸이 그려지는 화살표로 이어진다(순서·단계·상황→행동). 칸 4개 넘거나 글자가 길면 `direction="column"`. `last="accent"` = 마지막 칸(결과·행동)을 포인트 색으로.
- `RangeBar {min, max, axisMax, valueText, minText?, maxText?, label?, at, orient='v'|'h', cardAt?, until?, width?}` — 범위·크기 숫자. 눈금자(0~axisMax) 위에 min~max 구간이 포인트 색으로 그려지고 `valueText`(예: '6~14m')가 크게 튀어나온다. 키·높이는 `orient="v"`. axisMax 는 눈금용(화면에 숫자로 안 나온다).
- `BigNumber {value, label?, sub?, at, size=190, cardAt?, until?, width=860}` — 숫자·시점 하나(예: '11월') 크게 + 그려지는 밑줄. label = 위 짧은 말, sub = 아래 알약.
- `Checklist {title?, items, at[], checkAt?[], marks?: ('ok'|'no')[], size=48, cardAt?, until?, width?}` — 네모 칸에 ✓(또는 ✕)가 그려지는 점검표(기준·확인 항목).
- `Pill {text, at, until?, tone='white'|'accent'|'dim', size=46}` · `CardHead {text, at, variant='pill'|'title', size=58}` · `DrawArrow {at, length=90, dir='right'|'down'}` · `GlassCard {at, until?, width, children}`(빈 유리 카드 — 알약·화살표를 직접 짤 때).
- 묶음: `HStack {gap, align}` · `VStack {gap, align}`.
- 도우미: `atFromWords(words, 낱말, fps, 기본)` · `beat` · `beatInOut` · `enter(f, at, dur)` · `popIn(f, at, dur)` · `clamp`.

## 5. 짜임 고르기
- 셋 이상 나열 → `InfoList`(낭독 따라 강조 이동). 나열 + 시점·숫자 → `layout="row"` 로 `InfoList` + `BigNumber`.
- A 와 B 비교(어린 나무 vs 성목, 흔한 생각 vs 실제) → `Compare`. 시간 흐름이 있는 비교 → `layout="side"`.
- 순서·차례·이어지는 행동 → `Steps`(가로). 조건 → 결과 → `Steps last="accent"`.
- 범위·크기(6~14m, 1~3년생) → `RangeBar` / 숫자 하나 → `BigNumber`.
- 확인할 것들(기준) → `Checklist`.
- 같은 카드 반복 대신 문장의 논리에 맞는 짜임을 고른다. 앞뒤 장면(연필 도해·실촬영)과 이어지게 머리글·강조 순서를 문장 흐름대로.
