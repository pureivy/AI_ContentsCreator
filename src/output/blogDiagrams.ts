/**
 * 블로그 설명 도표(2026-10-12 사장님 채택 — 모과나무 삽목 글 시범, "이미지가 2개밖에 없는데" 지적) — 글마다 도표 2장.
 *
 *  ① 순서 도표: 본문 첫 번호 목록(3~8단계)을 그대로 — 결정적 추출이라 새 내용이 끼어들 수 없다. 같은 절의 "~마세요" 경고를
 *     목록 앞/뒤 위치 그대로 주의 상자로.
 *  ② 요약 도표: 글 전체 흐름(시점·단계)을 3~5칸으로 — LLM 이 고르되 본문 문장과 겹침(이음 바이그램)이 낮거나 본문에 없는 수치가
 *     든 칸은 버린다(validateSummaryItems). 3칸 미만이면 만들지 않는다.
 *
 * 렌더는 scripts/blog_skills/blog_diagram.py(헤드리스 크롬 → PNG, Pretendard). 글자를 HTML 로 그려 한글이 정확하다.
 * 이미지 파일·마커·슬롯은 본문 순서대로 다시 맞춘다(발행·미리보기가 blog-image-NN 과 마커 순서를 짝짓는다).
 */
import { diceSimilarity, introducesNewFacts } from '../content/factGate';

export interface DiagramItem { label?: string; text: string; sub?: string; emoji?: string }

// 이모지(2026-10-12 사장님 — "도표가 너무 밋밋해"): 칸 문장의 낱말로 결정적으로 고른다. 맞는 게 없으면 번호만.
// '눈'(겨울눈·꽃눈)·'뿌리'(뿌리다/뿌리)는 뜻이 갈려 쓰지 않는다.
const EMOJI_RULES: ReadonlyArray<[RegExp, string]> = [
  [/주의|하지 마|마세요/, '⚠️'],
  [/비료|거름/, '🧪'],
  [/물을|물이|물 주|물주|적시|촉촉|마르면/, '💧'],
  [/겨울|추위|얼지|얼어|월동|바깥에 두/, '❄️'],
  [/덮/, '🤲'],
  [/자르|자른|잘라|전정|가지치기|솎/, '✂️'],
  [/표식|이름표|라벨|날짜를 적/, '🏷️'],
  [/확인|살펴|세어|관찰|구부려|긁어|지켜봅|들어 봐/, '🔍'],
  [/씨앗|씨를|파종|삽수|꽂/, '🌱'],
  [/흙|화분|상자|용기|통에|두둑|심/, '🪴'],
  [/누르|눌러|손바닥/, '🤲'],
  [/햇빛|햇볕|양지|그늘|직사광/, '☀️'],
  [/받을|받아|고르|고릅|골라|떼/, '🧺'],
  [/잎/, '🍃'],
  [/꽃/, '🌸'],
  [/열매|수확/, '🍎'],
  [/시기|무렵|월에|해 /, '📅'],
];
export function pickEmoji(text: string, label = ''): string | undefined {
  const t = `${label} ${text}`;
  return EMOJI_RULES.find(([re]) => re.test(t))?.[1];
}
/** 머리줄 수종 이모지(순수) — 수종 낱말이 없으면 나무. */
export function kickerEmoji(kicker: string): string {
  const m: ReadonlyArray<[RegExp, string]> = [[/단풍/, '🍁'], [/벚|매화|매실/, '🌸'], [/사과/, '🍎'], [/배나무|돌배/, '🍐'], [/복숭아/, '🍑'],
    [/체리|앵두/, '🍒'], [/포도|머루/, '🍇'], [/블루베리/, '🫐'], [/밤나무|밤 /, '🌰'], [/키위|다래/, '🥝'], [/레몬|유자/, '🍋'], [/소나무|측백|향나무|편백|주목/, '🌲']];
  return m.find(([re]) => re.test(kicker))?.[1] ?? '🌳';
}
export interface DiagramSpec {
  kind: 'steps' | 'points';
  title: string;
  items: DiagramItem[];
  warnBefore?: string[];
  warnAfter?: string[];
  /** 마커를 넣을 줄 번호(그 줄 앞에 삽입) — 본문 줄 기준. */
  insertAt: number;
  alt: string;
}

const MARKER_RE = /^\s*\[IMAGE:[^\]]*\]\s*$/;
const clean = (s: string): string => s.replace(/\*\*/g, '').replace(/\[IMAGE:[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
const firstSentence = (s: string): { head: string; rest: string } => {
  const m = /^(.+?[.!?])\s+(.+)$/.exec(s);
  return m ? { head: m[1]!.replace(/[.]$/, ''), rest: m[2]!.replace(/[.]$/, '') } : { head: s.replace(/[.]$/, ''), rest: '' };
};

/** 절 끝 줄 번호(다음 소제목 앞, 끝의 빈 줄·구분선 앞) — 마커를 넣을 자리. */
function sectionEnd(lines: string[], from: number): number {
  let end = lines.length;
  for (let i = from + 1; i < lines.length; i++) if (/^##\s+\S/.test(lines[i]!)) { end = i; break; }
  let at = end;
  while (at > from + 1 && (!lines[at - 1]!.trim() || /^---\s*$/.test(lines[at - 1]!.trim()))) at--;
  return at;
}

/** ① 순서 도표 추출(순수). 첫 번호 목록(연속 3~8줄)이 없으면 null. */
export function extractStepsDiagram(md: string): DiagramSpec | null {
  const lines = String(md ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d+[.)]\s+\S/.test(lines[i]!)) continue;
    let j = i;
    while (j < lines.length && /^\d+[.)]\s+\S/.test(lines[j]!)) j++;
    const n = j - i;
    if (n < 3) { i = j; continue; }
    if (n > 8) return null;
    let head = -1;
    for (let k = i - 1; k >= 0; k--) if (/^##\s+\S/.test(lines[k]!)) { head = k; break; }
    const title = head >= 0 ? clean(lines[head]!.replace(/^##\s+/, '')).slice(0, 30) : '순서';
    const items = lines.slice(i, j).map((l) => {
      const { head: h, rest } = firstSentence(clean(l.replace(/^\d+[.)]\s+/, '')));
      // 작은 글씨는 나머지의 첫 문장만 — 글자 수로 자르면 문장 중간에서 끊겼다(2026-10-12 단풍나무 씨앗 "…봄이 와"). 길면 뺀다.
      const sub = firstSentence(rest).head;
      const text = h.slice(0, 44);
      const emoji = pickEmoji(text);
      return { text, ...(sub && sub.length <= 52 ? { sub } : {}), ...(emoji ? { emoji } : {}) };
    });
    // 같은 절의 경고(인용 줄 또는 "~마세요" 문장) — 목록 앞이면 앞, 뒤면 뒤. 각 절에서 첫 문장만, 둘까지.
    const secStart = head >= 0 ? head + 1 : 0;
    let secEnd = lines.length;
    for (let k = j; k < lines.length; k++) if (/^##\s+\S/.test(lines[k]!)) { secEnd = k; break; }
    const warnOf = (from: number, to: number): string[] => lines.slice(from, to)
      .filter((l) => !MARKER_RE.test(l) && !/^\|/.test(l) && /마세요/.test(l))
      .map((l) => clean(l.replace(/^>+\s*/, '').replace(/^\*\*주의:?\*\*\s*/, '').replace(/^주의:?\s*/, '')))
      .map((t) => (t.match(/[^.!?]*마세요[.!?]?/)?.[0] ?? '').trim())
      .filter((t) => t.length >= 6).slice(0, 2);
    const warnBefore = warnOf(secStart, i);
    const warnAfter = warnOf(j, secEnd).filter((w) => !warnBefore.includes(w));
    return {
      // 자리는 번호 목록 바로 뒤(2026-10-12 사장님 점검) — 종전엔 절 끝이라 단풍나무 씨앗 글에서 목록과 도표 사이에
      // 설명 두 줄·인용·사진이 끼었고 사진과 도표가 붙었다. 목록 바로 뒤에 같은 단계를 그림으로 이어 보여 준다.
      kind: 'steps', title, items, insertAt: j, alt: `${title} 도표`,
      ...(warnBefore.length ? { warnBefore } : {}), ...(warnAfter.length ? { warnAfter } : {}),
    };
  }
  return null;
}

/** 도표 마커 걷어 내기(순수, 2026-10-12) — 리비전 런은 기존 본문을 기준으로 다시 쓰고 사진·도표를 새로 만든다.
 *  "[IMAGE: … 도표]" 줄이 남아 있으면 사진 자리로 계획돼 도표 자리에 AI 사진이 그려진다. 도표는 finalize 가 다시 넣는다. */
export function stripDiagramMarkers(md: string): string {
  return String(md ?? '').split('\n').filter((l) => !/^\s*\[IMAGE:[^\]]*\s도표\]\s*$/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 본문 문장들(순수) — 요약 칸 검증의 대조군. */
function bodySentences(md: string): string[] {
  return String(md ?? '').split('\n').filter((l) => !MARKER_RE.test(l) && !/^\|?\s*-{3,}/.test(l))
    .flatMap((l) => clean(l.replace(/^(?:#{1,6}|>+|[-*]|\d+[.)])\s*/, '')).split(/(?<=[.!?])\s+/))
    .map((s) => s.trim()).filter((s) => s.length >= 4);
}

const bigrams = (s: string): Set<string> => {
  const t = s.replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
};
/** 칸 글자쌍 중 원문 쪽에 있는 비율 — 긴 원문을 줄인 칸은 Dice 가 낮게 나와 따로 본다. */
const containment = (text: string, src: string): number => {
  const A = bigrams(text), B = bigrams(src);
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return A.size ? n / A.size : 0;
};

/** ② 요약 칸 검증(순수) — 본문 문장과 충분히 겹치고 본문에 없는 수치가 없는 칸만.
 *  겹침: 한 문장과 Dice 0.35↑, 또는 이웃 두 문장 안에 칸 글자쌍이 0.4↑(2026-10-13 무화과 글 — 두 문장을 합쳐 줄인
 *  "화분은 들어서 무게가 가벼워지면 마른 것" 같은 맞는 칸이 떨어져 요약 도표가 통째로 빠졌다. 지어낸 칸은 0.31 이하). */
export function validateSummaryItems(md: string, items: ReadonlyArray<{ label?: unknown; text?: unknown }>): DiagramItem[] {
  const sents = bodySentences(md);
  const whole = sents.join(' ');
  const windows = [...sents, ...sents.slice(0, -1).map((s, i) => `${s} ${sents[i + 1]}`)];
  return items.flatMap((it) => {
    const text = clean(String(it?.text ?? '')).slice(0, 48);
    const label = clean(String(it?.label ?? '')).slice(0, 20);
    if (text.length < 4) return [];
    if (introducesNewFacts(whole, `${label} ${text}`)) return [];
    const dice = Math.max(0, ...sents.map((s) => diceSimilarity(s, text)), ...sents.map((s) => (s.includes(text) ? 1 : 0)));
    const contained = Math.max(0, ...windows.map((w) => containment(text, w)));
    const emoji = pickEmoji(text, label);
    return dice >= 0.35 || contained >= 0.4 ? [{ ...(label ? { label } : {}), text, ...(emoji ? { emoji } : {}) }] : [];
  }).slice(0, 5);
}

/** ② 요약 도표의 자리(순수) — 마지막 소제목 절 앞(없으면 본문 끝). 순서 도표가 바로 그 자리(stepsAt)면 두 도표가 붙으므로
 *  마지막 절의 끝으로 보낸다(정리 칸으로 글을 닫는다). */
export function summaryInsertAt(md: string, stepsAt?: number): number {
  const lines = String(md ?? '').split('\n');
  const heads = lines.map((l, i) => (/^##\s+\S/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length < 2) return lines.length;
  const last = heads[heads.length - 1]!;
  let at = last;
  while (at > 0 && (!lines[at - 1]!.trim() || /^---\s*$/.test(lines[at - 1]!.trim()))) at--;
  if (stepsAt !== undefined && Math.abs(stepsAt - at) <= 3) return sectionEnd(lines, last);
  return at;
}

/** 요약 도표 LLM 지시(순수). */
export function summaryPrompt(md: string, kicker: string): string {
  return [
    `[블로그 본문]\n${String(md).slice(0, 6000)}`,
    '',
    `위 글을 한 장짜리 요약 도표로 만들 칸 3~5개를 골라라. 주제: ${kicker}.`,
    '칸 순서는 독자가 따라 할 시점·단계 순서(예: 꽂을 때 → 겨울 동안 → 확인할 때)로, 그런 흐름이 없으면 글의 핵심 판단 기준 순서로.',
    '각 칸: label(시점·단계 이름 2~10자), text(본문 문장 하나를 거의 그대로 옮겨 줄인 한 줄, 40자 이내).',
    'text 는 본문 말투 그대로 "~합니다/~세요/~요"로 끝내라 — "~함", "~음", "~것", "~기" 같은 명사형·개조식으로 끝내지 마라.',
    '본문에 없는 사실·수치·품종·조언을 만들지 마라 — 본문 문장에서만 가져와라. 감탄·비유·광고 문구 금지.',
    'title 은 도표 제목 16자 이내(예: "꽂은 뒤 살았는지 보기까지").',
    'steps_title 은 본문의 번호 목록(순서)을 그린 도표의 제목 — "뿌리는 순서", "꽂는 순서"처럼 무엇을 하는 순서인지 12자 이내(번호 목록이 없으면 빈 문자열).',
    'JSON: {"title":"...","steps_title":"...","items":[{"label":"...","text":"..."}]}',
  ].join('\n');
}

/**
 * 도표 마커·이미지 끼워 넣기(순수) — 본문에 마커 줄을 넣고, 새 마커 순서대로 이미지 목록을 다시 짠다.
 * images: 기존 마커 순서의 이미지(매니페스트 순서). 돌려주는 order 는 새 본문 마커 순서의 이미지 출처 —
 * {kind:'old', i} 는 기존 i번째, {kind:'diagram', d} 는 diagrams[d].
 */
export function insertDiagramMarkers(md: string, diagrams: ReadonlyArray<Pick<DiagramSpec, 'insertAt' | 'alt'>>):
  { body: string; order: Array<{ kind: 'old'; i: number } | { kind: 'diagram'; d: number }> } {
  const lines = String(md ?? '').split('\n');
  const inserts = diagrams.map((d, k) => ({ at: Math.max(0, Math.min(lines.length, d.insertAt)), k, alt: d.alt }))
    .sort((a, b) => a.at - b.at || a.k - b.k);
  const out: string[] = [];
  const order: Array<{ kind: 'old'; i: number } | { kind: 'diagram'; d: number }> = [];
  let old = 0;
  let p = 0;
  for (let i = 0; i <= lines.length; i++) {
    while (p < inserts.length && inserts[p]!.at === i) {
      out.push('', `[IMAGE: ${inserts[p]!.alt}]`, '');
      order.push({ kind: 'diagram', d: inserts[p]!.k });
      p++;
    }
    if (i === lines.length) break;
    if (MARKER_RE.test(lines[i]!)) order.push({ kind: 'old', i: old++ });
    out.push(lines[i]!);
  }
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n'), order };
}
