/**
 * 원문 미검증 주장 승계 검사(2026-08-28, 처방 C) — 결정적(LLM 없음).
 *
 * 실사고(short_b894bf71fb ← piece_8d9113cdde): 블로그 사실 게이트는 `hold`(unsupported 1 · unverified 6)인데
 * 파생 숏폼은 `pass` 였다. 그런데 숏폼 씬5 목록은 "회양목: 초여름 한 번 / 측백류: 봄·늦여름 두 번"으로,
 * **원문에서 '근거 미확인'으로 분류된 바로 그 손질 시기**를 검증된 사실인 양 화면에 띄웠다.
 *
 * 왜 기존 게이트가 못 잡는가 — 파생 게이트는 두 축뿐이다:
 *   ① parityIssues     — 대본이 원문과 **어긋나는가**
 *   ② timingParityIssues — 원문에 **없는** 시기·수치를 지어냈는가
 * 문제의 문장은 원문 표에 그대로 있으므로 둘 다 통과한다. 파이프라인이 "원문에 충실한가"만 묻고
 * **"원문이 애초에 믿을 만한가"** 는 묻지 않았다. 이 모듈이 그 세 번째 질문이다.
 *
 * 왜 문자열 포함 검사로는 안 되는가 — 파생물은 복붙이 아니라 재작성이다(실측 유사도 38~56%).
 *   원문 걸림: "회양목 - 겨울 잎 남습니다, 새순이 굳는 초여름에 한 번"
 *   파생 재등장: "회양목: 초여름 한 번"
 * 그래서 **핵심 토큰 공동 출현**으로 본다: 주장에서 변별력 있는 토큰(수종명·시기어·수치)을 뽑아,
 * 파생 텍스트에 그중 둘 이상이 함께 나타나면 '같은 주장의 재등장'으로 판정한다.
 *
 * 성격: 비차단·표시 전용. 파생물은 자동 발행이 없고(사람이 검토 탭·텔레그램에서 발행), 이 판정은
 * 근사(휴리스틱)라 발행을 막을 만큼 정밀하지 않다. 원문 게이트가 이미 hold 로 사람을 세운 사안을
 * 파생물에서도 **보이게** 하는 것이 목적이다 — 블로그만 걸러지고 파생은 깨끗한 얼굴로 나가던 비대칭을 없앤다.
 *
 * 킬스위치: INHERITED_CLAIMS=off.
 */
import { CONFIG } from '../config';

/** 승계 판정 결과 — 어느 원문 주장이 어느 파생 필드에 재등장했는가. */
export interface InheritedClaim {
  /** 원문 게이트가 건 주장 원문(표시용). */
  claim: string;
  /** 재등장한 파생 필드 이름(예: '씬5 목록'). */
  field: string;
  /** 판정 근거가 된 공동 출현 토큰 — 사후에 과차단·미검출을 되짚는 유일한 단서. */
  tokens: string[];
}

/**
 * 토큰 추출 — 한글 2자 이상 낱말과 숫자+단위. 조사가 붙어도 어간이 남게 뒤쪽 조사를 떼어 낸다.
 * 형태소 분석기 없이 하는 근사라, 정밀도는 아래 STOP(흔한 말 제외)과 '2개 이상 공동 출현' 조건이 만든다.
 */
const TOKEN_RE = /[가-힣]{2,}|\d+(?:\.\d+)?\s*(?:cm|mm|m|kg|g|도|년|월|일|주|번|개|%)/g;

/**
 * 불용어 — 원예 글 어디에나 나와 변별력이 없는 말. 이게 없으면 "나무"·"가지" 하나로 무관한 주장이 엮인다.
 * 실코퍼스에서 빈출 순으로 골랐다(수종명·시기어는 절대 넣지 않는다 — 그게 판정의 핵심 신호다).
 */
const STOP: ReadonlySet<string> = new Set([
  '나무', '나무가', '나무를', '나무는', '나무의', '묘목', '가지', '가지가', '가지를', '잎이', '잎을',
  '있습니다', '없습니다', '합니다', '합니다만', '됩니다', '입니다', '주세요', '보세요', '해요', '예요',
  '그리고', '하지만', '그래서', '다만', '경우', '정도', '때는', '때가', '보통', '대개', '흔히',
  '이렇게', '그렇게', '여기서', '거기서', '자리', '모양', '상태', '방법', '기준', '차이',
  '수분', '관리', '작업', '사용', '확인', '필요', '가능', '시작', '이상', '이하', '먼저', '다음',
  // 조건·종결 어미(2026-10-15) — 실측: '밑동·있으면' 두 토큰으로 무관한 카드 장이 승계로 잡혔다.
  '있으면', '없으면', '하면', '되면', '마세요', '겁니다', '거예요',
]);

/** 주장·텍스트에서 변별 토큰 집합을 뽑는다. 순수. */
export function salientTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    let t = m[0].replace(/\s+/g, '');
    // 흔한 조사 꼬리 제거 — "회양목은"·"초여름에"가 "회양목"·"초여름"과 같은 토큰이 되게.
    t = t.replace(/(?:은|는|이|가|을|를|의|에|에서|엔|와|과|도|만|부터|까지|으로|로)$/, '');
    if (t.length >= 2 && !STOP.has(t)) out.add(t);
  }
  return out;
}

/** 두 토큰 집합의 교집합. 순수. */
function shared(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const t of a) if (b.has(t)) out.push(t);
  return out;
}

/** 판정 문턱 — 공동 출현 토큰 수. 1이면 수종명 하나만 겹쳐도 걸려 과차단이 된다(같은 나무의 다른 이야기). */
const MIN_SHARED = 2;

/**
 * 원문 게이트가 건 주장이 파생 텍스트에 재등장했는지 판정한다.
 *
 * @param flagged  원문 factGate 의 unsupported + unverified 문장
 * @param fields   파생 필드(내레이션·자막·오버레이·결론 카드 등) — timingFields 와 같은 모양
 * @param limit    결과 상한(표시용이라 많이 낼 이유가 없다)
 */
export function inheritedClaims(
  flagged: string[],
  fields: Array<{ field: string; text: string }>,
  limit = 5,
  /** 원문 본문(2026-10-15) — 주면 걸린 문장을 뺀 나머지 문장들(writerSource)과도 견준다. 겹친 토큰을 **전부** 품은
   *  남은 원문 문장이 하나라도 있으면 그 문장에서 온 것으로 보고 승계로 치지 않는다(필드 전체가 아니라 겹친 토큰만 본다 —
   *  여러 문장짜리 설명란에서 다른 문장 덕에 베낀 문장이 묻히지 않게).
   *  실측(무화과): 대본이 근거 확인된 "겨울 최저 극기온 영하 8도 이상인 곳"을 옮겼는데 '영하·겨울·노지'가 겹쳐
   *  근거 미확인 "영하 8도 아래가 해마다 몇 번씩…"의 재등장으로 잡혔다. 16회 재기획 실험에서 종전 25건 중 진짜 베낌 1건.
   *  이미지 표시 줄([IMAGE: …])은 주장이 아니라 설명 근거로 치지 않는다.
   *  킬스위치: INHERITED_CLEAN_SOURCE=off(종전 판정). */
  sourceBody?: string,
): InheritedClaim[] {
  if (process.env.INHERITED_CLAIMS === 'off') return [];
  const out: InheritedClaim[] = [];
  const claimTokens = flagged.map((c) => ({ claim: c, tokens: salientTokens(c) }));
  const clean = sourceBody && process.env.INHERITED_CLEAN_SOURCE !== 'off'
    ? writerSource(sourceBody, flagged, true).body.split(/\n+/).filter((l) => !/^\s*\[[A-Z가-힣 ]+:/.test(l)).flatMap((l) => l.split(SENT_SPLIT)).map(salientTokens).filter((t) => t.size >= MIN_SHARED)
    : [];
  for (const f of fields) {
    if (!f.text?.trim()) continue;
    const ft = salientTokens(f.text);
    for (const c of claimTokens) {
      // 원문 주장 자체의 토큰이 빈약하면(예: "그렇습니다") 어떤 텍스트와도 우연히 엮인다 — 건너뛴다.
      if (c.tokens.size < MIN_SHARED) continue;
      const hit = shared(c.tokens, ft);
      if (hit.length >= MIN_SHARED && !clean.some((t) => hit.every((h) => t.has(h)))) {
        out.push({ claim: c.claim, field: f.field, tokens: hit });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** 수정 라운드·표시에 쓰는 한 줄 — `씬5 목록: "회양목 - …"(회양목·초여름)`. 순수. */
export function formatInherited(i: InheritedClaim): string {
  const claim = i.claim.length > 60 ? `${i.claim.slice(0, 60)}…` : i.claim;
  return `${i.field}: 원문에서 근거 미확인으로 분류된 주장이 다시 나온다 — "${claim}" (${i.tokens.slice(0, 3).join('·')})`;
}

/**
 * 작가용 원문(2026-10-15 사장님 결정 — "경고를 줄이는 게 아니라 경고가 될 내용을 안 넣는 게 중요") — 원문 게이트가 건
 * 문장(unsupported + unverified)을 블로그 본문에서 지운 판본. 숏폼·카드뉴스 작가 입력에만 쓴다(발행물이 아니다).
 *
 * 왜: 금지 목록만 주고 본문에는 그대로 두면 작가가 옮겨 쓴다 — 10-08 이후 숏폼 25편 중 12편이 승계 표시(33줄)를 달았고,
 * 무화과 두 편은 근거 미확인인 "영하 8도 아래가 해마다…"를 대본의 중심으로 삼았다. 재료를 빼면 작가는 다른 축으로 짠다.
 * 판정(원문 정합·시기수치·승계)은 계속 원문 전체로 본다 — 작가가 같은 말을 다른 경로로 써도 잡히게.
 *
 * 찾기: 걸린 주장을 문장으로 쪼개(두 문장짜리 주장이 흔하다) 공백·굵게 표시를 무시하고, 그 조각을 품은 본문 문장을
 * 통째로 뺀다(주장이 문장 뒷부분만인 경우 — "…까닭은, 줄기가 휘는 쪽으로…"). 소제목 줄은 지우지 않는다. 표의 줄은
 * 행 전체를 뺀다. 10-08~14 원문 14편 실측: 문장 단위 일치만으로는 51개 중 39개, 이 방식으로 전부.
 * 킬스위치: STRIP_FLAGGED_SOURCE=false.
 */
const SENT_SPLIT = /(?<=[.!?。](?:\*\*)?)\s+/; // 굵은 머리말 "**…끊습니다.** 배나무는…" 도 두 문장
const squash = (t: string): string => t.normalize('NFC').replace(/\*\*|__/g, '').replace(/\s+/g, '');

export function writerSource(body: string, flagged: readonly string[], on: boolean = CONFIG.stripFlaggedSource): { body: string; removed: number } {
  if (!on || !body || !flagged.length) return { body, removed: 0 };
  const parts = flagged.flatMap((c) => c.split(SENT_SPLIT)).map(squash).filter((p) => p.length >= 10);
  if (!parts.length) return { body, removed: 0 };
  const hit = (sentence: string): boolean => {
    const q = squash(sentence);
    return q.length > 0 && parts.some((p) => q.includes(p) || (q.length >= 10 && p.includes(q)));
  };
  let removed = 0;
  const out: string[] = [];
  for (const line of body.split('\n')) {
    if (/^\s*#{1,6}\s/.test(line)) { out.push(line); continue; }
    if (/^\s*\|/.test(line)) { if (hit(line.replace(/\|/g, ' '))) { removed++; continue; } out.push(line); continue; }
    const m = /^(\s*(?:>+|[-*+]|\d+[.)])?\s*)([\s\S]*)$/.exec(line)!;
    const sents = m[2]!.split(SENT_SPLIT);
    const keep = sents.filter((x) => !hit(x));
    if (keep.length === sents.length) { out.push(line); continue; }
    removed += sents.length - keep.length;
    let text = keep.join(' ').trim();
    if ((text.match(/\*\*/g) ?? []).length % 2) text = text.replace(/\*\*/g, ''); // 굵게가 문장 둘에 걸쳐 있다 한쪽만 빠진 경우
    if (squash(text)) out.push(m[1] + text);
  }
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n'), removed };
}

/**
 * 근거 미확인 문장을 원문에서 뺐을 때 작가에게 주는 안내(2026-10-15). 문장 목록을 그대로 보여 주지 않는다 — 실측: 호두 활착 카드
 * (card_605e40a1c9)가 본문에서 지운 "뽑아서 다시 심는 건 지금 하지 마세요"를 '쓰지 마라' 목록에서 읽고 7번 장·캡션에 옮겼다.
 * 목록은 작가가 그 문장을 볼 유일한 자리였다. 다시 나오면 승계 검사가 잡아 수정 요청의 '고칠 문제'로 보여 준다.
 */
export const STRIPPED_FLAGGED_NOTE = '[근거가 확인되지 않은 문장은 원문에서 미리 뺐다] 원문 사이의 빈 자리를 추측해 채우지 마라 — 원문에 남은 사실만 쓴다. 빠진 듯한 수치·시기·금지 사항·조건을 지어내지 마라.';

/** 작가 지시문에 문장 그대로 보여 줄 근거 미확인 목록(순수) — 원문에서 뺐으면 빈 목록(안내 문구만). */
export function flaggedForPrompt(flagged: readonly string[], stripped: boolean = CONFIG.stripFlaggedSource): string[] {
  return stripped ? [] : [...flagged];
}
