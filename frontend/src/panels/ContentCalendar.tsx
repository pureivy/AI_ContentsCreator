import { useEffect, useMemo, useState } from "react";
import { fetchPieces, createPiece, runPiece, deletePiece, PieceInfo, PieceStage } from "../api";

// 지금 실행 가능한(초안이 아직 없는) 스테이지 — idea·research·draft·error.
const RUNNABLE = new Set<PieceStage>(["idea", "research", "draft", "error"]);

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

// 파생 콘텐츠(카드뉴스·숏폼) 상태 배지 — 주제 하나의 '콘텐츠 세트' 진행을 캘린더에서 한눈에.
function DerivedBadge({ icon, name, d }: { icon: string; name: string; d?: { stage: string; running: boolean } }) {
  if (!d) return null;
  const working = d.running || ["planning", "designing", "rendering"].includes(d.stage);
  const mark = working ? "생성 중…" : d.stage === "ready" ? "완성" : "실패";
  return <span className="chip" title={`${name} ${mark}`}>{icon} {working ? "…" : d.stage === "ready" ? "✓" : "⚠"}</span>;
}

function PieceCard({ p, onRun, onDelete, running }: { p: PieceInfo; onRun: (id: string) => void; onDelete: (id: string) => void; running: boolean }) {
  return (
    <div className="piece-card">
      <div className="piece-card-title">{p.title}</div>
      <div className="piece-card-meta">
        {p.keyword && <span className="chip">🎯 {p.keyword}</span>}
        {p.subNiche && <span className="chip">{p.subNiche}</span>}
        {typeof p.seoScore === "number" && <span className="badge">SEO {p.seoScore}</span>}
        <DerivedBadge icon="🃏" name="카드뉴스" d={p.derived?.cardnews} />
        <DerivedBadge icon="🎬" name="숏폼" d={p.derived?.shorts} />
      </div>
      {p.publishedUrl && (
        <a className="piece-card-link" href={p.publishedUrl} target="_blank" rel="noreferrer">🔗 발행 글 보기</a>
      )}
      <div className="piece-card-foot">
        <span className="muted">{fmtWhen(p.updatedTs)}{p.errors ? ` · 실패 ${p.errors}` : ""}</span>
        <span>
          {RUNNABLE.has(p.stage) && (
            <button className="btn ghost piece-run-btn" disabled={running} onClick={() => onRun(p.id)}>
              {running ? "실행 중…" : "▶ 실행"}
            </button>
          )}
          <button className="btn ghost piece-run-btn" title="카드 삭제" disabled={running} onClick={() => onDelete(p.id)}>🗑</button>
        </span>
      </div>
    </div>
  );
}

export default function ContentCalendar() {
  const [pieces, setPieces] = useState<PieceInfo[]>([]);
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
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

  const doRun = async (id: string) => {
    setRunningId(id);
    const r = await runPiece(id);
    setRunningId(null);
    if (r.ok) load(); else alert(r.error || "실행 실패");
  };

  const doDelete = async (id: string) => {
    const p = pieces.find((x) => x.id === id);
    if (!confirm(`"${p?.title ?? id}" 카드를 삭제할까요?\n(산출물 파일은 남고 카드만 제거됩니다)`)) return;
    const r = await deletePiece(id);
    if (r.ok) load(); else alert(r.error || "삭제 실패");
  };

  // 주제 추가 = 아이디어 생성 + 즉시 블로그 런 시작(사용자 의도: 주제 입력 → 바로 생성).
  // 런까지 못 띄워도(동시 실행 상한 등) 아이디어 카드는 남아 자율 사이클/수동 실행으로 이어진다.
  const addIdea = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true); setErr("");
    const r = await createPiece({ title: t, keyword: keyword.trim() || undefined });
    if (r.ok && r.id) { await runPiece(r.id); }
    setBusy(false);
    if (r.ok) { setTitle(""); setKeyword(""); load(); }
    else setErr(r.error || "생성 실패");
  };

  return (
    <div className="apikeys calendar-view">
      <div className="apikeys-head">
        <h1>📅 콘텐츠 캘린더</h1>
        <p className="apikeys-sub">
          주제를 넣으면 바로 블로그 생성이 시작돼 초안→검토대기까지 이어지고, 발행·성과는 사람이 관리합니다.
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
        <button className="btn start" disabled={busy || !title.trim()} onClick={addIdea}>{busy ? "생성 시작 중…" : "+ 주제 추가 · 생성 시작"}</button>
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
                {items.map((p) => <PieceCard key={p.id} p={p} onRun={doRun} onDelete={doDelete} running={runningId === p.id} />)}
              </div>
            </div>
          );
        })}
      </div>

      {errors.length > 0 && (
        <div className="calendar-errors">
          <h3>⚠️ 실패({errors.length}) — 자율 재시도 한도 초과</h3>
          <div className="calendar-col-body">{errors.map((p) => <PieceCard key={p.id} p={p} onRun={doRun} onDelete={doDelete} running={runningId === p.id} />)}</div>
        </div>
      )}
    </div>
  );
}
