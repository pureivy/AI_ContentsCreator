import { describe, it, expect } from 'vitest';
import { REVISE_NO_NEW_FACTS, buildReviseContext, BLOG_BODY_GUIDE, blogBodyGuide, buildGenreGuide, FactStarvedError, isFactStarved, shouldThrowStarved, frameOpenerItem } from './org';
import { structureBlock, STRUCTURE_KEEP_BLOCK, FIXED_STRUCTURE_SEED } from '../content/structureSeed';
import { FACT_CARD_HEADER } from '../content/factGate';

describe('리비전 컨텍스트(스펙 §3) — 브리프·목소리 지침이 개정에도 들어간다', () => {
  it('브리프·voiceGuide·기존 초안·수정 요청 순으로 조립한다', () => {
    const ctx = buildReviseContext({ brief: '브리프B', voiceGuide: '[근거와 목소리] V', baseBody: '## 초안', feedback: '고쳐라' });
    expect(ctx.indexOf('[근거와 목소리] V')).toBeGreaterThanOrEqual(0);
    expect(ctx.indexOf('[리서치·SEO 브리프]\n브리프B')).toBeLessThan(ctx.indexOf('[기존 초안]\n## 초안'));
    expect(ctx).toContain('[검토자 수정 요청 — 반드시 반영]\n고쳐라');
  });
  it('브리프가 없으면 그 블록만 빠진다', () => {
    const ctx = buildReviseContext({ brief: '', voiceGuide: 'V', baseBody: 'B', feedback: 'F' });
    expect(ctx).not.toContain('[리서치·SEO 브리프]');
  });
  it('새 사실 금지 문구 상수', () => {
    expect(REVISE_NO_NEW_FACTS).toContain('새 사실·수치·시기를 추가하지 마라');
  });
  it('사실 카드(2026-08-26)가 있으면 맨 앞 블록으로 들어간다', () => {
    const ctx = buildReviseContext({ factCard: '- 사실', brief: '브리프B', voiceGuide: 'V', baseBody: '## 초안', feedback: '고쳐라' });
    expect(ctx.startsWith(`${FACT_CARD_HEADER}\n- 사실`)).toBe(true);
  });
  it('사실 카드가 없으면 그 블록만 빠진다(기존 순서 불변)', () => {
    const ctx = buildReviseContext({ brief: '브리프B', voiceGuide: 'V', baseBody: 'B', feedback: 'F' });
    expect(ctx).not.toContain('[사실 카드');
  });
});

it('BLOG_BODY_GUIDE — 사실 범위 한정·[근거:] 표기 금지 문구', () => {
  expect(BLOG_BODY_GUIDE).toContain('브리프·제공 자료에 있는 것만 쓴다');
  expect(BLOG_BODY_GUIDE).toContain('[근거: …] 표기는 남기지 않는다');
  expect(BLOG_BODY_GUIDE).not.toContain('사실·수치는 근거로 뒷받침([근거: 출처])');
});

// 골격 다양화(2026-08-27 권고 4) — 자리 고정 문구가 매 글 같은 배치를 만들던 것을 시드에 위임한다.
it('BLOG_BODY_GUIDE — 인용구·프레임·표의 자리 고정 문구가 [이번 글 구조] 위임으로 바뀌었다', () => {
  expect(BLOG_BODY_GUIDE).toContain('글당 0~1곳 — 아래 [이번 글 구조] 지시를 따른다');
  expect(BLOG_BODY_GUIDE).not.toContain('글의 중심 명제 한 문장(글당 1곳, 도입 훅 직후가 최적)');
  expect(BLOG_BODY_GUIDE).toContain('아래 [이번 글 구조] 에서 켜졌을 때만');
  expect(BLOG_BODY_GUIDE).toContain('이번 글에 넣을지는 아래 [이번 글 구조] 를 따른다');
});

// Fix wave(2026-08-27, 소견 2) — 킬스위치 동일성 계약: STRUCTURE_VARIETY=off 는 '시드만 고정'이 아니라
// **프롬프트 문구까지 base 로** 돌아가야 한다. off 인데 위임 문구가 남으면 작가는 존재하지 않는
// [이번 글 구조] 블록을 참조하라는 지시를 받는다(소견 3 과 같은 성격의 매달린 참조).
describe('blogBodyGuide — STRUCTURE_VARIETY 킬스위치가 프롬프트 문구까지 되돌린다', () => {
  it('on 이면 종전 상수와 동일하다(위임 문구 유지)', () => {
    expect(blogBodyGuide(true)).toBe(BLOG_BODY_GUIDE);
  });
  it('off 면 [이번 글 구조] 참조가 하나도 남지 않는다', () => {
    expect(blogBodyGuide(false)).not.toContain('[이번 글 구조]');
  });
  it('off 면 base(194bed6d) 문구로 정확히 되돌아간다 — 도입·인용구·프레임·표', () => {
    const off = blogBodyGuide(false);
    expect(off).toContain('독자의 상황·질문으로 바로 시작한다');
    expect(off).toContain('글의 중심 명제 한 문장(글당 1곳, 도입 훅 직후가 최적)');
    expect(off).toContain('마무리 요약·행동 체크리스트 박스(글당 1곳, 연속 줄로 작성·최대 8줄');
    expect(off).toContain('마크다운 표(| 헤더 | ... |)로 제시하면 가독성이 높다(하우투·리뷰의 비교표에 특히 유용).');
  });
  it('off 여도 보호 자산(사실 범위 한정·프레임 20자 규칙·AI 티 금지)은 그대로다', () => {
    const off = blogBodyGuide(false);
    expect(off).toContain('브리프·제공 자료에 있는 것만 쓴다');
    expect(off).toContain('각 줄은 공백 포함 20자 이내로 짧게');
    expect(off).toContain('①인사·예고형 도입');
  });
});

it('리비전 컨텍스트에 [이번 글 구조] 블록이 들어간다(같은 시드 승계)', () => {
  const ctx = buildReviseContext({ brief: 'B', voiceGuide: 'V', baseBody: '초안', feedback: 'F', structure: '[이번 글 구조] 골격' });
  expect(ctx).toContain('[이번 글 구조] 골격');
  expect(ctx.indexOf('[이번 글 구조] 골격')).toBeLessThan(ctx.indexOf('[기존 초안]'));
});

// Fix round(finding 3) — 도입 자리 고정 문구('독자의 상황·질문으로 바로 시작한다')는 시드 openers 4값 중
// 3값(주장·대비·장면)과 경쟁하는 상시 처방이었다. 인사·예고형 도입 금지 자체는 남기고 꼬리만 위임한다.
// 2026-10-02 — 소제목 형식은 시드(headingStyle)가 돌린다. '소제목 1~2개는 구나 질문으로'가 상시로 남으면
// 번호·키워드 구 런과 충돌한다. off(blogBodyGuide(false))는 종전 문구 그대로.
it('BLOG_BODY_GUIDE — 소제목 형식을 [이번 글 구조] 에 위임하고, off 는 종전 문구를 유지한다', () => {
  expect(BLOG_BODY_GUIDE).toContain('소제목 형식은 아래 [이번 글 구조] 를 따른다');
  expect(BLOG_BODY_GUIDE).not.toContain('소제목 1~2개는 완결 서술문 대신');
  expect(blogBodyGuide(false)).toContain('소제목 1~2개는 완결 서술문 대신');
  expect(blogBodyGuide(false)).not.toContain('소제목 형식은 아래 [이번 글 구조]');
});

it('BLOG_BODY_GUIDE — 도입 유형도 [이번 글 구조] 에 위임한다', () => {
  expect(BLOG_BODY_GUIDE).toContain('도입 유형은 아래 [이번 글 구조] 를 따른다');
  expect(BLOG_BODY_GUIDE).not.toContain('독자의 상황·질문으로 바로 시작한다');
  expect(BLOG_BODY_GUIDE).toContain('①인사·예고형 도입');
});

// Fix round(finding 1) — 시드의 예고가 켜지면(뽑기의 2/3) genreGuide 의 '예고로 닫지 마라'와
// structureBlock 의 '맨 끝에 다음 편 한 줄'이 같은 프롬프트 안에서 정면 충돌한다. 켜진 런에서만 뺀다.
describe('buildGenreGuide — 장르 축 지침 × 구조 시드 예고', () => {
  const axes = ['고르기·구매', '심은 뒤 첫 계절 관리'];
  it('예고가 꺼진 런(기본)에는 "예고로 닫지 마라"가 붙는다', () => {
    expect(buildGenreGuide(axes)).toContain('예고로 닫지 마라');
    expect(buildGenreGuide(axes, false)).toContain('예고로 닫지 마라');
  });
  it('예고가 켜진 런에서는 그 문장만 빠지고 나머지 축 지침은 그대로다', () => {
    const g = buildGenreGuide(axes, true);
    expect(g).not.toContain('예고로 닫지 마라');
    expect(g).toContain('[글의 성격]');
    expect(g).toContain('1) 고르기·구매');
    expect(g).toContain('행동을 최소 하나 제시하라');
  });
  it('genreAxes 미설정 브랜드는 예고 여부와 무관하게 빈 문자열', () => {
    expect(buildGenreGuide([], true)).toBe('');
    expect(buildGenreGuide([], false)).toBe('');
  });
  it('다른 축 섹션을 덧붙이라는 문장이 없고, 한 축만 깊게 다루라는 문장이 있다', () => {
    const g = buildGenreGuide(axes);
    expect(g).not.toContain('최소 한 개 섹션은 다른 축으로');
    expect(g).not.toContain('첫 계절에 실제로 하는 일');
    expect(g).toContain('제목이 약속한 축 하나만');
    expect(g).toContain('다른 축의 섹션을 덧붙이지');
  });
  it('avoidTodayAction 이면 "오늘 해볼 행동" 요구를 뺀다', () => {
    expect(buildGenreGuide(axes, false, true)).not.toContain('행동을 최소 하나 제시하라');
    expect(buildGenreGuide(axes, false, false)).toContain('행동을 최소 하나 제시하라');
  });
  it('이야기 글(전설·꽃말·유래…) 예외가 명시된다', () => {
    expect(buildGenreGuide(axes)).toContain('전설·꽃말·유래·역사·쓰임새·문학·명소');
  });
});

describe('FactStarvedError — 사실 부족 종료 신호', () => {
  it('count/need/species 를 싣고 name 으로 식별된다', () => {
    const e = new FactStarvedError({ topic: '음나무 자리', count: 2, need: 5, species: '음나무' });
    expect(e.name).toBe('FactStarvedError');
    expect(e.message).toContain('고유 사실 2건');
    expect(e.count).toBe(2); expect(e.need).toBe(5); expect(e.species).toBe('음나무');
    expect(isFactStarved(e)).toBe(true);
    expect(isFactStarved(new Error('x'))).toBe(false);
  });
  it('kind=lore 는 메시지·필드에 이야기 부족으로 남는다(2026-09-18)', () => {
    const e = new FactStarvedError({ topic: '마가목 설화와 자생지', count: 3, need: 4, species: '마가목', kind: 'lore' });
    expect(e.kind).toBe('lore');
    expect(e.message).toContain('이야기 사실 3건 < 4');
    expect(new FactStarvedError({ topic: 't', count: 1, need: 5 }).kind).toBeUndefined();
  });
});

describe('buildGenreGuide — 이야기 글 예외(2026-09-18 정정)', () => {
  const axes = ['재배', '이야기'];
  it('작가가 베끼던 예시 구절이 없고, 분류어는 실제 이야기가 있을 때만 쓰라고 한다', () => {
    const g = buildGenreGuide(axes);
    expect(g).not.toContain('이야기가 남긴 한 가지');
    expect(g).toContain('분류어만 있고 이야기가 없으면 제목에서 그 말을 빼고');
    expect(g).toContain('옮기기 같은 작업 지시 섹션을 덧붙이지 말고');
  });
});

it('BLOG_BODY_GUIDE — 결론 의무 문구에 "오늘 할" 토큰이 없다(금지 모듈 "오늘 할 일 하나"와 충돌하지 않게)', () => {
  expect(BLOG_BODY_GUIDE).not.toContain('오늘 할 행동');
  expect(BLOG_BODY_GUIDE).toContain('독자가 할 행동을 반드시 말하라');
  expect(blogBodyGuide(false)).not.toContain('오늘 할 행동');
});

describe('BLOG_BODY_GUIDE — 사실 공급 블록을 뼈대로 쓰라는 지침', () => {
  it('일반론으로 채우지 말라는 문장이 있다', () => {
    expect(BLOG_BODY_GUIDE).toContain('[재배·이야기 사실 조사');
    expect(BLOG_BODY_GUIDE).toContain('일반론으로 섹션을 채우지 마라');
    expect(blogBodyGuide(false)).toContain('일반론으로 섹션을 채우지 마라'); // 킬스위치 off 문구에도 — 골격 다양화와 무관한 지침
  });
});

describe('shouldThrowStarved — 사실 부족으로 던질 것인가(최종 리뷰 I3)', () => {
  it('엄격 런 + 수종 + 기준 미만 → 던진다', () => {
    expect(shouldThrowStarved(true, '음나무', 2, 5)).toBe(true);
  });
  it('수종 없는 소재는 엄격 런이라도 던지지 않는다(표시만)', () => {
    expect(shouldThrowStarved(true, undefined, 0, 5)).toBe(false);
    expect(shouldThrowStarved(true, '', 0, 5)).toBe(false);
  });
  it('엄격이 아니면 던지지 않는다', () => {
    expect(shouldThrowStarved(false, '음나무', 0, 5)).toBe(false);
  });
  it('기준 이상이면 던지지 않는다', () => {
    expect(shouldThrowStarved(true, '음나무', 5, 5)).toBe(false);
  });
});

// 2026-10-02 — [구성 반복 회피] ⑤는 [이번 글 구조] 블록에 도입 유형 줄이 있을 때만 위임한다. 유지 블록(STRUCTURE_KEEP_BLOCK)엔
// 도입 유형이 없어, 블록 유무만 보고 위임하면 없는 지시를 가리키게 된다.
describe('frameOpenerItem — ⑤ 도입 단정 대안', () => {
  const delegate = '도입 유형은 [이번 글 구조] 를 따른다';
  it('집필 블록(structureBlock — 도입 유형 줄 있음)이면 위임한다', () => {
    expect(frameOpenerItem(structureBlock(FIXED_STRUCTURE_SEED))).toContain(delegate);
    expect(frameOpenerItem(structureBlock(FIXED_STRUCTURE_SEED, { revise: true }))).toContain(delegate);
  });
  it('유지 블록(도입 유형 없음)·빈 블록이면 종전 대안 목록', () => {
    for (const s of [STRUCTURE_KEEP_BLOCK, '']) {
      expect(frameOpenerItem(s)).not.toContain(delegate);
      expect(frameOpenerItem(s)).toContain('현장 장면 묘사, 절기·날씨 신호, 통념 반박, 실제 질문 인용으로');
    }
  });
});

// 2026-10-05 — 한 문장 한 줄(편집 확정 규칙)과 맞물리게 '문단' 셈을 빈 줄 사이 덩어리로 옮겼다. 두 줄은 STRUCTURE_VARIETY 와
// 무관한 공통 줄이라 on/off 지침이 함께 바뀐다(off 의 base 동일성 계약은 [이번 글 구조] 위임 문구에 대한 것이다).
describe('blogBodyGuide — 한 문장 한 줄과 양립하는 어미 배합·가독성(2026-10-05)', () => {
  for (const [name, g] of [['on', blogBodyGuide(true)], ['off', blogBodyGuide(false)]] as const) {
    it(`${name}: 어미 배합은 덩어리 단위로 센다(줄마다 1개가 아니다)`, () => {
      expect(g).toContain('어미 배합(덩어리 규칙)');
      expect(g).toContain('빈 줄 없이 이어진 줄들은 한 덩어리로 센다');
      expect(g).toContain('**2~3문장 덩어리는 1개, 4문장 덩어리는 2개**');
      expect(g).not.toContain('2~3문장 문단은 1개');
    });
    it(`${name}: 가독성은 덩어리 2~4문장 + 덩어리 안 줄바꿈 허용`, () => {
      expect(g).toContain('빈 줄로 나뉜 덩어리 하나는 2~4문장');
      expect(g).toContain('한 문장마다 줄을 바꿔 써도 같은 덩어리다');
      expect(g).not.toContain('한 문단은 2~4문장');
    });
  }
});
