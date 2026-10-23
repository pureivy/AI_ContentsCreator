# 롱폼 시범 1편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 블로그 6편을 엮은 '과실나무 겨울 전정 총정리' 9~11분 가로(1920×1080) mp4 한 편을 만든다.

**Architecture:** 순수 모듈(`src/longform/`)이 원문 수집·대본 검증·영상 구간 배정·타임라인 조립을 맡고, 일회성 스크립트(`scripts/longform/`)가 TTS·ffmpeg 자르기·Remotion 렌더를 실행한다. 새 Remotion 컴포지션 `LongForm`(좌우 분할)을 `Root.tsx`에 추가 등록만 하고 AutoShorts·숏폼 경로는 건드리지 않는다.

**Tech Stack:** TypeScript(tsx), vitest, Remotion(`@remotion/renderer`·`bundler`), ffmpeg/ffprobe, ElevenLabs(`synthesize`), mlx_whisper(`synthesizeChecked`).

**Spec:** `docs/superpowers/specs/2026-10-19-longform-pilot-design.md`

## Global Constraints

- 출력 1920×1080, 30fps, h264, 런타임 540~660초(9~11분) — 런타임이 대본 분량보다 우선.
- 대본 공백 제외 3,800~4,200자에서 시작, 첫 TTS 실측 후 조정. 낭독 속도는 .env 그대로(1.2) — 덮어쓰지 않는다.
- 장 순서·이름: intro, scaffold(주지 3개), maesil, jadu, gam, blueberry, outro. 수종 장(maesil·jadu·blueberry) ~1분, gam ~1분 30초, scaffold ~3분, outro ~2분, intro ~50초.
- 대본 사실은 6편 원문에서만. 원문에 없는 월·날짜·수치 0건(`timingParityIssues`), factGate unsupported·contradicted 0건.
- 'A가 아니라 B' 구문은 대본 전체 3회 이하.
- 수종 장에는 그 수종 영상만(매실 = 매실나무·설중매·설중매나무, 블루베리 = 블루베리·블루베리나무, 자두 = 자두나무, 감 = 감나무). 일반 장(intro·scaffold·outro)은 과실나무 목록 아무거나. 같은 파일의 겹치는 구간 재사용 금지.
- 원본 영상 소리 끔. 배경 음악 없음. AI 그림·I2V 안 씀.
- AutoShorts·`src/tools/`·`src/orchestrator/`·카드 컴포넌트 기본값 수정 금지. `remotion/Root.tsx` 는 등록 추가만.
- 출력 폴더 `data/longform/pilot-2026-10-19/`. 서버 재시작 없음. 커밋은 사장님 요청 시에만.
- 사용자 대상 문구·보고는 한국어.

## Review Focus

- 영상 소스 대부분이 회전 메타(-90/+90) 세로 영상 → 자른 클립이 1080×1920 세로로 나와야 한다(가로로 눕지 않음). Task 4 실측 단계.
- 수종 영상이 장 길이보다 짧을 때 구간 배정이 겹치거나 무한 루프 → 남는 세그먼트는 `card-only` 로 떨어져야 한다. Task 3 테스트.
- TTS 실패·재실행 → 이미 만든 mp3는 재사용(비용 중복 방지). Task 4 캐시 테스트.
- 원문 '9월' 문장이 대본에 남음 → timingParity 로는 안 잡힌다(원문에 9월이 있으므로). 별도 검사. Task 2 테스트.
- 긴 렌더(18,000프레임) 도중 중단 → 백그라운드 실행·로그 파일, 재실행 시 TTS/클립 캐시로 렌더만 다시. Task 6.

---

### Task 1: 원문 수집과 대본 스키마·검증 (순수)

**Files:**
- Create: `src/longform/source.ts`, `src/longform/script.ts`
- Test: `src/longform/script.test.ts`

**Interfaces:**
- Produces:
  - `type ChapterId = 'intro'|'scaffold'|'maesil'|'jadu'|'gam'|'blueberry'|'outro'`
  - `const CHAPTER_ORDER: ChapterId[]`
  - `const CHAPTER_SPECIES: Record<ChapterId, string[] | 'any-fruit'>` — 수종 장은 위 Global Constraints 별칭 목록, 나머지 `'any-fruit'`
  - `const FRUIT_SPECIES: string[]` — 일반 장 허용 목록: 감나무·대추나무·사과나무·미니사과나무·석류나무·배나무·호두나무·매실나무·설중매·설중매나무·모과나무·체리나무·앵두나무·보리수나무·왕보리수나무·왕보리수·살구나무·밤나무·무화과·자두나무·블루베리·블루베리나무·머루나무·으름나무·오디나무·금귤나무·구지뽕나무
  - `type Card = { kind:'list'; header?:string; items:string[] } | { kind:'compare'; left:{label:string; items:string[]}; right:{label:string; items:string[]} } | { kind:'stat'; value:number; unit?:string; label?:string } | { kind:'takeaway'; lines:string[] }`
  - `interface Segment { id:string; narration:string; card?:Card }` (id = `${chapter}-${nn}`)
  - `interface Chapter { id:ChapterId; title:string; segments:Segment[] }`
  - `interface LongformScript { title:string; chapters:Chapter[] }`
  - `loadSources(): Promise<Array<{pieceId:string; title:string; body:string}>>` — `data/pieces/index.json` 의 runId → `data/sessions/<runId>/05_final_content.json` 의 `smarteditor_text.sections` heading+body 이어 붙임. pieceId 6개 순서 고정(spec 원재료 표).
  - `validateScript(s: LongformScript, sourceText: string): string[]` — 문제 목록(빈 배열 = 통과)
  - `scriptChars(s): number` — 낭독 공백 제외 글자 수

- [ ] **Step 1: 실패 테스트 작성** — `script.test.ts`
  - `validateScript` 가 장 순서가 CHAPTER_ORDER 와 다르면 `'장 순서'` 를 포함한 문제를 낸다.
  - 세그먼트 narration 이 90자(공백 포함) 초과면 그 id 를 포함한 문제.
  - narration 에 `9월` 이 들어가면 원문에 있어도 `'9월'` 문제(겨울 편 시기 규칙) — Review Focus.
  - 원문에 없는 `11월` 이 들어가면 timingParity 문제(원문 문자열을 `'잎이 진 뒤 자릅니다'` 로 둔 픽스처).
  - 'A가 아니라 B'(`/가 아니라|이 아니라/`) 4회면 문제, 3회면 통과.
  - `scriptChars` 가 공백을 세지 않는다(`'가 나'` → 2).
- [ ] **Step 2:** `pnpm vitest run src/longform/script.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3:** `source.ts`·`script.ts` 구현. timingParity 는 `timingParityIssues(sourceText, segments.map(s=>({field:s.id,text:s.narration})))` 그대로.
- [ ] **Step 4:** 같은 명령 → PASS. `loadSources()` 를 tsx 한 줄로 돌려 6편·각 1,500자 이상인지 확인.

### Task 2: 대본 작성과 검사 통과

**Files:**
- Create: `data/longform/pilot-2026-10-19/script.json`, `scripts/longform/check.ts`

**Interfaces:**
- Consumes: Task 1 전부, `factGateBlog({model:'sonnet', body, evidence})` (`src/content/factGate.ts:394`)
- Produces: 검사 통과한 `script.json`(LongformScript), `script.txt`(장 제목 + 낭독 평문)

- [ ] **Step 1:** `loadSources()` 출력을 읽고 대본 작성. 원문 문장을 줄여 쓰고, 새 문장은 장 연결·도입·마무리만. 장 3·6은 원문 '낙엽 후' 규칙(블루베리: 늙은 회색 원줄기를 밑동에서 고르기·수형). 잎 달린 영상용 말투 "지금은 잎이 달려 있지만, 잎이 지면 …" 를 intro 와 각 수종 장 첫 문장에서. 수종 장은 영상이 짧으니 세그먼트 절반 이상에 `card`.
- [ ] **Step 2:** `scripts/longform/check.ts` — validateScript + factGateBlog(evidence = 6편 원문 합본) 실행, 문제와 unsupported/contradicted 출력, 0이면 exit 0. `script.txt` 기록.
- [ ] **Step 3:** `pnpm tsx scripts/longform/check.ts` → `문제 0` · `unsupported 0` · `contradicted 0`, 글자 수 3,800~4,200. 실패하면 대본 고쳐 반복.

### Task 3: 영상 구간 배정 (순수)

**Files:**
- Create: `src/longform/footage.ts`
- Test: `src/longform/footage.test.ts`

**Interfaces:**
- Consumes: `CHAPTER_SPECIES`, `FRUIT_SPECIES`, `data/media/index.json` 항목 `{id,file,kind,seconds,species}`
- Produces:
  - `type Shot = { segId:string; mediaId:string; file:string; startSec:number; seconds:number } | { segId:string; cardOnly:true }`
  - `planFootage(segs: Array<{id:string; chapter:ChapterId; seconds:number}>, media: MediaItem[]): Shot[]`

- [ ] **Step 1: 실패 테스트**
  - 수종 장 세그먼트에는 그 수종 별칭 영상만 나온다(자두 장에 감나무 파일 없음).
  - 같은 파일 안 구간은 겹치지 않는다(모든 Shot 쌍의 [start, start+seconds) 교집합 없음).
  - 자두 영상 22초, 자두 세그먼트 5개×8초 → 앞쪽 2개만 영상, 나머지는 `cardOnly` (무한 루프·겹침 없음) — Review Focus.
  - 일반 장은 `FRUIT_SPECIES` 밖(예: 소나무) 파일을 쓰지 않는다.
  - 연속한 두 세그먼트가 같은 파일을 쓰지 않는다(다른 후보가 있을 때).
  - 영상 시작 0.5초·끝 0.5초는 쓰지 않는다(손떨림 여백).
- [ ] **Step 2:** `pnpm vitest run src/longform/footage.test.ts` → FAIL
- [ ] **Step 3:** 구현 — 파일별 사용 커서를 두고, 후보 중 남은 길이가 가장 긴 파일부터(직전 파일 제외) 그 커서에서 자른다. 세그먼트가 영상보다 길면 남은 만큼만 쓰지 말고 다음 후보로; 후보가 없으면 cardOnly.
- [ ] **Step 4:** 같은 명령 → PASS

### Task 4: 낭독·클립 자산 만들기 (캐시)

**Files:**
- Create: `src/longform/timeline.ts`, `scripts/longform/assets.ts`
- Test: `src/longform/timeline.test.ts`

**Interfaces:**
- Consumes: Task 1 스키마, Task 3 `planFootage`, `synthesizeChecked(synth, names)` (`src/voice/ttsCheck.ts:78`), `synthesize(text,{previousText,nextText})`, `splitPhrases` (`src/tools/shortsCommon.ts:323`)
- Produces:
  - `interface TimedSegment { id:string; chapter:ChapterId; narration:string; card?:Card; audio:string; startFrame:number; frames:number; captions:Array<{text:string; startFrame:number; endFrame:number}>; shot:Shot; clip?:string }`
  - `buildTimeline(script, durations: Record<string,number>, fps=30, gapSec=0.35, chapterCardSec=2.5): { segments:TimedSegment[]; chapterStarts:Array<{id:ChapterId; title:string; startFrame:number; frames:number}>; totalFrames:number }`
  - 파일: `audio/<segId>.mp3`, `clips/<segId>.mp4`(1080×1920, 무음), `timeline.json`

- [ ] **Step 1: 실패 테스트** (`timeline.test.ts`)
  - 장마다 장 제목 구간(2.5초=75프레임)이 앞에 오고, 세그먼트 frames = round((오디오초 + 0.35)·30).
  - totalFrames = 모든 장 제목 + 세그먼트 합.
  - 캡션은 세그먼트 안 프레임 범위를 벗어나지 않고 서로 겹치지 않는다.
- [ ] **Step 2:** FAIL 확인 → 구현 → PASS (`pnpm vitest run src/longform/timeline.test.ts`)
- [ ] **Step 3:** `scripts/longform/assets.ts` — 세그먼트마다 `audio/<id>.mp3` 가 있으면 건너뜀(Review Focus: 재실행 비용 0), 없으면 `synthesizeChecked(() => synthesize(narration,{previousText,nextText}), 수종명)`. ffprobe 로 길이 측정 → planFootage → `ffmpeg -ss start -t sec -i file -an -vf scale=1080:1920 -c:v libx264 -crf 18` 로 `clips/<id>.mp4`(있으면 건너뜀) → `timeline.json`.
- [ ] **Step 4:** 먼저 scaffold 장만(`--only scaffold`) 실행해 TTS 실측 → 전체 길이 추정을 출력. 540~660초 밖이면 Task 2로 돌아가 분량 조정.
- [ ] **Step 5:** 전체 실행. 확인: `ffprobe` 로 클립 하나가 `1080x1920` 이고 회전 메타 0 — Review Focus. `timeline.json` totalFrames/30 이 540~660.

### Task 5: Remotion `LongForm` 컴포지션

**Files:**
- Create: `remotion/LongForm.tsx`, `remotion/longform/SplitScene.tsx`, `remotion/longform/ChapterCard.tsx`, `remotion/longform/InfoPanel.tsx`
- Modify: `remotion/Root.tsx` — `<>…</>` 로 감싸 `LongForm` Composition 추가(1920×1080, 30fps, `calculateMetadata` 로 totalFrames). AutoShorts 블록은 그대로.

**Interfaces:**
- Consumes: `timeline.json` 형태(Task 4) — props `{ segments: TimedSegment[](파일명은 staticFile 용 bare name), chapterStarts, totalFrames, title:string }`
- Produces: Composition id `LongForm`

배치(빌더 재량이지만 기본값): 왼쪽 세로 영상 패널 폭 608(높이 1080, OffthreadVideo muted, 클립이 세그먼트보다 짧으면 playbackRate 로 늘림), 오른쪽 1312 정보 영역 — 상단 장 이름(작게), 가운데 카드(있을 때), 하단 구절 자막(현재 구절 크게). `cardOnly` 세그먼트는 카드 전체 화면(배경은 직전 클립 마지막 프레임 흐림 또는 단색). 장 제목 카드는 전체 화면 2.5초. 카드는 기존 컴포넌트를 쓰지 말고 가로 정보 영역 전용으로 `InfoPanel` 안에 새로 그린다(기존 기본값 수정 금지 제약).

- [ ] **Step 1:** 구현 후 `npx tsc -p remotion/tsconfig.json --noEmit` → 오류 0.
- [ ] **Step 2:** `npx remotion still remotion/index.ts LongForm out.png --props=data/longform/pilot-2026-10-19/props.json --frame=N` 로 장 제목·분할 장면·cardOnly 장면 3장 뽑아 눈으로 확인(글자 잘림·겹침 없음, 영상이 세로로 서 있음). 스틸은 출력 폴더 `stills/` 에.
- [ ] **Step 3:** `pnpm test` → 기존 테스트 전부 PASS(AutoShorts 무영향).

### Task 6: 렌더와 결과물

**Files:**
- Create: `scripts/longform/render.ts`

**Interfaces:**
- Consumes: `RENDER_OPTS` (`src/tools/shortsRenderRemotion.ts:21`), Task 4 timeline, Task 5 composition
- Produces: `final.mp4`, `subtitles.srt`, `footage.json`, `report.md`

- [ ] **Step 1:** render.ts — 출력 폴더 `remotion/public` 에 audio·clips 스테이징 → `props.json` → bundle → selectComposition('LongForm') → renderMedia(h264, RENDER_OPTS, 진행률 로그) → `final.mp4`. srt 는 캡션에서, footage.json 은 Shot 목록, report.md 는 단계별 소요 시간·ElevenLabs 글자 수·factGate 호출 수·렌더 시간.
- [ ] **Step 2:** 백그라운드 실행(`run_in_background`), 로그는 출력 폴더 `render.log`. 끊기면 다시 실행 — TTS·클립은 캐시.
- [ ] **Step 3:** 검증: `ffprobe` → 1920x1080, 30fps, 길이 540~660초, 오디오 트랙 있음. 1분 간격 프레임 10장 뽑아 확인(검은 화면·눕힌 영상·잘린 글자 없음). `script.txt` 와 낭독 일부 대조(STT 한 구간).
- [ ] **Step 4:** 독립 검토(verifier 에이전트) — spec 의 반목표 5개 대조. 통과 뒤 사장님께 mp4 전달(SendUserFile)과 report.md 요약.
