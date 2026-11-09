"""수종 정답 사진 폴더 만들기(2026-11-09 사장님 "도감 사진 참조 의견대로").

검토용으로 모은 사진(collect.py 결과)과 사진 대조 판정(judge 결과)에서, 그림 검수가 옆에 놓고 비교할 정답 사진만 고른다.
- 보관소 실촬영: 우리 사진 — 라이선스 문제 없음. 대조에서 이 종이 아니라고 걸린 사진은 뺀다.
- 위키미디어 공용: 자유 이용 라이선스. 사진마다 use 를 단다 —
  "any"(CC0·퍼블릭 도메인·CC BY: 검수·그리기 보조 모두) / "qa"(CC BY-SA: 검수 비교에만 — 내부 비교라 배포·변형물이 아니다.
  그리기 참조로 넣으면 결과물이 변형물로 볼 여지가 있어 쓰지 않는다).
  대조에서 이 종이 아니라고(또는 잎이 아니라고) 걸린 사진은 뺀다.
- 수종마다 잎 2장·꽃 1장·열매 1장·수형 1장·보관소 1장까지. 자료실 업로드·손으로 넣은 사진('added')은 유지한다. 출처·라이선스·작가를 refs.json 에 남긴다.

사용: python3 build.py <검토 사진 폴더 refs/> <판정 폴더 results/> <출력 data/species-refs>
읽는 쪽: src/content/species.ts speciesRefPhotos(학명).
"""
import json
import os
import re
import shutil
import subprocess
import sys

REUSE = re.compile(r"^(cc0|public domain|pd\b|pd-|cc by [0-9.]+$|cc by$)", re.I)
CAP = {"leaf": 2, "flower": 1, "fruit": 1, "habit": 1, "archive": 1}  # 꽃·열매도(2026-11-09 사장님)


def main() -> int:
    refs, results, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    summary = []
    for sid in sorted(os.listdir(refs)):
        src_path = os.path.join(refs, sid, "sources.json")
        if sid.startswith("_") or not os.path.exists(src_path):
            continue
        src = json.load(open(src_path))
        res_path = os.path.join(results, f"{sid}.json")
        bad = set()
        if os.path.exists(res_path):
            for b in json.load(open(res_path)).get("badPhotos") or []:
                try:
                    bad.add(int(b.get("n")))
                except (TypeError, ValueError):
                    pass
        # 판정 때 순번 = 공용 사진 다음 보관소 사진(judge.mts 와 같은 순서, 파일이 있는 것만)
        listed = [("commons", c) for c in src.get("commons", []) if os.path.exists(os.path.join(refs, sid, c.get("file", "")))]
        listed += [("archive", a) for a in src.get("archive", []) if os.path.exists(os.path.join(refs, sid, a.get("file", "")))]
        keep, count = [], {}
        for n, (kind, x) in enumerate(listed, start=1):
            if n in bad:
                continue
            role = "archive" if kind == "archive" else x.get("role")
            if role not in CAP or count.get(role, 0) >= CAP[role]:
                continue
            use = "any" if kind == "archive" or REUSE.match(x.get("license", "")) else "qa"
            count[role] = count.get(role, 0) + 1
            keep.append({"file": x["file"], "role": role, "use": use, "source": "보관소 실촬영" if kind == "archive" else "위키미디어 공용",
                         **({"media": x.get("media"), "tags": x.get("tags") or []} if kind == "archive" else
                            {"title": x.get("title"), "license": x.get("license"), "artist": x.get("artist"), "page": x.get("page")})})
        d = os.path.join(out, sid)
        # 자료실 업로드(speciesRefsArchive, m_*.jpg)·손으로 넣은 사진('added' 가 있는 항목)은 유지한다 — 이 스크립트가 만든 것만 다시 만든다.
        old = []
        try:
            old = json.load(open(os.path.join(d, "refs.json"))).get("photos", [])
        except (OSError, ValueError):
            pass
        kept_old = [p for p in old if p.get("added") and os.path.exists(os.path.join(d, p.get("file", "")))]
        final = kept_old + [k for k in keep if k["file"] not in {p["file"] for p in kept_old}]
        stale = [p.get("file", "") for p in old if p.get("file") not in {f["file"] for f in final}]
        for f in stale:  # 밀려난 파일은 휴지통으로(rm 금지)
            fp = os.path.join(d, f)
            if f and os.path.exists(fp) and subprocess.run(["trash", fp]).returncode != 0:
                print(f"멈춤: {fp} 를 휴지통으로 옮기지 못했습니다", file=sys.stderr)
                return 1
        if final:
            os.makedirs(d, exist_ok=True)
            for k in keep:
                if k in final:
                    shutil.copyfile(os.path.join(refs, sid, k["file"]), os.path.join(d, k["file"]))
            json.dump({"name": src.get("name"), "latin": src.get("latin"), "photos": final}, open(os.path.join(d, "refs.json"), "w"),
                      ensure_ascii=False, indent=1)
        summary.append((src.get("name"), count.get("leaf", 0), count.get("flower", 0), count.get("fruit", 0), count.get("habit", 0), count.get("archive", 0) + sum(1 for p in kept_old if p.get("role") == "archive")))
    for name, l, fl, fr, h, a in summary:
        print(f"{name}: 잎 {l} · 꽃 {fl} · 열매 {fr} · 수형 {h} · 농원 {a}")
    print(f"끝 — {sum(1 for s in summary if sum(s[1:]))}/{len(summary)}종에 정답 사진 · 잎 {sum(1 for s in summary if s[1])}종 · 꽃 {sum(1 for s in summary if s[2])}종 · 열매 {sum(1 for s in summary if s[3])}종")
    return 0


if __name__ == "__main__":
    sys.exit(main())
