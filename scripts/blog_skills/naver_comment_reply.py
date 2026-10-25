"""
네이버 블로그·클립 댓글에 답글 달기 — 댓글 상자(cbox) PC웹을 Playwright 로 조작한다(댓글 담당, 2026-10-25).

공개 쓰기 API 가 없다. 블로그 발행(naver_publish.py)과 같은 영속 프로필(NAVER_PROFILE_DIR)로 로그인 상태를 쓴다.
사람이 텔레그램 [올리기]를 눌렀을 때만 서버 라우트가 부른다(블로그 잠금 원칙 — 에이전트가 직접 쓰지 않는다).

화면 사실(정찰 2026-10-25, 블로그·클립 같은 상자):
- 댓글 = li.u_cbox_comment, data-info 에 commentNo:'…'·parentCommentNo·manager(주인 여부)·replyLevel.
- 답글 버튼: 블로그 .u_cbox_btn_reply, 클립 .u_cbox_writereply_button. 누르면 그 li 안에 입력칸이 열린다.
- 입력칸 = div.u_cbox_text(contenteditable), 등록 = button.u_cbox_btn_upload(클래스에 replyButton_<commentNo>).
- 블로그는 PostView.naver 주소로 열면 iframe 없이 본문이 뜨고, 하단 .btn_comment 를 눌러야 댓글 상자가 열린다.
- 클립은 https://clip.naver.com/comments/?meta=… 가 댓글 상자 단독 화면이다. 답글칸에 '@작성자' 언급이 미리 들어간다.

결과 파일(--result-file) status:
  POSTED          — 등록 뒤 주인 답글이 늘어난 것을 확인
  SUBMITTED       — 등록은 눌렀으나 확인 못 함(다시 누르기 전에 화면에서 확인해야 함)
  DRY_RUN         — 다 채우고 등록 직전에 멈춤(아무것도 안 올라감)
  LOGIN_REQUIRED / NOT_FOUND / FAILED
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path


def log(msg: str):
    print(msg, flush=True)


class Result:
    def __init__(self, path: Path):
        self.path = path
        self.data = {"status": "FAILED", "started_at": datetime.now().isoformat(timespec="seconds")}

    def save(self, **kw):
        self.data.update(kw)
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")


def owner_replies(page, comment_no: str) -> int:
    """그 댓글에 달린 주인(manager) 답글 수."""
    return page.evaluate(
        """n => [...document.querySelectorAll('li.u_cbox_comment')].filter(li => {
              const d = li.getAttribute('data-info') || '';
              return d.includes(`parentCommentNo:'${n}'`) && !d.includes(`commentNo:'${n}',`) && d.includes('manager:true');
           }).length""",
        comment_no,
    )


def find_comment(page, comment_no: str):
    return page.locator(f"li.u_cbox_comment[data-info^=\"commentNo:'{comment_no}'\"]").first


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["blog", "clip"], required=True)
    ap.add_argument("--url", required=True)
    ap.add_argument("--comment-no", required=True)
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--result-file", required=True)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    res = Result(Path(args.result_file))
    if not re.fullmatch(r"\d{5,30}", args.comment_no):
        res.save(status="FAILED", error="댓글 번호 형식이 아닙니다")
        return 1
    if not re.match(r"^https://(blog\.naver\.com|clip\.naver\.com)/", args.url):
        res.save(status="FAILED", error="네이버 블로그·클립 주소가 아닙니다")
        return 1
    text = Path(args.text_file).read_text(encoding="utf-8").strip()
    if not text:
        res.save(status="FAILED", error="답글이 비어 있습니다")
        return 1
    try:
        return run(args, res, text)
    except Exception as e:
        if res.data.get("status") in ("SUBMITTED", "POSTED"):
            res.save(error=f"등록 뒤 오류: {str(e)[:200]}")
        else:
            res.save(status="FAILED", error=str(e)[:300])
        return 1


def run(args, res: Result, text: str) -> int:
    from playwright.sync_api import sync_playwright

    profile_dir = Path(os.environ["NAVER_PROFILE_DIR"]) if os.environ.get("NAVER_PROFILE_DIR") else (Path.home() / ".naver-blog-profiles" / "cli")
    profile_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    cookies_file = profile_dir / "naver_cookies.json"
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            str(profile_dir), channel="chrome", headless=args.headless, slow_mo=40,
            args=["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions"],
            ignore_default_args=["--enable-automation"], viewport={"width": 1280, "height": 1000},
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
            submitted = {"v": False}

            # 등록 뒤에 뜨는 안내만 받아들인다 — 그 전 확인창(페이지 이탈 등)은 거절.
            def on_dialog(d):
                log(f"[대화상자] {d.message[:80]}")
                d.accept() if submitted["v"] else d.dismiss()

            page.on("dialog", on_dialog)
            return drive(page, args, res, text, submitted)
        finally:
            try:
                # 로그인 쿠키 — 주인만 읽게(0600). 이미 있던 파일 권한도 좁힌다.
                fd = os.open(cookies_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(context.cookies(), f, ensure_ascii=False, indent=2)
                os.chmod(cookies_file, 0o600)
            except Exception:
                pass
            try:
                context.close()
            except Exception:
                pass


def drive(page, args, res: Result, text: str, submitted: dict) -> int:
    n = args.comment_no
    page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
    time.sleep(2.5)
    if "nid.naver.com" in page.url:
        res.save(status="LOGIN_REQUIRED", error="네이버 로그인이 풀렸습니다 — 블로그 발행을 한 번 돌려 로그인한 뒤 다시 누르세요")
        return 2
    if args.kind == "blog":
        btn = page.locator("a.btn_comment").first
        if btn.count():
            btn.evaluate("e => e.click()")
    li = find_comment(page, n)
    for _ in range(20):
        if li.count():
            break
        time.sleep(0.5)
    # 댓글이 많으면 상자가 나눠 보여 준다 — '더보기/이전 댓글'을 눌러 가며 찾는다.
    for _ in range(15):
        if li.count():
            break
        more = page.locator(".u_cbox_btn_more, .u_cbox_page_more, a.u_cbox_btn_view_comment").first
        if not more.count():
            break
        more.evaluate("e => e.click()")
        time.sleep(1.2)
    if not li.count():
        res.save(status="NOT_FOUND", error="댓글 상자에서 그 댓글을 찾지 못했습니다 — 지워졌거나 숨김 처리됐거나, 오래된 댓글이라 화면에 안 나올 수 있습니다. 채널에서 직접 답해 주세요")
        return 3
    reply_btn = li.locator(".u_cbox_btn_reply, .u_cbox_writereply_button").first
    if not reply_btn.count():
        res.save(status="FAILED", error="답글 버튼이 없습니다")
        return 1
    reply_btn.evaluate("e => e.click()")
    time.sleep(2)
    # 답글 목록이 펼쳐진 뒤, 수가 두 번 같게 읽힐 때까지 기다려 센다(늦게 펼쳐진 기존 답글을 새 답글로 오판하지 않게).
    before = owner_replies(page, n)
    for _ in range(6):
        time.sleep(0.5)
        again = owner_replies(page, n)
        if again == before:
            break
        before = again
    if "nid.naver.com" in page.url:
        res.save(status="LOGIN_REQUIRED", error="네이버 로그인이 풀렸습니다 — 블로그 발행을 한 번 돌려 로그인한 뒤 다시 누르세요")
        return 2
    editor = li.locator(".u_cbox_reply_area div.u_cbox_text").first
    if not editor.count():
        editor = li.locator("div.u_cbox_text").first
    upload = li.locator(f"button.u_cbox_btn_upload[class*='replyButton_{n}']").first
    if not editor.count() or not upload.count():
        res.save(status="LOGIN_REQUIRED", error="답글 입력칸이 열리지 않았습니다 — 로그인이 풀렸을 수 있습니다")
        return 2
    # 블로그는 하단 고정 막대에 가려 일반 클릭이 '화면 밖'으로 실패한다(2026-10-25 실측) — 가운데로 끌어온 뒤 초점만 준다.
    editor.evaluate("e => { e.scrollIntoView({block: 'center'}); e.focus(); }")
    time.sleep(0.4)
    page.keyboard.press("End")
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line:
            page.keyboard.insert_text(line)
        if i < len(lines) - 1:
            page.keyboard.press("Shift+Enter")
        time.sleep(0.1)
    time.sleep(0.6)
    typed = editor.inner_text().strip()
    if lines[0][:10] not in typed:
        res.save(status="FAILED", error="답글을 입력칸에 넣지 못했습니다")
        return 1
    if args.dry_run:
        res.save(status="DRY_RUN", typed=typed[:300])
        return 0
    probe = lines[0].strip()[:12]  # 등록 확인용 — 주인 답글 수가 늘고, 우리가 쓴 첫 줄이 화면에 보여야 POSTED
    submitted["v"] = True
    res.save(status="SUBMITTED")  # 등록 직전 기록 — 이후 죽어도 다시 누를 때 사장님이 확인하게
    upload.evaluate("e => e.click()")
    for _ in range(20):
        time.sleep(0.5)
        if owner_replies(page, n) > before and probe in page.evaluate("() => document.body.innerText"):
            res.save(status="POSTED", posted_at=datetime.now().isoformat(timespec="seconds"))
            log("[완료] 답글 등록 확인")
            return 0
    res.save(error="등록 뒤 답글이 화면에 안 보입니다 — 채널에서 확인하세요")
    return 4


if __name__ == "__main__":
    sys.exit(main())
