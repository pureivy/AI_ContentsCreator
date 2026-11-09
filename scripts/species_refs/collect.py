"""수종 사전 검토·정답 사진용 사진 모으기(2026-11-09) — 위키미디어 공용(자유 이용 라이선스만) + 우리 보관소 실촬영.

사용: python3 collect.py <species2.json> <media index.json> <out_dir>
수종마다 <out_dir>/<id>/ 에 사진과 sources.json(제목·라이선스·작가·원본 주소)을 남긴다. 이미 있으면 건너뛴다.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

UA = "bionditree-species-refs/1.0 (plant reference photos for internal image QA)"
API = "https://commons.wikimedia.org/w/api.php"
FREE = re.compile(r"^(cc0|public domain|pd|cc by(-sa)? [0-9.]+|cc by(-sa)?)", re.I)
JUNK = re.compile(r"book|catalog|page|stamp|map|diagram|drawing|illustration|plate|specimen|herbarium|scan|\(\d{4}\)|\.png$", re.I)
ROLES = [("leaf", "leaves", re.compile(r"lea(f|ves)|foliage|blatt|잎", re.I)),
         ("flower", "flowers", re.compile(r"flower|blossom|bloom|inflorescence|blüte|꽃", re.I)),
         ("fruit", "fruit", re.compile(r"fruit|berr|seed|nut|cone|frucht|열매", re.I)),
         ("habit", "tree", re.compile(r"tree|habit|shrub|vine|plant|whole|baum", re.I))]


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def search(q, limit=12):
    params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": "6", "gsrlimit": str(limit),
              "gsrsearch": f"filetype:bitmap {q}", "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": "640"}
    for attempt in range(3):
        try:
            d = json.loads(get(API + "?" + urllib.parse.urlencode(params)))
            break
        except Exception:  # noqa: BLE001
            time.sleep(3 * (attempt + 1))
    else:
        return []
    out = []
    for p in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        m = ii.get("extmetadata", {})
        lic = re.sub("<[^>]+>", "", m.get("LicenseShortName", {}).get("value", "")).strip()
        if not FREE.match(lic) or ii.get("mime") not in ("image/jpeg", "image/png") or JUNK.search(p["title"]):
            continue
        out.append({"title": p["title"], "license": lic, "artist": re.sub("<[^>]+>", "", m.get("Artist", {}).get("value", "")).strip()[:120],
                    "page": ii.get("descriptionurl", ""), "thumb": ii.get("thumburl", ""), "index": p.get("index", 99)})
    return sorted(out, key=lambda x: x["index"])


def collect_commons(latin, d):
    picked, seen = [], set()
    general = search(f'"{latin}"', 20)
    for role, word, rx in ROLES:
        want = 2 if role == "leaf" else 1
        cands = [c for c in search(f'"{latin}" {word}', 10) + general if rx.search(c["title"]) and c["title"] not in seen]
        if role == "habit" and not cands:
            cands = [c for c in general if c["title"] not in seen]
        for c in cands[:want]:
            seen.add(c["title"])
            picked.append({**c, "role": role})
    for i, c in enumerate(picked):
        fn = f"c{i + 1}_{c['role']}.jpg"
        try:
            open(os.path.join(d, fn), "wb").write(get(c["thumb"]))
            c["file"] = fn
        except Exception as e:  # noqa: BLE001
            c["error"] = str(e)[:80]
        time.sleep(0.3)
    return [c for c in picked if c.get("file")]


def collect_archive(name, media, d):
    items = [m for m in media if m.get("species") == name and os.path.exists(m["file"])]
    imgs = [m for m in items if m["kind"] == "image"][:1]
    vids = [m for m in items if m["kind"] == "video"][: 2 - len(imgs)]
    out = []
    for i, m in enumerate(imgs + vids):
        fn = f"a{i + 1}.jpg"
        p = os.path.join(d, fn)
        if m["kind"] == "image":
            r = subprocess.run(["sips", "-Z", "800", "-s", "format", "jpeg", m["file"], "--out", p], capture_output=True)
        else:
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "2", "-i", m["file"], "-frames:v", "1", "-vf", "scale=800:-2", p], capture_output=True)
        if r.returncode == 0 and os.path.exists(p):
            out.append({"file": fn, "source": "보관소 실촬영", "media": m["id"], "tags": m.get("tags", [])})
    return out


def main():
    species = json.load(open(sys.argv[1]))
    media = json.load(open(sys.argv[2]))
    root = sys.argv[3]
    for sp in species:
        d = os.path.join(root, sp["id"])
        if os.path.exists(os.path.join(d, "sources.json")):
            continue
        os.makedirs(d, exist_ok=True)
        commons = collect_commons(sp["latin"], d) if sp.get("latin") else []
        archive = collect_archive(sp["name"], media, d)
        json.dump({"name": sp["name"], "latin": sp.get("latin"), "commons": commons, "archive": archive},
                  open(os.path.join(d, "sources.json"), "w"), ensure_ascii=False, indent=1)
        print(f"{sp['name']}: 공용 {len(commons)} · 보관소 {len(archive)}", flush=True)


if __name__ == "__main__":
    main()
