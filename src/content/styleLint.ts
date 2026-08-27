/**
 * 문체 결정적 린트(순수) — 3채널 자연스러움 감사(2026-08-11)에서 실측된 "AI 티" 지문을
 * 정규식으로 검출한다. 프롬프트 지시만으로는 샌다는 것이 실증됐기에(쇼츠 "새 가지" 지침 위반 실측)
 * 기존 단독 이해 검산(standaloneIssues)의 1회 수정 라운드에 얹는 2차 방어다. 전량 fail-open 성격:
 * 검출 결과는 수정 라운드 입력일 뿐 파이프라인을 막지 않는다. 자막·본문 원문에는 손대지 않는다.
 */

/** 문장 분리(대략) — 종결부호 기준. 한국어 구어 대본 검사용이라 정밀할 필요 없다. */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** '-ㅂ니다/습니다' 계열 종결인가(마침표·물음표 허용). */
function endsHamnida(sentence: string): boolean {
  return /(?:니다)[.!?…]*$/.test(sentence.trim());
}

/**
 * 쇼츠 내레이션 문체 린트 — 실측 지문 4종.
 * ① 한 씬의 2문장 이상이 전부 '-ㅂ니다' 종결(어미 메트로놈, 171문장 중 62% 실측)
 * ② 훅 질문-반전 공식('~보셨나요?/~라고요? + 정작/사실/그럼 이미', 최근 15편 중 7편 실측)
 * ③ '새 가지'(숫자 '세 가지'로 들리는 발음 혼동 — 지침 존재·위반 실측)
 * ④ '~기 때문입니다' 2회 이상 / 'X가 아니라 Y' 재정의 문형 2회 이상(하우스 지문)
 * 반환 문구는 standaloneIssues 와 같은 "항목N: …" 꼴 — 같은 수정 라운드 프롬프트에 섞인다.
 */
export function narrationStyleIssues(narrations: string[]): string[] {
  const issues: string[] = [];
  narrations.forEach((n, i) => {
    const sents = splitSentences(n);
    if (sents.length >= 2 && sents.every(endsHamnida)) {
      issues.push(`항목${i + 1}: 두 문장이 모두 '-ㅂ니다'로 끝난다 — 한 문장을 '~요/~죠/~하세요' 등 다른 어미로 바꿔라`);
    }
    if (n.includes('새 가지')) {
      issues.push(`항목${i + 1}: '새 가지'는 낭독 시 숫자 '세 가지'로 들린다 — '새로 난 가지'처럼 풀어 써라`);
    }
  });
  const hook = narrations[0] ?? '';
  if (/(?:보셨나요|라고요|다고요|시나요)\?/.test(hook) && /(정작|사실|그럼 이미)/.test(hook)) {
    issues.push('항목1: 훅이 "질문+반전(정작/사실~)" 공식이다(최근 편 과다) — 단정 선언·구체 장면·숫자 제시 등 다른 유형으로 다시 써라');
  }
  const all = narrations.join('\n');
  if ((all.match(/기 때문입니다/g) ?? []).length >= 2) {
    issues.push("전체: '~기 때문입니다' 종결이 2회 이상이다 — 1회 이하로 줄이고 이유를 다른 꼴로 이어라");
  }
  if ((all.match(/[가이] 아니라/g) ?? []).length >= 2) {
    issues.push("전체: 'X가 아니라 Y' 재정의 문형이 2회 이상이다 — 1회 이하로 줄여라(하우스 상투)");
  }
  return issues.slice(0, 5);
}

/**
 * 훅 첫 2초 키워드 낭독 린트(순수) — 쇼츠 조회수 감사(2026-08-20) 실측: 최근 47편 중 17편이
 * 훅 첫 2초(TTS ≈12자)를 검색 키워드·상품명 낭독에 써서 추천 피드 이탈 요인이 됐다.
 * 검색 표기 노출은 제목·화면텍스트·캘리가 담당한다(사용자 확정 e72c6c0) — 낭독 훅만 검사한다.
 * 판정: 훅 '첫 문장'이 공백 제거 후 키워드로 '시작'할 때만 위반(startsWith). 부분 문자열 포함 검사는
 * "곶감나무"⊃"감나무" 오탐과, 지시 준수 대본('잠깐,'+뒷문장 키워드)을 벌주는 이중구속을 만든다(리뷰 실측).
 * 2자 미만 키워드는 통과. 회피 변형("자, 배롱나무…")은 프롬프트 지시가 담당한다 — 린트는 2차 방어일 뿐.
 */
export function hookKeywordLeadIssues(narrations: string[], keyword?: string): string[] {
  const hook = (narrations[0] ?? '').trim();
  const kw = (keyword ?? '').replace(/\s+/g, '');
  if (!hook || kw.length < 2) return [];
  const firstSentence = splitSentences(hook)[0] ?? hook;
  return firstSentence.replace(/\s+/g, '').startsWith(kw)
    ? [`항목1: 훅이 키워드 "${keyword}" 낭독으로 시작한다 — 첫 2초는 긴장·장면·숫자·상황 지목으로 열고, 키워드 명시는 훅 뒷문장 또는 씬2로 미뤄라`]
    : [];
}

/**
 * 카드뉴스 슬라이드 문체 린트 — 실측 지문 2종.
 * ① 같은 종결어미('-ㅂ니다')로 끝나는 장이 3장 연속(40장 중 36장 실측)
 * ② 'X가 아니라 Y' 재정의 문형 2회 이상
 * 검사 대상은 장의 마지막 줄(body 마지막 줄, 없으면 headline).
 */
export function cardStyleIssues(slides: Array<{ headline?: string; body?: string }>): string[] {
  const issues: string[] = [];
  const lastLines = slides.map((s) => {
    const body = (s.body ?? '').trim();
    const last = body.split('\n').map((l) => l.trim()).filter(Boolean).pop();
    return last ?? (s.headline ?? '').trim();
  });
  let run = 0;
  for (let i = 0; i < lastLines.length; i++) {
    run = endsHamnida(lastLines[i]!) ? run + 1 : 0;
    if (run === 3) {
      issues.push(`항목${i - 1}~${i + 1}: 3장 연속 '-ㅂ니다' 종결이다 — 한 장은 질문·명사구·권유형으로 바꿔라`);
      break;
    }
  }
  const all = slides.map((s) => `${s.headline ?? ''}\n${s.body ?? ''}`).join('\n');
  if ((all.match(/[가이] 아니라/g) ?? []).length >= 2) {
    issues.push("전체: 'X가 아니라 Y' 재정의 문형이 2회 이상이다 — 1회 이하로 줄여라(하우스 상투)");
  }
  return issues.slice(0, 4);
}

/**
 * 요약·설명 메타투 린트(순수, 2026-08-27 말투 감사 권고 2) — 블로그 meta(검색 스니펫)와 쇼츠
 * description(유튜브 설명 = 인스타 캡션에 복제)이 "…를 정리했습니다"·"…에 대해 알아봅니다" 로
 * 끝나 채널 전체가 한 템플릿으로 읽혔다(실측). 요약·설명은 "결론 한 줄 + 조건 한 줄" 꼴이어야 한다.
 * 프롬프트(brand.ts 어휘 가드·naverBlog PACK_SYSTEM·쇼츠 기획)가 1차 방어, 여기가 결정적 2차 방어다.
 * 반환 문구는 블로그 meta 재시도 피드백과 쇼츠 수정 라운드(probs) 양쪽에 그대로 실린다 — 형식 하나.
 */
const META_SUMMARY_RE = /정리했습니다|정리했어요|담았습니다|담았어요|알아봅니다|알아보세요|살펴봅니다|살펴보세요|소개합니다|소개해요|함께 알아|에 대해 알아/g;

export function metaSummaryIssues(text: string): string[] {
  const hits = [...new Set((text ?? '').match(META_SUMMARY_RE) ?? [])];
  return hits.slice(0, 3).map((h) => `설명·요약 메타투 "${h}" — 요약·설명을 그 말로 끝내지 말고 "결론 한 줄 + 조건 한 줄" 꼴로 다시 써라`);
}
