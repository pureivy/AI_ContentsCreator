/**
 * 장면 파일 빠른 검사(순수) — 타입 검사 전에 도는 글자·결정성·id 규칙. 에이전트의 ./check.sh 와 파이프라인 사후 검사가 같은 함수를 쓴다.
 *
 * 숏폼 직접 제작 촬영기(scripts/mg_direct/render_frames.py)의 '화면 글자는 그 씬 대본에서만' 규칙을 옮겼다:
 * 문자열·JSX 글자에서 한글만 남겨 글자 두 개 묶음 겹침이 0.5 미만이면 '문장 밖 문구'. 숫자·단위·기호는 겹침에서 빼고,
 * 라벨의 숫자는 문장에 나온 숫자여야 한다. 주석은 먼저 걷어 낸다(장면 머리 주석에 문장을 적어 두는 게 관례).
 */
import { LABEL_MAX_KO, LABEL_MAX_NUMERIC, MAX_LABELS, labelLen } from './sceneRules';
import { sceneBioneeCues, stripBioneeCues } from './bioneeCues';

const ALLOWED_IMPORTS = new Set(['react', 'remotion', './_kit']);
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bMath\s*\.\s*random\b/, 'Math.random 금지 — random(\'시드\')(remotion)를 쓴다'],
  [/\bDate\b/, 'Date 금지(결정성)'],
  [/\bperformance\s*\.\s*now\b/, 'performance.now 금지(결정성)'],
  [/\bfetch\s*\(/, 'fetch 금지(네트워크)'],
  [/XMLHttpRequest|WebSocket|localStorage|sessionStorage/, '네트워크·저장소 API 금지'],
  [/<\s*(img|Img|video|Video|iframe|audio|Audio|OffthreadVideo|script)\b/, '이미지·영상·스크립트 태그 금지'],
  [/\bstaticFile\s*\(/, 'staticFile 금지(외부 파일)'],
  [/https?:\/\/(?!www\.w3\.org\/)/, '외부 주소 금지'],
  [/\brequire\s*\(|\bimport\s*\(/, '동적 import·require 금지'],
  [/\beval\s*\(|new\s+Function\b/, 'eval 금지'],
  [/\bprocess\s*\.|\bwindow\s*\.|\bdocument\s*\.|\bglobalThis\b/, '전역 객체 접근 금지'],
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML 금지'],
  [/<\s*filter\b/, '<filter> 새로 만들기 금지(무겁다 — 부품 그림자·흐림을 쓴다)'],
  [/@import|<\s*link\b|<\s*style\b/, '외부 글꼴·스타일 금지'],
];

export interface SceneText { text: string; kind: 'string' | 'jsx'; label: boolean }

/** 주석 걷기 + 문자열 조각 뽑기(순수) — 작은 토크나이저(따옴표·템플릿·주석). 정규식 리터럴은 장면에 거의 없어 다루지 않는다. */
export function scanSource(src: string): { code: string; strings: Array<{ text: string; quote: string; start: number }> } {
  let code = '';
  const strings: Array<{ text: string; quote: string; start: number }> = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; code += ' '; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const start = code.length;
      let j = i + 1; let text = '';
      const nested: Array<{ text: string; quote: string; start: number }> = [];
      while (j < n) {
        const ch = src[j]!;
        if (ch === '\\') { text += src[j + 1] ?? ''; j += 2; continue; }
        if (c === '`' && ch === '$' && src[j + 1] === '{') {
          // 템플릿 보간 — 안쪽 식은 코드로 남기고 글자 조각만 모은다(중첩 중괄호까지).
          let k = j + 2; let br = 1;
          while (k < n && br > 0) { if (src[k] === '{') br++; else if (src[k] === '}') br--; k++; }
          for (const inner of scanSource(src.slice(j + 2, k - 1)).strings) nested.push({ ...inner, start });
          text += '\u0000';
          j = k;
          continue;
        }
        if (ch === c) break;
        if (c !== '`' && ch === '\n') break;
        text += ch; j++;
      }
      const parts = text.split('\u0000');
      parts.forEach((part, pi) => { strings.push({ text: part, quote: c, start }); if (pi < parts.length - 1 && nested.length) strings.push(...nested.splice(0)); });
      code += src.slice(i, Math.min(n, j + 1));
      i = j + 1;
      continue;
    }
    code += c; i++;
  }
  return { code, strings };
}

const HANGUL = /[가-힣]/;
const hangulOnly = (s: string): string => s.normalize('NFC').replace(/[^가-힣]/g, '');
function bigrams(s: string): Set<string> {
  if (s.length === 1) return new Set([s]);
  const g = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}
/** 문장 겹침(순수) — 한글만 남긴 글자 두 개 묶음 중 문장에 있는 비율(render_frames.py overlap 과 같은 산식). */
export function textOverlap(text: string, sentence: string): number {
  const a = bigrams(hangulOnly(text));
  if (!a.size) return 1;
  const s = hangulOnly(sentence);
  const b = bigrams(s);
  let hit = 0;
  for (const g of a) if (b.has(g) || (g.length === 1 && s.includes(g))) hit++;
  return hit / a.size;
}
const numbersOf = (s: string): string[] => (s.match(/\d+(?:\.\d+)?/g) ?? []).map((x) => String(Number(x)));

/** 화면 글자 후보(순수) — 한글 문자열·JSX 글자·text/label 자리의 문자열. atFromWords 의 낱말 인자는 라벨이 아니다. */
export function sceneTexts(src: string): SceneText[] {
  // 비온이 신호(bioneeCues)의 팻말 글자는 장면 라벨이 아니다 — 따로 검사(lintScene)
  const { code, strings } = scanSource(stripBioneeCues(src));
  const tokens = new Set<string>();
  for (const m of code.matchAll(/atFromWords\s*\([^,]*,\s*(['"`])((?:(?!\1).)*)\1/g)) tokens.add(m[2]!);
  // 라벨 자리 — text=·label=·label: 값, 그리고 KIT_API 관례인 맨 위 라벨 상수(const L… = '…').
  const labelSlot = (start: number) => /(?:\btext|\blabel|\bchildren)\s*[=:]\s*\{?\s*$|\bconst\s+L\w*\s*=\s*$/.test(code.slice(Math.max(0, start - 24), start));
  const out: SceneText[] = [];
  for (const s of strings) {
    const t = s.text.trim();
    if (!t) continue;
    const isToken = tokens.has(t);
    if (HANGUL.test(t)) out.push({ text: t, kind: 'string', label: !isToken });
    else if (labelSlot(s.start) && /\S/.test(t)) out.push({ text: t, kind: 'string', label: true });
  }
  // JSX 글자 — 태그 사이 맨 한글(중괄호 식 제외). 비교식(a > 0 … b < 1)을 잘못 잡지 않게 따옴표·식 기호가 든 것은 뺀다.
  for (const m of code.matchAll(/>([^<>{}]*)</g)) {
    const t = m[1]!.trim();
    if (t && HANGUL.test(t) && !/['"`;=()]/.test(t)) out.push({ text: t, kind: 'jsx', label: true });
  }
  return out;
}

/**
 * 장면 파일 검사(순수) — 문제 문장 목록(빈 배열 = 통과). key 는 's007' 꼴, sentence 는 그 세그먼트 낭독.
 */
/**
 * 검사 옵션(2026-10-23 전체 화면 견본 — 옵트인, 기본값은 종전 그대로).
 * stage: 무대 태그 이름, urlPrefixes: 공용 defs 접두사(스타일 키트 a-·b-), noRawText: <text> 직접 쓰기 금지(라벨 부품만),
 * insetRequired: 실촬영 끼움 카드(FootageInset) 필수, noFootage: 이 장면엔 실촬영이 없다(FootageInset 금지).
 */
export interface LintOpts { stage?: string; urlPrefixes?: readonly string[]; noRawText?: boolean; insetRequired?: boolean; noFootage?: boolean; /** 사람 손 부품(Hand) 금지 — 2026-10-23 사장님 금지('피노키오 손가락') */ noHands?: boolean }

export function lintScene(src: string, key: string, sentence: string, opts: LintOpts = {}): string[] {
  const problems: string[] = [];
  // 진행자 비온이 신호(2026-10-23) — 있으면 리터럴·동작·팻말 글자(이 문장 낱말, 6자)를 검사
  const host = sceneBioneeCues(src, { narration: sentence });
  for (const p of host.problems) problems.push(`비온이 신호: ${p}`);
  const { code } = scanSource(src);
  for (const [rx, msg] of FORBIDDEN) if (rx.test(code)) problems.push(msg);
  if (opts.noRawText && /<\s*(text|tspan|foreignObject)\b/.test(code)) problems.push('<text> 직접 쓰기 금지 — 글자는 키트 라벨 부품(…Label·…Dim text)으로 labels 층에만');
  if (opts.insetRequired && !/<\s*FootageInset\b/.test(code)) problems.push('이 장면은 이 장의 실촬영 지정 장면 — <FootageInset footage={footage} …/> 를 한 번 이상 띄운다');
  if (opts.noFootage && /<\s*FootageInset\b/.test(code)) problems.push('이 장면엔 실촬영이 없다 — FootageInset 를 쓰지 않는다');
  if (opts.noHands && /<\s*Hand\b/.test(code)) problems.push('사람 손(Hand) 금지 — 쥐기·만지기는 대상(줄기·뿌리)에 화살표·순서 번호·포인트 색으로 보여 주고, 실제 손 동작이 꼭 필요하면 실촬영 끼움 카드로');
  // import — react·remotion·./_kit 만. 다시 내보내기 금지.
  for (const m of code.matchAll(/\bimport\b[^'"`;]*?from\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3/g)) {
    const mod = m[2] ?? m[4]!;
    if (!ALLOWED_IMPORTS.has(mod)) problems.push(`import 금지 모듈: '${mod}' (react·remotion·./_kit 만)`);
  }
  if (/\bexport\s+(\*|\{[^}]*\}\s*from)/.test(code)) problems.push('다시 내보내기(export … from) 금지');
  const defaults = code.match(/\bexport\s+default\b/g)?.length ?? 0;
  if (defaults !== 1) problems.push(`기본 내보내기(export default)가 ${defaults}개 — 정확히 하나`);
  const stage = opts.stage ?? 'SceneStage';
  if (!new RegExp(`<\\s*${stage}\\b`).test(code)) problems.push(`${stage} 무대를 쓰지 않음`);
  // id — 새 defs·부품 id 는 `${key}-` 접두사. url(#…) 참조는 접두사 또는 공용 defs(kit-·k2-).
  const prefix = `${key}-`;
  for (const m of code.matchAll(/\bid\s*[=:]\s*\{?\s*(['"`])([^'"`]*)\1/g)) {
    if (!m[2]!.startsWith(prefix)) problems.push(`id '${m[2]}' 에 접두사 '${prefix}' 가 없음`);
  }
  for (const m of code.matchAll(/url\(\s*#([^)\s]+)\s*\)/g)) {
    const ref = m[1]!;
    const shared = opts.urlPrefixes ?? ['kit-', 'k2-'];
    if (!ref.startsWith(prefix) && !shared.some((x) => ref.startsWith(x)) && !ref.startsWith('${')) problems.push(`url(#${ref}) — '${prefix}' 접두사 또는 공용 ${shared.join('·')} 만`);
  }
  // 글자 — 문장 밖 문구·숫자, 라벨 수·길이.
  const texts = sceneTexts(src);
  const sentNums = new Set(numbersOf(sentence));
  const labels = new Set<string>();
  for (const t of texts) {
    if (HANGUL.test(t.text) && textOverlap(t.text, sentence) < 0.5) problems.push(`문장 밖 문구: "${t.text}" — 화면 글자는 이 문장에 나온 말만`);
    if (!t.label) continue;
    labels.add(t.text);
    const bad = numbersOf(t.text).filter((x) => !sentNums.has(x));
    if (bad.length) problems.push(`문장에 없는 숫자: "${t.text}" (${bad.join(', ')})`);
    const len = labelLen(t.text);
    if (!len.ok) problems.push(`라벨 너무 김: "${t.text}" ${len.len}자 — 한글 ${LABEL_MAX_KO}자·숫자 라벨 ${LABEL_MAX_NUMERIC}자 이하(공백 제외)`);
  }
  if (labels.size > MAX_LABELS) problems.push(`라벨 ${labels.size}개 — 장면당 ${MAX_LABELS}개 이하: ${[...labels].map((l) => `"${l}"`).join(', ')}`);
  return [...new Set(problems)];
}
