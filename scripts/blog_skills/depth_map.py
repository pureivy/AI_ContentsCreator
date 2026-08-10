"""쇼츠 씬 2.5D 패럴랙스 — 깊이맵 추정 + 전경 알파 레이어 생성 (로컬 무과금).

사용: depth_map.py <inputs.json> <out_dir>
  inputs.json = {"images": ["/abs/scene_01.png", null, ...]}  (null = 대상 아님)
  out_dir 에 depth_NN.png(디버그)·fg_NN.png(전경 RGBA)·manifest.json 생성.

모델: Depth Anything V2 Small **F16 Core ML** (Apache-2.0 — Base/Large 는 CC-BY-NC 비상업이라 금지).
Core ML(coremltools)이라 torch 불필요 — venv 오염 없음. 모델은 ~/.cache/aicc_depth/ 캐시,
없으면 HF 고정 URL 에서 1회 자동 다운로드(~50MB). 실패 시 비정상 종료 → TS 쪽 fail-open(켄번즈 유지).

실패 게이트(씬별, manifest 에 사유 기록):
  - range(p95-p5) < 0.15  → 평면(문서·단색) — 분리 무의미
  - fg_coverage 8%~70% 밖 → 클로즈업/역전 — 분리 무의미
"""
import io
import json
import pathlib
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageFilter

MODEL_DIR = pathlib.Path.home() / '.cache' / 'aicc_depth' / 'DepthAnythingV2SmallF16.mlpackage'
HF_BASE = ('https://huggingface.co/apple/coreml-depth-anything-v2-small/resolve/main/'
           'DepthAnythingV2SmallF16.mlpackage/')
MODEL_FILES = ['Manifest.json', 'Data/com.apple.CoreML/model.mlmodel', 'Data/com.apple.CoreML/weights/weight.bin']

RANGE_MIN = 0.15
COV_MIN, COV_MAX = 0.08, 0.70
# 절대 임계(정규화 깊이 0..1에서 0.55 이상 = 근경) — 분위 임계는 정의상 커버리지가 상수가 되어
# 클로즈업(전부 근경) 게이트가 무력화된다. 절대 임계라야 coverage 가 장면 의존 신호가 된다.
FG_THR = 0.55
FEATHER_PX = 8       # 마스크 경계 페더(고스트 완화)


def ensure_model() -> None:
    if (MODEL_DIR / 'Data/com.apple.CoreML/weights/weight.bin').exists():
        return
    print('모델 캐시 없음 — HF 다운로드(1회, ~50MB)', flush=True)
    for rel in MODEL_FILES:
        dst = MODEL_DIR / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(HF_BASE + rel, dst)
    size = (MODEL_DIR / 'Data/com.apple.CoreML/weights/weight.bin').stat().st_size
    if size < 10_000_000:  # 다운로드 실패 페이지 등 방어
        raise RuntimeError(f'weight.bin 크기 이상({size}B)')


def load_model():
    import coremltools as ct  # 지연 임포트 — 미설치 시 명확한 에러로 종료(TS fail-open)
    model = ct.models.MLModel(str(MODEL_DIR))
    desc = model.get_spec().description
    inp = desc.input[0]
    w, h = inp.type.imageType.width, inp.type.imageType.height
    return model, inp.name, int(w), int(h), desc.output[0].name


def predict_depth(model, in_name: str, in_w: int, in_h: int, out_name: str, img: Image.Image) -> np.ndarray:
    resized = img.convert('RGB').resize((in_w, in_h), Image.BILINEAR)
    out = model.predict({in_name: resized})[out_name]
    if isinstance(out, Image.Image):
        arr = np.array(out, dtype=np.float32)
    else:
        arr = np.asarray(out, dtype=np.float32).squeeze()
    lo, hi = float(arr.min()), float(arr.max())
    return (arr - lo) / (hi - lo) if hi > lo else np.zeros_like(arr)


def main() -> int:
    inputs_path, out_dir = sys.argv[1], pathlib.Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    images = json.loads(pathlib.Path(inputs_path).read_text('utf-8'))['images']
    ensure_model()
    model, in_name, in_w, in_h, out_name = load_model()
    scenes = []
    for i, p in enumerate(images):
        nn = f'{i + 1:02d}'
        if not p or not pathlib.Path(p).exists():
            scenes.append({'index': i, 'ok': False, 'reason': 'no-image'})
            continue
        try:
            img = Image.open(p)
            # DA-V2 출력은 disparity(클수록 가까움) — 정규화 0..1 에서 1 = 근경.
            depth = predict_depth(model, in_name, in_w, in_h, out_name, img)
            p5, p95 = float(np.percentile(depth, 5)), float(np.percentile(depth, 95))
            rng = p95 - p5
            mask = (depth >= FG_THR).astype(np.float32)
            cov = float(mask.mean())
            stats = {'range': round(rng, 4), 'coverage': round(cov, 4)}
            if rng < RANGE_MIN:
                scenes.append({'index': i, 'ok': False, 'reason': 'flat', 'stats': stats})
                continue
            if not (COV_MIN <= cov <= COV_MAX):
                scenes.append({'index': i, 'ok': False, 'reason': 'coverage', 'stats': stats})
                continue
            # 디버그 깊이맵(모델 해상도) + 전경 RGBA(원본 해상도, 페더 마스크)
            Image.fromarray((depth * 255).astype(np.uint8)).save(out_dir / f'depth_{nn}.png')
            m = Image.fromarray((mask * 255).astype(np.uint8)).resize(img.size, Image.BILINEAR)
            m = m.filter(ImageFilter.GaussianBlur(FEATHER_PX))
            fg = img.convert('RGBA')
            fg.putalpha(m)
            buf = io.BytesIO()
            fg.save(buf, format='PNG')
            (out_dir / f'fg_{nn}.png').write_bytes(buf.getvalue())
            scenes.append({'index': i, 'ok': True, 'stats': stats})
        except Exception as e:  # 씬별 fail-open — 한 씬 실패가 전체를 막지 않게
            scenes.append({'index': i, 'ok': False, 'reason': f'error: {e}'[:120]})
    (out_dir / 'manifest.json').write_text(json.dumps({'scenes': scenes}, ensure_ascii=False), 'utf-8')
    print(json.dumps({'ok': True, 'done': sum(1 for s in scenes if s['ok']), 'total': len(images)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
