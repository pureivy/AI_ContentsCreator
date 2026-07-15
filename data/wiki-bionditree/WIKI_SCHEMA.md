# LLM Wiki 스키마 (Karpathy 패턴)

이 폴더는 에이전트가 유지하는 **LLM Wiki** 다. RAG 가 아니라, 지식을 한 번 컴파일해 계속 갱신한다.

## 레이아웃
- `../raw/<날짜>/` — 원본 소스(불변)
- `*.md`(위키 루트, 평면) — 페이지. YAML 프런트매터 + 본문 `[[위키링크]]`. (`index.md`·`log.md`·`WIKI_SCHEMA.md` 는 예약 파일)
- `index.md` — 전 페이지 카탈로그(카테고리별, 1줄 요약). 인덱스 우선 탐색의 진입점.
- `log.md` — append-only 타임라인 `## [YYYY-MM-DD] op | Title`.

## 페이지 타입
entity(사람·조직·도구) · concept(개념·주제) · source(소스 요약) · overview(종합) · answer(질의 답변) · lesson(직원 교훈) · debate(런별 토론 입장·비평 — rebuts 엣지) · performance(성과 신호)

## 워크플로우
- ingest: 소스/산출물 읽기 → 요약 페이지 작성 → 엔티티/개념 페이지 생성·갱신([[링크]] 유지) → index 재생성 → log 추가
- query: index 로 관련 페이지 탐색 → 본문으로 답 종합(인용) → 좋은 답은 answer 페이지로 환류
- lint: 고아 페이지·끊긴 링크·모순·오래된 주장 점검

## 원칙
지식은 컴파일 1회 + 지속 갱신(compounding). 작은 위키는 임베딩 없이 index 우선 탐색으로 충분.
