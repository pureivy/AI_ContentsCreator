// DashboardBar — a metrics strip under the top bar (회사 · 누적토론 · TIME · WORKING ·
// OUTPUT · 위키 · 교훈 · 가동상태), styled like the reference office-sim toolbar. All
// values are live from the same folded uiState the office renders.
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { fetchWikiStats, fetchAutonomyStatus, type AutonomyStatus } from "../api";
import { countWorking } from "../events/working";
import type { MetricKind } from "./MetricDrawer";
import Ico from "./Ico";

interface Props {
  companyName: string;
  total: number;      // 전체 직원 수 (CEO + 팀장/팀원)
  runsCount: number;  // 누적 토론(기록) 수
  onMetric?: (m: MetricKind) => void;  // 지표 클릭 → 드릴다운 패널 열기
}

function Chip({ icon, label, value, accent, mono, onClick }: {
  icon: ReactNode; label: string; value: string | number;
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
  const [lessonsTotal, setLessonsTotal] = useState(0);
  const [auto, setAuto] = useState<AutonomyStatus | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // 자율 사이클 상태 — 8초 폴링(활성/대기). AUTO_CYCLE_MINUTES=0 이면 enabled=false → 칩 숨김.
  useEffect(() => {
    const load = () => fetchAutonomyStatus().then(setAuto).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  // 위키 = 저장소 지식 페이지 수(원문 source 제외; 현재 런 한정 아님). 교훈도 같은 호출로 영속 총계를
  // 받는다 — 라이브 스토어(s.lessons)는 이번 런 델타만 담아 평소 0 으로 보이던 문제(위키 칩과 동일 패턴) 보강.
  useEffect(() => {
    const load = () => fetchWikiStats().then((w) => { setWikiTotal(w.pages - w.sources); setLessonsTotal(w.lessons); }).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  // 현재 런이 위키 페이지를 추가하면 즉시 총계도 다시 가져온다.
  useEffect(() => { fetchWikiStats().then((w) => { setWikiTotal(w.pages - w.sources); setLessonsTotal(w.lessons); }).catch(() => {}); }, [s.wikiOrder.length]);

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
        <span className="dash-logo"><Ico name="company" size={15} /></span>
        <div className="dash-company-txt">
          <b>{companyName || "AI 콘텐츠 스튜디오"}</b>
          <span>AI 에이전트 조직</span>
        </div>
      </div>
      <Chip icon={<Ico name="bubble" size={14} />} label="누적 토론" value={runsCount}
        onClick={onMetric && (() => onMetric("runs"))} />
      <Chip icon={<Ico name="clock" size={14} />} label="TIME" value={hhmm} mono />
      <Chip icon={<Ico name="person" size={14} />} label="WORKING" value={`${working}/${total}`} accent={working > 0}
        onClick={onMetric && (() => onMetric("working"))} />
      <Chip icon={<Ico name="megaphone" size={14} />} label="발행" value={output} accent={output > 0}
        onClick={onMetric && (() => onMetric("output"))} />
      <Chip icon={<Ico name="document" size={14} />} label="위키" value={wikiTotal}
        onClick={onMetric && (() => onMetric("wiki"))} />
      <Chip icon={<Ico name="sparkle" size={14} />} label="인사이트" value={Math.max(lessonsTotal, s.lessons.length)}
        onClick={onMetric && (() => onMetric("lessons"))} />
      {s.approvals.length > 0 && (
        <Chip icon={<Ico name="bell" size={14} />} label="검토 대기" value={s.approvals.length} accent />
      )}
      {auto?.enabled && (
        <Chip icon={<Ico name="setting" size={14} />} label="자율" value={auto.active ? "동작 중" : "대기"} accent={auto.active} />
      )}
      <div className={`dash-live${live ? " on" : ""}`}>
        <span className="dash-dot" />
        {live ? "가동 중" : "대기"}
      </div>
    </div>
  );
}
