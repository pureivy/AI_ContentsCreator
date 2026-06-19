# 빌드 플랜 — gepa-ai-office (로컬 우선 재구현)

목표: 원본 GEPA AI Office를 **Node/TS 단일 런타임**으로 풀 기능 재구현하되, Connect AI를
벤치마킹해 **로컬 LLM 속도를 최우선**으로. (LLM=Ollama `/api/chat` 직접·소형 프롬프트·RAM예산
모델 자동선택·직렬 단일슬롯·num_ctx 서버 전담)

## 진행 현황

### ✅ 1. 기반 계층 (완료, tsc 통과)
- [x] `package.json` / `tsconfig.json` / `.gitignore` — Node22·ESM·Hono·tsx·vitest
- [x] `src/config.ts` — env 설정, 로컬 기본값, brevity note
- [x] `src/llm/models.ts` — 시스템 사양 감지 + RAM예산 tier별 모델 자동배정
- [x] `src/llm/ollama.ts` — `/api/chat` 스트리밍 직접 클라이언트, tags/ps/warm
- [x] `src/events/types.ts` — EventEnvelope(원본 와이어 호환) + llm_metric
- [x] `src/events/bus.ts` — 런별 버스, seq, 리플레이, 델타 coalescing

### ✅ 2. 수직 슬라이스 (실행 가능 MVP — 엔드투엔드 검증 완료)
- [x] `src/util/ids.ts`, `src/util/semaphore.ts` — id 생성, 동시성 세마포어
- [x] `src/agents/company.ts` — CEO + 전문가(researcher/analyst/writer/critic) 데이터 주도 정의
- [x] `src/orchestrator/agent.ts` — 경량 직접 호출(최소 프롬프트→ollama 스트림→이벤트), microJSON 헬퍼
- [x] `src/orchestrator/run.ts` — 분해→전문가 작업(동시성 세마포어)→비평→CEO 종합→다이제스트
- [x] `src/server/main.ts` — Hono: POST /api/runs, GET /api/runs/:id/events(SSE), /api/llm, cancel
- [x] `src/sessions/digest.ts` — 세션 다이제스트 영속화(_brief/_report/<agent>.md)
- [x] 엔드투엔드 검증: 실제 gemma4:e4b 런 성공 — **프롬프트 231토큰 / 54 tok/s / 절단없음**
- [x] 단위 테스트 10개 통과(모델배정·JSON추출), tsc 통과

### ✅ 2.5 속도 입증/도구
- [x] `scripts/serve_ollama_tuned.sh` — Tier-1 튜닝(ctx 16384·keep_alive·num_parallel=1·flash·kv q8)
- [x] `src/bench/bench.ts` — 헤드리스 벤치(단계별 토큰·tok/s·벽시계)
- [x] `src/events/types.ts` llm_metric — 턴별 성능 가시화

### ✅ 3.0 웹 UI (자체 단일 페이지 — 동작 검증)
- [x] `public/index.html` — 다크 테마 SPA(빌드 불필요). 주제 입력 → 실시간 에이전트 스트리밍
- [x] 속도 메트릭 히어로(평균 프롬프트 토큰·tok/s·호출수·경과) — 속도 우위 가시화
- [x] `/api/company` 로스터, EventSource SSE(이름별 이벤트), 라이브 로그
- [x] 검증: http://localhost:8787/ 서빙 + 이벤트 시퀀스 정상 수신
- 실행:  `cd gepa-ai-office && pnpm dev` → 브라우저 `http://localhost:8787`

### 🚧 3. 기능 패리티 확장
- [x] `src/orchestrator/debate.ts` — debate 라운드(비평→재반박)·수렴판정(micro)·adaptive 종료
- [x] `src/wiki/store.ts` — 지식그래프(파일 기반·FTS-lite 검색·관계 엣지·그래프 JSON), 런 자동적재
- [x] 위키 엔드포인트 `/wiki/{graph,pages,page/:id,stats}` (GEPA 프론트 계약) + 테스트 6개
- [x] org 위계(CEO→팀→팀원·위임) — `org.ts`/`prepare.ts`/`finalize.ts`/`index.ts` 디스패처, RUN_MODE 분기
- [x] org 검증: 리서치팀(analyst+researcher)·콘텐츠팀(writer) → 비평 → CEO 통합, team_spawned/team_deliverable emit
- [x] 위키 그라운딩(제2의 두뇌 읽기 루프) — 작업 전 관련 지식 자동조회·주입, wiki_query emit
- [x] UI 위키 패널 + 그라운딩/팀/위임/phase 이벤트 표시 (그래프 16노드·26링크 검증)
- [x] web_search 인-프로세스 툴(DDG, 키불필요·네이티브無) — 리서처 웹 그라운딩, 파서 테스트 4개·라이브 검증
- [x] 승인(approval) 라이프사이클 — 발행 휴먼 게이트(블로킹+타임아웃 fail-open), `/approvals` API, UI 배너, e2e 검증
- [x] **GEPA React 프론트 본격 연결** — `frontend/`(복사) + GEPA 계약 어댑터 엔드포인트(무접두 /runs·/llm·/company·/wiki·/approvals·스텁) + dist 서빙(/). 브라우저 e2e: 런 시작→SSE 스트림→오피스 안무·타임라인·위키 자동적재(10→13) 확인
- [ ] public_data 연동 + 에이전트 능동 tool-loop(다단계)
- [ ] (선택) agent 아바타 이미지·deliverable 패널 매핑 미세조정

### 테스트 현황: 25개 통과 (models 5 · agent 5 · wiki 6 · web_search 4 · approvals 5) · tsc 클린 · 프론트 빌드 OK

### ✅ 5. 적대적 멀티에이전트 리뷰 → 수정(13 에이전트 리뷰·검증)
확정 발견(High 8·Med 11·Low 7) 중 핵심 수정 적용·검증:
- [x] **thinking 모델 빈 출력 근본해결** — Ollama 요청에 `think:false`(qwen3·deepseek-r1이 추론에 num_predict 소진→content 공백). 산출물 패널 공백의 진짜 원인.
- [x] **산출물 패널** — CEO 종합에 `blockId:'ceo-synth'`+persona.level, agent_message에 stage 동봉, reducer synthesis 폴백 → e2e 산출물 848자 채움 확인
- [x] **취소→cancelled** — isAbort 식별, startHandler.catch 분기(오류 오인 제거) → e2e 확인
- [x] **단일 실패 격리** — 워커 try/catch+agent_failed{isolated}, 빈 입장 필터(전원 실패만 fatal)
- [x] **num_predict 클램프** [1,32768] + reader try/finally 해제 + AbortSignal.any 폴리필(Node 20.6)
- [x] **이벤트 영속화** events.jsonl + runLogHandler 폴백(버스 30s 폐기/재시작 후 replay)
- [x] 모델 별칭 dedup · 손상 JSON 격리 · 미구현 쓰기 JSON 501 스텁 + JSON notFound · web_search signal 전파
- [x] **런 옵션 라우팅** — directed(직원 지명 단독 런, `directed.ts`)·path('team'=1팀/'full'=전사)·budget 파싱. e2e: researcher 단독 ✓ / 리서치팀 1팀만 ✓
- [x] **/revise 실구현** — 부모 입장+피드백 CEO 재종합(`revise.ts`), `{run_id, version}` 반환. e2e: v2 산출물 675자 ✓
- [x] **HWPX 내보내기 실구현** — 순수 Node(의존성無): markdown→OWPML section 포팅 + 최소 ZIP 라이터(mimetype STORED first), report 템플릿 재사용. e2e: 유효 hwpx 9.6KB·구조 검증 ✓ (`src/export/hwpx.ts`, `src/util/zip.ts`, `assets/hwpx/`)
- [x] **자료 업로드(/sources) 실구현** — multipart 텍스트(.md/.txt/.csv/.json) → 위키 'source' 페이지 적재 → 에이전트 그라운딩 소스화. e2e: 업로드→위키→그라운딩 검색 히트 ✓
- [ ] (잔여·저우선) resume/sync/mcp/api-keys/templates 실구현 · 위키 동시쓰기 직렬화(현재 sync write라 사실상 원자적)

### ✅ 6. Karpathy "LLM Wiki" 패턴으로 위키 재구현 (사용자 요청)
원본 JSON 그래프 store 를 **Andrej Karpathy의 LLM Wiki 패턴**(2026-04, gist 442a6bf…)으로 교체:
- [x] `src/wiki/llmwiki.ts` — 마크다운 엔티티/개념/소스 페이지(YAML 프런트매터 + `[[위키링크]]`) · `index.md` 카탈로그 · `log.md` 타임라인 · `WIKI_SCHEMA.md` · `raw/` 원본
- [x] **ingest**(LLM 주도): 산출물/소스 → 엔티티·개념 추출 → 페이지 생성·갱신([[링크]]) → index 재생성 → log. **compounding**(재적재 시 '갱신' 섹션 머지)
- [x] **query**(인덱스 우선, 임베딩 불필요) → 에이전트 그라운딩. **lint**(고아·끊긴링크=지식갭) → `/wiki/lint`
- [x] **maintain 자가수선 루프** — lint 가 찾은 끊긴링크(지식 갭)를 LLM 이 보충해 페이지 생성·그래프 연결. `/wiki/maintain?n=N` + 런 종료시 자동(maxFill 2). 실증: 그래프 연결 1→16, 페이지 6→10 (compounding)
- [x] **모순 검출(audit)** — 토픽 겹치는(상호/공유 링크) 페이지 쌍을 LLM 비교 → 상충 주장 탐지, `?resolve=1` 이면 ⚖️ 해소 노트 기록. `/wiki/audit?n=N&resolve=1`. 실증: "큰 모델 vs 작은 모델" 상충 탐지+통합 노트 기록 ✓
- [x] 검증: 실런 ingest로 엔티티/개념 .md 6개+index+log+[[링크]] 생성 ✓ · query 그라운딩 히트 ✓ · /wiki/graph·pages 프론트 연동 ✓ · 단위 8개
- 구버전 JSON store 제거. RAG(쿼리시 임베딩)가 아니라 지식을 1회 컴파일·지속 갱신.

### ✅ 7. 신규 코드 2차 적대적 리뷰 → 경화 (11 에이전트)
신규 코드(위키/revise/hwpx/sources/directed) 리뷰의 확정 발견 수정:
- [x] **path traversal** — getPage 슬러그 구분자·.. 차단 + 컨테인먼트(HTTP /wiki/page/:id 404 확인)
- [x] **frontmatter 무결성** — 배열키 화이트리스트 + JSON 직렬화(summary 대괄호·항목내 쉼표 라운드트립)
- [x] **전역 LLM 동시성 게이트**(ollama.ts) — 동시 런이 단일 KV 슬롯 불변식 깨지 않게
- [x] **위키 직렬화 뮤텍스** — ingest/maintain/audit read-modify-write 경합 방지
- [x] **finalize maintain 백그라운드화** + AbortSignal 전파(run_done 체감지연 0)
- [x] **HWPX 닫히지 않은 코드펜스 데이터손실** 수정 · ZIP UTF-8 EFS 플래그 · n=0 falsy · RUNS 메모리 캡 · upsertPage 타입승격 · lint 원제목 · nowDate 로컬TZ · query 안정정렬 · audit 양쪽 노트 · rolesById 팀원포함
- [x] 회귀 테스트 7개 추가 · 런타임 스모크 재검증

### ✅ 8. 원본 파리티 — 실제 조직 로스터 + 동기화 (사용자 요청)
- [x] **회사 YAML 로더**(`src/agents/company-loader.ts`) — data/company.yaml(조직)+people.yaml(역할→실명) → CompanyDef. 없으면 assets/company 시드 복사. systemPrompt·level·team 보존
- [x] **14명 실명 로스터** — 경영기획실장 + 전략기획팀(장은영 외 3) + 경영지원팀(박재희 외 8). /company·런·이벤트에 실명/직책 표출. RoleDef에 systemPrompt/level/team 추가
- [x] 런 서브셋 — debate=MAX_SPECIALISTS 캡, org 팀원 캡(로스터 표시는 전체, 런만 서브셋 → 로컬 속도)
- [x] **로컬 git 동기화**(`src/sync/gitsync.ts`) — data/ 별도 저장소에 wiki·raw·sessions 커밋. /sync/status·/sync/push(로컬 커밋). e2e: 커밋 생성 ✓
### ✅ 9. 직원 편집/진화 서브시스템 (파리티 감사 최우선 격차 — EmployeesView 부활)
- [x] **워크스페이스**(`src/agents/workspace.ts`) — `data/agents/<id>/`(prompt.md·goal.md·skills/*.md·capabilities.json·knowledge.md·activity.log). persona_extra·effective tools/autonomy 를 `agent.ts` 시스템프롬프트에 주입 → **편집이 런에 실제 반영**
- [x] **company write**(`company-loader.ts` 확장) — raw YAML 수정·저장(원자적), 실명은 people.yaml 분리. editRole/deleteRole/addTeam/renameTeam/deleteTeam/addMember
- [x] **엔드포인트** — GET·PATCH /agents/:id · POST·DELETE /agents/:id/skills · PATCH·DELETE /company/roles/:id · POST·PATCH·DELETE /company/teams(/:id) · POST /company/teams/:id/members
- [x] e2e: 직원 상세·페르소나/목표/툴/자율도 편집(런 반영)·직책 변경·팀 신설·팀원 추가·워크스페이스 자동생성 ✓
### ✅ 10. 자료 처리 (멀티포맷 추출 + 자동 직원귀속 분류)
- [x] **멀티포맷 추출**(`src/tools/extract.ts` + `src/util/unzip.ts`) — HWPX/DOCX/XLSX/PPTX(ZIP+XML, 의존성無 ZIP 리더) · PDF(pdftotext) · 텍스트. 한국 공문서 중심
- [x] **자동 직원귀속 분류**(`src/tools/classify.ts`) — LLM 사서가 **업무분장 대조**로 1~3명 귀속 → knowledge.md. e2e: 계약서.hwpx → 권이담(계약 과장) 정확 귀속 ✓
- [x] 엔드포인트 — POST /sources(추출+분류) · /sources/classify_status · /sources/reassign(오귀속 교정) · /sources/classify_retry. 추출 회귀 테스트 6개
- [ ] 잔여 격차(감사 후속): 템플릿+스케줄러 · secrets/api-keys/mcp UI · public_data MCP · 임베딩 의미검색

### ✅ 11. 에이전트 자가학습(self-learning) — Connect AI 패리티
Connect AI의 memory.md/decisions.md 자가학습 + P-Reinforce 대응:
- [x] **리플렉터**(`src/orchestrator/reflect.ts`) — 런 종료 후 각 참여 직원 기여에서 구체적 한 줄 교훈 추출 → 그 직원 `data/agents/<id>/memory.md` 누적 + CEO `decisions.md` 로그. 백그라운드(run_done 후, 체감지연 0)
- [x] **주입**(`workspace.personaExtra`) — 누적 memory(최근 1200자)를 다음 런 시스템프롬프트에 자동 주입 → compounding
- [x] `lesson_learned` 이벤트(타임라인 표출) · EVOLVE_EMPLOYEES 기본 on
- [x] e2e: 1런 후 장은영·권하경·박용식 등에 구체 교훈 누적·주입 확인 ✓ ("일할수록 똑똑해짐")
- [x] **개인목표 자동 채움** — 리플렉터가 `goal.md` 빈 직원에 업무분장(focus)+이번 학습 반영 개인목표 생성(사람이 직접 적은 목표는 보호). 실증: 권하경·법무담당 직무 맞춤 목표 자동 생성 ✓

### ✅ 12. 직원 탭 정리 + 적대적 리뷰 하드닝
- [x] **모델 필드 → 처리 등급(micro|standard|heavy) 일원화** — UI TIER_OPTS/tierLabel, 백엔드 tier↔model round-trip(company-loader normalizeModel/tierToModel/tierFor)
- [x] **자가학습 교훈(memory.md) 직원 탭 표출** + **활동 로깅**(런 참여 자취, 발췌 정리)
- [x] 적대적 리뷰(wf wajqd53rl, 9건 중 3건 확정) 수정: ① **custom 로컬모델명 보존**(gemma4:12b 등 silent clobber 방지) ② **round-trip 단위테스트** ③ **activity/memory tail-trim**(무한증가 차단)
- [x] 검증: gemma4:12b 보존 실증, tail-trim 250→100·450→200, round-trip API/단위 전부 통과

### ✅ 13. 모델 등급별 명시 지정 (사용자 결정: micro=gemma4:e4b · standard·heavy=gemma4:12b)
- [x] config `tierModels`(env `MICRO_MODEL`/`STANDARD_MODEL`/`HEAVY_MODEL`) — 기본값 사용자 환경
- [x] `autoAssignModels` 오버라이드 `pick` — **설치된 모델만 적용, 미설치 시 자동 폴백**(범용 안전)
- [x] 정체불명 별칭(local:latest·claude-*) 자연 배제. /api/llm 실측: micro=gemma4:e4b, standard·heavy=gemma4:12b
- [x] 회귀 테스트(override 적용·미설치 폴백·미지정 대조) 추가

### ✅ 14. 페르소나(prompt.md) 제거·통합 — 레이어 단순화
- [x] system_prompt 와 같은 자리에 겹치던 **prompt.md 제거**. 직무 정체성·성격은 company.yaml `system_prompt` 로 일원화(직원 탭 편집 칸도 한 곳)
- [x] 정리: `personaExtra`(=goal+skills+memory)·`agentDetail`·PATCH `/agents/:id`·`AgentProfile`·EmployeesView 페르소나 칸·dead `prompt.md` 파일
- [x] 진화 레이어(goal 자동채움·memory·skills)는 유지. `RoleDef.persona`(systemPrompt 없을 때만 쓰는 코드 fallback)는 별개로 존치
- [x] 검증: 백엔드 tsc·49테스트, 프론트 tsc·빌드, agentDetail payload(prompt 제거·goal 유지) 실측

### ✅ 15. 직원 system_prompt 일괄 보강 + 사무실 UI 다듬기
- [x] **14명 system_prompt 보강** — 작성 규칙 6개(정체성·임무·작업원칙·경계/협업·출력/기록·간결성)로 생성→적대적 검증→일관성 통일(wf wy1sljlo1, 29 에이전트). 길이 169~352자 → 316~363자 균질화. 사실(직무·법령·실명) 보존, 검증이 ceo '정책' 누락·planning_lead 분업 모순 등 교정. 백업 `/tmp/company.beforeprompts.yaml`
- [x] **UI**: 기록 풀다운 바깥클릭 닫기(`histWrapRef`+mousedown, 자료·템플릿과 동일) · 사무실 "CEO실"→"경영기획실" · ceo 아바타 라벨 "CEO"→"실장"(`personLabel`)
- [x] 검증: 백엔드 보강 로드·프론트 tsc·빌드 OK

### ✅ 16. 실명 표출 + 워크스페이스 일관화
- [x] **런 중 실명 표출** — `agent_spawned` persona 에 `name: role.name` 추가(+Persona 타입). 수정 전엔 직책만 떴음. 실증: 런 타임라인에 "장은영 팀장"·"권하경 과장" 표출 ✓
- [x] 표시 보강 — App.tsx 직원카드/승인배너가 `persona.role`만 쓰던 것을 `empLabel`(실명+직책)로. ceo 는 `personLabel` 로 "실장" 폴백
- [x] **14명 전원 스캐폴드**(서버 시작 시 ensureScaffold) + **goal.md 빈 12명 개인목표 자동 시드**(focus 기반 생성→검증, wf w422zqzk1)

### ✅ 17. 기능 영역 감사 + 수정 (UI↔백엔드 대조, wf wdsmuj12j)
6개 영역(동기화·두뇌·api키·llm·mcp·아바타) 병렬 감사→적대적 검증 → **전부 수정 완료**:
- [x] **avatar level 버그** — `agent_spawned` 의 level 매핑이 `role.id==='ceo'?...:member` 라 팀장(lead)이 member 로 분류됨 → `role.isCritic ? 'critic' : (role.level ?? …)` 로 수정
- [x] **MCP** — GET /mcp 스텁([]) → in-process 도구(위키·웹검색)를 McpServer[] 로 실표면화(used_by=보유 직원 실명), POST /mcp/:id 토글 라우트 추가(명시 사유 반환), McpView 빈상태 안내
- [x] **sync** — 배지 공식의 죽은 `ahead`(항상 0) 제거 → `changed` 만
- [x] **apikeys**(완전 누락 → 구현) — `src/secrets/store.ts`(data/secrets.json, 마스킹) + GET/POST /api-keys·POST /api-keys/add·DELETE /api-keys/:key. CRUD·마스킹·builtin 보호 검증
- [x] **brain** — wiki graph() 노드 2종→4종(agent/source/tag 추가)·링크 1종→author/source/tag, stats 프론트 형태. 레이어 토글 작동(agent 6·author 49·source 25 실측)
- [x] **avatar 안무** — org.ts 가 `phase` 에 team_id 없이(전역 'delegation') emit하고 lead→member delegation 미emit → 안무 死였음. 수정: CEO `delegate`/`review`(_ceo) + 팀 `assign`/`work`/`report`(team_id) phase + 팀장→팀원 `delegation`(engaged 채움). 실측: 런 SSE 에 _ceo delegate·planning assign/work + planning_lead→research/strategy/risk delegation 확인 ✓ (debate 모드 phase 안무는 후속)

### 테스트 현황: 49개 통과 (llmwiki 13 · hwpx 6 · extract 6 · models 6 · web_search 4 · agent 5 · approvals 5 · company-loader 4) · tsc 클린 · 서버 가동(등급별 지정 적용)
- [ ] `src/agents/` — 툴 게이팅·자율레벨·스킬, 에이전트 워크스페이스(진화/학습)
- [ ] `src/approvals/` — 승인 라이프사이클(pending→history, 타임아웃 fail-open)
- [ ] `src/sessions/` — 세션 다이제스트(_brief/_report/<agent>.md)
- [ ] 외부연동 — 웹검색·공공데이터·(선택)캘린더/유튜브, MCP 대체 in-proc 툴
- [ ] 프론트엔드 — 원본 `frontend/`(React/Vite) 연결, 오피스 연출·그래프

### ⬜ 4. 벤치마크 & 튜닝
- [ ] `bench/` — 동일 토픽 1런 벽시계·턴수·tok/s·truncated 측정(원본 vs 본 구현)
- [ ] Ollama 튜닝 서버 스크립트(ctx 16384·keep_alive·num_parallel=1·flash attn)

### ✅ 18. Connect AI 패리티 3격차 구현 — 능동 실행·거버넌스·자율 (옵트인, 적대적 리뷰 경화)
분석보고서가 식별한 gepa↔connect-ai 핵심 격차(능동 tool-loop·거버넌스 enforcement·상시 자율)를 **전부 opt-in(기본 off)**으로 구현. 불변식: `AGENT_TOOL_LOOP=false`+autonomy 2+읽기도구 상태에서 기본 런 동작 바이트 동일.
- [x] **능동 다단계 tool-loop**(`orchestrator/tools.ts` 신규 + `agent.ts`) — `work` 단계에서 `<tool name="x">arg</tool>` 태그 파싱→실행→`<tool_result>` 주입→재호출, `AGENT_MAX_TOOL_CALLS` 캡. 선그라운딩(turn0)은 시드로 유지. (BUILD_PLAN §3 L50 `에이전트 능동 tool-loop(다단계)` 항목 해소 — opt-in)
- [x] **거버넌스 enforcement**(`tools.ts toolsForAutonomy` + `agent.ts gateWrite`) — 자율레벨 0~3 이 실제로 도구를 게이팅(0=없음·1=읽기·2=쓰기승인·3=자동). `effectiveAutonomy` 정수 클램프(신뢰경계 방어). §10 '자율레벨 미집행' 격차 해소.
- [x] **쓰기 도구 save_note**(`agent.ts execLoopTool`) — `data/agents/<id>/knowledge.md` 컨테인먼트, autonomy≥2+승인 게이트, 셸 실행 제외.
- [x] **유휴 게이트 자율 사이클**(`autonomy/scheduler.ts` 신규 + `main.ts launchRun`) — `AUTO_CYCLE_MINUTES>0` 시 사용자 런 없을 때만 micro 제안→자율 실행, 사용자 런 도착 시 양보(abort). 단일 KV 슬롯 속도철학과 충돌 회피.
- [x] **적대적 멀티에이전트 리뷰(8 에이전트, 4차원)** → 확정 13건 중 수정: HIGH(루프 콘텐츠 유실 — 턴별 본문 누적), MED(gateWrite 취소 미배선·유휴게이트 비원자성·revise 우회), LOW(메트릭 누적·tool_result 캡·autonomy 클램프·경계일치·틱 재진입 가드·auto런 기록분리).
- [x] 검증: tsc 0 · 신규 테스트 25개(tools 15·scheduler 6·agentLoop 4) 통과 · 결정적 통합테스트(stub LLM)로 루프/게이트/콘텐츠보존 검증 · 라이브 스모크(loop-on 무크래시·그라운딩 정상).
- [ ] (잔여) 컨텍스트 슬라이딩 윈도우(현재 길이캡), 자율 사이클 알림 채널(텔레그램 등 범위제외).

### ✅ 19. 셸 실행 도구(run_command) — connect-ai `<run_command>` 패리티 + 적대적 보안리뷰 경화
gap 1 의 진짜 핵심(임의 명령 실행)을 옵트인으로 구현하되 connect-ai(블랙리스트, ACE 리스크)보다 근본적으로 방어적으로.
- [x] **`src/orchestrator/shell.ts`** — 순수 안전성 검사기 `checkCommand` + 샌드박스 비동기 실행 `runCommand`. `<tool name="run_command">` 를 WRITE_TOOL 로 루프에 배선(`AGENT_SHELL=1` 이중 옵트인 + autonomy≥2 + 명령별 승인).
- [x] **적대적 보안리뷰(6 에이전트, 3차원: 검사기우회·실행컨테인먼트·게이트통합)** — 초기 '경로 블랙리스트' 구현이 글로브·틸드·중괄호·백슬래시·절대경로·재귀검색으로 전부 우회됨을 PoC 로 입증(critical 다수).
- [x] **양성 컨테인먼트로 재설계**(리뷰 권고 '정공법'): `spawn(shell:false)`(확장 원천차단) + 경로 컨테인먼트(절대/`~`/`..` 인자 거부 → 샌드박스 하위로만) + argv allowlist(기본 읽기명령, 인터프리터 제외) + denylist + 특수문자거부 + 타임아웃 SIGKILL + 출력 30KB 하드캡(초과 시 kill).
- [x] 게이트 하드닝: 셸은 `ENFORCE_AUTONOMY=false` 라도 항상 게이트 · 승인 요약 전체 명령 노출(80자 절단 제거).
- [x] 검증: tsc 0 · 신규 14테스트(checkCommand/runCommand 12 + 통합 2) · 라이브 스모크로 안전명령 실행 + 보안리뷰 PoC 8종 전부 차단 실증.
- 잔존(문서화): 운영자가 인터프리터를 allowlist 에 추가하거나 샌드박스에 외부 심볼릭링크를 심는 경우 — LLM 위협모델 밖, 운영자 책임.

### ✅ 20. 위키 임베딩 의미검색 + 인증 하드닝
- [x] **임베딩 의미검색**(`src/wiki/embed.ts` 신규 + `llmwiki.semanticQuery`) — 비교보고서가 지적한 '평면 토큰 스코어링'을 보완. **retrieve→rerank**: 값싼 휴리스틱 `query()` 로 후보 K개 recall → 그 후보만 Ollama `/api/embed`(`ollama.embed`)로 임베딩→코사인 재정렬. 전 위키(수천 페이지) 일괄 임베딩 회피 + hash 캐시(`data/wiki/.embeddings.json`, 모델 변경 시 무효).
- [x] **graceful 폴백** — `USE_EMBEDDINGS=false`·임베딩 모델 미설치·임베딩 실패 시 모든 경로가 휴리스틱 `query()` 로 폴백(회귀 0). `resolveEmbedModel` 이 설정모델→설치 임베딩류 자동탐색→null. 기본 `EMBED_MODEL=bge-m3`(`ollama pull` 필요).
- [x] `agent.ts` 그라운딩을 `semanticQuery`(async) 로 전환 — 메인 그라운딩 경로에 의미검색 적용.
- [x] **인증 하드닝**(커밋 보안리뷰 대응) — `/wiki/inject` 의 `?token=` 쿼리 폴백 제거(URL/로그/referrer 유출 차단) + 상수시간 비교 `timingSafeEqual`(타이밍 공격 방지).
- [x] 검증: tsc 0 · 신규 11테스트(embed 8: cosine·resolveEmbedModel + semanticQuery 3: 폴백·rerank·캐시) · stub LLM 결정적 검증.
- 잔여(인증 정공법): 클라이언트 `document.cookie` 토큰을 서버 `/auth/login`+HttpOnly Set-Cookie 로 — 별도 인증 리팩터.

## 설계 메모(원본 실측 교훈)
- num_ctx 요청 미포함(서버 env 전담) — 리로드 스래시 방지.
- 로컬 동시성=1(단일 KV 슬롯). 마이크로 호출은 작은 모델로 별도 슬롯 여지.
- 소형 모델 폭주 백스톱: num_predict 캡(8192), 통합만 16000.
- 마이크로 단발(분해/배정/수렴/분류)은 풀 에이전틱 루프 금지 → 단발 호출.
