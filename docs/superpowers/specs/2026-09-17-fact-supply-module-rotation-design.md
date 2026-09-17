# 글감 공급·구성 로테이션·읽을 거리 축 설계 — "수종만 바뀐 같은 글" 끊기 (2026-09-17)

## 0. 배경과 진단

사장님(2026-09-17): **"수종도 그렇지만 글의 내용이 모두 거기서 거기야."** 이어서 **"재배 방법 이외에 수종과
관련된 재밌는 읽을 거리(전설·꽃말 등) 글감 다양화 필요."**

실측(최근 75편 블로그 초안, 2026-08-18~09-17):

- **문장 반복은 아니다.** 10자 조각이 직전 20편과 겹치는 비율 2.6%, 3편 이상에 같은 문장 2개. 스타일지문·
  상투구·어간·마무리 회피 가드는 제 몫을 한다.
- **반복은 내용 모듈 수준이다.** 본문 기준 묘목·뿌리목·접목부 보는 자리 80% · "잎 진 뒤 / 첫해엔 참아라"
  78%(소제목 기준 59%) · 마당 vs 화분 61% · 거름은 가지 끝 둘레 60% · 이름·닮은 나무 구별 37%. 6개 모듈 중
  5개 이상을 담은 글이 44/75. 09-04 엄나무 글과 09-17 음나무 글은 유사주제·스타일지문·마무리회피 가드가
  전부 주입됐는데도 핵심 소재 7개 중 6개가 같다 — 가드는 문구와 소제목만 바꿨다.
- **원인 ① 사실 기아.** 리서치팀 역할 정의가 검색량·경쟁도·SERP(키워드팀). 9/1 이후 37편의 사실 카드:
  식물 사실 평균 3건 vs 검색 메타 11건, 9편은 식물 사실 0건(음나무·호두나무 포함). 음나무 런의 도구 호출
  17회는 전부 검색광고·데이터랩·자동완성, `web` 0회. 브리프 게이트는 기록된 10건 전부 반려("근거 자료
  0건·집필 불가")지만 2026-08-28 결정으로 집필은 진행된다. 작가 지침 "브리프에 없는 사실은 일반론으로만"
  → 2,000~3,000자를 어느 나무에나 맞는 일반론으로 채운다. 위키 수종 페이지는 우리 글의 요약이라 순환한다.
- **원인 ② 모든 축을 한 글에.** `buildGenreGuide`(org.ts)가 "최소 한 섹션은 다른 축으로 + 구매 주제면
  첫 계절·실패·회복까지 + 오늘 할 행동 하나"를 매 글에 요구하고, 페르소나가 "실천 제안 + 다음 글 예고"로
  닫게 한다. 각도가 무엇이든 같은 5~6개 모듈로 수렴한다. 기존 가드는 표면(도입 유형·인용 위치·표/체크리스트
  온오프·문형)만 바꾸고, 수종이 다르면 `priorCoverage`는 애초에 안 걸린다.
- **원인 ③ 이야기 글감의 구조적 배제.** `topicThemes` 24축 중 22축이 재배·관리(예외: 단풍·꽃·감상, 나무
  알아보기·상식). 아이디어 두뇌 프롬프트는 "정보/하우투·리뷰"·"실용적인 주제(하우투/비교/리뷰/체크리스트)"만
  요구하고 `IDEA_ANGLES` 7종이 전부 실용이다. 작가용 `genreAxes`엔 "이름·꽃말·유래 이야기" 축이 있지만
  두뇌는 그 목록을 보지 않는다. 최근 30일 73편 중 이야기 글은 0편.

사장님 확정(2026-09-17):
1. 둘 다 고친다 — **사실 공급부터**, 그다음 구성 로테이션.
2. 재배 사실을 모았는데도 기준 미만이면 **주제 바꿔 재시도**(슬롯 유지·생산량 유지·실패 이력은 리서치
   순서에 반영). 8/28의 "반려여도 집필 진행"을 자율 런에 한해 뒤집는다.
3. 구성은 **최근 N편에 쓴 모듈 금지** 방식(수종·축 날짜 규칙과 같은 원리).
4. 재배 방법 이외의 읽을 거리(전설·꽃말·유래·역사 등)를 글감에 넣는다.

## 1. 범위

| # | 항목 | 성격 |
|---|---|---|
| ① | 재배·이야기 사실 공급 단계 + 지식백과 커넥터 + 사실 부족 시 주제 교체 | 신규 단계 + 게이트 계약 변경 |
| ② | 내용 모듈 로테이션(최근 5편 금지) + genreGuide 정정 | 바운디드(기존 가드 자리에 추가) |
| ③ | 읽을 거리 축 — topicThemes 확장 + 두뇌 프롬프트·각도 메뉴 + 수종 앵커 게이트 보강 | 바운디드 |

범위 밖: URL 본문 fetch 도구(스니펫·백과 설명만 쓴다), 발행된 글 소급 수정, 검토 탭 UI 배지, 카드뉴스·쇼츠
파생물의 모듈 로테이션(원문이 달라지면 따라온다), 이야기 글 비율 강제 쿼터(§3-5 관측 뒤 결정).

## 2. ① 사실 공급(fact supply)

### 2-1. 원칙

- **코드가 검색하고, LLM은 추출만 한다.** 에이전트 루프(도구 호출 자율)가 아니라 결정적 질의 목록 →
  검색 커넥터 → 1회 JSON 추출. 출처 URL은 검색 결과에 실제로 있던 것만 채택한다(날조 URL 결정적 차단).
- 수종에 **고유한** 사실만 센다. "물 빠짐이 좋아야 한다" 같은 범용 원예론은 0점.
- 두 종류를 함께 모은다: `cultivation`(자생지·내한성·토양·광·수형·생장·개화 결실·전정 시기·병해충·번식·
  주의) + `lore`(전설·설화·이름 유래·꽃말·상징·역사·문화·쓰임새·문학·명소).

### 2-2. 커넥터 `src/grounding/naver_encyc.ts`

네이버 검색 API 지식백과(`/v1/search/encyc.json`, 같은 `NAVER_CLIENT_ID/SECRET`). `naver_search.ts`와
같은 꼴: `naverEncycEnabled()`, `naverEncyc(query, display=5, signal) → Array<{ title; link; description }>`.
실패·미설정은 `[]`(fail-open). `registerConnector`로 `naver_encyc` 그라운딩에도 등록하고 `YAML_TOOLS`·
`tools.ts` 도구 설명에 이름을 추가한다(역할 편집 시 도구 소실 방지 주석의 규칙).

### 2-3. 모듈 `src/content/factSupply.ts`

```ts
export type FactKind = 'cultivation' | 'lore';
export interface SuppliedFact { text: string; kind: FactKind; source: string; url: string; specific: boolean }
export interface FactSupplyResult {
  status: 'ok' | 'skipped' | 'error';
  subject: string;            // 수종명 또는 소재(수종 없는 주제)
  species?: string;           // findSpeciesLoose 적중 시
  queries: string[];
  resultCount: number;
  facts: SuppliedFact[];
  specificCount: number;      // specific && 유효 URL
  error?: string;
  checkedTs: string;
}
```

- `factSubjectOf(topic, keyword)` — `findSpeciesLoose(topic+keyword)?.name` → 없으면 keyword(2어절 이하)
  → 없으면 제목 앞 어절. 순수.
- `factQueriesFor(subject, species?)` — 결정적 질의 ≤ 8: `"{s} 재배"`, `"{s} 특성 자생지"`, `"{s} 심는 시기
  토양"`, `"{s} 전정 시기"`, `"{s} 병해충"`, `"{s} 전설 설화 유래"`, `"{s} 꽃말 상징"`, `"{s} 쓰임 역사"`.
  수종이 없으면 앞 3개만(재배·특성·주의). 순수.
- `collectSearchResults(queries, signal)` — 질의마다 `naverEncyc`(5) + `webSearch`(5), URL 기준 dedupe,
  총 40건 상한. 각 결과에 1부터 번호를 매긴다.
- `extractSuppliedFacts(model, subject, results, signal)` — `microJSON` 1회(standard 모델): 결과 목록을
  번호와 함께 주고 `{facts:[{text, ref, kind, specific}]}`를 받는다. 지시: 검색 결과에 **적힌** 내용만,
  ref 는 결과 번호, `specific` 은 "{subject}에만 해당하는가"(범용 원예론이면 false). 코드가 ref 유효성을
  검사해 URL·출처명(결과 title 또는 host)을 붙인다. ref 가 없거나 범위 밖이면 버린다.
- `isSpecific(fact, species?)` — 수종이 있으면 LLM 태그와 무관하게 **텍스트 또는 출처 제목에 수종명·별칭이
  나와야** specific. 수종 없는 주제는 LLM 태그를 따른다. 순수.
- `factSupplyBlock(r)` — 브리프에 붙일 마크다운:
  `## 재배·이야기 사실 조사(자동 수집)` + `- [재배] 사실 (근거: 출처명, URL)` / `- [이야기] …`. 기존
  `extractFactCard`가 URL·기관명 붙은 줄을 그대로 집어가므로 카드 형식 변경 없음.
- `writeFactSupply(runId, r)` / `readFactSupply(runId)` — `data/sessions/<run>/fact_supply.json`(fail-open).

### 2-4. org.ts 훅

`runOrg`에서 `brief` 조립 직후, **`writeResearchBrief` 앞**(리비전 런이 `baseRunId`의 research_brief.md를
재주입하므로 사실 블록이 파일에 함께 남아야 한다), `extractFactCard` 앞:

```
if (CONFIG.factSupply && !research && !opts.revise && brief.trim()) {
  const fs = await supplyFacts({ topic, keyword: opts.keyword, model: assign.standard, signal });
  writeFactSupply(bus.runId, fs);
  if (fs.status === 'ok') brief += '\n\n' + factSupplyBlock(fs);
  log `[사실공급] "${topic}" — 고유 사실 ${n}건(재배 a·이야기 b) / 결과 ${resultCount}건 / 질의 ${q}개`
  if (fs.status === 'ok' && fs.specificCount < CONFIG.factMinSpecific) {
    if (opts.factStrict) throw new FactStarvedError({ topic, count, need, species })
    else mustFix.push(`고유 사실 ${count}건(기준 ${need}) — 일반론으로 채우지 말고 있는 사실 안에서 짧게`)
  }
}
```

- `status === 'error'`(커넥터 전멸·LLM 실패)는 **보류하지 않는다** — 종전 동작으로 집필(로그에 사유).
  일시 장애가 생산을 멈추면 안 된다(8/28 원칙 유지). 정말 검색해서 안 나온 경우만 부족이다.
- 작가 지침(`buildBlogBodyGuide`)에 한 줄: "[재배·이야기 사실 조사]가 있으면 그것을 본문의 뼈대로 쓴다.
  어느 나무에나 맞는 일반론으로 섹션을 채우지 마라 — 고유 사실이 없는 소주제는 짧게 지나가거나 뺀다."
- `RunOptions`에 `factStrict?: boolean` 추가. main.ts `launchRun`이 `opts.auto && !piece?.userTriggered`
  로 계산해 넘긴다. 사용자가 직접 띄운 런은 절대 보류하지 않는다(지시한 주제를 시스템이 거절하지 않는다).

### 2-5. 사실 부족 → 주제 교체 (main.ts · scheduler.ts)

- `FactStarvedError`(org.ts export, `name='FactStarvedError'`, 필드 `count·need·species`).
- main.ts 런 catch 에서 transient 판정보다 먼저 분기:
  - piece → `stage: 'error'`, `errors: MAX`, `error: '사실 부족(고유 사실 2건 < 5)'`,
    `factStarved: { ts, count, need, species }`(Piece 타입에 선택 필드 추가).
  - 로그 `[사실공급] "제목" — 고유 사실 2건 < 5 → 집필 보류, 주제 교체`. `notify` 는 보내지 않는다(연속 2회
    상한까지는 조용히; 상한 초과 시 1회 알림 "이번 주기 건너뜀 — 사실 부족 2연속").
  - `run_done { status: 'error' }` 유지(대시보드 상태 종류를 늘리지 않는다).
  - 자율 런이면 `consecutiveStarved++` 후 `< CONFIG.factSupplyRetry` 이면 `autoCycle.runNowPersistent({ label:
    '사실 부족 재시도', userTriggered: false })`. 카운터는 자율 런이 사실 부족 없이 끝나거나 타이머 틱이 돌면 0.
- scheduler 후보 루프에 게이트 추가(수종 앵커 게이트 옆): `factStarvedRecently(text)` — 최근
  `CONFIG.factStarvedDays`(기본 14) 안에 `factStarved` 기록된 piece 의 수종과 같으면 기각
  `아이디어 기각(사실 부족 수종) — "제목" (음나무 3일 전)`. `rotationItems`는 error 조각을 빼므로 이 검사는
  piece 목록을 직접 읽는 별도 순수 함수(`factStarvedSpecies(pieces, speciesOf, now, days)`).
- 두뇌에게도 알린다: 기각 사유 노트(`rejects`)에 남겨 다음 라운드가 같은 수종을 다시 내지 않게.

### 2-6. 설정(config.ts · .env)

| 키 | 기본 | 뜻 |
|---|---|---|
| `FACT_SUPPLY` | on | 킬스위치. off 면 단계 자체를 건너뛴다(종전 동작). |
| `FACT_MIN_SPECIFIC` | 5 | 고유 사실 하한(재배+이야기 합산). |
| `FACT_SUPPLY_RETRY` | 2 | 연속 사실 부족 재시도 상한. |
| `FACT_STARVED_DAYS` | 14 | 사실 부족 수종 재제안 금지 창. |

## 3. ② 내용 모듈 로테이션

### 3-1. 모듈 카탈로그 (`data/brands/bionditree.yaml` → `contentModules`)

`topicThemes`와 같은 꼴 `{ name, match[] }`. 초기 9개:

| 모듈 | 매치 토큰 |
|---|---|
| 묘목 보는 자리 | 묘목, 뿌리목, 접목부, 접붙 |
| 화분 vs 마당 | 화분 |
| 시기 미루기(잎 진 뒤) | 잎이 진, 잎이 다 진, 낙엽 진, 잎 진 뒤, 낙엽이 끝 |
| 첫해 참기 | 첫해, 첫 해 |
| 이름·닮은 나무 구별 | 구별, 구분, 헷갈, 한 나무, 같은 나무 |
| 오늘 할 일 하나 | 오늘 할, 오늘 그루, 말뚝, 리본 |
| 다음 편 예고 | 이어지는 편, 따로 적겠, 다음 편, 다음 글 |
| 거름 자리(가지 끝 둘레) | 가지 끝 아래, 가지 끝이 그리는, 수관 둘레, 밑동은 비우 |
| 자르는 자리(눈 위) | 눈 하나 위, 눈 위 |

`brand.ts` 로더에 `contentModules?: ContentModule[]` 추가(없으면 빈 배열 = 로테이션 무동작).

### 3-2. 모듈 `src/content/contentModules.ts` (순수 + 스토어 리더)

- `modulesInBody(body, modules)` → `string[]` — 모듈이 "있다"는 판정: 토큰이 **소제목(##/###)에 나오거나
  본문에 3회 이상**. 지나가는 언급 1회는 안 센다. `themeInText`와 같은 NFC·공백 제거 문자열 매칭, LLM 없음.
- `modulesToAvoid(recentBodies, modules, topicText)` → `string[]` — 최근 N편 본문에서 나온 모듈의 합집합에서
  **주제 제목·키워드에 토큰이 있는 모듈은 제외**("음나무 묘목 고르기"에서 묘목을 막지 않는다).
- `moduleAvoidBlock(names, modules)` → 프롬프트 블록:
  `[이번 글 금지 모듈] 최근 글들에 이미 쓴 다음 소재는 이번 글에서 섹션·문단으로 다루지 마라(한 문장 언급도
  피한다): 화분 vs 마당(화분…), …. 이 소재가 정말 필요하면 그건 다음 글의 몫이다.`
- `recentModulesToAvoid(brandSlug, topicText, limit = CONFIG.moduleRecentPieces)` — `recentBlogEndings`와 같은
  자리·같은 fail-open: `pieceStore().list()` 최신부터 `blogBodyOf(runId)` 로 본문을 읽어 limit 편.

### 3-3. 주입 (org.ts `writeBlogBody`)

`endingAvoid`·`phraseAvoid` 옆에 `moduleAvoid`(revise 제외, `CONFIG.moduleRotation` off 면 빈 문자열).
`context` 배열에 추가. `작가 다양성 가드` 로그 줄에 ` · 금지모듈 N건(화분 vs 마당, 첫해 참기 외)` 덧붙임.

### 3-4. `buildGenreGuide` 정정

빼는 문장: "최소 한 개 섹션은 다른 축으로 쓴다", "구매 주제라면 심은 뒤 첫 계절에 실제로 하는 일, 그때
흔한 실패와 회복까지 이어서 다룬다". 넣는 문장: "이 글은 제목이 약속한 축 하나만 다룬다. 다른 축의 섹션을
덧붙이지 말고, 그 축 안에서 [재배·이야기 사실 조사]의 고유 사실로 깊이를 낸다." "독자가 오늘 해볼 행동
하나"는 유지하되 인자 `avoidTodayAction` 이 true(금지 모듈에 '오늘 할 일 하나'가 있을 때)면 뺀다.
관찰·이야기 예외 문장은 §4-4에서 확장.

축을 골고루 쓰라는 첫 문장은 남긴다(주제 단계 얘기라 무해).

### 3-5. 설정

| 키 | 기본 | 뜻 |
|---|---|---|
| `MODULE_ROTATION` | on | 킬스위치. |
| `MODULE_RECENT_PIECES` | 5 | 금지 목록을 만들 최근 편 수(하루 2~3편 → 약 이틀). |

## 4. ③ 읽을 거리 축

### 4-1. `topicThemes` 확장 (`data/brands/bionditree.yaml`)

추가 5축(토큰은 제목·키워드 분류용):

| 축 | 매치 토큰 |
|---|---|
| 전설·설화·민담 | 전설, 설화, 민담, 옛이야기, 신화 |
| 꽃말·상징·이름 유래 | 꽃말, 상징, 유래, 이름의 뜻, 왜 ~라 부르 |
| 역사·문화·쓰임새 | 역사, 궁궐, 서원, 마을 나무, 목재, 약재, 쓰임, 풍습 |
| 문학·예술 속 나무 | 시, 소설, 그림, 노래, 시조, 민요 |
| 명소·군락지·풍경 | 명소, 군락, 가로수길, 숲길, 천연기념물, 보호수 |

`themeRotationBlock`(안 다룬 축 우선)·`themeRecentBlock`(7일 창)이 자동으로 이 축들을 앞세운다 — 새 축은
0편이라 우선 제안 대상이 된다. 별도 쿼터는 두지 않고 2주 뒤 `rotation_report.ts`로 본다(이야기 5축 합이
전체의 15% 미만이면 쿼터를 후속 결정).

### 4-2. 두뇌 프롬프트·각도 메뉴 (scheduler.ts)

- 시스템 문구 "네이버 블로그(정보/하우투·리뷰) 콘텐츠 아이디어" → "네이버 블로그 콘텐츠 아이디어(정보·
  하우투·리뷰와 **읽을 거리** — 전설·설화·꽃말·유래·역사·쓰임새·문학·명소처럼 수종과 얽힌 이야기)".
  "검색 의도가 뚜렷하고 실용적인 주제" → "실용 주제와 읽을 거리를 섞어라. 이야기 후보의 keyword 는 수종명
  그대로(예: keyword "회화나무" + 제목 "회화나무가 선비의 나무가 된 이유")."
- `IDEA_ANGLES`에 `'읽을 거리(전설·설화·꽃말·유래·역사·쓰임새·문학·명소 속 이 나무)'` 추가.

### 4-3. 수종 앵커 게이트 보강 (`lacksSpeciesAnchor`)

- 트리거를 `꽃말|유래|전설|설화|민담|신화` 로 넓힌다.
- 앵커 판정을 `findSpeciesLoose(text)` 적중 **또는** `○○나무` 로 한다 — 능소화·무궁화·해당화·산수유처럼
  '나무'로 안 끝나는 수종의 이야기 글이 기각되지 않게. 화초 미끄러짐은 브랜드 금지 목록(꽃 모종·구근)이
  계속 막는다.

### 4-4. 작가 지침의 이야기 글 예외 (`buildGenreGuide`)

"개화·단풍·낙엽처럼 나무가 스스로 하는 일을 다루는 관찰·이야기 글은 예외" → "관찰·이야기 글(개화·단풍·낙엽
관찰, 전설·설화·꽃말·유래·역사·쓰임새·문학·명소)은 예외 — 심기·전정 지시로 억지 마무리하지 말고 이야기가
가리키는 것(지금 어디서 무엇을 보면 되는지, 그 나무를 마당에 들일 때 이야기가 남긴 한 가지)으로 끝내도
좋다." 결론 의무(무엇을 주장하는지)는 그대로.

사실 게이트: 전설·꽃말은 `kind: 'general'`이 아니라 근거 필요 주장으로 취급되지만, §2에서 [이야기] 사실이
카드에 들어가므로 supported 로 통과한다. 카드에 없는 전설을 지어내면 지금처럼 hold — 의도된 동작.

## 5. 실패 처리·킬스위치 요약

| 상황 | 동작 |
|---|---|
| 커넥터 전멸·추출 LLM 실패 | `status:'error'`, 보류 없이 종전 집필. 로그에 사유. |
| 사실 부족 · 자율 런 | 런 error 종료 → piece error+factStarved → 즉시 다음 틱(상한 2). |
| 사실 부족 · 사용자 런 | 집필 진행, `mustFix`에 표시 → 검토 알림에 노출. |
| 재시도 상한 초과 | 이번 주기 건너뜀 + 알림 1회. 다음 타이머 틱에서 카운터 0. |
| `contentModules` 없음/`MODULE_ROTATION=off` | 금지 블록 빈 문자열, genreGuide 정정 문구는 유지. |
| `FACT_SUPPLY=off` | 단계 생략, `factStrict` 무시, 종전 동작. |

## 6. 테스트·검증

단위(vitest, 순수 함수 위주):
- `factSupply`: `factSubjectOf`(수종/키워드/제목 폴백), `factQueriesFor`(수종 유무), ref 검증(범위 밖·중복
  버림, URL 부착), `isSpecific`(수종명 없는 문장 false, 별칭 true), `factSupplyBlock` 형식, 임계 판정.
- `naver_encyc`: 응답 파싱·태그 제거·미설정 시 `[]`.
- `contentModules`: 소제목 1회/본문 3회 규칙, 언급 1회 미판정, 주제 예외, 5편 창 합집합, 빈 카탈로그.
- `scheduler`: `factStarvedSpecies` 14일 창·같은 수종 기각·다른 수종 통과, `lacksSpeciesAnchor` 확장
  (능소화 꽃말 통과, 튤립 꽃말 기각, 회화나무 전설 통과).
- `org`: `buildGenreGuide(axes, teaser, avoidTodayAction)` 문구 스냅샷(다른 축 섹션 문장 부재, 오늘 행동 온오프).
- 기존 `pnpm test` 전부 통과, `pnpm typecheck` 통과.

실검증(서버 재기동 뒤):
1. 자율 틱 1회 수동 실행 → 로그에 `[사실공급] … 고유 사실 N건` · `작가 다양성 가드 … 금지모듈 N건` 확인,
   `fact_supply.json`·`fact_card.md`에 [재배]/[이야기] 줄이 들어갔는지 확인.
2. 사실이 거의 없는 수종을 골라(예: 보관소의 희귀종) 부족 경로 1회: piece error+factStarved, 다음 틱 즉시
   기동, 같은 수종 기각 로그.
3. 열흘 뒤 `scripts/rotation_report.ts`에 모듈 분포 표(§3-1 카탈로그 기준 최근 30일 포함 비율)를 덧붙여
   기준선(묘목 80%·잎 진 뒤 78%·화분 61%)과 비교. 이야기 5축 비율도 같은 표에.

## 7. 손대지 않는 것

structureSeed(표·체크리스트·예고 2/3), styleAvoid·상투구·어간·마무리 회피, 페르소나 본문, 사실 게이트의
`hedged_general` 통과 규칙, 브리프 게이트 재작업 루프, 수종·축 날짜 창. 모두 지금 제 몫을 하고 있고 이번
원인이 아니다.
