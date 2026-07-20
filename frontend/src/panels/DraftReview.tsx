import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPieces, fetchPieceDraft, publishPiece, postPieceMetrics, revisePiece, deletePiece, startNaverDraft, fetchNaverDraftStatus, startCollectMetrics, fetchCollectStatus, createCardNewsFromPiece, createShortsFromPiece, PieceInfo, PieceDraftResp } from "../api";
import Ico, { type IcoName } from "./Ico";

// 초안 검토·발행·성과 입력 — 크로스-런 REST(폴링/온디맨드). 본문 편집은 컴포넌트-로컬(store 변이 금지).
const REVIEWABLE = new Set(["ready", "published", "measured", "reflected"]);

// 스테이지 어휘는 캘린더 칸반과 동일(검토 대기=eye · 발행=megaphone · 측정=chart · 강화=arrow-up-right).
function StageBadge({ stage }: { stage: string }) {
  const map: Record<string, { icon: IcoName; label: string }> = {
    ready: { icon: "eye", label: "검토 대기" }, published: { icon: "megaphone", label: "발행됨" },
    measured: { icon: "chart", label: "측정됨" }, reflected: { icon: "arrow-up-right", label: "강화 반영" },
    draft: { icon: "pencil", label: "초안 작성" }, idea: { icon: "sparkle", label: "아이디어" },
    research: { icon: "search", label: "리서치" }, error: { icon: "triangle-exclamation", label: "실패" },
  };
  const m = map[stage];
  return <span className="badge">{m ? <><Ico name={m.icon} size={10} /> {m.label}</> : stage}</span>;
}

export default function DraftReview() {
  const [pieces, setPieces] = useState<PieceInfo[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [data, setData] = useState<PieceDraftResp | null>(null);
  const [body, setBody] = useState("");            // 컴포넌트-로컬 편집 본문(store 변이 금지)
  const [copied, setCopied] = useState("");
  const [pubUrl, setPubUrl] = useState("");
  const [msg, setMsg] = useState("");
  // 성과 입력 폼
  const [views, setViews] = useState("");
  const [dwell, setDwell] = useState("");
  const [inflow, setInflow] = useState(""); // "키워드,횟수" 줄단위
  // 본문 보기 모드(편집 MD / HTML 미리보기) + 수정 요청
  const [view, setView] = useState<"md" | "html">("md");
  const [feedback, setFeedback] = useState("");
  const [revBusy, setRevBusy] = useState(false);
  // 네이버 임시저장(자동) — 서버 백그라운드 잡 + 폴링
  const [naverBusy, setNaverBusy] = useState(false);
  const [naverMsg, setNaverMsg] = useState("");
  // 성과 자동 수집 — 서버 백그라운드 잡 + 폴링
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectMsg, setCollectMsg] = useState("");
  const collectPollRef = useRef<string | null>(null);
  const selRef = useRef<string | null>(null);      // 폴링 중 다른 초안으로 이동 시 stale 갱신 차단
  const pollingRef = useRef<string | null>(null);  // 같은 초안 중복 폴링 방지

  const load = () => fetchPieces().then(setPieces);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // 파생 콘텐츠(카드뉴스·숏폼) 진행 상태 갱신(캘린더와 동일 케이던스)
    return () => clearInterval(t);
  }, []);
  // 언마운트 시 폴링 루프 종료(다음 틱에서 selRef 불일치로 탈출) — 탭 전환 후 좀비 폴링·재진입 이중 폴링 방지.
  useEffect(() => () => { selRef.current = null; }, []);

  const reviewable = useMemo(
    () => pieces.filter((p) => REVIEWABLE.has(p.stage) && p.runId).sort((a, b) => b.updatedTs.localeCompare(a.updatedTs)),
    [pieces],
  );

  // 파생 콘텐츠(카드뉴스·숏폼) — 선택 초안의 최신 파생 상태(pieces 목록의 derived, 8초 폴링으로 갱신).
  const derived = pieces.find((p) => p.id === sel)?.derived;
  const [deriveBusy, setDeriveBusy] = useState("");
  const doDeriveCardnews = async () => {
    if (!sel) return;
    setDeriveBusy("cardnews");
    const r = await createCardNewsFromPiece(sel);
    setDeriveBusy("");
    if (r.ok) load(); else alert(r.error || "카드뉴스 생성 실패");
  };
  const doDeriveShorts = async () => {
    if (!sel) return;
    setDeriveBusy("shorts");
    const r = await createShortsFromPiece(sel);
    setDeriveBusy("");
    if (r.ok) load(); else alert(r.error || "숏폼 생성 실패");
  };

  // 카드 삭제 — 선택 해제 후 목록 갱신(서버가 실행 중 런/잡이 있으면 409 로 거절).
  const doDelete = async () => {
    if (!sel) return;
    const title = data?.piece.title ?? sel;
    if (!confirm(`"${title}" 카드를 삭제할까요?\n(산출물 파일은 남고 카드만 제거됩니다)`)) return;
    const r = await deletePiece(sel);
    if (!r.ok) { setMsg(r.error || "삭제 실패"); return; }
    selRef.current = null; setSel(null); setData(null); setMsg("");
    load();
  };

  const open = async (id: string) => {
    setSel(id); selRef.current = id;
    setData(null); setMsg(""); setPubUrl(""); setCopied(""); setFeedback(""); setView("md");
    setNaverBusy(false); setNaverMsg(""); setCollectBusy(false); setCollectMsg("");
    const d = await fetchPieceDraft(id);
    setData(d);
    setBody(d?.draft.bodyMarkdown ?? d?.md ?? "");
    // 이 초안의 진행 중 잡(임시저장/성과수집)이 있으면(새로고침·재선택) 이어서 폴링.
    const s = await fetchNaverDraftStatus(id);
    if (selRef.current === id && s?.status === "running") {
      setNaverBusy(true); setNaverMsg("네이버에 저장 중… (열린 브라우저 창을 확인하세요)");
      void pollNaver(id);
    }
    const cs = await fetchCollectStatus(id);
    if (selRef.current === id && cs?.status === "running") {
      setCollectBusy(true); setCollectMsg("네이버에서 성과 수집 중…");
      void pollCollect(id);
    }
  };

  // 성과 자동 수집 폴링 — 3초 간격, 최대 ~6분(서버 스크레이프 타임아웃 5분 커버).
  const pollCollect = async (id: string) => {
    if (collectPollRef.current === id) return;
    collectPollRef.current = id;
    try {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (selRef.current !== id) return;
        const s = await fetchCollectStatus(id);
        if (selRef.current !== id) return;
        if (!s || s.status === "running") continue;
        setCollectBusy(false);
        if (s.status === "done") {
          const kw = s.inflow_count ? `, 유입 키워드 ${s.inflow_count}개` : "";
          const rf = s.reinforced ? " — 강화 반영됨(전략·위키 갱신)" : " — 이력만 추가(이미 강화됨)";
          setCollectMsg(`✓ 성과 수집 완료: 조회 ${s.views ?? 0}회${s.dwell_sec ? `, 체류 ${s.dwell_sec}s` : ""}${kw}${rf}${s.dry_run ? " (dry-run)" : ""}`);
          await load(); const d = await fetchPieceDraft(id); if (selRef.current === id && d) setData(d);
        } else if (s.status === "idle") {
          setCollectMsg("⚠ 진행 상태가 유실됐습니다(서버 재시작 가능성) — 다시 시도하세요.");
        } else {
          setCollectMsg(`✗ 자동 수집 실패: ${s.error ?? s.note ?? "원인 불명"} — 아래에 수동 입력할 수 있습니다.`);
        }
        return;
      }
      if (selRef.current === id) { setCollectBusy(false); setCollectMsg("⏱ 시간 초과 — 다시 시도하세요."); }
    } finally {
      if (collectPollRef.current === id) collectPollRef.current = null;
    }
  };

  const doCollect = async () => {
    if (!sel || collectBusy) return;
    setCollectBusy(true);
    setCollectMsg("네이버에서 성과 수집 중… (로그인 세션 필요 — 처음엔 브라우저 창이 열릴 수 있어요)");
    const r = await startCollectMetrics(sel);
    if (!r.ok) { setCollectBusy(false); setCollectMsg(`✗ 시작 실패: ${r.error ?? ""}`); return; }
    void pollCollect(sel);
  };

  // 네이버 임시저장 폴링 — 3초 간격, 최대 ~16분(서버 쪽 Playwright 타임아웃 15분 커버).
  const pollNaver = async (id: string) => {
    if (pollingRef.current === id) return;
    pollingRef.current = id;
    try {
      for (let i = 0; i < 320; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (selRef.current !== id) return;
        const s = await fetchNaverDraftStatus(id);
        if (selRef.current !== id) return; // fetch 대기 중 초안 전환 — 다른 초안 화면에 결과 표시 방지
        if (!s || s.status === "running") continue;
        setNaverBusy(false);
        if (s.status === "saved") {
          setNaverMsg(`✓ 네이버 임시저장 완료${s.dry_run ? " (dry-run)" : ""}${s.error ? ` — 일부 문제: ${s.error}` : ""} — 네이버 글쓰기의 임시저장 목록에서 확인 후 발행하고, 발행된 글 URL을 아래에 등록하세요.`);
          await load();
          // data.piece(선택 시점 스냅샷)도 갱신 — '네이버 글쓰기 열기' 링크가 즉시 나타나게.
          const d = await fetchPieceDraft(id);
          if (selRef.current === id && d) setData(d);
        } else if (s.status === "idle") {
          // 폴링 중 잡이 사라짐 = 서버 재시작 등으로 진행 상태 유실 — 성공/실패 단정 불가.
          setNaverMsg("⚠ 진행 상태가 유실됐습니다(서버 재시작 가능성) — 네이버 글쓰기의 임시저장 목록에서 직접 확인하세요.");
        } else {
          setNaverMsg(`✗ 네이버 임시저장 실패: ${s.error ?? "원인 불명 — 서버 로그 확인"}`);
        }
        return;
      }
      if (selRef.current === id) { setNaverBusy(false); setNaverMsg("⏱ 시간 초과 — 서버 로그를 확인하세요."); }
    } finally {
      if (pollingRef.current === id) pollingRef.current = null;
    }
  };

  const doNaverDraft = async () => {
    if (!sel || naverBusy) return;
    setNaverBusy(true);
    setNaverMsg("네이버에 저장 중… (처음엔 열린 브라우저 창에서 네이버 로그인이 필요할 수 있어요)");
    const r = await startNaverDraft(sel);
    if (!r.ok) { setNaverBusy(false); setNaverMsg(`✗ 시작 실패: ${r.error ?? ""}`); return; }
    void pollNaver(sel);
  };

  // 수정 요청 — 피드백으로 리비전 런(작가가 기존 초안 개정 → 디자이너 이미지 재협의). 완료 시 초안 자동 갱신.
  const doRevise = async () => {
    if (!sel || !feedback.trim() || revBusy) return;
    setRevBusy(true);
    const r = await revisePiece(sel, feedback.trim());
    setRevBusy(false);
    if (r.ok) {
      setMsg(`수정 런 시작됨(${r.run_id ?? ""}) — 팀이 초안을 개정 중입니다. 완료되면 이 초안이 갱신됩니다(잠시 후 다시 선택해 확인).`);
      setFeedback("");
    } else setMsg(`수정 요청 실패: ${r.error || ""}`);
  };

  const copy = async (text: string, which: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(""), 1500); }
    catch { setCopied("복사 실패"); }
  };

  const doPublish = async () => {
    if (!sel || !pubUrl.trim()) return;
    const r = await publishPiece(sel, pubUrl.trim());
    if (r.ok) { setMsg("발행 URL 등록됨 — 이제 성과를 입력할 수 있습니다."); setPubUrl(""); await load(); await open(sel); }
    else setMsg(`발행 등록 실패: ${r.error || ""}`);
  };

  const doMetrics = async () => {
    if (!sel) return;
    const searchInflow = inflow.split("\n").map((l) => {
      const [kw, cnt, rank] = l.split(",").map((x) => x.trim());
      return kw ? { keyword: kw, count: Number(cnt) || 0, ...(rank ? { rank: Number(rank) } : {}) } : null;
    }).filter(Boolean);
    const r = await postPieceMetrics(sel, { views: Number(views) || 0, dwellSec: dwell ? Number(dwell) : undefined, searchInflow });
    if (r.ok) {
      setMsg(r.reinforced ? "성과 저장 + 강화 반영됨(전략·위키 갱신)." : "성과 저장됨(이미 강화된 글이라 이력만 추가).");
      setViews(""); setDwell(""); setInflow(""); await load(); await open(sel);
    } else setMsg("성과 저장 실패");
  };

  return (
    <div className="apikeys review-view">
      <div className="apikeys-head">
        <h1><Ico name="eye" size={17} /> 초안 검토·발행</h1>
        <p className="apikeys-sub">
          자율 스튜디오가 만든 초안을 검토·편집하고, 네이버에 붙여넣어 발행한 뒤 URL·성과를 입력하면
          다음 기획에 강화 반영됩니다(검토 대기 {reviewable.filter((p) => p.stage === "ready").length}건).
        </p>
      </div>

      <div className="review-split">
        {/* 좌측 — 검토 가능한 piece 목록 */}
        <div className="review-list">
          {reviewable.length === 0 && <div className="muted" style={{ padding: 12 }}>검토할 초안이 아직 없습니다.</div>}
          {reviewable.map((p) => (
            <button key={p.id} className={`review-list-item ${sel === p.id ? "active" : ""}`} onClick={() => open(p.id)}>
              <div className="review-list-title">{p.title}</div>
              <div className="review-list-meta">
                <StageBadge stage={p.stage} />
                {typeof p.seoScore === "number" && <span className="chip">SEO {p.seoScore}</span>}
              </div>
            </button>
          ))}
        </div>

        {/* 우측 — 상세(초안/편집/발행/성과) */}
        <div className="review-detail">
          {!sel && <div className="muted" style={{ padding: 24 }}>왼쪽에서 초안을 선택하세요.</div>}
          {sel && !data && <div className="muted" style={{ padding: 24 }}>불러오는 중…</div>}
          {data && (
            <>
              <div className="review-section">
                <div className="review-body-head">
                  <div className="review-titlecands">
                    {data.draft.titleCandidates.map((t, i) => (
                      <div key={i} className={i === 0 ? "review-title-main" : "review-title-alt muted"}>{i === 0 ? "" : "· "}{t}</div>
                    ))}
                  </div>
                  <button className="btn ghost" title="카드 삭제(산출물 파일은 남음)" onClick={doDelete}><Ico name="trash" size={12} /> 삭제</button>
                </div>
                {data.draft.metaDescription && <p className="muted review-meta">{data.draft.metaDescription}</p>}
                <div className="piece-card-meta">
                  {data.draft.primaryKeyword && <span className="chip"><Ico name="location" size={11} /> {data.draft.primaryKeyword}</span>}
                  {data.draft.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
                </div>
              </div>

              {/* SEO 체크리스트(결정적, LLM 없음) */}
              <div className="review-section">
                <h3>SEO 체크 <span className="badge">{data.draft.seo.score}/100</span></h3>
                <ul className="review-seo">
                  {data.draft.seo.checklist.map((c, i) => (
                    <li key={i} className={c.ok ? "ok" : "no"}>
                      <span>{c.ok ? "✓" : "✗"}</span> {c.label}{c.note ? <span className="muted"> — {c.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>

              {/* 본문 편집(컴포넌트-로컬) + HTML 미리보기 + 복사(네이버 붙여넣기) */}
              <div className="review-section">
                <div className="review-body-head">
                  <h3>
                    <button className={`btn ghost review-viewtab${view === "md" ? " on" : ""}`} onClick={() => setView("md")}>본문(마크다운)</button>
                    <button className={`btn ghost review-viewtab${view === "html" ? " on" : ""}`} onClick={() => setView("html")}>HTML 미리보기</button>
                    <span className="muted"> · {body.length}자</span>
                  </h3>
                  <div>
                    <button className="btn ghost" onClick={() => copy(body, "md")}>{copied === "md" ? "복사됨!" : "본문 복사(MD)"}</button>
                    <button className="btn ghost" onClick={() => copy(data.html, "html")}>{copied === "html" ? "복사됨!" : "HTML 복사(원본)"}</button>
                  </div>
                </div>
                {view === "md" ? (
                  <textarea className="review-body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} />
                ) : (
                  /* 원본 렌더(draft.html) 미리보기 — sandbox iframe(스크립트 차단). 편집본이 아니라 포매터 원본이다. */
                  <iframe className="review-html-preview" title="HTML 미리보기" sandbox="" srcDoc={data.html || "<p>draft.html 없음</p>"} />
                )}
                {data.draft.imageSlots.length > 0 && (
                  <div className="review-images">
                    <b className="muted">이미지 슬롯</b>
                    {data.draft.imageSlots.map((s, i) => (
                      <div key={i} className="muted review-imgslot">{i + 1}. {s.alt} — <i>{s.prompt}</i></div>
                    ))}
                  </div>
                )}
              </div>

              {/* 파생 콘텐츠 — 같은 주제의 카드뉴스·숏폼을 검토 화면에서 함께 확인·생성(콘텐츠 세트) */}
              <div className="review-section">
                <h3>파생 콘텐츠 <span className="muted">(카드뉴스·숏폼 — 발행 전 세트로 검토)</span></h3>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {/* 카드뉴스 */}
                  <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <b><Ico name="cards" size={12} /> 카드뉴스</b>
                      {derived?.cardnews
                        ? <span className="badge">{derived.cardnews.running || ["planning", "designing", "rendering"].includes(derived.cardnews.stage) ? "생성 중…" : derived.cardnews.stage === "ready" ? `완성 · ${derived.cardnews.slides ?? 0}장` : "실패"}</span>
                        : <button className="btn ghost" disabled={deriveBusy !== ""} onClick={doDeriveCardnews}>{deriveBusy === "cardnews" ? "시작 중…" : "만들기"}</button>}
                      {derived?.cardnews?.stage === "ready" && (
                        <a className="btn ghost" href={`/cardnews/${derived.cardnews.id}/zip`} download>zip</a>
                      )}
                    </div>
                    {derived?.cardnews?.stage === "ready" && (derived.cardnews.slides ?? 0) > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>
                        {Array.from({ length: derived.cardnews.slides ?? 0 }, (_, i) => `slide_${String(i + 1).padStart(2, "0")}.png`).map((name) => (
                          <a key={name} href={`/cardnews/${derived.cardnews!.id}/slides/${name}`} target="_blank" rel="noreferrer">
                            <img src={`/cardnews/${derived.cardnews!.id}/slides/${name}`} alt={name} loading="lazy"
                              style={{ width: "100%", aspectRatio: "2/3", objectFit: "cover", borderRadius: 6, display: "block" }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* 숏폼 */}
                  <div style={{ flex: "0 1 260px", minWidth: 200 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <b><Ico name="play" size={12} /> 숏폼</b>
                      {derived?.shorts
                        ? <span className="badge">{derived.shorts.running || ["planning", "designing", "rendering"].includes(derived.shorts.stage) ? "생성 중…" : derived.shorts.stage === "ready" ? `완성 · ${derived.shorts.durationSec ?? 0}초` : "실패"}</span>
                        : <button className="btn ghost" disabled={deriveBusy !== ""} onClick={doDeriveShorts}>{deriveBusy === "shorts" ? "시작 중…" : "만들기"}</button>}
                      {derived?.shorts?.stage === "ready" && (
                        <a className="btn ghost" href={`/shorts/${derived.shorts.id}/video`} download={`shorts-${derived.shorts.id}.mp4`}>MP4</a>
                      )}
                    </div>
                    {derived?.shorts?.stage === "ready" && (
                      <video controls preload="metadata" src={`/shorts/${derived.shorts.id}/video`}
                        style={{ width: 180, aspectRatio: "9/16", borderRadius: 8, background: "#000" }} />
                    )}
                  </div>
                </div>
              </div>

              {/* 수정 요청 — 검토 결과를 피드백으로 걸면 작가가 초안을 개정(리비전 런) */}
              {data.piece.stage === "ready" && (
                <div className="review-section">
                  <h3>수정 요청 <span className="muted">(검토 결과를 팀에 되돌려 초안 개정)</span></h3>
                  <textarea
                    value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3}
                    placeholder={"예: 도입부가 늘어져요 — 첫 문단을 절반으로 줄이고, 3번 소제목에 실제 제품 예시 2개를 추가해주세요."}
                  />
                  <div className="review-inline" style={{ justifyContent: "flex-end" }}>
                    <button className="btn start" disabled={!feedback.trim() || revBusy} onClick={doRevise}>
                      {revBusy ? "요청 중…" : <><Ico name="pencil" size={12} /> 수정 요청(초안 개정)</>}
                    </button>
                  </div>
                </div>
              )}

              {/* 발행 — ① 네이버 임시저장(자동) → ② 네이버에서 발행 후 URL 등록(수동) */}
              <div className="review-section">
                <h3>발행</h3>
                {data.piece.publishedUrl ? (
                  <p className="muted"><Ico name="circle-check" size={12} /> 발행됨 — <a href={data.piece.publishedUrl} target="_blank" rel="noreferrer">{data.piece.publishedUrl}</a></p>
                ) : (
                  <>
                    <div className="review-inline">
                      <button className="btn start" disabled={naverBusy} onClick={doNaverDraft}>
                        {naverBusy ? "네이버에 저장 중…" : "네이버 임시저장(자동)"}
                      </button>
                      {data.piece.naverDraftUrl && (
                        /* postwrite 편집기 URL — 열리면 '임시저장 글 불러오기' 팝업/목록에서 저장본을 불러온다. */
                        <a className="muted" href={data.piece.naverDraftUrl} target="_blank" rel="noreferrer"><Ico name="external-link" size={11} /> 네이버 글쓰기 열기(임시저장 불러오기)</a>
                      )}
                    </div>
                    {naverMsg && <p className="review-msg">{naverMsg}</p>}
                    <div className="review-inline">
                      <input type="text" placeholder="네이버에서 발행 후 글 URL 붙여넣기…" value={pubUrl} onChange={(e) => setPubUrl(e.target.value)} />
                      <button className="btn start" disabled={!pubUrl.trim()} onClick={doPublish}>발행 등록</button>
                    </div>
                  </>
                )}
              </div>

              {/* 성과(발행된 글만) — ① 자동 수집(권장) ② 안 되면 수동 입력. 둘 다 강화 루프 트리거 */}
              {data.piece.publishedUrl && (
                <div className="review-section">
                  <h3>성과 <span className="muted">(조회수·유입 키워드 → 강화 반영)</span></h3>
                  <div className="review-inline">
                    <button className="btn start" disabled={collectBusy} onClick={doCollect}>
                      {collectBusy ? "성과 수집 중…" : <><Ico name="chart" size={12} /> 성과 자동 수집(네이버)</>}
                    </button>
                    <span className="muted">네이버 통계를 자동으로 읽어 강화에 반영합니다.</span>
                  </div>
                  {collectMsg && <p className="review-msg">{collectMsg}</p>}

                  <details className="review-manual-metrics" style={{ marginTop: 12 }}>
                    <summary className="muted">수동 입력(자동 수집이 안 될 때)</summary>
                    <div className="review-metrics-grid" style={{ marginTop: 10 }}>
                      <label>조회수<input type="number" value={views} onChange={(e) => setViews(e.target.value)} placeholder="예: 1200" /></label>
                      <label>평균 체류(초)<input type="number" value={dwell} onChange={(e) => setDwell(e.target.value)} placeholder="예: 90" /></label>
                    </div>
                    <label className="review-inflow-label">유입 키워드 <span className="muted">(줄마다 "키워드,횟수,순위")</span>
                      <textarea value={inflow} onChange={(e) => setInflow(e.target.value)} rows={3} placeholder={"원두 고르는 법,420,2\n홈카페 원두,120"} />
                    </label>
                    <button className="btn start" onClick={doMetrics}>성과 저장 · 강화 반영</button>
                  </details>
                </div>
              )}

              {msg && <p className="review-msg">{msg}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
