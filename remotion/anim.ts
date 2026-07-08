export function clamp01(x: number): number { return Math.min(1, Math.max(0, x)); }
export function kenBurnsScale(local: number, total: number, max = 1.08): number {
  const p = total > 0 ? clamp01(local / total) : 0;
  return 1 + (max - 1) * p;
}
export function kenBurnsPan(local: number, total: number): { x: number; y: number } {
  const p = total > 0 ? clamp01(local / total) : 0;
  return { x: (p - 0.5) * 24, y: (p - 0.5) * -24 };
}
export function captionWordsVisible(local: number, count: number, perWord = 6): number {
  if (count <= 0) return 0;
  return Math.min(count, Math.max(0, Math.floor(local / perWord)));
}
export function sceneFadeOpacity(local: number, total: number, fade = 6): number {
  if (total <= 0) return 1;
  const fin = clamp01(local / fade);
  const fout = clamp01((total - local) / fade);
  return clamp01(Math.min(fin, fout));
}
/** ease-out 카운트업 — total-settle 프레임까지 value 도달, 이후 유지. 정수 value→정수, 소수→1자리. */
export function countUpValue(local: number, total: number, value: number, settle = 12): number {
  const dur = Math.max(1, total - settle);
  const p = clamp01(local / dur);
  const eased = 1 - Math.pow(1 - p, 3);
  const d = Number.isInteger(value) ? 0 : 1;
  return Number((value * eased).toFixed(d));
}
/** 리스트 항목 index 의 등장 진행도(0..1) — enter 프레임부터 씬의 windowRatio 구간에 슬롯 분배. */
export function staggerProgress(local: number, total: number, index: number, count: number, enter = 15, windowRatio = 0.6, rise = 12): number {
  if (count <= 0) return 1;
  const windowEnd = Math.max(enter + 1, total * windowRatio);
  const slot = (windowEnd - enter) / count;
  const start = enter + slot * index;
  return clamp01((local - start) / rise);
}
