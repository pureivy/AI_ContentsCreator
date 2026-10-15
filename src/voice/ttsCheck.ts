/**
 * 낭독 수종명 발음 확인(2026-10-02) — 씬 낭독을 로컬 STT 로 받아 적어, 수종명이 안 들리면 다시 합성한다.
 *
 * 경위. ElevenLabs(eleven_multilingual_v2, 속도 1.2)가 같은 편 안에서 "배롱나무"를 두 씬만 [배록나무]·[배럭나무]로
 * 읽었다 — 나머지 씬은 멀쩡했다. 잎·봉오리처럼 늘 틀리는 낱말은 sanitizeForTts 표기 보정으로 막지만, 이건
 * 확률적이라 표기로는 못 막는다. 같은 설정으로 다시 합성하면 대개 바로 읽는다.
 *
 * 규칙. 첫 테이크를 받아 적어 이름이 다 들리면 그대로 쓴다. 아니면 같은 옵션으로 최대 2번 더 합성해 이름이
 * 들린 첫 테이크를 쓴다. 끝까지 안 들리면 1번째를 지킨다 — 드문 이름은 바르게 읽어도 STT 가 다르게 적는다
 * (이팝나무→이팟나무). 그래서 재시도에 상한을 두고, 마지막 테이크가 아니라 1번째로 돌아간다.
 *
 * fail-open. STT 가 실패·시간 초과하면 그 테이크를 통과로 친다. 재합성이 실패하면 1번째를 쓴다. 어느 쪽도 씬이나
 * 작업을 죽이지 않는다. STT 에는 이름·내레이션·프롬프트를 절대 넘기지 않는다 — 들은 것을 이름 쪽으로 끌어당겨
 * 정작 잘못 읽은 걸 가린다.
 */
import { transcribe } from './stt';

/** 테이크 상한 — 1번째 + 재합성 2회. */
export const TTS_CHECK_MAX_TAKES = 3;
/** 씬 하나 받아쓰기 상한 — 실측 2~3초(whisper-large-v3-turbo, 5초 남짓 씬). 넘기면 통과로 친다. */
export const TTS_CHECK_STT_TIMEOUT_MS = 45_000;

/** 받아쓴 글에 없는 이름(순수) — 양쪽 공백을 지우고 글자 그대로 찾는다. */
export function missingNames(names: readonly string[], transcript: string): string[] {
  const t = String(transcript ?? '').replace(/\s+/g, '');
  return names.filter((n) => !t.includes(n.replace(/\s+/g, '')));
}

/** pass=1번째 통과 · recovered=재합성으로 회복 · miss=끝까지 미검출(1번째 유지) · stt-error=받아쓰기 실패(그 테이크 통과). */
export type TakeOutcome = 'pass' | 'recovered' | 'miss' | 'stt-error';
export type TakeDecision =
  | { done: false }
  | { done: true; take: number; outcome: TakeOutcome };

/**
 * 다음 행동 판정(순수). transcripts[i] 는 i번째 테이크(0부터)의 받아쓰기, null 은 STT 실패.
 * 앞 테이크부터 보며 이름이 다 들린 첫 테이크를 쓴다. STT 가 실패한 테이크는 통과로 치고 그 테이크를 쓴다 —
 * 1번째가 미검출이고 2번째 받아쓰기가 실패했으면 2번째를 쓴다(미검출이 확인된 1번째보다는 낫다).
 * 상한 전이면 더 합성하고, 상한까지 다 미검출이면 1번째를 지킨다.
 */
export function decideTake(
  names: readonly string[],
  transcripts: ReadonlyArray<string | null>,
  maxTakes = TTS_CHECK_MAX_TAKES,
): TakeDecision {
  for (let i = 0; i < transcripts.length; i++) {
    const tr = transcripts[i];
    if (tr === null || tr === undefined) return { done: true, take: i, outcome: 'stt-error' };
    if (!missingNames(names, tr).length) return { done: true, take: i, outcome: i === 0 ? 'pass' : 'recovered' };
  }
  if (transcripts.length < maxTakes) return { done: false };
  return { done: true, take: 0, outcome: 'miss' };
}

/** 발음 확인용 받아쓰기 — 언어만 지정한다. 이름·내레이션·초기 프롬프트는 넘기지 않는다(받아쓰기를 끌어당긴다). */
export function transcribeTake(mp3: Buffer, signal?: AbortSignal): Promise<string> {
  return transcribe(mp3, { lang: 'ko', signal, timeoutMs: TTS_CHECK_STT_TIMEOUT_MS });
}

export interface CheckedTake {
  mp3: Buffer;
  /** 쓴 테이크(0부터). */
  take: number;
  /** tts-error=재합성 실패로 1번째 유지 · aborted=취소돼 재합성 안 함(1번째 유지). */
  outcome: TakeOutcome | 'tts-error' | 'aborted';
  /** 1번째 테이크에서 안 들린 이름(1번째 통과·받아쓰기 실패면 빈 배열). */
  missing: string[];
  /** 1번째 테이크 받아쓰기(실패면 null) — 로그용. */
  heard: string | null;
  /** 합성한 테이크 수. */
  takes: number;
}

/**
 * 합성 → 받아쓰기 → 판정 고리. synth 는 매번 같은 옵션으로 합성하는 함수(호출부가 묶어 넘긴다).
 * 1번째 합성 실패는 그대로 던진다 — 호출부의 종전 처리(무음)를 그대로 탄다.
 */
export async function synthesizeChecked(
  synth: () => Promise<Buffer>,
  names: readonly string[],
  opts: { signal?: AbortSignal; stt?: (mp3: Buffer, signal?: AbortSignal) => Promise<string>; maxTakes?: number } = {},
): Promise<CheckedTake> {
  const stt = opts.stt ?? transcribeTake;
  const takes: Buffer[] = [await synth()];
  const transcripts: Array<string | null> = [];
  const result = (take: number, outcome: CheckedTake['outcome']): CheckedTake => {
    const heard = transcripts[0] ?? null;
    return { mp3: takes[take]!, take, outcome, missing: heard === null ? [] : missingNames(names, heard), heard, takes: takes.length };
  };
  for (;;) {
    // 빈 받아쓰기(결과 파일 없음 등)는 STT 실패로 친다(2026-10-16 ADLER 쪽 수정 이식) — 종전엔 '이름 미검출'로 읽혀 재합성 2회(TTS 글자 3배)를 태웠다.
    transcripts.push(await stt(takes[takes.length - 1]!, opts.signal).then((t) => (String(t ?? '').trim() ? t : null), () => null));
    const d = decideTake(names, transcripts, opts.maxTakes);
    if (d.done) return result(d.take, d.outcome);
    if (opts.signal?.aborted) return result(0, 'aborted');
    try { takes.push(await synth()); } catch { return result(0, opts.signal?.aborted ? 'aborted' : 'tts-error'); }
  }
}

/**
 * 잘 안 들리는 이름(순수, 2026-10-16 ADLER 쪽 수정 이식) — 끝까지 미검출(miss)이거나 재합성으로야 들린(recovered) 이름. 이 편 나머지 씬에서는
 * 확인하지 않는다(같은 이름이 씬마다 다시 3회 합성을 태우지 않게). 1번째 통과·STT 실패 등은 빈 목록.
 */
export function hardToHear(r: Pick<CheckedTake, 'outcome' | 'missing'>): string[] {
  return r.outcome === 'miss' || r.outcome === 'recovered' ? [...r.missing] : [];
}

/** 로그 한 줄(순수) — 1번째 통과면 null(조용히). scene 은 1부터. */
export function ttsCheckNote(scene: number, r: CheckedTake): string | null {
  const names = r.missing.map((n) => `"${n}"`).join('·');
  switch (r.outcome) {
    case 'pass': return null;
    case 'recovered': return `씬${scene} 발음 재합성 — ${names} 미검출 → ${r.take + 1}번째 테이크 채택`;
    case 'miss': return `씬${scene} 발음 확인 실패(STT 어휘) — ${names} ${r.takes}회 미검출(받아쓰기 "${(r.heard ?? '').replace(/\s+/g, ' ').slice(0, 30)}") → 1번째 유지`;
    case 'stt-error': return `씬${scene} 발음 확인 STT 실패 — ${r.take + 1}번째 테이크 그대로 사용`;
    case 'tts-error': return `씬${scene} 발음 재합성 실패(TTS) — ${names} 미검출인 1번째 유지`;
    case 'aborted': return `씬${scene} 발음 재합성 중단(취소) — 1번째 유지`;
  }
}
