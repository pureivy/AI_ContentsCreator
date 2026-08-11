import { useEffect, useState } from "react";
import { fetchTitleTiming, TitleTimingReport, TitleTimingAggRow } from "../api";

// 제목 유형·발행 시각 A/B(후속 카드 2026-08-12) — 서버 즉석 집계를 표로 노출. 통계 정직성 규약을
// 화면에서도 유지한다: 표본 3편 미만 칸은 흐리게(순위로 읽히지 않게), 채널(행) 간 신호 비교 금지 안내,
// 행 최고는 견고 표본(3편+) 중에서만 강조. 데이터가 없으면 섹션 자체를 안내 문구로 대체.

/** 유형 열 순서 고정 — 서버는 신호순 정렬이라 행마다 열이 뒤섞이지 않게 화면이 고정한다. */
const TYPE_COLS = [
  { key: "question", label: "질문형" },
  { key: "hook", label: "후킹형" },
  { key: "info", label: "정보형" },
] as const;
/** 시각 슬롯 열 순서 — 서버 라벨 문자열과 정확히 일치해야 한다(analytics/titleTiming.ts slotOf). */
const SLOT_COLS = ["새벽(0~6시)", "아침(6~10시)", "낮(10~14시)", "오후(14~18시)", "저녁(18~22시)", "밤(22~24시)"];
/** 브리핑·기획 주입과 같은 눈금 — 이 미만 표본은 흐리게 표시(잡음이 우열로 읽히지 않게). */
const MIN_N = 3;

/** 행에서 강조할 최고 칸의 키 — 견고 표본(MIN_N+) 중 최고 신호. 견고 칸이 2개 미만이면 강조 없음(비교 불가). */
function bestKey(rows: TitleTimingAggRow[]): string | null {
  const solid = rows.filter((r) => r.count >= MIN_N);
  if (solid.length < 2) return null;
  return solid.reduce((a, b) => (b.avgSignal > a.avgSignal ? b : a)).key;
}

/** 신호 칸 — 0.00(N편). 얇은 표본은 흐리게, 행 최고는 상승색 강조, 없으면 —. */
function Cell({ row, best }: { row: TitleTimingAggRow | undefined; best: boolean }) {
  if (!row) return <td className="perf-r muted">—</td>;
  const thin = row.count < MIN_N;
  const style = best ? { color: "var(--spark-up, #3fb950)", fontWeight: 600 as const } : undefined;
  return (
    <td className={`perf-r${thin ? " muted" : ""}`} style={style}
      title={`평균 성과신호 ${row.avgSignal.toFixed(2)} · ${row.count}편 · 평균 ${Math.round(row.avgViews).toLocaleString()}뷰${thin ? " — 표본 3편 미만(참고만)" : ""}${best ? " — 이 채널의 최고" : ""}`}>
      {row.avgSignal.toFixed(2)}<span className="muted" style={{ fontSize: 10.5, marginLeft: 3 }}>({row.count})</span>
    </td>
  );
}

export default function TitleTimingSection() {
  const [rep, setRep] = useState<TitleTimingReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { void fetchTitleTiming().then((r) => { setRep(r); setLoaded(true); }); }, []);

  const body = () => {
    if (!loaded) return <p className="muted">불러오는 중…</p>;
    if (!rep || rep.itemsScorable === 0) {
      return <p className="muted">표본이 쌓이면 표시됩니다 — 측정창 경과분(블로그 14일·쇼츠/릴스/카드 7일)만 집계합니다.</p>;
    }
    return (
      <>
        {/* 표 1 — 채널별 제목 유형 신호. 열 고정(질문/후킹/정보), 행 최고만 강조. */}
        <div className="perf-table-wrap">
          <table className="perf-table">
            <thead>
              <tr>
                <th>채널 × 제목 유형</th>
                {TYPE_COLS.map((c) => <th key={c.key} className="perf-r">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rep.byType.map((g) => {
                const best = bestKey(g.rows);
                return (
                  <tr key={g.kind}>
                    <td className="perf-title">{g.kindKo}</td>
                    {TYPE_COLS.map((c) => (
                      <Cell key={c.key} row={g.rows.find((r) => r.key === c.key)} best={best === c.key} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 표 2 — 채널별 발행 시각(KST) 슬롯 신호. 발행 버튼을 언제 누르는 게 유리한지의 실측. */}
        <div className="perf-table-wrap" style={{ marginTop: 10 }}>
          <table className="perf-table">
            <thead>
              <tr>
                <th>채널 × 발행 시각</th>
                {SLOT_COLS.map((s) => <th key={s} className="perf-r" title={s}>{s.replace(/\(.*\)/, "")}<span className="muted" style={{ fontWeight: 400, fontSize: 10 }}> {s.match(/\((.*)\)/)?.[1] ?? ""}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {rep.bySlot.map((g) => {
                const best = bestKey(g.rows);
                return (
                  <tr key={g.kind}>
                    <td className="perf-title">{g.kindKo}</td>
                    {SLOT_COLS.map((s) => (
                      <Cell key={s} row={g.rows.find((r) => r.key === s)} best={best === s} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 팔로워 교차 — 채널 안에서만 유형 비교(채널 성장률 차이가 유형 우열로 둔갑 방지). */}
        {rep.followerByChannel.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {rep.followerByChannel.map((g) => (
              <div key={g.channel} className="piece-card-meta" style={{ padding: "3px 0" }}>
                <span className="chip" style={{ flexShrink: 0 }}>👥 {g.channelKo}</span>
                {g.rows.map((r) => (
                  <span key={r.type} className={`chip${r.items < MIN_N ? " muted" : ""}`}
                    title={`발행일 D→D+1 ${g.channelKo} 증감을 그날 발행 전체로 나눈 소박 귀속 · ${r.items}편${r.items < MIN_N ? " — 표본 3편 미만(참고만)" : ""}`}>
                    {r.typeKo} {r.perItem >= 0 ? "+" : ""}{r.perItem.toFixed(1)}명/편 ({r.items})
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}

        <p className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>
          성숙·측정 {rep.itemsScorable.toLocaleString()}편 기준(발행 {rep.itemsTotal.toLocaleString()}편 중 측정창 경과분만) ·
          신호는 채널별 눈금이라 <b>행(채널) 간 비교는 금물</b> — 같은 행 안에서만 우열을 읽으세요.
          흐린 칸은 표본 3편 미만. 같은 실측이 다음 블로그 기획 프롬프트에도 참고로 주입됩니다.
        </p>
      </>
    );
  };

  return (
    <div className="review-section">
      <h3>제목·발행시각 A/B <span className="muted">(실측 — 어떤 제목 유형·발행 시각이 통했나)</span></h3>
      {body()}
    </div>
  );
}
