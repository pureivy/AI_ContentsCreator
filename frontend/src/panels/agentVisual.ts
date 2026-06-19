// Stable per-agent color + glyph so each name is visually distinct across the
// timeline, the 활동 피드, and the office. Shared (was inline in App.tsx) so every
// renderer maps the same agent_id → the same color/glyph.

export const AGENT_COLORS = [
  "#58a6ff", "#3fb950", "#d29922", "#ff7b72", "#bc8cff", "#39c5cf", "#f0883e", "#e3b341",
];

export function agentColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}

// 사무실 아바타·티커 표시명 — '실명 직책'(예: 장은영 팀장, 박용식 과장). 직책은
// 직무(persona.role, 예 '전략기획팀 전략설계 과장')의 말미 직급어에서 추출. 담당자
// 실명이 없으면(공석) 직무로 폴백. CEO는 'CEO'로 표시.
export function personLabel(name?: string, role?: string): string {
  // CEO는 아바타에 'CEO'로 표시(과거 '경영기획실장' 직책의 리플레이 런도 포함해 호환).
  if (role === "CEO" || role === "ceo" || role === "경영기획실장" || name === "경영기획실장") {
    return "CEO";
  }
  if (name) {
    // 직급어는 직무 말미. 뒤에 괄호 보충(예 '…지출 과장(강소기업지원실·지역산업단)')이 와도
    // 직급을 잡도록 임의 괄호 접미를 허용 — 숫자만 허용하던 (\(\d+\)) 로는 누락됐음.
    const m = (role || "").match(/(팀장|과장|차장|대리|주임|실장)(?:\s*\([^)]*\))?$/);
    return m ? `${name} ${m[1]}` : name;
  }
  return role || "";
}

// 표시명 해석 — 실명직책(장은영 팀장) 우선. persona.name 이 비어 있어도(name 미주입 런·
// 과거 런 리플레이) 로스터 맵(names: id→실명직책)으로 폴백하고, 그것도 없을 때만 직무로.
// 핵심: personLabel(name,role)은 name 이 없으면 role(직무)을 truthy로 반환하므로, name 부재
// 시 직무가 곧장 떠 로스터 폴백을 가려버리던 버그를 막는다(활동·티커·워크플로우 공용).
export function resolveName(
  id: string | null | undefined,
  persona: { name?: string; role?: string } | undefined,
  names?: Record<string, string>,
): string {
  if (persona?.name) return personLabel(persona.name, persona.role);
  if (id && names && names[id]) return names[id];
  return personLabel(persona?.name, persona?.role); // 실명 없음 → 직무/실장/""
}

export function agentGlyph(level: string | undefined, id: string, title: string): string {
  if (level === "ceo") return "👔";
  const k = (id + " " + title).toLowerCase();
  if (/(research|조사|시장|환경)/.test(k)) return "🔎";
  if (/(strategy|전략|기획)/.test(k)) return "🧭";
  if (/(risk|검증|비평|critic)/.test(k)) return "🛡️";
  if (/(legal|법무|규정)/.test(k)) return "⚖️";
  if (/(budget|예산|재무)/.test(k)) return "💰";
  if (/(ops|일정|리소스|운영)/.test(k)) return "🗓️";
  if (level === "lead") return "🧑‍💼";
  return "🧑‍💻";
}
