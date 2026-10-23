import { describe, expect, it, vi } from 'vitest';
import { REVIEW_CHUNK, REVIEW_REFS, chunkRefs, parseRedo, reviewPrompt, sceneReviewer, type VisionJSON } from './longformReview';
import { REVIEW_MAX, type ReviewItem } from './longformScenes';
import { EventBus } from '../events/bus';

// LLM 은 가짜(VisionJSON 주입) — 비전 묶음 나누기·심각도 정렬·상한·실패 처리만 본다.
const items = (n: number, still = true): ReviewItem[] => Array.from({ length: n }, (_, i) => {
  const key = `s${String(i).padStart(3, '0')}`;
  return { key, narration: `${i}번째 문장`, chapterTitle: '장', labels: i === 0 ? ['밑천'] : [], ...(still ? { still: `/tmp/${key}_55.png` } : {}) };
});

describe('parseRedo·reviewPrompt', () => {
  it('아는 키만·중복 제거·심각도 1~3', () => {
    const keys = new Set(['s001', 's002']);
    expect(parseRedo({ redo: [{ key: 's001', reason: ' 동전  그림 ', severity: 9 }, { key: 's001', reason: 'dup' }, { key: 'x', reason: 'y' }, { key: 's002' }] }, keys))
      .toEqual([{ key: 's001', reason: '동전 그림', severity: 3 }, { key: 's002', reason: '검토 지적(사유 없음)', severity: 2 }]);
    expect(parseRedo(null, keys)).toEqual([]);
  });
  it('비전이면 이미지 순서 = 장면 순서, 사장님 기준이 들어간다', () => {
    const p = reviewPrompt(items(2), { vision: true, limit: 4, title: '감나무 편' });
    expect(p.user).toContain('이미지 1 = s000');
    expect(p.user).toContain('화면 글자: 밑천');
    expect(p.user).toContain('비유를 글자 그대로');
    expect(p.user).toContain('많아야 4개');
  });
});

describe('sceneReviewer', () => {
  it('스틸을 8장씩 비전으로, 심각도순 상위 10개', async () => {
    const llm = vi.fn(async (_m: string, _s: string, user: string, o: { visionPaths?: readonly string[] }) => {
      const keys = [...user.matchAll(/이미지 \d+ = (s\d{3})/g)].map((m) => m[1]!);
      expect(o.visionPaths).toHaveLength(keys.length);
      // 묶음마다 앞 두 장면을 지적 — 첫 묶음만 심각도 3
      return { redo: keys.slice(0, 2).map((key) => ({ key, reason: `${key} 이상`, severity: key < 's008' ? 3 : 2 })) };
    });
    const activity = vi.fn();
    const v = await sceneReviewer({ llm: llm as unknown as VisionJSON, vision: true, activity })({ items: items(40) });
    expect(llm).toHaveBeenCalledTimes(Math.ceil(40 / REVIEW_CHUNK));
    expect(v?.mode).toBe('vision');
    expect(v?.checked).toBe(40);
    expect(v?.redo).toHaveLength(REVIEW_MAX);
    expect(v?.redo.slice(0, 2).map((r) => r.key)).toEqual(['s000', 's001']);
    expect(activity.mock.calls[0]![0]).toContain('다시 그릴 장면 10개');
  });

  it('비전이 안 되면 글 검토(이미지 없이), 전부 응답 없으면 null', async () => {
    const llm = vi.fn(async () => ({ redo: [] }));
    const v = await sceneReviewer({ llm: llm as unknown as VisionJSON, vision: false })({ items: items(5) });
    expect(v).toMatchObject({ mode: 'text', checked: 5, redo: [] });
    expect((llm.mock.calls[0] as unknown[])[3]).not.toHaveProperty('visionPaths');
    const dead = vi.fn(async () => { throw new Error('down'); });
    expect(await sceneReviewer({ llm: dead as unknown as VisionJSON, vision: true })({ items: items(3) })).toBeNull();
  });

  it('실물 대조용 사진 — 묶음 첫 장면 수종 사진 2장을 앞에, 장면은 6장(합쳐 8장 상한), 실물 형태 기준이 들어간다', async () => {
    const its = items(14).map((it, i) => ({ ...it, species: [i < 7 ? '감나무' : '사과나무'] }));
    const refs = [
      { nameKo: '감나무', file: '/r/gam1.jpg' }, { nameKo: '감나무', file: '/r/gam2.jpg' }, { nameKo: '감나무', file: '/r/gam3.jpg' },
      { nameKo: '사과나무', file: '/r/apple1.jpg' },
    ];
    expect(chunkRefs(its[0]!, refs).map((r) => r.file)).toEqual(['/r/gam1.jpg', '/r/gam2.jpg']);
    expect(chunkRefs({ ...its[0]!, species: [] }, refs)).toEqual([]);
    const calls: Array<{ user: string; paths: readonly string[] }> = [];
    const llm = vi.fn(async (_m: string, _s: string, user: string, o: { visionPaths?: readonly string[] }) => { calls.push({ user, paths: o.visionPaths ?? [] }); return { redo: [] }; });
    await sceneReviewer({ llm: llm as unknown as VisionJSON, vision: true })({ items: its, refs });
    expect(calls.every((c) => c.paths.length <= REVIEW_CHUNK)).toBe(true);
    expect(calls[0]!.paths.slice(0, REVIEW_REFS)).toEqual(['/r/gam1.jpg', '/r/gam2.jpg']);
    expect(calls[0]!.paths).toHaveLength(8);
    expect(calls[0]!.user).toContain('이미지 1~2 = 감나무 실제 모습');
    expect(calls[0]!.user).toContain('이미지 3 = s000');
    expect(calls[0]!.user).toContain('실물 형태와 다르다(잎·꽃·열매·수형·껍질)');
    expect(calls[0]!.user).toContain('(수종 감나무)');
    // 둘째 묶음은 s006(감나무)부터 — 셋째 묶음 첫 장면이 사과나무면 사과나무 사진
    const firstKeys = calls.map((c) => c.user.match(/= (s\d{3})/)?.[1]);
    expect(firstKeys[0]).toBe('s000');
    expect(calls.reduce((n, c) => n + (c.user.match(/이미지 \d+ = s\d{3}/g)?.length ?? 0), 0)).toBe(14);
    const appleChunk = calls.find((c) => c.paths.includes('/r/apple1.jpg'));
    expect(appleChunk?.user).toContain('이미지 1 = 사과나무 실제 모습');
  });

  it('공개 도감 사진 — 묶음 문장에 부위(껍질)가 나오면 실촬영 1장 + 그 부위 도감 사진 1장(8장 상한 그대로), 어느 것이 도감인지 적는다', async () => {
    const its = items(6).map((it, i) => ({ ...it, species: ['감나무'], narration: i === 2 ? '오래된 감나무 줄기 껍질은 거북등처럼 갈라집니다.' : `${i}번째 문장` }));
    const refs = [
      { nameKo: '감나무', file: '/r/gam1.jpg' }, { nameKo: '감나무', file: '/r/gam2.jpg' },
      { nameKo: '감나무', file: '/r/commons-flower-1.jpg', part: 'flower' as const }, { nameKo: '감나무', file: '/r/commons-bark-1.jpg', part: 'bark' as const },
    ];
    expect(chunkRefs(its, refs).map((r) => r.file)).toEqual(['/r/gam1.jpg', '/r/commons-bark-1.jpg']);
    // 부위 단서가 없으면 실촬영 먼저 — 실촬영이 없으면 도감 사진
    expect(chunkRefs(its.slice(0, 2), refs).map((r) => r.file)).toEqual(['/r/gam1.jpg', '/r/gam2.jpg']);
    expect(chunkRefs(its.slice(0, 2), refs.filter((r) => r.part)).map((r) => r.file)).toEqual(['/r/commons-bark-1.jpg', '/r/commons-flower-1.jpg']);
    const calls: Array<{ user: string; paths: readonly string[] }> = [];
    const llm = vi.fn(async (_m: string, _s: string, user: string, o: { visionPaths?: readonly string[] }) => { calls.push({ user, paths: o.visionPaths ?? [] }); return { redo: [] }; });
    await sceneReviewer({ llm: llm as unknown as VisionJSON, vision: true })({ items: its, refs });
    expect(calls[0]!.paths.slice(0, 2)).toEqual(['/r/gam1.jpg', '/r/commons-bark-1.jpg']);
    expect(calls[0]!.paths.length).toBeLessThanOrEqual(REVIEW_CHUNK);
    expect(calls[0]!.user).toContain('이미지 1 = 감나무 실제 모습 — 우리 실촬영(보관소)');
    expect(calls[0]!.user).toContain('이미지 2 = 감나무 수피(성목 껍질) — 공개 도감 사진(Wikimedia Commons, 내부 대조용)');
    expect(calls[0]!.user).toContain('이미지 3 = s000');
  });

  it('버스가 있으면 정하람을 오피스에 띄우고(위임·작업) 끝에 한 줄 산출물·idle', async () => {
    const bus = new EventBus('rv');
    await sceneReviewer({ bus, llm: (async () => ({ redo: [] })) as unknown as VisionJSON, vision: true })({ items: items(2) });
    const ev = bus.replay(0).map((e) => e.type);
    expect(ev).toEqual(['agent_spawned', 'delegation', 'phase', 'agent_message', 'phase']);
    expect(bus.replay(0)[0]!.agent_id).toBe('reviewer');
  });
});
