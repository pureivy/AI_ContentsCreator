import { useEffect, useMemo, useState } from "react";
import { fetchPieces, createPiece, PieceInfo, PieceStage } from "../api";

// 크로스-런 캘린더 — REST 폴링만(store/fold 금지: 스크럽 시 성과 수치 변형 방지). 라이프사이클 칸반.
const STAGES: { key: PieceStage; label: string; emoji: string }[] = [
  { key: "idea", label: "아이디어", emoji: "💡" },
  { key: "research", label: "리서치", emoji: "🔍" },
  { key: "draft", label: "초안 작성", emoji: "✍️" },
  { key: "ready", label: "검토 대기", emoji: "📝" },
  { key: "published", label: "발행됨", emoji: "🚀" },
  { key: "measured", label: "측정됨", emoji: "📊" },
  { key: "reflected", label: "강화 반영", emoji: "📈" },
];

function fmtWhen(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

function PieceCard({ p }: { p: PieceInfo }) {
  return (
    <div className="piece-card">
      <div className="piece-card-title">{p.title}</div>
      <div className="piece-card-meta">
        {p.keyword && <span className="chip">🎯 {p.keyword}</span>}
        {p.subNiche && <span className="chip">{p.subNiche}</span>}
        {typeof p.seoScore === "number" && <span className="badge">SEO {p.seoScore}</span>}
      </div>
      {p.publishedUrl && (
        <a className="piece-card-link" href={p.publishedUrl} target="_blank" rel="noreferrer">🔗 발행 글 보기</a>
      )}
      <div className="piece-card-foot muted">{fmtWhen(p.updatedTs)}{p.errors ? ` · 실패 ${p.errors}` : ""}</div>
    </div>
  );
}

export default function ContentCalendar() {
  const [pieces, setPieces] = useState<PieceInfo[]>([]);
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => fetchPieces().then(setPieces);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // 8초 폴링(DashboardBar 와 동일 케이던스)
    return () => clearInterval(t);
  }, []);

  const byStage = useMemo(() => {
    const m: Record<string, PieceInfo[]> = {};
    for (const p of pieces) (m[p.stage] ??= []).push(p);
    return m;
  }, [pieces]);
  const errors = byStage["error"] ?? [];

  const addIdea = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true); setErr("");
    const r = await createPiece({ title: t, keyword: keyword.trim() || undefined });
    setBusy(false);
    if (r.ok) { setTitle(""); setKeyword(""); load(); }
    else setErr(r.error || "생성 실패");
  };

  return (
    <div className="apikeys calendar-view">
      <div className="apikeys-head">
        <h1>📅 콘텐츠 캘린더</h1>
        <p className="apikeys-sub">
          자율 스튜디오가 아이디어→초안→검토대기까지 만들고, 발행·성과는 사람이 관리합니다.
          여기 카드는 크로스-런 실데이터를 8초마다 폴링합니다(총 {pieces.length}건).
        </p>
      </div>

      {/* 수동 아이디어 투입 — 자율 사이클이 다음 틱에 집어 초안까지 만든다. */}
      <div className="calendar-newidea">
        <input
          type="text" value={title} placeholder="새 콘텐츠 아이디어 제목…"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addIdea(); }}
        />
        <input
          type="text" value={keyword} placeholder="핵심 키워드(선택)"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addIdea(); }}
        />
        <button className="btn start" disabled={busy || !title.trim()} onClick={addIdea}>+ 아이디어 추가</button>
        {err && <span className="muted" style={{ color: "var(--con)" }}>{err}</span>}
      </div>

      <div className="calendar-board">
        {STAGES.map((st) => {
          const items = byStage[st.key] ?? [];
          return (
            <div key={st.key} className="calendar-col">
              <div className="calendar-col-head">
                <span>{st.emoji} {st.label}</span>
                <span className="badge">{items.length}</span>
              </div>
              <div className="calendar-col-body">
                {items.length === 0 && <div className="muted calendar-empty">—</div>}
                {items.map((p) => <PieceCard key={p.id} p={p} />)}
              </div>
            </div>
          );
        })}
      </div>

      {errors.length > 0 && (
        <div className="calendar-errors">
          <h3>⚠️ 실패({errors.length}) — 자율 재시도 한도 초과</h3>
          <div className="calendar-col-body">{errors.map((p) => <PieceCard key={p.id} p={p} />)}</div>
        </div>
      )}
    </div>
  );
}
