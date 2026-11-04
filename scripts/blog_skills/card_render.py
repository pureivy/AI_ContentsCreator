#!/usr/bin/env python3
"""
카드뉴스 HTML 렌더러(2026-10-12 사장님 채택 — 감나무 카드 9장 시범) — 틀 8가지를 HTML/CSS 로 그려 1080×1350 PNG 로 찍는다.

글자는 HTML 이 그리므로 한글 오타가 없다. 문구·사진 경로는 호출부(src/orchestrator/cardLayout.ts)가 정해 넘긴다 — 이 스크립트는
문구를 만들지 않는다. 장마다 글이 넘치면 글자 배율(--k)을 단계적으로 줄이고, 그래도 넘치면 issues 에 적는다.

사용:
  python card_render.py <spec.json>
spec: {"series":"산길 나무 구별 노트","fontDir":"/abs/remotion/fonts","outDir":"/abs/dir","only":[1,3],
       "brand":{"name":"비온디트리","handle":"biondi_tree"},
       "slides":[{"kind":"cover"|"points"|"photo"|"compare"|"pair"|"numbers"|"facts"|"steps", ...}]}
출력: outDir/slide_NN.png, 마지막 줄 RESULT_JSON {"ok":true,"slides":[{"n":1,"k":1.0,"issues":[]}]}
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


def img(p):
    """사진 경로 → file URL(없으면 빈 문자열 — 틀이 사진 없는 판으로 그린다)."""
    p = str(p or "")
    return "file://" + os.path.abspath(p) if p and os.path.isfile(p) else ""


def titled(title, accent):
    """제목 안의 강조어를 주황으로(없으면 그대로). 줄바꿈 \\n 은 <br>."""
    t = esc(title)
    a = esc(accent)
    if a and a in t:
        t = t.replace(a, f"<em>{a}</em>", 1)
    return t.replace("\n", "<br>")


CSS = """
@font-face{font-family:H;src:url("FONTDIR/Pretendard-ExtraBold.woff2")}
@font-face{font-family:L;src:url("FONTDIR/Pretendard-Bold.woff2")}
@font-face{font-family:B;src:url("FONTDIR/GowunDodum-Regular.ttf")}
:root{--paper:#f5efe3;--paper2:#ebe2d0;--ink:#1e2a1b;--soft:#5d5a4f;--accent:#e2621d;--accent-l:#fbe2cf;--leaf:#3c6a36;--leaf-l:#e1ecd6;--k:1}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden;font-family:B,"Apple Color Emoji",sans-serif;color:var(--ink);word-break:keep-all;overflow-wrap:break-word}
.s{width:1080px;height:1350px;position:relative;overflow:hidden;background:var(--paper)}
.s.paper::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:radial-gradient(rgba(90,70,30,.07) 1px,transparent 1.2px);background-size:7px 7px}
.H{font-family:H,"Apple Color Emoji",sans-serif;font-weight:400;letter-spacing:-.02em;line-height:1.17}
.H em{font-style:normal;color:var(--accent)}
.run{position:absolute;top:54px;left:64px;right:64px;display:flex;justify-content:space-between;align-items:center;font-family:L;font-size:28px;letter-spacing:.06em;color:var(--soft);z-index:5}
.run .no{display:flex;align-items:center;gap:12px}
.run .no i{display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--accent)}
.run.w{color:rgba(255,255,255,.9);text-shadow:0 1px 6px rgba(0,0,0,.35)}
.ph{position:absolute;object-fit:cover}
.wrap{position:absolute;left:64px;right:64px;display:flex;flex-direction:column;overflow:hidden}
.mid{flex:1 1 auto;display:flex;flex-direction:column;justify-content:safe center;min-height:0}
.s.fx{display:flex;flex-direction:column}
.s.fx .top{position:relative;flex:1 1 auto;min-height:440px;overflow:hidden}
.s.fx .top>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.s.fx .top .fade{bottom:0;height:200px}
.s.fx .wrap{position:relative;left:auto;right:auto;flex:none;padding:28px 64px 64px;overflow:visible}
.lead{font-size:calc(50px*var(--k));line-height:1.5;color:#2e3529}
.h2{font-size:calc(72px*var(--k));margin-bottom:calc(22px*var(--k))}
.card{background:#fff;border-radius:30px;box-shadow:0 8px 22px rgba(70,55,20,.09)}
.lab{font-family:L;font-size:calc(30px*var(--k));color:var(--accent);letter-spacing:.05em}
.note{margin-top:calc(26px*var(--k));display:flex;gap:20px;align-items:center;background:var(--leaf);color:#fff;border-radius:28px;padding:calc(24px*var(--k)) 30px}
.note span{flex:none;width:52px;height:52px;border-radius:50%;background:#fff;color:var(--leaf);display:grid;place-items:center;font-family:L;font-size:30px}
.note p{font-family:L;font-size:calc(44px*var(--k));line-height:1.4}
.fade{position:absolute;left:0;right:0;height:220px;background:linear-gradient(180deg,rgba(245,239,227,0),var(--paper))}
.chip{display:inline-flex;align-items:center;gap:10px;font-family:L;font-size:26px;border-radius:999px;padding:10px 24px}

/* cover */
.cover .ph{inset:0;width:100%;height:100%}
.cover .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(18,26,14,.5) 0%,rgba(18,26,14,0) 24%,rgba(18,26,14,0) 38%,rgba(18,26,14,.8) 66%,rgba(18,26,14,.95) 100%)}
.cover.nophoto{background:linear-gradient(160deg,#2f4a2a,#1e2a1b)}
.cover .wrap{top:300px;bottom:180px;color:#fff}
.cover .wrap>:first-child{margin-top:auto}
.cover .k{font-family:L;font-size:calc(30px*var(--k));color:#ffcfa8;letter-spacing:.04em;margin-bottom:18px}
.cover h1{font-size:calc(100px*var(--k))}
.cover h1 em{color:#ff9a52}
.cover .sub{font-size:calc(52px*var(--k));margin-top:24px;color:rgba(255,255,255,.93);line-height:1.5}
.cover .foot{position:absolute;left:64px;right:64px;bottom:90px;display:flex;justify-content:space-between;align-items:center;gap:20px}
.cover .src{font-family:L;font-size:26px;color:rgba(255,255,255,.82);background:rgba(0,0,0,.3);padding:7px 16px;border-radius:999px}
.cover .next{background:#fff;color:var(--ink);margin-left:auto}

/* points */
.points .wrap{top:140px;bottom:64px}
.points .row{display:flex;gap:28px;align-items:center;padding:calc(20px*var(--k)) 28px calc(20px*var(--k)) 20px;margin-top:calc(22px*var(--k))}
.points .th{flex:none;width:calc(170px*var(--k));height:calc(170px*var(--k));border-radius:24px;object-fit:cover}
.points .tile{flex:none;width:calc(130px*var(--k));height:calc(130px*var(--k));border-radius:30px;display:grid;place-items:center;font-size:calc(70px*var(--k));font-family:"Apple Color Emoji",H}
.points .row b{display:block;font-family:H;font-weight:400;font-size:calc(50px*var(--k));margin:2px 0 6px}
.points .row p{font-size:calc(44px*var(--k));line-height:1.42;color:#3a3f33}

/* photo */
.photo .tags{position:absolute;left:44px;top:150px;display:flex;flex-direction:column;gap:16px;align-items:flex-start;z-index:4}
.photo .tag{font-family:L;font-size:38px;background:#fff;color:var(--ink);padding:12px 22px;border-radius:18px;box-shadow:0 8px 20px rgba(0,0,0,.2);display:flex;gap:10px;align-items:center}
.photo .tag i{font-style:normal;display:inline-grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--accent);color:#fff;font-size:22px}
.photo.nophoto .wrap{position:absolute;top:150px;bottom:64px}

/* compare */
.compare.fx .wrap{margin-top:-70px;padding-top:0}
.compare.nophoto .wrap{position:absolute;top:150px;bottom:64px}
.compare .cmp{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:calc(32px*var(--k))}
.compare .cell{border-radius:30px;padding:calc(24px*var(--k)) 26px;box-shadow:0 10px 26px rgba(70,55,20,.12)}
.compare .cell.x{background:#fff}
.compare .cell.o{background:var(--leaf);color:#fff}
.compare .cell .t{font-family:L;font-size:calc(34px*var(--k));display:flex;gap:10px;align-items:center}
.compare .cell .t i{font-style:normal;flex:none;width:40px;height:40px;border-radius:50%;display:inline-grid;place-items:center;font-size:24px}
.compare .cell.x .t i{background:#d64a3a;color:#fff}
.compare .cell.o .t i{background:#fff;color:var(--leaf)}
.compare .cell b{display:block;font-family:H;font-weight:400;font-size:calc(48px*var(--k));line-height:1.25;margin-top:12px}
.compare .cell.x b{border-bottom:5px dashed #d64a3a;padding-bottom:10px}
.compare .cell.o b{border-bottom:5px solid rgba(255,255,255,.85);padding-bottom:10px}
.compare .cell.n{background:#fff}
.compare .cell.n .t i{background:var(--leaf);width:18px;height:18px}
.compare .cell.n b{border-bottom:5px solid var(--leaf);padding-bottom:10px}

/* pair */
.pair .duo{position:relative;flex:1 1 auto;min-height:440px;display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--paper)}
.pair .duo .p{position:relative;overflow:hidden;background:var(--paper2)}
.pair .duo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pair .duo .lb{position:absolute;left:22px;bottom:22px;font-family:H;font-size:38px;color:#fff;background:rgba(30,26,22,.72);padding:10px 22px;border-radius:18px}
.pair .two{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.pair .two div{padding:calc(22px*var(--k)) 26px}
.pair .two p{font-size:calc(42px*var(--k));line-height:1.4;margin-top:8px}

/* numbers */
.numbers .wrap.abs{position:absolute;top:150px;bottom:64px}
.numbers .stats{display:flex;gap:20px;margin:calc(10px*var(--k)) 0 calc(26px*var(--k))}
.numbers .stat{flex:1;padding:calc(26px*var(--k)) 26px;border-left:10px solid var(--accent)}
.numbers .stat b{display:block;font-family:H;font-weight:400;font-size:calc(80px*var(--k));color:var(--accent);line-height:1.1}
.numbers .stat p{font-family:L;font-size:calc(38px*var(--k));margin-top:8px;line-height:1.4}
.numbers .cal{padding:calc(26px*var(--k)) 30px;margin-top:calc(8px*var(--k))}
.numbers .bar{display:grid;grid-template-columns:repeat(12,1fr);gap:5px;margin-bottom:8px}
.numbers .bar span{height:20px;border-radius:6px;background:var(--paper2)}
.numbers .mo{display:grid;grid-template-columns:repeat(12,1fr);font-family:L;font-size:26px;color:#9a927f;text-align:center;margin-bottom:16px}
.numbers .lg{font-size:calc(40px*var(--k));line-height:1.4;margin-top:8px}
.numbers .lg i{display:inline-block;width:20px;height:20px;border-radius:6px;margin-right:10px;vertical-align:-2px}

/* facts */
.facts{background:#22301f;color:#f3ecdc}
.facts .run{color:rgba(243,236,220,.7)}
.facts .H em{color:#ff9a52}
.facts .wrap{top:140px;bottom:56px}
.facts .it{display:flex;gap:28px;padding:calc(26px*var(--k)) 0;border-top:2px solid rgba(243,236,220,.16)}
.facts .it:last-child{border-bottom:2px solid rgba(243,236,220,.16)}
.facts .big{flex:none;width:230px;font-family:H;font-size:calc(50px*var(--k));line-height:1.15;color:#ffcfa8}
.facts .big small{display:block;font-family:L;font-size:calc(28px*var(--k));color:rgba(243,236,220,.6);margin-top:8px;letter-spacing:.04em}
.facts .it p{font-size:calc(44px*var(--k));line-height:1.45;color:rgba(243,236,220,.93)}

/* steps */
.steps .wrap{top:140px;bottom:270px}
.steps .st{display:flex;gap:28px;align-items:flex-start;margin-top:calc(24px*var(--k))}
.steps .st .d{flex:none;width:calc(96px*var(--k));height:calc(96px*var(--k));border-radius:50%;display:grid;place-items:center;font-size:calc(48px*var(--k));background:#fff;box-shadow:0 8px 20px rgba(70,55,20,.12);font-family:"Apple Color Emoji",H}
.steps .st b{display:block;font-family:H;font-weight:400;font-size:calc(50px*var(--k));margin:2px 0 6px}
.steps .st p{font-size:calc(44px*var(--k));line-height:1.42;color:#3a3f33}
.steps .end{position:absolute;left:64px;right:64px;bottom:64px;height:180px;border-radius:36px;background:var(--ink);color:#f3ecdc;padding:0 40px;display:flex;justify-content:space-between;align-items:center}
.steps .end b{font-family:H;font-weight:400;font-size:42px;line-height:1.35}
.steps .end small{display:block;font-family:L;font-size:30px;color:rgba(243,236,220,.65);margin-top:10px}
.steps .end .bm{font-size:70px;font-family:"Apple Color Emoji"}
"""

TILE_BG = ["#e9f3e1", "#fff1d6", "#fde3d8", "#dcefff", "#f3e6f3"]
CAL_COLORS = ["#f0d98a", "#e2621d", "#7fae6b"]


def run_header(series, n, total, white):
    return (f'<div class="run{" w" if white else ""}"><span class="no"><i></i>{esc(series)}</span>'
            f'<span>{n:02d} / {total:02d}</span></div>')


def note_html(text):
    return f'<div class="note"><span>✓</span><p>{esc(text)}</p></div>' if text else ""


def slide_html(s, n, total, series, brand):
    kind = s.get("kind")
    title = f'<h2 class="H h2">{titled(s.get("title"), s.get("accent"))}</h2>'
    lead = f'<p class="lead">{esc(s.get("lead")).replace(chr(10), "<br>")}</p>' if s.get("lead") else ""
    photo = img(s.get("photo"))
    if kind == "cover":
        bg = f'<img class="ph" src="{photo}"><div class="shade"></div>' if photo else ""
        src = f'<span class="src">{esc(s.get("photoNote"))}</span>' if s.get("photoNote") and photo else ""
        return (f'<section class="s cover{"" if photo else " nophoto"}">{bg}{run_header(series, n, total, True)}'
                f'<div class="wrap"><div class="k">{esc(s.get("kicker"))}</div><h1 class="H">{titled(s.get("title"), s.get("accent"))}</h1>'
                + (f'<p class="sub">{esc(s.get("lead")).replace(chr(10), "<br>")}</p>' if s.get("lead") else "")
                + f'</div><div class="foot">{src}<span class="chip next">넘겨 보세요 →</span></div></section>')
    if kind == "points":
        rows = ""
        for i, it in enumerate(s.get("items") or []):
            th = img(it.get("photo"))
            vis = (f'<img class="th" src="{th}">' if th else
                   f'<div class="tile" style="background:{TILE_BG[i % len(TILE_BG)]}">{esc(it.get("emoji") or str(i + 1))}</div>')
            rows += (f'<div class="row card">{vis}<div><span class="lab">{esc(it.get("label") or f"POINT {i + 1}")}</span>'
                     f'<b>{esc(it.get("title"))}</b><p>{esc(it.get("text"))}</p></div></div>')
        return (f'<section class="s paper points">{run_header(series, n, total, False)}'
                f'<div class="wrap">{title}<div class="mid">{lead}{rows}{note_html(s.get("note"))}</div></div></section>')
    if kind == "photo":
        tags = "".join(f'<div class="tag"><i>{i + 1}</i>{esc(t)}</div>' for i, t in enumerate(s.get("tags") or []))
        top = f'<div class="top"><img src="{photo}"><div class="fade"></div><div class="tags">{tags}</div></div>' if photo else ""
        return (f'<section class="s paper photo{" fx" if photo else " nophoto"}">{top}{run_header(series, n, total, bool(photo))}'
                f'<div class="wrap">' + (f'<div class="mid">{title}{lead}{note_html(s.get("note"))}</div>' if not photo else f'{title}{lead}{note_html(s.get("note"))}') + '</div></section>')
    if kind == "compare":
        bad, good = s.get("bad") or {}, s.get("good") or {}
        top = f'<div class="top"><img src="{photo}"></div>' if photo else ""
        # neutral(2026-10-27) = 맞고 틀림 없는 두 갈래 — ✕·✓ 없이 같은 색 칸. swap = 사진 좌우에 맞춰 good 칸을 왼쪽에.
        neutral = s.get("tone") == "neutral"
        cell_bad = (f'<div class="cell {"n" if neutral else "x"}"><span class="t"><i>{"" if neutral else "✕"}</i>{esc(bad.get("label"))}</span>'
                    f'<b>{esc(bad.get("text"))}</b></div>')
        cell_good = (f'<div class="cell {"n" if neutral else "o"}"><span class="t"><i>{"" if neutral else "✓"}</i>{esc(good.get("label"))}</span>'
                     f'<b>{esc(good.get("text"))}</b></div>')
        cells = cell_good + cell_bad if s.get("swap") else cell_bad + cell_good
        cmp = f'<div class="cmp">{cells}</div>'
        return (f'<section class="s paper compare{" fx" if photo else " nophoto"}">{top}{run_header(series, n, total, bool(photo))}'
                + (f'<div class="wrap">{cmp}{title}{lead}</div></section>' if photo else f'<div class="wrap"><div class="mid">{cmp}{title}{lead}</div></div></section>'))
    if kind == "pair":
        ps = (s.get("photos") or [])[:2]
        duo = "".join(f'<div class="p">' + (f'<img src="{img(p.get("photo"))}">' if img(p.get("photo")) else "")
                      + f'<span class="lb">{esc(p.get("label"))}</span></div>' for p in ps)
        cards = "".join(f'<div class="card"><span class="lab">{esc(c.get("label"))}</span><p>{esc(c.get("text"))}</p></div>'
                        for c in (s.get("cards") or [])[:2])
        return (f'<section class="s paper pair fx"><div class="duo">{duo}</div>{run_header(series, n, total, True)}'
                f'<div class="wrap">{title}<div class="two">{cards}</div>{note_html(s.get("note"))}</div></section>')
    if kind == "numbers":
        top = f'<div class="top"><img src="{photo}"><div class="fade"></div></div>' if photo else ""
        stats = "".join(f'<div class="stat card"><b>{esc(st.get("value"))}</b><p>{esc(st.get("label"))}</p></div>'
                        for st in (s.get("stats") or [])[:3])
        cal = ""
        rows = (s.get("calendar") or [])[:3]
        if rows:
            color = {}
            for ci, r in enumerate(rows):
                for m in r.get("months") or []:
                    color.setdefault(int(m), CAL_COLORS[ci % len(CAL_COLORS)])
            bar = "".join(f'<span style="{"background:" + color[m] if m in color else ""}"></span>' for m in range(1, 13))
            mo = "".join(f"<span>{m}</span>" for m in range(1, 13))
            lg = "".join(f'<div class="lg"><i style="background:{CAL_COLORS[ci % len(CAL_COLORS)]}"></i>{esc(r.get("label"))}</div>'
                         for ci, r in enumerate(rows))
            cal = f'<div class="cal card"><div class="bar">{bar}</div><div class="mo">{mo}</div>{lg}</div>'
        inner = f'{lead}' + (f'<div class="stats">{stats}</div>' if stats else "") + cal
        return (f'<section class="s paper numbers{" fx" if photo else ""}">{top}{run_header(series, n, total, bool(photo))}'
                + (f'<div class="wrap">{title}{inner}</div></section>' if photo else f'<div class="wrap abs"><div class="mid">{title}{inner}</div></div></section>'))
    if kind == "facts":
        rows = "".join(f'<div class="it"><div class="big">{esc(r.get("big"))}<small>{esc(r.get("small"))}</small></div><p>{esc(r.get("text"))}</p></div>'
                       for r in (s.get("rows") or [])[:4])
        return (f'<section class="s facts">{run_header(series, n, total, False)}'
                f'<div class="wrap">{title}<div class="mid">{rows}</div></div></section>')
    # steps(마무리) — 그 밖의 kind 도 여기로(호출부가 kind 를 정규화하지만 방어)
    steps = "".join(f'<div class="st"><div class="d">{esc(st.get("emoji") or str(i + 1))}</div><div><span class="lab">STEP {i + 1}</span>'
                    f'<b>{esc(st.get("title"))}</b><p>{esc(st.get("text"))}</p></div></div>'
                    for i, st in enumerate((s.get("steps") or [])[:4]))
    end = s.get("end") or {}
    brand_line = " · ".join(x for x in [brand.get("name"), "@" + brand["handle"] if brand.get("handle") else ""] if x)
    return (f'<section class="s paper steps">{run_header(series, n, total, False)}'
            + (f'<div class="wrap">{title}<div class="mid">{lead}{steps}</div></div>' if steps else f'<div class="wrap"><div class="mid">{title}{lead}</div></div>')
            + f'<div class="end"><div><b>{esc(end.get("title") or "저장해 두고 필요할 때 꺼내 보세요")}</b><small>{esc(brand_line)}</small></div><div class="bm">🔖</div></div></section>')


# 넘침 검사 — 글 칸(.wrap)이 제 높이를 넘거나, 칸 안 글이 가로로 삐져나오면 문제.
PROBE = """() => {
  const w = document.querySelector('.wrap'); const out = [];
  const sl = document.querySelector('.s');
  if (sl && sl.classList.contains('fx')) {
    const top = sl.querySelector('.top, .duo');
    if (top && top.getBoundingClientRect().height < 439) out.push('사진 칸이 최소 높이 아래로 눌림');
    if (w && w.getBoundingClientRect().bottom > 1350 + 2) out.push('글이 슬라이드 아래로 넘침');
  } else if (w && w.scrollHeight > w.clientHeight + 2) out.push('글 칸 넘침 ' + (w.scrollHeight - w.clientHeight) + 'px');
  const m = document.querySelector('.mid');
  if (m && m.scrollHeight > m.clientHeight + 2) out.push('본문 칸 넘침 ' + (m.scrollHeight - m.clientHeight) + 'px');
  for (const e of document.querySelectorAll('.wrap *, .tag, .lb, .end b')) {
    if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible') out.push('가로 넘침: ' + e.textContent.slice(0, 12));
  }
  return out;
}"""


# 가운데 칸의 남는 높이(px) — 키운 배율이 칸을 빈틈없이 메우면 답답하다.
SLACK = """() => { const m = document.querySelector('.mid'); if (!m) return 999;
  const kids = [...m.children]; if (!kids.length) return 999;
  const h = kids[kids.length - 1].getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top;
  return m.clientHeight - h; }"""


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    slides = spec.get("slides") or []
    total = len(slides)
    only = set(spec.get("only") or range(1, total + 1))
    out_dir = spec["outDir"]
    os.makedirs(out_dir, exist_ok=True)
    css = CSS.replace("FONTDIR", "file://" + (spec.get("fontDir") or ""))
    brand = spec.get("brand") or {}
    results = []
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        exe = chromium_exe()
        b = p.chromium.launch(**({"executable_path": exe} if exe else {}))
        try:
            pg = b.new_page(viewport={"width": 1080, "height": 1350})
            for i, s in enumerate(slides):
                n = i + 1
                if n not in only:
                    continue
                body = slide_html(s, n, total, spec.get("series") or "", brand)
                page = f"<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head><body>{body}</body></html>"
                tmp = os.path.join(out_dir, f".slide_{n:02d}.html")
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(page)
                pg.goto("file://" + os.path.abspath(tmp))
                pg.evaluate("document.fonts.ready")
                pg.wait_for_timeout(150)
                k, issues = 1.0, []
                # 글만 있는 판은 남는 높이만큼 키운다(가장 큰 배율부터 내려오며 넘치지 않는 첫 값). 사진 판은 1.0부터 줄이기만.
                fx = pg.evaluate("!!document.querySelector('.s.fx, .s.cover')")
                ladder = (1.0, 0.94, 0.88, 0.82, 0.76) if fx else (1.3, 1.22, 1.15, 1.08, 1.0, 0.94, 0.88, 0.82, 0.76)
                for k in ladder:
                    pg.evaluate(f"document.documentElement.style.setProperty('--k','{k}')")
                    pg.wait_for_timeout(40)
                    issues = pg.evaluate(PROBE)
                    if not issues and (fx or k <= 1.0 or pg.evaluate(SLACK) >= 60):
                        break
                pg.screenshot(path=os.path.join(out_dir, f"slide_{n:02d}.png"))
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                results.append({"n": n, "k": k, "issues": issues[:4]})
        finally:
            b.close()
    print("RESULT_JSON " + json.dumps({"ok": True, "slides": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
