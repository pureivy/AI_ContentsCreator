import { describe, it, expect, vi, beforeEach } from 'vitest';

// 원문 정합 판정(LLM)만 갈아 끼운다 — 나머지 두 축(시기·수치·승계)은 결정적이라 실제 코드로 돈다.
const parity = vi.fn<(...a: unknown[]) => Promise<string[] | null>>();
vi.mock('./standaloneQa', async (orig) => ({ ...(await orig<typeof import('./standaloneQa')>()), parityIssuesChecked: (...a: unknown[]) => parity(...a) }));

const { recheckCardFactGate } = await import('./cardnews');
const { recheckShortsFactGate } = await import('./shorts');

describe('수정 요청 뒤 사실 검증 다시(2026-10-14)', () => {
  beforeEach(() => parity.mockReset());
  const SRC = { body: '배나무는 잎이 진 뒤에 자르는 편이 보통 낫습니다. 끈 두 색으로 남길 가지를 표시합니다.' };
  it('카드 — 지적이 없어지면 통과로 갈아 끼운다', async () => {
    parity.mockResolvedValueOnce([]);
    const fg = await recheckCardFactGate({ slides: [{ headline: '배나무 전정', body: '잎이 진 뒤에 자르는 편이 보통 낫습니다' }] }, '', SRC);
    expect(fg?.status).toBe('pass'); expect(fg?.unsupported).toEqual([]);
  });
  it('카드 — 지적이 남으면 보류, 판정 실패면 null(옛 값 유지)', async () => {
    parity.mockResolvedValueOnce(['1번: 원문은 유보했는데 단정']);
    expect((await recheckCardFactGate({ slides: [{ headline: 'a', body: '' }] }, '', SRC))?.status).toBe('hold');
    parity.mockResolvedValueOnce(null);
    expect(await recheckCardFactGate({ slides: [{ headline: 'a', body: '' }] }, '', SRC)).toBeNull();
  });
  it('숏폼 — 씬 내레이션·자막을 판정에 넘기고 결과로 갈아 끼운다', async () => {
    parity.mockResolvedValueOnce([]);
    const plan = { title: 't', description: '', hashtags: [], titles: [], scenes: [
      { narration: '배나무는 잎이 진 뒤에 자르세요', screenText: '잎 진 뒤' },
    ] } as unknown as Parameters<typeof recheckShortsFactGate>[0];
    const fg = await recheckShortsFactGate(plan, '배나무 노목 전정', SRC);
    expect(fg?.status).toBe('pass');
    expect(String((parity.mock.calls[0]![1] as string[])[0])).toContain('(자막: 잎 진 뒤)');
    parity.mockResolvedValueOnce(null);
    expect(await recheckShortsFactGate(plan, '배나무 노목 전정', SRC)).toBeNull();
  });
});
