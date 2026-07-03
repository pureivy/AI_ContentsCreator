import { useEffect, useMemo, useState } from "react";
import {
  fetchCardNews, createCardNews, createCardNewsFromPiece, deleteCardNews,
  fetchPieces, CardNewsInfo, PieceInfo,
} from "../api";
import Avatar from "./Avatar";

// 카드뉴스 탭 — 카드뉴스팀(기획 → 디자인 → 배경 생성 → 렌더)이 만드는 인스타그램용 슬라이드.
// 발행 없음(사용자 확정): 미리보기 + 개별/zip 다운로드까지만. 진행은 8초 폴링(캘린더와 동일 케이던스).
const STAGE_LABEL: Record<string, string> = {
  planning: "📝 기획 중", designing: "🎨 디자인 중", rendering: "🖼 렌더 중", ready: "✅ 완성", error: "⚠️ 실패",
};
const RUNNING_STAGES = new Set(["planning", "designing", "rendering"]);
// 파생 소스로 쓸 수 있는 블로그 초안 단계(초안 본문이 존재).
const DERIVABLE = new Set(["ready", "published", "measured", "reflected"]);

function fmtWhen(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

function SlideGrid({ card }: { card: CardNewsInfo }) {
  const n = card.slides ?? 0;
  if (!n) return null;
  const names = Array.from({ length: n }, (_, i) => `slide_${String(i + 1).padStart(2, "0")}.png`);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginTop: 8 }}>
      {names.map((name) => (
        <a key={name} href={`/cardnews/${card.id}/slides/${name}`} target="_blank" rel="noreferrer" title={`${name} 새 탭으로 열기`}>
          <img
            src={`/cardnews/${card.id}/slides/${name}?v=${card.updatedTs}`}
            alt={`${card.topic} ${name}`}
            style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, display: "block" }}
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}

function CardRow({ card, onDelete }: { card: CardNewsInfo; onDelete: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const running = RUNNING_STAGES.has(card.stage);
  const captionFull = [card.caption, (card.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
  const copyCaption = async () => {
    try { await navigator.clipboard.writeText(captionFull); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { alert("복사 실패 — 캡션을 직접 선택해 복사하세요"); }
  };
  return (
    <div className="review-section">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="badge">{STAGE_LABEL[card.stage] ?? card.stage}</span>
        <strong>{card.topic}</strong>
        {card.keyword && <span className="chip">🎯 {card.keyword}</span>}
        {card.sourcePieceId && <span className="chip" title="블로그 초안에서 파생">📗 블로그 파생</span>}
        <span className="muted" style={{ marginLeft: "auto" }}>{fmtWhen(card.updatedTs)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }} className="muted">
        {card.planner && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Avatar id="cardnews_planner" glyph="🗂" size={18} head /> 기획 {card.planner}</span>}
        {card.designer && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Avatar id="cardnews_designer" glyph="🎨" size={18} head /> 디자인 {card.designer}</span>}
        {running && <span>… 작업 중(자동 갱신)</span>}
      </div>
      {card.stage === "error" && <p className="muted" style={{ color: "var(--con)", marginTop: 6 }}>{card.error || "알 수 없는 실패"}</p>}
      {card.stage === "ready" && (
        <>
          <SlideGrid card={card} />
          {captionFull && (
            <div style={{ marginTop: 8 }}>
              <div style={{ whiteSpace: "pre-wrap" }} className="muted">{captionFull}</div>
            </div>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {card.stage === "ready" && (
          <>
            <a className="btn start" href={`/cardnews/${card.id}/zip`} download>⬇ 전체 zip</a>
            {captionFull && <button className="btn ghost" onClick={copyCaption}>{copied ? "복사됨!" : "캡션 복사"}</button>}
          </>
        )}
        <button className="btn ghost" title="카드 삭제(산출물 파일은 남음)" disabled={running} onClick={() => onDelete(card.id)}>🗑 삭제</button>
      </div>
    </div>
  );
}

export default function CardNewsView() {
  const [cards, setCards] = useState<CardNewsInfo[]>([]);
  const [pieces, setPieces] = useState<PieceInfo[]>([]);
  const [topic, setTopic] = useState("");
  const [keyword, setKeyword] = useState("");
  const [slides, setSlides] = useState(5);
  const [srcPiece, setSrcPiece] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => { fetchCardNews().then(setCards); fetchPieces().then(setPieces); };
  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // 진행 중 카드 상태 폴링(캘린더와 동일 케이던스)
    return () => clearInterval(t);
  }, []);

  const derivable = useMemo(
    () => pieces.filter((p) => DERIVABLE.has(p.stage) && p.runId).sort((a, b) => b.updatedTs.localeCompare(a.updatedTs)),
    [pieces],
  );

  const doCreate = async () => {
    const t = topic.trim();
    if (!t) return;
    setBusy(true); setErr("");
    const r = await createCardNews({ topic: t, keyword: keyword.trim() || undefined, slides });
    setBusy(false);
    if (r.ok) { setTopic(""); setKeyword(""); load(); } else setErr(r.error || "생성 실패");
  };
  const doDerive = async () => {
    if (!srcPiece) return;
    setBusy(true); setErr("");
    const r = await createCardNewsFromPiece(srcPiece, slides);
    setBusy(false);
    if (r.ok) { setSrcPiece(""); load(); } else setErr(r.error || "생성 실패");
  };
  const doDelete = async (id: string) => {
    const card = cards.find((x) => x.id === id);
    if (!confirm(`"${card?.topic ?? id}" 카드뉴스를 삭제할까요?\n(슬라이드 파일은 남고 목록에서만 제거됩니다)`)) return;
    const r = await deleteCardNews(id);
    if (r.ok) load(); else alert(r.error || "삭제 실패");
  };

  return (
    <div className="apikeys cardnews-view">
      <div className="apikeys-head">
        <h1>🃏 카드뉴스</h1>
        <p className="apikeys-sub">
          카드뉴스팀(기획·디자인)이 주제 또는 블로그 초안에서 인스타그램용 슬라이드를 만듭니다 —
          gpt-image-2가 텍스트까지 포함한 완성 카드를 직접 그리고, 비전 QA가 한글 오타를 검수해 문제 장만 재생성합니다.
          발행은 없고 다운로드까지만(총 {cards.length}건).
        </p>
      </div>

      {/* 새 카드뉴스 — 독립 주제 */}
      <div className="review-section">
        <h3>새 카드뉴스</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="text" value={topic} placeholder="주제 (예: 장마철 실내 제습 꿀팁)" style={{ flex: "1 1 260px" }}
            onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doCreate(); }} />
          <input type="text" value={keyword} placeholder="핵심 키워드(선택)" style={{ flex: "0 1 180px" }}
            onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doCreate(); }} />
          <label className="muted">장수&nbsp;
            <select value={slides} onChange={(e) => setSlides(Number(e.target.value))}>
              {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn start" disabled={busy || !topic.trim()} onClick={doCreate}>+ 생성</button>
        </div>
        {/* 블로그 초안에서 파생 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <select value={srcPiece} onChange={(e) => setSrcPiece(e.target.value)} style={{ flex: "1 1 260px" }}>
            <option value="">블로그 초안에서 만들기 — 초안 선택…</option>
            {derivable.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <button className="btn ghost" disabled={busy || !srcPiece} onClick={doDerive}>📗 초안 → 카드뉴스</button>
          {err && <span className="muted" style={{ color: "var(--con)" }}>{err}</span>}
        </div>
      </div>

      {cards.length === 0 && <p className="muted">아직 카드뉴스가 없습니다 — 위에서 주제를 입력해 첫 카드를 만들어 보세요.</p>}
      {cards.map((card) => <CardRow key={card.id} card={card} onDelete={doDelete} />)}
    </div>
  );
}
