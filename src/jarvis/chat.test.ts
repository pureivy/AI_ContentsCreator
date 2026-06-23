import { describe, it, expect, afterEach, vi } from 'vitest';
import { ollama } from '../llm/ollama';
import { jarvisChat, jarvisSystemPrompt } from './chat';

afterEach(() => vi.restoreAllMocks());

describe('jarvisChat', () => {
  it('잡담: 페르소나 system 메시지 + reply 반환(delegate 없음)', async () => {
    const spy = vi.spyOn(ollama, 'chat').mockResolvedValue({ text: '안녕하세요, 자비스예요.' } as never);
    const r = await jarvisChat([{ role: 'user', content: '자비스' }]);
    expect(r.reply).toContain('자비스');
    expect(r.delegate).toBeUndefined();
    const sys = (spy.mock.calls[0]![0] as { messages: { role: string; content: string }[] }).messages[0]!;
    expect(sys.role).toBe('system');
    expect(sys.content.length).toBeGreaterThan(10);
  });

  it('업무지시: 끝줄 delegate JSON 을 파싱하고 reply 에서 JSON 제거', async () => {
    vi.spyOn(ollama, 'chat').mockResolvedValue({
      text: '네, 전달하겠습니다.\n{"delegate":{"task":"예산 회의 자료 준비"}}',
    } as never);
    const r = await jarvisChat([{ role: 'user', content: '예산 회의 자료 준비해줘' }]);
    expect(r.delegate?.task).toContain('예산');
    expect(r.reply).not.toContain('{');
    expect(r.reply).toContain('전달');
  });

  it('위임: 유효 직원 id 는 delegate.agent 로 채택, 무효 id 는 무시', async () => {
    vi.spyOn(ollama, 'chat')
      .mockResolvedValueOnce({ text: '네.\n{"delegate":{"task":"예산 정리","agent":"support_budget"}}' } as never)
      .mockResolvedValueOnce({ text: '네.\n{"delegate":{"task":"예산 정리","agent":"nobody_xyz"}}' } as never);
    const ok = await jarvisChat([{ role: 'user', content: '예산 정리해줘' }]);
    expect(ok.delegate?.agent).toBe('support_budget');
    const bad = await jarvisChat([{ role: 'user', content: '예산 정리해줘' }]);
    expect(bad.delegate?.task).toContain('예산');
    expect(bad.delegate?.agent).toBeUndefined();   // 무효 id → 미채택
  });

  it('jarvisSystemPrompt 는 직원 목록을 포함한다', () => {
    const p = jarvisSystemPrompt();
    expect(p.length).toBeGreaterThan(20);
    expect(p).toContain('직원 목록');
  });

  it('jarvisSystemPrompt 로스터는 비서(자비스) 자신을 위임 후보로 넣지 않는다', () => {
    const p = jarvisSystemPrompt();
    expect(p).toContain('support_budget');   // 실제 직원은 후보에 있음
    expect(p).not.toContain('secretary |');  // 비서(자비스) 로스터 항목 제외(자기위임 방지)
  });

  it('위임: 비서(자비스) 자신 id 는 위임 대상으로 채택하지 않는다', async () => {
    vi.spyOn(ollama, 'chat').mockResolvedValue({
      text: '네.\n{"delegate":{"task":"회의 준비","agent":"secretary"}}',
    } as never);
    const r = await jarvisChat([{ role: 'user', content: '회의 준비해줘' }]);
    expect(r.delegate?.task).toContain('회의');
    expect(r.delegate?.agent).toBeUndefined();   // 자기위임 방지
  });
});
