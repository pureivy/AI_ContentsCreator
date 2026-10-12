import { describe, it, expect } from 'vitest';
import {
  applyCardRevision, applyProofread, buildCardImagePrompt, buildSlideQaPrompt, buildSlideTranscribePrompt,
  coverIncludesKeyword, extractDesignFromDraftPrompt, findSlidesWithChars, parseSlideNosFromFeedback,
  resolveForcedPreset, stripForDiff, formatRecentEndings, cardVoiceGuide, cardStructureLines, ctaSlideIssues,
  CARD_HEADLINE_MAX_CHARS, CARD_BODY_MAX_LINES, CARD_BODY_MAX_CHARS, cardDensityOver, cardDensityIssues, fitCardDensity, withCoverKeyword, shrunkSlideOk,
  secondCoverIssues, cardCopyLintIssues } from './cardnews';
import { FIXED_STRUCTURE_SEED } from '../content/structureSeed';
import { cardVoiceIssues } from '../content/styleLint';
import { normalizeBrand } from '../content/brand';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

type CardPlan = Parameters<typeof applyCardRevision>[0];

describe('coverIncludesKeyword — 표지 키워드 정확 표기 게이트', () => {
  it('headline 또는 body 어느 쪽이든 정확 표기가 있으면 통과(택일 허용 유지)', () => {
    expect(coverIncludesKeyword([{ headline: '배롱나무 여름 관리 실수', body: '' }], '배롱나무')).toBe(true);
    expect(coverIncludesKeyword([{ headline: '라벨 한 줄, 3년을 가른다', body: '블루베리나무화분 구매 전 체크리스트' }], '블루베리나무화분')).toBe(true);
  });
  it('공백 차이는 무시("가을채소 흙준비" ≈ "가을채소흙준비")', () => {
    expect(coverIncludesKeyword([{ headline: '가을채소 흙준비 지금 시작', body: '' }], '가을채소흙준비')).toBe(true);
  });
  it('표지 어디에도 없으면 실패 — 수정 라운드·마지노선 트리거', () => {
    expect(coverIncludesKeyword([{ headline: '라벨 한 줄, 3년을 가른다', body: '구매 전 체크리스트' }], '블루베리나무화분')).toBe(false);
  });
  it('키워드 미지정·슬라이드 없음은 항상 통과', () => {
    expect(coverIncludesKeyword([{ headline: '아무 제목', body: '' }], undefined)).toBe(true);
    expect(coverIncludesKeyword([], '배롱나무')).toBe(true);
  });
});

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

  // 2026-08-13 전수 스캔 유출(발행본 2건 포함) — 자음 혼동쌍 체크리스트를 프롬프트에 고정.
  it('자음 혼동쌍(ㅌ↔ㄹ 등) 실측 유출 예시 포함', () => {
    const p = buildSlideQaPrompt('아무 제목', '');
    for (const ex of ['밑→밀', '짙→질', '바깥→바깔', '걷어→걸어', '눕혀→늪혀', '자리→사리', '깎→짝', '흰→휜', '헝겊→헝겁']) {
      expect(p).toContain(ex);
    }
  });

  it('블라인드 전사본을 주면 재검 근거로 포함, 없으면 미포함', () => {
    const p = buildSlideQaPrompt('제목', '본문', '보이는 대로 읽은\n텍스트');
    expect(p).toContain('1차 블라인드 전사');
    expect(p).toContain('보이는 대로 읽은 텍스트'); // 줄바꿈 접힘
    expect(buildSlideQaPrompt('제목', '본문')).not.toContain('1차 블라인드 전사');
  });
});

describe('buildSlideTranscribePrompt — 블라인드 전사(기대 편향 제거)', () => {
  it('기대 문구를 포함하지 않고, 추측 교정 금지·자형 확인 지시를 포함', () => {
    const p = buildSlideTranscribePrompt();
    expect(p).not.toContain('기대 문구]');       // 기대 문구 섹션 자체가 없어야 블라인드
    expect(p).toContain('고쳐 적지 말라');
    expect(p).toContain('ㅌ인지 ㄹ인지');
    expect(p).toContain('"transcribe"');
  });
});

describe('stripForDiff — 공백만 허용 차이(줄바꿈·띄어쓰기)', () => {
  it('공백·줄바꿈 제거 후 동일 판정', () => {
    expect(stripForDiff('밑에서 걷어\n냅니다')).toBe('밑에서걷어냅니다');
    expect(stripForDiff('밑에서걷어냅니다') === stripForDiff('밀에서 걷어냅니다')).toBe(false); // 자음 오염은 불일치
  });
});

describe('extractDesignFromDraftPrompt — 구 카드 수선용 역파싱(순수)', () => {
  it('실제 buildCardImagePrompt 출력에서 스타일·장면·프리셋을 복원한다', () => {
    const prompt = buildCardImagePrompt({
      headline: '제목', body: '본문', scene: '노을 지는 창가, 화분 하나',
      style: '따뜻한 자연광, 파스텔 팔레트', title: '가을 인사',
      index: 2, total: 4, hasRefs: false, preset: 'handwritten_poster',
    });
    const d = extractDesignFromDraftPrompt(prompt);
    expect(d.style).toBe('따뜻한 자연광, 파스텔 팔레트');
    expect(d.scene).toBe('노을 지는 창가, 화분 하나');
    expect(d.preset).toBe('handwritten_poster');
  });
  it('에디토리얼(비손글씨) 분기도 복원 — 표지(index 0) 접미문 제거 포함', () => {
    const prompt = buildCardImagePrompt({
      headline: '제목', body: '', scene: '책상 위 스케치',
      style: '단색 배경, 잉크 질감', title: '표지', index: 0, total: 3, hasRefs: true, preset: 'flat_design',
    });
    const d = extractDesignFromDraftPrompt(prompt);
    expect(d.style).toBe('단색 배경, 잉크 질감');
    expect(d.scene).toBe('책상 위 스케치');
    expect(d.preset).toBe('photorealistic'); // 비손글씨는 프리셋 구분 불가 — 범용 폴백
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

describe('applyCardRevision — 수정 요청 개정안 적용(순수)', () => {
  const base: CardPlan = {
    title: '올리브 제목', caption: '캡션', hashtags: ['#a'],
    slides: [
      { headline: 'h1', body: 'b1' },
      { headline: 'h2', body: 'b2\n둘째 줄' },
    ],
  };
  it('바뀐 슬라이드만 반영하고 번호를 돌려준다(1-base)', () => {
    const r = applyCardRevision(base, { slides: [{ index: 2, headline: '새 헤드라인' }] });
    expect(r).not.toBeNull();
    expect(r!.changedSlides).toEqual([2]);
    expect(r!.plan.slides[1]!.headline).toBe('새 헤드라인');
    expect(r!.plan.slides[1]!.body).toBe('b2\n둘째 줄'); // 미지정 필드 보존
    expect(r!.plan.slides[0]!.headline).toBe('h1');
  });
  it('범위 밖 번호·빈 문자열·동일 문구는 무시, 유효 변경 없으면 null', () => {
    expect(applyCardRevision(base, { slides: [{ index: 9, headline: 'x' }] })).toBeNull();
    expect(applyCardRevision(base, { slides: [{ index: 1, headline: '  ' }] })).toBeNull();
    expect(applyCardRevision(base, { slides: [{ index: 1, headline: 'h1' }] })).toBeNull();
    expect(applyCardRevision(base, null)).toBeNull();
  });
  it('캡션·해시태그(# 접두 보정)는 metaChanged 로 표시', () => {
    const r = applyCardRevision(base, { caption: '새 캡션', hashtags: ['나무', '#정원'] });
    expect(r!.metaChanged).toBe(true);
    expect(r!.changedSlides).toEqual([]);
    expect(r!.plan.caption).toBe('새 캡션');
    expect(r!.plan.hashtags).toEqual(['#나무', '#정원']);
  });
});

describe('findSlidesWithChars — 렌더 오타 신고 라우팅(순수)', () => {
  const slides = [
    { headline: '가지에 붙은 흰 것', body: '배롱나무' },
    { headline: '손톱으로 밀기', body: '흰가루병은 가루' },
    { headline: '물로 씻기', body: '헝겊으로 훑는다' },
  ];
  it('지목 글자가 든 슬라이드 번호(1-base)를 돌려준다', () => {
    expect(findSlidesWithChars(slides, ['흰'])).toEqual([1, 2]);
    expect(findSlidesWithChars(slides, ['훑'])).toEqual([3]);
    expect(findSlidesWithChars(slides, ['흰', '훑'])).toEqual([1, 2, 3]);
  });
  it('빈·과대 입력은 무시', () => {
    expect(findSlidesWithChars(slides, [])).toEqual([]);
    expect(findSlidesWithChars(slides, ['', '  '])).toEqual([]);
    expect(findSlidesWithChars(slides, ['일곱글자를넘는긴문자열'])).toEqual([]);
  });
});

describe('parseSlideNosFromFeedback — 명시 지목 슬라이드 파싱(순수)', () => {
  it("'N번 슬라이드'·'슬라이드 N'·'N번째 장' 꼴을 번호로 파싱한다", () => {
    expect(parseSlideNosFromFeedback('3번 슬라이드 오타 수정', 7)).toEqual([3]);
    expect(parseSlideNosFromFeedback('슬라이드 5 글자가 깨졌어요', 7)).toEqual([5]);
    expect(parseSlideNosFromFeedback('2번째 장이랑 6번 카드 오타', 7)).toEqual([2, 6]);
    expect(parseSlideNosFromFeedback('3번 슬라이드 오타 수정, 누렇거나, 뒷면, 옮겨', 7)).toEqual([3]); // 실사고 원문
  });
  it('범위 밖·매수 표현·번호 없음은 무시', () => {
    expect(parseSlideNosFromFeedback('9번 슬라이드', 7)).toEqual([]); // maxSlides 초과
    expect(parseSlideNosFromFeedback('전체적으로 8장 전부 좋아요', 7)).toEqual([]); // 'N장' 단독=매수
    expect(parseSlideNosFromFeedback('오탈자를 확인해서 수정해줘', 7)).toEqual([]);
  });
});

// ── 2026-08-27 말투 감사 권고 5 — 카드 마무리 로테이션(최근 5세트 회피 블록) ────────────────
describe('formatRecentEndings — 최근 마무리 원문 회피 블록(순수)', () => {
  it('마무리 장 headline/body 와 캡션 끝줄을 블록으로 만든다', () => {
    const block = formatRecentEndings([
      { headline: '오늘 할 일 세 가지', body: '물 아끼고 바람 통하게', captionTail: '저장해두고 비 오는 날마다 꺼내보세요.' },
      { headline: '내일 확인할 것', body: '', captionTail: '' },
    ]);
    expect(block).toContain('[최근 마무리');
    expect(block).toContain('오늘 할 일 세 가지');
    expect(block).toContain('물 아끼고 바람 통하게');
    expect(block).toContain('저장해두고 비 오는 날마다 꺼내보세요.');
    expect(block).toContain('내일 확인할 것');
  });

  it('마무리 원문이 없으면 빈 문자열(무주입)', () => {
    expect(formatRecentEndings([])).toBe('');
    expect(formatRecentEndings([{ headline: '', body: '', captionTail: '' }])).toBe('');
  });
});

// Fix wave(2026-08-27, 소견 3) — [말맛] 지시가 킬스위치를 보지 않아 두 구멍이 있었다:
//  ① VOICE_ROTATION=off 여도 로테이션 문구가 남아 base 로 안 돌아갔다.
//  ② off·신규 브랜드·읽기 실패로 endingsAvoid 가 비면 '아래 [최근 마무리]' 가 없는 블록을 가리켰다.
// 두 조건(스위치·원문 유무)에서 세 상태를 만든다.
describe('cardVoiceGuide — [말맛] 마무리 지시(VOICE_ROTATION × 최근 마무리 유무)', () => {
  it('off 면 base 문구(마무리 장은 권유형 고정)로 돌아간다', () => {
    const g = cardVoiceGuide(false, false);
    expect(g).toContain('마무리 장은 권유형("-해 보세요")으로');
    expect(g).not.toContain('[최근 마무리]');
    expect(g).not.toContain('관찰 장면');
  });

  // 2026-10-05 — 유형 메뉴를 전부 행동형으로 바꿨다. 종전 메뉴의 관찰 장면·결론 단정·"~이면 ~합니다"는 ctaSlideIssues 가 매번
  // 지적해 수정 라운드가 되돌리는 충돌이었다.
  it('on + 최근 마무리 없음 → 유형 로테이션만, 없는 블록을 참조하지 않는다', () => {
    const g = cardVoiceGuide(true, false);
    expect(g).toContain('조건+행동');
    expect(g).toContain('점검 질문');
    expect(g).not.toContain('[최근 마무리]');
  });
  it('on 메뉴의 유형은 전부 행동형 — ctaSlideIssues 가 지적하는 관찰 장면·결론 단정은 없다', () => {
    const g = cardVoiceGuide(true, true);
    expect(g).not.toContain('관찰 장면');
    expect(g).not.toContain('결론 단정');
  });

  it('on + 최근 마무리 있음 → 참조 문구가 붙는다', () => {
    const g = cardVoiceGuide(true, true);
    expect(g).toContain('아래 [최근 마무리] 와 같은 문형·같은 첫 어절 금지');
    expect(g).toContain('조건+행동');
  });

  it('세 상태 모두 보호 자산(어미 배합·행동 지시 목적어·안전 이유)을 유지한다', () => {
    for (const g of [cardVoiceGuide(false, false), cardVoiceGuide(true, false), cardVoiceGuide(true, true)]) {
      expect(g).toContain('전 장을 "-습니다"로 끝내지 마라');
      expect(g).toContain('손 높이 아래로');
      expect(g).toContain('위험·안전의 이유');
    }
  });
});

// Fix wave(2026-08-27, 소견 2) — 줄 수·해시태그 지시는 base(194bed6d) 프롬프트에 아예 없던 두 줄이다.
// STRUCTURE_VARIETY=off 면 시드 값만 고정되는 게 아니라 그 두 줄이 통째로 빠져야 base 와 같아진다.
describe('cardStructureLines — 카드 골격 지시(STRUCTURE_VARIETY)', () => {
  it('off 면 줄 수·해시태그 지시가 아예 빠진다(base 프롬프트)', () => {
    expect(cardStructureLines(FIXED_STRUCTURE_SEED, false)).toEqual([]);
  });
  // 2026-10-05 — 시드 cardLines(2~5)는 블로그와 공유라 범위를 못 바꾼다. 카드 쪽에서 글자 상한(2줄)으로 묶는다.
  it('on 이면 시드 값이 실리되 본문 줄 수는 상한(2줄)으로 묶인다', () => {
    const lines = cardStructureLines({ ...FIXED_STRUCTURE_SEED, cardLines: 3, hashtags: 11 }, true).join('\n');
    expect(lines).toContain(`${CARD_BODY_MAX_LINES}줄 이내`);
    expect(lines).not.toContain('3줄');
    expect(lines).toContain('11개');
  });
});

describe('ctaSlideIssues — 마무리 장이 행동으로 끝나는가', () => {
  const s = (headline: string, body = '') => ({ headline, body });

  it('실사고 재현 — 마무리 감상으로 끝나면 지적한다', () => {
    // 실측(card_34c4b86cc4): "잎자루 하나가 시작입니다 / 이름을 다 몰라도 무리는 나눌 수 있습니다"
    const out = ctaSlideIssues([s('참나무 종류, 잎자루부터'), s('잎자루 하나가 시작입니다', '이름을 다 몰라도\n무리는 나눌 수 있습니다')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('마지막 2번 장');
  });
  it('정보 장이 하나 더 붙은 꼴도 지적한다', () => {
    // 실측(card_22f52010ba)
    expect(ctaSlideIssues([s('표지'), s('블루베리 단풍 사과, 한 줄씩 다릅니다', '블루베리는 산성 흙, 피트모스 비중 높게')])).toHaveLength(1);
  });

  it('행동 지시로 끝나면 통과', () => {
    expect(ctaSlideIssues([s('표지'), s('심기 전에 두 팔을 벌려 보세요', '그 폭이 몇 해 뒤 나무 자리입니다')])).toHaveLength(0);
  });
  // 2026-10-05 — 마무리가 매번 "오늘, ~하세요"로 닫혔다. 행동은 인정하되 '오늘'로 여는 헤드라인만 따로 지적한다.
  it('행동 지시라도 헤드라인을 "오늘"로 열면 그것만 지적한다(실측 card_06f79a136b)', () => {
    const out = ctaSlideIssues([s('표지'), s('오늘 마당에서 두 팔을 벌려 보세요', '그 폭이 몇 해 뒤 나무 자리입니다')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"오늘"로 연다');
    expect(ctaSlideIssues([s('표지'), s('오늘, 흙부터 만져 보세요')])[0]).toContain('"오늘"로 연다');
    // 헤드라인 중간의 '오늘'·본문의 '오늘'은 대상이 아니다
    expect(ctaSlideIssues([s('표지'), s('물은 오늘 말고 내일 주세요')])).toHaveLength(0);
  });
  it('헤드라인이 서술문이어도 body 가 행동을 지시하면 통과', () => {
    // 실측(card_b60ec3e1bf) — 헤드라인만 보면 놓친다
    expect(ctaSlideIssues([s('표지'), s('거름과 전정, 지금은 순서가 다릅니다', '잎이 아직 짙다면 거름은 미루세요')])).toHaveLength(0);
  });
  it('다른 청유·명령 어미도 인정한다', () => {
    for (const t of ['심기 전에 확인해 보세요', '내일 아침에 살펴보십시오', '함께 정리합시다']) {
      expect(ctaSlideIssues([s('표지'), s(t)])).toHaveLength(0);
    }
  });

  it('마지막 장만 본다 — 중간 장의 행동 지시는 대상이 아니다', () => {
    expect(ctaSlideIssues([s('표지'), s('지금 잘라 보세요'), s('그래서 그렇습니다')])).toHaveLength(1);
  });
  it('표지뿐이면 마무리 장이 없으므로 통과', () => {
    expect(ctaSlideIssues([s('표지만')])).toHaveLength(0);
    expect(ctaSlideIssues([])).toHaveLength(0);
  });
  it('지적 문구가 무엇을 하라는지 알려준다 — 그대로 수정 라운드 입력이 된다', () => {
    const [msg] = ctaSlideIssues([s('표지'), s('끝입니다')]);
    expect(msg).toContain('구체적인 행동');
    expect(msg).toContain('하세요');
    expect(msg).not.toContain('오늘·지금'); // 2026-10-05 — '오늘·지금 할 일' 강요가 "오늘," 마무리 지문을 만들었다
  });
});

describe('ctaSlideIssues — 질문형 마무리도 인정', () => {
  const s = (headline: string, body = '') => ({ headline, body });
  it('독자에게 던지는 질문은 통과 — 댓글·자기 점검을 부른다', () => {
    // 실측(card_096bda17fd)
    expect(ctaSlideIssues([s('표지'), s('네 가지 중 어디에 해당하나요')])).toHaveLength(0);
    expect(ctaSlideIssues([s('표지'), s('올해는 어느 쪽이었을까요')])).toHaveLength(0);
    expect(ctaSlideIssues([s('표지'), s('당신 마당은 어떤가요?')])).toHaveLength(0);
  });
  it('서술 종결은 여전히 지적한다', () => {
    expect(ctaSlideIssues([s('표지'), s('낙엽수 심기는 10~11월입니다')])).toHaveLength(1);
  });
});

describe('buildCardImagePrompt — 수종 앵커(2026-09-06)', () => {
  const base = {
    headline: '결실주가 보증하는 건 나이와 형태뿐', scene: '어린 대추나무 전체 실루엣',
    style: '아이보리 종이 질감', title: '대추나무 결실주', index: 1, total: 8,
    hasRefs: false, preset: 'handwritten_poster',
  };
  it('앵커를 주면 학명과 형태를 못박는다 — 카드뉴스엔 이게 아예 없었다', () => {
    const p = buildCardImagePrompt({ ...base, subject: '대추나무 — 활엽 교목, 잎맥 세 개', subjectLatin: 'Ziziphus jujuba' });
    expect(p).toContain('[대상 식물 — 화면의 나무·풀은 반드시 이 종]');
    expect(p).toContain('Ziziphus jujuba');
    expect(p).toContain('잎맥 세 개');
    expect(p).toContain('다른 종으로 대체하거나');
  });
  it('앵커가 없으면 종전대로 무주입 — 수종 없는 주제를 막지 않는다', () => {
    expect(buildCardImagePrompt(base)).not.toContain('[대상 식물');
  });
  it('앵커는 전체 톤 바로 뒤에 온다 — 장면 설명보다 앞이라야 종이 먼저 정해진다', () => {
    const p = buildCardImagePrompt({ ...base, subjectLatin: 'Ziziphus jujuba' });
    expect(p.indexOf('[대상 식물')).toBeLessThan(p.indexOf('장면 설명'));
  });
});

// ── 2026-10-05 카드뉴스 분석 승인 항목 3 ─────────────────────────────────────────────
describe('카드 글자 상한 — 휴대폰 폭에서 읽히는 양(cardDensityOver·cardDensityIssues)', () => {
  const s = (headline: string, body = '') => ({ headline, body });
  it('상한: 헤드라인 20자, 본문 2줄·36자(공백 포함)', () => {
    expect([CARD_HEADLINE_MAX_CHARS, CARD_BODY_MAX_LINES, CARD_BODY_MAX_CHARS]).toEqual([20, 2, 36]);
  });
  it('상한 안이면 통과 — 경계값 포함', () => {
    expect(cardDensityOver([s('가'.repeat(20), `${'나'.repeat(18)}\n${'다'.repeat(18)}`)])).toEqual([]);
  });
  it('실측 과밀 장(본문 4줄 70자대)을 잡는다 — 장 번호와 사유를 함께', () => {
    // 실측(phone_size_bodies.jpg 가운데 카드) — 모과/명자 구별 본문
    const dense = s('줄기 아랫부분 모양이 가장 먼저 알려줍니다', '모과나무는 줄기 하나가\n곧게 올라갑니다\n명자나무는 줄기 아랫부분에서\n여러 대가 올라옵니다');
    const over = cardDensityOver([s('표지'), dense]);
    expect(over).toHaveLength(1);
    expect(over[0]!.no).toBe(2);
    expect(over[0]!.why).toMatch(/헤드라인 2\d자·본문 4줄/);
  });
  it('3줄이면 글자가 적어도 잡는다, 1줄이라도 37자면 잡는다', () => {
    expect(cardDensityOver([s('h', '가\n나\n다')])).toHaveLength(1);
    expect(cardDensityOver([s('h', '가'.repeat(37))])).toHaveLength(1);
  });
  it('지적은 한 건으로 묶고, 덜어 낸 세부는 캡션으로 보내라고 말한다', () => {
    const issues = cardDensityIssues([s('가'.repeat(25)), s('h', '가\n나\n다')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('1번(헤드라인 25자)');
    expect(issues[0]).toContain('2번(본문 3줄');
    expect(issues[0]).toContain('캡션');
  });
});

describe('fitCardDensity — 글자 상한 마지노선(줄 단위로만 덜어 낸다)', () => {
  const s = (headline: string, body = '') => ({ headline, body });
  it('넘친 본문은 뒤 줄부터 덜어 2줄·36자에 맞춘다 — 글자 단위로 자르지 않는다', () => {
    const r = fitCardDensity([s('h', '첫 줄은 남깁니다\n둘째 줄도 들어갑니다\n셋째 줄은 덜어 냅니다')]);
    expect(r.slides[0]!.body).toBe('첫 줄은 남깁니다\n둘째 줄도 들어갑니다');
    expect(r.trimmed).toEqual([1]);
  });
  it('둘째 문장을 붙이면 36자를 넘으면 첫 문장만 남긴다', () => {
    const r = fitCardDensity([s('h', `${'가'.repeat(19)}다\n${'나'.repeat(19)}다`)]);
    expect(r.slides[0]!.body).toBe(`${'가'.repeat(19)}다`);
  });
  // 리뷰(2026-10-05) — 줄 단위로 덜면 문장 앞토막이 남았다(최근 120세트 리플레이 242장). 문장 통째로만 남긴다.
  it('두 줄에 걸친 문장은 함께 남기고, 문장 중간에서 자르지 않는다', () => {
    const r = fitCardDensity([s('h', '잎이 지고 나서\n심는 게 좋아요\n서리 전이면 됩니다')]);
    expect(r.slides[0]!.body).toBe('잎이 지고 나서\n심는 게 좋아요');
  });
  it('실측 card_9f8d4bb233#6 — 종전엔 "…통째로 돌아가면" 앞토막만 남겼다. 첫 문장이 37자라 이제는 손대지 않는다', () => {
    const orig = s('h', '흔드는 정도가 아니라 통째로 돌아가면\n새 뿌리가 거의 없다는 뜻이에요\n이 경우는 교체 대상으로 봅니다');
    const r = fitCardDensity([orig]);
    expect(r.slides[0]).toBe(orig);
    expect(r.trimmed).toEqual([]);
  });
  it('첫 문장 하나가 상한을 넘으면(실측 "…골라\n…표시해 두세요") 손대지 않는다 — 잔존으로 남긴다', () => {
    const long = s('h', '마당에서 해 잘 드는 자리 하나를 골라\n다른 품종 한 그루를 심을 위치로 표시해 두세요');
    const r = fitCardDensity([long]);
    expect(r.slides[0]).toBe(long);
    expect(r.trimmed).toEqual([]);
  });
  it('한 줄 안의 두 문장은 나눠서 센다', () => {
    const r = fitCardDensity([s('h', '흙이 마르면 물을 주세요. 아침이 좋아요.\n저녁엔 잎이 젖어 병이 오기 쉬워서 피하는 게 좋습니다')]);
    expect(r.slides[0]!.body).toBe('흙이 마르면 물을 주세요. 아침이 좋아요.');
  });
  it('첫 줄 혼자 넘치거나 헤드라인이 넘치면 손대지 않는다(반쯤 잘린 문장이 그려지는 것보다 낫다)', () => {
    const long = s('가'.repeat(30), '나'.repeat(40));
    const r = fitCardDensity([long]);
    expect(r.slides[0]).toBe(long);
    expect(r.trimmed).toEqual([]);
  });
  it('상한 안의 장은 같은 객체 그대로', () => {
    const ok = s('h', '한 줄');
    expect(fitCardDensity([ok]).slides[0]).toBe(ok);
  });
});

describe('withCoverKeyword — 표지 키워드를 붙인 뒤에도 글자 상한(리뷰 2026-10-05)', () => {
  const s = (headline: string, body = '') => ({ headline, body });
  it('들어가면 "키워드, 본문" 그대로', () => {
    expect(withCoverKeyword(s('h', '흙부터 보세요'), '대추나무 심는 시기').body).toBe('대추나무 심는 시기, 흙부터 보세요');
  });
  it('넘치면 문장 통째로 덜어 낸다 — 36자를 다시 넘지 않는다', () => {
    const out = withCoverKeyword(s('h', '땅이 풀리면 바로 심으세요\n굳었으면 봄까지 기다리면 됩니다'), '대추나무 심는 시기');
    expect(out.body).toBe('대추나무 심는 시기, 땅이 풀리면 바로 심으세요');
    expect(cardDensityOver([out])).toEqual([]);
  });
  it('"키워드, 첫 문장"이 넘치면 키워드를 따로 한 줄에 둔다', () => {
    const body = '땅이 풀린 날 삽이 쑥 들어가면 바로 심으세요'; // 25자 — "키워드, " 를 붙이면 37자
    const out = withCoverKeyword(s('h', body), '대추나무 심는 시기');
    expect(out.body).toBe(`대추나무 심는 시기\n${body}`);
    expect(cardDensityOver([out])).toEqual([]);
  });
  it('본문 문장이 하나도 안 들어가면 키워드 한 줄만', () => {
    const out = withCoverKeyword(s('h', '가'.repeat(30) + '다'), '대추나무 심는 시기');
    expect(out.body).toBe('대추나무 심는 시기');
  });
});

describe('shrunkSlideOk — 줄이기 결과 채택 가드(리뷰 2026-10-05)', () => {
  const s = (headline: string, body = '') => ({ headline, body });
  it('본문이 있던 장을 본문 없이 돌려주면 버린다', () => {
    expect(shrunkSlideOk(s('물 주기', '겉흙이 마르면\n아침에 주세요\n저녁은 피하세요'), s('물 주기', ''))).toBe(false);
  });
  it('수치·월이 바뀌면 버리고, 덜어 내기만 했으면 채택', () => {
    const orig = s('심는 때', '10월 하순부터 11월 초순까지\n땅이 풀린 날 심으세요\n늦으면 봄에');
    expect(shrunkSlideOk(orig, s('심는 때', '11월 하순까지 심으세요'))).toBe(false);
    expect(shrunkSlideOk(orig, s('심는 때', '20cm 깊이로 심으세요'))).toBe(false);
    expect(shrunkSlideOk(orig, s('심는 때', '10월 하순부터 심으세요'))).toBe(true);
  });
  it('상한을 넘거나 헤드라인이 비면 버린다', () => {
    expect(shrunkSlideOk(s('h', 'a'), s('', '짧게'))).toBe(false);
    expect(shrunkSlideOk(s('h', 'a'), s('h', '가'.repeat(40)))).toBe(false);
  });
});

describe('secondCoverIssues — 2번 장은 두 번째 표지', () => {
  const s = (headline: string, body = '') => ({ headline, body });
  it('이어 말로 여는 2번 장을 잡는다(실측 "먼저, 흙덩이를 눌러 봅니다")', () => {
    const out = secondCoverIssues([s('묘목 식재 준비'), s('먼저, 흙덩이를 눌러 봅니다'), s('마무리 하세요')]);
    expect(out.some((x) => x.includes('이어 말'))).toBe(true);
  });
  it('대상 수종이 없으면 잡고, 있으면 통과한다(줄기 "배롱" 도 인정)', () => {
    const subj = ['배롱나무', '배롱'];
    expect(secondCoverIssues([s('표지'), s('꽃은 새 가지 끝에만 핀다'), s('끝')], subj).some((x) => x.includes('대상'))).toBe(true);
    expect(secondCoverIssues([s('표지'), s('배롱나무 꽃은 새 가지 끝에만'), s('끝')], subj)).toEqual([]);
    expect(secondCoverIssues([s('표지'), s('새 가지 끝에만 핀다', '배롱 꽃눈은 봄에 생겨요'), s('끝')], subj)).toEqual([]);
  });
  it('수종을 모르면(빈 배열) 대상 검사는 건너뛴다 · 2장 세트는 2번이 마무리라 보지 않는다', () => {
    expect(secondCoverIssues([s('표지'), s('꽃은 새 가지 끝에만 핀다'), s('끝')], [])).toEqual([]);
    expect(secondCoverIssues([s('표지'), s('그래서 지금 하세요')], ['배롱나무'])).toEqual([]);
  });
  it('"우선"으로 시작하는 낱말("우선순위")은 이어 말이 아니다 — 어절 경계를 본다', () => {
    expect(secondCoverIssues([s('표지'), s('우선순위는 뿌리입니다'), s('끝')])).toEqual([]);
  });
});

describe('cardVoiceIssues — 블로그와 같은 문장 검사를 카드 문구에', () => {
  const s = (headline: string, body = '') => ({ headline, body });
  it("'봅니다'는 세트당 1회까지(실측 헤드라인 \"~부터 봅니다\" 수렴)", () => {
    expect(cardVoiceIssues([s('사과나무묘목, 접붙인 자리가 먼저라고 봅니다'), s('잎은 나중이 낫다고 봅니다')])
      .some((x) => x.includes("'봅니다/보입니다' 2회") && x.includes('세트'))).toBe(true);
    expect(cardVoiceIssues([s('접붙인 자리가 먼저라고 봅니다'), s('잎은 나중에 확인하세요')])).toEqual([]);
    // 리뷰(2026-10-05) — 살펴보는 동작("~부터 봅니다")은 판단 유보가 아니라 세지 않는다(블로그와 같은 BOMNIDA_RE).
    expect(cardVoiceIssues([s('접붙인 자리부터 봅니다'), s('잎은 나중에 봅니다')])).toEqual([]);
  });
  it('1인칭 주어를 잡는다', () => {
    expect(cardVoiceIssues([s('저라면 봄까지 기다립니다')]).some((x) => x.includes('1인칭 주어 "저라면"'))).toBe(true);
  });
  it('겪지 않은 경험 주장을 잡는다(2026-10-05 대추나무 리비전 "저희가 직접 해 보며")', () => {
    const out = cardVoiceIssues([s('저희 밭 기준', '저희가 직접 해 보며 세운 기준')]);
    expect(out.some((x) => x.startsWith('1인칭 주어') && x.includes('저희가'))).toBe(true);
    expect(out.some((x) => x.startsWith('겪지 않은 경험 주장'))).toBe(true);
    expect(cardVoiceIssues([s('삽을 꽂아 직접 해 보세요')])).toEqual([]);
  });
  it('장끼리 거의 같은 줄을 잡는다(실측 "아직 눈이 뻗고 있다면 …")', () => {
    const out = cardVoiceIssues([s('표지'), s('기다릴 때', '아직 눈이 뻗고 있다면 며칠 더 기다립니다'), s('마무리', '아직 눈이 뻗고 있다면 며칠 더 지켜보세요')]);
    expect(out.some((x) => x.startsWith('장끼리 거의 같은 줄 1쌍') && x.includes('2번') && x.includes('3번'))).toBe(true);
  });
  it('같은 장 안의 헤드라인·본문 겹침, 수종명만 공유한 짧은 줄은 반복이 아니다', () => {
    expect(cardVoiceIssues([s('대추나무 심는 때', '대추나무 심는 때는 가을')])).toEqual([]);
    expect(cardVoiceIssues([s('대추나무 거름은 잎 진 뒤에'), s('대추나무 물은 아침에 주세요')])).toEqual([]);
  });
  it('-ㅂ니까 헤드라인·영어 직역·검색어 꼴·보고서 말투를 잡는다', () => {
    expect(cardVoiceIssues([s('무엇이 다릅니까?')]).some((x) => x.startsWith('딱딱한 질문 헤드라인'))).toBe(true);
    expect(cardVoiceIssues([s('마지막 가을 창입니다')]).some((x) => x.includes('영어 직역'))).toBe(true);
    expect(cardVoiceIssues([s('대추나무 심는시기, 지금')], '대추나무 심는시기').some((x) => x.includes('검색어 꼴'))).toBe(true);
    expect(cardVoiceIssues([s('심는 구간이 짧아요')]).some((x) => x.startsWith('보고서·직역 말투'))).toBe(true);
  });
  it('바른 띄어쓰기 키워드·말하는 헤드라인은 통과', () => {
    expect(cardVoiceIssues([s('대추나무 심는 시기, 언제일까요?'), s('흙이 풀리면 심으세요')], '대추나무 심는시기')).toEqual([]);
  });
  it('지적은 4건까지만(수정 라운드 입력이 넘치지 않게)', () => {
    const out = cardVoiceIssues([
      s('저는 봅니다'), s('다시 봅니다'), s('무엇이 다릅니까?'), s('마지막 가을 창입니다', '구간 셈법'),
      s('표지 줄 반복 확인 문장입니다'), s('표지 줄 반복 확인 문장입니다'),
    ]);
    expect(out.length).toBe(4);
  });
});

describe('buildCardImagePrompt — 본문 글자 크기(휴대폰 폭)', () => {
  it('본문이 있으면 두 분기 모두 크기 규칙을 싣고, 본문이 없으면 싣지 않는다', () => {
    for (const preset of ['photorealistic', 'handwritten_poster']) {
      expect(buildCardImagePrompt({ ...base, index: 1, preset })).toContain('본문 글자 크기');
      expect(buildCardImagePrompt({ ...base, body: '', index: 1, preset })).not.toContain('본문 글자 크기');
    }
  });
});

// 브랜드 카드 스타일 고정 해제(2026-10-05) — 08-10 a80d314 에서 풀었는데 08-12 데이터 동기화(d7634cf)로 handwritten_poster 가
// 되살아나, 정보·수치 카드까지 전부 손글씨 포스터로 나갔다. 풀린 상태면 launchCardNewsRun 의 stylePreset 이 undefined →
// resolveForcedPreset 도 undefined → 디자이너가 주제에 맞게 고른다(손글씨는 선택지로 남는다).
describe('bionditree 카드 스타일 고정 해제', () => {
  for (const rel of ['../../data/brands/bionditree.yaml', '../../data/brand.yaml']) {
    it(`${rel} — 로더로 읽어도 cardStyle 이 없다 → 디자이너 자동 선택`, () => {
      const file = fileURLToPath(new URL(rel, import.meta.url));
      if (!fs.existsSync(file)) return;
      const b = normalizeBrand(YAML.parse(fs.readFileSync(file, 'utf-8')));
      if (rel.endsWith('/data/brand.yaml') && b?.name !== 'bionditree') return; // 활성 브랜드가 바뀌었으면 해당 없음
      expect(b?.cardStyle).toBeUndefined();
      expect(resolveForcedPreset(b?.cardStyle)).toBeUndefined();
    });
  }
  it('손글씨 포스터는 선택지로 남는다', () => {
    expect(resolveForcedPreset('handwritten_poster')).toBe('handwritten_poster');
    expect(resolveForcedPreset('손글씨 포스터')).toBe('handwritten_poster');
  });
});

// 배선(planCards 가 수정 라운드 입력으로 쓰는 묶음) — 범주마다 하나씩 걸리는 기획안으로 묶음에 빠짐이 없는지 본다.
describe('cardCopyLintIssues — 카드 문구 결정적 린트 묶음(planCards 수정 라운드 입력)', () => {
  const s = (headline: string, body = '') => ({ headline, body });
  it('문체·글자 상한·2번 장·문장 검사가 모두 실린다', () => {
    const out = cardCopyLintIssues([
      s('대추나무 심는 시기, 지금이라고 봅니다'),
      s('그래서 흙이 먼저라고 봅니다', '첫 줄\n둘째 줄\n셋째 줄'),
      s('구간은 짧습니다'),
      s('뿌리가 마르면 늦습니다'),
      s('물은 아침에 줍니다'),
    ], '대추나무 심는시기', '대추나무 심는시기');
    expect(out.some((x) => x.includes("3장 연속 '-ㅂ니다'"))).toBe(true);      // cardStyleIssues
    expect(out.some((x) => x.startsWith('글자 과다'))).toBe(true);              // cardDensityIssues
    expect(out.some((x) => x.includes('이어 말'))).toBe(true);                  // secondCoverIssues
    expect(out.some((x) => x.includes("'봅니다/보입니다' 2회"))).toBe(true);    // cardVoiceIssues
  });
  it('깨끗한 기획안은 0건', () => {
    expect(cardCopyLintIssues([
      s('대추나무 심는 시기, 언제일까요?'), s('대추나무는 땅이 풀리면 심어요', '삽이 쑥 들어가면 됩니다'),
      s('물은 흙이 마를 때만'), s('심기 전에 삽을 꽂아 보세요'),
    ], '대추나무 심는시기', '대추나무 심는시기')).toEqual([]);
  });
});

// 2026-10-12 사장님 지시 — 카드 배경도 블로그 원문 묘사(사선으로 자른 끝·잎 없는 맨가지)를 따른다.
describe('buildCardImagePrompt — 원문 묘사 블록', () => {
  const base = { headline: 'h', scene: '삽수', style: 's', title: 't', index: 1, total: 5, hasRefs: false, preset: 'photorealistic' };
  it('must 가 있으면 보여야 함·나오면 안 됨을 싣고, 없으면 무주입', () => {
    const p = buildCardImagePrompt({ ...base, must: { show: ['잎 없는 맨가지'], not: ['칼'] } });
    expect(p).toContain('[원문 묘사 — 이 장면에 반드시 이렇게 보여야 함] 잎 없는 맨가지');
    expect(p).toContain('[이 장면에 나오면 안 됨 — 원문과 어긋남] 칼');
    expect(buildCardImagePrompt(base)).not.toContain('[원문 묘사');
  });
});
