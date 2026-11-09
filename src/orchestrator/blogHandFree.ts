/**
 * FLUX 로 그릴 때 손 빼기(2026-11-10 사장님 "FLUX로 블로그 이미지를 만들 때 손 모양이 정확하지 않아 — 아예 프롬프트에 손이 들어가지 않게").
 * 감나무 지지대 편: 손으로 줄기를 잡는 사진마다 손가락이 뭉개지거나 지주를 같이 쥐었다. GPT 이미지는 손을 대체로 맞게 그려 그대로 둔다.
 *
 * 그림 모델이 comfy:<FLUX 계열> 이면, 사진 칸 중 손·사람이 나오는 칸을 같은 사실을 손 없이 보여 주는 장면(동작 대신 결과·상태,
 * 도구는 놓인 채로)으로 바꿔 쓴다. 설명(alt)도 같이 바꿔 글의 사진 설명과 그림이 어긋나지 않게 한다. 모든 칸 끝에 손·사람 금지를 붙인다.
 * 실패는 무해 — 바꿔 쓰기에 실패한 칸은 원래 지시에 금지 문구만 붙는다.
 */
import { CONFIG } from '../config';
import { microJSON } from './agent';
import { stdModel } from './visionCommon';

export const NO_HANDS = 'No people, no human hands, fingers or arms anywhere in the frame.';
const HAND_RE = /\b(hands?|fingers?|palms?|grip(?:s|ping)?|holding|holds?|person|people|gardener|man|woman|arms?)\b|손|사람|농부|쥐|잡고|잡아/i;

/** 금지 표현('no people, no hands' 등)을 지운다(순수) — 손이 '남았는지' 볼 때 금지 문구를 손으로 오인하지 않게. */
export function stripNegations(prompt: string): string {
  return String(prompt ?? '')
    .replace(new RegExp(NO_HANDS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
    .replace(/\b(?:no|without|free of)\s+(?:(?:visible|human|any)\s+)*(?:people|persons?|humans?|hands?|fingers?|arms?|gardeners?)(?:\s*(?:,|or|and)\s*(?:(?:human|any)\s+)*(?:people|persons?|humans?|hands?|fingers?|arms?|gardeners?))*/gi, '');
}

/** FLUX 계열로 그리는가(순수) — comfy:flux* 만. */
export function handFreeModel(model = CONFIG.openaiImageModel): boolean {
  return /^comfy:flux/i.test(String(model ?? ''));
}

/** 손·사람이 나오는 칸인가(순수). */
export function mentionsHands(slot: { alt?: string; prompt?: string }): boolean {
  return HAND_RE.test(`${slot.alt ?? ''} ${slot.prompt ?? ''}`);
}

/** 금지 문구를 한 번만 붙인다(순수). */
export function withNoHands(prompt: string): string {
  const p = String(prompt ?? '').trim();
  return p.includes(NO_HANDS) ? p : `${p}${p && !/[.!]$/.test(p) ? '.' : ''} ${NO_HANDS}`.trim();
}

/** 모델 응답 정리(순수) — 칸 번호(1부터)로 받은 새 alt·prompt. 빈 값은 원래 것을 둔다. */
export function applyRewrites<T extends { alt: string; prompt: string }>(slots: readonly T[], raw: unknown, targets: readonly number[]): T[] {
  const out = slots.map((s) => ({ ...s }));
  const items = (raw as { slots?: unknown } | null)?.slots;
  if (Array.isArray(items)) {
    for (const it of items) {
      const r = it as { slot?: unknown; alt?: unknown; prompt?: unknown };
      const i = Number(r.slot) - 1;
      if (!targets.includes(i)) continue;
      const prompt = String(r.prompt ?? '').trim();
      const alt = String(r.alt ?? '').trim();
      if (prompt && !HAND_RE.test(stripNegations(prompt))) out[i] = { ...out[i]!, prompt, ...(alt ? { alt } : {}) };
    }
  }
  return out.map((s) => ({ ...s, prompt: withNoHands(s.prompt) }));
}

export async function handFreeSlots<T extends { alt: string; prompt: string }>(
  slots: readonly T[], body: string, signal?: AbortSignal,
): Promise<{ slots: T[]; rewritten: number }> {
  const targets = slots.map((s, i) => (mentionsHands(s) ? i : -1)).filter((i) => i >= 0);
  let raw: unknown = null;
  if (targets.length) {
    const list = targets.map((i) => `${i + 1}) 설명: ${slots[i]!.alt} / 지시: ${slots[i]!.prompt}`).join('\n');
    try {
      raw = await microJSON<unknown>(stdModel(), '당신은 원예 블로그 사진 연출가다. JSON 만 답한다.', [
        `[블로그 글 일부]\n${String(body ?? '').slice(0, 2500)}`,
        `[손·사람이 나오는 사진 칸]\n${list}`,
        '이 칸들을 사람·손·팔이 전혀 안 나오는 사진으로 바꿔라. 같은 사실을 보여 주되, 동작 대신 그 결과나 상태를 찍는다'
          + '(예: 손으로 흔들어 보기 → 바람에 한쪽으로 기운 어린 줄기와 밑동 흙이 갈라진 모습 / 끈 묶기 → 묶여 있는 결속부 확대). '
          + '도구가 필요하면 땅이나 받침 위에 놓인 모습으로. 원래 칸에 없던 것(그 시점 뒤에 생기는 지주·끈 등)은 넣지 마라. '
          + 'prompt 는 원래 지시와 같은 언어의 사진 지시문(원래 지시의 계절·나무 나이·배경은 유지), alt 는 한국어 사진 설명 한 문장(원래 설명이 비었으면 빈 문자열).',
        'JSON: {"slots":[{"slot":1,"alt":"…","prompt":"…"}]}',
      ].join('\n\n'), { maxOutputTokens: 1500, signal });
    } catch { raw = null; }
  }
  const out = applyRewrites(slots, raw, targets);
  const rewritten = targets.filter((i) => out[i]!.prompt !== withNoHands(slots[i]!.prompt)).length;
  return { slots: out, rewritten };
}

/**
 * 장면 지시문 목록 손 빼기(2026-11-10 사장님 "숏폼과 카드뉴스 사진에도 손이 들어가면 안됨") — 숏폼 장면·카드 사진용.
 * FLUX 계열이 아니면 그대로 돌려준다. 바꾼 장면 수도 돌려준다(로그용).
 */
export async function handFreeScenes(scenes: readonly string[], body: string, signal?: AbortSignal): Promise<{ scenes: string[]; rewritten: number }> {
  if (!handFreeModel() || !scenes.length) return { scenes: [...scenes], rewritten: 0 };
  try {
    const r = await handFreeSlots(scenes.map((prompt) => ({ alt: '', prompt })), body, signal);
    return { scenes: r.slots.map((x) => x.prompt), rewritten: r.rewritten };
  } catch {
    return { scenes: scenes.map(withNoHands), rewritten: 0 };
  }
}
