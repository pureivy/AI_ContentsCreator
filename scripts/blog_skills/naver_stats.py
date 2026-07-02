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
from datetime import date, timedelta
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
# 유입 횟수 필드 — 우선순위 순. 'ratio'(백분율)는 횟수가 아니라 제외.
CNT_KEYS = ("cnt", "count", "pv", "hit", "searchcnt", "searchcount", "inflow", "value")


def _num(v):
    try:
        n = int(float(v))
        return n if n >= 0 else 0
    except Exception:
        return 0


def extract_advisor_metrics(captures: list) -> dict:
    """실제 크리에이터 어드바이저 엔드포인트(home/*·inflow-*)에서 채널 단위 지표를 정밀 추출.
    - 조회수(cv): yesterday-summary(data.cv.cv 날짜배열 합) + realtime-summary(metricRanks cv metricValue).
    - 검색 유입 키워드: 유입/검색 엔드포인트의 keyword+수치 아이템.
    글이 적으면 채널≈포스트 근사. 없으면 0/[]."""
    views = 0
    inflow = {}
    for cap in captures:
        body = cap.get("body")
        if not isinstance(body, dict):
            continue
        path = str(body.get("path", ""))
        data = body.get("data")
        if data in (None, [], {}):
            continue
        if path.endswith("/yesterday-summary") and isinstance(data, dict):
            cv = (data.get("cv") or {}).get("cv")
            if isinstance(cv, list):
                views += sum(_num(x) for x in cv)
        elif path.endswith("/realtime-summary") and isinstance(data, dict):
            for mr in (data.get("metricRanks") or []):
                if isinstance(mr, dict) and mr.get("metricType") == "cv":
                    views += _num(mr.get("metricValue"))
        elif ("search" in path.lower() or "keyword" in path.lower() or "inflow" in path.lower()):
            items = data if isinstance(data, list) else \
                (data.get("rank") or data.get("list") or data.get("searchKeyword") or [])
            if isinstance(items, list):
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    kw = it.get("keyword") or it.get("query") or it.get("searchKeyword")
                    if not kw or str(kw).strip().lower() in ("null", "none", "기타", "직접유입"):
                        continue
                    cnt = _num(it.get("cv") or it.get("count") or it.get("cnt")
                               or it.get("inflow") or it.get("value"))
                    inflow[str(kw).strip()] = max(inflow.get(str(kw).strip(), 0), cnt)
    ranked = sorted(inflow.items(), key=lambda kv: kv[1], reverse=True)[:12]
    search_inflow = [{"keyword": k, "count": c, "rank": i + 1} for i, (k, c) in enumerate(ranked)]
    return {"views": views, "dwellSec": None, "searchInflow": search_inflow}


def _walk(obj, fn):
    fn(obj)
    if isinstance(obj, dict):
        for v in obj.values():
            _walk(v, fn)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, fn)


DWELL_KEYS = ("avgreadtime", "readtime", "dwelltime", "usetime", "avgusetime")
# logNo 무관 조회수 폴백에 허용할 '강한' 조회수 키(일반적인 count/cnt 는 유입수와 혼동돼 제외).
STRONG_VIEW_KEYS = ("readcnt", "readcount", "viewcount", "pageview", "pv")


def extract_metrics(captures: list, log_no: str) -> dict:
    """캡처된 api 응답 목록에서 조회수·유입 키워드를 최선 추출(휴리스틱). 확신 없으면 0/[]."""
    views = 0
    dwell = None        # logNo 무관 폴백
    dwell_logno = None  # logNo 포함 노드에서 얻은 값(우선)
    inflow = {}         # keyword -> count

    def visit(node):
        nonlocal views, dwell, dwell_logno
        if not isinstance(node, dict):
            return
        lower = {str(k).lower(): k for k in node.keys()}
        # 이 노드가 logNo 를 '직접 값'으로 가지면 포스트별 레코드로 간주(엔벌로프 총계 과대추출 방지).
        has_logno = bool(log_no) and any(
            str(v) == log_no for v in node.values() if isinstance(v, (str, int)))
        # 조회수 — logNo 노드는 모든 view 키 허용, 아니면 강한 키 + views 미확정일 때만(유입수 오인 방지).
        for vk in VIEW_KEYS:
            if vk in lower:
                cand = _num(node[lower[vk]])
                if has_logno:
                    views = max(views, cand)
                elif views == 0 and vk in STRONG_VIEW_KEYS and cand < 10_000_000:
                    views = max(views, cand)
        # 체류 — logNo 노드 우선, 아니면 첫 값만(마지막이 이기지 않게).
        for dk in DWELL_KEYS:
            if dk in lower:
                d = _num(node[lower[dk]])
                if d:
                    if has_logno:
                        dwell_logno = d
                    elif dwell is None:
                        dwell = d
        # 유입 키워드 — keyword + count. 필드는 KW_KEYS/CNT_KEYS '우선순위'로 선택(키 삽입 순서 비의존).
        kw_field = next((lower[k] for k in KW_KEYS if k in lower), None)
        if kw_field:
            kw = str(node.get(kw_field, "")).strip()
            if kw and kw.lower() not in ("null", "none", "직접유입", "기타"):
                cnt_field = next((lower[k] for k in CNT_KEYS if k in lower), None)
                cnt = _num(node.get(cnt_field)) if cnt_field else 0
                inflow[kw] = max(inflow.get(kw, 0), cnt)

    for cap in captures:
        try:
            _walk(cap.get("body"), visit)
        except Exception:
            continue
    if dwell_logno is not None:
        dwell = dwell_logno

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

        # ── 로그인 — 발행 스크립트(naver_publish)와 동일 플로우 재사용. 영속 프로필에 세션 쿠키가
        #    남지 않으면(로그인 상태 유지 미체크) 매 실행 로그인해야 한다. creator-advisor 는 blog.naver.com
        #    로그인(nid 쿠키, .naver.com 도메인)으로 함께 인증되므로 blog 로그인만 확립하면 된다.
        naver_id = os.environ.get("NAVER_ID", "")
        naver_pw = os.environ.get("NAVER_PW", "")
        page.goto("https://blog.naver.com", wait_until="domcontentloaded", timeout=15000)
        time.sleep(1.5)
        logged_in = page.locator("a[href*='nidlogin'], .link_login").count() == 0
        if not logged_in:
            try:
                from naver_publish import full_auto_login  # 같은 디렉토리 스크립트 — sys.path[0]
                full_auto_login(page, naver_id, naver_pw)
            except SystemExit:
                context.close()
                emit({"views": 0, "dwellSec": None, "searchInflow": [],
                      "source": "scrape:naver_advisor",
                      "note": "네이버 로그인 실패(시간 초과) — 열린 브라우저에서 직접 로그인 후 다시 시도하세요.",
                      "captured": 0})
                return
            except Exception as e:
                context.close()
                emit({"views": 0, "dwellSec": None, "searchInflow": [],
                      "source": "scrape:naver_advisor", "note": f"로그인 오류: {str(e)[:80]}", "captured": 0})
                return

        # 로그인 세션으로 크리에이터 어드바이저 진입 — SPA 가 홈 통계 api 를 호출(캡처됨).
        page.goto("https://creator-advisor.naver.com/", wait_until="networkidle", timeout=20000)
        time.sleep(2.5)
        # 유입분석 화면도 열어 검색 유입 api 유도.
        for u in ("https://creator-advisor.naver.com/naver_blog/inflow",
                  "https://creator-advisor.naver.com/naver_blog/inflowSearch"):
            try:
                page.goto(u, wait_until="networkidle", timeout=15000)
                time.sleep(2)
            except Exception:
                time.sleep(1)

        # 로그인 쿠키를 상속한 api 직접 호출 — SPA 라우트에 의존하지 않고 실측 엔드포인트를 확실히 캡처한다.
        # (조회수=cv, 검색 유입 키워드) 채널 단위. channelId 는 blog_id 와 동일.
        cid = blog_id
        today = date.today().isoformat()
        yday = (date.today() - timedelta(days=1)).isoformat()
        base = "https://creator-advisor.naver.com/api/v6"
        api_urls = [
            f"{base}/home/yesterday-summary?channelId={cid}&date={today}&service=naver_blog",
            f"{base}/home/realtime-summary?channelId={cid}&date={today}&service=naver_blog",
            # 검색 유입 키워드 — 정확 경로는 버전별 상이, 여러 후보 시도(404 는 무시). 응답 오면 추출기가 파싱.
            f"{base}/inflow-analysis/inflow-search?channelId={cid}&date={yday}&interval=day&service=naver_blog",
            f"{base}/inflow-analysis/search-keyword?channelId={cid}&date={yday}&interval=day&service=naver_blog",
            f"{base}/rank/inflow-search?channelId={cid}&date={yday}&interval=day&service=naver_blog",
            f"{base}/inflow-search/detail?channelId={cid}&date={yday}&interval=day&service=naver_blog",
        ]
        for u in api_urls:
            try:
                resp = context.request.get(u, timeout=15000)
                if resp.ok:
                    captures.append({"url": u, "body": resp.json()})
            except Exception:
                continue

        context.close()

    # 캡처 덤프(추출기 정밀화용) — 자격증명 없음.
    try:
        with open(os.path.join(args.run_dir, "naver_stats_capture.json"), "w", encoding="utf-8") as f:
            json.dump(captures, f, ensure_ascii=False, indent=1)
    except Exception:
        pass

    # 어드바이저에 로그인 세션이 적용됐는지 — 캡처에 Unauthorized 가 남아 있으면 세션 미확립.
    def _unauth(cap):
        b = cap.get("body")
        return isinstance(b, dict) and "unauthorized" in str(b.get("message", "")).lower()
    all_unauth = bool(captures) and all(_unauth(c) for c in captures)

    # 어드바이저 실측 엔드포인트 정밀 추출을 우선, 부족분은 범용 휴리스틱으로 보강.
    adv = extract_advisor_metrics(captures)
    gen = extract_metrics(captures, log_no)
    metrics = {
        "views": adv["views"] or gen["views"],
        "dwellSec": adv["dwellSec"] or gen["dwellSec"],
        "searchInflow": adv["searchInflow"] or gen["searchInflow"],
    }
    # 로그인은 됐지만(권한 응답 수신) 수치가 0 = 발행 직후 미집계일 가능성.
    logged = any(isinstance(c.get("body"), dict) and c["body"].get("data") not in (None,) for c in captures)
    if metrics["views"] or metrics["searchInflow"]:
        note = ""
    elif all_unauth or not captures:
        note = ("어드바이저 로그인 세션 미확립 — 브라우저에서 네이버에 로그인(로그인 상태 유지 체크) 후 "
                "다시 시도하세요. 계속 실패하면 수동 입력으로 대체할 수 있습니다.")
    elif logged:
        note = ("로그인·수집은 정상인데 통계가 0입니다 — 네이버 통계는 하루 지연 집계라 발행 직후에는 "
                "수치가 없습니다. 하루 이상 지난 뒤 다시 시도하세요(수동 입력으로도 대체 가능).")
    else:
        note = "자동 추출 실패 — 캡처 덤프(naver_stats_capture.json) 확인 후 추출기 정밀화 필요. 수동 입력으로 대체 가능."
    emit({**metrics, "source": "scrape:naver_advisor", "note": note, "captured": len(captures)})


if __name__ == "__main__":
    main()
