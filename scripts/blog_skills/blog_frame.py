#!/usr/bin/env python3
"""
블로그 실촬영 컷(2026-10-02 사장님 결정) — 보관소 영상의 한 순간을 사진처럼 떼어 낸다.

왜 필요한가. 네이버 2026-07-06 스팸 공지가 '실제로 오인될 수 있는 생성 이미지'를 위험 신호로 적었고,
상위 노출 농원 글은 현장 사진을 쓴다. 그래서 글마다 한 장은 우리 밭에서 찍은 영상의 프레임으로 넣는다.

무엇을 안 하는가. AI 로 다시 그리지 않는다 — 다시 그리면 그게 곧 생성 이미지다. 보정은 '필터처럼 보이지 않게'
가볍게만 한다(약한 자동 대비·채도/대비 소폭·언샤프). 결과가 원본 영상에서 바로 뗀 사진처럼 보여야 한다.

사용:
  python blog_frame.py --video <파일> --at <초> --out <png>        # 주변 ±0.4초 5프레임 중 가장 선명한 것
  python blog_frame.py --video <파일> --at <초> --out <png> --exact # 그 순간 그대로(같은 글의 리비전 재현)
  python blog_frame.py --image <파일> --out <png>                    # 보관소 사진

계약: 마지막 줄에 `RESULT_JSON: {...}` — ok, atSec(실제 뗀 순간), sharpness, brightness, hash(dHash 64비트 hex),
sig(화면 서명 — 24x32 회색조 base64), reason(거절 사유). 품질 거절은 exit 0 + ok:false(TS 가 다음 후보로 넘어간다), 실행 오류는 exit 1.
"""
import argparse
import base64
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

try:
    import numpy as np
except Exception:  # noqa: BLE001 — numpy 가 없으면 선명도는 Pillow 엣지 필터로 잰다
    np = None

OUT_W, OUT_H = 1080, 1440  # 3:4 세로 — 휴대폰 세로 영상(1080x1920)의 가운데를 자른다

# 품질 문턱 — 보관소 영상 실측으로 잡았다(scratch 보정 기록 참조). 밝기 평균은 0~255.
MIN_BRIGHT, MAX_BRIGHT = 45.0, 215.0
MAX_DARK_FRAC = 0.45   # 10 이하 화소 비율 — 넘으면 그늘에 묻힌 화면
MAX_BLOWN_FRAC = 0.20  # 250 이상 화소 비율 — 넘으면 하늘·역광으로 하얗게 날아간 화면
MIN_SHARP = 20.0       # 540px 폭 라플라시안 분산 — 미만이면 흔들림·초점 실패


def result(payload: dict) -> None:
    print("RESULT_JSON: " + json.dumps(payload, ensure_ascii=False), flush=True)


def gray_small(im: Image.Image, width: int = 540) -> Image.Image:
    g = im.convert("L")
    h = max(1, round(g.height * width / g.width))
    return g.resize((width, h), Image.BILINEAR)


def sharpness(im: Image.Image) -> float:
    g = gray_small(im)
    if np is not None:
        a = np.asarray(g, dtype=np.float32)
        lap = -4 * a[1:-1, 1:-1] + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:]
        return float(lap.var())
    e = g.filter(ImageFilter.FIND_EDGES)
    px = list(e.tobytes())
    m = sum(px) / len(px)
    return float(sum((p - m) ** 2 for p in px) / len(px))


def exposure(im: Image.Image) -> tuple[float, float, float]:
    g = gray_small(im, 270)
    hist = g.histogram()
    n = sum(hist) or 1
    mean = sum(i * c for i, c in enumerate(hist)) / n
    dark = sum(hist[:11]) / n
    blown = sum(hist[250:]) / n
    return mean, dark, blown


def quality_reason(im: Image.Image, sharp: float) -> str:
    mean, dark, blown = exposure(im)
    if mean < MIN_BRIGHT or dark > MAX_DARK_FRAC:
        return f"too_dark(mean={mean:.0f},dark={dark:.2f})"
    if mean > MAX_BRIGHT or blown > MAX_BLOWN_FRAC:
        return f"blown(mean={mean:.0f},blown={blown:.2f})"
    if sharp < MIN_SHARP:
        return f"blurry(sharp={sharp:.1f})"
    return ""


def dhash(im: Image.Image) -> str:
    """64비트 차분 해시 — 같은 화면을 다른 글에 다시 쓰지 않으려고 쓴다(TS 가 해밍 거리로 비교)."""
    g = im.convert("L").resize((9, 8), Image.LANCZOS)
    px = list(g.tobytes())
    bits = 0
    for y in range(8):
        for x in range(8):
            bits = (bits << 1) | (1 if px[y * 9 + x] < px[y * 9 + x + 1] else 0)
    return f"{bits:016x}"


SIG_W, SIG_H = 24, 32  # 화면 서명 크기(3:4) — TS(blogFrames.signatureSimilarity)가 같은 크기로 읽는다


def signature(im: Image.Image) -> str:
    """화면 서명 — 흐린 24x32 회색조 썸네일(768바이트, base64). '같은 사진처럼 보이는가'를 TS 가 잰다.

    dHash 만으로는 못 가른다(2026-10-02 보관소 실측): 같은 나무를 조금 돌아 찍은 두 프레임이 해밍 거리 26까지
    벌어지는데, 서로 다른 수종 두 영상이 24까지 붙는다(잎·줄기·흙의 명암 배치가 비슷하다). 서명은 흐리게 줄인 뒤
    ±3칸(약 12%) 밀어 보며 상관을 재므로 카메라가 조금 움직인 같은 장면을 같은 것으로 잡는다."""
    small = im.convert("RGB").resize((90, 120), Image.LANCZOS)
    g = small.filter(ImageFilter.GaussianBlur(1.0)).resize((SIG_W, SIG_H), Image.BOX).convert("L")
    return base64.b64encode(g.tobytes()).decode("ascii")


def crop_3x4(im: Image.Image) -> Image.Image:
    w, h = im.size
    target = OUT_W / OUT_H
    if w / h > target:  # 가로가 넓다 — 좌우를 자른다
        nw = round(h * target)
        left = (w - nw) // 2
        im = im.crop((left, 0, left + nw, h))
    else:               # 세로가 길다 — 위아래를 자른다(가운데)
        nh = round(w / target)
        top = (h - nh) // 2
        im = im.crop((0, top, w, top + nh))
    return im.resize((OUT_W, OUT_H), Image.LANCZOS)


def enhance(im: Image.Image) -> Image.Image:
    """사진처럼 — 필터처럼이 아니라. 모든 값을 '눈에 띄지 않을 만큼'에 묶었다."""
    im = crop_3x4(im.convert("RGB"))
    auto = ImageOps.autocontrast(im, cutoff=0.5)
    im = Image.blend(im, auto, 0.6)                      # 자동 대비를 60%만 — 끝까지 펴면 HDR 처럼 보인다
    im = ImageEnhance.Color(im).enhance(1.06)
    im = ImageEnhance.Contrast(im).enhance(1.04)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=3))
    return im


def extract_frames(video: str, at: float, exact: bool, tmp: Path) -> list[tuple[float, Path]]:
    """ffmpeg 가 회전 메타데이터를 반영(autorotate)해 세로 프레임을 낸다.

    한 번의 호출로 at±0.5초를 0.1초 간격(10장)으로 뗀다 — 이웃 프레임과의 차이로 '카메라가 얼마나
    움직이던 순간인지'를 재기 위해서다. 보관소 영상 대부분이 카톡 전송본(30fps·3Mbps)이라 움직이는 순간은
    압축 뭉개짐과 흔들림이 같이 온다(백일홍 실측). exact 는 그 순간 한 장만(리비전 재현용).
    """
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    if exact:
        p = tmp / "f00.png"
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{max(0.0, at):.3f}", "-i", video,
               "-frames:v", "1", str(p)]
        r = subprocess.run(cmd, capture_output=True, timeout=60)
        return [(round(at, 2), p)] if r.returncode == 0 and p.exists() and p.stat().st_size > 0 else []
    start = max(0.0, at - 0.5)
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-i", video,
           "-t", "1.0", "-vf", "fps=10", "-frames:v", "10", str(tmp / "f%02d.png")]
    subprocess.run(cmd, capture_output=True, timeout=90)
    files = sorted(tmp.glob("f*.png"))
    return [(round(start + k * 0.1, 2), p) for k, p in enumerate(files) if p.stat().st_size > 0]


def motion(a: Image.Image, b: Image.Image) -> float:
    """두 프레임의 평균 절대 차(0~255, 270px 회색조) — 클수록 카메라·가지가 움직이던 순간."""
    ga, gb = gray_small(a, 270), gray_small(b, 270)
    if np is not None:
        return float(np.abs(np.asarray(ga, dtype=np.float32) - np.asarray(gb, dtype=np.float32)).mean())
    pa, pb = list(ga.tobytes()), list(gb.tobytes())
    return sum(abs(x - y) for x, y in zip(pa, pb)) / max(1, len(pa))


def pick_best(frames: list[tuple[float, Image.Image]]) -> tuple[tuple[float, float, Image.Image] | None, list[str]]:
    """노출·선명도를 통과한 프레임 중 '덜 움직이던 절반'에서 가장 선명한 것.

    선명도(라플라시안 분산)만 보면 압축 블록·흔들림 잔물결도 높은 값으로 잡힌다 — 움직임으로 먼저 거른다."""
    n = len(frames)
    mot = []
    for i in range(n):
        ds = []
        if i > 0:
            ds.append(motion(frames[i - 1][1], frames[i][1]))
        if i + 1 < n:
            ds.append(motion(frames[i][1], frames[i + 1][1]))
        mot.append(sum(ds) / len(ds) if ds else 0.0)
    ok, reasons = [], []
    for i, (t, im) in enumerate(frames):
        s = sharpness(im)
        why = quality_reason(im, s)
        if why:
            reasons.append(why)
        else:
            ok.append((t, s, im, mot[i]))
    if not ok:
        return None, reasons
    cut = sorted(x[3] for x in ok)[(len(ok) - 1) // 2]  # 움직임 중앙값(이하만 남긴다)
    calm = [x for x in ok if x[3] <= cut]
    t, s, im, _ = max(calm, key=lambda x: x[1])
    return (t, s, im), reasons


def main() -> int:
    ap = argparse.ArgumentParser(description="블로그 실촬영 컷 — 보관소 영상 프레임/사진 → 사진 같은 PNG")
    ap.add_argument("--video", default="")
    ap.add_argument("--image", default="")
    ap.add_argument("--at", type=float, default=0.0)
    ap.add_argument("--exact", action="store_true")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        if args.image:
            with Image.open(args.image) as src:
                src = ImageOps.exif_transpose(src).convert("RGB")
                sharp = sharpness(src)
                reason = quality_reason(src, sharp)
                if reason:
                    result({"ok": False, "reason": reason, "sharpness": round(sharp, 1)})
                    return 0
                im = enhance(src)
            im.save(out, format="PNG", optimize=True)
            mean, _, _ = exposure(im)
            result({"ok": True, "atSec": 0, "sharpness": round(sharp, 1), "brightness": round(mean, 1),
                    "hash": dhash(im), "sig": signature(im), "file": str(out.resolve())})
            return 0

        if not args.video or not Path(args.video).is_file():
            result({"ok": False, "reason": "no_input"})
            return 1
        with tempfile.TemporaryDirectory(prefix="blogframe-") as td:
            frames = extract_frames(args.video, args.at, args.exact, Path(td))
            if not frames:
                result({"ok": False, "reason": "extract_failed"})
                return 1
            loaded = []
            for t, p in frames:
                with Image.open(p) as fr:
                    loaded.append((t, fr.convert("RGB")))
            best, reasons = pick_best(loaded)
            if best is None:
                # 가장 많이 나온 사유를 남긴다 — 로그에서 '왜 그 구간을 버렸는지'가 보이게.
                kinds = [r.split("(")[0] for r in reasons]
                top = max(set(kinds), key=kinds.count)
                result({"ok": False, "reason": top, "detail": reasons[:5]})
                return 0
            t, s, fr = best
            im = enhance(fr)
            im.save(out, format="PNG", optimize=True)
            mean, _, _ = exposure(im)
            result({"ok": True, "atSec": t, "sharpness": round(s, 1), "brightness": round(mean, 1),
                    "hash": dhash(im), "sig": signature(im), "file": str(out.resolve())})
            return 0
    except Exception as e:  # noqa: BLE001
        result({"ok": False, "reason": f"error:{str(e)[:120]}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
