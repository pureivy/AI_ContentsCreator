import { describe, expect, it, vi } from 'vitest';
import type { FactGateResult } from '../content/factGate';
import { applyRevisions, CHARS_MAX, CHARS_MIN, factCheckScript, lengthSpec, TARGET_CHARS, normalizeScript, rewordForPronunciation, scriptProblems, segmentsForClaims, writeScript, type LlmJSON, type RawScript } from './writer';
import { scriptChars, type LongformScript } from './script';

const INV = { 사과나무: 40, 배나무: 12 };
const SRC = '사과나무는 잎이 진 뒤 심습니다. 배나무도 같습니다.';
const ctx = { inventory: INV, sourcePieceIds: ['piece_a', 'piece_b'], sourceText: SRC };

/** 장 n개 × 세그먼트 m개, 세그먼트당 공백 제외 약 k자. */
function raw(n = 6, m = 10, k = 60): RawScript {
  const sentence = `${'사과나무는 잎이 진 뒤 심습니다 '.repeat(8)}`.replace(/\s/g, '').slice(0, k);
  return {
    title: '사과나무 배나무 묘목 심기 총정리', ytKeyLine: '핵심', ytHashtags: ['#사과나무', '배나무', 'a', 'b', 'c', 'd'], keywords: ['잎', '사과나무'],
    species: ['사과나무', '배롱나무'],
    chapters: Array.from({ length: n }, (_, ci) => ({
      id: ci === 1 ? 'Apple Tree!' : `ch${ci}`, title: `장 제목 ${ci}`, ytLabel: `라벨 ${ci}`,
      species: ci === 1 ? ['사과나무'] : ci === 2 ? ['배롱나무'] : [],
      segments: Array.from({ length: m }, () => ({ narration: `${sentence}(괄호) 😀`, footage: ['사과나무', '없는수종'] })),
    })),
  };
}

describe('normalizeScript', () => {
  it('장 id 영문 소문자·세그먼트 id 재부여·재고 없는 수종 제거·괄호와 이모지 제거', () => {
    const s = normalizeScript(raw(), ctx);
    expect(s.chapters[1]!.id).toBe('appletree');
    expect(s.chapters[1]!.segments[0]!.id).toBe('appletree-01');
    expect(s.chapters[1]!.species).toEqual(['사과나무']);
    expect(s.chapters[2]!.species).toEqual([]); // 배롱나무 = 재고 0초 → 일반 장
    expect(s.species).toEqual(['사과나무']);
    expect(s.chapters[0]!.segments[0]!.footage).toEqual(['사과나무']);
    expect(s.chapters[0]!.segments[0]!.narration).not.toMatch(/[()😀]/);
    expect(s.ytHashtags).toEqual(['사과나무', '배나무', 'a', 'b', 'c']);
    expect(s.sourcePieceIds).toEqual(['piece_a', 'piece_b']);
    expect(s.bannedWords).toEqual([]);
  });
  it('비어 있으면 장이 없다', () => {
    expect(normalizeScript(null, ctx).chapters).toEqual([]);
  });
});

describe('writeScript — 분량 밖이면 문제를 짚어 다시 묻는다', () => {
  it('1차가 짧으면 2차를 묻고, 2차가 통과하면 그것을 쓴다', async () => {
    const calls: string[] = [];
    const llm = vi.fn(async (_m: string, _s: string, user: string) => { calls.push(user); return (calls.length === 1 ? raw(6, 5, 40) : raw(6, 10, 58)) as never; }) as unknown as LlmJSON;
    const r = await writeScript({ topicLabel: '묘목·심기', anchorTitle: '사과나무', sources: [{ pieceId: 'piece_a', title: 'a', body: SRC }], inventory: INV, month: 10, llmJSON: llm });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('지난 판의 문제');
    expect(r.attempts).toBe(2);
    expect(r.problems).toEqual([]);
    expect(scriptChars(r.script)).toBeGreaterThanOrEqual(CHARS_MIN);
  });
  it('끝까지 무응답이면 던진다', async () => {
    const llm = (async () => null) as unknown as LlmJSON;
    await expect(writeScript({ topicLabel: 'x', anchorTitle: 'x', sources: [], inventory: INV, month: 10, llmJSON: llm })).rejects.toThrow('대본 작성 실패');
  });
  it('scriptProblems — 장 수·분량', () => {
    const p = scriptProblems(normalizeScript(raw(4, 2, 30), ctx), SRC);
    expect(p.some((x) => x.includes('장 4개'))).toBe(true);
    expect(p.some((x) => x.includes('자(공백 제외)'))).toBe(true);
  });
});

describe('목표 길이(롱폼 주제 v2 짧은 편, 2026-10-23)', () => {
  it('lengthSpec — 10분은 종전 상수 그대로, 6분은 비율로 줄이고 장 4~6개', () => {
    expect(lengthSpec()).toEqual({ minutes: 10, target: TARGET_CHARS, min: CHARS_MIN, max: CHARS_MAX, chMin: 6, chMax: 8, segments: 95 });
    expect(lengthSpec(6)).toEqual({ minutes: 6, target: 2000, min: 1800, max: 2200, chMin: 4, chMax: 6, segments: 57 });
  });
  it('scriptProblems — 6분 기준이면 5장·약 2,000자가 통과, 10분 기준이면 걸린다', () => {
    const s = normalizeScript(raw(5, 7, 58), ctx);
    const lenProblem = (ps: string[]) => ps.filter((x) => x.includes('자(공백 제외)') || x.startsWith('장 '));
    expect(lenProblem(scriptProblems(s, SRC, lengthSpec(6)))).toEqual([]);
    expect(lenProblem(scriptProblems(s, SRC)).length).toBe(2);
  });
  it('writeScript(targetMinutes 6) — 지시문 길이·장 수가 6분 기준', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const llm = vi.fn(async (_m: string, system: string, user: string) => { calls.push({ system, user }); return raw(5, 7, 58) as never; }) as unknown as LlmJSON;
    const r = await writeScript({ topicLabel: '묘목·심기', anchorTitle: '사과나무', sources: [{ pieceId: 'piece_a', title: 'a', body: SRC }], inventory: INV, month: 10, llmJSON: llm, targetMinutes: 6 });
    expect(calls[0]!.system).toContain('6분짜리');
    expect(calls[0]!.user).toContain('약 2,000자(1,800~2,200자)');
    expect(calls[0]!.user).toContain('장 4~6개');
    expect(r.problems.filter((x) => x.includes('자(공백 제외)') || x.startsWith('장 '))).toEqual([]);
  });
});

const script = (): LongformScript => ({
  title: 't', sourcePieceIds: [],
  chapters: [
    { id: 'a', title: 'A', species: [], segments: [{ id: 'a-01', narration: '사과나무는 잎이 진 뒤 심습니다.' }, { id: 'a-02', narration: '사과나무는 하루에 물을 세 번 줍니다.' }] },
    { id: 'b', title: 'B', species: [], segments: [{ id: 'b-01', narration: '배나무도 같습니다.' }] },
  ],
});
const gate = (unsupported: string[]): FactGateResult => ({ status: unsupported.length ? 'hold' : 'pass', claims: [], unsupported, contradicted: [], unverified: [], repaired: false, checkedTs: '' });

describe('사실 확인', () => {
  it('segmentsForClaims — 주장을 가장 겹치는 문장에 붙인다', () => {
    expect([...segmentsForClaims(script(), ['사과나무에 하루 물 세 번']).keys()]).toEqual(['a-02']);
  });
  it('applyRevisions — 빈 문자열이면 빼고, 빈 장은 장째 뺀다', () => {
    const s = applyRevisions(script(), new Map([['b-01', ''], ['a-01', '고친 문장']]));
    expect(s.chapters).toHaveLength(1);
    expect(s.chapters[0]!.segments[0]!.narration).toBe('고친 문장');
  });
  it('factCheckScript — 근거 없는 문장은 고쳐 쓰고 다시 확인, 그래도 걸리면 뺀다', async () => {
    let n = 0;
    const g = vi.fn(async () => (n++ === 0 ? gate(['사과나무에 하루 물 세 번', '배나무도 같다']) : gate(['배나무도 같다'])));
    const llm = (async () => ({ revisions: [{ id: 'a-02', narration: '사과나무는 잎이 진 뒤 물을 줍니다.' }, { id: 'b-01', narration: '배나무도 같습니다!' }] })) as unknown as LlmJSON;
    const r = await factCheckScript({ script: script(), sourceText: SRC, gate: g, llmJSON: llm });
    expect(g).toHaveBeenCalledTimes(2);
    expect(r.record.revised.map((x) => x.id)).toEqual(['a-02', 'b-01']);
    expect(r.record.dropped.map((x) => x.id)).toEqual(['b-01']);
    expect(r.script.chapters.flatMap((c) => c.segments).map((x) => x.id)).toEqual(['a-01', 'a-02']);
  });
  it('걸린 문장이 없으면 한 번만 확인', async () => {
    const g = vi.fn(async () => gate([]));
    const r = await factCheckScript({ script: script(), sourceText: SRC, gate: g });
    expect(g).toHaveBeenCalledTimes(1);
    expect(r.script).toEqual(script());
  });
});

describe('rewordForPronunciation', () => {
  it('바꾼 문장을 돌려주고, 같거나 너무 길면 null', async () => {
    const ok = (async () => ({ narration: '가지치기는 잎이 진 뒤에 합니다.' })) as unknown as LlmJSON;
    expect(await rewordForPronunciation({ narration: '전정은 잎이 진 뒤에 합니다.', heard: '전쟁은', llmJSON: ok })).toBe('가지치기는 잎이 진 뒤에 합니다.');
    const same = (async () => ({ narration: '전정은 잎이 진 뒤에 합니다.' })) as unknown as LlmJSON;
    expect(await rewordForPronunciation({ narration: '전정은 잎이 진 뒤에 합니다.', heard: 'x', llmJSON: same })).toBeNull();
    const long = (async () => ({ narration: '가'.repeat(91) })) as unknown as LlmJSON;
    expect(await rewordForPronunciation({ narration: 'a', heard: 'x', llmJSON: long })).toBeNull();
  });
});
