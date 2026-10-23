// 종 프리셋(2026-10-23) — 키트가 쓰는 원본. 같은 내용을 species/*.json 으로도 둔다(src 쪽 읽기용, 스키마 = schema.ts).
// 감나무: 도감 기술 + 보관소 감나무 실촬영 6편(2026-09·10월, data/media 감나무 태그) 프레임 대조로 맞춤.
import type { SpeciesProfile } from './schema';

export const PERSIMMON_PROFILE: SpeciesProfile = {
  id: 'persimmon', nameKo: '감나무', latin: 'Diospyros kaki',
  sources: ['국가생물종지식정보시스템 감나무 형태 기술', '보관소 감나무 실촬영 media_566818441e·media_9bcf76942a·media_57e7747031·media_0372ccb979 프레임 대조(2026-10-23)'],
  habit: { form: 'round', branchAngle: 42, apical: 0.55, crownWH: 1.08, heightM: [6, 14], bark: 'blocky' },
  leaf: { shape: 'elliptic', margin: 'entire', venation: 'pinnate', arrangement: 'alternate', widthRatio: 0.6, tip: 'acuminate', base: 'rounded', petiole: 0.1, sizeCm: [7, 17], veins: 6, glossy: true, droop: 0.45, peak: 0.55 },
  flower: { petals: 4, shape: 'urceolate', calyx: 'large', stamens: 'hidden', inflorescence: 'solitary', position: 'axil', sizeCm: 1.6, months: [5, 6], nodding: true },
  fruit: { type: 'persimmon', ratio: 0.82, sizeCm: [5, 8], bearing: 'single', months: [10, 11] },
  leafOutMonth: 4, leafFallMonth: 11,
};

export const BLUEBERRY_PROFILE: SpeciesProfile = {
  id: 'blueberry', nameKo: '블루베리', latin: 'Vaccinium corymbosum',
  sources: ['국가생물종지식정보시스템·농촌진흥청 블루베리 형태 기술(하이부시)'],
  habit: { form: 'shrub', branchAngle: 28, apical: 0.3, crownWH: 1.0, heightM: [1.5, 2.5], stems: 5, bark: 'smooth' },
  leaf: { shape: 'elliptic', margin: 'entire', venation: 'pinnate', arrangement: 'alternate', widthRatio: 0.48, tip: 'acute', base: 'cuneate', petiole: 0.05, sizeCm: [3, 7], veins: 5, glossy: false, droop: 0.2, peak: 0.5 },
  flower: { petals: 5, shape: 'urceolate', calyx: 'small', stamens: 'hidden', inflorescence: 'raceme', position: 'tip', sizeCm: 0.9, months: [4, 5], nodding: true },
  fruit: { type: 'berry', ratio: 0.85, sizeCm: [1, 1.8], bearing: 'cluster', clusterN: 7, months: [6, 7, 8] },
  leafOutMonth: 4, leafFallMonth: 11,
};

/** 프리셋 없는 수종 — 일반 활엽수(장면은 보고에 '일반형'이라 적는다). */
export const GENERIC_BROADLEAF: SpeciesProfile = {
  id: 'generic', nameKo: '일반 활엽수', latin: '-', sources: ['일반형 — 형태 근거 없음'],
  habit: { form: 'round', branchAngle: 40, apical: 0.5, crownWH: 1.0, heightM: [5, 10], bark: 'furrowed' },
  leaf: { shape: 'elliptic', margin: 'serrate', venation: 'pinnate', arrangement: 'alternate', widthRatio: 0.5, tip: 'acute', base: 'rounded', petiole: 0.15, sizeCm: [6, 10], veins: 6, droop: 0.3 },
  flower: { petals: 5, shape: 'open', petalShape: 'oval', calyx: 'small', stamens: 'many', inflorescence: 'corymb', position: 'tip', sizeCm: 2.5, months: [4] },
  fruit: { type: 'drupe', ratio: 1, sizeCm: [2, 3], bearing: 'single', months: [7] },
  leafOutMonth: 4, leafFallMonth: 11,
};

export const SPECIES: Record<string, SpeciesProfile> = { persimmon: PERSIMMON_PROFILE, blueberry: BLUEBERRY_PROFILE, generic: GENERIC_BROADLEAF };
/** id 또는 한글 이름으로 — 없으면 일반형. */
export function speciesOf(key: string | SpeciesProfile | undefined): SpeciesProfile {
  if (!key) return PERSIMMON_PROFILE;
  if (typeof key !== 'string') return key;
  return SPECIES[key] ?? Object.values(SPECIES).find((s) => s.nameKo === key) ?? GENERIC_BROADLEAF;
}
