/**
 * Claude Code CLI 클라이언트 — 구독(OAuth) 인증으로 Claude 호출. 기존 ChatParams→ChatResult 계약 구현.
 *
 * 왜 CLI 경유인가: Anthropic SDK 직접 호출(구 llm/anthropic.ts)은 ant OAuth 프로필/API 키 경유로
 * 조직의 API 크레딧에 과금된다(크레딧 소진 시 400). `claude -p` 는 Claude Code 구독 로그인으로
 * 과금(정액) — 이 스튜디오의 전제와 일치. 대신 호출당 CLI 부팅 오버헤드(~1.5s)와 구독 rate limit
 * (5시간 윈도, Claude Code 대화 세션과 쿼터 공유)을 감수한다.
 *
 * 격리 플래그(실측: 하니스 컨텍스트 31K→175 토큰, 레이턴시 11.6s→2.6s):
 *  --tools ""            도구 전면 비활성(순수 텍스트 생성 — 에이전틱 루프 차단)
 *  --setting-sources ""  사용자/프로젝트 설정·훅 미로딩
 *  --strict-mcp-config   MCP 서버 미로딩(스키마 주입 방지)
 *  --no-session-persistence · --max-turns 1 · 중립 cwd(프로젝트 CLAUDE.md 미주입)
 *
 * 파라미터 매핑(계약 대비 근사치):
 *  - maxOutputTokens → CLAUDE_CODE_MAX_OUTPUT_TOKENS env
 *  - think → ollama 경로와 동일하게 미지정 시 runSettings.agentThinking(UI '추론' 토글)을 따른다.
 *    think off 시 sonnet 만 --effort low 근사(haiku 는 effort 미지원 → 생략). opus 는 편집장·리드의
 *    판단 단계(통합·브리프·지명 런) 전용이므로 토글이 꺼져 있어도 low 로 강등하지 않는다(CLI 기본 effort).
 *  - temperature → CLI 미노출 → 무시(기존에도 haiku 전용 옵션이었음)
 *  - format:'json' → 기존 SDK 경로와 동일하게 프롬프트 지시에 위임(호출부 microJSON 이 처리)
 *  - onDelta → stream-json 의 content_block_delta/text_delta
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../config';
import { getRunSettings } from '../runsettings';
import { Semaphore } from '../util/semaphore';
import { recordUsage } from './cost';
import type { ChatParams, ChatResult, ChatMessage } from './types';

// 클라우드는 KV 슬롯 경합이 없어 단일 슬롯 불필요 — 동시 spawn 상한만 둔다.
const SLOT = new Semaphore(CONFIG.anthropicConcurrency);

// 중립 작업 디렉토리 — 스튜디오 프로젝트의 CLAUDE.md/설정이 생성 프롬프트에 새어들지 않게.
const NEUTRAL_CWD = path.join(os.tmpdir(), 'ai-contents-claude-cli');

// ── 결과 줄 없이 끝나는 실패의 진단(2026-09-15) ──────────────────────────────────────────
// 실측 3건(09-04 사과나무 3,400자 · 09-15 06:28 0자 · 09-15 17:31 572자)이 전부 SEO 리비전 런,
// 전부 opus, 전부 exit=0 에 stderr 비어 있음. 손으로 재현은 안 된다(같은 구조를 160회 돌려도 재현 실패).
// 그래서 '다음에 또 나면 끝에 무엇이 왔는지'를 파일로 남긴다 — 원문 꼬리·이벤트 분포·경합 여부까지.
/** 진단 덤프 입력(순수 조립 대상). */
export interface CliFailureInfo {
  model: string; exitCode: number | null; exitSignal: string | null;
  elapsedMs: number; gotChars: number; quietSec: number;
  lines: number; linesAfterChildClose: number; endsWithNewline: boolean;
  eventCounts: Record<string, number>; lastEventType: string;
  promptChars: number; systemChars: number; maxTokens: number;
  stderrTail: string; rawTail: string;
}

/**
 * 사람이 읽을 한 줄 진단(순수) — 원인을 좁히는 첫 갈래를 바로 보여 준다.
 *  · 자식 종료 뒤에도 줄이 더 왔다 = 우리 쪽 경합(읽기 전에 판정함)
 *  · 원문이 줄바꿈 없이 끝났다 = 출력이 중간에 잘림(파이프·프로세스 급종료)
 *  · 둘 다 아니면 = CLI 가 결과 줄 자체를 안 보낸 것
 */
export function diagnoseCliFailure(i: Pick<CliFailureInfo, 'linesAfterChildClose' | 'endsWithNewline' | 'lines' | 'exitSignal'>): string {
  if (i.linesAfterChildClose > 0) return `우리 쪽 읽기 경합 의심 — 자식 종료 뒤 ${i.linesAfterChildClose}줄이 더 왔다`;
  if (i.exitSignal) return `시그널 종료(${i.exitSignal}) — 외부에서 프로세스가 끊겼다`;
  if (!i.endsWithNewline) return '출력이 줄 도중에 끊김 — 파이프·프로세스 급종료 의심';
  if (!i.lines) return 'CLI 가 한 줄도 안 보냄 — 기동 직후 종료 의심';
  return 'CLI 가 결과 줄을 안 보냄 — 스트림은 정상 종료(원인 미상)';
}

const FAIL_DIR = (): string => path.join(CONFIG.dataDir, '_shared', 'cli-fail');
/** 진단 덤프 기록 — 최신 20개만 남긴다. 실패해도 무해(로그만). 반환: 기록한 경로(실패 시 ''). */
function writeCliFailureDump(info: CliFailureInfo): string {
  try {
    const dir = FAIL_DIR();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}-${info.model.replace(/[^a-z0-9-]/gi, '')}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...info, diagnosis: diagnoseCliFailure(info) }, null, 1), 'utf-8');
    const olds = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of olds.slice(0, Math.max(0, olds.length - 20))) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* 무해 */ } }
    return file;
  } catch { return ''; }
}
/** spawn 직전 매번 보장 — 부팅 1회 mkdir 는 상주 서버에서 부족하다(실사고 2026-08-10 13:21: macOS
 *  임시폴더 청소가 이 디렉토리를 지워 이후 모든 호출이 "spawn claude ENOENT" — cwd 부재도 실행 파일
 *  부재와 같은 코드로 보고돼 CLI 문제로 오독). mkdir 1회 비용은 CLI 부팅(~1.5s) 대비 무시 가능. */
export function ensureNeutralCwd(): string {
  fs.mkdirSync(NEUTRAL_CWD, { recursive: true });
  return NEUTRAL_CWD;
}

// ── CLI 탐색 경로 보강(실사고 2026-08-31 08:55~10:55) ──────────────────────────────
// 데스크탑 런처(scripts/launcher/start.sh)로 띄운 서버에서 모든 LLM 호출이 "spawn claude ENOENT" 로
// 죽었다. LaunchServices 경유 부팅은 PATH 가 /usr/bin:/bin:/usr/sbin:/sbin 로 축소되는데 claude 는
// ~/.local/bin 에 있었다. 결과: 오토런 틱이 2시간 동안 "처리할 작업 없음"만 남기고 침묵(호출부가
// 실패를 삼켰다 — scheduler.ts 의 무로그 return 도 같이 봉합). 런처를 고치는 것만으로는 부족하다 —
// 이 서버는 터미널·런처·launchd 등 어디서든 뜰 수 있고, PATH 축소는 그 모든 경로에서 재발한다.
/** claude 설치 관례상의 사용자 bin 디렉토리 — PATH 뒤에 덧붙일 후보(앞이 아니라 뒤: 기존 우선순위 불변). */
const CLI_FALLBACK_DIRS = (home: string): string[] => [
  path.join(home, '.local', 'bin'),      // 공식 설치 스크립트 기본값
  path.join(home, '.claude', 'local'),   // 로컬 설치(claude migrate-installer)
  path.join(home, '.npm-global', 'bin'), // npm prefix 커스텀
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

/** spawn 에 넘길 PATH — 주어진 PATH 를 그대로 두고 표준 사용자 bin 을 뒤에 덧붙인다(중복 제거). */
export function cliSearchPath(basePath = process.env.PATH ?? '', home = os.homedir()): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...basePath.split(path.delimiter), ...CLI_FALLBACK_DIRS(home)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(path.delimiter);
}

/** CLI 실행 파일을 지금 찾을 수 있는가 — 못 찾으면 사유 문자열, 정상이면 null. 부팅 1회 점검용.
 *  경로에 구분자가 있으면 그 파일 자체를, 아니면 보강된 PATH 를 훑는다. */
export function claudeCliProblem(cli = CONFIG.claudeCliPath, searchPath = cliSearchPath()): string | null {
  if (cli.includes(path.sep)) {
    return fs.existsSync(cli) ? null : `claude CLI 실행 파일 없음: ${cli} (CLAUDE_CLI_PATH 확인)`;
  }
  const dirs = searchPath.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    try { fs.accessSync(path.join(dir, cli), fs.constants.X_OK); return null; } catch { /* 다음 후보 */ }
  }
  return `claude CLI "${cli}" 를 PATH 에서 찾지 못함 — 모든 LLM 호출이 실패합니다(PATH: ${searchPath})`;
}

/** ChatMessage[] → {system, prompt}. 멀티턴 이력은 단일 프롬프트로 직렬화(-p 는 1턴 입력). */
function toPrompt(msgs: ChatMessage[]): { system?: string; prompt: string } {
  const systemParts: string[] = [];
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of msgs) {
    const content = (m.content ?? '').trim();
    if (m.role === 'system') { if (content) systemParts.push(content); continue; }
    if (!content) continue; // 빈 턴 제거(기존 SDK 경로와 동일)
    turns.push({ role: m.role, content });
  }
  const system = systemParts.join('\n\n') || undefined;
  if (!turns.length) return { system, prompt: '(빈 입력)' };
  if (turns.length === 1 && turns[0]!.role === 'user') return { system, prompt: turns[0]!.content };
  const lines = turns.map((t) => `[${t.role === 'user' ? '사용자' : '어시스턴트'}]\n${t.content}`);
  return { system, prompt: `${lines.join('\n\n')}\n\n위 대화에 이어 어시스턴트로서 답하라. 답변 본문만 출력한다.` };
}

/** stream-json result 이벤트에서 쓰는 필드만. */
interface CliResult {
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}


/**
 * 결과 줄 없이 정상 종료(exit=0)한 실패인가(순수) — 한 번 다시 부를 대상.
 * 2026-10-15 실사고: 유튜브 숏폼 대본 기획이 944자 받은 뒤 결과 줄 없이 끝나 편 전체가 실패했다(인스타 형제 편은 정상).
 * 같은 호출을 다시 돌리면 정상이라는 게 09-15부터의 관측이라, 부분 텍스트 회수(위 decide 주석에서 접은 안) 대신
 * 처음부터 한 번 더 부른다. 시그널 종료(exit=null)·타임아웃·중단은 대상이 아니다.
 */
export function isNoResultFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /: 결과 없음\(exit=0\)/.test(msg);
}

export class ClaudeCliClient {
  async chat(params: ChatParams): Promise<ChatResult> {
    try {
      return await SLOT.run(() => this._chat(params));
    } catch (e) {
      if (!isNoResultFailure(e) || params.signal?.aborted) throw e;
      console.log('[claude-cli]', `결과 줄 없이 종료 — 한 번 다시 부름(${params.model})`);
      return SLOT.run(() => this._chat(params));
    }
  }

  private _chat(params: ChatParams): Promise<ChatResult> {
    const model = params.model;
    const isHaiku = /haiku/i.test(model);
    const maxTokens = Math.min(Math.max(1, params.maxOutputTokens ?? CONFIG.maxOutputTokens), 64_000);
    // UI '추론' 토글(runSettings.agentThinking) 폴백 — 미지정 호출도 토글을 따른다.
    const wantThink = (params.think ?? getRunSettings().agentThinking) && params.format !== 'json';
    let { system, prompt } = toPrompt(params.messages);

    // 비전 입력 — 이미지가 있으면 Read 도구만 허용해 CLI 가 파일을 직접 보게 한다(다른 도구는 여전히 차단).
    // 캡 8장: 컨텍스트·턴 폭주 방지. --add-dir 로 이미지 디렉토리를 읽기 허용(중립 cwd 밖 접근).
    const vision = (params.visionPaths ?? []).filter((p) => { try { return fs.existsSync(p); } catch { return false; } }).slice(0, 8);
    if (vision.length) {
      prompt += `\n\n[이미지 ${vision.length}장 — 반드시 각 파일을 Read 도구로 열어 직접 본 뒤 답하라]\n`
        + vision.map((p, i) => `${i + 1}. ${p}`).join('\n');
    }

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose', // print 모드의 stream-json 요구사항
      '--model', model,
      '--tools', vision.length ? 'Read' : '',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--no-session-persistence',
      // 비전은 Read 호출 턴이 필요 — 장수 비례 여유(그 외엔 기존 1턴 유지).
      '--max-turns', vision.length ? String(2 + vision.length * 2) : '1',
    ];
    for (const dir of [...new Set(vision.map((p) => path.dirname(p)))]) args.push('--add-dir', dir);
    if (system) args.push('--system-prompt', system);
    // opus 는 편집장·리드 판단 단계 전용 — 추론 토글이 꺼져 있어도 low 강등 없이 CLI 기본 effort 로 돈다.
    // sonnet(대량 work 단계)만 비용을 위해 low 근사 유지.
    const isOpus = /opus/i.test(model);
    if (!isHaiku && !isOpus && !wantThink) args.push('--effort', 'low');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // 상한은 요청값의 3배 여유(최소 4천) — CLI 는 상한 초과를 '절단'이 아니라 오류로 반환하므로
      // (실사고: microJSON 700 캡에서 런 전체 실패), 빠듯한 캡은 하드 에러를 유발한다. 초과분
      // 회수는 아래 close 핸들러의 부분 텍스트 절단 경로가 담당.
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(Math.min(Math.max(maxTokens * 3, 4_000), 64_000)),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      // 런처 축소 PATH 방어 — 상단 CLI_FALLBACK_DIRS 주석의 실사고 참조.
      PATH: cliSearchPath(),
    };
    // 구독 로그인 강제 — API 키/프로필이 있으면 그쪽으로 새서 크레딧 과금(400)으로 회귀한다.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_PROFILE;

    const t0 = Date.now();
    return new Promise<ChatResult>((resolve, reject) => {
      const child = spawn(CONFIG.claudeCliPath, args, { cwd: ensureNeutralCwd(), env, stdio: ['pipe', 'pipe', 'pipe'] });

      let deltaText = '';
      let lastDeltaAt = Date.now(); // 마지막 델타 시각 — 결과 줄 없이 끝났을 때 '언제부터 조용했나'를 남긴다
      let result: CliResult | undefined;
      let stderrTail = '';
      let settled = false;
      // 진단용(2026-09-15) — 결과 줄 없이 끝나는 실패의 원인을 다음번에 좁히기 위한 관측값.
      let rawTail = '';                    // 원문 꼬리 64KB — 마지막에 무엇이 왔는지가 핵심 단서
      let lines = 0;                       // 파싱 시도한 줄 수
      let lastEventType = '';
      const eventCounts: Record<string, number> = {};
      let childClosed = false, rlClosed = false;
      let exitCode: number | null = null, exitSignal: string | null = null;
      let linesAtChildClose = -1;          // 자식 종료 시점의 줄 수 — 이후 더 오면 우리 쪽 읽기 경합이다
      const fail = (msg: string) => {
        if (settled) return; settled = true;
        try { child.kill('SIGKILL'); } catch { /* 이미 종료 */ }
        reject(new Error(`Claude CLI ${model}: ${msg}`));
      };

      const timer = setTimeout(() => fail(`타임아웃(${CONFIG.requestTimeoutMs}ms)`), CONFIG.requestTimeoutMs);
      const onAbort = () => fail('중단됨(abort)');
      if (params.signal) {
        if (params.signal.aborted) { clearTimeout(timer); return fail('중단됨(abort)'); }
        params.signal.addEventListener('abort', onAbort, { once: true });
      }
      const cleanup = () => {
        clearTimeout(timer);
        params.signal?.removeEventListener('abort', onAbort);
      };

      child.on('error', (e) => { cleanup(); fail(`실행 실패(${e.message}) — claude CLI 설치/PATH 확인`); });
      child.stderr.on('data', (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });

      // 원문 꼬리 — readline 과 별개 리스너(같은 청크를 함께 받는다). 파싱 전 원문이라 잘림·잡음이 그대로 남는다.
      child.stdout.on('data', (d: Buffer) => { rawTail = (rawTail + d.toString('utf-8')).slice(-65_536); });

      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        lines++;
        let ev: Record<string, unknown>;
        try { ev = JSON.parse(line) as Record<string, unknown>; eventCounts.__unparsed__ = eventCounts.__unparsed__ ?? 0; } catch { eventCounts.__unparsed__ = (eventCounts.__unparsed__ ?? 0) + 1; return; } // 비JSON 잡음 무시
        lastEventType = String(ev.type ?? '');
        eventCounts[lastEventType] = (eventCounts[lastEventType] ?? 0) + 1;
        if (ev.type === 'stream_event') {
          const inner = (ev as { event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } } }).event;
          if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
            deltaText += inner.delta.text;
            lastDeltaAt = Date.now();
            params.onDelta?.(inner.delta.text);
          }
        } else if (ev.type === 'result') {
          result = ev as CliResult;
        }
      });

      // 판정은 **자식 종료와 stdout 읽기 종료가 모두 끝난 뒤**에 한다(2026-09-15).
      // 종전엔 child 'close' 에서 바로 판정해, 마지막 결과 줄이 아직 readline 큐에 있으면 놓칠 수 있었다.
      // 재현은 안 됐지만 가능성을 없애고, 그래도 놓쳤다면 linesAfterChildClose 가 그 사실을 증언한다.
      const decide = () => {
        if (!childClosed || !rlClosed) return;
        const code = exitCode;
        cleanup();
        if (settled) return;
        if (!result) {
          // 결과 줄 없이 끝난 실패 — 진단 정보를 실어 준다(2026-09-04 실사고).
          //
          // 실측: 사과나무 리비전 런이 본문 3,400자를 정상 스트리밍한 뒤 48초 정적, exit=0,
          // result 줄 없음, stderr 비어 있음. 같은 호출을 손으로 재현하면 정상이라 원인을 못 좁혔다.
          //
          // 흘러온 부분 텍스트를 성공으로 회수하는 안을 검토했다가 접었다 — truncated 플래그를
          // 하류에서 아무도 안 본다(로그·지표에만 쓴다). 반쪽 기사가 조용히 SEO 리비전을 타고
          // 검토 대기까지 흘러가면, 실패가 보이던 지금보다 나쁘다. 실패는 실패로 두고, 대신
          // 다음에 같은 일이 나면 원인을 좁힐 수 있게 '얼마나 받았고 얼마나 조용했는지'를 남긴다.
          const got = deltaText.trim().length;
          const quietSec = Math.round((Date.now() - lastDeltaAt) / 1000);
          const detail = got ? `본문 ${got}자 수신 후 ${quietSec}초 무응답` : '수신 없음';
          const info: CliFailureInfo = {
            model, exitCode: code, exitSignal, elapsedMs: Date.now() - t0, gotChars: got, quietSec,
            lines, linesAfterChildClose: linesAtChildClose >= 0 ? lines - linesAtChildClose : 0,
            endsWithNewline: rawTail.endsWith('\n'), eventCounts, lastEventType,
            promptChars: prompt.length, systemChars: (system ?? '').length, maxTokens,
            stderrTail: stderrTail.slice(-2000), rawTail,
          };
          const dump = writeCliFailureDump(info);
          console.log('[claude-cli]', `결과 줄 없이 종료 — ${diagnoseCliFailure(info)}${dump ? ` · 진단 기록 ${dump}` : ''}`);
          return fail(`결과 없음(exit=${code}) ${detail} ${stderrTail.trim()}`.trim());
        }
        if (result.is_error || result.subtype !== 'success') {
          // 출력 상한 초과 — CLI 는 오류로 반환하지만 스트리밍된 부분 텍스트가 있으면 SDK 절단
          // 계약(text + truncated)으로 회수한다(마이크로 콜 하나 때문에 런 전체가 죽지 않게).
          const emsg = String(result.result ?? '');
          if (/exceeded the \d+ output token maximum/i.test(emsg) && deltaText.trim()) {
            settled = true;
            const inTok = result.usage?.input_tokens ?? 0;
            const outTok = result.usage?.output_tokens ?? 0;
            recordUsage(model, inTok, outTok, result.usage?.cache_read_input_tokens ?? 0);
            return resolve({
              text: deltaText.trim(), model,
              promptEvalCount: inTok, evalCount: outTok,
              totalDurationMs: Date.now() - t0, loadDurationMs: 0,
              truncated: true, doneReason: 'max_tokens',
            });
          }
          return fail(`${result.subtype ?? 'error'} — ${(result.result ?? stderrTail).slice(0, 500)}`.trim());
        }
        settled = true;
        const inTok = result.usage?.input_tokens ?? 0;
        const outTok = result.usage?.output_tokens ?? 0;
        const cacheRead = result.usage?.cache_read_input_tokens ?? 0;
        recordUsage(model, inTok, outTok, cacheRead);
        const stopReason = result.stop_reason ?? '';
        resolve({
          text: (result.result ?? deltaText).trim(),
          model,
          promptEvalCount: inTok,
          evalCount: outTok,
          totalDurationMs: Date.now() - t0,
          loadDurationMs: 0,
          truncated: stopReason === 'max_tokens',
          doneReason: stopReason || (result.subtype ?? ''),
        });
      };
      child.on('close', (code, signal) => {
        exitCode = code; exitSignal = signal; childClosed = true; linesAtChildClose = lines;
        decide();
      });
      rl.on('close', () => { rlClosed = true; decide(); });

      // 런 취소(abort→SIGKILL) 직후 stdin 에 쓰면 EPIPE 가 'error' 이벤트로 올라오는데, 핸들러가 없으면
      // 프로세스 전체가 죽는다(2026-08-27 실사고 — 취소 한 번에 서버 다운). 삼키고 fail 로만 정리한다.
      child.stdin.on('error', (e: NodeJS.ErrnoException) => { if (e?.code !== 'EPIPE') fail(`stdin ${e?.code ?? e?.message ?? 'error'}`); });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

export const claudeCli = new ClaudeCliClient();
