// LlmSettingsView — 사용하는 LLM 백엔드를 고르는 설정 패널. Claude 클라우드(현행 —
// 역할별 모델 라우팅 유지) vs 로컬(Ollama, 설치된 모델 자동 감지). 여기서 고른 값은
// 전역 기본값으로 디스크에 저장되어 이후 모든 런에 적용된다(런 시작 시 그 런만 다른
// 백엔드로 덮어쓰는 셀렉터는 별도). 다음 런부터 즉시 반영 — 서버 재시작 불필요.
import { useEffect, useState } from "react";
import { fetchLlmStatus, saveLlmSetting, LlmStatus, LlmBackendId } from "../api";
import Ico from "./Ico";

export default function LlmSettingsView() {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [backend, setBackend] = useState<LlmBackendId>("claude");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () =>
    fetchLlmStatus().then((s) => {
      if (!s) return;
      setStatus(s);
      setBackend(s.setting.backend);
      setModel(s.setting.local_model || s.local_models[0] || "");
    });
  useEffect(() => { load(); }, []);

  const localAvail = status?.backends.find((b) => b.id === "local")?.available ?? false;
  const models = status?.local_models ?? [];

  const save = async () => {
    if (backend === "local" && !model.trim()) { alert("로컬 모델명을 입력하세요."); return; }
    setBusy(true);
    const res = await saveLlmSetting(backend, model.trim());
    setBusy(false);
    if (res.ok) {
      if (res.status) setStatus(res.status);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } else {
      alert(`저장 실패: ${res.error || ""}`);
    }
  };

  return (
    <div className="apikeys">
      <div className="apikeys-head">
        <h1><Ico name="sparkle" size={17} /> LLM 백엔드</h1>
        <p className="apikeys-sub">
          에이전트를 구동할 LLM을 고릅니다. <b>다음 런부터 즉시 적용</b>(재시작 불필요)되며,
          선택은 디스크에 저장되어 재시작 후에도 유지됩니다. 런 시작 시 그 런만 다른 백엔드로
          바꾸려면 주제 입력칸 옆 셀렉터를 쓰세요.
        </p>
      </div>

      <div className="apikeys-grid">
        {/* Claude 클라우드 */}
        <label className={`apikey-card llm-card${backend === "claude" ? " sel" : ""}`}>
          <div className="apikey-card-head">
            <span className="apikey-icon"><Ico name="sparkle" size={18} /></span>
            <div className="apikey-titles">
              <b>Claude 클라우드</b>
              <div className="apikey-desc">현행 동작. 역할별 모델 라우팅(편집장=opus·팀원=sonnet) 유지.</div>
            </div>
            <input type="radio" name="llm-backend" checked={backend === "claude"}
              onChange={() => setBackend("claude")} />
          </div>
        </label>

        {/* 로컬 (Ollama) */}
        <label className={`apikey-card llm-card${backend === "local" ? " sel" : ""}`}>
          <div className="apikey-card-head">
            <span className="apikey-icon"><Ico name="setting" size={18} /></span>
            <div className="apikey-titles">
              <b>로컬 (Ollama)</b>
              <div className="apikey-desc">
                {localAvail
                  ? `설치된 모델로 무료 구동 · ${status?.local_base_url}`
                  : "Ollama 미감지 — `ollama serve` 실행 후 새로고침하세요."}
              </div>
            </div>
            <input type="radio" name="llm-backend" checked={backend === "local"}
              onChange={() => setBackend("local")} />
          </div>

          {backend === "local" && (
            <div className="apikey-field">
              <label>로컬 모델</label>
              {models.length > 0 ? (
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  {!models.includes(model) && model && <option value={model}>{model} (미설치)</option>}
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input value={model} placeholder="예: gemma4:12b"
                  onChange={(e) => setModel(e.target.value)} />
              )}
              <div className="apikey-desc" style={{ marginTop: 6 }}>
                ※ 12B급 로컬 모델은 멀티에이전트 풀런 품질이 낮을 수 있습니다(단발·테스트용 권장).
              </div>
            </div>
          )}
        </label>
      </div>

      <div className="apikeys-grid" style={{ marginTop: 4 }}>
        <div className="apikey-card" style={{ background: "transparent", border: "none" }}>
          <div className="apikey-foot">
            {saved && <span className="apikey-ok">✓ 저장됨 — 다음 런부터 적용</span>}
            <button className="btn start" disabled={busy} onClick={save}>
              {busy ? "저장 중…" : "전역 기본값으로 저장"}
            </button>
            <button className="btn" disabled={busy} onClick={load} title="Ollama 모델 목록 새로고침">
              ↻ 새로고침
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
