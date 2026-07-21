"""
네이버 블로그 SmartEditor ONE 자동 임시저장 스크립트
2-1_Blog_GEPA의 성공 코드를 기반으로 재작성

핵심:
- 글쓰기 URL: /{blog_id}/postwrite
- SE ONE API: window.SE.launcher._editors.blogpc001._documentService.setDocumentData()
- 쿠키 기반 세션 관리 (.naver_cookies.json)
- 도움말 팝업 JS 클릭으로 처리
- 이미지: button[data-name='image'] + expect_file_chooser
- 임시저장: button[data-name='draftSave']
"""

import argparse
import json
import os
import random
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path


# ── 인라인 서식 파서(**굵게**, *이탤릭*/_이탤릭_) — API·사람 경로 공용 ──────────
_INLINE_RE = re.compile(r"\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_")


def parse_inline_segments(text: str) -> list:
    """'a **b** *c* d' → [(seg, bold, italic), ...]. 마커 없으면 [(text, False, False)]."""
    segs = []
    i = 0
    for m in _INLINE_RE.finditer(text):
        if m.start() > i:
            segs.append((text[i:m.start()], False, False))
        if m.group(1) is not None:
            segs.append((m.group(1), True, False))    # **굵게**
        elif m.group(2) is not None:
            segs.append((m.group(2), False, True))     # *이탤릭*
        else:
            segs.append((m.group(3), False, True))     # _이탤릭_
        i = m.end()
    if i < len(text):
        segs.append((text[i:], False, False))
    return segs or [(text, False, False)]


def parse_bold_segments(text: str) -> list:
    """하위호환 — (seg, bold) 형태(이탤릭 무시)."""
    return [(s, b) for s, b, _ in parse_inline_segments(text)]


# ── 경로 설정 ─────────────────────────────────────────────────────────────
# 이식 주의: 원본은 <blogroot>/.claude/skills/blog-publisher/scripts 라 parents[3]=<blogroot> 였다.
# 새 위치는 <gepa>/scripts/blog_skills 라 parents[1]=<gepa> 로 프로젝트 루트를 잡는다(.env 로드 위치).
SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
COOKIES_FILE = PROJECT_ROOT / ".naver_cookies.json"


# ── 환경변수 로드 ──────────────────────────────────────────────────────────
def load_env(project_root: str) -> None:
    env_path = os.path.join(project_root, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip())


def log(msg: str):
    print(msg, flush=True)


def uid() -> str:
    return "SE-" + str(uuid.uuid4())


# ── 쿠키 관리 ─────────────────────────────────────────────────────────────
def save_cookies(context, cookies_file: Path):
    with open(cookies_file, "w", encoding="utf-8") as f:
        json.dump(context.cookies(), f, ensure_ascii=False, indent=2)
    log("  [쿠키 저장] 다음 실행부터 자동 로그인됩니다.")


def try_cookie_login(context, page, cookies_file: Path) -> bool:
    if not cookies_file.exists():
        return False
    try:
        with open(cookies_file, encoding="utf-8") as f:
            context.add_cookies(json.load(f))
        page.goto("https://blog.naver.com", wait_until="domcontentloaded", timeout=15000)
        time.sleep(1)
        login_link = page.locator("a[href*='nidlogin'], .link_login").count()
        return login_link == 0
    except Exception:
        return False


# ── JS 기반 범용 버튼 클릭 ─────────────────────────────────────────────────
JS_CLICK = """
(texts) => {
    const candidates = [...document.querySelectorAll(
        'a, button, input[type=button], input[type=submit], span[role=button], div[role=button]'
    )];
    for (const text of texts) {
        const el = candidates.find(e => {
            const t = (e.textContent || e.value || '').trim();
            return t === text || t.includes(text);
        });
        if (el && el.offsetParent !== null) {
            el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
            return el.textContent.trim().slice(0, 30);
        }
    }
    return null;
}
"""

def js_click(page, texts: list):
    try:
        return page.evaluate(JS_CLICK, texts)
    except Exception:
        return None


# ── 로그인 (클립보드 붙여넣기 → 실패 시 수동 대기) ─────────────────────
def full_auto_login(page, naver_id: str, naver_pw: str):
    log("[로그인] 로그인 시작...")
    page.goto(
        "https://nid.naver.com/nidlogin.login?url=https://blog.naver.com",
        wait_until="domcontentloaded", timeout=30000,
    )
    time.sleep(1.5)

    # 사람 타이핑 방식(2026-07-20) — 종전 JS 값 주입(클립보드 모사)이 네이버 봇탐지 강화로 자동 로그인
    # 거부·캡차 유발(사용자 보고). 본문(human_type)과 동일하게 실제 키 입력을 가변 리듬으로 흘린다.
    # 자격증명이 없으면 자동입력을 건너뛰고 곧장 수동 로그인 대기(빈 값 제출로 인한 오류 화면 방지).
    auto_filled = False
    if not naver_id or not naver_pw:
        log("  자격증명 미설정 — 브라우저에서 직접 로그인해주세요.")
    else:
        try:
            def _type_field(sel: str, val: str):
                field = page.locator(sel).first
                field.click()
                time.sleep(_rand(0.4, 0.8))
                # 기존 값(네이버 프로필 자동완성 등)을 먼저 비운다 — 안 지우면 새 입력이 기존값 뒤에
                # 덧붙어 '기존+새값' 깨진 자격증명이 된다(2026-07-20 사용자 실측: 아이디·비번 필드가
                # 이미 채워진 상태에서 뒤에 덧붙어 로그인 실패). 전체선택→삭제로 확실히 비운다.
                page.keyboard.press("ControlOrMeta+a")
                time.sleep(_rand(0.05, 0.12))
                page.keyboard.press("Delete")
                time.sleep(_rand(0.1, 0.2))
                for ch in val:
                    page.keyboard.type(ch)
                    time.sleep(_rand(0.07, 0.18))
                time.sleep(_rand(0.3, 0.6))

            _type_field("input#id", naver_id)
            _type_field("input#pw", naver_pw)

            # '로그인 상태 유지' 체크 — NID 쿠키를 지속형(persistent)으로 만들어 다음 실행이 재로그인
            # 없이 프로필 세션을 재사용하게 하는 핵심 레버. 이게 안 먹으면 NID_AUT/NID_SES 가 세션쿠키
            # (만료 없음)로 남아 런 종료 시 소멸 → 매 실행 재로그인 → 네이버 봇탐지 악순환(2026-07-20 실측).
            # 라벨 클릭이 숨은 체크박스에서 자주 빗나가므로 JS 로 확실히 checked=on 세팅 + 라벨 클릭 병행,
            # 최종 상태를 로그로 검증(제출 트리거는 아래 trusted 버튼 클릭이므로 서버가 keep=on 을 받는다).
            keep_state = "미확인"
            try:
                keep_state = page.evaluate("""() => {
                    const el = document.querySelector('#keep, input[name=keep], input#nvlong, input[name=nvlong]');
                    if (!el) return 'no-checkbox';
                    if (!el.checked) {
                        el.checked = true;
                        el.dispatchEvent(new Event('input', {bubbles: true}));
                        el.dispatchEvent(new Event('change', {bubbles: true}));
                    }
                    return el.checked ? 'checked' : 'uncheck-failed';
                }""")
                try:
                    lbl = page.locator("label[for=keep], label[for=nvlong], .keep_check, .login_keep")
                    if lbl.count() > 0:
                        lbl.first.click(timeout=1500)  # 트러스티드 클릭 병행(짧은 타임아웃 — 없으면 스킵)
                except Exception:
                    pass  # 라벨 클릭 실패해도 JS 세팅으로 충분
                time.sleep(_rand(0.2, 0.4))
            except Exception as e:
                keep_state = f"오류:{str(e)[:40]}"
            log(f"  로그인 상태 유지: {keep_state}")

            # 제출 전 검증(사용자 제안 2026-07-20) — 필드 값이 의도한 자격증명과 정확히 일치할 때만
            # 로그인 제출. 불일치(덧붙음·오타·자동완성 잔재)면 자동 제출을 보류하고 수동 안내로 넘긴다.
            id_val = pw_val = ""
            try:
                id_val = page.locator("input#id").first.input_value()
                pw_val = page.locator("input#pw").first.input_value()
            except Exception:
                pass
            if id_val == naver_id and pw_val == naver_pw:
                # 제출은 비번 필드에서 Enter — 버튼 셀렉터(네이버 마크업 변동으로 타임아웃 이력)에
                # 의존하지 않는 표준 폼 제출. 실패 시 버튼 클릭 폴백.
                try:
                    page.locator("input#pw").first.press("Enter")
                except Exception:
                    try: page.locator("button#log\\.login, button[type=submit], .btn_login").first.click(timeout=3000)
                    except Exception: pass
                log("  ID/PW 입력·검증 완료(일치). 로그인 시도 중...")
                auto_filled = True
                time.sleep(3)
            else:
                # 값 자체는 로그에 남기지 않는다 — 길이만으로 진단(자격증명 노출 방지).
                log(f"  ⚠ 입력 검증 불일치 — 자동 제출 보류. id(입력 {len(id_val)}자/기대 {len(naver_id)}자) "
                    f"pw(입력 {len(pw_val)}자/기대 {len(naver_pw)}자). 열린 창에서 값 확인 후 직접 로그인해주세요.")
        except Exception as e:
            log(f"  자동 입력 실패: {e}")

    # 캡차 발생 시 안내
    if not auto_filled or "nidlogin" in page.url:
        log("  ┌─────────────────────────────────────────┐")
        log("  │  브라우저에서 직접 로그인해주세요          │")
        log("  │  (캡차 등 보안 인증 포함)                │")
        log("  │  로그인 완료 시 자동 진행됩니다           │")
        log("  └─────────────────────────────────────────┘")

    SKIP_TEXTS    = ["나중에 등록", "나중에 하기", "다음에 등록", "건너뛰기", "나중에", "등록안함"]
    CONFIRM_TEXTS = ["확인", "닫기", "완료", "계속", "다음", "OK"]
    deadline = time.time() + 600  # 10분으로 연장
    last_url = ""
    last_action_time = time.time()

    while time.time() < deadline:
        time.sleep(1.5)
        url = page.url
        if url != last_url:
            log(f"  URL: {url[:80]}")
            last_url = url
        if "blog.naver.com" in url and "nidlogin" not in url and "auth" not in url:
            log("  로그인 완료!")
            return
        if time.time() - last_action_time > 2:
            clicked = js_click(page, SKIP_TEXTS)
            if clicked:
                log(f"  자동 클릭: '{clicked}'")
                last_action_time = time.time()
                time.sleep(2)
                continue
            clicked = js_click(page, CONFIRM_TEXTS)
            if clicked:
                log(f"  자동 클릭: '{clicked}'")
                last_action_time = time.time()
                time.sleep(2)
                continue
        elapsed = int(time.time() - last_action_time)
        if elapsed > 0 and elapsed % 30 == 0:
            log(f"  대기 중... (남은 시간: {int(deadline - time.time())}초)")

    log("ERROR: 로그인 10분 초과.")
    sys.exit(1)


# ── 도움말 팝업 닫기 ────────────────────────────────────────────────────────
def dismiss_help_panels(page):
    closed = page.evaluate("""() => {
        const closed = [];
        const sels = [
            '.se-help-panel button',
            '[class*="help"] button',
            '[class*="guide"] button',
            '[class*="tour"] button',
            '[class*="tooltip"] button',
            '[class*="onboard"] button',
            '[class*="popup"] button.close',
            'button[class*="close"]',
            'button[class*="Close"]',
            'button[aria-label*="닫기"]',
            '.btn_close',
            '.se-help-panel-close',
        ];
        for (const sel of sels) {
            document.querySelectorAll(sel).forEach(btn => {
                if (btn.offsetParent !== null) {
                    btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                    closed.push(sel);
                }
            });
        }
        return closed;
    }""")
    if closed:
        log(f"  [도움말 팝업] {len(closed)}개 닫음")
        time.sleep(0.8)


# ── 에디터 팝업 닫기 ────────────────────────────────────────────────────────
def dismiss_editor_popup(page):
    page.evaluate("""() => {
        const popups = document.querySelectorAll(
            '.se-popup-alert:not([style*="display: none"])'
        );
        for (const popup of popups) {
            if (popup.offsetParent === null) continue;
            const btns = [...popup.querySelectorAll('button')];
            const ok = btns.find(b => ['확인','닫기','OK','예'].includes(b.textContent.trim()));
            const target = ok || btns[btns.length - 1];
            if (target) target.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
        }
    }""")


def set_representative_image(page):
    """
    첫 번째 이미지를 대표사진(썸네일)으로 설정.

    네이버 블로그에서 대표사진은 검색 결과 썸네일로 노출됨.
    SE ONE은 자동으로 첫 이미지를 대표사진으로 사용하지 않으므로 명시적 설정 필요.

    시도 순서:
    1. SE ONE _documentService.setRepresentativeImage() API
    2. 이미지 컴포넌트 우클릭 → '대표사진으로 설정' 컨텍스트 메뉴
    3. 상단 '대표사진' / '썸네일' 버튼 클릭
    """
    result = page.evaluate("""() => {
        // ── 방법 1: SE ONE API 직접 호출 ────────────────────────────────
        try {
            const ed = window.SE?.launcher?._editors?.blogpc001;
            const ds = ed?._documentService;
            if (ds) {
                const docData = ds.getDocumentData();
                const imageComp = docData?.document?.components?.find(
                    c => c['@ctype'] === 'image'
                );
                if (imageComp) {
                    // setRepresentativeImage / setCoverImage / setThumbnail
                    const fn = ds.setRepresentativeImage
                        || ds.setCoverImage
                        || ds.setThumbnailImage
                        || (ed && ed.setRepresentativeImage);
                    if (fn) {
                        fn.call(ds, imageComp.id || imageComp);
                        return 'api:ok';
                    }
                    // representativeImageId 필드 직접 설정
                    if (docData.document.representativeImageId !== undefined) {
                        const newDoc = JSON.parse(JSON.stringify(docData));
                        newDoc.document.representativeImageId = imageComp.id;
                        ds.setDocumentData(newDoc);
                        return 'api:representativeImageId';
                    }
                }
            }
        } catch(e) {}

        // ── 방법 2: 대표사진 버튼 클릭 ──────────────────────────────────
        const allBtns = [...document.querySelectorAll(
            'button, span[role=button], a[role=button], div[role=button]'
        )];
        const keywords = ['대표사진', '대표 사진', '썸네일', 'thumbnail', 'cover', 'representative'];
        for (const kw of keywords) {
            const btn = allBtns.find(b => {
                const t = (b.textContent || '') + (b.getAttribute('aria-label') || '') + (b.getAttribute('data-name') || '');
                return t.toLowerCase().includes(kw.toLowerCase()) && b.offsetParent !== null;
            });
            if (btn) {
                btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                return 'btn:' + kw;
            }
        }

        return 'not_found';
    }""")
    log(f"  [대표사진] {result}")


def handle_draft_popup(page):
    """임시저장 불러오기 팝업 → '새로 작성' 클릭."""
    result = page.evaluate("""() => {
        const popup = document.querySelector('.se-popup.se-popup-alert-confirm, .se-popup-alert');
        if (!popup || popup.style.display === 'none') return 'no_popup';
        const freshTexts = ['새로 작성', '취소', '아니요', '닫기'];
        const btns = [...popup.querySelectorAll('button, a')];
        for (const text of freshTexts) {
            const btn = btns.find(b => b.textContent.trim().includes(text));
            if (btn) {
                btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                return 'clicked:' + text;
            }
        }
        return 'no_btn';
    }""")
    if result != "no_popup":
        log(f"  [임시저장 팝업] {result}")


# 본문 기본 글자 크기 — 네이버 블로그 가독성 표준(16pt). 소제목은 make_heading_para 가 별도.
BODY_FONT_PT = "16pt"


# ── SE ONE 문서 데이터 변환 ────────────────────────────────────────────────
def make_text_node(value: str, bold: bool = False, italic: bool = False) -> dict:
    span_style = f"font-size:{BODY_FONT_PT};"
    if bold:
        span_style += "font-weight:bold;"
    if italic:
        span_style += "font-style:italic;"
    return {
        "@ctype":    "textNode",
        "id":        uid(),
        "value":     value,
        "spanStyle": span_style,
    }


def make_heading_para(text: str, level: str = "HEADING1") -> dict:
    # 네이버 블로그 소제목은 '큰 글씨 + 굵게'로 만든다(paragraphStyle=HEADING 은 SE 가 밋밋하게 덮어써
    # 효과가 없어 제거). H2 26pt · H3 22pt — 본문 16pt 와 뚜렷이 차별화.
    font_size = "26pt" if level == "HEADING1" else "22pt"
    return {
        "@ctype":  "paragraph",
        "id":      uid(),
        "nodes": [{
            "@ctype":    "textNode",
            "id":        uid(),
            "value":     text,
            "spanStyle": f"font-size:{font_size};font-weight:bold;",
        }],
    }


def make_body_para(text: str) -> dict:
    # 굵게(**)·이탤릭(*·_) 세그먼트를 각각 textNode 로 — 서식이 실제 SE 스타일로 반영.
    nodes = [make_text_node(seg, bold=b, italic=it)
             for seg, b, it in parse_inline_segments(text) if seg]
    return {
        "@ctype": "paragraph",
        "id":     uid(),
        "nodes":  nodes or [make_text_node(text)],
    }


def make_text_comp(paragraphs: list) -> dict:
    return {
        "@ctype":  "text",
        "id":      uid(),
        "layout":  "default",
        "value":   paragraphs,
    }


# ── 리치 컴포넌트 빌더 (SE ONE 실측 스키마 기반) ─────────────────────────────
def make_quotation(paragraphs: list, layout: str = "line") -> dict:
    """인용구 — layout: default|line|corner|postit|bubble. value=문단들, source=출처(선택)."""
    return {"@ctype": "quotation", "id": uid(), "layout": layout,
            "value": paragraphs or [make_body_para("")], "source": None}


def make_divider() -> dict:
    """구분선(horizontalLine)."""
    return {"@ctype": "horizontalLine", "id": uid(), "layout": "default", "align": "left"}


def make_code(code_text: str) -> dict:
    """소스코드 — codeContents 에 코드 문자열."""
    return {"@ctype": "code", "id": uid(), "layout": "default",
            "fontSizeCode": "fs13", "codeContents": code_text, "align": "left"}


def make_table(rows: list) -> dict:
    """표 — rows: [[셀텍스트,...], ...] (첫 행=헤더). 셀 value 는 text 컴포넌트."""
    ncol = max((len(r) for r in rows), default=1) or 1
    w = round(100.0 / ncol, 2)

    def cell(text: str) -> dict:
        text = (text or "").strip()
        # 셀 value 는 문단(paragraph) 배열 — 빈 셀은 null(SE 실측 형태).
        return {"@ctype": "tableCell", "id": uid(), "colSpan": 1, "rowSpan": 1,
                "width": w, "height": 43,
                "value": [make_body_para(text)] if text else None}

    trows = [{"@ctype": "tableRow",
              "cells": [cell(r[i] if i < len(r) else "") for i in range(ncol)]}
             for r in rows]
    return {"@ctype": "table", "id": uid(), "layout": "default", "align": "left",
            "width": 100, "rows": trows, "columnCount": ncol, "borderStyleName": "thinLine"}


_TABLE_SEP_RE = re.compile(r"^:?-{2,}:?$")
# 사람 경로가 명령으로 처리 못 하는 블록만 API 로 강제 — 소스코드(```)·표(|).
# 인용구(>)·구분선(---)은 사람 경로에서 툴바 명령으로 삽입하므로 여기서 제외(스타일과 공존).
_RICH_LINE_RE = re.compile(r"^(?:```|\|)")


def _has_rich_blocks(se_text: dict) -> bool:
    """본문에 소스코드(```)·표(|) 블록이 있으면 True(사람 타이핑 불가 → API 렌더). 인용구·구분선은 제외."""
    for s in se_text.get("sections", []):
        for ln in (s.get("body", "") or "").split("\n"):
            if _RICH_LINE_RE.match(ln.strip()):
                return True
    return False


def parse_body_to_comps(body: str) -> list:
    """본문 마크다운을 SE 컴포넌트 목록으로 파싱 — 문단(굵게)·인용구(>)·구분선(---)·소스코드(```)·표(|).
    글 성격에 맞게 작가가 넣은 마크업이 실제 SE 리치 컴포넌트가 된다."""
    comps: list = []
    para_buf: list = []
    quote_buf: list = []
    table_buf: list = []

    def flush_paras():
        if para_buf:
            comps.append(make_text_comp(list(para_buf)))
            para_buf.clear()

    def flush_quote():
        if quote_buf:
            comps.append(make_quotation(list(quote_buf[:2])))   # 인용구는 최대 2줄
            if len(quote_buf) > 2:                               # 초과분은 본문 문단으로
                comps.append(make_text_comp(list(quote_buf[2:])))
            quote_buf.clear()

    def flush_table():
        if table_buf:
            rows = [r for r in table_buf
                    if not (r and all(_TABLE_SEP_RE.match(c.strip()) for c in r if c.strip()))]
            if rows:
                comps.append(make_table(rows))
            table_buf.clear()

    lines = body.split("\n")
    i = 0
    while i < len(lines):
        raw = lines[i].rstrip()
        s = raw.strip()
        # 소스코드 펜스
        if s.startswith("```"):
            flush_paras(); flush_quote(); flush_table()
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            comps.append(make_code("\n".join(code_lines)))
            i += 1
            continue
        # 표 행
        if s.startswith("|") and s.count("|") >= 2:
            flush_paras(); flush_quote()
            table_buf.append([c.strip() for c in s.strip("|").split("|")])
            i += 1
            continue
        flush_table()
        # 구분선
        if re.match(r"^(?:-{3,}|\*{3,}|_{3,})$", s):
            flush_paras(); flush_quote()
            comps.append(make_divider())
            i += 1
            continue
        # 인용구
        q = re.match(r"^>\s?(.*)$", s)
        if q:
            flush_paras()
            quote_buf.append(make_body_para(q.group(1)))
            i += 1
            continue
        flush_quote()
        if s:
            para_buf.append(make_body_para(s))
        i += 1
    flush_paras(); flush_quote(); flush_table()
    return comps


def build_document_components(smarteditor_text: dict) -> list:
    """
    smarteditor_text의 sections를 '섹션별 컴포넌트 그룹' 목록으로 변환(그룹당 여러 SE 컴포넌트 가능 —
    소제목 text + 인용구/구분선/코드/표/본문 text). 이미지는 그룹 뒤에 삽입돼 위치 정합이 유지된다.
    반환: List[List[component]] — 각 원소가 한 섹션의 컴포넌트들.
    heading_level: "HEADING1"(H2) | "HEADING2"(H3).
    """
    sections = smarteditor_text.get("sections", [])
    groups: list = []
    for section in sections:
        heading = section.get("heading", "")
        body    = section.get("body", "")
        level   = section.get("heading_level", "HEADING1")
        group: list = []
        if heading:
            group.append(make_text_comp([make_heading_para(heading, level)]))
        group.extend(parse_body_to_comps(body))
        groups.append(group)
    return groups


# ── 사람처럼 입력 (봇 탐지 회피 + 자연스러운 작성) ─────────────────────────────
def _rand(a: float, b: float) -> float:
    return a + random.random() * (b - a)


def human_typing_enabled() -> bool:
    """기본 활성 — NAVER_HUMAN_TYPING=false/0/off 로만 끈다(끄면 setDocumentData 일괄 주입)."""
    return os.environ.get("NAVER_HUMAN_TYPING", "true").strip().lower() not in ("0", "false", "no", "off")


def hybrid_rich_enabled() -> bool:
    """표/코드가 있는 글도 본문은 사람 타이핑하고 표·코드만 컴포넌트로 스플라이스(기본 활성).
    NAVER_HYBRID_RICH=false/0/off 로 끄면 예전처럼 글 전체를 SE 문서 API 로 배치 주입한다(킬스위치)."""
    return os.environ.get("NAVER_HYBRID_RICH", "true").strip().lower() not in ("0", "false", "no", "off")


def human_type(page, text: str):
    """한 글자씩 가변 속도로 입력 — 문장부호 뒤 쉼, 가끔 생각하는 듯한 멈춤(사람 타이핑 리듬)."""
    for ch in text:
        page.keyboard.type(ch)
        d = _rand(0.02, 0.06)
        if ch == " ":
            d += _rand(0.0, 0.04)
        elif ch in ".!?…":
            d += _rand(0.10, 0.30)
        elif ch in ",·、:;":
            d += _rand(0.04, 0.12)
        if random.random() < 0.01:
            d += _rand(0.3, 0.9)  # 문장 중간 잠깐 생각
        time.sleep(d)


def human_type_rich(page, text: str):
    """굵게(**)·이탤릭(*·_)을 사람처럼 반영 — 구간 앞뒤로 굵게/이탤릭 단축키(Cmd/Ctrl+B, Cmd/Ctrl+I)
    토글 후 타이핑. 숫자 단축키와 달리 B·I 는 Chrome 이 안 가로채고 편집영역 서식 토글로 동작한다."""
    for seg, bold, italic in parse_inline_segments(text):
        if not seg:
            continue
        if bold:
            page.keyboard.press("ControlOrMeta+b"); time.sleep(_rand(0.05, 0.12))
        if italic:
            page.keyboard.press("ControlOrMeta+i"); time.sleep(_rand(0.05, 0.12))
        human_type(page, seg)
        if italic:
            page.keyboard.press("ControlOrMeta+i"); time.sleep(_rand(0.05, 0.12))
        if bold:
            page.keyboard.press("ControlOrMeta+b"); time.sleep(_rand(0.05, 0.12))


def _active_info(page) -> dict:
    """현재 activeElement 상세(진단·검증 공용)."""
    try:
        return page.evaluate("""() => {
            const a = document.activeElement;
            if (!a) return {none: true};
            return { tag: a.tagName, name: a.getAttribute('name') || a.name || '', id: a.id || '',
                cls: (a.className && a.className.toString ? a.className.toString() : '').slice(0,80),
                editable: !!a.isContentEditable,
                inTitle: !!a.closest('.se-title-text, .se-documentTitle, [data-type="title"]'),
                inContent: !!a.closest('.se-content') };
        }""")
    except Exception as e:
        return {"err": str(e)[:60]}


def focus_body_editor(page, run_dir: str = None) -> bool:
    """본문 편집 영역에 커서를 놓고 '제목이 아님'을 검증한다. 클릭 후 activeElement 를 추적 파일로 남긴다.
    검증 실패면 False → 호출자는 깨끗한 API 경로로 폴백."""
    trace = []
    # 본문 문단(.se-text-paragraph, 제목 컨테이너 제외)을 좌표로 클릭 — 여러 후보 시도.
    try:
        positions = page.evaluate("""() => {
            const paras = [...document.querySelectorAll('.se-text-paragraph')];
            const bodies = paras.filter(p => !p.closest('.se-title-text') && !p.closest('.se-documentTitle') && !p.closest('[data-type="title"]'));
            return bodies.slice(0,3).map(b => { const r = b.getBoundingClientRect();
                return { x: Math.round(r.x + Math.min(40, r.width/2)), y: Math.round(r.y + r.height/2), w: Math.round(r.width), h: Math.round(r.height) }; })
                .filter(p => p.w > 2 && p.h > 2);
        }""") or []
    except Exception:
        positions = []
    ok = False
    for pos in positions:
        try:
            page.mouse.click(pos["x"], pos["y"])
            time.sleep(0.4)
            info = _active_info(page)
            trace.append({"click": pos, "active": info})
            if not info.get("inTitle") and (
                info.get("editable") or info.get("inContent")
                or (info.get("tag") == "IFRAME" and "input_buffer" in ((info.get("id") or "") + (info.get("name") or "")).lower())):
                ok = True
                break
        except Exception as e:
            trace.append({"click": pos, "err": str(e)[:60]})
    if not ok:
        # 폴백 셀렉터 클릭.
        for sel in [".se-component.se-text .se-text-paragraph", ".se-content .se-text-paragraph"]:
            try:
                page.locator(sel).first.click(timeout=3000)
                time.sleep(0.4)
                info = _active_info(page)
                trace.append({"sel": sel, "active": info})
                if not info.get("inTitle") and (info.get("editable") or info.get("inContent")
                        or (info.get("tag") == "IFRAME" and "input_buffer" in ((info.get("id") or "") + (info.get("name") or "")).lower())):
                    ok = True
                    break
            except Exception as e:
                trace.append({"sel": sel, "err": str(e)[:60]})
    if run_dir:
        try:
            with open(os.path.join(run_dir, "focus_trace.json"), "w", encoding="utf-8") as f:
                json.dump({"ok": ok, "trace": trace}, f, ensure_ascii=False, indent=1)
        except Exception:
            pass
    return ok


def insert_divider_ui(page):
    """구분선 삽입 — 툴바 버튼(명령). setDocumentData 를 안 쓰므로 앞뒤 텍스트 스타일 보존."""
    dismiss_editor_popup(page)
    try:
        page.locator("button[data-name='horizontal-line']").first.click(timeout=3000)
        time.sleep(0.7)
        dismiss_editor_popup(page)
        time.sleep(0.3)
    except Exception as e:
        log(f"  구분선 삽입 실패(무해): {str(e)[:50]}")


def convert_quotes_and_ai(page, quote_texts: list) -> str:
    """평문으로 타이핑된 '인용구 문단'을 네이티브 인용구(quotation) 컴포넌트로 변환하고, 이미지는
    'AI 활용(ai:true)' 표시를 켠다 — 단 한 번의 setDocumentData(순서·구조 보존). 스타일(굵게)은 이 호출
    '이후' 명령으로 다시 입힌다(문서 API 가 spanStyle 을 제거하므로). 반환: 'ok:quotes=N' 등 상태."""
    return page.evaluate("""(quoteTexts) => {
        const ds = window.SE?.launcher?._editors?.blogpc001?._documentService;
        if (!ds) return 'no_ds';
        const rid = () => 'g'+Math.random().toString(36).slice(2,10);
        const norm = s => (s||'').replace(/\\s+/g,' ').trim();
        const targets = quoteTexts.map(norm).filter(Boolean);
        const used = new Set();
        const doc = ds.getDocumentData();
        const out = [];
        for (const c of doc.document.components) {
            const ct = c['@ctype'];
            if (ct === 'image') { c.ai = true; out.push(c); continue; }   // 이미지 AI 활용 표시 ON
            if (ct !== 'text') { out.push(c); continue; }                  // 구분선 등 구조 컴포넌트 보존
            let run = [];
            const flush = () => { if (run.length) { out.push({...c, id: rid(), value: run}); run = []; } };
            for (const p of (c.value||[])) {
                const t = norm((p.nodes||[]).map(n=>n.value||'').join(''));
                if (t && targets.includes(t) && !used.has(t)) {           // 인용구 대상 문단 → 인용구 컴포넌트
                    used.add(t);
                    flush();
                    out.push({'@ctype':'quotation', id: rid(), layout:'line', value:[p], source:null});
                } else {
                    run.push(p);
                }
            }
            flush();
        }
        doc.document.components = out;
        try { ds.setDocumentData(doc); } catch(e){ return 'error:'+e.message; }
        return 'ok:quotes='+used.size+'/'+targets.length;
    }""", quote_texts)


def toggle_image_ai_ui(page):
    """업로드 직후 선택된 이미지의 'AI 활용 설정' 토글 ON(UI 명령 — setDocumentData 는 스타일 제거하므로)."""
    try:
        page.evaluate("""() => {
            const els = [...document.querySelectorAll('*')].filter(e =>
                e.offsetParent !== null && (e.textContent||'').replace(/\\s/g,'').includes('AI활용'));
            const target = els.sort((a,b)=>(a.textContent||'').length-(b.textContent||'').length)[0];
            if (!target) return;
            const inp = (target.closest('label')||target).querySelector?.('input[type=checkbox]')
                || target.parentElement?.querySelector?.('input[type=checkbox]');
            if (inp) { if (!inp.checked) inp.click(); }
            else { (target.closest('label,button,[role=switch]')||target).click(); }
        }""")
        time.sleep(0.4)
    except Exception:
        pass


def type_body_human(page, se_text: dict, images: list, issues: list) -> tuple:
    """
    본문을 '사람처럼' 입력한다 — 문단은 한 글자씩 타이핑하고 사이사이 Enter, 이미지는 해당 위치에서
    이미지 버튼으로 삽입(사람이 사진 올리듯). 소제목·인용구는 '평문'으로 순서대로 타이핑만 하고, 굵게·
    인용구 박스는 타이핑 이후 write_post 에서 (변환 setDocumentData → 명령 굵게) 순으로 입힌다.
    표(|)·소스코드(```)는 키 입력 불가 → 위치에 플레이스홀더 문단을 타이핑하고 (마커, 컴포넌트)를
    모아 반환한다. write_post 가 타이핑 후 splice_rich_blocks 로 실제 표/코드 컴포넌트로 교체한다.
    반환: (headings[{text,level}], quote_texts[str], rich_blocks[(marker,comp)], upload_count)
    """
    sections = se_text.get("sections", [])
    image_positions = se_text.get("image_positions", [])
    img_by_slot = {}
    for pos, entry in enumerate(images):
        img_by_slot[entry.get("index", pos)] = entry
    after_map = {}
    for p in image_positions:
        after_map.setdefault(p["after_section"], []).append(p["image_index"])

    img_btn = page.locator("button[data-name='image']").first
    headings = []
    quote_texts = []   # 평문으로 타이핑한 인용구 문단 텍스트 — 타이핑 후 setDocumentData 로 인용구 변환.
    rich_blocks = []   # (마커, 표/코드 컴포넌트) — 위치에 플레이스홀더 타이핑 후 splice_rich_blocks 로 교체.
    upload_count = [0]

    def insert_image(slot_idx: int):
        entry = img_by_slot.get(slot_idx)
        img_path = entry.get("file_path", "") if entry else ""
        if not img_path or not Path(img_path).exists():
            issues.append(f"이미지(슬롯 {slot_idx+1}) 파일 없음 — 본문 삽입 생략")
            return
        dismiss_editor_popup(page)
        time.sleep(_rand(0.3, 0.7))
        for attempt in range(2):
            try:
                with page.expect_file_chooser(timeout=12000) as fc:
                    img_btn.dispatch_event("click")
                fc.value.set_files(str(img_path))
                time.sleep(7)
                upload_count[0] += 1
                toggle_image_ai_ui(page)  # AI 활용 표시 ON(UI 토글 — 스타일 보존 위해 setDocumentData 대신)
                dismiss_editor_popup(page)
                time.sleep(_rand(0.5, 1.0))
                return
            except Exception as e:
                log(f"  이미지 업로드 시도{attempt+1} 실패: {str(e)[:60]}")
                dismiss_editor_popup(page)
                time.sleep(1.5)
        issues.append(f"이미지(슬롯 {slot_idx+1}) 업로드 실패 — 본문 삽입 생략")

    # first_block=True 면 이 블록 앞에 Enter 를 넣지 않는다(초기 빈 문단·이미지 직후 = 이미 새 문단).
    first_block = True

    def newline_before():
        nonlocal first_block
        if first_block:
            first_block = False
            return
        page.keyboard.press("Enter")
        time.sleep(_rand(0.1, 0.3))

    for slot in after_map.get(-1, []):  # 본문 맨 앞 이미지
        insert_image(slot)
        first_block = True

    for i, section in enumerate(sections):
        heading = section.get("heading", "").strip()
        body = section.get("body", "")
        level = section.get("heading_level", "HEADING1")
        if heading:
            newline_before()
            # 소제목 = 굵게 ON → 타이핑 → 굵게 OFF(다음 문단 서식 상속 방지). 명령 굵게는 SE 내부 모델에
            # 저장돼 인용구 변환 setDocumentData 를 거쳐도 유지된다(spanStyle 이 아니므로 제거 대상 아님).
            page.keyboard.press("ControlOrMeta+b")
            time.sleep(0.12)
            human_type(page, heading)
            page.keyboard.press("ControlOrMeta+b")
            time.sleep(0.12)
            headings.append({"text": heading, "level": level})
        body_lines = body.split("\n")
        k = 0
        while k < len(body_lines):
            line = body_lines[k].strip()
            if not line:
                k += 1
                continue
            # 소스코드 펜스(```) — 키 입력 불가 → 플레이스홀더 문단을 타이핑하고, 타이핑 후 splice 로
            # 실제 코드 컴포넌트로 교체(하이브리드: 본문은 사람 타이핑, 표/코드만 컴포넌트).
            if line.startswith("```"):
                code_lines = []
                k += 1
                while k < len(body_lines) and not body_lines[k].strip().startswith("```"):
                    code_lines.append(body_lines[k])   # 코드는 원문 그대로(strip 안 함)
                    k += 1
                k += 1  # 닫는 ``` 소비
                marker = f"RICHBLOCK-{len(rich_blocks)}-PLACEHOLDER"  # 순수 ASCII — insertText 변형 위험 제거
                newline_before()
                human_type(page, marker)
                rich_blocks.append((marker, make_code("\n".join(code_lines))))
                continue
            # 표(|) — 연속된 표 행 수집 → 플레이스홀더 타이핑 후 splice 로 표 컴포넌트 교체.
            if line.startswith("|") and line.count("|") >= 2:
                trows = []
                while k < len(body_lines):
                    tl = body_lines[k].strip()
                    if not (tl.startswith("|") and tl.count("|") >= 2):
                        break
                    cells = [c.strip() for c in tl.strip("|").split("|")]
                    if not all(_TABLE_SEP_RE.match(c) for c in cells if c):  # 구분행(---) 제외
                        trows.append(cells)
                    k += 1
                if trows:
                    marker = f"RICHBLOCK-{len(rich_blocks)}-PLACEHOLDER"  # 순수 ASCII — insertText 변형 위험 제거
                    newline_before()
                    human_type(page, marker)
                    rich_blocks.append((marker, make_table(trows)))
                continue
            # 구분선(---) — 툴바 명령 삽입.
            if re.match(r"^(?:-{3,}|\*{3,}|_{3,})$", line):
                insert_divider_ui(page)
                first_block = True
                k += 1
                continue
            # 인용구(연속된 >) — '평문 문단'으로 순서대로 타이핑(캐럿 싸움 없음). 타이핑 후 그 문단을
            # setDocumentData 로 인용구 컴포넌트로 변환한다. 최대 2줄(합쳐 한 문단), 초과분은 본문 문단으로.
            mq = re.match(r"^>\s?(.*)$", line)
            if mq:
                qlines = [mq.group(1)]
                k += 1
                while k < len(body_lines):
                    m2 = re.match(r"^>\s?(.*)$", body_lines[k].strip())
                    if not m2:
                        break
                    qlines.append(m2.group(1))
                    k += 1
                qlines = [q.strip() for q in qlines if q.strip()]
                qtext = " ".join(qlines[:2])            # 인용구는 2줄까지 — 한 문단으로 합쳐 타이핑
                if qtext:
                    newline_before()
                    human_type(page, qtext)             # 평문으로 타이핑(순서 보존) → 나중에 인용구로 변환
                    quote_texts.append(qtext)
                for extra in qlines[2:]:                # 초과분은 일반 본문 문단
                    newline_before()
                    human_type_rich(page, extra)
                continue
            # 일반 문단
            newline_before()
            human_type_rich(page, line)  # 굵게·이탤릭 반영
            k += 1
        for slot in after_map.get(i, []):
            newline_before()  # 직전이 이미지면(first_block) Enter 생략 → 이미지 사이 빈 문단 방지
            insert_image(slot)
            first_block = True  # 이미지 직후는 새 문단 — 다음 블록 앞 Enter 생략

    return headings, quote_texts, rich_blocks, upload_count[0]


def splice_rich_blocks(page, rich_blocks: list) -> str:
    """타이핑된 플레이스홀더 문단(RICHBLOCK-N-PLACEHOLDER)을 실제 표/코드 컴포넌트로 교체 — 한 번의 setDocumentData.
    본문은 사람 타이핑으로 남기고 표·코드만 정확한 위치에 끼워 넣는다(하이브리드). 매칭 실패한 블록은
    플레이스홀더가 남아 issue 로 보고된다(무해 degrade). documentService 없으면 무해 스킵."""
    if not rich_blocks:
        return "no_blocks"
    mapping = {marker: comp for marker, comp in rich_blocks}
    # 마커 문단은 소제목·본문과 함께 하나의 text 컴포넌트에 병합돼 있다(SE 는 연속 문단을 non-text
    # 컴포넌트로만 분리). 따라서 문단 단위로 스캔해 text 컴포넌트를 [앞 문단들][표/코드][뒤 문단들] 로
    # 쪼개 교체한다(컴포넌트 전체 텍스트 매칭은 병합 때문에 실패).
    return page.evaluate(
        """(mapping) => {
        const ds = window.SE?.launcher?._editors?.blogpc001?._documentService;
        if (!ds) return 'no_ds';
        const norm = s => (s||'').replace(/\\s+/g,'').trim();
        const keys = Object.create(null);
        for (const k of Object.keys(mapping)) keys[norm(k)] = mapping[k];
        let seq = 0;
        const newId = () => 'SE-splice-' + Date.now() + '-' + (seq++);
        const textComp = paras => ({ '@ctype': 'text', id: newId(), layout: 'default', value: paras });
        const doc = ds.getDocumentData();
        const out = [];
        let replaced = 0;
        for (const c of doc.document.components) {
            if (c['@ctype'] !== 'text') { out.push(c); continue; }
            const paras = c.value || [];
            let buf = [], hit = false;
            for (const para of paras) {
                const ptxt = norm((para.nodes||[]).map(n => n.value||'').join(''));
                if (Object.prototype.hasOwnProperty.call(keys, ptxt)) {
                    hit = true;
                    if (buf.length) { out.push(textComp(buf)); buf = []; }
                    out.push(keys[ptxt]);   // 마커 문단 → 표/코드 컴포넌트
                    replaced++;
                } else {
                    buf.push(para);
                }
            }
            if (!hit) { out.push(c); }                 // 마커 없음 → 원본 그대로(id 보존)
            else if (buf.length) { out.push(textComp(buf)); }
        }
        doc.document.components = out;
        const total = Object.keys(mapping).length;
        try { ds.setDocumentData(doc); return (replaced === total ? 'ok:' : 'partial:') + replaced + '/' + total; }
        catch(e){ return 'err:' + e.message; }
    }""",
        mapping,
    )


def apply_heading_styles(page, headings: list) -> str:
    """
    타이핑된 문단 중 제목 텍스트와 일치하는 것에 paragraphStyle(H2/H3)+굵은 큰 글씨만 반영한다.
    이미지·본문 컴포넌트는 위치·내용 그대로 보존(내용 주입 아님 — 스타일 메타만). 매칭 기반이라
    단축키가 안 먹혀도 최종 구조가 정확하고, documentService 없으면 무해하게 스킵(본문은 이미 저장됨).
    """
    if not headings:
        return "no_headings"
    return page.evaluate(
        """(headings) => {
        const ed = window.SE?.launcher?._editors?.blogpc001;
        const ds = ed?._documentService;
        if (!ds) return 'no_ds';
        const norm = s => (s||'').replace(/\\s+/g,' ').trim();
        // 프로토타입 오염 방지(Object.create(null)) + 텍스트별 레벨 큐 — 문서 순서대로 1회씩 소비해
        // 소제목과 우연히 같은 본문 줄이 제목으로 승격되지 않게 한다.
        const hq = Object.create(null);
        for (const h of headings) { const k = norm(h.text); (hq[k] || (hq[k] = [])).push(h.level); }
        const doc = ds.getDocumentData();
        let applied = 0;
        for (const c of doc.document.components) {
            if (c['@ctype'] !== 'text') continue;
            for (const para of (c.value || [])) {
                const txt = norm((para.nodes||[]).map(n => n.value||'').join(''));
                if (!txt) continue;
                const q = Object.prototype.hasOwnProperty.call(hq, txt) ? hq[txt] : null;
                const lvl = (q && q.length) ? q.shift() : null;
                if (lvl) {
                    // paragraphStyle=HEADING 은 SE 가 밋밋하게 덮어써 효과 없음 → 큰 글씨+굵게로 차별화.
                    if (para.paragraphStyle && /HEADING/.test(para.paragraphStyle)) delete para.paragraphStyle;
                    const size = lvl === 'HEADING1' ? '26pt' : '22pt';
                    for (const n of (para.nodes||[])) if (n['@ctype']==='textNode') n.spanStyle = 'font-size:'+size+';font-weight:bold;';
                    applied++;
                } else if (para.paragraphStyle && /HEADING/.test(para.paragraphStyle)) {
                    delete para.paragraphStyle;
                }
            }
        }
        try { ds.setDocumentData(doc); return 'ok:'+applied; }
        catch(e){ return 'error:'+e.message; }
    }""",
        headings,
    )


def bold_title_via_command(page) -> str:
    """제목 굵게 — 제목 필드 포커스 → 전체 선택 → Cmd/Ctrl+B(에디터 명령). setDocumentData 는 spanStyle 을
    제거하므로 굵게는 명령으로만 저장본에 남는다."""
    for sel in ["div.se-title-text", "div[data-type='title'] [contenteditable]", ".se-title-input"]:
        try:
            loc = page.locator(sel).first
            loc.click(timeout=3000)
            time.sleep(0.2)
            page.keyboard.press("ControlOrMeta+a")
            time.sleep(0.1)
            page.keyboard.press("ControlOrMeta+b")
            time.sleep(0.2)
            page.keyboard.press("End")  # 선택 해제
            return "ok"
        except Exception:
            continue
    return "no_title"


def set_images_ai(page) -> str:
    """모든 이미지 컴포넌트의 ai 필드를 true 로 설정 — 'AI 활용(생성) 이미지' 표시(사용자 요청).
    SE 이미지 컴포넌트에 ai 불리언 필드가 있어 documentService 로 직접 설정한다."""
    try:
        return str(page.evaluate("""() => {
            const ds = window.SE?.launcher?._editors?.blogpc001?._documentService;
            if (!ds) return 'no_ds';
            const doc = ds.getDocumentData();
            let n = 0;
            for (const c of doc.document.components) {
                if (c['@ctype'] === 'image') { c.ai = true; n++; }
            }
            if (n) { try { ds.setDocumentData(doc); } catch(e) { return 'err:' + e.message; } }
            return 'ok:' + n;
        }"""))
    except Exception as e:
        return 'err:' + str(e)[:60]


# ── 글쓰기 메인 함수 ───────────────────────────────────────────────────────
def publish_mode() -> str:
    """발행 방식 — 기본 'private_publish'(발행 레이어를 열어 태그+비공개로 실제 발행: 태그 확실히 저장,
    글은 비공개라 검토 후 사람이 전체공개로 전환). 킬스위치 NAVER_PUBLISH_MODE=draft 로 예전 임시저장 복귀.
    태그는 '발행 설정' 레이어에만 있어 임시저장으론 저장되지 않는다(2026-07-21 DOM 프로브 실증)."""
    return os.environ.get("NAVER_PUBLISH_MODE", "private_publish").strip().lower()


def publish_private_with_tags(page, tags: list, run_dir: str, issues: list) -> bool:
    """발행 레이어 → 태그 입력 → 공개설정=비공개 → 확정 발행. 태그는 이 레이어(input#tag-input)에만 있다.
    [하드 세이프가드] 비공개 라디오(input#open_private)가 checked 로 확인될 때만 확정 발행한다 — 확인 실패 시
    발행을 취소하고 False 반환(호출부가 임시저장으로 폴백). 실수로 '전체공개' 되는 것을 원천 차단.
    성공(비공개 발행 완료) 시 True."""
    try:
        # 1) 발행 레이어 열기 — 우상단 '발행' 버튼(publish_btn). 확정(confirm_btn) 아님.
        opened = page.evaluate("""() => {
            const b = [...document.querySelectorAll('button')].find(
                x => /publish_btn/.test(x.className) && x.textContent.trim() === '발행');
            if (b) { b.click(); return true; } return false; }""")
        if not opened:
            log("  발행 레이어 열기 실패(publish_btn 못 찾음) — 임시저장 폴백")
            return False
        # 태그 입력칸이 뜰 때까지 대기(레이어 렌더 확인)
        ti = page.locator("input#tag-input").first
        ti.wait_for(state="visible", timeout=6000)
        time.sleep(0.4)

        # 2) 태그 입력 — 칸 클릭 후 한 글자씩 + Enter(칩 변환)
        entered = 0
        for tag in tags:
            try:
                ti.click(); time.sleep(_rand(0.1, 0.25))
                human_type(page, tag)
                page.keyboard.press("Enter"); time.sleep(_rand(0.2, 0.4))
                entered += 1
            except Exception as e:
                log(f"  태그 '{tag}' 입력 실패: {str(e)[:40]}")
        log(f"  태그 {entered}/{len(tags)}개 입력(발행 레이어)")

        # 3) 공개설정=비공개 — 라디오 input + 라벨 병행 클릭(React 핸들러 확실히 트리거)
        page.evaluate("""() => {
            const r = document.querySelector('input#open_private');
            if (r) { r.click();
                const lb = r.closest('label') || document.querySelector('label[for=open_private]');
                if (lb) lb.click(); } }""")
        time.sleep(0.5)

        # 4) [하드 세이프가드] 비공개가 실제 checked 인지 검증 — 아니면 절대 발행하지 않는다.
        is_private = page.evaluate("() => { const r=document.querySelector('input#open_private'); return !!(r && r.checked); }")
        if not is_private:
            log("  ⚠ 비공개 선택 확인 실패 — 확정 발행 취소(전체공개 위험 차단), 임시저장 폴백")
            issues.append("비공개 확인 실패 → 발행 안 함(임시저장 폴백)")
            try: page.keyboard.press("Escape")
            except Exception: pass
            return False
        log("  비공개 확인됨 ✓ — 확정 발행 진행")

        # 진단 스크린샷(발행 직전 레이어 상태)
        try:
            sd = os.path.join(run_dir, "screenshots"); os.makedirs(sd, exist_ok=True)
            page.screenshot(path=os.path.join(sd, "publish_layer.png"))
        except Exception:
            pass

        # 5) 확정 발행 — 레이어 하단 '발행'(confirm_btn). 비공개 검증 통과 후에만 도달.
        confirmed = page.evaluate("""() => {
            const b = [...document.querySelectorAll('button')].find(
                x => /confirm_btn/.test(x.className) && x.textContent.trim() === '발행');
            if (b) { b.click(); return true; } return false; }""")
        if not confirmed:
            log("  확정 발행 버튼(confirm_btn) 못 찾음 — 임시저장 폴백")
            try: page.keyboard.press("Escape")
            except Exception: pass
            return False
        time.sleep(4)  # 발행 처리·네비게이션 대기
        dismiss_editor_popup(page)
        log(f"  비공개 발행 완료 — {page.url}")
        return True
    except Exception as e:
        log(f"  비공개 발행 중 예외 — 임시저장 폴백: {str(e)[:80]}")
        issues.append(f"비공개 발행 실패(임시저장 폴백): {str(e)[:80]}")
        try: page.keyboard.press("Escape")
        except Exception: pass
        return False


def write_post(
    page,
    blog_id: str,
    final_content: dict,
    image_manifest: dict,
    run_dir: str,
) -> dict:
    se_text  = final_content.get("smarteditor_text", {})
    title    = se_text.get("title", final_content.get("final_title", ""))
    tags     = final_content.get("tags", [])
    images   = image_manifest.get("images", [])
    image_positions = se_text.get("image_positions", [])

    issues = []
    image_upload_count = 0

    # ── 글쓰기 페이지 이동 ────────────────────────────────────────────────
    write_url = f"https://blog.naver.com/{blog_id}/postwrite"
    log(f"\n[글쓰기] {write_url}")
    page.goto(write_url, wait_until="domcontentloaded", timeout=60000)
    time.sleep(5)

    if "nidlogin" in page.url:
        raise Exception("로그인 세션 만료 — 다시 로그인이 필요합니다.")

    # ── STEP 1: 도움말 팝업 닫기 ──────────────────────────────────────────
    log("\n[STEP 1] 도움말 팝업 닫기")
    dismiss_help_panels(page)
    time.sleep(1)
    dismiss_help_panels(page)
    time.sleep(0.5)

    # ── STEP 2: 임시저장 팝업 처리 ────────────────────────────────────────
    log("\n[STEP 2] 임시저장 팝업 처리")
    handle_draft_popup(page)
    time.sleep(1.5)

    human = human_typing_enabled()
    # 표(|)·소스코드(```) 는 키 입력으로 못 만든다. 예전엔 이런 블록이 하나라도 있으면 글 전체를
    # setDocumentData 로 배치 주입해 '본문 전체가 통째 입력'됐다(2026-07-20 사용자 보고). 하이브리드:
    # 본문은 사람처럼 타이핑하고 표/코드만 해당 위치에 컴포넌트로 스플라이스한다(킬스위치로 즉시 되돌림).
    if human and _has_rich_blocks(se_text) and not hybrid_rich_enabled():
        human = False
        log("  표/코드 포함 + 하이브리드 off(NAVER_HYBRID_RICH) — SE 문서 API 일괄 경로")
    elif human and _has_rich_blocks(se_text):
        log("  표/코드 포함 — 하이브리드(본문 타이핑 + 표/코드 컴포넌트 스플라이스) 경로")
    log(f"  입력 모드: {'사람처럼 타이핑' if human else 'API 일괄(setDocumentData)'}")

    # ── STEP 3: 제목 입력 ─────────────────────────────────────────────────
    log(f"\n[STEP 3] 제목 입력: {title[:50]}...")
    for sel in [
        "div.se-title-text",
        "div[data-type='title'] [contenteditable]",
        ".tit_area [contenteditable]",
        "input#subject",
    ]:
        try:
            loc = page.locator(sel).first
            loc.click(timeout=3000)
            time.sleep(0.3)
            page.keyboard.press("ControlOrMeta+a")  # macOS=Cmd+a — 전체선택(Ctrl+a 는 줄시작 이동)
            page.keyboard.press("Delete")
            if human:
                human_type(page, title)       # 제목도 한 글자씩
            else:
                page.keyboard.type(title)
            log("  제목 입력 완료")
            break
        except Exception:
            continue
    time.sleep(0.5)

    # ── 사람처럼 입력 경로 — 본문을 타이핑하고 이미지를 위치에 삽입, 제목 스타일만 반영 ──
    image_comps = []  # 대표사진 설정(STEP 9)용 — 두 경로 모두에서 채운다.
    preexisting_image_ids = set()  # 폴백 시 제외할 '사람 경로에서 이미 삽입된' 이미지 컴포넌트 id.
    if human:
        log("\n[STEP 4~7] 본문 사람처럼 입력")
        if not focus_body_editor(page, run_dir):
            log("  ⚠ 본문 편집 영역 포커스 실패 — API 일괄 경로로 폴백(focus_trace.json 참조)")
            human = False
        else:
            try:
                headings, quote_texts, rich_blocks, image_upload_count = type_body_human(page, se_text, images, issues)
                log(f"  타이핑 완료 — 소제목 {len(headings)}개, 인용구 {len(quote_texts)}개, 표/코드 {len(rich_blocks)}개, 이미지 {image_upload_count}장")
                time.sleep(1.0)
                # ① 인용구 변환 + 이미지 AI 표시 — 단 한 번의 setDocumentData(순서·구조 보존, 스타일 제거).
                if quote_texts or image_upload_count:
                    conv = convert_quotes_and_ai(page, quote_texts)
                    log(f"  [인용구 변환] {conv}")
                    if isinstance(conv, str) and conv.startswith("error"):
                        issues.append(f"인용구 변환 실패: {conv}")
                    time.sleep(1.2)   # 재렌더 대기
                # ①-b 표/코드 스플라이스 — 타이핑한 플레이스홀더 문단을 실제 표·코드 컴포넌트로 교체.
                #     실패하면 플레이스홀더가 남고 표/코드 내용은 유실되므로 issue 로 보고(수동 발행 전 검토·
                #     NAVER_HYBRID_RICH=false 킬스위치로 즉시 기존 API 경로 복귀 가능).
                if rich_blocks:
                    sp = splice_rich_blocks(page, rich_blocks)
                    log(f"  [표/코드 스플라이스] {sp}")
                    if not (isinstance(sp, str) and sp.startswith("ok")):
                        issues.append(f"표/코드 삽입 실패(플레이스홀더 잔존 가능): {sp}")
                    time.sleep(1.2)   # 재렌더 대기
                # ② 소제목 굵게는 타이핑 중 명령(Cmd+B)으로 이미 반영됐고 변환을 거쳐도 유지된다(별도 재적용
                #    불필요 — JS Range 로 설정한 선택은 SE 굵게 명령이 인식하지 않는다).
                # ③ 대표사진용 이미지 컴포넌트 재조회 + 구조 덤프(검증용).
                time.sleep(0.5)
                doc_after = page.evaluate("""() => {
                    const ds = window.SE?.launcher?._editors?.blogpc001?._documentService;
                    return ds ? ds.getDocumentData() : null;
                }""")
                if doc_after:
                    image_comps = [c for c in doc_after["document"]["components"] if c.get("@ctype") == "image"]
                    try:
                        struct = []
                        for c in doc_after["document"]["components"]:
                            ct = c.get("@ctype")
                            txt = ""
                            if ct in ("text", "quotation"):
                                for para in (c.get("value") or []):
                                    txt += "".join(n.get("value", "") for n in (para.get("nodes") or []))
                            struct.append({"type": ct, "text": txt[:40]})
                        with open(os.path.join(run_dir, "doc_structure.json"), "w", encoding="utf-8") as f:
                            json.dump(struct, f, ensure_ascii=False, indent=1)
                    except Exception:
                        pass
            except Exception as e:
                log(f"  ⚠ 사람처럼 입력 중 오류 — API 일괄 경로로 폴백: {str(e)[:80]}")
                issues.append(f"사람처럼 입력 실패(폴백): {str(e)[:80]}")
                # 폴백 재업로드가 '사람 경로에서 이미 삽입한 이미지'를 자기 것으로 오인하지 않도록 id 스냅샷.
                try:
                    pre = page.evaluate("""() => {
                        const ds = window.SE?.launcher?._editors?.blogpc001?._documentService;
                        if (!ds) return [];
                        return ds.getDocumentData().document.components.filter(c => c['@ctype']==='image').map(c => c.id);
                    }""")
                    preexisting_image_ids = set(pre or [])
                except Exception:
                    preexisting_image_ids = set()
                image_comps = []
                human = False

    if not human:
        # ── STEP 4: 이미지 업로드 ────────────────────────────────────────────
        log(f"\n[STEP 4] 이미지 업로드 ({len(images)}장)")
        img_btn = page.locator("button[data-name='image']").first

        # 업로드 성공한 이미지의 '슬롯 순번'(순서 보존) — image_index 리매핑용.
        # 슬롯 순번은 매니페스트 엔트리의 "index" 필드가 정본(openai_image.py 가 기록) — 상류(TS)가
        # 실존 필터로 배열을 압축해도 보존된다. 없으면 enumerate 폴백(구형/모델 경유 매니페스트).
        uploaded_manifest_indices = []
        for i, img_info in enumerate(images):
            slot_idx = img_info.get("index", i)
            img_path = img_info.get("file_path", "")
            if not img_path or not Path(img_path).exists():
                log(f"  이미지 {i+1} 건너뜀 (파일 없음): {img_path}")
                issues.append(f"이미지 {i+1} 파일 없음 — 본문 삽입 생략: {img_path}")
                continue

            dismiss_editor_popup(page)
            time.sleep(0.5)

            uploaded = False
            for attempt in range(2):
                try:
                    with page.expect_file_chooser(timeout=12000) as fc_info:
                        img_btn.dispatch_event("click")
                    fc_info.value.set_files(str(img_path))
                    time.sleep(7)
                    log(f"  이미지 {i+1}/{len(images)} 업로드 완료")
                    image_upload_count += 1
                    uploaded_manifest_indices.append(slot_idx)
                    uploaded = True
                    break
                except Exception as e:
                    log(f"  이미지 {i+1} 시도{attempt+1} 실패: {str(e)[:60]}")
                    dismiss_editor_popup(page)
                    time.sleep(2)
            if not uploaded:
                issues.append(f"이미지 {i+1} 업로드 실패 — 본문 삽입 생략")

            dismiss_editor_popup(page)
            time.sleep(1)

        # ── STEP 5: 업로드된 이미지 컴포넌트 읽기 ─────────────────────────────
        log("\n[STEP 5] 이미지 컴포넌트 읽기")
        doc_data = page.evaluate("""() => {
            const ed = window.SE?.launcher?._editors?.blogpc001;
            const ds = ed?._documentService;
            if (!ds) return null;
            return ds.getDocumentData();
        }""")

        image_comps = []
        if doc_data:
            # 사람 경로에서 이미 삽입된 이미지(preexisting_image_ids)는 제외 — 이번 폴백이 재업로드한
            # 것만 업로드 순서대로 담아야 comp_for 위치 매핑이 밀리지 않는다.
            image_comps = [
                c for c in doc_data["document"]["components"]
                if c.get("@ctype") == "image" and c.get("id") not in preexisting_image_ids
            ]
            log(f"  이미지 컴포넌트 {len(image_comps)}개 확인")
        else:
            log("  ⚠ documentService 없음 — 텍스트만 삽입")

        # ── STEP 6: 본문 컴포넌트 조립 ────────────────────────────────────────
        log("\n[STEP 6] 본문 컴포넌트 조립")
        groups = build_document_components(se_text)  # 섹션별 컴포넌트 그룹(리치 컴포넌트 포함)
        log(f"  섹션 {len(groups)}개 · 컴포넌트 {sum(len(g) for g in groups)}개")

        # 이미지 삽입 위치에 따라 교차 배치
        # image_positions: [{"after_section": 0, "image_index": 0}, ...]
        # 같은 섹션 뒤 복수 이미지 허용(리스트 누적), after_section=-1 은 본문 맨 앞.
        # image_index 는 '매니페스트 순번' — 일부 업로드가 실패하면 에디터의 image_comps 순서가
        # 당겨지므로, 업로드 성공 인덱스 목록으로 리매핑한다(실패한 이미지 위치는 드롭).
        def comp_for(img_idx):
            if uploaded_manifest_indices:
                if img_idx in uploaded_manifest_indices:
                    pos = uploaded_manifest_indices.index(img_idx)
                    if pos < len(image_comps):
                        return image_comps[pos]
                return None
            # 리매핑 정보가 없으면(구형 호출 경로) 종전 동작 — 직접 인덱스
            return image_comps[img_idx] if img_idx < len(image_comps) else None

        img_pos_map = {}
        for pos in image_positions:
            img_pos_map.setdefault(pos["after_section"], []).append(pos["image_index"])
        final_comps = []
        for img_idx in img_pos_map.get(-1, []):
            comp = comp_for(img_idx)
            if comp is not None:
                final_comps.append(comp)
        for i, group in enumerate(groups):
            final_comps.extend(group)  # 섹션 그룹의 모든 컴포넌트(소제목·본문·인용구·구분선·코드·표)
            for img_idx in img_pos_map.get(i, []):
                comp = comp_for(img_idx)
                if comp is not None:
                    final_comps.append(comp)

        # ── STEP 7: SE ONE setDocumentData ────────────────────────────────────
        log("\n[STEP 7] SE ONE setDocumentData")
        result = page.evaluate("""(comps) => {
            const ed = window.SE?.launcher?._editors?.blogpc001;
            const ds = ed?._documentService;
            if (!ds) return 'error:no_documentService';

            const docData = ds.getDocumentData();
            const titleComp = docData.document.components.find(c => c['@ctype'] === 'documentTitle');

            const newDocData = JSON.parse(JSON.stringify(docData));
            newDocData.document.components = [
                ...(titleComp ? [titleComp] : []),
                ...comps
            ];

            try {
                ds.setDocumentData(newDocData);
                const textCount  = comps.filter(c => c['@ctype'] === 'text').length;
                const imageCount = comps.filter(c => c['@ctype'] === 'image').length;
                return 'ok: text=' + textCount + ' image=' + imageCount;
            } catch(e) {
                return 'error:' + e.message;
            }
        }""", final_comps)
        log(f"  setDocumentData 결과: {result}")
        time.sleep(1.5)

        if result and result.startswith("error"):
            issues.append(f"본문 삽입 실패: {result}")

    # ── 제목 굵게 — 에디터 명령(Cmd+B)으로 적용. SE 문서 API(setDocumentData)는 spanStyle 을
    #    제거하므로 굵게는 반드시 명령으로 해야 저장본에 남는다(setDocumentData 이후에 실행). ──
    log(f"  [title-bold] {bold_title_via_command(page)}")
    time.sleep(0.3)

    # ── 이미지 'AI 활용' 표시 ON — API 경로만 setDocumentData(ai:true). 사람 경로는 타이핑 중 UI 토글로
    #    이미 처리했다(여기서 setDocumentData 를 돌리면 명령으로 준 굵게·소제목 스타일이 전부 제거됨). ──
    if image_comps and not human:
        ai_result = set_images_ai(page)
        log(f"  [image-ai] AI 이미지 표시: {ai_result}")
        if ai_result.startswith("err"):
            issues.append(f"이미지 AI 표시 실패: {ai_result}")
        time.sleep(0.5)

    # ── STEP 8: 태그 입력 ─────────────────────────────────────────────────
    # 태그 필드는 에디터 하단에 있어 렌더·스크롤 전이면 셀렉터가 안 잡힌다 → 조용히 스킵되며 '어떤 땐
    # 태그 있고 어떤 땐 없음'을 유발(2026-07-20 사용자 보고). 하단 스크롤 + 셀렉터 보강 + 실패 시 issue·
    # 진단 덤프(조용한 스킵 금지)로 고친다.
    if tags and publish_mode() == 'draft':  # private_publish 는 발행 레이어에서 태그 입력(STEP 10)
        log(f"\n[STEP 8] 태그 입력(임시저장 모드): {tags[:5]} (총 {len(tags)}개)")
        try:  # 태그 영역을 뷰포트로 — 문서 끝으로 스크롤
            page.mouse.wheel(0, 24000)
            time.sleep(0.6)
        except Exception:
            pass
        tag_selectors = [
            "input[placeholder*='태그']",
            "input#tag-input", "#tagInput",
            ".se-tag-input input", "input.tag_input",
            "[class*='tag'] input[type='text']",
        ]
        entered = False
        for sel in tag_selectors:
            try:
                el = page.locator(sel).first
                if el.count() == 0 or not el.is_visible(timeout=2000):
                    continue
                el.scroll_into_view_if_needed(timeout=2000)
                for tag in tags:
                    el.click()
                    time.sleep(_rand(0.1, 0.25))
                    if human:
                        human_type(page, tag)  # 태그도 한 글자씩
                    else:
                        page.keyboard.type(tag)
                    page.keyboard.press("Enter")
                    time.sleep(_rand(0.2, 0.45))
                entered = True
                log(f"  태그 입력 완료 (셀렉터: {sel})")
                break
            except Exception as e:
                log(f"  태그 셀렉터 시도 실패 {sel}: {str(e)[:50]}")
                continue
        if not entered:
            # 조용한 스킵 금지 — issue 로 남기고 태그 후보 DOM 을 덤프(다음에 정확한 셀렉터 확정용).
            issues.append(f"태그 입력 실패 — 태그 필드 못 찾음(해시태그 {len(tags)}개 누락 가능)")
            log("  ⚠ 태그 필드를 못 찾음 — tag_field_debug.json 에 후보 덤프")
            try:
                cand = page.evaluate(
                    """() => [...document.querySelectorAll('input,textarea,[contenteditable]')]
                        .filter(e => /태그|tag/i.test((e.getAttribute('placeholder')||'')+' '+(e.className||'')+' '+(e.id||'')))
                        .map(e => ({tag:e.tagName, id:e.id, cls:(e.className||'').slice(0,80), ph:e.getAttribute('placeholder')||''})).slice(0,10)"""
                )
                with open(os.path.join(run_dir, "tag_field_debug.json"), "w", encoding="utf-8") as f:
                    json.dump(cand, f, ensure_ascii=False, indent=1)
                log(f"  [진단] 태그 후보 필드: {cand}")
            except Exception:
                pass

    # ── STEP 9: 대표사진 설정 — API 경로만(setDocumentData 사용). 사람 경로는 스타일 보존을 위해
    #    건너뛴다(SE 가 보통 첫 이미지를 대표로 자동 사용). ──
    if image_comps and not human:
        log("\n[STEP 9] 대표사진 설정")
        set_representative_image(page)
        time.sleep(1)

    # ── STEP 10: 발행(비공개) 또는 임시저장 ────────────────────────────────
    dismiss_help_panels(page)
    time.sleep(0.5)

    saved = False
    published_private = False
    # 기본: 비공개 발행(태그를 발행 레이어에서 확실히 저장). 비공개 검증 실패·오류 시 임시저장으로 폴백.
    if publish_mode() != 'draft' and tags:
        log("\n[STEP 10] 비공개 발행(태그 포함) — 검토 후 사람이 전체공개로 전환")
        if publish_private_with_tags(page, tags, run_dir, issues):
            saved = True
            published_private = True
        else:
            log("  → 임시저장으로 폴백")
    if published_private:
        pass  # 이미 발행됨 — 아래 임시저장 로직 건너뜀
    else:
        log("\n[STEP 10] 임시저장")
    draft_selectors = [] if published_private else [
        "button[data-name='draftSave']",
        "button[data-name='draft']",
        "button[data-name='tempSave']",
        ".btn_draft",
    ]
    for sel in draft_selectors:
        try:
            page.locator(sel).first.click(timeout=3000)
            time.sleep(2)
            log(f"  임시저장 버튼 클릭 ({sel})")
            saved = True
            break
        except Exception:
            continue

    if not saved:
        clicked = page.evaluate("""() => {
            const candidates = [...document.querySelectorAll('button, a[role=button]')];
            const btn = candidates.find(b =>
                ['임시저장', '저장', '임시 저장'].includes(b.textContent.trim()) && b.offsetParent !== null
            );
            if (btn) {
                btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                return btn.textContent.trim();
            }
            return null;
        }""")
        if clicked:
            log(f"  JS로 임시저장 클릭: {clicked}")
            saved = True
            time.sleep(2)

    if not saved:
        page.keyboard.press("ControlOrMeta+s")  # macOS=Cmd+s 임시저장
        time.sleep(2)
        log("  Ctrl+S 임시저장 시도")
        saved = True

    if saved and not published_private:
        time.sleep(2)
        dismiss_editor_popup(page)
        time.sleep(1)
        log("  임시저장 완료!")
    elif published_private:
        log("  비공개 발행 완료 — 네이버에서 검토 후 '전체공개'로 전환하세요.")

    # ── 스크린샷 ──────────────────────────────────────────────────────────
    screenshot_dir = os.path.join(run_dir, "screenshots")
    os.makedirs(screenshot_dir, exist_ok=True)
    screenshot_path = os.path.join(screenshot_dir, "draft_saved.png")
    try:
        page.screenshot(path=screenshot_path, full_page=True)  # 전체 글 확인용(스타일·구조 검증)
        log(f"  스크린샷 저장: {screenshot_path}")
    except Exception:
        try:
            page.screenshot(path=screenshot_path)
        except Exception:
            screenshot_path = None

    draft_url = page.url
    status = "PARTIAL" if issues else "DRAFT_SAVED"
    if not saved:
        status = "FAILED"

    return {
        "status":               status,
        "publish_mode":         "private_published" if published_private else "draft_saved",
        "draft_url":            draft_url,
        "admin_url":            f"https://blog.naver.com/{blog_id}/postlist",
        "saved_at":             datetime.now().strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "issues":               issues,
        "screenshot_path":      screenshot_path,
        "image_upload_count":   image_upload_count,
    }


# ── 메인 ──────────────────────────────────────────────────────────────────
def main():
    load_env(str(PROJECT_ROOT))

    parser = argparse.ArgumentParser(description="네이버 블로그 임시저장 자동화")
    parser.add_argument("--final-content",  required=True)
    parser.add_argument("--image-manifest", required=True)
    parser.add_argument("--session-file",   default=".naver_session.json")
    parser.add_argument("--run-dir",        required=True)
    parser.add_argument("--headless",       action="store_true")
    parser.add_argument("--dry-run",        action="store_true")
    args = parser.parse_args()

    blog_id  = os.environ.get("NAVER_BLOG_ID", "")
    naver_id = os.environ.get("NAVER_ID", "")
    naver_pw = os.environ.get("NAVER_PW", "")

    # 자격증명은 '실제 발행(비 dry-run)'에서만 필수 — dry-run 은 크리덴셜 없이도 계획을 반환(안전한 계약).
    if not blog_id and not args.dry_run:
        print("✗ NAVER_BLOG_ID 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)
    if not blog_id:
        blog_id = "preview"  # dry-run 미리보기 URL 용 플레이스홀더

    with open(args.final_content, encoding="utf-8") as f:
        final_content = json.load(f)

    image_manifest = {"images": [], "thumbnail_path": None}
    if os.path.exists(args.image_manifest):
        with open(args.image_manifest, encoding="utf-8") as f:
            image_manifest = json.load(f)

    if args.dry_run:
        print("⚠ dry-run 모드: 실제 발행을 수행하지 않습니다.")
        result = {
            "status": "DRAFT_SAVED",
            "draft_url": f"https://blog.naver.com/{blog_id}/postwrite",
            "admin_url": f"https://blog.naver.com/{blog_id}/postlist",
            "saved_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+09:00"),
            "issues": [], "screenshot_path": None, "image_upload_count": 0,
        }
    else:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            print("playwright 패키지가 필요합니다. pip install playwright", file=sys.stderr)
            sys.exit(1)

        print("네이버 블로그 임시저장 시작...")

        # persistent context로 세션 유지 (캡차 회피)
        # 인스턴스별 프로필 분리(멀티 기업) — NAVER_PROFILE_DIR 지정 시 그 경로, 아니면 종전 홈 전역 경로.
        profile_dir = Path(os.environ["NAVER_PROFILE_DIR"]) if os.environ.get("NAVER_PROFILE_DIR") else (Path.home() / ".naver-blog-profiles" / "cli")
        profile_dir.mkdir(parents=True, exist_ok=True)

        with sync_playwright() as pw:
            context = pw.chromium.launch_persistent_context(
                str(profile_dir),
                channel="chrome",
                headless=args.headless,
                slow_mo=80,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars",
                    "--disable-extensions",
                ],
                ignore_default_args=["--enable-automation"],
                viewport={"width": 1280, "height": 900},
            )
            context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.chrome = { runtime: {} };
            """)
            page = context.pages[0] if context.pages else context.new_page()
            page.on("dialog", lambda d: d.accept())

            # 저장된 쿠키 복원 — 같은 환경에서 재로그인 방지(NID 세션 쿠키는 프로필에 안 남아 별도 저장/복원).
            cookies_file = profile_dir / "naver_cookies.json"
            if cookies_file.exists():
                try:
                    with open(cookies_file, encoding="utf-8") as f:
                        context.add_cookies(json.load(f))
                    log("[쿠키] 저장된 세션 복원")
                except Exception as e:
                    log(f"[쿠키] 복원 실패(무해): {str(e)[:60]}")

            # 로그인 확인
            page.goto("https://blog.naver.com", wait_until="domcontentloaded", timeout=15000)
            time.sleep(1.5)
            logged_in = page.locator("a[href*='nidlogin'], .link_login").count() == 0

            if logged_in:
                log("[로그인] 기존 세션으로 자동 로그인 완료(재로그인 없음)")
            else:
                full_auto_login(page, naver_id, naver_pw)

            # 로그인 세션 쿠키 저장 — 다음 실행부터 같은 환경이면 재로그인 불필요.
            try:
                save_cookies(context, cookies_file)
            except Exception as e:
                log(f"[쿠키] 저장 실패(무해): {str(e)[:60]}")

            try:
                result = write_post(page, blog_id, final_content, image_manifest, args.run_dir)
            except Exception as e:
                log(f"✗ 발행 중 오류: {e}")
                result = {
                    "status": "FAILED",
                    "draft_url": "", "admin_url": f"https://blog.naver.com/{blog_id}/postlist",
                    "saved_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+09:00"),
                    "issues": [str(e)], "screenshot_path": None, "image_upload_count": 0,
                }

            context.close()

    # 결과 저장
    result_path = os.path.join(args.run_dir, "07_publish_result.json")
    os.makedirs(args.run_dir, exist_ok=True)
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    status = result["status"]
    if status == "DRAFT_SAVED":
        print(f"\n✓ 임시저장이 완료되었습니다!")
        print(f"네이버 블로그에서 확인 후 발행하세요:")
        print(f"→ 관리자 페이지: {result['admin_url']}")
        print(f"→ 임시 편집 URL: {result['draft_url']}")
    elif status == "PARTIAL":
        print(f"\n⚠ 임시저장 완료 (일부 문제 있음)")
        print(f"→ 임시 편집 URL: {result['draft_url']}")
        for issue in result.get("issues", []):
            print(f"  - {issue}")
    else:
        print(f"\n✗ 임시저장 실패")
        for issue in result.get("issues", []):
            print(f"  - {issue}")
        print(f"최종 콘텐츠: {args.final_content}")
        sys.exit(1)

    print(f"\n✓ 결과 파일: {result_path}")


if __name__ == "__main__":
    main()
