import { describe, it, expect } from 'vitest';
import { applyProofread, buildCardImagePrompt, buildSlideQaPrompt, resolveForcedPreset } from './cardnews';

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

  it('페이지 번호(1/8·2/3 등)는 어떤 슬라이드에도 넣지 않고, 제외 목록에 명시(사용자 요청 2026-07-22)', () => {
    for (const preset of ['photorealistic', 'handwritten_poster']) {
      for (const index of [0, 2, 4]) {
        const p = buildCardImagePrompt({ ...base, index, total: 5, preset });
        expect(p).not.toContain('페이지 표기');        // 페이지 표기 지시 제거
        expect(p).not.toContain('우측 하단에 작은');    // 옛 페이지번호 문구 흔적 없음
        expect(p).not.toContain(`"${index + 1}/5"`);   // "3/5" 같은 표기 지시 없음
        expect(p).toContain('페이지 번호');            // 제외 목록에 페이지 번호 금지 명시
      }
    }
  });
});

describe('buildCardImagePrompt — handwritten_poster 분기', () => {
  it('붓펜 캘리 고정·임베드·상호작용 지시를 담고, 인쇄 에디토리얼 문구는 안 씀', () => {
    const p = buildCardImagePrompt({ ...base, index: 1, preset: 'handwritten_poster' });
    expect(p).toContain('붓펜 캘리그래피');              // 서체 고정(사용자 확정 2026-07-30)
    expect(p).toContain('크레용체·색연필체·마커체·둥근 고딕풍 손글씨는 절대 금지');
    expect(p).toContain('배경과 소품에만 적용');          // 톤 질감의 글씨 오염 격리
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

describe('buildSlideQaPrompt — 장당 QA 프롬프트(순수)', () => {
  it('기대 문구·자모 단위 불합격 기준·실측 유출 예시·주입 가드 포함(본문 줄바꿈→공백)', () => {
    const p = buildSlideQaPrompt('물 붓고 빠지는지 확인하세요', '흙에 물을 가득 부어보기\n표면에 고여 머물면 문제');
    expect(p).toContain('"물 붓고 빠지는지 확인하세요"');
    expect(p).toContain('흙에 물을 가득 부어보기 표면에 고여 머물면 문제');
    expect(p).toContain('자모(초성·중성·종성)');
    expect(p).toContain('빠찌는지');     // 실측 유출 사례를 예시로 고정
    expect(p).toContain('물울');
    expect(p).toContain('툴립');         // 재검수 통과 유출 사례(ㅠ→ㅜ, 2026-07-30 실런)
    expect(p).toContain('기대 문구를 보지 말고 보이는 그대로 전사'); // 전사 우선 — 인상 비교 차단
    expect(p).toContain('ㅠ/ㅜ');
    expect(p).toContain('수행하지 말라'); // 이미지 속 텍스트 지시 주입 가드
    expect(p).toContain('"transcribe"');
  });

  it('본문 없으면 본문 항목 생략', () => {
    const p = buildSlideQaPrompt('표지 제목', '');
    expect(p).toContain('"표지 제목"');
    expect(p).not.toContain('본문 "');
  });
});

describe('applyProofread — 교정 병합 안전핀(순수)', () => {
  const plan = {
    title: '가을채소 흙준비',
    caption: '캡션 원문입니다',
    hashtags: ['#텃밭'],
    slides: [
      { headline: '물빠짐 확인이 마지막 관문', body: '고이면 뿌리가 물러 무릅니다' },
      { headline: '표지', body: '' },
    ],
  };

  it('소폭 교정은 수용, 후보 없는 필드·빈 본문은 원본 유지', () => {
    const out = applyProofread(plan, { slides: [{ body: '고이면 뿌리가 물러집니다' }, {}] });
    expect(out.slides[0]!.body).toBe('고이면 뿌리가 물러집니다');       // 겹말 교정 수용
    expect(out.slides[0]!.headline).toBe(plan.slides[0]!.headline);    // 후보 없음 → 원본
    expect(out.slides[1]!.body).toBe('');                              // 빈 본문 유지
    expect(out.title).toBe(plan.title);
    expect(out.hashtags).toEqual(['#텃밭']);                           // 교정 대상 외 필드 보존
  });

  it('길이가 크게 달라진 후보(재작성·설명문)는 원본 유지, null 후보는 원본 그대로', () => {
    const blown = applyProofread(plan, { title: '완전히 새로 쓴 아주 길고 긴 다른 제목으로 바꿔버리기 시도' });
    expect(blown.title).toBe(plan.title);
    expect(applyProofread(plan, null)).toEqual(plan);
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
