# 전체 화면 장면 키트 — 스타일 A "세밀화 + 원예 도해"

크림 종이 위 먹 펜 선 + 차분한 물감 칠 + 빗금 그늘. 도해 기호(번호 배지·화살표·치수선·지시선)는 주홍(`PA.accent`).
문장 하나 = 장면 파일 하나. 그 문장이 **말하는 것만** 그린다. 이 문서 밖의 부품은 없다고 생각한다.

## 1. 틀

```tsx
// s012 "다 자란 감나무는 뿌리가 넓고 몸통에 양분이 많지만, 어린 묘목은 뿌리도 양분도 적어 첫 겨울 언 땅에 약합니다."
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { ALabel, AMark, FullStage, GroundSection, PA, Snowfall, Tree, atFromWords, beat, beatInOut, type FullSceneProps } from './_kit';

const L1 = '다 자란 감나무';   // 라벨은 맨 위 상수. 문장에 있는 말만.
const L2 = '어린 묘목';
const L3 = '언 땅';
const GROUND = 600;

export default function Scene({ durationInFrames, words }: FullSceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tRoot = atFromWords(words, '뿌리가', fps, 30);    // 말하는 순간(못 찾으면 30)
  const tStore = atFromWords(words, '양분이', fps, 70);
  const tYoung = atFromWords(words, '어린', fps, 110);
  const tFrost = atFromWords(words, '언', fps, 170);
  const tWeak = atFromWords(words, '약합니다', fps, 200);
  return (
    <FullStage frames={durationInFrames}
      labels={<>
        <ALabel x={600} y={170} at={4} until={tYoung}>{L1}</ALabel>
        <ALabel x={1360} y={330} at={tYoung + 6} color={PA.accent}>{L2}</ALabel>
        <ALabel x={1700} y={GROUND + 70} at={tFrost + 10} anchor="end" color={PA.accent}>{L3}</ALabel>
        <AMark x={1530} y={420} ok={false} at={tWeak} size={50} />
      </>}>
      <GroundSection x0={150} x1={1770} y={GROUND} depth={250} frost={beat(f, tFrost, 24, 'inOut')} frostHi={beatInOut(f, tFrost, tWeak + 20)} seed="s012-g">
        <Tree x={600} y={GROUND} h={400} age="mature" seed="s012-big" leaves="bare" roots="wide" rootW={760} rootDepth={220}
          store={beat(f, tStore, 16)} hi={{ roots: beatInOut(f, tRoot, tStore), store: beatInOut(f, tStore, tYoung) }} />
        <Tree x={1360} y={GROUND} h={230} age="sapling" seed="s012-small" leaves="bare" roots="small" rootW={170} rootDepth={90}
          at={tYoung} grow={26} rootP={beat(f, tYoung + 10, 20)} store={0.25} hi={{ roots: beatInOut(f, tYoung + 20, tFrost) }} />
      </GroundSection>
      <Snowfall x0={150} x1={1770} y0={140} y1={GROUND - 10} at={tFrost - 10} n={42} />
    </FullStage>
  );
}
```

- props: `{ durationInFrames, words?, footage? }` — `words` = `{w, start(초)}[]`, `footage` = 이 문장 실촬영(없을 수 있음).
- 무대 `<FullStage frames labels? overlay? pan? defs?>` — children = 그림(SVG), `labels` = 글자·기호 층(맨 위, 또렷), `overlay` = `FootageInset`. 카메라는 1→1.015 로 아주 천천히 당긴다. `pan`(px) = 가로로 옮겨 보기.

## 2. 화면

- 좌표 = **화면 픽셀 1920×1080**, (0,0) 왼쪽 위, y 아래로.
- **안전 상자 x 90~1830, y 120~860** — 그림·라벨·카드 모두 이 안. 아래 **y ≥ 886 은 자막 띠**(따로 그려짐 — 거기 그리면 잘리고 검사에 걸린다). **왼쪽 위 x<760·y<110 은 장 이름 자리** — 비운다.
- 화면을 넓게 쓴다: 주인공은 크게(나무 h 350~650), 땅 선은 y 600~820 쯤. 빈 화면 금지 — 첫 10프레임 안에 주인공이 보인다.

## 3. 규칙

**포인트 색(주홍)** — **지금 낭독이 말하는 것에만**. 그 말을 하는 박자에 켜고(`color={PA.accent}`·`hi`·`soilHi`·`holeHi`·`frostHi`) 박자가 끝나면 끈다(`until`, `beatInOut(f, at, until)`). 한 화면에 주홍 덩어리 하나(많아야 둘). 물감 색(잎 초록·흙 갈색·감 주황)은 부품이 정한다 — 새 색으로 면을 칠하지 않는다.

**글자** — 라벨은 장면당 **최대 3개**, 한글 **8자**·숫자 라벨 **12자** 이하(공백 제외), **그 문장에 나온 말·숫자만**. 맨 위 상수(`const L1 = '…'`)로, `labels` 층의 라벨 부품으로만(`ALabel`·`ADim text`). `<text>` 직접 금지.

**실촬영 끼움 카드** — `<FootageInset footage={footage} x y h? at until? />`(x,y = 카드 중심, h 기본 440, 세로 9:16). 문장이 **실제 모습·상태·크기·색·질감**을 말할 때만, 그 박자에 띄운다(최소 3초 보이게). 주인공을 가리지 않게 **빈 쪽**에 두고 그림은 반대쪽으로 비켜 그린다. 카드 아래 끝 `y + h/2 + 9 ≤ 860`. 지정 장면(★)은 반드시 한 번. `footage` 가 없는 장면은 쓰지 않는다. 카드는 사진이다 — 그 위에 라벨·화살표를 겹치지 않는다.

**박자** — 대상은 낭독이 그것을 말할 때 나타나고(`atFromWords`, 말보다 4프레임 먼저), 박자가 끝나면 물러난다(`o`·`until`). 장면의 주인공만 끝까지 남는다. 마지막 15프레임은 새로 나타나는 것 없이.

**id·seed** — 새 defs·clipPath id 는 장면 키 접두사(`s012-…`). 부품 `seed` 는 모양을 정한다(같으면 같은 모양) — 같은 장 이웃 장면과 같은 나무를 이어 그리려면 같은 seed·h·age(장 이름으로 `hardiness-big`), 한 장면 안의 두 나무는 서로 다른 seed. `url(#…)` 은 접두사 또는 키트 공용 `a-…` 만.

**결정성** — `Math.random`·`Date`·네트워크·이미지·`<filter>` 금지. 무작위는 `random('시드')`.

**하지 말 것** — 가짜 원근 회전(화분을 rotate 로 기울여 바닥 보이기) 금지 → 시점 전환(세로 `scale(1 k)` 납작 → 다른 시점 펼침). 납작한 도형으로 부품 흉내 금지. 사람 얼굴·브랜드 금지. `at` 을 장면 길이보다 늦게 두지 않는다.

## 4. 도우미 (`./_kit`)

`beat(f, at, dur=18, ease)` 0→1 · `beatInOut(f, at, until?, inDur=12, outDur=10)` · `mix(a,b,t)` · `atFromWords(words, 낱말, fps, 기본, {nth?, lead=4})` · `clamp` · `SAFE` · `CAPTION_TOP`(886) · `W`·`H` · `PA`(색) · 모양 계산 `potGeom(w,h)`·`sectionGeom(x,y,w,h)`·`rootBallGeom` · `treeBox(seed,h,age)` → `{trunkTop, trunkW, crown:{x0,y0,x1,y1}, graftY}`(나무 밑동 기준) · `mapPoint(x,y,h,lat,lon)` → 지도 위 지점 화면 좌표.
부품의 `at` 기본값은 대부분 `DONE`(처음부터 그려진 상태) — 나타나게 하려면 `at` 을 준다.

## 5. 부품

### 나무·땅 (원점·주요 props)
- `Tree {x, y(=땅), h, age='sapling'|'young'|'mature', seed, leaves='full'|'autumn'|'bare', fruit=true, at, grow=40, o, roots='none'|'small'|'wide', rootW, rootDepth, rootP(0~1 뻗음), store(0~1 몸통·뿌리 양분 알갱이), hi:{trunk,crown,fruit,graft,roots,store}}` — 감나무. sapling = 접목묘 외줄기(접붙인 자리 표시, `hi.graft` 로 주홍 테), young = 1~3년생, mature = 성목(굵은 몸통·넓은 수관·감). 뿌리는 땅 아래로 그려진다(`GroundSection` 의 children 으로).
- `GroundSection {x0, x1, y, depth=220, frost(0~1 언 층), frostHi, grass=true, seed, at, o, children}` — 땅 단면(흙 점묘, 언 층 = 눈 결정 + 점선).
- `GroundLine {x0, x1, y, p}` — 지면 선만.
- `StrawWrap {x, y0(위), y1(아래), w, p(아래부터 감긴 몫), hi}` — 몸통 짚 두르기(새끼줄). 몸통 굵기는 `treeBox(...).trunkW`.
- `Leaf {x,y,angle,len,autumn?,hi?}` · `Persimmon {x, y, r=40, kind='round'|'flat'(단감)|'long'(대봉), at, hi}`.
- `AShrub {x,y,h,seed,at,grow,berries,stems}` 블루베리형 관목 · `ALeaf` · `ABerry`.

### 날씨·계절·물
- `Snowfall {x0,x1,y0,y1, at, until?, n=36}` 내리는 눈 · `Snowflake {x,y,r=34, at, hi}` · `Sun {x,y,r=46, at, hi}` · `Drop {x,y(끝),r=22, at, hi}` 물방울.

### 지도·달력·저장
- `KoreaMap {x, y(상자 왼쪽 위), h=560(너비≈0.54h), region='central'(중부)|'south'(남부), regionP(0~1 칠함), dots:[{lat,lon,hi}], at, o, seed}` — 남한 도식 지도. 지역 띠는 주홍.
- `MonthStrip {x, y, months:[9,10,11,12], hiMonth, hi, cell=120, at}` — 달력 칸('N월'). `hiMonth` 는 문장에 나온 달.
- `Reserve {x, y(바닥), w=170, h=210, value(0~1), hi, seed}` — 양분 항아리(밑천·저장량 비교).

### 손·도구·화분
- `Hand {x, y(쥐는 점), pose='hold'|'point', angle=0, scale=1, flip, at, hi}` — 오른쪽에서 들어와 세로 줄기를 쥔다(`flip` = 왼쪽에서). point = 검지 끝이 쥐는 점에서 왼쪽 96·위 34.
- `APot {x,y(바닥 가운데),w,h,material='plastic'|'terracotta',empty,soilHi,at}` · `APotBottom {x,y,r,holes,holeHi,p}` · `APotSection {x,y,w,h,layers:[{kind:'peat'|'soil'|'mix',ratio}],fill,mix,seed,children}` · `ARootBall {x,y,w,h,loosen,hi,reach,seed}` · `ASack {x,y,tilt}` · `AFall {from,toY,at,until}` · `AGround {x0,x1,y,p}`.

### 도해 기호(labels 층)
- `ALabel {x, y, at, until?, size=46, color=PA.ink, anchor}` 글자(고운바탕) · `ABadge {x,y,n,at,until}` 번호 ①② · `AArrow {d, head:[x,y,deg], at, until, color, w}` · `ADim {x1,y1,x2,y2,text,at,until,color,size,textOffset}` 치수선 · `AMark {x,y,ok,at,until,size}` ✓/✗ · `ALeader {pts,at,until,color}` 지시선 · `APhScale {x,y,len,min,max,lo,hi,at}`.

## 6. 자주 쓰는 짜임

- **실촬영 카드**: `overlay={<FootageInset footage={footage} x={1480} y={470} h={460} at={tLook} until={tNext} />}` — 이때 그림은 x 200~1150 에.
- **크기 비교**: 같은 땅 선 위 `Tree age="sapling"` 과 `age="mature"`, 키는 `ADim`(문장의 숫자만).
- **땅속 이야기**: `GroundSection` 안에 `Tree roots=…`, 뿌리가 `rootP` 로 뻗고 `hi.roots`.
- **겨울**: `leaves="bare"` + `Snowfall` + `GroundSection frost`.
- **시점 전환**: 앞 그림 `scale(1 → 0)` 다음 새 그림 `scale(0 → 1)`(같은 중심).
