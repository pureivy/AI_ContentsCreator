"""naver_stats.blog_stat_post_referer 상한 검사(리뷰 2026-10-02) — 브라우저·네트워크 없이 가짜 context 로.

실행: scripts/blog_skills/venv/bin/python -m unittest scripts/blog_skills/test_naver_stats.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import naver_stats as ns  # noqa: E402


class _Resp:
    def __init__(self, status, body, ctype="application/json"):
        self.status = status
        self._body = body
        self.headers = {"content-type": ctype}

    def json(self):
        return self._body


class _Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class _Ctx:
    """request.get 을 handler(url) 로 대신한다. 호출마다 clock 을 step 초 전진·timeout 을 기록."""

    def __init__(self, handler, clock=None, step=0.0):
        self.urls, self.timeouts = [], []
        ctx = self

        class _Req:
            def get(self, url, headers=None, timeout=None):
                ctx.urls.append(url)
                ctx.timeouts.append(timeout)
                if clock is not None:
                    clock.t += step
                return handler(url)

        self.request = _Req()


def _ok(domains=("m.search.naver.com",), cv=3):
    data = {"rows": {"referrerDomain": list(domains), "referrerSearchEngine": ["1"] * len(domains), "cv": [cv] * len(domains)}}
    return _Resp(200, {"statusCode": 200, "result": {"statDataList": [{"dataId": "refererTotal", "data": data}]}})


def _detail(url):
    return _Resp(200, {"statusCode": 200, "result": {"statDataList": [
        {"dataId": "refererDetail", "data": {"rows": {"searchQuery": ["편백 키우기"], "cv": [3]}}}]}})


def _old_months(n=6):
    m = date.today().replace(day=1)
    out = []
    for _ in range(n):
        m = (m - timedelta(days=1)).replace(day=1)
        out.append(("MONTH", m.isoformat()))
    return list(reversed(out))


class RefererBudgetTest(unittest.TestCase):
    def test_all_401_stops_after_3_calls_without_day_split(self):
        # 6개월 된 글·세션 만료 — 종전엔 MONTH 마다 DATE 로 쪼개 199콜 × 15초.
        ctx = _Ctx(lambda u: _Resp(200, {"statusCode": 401}))
        clock = _Clock()
        dump = ns.blog_stat_post_referer(ctx, "123", _old_months(6), deadline=clock() + 75, clock=clock)
        self.assertLessEqual(len(ctx.urls), 3)
        self.assertTrue(dump.get("aborted"))
        self.assertFalse(any(p["dim"] == "DATE" for p in dump["periods"]))
        self.assertFalse(any(p.get("expanded") for p in dump["periods"]))
        self.assertEqual(len(dump["periods"]), 6)  # 못 물은 기간도 실패(skipped)로 남는다
        self.assertTrue(all(p["status"] != 200 for p in dump["periods"]))

    def test_old_month_500_is_failure_not_split(self):
        months = _old_months(6)
        old = months[0]
        ctx = _Ctx(lambda u: _Resp(500, {}) if f"startDate={old[1]}" in u and "/detail" not in u else (_detail(u) if "/detail" in u else _ok()))
        dump = ns.blog_stat_post_referer(ctx, "123", months, clock=_Clock())
        first = dump["periods"][0]
        self.assertEqual((first["dim"], first["start"], first["status"]), ("MONTH", old[1], 500))
        self.assertFalse(first.get("expanded"))
        self.assertFalse(any(p["dim"] == "DATE" for p in dump["periods"]))
        self.assertNotIn("aborted", dump)

    def test_fresh_month_500_splits_into_days(self):
        # 진행 중인(끝난 지 3일 안 된) 월의 500 = 롤업 전 — 일 단위로 다시 묻는다.
        start = (date.today() - timedelta(days=1)).replace(day=1)
        ctx = _Ctx(lambda u: _Resp(500, {}) if "timeDimension=MONTH" in u else (_detail(u) if "/detail" in u else _ok()))
        dump = ns.blog_stat_post_referer(ctx, "123", [("MONTH", start.isoformat())], clock=_Clock(), max_calls=500)
        self.assertTrue(dump["periods"][0].get("expanded"))
        days = [p for p in dump["periods"] if p["dim"] == "DATE"]
        self.assertGreater(len(days), 0)
        self.assertTrue(all(p["status"] == 200 for p in days))
        self.assertNotIn("aborted", dump)

    def test_deadline_stops_and_marks_rest_skipped(self):
        clock = _Clock()
        ctx = _Ctx(lambda u: _detail(u) if "/detail" in u else _ok(), clock=clock, step=10.0)
        dump = ns.blog_stat_post_referer(ctx, "123", _old_months(6), deadline=clock() + 25, clock=clock)
        self.assertEqual(dump.get("aborted"), "시간 상한")
        self.assertLess(len(ctx.urls), 6 * 2)
        self.assertTrue(any(p.get("skipped") for p in dump["periods"]))
        # 요청 시간 상한은 남은 시간으로 깎인다(15초를 넘지 않고, 남은 시간 이하).
        self.assertEqual(ctx.timeouts[0], 15000)
        self.assertLessEqual(ctx.timeouts[1], 15000)
        self.assertTrue(all(t <= 25000 for t in ctx.timeouts))

    def test_timeout_clamped_to_remaining(self):
        clock = _Clock()
        ctx = _Ctx(lambda u: _detail(u) if "/detail" in u else _ok(), clock=clock, step=0.0)
        ns.blog_stat_post_referer(ctx, "123", _old_months(1), deadline=clock() + 5, clock=clock)
        self.assertEqual(ctx.timeouts[0], 5000)

    def test_call_cap_counts_detail_calls(self):
        ctx = _Ctx(lambda u: _detail(u) if "/detail" in u else _ok(domains=("a.naver.com", "b.naver.com")))
        dump = ns.blog_stat_post_referer(ctx, "123", _old_months(6), clock=_Clock(), max_calls=4)
        self.assertEqual(len(ctx.urls), 4)
        self.assertIn("호출 상한", dump.get("aborted", ""))

    def test_normal_run_has_no_abort(self):
        ctx = _Ctx(lambda u: _detail(u) if "/detail" in u else _ok())
        dump = ns.blog_stat_post_referer(ctx, "123", _old_months(6), clock=_Clock())
        self.assertNotIn("aborted", dump)
        self.assertEqual(len(ctx.urls), 12)
        self.assertTrue(all(p["status"] == 200 and len(p["details"]) == 1 for p in dump["periods"]))


class EmitViewsTest(unittest.TestCase):
    """조회수 결과 블록을 main() 밖 emit_views 로 옮겼다 — 이름 누락(NameError)이면 조회수 표본을 전부 잃는다."""

    def _run(self, stat_cv):
        with tempfile.TemporaryDirectory() as d:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                ns.emit_views([], stat_cv, "123", d)
            self.assertTrue(os.path.exists(os.path.join(d, "naver_stats_capture.json")))
        line = [l for l in buf.getvalue().splitlines() if l.startswith("RESULT_JSON:")][-1]
        return json.loads(line[len("RESULT_JSON:"):])

    def test_no_stat_cv(self):
        r = self._run(None)
        self.assertEqual(r["views"], 0)
        self.assertIn("로그인 세션 미확립", r["note"])
        self.assertEqual(r["searchInflow"], [])

    def test_with_stat_cv(self):
        r = self._run(19)
        self.assertEqual(r["views"], 19)
        self.assertTrue(r["note"].startswith("네이버 통계 게시물 누적"))


if __name__ == "__main__":
    unittest.main()
