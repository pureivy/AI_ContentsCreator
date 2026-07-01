<!-- 생성: 멀티에이전트 코드베이스 분석 워크플로 · 8/10 서브시스템(infra·orchestrator-agent는 API 과부하 실패) · 위험 high 18/medium 28/low 17 -->

# gepa-ai-office 코드베이스 분석 리포트

## 한눈에

gepa-ai-office는 **로컬 우선(local-first) 멀티에이전트 AI 오피스**다. 사용자가 던진 주제 하나를 CEO→팀→팀원 3계층 조직으로 분해·배정·실행하고, 각 계층의 산출물을 합성해 한국어 보고서(필요 시 HWPX 공문서)로 내보낸다. 핵심 차별점은 두 가지다. 첫째, Ollama 로컬 모델을 RAM 예산 내에서 micro/standard/heavy 3-tier로 자동 배정해 클라우드 LLM 없이 동작한다. 둘째, 런 결과가 휘발되지 않고 세션 다이제스트·LLM Wiki(Karpathy 패턴)·직원별 `memory.md` 자가학습으로 **누적(compounding)**되어 다음 런의 컨텍스트를 강화한다. 토론(debate) 모드와 조직(org) 모드 두 실행 엔진을 `prepare→run→finalize` 공통 파이프라인으로 공유한다.

규모는 백엔드 TypeScript(Hono 서버 단일 파일 `main.ts`, 오케스트레이터 6개 모듈, LLM/Wiki/Grounding/Autonomy/Export 레이어)와 React 프론트엔드(이벤트소싱 store + reducer, 1579줄 `App.tsx`, 8개 시각화 패널)로 구성된다. 기술스택은 Hono + SSE(서버), Zustand + @microsoft/fetch-event-source(프론트 이벤트소싱), Ollama HTTP API(LLM), YAML 기반 조직 정의, 의존성 없는 자체 ZIP/HWPX 라이터다. 외부 패키지를 최소화하고 Node 표준 라이브러리(fs/crypto/zlib)로 대부분을 직접 구현한 점이 일관된 설계 철학으로 드러난다.

**전반적 성숙도: 잘 설계된 단일 사용자 로컬 프로토타입이며, 동시성·다중 인스턴스·장기 운영을 위한 하드닝은 아직 미완.** 강점은 명확하다 — 관심사 분리(prepare/finalize 공유로 중복 0), 순수 함수 이벤트소싱(라이브·리플레이·스크럽이 동일 코드 경로), opt-in 기능 플래그(기본 경로 무영향), 일부 원자적 쓰기(`company.yaml` tmp+rename). 그러나 전체 위험 63건(high 18 / medium 28 / low 17)을 관통하는 구조적 약점이 반복된다: (1) **모듈 레벨 싱글톤 캐시가 런타임에 갱신 불가**, (2) **단일 스레드를 암묵 전제**한 동시성 처리, (3) **컨텍스트 슬라이스 절단이 조용한 정합성 오류로 전환**, (4) **AbortSignal 전파 누락**. 인터넷 노출이나 worker_threads 도입 시 즉각 문제로 전환될 항목이 다수다.

## 아키텍처

**핵심 제어 흐름 (런 요청 → 산출물)**

```
POST /runs (main.ts: startHandler)
  → launchRun: 유휴 게이트(auto/user 충돌 락-프리 해소)
  → createBus(id) + startRun(bus, opts)
      └─ prepareRun (prepare.ts)
            · Ollama 모델 목록 조회 → autoAssignModels로 micro/standard/heavy 배정
            · standard 모델로 주제 decompose → subproblems[]
            · run_started·company_started·topic_decomposed emit
      └─ runOrg (org.ts)  [또는 runOffice (run.ts, debate 모드)]
            1. CEO 라우팅: microJSON 1회 → 부서별 task+acceptance
            2. 팀별 병렬 실행 (mapLimit teamParallel):
                 분해(microJSON) → 1:1 배정(consumed Set+remaining 큐)
                 → 팀원 작업(mapLimit concurrency) → 팀장 종합
            3. (opt-in) 팀 토론: critic 교차비평 → 팀장 rebuttal
            4. 회사급 비평
            5. CEO 섹션별 합성: outline → 섹션마다 runAgent (위키 groundQuery)
            6. 데이터 검증 패스: 결산 원문 대조 감사 → 검증 메모 appendix
      └─ finalizeRun (finalize.ts)
            · (opt-in) 승인 게이트(approvalStore Promise 대기)
            · writeDigest → LLM Wiki ingest → reflectAndLearn(await)
            · run_done emit → wiki maintain(fire-and-forget)
```

**데이터 흐름의 핵심 불변식**: 모든 LLM 호출은 `ollama.ts:21`의 전역 `LLM_SLOT = new Semaphore(CONFIG.concurrency)`(로컬=1)를 통과한다. 다수 에이전트가 병렬로 스폰되어도 Ollama KV 슬롯은 항상 하나만 점유 — 이것이 로컬 모델 RAM 폭주를 막는 시스템 전체의 단일 게이트다. `num_ctx`를 요청에 절대 포함하지 않는 원칙(요청별 옵션 변동이 모델 리로드를 유발한다는 실측 교훈)도 코드와 주석 양쪽에 제도적으로 고정돼 있다.

**SSE 라이브 / 리플레이**: 모든 비동기 흐름은 `EventBus`를 통해 phase·delegation·team_deliverable·critique·lesson_learned·run_done 이벤트를 흘린다. 프론트는 이를 `fold(events) → UIState` 순수 함수로 접는다. 라이브(`applyEvent`)·리플레이(`loadReplay`)·새로고침 재접속(`snapshotLive`)·스크럽(`seek`)이 모두 동일 `fold` 코드 경로를 공유하므로 렌더러 간 상태 분기가 구조적으로 불가능하다. `Last-Event-ID` 헤더로 재연결 시 백로그 중복 없이 resume된다.

**자율 사이클**: `startAutoCycle`이 `setInterval`로 틱하며 `isBusy()` 유휴 게이트(이중 확인) → `proposeAutonomousTask`(micro 모델이 위키+결정로그 컨텍스트로 주제 제안) → `launchRun`을 호출한다. 사용자 런이 도착하면 auto 런은 abort되고 양보한다.

**서브시스템 관계**: `config.ts`의 CONFIG 싱글톤이 모든 레이어의 진입점이다. 오케스트레이터는 LLM 백엔드(모델 배정)·company-loader(조직 구조)·workspace(자가학습)·llmwiki(지식)·grounding(외부 데이터)에 의존하고, 서버는 이 전부를 단일 Hono 앱에 노출한다. 프론트는 SSE+REST 양 채널로 서버와만 통신한다.

## 강점

- **공통 파이프라인으로 중복 로직 제거.** `prepareRun`/`finalizeRun`이 org·debate 양 모드에 공유되어, 두 실행 엔진이 준비·마무리 코드를 단 한 줄도 중복하지 않는다. 각 파일이 단일 책임(준비/실행/마무리/학습/토론)을 지킨다.

- **순수 함수 이벤트소싱이 진짜로 순수하다.** `reducer.ts`의 `fold()`가 wall-clock·외부 의존 없이 동작하므로 라이브·리플레이·스크럽·테스트가 완전히 동일 경로를 쓴다. `liveActivity`(ambient 사무실 생활)를 UIState 외부에 분리 보관해 리플레이 정합성을 오염시키지 않은 설계가 이 순수성을 지킨다.

- **LLM 호출 최소화가 구조에 내장돼 있다.** CEO 라우팅·팀장 분해·수렴 판정 모두 `microJSON` 1회 호출(스트리밍 X)이다. 특히 CEO 합성을 단일 heavy 호출이 아니라 섹션별(6~7개) 생성으로 쪼개 로컬 모델의 truncation 문제를 구조적으로 회피한다.

- **단일 KV 슬롯 불변식을 락 없이 보장.** 전역 `Semaphore` 하나(`ollama.ts:21`)와 `CONFIG.concurrency` env 하나로 로컬(=1)/클라우드(=4) 분기까지 처리한다. 스트림 `finally`에서 `reader.cancel()`을 보장해 abort/throw 시에도 소켓 누수가 없다(`ollama.ts:267-270`).

- **중복 배정 방어가 코드 수준에서 차단된다.** `consumed` Set + `remaining` 큐(id 기반 1:1 매칭) 조합으로 동일 작업이 두 팀원에게 배정되는 엣지케이스를 막는다(`org.ts:163-184`).

- **3중 신뢰 경계로 파일시스템/툴 접근 통제.** `safeId()`(경로 탈출 방어) + `ALLOWED_TOOLS` 화이트리스트 + `writeCapabilities()` 범위 클램프(autonomy 0~3). 위키 `getPage`도 `/[/\\]|\.\./` 검사 + `path.resolve` 컨테인먼트 이중 방어.

- **자가학습 compounding이 실시간 반영된다.** `reflectAndLearn`이 `run_done` 전에 `await`되어 교훈 이벤트가 SSE 스트림에 즉시 반영된다. 인원 비례 토큰 계산(`500+roster*220`)으로 다팀 JSON 잘림을 방지하고, `[근거: 출처]` 태그를 `verified.md`로 승격하는 Self-RAG로 근거 있는 사실이 단순 기억보다 우선 신뢰되도록 컨텍스트를 구조화한다.

- **3단계 영속 폴백으로 레거시 런까지 복원.** `run.json` → `events.jsonl` → 레거시 `_report.md` 역파싱. 재시작 후에도 기록 탭이 유지된다.

- **opt-in 일관성과 공급망 최소화.** autoCycle·dailyBriefing·notify·grounding 세 레이어가 미설정 시 모두 no-op이라 기본 경로에 제로 영향. HWPX/ZIP을 외부 패키지 없이 Node `zlib`만으로 조립해 공급망 공격 표면을 최소화하고, 비ASCII 엔트리명 EFS 플래그로 한글 파일명 mojibake를 명시적으로 막는다(`zip.ts:38`).

## 주요 위험·이슈

### HIGH (18건) — severity 최우선, 영향·위치·권고 전체 기술

**데이터 손실 / 영속 무결성**

1. **people.yaml 비원자적 저장 — 충돌 시 비일관 상태.** `company-loader.ts:67`. `company.yaml`은 tmp+rename 원자 저장하지만 같은 `save()` 함수 내 `people.yaml`(실명 매핑)은 직접 `writeFileSync`. company.yaml 저장 성공 후 people.yaml 쓰기 전 충돌하면 구조는 남고 실명만 사라진다. **권고**: people.yaml도 tmp+rename로 통일하거나, 두 파일을 단일 문서로 병합.

2. **DELETE /runs/:id — 빈 id가 sessions 폴더 전체 삭제 시도.** `main.ts:355`. 경로 트래버설 정규식 `/[/\\]|\.\./`은 통과하지만 `id===''`이면 `path.join(sessionsDir, '')`=sessionsDir 자체를 `rmSync(recursive:true)`. **권고**: 정규식 앞에 `if (!id) return 400` 가드 추가.

3. **reviseHandler — 재시작/evict 후 부모 런이 메모리에 없으면 항상 404.** `main.ts:942-943`. `RUNS.get(id)`만 보고 디스크 폴백이 없다(`runGetHandler`는 `loadRunMeta`/`legacyMetaFromFiles`로 복원하는데 revise는 미적용). 완료된 런 수정이 재시작 후 영구 불가. **권고**: revise에도 동일 디스크 복원 패턴 적용.

**보안**

4. **인증 토큰: window.prompt + 비보안 쿠키.** `App.tsx:294-307`. AUTH_TOKEN을 `window.prompt`로 받아 `samesite=lax`로 저장 — Secure 없음(HTTP 전송 가능), HttpOnly 없음(XSS로 JS 읽힘), prompt null 반환 시 조용히 종료. **권고**: HttpOnly Secure 쿠키를 서버가 Set-Cookie로 설정하고 prompt 제거.

**정합성 / 동작 오류**

5. **critic 이중 실행 + 비평 결과 손실.** `org.ts:258-316`. 토론 라운드 비평(258)과 회사급 비평(305)이 같은 critic을 별도 호출. `orgDebateRounds>0`이면 critic이 최소 2회 호출되는데 두 번째 결과만 `critiqueText`에 저장되어 finalizeRun에 전달, 토론 라운드 비평은 synthContext에서도 누락. 불필요한 LLM 호출과 비평 손실이 동시 발생. **권고**: 비평 결과를 누적하거나 호출 의도를 명시(주석/분기)하고 합성 컨텍스트에 포함.

6. **isAbort(e) signal 인수 누락.** `org.ts:296`. 같은 파일 151·219행은 `isAbort(e, signal)`인데 296행만 signal 누락 — 명백한 실수. Ollama 클라이언트가 비표준 형태로 취소를 전달하면 취소가 일반 에러로 처리된다. **권고**: `isAbort(e, signal)`로 수정.

7. **handleLine throw가 마지막 잔여 라인에서 삼켜짐.** `ollama.ts:262-265`. Ollama가 done 대신 error 패킷을 스트림 말미에 보내면 `catch(e){console.warn}`로 에러가 warn 로그로만 남고 빈 text('')가 정상 결과로 반환된다. **권고**: 잔여 라인 처리에서도 OllamaError를 호출자에게 재전파.

8. **synthesis 폴백 분기 side effect — 이중 누적.** `reducer.ts:349-354`. `agent_message`로 synthesis를 세팅한 뒤 `synthesis_chunk`가 지연 도착하면 chunk 델타가 기존 synthesis 위에 추가 누적되어 내용이 이중으로 붙는다. 네트워크 도착 순서 의존이라 재현 불안정. **권고**: synthesis 출처(message vs chunk)를 플래그로 구분해 한쪽만 채택.

**가용성 / 무한 대기**

9. **corp_code ZIP fetch 동시 진입 경쟁.** `dart.ts:21-48`. `_corp` 체크(22)와 할당(44) 사이에 여러 호출이 진입해 중복 다운로드·파싱. 재시작 직후 동시 요청 시 대역폭 낭비·레이스. **권고**: in-flight Promise를 모듈 변수로 잡아 동시 호출이 공유.

**런타임 갱신 불가 (싱글톤 캐시) — 5건**

10. **LLM_SLOT이 모듈 로드 시 concurrency 고정.** `ollama.ts:21`. env/runsettings로 concurrency를 바꿔도 슬롯 수 불변(재기동 필수). 테스트 import 시 슬롯 상태 공유. **권고**: lazy getter로 첫 사용 시 생성하거나 재설정 API 제공.

11. **in-process 캐시 _corp/_cache/_groundCache 갱신 불가.** `dart.ts:17,19`/`custom.ts:36,97`. _corp는 사명변경/상장폐지 반영 불가, _cache는 외부 connectors.json 수정 미반영, _groundCache는 만료 정책 없어 오염 지속. **권고**: TTL 또는 명시적 invalidate 도입.

12. **모듈 싱글톤 캐시 동시성 미보호.** `company-loader.ts:42`. `_doc`/`_people`/`_cached` 전역 변수 — 향후 async 편집 함수 추가 시 구조적 레이스, save() 직후 무효화와 재빌드 사이 중간 상태 노출 가능. **권고**: 편집을 직렬화하는 큐 또는 버전 스냅샷.

**프론트 시각화 파괴 / 정합성 — 4건**

13. **WikiGraphView: fetchWikiPage 에러 처리 누락.** `WikiGraphView.tsx:181`. catch가 없어 네트워크 실패 시 `detailLoading`이 true 고착 → '불러오는 중…' 영구 표시. **권고**: `.catch`에서 `setDetailLoading(false)` + 에러 표시.

14. **OfficeView seatsFor: n>8 default가 8명 좌표와 충돌.** `OfficeView.tsx:68`. 팀원 9명 이상이면 default 발동으로 아바타 겹침(EmployeesView가 인원 제한 없이 추가 허용). **권고**: n>8 동적 좌표 생성 또는 인원 상한.

15. **AgentGraph: CEO 없는 org 런에서 wiki/lessons 노드 고아.** `AgentGraph.tsx:155`. 엣지를 `if(ceo)`로만 생성 — CEO 이벤트 미도착 초기 프레임에서 두 노드가 연결 없이 배치, 멤버→wiki 엣지는 남아 그래프 불일치. **권고**: CEO 없으면 첫 팀장 또는 가상 루트에 연결.

16. **seek() 후진 시 O(n) 전체 재fold — 메인 스레드 블로킹.** `store.ts:101-104`. 장시간 org 런(수천 이벤트)에서 스크럽바 좌측 드래그 시 수백ms 블로킹. **권고**: 스냅샷 체크포인트 또는 requestIdleCallback 분산.

**HWPX 구조 결함**

17. **tableXml이 hp:tbl을 hp:run 안에 삽입 — 한글 비호환.** `hwpx.ts:99`. HWP XML 스키마상 hp:tbl은 hp:p의 직접 자식이어야 하는데 hp:run 내부에 감싸 표가 깨지거나 오류. **권고**: hp:tbl을 hp:p 직속 블록으로 출력하도록 재구조화하고 실제 한글에서 열어 검증.

18. **DART corp_code 첫 호출 동시성** — 9번과 동일 근원(레이스 + 캐시), 영속 무결성 측면에서 high로 분류된 항목. 위 9·11번과 묶어 in-flight 가드 + TTL로 일괄 해소.

### MEDIUM (28건)

| 이슈 | 위치 | 영향 | 권고 |
|---|---|---|---|
| hardcoded 1초 setTimeout, AbortSignal 무시 | org.ts:191 | 취소 시 1초 소모, 팀병렬마다 누적 지연 | signal 받는 delay 헬퍼로 교체 |
| assessConvergence 4000자 슬라이스 | debate.ts:42-48 | 긴 산출물 수렴 오판, confidence<0.6 경고는 로그만 | 슬라이스 확대 또는 diff 기반 판정, 경고를 UI 전달 |
| wiki maintain fire-and-forget AbortSignal 불완전 | finalize.ts:135-139 | run_done 후 백그라운드 호출이 미완료 채 버려짐 | maintain 완료를 추적하거나 abort 즉시중단 보장 |
| runsettings _cached 모듈 전역 오염 | runsettings.ts:18 | 외부 파일 수정·테스트 require 시 미반영 | 파일 mtime 감지 또는 reset API |
| reingest/reclassify/reprocessState 전역 싱글톤 | main.ts:565-636 | 완료~다음 요청 틈에서 상태 덮어쓰기 | 요청별 상태 또는 락 |
| listPersistedRuns 동기 전 디렉토리 순회 | main.ts:276-315 | 세션 수백+이면 GET /runs마다 이벤트루프 블로킹 | 인덱스 캐싱 또는 비동기 페이지네이션 |
| 파일 업로드 25MB 체크가 파싱 후 | main.ts:863 | 초과 파일도 메모리 전부 수신 후 거부 | Content-Length 선제 거부 미들웨어 |
| temperature/topP Number() — NaN 방어 없음 | config.ts:154-155 | 잘못된 env가 NaN으로 Ollama options 오염 | envFloat 헬퍼로 isFinite 검사 |
| autoAssignModels standard=micro 동일 가능 | models.ts:133 | fitting 2개면 mid=smallest, standard 의미 상실 | 짝수 시 상위 절반 인덱스 선택 |
| SystemSpecs 캐시 프로세스 생애 고정 | models.ts:24 | 런타임 RAM 변화 미반영(현재 영향 낮음) | freeRam 기반 로직 도입 시 TTL 필요 |
| LINK_RE 전역 /g lastIndex 오염 | llmwiki.ts:37 | 조기 break 추가 시 다음 호출 오탐색 | 사용처마다 지역 재선언 또는 matchAll |
| rebuildIndex lesson 타입 누락 | llmwiki.ts:292 | index.md에 lesson 섹션 미출력 | byType에 lesson 추가 + sect 호출 |
| search() score 항상 1 반환 | llmwiki.ts:527 | 점수 기반 정렬 호출자에서 랭킹 무력화 | query 실제 score 노출 |
| autoConfigConnector endpoint 미검증 SSRF | custom.ts:183-193 | LLM 생성 내부주소(169.254.169.254 등) 호출 가능 | 프로토콜·호스트 allowlist 검증 |
| recentAuto 중복차단 정규화 없음 | scheduler.ts:131-133 | 조사·어미 차이로 유사 주제 반복, 재시작 시 망각 | 정규화 + 영속화 |
| startDaily 날짜키 getMonth() 0-indexed | scheduler.ts:72 | '2026-0-1' 비표준, 외부 비교 시 버그 | +1 또는 ISO 포맷 |
| zip EOCD entries uint16 truncation | zip.ts:87-88 | 범용 사용 시 65535 초과 조용히 잘림 | 상한 검증 후 throw |
| agentDetail memory/verified 무제한 읽기 | workspace.ts:260 | 장기 운영 시 GET /agents/:id 수십KB | readMemory(id,1000) 제한 헬퍼 사용 |
| removeKnowledge substring 마커 매칭 | workspace.ts:61 | 짧은 마커가 무관 줄 삭제, knowledge.md tailTrim 없음 | 정확 매칭 + tailTrim 추가 |
| buildCompanyDef 회사급 critic 누락 | company-loader.ts:136 | custom company.yaml로 CRITIC 표현 불가 | 최상위 critic 필드 지원 |
| 자율런 폴링이 watchLive 완료 미대기 | App.tsx:587-602 | 6초 초과 시 동일 run_id 중복 watchLive | in-flight 가드 |
| delegation engaged 중복체크 CEO→팀 미구분 | reducer.ts:91-101 | CEO 같은 팀 재위임 시 activity 중복 행 | to===team 분기 별도 처리 |
| fetchApprovals approval_id 빈 문자열 허용 | api.ts:613 | decideApproval('') → /approvals//decide 오작동 | 빈 id 항목 필터 |
| tickerPool ts 파싱 오류 시 break | App.tsx:847 | 잘못된 ts 이후 유효 항목 전부 누락 | continue로 변경 |
| EmployeesView/McpView window.confirm/prompt | EmployeesView.tsx:137 외 | WebView/임베디드서 blocking·suppress | 커스텀 모달 |
| MetricDrawer wiki 재오픈마다 재fetch | MetricDrawer.tsx:68 | bodies 초기화로 본 페이지도 재요청 | 캐시 유지 또는 상위 보관 |
| WikiGraphView autoPauseRedraw=false 상시 렌더 | WikiGraphView.tsx:394 | 970노드서 hover 아닐 때도 상시 CPU | 비강조 시 pause |
| OfficeView 팀간 잡담 첫 두 팀만 | OfficeView.tsx:608 | 3팀+ 우측 팀 경계 잡담 미발생 | teamOrder 순회 일반화 |

### LOW (17건)

| 이슈 | 위치 | 영향 | 권고 |
|---|---|---|---|
| outline 생성에 standard 모델 | org.ts:335 | 같은 역할인데 micro 불일치, 로컬서 지연 가능 | micro로 통일 또는 주석 명시 |
| 데이터 감사 6000/7000자 슬라이스 | org.ts:395-401 | 수만자 산출물 후반 오류 미감지 | 섹션 단위 감사 |
| legacyMetaFromFiles 헤더 포맷 의존 | main.ts:125-126 | 헤더 변경/다국어 시 topic 공백→패널 공백 | 포맷 폴백 다중화 |
| INJECT_TOKEN 에러메시지 메커니즘 노출 | main.ts:525 | 미인증 응답에 설정법 노출(로컬 위험 낮음) | 일반 401 메시지 |
| revise version undefined 충돌 가능 | main.ts:951-954 | 다중 revise 시 동일 version 공존 | version 영속·단조증가 |
| agentShellAllow에 cat/grep 포함 | config.ts:207-210 | AGENT_SHELL=true 시 cat /etc/passwd 통과 | 경로 제한 또는 제외 |
| appendVerified 40자 접두어 중복체크 | workspace.ts:148 | 같은 접두어 주장 false negative | 전체 해시 비교 |
| ensureLoaded 모든 오류 무음 _doc={} | company-loader.ts:63 | YAML/권한/손상 구별 불가, 진단 곤란 | 에러 로깅 + 타입 구분 |
| saveRaw/saveOriginal 동일 파일명 덮어쓰기 | llmwiki.ts:237 | 같은 날 동명 재업로드 시 원본 소실 | 해시 suffix |
| migrateFlat rmdirSync 비-md 시 무음 실패 | llmwiki.ts:134 | 부분 마이그레이션, 재실행마다 반복 | recursive 또는 잔여 처리 |
| _wiki 싱글톤 wikiDir 변경 미반영 | llmwiki.ts:843 | 런타임 경로 변경·테스트 격리 깨짐 | reset API |
| cleanInline HTML 엔티티 이중 인코딩 | hwpx.ts:18-25,47 | `&amp;`→`&amp;amp;` XML 삽입 | 엔티티 디코드 선행 |
| DART API 키 URL 평문 + 로그 노출 | dart.ts:32,65 | HTTP 액세스 로그에 키 잔존 | 서버 로그 마스킹 |
| launchRun '' run_id 반환 가능성 | main.ts:199-200 | 향후 startHandler auto 지원 시 빈 run_id 응답 | 빈값 가드 |
| wikiEdges 배열 인덱스 key | App.tsx:976 | 향후 엣지 삭제/재정렬 시 DOM 불일치 | 안정 key |
| effLlm 인라인 함수 매 렌더 재생성 | App.tsx:346-351 | 최적화 기회 누락(버그 아님) | useMemo |
| LiveNowStrip orphan 작업자 phase 빈 배지 | LiveNowStrip.tsx:98 | PHASE_DOING 키 없으면 phase 배지 공백 | 기타 그룹 기본 라벨 |

## 횡단 관심사

이 코드베이스의 위험은 서브시스템마다 흩어진 개별 버그가 아니라, **소수의 반복되는 근원 패턴**에서 파생된다. 가장 가치 있는 통찰은 이것이다.

**1. 모듈 레벨 싱글톤 캐시 — 런타임 갱신 불가 (가장 빈번한 구조적 테마).** `LLM_SLOT`(ollama.ts:21), `runsettings._cached`(runsettings.ts:18), DART `_corp`/`_cache`/`_groundCache`(dart.ts:17,19 / custom.ts:36,97), `SystemSpecs`(models.ts:24), `_wiki`(llmwiki.ts:843), company-loader `_doc`/`_cached`(company-loader.ts:42)가 전부 동일 안티패턴이다. 프로세스 재시작 없이는 env·외부 파일·RAM·corp_code 변화가 반영되지 않고, 테스트에서 import하면 상태가 공유되어 격리가 깨진다. **공통 처방**: TTL 또는 명시적 invalidate, lazy getter, reset API를 하나의 캐시 추상화로 통일.

**2. 단일 스레드 암묵 전제.** `reingest/reclassify/reprocessState` 전역 싱글톤(main.ts:565-636), company-loader `_doc` 레이스(company-loader.ts:42), DART `_corp` 첫 호출 경쟁(dart.ts:21-48)은 모두 "Node.js 단일 스레드라 안전"에 기대고 있다. 현재는 맞지만 worker_threads 도입 즉시 레이스로 전환된다. **처방**: 동시성 가정을 코드 주석이 아니라 in-flight 가드·큐로 명시화.

**3. AbortSignal 전파 누락.** `isAbort(e)` signal 누락(org.ts:296), setTimeout이 signal 무시(org.ts:191), maintain fire-and-forget의 불완전 전파(finalize.ts:135-139). 취소가 일관되게 전파되지 않아 자원이 낭비되거나 백그라운드 호출이 버려진다. **처방**: 취소 가능한 delay/fetch 헬퍼를 공통화하고 모든 catch에서 signal 동반 isAbort 사용.

**4. 컨텍스트 슬라이스 절단이 조용한 정합성 오류로.** 수렴 판정 4000자(debate.ts:42), 데이터 감사 6000/7000자(org.ts:395-401), excerpt/임베딩 상한이 모두 LLM 입력을 잘라 후반 변경·오류를 놓친다. 잘림은 에러를 던지지 않고 "정상 결과"로 위장하므로 가장 탐지가 어렵다. **처방**: 잘림 발생 시 명시적 신호(메타 플래그·UI 경고)를 남기고, 감사는 섹션 단위로 분할.

**에러 처리**: 격리 실패 처리(팀원/전문가 단위 catch → 빈 텍스트 + agent_failed)는 견고하다. 그러나 두 곳에서 **에러를 조용히 삼킨다** — handleLine 잔여 라인(ollama.ts:262, high), ensureLoaded의 모든 오류 무음 폴백(company-loader.ts:63, low). 전자는 빈 결과를 정상으로 둔갑시켜 특히 위험하다.

**테스트 커버리지**: 제공된 8개 분석 전체에서 언급된 테스트 파일은 `src/wiki/llmwiki.test.ts`(11케이스)와 "순수 함수로 테스트 용이"하다고만 표시된 `composeBriefing` 둘뿐이다(테스트 인구조사를 직접 실행하지는 않았으므로 누락 가능성은 있으나, 제공 자료 기준의 신호다). 즉 **커버리지가 위키 한 서브시스템에 집중**되어 있고, 오케스트레이터 코어·서버 라이프사이클·프론트 reducer(순수 함수라 테스트 최적임에도) 등 정작 정합성 위험이 밀집한 영역에 단위 테스트 증거가 보이지 않는다. fold()의 순수성은 reducer 테스트를 거의 공짜로 작성할 수 있게 해주므로, 여기가 최우선 커버리지 투자처다.

**타입 안전**: CONFIG가 readonly 인터페이스로 타입 강제되고(config.ts:30-126), ChatParams/ModelAssignment 등 인터페이스 분리가 명확하다. 약점은 런타임 경계 — temperature/topP가 `Number()` 직접 변환으로 NaN을 통과시키고(config.ts:154-155), fetchApprovals가 빈 문자열 id를 허용한다(api.ts:613). 타입은 컴파일 타임을 지키지만 외부 입력 파싱 검증이 빈다.

**성능 (로컬 LLM prefill 병목)**: 핵심 병목은 Ollama 단일 KV 슬롯이다. 설계가 이를 정면으로 다룬다 — 전역 Semaphore로 동시 prefill을 1로 제한해 모델 리로드를 막고, `num_ctx`를 요청에서 배제해 옵션 변동에 의한 리로드를 회피하며, 섹션별 합성으로 단일 대형 prefill을 분산한다. 이 점에서 prefill 병목 인식은 성숙하다. 다만 outline에 standard 모델 사용(org.ts:335)처럼 micro로 충분한 작업에 상위 tier를 쓰는 미세 비효율과, setTimeout 1초 누적 지연(org.ts:191)이 잔존한다. 프론트 측은 seek 후진의 O(n) refold(store.ts:101)와 WikiGraphView 상시 재렌더(WikiGraphView.tsx:394)가 메인 스레드/CPU 병목이다.

**보안 (secrets/data)**: 양면적이다. 강점 — `safeEqual`(timingSafeEqual 길이 방어), INJECT_TOKEN Bearer 헤더 제한(URL 토큰 유출 방지), 시크릿 스토어 우선 → env 폴백 통일(`cred()`), notify의 `^https?://` 검증. 약점 — 프론트 AUTH_TOKEN의 prompt+비보안 쿠키(App.tsx:294, high), autoConfigConnector의 미검증 endpoint SSRF(custom.ts:183), DART API 키 URL 평문(dart.ts:32), AGENT_SHELL 활성 시 cat으로 민감 파일 읽기(config.ts:207). 대부분 로컬 전용이라는 전제에서 위험이 낮지만, **인터넷 노출 순간 SSRF·토큰 유출·경로 읽기가 즉시 실 위협으로 전환**된다.

## 권고

**Quick wins (저비용·고효과, 즉시 수정 가능)**

1. **org.ts:296 `isAbort(e, signal)` 수정** — 한 줄, 명백한 오타성 누락. 취소 일관성 즉시 복구.
2. **DELETE /runs/:id 빈 id 가드**(main.ts:355) — sessions 폴더 전체 삭제라는 파괴적 결과를 한 줄 `if(!id)`로 차단.
3. **temperature/topP NaN 방어**(config.ts:154-155) — envInt와 동일한 isFinite 헬퍼 재사용.
4. **handleLine 잔여 라인 에러 재전파**(ollama.ts:262) — 빈 결과 위장을 막는 정합성 핵심.
5. **WikiGraphView/자율런 폴링 catch 추가**(WikiGraphView.tsx:181, App.tsx:587) — UI 영구 고착·중복 연결 제거.
6. **rebuildIndex lesson 타입 추가**(llmwiki.ts:292), **search() 실제 score 노출**(llmwiki.ts:527), **startDaily 월 +1**(scheduler.ts:72) — 명백한 누락/off-by-one 일괄 수정.
7. **agentDetail에 제한 헬퍼 사용**(workspace.ts:260) — 이미 존재하는 readMemory(id,1000)로 교체.

**보안 하드닝 (인터넷 노출 전 필수)**

8. **AUTH_TOKEN을 HttpOnly Secure 쿠키로**(App.tsx:294) — 서버 Set-Cookie 방식 전환, prompt 제거.
9. **autoConfigConnector endpoint allowlist 검증**(custom.ts:183) — 프로토콜·호스트 화이트리스트로 SSRF 차단. notify.ts의 `^https?://` 검증을 endpoint에도 적용.
10. **DART API 키 로그 마스킹**(dart.ts:32) + **AGENT_SHELL allowlist 경로 제한**(config.ts:207).

**구조적 개선 (설계 차원, 계획 필요)**

11. **싱글톤 캐시 추상화 통일** — TTL/invalidate/reset/lazy-getter를 갖춘 단일 Cache 유틸로 LLM_SLOT·runsettings·DART·SystemSpecs·_wiki·company-loader 캐시를 일괄 리팩터링. 6건의 high/medium을 하나의 추상화로 해소하고 worker_threads 대비.
12. **영속 무결성 통일** — people.yaml도 tmp+rename, revise/delete에 디스크 복원 폴백 적용, version 영속화. 데이터 손실·복원 불가 3건 해소.
13. **critic 호출 정리**(org.ts:258-316) — 비평 의도(토론 vs 회사급)를 분리하거나 결과를 누적해 synthContext에 포함. 불필요 LLM 호출과 비평 손실 동시 제거.
14. **취소 가능 헬퍼 공통화** — signal 받는 delay·fetch 래퍼를 만들어 setTimeout(org.ts:191)·maintain(finalize.ts:135)·corp fetch에 적용.
15. **테스트 커버리지를 reducer·오케스트레이터로 확장** — fold() 순수성을 활용한 reducer 골든 테스트가 ROI 최고. 그 다음 org 배정/합성/critic 흐름, 서버 영속 폴백.
16. **HWPX hp:tbl 구조 수정 + 실제 한글 검증**(hwpx.ts:99) — 표를 hp:p 직속 블록으로 재구조화하고 한글에서 직접 열어 회귀 방지.

**우선순위 요약**: Quick wins 1~7은 이번 주 내 머지 가능한 정합성·안정성 수정. 8~10은 로컬 경계를 넘기 전 반드시 선행해야 할 보안 게이트. 11~16은 다음 마일스톤의 구조 부채 상환으로, 특히 11번(싱글톤 캐시 통일)이 단일 작업으로 가장 많은 high 위험을 해소하는 레버리지 포인트다.
---

## 부록: 어댑터버설 검증 + 수정 결과 (Phase 2·3)

HIGH 18건을 각각 독립 감사자가 **실제 코드를 읽고 반증 시도**한 결과:
**confirmed 4 · partial 7 · false_positive 6 · intended 1**. (+ 실패했던 infra·orchestrator-agent 보강 분석 → 신규 HIGH 5건은 검증서 전부 LOW/오탐/의도로 강등.)

### ❌ 오탐(false positive) — 조치 불필요
- `org.ts:296 isAbort signal 누락` — 검증 중 이미 수정됨(`689efb3`).
- `DELETE /runs/:id 빈 id 삭제` — 이미 `if (id && …)` 가드 존재.
- `launchRun 빈 run_id` — startHandler 가 auto 를 안 받아 도달 불가.
- `company-loader 싱글톤 레이스` — Node 단일 스레드에서 현재 안전(worker 도입 시에만 위험).
- `WikiGraphView 에러처리 누락` — 이미 처리 경로 있음.
- `AgentGraph 노드 고아` — 최근 세션에서 엣지·카운트 수정 반영됨.
- `LLM_SLOT 런타임 고정` — 의도된 설계(intended).

### ✅ 수정 완료(confirmed/partial → fix)
- `fix` people.yaml 원자적 저장 — `6e38dfc`
- `fix` ollama 잔여 라인 OllamaError 재전파(빈 결과 위장 방지) — `6e38dfc`
- `fix` reviseHandler 재시작 후 409 안내(404 대신) — `6e38dfc`
- `perf(ui)` seek 후진 스크럽 체크포인트 캐시 — `28ab5f1` (fold 불변성 검증 완료: 변이 벡터 전무)

### ↩️ 시도→되돌림 (advisor 리뷰가 회귀 포착)
- `critic 이중 실행 제거`(2abb269): 토론 모드에서 회사급 critic 을 건너뛰고 마지막 라운드 비평을 합성에
  넣었으나, 그 비평은 '반박 *전*' 산출물 기준이라 stale. 원래(반박 후 최종을 신선 비평)가 옳았음 →
  `da5b31b` 로 되돌림. 즉 이 항목은 사실상 오탐(원래 동작이 정상).

### ⏸️ 보류(추가 검증/판단 필요)
- **HWPX `hp:tbl`**(reassessed high): 검증자는 "hp:run 안에 있으면 안 된다"지만, 코드가 `treatAsChar="1"`(인라인 앵커)를 쓰므로 OWPML 인라인 객체 관례상 **현재 구조가 맞을 가능성**이 높다. 한글에서 직접 열어 확인 전엔 변경 보류(멀쩡한 export 파손 위험).
- **AUTH_TOKEN 비보안 쿠키, autoConfigConnector SSRF, DART 키 로그**: 단일 사용자 로컬 전제라 LOW. **인터넷 노출 전 필수**.
- **싱글톤 캐시 TTL/invalidate 통일**(dart `_corp`/`_cache` 등): 구조적 개선 — 다음 마일스톤.
