import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { audio } from './audio';
import { CONFIG } from '../config';
import { synthesize, listKoreanVoices } from './tts';

// CONFIG 는 런타임 가변 객체(readonly 는 타입 힌트일 뿐) — 테스트에서 제공자/키를 강제하고 복원한다.
const cfg = CONFIG as unknown as { ttsProvider: string; openaiApiKey: string };
let origProvider: string;
let origKey: string;
beforeEach(() => { origProvider = cfg.ttsProvider; origKey = cfg.openaiApiKey; });
afterEach(() => { cfg.ttsProvider = origProvider; cfg.openaiApiKey = origKey; vi.restoreAllMocks(); });

describe('synthesize', () => {
  it('OpenAI 경로: /v1/audio/speech 를 호출하고 mp3 버퍼를 반환한다(텍스트 정제·instructions 전달)', async () => {
    cfg.ttsProvider = 'openai';
    cfg.openaiApiKey = 'sk-test'; // getSecret 이 비어도 CONFIG 폴백으로 키 존재
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Buffer.from([0xFF, 0xF3, 0x00]), { status: 200 }) as unknown as Response,
    );
    const sayRun = vi.spyOn(audio, 'run');
    const buf = await synthesize('**안녕** 하세요', { instructions: '활기차게 낭독' });
    expect([...buf.subarray(0, 2)]).toEqual([0xFF, 0xF3]); // mp3 프레임 헤더
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('/audio/speech');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.model).toBe(CONFIG.openaiTtsModel);
    expect(body.input).not.toContain('**'); // sanitizeForTts 로 마크다운 제거
    expect(body.instructions).toBe('활기차게 낭독');
    expect(sayRun).not.toHaveBeenCalled(); // OpenAI 성공 시 say 폴백 안 함
  });

  it('say 폴백: provider=say 면 say(-v voice -o aiff text)→ffmpeg(mp3) 순서로 호출한다', async () => {
    cfg.ttsProvider = 'say';
    const spy = vi.spyOn(audio, 'run').mockImplementation(async (bin, args) => {
      if (bin === 'ffmpeg') {
        const out = args[args.length - 1]!;                    // 마지막 인자 = mp3 출력경로
        fs.writeFileSync(out, Buffer.from([0x49, 0x44, 0x33])); // 'ID3'
      }
      return { stdout: Buffer.from(''), code: 0 };
    });
    const buf = await synthesize('**안녕** 하세요', { voice: 'Yuna' });
    expect(buf.subarray(0, 3).toString()).toBe('ID3');
    expect(spy.mock.calls[0]![0]).toBe('say');
    const sayArgs = spy.mock.calls[0]![1];
    expect(sayArgs).toContain('-v');
    expect(sayArgs).toContain('Yuna');
    expect(sayArgs[sayArgs.length - 1]).not.toContain('**'); // 정제됨
  });
});

describe('listKoreanVoices', () => {
  it('say -v ? 를 호출해 ko_KR 음성만 반환한다', async () => {
    vi.spyOn(audio, 'run').mockResolvedValue({
      stdout: Buffer.from('Alex  en_US  # hi\nYuna  ko_KR  # 안녕'), code: 0,
    });
    expect(await listKoreanVoices()).toContain('Yuna');
  });
});
