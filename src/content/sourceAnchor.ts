/**
 * 숏폼 원문 근거 짚기(2026-10-15 사장님 선택 — "원문 문장을 짚으며 대본 쓰기").
 *
 * 왜: 10-10~14 인스타 숏폼 11편 중 8편이 '원문 정합 보류'였다. 대본이 원문을 압축하며 유보를 단정으로 바꾸고
 * ("선택(비 잦으면 바르세요)" → "그냥 둬도 돼요"), 기준 일부를 빼고("세 가지 확인" → "두 가지만 맞으면"),
 * 원문에 없는 문턱을 만들었다("3~4미터가 안 나오면 걸린다").
 *
 * 무엇: 작가가 씬마다 근거가 된 원문 문장을 글자 그대로 함께 적는다(src). 코드는 그 문장이 원문에 실제로 있는지
 * 결정적으로 확인하고(지어낸 인용 차단), 원문 대조 판정에는 씬과 그 근거 문장을 나란히 보여 준다.
 * 스위치 SHORTS_SOURCE_ANCHOR(off·instagram·all, 기본 off) — 시험 결과를 보고 켠다.
 */
import { diceSimilarity } from './factGate';

/** 기획 프롬프트에 붙이는 규칙(작가용). */
export const SOURCE_ANCHOR_GUIDE = [
  '[원문 근거 짚기 — 씬마다 src 필드]',
  '훅과 CTA 를 뺀 씬마다 "src" 에 그 씬 내용의 근거가 된 원문 문장을 **글자 그대로** 1~2문장 옮겨라(요약·의역 금지 — 코드가 원문과 대조한다). 훅·CTA 는 근거가 있으면 적고 없으면 "".',
  '그 씬의 내레이션·자막·목록은 src 문장이 말하는 범위 안에서만 써라:',
  '  · 원문의 유보와 조건을 지워 단정하지 마라 — "보통", "~할 수 있다", "선택", "~이면", "~일 때"는 짧게라도 살린다(예: 원문 "비가 잦으면 바르는 편이 낫다" → "비가 잦으면 발라 두세요", "그냥 둬도 돼요"는 금지).',
  '  · 원문이 기준을 세 가지 들면 세 가지를 다 말하거나 "~ 등"으로 일부임을 밝혀라 — "두 가지만 맞으면"처럼 기준 수를 바꾸지 마라.',
  '  · 원문에 없는 문턱·조건("~가 안 나오면 안 된다")이나 수치를 새로 만들지 마라.',
  '훅은 공유형으로 세게 써도 된다 — 단 훅의 단정도 원문이 단정한 것만.',
].join('\n');

const norm = (s: string): string => s.normalize('NFC').replace(/\*\*|__|[`#>|]/g, '').replace(/\s+/g, '').replace(/[“”"'‘’]/g, '');

/** 원문 문장 단위(순수) — 마침표·물음표·느낌표·줄바꿈 기준. */
function sourceSentences(source: string): string[] {
  return source.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 6);
}

/** 근거 문장이 원문에 있는가(순수) — 글자 그대로(공백·마크다운 무시)거나, 원문 한 문장과 거의 같으면(dice ≥ 0.8) 참. */
export function anchorFound(anchor: string, source: string): boolean {
  const a = norm(anchor);
  if (a.length < 6) return false;
  if (norm(source).includes(a)) return true;
  // 두 문장을 이어 붙인 인용 — 문장마다 따로 본다.
  const parts = anchor.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter((p) => norm(p).length >= 6);
  const sents = sourceSentences(source);
  const ok = (p: string): boolean => norm(source).includes(norm(p)) || sents.some((s) => diceSimilarity(norm(p), norm(s)) >= 0.8);
  return parts.length > 0 && parts.every(ok);
}

/** 기획 JSON 씬들 → 씬별 근거 문장(순수). 없으면 "". */
export function anchorsOf(scenes: ReadonlyArray<{ src?: unknown } | null | undefined>): string[] {
  return scenes.map((s) => (typeof s?.src === 'string' ? s.src.trim().slice(0, 300) : ''));
}

/**
 * 근거 문장 문제(순수) — 본문 씬(훅·CTA 제외)에 근거가 없거나, 적은 근거가 원문에 없으면 한 줄씩.
 * 표시·로그용이다(대본을 막지 않는다) — 원문 대조 판정이 최종 심판이다.
 */
export function anchorIssues(anchors: readonly string[], sceneCount: number, source: string): string[] {
  const out: string[] = [];
  for (let i = 1; i < sceneCount - 1; i++) {
    const a = anchors[i] ?? '';
    if (!a) out.push(`씬${i + 1}: 근거 원문 문장 없음`);
    else if (!anchorFound(a, source)) out.push(`씬${i + 1}: 적은 근거가 원문에 없음 — "${a.slice(0, 40)}"`);
  }
  return out;
}

/** 원문 대조 판정 입력에 근거 문장을 붙인다(순수) — 원문에 실제로 있는 근거만. */
export function withAnchor(text: string, anchor: string | undefined, source: string): string {
  return anchor && anchorFound(anchor, source) ? `${text} (이 씬의 원문 근거: "${anchor}")` : text;
}

/** 스위치 해석(순수) — off·instagram·all. */
export function anchorOn(mode: string, platform: string | undefined): boolean {
  const m = mode.trim().toLowerCase();
  if (m === 'all' || m === 'on' || m === 'true' || m === '1') return true;
  if (m === 'instagram') return platform === 'instagram';
  return false;
}
