import { describe, expect, it } from 'vitest';
import { agentEnv, agentResultOf, runProc, sceneAgentEnv } from './cliProc';

describe('cliProc', () => {
  it('runProc — 취소 신호가 오면 프로세스 그룹을 죽이고 aborted', async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    const p = runProc('bash', ['-c', 'sleep 20'], { timeoutMs: 30_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const r = await p;
    expect(r.aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
  it('runProc — 정상 종료는 출력 그대로', async () => {
    const r = await runProc('bash', ['-c', 'echo hi'], { timeoutMs: 10_000 });
    expect(r).toMatchObject({ code: 0, aborted: false });
    expect(r.stdout.trim()).toBe('hi');
  });
  it('sceneAgentEnv — 허용 목록만(.env 토큰·API 키·바깥 세션 표식 없음, 로캘 LC_* 는 둔다)', () => {
    expect(sceneAgentEnv({ PATH: '/bin', HOME: '/h', USER: 'u', LC_ALL: 'ko_KR.UTF-8', TELEGRAM_BOT_TOKEN: 't', NAVER_PW: 'p', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CODE_X: 'y', NODE_OPTIONS: '--require x' }))
      .toEqual({ PATH: '/bin', HOME: '/h', USER: 'u', LC_ALL: 'ko_KR.UTF-8' });
  });
  it('agentEnv — API 키·바깥 세션 표식을 뺀다', () => {
    expect(agentEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CODE_X: 'y' })).toEqual({ PATH: '/bin' });
  });
  it('agentResultOf — 마지막 result 줄', () => {
    expect(agentResultOf('{"type":"assistant"}\n{"type":"result","num_turns":7,"total_cost_usd":1.5}\nnoise')).toMatchObject({ num_turns: 7, total_cost_usd: 1.5 });
    expect(agentResultOf('x')).toBeNull();
  });
});
