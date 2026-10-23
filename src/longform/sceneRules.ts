/**
 * 문장 그림 장면 공용 규칙(순수) — 글자 한도·라벨 길이·낭독 단어 시각. remotion/longform/illus/sceneUtil.ts 가 그대로 다시 내보낸다
 * (루트 tsc rootDir=src 라 src 쪽 검사기·props 와 remotion 장면이 같은 값을 쓰려면 정의가 여기 있어야 한다 — types.ts 와 같은 이유).
 */

/** 글자 한도 — 한글 라벨 8자(공백 제외), 숫자가 든 라벨('pH 4.5~5.5'·'30cm')은 12자, 장면당 라벨 3개. */
export const LABEL_MAX_KO = 8;
export const LABEL_MAX_NUMERIC = 12;
export const MAX_LABELS = 3;

export type LabelCheck = { ok: boolean; len: number; limit: number; numeric: boolean };
/** 라벨 길이 검사 — 공백을 빼고 센다. 숫자가 하나라도 있으면 숫자 라벨 한도를 쓴다. */
export function labelLen(text: string): LabelCheck {
  const len = [...text.replace(/\s+/g, '')].length;
  const numeric = /\d/.test(text);
  const limit = numeric ? LABEL_MAX_NUMERIC : LABEL_MAX_KO;
  return { ok: len > 0 && len <= limit, len, limit, numeric };
}

/** 낭독 단어 시각 — start 는 '이 장면 시작부터 잰 초'. */
export type Word = { w: string; start: number };

/**
 * 단어 시각 어림(순수) — STT 단어 시각이 없으니 낭독 글자(공백 제외) 위치에 비례해 말하는 구간(speechSec)에 고르게 편다.
 * 세그먼트 길이 = 낭독 + 쉼(GAP)이라 호출하는 쪽이 쉼을 뺀 길이를 준다.
 */
export function approxWords(narration: string, speechSec: number): Word[] {
  const words = narration.split(/\s+/).filter(Boolean);
  const total = words.reduce((n, w) => n + [...w].length, 0);
  if (!total || !(speechSec > 0)) return [];
  let at = 0;
  return words.map((w) => {
    const start = Math.round((at / total) * speechSec * 1000) / 1000;
    at += [...w].length;
    return { w, start };
  });
}
