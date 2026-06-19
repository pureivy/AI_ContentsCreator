// DashboardBar — a metrics strip under the top bar (회사 · 누적토론 · TIME · WORKING ·
// OUTPUT · 위키 · 교훈 · 가동상태), styled like the reference office-sim toolbar. All
// values are live from the same folded uiState the office renders.
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { fetchWikiStats } from "../api";
import { countWorking } from "../events/working";
import type { MetricKind } from "./MetricDrawer";

interface Props {
  companyName: string;
  total: number;      // 전체 직원 수 (CEO + 팀장/팀원)
  runsCount: number;  // 누적 토론(기록) 수
  onMetric?: (m: MetricKind) => void;  // 지표 클릭 → 드릴다운 패널 열기
}

function Chip({ icon, label, value, accent, mono, onClick }: {
  icon: string; label: string; value: string | number;
  accent?: boolean; mono?: boolean; onClick?: () => void;
}) {
  const cls = `dash-chip${accent ? " accent" : ""}${onClick ? " clickable" : ""}`;
  const inner = (
    <>
      <span className="dash-icon">{icon}</span>
      <div className="dash-meta">
        <span className="dash-label">{label}</span>
        <span className={`dash-value${mono ? " mono" : ""}`}>{value}</span>
      </div>
    </>
  );
  return onClick
    ? <button type="button" className={cls} onClick={onClick}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

export default function DashboardBar({ companyName, total, runsCount, onMetric }: Props) {
  const s = useStore();
  const [now, setNow] = useState(() => new Date());
  const [wikiTotal, setWikiTotal] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // 위키 = 저장소 지식 페이지 수(원문 source 제외; 현재 런 한정 아님). 마운트 + 8초 폴링으로 업로드/타 세션 반영.
  useEffect(() => {
    const load = () => fetchWikiStats().then((w) => setWikiTotal(w.pages - w.sources)).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  // 현재 런이 위키 페이지를 추가하면 즉시 총계도 다시 가져온다.
  useEffect(() => { fetchWikiStats().then((w) => setWikiTotal(w.pages - w.sources)).catch(() => {}); }, [s.wikiOrder.length]);

  const hhmm = now.toTimeString().slice(0, 5);
  // "WORKING" = 사무실 안무가 작업 중으로 보여주는 아바타 수 — events/working.ts 의
  // 공유 규칙(engaged 웨이브 + placeholder 제외 + running 게이트)을 그대로 사용해
  // OfficeView 와 절대 어긋나지 않는다.
  const working = countWorking(s);
  const output =
    s.messages.filter((m) => m.move === "deliverable" && (m.text || "").trim()).length +
    (s.synthesis.trim() ? 1 : 0);
  const live = s.status === "running";

  return (
    <div className="dashboard-bar">
      <div className="dash-company">
        <span className="dash-logo">🏢</span>
        <div className="dash-company-txt">
          <b>{companyName || "GEPA"}</b>
          <span>AI 에이전트 조직</span>
        </div>
      </div>
      <Chip icon="📅" label="누적 토론" value={runsCount}
        onClick={onMetric && (() => onMetric("runs"))} />
      <Chip icon="⏰" label="TIME" value={hhmm} mono />
      <Chip icon="👥" label="WORKING" value={`${working}/${total}`} accent={working > 0}
        onClick={onMetric && (() => onMetric("working"))} />
      <Chip icon="📄" label="OUTPUT" value={output} accent={output > 0}
        onClick={onMetric && (() => onMetric("output"))} />
      <Chip icon="📚" label="위키" value={wikiTotal}
        onClick={onMetric && (() => onMetric("wiki"))} />
      <Chip icon="🏆" label="교훈" value={s.lessons.length}
        onClick={onMetric && (() => onMetric("lessons"))} />
      <div className={`dash-live${live ? " on" : ""}`}>
        <span className="dash-dot" />
        {live ? "가동 중" : "대기"}
      </div>
    </div>
  );
}
