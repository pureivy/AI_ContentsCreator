# 장면 키트 API (롱폼 문장 그림)

문장 하나 = 장면 파일 하나(`.tsx`). 그 문장이 **말하는 것만** 세밀화 부품으로 그려 움직인다. 이 문서 밖의 부품·파일은 없다고 생각한다.

## 1. 장면 파일 틀

```tsx
// S07 "블루베리는 산성 흙을 좋아해서, 피트모스를 절반 넘게 섞어 pH 4.5에서 5.5로 맞춥니다."
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { SceneStage, type SceneProps } from '../SceneStage';
import { Planter, PotSection, Gauge, SafeLabel, ACCENT, LEAF, GROUND_Y, Ground, atFromWords, beat, beatInOut } from '../../illus/Kit2';

const L1 = '산성 흙';          // 라벨은 맨 위 상수로(검사기가 읽는다). 문장에 있는 말만.
const L2 = 'pH 4.5~5.5';

export default function Scene({ durationInFrames, words }: SceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tPeat = atFromWords(words, '피트모스', fps, 40);   // 말한 순간(못 찾으면 40)
  const tPh = atFromWords(words, 'pH', fps, 110);
  return (
    <SceneStage frames={durationInFrames} backdrop="sky">
      <Ground y={GROUND_Y} seed="s07" />
      <Planter x={200} y={470} material="plastic" at={0} />
      <SafeLabel x={200} y={530} at={12} color={ACCENT}>{L1}</SafeLabel>
      {/* ... */}
    </SceneStage>
  );
}
```

- 파일 자리: `remotion/longform/scenes/<회차>/S{NN}.tsx` (그래서 import 가 `../SceneStage`, `../../illus/Kit2`). 예시: `scenes/example/S00.tsx`.
- 기본 내보내기 하나, props 는 `{ durationInFrames, words? }`. `words` = `{ w: string; start: number }[]`, start 는 **이 장면 시작부터 초**.
- import 는 `../SceneStage`, `../../illus/Kit2`, `remotion`, `react` 만.
- 좌표는 **viewBox 1000×620**(컴포지션 1100×680 이 알아서 맞춘다). 왼쪽 위 (0,0), y 는 아래로.
- 무대 `<SceneStage frames backdrop focus?>`: `backdrop` = `'sky'`(하늘·들판, 땅은 `<Ground y={GROUND_Y}/>`) · `'indoor'`(벽 + 작업대, 탁자 윗면 `TABLE_Y`=520, Ground 쓰지 않음) · `'macro'`(초점 나간 숲 — 나무 일부 확대) · `'plain'`(종이빛 — 단면·도식). `focus={{x,y,at,scale?}}` 면 at 부터 그 점으로 확대(기본 1.6배). 카메라는 늘 1.04배까지 천천히 당긴다.

## 2. 규칙

**빛·색** — 빛은 언제나 **왼쪽 위**. 그림자는 오른쪽 아래(`CastShadow`). 글자색은 `INK`(기본), 강조 `ACCENT`(주황), 옳음 `LEAF`(초록), 틀림 `RED`. 그 밖의 색은 부품이 정한다(`PAL` 참고). 새 색으로 면을 칠하지 말고 부품의 `color`/`material` 을 쓴다.

**글자** — 라벨은 **장면당 최대 3개**(+ 숫자 눈금은 별개). 한글 라벨 **8자 이하**(공백 제외), 숫자가 든 라벨(`'30cm'`, `'pH 4.5~5.5'`)은 **12자 이하** — `labelLen(text).ok` 로 검사, 한도는 `LABEL_MAX_KO`·`LABEL_MAX_NUMERIC`·`MAX_LABELS`. 라벨 글은 **그 문장에 나온 말**만(요약·새 사실 금지). 글자는 항상 `SafeLabel`(안전 영역 `SAFE` = x 48~952, y 44~580 안으로 자동으로 민다).

**결정성** — `Math.random`·`Date`·네트워크·이미지·외부 폰트 금지. 무작위는 `random('시드')`(remotion). 모든 움직임은 `useCurrentFrame()` 의 함수.

**id** — 새 `<defs>`(gradient·clipPath·filter)를 만들면 id 는 **`s{NN}-` 접두사**(장면 번호, 예: `s07-glow`). `<filter>` 는 새로 만들지 않는다(무겁다). `PotSection`·`RootBall`·`SoilSection` 의 `id` prop 도 `s07-pot` 처럼.

**박자** — 대상은 **낭독이 그것을 말할 때 나타난다**(`atFromWords`, 말보다 4프레임 먼저). 한 박자(그 말의 구간)가 끝나면 물러난다 — `beatInOut(f, at, until)` 또는 `o` prop 으로 흐리게. **장면의 주인공만** 끝까지 남는다. 첫 10프레임 안에 주인공이 보여야 한다. 마지막 15프레임은 새로 나타나는 것 없이 정리된 그림.

**하지 말 것**
- 가짜 원근 회전 금지: 화분을 `rotate`로 기울여 바닥을 보여 주지 않는다 → `Planter view="bottom"` 으로 **시점을 바꾼다**(세로 납작 `scale(1 k)` 전환 허용).
- 글자를 안전 영역 밖·그림 위 겹치게 두지 않는다. 라벨 4개 이상 금지.
- 문장에 없는 글·수치·사실을 쓰지 않는다. 브랜드·사람 이름 금지.
- 부품을 흉내 낸 납작한 도형(단색 사각형 화분, 동그라미 손)을 직접 그리지 않는다 — 있는 부품을 쓴다.
- `at` 을 장면 길이보다 늦게 두지 않는다(안 보이는 부품).

## 3. 박자 도우미 (`Kit2` 에서)

- `beat(frame, at, dur=18, ease='out'|'inOut'|'linear'|'back') → 0~1`
- `beatInOut(frame, at, until?, inDur=12, outDur=10) → 0~1` (켜졌다 until 부터 꺼짐)
- `mix(a, b, t)` — 선형 보간
- `atFromWords(words, token, fps, fallback=0, {nth?, lead=4}) → frame` — 조사 붙어도 부분 일치, 못 찾으면 fallback
- `labelLen(text) → {ok,len,limit,numeric}` · `clampLabel(x,y,text,size,anchor?,safe?)` · `textWidth(text,size)`
- 상수: `VIEW`(1000×620) `SAFE` `GROUND_Y`=560 `TABLE_Y`=520 `DONE`(=-999, "이미 다 그려진 상태로 시작") `clamp`(interpolate 옵션)

`at` 기본값: **Kit2 새 부품은 `DONE`(처음부터 보임)**, 옛 키트 부품(Branch·Leaf·ProcTree…)은 `0`(0프레임부터 자람). 나타나게 하려면 `at` 을 준다.

## 4. 부품 — 새 세밀화 (원점·주요 props = 기본값)

### 화분
- `Planter {x, y, w=220, h=190, material='plastic'|'terracotta'|'fabric', view='front'|'threeQuarter'|'bottom', saucer=false, drainHoles(재질별 5·1·0), soil=true, holeGlow=0, at, o=1, id?}` — 원점 = 바닥 가운데. `bottom` = 뒤집어 본 밑면(원 중심 `(x, y - w*0.535)`), 구멍이 보인다.
- `PotSection {id, x, y, w=380, h=280, material, layers: {material:'peat'|'soil'|'compost'|'perlite'|'sand'|'bark'|'gravel', ratio, label?}[], fill?(0~1) | at+dur=40, mix=0, level?:{ratio,label?,at?}, slotY?, children?, behind?, o}` — 앞을 잘라 낸 단면. ratio = 안쪽 높이 비율(바닥부터 쌓임). `layer.label` 은 왼쪽 지시선 라벨(라벨 수에 셈). children 은 `(x, slotY)` 원점으로 층 위에.
- `potSection(x,y,w,h,material) → {innerTop, innerBottom, levelY(ratio), innerX(y,side), outerX(y,side)}` — 붓는 목표·뿌리목 높이 계산용.

### 손
- `Hand {x, y, angle=0, pose='hold'|'pinch'|'open'|'pour'|'point', glove=true, side='right'|'left', scale=1, arm=70, at, o}` — 원점 = 손목, 손가락이 angle 쪽. 쥐는 점의 화면 좌표 = `handGrip(x, y, angle, pose, scale, side)` — 들 물건을 거기에 둔다. 물건을 먼저, Hand 를 나중에 그려 손가락이 물건 앞에 오게. 주먹(`pour`)에 쥔 손잡이는 손가락과 직각(물건 angle = 손 angle ± 90). 오른쪽에서 왼쪽을 향하는 손은 `angle={180} side="left"`(엄지가 위).
- `GloveHand {x, y, angle, grip?}` — 정원사용 작은 장갑 손(옛 키트).

### 식물
- `RootBall {id, x, y, w=190, h=160, loosen=0~1, at, o, shadow=false}` — 원점 = 윗면 가운데(뿌리목). loosen 을 박자로 올리면 감긴 뿌리가 풀린다.
- `Shrub {x, y, h=220, stems=3, spread=1, leaf='small'|'oval'|'serrate'|'broad', leafSize=22, leavesPerStem=8, berries?:{color?,n?,r?}, fruit?:{color?,r?,n?}, at, seed, fallAt?}` — 원점 = 밑동. berries 기본 블루베리 남색.
- `Seedling {x, y, h=70, leaves=0|2|4, scale=1, at, seed}` — 떡잎 → 본잎. 원점 = 흙 표면.
- `Fruit {x, y, r=14, color='#e05a3a', at, fadeAt?}` · `Berry {x, y, n=4, r=8, color?(없으면 블루베리), at, seed}`

### 재기
- `Ruler {x, y, length(px), units=30, unit='cm', labelEvery=10, angle=0, kind='tape'|'ruler', at, dur=24, extend?}` — 원점 = 0 눈금. 줄자는 풀려 나온다.
- `DimensionLine {x1, y1, x2, y2, text?, at, color=INK, size=30, textSide=-1|1}` — 양쪽 화살표 치수선(값 글자는 라벨 수에 셈).
- `Gauge {x, y, kind='ph'|'temp'|'moisture', value, from?, at, dur=30, r=56, probe=0}` — 바늘이 흔들리다 value 에 선다. probe(px) = 아래 탐침(흙에 꽂기).
- `RangeBar {x, y, length=420, min, max, lo, hi, step=1, orient='h'|'v'(아래가 min), kind='ph'|'temp'|'moisture'|'plain', unit?, thickness=26, at, dur=18}` — 알맞은 범위를 초록 테로.

### 소품
- `Sack {x, y, w=110, h=150, label?(8자↓), color='kraft'|'white'|'green', tilt=0(도), at, o, pour?:{at, until, toY, color?, kind?:'granule'|'fiber'}}` — 원점 = 포대 가운데. 붓기: tilt 를 -100~-130 으로 박자 회전 + pour. 입구 좌표 `sackMouth(x,y,h,tilt)`.
- `PourStream {from:[x,y], toY, at, until, color?, kind='granule'|'fiber'|'water', n=28, spread=18}`
- `WaterDrops {pts:[x,y][], at, until?, fall=120, period=22, size=1}` · `WaterStream {from, to, at, until?, width=7}`
- `Trowel {x, y, angle=0, scale=1, soil=false, origin='tip'|'handle', at, o}` — 원점 = 날 끝(손에 쥘 땐 `origin="handle"` + `handGrip`).
- `WateringCan {x, y, scale=1, tilt=0, at, o, pour?:{at, until, toY}}` — 원점 = 몸통 바닥. 부을 때 tilt≈25~35.
- `Fertilizer {x, y, w=160, n=30, kind='granule'|'pellet', color?, at, drop=120}` — 표면 y 위로 떨어져 흩어짐.
- `Mulch {x0, x1, y, thick=18, kind='bark'|'straw'|'wood', at, dur=24, seed}` — 왼쪽부터 깔린다.
- `Stake {x, y, h=240, kind='bamboo'|'wood', ties=[](땅에서 높이 px), tieTo=14(줄기 쪽 x 거리, 음수=왼쪽), at, tieAt?, o}`

### 땅 단면
- `SoilSection {id, x0=0, x1=1000, groundY=300, bottom=620, layers=[{topsoil .35},{subsoil .65}], grass=true, roots=true, hole?:{x, w, depth, at?, dur?}, backfill=0~1, depth?:{label?, at?}, children?}` — 구덩이가 파이며 흙 더미가 옆에 쌓인다. children 원점 = 구덩이 바닥 가운데. `soilHole(groundY, hole)` 로 치수.

### 글자·표시
- `SafeLabel {x, y, children, at=0, color=INK, size=34, anchor='middle', weight=800, safe?}` — 유일한 라벨 방법. 숨기려면 `<g opacity>` 로 감싼다.
- `Badge {x, y, at, ok}` — ✓/✗ 동그라미(라벨 수에 안 셈). `Arrow {d, at, color?, head:[x,y,deg]}` · `Draw {d, at, dur=18, color?, width=14, dash?}` — 그려지는 선. `Callout {x, y, tx, ty, at, color?, children}` — 점 + 지시선 + 라벨.
- `CastShadow {cx, cy, rx, ry, o=0.32}`

## 5. 부품 — 옛 키트(나무·가지·사람)

- `Ground {y, x0=40, x1=960, seed}` — sky 무대의 흙 둔덕 + 풀.
- `ProcTree {seed, x, groundY, height, at=0, depth=3, spread=32, lean=0, foliage='leaves'|'buds'|'none', leafSize=24, leaf, fallAt?}` · `MiniTree {x, y, mode='leafy'|'bare'|'budding', at, scale}`
- `Branch {pts:[x,y][], w0, w1, at=0, dur=20, fill?, flare?, detail=true}` — 가늘어지는 가지(껍질 결). w0≥30 은 확대 줄기.
- `Leaf {x, y, angle, size=34, at=0, fallAt?, seed, tone?, shape}` · `leavesOnTwig(pts, n, seed, at, size?, fallAt?, shape?, back?, canopy?)` · `leavesAlong(...)` · `leafCluster(x, y, seed, at, size?, fallAt?, shape?, n0?)` — 배열을 돌려준다(`{...}` 로 넣기).
- `Bud {x, y, angle?, kind='leaf'|'flower', size=20, at, plump?}` · `CollarJoint {edgeX, y, bw, len, state='whole'|'cut'|'flush', at, heal?}`(macro) · `WoodSection {x, y, r}` · `Coin {x, y, r=40, at}`
- `Gardener {x, groundY, scale=1, reachAt=0, armTo=-62, shears=true}` · `Shears {x, y, angle, scale, at, closeAt?, hideAt?}` · `Saw {...strokes, dur, hideAt}` · `Chips {x, y, at, n=9}`
- 색 `C`(bark·leaf·soil·skin…), `pointAt(pts, t)`, `useGrow(at, dur)`.

## 6. 자주 쓰는 짜임

- **붓기**: `PotSection fill={interpolate(f,[a,b],[0,1],clamp)}` + `Sack tilt={...} pour={{at:a, until:b, toY: G.levelY(현재 채움)}}`.
- **재기**: 물체 위 `Ruler`(줄자) 또는 옆 `DimensionLine text="30cm"`.
- **뒤집어 밑 보기**: 앞 `Planter` 를 `scale(1 → 0)`, 이어서 `view="bottom"` 을 `scale(0 → 1)`(같은 중심), `holeGlow` 박자.
- **심는 깊이**: `PotSection level={{ratio, label}}` 또는 `SoilSection hole depth`, 그 안에 `RootBall`.
- **손으로 하는 일**: `Hand` 두 개(좌 `angle 0`, 우 `angle 180 side="left"`), 박자 끝나면 `o` 로 물러난다.
- 오류에 대비해 상위에서 `ErrorBoundary`(SceneStage.tsx)가 장면을 감싼다 — 던진 오류만 잡으니 NaN 좌표가 없게 숫자를 확인한다.
