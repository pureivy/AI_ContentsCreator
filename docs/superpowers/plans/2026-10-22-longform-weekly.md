# 롱폼 매주 자동 제작·발행 (2026-10-22)

사장님 요청: 썸네일은 숏폼처럼 손글씨 스타일. 롱폼은 매주 일요일 24:00(=월 00:00)에 주제를 잡아 만들고, 숏폼처럼 텔레그램으로 알림 → 버튼으로 유튜브 발행. 웹 제작실에 롱폼 탭.

사장님 결정(2026-10-22):
- 그림: **모든 문장에 모션그래픽(MG)** — 비용·시간 큼을 알고 고름.
- 시각: **24:00에 만들기 시작** → 완성되면 텔레그램, 버튼 누를 때 공개.
- 주제: **블로그+숏폼 조회 합산 상위 묶음**(이미 롱폼으로 만든 주제·제철 아닌 주제 제외, 고른 이유를 알림에 적음).

## 전제(조사 결과)
- 시범(`data/longform/pilot-2026-10-19`)은 대본·도해 58종 모두 손으로 만든 것. 도해 글자는 전정 전용으로 코드에 박혀 있다.
- 쇼츠 썸네일 손글씨는 gpt-image가 그림 안에 직접 쓴다(`shortsThumbnail.ts` generateDesignedThumbnail, 1024x1536 고정, 한글 오타 QA 루프).
- `uploadShortsToYoutube`는 파일 통째 multipart + 180초 → 1GB 롱폼 불가. 새 resumable 업로드 필요.
- 쇼츠 영상 라우트는 Range 전체를 Buffer.alloc → 롱폼은 스트림.
- 주간 스케줄러 없음 → `DailyDeps.weekday`.

## 1단계 — 발행 경로(시범을 1호 레코드로)
- `src/content/longform.ts` LongformStore: `data/longform/index.json`, id `long_*`(시범은 dir 이름 그대로 연결), stage, title, dir, youtubeId/Url/Ts, notifiedTs, topicReason, error.
- 가로 손글씨 썸네일: generateDesignedThumbnail에 size·출력·방향 매개변수 → 1536x1024 생성 후 1280x720 자르기·2MB 이하. 오타 QA 재사용.
- `uploadLongformToYoutube`: resumable(청크 스트림), 처음부터 공개, thumbnails.set, 챕터 설명, `watch?v=` URL, oardefault 판정 없음.
- 라우트(정적 catch-all 앞): `GET /longform`, `GET /longform/:id`, `/video`(스트림 Range), `/thumbnail`, `POST /longform/:id/youtube`(즉시 202, 백그라운드 업로드, in-flight 잠금), `POST /longform/:id/thumbnail/regenerate`.
- 텔레그램: `notifyLongformReady`(썸네일 사진+캡션+버튼 `ly:<id>` 유튜브 발행, `lt:<id>` 썸네일 다시). 영상은 50MB 초과라 안 보냄. 업로드 완료 알림.
- 제작실 `롱폼` 탭: 목록, 16:9 재생, 썸네일, 제목·설명 미리보기, 발행·썸네일 다시 버튼.

## 2단계 — 생성 파이프라인(수동 실행 `POST /longform/run`)
주제 → 대본(LLM, 장·수종은 데이터) → validateScript+factGate → TTS/STT(3회, 실패 문장 뜻 보존 바꿔 쓰기) → 실촬영 배정(영상 없는 수종 장 제외) → MG(문장마다, 장 단위 에이전트 세션, 장면별 실패 시 정지 화면+자막 폴백) → 렌더 → 썸네일 → ready → 알림.
- MG 방식은 3장면 시범 스틸을 사장님께 보인 뒤 95문장으로 넓힌다.
- 편당 비용 기록·상한.

## 3단계 — 매주 실행·정리
- `startDaily({weekday:1, time:'00:00', key:'longform-weekly'})`, 스위치 `LONGFORM_WEEKLY`.
- 오토런·숏폼 생성 중이면 렌더·MG 대기.
- janitor: 롱폼 중간물(audio·clips·mg·remotion) 발행 14일 뒤.

## 지키는 것
- 커밋은 요청 때만, 이름 지정 add. 운영 재시작 전 naverBusy·publishBusy 확인. 실제 업로드는 사장님 버튼/확인으로만.
