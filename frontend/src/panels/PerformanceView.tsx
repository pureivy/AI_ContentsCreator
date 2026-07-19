import { useEffect, useState } from "react";
import { fetchPerformance, refreshPerformance, deletePiece, PerfData } from "../api";
import Ico, { type IcoName } from "./Ico";

// 성과 대시보드 — 채널 통합 요약(블로그·쇼츠·카드뉴스) → 블로그 글별 → 쇼츠·카드뉴스 → 강화 학습 순.
// 스테이지 어휘는 캘린더·검토 탭과 동일(Ico).

// 조회수 추이 스파크라인 — 인라인 SVG(의존성·외부요청 없음). 하루 1점 시계열(뒤가 최신).
// 데이터 2점 미만이면 미표시(추세 없음), 마지막 점은 강조 dot. 값 범위 flat 이면 중앙선.
function Sparkline({ data, title }: { data: number[]; title?: string }) {
  if (!data || data.length < 2) return <span className="spark-empty" title="추이 데이터 부족">–</span>;
  const w = 64, h = 18, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = data[data.length - 1]! >= data[0]!; // 상승/하강 색
  const stroke = up ? "var(--spark-up, #3fb950)" : "var(--spark-down, #f85149)";
  const lx = x(data.length - 1), ly = y(data[data.length - 1]!);
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={title || "조회수 추이"} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2" fill={stroke} />
    </svg>
  );
}
const STAGE_LABEL: Record<string, { icon: IcoName; label: string }> = {
  published: { icon: "megaphone", label: "발행됨" }, measured: { icon: "chart", label: "측정됨" },
  reflected: { icon: "arrow-up-right", label: "강화 반영" }, ready: { icon: "eye", label: "검토 대기" },
  idea: { icon: "sparkle", label: "아이디어" }, research: { icon: "search", label: "리서치" },
  draft: { icon: "pencil", label: "초안" }, error: { icon: "triangle-exclamation", label: "실패" },
};

export default function PerformanceView() {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); return fetchPerformance().then((d) => { setData(d); setLoading(false); }); };
  useEffect(() => { void load(); }, []);

  // 새로고침 = 채널 성과 즉시 재수집(쇼츠 유튜브·릴스·카드뉴스) 후 재조회 — 종전엔 저장값 재조회뿐이라
  // 숫자가 안 변해 '죽은 버튼'으로 보였다(2026-07-20 사용자 보고). 블로그 수집은 검토 탭·07:30 틱.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");
  const doRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true); setRefreshMsg("");
    const r = await refreshPerformance();
    await load(); // 재수집 실패해도 표시는 최신 저장값으로 갱신
    setRefreshing(false);
    const t = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    setRefreshMsg(r.ok ? `✓ ${t} 재수집됨` : `⚠ ${r.error || "재수집 실패"} — 표시만 갱신됨`);
  };

  // 카드(행) 삭제 — 성과 샘플 파일은 남고 목록에서만 제거(서버가 실행 중 런/잡이 있으면 거절).
  const doDelete = async (id: string, title: string) => {
    if (!confirm(`"${title}" 카드를 삭제할까요?\n(산출물·성과 파일은 남고 카드만 제거됩니다)`)) return;
    const r = await deletePiece(id);
    if (r.ok) load(); else alert(r.error || "삭제 실패");
  };

  const s = data?.summary;
  const winners = data?.strategy.winners ?? [];
  const subNiches = Object.entries(data?.strategy.subNiches ?? {}).sort((a, b) => b[1] - a[1]);
  const ch = data?.channels;
  // null = 아직 수집 전(발행 후 첫 일일 틱 대기) — 0 과 구분해 "—" 로 표시.
  const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
  // 측정창 종료 후 학습 반영 여부 — 채널별 칩(✓ 반영됨, … 측정 중).
  const refl = (r: { youtube?: { reflected: boolean } | null; meta?: { reflected: boolean } | null }) =>
    [r.youtube && `YT${r.youtube.reflected ? "✓" : "…"}`, r.meta && `IG${r.meta.reflected ? "✓" : "…"}`]
      .filter(Boolean).join(" ");

  return (
    <div className="apikeys perf-view">
      <div className="apikeys-head">
        <h1><Ico name="chart" size={17} /> 성과 대시보드</h1>
        <p className="apikeys-sub">
          블로그·쇼츠·카드뉴스 채널별 성과와, 성과로 학습된 전략(키워드·서브니치 EWMA)을 모아 봅니다.
          <button className="btn ghost" style={{ marginLeft: 10 }} onClick={() => { void doRefresh(); }} disabled={refreshing}
            title="쇼츠 유튜브·릴스·카드뉴스 성과를 즉시 재수집합니다 (블로그는 검토 탭 수집·매일 07:30 자동)">
            {refreshing ? "재수집 중…" : "새로고침"}
          </button>
          {refreshMsg && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{refreshMsg}</span>}
        </p>
      </div>

      {loading && <div className="muted" style={{ padding: 24 }}>불러오는 중…</div>}

      {data && (
        <>
          {/* 요약 카드 — 채널 통합(블로그·쇼츠·카드뉴스 한눈 비교) */}
          <div className="perf-summary">
            <div className="perf-card"><div className="perf-num">{(s?.totalViews ?? 0).toLocaleString()}</div><div className="perf-lbl">블로그 조회</div></div>
            <div className="perf-card"><div className="perf-num">{(ch?.summary.shortsYtViews ?? 0).toLocaleString()}</div><div className="perf-lbl">쇼츠 유튜브 조회</div></div>
            <div className="perf-card"><div className="perf-num">{(ch?.summary.reelsViews ?? 0).toLocaleString()}</div><div className="perf-lbl">릴스 조회</div></div>
            <div className="perf-card"><div className="perf-num">{(ch?.summary.cardnewsViews ?? 0).toLocaleString()}</div><div className="perf-lbl">카드뉴스 조회</div></div>
          </div>

          {/* 블로그 성과 — 글별 표. 발행/측정/반영 카운트는 제목 옆(요약 카드는 채널 통합으로 승격). */}
          <div className="review-section">
            <h3>블로그 성과 <span className="muted">발행 {s?.count ?? 0} · 측정 {s?.measured ?? 0} · 강화 반영 {data.strategy.measuredPieces}</span></h3>
            {data.pieces.length === 0 ? (
              <p className="muted">발행된 글이 아직 없습니다. 검토 탭에서 발행 후 성과를 수집하세요.</p>
            ) : (
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <thead>
                    <tr>
                      <th>제목</th><th>상태</th><th>조회수</th><th>체류</th>
                      <th>유입 키워드(상위)</th><th>SEO</th><th title="카드뉴스"><Ico name="cards" size={13} /></th><th title="숏폼"><Ico name="play" size={13} /></th><th>측정</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pieces.map((p) => (
                      <tr key={p.id}>
                        <td className="perf-title">
                          <div className="perf-title-row">
                            {p.publishedUrl
                              ? <a href={p.publishedUrl} target="_blank" rel="noreferrer" title={p.title}>{p.title}</a>
                              : <span className="perf-title-txt" title={p.title}>{p.title}</span>}
                            {p.keyword && <span className="chip"><Ico name="location" size={11} /> {p.keyword}</span>}
                          </div>
                        </td>
                        <td><span className="badge">{STAGE_LABEL[p.stage] ? <><Ico name={STAGE_LABEL[p.stage].icon} size={10} /> {STAGE_LABEL[p.stage].label}</> : p.stage}</span></td>
                        <td className="perf-r">{p.views != null ? p.views.toLocaleString() : "—"}</td>
                        <td className="perf-r">{p.dwellSec != null ? `${p.dwellSec}s` : "—"}</td>
                        <td className="perf-inflow">
                          {p.inflow.length === 0 ? <span className="muted">—</span>
                            : p.inflow.slice(0, 4).map((k) => (
                              <span key={k.keyword} className="chip">{k.keyword} {k.count}</span>
                            ))}
                        </td>
                        <td className="perf-r">{typeof p.seoScore === "number" ? p.seoScore : "—"}</td>
                        {/* 파생 콘텐츠 세트 완성 여부 — ✓ 완성 / … 생성 중 / — 없음 */}
                        <td className="perf-r" title={p.derived?.cardnews ? `카드뉴스 ${p.derived.cardnews.stage}` : "카드뉴스 없음"}>
                          {p.derived?.cardnews ? (p.derived.cardnews.stage === "ready" ? "✓" : p.derived.cardnews.stage === "error" ? <Ico name="triangle-exclamation" size={11} /> : "…") : "—"}
                        </td>
                        <td className="perf-r" title={p.derived?.shorts ? `숏폼 ${p.derived.shorts.stage}` : "숏폼 없음"}>
                          {p.derived?.shorts ? (p.derived.shorts.stage === "ready" ? "✓" : p.derived.shorts.stage === "error" ? <Ico name="triangle-exclamation" size={11} /> : "…") : "—"}
                        </td>
                        <td className="perf-r muted">{p.samples || "—"}</td>
                        <td className="perf-r"><button className="btn ghost" title="카드 삭제" onClick={() => doDelete(p.id, p.title)}><Ico name="trash" size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 쇼츠·카드뉴스 성과 — 발행된 것만, 수집 전 값은 — 표시(합계는 상단 요약 카드). */}
          <div className="review-section">
            <h3>쇼츠·카드뉴스 성과 <span className="muted">(매일 자동 수집)</span></h3>
            {ch && (ch.shorts.length > 0 || ch.cardnews.length > 0) ? (
              <>
                {ch.shorts.length > 0 && (
                  <div className="perf-table-wrap">
                    <table className="perf-table">
                      <thead>
                        <tr><th>숏폼</th><th title="유튜브 조회수 일별 추이">추이</th><th>유튜브 조회</th><th>👍</th><th>릴스 조회</th><th>👍</th><th title="측정창 종료 후 학습 반영(✓) / 측정 중(…)">반영</th></tr>
                      </thead>
                      <tbody>
                        {ch.shorts.map((r) => (
                          <tr key={r.id}>
                            <td className="perf-title">
                              <div className="perf-title-row">
                                {r.youtube?.url
                                  ? <a href={r.youtube.url} target="_blank" rel="noreferrer" title={r.title}>{r.title}</a>
                                  : <span className="perf-title-txt" title={r.title}>{r.title}</span>}
                                {r.meta?.permalink && <a className="chip" href={r.meta.permalink} target="_blank" rel="noreferrer" title="인스타 릴스 열기">IG ↗</a>}
                              </div>
                            </td>
                            <td className="perf-spark"><Sparkline data={r.youtube?.series ?? []} title={`${r.title} 유튜브 조회 추이`} /></td>
                            <td className="perf-r">{r.youtube ? fmt(r.youtube.views) : "—"}</td>
                            <td className="perf-r">{r.youtube ? fmt(r.youtube.likes) : "—"}</td>
                            <td className="perf-r">{r.meta ? fmt(r.meta.views) : "—"}</td>
                            <td className="perf-r">{r.meta ? fmt(r.meta.likes) : "—"}</td>
                            <td className="perf-r">{refl(r)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {ch.cardnews.length > 0 && (
                  <div className="perf-table-wrap" style={{ marginTop: 10 }}>
                    <table className="perf-table">
                      <thead>
                        <tr><th>카드뉴스</th><th title="인스타 조회수 일별 추이">추이</th><th>IG 조회</th><th>도달</th><th>👍</th><th>FB 👍</th><th>공유</th><th title="측정창 종료 후 학습 반영(✓) / 측정 중(…)">반영</th></tr>
                      </thead>
                      <tbody>
                        {ch.cardnews.map((r) => (
                          <tr key={r.id}>
                            <td className="perf-title">
                              <div className="perf-title-row">
                                {r.ig?.permalink
                                  ? <a href={r.ig.permalink} target="_blank" rel="noreferrer" title={r.topic}>{r.topic}</a>
                                  : <span className="perf-title-txt" title={r.topic}>{r.topic}</span>}
                              </div>
                            </td>
                            <td className="perf-spark"><Sparkline data={r.ig?.series ?? []} title={`${r.topic} 인스타 조회 추이`} /></td>
                            <td className="perf-r">{r.ig ? fmt(r.ig.views) : "—"}</td>
                            <td className="perf-r">{r.ig ? fmt(r.ig.reach) : "—"}</td>
                            <td className="perf-r">{r.ig ? fmt(r.ig.likes) : "—"}</td>
                            <td className="perf-r">{r.fb ? fmt(r.fb.likes) : "—"}</td>
                            <td className="perf-r">{r.fb ? fmt(r.fb.shares) : "—"}</td>
                            <td className="perf-r">{r.reflected ? "✓" : "…"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="muted">발행된 쇼츠·카드뉴스가 아직 없습니다. 채널 연결 후 발행하면 성과가 매일 수집돼 여기에 나타납니다.</p>
            )}
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

        </>
      )}
    </div>
  );
}
