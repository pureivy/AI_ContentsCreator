import { useEffect, useState } from "react";
import { fetchPerformance, PerfData } from "../api";

// 성과 대시보드 — 발행/측정된 글의 조회수·유입 키워드와 강화 학습(전략 EWMA)을 한눈에.
const STAGE_LABEL: Record<string, string> = {
  published: "🚀 발행됨", measured: "📊 측정됨", reflected: "📈 강화 반영",
  ready: "📝 검토 대기", idea: "💡", research: "🔍", draft: "✍️", error: "⚠️",
};

export default function PerformanceView() {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); fetchPerformance().then((d) => { setData(d); setLoading(false); }); };
  useEffect(() => { load(); }, []);

  const s = data?.summary;
  const winners = data?.strategy.winners ?? [];
  const subNiches = Object.entries(data?.strategy.subNiches ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="apikeys perf-view">
      <div className="apikeys-head">
        <h1>📊 성과 대시보드</h1>
        <p className="apikeys-sub">
          발행한 글의 조회수·검색 유입과, 성과로 학습된 전략(키워드·서브니치 EWMA)을 모아 봅니다.
          <button className="btn ghost" style={{ marginLeft: 10 }} onClick={load}>새로고침</button>
        </p>
      </div>

      {loading && <div className="muted" style={{ padding: 24 }}>불러오는 중…</div>}

      {data && (
        <>
          {/* 요약 카드 */}
          <div className="perf-summary">
            <div className="perf-card"><div className="perf-num">{s?.count ?? 0}</div><div className="perf-lbl">발행/측정 글</div></div>
            <div className="perf-card"><div className="perf-num">{s?.measured ?? 0}</div><div className="perf-lbl">성과 측정됨</div></div>
            <div className="perf-card"><div className="perf-num">{(s?.totalViews ?? 0).toLocaleString()}</div><div className="perf-lbl">누적 조회수</div></div>
            <div className="perf-card"><div className="perf-num">{data.strategy.measuredPieces}</div><div className="perf-lbl">강화 반영 글</div></div>
          </div>

          {/* 강화 학습 전략 */}
          <div className="review-section">
            <h3>강화 학습된 키워드 <span className="muted">(성과 신호 EWMA — 다음 기획이 우대)</span></h3>
            {winners.length === 0 ? (
              <p className="muted">아직 학습된 키워드가 없습니다. 발행 글의 성과가 쌓이면 여기에 나타납니다.</p>
            ) : (
              <div className="piece-card-meta">
                {winners.map((w) => (
                  <span key={w.keyword} className="chip" title={`샘플 ${w.samples}건`}>
                    {w.keyword} · {(w.score * 100).toFixed(0)}
                  </span>
                ))}
              </div>
            )}
            {subNiches.length > 0 && (
              <div className="piece-card-meta" style={{ marginTop: 8 }}>
                {subNiches.map(([k, v]) => (
                  <span key={k} className="chip muted">{k} · {(v * 100).toFixed(0)}</span>
                ))}
              </div>
            )}
          </div>

          {/* 글별 성과 표 */}
          <div className="review-section">
            <h3>글별 성과</h3>
            {data.pieces.length === 0 ? (
              <p className="muted">발행된 글이 아직 없습니다. 검토 탭에서 발행 후 성과를 수집하세요.</p>
            ) : (
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <thead>
                    <tr>
                      <th>제목</th><th>상태</th><th>조회수</th><th>체류</th>
                      <th>유입 키워드(상위)</th><th>SEO</th><th>측정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pieces.map((p) => (
                      <tr key={p.id}>
                        <td className="perf-title">
                          {p.publishedUrl
                            ? <a href={p.publishedUrl} target="_blank" rel="noreferrer">{p.title}</a>
                            : p.title}
                          {p.keyword && <span className="chip" style={{ marginLeft: 6 }}>🎯 {p.keyword}</span>}
                        </td>
                        <td><span className="badge">{STAGE_LABEL[p.stage] ?? p.stage}</span></td>
                        <td className="perf-r">{p.views != null ? p.views.toLocaleString() : "—"}</td>
                        <td className="perf-r">{p.dwellSec != null ? `${p.dwellSec}s` : "—"}</td>
                        <td className="perf-inflow">
                          {p.inflow.length === 0 ? <span className="muted">—</span>
                            : p.inflow.slice(0, 4).map((k) => (
                              <span key={k.keyword} className="chip">{k.keyword} {k.count}</span>
                            ))}
                        </td>
                        <td className="perf-r">{typeof p.seoScore === "number" ? p.seoScore : "—"}</td>
                        <td className="perf-r muted">{p.samples || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
