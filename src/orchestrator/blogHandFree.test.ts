import { describe, it, expect } from 'vitest';
import { stripNegations, handFreeModel, mentionsHands, withNoHands, applyRewrites, NO_HANDS } from './blogHandFree';

describe('blogHandFree', () => {
  it('FLUX 계열만 켠다', () => {
    expect(handFreeModel('comfy:flux3klein')).toBe(true);
    expect(handFreeModel('comfy:qwen21')).toBe(false);
    expect(handFreeModel('gpt-image-2')).toBe(false);
  });
  it('손·사람 칸을 알아본다', () => {
    expect(mentionsHands({ alt: '줄기를 손으로 잡고 흔드는 모습', prompt: 'x' })).toBe(true);
    expect(mentionsHands({ alt: '', prompt: 'bare hands gripping the trunk' })).toBe(true);
    expect(mentionsHands({ alt: '지주 두 개', prompt: 'two wooden stakes, leafless sapling' })).toBe(false);
  });
  it('금지 문구는 한 번만', () => {
    expect(withNoHands(withNoHands('a tree'))).toBe(`a tree. ${NO_HANDS}`);
  });
  it('대상 칸만 바꾸고, 바꾼 지시에 손이 남으면 버린다', () => {
    const slots = [{ alt: '손으로 흔들기', prompt: 'hands gripping trunk' }, { alt: '지주', prompt: 'two stakes' }];
    const ok = applyRewrites(slots, { slots: [{ slot: 1, alt: '기운 줄기', prompt: 'young trunk leaning, cracked soil' }, { slot: 2, alt: 'x', prompt: 'y' }] }, [0]);
    expect(ok[0]).toEqual({ alt: '기운 줄기', prompt: `young trunk leaning, cracked soil. ${NO_HANDS}` });
    expect(ok[1]).toEqual({ alt: '지주', prompt: `two stakes. ${NO_HANDS}` });
    const bad = applyRewrites(slots, { slots: [{ slot: 1, alt: 'a', prompt: 'a hand near trunk' }] }, [0]);
    expect(bad[0]!.alt).toBe('손으로 흔들기');
  });
  it('금지 문구 속 hands 는 손으로 보지 않는다', () => {
    expect(stripNegations('trunk tilted, no people, no hands, no text')).not.toMatch(/hands|people/);
    expect(stripNegations('without any human hands or fingers')).not.toMatch(/hands|fingers/);
    const slots = [{ alt: '손으로 흔들기', prompt: 'hands gripping trunk' }];
    const r = applyRewrites(slots, { slots: [{ slot: 1, alt: '흔들리는 줄기', prompt: 'trunk tilted in breeze, no people, no hands' }] }, [0]);
    expect(r[0]!.alt).toBe('흔들리는 줄기');
  });
});
