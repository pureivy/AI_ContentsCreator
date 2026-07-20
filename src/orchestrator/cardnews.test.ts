import { describe, it, expect } from 'vitest';
import { buildCardImagePrompt, resolveForcedPreset } from './cardnews';

const base = {
  headline: '가을 첫인사',
  body: '창가에 화분 하나\n계절이 바뀝니다',
  scene: '노을 지는 창가',
  style: '따뜻한 자연광, 파스텔 팔레트',
  title: '가을 인사',
  total: 4,
  hasRefs: false,
};

describe('buildCardImagePrompt — 공통 보존(두 프리셋 모두)', () => {
  for (const preset of ['photorealistic', 'handwritten_poster']) {
    it(`${preset}: 정확 문구·자소 가드·무이모지 정책을 유지`, () => {
      const p = buildCardImagePrompt({ ...base, index: 1, preset });
      expect(p).toContain('한 글자도 바꾸지 말 것');
      expect(p).toContain(base.headline);          // 헤드라인 정확 표기
      expect(p).toContain('창가에 화분 하나 / 계절이 바뀝니다'); // 본문 줄바꿈→ / 치환
      expect(p).toContain('자소(자음·모음) 결합이 틀리면 실패');
      expect(p).toContain(base.style);             // 전 장 공통 스타일 반복
      expect(p).toContain('2:3 세로');              // 네이티브 세로 비율(1024×1536)
      expect(p).not.toContain('정사각');            // 이전 1:1 문구 제거 확인
    });
  }

  it('페이지 표기는 본문(i>0)에만, 표지(i=0)엔 없음', () => {
    expect(buildCardImagePrompt({ ...base, index: 0, preset: 'handwritten_poster' })).not.toContain('페이지 표기');
    expect(buildCardImagePrompt({ ...base, index: 2, preset: 'handwritten_poster' })).toContain('"3/4"');
  });
});

describe('buildCardImagePrompt — handwritten_poster 분기', () => {
  it('손글씨 캘리·임베드·상호작용 지시를 담고, 인쇄 에디토리얼 문구는 안 씀', () => {
    const p = buildCardImagePrompt({ ...base, index: 1, preset: 'handwritten_poster' });
    expect(p).toContain('손글씨 캘리그래피');
    expect(p).toContain('피사체-텍스트 상호작용');
    expect(p).toContain('평면 스티커처럼 얹지 않는다');
    expect(p).not.toContain('산세리프');                 // 에디토리얼 전용 문구 배제
    expect(p).not.toContain('인쇄 에디토리얼 질감');
  });

  it('표지=히어로 캘리, 본문=가독성 우선으로 분기', () => {
    const cover = buildCardImagePrompt({ ...base, index: 0, preset: 'handwritten_poster' });
    const body = buildCardImagePrompt({ ...base, index: 1, preset: 'handwritten_poster' });
    expect(cover).toContain('히어로 캘리그래피');
    expect(body).toContain('가독성 우선');
  });
});

describe('resolveForcedPreset — 사용자 강제 스타일 정규화(순수)', () => {
  it('자동·미지정·불명은 undefined(디자이너 자율), 유효 키/별칭은 정규화', () => {
    expect(resolveForcedPreset(undefined)).toBeUndefined();     // 미지정 → 디자이너
    expect(resolveForcedPreset('auto')).toBeUndefined();        // 자동 → 디자이너
    expect(resolveForcedPreset('made-up')).toBeUndefined();     // 불명 → 안전하게 디자이너
    expect(resolveForcedPreset('handwritten_poster')).toBe('handwritten_poster'); // 유효 키
    expect(resolveForcedPreset('photorealistic')).toBe('photorealistic');
    expect(resolveForcedPreset('손글씨 포스터')).toBe('handwritten_poster');       // 한글 별칭
  });
});

describe('buildCardImagePrompt — 기존 에디토리얼 분기 보존', () => {
  it('전시 포스터·산세리프 구조를 유지하고, 손글씨 분기 문구는 안 씀', () => {
    const p = buildCardImagePrompt({ ...base, index: 1, preset: 'photorealistic' });
    expect(p).toContain('전시 포스터처럼');
    expect(p).toContain('산세리프');
    expect(p).not.toContain('손글씨 캘리그래피');
  });
});
