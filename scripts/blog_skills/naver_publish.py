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
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path


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
    return {
        "@ctype": "paragraph",
        "id":     uid(),
        "nodes":  [make_text_node(text)],
    }


def make_text_comp(paragraphs: list) -> dict:
    return {
        "@ctype":  "text",
        "id":      uid(),
        "layout":  "default",
        "value":   paragraphs,
    }


def build_document_components(smarteditor_text: dict) -> list:
    """
    smarteditor_text의 sections를 SE ONE 컴포넌트 목록으로 변환.
    이미지는 업로드 후 image_comps로 별도 삽입.
    heading_level: "HEADING1"(H2 상당, 기본) | "HEADING2"(H3 상당) — 어댑터(smarteditor.ts)가 지정.
    """
    sections = smarteditor_text.get("sections", [])
    comps = []
    for section in sections:
        heading = section.get("heading", "")
        body    = section.get("body", "")
        level   = section.get("heading_level", "HEADING1")
        paras = []
        if heading:
            paras.append(make_heading_para(heading, level))
        for line in body.split("\n"):
            line = line.strip()
            if line:
                paras.append(make_body_para(line))
        if paras:
            comps.append(make_text_comp(paras))
    return comps


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
            page.keyboard.press("Control+a")
            page.keyboard.type(title)
            log("  제목 입력 완료")
            break
        except Exception:
            continue
    time.sleep(0.5)

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
        image_comps = [
            c for c in doc_data["document"]["components"]
            if c.get("@ctype") == "image"
        ]
        log(f"  이미지 컴포넌트 {len(image_comps)}개 확인")
    else:
        log("  ⚠ documentService 없음 — 텍스트만 삽입")

    # ── STEP 6: 본문 컴포넌트 조립 ────────────────────────────────────────
    log("\n[STEP 6] 본문 컴포넌트 조립")
    text_comps = build_document_components(se_text)
    log(f"  텍스트 섹션 {len(text_comps)}개")

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
    for i, tc in enumerate(text_comps):
        final_comps.append(tc)
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
                        el.fill(tag)
                        page.keyboard.press("Enter")
                        time.sleep(0.3)
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
        page.keyboard.press("Control+s")
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
