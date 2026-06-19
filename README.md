# gepa-ai-office

> 로컬 LLM(Ollama)을 직접 호출해 **속도를 최우선**으로 한, 단일 Node/TS 런타임의 멀티에이전트 AI 오피스. CEO + 전문가 팀이 주제를 분해·토론·종합하고, 그 지식을 마크다운 위키로 컴파일·유지한다.

---

## 1. 왜 만들었나

원본 GEPA AI Office는 풀 기능을 갖췄지만 **로컬 LLM 환경에서 느렸다.** 주요 원인은 다음과 같았다.

- 머신 사양과 무관하게 큰 모델(`gemma:12b` 등)을 고정 사용 → 16GB 머신에서 스왑/리로드로 매 턴 지연.
- 요청마다 `num_ctx`·`keep_alive` 옵션이 바뀌어 Ollama가 모델을 통째로 리로드(스래시).
- CLI 서브프로세스를 경유한 호출로 프리필/오버헤드 누적.

이 저장소는 그 원본을 **Connect AI를 벤치마킹**해 **로컬 우선**으로 재구현한 것이다. 핵심 설계 결정은 전부 "벽시계 시간을 줄인다"로 수렴한다.

- **Ollama `/api/chat` 직접 호출** (CLI 서브프로세스 X) → 오버헤드 최소.
- **RAM 예산 기반 모델 자동선택** — 실제 메모리를 재서 예산 안에 드는 모델만, 역할 tier별로 우-사이징(마이크로 호출=가장 작은 모델, 통합=가장 큰 모델).
- **`num_ctx`를 요청에 절대 싣지 않음** — 컨텍스트 길이는 서버 env(`OLLAMA_CONTEXT_LENGTH`)로만 고정해 리로드 스래시 방지.
- **단일 슬롯 직렬화**(로컬 concurrency=1) — 동시 세션이 KV 캐시를 밀어내 매 턴 전체 재프리필되는 것을 차단.
- **소형 프롬프트 + 마이크로 단발 호출** — 분해/배정/수렴판정/분류 같은 구조적 작업은 풀 에이전틱 루프 없이 1회 호출.

실측 예: 실제 런에서 프롬프트 231토큰 / 54 tok/s / 절단 없음.

---

## 2. 핵심 아키텍처

```
브라우저 (React 프론트 /  ·  경량 자체 UI /lite)
        │  HTTP + SSE (무접두 /runs… 계약 + /api/* 계약)
        ▼
Hono 서버 (src/server/main.ts) ── 단일 Node/TS 런타임
        │
   ┌────┼─────────────────────────────────────────────┐
   ▼    ▼                    ▼                          ▼
오케스트레이터        Karpathy LLM Wiki          거버넌스
(run/org/directed)   (src/wiki/llmwiki.ts)     (승인·자율레벨)
   │                        │
   ▼                        ▼
LLM 코어 (src/llm)    마크다운 지식베이스
 ollama.ts            (data/wiki/*.md)
 models.ts (자동배정)
        │
        ▼
   Ollama /api/chat (로컬, 단일 슬롯)
```

### (a) LLM 코어 — `src/llm/`
- `ollama.ts` — `/api/chat` 스트리밍 직접 클라이언트(`tags`/`ps`/`version`/warm). thinking 모델의 빈 출력 방지를 위해 요청에 `think:false`.
- `models.ts` — `getSystemSpecs()`로 RAM/CPU/Apple Silicon 감지 → `autoAssignModels()`가 설치 모델을 **micro / standard / heavy** 3 tier로 배정. 예산 초과 모델은 후보에서 제외.

### (b) 3가지 런 모드 — `src/orchestrator/`
디스패처 `index.ts`가 옵션에 따라 분기한다.

| 모드 | 트리거 | 동작 | 파일 |
|---|---|---|---|
| **directed** | `agent` 지정 | 직원 1명 단독 응답(가장 빠름) | `directed.ts` |
| **org**(위계) | `path='team'`/`'full'` 또는 `RUN_MODE=org` + 팀 존재 | CEO→팀(리드+팀원)→비평→CEO 종합 | `org.ts` + `prepare.ts`/`finalize.ts` |
| **debate**(평면) | 그 외(`RUN_MODE=debate`) | 전문가 평면 작업→비평/재반박 라운드→수렴판정→종합 | `run.ts` + `debate.ts` |

공통: 작업 전 위키 그라운딩(`wiki_query` 툴 보유 역할이 관련 지식을 자동 조회·주입), 종료 후 산출물 위키 ingest + 자가수선 maintain. `revise.ts`는 부모 런의 전문가 입장 + 피드백으로 CEO 재종합(v+1).

### (c) Karpathy "LLM Wiki" — `src/wiki/llmwiki.ts`
RAG(쿼리 시 임베딩 청크 검색)가 아니라, 에이전트가 직접 유지하는 **마크다운 지식베이스**. 지식을 1회 컴파일하고 계속 갱신(compounding)한다. 자세한 워크플로우는 6절 참조.

### (d) 거버넌스 — `src/approvals/`, `src/config.ts`
- 발행 휴먼 게이트(블로킹 + 타임아웃 fail-open), 자율 레벨(0=off,1=read,2=draft승인,3=auto), 동시성/팀병렬/턴캡 노브.

### (e) 프론트 — `frontend/`(React/Vite) + `public/index.html`(경량 SPA)
- React 프론트는 오피스 연출·타임라인·위키 그래프 뷰(`@xyflow/react`, `react-force-graph-2d`)·실시간 SSE 스트리밍. `/`에서 `frontend/dist`를 서빙.
- 빌드 불필요한 경량 단일 페이지 UI는 `/lite`.

### 내보내기 — `src/export/hwpx.ts` + `src/util/zip.ts`
순수 Node(의존성 無)로 마크다운 산출물을 한글 **HWPX**(OWPML section + 최소 ZIP 라이터, `mimetype` STORED-first)로 변환.

---

## 3. 빠른 시작

### 전제조건
- Node.js **>= 20.6** (ESM)
- [Ollama](https://ollama.com) 설치 + 최소 1개 채팅 모델 (예: `ollama pull gemma3:4b`)
- 패키지 매니저 `pnpm` (npm 도 가능)

### 설치
```bash
git clone <repo> gepa-ai-office
cd gepa-ai-office
pnpm install
# (선택) React 프론트도 빌드
cd frontend && pnpm install && pnpm build && cd ..
```

### Ollama 튜닝 서버 띄우기 (속도 핵심, 권장)
> ⚠️ 메뉴바 Ollama.app 이 11434 포트를 선점하면 튜닝 서버가 못 뜬다 — 먼저 종료할 것.

```bash
./scripts/serve_ollama_tuned.sh
# 적용값: KEEP_ALIVE=30m · CONTEXT_LENGTH=16384 · FLASH_ATTENTION=1 · KV_CACHE_TYPE=q8_0 · NUM_PARALLEL=1
# 큰 머신은 컨텍스트를 늘려서:
OLLAMA_CONTEXT_LENGTH=32768 ./scripts/serve_ollama_tuned.sh
```
확인: `curl -s localhost:11434/api/ps` → `context_length` 16384, `expires_at` 약 30분 뒤.

### 개발 서버 실행
```bash
pnpm dev          # tsx watch src/server/main.ts (핫리로드)
# 또는 비-watch
pnpm start
```
브라우저에서 **http://localhost:8787** 접속.
- `/` — React 프론트(빌드돼 있으면)
- `/lite` — 빌드 불필요 경량 UI

주제를 입력하면 실시간으로 에이전트 스트리밍, 속도 메트릭(평균 프롬프트 토큰·tok/s·호출수·경과), 위키 자동 적재가 보인다.

---

## 4. 주요 API

서버는 GEPA React 프론트용 **무접두 계약**(`/runs…`)과 자체 UI용 **`/api/*` 계약**을 둘 다 등록한다. 아래는 무접두(프론트) 계약 기준.

### 런 (run)
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/runs` | 런 시작. body `{ topic, agent?, path?, budget_usd? }` → `{ run_id }`. `agent`=directed, `path='team'\|'full'`=org |
| GET | `/runs` | 런 목록 |
| GET | `/runs/:id` | 런 상태(status·deliverable 등) |
| GET | `/runs/:id/events` | **SSE** 이벤트 스트림(`Last-Event-ID` 재개 지원, 15s ping) |
| GET | `/runs/:id/log` | 이벤트 전체(버스 생존 시 메모리, 폐기 후 영속 `events.jsonl` replay) |
| POST | `/runs/:id/cancel` | 취소 → status `cancelled` |
| POST | `/runs/:id/revise` | 수정 요청(v+1). body `{ feedback }` → `{ run_id, version }` |
| GET | `/runs/:id/export/hwpx` | 산출물을 한글 **HWPX** 파일로 다운로드 |

### 위키 (wiki)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/wiki/graph` | 지식 그래프(nodes/links/stats) |
| GET | `/wiki/pages` | 페이지 목록(`?category=entity\|concept\|source…`) |
| GET | `/wiki/page/:id` | 페이지 상세(본문·관계) |
| GET | `/wiki/stats` | 페이지/소스 카운트 |
| GET | `/wiki/lint` | 고아·끊긴링크(지식 갭) 점검 |
| POST | `/wiki/maintain` | 자가수선: 끊긴링크를 LLM으로 보충(`?n=개수`, 기본 6) |
| POST | `/wiki/audit` | 모순 감사(`?n=쌍수`, `?resolve=1`이면 해소 노트 기록) |

### 승인 (approval)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/approvals` | 대기 중 승인 목록 |
| POST | `/approvals/:id/decide` | 승인/반려. body `{ approved, note? }` |

### 자료/내보내기·기타
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/sources` | multipart 텍스트(.md/.txt/.csv/.json) 업로드 → 위키 `source` 페이지 적재(에이전트 그라운딩 소스화) |
| GET | `/sources` | 업로드된 소스 목록 |
| GET | `/llm` · `/api/llm` | LLM 백엔드 상태(설치 모델·로드 상태·자동배정) |
| GET | `/company` · `/api/company` | 회사 로스터(CEO·팀·팀원) |
| GET | `/healthz` · `/api/health` | 헬스체크 |

> 미구현 패널(`/sync`·`/templates`·`/mcp`·`/api-keys` 등)은 프론트가 빈 상태로 우아하게 렌더하도록 스텁 응답. 미구현 쓰기는 JSON 501.

---

## 5. 설정 (환경변수)

모두 선택값이며, 비우면 로컬 우선 기본값이 적용된다(`src/config.ts`).

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | 서버 바인딩 |
| `BACKEND` / `LOCAL_LLM` | `local` / `true` | LLM 백엔드(현재 로컬 중심) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama 주소 |
| `LOCAL_LLM_MODEL` | `''` | 비우면 RAM 예산으로 자동 선택 |
| `AUTO_SELECT_MODEL` | `true` | 모델 자동배정 on/off |
| `LOCAL_LLM_KEEP_ALIVE` | `30m` | 모델 상주(정식 경로는 서버 env) |
| `LOCAL_LLM_MAX_OUTPUT_TOKENS` | `8192` | `num_predict` 캡, [1,32768] 클램프 |
| `LOCAL_LLM_INTEGRATION_MAX_OUTPUT_TOKENS` | `16000` | CEO 통합 단계 출력 캡 |
| `LLM_TEMPERATURE` / `LLM_TOP_P` / `LLM_TOP_K` | `0.7` / `0.9` / `40` | 샘플링 |
| `CONCURRENCY` | 로컬 `1` | 동시 LLM 세션(벽시계 1번 노브) |
| `TEAM_PARALLEL` | 로컬 `1` | 팀 병렬도 |
| `MAX_TURNS_PER_AGENT` | 로컬 `8` | 에이전트당 최대 턴 |
| `RUN_MODE` | `org` | `org`(위계) 또는 `debate`(평면) |
| `MIN_SPECIALISTS` / `MAX_SPECIALISTS` | 로컬 `2` / `3` | 전문가 수 범위 |
| `DEBATE_ROUNDS` / `DEBATE_ROUNDS_CAP` | 로컬 `1` / `2` | 토론 라운드 |
| `TERMINATION` | `adaptive` | 수렴 종료 방식 |
| `DEFAULT_AUTONOMY` | `2` | 기본 자율 레벨(2=draft 승인) |
| `REQUIRE_APPROVAL` / `APPROVAL_TIMEOUT_S` | `false` / `600` | 발행 승인 게이트 |
| `WRITE_SESSION_DIGEST` | `true` | 세션 다이제스트 영속화 |
| `WEB_SEARCH` | `true` | 인-프로세스 웹검색(DDG) |
| `AGENT_TOOL_LOOP` | `false` | **능동 다단계 tool-loop**(opt-in). on 이면 `work` 단계 에이전트가 `<tool name="…">` 태그로 추가 자료를 스스로 조회·재호출 |
| `AGENT_MAX_TOOL_CALLS` | `4` | 한 에이전트 턴의 총 도구 호출 캡(`[1,12]`, 로컬 속도 백스톱) |
| `ENFORCE_AUTONOMY` | `true` | 자율레벨(0~3) 강제 — 쓰기성 도구를 게이팅(2=승인, 3=자동, ≤1=차단). 쓰기 도구가 없으면 no-op |
| `AUTO_CYCLE_MINUTES` | `0` | **유휴 게이트 자율 사이클**(0=off). 사용자 런이 없을 때만 '단일 작업'을 자율 실행, 사용자 런 도착 시 양보 |
| `AGENT_SHELL` | `false` | **셸 실행 도구**(`run_command`) 옵트인. tool-loop 와 별개로 명시 활성해야 함(위험 표면) |
| `AGENT_SHELL_ALLOW` | (읽기명령) | 셸 allowlist(argv[0] basename). 기본은 읽기전용 분석명령만 — `python3`/`node` 등 인터프리터는 사실상 임의실행이라 명시 추가해야 하며 `autonomy=2`(승인)와 함께 쓸 것 |
| `GEPA_DATA_DIR` | `./data` | 데이터 루트(wiki/sessions/approvals) |

> Ollama 서버 env(`OLLAMA_CONTEXT_LENGTH`·`OLLAMA_KEEP_ALIVE`·`OLLAMA_FLASH_ATTENTION`·`OLLAMA_KV_CACHE_TYPE`·`OLLAMA_NUM_PARALLEL`)는 앱이 아니라 `scripts/serve_ollama_tuned.sh`가 설정한다.

---

## 6. 위키 워크플로우 (Karpathy LLM Wiki)

`data/wiki/` 아래에 LLM이 직접 유지하는 마크다운 지식베이스. RAG(쿼리 시 임베딩 청크 검색)가 아니라 지식을 1회 컴파일해 계속 갱신(compounding)한다. 구조:

```
data/
├── raw/                  # 업로드 원본(불변)
└── wiki/
    ├── index.md          # 카탈로그(카테고리별 1줄 요약) — 인덱스 우선 탐색 진입점
    ├── log.md            # append-only 타임라인 (## [YYYY-MM-DD] op | Title)
    ├── WIKI_SCHEMA.md    # 유지 규칙(스키마) 문서
    └── pages/*.md        # 엔티티/개념/소스 페이지 (YAML 프런트매터 + [[위키링크]])
```

각 페이지는 `title/slug/type/aliases/sources/contributors/updated/summary` 프런트매터와 본문(`[[다른-페이지]]` 위키링크 포함)을 가진다.

| 워크플로우 | 코드 | 설명 |
|---|---|---|
| **ingest** | `ingest()` | LLM 주도: 산출물/소스 → 엔티티·개념 추출 → 페이지 생성·갱신([[링크]]) → index 재생성 → log 기록. 재적재 시 '갱신' 섹션 머지(compounding). |
| **query** | `query()` | 인덱스 우선 탐색(임베딩 불필요) → 에이전트 작업 전 관련 지식 주입(그라운딩, `wiki_query` 이벤트). |
| **lint** | `lint()` | 고아 페이지·끊긴 링크 = 지식 갭 탐지. → `GET /wiki/lint`. |
| **maintain** | `maintain()` | 자가수선: lint가 찾은 끊긴 링크를 LLM이 보충해 페이지 생성·연결. `POST /wiki/maintain?n=N` + **런 종료 시 자동**(maxFill 2). |
| **audit** | `findContradictions()` | 토픽 겹치는 페이지 쌍을 LLM 비교 → 상충 주장 탐지. `?resolve=1`이면 ⚖️ 해소 노트 기록. `POST /wiki/audit?n=N&resolve=1`. |

흐름 예: 런이 끝나면 산출물이 `ingest`로 엔티티/개념 페이지가 되고, 끊긴 링크가 있으면 자동 `maintain`이 보충해 그래프 연결을 늘린다. 다음 런은 그 지식을 `query`로 자동 그라운딩한다 — 쓸수록 똑똑해지는 "제2의 두뇌".

---

## 6-1. Connect AI 패리티 — 능동 실행·거버넌스·자율 (옵트인)

기본 런은 "분해→작업→종합"의 빠른 단발 경로다. 그 위에 Connect AI 식 **능동 에이전트** 3종을 **opt-in**으로 얹었다 — 전부 기본 off 라 켜기 전까지 기본 동작은 바이트 단위로 동일하다.

| 기능 | 켜기 | 동작 | 코드 |
|---|---|---|---|
| **능동 tool-loop** | `AGENT_TOOL_LOOP=1` | `work` 단계 에이전트가 응답 중 `<tool name="wiki_query">질의</tool>` 태그를 내면 → 도구 실행 → `<tool_result>` 주입 → 재호출(`AGENT_MAX_TOOL_CALLS` 캡). 선그라운딩(1회)을 넘어 모델이 **필요한 자료를 스스로 더 캐는** 다단계 루프 | `orchestrator/tools.ts`·`agent.ts` |
| **거버넌스 enforcement** | `ENFORCE_AUTONOMY=1`(기본) | 자율레벨로 도구를 게이팅 — `0`=없음, `1`=읽기만, `2`=쓰기는 **승인 게이트**(블로킹·타임아웃 fail-open), `3`=자동. 취소 시 승인 대기도 즉시 거부로 양보 | `agent.ts gateWrite`·`workspace.ts` |
| **쓰기 도구** | (위 루프 + autonomy≥2) | `<tool name="save_note">…</tool>` → 본인 `data/agents/<id>/knowledge.md` 에 한 줄(컨테인먼트) | `agent.ts execLoopTool` |
| **셸 실행** | `AGENT_SHELL=1`(+autonomy≥2) | `<tool name="run_command">cmd</tool>` → 샌드박스에서 단일 명령 실행. **다층 방어**(아래) | `orchestrator/shell.ts` |
| **유휴 게이트 자율 사이클** | `AUTO_CYCLE_MINUTES=N` | N분마다 **사용자 런이 없을 때만** 위키 인덱스/결정로그에서 '가장 가치있는 단일 작업'을 micro 로 제안→자율 실행. 사용자 런 도착 시 진행 중 자율런을 **양보(abort)**. 단일 KV 슬롯 속도철학과 충돌 회피 | `autonomy/scheduler.ts`·`server/main.ts` |

> 설계 원칙: 로컬 속도·단일 KV 슬롯 불변식을 깨지 않도록 전부 보수적 기본값(off)·유계(캡)·양보(yield). 능동 실행이 열리는 순간 거버넌스가 필요해지므로 셋은 함께 설계됐다.

**셸 실행(`run_command`) 보안 모델 — 양성 컨테인먼트.** connect-ai 의 `<run_command>`(보고서가 ACE 리스크로 지적)보다 근본적으로 방어적이다. 적대적 보안리뷰(3 에이전트)가 초기 '경로 블랙리스트' 구현을 글로브(`cat ~/.s?h/id_r*`)·틸드·중괄호·백슬래시·절대경로·재귀검색으로 전부 우회함을 입증해, **블랙리스트를 폐기하고 양성 컨테인먼트로 재설계**했다:

- `spawn(shell:false)` — 셸 미경유라 글로브·틸드·치환·리다이렉트·체이닝 확장이 **원천 차단**(인자는 전부 리터럴).
- **경로 컨테인먼트** — 모든 인자가 절대경로(`/`)·홈(`~`)·상위(`..`)를 못 써 샌드박스 `data/agents/<id>/workspace/` 하위로만 해석된다(시스템·홈·타사용자·시크릿 도달 불가).
- argv[0] **allowlist**(기본 읽기명령) + 파국 **denylist**(rm/dd/sudo…) + 특수문자 거부 + 타임아웃 SIGKILL + 출력 30KB 하드캡.
- autonomy 게이트는 셸에 대해 `ENFORCE_AUTONOMY=false` 라도 항상 적용. 잔존 리스크: 운영자가 인터프리터를 allowlist 에 넣거나 샌드박스에 외부 심볼릭링크를 심는 경우(LLM 위협모델 밖, 운영자 책임).

## 7. 프로젝트 구조

```
gepa-ai-office/
├── BUILD_PLAN.md             # 빌드 진행 현황·설계 메모
├── package.json              # Node22·ESM·Hono·tsx·vitest
├── tsconfig.json
├── scripts/
│   └── serve_ollama_tuned.sh # Ollama 튜닝 런처(ctx·keep_alive·flash·kv·single-slot)
├── public/
│   └── index.html            # 경량 자체 SPA(/lite, 빌드 불필요)
├── frontend/                 # GEPA React/Vite 프론트(/ 에서 dist 서빙)
│   └── dist/                 # 빌드 산출물 + 아바타/가구 에셋
├── assets/hwpx/              # HWPX 템플릿(base/report — OWPML)
├── data/                     # 런타임 데이터(GEPA_DATA_DIR)
│   ├── wiki/                 # LLM Wiki 마크다운 지식베이스
│   ├── sessions/             # 세션 다이제스트 + events.jsonl
│   └── approvals/            # 승인 이력
└── src/
    ├── config.ts             # 전역 설정(env, 로컬 기본값)
    ├── server/main.ts        # Hono HTTP + SSE 서버(전 엔드포인트)
    ├── llm/
    │   ├── ollama.ts         # /api/chat 직접 스트리밍 클라이언트
    │   └── models.ts         # 사양 감지 + RAM 예산 모델 자동배정
    ├── agents/company.ts     # CEO + 전문가/팀 페르소나·tier·툴 정의
    ├── orchestrator/
    │   ├── index.ts          # 디스패처(directed/org/debate 분기)
    │   ├── run.ts            # debate(평면) 런
    │   ├── org.ts            # org(위계) 런
    │   ├── directed.ts       # 직원 단독 런
    │   ├── debate.ts         # 토론 라운드·수렴판정
    │   ├── prepare.ts        # 분해·배정
    │   ├── finalize.ts       # CEO 종합 + 위키 ingest/maintain
    │   ├── revise.ts         # 수정 요청 재종합(v+1)
    │   └── agent.ts          # 경량 에이전트 호출(그라운딩·스트림·이벤트)
    ├── wiki/llmwiki.ts       # Karpathy LLM Wiki(ingest/query/lint/maintain/audit)
    ├── approvals/store.ts    # 승인 라이프사이클(pending→history)
    ├── export/hwpx.ts        # markdown → HWPX(OWPML)
    ├── util/
    │   ├── zip.ts            # 순수 Node 최소 ZIP 라이터(STORED, CRC32)
    │   ├── ids.ts            # id 생성
    │   ├── semaphore.ts      # 동시성 세마포어
    │   └── abort.ts          # AbortSignal 헬퍼/폴리필
    ├── events/
    │   ├── types.ts          # EventEnvelope(원본 와이어 호환) + llm_metric
    │   └── bus.ts            # 런별 버스(seq·리플레이·델타 coalescing)
    ├── sessions/digest.ts    # 세션 다이제스트(_brief/_report/<agent>.md)
    ├── tools/web_search.ts   # 인-프로세스 DDG 웹검색(키 불필요)
    └── bench/bench.ts        # 헤드리스 벤치(토큰·tok/s·벽시계)
```

---

## 8. 테스트

```bash
pnpm test          # vitest run (1회)
pnpm test:watch    # 워치 모드
pnpm typecheck     # tsc --noEmit
```

현재 **31개 통과**(models 5 · agent 5 · wiki 6 · web_search 4 · approvals 5 · llmwiki 8 · hwpx 4) · tsc 클린 · 프론트 빌드 OK.

헤드리스 벤치(단계별 토큰·tok/s·벽시계):
```bash
tsx src/bench/bench.ts
```

---

## 부록: 설계 메모(로컬 실측 교훈)

- `num_ctx`를 요청에 포함하지 않는다 → 리로드 스래시 방지(서버 env 전담).
- 로컬 동시성=1(단일 KV 슬롯). 마이크로 호출은 작은 모델로 별도 슬롯 여지.
- 소형 모델 폭주 백스톱: `num_predict` 캡(8192), 통합만 16000.
- 마이크로 단발(분해/배정/수렴/분류)은 풀 에이전틱 루프 금지 → 단발 호출.
- thinking 모델은 `think:false`로 호출(추론에 `num_predict` 소진 → content 공백 방지).
