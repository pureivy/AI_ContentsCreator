"""naver_clip_publish.find_published 중복 공개 검사(2026-10-05) — 브라우저 없이.

설명 첫 줄이 검색어로 바뀌어, 같은 편은 제목 '줄'로 찾는다. 예전 꼴(제목이 첫 줄)·새 꼴(검색어 다음 줄) 모두 잡고,
같은 검색어를 쓴 다른 편은 잡지 않아야 한다(잡으면 올리지 않고 남의 클립 번호를 기록한다).

실행: scripts/blog_skills/venv/bin/python -m unittest scripts/blog_skills/test_naver_clip_publish.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import naver_clip_publish as ncp  # noqa: E402

TITLE = "감나무 잎 흰가루, 이렇게 구별합니다"
NEW = f"감나무 흰곰팡이\n{TITLE}\n\n잎 뒷면부터 보세요.\n\n#감나무흰곰팡이 #감나무"


class FindPublished(unittest.TestCase):
    def test_old_format_found_by_title(self):
        items = [{"draft": False, "mediaContentNo": 1, "description": f"{TITLE}\n\n예전 본문\n\n#감나무"}]
        self.assertEqual(ncp.find_published(items, NEW, None, TITLE)["mediaContentNo"], 1)

    def test_new_format_found_by_title(self):
        items = [{"draft": False, "mediaContentNo": 2, "description": f"감나무 흰곰팡이병\n{TITLE}\n\n바뀐 본문"}]
        self.assertEqual(ncp.find_published(items, NEW, None, TITLE)["mediaContentNo"], 2)

    def test_same_query_line_other_title_not_matched(self):
        other = "감나무 흰곰팡이\n감나무 깍지벌레, 겨울에 잡는 법\n\n본문"
        items = [{"draft": False, "mediaContentNo": 3, "description": other}]
        self.assertIsNone(ncp.find_published(items, NEW, None, TITLE))

    def test_drafts_ignored_and_video_id_matches(self):
        items = [{"draft": True, "description": NEW}, {"draft": False, "videoId": "v1", "mediaContentNo": 4, "description": "x"}]
        self.assertEqual(ncp.find_published(items, NEW, "v1", TITLE)["mediaContentNo"], 4)
        self.assertIsNone(ncp.find_published(items[:1], NEW, None, TITLE))

    def test_without_match_title_falls_back_to_first_line(self):
        items = [{"draft": False, "mediaContentNo": 5, "description": f"{TITLE}\n\n본문"}]
        self.assertEqual(ncp.find_published(items, f"{TITLE}\n\n다른 본문", None)["mediaContentNo"], 5)

    def test_short_title_never_matches_by_line(self):
        items = [{"draft": False, "mediaContentNo": 6, "description": "짧은제목\n\n본문"}]
        self.assertIsNone(ncp.find_published(items, "짧은제목\n\n다른", None, "짧은제목"))



class _ApiPage:
    """api_get 이 부르는 page.evaluate 를 흉내 — 쪽마다 미리 정한 응답(dict → 200 JSON, int → 그 HTTP 상태, Exception → 던짐)."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.calls = 0

    def evaluate(self, _js, _url):
        r = self.pages[min(self.calls, len(self.pages) - 1)]
        self.calls += 1
        if isinstance(r, Exception):
            raise r
        if isinstance(r, int):
            return {"s": r, "t": ""}
        import json
        return {"s": 200, "t": json.dumps(r, ensure_ascii=False)}


class PlaylistLookup(unittest.TestCase):
    """리뷰(2026-10-05) — 조회 실패·필드 이름 불일치를 '없음'으로 읽으면 같은 이름의 공개 재생목록을 또 만든다."""

    NAME = "감나무 키우기"

    def test_found_on_second_page(self):
        pg = _ApiPage([{"items": [{"title": "편백 키우기"}], "commonInfo": {"totalPages": 2}},
                       {"items": [{"title": " 감나무  키우기 "}], "commonInfo": {"totalPages": 2}}])
        st, it = ncp.find_playlist(pg, "k", self.NAME)
        self.assertEqual(st, "found")
        self.assertEqual(it["title"], " 감나무  키우기 ")

    def test_absent_only_when_lookup_succeeded(self):
        pg = _ApiPage([{"items": [{"title": "편백 키우기"}], "commonInfo": {"totalPages": 1}}])
        self.assertEqual(ncp.find_playlist(pg, "k", self.NAME), ("absent", None))
        self.assertEqual(ncp.find_playlist(_ApiPage([{"items": [], "commonInfo": {"totalPages": 1}}]), "k", self.NAME)[0], "absent")

    def test_unknown_on_api_failure_or_field_mismatch(self):
        self.assertEqual(ncp.find_playlist(_ApiPage([500]), "k", self.NAME)[0], "unknown")
        self.assertEqual(ncp.find_playlist(_ApiPage([RuntimeError("closed")]), "k", self.NAME)[0], "unknown")
        self.assertEqual(ncp.find_playlist(_ApiPage([{"content": []}]), "k", self.NAME)[0], "unknown")
        mism = _ApiPage([{"items": [{"playlistName": "감나무 키우기"}], "commonInfo": {"totalPages": 1}}])
        self.assertEqual(ncp.find_playlist(mism, "k", self.NAME)[0], "unknown")

    def test_create_only_when_absent_and_not_in_popup(self):
        self.assertTrue(ncp.should_create_playlist("absent", "not-found"))
        for lookup in ("unknown", "found"):
            self.assertFalse(ncp.should_create_playlist(lookup, "not-found"))
        for picked in ("clicked", "already", "no-popup"):
            self.assertFalse(ncp.should_create_playlist("absent", picked))


if __name__ == "__main__":
    unittest.main()
