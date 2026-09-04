import { describe, it, expect } from 'vitest';
import { loadSpecies, findSpecies, speciesAnchor, speciesSeasonalHint } from './species';

const LIST = loadSpecies();

describe('수종 사전 — 데이터 무결성', () => {
  it('로드되고 학명이 모두 있다', () => {
    expect(LIST.length).toBeGreaterThan(20);
    for (const s of LIST) expect(s.latin).toMatch(/^[A-Z][a-z]+ [a-z-]+$/);
  });
  it('이름·별칭이 겹치지 않는다 — 겹치면 매칭이 엉킨다', () => {
    const keys: string[] = [];
    for (const s of LIST) { keys.push(s.name); for (const a of s.aliases ?? []) keys.push(a); }
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('잎 정보가 다 있다 — 가장 자주 틀리는 항목이다', () => {
    for (const s of LIST) expect(s.leaf, s.name).toBeTruthy();
  });
});

describe('findSpecies — 키워드에서 수종 찾기', () => {
  it('키워드 그대로', () => {
    expect(findSpecies('남천')?.latin).toBe('Nandina domestica');
    expect(findSpecies('수국')?.latin).toBe('Hydrangea macrophylla');
  });
  it('구절 안에서도 찾는다', () => {
    expect(findSpecies('산수유 열매 적을 때')?.name).toBe('산수유');
    expect(findSpecies('측백나무 생울타리 몇 그루')?.name).toBe('측백나무');
    expect(findSpecies('9월 수국 관리, 가위 들기 전에')?.name).toBe('수국');
  });
  it('별칭으로도 찾는다', () => {
    expect(findSpecies('태추단감묘목')?.name).toBe('감나무');
    expect(findSpecies('도토리나무심기')?.name).toBe('참나무');
    expect(findSpecies('흰배롱나무')?.name).toBe('배롱나무');
  });
  it('긴 이름이 먼저 잡힌다 — 짧은 이름이 먼저 걸리면 엉뚱한 종이 된다', () => {
    // '보리수나무'가 있고 '수국'도 있다 — 부분 문자열 충돌을 확인
    expect(findSpecies('보리수나무묘목')?.name).toBe('보리수나무');
  });
  it('모르는 소재는 undefined — 표가 파이프라인을 막지 않는다', () => {
    expect(findSpecies('9월 정원 준비')).toBeUndefined();
    expect(findSpecies('')).toBeUndefined();
    expect(findSpecies('나무 상처 치료제')).toBeUndefined();
  });
});

describe('speciesAnchor — 앵커 문구', () => {
  it('종류·잎·수형을 담는다', () => {
    const a = speciesAnchor(findSpecies('남천')!);
    expect(a).toContain('남천');
    expect(a).toContain('깃꼴겹잎');
    expect(a.length).toBeLessThanOrEqual(200);
  });
  it('실사고 재현 — 남천이 손바닥잎으로 안 나온다', () => {
    expect(speciesAnchor(findSpecies('남천')!)).not.toContain('손바닥');
  });
});

describe('speciesSeasonalHint — 꽃·열매는 그 씬이 다룰 때만', () => {
  const sansuyu = () => findSpecies('산수유')!;
  it('열매 씬이면 열매 정보', () => {
    const h = speciesSeasonalHint(sansuyu(), '가지에 붉은 열매가 달린 모습');
    expect(h).toContain('열매');
    expect(h).not.toContain('꽃:');
  });
  it('꽃 씬이면 꽃 정보', () => {
    expect(speciesSeasonalHint(sansuyu(), '노란 꽃이 핀 가지')).toContain('꽃:');
  });
  it('둘 다 아니면 빈 문자열 — 꽃 없는 계절에 꽃이 그려지면 안 된다', () => {
    expect(speciesSeasonalHint(sansuyu(), '줄자로 담장 길이를 재는 손')).toBe('');
  });
});

describe('데이터 서술 원칙 — 긍정문만', () => {
  it('부정 표현이 없다 — 이미지 모델은 부정을 잘 못 다뤄 오히려 그 형태를 그린다', () => {
    for (const s of LIST) {
      const text = [s.type, s.leaf, s.form, s.flower, s.fruit, s.note].filter(Boolean).join(' ');
      expect(text, `${s.name}: ${text}`).not.toMatch(/아니다|아니라|말고|하지 마|안 된다|금지/);
    }
  });
});
