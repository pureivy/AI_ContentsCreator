import { describe, it, expect } from 'vitest';
import { modulesInBody, modulesToAvoid, moduleAvoidBlock } from './contentModules';
import type { ContentModule } from './contentModules';

const M: ContentModule[] = [
  { name: '화분 vs 마당', match: ['화분'] },
  { name: '첫해 참기', match: ['첫해', '첫 해'] },
  { name: '묘목 보는 자리', match: ['묘목', '뿌리목', '접목부'] },
  { name: '다음 편 예고', match: ['이어지는 편', '따로 적겠'] },
];

describe('modulesInBody — 소제목 1회 또는 본문 3회', () => {
  it('소제목에 토큰이 있으면 1회로도 모듈', () => {
    expect(modulesInBody('## 화분에서 될까\n본문', M)).toEqual(['화분 vs 마당']);
    expect(modulesInBody('### 심은 첫 해에 하지 않는 일\n본문', M)).toEqual(['첫해 참기']);
  });
  it('본문에는 3회 이상이어야 모듈, 언급 1~2회는 안 센다', () => {
    expect(modulesInBody('묘목을 봅니다. 묘목이 좋다. 묘목 고르기.', M)).toEqual(['묘목 보는 자리']);
    expect(modulesInBody('화분도 됩니다. 화분은 반만.', M)).toEqual([]);
  });
  it('공백만 다른 토큰(첫해/첫 해)은 한 토큰으로 세어 2회로는 모듈이 아니다', () => {
    expect(modulesInBody('첫해에는 참고, 첫 해가 지나면 자릅니다.', M)).toEqual([]);
    expect(modulesInBody('첫해, 첫 해, 첫해 — 세 번이면 모듈입니다.', M)).toEqual(['첫해 참기']);
  });
  it('여러 토큰의 횟수는 합산, 같은 모듈은 1번, 카탈로그 없으면 빈 배열', () => {
    expect(modulesInBody('뿌리목 한 번, 접목부 두 번, 접목부 세 번', M)).toEqual(['묘목 보는 자리']);
    expect(modulesInBody('## 화분\n화분 화분 화분', M)).toEqual(['화분 vs 마당']);
    expect(modulesInBody('## 화분', undefined)).toEqual([]);
  });
});

describe('modulesToAvoid — 최근 편 합집합, 주제가 요구하는 모듈은 예외', () => {
  const bodies = ['## 화분에서 될까\n…', '## 첫해에 참는 일\n…', '묘목 묘목 묘목'];
  it('세 편에 나온 모듈 전부', () => {
    expect(modulesToAvoid(bodies, M, '음나무 자리 고르기')).toEqual(['화분 vs 마당', '첫해 참기', '묘목 보는 자리']);
  });
  it('주제 제목·키워드에 토큰이 있으면 그 모듈은 뺀다', () => {
    expect(modulesToAvoid(bodies, M, '음나무 묘목 고르기 음나무 묘목')).toEqual(['화분 vs 마당', '첫해 참기']);
    expect(modulesToAvoid(bodies, M, '베란다 화분 나무 첫 해')).toEqual(['묘목 보는 자리']);
  });
  it('빈 입력은 빈 배열', () => {
    expect(modulesToAvoid([], M, 'x')).toEqual([]);
    expect(modulesToAvoid(bodies, [], 'x')).toEqual([]);
  });
});

describe('moduleAvoidBlock', () => {
  it('이름과 토큰 예시를 싣고, 비면 빈 문자열', () => {
    const b = moduleAvoidBlock(['화분 vs 마당', '첫해 참기'], M);
    expect(b.startsWith('[이번 글 금지 모듈]')).toBe(true);
    expect(b).toContain('화분 vs 마당(화분)');
    expect(b).toContain('첫해 참기(첫해, 첫 해)');
    expect(moduleAvoidBlock([], M)).toBe('');
  });
});
