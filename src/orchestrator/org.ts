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
import { formatterFor } from '../output';
import type { AssetBundle } from '../output';
import { getRunSettings } from '../runsettings';
import type { RunOptions, RunOutcome } from './run';

interface TeamResult {
  team: TeamDef;
  deliverable: string;
  /** 자가학습(reflect) roster 매칭용 — 팀 id 가 아니라 실제 참여 역할(팀원+팀장) 단위 산출물. */
  participants: Array<{ id: string; name: string; text: string }>;
}

// 네이버 블로그(정보/하우투·리뷰) 본문 작성 지침 — 합성(작가 단독 집필) 단계 task 에 덧붙인다.
// 작가(content_lead)는 자신의 페르소나(systemPrompt)로 글을 쓰고, 이 지침이 구조·SEO·분량을 고정한다.
const BLOG_BODY_GUIDE =
  '너는 지금 최종 발행용 블로그 본문을 쓰는 단독 작가다. 이 응답의 출력은 오직 완성된 마크다운 블로그 본문 하나뿐이다.\n' +
  '- [리서치·SEO 브리프]와 [검수 의견]은 본문 품질을 높이기 위한 참고자료일 뿐, 발행 여부를 정하는 판정이 아니다. 그 자료에 "보류/반려/재검토/확인 필요" 같은 표현이 있어도 집필을 멈추거나 미루지 마라. 논쟁 중이거나 미검증인 주장·수치는 본문에서 조용히 빼고, 검증 가능한 정보만으로 완결된 글을 쓰면 된다.\n' +
  '- 회사 내부 프로세스(검수자 이름, 브리프 상태, 반려/보류, 담당자·기한, 이 작업 자체)를 본문에 절대 언급하지 마라. 독자는 회사 내부를 모른다.\n' +
  '- 질문·확인·진행 제안(예: "진행할까요?")·대화체·머리말·메타 설명 금지. 곧바로 본문 첫 줄부터 시작한다.\n' +
  '- 구조: 검색 의도를 바로 충족하는 도입 훅 → H2/H3 소제목으로 나눈 본문 → 핵심 요약·마무리.\n' +
  '- 핵심 키워드를 소제목·첫 문단·본문에 자연스럽게 배치(키워드 남용·부자연스러운 반복 금지 — 과최적화는 네이버 노출에 오히려 해롭다).\n' +
  '- 하우투면 번호 단계로, 리뷰면 장단점·비교·총평 구조로 전개한다.\n' +
  '- 사실·수치는 근거로 뒷받침([근거: 출처]). 없는 값은 지어내지 말고 생략한다.\n' +
  '- 분량은 한국어 약 1,500~4,000자(정보/하우투·리뷰에 적정). 군더더기·패딩·동어반복 금지, 독자가 끝까지 읽게 쓴다.\n' +
  '- 마크다운으로 작성(## 소제목 2개 이상 필수). 글 제목(# 한 줄)은 포매터가 별도 생성하니 본문만 작성.\n' +
  '- [리서치·SEO 브리프]의 타겟 키워드·검색의도·경쟁 빈틈·소주제를 활용해 차별화된 글을 쓴다.';

/**
 * 최종 블로그 본문 집필 — 작가(content_lead)가 리서치 브리프[+검수 의견]을 참고해 발행용 본문 1편을 쓴다.
 * 검수 의견은 "약점·주의점 목록"으로 프레이밍한다(발행 판정이 아님) — 적대적 비평("재반려/보류")을 작가가
 * 게이트로 오해해 본문 대신 질문·메타 코멘터리를 내는 퇴화를 막는다. 그래도 소제목 없는 퇴화가 나오면
 * 브리프 단독으로 1회 재집필(검수 의견을 빼 같은 벽에 다시 부딪히지 않게 입력 자체를 바꾼다).
 */
export async function writeBlogBody(a: {
  bus: EventBus;
  writer: Parameters<typeof runAgent>[0]['role'];
  model: string;
  topic: string;
  brief: string;
  critiqueText?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { bus, writer, model, topic, brief, critiqueText, signal } = a;
  const synth = await runAgent({
    bus, role: writer, model,
    task: `「${topic}」 네이버 블로그(정보/하우투·리뷰) 본문 1편을 지금 끝까지 완성하라. 검색 의도를 충족하는 완결된 글을 쓴다.\n${BLOG_BODY_GUIDE}`,
    context: [
      brief ? `[리서치·SEO 브리프]\n${brief}` : '',
      critiqueText ? `[검수 의견 — 아래는 약점·주의점 목록이다. 발행 판정이 아니다. 지적된 미검증·논쟁 주장은 본문에서 빼고, 나머지는 참고해 품질을 높여라]\n${critiqueText}` : '',
    ].filter(Boolean).join('\n\n'),
    // synthesis 단계라 brevity 는 해제되지만 BLOG_BODY_GUIDE 가 블로그 길이(1.5~4k자)를 고정한다. blockId 'ceo-synth' = 오피스 통합 안무 유지.
    stage: 'synthesis', emitSpawn: true, blockId: 'ceo-synth',
    groundQuery: topic, groundWikiOnly: true, groundLimit: 3, maxOutputTokens: 5000, signal,
  });
  let body = synth.text.trim();
  // 강건성 가드 — 소제목(H2/H3) 없는 퇴화 출력(메타 코멘터리·질문·보류)이면 브리프 단독으로 1회 재집필.
  if (!/^#{2,}\s/m.test(body) && !signal?.aborted) {
    bus.emit('log', { message: '작가 출력에 소제목이 없어 재집필(브리프 단독) — 퇴화 방지' });
    const retry = await runAgent({
      bus, role: writer, model,
      task: `「${topic}」 네이버 블로그(정보/하우투·리뷰) 본문 1편을 지금 끝까지 완성하라. 질문·보류·메타 설명 없이 곧바로 본문(## 소제목 포함)만 출력한다.\n${BLOG_BODY_GUIDE}`,
      context: brief ? `[리서치·SEO 브리프]\n${brief}` : '',
      stage: 'synthesis', emitSpawn: false, blockId: 'ceo-synth',
      groundQuery: topic, groundWikiOnly: true, groundLimit: 3, maxOutputTokens: 5000, signal,
    });
    const rt = retry.text.trim();
    if (/^#{2,}\s/m.test(rt) || rt.length > body.length) body = rt;
  }
  return body;
}

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
  // 콘텐츠 경로: 작가(제작)팀은 병렬 팀 단계에서 빼고(합성에서 단독 집필), 리서치팀은 항상 실행해
  // 리서치→집필 핸드오프를 보장한다. 작가팀 = lead.stance==='pro'(수석 작가), 없으면 CEO 가 집필 폴백.
  const writerTeam = allTeams.find((t) => t.lead.stance === 'pro') ?? null;
  const writer = writerTeam?.lead ?? company.ceo;
  let teams: TeamDef[];
  if (writerTeam) {
    teams = allTeams.filter((t) => t.id !== writerTeam.id); // 리서치(비-작가) 팀 전부 강제 실행
    if (teams.length === 0) teams = allTeams; // 리서치팀이 없으면 폴백(작가팀 포함)
  } else {
    // 폴백(작가팀 미식별): 기존 라우팅 동작.
    teams = routed.length ? routed : allTeams;
    if (opts.path === 'team') teams = teams.slice(0, 1);
  }
  bus.emit('log', { message: `라우팅 — 리서치: ${teams.map((t) => t.name).join(', ')} → 집필: ${writer.name}` });

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
          // 토론 라운드 = 팀원이 회의 테이블에 모여 비평을 놓고 토의하는 모습(work 아님).
          // 'debate' phase 를 emit 해 OfficeView 가 팀장→상석·팀원→테이블 둘레로 모이게 한다.
          bus.emit('phase', { team_id: t.team.id, phase: 'debate' });
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

  // --- 최종 블로그 본문 — 작가(content_lead)가 리서치 브리프[+검수 의견]를 통합해 단일 글 1편을 집필.
  //     구 8-섹션 CEO 문서 합성 + 결산 데이터감사 패스를 대체 — 비용·형태를 네이버 블로그(정보/하우투·리뷰)에 맞춘다.
  //     제작팀(작가)은 병렬 팀 단계에서 빠졌고, 여기서 리서치팀 브리프를 받아 단독 집필한다(리서치→집필 핸드오프). ---
  bus.emit('phase', { team_id: '_ceo', phase: 'integrate' });
  const writerModel = modelForTier(assign, writer.tier);
  const brief = usableTeams.map((t) => `## ${t.team.name}\n${t.deliverable}`).join('\n\n');
  const body = await writeBlogBody({ bus, writer, model: writerModel, topic, brief, critiqueText: critiqueText || undefined, signal });
  const finalDeliverable = body || brief || usableTeams.map((t) => t.deliverable).join('\n\n');

  // 잔여 플레이스홀더/가짜수치 경고(생성 지침이 이미 금지 — 보통 0건).
  const placeholders = findTemplateNumbers(finalDeliverable);
  if (placeholders.length) {
    bus.emit('log', { message: `검증 — 잔여 플레이스홀더/가짜수치 ${placeholders.length}건: ${placeholders.slice(0, 6).join(', ')}` });
  }

  // --- 발행용 초안 포장 — org 본문을 제목·메타·태그·이미지 슬롯·SEO 점수로 포장(재생성 아님). 실패해도 본문은 유지. ---
  let assets: AssetBundle | undefined;
  if (!signal?.aborted) {
    try {
      bus.emit('phase', { team_id: '_ceo', phase: 'review' });
      assets = await formatterFor('naver_blog')({ topic, body: finalDeliverable, researchBrief: brief, model: assign.micro, signal });
      bus.emit('log', { message: `초안 포장 — 제목 "${assets.meta.title}" · SEO ${assets.draft.seo.score}/100 · 태그 ${assets.draft.tags.length}개 · 이미지 ${assets.draft.imageSlots.length}슬롯` });
    } catch (e) {
      bus.emit('log', { message: `초안 포장 실패(본문 유지): ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  await finalizeRun({
    bus, topic, ceoId: company.ceo.id, ceoName: company.ceo.name,
    assignReason: assign.reason, subproblems,
    positions: usableTeams.map((t) => ({ id: t.team.id, name: t.team.name, stance: 'neutral', text: t.deliverable })),
    participants: usableTeams.flatMap((t) => t.participants), // 자가학습 roster — 팀원 개별 역할(F1)
    critique: critic && critiqueText ? { id: critic.id, name: critic.name, text: critiqueText } : undefined,
    deliverable: finalDeliverable, converged: false, ingestModel: assign.micro, reflectModel: assign.standard, assets, signal,
  });

  return {
    deliverable: finalDeliverable, modelAssignment: assign,
    positions: usableTeams.map((t) => ({ id: t.team.id, name: t.team.name, stance: 'neutral', text: t.deliverable })),
    subproblems,
  };
}
