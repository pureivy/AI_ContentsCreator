import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { ensureNeutralCwd, diagnoseCliFailure, isNoResultFailure } from './claudeCli';

// 실사고(2026-08-10 13:21): 상주 서버 가동 중 macOS 임시폴더 청소가 중립 cwd 를 지워 이후 모든
// claude spawn 이 ENOENT 로 죽었다 — Node 는 cwd 부재도 실행 파일 부재와 같은 "spawn claude ENOENT"
// 로 보고해 "CLI 설치/PATH 확인"으로 오독된다. 부팅 1회 mkdir 로는 부족하고 spawn 직전 보장이 필요.
describe('ensureNeutralCwd — 중립 cwd 자가 치유', () => {
  it('삭제된 디렉토리를 다음 호출에서 다시 만든다', () => {
    const dir = ensureNeutralCwd();
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(fs.existsSync(dir)).toBe(false);
    expect(ensureNeutralCwd()).toBe(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

// 실사고(2026-08-31 08:55~10:55): 데스크탑 런처(scripts/launcher/start.sh)로 띄운 서버의 PATH 에
// ~/.local/bin 이 없어 spawn('claude') 이 전부 ENOENT — 오토런 틱이 2시간 동안 "처리할 작업 없음"만
// 남기고 침묵했다(proposeContentIdeas 가 microJSON 실패를 삼키고 무로그 return null). LaunchServices
// 경유 부팅은 PATH 가 /usr/bin:/bin:/usr/sbin:/sbin 로 축소되므로 spawn PATH 를 코드에서 보강한다.
describe('cliSearchPath — spawn PATH 보강(런처 축소 PATH 방어)', () => {
  it('축소된 PATH 에 표준 사용자 bin 을 덧붙인다', async () => {
    const { cliSearchPath } = await import('./claudeCli');
    const out = cliSearchPath('/usr/bin:/bin', '/Users/tester').split(':');
    expect(out).toContain('/Users/tester/.local/bin');
    expect(out).toContain('/opt/homebrew/bin');
    expect(out).toContain('/usr/local/bin');
  });

  it('기존 PATH 항목과 그 순서를 앞쪽에 그대로 보존한다(보강은 뒤에만)', async () => {
    const { cliSearchPath } = await import('./claudeCli');
    const out = cliSearchPath('/first:/second', '/Users/tester').split(':');
    expect(out.slice(0, 2)).toEqual(['/first', '/second']);
  });

  it('이미 있는 디렉토리는 중복 추가하지 않는다', async () => {
    const { cliSearchPath } = await import('./claudeCli');
    const out = cliSearchPath('/Users/tester/.local/bin:/usr/bin', '/Users/tester').split(':');
    expect(out.filter((p) => p === '/Users/tester/.local/bin')).toHaveLength(1);
  });

  it('빈 PATH 여도 보강 목록만으로 유효한 경로를 만든다', async () => {
    const { cliSearchPath } = await import('./claudeCli');
    const out = cliSearchPath('', '/Users/tester').split(':').filter(Boolean);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('/Users/tester/.local/bin');
  });
});

// 무음 실패 방지 — CLI 를 못 찾는 상태로 뜨면 부팅 로그에서 즉시 드러나야 한다(위 실사고의 2차 원인).
describe('claudeCliProblem — 부팅 점검', () => {
  it('PATH 어디에도 없는 실행 파일이면 사유 문자열을 돌려준다', async () => {
    const { claudeCliProblem } = await import('./claudeCli');
    expect(claudeCliProblem('claude-does-not-exist-xyz', '/nonexistent-dir')).toMatch(/PATH/);
  });

  it('존재하는 절대 경로면 null(문제 없음)', async () => {
    const { claudeCliProblem } = await import('./claudeCli');
    expect(claudeCliProblem('/bin/sh', '')).toBeNull();
  });

  it('없는 절대 경로면 사유를 돌려준다', async () => {
    const { claudeCliProblem } = await import('./claudeCli');
    expect(claudeCliProblem('/nonexistent/claude', '')).toBeTruthy();
  });
});

// 결과 줄 없이 끝나는 실패(2026-09-15 실측 3건 — 전부 SEO 리비전 런·opus·exit=0·stderr 빈값).
// 손으로 재현이 안 돼, 다음번에 원인을 좁히도록 '끝에 무엇이 왔는지'를 한 줄 진단으로 남긴다.
describe('diagnoseCliFailure — 결과 줄 없는 종료의 첫 갈래', () => {
  const base = { linesAfterChildClose: 0, endsWithNewline: true, lines: 120, exitSignal: null as string | null };
  it('자식 종료 뒤에도 줄이 더 왔으면 우리 쪽 읽기 경합', () => {
    expect(diagnoseCliFailure({ ...base, linesAfterChildClose: 3 })).toContain('경합');
  });
  it('시그널 종료면 외부 종료 — 경합보다 뒤, 잘림보다 앞', () => {
    expect(diagnoseCliFailure({ ...base, exitSignal: 'SIGKILL', endsWithNewline: false })).toContain('시그널');
  });
  it('원문이 줄바꿈 없이 끝났으면 출력이 줄 도중에 끊긴 것', () => {
    expect(diagnoseCliFailure({ ...base, endsWithNewline: false })).toContain('줄 도중에 끊김');
  });
  it('한 줄도 없었으면 기동 직후 종료', () => {
    expect(diagnoseCliFailure({ ...base, lines: 0 })).toContain('한 줄도');
  });
  it('전부 정상인데 결과 줄만 없으면 원인 미상으로 명시', () => {
    expect(diagnoseCliFailure(base)).toContain('원인 미상');
  });
});

// 실사고(2026-10-15): 유튜브 숏폼 대본이 944자 받은 뒤 결과 줄 없이 끝나 편 전체가 실패 — 이런 실패만 한 번 다시 부른다.
describe('isNoResultFailure — 다시 부를 실패만 고른다', () => {
  it('결과 줄 없이 정상 종료(exit=0)는 대상', () => {
    expect(isNoResultFailure(new Error('Claude CLI claude-sonnet-5: 결과 없음(exit=0) 본문 944자 수신 후 0초 무응답'))).toBe(true);
    expect(isNoResultFailure(new Error('Claude CLI claude-opus-5: 결과 없음(exit=0) 수신 없음'))).toBe(true);
  });
  it('시그널 종료·타임아웃·중단·한도는 대상이 아니다', () => {
    expect(isNoResultFailure(new Error('Claude CLI claude-sonnet-5: 결과 없음(exit=null) 수신 없음'))).toBe(false);
    expect(isNoResultFailure(new Error('Claude CLI claude-sonnet-5: 타임아웃(600000ms)'))).toBe(false);
    expect(isNoResultFailure(new Error('Claude CLI claude-sonnet-5: 중단됨(abort)'))).toBe(false);
    expect(isNoResultFailure(new Error("Claude CLI claude-haiku-4-5: success — You've hit your session limit"))).toBe(false);
  });
});
