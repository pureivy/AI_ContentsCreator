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
