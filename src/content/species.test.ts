import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSpecies, findSpecies, speciesAnchor, speciesSeasonalHint, speciesNameFrom, appendSpecies, resetSpeciesCache, stripSpeciesNamePrefix } from './species';

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

describe('speciesNameFrom — 디렉터 값에서 이름 뽑기', () => {
  it('구분자 앞이 이름', () => {
    expect(speciesNameFrom('남천 — 깃꼴겹잎, 붉은 잎')).toBe('남천');
    expect(speciesNameFrom('회양목(상록 관목)')).toBe('회양목');
  });
  it('subject 가 비면 키워드를 쓴다', () => {
    expect(speciesNameFrom('', '치자나무')).toBe('치자나무');
  });
  it('수종명이 아닌 구절은 버린다 — 쓰레기가 사전에 쌓이면 안 된다', () => {
    for (const bad of ['9월 정원 준비', '나무 상처 치료제', '', '가', '아주아주긴이름이계속이어지는것']) {
      expect(speciesNameFrom(bad)).toBe('');
    }
  });
});

describe('appendSpecies — 새 수종 자동 축적', () => {
  const tmp = () => {
    const f = path.join(os.tmpdir(), `sp-${Math.random().toString(36).slice(2)}.yaml`);
    fs.writeFileSync(f, 'species:\n  기존종:\n    latin: Existing species\n    leaf: 홑잎\n');
    return f;
  };
  it('새 종을 덧붙이고 다시 읽힌다', () => {
    const f = tmp();
    expect(appendSpecies({ name: '치자나무', latin: 'Gardenia jasminoides', leaf: '마주나기 홑잎' }, f)).toBe(true);
    resetSpeciesCache();
    expect(findSpecies('치자나무', loadSpecies(f))?.latin).toBe('Gardenia jasminoides');
    resetSpeciesCache();
  });
  it('이미 있으면 안 넣는다(이름·학명 둘 다로 판정)', () => {
    const f = tmp();
    expect(appendSpecies({ name: '기존종', latin: 'Other species' }, f)).toBe(false);
    resetSpeciesCache();
    expect(appendSpecies({ name: '다른이름', latin: 'Existing species' }, f)).toBe(false);
    resetSpeciesCache();
  });
  it('이름이나 학명이 없으면 안 넣는다', () => {
    const f = tmp();
    expect(appendSpecies({ name: '', latin: 'Aaa bbb' }, f)).toBe(false);
    expect(appendSpecies({ name: '무언가', latin: '' }, f)).toBe(false);
  });
  it('자동 추가분은 auto·verified 로 표시된다 — 검증된 것이 아니다', () => {
    const f = tmp();
    appendSpecies({ name: '치자나무', latin: 'Gardenia jasminoides' }, f);
    const txt = fs.readFileSync(f, 'utf-8');
    expect(txt).toContain('auto: true');
    expect(txt).toContain('verified: false');
    resetSpeciesCache();
  });
});

describe('stripSpeciesNamePrefix — 앵커 앞머리 이름 제거(순수)', () => {
  const tmp = () => {
    const f = path.join(os.tmpdir(), `sp-${Math.random().toString(36).slice(2)}.yaml`);
    fs.writeFileSync(f, 'species:\n  기존종:\n    latin: Existing species\n    leaf: 홑잎\n');
    return f;
  };
  it('"이름 — 특징"에서 이름을 뗀다', () => {
    expect(stripSpeciesNamePrefix('사계장미', '사계장미 — 홀수 깃꼴겹잎, 가시 있는 줄기'))
      .toBe('홀수 깃꼴겹잎, 가시 있는 줄기');
  });
  it('붙임표 종류(—, –, -)를 모두 본다', () => {
    expect(stripSpeciesNamePrefix('남천', '남천 - 깃꼴겹잎')).toBe('깃꼴겹잎');
    expect(stripSpeciesNamePrefix('남천', '남천 – 깃꼴겹잎')).toBe('깃꼴겹잎');
  });
  it('앞머리가 이름이 아니면 그대로 둔다', () => {
    expect(stripSpeciesNamePrefix('남천', '깃꼴겹잎, 붉은 열매')).toBe('깃꼴겹잎, 붉은 열매');
  });
  it('빈 값·이름만 있는 값은 undefined', () => {
    expect(stripSpeciesNamePrefix('남천', '')).toBeUndefined();
    expect(stripSpeciesNamePrefix('남천', undefined)).toBeUndefined();
    expect(stripSpeciesNamePrefix('남천', '남천 — ')).toBeUndefined();
  });
  it('저장된 leaf 에 이름이 남지 않는다 — speciesAnchor 가 이름을 다시 붙이므로', () => {
    const f = tmp();
    appendSpecies({ name: '치자나무', latin: 'Gardenia jasminoides', leaf: '치자나무 — 마주나기 홑잎, 흰 꽃' }, f);
    resetSpeciesCache();
    const sp = findSpecies('치자나무', loadSpecies(f))!;
    expect(sp.leaf).toBe('마주나기 홑잎, 흰 꽃');
    expect(speciesAnchor(sp)).not.toContain('치자나무 — 치자나무');
    resetSpeciesCache();
  });
});
