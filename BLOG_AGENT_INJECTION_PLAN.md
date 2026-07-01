# 네이버 블로그 에이전트 → AI_ContentsCreator(gepa-ai-office) 주입 계획서

> 작성일: 2026-07-01 · 상태: **계획서만 (코드 미변경)**
> 소스: `~/Desktop/SB_AI_Agents/naver-blog-agent-web` (`.claude/agents`, `.claude/skills`, `backend/app/services`)
> 타깃: `~/Desktop/AI_ContentsCreator` (= `gepa-ai-office`)

---

## 0. 확정된 결정 (사용자 선택)

| 항목 | 결정 |
|---|---|
| 주입 목표 | **gepa 앱 에이전트에 이식** — `data/company.yaml`의 role `system_prompt` + gepa 네이티브 툴 |
| 스킬 전략 | **Python 스크립트 재사용(shell-out)**, 단 **이미지 생성은 Gemini → `gpt-image-2`로 교체** |
| 진행 | **계획서만 작성** (이 문서). 코드 변경 없음 |

---

## 1. 핵심 진단 — 왜 "복사"가 아니라 "이식"인가

두 프로젝트는 **런타임이 다릅니다.**

| | naver-blog-agent-web | AI_ContentsCreator (`gepa-ai-office`) |
|---|---|---|
| 실행 주체 | **Claude Code / `claude` CLI가 직접 구동** (백엔드는 `.claude/*`를 읽지 않음 — grep 0건) + 현재는 FastAPI 백엔드(`backend/app/services/*`)가 실질 로직 수행 | **자체 TypeScript 앱** (Node, Ollama 우선, 이벤트버스) |
| 에이전트 정의 | `.claude/agents/<name>/AGENT.md` (마크다운 페르소나, **레거시**) | `data/company.yaml`의 role `system_prompt` (+ `people.yaml` 실명 매핑) |
| 스킬/툴 | `.claude/skills/<name>/SKILL.md` + Python 스크립트 (standalone argparse) | XML 툴콜 `<tool name="x">arg</tool>` → `src/orchestrator/tools.ts` 게이팅 → `src/tools/*`·`src/grounding/*` TS 구현 |
| 파이프라인 | 번호 JSON 파일 핸드오프 (`01_research → 02_plan → 03_draft → …`) | 팀 실행: 리서치·SEO팀 → 제작팀 → 편집장 finalize (`src/orchestrator/org.ts`) |
| LLM | Claude Haiku/Sonnet (CLI 구독), Gemini(이미지) | Ollama/Anthropic 티어 (`src/llm/*`) — **OpenAI 프로바이더 없음** |

> **레거시 주의**: naver-blog `CLAUDE.md`에 따르면 `.claude/agents`·`.claude/skills`는 "과거 CLI 오케스트레이터 시절" 산출물이고, 실제 최신 로직은 `backend/app/services/`(writer.py·publisher.py·image_gen.py 등)에 있습니다.
> - **페르소나 규칙**의 소스로는 `.claude/agents/*/AGENT.md`가 가장 깔끔(읽기 쉬운 규칙 명세). 최신성은 `backend/app/prompts/*`와 교차 확인.
> - **스킬 재사용**의 소스로는 `.claude/skills/*/scripts/*.py`(standalone CLI, argparse, 파일 in/out)가 shell-out에 이상적. 웹앱 버전(`app/services/*.py`)은 async·DB 결합이라 부적합.

---

## 2. 결정적 발견 — gepa는 이미 "네이버 블로그 자동 콘텐츠 회사"

`data/company.yaml` 첫 줄: *"AI 콘텐츠 스튜디오 — 네이버 블로그(정보/하우투·리뷰) 자동 콘텐츠 회사."*

이미 존재하는 조직:

- **편집장(ceo)** — 최종 취합·검증
- **리서치·SEO팀** — `research_lead`, `trend_researcher`, `seo_strategist`, `reviewer`(팩트체커·크리틱, `is_critic:true`), `perf_analyst`
- **제작팀** — `content_lead`(수석 작가·카피라이터)

그리고 `naver_search / naver_searchad / naver_datalab / naver_autocomplete / naver_analytics`가 **이미 네이티브 TS 툴**(`src/grounding/*.ts`)로 구현되어 있습니다.

**→ 결론: 블로그 에이전트와 gepa 회사는 개념적으로 거의 1:1.** "주입"의 net-new 작업은 딱 세 덩어리입니다:
1. **writer/critic 페르소나 심화** (블로그의 상세 문체·SEO·채점 규칙을 gepa role에 병합)
2. **`image_generate` 툴** (gpt-image-2)
3. **`blog_publish` 툴** (임시저장 전용, Playwright)

---

## 3. 대응표 (Mapping)

### 3-A. 페르소나: 블로그 AGENT.md → gepa role.system_prompt

| 블로그 에이전트 | → gepa role (`company.yaml`) | 병합할 지식 | 상태 |
|---|---|---|---|
| researcher | `trend_researcher` / `research_lead` | 조사 절차·경쟁 콘텐츠 빈틈 분석 | ✅ 대부분 이미 존재 |
| planner | `research_lead`(콘텐츠 브리프) + `ceo`(구조 결정) | 검색의도·구조(H2/H3)·분량·SEO 전략 브리프 | 🟡 부분 존재 |
| **writer** | `content_lead` (수석 작가) | **문체(1문장 40자·능동태·구어체), 구조(H2+이모지 필수, `[IMAGE:]` 마크업), SEO 배치, 분량 ±20%, 태그 5–10, CTA, 금지사항** | 🔴 net-new (핵심) |
| **critic** | `reviewer` (`is_critic:true`) | **7개 기준 채점(정확성/실용성/논리/가독성/차별성/SEO/이모지, 각 0–10, 49/70=APPROVED), 구체적 수정지시 포맷** | 🔴 net-new (핵심) |
| editor | `content_lead` 재작성 + `ceo` finalize | 크리틱 피드백 반영 퇴고 루프 | 🟡 org.ts에 유사 흐름 존재 |

### 3-B. 스킬: 블로그 SKILL → gepa 툴

| 블로그 스킬 | 스크립트 | → gepa | 작업 |
|---|---|---|---|
| web-search | `naver_search.py` (Naver Search API) | `naver_search` + `web_search` | ✅ **이미 네이티브** (`src/grounding/*`) — 페르소나에 사용지침만 |
| file-io | `json_handler.py` (JSON 검증) | `wiki` / `save_note` / 이벤트버스 상태 | ⛔ 불필요 — gepa는 번호 JSON 핸드오프를 안 씀 |
| **image-generator** | `gemini_image.py` (google-genai) | 신규 `image_generate` **WRITE 툴** | 🔴 스크립트를 `openai_image.py`(gpt-image-2)로 교체 후 shell-out |
| **blog-publisher** | `naver_publish.py` (Playwright) | 신규 `blog_publish` **WRITE 툴** (승인 게이트) | 🔴 스크립트 그대로 재사용(임시저장 전용) |

---

## 4. gepa 툴 시스템 실측 (변경 지점의 근거)

파일: `src/orchestrator/tools.ts`, `src/orchestrator/agent.ts`, `src/orchestrator/shell.ts`, `src/agents/company-loader.ts`

- **툴 게이팅** (`tools.ts`)
  - `READ_TOOLS` (L36–39): 부작용 없음, autonomy≥1 허용.
  - `WRITE_TOOLS` (L41): `save_note`, `run_command` — autonomy≥2 + **호출 시점 승인 게이트**.
  - `toolsForAutonomy(allowed, autonomy)` (L48–54): 자율도로 제시 가능 툴 필터.
  - `TOOL_DESC` (L56–68): 시스템 프롬프트에 주입되는 툴 설명.
- **툴 디스패치** (`agent.ts`)
  - `availableLoopTools()` (L386–396): role의 tools + 커넥터 + 쓰기후보 → 게이팅.
  - `execLoopTool()` (L399–440): 툴 1건 실행 → 관찰 문자열. **WRITE_TOOLS 분기(L414–428)** 에서 `gateWrite` 후 실행.
  - `gateWrite()` (L444–464): autonomy≥3 자동 · 2 승인대기(블로킹) · ≤1 차단. 이벤트버스로 승인 요청.
- **role→tool grant** (`company-loader.ts`)
  - `company.yaml`의 role `tools:` 리스트에 이름을 넣으면 grant.
  - `mapTools()` (L93–102): `wiki→wiki_query+wiki_ingest`, `web→web_search`, 나머지는 그대로 통과.
  - `YAML_TOOLS` set (L34–37): UI 재저장 시 스트립 방지용 화이트리스트 — **신규 툴 이름을 여기 추가**해야 직원 편집기에서 안 지워짐.
- **셸 실행 제약** (`shell.ts`, `config.ts`) — ⚠️ 설계상 중요
  - `runCommand`는 `spawn(bin, args, {shell:false})` — 파이프·리다이렉트·글로브 원천 차단.
  - `checkCommand`: 명령은 **경로(`/`)가 아닌 allowlist 이름**으로 시작해야 함 → `./venv/bin/python …`은 거부됨.
  - `CONFIG.agentShellAllow` 기본값은 **읽기 전용 명령만** — `python3`/`node` 같은 범용 인터프리터를 **의도적으로 제외**(임의 실행기는 RCE로 allowlist 무력화).
  - **함의: 범용 `run_command`로 블로그 Python 스크립트를 돌리는 것은 (a) 기본 allowlist에 python 없음 + (b) venv python 경로에 `/` 포함으로 이중 차단됨. allowlist를 넓히는 것은 보안 저자가 피한 RCE 리스크.**

---

## 5. 설계 결정 — 왜 "전용 툴 + 고정 argv spawn"인가

**채택: `image_generate` / `blog_publish`를 별도 WRITE 툴로 신설**하고, 각 툴이 `child_process.spawn`으로 **고정 인터프리터·고정 스크립트 경로·구조화된 인자**만 실행.

- 모델은 **자유 명령 문자열이 아니라 구조화 인자(주제·콘텐츠 경로 등)만** 제공 → RCE 표면 없음.
- `shell.ts`의 spawn 패턴(`shell:false`, 타임아웃, abort 배선) 재사용.
- 인터프리터는 **전용 venv python 절대경로를 CONFIG로 고정**(allowlist·`checkCommand` 우회가 아니라 애초에 `run_command` 경로를 안 탐).
- `blog_publish`는 **부작용(외부 네이버 초안 생성)** 이므로 WRITE_TOOLS로 등록 → `gateWrite` 승인 필수(autonomy 2=승인대기, 3=자동).

**기각: 범용 `run_command` 재사용** — §4의 이중 차단 + allowlist 확장의 RCE 리스크 때문.
**기각: 네이티브 TS 재구현** — 사용자가 "Python 재사용" 선택. Playwright 발행 로직 재작성은 고비용.

---

## 6. Part A — 페르소나 주입 (코드 아님, 프롬프트 데이터)

### 변경 파일
- `data/company.yaml` (런타임 진실원천)
- `assets/company/company.yaml` (시드 — 신규 데이터 디렉토리에 복사되는 기본값. **둘 다** 갱신해야 초기화·기존 환경 모두 반영)

### A-1. `content_lead`(수석 작가) `system_prompt`에 병합 — writer/AGENT.md에서
- 문체: **1문장 40자 이내**, 문단 3–5문장(핵심→설명→예시), 능동태 우선("~하세요"), 구어체 허용, 구체적 수치.
- 구조: 소제목 **H2(`##`) + 이모지 1개 필수**, 소제목 아래 핵심문장 1개 시작, 중요정보 **굵게**, 리스트 항목별 이모지, 이미지 자리 `[IMAGE: 설명]` 마크업, CTA 마지막 문장 이모지 1–2개.
- SEO: 메인 키워드 = 제목 + 첫 100자 + 소제목 최소 1개, 자연스러운 밀도(과최적화 금지), 연관 키워드 분산.
- 분량: 목표 2500자 ±20%(2000–3000, 공백 포함 한글자 수), 태그 5–10개.
- 금지: 미확인 수치·정책, 근거 없는 수식("최고의/완벽한"), 개인정보 수집 유도, 특정 업체 광고.

### A-2. `reviewer`(팩트체커·크리틱) `system_prompt`에 병합 — critic/AGENT.md에서
- **7개 기준 각 0–10점**: accuracy, practicality, logic, readability, differentiation, seo, emoji.
- emoji 세부(소제목 이모지 4점 / 리스트 3점 / CTA 3점, 반복·문장중간 삽입 감점).
- **판정: total ≥ 49/70 → APPROVED, 아니면 REVISION_NEEDED.**
- 피드백은 **구체·실행가능**하게(예: "3섹션 첫 문장 65자로 김 → 두 문장으로 분리"). 독립성·일관성·건설적·현실성(소상공인 맥락)·엄격함(문턱 70%).

### A-3. `research_lead` / `trend_researcher` (선택 심화)
- researcher/planner AGENT.md의 조사·브리프 절차를 확인 후 부족분만 보강(대부분 이미 커버).

### 주의
- `company.yaml`은 웹 UI 직원 편집기로도 수정되는 **준-신뢰 입력** → `company-loader.ts`(L110~)가 제어문자 제거·길이 제한으로 **프롬프트 인젝션 방어**. 페르소나 텍스트가 과도하게 길면 잘릴 수 있으니 **핵심 규칙 위주로 압축**해 넣을 것.
- gepa는 번호 JSON 파일(`02_content_plan.json` 등)을 쓰지 않으므로, AGENT.md의 "입력/출력 파일" 문구는 **그대로 옮기지 말고** gepa의 팀 산출물 흐름(브리프→초안→검증)으로 번안.

---

## 7. Part B — 스킬을 gepa 툴로

### B-1. `image_generate` 툴 (gpt-image-2)

**스크립트 (신규, Python 재사용 기반):** `scripts/blog_skills/openai_image.py`
- 소스: 블로그 `gemini_image.py`를 복사 후 **이미지 생성부만 교체**.
  - 제거: `google-genai`(Gemini 2.5 Flash Image) 호출.
  - 추가: **OpenAI Images API** 호출 — 파이썬 `openai` SDK `client.images.generate(model="gpt-image-2", prompt=..., size=..., n=1)`, 응답 b64 → `Pillow`로 PNG 저장.
  - ⚠️ **구현 시 확인**: 정확한 모델 id/파라미터(`response_format`/`b64_json` 지원 여부, size 옵션)는 OpenAI 이미지 API 최신 문서로 검증. `MODEL = "gpt-image-2"` 상수 1곳으로 관리해 교체 쉽게.
- **CLI 인터페이스는 유지**(shell-out 계약 고정): `--final-content`, `--output-dir`, `--manifest`, `--business-type`, `--image-style`, `--topic`, `--dry-run`.
  - 단, gepa는 `05_final_content.json`을 안 만드므로 **입력 계약을 gepa 산출물에 맞춰 단순화** 권장: `--content <초안 텍스트/JSON 경로>` + `--slots <이미지 슬롯 JSON>` → `--manifest <출력 경로>`. (초안에서 `[IMAGE: 설명]` 마크업을 파싱해 슬롯 생성)
- env: `OPENAI_API_KEY`.

**gepa 코드 변경:**
1. `src/orchestrator/tools.ts`
   - `WRITE_TOOLS`에 `'image_generate'` 추가 (부작용: 파일 생성·API 과금).
   - `TOOL_DESC`에 `image_generate: '초안의 [IMAGE:] 슬롯을 gpt-image-2로 생성하고 매니페스트 반환'`.
2. `src/orchestrator/agent.ts` → `execLoopTool` WRITE 분기(L414~)에 case 추가:
   - `gateWrite` 승인 후 → 새 헬퍼 `runBlogScript('openai_image', args, signal)`가 `spawn(CONFIG.blogPython, [CONFIG.blogScriptsDir+'/openai_image.py', ...구조화 인자], {shell:false, signal, timeout})`.
   - 반환: 생성 이미지 수·매니페스트 경로 요약 문자열.
3. `src/config.ts`: `blogPython`(전용 venv python 절대경로, env `BLOG_PYTHON`), `blogScriptsDir`(env `BLOG_SCRIPTS_DIR`), `openaiApiKey`(env `OPENAI_API_KEY`, 서브프로세스 env로 전달).
4. `src/agents/company-loader.ts` `YAML_TOOLS`에 `'image_generate'` 추가.
5. `data/company.yaml` + 시드: `content_lead`(또는 별도 `media` role)의 `tools:`에 `image_generate` 추가, autonomy≥2.

### B-2. `blog_publish` 툴 (임시저장 전용, Playwright)

**스크립트 (재사용):** 블로그 `naver_publish.py` 그대로 복사 → `scripts/blog_skills/naver_publish.py`
- **발행 버튼 절대 클릭 안 함 — 임시저장(draft)까지만.** (블로그 앱의 안전 원칙 유지: 최종 발행은 사람이 수동.)
- CLI: `--final-content`, `--image-manifest`, `--session-file`(Playwright storage_state, 기본 `.naver_session.json`), `--run-dir`, `--headless`, `--dry-run`.
- 산출: `{run_dir}/07_publish_result.json` + `screenshots/draft_saved.png`.
- 의존: `playwright==1.49.1` (+ chromium), 네이버 세션 파일.

**gepa 코드 변경:** B-1과 동형
1. `tools.ts`: `WRITE_TOOLS`에 `'blog_publish'`, `TOOL_DESC`에 `blog_publish: '네이버 SmartEditor에 임시저장(초안)만. 발행은 사람이 수동.'`.
2. `agent.ts`: `execLoopTool` WRITE 분기에 case, `gateWrite`(발행류라 **autonomy 3이어도 승인 권장** — 아래 §9 참고) → `runBlogScript('naver_publish', args)`.
3. `config.ts`: `naverSessionFile`(env `NAVER_SESSION_FILE`), `blogRunDir`.
4. `company-loader.ts` `YAML_TOOLS`에 `'blog_publish'`.
5. `company.yaml`: `content_lead` 또는 `ceo`(편집장)의 `tools:`에 `blog_publish`.

### B-3. web-search / file-io
- **web-search**: 신규 툴 불필요. `naver_search`/`web_search`가 이미 네이티브. 페르소나에 "네이버 검색으로 실제 컨셉 조사" 지침만.
- **file-io**: 불필요. gepa는 wiki·`save_note`·이벤트버스로 상태 관리.

---

## 8. Part C — 파이프라인 배선 (org.ts)

`src/orchestrator/org.ts`(팀 실행 오케스트레이터)에 블로그 종단 흐름을 연결:

```
리서치·SEO팀 (브리프)
  → 제작팀 content_lead (초안: H2+이모지, [IMAGE:] 마크업)
  → reviewer 크리틱 (7기준 채점, <49 면 REVISION → content_lead 재작성 루프)
  → [신규] image_generate (초안의 [IMAGE:] 슬롯 → gpt-image-2)
  → [신규] blog_publish (임시저장 draft) — 승인 게이트
  → 편집장 finalize (결과 취합·보고)
```

- 크리틱 재작성 루프는 gepa에 이미 유사 흐름(`reflect.ts`/`revise.ts`/`debate.ts`)이 있으니 **문턱 49/70 판정만 크리틱 프롬프트에 명시**하면 대체로 재사용.
- image/publish는 **툴 호출**이므로 별도 오케스트레이션 노드보다 `content_lead`가 초안 확정 후 툴을 부르게 하거나, `org.ts` finalize 직전에 명시적 단계로 삽입. (초보 사용성 위해 **명시적 단계 삽입** 권장 — 흐름이 눈에 보임.)

---

## 9. 환경·의존성·보안

### 새 환경변수 (`.env`)
| 키 | 용도 |
|---|---|
| `OPENAI_API_KEY` | gpt-image-2 이미지 생성 |
| `BLOG_PYTHON` | 블로그 스크립트 전용 venv python 절대경로 |
| `BLOG_SCRIPTS_DIR` | `scripts/blog_skills/` 경로 |
| `NAVER_SESSION_FILE` | Playwright storage_state (네이버 로그인 세션) |
| (기존) `NAVER_CLIENT_ID/SECRET` | 이미지 스크립트의 `--topic` 조사용(있으면) |

### Python venv (gepa는 Node 앱 → 별도 venv 필요)
```
python3 -m venv scripts/blog_skills/venv
scripts/blog_skills/venv/bin/pip install openai Pillow playwright
scripts/blog_skills/venv/bin/playwright install chromium
```
→ `BLOG_PYTHON=<...>/scripts/blog_skills/venv/bin/python`.

### 보안·안전 체크
- ✅ **전용 툴 spawn**(고정 argv) → 임의 명령 실행 표면 없음. `AGENT_SHELL`/allowlist는 **건드리지 않음**.
- ✅ **blog_publish는 임시저장까지만.** 발행 버튼 클릭 코드 없음. (naver_publish.py 원칙 유지)
- ⚠️ **발행류 승인**: `gateWrite`는 autonomy≥3이면 자동 승인. 외부(네이버)에 초안을 남기는 행위이므로, 최소 초기에는 `content_lead` autonomy를 **2(승인 대기)** 로 두거나 blog_publish만 항상 게이트하도록 특례(코드에서 `alwaysGate`에 `blog_publish` 추가) 권장.
- ⚠️ **API 과금**: gpt-image-2 호출·네이버 자동화는 되돌리기 어려운/유료 행위 → 승인 게이트 유지.
- ⚠️ **프롬프트 인젝션**: company.yaml 페르소나는 로더가 살균하지만 길이 제한 있음(§6).
- ⚠️ **gpt-image-2 모델 id**: 구현 시 OpenAI 이미지 API 최신 문서로 모델명·파라미터 확정.

---

## 10. 단계별 실행 체크리스트 (실행 승인 시 이 순서로)

- [ ] **P0. 스캐폴딩**: `scripts/blog_skills/` 생성, venv 구축, `.env`에 새 키 추가, `src/config.ts`에 `blogPython/blogScriptsDir/openaiApiKey/naverSessionFile` 필드 추가.
- [ ] **P1. 페르소나(무코드)**: `data/company.yaml` + `assets/company/company.yaml`의 `content_lead`·`reviewer`(+선택 research) `system_prompt` 병합(§6). → `npm run typecheck` 무관, 앱 재기동으로 확인.
- [ ] **P2. image_generate 툴**: `openai_image.py`(gpt-image-2) 작성 → `tools.ts`·`agent.ts`·`company-loader.ts`·`company.yaml` 배선 → `--dry-run`으로 단독 검증 → gepa 툴콜 검증.
- [ ] **P3. blog_publish 툴**: `naver_publish.py` 복사 → 동형 배선 + 승인 특례 → `--dry-run`(네이버 접속 없이) 검증.
- [ ] **P4. 파이프라인**: `org.ts`에 image→publish 단계 삽입, 크리틱 문턱 49/70 반영(§8).
- [ ] **P5. 검증**: `npm run typecheck`(strict) → `vitest run`(신규 툴 파서/게이트 단위 테스트 추가) → 수동 골든패스(주제 입력 → 초안 → 이미지 → 임시저장 draft URL/스크린샷).

### net-new 실작업 요약 (최소)
1. `content_lead`·`reviewer` `system_prompt` 심화 (데이터)
2. `openai_image.py`(gpt-image-2) + `image_generate` 툴 3파일 배선
3. `naver_publish.py` 재사용 + `blog_publish` 툴 3파일 배선 + 승인 특례
4. `org.ts` 종단 단계 2개 삽입

---

## 11. 대안(참고) — "그냥 .claude 복사"를 원했다면

만약 gepa 앱 런타임이 아니라 **Claude Code로 AI_ContentsCreator를 개발/저작할 때** 블로그 서브에이전트·스킬을 쓰고 싶은 것이라면, 훨씬 가벼운 경로가 있습니다(이번 결정에서는 **비채택**):

```
cp -R naver-blog-agent-web/.claude/agents  AI_ContentsCreator/.claude/agents
cp -R naver-blog-agent-web/.claude/skills  AI_ContentsCreator/.claude/skills
```
- 단, 표준 Claude Code 서브에이전트는 `.claude/agents/<name>.md`(YAML frontmatter) 포맷이라, `<name>/AGENT.md` 구조는 그대로는 서브에이전트로 인식 안 될 수 있음 → 포맷 변환 필요.
- 이 경로는 **gepa 실행 앱과 무관**(런타임이 안 씀). 그래서 사용자의 "에이전트들에게 주입"과는 다른 목적.

---

## 부록 — 참조 파일/라인

- 블로그 페르소나: `naver-blog-agent-web/.claude/agents/{writer,critic,researcher,planner,editor}/AGENT.md`
- 블로그 스킬: `naver-blog-agent-web/.claude/skills/{image-generator,blog-publisher,web-search,file-io}/SKILL.md` + `scripts/*.py`
- gepa 조직: `src/agents/company-loader.ts`(YAML_TOOLS L34–37, mapTools L93–102), `data/company.yaml`, `data/people.yaml`
- gepa 툴: `src/orchestrator/tools.ts`(READ L36–39/WRITE L41/DESC L56–68/gate L48–54)
- gepa 디스패치: `src/orchestrator/agent.ts`(availableLoopTools L386–396, execLoopTool L399–440, gateWrite L444–464)
- gepa 셸: `src/orchestrator/shell.ts`(checkCommand L47, runCommand L77–88), `src/config.ts`(agentShell L249, agentShellAllow L253)
- gepa 오케스트레이션: `src/orchestrator/org.ts`, `reflect.ts`, `revise.ts`, `debate.ts`, `finalize.ts`
