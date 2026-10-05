"""render_frames.py 순수 함수 단위 테스트(stdlib unittest — 브라우저·네트워크 없음). B 의 같은 이름 테스트를 파일럿 촬영기에 맞춰 옮김.

실행: cd scripts/mg_direct && python3 -m unittest test_render_frames -v
"""
import unittest

import render_frames as rf


class StaticProblems(unittest.TestCase):
    def test_forbidden_patterns(self):
        self.assertIn("script 금지", rf.static_problems("<div></div><script>alert(1)</script>"))
        self.assertIn("외부 주소 금지", rf.static_problems('<div style="background:url(https://x.com/a.png)"></div>'))
        self.assertIn("외부 미디어 태그 금지", rf.static_problems('<img src="a.png">'))
        self.assertIn("@import 금지", rf.static_problems("<style>@import 'x.css';</style>"))

    def test_svg_namespace_allowed(self):
        frag = '<style>.s03{position:absolute;inset:0}</style><div class="s03"><svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg></div>'
        self.assertEqual(rf.static_problems(frag), [])


class Overlap(unittest.TestCase):
    def test_script_text_passes_and_new_text_fails(self):
        src = "작고 비슷해 보이는 열매는 명자나무로 흔히 오해해요. 대비: ✕ 명자나무로 오해(작고 비슷해 보여서) / ✓ 모과나무는 향 퍼짐"
        self.assertGreaterEqual(rf.overlap("✓ 모과나무는 향 퍼짐", src), 0.5)
        self.assertLess(rf.overlap("열매가 달고 맛있어요", src), 0.5)


class Splice(unittest.TestCase):
    def test_original_ranges_and_segments_are_concatenated_in_order(self):
        ranges = [{"start": 0, "frames": 90, "graphic": False}, {"start": 90, "frames": 60, "graphic": True}, {"start": 150, "frames": 30, "graphic": False}]
        f = rf.splice_filter(ranges, {1: 1})
        self.assertIn("[0:v]trim=start_frame=0:end_frame=90", f)
        self.assertIn("[1:v]trim=end_frame=60", f)
        self.assertIn("[0:v]trim=start_frame=150:end_frame=180", f)
        self.assertTrue(f.endswith("[v0][v1][v2]concat=n=3:v=1:a=0[v]"))

    def test_frame_file_clamps(self):
        sc = {"frames": 10, "bgFrames": "/b"}
        self.assertEqual(rf.frame_file(sc, 0), "/b/0001.jpg")
        self.assertEqual(rf.frame_file(sc, 99), "/b/0010.jpg")


if __name__ == "__main__":
    unittest.main()
