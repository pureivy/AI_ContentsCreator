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
  // 발화 첫머리 "잎" 오독 보정(실측 2026-08-07) — ElevenLabs(multilingual v2)가 발화 시작의 "잎"을
  // 로마자 ip 로 읽어 "아이피"가 됐다(쇼츠 보리수 편 씬3 "잎 뒷면"·씬6 "잎과" STT 재현. 문장 중간은
  // 정상, previous_text·language_code 는 실측상 무효). 종성 중화로 발음이 동일한 "입"으로 치환하되,
  // 모음 조사(잎이[이피]≠입이[이비])는 발음이 달라지므로 제외 — 실측상 그 경우는 오독도 없다.
  // 자막·본문은 원문 유지(이 함수는 TTS 입력 전용).
  t = t.replace(/^잎(?=$|\s|[과도만]|보다|처럼|부터|까지|조차|마저)/, '입');
  // "봉오리" 오독 보정(실측 2026-08-07) — ElevenLabs 가 위치 무관하게 [봉고리]로 읽는다(배롱나무 개화시기
  // 쇼츠 씬3·4, 복합어 꽃봉오리 포함 STT 재현). 하이픈 경계("봉-오리")가 발음 [봉오리]를 복원하고
  // 재생 길이가 원문과 동일(쉼 없음). 후보 실측: 띄어쓰기=어절 분리, 제로폭 공백=된소리화,
  // 아포스트로피=5회 중 1회 된소리 이탈, 하이픈=4회 전부 정상. 자막·본문은 원문 유지.
  t = t.replace(/봉오리/g, '봉-오리');
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
