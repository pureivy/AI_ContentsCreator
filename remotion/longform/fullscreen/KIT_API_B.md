# 전체 화면 장면 키트 — 스타일 B "연필 선화 + 포인트 색 하나"

미색 종이 위 흑연 선화. 색은 **포인트 색(주황빨강) 하나뿐**, 나머지는 전부 흑연. 그림 층에 흑연 결 필터가 걸린다(무대가 건다).
문장 하나 = 장면 파일 하나. 그 문장이 **말하는 것만** 그린다. 이 문서 밖의 부품은 없다고 생각한다.

## 1. 틀

```tsx
// s012 "다 자란 감나무는 뿌리가 넓고 몸통에 양분이 많지만, 어린 묘목은 첫 겨울 언 땅에 약합니다."
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { BLabel, BMark, FullStage, GroundSection, Snowfall, Tree, atFromWords, beat, beatInOut, type FullSceneProps } from './_kit';

const L1 = '다 자란 감나무';   // 라벨은 맨 위 상수. 문장에 있는 말만.
const L2 = '어린 묘목';
const GROUND = 640;

export default function Scene({ durationInFrames, words }: FullSceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tRoot = atFromWords(words, '뿌리가', fps, 30);
  const tYoung = atFromWords(words, '어린', fps, 110);
  const tFrost = atFromWords(words, '언', fps, 170);
  return (
    <FullStage frames={durationInFrames} labels={<>
      <BLabel x={600} y={150} at={4} until={tYoung}>{L1}</BLabel>
      <BLabel x={1380} y={300} at={tYoung + 6} hi>{L2}</BLabel>
      <BMark x={1560} y={420} ok={false} at={tFrost + 10} size={56} />
    </>}>
      <GroundSection x0={140} x1={1800} y={GROUND} depth={230} frost={beat(f, tFrost, 24)} seed="s012-g">
        <Tree x={600} y={GROUND} h={480} age="mature" seed="s012-big" season="winter" roots="wide" rootW={800} hi={{ roots: beatInOut(f, tRoot, tYoung) }} />
        <Tree x={1380} y={GROUND} h={330} age="sapling" seed="s012-sap" season="winter" roots="small" at={tYoung} grow={26} />
      </GroundSection>
      <Snowfall x0={140} x1={1800} y0={140} y1={GROUND - 10} at={tFrost - 10} />
    </FullStage>
  );
}
```
- props `{ durationInFrames, words?, footage? }`. 무대 `<FullStage frames labels? overlay? pan? defs?>` — children = 그림, `labels` = 글자·기호 층, `overlay` = `FootageInset`.

## 2. 화면·구도
- 좌표 = 화면 픽셀 1920×1080. **안전 상자 x 90~1830, y 120~860.** y ≥ 886 자막 띠, 왼쪽 위 x<760·y<110 장 이름 자리 — 비운다.
- **주인공은 안전 상자 높이의 45% 이상(≥ 335px)** — 나무 h 400~650, 묘목 h 380~600. 땅 선은 y 620~810. 빈 반쪽 화면 금지(주인공을 한쪽에 몰면 반대쪽에 비교 대상·카드를 둔다). 첫 10프레임 안에 주인공이 보인다.

## 3. 규칙
**포인트 색** — 지금 낭독이 말하는 것에만, 그 박자에 켜고 끈다(`hi`·`beatInOut`). 한 화면에 덩어리 하나(많아야 둘). `fill`·`stroke` 에 색 직접 금지.
**글자** — 라벨 장면당 최대 3개, 한글 8자·숫자 12자 이하, 그 문장에 나온 말·숫자만. 맨 위 상수 → `labels` 층의 `BLabel`·`BDim text`. `<text>` 금지.
**실촬영 카드** — `<FootageInset footage x y h? at until? />`. 문장이 실제 모습·크기·색·질감을 말할 때만, 빈 쪽에, 최소 3초. 지정 장면(★)은 반드시 한 번. `footage` 없으면 쓰지 않는다.
**박자** — 대상은 말할 때 나타나고(`atFromWords`) 박자가 끝나면 물러난다. 마지막 15프레임은 새로 나타나는 것 없이.
**id·seed** — 새 id 는 장면 키 접두사(`s012-…`). 같은 나무를 이어 그리려면 같은 seed·h·age(`hardiness-big`). `url(#…)` 은 접두사 또는 키트 공용 `b-…` 만.
**결정성** — `Math.random`·`Date`·네트워크·이미지·`<filter>` 금지.
**하지 말 것** — 가짜 원근 회전, 납작한 도형으로 부품 흉내, 사람 얼굴·브랜드.

## 4. 식물 규칙(필수)
- **식물은 반드시 종 프리셋으로 그린다** — `species="persimmon"`(감나무, 기본)·`"blueberry"`. 임의 모양·다른 수종 흉내 금지. 프리셋 없는 수종은 `species="generic"`(일반 활엽수)로 그리고 장면 주석에 '일반형'이라 적는다.
- **계절 = 문장의 때.** 겨울·늦가을(잎 진 뒤) = `season="winter"` — **잎·열매 없음, 겨울눈만.** 봄 = 새잎, 여름 = 잎 가득, 가을 = 잎 일부 + 감. 잎이 지는 박자는 `FallingLeaves` + 그 뒤 `season="winter"`.
- **나이** — `sapling` = 1~2년 접목묘(굵기가 가늘어지는 외줄기·접붙인 혹(접수가 살짝 비켜 꺾임)·짧은 곁순 3~6·어긋난 겨울눈과 잎자국, `suckers` = 대목 움), `young` = 3~5년(가는 몸통·곧추선 원가지·큰 낱잎·매끈한 회갈색 껍질 + 껍질눈), `mature` = 성목(6~14m, 거북등 껍질 — 실물(공개 도감 사진) 대조로 다시 그림(B5): 회갈색 몸통이 작고 불규칙한 비늘 조각(세로로 조금 긴 다각형, 격자 아님)으로 갈라지고, 세로 골은 굽이치며 짙게(6B)·가로 금은 짧고 어긋나며, 조각 면은 밝은 H 결 빗금·그늘 쪽은 2B 엇빗금, 들뜬 조각 밑 작은 그늘. 조각 크기는 몸통 기준 하나라 원가지일수록 둘레에 조각이 많다·밑동 쪽(뿌리목 퍼짐)은 넓다·넓은 둥근 수관, 잎철엔 가장자리 낱잎 + 속 빗금 톤). **껍질은 나이로 저절로 바뀐다.**
- **잎** — 마디마다 어긋나게 낱장(짧은 잎자루, 각도·비스듬함 제각각). 잎을 덩어리·별 뭉치로 그리지 않는다. 잎꼴은 프리셋이 정한다(감 = 넓은 타원~도란형·밑 둥긂·짧게 갑자기 빠지는 끝·길이:폭 ≈ 1.67, 블루베리 = 작은 타원). 비스듬한 잎은 키트가 '돌아간 잎'(먼 반쪽이 접혀 뒷면·도드라진 맥이 보임)으로 그린다 — 장면이 잎 모양을 따로 흉내내지 않는다.
- **감 달기** — 감은 잎겨드랑이에 꽃받침째 바짝 붙는다(긴 꼭지 금지). 따로 그릴 땐 `PersimmonFruit onTwig={[가지 위 점]}`.
- 달력은 **문장에 나온 달만**(`months={[11]}`).

## 5. 연필 스타일 규칙(키트가 지킨다 — 장면은 부품만 쓴다)
- **3단 톤**(`TONE`): H = 구조선·먼 대상·뒷잎·밝은 해칭, 2B = 윤곽·짙은 해칭, 6B = 가장 앞 강조선·핵심 그림자·접촉 그림자.
- **입체선 해칭**: 원기둥(줄기·가지·뿌리·손가락·화분) = 둘레를 감는 짧은 호, 구(감·뿌리분) = 하이라이트를 도는 고리. 평면 사선은 땅 단면·벽·밑면에만. 해칭 간격 하한 3.4px.
- **명암 5요소**(빛은 늘 왼쪽 위): 하이라이트 = 비움 / 중간 톤 = H 성김 → 2B 촘촘(점점) / 핵심 그림자 = 6B 크로스(외곽선에서 떨어진 띠) / 반사광 = 그늘 쪽 외곽 안 얇은 띠(성긴 2B) / 투영 그림자 = 오른쪽 아래, 접촉이 가장 진하고 멀수록 흐림(`CastShadow`, 땅에 선 나무·화분은 자동).
- **문지름**은 땅 위 그림자·흙 단면 바탕에만. **점묘**는 흙알갱이(위 촘촘·깊을수록 성김). **지우개**(종이색 선) = 감 광택, 껍질 능선, 잎맥.
- **그리는 순서**: H 구조선 → 2B 윤곽 → 해칭 → 6B 강조 → 포인트 색.
- 잎·잔가지처럼 작은 것은 중간 톤 + 외곽선만.

## 6. 도우미 (`./_kit`)
`beat(f, at, dur=18, ease)` · `beatInOut(f, at, until?)` · `mix` · `atFromWords(words, 낱말, fps, 기본)` · `SAFE` · `PB`(색) · `TONE` · `treeBox(seed,h,age)` → `{trunkTop, trunkW, crown, graftY}` · `handScaleFor(식물px, 식물m, boost)` · `mapPoint` · `potGeom`·`sectionGeom`. 부품 `at` 기본 = 처음부터 그려진 상태.

## 7. 부품
### 식물(종 프리셋)
- `Tree {x, y(=땅), h, age, seed, species?, season='winter'|'spring'|'summer'|'autumn', fruit?, bloom?, cultivar='flat'|'round'|'long'(감 품종 모양 — 단감·둥근 감·대봉), suckers?(접목묘 대목 움), at, grow=40, o, roots='none'|'small'|'wide'|'bare'(맨뿌리, 땅 없이)|'ball'(뿌리분), rootW, rootDepth, rootP, store, shadow?, hi:{trunk,crown,fruit,graft,roots,store}}`. (옛 `leaves='full'|'autumn'|'bare'` 도 받음.)
- `LeafDetail {x,y,angle,len,species,at,hi}` 잎 확대(엽형·엽연·맥) · `PersimmonLeaf` · `PersimmonFruit {x,y,r,kind='flat'(단감 — 납작한 둥근 네모·얕은 네 골)|'round'|'long'(대봉 — 아래 뾰족),onTwig?(가지 위 점 — 주면 x·y 대신 꼭지 끝을 거기 붙임),tilt?,at,hi}` (옛 `hang` 은 짧고 굵은 꼭지로 잇는다) · `Fruit {x,y,r,species,hang?,kind?,tilt?,hi}` · `Flower {x,y,size,species,angle,at}` · `FallingLeaves {x0,x1,y0,y1,at,until,n,size}` · `BShrub {x,y,h,seed,berries}`(블루베리 관목).
- (B6) **손바닥 잎·큰 잎 수종**(음나무 등 — `leaf.shape='palmate'`, 잎몸 평균 > 12cm, 잎자루/잎몸 ≥ 0.4)은 키트가 알아서: 부채꼴 갈래(가운데 가장 길고 밑 갈래 짧음·뾰족한 끝·1/3~1/2 깊이 틈·잔톱니) 큰 잎을 긴 잎자루로 **가지 끝에 3~4장 모아** 달고, 가지는 성기고 굵게, 겨울눈·잎자국은 크게 그린다. `habit.prickles` 면 줄기·가지에 가시(성목은 가지만). 장면이 잎·가시를 따로 흉내내지 않는다.
- 종 프리셋 스키마(`species/*.json`): 수형(form·branchAngle·apical·crownWH·heightM·bark·prickles?), 잎(shape·margin·venation·arrangement·widthRatio·tip·base·petiole·sizeCm·veins·peak?(가장 넓은 자리 0~1, 선택)), 꽃(petals·shape·calyx·stamens·inflorescence·position·sizeCm·months), 열매(type·ratio·sizeCm·bearing·months).

### 손
- (2026-10-23 사장님 금지 — 쓰지 않는다. 전체 화면 장면 검사에서 막힌다. 손 동작이 꼭 필요하면 실촬영 끼움 카드로.) `Hand {x, y, pose, side='right'|'left', glove?, scale, angle, curl?, layer='all'|'back'|'front', at, hi, sleeve}` — 3D 뼈대 손(마디·손톱·주름·엄지 맞섬). pose: `hold`(세로 줄기 쥠 — (x,y)=줄기 중심), `shears`(전정가위), `pinch`(엄지·검지 끝 = (x,y)), `open`(가운데손가락 끝 = (x,y), 뿌리분 풀기 — 마주 선 사람의 두 손: 오른손(기본)은 뿌리분 **왼쪽**에 팔이 왼쪽 위에서, `side="left"` 는 오른쪽. 손등이 보이고 손가락은 벌려 갈고리로 굽음), `pour`(오므린 손바닥), `point`(검지 끝 = (x,y)), `press`(손바닥 밑 = (x,y) — 옆에서 본 손이 흙에 납작, 팔은 오른쪽 위에서. 묘목 줄기 오른쪽 50~80px 에 둔다).
- **줄기를 쥘 때**: `<Hand layer="back"/>` → `<Tree/>` → `<Hand layer="front"/>`(같은 x,y·scale). 크기 = `handScaleFor(묘목 h, 1.2, 1.5~2)` — **실제 비율의 1.5~2배까지만**(3배 금지). 나타난 뒤 손가락이 저절로 오므린다(`curl` 로 직접도).
- (B4) 손가락은 끝으로 가늘어지며(끝 ≈ 뿌리의 0.65) 마디에서 둥글게 굽고, 손등 쪽 관절 혹·바닥 쪽 마디 살·작은 손톱(손끝 살이 앞으로)·가운뎃손가락이 가장 김. 바깥 실루엣만 굵고 접힌 마디 안쪽 선은 가늘게, 윤곽은 군데군데 끊긴다. 손바닥은 얇고 두툼한 엄지 두덩·가로 아치, 손등 힘줄. 장갑은 마디·뿌리 관절 주름이 진하다.
- 손목은 손바닥보다 좁고 팔은 차츰 굵어진다. `sleeve`(mm) = 천 소맷부리(물결 입술·박음질·주름) 길이 — 먼 끝은 흐리게 사라지므로 160~240 을 준다(0 = 맨팔, 끝이 흐려짐). `glove` = 작업 장갑(짜임 손목·솔기·마디 주름). 작게 그릴수록 빗금이 저절로 성겨진다.

### 땅·날씨·도해
- `GroundSection {x0,x1,y,depth,frost,frostHi,grass,seed,children}` 문지름 바탕 + 점묘 흙 · `GroundLine` · `CastShadow {x,y,w,len}` · `StrawWrap {x,y0,y1,w,p,hi}`(볏짚 세로 다발을 위·가운데·아래 새끼줄로 묶은 모양 — 묶은 곳 잘록, 위·아래 짚 끝 흩어짐, p = 아래에서 위로 감김. 너비 = `treeBox().trunkW` + 20~30) · `Snowfall` · `Snowflake` · `Sun` · `Drop`.
- `KoreaMap {x,y,h,region,regionP,dots}` · `MonthStrip {x,y,months,hiMonth,hi,cell}` · `Reserve {x,y,w,h,value,hi}`.
- `BPot` · `BPotBottom` · `BPotSection` · `BRootBall` · `BSack` · `BFall` · `PLine`.
- labels 층: `BLabel` · `BArrow` · `BDim` · `BMark` · `BLeader` · `BPhScale`.

## 8. 짜임
- 크기 비교: 같은 땅 위 `sapling` 과 `mature`, 키는 `BDim hi`. 땅속: `GroundSection` 안 `Tree roots`·`rootP`·`hi.roots`.
- 손에 든 묘목: `roots="bare"`(땅 없이 든 맨뿌리 묘목 — **손은 그리지 않는다**, 2026-10-23 사장님 금지). 만져 보는 자리: 접붙인 자리(`treeBox().graftY`)·뿌리에 `BArrow`·`BLeader` + 그 박자에 `hi.graft`·`hi.roots`.
- 시점 전환: 앞 그림 `scale(1 → 0)` → 새 그림 `scale(0 → 1)`.
