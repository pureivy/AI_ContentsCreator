/**
 * 유휴 게이트 자율 사이클(옵트인: AUTO_CYCLE_MINUTES>0) — Connect AI 15분 오토사이클의 로컬·속도우선 변형.
 *
 * 핵심 긴장: gepa 의 모든 속도 설계가 '단일 KV 슬롯(concurrency=1)'에 수렴하는데, 상시 백그라운드 LLM
 * 루프는 그 슬롯을 점유해 사용자 런을 지연시킨다. 그래서 이 스케줄러는 세 가지로 충돌을 회피한다.
 *   (1) 사용자 런이 하나라도 진행 중이면 진입조차 안 함(유휴 게이트).
 *   (2) 자율 런도 사용자 런과 같은 LLM_SLOT 으로 큐잉 → 단일 KV 슬롯 불변식 자동 보존.
 *   (3) 사용자 런 도착 시 양보(진행 중 자율 런 abort) — main.ts 의 launchRun 이 처리.
 * 기본 ON(config autoCycleMinutes=30). 켜져도 '가장 가치있는 단일 작업'을 micro 로 1건 제안해 저비용 런 1개만 띄운다(끄려면 AUTO_CYCLE_MINUTES=0).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { ollama } from '../llm/ollama';
import { llm } from '../llm/client';
import { getSystemSpecs, autoAssignModels } from '../llm/models';
import { tierOverrides } from '../llm/setting';
import { getCompany } from '../agents/company-loader';

export interface AutoCycleDeps {
  /** 사이클 주기(ms). ≤0 이면 스케줄러는 no-op. */
  intervalMs: number;
  /** 사용자/기존 런이 진행 중인가(유휴 게이트). true 면 이번 틱을 건너뛴다. */
  isBusy: () => boolean;
  /** 다음에 할 '단일 작업' 주제 제안. null 이면 띄우지 않음. */
  proposeTask: (signal?: AbortSignal) => Promise<string | null>;
  /** 제안된 주제로 자율 런을 띄운다(main.ts 의 launchRun 으로 위임). */
  launch: (topic: string) => void;
  log?: (msg: string) => void;
}

/** 자율 사이클 시작. 반환값은 정지 함수. intervalMs≤0 이면 아무것도 하지 않는다. */
export function startAutoCycle(deps: AutoCycleDeps): () => void {
  if (!(deps.intervalMs > 0)) return () => {};
  let ticking = false; // 재진입 가드 — proposeTask(LLM)이 주기보다 길어도 틱이 겹쳐 다중 자율런이 뜨지 않게.
  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      if (deps.isBusy()) { deps.log?.('사용자 런 진행 중 — 자율 사이클 건너뜀'); return; }
      const topic = await deps.proposeTask();
      const t = (topic ?? '').trim();
      // 제안 도중 사용자 런이 도착했을 수 있으니 launch 직전 재확인(유휴 게이트 비원자성 완화).
      if (deps.isBusy()) { deps.log?.('제안 도중 사용자 런 도착 — 자율 사이클 보류'); return; }
      if (t) { deps.log?.(`자율 사이클 — "${t}"`); deps.launch(t); }
      else deps.log?.('자율 사이클 — 제안할 작업 없음(지식베이스 비어있음 또는 중복)');
    } catch (e) {
      deps.log?.(`자율 사이클 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      ticking = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, deps.intervalMs);
  if (typeof timer.unref === 'function') timer.unref(); // 프로세스 종료를 막지 않게
  return () => clearInterval(timer);
}

export interface DailyDeps {
  /** "HH:MM" 로컬 시각. 형식 불일치면 no-op. */
  time: string;
  run: () => void;
  log?: (msg: string) => void;
}

/** 매일 지정 시각(로컬)에 1회 run() 호출 — 1분 간격 체크 + 당일 1회 가드. 정지 함수 반환. */
export function startDaily(deps: DailyDeps): () => void {
  const m = /^(\d{1,2}):(\d{2})$/.exec((deps.time || '').trim());
  if (!m) return () => {};
  const hh = Number(m[1]); const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return () => {};
  let lastFired = '';
  const tick = (): void => {
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (today === lastFired) return; // 당일 1회만
    if (now.getHours() === hh && now.getMinutes() >= mm) {
      lastFired = today;
      try { deps.log?.(`일일 브리핑 발송(${deps.time})`); deps.run(); }
      catch (e) { deps.log?.(`일일 브리핑 오류: ${e instanceof Error ? e.message : String(e)}`); }
    }
  };
  const timer = setInterval(tick, 60_000);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

function readSafe(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

// 최근 자율 주제(중복 회피) — Connect AI 의 '24h 내 반복 금지'에 대응하는 경량 메모리.
const recentAuto: string[] = [];

/**
 * '다음에 하면 가치있는 단일 작업'을 micro 로 한 줄 제안 — **조직 헌장(팀·업무 범위)에 그라운딩**한다.
 *
 * 핵심: 과거엔 위키 인덱스를 주제 소스로 썼는데, 인덱스는 과거 자율런이 적재한 '특정 기업의 기술·공정 자료'
 * (염폐수 수질·지하수 관정·제련 공정 등)로 가득 차 있어, 플래너가 기관 업무 밖 주제로 드리프트했다(실측: AUTO
 * 주제 대부분이 ㈜OO 공정 디테일). + 자율런→그 기업 자료 재적재→인덱스 더 편향 의 피드백 루프. 그래서 인덱스를
 * 주제 '생성'에서 제외하고, 팀 focus(기관이 실제 담당하는 업무)를 재료로, 최근 수행 주제만 '중복 회피'로 쓴다.
 */
export async function proposeAutonomousTask(signal?: AbortSignal): Promise<string | null> {
  const c = getCompany();
  // 팀·업무 범위(헌장) — 이게 주제 생성의 재료다(기관 정체성·업무가 focus 에 담겨 있음).
  const teamLines = (c.teams ?? [])
    .map((t) => `- ${t.name}: ${(t.lead?.specialty || '').replace(/\s+/g, ' ').slice(0, 200)}`)
    .filter((l) => l.length > 6)
    .join('\n');
  if (!teamLines.trim()) return null; // 조직 구성이 없으면 제안 불가

  // 중복 회피용으로만 최근 수행 주제(결정 로그)를 짧게 — '생성 재료'가 아니라 '피할 목록'.
  const done = readSafe(path.join(CONFIG.dataDir, '_shared', 'decisions.md')).slice(-500);

  const installed = await ollama.listModels();
  if (installed.length === 0) return null;
  const assign = CONFIG.localModel
    ? { micro: CONFIG.localModel }
    : autoAssignModels(installed, getSystemSpecs(), tierOverrides());

  const res = await llm.chat({
    model: assign.micro,
    messages: [
      {
        role: 'system',
        content:
          '너는 이 공공기관의 자율 운영 플래너다. 아래 [팀·업무 범위]가 이 기관이 실제로 담당하는 업무다. ' +
          '이 기관·팀이 다음에 수행하면 가치있는 "단일" 작업 주제를 반드시 이 업무 범위 안에서 제안하라.\n' +
          '- 기관의 정책·지원사업 기획/효과분석, 기관 전략·경영평가 대응, 예산·회계·기금·계약·인사 등 기관 운영 관점이어야 한다.\n' +
          '- 기업을 "지원"하는 정책·사업은 이 기관의 업무다(예: 입주기업 전기요금 부담 완화 지원방안). 그러나 특정 ' +
          '민간기업의 내부 기술·공정 문제(수질·폐수·설비·제련/제조 공정 개선, 지하수 관정 개발 등)는 그 기업의 일이지 ' +
          '이 기관의 업무가 아니다 — 절대 제안하지 마라.\n' +
          '- [최근 수행]·[최근 자율주제]와 중복되는 주제는 피하라.\n' +
          '- 따옴표·머리말·설명 없이 제목 한 줄만 출력하라.',
      },
      {
        role: 'user',
        content:
          `[팀·업무 범위]\n${teamLines}\n\n` +
          `[최근 수행 — 중복 회피]\n${done || '(없음)'}\n\n` +
          `[최근 자율주제 — 중복 회피]\n${recentAuto.slice(-5).join('\n') || '(없음)'}`,
      },
    ],
    maxOutputTokens: 120,
    temperature: 0.6,
    signal,
  });
  const topic = (res.text.trim().split('\n')[0] ?? '').replace(/^["'\-•\s]+/, '').slice(0, 120).trim();
  if (!topic || recentAuto.includes(topic)) return null;
  recentAuto.push(topic);
  if (recentAuto.length > 20) recentAuto.shift();
  return topic;
}
