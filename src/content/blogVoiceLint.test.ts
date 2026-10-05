import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  briefCopyIssues, judgmentHedgeIssues, repetitionIssues, orphanFragmentIssues, reportSpeakIssues, headingIssues,
  summaryCoherenceIssues, unsupportedClaimTokens, blogVoiceIssues, cleanImageMarkerDesc, imageMarkerIssues,
} from './blogVoiceLint';
import { blogStyleIssues } from './styleLint';

// 2026-10-05 대추나무 초안 전수 분석 — 실제 사례로 고정한다.
//  · 휴지통 초안(data/.trash/…/17204dfaf8d3 draft.json bodyMarkdown)과 그 브리프(research_brief.md): 걸려야 한다.
//  · 사람 편집자 고쳐 쓰기(같은 사실, 목표 말투): 걸리면 안 된다. 1인칭 판단 한 줄("저라면 …")은 사장님 결정(1인칭 금지)에 따라 뺀 판.
// 휴지통은 7일 뒤 정리되므로(janitor) 사본을 fixtures 에 둔다.
const fx = (name: string): string => fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8');
const TRASHED = fx('jujube-trashed-body.md');
const BRIEF = fx('jujube-trashed-brief.md');
const EXEMPLAR = fx('jujube-exemplar-body.md');
const KW = '대추나무 심는시기';

describe('사람 편집자 고쳐 쓰기(목표 말투)는 새 린트를 모두 통과한다', () => {
  it('blogVoiceIssues 0건(브리프·키워드 포함)', () => {
    expect(blogVoiceIssues(EXEMPLAR, { keyword: KW, brief: BRIEF })).toEqual([]);
  });
  // ⓒ 유보 중첩은 종전에 "보통 … 수 있어요"를 두 겹 유보로 세어 이 고쳐 쓰기를 2건 지적했다 — 작가 지침("보통 ~입니다")과
  // 싸우던 것. 가능의 '수 있'을 약한 유보로 낮춘 뒤(styleLint.hedgeStacked) 기존 린트까지 합쳐 0건이어야 한다.
  it('blogStyleIssues 전체(기존 ⓐ~ⓓ 포함)도 0건', () => {
    expect(blogStyleIssues(EXEMPLAR, KW, BRIEF)).toEqual([]);
  });
  it('뺀 1인칭 줄을 되돌리면 1인칭만 걸린다', () => {
    const withFp = `${EXEMPLAR.trimEnd()}\n\n저라면 삽이 시원하게 들어가는 해에는 가을에 심고, 아니면 미련 없이 봄을 기다리겠습니다.\n`;
    const r = blogVoiceIssues(withFp, { keyword: KW, brief: BRIEF });
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('1인칭 주어 "저라면"');
  });
});

describe('① briefCopyIssues — 브리프 문장·소제목 복사', () => {
  it('휴지통 초안: 템플릿 문장("그해 식재는 접고 봄으로 넘깁니다")과 확정 H2 를 잡는다', () => {
    const r = briefCopyIssues(TRASHED, BRIEF);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatch(/^브리프 문장 복사 \d+문장/);
    expect(r[0]).toContain('그해 식재는 접고 봄으로 넘깁니다');
    expect(r[1]).toContain('가을·봄 대추나무 식재시기 비교');
  });
  it('사실 두어 개를 옮긴 정도(2문장 이하)는 통과 — 고쳐 쓴 글은 브리프 서리 사실을 옮기고도 0건', () => {
    expect(briefCopyIssues(EXEMPLAR, BRIEF)).toEqual([]);
    const body = ['## 가을에 심을까요', '삽이 쉽게 들어가지 않을 만큼 땅이 굳었다면 그해 식재는 접고 봄으로 넘깁니다.', '나머지는 새로 쓴 문장이에요.'].join('\n');
    expect(briefCopyIssues(body, BRIEF)).toEqual([]);
  });
  it('자동 수집 사실 절(재배·이야기 사실 조사)은 비교에서 뺀다', () => {
    const brief = ['## 각도', '새 문장입니다.', '## 재배·이야기 사실 조사(자동 수집)', '- 대추나무는 싹이 아주 늦게 트는 나무로 알려져 있습니다 다른 나무보다 늦어요.'].join('\n');
    const body = Array.from({ length: 4 }, () => '대추나무는 싹이 아주 늦게 트는 나무로 알려져 있습니다 다른 나무보다 늦어요.').join('\n');
    expect(briefCopyIssues(body, brief)).toEqual([]);
  });
  it('브리프가 없으면 검사하지 않는다', () => {
    expect(briefCopyIssues(TRASHED, '')).toEqual([]);
    expect(briefCopyIssues(TRASHED, undefined)).toEqual([]);
  });
});

describe("② judgmentHedgeIssues — '봅니다' 상한·1인칭 주어", () => {
  // 리뷰(2026-10-05) 뒤로는 판단 꼴("~다고/~라고 봅니다")만 센다 — "혼식 비율은 20% 정도를 봅니다"(셈 잡기)는 빠져 3→2회.
  it("휴지통 초안: 판단 '봅니다' 2회 → 글당 1회까지", () => {
    const r = judgmentHedgeIssues(TRASHED);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("'봅니다/보입니다' 2회");
    expect(r[0]).toContain('흙 온도가 이미 많이 떨어졌다고 봅니다');
  });
  it('1회는 통과, 눈에 보인다는 "보입니다"는 세지 않는다', () => {
    expect(judgmentHedgeIssues('겉흙이 마르면 물을 줍니다.\n흙이 식었다고 봅니다.\n가지 끝만 보입니다.')).toEqual([]);
    expect(judgmentHedgeIssues('흙이 식었다고 봅니다.\n양분이 모자란 것으로 보입니다.')[0]).toContain('2회');
  });
  it('1인칭 주어(저는·제가·저라면·저희는)를 잡고, "문제가"·"제거" 같은 낱말 속 글자는 두다', () => {
    expect(judgmentHedgeIssues('저는 봄에 심습니다.')[0]).toContain('"저는"');
    expect(judgmentHedgeIssues('저희는 이렇게 합니다. 제가 보기엔 괜찮아요.')[0]).toMatch(/저희는.*제가|제가.*저희는/);
    expect(judgmentHedgeIssues('문제가 생기면 잎을 제거하세요. 저녁에 물을 주세요.')).toEqual([]);
  });
  it('소제목은 세지 않는다', () => {
    expect(judgmentHedgeIssues('## 어디를 봅니까\n## 무엇을 봅니까\n본문이에요.')).toEqual([]);
  });
  // 리뷰(2026-10-05) — 최근 40편 리플레이의 '봅니다' 발동 중 관찰 동작이 섞여 있었다(라일락 겨울눈·감나무 그늘 글).
  it('판단 꼴만 센다 — 살펴보는 동작("겹쳐 봅니다", "생김새부터 봅니다", "밖인지 봅니다")은 세지 않는다', () => {
    expect(judgmentHedgeIssues('그 짝의 생김새부터 봅니다.\n통통한 정도, 끝 모양, 붙은 높이 이 세 군데를 겹쳐 봅니다.\n점심 무렵 그 돌이 그늘 안인지 밖인지 봅니다.')).toEqual([]);
    expect(judgmentHedgeIssues('겨울을 버티는 힘도 적다고 봅니다.\n대개 꽃이 아니라 열매로 봅니다.')[0]).toContain('2회');
    expect(judgmentHedgeIssues('교체하는 게 낫다고 봅니다.\n잎이 시든 것처럼 보입니다.')[0]).toContain('2회');
  });
  // 2026-10-05 대추나무 리비전 dbb3ea1b6aa6 실측 문장 — 1인칭 + 겪지 않은 경험 주장.
  it('"저희가 직접 해 보며 세운 기준" — 1인칭과 경험 주장을 둘 다 잡는다, 독자에게 권하는 "직접 해 보세요"는 통과', () => {
    const r = judgmentHedgeIssues('아래는 경산 밭에서 저희가 직접 해 보며 세운 기준입니다.');
    expect(r.some((x) => x.startsWith('1인칭 주어') && x.includes('저희가'))).toBe(true);
    expect(r.some((x) => x.startsWith('겪지 않은 경험 주장') && x.includes('해 보며'))).toBe(true);
    expect(judgmentHedgeIssues('우리 밭은 물이 잘 빠집니다.')[0]).toContain('우리 밭');
    expect(judgmentHedgeIssues('대추나무를 키워 보니 싹이 늦었어요.').some((x) => x.includes('키워 보니'))).toBe(true);
    expect(judgmentHedgeIssues('삽을 꽂아 직접 해 보세요.\n봄에 심어 보면 차이를 알 수 있어요.\n우리말로는 대추라고 합니다.')).toEqual([]);
    expect(judgmentHedgeIssues('땅이 얼면 심어 봤자 뿌리가 못 내려요.\n직접 해 보면서 감을 잡으세요.')).toEqual([]); // "-어 봤자"·권유
  });
});

describe('③ repetitionIssues — 반복', () => {
  const r = repetitionIssues(TRASHED);
  it('휴지통 초안: 거의 같은 문장·같은 날짜·같은 권고·요약 되풀이를 모두 잡는다', () => {
    expect(r.find((x) => x.startsWith('거의 같은 문장 반복'))).toContain('그해 심기는 접습니다');
    expect(r.find((x) => x.startsWith('같은 날짜 표현 반복'))).toContain('"3월 중순" 4회');
    expect(r.find((x) => x.startsWith('같은 권고'))).toBeTruthy();
    expect(r.find((x) => x.startsWith('굵은 요약을 도입이 되풀이'))).toContain('10월 하순부터 11월 초순까지');
  });
  it('표 칸의 날짜는 세지 않는다(리뷰 2026-10-05 — 비교표는 칸마다 같은 월을 적는다)', () => {
    const md = '| 구분 | 시기 |\n|---|---|\n| 노지묘 | 10월 하순 |\n| 화분묘 | 10월 하순 |\n| 접목묘 | 10월 하순 |\n\n가을엔 10월 하순에 심어요.';
    expect(repetitionIssues(md).filter((x) => x.startsWith('같은 날짜'))).toEqual([]);
  });
  it('같은 날짜 2회까지는 통과', () => {
    expect(repetitionIssues('가을엔 10월 하순에 심어요.\n10월 하순이 지나면 서리가 와요.').filter((x) => x.startsWith('같은 날짜'))).toEqual([]);
  });
  it('비교 문장 한 쌍(0.5 미만)은 반복이 아니다', () => {
    expect(repetitionIssues('모과나무는 가는 가지에 가시가 없습니다.\n명자나무는 가지에 가시가 있는 편이라고 알려져 있어요.')).toEqual([]);
  });
  it('글의 소재어(가지·눈)만 겹치는 권고는 같은 권고로 묶지 않는다', () => {
    const body = [
      '눈은 크기부터 재지 말고, 가지의 어느 높이에 붙었는지를 먼저 보세요.',
      '꽃이 붙었던 가지의 끝눈과 지금 가지의 끝눈을 나란히 놓고 비교하세요.',
      '표시해 둔 가지는 이듬해 봄까지 그대로 두세요.',
      '눈이 작다면 작년에 가지를 어디서 잘랐는지 되짚어 보세요.',
      '가지 끝의 눈이 통통하면 꽃눈이고, 가지 중간의 눈이 홀쭉하면 잎눈이에요.',
      '눈이 붙은 가지는 겨울에도 자르지 않아요.',
    ].join('\n');
    expect(repetitionIssues(body).filter((x) => x.startsWith('같은 권고'))).toEqual([]);
  });
  it('첫 소제목 앞 인용 — 굵은 요약과 함께 있거나 2곳 이상이면 지적', () => {
    expect(repetitionIssues('**요약 한 줄이에요.**\n\n도입이에요.\n\n> 인용이에요.\n\n## 본론\n내용이에요.')[0]).toContain('첫 소제목 앞 인용 1곳(굵은 요약과 함께)');
    expect(repetitionIssues('도입이에요.\n\n> 인용 하나.\n\n>> 인용 둘.\n\n## 본론\n내용.')[0]).toContain('첫 소제목 앞 인용 2곳');
    expect(repetitionIssues('도입이에요.\n\n> 인용 하나.\n\n## 본론\n> 본문 인용.')).toEqual([]);
  });
});

describe('④ orphanFragmentIssues — 토막 줄', () => {
  it('휴지통 초안의 "~고요." 토막 3줄을 모두 잡는다', () => {
    const r = orphanFragmentIssues(TRASHED);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('토막 줄 3개');
    for (const s of ['봄에 심는다면 3월 중순에서 4월 중순이고요.', '다섯 그루 심으면 한 그루를 수분수로 두는 셈법이고요.', '그 시기가 가을보다 성공률이 높고요.']) expect(r[0]).toContain(s);
  });
  it('긴 "~고요." 줄·덩어리 첫 줄·"~거든요." 줄은 토막이 아니다', () => {
    expect(orphanFragmentIssues('첫 줄입니다.\n같은 11월이라도 해마다, 동네마다, 밭마다 땅 사정이 꽤 다르고 서리 오는 날도 다르고요.')).toEqual([]);
    expect(orphanFragmentIssues('## 소제목\n봄에 심는다면 4월이고요.')).toEqual([]);
    expect(orphanFragmentIssues('첫 줄입니다.\n동네마다 땅 사정이 다르거든요.')).toEqual([]);
  });
  it('짧은 "~죠." 꼬리 줄도 잡는다', () => {
    expect(orphanFragmentIssues('가을에 심으면 뿌리가 먼저 자리 잡아요.\n그게 장점이죠.')[0]).toContain('그게 장점이죠.');
  });
});

describe('⑤ reportSpeakIssues — 보고서·직역 말투', () => {
  it('휴지통 초안의 구간·셈법·접다·묻다·뜻이 있다·쪽으로 움직이다·확률이 높다를 잡는다', () => {
    const r = reportSpeakIssues(TRASHED);
    expect(r).toHaveLength(1);
    for (const label of ['구간', '셈법', '접다(포기)', '묻다(심다)', '뜻이 있다', '~쪽으로 움직이다', '~하는 쪽이 낫다/확률이 높다']) expect(r[0]).toContain(`(${label}`);
  });
  it('감안하고 가다·가늠·쪽이 낫다', () => {
    expect(reportSpeakIssues('알이 작아지는 것을 감안하고 가세요.')[0]).toContain('감안하고 가다');
    expect(reportSpeakIssues('흙 상태로 가늠합니다.')[0]).toContain('가늠');
    expect(reportSpeakIssues('봄까지 기다리는 쪽이 낫습니다.')[0]).toContain('쪽이 낫');
  });
  it('"뜻이에요"(낱말 풀이)는 통과, "뜻이 있어요/있습니다"만 잡는다 · 접다의 대체어는 계절을 박지 않는다(리뷰 2026-10-05)', () => {
    expect(reportSpeakIssues("'대추'라는 이름은 붉은 열매라는 뜻이에요. 그 말이 이 뜻입니다.")).toEqual([]);
    expect(reportSpeakIssues('이 꽃말에는 이런 뜻이 있어요.')[0]).toContain('뜻이 있다');
    const r = reportSpeakIssues('그해 심기는 접습니다.')[0]!;
    expect(r).toContain('"올해는 미루세요"');
    expect(r).not.toContain('봄에 심으세요');
  });
  it('가식("임시로 묻어 두세요")·묻다(물어보다)·"~라는 뜻이니"·우산 접기는 통과', () => {
    for (const t of ['구해 둔 묘목이 있다면 땅이 풀린 뒤까지 임시로 묻어 두세요.', '판매처에 품종을 묻고 사세요.', '서리가 앉았다면 흙도 식었다는 뜻이니 그 주 안에 끝내세요.', '비가 그치면 우산을 접고 들어오세요.', '가지를 접어 두면 꺾여요.']) {
      expect(reportSpeakIssues(t), t).toEqual([]);
    }
  });
});

describe('⑥ headingIssues — 소제목', () => {
  it('휴지통 초안: 키워드 2곳·수종명 4곳', () => {
    const r = headingIssues(TRASHED, KW);
    expect(r.find((x) => x.startsWith('소제목 키워드 2곳'))).toBeTruthy();
    expect(r.find((x) => x.startsWith('소제목 수종명 "대추나무" 4곳'))).toBeTruthy();
  });
  it('"~습니까?" 질문 소제목을 잡고 "~나요?/~할까요?"는 통과', () => {
    expect(headingIssues('## 뭐가 다릅니까?\n본문.')[0]).toContain('"~할까요?/~나요?"');
    expect(headingIssues('## 지금 심어도 될까요?\n## 언제 심나요?\n본문.')).toEqual([]);
  });
  it('키워드가 계절·일반어로 시작하면 수종 검사는 건너뛴다', () => {
    expect(headingIssues('## 가을 볕\n## 가을 물주기\n## 가을 거름', '가을 묘목 심기')).toEqual([]);
  });
  it('키워드가 수종 이름 한 낱말이면 키워드 1곳 상한은 걸지 않는다 — 수종명 2곳 상한만(리뷰 2026-10-05)', () => {
    expect(headingIssues('## 블루베리 화분 고르기\n## 블루베리 흙\n## 물주기\n', '블루베리')).toEqual([]);
    const r = headingIssues('## 블루베리 화분 고르기\n## 블루베리 흙\n## 블루베리 물주기\n', '블루베리');
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('소제목 수종명 "블루베리" 3곳');
    expect(headingIssues('## 블루베리 화분 고르기\n## 블루베리 화분 흙\n', '블루베리 화분')[0]).toContain('소제목 키워드 2곳'); // 두 낱말 키워드는 그대로
  });
  it('키워드 1곳·수종명 2곳까지는 통과(띄어쓰기 꼴도 같은 키워드로 센다)', () => {
    expect(headingIssues('## 대추나무 심는 시기\n## 대추나무 묘목 고르기\n## 심는 순서', KW)).toEqual([]);
    expect(headingIssues('## 대추나무 심는 시기\n## 대추나무를 심는 시기, 봄', KW)[0]).toContain('소제목 키워드 2곳');
  });
});

describe('⑦ 일관성 — 제목·메타·굵은 요약의 주장은 본문에 근거가 있어야 한다', () => {
  it('휴지통 제목·메타: 성공률·vs·마지막·생존율이 본문 근거 없이 나온다', () => {
    expect(unsupportedClaimTokens('대추나무 심는시기, 가을 vs 봄 성공률이 다른 이유', '봄에 심어요. 가을에 심어요.')).toEqual(['vs', '성공률']);
    const meta = '10월 하순부터 11월 초순이 대추나무 심는시기의 마지막 가을 창입니다. 너무 늦으면 생존율이 높은 봄으로 미루세요.';
    expect(unsupportedClaimTokens(meta, TRASHED)).toEqual(['생존율']); // 휴지통 본문엔 '마지막'(단계)·날짜가 있어 걸리지 않는다
    expect(unsupportedClaimTokens(meta, EXEMPLAR)).toEqual(['마지막', '생존율']);
  });
  it('본문에 있는 날짜·주장어는 통과, 없는 날짜는 잡는다', () => {
    expect(unsupportedClaimTokens('10월 하순에 심어요', '가을엔 10월 하순부터 심어요.')).toEqual([]);
    expect(unsupportedClaimTokens('11월 하순까지 심어요', '가을엔 10월 하순부터 심어요.')).toEqual(['11월 하순']);
  });
  it('굵은 요약에만 있는 주장', () => {
    expect(summaryCoherenceIssues('**가장 좋은 시기는 가을이에요.**\n**삽부터 꽂아 보세요.**\n\n도입이에요.\n\n## 본론\n가을과 봄 모두 심어요.')[0]).toContain('"가장"');
    expect(summaryCoherenceIssues(EXEMPLAR)).toEqual([]);
  });
});

describe('blogStyleIssues 연결 — 문체 린트 수정 라운드에 실린다', () => {
  it('휴지통 초안: 신규 범주가 모두 실리고, 범주마다 한 줄', () => {
    const r = blogStyleIssues(TRASHED, KW, BRIEF);
    for (const head of ['브리프 문장 복사', '브리프 소제목 복사', "'봅니다/보입니다'", '거의 같은 문장 반복', '같은 날짜 표현 반복', '같은 권고',
      '굵은 요약을 도입이 되풀이', '토막 줄', '보고서·직역 말투', '소제목 키워드', '소제목 수종명']) {
      expect(r.filter((x) => x.startsWith(head)), head).toHaveLength(1);
    }
  });
});

// 2026-10-05 대추나무 리비전 dbb3ea1b6aa6 — 마커 설명이 실사진에서만 지킬 수 있는 요구를 적었다(디자이너가 "경산 밭 배경"을 그대로 옮김).
describe('⑧ 이미지 마커 설명 — 실사진 전용 요구(지명·날짜·촬영·캡션)', () => {
  it('실측 마커: 촬영·날짜·캡션 마디는 버리고 브랜드 지역은 지운다', () => {
    expect(cleanImageMarkerDesc('경산 밭 노지묘와 화분묘를 나란히 놓고 뿌리 상태 비교, 2026-10 촬영', ['경북', '경산']))
      .toBe('밭 노지묘와 화분묘를 나란히 놓고 뿌리 상태 비교');
    expect(cleanImageMarkerDesc('전년 가을에 심은 대추나무의 이듬해 발아 모습 + 촬영 날짜가 확인되는 캡션'))
      .toBe('전년 가을에 심은 대추나무의 이듬해 발아 모습');
    expect(cleanImageMarkerDesc('비온디트리 농원에서 직접 찍은 사진')).toBe('본문 장면');
  });
  it('고칠 것이 없으면 구분자까지 그대로', () => {
    const d = '1~2년생 대추나무 접목묘의 접목부 위치 근접 — 라벨 품종명·연생 표기가 함께 보이게';
    expect(cleanImageMarkerDesc(d, ['경북', '경산'])).toBe(d);
  });
  it('린트: 실사진 전용 요구가 든 마커를 지적하고, 장면만 쓴 마커는 통과', () => {
    expect(imageMarkerIssues('본문.\n[IMAGE: 뿌리 비교, 2026-10 촬영]\n[IMAGE: 촬영 날짜가 확인되는 캡션]')[0]).toContain('실사진 전용 요구 2곳');
    expect(imageMarkerIssues('[IMAGE: 늦가을 마당에 삽을 꽂아 흙을 떠낸 장면]')).toEqual([]);
    // 구도 지시는 장면 설명이다(최근 40편 리플레이 오탐) — "근접 촬영", "가까이 찍은 접사"
    expect(imageMarkerIssues('[IMAGE: 붉게 물이 오르기 시작한 대추 열매가 달린 가지 근접 촬영]\n[IMAGE: 라일락 가지 끝, 마주 붙은 눈 두 개를 가까이 찍은 접사]')).toEqual([]);
    expect(cleanImageMarkerDesc('대추 열매가 달린 가지 근접 촬영')).toBe('대추 열매가 달린 가지 근접 촬영');
  });
});
