#!/usr/bin/env python3
"""
파일럿 전용 이식(2026-10-05) — Biz_Contents_Creator scripts/mg_direct/palette.py 그대로. 우리 쪽은 src/orchestrator/shortsDirectMotion.ts(파일럿)만 부른다.

주제 디자인에서 모션그래픽 팔레트 뽑기(2026-10-01) — 색을 고정하지 않고, 그 주제의 씬 그림·제목 캘리에서 자동으로.

배경(사용자 지시 2026-10-01): "수채화 디자인, 씬 이미지는 주제의 내용에 맞게 그때 그때 적절한 디자인과 이미지를 만들어야 해".
기존 방식(주제별 디자인 → 씬 그림 → 캘리 제목) 위에 모션그래픽을 얹을 때, 카드·아이콘 색이 그 주제 그림과 어울리게 한다.

  bg/bg2 : 씬 그림의 밝은 영역·중간 영역 대표색(카드 유리·배경 톤)
  ink    : 가장 어두운 영역을 더 어둡게(글자 — bg 대비 확보)
  accent : 제목 캘리의 가장 채도 높은 색(없으면 그림의 가장 채도 높은 색)
  accent2: accent 와 색상이 떨어진 그림 속 두 번째 색(없으면 ink 계열 중간톤)
  card   : bg 를 흰색 쪽으로 옅게

사용: python palette.py --images a.png b.png ... [--title title.png]  → 한 줄 JSON {"bg":"#..",...}
"""
import argparse
import colorsys
import json
import sys

from PIL import Image


def pixels(path, size=(48, 72)):
    im = Image.open(path).convert("RGBA").resize(size)
    return [(r, g, b) for r, g, b, a in im.getdata() if a > 200]


def lum(c):
    r, g, b = (x / 255 for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def median(cs):
    if not cs:
        return None
    return tuple(sorted(x[k] for x in cs)[len(cs) // 2] for k in range(3))


def mix(c, d, t):
    return tuple(round(c[k] * (1 - t) + d[k] * t) for k in range(3))


def hsv(c):
    return colorsys.rgb_to_hsv(*(x / 255 for x in c))


def hexc(c):
    return "#%02X%02X%02X" % tuple(max(0, min(255, int(x))) for x in c)


def contrast(a, b):
    def rl(c):
        def ch(x):
            x /= 255
            return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
        r, g, b_ = (ch(x) for x in c)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b_
    la, lb = sorted((rl(a), rl(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def saturated(cs, min_s=0.35, min_v=0.35):
    return [c for c in cs if hsv(c)[1] >= min_s and hsv(c)[2] >= min_v]


def hue_dist(a, b):
    d = abs(hsv(a)[0] - hsv(b)[0])
    return min(d, 1 - d) * 360


def derive(images, title=None):
    px = [p for im in images for p in pixels(im)]
    if not px:
        raise RuntimeError("그림 없음")
    by_l = sorted(px, key=lum)
    n = len(by_l)
    light = by_l[int(n * 0.70):]
    mid = by_l[int(n * 0.40):int(n * 0.70)]
    dark = by_l[: max(1, int(n * 0.05))]
    bg = mix(median(light), (255, 255, 255), 0.35)
    bg2 = mix(median(mid), (255, 255, 255), 0.30)
    ink = mix(median(dark), (0, 0, 0), 0.45)
    while contrast(ink, bg) < 8 and lum(ink) > 0.02:
        ink = mix(ink, (0, 0, 0), 0.2)
    accent = None
    if title:
        ts = saturated(pixels(title, (160, 52)), 0.45, 0.45)
        if len(ts) >= 20:
            accent = median(sorted(ts, key=lambda c: -hsv(c)[1])[: max(20, len(ts) // 3)])
    sat = sorted(saturated(px, 0.25, 0.30), key=lambda c: -hsv(c)[1])
    if accent is None:
        accent = median(sat[: max(1, len(sat) // 5)]) if sat else (232, 96, 76)
    far = [c for c in sat if hue_dist(c, accent) >= 45]
    if len(far) >= max(10, len(sat) // 20):
        accent2 = median(far[: max(1, len(far) // 3)])
        h, s, v = hsv(accent2)
        accent2 = tuple(round(x * 255) for x in colorsys.hsv_to_rgb(h, max(s, 0.35), min(max(v, 0.45), 0.7)))
    else:
        accent2 = mix(ink, bg2, 0.45)  # 그림이 한 색 계열이면 먹색 중간톤(푸른 보조색이 튀지 않게)
    card = mix(bg, (255, 255, 255), 0.65)
    # 밝은 노랑 캘리 등 — 크림 카드 위 강조선·글자가 묻히지 않게 색상은 두고 명도만 낮춘다.
    for _ in range(12):
        if contrast(accent, card) >= 2.6:
            break
        accent = mix(accent, (0, 0, 0), 0.08)
    return {"bg": hexc(bg), "bg2": hexc(bg2), "ink": hexc(ink), "accent": hexc(accent), "accent2": hexc(accent2), "card": hexc(card)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", nargs="+", required=True)
    ap.add_argument("--title", default="")
    a = ap.parse_args()
    try:
        print(json.dumps({"ok": True, "palette": derive(a.images, a.title or None)}, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)[:300]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
