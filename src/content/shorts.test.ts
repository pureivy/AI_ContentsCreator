import { describe, it, expect } from 'vitest';
import { shortsQaPublishBlockReason, shortsFactHoldBlockReason } from './shorts';

describe('shortsQaPublishBlockReason — 썸네일 QA 발행 게이트', () => {
  it('QA 통과면 막지 않는다', () => {
    expect(shortsQaPublishBlockReason(false)).toBeNull();
  });
  it('QA 미해결이면 막는다', () => {
    const r = shortsQaPublishBlockReason(true);
    expect(r).toBeTruthy();
    expect(r).toContain('썸네일');
  });
  it('force 면 통과 — 사람이 보고 확정한 경우', () => {
    expect(shortsQaPublishBlockReason(true, true)).toBeNull();
  });
  it('force 는 QA 통과 상태를 바꾸지 않는다', () => {
    expect(shortsQaPublishBlockReason(false, true)).toBeNull();
  });
});

// 2026-10-12 사장님 확정 — 모과나무 삽목 인스타 숏폼이 hold 인 채 버튼 한 번에 발행됐다.
describe('shortsFactHoldBlockReason — 사실 검증 보류 발행 게이트', () => {
  const fg = (status: 'pass' | 'hold' | 'error', unsupported: string[] = [], timing?: string[]) =>
    ({ status, unsupported, contradicted: [], timing, checkedTs: '2026-10-12T00:00:00Z' });
  it('보류면 막고 근거 없는 문장을 돌려준다', () => {
    const r = shortsFactHoldBlockReason(fg('hold', ['겨울 넘기면 살았다고 봐요.']))!;
    expect(r.error).toContain('사실 검증 보류 1건');
    expect(r.items).toEqual(['겨울 넘기면 살았다고 봐요.']);
  });
  it('문장 목록이 비면 시기·수치 잔존을 보여 준다', () => {
    expect(shortsFactHoldBlockReason(fg('hold', [], ['봄에 바로 보여요']))!.items).toEqual(['봄에 바로 보여요']);
  });
  it('통과·판정 실패·판정 없음·확인(forceFact)은 막지 않는다', () => {
    expect(shortsFactHoldBlockReason(fg('pass'))).toBeNull();
    expect(shortsFactHoldBlockReason(fg('error'))).toBeNull();
    expect(shortsFactHoldBlockReason(undefined)).toBeNull();
    expect(shortsFactHoldBlockReason(fg('hold', ['x']), true)).toBeNull();
  });
});
