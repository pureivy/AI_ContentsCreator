"""
네이버 클립 업로드 — 클립 크리에이터 PC웹(clipcreators.naver.com/web/upload)을 Playwright 로 조작한다.

클립엔 공개 업로드 API 가 없다(2026-10-02 정찰). 블로그 발행(naver_publish.py)과 같은 영속 프로필
(NAVER_PROFILE_DIR)을 써서 로그인 상태를 재사용한다. 사람이 누른 버튼에서만 불린다(서버 라우트가 관문).

화면 사실(정찰 2026-10-02):
- 파일을 넣는 순간 서버 업로드가 시작되고 초안(vod-drafts)이 자동으로 생긴다. 초안 설명 기본값 = 파일명.
- 제목 칸은 없다. 설명 textarea[name=description](필수, 300자).
- 커버(필수) — input[type=file][accept*=image] 로 직접 올릴 수 있다. 없으면 프레임 후보 첫 장이 선택돼 있다.
- 카테고리(필수) — '1차 카테고리' / '2차 카테고리' 드롭다운 버튼.
- 토글은 button[role=switch][aria-checked]. '전체 공개'는 기본 켜짐 → '등록'을 누르면 바로 공개된다.
- 콘텐츠 링크 '블로그' → '내 블로그 글' 팝업(검색창 + 카드별 '선택').

중복 공개 방지: 업로드 전에 같은 설명의 공개 클립이 이미 있으면 올리지 않고 그 번호를 돌려준다(RECOVERED).
'등록' 직후 결과 파일을 먼저 쓴다 — 이후 단계가 죽어도 재시도가 같은 클립을 또 공개하지 않게.

결과 파일(--result-file) status:
  PUBLISHED  — 등록 완료(media_content_no 확인됨)
  SUBMITTED  — 등록은 눌렀으나 번호 확인 전(재시도 전에 사람이 목록을 확인해야 함)
  RECOVERED  — 이미 같은 클립이 공개돼 있었다(업로드 안 함)
  DRY_RUN    — 다 채우고 등록 직전에 멈춤(초안이 남는다)
  LOGIN_REQUIRED / FAILED
"""

import argparse
import json
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

STUDIO = "https://clipcreators.naver.com/web"
API = "https://clip-service-elb-public.io.naver.com/studio/webapi"


def log(msg: str):
    print(msg, flush=True)


class Result:
    def __init__(self, path: Path):
        self.path = path
        self.data = {"status": "FAILED", "issues": [], "started_at": datetime.now().isoformat(timespec="seconds")}

    def issue(self, msg: str):
        log(f"[주의] {msg}")
        self.data["issues"].append(msg)

    def save(self, **kw):
        self.data.update(kw)
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")


def api_get(page, path: str):
    """페이지 세션 쿠키로 스튜디오 API 를 조회(GET 만)."""
    r = page.evaluate(
        "async u => { const r = await fetch(u, {credentials: 'include'}); return {s: r.status, t: await r.text()}; }",
        f"{API}{path}",
    )
    if r["s"] != 200:
        raise RuntimeError(f"GET {path} → HTTP {r['s']}")
    return json.loads(r["t"])


def list_vods(page, profile_key: str) -> list:
    j = api_get(page, f"/profiles/{profile_key}/contents/cursor?type=VOD&size=30")
    return j.get("items") or []


def norm(s) -> str:
    return " ".join(str(s or "").split())


def first_line(s) -> str:
    return norm(str(s or "").strip().split("\n", 1)[0])


def find_published(items: list, description: str, video_id=None):
    """이미 공개(초안 아님)된 같은 클립. 영상 id, 설명 전체, 또는 첫 줄(제목)이 같으면 같은 편으로 본다.
    첫 줄 비교는 사람이 손으로 올렸거나 수정요청으로 본문이 바뀐 경우를 잡는다(제목이 편마다 다르다)."""
    want, title = norm(description), first_line(description)
    for it in items:
        if it.get("draft"):
            continue
        if video_id and it.get("videoId") == video_id:
            return it
        if norm(it.get("description")) == want or (len(title) >= 8 and first_line(it.get("description")) == title):
            return it
    return None


def find_blog_title(page, log_no: str):
    """logNo → 블로그 글 제목(팝업에서 고를 때 쓸 정확한 제목). 최근 150편까지 본다."""
    for p in range(1, 6):
        j = api_get(page, f"/editor-meta/blog/posts?page={p}&pageSize=30")
        for it in j.get("items") or []:
            if str(it.get("logNo")) == str(log_no):
                return it.get("title")
        if p >= int((j.get("commonInfo") or {}).get("totalPages") or 1):
            break
    return None


def switch_state(page, label_part: str):
    """aria-label 에 label_part 가 든 토글의 (locator, on 여부). 없으면 (None, None)."""
    loc = page.locator(f"button[role=switch][aria-label*='{label_part}']")
    if loc.count() == 0:
        return None, None
    return loc.first, loc.first.get_attribute("aria-checked") == "true"


def pick_menu(page, button_text: str, option_text: str) -> bool:
    page.locator(f"button:has-text('{button_text}')").first.click()
    time.sleep(1.0)
    opt = page.get_by_text(option_text, exact=True)
    if opt.count() == 0:
        page.keyboard.press("Escape")
        return False
    opt.last.click()
    time.sleep(1.0)
    return True


def attach_blog(page, title: str, res: Result) -> bool:
    page.get_by_role("button", name="블로그", exact=True).first.click()
    time.sleep(2.5)

    def cards():
        return page.locator("[class*='ContentLinkPopup_card_']").filter(
            has=page.locator("[class*='ContentLinkPopup_cardTitle_']", has_text=title)
        )

    # 먼저 '내 블로그 글' 목록(최근 30편)에서 고른다. 검색 결과에서 고르면 링크 제목에 검색 강조 태그
    # (<em class="srch">)가 그대로 붙어 나온다(2026-10-02 드라이런 실측) — 검색은 목록에 없을 때만.
    if cards().count() == 0:
        search = page.locator("input[placeholder='블로그 검색']")
        if search.count():
            search.first.fill(title)
            search.first.press("Enter")
            time.sleep(2.5)
            res.issue("블로그 글이 최근 목록에 없어 검색으로 붙임 — 링크 제목에 강조 태그가 보일 수 있음")
    if cards().count() == 0:
        res.issue(f"블로그 팝업에서 글을 못 찾음: {title[:40]}")
        page.keyboard.press("Escape")
        time.sleep(1.0)
        return False
    cards().first.locator("button:has-text('선택')").first.click()
    time.sleep(2.0)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default="")
    ap.add_argument("--description", required=True)
    ap.add_argument("--cover", default="")
    ap.add_argument("--blog-log-no", default="")
    ap.add_argument("--category-first", default="리빙, 홈")
    ap.add_argument("--category-second", default="원예, 재배")
    ap.add_argument("--ai-generated", action="store_true")
    ap.add_argument("--upload-name", default="", help="올릴 파일 이름(확장자 제외) — 초안 식별용")
    ap.add_argument("--video-id", default="", help="--check-only 때 지난 시도의 영상 id")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--result-file", required=True)
    ap.add_argument("--dry-run", action="store_true", help="다 채우고 '등록' 직전에 멈춘다")
    ap.add_argument("--check-only", action="store_true", help="올리지 않고 이미 공개됐는지만 본다(FOUND/NOT_FOUND)")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()

    run_dir = Path(args.run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    res = Result(Path(args.result_file))
    description = args.description.strip()
    if not description:
        res.save(status="FAILED", error="설명이 비었습니다")
        return 1
    video = Path(args.video) if args.video else None
    if not args.check_only and (video is None or not video.exists()):
        res.save(status="FAILED", error=f"영상 없음: {video}")
        return 1

    # 초안 설명 기본값이 파일명이라, 파일 이름을 편 id 로 바꿔 올리면 초안 목록에서 어느 편인지 보인다.
    upload = video
    try:
        if video is not None and args.upload_name and not args.check_only:
            upload = run_dir / f"{args.upload_name}{video.suffix}"
            shutil.copyfile(video, upload)
        return run(args, res, description, upload, run_dir)
    except Exception as e:
        # 브라우저 기동 실패(프로필 락 등)도 결과 파일을 남긴다 — 없으면 서버가 사유를 모른다.
        if res.data.get("status") in ("SUBMITTED", "PUBLISHED"):
            res.save(error=f"등록 뒤 오류: {str(e)[:200]}")
        else:
            res.save(status="FAILED", error=str(e)[:300])
        return 1
    finally:
        if upload is not None and upload != video:
            try:
                upload.unlink()
            except Exception:
                pass


def run(args, res: Result, description: str, upload, run_dir: Path) -> int:
    from playwright.sync_api import sync_playwright

    profile_dir = Path(os.environ["NAVER_PROFILE_DIR"]) if os.environ.get("NAVER_PROFILE_DIR") else (Path.home() / ".naver-blog-profiles" / "cli")
    profile_dir.mkdir(parents=True, exist_ok=True)
    cookies_file = profile_dir / "naver_cookies.json"

    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            str(profile_dir), channel="chrome", headless=args.headless, slow_mo=60,
            args=["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions"],
            ignore_default_args=["--enable-automation"], viewport={"width": 1280, "height": 900},
        )
        try:
            context.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });")
            if cookies_file.exists():
                try:
                    with open(cookies_file, encoding="utf-8") as f:
                        context.add_cookies(json.load(f))
                except Exception as e:
                    log(f"[쿠키] 복원 실패(무해): {str(e)[:60]}")
            page = context.pages[0] if context.pages else context.new_page()
            captured = {}

            # 확인창: '등록'을 누른 뒤에 뜨는 것만 받아들인다(등록 확인일 수 있다). 그 전엔 거절 —
            # 페이지 이탈 경고 등을 '확인'으로 넘기면 의도 밖 동작이 될 수 있다.
            def on_dialog(d):
                log(f"[대화상자] {d.message[:80]}")
                d.accept() if captured.get("submitted") else d.dismiss()

            page.on("dialog", on_dialog)

            def on_resp(r):
                try:
                    if r.request.method == "POST" and "/contents/vod-drafts" in r.url:
                        j = r.json()
                        if isinstance(j, dict):
                            captured["draft"] = j
                    elif r.request.method in ("POST", "PUT", "PATCH") and "/studio/webapi/" in r.url and captured.get("submitted"):
                        captured.setdefault("after_submit", []).append({"method": r.request.method, "url": r.url.split("?")[0], "status": r.status})
                except Exception:
                    pass

            page.on("response", on_resp)
            return drive(page, args, res, description, upload, run_dir, captured)
        finally:
            try:
                with open(cookies_file, "w", encoding="utf-8") as f:
                    json.dump(context.cookies(), f, ensure_ascii=False, indent=2)
            except Exception:
                pass
            try:
                context.close()
            except Exception:
                pass


def drive(page, args, res: Result, description: str, upload, run_dir: Path, captured: dict) -> int:
    page.goto(f"{STUDIO}/dashboard", wait_until="domcontentloaded", timeout=30000)
    time.sleep(3)
    if "nid.naver.com" in page.url or "nidlogin" in page.url:
        res.save(status="LOGIN_REQUIRED", error="네이버 로그인이 풀렸습니다 — 블로그 발행을 한 번 돌려 로그인한 뒤 다시 시도하세요")
        return 2
    selfs = api_get(page, "/profiles/self")
    prof = selfs[0] if isinstance(selfs, list) and selfs else selfs
    profile_key = prof.get("profileKey")
    clip_handle = prof.get("clipId") or ""
    if not profile_key:
        res.save(status="FAILED", error="클립 프로필이 없습니다 — 클립 크리에이터에서 프로필을 먼저 만드세요")
        return 1
    res.save(profile_key=profile_key, clip_handle=clip_handle)

    # 중복 공개 방지 — 같은 클립이 이미 공개돼 있으면 올리지 않는다.
    if args.video_id:
        res.save(video_id=args.video_id)  # 확인이 실패해도 다음 확인이 같은 영상 id 로 대조하게 남긴다
    items = list_vods(page, profile_key)
    dup = find_published(items, description, args.video_id or None)
    if dup:
        log(f"[중복] 이미 공개된 클립 {dup.get('mediaContentNo')} — 업로드하지 않음")
        res.save(status="RECOVERED", media_content_no=str(dup.get("mediaContentNo") or ""), video_id=dup.get("videoId"))
        return 0
    if args.check_only:
        # 등록한 영상이 아직 초안으로 보이면 처리 중일 수 있다 — '없음'으로 풀면 다시 올려 두 번 공개된다.
        if args.video_id and any(it.get("draft") and it.get("videoId") == args.video_id for it in items):
            res.save(status="STILL_DRAFT", error="등록한 영상이 아직 초안으로 보입니다 — 잠시 뒤 다시 확인하거나, 클립 크리에이터에서 그 초안을 지운 뒤 확인하세요")
            return 0
        res.save(status="NOT_FOUND")
        return 0

    blog_title = None
    if args.blog_log_no:
        try:
            blog_title = find_blog_title(page, args.blog_log_no)
        except Exception as e:
            res.issue(f"블로그 글 조회 실패: {str(e)[:80]}")
        if not blog_title:
            res.issue(f"블로그 글 {args.blog_log_no} 을(를) 클립 팝업 목록에서 못 찾음 — 링크 없이 올립니다")

    # 업로드 전에 있던 초안은 이번 것이 아니다 — 같은 파일명의 지난 초안을 이번 업로드로 착각하면
    # 인코딩이 안 끝난 채 등록을 누른다(2026-10-02 드라이런 실측: 지난 초안 COMPLETE 를 보고 14% 에서 진행).
    before = {it.get("draftNo") for it in list_vods(page, profile_key) if it.get("draft")}

    # ── 업로드 ──
    page.goto(f"{STUDIO}/upload", wait_until="domcontentloaded", timeout=30000)
    time.sleep(3)
    page.locator("input[type=file][accept*='.mp4']").first.set_input_files(str(upload))
    log(f"[업로드] {upload.name}")
    page.locator("textarea[name=description]").wait_for(state="visible", timeout=120000)

    # 인코딩 완료까지 기다린다 — 이번에 새로 생긴 초안만 본다. 화면의 '인코딩 중' 안내가 사라졌는지도 함께.
    draft_no, video_id = None, None
    deadline = time.time() + 600
    while True:
        if time.time() >= deadline:
            res.save(status="FAILED", error="인코딩이 10분 안에 끝나지 않았습니다", draft_no=draft_no, video_id=video_id)
            return 1
        d = captured.get("draft") or {}
        if d.get("draftNo") and d.get("draftNo") not in before:
            draft_no = draft_no or d.get("draftNo")
        items = list_vods(page, profile_key)
        mine = next((it for it in items if it.get("draft") and it.get("draftNo") not in before and (
            (draft_no and it.get("draftNo") == draft_no) or norm(it.get("description")) == upload.name)), None)
        if mine:
            draft_no, video_id = mine.get("draftNo"), mine.get("videoId")
            encoding_shown = page.get_by_text("인코딩 중", exact=False).count() > 0
            if mine.get("encodingStatusCode") == "COMPLETE" and not encoding_shown:
                break
        time.sleep(5)
    log(f"[업로드] 인코딩 완료 — 초안 {draft_no}")
    res.save(draft_no=draft_no, video_id=video_id)

    # ── 설명 ──
    ta = page.locator("textarea[name=description]").first
    ta.click()
    ta.fill(description)
    time.sleep(0.5)
    if norm(ta.input_value()) != norm(description):
        res.save(status="FAILED", error="설명 입력이 반영되지 않았습니다")
        return 1

    # ── 커버 ──
    if args.cover and Path(args.cover).exists():
        try:
            page.locator("input[type=file][accept*='image']").first.set_input_files(args.cover)
            time.sleep(4)
            # 자르기 창이 뜨면 적용한다(이 버튼들은 공개와 무관하다).
            for t in ("적용", "완료", "확인"):
                b = page.locator(f"[role=dialog] button:text-is('{t}'), [class*='Modal'] button:text-is('{t}'), [class*='Popup'] button:text-is('{t}')")
                if b.count() and b.first.is_visible():
                    b.first.click()
                    time.sleep(2)
                    break
        except Exception as e:
            res.issue(f"커버 업로드 실패 — 프레임 후보 첫 장으로 올라갑니다: {str(e)[:80]}")

    # ── 카테고리(필수) ──
    if not pick_menu(page, "1차 카테고리", args.category_first) or not pick_menu(page, "2차 카테고리", args.category_second):
        page.screenshot(path=str(run_dir / "clip_form.png"), full_page=True)
        res.save(status="FAILED", error=f"카테고리 선택 실패: {args.category_first} › {args.category_second}")
        return 1

    # ── AI 활용 ──
    if args.ai_generated:
        sw, on = switch_state(page, "AI")
        if sw is None:
            res.issue("AI 활용 토글을 못 찾음")
        elif not on:
            sw.click()
            time.sleep(1)
            _, on = switch_state(page, "AI")
            if not on:
                res.issue("AI 활용 토글이 켜지지 않음")

    # ── 블로그 링크 ──
    if blog_title:
        try:
            attach_blog(page, blog_title, res)
        except Exception as e:
            res.issue(f"블로그 링크 실패: {str(e)[:80]}")
            page.keyboard.press("Escape")

    # ── 공개 설정 확인 — 기본 켜짐. 꺼져 있으면 사람이 바꾼 것이니 손대지 않고 보고만 한다. ──
    _, pub = switch_state(page, "전체 공개")
    res.save(public=bool(pub))
    if not pub:
        res.issue("전체 공개 토글이 꺼져 있음")

    page.screenshot(path=str(run_dir / "clip_form.png"), full_page=True)
    if args.dry_run:
        log("[드라이런] 등록 직전에 멈춤 — 초안이 남습니다")
        res.save(status="DRY_RUN", screenshot=str(run_dir / "clip_form.png"))
        return 0

    # ── 등록 ──
    # 누르기 '전에' SUBMITTED 를 쓴다 — 클릭이 먹힌 뒤 대기에서 예외가 나도 재시도가 같은 클립을 다시 공개하지 않게.
    # (실제로 안 눌렸어도 SUBMITTED 로 남는 쪽이 안전하다 — 서버의 '클립 확인'이 목록을 보고 풀어 준다.)
    submit = page.locator("button:text-is('등록')").last
    res.save(status="SUBMITTED", submitted_at=datetime.now().isoformat(timespec="seconds"))
    captured["submitted"] = True
    submit.click()
    log("[등록] 눌렀음 — 공개 확인 중")
    # 번호(mediaContentNo)가 붙을 때까지 본다 — 번호 없는 공개는 '확인 필요'로 남는다(안전하지만 사람 손이 간다).
    deadline = time.time() + 120
    published = None
    while time.time() < deadline:
        time.sleep(4)
        try:
            hit = find_published(list_vods(page, profile_key), description, video_id)
        except Exception:
            continue
        if hit:
            published = hit
            if hit.get("mediaContentNo"):
                break
    if published:
        res.save(status="PUBLISHED", media_content_no=str(published.get("mediaContentNo") or ""), video_id=published.get("videoId"),
                 public_status=published.get("userPublicStatusCode"), after_submit=captured.get("after_submit"))
        log(f"[완료] 클립 {published.get('mediaContentNo')} ({published.get('userPublicStatusCode')})")
    try:
        page.screenshot(path=str(run_dir / "clip_after_submit.png"), full_page=True)
    except Exception:
        pass
    if published:
        return 0
    body = ""
    try:
        body = page.inner_text("body")[:400]
    except Exception:
        pass
    res.save(status="SUBMITTED", error="등록은 눌렀으나 2분 안에 공개 목록에서 확인 못 함 — 잠시 뒤 '클립 확인'을 누르세요",
             page_text=body, after_submit=captured.get("after_submit"))
    return 1


if __name__ == "__main__":
    sys.exit(main())
