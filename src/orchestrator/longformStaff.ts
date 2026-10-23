/**
 * 롱폼 직원 배선(2026-10-23) — 롱폼 단계마다 맡은 직원의 역할 프롬프트·기억(memory·skills)을 싣고, 오피스 버스가 있으면
 * runAgent 로 돌려 그 직원이 오피스 뷰에서 '작업 중'으로 보이게 한다. 숏폼 callRoleJSON(shorts.ts)과 같은 방식이다.
 *
 * 맡은 사람:
 *  - 주제 묶음(LLM 일관성 한 번) → perf_analyst(이수민)
 *  - 대본·사실 확인에서 걸린 문장 고쳐 쓰기 → longform_writer(한서윤) — 숏폼도 원문 정합 수정은 작가(writerRole)가 한다.
 *  - 썸네일 문구 → image_designer(윤소이)
 *  - 문장 그림(Claude Code 세션) → longform_designer(차민혁) — 세션 지시문에 기억·스킬을 붙이고 묶음마다 activity.log 에 남긴다.
 *  - 완성 장면 검토 → reviewer(정하람)
 *
 * 버스가 없으면(테스트·스크립트) fallback(LlmJSON)으로 — system 앞에 역할 머리말·역할 프롬프트·기억을 붙인다. 운영 fallback 은
 * microJSON, 테스트는 가짜라 돈이 드는 호출이 새로 생기지 않는다. 역할을 못 찾으면(company.yaml 에서 지워짐) 그대로 fallback.
 */
import { getCompany } from '../agents/company-loader';
import { rolesById, type RoleDef } from '../agents/company';
import { personaExtra, readMemory, readSkills } from '../agents/workspace';
import { EventType } from '../events/types';
import type { EventBus } from '../events/bus';
import { kstNowKo } from '../util/time';
import { extractFirstJson, runAgent } from './agent';
import type { LlmJSON } from '../longform/writer';

export const LF_TEAM = 'longform';
export const LF_WRITER = 'longform_writer';
export const LF_DESIGNER = 'longform_designer';

export function staffRole(id: string): RoleDef | undefined {
  try { return rolesById(getCompany()).get(id); } catch { return undefined; }
}

function teamLead(teamId: string | null | undefined): string | undefined {
  if (!teamId) return undefined;
  try { return getCompany().teams?.find((t) => t.id === teamId)?.lead.id; } catch { return undefined; }
}

/** runAgent 의 VERIFIED_NOTE 가 문장 끝에 붙이게 하는 "[근거: …]" 표식 — 낭독·화면 글자로 새지 않게 JSON 추출 전에 지운다. */
export const stripEvidenceTags = (t: string): string => t.replace(/\s*\[근거\s*[:：][^\]]*\]/g, '');

/** 이 버스에서 이미 스폰 이벤트를 낸 직원(같은 런에서 두 번 나타나지 않게). */
const SPAWNED = new WeakMap<EventBus, Set<string>>();
function firstSpawn(bus: EventBus, id: string): boolean {
  let s = SPAWNED.get(bus);
  if (!s) { s = new Set(); SPAWNED.set(bus, s); }
  if (s.has(id)) return false;
  s.add(id);
  return true;
}

/** 스폰 이벤트(runAgent 의 agent_spawned 와 같은 꼴) — runAgent 를 거치지 않는 직원(장면 세션·비전 검토)용. 이미 냈으면 안 낸다. */
export function emitStaffSpawn(bus: EventBus, role: RoleDef, model = ''): void {
  if (!firstSpawn(bus, role.id)) return;
  bus.emit(EventType.agent_spawned, {
    agent_id: role.id,
    persona: { role: role.title, name: role.name, team: role.team, scope: role.specialty, stance: role.stance, is_critic: role.isCritic, level: role.level ?? 'member' },
    model,
  }, { agentId: role.id });
}

/**
 * 오피스 표시 시작 — 롱폼팀은 팀 phase 를 주고, 다른 팀에서 거드는 팀원(이수민·윤소이·정하람)은 그 팀 팀장 → 본인 위임 + 팀 phase 'work'
 * (팀원은 위임 웨이브에 있어야 '작업 중'으로 그려진다 — reducer engaged·OfficeView 팀원 분기). 돌려주는 함수가 끝 표시(다른 팀만 idle).
 */
export function staffOfficeStart(bus: EventBus, role: RoleDef, o: { phase?: 'work' | 'integrate'; summary?: string } = {}): () => void {
  const team = role.team ?? '';
  if (!team) return () => {};
  if (role.level === 'member') {
    const from = team === LF_TEAM ? LF_WRITER : teamLead(team);
    bus.emit(EventType.delegation, { team_id: team, from: from ?? team, to: role.id, summary: o.summary ?? '롱폼 작업' }, { agentId: role.id });
  }
  bus.emit(EventType.phase, { team_id: team, phase: o.phase ?? 'work' });
  return team === LF_TEAM ? () => {} : () => { bus.emit(EventType.phase, { team_id: team, phase: 'idle' }); };
}

/** 끝 표시 — 한 줄 산출물 메시지(아바타가 '작업 완료'로 바뀐다). */
export function staffSay(bus: EventBus, roleId: string, text: string): void {
  bus.emit(EventType.agent_message, { block_id: `lf-${roleId}-${Date.now()}`, text, stage: 'work' }, { agentId: roleId });
}

/** 버스 없는 경로의 system — 역할 머리말·날짜·역할 프롬프트·기억/스킬(personaExtra) 뒤에 호출부의 과제 system(우선 적용). */
export function staffSystem(role: RoleDef, taskSystem: string): string {
  return [`당신은 "${role.name}"(${role.title})입니다.`, `오늘은 ${kstNowKo()} 입니다.`, role.systemPrompt ?? '', personaExtra(role.id), taskSystem]
    .filter(Boolean).join('\n\n');
}

/**
 * 직원 LLM(JSON) — LlmJSON 과 같은 꼴이라 writer·topic 의 llmJSON 자리에 그대로 꽂는다.
 * 버스가 있으면 runAgent(스폰·스트리밍·지표·activity.log 자동), 없으면 fallback 에 역할 system 을 붙여서.
 */
export function staffLlm(roleId: string, o: { bus?: EventBus; fallback: LlmJSON; summary?: string }): LlmJSON {
  return async <T>(model: string, system: string, user: string, opts: { maxOutputTokens?: number; signal?: AbortSignal }): Promise<T | null> => {
    const role = staffRole(roleId);
    if (!role) return o.fallback<T>(model, system, user, opts);
    if (!o.bus) return o.fallback<T>(model, staffSystem(role, system), user, opts);
    const bus = o.bus;
    const end = staffOfficeStart(bus, role, o.summary ? { summary: o.summary } : {});
    try {
      const out = await runAgent({
        // 도구 루프는 끈다(AGENT_TOOL_LOOP 이 켜져 있어도) — 단발 JSON(대본은 1만 토큰대)에 도구 태그·산문이 섞이지 않게.
        bus, role, model, stage: 'work', emitSpawn: firstSpawn(bus, role.id), think: false, toolLoop: false,
        task: `${user}\n\n다른 텍스트 없이 JSON만 출력하라.`, systemExtra: system,
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}), ...(opts.signal ? { signal: opts.signal } : {}),
      });
      return extractFirstJson<T>(stripEvidenceTags(out.text));
    } finally { end(); }
  };
}

/**
 * 장면 세션 지시문에 붙일 디자이너 블록(기억 전문 — personaExtra 의 1,000자 꼬리보다 넉넉히 + 스킬 전문·주입 지식). 비면 ''.
 * 스킬은 전문(2026-10-23) — personaExtra 는 스킬당 600자에서 잘라 판단 규칙 뒷부분(사람 손 금지·비온이 신호)이 세션에 닿지 않았다.
 */
export function designerBrief(id = LF_DESIGNER): string {
  const memory = readMemory(id, 4000).trim();
  const extra = personaExtra(id);
  const cut = extra.indexOf('[과거 학습·교훈(자가학습)]'); // personaExtra 의 맨 끝 블록 — 기억은 아래에 전문으로(꼬리 1,000자 중복 제거)
  const rest = (cut >= 0 ? extra.slice(0, cut) : extra).trim();
  const sk = rest.indexOf('[검증된 작업 패턴(스킬)]'); // 잘린 스킬 블록은 빼고 전문으로 다시
  const head = (sk >= 0 ? rest.slice(0, sk) : rest).trim();
  const skills = readSkills(id, 20_000, 20_000).trim();
  const parts = [
    head,
    skills ? `[검증된 작업 패턴(스킬) — 전문]\n${skills}` : '',
    memory ? `[사장님 검토에서 배운 것 — 반드시 지킨다]\n${memory}` : '',
  ].filter(Boolean);
  return parts.length ? `────────── 롱폼 모션 디자이너(차민혁)의 기억·규칙 ──────────\n${parts.join('\n\n')}` : '';
}
