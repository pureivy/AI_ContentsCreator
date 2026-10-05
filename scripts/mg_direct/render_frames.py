#!/usr/bin/env python3
"""
직접 제작 모션그래픽 촬영기 — 파일럿 전용(2026-10-05, Biz_Contents_Creator 의 scripts/mg_direct/render_frames.py 이식).

B 방식: Claude 가 씬마다 쓴 HTML/CSS/SVG 조각(scene_NN.html)을 공통 틀에 넣고, 헤드리스 Chromium 에서 모든 CSS·SVG
애니메이션을 '정지 + 시각 지정(seek)'으로 1/30초씩 넘기며 찍는다(결정적 촬영 — 프레임 누락·끊김 없음).

A(나무 농원) 적응:
 - 정보 씬(대비·목록·결론)만 그래픽으로 바꾼다. 실촬영 훅·일반 씬은 원본 final.mp4 의 그 구간을 프레임 단위로 잘라 그대로 잇는다.
 - 그래픽 씬 바탕 = 우리 Remotion 렌더에서 카드만 뺀 판(제목 캘리·라벨·구절 자막·진행 막대·켄번즈가 원본과 같다).
   그 판을 프레임별 JPG 로 풀어 두고, 촬영 때 같은 프레임 번호를 바탕 <img> 로 깐다 — 유리 카드(backdrop-filter)가
   실제 바탕을 흐린다. 그래서 틀은 제목·자막을 다시 그리지 않는다(이중 표기 방지).
 - 음성은 원본 final.mp4 의 음성 트랙을 그대로 복사한다 — 비교에서 그림만 다르다.

사용:
  python3 render_frames.py job.json --preview N      씬 N(1부터, 그래픽 씬만) 미리보기 PNG 4장 + 자동 검사 결과(JSON)
  python3 render_frames.py job.json --check-all      모든 그래픽 씬 검사 요약(JSON)
  python3 render_frames.py job.json --render         그래픽 씬 촬영(seg_NN.mp4) → 원본 구간과 이어 붙이기(job.out)

조각 규칙(검사로 강제): <script>·외부 주소(http)·@import·<img>/<video>/<iframe>/<link> 금지,
화면 글자는 그 씬의 대본(source)에서만(2-gram 겹침 0.5 미만이면 위반), 그래픽 구역(stage) 밖으로 나가면 위반.
"""
import glob
import html
import json
import os
import re
import subprocess
import sys

W, H = 1080, 1920
FORBIDDEN = [
    (re.compile(r"<\s*script", re.I), "script 금지"),
    (re.compile(r"https?://(?!www\.w3\.org/)", re.I), "외부 주소 금지"),  # SVG 네임스페이스는 허용
    (re.compile(r"@import", re.I), "@import 금지"),
    (re.compile(r"<\s*(img|video|iframe|link|object|embed)\b", re.I), "외부 미디어 태그 금지"),
]


def chromium_exe():
    """설치된 headless shell 중 최신 — 파이썬 playwright 기대 버전과 달라도 실행 가능."""
    c = sorted(glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell")))
    return c[-1] if c else None


def bigrams(s):
    t = re.sub(r"[\s.,!?·…'\"“”‘’()\[\]{}~\-→:;/✕✓①②③④⑤⑥]", "", s or "")
    if len(t) == 1:
        return {t}
    return {t[i:i + 2] for i in range(len(t) - 1)}


def overlap(text, source):
    a = bigrams(text)
    if not a:
        return 1.0
    b = bigrams(source)
    return sum(1 for g in a if g in b) / len(a)


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def static_problems(fragment):
    return [msg for rx, msg in FORBIDDEN if rx.search(fragment)]


def frame_file(sc, f):
    """바탕판 프레임 경로(1부터) — 씬 길이를 넘으면 마지막 프레임."""
    n = max(1, min(sc["frames"], f + 1))
    return os.path.join(sc["bgFrames"], f"{n:04d}.jpg")


def font_css(job):
    fonts = job.get("fonts") or {}
    out = []
    # 우리 Remotion 과 같은 글꼴(Pretendard 700·800). 900 은 800 파일로 맞춘다(합성 굵기 방지).
    for w, key in (("700", "bold"), ("800", "extraBold"), ("900", "extraBold")):
        if fonts.get(key):
            out.append(f"@font-face{{font-family:Pretendard;src:url('file://{fonts[key]}') format('woff2');font-weight:{w};font-style:normal}}")
    return "\n".join(out)


def build_page(job, sc):
    p = job["palette"]
    st = job["stage"]
    dur = sc["frames"] / job["fps"]
    frag_path = os.path.join(job["workDir"], sc["fragment"])
    fragment = read_text(frag_path) if os.path.exists(frag_path) else ""
    if fragment and static_problems(fragment):
        fragment = ""
    bg0 = frame_file(sc, 0)
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{font_css(job)}
:root{{--bg:{p['bg']};--bg2:{p['bg2']};--ink:{p['ink']};--accent:{p['accent']};--accent2:{p['accent2']};--card:{p['card']};--dur:{dur:.3f}s}}
*{{box-sizing:border-box}}
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#000;font-family:Pretendard,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;-webkit-font-smoothing:antialiased;word-break:keep-all}}
#bgf{{position:absolute;inset:0;width:{W}px;height:{H}px}}
#stage{{position:absolute;z-index:2;left:0;top:{st['top']}px;width:{W}px;height:{st['height']}px;animation:stageout .3s ease-in both;animation-delay:calc(var(--dur) - .3s)}}
/* 퇴장은 transform 만 — #stage 에 opacity 애니메이션이 있으면 그게 backdrop root 가 되어 안쪽 유리 카드가 배경을 못 흐린다(B 실측). */
@keyframes stageout{{to{{transform:translateY(-30px) scale(.96)}}}}
</style></head><body>
<img id="bgf" src="file://{html.escape(bg0)}">
<div id="stage">{fragment}</div>
<script>
const FRAMES_DIR = {json.dumps(sc['bgFrames'])}; const NF = {sc['frames']};
window.__seek = async (t) => {{
  for (const a of document.getAnimations()) {{ a.pause(); a.currentTime = t * 1000; }}
  for (const s of document.querySelectorAll('svg')) if (s.pauseAnimations && !s.ownerSVGElement) {{ s.pauseAnimations(); s.setCurrentTime(t); }}
  const n = Math.max(1, Math.min(NF, Math.round(t * {job['fps']}) + 1));
  const img = document.getElementById('bgf');
  const want = 'file://' + FRAMES_DIR + '/' + String(n).padStart(4, '0') + '.jpg';
  if (img.src !== want) {{ img.src = want; try {{ await img.decode(); }} catch (e) {{}} }}
  await document.fonts.ready;
}};
</script></body></html>"""


CHECK_JS = """(args) => {
  const [top, height] = args;
  const out = [];
  const stage = document.getElementById('stage');
  if (!stage) return { problems: out, texts: [] };
  const tol = 10;
  let visible = 0;
  for (const el of stage.querySelectorAll('*')) {
    if (el.tagName === 'STYLE') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    visible++;
    if (el.closest('[data-bleed]')) continue;
    if (r.left < -tol || r.right > 1080 + tol || r.top < top - tol || r.bottom > top + height + tol) {
      out.push(`그래픽 구역 밖: <${el.tagName.toLowerCase()} class="${el.getAttribute('class') || ''}"> (${Math.round(r.left)},${Math.round(r.top)})-(${Math.round(r.right)},${Math.round(r.bottom)})`);
    }
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText && el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible') out.push(`글자 넘침: "${el.textContent.trim().slice(0, 20)}"`);
  }
  if (visible < 2) out.push('그래픽이 비어 있음');
  // 유리 흐림 검사(B 2026-10-01) — backdrop-filter 요소의 상위에 opacity·filter·clip-path(값 또는 애니메이션)가 있으면 흐림이 꺼진다.
  for (const el of stage.querySelectorAll('*')) {
    const ecs = getComputedStyle(el);
    const bf = ecs.backdropFilter || ecs.webkitBackdropFilter;
    if (!bf || bf === 'none') continue;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const anim = a.getAnimations().some(x => { try { return x.effect.getKeyframes().some(k => 'opacity' in k || 'filter' in k || 'clipPath' in k); } catch (e) { return false; } });
      if (anim || parseFloat(cs.opacity) < 1 || (cs.filter && cs.filter !== 'none') || (cs.clipPath && cs.clipPath !== 'none')) {
        out.push(`유리 흐림 꺼짐: <${el.tagName.toLowerCase()} class="${el.getAttribute('class') || ''}"> 의 상위 <${a.tagName.toLowerCase()} ${a.id ? 'id="' + a.id + '"' : 'class="' + (a.getAttribute('class') || '') + '"'}> 에 opacity/filter/clip-path — 등장 효과는 유리 카드 자신에게 건다`);
        break;
      }
    }
  }
  // 유리 통일 검사(B 2026-10-01) — 큰 흰·크림 불투명 카드(알파 0.5 이상, 8만 px² 이상)가 backdrop-filter 없이 있으면 문제.
  for (const el of stage.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const m = /rgba?\\(([^)]+)\\)/.exec(cs.backgroundColor); const parts = m ? m[1].split(',') : [];
    const a = m ? (parts[3] !== undefined ? parseFloat(parts[3]) : 1) : 0;
    if (a < 0.5) continue;
    if (Math.min(...parts.slice(0, 3).map(Number)) < 200) continue;
    const own = cs.backdropFilter || cs.webkitBackdropFilter;
    if (own && own !== 'none') continue;
    let inGlass = false;
    for (let q = el.parentElement; q && q !== stage; q = q.parentElement) { const c = getComputedStyle(q); const b = c.backdropFilter || c.webkitBackdropFilter; if (b && b !== 'none') { inGlass = true; break; } }
    if (inGlass) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 80000) continue;
    out.push(`유리 아님: <${el.tagName.toLowerCase()} class="${el.getAttribute('class') || ''}"> 불투명 카드 ${Math.round(r.width)}×${Math.round(r.height)} — 카드는 유리 스타일(반투명 흰 + backdrop-filter 흐림)로`);
    break;
  }
  const texts = (stage.innerText || '').split(/\\n+/).map(s => s.trim()).filter(s => s.replace(/[\\s\\d.→·✓✔✕+\\-]/g, '').length >= 2);
  return { problems: out, texts };
}"""


def scene_by_number(job, n):
    for sc in job["scenes"]:
        if sc["index"] == n - 1:
            return sc
    raise SystemExit(f"그래픽 씬이 아님: {n} (그래픽 씬: {[s['index'] + 1 for s in job['scenes']]})")


def open_scene(browser, job, sc):
    page_path = os.path.join(job["workDir"], ".pages", f"scene_{sc['index'] + 1:02d}.page.html")
    os.makedirs(os.path.dirname(page_path), exist_ok=True)
    with open(page_path, "w", encoding="utf-8") as f:
        f.write(build_page(job, sc))
    page = browser.new_page(viewport={"width": W, "height": H})
    page.goto("file://" + page_path)
    page.evaluate("document.fonts.ready.then(() => true)")
    return page


def check_scene(browser, job, sc, out_dir=None):
    fps = job["fps"]
    dur = sc["frames"] / fps
    n = sc["index"] + 1
    res = {"scene": n, "ok": True, "problems": [], "previews": []}
    frag_path = os.path.join(job["workDir"], sc["fragment"])
    if not os.path.exists(frag_path):
        res["ok"] = False
        res["problems"].append(f"조각 파일 없음: {sc['fragment']}")
        return res
    res["problems"] += static_problems(read_text(frag_path))
    page = open_scene(browser, job, sc)
    st = job["stage"]
    seen_texts = set()
    for t in [0.3, dur * 0.35, dur * 0.6, max(0.1, dur - 0.45)]:
        page.evaluate("(t) => window.__seek(t)", t)
        r = page.evaluate(CHECK_JS, [st["top"], st["height"]])
        for pr in r["problems"]:
            if pr not in res["problems"]:
                res["problems"].append(pr)
        seen_texts.update(r["texts"])
        if out_dir:
            p = os.path.join(out_dir, f"scene_{n:02d}_t{t:04.1f}.png")
            page.screenshot(path=p)
            res["previews"].append(p)
    for tx in sorted(seen_texts):
        if overlap(tx, sc.get("source", "")) < 0.5:
            res["problems"].append(f"대본 밖 문구: \"{tx}\"")
    page.close()
    res["ok"] = not res["problems"]
    return res


def render_segment(browser, job, sc, out):
    fps = job["fps"]
    tmp = out + ".tmp.mp4"
    ff = subprocess.Popen(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
                           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", "-preset", "veryfast", "-r", str(fps), tmp],
                          stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    page = open_scene(browser, job, sc)
    try:
        for f in range(sc["frames"]):
            page.evaluate("(t) => window.__seek(t)", f / fps)
            ff.stdin.write(page.screenshot(type="jpeg", quality=95))
    finally:
        page.close()
        ff.stdin.close()
        err = ff.stderr.read().decode("utf-8", "replace")[-400:]
        code = ff.wait()
    if code != 0:
        raise RuntimeError(f"ffmpeg 실패: {err}")
    os.replace(tmp, out)


def splice_filter(ranges, seg_inputs):
    """원본 구간 + 그래픽 구간 이어 붙이기 필터(순수). ranges: [{start,frames,graphic}], seg_inputs: {씬 인덱스: 입력 번호}."""
    parts, labels = [], []
    for k, r in enumerate(ranges):
        if r["graphic"]:
            parts.append(f"[{seg_inputs[k]}:v]trim=end_frame={r['frames']},setpts=PTS-STARTPTS,format=yuv420p[v{k}]")
        else:
            parts.append(f"[0:v]trim=start_frame={r['start']}:end_frame={r['start'] + r['frames']},setpts=PTS-STARTPTS,format=yuv420p[v{k}]")
        labels.append(f"[v{k}]")
    return ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(ranges)}:v=1:a=0[v]"


def render(browser, job):
    segs = {}
    for sc in job["scenes"]:
        out = os.path.join(job["workDir"], f"seg_{sc['index'] + 1:02d}.mp4")
        render_segment(browser, job, sc, out)
        segs[sc["index"]] = out
    ranges = job["ranges"]
    ins = ["-i", job["original"]]
    seg_inputs = {}
    for k, r in enumerate(ranges):
        if r["graphic"]:
            seg_inputs[k] = len(ins) // 2
            ins += ["-i", segs[k]]
    out = job["out"]
    tmp = out + ".tmp.mp4"
    # 음성은 원본 트랙 그대로(-c:a copy) — 비교에서 소리·길이가 같아야 그림만 다르다.
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", *ins, "-filter_complex", splice_filter(ranges, seg_inputs),
                    "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium",
                    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
                    "-c:a", "copy", "-movflags", "+faststart", tmp], check=True)
    os.replace(tmp, out)
    frames = sum(r["frames"] for r in ranges)
    return {"ok": True, "out": out, "frames": frames, "seconds": round(frames / job["fps"], 2)}


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    from playwright.sync_api import sync_playwright
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    job.setdefault("workDir", os.path.dirname(os.path.abspath(sys.argv[1])))
    mode = sys.argv[2]
    with sync_playwright() as p:
        exe = chromium_exe()
        browser = p.chromium.launch(**({"executable_path": exe} if exe else {}))
        try:
            if mode == "--preview":
                sc = scene_by_number(job, int(sys.argv[3]))
                out_dir = os.path.join(job["workDir"], "preview")
                os.makedirs(out_dir, exist_ok=True)
                print(json.dumps(check_scene(browser, job, sc, out_dir=out_dir), ensure_ascii=False, indent=1))
            elif mode == "--check-all":
                res = [check_scene(browser, job, sc) for sc in job["scenes"]]
                print(json.dumps({"ok": all(r["ok"] for r in res), "scenes": res}, ensure_ascii=False, indent=1))
            elif mode == "--render":
                print(json.dumps(render(browser, job), ensure_ascii=False))
            else:
                print(__doc__)
                sys.exit(2)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
