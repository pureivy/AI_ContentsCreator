import { useEffect, useState } from "react";
import {
  fetchLongform, uploadLongformYoutube, regenerateLongformThumbnail, runLongform, LongformInfo,
} from "../api";

// 롱폼 탭 — 매주 일요일 24:00 자동 제작되는 가로 10분 MP4. 검토 후 사람이 버튼으로 유튜브 공개 발행.
// 영상은 ~1GB 라 <video preload="metadata"> 로만 — blob 으로 받지 않는다. 진행은 8초 폴링(숏폼과 동일).
const LONGFORM_RUN_ENABLED = true; // 2단계(수동 '지금 만들기') — POST /longform/run (2026-10-22)

function fmtDur(sec?: number): string {
  if (typeof sec !== "number") return "";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}
function fmtWhen(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  return new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function LongformRow({ r, onChanged }: { r: LongformInfo; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const [ytBusy, setYtBusy] = useState(false);
  const [ytErr, setYtErr] = useState("");
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbErr, setThumbErr] = useState("");
  const [thumbOk, setThumbOk] = useState(true); // 썸네일 404 면 포스터 생략

  const ver = encodeURIComponent(r.updatedTs ?? r.createdTs);
  const uploading = r.youtubeState === "uploading" || r.youtubeState === "processing";
  const done = r.youtubeState === "done" || !!r.youtubeUrl;
  const title = r.ytTitle ?? r.title;

  const doYoutube = async () => {
    if (!confirm(`"${title}"\n\n유튜브에 공개로 발행할까요? (발행 즉시 전체공개)`)) return;
    setYtBusy(true); setYtErr("");
    let res = await uploadLongformYoutube(r.id);
    if (!res.ok && res.code === "thumb_qa_unresolved") {
      if (confirm("썸네일 한글 확인이 필요합니다. 그대로 발행할까요?")) res = await uploadLongformYoutube(r.id, { force: true });
      else { setYtBusy(false); return; }
    }
    setYtBusy(false);
    if (res.ok) onChanged(); else setYtErr(res.error || "업로드 시작 실패");
  };
  const doThumbnail = async () => {
    setThumbBusy(true); setThumbErr("");
    const res = await regenerateLongformThumbnail(r.id);
    setThumbBusy(false);
    if (res.error || res.ok === false) setThumbErr(res.error || "썸네일 생성 실패");
    setThumbOk(true); onChanged();
  };
  const copyDesc = async () => {
    try { await navigator.clipboard.writeText(r.ytDescription ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { alert("복사 실패 — 텍스트를 직접 선택해 복사하세요"); }
  };

  const thumbLabel = thumbBusy || r.thumbState === "pending" ? "생성 중" : r.thumbState === "ok" ? "정상"
    : r.thumbState === "qa_failed" ? "한글 확인 필요" : "없음";

  return (
    <div className="review-section">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {r.stage === "producing" && <span className="badge">제작 중{r.progress ? ` · ${r.progress}` : ""}</span>}
        {r.stage === "ready" && <span className="badge">검토 대기</span>}
        {r.stage === "error" && <span className="badge" style={{ color: "var(--con)" }}>오류</span>}
        <strong>{title}</strong>
        {r.durationSec != null && <span className="chip">⏱ {fmtDur(r.durationSec)}</span>}
        <span className="muted" style={{ marginLeft: "auto" }}>{fmtWhen(r.createdTs)}</span>
      </div>
      {r.topicReason && <p className="muted" style={{ marginTop: 6 }}>주제 선정: {r.topicReason}</p>}
      {r.stage === "producing" && <p className="muted" style={{ marginTop: 6 }}>… 제작 중(자동 갱신)</p>}
      {r.stage === "error" && <p className="muted" style={{ color: "var(--con)", marginTop: 6 }}>{r.error || "알 수 없는 실패"}</p>}

      {r.stage === "ready" && (
        <>
          <div style={{ marginTop: 10, maxWidth: 720 }}>
            {/* ~1GB 1920x1080 — preload=metadata 로 길이만 읽고, 포스터는 썸네일(updatedTs 캐시버스트) */}
            <video
              key={ver} controls preload="metadata"
              poster={thumbOk ? `/longform/${r.id}/thumbnail?v=${ver}` : undefined}
              src={`/longform/${r.id}/video`}
              style={{ width: "100%", aspectRatio: "16/9", borderRadius: 10, background: "#000" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }} className="muted">
            {r.thumbState !== "none" && (
              <img src={`/longform/${r.id}/thumbnail?v=${ver}`} alt="썸네일" onError={() => setThumbOk(false)}
                style={{ height: 54, aspectRatio: "16/9", objectFit: "cover", borderRadius: 6, background: "#000", display: thumbOk ? "block" : "none" }} />
            )}
            <span className="chip" title="썸네일 상태" style={r.thumbState === "qa_failed" ? { color: "var(--con)" } : undefined}>
              🖼 썸네일: {thumbLabel}
            </span>
            {typeof r.costUsd === "number" && <span>비용 ${r.costUsd.toFixed(2)}</span>}
          </div>

          <details style={{ marginTop: 8 }}>
            <summary>유튜브 제목·설명(챕터)</summary>
            <div style={{ marginTop: 6 }}>
              <div><b>{title}</b></div>
              {r.ytDescription && <div className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{r.ytDescription}</div>}
              {r.ytTags && r.ytTags.length > 0 && <div className="muted" style={{ marginTop: 6 }}>{r.ytTags.map((t) => `#${t}`).join(" ")}</div>}
              {r.ytDescription && <button className="btn ghost" style={{ marginTop: 6 }} onClick={copyDesc}>{copied ? "복사됨!" : "설명 복사"}</button>}
            </div>
          </details>

          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            {done ? (
              <>
                {r.youtubeUrl && <a className="btn ghost" href={r.youtubeUrl} target="_blank" rel="noreferrer">▶ 유튜브에서 보기</a>}
                {r.youtubeTs && <span className="muted">업로드 {fmtWhen(r.youtubeTs)}</span>}
              </>
            ) : uploading ? (
              <span className="chip">{r.youtubeState === "processing" ? "▶ 유튜브 처리 중…" : "▶ 유튜브 업로드 중…"}{r.progress ? ` ${r.progress}` : ""}(자동 갱신)</span>
            ) : (
              <button className="btn start" disabled={ytBusy} onClick={doYoutube}
                title="유튜브에 공개로 올립니다(약 1GB — 업로드는 서버 뒤에서 수 분 걸림)">
                {ytBusy ? "시작 중…" : r.youtubeState === "failed" ? "▶️ 유튜브 다시 발행" : "▶️ 유튜브 공개 발행"}
              </button>
            )}
            {!done && !uploading && (
              <button className="btn ghost" disabled={thumbBusy} onClick={doThumbnail}
                title="제목·핵심을 얹은 디자인 썸네일을 만듭니다(약 2~4분, 이미지 생성 과금)">
                {thumbBusy ? "썸네일 생성 중…(2~4분)" : r.thumbState === "ok" ? "🖼 썸네일 다시" : "🖼 썸네일 만들기"}
              </button>
            )}
            {r.youtubeState === "failed" && !ytErr && r.youtubeError && (
              <span className="muted" style={{ color: "var(--con)" }}>업로드 실패: {r.youtubeError}</span>
            )}
            {ytErr && <span className="muted" style={{ color: "var(--con)" }}>{ytErr}</span>}
            {thumbErr && <span className="muted" style={{ color: "var(--con)" }}>{thumbErr}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// 제작실(StudioView) 탭의 롱폼 섹션 — 페이지 프레임·헤더는 StudioView 가 제공.
export default function LongformSection() {
  const [items, setItems] = useState<LongformInfo[] | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runErr, setRunErr] = useState("");

  const load = () => { fetchLongform().then(setItems); };
  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // 진행·업로드 상태 폴링(숏폼과 동일 케이던스)
    return () => clearInterval(t);
  }, []);

  const doRun = async () => {
    setRunBusy(true); setRunErr("");
    const r = await runLongform();
    setRunBusy(false);
    if (r.ok) load(); else setRunErr(r.error || "시작 실패");
  };

  return (
    <>
      {LONGFORM_RUN_ENABLED && (
        <div className="review-section">
          <button className="btn start" disabled={runBusy} onClick={doRun}>{runBusy ? "시작 중…" : "지금 만들기"}</button>
          {runErr && <span className="muted" style={{ color: "var(--con)", marginLeft: 8 }}>{runErr}</span>}
        </div>
      )}
      {items && items.length === 0 && (
        <p className="muted">아직 롱폼이 없습니다. 매주 일요일 24:00에 자동으로 만들어집니다.</p>
      )}
      {(items ?? []).map((r) => <LongformRow key={r.id} r={r} onChanged={load} />)}
    </>
  );
}
