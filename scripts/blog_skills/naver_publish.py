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


# ── 굵게(**...**) 파서 — API·사람 경로 공용 ─────────────────────────────────
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")


def parse_bold_segments(text: str) -> list:
    """'a **b** c' → [('a ',False),('b',True),(' c',False)]. 굵게 마커 없으면 [(text,False)]."""
    segs = []
    i = 0
    for m in _BOLD_RE.finditer(text):
        if m.start() > i:
            segs.append((text[i:m.start()], False))
        segs.append((m.group(1), True))
        i = m.end()
    if i < len(text):
        segs.append((text[i:], False))
    return segs or [(text, False)]


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

    # 클립보드 붙여넣기 방식 (press_sequentially보다 캡차 회피 확률 높음)
    # 자격증명이 없으면 자동입력을 건너뛰고 곧장 수동 로그인 대기(빈 값 제출로 인한 오류 화면 방지).
    auto_filled = False
    if not naver_id or not naver_pw:
        log("  자격증명 미설정 — 브라우저에서 직접 로그인해주세요.")
    else:
      try:
        id_field = page.locator("input#id")
        id_field.click()
        time.sleep(0.3)
        # JS로 값을 직접 세팅 + input 이벤트 발생
        page.evaluate("""(val) => {
            const el = document.querySelector('input#id');
            if (el) {
                el.value = val;
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
            }
        }""", naver_id)
        time.sleep(0.3)

        pw_field = page.locator("input#pw")
        pw_field.click()
        time.sleep(0.3)
        page.evaluate("""(val) => {
            const el = document.querySelector('input#pw');
            if (el) {
                el.value = val;
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
            }
        }""", naver_pw)
        time.sleep(0.5)

        # 로그인 버튼 클릭
        page.evaluate("""() => {
            const btn = document.querySelector('button#log\\\\.login, button[type=submit], .btn_login');
            if (btn) btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
        }""")
        log("  ID/PW 자동 입력 완료. 로그인 시도 중...")
        auto_filled = True
        time.sleep(3)
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


# ── SE ONE 문서 데이터 변환 ────────────────────────────────────────────────
def make_text_node(value: str, bold: bool = False) -> dict:
    span_style = "font-size:14pt;"
    if bold:
        span_style += "font-weight:bold;"
    return {
        "@ctype":    "textNode",
        "id":        uid(),
        "value":     value,
        "spanStyle": span_style,
    }


def make_heading_para(text: str, level: str = "HEADING1") -> dict:
    font_size = "24pt" if level == "HEADING1" else "18pt"
    return {
        "@ctype":         "paragraph",
        "id":             uid(),
        "paragraphStyle": level,
        "nodes": [{
            "@ctype":    "textNode",
            "id":        uid(),
            "value":     text,
            "spanStyle": f"font-size:{font_size};font-weight:bold;",
        }],
    }


def make_body_para(text: str) -> dict:
    # 굵게(**...**) 세그먼트를 각각 textNode 로 — 굵은 구간은 font-weight:bold.
    nodes = [make_text_node(seg, bold=b) for seg, b in parse_bold_segments(text) if seg]
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
_RICH_LINE_RE = re.compile(r"^(?:```|\||>\s|-{3,}$|\*{3,}$|_{3,}$)")


def _has_rich_blocks(se_text: dict) -> bool:
    """본문에 인용구(>)·구분선(---)·소스코드(```)·표(|) 블록이 있으면 True(사람 타이핑 대신 API 렌더)."""
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
            comps.append(make_quotation(list(quote_buf)))
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
    """굵게(**...**)를 사람처럼 반영 — 굵은 구간 앞뒤로 굵게 단축키(Cmd/Ctrl+B) 토글 후 타이핑.
    Chrome 이 가로채는 숫자 단축키와 달리 B 는 편집영역 굵게 토글로 동작한다."""
    for seg, bold in parse_bold_segments(text):
        if not seg:
            continue
        if bold:
            page.keyboard.press("ControlOrMeta+b")
            time.sleep(_rand(0.05, 0.15))
        human_type(page, seg)
        if bold:
            page.keyboard.press("ControlOrMeta+b")  # 굵게 해제
            time.sleep(_rand(0.05, 0.15))


def _body_focused(page) -> bool:
    """본문 포커스 검증. SE 는 본문 키 입력을 숨은 'input_buffer' iframe 으로 캡처하므로, 본문을
    클릭하면 최상위 activeElement 가 그 IFRAME 이 된다(정상). 이걸 본문 포커스로 인정하고, 제목만 거부한다."""
    try:
        return bool(page.evaluate("""() => {
            const a = document.activeElement;
            if (!a || a === document.body) return false;
            if (a.closest('.se-title-text, .se-documentTitle, [data-type="title"]')) return false; // 제목이면 실패
            // 본문 입력 버퍼 iframe(SE 가 IME/키 입력 캡처) = 본문 포커스 정상. 식별자는 id(name 은 빈값).
            if (a.tagName === 'IFRAME' && /input_buffer/i.test((a.id || '') + '|' + (a.name || ''))) return true;
            return !!(a.isContentEditable || a.closest('[contenteditable="true"]') || a.closest('.se-content'));
        }"""))
    except Exception:
        return False


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


def type_body_human(page, se_text: dict, images: list, issues: list) -> tuple:
    """
    본문을 '사람처럼' 입력한다 — 문단은 한 글자씩 타이핑하고 사이사이 Enter, 이미지는 해당 위치에서
    이미지 버튼으로 삽입(사람이 사진 올리듯). 제목(H2/H3) '스타일'만 마지막에 apply_heading_styles 로
    가볍게 반영한다(내용은 전부 실제 타이핑 — 네이버가 관측하는 키 입력이 진짜다).
    반환: (headings[{text,level}], upload_count)
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
            human_type(page, heading)
            headings.append({"text": heading, "level": level})
        for line in body.split("\n"):
            line = line.strip()
            if not line:
                continue
            newline_before()
            human_type_rich(page, line)  # 굵게(**) 반영
        for slot in after_map.get(i, []):
            newline_before()  # 직전이 이미지면(first_block) Enter 생략 → 이미지 사이 빈 문단 방지
            insert_image(slot)
            first_block = True  # 이미지 직후는 새 문단 — 다음 블록 앞 Enter 생략

    return headings, upload_count[0]


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
                    para.paragraphStyle = lvl;
                    const size = lvl === 'HEADING1' ? '24pt' : '18pt';
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
    # 리치 블록(인용구·구분선·코드·표)은 키 입력으로 재현 불가 → 그런 글은 SE 문서 API 로 렌더(리치 우선).
    if human and _has_rich_blocks(se_text):
        human = False
        log("  리치 컴포넌트(인용구/구분선/코드/표) 포함 — 충실 렌더 위해 SE 문서 API 경로 사용")
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
                headings, image_upload_count = type_body_human(page, se_text, images, issues)
                log(f"  타이핑 완료 — 소제목 {len(headings)}개, 이미지 {image_upload_count}장")
                style_result = apply_heading_styles(page, headings)
                log(f"  제목 스타일 반영: {style_result}")
                if isinstance(style_result, str) and style_result.startswith("error"):
                    issues.append(f"제목 스타일 반영 실패: {style_result}")
                time.sleep(1.0)
                # 대표사진 설정용 — 삽입된 이미지 컴포넌트 재조회
                doc_after = page.evaluate("""() => {
                    const ds = window.SE?.launcher?._editors?.blogpc001?._documentService;
                    return ds ? ds.getDocumentData() : null;
                }""")
                if doc_after:
                    image_comps = [c for c in doc_after["document"]["components"] if c.get("@ctype") == "image"]
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

    # ── 이미지 'AI 활용(생성) 이미지' 표시 ON — SE 이미지 컴포넌트 ai 필드 = true(사용자 요청). ──
    if image_comps:
        ai_result = set_images_ai(page)
        log(f"  [image-ai] AI 이미지 표시: {ai_result}")
        if ai_result.startswith("err"):
            issues.append(f"이미지 AI 표시 실패: {ai_result}")
        time.sleep(0.5)

    # ── STEP 8: 태그 입력 ─────────────────────────────────────────────────
    if tags:
        log(f"\n[STEP 8] 태그 입력: {tags[:5]}")
        tag_selectors = [
            "input[placeholder*='태그']",
            ".se-tag-input input",
            "#tagInput",
        ]
        for sel in tag_selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=3000):
                    for tag in tags:
                        if human:
                            el.click()
                            time.sleep(_rand(0.1, 0.3))
                            human_type(page, tag)  # 태그도 한 글자씩
                        else:
                            el.fill(tag)
                        page.keyboard.press("Enter")
                        time.sleep(_rand(0.2, 0.45))
                    log("  태그 입력 완료")
                    break
            except Exception:
                continue

    # ── STEP 9: 대표사진 설정 ────────────────────────────────────────────
    if image_comps:
        log("\n[STEP 9] 대표사진 설정")
        set_representative_image(page)
        time.sleep(1)

    # ── STEP 10: 임시저장 ─────────────────────────────────────────────────
    log("\n[STEP 10] 임시저장")
    dismiss_help_panels(page)
    time.sleep(0.5)

    saved = False
    draft_selectors = [
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

    if saved:
        time.sleep(2)
        dismiss_editor_popup(page)
        time.sleep(1)
        log("  임시저장 완료!")

    # ── 스크린샷 ──────────────────────────────────────────────────────────
    screenshot_dir = os.path.join(run_dir, "screenshots")
    os.makedirs(screenshot_dir, exist_ok=True)
    screenshot_path = os.path.join(screenshot_dir, "draft_saved.png")
    try:
        page.screenshot(path=screenshot_path)
        log(f"  스크린샷 저장: {screenshot_path}")
    except Exception:
        screenshot_path = None

    draft_url = page.url
    status = "PARTIAL" if issues else "DRAFT_SAVED"
    if not saved:
        status = "FAILED"

    return {
        "status":               status,
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
        profile_dir = Path.home() / ".naver-blog-profiles" / "cli"
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

            # 로그인 확인 (persistent context이므로 이전 세션 유지됨)
            page.goto("https://blog.naver.com", wait_until="domcontentloaded", timeout=15000)
            time.sleep(1.5)
            logged_in = page.locator("a[href*='nidlogin'], .link_login").count() == 0

            if logged_in:
                log("[로그인] 기존 세션으로 자동 로그인 완료")
            else:
                full_auto_login(page, naver_id, naver_pw)

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
