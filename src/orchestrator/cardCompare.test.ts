import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('./agent', () => ({ microJSON: vi.fn() }));
vi.mock('./visionCommon', () => ({ visionCapable: () => true, stdModel: () => 'test-model' }));
import { microJSON } from './agent';
import { alignCompareSides } from './cardHtmlJob';
import { normalizeLayout, type CardLayout } from './cardLayout';

const mocked = microJSON as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mocked.mockReset());

// 배나무 카드 4번 장(2026-10-27) — 사진 왼쪽은 옛 품종(작은 재래 배), 칸은 왼쪽 개량종이었다.
const photo = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-')); const p = path.join(d, 'p.png'); fs.writeFileSync(p, 'x'); return p; };
const layout = (p: string): CardLayout => ({
  series: 's',
  slides: [{ kind: 'compare', title: '재배 배와 이름부터 달라요', bad: { label: '지금 먹는 배', text: '개량종 계열' }, good: { label: '청실배나무', text: '옛 품종 계열' }, tone: 'neutral', photo: { use: 'file', path: p } }],
});

describe('alignCompareSides — 비교 칸 순서를 사진 좌우에 맞춘다', () => {
  it('사진 왼쪽이 good 쪽이면 swap', async () => {
    mocked.mockResolvedValue({ left: 'B' });
    const out = await alignCompareSides(layout(photo()), () => {});
    expect(out.slides[0]!.swap).toBe(true);
    expect(mocked.mock.calls[0]![2]).toContain('A: 지금 먹는 배 — 개량종 계열');
  });
  it.each([[{ left: 'A' }], [{ left: 'none' }], [null]])('왼쪽이 bad 쪽·판정 불가면 그대로 (%j)', async (r) => {
    mocked.mockResolvedValue(r);
    expect((await alignCompareSides(layout(photo()), () => {})).slides[0]!.swap).toBeUndefined();
  });
  it('엉뚱한 응답값이면 그대로', async () => {
    mocked.mockResolvedValue({ left: 7 });
    expect((await alignCompareSides(layout(photo()), () => {})).slides[0]!.swap).toBeUndefined();
  });
  it('사진 없는 비교 판은 묻지 않는다', async () => {
    const l = layout(photo()); delete l.slides[0]!.photo;
    await alignCompareSides(l, () => {});
    expect(mocked).not.toHaveBeenCalled();
  });
});

describe('normalizeLayout — 비교 판 tone', () => {
  const PLAN = { title: '배나무', slides: [{ headline: '큰 배나무', body: '표지' }, { headline: '재배 배와 이름부터 달라요', body: '청실배는 옛 품종 계열, 지금 먹는 배는 개량종 계열' }, { headline: '확인', body: '끝' }] };
  const SRC = '청실배는 옛 품종 계열이고 지금 먹는 배는 개량종 계열입니다.';
  const raw = (tone?: string) => ({ slides: [{ kind: 'cover' }, { kind: 'compare', bad: { label: '지금 먹는 배', text: '개량종 계열' }, good: { label: '청실배나무', text: '옛 품종 계열' }, ...(tone ? { tone } : {}) }, { kind: 'steps' }] });
  it('neutral 만 받고 다른 값은 버린다', () => {
    expect(normalizeLayout(raw('neutral'), PLAN, SRC, 0).slides[1]!.tone).toBe('neutral');
    expect(normalizeLayout(raw('loud'), PLAN, SRC, 0).slides[1]!.tone).toBeUndefined();
    expect(normalizeLayout(raw(), PLAN, SRC, 0).slides[1]!.kind).toBe('compare');
  });
});
