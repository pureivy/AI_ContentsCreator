import { useEffect, useState } from "react";
import {
  fetchWebtoon, runWebtoon, approveWebtoon, resumeWebtoon, cancelWebtoon, redrawWebtoon, WebtoonJob, WebtoonList,
} from "../api";

// 웹툰 탭(2026-11-05, 1단계 시범) — 블로그 글을 골라 시작 → 장면 목록·원문 대조·그림(자동) → 그림 확인(승인·장면 다시 그리기)
// → 영상(자동) → 완성본은 숏폼 기록으로 등록돼 검토 탭·텔레그램 발행 버튼으로 간다. 진행은 8초 폴링(롱폼과 같다).

const STAGE: Record<WebtoonJob["stage"], string> = {
  writing: "장면 목록 쓰는 중", checking: "원문 대조 중", drawing: "그림 그리는 중", review: "그림 확인 대기",
  producing: "영상 만드는 중", ready: "완성", error: "실패·중단", cancelled: "취소됨",
};
const ACTIVE = new Set(["writing", "checking", "drawing", "producing"]);

function fmtWhen(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  return isNaN(t) ? "" : new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtMin(sec?: number): string { return typeof sec === "number" ? `${Math.max(1, Math.round(sec / 60))}분` : ""; }

function JobRow({ j, onChanged }: { j: WebtoonJob; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const ver = encodeURIComponent(j.updatedTs);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true); setErr("");
    const r = await fn();
    setBusy(false);
    if (r.ok) { setPick(new Set()); onChanged(); } else setErr(r.error || "실패");
  };
  const toggle = (id: string) => setPick((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const fg = j.factGate;
  const wall = j.wallSec ?? {};

  return (
    <div className="review-section">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="badge" style={j.stage === "error" ? { color: "var(--con)" } : undefined}>{STAGE[j.stage]}</span>
        <strong>{j.hook || j.topic}</strong>
        {j.quiet && <span className="chip">시험(알림 없음)</span>}
        {j.durationSec != null && <span className="chip">⏱ {Math.round(j.durationSec)}초</span>}
        <span className="muted" style={{ marginLeft: "auto" }}>{fmtWhen(j.createdTs)}</span>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        원문: {j.topic}
        {(wall.writing || wall.drawing || wall.producing) ? ` · 걸린 시간 ${[wall.writing && `장면 ${fmtMin(wall.writing)}`, wall.drawing && `그림 ${fmtMin(wall.drawing)}`, wall.producing && `영상 ${fmtMin(wall.producing)}`].filter(Boolean).join(" · ")}` : ""}
      </p>
      {fg && fg.status !== "pass" && (
        <div className="muted" style={{ marginTop: 6, color: fg.status === "hold" ? "var(--con)" : undefined }}>
          {fg.status === "hold" ? `원문 대조 — 확인 필요 ${fg.unsupported.length}건(발행 때 한 번 더 확인)` : "원문 대조 판정 실패 — 낭독 문장을 직접 확인하세요"}
          {fg.unsupported.map((u, i) => <div key={i}>· {u}</div>)}
        </div>
      )}
      {j.stage === "error" && j.error && <p className="muted" style={{ color: "var(--con)", marginTop: 6 }}>{j.error}</p>}
      {ACTIVE.has(j.stage) && j.log && j.log.length > 0 && (
        <p className="muted" style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12 }}>{j.log[j.log.length - 1]}</p>
      )}

      {/* 완성 영상 미리보기(2026-11-06 사장님 "제작실 웹툰에 만들어진 영상이 없네") — 숏폼 탭과 같은 경로·재생 시에만 로드. */}
      {j.stage === "ready" && j.shortId && (
        <video key={`${j.shortId}-${j.updatedTs}`} controls preload="none"
          poster={`/shorts/${j.shortId}/thumbnail?v=${encodeURIComponent(j.updatedTs)}`}
          src={`/shorts/${j.shortId}/video`}
          style={{ display: "block", width: 220, aspectRatio: "9/16", borderRadius: 10, background: "#000", objectFit: "contain", marginTop: 10 }} />
      )}
      {(j.stage === "review" || j.stage === "ready" || j.stage === "drawing") && j.scenes && j.scenes.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 10 }}>
          {j.scenes.map((s) => (
            <label key={s.id} style={{ display: "block", cursor: j.stage === "review" ? "pointer" : "default" }}>
              <img src={`/api/webtoon/${j.id}/image/${s.id}?v=${ver}`} alt={s.id} loading="lazy"
                style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 8, background: "#111",
                  outline: pick.has(s.id) ? "3px solid var(--accent, #e67e22)" : "none" }} />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {j.stage === "review" && <input type="checkbox" checked={pick.has(s.id)} onChange={() => toggle(s.id)} style={{ marginRight: 4 }} />}
                {s.id}{s.motion === "i2v" ? " 🎬" : ""}{j.redraws?.[s.id] ? ` · 다시 ${j.redraws[s.id]}` : ""} — {s.narration}
              </div>
            </label>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        {j.stage === "review" && (
          <>
            <button className="btn start" disabled={busy} onClick={() => act(() => approveWebtoon(j.id))}
              title="이 그림으로 낭독·BGM·핵심 장면 영상·렌더를 만듭니다(약 15~60분)">승인 — 영상 만들기</button>
            <button className="btn ghost" disabled={busy || pick.size === 0} onClick={() => act(() => redrawWebtoon(j.id, [...pick]))}>
              고른 장면 다시 그리기{pick.size ? ` (${pick.size})` : ""}
            </button>
          </>
        )}
        {(j.stage === "error" || j.stage === "cancelled") && (
          <button className="btn ghost" disabled={busy} onClick={() => act(() => resumeWebtoon(j.id))}
            title="다 만든 그림·소리는 다시 만들지 않고 이어 갑니다">이어서 만들기</button>
        )}
        {(ACTIVE.has(j.stage) || j.stage === "review") && (
          <button className="btn ghost" disabled={busy} onClick={() => { if (confirm("이 웹툰 작업을 멈출까요?")) void act(() => cancelWebtoon(j.id)); }}>멈추기</button>
        )}
        {j.stage === "ready" && j.shortId && (
          <span className="muted">숏폼 {j.shortId}로 등록됨 — 검토 탭·텔레그램에서 발행하세요(인스타)</span>
        )}
        {err && <span className="muted" style={{ color: "var(--con)" }}>{err}</span>}
      </div>
    </div>
  );
}

// 제작실(StudioView) 탭의 웹툰 섹션.
export default function WebtoonSection() {
  const [data, setData] = useState<WebtoonList | null>(null);
  const [piece, setPiece] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => { fetchWebtoon().then(setData); };
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

  const start = async () => {
    if (!piece) return;
    setBusy(true); setErr("");
    const r = await runWebtoon(piece);
    setBusy(false);
    if (r.ok) { setPiece(""); load(); } else setErr(r.error || "시작 실패");
  };

  if (!data) return <p className="muted">불러오는 중…</p>;
  return (
    <>
      <div className="review-section">
        {!data.enabled && <p className="muted" style={{ color: "var(--con)" }}>웹툰 숏폼이 꺼져 있습니다(.env WEBTOON_SHORTS=true 뒤 서버 재시작).</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={piece} onChange={(e) => setPiece(e.target.value)} disabled={!data.enabled || busy} style={{ minWidth: 280, maxWidth: "100%" }}>
            <option value="">발행된 블로그 글 고르기…</option>
            {data.pieces.map((p) => <option key={p.id} value={p.id}>{p.title}{p.publishedTs ? ` (${fmtWhen(p.publishedTs)})` : ""}</option>)}
          </select>
          <button className="btn start" disabled={!data.enabled || busy || !piece || data.busy > 0} onClick={start}>
            {busy ? "시작 중…" : data.busy > 0 ? "다른 작업 도는 중" : "웹툰 만들기"}
          </button>
          {err && <span className="muted" style={{ color: "var(--con)" }}>{err}</span>}
        </div>
        <p className="muted" style={{ marginTop: 6 }}>장면 목록·그림은 자동으로 만들고, 그림을 확인한 뒤 승인하면 영상을 만듭니다. Mac Studio 한 대라 한 번에 한 편.</p>
      </div>
      {data.jobs.length === 0 && <p className="muted">아직 웹툰 숏폼이 없습니다.</p>}
      {data.jobs.map((j) => <JobRow key={j.id} j={j} onChanged={load} />)}
    </>
  );
}
