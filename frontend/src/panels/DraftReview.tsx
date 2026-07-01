import { useEffect, useMemo, useState } from "react";
import { fetchPieces, fetchPieceDraft, publishPiece, postPieceMetrics, PieceInfo, PieceDraftResp } from "../api";

// 초안 검토·발행·성과 입력 — 크로스-런 REST(폴링/온디맨드). 본문 편집은 컴포넌트-로컬(store 변이 금지).
const REVIEWABLE = new Set(["ready", "published", "measured", "reflected"]);

function StageBadge({ stage }: { stage: string }) {
  const label: Record<string, string> = {
    ready: "📝 검토 대기", published: "🚀 발행됨", measured: "📊 측정됨", reflected: "📈 강화 반영",
    draft: "✍️ 초안 작성", idea: "💡 아이디어", research: "🔍 리서치", error: "⚠️ 실패",
  };
  return <span className="badge">{label[stage] ?? stage}</span>;
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

  const load = () => fetchPieces().then(setPieces);
  useEffect(() => { load(); }, []);

  const reviewable = useMemo(
    () => pieces.filter((p) => REVIEWABLE.has(p.stage) && p.runId).sort((a, b) => b.updatedTs.localeCompare(a.updatedTs)),
    [pieces],
  );

  const open = async (id: string) => {
    setSel(id); setData(null); setMsg(""); setPubUrl(""); setCopied("");
    const d = await fetchPieceDraft(id);
    setData(d);
    setBody(d?.draft.bodyMarkdown ?? d?.md ?? "");
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
        <h1>📝 초안 검토·발행</h1>
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
                <div className="review-titlecands">
                  {data.draft.titleCandidates.map((t, i) => (
                    <div key={i} className={i === 0 ? "review-title-main" : "review-title-alt muted"}>{i === 0 ? "🏷 " : "· "}{t}</div>
                  ))}
                </div>
                {data.draft.metaDescription && <p className="muted review-meta">{data.draft.metaDescription}</p>}
                <div className="piece-card-meta">
                  {data.draft.primaryKeyword && <span className="chip">🎯 {data.draft.primaryKeyword}</span>}
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

              {/* 본문 편집(컴포넌트-로컬) + 복사(네이버 붙여넣기) */}
              <div className="review-section">
                <div className="review-body-head">
                  <h3>본문(마크다운) · {body.length}자</h3>
                  <div>
                    <button className="btn ghost" onClick={() => copy(body, "md")}>{copied === "md" ? "복사됨!" : "본문 복사(MD)"}</button>
                    <button className="btn ghost" onClick={() => copy(data.html, "html")}>{copied === "html" ? "복사됨!" : "HTML 복사(원본)"}</button>
                  </div>
                </div>
                <textarea className="review-body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} />
                {data.draft.imageSlots.length > 0 && (
                  <div className="review-images">
                    <b className="muted">🖼 이미지 슬롯</b>
                    {data.draft.imageSlots.map((s, i) => (
                      <div key={i} className="muted review-imgslot">{i + 1}. {s.alt} — <i>{s.prompt}</i></div>
                    ))}
                  </div>
                )}
              </div>

              {/* 발행(수동) — 네이버 게시 후 URL 등록 */}
              <div className="review-section">
                <h3>발행</h3>
                {data.piece.publishedUrl ? (
                  <p className="muted">✅ 발행됨 — <a href={data.piece.publishedUrl} target="_blank" rel="noreferrer">{data.piece.publishedUrl}</a></p>
                ) : (
                  <div className="review-inline">
                    <input type="text" placeholder="네이버 게시 후 글 URL 붙여넣기…" value={pubUrl} onChange={(e) => setPubUrl(e.target.value)} />
                    <button className="btn start" disabled={!pubUrl.trim()} onClick={doPublish}>발행 등록</button>
                  </div>
                )}
              </div>

              {/* 성과 입력(발행된 글만) — 수동 수집(v1 주 경로) → 강화 루프 트리거 */}
              {data.piece.publishedUrl && (
                <div className="review-section">
                  <h3>성과 입력 <span className="muted">(네이버 통계에서)</span></h3>
                  <div className="review-metrics-grid">
                    <label>조회수<input type="number" value={views} onChange={(e) => setViews(e.target.value)} placeholder="예: 1200" /></label>
                    <label>평균 체류(초)<input type="number" value={dwell} onChange={(e) => setDwell(e.target.value)} placeholder="예: 90" /></label>
                  </div>
                  <label className="review-inflow-label">유입 키워드 <span className="muted">(줄마다 "키워드,횟수,순위")</span>
                    <textarea value={inflow} onChange={(e) => setInflow(e.target.value)} rows={3} placeholder={"원두 고르는 법,420,2\n홈카페 원두,120"} />
                  </label>
                  <button className="btn start" onClick={doMetrics}>성과 저장 · 강화 반영</button>
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
