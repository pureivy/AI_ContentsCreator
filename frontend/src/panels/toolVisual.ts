// 도구 id → 한국어 라벨(아이콘+이름). tool_used 표시·LiveNow·승인에서 공용.
// 백엔드 emit: wiki_query/web_search/save_note/run_command + 커넥터 law_search/dart_search/custom_search.
const TOOL_LABELS: Record<string, string> = {
  wiki_query: "📚 위키 검색",
  wiki_ingest: "📝 위키 기록",
  web_search: "🌐 웹 검색",
  dart: "📊 DART 공시",
  law: "⚖️ 법령 검색",
  custom: "🔌 외부 데이터",
  save_note: "🗒️ 노트 저장",
  run_command: "⌨️ 셸 실행",
};

/** 도구명을 사용자용 라벨로. 커넥터 접미사(_search)·네임스페이스(__)를 정규화, 미지 도구는 raw 폴백. */
export function toolLabel(tool?: string | null): string {
  if (!tool) return "🔧 툴 사용";
  const t = tool.includes("__") ? tool.split("__").pop()! : tool;
  const base = t.replace(/_search$/, ""); // law_search→law, dart_search→dart
  return TOOL_LABELS[t] || TOOL_LABELS[base] || `🔧 ${t}`;
}
