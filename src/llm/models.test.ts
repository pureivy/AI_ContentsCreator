import { describe, it, expect } from 'vitest';
import { estimateModelMemoryGB, paramsB, autoAssignModels } from './models';
import type { InstalledModel, SystemSpecs } from './models';

const specs = (budget: number): SystemSpecs => ({
  totalRamGB: budget / 0.65, freeRamGB: 8, cpuModel: 'Apple M4 Pro', cpuCount: 12,
  platform: 'darwin', arch: 'arm64', isAppleSilicon: true, safeModelBudgetGB: budget, summary: 'test',
});

describe('paramsB / estimateModelMemoryGB', () => {
  it('파라미터 수를 모델명에서 뽑는다', () => {
    expect(paramsB('gemma3:12b')).toBe(12);
    expect(paramsB('qwen2.5:1.5b')).toBe(1.5);
    expect(paramsB('llama3.2:1b')).toBe(1);
    expect(paramsB('mystery-model')).toBe(7); // 미상 기본
  });
  it('4-bit 기준 메모리를 추정한다', () => {
    expect(estimateModelMemoryGB('llama3.2:1b')).toBeCloseTo(1.6, 1); // 1*0.6+1
    expect(estimateModelMemoryGB('gemma3:12b')).toBeCloseTo(8.2, 1);  // 12*0.6+1
  });
});

describe('autoAssignModels', () => {
  const installed: InstalledModel[] = [
    { name: 'llama3.2:1b', sizeGB: 1.3 },
    { name: 'gemma3:4b', sizeGB: 3.3 },
    { name: 'qwen2.5:7b', sizeGB: 4.7 },
    { name: 'gemma3:12b', sizeGB: 8.1 },
  ];

  it('예산 안에서 micro<=standard<=heavy 로 우-사이징한다', () => {
    const a = autoAssignModels(installed, specs(16));
    expect(paramsB(a.micro)).toBeLessThanOrEqual(4.5);    // 마이크로는 작은 모델
    expect(a.heavy).toBe('gemma3:12b');                    // heavy 는 가장 큰 적합 모델
  });

  it('예산이 작으면 큰 모델을 제외한다', () => {
    const a = autoAssignModels(installed, specs(4));
    expect(a.heavy).not.toBe('gemma3:12b');                // 8.1GB 는 예산 4 초과 → 제외
  });

  it('임베딩 모델은 후보에서 제외한다', () => {
    const withEmbed = [...installed, { name: 'nomic-embed-text', sizeGB: 0.3 }];
    const a = autoAssignModels(withEmbed, specs(16));
    expect([a.micro, a.standard, a.heavy]).not.toContain('nomic-embed-text');
  });

  it('등급별 지정 오버라이드 — 설치된 모델만 적용, 미설치는 자동 폴백', () => {
    const withGemma: InstalledModel[] = [
      { name: 'gemma4:e4b', sizeGB: 3.0 },
      { name: 'gemma4:12b', sizeGB: 8.0 },
      { name: 'qwen3:14b', sizeGB: 9.0 },
    ];
    // 설치된 override → 그대로 적용(사용자 선택: micro=e4b, standard·heavy=12b)
    const a = autoAssignModels(withGemma, specs(16), { micro: 'gemma4:e4b', standard: 'gemma4:12b', heavy: 'gemma4:12b' });
    expect([a.micro, a.standard, a.heavy]).toEqual(['gemma4:e4b', 'gemma4:12b', 'gemma4:12b']);
    // 미설치 override → 결과에 안 나타나고 자동 배정으로 폴백(범용 안전)
    const b = autoAssignModels(withGemma, specs(16), { micro: '', standard: 'nope:99b', heavy: '' });
    expect(b.standard).not.toBe('nope:99b');
    // override 가 없으면 가장 큰 qwen3:14b 가 heavy — 등급별 지정의 존재 이유
    const c = autoAssignModels(withGemma, specs(16), { micro: '', standard: '', heavy: '' });
    expect(c.heavy).toBe('qwen3:14b');
  });
});
