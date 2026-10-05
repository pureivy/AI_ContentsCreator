"""naver_publish 서식·자동목록 무해화(2026-10-05 참고 블로그 서식 이식) — 브라우저·네이버 없이 순수 함수와 가짜 page 로.

실행: scripts/blog_skills/venv/bin/python -m unittest scripts/blog_skills/test_naver_publish.py
"""
import copy
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import naver_publish as npub  # noqa: E402

LILAC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                     "data", "sessions", "333f4387e23d", "05_final_content.json")


def _ids():
    n = [0]

    def f():
        n[0] += 1
        return f"T-{n[0]}"
    return f


def node(v, bold=False):
    return {"@ctype": "textNode", "id": "n", "value": v, **({"style": {"@ctype": "nodeStyle", "bold": True}} if bold else {})}


def _v(p):
    return "".join(n.get("value", "") for n in (p.get("nodes") or []))


def para(*nodes):
    return {"@ctype": "paragraph", "id": "p", "nodes": list(nodes)}


def text_comp(*paras, cid="t"):
    return {"@ctype": "text", "id": cid, "layout": "default", "value": list(paras)}


class FlagTest(unittest.TestCase):
    def test_rich_format_default_on_and_kill_switch(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NAVER_RICH_FORMAT", None)
            self.assertTrue(npub.rich_format_enabled())
        for v in ("false", "0", "off", "NO"):
            with mock.patch.dict(os.environ, {"NAVER_RICH_FORMAT": v}):
                self.assertFalse(npub.rich_format_enabled())
        with mock.patch.dict(os.environ, {"NAVER_RICH_FORMAT": "true"}):
            self.assertTrue(npub.rich_format_enabled())


class AutoListGuardTest(unittest.TestCase):
    """라일락 편(224431207647) — "1. 꽃말 한 줄…" 소제목이 SE 자동 번호목록이 돼 번호가 사라지고 뒤 문단을 삼켰다."""

    def test_safe_heading_text(self):
        self.assertEqual(npub.safe_heading_text("1. 꽃말 한 줄, 그리고 색깔 이야기가 갈라지는 대목"),
                         "1) 꽃말 한 줄, 그리고 색깔 이야기가 갈라지는 대목")
        self.assertEqual(npub.safe_heading_text("  12. 열둘 "), "12) 열둘")
        self.assertEqual(npub.safe_heading_text("- 목록 아님"), "• 목록 아님")
        self.assertEqual(npub.safe_heading_text("꽃이 없는 10월"), "꽃이 없는 10월")
        self.assertEqual(npub.safe_heading_text("2026년 1. 기록"), "2026년 1. 기록")
        self.assertEqual(npub.safe_heading_text("1.5m 넘는 묘목"), "1.5m 넘는 묘목")
        self.assertEqual(npub.safe_heading_text(None), "")

    def test_safe_paragraph_text_only_marker_led_numbers(self):
        self.assertEqual(npub.safe_paragraph_text("**1. 잎의 광택부터 봅니다.**"), "**1) 잎의 광택부터 봅니다.**")
        self.assertEqual(npub.safe_paragraph_text("**- 가위는 내려놓기**"), "**• 가위는 내려놓기**")
        self.assertEqual(npub.safe_paragraph_text("*3. 이탤릭 번호*"), "*3) 이탤릭 번호*")
        # 마커 없는 번호 줄은 목록 분기가 일부러 자동목록을 쓴다 — 여기서 바꾸지 않는다.
        self.assertEqual(npub.safe_paragraph_text("1. 목록 항목"), "1. 목록 항목")
        self.assertEqual(npub.safe_paragraph_text("**1.5m** 이상 자랍니다."), "**1.5m** 이상 자랍니다.")
        self.assertEqual(npub.safe_paragraph_text("보통 문장입니다. 1. 중간 번호"), "보통 문장입니다. 1. 중간 번호")

    def test_absorb_frame_items_stops_at_prose_without_blank_line(self):
        # 우리 발행 페이로드는 빈 줄이 빠진다(draftToFinalContent) — 경계는 '목록 꼴이 아닌 첫 줄'.
        lines = ["1) 잎의 광택", "2) 가지 끝 눈", "- 하루 햇빛", "꽃말을 찾아보셨다면 4월 중순에 그 꽃이 핍니다."]
        q = ["10월에 볼 것"]
        k = npub.absorb_frame_items(lines, 0, q)
        self.assertEqual(k, 3)
        self.assertEqual(q, ["10월에 볼 것", "1) 잎의 광택", "2) 가지 끝 눈", "- 하루 햇빛"])
        self.assertEqual(npub.absorb_frame_items(["보통 문장입니다."], 0, []), 0)
        self.assertEqual(npub.absorb_frame_items(["1) a", "", "2) b"], 0, []), 1)


class _Kb:
    def __init__(self, log):
        self.log = log

    def type(self, ch):
        self.log.append(("type", ch))

    def press(self, key):
        self.log.append(("press", key))


class _Loc:
    first = property(lambda self: self)

    def click(self, timeout=None):
        pass

    def dispatch_event(self, *_a, **_k):
        pass


class FakePage:
    def __init__(self):
        self.log = []
        self.keyboard = _Kb(self.log)

    def locator(self, _sel):
        return _Loc()

    def evaluate(self, *_a, **_k):
        return None

    def typed_paragraphs(self):
        """Enter 로 나뉜 타이핑 문단(서식 단축키는 무시)."""
        out, cur = [], []
        for kind, v in self.log:
            if kind == "type":
                cur.append(v)
            elif v == "Enter":
                out.append("".join(cur))
                cur = []
        out.append("".join(cur))
        return out


class TypeBodyHumanTest(unittest.TestCase):
    def setUp(self):
        self._p = [mock.patch.object(npub.time, "sleep", lambda *_: None),
                   mock.patch.object(npub.random, "random", lambda: 0.5)]
        for p in self._p:
            p.start()

    def tearDown(self):
        for p in self._p:
            p.stop()

    def test_numbered_heading_typed_as_paren_and_returned_for_matching(self):
        se = {"sections": [
            {"heading": "", "body": "**라일락 꽃말은 첫사랑의 시작입니다.**\n도입 문장입니다."},
            {"heading": "1. 꽃말 한 줄", "body": "꽃말은 두 갈래입니다.\n**2. 굵은 번호 문단입니다.**"},
            {"heading": "2. 이름 이야기", "body": ">>> 10월에 볼 것\n1) 잎의 광택\n2) 가지 끝 눈\n마무리 문장입니다."},
        ], "image_positions": []}
        page = FakePage()
        headings, quotes, rich, n = npub.type_body_human(page, se, [], [])
        self.assertEqual([h["text"] for h in headings], ["1) 꽃말 한 줄", "2) 이름 이야기"])
        typed = page.typed_paragraphs()
        self.assertIn("1) 꽃말 한 줄", typed)
        self.assertIn("2) 굵은 번호 문단입니다.", typed)
        self.assertNotIn("1. 꽃말 한 줄", typed)
        # >>> 첫 줄에만 표시가 있어도 바로 아래 번호 항목은 상자 안으로(프레임 변환 그룹에 포함).
        self.assertEqual(quotes, [{"lines": ["10월에 볼 것", "1) 잎의 광택", "2) 가지 끝 눈"], "layout": "quotation_corner"}])
        self.assertIn("마무리 문장입니다.", typed)


class ImageCaptionMapTest(unittest.TestCase):
    def test_by_file_name(self):
        m = npub.image_caption_map([
            {"file_path": "/x/images/blog-image-01.png", "alt": " 라일락 — 비온디트리 농원에서 직접 촬영 ", "source": "archive_frame"},
            {"file_path": "/x/images/blog-image-02.png", "alt": ""},
            {"alt": "경로 없음"},
            None,
            "문자열",
        ])
        self.assertEqual(m, {"blog-image-01.png": "라일락 — 비온디트리 농원에서 직접 촬영"})


class PlanRichFormatTest(unittest.TestCase):
    def _doc(self):
        return [
            {"@ctype": "documentTitle", "id": "title"},
            text_comp(
                para(node("라일락 꽃말은 첫사랑의 시작입니다", True), node(".")),  # 문장부호만 굵게 밖 — 그래도 요약
                para(node("향은 한두 주면 사라집니다.", True)),
                para(node("꽃말이 뭔지 확인하러 오셨나요. "), node("첫사랑", True), node("입니다.")),
                para(node("핵심 예시 문장은 굵은 단독 줄입니다.", True)),  # 도입부 굵은 줄 — 요약 아님(가운데 X)
                para(),
                para(node("1) 꽃말 한 줄", True)),
                para(node("꽃말은 두 갈래입니다.")),
                cid="t1"),
            {"@ctype": "image", "id": "img-real", "fileName": "blog-image-01.png", "ai": False},
            {"@ctype": "quotation", "id": "q1", "layout": "default", "value": [para(node("1) 꽃말 한 줄"))]},
            text_comp(para(node("2) 이름 이야기", True)), para(node("본문 1) 꽃말 한 줄")), cid="t2"),
            {"@ctype": "image", "id": "img-ai", "fileName": "blog-image-02.png", "ai": True,
             "caption": [para(node("이미 있는 설명"))]},
        ]

    def test_human_path_doc(self):
        doc = self._doc()
        before = copy.deepcopy(doc)
        heads = [{"text": "1) 꽃말 한 줄", "level": "HEADING1"}, {"text": "2) 이름 이야기", "level": "HEADING1"}]
        caps = {"blog-image-01.png": "라일락 — 비온디트리 농원에서 직접 촬영", "blog-image-02.png": "생성 이미지 설명"}
        out, st = npub.plan_rich_format(doc, heads, caps, new_id=_ids())
        self.assertEqual(doc, before)  # 입력 불변
        self.assertEqual({k: st[k] for k in ("titles", "fs16", "center", "captions")}, {"titles": 2, "fs16": 4, "center": 2, "captions": 1})
        kinds = [c["@ctype"] for c in out]
        self.assertEqual(kinds, ["documentTitle", "quotation", "text", "sectionTitle", "text", "image", "quotation",
                                 "sectionTitle", "text", "image"])
        # 맨 위 굵은 요약 두 줄 → 가운데 따옴표 인용구(사장님 수정 모양, 2026-10-06).
        q = out[1]
        self.assertEqual((q["layout"], q["align"]), ("default", "center"))
        self.assertEqual([p["nodes"][0]["value"] for p in q["value"]], ["라일락 꽃말은 첫사랑의 시작입니다", "향은 한두 주면 사라집니다."])
        # 소제목은 title 필드(value 아님), 원 문단 그대로.
        self.assertEqual(out[3]["title"][0]["nodes"][0]["value"], "1) 꽃말 한 줄")
        self.assertNotIn("value", out[3])
        self.assertEqual(out[2]["id"], "t1")  # 첫 글 덩어리는 원 id 유지
        body = out[2]["value"]
        vals = [_v(p) for p in body]
        # 줄과 줄 사이 빈 줄 — "꽃말이…" / (빈 줄) / "핵심 예시…" / (원래 빈 줄)
        self.assertEqual(vals, ["꽃말이 뭔지 확인하러 오셨나요. 첫사랑입니다.", "", "핵심 예시 문장은 굵은 단독 줄입니다.", ""])
        self.assertEqual(body[0]["nodes"][0]["style"]["fontSizeCode"], "fs16")
        # 소제목 바로 아래 빈 줄.
        self.assertEqual([_v(p) for p in out[4]["value"]], ["", "꽃말은 두 갈래입니다."])
        real = out[5]
        self.assertEqual((real["id"], real["ai"]), ("img-real", False))
        self.assertEqual(real["caption"][0]["nodes"][0]["value"], "라일락 — 비온디트리 농원에서 직접 촬영")
        self.assertEqual(out[9]["caption"][0]["nodes"][0]["value"], "이미 있는 설명")
        self.assertEqual((out[9]["id"], out[9]["ai"]), ("img-ai", True))
        self.assertEqual(out[6], doc[3])  # 인용구는 그대로
        self.assertEqual([_v(p) for p in out[8]["value"]], ["", "본문 1) 꽃말 한 줄"])

    def test_owner_edit_shape_gaps_and_lists(self):
        """2026-10-06 사장님이 고친 대추나무 임시저장 글 모양 — 줄마다 빈 줄, 목록 줄끼리는 붙인다, 이미 빈 줄이면 겹치지 않는다."""
        doc = [text_comp(para(node("첫 줄.")), para(node("둘째 줄.")), para(), para(node("셋째 줄.")),
                         para(node("1) 노지묘면 바로 심기")), para(node("2) 화분묘면 봄도 가능")))]
        out, st = npub.plan_rich_format(doc, [], {}, new_id=_ids())
        self.assertEqual([_v(p) for p in out[0]["value"]],
                         ["첫 줄.", "", "둘째 줄.", "", "셋째 줄.", "", "1) 노지묘면 바로 심기", "2) 화분묘면 봄도 가능"])
        self.assertEqual(st["gaps"], 2)

    def test_no_headings_no_lead_bold(self):
        out, st = npub.plan_rich_format([text_comp(para(node("보통 문장.")), para(node("굵은 줄", True)))], [], {})
        self.assertEqual(st["center"], 0)  # 굵지 않은 문단 뒤의 굵은 줄은 요약이 아니다
        self.assertEqual(st["titles"], 0)
        self.assertEqual(st["fs16"], 2)

    def test_summary_string(self):
        self.assertEqual(npub.rich_format_summary({"titles": 3, "fs16": 20, "center": 2, "captions": 3, "gaps": 9}, 3),
                         "ok:titles=3/3,fs16=20,center=2,captions=3,gaps=9")


class _DocPage:
    """getDocumentData → (Python 변환) → setDocumentData 왕복을 흉내 — 첫 evaluate 는 문서, 둘째는 받은 문서를 기록."""

    def __init__(self, doc, set_result="ok"):
        self.doc = doc
        self.set_result = set_result
        self.sent = None

    def evaluate(self, _js, arg=None):
        if arg is None:
            return copy.deepcopy(self.doc)
        self.sent = arg
        return self.set_result


class ApplyRichFormatTest(unittest.TestCase):
    def test_round_trip_sets_transformed_doc(self):
        doc = {"document": {"components": [
            {"@ctype": "documentTitle", "id": "title"},
            text_comp(para(node("요약 한 줄입니다.", True)), para(node("1) 소제목", True)), para(node("본문."))),
            {"@ctype": "image", "id": "img-real", "fileName": "blog-image-01.png", "ai": False},
        ]}, "documentId": "d"}
        page = _DocPage(doc)
        r = npub.apply_rich_format(page, [{"text": "1) 소제목"}], {"blog-image-01.png": "라일락 — 비온디트리 농원에서 직접 촬영"})
        self.assertEqual(r, "ok:titles=1/1,fs16=1,center=1,captions=1,gaps=1")
        comps = page.sent["document"]["components"]
        self.assertEqual(page.sent["documentId"], "d")  # 문서의 다른 필드는 그대로
        self.assertIn("sectionTitle", [c["@ctype"] for c in comps])
        img = [c for c in comps if c["@ctype"] == "image"][0]
        self.assertEqual((img["id"], img["ai"]), ("img-real", False))

    def test_no_document_service_and_set_error(self):
        self.assertEqual(npub.apply_rich_format(_DocPage(None), [], {}), "no_ds")
        bad = _DocPage({"document": {"components": []}}, set_result="error:boom")
        self.assertEqual(npub.apply_rich_format(bad, [], {}), "error:boom")


class ApiPathTest(unittest.TestCase):
    """API(setDocumentData) 경로 — 조립된 컴포넌트에 같은 변환. spanStyle 굵게 → nodeStyle.bold(편집기가 spanStyle 을 지움)."""

    def _se(self):
        return {"sections": [
            {"heading": "", "body": "**라일락 꽃말은 첫사랑의 시작입니다.**\n**4월 중순에 피고 향은 두 주 갑니다.**\n도입 문장입니다."},
            {"heading": "1. 꽃말 한 줄", "body": "꽃말은 두 갈래입니다.\n>> 중심 명제 한 줄입니다."},
            {"heading": "꽃이 없는 10월", "heading_level": "HEADING2", "body": "| 항목 | 내용 |\n|---|---|\n| 개화 | 4월 |\n마지막 문장입니다."},
        ], "image_positions": []}

    def test_api_components(self):
        se = self._se()
        with mock.patch.object(npub, "uid", _ids()):
            groups = npub.build_document_components(se)
        comps = [c for g in groups for c in g]
        heads = [{"text": s["heading"]} for s in se["sections"] if s["heading"]]
        out, st = npub.plan_rich_format(comps, heads, {}, new_id=_ids())
        self.assertEqual(st["titles"], 2)
        self.assertEqual(st["center"], 2)
        titles = [c["title"][0]["nodes"][0]["value"] for c in out if c["@ctype"] == "sectionTitle"]
        self.assertEqual(titles, ["1. 꽃말 한 줄", "꽃이 없는 10월"])
        # 2026-10-06: 맨 위 굵은 요약은 가운데 따옴표 인용구 한 덩어리(사장님이 고친 모양) — 글자 굵게는 유지, 16pt 는 안 입힌다.
        self.assertEqual((out[0]["@ctype"], out[0]["layout"], out[0]["align"]), ("quotation", "default", "center"))
        self.assertEqual(len(out[0]["value"]), 2)
        self.assertTrue(out[0]["value"][0]["nodes"][0]["style"]["bold"])
        self.assertIn("table", [c["@ctype"] for c in out])
        self.assertIn("quotation", [c["@ctype"] for c in out])

    def test_build_components_independent_of_flag(self):
        # NAVER_RICH_FORMAT=false 는 write_post 가 plan_rich_format 을 아예 부르지 않는 것 — 조립 결과는 플래그와 무관(종전 그대로).
        se = self._se()
        outs = []
        for v in ("true", "false"):
            with mock.patch.dict(os.environ, {"NAVER_RICH_FORMAT": v}), mock.patch.object(npub, "uid", _ids()):
                outs.append(npub.build_document_components(se))
        self.assertEqual(outs[0], outs[1])
        flat = json.dumps(outs[1], ensure_ascii=False)
        self.assertNotIn("sectionTitle", flat)
        self.assertNotIn("fontSizeCode\": \"fs16", flat)

    @unittest.skipUnless(os.path.exists(LILAC), "라일락 세션 없음")
    def test_lilac_headings_all_matched(self):
        with open(LILAC, encoding="utf-8") as f:
            fc = json.load(f)
        se = fc["smarteditor_text"]
        with mock.patch.object(npub, "uid", _ids()):
            comps = [c for g in npub.build_document_components(se) for c in g]
        heads = [{"text": s["heading"]} for s in se["sections"] if s.get("heading")]
        out, st = npub.plan_rich_format(comps, heads, {}, new_id=_ids())
        self.assertEqual(st["titles"], 3)
        self.assertEqual(st["center"], 0)  # 라일락 편 도입은 부분 굵게 — 요약 줄이 없던 글
        self.assertEqual([npub.safe_heading_text(h["text"]) for h in heads][0], "1) 꽃말 한 줄, 그리고 색깔 이야기가 갈라지는 대목")



class ReviewFixesTest(unittest.TestCase):
    """리뷰(2026-10-05) 보완 — 서식 예외 격리·소제목 부분 변환 경고·생성 이미지 설명 금지·프레임 흡수 두 경로 일치."""

    def test_apply_rich_format_never_raises(self):
        class Boom:
            def evaluate(self, *_a, **_k):
                raise RuntimeError("target closed")
        r = npub.apply_rich_format(Boom(), [{"text": "소제목"}], {})
        self.assertTrue(r.startswith("error:"))
        self.assertIn("target closed", r)
        # 변환(plan_rich_format) 단계 예외도 밖으로 새지 않고, 문서는 다시 쓰지 않는다(타이핑한 본문 유지).
        page = _DocPage({"document": {"components": [text_comp(para(node("본문.")))]}})
        with mock.patch.object(npub, "plan_rich_format", side_effect=ValueError("bad comp")):
            r2 = npub.apply_rich_format(page, [], {})
        self.assertEqual(r2, "error:bad comp")
        self.assertIsNone(page.sent)

    def test_partial_heading_issue(self):
        self.assertEqual(npub.rich_format_heading_issue("ok:titles=3/3,fs16=20,center=2,captions=1"), "")
        self.assertEqual(npub.rich_format_heading_issue("ok:titles=0/0,fs16=2,center=0,captions=0"), "")
        msg = npub.rich_format_heading_issue("ok:titles=2/3,fs16=20,center=2,captions=1")
        self.assertIn("2/3", msg)
        self.assertIn("소제목 일부만", msg)
        self.assertEqual(npub.rich_format_heading_issue("error:boom"), "")

    def test_caption_only_real_photos(self):
        m = npub.image_caption_map([
            {"file_path": "/x/images/blog-image-01.png", "alt": "라일락 — 비온디트리 농원에서 직접 촬영", "source": "archive_frame"},
            {"file_path": "/x/images/blog-image-02.png", "alt": "라일락 꽃송이 근접 사진"},
            {"file_path": "/x/images/blog-image-03.png", "alt": "잎 근접 사진", "source": "generated", "ai": False},
        ])
        self.assertEqual(m, {"blog-image-01.png": "라일락 — 비온디트리 농원에서 직접 촬영"})

    def _frame_quotes(self, body):
        with mock.patch.object(npub, "uid", _ids()):
            comps = npub.parse_body_to_comps(body)
        return comps

    def test_api_path_absorbs_glued_frame_items(self):
        comps = self._frame_quotes(">>> 오늘 볼 것\n1) 잎의 광택\n- 하루 햇빛\n꽃말은 4월에 핍니다.")
        self.assertEqual([c["@ctype"] for c in comps], ["quotation", "text"])
        q = [p["nodes"][0]["value"] for p in comps[0]["value"]]
        self.assertEqual(q, ["오늘 볼 것", "1) 잎의 광택", "• 하루 햇빛"])

    def test_api_path_keeps_separated_list_outside(self):
        # draftToFinalContent 가 >>> 뒤 빈 줄을 보존한다 — 띄어 쓴 별도 목록은 상자 밖 본문.
        comps = self._frame_quotes(">>> 오늘 볼 것\n\n1) 따로 쓴 목록\n2) 둘째")
        self.assertEqual([c["@ctype"] for c in comps], ["quotation", "text"])
        self.assertEqual([p["nodes"][0]["value"] for p in comps[0]["value"]], ["오늘 볼 것"])
        # 다른 깊이의 인용 뒤 목록은 흡수하지 않는다(프레임만).
        comps2 = self._frame_quotes(">> 따옴표\n1) 항목")
        self.assertEqual([c["@ctype"] for c in comps2], ["quotation", "text"])

    def test_human_and_api_paths_agree(self):
        lines = [">>> 오늘 볼 것", "1) 상자 항목", "", "2) 따로"]
        q = ["오늘 볼 것"]
        k = npub.absorb_frame_items(lines, 1, q)
        self.assertEqual(k, 2)
        comps = self._frame_quotes("\n".join(lines))
        api = [p["nodes"][0]["value"] for p in comps[0]["value"]]
        self.assertEqual(q, api)
        self.assertEqual(api, ["오늘 볼 것", "1) 상자 항목"])  # 빈 줄 뒤 '2) 따로'는 상자 밖
        self.assertEqual(comps[1]["value"][0]["nodes"][0]["value"], "2) 따로")


if __name__ == "__main__":
    unittest.main()
