# 네이버 블로그 에이전트 → gepa 주입 — 실행 완료 보고서

> 2026-07-01 · 브랜치 `feat/content-studio-pivot` · 계획서: `BLOG_AGENT_INJECTION_PLAN.md`
> 결정: ①gepa 앱 에이전트에 이식 ②Python 재사용(이미지는 gpt-image-2)
> 상태: **배선·유닛·dry-run·적대적 리뷰까지 검증 완료.** 앱을 띄워 실제 콘텐츠 1건을 뽑아본 건 아님 — 아래 "켜는 법"대로 플래그 설정 후 1회 런하면 눈으로 확인 가능.

## 무엇을 주입했나

**1. 페르소나 (블로그 AGENT.md → gepa role.system_prompt)** — `data/company.yaml` + `assets/company/company.yaml`
- `content_lead`(수석 작가): 라이터 규칙 병합 — 1문장 40자·문단 3~5문장·능동태·H2+이모지 필수·`[IMAGE:]` 마크업·SEO 배치·2500자±20%·태그 5~10·금지사항. + 툴 `image_generate` grant.
- `reviewer`(팩트체커·크리틱): 7기준 채점(정확성/실용성/논리/가독성/차별성/SEO/이모지, 각 0~10)·이모지 10점 배분·**49/70=APPROVED**·구체적 수정지시.
- `ceo`(편집장): + 툴 `blog_publish` grant + 발행=임시저장까지만(사람이 수동 발행) 지침.
- 안전: `YAML.stringify` 로 기록(특수문자·이모지 깨짐 방지), 재파싱·4000자 캡 미만 검증 통과. content_lead 701자 / reviewer 557자.

**2. 스킬 → gepa 툴** (모두 WRITE 툴, autonomy≥2 + 승인 게이트)
- `image_generate` — `scripts/blog_skills/openai_image.py` (**gpt-image-2**, 신규). 초안 `imageSlots`/`[IMAGE:]` 마커 → 이미지 + 매니페스트(`{images:[{file_path}]}`). 키 없으면 dry-run.
- `blog_publish` — `scripts/blog_skills/naver_publish.py` (Playwright, 복사). **임시저장(draft)만 — 발행 버튼 안 누름.** 세션 없으면 dry-run.
- `web-search` → 이미 네이티브(`naver_search`/`web_search`), `file-io` → gepa wiki/save_note 로 대체(신규 툴 불필요).

**3. 배선** (gepa 코어)
- `src/tools/blog_skills.ts` (신규) — 고정 인터프리터·고정 스크립트·리터럴 argv `spawn` 브릿지(모델 자유명령 불가). 순수 파서 `parseImagePayload`/`parsePublishPayload`/`containImageManifest`.
- `src/orchestrator/tools.ts` — `WRITE_TOOLS` + `TOOL_DESC` 등록.
- `src/orchestrator/agent.ts` — `availableLoopTools` 노출 + `execLoopTool` 디스패치 + `gateWrite` blog_publish 항상 게이트(타임아웃도 fail-closed).
- `src/agents/company-loader.ts` — `YAML_TOOLS` 등록(UI 재저장 스트립 방지).
- `src/config.ts` — `blogPython/blogScriptsDir/openaiApiKey/openaiImageModel/naverSessionFile/blogAutoImage`.
- `src/orchestrator/finalize.ts` — **옵트인 `BLOG_AUTO_IMAGE`** 훅: 완성 초안(draft.json)에 이미지 자동 생성(기본 off, 실패 무해).

## 검증 (모두 통과)

| 검증 | 결과 |
|---|---|
| `tsc --noEmit` (strict) | ✅ exit 0 |
| 전체 vitest | ✅ **221/221** (신규 blog_skills 14 포함) |
| 거버넌스 회귀(run_command/save_note/approvals) | ✅ 보존 |
| 로더 스모크(company.yaml→getCompany→RoleDef) | ✅ 툴·페르소나 로드 |
| TS→Python 브릿지(runImageGenerate dry-run) | ✅ 2장 계획, 매니페스트 생성 |
| naver_publish.py dry-run(크리덴셜 없이) | ✅ exit 0, DRAFT_SAVED |
| 적대적 리뷰(8 에이전트, 배선·보안·계약) | ✅ 확정 4건 수정 + 오탐 1 기각 |

**리뷰에서 수정한 확정 결함 4건:**
1. `agent.ts` — image/publish 툴 `await` 누락 → 실패 시 runAgent 통째 실패. → `return await`.
2. `blog_skills.ts` — **[보안]** blog_publish 이미지 경로 무검증 → 임의 파일 업로드/유출. → `containImageManifest` 샌드박스 컨테인먼트.
3. `agent.ts` — blog_publish 승인 게이트 타임아웃 fail-open. → 타임아웃도 fail-closed(거부).
4. `naver_publish.py` — dry-run에도 NAVER_BLOG_ID 필수. → dry-run은 크리덴셜 불필요.

오탐(기각): openai_image.py 의 `gpt-image-2` — verify 에이전트가 공식 문서로 실존 GA 모델 확인.

**추가 하드닝(사용자 선호 반영):** `image_generate`(유료 gpt-image-2 과금)도 `blog_publish` 처럼 autonomy≥3 에서 자동승인 제외 + `ENFORCE_AUTONOMY=false` 라도 항상 게이트 — "외부 서비스 결제성 행동은 확인" 선호에 맞춰 무인 자동 과금 방지. (blog_publish 는 여기에 더해 타임아웃도 fail-closed.)

## 켜는 법 (`.env` 에 이미 골격 추가됨)

```bash
# 이미 설정됨: BLOG_PYTHON / BLOG_SCRIPTS_DIR / OPENAI_IMAGE_MODEL=gpt-image-2 / NAVER_SESSION_FILE
OPENAI_API_KEY=sk-...        # 실제 이미지 생성(없으면 dry-run=계획만)
AGENT_TOOL_LOOP=true         # 에이전트가 런 중 <tool>을 실제 호출하려면 필요(기본 off)
BLOG_AUTO_IMAGE=true         # finalize 후 완성 초안에 이미지 자동 생성(옵트인)
```
- Python venv: `scripts/blog_skills/venv` (openai·Pillow·playwright 설치됨). 발행 실제 사용 시 `playwright install chromium` 필요.
- **승인 게이트**: `image_generate`(유료)·`blog_publish`(외부)는 실행 시 승인을 요청한다. 승인 UI/채널이 없으면 `image_generate` 는 타임아웃(기본 600s, `APPROVAL_TIMEOUT_S`) 후 진행, `blog_publish` 는 타임아웃 시 **거부**(fail-closed). 무인 자동승인이 필요하면 `ENFORCE_AUTONOMY`·`APPROVAL_TIMEOUT_S` 를 조정.

## 남은 작업(문서화된 후속)

- **blog_publish 실동작**: gepa `BlogDraft` → naver_publish 의 `smarteditor_text{sections,image_positions}` **어댑터** 필요. 현재는 배선+게이트 완료, `final_content` 인라인 전달 시에만 동작. 라이브 발행엔 `NAVER_BLOG_ID/NAVER_ID/NAVER_PW` + Playwright 세션 필요.
- **자동 파이프라인 단계**: image/publish 를 `org.ts` 팀 흐름에 명시적 단계로 삽입(현재는 툴 가용 + finalize 이미지 훅). 30KB 오케스트레이터 수술이라 별도 작업으로 분리.
- 참고: `frontend/src/index.css`·`OfficeView.tsx` 변경은 **이 작업과 무관**(외부/워치 프로세스). 손대지 않음.
