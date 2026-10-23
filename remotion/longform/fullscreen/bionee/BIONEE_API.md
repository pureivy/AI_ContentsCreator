# 비온이 동작 신호(코드 리그 — 장면 담당 차민혁용)

비온이는 코드로 그린 연필 선화 화분(장화 신음)이다. 그림 한 장이 아니라 **신호(cue) 목록**으로 움직인다. 문장마다 0~3개 고른다.

## 신호 모양
```ts
{ at: 1.2, dur: 1.5, action: 'point', params: { target: { x: 1440, y: 430 } } }
```
- `at`·`dur` = 초(세그먼트 시작 기준). `dur` 생략 = 기본 길이. 넣고 빼기는 자동으로 6프레임 섞는다(`params.blend` 4~8).
- 신호는 **겹쳐도 된다** — 신호마다 쥐는 부위(팔·얼굴·귀·몸·효과)만 바꾼다. 같은 부위면 뒤에 적은 신호가 이긴다. 예) `laugh` 다음에 `thumbsUp` = 웃으며 오른손 엄지.
- 객체 리터럴 그대로(계산식·변수 금지 — 렌더 전에 글로 읽는다).
- 말할 때 입은 낭독 소리로 자동(모음 모양 섞임). 신호로 입을 움직이지 않는다.
- 신호가 없을 때도 숨쉬기·깜빡임·두리번·귀 까딱·바람 흔들림이 돈다.

## 동작(기본 길이 초)
| action | 뜻 | params |
|---|---|---|
| walkIn (2.0) | 화면 밖에서 걸어 들어옴 | `from` 'left'·'right', `x` 멈출 곳(px) |
| walkOut (1.8) | 걸어 나감 | `side` 나가는 쪽 'left'·'right' |
| walkTo (1.5) | 옆으로 걸어 옮김 | `x` |
| turn (0.5) | 돌아섬 — **끝난 뒤에도 유지** | `to` -1(왼 옆)…0(정면)…1(오 옆) 또는 'left'·'right'·'front' |
| wave (1.6) | 손 흔들기·웃음 | `hand` 'L'·'R' |
| point (2.0) | 가리키기(눈도 그쪽) | `target`, `hand`(생략 = 대상 쪽 손) |
| lookAt (1.5) | 눈·몸만 그쪽 | `target` |
| nod (0.9) | 끄덕(앞으로 숙임) | `times` |
| shake (1.0) | 도리도리 | `times` |
| hop (0.7) | 깡충(눌림·늘어남) | `times` |
| think (2.0) | 턱 괴고 생각, 물음표 | `hand` |
| thumbsUp (1.4) | 엄지 척·반짝 | `hand`, `expr` |
| surprised (1.2) | 놀람 — 큰 눈·귀 쫑긋·두 손 볼에·느낌표 | — |
| worried (1.6) | 걱정 — 八 눈썹·물결 입·귀 처짐·땀 | — |
| laugh (1.4) | 크게 웃음(몸 들썩) | — |
| holdSign (2.5) | 팻말 들기 | `text` **6자 이내**, `hand` |
| hold (2.0) | 소품 들기 | `prop` 'magnifier'·'can'(물뿌리개)·'stick'(지시봉) |
| bow (1.2) | 꾸벅 인사 | — |
| peek (2.5) | 화면 가장자리에서 빼꼼 | `side` 'left'·'right'·'bottom' |
| face (1.5) | 표정만 | `expr` |

공통 params: `strength`(0.3~1.5), `expr`(표정 덮어쓰기), `blend`.
- `target` = 무대 점 `{ x, y }`(1920×1080 px) 또는 'left'·'right'·'up'·'down'·'camera'. 장면 그림의 그 자리를 가리킨다.
- `expr`: neutral·calm·happy(^^)·grin·laugh·surprised·worried·angry·thinking·sleepy·playful(메롱)·sad·shy·focused.

## 고르는 요령
- 첫 문장 `walkIn` 또는 `wave`, 마지막 `bow` → `walkOut`.
- 문장이 그림 속 무엇을 말하면 `point`(target = 그 그림 좌표). 강조 낱말 시각(`atFromWords`)에 맞춘다.
- 경고(안 됩니다·주의·죽) → `surprised` 또는 `worried`. 질문·"왜일까요" → `think`. 요령·정답 → `thumbsUp`. 핵심 낱말 하나 → `holdSign`.
- 같은 동작을 연달아 쓰지 않는다. 한 문장에 큰 동작(걷기·깡충·팻말)은 하나만.
- 가만히 둘 문장도 있어야 한다(신호 0개 = 자연스러운 대기).

## 한 문장 예
"잎이 다 진 뒤에 옮겨 심어야 뿌리가 덜 다칩니다." (4.2초, 나무 그림이 x 1400)
```ts
export const bioneeCues = [
  { at: 0.2, dur: 1.6, action: 'point', params: { target: { x: 1400, y: 420 } } },
  { at: 1.9, dur: 1.8, action: 'holdSign', params: { text: '잎이 진 뒤' } },
  { at: 3.6, dur: 0.6, action: 'nod' },
];
```

## 그리는 쪽(참고)
- `<BioneeActor cues home={{x,y}} scale mouth mouthStart season idp />` — 투명 SVG 층. `home` = 발 닿는 점, `scale` 1 = 키 약 547px(화분을 장화 위로 18 띄움 — LEG_GAP).
- 본편: 키 30%(scale 0.6 ≈ 328px) — 2026-10-23 크기 비교(22·28·30·34%, 휴대폰 640×360)에서 고름. 장면은 줄이지 않는다(화면 전체 — 비온이는 그 위 덮개 층, 사장님 지적). 정본 상수 = src/longform/bioneeCues.ts BIONEE_SCALE·render.ts PRESENTER_SCENE_SCALE.
- 신호 낱말 목록·모양(Action·Cue·CueParams·DEFAULT_DUR)의 정본은 src/longform/bioneeCues.ts — timeline.ts 는 다시 내보낸다. 장면 담당용 문서는 ../KIT_API_BIONEE.md(자리 규칙·문장마다 0~3개).
- 본편 배선: 장면 파일 `bioneeCues` → buildPresenter(render.ts) → props 세그먼트 `bionee`·`mouth` → LongFormFull 이 bioneeTimeline 으로 편 전체 시간표(화면 좌표·장 제목 카드 몸짓·전역 입) → BioneeActor 맨 위 층.
- 계절 `season`: spring·summer·autumn·winter(편 계절로 자동).
- 2026-10-23 다듬기: 떡잎 196×70 통통한 넓은 타원(끝 둥긂), 화분 빗금 = 몸 따라 도는 가는 호·경선(H~2B), 장화 = 밑창+굽(장심 틈)·둥근 앞코·잘록한 발목·테 띠·다리 토막, 꾸벅 = 숙임 0.17 + 떡잎이 앞으로 넘어와 흙을 가림, 팻말 글자 62(휴대폰에서 읽히게).
