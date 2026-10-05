#!/usr/bin/env python3
"""유튜브 쇼츠 커버가 '첫 장면(디자인 썸네일)'인지 판정한다(2026-10-05).

왜 필요한가. 비공개로 올린 뒤 공개로 바꾸던 시절(~10-04) 우리 쇼츠는 유튜브가 커버(oardefault)를 영상 **중간 장면**으로
골라, 사장님이 업로드 직후마다 앱에서 손으로 맨 앞 프레임으로 고쳤다. 처음부터 공개로 올리는 ok_asis1 채널은
커버(sardefault)가 첫 장면으로 나온다. 종전 확인은 이미지 '크기'만 봐서 중간 장면이 붙어도 통과했다 —
이 스크립트는 커버가 어느 장면인지 그림으로 비교한다.

비교: 커버 vs frame0(영상 첫 프레임) 과 커버 vs oar2(중간 프레임) 의 정규화 상관. 첫 프레임 쪽이 크면 first.
인증 불필요(i.ytimg 공개 이미지). 결과는 마지막 줄 RESULT_JSON 하나.
"""
import argparse
import io
import json
import time
import urllib.request

from PIL import Image

PLACEHOLDER_MAX = 2000  # 회색 자리표시는 1,097바이트(2026-08-31 실측)


def fetch(video_id: str, name: str):
    url = f"https://i.ytimg.com/vi/{video_id}/{name}.jpg?t={int(time.time())}"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            b = r.read()
    except Exception:
        return None
    if len(b) < PLACEHOLDER_MAX:
        return None
    try:
        return Image.open(io.BytesIO(b)).convert("L")
    except Exception:
        return None


def vec(im: Image.Image):
    w, h = im.size
    if w > h:  # 가로 레터박스 이미지면 가운데 세로(9:16) 영역만
        cw = int(h * 9 / 16)
        im = im.crop(((w - cw) // 2, 0, (w + cw) // 2, h))
    px = list(im.resize((18, 32)).tobytes())  # "L" 모드라 바이트 하나가 픽셀 하나
    n = len(px)
    m = sum(px) / n
    sd = (sum((p - m) ** 2 for p in px) / n) ** 0.5 or 1.0
    return [(p - m) / sd for p in px]


def corr(a, b) -> float:
    return sum(x * y for x, y in zip(a, b)) / len(a)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video-id", required=True)
    args = ap.parse_args()
    vid = args.video_id
    out = {"videoId": vid, "state": "missing", "cover": None}
    # 공개 업로드는 sardefault, 비공개→공개 전환은 oardefault 에 커버가 생긴다(2026-10-05 두 채널 실측) — 있는 쪽을 본다.
    cover, cover_name = None, None
    for name in ("sardefault", "oardefault"):
        cover = fetch(vid, name)
        if cover is not None:
            cover_name = name
            break
    first, mid = fetch(vid, "frame0"), fetch(vid, "oar2")
    if cover is None:
        print("RESULT_JSON: " + json.dumps(out, ensure_ascii=False))
        return 0
    out["cover"] = cover_name
    if first is None or mid is None:
        out["state"] = "unknown"
        print("RESULT_JSON: " + json.dumps(out, ensure_ascii=False))
        return 0
    c = vec(cover)
    s_first, s_mid = corr(c, vec(first)), corr(c, vec(mid))
    out.update(state="first" if s_first >= s_mid else "middle", simFirst=round(s_first, 3), simMid=round(s_mid, 3))
    print("RESULT_JSON: " + json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
