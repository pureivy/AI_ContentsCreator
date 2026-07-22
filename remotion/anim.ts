export function clamp01(x: number): number { return Math.min(1, Math.max(0, x)); }
/** smoothstep 이징(0..1) — 선형 대비 시작·끝이 부드러워 Ken Burns 류 저속 모션에 적합. */
export function smoothstep(p: number): number {
  const t = clamp01(p);
  return t * t * (3 - 2 * t);
}
/** Ken Burns 스케일 — smoothstep 이징 + 씬별 변주: 짝수 씬 줌인(1→max), 홀수 씬 줌아웃(max→1). */
export function kenBurnsScale(local: number, total: number, max = 1.08, index = 0): number {
  const p = smoothstep(total > 0 ? local / total : 0);
  const zoomOut = index % 2 === 1;
  return zoomOut ? max - (max - 1) * p : 1 + (max - 1) * p;
}
// 팬 방향 4종 순환 — 전 씬 동일 대각선(↗ 고정)이던 단조로움 제거. 단위 벡터(±1).
const PAN_DIRS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: -1, y: -1 },
];
export function kenBurnsPan(local: number, total: number, index = 0): { x: number; y: number } {
  const p = smoothstep(total > 0 ? local / total : 0);
  const d = PAN_DIRS[index % PAN_DIRS.length]!;
  return { x: (p - 0.5) * 24 * d.x, y: (p - 0.5) * 24 * d.y };
}
/** 씬 시작 페이드인만(0→1, ease) — 씬 전환 하드컷 완화. 오디오 싱크(씬 길이) 불변. */
export function sceneEnterFade(local: number, fade = 6): number {
  return smoothstep(fade > 0 ? local / fade : 1);
}
/** 자막 단어 i 의 등장 진행도(0..1, ease-out) — 이산 점프 대신 rise 프레임 동안 부드럽게. */
export function captionWordProgress(local: number, index: number, perWord = 6, rise = 5): number {
  const start = index * perWord;
  const p = clamp01((local - start) / Math.max(1, rise));
  return 1 - Math.pow(1 - p, 3);
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
