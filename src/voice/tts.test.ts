import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { audio } from './audio';
import { synthesize, listKoreanVoices } from './tts';

afterEach(() => vi.restoreAllMocks());

describe('synthesize', () => {
  it('say(-v voice -o aiff text)→ffmpeg(mp3) 순서로 호출하고 mp3 버퍼를 반환한다', async () => {
    const spy = vi.spyOn(audio, 'run').mockImplementation(async (bin, args) => {
      if (bin === 'ffmpeg') {
        const out = args[args.length - 1]!;          // 마지막 인자 = mp3 출력경로
        fs.writeFileSync(out, Buffer.from([0x49, 0x44, 0x33])); // 'ID3'
      }
      return { stdout: Buffer.from(''), code: 0 };
    });
    const buf = await synthesize('**안녕** 하세요', { voice: 'Yuna' });
    expect(buf.slice(0, 3).toString()).toBe('ID3');
    const sayArgs = spy.mock.calls[0]![1];
    expect(spy.mock.calls[0]![0]).toBe('say');
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
