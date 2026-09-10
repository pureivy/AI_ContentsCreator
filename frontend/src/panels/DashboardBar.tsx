// DashboardBar — a metrics strip under the top bar (회사 · 누적토론 · TIME · WORKING ·
// OUTPUT · 위키 · 교훈 · 가동상태), styled like the reference office-sim toolbar. All
// values are live from the same folded uiState the office renders.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { fetchWikiStats, fetchAutonomyStatus, fetchBrands, activateBrand, toggleAutonomy, setAutonomyDirective, type AutonomyStatus, type BrandListItem } from "../api";
import { countWorking } from "../events/working";
import type { MetricKind } from "./MetricDrawer";
import Ico from "./Ico";

interface Props {
  companyName: string;
  total: number;      // 전체 직원 수 (CEO + 팀장/팀원)
  runsCount: number;  // 누적 토론(기록) 수
  onMetric?: (m: MetricKind) => void;  // 지표 클릭 → 드릴다운 패널 열기
  onOpenBrand?: () => void;            // '브랜드 관리' → 브랜드 탭 이동
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

export default function DashboardBar({ companyName, total, runsCount, onMetric, onOpenBrand }: Props) {
  const s = useStore();
  const [now, setNow] = useState(() => new Date());
  // 브랜드(고객사) 전환 — 회사 칩이 활성 브랜드명을 보여주고, 클릭 시 저장된 브랜드 중 선택.
  const [brands, setBrands] = useState<BrandListItem[]>([]);
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [brandMenu, setBrandMenu] = useState(false);
  const [switching, setSwitching] = useState(false);
  const brandRef = useRef<HTMLDivElement>(null);
  // 대시보드 바가 overflow-x:auto 라 absolute 메뉴가 잘린다 — 버튼 위치 기준 fixed 로 띄운다.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const toggleBrandMenu = () => {
    const r = brandRef.current?.getBoundingClientRect();
    setMenuPos(r ? { top: r.bottom + 6, left: r.left } : null);
    setBrandMenu((v) => !v);
  };
  useEffect(() => {
    const load = () => fetchBrands().then((r) => { setBrands(r.brands); setActiveBrand(r.active); }).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!brandMenu) return;
    const h = (e: MouseEvent) => { if (brandRef.current && !brandRef.current.contains(e.target as Node)) setBrandMenu(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [brandMenu]);
  const doSwitch = async (slug: string | null) => {
    if (switching || slug === activeBrand) { setBrandMenu(false); return; }
    setSwitching(true);
    const r = await activateBrand(slug);
    setSwitching(false); setBrandMenu(false);
    if (r.ok) { const b = await fetchBrands(); setBrands(b.brands); setActiveBrand(b.active); }
    else alert(r.error || "브랜드 전환 실패");
  };
  const activeName = brands.find((b) => b.slug === activeBrand)?.name;
  const [wikiTotal, setWikiTotal] = useState(0);
  const [lessonsTotal, setLessonsTotal] = useState(0);
  const [auto, setAuto] = useState<AutonomyStatus | null>(null);
  // 자율 메뉴(2026-09-10) — '자율' 칩 하나에 켜기/끄기와 사장님 지시를 같이 둔다(칩이 둘이면 보기 나쁘다는 사용자 지적).
  // 종전엔 칩 클릭이 곧 토글이었다 — 이제 토글은 메뉴 첫 줄의 버튼이다(한 번 더 누르지만 상태가 같이 보인다).
  const [dirMenu, setDirMenu] = useState(false);
  const [dirPos, setDirPos] = useState<{ top: number; left: number } | null>(null);
  const [dirText, setDirText] = useState("");
  // 방식 선택 — 저장된 지시가 꺼져 있어도 "지시대로"를 골라 문장을 고칠 수 있게 하는 화면 상태.
  const [wantDirective, setWantDirective] = useState(false);
  const [dirBusy, setDirBusy] = useState(false);
  const dirRef = useRef<HTMLDivElement>(null);
  const DIR_MENU_W = 320;
  const openDirMenu = () => {
    const r = dirRef.current?.getBoundingClientRect();
    // 좁은 창에서 오른쪽이 잘리지 않게 — 칩 왼쪽에서 시작하되 뷰포트 안으로 밀어 넣는다(사용자 지적 2026-09-10).
    const left = r ? Math.max(8, Math.min(r.left, window.innerWidth - DIR_MENU_W - 8)) : 8;
    setDirPos(r ? { top: r.bottom + 6, left } : null);
    setDirText(auto?.directive?.text ?? "");
    setWantDirective(!!auto?.directive?.on);
    setDirMenu((v) => !v);
  };
  useEffect(() => {
    if (!dirMenu) return;
    const h = (e: MouseEvent) => { if (dirRef.current && !dirRef.current.contains(e.target as Node)) setDirMenu(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [dirMenu]);
  const applyDirective = async (body: { text?: string; on?: boolean; maxPieces?: number | null }) => {
    if (dirBusy) return;
    setDirBusy(true);
    const r = await setAutonomyDirective(body);
    setDirBusy(false);
    if (!r.ok) { alert("자율런 지시 저장 실패"); return; }
    const st = await fetchAutonomyStatus().catch(() => null);
    if (st) setAuto(st);
  };
  const doToggleAutonomy = async () => {
    if (dirBusy) return;
    setDirBusy(true);
    await toggleAutonomy();
    const st = await fetchAutonomyStatus().catch(() => null);
    if (st) setAuto(st);
    setDirBusy(false);
  };
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
      <div className="dash-company-wrap" ref={brandRef}>
        <button type="button" className="dash-company clickable" title="브랜드(고객사) 선택"
          onClick={toggleBrandMenu}>
          <span className="dash-logo"><Ico name="company" size={15} /></span>
          <div className="dash-company-txt">
            <b>{activeName || companyName || "AI 콘텐츠 스튜디오"}</b>
            <span>{activeName ? `${companyName || "AI 콘텐츠 스튜디오"} · 브랜드` : "AI 에이전트 조직"} ▾</span>
          </div>
        </button>
        {brandMenu && (
          <div className="upload-menu brand-menu"
            style={menuPos ? { position: "fixed", top: menuPos.top, left: menuPos.left } : undefined}>
            <button className="llm-menu-item" disabled={switching} onClick={() => doSwitch(null)}>
              {activeBrand == null ? "✓ " : ""}범용 모드 <span className="muted">(브랜드 없음)</span>
            </button>
            {brands.map((b) => (
              <button key={b.slug} className="llm-menu-item" disabled={switching} onClick={() => doSwitch(b.slug)} title={b.industry || undefined}>
                {b.slug === activeBrand ? "✓ " : ""}{b.name}
              </button>
            ))}
            {onOpenBrand && (
              <button className="llm-menu-item" onClick={() => { setBrandMenu(false); onOpenBrand(); }}>
                ＋ 브랜드 관리…
              </button>
            )}
          </div>
        )}
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
        /* 자율 칩(2026-09-10 통합) — 값은 자율런 상태, 지시가 켜져 있으면 '· 지시'. 클릭 → 켜기/끄기 + 지시 메뉴. */
        <div className="dash-company-wrap dash-auto-wrap" ref={dirRef}>
          <Chip icon={<Ico name="setting" size={14} />} label="자율"
            value={`${auto.run_enabled === false ? "꺼짐" : auto.active ? "동작 중" : "대기"}${auto.directive?.on ? " · 지시" : ""}`}
            accent={auto.active && auto.run_enabled !== false}
            onClick={openDirMenu} />
          {dirMenu && (() => {
            const runOn = auto.run_enabled !== false;
            const dirOn = !!auto.directive?.on;
            const mode: "plain" | "directive" = dirOn || wantDirective ? "directive" : "plain";
            const saved = auto.directive?.text ?? "";
            const applied = dirOn && dirText.trim() === saved;
            return (
              <div className="upload-menu brand-menu dash-directive"
                style={{ width: DIR_MENU_W, ...(dirPos ? { position: "fixed", top: dirPos.top, left: dirPos.left } : {}) }}>
                {/* 1) 자율런 스위치 */}
                <div className="dash-directive-row dash-directive-head">
                  <span className="dash-directive-title">자율런</span>
                  <button className={`dash-switch${runOn ? " on" : ""}`} disabled={dirBusy} onClick={() => { void doToggleAutonomy(); }}
                    title={runOn ? "자율런 끄기" : "자율런 켜기"}>
                    {!runOn ? "꺼짐" : auto.active ? "동작 중" : "켜짐"}
                  </button>
                </div>
                {/* 2) 방식 — 기존 자율런 / 지시대로. 자율런이 꺼져 있으면 지시도 읽히지 않으므로 잠근다. */}
                <div className="dash-directive-row">
                  <span className="dash-directive-title">방식</span>
                  <div className="dash-seg">
                    <button className={`dash-seg-btn${mode === "plain" ? " on" : ""}`} disabled={!runOn || dirBusy}
                      onClick={() => { setWantDirective(false); if (dirOn) void applyDirective({ on: false }); }}>기존 자율런</button>
                    <button className={`dash-seg-btn${mode === "directive" ? " on" : ""}`} disabled={!runOn || dirBusy}
                      onClick={() => { setWantDirective(true); if (!dirOn && saved && dirText.trim() === saved) void applyDirective({ on: true }); }}>지시대로</button>
                  </div>
                </div>
                {!runOn && <div className="muted dash-directive-note">자율런이 꺼져 있어 지시가 적용되지 않습니다 — 먼저 자율런을 켜세요.</div>}
                {runOn && mode === "directive" && (
                  <>
                    <textarea className="dash-directive-text" rows={3} value={dirText} onChange={(e) => setDirText(e.target.value)}
                      placeholder="예: 보관소의 수종별 수확 후 전정 및 거름주는 방법" />
                    <div className="dash-directive-row">
                      <button className="btn" disabled={dirBusy || !dirText.trim() || applied}
                        onClick={() => { void applyDirective({ text: dirText, on: true, maxPieces: null }); }}>
                        {applied ? "적용됨" : dirOn ? "바꿔서 적용" : "지시 적용"}
                      </button>
                      {dirOn && <span className="muted">{auto.directive!.made}편 진행 · 더 낼 주제가 없으면 기존 자율런으로 돌아갑니다</span>}
                      {!dirOn && auto.directive?.lastResult && <span className="muted">{auto.directive.lastResult}</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}
      <div className={`dash-live${live ? " on" : ""}`}>
        <span className="dash-dot" />
        {live ? "가동 중" : "대기"}
      </div>
    </div>
  );
}
