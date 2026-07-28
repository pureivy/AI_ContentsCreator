# connect-ai ↔ gepa-ai-office 비교분석 보고서

> 대상: **connect-ai** v2.89.157(배포제품, 본 보고서의 connect-ai 사실은 전부 *기존 분석보고서 기준이며 소스 미검증*) vs **gepa-ai-office** v0.1.0(빌드 중, 소스 직접 검증 완료)
>
> 작성: 2026-06-19 · 방법: connect-ai 분석보고서(`~/Downloads/connect-ai_분석보고서.md`)를 connect-ai 측 진실원천으로 삼고, gepa-ai-office는 소스 트리(`src/` 49개 `.ts`·6,762줄·15디렉토리, `BUILD_PLAN.md`, `README.md`, `frontend/`)를 6개 차원 클러스터로 정독 → 적대적 검증 → 종합. 헤드라인 수치(15디렉토리·49파일·55테스트·6,762줄)는 실측 확인.
>
> ⚠️ **갱신 주의(2026-06-19 이후)**: 본 보고서가 gepa의 *격차*로 지목한 ①능동 tool-loop ③자율 스케줄러 ④거버넌스 enforcement 는 이후 **`BUILD_PLAN.md §18` 에서 옵트인(기본 off)으로 구현·적대적 리뷰 경화됨**(`AGENT_TOOL_LOOP`·`AUTO_CYCLE_MINUTES`·`ENFORCE_AUTONOMY`). 단 능동 실행은 읽기 그라운딩 + 격리 `save_note` 까지이며 connect-ai식 임의 셸/파일 실행(`<run_command>`)은 보안설계 선결로 의도적 보류. 아래 본문은 그 구현 *이전* 시점의 비교다.

---

## 방법론 및 검증 전제 (먼저 읽으세요)

이 보고서의 모든 판정은 두 종류의 증거 위에 선다. 혼동을 막기 위해 미리 명시한다.

1. **gepa-ai-office 측 사실** — 본 분석은 실제 소스 트리(`src/` 49개 `.ts` 파일, `BUILD_PLAN.md`, `README.md`, `frontend/`)를 직접 읽고 grep·find로 부재까지 검증했다. 정량치는 모두 실측이다.
2. **connect-ai 측 사실** — 본 분석은 connect-ai 소스에 접근하지 않았다(사용자 지시대로 분석보고서를 권위로 사용). connect-ai에 대한 모든 서술은 **선행 분석보고서(Part1 §1~10, Part2)의 권위에 의존**하며 소스 미검증이다.

이 비대칭의 직접적 귀결: **관계(relationship) 라벨이 connect-ai 측 사실에 의존하는 경우, 그 라벨은 본질적으로 nuanced다.** 예컨대 "gepa가 X를 제거(dropped)했다"는 connect-ai에 X가 *있었다*를 전제하는데, 그 전제는 본 분석이 직접 검증하지 않았다. 그래서 이런 항목은 "제거"로 단정하기보다 "부재/범위제외"로도 함께 기술한다.

**성숙도 비대칭은 이 보고서 전체를 관통하는 공정성 원칙이다.** v2.89.157(배포·운영검증 제품)과 v0.1.0(빌드 중)을 1:1 기능 패리티로 비교하면 불공정하다. gepa의 "없는 기능"은 반드시 다음 셋 중 하나로 분류한다.

- **[의도적 제거]** — 설계철학상 버린 것 (예: 마켓플레이스 유통)
- **[미구현 / not-yet-built]** — `BUILD_PLAN.md`에 `[ ]`로 명시된 로드맵 잔여 (예: 능동 tool-loop, git 동기화)
- **[범위제외]** — 도메인이 달라 애초에 대상이 아닌 것 (예: 크리에이터 수익화 OAuth)

---

## 요약 (Executive Summary)

gepa-ai-office(v0.1.0)는 자신의 `README`가 직접 명시하듯 **"원본 GEPA AI Office를 Connect AI를 벤치마킹해 *로컬 우선*으로 재구현"** 한 별개 산출물이다. 계보는 두 갈래다 — 멀티에이전트 "회사 메타포", 제2의 두뇌(Karpathy LLM Wiki), RAM예산 모델배정, verified.md Self-RAG 같은 **개념 골격은 connect-ai를 벤치마킹**해 유지·재현했고, 멀티포맷 추출·자동귀속분류·HWPX 내보내기 같은 **구체 기능은 원본 GEPA(Python)에서 Node로 이식**했다(소스 헤더가 명기). 그 위에 gepa는 자기 정체성을 한 축으로 좁혔다: **클라우드(Claude) 전제의 통합제품을, 로컬 Ollama 단일 KV슬롯에서 벽시계 시간 최소화에 모든 설계를 수렴시킨 한국 기업·법무·문서처리용 self-host 웹서버로 재설계**했다. 배포 런타임을 VS Code 확장에서 Hono 웹서버로, 추론을 Ollama `/api/chat` 직접 호출로, 도구실행을 능동 액션태그 실행에서 선(先)그라운딩 1회 주입으로 바꾸고, 21,836줄 모놀리식을 49파일·15디렉토리·6,762줄 모듈러로 재배치했다. 자율 24h 상시루프·크리에이터 수익화 통합은 가져오지 않았고, 능동 tool-loop·git 동기화·LM Studio 페일오버는 `BUILD_PLAN`에 미구현으로 남아 있다. 반면 55개 테스트와 다회차 적대적 멀티에이전트 리뷰로 굳힌 코드 품질은 원본에 없던 신규 자산이다.

### 4분류 핵심표

| 분류 | 항목 |
|---|---|
| **유지 (Kept)** | 회사 메타포 멀티에이전트 골격 · revise(v+1) 재종합 · 협조적 취소 · Karpathy LLM Wiki(ingest/query/lint/maintain/audit, 임베딩無 휴리스틱) · 자가학습 memory.md+decisions.md 누적·재주입 · goal.md 자동채움 · 세션 다이제스트(`_brief/_report/<agent>.md`) · compounding 머지 · Apple Silicon 0.65×RAM 계수 · 단일 KV슬롯 직렬화(전역 동시성 게이트) · 모델 메모리추정·예산적합 판정 |
| **변경 (Changed)** | 배포 런타임 (VS Code 확장 → Hono self-host 웹서버) · 코드조직 (모놀리식 21,836줄 → 모듈러 6,762줄) · 의존성 스택 (axios/jsdom/esbuild/vsce → Hono/tsx/vitest) · 빌드 (esbuild 번들 → tsx 무번들 직접실행) · 로스터 (9 추상 페르소나 → 14 실명 한국 조직) · 진입 (6게이트 깔때기 → 단일 startRun 디스패처) · 회의/합성 (자율 회의+3-branch → debate 라운드+단일 CEO 종합) · tier 분류 (다단 → micro/standard/heavy 3tier) · 워치독 (2단계 240s/60s → 단일 600s) · jsonMode 폴백 → Ollama 네이티브 `format:'json'` · 도구실행 (능동 액션태그 → 선그라운딩) · 통합 도메인 (수익화 → 기업·법무·공문서) · 에이전틱 엔진 (풀 Claude CLI 루프 → 경량 직접호출) · 네트워크 (CORS 노출 → 127.0.0.1 바인드) |
| **제거·미구현 (Dropped / Not-yet)** | **[제거]** .vsix 마켓플레이스·A.U 멤버십 유통/라이선스 · **[미구현]** 능동 다단계 tool-loop(`BUILD_PLAN:50`) · 광의 MCP 서버 표면(`:68/:104`) · public_data MCP 연동 · git 동기화/P-Reinforce 자동재조립+자동푸시(`:68`) · LM Studio 자동 페일오버(스캐폴드만) · 원본 vs 본 구현 대조 벤치(`:159`) · **[범위제외/부재]** 4종 상시 자율루프(오토사이클·일일브리핑·채터·텔레그램)+cycle.js · 크리에이터 수익화 통합(YouTube OAuth/PayPal/Calendar/Firebase/A.U 브리지) |
| **신규 (Added)** | DART 기업공시 그라운딩 · 법제처 법령 MCP **클라이언트**(실 wiring) · 선언형 커넥터 엔진+AI 자동설정(무코드 REST 연동) · 명시 env tier 오버라이드(미설치 폴백) · 헤드리스 벤치 하네스 · 소형모델 신뢰화 방어패턴 카탈로그(7층) · 승인 라이프사이클 거버넌스 · WikiGraphView/AgentGraph/EmployeesView UI · 55테스트+다회차 적대적 리뷰 · *(원본 GEPA Python 이식, connect 대비로만 신규)* 멀티포맷 추출·자동귀속 분류·HWPX 내보내기 |

---

## Part 1

### §1. 제품 정체성

| 차원 | connect-ai *(보고서 기준)* | gepa-ai-office *(소스 검증)* | 관계 |
|---|---|---|---|
| 산출물 성격 | 배포된 통합제품 v2.89.157 | 별개 재구현, v0.1.0 빌드 중(`package.json:3` version, `:4` private:true) | changed |
| 유통·라이선스 | .vsix 마켓플레이스 + A.U 멤버십 게이트 | self-host(`git clone`→`pnpm install`→`pnpm dev`), 멤버십·라이선스 흔적 없음 | **dropped(의도적)** |
| 계보 선언 | 원본 | README가 "원본 GEPA를 Connect AI 벤치마킹해 로컬 우선 재구현"이라 자기명시 | — |

**해설.** gepa의 정체성은 README 첫 줄에 압축돼 있다 — "로컬 LLM을 직접 호출해 **속도를 최우선**으로 한 단일 Node/TS 멀티에이전트 AI 오피스". 마켓플레이스·멤버십 계층 제거는 self-host 전제에 따른 의도적 결정으로 보는 것이 타당하다. 단 connect-ai의 멤버십 모델 자체는 보고서 주장이며 소스 미검증이다.

### §2. 핵심 아키텍처

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| 배포 런타임 | VS Code 확장(IDE 호스트 내) | Hono(`@hono/node-server`) 단일 Node/TS 웹서버, `serve({fetch,hostname,port})` HTTP+SSE 서빙(`main.ts:950`), 브라우저 `/`(React)·`/lite`(경량 SPA) 접속 | changed |
| 코드 조직 | 21,836줄 모놀리식 단일파일 | 49개 `.ts`, **15개** top-level 디렉토리, src 전체 6,762줄(`main.ts` 단일 54,729바이트가 최대이나 오케스트레이터/LLM/위키/툴 분리) | changed |

**해설.** 런타임 호스트를 IDE에서 독립 웹서버로 바꾼 명백한 설계변경이며, SSE 라이프사이클은 실동작 코드로 존재한다. 디렉토리는 정확히 **15개**다(`agents/approvals/bench/events/export/grounding/llm/mcp/orchestrator/secrets/server/sessions/tools/util/wiki`). 공정성 단서: 6,762 vs 21,836줄(약 3.2배 적음)은 모듈화 우수성만이 아니라 **v0.1이 v2.89보다 기능 범위가 적은 점을 일부 반영**한다. 줄 수 격차를 품질 우위로만 읽으면 비대칭 오독이다.

#### §2.3 로컬 우선 추론·바인드 (D 클러스터 연동)

| 차원 | connect-ai | gepa *(검증)* | 관계 |
|---|---|---|---|
| 로컬/클라우드 스탠스 | **보고서 미제공 — 확인불가** | Ollama `/api/chat` 직접 호출(CLI 서브프로세스 X), `num_ctx` 요청 미포함(서버 env 전담), concurrency 로컬=1, 바인드 기본 127.0.0.1, backend 기본 local | **nuanced** |

**해설.** gepa의 로컬 우선은 코드로 명확히 검증된다(`config.ts:102/106/131`, `main.ts:950`). 그러나 connect-ai가 로컬 우선이었는지 클라우드였는지 보고서가 초점선에 제공하지 않으므로 "유지/변경" 판정이 불가능하다 → **nuanced**. 추측 금지 원칙을 connect-ai 측에도 동일하게 적용한다.

### §3. 멀티에이전트 회사 모델

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| 로스터 | 9개 추상 페르소나를 단일 LLM이 다중인격으로 연기 | 14명 실명 한국 조직(CEO 경영기획실장 + 전략기획팀 4 + 경영지원팀 9)을 YAML 데이터주도 정의. **역할마다 별도 `ollama.chat` 호출**(`agent.ts:179`)이라 "단일 LLM 다인격" 메커니즘 자체가 다름 | changed |
| 조직 위계 | 평면 로스터 중심 | `TeamDef(lead+members)` + `level('ceo'\|'lead'\|'member')`, org.ts가 CEO→팀장 분해·배정→팀원→팀장 종합→CEO 통합 3단 위계를 phase 이벤트로 구동 | added |

**해설.** 14명은 특정 기관 도메인에 강결합되어 범용성↓·사실성↑의 의도적 트레이드오프다. 위계는 org 모드 한정이며(debate 모드는 평면), `RUN_MODE` 기본값이 `org`(`config.ts:135`)라 위계가 기본 경로다.

#### §3.3 RAM 기반 모델 자동배정 (D 클러스터 연동)

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| Apple Silicon 계수 | 0.65×RAM 후한 예산 | `isAppleSilicon ? 0.65 : 0.5`, `safeModelBudgetGB=max(2, floor(totalRamGB*ratio))`. **계수 0.65 양측 동일 직접 이식**(`models.ts:34-36`, 헤더가 connect-ai `system-specs.ts` 벤치마킹 명기) | **kept** |
| tier 분류 | tiny/small/.../coder 다단 | `RoleTier = micro\|standard\|heavy` 3tier(`models.ts:73`). coder 등 특화 tier 없음 | changed |
| env tier 오버라이드 | 자동배정 중심 | `MICRO/STANDARD/HEAVY_MODEL` env, **'설치된 모델일 때만' 자동배정 위에 덮어씀**(미설치 폴백, `models.ts:136-142`) | added |
| 메모리추정·예산적합 | 예산 초과 모델 제외 | `estimateModelMemoryGB`(파라미터B×양자화+1GB KV), 예산+0.5GB 이내만 fitting, 별칭 dedup, 임베딩 배제, fitting 없으면 최소모델 폴백(`models.ts:48-125`) | kept |

### §4. 에이전틱 실행엔진 + 도구 (B engine + E tools)

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| 실행엔진 | 풀 에이전틱(Claude CLI 루프, 전체 툴스키마/MCP 프리필) | `runAgent`가 역할별 최소 시스템프롬프트+`ollama.chat` 단일 스트리밍으로 대체. 마이크로 단발(분해/배정/수렴/분류)은 풀루프 금지·단발(`agent.ts:77-227`) | changed |
| 능동 다단계 tool-loop | 실명령 실행 기반 능동 도구사용 | **미구현**. `BUILD_PLAN:50 '[ ] public_data 연동 + 에이전트 능동 tool-loop(다단계)'`, grep 전수로 루프 부재 확인 | **not_yet_built** |
| 도구 실행 모델 | XML 액션태그 실명령 실행(`<run_command>` 디스크쓰기) | LLM 호출 *직전* 등록 커넥터를 1회 순회(enabled·scope 체크)해 `ground()` 결과를 프롬프트에 **선(先)주입**. 모델은 명령 발신·실행 불가. lawmcp도 `search_law` 1회 호출 후 주입(`agent.ts:138-151`) | changed |
| 진입/디스패치 | 6게이트 깔때기로 CEO-LLM 회피 | 6게이트 없음. `startRun`이 ①agentId→directed ②조회 단축경로(isLookup 정규식)→CEO directed ③`path\|RUN_MODE='org'`→runOrg ④그 외→debate로 분기. **CEO는 회피대상 아니라 라우터/종합자**(`index.ts:14-36`) | changed |
| 분해/파싱 | 플래너 + 4단계 관용 파서 | `prepare.decompose`가 standard microJSON 1회 분해, `extractFirstJson` 단일 관용파서+`format:'json'` 강제. org는 CEO 라우팅+팀장 분해·배정(매칭 우선+미배정 큐 폴백). 보고서 '4단계'와 1:1 대응은 소스 미확인 | nuanced |
| 디스패치 동시성 | 완전순차 for루프+단일 워커뮤텍스 | `mapLimit(Semaphore)`+`teamParallel`. **로컬 기본 concurrency=1·teamParallel=1이라 실효 직렬**로 붕괴 → 결과 동작은 원본과 수렴, 메커니즘만 일반화(`semaphore.ts`, `config.ts:131`) | nuanced |
| 회의/합성 | 자율 in-character 회의 + CEO 3-branch 합성 | 자율회의 없음. debate.ts가 비평→재반박→micro 수렴판정(adaptive 종료, 저신뢰 경고), run.ts가 CEO **단일** 종합. org는 목차→섹션별 분할생성→조립+데이터검증 패스. 3-branch 미관찰(`debate.ts`, `run.ts:76-104`, `org.ts:273-314`) | changed |
| revise(v+1) | 재종합 경로 존재 | `runRevise`가 이전 positions+priorDeliverable+feedback로 **CEO 종합만 재실행**(팀 미재실행), 서버가 version 증가(`revise.ts:25-56`) | **kept** |
| 중단 | 단일 abortController | 런마다 별도 AbortController(RUNS 맵, 캡200 evict), signal 전파, isAbort로 취소·오류 구분 → **per-run 다중런 확장**(`main.ts:43-52`, `abort.ts`) | nuanced |
| 방어패턴 카탈로그 | *보고서 텍스트 부재* | 소형모델 신뢰화 7층 방어: ①`findTemplateNumbers` 가짜수치 탐지 ②`groundDirective` 실데이터 강제 ③빈출력 모델승급 ④실패 격리 ⑤`sanitizeField` 인젝션 방어 ⑥org 데이터검증 패스(예산≠결산) ⑦수렴 저신뢰 경고 | **nuanced** |

**해설 (도구 도메인, E).** gepa는 connect의 크리에이터·수익화 통합을 가져오지 않고 한국 기업·법무·공문서 도메인으로 통합을 전면 재설계했다. 등록 커넥터는 `law/dart/custom` 셋뿐이다(`grounding/index.ts:5-7`).

| 도구 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| DART 기업공시 | 대응물 없음(크리에이터 도메인) | OpenDART corpCode.xml 1회 캐시, 회사명 매칭 시 기업개황 그라운딩 주입(`dart.ts:21-92`) | added |
| 법제처 법령 MCP | 대응물 없음 | `@modelcontextprotocol/sdk` 정식 MCP **클라이언트**로 `korean-law-mcp.fly.dev/mcp`(StreamableHTTP) 연결, `search_law` 1회 호출 주입(`lawmcp.ts:6-60`). **죽은 의존성 아님** | added |
| 선언형 커넥터+AI 자동설정 | 대응 개념 없음 | `connectors.json` 설정만으로 임의 GET REST 그라운딩(코드생성·실행 없음), `autoConfigConnector`가 로컬 LLM으로 설정JSON만 제안, method GET 고정(`custom.ts:99-194`) | added |
| 웹검색 | 보유 여부 보고서 침묵 | DDG HTML(키 불필요) fetch+정규식, 위키 히트 시 생략(폴백 전용), 8초 타임아웃 fail-open(`web_search.ts`) | **nuanced** |
| 멀티포맷 추출 | 보고서상 부재 | HWPX/DOCX/XLSX/PPTX/PDF/HWP/XLS 포맷별 라우팅, 의존성 없는 ZIP 리더(`extract.ts`, `unzip.ts`). 헤더가 'kordoc 제거 재설계' 명기 | **nuanced** *(원본 GEPA 재설계; connect 대비로만 신규)* |
| 자동 직원귀속 분류 | 보고서상 부재 | LLM '사서'가 업무분장 대조로 1~3명 귀속, knowledge.md 기록, 상태 영속, reassign 지원(`classify.ts`) | **nuanced** *(헤더 `classify.ts:5-6` "원본 GEPA `classify_material.py` 포팅" — gepa-오리지널 아님)* |

> **광의 MCP 표면 주의.** gepa가 추가한 것은 법제처 **외부 MCP 클라이언트**다. src 전체에 `McpServer` 심볼은 **부재**하며, `main.ts:712`의 `/mcp`는 가용 MCP 서버 디스크립터 JSON 목록을 UI에 노출하는 단순 GET 엔드포인트일 뿐 in-process 도구를 MCP 서버로 표면화하지 않는다. 광의 MCP 서버 표면은 `BUILD_PLAN:68/104`에서 `[ ]` **미구현**이다.

### §5. 제2의 두뇌 / 지식 / 자가학습 (C)

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| LLM Wiki 워크플로우 | Karpathy식 ingest/query/lint/maintain/audit, 인덱스 우선·임베딩 불필요, compounding | `llmwiki.ts`에 전부 구현(`ingest:305 query:408 lint:443 maintain:494 findContradictions:610`), index.md 카탈로그·log.md 타임라인·WIKI_SCHEMA, 임베딩 코드 없음 순수 휴리스틱 | **kept** |
| 휴리스틱 RAG | 임베딩無 `[[위키링크]]` 1-hop BFS | query는 토큰/부분일치 **평면 스코어링**(title substring +8, source 1.4배, raw/ 2배). gepa는 1-hop BFS 그래프워크가 아님(graph는 시각화·lint용) | nuanced |
| 자가수선+audit | maintain·audit | maintain에 더해 **source-근거 전용 stub**(`fillDanglingFromSource`, '발췌에 없는 정보 지어내지 마라'), 모순 audit가 **양쪽 페이지 대칭 해소노트**(`:620-621`) | added |
| 4계층 신뢰분리 | memory→skills→verified→**템플릿** | `personaExtra`가 goal→**verified(우선신뢰)**→skills→memory 순 주입. '템플릿' 계층 없음, verified 최우선 재배치(`workspace.ts:221-234`) | nuanced |
| 자가학습 루프 | memory.md/decisions.md 누적 | `reflectAndLearn`이 런후 교훈→직원 memory.md+CEO decisions.md, 다음 런 personaExtra 주입(`reflect.ts:15-89`, 주석이 'Connect AI 패리티' 명시) | **kept** |
| goal.md 자동채움 | 직원 목표 진화 | 빈 goal.md만 LLM 생성, **사람이 적은 목표는 보호**(`reflect.ts:81-86`) | kept |
| verified Self-RAG 승격 | verified 계층 영속화 | `[근거:출처]` 태그 주장만 verified.md 승격, 교훈을 위키 lesson 페이지 환류, memory 압축아카이브(`reflect.ts:69-74`) | added |
| 세션 다이제스트 | sessions/<run_id>/ 영속화 | `_brief.md`/`_report.md`/`<agent>.md`(`digest.ts:27`, '원본 GEPA 패리티' 헤더) | kept |
| **P-Reinforce / git 동기화** | 파일드롭 3초후 자동재조립 + 자동 git push, 비파괴 git 동기화 | **미구현**. `src/sync/` 디렉토리·`gitsync.ts`·`/sync` 라우트·git push·watcher/debounce **전부 부재**(find/grep 0건). ingest 영속화 코어는 존재(명시적 업로드/런후 트리거)하나 디바운스 자동재조립+자동푸시 없음 | **not_yet_built** |

> **타임 보정 (반드시).** 분석 원본은 "`reflect`가 run_done 후 백그라운드 호출(체감지연 0)"이라 했으나 **소스는 정반대**다. `reflectAndLearn`은 `run_done` **이전에 await**되며(코드 주석이 'SSE 닫혀 lesson_learned 유실 → run_done 전 await로 변경'을 명시), run_done 후 백그라운드는 wiki `maintain`뿐이다. 자가학습 루프 자체는 kept이나, 이 타이밍은 정정해 기술한다.

> **BUILD_PLAN 자기모순.** git 동기화에 대해 `L94 '[x] 로컬 git 동기화'`(완료 오표기)와 `L68 '[ ] (잔여·저우선) resume/sync/mcp...'`(미구현)가 충돌한다. 소스 실태(부재)와 일치하는 **L68에 anchor**해 not_yet_built로 분류한다.

### §6. 자율성 (F)

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| 상시 백그라운드 루프 | 15분 오토사이클·일일브리핑·5분 채터·텔레그램 비서 4종 + `scripts/cycle.js`, 사용자 트리거 없이 상시 동작 | **단 1개도 부재**. `scripts/`엔 `serve_ollama_tuned.sh` 1개뿐(cycle.js 없음), cron/telegram/chatter/daily 자율루프 0건. 모든 런은 사용자 트리거 `POST /runs` 1회성 | **not_yet_built / 범위제외** |
| 트리거 모델 | 상시 에이전트가 기본 동작 축 | 사용자 트리거 1회성 런으로 설계변경. 런 종료 후 reflect·maintain은 트리거된 런에 종속된 후처리이지 독립 루프 아님 | changed |

**해설.** '의도적제거/미구현'이다. `BUILD_PLAN` 전체에 4종 상시루프에 대응하는 로드맵 줄 자체가 없어 엄밀히는 범위제외 성격이나, gepa의 명시 설계철학("로컬 단일 KV슬롯·속도 최우선")이 상시 백그라운드 LLM 루프와 상충하므로 일부는 **설계상 의도적 회피**로도 읽힌다. 단순 결함이 아니다.

### §7. 외부 통합 (E)

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| 통합 도메인 | YouTube OAuth·PayPal 실매출·Google Calendar·Plaza Firebase·A.U 브리지(4825) — 크리에이터·수익화 | 수익화 통합 전무(grep으로 oauth/paypal/firebase/youtube/calendar 식별자 부재 확인). law/dart/custom 셋으로 한국 기업·법무·공문서 전환 | changed |
| 수익화 스택 | 핵심 외부통합 | gepa 측 부재는 직접 검증됨. 단 connect 측 '존재'는 보고서 권위 의존이고, gepa는 connect 재구현이 아니라 도메인이 다른 별개 설계라 '제거'보다 **부재/범위제외** 성격 | **nuanced(범위제외)** |

**해설.** B2C 크리에이터 vs B2B 한국 사무 도메인 차이의 자연스러운 귀결이다. v0.1 성숙도상 외부 SaaS OAuth보다 키 기반 한국 공공/공시 API에 집중한 합리적 좁힘이다.

### §8. UI (F)

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| 픽셀 오피스 | LimeZu 에셋 ~3,200줄 + 대시보드 + 단일 sidebar.html(336KB) | LimeZu/sidebar.html 폐기, React/Vite 재작성. `OfficeView.tsx`(911줄)가 고정 4:3 캔버스(1280×960)에 역할별 좌석·회의·복도 안무를 이벤트 fold 위에 렌더(framer-motion) | changed |
| 지식그래프 뷰 | 보고서상 대응 명시 없음 | `WikiGraphView.tsx`(457줄)가 **react-force-graph-2d**로 옵시디언식 그래프(카테고리 색·링크차수 크기·contested 빨간링·레이어 토글), `AgentGraph.tsx`는 **@xyflow/react**로 런 중 에이전트 그래프 — 두 라이브러리 용도 분리 | added |
| 직원 편집 뷰 | 별도 명시 없음 | `EmployeesView.tsx`(313줄)가 직원 워크스페이스(goal·skills·tools·autonomy·tier) 편집을 `/agents/*` PATCH로 영속 + 경량 `/lite` SPA 폴백 | added |

> **보정.** WikiGraph=react-force-graph-2d, AgentGraph=@xyflow/react로 분리돼 있다(소스 직접확인). 픽셀아트 에셋 규모 대비 코드 줄 수만으로 비교하면 불공정하다.

### §9. 기술 스택 · 빌드 · 배포 (A)

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| 의존성 스택 | axios/jsdom + esbuild + vsce | runtime 4개(`@hono/node-server`, `@modelcontextprotocol/sdk ^1.29.0`, `hono`, `yaml`), devDeps(tsx/typescript/vitest/@types/node). axios/jsdom/esbuild/vsce **전무** | changed |
| MCP SDK | 언급 없음 | `@modelcontextprotocol/sdk ^1.29.0` 런타임 의존성 추가+실 wiring(`lawmcp.ts:6-7`). *(단 외부 클라이언트 한정; MCP 서버 표면은 §4 주의 참조)* | added |
| 빌드 파이프라인 | esbuild 번들 + vsce → .vsix 패키징 | 백엔드 **무번들**(tsx 직접실행), 타입체크 `tsc --noEmit`(`tsconfig:18`), 프론트만 Vite 빌드→dist 서빙, Ollama 튜닝은 앱 외부 `serve_ollama_tuned.sh`. CI/CD 자동화는 소스 미확인 | changed |

### §10. 강점 / 리스크 — 보안 공정 대조 (F)

> **보안 공정대조 (균형).** gepa는 두 곳에서 connect 리스크를 보완했으나, 한 곳은 **개선이 아니다.** 양측을 균형있게 본다.

| 보안 차원 | connect-ai *(보고서)* | gepa *(검증)* | 평가 |
|---|---|---|---|
| 네트워크 바인드 / CORS | 브리지 CORS 무인증 노출 리스크 | 기본 바인드 **127.0.0.1**(`config.ts:106`), CORS 미들웨어/Access-Control 헤더 부재(grep 0건) | **개선** — 단 '로컬 단일사용자' 전제 의존. 멀티유저/원격 배포 시 인증부재가 동일 리스크로 전환. 절대 보안우위 아니라 **위협모델 축소** |
| inject 인증 | 무인증 brain-inject | `/wiki/inject`에 `INJECT_TOKEN` Bearer 인증, 미설정·불일치 시 401(`main.ts:443-446`) | **개선(genuine)** — connect 무인증 대비 명확한 보강 |
| **시크릿 저장** | 평문 시크릿 | **평문** `data/secrets.json`(`store.ts:38-41` JSON.stringify). 완화책: 화면 마스킹(앞4뒤4)·git sync 제외·builtin 삭제불가 | **동일 약점(개선 아님)** — connect와 동급 평문. 파일 접근 가능한 로컬 행위자에겐 평문 그대로. **마스킹은 표시 완화일 뿐 저장 보안 개선이 아님** |
| 거버넌스 | 승인 게이트 미부각 | 승인 라이프사이클(pending→history 영속, 블로킹 await, 타임아웃 fail-open) 실구현(`store.ts`) | added — **단 적용범위 nuance(아래)** |
| 신규 경화 자산 | 대응 자동화 테스트·적대적 리뷰 미명시 | **55개 테스트(9파일)** + 다회차 적대적 멀티에이전트 리뷰(13·11·9·29 에이전트) + path-traversal 가드(`main.ts:318`) | added |

> **거버넌스 강제력 nuance (과대평가 방지).** 승인 라이프사이클 인프라는 실재하나, **발행 승인 게이트는 `REQUIRE_APPROVAL` 기본 OFF**이고(`config.ts:155`, `finalize.ts:45`), **자율레벨 0~3은 행위 강제(툴 게이팅)에 미연결**이다 — `effectiveTools(role)=cap.tools??role.tools`가 autonomy를 전혀 참조하지 않는다(`workspace.ts:235-238`). 현재 거버넌스는 **"발행 1지점 옵트인 게이트 + 표시용 자율도"** 에 그친다.

> 테스트 수: BUILD_PLAN(49)·README(31)는 stale 표기이며, 실측은 **55개**다.

---

## Part 2 — 오케스트레이션 심층

Part 2는 Part 1 §3~§4의 회사모델·실행엔진을 오케스트레이션 관점에서 재조명하고, 영속화(C)·LLM 전송계층(D)·리스크(F)를 합친다. 상세 대조표는 §4에 통합 기술했으므로 여기서는 보완 차원과 결론적 종합만 다룬다.

### Part2 — LLM 전송계층 (D)

| 차원 | connect-ai *(보고서)* | gepa *(검증)* | 관계 |
|---|---|---|---|
| Ollama+LM Studio 페일오버 | 양다리 자동 페일오버 | **미구현**. `config.ts:38-39,110`에 `lmstudioBaseUrl` 필드+주석만(기본 ''), src 전역에 소비/페일오버 코드 부재. ollama.ts는 단일 `/api/chat` 경로 | **not_yet_built(스캐폴드)** |
| 워치독 | 2단계(240s/60s, 무진행 감지) | 단일 `requestTimeoutMs`(기본 600s, AbortSignal.timeout). 무진행/idle 워치독 부재. 600s는 240s보다 관대(콜드로드 대비) | changed |
| jsonMode 폴백 | 폴백 체인 | Ollama 네이티브 `format:'json'` 패스스루(grammar 강제), chat() 내 재시도/폴백 파서 없음. think:false와 결합해 빈출력 차단 | changed |
| /api/chat 직접 스트리밍 | (gepa측 초점) | NDJSON 직접 fetch·수동 라인 파싱, `think:false` 고정(추론채널 차단→빈출력 방지, 원본 `MAX_THINKING_TOKENS=0` 의도), `num_ctx` 의도적 미포함(리로드 스래시 회피), `num_predict` 캡(`ollama.ts:141-159`) | added |
| 단일 KV슬롯 직렬화 | 전역 게이트로 동시성 제한 | 모듈 전역 `LLM_SLOT=new Semaphore(CONFIG.concurrency)`로 모든 chat() 게이트, 로컬=1이라 런이 여럿이어도 동시 생성 1개 보장(**런 경계 넘는 전역 게이트**), 슬롯 누수 방지 `reader.cancel()` finally(`ollama.ts:18-20,138`) | **kept** |
| 벤치 하네스 | 대응 없음 | `bench.ts`가 헤드리스 1런으로 단계별 토큰·tok/s·벽시계·절단여부 수집·표 출력. **단 '원본 vs 본 구현' 대조 벤치는 `BUILD_PLAN:159 [ ]` 미구현** — self 벤치만 작동 | added(비교실험 not_yet_built) |
| Abort 견고성 | 보고서 근거 불명 | `isAbort`로 취소를 오류와 구분, `anySignal`이 Node20.0~20.2용 `AbortSignal.any` 폴리필 제공(`abort.ts`, '리뷰 발견' 산물 명시) | added(connect측 미확인) |

---

## 종합 결론

### 두 제품의 포지셔닝 차이

- **connect-ai** — 크리에이터 대상, **자율 24h 상시 동작**(오토사이클·브리핑·채터·텔레그램), YouTube/PayPal/Calendar/Firebase를 묶은 수익화 통합제품. VS Code 확장으로 배포되는 성숙(v2.89.157) 제품. 풀 에이전틱(Claude CLI 루프)·능동 도구실행을 전제로 한 클라우드 추론 가능성이 높다(단 보고서 미확인).
- **gepa-ai-office** — **한국 기업·법무·문서처리** 대상, 로컬 Ollama에서 **벽시계 속도**를 모든 설계의 단일 목적함수로 삼은 self-host 웹서버(v0.1.0). DART·법령 MCP·HWPX·멀티포맷 추출로 도메인을 좁히고, 사용자 트리거 1회성 런으로 자율성을 단순화했으며, **55테스트+다회차 적대적 리뷰로 검증된 코드 품질**과 **모듈러 구조**를 자산으로 둔다.

두 제품은 우열 관계가 아니라 **위협모델·도메인·실행환경이 다른 별개 산출물**이며, 같은 개념 골격(회사 메타포·제2의 두뇌·verified Self-RAG·RAM예산 배정)을 공유하되 gepa는 그것을 로컬·한국·문서·속도 축으로 재해석했다.

### gepa가 패리티를 위해 우선 메워야 할 격차 (Top 5)

connect-ai의 핵심 가치제안(상시 자율·통합·능동 실행)을 기준으로, gepa가 우선순위대로 메워야 할 검증된 격차는 다음과 같다.

1. **능동 다단계 tool-loop** — `BUILD_PLAN:50 [ ]`. 현재 도구는 선그라운딩 1회 주입뿐이라 모델이 도구를 반복 호출·탐색하는 능동성이 없다. connect 핵심인 에이전틱 실행과의 가장 근본적 격차. *(근거: `agent.ts:138-151` 루프 부재, grep 전수 확인)*
2. **git 동기화 / P-Reinforce(자동재조립+자동푸시)** — `BUILD_PLAN:68 [ ]`. `src/sync/` 자체가 부재(find 0건). 지식·자가학습 코어 루프는 동등 이상으로 갖췄으나 운영 자동화(디바운스 ingest·비파괴 git 영속)가 비어 있어 "compounding 지식의 외부 동기화"가 불가능. *(근거: gitsync.ts·/sync 라우트·git push 전부 부재)*
3. **상시 자율 스케줄러** — 4종 상시루프·cycle.js 부재. connect의 "자율 24h" 정체성과의 가장 큰 거리. 단 로컬 단일 KV슬롯 속도철학과 상충하므로, 메우려면 별도 동시성 설계가 선결되어야 함. *(근거: `scripts/`=1파일, cron/telegram 0건)*
4. **거버넌스 enforcement** — 라이프사이클 인프라는 있으나 `REQUIRE_APPROVAL` 기본 OFF + 자율레벨 0~3 미집행(`effectiveTools`가 autonomy 무시). "표시용 자율도"를 "강제되는 자율도"로 연결해야 거버넌스가 실효를 가짐. *(근거: `workspace.ts:235-238`, `config.ts:155`)*
5. **시크릿 저장 보안** — connect와 **동급 평문**(`data/secrets.json`). 마스킹·git제외는 표시·전파 완화일 뿐 저장 보안 개선이 아니므로, 멀티유저/원격 배포로 위협모델이 확장되기 전에 암호화 저장(또는 OS 키체인 위임)이 필요. *(근거: `store.ts:38-41` 평문 write)*

(보조: LM Studio 페일오버 — `config.ts` 스캐폴드만 있고 미연결. 단일 백엔드 가용성 리스크 완화에 후순위로 필요.)

---

*본 보고서는 connect-ai 분석보고서를 connect-ai 측 진실원천으로 삼고, gepa-ai-office 소스를 6개 차원 클러스터(정체성·아키텍처 / 회사모델·오케스트레이션 / 제2의두뇌·자가학습 / LLM코어·모델·성능 / 외부통합·자료처리 / 자율성·UI·보안)로 정독 → 적대적 검증 → 종합한 결과다. gepa 측 모든 정량치·부재 주장은 grep/find로 직접 확인했다.*
