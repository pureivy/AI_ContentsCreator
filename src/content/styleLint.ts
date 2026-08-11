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
