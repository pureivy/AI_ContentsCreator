import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { audio } from './audio';
import {
  missingNames, decideTake, synthesizeChecked, transcribeTake, ttsCheckNote, hardToHear,
  TTS_CHECK_STT_TIMEOUT_MS, type CheckedTake,
} from './ttsCheck';

afterEach(() => vi.restoreAllMocks());

const N = ['배롱나무'];

describe('missingNames — 받아쓰기에 이름이 들렸나', () => {
  it('들리면 빈 배열, 다르게 적혔으면 그 이름', () => {
    expect(missingNames(N, '배롱나무 전정은 잎이 떨어진 뒤로 미룹니다.')).toEqual([]);
    expect(missingNames(N, '이 배록나무에 가지를 쳐도 될까요?')).toEqual(['배롱나무']);
    expect(missingNames(N, '배럭나무')).toEqual(['배롱나무']);
  });
  it('양쪽 공백을 지우고 본다 — "배롱 나무"로 적혀도 들린 것이다', () => {
    expect(missingNames(N, '이 배롱 나무, 가지를')).toEqual([]);
    expect(missingNames(['사계성 장미'], '사계성장미는')).toEqual([]);
  });
  it('여러 이름은 각각 본다', () => {
    expect(missingNames(['배롱나무', '이팝나무'], '배롱나무와 이팟나무')).toEqual(['이팝나무']);
  });
});

describe('decideTake — 어느 테이크를 쓰나(순수)', () => {
  it('1번째에 다 들리면 그대로(재합성 없음)', () => {
    expect(decideTake(N, ['배롱나무 전정'])).toEqual({ done: true, take: 0, outcome: 'pass' });
  });
  it('1번째 미검출 → 더 합성한다', () => {
    expect(decideTake(N, ['배록나무'])).toEqual({ done: false });
    expect(decideTake(N, ['배록나무', '배럭나무'])).toEqual({ done: false });
  });
  it('2번째·3번째에 들리면 그 테이크', () => {
    expect(decideTake(N, ['배록나무', '배롱나무'])).toEqual({ done: true, take: 1, outcome: 'recovered' });
    expect(decideTake(N, ['배록나무', '배럭나무', '배롱나무'])).toEqual({ done: true, take: 2, outcome: 'recovered' });
  });
  it('3번 다 미검출이면 마지막이 아니라 1번째를 지킨다 — STT 어휘 한계(이팝나무→이팟나무)', () => {
    expect(decideTake(['이팝나무'], ['이팟나무', '이팟나무', '이팟나무'])).toEqual({ done: true, take: 0, outcome: 'miss' });
  });
  it('STT 실패는 통과 — 1번째면 재합성 없이 1번째', () => {
    expect(decideTake(N, [null])).toEqual({ done: true, take: 0, outcome: 'stt-error' });
  });
  it('1번째 미검출 뒤 2번째 받아쓰기가 실패하면 2번째를 쓰고 멈춘다', () => {
    expect(decideTake(N, ['배록나무', null])).toEqual({ done: true, take: 1, outcome: 'stt-error' });
  });
  it('받아쓰기가 아직 없으면 1번째를 기다린다', () => {
    expect(decideTake(N, [])).toEqual({ done: false });
  });
});

/** 합성 n번째 → Buffer('take{n}'), 받아쓰기는 테이크별 표에서. */
function fakes(heard: Record<string, string | Error>) {
  let n = 0;
  const synth = vi.fn(async () => Buffer.from(`take${++n}`));
  const stt = vi.fn(async (mp3: Buffer) => {
    const h = heard[mp3.toString()];
    if (h instanceof Error) throw h;
    return h ?? '';
  });
  return { synth, stt };
}

describe('synthesizeChecked — 합성·받아쓰기·판정 고리', () => {
  it('1번째 통과면 합성·받아쓰기 각 1번', async () => {
    const { synth, stt } = fakes({ take1: '배롱나무 전정은' });
    const r = await synthesizeChecked(synth, N, { stt });
    expect(r.mp3.toString()).toBe('take1');
    expect(r.outcome).toBe('pass');
    expect(synth).toHaveBeenCalledTimes(1);
    expect(stt).toHaveBeenCalledTimes(1);
  });
  it('2번째에 회복하면 2번째 테이크를 쓰고 더 합성하지 않는다', async () => {
    const { synth, stt } = fakes({ take1: '이 배록나무에', take2: '이 배롱나무에' });
    const r = await synthesizeChecked(synth, N, { stt });
    expect(r.mp3.toString()).toBe('take2');
    expect(r).toMatchObject({ take: 1, outcome: 'recovered', missing: ['배롱나무'], takes: 2 });
    expect(synth).toHaveBeenCalledTimes(2);
  });
  it('끝까지 미검출이면 합성은 3번이 상한이고 1번째를 쓴다', async () => {
    const { synth, stt } = fakes({ take1: '이팟나무', take2: '이팟나무', take3: '이팟나무' });
    const r = await synthesizeChecked(synth, ['이팝나무'], { stt });
    expect(r.mp3.toString()).toBe('take1');
    expect(r).toMatchObject({ take: 0, outcome: 'miss', missing: ['이팝나무'], heard: '이팟나무', takes: 3 });
    expect(synth).toHaveBeenCalledTimes(3);
    expect(stt).toHaveBeenCalledTimes(3);
  });
  it('STT 가 던지면 통과 — 1번째를 쓰고 재합성하지 않는다(fail-open)', async () => {
    const { synth, stt } = fakes({ take1: new Error('mlx_whisper 신호종료(SIGKILL)') });
    const r = await synthesizeChecked(synth, N, { stt });
    expect(r.mp3.toString()).toBe('take1');
    expect(r).toMatchObject({ outcome: 'stt-error', missing: [], heard: null });
    expect(synth).toHaveBeenCalledTimes(1);
  });
  it('재합성이 실패하면 1번째를 쓴다', async () => {
    let n = 0;
    const synth = vi.fn(async () => { if (++n > 1) throw new Error('ElevenLabs 429'); return Buffer.from('take1'); });
    const stt = vi.fn(async () => '배록나무');
    const r = await synthesizeChecked(synth, N, { stt });
    expect(r.mp3.toString()).toBe('take1');
    expect(r.outcome).toBe('tts-error');
    expect(synth).toHaveBeenCalledTimes(2);
  });
  it('1번째 합성 실패는 그대로 던진다 — 호출부의 무음 처리를 탄다', async () => {
    const synth = vi.fn(async (): Promise<Buffer> => { throw new Error('TTS 다운'); });
    const stt = vi.fn(async () => '');
    await expect(synthesizeChecked(synth, N, { stt })).rejects.toThrow('TTS 다운');
    expect(stt).not.toHaveBeenCalled();
  });
  it('취소되면 재합성하지 않고 1번째를 쓴다', async () => {
    const ac = new AbortController();
    const { synth } = fakes({});
    const stt = vi.fn(async () => { ac.abort(); return '배록나무'; });
    const r = await synthesizeChecked(synth, N, { stt, signal: ac.signal });
    expect(r.mp3.toString()).toBe('take1');
    expect(r.outcome).toBe('aborted');
    expect(synth).toHaveBeenCalledTimes(1);
  });
  it('재합성 도중 취소돼 던지면 TTS 실패가 아니라 취소로 적는다', async () => {
    const ac = new AbortController();
    let n = 0;
    const synth = vi.fn(async () => { if (++n > 1) { ac.abort(); throw new Error('aborted'); } return Buffer.from('take1'); });
    const stt = vi.fn(async () => '배록나무');
    const r = await synthesizeChecked(synth, N, { stt, signal: ac.signal });
    expect(r.mp3.toString()).toBe('take1');
    expect(r.outcome).toBe('aborted');
  });
});

describe('transcribeTake — STT 에 이름·내레이션을 넘기지 않는다', () => {
  it('mlx_whisper 인자는 언어·모델·출력뿐이고, 상한은 발음 확인용 짧은 값', async () => {
    const spy = vi.spyOn(audio, 'run').mockImplementation(async (bin, args) => {
      if (bin === 'mlx_whisper') {
        const dir = args[args.indexOf('--output-dir') + 1]!;
        const base = path.basename(args[0]!).replace(/\.[^.]+$/, '');
        fs.writeFileSync(path.join(dir, `${base}.txt`), '이 배록나무에 가지를 쳐도 될까요?');
      }
      return { stdout: Buffer.from(''), code: 0 };
    });
    expect(await transcribeTake(Buffer.from('fake-mp3'))).toBe('이 배록나무에 가지를 쳐도 될까요?');
    const call = spy.mock.calls.find((c) => c[0] === 'mlx_whisper')!;
    const args = call[1];
    expect(args[args.indexOf('--language') + 1]).toBe('ko');
    expect(args.some((a) => /prompt/i.test(a))).toBe(false);
    expect(args.join(' ')).not.toMatch(/[가-힣]/); // 이름·내레이션이 인자로 새지 않는다
    expect(call[2]?.timeoutMs).toBe(TTS_CHECK_STT_TIMEOUT_MS);
  });
});

describe('ttsCheckNote — 로그 한 줄', () => {
  const base: CheckedTake = { mp3: Buffer.from(''), take: 0, outcome: 'pass', missing: [], heard: '배롱나무', takes: 1 };
  it('1번째 통과는 조용하다', () => {
    expect(ttsCheckNote(2, base)).toBeNull();
  });
  it('회복·미검출·실패를 한 줄로', () => {
    expect(ttsCheckNote(2, { ...base, take: 1, outcome: 'recovered', missing: ['배롱나무'], heard: '이 배록나무에', takes: 2 }))
      .toBe('씬2 발음 재합성 — "배롱나무" 미검출 → 2번째 테이크 채택');
    expect(ttsCheckNote(4, { ...base, outcome: 'miss', missing: ['이팝나무'], heard: '이팟나무는 5월에', takes: 3 }))
      .toBe('씬4 발음 확인 실패(STT 어휘) — "이팝나무" 3회 미검출(받아쓰기 "이팟나무는 5월에") → 1번째 유지');
    expect(ttsCheckNote(1, { ...base, outcome: 'stt-error', heard: null })).toBe('씬1 발음 확인 STT 실패 — 1번째 테이크 그대로 사용');
    expect(ttsCheckNote(3, { ...base, outcome: 'tts-error', missing: ['배롱나무'], takes: 2 })).toBe('씬3 발음 재합성 실패(TTS) — "배롱나무" 미검출인 1번째 유지');
  });
});

// 2026-10-16 ADLER 쪽 수정 이식 — 빈 받아쓰기는 STT 실패, 재합성으로야 들린 이름도 나머지 씬 확인 생략.
describe('빈 받아쓰기·잘 안 들리는 이름', () => {
  it('빈 받아쓰기는 STT 실패 — 다시 합성하지 않고 그 테이크를 쓴다', async () => {
    const synth = vi.fn(async () => Buffer.from('take1'));
    const stt = vi.fn(async () => '   ');
    const r = await synthesizeChecked(synth, N, { stt });
    expect(r.outcome).toBe('stt-error');
    expect(synth).toHaveBeenCalledTimes(1);
  });
  it('hardToHear — miss·recovered 만', () => {
    expect(hardToHear({ outcome: 'recovered', missing: ['배롱나무'] })).toEqual(['배롱나무']);
    expect(hardToHear({ outcome: 'miss', missing: ['이팝나무'] })).toEqual(['이팝나무']);
    expect(hardToHear({ outcome: 'pass', missing: [] })).toEqual([]);
    expect(hardToHear({ outcome: 'stt-error', missing: [] })).toEqual([]);
  });
});
