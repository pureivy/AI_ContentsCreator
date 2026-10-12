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
@font-face{font-family:P;src:url("FONTDIR/Pretendard-Bold.woff2");font-weight:700}
@font-face{font-family:P;src:url("FONTDIR/Pretendard-ExtraBold.woff2");font-weight:800}
:root{--ink:#22301f;--green:#2f5d3a;--leaf:#5b8a4a;--paper:#f6f3ea;--card:#fff;--line:#d9d3c2;--quince:#d9a62e;--warn:#b5482f;--warnbg:#fbeae4;--muted:#6b6f63}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;background:var(--paper);font-family:P,sans-serif;color:var(--ink);font-weight:700}
.wrap{padding:64px 64px 56px;min-height:1350px;display:flex;flex-direction:column}
.kicker{font-size:30px;color:var(--leaf)}
h1{font-size:60px;font-weight:800;line-height:1.2;margin:10px 0 34px;word-break:keep-all}
.warn{background:var(--warnbg);border:3px solid var(--warn);border-radius:22px;padding:18px 24px;display:flex;gap:16px;align-items:center;font-size:31px;line-height:1.3;margin:0 0 18px;word-break:keep-all}
.warn b{color:var(--warn);font-weight:800;white-space:nowrap}
.list{display:flex;flex-direction:column;gap:14px}
.st{display:flex;align-items:center;gap:22px;background:var(--card);border:2px solid var(--line);border-radius:22px;padding:18px 24px}
.n{flex:none;width:62px;height:62px;border-radius:50%;background:var(--green);color:#fff;font-size:34px;font-weight:800;display:grid;place-items:center}
.t{font-size:34px;line-height:1.3;word-break:keep-all}
.t small{display:block;font-size:26px;color:var(--muted);margin-top:4px}
.tl{position:relative;padding-left:76px;display:flex;flex-direction:column;gap:30px}
.tl:before{content:"";position:absolute;left:30px;top:20px;bottom:20px;width:6px;border-radius:3px;background:linear-gradient(var(--leaf),var(--quince))}
.it{position:relative;background:var(--card);border:2px solid var(--line);border-radius:22px;padding:28px 30px}
.it:before{content:"";position:absolute;left:-62px;top:24px;width:30px;height:30px;border-radius:50%;background:var(--paper);border:6px solid var(--leaf)}
.it:last-child:before{border-color:var(--quince)}
.when{font-size:28px;color:var(--leaf);font-weight:800}
.what{font-size:36px;line-height:1.3;margin-top:4px;word-break:keep-all}
.main{flex:1;display:flex;flex-direction:column;justify-content:center;padding-bottom:40px}
.foot{margin-top:auto;padding-top:40px;font-size:24px;color:var(--muted);display:flex;justify-content:space-between}
"""


def build(spec, font_dir):
    kind = spec.get("kind")
    warn = lambda w: f'<div class="warn"><b>주의</b><span>{esc(w)}</span></div>'
    before = "".join(warn(w) for w in spec.get("warnBefore") or [])
    after = "".join(warn(w) for w in spec.get("warnAfter") or [])
    items = spec.get("items") or []
    if kind == "steps":
        body = '<div class="list">' + "".join(
            f'<div class="st"><div class="n">{i + 1}</div><div class="t">{esc(it.get("text"))}'
            + (f'<small>{esc(it.get("sub"))}</small>' if it.get("sub") else "") + "</div></div>"
            for i, it in enumerate(items)) + "</div>"
    else:
        body = '<div class="tl">' + "".join(
            '<div class="it">' + (f'<div class="when">{esc(it.get("label"))}</div>' if it.get("label") else "")
            + f'<div class="what">{esc(it.get("text"))}</div></div>' for it in items) + "</div>"
    after_html = f'<div style="margin-top:18px">{after}</div>' if after else ""
    return ("<!doctype html><html><head><meta charset='utf-8'><style>" + CSS.replace("FONTDIR", "file://" + font_dir) + "</style></head><body>"
            f'<div class="wrap"><div class="kicker">{esc(spec.get("kicker"))}</div><h1>{esc(spec.get("title"))}</h1>'
            f'<div class="main">{before}{body}{after_html}</div>'
            f'<div class="foot"><span>{esc(spec.get("brand"))}</span><span>{esc(spec.get("handle"))}</span></div></div></body></html>')


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
            h = min(1920, max(1350, int(pg.evaluate("document.querySelector('.wrap').scrollHeight"))))
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
