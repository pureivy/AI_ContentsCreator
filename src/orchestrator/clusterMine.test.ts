import { describe, it, expect } from 'vitest';
import { filterCandidates } from './clusterMine';

const existing = [
  { title: '추희자두 특징과 키우는 법', keyword: '추희자두', kind: '블로그' as const },      // 시드 편
  { title: '추희자두 묘목, 늦게 익는 나무를 심는다는 것', keyword: '추희자두 묘목', kind: '블로그' as const }, // 기발행
];

describe('filterCandidates — 채굴 코드 게이트', () => {
  it('시드 편 자신과의 유사는 무시하고, 다른 기발행 글과의 충돌은 기각한다(실측 시나리오)', () => {
    const { pass, rejected } = filterCandidates(
      ['추희자두 수확시기', '추희자두 묘목', '추희자두 후숙'],
      '추희자두', '추희자두 특징과 키우는 법', existing,
    );
    expect(pass).toContain('추희자두 수확시기');   // 시드와만 유사 — 계획된 갈래
    expect(pass).toContain('추희자두 후숙');
    expect(pass).not.toContain('추희자두 묘목');   // 기발행 글과 충돌 — 진짜 중복
    expect(rejected.find((r) => r.kw === '추희자두 묘목')?.why).toContain('중복');
  });

  it('시드 표기 동치(공백 차이)는 기각', () => {
    const { pass } = filterCandidates(['추희 자두'], '추희자두', '추희자두 특징과 키우는 법', existing);
    expect(pass).toHaveLength(0);
  });

  it('브랜드 밖 소재는 기각(offBrandTerm 게이트 — 활성 브랜드 없으면 통과)', () => {
    // offBrandTerm 은 활성 브랜드 프로필 기준 — 테스트 환경(브랜드 미설정)에선 null 반환이 정상.
    const { pass } = filterCandidates(['추희자두 병충해'], '추희자두', '추희자두 특징과 키우는 법', []);
    expect(pass).toContain('추희자두 병충해');
  });
});
