#!/usr/bin/env python3
"""
블로그 설명 도표 렌더러(2026-10-12 사장님 채택 — 모과나무 삽목 글 시범) — HTML/CSS 를 헤드리스 크롬으로 PNG 로 찍는다.

AI 그림이 아니라 글자를 HTML 로 그리므로 한글이 정확하다. 내용(문구)은 호출부(src/output/blogDiagrams.ts)가 본문에서
뽑아 넘긴다 — 이 스크립트는 문구를 만들지 않는다.

사용:
  python blog_diagram.py <spec.json>
spec: {"kind":"steps"|"points","kicker":"모과나무 삽목","title":"삽수 꽂는 순서",
       "items":[{"label":"꽂을 때","text":"...","sub":"..."}],"warnBefore":["..."],"warnAfter":["..."],
       "brand":"비온디트리","handle":"biondi_tree","out":"/abs/path.png","fontDir":"/abs/remotion/fonts"}
출력: 마지막 줄에 RESULT_JSON {"ok":true,"out":...,"height":N}
"""
import glob
import html
import json
import os
import sys


def chromium_exe():
    c = sorted(glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell")))
    return c[-1] if c else None


def esc(s):
    return html.escape(str(s or ""))


CSS = """
@font-face{font-family:H;src:url("FONTDIR/Pretendard-ExtraBold.woff2")}
@font-face{font-family:B;src:url("FONTDIR/GowunDodum-Regular.ttf")}
@font-face{font-family:L;src:url("FONTDIR/Pretendard-Bold.woff2")}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;font-family:B,"Apple Color Emoji",sans-serif;color:#23301f;word-break:keep-all}
.wrap{padding:62px 60px 56px}
.k{font-family:H,"Apple Color Emoji",sans-serif;font-size:44px;color:#c2581f}
h1{font-family:H,"Apple Color Emoji",sans-serif;font-weight:400;font-size:84px;line-height:1.18;margin:8px 0 36px}
/* A — 이모지 카드(순서 도표) */
body.steps{background:#faf6ee}
.c{display:flex;gap:28px;align-items:center;background:#fff;border-radius:32px;padding:30px 30px;margin-bottom:22px;box-shadow:0 6px 18px rgba(80,60,20,.08)}
.e{flex:none;width:150px;height:150px;border-radius:36px;display:grid;place-items:center;font-size:84px;font-family:"Apple Color Emoji",H,sans-serif;color:#2f5d3a}
.no{display:block;font-family:L,sans-serif;font-size:40px;color:#c2581f;letter-spacing:.04em}
.c b{display:block;font-weight:400;font-size:66px;line-height:1.28}
.c small{display:block;font-size:48px;line-height:1.32;color:#6e6859;margin-top:8px}
.wa{margin:10px 0 22px;background:#fff0ea;border:4px dashed #e0623a;border-radius:28px;padding:26px 30px;font-size:56px;line-height:1.32;color:#b8431e}
/* E — 계절 카드(요약 도표) */
body.points{background:#fffaf3}
.grid{display:flex;flex-direction:column;gap:30px}
.p{display:flex;gap:30px;align-items:center;border-radius:34px;padding:42px 34px}
.ic{flex:none;width:150px;height:150px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:84px;box-shadow:0 6px 16px rgba(0,0,0,.06);font-family:"Apple Color Emoji",H,sans-serif;color:#2f5d3a}
.lb{display:inline-block;color:#fff;border-radius:999px;padding:8px 28px;font-family:L,sans-serif;font-size:56px;letter-spacing:.01em;margin-bottom:14px}
.p b{display:block;font-weight:400;font-size:70px;line-height:1.28}
"""

STEP_BG = ["#e9f3e1", "#fff1d6", "#fde3d8", "#dcefff", "#e4ecff", "#f3e6f3", "#fdf2c9", "#e3f0da"]
POINT_COLORS = [("#f7e3cf", "#c26a26"), ("#e3f0da", "#4f7d3c"), ("#e2ecf8", "#3d6fa8"), ("#f3e6f3", "#8a4f8f"), ("#fdf2c9", "#a0790f")]


def build(spec, font_dir):
    kind = spec.get("kind")
    items = spec.get("items") or []
    warn = lambda w: f'<div class="wa">⚠️ {esc(w)}</div>'
    before = "".join(warn(w) for w in spec.get("warnBefore") or [])
    after = "".join(warn(w) for w in spec.get("warnAfter") or [])
    kicker = f'{esc(spec.get("kickerEmoji") or "")} {esc(spec.get("kicker"))}'.strip()
    if kind == "steps":
        body = "".join(
            f'<div class="c"><div class="e" style="background:{STEP_BG[i % len(STEP_BG)]}">{esc(it.get("emoji") or str(i + 1))}</div>'
            f'<div><span class="no">STEP {i + 1}</span><b>{esc(it.get("text"))}</b>'
            + (f'<small>{esc(it.get("sub"))}</small>' if it.get("sub") else "") + "</div></div>"
            for i, it in enumerate(items))
        main = f"{before}{body}{after}"
    else:
        body = "".join(
            f'<div class="p" style="background:{POINT_COLORS[i % len(POINT_COLORS)][0]}">'
            f'<div class="ic">{esc(it.get("emoji") or str(i + 1))}</div><div>'
            + (f'<div class="lb" style="background:{POINT_COLORS[i % len(POINT_COLORS)][1]}">{esc(it.get("label"))}</div>' if it.get("label") else "")
            + f'<b>{esc(it.get("text"))}</b></div></div>'
            for i, it in enumerate(items))
        main = f'{before}<div class="grid">{body}</div>{after}'
    return ("<!doctype html><html><head><meta charset='utf-8'><style>" + CSS.replace("FONTDIR", "file://" + font_dir) + "</style></head>"
            f'<body class="{"steps" if kind == "steps" else "points"}"><div class="wrap"><div class="k">{kicker}</div><h1>{esc(spec.get("title"))}</h1>'
            # 하단 상호·계정 줄 없음, 높이는 내용에 맞춘다(2026-10-12 사장님 — 아래 베이지 여백을 줄여 달라).
            # 글자 2배(같은 날 사장님 — 휴대폰에서 본문·라벨이 안 보인다). 휴대폰은 1080 폭을 약 1/3로 줄여 보여 준다.
            f'<div class="main">{main}</div></div></body></html>')


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    out = spec["out"]
    page_html = build(spec, spec.get("fontDir") or "")
    tmp_html = out + ".html"
    with open(tmp_html, "w", encoding="utf-8") as f:
        f.write(page_html)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        exe = chromium_exe()
        b = p.chromium.launch(**({"executable_path": exe} if exe else {}))
        try:
            pg = b.new_page(viewport={"width": 1080, "height": 1350})
            pg.goto("file://" + os.path.abspath(tmp_html))
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(300)
            h = min(4000, max(600, int(pg.evaluate("document.querySelector('.wrap').scrollHeight"))))
            pg.set_viewport_size({"width": 1080, "height": h})
            pg.screenshot(path=out)
        finally:
            b.close()
    try:
        os.remove(tmp_html)
    except OSError:
        pass
    print("RESULT_JSON " + json.dumps({"ok": True, "out": out, "height": h}, ensure_ascii=False))


if __name__ == "__main__":
    main()
