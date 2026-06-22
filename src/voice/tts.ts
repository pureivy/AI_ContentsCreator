/** 로컬 TTS — macOS say(-v Yuna -o aiff) → ffmpeg(mp3). audio.run 캡슐화 사용. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { audio, sanitizeForTts, parseSayVoices } from './audio';
import { getVoiceSettings } from './setting';

export function ttsAvailable(): boolean {
  return audio.which('say') && audio.which('ffmpeg');
}

export async function listKoreanVoices(): Promise<string[]> {
  try {
    const r = await audio.run('say', ['-v', '?'], { timeoutMs: 10_000 });
    return parseSayVoices(r.stdout.toString('utf-8'));
  } catch { return []; }
}

export async function synthesize(text: string, opts: { voice?: string; signal?: AbortSignal } = {}): Promise<Buffer> {
  const voice = opts.voice ?? getVoiceSettings().ttsVoice;
  const clean = sanitizeForTts(text);
  if (!clean) throw new Error('낭독할 텍스트가 비어 있음');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
  const aiff = path.join(dir, 'out.aiff');
  const mp3 = path.join(dir, 'out.mp3');
  try {
    await audio.run('say', ['-v', voice, '-o', aiff, clean], { signal: opts.signal, timeoutMs: 60_000 });
    await audio.run('ffmpeg', ['-nostdin', '-y', '-i', aiff, '-f', 'mp3', mp3], { signal: opts.signal, timeoutMs: 60_000 });
    return fs.readFileSync(mp3);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  }
}
