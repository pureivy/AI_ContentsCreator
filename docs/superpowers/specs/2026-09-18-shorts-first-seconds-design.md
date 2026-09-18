# 숏폼 첫 2초·리듬·낭독 개편 — 설계 (2026-09-18)

사장님 요청: "유튜브, 인스타 등의 방문자의 시선을 확 끌어 당겨서 이탈이 방지될 수 있게 대본과 영상, 나레이션을
만들어야" + "유튜브·인스타 각각에서 두 사람이 번갈아가면서 해야" + 회화나무 테스트 대본 비평의 고칠 것 1·2·3.
승인: A(첫 2초)·B(리듬)·C(낭독) 전부 + §0 목소리 + §4 비평 1·2·3.

## 1. 실측 전제 (재조사 금지)

- 유튜브 애널리틱스 130편: 시청비율 p10 49 · **p50 75%** · 상위 10%는 100% 초과(반복 재생). 하위권은 7~8월 45~93초 편.
  35초 상한 뒤 최근 편 88%+. 시청비율↔유튜브 조회 0.22, ↔인스타 조회 **0.02**. 이탈은 지금 큰 문제가 아니고, 끝까지
  본다고 퍼지지 않는다. 유튜브 천장(첫 배분 ~1,000)은 훅·영상으로 안 움직인다([[yt-batch-ceiling-ig-slow-seed-diagnosis]]).
  **판정 지표는 인스타 6h 조회 400·공유 3, 72h+ 조회 중앙.**
- 인스타 상위 8편 훅: 5편이 **장면 지목**("가위 든 손이 멈추는 가지, 꼭 하나씩 있죠", "옆집 창이 마당을 내려다봐요",
  "잎은 큰데 열매는 콩알"). 질문형·"~보셨나요? 사실은" 반전 공식은 하위권.
- 최근 40편 중 22편이 실촬영 클립을 썼지만 **훅 씬(씬1)에 실촬영 0편** — `planVideoSegments` 의 `i > 0` 하드 필터 3곳
  (`src/content/userAssets.ts:131,144,159`). 사진은 `orderAssetsByAssignment` 가 내용 매칭 씬을 앞에 두고 cap(⌈n/2⌉)이
  차서 씬0이 밀린다(통계적 배제). 꼬리 있는 경쟁 채널 5곳은 전부 실사.
- 자막: 씬당 `screenText` 15자 라벨 하나가 단어별로 뜨고 끝. 내레이션 전문은 화면에 없다. 인스타는 무음 자동재생.
- 작가 배정 `assignShortsWriter()`(`src/server/main.ts:1266`)가 채널 구분 없이 최근 12편을 봐서 한 글의 두 편이 같은 순간
  파생되면 항상 유튜브=임태윤·인스타=유하린(최근 24편 12:12).
- 감량 `fitShortsPlanToDuration`(`src/orchestrator/shorts.ts:711`)은 `planShorts` **밖**에서, 모든 린트·수정 라운드 **뒤**에
  돌고 그 뒤 검산이 하나도 없다(회화나무 실측: 검산이 지적한 '옹이' 고리를 감량이 다시 지웠다).
- "훅 3패턴 중 택1"(`shorts.ts:830`)은 코드 어디에도 3패턴 정의가 없는 허공 참조.
- TTS: ElevenLabs 씬당 1회, `<break time="0.3s"/>` 주입 지원(`injectPauseBreaks`, 문장·쉼표 경계, 최대 3), 작가별
  `voiceSettings`(stability/similarity/style), `MIN_SCENE_SEC=2.8 + TAIL_PAD 0.6` 균일.
- 렌더: `remotion/AutoShorts.tsx` 씬=`TransitionSeries.Sequence` 1개=배경 1개(KenBurns 정지화 또는 느리게 튼 클립,
  루프 금지). 중간 컷·B롤 개념 없음.

## 2. §0 목소리 번갈기

`assignShortsWriter(platform?: ShortsPlatform)` — `shortsStore().list().filter(x => (x.platform ?? '') === (platform ?? ''))`
의 최근 12편 `writerId` 로 `pickWriter`. 호출부 2곳(`deriveShortsFromPiece`, `shortsCreateHandler`)에 platform 전달.
결과: 유튜브 안에서 임태윤↔유하린, 인스타 안에서 따로. 지금 이력이 서로 반대 위상이라 같은 글의 두 편은 계속 다른
목소리(단일 채널 파생이 끼면 위상이 겹칠 수 있음 — 허용, 채널 안 번갈기가 1순위 요구). 로그 `작가 배정 — 채널 X · 이름`.

## 3. §1 첫 2초 — 화면

### 3-1 훅 씬 실촬영 우선 (`SHORTS_HOOK_FOOTAGE`, 기본 on)
- `planVideoSegments`: 씬0 제외 필터 3곳을 옵션화. on 이면 **씬0을 먼저 채운다** — LLM 배정(`assignMediaToScenes`)이
  씬1에 준 클립이 있으면 그것, 없으면 가장 긴 클립(≥ 훅 씬 길이 추정). 그 다음 종전 규칙으로 나머지 씬.
- `assignMediaToScenes` 프롬프트 170-171 줄 "씬1(훅)에는 영상을 배정하지 마라" → "씬1(훅)에는 첫 2초에 손이 멈추게
  하는 클립(움직임·클로즈업)을 우선 배정하라". 사진 경로 `planAssetScenes`: 영상이 하나도 없고 사진이 있으면 씬0 예약.
- 썸네일: `hookImage` 가 없으면(씬0이 클립) 그 클립의 **중간 프레임**을 뽑아 쓴다(`speciesRefFrame`/`extractFirstFrame`
  패턴, `shorts.ts:1442`·`:347` 두 곳 공용 헬퍼). 실패 시 종전 폴백(다음 씬 정지화 → 영상 프레임).
- 씬0이 클립이면 배경 이미지 생성을 건너뛰는 `covered` 규칙 그대로(비용 증가 0).

### 3-2 훅 씬 이미지 지침 (실촬영 없는 수종)
`designScenes` 에 한 줄: "씬1은 첫 2초에 스와이프를 멈추게 하는 화면 — 대비가 큰 클로즈업(가위 앞에서 멈춘 손, 잎 한 장,
열매 단면, 상처 난 줄기). 넓은 풍경·정면 나무 전경·텍스트 금지." 이야기형은 §1 지침(자리·풍경) 우선.

## 4. §2 첫 2초 — 문장·낭독

### 4-1 훅 문형 (planShorts)
- `씬1=훅(3패턴 중 택1)` → 명시: "씬1=훅. 유형은 ① 장면 지목(청자가 지금 겪는 한 장면 — 손·가위·잎·창) ② 단정 선언
  ③ 숫자 제시. **①을 기본값**으로, 앞 편들이 ①을 연달아 썼으면 ②③으로." 실측 근거 한 줄 첨부.
- 훅 낭독 **20자 이내 한 문장**(종전 "훅·CTA 씬은 1~2문장(20~40자)" 에서 훅만 분리; CTA는 그대로).
- 결정적 린트 `hookLengthIssues(narrations)`(styleLint.ts): 훅 24자 초과 → "항목1: 훅이 N자 — 20자 이내 한 문장으로".
  `probs` 배열에 편입(캡 ≤1).

### 4-2 낭독 (C)
- 훅 씬만 `voiceSettings` 조정: stability −0.1(하한 0.2), style +0.15(상한 0.6, style 없는 작가는 0.15) — `prepareScenes`
  에서 index 0 에 적용(`elevenVoiceSettings` 복제 후 수정). 킬스위치 `SHORTS_HOOK_VOICE`(기본 on).
- 훅 첫 구절 뒤 쉼: `injectPauseBreaks` 는 문장·쉼표 경계에만 넣는다 — 훅이 쉼표 없는 한 문장이면 첫 어절 뒤에
  `<break time="0.4s"/>` 를 넣는 `hookBreak(text)` 를 index 0 에만 적용(ElevenLabs 경로에서만, 종전과 같은 게이트).

## 5. §3 영상 리듬

### 5-1 구절 자막 (`SHORTS_CAPTIONS`, 기본 on)
- `shortsCommon.ts`: `splitPhrases(narration)` — 문장 종결·쉼표·접속 경계로 4~14자 구절, `captionsFor(narration,
  durationInFrames)` 글자 수 비례 시작/끝 프레임(정렬 데이터 없음 — 근사). `PreparedScene.captions`.
- `remotion/AutoShorts.tsx` 스키마 `captions?: [{text,startFrame,endFrame}]`; `KineticCaption.tsx` 가 `useCurrentFrame()`
  으로 현재 구절을 고르고 구절 경계마다 단어 스태거를 리셋. `screenText` 라벨은 유지(상단), 구절 자막은 하단.
- SRT(`buildSrt`)도 같은 구절 경계로.
- off 면 종전(라벨만).

### 5-2 결론 예고 카드 (`SHORTS_TEASER`, 기본 on)
- `plan.scenes[1].teaser = takeaways[0].when` (CTA takeaways 있을 때만; 답 `then` 은 안 보여줌). 씬2 첫 1.5초(~45프레임)
  에 `TakeawayCard` 의 compact 변형: "끝에 나오는 것 · {when} → ?".
- 파일: shorts.ts(plan 조립 뒤), shortsCommon.ts/AutoShorts.tsx 스키마, TakeawayCard.tsx compact, shortsRenderRemotion.ts.

### 5-3 중간 컷 (`SHORTS_MIDCUT`, 기본 on)
- 렌더만: 씬 길이 > 5초면 중간 프레임에서 **같은 배경의 다른 크롭**(1.25× 줌인, 다른 앵커)으로 하드 컷 —
  `KenBurnsImage` 에 `cutAtFrame` + 두 번째 `move`/`anchor`. 클립 씬은 클립이 2개 이상 남아 있을 때만 두 번째 클립으로
  교체(없으면 컷 없음 — 느리게 튼 클립을 자르면 정지 구간이 생긴다). `defaultSceneFx` 에 결정적(seed) 두 번째 앵커.
- `stageAndBuildProps` 에서 여분 클립을 `videoSrc2` 로 스테이징(있을 때만).

## 6. §4 비평 1·2·3

1. **감량 뒤 재검산**: `fitShortsPlanToDuration` 프롬프트에 "마지막 씬(CTA)·결론이 되받는 앞 씬의 사물·이름·근거는
   지우지 마라" 추가. `runShortsJob` 에서 `fit.compressed` 면 `standaloneIssues` + `narrationStyleIssues` +
   `hookKeywordLeadIssues` + `hookLengthIssues` 1회 재실행 → 지적 있으면 **예산(`budget`자) 안에서** 수정 1회(같은
   `callRoleJSON` 수정 라운드 재사용, 프롬프트에 예산 명시). 수정 결과가 예산 초과면 `trimPlanToBudget`. 로그
   `감량 뒤 검산 — N건 → 수정`.
2. **이야기형 추정 보존**: `shortsGenre.ts` LORE.conclusion 에 "원문이 추정으로 쓴 문장('~겠죠', '~로 봅니다',
   '~에서 찾습니다')은 대본·takeaways 에서도 추정으로 두고, 원문이 이유로 명시한 사실을 우선하라" 추가.
3. **이야기형 kind 요구 완화**: `planShorts` 의 "본문 씬 중 최소 1개는 반드시 kind" 줄을 장르별로 — howto 종전,
   lore 는 "이야기형은 억지로 kind 를 붙이지 마라 — 연도·수령·그루 수처럼 단위가 있는 숫자만 stat, 옛 기록·시구
   인용만 quote, 이름·전승 나열만 list. 없으면 배경+자막으로 간다." `genreGuide` 에 `kindRule` 필드 추가.

## 7. §5 판정

`scripts/shorts_hook_report.ts` — 유튜브 게시일 기준 구간별(배포 전 30일 / 배포 후): 편수, 훅 글자 수 중앙, 훅 실촬영
비율(`clips/sources.json` scene 1), 인스타 72h+ 조회 중앙·공유≥3 비율·6h 400 이상 비율(표본이 있을 때), 유튜브
시청비율 중앙. 기준선(09-18): 인스타 목표 글 72h+ 중앙 4,494(n=4) · 유튜브 시청비율 75% · 훅 실촬영 0%.
2주 뒤(10-02) [[ig-axis-experiment]] 재판정과 같이 본다.

## 8. 킬스위치·불변

- `SHORTS_HOOK_FOOTAGE`, `SHORTS_HOOK_VOICE`, `SHORTS_CAPTIONS`, `SHORTS_TEASER`, `SHORTS_MIDCUT` — 전부 기본 on, off 면
  종전 동작. `.env` 주석 블록에 한 줄.
- 발행 경로 불변(릴스 발행은 버튼, 유튜브 자동 업로드는 비공개·옵트인). 이미지 생성 횟수 불변(씬당 1장). 35초 상한 불변.
- 순수 함수는 네트워크·LLM 없이 테스트. Remotion 컴포넌트는 props 계산(프레임 경계·구절 분할)을 순수 함수로 빼서 테스트.

## 9. 하지 않는 것

씬당 이미지 2장 생성(비용 2배) · 강제 정렬(forced alignment) 자막 · 유튜브 천장 대책(검색 매칭은 별건) · 훅 유형별 성적
실시간 되먹임(표본 뒤 §7 로 본다).
