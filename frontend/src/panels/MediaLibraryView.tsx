import { useEffect, useRef, useState } from "react";
import Ico from "./Ico";

/**
 * 사진·영상 보관소 — 한 번 올려 두고 여러 콘텐츠가 꺼내 쓴다.
 *
 * 컴포저 첨부는 '이 런에만' 쓰인다. 그래서 같은 수국 사진을 수국 편마다 다시 올려야 했다.
 * 여기에 수종을 붙여 두면, 그 수종 콘텐츠가 만들어질 때 자동으로 화면에 들어간다.
 *
 * '사용 현황'(2026-09-08 사용자 결정) — 수종마다 블로그가 나갔는지, 영상이 실제로 화면에 들어갔는지를
 * 한 표로 보고 주제는 사람이 손으로 넣는다. 자율런 선정 로직은 건드리지 않는다.
 * 표는 열 때마다 서버가 현재 파일로 다시 계산하므로 저장 상태가 없다(=실시간).
 */
interface MediaItem {
  id: string; kind: "image" | "video"; name: string; bytes: number;
  seconds?: number; species?: string; tags?: string[]; note?: string; createdTs: string;
}
type Platform = "youtube" | "instagram";
interface ShortsUse { shortId: string; title: string; platform?: Platform; scenes: number[]; exact: boolean; youtubeId?: string; igReelId?: string; ts: string }
interface SpeciesRow {
  species: string; labels: string[]; images: number; videos: number; tags: string[]; firstAddedTs: string;
  blog: { status: "public" | "private" | "ready" | "none"; count: number; latest?: { id: string; title: string; ts: string; url?: string } };
  shorts: ShortsUse[]; lastUsedTs?: string; unused: boolean;
}
interface FileUse { shortId: string; title: string; platform?: Platform; scene: number; youtubeId?: string; igReelId?: string; ts: string }
interface Usage { species: SpeciesRow[]; files: Record<string, FileUse[]>; summary: { species: number; unused: number; blogNone: number; estimatedShorts: number } }

const fmtSize = (b: number): string => (b > 1e6 ? `${(b / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);
const kstDay = (ts?: string): string => (ts ? new Date(Date.parse(ts) + 9 * 3_600_000).toISOString().slice(5, 10) : "-");
const platformLabel = (p?: Platform): string => (p === "youtube" ? "유튜브" : p === "instagram" ? "인스타" : "공용");
/** 편이 어디까지 갔나 — 만들어졌는지가 아니라 올라갔는지가 사장님이 볼 사실이다. */
const published = (u: { youtubeId?: string; igReelId?: string }): string => {
  const out: string[] = [];
  if (u.youtubeId) out.push("유튜브 게시");
  if (u.igReelId) out.push("인스타 게시");
  return out.length ? out.join("·") : "미게시";
};
const BLOG_LABEL: Record<SpeciesRow["blog"]["status"], string> = { public: "공개", private: "비공개 발행", ready: "검토 대기", none: "없음" };

export default function MediaLibraryView() {
  const [mode, setMode] = useState<"files" | "usage">("files");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageErr, setUsageErr] = useState("");
  const [onlyUnused, setOnlyUnused] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [species, setSpecies] = useState("");
  const [tags, setTags] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const r = await fetch("/media");
      const j = (await r.json()) as { media?: MediaItem[] };
      setItems(j.media ?? []);
    } catch { /* 목록 실패는 빈 화면으로 — 업로드는 계속 가능 */ }
  };
  const loadUsage = async () => {
    setUsageErr("");
    try {
      const r = await fetch("/media/usage");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setUsage((await r.json()) as Usage);
    } catch (e) { setUsageErr(`사용 현황을 불러오지 못했습니다 — ${(e as Error).message}`); }
  };
  useEffect(() => { void load(); }, []);
  // 표는 열 때마다 새로 받는다 — 서버가 요청 시점의 파일로 계산하므로 캐시가 없어야 실시간이다.
  useEffect(() => { if (mode === "usage") void loadUsage(); }, [mode]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      // 올릴 때 수종을 붙이는 게 핵심 — 안 붙이면 범용 소재라 아무 편에나 쓰인다.
      if (species.trim()) fd.append("species", species.trim());
      if (tags.trim()) fd.append("tags", tags.trim());
      const r = await fetch("/media", { method: "POST", body: fd });
      const j = (await r.json()) as { error?: string; skipped?: Array<{ file: string; reason: string }> };
      if (j.error) window.alert(j.error);
      else if (j.skipped?.length) window.alert(`일부 제외:\n${j.skipped.map((s) => `· ${s.file} — ${s.reason}`).join("\n")}`);
      await load();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/media/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await load();
  };
  const remove = async (m: MediaItem) => {
    if (!window.confirm(`"${m.name}" 을(를) 보관소에서 지울까요? 파일도 함께 삭제됩니다.`)) return;
    await fetch(`/media/${m.id}`, { method: "DELETE" });
    await load();
  };
  /** 사무실 컴포저에 수종을 채워 넘긴다 — 주제는 사장님이 이어 적는다(수동 입력 한 번 클릭). */
  const writeAbout = (sp: string) => {
    window.location.assign(`/?topic=${encodeURIComponent(`${sp} `)}`);
  };
  const toggle = (sp: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(sp)) n.delete(sp); else n.add(sp); return n; });

  const rows = usage ? usage.species.filter((r) => !onlyUnused || r.unused) : [];
  const filesOf = (sp: string, labels: string[]): MediaItem[] => items.filter((m) => m.species && (m.species === sp || labels.includes(m.species)));

  return (
    <div className="media-lib">
      <div className="media-head">
        <div>
          <h2>
            사진·영상 보관소{" "}
            <button type="button" className={`btn ghost review-viewtab${mode === "files" ? " on" : ""}`} onClick={() => setMode("files")}><Ico name="cards" size={12} /> 소재</button>
            <button type="button" className={`btn ghost review-viewtab${mode === "usage" ? " on" : ""}`} onClick={() => setMode("usage")}><Ico name="chart" size={12} /> 사용 현황</button>
          </h2>
          {mode === "files"
            ? <p>올릴 때 수종을 붙여 두면, 그 수종 콘텐츠를 만들 때 자동으로 화면에 들어갑니다. 수종을 비우면 어떤 주제에나 쓰이는 범용 소재가 됩니다.</p>
            : <p>수종마다 블로그가 나갔는지와 영상이 실제로 화면에 들어갔는지를 따로 봅니다. 열 때마다 지금 파일로 다시 계산합니다. 주제는 여기서 고르고 직접 넣으세요.</p>}
        </div>
        {mode === "files" ? (
          <div className="media-upload">
            <input value={species} onChange={(e) => setSpecies(e.target.value)} placeholder="수종 (예: 수국)" />
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="태그 쉼표로 (가을, 열매)" />
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Ico name="plus" size={12} /> {busy ? "올리는 중…" : "사진·영상 올리기"}
            </button>
            <input ref={fileRef} type="file" multiple hidden
              accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
              onChange={(e) => void upload(e.target.files)} />
          </div>
        ) : (
          <div className="media-upload">
            <label className="media-usage-filter">
              <input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} /> 영상 미사용만
            </label>
            <button type="button" onClick={() => void loadUsage()}>새로 계산</button>
          </div>
        )}
      </div>

      {mode === "usage" ? (
        usageErr ? <p className="media-empty">{usageErr}</p>
        : !usage ? <p className="media-empty">계산 중…</p>
        : (
          <>
            <p className="media-usage-sum">
              수종 {usage.summary.species} · 영상 미사용 {usage.summary.unused} · 블로그 없음 {usage.summary.blogNone}
              {usage.summary.estimatedShorts ? ` · 추정 ${usage.summary.estimatedShorts}편(파일 기록 이전 편 — 어느 파일인지는 모름)` : ""}
            </p>
            <div className="perf-table-wrap">
              <table className="perf-table media-usage">
                <thead>
                  <tr>
                    <th>수종</th><th>사진/영상</th><th>태그</th><th>블로그</th><th>최근 글</th><th>실촬영 쓴 편</th><th>마지막 사용</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="media-usage-none">{onlyUnused ? "영상이 안 쓰인 수종이 없습니다." : "수종 딱지가 붙은 소재가 없습니다."}</td></tr>
                  )}
                  {rows.map((r) => {
                    const isOpen = open.has(r.species);
                    return [
                      <tr key={r.species} className={r.unused ? "media-usage-unused" : ""}>
                        <td>
                          <button type="button" className="media-usage-toggle" onClick={() => toggle(r.species)} title="파일별로 보기">
                            {isOpen ? "▾" : "▸"} <b>{r.species}</b>
                          </button>
                          {r.labels.length ? <span className="media-sub"> ({r.labels.join("·")})</span> : null}
                        </td>
                        <td>{r.images}/{r.videos}</td>
                        <td>{r.tags.join("·") || "-"}</td>
                        <td>
                          <span className={`chip media-usage-blog-${r.blog.status}`}>{BLOG_LABEL[r.blog.status]}{r.blog.status === "public" ? ` ${r.blog.count}편` : ""}</span>
                        </td>
                        <td className="media-usage-title">
                          {r.blog.latest
                            ? (r.blog.latest.url ? <a href={r.blog.latest.url} target="_blank" rel="noreferrer">{r.blog.latest.title}</a> : r.blog.latest.title)
                            : "-"}
                          {r.blog.latest ? <span className="media-sub"> {kstDay(r.blog.latest.ts)}</span> : null}
                        </td>
                        <td>
                          {r.shorts.length === 0 ? <span className="chip media-usage-blog-none">없음</span> : (
                            <span className="media-usage-shorts">
                              {r.shorts.map((u) => (
                                <span key={u.shortId} className="chip" title={u.title}>
                                  {platformLabel(u.platform)} · {published(u)}{u.exact ? (u.scenes.length ? ` · 씬 ${u.scenes.join(",")}` : "") : " · 추정"}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td>{kstDay(r.lastUsedTs)}</td>
                        <td><button type="button" className="btn ghost" onClick={() => writeAbout(r.species)} title="사무실 입력창에 이 수종을 채워 넣습니다"><Ico name="pencil" size={11} /> 글 만들기</button></td>
                      </tr>,
                      isOpen ? (
                        <tr key={`${r.species}-files`} className="media-usage-files">
                          <td colSpan={8}>
                            {filesOf(r.species, r.labels).length === 0 ? <span className="media-sub">파일 없음</span> : (
                              <ul>
                                {filesOf(r.species, r.labels).map((m) => {
                                  const uses = usage.files[m.id] ?? [];
                                  return (
                                    <li key={m.id}>
                                      <span className="media-usage-file">{m.kind === "video" ? `영상 ${m.seconds ? `${m.seconds.toFixed(1)}초` : ""}` : "사진"} · {m.name} · {fmtSize(m.bytes)} · {kstDay(m.createdTs)} 등록</span>
                                      {uses.length === 0
                                        ? <span className="media-sub"> — {m.kind === "video" ? "화면에 안 들어감(기록 기준)" : "사진은 스타일 참고용이라 사용 기록 없음"}</span>
                                        : uses.map((u) => <span key={`${u.shortId}-${u.scene}`} className="chip" title={u.title}>{platformLabel(u.platform)} 씬 {u.scene} · {published(u)} · {kstDay(u.ts)}</span>)}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : items.length === 0 ? (
        <p className="media-empty">아직 보관된 소재가 없습니다. 직접 찍은 사진·영상을 올려 두면 생성 이미지 대신 화면에 씁니다.</p>
      ) : (
        <div className="media-grid">
          {items.map((m) => (
            <div key={m.id} className="media-card">
              <div className="media-thumb">
                {m.kind === "image"
                  ? <img src={`/media/file/${m.id}`} alt={m.name} loading="lazy" />
                  : <video src={`/media/file/${m.id}`} muted preload="metadata" />}
                <span className="media-kind">{m.kind === "video" ? `영상 ${m.seconds ? `${m.seconds.toFixed(1)}초` : ""}` : "사진"}</span>
              </div>
              <div className="media-meta">
                <span className="media-name" title={m.name}>{m.name}</span>
                <span className="media-sub">{fmtSize(m.bytes)}</span>
                <input className="media-species" defaultValue={m.species ?? ""} placeholder="수종"
                  onBlur={(e) => { if (e.target.value !== (m.species ?? "")) void patch(m.id, { species: e.target.value }); }} />
                <input className="media-tags" defaultValue={(m.tags ?? []).join(", ")} placeholder="태그"
                  onBlur={(e) => {
                    const next = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
                    if (next.join(",") !== (m.tags ?? []).join(",")) void patch(m.id, { tags: next });
                  }} />
                <button type="button" className="media-del" onClick={() => void remove(m)}>삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
