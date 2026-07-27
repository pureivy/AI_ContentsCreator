import { useEffect, useState } from "react";
import { fetchPerformance, refreshPerformance, deletePiece, deleteShorts, deleteCardNews, PerfData } from "../api";
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
  // 표별 '더 보기' 펼침 상태 — 기본은 최근 5개만, 펼치면 전체(각 표는 이미 최신순 정렬).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = () => { setLoading(true); return fetchPerformance().then((d) => { setData(d); setLoading(false); }); };
  useEffect(() => { void load(); }, []);

  // 새로고침 = 채널 성과 즉시 재수집(쇼츠 유튜브·릴스·카드뉴스 API + 네이버 블로그 Playwright) 후 재조회 —
  // 종전엔 저장값 재조회뿐이라 숫자가 안 변해 '죽은 버튼'으로 보였다(2026-07-20 사용자 보고).
  // 블로그는 발행 감지 후 측정창 지난 미측정 글만 수집(브라우저 열릴 수 있음·로그인 세션 필요·프로필 사용 중이면 건너뜀).
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

  // 행 삭제(완전 삭제) — 대시보드 카드 + 연결 파일(산출물·초안 세션·성과 기록)을 휴지통(data/.trash)으로
  // 이동(사용자 요청 2026-07-22). 네이버·유튜브·인스타에 이미 게시된 원격 게시물은 남는다.
  const doDelete = async (id: string, title: string) => {
    if (!confirm(`"${title}" 글을 삭제할까요?\n카드와 초안·성과 기록이 함께 삭제(휴지통 이동)됩니다.\n네이버에 발행된 글은 남습니다.`)) return;
    const r = await deletePiece(id, { purge: true });
    if (r.ok) load(); else alert(r.error || "삭제 실패");
  };
  // 숏폼 한 레코드가 유튜브·릴스 양쪽 행으로 나타남 — 삭제 시 두 표 모두에서 사라진다(명시 안내).
  const doDeleteShorts = async (id: string, title: string) => {
    if (!confirm(`"${title}" 숏폼을 삭제할까요?\n제작실 카드·영상 산출물·성과 기록이 함께 삭제(휴지통 이동)되고, 유튜브·릴스 성과 행이 모두 사라집니다.\n유튜브·인스타에 게시된 영상은 남습니다.`)) return;
    const r = await deleteShorts(id, { purge: true });
    if (r.ok) load(); else alert(r.error || "삭제 실패");
  };
  const doDeleteCardnews = async (id: string, topic: string) => {
    if (!confirm(`"${topic}" 카드뉴스를 삭제할까요?\n제작실 카드·슬라이드 산출물·성과 기록이 함께 삭제(휴지통 이동)됩니다.\n인스타에 게시된 게시물은 남습니다.`)) return;
    const r = await deleteCardNews(id, { purge: true });
    if (r.ok) load(); else alert(r.error || "삭제 실패");
  };

  const s = data?.summary;
  const winners = data?.strategy.winners ?? [];
  const subNiches = Object.entries(data?.strategy.subNiches ?? {}).sort((a, b) => b[1] - a[1]);
  const ch = data?.channels;
  // null = 아직 수집 전(발행 후 첫 일일 틱 대기) — 0 과 구분해 "—" 로 표시.
  const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
  // 발행·업로드 날짜 표기 — YYYY.MM.DD(로컬). 없으면 "—".
  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—"
      : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };
  // 측정창 종료 후 학습 강화 반영 여부 칩 — 3상태. '측정 중'(창 안, 정상 대기)과 '수집 불가'(비공개·삭제·
  // 포기 지평 경과로 영구 정체)를 구분해야 죽은 행이 대기 중인 척 남지 않는다.
  // 채널(쇼츠·릴스·카드뉴스) 강화는 담당 직원 메모리 + 위키를 갱신한다. 키워드·서브니치 EWMA 전략은
  // 블로그 경로 전용(reinforce.ts 의 updateStrategy)이라 여기 문구에 섞으면 안 된다.
  const reflBadge = (reflected: boolean, stale?: boolean) => {
    if (reflected) return <span className="chip" title="측정창이 끝나 성과가 담당 직원 메모리·위키에 학습 반영됐습니다.">✓ 반영</span>;
    if (stale) return <span className="chip stale" title="수집 대상에서 빠졌습니다 — 영상·게시물이 비공개·삭제됐거나 측정 기한이 지나 성과를 더는 가져올 수 없습니다. 학습에 반영되지 않습니다.">수집 불가</span>;
    return <span className="chip muted" title="측정창이 아직 진행 중입니다 — 창이 끝나면 성과가 담당 직원 메모리·위키에 1회 학습 반영됩니다.">측정 중</span>;
  };
  // 채널별 분리 — 한 숏폼이 유튜브·인스타 양쪽에 발행됐으면 각 섹션에 각각 나타난다(채널별 성과 독립).
  // 정렬·업로드일도 채널별 타임스탬프 사용(youtube.ts / meta.ts) — 상단 r.ts(최신값)와 달라 섹션별로 정확.
  const ytShorts = (ch?.shorts.filter((r) => r.youtube) ?? [])
    .sort((a, b) => (b.youtube!.ts).localeCompare(a.youtube!.ts));
  const reels = (ch?.shorts.filter((r) => r.meta) ?? [])
    .sort((a, b) => (b.meta!.ts).localeCompare(a.meta!.ts));
  const cardnews = ch?.cardnews ?? [];

  // 최근 5개만 기본 표시, 나머지는 '더 보기'로 펼침(표별 독립 상태). 배열은 이미 최신순.
  const LIMIT = 5;
  const take = <T,>(key: string, rows: T[]) => (expanded[key] ? rows : rows.slice(0, LIMIT));
  const moreBtn = (key: string, total: number) =>
    total > LIMIT ? (
      <div className="perf-more-row">
        <button className="btn ghost" onClick={() => setExpanded((e) => ({ ...e, [key]: !e[key] }))}>
          {expanded[key] ? "접기" : `더 보기 (+${total - LIMIT})`}
        </button>
      </div>
    ) : null;

  return (
    <div className="apikeys perf-view">
      <div className="apikeys-head">
        <h1><Ico name="chart" size={17} /> 성과 대시보드</h1>
        <p className="apikeys-sub">
          블로그·쇼츠·카드뉴스 채널별 성과와, 성과로 학습된 전략(키워드·서브니치 EWMA)을 모아 봅니다.
          <button className="btn ghost" style={{ marginLeft: 10 }} onClick={() => { void doRefresh(); }} disabled={refreshing}
            title="블로그·쇼츠 유튜브·릴스·카드뉴스 성과를 즉시 재수집합니다 (블로그는 발행 감지 후 측정창 지난 미측정 글만 — 브라우저가 열릴 수 있고 네이버 로그인 세션이 필요)">
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
            <div className="perf-card"><div className="perf-num">{(ch?.summary.reelsViews ?? 0).toLocaleString()}</div><div className="perf-lbl" title="인스타그램 릴스 조회 합계 — 같은 콘텐츠를 두 플랫폼에서 합산하면 수치가 부풀려지므로 페이스북은 표에서 따로 봅니다">인스타 릴스 조회</div></div>
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
                      <th>제목</th>
                      <th className="perf-c">발행일</th>
                      <th className="perf-c">링크</th>
                      <th className="perf-c">상태</th>
                      <th className="perf-r">조회수</th>
                      <th className="perf-r">체류</th>
                      <th>유입 키워드(상위)</th>
                      <th className="perf-r">SEO</th>
                      <th className="perf-c" title="파생 카드뉴스 완성 여부"><Ico name="cards" size={13} /></th>
                      <th className="perf-c" title="파생 숏폼 완성 여부"><Ico name="play" size={13} /></th>
                      <th className="perf-r" title="성과 측정 표본 수">측정</th>
                      <th className="perf-c"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {take("blog", data.pieces).map((p) => (
                      <tr key={p.id}>
                        <td className="perf-title">
                          <div className="perf-title-row">
                            <span className="perf-title-txt" title={p.title}>{p.title}</span>
                            {p.keyword && <span className="chip"><Ico name="location" size={11} /> {p.keyword}</span>}
                          </div>
                        </td>
                        <td className="perf-date perf-c">{fmtDate(p.date)}</td>
                        <td className="perf-c">
                          <span className="perf-links">
                            {p.publishedUrl
                              ? <a className="perf-link-badge" href={p.publishedUrl} target="_blank" rel="noreferrer" title="네이버 블로그에서 열기">N</a>
                              : <span className="perf-link-badge off" title="미발행">N</span>}
                          </span>
                        </td>
                        <td className="perf-c"><span className="badge">{STAGE_LABEL[p.stage] ? <><Ico name={STAGE_LABEL[p.stage].icon} size={10} /> {STAGE_LABEL[p.stage].label}</> : p.stage}</span></td>
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
                        <td className="perf-c" title={p.derived?.cardnews ? `카드뉴스 ${p.derived.cardnews.stage}` : "카드뉴스 없음"}>
                          {p.derived?.cardnews ? (p.derived.cardnews.stage === "ready" ? "✓" : p.derived.cardnews.stage === "error" ? <Ico name="triangle-exclamation" size={11} /> : "…") : "—"}
                        </td>
                        <td className="perf-c" title={p.derived?.shorts ? `숏폼 ${p.derived.shorts.stage}` : "숏폼 없음"}>
                          {p.derived?.shorts ? (p.derived.shorts.stage === "ready" ? "✓" : p.derived.shorts.stage === "error" ? <Ico name="triangle-exclamation" size={11} /> : "…") : "—"}
                        </td>
                        <td className="perf-r muted">{p.samples || "—"}</td>
                        <td className="perf-c"><button className="btn ghost" title="카드 삭제" onClick={() => doDelete(p.id, p.title)}><Ico name="trash" size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {moreBtn("blog", data.pieces.length)}
              </div>
            )}
          </div>

          {/* 채널별 성과 — 유튜브 쇼츠 / 인스타 릴스 / 카드뉴스 각각 구분(매일 자동 수집). 한 숏폼이 양쪽 발행이면 각 표에 각각. */}
          <div className="review-section">
            <h3>유튜브 쇼츠 성과 <span className="muted">(매일 자동 수집)</span></h3>
            {ytShorts.length > 0 ? (
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <thead>
                    <tr>
                      <th>숏폼</th>
                      <th className="perf-c">업로드일</th>
                      <th className="perf-c">링크</th>
                      <th className="perf-c" title="유튜브 조회수 일별 추이">추이</th>
                      <th className="perf-r">조회</th>
                      <th className="perf-r">👍</th>
                      <th className="perf-c" title="직원 메모리·위키에 학습 반영(✓ 반영) / 측정창 진행 중(측정 중) / 비공개·삭제·기한 경과로 영구 정체(수집 불가)">반영</th>
                      <th className="perf-c"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {take("yt", ytShorts).map((r) => (
                      <tr key={r.id}>
                        <td className="perf-title">
                          <div className="perf-title-row">
                            <span className="perf-title-txt" title={r.title}>{r.title}</span>
                          </div>
                        </td>
                        <td className="perf-date perf-c">{fmtDate(r.youtube?.ts ?? r.ts)}</td>
                        <td className="perf-c">
                          <span className="perf-links">
                            {r.youtube?.url
                              ? <a className="perf-link-badge" href={r.youtube.url} target="_blank" rel="noreferrer" title="유튜브에서 열기">▶</a>
                              : <span className="perf-link-badge off" title="유튜브 미업로드">▶</span>}
                          </span>
                        </td>
                        <td className="perf-spark perf-c"><Sparkline data={r.youtube?.series ?? []} title={`${r.title} 유튜브 조회 추이`} /></td>
                        <td className="perf-r">{r.youtube ? fmt(r.youtube.views) : "—"}</td>
                        <td className="perf-r">{r.youtube ? fmt(r.youtube.likes) : "—"}</td>
                        <td className="perf-c">{r.youtube ? reflBadge(r.youtube.reflected, r.youtube.stale) : "—"}</td>
                        <td className="perf-c"><button className="btn ghost" title="숏폼 삭제 — 산출물·성과 포함(유튜브·릴스 행 모두 사라짐)" onClick={() => doDeleteShorts(r.id, r.title)}><Ico name="trash" size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {moreBtn("yt", ytShorts.length)}
              </div>
            ) : (
              <p className="muted">유튜브에 발행된 쇼츠가 아직 없습니다.</p>
            )}
          </div>

          <div className="review-section">
            <h3>릴스 성과 <span className="muted">(인스타·페이스북 · 매일 자동 수집)</span></h3>
            {reels.length > 0 ? (
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <thead>
                    {/* 2단 헤더 — 같은 릴스가 두 플랫폼에 올라가므로 숫자 열이 어느 채널인지 그룹으로 묶는다.
                        (평면 나열이면 'FB 조회'가 인스타 열 위에 걸쳐 보여 제목과 값이 안 맞게 읽혔다.) */}
                    <tr className="perf-grouprow">
                      <th className="perf-grp-none" colSpan={3}></th>
                      <th colSpan={3}>📸 인스타그램</th>
                      <th className="perf-grp-edge" colSpan={2}>📘 페이스북</th>
                      <th className="perf-grp-none perf-grp-edge" colSpan={2}></th>
                    </tr>
                    <tr>
                      <th>릴스</th>
                      <th className="perf-c">업로드일</th>
                      <th className="perf-c">링크</th>
                      <th className="perf-c" title="인스타 조회수 일별 추이">추이</th>
                      <th className="perf-r">조회</th>
                      <th className="perf-r">👍</th>
                      <th className="perf-r perf-grp-edge" title="페이스북 페이지 릴스 조회 — 미게시면 '—'">조회</th>
                      <th className="perf-r" title="페이스북 릴스 좋아요. 🖼 는 커버(썸네일) 미적용 — 쇼츠 탭에서 '페북 커버 적용'">👍</th>
                      <th className="perf-c perf-grp-edge" title="직원 메모리·위키에 학습 반영(✓ 반영) / 측정창 진행 중(측정 중) / 비공개·삭제·기한 경과로 영구 정체(수집 불가)">반영</th>
                      <th className="perf-c"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {take("reels", reels).map((r) => (
                      <tr key={r.id}>
                        <td className="perf-title">
                          <div className="perf-title-row">
                            <span className="perf-title-txt" title={r.title}>{r.title}</span>
                          </div>
                        </td>
                        <td className="perf-date perf-c">{fmtDate(r.meta?.ts ?? r.ts)}</td>
                        {/* 링크는 전용 열의 배지로 — 제목·숫자에 링크를 섞지 않는다(어느 채널로 가는지 모호했다). */}
                        <td className="perf-c">
                          <span className="perf-links">
                            {r.meta?.permalink
                              ? <a className="perf-link-badge" href={r.meta.permalink} target="_blank" rel="noreferrer" title="인스타그램 릴스 열기">📸</a>
                              : <span className="perf-link-badge off" title="인스타그램 미게시">📸</span>}
                            {r.fb
                              ? <a className="perf-link-badge" href={r.fb.url} target="_blank" rel="noreferrer" title="페이스북 릴스 열기">📘</a>
                              : <span className="perf-link-badge off" title="페이스북 페이지 미게시">📘</span>}
                          </span>
                        </td>
                        <td className="perf-spark perf-c"><Sparkline data={r.meta?.series ?? []} title={`${r.title} 인스타 릴스 조회 추이`} /></td>
                        <td className="perf-r">{r.meta ? fmt(r.meta.views) : "—"}</td>
                        <td className="perf-r">{r.meta ? fmt(r.meta.likes) : "—"}</td>
                        <td className="perf-r perf-grp-edge">{r.fb ? fmt(r.fb.views) : "—"}</td>
                        <td className="perf-r">
                          {r.fb
                            ? <>{fmt(r.fb.likes)}{r.fb.coverPending && <span title="커버(썸네일) 미적용 — 쇼츠 탭의 '🖼 페북 커버 적용'으로 보강" style={{ marginLeft: 3 }}>🖼</span>}</>
                            : "—"}
                        </td>
                        <td className="perf-c perf-grp-edge">{r.meta ? reflBadge(r.meta.reflected, r.meta.stale) : "—"}</td>
                        <td className="perf-c"><button className="btn ghost" title="숏폼 삭제 — 산출물·성과 포함(유튜브·릴스 행 모두 사라짐)" onClick={() => doDeleteShorts(r.id, r.title)}><Ico name="trash" size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {moreBtn("reels", reels.length)}
              </div>
            ) : (
              <p className="muted">인스타그램에 발행된 릴스가 아직 없습니다.</p>
            )}
          </div>

          <div className="review-section">
            <h3>카드뉴스 성과 <span className="muted">(매일 자동 수집)</span></h3>
            {cardnews.length > 0 ? (
              <div className="perf-table-wrap">
                <table className="perf-table">
                  <thead>
                    {/* 릴스 표와 동일 구조 — 두 표를 나란히 볼 때 열 의미가 흔들리지 않게 통일. */}
                    <tr className="perf-grouprow">
                      <th className="perf-grp-none" colSpan={3}></th>
                      <th colSpan={4}>📸 인스타그램</th>
                      <th className="perf-grp-edge" colSpan={2}>📘 페이스북</th>
                      <th className="perf-grp-none perf-grp-edge" colSpan={2}></th>
                    </tr>
                    <tr>
                      <th>카드뉴스</th>
                      <th className="perf-c">업로드일</th>
                      <th className="perf-c">링크</th>
                      <th className="perf-c" title="인스타 조회수 일별 추이">추이</th>
                      <th className="perf-r">조회</th>
                      <th className="perf-r">도달</th>
                      <th className="perf-r">👍</th>
                      <th className="perf-r perf-grp-edge">👍</th>
                      <th className="perf-r">공유</th>
                      <th className="perf-c perf-grp-edge" title="직원 메모리·위키에 학습 반영(✓ 반영) / 측정창 진행 중(측정 중) / 비공개·삭제·기한 경과로 영구 정체(수집 불가)">반영</th>
                      <th className="perf-c"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {take("cardnews", cardnews).map((r) => (
                      <tr key={r.id}>
                        <td className="perf-title">
                          <div className="perf-title-row">
                            <span className="perf-title-txt" title={r.topic}>{r.topic}</span>
                          </div>
                        </td>
                        <td className="perf-date perf-c">{fmtDate(r.ts)}</td>
                        <td className="perf-c">
                          <span className="perf-links">
                            {r.ig?.permalink
                              ? <a className="perf-link-badge" href={r.ig.permalink} target="_blank" rel="noreferrer" title="인스타그램 게시물 열기">📸</a>
                              : <span className="perf-link-badge off" title="인스타그램 미게시">📸</span>}
                            {r.fb
                              ? <a className="perf-link-badge" href={r.fb.url} target="_blank" rel="noreferrer" title="페이스북 페이지 게시물 열기">📘</a>
                              : <span className="perf-link-badge off" title="페이스북 페이지 미게시">📘</span>}
                          </span>
                        </td>
                        <td className="perf-spark perf-c"><Sparkline data={r.ig?.series ?? []} title={`${r.topic} 인스타 조회 추이`} /></td>
                        <td className="perf-r">{r.ig ? fmt(r.ig.views) : "—"}</td>
                        <td className="perf-r">{r.ig ? fmt(r.ig.reach) : "—"}</td>
                        <td className="perf-r">{r.ig ? fmt(r.ig.likes) : "—"}</td>
                        <td className="perf-r perf-grp-edge">{r.fb ? fmt(r.fb.likes) : "—"}</td>
                        <td className="perf-r">{r.fb ? fmt(r.fb.shares) : "—"}</td>
                        <td className="perf-c perf-grp-edge">{reflBadge(r.reflected, r.stale)}</td>
                        <td className="perf-c"><button className="btn ghost" title="카드뉴스 삭제 — 산출물·성과 포함" onClick={() => doDeleteCardnews(r.id, r.topic)}><Ico name="trash" size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {moreBtn("cardnews", cardnews.length)}
              </div>
            ) : (
              <p className="muted">발행된 카드뉴스가 아직 없습니다.</p>
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
