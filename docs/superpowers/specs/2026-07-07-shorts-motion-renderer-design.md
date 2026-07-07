# 쇼츠 모션그래픽 렌더러 설계 — 정지 슬라이드쇼 → 데이터 주도 모션(라이선스-프리)

- 날짜: 2026-07-07
- 상태: 설계 승인됨(브레인스토밍), 스펙 리뷰 대기
- 대상 코드베이스: AI_ContentsCreator (B)

## 1. 목표

B의 쇼츠 렌더러를 현재의 **정지 이미지 + Ken Burns 줌 + Pillow 구운 자막 슬라이드쇼**에서
**데이터 주도 모션그래픽**으로 업그레이드한다. gpt-image 씬 배경은 그대로 유지하고, 그 위에
실제 프레임 단위 모션(키네틱 자막·Ken Burns·씬 전환·프로그레스바, 이후 CountUp/데이터 시각화)을
얹어 역동성을 크게 높인다.

렌더 엔진은 **라이선스-프리**로 간다: Remotion(유료 Company License) 대신 **헤드리스 브라우저
프레임 캡처**(HTML/CSS/JS 무대 + Playwright 스크린샷 → ffmpeg). B는 이미 `naver_publish.py`에서
Playwright를 쓰므로 새 프레임워크·브라우저 의존성이 없다.

원본 도구(GEPA_Workspace-main/03-shorts-generator)의 Remotion·SVG 테마는 이식하지 않는다 —
원본은 영상마다 사람이 손편집하는 수동 도구, 테마는 기관 공고 전용. B는 자율·범용 주제이므로
**데이터 주도(파라미터화) 컴포지션**으로 재설계한다.

## 2. 확정된 결정 (브레인스토밍)

| 결정 | 선택 | 근거 |
|---|---|---|
| 시각 콘텐츠 모델 | gpt-image 배경 + 그 위 모션 | 범용 주제에 강함, 현재 자산 재사용, 빠른 도입 |
| 렌더러 구조 | 모션 렌더러 기본 + ffmpeg 폴백 | B의 무중단 철학, 업그레이드하되 안전망 유지 |
| 렌더 엔진 | **헤드리스 브라우저 DIY** (Playwright 프레임 캡처) | 라이선스-프리, 기존 Playwright 재사용, 웹 애니메이션 표현력 |
| 진행 | Phase 1(스키마 무변경 드롭인)부터 | YAGNI, 기존 파이프라인에 즉시 얹힘 |

## 3. 현재 상태 (기준선)

- 진입점: `renderShortsVideo(dir, scenes, images, opts)` — `src/tools/shortsRender.ts`.
  - `scenes: ShortsScene[]`, `ShortsScene = { narration: string; screenText?: string }`.
  - `images: Array<string | null>` — 씬 배경(gpt-image, 없으면 null → 그라데이션 폴백).
  - 반환: `{ ok, videoPath, srtPath, durationSec, sceneCount, issues }`.
- 잡: `runShortsJob` (`src/orchestrator/shorts.ts`) — `planShorts`(shorts_writer LLM) →
  `designScenes`(shorts_director LLM) → gpt-image 생성 → `renderShortsVideo` 호출(223행 부근).
- Plan 데이터: `{ title, titles[3], scenes[{narration, screenText≤20자}], description, hashtags }`.
- 처리: 씬별 TTS(`synthesize`, OpenAI gpt-4o-mini-tts + macOS say 폴백) → ffprobe 길이 실측 →
  Pillow 프레임(`shorts_frame.py`, 1620×2880) → ffmpeg zoompan 세그먼트 → concat(`-c copy`).
- 출력: 1080×1920 / 30fps / H.264+AAC. 자막은 프레임에 구움(Homebrew ffmpeg drawtext 부재 우회).
- **기존 자산 재사용**: Playwright(Python, `naver_publish.py`), Pillow, ffmpeg/ffprobe, TTS(`voice/tts`).

## 4. 설계

### 4.1 드롭인 렌더러 + 폴백

새 함수 `renderShortsVideoBrowser(dir, scenes, images, opts)`를 **`renderShortsVideo`와 동일
시그니처·반환형**으로 신설(`src/tools/shortsRenderBrowser.ts`).

`runShortsJob`의 렌더 호출을 다음으로 교체:

```
let r = null;
if (CONFIG.shortsRenderer !== 'ffmpeg') {
  try { r = await renderShortsVideoBrowser(dir, plan.scenes, images, opts); } catch { r = null; }
}
if (!r || !r.ok) {
  if (r) say('모션 렌더 실패 → ffmpeg 슬라이드쇼로 폴백');
  r = await renderShortsVideo(dir, plan.scenes, images, opts);  // 기존 경로 유지(무변경)
}
```

- `CONFIG.shortsRenderer`(ENV `SHORTS_RENDERER`, 기본 `browser`, 값 `browser|ffmpeg`)로 강제
  선택 가능(운영·디버깅·테스트).
- 브라우저 렌더가 던지거나 `ok:false`면 조용히 ffmpeg로 폴백 — 사용자에겐 무중단.

### 4.2 공통 전처리 추출

두 렌더러가 공유하는 순수/준순수 로직을 `src/tools/shortsCommon.ts`로 추출(테스트 대상):

- `prepareScenes(dir, scenes, images, opts)` → 씬별 `{ imagePath, audioPath|null, screenText,
  narration, durationSec, durationInFrames }[]` 산출.
  - TTS 합성(실패 시 `audioPath=null`, 무음 진행), ffprobe 길이 실측,
    `dur = max(MIN_SCENE_SEC=2.8, audioDur + TAIL_PAD_SEC=0.6)`, `frames = round(dur×30)`.
  - **"오디오가 길이를 지배" 불변식**(원본 이식) — 두 렌더러 동일.
- `buildSrt(prepared)` → `subtitles.srt` 문자열(현재 로직 이동).
- 상수 공유: `FPS=30, W=1080, H=1920`.

기존 `renderShortsVideo`도 이 공통 함수를 쓰도록 리팩터(동작 불변, 중복 제거).

### 4.3 HTML/CSS/JS 컴포지션 (결정적 seek 무대)

- 위치: `scripts/blog_skills/shorts_stage.html` — 자기완결(인라인 CSS/JS, 외부 요청 없음).
  1080×1920 고정 스테이지.
- **핵심 불변식 — 결정적·seek 가능**: 자유 실행 CSS 애니메이션/`requestAnimationFrame`을 쓰지
  않는다. 전역 `window.seek(globalFrame)` 함수가 **프레임 번호만으로** 모든 요소 상태(이미지 줌·팬,
  자막 단어별 표시·투명도, 씬 전환 페이드, 프로그레스바 폭)를 계산해 그린다. 시간이 아니라 프레임이
  진실원 → 캡처가 결정적·재현 가능.
- 주입: `window.__PROPS__ = { scenes: [{ imageSrc(file://|null), screenText, startFrame,
  durationInFrames }], totalFrames }`. 이미지·폰트는 `file://` 로컬(오프라인·CDN 무의존).
- 씬 구성: 전 씬을 하나의 타임라인에 배치, `seek(f)`가 현재 씬을 판별해 그 씬의 로컬 진행률로
  애니메이션. 씬 경계는 크로스페이드.
- 애니메이션 프리미티브(JS 순수 함수, 프레임→상태): `kenBurns(local)`(줌·팬), `kineticCaption(local,
  words)`(단어 스태거 등장), `sceneFade(local, dur)`(진입/이탈 페이드), `progress(globalFrame)`(상단 바),
  하단 25% 자막 세이프존 상수. 이미지 null이면 씬 색 순환 그라데이션.
- 폰트: 로컬 Noto Sans KR(있으면 `@font-face file://`) — 없으면 시스템 폴백. 텍스트는 문자열
  렌더라 오타·자소 깨짐 원천 불가(원본 A/02의 장점 계승).

### 4.4 프레임 캡처 + 인코딩

- 캡처: `scripts/blog_skills/shorts_capture.py` — **Python Playwright(기존 의존성 재사용)** 로
  `shorts_stage.html`을 헤드리스 로드, `viewport 1080×1920, deviceScaleFactor 2`(선명도).
  `window.__PROPS__` 주입 후 `for f in range(totalFrames): page.evaluate('window.seek', f);
  page.screenshot(frames/frame_%05d.png)`.
  - 성능: 프레임당 스크린샷(대략 30~80ms). 40초=1200프레임 ≈ 1~2분(백그라운드 잡 허용).
    필요 시 프레임 구간을 복수 page/context로 병렬화(후속 최적화, 이 스펙 범위 밖).
  - 취소: `--signal`/타임아웃으로 중단. 캡처 실패 시 비영(0) 종료코드 → TS가 폴백.
- 인코딩(TS, ffmpeg): PNG 시퀀스 + 오디오 → `final.mp4`.
  - 오디오: 씬별 TTS mp3를 씬 startFrame 오프셋에 맞춰 무음 패딩 결합(단일 트랙) → 1패스 mux.
  - `ffmpeg -framerate 30 -i frames/frame_%05d.png -i audio.mp3 -c:v libx264 -crf 20
    -pix_fmt yuv420p -c:a aac -b:a 128k -shortest final.mp4`. 1080×1920/30fps/H.264+AAC.
  - `buildSrt`로 `subtitles.srt` 기록.
- `renderShortsVideoBrowser` 반환형 = 기존과 동일.

## 5. Phase 2 (후속, 이 스펙 범위 밖 — 방향만 기록)

- **데이터 시각화**: `shorts_writer` 스키마 확장 — 씬 `kind`(hook/stat/list/quote/cta) +
  stat 씬 숫자·단위, list 씬 항목. `shorts_stage.html`에 타입별 레이아웃(CountUp 수치, 리스트
  리빌, 인용 카드) 추가. → 진짜 "데이터 시각화".
- **렌더 전 비전 QA**: `shorts_capture.py`로 씬 중앙 프레임 1장만 캡처 → Claude 비전이 자막
  세이프존 침범·구도·가독성 점검 → 불량 **씬 이미지만** 1회 재생성(카드뉴스 QA 기계 재사용,
  `visionCapable()` 게이트). 텍스트는 컴포지션이 그리므로 QA는 배경 구도·세이프존 확보 위주.
- Phase 2는 별도 스펙·플랜으로 진행.

## 6. 에러 처리

- 캡처/인코딩 실패(Playwright 부재·크래시, HTML 오류, 타임아웃, 예외) → `ok:false`/throw →
  §4.1 폴백으로 ffmpeg 슬라이드쇼가 항상 완성.
- 개별 씬 TTS 실패 → 무음 씬 진행(현행 유지). 이미지 null → 그라데이션 폴백(현행 유지).
- 취소(signal) → 캡처·인코딩·폴백 모두 즉시 중단.

## 7. 테스트

- 단위(vitest): `shortsCommon`의 `prepareScenes`(길이 계산·클램프·무음 폴백 분기),
  `buildSrt`(타임코드 포맷), `inputProps`/오디오 오프셋 매핑. TTS/ffprobe는 주입/모킹.
- 컴포지션 단위: `seek(f)`가 결정적인지 — 노드에서 `shorts_stage.html`의 순수 애니메이션 함수를
  임포트(또는 jsdom)해 특정 프레임 상태 스냅샷. (실행 CSS 애니메이션 미사용이라 순수 함수 테스트 가능)
- 스모크: 소수 씬 고정 props로 캡처+인코딩 1회(로컬, opt-in) — mp4 산출·길이·해상도 검증.
- 폴백: `SHORTS_RENDERER=ffmpeg` 및 캡처 강제 실패 주입으로 폴백 경로가 완성물을 내는지.
- 기존 쇼츠 테스트 회귀 없음(공통 추출 후 `renderShortsVideo` 동작 불변).

## 8. 의존성 · 리스크

- **새 무거운 의존성 없음**: 캡처는 기존 Python Playwright(`naver_publish.py`가 사용) 재사용,
  인코딩은 기존 ffmpeg. → 라이선스·설치 부담 최소. (플랜 단계에서 blogPython 환경에 Playwright·
  chromium 실재 확인)
- **성능**: 프레임당 스크린샷이라 ffmpeg 슬라이드쇼보다 렌더 느림(수 분/영상). 백그라운드 잡이라
  허용되나, 잡 타임아웃 재검토 + 후속 병렬화 여지.
- **결정성**: 애니메이션이 `seek(frame)` 순수 함수여야 함(실행 CSS 애니메이션 금지) — 캡처
  재현성의 전제. 컴포지션 작성 시 이 규율을 지켜야 함.

## 9. 대안 (브라우저 캡처 성능/안정성 불충분 시)

동일 아키텍처(데이터 주도 컴포지션 + 드롭인 + 폴백) 유지, 캡처 엔진만 교체:
- Pillow 프레임 렌더(기존 스택, 브라우저 없음) — 표현력 낮으나 최경량.
- MIT 프레임워크(Revideo 등, 라이선스·성숙도 검증 후).

## 10. 완료 기준 (Phase 1)

- `SHORTS_RENDERER=browser`(기본)에서 주제 1개로 쇼츠 생성 시 브라우저 캡처가 1080×1920 mp4를
  키네틱 자막·Ken Burns·전환과 함께 산출.
- 캡처 실패를 주입하면 ffmpeg 슬라이드쇼로 폴백해 완성물 산출(무중단).
- 기존 쇼츠 파이프라인·테스트 회귀 없음. tsc·빌드 통과.
