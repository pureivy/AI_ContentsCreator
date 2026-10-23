import { beforeEach, describe, expect, it, vi } from 'vitest';

// runAgent 는 가짜(LLM 호출 없음), 직원 워크스페이스(기억·스킬)도 가짜 — data/agents 를 읽거나 쓰지 않는다.
vi.mock('./agent', async (orig) => ({ ...(await orig<typeof import('./agent')>()), runAgent: vi.fn() }));
vi.mock('../agents/workspace', () => ({
  personaExtra: vi.fn((id: string) => (id === 'longform_designer' ? '[검증된 작업 패턴(스킬)]\n스킬 본문\n\n[과거 학습·교훈(자가학습)]\n꼬리 기억' : '')),
  readMemory: vi.fn(() => '- (2026-10-22) 비유를 글자 그대로 그리지 않는다.'),
  readSkills: vi.fn((id: string) => (id === 'longform_designer' ? `스킬 본문 ${'가'.repeat(700)} 끝 규칙: 사람 손은 그리지 않는다.` : '')),
}));

import { runAgent } from './agent';
import { EventBus } from '../events/bus';
import { designerBrief, staffLlm, stripEvidenceTags } from './longformStaff';
import type { LlmJSON } from '../longform/writer';

const runAgentMock = runAgent as unknown as ReturnType<typeof vi.fn>;

describe('staffLlm — 롱폼 직원 LLM', () => {
  beforeEach(() => runAgentMock.mockReset());

  it('버스가 없으면 fallback 에 역할 머리말·역할 프롬프트를 붙이고 과제 system 을 맨 뒤에 둔다', async () => {
    const fallback = vi.fn(async () => ({ ok: 1 })) as unknown as LlmJSON;
    const llm = staffLlm('longform_writer', { fallback });
    const out = await llm<{ ok: number }>('m-heavy', 'TASK-SYSTEM', 'USER', { maxOutputTokens: 100 });
    expect(out).toEqual({ ok: 1 });
    const [model, system, user] = (fallback as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(model).toBe('m-heavy');
    expect(user).toBe('USER');
    expect(system).toContain('"한서윤"(롱폼 작가)');
    expect(system).toContain('롱폼팀의 작가');
    expect(String(system).endsWith('TASK-SYSTEM')).toBe(true);
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it('모르는 역할이면 system 을 그대로 넘긴다', async () => {
    const fallback = vi.fn(async () => null) as unknown as LlmJSON;
    await staffLlm('no_such_role', { fallback })('m', 'SYS', 'U', {});
    expect((fallback as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe('SYS');
  });

  it('버스가 있으면 runAgent(첫 호출만 스폰) — [근거] 표식을 지우고 JSON 을 뽑는다, 다른 팀 팀원은 위임·작업 단계 뒤 idle', async () => {
    runAgentMock.mockResolvedValue({ text: '{"theme":"감나무 [근거: 글 1] 심기","pieceIds":["a"]}', blockId: 'b', result: {} });
    const bus = new EventBus('t-run');
    const fallback = vi.fn() as unknown as LlmJSON;
    const llm = staffLlm('perf_analyst', { bus, fallback, summary: '주제 묶음' });
    const a = await llm<{ theme: string }>('m-std', 'SYS', 'USER', { maxOutputTokens: 800 });
    await llm('m-std', 'SYS', 'USER2', {});
    expect(a?.theme).toBe('감나무 심기');
    expect(fallback).not.toHaveBeenCalled();
    expect(runAgentMock).toHaveBeenCalledTimes(2);
    const first = runAgentMock.mock.calls[0]![0];
    expect(first).toMatchObject({ model: 'm-std', stage: 'work', emitSpawn: true, think: false, toolLoop: false, systemExtra: 'SYS', maxOutputTokens: 800 });
    expect(first.role.id).toBe('perf_analyst');
    expect(first.task).toContain('USER');
    expect(runAgentMock.mock.calls[1]![0].emitSpawn).toBe(false);
    const ev = bus.replay(0).map((e) => [e.type, e.payload.team_id, e.payload.phase ?? e.payload.to]);
    expect(ev.slice(0, 3)).toEqual([['delegation', 'research', 'perf_analyst'], ['phase', 'research', 'work'], ['phase', 'research', 'idle']]);
  });

  it('롱폼팀 팀장(작가)은 위임 없이 팀 phase 만', async () => {
    runAgentMock.mockResolvedValue({ text: '{"x":1}', blockId: 'b', result: {} });
    const bus = new EventBus('t-run2');
    await staffLlm('longform_writer', { bus, fallback: vi.fn() as unknown as LlmJSON })('m', 'S', 'U', {});
    expect(bus.replay(0).map((e) => [e.type, e.payload.team_id, e.payload.phase])).toEqual([['phase', 'longform', 'work']]);
  });
});

describe('designerBrief·stripEvidenceTags', () => {
  it('기억은 전문으로 한 번만(스킬은 남기고 personaExtra 의 꼬리 기억은 뺀다)', () => {
    const b = designerBrief();
    expect(b).toContain('차민혁');
    expect(b).toContain('스킬 본문');
    expect(b).toContain('비유를 글자 그대로 그리지 않는다');
    expect(b).not.toContain('꼬리 기억');
  });
  it('스킬은 600자에서 자르지 않고 전문으로(끝의 판단 규칙까지 — 2026-10-23 사람 손 금지가 잘렸다)', () => {
    const b = designerBrief();
    expect(b).toContain('사람 손은 그리지 않는다');
    expect(b.match(/스킬 본문/g)).toHaveLength(1);
  });
  it('[근거: …] 표식 제거', () => {
    expect(stripEvidenceTags('뿌리에 양분을 저장합니다 [근거: 글 2].')).toBe('뿌리에 양분을 저장합니다.');
  });
});
