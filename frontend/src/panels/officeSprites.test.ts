// 역할 id → 스프라이트 캐릭터 매핑 회귀망 — Avatar(직원 탭·타임라인)는 id 만으로 해석하므로
// id 매핑이 빠지면 이모지 폴백으로 조용히 강등된다(자비스 얼굴 실사고).
import { describe, it, expect } from 'vitest';
import { spriteFor, TWO_POSE_CHARS } from './officeSprites';

describe('spriteFor', () => {
  it('secretary(자비스 로스터 정식 id)는 id 만으로 jarvis 캐릭터로 해석된다', () => {
    expect(spriteFor('secretary')).toBe('jarvis');       // Avatar 호출 형태(id 단독)
    expect(spriteFor('jarvis')).toBe('jarvis');          // 오피스 합성 노드(구 데이터 폴백)
  });

  it('직함 기반 폴백도 비서를 jarvis 로 해석한다(커스텀 id 대비)', () => {
    expect(spriteFor('someone', 'lead', '비서실장')).toBe('jarvis');
  });

  it('미지 id 는 null(이모지 폴백)', () => {
    expect(spriteFor('unknown_member')).toBeNull();
  });
});

describe('롱폼팀 스프라이트(2026-10-23)', () => {
  it('한서윤·차민혁은 id 만으로 생성 2포즈 캐릭터로 해석된다(직함 폴백 blogger·critic-platform 으로 새지 않게)', () => {
    expect(spriteFor('longform_writer')).toBe('longformwriter');
    expect(spriteFor('longform_designer')).toBe('longformdesigner');
    expect(spriteFor('longform_writer', 'lead', '롱폼 작가')).toBe('longformwriter');
    expect(spriteFor('longform_designer', 'member', '롱폼 모션 디자이너')).toBe('longformdesigner');
  });

  it('2포즈 세트로 등록 — 9포즈 파일(walkF1 등)을 찾지 않는다', () => {
    expect(TWO_POSE_CHARS.has('longformwriter')).toBe(true);
    expect(TWO_POSE_CHARS.has('longformdesigner')).toBe(true);
  });
});
