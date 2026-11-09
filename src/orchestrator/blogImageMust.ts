/**
 * 블로그 사진 원문 대조 목록(2026-11-10 사장님 "블로그 사진도 검수를 해야 해") — 감나무 지지대 편: '지주 세우기 전에 손으로 흔들어
 * 보는' 사진에 지주가 이미 서 있었고, '8자 결속' 사진은 8자가 아니었는데 검수가 통과시켰다. 블로그 검수에는 카드·숏폼처럼
 * 장마다 "꼭 보여야 할 것 / 나오면 안 되는 것"(sceneMust)이 없어서 원문 대조(6번 항목)가 아예 돌지 않았다.
 * 사진 칸 설명(alt·지시문)과 본문에서 그 목록을 한 번에 뽑는다. 실패는 무해(빈 목록 — 종전 검수 그대로).
 */
import { microJSON } from './agent';
import { stdModel } from './visionCommon';
import { parseSceneMust, type SceneMust } from './sceneMust';

/** 모델 응답 정리(순수) — 칸 수만큼, 칸 번호(1부터) 기준. 없는 칸은 undefined. */
export function parseBlogSlotMusts(raw: unknown, count: number): Array<SceneMust | undefined> {
  const items = (raw as { slots?: unknown } | null)?.slots;
  const out: Array<SceneMust | undefined> = Array.from({ length: count }, () => undefined);
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    const n = Number((it as { slot?: unknown })?.slot);
    if (Number.isInteger(n) && n >= 1 && n <= count && !out[n - 1]) out[n - 1] = parseSceneMust(it);
  }
  return out;
}

export async function blogSlotMusts(
  body: string,
  slots: ReadonlyArray<{ alt?: string; prompt?: string }>,
  signal?: AbortSignal,
): Promise<Array<SceneMust | undefined>> {
  if (!slots.length) return [];
  const list = slots.map((s, i) => `${i + 1}) 설명: ${String(s.alt ?? '').slice(0, 120)} / 지시: ${String(s.prompt ?? '').slice(0, 300)}`).join('\n');
  const sys = '당신은 블로그 사진 검수 기준을 만드는 편집자다. 지어내지 말고 원문과 사진 칸 설명에 적힌 것만 근거로 쓴다. JSON 만 답한다.';
  const user = [
    `[블로그 원문]\n${body.slice(0, 4000)}`,
    `[사진 칸]\n${list}`,
    '각 사진 칸마다 must_show(그 사진에 꼭 보여야 할 사실 1~4개)와 must_not(그 사진에 나오면 원문·설명과 어긋나는 것 0~3개)을 적어라.',
    '- 그 칸이 가리키는 "시점"을 지켜라: 무언가를 하기 "전" 장면(예: 지주를 세울지 정하려고 흔들어 보기)이면 그 뒤에 생기는 것(세운 지주·묶은 끈)은 must_not 이다.',
    '- 방법·모양이 적혀 있으면(8자 묶기, 천 덧대기, 구덩이 밖에 박기 등) must_show 에 그 모양을 그대로 적는다.',
    '- 계절·잎 상태·나무 나이가 원문에 있으면 넣는다. 항목은 짧은 한국어 명사구(40자 이내).',
    'JSON: {"slots":[{"slot":1,"must_show":["…"],"must_not":["…"]}]}',
  ].join('\n\n');
  try {
    const r = await microJSON<unknown>(stdModel(), sys, user, { maxOutputTokens: 1200, signal });
    return parseBlogSlotMusts(r, slots.length);
  } catch {
    return slots.map(() => undefined);
  }
}
