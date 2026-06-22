/** 음성 외부 바이너리(ffmpeg·mlx_whisper·say) 단일 캡슐화 — async spawn(비블로킹) + 순수 헬퍼.
 *  외부 호출을 audio.run 한 곳에 모아 테스트에서 vi.spyOn(audio,'run') 가능하게 한다. */
import { spawn, execFileSync } from 'node:child_process';

export interface RunResult { stdout: Buffer; code: number }

export const audio = {
  /** 외부 바이너리 실행(async). stdin=opts.input, stdout 캡처. 0 아님/error 시 reject. */
  run(bin: string, args: string[], opts: { input?: Buffer; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(bin, args, { shell: false, signal: opts.signal });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 120_000);
      timer.unref();
      child.stdout?.on('data', (d: Buffer) => chunks.push(d));
      child.stderr?.on('data', (d: Buffer) => errChunks.push(d));
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout: Buffer.concat(chunks), code: 0 });
        else {
          const stderr = Buffer.concat(errChunks).toString('utf-8').slice(0, 500);
          if (code !== null) {
            reject(new Error(`${bin} 종료코드 ${code}: ${stderr}`));
          } else {
            reject(new Error(`${bin} 신호종료(${signal}): ${stderr}`));
          }
        }
      });
      if (opts.input) { child.stdin?.write(opts.input); child.stdin?.end(); }
    });
  },
  /** PATH 에서 바이너리 존재 여부(동기, 가용성 체크용). */
  which(bin: string): boolean {
    try { execFileSync('which', [bin], { stdio: ['ignore', 'ignore', 'ignore'] }); return true; }
    catch { return false; }
  },
};

/** TTS 낭독용 텍스트 정제: 마크다운/링크/이모지 제거, 공백 정리, 길이 상한. */
export function sanitizeForTts(text: string, maxLen = 4000): string {
  let t = text ?? '';
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');           // [라벨](url) -> 라벨
  t = t.replace(/[*_`#>~|]/g, ' ');                          // 마크다운 기호
  t = t.replace(/https?:\/\/\S+/g, ' ');                     // 남은 URL
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, ' '); // 이모지/기호
  t = t.replace(/\s+/g, ' ').trim();
  return t.slice(0, maxLen);
}

/** `say -v '?'` 출력 파싱 → ko_KR 음성 이름 목록(괄호 앞 토큰). */
export function parseSayVoices(raw: string): string[] {
  const out: string[] = [];
  for (const line of (raw ?? '').split('\n')) {
    if (!/\bko_KR\b/.test(line)) continue;
    const name = line.trim().split(/\s{2,}|\s\(/)[0]?.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
