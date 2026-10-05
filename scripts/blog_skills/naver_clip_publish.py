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


def lines_of(s) -> list:
    return [norm(x) for x in str(s or "").split("\n") if norm(x)]


def find_published(items: list, description: str, video_id=None, title=None):
    """이미 공개(초안 아님)된 같은 클립. 영상 id, 설명 전체, 또는 제목 줄이 같으면 같은 편으로 본다.
    제목 비교는 사람이 손으로 올렸거나 수정요청으로 본문이 바뀐 경우를 잡는다(제목이 편마다 다르다).

    2026-10-05: 설명 첫 줄이 검색어("감나무 흰곰팡이")로 바뀌었다. 첫 줄끼리 비교하면 같은 검색어를 쓴 다른 편을
    같은 편으로 오인해(올리지 않고 남의 번호를 기록) 버린다. 그래서 제목은 따로 받고(--match-title), 상대 설명의
    '어느 줄이든' 제목과 같으면 같은 편으로 본다 — 예전 꼴(제목이 첫 줄)과 새 꼴(검색어 다음 줄) 모두 잡힌다."""
    want = norm(description)
    title = norm(title) if title else first_line(description)
    for it in items:
        if it.get("draft"):
            continue
        if video_id and it.get("videoId") == video_id:
            return it
        if norm(it.get("description")) == want or (len(title) >= 8 and title in lines_of(it.get("description"))):
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


DROPDOWN = "button[class*='ClipDetailForm_dropdown']"
# 메뉴 항목이 아닌 곳 — 최근 사용 카테고리 칩(2026-10-02 등장)과 드롭다운 버튼 자신의 글자.
NOT_MENU_JS = "n => !n.closest(\"[class*='categoryTag']\") && !n.closest(\"button[class*='ClipDetailForm_dropdown']\")"


def categories_set(page, first: str, second: str) -> bool:
    """드롭다운 두 칸에 실제로 그 값이 들어갔는가 — 선택 성공의 유일한 근거."""
    dd = page.locator(DROPDOWN)
    try:
        texts = [dd.nth(i).inner_text(timeout=2000) for i in range(dd.count())]
    except Exception:
        return False
    return any(first in t for t in texts) and any(second in t for t in texts)


def pick_menu(page, button_text: str, option_text: str) -> bool:
    """드롭다운을 열고 '메뉴 안의 보이는' 항목을 누른다(칩·버튼 글자는 뺀다)."""
    btn = page.locator(f"{DROPDOWN}:has-text('{button_text}')")
    if btn.count() == 0:
        btn = page.locator(f"button:has-text('{button_text}')")
    if btn.count() == 0:
        log(f"[카테고리] '{button_text}' 칸을 못 찾음")
        return False
    btn = btn.first
    for _ in range(20):  # 2차 칸은 1차를 고른 뒤에야 활성화된다 — 최대 ~10초
        if btn.is_enabled():
            break
        time.sleep(0.5)
    else:
        log(f"[카테고리] '{button_text}' 칸이 활성화되지 않음")
        return False
    btn.click()
    # 항목은 '화면에 보이는 글자(innerText)'로 찾는다. get_by_text(exact) 는 숨은 글자까지 든 textContent 로 맞춰서
    # 메뉴의 <li>리빙, 홈</li> 을 못 찾았다(2026-10-02 실측 — 펼친 메뉴에 그 항목이 분명히 있었다).
    find_js = """(t) => {
      const ok = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const hits = [...document.querySelectorAll('li, [role=option], [role=menuitem]')].filter(n =>
        (n.innerText || '').trim() === t && ok(n)
        && !n.closest("[class*='categoryTag']") && !n.closest('nav, aside, header'));
      return hits.length ? hits[hits.length - 1] : null;
    }"""
    opt = None
    for _ in range(10):  # 메뉴가 펼쳐질 때까지 최대 ~5초
        time.sleep(0.5)
        h = page.evaluate_handle(find_js, option_text)
        opt = h.as_element()
        if opt is not None:
            break
    if opt is None:
        log(f"[카테고리] '{button_text}' 메뉴에서 '{option_text}' 항목을 못 찾음")
        page.keyboard.press("Escape")
        return False
    try:
        opt.scroll_into_view_if_needed(timeout=3000)
        opt.click(timeout=5000)
    except Exception:
        opt.click(timeout=5000, force=True)  # 펼침 애니메이션이 덜 끝났으면 위치는 맞으니 강제로 누른다
    time.sleep(1.0)
    return True


def pick_categories(page, first: str, second: str) -> bool:
    """카테고리 두 칸을 채운다.

    2026-10-02 실패(모과나무 편, 두 번): 네이버가 폼 아래에 '최근 사용 카테고리' 칩("리빙, 홈 › 원예, 재배")을
    새로 붙였다. 종전 코드는 `get_by_text("리빙, 홈").last` 로 그 칩 안의 글자를 집어 눌렀고, 칩 글자는
    눌러도 드롭다운이 안 채워져 2차 칸이 비활성으로 남았다(30초 대기 끝 실패).
    순서: 이미 채워졌으면 그대로 → 최근 사용 칩(두 값이 다 든 것) → 드롭다운 메뉴. 매번 드롭다운 글자로 확인한다.
    """
    if categories_set(page, first, second):
        log("[카테고리] 이미 선택돼 있음")
        return True
    chip = page.locator("[class*='categoryTag']").filter(has_text=first).filter(has_text=second)
    for i in range(chip.count()):
        c = chip.nth(i)
        try:
            if c.is_visible():
                c.click(timeout=5000)
                time.sleep(1.5)
                if categories_set(page, first, second):
                    log("[카테고리] 최근 사용 칩으로 선택")
                    return True
        except Exception as e:
            log(f"[카테고리] 칩 선택 실패(드롭다운으로): {str(e)[:80]}")
        break
    if not pick_menu(page, "1차 카테고리", first):
        return False
    if not pick_menu(page, "2차 카테고리", second):
        return False
    ok = categories_set(page, first, second)
    if ok:
        log("[카테고리] 드롭다운으로 선택")
    return ok


PL_ADD = "[class*='PlaylistAddPopup_popup']"
PL_NEW = "[class*='NewPlaylistPopup_popup']"


PL_TITLE_KEYS = ("title", "name", "playlistTitle")


def find_playlist(page, profile_key: str, name: str):
    """이 이름의 재생목록을 API 로 찾는다 — (상태, 항목). 상태: 'found'(정확히 같은 제목) | 'absent'(조회 성공·없음) |
    'unknown'(조회 실패·응답 꼴이 다름). 리뷰(2026-10-05): 종전엔 조회 실패·필드 이름 불일치도 '없음'으로 읽혀
    같은 이름의 재생목록을 하나 더 만들었다 — '만들기'는 즉시 전체 공개로 저장된다. 만들기는 'absent' 일 때만."""
    try:
        for p in range(1, 11):
            j = api_get(page, f"/profiles/{profile_key}/playlists?size=20&page={p}")
            items = j.get("items") if isinstance(j, dict) else None
            if not isinstance(items, list):
                return "unknown", None
            if items and not any(isinstance(it, dict) and any(isinstance(it.get(k), str) for k in PL_TITLE_KEYS) for it in items):
                return "unknown", None  # 제목 필드 이름이 바뀌었다 — 없다고 단정할 수 없다
            for it in items:
                if isinstance(it, dict) and any(norm(it.get(k)) == norm(name) for k in PL_TITLE_KEYS):
                    return "found", it
            if p >= int((j.get("commonInfo") or {}).get("totalPages") or 1):
                return "absent", None
        return "unknown", None  # 10쪽을 넘었다 — 끝까지 못 봤다
    except Exception as e:
        log(f"[재생목록] 목록 조회 실패: {str(e)[:80]}")
        return "unknown", None


def should_create_playlist(lookup: str, picked: str) -> bool:
    """새로 만들지 판정(순수) — 화면 목록에서도 못 찾았고(picked 'not-found') API 조회가 '없음'을 확인했을 때만.
    API 가 'found' 인데 화면에 없거나 조회가 'unknown' 이면 만들지 않고 실패로 둔다(중복 공개 재생목록 방지)."""
    return picked == "not-found" and lookup == "absent"


def close_playlist_popups(page):
    """재생목록 창을 모두 닫는다(취소) — 창이 '등록' 버튼을 덮은 채 남으면 등록이 막힌다."""
    for sel in (PL_NEW, PL_ADD):
        for _ in range(2):
            pop = page.locator(sel)
            if pop.count() == 0 or not pop.first.is_visible():
                break
            btn = pop.first.locator("button[class*='cancelBtn'], button[class*='closeBtn']")
            try:
                if btn.count():
                    btn.first.click(timeout=3000)
                else:
                    page.keyboard.press("Escape")
            except Exception:
                page.keyboard.press("Escape")
            time.sleep(1.0)


def playlist_in_form(page) -> bool:
    """폼에 재생목록이 하나 이상 걸렸는가 — 넣기 성공의 근거.
    폼은 이름을 보여 주지 않는다(2026-10-05 실측): 제목이 '재생목록 1'이 되고 버튼이 '재생목록 추가'→'재생목록 편집'으로 바뀐다."""
    try:
        return "편집" in page.locator("button[class*='playlistBtn']").first.inner_text(timeout=3000)
    except Exception:
        return False


def pick_in_popup(page, pop, name: str) -> str:
    """재생목록 창 목록에서 정확히 같은 이름의 항목을 고른다 — 'clicked'·'already'·'not-found'·'no-popup'.
    검색으로 좁힌 뒤, 이미 체크돼 있으면(새로 만들면 자동 선택될 수 있다) 두지 않고 그대로."""
    search = pop.locator("input[class*='searchInput']")
    if search.count():
        search.first.fill(name)
        search.first.press("Enter")
        time.sleep(2.0)
    return page.evaluate("""([sel, t]) => {
      const pop = document.querySelector(sel);
      if (!pop) return 'no-popup';
      // 목록 항목(li) 안의 글자만 — 검색 결과 없음 안내가 검색어를 그대로 굵게 되풀이해 그걸 집은 적이 있다(2026-10-05 실측).
      const hits = [...pop.querySelectorAll("ul li [class*='listItemText'], ul li")].filter(n => n.children.length === 0 && (n.innerText || '').trim() === t);
      if (!hits.length) return 'not-found';
      // 항목 = li.listItem > label.listItemLabel > input(숨은 체크박스) + span.checkbox + span.listItemText.
      // 고르면 li 에 listItemSelected, span 에 checkboxChecked 가 붙는다 — 이미 골라져 있으면 누르지 않는다(누르면 해제된다).
      const li = hits[0].closest('li') || hits[0];
      const box = li.querySelector('input[type=checkbox]');
      const on = /Selected/.test(li.className) || !!li.querySelector("[class*='checkboxChecked']") || (box && box.checked === true);
      if (on) return 'already';
      (li.querySelector('label') || hits[0]).click();
      return 'clicked';
    }""", [PL_ADD, name])


def add_to_playlist(page, profile_key: str, name: str, res: Result, run_dir: Path, writes: list) -> bool:
    """클립을 재생목록 name 에 넣는다(2026-10-05) — 화면 목록에 있으면 고르고, API 조회로 없음이 확인될 때만 만든다
    (should_create_playlist, 리뷰 2026-10-05). 실패해도 업로드는 계속한다.

    화면(2026-10-05 정찰): 폼의 '재생목록 추가'(button.ClipDetailForm_playlistBtn) → 'PlaylistAddPopup'(검색창·목록·
    '새 재생목록 만들기'·취소/완료) → '새 재생목록 만들기'는 'NewPlaylistPopup'(textarea#playlist-title-input 150자,
    전체 공개 기본, '만들기'). 목록 API: GET /profiles/{key}/playlists?size=20&page=N (items[].title).
    '만들기'는 그 자리에서 저장된다(POST /profiles/{key}/playlists — 클립을 등록하지 않아도 남는다, 드라이런 실측).
    항목 선택·'완료'는 폼 상태만 바꾸고 아무것도 쓰지 않는다(실측) — 연결은 '등록' 때 함께 저장될 것으로 본다(실제 등록 경로는 미검증).
    """
    start = len(writes)
    try:
        lookup, _ = find_playlist(page, profile_key, name)
        log(f"[재생목록] 목록 조회: {lookup}")
        page.locator("button[class*='playlistBtn']").first.click(timeout=5000)
        pop = page.locator(PL_ADD).first
        pop.wait_for(state="visible", timeout=10000)
        time.sleep(1.5)
        # 화면 목록에서 먼저 정확한 이름을 찾는다 — 있으면 고르고 끝(만들지 않는다).
        picked = pick_in_popup(page, pop, name)
        log(f"[재생목록] 목록 선택: {picked}")
        if should_create_playlist(lookup, picked):
            pop.locator("button[class*='newPlaylistBtn']").first.click(timeout=5000)
            new = page.locator(PL_NEW).first
            new.wait_for(state="visible", timeout=10000)
            new.locator("textarea#playlist-title-input, textarea[name=title]").first.fill(name)
            time.sleep(0.5)
            new.locator("button[class*='createBtn']").first.click(timeout=5000)
            new.wait_for(state="hidden", timeout=15000)
            log(f"[재생목록] 새로 만듦: {name}")
            res.save(playlist_created=name)
            time.sleep(2.0)
            picked = pick_in_popup(page, pop, name)
            log(f"[재생목록] 만든 뒤 선택: {picked}")
        if picked in ("no-popup", "not-found"):
            why = "" if lookup == "absent" else f" — 목록 조회 '{lookup}'라 새로 만들지 않음"
            raise RuntimeError(f"목록에서 '{name}' 항목을 못 찾음({picked}){why}")
        time.sleep(1.0)
        pop.locator("button[class*='confirmBtn']").first.click(timeout=5000)
        page.locator(PL_ADD).first.wait_for(state="hidden", timeout=10000)
        time.sleep(1.0)
        if not playlist_in_form(page):
            raise RuntimeError("완료 뒤 폼에 재생목록이 걸리지 않음('재생목록 편집'으로 안 바뀜)")
        res.save(playlist=name, playlist_writes=writes[start:])
        log(f"[재생목록] 넣음: {name}")
        return True
    except Exception as e:
        res.issue(f"재생목록 '{name}' 넣기 실패 — 재생목록 없이 올립니다: {str(e)[:120]}")
        try:
            page.screenshot(path=str(run_dir / "clip_playlist_fail.png"), full_page=False)
            dump = page.evaluate("""(sel) => { const p = document.querySelector(sel); return p ? p.outerHTML.replace(/<svg[\\s\\S]*?<\\/svg>/g, '').slice(0, 8000) : null; }""", PL_ADD)
            (run_dir / "clip_playlist_dump.html").write_text(dump or "", encoding="utf-8")
        except Exception:
            pass
        res.save(playlist_writes=writes[start:])
        close_playlist_popups(page)
        return False


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
    ap.add_argument("--match-title", default="", help="중복 공개 검사용 제목 — 설명의 어느 줄이든 이것과 같으면 같은 편")
    ap.add_argument("--playlist", default="", help="넣을 재생목록 이름(없으면 만든다). 실패해도 업로드는 계속")
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
                    elif r.request.method in ("POST", "PUT", "PATCH", "DELETE") and "/studio/webapi/" in r.url:
                        # 등록 전 쓰기도 남긴다(2026-10-05) — 재생목록 '만들기'처럼 등록과 무관하게 바로 저장되는 동작을 결과에서 보이게.
                        w = {"method": r.request.method, "url": r.url.split("?")[0], "status": r.status}
                        captured.setdefault("writes", []).append(w)
                        if captured.get("submitted"):
                            captured.setdefault("after_submit", []).append(w)
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
    dup = find_published(items, description, args.video_id or None, args.match_title or None)
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
    try:
        cats_ok = pick_categories(page, args.category_first, args.category_second)
    except Exception as e:
        log(f"[카테고리] 예외: {str(e)[:200]}")
        cats_ok = False
    if not cats_ok:
        page.screenshot(path=str(run_dir / "clip_form.png"), full_page=True)
        # 진단 덤프 — 화면이 또 바뀌었을 때 어디가 어긋났는지 바로 보이게(1차 메뉴를 연 상태의 DOM).
        try:
            dd = page.locator(DROPDOWN)
            if dd.count():
                dd.first.click(timeout=3000)
                time.sleep(1.5)
            dump = page.evaluate("""(t) => {
              const out = [];
              for (const n of document.querySelectorAll('body *')) {
                if (n.children.length === 0 && (n.textContent || '').trim() === t) {
                  const r = n.getBoundingClientRect();
                  const chain = []; let p = n;
                  for (let i = 0; i < 6 && p; i++, p = p.parentElement) chain.push(p.tagName + '.' + (p.className || '').toString().slice(0, 60) + (p.getAttribute && p.getAttribute('role') ? '[role=' + p.getAttribute('role') + ']' : ''));
                  out.push({ visible: r.width > 0 && r.height > 0, rect: [r.x, r.y, r.width, r.height].map(Math.round), chain });
                }
              }
              const dds = [...document.querySelectorAll("button[class*='ClipDetailForm_dropdown']")].map(b => ({ text: b.innerText, disabled: b.disabled, expanded: b.getAttribute('aria-expanded') }));
              return { matches: out, dropdowns: dds };
            }""", args.category_first)
            (run_dir / "clip_category_dump.json").write_text(json.dumps(dump, ensure_ascii=False, indent=1), encoding="utf-8")
            page.screenshot(path=str(run_dir / "clip_category_open.png"), full_page=False)
            page.keyboard.press("Escape")
        except Exception as e:
            log(f"[카테고리] 진단 덤프 실패: {str(e)[:80]}")
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

    # ── 재생목록(2026-10-05, 수종별 "<수종> 키우기") — 최선 노력. 실패는 주의로만 남기고 등록은 그대로 간다. ──
    # 드라이런은 건너뛴다(리뷰 2026-10-05) — '새 재생목록 만들기'는 등록 전에도 그 자리에서 전체 공개로 저장된다(실측).
    if args.playlist.strip() and args.dry_run:
        log(f"[재생목록] 드라이런 — '{args.playlist.strip()}' 넣기 생략(만들기가 즉시 공개 저장이라)")
        res.save(playlist_skipped="dry_run")
    elif args.playlist.strip():
        add_to_playlist(page, profile_key, args.playlist.strip(), res, run_dir, captured.setdefault("writes", []))
        close_playlist_popups(page)  # 어떤 경우든 창이 등록 버튼을 덮지 않게

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
            hit = find_published(list_vods(page, profile_key), description, video_id, args.match_title or None)
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
