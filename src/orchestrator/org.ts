/**
 * Org 모드 런 엔진 — CEO → 팀 → 팀원 위계(GEPA org 모드 패리티).
 *
 * 흐름: CEO 분해 → 대기 → 각 팀(team_parallel 병렬) { 팀장 분해 → 배정 → 팀원 작업(concurrency 직렬)
 *       → 팀장 종합 } → CEO 통합. 위계가 안무에 그대로 보이도록 phase 를 단계별로 emit 한다.
 * 이벤트: phase·team_spawned·delegation·team_deliverable 로 오피스 안무를 구동.
 */
import { CONFIG } from '../config';
import { modelForTier } from '../llm/models';
import type { EventBus } from '../events/bus';
import { DEFAULT_COMPANY } from '../agents/company';
import type { TeamDef } from '../agents/company';
import { mapLimit } from '../util/semaphore';
import { isAbort } from '../util/abort';
import { asString } from '../util/str';
import { runAgent, microJSON, buildSystemPrompt, findTemplateNumbers } from './agent';
import { prepareRun } from './prepare';
import { finalizeRun } from './finalize';
import { llmWiki } from '../wiki/llmwiki';
import { getRunSettings } from '../runsettings';
import type { RunOptions, RunOutcome } from './run';

interface TeamResult {
  team: TeamDef;
  deliverable: string;
  /** 자가학습(reflect) roster 매칭용 — 팀 id 가 아니라 실제 참여 역할(팀원+팀장) 단위 산출물. */
  participants: Array<{ id: string; name: string; text: string }>;
}

// 최종 산출물 합성 단계용 '문서 저자' 시스템 프롬프트 — CEO 기본 역할(의사결정자+「경영평가편람」 1차기준+
// "결정/사유/조건" 형식 강제)이 결재 메모와 경영평가 과편향을 유발하므로, 합성 때만 이 저자 프롬프트로 교체한다.
export const SYNTH_AUTHOR_PROMPT =
  '당신은 (재)경상북도경제진흥원의 최종 산출물 작성 책임자입니다. 두 팀(전략기획·경영지원)의 산출물을 통합해, ' +
  '요청된 문서 유형에 충실한 완결된 최종 문서를 직접 작성합니다.\n' +
  '원칙:\n' +
  '1) "결정/사유/조건" 같은 결재·검토 메모가 아니라, 그대로 제출 가능한 완성 문서를 쓴다.\n' +
  '2) 문서 유형의 표준 구성·범위를 엄수한다. 결산보고서는 재무 결산(세입·세출 집행·예산 대비 집행·재무제표·기금/잉여금·재정건전성·내부통제) 중심이며, 사업 성과/효과 분석은 결산 범위 밖이라 넣지 않는다(사업별은 예산 집행 내역·수치만).\n' +
  '2-1) [예산≠결산] 결산 수치는 결산·집행 자료(감사보고서 재무제표·운영성과표, 세출예산집행현황, 결산서)에서만 인용한다. "주요업무보고"·"예산안"·"추가경정"의 편성예산(본예산·추경 합계 등)을 결산액(집행 실적)으로 쓰지 마라 — 이는 예산이지 결산이 아니다. 결산 자료에 해당 수치가 없으면 "⚠️ 데이터 없음(결산 확정자료 필요)"으로 표기한다.\n' +
  '2-2) [합계 정합] 구성요소(재원별·항목별)를 나열하면 그 합이 명시한 총계와 일치해야 한다. 인용 전 검산하고, 합이 안 맞으면 수치를 다시 확인하거나 "검증 필요"로 표기한다.\n' +
  '3) 주제와 무관한 프레임(「경영평가편람」·KPI·전략과제 등)을 억지로 끌어들이지 않는다 — 주제가 그것을 요구할 때만 사용한다.\n' +
  '4) 팀 산출물의 실제 수치·근거·표를 압축·요약하지 말고 보존·통합·확장한다. 인용 수치엔 [근거: 자료]를 붙이고, 빠진 값은 "⚠️ 데이터 없음: <항목>"으로 표기한다(0·임의값 금지).\n' +
  '5) 개조식으로 작성한다 — 서술형 산문은 금지(명사형·음슴체 종결)하되, 각 말단 항목은 "단어·구의 나열"이 ' +
  '아니라 근거·수치·메커니즘·기준·효과를 담은 "완결된 실질 항목"으로 쓴다(필요하면 1~3줄). 빈 명사구만 나열하지 마라.\n' +
  '6) 글의 계층을 글머리 기호로 드러낸다: □(대항목) → ○(중항목) → -(소항목) → ·(세부), 또는 1./가./1)/(1) 체계. 깊이에 맞춰 일관되게 사용한다.\n' +
  '7) 분량은 섹션을 늘려서가 아니라 각 항목을 실데이터·수치로 깊이 있게 세분해 확보한다 — 각 ○(중항목)은 ' +
  '최소 3개 이상의 실질 - 항목으로 전개하고, 핵심 수치는 표(헤더+데이터행)로 제시한다. 패딩·동어반복 금지.';

export async function runOrg(bus: EventBus, opts: RunOptions): Promise<RunOutcome> {
  const company = opts.company ?? DEFAULT_COMPANY;
  const { topic, signal } = opts;
  const allTeams = company.teams ?? [];

  bus.emit('phase', { team_id: '_ceo', phase: 'delegate' }); // CEO 의사결정·지침 수립 단계(🧩)
  const prep = await prepareRun(bus, topic, company, signal);
  if (!prep) throw new Error('no local models');
  const { assign, subproblems } = prep;
  const subContext = subproblems.map((s) => `- (${s.id}) ${s.text}`).join('\n');

  // ① CEO 라우팅 — '지침 수립'(하향식 지시문)을 하지 않고, 목표를 업무분장에 맞는 부서에 분배한다(이슈1).
  //    각 관련 부서에 그 부서가 맡을 구체적 작업을 배정하고, 최종 산출물 수용 기준(검토 준거)만 간단히 남긴다.
  //    무거운 지침 작성(스트리밍) 대신 microJSON 1회 — CEO 가 '결정'하지 '문서를 쓰지' 않는다.
  const route = await microJSON<{
    assignments?: Array<{ team?: string; task?: string }>;
    acceptance?: string;
  }>(
    assign.micro,
    '너는 CEO다. 목표를 직접 지시문으로 쓰지 말고, 각 부서의 주력업무(업무분장)에 맞춰 목표의 어느 부분을 어느 부서가 맡을지 분배하라. 부서 간 담당 범위가 서로 겹치지 않게 명확히 분리하고, 각 부서 작업에 그 부서만의 책임 범위를 구체적으로 명시하라. 직책명 통념이 아니라 업무분장으로 목표와 대조하라. 목표와 무관한 부서는 제외하라.',
    `목표: ${topic}\n\n하위 문제:\n${subContext}\n\n부서 목록(id | 부서명 | 주력업무):\n${allTeams.map((t) => `- ${t.id} | ${t.name} | ${t.lead.specialty ?? t.lead.title}`).join('\n')}\n\n각 관련 부서에 맡길 구체적 작업과, 최종 산출물이 갖춰야 할 핵심 요건(수용 기준, 2~3줄)을 정하라.\n\n형식: {"assignments":[{"team":"<부서 id>","task":"<이 부서가 맡을 작업>"}],"acceptance":"<수용 기준>"}`,
    { maxOutputTokens: 700, signal },
  );

  // ② 라우팅 결과 → 팀별 담당 작업 맵 + 관련 부서 선별(유효 id·중복 제거·원래 순서 보존).
  const teamTaskById = new Map<string, string>();
  for (const a of route?.assignments ?? []) {
    const tid = asString(a?.team).trim();
    const tk = asString(a?.task).trim();
    if (tid && tk && allTeams.some((t) => t.id === tid) && !teamTaskById.has(tid)) teamTaskById.set(tid, tk);
  }
  const routed = allTeams.filter((t) => teamTaskById.has(t.id));
  // path='team' → 가장 적합한 1팀(라우팅 첫 팀). full/org → 라우팅된 팀들. 라우팅 실패 시 전체 폴백.
  let teams = routed.length ? routed : allTeams;
  if (opts.path === 'team') teams = teams.slice(0, 1);
  bus.emit('log', { message: `CEO 라우팅 — ${teams.length}개 부서로 분배: ${teams.map((t) => t.name).join(', ')}` });

  // CEO 라우팅 완료 → 부서 작업 동안은 '대기'.
  bus.emit('phase', { team_id: '_ceo', phase: 'idle' });
  // 무거운 지침 대신 '수용 기준'만 컨텍스트로 — 작성 기준이자 마지막 CEO 검토의 준거(라우팅 실패 시 빈 값).
  const acceptance = asString(route?.acceptance).trim(); // LLM 라우팅 acceptance 가 비문자열이어도 안전(?? 만으론 throw)
  const acceptanceBlock = acceptance ? `[최종 산출물 수용 기준]\n${acceptance}` : '';

  // --- 팀별 실행(team_parallel 병렬) ---
  const teamResults = await mapLimit(
    CONFIG.teamParallel,
    teams.map((team) => async (): Promise<TeamResult> => {
      bus.emit('team_spawned', {
        team_id: team.id, name: team.name, lead: team.lead.id, members: team.members.map((m) => m.id),
      });
      bus.emit('delegation', { team_id: team.id, from: company.ceo.id, to: team.id, summary: `${team.name}에 위임` });

      // 팀원은 로컬 속도 위해 MAX_SPECIALISTS 로 캡(로스터 표시는 전체 — 런만 서브셋).
      const members = team.members.slice(0, CONFIG.maxSpecialists);

      // CEO 라우팅이 이 부서에 배정한 담당 작업(없으면 전체 목표 폴백). 각 팀이 서로 다른 부분을 맡는다(이슈1).
      const teamTask = teamTaskById.get(team.id) ?? topic;
      const teamRoleBlock = `[당신 부서 담당] ${team.name}(${team.lead.specialty ?? team.lead.title}) — CEO가 배정한 작업: ${teamTask}\n타 부서 영역은 해당 부서가 담당하니 중복하지 말 것.`;

      let deliverable: string;
      if (members.length === 0) {
        // 팀원이 없으면 팀장이 직접 작업(분해할 대상이 없음).
        bus.emit('phase', { team_id: team.id, phase: 'work' });
        const solo = await runAgent({
          bus, role: team.lead, model: modelForTier(assign, team.lead.tier),
          task: `목표: ${topic}\n\n${acceptanceBlock}\n\n${teamRoleBlock}\n\n[팀: ${team.name}] 수용 기준을 준수해 최종 산출물(문서)을 작성하라.`,
          stage: 'work', emitSpawn: true, groundQuery: topic, signal,
        });
        deliverable = solo.text;
        bus.emit('team_deliverable', { team_id: team.id, text: deliverable });
        bus.emit('phase', { team_id: team.id, phase: 'idle' }); // 팀 완료 → 팀장 '취합중' latch 해제(F3)
        return { team, deliverable, participants: [{ id: team.lead.id, name: team.lead.name, text: solo.text }] };
      }

      // 위계: 팀장이 ① 팀 과제를 팀원 작업으로 분해 → ② 배정 → 팀원이 ③ 작업 → 팀장이 ④ 종합.
      // 팀장 아바타가 'placeholder' 면 분해 단계에 배회(freeIds)하므로 먼저 스폰해 자리를 고정.
      bus.emit('agent_spawned', {
        agent_id: team.lead.id,
        persona: {
          role: team.lead.title, name: team.lead.name, team: team.lead.team,
          scope: team.lead.specialty, stance: team.lead.stance,
          is_critic: team.lead.isCritic, level: team.lead.level ?? 'lead',
        },
        model: modelForTier(assign, team.lead.tier),
      }, { agentId: team.lead.id });

      // ① 팀장 분해+배정(decompose phase → engaged 리셋). micro 모델로 빠르게 — 실제 호출이라
      //    분해 단계가 벽시계 시간만큼 '🧩 분해 중'으로 보인다(즉시 work로 넘어가던 버그 차단).
      //    분해를 microJSON 1회로 통합: 인덱스 기계배정이 아니라 팀원 업무분장(주력업무)에 맞춰
      //    작업을 직접 짝지어 받는다(추가 호출 없음 — 기존 분해 호출을 JSON 출력으로 바꾼 것).
      bus.emit('phase', { team_id: team.id, phase: 'decompose' });
      const memberRoster = members.map((m) => `${m.id} | ${m.title} | ${m.specialty ?? m.title}`).join('\n');
      let plan: { assignments?: Array<{ member?: string; task?: string }> } | null = null;
      try {
        plan = await microJSON<{ assignments?: Array<{ member?: string; task?: string }> }>(
          assign.micro,
          buildSystemPrompt(
            team.lead,
            // classify 사서 패턴: 직책명 통념이 아니라 주력업무(업무분장)로 작업과 팀원을 대조한다.
            `팀원 명단(id | 직책 | 주력업무):\n${memberRoster}\n\n` +
              '핵심 작업을 팀원 수만큼 도출하되 작업끼리 범위가 겹치지 않게 서로 다른 부분으로 명확히 분리하고, 각 작업을 직책명 통념이 아니라 주력업무(업무분장)로 대조해 가장 적합한 팀원 1명씩에게 배정하라. 한 작업은 정확히 한 명에게만 간다.',
          ),
          `목표: ${topic}\n\n${acceptanceBlock}\n\n${teamRoleBlock}\n\n[팀: ${team.name}] 위 수용 기준에 따라 최종 산출물을 만들기 위해, 팀원 ${members.length}명이 나눠 작성할 핵심 작업 ${members.length}가지로 분해하고 각 작업을 본인 주력업무에 가장 적합한 팀원에게 배정하라. 군더더기 없이.\n\n형식: {"assignments":[{"member":"<id>","task":"<핵심 작업>"}]}`,
          { maxOutputTokens: 512, signal },
        );
      } catch (e) {
        if (isAbort(e, signal)) throw e;
      }

      // ② 팀원 배정(assign phase) — 업무분장 매칭 '우선', 미배정 작업을 순서대로 폴백 배분.
      //    각 작업은 정확히 한 팀원에게만 간다: id 매칭에 소비된 작업 인덱스를 consumed 로 추적하고,
      //    미매칭 팀원은 '남은(미소비) 작업 큐'에서만 가져오므로 중복 배정/동일텍스트 누락이 없다.
      //    JSON 실패/빈 배열/누락/잘못된 id/중복 id 를 모두 견고하게 처리(끝까지 비면 '직책 전문 분석').
      const rawAssignments = Array.isArray(plan?.assignments) ? plan!.assignments! : [];
      // 비어있지 않은 작업만, LLM 출력 순서 보존 — 인덱스로 식별해 동일 텍스트도 별개 작업으로 구분.
      const tasks = rawAssignments
        .map((a) => ({ id: asString(a?.member).trim(), task: asString(a?.task).trim() }))
        .filter((a) => a.task);
      // member.id → 작업 인덱스(중복 id 는 첫 매칭만). 매칭에 소비된 인덱스를 consumed 에.
      const idToIdx = new Map<string, number>();
      tasks.forEach((a, i) => {
        if (a.id && members.some((m) => m.id === a.id) && !idToIdx.has(a.id)) idToIdx.set(a.id, i);
      });
      const consumed = new Set<number>(idToIdx.values());
      // 미배정 작업 큐 — 미매칭 팀원이 원래 순서대로 하나씩 소비. (a) 이미 매칭에 쓰인 작업과
      // (b) '유효 팀원에게 명시됐으나 그 팀원이 이미 매칭된' 중복 지정 작업은 제외해, 같은 작업이
      // 두 팀원에게 중복 배정되는 것을 막는다(member 미지정·무효 id 작업만 재분배 대상).
      const remaining = tasks
        .map((_, i) => i)
        .filter((i) => !consumed.has(i) && !(tasks[i]!.id && members.some((m) => m.id === tasks[i]!.id)));
      let rp = 0;
      const memberTasks = members.map((m) => {
        const idx = idToIdx.get(m.id);          // 1순위: 업무분장 매칭
        let picked: { id: string; task: string } | undefined;
        if (idx !== undefined) picked = tasks[idx];
        else {                                  // 2순위: 미배정 나머지에서 순서대로(중복 없음)
          const ri = remaining[rp++];
          if (ri !== undefined) picked = tasks[ri];
        }
        return (picked?.task ?? `${m.title} 전문 분석`).slice(0, 60);  // 최후: 직책 기본
      });
      bus.emit('phase', { team_id: team.id, phase: 'assign' });
      members.forEach((m, i) => {
        bus.emit('delegation', { team_id: team.id, from: team.lead.id, to: m.id, summary: memberTasks[i] });
      });
      // assign 비트가 work에 붕괴되지 않게 짧게 가시화(reducer가 phases[tid]='assign'을 한 번 관측).
      await new Promise((r) => setTimeout(r, 1000));

      // ③ 팀원 작업(concurrency 직렬). 분해+배정 결과를 작업 지침으로 전달(planBlock = 누가 무엇).
      bus.emit('phase', { team_id: team.id, phase: 'work' });
      const planText = members.map((m, i) => `- (${m.name}) ${memberTasks[i]}`).join('\n');
      const planBlock = tasks.length ? `팀장 작업 분해(누가 무엇):\n${planText}` : `하위 문제:\n${subContext}`;

      const memberOutputs = await mapLimit(
        CONFIG.concurrency,
        members.map((role, i) => async () => {
          // 각 팀원에게 '당신의 담당 작업'을 명시적으로 지정 — 전원이 같은 분해 목록을 보더라도 자기 임무를
          // 명확히 구분하고 동료 담당은 중복하지 않게 한다(작은 모델이 self-identify 못 해 겹치던 문제 방지).
          const myTask = tasks.length ? memberTasks[i] : '위 하위 문제 중 본인 주력업무에 해당하는 부분';
          const memberTask = `목표: ${topic}\n\n${acceptanceBlock}\n\n${teamRoleBlock}\n\n${planBlock}\n\n` +
            `[팀: ${team.name}] 당신은 "${role.name}"(${role.title})입니다.\n` +
            `▶ 당신의 담당 작업(이것만 작성): ${myTask}\n` +
            `- 위 담당 작업에만 집중하라. 분해 목록의 다른 팀원 담당 항목은 그들이 작성하니 중복 작성하지 마라.\n` +
            `- 수용 기준을 준수해 최종 산출물에 들어갈 '당신 담당 부분'을 구체적으로 작성하라.`;
          try {
            const out = await runAgent({
              bus, role, model: modelForTier(assign, role.tier),
              // 검색 질의 = 주제 + 이 팀원의 담당 작업 — topic 전체만으로는 전원이 같은 4페이지를 받아
              // 얕았다(이슈12). 담당 작업을 더해 각자 자기 부분의 실제 자료를 끌어오게 한다(F8a).
              task: memberTask, stage: 'work', emitSpawn: true, groundQuery: `${topic} ${memberTasks[i]}`,
              subproblemId: memberTasks[i], fallbackModel: assign.heavy, signal,
            });
            return { role, text: out.text };
          } catch (e) {
            if (isAbort(e, signal)) throw e;
            bus.emit('agent_failed', { agent_id: role.id, error: e instanceof Error ? e.message : String(e), isolated: true }, { agentId: role.id });
            return { role, text: '' };
          }
        }),
      );

      // ④ 팀장이 팀원 산출물을 종합해 '부서 최종 산출물(문서)'을 작성(report phase). 검토·취합.
      bus.emit('phase', { team_id: team.id, phase: 'report' });
      const combined = memberOutputs.map((o) => `## ${o.role.name}\n${o.text}`).join('\n\n');
      const led = await runAgent({
        bus, role: team.lead, model: modelForTier(assign, team.lead.tier),
        task: `[${team.name}] 팀원 산출물을 종합해, 수용 기준을 준수하는 우리 부서의 최종 산출물(완성된 문서)을 작성하라.`,
        context: [acceptanceBlock, teamRoleBlock, `[팀원 산출물]\n${combined}`].filter(Boolean).join('\n\n'),
        stage: 'work', fallbackModel: assign.heavy, signal,
      });
      deliverable = led.text;
      bus.emit('team_deliverable', { team_id: team.id, text: deliverable });
      bus.emit('phase', { team_id: team.id, phase: 'idle' }); // 팀 완료 → 팀장 '취합중' latch 해제(F3)
      // 자가학습(reflect) roster 는 개별 역할 id 로 매칭하므로, 팀 단위가 아니라 팀원 개별 산출물 + 팀장 종합을 전달한다.
      const participants = [
        ...memberOutputs.filter((o) => o.text.trim()).map((o) => ({ id: o.role.id, name: o.role.name, text: o.text })),
        { id: team.lead.id, name: team.lead.name, text: led.text },
      ];
      return { team, deliverable, participants };
    }),
  );

  // 빈 팀 산출물 제외 — 통합·다이제스트 오염 방지.
  const usableTeams = teamResults.filter((t) => t.deliverable.trim());
  if (usableTeams.length === 0) {
    bus.emit('error', { message: '모든 팀이 빈 산출물 — 통합할 내용이 없습니다.' });
    bus.emit('run_done', { status: 'error' });
    return { deliverable: '', modelAssignment: assign };
  }

  // --- 팀 토론(옵트인: ORG_DEBATE_ROUNDS>0) — 팀 위계를 유지한 채 산출물을 비평→반박으로 정련한다.
  //     비평가가 전 팀 산출물의 교차 약점(모순·중복·누락·약한 근거)을 지적하면, 각 팀장이 비평+동료 팀
  //     산출물을 반영해 자기 산출물을 갱신(rebuttal)한다. 기본 0 이면 건너뛰어 기존 동작과 동일(회귀 0). ---
  const debateCritic = company.specialists.find((s) => s.isCritic);
  const debateRounds = getRunSettings().orgDebateRounds; // UI 토글(런타임) 우선 — 미설정이면 env 기본
  if (debateRounds > 0 && debateCritic) {
    bus.emit('log', { message: `팀 토론 ${debateRounds}라운드 — 비평→반박으로 팀 산출물 정련` });
  }
  for (let round = 1; round <= debateRounds && debateCritic && !signal?.aborted; round++) {
    bus.emit('phase', { team_id: '_ceo', phase: 'review' });
    // 1) 비평 — 전 팀 산출물의 교차 약점을 팀별로 지적
    const combined = usableTeams.map((t) => `## ${t.team.name}\n${t.deliverable}`).join('\n\n');
    const crit = await runAgent({
      bus, role: debateCritic, model: modelForTier(assign, debateCritic.tier),
      task: `라운드 ${round}: 각 팀 산출물을 비판적으로 검토하라. 팀 간 모순·중복·누락·약한 근거를 구체적으로 지적하고, 어느 팀이 무엇을 어떻게 보완해야 하는지 팀별로 명시하라.`,
      context: combined, stage: 'critique', emitSpawn: round === 1, signal,
    });
    bus.emit('critique', { round, text: crit.text }, { agentId: debateCritic.id });
    if (signal?.aborted) break;
    // 2) 반박/정련 — 각 팀장이 비평 + 동료 팀 산출물을 반영해 자기 산출물을 갱신(팀 단위 병렬)
    const revised = await mapLimit(
      CONFIG.teamParallel,
      usableTeams.map((t) => async (): Promise<TeamResult> => {
        try {
          bus.emit('phase', { team_id: t.team.id, phase: 'work' });
          const peers = usableTeams.filter((o) => o.team.id !== t.team.id)
            .map((o) => `## ${o.team.name} 산출물\n${o.deliverable}`).join('\n\n');
          const out = await runAgent({
            bus, role: t.team.lead, model: modelForTier(assign, t.team.lead.tier),
            task: `라운드 ${round} 반박: 아래 [비평]과 [동료 팀 산출물]을 반영해 '${t.team.name}'의 산출물을 보완·갱신하라.\n` +
              `- 지적된 약점·모순을 해소하고, 동료 팀과 중복되는 부분은 줄이며, 누락은 채워라.\n` +
              `- 기존의 실수치·근거([근거: ...])는 보존·강화하되 지어내지 마라(없으면 "⚠️ 데이터 없음").\n` +
              `- 차이만 쓰지 말고 갱신된 완성 산출물 전체를 출력하라.`,
            context: [`[비평]\n${crit.text}`, peers ? `[동료 팀 산출물]\n${peers}` : '', `[현재 ${t.team.name} 산출물]\n${t.deliverable}`].filter(Boolean).join('\n\n'),
            stage: 'rebuttal', signal,
          });
          const next = out.text.trim() || t.deliverable;
          if (next !== t.deliverable) bus.emit('team_deliverable', { team_id: t.team.id, text: next });
          bus.emit('phase', { team_id: t.team.id, phase: 'idle' });
          return { ...t, deliverable: next };
        } catch (e) {
          if (isAbort(e, signal)) throw e;
          return t; // 반박 실패 팀은 기존 산출물 유지
        }
      }),
    );
    for (let i = 0; i < usableTeams.length; i++) if (revised[i]) usableTeams[i] = revised[i]!;
  }

  // --- 회사급 비평(선택) — 토론 여부와 무관하게 **최종(반박 후) 산출물**을 신선하게 비평해 합성 입력으로
  //     쓴다. 토론 라운드 비평은 그 라운드의 '반박 전' 상태를 가리켜 합성엔 stale 하므로 여기서 재비평한다.
  //     (라운드 critic 은 반박을 구동하고, 이 회사급 critic 은 합성용 최종 비평 — 역할이 다르다.) ---
  const critic = company.specialists.find((s) => s.isCritic);
  let critiqueText = '';
  if (critic) {
    const combined = usableTeams.map((t) => `## ${t.team.name}\n${t.deliverable}`).join('\n\n');
    const c = await runAgent({
      bus, role: critic, model: modelForTier(assign, critic.tier),
      task: '각 팀 산출물을 비판적으로 검토하라. 약점·모순·누락을 지적하라.',
      context: combined, stage: 'critique', emitSpawn: true, signal,
    });
    critiqueText = c.text;
    bus.emit('critique', { round: 1, text: critiqueText }, { agentId: critic.id });
  }

  // --- CEO 검토·확정 — 부서 산출물이 ①의 실행 지침을 준수했는지 검토하고 최종 산출물(문서)을 확정 ---
  const synthContext = [
    acceptanceBlock,
    ...usableTeams.map((t) => `## ${t.team.name} 산출물\n${t.deliverable}`),
    critiqueText ? `## 비평(${critic?.name})\n${critiqueText}` : '',
  ].filter(Boolean).join('\n\n');

  // 합성 단계의 CEO 는 '문서 저자' 역할로 — 결재메모·경영평가 과편향 유발하는 기본 CEO 프롬프트를 교체.
  const ceoAuthor = { ...company.ceo, systemPrompt: SYNTH_AUTHOR_PROMPT };
  const ceoModel = modelForTier(assign, company.ceo.tier);
  bus.emit('phase', { team_id: '_ceo', phase: 'review' }); // CEO 검토·확정 단계(🔎 검토 중)

  // --- 최종 산출물: 섹션별 생성으로 충분한 분량(10p+) 확보 ---
  //  단일 합성은 로컬 모델이 ~5~6k 토큰에서 조기 종결해 분량이 1~2p 에 묶인다(brevity·캡 해제로도 동일).
  //  그래서 문서를 ① 목차(섹션 목록) → ② 각 섹션 상세 생성(섹션별 위키 그라운딩) → ③ 조립 의 'bounded 생성 합' 으로 만든다.
  //  (섹션별 그라운딩은 실데이터 검색도 정밀해져 이슈12와 시너지. 분량은 실데이터 상세화에서 — 패딩·가짜수치 금지.)
  // ① 목차 — 문서 유형에 맞는 섹션 6~9개(제목+focus). 경영평가 등 무관 프레임 배제.
  const outline = await microJSON<{ sections?: Array<{ title?: string; focus?: string }> }>(
    assign.standard,
    '너는 문서 편집자다. 요청된 문서의 유형에 맞는 표준 목차(서로 겹치지 않는 섹션 7~8개)를 만든다. 각 섹션은 제목과 핵심(focus)을 가진다(제목에 번호는 붙이지 마라). 주제와 무관한 프레임(경영평가·KPI 등)을 끌어들이지 마라. 결산보고서면 재무 결산만 다룬다(예: 결산 총괄·세입 결산·세출 결산·예산 대비 집행 분석·재무제표·기금/잉여금 처분·재정건전성 및 내부통제·결산 총평) — 사업 성과/효과 분석은 결산 범위 밖이니 섹션으로 넣지 마라(사업별은 예산 집행 내역만). 분량은 섹션 수가 아니라 각 섹션의 깊이로 확보하므로 섹션은 7~8개로 절제하라.',
    `문서: ${topic}\n\n[하위문제]\n${subContext}\n\n[수용 기준]\n${acceptance || '(없음)'}\n\n형식: {"sections":[{"title":"...","focus":"..."}]}`,
    { maxOutputTokens: 900, signal },
  );
  const planned = (outline?.sections ?? [])
    .map((s) => ({ title: asString(s?.title).trim(), focus: asString(s?.focus).trim() })) // LLM 비문자열 필드 안전화
    .filter((s) => s.title).slice(0, 8);
  const sectionList = planned.length ? planned : subproblems.map((s) => ({ title: s.text, focus: '' }));
  bus.emit('log', { message: `최종 문서를 ${sectionList.length}개 섹션으로 작성: ${sectionList.map((s) => s.title).join(' · ')}` });

  // ② 각 섹션 상세 생성(섹션별 위키 그라운딩). synthesis 단계라 brevity(2000~4000자 상한) 면제 → 섹션마다 충분히 상세.
  const sectionTexts: string[] = [];
  for (let si = 0; si < sectionList.length; si++) {
    if (signal?.aborted) break;
    const sec = sectionList[si]!;
    const out = await runAgent({
      bus, role: ceoAuthor, model: ceoModel,
      task: `「${topic}」 문서의 '${sec.title}' 섹션 본문을 개조식으로 깊이 있게 작성하라.${sec.focus ? ` 이 섹션 핵심: ${sec.focus}.` : ''}\n` +
        `- 개조식: 서술형 산문 금지, 명사형(음슴체) 종결. 단 각 말단 항목(-/·)은 빈 명사구·단어 나열이 아니라 구체적 수치·근거·메커니즘·기준·효과를 담은 완결된 실질 항목으로 작성(필요시 1~3줄).\n` +
        `- 계층 글머리: □(대항목) → ○(중항목) → -(소항목) → ·(세부). 각 ○은 최소 3개 이상의 실질 - 항목으로 전개하고, 깊은 항목일수록 더 구체적 수치·근거.\n` +
        `- 분량은 깊이(세부 분해·수치·표·근거)로 확보 — 빈 문장 패딩 금지. 제공된 [부서 산출물]·[관련 지식(위키)]의 실제 수치·표를 보존·통합하고, 핵심 수치는 표(헤더+데이터행)로 제시.\n` +
        `- 이 섹션 범위에만 집중(다른 섹션 중복 금지). 결산보고서이면 재무 집행·수치 중심이며 사업 성과/효과 분석은 제외(사업별은 예산 집행 내역만).\n` +
        `- [예산≠결산] 결산 수치는 결산·집행 자료(감사보고서 재무제표·운영성과표, 세출예산집행현황, 결산서)에서만 인용. '주요업무보고'·'예산안'·'추경'의 편성예산(본예산·추경) 수치를 결산액으로 쓰지 마라. 없으면 "⚠️ 데이터 없음(결산 확정자료 필요)".\n` +
        `- [합계 정합] 재원별·항목별을 나열하면 합이 총계와 일치하게 검산. 안 맞으면 "검증 필요" 표기.\n` +
        `- 결재메모·플레이스홀더 금지, 인용 수치엔 [근거], 빠진 값은 "⚠️ 데이터 없음: <항목>"(0·임의값으로 분량 채우기 금지).\n` +
        `- 섹션 제목(## )은 출력하지 말고 본문만 작성.`,
      // blockId 'ceo-synth' 고정 — 오피스뷰 CEO '통합 중' 안무(ceoIntegrating)가 합성 내내 유지되게. 첫 섹션에 CEO 스폰.
      // 심층 분량 — 섹션 수가 아니라 섹션 깊이로 분량 확보(사용자 요청). 개조식이라 토큰당 항목이 많으니 넉넉히.
      context: synthContext, stage: 'synthesis', emitSpawn: si === 0, blockId: 'ceo-synth', groundQuery: `${topic} ${sec.title} ${sec.focus}`,
      // 합성 그라운딩은 위키만·3건으로 좁힘 — 팀이 이미 작업 단계에서 외부 커넥터(법령·KOSIS 등)를 호출해
      // 데이터를 모았으므로, 섹션마다 느린 외부 API 를 재호출하지 않는다(통합 느림의 큰 원인). C 수정 후
      // 1차 원문(결산보고서 등)이 위키 상위에 집중되므로 위키 3건이면 핵심 수치 확보 + 프리필·외부호출 절감.
      groundWikiOnly: true, groundLimit: 3, maxOutputTokens: 5500, signal,
    });
    // 목차 제목에 이미 번호가 있으면(예: "1. 결산 총괄") 제거 후 우리 번호를 붙인다 — "## 1. 1." 이중 번호 방지.
    const cleanTitle = sec.title.replace(/^\s*\d+[.)]\s*/, '').trim();
    if (out.text.trim()) sectionTexts.push(`## ${si + 1}. ${cleanTitle}\n\n${out.text.trim()}`);
  }

  // ③ 조립
  let finalDeliverable = `# ${topic}\n\n${sectionTexts.join('\n\n')}`.trim();

  // --- 검증(이슈12) — 조립 문서에 템플릿/가짜수치가 남았는지 확인. 섹션 생성이 이미 플레이스홀더를 금지하므로
  //     보통 0건. 긴 문서 전체 재작성은 truncation 위험이 있어 하지 않고, 발견 시 로그로 가시화(패딩 방지 원칙은 섹션 프롬프트가 강제). ---
  const placeholders = findTemplateNumbers(finalDeliverable);
  if (placeholders.length) {
    bus.emit('log', { message: `검증 — 잔여 플레이스홀더/가짜수치 ${placeholders.length}건 발견: ${placeholders.slice(0, 6).join(', ')} (실데이터/데이터없음 표기 권장)` });
  }

  // --- 데이터 검증 패스(사용자 요청) — 인용 수치가 (1) 예산이 아닌 결산/집행 자료 근거인지, (2) 합계 정합한지 점검.
  //     결산 원문(감사보고서·세출예산집행현황 등)을 다시 끌어와 대조하고, 발견된 문제를 보고서 말미 '검증 메모'로 가시화한다.
  //     (긴 문서 전체 재작성은 truncation 위험 → 침묵 재작성 대신 flag. 합성 단계 가드[예산≠결산·합계정합]가 1차 예방.) ---
  bus.emit('phase', { team_id: '_ceo', phase: 'review' });
  if (!signal?.aborted) {
    try {
      const auditCtx = llmWiki().query(`${topic} 감사보고서 재무제표 운영성과 세출예산집행현황 결산 집행액 불용 이월 잉여금`, 6).context;
      const verdict = await microJSON<{ issues?: Array<{ figure?: string; problem?: string; correct?: string }> }>(
        assign.standard,
        '너는 결산 데이터 감사관이다. [검증 대상 보고서]의 핵심 수치를 [결산 원문 근거]와 대조해 다음만 찾아라: ' +
        '(1) 예산(편성예산·본예산·추경 — 업무보고/예산안 출처)을 결산(집행 실적·재무제표)값으로 잘못 인용한 것, ' +
        '(2) 구성요소 합이 명시 총계와 불일치하는 것. 문제 없으면 issues 빈 배열. 추측 금지 — 근거에 있는 사실만.',
        `[결산 원문 근거]\n${auditCtx.slice(0, 6000)}\n\n[검증 대상 보고서]\n${finalDeliverable.slice(0, 7000)}\n\n` +
        `형식: {"issues":[{"figure":"인용 수치","problem":"무엇이 틀렸나","correct":"근거상 올바른 값 또는 데이터없음"}]}`,
        { maxOutputTokens: 1500, signal },
      );
      const issues = (verdict?.issues ?? []).filter((i) => i && i.problem);
      if (issues.length) {
        const memo = issues.slice(0, 12).map((i) => `- ${i.figure ?? '(수치)'}: ${i.problem}${i.correct ? ` → ${i.correct}` : ''}`).join('\n');
        finalDeliverable += `\n\n## ⚠️ 데이터 검증 메모\n_자동 검증에서 결산 원문 대조 결과 다음이 확인됨(확정 전 검토 요망)._\n${memo}`;
        bus.emit('log', { message: `데이터 검증 — 이슈 ${issues.length}건(예산/결산 혼동·합계 불일치 등) → 보고서 말미 검증 메모 첨부` });
      } else {
        bus.emit('log', { message: '데이터 검증 — 핵심 수치가 결산 원문과 정합(이슈 없음)' });
      }
    } catch { /* 검증 실패는 산출물을 막지 않음 */ }
  }

  await finalizeRun({
    bus, topic, ceoId: company.ceo.id, ceoName: company.ceo.name,
    assignReason: assign.reason, subproblems,
    positions: usableTeams.map((t) => ({ id: t.team.id, name: t.team.name, stance: 'neutral', text: t.deliverable })),
    participants: usableTeams.flatMap((t) => t.participants), // 자가학습 roster — 팀원 개별 역할(F1)
    critique: critic && critiqueText ? { id: critic.id, name: critic.name, text: critiqueText } : undefined,
    deliverable: finalDeliverable, converged: false, ingestModel: assign.micro, reflectModel: assign.standard, signal,
  });

  return {
    deliverable: finalDeliverable, modelAssignment: assign,
    positions: usableTeams.map((t) => ({ id: t.team.id, name: t.team.name, stance: 'neutral', text: t.deliverable })),
    subproblems,
  };
}
