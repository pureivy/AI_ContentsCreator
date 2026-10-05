#!/usr/bin/env python3
"""
파일럿 전용 이식(2026-10-05) — Biz_Contents_Creator scripts/mg_direct/styleframe.py 그대로(우리 파일럿은 compose 만 쓴다).

스타일 프레임(모션그래픽 시안) 생성기 — '중요한 장면은 이미지부터 만들고 그 이미지를 모션그래픽으로' (사용자 제안 2026-09-30).

  generate : 시안 1장 — 대본 문구(한국어)·강조 도형·아이콘까지 들어간 완성 디자인(참고본). 글자는 참고용이고 실제 글자는
             촬영기에서 코드로 다시 쓴다(이미지 속 한글 오타 회피).
  plate    : 시안에서 글자·화살표·도형·아이콘만 지운 바탕판 — 같은 구도·조명·색. Claude 가 이 위에 요소를 코드로 재현·애니메이션.
  compose  : 주어진 씬 그림(주제별 디자인으로 이미 만든 배경) 위에 그래픽·글자만 얹은 시안(2026-10-01). 바탕판은 원본 그림
             그대로 쓰므로 plate 단계가 없다 — 배경 톤이 기존 방식과 완전히 같다.

사용:
  python styleframe.py generate --prompt "..." --out frame.png [--size 1024x1536]
  python styleframe.py plate --in frame.png --out plate.png [--size 1024x1536]
  python styleframe.py compose --in scene.png --prompt "..." --out frame.png [--size 1024x1536]
OPENAI_API_KEY 는 환경 변수로만 받는다(로그 비노출). 결과는 한 줄 JSON.
"""
import argparse
import base64
import json
import os
import sys
from pathlib import Path

PLATE_PROMPT = (
    "Remove every piece of text, every letter and number, every arrow, badge, icon, highlight mark, label, "
    "speech bubble outline and graphic overlay from this image. Keep exactly the same scene, camera angle, composition, "
    "objects, lighting and colors. Fill the removed areas naturally with the surrounding background so it looks like a clean "
    "background plate for motion graphics. No text anywhere."
)

COMPOSE_PREFIX = (
    "Keep this illustration exactly as it is — same scene, drawing style, colors, lighting and composition; do not redraw or restyle it. "
    "Only add a clean flat motion-graphics overlay on top of it, as described below. "
)


def save_b64(resp, out: Path) -> None:
    data = resp.data[0]
    b64 = getattr(data, "b64_json", None)
    if not b64:
        raise RuntimeError("이미지 응답에 b64_json 없음")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.png")
    tmp.write_bytes(base64.b64decode(b64))
    os.replace(tmp, out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["generate", "plate", "compose"])
    ap.add_argument("--prompt", default="")
    ap.add_argument("--in", dest="inp", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="1024x1536")
    ap.add_argument("--model", default=os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2"))
    a = ap.parse_args()
    if not os.environ.get("OPENAI_API_KEY"):
        print(json.dumps({"ok": False, "error": "OPENAI_API_KEY 없음"}, ensure_ascii=False))
        return 1
    from openai import OpenAI
    client = OpenAI()
    out = Path(a.out)
    try:
        if a.mode == "generate":
            if not a.prompt.strip():
                raise RuntimeError("--prompt 필요")
            resp = client.images.generate(model=a.model, prompt=a.prompt, size=a.size, n=1, quality="high")
        elif a.mode == "compose":
            src = Path(a.inp)
            if not src.is_file() or not a.prompt.strip():
                raise RuntimeError("--in 과 --prompt 필요")
            with open(src, "rb") as f:
                resp = client.images.edit(model=a.model, image=[f], prompt=COMPOSE_PREFIX + a.prompt, size=a.size, n=1, quality="high")
        else:
            src = Path(a.inp)
            if not src.is_file():
                raise RuntimeError(f"입력 없음: {src}")
            with open(src, "rb") as f:
                resp = client.images.edit(model=a.model, image=[f], prompt=PLATE_PROMPT, size=a.size, n=1)
        save_b64(resp, out)
        print(json.dumps({"ok": True, "out": str(out)}, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)[:300]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
