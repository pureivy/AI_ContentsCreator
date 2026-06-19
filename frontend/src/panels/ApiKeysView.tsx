// ApiKeysView — "API 키 한 곳에서 관리": a card per credential. Built-in keys
// (Anthropic / OpenAI / 법제처) are editable but protected; you can ADD custom keys
// and DELETE them. Values are stored in .env on the server and shown masked.
import { useEffect, useState } from "react";
import { fetchApiKeys, saveApiKey, addApiKey, deleteApiKey, ApiKeyInfo } from "../api";

export default function ApiKeysView() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [nk, setNk] = useState({ key: "", label: "", value: "" });
  const [addBusy, setAddBusy] = useState(false);

  const load = () => fetchApiKeys().then(setKeys);
  useEffect(() => { load(); }, []);

  const save = async (key: string) => {
    const v = (drafts[key] ?? "").trim();
    if (!v) return;
    setBusy(key);
    const res = await saveApiKey(key, v);
    setBusy(null);
    if (res.ok) {
      setDrafts((d) => ({ ...d, [key]: "" }));
      setSaved(key);
      load();
      window.setTimeout(() => setSaved((s) => (s === key ? null : s)), 2500);
    } else {
      alert(`저장 실패: ${res.error || ""}`);
    }
  };

  const addKey = async () => {
    if (!nk.key.trim()) return;
    setAddBusy(true);
    const res = await addApiKey(nk.key.trim(), nk.label.trim(), "", nk.value.trim());
    setAddBusy(false);
    if (res.ok) { setNk({ key: "", label: "", value: "" }); load(); }
    else alert(`추가 실패: ${res.error || ""}`);
  };

  const del = async (key: string) => {
    if (!window.confirm(`'${key}' 키를 삭제할까요? (.env 값도 함께 제거됩니다)`)) return;
    const res = await deleteApiKey(key);
    if (res.ok) load();
    else alert(`삭제 실패: ${res.error || ""}`);
  };

  return (
    <div className="apikeys">
      <div className="apikeys-head">
        <h1>🔑 API 키 한 곳에서 관리</h1>
        <p className="apikeys-sub">
          모든 자격증명을 한 곳에서 입력·저장합니다. 키는 서버의 <code>.env</code>(git 제외)에 저장되며,
          화면에는 항상 <b>마스킹</b>되어 표시됩니다. 기본 키는 편집만, <b>사용자 키는 추가·삭제</b>할 수 있습니다.
        </p>
      </div>
      <div className="apikeys-grid">
        {keys.map((k) => {
          const draft = drafts[k.key] ?? "";
          return (
            <div key={k.key} className="apikey-card">
              <div className="apikey-card-head">
                <span className="apikey-icon">{k.icon}</span>
                <div className="apikey-titles">
                  <b>{k.label}</b>
                  <div className="apikey-desc">{k.desc}</div>
                </div>
                <span className={`apikey-state${k.set ? " on" : ""}`}>{k.set ? "설정됨" : "미설정"}</span>
                {!k.builtin && (
                  <button className="apikey-del" title="이 키 삭제" onClick={() => del(k.key)}>🗑</button>
                )}
              </div>
              <div className="apikey-field">
                <label>
                  {k.key}
                  {k.set && <span className="apikey-cur"> · 현재 {k.masked}</span>}
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={k.set ? "변경하려면 새 값 입력…" : k.placeholder}
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k.key]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && save(k.key)}
                />
              </div>
              <div className="apikey-foot">
                {k.needs_restart && <span className="apikey-note">※ 적용에 서버 재시작 필요</span>}
                {saved === k.key && <span className="apikey-ok">✓ 저장됨</span>}
                <button
                  className="btn start"
                  disabled={busy === k.key || !draft.trim()}
                  onClick={() => save(k.key)}
                >
                  {busy === k.key ? "저장 중…" : "💾 저장"}
                </button>
              </div>
            </div>
          );
        })}

        {/* 사용자 키 추가 */}
        <div className="apikey-card apikey-add">
          <div className="apikey-card-head">
            <span className="apikey-icon">➕</span>
            <div className="apikey-titles">
              <b>API 키 추가</b>
              <div className="apikey-desc">사용자 정의 키 등록. 이름은 대문자로 시작, 대문자/숫자/밑줄만 (예: MY_API_KEY).</div>
            </div>
          </div>
          <div className="apikey-field">
            <label>키 이름</label>
            <input value={nk.key} placeholder="MY_API_KEY" autoComplete="off"
              onChange={(e) => setNk((s) => ({ ...s, key: e.target.value }))} />
          </div>
          <div className="apikey-field">
            <label>표시 이름 (선택)</label>
            <input value={nk.label} placeholder="예: 내 서비스"
              onChange={(e) => setNk((s) => ({ ...s, label: e.target.value }))} />
          </div>
          <div className="apikey-field">
            <label>값 (선택)</label>
            <input type="password" value={nk.value} placeholder="키 값…" autoComplete="off"
              onChange={(e) => setNk((s) => ({ ...s, value: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && addKey()} />
          </div>
          <div className="apikey-foot">
            <button className="btn start" disabled={addBusy || !nk.key.trim()} onClick={addKey}>
              {addBusy ? "추가 중…" : "➕ 추가"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
