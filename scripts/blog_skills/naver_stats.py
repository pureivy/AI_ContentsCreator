"""
네이버 블로그 '본인' 포스트 성과 수집기 — 조회수 + 검색 유입 키워드(+체류).

전략(리서치 보고서 기반, 캡처-우선):
- 포스트별 조회수/검색 유입은 크리에이터 어드바이저(creator-advisor.naver.com) 인증 뒤에 있고
  정확한 엔드포인트는 버전마다 달라 하드코딩이 취약하다. 그래서 **네트워크 캡처**가 주 전략이다:
  로그인된 영속 프로필로 어드바이저를 열고, 페이지가 스스로 호출하는 api JSON 응답을 리스너로
  가로채 원본 형태 그대로 <run-dir>/naver_stats_capture.json 에 덤프한다. 그 위에서 휴리스틱
  추출(조회수·유입 키워드)을 시도한다. 실패해도 덤프가 남아 다음 실행의 추출기를 정밀화할 수 있다.
- 폴백: 블로그 통계 페이지 DOM. 그래도 없으면 빈 샘플(fail-open) — 호출자는 수동 입력으로 되돌린다.

계약: 마지막 줄에 `RESULT_JSON: {...}` 를 출력한다(TS 가 이 줄을 파싱).
  {views:int, dwellSec:int|None, searchInflow:[{keyword,count,rank?}], source:str, note:str, captured:int}
자격증명은 절대 출력하지 않는다. 로그인 벽이면 note 로 안내하고 빈 샘플로 종료(exit 0, fail-open).
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]


def load_env(project_root: str) -> None:
    env_path = os.path.join(project_root, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip())


def log(msg: str):
    print(msg, flush=True)


def emit(sample: dict):
    """결과 계약 — 마지막 줄에 RESULT_JSON 프리픽스로 출력."""
    print("RESULT_JSON: " + json.dumps(sample, ensure_ascii=False), flush=True)


# ── URL 파싱 ────────────────────────────────────────────────────────────────
def parse_blog_url(url: str) -> tuple:
    """publishedUrl → (blogId, logNo). 형태: /blogId/logNo, PostView.naver?blogId=&logNo=, m.blog…"""
    blog_id = ""
    log_no = ""
    m = re.search(r"[?&]blogId=([^&]+)", url)
    if m:
        blog_id = m.group(1)
    m = re.search(r"[?&]logNo=(\d+)", url)
    if m:
        log_no = m.group(1)
    if not blog_id or not log_no:
        # /blogId/logNo 형태
        m = re.search(r"blog\.naver\.com/([^/?#]+)/(\d+)", url)
        if m:
            blog_id = blog_id or m.group(1)
            log_no = log_no or m.group(2)
    return blog_id, log_no


# ── 캡처된 JSON 에서 휴리스틱 추출 ─────────────────────────────────────────────
VIEW_KEYS = ("cnt", "count", "pv", "readcnt", "readcount", "viewcount", "hit", "hits", "pageview")
KW_KEYS = ("keyword", "query", "searchkeyword", "keywordname", "refererkeyword")
CNT_KEYS = ("cnt", "count", "pv", "value", "ratio", "inflow", "hit")


def _num(v):
    try:
        n = int(float(v))
        return n if n >= 0 else 0
    except Exception:
        return 0


def _walk(obj, fn):
    fn(obj)
    if isinstance(obj, dict):
        for v in obj.values():
            _walk(v, fn)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, fn)


def extract_metrics(captures: list, log_no: str) -> dict:
    """캡처된 api 응답 목록에서 조회수·유입 키워드를 최선 추출(휴리스틱). 확신 없으면 0/[]."""
    views = 0
    dwell = None
    inflow = {}  # keyword -> count

    def visit(node):
        nonlocal views, dwell
        if not isinstance(node, dict):
            return
        lower = {str(k).lower(): k for k in node.keys()}
        # 조회수 — 이 노드가 logNo 를 담고 있으면 우선(포스트별), 아니면 최댓값 후보
        has_logno = any(str(node.get(orig)) == log_no for orig in node.values() if isinstance(orig, (str, int))) \
            or (log_no and log_no in json.dumps(node, ensure_ascii=False)[:400])
        for lk, orig in lower.items():
            if any(vk == lk for vk in VIEW_KEYS):
                cand = _num(node[orig])
                if has_logno:
                    views = max(views, cand)
                elif views == 0:
                    views = max(views, cand) if cand < 10_000_000 else views
            if lk in ("avgreadtime", "readtime", "dwelltime", "usetime", "avgusetime"):
                d = _num(node[orig])
                if d:
                    dwell = d
        # 유입 키워드 — keyword + count 를 함께 가진 노드
        kw_field = next((lower[k] for k in lower if k in KW_KEYS), None)
        if kw_field:
            kw = str(node.get(kw_field, "")).strip()
            if kw and kw.lower() not in ("null", "none", "직접유입", "기타"):
                cnt_field = next((lower[k] for k in lower if k in CNT_KEYS), None)
                cnt = _num(node.get(cnt_field)) if cnt_field else 0
                inflow[kw] = max(inflow.get(kw, 0), cnt)

    for cap in captures:
        try:
            _walk(cap.get("body"), visit)
        except Exception:
            continue

    ranked = sorted(inflow.items(), key=lambda kv: kv[1], reverse=True)[:12]
    search_inflow = [{"keyword": k, "count": c, "rank": i + 1} for i, (k, c) in enumerate(ranked)]
    return {"views": views, "dwellSec": dwell, "searchInflow": search_inflow}


# ── 메인 ──────────────────────────────────────────────────────────────────
def main():
    load_env(str(PROJECT_ROOT))
    parser = argparse.ArgumentParser(description="네이버 블로그 성과 수집")
    parser.add_argument("--url", required=True, help="발행된 글 URL")
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    os.makedirs(args.run_dir, exist_ok=True)
    blog_id, log_no = parse_blog_url(args.url)

    if args.dry_run:
        # 브라우저 없이 대표 샘플 — 파이프라인(수집→ingest→강화) 검증용.
        emit({
            "views": 137, "dwellSec": 52,
            "searchInflow": [
                {"keyword": "장마철 실내 습도", "count": 18, "rank": 1},
                {"keyword": "제습기 없이 습도", "count": 7, "rank": 2},
            ],
            "source": "scrape:dry-run", "note": "dry-run 대표 샘플", "captured": 0,
        })
        return

    if not blog_id or not log_no:
        emit({"views": 0, "dwellSec": None, "searchInflow": [],
              "source": "scrape:naver_advisor", "note": f"URL 파싱 실패(blogId/logNo): {args.url[:80]}", "captured": 0})
        return

    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError:
        emit({"views": 0, "dwellSec": None, "searchInflow": [],
              "source": "scrape:naver_advisor", "note": "playwright 미설치", "captured": 0})
        return

    profile_dir = Path.home() / ".naver-blog-profiles" / "cli"
    profile_dir.mkdir(parents=True, exist_ok=True)
    captures = []

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            str(profile_dir), channel="chrome", headless=args.headless, slow_mo=40,
            args=["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions"],
            ignore_default_args=["--enable-automation"],
            viewport={"width": 1280, "height": 900},
        )
        context.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined}); window.chrome={runtime:{}};"
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.on("dialog", lambda d: d.accept())

        def on_response(resp):
            try:
                url = resp.url
                if "creator-advisor.naver.com" in url and "api" in url:
                    ct = resp.headers.get("content-type", "")
                    if "json" in ct:
                        captures.append({"url": url, "body": resp.json()})
            except Exception:
                pass

        page.on("response", on_response)

        # 로그인 확인(영속 프로필 = 발행 때 로그인 세션 재사용)
        page.goto("https://creator-advisor.naver.com/", wait_until="domcontentloaded", timeout=20000)
        time.sleep(2)
        if "nid.naver.com" in page.url or "nidlogin" in page.url:
            context.close()
            emit({"views": 0, "dwellSec": None, "searchInflow": [],
                  "source": "scrape:naver_advisor",
                  "note": "네이버 로그인 필요 — 발행/임시저장을 먼저 실행해 세션을 만들거나 브라우저에서 로그인하세요.",
                  "captured": 0})
            return

        # 콘텐츠(블로그) 통계·유입분석 화면을 열어 SPA 가 api 를 호출하게 유도 → 응답 캡처.
        # 정확한 경로는 버전에 따라 다르므로 후보를 순회하며 최대한 캡처한다(그라운딩은 캡처 덤프).
        candidates = [
            f"https://creator-advisor.naver.com/naver_blog/blog/{blog_id}/content?contentId={log_no}",
            "https://creator-advisor.naver.com/naver_blog/blog/statistics",
            "https://creator-advisor.naver.com/naver_blog/blog/inflow",
            "https://creator-advisor.naver.com/",
        ]
        for u in candidates:
            try:
                page.goto(u, wait_until="networkidle", timeout=20000)
                time.sleep(2.5)
            except Exception:
                time.sleep(1)

        # 추가로 페이지 내 탭/버튼 클릭으로 유입분석을 유도(있으면).
        for label in ["유입분석", "유입 분석", "검색유입", "조회수", "통계"]:
            try:
                page.get_by_text(label, exact=False).first.click(timeout=1500)
                time.sleep(2)
            except Exception:
                continue

        context.close()

    # 캡처 덤프(추출기 정밀화용) — 자격증명 없음.
    try:
        with open(os.path.join(args.run_dir, "naver_stats_capture.json"), "w", encoding="utf-8") as f:
            json.dump(captures, f, ensure_ascii=False, indent=1)
    except Exception:
        pass

    metrics = extract_metrics(captures, log_no)
    note = "" if (metrics["views"] or metrics["searchInflow"]) else \
        "자동 추출 실패 — 캡처 덤프(naver_stats_capture.json) 확인 후 추출기 정밀화 필요. 수동 입력으로 대체 가능."
    emit({**metrics, "source": "scrape:naver_advisor", "note": note, "captured": len(captures)})


if __name__ == "__main__":
    main()
