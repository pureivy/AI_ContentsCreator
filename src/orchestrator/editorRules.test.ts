import { describe, it, expect, vi, beforeEach } from 'vitest';
// 편집 확정 규칙(2026-10-05) 주입 지점 — 작가 본 집필·퇴화 재집필·리비전(문체 린트 수정·사람 수정 요청) 세 곳 모두에 실리는지.
// runAgent 만 가짜로 받아 컨텍스트를 들여다본다. 규칙 문구는 editorRulesGuide 목으로 고정(실제 brand.yaml 과 분리).
vi.mock('./agent', async (orig) => ({ ...(await orig<typeof import('./agent')>()), runAgent: vi.fn(), microJSON: vi.fn() }));
vi.mock('../content/brand', async (orig) => ({
  ...(await orig<typeof import('../content/brand')>()),
  editorRulesGuide: vi.fn(() => '[편집 확정 규칙 — 테스트]\n1. 한 문장마다 줄을 바꾼다.'),
  getBrand: vi.fn(() => null),
  activeBrandSlug: vi.fn(() => ''),
}));
vi.mock('../content/priorCoverage', async (orig) => ({
  ...(await orig<typeof import('../content/priorCoverage')>()),
  priorCoverageBrief: vi.fn(() => ''), recentStyleToAvoid: vi.fn(() => ''), recentPhrasesToAvoid: vi.fn(() => []),
  recentLexemesToAvoid: vi.fn(() => []), recentBlogEndings: vi.fn(() => ''),
}));
vi.mock('../content/contentModules', async (orig) => ({
  ...(await orig<typeof import('../content/contentModules')>()),
  recentModulesToAvoid: vi.fn(() => []),
}));
import { runAgent } from './agent';
import { editorRulesGuide } from '../content/brand';
import { writeBlogBody } from './org';
import type { EventBus } from '../events/bus';

const run = runAgent as unknown as ReturnType<typeof vi.fn>;
const bus = { emit: vi.fn(), runId: 'test-run' } as unknown as EventBus;
const writer = { id: 'content_lead', name: '작가' } as unknown as Parameters<typeof writeBlogBody>[0]['writer'];
const RULE = '[편집 확정 규칙 — 테스트]';

beforeEach(() => { run.mockReset(); });

describe('writeBlogBody — 편집 확정 규칙 주입(2026-10-05)', () => {
  it('본 집필 컨텍스트에 실린다', async () => {
    run.mockResolvedValueOnce({ text: '## 소제목\n본문입니다.' });
    await writeBlogBody({ bus, writer, model: 'm', topic: '라일락 꽃말', brief: '브리프', structure: '[이번 글 구조] x' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].context).toContain(RULE);
  });
  it('소제목 없는 퇴화 출력의 재집필 컨텍스트에도 실린다', async () => {
    run.mockResolvedValueOnce({ text: '진행할까요?' }).mockResolvedValueOnce({ text: '## 소제목\n본문입니다.' });
    await writeBlogBody({ bus, writer, model: 'm', topic: '라일락 꽃말', brief: '브리프', structure: '[이번 글 구조] x' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0].context).toContain(RULE);
  });
  it('리비전(문체 린트 수정·사람 수정 요청) 컨텍스트에도 실린다 — 한 줄 한 문장을 되돌리지 않게', async () => {
    run.mockResolvedValueOnce({ text: '## 소제목\n본문입니다.' });
    await writeBlogBody({ bus, writer, model: 'm', topic: '라일락 꽃말', brief: '브리프', structure: '[이번 글 구조] x',
      revise: { baseBody: '## 초안\n문장.', feedback: '[문체 린트] 지적' } });
    const ctx = run.mock.calls[0]![0].context as string;
    expect(ctx).toContain(RULE);
    expect(ctx.indexOf('[검토자 수정 요청')).toBeLessThan(ctx.indexOf(RULE));
  });
  it('규칙이 없으면(빈 문자열) 컨텍스트에 흔적이 없다 — 종전 프롬프트 그대로', async () => {
    (editorRulesGuide as unknown as ReturnType<typeof vi.fn>).mockReturnValue('');
    run.mockResolvedValueOnce({ text: '## 소제목\n본문입니다.' });
    await writeBlogBody({ bus, writer, model: 'm', topic: '라일락 꽃말', brief: '브리프',
      revise: { baseBody: '## 초안', feedback: 'F' } });
    const ctx = run.mock.calls[0]![0].context as string;
    expect(ctx).not.toContain('편집 확정 규칙');
    expect(ctx.endsWith('[검토자 수정 요청 — 반드시 반영]\nF')).toBe(true);
  });
});

// 2026-10-05 대추나무 초안 — 작가에게 키워드의 바른 띄어쓰기 꼴과 '주어·"의" 명사구 금지'가 전달된다.
describe('writeBlogBody — 키워드 쓰는 법 주입(2026-10-05)', () => {
  it('키워드가 있으면 본 집필·리비전 컨텍스트에 바른 꼴이 실린다', async () => {
    run.mockResolvedValueOnce({ text: '## 소제목\n본문입니다.' }).mockResolvedValueOnce({ text: '## 소제목\n본문입니다.' });
    await writeBlogBody({ bus, writer, model: 'm', topic: '대추나무 심는 시기', brief: '브리프', structure: '[이번 글 구조] x', keyword: '대추나무 심는시기' });
    await writeBlogBody({ bus, writer, model: 'm', topic: '대추나무 심는 시기', brief: '브리프', keyword: '대추나무 심는시기',
      revise: { baseBody: '## 초안', feedback: 'F' } });
    for (const call of run.mock.calls) {
      const ctx = call[0].context as string;
      expect(ctx).toContain('[핵심 키워드 쓰는 법]');
      expect(ctx).toContain('"대추나무 심는 시기"');
    }
  });
});
